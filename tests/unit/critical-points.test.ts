/**
 * Candidatos a punto crítico (R-GRA-007): bifurcación, cruce, parada precisa y semáforo.
 *
 * Lo que se fija aquí, para bifurcación: un sucesor dominante con una excepción rara no es un
 * reparto; un reparto parejo sostenido por un puñado de pasadas tampoco lo es; y —lo que más
 * importa, porque es un falso positivo real encontrado construyendo el propio banco de auditoría—
 * un tag cuyo reparto agregado parece parejo pero en realidad es un sucesor sustituyendo a otro a
 * mitad de la ventana (un cambio de régimen aguas abajo, no una bifurcación) tampoco debe salir
 * como candidato.
 *
 * Para cruce: dos ramas que reconvergen dentro del margen se reclasifican; las que no, se quedan
 * como bifurcación. Para parada precisa y semáforo: la duración se mide sobre la transición
 * saliente del tag, descartando siempre los pares en el mismo instante (R-DAT-013).
 */

import { describe, expect, it } from "vitest";

import {
  classifyCrossings,
  findBifurcationCandidates,
  findPrecisePauseCandidates,
  findTrafficLightCandidates,
  type BifurcationThresholds,
  type CriticalPointCandidate,
  type CruceThresholds,
  type PrecisePauseThresholds,
  type TrafficLightThresholds,
} from "../../src/domain/critical-points.js";

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

/** Narrowing con mensaje legible en vez de un cast silencioso, para que un fallo diga qué salió. */
function asKind<K extends CriticalPointCandidate["kind"]>(
  candidate: CriticalPointCandidate | undefined,
  kind: K,
): Extract<CriticalPointCandidate, { readonly kind: K }> {
  if (candidate?.kind !== kind) throw new Error(`esperaba «${kind}», salió «${candidate?.kind ?? "nada"}»`);
  return candidate as Extract<CriticalPointCandidate, { readonly kind: K }>;
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
    const candidate = asKind(candidates[0], "bifurcacion");
    expect(candidate.tagId).toBe("A");
    expect(candidate.support).toBe(50);
    expect(candidate.branches.map((b) => b.tagId)).toEqual(["B", "C"]);
    expect(candidate.branches[0]?.share).toBeCloseTo(0.6, 5);
    expect(candidate.branches[1]?.share).toBeCloseTo(0.4, 5);
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
    const candidate = asKind(candidates[0], "bifurcacion");
    expect(candidate.branches.map((b) => b.tagId)).toEqual(["B", "C", "D"]);
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
    const candidate = asKind(candidates[0], "bifurcacion");
    expect(candidate.branches.map((b) => b.tagId)).toEqual(["B", "C"]);
  });

  it("sin transiciones no hay candidatos", () => {
    expect(findBifurcationCandidates([], THRESHOLDS)).toEqual([]);
  });
});

