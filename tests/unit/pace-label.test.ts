/**
 * Cómo se enseña el ritmo de un AGV frente a la flota (R-AGV-019).
 *
 * Una tabla enseñaba la razón como «117 %, más lento», y se leía como un 117 % más lento cuando es un
 * 17 %. Se fija que la pantalla dice la diferencia.
 */

import { describe, expect, it } from "vitest";

import { paceDifference } from "../../src/presentation/labels.js";

describe("ritmo frente a la flota", () => {
  it("una razón de 1,17 es un 17 % más lento, no un 117 %", () => {
    expect(paceDifference(1.17)).toBe("17 % más lento");
    expect(paceDifference(1.19)).toBe("19 % más lento");
  });

  it("por debajo de 1 es más rápido, y 1 es igual que la flota", () => {
    expect(paceDifference(0.92)).toBe("8 % más rápido");
    expect(paceDifference(1.004)).toBe("igual que la flota");
  });
});
