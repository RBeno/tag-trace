/**
 * TC-375: las lecturas nuevas frente al periodo anterior (R-DAT-024) y la herencia de un tag que
 * sustituye a otro (R-GRA-023). Instantáneas sintéticas escritas a mano: solo lo que la comparación lee.
 */

import { describe, expect, it } from "vitest";

import { comparePeriods, previousSnapshot, rateShift } from "../../src/domain/period-comparison.js";
import type { CircuitSnapshot, SnapshotConnections, SnapshotFinding, SnapshotVertex } from "../../src/domain/snapshot.js";
import { confirmedSubstitutions, inheritRoles, mergeSubstitutions, roleText } from "../../src/domain/substitution.js";
import { cutShift, findingsLine, readShift, substitutionLine, suppliedLines } from "../../src/presentation/comparison-ui.js";

const DAY = 86_400_000;
const MAX_CHANCE = 0.01;
const RING = ["0100", "0200", "0300", "0400"];

function vertex(tagId: string, passes: number, rate: number | null, byVehicle?: Record<string, readonly [number, number]>): SnapshotVertex {
  return {
    tagId,
    position: RING.indexOf(tagId),
    offsetMs: null,
    section: null,
    funcion: null,
    declared: true,
    readRate: rate,
    passes,
    readings: rate === null ? 0 : Math.round(rate * passes),
    nonReaders: [],
    predecessor: null,
    successor: null,
    inventoryClass: null,
    situation: "anillo",
    laneId: null,
    isAnchor: tagId === RING[0],
    ...(byVehicle === undefined ? {} : { byVehicle }),
  };
}

function snapshot(day: number, vertices: readonly SnapshotVertex[], findings: readonly SnapshotFinding[], connections?: SnapshotConnections, vehicles: readonly string[] = ["007", "012"]): CircuitSnapshot {
  return {
    schemaVersion: 1,
    circuitId: "SINT",
    zone: "Europe/Madrid",
    sourceId: `f${day}`,
    sourceHash: `h${day}`,
    fileName: `f${day}.csv`,
    window: { from: day * DAY, to: (day + 1) * DAY },
    capturedAt: 0,
    appVersion: "prueba",
    acceptedRows: 100,
    exposure: { produccion: DAY, noche: 0 },
    cohortId: 1,
    anchorTagId: RING[0] as string,
    anchorDeclared: true,
    ring: RING,
    lapMs: null,
    vertices,
    edges: [],
    sections: [],
    anchorGaps: [],
    fleet: { assigned: vehicles.length, inCircuitAtEnd: vehicles.length, inCircuitMedian: vehicles.length, historySource: "lecturas", vehicles },
    line: null,
    lanes: [],
    findings,
    ...(connections === undefined ? {} : { connections }),
  };
}

const finding = (key: string, figure: string, extra: Partial<SnapshotFinding> = {}): SnapshotFinding => ({ key, kind: key.split("|")[0] as string, title: key, figure, review: null, ...extra });

describe("TC-375 la prueba de cambio de tasa", () => {
  it("con muchas pasadas, pocas omisiones nuevas frente a muchas es mejora; el reverso, empeora", () => {
    expect(rateShift({ passes: 200, misses: 60 }, { passes: 200, misses: 4 }, MAX_CHANCE)?.direction).toBe("mejora");
    expect(rateShift({ passes: 200, misses: 4 }, { passes: 200, misses: 60 }, MAX_CHANCE)?.direction).toBe("empeora");
  });

  it("con pocas pasadas, la misma diferencia no se afirma; sin omisiones ni pasadas, nada", () => {
    expect(rateShift({ passes: 6, misses: 2 }, { passes: 6, misses: 0 }, MAX_CHANCE)).toBeNull();
    expect(rateShift({ passes: 100, misses: 0 }, { passes: 100, misses: 0 }, MAX_CHANCE)).toBeNull();
    expect(rateShift({ passes: 0, misses: 0 }, { passes: 100, misses: 50 }, MAX_CHANCE)).toBeNull();
  });
});

