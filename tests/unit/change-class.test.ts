/**
 * La clasificación de los cambios frente al esperado (`MEMORY_CONSOLIDATION.md` §8; OQ-146..148,
 * propietario 2026-09-27).
 *
 * Con un anillo sintético de seis tags (T001…T006), una sección entre anclas que cubre todo el anillo
 * y cuatro AGV inventados. Lo que se fija: un cambio sostenido en tres ficheros y colectivo pasa al
 * esperado; con dos ficheros, o sin saber cuántos AGV pasan, o si lo muestra una minoría, queda como
 * deriva pendiente y dice por qué; una incidencia y una confirmación ganan a todo lo demás; lo que se
 * vio y ya no está es un evento puntual; en una arista, «la mayoría» es la mediana de las pasadas
 * (interpretación escrita); el esperado conserva lo anterior en lo que no se adopta, no admite lo que
 * aparece sin adoptarse y deja sin medida la incidencia que no tiene anterior; y los sujetos de una
 * incidencia y de los eventos del plano salen de sus tags.
 */

import { describe, expect, it } from "vitest";

import {
  classifyChanges,
  confirmedSubjectsOf,
  expectedSnapshot,
  incidentSubjectsOf,
  summarizeChanges,
  type ClassifiedChange,
  type ClassifyInput,
} from "../../src/domain/change-class.js";
import type { PlanEvent } from "../../src/domain/plan.js";
import type { Band } from "../../src/domain/segment-bands.js";
import { buildSnapshot, type CircuitSnapshot, type SnapshotAnchorGap, type SnapshotEdge, type SnapshotVertex } from "../../src/domain/snapshot.js";

const SECOND = 1_000;
const DAY = 24 * 3600 * SECOND;
const RING: readonly string[] = ["T001", "T002", "T003", "T004", "T005", "T006"];
const FLEET = ["AGV-01", "AGV-02", "AGV-03", "AGV-04"];
const THRESHOLDS = { sustainedFiles: 3, collectiveShare: 0.5, maxChance: 0.001 };

const band = (p50: number, p80: number): Band => ({ samples: 30, p50Ms: p50 * SECOND, p80Ms: p80 * SECOND, p95Ms: (p80 + 2) * SECOND, fenceMs: (p80 + 10) * SECOND });
const NORMAL = band(10, 12);
const SLOW = band(20, 24);

function vertex(tagId: string, ring: readonly string[], overrides: Partial<SnapshotVertex> = {}): SnapshotVertex {
  const at = ring.indexOf(tagId);
  return {
    tagId,
    position: at < 0 ? null : at,
    offsetMs: at < 0 ? null : at * 10 * SECOND,
    section: null,
    funcion: null,
    declared: true,
    readRate: 1,
    passes: 40,
    readings: 40,
    nonReaders: [],
    predecessor: null,
    successor: null,
    inventoryClass: "activo",
    situation: at < 0 ? "fuera" : "anillo",
    laneId: null,
    isAnchor: at === 0,
    ...overrides,
  };
}

interface SnapOptions {
  readonly day: number;
  readonly ring?: readonly string[];
  /** Lo que cambia en cada vértice. */
  readonly vertices?: Readonly<Record<string, Partial<SnapshotVertex>>>;
  /** Vehículos distintos que leen cada tag en la sección; por defecto, los cuatro. */
  readonly readers?: Readonly<Record<string, number>>;
  /** Sin la lista de AGV de la sección. */
  readonly noVehicleIds?: boolean;
  readonly edges?: Readonly<Record<string, Band | null>>;
}

/** Una instantánea del día `day`, con una sección entre anclas T001 → T001 que cubre el anillo. */
function snap(options: SnapOptions): CircuitSnapshot {
  const ring = options.ring ?? RING;
  const sourceId = `f${options.day}`;
  const window = { from: options.day * DAY, to: (options.day + 1) * DAY };
  const inner = ring.slice(1);
  const readsByTag: Record<string, { passes: number; vehicles: number }> = {};
  for (const tagId of inner) {
    const vehicles = options.readers?.[tagId] ?? FLEET.length;
    if (vehicles > 0) readsByTag[tagId] = { passes: 40, vehicles };
  }
  const gap: SnapshotAnchorGap = {
    fromAnchor: ring[0] as string,
    toAnchor: ring[0] as string,
    tags: inner,
    produccion: { samples: 40, p50Ms: 60 * SECOND, p80Ms: 65 * SECOND },
    noche: null,
    passes: 40,
    readsByTag,
    ...(options.noVehicleIds === true ? {} : { vehicleIds: FLEET }),
  };
  const edges: SnapshotEdge[] = ring.map((from, index) => {
    const to = ring[(index + 1) % ring.length] as string;
    const key = `${from}>${to}`;
    return { from, to, produccion: options.edges !== undefined && key in options.edges ? (options.edges[key] ?? null) : NORMAL, noche: null };
  });
  const tagIds = [...new Set([...ring, ...Object.keys(options.vertices ?? {})])];
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
    vertices: tagIds.map((tagId) => vertex(tagId, ring, options.vertices?.[tagId] ?? {})),
    edges,
    sections: [],
    anchorGaps: [gap],
    fleet: { assigned: 4, inCircuitAtEnd: 4, inCircuitMedian: 4, historySource: "historial", vehicles: FLEET },
    line: null,
    lanes: [],
    findings: [],
  });
}

