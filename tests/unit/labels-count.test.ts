/**
 * Las etiquetas con cuenta de las tablas plegables (F6, entrega 4).
 *
 * Lo que se fija: con uno, el singular y su artículo («Ver el refuerzo declarado», «Detalle del
 * tramo», «Ver la parada»); con varios, el plural con la cifra en español. Antes salía «Ver los 1
 * refuerzos declarados».
 */

import { describe, expect, it } from "vitest";

import { countedLabel } from "../../src/presentation/labels.js";

describe("etiquetas con cuenta (F6, entrega 4)", () => {
  it("con uno, singular y artículo singular; con varios, plural con la cifra", () => {
    expect(countedLabel("Ver", 1, false, "refuerzo declarado", "refuerzos declarados")).toBe("Ver el refuerzo declarado");
    expect(countedLabel("Ver", 3, false, "refuerzo declarado", "refuerzos declarados")).toBe("Ver los 3 refuerzos declarados");
    expect(countedLabel("Ver", 1, true, "parada", "paradas")).toBe("Ver la parada");
    expect(countedLabel("Detalle de", 1, false, "tramo", "tramos")).toBe("Detalle del tramo");
    expect(countedLabel("Detalle de", 1, true, "calle", "calles")).toBe("Detalle de la calle");
    expect(countedLabel("Detalle de", 12_000, true, "calle", "calles")).toBe("Detalle de las 12.000 calles");
  });
});
