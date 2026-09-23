/**
 * Revisión en campo (R-EVI-007): clave estable, recuento, marcas huérfanas y CSV.
 *
 * Lo que se fija: la clave no depende del texto de la tarjeta, así que sobrevive a un reanálisis;
 * un cambio de cifra desde que se marcó se detecta; una marca cuyo hallazgo ya no aparece no se
 * pierde; y el CSV lleva también los pendientes, que son la lista de lo que falta.
 */

import { describe, expect, it } from "vitest";

import {
  changedSinceReview,
  reviewCsv,
  reviewKey,
  summarizeReview,
  type ReviewEntry,
} from "../../src/domain/review.js";

function entry(key: string, state: ReviewEntry["state"], figure = "80 %", note = ""): ReviewEntry {
  return { key, state, note, updatedAt: 0, title: `Hallazgo ${key}`, figure };
}

describe("revisión en campo", () => {
  it("la clave es el tipo y el sujeto, no el texto de la tarjeta", () => {
    expect(reviewKey(["tag-rotura", "60300"])).toBe("tag-rotura|60300");
    expect(reviewKey(["calle-espera", "calle-1", "7112"])).toBe("calle-espera|calle-1|7112");
  });

  it("detecta que la cifra cambió desde que se marcó", () => {
    const marked = entry("tag-lectura|1", "confirmado", "40 % de las pasadas");
    expect(changedSinceReview(marked, "40 % de las pasadas")).toBe(false);
    expect(changedSinceReview(marked, "55 % de las pasadas")).toBe(true);
  });

  it("cuenta por estado los hallazgos visibles y aparte las marcas que ya no tienen tarjeta", () => {
    const entries = new Map([
      ["a", entry("a", "confirmado")],
      ["b", entry("b", "descartado")],
      ["c", entry("c", "pospuesto")],
      ["viejo", entry("viejo", "confirmado")],
    ]);
    const summary = summarizeReview(["a", "b", "c", "d", "e"], entries);
    expect(summary).toEqual({ total: 5, pendiente: 2, confirmado: 1, descartado: 1, pospuesto: 1, absent: 1 });
  });

  it("el CSV lleva los pendientes, las marcas huérfanas y escapa el separador", () => {
    const entries = new Map([
      ["a", entry("a", "confirmado", "40 %", "visto en campo; tag suelto")],
      ["viejo", entry("viejo", "pospuesto", "12 min")],
    ]);
    const csv = reviewCsv(
      [
        { key: "a", title: "Tag 1", figure: "40 %" },
        { key: "b", title: "Tag 2", figure: "60 %" },
      ],
      entries,
      () => "hoy",
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("estado;hallazgo;dato actual;dato al marcar;nota;marcado;aparece;clave");
    expect(lines[1]).toBe('Confirmado;Tag 1;40 %;40 %;"visto en campo; tag suelto";hoy;sí;a');
    expect(lines[2]).toBe("Pendiente;Tag 2;60 %;;;;sí;b");
    expect(lines[3]).toBe("Pospuesto;Hallazgo viejo;;12 min;;hoy;no;viejo");
  });
});
