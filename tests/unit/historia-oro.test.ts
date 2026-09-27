/**
 * Prueba de oro de la comparación histórica (puerta G4: «Comparación histórica reproduce deltas
 * correctos»; `MEMORY_CONSOLIDATION.md` §6-§8).
 *
 * Seis periodos sintéticos de un anillo de diez tags (S01…S10), una sección entre anclas que lo cubre
 * entero y cinco AGV inventados. Cada periodo se consolida en su versión, encadenadas como lo hace el
 * Worker: la historia de cada consolidación son las instantáneas posteriores al esperado vigente.
 *
 * Cambios plantados y lo que tiene que pasar con cada uno:
 *
 * - (a) S05 deja de leerse desde el periodo 2 hasta el final, para los cinco AGV: se adopta en v4,
 *   la primera versión con tres ficheros seguidos (P2, P3, P4).
 * - (b) El tramo S07 → S08 va más lento solo en el periodo 3: nunca se adopta.
 * - (c) S11 aparece desde el periodo 4 entre S09 y S10, leído por uno de cinco AGV: nunca se adopta.
 * - (d) Un hallazgo de rango 1 sobre S03, confirmado en el periodo 5, con S03 sin leer ese periodo:
 *   es una incidencia y no entra en el esperado.
 *
 * Y la comparación entre versiones: de v1 a v6 da exactamente S05, al revés da lo inverso, una
 * revocación intermedia se cuenta en `between.revoked` y la cadena de hashes es consistente.
 */

import { describe, expect, it } from "vitest";

import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";
import {
  compareVersions,
  consolidate,
  currentVersion,
  expectedOf,
  lineageChainProblem,
  previewConsolidation,
  revokeVersion,
  versionHash,
  versionHashProblem,
  type ConsolidatedVersion,
} from "../../src/domain/memory.js";
import type { ReviewEntry } from "../../src/domain/review.js";
import type { Band } from "../../src/domain/segment-bands.js";
import { buildSnapshot, sortSnapshots, type CircuitSnapshot, type SnapshotEdge, type SnapshotFinding, type SnapshotVertex } from "../../src/domain/snapshot.js";

const SECOND = 1_000;
const DAY = 24 * 3600 * SECOND;
const BASE: readonly string[] = ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10"];
/** Desde el periodo 4, S11 entre S09 y S10. */
const WITH_NEW: readonly string[] = ["S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S11", "S10"];
const FLEET: readonly string[] = ["AGV-91", "AGV-92", "AGV-93", "AGV-94", "AGV-95"];
const PASSES = 40;

const THRESHOLDS = { maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance, changeClass: PROVISIONAL_CONFIG.changeClass };
const COMPARE = { maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance };

const band = (p50: number, p80: number): Band => ({ samples: 30, p50Ms: p50 * SECOND, p80Ms: p80 * SECOND, p95Ms: (p80 + 2) * SECOND, fenceMs: (p80 + 10) * SECOND });
const NORMAL = band(10, 12);
const SLOW = band(20, 24);

/** Claves plantadas. */
const A = "vertice|S05|deja-de-leerse";
const B = "arista|S07|S08|produccion|mas-lento";
const C = "vertice|S11|aparece";
const D_FINDING = "tag-rotura|S03";

