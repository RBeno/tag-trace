/**
 * El estado normal del circuito (R-TIM-009, R-FLO-008, R-FLO-009, R-GRA-014).
 *
 * Lo que se fija, sobre un anillo de 20 tags hecho a mano: un punto conflictivo son paradas sin
 * explicación de varios AGV juntas, más de las que da el azar por las pasadas de ese sitio, y los
 * tags vecinos se unen; si todas son de un AGV, es de ese AGV; repartidas, no son nada; las de noche
 * no cuentan. Un cuello de botella son retenciones concentradas, atribuidas a la cabeza de la cola.
 * Una zona oscura es un tramo con mucho más hueco entre lecturas que el típico, con su causa; y una
 * parada precisa explica su espera.
 */

import { describe, expect, it } from "vitest";

import { buildCircuitState, poissonTail, type CircuitStateInput } from "../../src/domain/circuit-state.js";
import type { FlowReport, Retention, VehicleStop } from "../../src/domain/flow-stops.js";
import type { Transition } from "../../src/domain/graph.js";
import { buildSegmentBands, type Regime } from "../../src/domain/segment-bands.js";

const RING = Array.from({ length: 20 }, (_, index) => `T${index}`);
const DAY = (): Regime => "produccion";
const SECOND = 1_000;

/** Seis AGV, cien vueltas cada uno, 16–18 s por tramo; con las variaciones que se pidan. */
function laps(options: { skip11?: boolean; long15?: boolean } = {}): Transition[] {
  const transitions: Transition[] = [];
  for (let vehicle = 0; vehicle < 6; vehicle += 1) {
    let time = vehicle * 60 * SECOND;
    for (let lap = 0; lap < 100; lap += 1) {
      for (let position = 0; position < RING.length; position += 1) {
        const from = RING[position] as string;
        const duration = (16 + ((lap + position) % 3)) * SECOND;
        // T11 se salta nueve de cada diez veces: de T10 a T12 directamente.
        if (options.skip11 === true && position === 10 && lap % 10 !== 0) {
          transitions.push({ agvId: `V${vehicle}`, from, to: "T12", fromTime: time, toTime: time + 2 * duration, sameInstant: false });
          time += 2 * duration;
          position += 1;
          continue;
        }
        const long = options.long15 === true && position === 15 ? 3 : 1;
        const to = RING[(position + 1) % RING.length] as string;
        transitions.push({ agvId: `V${vehicle}`, from, to, fromTime: time, toTime: time + long * duration, sameInstant: false });
        time += long * duration;
      }
    }
  }
  return transitions;
}

function stop(agvId: string, fromTagId: string, regime: Regime = "produccion", excessMs = 60 * SECOND): VehicleStop {
  return {
    agvId,
    fromTagId,
    toTagId: fromTagId,
    fromUtcMs: 0,
    toUtcMs: excessMs + 16 * SECOND,
    usualMs: 16 * SECOND,
    excessMs,
    regime,
    justification: "sin-explicacion",
    aheadAgvId: null,
    headAgvId: null,
    behind: 0,
    aheadEvidence: null,
  };
}

function retention(agvId: string, holderAgvId: string, holderTagId: string, from: number, to: number): Retention {
  return {
    agvId,
    fromTagId: holderTagId,
    toTagId: holderTagId,
    fromUtcMs: from,
    toUtcMs: to,
    waitMs: 40 * SECOND,
    holderAgvId,
    holderTagId,
    regime: "produccion",
    stop: false,
  };
}

function state(
  flow: Partial<FlowReport>,
  transitions: readonly Transition[] = laps(),
  timeCritical: ReadonlyMap<string, string> = new Map(),
  extra: Partial<CircuitStateInput> = {},
) {
  const bands = buildSegmentBands(transitions, RING, DAY, { minBandSamples: 20 }, 30 * SECOND);
  const input: CircuitStateInput = {
    bands,
    transitions,
    regimeOf: DAY,
    flow: { stops: [], blockages: [], retentions: [], productionFlow: [], ...flow },
    timeCritical,
    reachTags: 2,
    minVehicles: 2,
    headStallMs: 120 * SECOND,
    ...extra,
  };
  return buildCircuitState(input, { darkZoneFactor: 1.5, maxFalsePoints: 0.01 });
}

