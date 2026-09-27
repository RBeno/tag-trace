/**
 * La medición de cada fichero y la posición en tiempo de cada tag (R-TIM-011).
 *
 * Una **franja es un fichero** (propietario, 2026-09-25): cada exportación se mide por separado con
 * sus propias lecturas, dentro de su ventana completa (`StoredSource.complete`). Dos exportaciones
 * que se solapan comparten las lecturas del tramo común —la unión las cuenta una vez— y cada una se
 * mide en su ventana; un fichero repetido se mide una sola vez y se dice.
 *
 * **Qué se mide**, por franja y circuito, con las transiciones ya limpias (lecturas agrupadas
 * colapsadas, fuera de las paradas de la producción, medibles):
 *
 * - la horquilla de cada tramo por régimen (R-FLO-007), con la primera y la última vez que se vio;
 * - el anillo de esa franja, rotado al ancla del circuito si aparece en él;
 * - la **posición en tiempo** de cada tag: los segundos desde el ancla, sumando la mediana de
 *   producción de cada paso. Es **tiempo de recorrido, nunca distancia**. Si un paso no tiene
 *   muestras —un tag que casi no se lee—, se salta hasta `maxSkip` tags con la mediana del salto
 *   directo; si tampoco, la posición queda desconocida. Nunca se interpola;
 * - la vuelta entera, del ancla al ancla.
 *
 * **No se guarda una copia fija**: se rehace idéntica desde las lecturas en cada importación y se
 * descarga en CSV (propietario, 2026-09-25). Guardarla como referencia es consolidar, y eso es F4.
 *
 * **Historia de cada tramo** entre franjas seguidas, en el mismo régimen, con la regla de R-TIM-010
 * (`bandShift`): un único salto que se mantiene es un **escalón**; ningún salto entre seguidas pero
 * el primero y el último distintos, con la mediana moviéndose siempre hacia el mismo lado, es una
 * **deriva**. Con dos ficheros no se distinguen, y se dice.
 */

import type { Interval } from "./coverage.js";
import { quantile, type Transition } from "./graph.js";
import { findDominantCycle, resolveDeclaredAnchor } from "./laps.js";
import {
  bandShift,
  buildSegmentBands,
  pairKey,
  REGIMES,
  transitionRegime,
  type Band,
  type BandThresholds,
  type Regime,
} from "./segment-bands.js";

export interface FranjaThresholds {
  /** Pasos mínimos de producción para dar la mediana de un paso al situar un tag. */
  readonly minPositionSamples: number;
}

export interface FranjaSource {
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  /** La ventana analizable del fichero; la cola cortada queda fuera (R-DAT-007). */
  readonly complete: Interval | null;
}

export interface FranjaWindow {
  readonly source: FranjaSource;
  readonly window: Interval;
  /** El fichero anterior idéntico (mismo hash), si lo hay: se mide una vez. */
  readonly duplicateOf: string | null;
}

export interface TagPosition {
  readonly tagId: string;
  /** Segundos de recorrido desde el ancla, en ms; `null` si no se puede situar. */
  readonly offsetMs: number | null;
  /** Pasos con que se midió el último tramo hasta él. */
  readonly samples: number;
}

export interface FranjaBand {
  readonly from: string;
  readonly to: string;
  readonly produccion: Band | null;
  readonly noche: Band | null;
  readonly firstSeenUtcMs: number;
  readonly lastSeenUtcMs: number;
}

export interface FranjaCohort {
  readonly cohortId: number;
  /** El anillo de esta franja; vacío si no hay ciclo dominante limpio. */
  readonly ring: readonly string[];
  readonly anchorTagId: string | null;
  /** Si el ancla del circuito aparece en el anillo de esta franja: si no, las posiciones no se comparan. */
  readonly anchorShared: boolean;
  readonly positions: readonly TagPosition[];
  readonly lapMs: number | null;
  readonly resolutionMs: number;
  readonly bands: readonly FranjaBand[];
}

/**
 * Las ventanas de los ficheros, en orden de inicio. Uno sin ventana completa no se mide; uno
 * repetido se marca con el anterior idéntico.
 */
