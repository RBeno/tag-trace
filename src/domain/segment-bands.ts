/**
 * La horquilla de tiempos de cada tramo, por régimen (R-FLO-007, R-TIM-009).
 *
 * El propietario lo dice con un ejemplo: entre dos tags, el 80 % de las veces se tarda 17 s y el
 * otro 20 % llega hasta 30 s. Eso **es** el tramo: su horquilla. Un AGV que tarda 80 s ahí se sale
 * de ella; uno que tarda 30, no. Los umbrales salen de los datos de cada tramo, no de una constante.
 *
 * Y la horquilla solo vale si mide el estado normal del circuito. Lo que pasa en las paradas de la
 * producción y en los descansos no mide ningún tramo (R-AGV-018), y la noche —de 22:00 a 05:00— se
 * comporta de otra manera y también se puede medir, pero **aparte**: mezclarla con el día es
 * comparar un periodo con una media que no es la suya (R-TIM-006). Por eso cada transición cae en un
 * régimen, por la hora local de su punto medio:
 *
 * | Régimen | Cuándo |
 * |---|---|
 * | `produccion` | el resto: el estado normal, con el que se miden cuellos, zonas oscuras y conflictos |
 * | `noche` | la hora local cae en la ventana de noche declarada |
 *
 * Las transiciones que cruzan una parada de la producción no entran en ninguno: quien llama las quita
 * antes (`outsideProductionStops`).
 *
 * La horquilla de un tramo en un régimen es su p50, p80 y p95, y su **valla**:
 *
 *     valla = p95 + max(p95 − p50, margen mínimo, resolución de la fuente)
 *
 * El ancho de la propia horquilla dice cuánto se mueve el tramo; el margen mínimo evita que un tramo
 * muy regular convierta en parada un par de segundos de más; y con una fuente de resolución de minuto
 * no se puede afirmar nada por debajo del minuto. Con el ejemplo del propietario, 17 y 30 s con un
 * margen de 30 s dan una valla de 60 s: 80 s es parada candidata y 45 s no.
 *
 * Un semáforo que para una de cada tres pasadas, o una parada precisa que para siempre, meten su
 * espera en la horquilla: es su comportamiento normal, no una parada.
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import { quantile, type Transition } from "./graph.js";
import { localHourReader } from "./silence-kind.js";

export type Regime = "produccion" | "noche";

export const REGIMES: readonly Regime[] = ["produccion", "noche"];

export interface RegimeThresholds {
  /** Hora local en que empieza la noche, p. ej. 22. */
  readonly nightFromHour: number;
  /** Hora local en que termina la noche, p. ej. 5. Puede ser menor que la de inicio. */
  readonly nightToHour: number;
}

export interface BandThresholds {
  /** Muestras mínimas de un tramo en un régimen para calcular su horquilla. */
  readonly minBandSamples: number;
}

export interface Band {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p80Ms: number;
  readonly p95Ms: number;
  /** Por encima de la valla, la transición es una parada candidata. */
  readonly fenceMs: number;
}

export interface SegmentBand {
  readonly from: string;
  readonly to: string;
  readonly produccion: Band | null;
  readonly noche: Band | null;
}

export interface SegmentBands {
  readonly pairs: ReadonlyMap<string, SegmentBand>;
  readonly ring: readonly string[];
  readonly positionOf: ReadonlyMap<string, number>;
  /** Resolución medida de la fuente: un minuto si ningún intervalo baja del minuto. */
  readonly resolutionMs: number;
  /** El margen que se usa de verdad: el mayor entre el mínimo configurado y la resolución. */
  readonly marginMs: number;
}

/** La horquilla que toca a una transición: la de su par, o la suma de los tramos del anillo. */
export interface BandFor {
  readonly p50Ms: number;
  readonly p80Ms: number;
  readonly p95Ms: number;
  readonly fenceMs: number;
  readonly source: "tramo" | "anillo";
}

