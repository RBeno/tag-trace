/**
 * Lecturas consecutivas **del mismo vehículo** en el mismo instante (R-DAT-013).
 *
 * Esta es la medida que importa para la topología, y no hay que confundirla con la del fichero.
 * Dos AGV distintos leyendo en el mismo segundo es lo normal y no dice nada; lo que hace daño es
 * que sean dos lecturas del mismo vehículo, porque entonces el reloj no decide cuál fue antes y el
 * orden lo pone la posición en la pila, que es `inferred` (ADR-0013).
 *
 * La consecuencia es concreta: una arista construida sobre uno de esos pares aparece en las dos
 * direcciones según la pasada, y la minoritaria simula un desvío que nunca ocurrió. Medido sobre
 * una exportación real, contar el fichero entero da un 39 % y contar por vehículo un 3 %: la
 * primera cifra es cierta y responde a otra pregunta.
 */

import type { Reading } from "../domain/reading.js";

export interface SameInstantReport {
  /** Pares consecutivos del mismo vehículo que comparten instante. */
  readonly pairs: number;
  /** Pares consecutivos del mismo vehículo en total, para dar peso al anterior. */
  readonly vehiclePairs: number;
}

/**
 * Cuenta los pares empatados por vehículo.
 *
 * Espera las lecturas **ya ordenadas** por el sentido detectado de la fuente: solo así dos lecturas
 * consecutivas de un vehículo son realmente consecutivas.
 */
export function measureSameInstant(readings: readonly Reading[]): SameInstantReport {
  const lastByVehicle = new Map<string, number>();
  let pairs = 0;
  let vehiclePairs = 0;

  for (const entry of readings) {
    const previous = lastByVehicle.get(entry.agvId);
    if (previous !== undefined) {
      vehiclePairs += 1;
      if (previous === entry.time.utcMs) pairs += 1;
    }
    lastByVehicle.set(entry.agvId, entry.time.utcMs);
  }

  return { pairs, vehiclePairs };
}
