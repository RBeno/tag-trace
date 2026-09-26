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
  /** Parado sobre el tag del paso `step` ese tiempo, y lo vuelve a leer al arrancar. */
  readonly rereads?: ReadonlyMap<number, number>;
}

/** Cada AGV recorre el anillo un tag cada 20 s, 180 pasos, con las esperas que se le digan. */
function drive(plans: readonly Plan[], steps = 180): { readings: Reading[]; transitions: Transition[] } {
  const readings: Reading[] = [];
  const transitions: Transition[] = [];
  let row = 0;
  for (const plan of plans) {
    let time = plan.offsetMs;
    let previous: { tag: string; time: number } | null = null;
    const read = (tag: string): void => {
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
    };
    for (let step = 0; step < steps; step += 1) {
      const tag = RING[(plan.startTag + step) % RING.length] as string;
      read(tag);
      const reread = plan.rereads?.get(step);
      if (reread !== undefined) {
        time += reread;
        read(tag);
      }
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

  /** La parada de 15 min, con la transición que la cruza de cada AGV cambiada a voluntad. */
  function flowWith(remap: (agvId: string) => string | null) {
    const all = queue(0).map((plan) => ({ ...plan, pauses: new Map([[90, 15 * 60_000]]) }));
    const { readings, transitions } = drive(all);
    // La transición que cruza la parada de cada AGV es la única de más de 10 min.
    const changed = transitions.map((transition) => {
      const to = transition.toTime - transition.fromTime > 10 * 60_000 ? remap(transition.agvId) : null;
      return to === null ? transition : { ...transition, to };
    });
    const coverage = [{ from: 0, to: Math.max(...readings.map((reading) => reading.time.utcMs)) }];
    const production = productionStops(readings, CRITICAL, coverage, ZONE, SHIFTS, THRESHOLDS);
    const bands = bandsOf(changed, production.stops, coverage);
    return flowStops(
      { transitions: changed, coverage, bands, regimeOf: DAY, production, laneTags: new Set(), functionOf: new Map() },
      THRESHOLDS,
    );
  }

  it("si uno que iba detrás aparece delante tras la parada, por su sitio, se dice quién pasó a quién", () => {
    // Todos parados 15 min; F1, que iba un tag detrás de H (T9 frente a T10), vuelve por T11 (un tag
    // saltado: por su sitio) mientras H vuelve a leer su mismo T10: F1 aparece delante de H.
    const flow = flowWith((agvId) => (agvId === "F1" ? "T11" : agvId === "H" ? "T10" : null));
    expect(flow.productionFlow[0]?.notInPlace).toEqual([]);
    expect(flow.productionFlow[0]?.orderKept).toBe(false);
    expect(flow.productionFlow[0]?.orderChanges).toContainEqual({ agvId: "F1", passed: "H" });
  });

  it("uno que vuelve saltándose tags no cuenta en el orden: se dice que no siguió por su sitio, no que adelantó", () => {
    // F1 vuelve cuatro tags más allá (se saltó tres). Su posición no es fiable: la auditoría enseñó al
    // AGV que salta tags como «delante de» un vecino al que nunca adelantó. Se dice lo que se ve —no
    // siguió por su sitio— y nada más.
    const flow = flowWith((agvId) => (agvId === "F1" ? "T13" : null));
    expect(flow.productionFlow[0]?.notInPlace).toEqual([{ agvId: "F1", fromTagId: "T9", toTagId: "T13", skipped: 3 }]);
    expect(flow.productionFlow[0]?.orderChanges).toEqual([]);
    expect(flow.productionFlow[0]?.orderKept).toBe(true);
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

  it("el que entró a una calle de carga durante la parada de la producción cuenta, y siguió por su sitio", () => {
    // Con T10 y T11 declarados como calle, la transición de H que cruza la parada (T10→T11) no es
    // medible. Antes desaparecía del recuento —cinco AGV en vez de seis—; entrar a cargar es una
    // salida legítima del anillo, así que está en el circuito y por su sitio.
    const all = queue(0).map((plan) => ({ ...plan, pauses: new Map([[90, 15 * 60_000]]) }));
    const { flow } = analyse(all, CRITICAL, new Set(["T10", "T11"]));
    expect(flow.productionFlow[0]).toMatchObject({ vehicles: 6, inPlace: 6, notInPlace: [] });
  });
});

describe("paradas que el dato enseña de otra forma", () => {
  /** Cuatro AGV repartidos; los de fuera van a 1.000 s de desfase para que A pare con el anillo poblado. */
  const OTHERS: Plan[] = [
    { agvId: "B", startTag: 10, offsetMs: 1_000_000 },
    { agvId: "C", startTag: 20, offsetMs: 1_000_000 },
    { agvId: "D", startTag: 30, offsetMs: 1_000_000 },
    { agvId: "E", startTag: 5, offsetMs: 1_000_000 },
  ];

  it("doce minutos parado sobre un tag que se relee al arrancar es una parada sin explicación, medida contra el tramo que sale de él", () => {
    // El par (T18, T18) no tiene horquilla; lo habitual con que se compara es lo que se tarda en dejar
    // T18: la horquilla de T18→T19. Antes esta parada no existía para el flujo.
    const plans: Plan[] = [
      { agvId: "A", startTag: 0, offsetMs: 1_000_000, rereads: new Map([[58, 12 * 60_000]]) },
      { agvId: "G", startTag: 0, offsetMs: 0 },
      ...OTHERS,
    ];
    const { production, flow } = analyse(plans);
    expect(production.stops).toEqual([]);
    const stop = flow.stops.find((entry) => entry.agvId === "A");
    expect(stop).toMatchObject({ fromTagId: "T18", toTagId: "T18", usualMs: STEP, justification: "sin-explicacion" });
    expect(stop?.excessMs).toBe(12 * 60_000 - STEP);
    // Doce minutos pasan de los dos de bloqueo, y la producción seguía.
    expect(flow.blockages.map((blockage) => [blockage.agvId, blockage.tagId])).toEqual([["A", "T18"]]);
  });

  it("un AGV que calla horas con su último tag en el anillo no retiene a nadie si otros pasaron por ese tag", () => {
    // G deja de leer dos horas con T20 como último tag; mientras, B–E pasan por T20 una y otra vez. A
    // para 90 s en T18, a dos tags de «donde está» G. En una guía única nadie pasa por donde hay un AGV
    // parado: G no estaba ahí, y la parada de A queda sin explicación, con su evidencia.
    const plans: Plan[] = [
      { agvId: "A", startTag: 0, offsetMs: 1_000_000, pauses: new Map([[58, 90_000]]) },
      { agvId: "G", startTag: 0, offsetMs: 0, pauses: new Map([[60, 2 * 3_600_000]]) },
      ...OTHERS,
    ];
    const { flow } = analyse(plans);
    const stop = flow.stops.find((entry) => entry.agvId === "A");
    expect(stop).toMatchObject({ fromTagId: "T18", justification: "sin-explicacion", aheadAgvId: null });
    expect(stop?.aheadEvidence?.agvId).toBe("G");
    expect(flow.retentions.filter((retention) => retention.holderAgvId === "G")).toEqual([]);
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
