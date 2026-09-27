/**
 * La memoria que llega en un `.agvproj` (F4, `MEMORY_CONSOLIDATION.md` §10 y §11), sin almacén: lo
 * que decide qué entra (`planMemoryImport`) y lo que comprueba que lo que llega es íntegro
 * (`verifyProjectMemory`) son funciones puras, y aquí se prueban como tales.
 *
 * Lo que motivó estas pruebas: la sección `memoria` lleva las versiones del linaje activo **y** de los
 * archivados, mezcladas. Clasificar contra todas ellas hacía pasar por bifurcado un destino idéntico
 * al activo del origen, y un dispositivo vacío adoptaba las dos ramas como una sola cadena.
 */

import { describe, expect, it } from "vitest";

import {
  consolidate,
  emptyLineageState,
  previewConsolidation,
  resolveFork,
  versionHash,
  versionsOfLineage,
  withConsolidated,
  withIncoming,
  type ConsolidatedVersion,
  type LineageRef,
  type LineageState,
} from "../../src/domain/memory.js";
import { buildSnapshot, type CircuitSnapshot } from "../../src/domain/snapshot.js";
import { memorySection, ProjectError, type ProjectMemorySection } from "../../src/persistence/agvproj.js";
import { planMemoryImport, verifyProjectMemory } from "../../src/persistence/project-memory.js";

const CIRCUIT = "circuito-sintetico";
const NOW = 1_758_000_000_000;

/** Una versión con hash inventado: vale para decidir qué entra, no para verificar. */
function version(number: number, hash: string, previousHash: string | null, lineage = "linaje-A"): ConsolidatedVersion {
  return {
    schemaVersion: 1,
    circuitId: CIRCUIT,
    version: number,
    createdAt: NOW - 1000 + number,
    basedOn: { sourceId: `s${number}`, sourceHash: `hash-s${number}`, fileName: `s${number}.csv`, window: { from: 1000 * number, to: 1000 * number + 500 } },
    previousHash,
    hash,
    lineage,
    snapshot: { schemaVersion: 1, circuitId: CIRCUIT, sourceId: `s${number}`, ring: ["T001"], vertices: [] } as unknown as ConsolidatedVersion["snapshot"],
    delta: null,
    decisions: [],
    note: null,
    revoked: null,
    appVersion: "0.0.0-prueba",
  };
}

/** El linaje que forman unas versiones, como lo declara el `.agvproj`: el identificador es el de la última, que es la que lo heredó o lo creó. */
const refOf = (versions: readonly ConsolidatedVersion[]): LineageRef => ({ id: (versions[versions.length - 1] as ConsolidatedVersion).lineage, hashes: versions.map((entry) => entry.hash) });
const hashesOf = (versions: readonly ConsolidatedVersion[]): readonly string[] => versions.map((entry) => entry.hash);

function stateOf(active: readonly ConsolidatedVersion[], extra: Partial<LineageState> = {}): LineageState {
  return { ...active.reduce((acc, entry) => withConsolidated(acc, entry), emptyLineageState(CIRCUIT)), ...extra };
}

/** El dispositivo A: linaje activo [h1, h2, h3] y, archivada tras conservar el local, la rama [h1, h2b]. */
const H1 = version(1, "h1", null);
const H2 = version(2, "h2", "h1");
const H3 = version(3, "h3", "h2");
const H2B = version(2, "h2b", "h1", "linaje-B");
const ACTIVE_A = [H1, H2, H3];
const STATE_A = resolveFork(withIncoming(stateOf(ACTIVE_A), "bifurcada", refOf([H1, H2B])), "conservar-local", "A es el de referencia", NOW);
const EXPORT_A = memorySection([...ACTIVE_A, H2B], STATE_A) as ProjectMemorySection;

