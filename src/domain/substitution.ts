/**
 * Un tag que sustituye a otro hereda por defecto lo que se declaró del sustituido (R-GRA-023,
 * propietario, 2026-10-19: «se han solucionado ciertos fallos sustituyendo tags que pasan a por
 * defecto tener las mismas funciones que el sustituido»).
 *
 * - **Solo la sustitución confirmada hereda.** La confirma una persona en el plano del circuito
 *   (evento `sustituir`, ADR-0016, R-GRA-020): es la única vía por la que una decisión humana cambia
 *   el modelo con que se analiza. Un cambio de tag detectado en las lecturas (`tag-changes.ts`) es una
 *   hipótesis: se enseña lo que **heredaría**, y no se aplica (nunca se sustituye `unknown` por la
 *   hipótesis más probable). La revisión en campo tampoco hereda: marcar una tarjeta no cambia ninguna
 *   cifra (`review.ts`).
 * - **Lo declarado del nuevo manda.** Si el nuevo ya está en una lista, esa lista no le hereda nada:
 *   la herencia es un valor por defecto, no una corrección de lo que planta escribió.
 * - **Se hereda fila a fila, con su procedencia.** Cada fila heredada es la del sustituido con el tag
 *   nuevo y una nota que dice de quién viene; el sustituido conserva las suyas, que siguen explicando
 *   su periodo.
 */

/** Una sustitución entre dos tags: confirmada en el plano o detectada en las lecturas. */
export interface Substitution {
  readonly oldTagId: string;
  readonly newTagId: string;
  readonly status: "confirmada" | "detectada";
  /** Cuándo: la fecha efectiva del plano o la primera lectura del nuevo. */
  readonly at: number | null;
  /** La ubicación del plano, si es confirmada. */
  readonly locationId: string | null;
}

/** Lo mínimo de una lista para heredar: su nombre, sus tags y sus filas. */
export interface InheritableList<E extends { readonly tagId: string; readonly note: string }> {
  readonly list: string;
  readonly tags: readonly string[];
  readonly entries?: readonly E[];
}

/** Lo que un tag nuevo hereda (o heredaría) de una lista. */
export interface InheritedRole {
  readonly oldTagId: string;
  readonly newTagId: string;
  readonly list: string;
  readonly funcion: string;
  readonly grupo: string;
  readonly status: Substitution["status"];
}

/**
 * Las sustituciones del plano: cada par seguido de la historia de una ubicación (`PlanLocation.history`).
 * Una ubicación que pasa por A, B y C da A→B y B→C; la herencia se encadena en ese orden.
 */
export function confirmedSubstitutions(
  locations: readonly { readonly locationId: string; readonly history: readonly { readonly tagId: string; readonly from: number; readonly to: number | null }[] }[],
): readonly Substitution[] {
  const out: Substitution[] = [];
  for (const location of locations) {
    for (let index = 1; index < location.history.length; index += 1) {
      const before = location.history[index - 1];
      const after = location.history[index];
      if (before === undefined || after === undefined || before.tagId === after.tagId) continue;
      out.push({ oldTagId: before.tagId, newTagId: after.tagId, status: "confirmada", at: after.from, locationId: location.locationId });
    }
  }
  return out.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.oldTagId.localeCompare(b.oldTagId));
}

/**
 * Junta las confirmadas con las detectadas: una detectada que el plano ya confirmó (mismo par) no se
 * repite. Las detectadas van después, sin fecha de plano.
 */
export function mergeSubstitutions(confirmed: readonly Substitution[], detected: readonly { readonly oldTagId: string; readonly newTagId: string; readonly at: number | null }[]): readonly Substitution[] {
  const seen = new Set(confirmed.map((entry) => `${entry.oldTagId}\u0000${entry.newTagId}`));
  const extra: Substitution[] = [];
  for (const entry of detected) {
    const key = `${entry.oldTagId}\u0000${entry.newTagId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push({ oldTagId: entry.oldTagId, newTagId: entry.newTagId, status: "detectada", at: entry.at, locationId: null });
  }
  return [...confirmed, ...extra];
}

/**
 * Aplica la herencia de las sustituciones **confirmadas** a las listas y dice lo que heredaría cada
 * detectada. Las listas devueltas son las de entrada con las filas heredadas añadidas al final; una
 * lista sin filas (`entries` ausente, circuitos anteriores a la versión 3) hereda solo la pertenencia.
 * Puro y determinista: el mismo orden de sustituciones da las mismas listas.
 */
export function inheritRoles<E extends { readonly tagId: string; readonly note: string; readonly funcion?: string; readonly grupo?: string }, L extends InheritableList<E>>(
  lists: readonly L[],
  substitutions: readonly Substitution[],
): { readonly lists: readonly L[]; readonly roles: readonly InheritedRole[] } {
  const roles: InheritedRole[] = [];
  // Se trabaja sobre copias mutables para que una cadena A→B→C herede de A en C a través de B.
  const working = lists.map((list) => ({ list, tags: [...list.tags], entries: list.entries === undefined ? undefined : [...list.entries] }));
  for (const substitution of substitutions) {
    for (const item of working) {
      if (!item.tags.includes(substitution.oldTagId) || item.tags.includes(substitution.newTagId)) continue;
      const rows = (item.entries ?? []).filter((entry) => entry.tagId === substitution.oldTagId);
      const described = rows.length === 0 ? [{ funcion: "", grupo: "" }] : rows.map((row) => ({ funcion: row.funcion ?? "", grupo: row.grupo ?? "" }));
      for (const row of described) {
        roles.push({ oldTagId: substitution.oldTagId, newTagId: substitution.newTagId, list: item.list.list, funcion: row.funcion, grupo: row.grupo, status: substitution.status });
      }
      if (substitution.status !== "confirmada") continue;
      item.tags.push(substitution.newTagId);
      if (item.entries !== undefined) {
        for (const row of rows) {
          const note = `heredado de ${substitution.oldTagId}${row.note === "" ? "" : `; ${row.note}`}`;
          item.entries.push({ ...row, tagId: substitution.newTagId, note });
        }
      }
    }
  }
  const out = working.map((item) =>
    item.tags.length === item.list.tags.length
      ? item.list
      : ({ ...item.list, tags: item.tags, ...(item.entries === undefined ? {} : { entries: item.entries }) } as L),
  );
  return { lists: out, roles };
}

/** Lo heredado en palabras: «crítico: parada-precisa; área: montaje llenos 2». Puro. */
export function roleText(role: Pick<InheritedRole, "list" | "funcion" | "grupo">): string {
  const detail = [role.funcion, role.grupo].filter((value) => value !== "").join(", ");
  return detail === "" ? role.list : `${role.list}: ${detail}`;
}
