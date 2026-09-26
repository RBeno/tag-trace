/**
 * El ensamblado del `SnapshotInput` y los hallazgos con clave de revisión (ADR-0015).
 *
 * Lo que se fija: cada tag acaba en un vértice con su posición, su desfase, su tasa, sus no lectores
 * y su situación; solo los tramos consecutivos del anillo son aristas; la flota se recorta a la
 * ventana del fichero; y la clave de cada hallazgo es la misma que fabrica la presentación —tipo y
 * sujeto con `reviewKey`, con `#n` para dos tarjetas iguales—, de modo que la marca de revisión del
 * circuito se encuentra por su clave. Lo ensamblado pasa por `buildSnapshot`, que valida.
 */

import { describe, expect, it } from "vitest";

import { assembleSnapshotInput, type SnapshotAssemblyInput } from "../../src/application/snapshot-assembly.js";
import type { TagReadRow } from "../../src/domain/read-matrix.js";
import { reviewKey } from "../../src/domain/review.js";
import { buildSnapshotFindings } from "../../src/domain/snapshot-findings.js";
import { buildSnapshot } from "../../src/domain/snapshot.js";

const SECOND = 1_000;
const RING = ["A", "B", "C", "D"];
const WINDOW = { from: 1_000_000, to: 1_000_000 + 3_600 * SECOND };

function row(tagId: string, position: number, rate: number | null, byVehicle: readonly { agvId: string; passes: number; hits: number }[]): TagReadRow {
  return {
    tagId,
    position,
    isAnchor: position === 0,
    passes: byVehicle.reduce((sum, cell) => sum + cell.passes, 0),
    hits: byVehicle.reduce((sum, cell) => sum + cell.hits, 0),
    rate,
    pattern: "uniforme-alto",
    truth: "observed",
    highReaders: [],
    lowReaders: [],
    byNeighbours: 0,
    byTime: 0,
    byOrder: 0,
    unproven: 0,
    byVehicle: byVehicle.map((cell) => ({
      ...cell,
      byNeighbours: cell.passes,
      byTime: 0,
      byOrder: 0,
      unproven: 0,
      firstHitUtcMs: null,
      lastHitUtcMs: null,
      leadingMisses: 0,
      trailingMisses: 0,
    })),
  };
}

const band = { samples: 20, p50Ms: 10 * SECOND, p80Ms: 12 * SECOND, p95Ms: 14 * SECOND, fenceMs: 40 * SECOND };

