/**
 * Grafo observado: qué tag va después de cuál (FR-009, FR-011, R-GRA-002).
 *
 * Es el cimiento de F2 y el sitio donde tres reglas dejan de ser texto. Ninguna de las tres es una
 * sutileza: las tres producen un grafo **plausible y equivocado**, que es la peor clase de error
 * porque no deja síntoma.
 *
 * 1. **Dos lecturas del mismo vehículo en el mismo instante no ordenan nada** (R-DAT-013). Su orden
 *    es posición de pila, no medida del reloj, así que la arista aparece en las dos direcciones
 *    según la pasada y la minoritaria simula un desvío que nunca ocurrió. Se cuentan aparte y una
 *    arista sostenida sobre ellas no puede ser `observed` en su orden.
 * 2. **Una transición que cruza un hueco de cobertura no es una transición** (R-DAT-007). Entre dos
 *    ventanas separadas por semanas, la última lectura de una y la primera de la otra son
 *    consecutivas *en la lista* y no en la realidad. Emparejarlas inventa una arista entre dos
 *    puntos cualesquiera del circuito, y además con un tiempo de tramo de treinta y ocho días.
 *    Y «cruzar» se mide con los dos extremos: la cola cortada de una exportación está fuera de su
 *    tramo de cobertura, así que una transición solo vale si **ambas** lecturas caen en el mismo
 *    tramo. Con el criterio anterior —encerrar un hueco entero— la cola se emparejaba con la primera
 *    lectura de la ventana siguiente y el hueco no se veía.
 * 3. **Secuencia y tiempo son dos afirmaciones distintas.** Con resolución de minuto, el 71 % de las
 *    transiciones tiene Δt cero: la secuencia es `observed` y el tiempo `unknown`. Publicar una
 *    mediana calculada sobre ceros sería inventar precisión.
 *
 * Lo que este módulo **no** hace: no reconstruye el anillo, no agrupa circuitos y no diagnostica.
 * Produce las aristas con su soporte, su cuota y su estado de verdad; quién las recorre y qué
 * significan viene después.
 */

import { mergeIntervals, sameSpan, type Interval } from "./coverage.js";
import { sortReadings, type SourceDirection } from "./order.js";
import type { Reading } from "./reading.js";
import { isOrderReliable } from "./time.js";
import type { TruthState } from "./truth.js";

/**
 * Umbrales del grafo.
 *
 * **Sin valores por defecto, a propósito.** Son magnitudes de planta y
 * `AI_DEVELOPMENT_GOVERNANCE.md` §4 prohíbe fijarlas en el código; un valor por defecto es una
 * constante industrial disfrazada con el agravante de que nadie la ve. Van a configuración
 * versionada (`CONFIG_SCHEMA.md` §3.5, `min_support`).
 */
export interface GraphThresholds {
  /** Cuota mínima del sucesor sobre las salidas de su nodo para afirmar la arista. */
  readonly minShareForObserved: number;
  /** Transiciones mínimas. Una cuota del 100 % sobre dos pasadas no es consenso. */
  readonly minSupportForObserved: number;
  /**
   * Proporción de transiciones en el mismo instante por encima de la cual el orden no lo da el
   * reloj. Superado, la arista existe pero su **orden** es `inferred` (R-DAT-013).
   */
  readonly maxSameInstantShare: number;
  /**
   * Resolución medida de la fuente, en milisegundos.
   *
   * No es un umbral elegido: es una propiedad del fichero que el importador mide (R-DAT-015). Solo
   * los intervalos que la superan cuentan para la estadística de tiempos.
   */
  readonly resolutionMs: number;
}

/** Una transición observada entre dos lecturas consecutivas del mismo vehículo. */
export interface Transition {
  readonly agvId: string;
  readonly from: string;
  readonly to: string;
  readonly fromTime: number;
  readonly toTime: number;
  /** El reloj no separa las dos lecturas: su orden es posición de pila (R-DAT-013). */
  readonly sameInstant: boolean;
}

