/**
 * La instantánea del circuito (ADR-0015): el grafo con fecha que perdura de cada fichero.
 *
 * Lo que se fija, con un anillo de doce tags inventados: la construcción valida y ordena de forma
 * canónica y un input incoherente no se guarda; entre dos instantáneas un tag aparece, desaparece, se
 * mueve (por vecinos, no por índice), cambia de clase, deja de leerse o empieza; una arista cambia con
 * la regla de la horquilla (R-TIM-010); la historia de un tramo leída de instantáneas es la misma que
 * la leída de franjas; la suma entre anclas exige la prueba de azar y dos AGV (R-DAT-021); y la
 * deriva entre periodos afirma solo lo improbable por azar y señala al AGV que deja de leer o no
 * adopta (R-DAT-016, R-AGV-013).
 */

import { describe, expect, it } from "vitest";

import type { DriftThresholds } from "../../src/domain/drift.js";
import { segmentHistories, type FranjaBand } from "../../src/domain/franjas.js";
import type { Band } from "../../src/domain/segment-bands.js";
import {
  buildSnapshot,
  compareSnapshots,
  driftBetweenSnapshots,
  historiesFromSnapshots,
  SNAPSHOT_SCHEMA_VERSION,
  structureBetweenSnapshots,
  type CircuitSnapshot,
  type SnapshotAnchorGap,
  type SnapshotEdge,
  type SnapshotInput,
  type SnapshotVertex,
} from "../../src/domain/snapshot.js";
import type { TagChangeThresholds } from "../../src/domain/tag-changes.js";

const SECOND = 1_000;
const DAY = 24 * 3600 * SECOND;
/** Doce tags inventados, del TG01 al TG12. */
const RING: readonly string[] = Array.from({ length: 12 }, (_, index) => `TG${String(index + 1).padStart(2, "0")}`);
const FLEET = ["V1", "V2", "V3", "V4"];

const DRIFT: DriftThresholds = { minGapMs: 1000, minReadingsPerVehicle: 3, minAdoptionShare: 0.8, maxChance: 0.001 };
const CHANGES: TagChangeThresholds = { minSlotPasses: 5, maxChance: 0.001, maxReadsBetween: 2, maxOverlapMs: 60 * SECOND };

function band(p50: number, p80: number): Band {
  return { samples: 30, p50Ms: p50 * SECOND, p80Ms: p80 * SECOND, p95Ms: (p80 + 2) * SECOND, fenceMs: (p80 + 32) * SECOND };
}

