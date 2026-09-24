/**
 * Cambios de tag dentro de un mismo periodo (R-DAT-019) y la diferencia de cada AGV frente al tag
 * nuevo (R-AGV-016).
 *
 * Lo que se fija: una sustitución a media ventana sale como un solo cambio con sus dos horas; dos
 * tags seguidos sustituidos a la vez salen los dos; un tag que se lee poco no «deja de leerse» por su
 * racha final; un cambio en el borde de la cobertura no sale aquí (es de la comparación entre
 * periodos); una pareja ambigua no se fuerza; y frente al tag nuevo se enseñan los cuatro hechos
 * —nunca, desde una hora, más tarde, poco— sin nombrar causa.
 */

import { describe, expect, it } from "vitest";

import type { Reading } from "../../src/domain/reading.js";
import {
  detectTagChanges,
  type AdoptionThresholds,
  type TagChangeThresholds,
} from "../../src/domain/tag-changes.js";

const THRESHOLDS: TagChangeThresholds = { minSlotPasses: 10, maxChance: 0.001, maxReadsBetween: 2, maxOverlapMs: 3_600_000 };
const ADOPTION: AdoptionThresholds = { minPassesForNever: 4, highRate: 0.8, minAdoptionShare: 0.8 };
const RING = ["A", "B", "C", "D", "E", "F"];
const LAP_MS = 60_000;

let row = 0;
function reading(agvId: string, tagId: string, utcMs: number): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

/**
 * Seis AGV que recorren el anillo a la vez, un segundo uno detrás de otro. `tagAt` decide qué lee
 * cada uno en cada vuelta y posición: el mismo tag, otro, o nada.
 */
function fleet(laps: number, tagAt: (vehicle: number, lap: number, tagId: string) => string | null = (_v, _l, tagId) => tagId): Reading[] {
  const out: Reading[] = [];
  for (let lap = 0; lap < laps; lap += 1) {
    for (let vehicle = 0; vehicle < 6; vehicle += 1) {
      RING.forEach((tagId, index) => {
        const read = tagAt(vehicle, lap, tagId);
        if (read !== null) out.push(reading(`V${vehicle}`, read, lap * LAP_MS + index * 10_000 + vehicle * 1_000));
      });
    }
  }
  return out;
}

const whole = (readings: readonly Reading[]) => [
  {
    from: Math.min(...readings.map((entry) => entry.time.utcMs)),
    to: Math.max(...readings.map((entry) => entry.time.utcMs)),
  },
];

