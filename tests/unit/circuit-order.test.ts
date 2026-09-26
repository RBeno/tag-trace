/**
 * El orden del circuito según las lecturas (`src/domain/circuit-order.ts`, R-GRA-015).
 *
 * Lo que se fija: manda lo leído. Dos vecinos cambiados en la lista y uno movido lejos salen donde los
 * leen los AGV, marcados como corrección de la lista; un declarado sin lecturas va donde lo pone la
 * lista y se dice que es solo eso; lo leído fuera del anillo va detrás de su predecesor leído; un
 * número mal escrito queda junto al tag que sí se lee en su sitio; y sin lista no se evalúa.
 */

import { describe, expect, it } from "vitest";

import { reconcileCircuitOrder } from "../../src/domain/circuit-order.js";

const order = (list: readonly string[], ring: readonly string[], place = new Map<string, { predecessor: string | null; successor: string | null }>()) =>
  reconcileCircuitOrder(list, ring, new Set([...ring, ...place.keys()]), place);

describe("el orden del circuito según las lecturas", () => {
  it("dos vecinos cambiados en la lista salen en el orden leído, uno como corrección de la lista", () => {
    const result = order(["A", "B", "C", "D", "E"], ["A", "B", "D", "C", "E"]);
    expect(result.rows.map((row) => row.tagId)).toEqual(["A", "B", "D", "C", "E"]);
    expect(result.rows.filter((row) => row.change === "otro-sitio")).toHaveLength(1);
    expect(result.summary.igual).toBe(4);
  });

  it("uno movido lejos en la lista sale donde se lee, con su sitio en cada lado", () => {
    const result = order(["A", "B", "C", "D", "E", "F", "G", "H"], ["A", "G", "B", "C", "D", "E", "F", "H"]);
    expect(result.rows.map((row) => row.tagId)).toEqual(["A", "G", "B", "C", "D", "E", "F", "H"]);
    const g = result.rows.find((row) => row.tagId === "G");
    expect(g).toMatchObject({ change: "otro-sitio", position: 2, listPosition: 7, readBetween: "entre A y B", listBetween: "entre F y H" });
  });

  it("un declarado sin lecturas va donde lo pone la lista, y solo tiene esa posición", () => {
    const result = order(["X", "A", "B", "Y", "C", "D"], ["B", "C", "D", "A"]);
    expect(result.rows.map((row) => row.tagId)).toEqual(["X", "A", "B", "Y", "C", "D"]);
    const y = result.rows.find((row) => row.tagId === "Y");
    expect(y).toMatchObject({ reading: "sin-lecturas", change: "sin-lecturas", readBetween: null, listBetween: "entre B y C" });
    expect(result.summary["sin-lecturas"]).toBe(2);
  });

  it("lo leído fuera del anillo va detrás de su predecesor leído, esté o no en la lista", () => {
    const place = new Map([
      ["N", { predecessor: "B", successor: "C" }],
      ["R", { predecessor: "N", successor: "C" }],
      ["S", { predecessor: "Q", successor: null }],
    ]);
    const result = order(["A", "B", "C", "R"], ["A", "B", "C"], place);
    expect(result.rows.map((row) => row.tagId)).toEqual(["A", "B", "N", "R", "C", "S"]);
    expect(result.rows.find((row) => row.tagId === "N")).toMatchObject({ reading: "fuera-del-recorrido", change: "no-en-la-lista" });
    expect(result.rows.find((row) => row.tagId === "R")).toMatchObject({ change: "fuera-del-recorrido", readBetween: "entre N y C" });
    expect(result.rows.find((row) => row.tagId === "S")?.readBetween).toBe("sin un sitio fijo");
  });

  it("un número mal escrito en la lista queda junto al tag que se lee en su sitio", () => {
    const result = order(["A", "B", "Y", "C"], ["A", "B", "Z", "C"]);
    const ids = result.rows.map((row) => row.tagId);
    expect(Math.abs(ids.indexOf("Y") - ids.indexOf("Z"))).toBe(1);
    expect(result.rows.find((row) => row.tagId === "Z")?.change).toBe("no-en-la-lista");
    expect(result.rows.find((row) => row.tagId === "Y")?.change).toBe("sin-lecturas");
  });

  it("sin lista del circuito no se evalúa", () => {
    const result = order([], ["A", "B"]);
    expect(result.evaluated).toBe(false);
    expect(result.reason).not.toBeNull();
    expect(result.rows).toEqual([]);
  });
});

describe("la rotación del anillo no acusa a los vecinos del tag mal colocado", () => {
  it("si el primer tag de la lista es el mal colocado, solo él sale en otro sitio", () => {
    // Antes se rotaba al primer tag de la lista que apareciera en el anillo; si era justo el mal colocado,
    // la subsecuencia común perdía media vuelta y A, B y C salían como «otro sitio» siendo sanos.
    const result = order(["G", "A", "B", "C", "D", "E", "F"], ["A", "B", "C", "G", "D", "E", "F"]);
    expect(result.rows.filter((row) => row.change === "otro-sitio").map((row) => row.tagId)).toEqual(["G"]);
    expect(result.summary.igual).toBe(6);
    expect(result.rows.find((row) => row.tagId === "G")).toMatchObject({ readBetween: "entre C y D", listBetween: "antes de A" });
  });
});
