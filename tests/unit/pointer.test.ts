/**
 * El imán de toque (UX_SPEC §7): un dedo no acierta una marca de 3 px, así que se elige la más
 * cercana dentro de un radio. Lo que se fija: gana la más cercana, fuera del radio no hay nada, y un
 * toque dentro de una marca se queda con ella aunque haya otra al lado.
 */

import { describe, expect, it } from "vitest";

import { nearestWithin } from "../../src/presentation/pointer.js";

const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("imán de toque (nearestWithin)", () => {
  const marks = [box(0, 0, 4, 40), box(10, 0, 14, 40), box(100, 0, 104, 40)];

  it("elige la marca más cercana dentro del radio", () => {
    expect(nearestWithin(6, 20, marks, 22)).toBe(0); // a 2 px de la primera y a 4 de la segunda
    expect(nearestWithin(9, 20, marks, 22)).toBe(1); // a 5 px de la primera y a 1 de la segunda
    expect(nearestWithin(90, 20, marks, 22)).toBe(2);
  });

  it("fuera del radio no hay marca", () => {
    expect(nearestWithin(50, 20, marks, 22)).toBe(-1);
    expect(nearestWithin(2, 80, marks, 22)).toBe(-1);
  });

  it("un toque dentro de una marca se queda con ella", () => {
    expect(nearestWithin(12, 5, marks, 22)).toBe(1);
    expect(nearestWithin(2, 39, marks, 22)).toBe(0);
  });
});
