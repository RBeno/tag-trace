/**
 * La repercusión como onda (ADR-0017 §4, R-INC-005).
 *
 * Una guía única sintética: 40 tags, nueve AGV, un tag cada 20 s si el siguiente está libre, y una
 * línea en T30 que solo deja salir a un AGV cada 80 s. En el paso 150, H se queda en T10 (zona
 * cargada) siete minutos. Lo que se fija:
 *
 * - la cola detrás de H, con su profundidad y su alcance, y que se descarga;
 * - el hueco que llega por delante a T20 y a la entrada de la línea;
 * - la línea sin paso y los pasos que faltan frente a su ciclo local;
 * - el coste en AGV·min, separado en epicentro, cola y resto;
 * - la vuelta a la calma y la ventana;
 * - lo que no se afirma: sin fin (abierta), fuera de cobertura, ondas superpuestas y zona vacía.
 */

import { describe, expect, it } from "vitest";

import {
  flowStops,
  outsideProductionStops,
  productionStops,
  type FlowStopThresholds,
} from "../../src/domain/flow-stops.js";
import type { Transition } from "../../src/domain/graph.js";
import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";
import { measureWave, waveThresholds, type WaveEpicenter, type WaveInput, type WaveThresholds } from "../../src/domain/incident-wave.js";
import type { Reading } from "../../src/domain/reading.js";
import { buildSegmentBands, measurableTransitions, pairKey, type Regime } from "../../src/domain/segment-bands.js";

const FLOW: FlowStopThresholds = {
  headStallMs: 2 * 60_000,
  minProductionStopMs: 2 * 60_000,
  minStopExcessMs: 30_000,
  reachTags: 2,
  maxFalseStops: 0.01,
  sameTimeToleranceMs: 15 * 60_000,
  minPairSamples: 4,
};
/** Los de la configuración provisional: una vuelta de estabilización y tres de tope (OQ-159). */
const WAVE: WaveThresholds = waveThresholds(PROVISIONAL_CONFIG);
const DAY = (): Regime => "produccion";
const ZONE = "UTC";
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const TICK = 20_000;
const RING = Array.from({ length: 40 }, (_, index) => `T${index}`);
const LINE_ENTRY = 30;
const LINE_EVERY = 4;
const BUFFER = ["T27", "T28", "T29", "T30"];

interface Halt {
  readonly agvId: string;
  /** Se para la primera vez que llega a `atTag` después del paso `afterTick`. */
  readonly afterTick: number;
  readonly atTag: number;
  readonly ticks: number;
  /** Deja de leer desde que se para hasta el final: no vuelve. */
  readonly forever?: boolean;
}

/**
 * Nueve AGV repartidos por el anillo. En cada paso cada uno avanza un tag si el siguiente estaba libre;
 * de la entrada de la línea solo sale uno cada `LINE_EVERY` pasos. Un AGV parado no lee.
 */
function simulate(halts: readonly Halt[], ticks = 420, fleet = 9): { readings: Reading[]; transitions: Transition[] } {
  const ids = Array.from({ length: fleet }, (_, index) => (index === 0 ? "H" : `A${index}`));
  const position = new Map(ids.map((id, index) => [id, (10 - index * 4 + 400) % RING.length]));
  const readings: Reading[] = [];
  const transitions: Transition[] = [];
  const last = new Map<string, { tag: string; time: number }>();
  let row = 0;
  const read = (agvId: string, tick: number): void => {
    const tag = RING[position.get(agvId) as number] as string;
    const time = T0 + tick * TICK;
    row += 1;
    readings.push({ time: { utcMs: time, raw: String(time), zone: ZONE, flag: "ok" }, agvId, tagId: tag, provenance: { sourceId: "s", sourceHash: "h", sourceRow: row } });
    const previous = last.get(agvId);
    if (previous !== undefined) transitions.push({ agvId, from: previous.tag, to: tag, fromTime: previous.time, toTime: time, sameInstant: false });
    last.set(agvId, { tag, time });
  };
  for (const id of ids) read(id, 0);
  const silent = new Set<string>();
  const started = new Map<Halt, number>();
  for (let tick = 1; tick <= ticks; tick += 1) {
    for (const halt of halts) {
      if (!started.has(halt) && tick > halt.afterTick && position.get(halt.agvId) === halt.atTag) started.set(halt, tick - 1);
    }
    // Solo se entra en un tag que estaba libre al empezar el paso: el de detrás arranca un paso después.
    const occupied = new Set(position.values());
    {
      for (const id of ids) {
        const halt = halts.find((entry) => {
          const at = started.get(entry);
          return entry.agvId === id && at !== undefined && (entry.forever === true || tick <= at + entry.ticks);
        });
        if (halt !== undefined) {
          if (halt.forever === true) silent.add(id);
          continue;
        }
        const here = position.get(id) as number;
        if (here === LINE_ENTRY && tick % LINE_EVERY !== 0) continue;
        const next = (here + 1) % RING.length;
        if (occupied.has(next)) continue;
        position.set(id, next);
        if (!silent.has(id)) read(id, tick);
      }
    }
  }
  return { readings, transitions };
}

