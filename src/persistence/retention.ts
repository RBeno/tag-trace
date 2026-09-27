/**
 * Retención de lecturas por fuente y partición del registro antiguo (ADR-0015 §2, R-DAT-023).
 *
 * Funciones puras, sin IndexedDB: son la regla, y la regla se prueba en Node. El almacén
 * (`store.ts`) y el Worker las aplican; la migración 5→6 las usa para partir el registro antiguo.
 *
 * **Por qué se retiene y no se guarda todo.** El circuito de auditoría —un cuarto de millón de
 * lecturas— ronda los 110 MB como un solo valor de IndexedDB, y Chromium no admite valores de más
 * de unos 127 MiB (OQ-142). Lo que crece con los meses son las lecturas; lo que perdura de cada
 * fichero es su instantánea (`src/domain/snapshot.ts`). Las lecturas en crudo solo viven en la
 * ventana de trabajo: las dos últimas exportaciones cargadas (OQ-143, propietario 2026-09-27).
 */

import type { Interval } from "../domain/coverage.js";
import type { Provenance, Reading } from "../domain/reading.js";

/** Lo que la regla de retención necesita saber de cada fuente, en **orden de carga**. */
export interface RetentionSource {
  readonly sourceId: string;
  readonly sourceHash: string;
  /** Ventana completa de la fuente (R-DAT-007); `null` si no tiene tramo completo. */
  readonly complete: Interval | null;
}

/** ¿Dos ventanas completas se tocan? Compartir un instante ya es solaparse: no hay hueco entre ellas. */
export function windowsOverlap(a: Interval | null, b: Interval | null): boolean {
  if (a === null || b === null) return false;
  return a.from <= b.to && b.from <= a.to;
}

/**
 * Las fuentes **distintas**, en orden de carga: un fichero repetido (misma `sourceHash`) no es una
 * fuente nueva (R-DAT-005, INV-005), así que cuenta una vez, por su primera carga.
 */
export function distinctSources<T extends Pick<RetentionSource, "sourceHash">>(sources: readonly T[]): readonly T[] {
  const seen = new Set<string>();
  const distinct: T[] = [];
  for (const source of sources) {
    if (seen.has(source.sourceHash)) continue;
    seen.add(source.sourceHash);
    distinct.push(source);
  }
  return distinct;
}

/**
 * Cuántas exportaciones conservan sus lecturas. No es una constante de planta: es la regla de
 * retención que decidió el propietario (R-DAT-023, OQ-143), y cambiarla es cambiar la regla.
 */
export const RETAINED_EXPORTS = 2;

/**
 * Qué fuentes conservan sus lecturas (R-DAT-023; propietario, 2026-09-26 y 2026-09-27).
 *
 * Se retienen las lecturas de las **dos últimas exportaciones cargadas**, se solapen o no (OQ-143 a:
 * con dos exportaciones diarias que no se tocan, la rotura que cae en el corte solo se ve en el tiempo
 * si las dos siguen enteras). Las demás se retiran del almacén y quedan como instantánea.
 *
 * «Últimas» es **en orden de carga**, no en el tiempo: es lo que hace que la regla sea predecible
 * para quien carga («los dos últimos ficheros que cargué»). Un fichero repetido no es una fuente
 * nueva (R-DAT-005), pero **sí es una carga**: volver a cargar un fichero lo pone el último (OQ-143
 * b), porque quien lo vuelve a cargar quiere mirarlo. Sus lecturas viven bajo el `sourceId` de su
 * primera carga, que es el que se devuelve.
 */
export function retainedSources(sources: readonly RetentionSource[]): ReadonlySet<string> {
  const firstId = new Map<string, string>();
  const lastLoad = new Map<string, number>();
  sources.forEach((source, index) => {
    if (!firstId.has(source.sourceHash)) firstId.set(source.sourceHash, source.sourceId);
    lastLoad.set(source.sourceHash, index);
  });
  const byLastLoad = [...lastLoad.entries()].sort((a, b) => a[1] - b[1]).map(([hash]) => firstId.get(hash) as string);
  return new Set(byLastLoad.slice(-RETAINED_EXPORTS));
}

/** Las procedencias que una lectura ya traía de uniones anteriores (`MergedReading.alsoFrom`). */
function alsoFromOf(reading: Reading): readonly Provenance[] {
  const extra = (reading as { readonly alsoFrom?: readonly Provenance[] }).alsoFrom;
  return extra ?? [];
}

/**
 * Reparte las lecturas acumuladas del registro antiguo por fuente.
 *
 * Cada lectura va con su procedencia principal (`provenance.sourceId`). Una lectura que la unión
 * avaló con más de una exportación (`alsoFrom`, R-DAT-005) **también** se copia en cada una de esas
 * otras fuentes, con esa procedencia como principal: la tabla `sources` guarda lo que cada fichero
 * contenía, y si solo se retiene la fuente B, el tramo que compartía con A tiene que seguir en B.
 * Dejarla solo con la principal —que es la primera cargada, la que se retira antes— vaciaría el
 * solape de la fuente retenida. Al volver a unir las fuentes retenidas, `unionReadings` cuenta esos
 * eventos una vez otra vez.
 */
export function partitionReadingsBySource(readings: readonly Reading[]): ReadonlyMap<string, readonly Reading[]> {
  const bySource = new Map<string, Reading[]>();
  const push = (sourceId: string, reading: Reading): void => {
    const list = bySource.get(sourceId);
    if (list === undefined) bySource.set(sourceId, [reading]);
    else list.push(reading);
  };
  for (const reading of readings) {
    push(reading.provenance.sourceId, reading);
    const others = alsoFromOf(reading);
    for (const provenance of others) {
      if (provenance.sourceId === reading.provenance.sourceId) continue;
      const alsoFrom = [reading.provenance, ...others.filter((entry) => entry !== provenance)];
      push(provenance.sourceId, { time: reading.time, agvId: reading.agvId, tagId: reading.tagId, provenance, alsoFrom } as Reading);
    }
  }
  return bySource;
}

/** Un circuito de la versión 5: todas las lecturas en un solo valor. Solo existe para migrarlo. */
export interface LegacySourceRecord extends RetentionSource {
  readonly fileName: string;
  readonly importedAt: number;
  readonly acceptedRows: number;
}

export interface LegacyCircuitRecord {
  readonly circuitId: string;
  readonly sources: readonly LegacySourceRecord[];
  readonly readings: readonly Reading[];
}

export interface SplitSource extends LegacySourceRecord {
  readonly retained: boolean;
  /** Un fichero antiguo no tiene instantánea: no hay análisis guardado con que fabricarla. */
  readonly snapshot: false;
}

export interface SplitCircuit {
  readonly sources: readonly SplitSource[];
  /** Las lecturas de cada fuente retenida, y solo de esas. */
  readonly readings: readonly { readonly sourceId: string; readonly readings: readonly Reading[] }[];
}

/**
 * Parte un circuito de la versión 5 para la versión 6: las fuentes con su marca de retención y sin
 * instantánea, y las lecturas de las retenidas por fuente. Las de las demás se retiran aquí mismo.
 */
export function splitLegacyCircuit(circuit: LegacyCircuitRecord): SplitCircuit {
  const retained = retainedSources(circuit.sources);
  const partition = partitionReadingsBySource(circuit.readings);
  const sources = circuit.sources.map((source): SplitSource => ({
    ...source,
    retained: retained.has(source.sourceId),
    snapshot: false,
  }));
  const readings = [...retained].map((sourceId) => ({ sourceId, readings: partition.get(sourceId) ?? [] }));
  return { sources, readings };
}