export function franjaWindows(sources: readonly FranjaSource[]): readonly FranjaWindow[] {
  const firstByHash = new Map<string, string>();
  const windows: FranjaWindow[] = [];
  for (const source of sources) {
    if (source.complete === null) continue;
    const earlier = firstByHash.get(source.sourceHash);
    if (earlier === undefined) firstByHash.set(source.sourceHash, source.sourceId);
    windows.push({ source, window: source.complete, duplicateOf: earlier ?? null });
  }
  return windows.sort((a, b) => a.window.from - b.window.from || a.window.to - b.window.to);
}

/** Dentro de una ventana: las dos lecturas de la transición. */
export function insideWindow(transition: Pick<Transition, "fromTime" | "toTime">, window: Interval): boolean {
  return transition.fromTime >= window.from && transition.toTime <= window.to;
}

/**
 * La posición en tiempo de cada tag del anillo desde el ancla (`ring[0]`), con las transiciones de
 * producción dadas. Nunca interpola: sin mediana hasta un tag, ni directa ni saltando hasta
 * `maxSkip` tags anteriores, queda desconocido.
 */
export function timePositions(
  transitions: readonly Transition[],
  ring: readonly string[],
  minSamples: number,
  maxSkip: number,
): { readonly positions: readonly TagPosition[]; readonly lapMs: number | null } {
  const durations = new Map<string, number[]>();
  for (const transition of transitions) {
    if (transition.sameInstant) continue;
    const key = pairKey(transition.from, transition.to);
    const list = durations.get(key);
    if (list === undefined) durations.set(key, [transition.toTime - transition.fromTime]);
    else list.push(transition.toTime - transition.fromTime);
  }
  const medianOf = (from: string, to: string): { ms: number; samples: number } | null => {
    const list = durations.get(pairKey(from, to));
    if (list === undefined || list.length < minSamples) return null;
    return { ms: quantile([...list].sort((a, b) => a - b), 0.5), samples: list.length };
  };

  const offsets: (number | null)[] = ring.map((_, index) => (index === 0 ? 0 : null));
  const samples: number[] = ring.map(() => 0);
  for (let i = 1; i < ring.length; i += 1) {
    for (let j = i - 1; j >= Math.max(0, i - 1 - maxSkip); j -= 1) {
      const base = offsets[j];
      if (base === null || base === undefined) continue;
      const step = medianOf(ring[j] as string, ring[i] as string);
      if (step === null) continue;
      offsets[i] = base + step.ms;
      samples[i] = step.samples;
      break;
    }
  }
  let lapMs: number | null = null;
  const anchor = ring[0];
  for (let j = ring.length - 1; anchor !== undefined && j >= Math.max(0, ring.length - 1 - maxSkip); j -= 1) {
    const base = offsets[j];
    if (base === null || base === undefined) continue;
    const step = medianOf(ring[j] as string, anchor);
    if (step === null) continue;
    lapMs = base + step.ms;
    break;
  }
  return {
    positions: ring.map((tagId, index) => ({ tagId, offsetMs: offsets[index] ?? null, samples: samples[index] ?? 0 })),
    lapMs,
  };
}

export interface FranjaCohortInput {
  readonly cohortId: number;
  /** Todas las transiciones del circuito (colapsadas): de ellas sale el anillo de la franja. */
  readonly transitions: readonly Transition[];
  /** Las medibles, fuera de paradas de la producción: de ellas salen horquillas y posiciones. */
  readonly measured: readonly Transition[];
  /** El ancla efectiva del circuito, para que las posiciones de todas las franjas empiecen igual. */
  readonly anchorTagId: string;
}

