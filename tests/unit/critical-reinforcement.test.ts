/**
 * Refuerzos de un punto crítico (`src/domain/critical-reinforcement.ts`, R-GRA-016).
 *
 * Lo que se fija: dos o más tags seguidos en el circuito declarado con la misma función son un
 * refuerzo; con funciones distintas, o separados por otro tag, no; un cruce seguido es una zona y no
 * un refuerzo; y el anillo se cierra: el último y el primero también son seguidos.
 */

import { describe, expect, it } from "vitest";

import { reinforcementGroups, reinforcementPartners } from "../../src/domain/critical-reinforcement.js";

const fn = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("refuerzos de un punto crítico", () => {
  it("dos seguidos con la misma función son un refuerzo; separados o con otra función, no", () => {
    const groups = reinforcementGroups(
      ["1", "2", "3", "4", "5", "6", "7", "8"],
      fn({ "2": "parada-precisa", "3": "parada-precisa", "5": "giro", "7": "giro", "8": "parada" }),
    );
    expect(groups).toEqual([{ funcion: "parada-precisa", tags: ["2", "3"] }]);
  });

  it("tres seguidos son un solo refuerzo, y cada uno tiene a los otros dos", () => {
    const groups = reinforcementGroups(["1", "2", "3", "4"], fn({ "1": "giro", "2": "giro", "3": "giro" }));
    expect(groups).toEqual([{ funcion: "giro", tags: ["1", "2", "3"] }]);
    expect(reinforcementPartners(groups).get("2")).toEqual(["1", "3"]);
  });

  it("una parada precisa seguida de una parada no es la misma función", () => {
    expect(reinforcementGroups(["1", "2", "3"], fn({ "1": "parada-precisa", "2": "parada" }))).toEqual([]);
  });

  it("un cruce o un tramo conflictivo seguidos son una zona, no un refuerzo", () => {
    expect(reinforcementGroups(["1", "2", "3"], fn({ "1": "cruce", "2": "cruce", "3": "cruce" }))).toEqual([]);
    const tramo = fn({ "1": "tramo-conflictivo", "2": "tramo-conflictivo", "3": "tramo-conflictivo" });
    expect(reinforcementGroups(["1", "2", "3"], tramo)).toEqual([]);
  });

  it("el anillo se cierra: el último y el primero con la misma función son un refuerzo", () => {
    expect(reinforcementGroups(["1", "2", "3", "4"], fn({ "1": "giro", "4": "giro" }))).toEqual([
      { funcion: "giro", tags: ["4", "1"] },
    ]);
  });

  it("la misma función con distinto grupo no es un refuerzo: un cambio de MTC a cada calle", () => {
    const funcion = fn({ "1": "cambio-de-mtc", "2": "cambio-de-mtc", "3": "cambio-de-mtc", "4": "cambio-de-mtc" });
    const grupo = fn({ "1": "C.O.1", "2": "C.O.2", "3": "C.O.3", "4": "C.O.3" });
    expect(reinforcementGroups(["1", "2", "3", "4", "5"], funcion, grupo)).toEqual([
      { funcion: "cambio-de-mtc", tags: ["3", "4"] },
    ]);
  });

  it("un tag repetido en la lista no se refuerza consigo mismo", () => {
    expect(reinforcementGroups(["1", "1", "2"], fn({ "1": "giro" }))).toEqual([]);
  });
});
