/**
 * TC-373: el gestor de análisis (`UX_SPEC.md` §8.1). Lo que se enseña de cada análisis guardado, el
 * nombre de uno nuevo y qué se copia —y qué no— al crearlo a partir de otro.
 */

import { describe, expect, it } from "vitest";

import { analysisNameProblem, missingLists, newAnalysis, sortAnalyses, summarizeAnalysis } from "../../src/persistence/analyses.js";
import type { StoredCircuit } from "../../src/persistence/store.js";
import { analysisDataLines, analysisLine } from "../../src/presentation/analyses-ui.js";

const H = 3_600_000;

/** Un análisis sintético con dos cargas del mismo fichero, dos listas, flota, conexiones y lo que no se copia. */
const base: StoredCircuit = {
  circuitId: "SINT-A",
  name: "SINT-A",
  zone: "Europe/Madrid",
  sources: [
    { sourceId: "s1", sourceHash: "h1", fileName: "v1.csv", importedAt: 10, acceptedRows: 5, complete: { from: 0, to: 2 * H }, retained: true, snapshot: true },
    { sourceId: "s2", sourceHash: "h1", fileName: "v1.csv", importedAt: 20, acceptedRows: 5, complete: { from: 0, to: 2 * H }, retained: true, snapshot: true },
    { sourceId: "s3", sourceHash: "h2", fileName: "v2.csv", importedAt: 30, acceptedRows: 5, complete: { from: 5 * H, to: 6 * H }, retained: true, snapshot: true },
  ],
  coverage: [
    { from: 0, to: 2 * H },
    { from: 5 * H, to: 6 * H },
  ],
  lists: [
    { list: "circuito", tags: ["0100", "0200"], entries: [], extractedAt: null, loadedAt: 1, fileName: "listas.csv" },
    { list: "area", tags: ["0100"], entries: [{ tagId: "0100", order: null, funcion: "", grupo: "montaje", capacidad: null, note: "" }], extractedAt: null, loadedAt: 1, fileName: "listas.csv" },
  ],
  fleet: { circuitName: null, periods: [{ agvId: "007", fromUtcMs: 0, toUtcMs: null, note: "" }], loadedAt: 2, fileNames: ["flota.csv"] },
  connections: { files: [{ agvId: "007", fileName: "007.csv", sourceHash: "c1", loadedAt: 3, events: 2, ips: [] }], events: [] },
  updatedAt: 40,
};

const format = (utcMs: number): string => `t${utcMs / H}`;

describe("TC-373 lo que se enseña de cada análisis", () => {
  it("cuenta ficheros distintos, la cobertura de punta a punta, listas, flota y conexiones", () => {
    const summary = summarizeAnalysis(base);
    expect(summary.files).toBe(2);
    expect(summary.span).toEqual({ from: 0, to: 6 * H });
    expect(summary.lists).toEqual([
      { list: "circuito", tags: 2, copied: false },
      { list: "area", tags: 1, copied: false },
    ]);
    expect(summary.fleet).toEqual({ periods: 1, copied: false });
    expect(summary.connectionVehicles).toBe(1);
    expect(analysisLine(summary, format)).toBe("2 ficheros, de t0 a t6 · 2 listas · flota · conexiones de 1 AGV");
  });

  it("un análisis vacío dice que no tiene lecturas, ni listas, y no inventa cobertura", () => {
    const summary = summarizeAnalysis(newAnalysis({ name: "  SINT-B  ", zone: "Europe/Madrid", now: 50 }));
    expect(summary.circuitId).toBe("SINT-B");
    expect(summary.span).toBeNull();
    expect(summary.fleet).toBeNull();
    expect(summary.connectionVehicles).toBeNull();
    expect(analysisLine(summary, format)).toBe("sin lecturas todavía · sin listas");
    const lines = analysisDataLines(summary, format);
    expect(lines.map((line) => line.label)).toEqual(["Lecturas", "Listas", "Flota", "Conexiones"]);
    expect(lines.every((line) => line.missing)).toBe(true);
  });

  it("dice qué listas conocidas faltan, sin repetir las cargadas", () => {
    const missing = missingLists(summarizeAnalysis(base));
    expect(missing).not.toContain("circuito");
    expect(missing).not.toContain("area");
    expect(missing).toContain("carga-online");
    expect(missing).toContain("critico");
    expect(missing).toContain("zona");
  });

  it("el último tocado va primero", () => {
    const a = summarizeAnalysis(base);
    const b = summarizeAnalysis({ ...base, circuitId: "SINT-C", name: "SINT-C", updatedAt: 99 });
    expect(sortAnalyses([a, b]).map((entry) => entry.circuitId)).toEqual(["SINT-C", "SINT-A"]);
  });
});

describe("TC-373 el nombre de un análisis nuevo", () => {
  it("vacío, repetido o repetido solo en mayúsculas no vale; los ceros y el texto se respetan", () => {
    expect(analysisNameProblem("   ", ["SINT-A"])).toMatch(/Escribe el nombre/);
    expect(analysisNameProblem("SINT-A", ["SINT-A"])).toMatch(/Ya existe «SINT-A»\. Para añadirle lecturas/);
    expect(analysisNameProblem("sint-a", ["SINT-A"])).toMatch(/solo se distingue en mayúsculas/);
    expect(analysisNameProblem("0040", ["40"])).toBeNull();
  });
});

describe("TC-373 crear a partir de otro", () => {
  it("copia las listas y la flota elegidas con su procedencia, y nada del periodo", () => {
    const created = newAnalysis({ name: "SINT-B", zone: "UTC", now: 77, base, copy: { lists: true, fleet: true } });
    expect(created.circuitId).toBe("SINT-B");
    // La zona es la del base: las fechas de la flota se leyeron con ella.
    expect(created.zone).toBe("Europe/Madrid");
    expect(created.sources).toEqual([]);
    expect(created.coverage).toEqual([]);
    expect(created.connections).toBeUndefined();
    expect(created.basedOn).toEqual({ circuitId: "SINT-A", at: 77 });
    expect(created.lists?.map((entry) => [entry.list, entry.tags, entry.copiedFrom])).toEqual([
      ["circuito", ["0100", "0200"], { circuitId: "SINT-A", at: 77 }],
      ["area", ["0100"], { circuitId: "SINT-A", at: 77 }],
    ]);
    expect(created.lists?.[1]?.entries?.[0]?.grupo).toBe("montaje");
    expect(created.fleet?.periods).toEqual(base.fleet?.periods);
    expect(created.fleet?.copiedFrom).toEqual({ circuitId: "SINT-A", at: 77 });
    const lines = analysisDataLines(summarizeAnalysis(created), format);
    expect(lines.find((line) => line.label === "Listas")?.text).toBe("circuito (2 tags, copiada de «SINT-A»), area (1 tag, copiada de «SINT-A»).");
    expect(lines.find((line) => line.label === "Flota")?.text).toBe("1 periodo, copiado de «SINT-A».");
    // El base no se toca.
    expect(base.lists?.[0]?.copiedFrom).toBeUndefined();
  });

  it("sin marcar nada, solo queda constancia de la base", () => {
    const created = newAnalysis({ name: "SINT-B", zone: "UTC", now: 77, base, copy: { lists: false, fleet: false } });
    expect(created.lists).toBeUndefined();
    expect(created.fleet).toBeUndefined();
    expect(created.basedOn).toEqual({ circuitId: "SINT-A", at: 77 });
  });
});