function input(overrides: Partial<SnapshotAssemblyInput> = {}): SnapshotAssemblyInput {
  return {
    circuitId: "piloto",
    zone: "Europe/Madrid",
    source: { sourceId: "h1", sourceHash: "h1", fileName: "uno.csv", window: WINDOW, acceptedRows: 100 },
    capturedAt: 5,
    appVersion: "test",
    exposure: { produccionMs: 3_000 * SECOND, nocheMs: 600 * SECOND, paradaMs: 0 },
    cohortId: 1,
    anchorTagId: "A",
    anchorDeclared: true,
    measure: {
      ring: RING,
      positions: RING.map((tagId, index) => ({ tagId, offsetMs: index * 10 * SECOND, samples: 20 })),
      lapMs: 40 * SECOND,
      bands: [
        { from: "A", to: "B", produccion: band, noche: null, firstSeenUtcMs: 0, lastSeenUtcMs: 1 },
        { from: "B", to: "C", produccion: band, noche: null, firstSeenUtcMs: 0, lastSeenUtcMs: 1 },
        // Un atajo medido A→C no es una arista del anillo.
        { from: "A", to: "C", produccion: band, noche: null, firstSeenUtcMs: 0, lastSeenUtcMs: 1 },
      ],
    },
    matrix: {
      tags: [
        row("A", 0, 1, [{ agvId: "V1", passes: 10, hits: 10 }]),
        row("B", 1, 0.5, [{ agvId: "V1", passes: 10, hits: 10 }, { agvId: "V2", passes: 10, hits: 0 }]),
        row("C", 2, 1, [{ agvId: "V1", passes: 10, hits: 10 }]),
        row("D", 3, 1, [{ agvId: "V1", passes: 10, hits: 10 }]),
      ],
    },
    readingsByTag: new Map([["A", 20], ["B", 10], ["C", 20], ["D", 20], ["X", 3]]),
    neighbours: new Map([["B", { predecessor: "A", successor: "C" }]]),
    declared: new Set(["A", "B", "C", "D", "Z"]),
    sectionOf: new Map([["B", "kitting"]]),
    funcionOf: new Map([["C", "parada-precisa"]]),
    candidateFunctionOf: new Map([["D", "semaforo"], ["C", "bifurcacion"]]),
    inventoryClassOf: new Map([["Z", "obsoleto-candidato"]]),
    laneOfTag: new Map([["L1", "calle-1"]]),
    lineTags: new Set(["N1"]),
    declaredAnchors: new Set(["A", "C"]),
    sections: [],
    anchorGaps: [],
    fleet: {
      historySource: "lecturas",
      vehicles: [
        { agvId: "V1", assignedEver: true, readings: 40, segments: [] },
        { agvId: "V2", assignedEver: true, readings: 10, segments: [] },
      ],
      counts: [
        { fromUtcMs: WINDOW.from - 10 * SECOND, toUtcMs: WINDOW.from + 1_000 * SECOND, inCircuit: 1, reading: 1, assigned: 2, unassignedActive: 0 },
        { fromUtcMs: WINDOW.from + 1_000 * SECOND, toUtcMs: WINDOW.to + 10 * SECOND, inCircuit: 2, reading: 2, assigned: 2, unassignedActive: 0 },
        { fromUtcMs: WINDOW.to + 10 * SECOND, toUtcMs: WINDOW.to + 3_600 * SECOND, inCircuit: 9, reading: 9, assigned: 9, unassignedActive: 0 },
      ],
    },
    line: null,
    lanes: [{ laneId: "calle-1", served: true, stays: [{}, {}] as never, medianStayMs: 90 * SECOND }],
    laneUsage: [{ laneId: "calle-1", share: 0.6, verdict: "mas" }],
    findings: [],
    ...overrides,
  };
}

describe("assembleSnapshotInput", () => {
  it("proyecta cada tag a un vértice con lo que el fichero midió, y pasa la validación de buildSnapshot", () => {
    const snapshot = buildSnapshot(assembleSnapshotInput(input()));
    const byId = new Map(snapshot.vertices.map((vertex) => [vertex.tagId, vertex]));
    expect([...byId.keys()].slice(0, 4)).toEqual(RING);
    const b = byId.get("B")!;
    expect(b).toMatchObject({
      position: 1,
      offsetMs: 10 * SECOND,
      section: "kitting",
      readRate: 0.5,
      passes: 20,
      readings: 10,
      nonReaders: ["V2"],
      predecessor: "A",
      successor: "C",
      situation: "anillo",
      declared: true,
      isAnchor: false,
    });
    // La función declarada gana a la candidata; sin declarada, la candidata.
    expect(byId.get("C")?.funcion).toBe("parada-precisa");
    expect(byId.get("D")?.funcion).toBe("semaforo");
    expect(byId.get("C")?.isAnchor).toBe(true);
    // Leído fuera del anillo; declarado sin lecturas; tag de calle.
    expect(byId.get("X")).toMatchObject({ position: null, situation: "fuera", readings: 3, readRate: null, passes: 0 });
    expect(byId.get("Z")).toMatchObject({ situation: "sin-lecturas", inventoryClass: "obsoleto-candidato", declared: true });
    expect(byId.has("L1")).toBe(false); // un tag de calle sin lecturas ni declaración no es un vértice
    expect(snapshot.exposure).toEqual({ produccion: 3_000 * SECOND, noche: 600 * SECOND });
    expect(snapshot.ring).toEqual(RING);
    expect(snapshot.lapMs).toBe(40 * SECOND);
  });

  it("solo los tramos consecutivos del anillo son aristas", () => {
    const snapshot = buildSnapshot(assembleSnapshotInput(input()));
    expect(snapshot.edges.map((edge) => `${edge.from}→${edge.to}`)).toEqual(["A→B", "B→C"]);
  });

  it("la flota se recorta a la ventana del fichero: N de M al final y la mediana ponderada por tiempo", () => {
    const snapshot = buildSnapshot(assembleSnapshotInput(input()));
    expect(snapshot.fleet).toEqual({
      assigned: 2,
      inCircuitAtEnd: 2,
      inCircuitMedian: 2,
      historySource: "lecturas",
      vehicles: ["V1", "V2"],
    });
  });

  it("las calles llevan su uso y su estancia habitual", () => {
    const snapshot = buildSnapshot(assembleSnapshotInput(input()));
    expect(snapshot.lanes).toEqual([{ laneId: "calle-1", served: true, stays: 2, share: 0.6, usageVerdict: "mas", medianStayMs: 90 * SECOND }]);
  });

  it("sin medición no hay anillo ni aristas, y los tags declarados siguen siendo vértices", () => {
    const snapshot = buildSnapshot(assembleSnapshotInput(input({ measure: null, matrix: null, anchorTagId: null, anchorDeclared: false })));
    expect(snapshot.ring).toEqual([]);
    expect(snapshot.edges).toEqual([]);
    expect(snapshot.vertices.every((vertex) => vertex.position === null)).toBe(true);
    expect(snapshot.vertices.map((vertex) => vertex.tagId)).toContain("Z");
  });
});