/** Estadística de tiempo de un tramo, y si se puede afirmar algo de ella. */
export interface EdgeTime {
  /** Transiciones cuyo intervalo supera la resolución de la fuente. Solo estas cuentan. */
  readonly measurable: number;
  readonly medianMs: number | null;
  readonly p90Ms: number | null;
  /** `observed` si hay medida; `unknown` si la resolución no deja medir. Nunca se interpola. */
  readonly truth: TruthState;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  /** Transiciones que la recorren. */
  readonly support: number;
  /** Vehículos distintos que la recorren. Un soporte alto de un solo AGV no es consenso. */
  readonly vehicles: number;
  /** Cuota entre las salidas de `from`, en tanto por uno. */
  readonly share: number;
  /** De `support`, cuántas caen en el mismo instante. */
  readonly sameInstant: number;
  /** Qué ordenó esta arista: el reloj, o la posición en la pila. */
  readonly orderEvidence: "reloj" | "mismo-instante";
  /** Estado de verdad de la **secuencia**. El del tiempo va aparte, en `time`. */
  readonly truth: TruthState;
  readonly time: EdgeTime;
}

export interface Node {
  readonly tagId: string;
  readonly readings: number;
  readonly vehicles: number;
  readonly outgoing: number;
  readonly incoming: number;
}

export interface ObservedGraph {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  /** Transiciones aceptadas. */
  readonly transitions: number;
  /**
   * Pares consecutivos descartados por cruzar un hueco de cobertura.
   *
   * Se publica en lugar de descartarse en silencio: si esta cifra es alta, lo que se está mirando
   * son varias ventanas separadas y conviene saberlo antes de leer el grafo.
   */
  readonly discardedAcrossGaps: number;
  /**
   * Pares consecutivos descartados porque una de las dos lecturas cae en una hora repetida o
   * inexistente del cambio estacional sin resolver (`dst_ambiguous` o `dst_nonexistent`, ADR-0013).
   * Una hora repetida resuelta por la posición en el fichero (`dst_by_position`, OQ-137) sí ordena.
   *
   * Dentro de esa hora el instante calculado no separa las dos ocurrencias, así que el orden de las
   * lecturas no lo da el reloj y una arista construida sobre ellas afirmaría una secuencia que nadie
   * midió. Se cuentan en vez de descartarse en silencio, para que quien vea el grafo de esa noche
   * sepa qué parte de la secuencia se dejó fuera.
   */
  readonly discardedUnreliableTime: number;
  /** Transiciones aceptadas cuyo orden no lo da el reloj (R-DAT-013). */
  readonly sameInstantTransitions: number;
}

/**
 * Extrae las transiciones de un conjunto de lecturas.
 *
 * Las lecturas se ordenan aquí con el sentido detectado de la fuente: pedirlas ya ordenadas
 * invitaría a que alguien las pasara tal como vienen del fichero —que es orden de pila, no
 * cronológico— y el grafo saldría del revés sin avisar.
 */
export function buildTransitions(
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
): {
  transitions: readonly Transition[];
  discardedAcrossGaps: number;
  discardedUnreliableTime: number;
} {
  const ordered = sortReadings([...readings], direction);
  const spans = mergeIntervals(coverage);

  const lastByVehicle = new Map<string, Reading>();
  const transitions: Transition[] = [];
  let discardedAcrossGaps = 0;
  let discardedUnreliableTime = 0;

  for (const entry of ordered) {
    const previous = lastByVehicle.get(entry.agvId);
    lastByVehicle.set(entry.agvId, entry);
    if (previous === undefined) continue;

    // Hora repetida o inexistente en cualquiera de los dos extremos: el reloj no ordena ese par
    // (ADR-0013) y no se afirma nada sobre él. La lectura sigue siendo evidencia de que el vehículo
    // estuvo ahí; lo que no se sostiene es su secuencia.
    if (!isOrderReliable(previous.time.flag) || !isOrderReliable(entry.time.flag)) {
      discardedUnreliableTime += 1;
      continue;
    }

    const fromTime = previous.time.utcMs;
    const toTime = entry.time.utcMs;
    if (!sameSpan(spans, fromTime, toTime)) {
      discardedAcrossGaps += 1;
      continue;
    }

    transitions.push({
      agvId: entry.agvId,
      from: previous.tagId,
      to: entry.tagId,
      fromTime,
      toTime,
      sameInstant: fromTime === toTime,
    });
  }

  return { transitions, discardedAcrossGaps, discardedUnreliableTime };
}