/** Un tag del anillo en su posición, leído en todas las pasadas salvo que se diga otra cosa. */
function vertex(tagId: string, ring: readonly string[], overrides: Partial<SnapshotVertex> = {}): SnapshotVertex {
  const position = ring.indexOf(tagId);
  const at = position === -1 ? null : position;
  return {
    tagId,
    position: at,
    offsetMs: at === null ? null : at * 10 * SECOND,
    section: null,
    funcion: null,
    declared: true,
    readRate: 1,
    passes: 40,
    readings: 40,
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

/** Las aristas del anillo, todas con la misma horquilla de producción. */
function edges(ring: readonly string[], produccion: Band | null = band(10, 12), noche: Band | null = null): SnapshotEdge[] {
  return ring.map((from, index) => ({ from, to: ring[(index + 1) % ring.length] as string, produccion, noche }));
}

interface Overrides {
  readonly sourceId?: string;
  readonly window?: { from: number; to: number };
  readonly ring?: readonly string[];
  readonly vertices?: readonly SnapshotVertex[];
  readonly edges?: readonly SnapshotEdge[];
  readonly anchorGaps?: readonly SnapshotAnchorGap[];
  readonly lapMs?: number | null;
  readonly fleetVehicles?: readonly string[] | null;
}

function input(overrides: Overrides = {}): SnapshotInput {
  const ring = overrides.ring ?? RING;
  const sourceId = overrides.sourceId ?? "f1";
  const window = overrides.window ?? { from: 0, to: DAY };
  return {
    circuitId: "circuito-sintetico",
    zone: "Europe/Madrid",
    source: { sourceId, sourceHash: `hash-${sourceId}`, fileName: `${sourceId}.csv`, window, acceptedRows: 1000 },
    capturedAt: window.to,
    appVersion: "0.0.0-prueba",
    exposure: { produccion: window.to - window.from, noche: 0 },
    cohortId: 1,
    anchorTagId: ring[0] ?? null,
    anchorDeclared: true,
    ring,
    lapMs: overrides.lapMs ?? ring.length * 10 * SECOND,
    vertices: overrides.vertices ?? ring.map((tagId) => vertex(tagId, ring)),
    edges: overrides.edges ?? edges(ring),
    sections: [],
    anchorGaps: overrides.anchorGaps ?? [],
    fleet:
      overrides.fleetVehicles === null
        ? null
        : { assigned: 4, inCircuitAtEnd: 4, inCircuitMedian: 4, historySource: "historial", vehicles: overrides.fleetVehicles ?? FLEET },
    line: null,
    lanes: [],
    findings: [],
  };
}

const snap = (overrides: Overrides = {}): CircuitSnapshot => buildSnapshot(input(overrides));

/** El anillo con `tagId` metido detrás de `after`. */
function insertAfter(ring: readonly string[], after: string, tagId: string): string[] {
  const at = ring.indexOf(after) + 1;
  return [...ring.slice(0, at), tagId, ...ring.slice(at)];
}

/** Un hueco entre anclas con sus tags, leídos todos en todas las pasadas por cuatro AGV. */
function gap(
  fromAnchor: string,
  toAnchor: string,
  tags: readonly string[],
  overrides: Partial<SnapshotAnchorGap> & { readonly p50?: number; readonly p80?: number | null } = {},
): SnapshotAnchorGap {
  const { p50 = 20, p80 = 22, ...rest } = overrides;
  const readsByTag: Record<string, { passes: number; vehicles: number; offsetMs?: number }> = {};
  tags.forEach((tagId, index) => {
    readsByTag[tagId] = { passes: 30, vehicles: 4, offsetMs: (index + 1) * 5 * SECOND };
  });
  return {
    fromAnchor,
    toAnchor,
    tags,
    produccion: p80 === null ? { samples: 30, p50Ms: p50 * SECOND } : { samples: 30, p50Ms: p50 * SECOND, p80Ms: p80 * SECOND },
    noche: null,
    passes: 30,
    readsByTag,
    vehicleIds: FLEET,
    ...rest,
  };
}

describe("construcción de la instantánea", () => {
  it("sella la versión del esquema y ordena vértices, aristas, no lectores y hallazgos de forma canónica", () => {
    const shuffled = [...RING].reverse().map((tagId) => vertex(tagId, RING, { nonReaders: ["V3", "V1"] }));
    const built = buildSnapshot({
      ...input({ vertices: [...shuffled, vertex("TG99", RING), vertex("TG50", RING)], edges: [...edges(RING)].reverse() }),
      findings: [
        { key: "b|TG02", kind: "b", title: "", figure: "", review: null },
        { key: "a|TG01", kind: "a", title: "", figure: "", review: null },
      ],
    });
    expect(built.schemaVersion).toBe(SNAPSHOT_SCHEMA_VERSION);
    // Primero los del anillo por posición; los que no están en él, detrás y por id.
    expect(built.vertices.map((entry) => entry.tagId)).toEqual([...RING, "TG50", "TG99"]);
    expect(built.edges.map((entry) => entry.from)).toEqual(RING);
    expect(built.vertices[0]?.nonReaders).toEqual(["V1", "V3"]);
    expect(built.findings.map((entry) => entry.key)).toEqual(["a|TG01", "b|TG02"]);
    // Dos construcciones con el mismo contenido en otro orden son iguales: es lo que hace comparables las instantáneas.
    expect(built).toEqual(buildSnapshot({ ...input({ vertices: [vertex("TG50", RING), vertex("TG99", RING), ...shuffled.map((entry) => ({ ...entry, nonReaders: ["V1", "V3"] }))] }), findings: [...built.findings].reverse() }));
  });

  it("no mide nada: lo que le llega es lo que guarda", () => {
    const built = snap({ lapMs: 123 * SECOND });
    expect(built.lapMs).toBe(123 * SECOND);
    expect(built.ring).toEqual(RING);
  });

  it("rechaza con el motivo un anillo con repetidos, una posición que no coincide, una arista que salta, una ventana vacía o un id vacío", () => {
    expect(() => snap({ ring: [...RING, "TG01"] })).toThrow(TypeError);
    expect(() => snap({ ring: [...RING, "TG01"] })).toThrow(/repite el tag TG01/);
    expect(() => snap({ vertices: [vertex("TG03", RING, { position: 5 })] })).toThrow(/TG03 declara la posición 5/);
    expect(() => snap({ vertices: [vertex("TG03", RING, { position: null })] })).toThrow(/TG03 está en el anillo/);
    expect(() => snap({ vertices: [vertex("TG01", RING), vertex("TG01", RING)] })).toThrow(/repetido: TG01/);
    expect(() => snap({ edges: [{ from: "TG01", to: "TG03", produccion: null, noche: null }] })).toThrow(/TG01 → TG03 no une/);
    expect(() => snap({ edges: [...edges(RING), ...edges(RING).slice(0, 1)] })).toThrow(/arista repetida/);
    expect(() => snap({ window: { from: DAY, to: DAY } })).toThrow(/ventana inválida/);
    expect(() => buildSnapshot({ ...input(), circuitId: " " })).toThrow(/circuitId vacío/);
    expect(() => snap({ vertices: [vertex("TG01", RING, { nonReaders: [""] })] })).toThrow(/AGV en nonReaders de TG01/);
  });
});

describe("qué cambió de una instantánea a la siguiente", () => {
  const before = snap({ sourceId: "f1" });

  it("un tag nuevo en el anillo aparece, entre sus vecinos, y esos vecinos no se han movido", () => {
    const ring = insertAfter(RING, "TG05", "TG13");
    const delta = compareSnapshots(before, snap({ sourceId: "f2", ring, window: { from: 2 * DAY, to: 3 * DAY } }));
    expect(delta.vertices).toMatchObject([{ tagId: "TG13", kind: "aparece", before: null }]);
    expect(delta.vertices[0]?.detail).toContain("entre TG05 y TG06");
    expect(delta.vertices[0]?.detail).not.toMatch(/porque|causa/);
  });

  it("un tag que sale del anillo desaparece", () => {
    const ring = RING.filter((tagId) => tagId !== "TG08");
    const delta = compareSnapshots(before, snap({ sourceId: "f2", ring }));
    expect(delta.vertices).toMatchObject([{ tagId: "TG08", kind: "desaparece", after: null }]);
    expect(delta.vertices[0]?.detail).toContain("entre TG07 y TG09");
  });

  it("un tag que cambia de vecinos se mueve; sus antiguos y nuevos vecinos, no: se compara por vecino y no por índice", () => {
    // TG08 pasa a ir entre TG02 y TG03: los índices de TG03…TG07 cambian todos y ninguno se ha movido.
    const ring = insertAfter(
      RING.filter((tagId) => tagId !== "TG08"),
      "TG02",
      "TG08",
    );
    const delta = compareSnapshots(before, snap({ sourceId: "f2", ring }));
    expect(delta.vertices).toMatchObject([{ tagId: "TG08", kind: "se-mueve" }]);
    expect(delta.vertices[0]?.detail).toBe("TG08 iba entre TG07 y TG09 en f1.csv y va entre TG02 y TG03 en f2.csv.");
  });

  it("otra clase de inventario es un cambio de clase", () => {
    const vertices = RING.map((tagId) => vertex(tagId, RING, tagId === "TG04" ? { inventoryClass: "ciego-parcial" } : {}));
    const delta = compareSnapshots(before, snap({ sourceId: "f2", vertices }));
    expect(delta.vertices).toMatchObject([{ tagId: "TG04", kind: "cambia-de-clase" }]);
    expect(delta.vertices[0]?.detail).toContain("«activo»");
    expect(delta.vertices[0]?.detail).toContain("«ciego-parcial»");
  });

  it("leído siempre antes y en ninguna de las pasadas después deja de leerse; al revés, empieza", () => {
    const silent = { readRate: 0, readings: 0, situation: "sin-lecturas" as const };
    const after = snap({ sourceId: "f2", vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG06" ? silent : {})) });
    expect(compareSnapshots(before, after, { maxChance: 0.001 }).vertices).toMatchObject([{ tagId: "TG06", kind: "deja-de-leerse" }]);
    expect(compareSnapshots(after, before, { maxChance: 0.001 }).vertices).toMatchObject([{ tagId: "TG06", kind: "empieza-a-leerse" }]);
    expect(compareSnapshots(before, after).vertices[0]?.detail).toBe("TG06 se leía en 40 de 40 pasadas (100 %) en f1.csv y en ninguna de 40 en f2.csv.");
  });

  it("un tag que se leía poco y falta en tres pasadas no deja de leerse: la ausencia cabe en el azar", () => {
    const rare = snap({ sourceId: "f1", vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG06" ? { readRate: 0.025, readings: 1 } : {})) });
    const few = snap({
      sourceId: "f2",
      vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG06" ? { readRate: 0, readings: 0, passes: 3 } : {})),
    });
    expect(compareSnapshots(rare, few, { maxChance: 0.001 }).vertices).toEqual([]);
    // Sin umbral, basta con que hubiera pasadas: se enseña y quien mira decide.
    expect(compareSnapshots(rare, few).vertices).toMatchObject([{ tagId: "TG06", kind: "deja-de-leerse" }]);
  });

  it("sin ninguna pasada después no se puede decir que dejó de leerse", () => {
    const none = snap({ sourceId: "f2", vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG06" ? { readRate: null, readings: 0, passes: 0 } : {})) });
    expect(compareSnapshots(before, none).vertices).toEqual([]);
  });

  it("una arista es más lenta o más rápida con la regla de la horquilla, por régimen, y la vuelta se enseña si cambia", () => {
    // Base: 16-18 s de día y 30-33 s de noche en todos los tramos. Después, TG02→TG03 tarda 30-33 s de
    // día y TG05→TG06 16-18 s de noche; el resto no cambia.
    const baseline = snap({ sourceId: "f1", edges: edges(RING, band(16, 18), band(30, 33)) });
    const changed = edges(RING, band(16, 18), band(30, 33)).map((edge) =>
      edge.from === "TG02" ? { ...edge, produccion: band(30, 33) } : edge.from === "TG05" ? { ...edge, noche: band(16, 18) } : edge,
    );
    const mixed = snap({ sourceId: "f2", edges: changed, lapMs: 130 * SECOND });
    const delta = compareSnapshots(baseline, mixed);
    expect(delta.edges).toEqual([
      { from: "TG02", to: "TG03", regime: "produccion", direction: "mas-lento", before: band(16, 18), after: band(30, 33) },
      { from: "TG05", to: "TG06", regime: "noche", direction: "mas-rapido", before: band(30, 33), after: band(16, 18) },
    ]);
    expect(delta.lapShift).toEqual({ beforeMs: 120 * SECOND, afterMs: 130 * SECOND });
    // Dentro de la variación normal (17 s frente a 16-18 s) no hay nada.
    expect(compareSnapshots(baseline, snap({ sourceId: "f3", edges: edges(RING, band(17, 19), band(30, 33)) })).edges).toEqual([]);
    expect(compareSnapshots(baseline, snap({ sourceId: "f3" })).lapShift).toBeNull();
  });

  it("identifica los dos ficheros", () => {
    expect(compareSnapshots(before, snap({ sourceId: "f2" }))).toMatchObject({ fromSourceId: "f1", toSourceId: "f2", vertices: [], edges: [], lapShift: null });
  });
});

describe("historia de cada tramo leída de las instantáneas", () => {
  const franjaBand = (p50: number, p80: number): FranjaBand => ({ from: "TG01", to: "TG02", produccion: band(p50, p80), noche: null, firstSeenUtcMs: 0, lastSeenUtcMs: 0 });
  const series: readonly (readonly [number, number])[] = [
    [16, 18],
    [30, 33],
    [31, 34],
  ];
  const snapshots = series.map(([p50, p80], index) =>
    snap({
      sourceId: `f${index + 1}`,
      window: { from: index * 10 * DAY, to: index * 10 * DAY + DAY },
      edges: [{ from: "TG01", to: "TG02", produccion: band(p50, p80), noche: null }],
    }),
  );

  it("da el mismo escalón que segmentHistories con las mismas horquillas: un único salto que se mantiene, en el fichero donde empieza", () => {
    const fromFranjas = segmentHistories(series.map(([p50, p80], index) => ({ sourceId: `f${index + 1}`, bands: [franjaBand(p50, p80)] })));
    expect(fromFranjas).toMatchObject([{ kind: "escalon", direction: "mas-lento", atSourceId: "f2" }]);
    expect(historiesFromSnapshots(snapshots, { minPositionSamples: 4 })).toEqual(fromFranjas);
  });

  it("ordena las instantáneas por ventana, no por cómo llegan, y cuenta una vez el mismo fichero cargado dos veces", () => {
    const shuffled = [snapshots[2], snapshots[0], snapshots[1]] as CircuitSnapshot[];
    const duplicate = buildSnapshot({ ...input(), source: { ...input({ sourceId: "f1" }).source, sourceId: "f1-otra-vez" }, edges: snapshots[0]!.edges });
    expect(historiesFromSnapshots([...shuffled, duplicate], { minPositionSamples: 4 })).toEqual(historiesFromSnapshots(snapshots, { minPositionSamples: 4 }));
  });
});

describe("la suma entre anclas leída de las instantáneas (R-DAT-021)", () => {
  const before = snap({ sourceId: "f1", anchorGaps: [gap("TG03", "TG06", ["TG04", "TG05"])] });
  const laterWindow = { from: 10 * DAY, to: 11 * DAY };

  it("un tag del hueco de antes que falta en todas las pasadas de después, hechas por varios AGV, está retirado; la suma, igual", () => {
    const after = snap({ sourceId: "f2", window: laterWindow, ring: RING.filter((tagId) => tagId !== "TG05"), anchorGaps: [gap("TG03", "TG06", ["TG04"])] });
    const set = structureBetweenSnapshots(before, after, CHANGES);
    expect(set).toMatchObject({ source: "entre-ficheros", beforeSourceId: "f1", afterSourceId: "f2", atUtcMs: 10 * DAY });
    expect(set?.gaps).toEqual([
      {
        fromAnchor: "TG03",
        toAnchor: "TG06",
        before: { passes: 30, vehicles: 4, p50Ms: 20 * SECOND, p80Ms: 22 * SECOND },
        after: { passes: 30, vehicles: 4, p50Ms: 20 * SECOND, p80Ms: 22 * SECOND },
        regime: "produccion",
        sum: "igual",
        changes: [{ kind: "retirado", tagId: "TG05", offsetMs: 10 * SECOND }],
        unconfirmed: [],
      },
    ]);
  });

  it("si todas las pasadas de después son de un solo AGV, la ausencia queda sin afirmar y no es un cambio", () => {
    const after = snap({ sourceId: "f2", window: laterWindow, anchorGaps: [gap("TG03", "TG06", ["TG04"], { vehicleIds: ["V2"] })] });
    const [only] = structureBetweenSnapshots(before, after, CHANGES)?.gaps ?? [];
    expect(only?.changes).toEqual([]);
    expect(only?.unconfirmed).toEqual([{ tagId: "TG05", kind: "retirado", passes: 30, agvId: "V2" }]);
  });

  it("sin la lista de AGV del hueco, los AGV distintos de otro tag leído son la cota inferior que sostiene la ausencia", () => {
    const withoutIds = gap("TG03", "TG06", ["TG04"]);
    const { vehicleIds: _ignored, ...bare } = withoutIds;
    const after = snap({ sourceId: "f2", window: laterWindow, anchorGaps: [bare] });
    expect(structureBetweenSnapshots(before, after, CHANGES)?.gaps[0]).toMatchObject({ after: { vehicles: 4 }, changes: [{ kind: "retirado", tagId: "TG05" }] });
  });

  it("un tag que se leía poco y falta después no es un cambio: la ausencia cabe en el azar", () => {
    const rare = snap({
      sourceId: "f1",
      anchorGaps: [gap("TG03", "TG06", ["TG04", "TG05"], { readsByTag: { TG04: { passes: 30, vehicles: 4 }, TG05: { passes: 1, vehicles: 1 } } })],
    });
    const after = snap({ sourceId: "f2", window: laterWindow, anchorGaps: [gap("TG03", "TG06", ["TG04"])] });
    expect(structureBetweenSnapshots(rare, after, CHANGES)?.gaps).toEqual([]);
  });

  it("un tag nuevo en el hueco de después está insertado, y si alarga la suma el tramo se lee más lento", () => {
    const after = snap({
      sourceId: "f2",
      window: laterWindow,
      ring: insertAfter(RING, "TG05", "TG13"),
      anchorGaps: [gap("TG03", "TG06", ["TG04", "TG05", "TG13"], { p50: 26, p80: 28 })],
    });
    const [only] = structureBetweenSnapshots(before, after, CHANGES)?.gaps ?? [];
    expect(only).toMatchObject({ sum: "mas-lento", changes: [{ kind: "insertado", tagId: "TG13", offsetMs: 15 * SECOND }] });
  });

  it("un retirado y un insertado entre los mismos vecinos son una sustitución en su sitio; con otro desfase, en otro punto", () => {
    const same = snap({ sourceId: "f2", window: laterWindow, ring: RING.map((tagId) => (tagId === "TG05" ? "TG55" : tagId)), anchorGaps: [gap("TG03", "TG06", ["TG04", "TG55"])] });
    expect(structureBetweenSnapshots(before, same, CHANGES)?.gaps[0]?.changes).toEqual([
      { kind: "sustituido", oldTagId: "TG05", newTagId: "TG55", oldOffsetMs: 10 * SECOND, newOffsetMs: 10 * SECOND, placement: "mismo-sitio" },
    ]);
    const moved = gap("TG03", "TG06", ["TG04", "TG55"]);
    const elsewhere = snap({
      sourceId: "f2",
      window: laterWindow,
      ring: RING.map((tagId) => (tagId === "TG05" ? "TG55" : tagId)),
      anchorGaps: [{ ...moved, readsByTag: { ...moved.readsByTag, TG55: { passes: 30, vehicles: 4, offsetMs: 16 * SECOND } } }],
    });
    // La dispersión de después es p80 − p50 = 2 s; 16 s frente a 10 s se sale de ella.
    expect(structureBetweenSnapshots(before, elsewhere, CHANGES)?.gaps[0]?.changes).toMatchObject([{ kind: "sustituido", placement: "otro-punto" }]);
  });

  it("tres seguidos cambiados a la vez son tres sustituciones en su sitio, incluido el del medio", () => {
    const wide = snap({ sourceId: "f1", anchorGaps: [gap("TG02", "TG07", ["TG03", "TG04", "TG05", "TG06"])] });
    const after = snap({
      sourceId: "f2",
      window: laterWindow,
      ring: RING.map((tagId) => ({ TG03: "X3", TG04: "X4", TG05: "X5" })[tagId] ?? tagId),
      anchorGaps: [gap("TG02", "TG07", ["X3", "X4", "X5", "TG06"])],
    });
    expect(structureBetweenSnapshots(wide, after, CHANGES)?.gaps[0]?.changes.map((change) => (change.kind === "sustituido" ? `${change.oldTagId}>${change.newTagId}` : change.kind))).toEqual([
      "TG03>X3",
      "TG04>X4",
      "TG05>X5",
    ]);
  });

  it("sin p80 guardado la suma queda sin medir, y se dice", () => {
    const after = snap({ sourceId: "f2", window: laterWindow, anchorGaps: [gap("TG03", "TG06", ["TG04"], { p80: null })] });
    expect(structureBetweenSnapshots(before, after, CHANGES)?.gaps[0]).toMatchObject({ regime: null, sum: "sin-medir", changes: [{ kind: "retirado" }] });
  });

  it("sin ningún hueco con el mismo par de anclas no hay comparación: null", () => {
    const other = snap({ sourceId: "f2", window: laterWindow, anchorGaps: [gap("TG07", "TG10", ["TG08", "TG09"])] });
    expect(structureBetweenSnapshots(before, other, CHANGES)).toBeNull();
    expect(structureBetweenSnapshots(before, snap({ sourceId: "f3", window: laterWindow }), CHANGES)).toBeNull();
  });

  it("sin cambios, un conjunto vacío", () => {
    expect(structureBetweenSnapshots(before, snap({ sourceId: "f2", window: laterWindow, anchorGaps: before.anchorGaps }), CHANGES)?.gaps).toEqual([]);
  });
});

describe("deriva entre dos instantáneas distantes (R-DAT-016, R-AGV-013)", () => {
  const early = snap({ sourceId: "f1" });
  const laterWindow = { from: 10 * DAY, to: 11 * DAY };
  const silent = { readRate: 0, readings: 0, situation: "sin-lecturas" as const };

  it("periodos = las ventanas, y con las ventanas casi seguidas no se evalúa", () => {
    const late = snap({ sourceId: "f2", window: laterWindow });
    expect(driftBetweenSnapshots(early, late, DRIFT)).toMatchObject({ evaluated: true, reason: null, earlyPeriod: early.window, latePeriod: laterWindow, tagDrifts: [], vehicleDrifts: [] });
    const touching = snap({ sourceId: "f2", window: { from: DAY + 500, to: 2 * DAY } });
    expect(driftBetweenSnapshots(early, touching, DRIFT)).toMatchObject({ evaluated: false, tagDrifts: [] });
  });

  it("leído siempre antes y nunca después es un desaparecido afirmado: su vecino da cuarenta oportunidades", () => {
    const late = snap({ sourceId: "f2", window: laterWindow, ring: RING.filter((tagId) => tagId !== "TG05") });
    const [only] = driftBetweenSnapshots(early, late, DRIFT).tagDrifts;
    expect(only).toEqual({ kind: "desaparecido", tagId: "TG05", readingsBefore: 40, affirmed: true, chance: 0, opportunities: 40, neighborTagId: "TG04" });
  });

  it("leído una vez antes y nunca después es un desaparecido sin afirmar, con su cifra", () => {
    const rare = snap({ sourceId: "f1", vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG05" ? { readRate: 0.025, readings: 1 } : {})) });
    const late = snap({ sourceId: "f2", window: laterWindow, vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG05" ? silent : {})) });
    const [only] = driftBetweenSnapshots(rare, late, DRIFT).tagDrifts;
    expect(only).toMatchObject({ kind: "desaparecido", tagId: "TG05", readingsBefore: 1, affirmed: false, opportunities: 40 });
    expect(only?.kind === "desaparecido" && only.chance).toBeCloseTo(0.975 ** 40, 6);
  });

  it("sin vecino dominante no hay oportunidades y no se afirma", () => {
    const orphan = snap({ sourceId: "f1", vertices: [...RING.map((tagId) => vertex(tagId, RING)), vertex("TG77", RING, { readRate: null, passes: 0, readings: 5, situation: "fuera" })] });
    const late = snap({ sourceId: "f2", window: laterWindow });
    expect(driftBetweenSnapshots(orphan, late, DRIFT).tagDrifts).toEqual([{ kind: "desaparecido", tagId: "TG77", readingsBefore: 5, affirmed: false, chance: 1, opportunities: 0, neighborTagId: null }]);
  });

  it("un tag nuevo leído siempre después sale nuevo y afirmado", () => {
    const ring = insertAfter(RING, "TG05", "TG13");
    const late = snap({ sourceId: "f2", window: laterWindow, ring });
    expect(driftBetweenSnapshots(early, late, DRIFT).tagDrifts).toEqual([{ kind: "nuevo", tagId: "TG13", readingsAfter: 40, affirmed: true, chance: 0, opportunities: 40, neighborTagId: "TG05" }]);
  });

  it("declarado y sin lecturas en las dos es obsoleto consolidado, nunca confirmado", () => {
    const ghost = vertex("TG88", RING, { readRate: null, passes: 0, readings: 0 });
    const a = snap({ sourceId: "f1", vertices: [...RING.map((tagId) => vertex(tagId, RING)), ghost] });
    const b = snap({ sourceId: "f2", window: laterWindow, vertices: [...RING.map((tagId) => vertex(tagId, RING)), ghost] });
    expect(driftBetweenSnapshots(a, b, DRIFT).tagDrifts).toEqual([{ kind: "obsoleto-consolidado", tagId: "TG88" }]);
    const undeclared = { ...ghost, declared: false };
    expect(driftBetweenSnapshots(snap({ vertices: [undeclared] }), snap({ window: laterWindow, vertices: [undeclared] }), DRIFT).tagDrifts).toEqual([]);
  });

  it("un desaparecido y un nuevo con el mismo vecino dominante son una sustitución candidata, y el nuevo no se repite suelto", () => {
    const ring = RING.map((tagId) => (tagId === "TG05" ? "TG55" : tagId));
    const late = snap({ sourceId: "f2", window: laterWindow, ring });
    expect(driftBetweenSnapshots(early, late, DRIFT).tagDrifts).toEqual([
      { kind: "sustitucion-candidata", tagId: "TG05", nuevoTagId: "TG55", readingsBefore: 40, readingsAfter: 40, sharedNeighbor: "TG06", neighborSide: "sucesor" },
    ]);
  });

  it("dos desaparecidos con el mismo vecino que un solo nuevo no se emparejan (R-EVI-004)", () => {
    // TG05 y TG06 desaparecen; TG55 ocupa su sitio con TG04 delante y TG07 detrás: ambiguo, tres hallazgos sueltos.
    const ring = RING.filter((tagId) => tagId !== "TG05" && tagId !== "TG06").map((tagId) => (tagId === "TG07" ? "TG07" : tagId));
    const late = snap({ sourceId: "f2", window: laterWindow, ring: insertAfter(ring, "TG04", "TG55") });
    expect(driftBetweenSnapshots(early, late, DRIFT).tagDrifts.map((entry) => `${entry.kind}:${entry.tagId}`)).toEqual(["desaparecido:TG05", "desaparecido:TG06", "nuevo:TG55"]);
  });

  it("un AGV que leía un tag y en la instantánea tardía nunca lo lee, siguiendo vivo el tag, deja de leerlo", () => {
    const late = snap({ sourceId: "f2", window: laterWindow, vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG07" ? { readRate: 0.75, readings: 30, nonReaders: ["V2"] } : {})) });
    expect(driftBetweenSnapshots(early, late, DRIFT).vehicleDrifts).toEqual([{ agvId: "V2", droppedTags: ["TG07"], notAdoptedTags: [] }]);
  });

  it("un AGV que ya no lo leía antes, o que no está en las dos flotas, no deja de leer nada", () => {
    const beforeToo = snap({ sourceId: "f1", vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG07" ? { readRate: 0.75, readings: 30, nonReaders: ["V2"] } : {})) });
    const late = snap({ sourceId: "f2", window: laterWindow, vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG07" ? { readRate: 0.5, readings: 20, nonReaders: ["V2", "V9"] } : {})) });
    expect(driftBetweenSnapshots(beforeToo, late, DRIFT).vehicleDrifts).toEqual([]);
  });

  it("un tag que murió para toda la flota no se repite por cada AGV que lo leía", () => {
    const late = snap({ sourceId: "f2", window: laterWindow, vertices: RING.map((tagId) => vertex(tagId, RING, tagId === "TG07" ? { ...silent, nonReaders: FLEET } : {})) });
    const result = driftBetweenSnapshots(early, late, DRIFT);
    expect(result.tagDrifts).toMatchObject([{ kind: "desaparecido", tagId: "TG07" }]);
    expect(result.vehicleDrifts).toEqual([]);
  });

  it("un tag nuevo que la flota ya lee y un AGV no, no lo ha adoptado; por debajo de la cuota de adopción, nadie", () => {
    const ring = insertAfter(RING, "TG05", "TG13");
    const adopted = snap({ sourceId: "f2", window: laterWindow, ring, vertices: ring.map((tagId) => vertex(tagId, ring, tagId === "TG13" ? { readRate: 0.9, readings: 36, nonReaders: ["V3"] } : {})) });
    expect(driftBetweenSnapshots(early, adopted, DRIFT).vehicleDrifts).toEqual([{ agvId: "V3", droppedTags: [], notAdoptedTags: ["TG13"] }]);
    const half = snap({ sourceId: "f2", window: laterWindow, ring, vertices: ring.map((tagId) => vertex(tagId, ring, tagId === "TG13" ? { readRate: 0.5, readings: 20, nonReaders: ["V3", "V4"] } : {})) });
    expect(driftBetweenSnapshots(early, half, DRIFT).vehicleDrifts).toEqual([]);
  });

  it("el lado nuevo de una sustitución candidata también cuenta para la adopción", () => {
    const ring = RING.map((tagId) => (tagId === "TG05" ? "TG55" : tagId));
    const late = snap({ sourceId: "f2", window: laterWindow, ring, vertices: ring.map((tagId) => vertex(tagId, ring, tagId === "TG55" ? { readRate: 0.85, readings: 34, nonReaders: ["V1"] } : {})) });
    expect(driftBetweenSnapshots(early, late, DRIFT).vehicleDrifts).toEqual([{ agvId: "V1", droppedTags: [], notAdoptedTags: ["TG55"] }]);
  });
});