/** Qué se ve en el periodo `period` (1…6). */
function period(period: number): CircuitSnapshot {
  const ring = period >= 4 ? WITH_NEW : BASE;
  const silent = new Set<string>();
  if (period >= 2) silent.add("S05"); // (a)
  if (period === 5) silent.add("S03"); // (d)
  const readers = (tagId: string): number => (silent.has(tagId) ? 0 : tagId === "S11" ? 1 : FLEET.length); // (c): uno de cinco
  const vertices: SnapshotVertex[] = ring.map((tagId, at) => {
    const count = readers(tagId);
    const readings = count === 0 ? 0 : tagId === "S11" ? 8 : PASSES;
    return {
      tagId,
      position: at,
      offsetMs: at * 10 * SECOND,
      section: null,
      funcion: null,
      declared: tagId !== "S11",
      readRate: readings / PASSES,
      passes: PASSES,
      readings,
      nonReaders: count === FLEET.length ? [] : FLEET.slice(count),
      predecessor: ring[(at - 1 + ring.length) % ring.length] as string,
      successor: ring[(at + 1) % ring.length] as string,
      inventoryClass: "activo",
      situation: "anillo",
      laneId: null,
      isAnchor: at === 0,
    };
  });
  const edges: SnapshotEdge[] = ring.map((from, at) => {
    const to = ring[(at + 1) % ring.length] as string;
    return { from, to, produccion: period === 3 && from === "S07" && to === "S08" ? SLOW : NORMAL, noche: null }; // (b)
  });
  const readsByTag: Record<string, { passes: number; vehicles: number }> = {};
  for (const tagId of ring.slice(1)) {
    const count = readers(tagId);
    if (count > 0) readsByTag[tagId] = { passes: tagId === "S11" ? 8 : PASSES, vehicles: count };
  }
  const findings: SnapshotFinding[] =
    period === 5 ? [{ key: D_FINDING, kind: "tag-rotura", title: "Tag S03 roto", figure: "0 de 40 pasadas", review: null }] : [];
  const sourceId = `p${period}`;
  const window = { from: period * DAY, to: (period + 1) * DAY };
  return buildSnapshot({
    circuitId: "circuito-oro",
    zone: "Europe/Madrid",
    source: { sourceId, sourceHash: `hash-${sourceId}`, fileName: `periodo-${period}.csv`, window, acceptedRows: 1_000 },
    capturedAt: window.to,
    appVersion: "0.0.0-oro",
    exposure: { produccion: DAY, noche: 0 },
    cohortId: 1,
    anchorTagId: "S01",
    anchorDeclared: true,
    ring,
    // La vuelta no cambia: el delta de vuelta no entra en lo plantado.
    lapMs: 100 * SECOND,
    vertices,
    edges,
    sections: [],
    anchorGaps: [
      {
        fromAnchor: "S01",
        toAnchor: "S01",
        tags: ring.slice(1),
        produccion: { samples: PASSES, p50Ms: 100 * SECOND, p80Ms: 105 * SECOND },
        noche: null,
        passes: PASSES,
        readsByTag,
        vehicleIds: FLEET,
      },
    ],
    fleet: { assigned: 5, inCircuitAtEnd: 5, inCircuitMedian: 5, historySource: "historial", vehicles: FLEET },
    line: null,
    lanes: [],
    findings,
  });
}

const RANK: Readonly<Record<string, number>> = { "tag-rotura": 1 };
const rankOf = (kind: string): number => RANK[kind] ?? 3;

/** Todos los hallazgos revisados: los de rango 1 confirmados (son la incidencia plantada). */
function reviewsOf(snapshot: CircuitSnapshot): ReadonlyMap<string, ReviewEntry> {
  return new Map(
    snapshot.findings.map((finding) => [finding.key, { key: finding.key, state: "confirmado", note: "", updatedAt: 1, title: finding.title, figure: finding.figure }]),
  );
}

/** Como el Worker (`previewFor`): la historia son las instantáneas posteriores al esperado vigente, hasta la que se consolida. */
function historyFor(snapshots: readonly CircuitSnapshot[], target: CircuitSnapshot, versions: readonly ConsolidatedVersion[]): readonly CircuitSnapshot[] {
  const current = currentVersion(versions);
  const since = current?.basedOn.window.to ?? null;
  return sortSnapshots(snapshots).filter((entry) => entry.window.to <= target.window.to && (since === null || entry.window.from > since));
}

const PERIODS = [1, 2, 3, 4, 5, 6].map(period);

