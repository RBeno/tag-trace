/**
 * Paradas leídas contra el flujo (R-AGV-018, R-AGV-008, R-COM-003, R-FLO-005).
 *
 * Un AGV sin lecturas no ha salido del circuito: **ningún AGV cambia de circuito**, y un AGV parado
 * no emite (R-AGV-006). Lo que hay que saber de un hueco es qué hacía el resto mientras tanto. Así
 * funciona la planta, según el propietario:
 *
 * - Nadie para toda la línea. El servidor detiene los medios productivos vinculados, que van en
 *   paralelo a la línea, y los AGV en tránsito siguen hasta encontrar un obstáculo: el de delante,
 *   o el área ocupada de un semáforo o un cruce. Primero paran los puntos críticos de producción, y
 *   con el tiempo el resto, **en cola**.
 * - Una cola que fluye —el primero avanza cada poco y el siguiente ocupa su sitio— es saturación o
 *   un pulmón, no un problema.
 * - El problema es **el primero de la cola sin avanzar más de dos minutos mientras los tags críticos
 *   se siguen leyendo**: la producción sigue y algo retiene a ese AGV.
 *
 * De ahí salen dos piezas:
 *
 * 1. `productionStops`: cuándo estuvo parada la producción. Tramos sin ninguna lectura en los tags
 *    críticos declarados, largos y **no explicables por azar** dado su ritmo en ese turno. Sin tags
 *    críticos declarados se usa el ritmo de toda la flota, y se dice. Las franjas de descanso no se
 *    declaran: salen de los datos, y se marca cuáles se repiten a la misma hora otro día.
 * 2. `flowStops`: cada parada de un AGV —una transición que dura más de lo habitual para ese par de
 *    tags en ese turno— con su justificación: `produccion`, `cola` (el de delante también parado) o
 *    `sin-explicacion`. Las colas se encadenan hasta su cabeza, y una cabeza sin justificación que
 *    se pasa de lo habitual en `headStallMs` o más es un **bloqueo**, con cuántos quedaron detrás.
 *
 * Nada de esto nombra causas (R-EVI-006): «producción parada» es lo que dicen los tags críticos, y un
 * bloqueo es un hecho con su evidencia, no una avería.
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import type { Transition } from "./graph.js";
import type { Reading } from "./reading.js";
import {
  localHourReader,
  ringUsualMs,
  shiftIndexOfHour,
  type StopJustification,
  type UsualTimes,
} from "./silence-kind.js";

export interface FlowStopThresholds {
  /** Exceso sobre lo habitual a partir del cual el primero de la cola sin justificar es un bloqueo. */
  readonly headStallMs: number;
  /** Duración mínima de un tramo sin lecturas críticas para llamarlo parada de la producción. */
  readonly minProductionStopMs: number;
  /** Exceso sobre lo habitual a partir del cual una transición es una parada del AGV. */
  readonly minStopExcessMs: number;
  /** Hasta cuántos tags por delante cuenta un AGV como «el de delante». */
  readonly reachTags: number;
  /** Paradas de la producción esperables por azar en un turno, como máximo. */
  readonly maxFalseStops: number;
  /** Margen de hora local para decir que una parada se repite otro día. */
  readonly sameTimeToleranceMs: number;
  /** Muestras mínimas de un par de tags, en un turno o en toda la ventana, para usar su mediana. */
  readonly minPairSamples: number;
}

export interface ProductionStop {
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  /** Otras paradas que empiezan a la misma hora local, otro día (sus `fromUtcMs`). */
  readonly sameTimeOn: readonly number[];
}

export interface ProductionStopReport {
  /** `criticos`: tags críticos declarados. `flota`: sin ellos, cualquier lectura de la flota. */
  readonly basis: "criticos" | "flota";
  /** Cuántos tags forman la base (críticos declarados con alguna lectura). */
  readonly basisTags: number;
  readonly stops: readonly ProductionStop[];
  /** Instantes de las lecturas de la base, en orden: la prueba de que la producción seguía. */
  readonly events: readonly number[];
}

