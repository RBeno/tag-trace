/**
 * Matriz de lectura tag × AGV, normalizada por **pasada** (R-OPP-010).
 *
 * Responde a la pregunta que el recuento bruto no puede responder: cuando un tag se lee poco,
 * ¿es cosa de unos vehículos concretos o del tag? Un total de lecturas no lo distingue, porque
 * está contaminado por cuántas vueltas dio cada uno.
 *
 * **El denominador es la pasada por el punto, no la vuelta.** Para el par (A, T) solo cuentan las
 * vueltas en las que A leyó algún **vecino** de T en el anillo, es decir, aquellas en las que se
 * demuestra que A pasó por ahí. Sin esa condición, un vehículo que no recorre una rama aparecería
 * fallando todos sus tags, que es exactamente el falso positivo que R-OPP-008 y TC-028 prohíben:
 * las ausencias salen del modelo de oportunidades, nunca de restar el catálogo a lo leído.
 *
 * **Esto no es una tasa de salud y no se llama así.** La salud exige oportunidad elegible —en
 * memoria *y* existente, R-OPP-011—, que necesita la configuración de planta de OQ-B04 y la lista
 * de memoria. Mientras no estén, esto es frecuencia de lectura observada por pasada, y el patrón
 * que publica es evidencia con su estado de verdad, nunca una causa.
 */

import { mergeIntervals, uncoveredGaps, type Interval } from "./coverage.js";
import { sortReadings, type SourceDirection } from "./order.js";
import type { Reading } from "./reading.js";
import type { TruthState } from "./truth.js";

export interface ReadRateThresholds {
  /** Pasadas mínimas para que una celda (A, T) signifique algo. Por debajo, la celda no sostiene nada. */
  readonly minPassesPerPair: number;
  /** Vehículos con soporte suficiente por debajo de los cuales no hay contraste que sostenga un patrón. */
  readonly minVehiclesForContrast: number;
  /** Tasa a partir de la cual se considera que un vehículo **sí** lee el tag. */
  readonly highRate: number;
  /** Tasa por debajo de la cual se considera que **no** lo lee. */
  readonly lowRate: number;
}

/**
 * El patrón describe la **forma del reparto**, no la causa.
 *
 * Separar `gradiente` de los demás no es quisquillosería: OQ-118 dejó abierto precisamente ese
 * caso —todos leen algo, unos menos— porque es el único que no distingue entre detección y
 * configuración. Meterlo con los bimodales lo daría por explicado.
 */
export type ReadPattern =
  /** Todos los que pasan lo leen casi siempre. Nada que mirar. */
  | "uniforme-alto"
  /** Unos vehículos casi siempre y otros casi nunca, todos con pasadas de sobra. */
  | "bimodal-candidato"
  /** Todos los que pasan lo leen poco. */
  | "uniforme-bajo"
  /** Reparto continuo, sin dos grupos: no se distingue detección de configuración (OQ-118). */
  | "gradiente"
  /** Pocas pasadas para sostener nada. */
  | "sin-soporte";

export interface PairReadRate {
  readonly agvId: string;
  /** Vueltas en las que el vehículo pasó por el punto, probado por haber leído un vecino. */
  readonly passes: number;
  /** De esas, en cuántas leyó el tag. */
  readonly hits: number;
}

export interface TagReadRow {
  readonly tagId: string;
  /** Posición en el anillo observado. El orden es `inferred`: sucesor dominante, no trazado medido. */
  readonly position: number;
  /**
   * El ancla de segmentación.
   *
   * Su tasa es 1 por construcción —las vueltas se cortan justo por él—, así que no es evidencia de
   * nada y la vista tiene que decirlo en lugar de presentar un 100 % que se ha fabricado solo.
   */
  readonly isAnchor: boolean;
  readonly passes: number;
  readonly hits: number;
  /** `null` cuando nadie pasó por el punto: distinto de 0 %, que sí sería un hecho. */
  readonly rate: number | null;
  readonly pattern: ReadPattern;
  readonly truth: TruthState;
  /** Evidencia del patrón: quién lo lee y quién no, enumerados para poder abrir el expediente. */
  readonly highReaders: readonly string[];
  readonly lowReaders: readonly string[];
  /** Solo los pares con al menos una pasada: una celda sin pasadas no es un cero. */
  readonly byVehicle: readonly PairReadRate[];
}

