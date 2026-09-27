/**
 * La memoria consolidada del circuito (F4; ADR-0005, ADR-0015 §4, R-MEM-001..003).
 *
 * Lo que se fija, con un anillo sintético de seis tags y una flota inventada: la previsualización
 * bloquea solo lo pendiente (propietario, 2026-09-23); un rango 1 confirmado es una incidencia que no
 * bloquea y queda fuera del esperado (OQ-148, propietario 2026-09-27); lo
 * pospuesto pasa con aviso y volverá como pendiente; un mismo fichero no se consolida dos veces salvo
 * revocación; una bifurcación sin resolver bloquea; las versiones encadenan hash y delta; revocar no
 * muta y la vigente salta las revocadas; la relación entre linajes se clasifica por la cadena de
 * hashes en sus cinco casos; y el estado de linaje aplica la elección humana sin fusionar nada.
 */

import { describe, expect, it } from "vitest";

import {
  classifyLineage,
  compareToMemory,
  consolidate,
  currentVersion,
  emptyLineageState,
  MEMORY_SCHEMA_VERSION,
  previewConsolidation,
  previewWithoutSnapshot,
  resolveFork,
  withForeignEvents,
  revokeVersion,
  versionBytes,
  versionHash,
  versionsOfLineage,
  withConsolidated,
  withIncoming,
  type ConsolidatedVersion,
  type ConsolidationInput,
} from "../../src/domain/memory.js";
import type { ReviewEntry } from "../../src/domain/review.js";
import { compareSnapshots, buildSnapshot, type CircuitSnapshot, type SnapshotFinding, type SnapshotVertex } from "../../src/domain/snapshot.js";

const SECOND = 1_000;
const DAY = 24 * 3600 * SECOND;
const RING: readonly string[] = ["T001", "T002", "T003", "T004", "T005", "T006"];
const THRESHOLDS = { maxChance: 0.001 };

function vertex(tagId: string, ring: readonly string[], overrides: Partial<SnapshotVertex> = {}): SnapshotVertex {
  const at = ring.indexOf(tagId);
  return {
    tagId,
    position: at,
    offsetMs: at * 10 * SECOND,
    section: null,
    funcion: null,
    declared: true,
    readRate: 1,
    passes: 40,
    readings: 40,
    nonReaders: [],
    predecessor: ring[(at - 1 + ring.length) % ring.length] as string,
    successor: ring[(at + 1) % ring.length] as string,
    inventoryClass: "activo",
    situation: "anillo",
    laneId: null,
    isAnchor: at === 0,
    ...overrides,
  };
}

function snap(overrides: { sourceId?: string; ring?: readonly string[]; findings?: readonly SnapshotFinding[]; day?: number; vertices?: readonly SnapshotVertex[] } = {}): CircuitSnapshot {
  const ring = overrides.ring ?? RING;
  const sourceId = overrides.sourceId ?? "f1";
  const day = overrides.day ?? 0;
  const window = { from: day * DAY, to: (day + 1) * DAY };
  return buildSnapshot({
    circuitId: "circuito-sintetico",
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
    vertices: overrides.vertices ?? ring.map((tagId) => vertex(tagId, ring)),
    edges: ring.map((from, index) => ({ from, to: ring[(index + 1) % ring.length] as string, produccion: null, noche: null })),
    sections: [],
    anchorGaps: [],
    fleet: { assigned: 2, inCircuitAtEnd: 2, inCircuitMedian: 2, historySource: "historial", vehicles: ["AGV-01", "AGV-02"] },
    line: null,
    lanes: [],
    findings: overrides.findings ?? [],
  });
}

const finding = (kind: string, subject: string): SnapshotFinding => ({
  key: `${kind}|${subject}`,
  kind,
  title: `${kind} de ${subject}`,
  figure: "1 vez",
  review: null,
});

function review(key: string, state: ReviewEntry["state"], note = ""): [string, ReviewEntry] {
  return [key, { key, state, note, updatedAt: 1, title: key, figure: "1 vez" }];
}