describe("planMemoryImport · la relación se clasifica contra el linaje activo del proyecto", () => {
  it("el origen exporta las dos ramas mezcladas y declara cuál es la activa", () => {
    expect(hashesOf(EXPORT_A.versiones)).toEqual(["h1", "h2", "h2b", "h3"]);
    expect(EXPORT_A.linaje.activo).toEqual({ id: "linaje-A", hashes: ["h1", "h2", "h3"] });
    expect(EXPORT_A.linaje.archivados).toEqual([{ id: "linaje-B", hashes: ["h1", "h2b"] }]);
  });

  it("un destino con exactamente el activo del origen es «identica», y solo entra la rama archivada como archivada", () => {
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: ACTIVE_A, state: stateOf(ACTIVE_A), incoming: EXPORT_A });
    expect(plan.relation).toBe("identica");
    expect(plan.pendingForkBlocked).toBe(false);
    expect(plan.state.active).toEqual({ id: "linaje-A", hashes: ["h1", "h2", "h3"] });
    expect(plan.state.incoming).toBeNull();
    expect(plan.state.archived).toEqual([{ id: "linaje-B", hashes: ["h1", "h2b"] }]);
    expect(plan.archived).toBe(1);
    expect(hashesOf(plan.toWrite)).toEqual(["h2b"]);
  });

  it("un dispositivo vacío adopta solo la cadena activa y conserva la archivada como archivada", () => {
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: [], state: undefined, incoming: EXPORT_A });
    expect(plan.relation).toBe("entrante-adelantada");
    expect(plan.state.active).toEqual({ id: "linaje-A", hashes: ["h1", "h2", "h3"] });
    expect(plan.state.archived).toEqual([{ id: "linaje-B", hashes: ["h1", "h2b"] }]);
    expect(plan.state.incoming).toBeNull();
    // Entran las cuatro versiones, pero en el linaje activo hay tres: dos v2 nunca comparten cadena.
    expect(hashesOf(plan.toWrite)).toEqual(["h1", "h2", "h2b", "h3"]);
    expect(hashesOf(versionsOfLineage(plan.toWrite, plan.state.active))).toEqual(["h1", "h2", "h3"]);
    expect(hashesOf(versionsOfLineage(plan.toWrite, plan.state.archived[0] ?? null))).toEqual(["h1", "h2b"]);
  });

  it("un destino que sigue la rama archivada del origen es «bifurcada» frente al activo del origen, y su propia rama no se archiva", () => {
    // El destino B consolidó h2b sobre h1 con su propio linaje: su activo es el que A archivó.
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: [H1, H2B], state: stateOf([H1, H2B], { active: refOf([H1, H2B]) }), incoming: EXPORT_A });
    expect(plan.relation).toBe("bifurcada");
    expect(plan.state.active).toEqual({ id: "linaje-B", hashes: ["h1", "h2b"] });
    expect(plan.state.incoming).toEqual({ id: "linaje-A", hashes: ["h1", "h2", "h3"] });
    // El archivado del origen es el activo de aquí: no se archiva.
    expect(plan.state.archived).toEqual([]);
    expect(hashesOf(plan.toWrite)).toEqual(["h2", "h3"]);
  });

  it("volver a abrir el mismo proyecto no repite el archivado ni escribe nada", () => {
    const first = planMemoryImport({ circuitId: CIRCUIT, versions: [], state: undefined, incoming: EXPORT_A });
    const again = planMemoryImport({ circuitId: CIRCUIT, versions: first.toWrite, state: first.state, incoming: EXPORT_A });
    expect(again.relation).toBe("identica");
    expect(again.archived).toBe(0);
    expect(again.toWrite).toEqual([]);
    expect(again.state.archived).toEqual(first.state.archived);
  });

  it("un proyecto antiguo sin linaje activo declarado se clasifica con todas sus versiones", () => {
    const legacy: ProjectMemorySection = { versiones: ACTIVE_A, linaje: { activo: null, archivados: [], eventos: [] } };
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: [H1, H2], state: stateOf([H1, H2]), incoming: legacy });
    expect(plan.relation).toBe("entrante-adelantada");
    expect(plan.state.active).toEqual({ id: "linaje-A", hashes: ["h1", "h2", "h3"] });
    expect(hashesOf(plan.toWrite)).toEqual(["h3"]);
  });

  it("sin sección no hay nada que comparar", () => {
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: ACTIVE_A, state: stateOf(ACTIVE_A), incoming: undefined });
    expect(plan).toMatchObject({ relation: "sin-memoria", toWrite: [], revocations: [], events: 0, archived: 0, pendingForkBlocked: false });
    expect(plan.state.lastRelation).toBe("sin-memoria");
  });
});

