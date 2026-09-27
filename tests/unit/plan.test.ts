/**
 * El plano físico del circuito (ADR-0016): ubicaciones estables, eventos append-only con fecha
 * efectiva, observación de cada fichero contra el plano de su ventana, propuestas que solo confirma una
 * persona y estadísticas combinables.
 *
 * Todo con un anillo sintético de seis tags (T001…T006) y AGV inventados. Lo que se fija: los momentos
 * de dos mitades combinados son los de todo; el plano de un instante sale de los eventos hasta ese
 * instante y una sustitución no corta la historia de la ubicación; los eventos que no valen se dicen
 * en palabras; los identificadores no se reutilizan; un tag que no se lee entre vecinos leídos queda
 * «no observado» con sus pasadas y no «desaparece»; y las propuestas salen con su evidencia.
 */

import { describe, expect, it } from "vitest";

import type { ConsolidatedVersion } from "../../src/domain/memory.js";
import {
  bootstrapPlan,
  classifyPlanEvents,
  combineMoments,
  describeEvent,
  momentsOf,
  nextLocationId,
  observeAgainstPlan,
  planAt,
  proposeChanges,
  reinterpretDelta,
  summarizePlan,
  validateEvent,
  varianceOf,
  type PhysicalPlan,
  type PlanEvent,
  type PlanEventInput,
} from "../../src/domain/plan.js";
import { bandOf, type Band } from "../../src/domain/segment-bands.js";
import {
  buildSnapshot,
  compareSnapshots,
  type CircuitSnapshot,
  type SnapshotAnchorGap,
  type SnapshotEdge,
  type SnapshotVehicleCell,
  type SnapshotVertex,
} from "../../src/domain/snapshot.js";

const SECOND = 1_000;
const DAY = 24 * 3600 * SECOND;
const CIRCUIT = "circuito-sintetico";
const RING: readonly string[] = ["T001", "T002", "T003", "T004", "T005", "T006"];
const SAMPLE_BAND: Band = { samples: 30, meanMs: 10 * SECOND, m2: 3_000_000, p50Ms: 10 * SECOND, p80Ms: 12 * SECOND, p95Ms: 14 * SECOND, fenceMs: 44 * SECOND };

function vertex(tagId: string, ring: readonly string[], overrides: Partial<SnapshotVertex> = {}): SnapshotVertex {
  const index = ring.indexOf(tagId);
  const at = index === -1 ? null : index;
  return {
    tagId,
    position: at,
    offsetMs: at === null ? null : at * 10 * SECOND,
    section: null,
    funcion: null,
    declared: true,
    readRate: at === null ? null : 1,
    passes: at === null ? 0 : 40,
    readings: at === null ? 0 : 40,
    nonReaders: [],
    predecessor: at === null ? null : (ring[(at - 1 + ring.length) % ring.length] as string),
    successor: at === null ? null : (ring[(at + 1) % ring.length] as string),
    inventoryClass: "activo",
    situation: at === null ? "sin-lecturas" : "anillo",
    laneId: null,
    isAnchor: at === 0,
    ...overrides,
  };
}

function ringEdges(ring: readonly string[], band: Band | null = SAMPLE_BAND): SnapshotEdge[] {
  return ring.map((from, index) => ({ from, to: ring[(index + 1) % ring.length] as string, produccion: band, noche: null }));
}

interface SnapOptions {
  readonly sourceId?: string;
  readonly day?: number;
  readonly ring?: readonly string[];
  readonly vertices?: readonly SnapshotVertex[];
  readonly edges?: readonly SnapshotEdge[];
  readonly anchorGaps?: readonly SnapshotAnchorGap[];
}

function snap(options: SnapOptions = {}): CircuitSnapshot {
  const ring = options.ring ?? RING;
  const sourceId = options.sourceId ?? "f1";
  const day = options.day ?? 0;
  const window = { from: day * DAY, to: (day + 1) * DAY };
  return buildSnapshot({
    circuitId: CIRCUIT,
    zone: "Europe/Madrid",
    source: { sourceId, sourceHash: `hash-${sourceId}`, fileName: `${sourceId}.csv`, window, acceptedRows: 500 },
    capturedAt: window.to,
    appVersion: "0.0.0-prueba",
    exposure: { produccion: DAY, noche: 0 },
    cohortId: 1,
    anchorTagId: ring[0] ?? null,
    anchorDeclared: true,
    ring,
    lapMs: ring.length * 10 * SECOND,
    vertices: options.vertices ?? ring.map((tagId) => vertex(tagId, ring)),
    edges: options.edges ?? ringEdges(ring),
    sections: [],
    anchorGaps: options.anchorGaps ?? [],
    fleet: { assigned: 3, inCircuitAtEnd: 3, inCircuitMedian: 3, historySource: "historial", vehicles: ["AGV-01", "AGV-02", "AGV-03"] },
    line: null,
    lanes: [],
    findings: [],
  });
}

/** Una versión consolidada mínima: el plano solo lee su anillo, su número y su fichero. */
function version(snapshot: CircuitSnapshot, number = 1): ConsolidatedVersion {
  return {
    schemaVersion: 1,
    circuitId: CIRCUIT,
    version: number,
    createdAt: snapshot.window.to,
    basedOn: { sourceId: snapshot.sourceId, sourceHash: snapshot.sourceHash, fileName: snapshot.fileName, window: snapshot.window },
    previousHash: null,
    hash: `h${number}`,
    lineage: "linaje-A",
    snapshot,
    delta: null,
    decisions: [],
    note: null,
    revoked: null,
    appVersion: "0.0.0-prueba",
  };
}

