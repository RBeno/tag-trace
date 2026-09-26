/**
 * Importador del **historial de flota** de un circuito (DS-012).
 *
 * Una fila por AGV y periodo: `circuito;agv;desde;hasta;nota`. Como las listas de tags, se escribe a
 * mano, así que la forma la fija este programa y se enseña antes de pedirla (`FLEET_STRUCTURE`).
 *
 * Tres decisiones que conviene no deshacer:
 *
 * - **Las fechas son día/mes**, declarado y no adivinado, en la zona del circuito, con hora opcional.
 *   Un `desde` sin hora es a las 00:00 de ese día; un `hasta` sin hora es el **final de ese día**: el
 *   periodo llega hasta las 00:00 del día siguiente, exclusivo (propietario, 2026-09-26, OQ-139). Así,
 *   un alta y una baja escritas el mismo día son un periodo válido de un día entero, y el AGV no queda
 *   fuera todo su último día. En una hoja de Excel, un número de serie entero es una fecha sin hora.
 * - **El periodo es `[desde, hasta)`**: `hasta` es el instante de la baja, y vacío es que sigue.
 *   `HASTA_ANTES_DE_DESDE` solo cuando, leído así, `hasta` queda antes que `desde` (o igual, con hora:
 *   un periodo vacío no asigna nada).
 * - **Un fichero puede traer varios circuitos.** El importador no elige: devuelve cuántas filas
 *   trae cada uno, y quien llama filtra por el que corresponde.
 */

import { FLEET_STRUCTURE, overlappingPeriods, type FleetPeriod } from "../domain/fleet.js";
import { parseTimestamp } from "../domain/time.js";
import { detectDelimiter, type Delimiter } from "./delimiter.js";
import { normaliseHeaderCell, unquoteField } from "./importer.js";

export { FLEET_STRUCTURE } from "../domain/fleet.js";

export interface FleetRow extends FleetPeriod {
  /** El valor de la columna `circuito`, o cadena vacía si el fichero no la trae. */
  readonly circuit: string;
  /** Fila física del fichero, contando la cabecera como fila 1. */
  readonly sourceRow: number;
}

export type FleetRejection = "SIN_AGV" | "FECHA_INVALIDA" | "HASTA_ANTES_DE_DESDE" | "CAMPOS_INSUFICIENTES";

export interface FleetImport {
  /** El separador del texto; `null` si vino de una hoja de Excel. */
  readonly delimiter: Delimiter | null;
  readonly rows: readonly FleetRow[];
  readonly rejected: readonly { readonly sourceRow: number; readonly reason: FleetRejection; readonly excerpt: string }[];
  /** Los valores de la columna `circuito` y cuántas filas trae cada uno. Vacío si no hay columna. */
  readonly circuits: readonly { readonly name: string; readonly rows: number }[];
  readonly warnings: readonly string[];
}

export class FleetFailure extends Error {
  constructor(
    readonly reason: string,
    readonly recovery: string,
  ) {
    super(reason);
    this.name = "FleetFailure";
  }
}

const DATE_ONLY = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

/** Una fecha escrita a mano, día/mes, con hora opcional. `null` si no es una fecha válida. */
function parseDate(raw: string, zone: string): number | null {
  const text = raw.trim();
  const withTime = DATE_ONLY.test(text) ? `${text} 0:00` : text;
  const result = parseTimestamp(withTime, { zone, order: "day-first" });
  return result.ok ? result.time.utcMs : null;
}

/**
 * Un `hasta`: sin hora, el final de ese día, que son las 00:00 del día siguiente en la zona del
 * circuito (no 24 h después: un cambio de hora en medio las haría 23 o 25). Con hora, tal cual.
 */
