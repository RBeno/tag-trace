/**
 * El aviso de una versión nueva (NFR-011, NFR-016, `UX_SPEC.md` §9).
 *
 * Lo que se fija:
 * - dice la versión que se abrirá y la abierta, y si es anterior (un retorno) lo dice así;
 * - dice qué pasa con lo guardado: igual, convertido a un formato nuevo (y pide exportar antes) o
 *   ilegible por ser de un formato anterior;
 * - con un trabajo en curso, aquí o en otra pestaña, no se puede activar y lo dice;
 * - ningún texto enseña referencias internas.
 */

import { describe, expect, it } from "vitest";

import { compareVersions, updateText } from "../../src/presentation/update.js";

const current = { version: "3.81.1", storeVersion: 12 };

describe("aviso de versión nueva", () => {
  it("misma forma del almacén: se abre igual y se puede actualizar", () => {
    const text = updateText({ current, next: { version: "3.82.0", storeVersion: 12 }, busy: false, otherTabBusy: false });
    expect(text.title).toBe("Hay una versión nueva: 3.82.0 (abierta: 3.81.1).");
    expect(text.compatibility).toBe("Lo guardado en este dispositivo se abre igual.");
    expect(text.blocked).toBeNull();
  });

  it("almacén nuevo: avisa de la conversión sin vuelta atrás y pide exportar antes", () => {
    const text = updateText({ current, next: { version: "3.90.0", storeVersion: 13 }, busy: false, otherTabBusy: false });
    expect(text.compatibility).toContain("del formato 12 al 13");
    expect(text.compatibility).toContain("exporta una copia de cada circuito (.agvproj)");
  });

  it("volver a una versión anterior: lo dice así y, si su almacén es anterior, que no podrá abrir lo guardado", () => {
    const text = updateText({ current, next: { version: "3.70.0", storeVersion: 11 }, busy: false, otherTabBusy: false });
    expect(text.title).toBe("Se ha vuelto a publicar una versión anterior: 3.70.0 (abierta: 3.81.1).");
    expect(text.compatibility).toContain("no podrá abrirlo");
    expect(compareVersions("3.10.0", "3.9.2")).toBeGreaterThan(0);
    expect(compareVersions("3.81.1", "3.81.1")).toBe(0);
  });

  it("con un trabajo en curso, aquí o en otra pestaña, no se activa", () => {
    const next = { version: "3.82.0", storeVersion: 12 };
    expect(updateText({ current, next, busy: true, otherTabBusy: false }).blocked).toBe("Se podrá actualizar cuando termine la operación en curso.");
    expect(updateText({ current, next, busy: false, otherTabBusy: true }).blocked).toBe("Otra pestaña de TAG TRACE está trabajando; actualiza cuando termine.");
    for (const busy of [true, false]) {
      const text = updateText({ current, next: { version: "3.90.0", storeVersion: 13 }, busy, otherTabBusy: !busy });
      expect(JSON.stringify(text)).not.toMatch(/\b(OQ|ADR|NFR)-\d/);
    }
  });
});