/** Construye el grafo observado a partir de las lecturas acumuladas de un circuito. */
export function buildObservedGraph(
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
  thresholds: GraphThresholds,
): ObservedGraph {
  const { transitions, discardedAcrossGaps, discardedUnreliableTime } = buildTransitions(
    readings,
    direction,
    coverage,
  );

  const accumulators = new Map<string, EdgeAccumulator>();
  const outgoingByNode = new Map<string, number>();
  let sameInstantTransitions = 0;

  for (const transition of transitions) {
    if (transition.sameInstant) sameInstantTransitions += 1;
    outgoingByNode.set(transition.from, (outgoingByNode.get(transition.from) ?? 0) + 1);

    const key = `${transition.from}\u0000${transition.to}`;
    let accumulator = accumulators.get(key);
    if (accumulator === undefined) {
      accumulator = {
        from: transition.from,
        to: transition.to,
        support: 0,
        sameInstant: 0,
        vehicles: new Set<string>(),
        deltas: [],
      };
      accumulators.set(key, accumulator);
    }
    accumulator.support += 1;
    accumulator.vehicles.add(transition.agvId);
    if (transition.sameInstant) accumulator.sameInstant += 1;

    const delta = transition.toTime - transition.fromTime;
    // Solo por encima de la resolución. Un Δt de cero no es «tardó nada»: es «el reloj no lo mide».
    if (delta > thresholds.resolutionMs) accumulator.deltas.push(delta);
  }

  const edges: Edge[] = [];
  for (const accumulator of accumulators.values()) {
    const outgoing = outgoingByNode.get(accumulator.from) ?? accumulator.support;
    const share = accumulator.support / outgoing;
    const sameInstantShare = accumulator.sameInstant / accumulator.support;
    const orderEvidence = sameInstantShare > thresholds.maxSameInstantShare ? "mismo-instante" : "reloj";

    edges.push({
      from: accumulator.from,
      to: accumulator.to,
      support: accumulator.support,
      vehicles: accumulator.vehicles.size,
      share,
      sameInstant: accumulator.sameInstant,
      orderEvidence,
      truth: sequenceTruth(accumulator, share, orderEvidence, thresholds),
      time: summariseTime(accumulator.deltas),
    });
  }

  edges.sort((a, b) => (a.from === b.from ? b.support - a.support : a.from < b.from ? -1 : 1));

  return {
    nodes: buildNodes(readings, edges),
    edges,
    transitions: transitions.length,
    discardedAcrossGaps,
    discardedUnreliableTime,
    sameInstantTransitions,
  };
}

interface EdgeAccumulator {
  from: string;
  to: string;
  support: number;
  sameInstant: number;
  vehicles: Set<string>;
  deltas: number[];
}

/**
 * Estado de verdad de la secuencia.
 *
 * Una arista mayoritariamente construida sobre pares del mismo instante **nunca** es `observed`,
 * por mucha cuota y mucho soporte que tenga: lo que la sostiene no es el reloj (R-DAT-013).
 */
function sequenceTruth(
  accumulator: EdgeAccumulator,
  share: number,
  orderEvidence: "reloj" | "mismo-instante",
  thresholds: GraphThresholds,
): TruthState {
  if (orderEvidence === "mismo-instante") return "inferred";
  if (
    share >= thresholds.minShareForObserved &&
    accumulator.support >= thresholds.minSupportForObserved
  ) {
    return "observed";
  }
  return "inferred";
}

/** Sin una sola medida por encima de la resolución, el tiempo es `unknown`. No se interpola. */
function summariseTime(deltas: readonly number[]): EdgeTime {
  if (deltas.length === 0) {
    return { measurable: 0, medianMs: null, p90Ms: null, truth: "unknown" };
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  return {
    measurable: sorted.length,
    medianMs: quantile(sorted, 0.5),
    p90Ms: quantile(sorted, 0.9),
    truth: "observed",
  };
}

/**
 * Cuantil por rango sobre una lista ya ordenada; lo reutilizan las horquillas por tramo.
 *
 * **Precondición: lista no vacía.** Con una lista vacía devuelve 0, que no es un cuantil sino la
 * ausencia de muestras (B-05, revisión del 2026-10-18). No se cambia la firma porque todos los
 * llamadores comprueban antes la longitud (o la mínima de muestras, que es mayor que cero); quien
 * la llame de nuevo tiene que hacer lo mismo y tratar «sin muestras» como `null`/`unknown`, nunca
 * como cero.
 */
export function quantile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index] ?? 0;
}

