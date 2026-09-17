/**
 * Orden canónico (ADR-0013).
 *
 * El reloj no siempre basta: cuando la resolución de la fuente es más gruesa que el paso real de un
 * AGV, varias lecturas comparten instante y el desempate lo da la posición en el fichero. Pero esa
 * posición solo significa algo si se conoce el **sentido** de la fuente, y el sentido es una
 * propiedad suya que se mide, no una convención que se elija.
 */

import type { Reading } from "./reading.js";

/**
 * Cómo emite la fuente sus filas.
 *
 * `newest-first` es el caso de una pila: el servidor añade cada lectura según la recibe, así que
 * bajar por el fichero es retroceder en el tiempo.
 */
export type SourceDirection = "newest-first" | "oldest-first" | "unknown";

/**
 * Compara dos lecturas en orden cronológico ascendente.
 *
 * Con `newest-first`, dentro de un mismo instante declarado la fila **posterior** del fichero es la
 * **anterior** cronológicamente, así que el desempate por `sourceRow` se invierte. Equivocar esto
 * reconstruye los tramos al revés sin producir ningún síntoma visible.
 */
export function compareReadings(a: Reading, b: Reading, direction: SourceDirection): number {
  if (a.time.utcMs !== b.time.utcMs) return a.time.utcMs - b.time.utcMs;
  if (a.provenance.sourceHash !== b.provenance.sourceHash) {
    return a.provenance.sourceHash < b.provenance.sourceHash ? -1 : 1;
  }
  const rowDelta = a.provenance.sourceRow - b.provenance.sourceRow;
  return direction === "newest-first" ? -rowDelta : rowDelta;
}

/**
 * Ordena de forma total y determinista. No depende del orden de llegada de los ficheros ni de la
 * estabilidad del `sort` del motor, porque el comparador nunca devuelve cero para filas distintas.
 */
export function sortReadings(readings: Reading[], direction: SourceDirection): Reading[] {
  return readings.sort((a, b) => compareReadings(a, b, direction));
}
