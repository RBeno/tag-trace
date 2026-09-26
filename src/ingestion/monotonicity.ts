/**
 * Medida de la monotonía de una fuente (R-DAT-008).
 *
 * El sentido no se supone: se mide. Y las inversiones no son un error de parseo — son evidencia de
 * entrega diferida, es decir de un AGV que perdió comunicación y volcó después. Ese hecho es
 * diagnóstico y se conserva señalado en lugar de corregirse en silencio.
 */

import type { SourceDirection } from "../domain/order.js";
import { isOrderReliable, type TimeFlag } from "../domain/time.js";

export interface MonotonicityReport {
  readonly direction: SourceDirection;
  /** Pares consecutivos que contradicen el sentido dominante. */
  readonly inversions: number;
  readonly comparedPairs: number;
  /** 0–1. Proporción de pares coherentes con el sentido detectado. */
  readonly confidence: number;
  /**
   * Pares consecutivos **del fichero** con el mismo instante.
   *
   * No son un defecto ni una inversión: son los pares que no aportaron evidencia de sentido, y su
   * peso dice lo gruesa que es la resolución de la fuente frente a su ritmo de eventos.
   *
   * **No es la cifra de R-DAT-013.** Aquí van mezclados todos los vehículos, y dos AGV distintos
   * leyendo en el mismo segundo es lo normal, no un problema de orden. Lo que amenaza la topología
   * son dos lecturas **del mismo vehículo** en el mismo instante, y eso se cuenta aparte, sobre las
   * lecturas aceptadas y agrupadas por vehículo (`SourceSummary.sameInstantPairs`).
   */
  readonly tiedPairs: number;
  /**
   * Pares consecutivos en que alguna de las dos lecturas cae en una hora repetida o inexistente del
   * cambio estacional sin resolver (`dst_ambiguous` o `dst_nonexistent`, ADR-0013).
   *
   * En la hora repetida de octubre las dos ocurrencias reciben el mismo instante calculado, así que
   * un fichero perfectamente ordenado parece retroceder al pasar de una a otra. Contarlo como
   * inversión acusaría de defecto de integridad a una fuente íntegra; estos pares no aportan evidencia
   * de sentido en ningún sentido y se cuentan aparte. Una hora repetida ya resuelta por la posición
   * en el fichero (`dst_by_position`, OQ-137) tiene instante propio y sí compara.
   */
  readonly unreliablePairs: number;
}

/**
 * Determina el sentido dominante, cuenta las inversiones respecto a él y los instantes empatados.
 *
 * Los instantes iguales no cuentan como evidencia de sentido: a resolución gruesa son la mayoría y
 * no dicen nada sobre cómo emite la fuente.
 */
export function measureMonotonicity(
  utcMs: readonly number[],
  flags: readonly TimeFlag[] = [],
): MonotonicityReport {
  let ascending = 0;
  let descending = 0;
  let tiedPairs = 0;
  let unreliablePairs = 0;

  for (let index = 0; index + 1 < utcMs.length; index += 1) {
    if (!isOrderReliable(flags[index] ?? "ok") || !isOrderReliable(flags[index + 1] ?? "ok")) {
      unreliablePairs += 1;
      continue;
    }
    const current = utcMs[index] as number;
    const next = utcMs[index + 1] as number;
    if (next > current) ascending += 1;
    else if (next < current) descending += 1;
    else tiedPairs += 1;
  }

  const comparedPairs = ascending + descending;
  if (comparedPairs === 0) {
    return { direction: "unknown", inversions: 0, comparedPairs: 0, confidence: 0, tiedPairs, unreliablePairs };
  }

  const direction: SourceDirection = descending >= ascending ? "newest-first" : "oldest-first";
  const inversions = direction === "newest-first" ? ascending : descending;
  return {
    direction,
    inversions,
    comparedPairs,
    confidence: (comparedPairs - inversions) / comparedPairs,
    tiedPairs,
    unreliablePairs,
  };
}