export function pairKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/** El régimen de un instante, por su hora local en la zona del circuito. */
export function regimeReader(zone: string, regimes: RegimeThresholds): (utcMs: number) => Regime {
  const hourOf = localHourReader(zone);
  const { nightFromHour: from, nightToHour: to } = regimes;
  return (utcMs) => {
    const hour = hourOf(utcMs);
    const night = from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to;
    return night ? "noche" : "produccion";
  };
}

/** El régimen de una transición: el de su punto medio. */
export function transitionRegime(
  transition: Pick<Transition, "fromTime" | "toTime">,
  regimeOf: (utcMs: number) => Regime,
): Regime {
  return regimeOf((transition.fromTime + transition.toTime) / 2);
}

/**
 * Las transiciones que miden algo: no son del mismo instante (R-DAT-013), no son de una calle de
 * carga (R-CO-006) y sus dos lecturas caen en un mismo tramo de cobertura (R-DAT-007).
 */
export function measurableTransitions<T extends Transition>(
  transitions: readonly T[],
  coverage: readonly Interval[],
  laneTags: ReadonlySet<string>,
): readonly T[] {
  const spans = mergeIntervals([...coverage]);
  const insideOneSpan = (from: number, to: number): boolean =>
    spans.length === 0 || spans.some((span) => span.from <= from && to <= span.to);
  return transitions.filter(
    (transition) =>
      !transition.sameInstant &&
      !laneTags.has(transition.from) &&
      !laneTags.has(transition.to) &&
      insideOneSpan(transition.fromTime, transition.toTime),
  );
}

/** Un minuto si ningún intervalo medible baja del minuto; si no, un segundo. */
export function sourceResolutionMs(transitions: readonly Pick<Transition, "fromTime" | "toTime">[]): number {
  if (transitions.length === 0) return 1_000;
  return transitions.every((transition) => (transition.toTime - transition.fromTime) % 60_000 === 0) ? 60_000 : 1_000;
}

export function bandOf(durations: number[], floorMs: number): Band {
  const sorted = durations.sort((a, b) => a - b);
  const p50Ms = quantile(sorted, 0.5);
  const p80Ms = quantile(sorted, 0.8);
  const p95Ms = quantile(sorted, 0.95);
  return { samples: sorted.length, p50Ms, p80Ms, p95Ms, fenceMs: p95Ms + Math.max(p95Ms - p50Ms, floorMs) };
}

/**
 * La horquilla de cada par observado, anillo y ramas, en cada régimen. Recibe transiciones ya
 * medibles y sin las paradas de la producción.
 */
export function buildSegmentBands(
  transitions: readonly Transition[],
  ring: readonly string[],
  regimeOf: (utcMs: number) => Regime,
  thresholds: BandThresholds,
  minMarginMs: number,
): SegmentBands {
  const resolutionMs = sourceResolutionMs(transitions);
  const marginMs = Math.max(minMarginMs, resolutionMs);
  const grouped = new Map<string, { from: string; to: string; produccion: number[]; noche: number[] }>();
  for (const transition of transitions) {
    const key = pairKey(transition.from, transition.to);
    let entry = grouped.get(key);
    if (entry === undefined) {
      entry = { from: transition.from, to: transition.to, produccion: [], noche: [] };
      grouped.set(key, entry);
    }
    entry[transitionRegime(transition, regimeOf)].push(transition.toTime - transition.fromTime);
  }
  const pairs = new Map<string, SegmentBand>();
  for (const [key, entry] of grouped) {
    const band = (durations: number[]): Band | null =>
      durations.length >= thresholds.minBandSamples ? bandOf(durations, marginMs) : null;
    pairs.set(key, { from: entry.from, to: entry.to, produccion: band(entry.produccion), noche: band(entry.noche) });
  }
  return { pairs, ring, positionOf: new Map(ring.map((tagId, index) => [tagId, index])), resolutionMs, marginMs };
}

