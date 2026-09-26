/**
 * Limpieza de la lista del circuito (`src/domain/list-cleanup.ts`, R-GRA-017).
 *
 * Lo que se fija: un declarado sin lecturas sale como «no está en el físico», los críticos primero y
 * con la acción de colocar una copia o eliminarlo de Vsystem; uno en otro sitio sale con sus dos
 * posiciones; y un refuerzo declarado se comprueba contra el recorrido: comprobado si sus tags se leen
 * seguidos (lo declarado sin lecturas intercalado no los separa), incompleto si falta uno, separado si
 * se leen lejos.
 */

import { describe, expect, it } from "vitest";

import type { CircuitOrder, CircuitOrderRow, OrderChange } from "../../src/domain/circuit-order.js";
import { buildListCleanup, listCleanupCsv } from "../../src/domain/list-cleanup.js";

function order(rows: readonly [string, OrderChange, number | null][]): CircuitOrder {
  const built: CircuitOrderRow[] = rows.map(([tagId, change, listPosition], index) => ({
    position: index + 1,
    tagId,
    reading: change === "sin-lecturas" ? "sin-lecturas" : change === "fuera-del-recorrido" ? "fuera-del-recorrido" : "leido",
    listPosition,
    change,
    readBetween: change === "sin-lecturas" ? null : "A y B",
    listBetween: listPosition === null ? null : "C y D",
  }));
  return { evaluated: true, reason: null, rows: built, summary: { igual: 0, "otro-sitio": 0, "no-en-la-lista": 0, "fuera-del-recorrido": 0, "sin-lecturas": 0 } };
}

describe("limpieza de la lista del circuito", () => {
  const circuit = order([
    ["1", "igual", 1],
    ["2", "igual", 2],
    ["X", "sin-lecturas", 3],
    ["3", "igual", 4],
    ["4", "otro-sitio", 6],
    ["5", "igual", 5],
    ["Y", "sin-lecturas", 7],
    ["6", "igual", 8],
  ]);
  const funcion = new Map([
    ["2", "parada-precisa"],
    ["3", "parada-precisa"],
    ["6", "giro"],
    ["Y", "giro"],
    ["1", "parada"],
    ["5", "parada"],
  ]);
  const groups = [
    { funcion: "parada-precisa", tags: ["2", "3"] },
    { funcion: "giro", tags: ["Y", "6"] },
    { funcion: "parada", tags: ["5", "1"] },
  ];
  const cleanup = buildListCleanup(circuit, funcion, groups);

  it("los declarados sin lecturas, críticos primero y con su acción", () => {
    expect(cleanup.notPhysical.map((tag) => tag.tagId)).toEqual(["Y", "X"]);
    expect(cleanup.notPhysical[0]?.readPartners).toEqual(["6"]);
    expect(cleanup.notPhysical[0]?.action).toContain("su refuerzo 6 sostiene la función");
    expect(cleanup.notPhysical[1]?.action).toBe("Comprobar si está en el suelo: si no está, eliminarlo de Vsystem");
  });

  it("los que están en otra posición, con las dos", () => {
    expect(cleanup.moved).toEqual([
      { tagId: "4", listPosition: 6, position: 5, listBetween: "C y D", readBetween: "A y B", funcion: null },
    ]);
  });

  it("un refuerzo se comprueba contra el recorrido", () => {
    const status = Object.fromEntries(cleanup.reinforcements.map((group) => [group.tags.join("+"), group.status]));
    // 2 y 3 seguidos en el anillo aunque la lista ponga X en medio, que nadie lee.
    expect(status["2+3"]).toBe("comprobado");
    expect(status["Y+6"]).toBe("incompleto");
    // 5 y 1 se leen, pero no seguidos: el anillo es 1, 2, 3, 4, 5, 6 y 5 no toca a 1.
    expect(status["5+1"]).toBe("separado");
  });

  it("el anillo se cierra: el último y el primero son seguidos", () => {
    const ring = order([["1", "igual", 1], ["2", "igual", 2], ["3", "igual", 3]]);
    const [check] = buildListCleanup(ring, new Map(), [{ funcion: "giro", tags: ["3", "1"] }]).reinforcements;
    expect(check?.status).toBe("comprobado");
  });

  it("con el vecino leído, un refuerzo fuera del anillo pero leído justo antes que su pareja está comprobado", () => {
    // 5 y 1 no son seguidos en el anillo, pero los AGV leen 1 justo detrás de 5.
    const placeOf = new Map([
      ["5", { predecessor: "4", successor: "1" }],
      ["1", { predecessor: "5", successor: "2" }],
      ["2", { predecessor: "1", successor: "3" }],
      ["3", { predecessor: "2", successor: "4" }],
      ["6", { predecessor: "5", successor: "1" }],
    ]);
    const status = Object.fromEntries(
      buildListCleanup(circuit, funcion, groups, placeOf).reinforcements.map((group) => [group.tags.join("+"), group.status]),
    );
    expect(status).toEqual({ "2+3": "comprobado", "Y+6": "incompleto", "5+1": "comprobado" });
    const lejos = buildListCleanup(circuit, funcion, [{ funcion: "parada-precisa", tags: ["2", "5"] }], placeOf);
    expect(lejos.reinforcements[0]?.status).toBe("separado");
  });

  it("en CSV, una fila por tag o refuerzo", () => {
    const csv = listCleanupCsv(cleanup).split("\r\n");
    expect(csv[0]).toBe("apartado;tag;funcion;posicion_lista;posicion_lecturas;segun_la_lista;segun_las_lecturas;estado;accion");
    expect(csv).toHaveLength(1 + 2 + 1 + 3);
    expect(csv.some((line) => line.startsWith("refuerzo;2 + 3;parada-precisa;"))).toBe(true);
  });
});

describe("un refuerzo al que le falta el vecino leído de algún tag", () => {
  it("no sale separado por eso: se cae al criterio del anillo", () => {
    const ring = order([["1", "igual", 1], ["2", "igual", 2], ["3", "igual", 3], ["4", "igual", 4]]);
    // 2 se lee (está en el anillo) pero no tiene vecino leído en el cohorte con que se midió el sitio.
    const placeOf = new Map([["3", { predecessor: "2", successor: "4" }]]);
    const [check] = buildListCleanup(ring, new Map(), [{ funcion: "giro", tags: ["2", "3"] }], placeOf).reinforcements;
    expect(check?.status).toBe("comprobado");
    const [lejos] = buildListCleanup(ring, new Map(), [{ funcion: "giro", tags: ["1", "3"] }], placeOf).reinforcements;
    expect(lejos?.status).toBe("separado");
  });
});