async function consolidateAll(): Promise<readonly ConsolidatedVersion[]> {
  const versions: ConsolidatedVersion[] = [];
  for (const snapshot of PERIODS) {
    const preview = previewConsolidation({
      snapshot,
      reviews: reviewsOf(snapshot),
      versions,
      rankOf,
      forkUnresolved: false,
      thresholds: THRESHOLDS,
      history: historyFor(PERIODS, snapshot, versions),
    });
    expect(preview.blockers).toEqual([]);
    versions.push(
      await consolidate(preview, {
        circuitId: "circuito-oro",
        snapshot,
        lineage: "linaje-oro",
        appVersion: "0.0.0-oro",
        now: snapshot.window.to + 3600 * SECOND,
        note: null,
      }),
    );
  }
  return versions;
}

const VERSIONS = await consolidateAll();
const v = (number: number): ConsolidatedVersion => VERSIONS[number - 1] as ConsolidatedVersion;
const adoptedIn = (version: ConsolidatedVersion): readonly string[] => (version.changes ?? []).filter((change) => change.adopted).map((change) => change.key);
const changeOf = (version: ConsolidatedVersion, key: string) => (version.changes ?? []).find((change) => change.key === key);
const vertexOf = (snapshot: CircuitSnapshot, tagId: string): SnapshotVertex | undefined => snapshot.vertices.find((entry) => entry.tagId === tagId);

