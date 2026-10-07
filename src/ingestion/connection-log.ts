/**
 * Importador del **registro de conexiones del terminal** de un AGV (DS-013, ADR-0017).
 *
 * Lo exporta el terminal de cada vehículo: una fila por evento —`Desconexión`, `Conexión`, `Conexión
 * tras apagado`— con fecha y hora al segundo, un campo de cobertura (0 sin señal, 255 con señal, 1
 * tras apagado), la versión, la IP del terminal y un campo auxiliar con el MTC/MTD vigente. **No
 * trae columna de AGV**: el vehículo va en el nombre del fichero (`CONEXIONES<agv>.xlsx`), y quien
 * carga lo ve antes de confirmar y puede corregirlo (OQ-160).
 *
 * Tres decisiones:
 *
 * - **El tipo de evento es un catálogo cerrado** con los tres valores vistos; un valor nuevo se
 *   conserva como texto y queda `desconocido`, nunca se descarta ni se reinterpreta (DATA_CONTRACTS
 *   §3.4: una fila se clasifica antes de normalizarse).
 * - **La IP del terminal se conserva como atributo** y se avisa si un mismo fichero trae más de una:
 *   con el AGV sacado del nombre, dos IP son la señal de que se han mezclado dos terminales.
 * - **El orden del fichero no importa**: viene de más reciente a más antiguo y se ordena por instante;
 *   la fila de origen se conserva para la procedencia (R-EVI-001).
 */

import { CONNECTION_STRUCTURE, type ConnectionEvent, type ConnectionEventKind } from "../domain/connection-log.js";
import { parseTimestamp } from "../domain/time.js";
import { detectDelimiter, type Delimiter } from "./delimiter.js";
import { excelSerialToText } from "./fleet-history.js";
import { normaliseHeaderCell, unquoteField } from "./importer.js";

export { CONNECTION_STRUCTURE, agvFromFileName, type ConnectionEvent, type ConnectionEventKind } from "../domain/connection-log.js";

export type ConnectionRejection = "FECHA_INVALIDA" | "SIN_TIPO" | "CAMPOS_INSUFICIENTES";

export interface ConnectionImport {
  readonly agvId: string;
  /** Los eventos, de más antiguo a más reciente. */
  readonly events: readonly ConnectionEvent[];
  readonly rejected: readonly { readonly sourceRow: number; readonly reason: ConnectionRejection; readonly excerpt: string }[];
  /** Las IP del terminal vistas en el fichero; más de una es un aviso. */
  readonly ips: readonly string[];
  readonly warnings: readonly string[];
  readonly delimiter: Delimiter | null;
}

export class ConnectionFailure extends Error {
  constructor(
    readonly reason: string,
    readonly recovery: string,
  ) {
    super(reason);
    this.name = "ConnectionFailure";
  }
}

function normaliseKind(raw: string): ConnectionEventKind {
  const text = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
  if (text === "desconexion") return "desconexion";
  if (text === "conexion") return "conexion";
  if (text === "conexion tras apagado") return "conexion-tras-apagado";
  return "desconocido";
}