/** La medición de un circuito en una franja. */
export function measureFranjaCohort(
  input: FranjaCohortInput,
  window: Interval,
  regimeOf: (utcMs: number) => Regime,
  bandThresholds: BandThresholds,
  minMarginMs: number,
  thresholds: FranjaThresholds,
  maxSkip: number,
): FranjaCohort {
  const inside = input.transitions.filter((transition) => insideWindow(transition, window));
  const measured = input.measured.filter((transition) => insideWindow(transition, window));
  const cycle = findDominantCycle(inside);
  const rotated = cycle === null ? null : resolveDeclaredAnchor(cycle, [input.anchorTagId]);
  const ring = rotated?.cycle ?? cycle?.cycle ?? [];
  const bands = buildSegmentBands(measured, ring, regimeOf, bandThresholds, minMarginMs);

  const seen = new Map<string, { first: number; last: number }>();
  for (const transition of measured) {
    const key = pairKey(transition.from, transition.to);
    const entry = seen.get(key);
    if (entry === undefined) seen.set(key, { first: transition.fromTime, last: transition.fromTime });
    else {
      if (transition.fromTime < entry.first) entry.first = transition.fromTime;
      if (transition.fromTime > entry.last) entry.last = transition.fromTime;
    }
  }
  const rows: FranjaBand[] = [...bands.pairs.entries()]
    .filter(([, pair]) => pair.produccion !== null || pair.noche !== null)
    .map(([key, pair]) => ({
      ...pair,
      firstSeenUtcMs: seen.get(key)?.first ?? window.from,
      lastSeenUtcMs: seen.get(key)?.last ?? window.to,
    }));

  const production = measured.filter((transition) => transitionRegime(transition, regimeOf) === "produccion");
  const { positions, lapMs } =
    ring.length === 0 ? { positions: [], lapMs: null } : timePositions(production, ring, thresholds.minPositionSamples, maxSkip);
  return {
    cohortId: input.cohortId,
    ring,
    anchorTagId: ring[0] ?? null,
    anchorShared: rotated !== null,
    positions,
    lapMs,
    resolutionMs: bands.resolutionMs,
    bands: rows,
  };
}

export type HistoryKind = "escalon" | "deriva" | "cambio";

export interface SegmentHistoryPoint {
  readonly sourceId: string;
  readonly p50Ms: number;
  readonly p80Ms: number;
  readonly p95Ms: number;
  readonly samples: number;
}

export interface SegmentHistory {
  readonly from: string;
  readonly to: string;
  readonly regime: Regime;
  readonly kind: HistoryKind;
  readonly direction: "mas-lento" | "mas-rapido";
  /** El fichero donde empieza el escalón o el cambio; `null` en una deriva. */
  readonly atSourceId: string | null;
  readonly points: readonly SegmentHistoryPoint[];
}

/**
 * Qué tramos cambian a lo largo de los ficheros, en el mismo régimen. Recibe las franjas en orden de
 * tiempo, sin repetidas, con la medición de un mismo circuito.
 */
export function segmentHistories(
  franjas: readonly {
    readonly sourceId: string;
    /** Basta con el par y sus horquillas: las instantáneas (ADR-0015) no guardan primera y última vez. */
    readonly bands: readonly Pick<FranjaBand, "from" | "to" | "produccion" | "noche">[];
  }[],
): readonly SegmentHistory[] {
  const keys = new Map<string, { from: string; to: string }>();
  for (const franja of franjas) for (const row of franja.bands) keys.set(pairKey(row.from, row.to), { from: row.from, to: row.to });

  const histories: SegmentHistory[] = [];
  for (const [key, pair] of keys) {
    for (const regime of REGIMES) {
      const points: (SegmentHistoryPoint & { readonly band: Band })[] = [];
      for (const franja of franjas) {
        const band = franja.bands.find((row) => pairKey(row.from, row.to) === key)?.[regime] ?? null;
        if (band !== null) {
          points.push({ sourceId: franja.sourceId, p50Ms: band.p50Ms, p80Ms: band.p80Ms, p95Ms: band.p95Ms, samples: band.samples, band });
        }
      }
      const verdict = classifyHistory(points.map((point) => point.band));
      if (verdict === null) continue;
      histories.push({
        from: pair.from,
        to: pair.to,
        regime,
        kind: verdict.kind,
        direction: verdict.direction,
        atSourceId: verdict.at === null ? null : (points[verdict.at]?.sourceId ?? null),
        points: points.map(({ band: _band, ...point }) => point),
      });
    }
  }
  const size = (history: SegmentHistory): number => {
    const first = history.points[0]?.p50Ms ?? 1;
    const last = history.points[history.points.length - 1]?.p50Ms ?? 1;
    return Math.abs(last / Math.max(1, first) - 1);
  };
  return histories.sort((a, b) => size(b) - size(a) || a.from.localeCompare(b.from));
}