const BOOT: PlanEvent = bootstrapPlan(version(snap()), { circuitId: CIRCUIT, recordedAt: DAY, reason: "plano inicial" });

/** Un evento del plano con la base rellena. */
function event(seq: number, input: PlanEventInput, reason = "cambio en campo", origin: PlanEvent["origin"] = "manual"): PlanEvent {
  return { ...input, circuitId: CIRCUIT, seq, recordedAt: input.effectiveAt, reason, origin } as PlanEvent;
}

/** Los eventos de una propuesta, convertidos en eventos con número a partir de `events`. */
function accept(events: readonly PlanEvent[], inputs: readonly PlanEventInput[]): PlanEvent[] {
  const out = [...events];
  for (const input of inputs) {
    const candidate = event(out.length + 1, input, "confirmado en campo", "propuesta");
    expect(validateEvent(out, candidate)).toBeNull();
    out.push(candidate);
  }
  return out;
}

const planOf = (events: readonly PlanEvent[], at: number): PhysicalPlan => {
  const plan = planAt(events, at);
  if (plan === null) throw new Error("sin plano");
  return plan;
};

describe("ADR-0016 §6 · momentos combinables", () => {
  const all = [12, 15, 9, 30, 18, 22, 17, 11, 25, 14, 16].map((value) => value * SECOND);

  it("media y varianza de una lista; sin muestras, ceros y sin varianza", () => {
    const moments = momentsOf(all);
    const mean = all.reduce((sum, value) => sum + value, 0) / all.length;
    const variance = all.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (all.length - 1);
    expect(moments.n).toBe(all.length);
    expect(moments.meanMs).toBeCloseTo(mean, 6);
    expect(varianceOf(moments)).toBeCloseTo(variance, 3);
    expect(momentsOf([])).toEqual({ n: 0, meanMs: 0, m2: 0 });
    expect(varianceOf(momentsOf([5]))).toBeNull();
  });

  it("combinar dos mitades da lo mismo que medir todo junto (Chan)", () => {
    const whole = momentsOf(all);
    const combined = combineMoments(momentsOf(all.slice(0, 4)), momentsOf(all.slice(4)));
    expect(combined.n).toBe(whole.n);
    expect(combined.meanMs).toBeCloseTo(whole.meanMs, 6);
    expect(combined.m2).toBeCloseTo(whole.m2, 1);
    expect(combineMoments(whole, momentsOf([]))).toEqual(whole);
    // Dos vacíos dan vacío, sin dividir por cero.
    expect(combineMoments(momentsOf([]), momentsOf([]))).toEqual({ n: 0, meanMs: 0, m2: 0 });
  });

  it("la horquilla trae media y M2 de las mismas duraciones", () => {
    const band = bandOf([...all], 30 * SECOND);
    const moments = momentsOf(all);
    expect(band.samples).toBe(all.length);
    expect(band.meanMs).toBeCloseTo(moments.meanMs, 6);
    expect(band.m2).toBeCloseTo(moments.m2, 1);
  });
});

