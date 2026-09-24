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
 * **Cada tag se mide dentro de su vida** (R-OPP-016). Si `tag-changes.ts` detectó que un tag empezó
 * o dejó de leerse dentro del periodo —con la flota pasando por su sitio lo bastante como para que no
 * sea casualidad—, las pasadas de antes de empezar o de después de acabar no cuentan en su celda: un
 * tag recién puesto no puede haberse leído antes de existir, y uno que murió no es un fallo de cada
 * vehículo que pasa. La línea temporal del tag sí conserva esas pasadas: es donde se ve la rotura.
 * Sin cambio detectado, el tag vive toda la ventana; recortar por la primera y la última lectura a
 * secas inflaría la tasa de un tag que se lee poco, cuyas rachas del borde son su ritmo normal.
 *
 * **Nada de esto es una tasa de salud y el módulo no la llama así.** La salud exige oportunidad
 * elegible —en memoria *y* existente, R-OPP-011—, que necesita la configuración de planta de
 * OQ-B04 y la lista de memoria.
 */

import { mergeIntervals, uncoveredGaps, type Interval } from "./coverage.js";
import { sortReadings, type SourceDirection } from "./order.js";
import {
  binTimeline,
  detectTrend,
  type PassRecord,
  type TimelineSeries,
  type TrendThresholds,
} from "./read-rate-trend.js";
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

/**
 * Dónde el orden de convoy **deja de ser evidencia** (R-FLO-006).
 *
 * Los dos conjuntos vienen de configuración de planta y los dos pueden estar vacíos, que es el
 * caso mientras OQ-B04 no se cierre. Vacío significa «no se ha declarado», y sin declaración la
 * regla no se puede aplicar: la vía de orden sigue valiendo en todo el anillo, como hasta ahora.
 * Es una degradación declarada y no un descuido — pero conviene saber que en ese estado la tercera
 * vía es más optimista de lo que la regla admitiría.
 */
export interface OrderEvidenceLimits {
  /** Zona declarada de cada tag. En `vacio` la reordenación está admitida (R-FLO-002). */
  readonly zoneOf: ReadonlyMap<string, string>;
  /** Tags por los que se entra a una calle de carga: salida legítima del orden. */
  readonly laneEntryTags: ReadonlySet<string>;
}

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
  /** Primera y última lectura de este vehículo en este tag; `null` si no lo leyó nunca. */
  readonly firstHitUtcMs: number | null;
  readonly lastHitUtcMs: number | null;
  /** Pasadas sin leer antes de su primera lectura (todas, si no lo leyó nunca). */
  readonly leadingMisses: number;
  /** Pasadas sin leer después de su última lectura (todas, si no lo leyó nunca). */
  readonly trailingMisses: number;
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
  /**
   * Cambio sostenido a lo largo de la ventana, sobre la misma línea de pasadas ya usada para
   * `passes`/`hits` (R-OPP-015). Presente solo si la búsqueda encontró algo: su ausencia no es un
   * «no cambió», es «no se buscó suficiente o no hubo nada que sostener».
   */
  readonly changedAtUtcMs?: number;
  readonly rateBefore?: number;
  readonly rateAfter?: number;
  /** Presente solo si la tendencia es sostenida a la baja (R-OPP-015). */
  readonly trend?: "bajando";
  readonly segmentRates?: readonly number[];
  /**
   * La misma línea de pasadas en tramos de tiempo iguales, para dibujar la forma del cambio.
   * Presente solo junto a una rotura o una degradación: sin cambio que enseñar no viaja.
   */
  readonly trendSeries?: TimelineSeries;
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
  /**
   * Cambio sostenido en **su propia** línea de pasadas, sobre todos los tags que recorre — un
   * lector que se degrada en todo el circuito, no en un tag concreto (R-OPP-015).
   */
  readonly changedAtUtcMs?: number;
  readonly rateBefore?: number;
  readonly rateAfter?: number;
  readonly trend?: "bajando";
  readonly segmentRates?: readonly number[];
  readonly trendSeries?: TimelineSeries;
}