export interface VehicleStop {
  readonly agvId: string;
  readonly fromTagId: string;
  readonly toTagId: string;
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly usualMs: number;
  readonly excessMs: number;
  readonly justification: StopJustification;
  /** En cola: el AGV de delante, también parado. */
  readonly aheadAgvId: string | null;
  /** En cola: la cabeza de la cadena. */
  readonly headAgvId: string | null;
  /** Solo en las cabezas: cuántas paradas quedaron detrás, encadenadas. */
  readonly behind: number;
}

export interface Blockage {
  readonly agvId: string;
  readonly tagId: string;
  readonly nextTagId: string;
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly usualMs: number;
  readonly excessMs: number;
  readonly behind: readonly string[];
  /** Lecturas de la base (tags críticos o flota) mientras duró: la producción seguía. */
  readonly basisReads: number;
  /** Función declarada del tag donde se quedó, si es crítico (semáforo, cruce…). */
  readonly functionAtTag: string | null;
}

/** Cómo salió cada AGV de una parada de la producción, en un cohorte. */
export interface ProductionStopFlow {
  readonly stopIndex: number;
  readonly vehicles: number;
  /** Siguieron por su tag, uno más allá, o entraron a una calle de carga. */
  readonly inPlace: number;
  readonly notInPlace: readonly {
    readonly agvId: string;
    readonly fromTagId: string;
    readonly toTagId: string;
    readonly skipped: number | null;
  }[];
  /** El orden de los AGV a lo largo del anillo, antes y después. `null` con menos de dos. */
  readonly orderKept: boolean | null;
  /** Quién iba detrás de otro cercano y aparece delante después. */
  readonly orderChanges: readonly { readonly agvId: string; readonly passed: string }[];
}

export interface FlowReport {
  readonly stops: readonly VehicleStop[];
  readonly blockages: readonly Blockage[];
  readonly productionFlow: readonly ProductionStopFlow[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] as number)
    : ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}

const QUARTER_MS = 15 * 60_000;

/** Cuántas lecturas hay en `[from, to]` en una lista ordenada. */
function countBetween(sorted: readonly number[], from: number, to: number): number {
  const lower = (value: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] as number) < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upper = (value: number): number => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((sorted[mid] as number) <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return upper(to) - lower(from);
}

function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

/**
 * Cuándo estuvo parada la producción: tramos sin ninguna lectura de la base que duran al menos
 * `minProductionStopMs` y que, dado el ritmo de la base en ese turno, no se explican por azar —el
 * número de huecos del turno por la probabilidad de uno tan largo no pasa de `maxFalseStops`—. El
 * ritmo va por turno para que la noche, con menos actividad, no parezca una parada.
 */
