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
 * 2. `flowStops`: cada parada de un AGV —una transición que se sale de la horquilla de su tramo en
 *    su régimen (R-FLO-007)— con su justificación: `produccion`, `cola` (había un AGV delante que no
 *    se iba) o `sin-explicacion`. Las colas se encadenan hasta su cabeza, y una parada sin
 *    justificación que se pasa de lo habitual en `headStallMs` o más es un **bloqueo**, con cuántos
 *    quedaron detrás. Una sin explicación lleva la evidencia del propietario: quién iba delante y
 *    cuánto avanzó mientras tanto —«el resto avanza y se separa»—. Y las transiciones lentas con
 *    alguien delante que no se iba son **retenciones**: no son paradas, pero dicen dónde se forman
 *    colas (R-FLO-008).
 *
 * Nada de esto nombra causas (R-EVI-006): «producción parada» es lo que dicen los tags críticos, y un
 * bloqueo es un hecho con su evidencia, no una avería.
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import type { Transition } from "./graph.js";
import type { Reading } from "./reading.js";
import {
  bandFor,
  measurableTransitions,
  pairKey,
  transitionRegime,
  type BandFor,
  type Regime,
  type SegmentBands,
} from "./segment-bands.js";
import { localHourReader, shiftIndexOfHour, type StopJustification } from "./silence-kind.js";

export interface FlowStopThresholds {
  /** Exceso sobre lo habitual a partir del cual el primero de la cola sin justificar es un bloqueo. */
  readonly headStallMs: number;
  /** Duración mínima de un tramo sin lecturas críticas para llamarlo parada de la producción. */
  readonly minProductionStopMs: number;
  /**
   * Margen mínimo de la valla sobre el p95 de un tramo (R-FLO-007): un tramo muy regular no convierte
   * en parada un par de segundos de más.
   */
  readonly minStopExcessMs: number;
  /** Hasta cuántos tags por delante cuenta un AGV como «el de delante». */
  readonly reachTags: number;
  /** Paradas de la producción esperables por azar en un turno, como máximo. */
  readonly maxFalseStops: number;
  /** Margen de hora local para decir que una parada se repite otro día. */
  readonly sameTimeToleranceMs: number;
  /**
   * Veces que tiene que darse un paso de un tag a otro, fuera de las paradas de la producción, para
   * que salir por él de una parada cuente como «por su sitio»: saltarse un tag que se lee poco es un
   * paso habitual aunque no tenga horquilla propia.
   */
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
  /** Lo habitual del tramo: el p50 de su horquilla en su régimen. */
  readonly usualMs: number;
  readonly excessMs: number;
  readonly regime: Regime;
  readonly justification: StopJustification;
  /** En cola: el AGV de delante que no se iba. */
  readonly aheadAgvId: string | null;
  /** En cola: la cabeza de la cadena, esté parada o solo retenga. */
  readonly headAgvId: string | null;
  /** Solo en las cabezas: cuántas paradas quedaron detrás, encadenadas. */
  readonly behind: number;
  /** Solo sin explicación: quién iba delante y cuánto avanzó mientras tanto. */
  readonly aheadEvidence: AheadEvidence | null;
}

/** El AGV más cercano por delante al empezar una parada sin explicación, hasta media vuelta. */
export interface AheadEvidence {
  readonly agvId: string;
  /** Tags por delante al empezar. */
  readonly distanceAtStart: number;
  /** Tags que avanzó mientras el otro no se movía; `null` si salió del anillo. */
  readonly tagsAdvanced: number | null;
}

/**
 * Una transición en la que alguien delante no se iba: una parada en cola, o una transición lenta
 * —por encima del p95 de su tramo y al menos `minStopExcessMs` sobre su p50, sin llegar a la valla—
 * con el de delante a `reachTags` o menos, y más lento de lo normal él también.
 */