describe("ADR-0016 §2 · el plano de un instante sale de los eventos", () => {
  const substitution = event(2, { type: "sustituir", locationId: "U-0003", tagId: "T103", effectiveAt: 5 * DAY, evidence: null });

  it("nace de la versión consolidada: una ubicación de anillo por tag, en orden, desde el inicio de su ventana", () => {
    expect(BOOT.type).toBe("crear-plano");
    expect(BOOT.seq).toBe(1);
    expect(BOOT.effectiveAt).toBe(0);
    expect(BOOT.origin).toBe("manual");
    expect(BOOT.evidence?.sourceId).toBe("f1");
    expect(planAt([BOOT], -1)).toBeNull();
    const plan = planOf([BOOT], 0);
    expect(plan.ring).toEqual(["U-0001", "U-0002", "U-0003", "U-0004", "U-0005", "U-0006"]);
    expect(plan.locations.map((location) => location.tagId)).toEqual(RING);
    expect(plan.fromVersion).toBe(1);
  });

  it("antes y después de una sustitución: la ubicación y su historia siguen", () => {
    const events = [substitution, BOOT]; // en cualquier orden
    const before = planOf(events, 4 * DAY).locations.find((location) => location.locationId === "U-0003");
    const after = planOf(events, 6 * DAY).locations.find((location) => location.locationId === "U-0003");
    expect(before?.tagId).toBe("T003");
    expect(after?.tagId).toBe("T103");
    expect(after?.history).toEqual([
      { tagId: "T003", from: 0, to: 5 * DAY },
      { tagId: "T103", from: 5 * DAY, to: null },
    ]);
    expect(describeEvent(substitution, events)).toBe("U-0003: se sustituye T003 por T103.");
    expect(describeEvent(BOOT)).toContain("versión v1");
  });

  it("una ubicación de anillo se inserta detrás de `after`; una salida cuelga sin entrar en el anillo; cerrar une a los vecinos", () => {
    const events = [
      BOOT,
      event(2, { type: "crear-ubicacion", locationId: "U-0007", kind: "anillo", after: "U-0002", branchFrom: null, virtualTag: null, effectiveAt: DAY, evidence: null }),
      event(3, { type: "crear-ubicacion", locationId: "U-0008", kind: "salida", after: null, branchFrom: "U-0004", virtualTag: "T900", effectiveAt: DAY, evidence: null }),
      event(4, { type: "cerrar-ubicacion", locationId: "U-0005", effectiveAt: 2 * DAY, evidence: null }),
    ];
    const plan = planOf(events, 3 * DAY);
    expect(plan.ring).toEqual(["U-0001", "U-0002", "U-0007", "U-0003", "U-0004", "U-0006"]);
    const exit = plan.locations.find((location) => location.locationId === "U-0008");
    expect(exit).toMatchObject({ kind: "salida", branchFrom: "U-0004", virtualTag: "T900", tagId: null });
    expect(plan.locations.some((location) => location.locationId === "U-0005")).toBe(false);
    expect(planOf(events, 1.5 * DAY).ring).toContain("U-0005");
  });

  it("validateEvent dice por qué un evento no vale", () => {
    const base = [BOOT];
    const at = DAY;
    const check = (input: PlanEventInput, reason = "cambio en campo", events: readonly PlanEvent[] = base): string | null =>
      validateEvent(events, event(events.length + 1, input, reason));
    expect(check({ type: "retirar", locationId: "U-0002", effectiveAt: at, evidence: null }, "  ")).toMatch(/razón está vacía/);
    expect(check({ type: "retirar", locationId: "U-0099", effectiveAt: at, evidence: null })).toMatch(/U-0099 no existe/);
    expect(check({ type: "instalar", locationId: "U-0002", tagId: "T777", effectiveAt: at, evidence: null })).toMatch(/ya tiene instalado T002/);
    expect(check({ type: "sustituir", locationId: "U-0002", tagId: "T004", effectiveAt: at, evidence: null })).toMatch(/T004 ya está instalado en U-0004/);
    expect(check({ type: "retirar", locationId: "U-0002", effectiveAt: -DAY, evidence: null })).toMatch(/todavía no hay plano/);
    expect(check({ type: "crear-plano", fromVersion: 2, ring: [{ locationId: "U-0100", tagId: "T100" }], effectiveAt: at, evidence: null })).toMatch(/ya existe/);
    const withdrawn = [...base, event(2, { type: "retirar", locationId: "U-0002", effectiveAt: at, evidence: null })];
    expect(check({ type: "sustituir", locationId: "U-0002", tagId: "T777", effectiveAt: 2 * DAY, evidence: null }, "x", withdrawn)).toMatch(/no tiene tag: para ponerle uno, instálalo/);
    expect(check({ type: "retirar", locationId: "U-0002", effectiveAt: 2 * DAY, evidence: null }, "x", withdrawn)).toMatch(/no tiene tag que retirar/);
    const closed = [...base, event(2, { type: "cerrar-ubicacion", locationId: "U-0006", effectiveAt: at, evidence: null })];
    expect(check({ type: "retirar", locationId: "U-0006", effectiveAt: 2 * DAY, evidence: null }, "x", closed)).toMatch(/U-0006 está cerrada/);
    const exit = [...base, event(2, { type: "crear-ubicacion", locationId: "U-0007", kind: "salida", after: null, branchFrom: "U-0001", virtualTag: null, effectiveAt: at, evidence: null })];
    expect(
      check({ type: "crear-ubicacion", locationId: "U-0008", kind: "salida", after: null, branchFrom: "U-0007", virtualTag: null, effectiveAt: at, evidence: null }, "x", exit),
    ).toMatch(/no es una ubicación del anillo/);
    expect(check({ type: "cerrar-ubicacion", locationId: "U-0001", effectiveAt: 2 * DAY, evidence: null }, "x", exit)).toMatch(/cuelgan salidas \(U-0007\)/);
    // Un evento con fecha anterior a otros ya registrados no puede dejarlos sin valor.
    const later = [...base, event(2, { type: "sustituir", locationId: "U-0002", tagId: "T102", effectiveAt: 5 * DAY, evidence: null })];
    expect(check({ type: "retirar", locationId: "U-0002", effectiveAt: 3 * DAY, evidence: null }, "x", later)).toMatch(/Deja sin valor un evento posterior \(nº 2/);
    expect(check({ type: "revision-manual", locationId: "U-0003", result: "correcto", note: "", effectiveAt: at, evidence: null })).toBeNull();
  });

  it("nextLocationId cuenta todas las ubicaciones creadas y nunca reutiliza una cerrada", () => {
    expect(nextLocationId([])).toBe("U-0001");
    expect(nextLocationId([BOOT])).toBe("U-0007");
    const events = [
      BOOT,
      event(2, { type: "crear-ubicacion", locationId: "U-0007", kind: "anillo", after: "U-0006", branchFrom: null, virtualTag: null, effectiveAt: DAY, evidence: null }),
      event(3, { type: "cerrar-ubicacion", locationId: "U-0007", effectiveAt: 2 * DAY, evidence: null }),
    ];
    expect(nextLocationId(events)).toBe("U-0008");
    expect(planOf(events, 3 * DAY).nextLocationId).toBe("U-0008");
    const reuse = event(4, { type: "crear-ubicacion", locationId: "U-0007", kind: "anillo", after: "U-0001", branchFrom: null, virtualTag: null, effectiveAt: 3 * DAY, evidence: null });
    expect(validateEvent(events, reuse)).toMatch(/U-0007 ya se usó/);
  });
});

/** Una sección entre anclas con una sola ancla (T001): la vuelta entera. */
function lapGap(passes: number, reads: Readonly<Record<string, { passes: number; vehicles: number }>>): SnapshotAnchorGap {
  return { fromAnchor: "T001", toAnchor: "T001", tags: RING.slice(1), produccion: null, noche: null, passes, readsByTag: reads };
}

/** El anillo del fichero sin T004: no se leyó ni una vez. */
const WITHOUT_T004 = RING.filter((tagId) => tagId !== "T004");

describe("ADR-0016 §4 · el fichero leído contra el plano", () => {
  it("un tag leído queda observado con sus pasadas probadas, y la tasa nunca va sin su número", () => {
    const observation = observeAgainstPlan(planOf([BOOT], DAY), snap());
    const location = observation.locations.find((entry) => entry.locationId === "U-0002");
    expect(location).toMatchObject({ state: "observado", truth: "observed", evaluable: 40, successes: 40, omissions: 0, uncertain: null });
    expect(observation.planAt).toBe(DAY);
    expect(observation.unplanned).toEqual([]);
    expect(observation.edges).toHaveLength(6);
    expect(observation.edges[0]).toMatchObject({ fromLocation: "U-0001", toLocation: "U-0002", composite: false, produccion: { n: 30, meanMs: 10 * SECOND, m2: 3_000_000 }, noche: null });
  });

  it("con lecturas a medias, los aciertos son la tasa por las pasadas", () => {
    const vertices = RING.map((tagId) => (tagId === "T003" ? vertex(tagId, RING, { readRate: 0.75, readings: 30 }) : vertex(tagId, RING)));
    const location = observeAgainstPlan(planOf([BOOT], DAY), snap({ vertices })).locations.find((entry) => entry.locationId === "U-0003");
    expect(location).toMatchObject({ state: "observado", evaluable: 40, successes: 30, omissions: 10 });
  });

  it("un tag no leído entre vecinos leídos queda «no observado» con las pasadas de la arista, inferido; la arista que lo salta es compuesta", () => {
    const snapshot = snap({ ring: WITHOUT_T004, vertices: [...WITHOUT_T004.map((tagId) => vertex(tagId, WITHOUT_T004)), vertex("T004", WITHOUT_T004)] });
    const observation = observeAgainstPlan(planOf([BOOT], DAY), snapshot);
    const location = observation.locations.find((entry) => entry.locationId === "U-0004");
    expect(location).toMatchObject({ tagId: "T004", state: "no-observado", truth: "inferred", evaluable: 30, successes: 0, omissions: 30, uncertain: null });
    expect(location?.detail).toContain("T003 (U-0003) y T005 (U-0005)");
    const jump = observation.edges.find((edge) => edge.fromLocation === "U-0003");
    expect(jump).toMatchObject({ toLocation: "U-0005", composite: true });
  });

  it("con secciones entre anclas, las oportunidades son las pasadas completas de ancla a ancla", () => {
    const reads = { T002: { passes: 50, vehicles: 3 }, T003: { passes: 48, vehicles: 3 }, T005: { passes: 50, vehicles: 3 }, T006: { passes: 50, vehicles: 3 } };
    const snapshot = snap({ ring: WITHOUT_T004, vertices: WITHOUT_T004.map((tagId) => vertex(tagId, WITHOUT_T004)), anchorGaps: [lapGap(50, reads)] });
    const observation = observeAgainstPlan(planOf([BOOT], DAY), snapshot);
    expect(observation.locations.find((entry) => entry.locationId === "U-0003")).toMatchObject({ state: "observado", evaluable: 50, successes: 48, omissions: 2 });
    expect(observation.locations.find((entry) => entry.locationId === "U-0004")).toMatchObject({ state: "no-observado", truth: "inferred", evaluable: 50, successes: 0 });
    // El ancla no está entre sus propias anclas: se cuenta por su vértice.
    expect(observation.locations.find((entry) => entry.locationId === "U-0001")).toMatchObject({ state: "observado", evaluable: 40 });
  });

  it("sin prueba de paso es «sin ocasión», desconocido; una ubicación sin tag no da oportunidades", () => {
    const events = [BOOT, event(2, { type: "retirar", locationId: "U-0005", effectiveAt: DAY / 2, evidence: null })];
    // Sin T004 ni aristas: no hay con qué probar el paso por U-0004.
    const snapshot = snap({ ring: WITHOUT_T004, vertices: WITHOUT_T004.map((tagId) => vertex(tagId, WITHOUT_T004)), edges: [] });
    const observation = observeAgainstPlan(planOf(events, DAY), snapshot);
    expect(observation.locations.find((entry) => entry.locationId === "U-0004")).toMatchObject({ state: "sin-ocasion", truth: "unknown", evaluable: 0, successes: 0, uncertain: null });
    expect(observation.locations.find((entry) => entry.locationId === "U-0005")).toMatchObject({ tagId: null, state: "sin-tag", truth: "expected", evaluable: 0, uncertain: 0 });
    // T005 se lee pero ya no está instalado en ninguna ubicación: fuera del plano, entre U-0003 y U-0006.
    expect(observation.unplanned).toEqual([{ tagId: "T005", readings: 40, passes: 40, after: "U-0003", before: "U-0006" }]);
  });

  it("un tag del anillo con cero pasadas probadas no se cuenta por su vértice ni lleva desglose por AGV, aunque lo traiga", () => {
    // T003 leído fuera de toda pasada probada (p. ej. solo en vueltas cortadas): la matriz no prueba nada.
    const vertices = RING.map((tagId) => (tagId === "T003" ? vertex(tagId, RING, { passes: 0, readRate: null, readings: 3, byVehicle: { "AGV-01": [0, 0] } }) : vertex(tagId, RING)));
    const location = observeAgainstPlan(planOf([BOOT], DAY), snap({ vertices }), { minPassesPerPair: 1 }).locations.find((entry) => entry.locationId === "U-0003");
    expect(location).toMatchObject({ state: "sin-ocasion", truth: "unknown", evaluable: 0, successes: 0 });
    expect(location?.byVehicle).toBeUndefined();
    expect(location?.vehiclesBelowSample).toBeUndefined();
  });

  it("una ubicación sin tag con código virtual declarado sigue sin oportunidades, y lo dice", () => {
    const create: PlanEventInput = { type: "crear-ubicacion", locationId: "U-0007", kind: "anillo", after: "U-0003", branchFrom: null, virtualTag: "T777", effectiveAt: DAY / 2, evidence: null };
    const location = observeAgainstPlan(planOf([BOOT, event(2, create)], DAY), snap()).locations.find((entry) => entry.locationId === "U-0007");
    expect(location).toMatchObject({ tagId: null, state: "sin-tag", truth: "expected", evaluable: 0, successes: 0, uncertain: 0 });
    expect(location?.detail).toContain("T777");
  });

  it("una salida no se lee: su estado es la revisión manual, confirmada si la hay", () => {
    const exit = event(2, { type: "crear-ubicacion", locationId: "U-0007", kind: "salida", after: null, branchFrom: "U-0002", virtualTag: null, effectiveAt: 0, evidence: null });
    const install = event(3, { type: "instalar", locationId: "U-0007", tagId: "T900", effectiveAt: 0, evidence: null });
    const without = observeAgainstPlan(planOf([BOOT, exit, install], DAY), snap()).locations.find((entry) => entry.locationId === "U-0007");
    expect(without).toMatchObject({ kind: "salida", tagId: "T900", state: "revision-manual", truth: "unknown", evaluable: 0 });
    const review = event(4, { type: "revision-manual", locationId: "U-0007", result: "correcto", note: "tag en su sitio", effectiveAt: DAY / 2, evidence: null });
    const withReview = observeAgainstPlan(planOf([BOOT, exit, install, review], DAY), snap()).locations.find((entry) => entry.locationId === "U-0007");
    expect(withReview).toMatchObject({ state: "revision-manual", truth: "confirmed", evaluable: 0 });
    expect(withReview?.detail).toContain("correcto (tag en su sitio)");
  });

  it("una instantánea anterior a 3.53.0 (horquilla sin media ni M2) deja ese régimen sin momentos", () => {
    const { meanMs: _mean, m2: _m2, ...old } = SAMPLE_BAND;
    const observation = observeAgainstPlan(planOf([BOOT], DAY), snap({ edges: ringEdges(RING, old) }));
    expect(observation.edges[0]?.produccion).toBeNull();
  });
});

describe("ADR-0016 §3 · propuestas (solo propuestas)", () => {
  const CONTEXT = { declaredExits: [] as readonly string[], minVehicles: 2 };

  it("sustitución: un código nuevo donde una ubicación deja de leerse, entre los mismos vecinos", () => {
    const ring = ["T001", "T002", "T003", "T104", "T005", "T006"];
    const reads = { T002: { passes: 50, vehicles: 3 }, T003: { passes: 50, vehicles: 3 }, T104: { passes: 49, vehicles: 3 }, T005: { passes: 50, vehicles: 3 }, T006: { passes: 50, vehicles: 3 } };
    const snapshot = snap({ sourceId: "f2", day: 3, ring, vertices: [...ring.map((tagId) => vertex(tagId, ring)), vertex("T004", ring)], anchorGaps: [lapGap(50, reads)] });
    const plan = planOf([BOOT], snapshot.window.to);
    const observation = observeAgainstPlan(plan, snapshot);
    expect(observation.unplanned).toEqual([{ tagId: "T104", readings: 40, passes: 40, after: "U-0003", before: "U-0005" }]);
    const proposals = proposeChanges(plan, observation, snapshot, CONTEXT);
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal?.id).toBe("sustitucion|T104|U-0004");
    expect(proposal?.kind).toBe("sustitucion");
    expect(proposal?.detail).toContain("50 pasadas");
    expect(proposal?.evidence).toMatchObject({ sourceId: "f2", fileName: "f2.csv" });
    expect(proposal?.events).toEqual([{ type: "sustituir", locationId: "U-0004", tagId: "T104", effectiveAt: 3 * DAY, evidence: proposal?.evidence }]);
    // Confirmada, el plano la lleva y la ubicación sigue: el fichero se lee observado en U-0004.
    const events = accept([BOOT], proposal?.events ?? []);
    const after = observeAgainstPlan(planOf(events, snapshot.window.to), snapshot);
    expect(after.locations.find((entry) => entry.locationId === "U-0004")).toMatchObject({ tagId: "T104", state: "observado", successes: 49 });
    expect(proposeChanges(planOf(events, snapshot.window.to), after, snapshot, CONTEXT)).toEqual([]);
  });

  it("sustitución: el código nuevo tiene que leerlo más de un AGV (R-DAT-021); con uno, o sin saber cuántos, no se propone", () => {
    const ring = ["T001", "T002", "T003", "T104", "T005", "T006"];
    const reads = (vehicles: number): Record<string, { passes: number; vehicles: number }> => ({
      T002: { passes: 50, vehicles: 3 },
      T003: { passes: 50, vehicles: 3 },
      T104: { passes: 49, vehicles },
      T005: { passes: 50, vehicles: 3 },
      T006: { passes: 50, vehicles: 3 },
    });
    const build = (gaps: readonly SnapshotAnchorGap[]): CircuitSnapshot =>
      snap({ sourceId: "f2", day: 3, ring, vertices: [...ring.map((tagId) => vertex(tagId, ring)), vertex("T004", ring)], anchorGaps: gaps });
    const proposalsFor = (snapshot: CircuitSnapshot): ReturnType<typeof proposeChanges> => {
      const plan = planOf([BOOT], snapshot.window.to);
      return proposeChanges(plan, observeAgainstPlan(plan, snapshot), snapshot, CONTEXT);
    };
    // Un solo lector: lo de un lector es de ese lector, también cuando parece una sustitución.
    expect(proposalsFor(build([lapGap(50, reads(1))]))).toEqual([]);
    // La sección no dice quién leyó T104: no se sabe si lo sostiene más de un AGV, y no se supone.
    const { T104: _unknown, ...withoutNew } = reads(3);
    expect(proposalsFor(build([lapGap(50, withoutNew)]))).toEqual([]);
    // Dos lectores: se propone, y las pasadas del detalle son las de la sección, no las probadas del vértice.
    const two = proposalsFor(build([lapGap(50, reads(2))]));
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({ id: "sustitucion|T104|U-0004", kind: "sustitucion" });
    expect(two[0]?.detail).toContain("T104 se leyó en 49 pasadas por 2 AGV distintos");
    expect(two[0]?.detail).toContain("ninguna de 50 pasadas");
  });

  it("tag nuevo: leído por al menos dos AGV distintos entre dos ubicaciones; con uno, o sin saber cuántos, no se propone", () => {
    const ring = ["T001", "T002", "T050", "T003", "T004", "T005", "T006"];
    const reads = (vehicles: number): Record<string, { passes: number; vehicles: number }> => ({
      ...Object.fromEntries(RING.slice(1).map((tagId) => [tagId, { passes: 50, vehicles: 3 }])),
      T050: { passes: 45, vehicles },
    });
    const build = (gaps: readonly SnapshotAnchorGap[]): CircuitSnapshot => snap({ sourceId: "f3", day: 4, ring, vertices: ring.map((tagId) => vertex(tagId, ring)), anchorGaps: gaps });
    const proposalsFor = (snapshot: CircuitSnapshot): ReturnType<typeof proposeChanges> => {
      const plan = planOf([BOOT], snapshot.window.to);
      return proposeChanges(plan, observeAgainstPlan(plan, snapshot), snapshot, CONTEXT);
    };

    const two = build([{ ...lapGap(50, reads(2)), tags: ring.slice(1) }]);
    const proposals = proposalsFor(two);
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal).toMatchObject({ id: "tag-nuevo|T050|U-0002", kind: "tag-nuevo" });
    expect(proposal?.detail).toContain("2 AGV distintos");
    expect(proposal?.events.map((entry) => entry.type)).toEqual(["crear-ubicacion", "instalar"]);
    expect(proposal?.events[0]).toMatchObject({ locationId: "U-0007", kind: "anillo", after: "U-0002", effectiveAt: 4 * DAY });
    const events = accept([BOOT], proposal?.events ?? []);
    expect(planOf(events, two.window.to).ring).toEqual(["U-0001", "U-0002", "U-0007", "U-0003", "U-0004", "U-0005", "U-0006"]);

    expect(proposalsFor(build([{ ...lapGap(50, reads(1)), tags: ring.slice(1) }]))).toEqual([]);
    expect(proposalsFor(build([]))).toEqual([]);
  });

  it("salida sin ubicar: un tag de parada declarado sin ubicación ni código virtual en el plano", () => {
    const snapshot = snap({ sourceId: "f4", day: 2 });
    const plan = planOf([BOOT], snapshot.window.to);
    const proposals = proposeChanges(plan, observeAgainstPlan(plan, snapshot), snapshot, { ...CONTEXT, declaredExits: ["T900"] });
    expect(proposals).toHaveLength(1);
    const proposal = proposals[0];
    expect(proposal).toMatchObject({ id: "salida-sin-ubicar|T900|-", kind: "salida-sin-ubicar" });
    expect(proposal?.events[0]).toMatchObject({ type: "crear-ubicacion", kind: "salida", branchFrom: null, after: null, effectiveAt: 2 * DAY });
    expect(proposal?.events[1]).toMatchObject({ type: "instalar", tagId: "T900" });
    // La persona elige de dónde cuelga al aceptarla; sin eso el evento no vale.
    const [create, install] = proposal?.events ?? [];
    expect(validateEvent([BOOT], event(2, create as PlanEventInput))).toMatch(/tiene que colgar/);
    const events = accept([BOOT], [{ ...(create as PlanEventInput & { type: "crear-ubicacion" }), branchFrom: "U-0003" }, install as PlanEventInput]);
    const placed = planOf(events, snapshot.window.to);
    expect(proposeChanges(placed, observeAgainstPlan(placed, snapshot), snapshot, { ...CONTEXT, declaredExits: ["T900"] })).toEqual([]);
    // Un código virtual declarado en una ubicación también cuenta como ubicado.
    const virtual = [BOOT, event(2, { type: "crear-ubicacion", locationId: "U-0007", kind: "salida", after: null, branchFrom: "U-0001", virtualTag: "T900", effectiveAt: 0, evidence: null })];
    const withVirtual = planOf(virtual, snapshot.window.to);
    expect(proposeChanges(withVirtual, observeAgainstPlan(withVirtual, snapshot), snapshot, { ...CONTEXT, declaredExits: ["T900"] })).toEqual([]);
  });
});

