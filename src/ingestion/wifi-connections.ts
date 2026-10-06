/**
 * Importador del **informe de conexiones wifi** de un AGV (DS-013).
 *
 * Una fila por evento: `Fecha` y `Conexión` (`Conexión`, `Desconexión` o `Conexión tras apagado`),
 * más columnas técnicas que se conservan sin interpretar (`Datos Aux`). Tres decisiones:
 *
 * - **El AGV no es una columna**: el informe es de un solo vehículo y lo dice el nombre del fichero
 *   (`CONEXIONES123`). Quien llama lo declara; `agvFromFileName` solo propone el candidato que la
 *   interfaz enseña antes de cargar, nunca lo fija en silencio.
 * - **Las fechas son día/mes**, como el resto de exportaciones de Vsystem, y se leen en la zona del
 *   circuito. Un número de serie de Excel se lee como la fecha que se escribió.
 * - **Un tipo de evento desconocido no se descarta**: la fila se rechaza con su motivo y se cuenta.
 */

import { WIFI_STRUCTURE, type ConnectionEvent, type ConnectionKind } from "../domain/wifi-cuts.js";

export { WIFI_STRUCTURE, agvFromFileName } from "../domain/wifi-cuts.js";
import { parseTimestamp } from "../domain/time.js";
import { excelSerialToText } from "./fleet-history.js";
import { detectDelimiter } from "./delimiter.js";
import { normaliseHeaderCell, unquoteField } from "./importer.js";

export type WifiRejection = "SIN_FECHA" | "FECHA_INVALIDA" | "EVENTO_DESCONOCIDO";

export const WIFI_REJECTION_LABEL: Readonly<Record<WifiRejection, string>> = {
  SIN_FECHA: "sin fecha",
  FECHA_INVALIDA: "fecha que no se entiende",
  EVENTO_DESCONOCIDO: "tipo de conexión desconocido",
};

export interface WifiImport {
  readonly events: readonly ConnectionEvent[];
  readonly rejected: readonly { readonly sourceRow: number; readonly reason: WifiRejection }[];
  readonly warnings: readonly string[];
}

export class WifiFailure extends Error {
  constructor(
    readonly reason: string,
    readonly recovery: string,
  ) {
    super(reason);
    this.name = "WifiFailure";
  }
}

function kindOf(raw: string): ConnectionKind | null {
  const text = normaliseHeaderCell(raw).replace(/\s+/g, " ");
  if (text === "desconexion") return "desconexion";
  if (text === "conexion") return "conexion";
  if (text === "conexion tras apagado") return "conexion-tras-apagado";
  return null;
}

/** Lee las filas de la primera hoja (o de un texto ya partido en campos). */
export function importWifiRows(rows: readonly (readonly string[])[], zone: string, fromExcel: boolean): WifiImport {
  const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (filled.length < 2) {
    throw new WifiFailure(
      "El fichero no tiene cabecera y al menos una fila.",
      `Se espera «${WIFI_STRUCTURE.header.join(";")}» en la primera fila y una fila por evento.`,
    );
  }
  const header = (filled[0] ?? []).map(normaliseHeaderCell);
  const dateColumn = header.indexOf("fecha");
  const kindColumn = header.indexOf("conexion");
  if (dateColumn === -1 || kindColumn === -1) {
    throw new WifiFailure(
      `La cabecera es «${(filled[0] ?? []).join(";")}» y faltan columnas obligatorias.`,
      `Se esperan «${WIFI_STRUCTURE.header.join("» y «")}», tal como las exporta Vsystem.`,
    );
  }
  const auxColumn = header.indexOf("datos aux");

  const events: ConnectionEvent[] = [];
  const rejected: { sourceRow: number; reason: WifiRejection }[] = [];
  const warnings: string[] = [];
  let ambiguous = 0;
  for (let index = 1; index < filled.length; index += 1) {
    const fields = filled[index] ?? [];
    const sourceRow = index + 1;
    const rawDate = (fields[dateColumn] ?? "").trim();
    if (rawDate === "") {
      rejected.push({ sourceRow, reason: "SIN_FECHA" });
      continue;
    }
    const text = fromExcel ? excelSerialToText(rawDate) : rawDate;
    const parsed = parseTimestamp(text, { zone, order: "day-first" });
    if (!parsed.ok) {
      rejected.push({ sourceRow, reason: "FECHA_INVALIDA" });
      continue;
    }
    const kind = kindOf(fields[kindColumn] ?? "");
    if (kind === null) {
      rejected.push({ sourceRow, reason: "EVENTO_DESCONOCIDO" });
      continue;
    }
    if (parsed.time.flag !== "ok") ambiguous += 1;
    events.push({
      utcMs: parsed.time.utcMs,
      raw: text,
      kind,
      aux: auxColumn === -1 ? "" : (fields[auxColumn] ?? "").trim(),
      sourceRow,
    });
  }
  if (ambiguous > 0) {
    warnings.push(
      `${ambiguous} ${ambiguous === 1 ? "evento cae" : "eventos caen"} en el cambio de hora: su orden frente a las lecturas no es seguro.`,
    );
  }
  if (events.length === 0) {
    throw new WifiFailure("Ninguna fila trae una fecha y un tipo de conexión válidos.", "Comprueba que es el informe de conexiones de un AGV.");
  }
  return { events, rejected, warnings };
}

/** Lee un informe ya decodificado a texto (CSV o texto separado por tabuladores). */
export function importWifiText(text: string, zone: string): WifiImport {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
  const delimiter = detectDelimiter(lines.slice(0, 50)).delimiter;
  return importWifiRows(
    lines.map((line) => line.split(delimiter).map(unquoteField)),
    zone,
    false,
  );
}

/**
 * Fusiona un informe nuevo con lo guardado del mismo AGV: un evento con el mismo instante y tipo es el
 * mismo evento (dos exportaciones que se solapan). El resultado queda en orden de tiempo.
 */
export function mergeWifiEvents(
  existing: readonly ConnectionEvent[],
  incoming: readonly ConnectionEvent[],
): { readonly events: readonly ConnectionEvent[]; readonly added: number } {
  const key = (event: ConnectionEvent): string => `${event.utcMs}\u0000${event.kind}`;
  const seen = new Set(existing.map(key));
  const merged = [...existing];
  let added = 0;
  for (const event of incoming) {
    if (seen.has(key(event))) continue;
    seen.add(key(event));
    merged.push(event);
    added += 1;
  }
  merged.sort((a, b) => a.utcMs - b.utcMs);
  return { events: merged, added };
}
