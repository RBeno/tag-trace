/**
 * Medida de la monotonía de una fuente (R-DAT-008).
 *
 * El sentido no se supone: se mide. Y las inversiones no son un error de parseo — son evidencia de
 * entrega diferida, es decir de un AGV que perdió comunicación y volcó después. Ese hecho es
 * diagnóstico y se conserva señalado en lugar de corregirse en silencio.
 */

import type { SourceDirection } from "../domain/order.js";

export interface MonotonicityReport {
  readonly direction: SourceDirection;
  /** Pares consecutivos que contradicen el sentido dominante. */
  readonly inversions: number;
  readonly comparedPairs: number;
  /** 0–1. Proporción de pares coherentes con el sentido detectado. */
  readonly confidence: number;
}

/**
 * Determina el sentido dominante y cuenta las inversiones respecto a él.
 *
 * Los instantes iguales no cuentan como evidencia de sentido: a resolución gruesa son la mayoría y
 * no dicen nada sobre cómo emite la fuente.
 */
export function measureMonotonicity(utcMs: readonly number[]): MonotonicityReport {
  let ascending = 0;
  let descending = 0;

  for (let index = 0; index + 1 < utcMs.length; index += 1) {
    const current = utcMs[index] as number;
    const next = utcMs[index + 1] as number;
    if (next > current) ascending += 1;
    else if (next < current) descending += 1;
  }

  const comparedPairs = ascending + descending;
  if (comparedPairs === 0) {
    return { direction: "unknown", inversions: 0, comparedPairs: 0, confidence: 0 };
  }

  const direction: SourceDirection = descending >= ascending ? "newest-first" : "oldest-first";
  const inversions = direction === "newest-first" ? ascending : descending;
  return {
    direction,
    inversions,
    comparedPairs,
    confidence: (comparedPairs - inversions) / comparedPairs,
  };
}