describe("ADR-0016 §4 · la evolución leída con el plano", () => {
  it("un «desaparece» de un tag instalado pasa a «no-observado» con sus pasadas; lo demás queda igual", () => {
    const before = snap();
    const after = snap({ sourceId: "f2", day: 1, ring: WITHOUT_T004, vertices: [...WITHOUT_T004.map((tagId) => vertex(tagId, WITHOUT_T004)), vertex("T004", WITHOUT_T004)] });
    const delta = compareSnapshots(before, after);
    expect(delta.vertices.find((entry) => entry.tagId === "T004")?.kind).toBe("desaparece");
    const observation = observeAgainstPlan(planOf([BOOT], after.window.to), after);
    const read = reinterpretDelta(delta, observation);
    const t004 = read.vertices.find((entry) => entry.tagId === "T004");
    expect(t004?.kind).toBe("no-observado");
    expect(t004?.detail).toBe("T004 sigue en su ubicación U-0004; 30 pasadas por su sitio sin leerlo.");
    expect(read.vertices.filter((entry) => entry.tagId !== "T004")).toEqual(delta.vertices.filter((entry) => entry.tagId !== "T004"));
    expect(delta.vertices.find((entry) => entry.tagId === "T004")?.kind).toBe("desaparece"); // copia, no mutación
    expect(reinterpretDelta(delta, null)).toEqual(delta);
  });
});

