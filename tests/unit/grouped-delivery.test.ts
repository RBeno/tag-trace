/**
 * Lecturas que llegaron juntas al servidor (R-DAT-020).
 *
 * Lo que se fija, sobre un anillo de seis tags hecho a mano: un hueco seguido de una ráfaga con la
 * suma normal no es una parada y se colapsa en un solo recorrido; con la suma de más, la espera sigue
 * ahí, de P a Q; una parada real seguida de pasos normales no es una ráfaga, ni dos pasos de medio
 * tramo, ni un AGV que va más deprisa que la horquilla de su régimen; con resolución de minuto no se
 * evalúa; y una calle de carga corta la ráfaga.
 */

import { describe, expect, it } from "vitest";

import type { Transition } from "../../src/domain/graph.js";
import { collapseGroupedDeliveries, summarizeDeliveries } from "../../src/domain/grouped-delivery.js";
import { buildSegmentBands, type Regime } from "../../src/domain/segment-bands.js";

const RING = ["A", "B", "C", "D", "E", "F"];
const DAY = (): Regime => "produccion";
const SECOND = 1_000;
const FAST_RATIO = 0.6;
const THRESHOLDS = { minFastSteps: 2 };

/** Seis AGV, veinte vueltas cada uno, 16–18 s por tramo. */
function base(stepSeconds: (lap: number, position: number) => number = (lap, position) => 16 + ((lap + position) % 3)): Transition[] {
  const transitions: Transition[] = [];
  for (let vehicle = 0; vehicle < 6; vehicle += 1) {
    let time = vehicle * 7 * SECOND;
    for (let lap = 0; lap < 20; lap += 1) {
      for (let position = 0; position < RING.length; position += 1) {
        const duration = stepSeconds(lap, position) * SECOND;
        transitions.push({
          agvId: `V${vehicle}`,
          from: RING[position] as string,
          to: RING[(position + 1) % RING.length] as string,
          fromTime: time,
          toTime: time + duration,
          sameInstant: false,
        });
        time += duration;
      }
    }
  }
  return transitions;
}

const BANDS = buildSegmentBands(base(), RING, DAY, { minBandSamples: 20 }, 30 * SECOND);

/** La secuencia de un AGV `Z` por los tags dados, con las horas de llegada dadas (en segundos). */
function sequence(tags: readonly string[], seconds: readonly number[], start = 10_000_000): Transition[] {
  return tags.slice(1).map((to, index) => {
    const fromTime = start + (seconds[index] as number) * SECOND;
    const toTime = start + (seconds[index + 1] as number) * SECOND;
    return { agvId: "Z", from: tags[index] as string, to, fromTime, toTime, sameInstant: fromTime === toTime };
  });
}

