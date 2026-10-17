/**
 * Las lecturas de una importación, por columnas, para cruzar del Worker a la página (F6, entrega 3;
 * `PERFORMANCE_BUDGET.md` §4 y §5).
 *
 * La página solo usa las lecturas para la tabla «Lecturas»: instante, AGV, tag, fila de origen, texto
 * original y la marca de la hora. Mandarlas como objetos obligaba a copiar uno por lectura al
 * recibirlas —con 461.000, unos 800 ms con el hilo principal parado (§3.2)— y a guardarlos todos en
 * su memoria. Por columnas, los números viajan en `ArrayBuffer` **transferidos** (sin copia), los
 * identificadores en un diccionario y los textos originales en una sola cadena con sus cortes.
 *
 * Los identificadores se comparan como texto exacto, con sus ceros (INV-002): el diccionario guarda
 * cada uno tal cual y filtrar es comparar posiciones del diccionario.
 */

import type { Reading } from "../domain/reading.js";
import type { TimeFlag } from "../domain/time.js";

export interface ReadingColumns {
  readonly count: number;
  readonly utcMs: Float64Array;
  /** Posición de cada AGV en `agvIds`. */
  readonly agv: Uint32Array;
  readonly agvIds: readonly string[];
  readonly tag: Uint32Array;
  readonly tagIds: readonly string[];
  readonly sourceRow: Uint32Array;
  /** Posición de la marca en `flags`. */
  readonly flag: Uint8Array;
  readonly flags: readonly TimeFlag[];
  /** Los textos originales del instante, seguidos; `rawEnd[i]` es donde acaba el de la lectura `i`. */
  readonly rawText: string;
  readonly rawEnd: Uint32Array;
}

/** Las columnas y los buffers que se transfieren con ellas. */
export function packReadings(readings: readonly Reading[]): { readonly columns: ReadingColumns; readonly transfer: readonly ArrayBuffer[] } {
  const count = readings.length;
  const utcMs = new Float64Array(count);
  const agv = new Uint32Array(count);
  const tag = new Uint32Array(count);
  const sourceRow = new Uint32Array(count);
  const flag = new Uint8Array(count);
  const rawEnd = new Uint32Array(count);
  const agvIds: string[] = [];
  const tagIds: string[] = [];
  const flags: TimeFlag[] = [];
  const agvIndex = new Map<string, number>();
  const tagIndex = new Map<string, number>();
  const flagIndex = new Map<TimeFlag, number>();
  const index = <T>(map: Map<T, number>, list: T[], value: T): number => {
    let position = map.get(value);
    if (position === undefined) {
      position = list.length;
      list.push(value);
      map.set(value, position);
    }
    return position;
  };
  const raw: string[] = new Array<string>(count);
  let end = 0;
  for (let position = 0; position < count; position += 1) {
    const reading = readings[position] as Reading;
    utcMs[position] = reading.time.utcMs;
    agv[position] = index(agvIndex, agvIds, reading.agvId);
    tag[position] = index(tagIndex, tagIds, reading.tagId);
    sourceRow[position] = reading.provenance.sourceRow;
    flag[position] = index(flagIndex, flags, reading.time.flag);
    raw[position] = reading.time.raw;
    end += reading.time.raw.length;
    rawEnd[position] = end;
  }
  return {
    columns: { count, utcMs, agv, agvIds, tag, tagIds, sourceRow, flag, flags, rawText: raw.join(""), rawEnd },
    transfer: [utcMs.buffer, agv.buffer, tag.buffer, sourceRow.buffer, flag.buffer, rawEnd.buffer],
  };
}

/** Lo que la tabla enseña de la lectura `position`. */
export interface ReadingRow {
  readonly utcMs: number;
  readonly agvId: string;
  readonly tagId: string;
  readonly sourceRow: number;
  readonly flag: TimeFlag;
  readonly raw: string;
}

export function readingRow(columns: ReadingColumns, position: number): ReadingRow {
  const start = position === 0 ? 0 : (columns.rawEnd[position - 1] as number);
  return {
    utcMs: columns.utcMs[position] as number,
    agvId: columns.agvIds[columns.agv[position] as number] as string,
    tagId: columns.tagIds[columns.tag[position] as number] as string,
    sourceRow: columns.sourceRow[position] as number,
    flag: columns.flags[columns.flag[position] as number] as TimeFlag,
    raw: columns.rawText.slice(start, columns.rawEnd[position] as number),
  };
}

/**
 * Las posiciones que pasan el filtro, con el texto exacto (INV-002); `null` si no hay filtro (todas).
 * Un AGV o tag que no está en el diccionario no coincide con ninguna.
 */
export function filterReadings(columns: ReadingColumns, agvId: string, tagId: string): Uint32Array | null {
  if (agvId === "" && tagId === "") return null;
  const agv = agvId === "" ? -1 : columns.agvIds.indexOf(agvId);
  const tag = tagId === "" ? -1 : columns.tagIds.indexOf(tagId);
  if ((agvId !== "" && agv < 0) || (tagId !== "" && tag < 0)) return new Uint32Array(0);
  const hits: number[] = [];
  for (let position = 0; position < columns.count; position += 1) {
    if ((agv < 0 || columns.agv[position] === agv) && (tag < 0 || columns.tag[position] === tag)) hits.push(position);
  }
  return Uint32Array.from(hits);
}

/** Sin lecturas: lo que tiene la página antes de la primera importación. */
export const EMPTY_COLUMNS: ReadingColumns = packReadings([]).columns;
