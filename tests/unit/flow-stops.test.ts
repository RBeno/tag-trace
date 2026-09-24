/**
 * Paradas leídas contra el flujo (R-AGV-018).
 *
 * Lo que se fija, con un anillo de 40 tags hecho a mano y AGV que avanzan un tag cada 20 s:
 *
 * - el primero de una cola que no avanza 5 min, con los tags críticos leyéndose, es un bloqueo con
 *   los tres de detrás, y los de detrás están «en cola» con él como cabeza;
 * - una cola que avanza cada 40 s no deja ningún bloqueo;
 * - si nadie lee los tags críticos durante 15 min, la producción estuvo parada: todas las paradas
 *   quedan justificadas, todos siguen por su sitio y en el mismo orden;
 * - sin tags críticos declarados se usa la flota, y se dice;
 * - una parada a la misma hora dos días seguidos se marca como repetida;
 * - una transición de calle de carga no es una parada.
 */

import { describe, expect, it } from "vitest";

import {
  flowStops,
  outsideProductionStops,
  productionStops,
  type FlowStopThresholds,
} from "../../src/domain/flow-stops.js";
import type { Transition } from "../../src/domain/graph.js";
import type { Reading } from "../../src/domain/reading.js";
import { usualSegmentTimes } from "../../src/domain/silence-kind.js";

const THRESHOLDS: FlowStopThresholds = {
  headStallMs: 2 * 60_000,
  minProductionStopMs: 2 * 60_000,
  minStopExcessMs: 30_000,
  reachTags: 2,
  maxFalseStops: 0.01,
  sameTimeToleranceMs: 15 * 60_000,
  minPairSamples: 4,
};
const SHIFTS = [6, 14, 22];
const ZONE = "UTC";
const RING = Array.from({ length: 40 }, (_, index) => `T${index}`);
const STEP = 20_000;
const CRITICAL = new Set(["T15", "T30"]);

interface Plan {
  readonly agvId: string;
  readonly startTag: number;
  readonly offsetMs: number;
  /** Tiempo de más en la transición que sale del paso `step`. */
  readonly pauses?: ReadonlyMap<number, number>;
}

/** Cada AGV recorre el anillo un tag cada 20 s, 180 pasos, con las esperas que se le digan. */
function drive(plans: readonly Plan[], steps = 180): { readings: Reading[]; transitions: Transition[] } {
  const readings: Reading[] = [];
  const transitions: Transition[] = [];
  let row = 0;
  for (const plan of plans) {
    let time = plan.offsetMs;
    let previous: { tag: string; time: number } | null = null;
    for (let step = 0; step < steps; step += 1) {
      const tag = RING[(plan.startTag + step) % RING.length] as string;
      row += 1;
      readings.push({
        time: { utcMs: time, raw: String(time), zone: ZONE, flag: "ok" },
        agvId: plan.agvId,
        tagId: tag,
        provenance: { sourceId: "s", sourceHash: "h", sourceRow: row },
      });
      if (previous !== null) {
        transitions.push({ agvId: plan.agvId, from: previous.tag, to: tag, fromTime: previous.time, toTime: time, sameInstant: false });
      }
      previous = { tag, time };
      time += STEP + (plan.pauses?.get(step) ?? 0);
    }
  }
  return { readings, transitions };
}

function analyse(plans: readonly Plan[], critical: ReadonlySet<string> = CRITICAL, laneTags: ReadonlySet<string> = new Set()) {
  const { readings, transitions } = drive(plans);
  const coverage = [{ from: 0, to: Math.max(...readings.map((reading) => reading.time.utcMs)) }];
  const production = productionStops(readings, critical, coverage, ZONE, SHIFTS, THRESHOLDS);
  const usual = usualSegmentTimes(outsideProductionStops(transitions, production.stops), RING, ZONE, SHIFTS);
  const flow = flowStops(
    { transitions, coverage, usual, production, laneTags, functionOf: new Map([["T10", "semaforo"]]), zone: ZONE, shiftStartHours: SHIFTS },
    THRESHOLDS,
  );
  return { production, flow };
}

/** A las 1.800 s (paso 90), H está en T10 y tres le siguen de cerca; O1 y O2 van por delante, lejos. */
function queue(headPauseMs: number): Plan[] {
  const follow = (agvId: string, behind: number, extraMs: number): Plan => ({
    agvId,
    startTag: RING.length - behind,
    offsetMs: behind * 5_000,
    pauses: new Map([[90, extraMs]]),
  });
  return [
    { agvId: "H", startTag: 0, offsetMs: 0, pauses: new Map([[90, headPauseMs]]) },
    follow("F1", 1, headPauseMs + 5_000),
    follow("F2", 2, headPauseMs + 10_000),
    follow("F3", 3, headPauseMs + 15_000),
    { agvId: "O1", startTag: 2, offsetMs: 0 },
    { agvId: "O2", startTag: 10, offsetMs: 0 },
  ];
}

