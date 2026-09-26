/**
 * Cobertura de un circuito (R-DAT-007).
 *
 * La fuente no es un histórico consultable por rango: es una ventana deslizante que se muestrea de
 * vez en cuando. Así que **fuera de lo cargado no hay silencio, hay ausencia de datos**, y son
 * cosas distintas: confundirlas es exactamente el falso diagnóstico que este producto existe para
 * evitar —«nadie exportó a tiempo» presentado como «los AGV dejaron de emitir»—.
 *
 * `sin datos cargados` tampoco es `unknown`: `unknown` significa que hubo evidencia y no alcanza
 * para decidir; esto significa que nunca hubo evidencia.
 */

import type { Reading } from "./reading.js";

export interface Interval {
  readonly from: number;
  readonly to: number;
}

export interface SourceCoverage {
  /** El tramo que se puede analizar: hasta el último instante **completo**. */
  readonly complete: Interval | null;
  /**
   * La cola cortada, si la hay.
   *
   * El último instante de una exportación es el momento en que se pulsó el botón, así que casi
   * nunca está entero: faltan las lecturas de ese mismo segundo que aún no habían llegado. No se
   * tira —las lecturas siguen siendo evidencia— pero no cuenta como cobertura, porque una ausencia
   * ahí no significa nada.
   */
  readonly partialFrom: number | null;
}

/**
 * Cobertura de una fuente a partir de sus lecturas aceptadas.
 *
 * El corte se sitúa en el penúltimo instante distinto, no restando una resolución supuesta: así no
 * hace falta adivinar si la fuente va en segundos o en minutos, que es justo lo que varía entre dos
 * exportaciones de la misma planta.
 */
export function sourceCoverage(readings: readonly Reading[]): SourceCoverage {
  if (readings.length === 0) return { complete: null, partialFrom: null };

  let min = Infinity;
  let max = -Infinity;
  let secondMax = -Infinity;
  for (const entry of readings) {
    const instant = entry.time.utcMs;
    if (instant < min) min = instant;
    if (instant > max) {
      secondMax = max;
      max = instant;
    } else if (instant < max && instant > secondMax) {
      secondMax = instant;
    }
  }

  // Un solo instante distinto: no hay ningún tramo del que se pueda decir que está completo.
  if (secondMax === -Infinity) return { complete: null, partialFrom: min };
  return { complete: { from: min, to: secondMax }, partialFrom: max };
}

/** Une intervalos solapados o contiguos, en orden. Lo que queda entre ellos no está cubierto. */
export function mergeIntervals(intervals: readonly Interval[]): readonly Interval[] {
  const sorted = [...intervals].sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.from <= last.to) {
      if (interval.to > last.to) merged[merged.length - 1] = { from: last.from, to: interval.to };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** ¿Este instante cae dentro de lo cargado? Si no, no se analiza y no es una parada. */
export function isCovered(coverage: readonly Interval[], utcMs: number): boolean {
  return coverage.some((interval) => utcMs >= interval.from && utcMs <= interval.to);
}

/**
 * ¿Caen los dos instantes dentro del **mismo** tramo de cobertura?
 *
 * Es la condición para que dos lecturas consecutivas de un vehículo sean una transición o formen
 * parte de una misma vuelta. Preguntar solo si «encierran un hueco entero» no basta: la cola
 * cortada de una exportación queda fuera de su tramo `complete` y por tanto dentro del hueco, así
 * que una lectura de esa cola emparejaba con la primera de la ventana siguiente y fabricaba una
 * arista con semanas de tramo, justo lo que R-DAT-007 prohíbe. Con esta regla la cola no
 * participa en ninguna transición: fuera de la cobertura no se analiza.
 *
 * Sin cobertura declarada (`coverage` vacío) no hay con qué juzgar y se admite todo: es el caso de
 * una fuente suelta sin circuito todavía, no una excepción a la regla.
 */
export function sameSpan(coverage: readonly Interval[], a: number, b: number): boolean {
  if (coverage.length === 0) return true;
  return coverage.some(
    (interval) => a >= interval.from && a <= interval.to && b >= interval.from && b <= interval.to,
  );
}

/**
 * Los huecos entre intervalos cubiertos.
 *
 * Son `sin datos cargados`, y se devuelven para poder **dibujarlos distintos** de un silencio, no
 * para diagnosticarlos. Un hueco de esta lista nunca es un hallazgo.
 */
export function uncoveredGaps(coverage: readonly Interval[]): readonly Interval[] {
  const gaps: Interval[] = [];
  for (let index = 1; index < coverage.length; index += 1) {
    const previous = coverage[index - 1] as Interval;
    const current = coverage[index] as Interval;
    gaps.push({ from: previous.to, to: current.from });
  }
  return gaps;
}