describe("ADR-0016 §6 · resumen por periodos", () => {
  it("dos periodos combinados dan lo mismo que uno con todas las muestras; las oportunidades se suman", () => {
    const durations = [9, 10, 11, 10, 12, 30, 10, 9, 11, 10, 13, 10].map((value) => value * SECOND);
    const first = bandOf(durations.slice(0, 5), 30 * SECOND);
    const second = bandOf(durations.slice(5), 30 * SECOND);
    const early = snap({ sourceId: "f1", day: 1, edges: ringEdges(RING, first) });
    const late = snap({ sourceId: "f2", day: 2, edges: ringEdges(RING, second) });
    const observations = [late, early].map((snapshot) => observeAgainstPlan(planOf([BOOT], snapshot.window.to), snapshot));
    const summary = summarizePlan(observations);
    const edge = summary.edges.find((entry) => entry.fromLocation === "U-0001" && entry.toLocation === "U-0002");
    const whole = momentsOf(durations);
    expect(edge?.periods).toBe(2);
    expect(edge?.composite).toBe(false);
    expect(edge?.produccion?.n).toBe(whole.n);
    expect(edge?.produccion?.meanMs).toBeCloseTo(whole.meanMs, 6);
    expect(edge?.produccion?.m2).toBeCloseTo(whole.m2, 1);
    expect(edge?.noche).toBeNull();
    const location = summary.locations.find((entry) => entry.locationId === "U-0002");
    expect(location?.periods.map((period) => period.sourceId)).toEqual(["f1", "f2"]);
    expect(location?.total).toEqual({ evaluable: 80, successes: 80, omissions: 0, uncertain: null });
    expect(location?.tagId).toBe("T002");
  });
});