describe("paradas contra el flujo", () => {
  it("el primero de la cola sin avanzar 5 min, con la producción en marcha, es un bloqueo con los tres de detrás", () => {
    const { production, flow } = analyse(queue(5 * 60_000));
    expect(production.stops).toEqual([]);
    expect(flow.blockages).toHaveLength(1);
    const blockage = flow.blockages[0];
    expect(blockage).toMatchObject({ agvId: "H", tagId: "T10", nextTagId: "T11", functionAtTag: "semaforo" });
    expect([...(blockage?.behind ?? [])].sort()).toEqual(["F1", "F2", "F3"]);
    expect(blockage?.basisReads).toBeGreaterThan(0);
    const f3 = flow.stops.find((stop) => stop.agvId === "F3");
    expect(f3).toMatchObject({ justification: "cola", headAgvId: "H" });
  });

  it("una cola que avanza cada 40 s no deja ningún bloqueo", () => {
    const { flow } = analyse(queue(40_000));
    expect(flow.blockages).toEqual([]);
  });

  it("15 min sin lecturas críticas: producción parada, todo justificado, todos por su sitio y en orden", () => {
    const all = queue(0).map((plan) => ({ ...plan, pauses: new Map([[90, 15 * 60_000]]) }));
    const { production, flow } = analyse(all);
    expect(production.basis).toBe("criticos");
    expect(production.stops).toHaveLength(1);
    expect(flow.stops.every((stop) => stop.justification === "produccion")).toBe(true);
    expect(flow.blockages).toEqual([]);
    expect(flow.productionFlow[0]).toMatchObject({ vehicles: 6, inPlace: 6, notInPlace: [], orderKept: true });
  });

  it("si uno que iba detrás aparece delante tras la parada, se dice quién pasó a quién", () => {
    // Todos parados 15 min; F1, que iba un tag detrás de H, vuelve cuatro tags más allá (se saltó la
    // lectura de tres) y aparece delante de H, que vuelve por el siguiente.
    const all = queue(0).map((plan) => ({ ...plan, pauses: new Map([[90, 15 * 60_000]]) }));
    const { readings, transitions } = drive(all);
    const jumped = transitions.map((transition) =>
      transition.agvId === "F1" && transition.fromTime > 1_800_000 && transition.toTime - transition.fromTime > 10 * 60_000
        ? { ...transition, to: "T13" }
        : transition,
    );
    const coverage = [{ from: 0, to: Math.max(...readings.map((reading) => reading.time.utcMs)) }];
    const production = productionStops(readings, CRITICAL, coverage, ZONE, SHIFTS, THRESHOLDS);
    const usual = usualSegmentTimes(outsideProductionStops(jumped, production.stops), RING, ZONE, SHIFTS);
    const flow = flowStops(
      { transitions: jumped, coverage, usual, production, laneTags: new Set(), functionOf: new Map(), zone: ZONE, shiftStartHours: SHIFTS },
      THRESHOLDS,
    );
    expect(flow.productionFlow[0]?.orderKept).toBe(false);
    expect(flow.productionFlow[0]?.orderChanges).toContainEqual({ agvId: "F1", passed: "H" });
  });

  it("sin tags críticos declarados, la base es la flota entera, y se dice", () => {
    const all = queue(0).map((plan) => ({ ...plan, pauses: new Map([[90, 15 * 60_000]]) }));
    const { production } = analyse(all, new Set());
    expect(production.basis).toBe("flota");
    expect(production.stops).toHaveLength(1);
  });

  it("un hueco crítico corto, o probable por azar, no es una parada de la producción", () => {
    // Con dos tags críticos y seis AGV, un hueco de 3 min entre lecturas críticas sale por puro azar.
    const { production } = analyse(queue(3 * 60_000));
    expect(production.stops).toEqual([]);
  });

  it("una parada a la misma hora local dos días seguidos se marca como repetida", () => {
    const day = 86_400_000;
    const at = (d: number, hour: number, minute: number) => d * day + hour * 3_600_000 + minute * 60_000;
    const readings: Reading[] = [];
    for (let time = 0; time < 2 * day; time += 30_000) {
      const inBreak = [0, 1].some((d) => time >= at(d, 10, 0) && time < at(d, 10, 20));
      if (inBreak) continue;
      readings.push({
        time: { utcMs: time, raw: String(time), zone: ZONE, flag: "ok" },
        agvId: "A",
        tagId: "T15",
        provenance: { sourceId: "s", sourceHash: "h", sourceRow: readings.length + 1 },
      });
    }
    const report = productionStops(readings, CRITICAL, [{ from: 0, to: 2 * day }], ZONE, SHIFTS, THRESHOLDS);
    expect(report.stops).toHaveLength(2);
    expect(report.stops[0]?.sameTimeOn).toEqual([report.stops[1]?.fromUtcMs]);
    expect(report.stops[1]?.sameTimeOn).toEqual([report.stops[0]?.fromUtcMs]);
  });

  it("una transición que salta el hueco entre dos exportaciones no es una parada de nadie", () => {
    const { readings, transitions } = drive(queue(5 * 60_000));
    const end = Math.max(...readings.map((reading) => reading.time.utcMs));
    // El hueco entre las dos exportaciones cae justo donde H está parado.
    const coverage = [
      { from: 0, to: 1_810_000 },
      { from: 2_090_000, to: end },
    ];
    const production = productionStops(readings, CRITICAL, coverage, ZONE, SHIFTS, THRESHOLDS);
    const usual = usualSegmentTimes(transitions, RING, ZONE, SHIFTS);
    const flow = flowStops(
      { transitions, coverage, usual, production, laneTags: new Set(), functionOf: new Map(), zone: ZONE, shiftStartHours: SHIFTS },
      THRESHOLDS,
    );
    expect(flow.blockages).toEqual([]);
  });

  it("una transición de calle de carga no es una parada", () => {
    const { flow } = analyse(queue(5 * 60_000), CRITICAL, new Set(["T10", "T11"]));
    expect(flow.stops.some((stop) => stop.fromTagId === "T10" || stop.toTagId === "T11")).toBe(false);
  });
});