describe("lecturas que llegaron juntas (R-DAT-020)", () => {
  it("hueco + ráfaga con la suma normal: no paró, y se colapsa en un solo recorrido de P a Q", () => {
    // A a las 0; B, C y D llegan a los 49, 50 y 51 s: tres tramos de ~17 s que llegaron juntos.
    const own = sequence(["A", "B", "C", "D", "E"], [0, 49, 50, 51, 68]);
    const report = collapseGroupedDeliveries(own, BANDS, DAY, FAST_RATIO, new Set(), THRESHOLDS);
    expect(report.evaluated).toBe(true);
    expect(report.deliveries).toMatchObject([
      { agvId: "Z", fromTagId: "A", tags: ["B", "C", "D"], kind: "sin-parada", gapMs: 49 * SECOND, spreadMs: 2 * SECOND, totalMs: 51 * SECOND },
    ]);
    expect(report.transitions.map((entry) => `${entry.from}${entry.to}`)).toEqual(["AD", "DE"]);
  });

  it("con la suma de más: hubo una espera entre P y Q, sin poder situarla, y sigue siendo parada de P a Q", () => {
    const own = sequence(["A", "B", "C", "D"], [0, 200, 201, 202]);
    const report = collapseGroupedDeliveries(own, BANDS, DAY, FAST_RATIO, new Set(), THRESHOLDS);
    expect(report.deliveries).toMatchObject([{ kind: "con-tiempo-de-mas", totalMs: 202 * SECOND }]);
    expect(report.transitions).toMatchObject([{ from: "A", to: "D", fromTime: 10_000_000, toTime: 10_000_000 + 202 * SECOND }]);
  });

  it("una parada real seguida de pasos normales no es una ráfaga", () => {
    const own = sequence(["A", "B", "C", "D"], [0, 200, 217, 234]);
    const report = collapseGroupedDeliveries(own, BANDS, DAY, FAST_RATIO, new Set(), THRESHOLDS);
    expect(report.deliveries).toEqual([]);
    expect(report.transitions).toHaveLength(3);
  });

  it("dos pasos de medio tramo tras una espera tampoco: juntos cuestan un tramo entero", () => {
    const own = sequence(["A", "B", "C", "D"], [0, 100, 108, 116]);
    expect(collapseGroupedDeliveries(own, BANDS, DAY, FAST_RATIO, new Set(), THRESHOLDS).deliveries).toEqual([]);
  });

  it("con un solo paso rápido no basta", () => {
    const own = sequence(["A", "B", "C", "D"], [0, 49, 50, 67]);
    expect(collapseGroupedDeliveries(own, BANDS, DAY, FAST_RATIO, new Set(), THRESHOLDS).deliveries).toEqual([]);
  });

  it("un AGV que va más deprisa que la horquilla de su régimen no es una ráfaga: el hueco no se lleva el recorrido", () => {
    // Una horquilla lenta (60 s por tramo, como la de noche en un tramo lento) y un AGV que aún va a
    // 17 s: sus pasos parecen imposibles de rápidos, pero el hueco es un tramo normal.
    const slow = buildSegmentBands(base(() => 60), RING, DAY, { minBandSamples: 20 }, 30 * SECOND);
    const fastBands = { ...slow, resolutionMs: 1_000 };
    const own = sequence(["A", "B", "C", "D", "E"], [0, 70, 87, 104, 121]);
    expect(collapseGroupedDeliveries(own, fastBands, DAY, FAST_RATIO, new Set(), THRESHOLDS).deliveries).toEqual([]);
  });

  it("lecturas del mismo instante cuentan como casi seguidas", () => {
    const own = sequence(["A", "B", "C", "D"], [0, 51, 51, 51]);
    const report = collapseGroupedDeliveries(own, BANDS, DAY, FAST_RATIO, new Set(), THRESHOLDS);
    expect(report.deliveries).toMatchObject([{ tags: ["B", "C", "D"], spreadMs: 0, kind: "sin-parada" }]);
  });

  it("un tag de calle de carga corta la ráfaga", () => {
    const own = sequence(["A", "B", "C", "D"], [0, 49, 50, 51]);
    const report = collapseGroupedDeliveries(own, BANDS, DAY, FAST_RATIO, new Set(["C"]), THRESHOLDS);
    expect(report.deliveries).toEqual([]);
  });

  it("con resolución de minuto no se evalúa, y se dice por qué", () => {
    const minuteBands = buildSegmentBands(base(() => 60), RING, DAY, { minBandSamples: 20 }, 30 * SECOND);
    const own = sequence(["A", "B", "C", "D"], [0, 180, 180, 180]);
    const report = collapseGroupedDeliveries(own, minuteBands, DAY, FAST_RATIO, new Set(), THRESHOLDS);
    expect(report.evaluated).toBe(false);
    expect(report.reason).toContain("minuto");
    expect(report.transitions).toBe(own);
  });

  it("el orden de salida es el de entrada, con la ráfaga en el sitio de su primer tramo", () => {
    const own = sequence(["A", "B", "C", "D", "E"], [0, 49, 50, 51, 68]);
    const other: Transition = { agvId: "Y", from: "E", to: "F", fromTime: 10_000_000 + 49_500, toTime: 10_000_000 + 66_000, sameInstant: false };
    const mixed = [own[0] as Transition, other, ...own.slice(1)];
    const report = collapseGroupedDeliveries(mixed, BANDS, DAY, FAST_RATIO, new Set(), THRESHOLDS);
    expect(report.transitions.map((entry) => `${entry.agvId}:${entry.from}${entry.to}`)).toEqual(["Z:AD", "Y:EF", "Z:DE"]);
  });
});

describe("dónde se concentran", () => {
  it("un AGV al que le pasa muchas veces sale; si le pasa a uno cada vez, no", () => {
    const transitions = base();
    const deliveries = [0, 1, 2, 3].map((index) => ({
      agvId: "V1",
      fromTagId: RING[index] as string,
      fromUtcMs: index,
      tags: ["x", "y"],
      arrivedUtcMs: index,
      toUtcMs: index,
      gapMs: 0,
      spreadMs: 0,
      totalMs: 0,
      usualMs: 0,
      fenceMs: 0,
      regime: "produccion" as const,
      kind: "sin-parada" as const,
    }));
    const summary = summarizeDeliveries(deliveries, transitions, 0.01);
    expect(summary.vehicles.map((entry) => entry.id)).toEqual(["V1"]);
    expect(summary.sites).toEqual([]);
  });
});