export function productionStops(
  readings: readonly Reading[],
  criticalTags: ReadonlySet<string>,
  coverage: readonly Interval[],
  zone: string,
  shiftStartHours: readonly number[],
  thresholds: FlowStopThresholds,
): ProductionStopReport {
  const criticalRead = new Set(readings.filter((reading) => criticalTags.has(reading.tagId)).map((reading) => reading.tagId));
  const basis: ProductionStopReport["basis"] = criticalRead.size > 0 ? "criticos" : "flota";
  const events = readings
    .filter((reading) => basis === "flota" || criticalTags.has(reading.tagId))
    .map((reading) => reading.time.utcMs)
    .sort((a, b) => a - b);
  const empty: ProductionStopReport = { basis, basisTags: criticalRead.size, stops: [], events };
  if (events.length < 2) return empty;
  const spans =
    coverage.length > 0
      ? mergeIntervals([...coverage])
      : [{ from: events[0] as number, to: events[events.length - 1] as number }];

  // Ritmo de la base por turno: lecturas y tiempo cubierto de cada turno.
  const hourOf = localHourReader(zone);
  const shifts = Math.max(1, shiftStartHours.length);
  const shiftOf = (utcMs: number): number => shiftIndexOfHour(hourOf(utcMs), shiftStartHours);
  const exposure = new Array<number>(shifts).fill(0);
  const count = new Array<number>(shifts).fill(0);
  for (const span of spans) {
    for (let cursor = span.from; cursor < span.to; ) {
      const next = Math.min(span.to, (Math.floor(cursor / QUARTER_MS) + 1) * QUARTER_MS);
      const shift = shiftOf(cursor);
      exposure[shift] = (exposure[shift] ?? 0) + (next - cursor);
      cursor = next;
    }
  }
  for (const time of events) count[shiftOf(time)] = (count[shiftOf(time)] ?? 0) + 1;

  const candidates: Interval[] = [];
  for (const span of spans) {
    const inside = events.filter((time) => time >= span.from && time <= span.to);
    const edges = [span.from, ...inside, span.to];
    for (let index = 1; index < edges.length; index += 1) {
      const from = edges[index - 1] as number;
      const to = edges[index] as number;
      const length = to - from;
      if (length < thresholds.minProductionStopMs) continue;
      const shift = shiftOf(from + length / 2);
      const rate = (count[shift] ?? 0) / Math.max(1, exposure[shift] ?? 0);
      if (rate <= 0) continue; // Un turno sin ninguna lectura de la base no tiene ritmo con que comparar.
      const gapsInShift = Math.max(1, count[shift] ?? 0);
      if (gapsInShift * Math.exp(-rate * length) > thresholds.maxFalseStops) continue;
      candidates.push({ from, to });
    }
  }

  // ¿Se repite a la misma hora local otro día?
  const clock = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const localOf = (utcMs: number): { day: string; minute: number } => {
    const parts = clock.formatToParts(new Date(utcMs));
    const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "0";
    return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
  };
  const local = candidates.map((stop) => localOf(stop.from));
  const tolerance = thresholds.sameTimeToleranceMs / 60_000;
  const stops: ProductionStop[] = candidates.map((stop, index) => {
    const own = local[index] as { day: string; minute: number };
    const sameTimeOn = candidates
      .filter((_, other) => {
        const them = local[other] as { day: string; minute: number };
        return other !== index && them.day !== own.day && Math.abs(them.minute - own.minute) <= tolerance;
      })
      .map((other) => other.from);
    return { fromUtcMs: stop.from, toUtcMs: stop.to, sameTimeOn };
  });
  return { basis, basisTags: criticalRead.size, stops, events };
}

/** Quita las transiciones que cruzan una parada de la producción: un descanso no mide un tramo. */
export function outsideProductionStops<T extends Pick<Transition, "fromTime" | "toTime">>(
  transitions: readonly T[],
  stops: readonly ProductionStop[],
): readonly T[] {
  if (stops.length === 0) return transitions;
  return transitions.filter(
    (transition) =>
      !stops.some((stop) => transition.fromTime < stop.toUtcMs && transition.toTime > stop.fromUtcMs),
  );
}

export interface FlowInput {
  readonly transitions: readonly Transition[];
  /**
   * Los tramos con datos cargados. Una transición solo mide algo si sus dos lecturas caen en el mismo
   * tramo: una que salta el hueco entre dos exportaciones no es una parada de nadie (R-DAT-007).
   */
  readonly coverage: readonly Interval[];
  /** Lo habitual del anillo del cohorte, para los pares con pocas muestras. `null` sin anillo. */
  readonly usual: UsualTimes | null;
  readonly production: ProductionStopReport;
  /** Tags de las calles de carga: sus transiciones son carga, no paradas (R-CO-006). */
  readonly laneTags: ReadonlySet<string>;
  /** Función declarada de cada tag crítico. */
  readonly functionOf: ReadonlyMap<string, string>;
  readonly zone: string;
  readonly shiftStartHours: readonly number[];
}

/**
 * Las paradas de cada AGV de un cohorte, con su justificación, las colas encadenadas hasta su cabeza,
 * los bloqueos, y cómo salió cada AGV de cada parada de la producción.
 */