/** Rango por tipo, como el catálogo: solo lo que la prueba necesita. */
const RANK: Readonly<Record<string, number>> = { "tag-rotura": 1, "tag-deja": 2, deriva: 3 };
const rankOf = (kind: string): number => RANK[kind] ?? 3;

function input(overrides: Partial<ConsolidationInput> = {}): ConsolidationInput {
  return { snapshot: snap(), reviews: new Map(), versions: [], rankOf, forkUnresolved: false, thresholds: THRESHOLDS, ...overrides };
}

const CONTEXT = { circuitId: "circuito-sintetico", lineage: "linaje-A", appVersion: "0.0.0-prueba", now: 10 * DAY, note: null };

async function version1(): Promise<ConsolidatedVersion> {
  const snapshot = snap();
  return consolidate(previewConsolidation(input({ snapshot })), { ...CONTEXT, snapshot });
}

describe("previsualización · §6 paso E", () => {
  it("bloquea solo por lo pendiente: sin marca o con `review` nulo", () => {
    const snapshot = snap({ findings: [finding("tag-deja", "T002"), finding("deriva", "T003"), finding("tag-deja", "T004")] });
    const reviews = new Map([review("tag-deja|T002", "confirmado"), review("deriva|T003", "descartado")]);
    const preview = previewConsolidation(input({ snapshot, reviews }));
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual(["hallazgos-pendientes"]);
    expect(preview.blockers[0]?.items).toEqual(["tag-deja|T004"]);
    // Las decisiones incluyen todas, la pendiente también: solo existe en la previsualización.
    expect(preview.decisions.map((decision) => [decision.key, decision.state])).toEqual([
      ["deriva|T003", "descartado"],
      ["tag-deja|T002", "confirmado"],
      ["tag-deja|T004", "pendiente"],
    ]);
  });

  // Cambia por decisión del propietario (2026-09-27, OQ-148): antes un rango 1 confirmado bloqueaba
  // con `periodo-de-incidencia`; ahora el periodo se consolida entero, el hallazgo va a `incidents`
  // con lo que toca y eso queda fuera del esperado.
  it("un hallazgo de rango 1 confirmado es una incidencia: no bloquea y va a `incidents` con lo que toca (OQ-148)", async () => {
    const snapshot = snap({ findings: [finding("tag-rotura", "T005"), finding("tag-deja", "T002")] });
    const reviews = new Map([review("tag-rotura|T005", "confirmado"), review("tag-deja|T002", "confirmado")]);
    const preview = previewConsolidation(input({ snapshot, reviews }));
    expect(preview.blockers).toEqual([]);
    expect(preview.incidents).toEqual([
      {
        key: "tag-rotura|T005",
        kind: "tag-rotura",
        title: "tag-rotura de T005",
        figure: "1 vez",
        subjects: [
          "vertice|T005",
          "arista|T004|T005|produccion",
          "arista|T004|T005|noche",
          "arista|T005|T006|produccion",
          "arista|T005|T006|noche",
        ],
      },
    ]);
    // Primera versión: el esperado es lo observado salvo la incidencia, que queda sin medida.
    const v1 = await consolidate(preview, { ...CONTEXT, snapshot });
    expect(v1.incidents).toEqual(preview.incidents);
    expect(v1.changes).toEqual([]);
    const t005 = v1.expected?.vertices.find((vertex) => vertex.tagId === "T005");
    expect(t005).toMatchObject({ readRate: null, passes: 0, readings: 0 });
    expect(v1.snapshot.vertices.find((vertex) => vertex.tagId === "T005")?.readRate).toBe(1);
    expect(await versionHash(v1)).toBe(v1.hash);
    // Un rango 1 descartado o pospuesto no es incidencia.
    const otra = previewConsolidation(input({ snapshot, reviews: new Map([review("tag-rotura|T005", "descartado"), review("tag-deja|T002", "pospuesto", "sin acceso")]) }));
    expect(otra.blockers).toEqual([]);
    expect(otra.incidents).toEqual([]);
  });

  it("lo pospuesto pasa con aviso, con su motivo, y volverá como pendiente en el periodo siguiente", () => {
    const snapshot = snap({ findings: [finding("tag-deja", "T002")] });
    const preview = previewConsolidation(input({ snapshot, reviews: new Map([review("tag-deja|T002", "pospuesto", "falta acceso a la zona")]) }));
    expect(preview.blockers).toEqual([]);
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatch(/pendiente en el periodo siguiente/);
    expect(preview.warnings[0]).toContain("falta acceso a la zona");
    expect(preview.decisions[0]).toMatchObject({ state: "pospuesto", note: "falta acceso a la zona" });
  });

  it("un fichero ya consolidado en una versión vigente bloquea; revocada, no", async () => {
    const v1 = await version1();
    const repeated = previewConsolidation(input({ versions: [v1] }));
    expect(repeated.blockers.map((blocker) => blocker.code)).toEqual(["ya-consolidada"]);
    expect(repeated.blockers[0]?.items).toEqual(["v1"]);
    const revoked = revokeVersion(v1, "fichero equivocado", 11 * DAY);
    expect(previewConsolidation(input({ versions: [revoked] })).blockers).toEqual([]);
  });

  it("una bifurcación sin resolver bloquea", () => {
    const preview = previewConsolidation(input({ forkUnresolved: true }));
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual(["bifurcacion-sin-resolver"]);
  });

  it("la primera versión no tiene anterior: `previous` y `delta` nulos, y el tamaño estimado es positivo", () => {
    const preview = previewConsolidation(input());
    expect(preview.previous).toBeNull();
    expect(preview.delta).toBeNull();
    expect(preview.nextVersion).toBe(1);
    expect(preview.estimatedBytes).toBeGreaterThan(0);
  });

  it("sin instantánea, la previsualización solo dice eso", () => {
    const preview = previewWithoutSnapshot({ sourceId: "f9", sourceHash: "hash-f9", fileName: "f9.csv", window: { from: 0, to: DAY } }, []);
    expect(preview.blockers.map((blocker) => blocker.code)).toEqual(["sin-instantanea"]);
    expect(preview.blockers[0]?.items).toEqual(["f9"]);
  });
});

