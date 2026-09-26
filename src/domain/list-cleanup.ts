/**
 * Limpieza de la lista del circuito (R-GRA-017): lo que la lista declara y el circuito físico no
 * confirma, para ordenarla.
 *
 * El propietario (2026-09-26): «cuando se haga el análisis del circuito se verá cuáles de esos tags
 * no están en el circuito físico; ese también es un dato de limpieza y orden: marcar tags que no están
 * en el físico para comprobar su función, por si hay que colocar una copia o eliminarlos de Vsystem.
 * También el orden es importante: qué tags no tienen la misma posición en virtual que en físico». Y de
 * los refuerzos: «no puede haber tanto refuerzo».
 *
 * Así que, sobre el orden del circuito según las lecturas (R-GRA-015), se juntan tres cosas:
 *
 * - **Declarados que no están en el físico**: la lista los tiene y ningún AGV los lee. Primero los
 *   críticos, con su función, porque son los que hay que comprobar en planta: colocar una copia o
 *   eliminarlos de Vsystem. Es `unknown` (R-DAT-016): no leerlo no dice si falta o si falla.
 * - **Declarados en otra posición**: donde la lista y las lecturas no coinciden, con las dos
 *   posiciones. Manda lo leído.
 * - **Refuerzos declarados, contra el físico**: un refuerzo sale de la lista (R-GRA-016) y aquí se
 *   comprueba. `comprobado` si todos sus tags se leen y están seguidos en el recorrido; `incompleto` si
 *   alguno no se lee; `separado` si se leen todos pero no seguidos. «Seguidos» se mide con el vecino
 *   leído de cada tag —su predecesor o su sucesor dominante en la secuencia de los AGV— y no con el
 *   anillo dominante: un tag poco leído queda fuera del anillo aunque los AGV lo lean justo antes que
 *   su pareja, y ahí el anillo diría «separado» de un refuerzo que está en su sitio. Solo el comprobado es un refuerzo
 *   en el suelo; los otros dos son limpieza de la lista.
 *
 * Nada de esto decide: son preguntas para planta, con su evidencia.
 */

import type { CircuitOrder } from "./circuit-order.js";
import type { ReinforcementGroup } from "./critical-reinforcement.js";
import type { TagPlace } from "./undeclared-tags.js";

export interface NotPhysicalTag {
  readonly tagId: string;
  readonly listPosition: number;
  readonly listBetween: string | null;
  /** Función crítica declarada, o `null`. */
  readonly funcion: string | null;
  /** Tags de su refuerzo que sí se leen. */
  readonly readPartners: readonly string[];
  readonly action: string;
}

export interface MovedTag {
  readonly tagId: string;
  readonly listPosition: number;
  readonly position: number;
  readonly listBetween: string | null;
  readonly readBetween: string | null;
  readonly funcion: string | null;
}

export type ReinforcementStatus = "comprobado" | "incompleto" | "separado";

export interface ReinforcementCheck {
  readonly funcion: string;
  readonly tags: readonly string[];
  readonly status: ReinforcementStatus;
  /** Los tags del refuerzo que no se leen. */
  readonly missing: readonly string[];
  readonly detail: string;
}

export interface ListCleanup {
  readonly notPhysical: readonly NotPhysicalTag[];
  readonly moved: readonly MovedTag[];
  readonly reinforcements: readonly ReinforcementCheck[];
}

/** Si las posiciones ocupan un tramo seguido del anillo de `ringSize` posiciones (1…n), dando la vuelta. */
function contiguousOnRing(positions: readonly number[], ringSize: number): boolean {
  const set = new Set(positions);
  if (set.size !== positions.length || ringSize === 0) return false;
  return positions.some((start) =>
    positions.every((_, offset) => set.has(((start - 1 + offset) % ringSize) + 1)),
  );
}