export interface Retention {
  readonly agvId: string;
  readonly fromTagId: string;
  readonly toTagId: string;
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  /** Lo que tardó de más sobre el p50 del tramo. */
  readonly waitMs: number;
  readonly holderAgvId: string;
  /** Dónde estaba quien retenía: el sitio donde se forma la cola. */
  readonly holderTagId: string;
  readonly regime: Regime;
  /** Si además se salió de la valla (parada en cola). */
  readonly stop: boolean;
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
  readonly retentions: readonly Retention[];
  readonly productionFlow: readonly ProductionStopFlow[];
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
  /** La horquilla de cada tramo del cohorte, por régimen (R-FLO-007). `null` sin anillo. */
  readonly bands: SegmentBands | null;
  /** El régimen de un instante: una transición de noche se mide contra la horquilla de noche. */
  readonly regimeOf: (utcMs: number) => Regime;
  readonly production: ProductionStopReport;
  /** Tags de las calles de carga: sus transiciones son carga, no paradas (R-CO-006). */
  readonly laneTags: ReadonlySet<string>;
  /** Función declarada de cada tag crítico. */
  readonly functionOf: ReadonlyMap<string, string>;
}

/**
 * Las paradas de cada AGV de un cohorte, con su justificación, las colas encadenadas hasta su cabeza,
 * los bloqueos, las retenciones, y cómo salió cada AGV de cada parada de la producción.
 *
 * Una parada es una transición que **se sale de la horquilla de su tramo en su régimen** (R-FLO-007).
 * Está en cola si había un AGV delante que no se iba: al empezar y a mitad de la parada, a
 * `reachTags` tags o menos (R-AGV-018). Quien retiene no tiene por qué estar parado él: en un cuello
 * de botella tarda lo que suele tardar ese sitio, y aun así el de detrás espera.
 */