/** T003 sin leer por nadie: lo que se ve cuando deja de leerse de verdad. */
const SILENT_T003 = { vertices: { T003: { readRate: 0, readings: 0 } }, readers: { T003: 0 } } as const;

const EXPECTED = snap({ day: 0 });

function classify(history: readonly CircuitSnapshot[], overrides: Partial<ClassifyInput> = {}): readonly ClassifiedChange[] {
  return classifyChanges({
    expected: EXPECTED,
    history,
    incidentSubjects: new Set(),
    confirmedSubjects: new Set(),
    thresholds: THRESHOLDS,
    ...overrides,
  });
}

const only = (changes: readonly ClassifiedChange[]): ClassifiedChange => {
  expect(changes).toHaveLength(1);
  return changes[0] as ClassifiedChange;
};

describe("clasificar cambios · §8, OQ-146, OQ-147", () => {
  it("sostenido en tres ficheros y colectivo: cambio colectivo sostenido, adoptado", () => {
    const change = only(classify([snap({ day: 1, ...SILENT_T003 }), snap({ day: 2, ...SILENT_T003 }), snap({ day: 3, ...SILENT_T003 })]));
    expect(change).toMatchObject({
      key: "vertice|T003|deja-de-leerse",
      subject: { kind: "vertice", tagId: "T003" },
      change: "deja-de-leerse",
      cls: "cambio-colectivo-sostenido",
      files: 3,
      collective: { share: 1, affected: 4, passing: 4 },
      adopted: true,
    });
    expect(change.reason).toContain("Se mantiene en 3 ficheros seguidos");
    expect(change.reason).toContain("4 de 4 AGV que pasan por su sitio");
  });

  it("solo los ficheros seguidos desde el actual cuentan: con dos es deriva pendiente", () => {
    // Estuvo en f1, no en f2, y está en f3 y f4: lleva dos seguidos.
    const change = only(
      classify([snap({ day: 1, ...SILENT_T003 }), snap({ day: 2 }), snap({ day: 3, ...SILENT_T003 }), snap({ day: 4, ...SILENT_T003 })]),
    );
    expect(change).toMatchObject({ cls: "deriva-pendiente", files: 2, adopted: false });
    expect(change.reason).toContain("Lleva 2 de 3 ficheros seguidos");
    expect(change.reason).toContain("Es colectivo");
  });

  it("tres ficheros sin saber cuántos AGV pasan: deriva pendiente, y lo dice", () => {
    const silent = { ...SILENT_T003, noVehicleIds: true };
    const change = only(classify([snap({ day: 1, ...silent }), snap({ day: 2, ...silent }), snap({ day: 3, ...silent })]));
    expect(change).toMatchObject({ cls: "deriva-pendiente", files: 3, collective: { share: null, affected: null, passing: null }, adopted: false });
    expect(change.reason).toContain("la instantánea no dice cuántos AGV pasan por su sitio");
    expect(change.reason).toContain("No se sabe si es colectivo");
  });

  it("si lo muestra una minoría de los AGV que pasan, no es colectivo", () => {
    // En el esperado T003 no se leía nunca; ahora lo lee 1 de los 4 AGV.
    const expected = snap({ day: 0, vertices: { T003: { readRate: 0, readings: 0 } }, readers: { T003: 0 } });
    const starts = { vertices: { T003: { readRate: 0.25, readings: 10 } }, readers: { T003: 1 } };
    const change = only(classify([snap({ day: 1, ...starts }), snap({ day: 2, ...starts }), snap({ day: 3, ...starts })], { expected }));
    expect(change).toMatchObject({ change: "empieza-a-leerse", cls: "deriva-pendiente", files: 3, collective: { share: 0.25, affected: 1, passing: 4 }, adopted: false });
    expect(change.reason).toContain("No es colectivo: lo muestra 1 de 4 AGV");
  });

  it("una incidencia gana a sostenido y colectivo, y una confirmación gana aunque lleve un solo fichero", () => {
    const history = [snap({ day: 1, ...SILENT_T003 }), snap({ day: 2, ...SILENT_T003 }), snap({ day: 3, ...SILENT_T003 })];
    const incident = only(classify(history, { incidentSubjects: new Set(["vertice|T003"]), confirmedSubjects: new Set(["vertice|T003"]) }));
    expect(incident).toMatchObject({ cls: "incidencia", adopted: false });
    const confirmed = only(classify([snap({ day: 3, ...SILENT_T003 })], { confirmedSubjects: new Set(["vertice|T003"]) }));
    expect(confirmed).toMatchObject({ cls: "cambio-confirmado", files: 1, adopted: true });
  });

  it("lo que se vio en un fichero anterior y ya no está es un evento puntual, no adoptado", () => {
    const changes = classify([snap({ day: 1, ...SILENT_T003 }), snap({ day: 2 })]);
    expect(changes.map((change) => [change.key, change.cls, change.files, change.adopted])).toEqual([["vertice|T003|deja-de-leerse", "evento-puntual", 0, false]]);
    expect(changes[0]?.reason).toContain("volvió solo");
  });

  it("en una arista, «la mayoría» es la mediana de las pasadas (interpretación escrita)", () => {
    const slow = { edges: { "T003>T004": SLOW } };
    const change = only(classify([snap({ day: 1, ...slow }), snap({ day: 2, ...slow }), snap({ day: 3, ...slow })]));
    expect(change).toMatchObject({
      key: "arista|T003|T004|produccion|mas-lento",
      subject: { kind: "arista", from: "T003", to: "T004", regime: "produccion" },
      cls: "cambio-colectivo-sostenido",
      collective: { share: null, affected: null, passing: null },
      adopted: true,
    });
    expect(change.reason).toContain("la mediana de las pasadas se movió: más de la mitad de las pasadas");
    // Si la configuración pide más de la mitad, la mediana no basta.
    const strict = only(classify([snap({ day: 1, ...slow }), snap({ day: 2, ...slow }), snap({ day: 3, ...slow })], { thresholds: { ...THRESHOLDS, collectiveShare: 0.75 } }));
    expect(strict.cls).toBe("deriva-pendiente");
  });

  it("un tag que se mueve no tiene medida colectiva: solo pasa si se confirma", () => {
    const moved = ["T001", "T002", "T004", "T005", "T003", "T006"];
    const changes = classify([snap({ day: 1, ring: moved }), snap({ day: 2, ring: moved }), snap({ day: 3, ring: moved })]);
    const move = changes.find((change) => change.change === "se-mueve");
    expect(move).toMatchObject({ subject: { tagId: "T003" }, cls: "deriva-pendiente", adopted: false });
    expect(move?.reason).toContain("no tiene medida colectiva");
  });

  it("sin esperado (primera versión) no hay cambios", () => {
    expect(classify([snap({ day: 1, ...SILENT_T003 })], { expected: null })).toEqual([]);
    expect(summarizeChanges([], [])).toEqual({ adopted: 0, pending: 0, incidents: 0 });
  });
});

