/**
 * Unión de varias exportaciones de la misma fuente (ALG-002, R-DAT-005).
 *
 * Dos exportaciones son **cortes de la misma pila** tomados en momentos distintos, así que un
 * solape entre ellas no es un conjunto disperso de filas repetidas: es un tramo contiguo que las
 * dos deberían contar igual. Esa propiedad es lo que permite unirlas sin perder evidencia.
 *
 * **Por qué no se deduplica por huella de fila**, que es lo que parece obvio y sería un desastre:
 * a resolución gruesa, `hash(instante, agv, tag)` no distingue un paso repetido legítimo de una
 * fila duplicada. Medido sobre una exportación real: de 116 filas idénticas, **114 tenían otro tag
 * del mismo AGV entre medias** —el patrón A → B → A que contempla R-CO-005—. Deduplicar por huella
 * las habría fusionado y habría borrado 114 maniobras reales. Aquí la multiplicidad se conserva:
 * si las dos exportaciones traen dos veces la misma tripleta, el resultado la trae dos veces.
 *
 * **Y el solape se compara, no se supone.** Dentro del tramo común las dos exportaciones tienen que
 * contener los mismos eventos. Si no coinciden, la fuente se contradice consigo misma, y eso es un
 * hecho que se declara —no algo que se resuelva eligiendo una de las dos—.
 */

import { sourceCoverage, type Interval } from "../domain/coverage.js";
import type { Provenance, Reading } from "../domain/reading.js";

/** Una lectura del resultado, que puede venir avalada por más de una exportación. */
export interface MergedReading extends Reading {
  /** Las demás exportaciones que traen este mismo evento. Vacío si solo lo trae una. */
  readonly alsoFrom: readonly Provenance[];
}

export interface UnionResult {
  readonly readings: readonly MergedReading[];
  /** El tramo en el que las dos exportaciones se pisan, o `null` si son disjuntas. */
  readonly overlap: Interval | null;
  /** Eventos que las dos traían: se cuentan una vez y conservan las dos procedencias. */
  readonly shared: number;
  /**
   * Eventos dentro del tramo común que **solo una** de las dos trae.
   *
   * No se corrigen ni se descartan: se conservan y se cuentan, porque significan que la fuente no
   * entregó lo mismo dos veces y eso es información sobre la fuente.
   */
  readonly disagreements: number;
}

/**
 * Las procedencias que una lectura ya traía de uniones anteriores.
 *
 * La unión se encadena —cada exportación nueva se une al acumulado— y el acumulado ya es un
 * `MergedReading`. Reconstruir `alsoFrom` desde cero en cada unión tiraba las procedencias de todas
 * las exportaciones menos la última: con tres cortes solapados, la del segundo desaparecía.
 */
function inherited(entry: Reading): readonly Provenance[] {
  return "alsoFrom" in entry ? (entry as MergedReading).alsoFrom : [];
}

/**
 * La misma fuente no es otra procedencia. Volver a cargar una exportación idéntica (INV-005) no
 * añade nada a `alsoFrom`: sin este filtro cada recarga sumaba una procedencia entera —hash de 64
 * caracteres incluido— a cada una de las lecturas, y el circuito guardado crecía en decenas de
 * megabytes por recarga hasta pasar del tamaño máximo de un valor de IndexedDB en Chromium (unos
 * 127 MiB). Lo destapó la prueba de navegador de la revisión en campo en la integración continua.
 */
function withoutRepeats(own: Provenance, list: readonly Provenance[]): readonly Provenance[] {
  const seen = new Set<string>([own.sourceHash]);
  const kept: Provenance[] = [];
  for (const provenance of list) {
    if (seen.has(provenance.sourceHash)) continue;
    seen.add(provenance.sourceHash);
    kept.push(provenance);
  }
  return kept;
}

function key(entry: Reading): string {
  return `${entry.time.utcMs}|${entry.agvId}|${entry.tagId}`;
}

/**
 * Orden del resultado.
 *
 * Al mezclar dos ficheros, la posición de fila deja de servir para desempatar dentro de un instante
 * —son numeraciones de ficheros distintos—, así que el desempate pasa a ser por identificadores.
 * Es determinista, que es lo que exige INV-010, pero **no es una medida**: el orden dentro de un
 * mismo instante sigue siendo `inferred` (R-DAT-013).
 */
