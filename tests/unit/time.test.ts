/**
 * El orden día/mes se decide con las fechas que lo prueban. Una fecha imposible en los dos órdenes
 * (`24/13/2026`) no es evidencia de nada: es una fila que irá a cuarentena. Hasta 3.89.0 una sola
 * bastaba para declarar el fichero «contradictorio» y rechazarlo entero.
 */
import { describe, expect, it } from "vitest";
import { detectFieldOrder } from "../../src/domain/time.js";

describe("detectFieldOrder · una fecha imposible no es evidencia del orden (TC-379)", () => {
  it("doscientas filas día/mes y una 24/13 determinan día/mes", () => {
    const samples = [
      ...Array.from({ length: 200 }, (_, index) => `24/01/2026 06:${String(index % 60).padStart(2, "0")}:00`),
      "24/13/2026 06:00:00",
    ];
    expect(detectFieldOrder(samples)).toMatchObject({ determined: true, order: "day-first" });
  });

  it("fechas que solo encajan en un orden y otras solo en el otro siguen siendo contradictorias", () => {
    expect(detectFieldOrder(["24/01/2026 06:00:00", "01/24/2026 06:00:00"])).toEqual({ determined: false, reason: "CONTRADICTORY" });
  });

  it("solo fechas imposibles: no hay fechas con que decidir", () => {
    expect(detectFieldOrder(["24/13/2026 06:00:00"])).toEqual({ determined: false, reason: "NO_DATES" });
  });

  it("fechas ambiguas más una imposible siguen ambiguas: la imposible no decide", () => {
    expect(detectFieldOrder(["01/02/2026 06:00:00", "24/13/2026 06:00:00"])).toMatchObject({ determined: false, reason: "AMBIGUOUS" });
  });
});