describe("el esperado que se consolida · OQ-148", () => {
  it("conserva el valor anterior en lo no adoptado y toma lo observado en lo adoptado", () => {
    const observed = snap({ day: 3, vertices: { T003: { readRate: 0, readings: 0 }, T005: { readRate: 0, readings: 0 } }, readers: { T003: 0, T005: 0 }, edges: { "T001>T002": SLOW } });
    const changes = classify([observed], { confirmedSubjects: new Set(["vertice|T005"]) });
    expect(changes.map((change) => [change.key, change.cls])).toEqual([
      ["vertice|T003|deja-de-leerse", "deriva-pendiente"],
      ["vertice|T005|deja-de-leerse", "cambio-confirmado"],
      ["arista|T001|T002|produccion|mas-lento", "deriva-pendiente"],
    ]);
    const expected = expectedSnapshot(EXPECTED, observed, changes, new Set());
    const at = (tagId: string): SnapshotVertex | undefined => expected.vertices.find((entry) => entry.tagId === tagId);
    expect(at("T003")).toMatchObject({ readRate: 1, readings: 40 });
    expect(at("T005")).toMatchObject({ readRate: 0, readings: 0 });
    expect(expected.edges.find((edge) => edge.from === "T001")?.produccion).toEqual(NORMAL);
    // Todo lo demás, y la procedencia, de lo observado.
    expect(expected.sourceId).toBe(observed.sourceId);
    expect(expected.ring).toEqual(RING);
  });

  it("un tag que aparece sin adoptarse no entra; uno que desaparece sin adoptarse se conserva en su sitio", () => {
    const ring = ["T001", "T002", "T007", "T003", "T005", "T006"];
    const observed = snap({ day: 3, ring });
    const changes = classify([observed]);
    expect(changes.map((change) => [change.key, change.cls])).toEqual([
      ["vertice|T004|desaparece", "deriva-pendiente"],
      ["vertice|T007|aparece", "deriva-pendiente"],
    ]);
    const expected = expectedSnapshot(EXPECTED, observed, changes, new Set());
    expect(expected.ring).toEqual(RING);
    expect(expected.vertices.map((entry) => [entry.tagId, entry.position])).toEqual(RING.map((tagId, index) => [tagId, index]));
    // Las aristas unen el anillo del esperado: T002 → T003 y T003 → T004 → T005 vuelven del anterior.
    expect(expected.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(RING.map((tagId, index) => `${tagId}>${RING[(index + 1) % RING.length]}`));
    // Adoptados (confirmados), el esperado es lo observado.
    const confirmed = classify([observed], { confirmedSubjects: new Set(["vertice|T004", "vertice|T007"]) });
    expect(expectedSnapshot(EXPECTED, observed, confirmed, new Set()).ring).toEqual(ring);
  });

  it("el desglose por AGV va con las cifras de las que sale: el del esperado anterior en lo no adoptado, ninguno sin medida", () => {
    // El esperado anterior: T003 leído por todos. Lo observado: T003 sin leer, con su propio desglose.
    const before = snap({ day: 0, vertices: { T003: { byVehicle: { "AGV-01": [10, 10], "AGV-02": [10, 10] } } } });
    const observed = snap({ day: 3, ...SILENT_T003, vertices: { T003: { readRate: 0, readings: 0, byVehicle: { "AGV-01": [10, 0], "AGV-02": [10, 0] } } } });
    const changes = classify([observed], { expected: before });
    expect(changes.map((change) => [change.key, change.cls])).toEqual([["vertice|T003|deja-de-leerse", "deriva-pendiente"]]);
    const kept = expectedSnapshot(before, observed, changes, new Set()).vertices.find((entry) => entry.tagId === "T003");
    // Pasadas y aciertos del anterior, y el desglose también del anterior: nunca mezclados.
    expect(kept).toMatchObject({ readRate: 1, readings: 40, byVehicle: { "AGV-01": [10, 10], "AGV-02": [10, 10] } });
    // Una incidencia sin anterior queda sin medida, y sin desglose, que sería la medida de la incidencia.
    const subjects = new Set(incidentSubjectsOf("tag-rotura|T003", observed));
    const first = expectedSnapshot(null, observed, [], subjects).vertices.find((entry) => entry.tagId === "T003");
    expect(first).toMatchObject({ readRate: null, passes: 0 });
    expect(first?.byVehicle).toBeUndefined();
  });

  it("lo que toca una incidencia toma el valor anterior o, sin anterior, queda sin medida", () => {
    const observed = snap({ day: 3, vertices: { T003: { readRate: 0.2, readings: 8 } }, edges: { "T003>T004": SLOW } });
    const subjects = new Set(incidentSubjectsOf("tag-rotura|T003", observed));
    const withPrevious = expectedSnapshot(EXPECTED, observed, classify([observed], { incidentSubjects: subjects }), subjects);
    expect(withPrevious.vertices.find((entry) => entry.tagId === "T003")).toMatchObject({ readRate: 1, readings: 40 });
    expect(withPrevious.edges.find((edge) => edge.from === "T003")?.produccion).toEqual(NORMAL);
    // Primera versión: sin anterior, sin medida; nunca la medida de la incidencia.
    const first = expectedSnapshot(null, observed, [], subjects);
    expect(first.vertices.find((entry) => entry.tagId === "T003")).toMatchObject({ readRate: null, passes: 0, readings: 0 });
    expect(first.edges.find((edge) => edge.from === "T003")).toMatchObject({ produccion: null, noche: null });
    expect(first.edges.find((edge) => edge.from === "T002")).toMatchObject({ produccion: null });
    expect(first.edges.find((edge) => edge.from === "T004")?.produccion).toEqual(NORMAL);
    // Sin incidencias ni cambios, el esperado es lo observado.
    expect(expectedSnapshot(null, observed, [], new Set())).toEqual(observed);
  });
});

describe("sujetos de incidencias y confirmaciones", () => {
  it("incidentSubjectsOf: los tags del anillo nombrados en la clave y sus aristas en los dos regímenes", () => {
    expect(incidentSubjectsOf("punto-conflictivo|T002|T003", EXPECTED)).toEqual([
      "vertice|T002",
      "vertice|T003",
      "arista|T001|T002|produccion",
      "arista|T001|T002|noche",
      "arista|T002|T003|produccion",
      "arista|T002|T003|noche",
      "arista|T003|T004|produccion",
      "arista|T003|T004|noche",
    ]);
    // Varios tags juntos con «+», como la clave de un punto conflictivo.
    expect(incidentSubjectsOf("punto-conflictivo|T005+T006", EXPECTED).filter((key) => key.startsWith("vertice|"))).toEqual(["vertice|T005", "vertice|T006"]);
    // Un AGV o un tag fuera del anillo no tocan el grafo.
    expect(incidentSubjectsOf("agv-rotura|AGV-01", EXPECTED)).toEqual([]);
    expect(incidentSubjectsOf("tag-rotura|T099", EXPECTED)).toEqual([]);
  });

  it("incidentSubjectsOf con tagIds (OQ-149): mandan los tags explícitos, con sus tramos de entrada y salida en los dos regímenes", () => {
    // La clave de un bloqueo junta AGV, tag e instante en una parte: sin tagIds no se lee ningún tag.
    expect(incidentSubjectsOf("bloqueo|AGV-01 T004 1000", EXPECTED)).toEqual([]);
    expect(incidentSubjectsOf("bloqueo|AGV-01 T004 1000", EXPECTED, ["T004"])).toEqual([
      "vertice|T004",
      "arista|T003|T004|produccion",
      "arista|T003|T004|noche",
      "arista|T004|T005|produccion",
      "arista|T004|T005|noche",
    ]);
    // El primero del anillo: su tramo de entrada viene del último.
    expect(incidentSubjectsOf("linea|AGV-02", EXPECTED, ["T001"])).toEqual([
      "vertice|T001",
      "arista|T006|T001|produccion",
      "arista|T006|T001|noche",
      "arista|T001|T002|produccion",
      "arista|T001|T002|noche",
    ]);
    // Vacío: no toca nada del grafo aunque la clave nombre un tag del anillo.
    expect(incidentSubjectsOf("tag-rotura|T003", EXPECTED, [])).toEqual([]);
    // Un AGV que se llamara como un tag no lo toca si el hallazgo dice que no tiene tags.
    expect(incidentSubjectsOf("agv-rotura|T002", EXPECTED, [])).toEqual([]);
    // Un tag que la instantánea no conoce no toca nada.
    expect(incidentSubjectsOf("bloqueo|AGV-01 T099 1000", EXPECTED, ["T099"])).toEqual([]);
  });

  it("confirmedSubjectsOf: los tags de los eventos del plano con fecha efectiva en el periodo", () => {
    const base = { circuitId: "circuito-sintetico", recordedAt: 0, reason: "prueba", evidence: null, origin: "manual" as const };
    const events: PlanEvent[] = [
      { ...base, seq: 1, effectiveAt: 0, type: "crear-plano", fromVersion: 1, ring: RING.map((tagId, index) => ({ locationId: `U${index + 1}`, tagId })) },
      { ...base, seq: 2, effectiveAt: 2 * DAY, type: "sustituir", locationId: "U3", tagId: "T103" },
      { ...base, seq: 3, effectiveAt: 2 * DAY, type: "revision-manual", locationId: "U4", result: "correcto", note: "" },
      { ...base, seq: 4, effectiveAt: 2 * DAY, type: "retirar", locationId: "U5" },
      // Fuera del periodo: antes del esperado y después del fichero.
      { ...base, seq: 5, effectiveAt: DAY / 2, type: "retirar", locationId: "U2" },
      { ...base, seq: 6, effectiveAt: 9 * DAY, type: "retirar", locationId: "U6" },
    ];
    const subjects = confirmedSubjectsOf(events, { after: DAY, until: 4 * DAY }, [EXPECTED]);
    const vertices = [...subjects].filter((key) => key.startsWith("vertice|"));
    expect(vertices).toEqual(["vertice|T003", "vertice|T005", "vertice|T103"]);
    expect(subjects.has("arista|T002|T003|produccion")).toBe(true);
    expect(subjects.has("arista|T005|T006|noche")).toBe(true);
    expect(subjects.has("vertice|T004")).toBe(false);
  });
});
