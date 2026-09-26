/**
 * Lo declarado en planta de cada tag (`src/domain/tag-info.ts`).
 *
 * Lo que se fija: se junta todo lo que las listas dicen de un tag —la nota tal cual, la función y la
 * calle— sin repetir, pieza a pieza, y un tag del que nadie dice nada no aparece. Es información: nada de esto
 * cambia ningún cálculo, así que la prueba solo mira el texto.
 */

import { describe, expect, it } from "vitest";

import { declaredTagInfo } from "../../src/domain/tag-info.js";

const entry = (tagId: string, funcion = "", grupo = "", note = "") => ({ tagId, funcion, grupo, note });

describe("lo declarado en planta de cada tag", () => {
  it("junta la nota, la función y la calle, sin repetir", () => {
    const info = declaredTagInfo([
      { list: "circuito", entries: [entry("100", "", "", "GIRO DERECHA · LLENO"), entry("101", "", "", "")] },
      { list: "critico", entries: [entry("200", "parada-precisa", "", "PARADA CONDICIONADA PRECISA · LLENO · PICKING")] },
      { list: "circuito", entries: [entry("200", "", "", "PARADA CONDICIONADA PRECISA · LLENO · PICKING")] },
      { list: "carga-online", entries: [entry("300", "parada-precisa", "calle-1"), entry("301", "", "calle-1")] },
      { list: "circuito", entries: [entry("400", "", "", "PARADA · SIN CARRO")] },
      { list: "zona", entries: [entry("400", "", "vacio", "SIN CARRO")] },
    ]);
    expect(info.get("100")).toBe("GIRO DERECHA · LLENO");
    expect(info.get("200")).toBe("PARADA CONDICIONADA PRECISA · LLENO · PICKING · parada-precisa");
    expect(info.get("300")).toBe("calle-1 (parada-precisa)");
    expect(info.get("301")).toBe("calle-1");
    expect(info.has("101")).toBe(false);
    // La misma pieza en la nota del circuito y en la de la zona sale una vez.
    expect(info.get("400")).toBe("PARADA · SIN CARRO");
  });

  it("una lista guardada sin detalle por tag no aporta nada", () => {
    expect(declaredTagInfo([{ list: "circuito" }]).size).toBe(0);
  });
});