/**
 * La horquilla que toca a una transición de `from` a `to` en un régimen: la de su propio par o, si no
 * la tiene y los dos están en el anillo, la suma de las horquillas de los tramos que recorre. Sin
 * ninguna de las dos, `null`: esa transición no se mide.
 */
export function bandFor(bands: SegmentBands, from: string, to: string, regime: Regime): BandFor | null {
  const own = bands.pairs.get(pairKey(from, to))?.[regime] ?? null;
  if (own !== null) return { p50Ms: own.p50Ms, p80Ms: own.p80Ms, p95Ms: own.p95Ms, fenceMs: own.fenceMs, source: "tramo" };
  const start = bands.positionOf.get(from);
  const end = bands.positionOf.get(to);
  const size = bands.ring.length;
  if (start === undefined || end === undefined || from === to || size < 2) return null;
  const skipped = (end - start - 1 + size) % size;
  // Reaparecer por detrás del último tag —media vuelta o más de «saltos»— no es un paso que recorra
  // esos tramos: en una guía única no se retrocede, así que es un tag mal situado o una maniobra fuera
  // de la guía. Sumar casi el anillo entero daría una horquilla enorme que nunca sería parada y una
  // razón de ritmo cercana a cero. No se mide (misma guarda que las zonas oscuras).
  if (skipped >= size / 2) return null;
  let p50Ms = 0;
  let p80Ms = 0;
  let p95Ms = 0;
  for (let step = 0; step <= skipped; step += 1) {
    const a = bands.ring[(start + step) % size] as string;
    const b = bands.ring[(start + step + 1) % size] as string;
    const segment = bands.pairs.get(pairKey(a, b))?.[regime] ?? null;
    if (segment === null) return null;
    p50Ms += segment.p50Ms;
    p80Ms += segment.p80Ms;
    p95Ms += segment.p95Ms;
  }
  return { p50Ms, p80Ms, p95Ms, fenceMs: p95Ms + Math.max(p95Ms - p50Ms, bands.marginMs), source: "anillo" };
}

/** Cuánto tiempo cubierto cae en cada régimen, y cuánto en paradas de la producción. */
export interface RegimeExposure {
  readonly produccionMs: number;
  readonly nocheMs: number;
  readonly paradaMs: number;
}

const QUARTER_MS = 15 * 60_000;

export function regimeExposure(
  coverage: readonly Interval[],
  productionStops: readonly Interval[],
  regimeOf: (utcMs: number) => Regime,
): RegimeExposure {
  const stops = mergeIntervals([...productionStops]);
  let produccionMs = 0;
  let nocheMs = 0;
  let paradaMs = 0;
  for (const span of mergeIntervals([...coverage])) {
    for (let cursor = span.from; cursor < span.to; ) {
      const next = Math.min(span.to, (Math.floor(cursor / QUARTER_MS) + 1) * QUARTER_MS);
      const stopped = stops.reduce((sum, stop) => sum + Math.max(0, Math.min(next, stop.to) - Math.max(cursor, stop.from)), 0);
      paradaMs += stopped;
      if (regimeOf(cursor) === "noche") nocheMs += next - cursor - stopped;
      else produccionMs += next - cursor - stopped;
      cursor = next;
    }
  }
  return { produccionMs, nocheMs, paradaMs };
}

/** Un tramo que se mueve entre dos periodos, en el mismo régimen (R-TIM-010). */
export interface BandChange {
  readonly from: string;
  readonly to: string;
  readonly regime: Regime;
  readonly kind: "mas-lento" | "mas-rapido";
  readonly early: Band;
  readonly late: Band;
}

/**
 * Qué tramos cambian de horquilla entre dos periodos, siempre dentro del mismo régimen (R-TIM-007).
 * Se compara la horquilla, no una media: es más lento si la mitad de las pasadas del último periodo
 * tarda más que el 80 % de las del primero, y más rápido si el 80 % del último tarda menos que la
 * mitad del primero. Lo demás cabe en la variación normal del tramo.
 */
