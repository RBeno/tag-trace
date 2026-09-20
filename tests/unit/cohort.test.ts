/**
 * Agrupamiento por circuito (R-DAT-012).
 *
 * La prueba que importa: un fichero con tres circuitos mezclados —el caso real que invalidó una
 * comparación entera de este proyecto— tiene que separarse en tres grupos sin que se le dé ninguna
 * pista de antemano, y un vehículo sin transición compartida con nadie no puede colarse en un grupo
 * ajeno.
 */

import { describe, expect, it } from "vitest";

import { assignCohorts } from "../../src/domain/cohort.js";
import { buildTransitions } from "../../src/domain/graph.js";
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
    const assignment = assignCohorts(readings, transitions);

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
    const assignment = assignCohorts(readings, transitions);

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
    const assignment = assignCohorts(readings, transitions);

    expect(assignment.cohorts[0]?.vehicles).toHaveLength(3);
    expect(assignment.cohorts[1]?.vehicles).toHaveLength(1);
  });
});