describe("R-MEM-004 · desglose por AGV de cada ubicación", () => {
  const SAMPLE = { minPassesPerPair: 3 };
  /** T003 con tres AGV: uno lo lee siempre, otro casi nunca y otro con solo dos pasadas. */
  const T003_CELLS: Readonly<Record<string, SnapshotVehicleCell>> = { "AGV-01": [20, 20], "AGV-02": [20, 2], "AGV-03": [2, 2] };
  const withCells = (cells: NonNullable<SnapshotVertex["byVehicle"]>, options: SnapOptions = {}): CircuitSnapshot =>
    snap({
      ...options,
      vertices: RING.map((tagId) =>
        tagId === "T003"
          ? vertex(tagId, RING, { passes: 42, readRate: 24 / 42, readings: 24, byVehicle: cells })
          : vertex(tagId, RING, { byVehicle: { "AGV-01": [40, 40] } }),
      ),
    });

  it("da la tasa por AGV solo a los que llegan a la muestra mínima, con sus pasadas; los demás se cuentan aparte", () => {
    const location = observeAgainstPlan(planOf([BOOT], DAY), withCells(T003_CELLS), SAMPLE).locations.find((entry) => entry.locationId === "U-0003");
    expect(location).toMatchObject({ state: "observado", evaluable: 42, successes: 24 });
    expect(location?.byVehicle).toEqual([
      { agvId: "AGV-01", evaluable: 20, successes: 20, omissions: 0 },
      { agvId: "AGV-02", evaluable: 20, successes: 2, omissions: 18 },
    ]);
    expect(location?.vehiclesBelowSample).toBe(1);
    expect(location?.belowSample).toEqual([{ agvId: "AGV-03", evaluable: 2, successes: 2, omissions: 0 }]);
  });

  it("en el límite de la muestra entra; sin muestra configurada, sin instantánea con desglose o en el ancla no hay desglose", () => {
    const edge = observeAgainstPlan(planOf([BOOT], DAY), withCells({ "AGV-01": [3, 0], "AGV-02": [2, 0] }), SAMPLE);
    const u3 = edge.locations.find((entry) => entry.locationId === "U-0003");
    expect(u3?.byVehicle?.map((cell) => cell.agvId)).toEqual(["AGV-01"]);
    expect(u3?.vehiclesBelowSample).toBe(1);
    const noSample = observeAgainstPlan(planOf([BOOT], DAY), withCells(T003_CELLS)).locations.find((entry) => entry.locationId === "U-0003");
    expect(noSample?.byVehicle).toBeUndefined();
    const oldSnapshot = observeAgainstPlan(planOf([BOOT], DAY), snap(), SAMPLE).locations.find((entry) => entry.locationId === "U-0003");
    expect(oldSnapshot?.byVehicle).toBeUndefined();
    expect(oldSnapshot?.vehiclesBelowSample).toBeUndefined();
    // El ancla (T001) lee 1 por construcción: no se desglosa.
    expect(edge.locations.find((entry) => entry.locationId === "U-0001")?.byVehicle).toBeUndefined();
    expect(edge.locations.find((entry) => entry.locationId === "U-0002")?.byVehicle).toHaveLength(1);
  });

  it("solo con muestras por debajo del mínimo no hay tasa por AGV y se dice cuántos son", () => {
    const location = observeAgainstPlan(planOf([BOOT], DAY), withCells({ "AGV-01": [2, 1], "AGV-02": [1, 0] }), SAMPLE).locations.find(
      (entry) => entry.locationId === "U-0003",
    );
    expect(location?.byVehicle).toEqual([]);
    expect(location?.vehiclesBelowSample).toBe(2);
    const summary = summarizePlan([observeAgainstPlan(planOf([BOOT], DAY), withCells({ "AGV-01": [2, 1] }), SAMPLE)], SAMPLE);
    expect(summary.locations.find((entry) => entry.locationId === "U-0003")?.byVehicle).toMatchObject({ lower: [], others: [], vehiclesBelowSample: 1 });
  });

  it("dos periodos se suman por AGV; la muestra se aplica a la suma y los que leen menos que la flota van primero", () => {
    const early = withCells(T003_CELLS, { sourceId: "f1", day: 1 });
    const late = withCells({ "AGV-01": [10, 10], "AGV-02": [5, 1], "AGV-03": [2, 1], "AGV-04": [10, 9] }, { sourceId: "f2", day: 2 });
    const observations = [late, early].map((snapshot) => observeAgainstPlan(planOf([BOOT], snapshot.window.to), snapshot, SAMPLE));
    const location = summarizePlan(observations, SAMPLE).locations.find((entry) => entry.locationId === "U-0003");
    // Flota: 30+25+4+10 = 69 pasadas, 30+3+3+9 = 45 aciertos (65 %).
    expect(location?.byVehicle).toEqual({
      periods: 2,
      minPasses: 3,
      fleet: { evaluable: 69, successes: 45, omissions: 24 },
      lower: [{ agvId: "AGV-02", evaluable: 25, successes: 3, omissions: 22 }],
      // AGV-03 no llega en ningún periodo por separado (2 y 2) y sí en la suma (4).
      others: [
        { agvId: "AGV-01", evaluable: 30, successes: 30, omissions: 0 },
        { agvId: "AGV-03", evaluable: 4, successes: 3, omissions: 1 },
        { agvId: "AGV-04", evaluable: 10, successes: 9, omissions: 1 },
      ],
      vehiclesBelowSample: 0,
    });
    // Sin muestra configurada, el resumen no desglosa; el total no cambia.
    expect(summarizePlan(observations).locations.find((entry) => entry.locationId === "U-0003")?.byVehicle).toBeUndefined();
  });

  it("un periodo sin desglose (instantánea anterior) no entra en las cifras por AGV y se cuenta", () => {
    const observations = [snap({ sourceId: "f0", day: 0 }), withCells(T003_CELLS, { sourceId: "f1", day: 1 })].map((snapshot) =>
      observeAgainstPlan(planOf([BOOT], snapshot.window.to), snapshot, SAMPLE),
    );
    const location = summarizePlan(observations, SAMPLE).locations.find((entry) => entry.locationId === "U-0003");
    expect(location?.periods).toHaveLength(2);
    expect(location?.byVehicle).toMatchObject({ periods: 1, fleet: { evaluable: 42, successes: 24 }, vehiclesBelowSample: 1 });
    expect(location?.byVehicle?.lower.map((cell) => cell.agvId)).toEqual(["AGV-02"]);
  });
});

