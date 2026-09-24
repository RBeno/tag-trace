/**
 * Afinidad de una fuente con el circuito activo (FR-003, R-DAT-006, ALG-003).
 *
 * Existe para impedir un error que no avisa: cargar en PC2 la exportación de otro circuito. El
 * fichero se importa sin una sola queja —las columnas son las mismas, las fechas también—, y a
 * partir de ahí el circuito queda con tags que no son suyos, una cobertura que mezcla dos sitios y
 * un grafo con dos anillos superpuestos. Nada de eso produce un mensaje de error; produce
 * conclusiones equivocadas meses después.
 *
 * El criterio es el solape de identificadores, porque es lo único que distingue a dos circuitos sin
 * conocer la planta: un tag pertenece a un circuito. Se mide contra **los tags de la fuente**, no
 * contra los del circuito: una exportación corta de PC2 trae pocos tags y todos suyos, y dividir
 * entre el catálogo del circuito la haría parecer ajena.
 *
 * Lo que este módulo no hace: **no rechaza la importación**. FR-003 separa las dos cosas — una
 * fuente sospechosa se analiza, y lo que se le niega es consolidarse. Ver el contenido de un
 * fichero dudoso es justamente cómo se averigua si lo es.
 */

import type { TruthState } from "./truth.js";

/**
 * Umbrales de afinidad.
 *
 * Sin valores por defecto, como el resto de magnitudes del producto: van a configuración versionada
 * (`CONFIG_SCHEMA.md` §3.5, `affinity_thresholds`). Aquí un valor por defecto sería peor que en
 * otros sitios, porque decidiría en silencio qué fuentes entran en el circuito de alguien.
 */
export interface AffinityThresholds {
  /** Solape por encima del cual la fuente es del circuito. */
  readonly compatible: number;
  /** Solape por debajo del cual se considera de otro circuito y no se consolida. */
  readonly foreign: number;
  /** Tags distintos mínimos en la fuente para que el solape signifique algo. */
  readonly minTagsToJudge: number;
}

export type AffinityVerdict =
  /** Los tags de la fuente son los del circuito. */
  | "compatible"
  /** Se solapa en parte: puede ser una ampliación del circuito o una mezcla. */
  | "partially-compatible"
  /** Casi nada en común: lo más probable es que sea otro circuito. */
  | "foreign-suspected"
  /** No hay contra qué comparar, o la fuente es demasiado pequeña para juzgarla. */
  | "unknown";

export interface AffinityReport {
  readonly verdict: AffinityVerdict;
  /** Proporción de los tags de la fuente que el circuito ya conoce. */
  readonly overlap: number;
  readonly sourceTags: number;
  readonly knownTags: number;
  readonly sharedTags: number;
  /** Tags que la fuente trae y el circuito no tenía. Unos pocos son una ampliación; todos, otro sitio. */
  readonly newTags: number;
  /** Si la fuente puede consolidarse en el circuito. Solo `foreign-suspected` lo impide. */
  readonly mayAccumulate: boolean;
  readonly truth: TruthState;
  /** Por qué, en una frase, para poder enseñarlo sin que haya que deducirlo. */
  readonly reason: string;
}

/**
 * Juzga una fuente contra los tags que el circuito ya conoce.
 *
 * Un circuito vacío devuelve `unknown` y **deja pasar**: la primera fuente no tiene contra qué
 * compararse, y negarla dejaría el producto sin forma de empezar un circuito. Es el único caso en
 * que la ausencia de juicio no bloquea, y por eso se dice en el informe en lugar de callarlo.
 */
export function assessAffinity(
  sourceTags: ReadonlySet<string>,
  knownTags: ReadonlySet<string>,
  thresholds: AffinityThresholds,
): AffinityReport {
  let shared = 0;
  for (const tag of sourceTags) {
    if (knownTags.has(tag)) shared += 1;
  }
  const overlap = sourceTags.size === 0 ? 0 : shared / sourceTags.size;
  const newTags = sourceTags.size - shared;

  const base = {
    overlap,
    sourceTags: sourceTags.size,
    knownTags: knownTags.size,
    sharedTags: shared,
    newTags,
  } as const;

  if (knownTags.size === 0) {
    return {
      ...base,
      verdict: "unknown",
      mayAccumulate: true,
      truth: "unknown",
      reason:
        "El circuito está vacío: no hay tags con los que comparar. La primera fuente define el " +
        "circuito y por eso se acepta, no porque se haya comprobado.",
    };
  }

  if (sourceTags.size < thresholds.minTagsToJudge) {
    return {
      ...base,
      verdict: "unknown",
      mayAccumulate: true,
      truth: "unknown",
      reason:
        `El fichero trae solo ${sourceTags.size} tags distintos, menos de los ${thresholds.minTagsToJudge} ` +
        "necesarios para saber si es de este circuito. Se acepta sin comprobarlo.",
    };
  }

  if (overlap >= thresholds.compatible) {
    return {
      ...base,
      verdict: "compatible",
      mayAccumulate: true,
      truth: "observed",
      reason:
        `${percent(overlap)} de los tags del fichero ya están en el circuito` +
        (newTags === 0 ? "." : `, y los ${newTags} restantes son nuevos aquí.`),
    };
  }

  if (overlap <= thresholds.foreign) {
    return {
      ...base,
      verdict: "foreign-suspected",
      mayAccumulate: false,
      truth: "inferred",
      reason:
        `Solo ${percent(overlap)} de los tags del fichero están en este circuito: probablemente es ` +
        "de otro circuito.",
    };
  }

  return {
    ...base,
    verdict: "partially-compatible",
    mayAccumulate: true,
    truth: "inferred",
    reason:
      `${percent(overlap)} de los tags del fichero están en el circuito y ${newTags} no: puede ser ` +
      "una ampliación del circuito o una mezcla de dos.",
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

/** Los tags distintos de una lista de lecturas, que es lo que la afinidad compara. */
export function tagsOf(readings: readonly { readonly tagId: string }[]): ReadonlySet<string> {
  const tags = new Set<string>();
  for (const entry of readings) tags.add(entry.tagId);
  return tags;
}