describe("consolidar · §6 paso G, §10 cadena de hashes", () => {
  it("la primera versión nace con `previousHash` y `delta` nulos y su hash es el semántico con `hash: \"\"`", async () => {
    const v1 = await version1();
    expect(v1).toMatchObject({ schemaVersion: MEMORY_SCHEMA_VERSION, version: 1, previousHash: null, delta: null, lineage: "linaje-A", revoked: null });
    expect(v1.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await versionHash(v1)).toBe(v1.hash);
    expect(versionBytes(v1)).toBeGreaterThan(0);
  });

  it("lanza si la previsualización tiene bloqueos: ninguna confirmación puede saltárselos", async () => {
    const snapshot = snap({ findings: [finding("tag-deja", "T002")] });
    const preview = previewConsolidation(input({ snapshot }));
    await expect(consolidate(preview, { ...CONTEXT, snapshot })).rejects.toThrow(/hallazgos-pendientes/);
  });

  it("la segunda versión encadena el hash de la vigente y su delta es el de las dos instantáneas", async () => {
    const v1 = await version1();
    const second = snap({ sourceId: "f2", day: 30, ring: ["T001", "T002", "T003", "T004", "T005", "T006", "T007"] });
    const preview = previewConsolidation(input({ snapshot: second, versions: [v1] }));
    expect(preview.nextVersion).toBe(2);
    expect(preview.previous?.hash).toBe(v1.hash);
    expect(preview.delta).toEqual(compareSnapshots(v1.snapshot, second, THRESHOLDS));
    expect(preview.delta?.vertices.map((entry) => [entry.tagId, entry.kind])).toEqual([["T007", "aparece"]]);
    const v2 = await consolidate(preview, { ...CONTEXT, snapshot: second, now: 40 * DAY, note: "  " });
    expect(v2.previousHash).toBe(v1.hash);
    expect(v2.delta).toEqual(preview.delta);
    expect(v2.note).toBeNull();
    expect(v2.hash).not.toBe(v1.hash);
  });

  it("revocar devuelve una copia marcada y no muta la original; la vigente salta las revocadas", async () => {
    const v1 = await version1();
    const revoked = revokeVersion(v1, "fichero equivocado", 11 * DAY);
    expect(v1.revoked).toBeNull();
    expect(revoked).not.toBe(v1);
    expect(revoked.revoked).toEqual({ at: 11 * DAY, reason: "fichero equivocado" });
    expect(revoked.hash).toBe(v1.hash);
    expect(() => revokeVersion(revoked, "otra vez", 12 * DAY)).toThrow(/ya estaba revocada/);
    expect(() => revokeVersion(v1, "  ", 12 * DAY)).toThrow(/razón/);
    expect(currentVersion([revoked])).toBeNull();
    expect(currentVersion([])).toBeNull();
  });

  it("`previousHash` de vN+1 apunta a la última versión NO revocada (§7)", async () => {
    const v1 = await version1();
    const second = snap({ sourceId: "f2", day: 30 });
    const v2 = await consolidate(previewConsolidation(input({ snapshot: second, versions: [v1] })), { ...CONTEXT, snapshot: second, now: 40 * DAY });
    const v2Revoked = revokeVersion(v2, "periodo con obras", 41 * DAY);
    expect(currentVersion([v1, v2Revoked])?.version).toBe(1);
    const third = snap({ sourceId: "f3", day: 60 });
    const preview = previewConsolidation(input({ snapshot: third, versions: [v1, v2Revoked] }));
    expect(preview.nextVersion).toBe(3);
    expect(preview.previous?.version).toBe(1);
    const v3 = await consolidate(preview, { ...CONTEXT, snapshot: third, now: 70 * DAY });
    expect(v3.previousHash).toBe(v1.hash);
    expect(v3.delta).toEqual(compareSnapshots(v1.snapshot, third, THRESHOLDS));
  });

  it("con `changeClass`, la versión guarda los cambios clasificados y el esperado solo adopta lo sostenido y colectivo (OQ-146, OQ-147)", async () => {
    const v1 = await version1();
    // T007 aparece en f2 y sigue en f3: dos ficheros, no sostenido con tres.
    const ring7 = [...RING, "T007"];
    const f2 = snap({ sourceId: "f2", day: 30, ring: ring7 });
    const f3 = snap({ sourceId: "f3", day: 31, ring: ring7 });
    const thresholds = { ...THRESHOLDS, changeClass: { sustainedFiles: 3, collectiveShare: 0.5 } };
    const preview = previewConsolidation(input({ snapshot: f3, versions: [v1], history: [f2, f3], thresholds }));
    expect(preview.changes?.map((change) => [change.key, change.cls, change.files])).toEqual([["vertice|T007|aparece", "deriva-pendiente", 2]]);
    const v2 = await consolidate(preview, { ...CONTEXT, snapshot: f3, now: 40 * DAY });
    expect(v2.changes).toEqual(preview.changes);
    // El esperado no incluye T007: apareció sin adoptarse. La instantánea sí, tal cual.
    expect(v2.expected?.ring).toEqual(RING);
    expect(v2.snapshot.ring).toEqual(ring7);
    // Y la comparación con la memoria es contra el esperado: T007 sigue apareciendo.
    expect(compareToMemory(f3, v2, THRESHOLDS).delta.vertices.map((entry) => [entry.tagId, entry.kind])).toEqual([["T007", "aparece"]]);
    // Confirmado por una persona (evento del plano), pasa al esperado y no se guarda `expected` aparte.
    const confirmed = previewConsolidation(input({ snapshot: f3, versions: [v1], history: [f2, f3], thresholds, confirmedSubjects: new Set(["vertice|T007"]) }));
    expect(confirmed.changes?.[0]).toMatchObject({ cls: "cambio-confirmado", adopted: true });
    const v2b = await consolidate(confirmed, { ...CONTEXT, snapshot: f3, now: 40 * DAY });
    expect(v2b.expected).toBeUndefined();
    expect(v2b.changes).toHaveLength(1);
  });

  it("OQ-150 (2): un pendiente de la vigente que ya no está en el último fichero sale como evento puntual, una sola vez", async () => {
    const v1 = await version1();
    const ring7 = [...RING, "T007"];
    const thresholds = { ...THRESHOLDS, changeClass: { sustainedFiles: 3, collectiveShare: 0.5 } };
    const f2 = snap({ sourceId: "f2", day: 30, ring: ring7 });
    const v2 = await consolidate(previewConsolidation(input({ snapshot: f2, versions: [v1], history: [f2], thresholds })), { ...CONTEXT, snapshot: f2, now: 40 * DAY });
    expect(v2.changes?.map((change) => [change.key, change.cls, change.files])).toEqual([["vertice|T007|aparece", "deriva-pendiente", 1]]);

    // T007 ya no está en el fichero siguiente: «se vio en v2 y volvió», informativo y sin adoptar.
    const f3 = snap({ sourceId: "f3", day: 41 });
    const back = previewConsolidation(input({ snapshot: f3, versions: [v1, v2], history: [f3], thresholds }));
    expect(back.changes).toEqual([
      {
        key: "vertice|T007|aparece",
        subject: { kind: "vertice", tagId: "T007" },
        change: "aparece",
        detail: v2.changes?.[0]?.detail,
        cls: "evento-puntual",
        files: 0,
        collective: { share: null, affected: null, passing: null },
        reason: "Se vio en v2 y volvió: quedó pendiente allí tras 1 fichero y no está en el último del periodo (f3.csv). No cambia el esperado.",
        adopted: false,
      },
    ]);
    // Sin historia explícita el criterio es el mismo: el último fichero es el que se consolida.
    expect(previewConsolidation(input({ snapshot: f3, versions: [v1, v2], thresholds })).changes?.map((change) => change.cls)).toEqual(["evento-puntual"]);
    // Sigue en el último fichero: no vuelve, sigue pendiente.
    const f3b = snap({ sourceId: "f3b", day: 41, ring: ring7 });
    expect(previewConsolidation(input({ snapshot: f3b, versions: [v1, v2], history: [f3b], thresholds })).changes?.map((change) => change.cls)).toEqual(["deriva-pendiente"]);
    // Visto en un fichero de la propia historia y ausente del último: `classifyChanges` ya da el evento
    // puntual y no se duplica.
    const within = previewConsolidation(input({ snapshot: f3, versions: [v1, v2], history: [f3b, f3], thresholds }));
    expect(within.changes?.filter((change) => change.key === "vertice|T007|aparece")).toHaveLength(1);
    expect(within.changes?.[0]?.reason).toMatch(/^Se vio en 1 de los 1 fichero anteriores del periodo/);
  });

  it("OQ-149: la incidencia lleva la ventana, el AGV y los tags explícitos del hallazgo", () => {
    const window = { from: 2 * DAY, to: 2 * DAY + 600 * SECOND };
    const snapshot = snap({
      findings: [
        { ...finding("deja-de-leer", "AGV-01 T003 172800000"), window, agvId: "AGV-01", tagIds: [] },
        { ...finding("bloqueo", "AGV-02 T004 172800000"), window, tagIds: ["T004"] },
        { ...finding("produccion-parada", "circuito"), window, windows: [window], tagIds: [] },
      ],
    });
    const reviews = new Map([
      review("deja-de-leer|AGV-01 T003 172800000", "confirmado"),
      review("bloqueo|AGV-02 T004 172800000", "confirmado"),
      review("produccion-parada|circuito", "confirmado"),
    ]);
    const rank1 = (): number => 1;
    const preview = previewConsolidation(input({ snapshot, reviews, rankOf: rank1 }));
    expect(preview.blockers).toEqual([]);
    const byKind = new Map((preview.incidents ?? []).map((incident) => [incident.kind, incident]));
    expect(byKind.get("deja-de-leer")).toMatchObject({ subjects: [], window, agvId: "AGV-01" });
    expect(byKind.get("bloqueo")).toMatchObject({
      subjects: ["vertice|T004", "arista|T003|T004|produccion", "arista|T003|T004|noche", "arista|T004|T005|produccion", "arista|T004|T005|noche"],
      window,
    });
    expect(byKind.get("bloqueo")?.agvId).toBeUndefined();
    expect(byKind.get("produccion-parada")).toMatchObject({ subjects: [], window, windows: [window] });
  });

  it("el delta de la versión siguiente es contra el esperado de la vigente, no contra su instantánea", async () => {
    const snapshot = snap({ findings: [finding("tag-rotura", "T005")] });
    const reviews = new Map([review("tag-rotura|T005", "confirmado")]);
    const v1 = await consolidate(previewConsolidation(input({ snapshot, reviews })), { ...CONTEXT, snapshot });
    const second = snap({ sourceId: "f2", day: 30 });
    const preview = previewConsolidation(input({ snapshot: second, versions: [v1] }));
    expect(preview.delta).toEqual(compareSnapshots(v1.expected as CircuitSnapshot, second, THRESHOLDS));
  });

  it("compareToMemory es lo observado frente a la vigente, con su fichero y su fecha", async () => {
    const v1 = await version1();
    const observed = snap({ sourceId: "f2", day: 30, vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "T003" ? { readRate: 0, readings: 0 } : {})) });
    const comparison = compareToMemory(observed, v1, THRESHOLDS);
    expect(comparison).toMatchObject({ version: 1, basedOnFileName: "f1.csv", consolidatedAt: 10 * DAY });
    expect(comparison.delta).toEqual(compareSnapshots(v1.snapshot, observed, THRESHOLDS));
    expect(comparison.delta.vertices.map((entry) => [entry.tagId, entry.kind])).toEqual([["T003", "deja-de-leerse"]]);
  });
});

