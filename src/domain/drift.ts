/**
 * Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013).
 *
 * Con una sola ventana, un tag sin lecturas es indistinguible entre obsoleto y averiado, y un
 * vehículo que no lee un tag es indistinguible entre «nunca lo llevó en memoria» y «lo perdió». Lo
 * que separa las dos explicaciones es el tiempo: leído antes y no ahora es un **cambio** —murió, se
 * sustituyó o se retiró—; no leído en ninguna ventana es obsoleto consolidado, con más soporte que
 * una sola muestra pero sin llegar a `confirmed` — eso exige ir a mirarlo (R-EVI-006).
 *
 * `coverage` ya trae esta comparación servida: es la unión de los intervalos de todas las fuentes
 * aceptadas (`mergeIntervals`), así que dos exportaciones separadas en el tiempo producen, sin nada
 * más, dos o más intervalos disjuntos. Esta función no pide un segundo fichero: usa el primero y el
 * último intervalo que ya existen.
 *
 * **Lo que no hace.** No compara periodos intermedios cuando hay más de dos intervalos: solo el
 * primero contra el último. No reclasifica el inventario de una sola ventana (`inventory.ts`): es una
 * vista complementaria que se cruza por `tagId`. Y no aplica el tercer descarte que R-DAT-016 también
 * anuncia —comprobar con tiempos si el tramo que rodea a un tag obsoleto se recorre en directo—, que
 * es geométrico y no temporal, y queda para otra entrega.
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import type { Reading } from "./reading.js";

export interface DriftThresholds {
  /**
   * Separación mínima entre el fin del primer periodo cubierto y el inicio del último para tratarlos
   * como «distantes» y no como el hueco pequeño de una fuente casi contigua a otra.
   */
  readonly minGapMs: number;
  /**
   * Lecturas mínimas de un vehículo **dentro de cada periodo** para que compararlo entre los dos
   * signifique algo. Mismo concepto y mismo valor que `BlindnessThresholds.minReadingsPerVehicle`
   * (`inventory.ts`): un vehículo con tres lecturas en un periodo no informa de nada al contrastarlo
   * con el otro.
   */
  readonly minReadingsPerVehicle: number;
}

export type TagDrift =
  /** Se leía en el periodo temprano y no en el tardío: cambió, y el dato no dice por qué. */
  | { readonly kind: "desaparecido"; readonly tagId: string; readonly readingsBefore: number }
  /** Sin lecturas en el periodo temprano y con lecturas en el tardío: sustitución o instalación. */
  | { readonly kind: "nuevo"; readonly tagId: string; readonly readingsAfter: number }
  /** Sin ninguna lectura en los dos periodos: obsoleto consolidado, nunca confirmado por esto solo. */
  | { readonly kind: "obsoleto-consolidado"; readonly tagId: string };

export interface VehicleDrift {
  readonly agvId: string;
  /**
   * Tags que este vehículo leía en el periodo temprano y no lee ni una vez en el tardío, mientras el
   * tag sigue vivo para el resto de la flota.
   *
   * Un tag que además murió para todos **no** aparece aquí: ya está en `tagDrifts` como
   * `desaparecido`, y repetirlo por cada vehículo que lo leía sería la misma causa contada muchas
   * veces en vez de nombrarla una sola vez donde corresponde.
   */
  readonly droppedTags: readonly string[];
}

export interface DriftComparison {
  readonly evaluated: boolean;
  /** Por qué no se evaluó, cuando `evaluated` es `false`. Nunca se calla (R-EVI-006). */
  readonly reason: string | null;
  readonly earlyPeriod: Interval | null;
  readonly latePeriod: Interval | null;
  readonly tagDrifts: readonly TagDrift[];
  readonly vehicleDrifts: readonly VehicleDrift[];
}

const NOT_EVALUATED: Omit<DriftComparison, "evaluated" | "reason"> = {
  earlyPeriod: null,
  latePeriod: null,
  tagDrifts: [],
  vehicleDrifts: [],
};

interface PeriodCounts {
  readonly readingsByTag: Map<string, number>;
  readonly readsByVehicleTag: Map<string, Map<string, number>>;
  readonly readingsByVehicle: Map<string, number>;
}

