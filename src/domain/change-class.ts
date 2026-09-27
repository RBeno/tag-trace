/**
 * Clasificación de los cambios observados frente al esperado (`MEMORY_CONSOLIDATION.md` §8).
 *
 * Un cambio observado no sustituye enseguida al esperado. Se clasifica como evento puntual,
 * incidencia, deriva pendiente, cambio colectivo sostenido o cambio confirmado, y **solo los dos
 * últimos** pasan al esperado de la versión que se consolida. Decisiones del propietario
 * (2026-09-27): un cambio es **sostenido** si se mantiene en `sustainedFiles` ficheros seguidos
 * (OQ-146, 3 por defecto, en configuración); es **colectivo** si lo muestra más de la mitad de los
 * AGV que pasan por el sitio (OQ-147, `collectiveShare`); y una incidencia se excluye del esperado
 * consolidando el periodo entero y dejando fuera de sus estadísticas lo que la incidencia toca
 * (OQ-148).
 *
 * Este fichero fija el **contrato** (tipos y firmas).
 */

import type { Regime } from "./segment-bands.js";
import type { CircuitSnapshot } from "./snapshot.js";

export type ChangeClass =
  /** Se vio en algún fichero desde el esperado y ya no está en el actual: volvió solo. Informativo. */
  | "evento-puntual"
  /** Lo toca un hallazgo grave confirmado del periodo: queda fuera del esperado. */
  | "incidencia"
  /** Está en el fichero actual pero no cumple todavía sostenido y colectivo, o no hay dato para decirlo. */
  | "deriva-pendiente"
  /** Se mantiene en `sustainedFiles` ficheros seguidos y lo muestra la mayoría de quien pasa. */
  | "cambio-colectivo-sostenido"
  /** Una persona lo confirmó: un evento del plano físico en el periodo (ADR-0016). */
  | "cambio-confirmado";

/** Qué cambia: un vértice (tag) o una arista (tramo en un régimen). */
export type ChangeSubject =
  | { readonly kind: "vertice"; readonly tagId: string }
  | { readonly kind: "arista"; readonly from: string; readonly to: string; readonly regime: Regime };

/** `vertice|T` o `arista|A|B|regimen`: la clave con la que se cruzan cambios, incidencias y confirmaciones. */
export function subjectKey(subject: ChangeSubject): string {
  return subject.kind === "vertice" ? `vertice|${subject.tagId}` : `arista|${subject.from}|${subject.to}|${subject.regime}`;
}

export interface ClassifiedChange {
  /** `subjectKey(subject)|change`. */
  readonly key: string;
  readonly subject: ChangeSubject;
  /** El tipo de cambio tal como lo da `compareSnapshots`: `deja-de-leerse`, `aparece`, `mas-lento`… */
  readonly change: string;
  readonly detail: string;
  readonly cls: ChangeClass;
  /** Ficheros seguidos, contando el actual, en los que el cambio está frente al esperado. */
  readonly files: number;
  /**
   * Quién lo muestra: la parte de los AGV que pasan por el sitio y lo muestran (`share`), con sus
   * recuentos; `null` si la instantánea no permite saberlo, y entonces no es colectivo.
   */
  readonly collective: { readonly share: number | null; readonly affected: number | null; readonly passing: number | null };
  /** Por qué tiene esta clase, en palabras y con sus cifras. */
  readonly reason: string;
  /** `true` solo en `cambio-colectivo-sostenido` y `cambio-confirmado`: pasa al esperado. */
  readonly adopted: boolean;
}

export interface ChangeClassThresholds {
  /** OQ-146: ficheros seguidos para que un cambio sea sostenido. */
  readonly sustainedFiles: number;
  /** OQ-147: parte de los AGV que pasan que tiene que mostrarlo; colectivo si la supera. */
  readonly collectiveShare: number;
}

export interface ClassifyInput {
  /** El esperado vigente (el de la versión vigente), o `null` si todavía no hay memoria. */
  readonly expected: CircuitSnapshot | null;
  /** Las instantáneas posteriores al esperado, en orden de ventana, terminando en la que se consolida. */
  readonly history: readonly CircuitSnapshot[];
  /** Claves de sujeto (`subjectKey`) que toca una incidencia del periodo. */
  readonly incidentSubjects: ReadonlySet<string>;
  /** Claves de sujeto confirmadas por una persona en el periodo (eventos del plano). */
  readonly confirmedSubjects: ReadonlySet<string>;
  readonly thresholds: ChangeClassThresholds & { readonly maxChance: number };
}

export function classifyChanges(input: ClassifyInput): readonly ClassifiedChange[] {
  throw new Error(`classifyChanges: pendiente de implementar (${input.history.length})`);
}

/**
 * El esperado que se consolida: lo observado, salvo en lo que no se adopta. Para cada vértice o
 * arista con un cambio no adoptado se conserva el valor del esperado anterior; lo que toca una
 * incidencia se conserva del anterior o, si no lo hay, queda sin medida (`null`), nunca con la
 * medida de la incidencia. Lo que no cambió sale de lo observado.
 */
export function expectedSnapshot(
  previousExpected: CircuitSnapshot | null,
  observed: CircuitSnapshot,
  changes: readonly ClassifiedChange[],
  incidentSubjects: ReadonlySet<string>,
): CircuitSnapshot {
  throw new Error(`expectedSnapshot: pendiente de implementar (${previousExpected?.sourceId ?? "-"}, ${observed.sourceId}, ${changes.length}, ${incidentSubjects.size})`);
}

/** Una incidencia del periodo: el hallazgo grave confirmado y lo que toca. Se guarda aparte del esperado (R-INC-001). */
export interface IncidentRecord {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly figure: string;
  /** Claves de sujeto que toca: los tags que nombra el hallazgo y los tramos que salen de ellos o llegan a ellos. */
  readonly subjects: readonly string[];
}

/**
 * Los sujetos que toca un hallazgo: los tags del anillo de la instantánea que aparecen en las partes
 * de su clave de revisión, y las aristas que entran o salen de ellos en los dos regímenes.
 */
export function incidentSubjectsOf(findingKey: string, snapshot: CircuitSnapshot): readonly string[] {
  throw new Error(`incidentSubjectsOf: pendiente de implementar (${findingKey}, ${snapshot.sourceId})`);
}