describe("linajes · §10", () => {
  async function chain(lineage: string, count: number, fromDay = 0): Promise<ConsolidatedVersion[]> {
    const versions: ConsolidatedVersion[] = [];
    for (let index = 0; index < count; index += 1) {
      const snapshot = snap({ sourceId: `${lineage}-f${index + 1}`, day: fromDay + index * 30 });
      versions.push(await consolidate(previewConsolidation(input({ snapshot, versions })), { ...CONTEXT, lineage, snapshot, now: (fromDay + index * 30 + 1) * DAY }));
    }
    return versions;
  }

  it("clasifica por la cadena de hashes en los cinco casos", async () => {
    const local = await chain("A", 3);
    expect(classifyLineage(local, [])).toBe("sin-memoria");
    expect(classifyLineage([], [])).toBe("sin-memoria");
    expect(classifyLineage(local, local)).toBe("identica");
    expect(classifyLineage(local, local.slice(0, 2))).toBe("local-adelantada");
    expect(classifyLineage(local.slice(0, 2), local)).toBe("entrante-adelantada");
    expect(classifyLineage([], local)).toBe("entrante-adelantada");
    // Ancestro común (v1, v2) y ramas distintas en v3.
    const other = snap({ sourceId: "B-f3", day: 90 });
    const fork = await consolidate(previewConsolidation(input({ snapshot: other, versions: local.slice(0, 2) })), { ...CONTEXT, lineage: "A", snapshot: other, now: 91 * DAY });
    expect(fork.version).toBe(3);
    expect(classifyLineage(local, [...local.slice(0, 2), fork])).toBe("bifurcada");
    // Sin ancestro común y las dos no vacías.
    expect(classifyLineage(local, await chain("C", 1, 200))).toBe("bifurcada");
    // Una revocación no cambia la cadena: el hash es el de nacimiento.
    expect(classifyLineage(local, [revokeVersion(local[0] as ConsolidatedVersion, "error", 1), ...local.slice(1)])).toBe("identica");
  });

  it("el estado de linaje adopta lo entrante adelantado, aparca la bifurcación y anota lo demás", async () => {
    const local = await chain("A", 2);
    let state = emptyLineageState("circuito-sintetico");
    for (const version of local) state = withConsolidated(state, version);
    expect(state.active).toEqual({ id: "A", hashes: local.map((version) => version.hash) });

    const ahead = [...local, ...(await chain("A", 3)).slice(2)];
    const adopted = withIncoming(state, "entrante-adelantada", ahead);
    expect(adopted.active?.hashes).toEqual(ahead.map((version) => version.hash));
    expect(adopted.lastRelation).toBe("entrante-adelantada");
    expect(adopted.incoming).toBeNull();

    const other = await chain("B", 2, 400);
    const forked = withIncoming(state, "bifurcada", other);
    expect(forked.active).toEqual(state.active);
    expect(forked.incoming).toEqual({ id: "B", hashes: other.map((version) => version.hash) });
    expect(versionsOfLineage([...local, ...other], forked.incoming)).toEqual(other);

    expect(withIncoming(state, "identica", local)).toEqual({ ...state, lastRelation: "identica" });
    expect(withIncoming(state, "sin-memoria", []).lastRelation).toBe("sin-memoria");
  });

  it("resolver la bifurcación aplica la elección humana y la deja en el historial con su razón", async () => {
    const local = await chain("A", 2);
    const other = await chain("B", 2, 400);
    let state = emptyLineageState("circuito-sintetico");
    for (const version of local) state = withConsolidated(state, version);
    const forked = withIncoming(state, "bifurcada", other);

    const kept = resolveFork(forked, "conservar-local", "este dispositivo es el de referencia", 500 * DAY);
    expect(kept.active).toEqual(forked.active);
    expect(kept.incoming).toBeNull();
    expect(kept.archived).toEqual([forked.incoming]);
    expect(kept.lineageEvents).toEqual([{ at: 500 * DAY, choice: "conservar-local", reason: "este dispositivo es el de referencia" }]);

    const adopted = resolveFork(forked, "adoptar-entrante", "el otro dispositivo llevaba la revisión", 500 * DAY);
    expect(adopted.active).toEqual(forked.incoming);
    expect(adopted.archived).toEqual([forked.active]);
    expect(adopted.incoming).toBeNull();
    // Nada se fusiona: las versiones siguen todas, cada una en su linaje.
    expect(versionsOfLineage([...local, ...other], adopted.active)).toEqual(other);
    expect(versionsOfLineage([...local, ...other], adopted.archived[0] ?? null)).toEqual(local);

    expect(() => resolveFork(state, "conservar-local", "sin nada que resolver", 1)).toThrow(/ninguna bifurcación/);
    expect(() => resolveFork(forked, "conservar-local", " ", 1)).toThrow(/justificación/);
  });

  it("las elecciones de linaje de otro dispositivo se añaden marcadas, sin repetir las que ya estaban (OQ-144)", () => {
    const own = { at: 10, choice: "conservar-local" as const, reason: "consolidé aquí primero" };
    const state = { ...emptyLineageState("circuito-sintetico"), lineageEvents: [own] };
    const foreign = { at: 5, choice: "adoptar-entrante" as const, reason: "adopté la del portátil" };
    const merged = withForeignEvents(state, [own, foreign]);
    expect(merged.added).toBe(1);
    // En orden de fecha, la ajena marcada y la propia sin marca.
    expect(merged.state.lineageEvents).toEqual([{ ...foreign, origin: "otro-dispositivo" }, own]);
    // Abrir otra vez el mismo proyecto no añade nada, y la original no cambia.
    expect(withForeignEvents(merged.state, [own, foreign]).added).toBe(0);
    expect(state.lineageEvents).toEqual([own]);
    // Sin eventos entrantes, el mismo estado.
    expect(withForeignEvents(state, []).state).toBe(state);
  });
});