/**
 * Recorre una lista fija por posiciones, como `quantile` una utilidad de lista que no es del grafo.
 *
 * `minKeyScanner(keys)` devuelve un recorrido `(from, to, accept, visit)` que llama a `visit` con
 * cada posición de `[from, to)` cuya clave acepta `accept`, **en orden de posición**, sin mirar una a
 * una las que no: guarda el mínimo de cada bloque y salta los bloques cuyo mínimo no se acepta. Si
 * `visit` devuelve `true`, el recorrido se corta ahí.
 *
 * Precondiciones: `accept` es monótona —si acepta una clave, acepta cualquier otra menor— y las
 * claves son números finitos. Construirlo cuesta O(n) y cada recorrido O((k + 1) · log n) para k
 * posiciones aceptadas. Es lo que sustituye a los «para cada uno, todos los posteriores» de FIFO,
 * calles y cortes de conexión (B-09, revisión del 2026-10-18), con el mismo resultado y el mismo
 * orden que la versión cuadrática (`tests/unit/equivalencia-rendimiento.test.ts`).
 */
export function minKeyScanner(
  keys: readonly number[],
): (from: number, to: number, accept: (key: number) => boolean, visit: (index: number) => boolean | void) => void {
  const count = keys.length;
  let size = 1;
  while (size < count) size *= 2;
  // Árbol de mínimos en un array: el nodo `i` tiene a `2i` y `2i + 1` por hijos; las hojas empiezan en
  // `size`. El relleno con +∞ nunca se visita como hoja (el recorrido se acota a `count`).
  const tree = new Float64Array(2 * size).fill(Number.POSITIVE_INFINITY);
  for (let index = 0; index < count; index += 1) tree[size + index] = keys[index] as number;
  for (let node = size - 1; node >= 1; node -= 1) tree[node] = Math.min(tree[2 * node] as number, tree[2 * node + 1] as number);
  return (from, to, accept, visit) => {
    const end = Math.min(to, count);
    const walk = (node: number, low: number, high: number): boolean => {
      if (high <= from || low >= end || !accept(tree[node] as number)) return false;
      if (high - low === 1) return visit(low) === true;
      const middle = (low + high) >> 1;
      return walk(2 * node, low, middle) || walk(2 * node + 1, middle, high);
    };
    if (from < end) walk(1, 0, size);
  };
}

function buildNodes(readings: readonly Reading[], edges: readonly Edge[]): readonly Node[] {
  const readingCount = new Map<string, number>();
  const vehicles = new Map<string, Set<string>>();
  for (const entry of readings) {
    readingCount.set(entry.tagId, (readingCount.get(entry.tagId) ?? 0) + 1);
    let set = vehicles.get(entry.tagId);
    if (set === undefined) {
      set = new Set<string>();
      vehicles.set(entry.tagId, set);
    }
    set.add(entry.agvId);
  }

  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  return [...readingCount.keys()].sort().map((tagId) => ({
    tagId,
    readings: readingCount.get(tagId) ?? 0,
    vehicles: vehicles.get(tagId)?.size ?? 0,
    outgoing: outgoing.get(tagId) ?? 0,
    incoming: incoming.get(tagId) ?? 0,
  }));
}

/**
 * El sucesor dominante de un tag, si lo hay.
 *
 * Es el paso que reconstruye el anillo, y por eso devuelve la arista entera y no solo el tag: quien
 * la use tiene que poder ver con qué cuota y con qué estado de verdad la está siguiendo.
 */
export function dominantSuccessor(graph: ObservedGraph, tagId: string): Edge | null {
  let best: Edge | null = null;
  for (const edge of graph.edges) {
    if (edge.from !== tagId) continue;
    if (best === null || edge.support > best.support) best = edge;
  }
  return best;
}
