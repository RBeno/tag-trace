/**
 * Tags que se leen y no están en la lista del circuito: dónde se leen, y si solo de noche (R-DAT-022).
 *
 * El propietario, sobre los tags de la memoria que no están en la lista del circuito:
 *
 * > «Busca su posición y proponlos como candidatos a la posición si ocurre durante todo el día en la
 * > misma posición; si solo ocurre por la noche y aparece en una zona donde no estaba, es posiblemente
 * > un tag de noche; si hay datos y por el día desaparece, no hay duda.»
 *
 * Así que de cada uno se dice:
 *
 * - **dónde se lee**: su predecesor y su sucesor dominantes en la secuencia de cada AGV. Es el sitio
 *   que dan las lecturas; el orden de la lista puede tener erratas y no lo sitúa (R-GRA-015);
 * - **cuándo**: cuántas lecturas de día y cuántas de noche (la ventana de noche de R-TIM-009);
 * - **cuántas veces se pasa por su sitio** —del predecesor al sucesor— de día y de noche, y en cuántas
 *   se lee.
 *
 * Y el veredicto, en las palabras del propietario:
 *
 * - `posicion`: se lee de día en su sitio → candidato a esa posición del circuito. Si la lista pone ahí
 *   un tag sin ninguna lectura, se nombra: o se sustituyó, o su número está mal escrito en la lista.
 * - `noche`: solo se lee de noche, y de día se pasa por su sitio las veces suficientes para que no
 *   leerlo nunca no sea casualidad → tag de noche. Lecturas de día sueltas fuera de su sitio no lo sacan
 *   de aquí mientras de día se pase por su sitio sin leerlo; se dice cuántas tuvo. Una de día en su
 *   sitio sí: lo leído lo sitúa ahí.
 * - `noche-probable`: solo se lee de noche y de día no hay pasadas por su sitio con las que
 *   comprobarlo → posiblemente de noche.
 * - `noche-declarado`: solo se lee de noche y está en la lista `noche`, que el propietario da para
 *   explicar los tags que pueden aparecer de noche (2026-09-26). No hace falta comprobarlo con las
 *   pasadas de día: está declarado. Un tag de esa lista que **sí** se lee de día sigue siendo
 *   `posicion`, y se dice que la lista de noche lo declara: lo leído manda sobre lo declarado.
 *
 * No se nombra causa (R-EVI-006): es dónde y cuándo se lee, con sus cifras.
 */

import { dominant } from "./drift.js";
import type { Reading } from "./reading.js";
import type { Regime } from "./segment-bands.js";

export interface UndeclaredTagThresholds {
  /** Pasadas de día por su sitio, como mínimo, para decir que de día no se lee. */
  readonly minSlotPasses: number;
  /** Probabilidad máxima de que no leerlo de día sea casualidad, dada su tasa de noche. */
  readonly maxChance: number;
  /** Lecturas que caben entre los dos vecinos para que siga contando como paso por el sitio. */
  readonly maxReadsBetween: number;
}

export type UndeclaredVerdict = "posicion" | "noche" | "noche-probable" | "noche-declarado";

export interface UndeclaredTag {
  readonly tagId: string;
  readonly verdict: UndeclaredVerdict;
  /** Está en la lista `noche` de planta. */
  readonly declaredNight: boolean;
  readonly dayReadings: number;
  readonly nightReadings: number;
  readonly predecessor: string | null;
  readonly successor: string | null;
  /** Posición (1…) del vecino en la lista del circuito, si está en ella. */
  readonly predecessorOrder: number | null;
  readonly successorOrder: number | null;
  readonly dayPasses: number;
  readonly dayHits: number;
  readonly nightPasses: number;
  readonly nightHits: number;
  /** Tags de la lista entre los dos vecinos que no tienen ninguna lectura: el sitio que podría ocupar. */
  readonly declaredWithoutReadings: readonly string[];
  readonly evidence: string;
}

export interface UndeclaredTagReport {
  readonly evaluated: boolean;
  readonly reason: string | null;
  readonly tags: readonly UndeclaredTag[];
}

interface Step {
  readonly tagId: string;
  readonly utcMs: number;
}

export interface TagPlace {
  readonly predecessor: string | null;
  readonly successor: string | null;
}

/** Las lecturas de cada AGV en orden de tiempo. */
function vehicleSteps(readings: readonly Reading[]): Map<string, Step[]> {
  const byVehicle = new Map<string, Step[]>();
  for (const entry of readings) {
    let steps = byVehicle.get(entry.agvId);
    if (steps === undefined) {
      steps = [];
      byVehicle.set(entry.agvId, steps);
    }
    steps.push({ tagId: entry.tagId, utcMs: entry.time.utcMs });
  }
  for (const steps of byVehicle.values()) steps.sort((a, b) => a.utcMs - b.utcMs);
  return byVehicle;
}