export function flowStops(input: FlowInput, thresholds: FlowStopThresholds): FlowReport {
  const { transitions, usual, production } = input;
  const hourOf = localHourReader(input.zone);
  const shiftOf = (utcMs: number): number => shiftIndexOfHour(hourOf(utcMs), input.shiftStartHours);
  const spans = mergeIntervals([...input.coverage]);
  const insideOneSpan = (from: number, to: number): boolean =>
    spans.length === 0 || spans.some((span) => span.from <= from && to <= span.to);
  const measurable = transitions.filter(
    (transition) =>
      !transition.sameInstant &&
      !input.laneTags.has(transition.from) &&
      !input.laneTags.has(transition.to) &&
      insideOneSpan(transition.fromTime, transition.toTime),
  );

  // Lo habitual de cada par de tags, por turno y en toda la ventana, sin las paradas de la producción.
  const pairKey = (from: string, to: string): string => `${from}\u0000${to}`;
  const byPair = new Map<string, { overall: number[]; byShift: Map<number, number[]> }>();
  for (const transition of outsideProductionStops(measurable, production.stops)) {
    const key = pairKey(transition.from, transition.to);
    let entry = byPair.get(key);
    if (entry === undefined) {
      entry = { overall: [], byShift: new Map() };
      byPair.set(key, entry);
    }
    const duration = transition.toTime - transition.fromTime;
    entry.overall.push(duration);
    const shift = shiftOf(transition.fromTime);
    entry.byShift.set(shift, [...(entry.byShift.get(shift) ?? []), duration]);
  }
  const pairUsual = new Map<string, { overall: number | null; byShift: Map<number, number | null> }>();
  for (const [key, entry] of byPair) {
    pairUsual.set(key, {
      overall: entry.overall.length >= thresholds.minPairSamples ? median([...entry.overall]) : null,
      byShift: new Map(
        [...entry.byShift].map(([shift, values]) => [
          shift,
          values.length >= thresholds.minPairSamples ? median([...values]) : null,
        ]),
      ),
    });
  }
  const usualOf = (transition: Transition): number | null => {
    const own = pairUsual.get(pairKey(transition.from, transition.to));
    const shifted = own?.byShift.get(shiftOf(transition.fromTime)) ?? null;
    if (shifted !== null) return shifted;
    if (own?.overall !== null && own?.overall !== undefined) return own.overall;
    return usual === null ? null : ringUsualMs(usual, transition.from, transition.to, transition.fromTime);
  };

  // Dónde estaba cada AGV en cada momento: su último tag leído.
  const track = new Map<string, { times: number[]; tags: string[] }>();
  for (const transition of transitions) {
    let own = track.get(transition.agvId);
    if (own === undefined) {
      own = { times: [], tags: [] };
      track.set(transition.agvId, own);
    }
    const lastTime = own.times[own.times.length - 1];
    const lastTag = own.tags[own.tags.length - 1];
    if (lastTime !== transition.fromTime || lastTag !== transition.from) {
      own.times.push(transition.fromTime);
      own.tags.push(transition.from);
    }
    own.times.push(transition.toTime);
    own.tags.push(transition.to);
  }
  const lastAt = (agvId: string, utcMs: number): { time: number; tag: string } | null => {
    const own = track.get(agvId);
    if (own === undefined) return null;
    let lo = 0;
    let hi = own.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((own.times[mid] as number) <= utcMs) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return null;
    return { time: own.times[lo - 1] as number, tag: own.tags[lo - 1] as string };
  };

  // Las paradas: transiciones que duran más de lo habitual.
  interface Raw {
    readonly transition: Transition;
    readonly usualMs: number;
    readonly excessMs: number;
  }
  const raw: Raw[] = [];
  for (const transition of measurable) {
    const usualMs = usualOf(transition);
    if (usualMs === null) continue;
    const excessMs = transition.toTime - transition.fromTime - usualMs;
    if (excessMs >= thresholds.minStopExcessMs) raw.push({ transition, usualMs, excessMs });
  }
  const stopsOf = new Map<string, Raw[]>();
  for (const stop of raw) stopsOf.set(stop.transition.agvId, [...(stopsOf.get(stop.transition.agvId) ?? []), stop]);
  const stoppedAt = (agvId: string, utcMs: number): Raw | undefined =>
    stopsOf.get(agvId)?.find((stop) => stop.transition.fromTime <= utcMs && utcMs <= stop.transition.toTime);

  const ring = usual?.ring ?? [];
  const positionOf = usual?.positionOf ?? new Map<string, number>();
  const vehicles = [...track.keys()];
  const productionOf = (stop: Raw): number =>
    production.stops.findIndex(
      (entry) =>
        overlapMs({ from: stop.transition.fromTime, to: stop.transition.toTime }, { from: entry.fromUtcMs, to: entry.toUtcMs }) >=
        0.5 * stop.excessMs,
    );

  /** El AGV más cercano por delante al empezar la parada, dentro de `reachTags`. */
  const aheadOf = (stop: Raw): string | null => {
    const position = positionOf.get(stop.transition.from);
    if (position === undefined || ring.length < 2) return null;
    const at = stop.transition.fromTime;
    let best: { agvId: string; distance: number; time: number } | null = null;
    for (const other of vehicles) {
      if (other === stop.transition.agvId) continue;
      const last = lastAt(other, at);
      if (last === null) continue;
      const theirs = positionOf.get(last.tag);
      if (theirs === undefined) continue;
      const distance = (theirs - position + ring.length) % ring.length;
      if (distance > thresholds.reachTags) continue;
      if (distance === 0 && last.time >= at) continue; // En el mismo tag, solo si pasó antes.
      if (best === null || distance < best.distance || (distance === best.distance && last.time > best.time)) {
        best = { agvId: other, distance, time: last.time };
      }
    }
    return best?.agvId ?? null;
  };

  const justified = new Map<Raw, { justification: StopJustification; ahead: Raw | null; aheadAgvId: string | null }>();
  for (const stop of raw) {
    if (productionOf(stop) >= 0) {
      justified.set(stop, { justification: "produccion", ahead: null, aheadAgvId: null });
      continue;
    }
    const ahead = aheadOf(stop);
    const middle = (stop.transition.fromTime + stop.transition.toTime) / 2;
    const aheadStop = ahead === null ? undefined : stoppedAt(ahead, middle);
    justified.set(
      stop,
      aheadStop === undefined
        ? { justification: "sin-explicacion", ahead: null, aheadAgvId: null }
        : { justification: "cola", ahead: aheadStop, aheadAgvId: ahead },
    );
  }

  // Cada cola hasta su cabeza, y cuántas paradas tiene detrás cada cabeza.
  const headOf = (stop: Raw): Raw => {
    let current = stop;
    const seen = new Set<Raw>([stop]);
    for (;;) {
      const next = justified.get(current)?.ahead ?? null;
      if (next === null || seen.has(next)) return current;
      seen.add(next);
      current = next;
    }
  };
  const behindOf = new Map<Raw, string[]>();
  const heads = new Map<Raw, Raw>();
  for (const stop of raw) {
    if (justified.get(stop)?.justification !== "cola") continue;
    const head = headOf(stop);
    heads.set(stop, head);
    behindOf.set(head, [...(behindOf.get(head) ?? []), stop.transition.agvId]);
  }

  const stops: VehicleStop[] = raw.map((stop) => {
    const verdict = justified.get(stop) as { justification: StopJustification; aheadAgvId: string | null };
    return {
      agvId: stop.transition.agvId,
      fromTagId: stop.transition.from,
      toTagId: stop.transition.to,
      fromUtcMs: stop.transition.fromTime,
      toUtcMs: stop.transition.toTime,
      usualMs: stop.usualMs,
      excessMs: stop.excessMs,
      justification: verdict.justification,
      aheadAgvId: verdict.aheadAgvId,
      headAgvId: heads.get(stop)?.transition.agvId ?? null,
      behind: behindOf.get(stop)?.length ?? 0,
    };
  });

  const blockages: Blockage[] = raw
    .filter((stop) => justified.get(stop)?.justification === "sin-explicacion" && stop.excessMs >= thresholds.headStallMs)
    .map((stop) => ({
      agvId: stop.transition.agvId,
      tagId: stop.transition.from,
      nextTagId: stop.transition.to,
      fromUtcMs: stop.transition.fromTime,
      toUtcMs: stop.transition.toTime,
      usualMs: stop.usualMs,
      excessMs: stop.excessMs,
      behind: [...new Set(behindOf.get(stop) ?? [])],
      basisReads: countBetween(production.events, stop.transition.fromTime, stop.transition.toTime),
      functionAtTag: input.functionOf.get(stop.transition.from) ?? null,
    }))
    .sort((a, b) => b.behind.length - a.behind.length || b.excessMs - a.excessMs);

  // Cómo salió cada AGV de cada parada de la producción: por su sitio y en el mismo orden.
  const productionFlow: ProductionStopFlow[] = production.stops.map((entry, stopIndex) => {
    const inside = measurable.filter(
      (transition) =>
        overlapMs({ from: transition.fromTime, to: transition.toTime }, { from: entry.fromUtcMs, to: entry.toUtcMs }) >=
        0.5 * (entry.toUtcMs - entry.fromUtcMs),
    );
    const notInPlace: ProductionStopFlow["notInPlace"][number][] = [];
    const before: { agvId: string; position: number; time: number }[] = [];
    const after: { agvId: string; position: number; time: number }[] = [];
    for (const transition of inside) {
      const from = positionOf.get(transition.from);
      const to = positionOf.get(transition.to);
      const skipped =
        from === undefined || to === undefined
          ? null
          : transition.from === transition.to
            ? 0
            : (to - from - 1 + ring.length) % ring.length;
      // Por su sitio: el mismo tag, uno más allá en el anillo, o un paso que se da a menudo (una rama o
      // una calle tienen su propio siguiente, fuera del anillo).
      const usualStep = (pairUsual.get(pairKey(transition.from, transition.to))?.overall ?? null) !== null;
      const inPlace = transition.from === transition.to || (skipped !== null && skipped <= 1) || usualStep;
      if (!inPlace) {
        notInPlace.push({ agvId: transition.agvId, fromTagId: transition.from, toTagId: transition.to, skipped });
      }
      if (from !== undefined && to !== undefined) {
        before.push({ agvId: transition.agvId, position: from, time: transition.fromTime });
        after.push({ agvId: transition.agvId, position: to, time: transition.toTime });
      }
    }
    // El orden se rompe solo si uno que iba **detrás** de otro cercano aparece **delante** después.
    // En el mismo tag no hay orden que comparar (empates, minuto de resolución), y entre AGV lejanos
    // en un anillo «delante» y «detrás» no significan nada.
    const near = thresholds.reachTags + 1;
    const afterOf = new Map(after.map((entry) => [entry.agvId, entry.position]));
    const orderChanges: { agvId: string; passed: string }[] = [];
    for (const a of before) {
      for (const b of before) {
        const gap = (b.position - a.position + ring.length) % ring.length;
        if (a.agvId === b.agvId || gap === 0 || gap > near) continue;
        const aAfter = afterOf.get(a.agvId) as number;
        const bAfter = afterOf.get(b.agvId) as number;
        const gapAfter = (bAfter - aAfter + ring.length) % ring.length;
        if (gapAfter !== 0 && gapAfter > ring.length / 2) orderChanges.push({ agvId: a.agvId, passed: b.agvId });
      }
    }
    return {
      stopIndex,
      vehicles: inside.length,
      inPlace: inside.length - notInPlace.length,
      notInPlace,
      orderKept: before.length < 2 ? null : orderChanges.length === 0,
      orderChanges,
    };
  });

  return { stops, blockages, productionFlow };
}
