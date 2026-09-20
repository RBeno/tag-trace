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
  /** El tag declarado no tiene ninguna lectura, y en su hueco hay un tag no declarado consistente. */
  | "sustituido-candidato"
  /** El tag declarado no tiene ninguna lectura, y nada ocupa su posición: el tramo se salta. */
  | "no-observado"
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
  const common = longestCommonSubsequence(declaredOrder, observedRing);
  const rows: VsystemComparisonRow[] = [];

  let declaredIndex = 0;
  let observedIndex = 0;
  for (const anchor of [...common, null]) {
    const declaredGap: string[] = [];
    while (declaredIndex < declaredOrder.length && declaredOrder[declaredIndex] !== anchor) {
      declaredGap.push(declaredOrder[declaredIndex] as string);
      declaredIndex += 1;
    }
    const observedGap: string[] = [];
    while (observedIndex < observedRing.length && observedRing[observedIndex] !== anchor) {
      observedGap.push(observedRing[observedIndex] as string);
      observedIndex += 1;
    }

    rows.push(...classifyGap(declaredGap, observedGap, readTags));

    if (anchor !== null) {
      rows.push({
        declaredTag: anchor,
        observedTag: anchor,
        verdict: "coincide",
        truth: "observed",
        evidence: "El tag declarado aparece en el anillo observado en el mismo orden relativo.",
      });
      declaredIndex += 1;
      observedIndex += 1;
    }
  }

  return rows;
}

/**
 * Un hueco entre dos anclas comunes: lo que Vsystem declara y nadie observó, frente a lo que se
 * observó y Vsystem no declaró, en el mismo tramo. Emparejar uno a uno por posición es la hipótesis
 * de sustitución; lo que sobra de cada lado sale por separado.
 */
function classifyGap(
  declaredGap: readonly string[],
  observedGap: readonly string[],
  readTags: ReadonlySet<string>,
): readonly VsystemComparisonRow[] {
  const rows: VsystemComparisonRow[] = [];
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
        evidence: `«${declared}» sí se lee, pero no en esta posición del anillo; «${observed}» ocupa el hueco.`,
      });
    } else {
      rows.push({
        declaredTag: declared,
        observedTag: observed,
        verdict: "sustituido-candidato",
        truth: "inferred",
        evidence: `«${declared}» no tiene ninguna lectura; «${observed}» ocupa exactamente su posición.`,
      });
    }
  }
  for (let index = pairs; index < declaredGap.length; index += 1) {
    rows.push({
      declaredTag: declaredGap[index] as string,
      observedTag: null,
      verdict: "no-observado",
      truth: "unknown",
      evidence: "Declarado sin lecturas y sin ningún tag ocupando su posición: el tramo se salta.",
    });
  }
  for (let index = pairs; index < observedGap.length; index += 1) {
    rows.push({
      declaredTag: null,
      observedTag: observedGap[index] as string,
      verdict: "no-declarado",
      truth: "observed",
      evidence: "Se observa en el anillo y no está en la lista declarada.",
    });
  }
  return rows;
}

/** Subsecuencia común más larga, por programación dinámica clásica. O(n·m); ~200 tags es trivial. */
function longestCommonSubsequence(a: readonly string[], b: readonly string[]): readonly string[] {
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