export function flowStops(input: FlowInput, thresholds: FlowStopThresholds): FlowReport {
  const { transitions, bands, production, regimeOf } = input;
  const measurable = measurableTransitions(transitions, input.coverage, input.laneTags);
  const ring = bands?.ring ?? [];
  const positionOf = bands?.positionOf ?? new Map<string, number>();
  /**
   * La horquilla con que se mide un paso de `from` a `to` en un régimen. Volver a leer **el mismo
   * tag** es haberse quedado sobre él: el par (T, T) no tiene horquilla propia, así que se mide contra
   * lo que se suele tardar en dejar ese tag, el tramo hasta el siguiente del anillo. Sin esto, un AGV
   * parado doce minutos sobre un tag que lo relee al arrancar no tendría ninguna parada.
   */
  const bandOfStep = (from: string, to: string, regime: Regime): BandFor | null => {
    if (bands === null) return null;
    if (from !== to) return bandFor(bands, from, to, regime);
    const position = positionOf.get(from);
    if (position === undefined || ring.length < 2) return null;
    return bandFor(bands, from, ring[(position + 1) % ring.length] as string, regime);
  };
  const bandOfTransition = (transition: Transition): BandFor | null =>
    bandOfStep(transition.from, transition.to, transitionRegime(transition, regimeOf));

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
  const indexAt = (agvId: string, utcMs: number): number => {
    const own = track.get(agvId);
    if (own === undefined) return -1;
    let lo = 0;
    let hi = own.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((own.times[mid] as number) <= utcMs) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  };
  const lastAt = (agvId: string, utcMs: number): { time: number; tag: string } | null => {
    const index = indexAt(agvId, utcMs);
    const own = track.get(agvId);
    if (own === undefined || index < 0) return null;
    return { time: own.times[index] as number, tag: own.tags[index] as string };
  };
  /**
   * ¿Iba más lento de lo normal en `utcMs`? Su transición de ese momento supera el p80 de su tramo.
   * Sin horquilla con que compararla, no se afirma.
   */
  const lingering = (agvId: string, utcMs: number): boolean => {
    const own = track.get(agvId);
    const index = indexAt(agvId, utcMs);
    if (own === undefined || index < 0 || index + 1 >= own.times.length || bands === null) return false;
    const fromTime = own.times[index] as number;
    const toTime = own.times[index + 1] as number;
    const band = bandOfStep(own.tags[index] as string, own.tags[index + 1] as string, regimeOf((fromTime + toTime) / 2));
    return band !== null && toTime - fromTime > band.p80Ms;
  };

  // Quién leyó cada tag y cuándo, en orden, y con qué tag siguió: para saber si alguien pasó por
  // donde otro «está».
  const readsOfTag = new Map<string, { times: number[]; agvIds: string[]; nextTags: (string | null)[]; nextTimes: number[] }>();
  for (const [agvId, own] of track) {
    own.tags.forEach((tag, index) => {
      let reads = readsOfTag.get(tag);
      if (reads === undefined) {
        reads = { times: [], agvIds: [], nextTags: [], nextTimes: [] };
        readsOfTag.set(tag, reads);
      }
      reads.times.push(own.times[index] as number);
      reads.agvIds.push(agvId);
      reads.nextTags.push(own.tags[index + 1] ?? null);
      reads.nextTimes.push(own.times[index + 1] ?? Number.POSITIVE_INFINITY);
    });
  }
  for (const reads of readsOfTag.values()) {
    const order = reads.times.map((_, index) => index).sort((a, b) => (reads.times[a] as number) - (reads.times[b] as number));
    reads.times = order.map((index) => reads.times[index] as number);
    reads.agvIds = order.map((index) => reads.agvIds[index] as string);
    reads.nextTags = order.map((index) => reads.nextTags[index] ?? null);
    reads.nextTimes = order.map((index) => reads.nextTimes[index] as number);
  }
  /**
   * ¿Atravesó otro AGV el sitio de `tagId` después de `afterUtcMs` y no más tarde de `untilUtcMs`?
   * Atravesar es leer ese tag **y seguir hacia delante** (su lectura siguiente cae más adelante en el
   * anillo) dentro de la ventana. En una guía única nadie pasa por donde hay un AGV parado: si alguien
   * lo hizo después de la última lectura del candidato, el candidato ya no estaba ahí —fuera de la
   * guía, en maniobra manual o desconectado— y no retiene a nadie. Leer solo el tag no basta: el
   * candidato pudo seguir hasta un tag que no se lee (hallado con la auditoría: en un cuello con dos
   * tags sin lecturas delante, el de detrás leía el último tag del retenedor y la cola se quedaba
   * «sin explicación»).
   */
  const passedThrough = (tagId: string, holderAgvId: string, stoppedAgvId: string, afterUtcMs: number, untilUtcMs: number): boolean => {
    const reads = readsOfTag.get(tagId);
    const position = positionOf.get(tagId);
    if (reads === undefined || position === undefined || ring.length < 2) return false;
    let lo = 0;
    let hi = reads.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((reads.times[mid] as number) <= afterUtcMs) lo = mid + 1;
      else hi = mid;
    }
    for (let index = lo; index < reads.times.length && (reads.times[index] as number) <= untilUtcMs; index += 1) {
      // Ni el candidato ni el propio parado: lo que se busca es un tercero que pasó por en medio.
      if (reads.agvIds[index] === holderAgvId || reads.agvIds[index] === stoppedAgvId) continue;
      const next = reads.nextTags[index];
      const nextPosition = next === null || next === undefined ? undefined : positionOf.get(next);
      if (nextPosition === undefined || (reads.nextTimes[index] as number) > untilUtcMs) continue;
      const ahead = (nextPosition - position + ring.length) % ring.length;
      if (ahead >= 1 && ahead < ring.length / 2) return true;
    }
    return false;
  };

  const vehicles = [...track.keys()];

  /**
   * Los AGV por delante de `tagId` en `at`, a `maxDistance` tags o menos, del más cercano al más
   * lejano. En el mismo tag solo cuenta quien lo leyó antes de `readBefore`: si lo leyó después, viene
   * detrás.
   */
  const aheadOf = (
    agvId: string,
    tagId: string,
    at: number,
    maxDistance: number,
    readBefore: number,
  ): { agvId: string; tagId: string; distance: number }[] => {
    const position = positionOf.get(tagId);
    if (position === undefined || ring.length < 2) return [];
    const found: { agvId: string; tagId: string; distance: number; time: number }[] = [];
    for (const other of vehicles) {
      if (other === agvId) continue;
      const last = lastAt(other, at);
      if (last === null) continue;
      const theirs = positionOf.get(last.tag);
      if (theirs === undefined) continue;
      const distance = (theirs - position + ring.length) % ring.length;
      if (distance > maxDistance) continue;
      if (distance === 0 && last.time >= readBefore) continue;
      found.push({ agvId: other, tagId: last.tag, distance, time: last.time });
    }
    return found
      .sort((a, b) => a.distance - b.distance || b.time - a.time)
      .map(({ agvId: other, tagId: tag, distance }) => ({ agvId: other, tagId: tag, distance }));
  };
  /**
   * Quién retenía a un AGV en `transition`: uno que ya iba delante al empezar, que a mitad seguía a
   * `reachTags` o menos, y que en ese momento iba más lento de lo normal él también. Tiene que ser
   * **el mismo**: uno que llega por detrás y lo adelanta no lo retiene, y uno que se aleja tampoco —
   * es justo lo que el propietario llama «el resto avanza y se separa»—. Y tiene que estar retenido o
   * parado de verdad: donde un tag se lee poco, o el tramo es largo, el último tag leído de un AGV
   * que circula normal se queda atrás de donde está, y sin esta condición parecería una cola. Y tiene
   * que **seguir en la guía**: si otro AGV leyó su último tag después que él, antes del punto medio de
   * la parada, él ya no estaba ahí (un AGV que calla horas fuera de la guía retendría, si no, a todo el
   * que para cerca de su último tag).
   */
  const holderOf = (transition: Transition): { agvId: string; tagId: string } | null => {
    const start = aheadOf(transition.agvId, transition.from, transition.fromTime, thresholds.reachTags, transition.fromTime);
    if (start.length === 0) return null;
    const middle = (transition.fromTime + transition.toTime) / 2;
    const position = positionOf.get(transition.from) as number;
    for (const candidate of start) {
      const last = lastAt(candidate.agvId, middle);
      const theirs = last === null ? undefined : positionOf.get(last.tag);
      if (last === null || theirs === undefined) continue;
      const distance = (theirs - position + ring.length) % ring.length;
      if (passedThrough(last.tag, candidate.agvId, transition.agvId, last.time, middle)) continue;
      if (distance <= thresholds.reachTags && lingering(candidate.agvId, middle)) {
        return { agvId: candidate.agvId, tagId: last.tag };
      }
    }
    return null;
  };
  /** El más cercano por delante, hasta media vuelta, y cuánto avanzó mientras el otro no se movía. */
  const aheadEvidenceOf = (transition: Transition): AheadEvidence | null => {
    const ahead = aheadOf(
      transition.agvId,
      transition.from,
      transition.fromTime,
      Math.floor(ring.length / 2),
      transition.fromTime,
    )[0];
    if (ahead === undefined) return null;
    const end = lastAt(ahead.agvId, transition.toTime);
    const startPosition = positionOf.get(ahead.tagId);
    const endPosition = end === null ? undefined : positionOf.get(end.tag);
    const tagsAdvanced =
      startPosition === undefined || endPosition === undefined
        ? null
        : (endPosition - startPosition + ring.length) % ring.length;
    return { agvId: ahead.agvId, distanceAtStart: ahead.distance, tagsAdvanced };
  };

  // Las paradas se salen de la valla; entre el p95 y la valla, una transición lenta puede ser una
  // retención si alguien delante no se iba y la espera llega al menos a `minStopExcessMs` —el paso de
  // una cola que fluye—. Unos segundos por encima del p95 los tiene cualquier tramo por puro vaivén, y
  // coinciden por azar con otro AGV lento cerca: no basta para decir que alguien lo retuvo.
  interface Raw {
    readonly transition: Transition;
    readonly usualMs: number;
    readonly excessMs: number;
    readonly regime: Regime;
  }
  const raw: Raw[] = [];
  const slow: { transition: Transition; usualMs: number; regime: Regime }[] = [];
  for (const transition of measurable) {
    const band = bandOfTransition(transition);
    if (band === null) continue;
    const duration = transition.toTime - transition.fromTime;
    const regime = transitionRegime(transition, regimeOf);
    if (duration > band.fenceMs) raw.push({ transition, usualMs: band.p50Ms, excessMs: duration - band.p50Ms, regime });
    else if (duration > band.p95Ms && duration - band.p50Ms >= thresholds.minStopExcessMs) {
      slow.push({ transition, usualMs: band.p50Ms, regime });
    }
  }
  // Pasos habituales: pares que se dan a menudo fuera de las paradas de la producción.
  const pairCount = new Map<string, number>();
  for (const transition of outsideProductionStops(measurable, production.stops)) {
    const key = pairKey(transition.from, transition.to);
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  const stopsOf = new Map<string, Raw[]>();
  for (const stop of raw) stopsOf.set(stop.transition.agvId, [...(stopsOf.get(stop.transition.agvId) ?? []), stop]);
  const stoppedAt = (agvId: string, utcMs: number): Raw | undefined =>
    stopsOf.get(agvId)?.find((stop) => stop.transition.fromTime <= utcMs && utcMs <= stop.transition.toTime);

  const overlapsProduction = (from: number, to: number, minOverlap: number): number =>
    production.stops.findIndex(
      (entry) => overlapMs({ from, to }, { from: entry.fromUtcMs, to: entry.toUtcMs }) >= minOverlap,
    );
  const productionOf = (stop: Raw): number =>
    overlapsProduction(stop.transition.fromTime, stop.transition.toTime, 0.5 * stop.excessMs);

  interface Verdict {
    readonly justification: StopJustification;
    readonly ahead: Raw | null;
    readonly holder: { agvId: string; tagId: string } | null;
  }
  const justified = new Map<Raw, Verdict>();
  for (const stop of raw) {
    if (productionOf(stop) >= 0) {
      justified.set(stop, { justification: "produccion", ahead: null, holder: null });
      continue;
    }
    const holder = holderOf(stop.transition);
    const middle = (stop.transition.fromTime + stop.transition.toTime) / 2;
    justified.set(
      stop,
      holder === null
        ? { justification: "sin-explicacion", ahead: null, holder: null }
        : { justification: "cola", ahead: stoppedAt(holder.agvId, middle) ?? null, holder },
    );
  }

  // Cada cola hasta su cabeza, y cuántas paradas tiene detrás cada cabeza.
  const lastOfChain = (stop: Raw): Raw => {
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
  const headAgv = new Map<Raw, string>();
  for (const stop of raw) {
    if (justified.get(stop)?.justification !== "cola") continue;
    const last = lastOfChain(stop);
    const verdict = justified.get(last);
    // La cabeza es el último parado de la cadena, o quien lo retenía si ese no estaba parado.
    headAgv.set(stop, verdict?.justification === "cola" && verdict.ahead === null ? (verdict.holder?.agvId ?? last.transition.agvId) : last.transition.agvId);
    if (last !== stop) behindOf.set(last, [...(behindOf.get(last) ?? []), stop.transition.agvId]);
  }

  const stops: VehicleStop[] = raw.map((stop) => {
    const verdict = justified.get(stop) as Verdict;
    return {
      agvId: stop.transition.agvId,
      fromTagId: stop.transition.from,
      toTagId: stop.transition.to,
      fromUtcMs: stop.transition.fromTime,
      toUtcMs: stop.transition.toTime,
      usualMs: stop.usualMs,
      excessMs: stop.excessMs,
      regime: stop.regime,
      justification: verdict.justification,
      aheadAgvId: verdict.holder?.agvId ?? null,
      headAgvId: headAgv.get(stop) ?? null,
      behind: behindOf.get(stop)?.length ?? 0,
      aheadEvidence: verdict.justification === "sin-explicacion" ? aheadEvidenceOf(stop.transition) : null,
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

  // Retenciones: las paradas en cola, y las transiciones lentas —por encima del p95, sin llegar a la
  // valla— con alguien delante que no se iba. Fuera de las paradas de la producción.
  const retentions: Retention[] = [];
  for (const stop of raw) {
    const verdict = justified.get(stop) as Verdict;
    if (verdict.justification !== "cola" || verdict.holder === null) continue;
    retentions.push({
      agvId: stop.transition.agvId,
      fromTagId: stop.transition.from,
      toTagId: stop.transition.to,
      fromUtcMs: stop.transition.fromTime,
      toUtcMs: stop.transition.toTime,
      waitMs: stop.excessMs,
      holderAgvId: verdict.holder.agvId,
      holderTagId: verdict.holder.tagId,
      regime: stop.regime,
      stop: true,
    });
  }
  for (const entry of slow) {
    const { transition } = entry;
    if (overlapsProduction(transition.fromTime, transition.toTime, 1) >= 0) continue;
    const holder = holderOf(transition);
    if (holder === null) continue;
    retentions.push({
      agvId: transition.agvId,
      fromTagId: transition.from,
      toTagId: transition.to,
      fromUtcMs: transition.fromTime,
      toUtcMs: transition.toTime,
      waitMs: transition.toTime - transition.fromTime - entry.usualMs,
      holderAgvId: holder.agvId,
      holderTagId: holder.tagId,
      regime: entry.regime,
      stop: false,
    });
  }

  // Cómo salió cada AGV de cada parada de la producción: por su sitio y en el mismo orden.
  const productionFlow: ProductionStopFlow[] = production.stops.map((entry, stopIndex) => {
    // Todas las transiciones, no solo las medibles: el que entró a una calle de carga durante la parada
    // también estaba en el circuito y siguió por su sitio; dejarlo fuera restaba AGV al recuento.
    const inside = transitions.filter(
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
      // Por su sitio: el mismo tag, uno más allá en el anillo, o un paso que se da a menudo (una rama
      // o una calle tienen su propio siguiente, fuera del anillo; un tag que se lee poco se salta).
      const usualStep = (pairCount.get(pairKey(transition.from, transition.to)) ?? 0) >= thresholds.minPairSamples;
      const toLane = input.laneTags.has(transition.from) || input.laneTags.has(transition.to);
      const inPlace = transition.from === transition.to || (skipped !== null && skipped <= 1) || usualStep || toLane;
      if (!inPlace) {
        notInPlace.push({ agvId: transition.agvId, fromTagId: transition.from, toTagId: transition.to, skipped });
      }
      // En el orden solo entran los que leyeron el tag siguiente, el mismo o uno saltado como mucho: un
      // AGV que se saltó más tags no tiene una posición fiable, ni antes ni después, y comparado con un
      // vecino parecía adelantarlo. Que el salto sea habitual (`usualStep`) lo hace «por su sitio»,
      // no fiable para el orden.
      const orderable = transition.from === transition.to || (skipped !== null && skipped <= 1);
      if (from !== undefined && to !== undefined && orderable) {
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

  return { stops, blockages, retentions, productionFlow };
}