function countPeriod(readings: readonly Reading[], period: Interval): PeriodCounts {
  const readingsByTag = new Map<string, number>();
  const readsByVehicleTag = new Map<string, Map<string, number>>();
  const readingsByVehicle = new Map<string, number>();

  for (const entry of readings) {
    const instant = entry.time.utcMs;
    if (instant < period.from || instant > period.to) continue;
    readingsByTag.set(entry.tagId, (readingsByTag.get(entry.tagId) ?? 0) + 1);
    readingsByVehicle.set(entry.agvId, (readingsByVehicle.get(entry.agvId) ?? 0) + 1);
    let tags = readsByVehicleTag.get(entry.agvId);
    if (tags === undefined) {
      tags = new Map<string, number>();
      readsByVehicleTag.set(entry.agvId, tags);
    }
    tags.set(entry.tagId, (tags.get(entry.tagId) ?? 0) + 1);
  }

  return { readingsByTag, readsByVehicleTag, readingsByVehicle };
}

/**
 * Compara el primer y el último periodo cubiertos, a partir de la cobertura ya calculada del
 * circuito. `knownTags` es la unión de las listas de planta declaradas (circuito, memoria,
 * mantenimiento, emergencia, carga online, crítico): es lo único que permite saber que un tag existe
 * cuando no tiene ninguna lectura en ningún periodo.
 */
export function compareDistantPeriods(
  readings: readonly Reading[],
  coverage: readonly Interval[],
  knownTags: ReadonlySet<string>,
  thresholds: DriftThresholds,
): DriftComparison {
  const merged = mergeIntervals(coverage);
  if (merged.length < 2) {
    return { evaluated: false, reason: "Solo hay un periodo cubierto: no hay con qué compararlo.", ...NOT_EVALUATED };
  }

  const earlyPeriod = merged[0] as Interval;
  const latePeriod = merged[merged.length - 1] as Interval;
  if (latePeriod.from - earlyPeriod.to < thresholds.minGapMs) {
    return {
      evaluated: false,
      reason: "El hueco entre el primer y el último periodo cubierto es demasiado pequeño para tratarlos como distantes.",
      ...NOT_EVALUATED,
    };
  }

  const early = countPeriod(readings, earlyPeriod);
  const late = countPeriod(readings, latePeriod);

  const allTags = new Set<string>([...knownTags, ...early.readingsByTag.keys(), ...late.readingsByTag.keys()]);
  const tagDrifts: TagDrift[] = [];
  const deadEverywhere = new Set<string>();
  for (const tagId of allTags) {
    const before = early.readingsByTag.get(tagId) ?? 0;
    const after = late.readingsByTag.get(tagId) ?? 0;
    if (before > 0 && after === 0) {
      tagDrifts.push({ kind: "desaparecido", tagId, readingsBefore: before });
      deadEverywhere.add(tagId);
    } else if (before === 0 && after > 0) {
      tagDrifts.push({ kind: "nuevo", tagId, readingsAfter: after });
    } else if (before === 0 && after === 0 && knownTags.has(tagId)) {
      tagDrifts.push({ kind: "obsoleto-consolidado", tagId });
      deadEverywhere.add(tagId);
    }
  }
  tagDrifts.sort((a, b) => a.tagId.localeCompare(b.tagId));

  const witnessesEarly = new Set(
    [...early.readingsByVehicle].filter(([, count]) => count >= thresholds.minReadingsPerVehicle).map(([agvId]) => agvId),
  );
  const witnessesLate = new Set(
    [...late.readingsByVehicle].filter(([, count]) => count >= thresholds.minReadingsPerVehicle).map(([agvId]) => agvId),
  );

  const vehicleDrifts: VehicleDrift[] = [];
  for (const agvId of witnessesEarly) {
    if (!witnessesLate.has(agvId)) continue;
    const readEarly = early.readsByVehicleTag.get(agvId) ?? new Map<string, number>();
    const readLate = late.readsByVehicleTag.get(agvId) ?? new Map<string, number>();
    const dropped = [...readEarly.entries()]
      .filter(
        ([tagId, count]) =>
          // Un puñado de lecturas de un tag que ya es probabilístico por diseño (una degradación o
          // una tasa media ajena a esta comparación) no demuestra un patrón sólido que la ausencia
          // después pueda contradecir. Mismo umbral y misma razón que `minReadingsPerVehicle`: por
          // debajo, el silencio no significa nada por sí solo.
          count >= thresholds.minReadingsPerVehicle && !readLate.has(tagId) && !deadEverywhere.has(tagId),
      )
      .map(([tagId]) => tagId)
      .sort();
    if (dropped.length > 0) vehicleDrifts.push({ agvId, droppedTags: dropped });
  }
  vehicleDrifts.sort((a, b) => a.agvId.localeCompare(b.agvId));

  return { evaluated: true, reason: null, earlyPeriod, latePeriod, tagDrifts, vehicleDrifts };
}
