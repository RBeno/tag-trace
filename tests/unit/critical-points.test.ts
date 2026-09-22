/**
 * Candidatos a punto crítico (R-GRA-007): solo la firma de bifurcación en esta entrega.
 *
 * Lo que se fija aquí: un sucesor dominante con una excepción rara no es un reparto; un reparto
 * parejo sostenido por un puñado de pasadas tampoco lo es; y —lo que más importa, porque es un falso
 * positivo real encontrado construyendo el propio banco de auditoría— un tag cuyo reparto agregado
 * parece parejo pero en realidad es un sucesor sustituyendo a otro a mitad de la ventana (un cambio
 * de régimen aguas abajo, no una bifurcación) tampoco debe salir como candidato.
 */

import { describe, expect, it } from "vitest";

import { findBifurcationCandidates, type BifurcationThresholds } from "../../src/domain/critical-points.js";

const THRESHOLDS: BifurcationThresholds = {
  minBranchShare: 0.3,
  minBranchSupport: 5,
  minBranchShareEachHalf: 0.15,
};

interface T {
  readonly from: string;
  readonly to: string;
  readonly fromTime: number;
}

/** `count` transiciones de `from` a `to`, repartidas uniformemente entre `startTime` y `startTime + count`. */
function spread(from: string, to: string, count: number, startTime: number): T[] {
  return Array.from({ length: count }, (_, index) => ({ from, to, fromTime: startTime + index }));
}

/** Intercala dos listas ya ordenadas por tiempo, para que ninguna mitad quede vacía de una rama. */
function interleave(a: readonly T[], b: readonly T[]): T[] {
  return [...a, ...b].sort((x, y) => x.fromTime - y.fromTime);
}

describe("candidatos a bifurcación (findBifurcationCandidates)", () => {
  it("un sucesor dominante con una excepción rara no es un reparto (guarda de cuota)", () => {
    // 45 a B, 5 a C: la excepción cumple el soporte mínimo (5) pero no la cuota (10 % < 30 %).
    const transitions = interleave(spread("A", "B", 45, 0), spread("A", "C", 5, 0));
    expect(findBifurcationCandidates(transitions, THRESHOLDS)).toEqual([]);
  });

  it("un reparto parejo sostenido por un puñado de pasadas no es consenso (guarda de soporte)", () => {
    // 50/50 de cuota, pero solo 4 pasadas por rama: por debajo del mínimo de 5.
    const transitions = interleave(spread("A", "B", 4, 0), spread("A", "C", 4, 0));
    expect(findBifurcationCandidates(transitions, THRESHOLDS)).toEqual([]);
  });

  it("un reparto real, sostenido en el tiempo, sale como candidato con sus dos ramas", () => {
    const transitions = interleave(spread("A", "B", 30, 0), spread("A", "C", 20, 0));
    const candidates = findBifurcationCandidates(transitions, THRESHOLDS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.tagId).toBe("A");
    expect(candidates[0]?.suggestedFunction).toBe("bifurcacion");
    expect(candidates[0]?.support).toBe(50);
    expect(candidates[0]?.branches.map((b) => b.tagId)).toEqual(["B", "C"]);
    expect(candidates[0]?.branches[0]?.share).toBeCloseTo(0.6, 5);
    expect(candidates[0]?.branches[1]?.share).toBeCloseTo(0.4, 5);
  });

  it("un reparto a tres vías, las tres por encima del umbral, incluye las tres ramas", () => {
    // 34/33/33: las tres superan el 30 % de cuota mínima. Se solapan en el tiempo (las tres
    // empiezan en 0), así que ninguna queda concentrada en una sola mitad de la ventana.
    const transitions = [
      ...spread("A", "B", 34, 0),
      ...spread("A", "C", 33, 0),
      ...spread("A", "D", 33, 0),
    ];
    const candidates = findBifurcationCandidates(transitions, THRESHOLDS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.branches.map((b) => b.tagId)).toEqual(["B", "C", "D"]);
  });

  it("un solo sucesor nunca es candidato", () => {
    const transitions = spread("A", "B", 50, 0);
    expect(findBifurcationCandidates(transitions, THRESHOLDS)).toEqual([]);
  });

  it("un cambio de régimen aguas abajo no es una bifurcación (regresión de falso positivo)", () => {
    // Toda la primera mitad va a B; toda la segunda mitad va a C. Agregado sobre la ventana entera
    // sale 50/50 —pasaría la guarda de cuota y de soporte sin más—, pero ninguna rama persiste en
    // las dos mitades: es la firma de un tag que deja de leerse aguas abajo, no una bifurcación.
    const transitions = [...spread("A", "B", 25, 0), ...spread("A", "C", 25, 25)];
    expect(findBifurcationCandidates(transitions, THRESHOLDS)).toEqual([]);
  });

  it("una bifurcación real sostenida sí sobrevive a la guarda temporal", () => {
    // Mismo reparto de cuota que el caso anterior en términos agregados no aplica aquí: 55/45,
    // pero intercalado a lo largo de toda la ventana, para que ambas ramas aparezcan en las dos
    // mitades. Es el control positivo de la guarda de persistencia temporal.
    const transitions = interleave(spread("A", "B", 55, 0), spread("A", "C", 45, 0));
    const candidates = findBifurcationCandidates(transitions, THRESHOLDS);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.branches.map((b) => b.tagId)).toEqual(["B", "C"]);
  });

  it("sin transiciones no hay candidatos", () => {
    expect(findBifurcationCandidates([], THRESHOLDS)).toEqual([]);
  });
});