describe("TC-375 hallazgos frente al periodo anterior", () => {
  const before = snapshot(
    1,
    [vertex("0100", 200, 1), vertex("0200", 200, 0.7), vertex("0300", 200, 0.98), vertex("0400", 200, 1)],
    [
      finding("omision|0200", "70 %"),
      finding("omision|0300", "98 %"),
      finding("deja-de-leer|007", "3", { agvId: "007" }),
      finding("omision|0400", "x"),
    ],
  );
  const after = snapshot(
    2,
    [vertex("0100", 200, 1), vertex("0200", 200, 0.99), vertex("0300", 200, 0.98), vertex("0400", 0, null)],
    [finding("omision|0300", "97 %"), finding("rotura|0100", "1")],
    undefined,
    ["012"],
  );
  const result = comparePeriods({ before, after, reviews: new Map([["omision|0200", { state: "confirmado" as const }]]), maxChance: MAX_CHANCE });
  const fate = (key: string): string | undefined => result.findings.find((entry) => entry.key === key)?.fate;

  it("el que no se repite con su sitio leído ya no aparece, y conserva su revisión", () => {
    expect(fate("omision|0200")).toBe("ya-no-aparece");
    expect(result.findings.find((entry) => entry.key === "omision|0200")?.review).toBe("confirmado");
  });

  it("el que sigue lleva las dos cifras; el nuevo, la suya", () => {
    expect(result.findings.find((entry) => entry.key === "omision|0300")).toMatchObject({ fate: "sigue", figureBefore: "98 %", figureAfter: "97 %" });
    expect(fate("rotura|0100")).toBe("nuevo");
  });

  it("sin pasadas por su tag, o sin su AGV en el periodo nuevo, queda sin ocasión: no se da por resuelto", () => {
    expect(fate("omision|0400")).toBe("sin-ocasion");
    expect(fate("deja-de-leer|007")).toBe("sin-ocasion");
  });

  it("el tag que lee mucho más mejora; el que no cambia no sale", () => {
    expect(result.tags.better.map((entry) => entry.id)).toEqual(["0200"]);
    expect(result.tags.worse).toEqual([]);
    expect(result.tags.compared).toBe(3);
  });
});

describe("TC-375 AGV y WiFi", () => {
  it("un AGV que deja de omitir mejora, sumando sus celdas por tag", () => {
    const cells = (misses: number): Record<string, readonly [number, number]> => ({ "007": [100, 100 - misses], "012": [100, 98] });
    const before = snapshot(1, RING.map((tagId) => vertex(tagId, 200, 0.9, cells(20))), []);
    const after = snapshot(2, RING.map((tagId) => vertex(tagId, 200, 0.99, cells(1))), []);
    const result = comparePeriods({ before, after, reviews: new Map(), maxChance: MAX_CHANCE });
    expect(result.vehicles.better.map((entry) => entry.id)).toEqual(["007"]);
    expect(result.vehicles.worse).toEqual([]);
  });

  it("un tramo con muchos menos cortes por pasada sale como mejor, con su llegada", () => {
    const wifi = (cuts: number): SnapshotConnections => ({ covered: true, vehicles: 2, segments: [{ from: "0100", to: "0200", passes: 300, cuts }, { from: "0200", to: "0300", passes: 300, cuts: 3 }] });
    const result = comparePeriods({ before: snapshot(1, [], [], wifi(40)), after: snapshot(2, [], [], wifi(2)), reviews: new Map(), maxChance: MAX_CHANCE });
    expect(result.wifi).toMatchObject({ status: "comparado", segments: 2 });
    if (result.wifi.status !== "comparado") throw new Error("sin comparar");
    expect(result.wifi.better.map((entry) => [entry.id, entry.to])).toEqual([["0100", "0200"]]);
  });

  it("sin registro en el periodo nuevo no se compara: no es «sin cambios»", () => {
    const old: SnapshotConnections = { covered: true, vehicles: 2, segments: [] };
    expect(comparePeriods({ before: snapshot(1, [], [], old), after: snapshot(2, [], []), reviews: new Map(), maxChance: MAX_CHANCE }).wifi.status).toBe("sin-datos-nuevos");
    expect(comparePeriods({ before: snapshot(1, [], [], old), after: snapshot(2, [], [], { covered: false, vehicles: 0, segments: [] }), reviews: new Map(), maxChance: MAX_CHANCE }).wifi.status).toBe("sin-datos-nuevos");
    expect(comparePeriods({ before: snapshot(1, [], []), after: snapshot(2, [], [], old), reviews: new Map(), maxChance: MAX_CHANCE }).wifi.status).toBe("sin-referencia");
    expect(comparePeriods({ before: snapshot(1, [], []), after: snapshot(2, [], []), reviews: new Map(), maxChance: MAX_CHANCE }).wifi.status).toBe("sin-registro");
  });

  it("el anterior es el inmediatamente anterior en el tiempo", () => {
    const a = snapshot(1, [], []);
    const b = snapshot(2, [], []);
    expect(previousSnapshot([a, b], b)?.sourceId).toBe("f1");
    expect(previousSnapshot([a, b], a)).toBeNull();
  });
});

