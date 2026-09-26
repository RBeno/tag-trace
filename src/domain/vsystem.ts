/**
 * Contraste del anillo reconstruido contra la lista `circuito` declarada (R-GRA-001).
 *
 * El método es alineación de secuencia (subsecuencia común más larga), no comparación de conjuntos:
 * dos anillos casi iguales con una sustitución en medio comparten casi todo su orden, y es
 * exactamente lo que reveló el contraste manual de PC2 —90,8 % de coincidencia, cuatro tags
 * sustituidos identificados por posición—. Aquí se automatiza ese mismo método.
 *
 * Vsystem y físico permanecen separados (R-GRA-001): esto nunca sustituye el anillo observado por
 * el declarado, solo los pone uno junto a otro y marca las diferencias con su hipótesis.
 */

import type { TruthState } from "./truth.js";

export type VsystemVerdict =
  /** El tag declarado está donde Vsystem dice, con el mismo vecindario observado. */
  | "coincide"
  /**
   * El tag declarado no tiene ninguna lectura, y donde la lista lo pone se lee otro que la lista no
   * tiene: o se sustituyó, o el número está mal escrito en la lista (R-GRA-015). El número no decide
   * cuál: los tags vienen en familias de números seguidos.
   */
  | "sustituido-candidato"
  /** El tag declarado no tiene ninguna lectura, y nada ocupa su posición: el tramo se salta. */
  | "no-observado"
  /**
   * El tag declarado sí se lee, pero no en el recorrido dominante: en una rama, o donde el sucesor
   * más frecuente lo salta. No es «sin lecturas» (CHANGELOG [3.30.1]).
   */
  | "fuera-del-anillo"
  /**
   * El tag está declarado y está en el anillo, pero la lista lo pone en otro sitio. Manda lo leído: es
   * la lista la que se corrige (R-GRA-015). Sin esto salía dos veces y contradiciéndose: «se lee fuera
   * del recorrido» por el lado declarado y «no declarado» por el observado (CHANGELOG [3.31.0]).
   */
  | "otro-orden"
  /** El tag se observa en el anillo y Vsystem no lo declara. */
  | "no-declarado";

export interface VsystemComparisonRow {
  readonly declaredTag: string | null;
  readonly observedTag: string | null;
  readonly verdict: VsystemVerdict;
  readonly truth: TruthState;
  readonly evidence: string;
}

/**
 * Alinea la lista declarada contra el anillo observado y clasifica cada posición.
 *
 * `readTags` es el conjunto de tags con al menos una lectura: decide si un hueco en la alineación
 * es "nunca se lee" (candidato a sustituido u obsoleto) o si simplemente no se declaró.
 */
export function compareAgainstVsystem(
  declaredOrder: readonly string[],
  observedRing: readonly string[],
  readTags: ReadonlySet<string>,
): readonly VsystemComparisonRow[] {
  const { aligned, common } = alignToDeclared(observedRing, declaredOrder);
  const rows: VsystemComparisonRow[] = [];
  const context: GapContext = {
    readTags,
    declared: new Set(declaredOrder),
    ring: new Set(aligned),
    declaredNeighbours: neighbours(declaredOrder, false),
    ringNeighbours: neighbours(aligned, true),
  };

  let declaredIndex = 0;
  let observedIndex = 0;
  for (const anchor of [...common, null]) {
    const declaredGap: string[] = [];
    while (declaredIndex < declaredOrder.length && declaredOrder[declaredIndex] !== anchor) {
      declaredGap.push(declaredOrder[declaredIndex] as string);
      declaredIndex += 1;
    }
    const observedGap: string[] = [];
    while (observedIndex < aligned.length && aligned[observedIndex] !== anchor) {
      observedGap.push(aligned[observedIndex] as string);
      observedIndex += 1;
    }

    rows.push(...classifyGap(declaredGap, observedGap, context));

    if (anchor !== null) {
      rows.push({
        declaredTag: anchor,
        observedTag: anchor,
        verdict: "coincide",
        truth: "observed",
        evidence: "Está donde Vsystem dice.",
      });
      declaredIndex += 1;
      observedIndex += 1;
    }
  }

  return rows;
}

interface GapContext {
  readonly readTags: ReadonlySet<string>;
  readonly declared: ReadonlySet<string>;
  readonly ring: ReadonlySet<string>;
  readonly declaredNeighbours: ReadonlyMap<string, string>;
  readonly ringNeighbours: ReadonlyMap<string, string>;
}

/** «entre A y B» de cada tag de una secuencia; en el anillo, el primero y el último son vecinos. */
export function neighbours(sequence: readonly string[], cyclic: boolean): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  sequence.forEach((tag, index) => {
    const before = index > 0 ? sequence[index - 1] : cyclic ? sequence[sequence.length - 1] : undefined;
    const after = index < sequence.length - 1 ? sequence[index + 1] : cyclic ? sequence[0] : undefined;
    result.set(
      tag,
      before !== undefined && after !== undefined
        ? `entre ${before} y ${after}`
        : before !== undefined
          ? `después de ${before}`
          : after !== undefined
            ? `antes de ${after}`
            : "sola",
    );
  });
  return result;
}

/**
 * Un hueco entre dos anclas comunes: lo que Vsystem declara y nadie observó, frente a lo que se
 * observó y Vsystem no declaró, en el mismo tramo. Emparejar uno a uno por posición es la hipótesis
 * de sustitución; lo que sobra de cada lado sale por separado.
 */
