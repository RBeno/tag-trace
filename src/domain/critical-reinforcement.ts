/**
 * Refuerzos de un punto crítico (R-GRA-016): tags seguidos en el circuito con la misma función.
 *
 * El propietario (2026-09-26): «cuando están seguidos en circuito y tienen la misma función son un
 * refuerzo por si alguna lectura falla». Dos paradas precisas consecutivas no son dos paradas: son
 * la misma parada puesta dos veces, para que el AGV la ejecute aunque falle una lectura. Por eso la
 * omisión de uno de ellos no pierde la función mientras el otro se lea (R-GRA-008): pierde la
 * redundancia.
 *
 * Qué **no** es un refuerzo, y por qué:
 *
 * - **Un cruce o un tramo conflictivo.** En planta, CRUCE es una situación —la zona donde el circuito
 *   se cruza o comparte camino con otros—, no una función, y un tramo conflictivo (una arqueta
 *   metálica bajo la guía) es un tramo: los dos ocupan por naturaleza varios tags seguidos. Agruparlos
 *   como refuerzo diría que sobra la mitad, cuando cada uno cubre su trozo.
 * - **Dos tags seguidos con funciones distintas**, aunque las dos sean paradas: una parada precisa
 *   seguida de una parada no es la misma función repetida.
 * - **La misma función con distinto `grupo`**: cinco cambios de MTC seguidos, uno a cada calle, son
 *   cinco funciones distintas y no un refuerzo de cinco.
 *
 * Qué es «seguidos»: el orden de la lista `circuito`, que es lo que planta declara al poner el
 * refuerzo. El orden leído puede diferir (R-GRA-015), pero el refuerzo es una declaración de planta
 * y se lee de la declaración, como la función misma. El circuito es un anillo: el último y el primero
 * también son seguidos.
 */

export interface ReinforcementGroup {
  /** La función que comparten. */
  readonly funcion: string;
  /** Los tags del grupo, en el orden del circuito: dos o más. */
  readonly tags: readonly string[];
}

/** Funciones que, seguidas, no son un refuerzo: son una zona. */
const NOT_REINFORCEMENT: ReadonlySet<string> = new Set(["cruce", "tramo-conflictivo"]);

/**
 * Agrupa los tags críticos seguidos en el circuito declarado que comparten función.
 *
 * `circuit` es la lista `circuito` ya ordenada. Un tag repetido en ella no se agrupa consigo mismo:
 * se toma cada tag una sola vez, en su primera posición.
 */
export function reinforcementGroups(
  circuit: readonly string[],
  funcionOf: ReadonlyMap<string, string>,
  groupOf: ReadonlyMap<string, string> = new Map(),
): readonly ReinforcementGroup[] {
  const order = [...new Set(circuit)];
  if (order.length < 2) return [];

  const groups: { funcion: string; key: string; tags: string[] }[] = [];
  let current: { funcion: string; key: string; tags: string[] } | null = null;
  for (const tagId of order) {
    const funcion = funcionOf.get(tagId);
    if (funcion === undefined || NOT_REINFORCEMENT.has(funcion)) {
      current = null;
      continue;
    }
    const key = `${funcion}\u0000${groupOf.get(tagId) ?? ""}`;
    if (current !== null && current.key === key) {
      current.tags.push(tagId);
      continue;
    }
    current = { funcion, key, tags: [tagId] };
    groups.push(current);
  }

  // El anillo se cierra: un grupo al final y otro al principio con la misma función son uno solo.
  // Con un único grupo que ya lo ocupa todo no hay nada que unir.
  const first = groups[0];
  const last = groups[groups.length - 1];
  if (
    groups.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first.key === last.key &&
    first.tags[0] === order[0] &&
    last.tags[last.tags.length - 1] === order[order.length - 1]
  ) {
    first.tags.unshift(...last.tags);
    groups.pop();
  }

  return groups.filter((group) => group.tags.length >= 2).map(({ funcion, tags }) => ({ funcion, tags }));
}

/** Por tag, los demás tags de su refuerzo. Un tag sin refuerzo no aparece. */
export function reinforcementPartners(groups: readonly ReinforcementGroup[]): ReadonlyMap<string, readonly string[]> {
  const partners = new Map<string, readonly string[]>();
  for (const group of groups) {
    for (const tagId of group.tags) partners.set(tagId, group.tags.filter((other) => other !== tagId));
  }
  return partners;
}
