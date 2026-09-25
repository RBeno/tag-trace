/**
 * Agrupamiento por circuito (R-DAT-012).
 *
 * La prueba que importa: un fichero con tres circuitos mezclados —el caso real que invalidó una
 * comparación entera de este proyecto— tiene que separarse en tres grupos sin que se le dé ninguna
 * pista de antemano, **también cuando comparten un tramo** (así venían en dato real, y compartir una
 * arista los juntaba); un vehículo que solo se vio en parte del recorrido, o que se salta tags y hace
 * saltos que nadie más hace, va con los suyos y no abre un circuito propio; y uno que no se parece a
 * nadie no se cuela en un grupo ajeno.
 */

import { describe, expect, it } from "vitest";

import { assignCohorts, type CohortThresholds } from "../../src/domain/cohort.js";
import { buildTransitions } from "../../src/domain/graph.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
const THRESHOLDS: CohortThresholds = { sameCircuitSimilarity: 0.75, minExclusiveEdges: 5, minOwnTags: 5 };
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

function laps(agvId: string, tags: readonly string[], count: number, start: number): Reading[] {
  const out: Reading[] = [];
  let t = start;
  for (let lap = 0; lap < count; lap += 1) {
    for (const tag of tags) out.push(reading((t += 10_000), agvId, tag));
  }
  return out;
}

describe("agrupamiento por circuito", () => {
  it("separa tres circuitos mezclados bajo un mismo fichero, sin pista previa", () => {
    const readings = [
      ...laps("A1", ["0100", "0200", "0300"], 4, 0),
      ...laps("A2", ["0100", "0200", "0300"], 4, 1_000_000),
      ...laps("B1", ["0900", "0910"], 4, 2_000_000),
      ...laps("B2", ["0900", "0910"], 4, 3_000_000),
      ...laps("C1", ["0500", "0510", "0520"], 4, 4_000_000),
    ];
    const { transitions } = buildTransitions(readings, "oldest-first", [{ from: 0, to: 5_000_000 }]);
    const assignment = assignCohorts(readings, transitions, THRESHOLDS);

    expect(assignment.cohorts).toHaveLength(3);
    const groupOf = (agvId: string): readonly string[] =>
      assignment.cohorts[assignment.cohortOf.get(agvId) as number]?.vehicles ?? [];
    expect(groupOf("A1")).toEqual(["A1", "A2"]);
    expect(groupOf("B1")).toEqual(["B1", "B2"]);
    expect(groupOf("C1")).toEqual(["C1"]);
  });

  it("un vehículo con una sola lectura no se fuerza a ningún grupo ajeno", () => {
    const readings = [
      ...laps("A1", ["0100", "0200"], 5, 0),
      ...laps("A2", ["0100", "0200"], 5, 1_000_000),
      reading(9_000_000, "X", "0999"),
    ];
    const { transitions } = buildTransitions(readings, "oldest-first", [{ from: 0, to: 9_000_000 }]);
    const assignment = assignCohorts(readings, transitions, THRESHOLDS);

    expect(assignment.cohorts).toHaveLength(2);
    const solo = assignment.cohorts.find((cohort) => cohort.vehicles.includes("X"));
    expect(solo?.vehicles).toEqual(["X"]);
  });

  it("los cohortes salen ordenados por tamaño, el mayor primero", () => {
    const readings = [
      ...laps("A1", ["0100", "0200"], 4, 0),
      ...laps("A2", ["0100", "0200"], 4, 1_000_000),
      ...laps("A3", ["0100", "0200"], 4, 2_000_000),
      ...laps("B1", ["0900", "0910"], 4, 3_000_000),
    ];
    const { transitions } = buildTransitions(readings, "oldest-first", [{ from: 0, to: 4_000_000 }]);
    const assignment = assignCohorts(readings, transitions, THRESHOLDS);

    expect(assignment.cohorts[0]?.vehicles).toHaveLength(3);
    expect(assignment.cohorts[1]?.vehicles).toHaveLength(1);
  });

  it("tres circuitos que comparten un tramo salen como tres, no como uno", () => {
    const tramo = ["0700", "0701", "0702", "0703"];
    const propio = (prefix: string) => Array.from({ length: 10 }, (_, index) => `${prefix}${index}`);
    const readings = [
      ...laps("A1", [...propio("1"), ...tramo], 4, 0),
      ...laps("A2", [...propio("1"), ...tramo], 4, 1_000_000),
      ...laps("B1", [...propio("2"), ...tramo], 4, 2_000_000),
      ...laps("B2", [...propio("2"), ...tramo], 4, 3_000_000),
      ...laps("C1", [...propio("3"), ...tramo], 4, 4_000_000),
    ];
    const { transitions } = buildTransitions(readings, "oldest-first", [{ from: 0, to: 5_000_000 }]);
    // Todos recorren 0700→0701→0702→0703: compartir una arista no los hace del mismo circuito.
    const assignment = assignCohorts(readings, transitions, THRESHOLDS);

    expect(assignment.cohorts.map((cohort) => cohort.vehicles)).toEqual([["A1", "A2"], ["B1", "B2"], ["C1"]]);
  });

  it("un vehículo visto solo en parte del recorrido va con los suyos, no abre un circuito", () => {
    const anillo = Array.from({ length: 12 }, (_, index) => `05${String(index).padStart(2, "0")}`);
    const otro = Array.from({ length: 12 }, (_, index) => `09${String(index).padStart(2, "0")}`);
    const readings = [
      ...laps("A1", anillo, 4, 0),
      ...laps("A2", anillo, 4, 1_000_000),
      ...laps("B1", otro, 4, 2_000_000),
      // Media vuelta: se parece poco a A1 por Jaccard, pero todos sus tags son de ese circuito.
      ...laps("P", anillo.slice(0, 5), 1, 3_000_000),
    ];
    const { transitions } = buildTransitions(readings, "oldest-first", [{ from: 0, to: 4_000_000 }]);
    const assignment = assignCohorts(readings, transitions, THRESHOLDS);

    expect(assignment.cohorts.map((cohort) => cohort.vehicles)).toEqual([["A1", "A2", "P"], ["B1"]]);
  });

  it("un vehículo que se salta tags no es otro circuito aunque haga saltos que nadie más hace", () => {
    const anillo = Array.from({ length: 12 }, (_, index) => `05${String(index).padStart(2, "0")}`);
    const readings = [
      ...laps("A1", anillo, 4, 0),
      ...laps("A2", anillo, 4, 1_000_000),
      // Lee uno de cada dos: sus seis saltos (0500→0502…) no los hace nadie más, pero ni un tag suyo.
      ...laps("S", anillo.filter((_, index) => index % 2 === 0), 4, 2_000_000),
    ];
    const { transitions } = buildTransitions(readings, "oldest-first", [{ from: 0, to: 3_000_000 }]);
    const assignment = assignCohorts(readings, transitions, THRESHOLDS);

    expect(assignment.cohorts.map((cohort) => cohort.vehicles)).toEqual([["A1", "A2", "S"]]);
  });
});
