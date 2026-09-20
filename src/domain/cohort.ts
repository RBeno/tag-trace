/**
 * Agrupamiento por circuito dentro de una misma exportación (R-DAT-012).
 *
 * Una exportación puede traer varios circuitos bajo un mismo nombre — ya visto en dato real: un
 * informe "ALF" que en realidad eran tres circuitos (Traviesas/Corchos/Alfombras) compartiendo
 * fichero. El cohorte de comparación es el circuito, nunca el fichero: comparar el 2280 contra los
 * quince vehículos de un fichero mezclado dio un falso hallazgo que solo se deshizo agrupando por
 * circuito real.
 *
 * El criterio es **aristas exclusivas**, no el nombre ni el parecido de ruta: dos vehículos van al
 * mismo grupo si comparten al menos una transición observada. Validado contra tres exportaciones
 * reales (incluida la de tres circuitos mezclados) con el mismo algoritmo en `local/tags-criticos.py`.
 */

import type { Transition } from "./graph.js";
import type { Reading } from "./reading.js";

export interface Cohort {
  readonly id: number;
  readonly vehicles: readonly string[];
}

export interface CohortAssignment {
  readonly cohorts: readonly Cohort[];
  readonly cohortOf: ReadonlyMap<string, number>;
}

/** Unión-búsqueda mínima sobre identificadores de texto. */
class UnionFind {
  private readonly parent = new Map<string, string>();

  find(id: string): string {
    let root = id;
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root) as string;
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    if (!this.parent.has(a)) this.parent.set(a, a);
    if (!this.parent.has(b)) this.parent.set(b, b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  ensure(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }
}

/**
 * Agrupa vehículos por las transiciones que comparten.
 *
 * `readings` decide el universo de vehículos —incluidos los que solo tienen una lectura y por
 * tanto ninguna transición—; `transitions` decide quién comparte grupo con quién. Un vehículo sin
 * ninguna transición compartida sale en su propio cohorte de uno: no se compara contra nadie
 * en vez de forzarlo a un grupo ajeno (R-DAT-012, "se declara y se para").
 */
export function assignCohorts(
  readings: readonly Reading[],
  transitions: readonly Transition[],
): CohortAssignment {
  const uf = new UnionFind();
  for (const entry of readings) uf.ensure(entry.agvId);

  // Dos vehículos que alguna vez recorren la MISMA arista (from→to) son del mismo circuito. No
  // hace falta que la compartan a la vez ni con la misma frecuencia: basta con que la arista exista
  // para los dos, que es justo lo que "aristas exclusivas" mide en negativo.
  const firstVehicleByEdge = new Map<string, string>();
  for (const transition of transitions) {
    const key = `${transition.from} ${transition.to}`;
    const seen = firstVehicleByEdge.get(key);
    if (seen === undefined) {
      firstVehicleByEdge.set(key, transition.agvId);
    } else {
      uf.union(seen, transition.agvId);
    }
  }

  const groups = new Map<string, string[]>();
  for (const entry of readings) {
    const root = uf.find(entry.agvId);
    let vehicles = groups.get(root);
    if (vehicles === undefined) {
      vehicles = [];
      groups.set(root, vehicles);
    }
    if (!vehicles.includes(entry.agvId)) vehicles.push(entry.agvId);
  }

  const cohorts: Cohort[] = [...groups.values()]
    .map((vehicles) => vehicles.sort())
    .sort((a, b) => b.length - a.length || (a[0] ?? "").localeCompare(b[0] ?? ""))
    .map((vehicles, id) => ({ id, vehicles }));

  const cohortOf = new Map<string, number>();
  cohorts.forEach((cohort) => {
    for (const agvId of cohort.vehicles) cohortOf.set(agvId, cohort.id);
  });

  return { cohorts, cohortOf };
}
