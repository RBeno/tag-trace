/**
 * Agrupamiento por circuito dentro de una misma exportación (R-DAT-012).
 *
 * Una exportación puede traer varios circuitos bajo un mismo nombre — ya visto en dato real: un
 * informe que en realidad eran tres circuitos compartiendo fichero. El cohorte de comparación es el
 * circuito, nunca el fichero: comparar un vehículo contra los quince de un fichero mezclado dio un
 * falso hallazgo que solo se deshizo agrupando por circuito real.
 *
 * **Compartir una transición no basta**: tres circuitos que comparten un tramo recorren las mismas
 * aristas en ese tramo, y unir a dos vehículos en cuanto comparten una sola los juntaba en uno (así
 * salió con dato real, CHANGELOG [3.30.1]). El criterio es el que se validó a mano contra tres
 * exportaciones reales (`local/tags-criticos.py`, `grupos_de_circuito`):
 *
 * 1. **Parecido de tags.** Del vehículo con más tags al que menos, cada uno entra en el primer grupo
 *    cuyo primer vehículo comparte con él al menos `sameCircuitSimilarity` de sus tags (Jaccard). Si
 *    no, abre grupo.
 * 2. **Lo propio.** Un grupo es **firme** —un circuito— si tiene al menos `minExclusiveEdges`
 *    aristas que recorren todos sus vehículos y ningún vehículo de fuera, **y** al menos `minOwnTags`
 *    tags que no lee nadie de fuera. Las aristas solas no bastan: un vehículo que se salta tags hace
 *    saltos que nadie más hace, y con dato real uno así salía como circuito propio sin un solo tag
 *    que no leyeran los demás. Un grupo sin lo propio —un vehículo que solo se vio en parte del
 *    recorrido, uno que lee mal o uno que apenas leyó— no es un circuito por sí mismo.
 * 3. **Los grupos débiles** se suman al grupo firme que contiene más de sus tags, si lo contiene en
 *    al menos `sameCircuitSimilarity`. Si no, se quedan aparte: un vehículo que no se parece a nadie
 *    no se compara contra nadie en vez de forzarlo a un grupo ajeno («se declara y se para»). Sin
 *    ningún grupo firme, el mayor hace de firme.
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

export interface CohortThresholds {
  /** Parte de los tags que dos vehículos comparten (Jaccard) para ir al mismo circuito, y parte de
   *  los tags de un grupo débil que un grupo firme tiene que contener para absorberlo. */
  readonly sameCircuitSimilarity: number;
  /** Aristas propias —de todos sus vehículos y de nadie más— para que un grupo sea un circuito. */
  readonly minExclusiveEdges: number;
  /** Tags que solo leen los vehículos del grupo, para que sea un circuito. */
  readonly minOwnTags: number;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const tag of a) if (b.has(tag)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Parte de `part` que está en `whole`. */
function containment(part: ReadonlySet<string>, whole: ReadonlySet<string>): number {
  if (part.size === 0) return 0;
  let inside = 0;
  for (const tag of part) if (whole.has(tag)) inside += 1;
  return inside / part.size;
}

/**
 * Agrupa vehículos por circuito.
 *
 * `readings` decide el universo de vehículos y sus tags —incluidos los que solo tienen una lectura
 * y por tanto ninguna transición—; `transitions`, las aristas de cada uno.
 */
export function assignCohorts(
  readings: readonly Reading[],
  transitions: readonly Transition[],
  thresholds: CohortThresholds,
): CohortAssignment {
  const tagsOf = new Map<string, Set<string>>();
  for (const entry of readings) {
    let tags = tagsOf.get(entry.agvId);
    if (tags === undefined) {
      tags = new Set();
      tagsOf.set(entry.agvId, tags);
    }
    tags.add(entry.tagId);
  }
  const edgesOf = new Map<string, Set<string>>();
  const vehiclesByEdge = new Map<string, number>();
  for (const transition of transitions) {
    const edge = `${transition.from} ${transition.to}`;
    let edges = edgesOf.get(transition.agvId);
    if (edges === undefined) {
      edges = new Set();
      edgesOf.set(transition.agvId, edges);
    }
    if (edges.has(edge)) continue;
    edges.add(edge);
    vehiclesByEdge.set(edge, (vehiclesByEdge.get(edge) ?? 0) + 1);
  }
  const readersByTag = new Map<string, number>();
  for (const tags of tagsOf.values()) for (const tag of tags) readersByTag.set(tag, (readersByTag.get(tag) ?? 0) + 1);
  const noEdges = new Set<string>();
  const edgesOfVehicle = (agvId: string): ReadonlySet<string> => edgesOf.get(agvId) ?? noEdges;

  // 1. Parecido de tags, del vehículo con más tags al que menos.
  const vehicles = [...tagsOf.keys()].sort(
    (a, b) => (tagsOf.get(b)?.size ?? 0) - (tagsOf.get(a)?.size ?? 0) || a.localeCompare(b),
  );
  const groups: string[][] = [];
  for (const agvId of vehicles) {
    const tags = tagsOf.get(agvId) as Set<string>;
    const group = groups.find((members) => jaccard(tags, tagsOf.get(members[0] as string) as Set<string>) >= thresholds.sameCircuitSimilarity);
    if (group === undefined) groups.push([agvId]);
    else group.push(agvId);
  }

  // 2. Lo propio: aristas de todos sus vehículos y de ningún otro, y tags que no lee nadie de fuera.
  const exclusiveEdges = (members: readonly string[]): number => {
    let count = 0;
    for (const edge of edgesOfVehicle(members[0] as string)) {
      if (vehiclesByEdge.get(edge) === members.length && members.every((agvId) => edgesOfVehicle(agvId).has(edge))) count += 1;
    }
    return count;
  };
  const tagsOfGroup = (members: readonly string[]): Set<string> => new Set(members.flatMap((agvId) => [...(tagsOf.get(agvId) ?? [])]));
  const ownTags = (members: readonly string[]): number => {
    let count = 0;
    for (const tag of tagsOfGroup(members)) {
      const inside = members.filter((agvId) => tagsOf.get(agvId)?.has(tag) === true).length;
      if (readersByTag.get(tag) === inside) count += 1;
    }
    return count;
  };
  groups.sort((a, b) => b.length - a.length || (a[0] as string).localeCompare(b[0] as string));
  const firm: string[][] = [];
  const weak: string[][] = [];
  for (const members of groups) {
    const own = exclusiveEdges(members) >= thresholds.minExclusiveEdges && ownTags(members) >= thresholds.minOwnTags;
    (own ? firm : weak).push(members);
  }

  // 3. Los débiles, al firme que más contiene de sus tags; si ninguno lo contiene, aparte.
  if (firm.length === 0 && weak.length > 0) firm.push(weak.shift() as string[]);
  const firmTags = firm.map(tagsOfGroup);
  const alone: string[][] = [];
  for (const members of weak) {
    const tags = tagsOfGroup(members);
    let best = -1;
    let bestShare = 0;
    firmTags.forEach((union, index) => {
      const share = containment(tags, union);
      if (share > bestShare) {
        best = index;
        bestShare = share;
      }
    });
    if (best >= 0 && bestShare >= thresholds.sameCircuitSimilarity) (firm[best] as string[]).push(...members);
    else alone.push(members);
  }

  const cohorts: Cohort[] = [...firm, ...alone]
    .map((members) => [...members].sort())
    .sort((a, b) => b.length - a.length || (a[0] ?? "").localeCompare(b[0] ?? ""))
    .map((members, id) => ({ id, vehicles: members }));

  const cohortOf = new Map<string, number>();
  for (const cohort of cohorts) {
    for (const agvId of cohort.vehicles) cohortOf.set(agvId, cohort.id);
  }
  return { cohorts, cohortOf };
}