describe("puntos conflictivos (R-FLO-009)", () => {
  it("paradas sin explicación de varios AGV en tags vecinos: un solo punto, con todos sus AGV", () => {
    const stops = [
      ...["A", "B", "C", "D", "A", "B"].map((agvId) => stop(agvId, "T5")),
      ...["C", "D", "E", "F"].map((agvId) => stop(agvId, "T6")),
      stop("A", "T12"),
    ];
    const result = state({ stops });
    expect(result.conflictPoints).toHaveLength(1);
    expect(result.conflictPoints[0]).toMatchObject({ tags: ["T5", "T6"], stops: 10, ofOneVehicle: null });
    expect(result.conflictPoints[0]?.vehicles).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("si todas son del mismo AGV, es de ese AGV y no del sitio", () => {
    const result = state({ stops: Array.from({ length: 6 }, () => stop("Z", "T3")) });
    expect(result.conflictPoints).toMatchObject([{ tags: ["T3"], ofOneVehicle: "Z" }]);
  });

  it("repartidas por el circuito no son un punto conflictivo, y las de noche no cuentan", () => {
    const spread = ["T1", "T3", "T5", "T7", "T9", "T11", "T13", "T15"].map((tagId, index) => stop(`V${index}`, tagId));
    const night = Array.from({ length: 6 }, (_, index) => stop(`N${index}`, "T17", "noche"));
    const result = state({ stops: [...spread, ...night] });
    // Una ventana de cinco tags coge como mucho tres de estas: lo que da el azar.
    expect(result.conflictPoints).toEqual([]);
    expect(result.unexplained.noche).toHaveLength(6);
    expect(result.unexplained.produccion).toHaveLength(8);
  });

  it("una parada que ya es bloqueo no se repite como parada sin explicación", () => {
    const result = state({ stops: [stop("A", "T2", "produccion", 5 * 60 * SECOND), stop("B", "T4")] });
    expect(result.unexplained.produccion.map((entry) => entry.agvId)).toEqual(["B"]);
  });
});

describe("cuellos de botella (R-FLO-008)", () => {
  it("retenciones concentradas detrás de un tag, atribuidas a la cabeza de la cola", () => {
    const retentions = [
      // Diez veces alguien espera detrás de H en T8.
      ...Array.from({ length: 10 }, (_, index) => retention(`F${index}`, "H", "T8", index * 600_000, index * 600_000 + 50_000)),
      // Y una cola de dos: G espera detrás de F0, que a su vez esperaba detrás de H en T8.
      retention("G", "F0", "T7", 10_000, 40_000),
      // Una retención suelta en otro sitio no hace cuello.
      retention("X", "Y", "T15", 0, 30_000),
    ];
    const result = state({ retentions });
    expect(result.bottlenecks.map((entry) => entry.tagId)).toEqual(["T8"]);
    expect(result.bottlenecks[0]).toMatchObject({ retentions: 11, blockages: 0, longestQueue: 2, episodes: 10 });
  });

  it("sin retenciones concentradas no hay cuello", () => {
    const retentions = RING.slice(0, 10).map((tagId, index) => retention(`F${index}`, "H", tagId, index * 1000, index * 1000 + 30_000));
    expect(state({ retentions }).bottlenecks).toEqual([]);
  });
});

describe("zonas oscuras (R-GRA-014)", () => {
  it("un tag que se salta casi siempre: zona oscura con su causa", () => {
    const result = state({}, laps({ skip11: true }));
    expect(result.darkZones).toHaveLength(1);
    expect(result.darkZones[0]).toMatchObject({ tags: ["T10", "T11", "T12"], cause: "salta-tag" });
    expect(result.darkZones[0]?.gapMs).toBeGreaterThanOrEqual(1.5 * (result.typicalGapMs ?? 0));
  });

  it("un tramo que tarda el triple: zona oscura por el tramo, salvo que sea una parada precisa", () => {
    const long = state({}, laps({ long15: true }));
    expect(long.darkZones).toMatchObject([{ tags: ["T15", "T16"], cause: "tramo-largo" }]);
    const explained = state({}, laps({ long15: true }), new Map([["T15", "parada-precisa"]]));
    expect(explained.darkZones).toEqual([]);
    expect(explained.explainedSlow).toMatchObject([{ tagId: "T15", function: "parada-precisa" }]);
  });

  it("un tag declarado sin lecturas dentro de la zona es su causa, y se nombra", () => {
    // La lista declara T15b entre T15 y T16, y nadie lo lee: la información que falta es la suya.
    const declared = [...RING.slice(0, 16), "T15b", ...RING.slice(16)];
    const missing = state({}, laps({ long15: true }), new Map(), { declaredOrder: declared, readTags: new Set(RING) });
    expect(missing.darkZones).toMatchObject([{ tags: ["T15", "T16"], cause: "tag-sin-lecturas", missingTags: ["T15b"] }]);
    // Si T15b sí se lee, la causa vuelve a ser el tramo.
    const read = state({}, laps({ long15: true }), new Map(), { declaredOrder: declared, readTags: new Set([...RING, "T15b"]) });
    expect(read.darkZones).toMatchObject([{ cause: "tramo-largo", missingTags: [] }]);
  });

  it("un circuito sin huecos no tiene zonas oscuras", () => {
    expect(state({}).darkZones).toEqual([]);
  });
});

describe("azar", () => {
  it("la cola de Poisson", () => {
    expect(poissonTail(0, 3)).toBe(1);
    expect(poissonTail(10, 10)).toBeCloseTo(0.542, 2);
    expect(poissonTail(20, 0.5)).toBeLessThan(1e-12);
  });
});
