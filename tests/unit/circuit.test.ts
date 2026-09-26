/**
 * Cobertura, unión y hash semántico: las tres piezas que convierten «importar un fichero» en
 * «acumular un circuito».
 *
 * Cubre TC-015 (solape entre exportaciones), TC-021 (solape que contiene una maniobra A→B→A),
 * INV-005 (una copia solapada no duplica métricas pero conserva procedencia) e INV-010 (mismo
 * estado, mismo hash).
 */

import { describe, expect, it } from "vitest";

import {
  isCovered,
  mergeIntervals,
  sourceCoverage,
  uncoveredGaps,
} from "../../src/domain/coverage.js";
import { canonicalise, semanticHash } from "../../src/domain/semantic-hash.js";
import { unionReadings } from "../../src/ingestion/union.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";

function reading(utcMs: number, agvId: string, tagId: string, source: string, row: number): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: source, sourceHash: source, sourceRow: row },
  };
}

describe("cobertura · R-DAT-007", () => {
  it("la cobertura termina en el último instante completo, no en el último leído", () => {
    // El instante final de una exportación es el momento en que se pulsó el botón: casi nunca
    // está entero, porque faltan las lecturas de ese mismo segundo que aún no habían llegado.
    const readings = [
      reading(1000, "0007", "A", "s", 2),
      reading(2000, "0007", "B", "s", 3),
      reading(3000, "0007", "C", "s", 4),
    ];
    expect(sourceCoverage(readings)).toEqual({ complete: { from: 1000, to: 2000 }, partialFrom: 3000 });
  });

  it("una fuente con un solo instante no aporta ningún tramo analizable", () => {
    const readings = [reading(1000, "0007", "A", "s", 2), reading(1000, "0008", "B", "s", 3)];
    expect(sourceCoverage(readings)).toEqual({ complete: null, partialFrom: 1000 });
  });

  it("lo que queda entre dos fuentes disjuntas no está cubierto, y por tanto no es un silencio", () => {
    const coverage = mergeIntervals([
      { from: 1000, to: 2000 },
      { from: 9000, to: 9500 },
    ]);
    expect(coverage).toHaveLength(2);
    expect(isCovered(coverage, 1500)).toBe(true);
    expect(isCovered(coverage, 5000)).toBe(false);
    expect(uncoveredGaps(coverage)).toEqual([{ from: 2000, to: 9000 }]);
  });

  it("los intervalos que se tocan se funden en uno solo", () => {
    expect(
      mergeIntervals([
        { from: 100, to: 300 },
        { from: 200, to: 500 },
      ]),
    ).toEqual([{ from: 100, to: 500 }]);
  });
});

describe("TC-015 · unión de dos exportaciones solapadas", () => {
  // La primera va de 1000 a 4000; la segunda de 2000 a 6000. El tramo común es 2000–3000, porque
  // el último instante de cada una queda fuera por venir cortado.
  const primera = [
    reading(1000, "0007", "A", "s1", 2),
    reading(2000, "0007", "B", "s1", 3),
    reading(3000, "0007", "C", "s1", 4),
    reading(4000, "0007", "D", "s1", 5),
  ];
  const segunda = [
    reading(2000, "0007", "B", "s2", 2),
    reading(3000, "0007", "C", "s2", 3),
    reading(4000, "0007", "D", "s2", 4),
    reading(6000, "0007", "E", "s2", 5),
  ];

  it("el solape se cuenta una vez y conserva las dos procedencias", () => {
    const result = unionReadings(primera, segunda);
    // El tramo que se *juzga* llega hasta 3000, porque más allá alguna de las dos va cortada.
    expect(result.overlap).toEqual({ from: 2000, to: 3000 });
    // Pero se *empareja* hasta 4000: B, C y D están en las dos y se cuentan una vez cada uno.
    expect(result.shared).toBe(3);
    expect(result.disagreements).toBe(0);
    // Cinco eventos distintos, no ocho.
    expect(result.readings).toHaveLength(5);
    expect(result.readings.map((entry) => entry.tagId)).toEqual(["A", "B", "C", "D", "E"]);
    const compartido = result.readings.find((entry) => entry.tagId === "B");
    expect(compartido?.provenance.sourceId).toBe("s1");
    expect(compartido?.alsoFrom.map((p) => p.sourceId)).toEqual(["s2"]);
  });

  it("INV-005 · volver a cargar el mismo fichero no cambia ninguna cifra", () => {
    const result = unionReadings(primera, primera);
    expect(result.readings).toHaveLength(primera.length);
    expect(result.disagreements).toBe(0);
  });

  it("dos exportaciones disjuntas no inventan solape y dejan el hueco al descubierto", () => {
    const lejana = [
      reading(90_000, "0007", "X", "s3", 2),
      reading(91_000, "0007", "Y", "s3", 3),
      reading(92_000, "0007", "Z", "s3", 4),
    ];
    const result = unionReadings(primera, lejana);
    expect(result.overlap).toBeNull();
    expect(result.shared).toBe(0);
    expect(result.readings).toHaveLength(7);
  });

  it("un desacuerdo dentro del tramo común se cuenta, no se resuelve en silencio", () => {
    // La segunda no trae la lectura de las 3000 que la primera sí tiene, y ambas la cubren.
    const incompleta = [
      reading(2000, "0007", "B", "s2", 2),
      reading(4000, "0007", "D", "s2", 3),
      reading(6000, "0007", "E", "s2", 4),
    ];
    const result = unionReadings(primera, incompleta);
    expect(result.disagreements).toBeGreaterThan(0);
    // Y la lectura discrepante se conserva: no se descarta por no estar en las dos.
    expect(result.readings.some((entry) => entry.tagId === "C")).toBe(true);
  });
});

