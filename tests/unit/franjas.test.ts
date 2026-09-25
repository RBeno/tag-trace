/**
 * La medición de cada fichero y la posición en tiempo de cada tag (R-TIM-011).
 *
 * Lo que se fija: la posición es la suma de medianas desde el ancla, salta un tag sin medir con la
 * mediana del salto directo y nunca interpola; los ficheros se ordenan y un repetido se mide una vez;
 * cada franja rota su anillo al ancla del circuito; y un tramo cambia entre ficheros como escalón,
 * deriva o, con dos, sin distinguir, siempre con la regla de las horquillas.
 */

import { describe, expect, it } from "vitest";

import {
  franjaCsv,
  franjaWindows,
  measureFranjaCohort,
  segmentHistories,
  timePositions,
  type FranjaBand,
} from "../../src/domain/franjas.js";
import type { Transition } from "../../src/domain/graph.js";
import type { Regime } from "../../src/domain/segment-bands.js";

const SECOND = 1_000;
const DAY = (): Regime => "produccion";

/** `count` pasos de `from` a `to` de `seconds` cada uno, de vehículos distintos. */
function steps(from: string, to: string, seconds: number, count = 5, start = 0): Transition[] {
  return Array.from({ length: count }, (_, index) => ({
    agvId: `V${index}`,
    from,
    to,
    fromTime: start + index * 60 * SECOND,
    toTime: start + index * 60 * SECOND + seconds * SECOND,
    sameInstant: false,
  }));
}

describe("posición en tiempo (R-TIM-011)", () => {
  const ring = ["A", "B", "C", "D", "E"];
  // C no se lee nunca: los AGV van de B a D directamente.
  const transitions = [...steps("A", "B", 10), ...steps("B", "D", 20), ...steps("D", "E", 10), ...steps("E", "A", 10)];

  it("suma medianas desde el ancla y salta un tag sin medir con el salto directo", () => {
    const { positions, lapMs } = timePositions(transitions, ring, 4, 2);
    expect(positions.map((entry) => entry.offsetMs)).toEqual([0, 10 * SECOND, null, 30 * SECOND, 40 * SECOND]);
    expect(lapMs).toBe(50 * SECOND);
  });

  it("sin salto permitido, lo que viene detrás de un tag sin medir queda desconocido: nunca se interpola", () => {
    const { positions, lapMs } = timePositions(transitions, ring, 4, 0);
    expect(positions.map((entry) => entry.offsetMs)).toEqual([0, 10 * SECOND, null, null, null]);
    expect(lapMs).toBeNull();
  });

  it("con menos pasos de los necesarios, tampoco", () => {
    const few = [...steps("A", "B", 10, 3), ...steps("B", "C", 10), ...steps("C", "D", 10), ...steps("D", "E", 10)];
    expect(timePositions(few, ring, 4, 2).positions.map((entry) => entry.offsetMs)).toEqual([0, null, null, null, null]);
  });

  it("los pares del mismo instante no miden ningún paso", () => {
    const same = steps("A", "B", 0).map((entry) => ({ ...entry, sameInstant: true }));
    expect(timePositions([...same, ...steps("B", "C", 10)], ["A", "B", "C"], 4, 0).positions[1]?.offsetMs).toBeNull();
  });
});