function classifyGap(
  declaredHole: readonly string[],
  observedHole: readonly string[],
  context: GapContext,
): readonly VsystemComparisonRow[] {
  const rows: VsystemComparisonRow[] = [];
  const readTags = context.readTags;
  // Un declarado que está en el anillo, fuera del orden común, se dice una vez y como lo que es: su
  // sitio en el anillo es otro. Su aparición por el lado observado no es «no declarado».
  for (const declared of declaredHole) {
    if (!context.ring.has(declared)) continue;
    rows.push({
      declaredTag: declared,
      observedTag: declared,
      verdict: "otro-orden",
      truth: "observed",
      evidence: `Las lecturas lo sitúan ${context.ringNeighbours.get(declared) ?? "sin vecinos"}; la lista, ${
        context.declaredNeighbours.get(declared) ?? "sin vecinos"
      }. Manda lo leído: es la lista la que hay que corregir.`,
    });
  }
  const declaredGap = declaredHole.filter((tag) => !context.ring.has(tag));
  const observedGap = observedHole.filter((tag) => !context.declared.has(tag));
  const pairs = Math.min(declaredGap.length, observedGap.length);

  for (let index = 0; index < pairs; index += 1) {
    const declared = declaredGap[index] as string;
    const observed = observedGap[index] as string;
    if (readTags.has(declared)) {
      // El declarado sí tiene lecturas en algún sitio: no es una sustitución, es un tramo donde el
      // orden no coincide del todo (una rama, o el anillo tomó otro camino). Se dice tal cual, sin
      // forzarlo a sustitución.
      rows.push({
        declaredTag: declared,
        observedTag: observed,
        verdict: "no-declarado",
        truth: "inferred",
        evidence: `«${declared}» sí se lee, pero en otro sitio; aquí se lee «${observed}».`,
      });
    } else {
      rows.push({
        declaredTag: declared,
        observedTag: observed,
        verdict: "sustituido-candidato",
        truth: "inferred",
        evidence: `«${declared}» no se lee nunca, y donde la lista lo pone (${
          context.declaredNeighbours.get(declared) ?? "sin vecinos"
        }) se lee «${observed}», que la lista no tiene: o se sustituyó, o el número está mal escrito en la lista.`,
      });
    }
  }
  for (let index = pairs; index < declaredGap.length; index += 1) {
    const declared = declaredGap[index] as string;
    rows.push(
      readTags.has(declared)
        ? {
            declaredTag: declared,
            observedTag: null,
            verdict: "fuera-del-anillo",
            truth: "observed",
            evidence: `«${declared}» se lee, pero no en el recorrido dominante: en una rama o donde el sucesor más frecuente lo salta.`,
          }
        : {
            declaredTag: declared,
            observedTag: null,
            verdict: "no-observado",
            truth: "unknown",
            evidence: `Declarado y sin lecturas: su sitio solo lo da la lista (${
              context.declaredNeighbours.get(declared) ?? "sin vecinos"
            }), y ahí no se lee ningún otro tag.`,
          },
    );
  }
  for (let index = pairs; index < observedGap.length; index += 1) {
    rows.push({
      declaredTag: null,
      observedTag: observedGap[index] as string,
      verdict: "no-declarado",
      truth: "observed",
      evidence: `Se lee en el recorrido, ${context.ringNeighbours.get(observedGap[index] as string) ?? "sin vecinos"}, y la lista no lo tiene.`,
    });
  }
  return rows;
}

/**
 * La rotación del anillo que más orden comparte con la lista. Rotar solo al primer tag de la lista que
 * aparece en el anillo (`rotateToDeclaredStart`) falla cuando ese tag es justo el que la lista tiene
 * mal colocado: la subsecuencia común pierde media vuelta y los vecinos sanos salen como «otro sitio».
 * Aquí se prueba la rotación en cada tag común y se conserva la de subsecuencia más larga; en empate,
 * la que empieza por el tag más cercano al inicio de la lista (que es lo que hacía la rotación simple).
 */
export function alignToDeclared(
  ring: readonly string[],
  declaredOrder: readonly string[],
): { readonly aligned: readonly string[]; readonly common: readonly string[] } {
  const inRing = new Set(ring);
  let best: { aligned: readonly string[]; common: readonly string[] } | null = null;
  for (const tag of declaredOrder) {
    if (!inRing.has(tag)) continue;
    const index = ring.indexOf(tag);
    const aligned = [...ring.slice(index), ...ring.slice(0, index)];
    const common = longestCommonSubsequence(declaredOrder, aligned);
    if (best === null || common.length > best.common.length) best = { aligned, common };
  }
  return best ?? { aligned: ring, common: longestCommonSubsequence(declaredOrder, ring) };
}

/**
 * El anillo observado es cíclico y puede entrar cortado por cualquier punto —el ancla es inferida
 * (ciclo dominante) o declarada en un tag que no es el primero de la lista Vsystem—. La subsecuencia
 * común más larga es lineal y sensible a dónde se corta: un corte que cae en mitad de un tramo
 * idéntico lo parte en dos coincidencias más cortas en vez de reconocerlo como una sola. Rotar aquí,
 * hasta el primer tag de la lista declarada que aparece en el anillo, evita que el contraste dependa
 * de por dónde entró el ancla. Sin ningún tag en común, el anillo se deja como está: no hay alrededor
 * de qué rotar.
 */
export function rotateToDeclaredStart(
  ring: readonly string[],
  declaredOrder: readonly string[],
): readonly string[] {
  for (const tag of declaredOrder) {
    const index = ring.indexOf(tag);
    if (index === -1) continue;
    return [...ring.slice(index), ...ring.slice(0, index)];
  }
  return ring;
}

/** Subsecuencia común más larga, por programación dinámica clásica. O(n·m); ~200 tags es trivial. */
export function longestCommonSubsequence(a: readonly string[], b: readonly string[]): readonly string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        a[i] === b[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
    }
  }

  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push(a[i] as string);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
}