export interface VehicleReadRow {
  readonly agvId: string;
  /** Vueltas utilizables: cerradas entre dos pasos por el ancla y sin cruzar hueco de cobertura. */
  readonly laps: number;
  readonly passes: number;
  readonly hits: number;
  readonly rate: number | null;
}

export interface ReadMatrix {
  readonly cohortId: number;
  /** Anillo observado, en orden. */
  readonly ring: readonly string[];
  readonly tags: readonly TagReadRow[];
  readonly vehicles: readonly VehicleReadRow[];
  /** Si el criterio llegó a aplicarse: sin vueltas utilizables no hay matriz que sostener. */
  readonly supported: boolean;
}

/**
 * Construye la matriz de un cohorte.
 *
 * `thresholds` no tiene valor por defecto a propósito (AI_DEVELOPMENT_GOVERNANCE §4): son
 * magnitudes que decide el propietario, y sin ellas la llamada no compila.
 */
export function buildReadMatrix(
  cohortId: number,
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
  ring: readonly string[],
  anchor: string,
  thresholds: ReadRateThresholds,
): ReadMatrix {
  const position = new Map<string, number>();
  ring.forEach((tagId, index) => position.set(tagId, index));

  const lapsByVehicle = splitLapsByAnchor(readings, direction, coverage, anchor);

  const pairs = new Map<string, Map<string, { passes: number; hits: number }>>();
  const vehicleLaps = new Map<string, number>();

  for (const [agvId, laps] of lapsByVehicle) {
    vehicleLaps.set(agvId, laps.length);
    for (const lapTags of laps) {
      for (let index = 0; index < ring.length; index += 1) {
        const tagId = ring[index] as string;
        const previous = ring[(index - 1 + ring.length) % ring.length] as string;
        const next = ring[(index + 1) % ring.length] as string;
        // La prueba de que pasó por el punto: **entró por un lado y salió por el otro**, o leyó el
        // propio tag —no hay forma de leerlo sin estar ahí—.
        //
        // Exigir los dos vecinos y no uno no es rigor de más: el anillo cierra, así que el ancla es
        // vecina del último tag y **cualquier** vehículo la lee. Con un solo vecino, un vehículo
        // que se sale en mitad del anillo y vuelve a entrar por el ancla contaba como si hubiera
        // recorrido el tramo que nunca pisó, y la rama que no recorre le salía como tag fallado.
        const passed = (lapTags.has(previous) && lapTags.has(next)) || lapTags.has(tagId);
        if (!passed) continue;
        let byTag = pairs.get(tagId);
        if (byTag === undefined) {
          byTag = new Map();
          pairs.set(tagId, byTag);
        }
        let cell = byTag.get(agvId);
        if (cell === undefined) {
          cell = { passes: 0, hits: 0 };
          byTag.set(agvId, cell);
        }
        cell.passes += 1;
        if (lapTags.has(tagId)) cell.hits += 1;
      }
    }
  }

  const tags: TagReadRow[] = ring.map((tagId, index) => {
    const byTag = pairs.get(tagId) ?? new Map<string, { passes: number; hits: number }>();
    const byVehicle: PairReadRate[] = [...byTag.entries()]
      .map(([agvId, cell]) => ({ agvId, passes: cell.passes, hits: cell.hits }))
      .sort((a, b) => a.agvId.localeCompare(b.agvId));

    const passes = byVehicle.reduce((total, cell) => total + cell.passes, 0);
    const hits = byVehicle.reduce((total, cell) => total + cell.hits, 0);
    const supported = byVehicle.filter((cell) => cell.passes >= thresholds.minPassesPerPair);
    const high = supported.filter((cell) => cell.hits / cell.passes >= thresholds.highRate);
    const low = supported.filter((cell) => cell.hits / cell.passes <= thresholds.lowRate);

    const { pattern, truth } = classify(supported.length, high.length, low.length, thresholds);
    return {
      tagId,
      position: index,
      isAnchor: tagId === anchor,
      passes,
      hits,
      rate: passes === 0 ? null : hits / passes,
      pattern,
      truth,
      highReaders: high.map((cell) => cell.agvId),
      lowReaders: low.map((cell) => cell.agvId),
      byVehicle,
    };
  });

  const vehicles: VehicleReadRow[] = [...vehicleLaps.entries()]
    .map(([agvId, laps]) => {
      let passes = 0;
      let hits = 0;
      for (const byTag of pairs.values()) {
        const cell = byTag.get(agvId);
        if (cell === undefined) continue;
        passes += cell.passes;
        hits += cell.hits;
      }
      return { agvId, laps, passes, hits, rate: passes === 0 ? null : hits / passes };
    })
    .sort((a, b) => a.agvId.localeCompare(b.agvId));

  return {
    cohortId,
    ring,
    tags,
    vehicles,
    supported: vehicles.some((vehicle) => vehicle.laps > 0),
  };
}

