/**
 * Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013).
 *
 * Lo que importa comprobar: sin dos periodos separados lo bastante, no se evalúa nada; un tag
 * declarado y nunca leído solo se consolida como tal si se sabe que existe (`knownTags`); y la
 * deriva de un vehículo nunca repite un tag que ya murió para toda la flota.
 */

import { describe, expect, it } from "vitest";

import { compareDistantPeriods, type DriftThresholds } from "../../src/domain/drift.js";
import type { Reading } from "../../src/domain/reading.js";

const THRESHOLDS: DriftThresholds = { minGapMs: 1000, minReadingsPerVehicle: 3 };

let row = 0;
function reading(utcMs: number, agvId: string, tagId: string): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

describe("evaluación de la comparación", () => {
  it("con un solo periodo cubierto, no se evalúa", () => {
    const result = compareDistantPeriods([], [{ from: 0, to: 1000 }], new Set(), THRESHOLDS);
    expect(result.evaluated).toBe(false);
    expect(result.reason).toContain("un periodo");
  });

  it("con un hueco menor que minGapMs, no se evalúa", () => {
    const coverage = [
      { from: 0, to: 1000 },
      { from: 1500, to: 2000 }, // hueco de 500 ms, por debajo de minGapMs = 1000
    ];
    const result = compareDistantPeriods([], coverage, new Set(), THRESHOLDS);
    expect(result.evaluated).toBe(false);
    expect(result.reason).toContain("pequeño");
  });

  it("con el hueco suficiente, se evalúa y expone los dos periodos", () => {
    const coverage = [
      { from: 0, to: 1000 },
      { from: 5000, to: 6000 },
    ];
    const result = compareDistantPeriods([], coverage, new Set(), THRESHOLDS);
    expect(result.evaluated).toBe(true);
    expect(result.earlyPeriod).toEqual({ from: 0, to: 1000 });
    expect(result.latePeriod).toEqual({ from: 5000, to: 6000 });
  });
});

describe("deriva de tags", () => {
  const coverage = [
    { from: 0, to: 1000 },
    { from: 5000, to: 6000 },
  ];

  it("leído en el periodo temprano y no en el tardío sale desaparecido", () => {
    const readings = [reading(100, "A1", "T1"), reading(200, "A2", "T1"), reading(300, "A1", "T1")];
    const result = compareDistantPeriods(readings, coverage, new Set(["T1"]), THRESHOLDS);
    const entry = result.tagDrifts.find((d) => d.tagId === "T1");
    expect(entry?.kind).toBe("desaparecido");
    expect(entry?.kind === "desaparecido" && entry.readingsBefore).toBe(3);
  });

  it("sin lecturas en el temprano y con lecturas en el tardío sale nuevo", () => {
    const readings = [reading(5100, "A1", "T2"), reading(5200, "A2", "T2")];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    const entry = result.tagDrifts.find((d) => d.tagId === "T2");
    expect(entry?.kind).toBe("nuevo");
    expect(entry?.kind === "nuevo" && entry.readingsAfter).toBe(2);
  });

  it("declarado y sin ninguna lectura en los dos periodos sale obsoleto-consolidado", () => {
    const result = compareDistantPeriods([], coverage, new Set(["T3"]), THRESHOLDS);
    const entry = result.tagDrifts.find((d) => d.tagId === "T3");
    expect(entry?.kind).toBe("obsoleto-consolidado");
  });

  it("sin declarar y sin ninguna lectura en los dos periodos, no aparece: no hay cómo saber que existe", () => {
    const result = compareDistantPeriods([], coverage, new Set(), THRESHOLDS);
    expect(result.tagDrifts.find((d) => d.tagId === "T4")).toBeUndefined();
  });

  it("leído en los dos periodos no produce ningún hallazgo", () => {
    const readings = [reading(100, "A1", "T5"), reading(5100, "A1", "T5")];
    const result = compareDistantPeriods(readings, coverage, new Set(["T5"]), THRESHOLDS);
    expect(result.tagDrifts.find((d) => d.tagId === "T5")).toBeUndefined();
  });
});

describe("deriva de vehículos", () => {
  const coverage = [
    { from: 0, to: 1000 },
    { from: 5000, to: 6000 },
  ];

  /** Tres lecturas por vehículo y periodo: alcanza `minReadingsPerVehicle` sin sobrar. */
  function witness(agvId: string, tagIds: readonly string[], baseUtcMs: number): Reading[] {
    const out: Reading[] = [];
    let t = baseUtcMs;
    for (let i = 0; i < 3; i += 1) {
      for (const tagId of tagIds) out.push(reading((t += 1), agvId, tagId));
    }
    return out;
  }

  it("un vehículo que deja de leer un tag que el resto sigue leyendo sale con esa deriva", () => {
    const readings = [
      ...witness("A1", ["TF", "TG"], 100),
      ...witness("A2", ["TF", "TG"], 100),
      ...witness("A1", ["TF"], 5100), // A1 deja TG en el periodo tardío
      ...witness("A2", ["TF", "TG"], 5100), // A2 lo sigue leyendo: TG sigue vivo para la flota
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    const a1 = result.vehicleDrifts.find((entry) => entry.agvId === "A1");
    expect(a1?.droppedTags).toEqual(["TG"]);
    // A2 no dejó de leer nada.
    expect(result.vehicleDrifts.find((entry) => entry.agvId === "A2")).toBeUndefined();
  });

  it("un tag que muere para toda la flota sale como desaparecido y no se repite por vehículo", () => {
    const readings = [...witness("A1", ["TH"], 100), ...witness("A2", ["TH"], 100)];
    // Nadie lee TH en el periodo tardío: muere circuito-wide.
    const result = compareDistantPeriods(readings, coverage, new Set(["TH"]), THRESHOLDS);
    expect(result.tagDrifts.find((entry) => entry.tagId === "TH")?.kind).toBe("desaparecido");
    for (const entry of result.vehicleDrifts) {
      expect(entry.droppedTags).not.toContain("TH");
    }
  });

  it("un vehículo sin lecturas suficientes en algún periodo no se evalúa para deriva", () => {
    const readings = [
      ...witness("A1", ["TI"], 100),
      reading(5100, "A1", "TI"), // una sola lectura en el periodo tardío: no alcanza el mínimo (3)
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    expect(result.vehicleDrifts.find((entry) => entry.agvId === "A1")).toBeUndefined();
  });
});