export function compareBands(early: SegmentBands, late: SegmentBands): readonly BandChange[] {
  const changes: BandChange[] = [];
  for (const [key, before] of early.pairs) {
    const after = late.pairs.get(key);
    if (after === undefined) continue;
    for (const regime of REGIMES) {
      const a = before[regime];
      const b = after[regime];
      if (a === null || b === null) continue;
      const kind = bandShift(a, b);
      if (kind !== null) changes.push({ from: before.from, to: before.to, regime, kind, early: a, late: b });
    }
  }
  return changes.sort((a, b) => Math.abs(b.late.p50Ms / b.early.p50Ms - 1) - Math.abs(a.late.p50Ms / a.early.p50Ms - 1));
}

/**
 * Si una horquilla se ha movido respecto a otra (R-TIM-010): más lenta si la mitad de las pasadas de
 * la segunda tarda más que el 80 % de la primera; más rápida si el 80 % de la segunda tarda menos que
 * la mitad de la primera; si no, cabe en la variación normal del tramo.
 */
export function bandShift(
  before: Pick<Band, "p50Ms" | "p80Ms">,
  after: Pick<Band, "p50Ms" | "p80Ms">,
): "mas-lento" | "mas-rapido" | null {
  if (after.p50Ms > before.p80Ms) return "mas-lento";
  if (after.p80Ms < before.p50Ms) return "mas-rapido";
  return null;
}

export interface PeriodBandChanges {
  readonly earlyPeriod: Interval;
  readonly latePeriod: Interval;
  readonly changes: readonly BandChange[];
}

/**
 * La horquilla del primer tramo de cobertura contra la del último, con la misma guardia que la
 * comparación entre periodos distantes (`drift.minGapMs`). Con un solo tramo, o dos casi contiguos,
 * no hay dos periodos que comparar y se devuelve `null`.
 */
export function bandChangesBetweenPeriods(
  transitions: readonly Transition[],
  coverage: readonly Interval[],
  ring: readonly string[],
  regimeOf: (utcMs: number) => Regime,
  thresholds: BandThresholds,
  minMarginMs: number,
  minGapMs: number,
): PeriodBandChanges | null {
  const spans = mergeIntervals([...coverage]);
  if (spans.length < 2) return null;
  const earlyPeriod = spans[0] as Interval;
  const latePeriod = spans[spans.length - 1] as Interval;
  if (latePeriod.from - earlyPeriod.to < minGapMs) return null;
  const inside = (period: Interval): Transition[] =>
    transitions.filter((transition) => transition.fromTime >= period.from && transition.toTime <= period.to);
  const early = buildSegmentBands(inside(earlyPeriod), ring, regimeOf, thresholds, minMarginMs);
  const late = buildSegmentBands(inside(latePeriod), ring, regimeOf, thresholds, minMarginMs);
  return { earlyPeriod, latePeriod, changes: compareBands(early, late) };
}

/**
 * La horquilla de cada tramo en CSV (`;`, coma decimal), una fila por tramo y régimen. Es la forma en
 * que el propietario puede guardarla hoy y la que consolidaría F4 mañana; no lleva nada que no esté
 * ya en pantalla.
 */
export function bandsCsv(
  pairs: readonly { readonly from: string; readonly to: string; readonly produccion: Band | null; readonly noche: Band | null }[],
): string {
  const secondsOf = (ms: number): string => (ms / 1000).toFixed(1).replace(".", ",");
  const lines = ["desde;hasta;regimen;muestras;p50_s;p80_s;p95_s;valla_s"];
  for (const pair of pairs) {
    for (const regime of REGIMES) {
      const band = pair[regime];
      if (band === null) continue;
      lines.push(
        [pair.from, pair.to, regime, String(band.samples), secondsOf(band.p50Ms), secondsOf(band.p80Ms), secondsOf(band.p95Ms), secondsOf(band.fenceMs)].join(";"),
      );
    }
  }
  return lines.join("\r\n");
}
