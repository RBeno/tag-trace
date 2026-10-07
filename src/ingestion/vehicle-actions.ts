/**
 * Importador del **informe de lecturas con acciones** de un AGV (DS-014).
 *
 * Una fila por lectura: `Fecha`, `Nº Tag`, `MTC`, `Acciones` y las marcas `No en memoria` y
 * `No ejecutado`; `MTD` se ignora. Como el informe de conexiones (DS-013), es de un solo vehículo y
 * el AGV no es una columna: lo declara quien llama (la interfaz lo propone desde el nombre del
 * fichero). Las fechas son día/mes, en la zona del circuito.
 *
 * No son lecturas del circuito: no entran en el análisis de lecturas (DS-001), que ya trae las de ese
 * AGV desde el servidor. Son la acción que cada tag ordenó y lo que el vehículo marcó al leerlo.
 */

import type { ActionReading } from "../domain/tag-actions.js";
import { parseTimestamp } from "../domain/time.js";
import { detectDelimiter } from "./delimiter.js";
import { excelSerialToText } from "./fleet-history.js";
import { normaliseHeaderCell, unquoteField } from "./importer.js";

export type ActionsRejection = "SIN_FECHA" | "FECHA_INVALIDA" | "SIN_TAG";

export const ACTIONS_REJECTION_LABEL: Readonly<Record<ActionsRejection, string>> = {
  SIN_FECHA: "sin fecha",
  FECHA_INVALIDA: "fecha que no se entiende",
  SIN_TAG: "sin tag",
};

export interface ActionsImport {
  readonly readings: readonly ActionReading[];
  readonly rejected: readonly { readonly sourceRow: number; readonly reason: ActionsRejection }[];
  readonly warnings: readonly string[];
}

export class ActionsFailure extends Error {
  constructor(
    readonly reason: string,
    readonly recovery: string,
  ) {
    super(reason);
    this.name = "ActionsFailure";
  }
}

const TAG_HEADERS = ["nº tag", "n° tag", "no tag", "n tag", "num tag", "tag"];

/** Una casilla de Excel marcada, en cualquiera de las formas en que llega como texto. */
function checked(raw: string): boolean {
  return /^(true|verdadero|1|s[ií]|x)$/i.test(raw.trim());
}

/** El número de MTC de la columna, sin el texto: «MTC nº 7» → «7»; vacío o «0» es el modo normal. */
function mtcOf(raw: string): string {
  const text = raw.trim();
  if (text === "") return "";
  const digits = /(\d+)\s*$/.exec(text)?.[1];
  if (digits === undefined) return text;
  return Number(digits) === 0 ? "" : digits;
}

/** Lee las filas de la primera hoja (o de un texto ya partido en campos). */
export function importActionRows(rows: readonly (readonly string[])[], zone: string, fromExcel: boolean): ActionsImport {
  const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (filled.length < 2) {
    throw new ActionsFailure(
      "El fichero no tiene cabecera y al menos una fila.",
      "Se espera «Fecha;Nº Tag;MTC;Acciones;No en memoria;No ejecutado» en la primera fila y una fila por lectura.",
    );
  }
  const header = (filled[0] ?? []).map(normaliseHeaderCell);
  const dateColumn = header.indexOf("fecha");
  const tagColumn = header.findIndex((cell) => TAG_HEADERS.includes(cell));
  const actionColumn = header.indexOf("acciones");
  if (dateColumn === -1 || tagColumn === -1 || actionColumn === -1) {
    throw new ActionsFailure(
      `La cabecera es «${(filled[0] ?? []).join(";")}» y faltan columnas obligatorias.`,
      "Se esperan «Fecha», «Nº Tag» y «Acciones», tal como las exporta Vsystem; «MTC», «No en memoria» y «No ejecutado» son opcionales.",
    );
  }
  const mtcColumn = header.indexOf("mtc");
  const memoryColumn = header.indexOf("no en memoria");
  const executedColumn = header.indexOf("no ejecutado");
  const cell = (fields: readonly string[], index: number): string => (index === -1 ? "" : (fields[index] ?? "").trim());

  const readings: ActionReading[] = [];
  const rejected: { sourceRow: number; reason: ActionsRejection }[] = [];
  const warnings: string[] = [];
  let ambiguous = 0;
  for (let index = 1; index < filled.length; index += 1) {
    const fields = filled[index] ?? [];
    const sourceRow = index + 1;
    const rawDate = cell(fields, dateColumn);
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
    // El tag se conserva como texto: `0040` no es 40 (R-DAT-001).
    const tagId = cell(fields, tagColumn);
    if (tagId === "") {
      rejected.push({ sourceRow, reason: "SIN_TAG" });
      continue;
    }
    if (parsed.time.flag !== "ok") ambiguous += 1;
    readings.push({
      utcMs: parsed.time.utcMs,
      raw: text,
      tagId,
      mtc: mtcOf(cell(fields, mtcColumn)),
      action: cell(fields, actionColumn),
      notInMemory: checked(cell(fields, memoryColumn)),
      notExecuted: checked(cell(fields, executedColumn)),
      sourceRow,
    });
  }
  if (memoryColumn === -1) warnings.push("El fichero no trae la columna «No en memoria»: no se puede avisar de lecturas fuera de memoria.");
  if (executedColumn === -1) warnings.push("El fichero no trae la columna «No ejecutado»: no se puede avisar de tags no ejecutados.");
  if (ambiguous > 0) {
    warnings.push(
      `${ambiguous} ${ambiguous === 1 ? "lectura cae" : "lecturas caen"} en el cambio de hora: su orden frente a los cortes wifi no es seguro.`,
    );
  }
  if (readings.length === 0) {
    throw new ActionsFailure("Ninguna fila trae fecha y tag válidos.", "Comprueba que es el informe de lecturas con acciones de un AGV.");
  }
  return { readings, rejected, warnings };
}

/** Lee un informe ya decodificado a texto (CSV o separado por tabuladores). */
export function importActionText(text: string, zone: string): ActionsImport {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
  const delimiter = detectDelimiter(lines.slice(0, 50)).delimiter;
  return importActionRows(
    lines.map((line) => line.split(delimiter).map(unquoteField)),
    zone,
    false,
  );
}

/**
 * Fusiona un informe nuevo con lo guardado del mismo AGV: una lectura con el mismo instante, tag y
 * acción es la misma (dos exportaciones que se solapan). Queda en orden de tiempo.
 */
export function mergeActionReadings(
  existing: readonly ActionReading[],
  incoming: readonly ActionReading[],
): { readonly readings: readonly ActionReading[]; readonly added: number } {
  const key = (reading: ActionReading): string => `${reading.utcMs}\u0000${reading.tagId}\u0000${reading.action}`;
  const seen = new Set(existing.map(key));
  const merged = [...existing];
  let added = 0;
  for (const reading of incoming) {
    if (seen.has(key(reading))) continue;
    seen.add(key(reading));
    merged.push(reading);
    added += 1;
  }
  merged.sort((a, b) => a.utcMs - b.utcMs);
  return { readings: merged, added };
}