describe("cruce por reconvergencia (classifyCrossings)", () => {
  const CRUCE: CruceThresholds = { maxHopsToReconverge: 3 };

  function bifurcacion(
    tagId: string,
    branches: readonly { readonly tagId: string; readonly support: number; readonly share: number }[],
  ): CriticalPointCandidate {
    return {
      kind: "bifurcacion",
      tagId,
      support: branches.reduce((sum, branch) => sum + branch.support, 0),
      branches,
      evidence: "",
    };
  }

  it("dos ramas que reconvergen dentro del margen se reclasifican como cruce", () => {
    const candidate = bifurcacion("A", [
      { tagId: "B", support: 10, share: 0.6 },
      { tagId: "C", support: 8, share: 0.4 },
    ]);
    const transitions = [
      { from: "B", to: "X" },
      { from: "C", to: "X" },
    ];
    const [result] = classifyCrossings([candidate], transitions, CRUCE);
    const cruce = asKind(result, "cruce");
    expect(cruce.reconvergesAt).toBe("X");
    expect(cruce.hops).toBe(1);
    expect(cruce.branches.map((b) => b.tagId)).toEqual(["B", "C"]);
  });

  it("dos ramas que no reconvergen dentro del margen se quedan como bifurcación", () => {
    const candidate = bifurcacion("A", [
      { tagId: "B", support: 10, share: 0.6 },
      { tagId: "C", support: 8, share: 0.4 },
    ]);
    // B sigue su propio camino de cuatro saltos, C otro completamente distinto: nunca coinciden
    // dentro de los tres saltos que da el margen.
    const transitions = [
      { from: "B", to: "B1" },
      { from: "B1", to: "B2" },
      { from: "B2", to: "B3" },
      { from: "B3", to: "B4" },
      { from: "C", to: "C1" },
      { from: "C1", to: "C2" },
      { from: "C2", to: "C3" },
      { from: "C3", to: "C4" },
    ];
    const [result] = classifyCrossings([candidate], transitions, CRUCE);
    expect(asKind(result, "bifurcacion").tagId).toBe("A");
  });

  it("con tres ramas, basta que un par reconverja para reclasificar el candidato entero", () => {
    const candidate = bifurcacion("A", [
      { tagId: "B", support: 10, share: 0.4 },
      { tagId: "C", support: 8, share: 0.32 },
      { tagId: "D", support: 7, share: 0.28 },
    ]);
    const transitions = [
      { from: "B", to: "X" },
      { from: "C", to: "X" }, // B y C reconvergen en X
      { from: "D", to: "D1" },
      { from: "D1", to: "D2" }, // D no reconverge con nadie
    ];
    const [result] = classifyCrossings([candidate], transitions, CRUCE);
    expect(result?.kind).toBe("cruce");
  });

  it("no toca candidatos que no son bifurcación", () => {
    const paradaPrecisa: CriticalPointCandidate = {
      kind: "parada-precisa",
      tagId: "Z",
      samples: 10,
      meanDurationMs: 60_000,
      coefficientOfVariation: 0.05,
      evidence: "",
    };
    const [result] = classifyCrossings([paradaPrecisa], [], CRUCE);
    expect(result).toEqual(paradaPrecisa);
  });
});

interface Dur {
  readonly from: string;
  readonly fromTime: number;
  readonly toTime: number;
  readonly sameInstant: boolean;
}

/** Una transición por cada duración de `durations`, para el mismo `from`, sin instantes repetidos. */
function durations(from: string, values: readonly number[]): Dur[] {
  return values.map((durationMs, index) => ({
    from,
    fromTime: index * 200_000,
    toTime: index * 200_000 + durationMs,
    sameInstant: false,
  }));
}

describe("parada precisa (findPrecisePauseCandidates)", () => {
  const THRESHOLDS_PP: PrecisePauseThresholds = { minDurationMs: 30_000, maxCv: 0.1, minSamples: 4 };

  it("duración larga y de poca varianza es candidato a parada precisa", () => {
    const transitions = durations("A", [59_000, 60_000, 61_000, 60_000, 59_500, 60_500]);
    const candidates = findPrecisePauseCandidates(transitions, THRESHOLDS_PP);
    expect(candidates).toHaveLength(1);
    const candidate = asKind(candidates[0], "parada-precisa");
    expect(candidate.tagId).toBe("A");
    expect(candidate.samples).toBe(6);
    expect(candidate.meanDurationMs).toBeCloseTo(60_000, -2);
    expect(candidate.coefficientOfVariation).toBeLessThanOrEqual(THRESHOLDS_PP.maxCv);
  });

  it("duración larga pero con varianza alta no es candidato", () => {
    const transitions = durations("A", [30_000, 90_000, 40_000, 80_000, 35_000]);
    expect(findPrecisePauseCandidates(transitions, THRESHOLDS_PP)).toEqual([]);
  });

  it("duración corta aunque de poca varianza es tránsito normal, no una parada", () => {
    const transitions = durations("A", [15_000, 15_500, 14_800, 15_200]);
    expect(findPrecisePauseCandidates(transitions, THRESHOLDS_PP)).toEqual([]);
  });

  it("pocas muestras no son candidato aunque el patrón encaje", () => {
    const transitions = durations("A", [60_000, 60_500, 59_500]); // 3 < minSamples (4)
    expect(findPrecisePauseCandidates(transitions, THRESHOLDS_PP)).toEqual([]);
  });

  it("los pares en el mismo instante no cuentan como duración (R-DAT-013)", () => {
    const validas = durations("A", [59_000, 60_000, 61_000, 60_000, 59_500]);
    const mismoInstante = durations("A", [0, 0, 0, 0, 0]).map((entry) => ({ ...entry, sameInstant: true }));
    const candidate = asKind(
      findPrecisePauseCandidates([...validas, ...mismoInstante], THRESHOLDS_PP)[0],
      "parada-precisa",
    );
    expect(candidate.samples).toBe(5); // solo las válidas, no las 10 totales
    expect(candidate.meanDurationMs).toBeCloseTo(59_900, -2);
  });
});

