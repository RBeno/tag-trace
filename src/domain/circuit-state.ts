/**
 * El estado normal del circuito (R-TIM-009): lo que se mide con la horquilla de cada tramo, solo en
 * régimen de producción, para que las paradas, los descansos y la noche no lo alteren.
 *
 * Con esa medida estándar se buscan tres cosas, cada una por un hecho distinto y contra lo que da el
 * azar **según cuántas veces se pasa por cada sitio**, no contra un número fijo:
 *
 * | Hallazgo | Hecho | Regla |
 * |---|---|---|
 * | Cuello de botella | se concentran las retenciones: AGV que esperan detrás de otro que no se va | R-FLO-008 |
 * | Punto conflictivo | se concentran las paradas sin explicación, de varios AGV | R-FLO-009 |
 * | Zona oscura | el hueco entre dos lecturas al pasar por ahí es mucho mayor que el típico del circuito | R-GRA-014 |
 *
 * Además, las paradas sin explicación una a una —el ejemplo del propietario: 80 s donde se tarda 17,
 * sin nadie delante y con el resto avanzando— y la noche, medida aparte.
 *
 * Nada de esto nombra causas (R-EVI-006). Una cola que fluye es un cuello de botella, no una avería;
 * un punto conflictivo dice dónde, no por qué; una zona oscura dice que ahí falta información, y de
 * qué tipo: un tag que se salta o un tramo que tarda.
 */

import type { Transition } from "./graph.js";
import type { FlowReport, Retention, VehicleStop } from "./flow-stops.js";
import {
  pairKey,
  transitionRegime,
  type Regime,
  type SegmentBands,
} from "./segment-bands.js";

export interface CircuitStateThresholds {
  /** Cuántas veces el hueco típico del circuito tiene que durar un tramo para ser zona oscura. */
  readonly darkZoneFactor: number;
  /** Puntos marcados por azar que se aceptan en todo el circuito, como máximo. */
  readonly maxFalsePoints: number;
}

export interface CircuitStateInput {
  readonly bands: SegmentBands;
  /** Transiciones medibles del cohorte, sin las paradas de la producción. */
  readonly transitions: readonly Transition[];
  readonly regimeOf: (utcMs: number) => Regime;
  readonly flow: FlowReport;
  /** Tags cuya espera está explicada —parada precisa o semáforo, declarados o candidatos— y su clase. */
  readonly timeCritical: ReadonlyMap<string, string>;
  readonly reachTags: number;
  /** AGV distintos que hacen falta para hablar de un sitio y no de un AGV. */
  readonly minVehicles: number;
  /** A partir de este exceso, una parada sin explicación ya es un bloqueo y se enseña con la flota. */
  readonly headStallMs: number;
}

export interface ConflictPoint {
  readonly tags: readonly string[];
  readonly stops: number;
  /** Lo que daría el azar con las pasadas de esos tags y el ritmo de paradas de todo el circuito. */
  readonly expected: number;
  readonly passes: number;
  readonly vehicles: readonly string[];
  /** Si todas son de un solo AGV: es de ese AGV, no del sitio. */
  readonly ofOneVehicle: string | null;
}

export interface Bottleneck {
  readonly tagId: string;
  /** Transiciones retenidas por la cola que empieza en este tag. */
  readonly retentions: number;
  /** Lo que daría el azar con el tiempo que los AGV pasan en este tag y el ritmo de todo el circuito. */
  readonly expected: number;
  readonly passes: number;
  /** Veces que se formó la cola: retenciones que se solapan en el tiempo cuentan como una. */
  readonly episodes: number;
  readonly longestQueue: number;
  readonly waitMs: number;
  readonly vehicles: number;
  /** Bloqueos en este tag: sin ninguno, la cola fluye. */
  readonly blockages: number;
}

export interface DarkZone {
  readonly tags: readonly string[];
  /** El hueco mediano entre lecturas en el tramo más oscuro de la zona. */
  readonly gapMs: number;
  /** El hueco típico del circuito: la mediana de todos los tramos. */
  readonly typicalMs: number;
  /** Proporción de pasadas que se saltan algún tag de la zona. */
  readonly skipShare: number;
  readonly cause: "salta-tag" | "tramo-largo";
}

