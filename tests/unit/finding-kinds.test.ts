/**
 * El catálogo de hallazgos (`src/domain/finding-kinds.ts`): lo que la bandeja del Resumen ordena y
 * filtra, y lo que el Worker usa para bloquear la consolidación de un periodo con incidencias.
 *
 * Lo que se fija: la WiFi es un tema propio (UX_SPEC §2, §4.5, 3.69.0) y sus cinco tipos están en el
 * catálogo con su rango —un AGV que no reconecta pierde su función, como el que deja de leer—, para
 * que no caigan en «contexto» con su identificador en bruto.
 */

import { describe, expect, it } from "vitest";

import { FINDING_KINDS, findingKindOf, THEMES } from "../../src/domain/finding-kinds.js";

describe("catálogo de hallazgos", () => {
  it("la WiFi es un tema, entre AGV y Tiempos", () => {
    expect([...THEMES]).toEqual(["tags", "agv", "wifi", "tiempos", "linea"]);
  });

  it("los tipos del registro de conexiones tienen tema WiFi y su rango", () => {
    expect(findingKindOf("conexion-no-reconecta")).toEqual({ theme: "wifi", label: "AGV que no reconecta", rank: 1 });
    expect(findingKindOf("conexion-sitio").rank).toBe(2);
    expect(findingKindOf("conexion-agv").rank).toBe(2);
    expect(findingKindOf("conexion-ruidoso").rank).toBe(2);
    expect(findingKindOf("conexion-colectivo")).toEqual({ theme: "wifi", label: "corte colectivo", rank: 3 });
    for (const kind of Object.keys(FINDING_KINDS).filter((key) => key.startsWith("conexion-"))) {
      expect(FINDING_KINDS[kind]?.theme).toBe("wifi");
    }
  });

  it("un tipo fuera del catálogo va a contexto con su identificador", () => {
    expect(findingKindOf("algo-nuevo")).toEqual({ theme: "tiempos", label: "algo-nuevo", rank: 3 });
  });
});
