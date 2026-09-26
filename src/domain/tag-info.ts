/**
 * Lo que planta declara de cada tag, como información para acompañar sus incidencias.
 *
 * El propietario: «la función puede quedar guardada como información: cuando hay alguna incidencia
 * en un tag, indicar su función aporta para su diagnóstico». Una lectura que cae, un tag que deja de
 * leerse o una zona oscura se miran de otra manera si ese tag es una parada condicionada, un giro o
 * un control de WiFi. Por eso se junta aquí todo lo que las listas dicen de cada tag —su nota, su
 * función, su calle— y la vista lo enseña al lado.
 *
 * **Es información y no cambia ningún cálculo**: una función que no está en la taxonomía (R-GRA-007)
 * no se convierte en regla por estar escrita. Se enseña tal cual se declaró.
 */

export interface DeclaredEntry {
  readonly tagId: string;
  readonly funcion: string;
  readonly grupo: string;
  readonly note: string;
}

export interface DeclaredList {
  readonly list: string;
  readonly entries?: readonly DeclaredEntry[];
}

/**
 * Por tag, lo declarado en las listas, sin repetir: la nota tal cual, la función, la calle y con qué
 * tags forma refuerzo (R-GRA-016). Se
 * compara pieza a pieza (lo separado por « · »): la misma palabra puede venir en la nota del circuito
 * y en la de la zona, y no se enseña dos veces.
 */
export function declaredTagInfo(
  lists: readonly DeclaredList[],
  reinforcement: ReadonlyMap<string, readonly string[]> = new Map(),
): ReadonlyMap<string, string> {
  const parts = new Map<string, string[]>();
  const add = (tagId: string, text: string): void => {
    for (const piece of text.split(" · ")) {
      const clean = piece.trim();
      if (clean === "") continue;
      const list = parts.get(tagId) ?? [];
      if (!list.some((part) => part.toLowerCase() === clean.toLowerCase())) list.push(clean);
      parts.set(tagId, list);
    }
  };
  for (const { list, entries } of lists) {
    for (const entry of entries ?? []) {
      add(entry.tagId, entry.note);
      if (list === "carga-online") add(entry.tagId, `${entry.grupo}${entry.funcion === "" ? "" : ` (${entry.funcion})`}`);
      else if ((list === "critico" || list === "circuito") && entry.funcion !== "")
        add(entry.tagId, `${entry.funcion}${entry.grupo === "" ? "" : ` (${entry.grupo})`}`);
      else if (list === "noche") add(entry.tagId, "tag de noche declarado");
      else if (list === "tramo" && entry.grupo !== "") add(entry.tagId, `tramo ${entry.grupo}`);
    }
  }
  // El refuerzo (R-GRA-016) va detrás de la función: una incidencia en un tag reforzado se lee
  // distinta si el otro tag del refuerzo sigue leyéndose.
  for (const [tagId, partners] of reinforcement) add(tagId, `refuerzo con ${partners.join(", ")}`);
  return new Map([...parts].map(([tagId, texts]) => [tagId, texts.join(" · ")]));
}

/**
 * El tramo de cada tag para las gráficas (kitting, línea, cruce…): la lista `tramo` y, para lo que no
 * declare, la lista `linea` como «línea» y los críticos `cruce` como «cruce». Solo se dibuja.
 */
export function tagSections(
  lists: readonly DeclaredList[],
  funcionOf: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const sections = new Map<string, string>();
  for (const { list, entries } of lists) {
    if (list !== "tramo") continue;
    for (const entry of entries ?? []) if (entry.grupo !== "" && !sections.has(entry.tagId)) sections.set(entry.tagId, entry.grupo);
  }
  for (const { list, entries } of lists) {
    if (list !== "linea") continue;
    for (const entry of entries ?? []) if (!sections.has(entry.tagId)) sections.set(entry.tagId, "línea");
  }
  for (const [tagId, funcion] of funcionOf) if (funcion === "cruce" && !sections.has(tagId)) sections.set(tagId, "cruce");
  return sections;
}