/** Cuántas veces cada tag de `wanted` va precedido y seguido de cada otro tag, en la secuencia de cada AGV. */
function countNeighbours(
  byVehicle: ReadonlyMap<string, readonly Step[]>,
  wanted: (tagId: string) => boolean,
): { predecessors: Map<string, Map<string, number>>; successors: Map<string, Map<string, number>> } {
  const predecessors = new Map<string, Map<string, number>>();
  const successors = new Map<string, Map<string, number>>();
  for (const steps of byVehicle.values()) {
    for (const [index, step] of steps.entries()) {
      if (!wanted(step.tagId)) continue;
      const before = steps[index - 1];
      const after = steps[index + 1];
      if (before !== undefined && before.tagId !== step.tagId) bump(predecessors, step.tagId, before.tagId);
      if (after !== undefined && after.tagId !== step.tagId) bump(successors, step.tagId, after.tagId);
    }
  }
  return { predecessors, successors };
}

/**
 * Dónde se lee cada tag: su predecesor y su sucesor dominantes en la secuencia de cada AGV. Es el
 * sitio que dan las lecturas, no la lista (R-GRA-015).
 */
export function dominantNeighbours(readings: readonly Reading[], tagIds: ReadonlySet<string>): ReadonlyMap<string, TagPlace> {
  const { predecessors, successors } = countNeighbours(vehicleSteps(readings), (tagId) => tagIds.has(tagId));
  const places = new Map<string, TagPlace>();
  for (const tagId of tagIds) {
    if (!predecessors.has(tagId) && !successors.has(tagId)) continue;
    places.set(tagId, { predecessor: dominant(predecessors.get(tagId)), successor: dominant(successors.get(tagId)) });
  }
  return places;
}