describe("franjas: un fichero cada una", () => {
  it("en orden de inicio; sin ventana completa no se mide; uno repetido se marca", () => {
    const windows = franjaWindows([
      { sourceId: "s2", sourceHash: "h2", fileName: "b.csv", complete: { from: 200, to: 300 } },
      { sourceId: "s1", sourceHash: "h1", fileName: "a.csv", complete: { from: 0, to: 100 } },
      { sourceId: "s3", sourceHash: "h1", fileName: "a-otra-vez.csv", complete: { from: 0, to: 100 } },
      { sourceId: "s4", sourceHash: "h4", fileName: "vacio.csv", complete: null },
    ]);
    expect(windows.map((entry) => [entry.source.sourceId, entry.duplicateOf])).toEqual([
      ["s1", null],
      ["s3", "s1"],
      ["s2", null],
    ]);
  });

  it("cada franja rota su anillo al ancla del circuito, y mide solo lo que cae en su ventana", () => {
    const lap = (start: number) => [
      ...steps("A", "B", 10, 5, start),
      ...steps("B", "C", 10, 5, start),
      ...steps("C", "D", 10, 5, start),
      ...steps("D", "A", 10, 5, start),
    ];
    const early = lap(0);
    const late = lap(10_000 * SECOND);
    const all = [...early, ...late];
    const measure = measureFranjaCohort(
      { cohortId: 1, transitions: all, measured: all, anchorTagId: "C" },
      { from: 0, to: 1_000 * SECOND },
      DAY,
      { minBandSamples: 5 },
      30 * SECOND,
      { minPositionSamples: 4 },
      2,
    );
    expect(measure.ring[0]).toBe("C");
    expect(measure.anchorShared).toBe(true);
    expect(measure.positions.map((entry) => entry.offsetMs)).toEqual([0, 10 * SECOND, 20 * SECOND, 30 * SECOND]);
    expect(measure.lapMs).toBe(40 * SECOND);
    expect(measure.bands.every((row) => row.produccion?.samples === 5)).toBe(true);
    const missing = measureFranjaCohort(
      { cohortId: 1, transitions: all, measured: all, anchorTagId: "Z" },
      { from: 0, to: 1_000 * SECOND },
      DAY,
      { minBandSamples: 5 },
      30 * SECOND,
      { minPositionSamples: 4 },
      2,
    );
    expect(missing.anchorShared).toBe(false);
  });
});

describe("historia de cada tramo entre ficheros", () => {
  const band = (p50: number, p80: number): FranjaBand => ({
    from: "A",
    to: "B",
    produccion: { samples: 30, p50Ms: p50 * SECOND, p80Ms: p80 * SECOND, p95Ms: (p80 + 2) * SECOND, fenceMs: (p80 + 32) * SECOND },
    noche: null,
    firstSeenUtcMs: 0,
    lastSeenUtcMs: 0,
  });
  const series = (...values: readonly (readonly [number, number])[]) =>
    values.map(([p50, p80], index) => ({ sourceId: `f${index + 1}`, bands: [band(p50, p80)] }));

  it("con dos ficheros, un cambio sin distinguir escalón de deriva", () => {
    expect(segmentHistories(series([16, 18], [30, 33]))).toMatchObject([
      { from: "A", to: "B", regime: "produccion", kind: "cambio", direction: "mas-lento", atSourceId: "f2" },
    ]);
  });

  it("un único salto que se mantiene es un escalón, en el fichero donde empieza", () => {
    expect(segmentHistories(series([16, 18], [30, 33], [31, 34]))).toMatchObject([
      { kind: "escalon", direction: "mas-lento", atSourceId: "f2" },
    ]);
  });

  it("sin saltos entre seguidos pero moviéndose siempre hacia el mismo lado es una deriva", () => {
    expect(segmentHistories(series([16, 18], [18, 20], [20, 22]))).toMatchObject([
      { kind: "deriva", direction: "mas-lento", atSourceId: null },
    ]);
  });

  it("un salto que vuelve atrás no es nada", () => {
    expect(segmentHistories(series([16, 18], [30, 33], [16, 18]))).toEqual([]);
  });

  it("dentro de la variación normal, nada", () => {
    expect(segmentHistories(series([16, 18], [17, 19], [16, 18]))).toEqual([]);
  });
});

describe("el fichero en CSV", () => {
  it("una fila por tramo y régimen, con primera y última vez y la posición del tag de salida", () => {
    const csv = franjaCsv(
      {
        cohortId: 1,
        ring: ["A", "B"],
        anchorTagId: "A",
        anchorShared: true,
        positions: [
          { tagId: "A", offsetMs: 0, samples: 0 },
          { tagId: "B", offsetMs: 16_500, samples: 30 },
        ],
        lapMs: 33_000,
        resolutionMs: 1_000,
        bands: [
          {
            from: "B",
            to: "A",
            produccion: { samples: 30, p50Ms: 16_500, p80Ms: 19_000, p95Ms: 20_000, fenceMs: 50_000 },
            noche: null,
            firstSeenUtcMs: 1,
            lastSeenUtcMs: 2,
          },
        ],
      },
      (utcMs) => `t${utcMs}`,
    );
    expect(csv.split("\r\n")).toEqual([
      "desde;hasta;regimen;muestras;p50_s;p80_s;p95_s;valla_s;primera;ultima;posicion_desde_s",
      "B;A;produccion;30;16,5;19,0;20,0;50,0;t1;t2;16,5",
    ]);
  });
});