describe("planMemoryImport · una bifurcación pendiente no se pisa (R-MEM-002)", () => {
  const H2C = version(2, "h2c", "h1", "linaje-C");
  const PENDING = withIncoming(stateOf([H1, H2]), "bifurcada", refOf([H1, H2B]));
  const exportOf = (active: readonly ConsolidatedVersion[]): ProjectMemorySection => memorySection(active, stateOf(active)) as ProjectMemorySection;

  it("otro proyecto bifurcado no sustituye al entrante que espera decisión, y se dice", () => {
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: [H1, H2, H2B], state: PENDING, incoming: exportOf([H1, H2C]) });
    expect(plan.relation).toBe("bifurcada");
    expect(plan.pendingForkBlocked).toBe(true);
    expect(plan.state.incoming).toEqual({ id: "linaje-B", hashes: ["h1", "h2b"] });
    expect(plan.state.active).toEqual({ id: "linaje-A", hashes: ["h1", "h2"] });
    expect(plan.state.lastRelation).toBe("bifurcada");
    expect(plan.toWrite).toEqual([]);
  });

  it("una entrante adelantada tampoco se adopta mientras haya bifurcación sin resolver", () => {
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: [H1, H2, H2B], state: PENDING, incoming: exportOf([H1, H2, H3]) });
    expect(plan.relation).toBe("entrante-adelantada");
    expect(plan.pendingForkBlocked).toBe(true);
    expect(plan.state.active).toEqual(PENDING.active);
    expect(plan.state.incoming).toEqual(PENDING.incoming);
    expect(plan.toWrite).toEqual([]);
  });

  it("el mismo entrante otra vez, o uno idéntico al local, sigue pasando; y las revocaciones que llegan se aplican igual", () => {
    const same = planMemoryImport({ circuitId: CIRCUIT, versions: [H1, H2, H2B], state: PENDING, incoming: exportOf([H1, H2]) });
    expect(same.relation).toBe("identica");
    expect(same.pendingForkBlocked).toBe(false);
    expect(same.state).toEqual({ ...PENDING, lastRelation: "identica" });

    const revoked = { ...H2C, revoked: { at: NOW, reason: "fichero equivocado" } };
    const withRevocation: ProjectMemorySection = {
      versiones: [{ ...H1, revoked: { at: NOW, reason: "fichero equivocado" } }, revoked],
      linaje: { activo: refOf([H1, H2C]), archivados: [], eventos: [] },
    };
    const plan = planMemoryImport({ circuitId: CIRCUIT, versions: [H1, H2, H2B], state: PENDING, incoming: withRevocation });
    expect(plan.pendingForkBlocked).toBe(true);
    expect(plan.revocations).toEqual([{ version: 1, at: NOW, reason: "fichero equivocado" }]);
    expect(plan.toWrite.map((entry) => [entry.hash, entry.revoked?.reason ?? null])).toEqual([["h1", "fichero equivocado"]]);
  });
});

// --- Verificación con versiones de verdad, consolidadas aquí --------------------------------------

const SECOND = 1_000;
const DAY = 24 * 3600 * SECOND;
const RING: readonly string[] = ["T001", "T002", "T003"];

function snap(sourceId: string, day: number): CircuitSnapshot {
  const window = { from: day * DAY, to: (day + 1) * DAY };
  return buildSnapshot({
    circuitId: CIRCUIT,
    zone: "Europe/Madrid",
    source: { sourceId, sourceHash: `hash-${sourceId}`, fileName: `${sourceId}.csv`, window, acceptedRows: 300 },
    capturedAt: window.to,
    appVersion: "0.0.0-prueba",
    exposure: { produccion: DAY, noche: 0 },
    cohortId: 1,
    anchorTagId: "T001",
    anchorDeclared: true,
    ring: RING,
    lapMs: RING.length * 10 * SECOND,
    vertices: RING.map((tagId, at) => ({
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
      predecessor: RING[(at - 1 + RING.length) % RING.length] as string,
      successor: RING[(at + 1) % RING.length] as string,
      inventoryClass: "activo",
      situation: "anillo",
      laneId: null,
      isAnchor: at === 0,
    })),
    edges: RING.map((from, index) => ({ from, to: RING[(index + 1) % RING.length] as string, produccion: null, noche: null })),
    sections: [],
    anchorGaps: [],
    fleet: { assigned: 2, inCircuitAtEnd: 2, inCircuitMedian: 2, historySource: "historial", vehicles: ["AGV-01", "AGV-02"] },
    line: null,
    lanes: [],
    findings: [],
  });
}