describe("TC-021 · el solape conserva la maniobra A→B→A", () => {
  // El caso que hace inaceptable deduplicar por huella de fila: la misma tripleta aparece dos
  // veces de forma legítima, con otro tag del mismo AGV entre medias.
  const maniobra = (source: string) => [
    reading(1000, "0007", "A", source, 2),
    reading(2000, "0007", "A", source, 3),
    reading(2000, "0007", "B", source, 4),
    reading(2000, "0007", "A", source, 5),
    reading(3000, "0007", "C", source, 6),
  ];

  it("la tripleta repetida sigue apareciendo dos veces tras unir", () => {
    const result = unionReadings(maniobra("s1"), maniobra("s2"));
    const enElInstante = result.readings.filter(
      (entry) => entry.time.utcMs === 2000 && entry.tagId === "A",
    );
    expect(enElInstante).toHaveLength(2);
    expect(result.disagreements).toBe(0);
  });
});

describe("hash semántico · INV-010", () => {
  it("el orden de las claves no cambia el hash", async () => {
    const uno = await semanticHash({ b: 2, a: 1 });
    const otro = await semanticHash({ a: 1, b: 2 });
    expect(uno).toBe(otro);
  });

  it("un estado distinto da un hash distinto", async () => {
    expect(await semanticHash({ a: 1 })).not.toBe(await semanticHash({ a: 2 }));
  });

  it("dos caminos que dan el mismo número producen la misma cadena", () => {
    // Sin canonicalización numérica, 0.1 + 0.2 y 0.3 romperían el invariante sin que nada esté mal.
    expect(canonicalise(0.1 + 0.2)).toBe(canonicalise(0.3));
  });

  it("una clave ausente y una clave indefinida son el mismo estado", () => {
    expect(canonicalise({ a: 1, b: undefined })).toBe(canonicalise({ a: 1 }));
  });

  it("un valor no finito se rechaza en lugar de hashearse", () => {
    expect(() => canonicalise({ a: Number.NaN })).toThrow(TypeError);
    expect(() => canonicalise({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });
});

describe("unión encadenada · R-DAT-005", () => {
  it("tres cortes solapados conservan las tres procedencias del evento común", () => {
    // La unión se encadena sobre el acumulado; reconstruir `alsoFrom` en cada paso tiraba la
    // procedencia de todas las exportaciones menos la última.
    const corte = (source: string): Reading[] => [
      reading(1000, "0007", "A", source, 2),
      reading(2000, "0007", "B", source, 3),
      reading(3000, "0007", "C", source, 4),
    ];
    const dos = unionReadings(corte("s1"), corte("s2"));
    const tres = unionReadings(dos.readings, corte("s3"));

    expect(tres.readings).toHaveLength(3);
    const a = tres.readings.find((entry) => entry.tagId === "A");
    expect(a?.provenance.sourceId).toBe("s1");
    expect(a?.alsoFrom.map((p) => p.sourceId)).toEqual(["s2", "s3"]);
  });
});

describe("hash semántico · tipos que no se serializan", () => {
  it("un Map, un Set o un Date se rechazan en vez de hashearse como {}", () => {
    // `Object.entries` de los tres es vacío: dos estados distintos daban el mismo hash (INV-010).
    expect(() => canonicalise(new Map([["a", 1]]))).toThrow(TypeError);
    expect(() => canonicalise({ x: new Set([1]) })).toThrow(TypeError);
    expect(() => canonicalise([new Date(0)])).toThrow(TypeError);
  });
});