describe("semáforo (findTrafficLightCandidates)", () => {
  const THRESHOLDS_TL: TrafficLightThresholds = {
    minGapRatio: 3,
    maxWithinClusterCv: 0.25,
    minClusterSamples: 4,
    minSamples: 20,
  };

  it("una duración bimodal limpia es candidato a semáforo, con las dos medias", () => {
    const low = [15_000, 15_100, 15_200, 15_300, 14_900, 14_800, 15_050, 15_150, 14_950, 15_250];
    const high = [95_000, 95_200, 95_400, 95_600, 94_800, 94_600, 95_100, 95_300, 94_900, 95_500];
    const transitions = durations("A", [...low, ...high]);
    const candidates = findTrafficLightCandidates(transitions, THRESHOLDS_TL);
    expect(candidates).toHaveLength(1);
    const candidate = asKind(candidates[0], "semaforo");
    expect(candidate.samples).toBe(20);
    expect(candidate.lowClusterMeanMs).toBeLessThan(20_000);
    expect(candidate.highClusterMeanMs).toBeGreaterThan(90_000);
  });

  it("un solo grupo compacto, sin salto real, no es candidato", () => {
    const values = Array.from({ length: 20 }, (_, index) => 15_000 + index * 100);
    expect(findTrafficLightCandidates(durations("A", values), THRESHOLDS_TL)).toEqual([]);
  });

  it("un salto grande con un lado disperso no es candidato (guarda de compacidad)", () => {
    // El grupo bajo va de 5 000 a 32 000 ms, disperso a propósito: el salto hacia el grupo alto
    // (~150 000 ms) es real, pero el grupo bajo no es un régimen compacto, es ruido con un pico.
    const low = Array.from({ length: 10 }, (_, index) => 5_000 + index * 3_000);
    const high = Array.from({ length: 10 }, (_, index) => 150_000 + index * 200);
    expect(findTrafficLightCandidates(durations("A", [...low, ...high]), THRESHOLDS_TL)).toEqual([]);
  });

  it("pocas muestras totales no son candidato aunque el patrón parezca bimodal", () => {
    const low = [15_000, 15_100, 15_200, 15_300, 14_900];
    const high = [95_000, 95_200, 95_400, 95_600, 94_800];
    expect(findTrafficLightCandidates(durations("A", [...low, ...high]), THRESHOLDS_TL)).toEqual([]);
  });

  it("los pares en el mismo instante no cuentan como duración (R-DAT-013)", () => {
    const low = [15_000, 15_100, 15_200, 15_300, 14_900, 14_800, 15_050, 15_150, 14_950, 15_250];
    const high = [95_000, 95_200, 95_400, 95_600, 94_800, 94_600, 95_100, 95_300, 94_900, 95_500];
    const mismoInstante = durations("A", Array.from({ length: 8 }, () => 0)).map((entry) => ({
      ...entry,
      sameInstant: true,
    }));
    const candidate = asKind(
      findTrafficLightCandidates(durations("A", [...low, ...high]).concat(mismoInstante), THRESHOLDS_TL)[0],
      "semaforo",
    );
    expect(candidate.samples).toBe(20); // los 8 en el mismo instante no cuentan
  });
});