async function chain(lineage: string, count: number, fromDay = 0, base: readonly ConsolidatedVersion[] = []): Promise<ConsolidatedVersion[]> {
  const versions: ConsolidatedVersion[] = [...base];
  for (let index = 0; index < count; index += 1) {
    const snapshot = snap(`${lineage}-f${index + 1}`, fromDay + index * 30);
    const preview = previewConsolidation({ snapshot, reviews: new Map(), versions, rankOf: () => 3, forkUnresolved: false, thresholds: { maxChance: 0.001 } });
    versions.push(await consolidate(preview, { circuitId: CIRCUIT, snapshot, lineage, appVersion: "0.0.0-prueba", now: (fromDay + index * 30 + 1) * DAY, note: null }));
  }
  return versions.slice(base.length);
}

describe("verifyProjectMemory · lo que llega tiene que ser lo que dice ser (§11)", () => {
  it("una memoria consolidada de verdad, con una rama archivada, pasa; sin sección no hay nada que verificar", async () => {
    const local = await chain("A", 3);
    const fork = await chain("B", 1, 60, local.slice(0, 2));
    const state = resolveFork(withIncoming(stateOf(local), "bifurcada", refOf([...local.slice(0, 2), ...fork])), "conservar-local", "referencia", NOW);
    const section = memorySection([...local, ...fork], state) as ProjectMemorySection;
    expect(section.versiones).toHaveLength(4);
    await expect(verifyProjectMemory(CIRCUIT, section)).resolves.toBeUndefined();
    await expect(verifyProjectMemory(CIRCUIT, undefined)).resolves.toBeUndefined();
  });

  it("una versión que no da su hash se rechaza con un ProjectError que dice cuál", async () => {
    const local = await chain("A", 2);
    const tampered = { ...(local[1] as ConsolidatedVersion), note: "retocada" };
    const section: ProjectMemorySection = { versiones: [local[0] as ConsolidatedVersion, tampered], linaje: { activo: refOf(local), archivados: [], eventos: [] } };
    await expect(verifyProjectMemory(CIRCUIT, section)).rejects.toBeInstanceOf(ProjectError);
    await expect(verifyProjectMemory(CIRCUIT, section)).rejects.toThrow(/v2 .* no coincide con su hash/);
  });

  it("un linaje —activo o archivado— que no encadena se rechaza, y las versiones declaradas con hash inventado también", async () => {
    const local = await chain("A", 3);
    const hashes = hashesOf(local);
    const broken: ProjectMemorySection = { versiones: local, linaje: { activo: { id: "A", hashes: [hashes[0] as string, hashes[2] as string] }, archivados: [], eventos: [] } };
    await expect(verifyProjectMemory(CIRCUIT, broken)).rejects.toThrow(/v3 .* no encadena/);
    const missing: ProjectMemorySection = { versiones: local, linaje: { activo: refOf(local), archivados: [{ id: "B", hashes: ["no-viene"] }], eventos: [] } };
    await expect(verifyProjectMemory(CIRCUIT, missing)).rejects.toThrow(/no viene en el proyecto/);
    await expect(verifyProjectMemory(CIRCUIT, EXPORT_A)).rejects.toThrow(/v1 .* no coincide con su hash/);
  });

  it("OQ-157: un linaje con dos versiones del mismo número se rechaza aunque cada una dé su hash", async () => {
    const [v1, v2, v3] = (await chain("A", 3)) as [ConsolidatedVersion, ConsolidatedVersion, ConsolidatedVersion];
    // Otra v2 del mismo linaje, con contenido distinto y su hash bien calculado: la regla del hash no la ve.
    const draft = { ...v2, note: "otra v2", hash: "" };
    const twin: ConsolidatedVersion = { ...draft, hash: await versionHash(draft) };
    expect(twin.hash).not.toBe(v2.hash);
    const section: ProjectMemorySection = {
      versiones: [v1, v2, twin, v3],
      linaje: { activo: { id: "A", hashes: [v1.hash, v2.hash, twin.hash, v3.hash] }, archivados: [], eventos: [] },
    };
    await expect(verifyProjectMemory(CIRCUIT, section)).rejects.toBeInstanceOf(ProjectError);
    await expect(verifyProjectMemory(CIRCUIT, section)).rejects.toThrow(/el linaje «A» tiene dos versiones v2/);
  });
});