function excerpt(line: string): string {
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function tooShort(): ConnectionFailure {
  return new ConnectionFailure(
    "El fichero no tiene cabecera y al menos una fila.",
    `Se espera la exportación del terminal: una fila por evento con «Fecha» y «Conexión», en un fichero ${CONNECTION_STRUCTURE.fileName}.`,
  );
}

/** Lee un registro de conexiones ya decodificado a texto (CSV). */
export function importConnectionLog(text: string, zone: string, agvId: string): ConnectionImport {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw tooShort();
  const delimiter = detectDelimiter(lines.slice(0, 50)).delimiter;
  return importConnectionTable(
    lines.map((line) => line.split(delimiter).map(unquoteField)),
    zone,
    agvId,
    delimiter,
  );
}

/** Lee las filas de la primera hoja de un libro de Excel, con las mismas reglas que el texto. */
export function importConnectionRows(rows: readonly (readonly string[])[], zone: string, agvId: string): ConnectionImport {
  const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (filled.length < 2) throw tooShort();
  const width = (filled[0] ?? []).length;
  return importConnectionTable(
    filled.map((row) => Array.from({ length: Math.max(width, row.length) }, (_, index) => row[index] ?? "")),
    zone,
    agvId,
    null,
  );
}

function importConnectionTable(
  table: readonly (readonly string[])[],
  zone: string,
  agvId: string,
  delimiter: Delimiter | null,
): ConnectionImport {
  const separator = delimiter ?? ";";
  const fromExcel = delimiter === null;
  const header = (table[0] ?? []).map(normaliseHeaderCell);
  const column = (name: string): number => header.indexOf(name);
  const timeColumn = column("fecha");
  const kindColumn = column("conexion");
  if (timeColumn === -1 || kindColumn === -1) {
    throw new ConnectionFailure(
      `La cabecera es «${header.join(separator)}» y faltan las columnas obligatorias «Fecha» y «Conexión».`,
      `Se esperan «Fecha» y «Conexión» (la exportación del terminal); «${CONNECTION_STRUCTURE.optional.join("», «")}» son opcionales.`,
    );
  }
  const coverageColumn = column("cober.");
  const versionColumn = column("ver.");
  const ipColumn = column("ip terminal");
  const auxColumn = column("datos aux");
  const cell = (fields: readonly string[], index: number): string => (index === -1 ? "" : (fields[index] ?? "").trim());

  const events: ConnectionEvent[] = [];
  const rejected: { sourceRow: number; reason: ConnectionRejection; excerpt: string }[] = [];
  for (let index = 1; index < table.length; index += 1) {
    const fields = table[index] ?? [];
    const line = fields.join(separator);
    const sourceRow = index + 1;
    if (fields.length <= Math.max(timeColumn, kindColumn)) {
      rejected.push({ sourceRow, reason: "CAMPOS_INSUFICIENTES", excerpt: excerpt(line) });
      continue;
    }
    const rawKind = cell(fields, kindColumn);
    if (rawKind === "") {
      rejected.push({ sourceRow, reason: "SIN_TIPO", excerpt: excerpt(line) });
      continue;
    }
    const rawTime = fromExcel ? excelSerialToText(cell(fields, timeColumn)) : cell(fields, timeColumn);
    const parsed = parseTimestamp(rawTime, { zone, order: "day-first" });
    if (!parsed.ok) {
      rejected.push({ sourceRow, reason: "FECHA_INVALIDA", excerpt: excerpt(line) });
      continue;
    }
    const aux = cell(fields, auxColumn);
    const mtc = /MTC\s+(\d+)/i.exec(aux)?.[1] ?? null;
    events.push({
      agvId,
      utcMs: parsed.time.utcMs,
      kind: normaliseKind(rawKind),
      rawKind,
      coverage: cell(fields, coverageColumn),
      ipTerminal: cell(fields, ipColumn),
      version: cell(fields, versionColumn),
      aux,
      mtc,
      sourceRow,
    });
  }
  if (events.length === 0) {
    throw new ConnectionFailure(
      "Ninguna fila tenía fecha válida y tipo de evento.",
      "Comprueba que la fecha sea día/mes/año con hora y que la columna «Conexión» traiga el tipo de evento.",
    );
  }
  // De más antiguo a más reciente; a igual instante, el orden del fichero (que es de más reciente a más
  // antiguo) invertido, para que una desconexión y su conexión del mismo segundo no se crucen.
  const ordered = events.map((event, index) => ({ event, index })).sort((a, b) => a.event.utcMs - b.event.utcMs || b.index - a.index).map((entry) => entry.event);
  const ips = [...new Set(ordered.map((event) => event.ipTerminal).filter((ip) => ip !== ""))];
  const warnings: string[] = [];
  if (ips.length > 1) warnings.push(`El fichero trae ${ips.length} IP de terminal distintas (${ips.join(", ")}): puede mezclar dos terminales.`);
  const unknown = ordered.filter((event) => event.kind === "desconocido");
  if (unknown.length > 0) {
    const kinds = [...new Set(unknown.map((event) => event.rawKind))];
    warnings.push(`${unknown.length} ${unknown.length === 1 ? "evento" : "eventos"} de un tipo que el programa no conoce (${kinds.join(", ")}): se conservan sin interpretar.`);
  }
  return { agvId, events: ordered, rejected, ips, warnings, delimiter };
}