describe("TC-375 un tag que sustituye a otro hereda lo declarado", () => {
  const lists = [
    { list: "critico", tags: ["0200"], entries: [{ tagId: "0200", funcion: "parada-precisa", grupo: "", note: "" }] },
    { list: "area", tags: ["0200", "0300"], entries: [{ tagId: "0200", funcion: "", grupo: "montaje llenos 2", note: "" }, { tagId: "0300", funcion: "", grupo: "picking", note: "" }] },
    { list: "zona", tags: ["0200", "0900"], entries: [{ tagId: "0200", funcion: "", grupo: "cargado", note: "" }, { tagId: "0900", funcion: "", grupo: "vacio", note: "" }] },
  ];
  const confirmed = confirmedSubstitutions([
    { locationId: "U-0002", history: [{ tagId: "0200", from: 0, to: 5 * DAY }, { tagId: "0900", from: 5 * DAY, to: null }] },
    { locationId: "U-0003", history: [{ tagId: "0300", from: 0, to: null }] },
  ]);

  it("del plano salen los pares seguidos de cada ubicación", () => {
    expect(confirmed).toEqual([{ oldTagId: "0200", newTagId: "0900", status: "confirmada", at: 5 * DAY, locationId: "U-0002" }]);
  });

  it("la confirmada hereda con su nota; lo que el nuevo ya declara manda; el sustituido conserva lo suyo", () => {
    const { lists: out, roles } = inheritRoles(lists, confirmed);
    const critico = out.find((entry) => entry.list === "critico");
    expect(critico?.tags).toEqual(["0200", "0900"]);
    expect(critico?.entries?.[1]).toEqual({ tagId: "0900", funcion: "parada-precisa", grupo: "", note: "heredado de 0200" });
    expect(out.find((entry) => entry.list === "area")?.entries?.find((entry) => entry.tagId === "0900")?.grupo).toBe("montaje llenos 2");
    // En `zona` el nuevo ya está como vacío: no hereda «cargado».
    expect(out.find((entry) => entry.list === "zona")).toBe(lists[2]);
    expect(roles.map(roleText)).toEqual(["critico: parada-precisa", "area: montaje llenos 2"]);
    expect(lists[0]?.tags).toEqual(["0200"]);
  });

  it("la detectada dice lo que heredaría y no cambia ninguna lista", () => {
    const merged = mergeSubstitutions(confirmed, [{ oldTagId: "0300", newTagId: "0301", at: 3 }, { oldTagId: "0200", newTagId: "0900", at: 1 }]);
    expect(merged.map((entry) => [entry.oldTagId, entry.status])).toEqual([["0200", "confirmada"], ["0300", "detectada"]]);
    const onlyDetected = inheritRoles(lists, merged.filter((entry) => entry.status === "detectada"));
    expect(onlyDetected.lists).toEqual(lists);
    expect(onlyDetected.roles).toEqual([{ oldTagId: "0300", newTagId: "0301", list: "area", funcion: "", grupo: "picking", status: "detectada" }]);
  });

  it("una cadena A→B→C hereda de A en C", () => {
    const chain = confirmedSubstitutions([{ locationId: "U-1", history: [{ tagId: "0200", from: 0, to: 1 }, { tagId: "0901", from: 1, to: 2 }, { tagId: "0902", from: 2, to: null }] }]);
    const critico = inheritRoles([lists[0] as (typeof lists)[number]], chain).lists[0];
    expect(critico?.tags).toEqual(["0200", "0901", "0902"]);
    expect(critico?.entries?.[2]?.note).toBe("heredado de 0901; heredado de 0200");
  });
});

describe("TC-375 lo que se dice en el Resumen", () => {
  const format = (utcMs: number): string => `d${utcMs / DAY}`;

  it("las tasas en porcentaje de lectura o de corte, con sus pasadas", () => {
    const change = { id: "0200", before: { passes: 200, misses: 60 }, after: { passes: 180, misses: 2 }, direction: "mejora" as const, chance: 0 };
    expect(readShift(change)).toBe("70 % → 99 % de lectura (200 → 180 pasadas)");
    expect(cutShift(change)).toBe("30 % → 1 % de pasadas con corte (200 → 180 pasadas)");
  });

  it("el recuento de hallazgos solo nombra «sin ocasión» si hay alguno", () => {
    const entry = (fate: "ya-no-aparece" | "sigue" | "nuevo" | "sin-ocasion") => ({ key: fate, kind: "x", title: "x", fate, figureBefore: null, figureAfter: null, review: null });
    expect(findingsLine([entry("ya-no-aparece"), entry("nuevo"), entry("nuevo")])).toBe("1 ya no aparece · 0 siguen · 2 nuevos");
    expect(findingsLine([entry("sin-ocasion")])).toContain("1 sin ocasión de repetirse");
  });

  it("la sustitución confirmada hereda; la detectada heredaría al confirmarla", () => {
    const roles = [{ oldTagId: "0200", newTagId: "0900", list: "critico", funcion: "parada-precisa", grupo: "", status: "confirmada" as const }];
    expect(substitutionLine({ oldTagId: "0200", newTagId: "0900", status: "confirmada", at: 5 * DAY, locationId: "U-0002" }, roles, format)).toBe(
      "0200 → 0900, confirmada en el plano (U-0002) el d5: hereda critico: parada-precisa.",
    );
    expect(substitutionLine({ oldTagId: "0200", newTagId: "0900", status: "detectada", at: DAY, locationId: null }, roles, format)).toContain("heredaría critico: parada-precisa al confirmarla en el plano");
  });

  it("sin WiFi aportada se dice la última actualización, no «sin cambios»", () => {
    const lines = suppliedLines({ lists: [], fleet: null, connections: { loadedAt: 2 * DAY, until: 3 * DAY } }, format);
    expect(lines.find((line) => line.label === "WiFi")?.text).toBe("Última actualización: d2, con eventos hasta d3.");
  });
});
