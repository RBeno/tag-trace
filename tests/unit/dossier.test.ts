/**
 * Expediente reducido de AGV y de tag (UX_SPEC §4.1).
 *
 * Lo que hay que defender: la comparación es contra la cohorte, nunca la flota entera; sin `minGapMs`
 * no hay inactividad que contar (no hay valor por defecto); y un silencio abierto hasta el final de
 * la cobertura se distingue de uno que ya cerró.
 */

import { describe, expect, it } from "vitest";

import { buildAgvDossier, buildAllAgvDossiers, buildAllTagDossiers, buildTagDossier } from "../../src/domain/dossier.js";
import type { Cohort } from "../../src/domain/cohort.js";
import type { Lap } from "../../src/domain/laps.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
let row = 0;

function reading(utcMs: number, agvId: string, tagId: string): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

const COHORTS: readonly Cohort[] = [{ id: 0, vehicles: ["A", "B", "C"] }];
const cohortOf = new Map([
  ["A", 0],
  ["B", 0],
  ["C", 0],
]);
const LOOKUP = { cohorts: COHORTS, cohortOf };

describe("expediente de AGV", () => {
  it("compara el recuento contra la mediana del cohorte, no contra la flota", () => {
    const readings = [
      ...Array.from({ length: 10 }, (_, index) => reading(index * 1000, "A", "0100")),
      ...Array.from({ length: 20 }, (_, index) => reading(index * 1000, "B", "0100")),
      ...Array.from({ length: 30 }, (_, index) => reading(index * 1000, "C", "0100")),
    ];
    const dossier = buildAgvDossier("A", readings, LOOKUP, [], 100_000, 10_000);

    expect(dossier.readingCount).toBe(10);
    expect(dossier.cohortMedianReadings).toBe(25); // mediana de B(20) y C(30)
    expect(dossier.cohortSize).toBe(3);
  });

  it("cuenta la inactividad solo por encima del umbral que se le pasa", () => {
    const readings = [
      reading(0, "A", "0100"),
      reading(5_000, "A", "0200"), // hueco de 5 s, por debajo del umbral
      reading(65_000, "A", "0300"), // hueco de 60 s, por encima
    ];
    const dossier = buildAgvDossier("A", readings, LOOKUP, [], 65_000, 30_000);

    expect(dossier.inactivity).toHaveLength(1);
    expect(dossier.inactivity[0]?.durationMs).toBe(60_000);
  });

  it("un silencio que llega hasta el final de la cobertura queda abierto, y se distingue del que ya cerró", () => {
    const cerrado = [reading(0, "A", "0100"), reading(65_000, "A", "0200"), reading(66_000, "A", "0300")];
    const abierto = buildAgvDossier("A", cerrado.slice(0, 2), LOOKUP, [], 200_000, 30_000);
    const cerradoDossier = buildAgvDossier("A", cerrado, LOOKUP, [], 66_000, 30_000);

    expect(abierto.openSilenceSinceUtcMs).toBe(65_000);
    // Con una lectura justo después, el mismo hueco ya no está abierto: el silencio terminó.
    expect(cerradoDossier.openSilenceSinceUtcMs).toBeNull();
  });

  it("las vueltas se cuentan por clase y solo las del vehículo consultado", () => {
    const laps: Lap[] = [
      { agvId: "A", completeness: "completa", startUtcMs: 0, endUtcMs: 1, stops: 4, truth: "inferred" },
      { agvId: "A", completeness: "parcial", startUtcMs: 1, endUtcMs: 2, stops: 2, truth: "inferred" },
      { agvId: "B", completeness: "completa", startUtcMs: 0, endUtcMs: 1, stops: 4, truth: "inferred" },
    ];
    const dossier = buildAgvDossier("A", [reading(0, "A", "0100")], LOOKUP, laps, 100, 10);

    expect(dossier.laps).toEqual({ completas: 1, parciales: 1, desconocidas: 0 });
  });
});

describe("expediente de tag", () => {
  it("dice desde cuándo cada vehículo dejó de leerlo, y quién nunca lo ha leído", () => {
    const readings = [
      reading(1000, "A", "0500"),
      reading(5000, "A", "0500"),
      reading(2000, "B", "0500"),
    ];
    const dossier = buildTagDossier("0500", readings, ["A", "B", "C"]);

    expect(dossier.totalReadings).toBe(3);
    expect(dossier.readers.find((r) => r.agvId === "A")?.lastReadUtcMs).toBe(5000);
    expect(dossier.readers.find((r) => r.agvId === "B")?.lastReadUtcMs).toBe(2000);
    expect(dossier.readers.find((r) => r.agvId === "C")?.lastReadUtcMs).toBeNull();
  });
});

describe("expedientes en lote", () => {
  it("buildAllAgvDossiers da el mismo resultado que llamar uno a uno", () => {
    const readings = [
      ...Array.from({ length: 5 }, (_, index) => reading(index * 1000, "A", "0100")),
      ...Array.from({ length: 8 }, (_, index) => reading(index * 1000, "B", "0100")),
    ];
    const uno = buildAgvDossier("A", readings, LOOKUP, [], 100_000, 10_000);
    const lote = buildAllAgvDossiers(readings, LOOKUP, [], 100_000, 10_000);

    expect(lote.find((d) => d.agvId === "A")).toEqual(uno);
    expect(lote).toHaveLength(2);
  });

  it("buildAllTagDossiers da el mismo resultado que llamar uno a uno", () => {
    const readings = [reading(1000, "A", "0500"), reading(2000, "B", "0500"), reading(3000, "A", "0600")];
    const uno = buildTagDossier("0500", readings, ["A", "B"]);
    const lote = buildAllTagDossiers(readings, ["A", "B"]);

    expect(lote.find((d) => d.tagId === "0500")).toEqual(uno);
    expect(lote.map((d) => d.tagId)).toEqual(["0500", "0600"]);
  });
});