function classify(
  supported: number,
  high: number,
  low: number,
  thresholds: ReadRateThresholds,
): { pattern: ReadPattern; truth: TruthState } {
  if (supported < thresholds.minVehiclesForContrast) {
    return { pattern: "sin-soporte", truth: "unknown" };
  }
  if (high > 0 && low > 0) return { pattern: "bimodal-candidato", truth: "inferred" };
  if (low === supported) return { pattern: "uniforme-bajo", truth: "inferred" };
  if (high === supported) return { pattern: "uniforme-alto", truth: "inferred" };
  // Ni todos arriba ni dos grupos: el reparto es continuo y no separa detección de configuración.
  return { pattern: "gradiente", truth: "unknown" };
}

/**
 * Vueltas utilizables por vehículo, cada una como el conjunto de tags que leyó.
 *
 * Solo las **cerradas entre dos pasos consecutivos por el ancla**: los tramos de los extremos están
 * cortados por el fin de los datos, así que un tag del final saldría como no leído cuando lo que
 * pasa es que la ventana se acabó. Y una vuelta que cruza un hueco de cobertura se descarta, porque
 * lo que hay en medio es ausencia de datos, no circulación (R-DAT-007).
 */
function splitLapsByAnchor(
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
  anchor: string,
): ReadonlyMap<string, readonly ReadonlySet<string>[]> {
  const ordered = sortReadings([...readings], direction);
  const gaps = uncoveredGaps(mergeIntervals(coverage));
  const byVehicle = new Map<string, Reading[]>();
  for (const entry of ordered) {
    let list = byVehicle.get(entry.agvId);
    if (list === undefined) {
      list = [];
      byVehicle.set(entry.agvId, list);
    }
    list.push(entry);
  }

  const laps = new Map<string, ReadonlySet<string>[]>();
  for (const [agvId, entries] of byVehicle) {
    const anchors: number[] = [];
    entries.forEach((entry, index) => {
      if (entry.tagId === anchor) anchors.push(index);
    });
    const vehicleLaps: ReadonlySet<string>[] = [];
    for (let index = 0; index < anchors.length - 1; index += 1) {
      const from = anchors[index] as number;
      const to = anchors[index + 1] as number;
      const start = (entries[from] as Reading).time.utcMs;
      const end = (entries[to] as Reading).time.utcMs;
      if (gaps.some((gap) => start <= gap.from && end >= gap.to)) continue;
      const tags = new Set<string>();
      for (let step = from; step <= to; step += 1) tags.add((entries[step] as Reading).tagId);
      vehicleLaps.push(tags);
    }
    laps.set(agvId, vehicleLaps);
  }
  return laps;
}