export function buildListCleanup(
  order: CircuitOrder,
  funcionOf: ReadonlyMap<string, string>,
  groups: readonly ReinforcementGroup[],
  /** El vecino leído de cada tag de los refuerzos (`dominantNeighbours`). Sin él, se usa el anillo. */
  placeOf?: ReadonlyMap<string, TagPlace>,
): ListCleanup {
  const rowOf = new Map(order.rows.map((row) => [row.tagId, row]));
  const isRead = (tagId: string): boolean => {
    const reading = rowOf.get(tagId)?.reading;
    return reading === "leido" || reading === "fuera-del-recorrido";
  };
  const partnersOf = new Map<string, readonly string[]>();
  for (const group of groups) {
    for (const tagId of group.tags) partnersOf.set(tagId, group.tags.filter((other) => other !== tagId));
  }

  const notPhysical: NotPhysicalTag[] = [];
  const moved: MovedTag[] = [];
  for (const row of order.rows) {
    if (row.listPosition === null) continue;
    const funcion = funcionOf.get(row.tagId) ?? null;
    if (row.change === "sin-lecturas") {
      const readPartners = (partnersOf.get(row.tagId) ?? []).filter(isRead);
      notPhysical.push({
        tagId: row.tagId,
        listPosition: row.listPosition,
        listBetween: row.listBetween,
        funcion,
        readPartners,
        action:
          funcion === null
            ? "Comprobar si está en el suelo: si no está, eliminarlo de Vsystem"
            : readPartners.length > 0
              ? `Comprobar en planta: su refuerzo ${readPartners.join(", ")} sostiene la función. Colocar una copia si falta, o eliminarlo de Vsystem si sobra`
              : "Comprobar su función en planta: colocar una copia si falta, o eliminarlo de Vsystem si sobra",
      });
    } else if (row.change === "otro-sitio") {
      // Solo `otro-sitio`: un declarado leído fuera del recorrido principal no tiene otra posición en
      // el anillo, y un tag poco leído puede quedar ahí sin estar cambiado de sitio.
      moved.push({
        tagId: row.tagId,
        listPosition: row.listPosition,
        position: row.position,
        listBetween: row.listBetween,
        readBetween: row.readBetween,
        funcion,
      });
    }
  }
  // Los críticos primero: son los que llevan una función que puede perderse.
  notPhysical.sort((a, b) => Number(a.funcion === null) - Number(b.funcion === null) || a.listPosition - b.listPosition);

  // Seguidos se mide en el anillo leído solo: el orden completo intercala lo declarado sin lecturas y
  // lo leído fuera del recorrido, que no separan a dos tags que los AGV leen uno detrás de otro.
  const ring = [...order.rows].filter((row) => row.reading === "leido").sort((a, b) => a.position - b.position);
  const ringIndex = new Map(ring.map((row, index) => [row.tagId, index + 1]));
  const ringSize = ring.length;
  const reinforcements = groups.map((group): ReinforcementCheck => {
    const missing = group.tags.filter((tagId) => !isRead(tagId));
    if (missing.length > 0) {
      return {
        funcion: group.funcion,
        tags: group.tags,
        status: "incompleto",
        missing,
        detail: `${missing.join(", ")} no ${missing.length === 1 ? "se lee" : "se leen"}: el refuerzo no está entero en el físico.`,
      };
    }
    const positions = group.tags.map((tagId) => rowOf.get(tagId)?.position ?? 0);
    const next = (a: string, b: string): boolean =>
      placeOf?.get(a)?.successor === b || placeOf?.get(b)?.predecessor === a;
    // Si a algún tag del refuerzo le falta el vecino leído (se lee, pero no en los AGV con que se
    // midió el sitio), no se puede decir «separado» por eso: se cae al criterio del anillo.
    const byRing = placeOf === undefined || group.tags.some((tagId) => !placeOf.has(tagId));
    const together =
      byRing
        ? group.tags.every((tagId) => ringIndex.has(tagId)) &&
          contiguousOnRing(group.tags.map((tagId) => ringIndex.get(tagId) ?? 0), ringSize)
        : group.tags.slice(1).every((tagId, index) => {
            const previous = group.tags[index] as string;
            // En cualquier sentido: la lista puede escribir la pareja al revés que el recorrido.
            return next(previous, tagId) || next(tagId, previous);
          });
    if (together) {
      return {
        funcion: group.funcion,
        tags: group.tags,
        status: "comprobado",
        missing: [],
        detail:
          byRing
            ? `Seguidos en el recorrido (posiciones ${positions.join(", ")}).`
            : `Los AGV los leen uno detrás de otro (posiciones ${positions.join(", ")}).`,
      };
    }
    return {
      funcion: group.funcion,
      tags: group.tags,
      status: "separado",
      missing: [],
      detail: `Se leen todos, pero no seguidos en el recorrido (posiciones ${positions.join(", ")}).`,
    };
  });

  return { notPhysical, moved, reinforcements };
}

/** La limpieza en CSV, con `;` y una fila por tag o refuerzo, para llevarla a planta. */
export function listCleanupCsv(cleanup: ListCleanup): string {
  const lines = ["apartado;tag;funcion;posicion_lista;posicion_lecturas;segun_la_lista;segun_las_lecturas;estado;accion"];
  const cell = (value: string | number | null): string => (value === null ? "" : String(value).replace(/;/g, ","));
  for (const tag of cleanup.notPhysical) {
    lines.push(
      ["no está en el físico", tag.tagId, tag.funcion, tag.listPosition, null, tag.listBetween, null, "sin lecturas", tag.action]
        .map(cell)
        .join(";"),
    );
  }
  for (const tag of cleanup.moved) {
    lines.push(
      ["otra posición", tag.tagId, tag.funcion, tag.listPosition, tag.position, tag.listBetween, tag.readBetween, "otro sitio", "Corregir su posición en la lista"]
        .map(cell)
        .join(";"),
    );
  }
  for (const group of cleanup.reinforcements) {
    lines.push(
      ["refuerzo", group.tags.join(" + "), group.funcion, null, null, null, null, group.status, group.detail].map(cell).join(";"),
    );
  }
  return lines.join("\r\n");
}