/**
 * En cuántos tramos de tiempo se reparte la línea de pasadas de una fila con tendencia.
 *
 * Es una resolución de pantalla, como `ACTIVITY_BINS` en el Worker, no una magnitud de planta: no
 * decide ninguna rotura ni ninguna degradación, solo con cuánto detalle se dibujan.
 */
export const TREND_SERIES_BINS = 24;

/**
 * Cuándo empezó y cuándo dejó de leerse un tag dentro del periodo (R-OPP-016), si `tag-changes.ts`
 * lo detectó. `null` en un extremo: ese extremo no cambió.
 */
export interface TagLife {
  readonly from: number | null;
  readonly to: number | null;
}

const NO_LIVES: ReadonlyMap<string, TagLife> = new Map();

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
  /**
   * Pasadas que la vía de orden habría dado por buenas y que R-FLO-006 no deja usar.
   *
   * Se cuenta en vez de descartarse en silencio: es la medida de cuánto de la tercera vía se
   * apoyaba en tramos donde el orden no prueba nada, y sin la cifra el cambio de criterio sería
   * invisible para quien compare dos análisis.
   */
  readonly orderWithheld: number;
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
  firstHitUtcMs: number | null;
  lastHitUtcMs: number | null;
  leadingMisses: number;
  trailingMisses: number;
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
  limits: OrderEvidenceLimits,
  trendThresholds: TrendThresholds,
  lives: ReadonlyMap<string, TagLife> = NO_LIVES,
): ReadMatrix {
  const size = ring.length;
  const position = new Map<string, number>();
  ring.forEach((tagId, index) => position.set(tagId, index));
  const anchorPosition = position.get(anchor) ?? 0;

  const lapsByVehicle = traceLaps(readings, direction, coverage, anchor, position, anchorPosition, size);
  const segmentMedian = medianPerSegment(lapsByVehicle, size);
  const convoy = buildConvoy(readings, position);
  const orderUsable = orderUsableByPosition(ring, limits);
  let orderWithheld = 0;

  const pairs = new Map<string, Map<string, Cell>>();
  const vehicleLaps = new Map<string, number>();
  // Líneas temporales para la segunda pasada (R-OPP-015): una por tag, una por vehículo, con el
  // instante y el acierto de cada pasada probada. No es una relectura de la fuente — es el mismo
  // recorrido de abajo, reteniendo el instante en vez de tirarlo tras sumarlo a un contador.
  const tagTimelines = new Map<string, PassRecord[]>();
  const vehicleTimelines = new Map<string, PassRecord[]>();
  /**
   * Una pasada probada. La línea del tag la guarda siempre —la rotura se ve justo en las pasadas de
   * después de su vida—; la celda y la línea del vehículo, solo dentro de la vida del tag
   * (R-OPP-016). Las pasadas de una celda llegan en orden: son de un solo vehículo y sus vueltas se
   * recorren seguidas, así que las rachas del principio y del final se cuentan sobre la marcha.
   */
  const pass = (cell: Cell, tagId: string, agvId: string, utcMs: number, hit: boolean, via: PassVia): void => {
    pushRecord(tagTimelines, tagId, { utcMs, hit });
    const span = lives.get(tagId);
    if (span !== undefined && ((span.from !== null && utcMs < span.from) || (span.to !== null && utcMs > span.to))) {
      return;
    }
    pushRecord(vehicleTimelines, agvId, { utcMs, hit });
    cell.passes += 1;
    cell[via] += 1;
    if (hit) {
      cell.hits += 1;
      if (cell.firstHitUtcMs === null) cell.firstHitUtcMs = utcMs;
      cell.lastHitUtcMs = utcMs;
      cell.trailingMisses = 0;
      return;
    }
    if (cell.firstHitUtcMs === null) cell.leadingMisses += 1;
    cell.trailingMisses += 1;
  };

  for (const [agvId, laps] of lapsByVehicle) {
    vehicleLaps.set(agvId, laps.length);
    for (const steps of laps) {
      const readPositions = new Set(steps.map((step) => step.position));
      // El instante de cada acierto, precalculado una vez por vuelta: buscarlo dentro del bucle de
      // posiciones sería O(tamaño del anillo × pasos de la vuelta) en vez de O(pasos de la vuelta).
      const utcMsAtPosition = new Map(steps.map((step) => [step.position, step.utcMs]));
      for (let index = 0; index < size; index += 1) {
        const rel = (index - anchorPosition + size) % size;
        const tagId = ring[index] as string;
        const cell = cellFor(pairs, tagId, agvId);

        if (readPositions.has(index)) {
          // Leyó el tag: no hay forma de leerlo sin estar ahí.
          pass(cell, tagId, agvId, utcMsAtPosition.get(index) as number, true, "byNeighbours");
          continue;
        }

        const bracket = enclose(steps, rel);
        if (bracket === null) continue; // No se le vio a los dos lados: no hay paso que contar.

        const gap = bracket.after.rel - bracket.before.rel - 1;
        if (gap <= thresholds.maxGapProvenByNeighbours) {
          pass(cell, tagId, agvId, bracket.after.utcMs, false, "byNeighbours");
          continue;
        }

        const expected = expectedTime(segmentMedian, bracket.before.rel, bracket.after.rel, anchorPosition, size);
        const observed = bracket.after.utcMs - bracket.before.utcMs;

        if (expected !== null) {
          // Con tiempo esperado, **decide el tiempo**. Recorrer el tramo en mucho menos de lo que
          // tarda es la firma de no haberlo recorrido, y buscar entonces otra vía que diga que sí
          // sería lavar una contradicción en vez de resolverla.
          if (observed >= expected * thresholds.minTimeRatio) {
            pass(cell, tagId, agvId, bracket.after.utcMs, false, "byTime");
          } else {
            cell.unproven += 1;
          }
          continue;
        }

        // Sin tiempo esperado —nadie lee esos segmentos seguidos— queda el orden: si salió del
        // tramo entre los mismos vehículos con los que entró, siguió en la línea (R-OPP-004).
        //
        // Pero solo donde el orden significa algo. R-FLO-006: el vecindario es firme en zona
        // cargada, **débil en zona vacía** porque ahí la reordenación está admitida, y **no
        // aplicable a una entrada en calle CO**, que es una salida legítima del orden. Donde es
        // débil, la firma baja de confianza en lugar de aplicarse igual — así que aquí no se
        // aplica, y el tramo se queda sin sostener, que es lo que de verdad se sabe.
        if (!stretchAllows(orderUsable, bracket.before.rel, bracket.after.rel, anchorPosition, size)) {
          orderWithheld += 1;
          cell.unproven += 1;
          continue;
        }

        if (keptConvoy(convoy, agvId, bracket.before, bracket.after, observed)) {
          pass(cell, tagId, agvId, bracket.after.utcMs, false, "byOrder");
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
        firstHitUtcMs: cell.firstHitUtcMs,
        lastHitUtcMs: cell.lastHitUtcMs,
        leadingMisses: cell.leadingMisses,
        trailingMisses: cell.trailingMisses,
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
    const isAnchor = tagId === anchor;
    // El ancla no se examina: su tasa es 1 por construcción (las vueltas se cortan justo por
    // ella), así que su línea temporal no tiene nada que un cambio pudiera revelar.
    const timeline = isAnchor ? undefined : tagTimelines.get(tagId);
    if (timeline !== undefined) timeline.sort((a, b) => a.utcMs - b.utcMs);

    return {
      tagId,
      position: index,
      isAnchor,
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
      ...trendFields(timeline, trendThresholds),
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
      // La línea temporal de un vehículo ya sale ordenada: sus vueltas se recorren en secuencia,
      // a diferencia de la de un tag, que mezcla vehículos procesados uno detrás de otro.
      return {
        agvId,
        laps,
        passes,
        hits,
        rate: passes === 0 ? null : hits / passes,
        unproven,
        ...trendFields(vehicleTimelines.get(agvId), trendThresholds),
      };
    })
    .sort((a, b) => a.agvId.localeCompare(b.agvId));

  return {
    cohortId,
    ring,
    tags,
    vehicles,
    supported: vehicles.some((vehicle) => vehicle.laps > 0),
    segmentsWithTime: segmentMedian.filter((value) => value !== null).length,
    orderWithheld,
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
 * Por cada posición del anillo, si el orden de convoy prueba algo ahí (R-FLO-006).
 *
 * Se calcula una vez y se consulta por posición, porque la pregunta aparece dentro del bucle de
 * vueltas × tags y resolverla ahí con dos búsquedas por celda multiplicaría el coste sin añadir
 * nada.
 *
 * Un tag sin zona declarada **no bloquea**: no se sabe si está en zona vacía, y suponerlo sería
 * inventarse la configuración que falta. Con las listas cargadas, la duda desaparece.
 */
function orderUsableByPosition(
  ring: readonly string[],
  limits: OrderEvidenceLimits,
): readonly boolean[] {
  return ring.map((tagId) => {
    if (limits.laneEntryTags.has(tagId)) return false;
    return limits.zoneOf.get(tagId) !== "vacio";
  });
}

/**
 * ¿Permite el tramo encerrado usar la vía de orden?
 *
 * Se miran **los dos extremos y todo lo de en medio**: basta con que el vehículo haya podido
 * reordenarse o entrar en una calle en cualquier punto del tramo para que salir por el mismo sitio
 * del convoy deje de demostrar que lo recorrió.
 */
function stretchAllows(
  orderUsable: readonly boolean[],
  fromRel: number,
  toRel: number,
  anchorPosition: number,
  size: number,
): boolean {
  for (let rel = fromRel; rel <= toRel; rel += 1) {
    if (orderUsable[(anchorPosition + rel) % size] === false) return false;
  }
  return true;
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

type PassVia = "byNeighbours" | "byTime" | "byOrder";

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
    cell = {
      passes: 0,
      hits: 0,
      byNeighbours: 0,
      byTime: 0,
      byOrder: 0,
      unproven: 0,
      firstHitUtcMs: null,
      lastHitUtcMs: null,
      leadingMisses: 0,
      trailingMisses: 0,
    };
    byTag.set(agvId, cell);
  }
  return cell;
}

function pushRecord(lines: Map<string, PassRecord[]>, key: string, record: PassRecord): void {
  let list = lines.get(key);
  if (list === undefined) {
    list = [];
    lines.set(key, list);
  }
  list.push(record);
}

/** Aplana el resultado de `detectTrend` en los campos opcionales de una fila. Sin línea, sin campos. */
function trendFields(
  timeline: readonly PassRecord[] | undefined,
  thresholds: TrendThresholds,
): Pick<TagReadRow, "changedAtUtcMs" | "rateBefore" | "rateAfter" | "trend" | "segmentRates" | "trendSeries"> {
  if (timeline === undefined) return {};
  const result = detectTrend(timeline, thresholds);
  if (result.kind === "sin-cambio") return {};
  const series = binTimeline(timeline, TREND_SERIES_BINS);
  const seriesField = series === null ? {} : { trendSeries: series };
  if (result.kind === "rotura-candidata") {
    return {
      changedAtUtcMs: result.changedAtUtcMs,
      rateBefore: result.rateBefore,
      rateAfter: result.rateAfter,
      ...seriesField,
    };
  }
  return { trend: "bajando", segmentRates: result.segmentRates, ...seriesField };
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
