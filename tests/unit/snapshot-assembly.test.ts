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
import { buildSnapshotFindings, type SnapshotFindingsInput } from "../../src/domain/snapshot-findings.js";
import type { LinePassIssue, LineStop } from "../../src/domain/line-feed.js";
import { CARDS_SHOWN } from "../../src/domain/finding-kinds.js";
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

  it("cada vértice del anillo lleva de la matriz las pasadas y los aciertos por AGV, y nada más (R-MEM-004)", () => {
    const snapshot = buildSnapshot(assembleSnapshotInput(input()));
    const byId = new Map(snapshot.vertices.map((vertex) => [vertex.tagId, vertex]));
    expect(byId.get("B")?.byVehicle).toEqual({ V1: [10, 10], V2: [10, 0] });
    expect(byId.get("A")?.byVehicle).toEqual({ V1: [10, 10] });
    // Fuera del anillo la matriz no mide: sin desglose, no un cero.
    expect(byId.get("X")?.byVehicle).toBeUndefined();
    expect(byId.get("Z")?.byVehicle).toBeUndefined();
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

/**
 * OQ-149 (propietario 2026-09-27): los de rango 1 con instante entran en la instantánea con la clave
 * exacta de su tarjeta (`main.ts`: `renderFlowStops`, `renderLineFeed`, `renderAbandoned`), con su
 * ventana y su sujeto, y **solo los que la interfaz pinta**: una tarjeta de más quedaría pendiente
 * para siempre y bloquearía la consolidación.
 */
describe("buildSnapshotFindings · rango 1 con instante (OQ-149)", () => {
  const MIN = 60 * SECOND;
  const base: SnapshotFindingsInput = { zone: "UTC", matrix: null, tagChanges: [], lanes: [], laneUsage: [], state: null, undeclaredTags: [], reviews: new Map() };
  const stop = (kind: LineStop["kind"], after: string, fromUtcMs: number, regime: LineStop["regime"] = "produccion"): LineStop => ({
    regime,
    fromUtcMs,
    toUtcMs: fromUtcMs + 5 * MIN,
    durationMs: 5 * MIN,
    kind,
    waiting: kind === "con-pulmon" ? 2 : 0,
    before: "AGV-90",
    after,
    arriving: null,
    hole: null,
    afterIsHolder: false,
    evidence: "",
  });
  const issue = (agvId: string, fromUtcMs: number, kind: LinePassIssue["kind"] = "no-sigue"): LinePassIssue => ({
    kind,
    agvId,
    fromUtcMs,
    missed: [],
    nextGapMs: null,
    exitMs: null,
    evidence: "",
  });
  const passages = (issues: readonly LinePassIssue[]) => ({ total: 10, expected: ["L1"], exit: null, minGapMs: null, parallel: false, readers: [], issues });
  const blockage = (agvId: string, tagId: string, fromUtcMs: number) => ({
    agvId,
    tagId,
    nextTagId: "C",
    fromUtcMs,
    toUtcMs: fromUtcMs + 3 * MIN,
    usualMs: 20 * SECOND,
    functionAtTag: null,
  });
  const keysOf = (input: Partial<SnapshotFindingsInput>) => buildSnapshotFindings({ ...base, ...input }).map((finding) => finding.key);

  it("bloqueo: la clave de la tarjeta (AGV, tag e instante en una parte), su ventana y su tag; solo los PER_KIND primeros", () => {
    const blockages = [0, 1, 2, 3, 4, 5, 6].map((index) => blockage(`AGV-0${index}`, "B", index * 10 * MIN));
    const findings = buildSnapshotFindings({ ...base, flow: { vehicles: 7, production: { stops: [] }, blockages } });
    expect(findings.map((finding) => finding.key)).toEqual(
      blockages.slice(0, CARDS_SHOWN.perKind).map((entry) => reviewKey(["bloqueo", `${entry.agvId} ${entry.tagId} ${entry.fromUtcMs}`])),
    );
    expect(findings[0]).toMatchObject({
      kind: "bloqueo",
      title: "AGV-00: el primero de la cola, sin avanzar 3 min",
      figure: "En B, de jue, 00:00 a jue, 00:03; lo habitual hasta C: 20 s",
      window: { from: 0, to: 3 * MIN },
      tagIds: ["B"],
    });
    expect(findings[0]?.agvId).toBeUndefined();
    // Sin ningún AGV la interfaz no pinta la sección de la flota: ninguna tarjeta.
    expect(keysOf({ flow: { vehicles: 0, production: { stops: [] }, blockages } })).toEqual([]);
  });

  it("producción parada: una sola tarjeta `produccion-parada|circuito`, con una ventana por parada y sin tags", () => {
    const stops = [
      { fromUtcMs: 0, toUtcMs: 10 * MIN, sameTimeOn: [] },
      { fromUtcMs: 60 * MIN, toUtcMs: 75 * MIN, sameTimeOn: [7 * 24 * 60 * MIN] },
    ];
    const [finding] = buildSnapshotFindings({ ...base, flow: { vehicles: 3, production: { stops }, blockages: [] } });
    expect(finding).toMatchObject({
      key: reviewKey(["produccion-parada", "circuito"]),
      kind: "produccion-parada",
      title: "La producción se paró 2 veces",
      figure: "jue, 00:00 a jue, 00:10 · jue, 01:00 a jue, 01:15 (se repite a esa hora otro día)",
      window: { from: 0, to: 75 * MIN },
      windows: [
        { from: 0, to: 10 * MIN },
        { from: 60 * MIN, to: 75 * MIN },
      ],
      tagIds: [],
    });
    expect(buildSnapshotFindings({ ...base, flow: { vehicles: 3, production: { stops: [stops[0] as (typeof stops)[number]] }, blockages: [] } })[0]?.title).toBe("La producción se paró 1 vez");
    expect(keysOf({ flow: { vehicles: 3, production: { stops: [] }, blockages: [] } })).toEqual([]);
  });

  it("parada de la línea: `linea|<el que entró después>`, faltaron primero, sin las «sin medir», HIGHLIGHTS como mucho y #n por orden", () => {
    const stops = [
      stop("con-pulmon", "AGV-01", 0),
      stop("sin-agv", "AGV-02", 10 * MIN),
      stop("sin-medir", "AGV-03", 20 * MIN),
      stop("sin-agv", "AGV-02", 30 * MIN, "noche"),
      ...[0, 1, 2, 3, 4, 5, 6].map((index) => stop("con-pulmon", `AGV-1${index}`, (40 + index) * MIN)),
    ];
    const feed = { evaluated: true, cadence: { samples: 20, p50Ms: 55 * SECOND, p80Ms: 60 * SECOND, p95Ms: 70 * SECOND, fenceMs: 90 * SECOND }, entryTagId: "L1", stops, passages: null };
    const findings = buildSnapshotFindings({ ...base, lineFeed: feed });
    // El orden de la tarjeta: las dos en que faltaron AGV, y después las de pulmón, hasta ocho.
    expect(findings.map((finding) => finding.key)).toEqual([
      "linea|AGV-02",
      "linea|AGV-02|#2",
      "linea|AGV-01",
      "linea|AGV-10",
      "linea|AGV-11",
      "linea|AGV-12",
      "linea|AGV-13",
      "linea|AGV-14",
    ]);
    expect(findings).toHaveLength(CARDS_SHOWN.highlights);
    expect(findings[0]).toMatchObject({
      title: "1/1/70, 0:10:00: le faltaron AGV",
      figure: "5 min sin paso · entró antes AGV-90, después AGV-02",
      window: { from: 10 * MIN, to: 15 * MIN },
      tagIds: ["L1"],
    });
    expect(findings[1]?.title).toBe("1/1/70, 0:30:00 (noche): le faltaron AGV");
    expect(findings[2]?.title).toBe("1/1/70, 0:00:00: parada con AGV esperando");
    // Sin evaluar, o sin cadencia, la interfaz no pinta tarjetas de la línea.
    expect(keysOf({ lineFeed: { ...feed, evaluated: false } })).toEqual([]);
    expect(keysOf({ lineFeed: { ...feed, cadence: null } })).toEqual([]);
  });

  it("paso por la línea: `linea-paso|<AGV>`, con #n por orden, HIGHLIGHTS como mucho, el instante y el tag de entrada", () => {
    const issues = [issue("AGV-05", 0), issue("AGV-05", 5 * MIN, "sin-parada"), ...[0, 1, 2, 3, 4, 5, 6].map((index) => issue(`AGV-2${index}`, (10 + index) * MIN))];
    const feed = { evaluated: true, cadence: { samples: 20, p50Ms: 55 * SECOND, p80Ms: 60 * SECOND, p95Ms: 70 * SECOND, fenceMs: 90 * SECOND }, entryTagId: "L1", stops: [], passages: passages(issues) };
    const findings = buildSnapshotFindings({ ...base, lineFeed: feed });
    expect(findings.map((finding) => finding.key)).toEqual([
      "linea-paso|AGV-05",
      "linea-paso|AGV-05|#2",
      "linea-paso|AGV-20",
      "linea-paso|AGV-21",
      "linea-paso|AGV-22",
      "linea-paso|AGV-23",
      "linea-paso|AGV-24",
      "linea-paso|AGV-25",
    ]);
    expect(findings[0]).toMatchObject({ title: "1/1/70, 0:00:00: no sigue tras la línea", figure: "AGV-05", window: { from: 0, to: 0 }, tagIds: ["L1"] });
    expect(findings[1]?.title).toBe("1/1/70, 0:05:00: pasó sin la parada");
    expect(keysOf({ lineFeed: { ...feed, passages: null } })).toEqual([]);
  });

  it("deja de leer: la clave de la tarjeta, el AGV y su ventana, sin tags del grafo; HIGHLIGHTS como mucho", () => {
    const abandoned = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
      incident: { agvId: `AGV-3${index}`, fromTagId: "0300", fromUtcMs: index * MIN, toTagId: null, toUtcMs: null },
      battery: { durationMs: 20 * MIN, swap: index === 0 ? { agvId: "AGV-99", tagId: "0300", afterMs: MIN } : null },
    }));
    const findings = buildSnapshotFindings({ ...base, abandoned });
    expect(findings.map((finding) => finding.key)).toEqual(
      abandoned.slice(0, CARDS_SHOWN.highlights).map(({ incident }) => reviewKey(["deja-de-leer", `${incident.agvId} ${incident.fromTagId} ${incident.fromUtcMs}`])),
    );
    expect(findings[0]).toMatchObject({
      key: "deja-de-leer|AGV-30 0300 0",
      kind: "deja-de-leer",
      title: "AGV-30: deja de leer en 0300",
      figure: "Desde 1/1/70, 0:00:00 · empieza AGV-99",
      window: { from: 0, to: 20 * MIN },
      agvId: "AGV-30",
      tagIds: [],
    });
    expect(findings[1]?.figure).toBe("Desde 1/1/70, 0:01:00");
  });

  it("rotura de un AGV: su AGV, su instante de cambio y ningún tag del grafo", () => {
    const [finding] = buildSnapshotFindings({
      ...base,
      matrix: {
        cohortId: 1,
        ring: RING,
        tags: [],
        vehicles: [{ agvId: "V7", laps: 3, passes: 30, hits: 3, rate: 0.1, unproven: 0, changedAtUtcMs: 5 * MIN, rateBefore: 0.9, rateAfter: 0.1 }],
        supported: true,
        segmentsWithTime: 4,
        orderWithheld: 0,
      },
    });
    expect(finding).toMatchObject({ key: "agv-rotura|V7", agvId: "V7", window: { from: 5 * MIN, to: 5 * MIN }, tagIds: [] });
  });

  it("sin los datos nuevos (llamadas anteriores) no aparece nada nuevo y los hallazgos no llevan campos nuevos", () => {
    expect(keysOf({})).toEqual([]);
    const [deja] = buildSnapshotFindings({ ...base, tagChanges: [{ kind: "deja", tagId: "D", lastUtcMs: 0, passesAfter: 20 }] });
    expect(Object.keys(deja ?? {}).sort()).toEqual(["figure", "key", "kind", "review", "title"]);
  });
});
