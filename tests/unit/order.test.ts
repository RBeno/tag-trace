/**
 * Orden canónico (`src/domain/order.ts`, ADR-0013): pruebas propias, de caracterización.
 *
 * `importer.test.ts` ya fija lo esencial (la pila invierte el desempate, el comparador nunca da cero
 * para filas distintas, el instante manda sobre la fila). Aquí se fija lo que faltaba (revisión del
 * 2026-10-18, B-15): el hash de la fuente desempata antes que la fila y sin mirar el sentido; el sentido
 * `unknown` desempata como `oldest-first`; una lectura comparada consigo misma da cero; `sortReadings`
 * ordena en su sitio; y el orden no depende de cómo lleguen las lecturas, que es lo que el dominio da
 * por supuesto al ordenar después solo por instante (B-10).
 */

import { describe, expect, it } from "vitest";

import { compareReadings, sortReadings, type SourceDirection } from "../../src/domain/order.js";
import type { Reading } from "../../src/domain/reading.js";

function reading(utcMs: number, sourceHash: string, sourceRow: number, tagId: string): Reading {
  return { time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" }, agvId: "0007", tagId, provenance: { sourceId: sourceHash, sourceHash, sourceRow } };
}

describe("orden canónico · bordes de order.ts (TC-385)", () => {
  it("a igual instante desempata el hash de la fuente, en orden de texto y en los dos sentidos, antes que la fila", () => {
    const a = reading(1000, "aaa", 9, "A");
    const b = reading(1000, "bbb", 2, "B");
    for (const direction of ["oldest-first", "newest-first", "unknown"] as const) {
      expect(compareReadings(a, b, direction)).toBeLessThan(0);
      expect(compareReadings(b, a, direction)).toBeGreaterThan(0);
    }
  });

  it("con el sentido `unknown` la fila desempata como en `oldest-first`; una lectura consigo misma da cero", () => {
    const first = reading(1000, "h", 2, "A");
    const second = reading(1000, "h", 3, "B");
    expect(Math.sign(compareReadings(first, second, "unknown"))).toBe(Math.sign(compareReadings(first, second, "oldest-first")));
    expect(compareReadings(first, second, "unknown")).toBeLessThan(0);
    // Con la pila sale −0 (la fila invertida): para `sort` es cero igual.
    expect(compareReadings(first, first, "newest-first") === 0).toBe(true);
    expect(compareReadings(first, first, "oldest-first")).toBe(0);
  });

  it("sortReadings ordena en su sitio y devuelve el mismo array", () => {
    const list = [reading(2000, "h", 2, "B"), reading(1000, "h", 3, "A")];
    const out = sortReadings(list, "oldest-first");
    expect(out).toBe(list);
    expect(list.map((entry) => entry.tagId)).toEqual(["A", "B"]);
  });

  it("el orden no depende de cómo lleguen las lecturas: mismo resultado desde cualquier permutación, con empates de instante entre fuentes y filas", () => {
    const readings = [
      reading(1000, "h1", 4, "P"),
      reading(2000, "h1", 5, "U"),
      reading(2000, "h1", 6, "Q"),
      reading(2000, "h0", 7, "X"),
      reading(3000, "h1", 2, "R"),
    ];
    const permutations = (items: readonly Reading[]): Reading[][] =>
      items.length <= 1 ? [[...items]] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
    const expected: Record<SourceDirection, string[]> = {
      "oldest-first": ["P", "X", "U", "Q", "R"],
      "newest-first": ["P", "X", "Q", "U", "R"],
      unknown: ["P", "X", "U", "Q", "R"],
    };
    for (const direction of ["oldest-first", "newest-first", "unknown"] as const) {
      const outcomes = new Set(permutations(readings).map((input) => sortReadings(input, direction).map((entry) => entry.tagId).join(",")));
      expect([...outcomes]).toEqual([expected[direction].join(",")]);
    }
  });
});