describe("buildSnapshotFindings · la clave de revisión es la de la tarjeta", () => {
  const reviews = new Map([
    [reviewKey(["tag-rotura", "B"]), { key: reviewKey(["tag-rotura", "B"]), state: "confirmado" as const, note: "", updatedAt: 1, title: "", figure: "" }],
  ]);

  it("replica tipo y sujeto con reviewKey y recoge el estado de revisión guardado", () => {
    const findings = buildSnapshotFindings({
      zone: "UTC",
      matrix: {
        cohortId: 1,
        ring: RING,
        tags: [{ ...row("B", 1, 0.2, []), changedAtUtcMs: 0, rateBefore: 0.9, rateAfter: 0.1 }],
        vehicles: [{ agvId: "V2", laps: 3, passes: 30, hits: 3, rate: 0.1, unproven: 0, trend: "bajando", segmentRates: [0.9, 0.5, 0.1] }],
        supported: true,
        segmentsWithTime: 4,
        orderWithheld: 0,
      },
      tagChanges: [
        { kind: "cambio", oldTagId: "C", newTagId: "C2", oldLastUtcMs: 0, newFirstUtcMs: 60_000, sharedNeighbor: "B", neighborSide: "predecesor", passesAfterOld: 12, passesBeforeNew: 3 },
        { kind: "deja", tagId: "D", lastUtcMs: 0, passesAfter: 20 },
      ],
      lanes: [{ laneId: "calle-2", served: false }],
      laneUsage: [],
      state: { bottlenecks: [], conflictPoints: [], darkZones: [{ tags: ["A", "B"], gapMs: 90_000, typicalMs: 10_000, skipShare: 0, cause: "tramo-largo", missingTags: [] }] },
      undeclaredTags: [],
      reviews,
    });
    expect(findings.map((finding) => finding.key)).toEqual([
      "tag-rotura|B",
      "agv-degradacion|V2",
      "cambio-tag|C|C2",
      "tag-deja|D",
      "calle-sin-servicio|calle-2",
      "zona-oscura|A",
    ]);
    expect(findings[0]).toMatchObject({ kind: "tag-rotura", title: "Tag B: su lectura cae de golpe", figure: "90 % → 10 % desde 1/1/70, 0:00:00", review: "confirmado" });
    expect(findings[1]).toMatchObject({ figure: "90 % → 50 % → 10 %", review: null });
    expect(findings[5]).toMatchObject({ title: "Zona oscura de A a B", figure: "2 min entre dos lecturas al pasar por ahí; lo típico del circuito, 10 s" });
  });

  it("dos hallazgos con la misma clave se distinguen con #n, como las tarjetas", () => {
    const findings = buildSnapshotFindings({
      zone: "UTC",
      matrix: null,
      tagChanges: [
        { kind: "deja", tagId: "D", lastUtcMs: 0, passesAfter: 20 },
        { kind: "deja", tagId: "D", lastUtcMs: 5_000, passesAfter: 9 },
      ],
      lanes: [],
      laneUsage: [],
      state: null,
      undeclaredTags: [],
      reviews: new Map(),
    });
    expect(findings.map((finding) => finding.key)).toEqual(["tag-deja|D", "tag-deja|D|#2"]);
  });
});
