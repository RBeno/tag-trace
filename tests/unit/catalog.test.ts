/**
 * Importador de listas de tags (DS-002, DS-005, DS-006, DS-008).
 *
 * Estas listas se escriben a mano, así que las pruebas cubren lo que de verdad va a pasar: que
 * alguien escriba `Críticos` con acento y en plural, que se deje una fila a medias, y que invente
 * una categoría que el producto todavía no conoce. Ninguna de las tres cosas debería costarle el
 * fichero entero.
 */

import { describe, expect, it } from "vitest";

import {
  CatalogFailure,
  EXPECTED_STRUCTURE,
  importCatalog,
  normaliseListName,
  tagSet,
} from "../../src/ingestion/catalog.js";

describe("importador de listas", () => {
  it("lee la estructura declarada y separa cada lista", () => {
    const result = importCatalog(
      ["lista;tag;orden", "circuito;0100;1", "circuito;0200;2", "memoria;0100", "mantenimiento;0900"].join(
        "\r\n",
      ),
    );

    expect(result.accepted).toBe(4);
    expect(result.rejected).toHaveLength(0);
    expect([...tagSet(result, "circuito")]).toEqual(["0100", "0200"]);
    expect(result.lists.get("circuito")?.[1]?.order).toBe(2);
    expect(result.lists.get("memoria")?.[0]?.order).toBeNull();
  });

  it("conserva los ceros iniciales del identificador", () => {
    const result = importCatalog(["lista;tag", "circuito;0040", "circuito;40"].join("\n"));

    // `0040` y `40` son tags distintos (R-DAT-001, INV-002).
    expect(tagSet(result, "circuito").size).toBe(2);
  });

  it("admite acentos, mayúsculas y plural en el nombre de la lista", () => {
    // Es un fichero escrito a mano. Rechazar «Críticos» sería castigar al usuario por su idioma.
    expect(normaliseListName("Críticos")).toBe("critico");
    expect(normaliseListName("CARGA ONLINE")).toBe("carga-online");
    expect(normaliseListName("Memoria")).toBe("memoria");

    const result = importCatalog(["lista;tag", "Críticos;0100", "Carga Online;0200"].join("\n"));
    expect(result.lists.has("critico")).toBe(true);
    expect(result.lists.has("carga-online")).toBe(true);
    expect(result.unknownLists).toHaveLength(0);
  });

  it("una lista que el producto no conoce se conserva y se avisa, no se rechaza", () => {
    // El propietario ya anticipó ampliaciones: una categoría nueva es información, no un defecto.
    const result = importCatalog(["lista;tag", "circuito;0100", "semaforo-nuevo;0300"].join("\n"));

    expect(result.accepted).toBe(2);
    expect(result.unknownLists).toEqual(["semaforo-nuevo"]);
    expect(result.lists.get("semaforo-nuevo")).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("semaforo-nuevo");
  });

  it("una fila incompleta va a su recuento y no tumba el fichero", () => {
    const result = importCatalog(
      ["lista;tag", "circuito;0100", "circuito;", ";0200", "memoria;0300"].join("\n"),
    );

    expect(result.accepted).toBe(2);
    expect(result.rejected.map((row) => row.reason)).toEqual(["SIN_TAG", "SIN_LISTA"]);
    // La fila física se conserva para poder ir a mirarla: la cabecera es la fila 1.
    expect(result.rejected[0]?.sourceRow).toBe(3);
  });

  it("un fichero sin las columnas obligatorias falla diciendo cuáles son", () => {
    let failure: CatalogFailure | null = null;
    try {
      importCatalog(["categoria;identificador", "circuito;0100"].join("\n"));
    } catch (error) {
      failure = error as CatalogFailure;
    }

    expect(failure).toBeInstanceOf(CatalogFailure);
    // El mensaje no se limita a decir que está mal: dice qué se esperaba, que es lo único que
    // permite arreglarlo cuando el fichero lo escribe una persona.
    expect(failure?.recovery).toContain("lista");
    expect(failure?.recovery).toContain("tag");
  });

  it("la estructura esperada está declarada para poder enseñarla antes de pedir el fichero", () => {
    expect(EXPECTED_STRUCTURE.header).toEqual(["lista", "tag"]);
    expect(EXPECTED_STRUCTURE.lists).toContain("memoria");
    expect(EXPECTED_STRUCTURE.example[0]).toContain("lista");
  });

  it("detecta el separador en lugar de imponerlo", () => {
    const conComas = importCatalog(["lista,tag", "circuito,0100", "circuito,0200"].join("\n"));
    expect(conComas.delimiter).toBe(",");
    expect(conComas.accepted).toBe(2);
  });
});
