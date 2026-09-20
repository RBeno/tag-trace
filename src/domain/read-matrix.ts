/**
 * Matriz de lectura tag × AGV, normalizada por **pasada** (R-OPP-010, R-OPP-013).
 *
 * Responde a la pregunta que el recuento bruto no puede responder: cuando un tag se lee poco,
 * ¿es cosa de unos vehículos concretos o del tag? Un total de lecturas no lo distingue, porque
 * está contaminado por cuántas vueltas dio cada uno.
 *
 * **El denominador es la pasada probada por el punto, no la vuelta.** Y probarla tiene tres vías,
 * en este orden:
 *
 * 1. **Vecinos.** El vehículo leyó a un lado y a otro con el punto encerrado entre ambas lecturas.
 *    Exigir los dos lados y no uno no es rigor de más: el anillo cierra, así que el tag de ancla es
 *    vecino del último y lo lee todo el mundo.
 * 2. **Tiempo.** Si entre esas dos lecturas falta un tramo largo, la posición sola no prueba nada:
 *    pudo recorrerlo sin leer, o pudo no recorrerlo. Lo que lo distingue es cuánto tardó frente a
 *    lo que ese tramo tarda normalmente.
 * 3. **Orden.** Si el tiempo no alcanza para decidir, queda mirar a los vecinos **de convoy**: si
 *    el vehículo sale del tramo entre los mismos AGV con los que entró, siguió en la línea
 *    (R-OPP-004). Es la misma firma que el expediente usa para una reaparición.
 *
 * Si ninguna de las tres sostiene el paso, **no se cuenta como pasada** y se registra aparte: un
 * tramo encerrado que el tiempo desmiente es candidato a atajo o a rama, no un tag fallado.
 *
 * **Nada de esto es una tasa de salud y el módulo no la llama así.** La salud exige oportunidad
 * elegible —en memoria *y* existente, R-OPP-011—, que necesita la configuración de planta de
 * OQ-B04 y la lista de memoria.
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
  /**
   * Tags seguidos sin leer que el encierro entre dos lecturas basta para dar por recorridos.
   *
   * Con uno —solo falta el tag en cuestión— la lectura de los dos lados ya lo demuestra. En cuanto
   * faltan varios, el encierro deja de distinguir «pasó sin leer» de «no pasó», y hay que mirar
   * tiempos y orden.
   */
  readonly maxGapProvenByNeighbours: number;
  /**
   * Proporción del tiempo esperado del tramo por debajo de la cual el paso **no** se da por bueno.
   *
   * Recorrer un tramo en mucho menos de lo que ese tramo tarda es la firma de no haberlo recorrido.
   */
  readonly minTimeRatio: number;
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

/** Cómo se probó que el vehículo pasó por el punto. */
export type PassEvidence = "vecinos" | "tiempo" | "orden";

export interface PairReadRate {
  readonly agvId: string;
  /** Vueltas en las que se probó que el vehículo pasó por el punto, por cualquiera de las tres vías. */
  readonly passes: number;
  /** De esas, en cuántas leyó el tag. */
  readonly hits: number;
  /** Cómo se probó cada pasada. La suma es `passes`. */
  readonly byNeighbours: number;
  readonly byTime: number;
  readonly byOrder: number;
  /**
   * Tramos encerrados que **ninguna** vía sostiene.
   *
   * No cuentan como pasada ni como fallo del tag: son candidatos a atajo o a rama, y se registran
   * para que el hueco no se convierta en un cero silencioso.
   */
  readonly unproven: number;
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
  /** Pasadas por vía de prueba, sumadas sobre la flota. */
  readonly byNeighbours: number;
  readonly byTime: number;
  readonly byOrder: number;
  /** Tramos encerrados sin sostener: candidatos a atajo o a rama en ese punto. */
  readonly unproven: number;
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
  /** Tramos que recorrió sin leer nada y que ni el tiempo ni el orden sostienen. */
  readonly unproven: number;
}

export interface ReadMatrix {
  readonly cohortId: number;
  /** Anillo observado, en orden. */
  readonly ring: readonly string[];
  readonly tags: readonly TagReadRow[];
  readonly vehicles: readonly VehicleReadRow[];
  /** Si el criterio llegó a aplicarse: sin vueltas utilizables no hay matriz que sostener. */
  readonly supported: boolean;
  /** Segmentos del anillo con tiempo mediano observado, de los `ring.length` que hay. */
  readonly segmentsWithTime: number;
}

