/**
 * Cobertura (`src/domain/coverage.ts`, R-DAT-007): pruebas propias, de caracterización.
 *
 * `circuit.test.ts` ya fija el caso normal de cada función (ventana completa hasta el penúltimo
 * instante, un solo instante sin tramo, dos fuentes disjuntas, dos intervalos que se solapan). Aquí se
 * fijan los bordes que nadie probaba y de los que dependen el grafo, las vueltas, el FIFO y las calles
 * (revisión del 2026-10-18, B-15): fuente vacía, instante final repetido, entrada desordenada,
 * intervalos que se tocan o se contienen, bordes inclusivos, y `sameSpan` —que no tenía ninguna
 * prueba directa— con la cola cortada de una exportación.
 */

import { describe, expect, it } from "vitest";

import { isCovered, mergeIntervals, sameSpan, sourceCoverage, uncoveredGaps } from "../../src/domain/coverage.js";
import type { Reading } from "../../src/domain/reading.js";

function reading(utcMs: number, row: number): Reading {
  return { time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" }, agvId: "0007", tagId: "A", provenance: { sourceId: "s", sourceHash: "s", sourceRow: row } };
}

describe("cobertura · bordes de coverage.ts (TC-384)", () => {
  it("sourceCoverage: sin lecturas no hay nada; el orden de las filas no importa; el último instante repetido sigue siendo la cola", () => {
    expect(sourceCoverage([])).toEqual({ complete: null, partialFrom: null });
    // Desordenadas (una pila): el tramo es el mismo.
    expect(sourceCoverage([reading(3000, 2), reading(2000, 3), reading(1000, 4)])).toEqual({ complete: { from: 1000, to: 2000 }, partialFrom: 3000 });
    // Varias lecturas en el último instante: el penúltimo instante **distinto** cierra el tramo.
    expect(sourceCoverage([reading(1000, 2), reading(3000, 3), reading(3000, 4)])).toEqual({ complete: { from: 1000, to: 1000 }, partialFrom: 3000 });
    // Dos instantes: el tramo completo es un solo instante, el primero.
    expect(sourceCoverage([reading(1000, 2), reading(2000, 3)])).toEqual({ complete: { from: 1000, to: 1000 }, partialFrom: 2000 });
  });

  it("mergeIntervals: vacío, desordenado, contiguos (se funden), contenidos (no encogen) y sin tocar la entrada", () => {
    expect(mergeIntervals([])).toEqual([]);
    const input = [
      { from: 50, to: 60 },
      { from: 0, to: 10 },
      { from: 10, to: 20 },
      { from: 12, to: 15 },
      { from: 21, to: 30 },
    ];
    const copy = input.map((interval) => ({ ...interval }));
    // 0–10 y 10–20 se tocan: uno. 12–15 está dentro: no cambia nada. 21 no toca 20: otro intervalo.
    expect(mergeIntervals(input)).toEqual([
      { from: 0, to: 20 },
      { from: 21, to: 30 },
      { from: 50, to: 60 },
    ]);
    expect(input).toEqual(copy);
  });

  it("isCovered: los dos bordes de un tramo están cubiertos; sin cobertura, nada lo está", () => {
    const coverage = mergeIntervals([
      { from: 1000, to: 2000 },
      { from: 5000, to: 6000 },
    ]);
    expect([999, 1000, 2000, 2001, 4999, 5000, 6000].map((at) => isCovered(coverage, at))).toEqual([false, true, true, false, false, true, true]);
    expect(isCovered([], 1000)).toBe(false);
  });

  it("sameSpan: los dos extremos en el mismo tramo, bordes incluidos; la cola cortada de una exportación no empareja con la siguiente", () => {
    // Exportación 1: tramo completo 0–60 min, cola en el minuto 61. Exportación 2: 300–540 min.
    const MIN = 60_000;
    const coverage = mergeIntervals([
      { from: 0, to: 60 * MIN },
      { from: 300 * MIN, to: 540 * MIN },
    ]);
    expect(sameSpan(coverage, 10 * MIN, 50 * MIN)).toBe(true);
    expect(sameSpan(coverage, 0, 60 * MIN)).toBe(true);
    // El caso de B-02: entrada leída en la cola (minuto 61, fuera de su tramo) y salida en la siguiente.
    expect(sameSpan(coverage, 61 * MIN, 301 * MIN)).toBe(false);
    // Cada extremo en un tramo distinto.
    expect(sameSpan(coverage, 50 * MIN, 310 * MIN)).toBe(false);
    // Los dos fuera de todo tramo, aunque dentro del mismo hueco.
    expect(sameSpan(coverage, 100 * MIN, 200 * MIN)).toBe(false);
    // El orden de los extremos no importa.
    expect(sameSpan(coverage, 50 * MIN, 10 * MIN)).toBe(true);
    // Sin cobertura declarada no hay con qué juzgar: se admite todo.
    expect(sameSpan([], 61 * MIN, 301 * MIN)).toBe(true);
  });

  it("uncoveredGaps: sin tramos o con uno solo no hay huecos; con tres, dos huecos en orden", () => {
    expect(uncoveredGaps([])).toEqual([]);
    expect(uncoveredGaps([{ from: 0, to: 10 }])).toEqual([]);
    expect(
      uncoveredGaps(
        mergeIntervals([
          { from: 40, to: 50 },
          { from: 0, to: 10 },
          { from: 20, to: 30 },
        ]),
      ),
    ).toEqual([
      { from: 10, to: 20 },
      { from: 30, to: 40 },
    ]);
  });
});