function bump(map: Map<string, Map<string, number>>, key: string, value: string): void {
  let counts = map.get(key);
  if (counts === undefined) {
    counts = new Map();
    map.set(key, counts);
  }
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

/**
 * `declaredOrder` es la lista `circuito` en su orden; `excluded`, los tags que ya tienen su sitio en
 * otra lista (calles, mantenimiento, emergencia) y no se buscan.
 */
export function locateUndeclaredTags(
  readings: readonly Reading[],
  declaredOrder: readonly string[],
  excluded: ReadonlySet<string>,
  regimeOf: (utcMs: number) => Regime,
  thresholds: UndeclaredTagThresholds,
  declaredNight: ReadonlySet<string> = new Set(),
): UndeclaredTagReport {
  if (declaredOrder.length === 0) {
    return { evaluated: false, reason: "No hay lista «circuito» cargada con la que comparar.", tags: [] };
  }
  const declared = new Set(declaredOrder);
  const orderOf = new Map(declaredOrder.map((tagId, index) => [tagId, index + 1]));

  const byVehicle = vehicleSteps(readings);
  const undeclared = (tagId: string): boolean => !declared.has(tagId) && !excluded.has(tagId);

  const readCount = new Map<string, number>();
  const regimeCount = new Map<string, { produccion: number; noche: number }>();
  for (const steps of byVehicle.values()) {
    for (const step of steps) {
      readCount.set(step.tagId, (readCount.get(step.tagId) ?? 0) + 1);
      if (!undeclared(step.tagId)) continue;
      const counts = regimeCount.get(step.tagId) ?? { produccion: 0, noche: 0 };
      counts[regimeOf(step.utcMs)] += 1;
      regimeCount.set(step.tagId, counts);
    }
  }
  const { predecessors, successors } = countNeighbours(byVehicle, undeclared);

  const tags: UndeclaredTag[] = [];
  for (const [tagId, counts] of regimeCount) {
    const predecessor = dominant(predecessors.get(tagId));
    const successor = dominant(successors.get(tagId));

    // Pasadas por su sitio, de día y de noche: el predecesor y, a pocas lecturas, el sucesor.
    let dayPasses = 0;
    let dayHits = 0;
    let nightPasses = 0;
    let nightHits = 0;
    if (predecessor !== null && successor !== null) {
      for (const steps of byVehicle.values()) {
        for (let index = 0; index < steps.length; index += 1) {
          if ((steps[index] as Step).tagId !== predecessor) continue;
          const limit = Math.min(steps.length, index + thresholds.maxReadsBetween + 2);
          for (let next = index + 1; next < limit; next += 1) {
            if ((steps[next] as Step).tagId !== successor) continue;
            const hit = steps.slice(index + 1, next).some((step) => step.tagId === tagId);
            if (regimeOf((steps[index] as Step).utcMs) === "noche") {
              nightPasses += 1;
              if (hit) nightHits += 1;
            } else {
              dayPasses += 1;
              if (hit) dayHits += 1;
            }
            break;
          }
        }
      }
    }

    const isDeclaredNight = declaredNight.has(tagId);
    // Lecturas de día fuera de su sitio —ninguna dentro de una pasada predecesor→sucesor— no lo hacen
    // candidato a la posición: si además de día se pasa por su sitio sin leerlo las veces suficientes
    // (la misma prueba que sin ninguna lectura de día), sigue siendo de noche y se dice cuántas tuvo.
    // Una sola lectura de día **en su sitio** sí manda: lo leído lo sitúa ahí.
    const nightRate = nightPasses === 0 ? 1 : nightHits / nightPasses;
    const dayUnlikely =
      counts.noche > 0 && dayHits === 0 && dayPasses >= thresholds.minSlotPasses && (1 - nightRate) ** dayPasses <= thresholds.maxChance;
    let verdict: UndeclaredVerdict;
    if (counts.produccion > 0 && !dayUnlikely) verdict = "posicion";
    else if (isDeclaredNight) verdict = "noche-declarado";
    else verdict = dayUnlikely ? "noche" : "noche-probable";

    const predecessorOrder = predecessor === null ? null : (orderOf.get(predecessor) ?? null);
    const successorOrder = successor === null ? null : (orderOf.get(successor) ?? null);
    // Lo que la lista pone entre los dos vecinos; la lista es un anillo, así que si el sitio cruza su
    // final (predecesor al final, sucesor al principio) se rebana dando la vuelta.
    const between =
      predecessorOrder === null || successorOrder === null
        ? []
        : successorOrder > predecessorOrder
          ? declaredOrder.slice(predecessorOrder, successorOrder - 1)
          : [...declaredOrder.slice(predecessorOrder), ...declaredOrder.slice(0, successorOrder - 1)];
    const declaredWithoutReadings = between.filter((declaredTag) => (readCount.get(declaredTag) ?? 0) === 0);

    const where =
      predecessor === null || successor === null
        ? "sin un sitio fijo en el recorrido"
        : `entre ${predecessor} y ${successor}`;
    const reads = `${counts.produccion.toLocaleString("es-ES")} lecturas de día y ${counts.noche.toLocaleString("es-ES")} de noche`;
    const passes =
      predecessor === null || successor === null
        ? ""
        : ` Por su sitio se pasa ${dayPasses} veces de día y se lee en ${dayHits}; de noche, ${nightPasses} y ${nightHits}.`;
    const strayDay =
      counts.produccion === 0 ? "" : ` Tuvo ${counts.produccion} ${counts.produccion === 1 ? "lectura" : "lecturas"} de día, ninguna en su sitio.`;
    const evidence =
      verdict === "posicion"
        ? `Se lee ${where}: ${reads}.${passes} Candidato a esa posición del circuito${
            declaredWithoutReadings.length === 0
              ? ""
              : `; la lista pone ahí ${declaredWithoutReadings.join(", ")}, que no se ${declaredWithoutReadings.length === 1 ? "lee" : "leen"}: o se sustituyó, o el número está mal escrito en la lista`
          }.${isDeclaredNight ? " La lista de tags de noche lo declara de noche, y se lee también de día." : ""}`
        : verdict === "noche-declarado"
          ? `Solo se lee de noche, ${where}: ${reads}.${passes} Está en la lista de tags de noche: es un tag de noche declarado.${strayDay}`
          : verdict === "noche"
          ? `Solo se lee de noche, ${where}: ${reads}.${passes} De día se pasa por su sitio y no se lee: tag de noche.${strayDay}`
          : `Solo se lee de noche, ${where}: ${reads}.${passes} De día no hay pasadas suficientes por su sitio para comprobarlo: posiblemente de noche.`;

    tags.push({
      tagId,
      verdict,
      declaredNight: isDeclaredNight,
      dayReadings: counts.produccion,
      nightReadings: counts.noche,
      predecessor,
      successor,
      predecessorOrder,
      successorOrder,
      dayPasses,
      dayHits,
      nightPasses,
      nightHits,
      declaredWithoutReadings,
      evidence,
    });
  }

  tags.sort((a, b) => b.dayReadings + b.nightReadings - (a.dayReadings + a.nightReadings) || a.tagId.localeCompare(b.tagId));
  return { evaluated: true, reason: null, tags };
}