interface Step {
  /** Posición en el anillo. */
  readonly position: number;
  /** Posición **relativa al ancla**, creciente a lo largo de la vuelta. */
  readonly rel: number;
  readonly utcMs: number;
}

interface Cell {
  passes: number;
  hits: number;
  byNeighbours: number;
  byTime: number;
  byOrder: number;
  unproven: number;
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
  const size = ring.length;
  const position = new Map<string, number>();
  ring.forEach((tagId, index) => position.set(tagId, index));
  const anchorPosition = position.get(anchor) ?? 0;

  const lapsByVehicle = traceLaps(readings, direction, coverage, anchor, position, anchorPosition, size);
  const segmentMedian = medianPerSegment(lapsByVehicle, size);
  const convoy = buildConvoy(readings, position);

  const pairs = new Map<string, Map<string, Cell>>();
  const vehicleLaps = new Map<string, number>();

  for (const [agvId, laps] of lapsByVehicle) {
    vehicleLaps.set(agvId, laps.length);
    for (const steps of laps) {
      const readPositions = new Set(steps.map((step) => step.position));
      for (let index = 0; index < size; index += 1) {
        const rel = (index - anchorPosition + size) % size;
        const cell = cellFor(pairs, ring[index] as string, agvId);

        if (readPositions.has(index)) {
          // Leyó el tag: no hay forma de leerlo sin estar ahí.
          cell.passes += 1;
          cell.hits += 1;
          cell.byNeighbours += 1;
          continue;
        }

        const bracket = enclose(steps, rel);
        if (bracket === null) continue; // No se le vio a los dos lados: no hay paso que contar.

        const gap = bracket.after.rel - bracket.before.rel - 1;
        if (gap <= thresholds.maxGapProvenByNeighbours) {
          cell.passes += 1;
          cell.byNeighbours += 1;
          continue;
        }

        const expected = expectedTime(segmentMedian, bracket.before.rel, bracket.after.rel, anchorPosition, size);
        const observed = bracket.after.utcMs - bracket.before.utcMs;

        if (expected !== null) {
          // Con tiempo esperado, **decide el tiempo**. Recorrer el tramo en mucho menos de lo que
          // tarda es la firma de no haberlo recorrido, y buscar entonces otra vía que diga que sí
          // sería lavar una contradicción en vez de resolverla.
          if (observed >= expected * thresholds.minTimeRatio) {
            cell.passes += 1;
            cell.byTime += 1;
          } else {
            cell.unproven += 1;
          }
          continue;
        }

        // Sin tiempo esperado —nadie lee esos segmentos seguidos— queda el orden: si salió del
        // tramo entre los mismos vehículos con los que entró, siguió en la línea (R-OPP-004).
        if (keptConvoy(convoy, agvId, bracket.before, bracket.after, observed)) {
          cell.passes += 1;
          cell.byOrder += 1;
          continue;
        }

        cell.unproven += 1;
      }
    }
  }

  const tags: TagReadRow[] = ring.map((tagId, index) => {
    const byTag = pairs.get(tagId) ?? new Map<string, Cell>();
    const byVehicle: PairReadRate[] = [...byTag.entries()]
      .filter(([, cell]) => cell.passes > 0 || cell.unproven > 0)
      .map(([agvId, cell]) => ({
        agvId,
        passes: cell.passes,
        hits: cell.hits,
        byNeighbours: cell.byNeighbours,
        byTime: cell.byTime,
        byOrder: cell.byOrder,
        unproven: cell.unproven,
      }))
      .sort((a, b) => a.agvId.localeCompare(b.agvId));

    const total = (pick: (cell: PairReadRate) => number): number =>
      byVehicle.reduce((sum, cell) => sum + pick(cell), 0);
    const passes = total((cell) => cell.passes);
    const hits = total((cell) => cell.hits);
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
      byNeighbours: total((cell) => cell.byNeighbours),
      byTime: total((cell) => cell.byTime),
      byOrder: total((cell) => cell.byOrder),
      unproven: total((cell) => cell.unproven),
      byVehicle: byVehicle.filter((cell) => cell.passes > 0),
    };
  });

  const vehicles: VehicleReadRow[] = [...vehicleLaps.entries()]
    .map(([agvId, laps]) => {
      let passes = 0;
      let hits = 0;
      let unproven = 0;
      for (const byTag of pairs.values()) {
        const cell = byTag.get(agvId);
        if (cell === undefined) continue;
        passes += cell.passes;
        hits += cell.hits;
        unproven += cell.unproven;
      }
      return { agvId, laps, passes, hits, rate: passes === 0 ? null : hits / passes, unproven };
    })
    .sort((a, b) => a.agvId.localeCompare(b.agvId));

  return {
    cohortId,
    ring,
    tags,
    vehicles,
    supported: vehicles.some((vehicle) => vehicle.laps > 0),
    segmentsWithTime: segmentMedian.filter((value) => value !== null).length,
  };
}