export interface NightSegment {
  readonly from: string;
  readonly to: string;
  readonly produccionP50Ms: number;
  readonly nocheP50Ms: number;
}

export interface CircuitState {
  readonly bottlenecks: readonly Bottleneck[];
  readonly conflictPoints: readonly ConflictPoint[];
  readonly darkZones: readonly DarkZone[];
  /** Tramos que serían zona oscura, pero su espera la explica una parada precisa o un semáforo. */
  readonly explainedSlow: readonly { readonly tagId: string; readonly function: string; readonly gapMs: number }[];
  readonly typicalGapMs: number | null;
  /** Paradas sin explicación por debajo de bloqueo, de mayor a menor exceso. */
  readonly unexplained: { readonly produccion: readonly VehicleStop[]; readonly noche: readonly VehicleStop[] };
  /** Tramos donde la noche más se aleja de la producción. */
  readonly night: readonly NightSegment[];
}

/** P(X ≥ k) con X de Poisson de media `lambda`, sumando en logaritmos. */
export function poissonTail(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  const logLambda = Math.log(lambda);
  let logTerm = -lambda;
  let logCdf = logTerm;
  for (let i = 1; i < k; i += 1) {
    logTerm += logLambda - Math.log(i);
    const high = Math.max(logCdf, logTerm);
    logCdf = high + Math.log(Math.exp(logCdf - high) + Math.exp(logTerm - high));
  }
  return Math.max(0, 1 - Math.exp(logCdf));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Lo que daría el azar en un sitio: el resto del circuito repartido según la exposición de ese sitio.
 * El ritmo se estima **sin** el propio sitio —si no, un grupo grande de paradas subiría el ritmo con
 * el que se le compara y se escondería a sí mismo—, y con una más repartida por todo el circuito,
 * para que dos paradas solas en un circuito sin ninguna otra no parezcan un patrón.
 */
export function expectedElsewhere(total: number, count: number, exposure: number, totalExposure: number): number {
  return totalExposure === 0 ? 0 : ((total - count + 1) * exposure) / totalExposure;
}

/**
 * Los tags donde un recuento se concentra más de lo que da el azar: se reparte el resto del circuito
 * según la exposición de cada tag —sus pasadas, o el tiempo que los AGV pasan con él como último tag
 * leído—, y se marca el que tiene tantos que, con todos los tags del circuito mirados a la vez, saldría
 * por casualidad menos de `maxFalsePoints` veces.
 */
export function concentrated(
  counts: ReadonlyMap<string, number>,
  exposure: ReadonlyMap<string, number>,
  maxFalsePoints: number,
): Map<string, number> {
  const totalCount = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const totalExposure = [...exposure.values()].reduce((sum, value) => sum + value, 0);
  const flagged = new Map<string, number>();
  if (totalCount === 0 || totalExposure === 0) return flagged;
  const tags = Math.max(1, exposure.size);
  for (const [tagId, count] of counts) {
    if (count < 2) continue;
    const expected = expectedElsewhere(totalCount, count, exposure.get(tagId) ?? 0, totalExposure);
    if (tags * poissonTail(count, expected) <= maxFalsePoints) flagged.set(tagId, expected);
  }
  return flagged;
}

export function buildCircuitState(input: CircuitStateInput, thresholds: CircuitStateThresholds): CircuitState {
  const { bands, flow, regimeOf } = input;
  const ring = bands.ring;
  const size = ring.length;
  const production = input.transitions.filter((transition) => transitionRegime(transition, regimeOf) === "produccion");
  const passes = new Map<string, number>();
  /** Tiempo que los AGV pasan con cada tag como último leído: lo que un AGV ahí puede retener. */
  const occupancy = new Map<string, number>();
  for (const transition of production) {
    passes.set(transition.from, (passes.get(transition.from) ?? 0) + 1);
    occupancy.set(transition.from, (occupancy.get(transition.from) ?? 0) + transition.toTime - transition.fromTime);
  }

  /** Tags a `reachTags` o menos en el anillo se unen; fuera del anillo, cada uno va solo. */
  const groupNearby = (tags: readonly string[]): string[][] => {
    const onRing = tags
      .filter((tagId) => bands.positionOf.has(tagId))
      .sort((a, b) => (bands.positionOf.get(a) as number) - (bands.positionOf.get(b) as number));
    const groups: string[][] = [];
    for (const tagId of onRing) {
      const last = groups[groups.length - 1];
      const previous = last?.[last.length - 1];
      const gap =
        previous === undefined
          ? Infinity
          : ((bands.positionOf.get(tagId) as number) - (bands.positionOf.get(previous) as number) + size) % size;
      if (last !== undefined && gap <= input.reachTags) last.push(tagId);
      else groups.push([tagId]);
    }
    // El primero y el último pueden tocarse dando la vuelta al anillo.
    const first = groups[0];
    const last = groups[groups.length - 1];
    if (groups.length > 1 && first !== undefined && last !== undefined) {
      const wrap =
        ((bands.positionOf.get(first[0] as string) as number) - (bands.positionOf.get(last[last.length - 1] as string) as number) + size) %
        size;
      if (wrap <= input.reachTags) {
        groups.pop();
        groups[0] = [...last, ...first];
      }
    }
    return [...groups, ...tags.filter((tagId) => !bands.positionOf.has(tagId)).map((tagId) => [tagId])];
  };

  // --- Puntos conflictivos: paradas sin explicación concentradas (R-FLO-009) -------------------
  //
  // «Cerca», no «en el mismo tag»: se mira cada ventana de tags vecinos —el tag y `reachTags` a cada
  // lado—, con sus pasadas, porque unas paradas repartidas entre dos o tres tags seguidos son el mismo
  // sitio aunque ninguno por separado llame la atención.
  const unexplainedProduction = flow.stops.filter(
    (stop) => stop.justification === "sin-explicacion" && stop.regime === "produccion",
  );
  const stopCounts = new Map<string, number>();
  for (const stop of unexplainedProduction) stopCounts.set(stop.fromTagId, (stopCounts.get(stop.fromTagId) ?? 0) + 1);
  const totalStops = unexplainedProduction.length;
  const totalPasses = [...passes.values()].reduce((sum, value) => sum + value, 0);
  const conflictTags = new Set<string>();
  const windows = Math.max(1, passes.size);
  const windowOf = (center: number): string[] =>
    Array.from({ length: 2 * input.reachTags + 1 }, (_, offset) => ring[(center + offset - input.reachTags + size) % size] as string);
  if (totalStops > 0 && size > 1) {
    for (let center = 0; center < size; center += 1) {
      const tags = windowOf(center);
      const count = tags.reduce((sum, tagId) => sum + (stopCounts.get(tagId) ?? 0), 0);
      if (count < 2) continue;
      const exposure = tags.reduce((sum, tagId) => sum + (passes.get(tagId) ?? 0), 0);
      const expected = expectedElsewhere(totalStops, count, exposure, totalPasses);
      if (windows * poissonTail(count, expected) > thresholds.maxFalsePoints) continue;
      for (const tagId of tags) if ((stopCounts.get(tagId) ?? 0) > 0) conflictTags.add(tagId);
    }
  }
  // Fuera del anillo no hay vecinos: cada tag va solo.
  for (const [tagId, count] of stopCounts) {
    if (bands.positionOf.has(tagId) || count < 2) continue;
    const expected = expectedElsewhere(totalStops, count, passes.get(tagId) ?? 0, totalPasses);
    if (windows * poissonTail(count, expected) <= thresholds.maxFalsePoints) conflictTags.add(tagId);
  }
  const conflictPoints: ConflictPoint[] = groupNearby([...conflictTags])
    .map((tags) => {
      const set = new Set(tags);
      const stops = unexplainedProduction.filter((stop) => set.has(stop.fromTagId));
      const vehicles = [...new Set(stops.map((stop) => stop.agvId))].sort();
      const groupPasses = tags.reduce((sum, tagId) => sum + (passes.get(tagId) ?? 0), 0);
      return {
        tags,
        stops: stops.length,
        expected: expectedElsewhere(totalStops, stops.length, groupPasses, totalPasses),
        passes: groupPasses,
        vehicles,
        ofOneVehicle: vehicles.length < input.minVehicles ? (vehicles[0] ?? null) : null,
      };
    })
    .sort((a, b) => (a.ofOneVehicle === null ? 0 : 1) - (b.ofOneVehicle === null ? 0 : 1) || b.stops - a.stops);

  // --- Cuellos de botella: retenciones concentradas en la cabeza de la cola (R-FLO-008) --------
  const productionRetentions = flow.retentions.filter((retention) => retention.regime === "produccion");
  const retentionsOf = new Map<string, Retention[]>();
  for (const retention of productionRetentions) {
    retentionsOf.set(retention.agvId, [...(retentionsOf.get(retention.agvId) ?? []), retention]);
  }
  /** La cola se atribuye a su cabeza: si quien retenía también estaba retenido, se sigue hacia delante. */
  const frontTagOf = (retention: Retention): string => {
    let current = retention;
    const seen = new Set<Retention>([retention]);
    for (;;) {
      const middle = (current.fromUtcMs + current.toUtcMs) / 2;
      const next = retentionsOf
        .get(current.holderAgvId)
        ?.find((candidate) => candidate.fromUtcMs <= middle && middle <= candidate.toUtcMs);
      if (next === undefined || seen.has(next)) return current.holderTagId;
      seen.add(next);
      current = next;
    }
  };
  const byFront = new Map<string, Retention[]>();
  for (const retention of productionRetentions) {
    const front = frontTagOf(retention);
    byFront.set(front, [...(byFront.get(front) ?? []), retention]);
  }
  // La exposición es el tiempo, no las pasadas: un AGV retiene a los de detrás mientras está ahí, y en
  // un tramo largo o con tags que se leen poco se queda más tiempo como «último leído» sin estar parado.
  const bottleneckFlags = concentrated(
    new Map([...byFront].map(([tagId, list]) => [tagId, list.length])),
    occupancy,
    thresholds.maxFalsePoints,
  );
  const bottlenecks: Bottleneck[] = [...bottleneckFlags]
    .map(([tagId, expected]) => {
      const list = [...(byFront.get(tagId) ?? [])].sort((a, b) => a.fromUtcMs - b.fromUtcMs);
      // Episodios: grupos de retenciones que se solapan; la cola más larga, el máximo simultáneo.
      let episodes = 0;
      let longestQueue = 0;
      let groupEnd = -Infinity;
      let group: Retention[] = [];
      const closeGroup = (): void => {
        if (group.length === 0) return;
        const edges = group.flatMap((entry) => [
          { at: entry.fromUtcMs, delta: 1 },
          { at: entry.toUtcMs, delta: -1 },
        ]);
        edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
        let open = 0;
        for (const edge of edges) {
          open += edge.delta;
          longestQueue = Math.max(longestQueue, open);
        }
        episodes += 1;
        group = [];
      };
      for (const retention of list) {
        if (retention.fromUtcMs > groupEnd) closeGroup();
        group.push(retention);
        groupEnd = Math.max(groupEnd, retention.toUtcMs);
      }
      closeGroup();
      return {
        tagId,
        retentions: list.length,
        expected,
        passes: passes.get(tagId) ?? 0,
        episodes,
        longestQueue,
        waitMs: list.reduce((sum, entry) => sum + Math.max(0, entry.waitMs), 0),
        vehicles: new Set(list.map((entry) => entry.agvId)).size,
        blockages: flow.blockages.filter((blockage) => blockage.tagId === tagId).length,
      };
    })
    .sort((a, b) => b.retentions - b.expected - (a.retentions - a.expected));

  // --- Zonas oscuras: el hueco entre dos lecturas al pasar por cada tramo (R-GRA-014) ----------
  const gapsOf = Array.from({ length: size }, (): number[] => []);
  const skipsOf = new Array<number>(size).fill(0);
  if (size > 1) {
    for (const transition of production) {
      const from = bands.positionOf.get(transition.from);
      const to = bands.positionOf.get(transition.to);
      if (from === undefined || to === undefined || from === to) continue;
      const skipped = (to - from - 1 + size) % size;
      if (skipped >= size / 2) continue; // Media vuelta sin leer no dice dónde falta la información.
      const duration = transition.toTime - transition.fromTime;
      for (let step = 0; step <= skipped; step += 1) {
        const segment = (from + step) % size;
        gapsOf[segment]?.push(duration);
        if (skipped > 0) skipsOf[segment] = (skipsOf[segment] ?? 0) + 1;
      }
    }
  }
  const segmentGap = gapsOf.map((values) => median(values));
  const typicalGapMs = median(segmentGap.filter((value): value is number => value !== null));
  const darkSegments: boolean[] = new Array<boolean>(size).fill(false);
  const explainedSlow: { tagId: string; function: string; gapMs: number }[] = [];
  if (typicalGapMs !== null) {
    segmentGap.forEach((gapMs, index) => {
      if (gapMs === null || gapMs < thresholds.darkZoneFactor * typicalGapMs) return;
      const tagId = ring[index] as string;
      const explained = input.timeCritical.get(tagId);
      if (explained !== undefined) explainedSlow.push({ tagId, function: explained, gapMs });
      else darkSegments[index] = true;
    });
  }
  const darkZones: DarkZone[] = [];
  if (typicalGapMs !== null && darkSegments.some(Boolean) && !darkSegments.every(Boolean)) {
    // Se empieza justo después de un tramo claro para no partir en dos una zona que da la vuelta.
    const startAt = (darkSegments.indexOf(false) + 1) % size;
    let current: number[] = [];
    const close = (): void => {
      if (current.length === 0) return;
      const tags = [...current.map((index) => ring[index] as string), ring[((current[current.length - 1] as number) + 1) % size] as string];
      const samples = current.reduce((sum, index) => sum + (gapsOf[index]?.length ?? 0), 0);
      const skips = current.reduce((sum, index) => sum + (skipsOf[index] ?? 0), 0);
      const skipShare = samples === 0 ? 0 : skips / samples;
      darkZones.push({
        tags,
        gapMs: Math.max(...current.map((index) => segmentGap[index] ?? 0)),
        typicalMs: typicalGapMs,
        skipShare,
        cause: skipShare >= 0.5 ? "salta-tag" : "tramo-largo",
      });
      current = [];
    };
    for (let offset = 0; offset < size; offset += 1) {
      const index = (startAt + offset) % size;
      if (darkSegments[index]) current.push(index);
      else close();
    }
    close();
    darkZones.sort((a, b) => b.gapMs / b.typicalMs - a.gapMs / a.typicalMs);
  }

  // --- Paradas sin explicación, una a una, y la noche -----------------------------------------
  const isolated = (regime: Regime): VehicleStop[] =>
    flow.stops
      .filter((stop) => stop.justification === "sin-explicacion" && stop.regime === regime && stop.excessMs < input.headStallMs)
      .sort((a, b) => b.excessMs - a.excessMs);
  const night: NightSegment[] = [];
  for (let index = 0; index < size && size > 1; index += 1) {
    const from = ring[index] as string;
    const to = ring[(index + 1) % size] as string;
    const pair = bands.pairs.get(pairKey(from, to));
    if (pair?.produccion == null || pair.noche == null) continue;
    night.push({ from, to, produccionP50Ms: pair.produccion.p50Ms, nocheP50Ms: pair.noche.p50Ms });
  }
  night.sort(
    (a, b) =>
      Math.abs(Math.log(b.nocheP50Ms / Math.max(1, b.produccionP50Ms))) -
      Math.abs(Math.log(a.nocheP50Ms / Math.max(1, a.produccionP50Ms))),
  );

  return {
    bottlenecks,
    conflictPoints,
    darkZones,
    explainedSlow,
    typicalGapMs,
    unexplained: { produccion: isolated("produccion"), noche: isolated("noche") },
    night,
  };
}