function analyse(halts: readonly Halt[], options: { ticks?: number; zoneOf?: WaveInput["zoneOf"] } = {}) {
  const { readings, transitions } = simulate(halts, options.ticks);
  const end = Math.max(...readings.map((reading) => reading.time.utcMs));
  const coverage = [{ from: T0, to: end }];
  const production = productionStops(readings, new Set(["T15", "T30"]), coverage, ZONE, [6, 14, 22], FLOW);
  const timed = measurableTransitions(outsideProductionStops(transitions, production.stops), coverage, new Set());
  const bands = buildSegmentBands(timed, RING, DAY, { minBandSamples: 20 }, FLOW.minStopExcessMs);
  const flow = flowStops({ transitions, coverage, bands, regimeOf: DAY, production, laneTags: new Set(), functionOf: new Map() }, FLOW);
  const input: WaveInput = {
    transitions,
    coverage,
    bands,
    regimeOf: DAY,
    laneTags: new Set(),
    stops: flow.stops,
    retentions: flow.retentions,
    productionStops: production.stops,
    line: {
      passTimes: readings.filter((reading) => reading.tagId === `T${LINE_ENTRY}`).map((reading) => reading.time.utcMs),
      bufferTags: BUFFER,
    },
    watchTags: ["T20", `T${LINE_ENTRY}`],
    zoneOf: options.zoneOf ?? ((tag) => (Number(tag.slice(1)) < 20 ? "cargado" : "vacio")),
  };
  return { readings, transitions, production, flow, input, end };
}

const SEVEN_MIN: Halt = { agvId: "H", afterTick: 140, atTag: 10, ticks: 21 };

/** El epicentro tal y como lo da `flowStops`: la parada sin explicación de H. */
function epicenterOf(flow: ReturnType<typeof analyse>["flow"], agvId = "H"): WaveEpicenter {
  const stop = flow.stops.find((entry) => entry.agvId === agvId && entry.justification === "sin-explicacion");
  if (stop === undefined) throw new Error(`sin parada de ${agvId}`);
  return { kind: "bloqueo", agvId, tagId: stop.fromTagId, fromUtcMs: stop.fromUtcMs, toUtcMs: stop.toUtcMs };
}