/** Las dos lecturas que encierran una posición dentro de la vuelta, si existen. */
function enclose(steps: readonly Step[], rel: number): { before: Step; after: Step } | null {
  let before: Step | null = null;
  let after: Step | null = null;
  for (const step of steps) {
    if (step.rel < rel) before = step;
    else if (step.rel > rel) {
      after = step;
      break;
    }
  }
  return before === null || after === null ? null : { before, after };
}

/**
 * Tiempo que ese tramo tarda normalmente: la suma de las medianas de sus segmentos.
 *
 * `null` si falta la mediana de alguno — sin ella no hay con qué comparar, y suponerla sería
 * fabricar el patrón que se quiere comprobar.
 */
function expectedTime(
  segmentMedian: readonly (number | null)[],
  fromRel: number,
  toRel: number,
  anchorPosition: number,
  size: number,
): number | null {
  let total = 0;
  for (let rel = fromRel; rel < toRel; rel += 1) {
    const segment = segmentMedian[(anchorPosition + rel) % size];
    if (segment === null || segment === undefined) return null;
    total += segment;
  }
  return total;
}

/**
 * ¿Salió del tramo entre los mismos vehículos con los que entró?
 *
 * Es R-OPP-004 aplicado al paso por un punto: conservar la posición relativa entre los mismos
 * vecinos demuestra permanencia en la línea. No demuestra que leyera nada, que es otra cosa.
 */
function keptConvoy(
  convoy: ReadonlyMap<number, Convoy>,
  agvId: string,
  before: Step,
  after: Step,
  window: number,
): boolean {
  const atBefore = neighboursAt(convoy, before.position, agvId, before.utcMs, window);
  const atAfter = neighboursAt(convoy, after.position, agvId, after.utcMs, window);
  if (atBefore === null || atAfter === null) return false;
  return (
    (atBefore.previous !== null && atBefore.previous === atAfter.previous) ||
    (atBefore.next !== null && atBefore.next === atAfter.next)
  );
}

interface Convoy {
  /** Lecturas de ese punto, de toda la flota, en orden de tiempo. */
  readonly order: readonly string[];
  /** Sus instantes, en el mismo orden. */
  readonly times: readonly number[];
  /** Dónde cae cada (vehículo, instante) dentro de `order`. */
  readonly index: ReadonlyMap<string, number>;
}

function buildConvoy(
  readings: readonly Reading[],
  position: ReadonlyMap<string, number>,
): ReadonlyMap<number, Convoy> {
  const byPosition = new Map<number, { agvId: string; utcMs: number }[]>();
  for (const entry of readings) {
    const index = position.get(entry.tagId);
    if (index === undefined) continue;
    let list = byPosition.get(index);
    if (list === undefined) {
      list = [];
      byPosition.set(index, list);
    }
    list.push({ agvId: entry.agvId, utcMs: entry.time.utcMs });
  }

  const convoy = new Map<number, Convoy>();
  for (const [index, list] of byPosition) {
    list.sort((a, b) => a.utcMs - b.utcMs);
    const order = list.map((entry) => entry.agvId);
    const times = list.map((entry) => entry.utcMs);
    const lookup = new Map<string, number>();
    list.forEach((entry, place) => lookup.set(`${entry.agvId}\u0000${entry.utcMs}`, place));
    convoy.set(index, { order, times, index: lookup });
  }
  return convoy;
}

/**
 * Quién pasó por ese punto justo antes y justo después de este vehículo.
 *
 * Dos condiciones que parecen detalles y no lo son:
 *
 * - **Otro vehículo.** Las lecturas del propio AGV en otras vueltas no son vecinos de convoy;
 *   contarlas hacía que cualquiera fuera «vecino de sí mismo» y el orden se conservara siempre.
 * - **Dentro de una ventana.** Un vehículo que pasó por ahí horas antes no es el de delante: es
 *   alguien que estuvo. La ventana es el propio tiempo que tardó el tramo, así que se escala sola
 *   sin añadir otro umbral.
 */