describe("ADR-0016 · el plano de un .agvproj frente al local (append-only)", () => {
  const second = event(2, { type: "sustituir", locationId: "U-0003", tagId: "T103", effectiveAt: 5 * DAY, evidence: null });
  const third = event(3, { type: "retirar", locationId: "U-0005", effectiveAt: 6 * DAY, evidence: null });

  it("clasifica sin plano, idéntico, local adelantado, entrante adelantado y distinto", () => {
    expect(classifyPlanEvents([BOOT], [])).toEqual({ relation: "sin-plano", missing: [] });
    expect(classifyPlanEvents([BOOT, second], [second, BOOT])).toEqual({ relation: "identico", missing: [] });
    expect(classifyPlanEvents([BOOT, second, third], [BOOT, second])).toEqual({ relation: "local-adelantado", missing: [] });
    expect(classifyPlanEvents([BOOT], [BOOT, second, third])).toEqual({ relation: "entrante-adelantado", missing: [second, third] });
    expect(classifyPlanEvents([], [BOOT, second])).toEqual({ relation: "entrante-adelantado", missing: [BOOT, second] });
    const other = { ...second, tagId: "T203" } as PlanEvent;
    expect(classifyPlanEvents([BOOT, second], [BOOT, other, third])).toEqual({ relation: "distinto", missing: [] });
  });
});