function compare(a: Reading, b: Reading): number {
  if (a.time.utcMs !== b.time.utcMs) return a.time.utcMs - b.time.utcMs;
  if (a.agvId !== b.agvId) return a.agvId < b.agvId ? -1 : 1;
  if (a.tagId !== b.tagId) return a.tagId < b.tagId ? -1 : 1;
  return 0;
}

function intersect(a: Interval | null, b: Interval | null): Interval | null {
  if (a === null || b === null) return null;
  const from = Math.max(a.from, b.from);
  const to = Math.min(a.to, b.to);
  return from <= to ? { from, to } : null;
}

/**
 * Une dos conjuntos de lecturas ya importados.
 *
 * Hay **dos rangos distintos** en juego, y confundirlos produce un defecto en cada dirección:
 *
 * - Para **emparejar** se usa el solape de los rangos completos de cada fuente, cola cortada
 *   incluida. Si no, un evento que las dos traen en su último instante entraría dos veces.
 * - Para **juzgar un desacuerdo** se usa solo el solape de sus tramos *completos*. La cola de una
 *   exportación puede no traer todo lo de ese instante, así que una ausencia ahí no significa que
 *   las fuentes se contradigan: significa que el fichero se cortó.
 */
export function unionReadings(first: readonly Reading[], second: readonly Reading[]): UnionResult {
  const matchRange = intersect(fullRange(first), fullRange(second));
  const judgeRange = intersect(sourceCoverage(first).complete, sourceCoverage(second).complete);

  if (matchRange === null) {
    const readings = [...first, ...second]
      .map((entry) => ({ ...entry, alsoFrom: inherited(entry) }))
      .sort(compare);
    return { readings, overlap: null, shared: 0, disagreements: 0 };
  }

  const within = (range: Interval, entry: Reading): boolean =>
    entry.time.utcMs >= range.from && entry.time.utcMs <= range.to;
  const matchable = (entry: Reading): boolean => within(matchRange, entry);
  const judgeable = (entry: Reading): boolean => judgeRange !== null && within(judgeRange, entry);

  // Multiconjunto, no conjunto: dos pasadas por el mismo tag en el mismo instante son dos eventos.
  const pending = new Map<string, Reading[]>();
  for (const entry of second) {
    if (!matchable(entry)) continue;
    const bucket = pending.get(key(entry));
    if (bucket === undefined) pending.set(key(entry), [entry]);
    else bucket.push(entry);
  }

  const merged: MergedReading[] = [];
  let shared = 0;
  let disagreements = 0;

  for (const entry of first) {
    if (!matchable(entry)) {
      merged.push({ ...entry, alsoFrom: inherited(entry) });
      continue;
    }
    const twin = pending.get(key(entry))?.shift();
    if (twin === undefined) {
      merged.push({ ...entry, alsoFrom: inherited(entry) });
      if (judgeable(entry)) disagreements += 1;
    } else {
      shared += 1;
      merged.push({
        ...entry,
        alsoFrom: withoutRepeats(entry.provenance, [...inherited(entry), twin.provenance, ...inherited(twin)]),
      });
    }
  }

  // Lo que sobra del tramo emparejable solo lo traía la segunda; su parte de fuera entra tal cual.
  for (const bucket of pending.values()) {
    for (const entry of bucket) {
      merged.push({ ...entry, alsoFrom: inherited(entry) });
      if (judgeable(entry)) disagreements += 1;
    }
  }
  for (const entry of second) {
    if (!matchable(entry)) merged.push({ ...entry, alsoFrom: inherited(entry) });
  }

  merged.sort(compare);
  return { readings: merged, overlap: judgeRange, shared, disagreements };
}

/** El rango que la fuente toca de verdad, cola cortada incluida. */
function fullRange(readings: readonly Reading[]): Interval | null {
  if (readings.length === 0) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const entry of readings) {
    if (entry.time.utcMs < from) from = entry.time.utcMs;
    if (entry.time.utcMs > to) to = entry.time.utcMs;
  }
  return { from, to };
}