describe("repercusión como onda", () => {
  it("un AGV cargado siete minutos parado: cola detrás, hueco delante, línea sin paso y vuelta a la calma", () => {
    const { flow, input } = analyse([SEVEN_MIN]);
    const epicenter = epicenterOf(flow);
    expect(epicenter.tagId).toBe("T10");
    const wave = measureWave(input, epicenter, WAVE);

    expect(wave.epicenter.zone).toBe("cargado");
    // 21 pasos parado más los 20 s del tramo: 440 s entre su lectura en T10 y la siguiente.
    expect(wave.epicenter.durationMs).toBe(440_000);
    // 40 tramos de 20 s: la vuelta p50 son 800 s.
    expect(wave.lapMs).toBe(800_000);

    // Aguas arriba: los ocho restantes se paran detrás, uno por tag, cada uno esperando al de delante.
    expect(wave.queue.members.map((member) => [member.agvId, member.tagId, member.behind, member.holderAgvId])).toEqual([
      ["A1", "T9", 1, "H"],
      ["A2", "T8", 2, "A1"],
      ["A3", "T7", 3, "A2"],
      ["A4", "T6", 4, "A3"],
      ["A5", "T5", 5, "A4"],
      ["A6", "T4", 6, "A5"],
      ["A7", "T3", 7, "A6"],
      ["A8", "T2", 8, "A7"],
    ]);
    expect(wave.queue.depth).toBe(8);
    expect(wave.queue.reach).toBe(8);
    // Llegan de tres en tres pasos (60 s) un tag más atrás: la cola crece a un tag por minuto.
    expect(wave.queue.frontTagsPerMin).toBe(1);
    // Se descarga de delante hacia atrás, un paso cada uno: el último sale 8 × 20 s después.
    expect(wave.queue.dischargeMs).toBe(160_000);
    expect(wave.queue.confidence).toBe("normal");

    // Aguas abajo: el hueco pasa por T20 y llega a la entrada de la línea, muy por encima de lo habitual.
    expect(wave.downstream.map((point) => [point.tagId, point.ahead, point.holeMs, point.usual?.p50Ms, point.overFence])).toEqual([
      ["T20", 10, 580_000, 80_000, true],
      ["T30", 20, 580_000, 80_000, true],
    ]);

    // La línea: faltan pasos frente a su ciclo local de 80 s, y el pulmón se vacía.
    expect(wave.line?.localCycleMs).toBe(80_000);
    expect(wave.line?.missingPasses).toBe(5);
    expect(wave.line?.aboveFenceMs).toBe(340_000);
    expect(wave.buffer?.emptied).toBe(true);

    // El coste va al epicentro y a la cola: no queda nadie fuera de ella.
    expect(wave.cost.epicenter.excessMs).toBe(480_000);
    expect(wave.cost.queue.excessMs).toBeGreaterThan(wave.cost.epicenter.excessMs);
    expect(wave.cost.rest.transitions).toBe(0);
    expect(wave.cost.epicenter.unknown + wave.cost.queue.unknown).toBe(0);
    // La atenuación: el exceso está detrás del epicentro, donde esperó la cola, y crece hacia él.
    const behind = wave.attenuation.filter((entry) => entry.offset < 0 && entry.offset >= -8);
    expect(behind.every((entry) => entry.excessMs > 0)).toBe(true);

    // El eco: la línea los vuelve a separar a su ciclo, así que una vuelta después ya no van juntos.
    expect(wave.echo?.bunched).toBe(false);

    // La calma: medida, después de reanudar, con una vuelta p50 de estabilización.
    expect(wave.calm.status).toBe("medida");
    expect(wave.calm.stabilizationMs).toBe(800_000);
    expect(wave.calm.recoveryMs).toBe(800_000);
    expect(wave.superposed).toEqual([]);
    // La ventana: una vuelta antes del epicentro y una después de la calma.
    expect(wave.window.fromUtcMs).toBe(epicenter.fromUtcMs - 800_000);
    expect(wave.window.toUtcMs).toBe((wave.calm.calmUtcMs as number) + 800_000);

    // Las frases dicen hechos y solo «compatible con», nunca una causa.
    expect(wave.lines.join(" ")).toContain("Compatible con el hueco, no causado por él");
    expect(wave.lines.join(" ")).not.toMatch(/caus[aó] (de|la|el)/);
  });

  it("es determinista: la misma entrada da la misma onda", () => {
    const first = analyse([SEVEN_MIN]);
    const second = analyse([SEVEN_MIN]);
    expect(JSON.stringify(measureWave(second.input, epicenterOf(second.flow), WAVE))).toBe(
      JSON.stringify(measureWave(first.input, epicenterOf(first.flow), WAVE)),
    );
  });

  it("un AGV que no vuelve a leer deja la onda abierta: ni hueco medido ni calma", () => {
    const { input, transitions } = analyse([{ ...SEVEN_MIN, forever: true }]);
    const last = transitions.filter((transition) => transition.agvId === "H").sort((a, b) => b.toTime - a.toTime)[0] as Transition;
    const wave = measureWave(input, { kind: "deja-de-leer", agvId: "H", tagId: last.to, fromUtcMs: last.toTime, toUtcMs: null }, WAVE);
    expect(wave.calm.status).toBe("abierta");
    expect(wave.calm.recoveryMs).toBeNull();
    expect(wave.downstream.every((point) => point.holeMs === null && point.epicenterUtcMs === null)).toBe(true);
    expect(wave.queue.dischargeMs).toBeNull();
    expect(wave.lines.join(" ")).toContain("sin volver a leer en lo cargado");
  });

  it("si la cobertura acaba antes de la calma, la recuperación es «al menos», nunca una cifra", () => {
    const { flow, input, end } = analyse([SEVEN_MIN], { ticks: 200 });
    const epicenter = epicenterOf(flow);
    const wave = measureWave(input, epicenter, WAVE);
    expect(wave.calm.status).toBe("fuera-de-cobertura");
    expect(wave.calm.recoveryMs).toBeNull();
    expect(wave.calm.atLeastMs).toBe(end - (epicenter.toUtcMs as number));
    expect(wave.lines.join(" ")).toContain("al menos");
  });

  it("la noche antes de la calma interrumpe la medida: no se alarga hasta el turno siguiente", () => {
    const { flow, input } = analyse([SEVEN_MIN]);
    const epicenter = epicenterOf(flow);
    const nightFrom = (epicenter.toUtcMs as number) + 5 * 60_000;
    const wave = measureWave({ ...input, regimeOf: (utcMs) => (utcMs >= nightFrom ? "noche" : "produccion") }, epicenter, WAVE);
    expect(wave.calm.status).toBe("interrumpida");
    expect(wave.calm.calmUtcMs).toBeNull();
  });

  it("en zona vacía la cola se da con confianza baja: allí se puede rodear al parado", () => {
    const { flow, input } = analyse([SEVEN_MIN], { zoneOf: () => "vacio" });
    const wave = measureWave(input, epicenterOf(flow), WAVE);
    expect(wave.queue.confidence).toBe("baja");
    expect(wave.lines.join(" ")).toContain("confianza baja");
  });

  it("otra parada sin explicación dentro del impacto y del alcance es una onda superpuesta, sin reparto", () => {
    const { flow, input } = analyse([SEVEN_MIN]);
    const epicenter = epicenterOf(flow);
    // Una parada inventada de otro AGV, fuera de la cola, dos tags por delante y a la vez.
    const other = {
      ...(flow.stops[0] as (typeof flow.stops)[number]),
      agvId: "X9",
      fromTagId: "T12",
      toTagId: "T13",
      fromUtcMs: epicenter.fromUtcMs + 60_000,
      toUtcMs: epicenter.fromUtcMs + 300_000,
      justification: "sin-explicacion" as const,
    };
    // T35 queda 15 tags detrás: más allá de la cola (8) y su margen (2). Por delante, el alcance llega
    // hasta T30, donde el hueco aún pasaba la valla.
    const far = { ...other, agvId: "X8", fromTagId: "T35", toTagId: "T36" };
    const wave = measureWave({ ...input, stops: [...input.stops, other, far] }, epicenter, WAVE);
    expect(wave.superposed.map((entry) => entry.agvId)).toEqual(["X9"]);
    expect(wave.lines.join(" ")).toContain("el reparto es desconocido");
  });

  it("sin línea declarada no hay línea ni pulmón, y la calma se mide con las transiciones", () => {
    const { flow, input } = analyse([SEVEN_MIN]);
    const wave = measureWave({ ...input, line: null }, epicenterOf(flow), WAVE);
    expect(wave.line).toBeNull();
    expect(wave.buffer).toBeNull();
    expect(wave.calm.status).toBe("medida");
    expect(wave.calm.reason).not.toContain("línea");
  });

  it("sin la horquilla de algún tramo del anillo no hay vuelta p50, y la calma queda sin medir", () => {
    const { flow, input } = analyse([SEVEN_MIN]);
    const epicenter = epicenterOf(flow);
    const pairs = new Map(input.bands.pairs);
    pairs.delete(pairKey("T25", "T26"));
    const wave = measureWave({ ...input, bands: { ...input.bands, pairs } }, epicenter, WAVE);
    expect(wave.lapMs).toBeNull();
    expect(wave.calm.status).toBe("sin-medir");
  });
});