function parseUntil(raw: string, zone: string): number | null {
  const text = raw.trim();
  const match = DATE_ONLY.exec(text);
  if (match === null) return parseDate(text, zone);
  const [, day, month, year] = match as unknown as [string, string, string, string];
  const next = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + 1));
  if (Number.isNaN(next.getTime())) return null;
  // La fecha escrita tiene que ser válida por sí misma (31/02 no lo es) antes de pasar al día siguiente.
  if (parseDate(text, zone) === null) return null;
  return parseDate(`${next.getUTCDate()}/${next.getUTCMonth() + 1}/${next.getUTCFullYear()}`, zone);
}

/**
 * Una fecha que Excel guardó como número de serie —días desde el 30/12/1899, con la hora en la parte
 * decimal— cuando la celda no estaba en formato texto. Es la hora de pared tal como se escribió, así
 * que se pasa a día/mes/año y se lee en la zona del circuito como cualquier otra. Solo en una hoja de
 * Excel: en un texto, un número suelto en una columna de fecha no es una fecha.
 */
export function excelSerialToText(raw: string, dateOnlyIfWhole = false): string {
  const text = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return raw;
  const serial = Number(text);
  // Entre 1950 y 2150: fuera de ahí no es una fecha de esta planta, y se deja para que se rechace.
  if (serial < 18264 || serial > 91311) return raw;
  const wall = new Date(Math.round((serial - 25569) * 86_400_000));
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${pad(wall.getUTCDate())}/${pad(wall.getUTCMonth() + 1)}/${wall.getUTCFullYear()}`;
  // Un serie entero es una celda de fecha sin hora: en el `hasta` del historial, el final de ese día.
  if (dateOnlyIfWhole && Number.isInteger(serial)) return date;
  return `${date} ${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`;
}

function tooShort(): FleetFailure {
  return new FleetFailure(
    "El fichero no tiene cabecera y al menos una fila.",
    `Se espera «${FLEET_STRUCTURE.header.join(";")}» en la primera fila y una fila por AGV y periodo.`,
  );
}

/** Lee un historial de flota ya decodificado a texto. */
export function importFleetHistory(text: string, zone: string): FleetImport {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw tooShort();
  const delimiter = detectDelimiter(lines.slice(0, 50)).delimiter;
  // Comillas envolventes fuera, como en las lecturas: `"0040"` es el AGV `0040`, no otro.
  return importFleetTable(
    lines.map((line) => line.split(delimiter).map(unquoteField)),
    zone,
    delimiter,
  );
}

/**
 * Lee las filas de la primera hoja de un libro de Excel, con las mismas reglas que el texto. Una fecha
 * que Excel guardó como número se lee como la fecha que se escribió (`excelSerialToText`).
 */
export function importFleetRows(rows: readonly (readonly string[])[], zone: string): FleetImport {
  const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (filled.length < 2) throw tooShort();
  const width = (filled[0] ?? []).length;
  return importFleetTable(
    filled.map((row) => Array.from({ length: Math.max(width, row.length) }, (_, index) => row[index] ?? "")),
    zone,
    null,
  );
}

function importFleetTable(table: readonly (readonly string[])[], zone: string, delimiter: Delimiter | null): FleetImport {
  const separator = delimiter ?? ";";
  const fromExcel = delimiter === null;
  // La misma normalización que la cabecera de lecturas: sin BOM, sin acentos y en minúsculas.
  const header = (table[0] ?? []).map(normaliseHeaderCell);
  const column = (name: string): number => header.indexOf(name);
  const agvColumn = column("agv");
  const fromColumn = column("desde");
  if (agvColumn === -1 || fromColumn === -1) {
    throw new FleetFailure(
      `La cabecera es «${header.join(separator)}» y faltan las columnas obligatorias.`,
      `Se esperan «agv» y «desde»; «${FLEET_STRUCTURE.optional.join("», «")}» son opcionales.`,
    );
  }
  const circuitColumn = column("circuito");
  const toColumn = column("hasta");
  const noteColumn = column("nota");
  const cell = (fields: readonly string[], index: number): string => (index === -1 ? "" : (fields[index] ?? "").trim());

  const rows: FleetRow[] = [];
  const rejected: { sourceRow: number; reason: FleetRejection; excerpt: string }[] = [];
  const dateCell = (fields: readonly string[], index: number): string =>
    fromExcel ? excelSerialToText(cell(fields, index)) : cell(fields, index);
  for (let index = 1; index < table.length; index += 1) {
    const fields = table[index] ?? [];
    const line = fields.join(separator);
    const sourceRow = index + 1;
    if (fields.length <= Math.max(agvColumn, fromColumn)) {
      rejected.push({ sourceRow, reason: "CAMPOS_INSUFICIENTES", excerpt: excerpt(line) });
      continue;
    }
    // El identificador se conserva tal cual: `0040` no es 40 (R-DAT-001).
    const agvId = cell(fields, agvColumn);
    if (agvId === "") {
      rejected.push({ sourceRow, reason: "SIN_AGV", excerpt: excerpt(line) });
      continue;
    }
    const fromUtcMs = parseDate(dateCell(fields, fromColumn), zone);
    const rawTo = fromExcel ? excelSerialToText(cell(fields, toColumn), true) : cell(fields, toColumn);
    const toUtcMs = rawTo === "" ? null : parseUntil(rawTo, zone);
    if (fromUtcMs === null || (rawTo !== "" && toUtcMs === null)) {
      rejected.push({ sourceRow, reason: "FECHA_INVALIDA", excerpt: excerpt(line) });
      continue;
    }
    if (toUtcMs !== null && toUtcMs <= fromUtcMs) {
      rejected.push({ sourceRow, reason: "HASTA_ANTES_DE_DESDE", excerpt: excerpt(line) });
      continue;
    }
    rows.push({ circuit: cell(fields, circuitColumn), agvId, fromUtcMs, toUtcMs, note: cell(fields, noteColumn), sourceRow });
  }

  if (rows.length === 0) {
    throw new FleetFailure(
      "Ninguna fila tenía AGV y una fecha «desde» válida.",
      `Comprueba la cabecera, el separador y que las fechas sean día/mes/año. Ejemplo: «${FLEET_STRUCTURE.example[1]}».`,
    );
  }

  const counts = new Map<string, number>();
  for (const row of rows) if (row.circuit !== "") counts.set(row.circuit, (counts.get(row.circuit) ?? 0) + 1);
  const warnings: string[] = [];
  const unknownColumns = header.filter(
    (name) => name !== "" && !(FLEET_STRUCTURE.header as readonly string[]).includes(name),
  );
  if (unknownColumns.length > 0) {
    // Se ignoran, pero se dice: «fecha» por «desde» ya se rechaza por cabecera, pero «Hasta » con
    // espacio o «baja» por «hasta» dejarían a todos los AGV sin fecha de baja y sin aviso.
    warnings.push(
      `Columnas que este importador no conoce y se ignoran: ${unknownColumns.join(", ")}. ` +
        `Las reconocidas son ${FLEET_STRUCTURE.header.join(", ")}.`,
    );
  }
  const byCircuit = new Map<string, FleetRow[]>();
  for (const row of rows) byCircuit.set(row.circuit, [...(byCircuit.get(row.circuit) ?? []), row]);
  for (const [circuit, list] of byCircuit) {
    const overlapping = overlappingPeriods(list);
    if (overlapping.length > 0) {
      warnings.push(
        `${circuit === "" ? "" : `«${circuit}»: `}${overlapping.length} AGV con periodos que se pisan ` +
          `(${overlapping.slice(0, 5).join(", ")}${overlapping.length > 5 ? "…" : ""}). Se cargan tal cual.`,
      );
    }
  }

  return {
    delimiter,
    rows,
    rejected,
    circuits: [...counts.entries()].map(([name, count]) => ({ name, rows: count })),
    warnings,
  };
}

/** Recorte seguro para mensajes: nunca se vuelca una fila entera (TH-003). */
function excerpt(line: string): string {
  return line.length <= 80 ? line : `${line.slice(0, 80)}…`;
}