describe("cambios de tag dentro de un periodo", () => {
  it("una sustitución a media ventana es un solo cambio, con las dos horas y la vida de cada tag", () => {
    const readings = fleet(20, (_v, lap, tagId) => (tagId === "C" && lap >= 10 ? "X" : tagId));
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);

    expect(report.changes).toHaveLength(1);
    const change = report.changes[0];
    expect(change?.kind).toBe("cambio");
    if (change?.kind !== "cambio") return;
    expect(change.oldTagId).toBe("C");
    expect(change.newTagId).toBe("X");
    expect(change.oldLastUtcMs).toBeLessThan(10 * LAP_MS);
    expect(change.newFirstUtcMs).toBeGreaterThanOrEqual(10 * LAP_MS);
    expect(report.lives.get("C")).toEqual({ from: null, to: change.oldLastUtcMs });
    expect(report.lives.get("X")).toEqual({ from: change.newFirstUtcMs, to: null });
    // Toda la flota lee el nuevo: no hay diferencias que enseñar.
    expect(report.adoption).toEqual([]);
  });

  it("frente al tag nuevo, cada AGV con su diferencia medida: nunca, desde una hora, más tarde, poco", () => {
    const readings = fleet(24, (vehicle, lap, tagId) => {
      if (tagId !== "C") return tagId;
      if (lap < 10) return "C";
      if (vehicle === 1) return null; // nunca lee el nuevo
      if (vehicle === 2 && lap >= 17) return null; // lo leía y deja de leerlo
      if (vehicle === 3 && lap < 16) return null; // empieza a leerlo más tarde
      if (vehicle === 4 && lap % 2 === 1) return null; // lo lee en la mitad de sus pasadas
      return "X";
    });
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);
    const factOf = (agvId: string) => report.adoption.find((issue) => issue.agvId === agvId)?.fact;

    expect(factOf("V1")).toEqual({ kind: "nunca", passes: 14 });
    expect(factOf("V2")?.kind).toBe("desde");
    expect(factOf("V2")).toMatchObject({ passesSince: 7 });
    expect(factOf("V3")).toMatchObject({ kind: "tarde", passesBefore: 6 });
    expect(factOf("V4")).toEqual({ kind: "poco", hits: 7, passes: 14 });
    expect(factOf("V0")).toBeUndefined();
    expect(factOf("V5")).toBeUndefined();
  });

  it("si la flota todavía no lee el tag nuevo, no se señala a nadie", () => {
    // Solo dos de seis lo leen: no está adoptado, y quien no lo lee no se sale de lo normal.
    const readings = fleet(20, (vehicle, lap, tagId) => {
      if (tagId !== "C") return tagId;
      if (lap < 10) return "C";
      return vehicle < 2 ? "X" : null;
    });
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);
    expect(report.adoption).toEqual([]);
  });

  it("dos tags seguidos sustituidos a la vez salen los dos, con sus vecinos de segundo orden", () => {
    const readings = fleet(20, (_v, lap, tagId) => {
      if (lap < 10) return tagId;
      if (tagId === "C") return "X";
      if (tagId === "D") return "Y";
      return tagId;
    });
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);
    const pairs = report.changes
      .filter((change) => change.kind === "cambio")
      .map((change) => (change.kind === "cambio" ? `${change.oldTagId}→${change.newTagId}` : ""))
      .sort();
    expect(pairs).toEqual(["C→X", "D→Y"]);
  });

  it("un tag que deja de leerse sin sustituto sale solo, con su hora", () => {
    const readings = fleet(20, (_v, lap, tagId) => (tagId === "C" && lap >= 12 ? null : tagId));
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0]).toMatchObject({ kind: "deja", tagId: "C" });
  });

  it("un tag que se lee una de cada cinco veces no «deja de leerse» por su racha final", () => {
    const readings = fleet(30, (vehicle, lap, tagId) => (tagId === "C" && (vehicle + lap) % 5 !== 0 ? null : tagId));
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);
    expect(report.changes).toEqual([]);
  });

  it("un cambio en el borde de la cobertura no sale aquí: es de la comparación entre periodos", () => {
    const readings = fleet(20, (_v, lap, tagId) => (tagId === "C" && lap >= 10 ? "X" : tagId));
    const split = 10 * LAP_MS - 1;
    const coverage = [
      { from: 0, to: split },
      { from: split + 1, to: 20 * LAP_MS },
    ];
    const report = detectTagChanges(readings, "oldest-first", coverage, THRESHOLDS, ADOPTION);
    expect(report.changes).toEqual([]);
  });

  it("dos tags nuevos en el mismo sitio no se emparejan a la fuerza", () => {
    // Desde la vuelta 10, en lugar de C se leen dos tags nuevos seguidos: X y Z.
    const readings: Reading[] = [];
    for (const entry of fleet(20, (_v, lap, tagId) => (tagId === "C" && lap >= 10 ? "X" : tagId))) {
      readings.push(entry);
      if (entry.tagId === "X") readings.push(reading(entry.agvId, "Z", entry.time.utcMs + 500));
    }
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);
    expect(report.changes.some((change) => change.kind === "cambio")).toBe(false);
    expect(report.changes.map((change) => change.kind).sort()).toEqual(["deja", "empieza", "empieza"]);
  });

  it("un tag nuevo que convive mucho tiempo con el viejo no se toma por su sustituto", () => {
    // X empieza en la vuelta 2, entre B y C, y C sigue leyéndose hasta la vuelta 15: una hora y
    // media de solape, por encima del máximo.
    const readings: Reading[] = [];
    for (let lap = 0; lap < 20; lap += 1) {
      for (let vehicle = 0; vehicle < 6; vehicle += 1) {
        RING.forEach((tagId, index) => {
          const at = lap * 10 * LAP_MS + index * 100_000 + vehicle * 1_000;
          if (tagId === "C" && lap >= 2) readings.push(reading(`V${vehicle}`, "X", at - 50_000));
          if (tagId === "C" && lap >= 15) return;
          readings.push(reading(`V${vehicle}`, tagId, at));
        });
      }
    }
    const report = detectTagChanges(readings, "oldest-first", whole(readings), THRESHOLDS, ADOPTION);
    expect(report.changes.some((change) => change.kind === "cambio")).toBe(false);
    // Los dos extremos sí se ven; lo que no se hace es emparejarlos.
    expect(report.changes.map((change) => change.kind).sort()).toEqual(["deja", "empieza"]);
  });
});
