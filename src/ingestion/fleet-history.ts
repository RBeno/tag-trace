/**
 * Importador del **historial de flota** de un circuito (DS-012).
 *
 * Una fila por AGV y periodo: `circuito;agv;desde;hasta;nota`. Como las listas de tags, se escribe a
 * mano, así que la forma la fija este programa y se enseña antes de pedirla (`FLEET_STRUCTURE`).
 *
 * Tres decisiones que conviene no deshacer:
 *
 * - **Las fechas son día/mes**, declarado y no adivinado, en la zona del circuito, con hora opcional.
 *   Una fecha sin hora es a las 00:00.
 * - **El periodo es `[desde, hasta)`**: `hasta` es el instante de la baja, y vacío es que sigue.
 * - **Un fichero puede traer varios circuitos.** El importador no elige: devuelve cuántas filas
 *   trae cada uno, y quien llama filtra por el que corresponde.
 */

import { FLEET_STRUCTURE, overlappingPeriods, type FleetPeriod } from "../domain/fleet.js";
import { parseTimestamp } from "../domain/time.js";
import { detectDelimiter, type Delimiter } from "./delimiter.js";

export { FLEET_STRUCTURE } from "../domain/fleet.js";

export interface FleetRow extends FleetPeriod {
  /** El valor de la columna `circuito`, o cadena vacía si el fichero no la trae. */
  readonly circuit: string;
  /** Fila física del fichero, contando la cabecera como fila 1. */
  readonly sourceRow: number;
}

export type FleetRejection = "SIN_AGV" | "FECHA_INVALIDA" | "HASTA_ANTES_DE_DESDE" | "CAMPOS_INSUFICIENTES";

export interface FleetImport {
  readonly delimiter: Delimiter;
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

/** Lee un historial de flota ya decodificado a texto. */
export function importFleetHistory(text: string, zone: string): FleetImport {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    throw new FleetFailure(
      "El fichero no tiene cabecera y al menos una fila.",
      `Se espera «${FLEET_STRUCTURE.header.join(";")}» en la primera fila y una fila por AGV y periodo.`,
    );
  }
  const delimiter = detectDelimiter(lines.slice(0, 50)).delimiter;
  const header = (lines[0] ?? "").split(delimiter).map((field) => field.trim().toLowerCase());
  const column = (name: string): number => header.indexOf(name);
  const agvColumn = column("agv");
  const fromColumn = column("desde");
  if (agvColumn === -1 || fromColumn === -1) {
    throw new FleetFailure(
      `La cabecera es «${header.join(delimiter)}» y faltan las columnas obligatorias.`,
      `Se esperan «agv» y «desde»; «${FLEET_STRUCTURE.optional.join("», «")}» son opcionales.`,
    );
  }
  const circuitColumn = column("circuito");
  const toColumn = column("hasta");
  const noteColumn = column("nota");
  const cell = (fields: readonly string[], index: number): string => (index === -1 ? "" : (fields[index] ?? "").trim());

  const rows: FleetRow[] = [];
  const rejected: { sourceRow: number; reason: FleetRejection; excerpt: string }[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const sourceRow = index + 1;
    const fields = line.split(delimiter);
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
    const fromUtcMs = parseDate(cell(fields, fromColumn), zone);
    const rawTo = cell(fields, toColumn);
    const toUtcMs = rawTo === "" ? null : parseDate(rawTo, zone);
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