function neighboursAt(
  convoy: ReadonlyMap<number, Convoy>,
  position: number,
  agvId: string,
  utcMs: number,
  window: number,
): { previous: string | null; next: string | null } | null {
  const point = convoy.get(position);
  if (point === undefined) return null;
  const place = point.index.get(`${agvId}\u0000${utcMs}`);
  if (place === undefined) return null;

  const find = (step: -1 | 1): string | null => {
    for (let at = place + step; at >= 0 && at < point.order.length; at += step) {
      const other = point.order[at] as string;
      if (other === agvId) continue;
      const when = point.times[at] as number;
      return Math.abs(when - utcMs) <= window ? other : null;
    }
    return null;
  };
  return { previous: find(-1), next: find(1) };
}

/** Mediana del tiempo de cada segmento del anillo, medida solo donde se leyeron los dos extremos. */
function medianPerSegment(
  lapsByVehicle: ReadonlyMap<string, readonly (readonly Step[])[]>,
  size: number,
): readonly (number | null)[] {
  const samples: number[][] = Array.from({ length: size }, () => []);
  for (const laps of lapsByVehicle.values()) {
    for (const steps of laps) {
      for (let index = 1; index < steps.length; index += 1) {
        const from = steps[index - 1] as Step;
        const to = steps[index] as Step;
        if (to.rel - from.rel !== 1) continue; // Solo segmentos con los dos extremos leídos.
        (samples[from.position] as number[]).push(to.utcMs - from.utcMs);
      }
    }
  }
  return samples.map((list) => {
    if (list.length === 0) return null;
    const sorted = [...list].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  });
}

function cellFor(
  pairs: Map<string, Map<string, Cell>>,
  tagId: string,
  agvId: string,
): Cell {
  let byTag = pairs.get(tagId);
  if (byTag === undefined) {
    byTag = new Map();
    pairs.set(tagId, byTag);
  }
  let cell = byTag.get(agvId);
  if (cell === undefined) {
    cell = { passes: 0, hits: 0, byNeighbours: 0, byTime: 0, byOrder: 0, unproven: 0 };
    byTag.set(agvId, cell);
  }
  return cell;
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
 * Vueltas utilizables por vehículo, cada una como la secuencia de posiciones del anillo que leyó.
 *
 * Solo las **cerradas entre dos pasos consecutivos por el ancla**: los tramos de los extremos están
 * cortados por el fin de los datos, así que un tag del final saldría como no leído cuando lo que
 * pasa es que la ventana se acabó. Y una vuelta que cruza un hueco de cobertura se descarta, porque
 * lo que hay en medio es ausencia de datos, no circulación (R-DAT-007).
 */
function traceLaps(
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
  anchor: string,
  position: ReadonlyMap<string, number>,
  anchorPosition: number,
  size: number,
): ReadonlyMap<string, readonly (readonly Step[])[]> {
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

  const laps = new Map<string, (readonly Step[])[]>();
  for (const [agvId, entries] of byVehicle) {
    const anchors: number[] = [];
    entries.forEach((entry, index) => {
      if (entry.tagId === anchor) anchors.push(index);
    });
    const vehicleLaps: (readonly Step[])[] = [];
    for (let index = 0; index < anchors.length - 1; index += 1) {
      const from = anchors[index] as number;
      const to = anchors[index + 1] as number;
      const start = (entries[from] as Reading).time.utcMs;
      const end = (entries[to] as Reading).time.utcMs;
      if (gaps.some((gap) => start <= gap.from && end >= gap.to)) continue;

      const steps: Step[] = [];
      let lastRel = -1;
      for (let step = from; step <= to; step += 1) {
        const entry = entries[step] as Reading;
        const place = position.get(entry.tagId);
        if (place === undefined) continue; // Tag fuera del anillo: no ocupa posición que encerrar.
        let rel = (place - anchorPosition + size) % size;
        // La vuelta recorre el anillo una vez, así que `rel` crece; el cierre por el ancla vuelve a
        // 0 y hay que leerlo como una vuelta entera, no como un retroceso.
        if (rel <= lastRel) rel += size;
        if (rel <= lastRel) continue;
        lastRel = rel;
        steps.push({ position: place, rel, utcMs: entry.time.utcMs });
      }
      if (steps.length >= 2) vehicleLaps.push(steps);
    }
    laps.set(agvId, vehicleLaps);
  }
  return laps;
}
