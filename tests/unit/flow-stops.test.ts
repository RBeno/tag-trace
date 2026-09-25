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
import type { Interval } from "../../src/domain/coverage.js";
import type { Transition } from "../../src/domain/graph.js";
import type { Reading } from "../../src/domain/reading.js";
import { buildSegmentBands, measurableTransitions, type Regime } from "../../src/domain/segment-bands.js";

const THRESHOLDS: FlowStopThresholds = {
  headStallMs: 2 * 60_000,
  minProductionStopMs: 2 * 60_000,
  minStopExcessMs: 30_000,
  reachTags: 2,
  maxFalseStops: 0.01,
  sameTimeToleranceMs: 15 * 60_000,
  minPairSamples: 4,
};
/** Todo en producción: la noche se prueba aparte. */
const DAY = (): Regime => "produccion";
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

/** La horquilla de cada tramo, como la construye el Worker: sin paradas de la producción. */
function bandsOf(
  transitions: readonly Transition[],
  stops: ReturnType<typeof productionStops>["stops"],
  coverage: readonly Interval[],
  laneTags: ReadonlySet<string> = new Set(),
  regimeOf: (utcMs: number) => Regime = DAY,
) {
  const timed = measurableTransitions(outsideProductionStops(transitions, stops), coverage, laneTags);
  return buildSegmentBands(timed, RING, regimeOf, { minBandSamples: 20 }, THRESHOLDS.minStopExcessMs);
}

function analyse(
  plans: readonly Plan[],
  critical: ReadonlySet<string> = CRITICAL,
  laneTags: ReadonlySet<string> = new Set(),
  steps = 180,
) {
  const { readings, transitions } = drive(plans, steps);
  const coverage = [{ from: 0, to: Math.max(...readings.map((reading) => reading.time.utcMs)) }];
  const production = productionStops(readings, critical, coverage, ZONE, SHIFTS, THRESHOLDS);
  const bands = bandsOf(transitions, production.stops, coverage, laneTags);
  const flow = flowStops(
    { transitions, coverage, bands, regimeOf: DAY, production, laneTags, functionOf: new Map([["T10", "semaforo"]]) },
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
    const bands = bandsOf(jumped, production.stops, coverage);
    const flow = flowStops(
      { transitions: jumped, coverage, bands, regimeOf: DAY, production, laneTags: new Set(), functionOf: new Map() },
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
    const bands = bandsOf(transitions, [], coverage);
    const flow = flowStops(
      { transitions, coverage, bands, regimeOf: DAY, production, laneTags: new Set(), functionOf: new Map() },
      THRESHOLDS,
    );
    expect(flow.blockages).toEqual([]);
  });

  it("una transición de calle de carga no es una parada", () => {
    const { flow } = analyse(queue(5 * 60_000), CRITICAL, new Set(["T10", "T11"]));
    expect(flow.stops.some((stop) => stop.fromTagId === "T10" || stop.toTagId === "T11")).toBe(false);
  });
});

describe("paradas contra la horquilla (R-FLO-007)", () => {
  it("80 s donde se tarda 20, sin nadie que lo retenga y con el de delante avanzando: parada sin explicación", () => {
    // Cuatro AGV repartidos por el anillo; A se para 60 s de más una vez.
    const plans: Plan[] = [
      { agvId: "A", startTag: 0, offsetMs: 0, pauses: new Map([[90, 60_000]]) },
      { agvId: "B", startTag: 10, offsetMs: 0 },
      { agvId: "C", startTag: 20, offsetMs: 0 },
      { agvId: "D", startTag: 30, offsetMs: 0 },
    ];
    const { flow } = analyse(plans, CRITICAL, new Set(), 400);
    const stop = flow.stops.find((entry) => entry.agvId === "A");
    expect(stop).toMatchObject({ justification: "sin-explicacion", fromTagId: "T10", regime: "produccion" });
    expect(stop?.aheadEvidence).toMatchObject({ agvId: "B", distanceAtStart: 10 });
    expect(stop?.aheadEvidence?.tagsAdvanced).toBeGreaterThanOrEqual(3);
    // No llega a bloqueo: un minuto de más no son dos.
    expect(flow.blockages).toEqual([]);
  });

  it("detrás de uno que va lento pero dentro de lo normal, el que espera está en cola, no sin explicación", () => {
    // H tarda 48 s en T10→T11: por encima del p80 (20 s) y por debajo de la valla (50 s), no es
    // parada. F1, un tag detrás, espera 60 s de más: esa sí es parada, y la explica H.
    const plans: Plan[] = [
      { agvId: "H", startTag: 0, offsetMs: 0, pauses: new Map([[90, 28_000]]) },
      { agvId: "F1", startTag: RING.length - 1, offsetMs: 5_000, pauses: new Map([[90, 60_000]]) },
      { agvId: "O", startTag: 20, offsetMs: 0 },
    ];
    const { flow } = analyse(plans, CRITICAL, new Set(), 400);
    expect(flow.stops.some((entry) => entry.agvId === "H")).toBe(false);
    const follower = flow.stops.find((entry) => entry.agvId === "F1");
    expect(follower).toMatchObject({ justification: "cola", aheadAgvId: "H", headAgvId: "H" });
    expect(flow.retentions).toContainEqual(expect.objectContaining({ agvId: "F1", holderAgvId: "H", holderTagId: "T10", stop: true }));
  });

  it("de noche se mide contra la horquilla de noche: su lentitud no es una parada", () => {
    // Todos van 40 s más lentos en cada paso a partir del paso 200, que es «de noche».
    const slow = new Map(Array.from({ length: 200 }, (_, index) => [200 + index, 40_000] as const));
    const plans: Plan[] = queue(0).map((plan) => ({ ...plan, pauses: slow }));
    const { readings, transitions } = drive(plans, 400);
    const coverage = [{ from: 0, to: Math.max(...readings.map((reading) => reading.time.utcMs)) }];
    const nightFrom = 200 * STEP + 60_000;
    const regimeOf = (utcMs: number): Regime => (utcMs >= nightFrom ? "noche" : "produccion");
    const production = productionStops(readings, new Set(), coverage, ZONE, SHIFTS, THRESHOLDS);
    const bands = bandsOf(transitions, production.stops, coverage, new Set(), regimeOf);
    const flow = flowStops(
      { transitions, coverage, bands, regimeOf, production, laneTags: new Set(), functionOf: new Map() },
      THRESHOLDS,
    );
    expect(flow.stops.filter((stop) => stop.regime === "noche")).toEqual([]);
    const pair = bands.pairs.get("T10\u0000T11");
    expect(pair?.produccion?.p95Ms).toBe(20_000);
    expect(pair?.noche?.p50Ms).toBe(60_000);
  });
});
