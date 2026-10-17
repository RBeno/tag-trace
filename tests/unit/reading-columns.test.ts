/**
 * Las lecturas por columnas (F6, entrega 3; `PERFORMANCE_BUDGET.md` §4 y §5).
 *
 * Lo que se fija:
 * - cada fila de la tabla sale igual que de la lectura: instante, AGV, tag, fila de origen, marca de la
 *   hora y texto original, con acentos y textos de distinta longitud;
 * - los números viajan en buffers que se pueden transferir;
 * - el filtro compara el texto exacto, con sus ceros (INV-002): `0040` no es `40` y `2032` no es `20321`;
 * - sin lecturas, cero filas.
 */

import { describe, expect, it } from "vitest";

import { EMPTY_COLUMNS, filterReadings, packReadings, readingRow } from "../../src/application/reading-columns.js";
import type { Reading } from "../../src/domain/reading.js";

const reading = (utcMs: number, agvId: string, tagId: string, sourceRow: number, raw: string, flag: Reading["time"]["flag"] = "ok"): Reading => ({
  time: { utcMs, raw, zone: "Europe/Madrid", flag },
  agvId,
  tagId,
  provenance: { sourceId: "s", sourceHash: "h", sourceRow },
});

const readings = [
  reading(1_000, "0040", "2032", 2, "25/10/2026 2:30:00", "dst_by_position"),
  reading(2_000, "40", "20321", 3, "25/10/2026 02:31"),
  reading(3_000, "0040", "20321", 4, "día ñ 03:00:00"),
  reading(4_000, "0041", "2032", 5, ""),
];

describe("lecturas por columnas", () => {
  it("cada fila sale igual que de la lectura", () => {
    const { columns, transfer } = packReadings(readings);
    expect(columns.count).toBe(4);
    readings.forEach((entry, position) => {
      expect(readingRow(columns, position)).toEqual({
        utcMs: entry.time.utcMs,
        agvId: entry.agvId,
        tagId: entry.tagId,
        sourceRow: entry.provenance.sourceRow,
        flag: entry.time.flag,
        raw: entry.time.raw,
      });
    });
    expect(transfer.every((buffer) => buffer instanceof ArrayBuffer)).toBe(true);
    expect(structuredClone(columns, { transfer: [...transfer] }).count).toBe(4);
  });

  it("el filtro compara el texto exacto, con sus ceros", () => {
    const { columns } = packReadings(readings);
    expect(filterReadings(columns, "", "")).toBeNull();
    expect([...(filterReadings(columns, "0040", "") ?? [])]).toEqual([0, 2]);
    expect([...(filterReadings(columns, "40", "") ?? [])]).toEqual([1]);
    expect([...(filterReadings(columns, "", "2032") ?? [])]).toEqual([0, 3]);
    expect([...(filterReadings(columns, "0040", "20321") ?? [])]).toEqual([2]);
    expect([...(filterReadings(columns, "9999", "") ?? [])]).toEqual([]);
  });

  it("sin lecturas, cero filas", () => {
    expect(EMPTY_COLUMNS.count).toBe(0);
    expect(filterReadings(EMPTY_COLUMNS, "1", "")?.length).toBe(0);
  });
});