describe("prueba de oro: cambios plantados a lo largo de seis periodos", () => {
  it("solo (a) se adopta, y en v4: la primera con tres ficheros seguidos", () => {
    expect(VERSIONS.map((version) => version.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(VERSIONS.map(adoptedIn)).toEqual([[], [], [], [A], [], []]);
    expect(changeOf(v(2), A)).toMatchObject({ cls: "deriva-pendiente", files: 1, adopted: false });
    expect(changeOf(v(3), A)).toMatchObject({ cls: "deriva-pendiente", files: 2, adopted: false });
    expect(changeOf(v(4), A)).toMatchObject({ cls: "cambio-colectivo-sostenido", files: 3, collective: { share: 1, affected: 5, passing: 5 }, adopted: true });
    // La cuenta sigue entre consolidaciones, y la razón lo dice.
    expect(changeOf(v(3), A)?.reason).toMatch(/^Lleva 2 de 3 ficheros seguidos, contando 1 de periodos ya consolidados: todavía no es sostenido\./);
    expect(changeOf(v(4), A)?.reason).toMatch(/^Se mantiene en 3 ficheros seguidos, contando 2 de periodos ya consolidados \(hacen falta 3\) y es colectivo: lo muestran 5 de 5 AGV/);
    // Adoptado, ya no es un cambio frente al esperado.
    expect(changeOf(v(5), A)).toBeUndefined();
    expect(changeOf(v(6), A)).toBeUndefined();
    // El esperado lo lleva desde v4, y antes conservaba la lectura de v1.
    expect(vertexOf(expectedOf(v(3)), "S05")).toMatchObject({ readings: PASSES, readRate: 1 });
    expect(vertexOf(expectedOf(v(4)), "S05")).toMatchObject({ readings: 0, readRate: 0 });
  });

  it("(b) el tramo lento de un solo periodo no se adopta nunca", () => {
    expect(changeOf(v(3), B)).toMatchObject({ cls: "deriva-pendiente", files: 1, adopted: false });
    // 2026-09-27, OQ-150 (2): antes, en v4 el tramo no salía (`toBeUndefined`). Ahora v3 lo guardó
    // pendiente y en periodo-4 ya no está: v4 lo lista como evento puntual, sin adoptarlo.
    expect(changeOf(v(4), B)).toMatchObject({ cls: "evento-puntual", files: 0, adopted: false });
    for (const number of [1, 2, 5, 6]) expect(changeOf(v(number), B)).toBeUndefined();
    const edge = expectedOf(v(3)).edges.find((entry) => entry.from === "S07" && entry.to === "S08");
    expect(edge?.produccion).toEqual(NORMAL);
  });

  it("OQ-150 (2): un pendiente de v3 que ya no está en el fichero siguiente sale en v4 como evento puntual «se vio en v3 y volvió»", () => {
    const returned = changeOf(v(4), B);
    expect(returned).toMatchObject({ cls: "evento-puntual", files: 0, adopted: false, subject: { kind: "arista", from: "S07", to: "S08", regime: "produccion" } });
    expect(returned?.reason).toMatch(/^Se vio en v3 y volvió: quedó pendiente allí tras 1 fichero y no está en el último del periodo \(periodo-4\.csv\)\. No cambia el esperado\.$/);
    // Una sola vez: ni duplicado en v4 ni arrastrado a v5 (v4 no lo guarda como pendiente).
    expect((v(4).changes ?? []).filter((change) => change.key === B)).toHaveLength(1);
    expect(changeOf(v(5), B)).toBeUndefined();
    // No toca el esperado: el tramo sigue con su horquilla normal.
    expect(expectedOf(v(4)).edges.find((entry) => entry.from === "S07" && entry.to === "S08")?.produccion).toEqual(NORMAL);
    // Un pendiente que sigue en el último fichero no vuelve: (c) sigue pendiente en v5.
    expect(changeOf(v(5), C)?.cls).toBe("deriva-pendiente");
    // La incidencia de v5 no era pendiente: en v6 no sale como evento puntual.
    expect(changeOf(v(6), "vertice|S03|deja-de-leerse")).toBeUndefined();
  });

  it("(c) el tag nuevo que lee una minoría no se adopta nunca, aunque sea sostenido", () => {
    expect(changeOf(v(4), C)).toMatchObject({ cls: "deriva-pendiente", files: 1, collective: { share: 0.2, affected: 1, passing: 5 }, adopted: false });
    expect(changeOf(v(5), C)).toMatchObject({ cls: "deriva-pendiente", files: 2, adopted: false });
    expect(changeOf(v(6), C)).toMatchObject({ cls: "deriva-pendiente", files: 3, adopted: false });
    expect(changeOf(v(6), C)?.reason).toContain("No es colectivo");
    for (const number of [4, 5, 6]) expect(expectedOf(v(number)).ring).toEqual(BASE);
  });

  it("(d) la incidencia de rango 1 queda aparte y no entra en el esperado", () => {
    expect(v(5).incidents?.map((incident) => incident.key)).toEqual([D_FINDING]);
    expect(changeOf(v(5), "vertice|S03|deja-de-leerse")).toMatchObject({ cls: "incidencia", adopted: false });
    expect(vertexOf(v(5).snapshot, "S03")).toMatchObject({ readings: 0 });
    expect(vertexOf(expectedOf(v(5)), "S03")).toMatchObject({ readings: PASSES, readRate: 1 });
    for (const number of [1, 2, 3, 4, 6]) expect(v(number).incidents).toEqual([]);
  });

  it("de v1 a v6 el delta es exactamente lo adoptado: S05; ni (b), ni (c), ni (d)", () => {
    const comparison = compareVersions(VERSIONS, 1, 6, COMPARE);
    expect(comparison.from).toEqual({ version: 1, fileName: "periodo-1.csv", window: { from: DAY, to: 2 * DAY }, revoked: false });
    expect(comparison.to).toEqual({ version: 6, fileName: "periodo-6.csv", window: { from: 6 * DAY, to: 7 * DAY }, revoked: false });
    expect(comparison.between).toEqual({ versions: 4, revoked: 0 });
    expect(comparison.delta.vertices.map((entry) => [entry.tagId, entry.kind])).toEqual([["S05", "deja-de-leerse"]]);
    expect(comparison.delta.edges).toEqual([]);
    expect(comparison.delta.lapShift).toBeNull();
    expect(comparison.adoptedAlongTheWay).toEqual([
      { version: 2, keys: [], revoked: false },
      { version: 3, keys: [], revoked: false },
      { version: 4, keys: [A], revoked: false },
      { version: 5, keys: [], revoked: false },
      { version: 6, keys: [], revoked: false },
    ]);
  });

  it("de v6 a v1 es el inverso, con la misma historia", () => {
    const forward = compareVersions(VERSIONS, 1, 6, COMPARE);
    const backward = compareVersions(VERSIONS, 6, 1, COMPARE);
    expect(backward.from.version).toBe(6);
    expect(backward.to.version).toBe(1);
    expect(backward.delta.vertices.map((entry) => [entry.tagId, entry.kind])).toEqual([["S05", "empieza-a-leerse"]]);
    expect(backward.delta.vertices[0]?.before).toEqual(forward.delta.vertices[0]?.after);
    expect(backward.delta.vertices[0]?.after).toEqual(forward.delta.vertices[0]?.before);
    expect(backward.delta.edges).toEqual([]);
    expect(backward.between).toEqual(forward.between);
    expect(backward.adoptedAlongTheWay).toEqual(forward.adoptedAlongTheWay);
  });

  it("entre versiones seguidas, el delta es el cambio de esperado de esa consolidación", () => {
    for (const [from, to, expected] of [
      [1, 2, []],
      [2, 3, []],
      [3, 4, [["S05", "deja-de-leerse"]]],
      [4, 5, []],
      [5, 6, []],
    ] as const) {
      const comparison = compareVersions(VERSIONS, from, to, COMPARE);
      expect(comparison.delta.vertices.map((entry) => [entry.tagId, entry.kind])).toEqual(expected);
      expect(comparison.delta.edges).toEqual([]);
      expect(comparison.between).toEqual({ versions: 0, revoked: 0 });
    }
  });

  it("revocar una versión intermedia se cuenta en `between.revoked` y se marca en su historia", () => {
    const revoked = VERSIONS.map((version) => (version.version === 3 ? revokeVersion(version, "periodo de pruebas", 20 * DAY) : version));
    const comparison = compareVersions(revoked, 1, 6, COMPARE);
    expect(comparison.between).toEqual({ versions: 4, revoked: 1 });
    expect(comparison.adoptedAlongTheWay.find((entry) => entry.version === 3)?.revoked).toBe(true);
    // El delta sale de los esperados de las dos puntas: no cambia.
    expect(comparison.delta).toEqual(compareVersions(VERSIONS, 1, 6, COMPARE).delta);
    // Una punta revocada se dice.
    expect(compareVersions(revoked, 3, 6, COMPARE).from.revoked).toBe(true);
    expect(compareVersions(revoked, 3, 6, COMPARE).between).toEqual({ versions: 2, revoked: 0 });
  });

  it("lanza con un mensaje claro si falta una versión o si son la misma", () => {
    expect(() => compareVersions(VERSIONS, 1, 9, COMPARE)).toThrow(/v9 no está/);
    expect(() => compareVersions(VERSIONS, 4, 4, COMPARE)).toThrow(/consigo misma/);
    expect(() => compareVersions([...VERSIONS, v(2)], 2, 4, COMPARE)).toThrow(/2 versiones v2/);
  });

  it("la cadena de hashes es consistente", async () => {
    expect(v(1).previousHash).toBeNull();
    for (let index = 1; index < VERSIONS.length; index += 1) {
      expect((VERSIONS[index] as ConsolidatedVersion).previousHash).toBe((VERSIONS[index - 1] as ConsolidatedVersion).hash);
    }
    for (const version of VERSIONS) expect(await versionHash(version)).toBe(version.hash);
    expect(new Set(VERSIONS.map((version) => version.hash)).size).toBe(VERSIONS.length);
    // Lo mismo que comprueba la importación de un `.agvproj` (§11): cada versión guardada vuelve a dar
    // su hash, y el linaje encadena versiones presentes.
    expect(await versionHashProblem(VERSIONS)).toBeNull();
    expect(lineageChainProblem(VERSIONS, { id: "linaje-oro", hashes: VERSIONS.map((version) => version.hash) })).toBeNull();
    // Y una versión retocada después de nacer ya no lo da.
    expect(await versionHashProblem([{ ...v(4), note: "retocada" }])).toMatch(/v4 .* no coincide con su hash/);
  });
});