/**
 * La historia de una serie de horquillas de un mismo tramo y régimen, en orden de tiempo (R-TIM-010):
 * `cambio` con dos, `escalon` con un único salto que se mantiene, `deriva` moviéndose siempre hacia el
 * mismo lado; `null` si nada cambió o el salto volvió atrás. `at` es el índice donde empieza. La usan
 * `segmentHistories` (desde lecturas) y `historiesFromSnapshots` (desde instantáneas) para que las dos
 * digan lo mismo.
 */
export function classifyHistory(
  bands: readonly Band[],
): { kind: HistoryKind; direction: "mas-lento" | "mas-rapido"; at: number | null } | null {
  if (bands.length < 2) return null;
  const first = bands[0] as Band;
  const last = bands[bands.length - 1] as Band;
  if (bands.length === 2) {
    const shift = bandShift(first, last);
    return shift === null ? null : { kind: "cambio", direction: shift, at: 1 };
  }
  const steps = bands.slice(1).map((band, index) => bandShift(bands[index] as Band, band));
  const jumps = steps.map((shift, index) => ({ shift, at: index + 1 })).filter((entry) => entry.shift !== null);
  const overall = bandShift(first, last);
  const monotone = (direction: "mas-lento" | "mas-rapido"): boolean =>
    bands.every((band, index) => {
      if (index === 0) return true;
      const previous = (bands[index - 1] as Band).p50Ms;
      return direction === "mas-lento" ? band.p50Ms >= previous : band.p50Ms <= previous;
    });

  if (jumps.length === 1) {
    const { shift, at } = jumps[0] as { shift: "mas-lento" | "mas-rapido"; at: number };
    const before = bands[at - 1] as Band;
    // El escalón se mantiene: todos los ficheros de después siguen al otro lado del de antes.
    const holds = bands.slice(at).every((band) => bandShift(before, band) === shift);
    return holds ? { kind: "escalon", direction: shift, at } : null;
  }
  if (overall === null || !monotone(overall)) return null;
  // Ningún salto entre seguidos, o varios hacia el mismo lado: se va moviendo poco a poco.
  if (jumps.every((entry) => entry.shift === overall)) return { kind: "deriva", direction: overall, at: null };
  return null;
}

/**
 * La medición de un fichero en CSV (`;`, coma decimal), una fila por tramo y régimen, con la
 * primera y la última vez que se vio y la posición en tiempo del tag de salida.
 */
export function franjaCsv(cohort: FranjaCohort, formatInstant: (utcMs: number) => string): string {
  const seconds = (ms: number): string => (ms / 1000).toFixed(1).replace(".", ",");
  const positionOf = new Map(cohort.positions.map((entry) => [entry.tagId, entry.offsetMs]));
  const lines = ["desde;hasta;regimen;muestras;p50_s;p80_s;p95_s;valla_s;primera;ultima;posicion_desde_s"];
  for (const row of cohort.bands) {
    for (const regime of REGIMES) {
      const band = row[regime];
      if (band === null) continue;
      const position = positionOf.get(row.from);
      lines.push(
        [
          row.from,
          row.to,
          regime,
          String(band.samples),
          seconds(band.p50Ms),
          seconds(band.p80Ms),
          seconds(band.p95Ms),
          seconds(band.fenceMs),
          formatInstant(row.firstSeenUtcMs),
          formatInstant(row.lastSeenUtcMs),
          position === undefined || position === null ? "" : seconds(position),
        ].join(";"),
      );
    }
  }
  return lines.join("\r\n");
}
