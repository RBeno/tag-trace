/**
 * La repercusión de una incidencia medida como una onda (ADR-0017 §4, R-INC-005).
 *
 * El propietario (2026-09-27): «en vez de medir una cantidad, medir la repercusión como una onda en un
 * estanque. Ejemplo: un AGV cargado que se detiene durante 7 minutos, cómo se propaga, cómo afecta,
 * cuándo se vuelve a la calma».
 *
 * Desde un **epicentro** —un AGV que se queda en un sitio más de lo que toca— una guía única produce,
 * por construcción, dos frentes:
 *
 * - **aguas arriba, una cola**: los que llegan se detienen detrás. Son las retenciones de `flowStops`
 *   (R-AGV-018, R-FLO-008) cuya cadena de quien retiene acaba en el epicentro;
 * - **aguas abajo, un hueco**: el de delante sigue y se separa. En cada punto vigilado (anclas,
 *   críticos) el tiempo entre el paso anterior y el del epicentro, frente a lo habitual de ese punto.
 *
 * Y además: la línea (tiempo sin paso y pasos que faltan frente a su ciclo local, OQ-162), el pulmón
 * minuto a minuto, el coste en AGV·minutos por encima del p50 de cada tramo, la atenuación con la
 * distancia, el eco una vuelta después y la **vuelta a la calma** (OQ-159).
 *
 * Todo sale de las horquillas medidas; lo único que viene de configuración son cuántas vueltas p50
 * tiene que aguantar la calma y el tope del «después» (`WaveThresholds`), en vueltas, no en minutos.
 * Nada nombra causas: estar en la cola es «retenido detrás de», y el hueco en la línea es «compatible
 * con» (ADR-0017 §5, R-INC-007).
 */

import type { AnalysisConfig } from "./config.js";
import { mergeIntervals, type Interval } from "./coverage.js";
import type { ProductionStop, Retention, VehicleStop } from "./flow-stops.js";
import type { Transition } from "./graph.js";
import {
  bandFor,
  bandOf,
  measurableTransitions,
  transitionRegime,
  type Band,
  type Regime,
  type SegmentBands,
} from "./segment-bands.js";

export interface WaveThresholds {
  /** Vueltas p50 que la zona tiene que aguantar dentro de su horquilla para dar la calma (OQ-159). */
  readonly calmLaps: number;
  /** Tope del «después», en vueltas p50 desde el fin del epicentro. */
  readonly maxAfterLaps: number;
  /** Muestras mínimas de una horquilla de separaciones o de la cadencia (`bands.minBandSamples`). */
  readonly minSamples: number;
  /** Margen mínimo de una valla (`flowStops.minStopExcessMs`). */
  readonly minMarginMs: number;
  /** Hasta cuántos tags cuenta un vecino (`flowStops.reachTags`): el borde del alcance. */
  readonly reachTags: number;
}

/**
 * Los umbrales de la onda desde la configuración: los suyos (`incidentWave`) y los que comparte con el
 * resto del análisis, para que una horquilla o una valla se midan igual aquí que en `flowStops`.
 */
export function waveThresholds(config: AnalysisConfig): WaveThresholds {
  return {
    calmLaps: config.incidentWave.calmLaps,
    maxAfterLaps: config.incidentWave.maxAfterLaps,
    minSamples: config.bands.minBandSamples,
    minMarginMs: config.flowStops.minStopExcessMs,
    reachTags: config.flowStops.reachTags,
  };
}

export type WaveEpicenterKind = "parada" | "bloqueo" | "deja-de-leer" | "parada-linea";

export interface WaveEpicenter {
  readonly kind: WaveEpicenterKind;
  readonly agvId: string;
  /** El tag donde se quedó: su última lectura antes del hueco. */
  readonly tagId: string;
  readonly fromUtcMs: number;
  /** Su siguiente lectura; `null` si no vuelve a leer en lo cargado. */
  readonly toUtcMs: number | null;
}

export interface WaveLine {
  /** Cada paso por la línea, de cualquier AGV (`LineFeed.passTimes`). */
  readonly passTimes: readonly number[];
  /** Los tags del pulmón, desde su inicio hasta la línea (`LineFeed.zone.members`); vacío sin pulmón. */
  readonly bufferTags: readonly string[];
}

export interface WaveInput {
  readonly transitions: readonly Transition[];
  readonly coverage: readonly Interval[];
  readonly bands: SegmentBands;
  readonly regimeOf: (utcMs: number) => Regime;
  readonly laneTags: ReadonlySet<string>;
  /** Paradas y retenciones del mismo análisis (`flowStops`). */
  readonly stops: readonly VehicleStop[];
  readonly retentions: readonly Retention[];
  readonly productionStops: readonly ProductionStop[];
  readonly line: WaveLine | null;
  /** Puntos vigilados aguas abajo: anclas, críticos y la entrada de la línea. */
  readonly watchTags: readonly string[];
  /** Zona declarada de un tag (R-FLO-001 a R-FLO-003), o `null` si no se sabe. */
  readonly zoneOf: (tagId: string) => "cargado" | "vacio" | null;
}

/** Un AGV retenido detrás del epicentro. */
export interface WaveQueueMember {
  readonly agvId: string;
  /** Dónde esperó: el tag de su primera retención. */
  readonly tagId: string;
  /** Tags por detrás del epicentro, siguiendo el anillo. */
  readonly behind: number;
  readonly joinedUtcMs: number;
  readonly releasedUtcMs: number;
  /** Lo que esperó por encima del p50 de sus tramos, sumado. */
  readonly waitMs: number;
  /** A quién esperaba directamente. */
  readonly holderAgvId: string;
}

/** El hueco al pasar por un punto vigilado por delante del epicentro. */
export interface WavePoint {
  readonly tagId: string;
  readonly ahead: number;
  /** El paso anterior por el punto, de otro AGV. */
  readonly previousUtcMs: number | null;
  /** El paso del AGV del epicentro por el punto; `null` si no llega en lo cargado. */
  readonly epicenterUtcMs: number | null;
  /** Separación entre los dos; `null` si falta alguno. */
  readonly holeMs: number | null;
  /** Lo habitual del punto (tiempo entre pasos seguidos, fuera de la ventana); `null` sin horquilla. */
  readonly usual: Band | null;
  /** Cuándo tocaba el paso que no llegó: el anterior más lo habitual. */
  readonly expectedUtcMs: number | null;
  readonly overFence: boolean | null;
}

export type WaveCalmStatus = "medida" | "interrumpida" | "fuera-de-cobertura" | "abierta" | "sin-medir";

export interface WaveCalm {
  readonly status: WaveCalmStatus;
  /** El instante de la calma; solo con `medida`. */
  readonly calmUtcMs: number | null;
  /** Calma − fin del epicentro; solo con `medida`. */
  readonly recoveryMs: number | null;
  /** Con `fuera-de-cobertura`: la recuperación es **al menos** esto. */
  readonly atLeastMs: number | null;
  /** El tramo de estabilización que tuvo que aguantar. */
  readonly stabilizationMs: number | null;
  readonly reason: string;
}

export interface WaveCostPart {
  /** AGV·ms por encima del p50 de cada tramo. */
  readonly excessMs: number;
  readonly transitions: number;
  /** Transiciones sin horquilla: su exceso es desconocido, no cero. */
  readonly unknown: number;
}

export interface WaveCost {
  readonly epicenter: WaveCostPart;
  readonly queue: WaveCostPart;
  readonly rest: WaveCostPart;
  /**
   * Lo que el resto de la flota suma por encima del p50 en un tiempo igual sin incidencia, a su ritmo
   * del «antes»: la mitad de las transiciones pasa del p50 por construcción, así que `rest` no se lee
   * solo. `null` sin «antes» medible.
   */
  readonly restExpectedMs: number | null;
}

export interface WaveLineImpact {
  /** Mediana de los tiempos entre pasos justo antes del epicentro (tantos como `minSamples`). */
  readonly localCycleMs: number | null;
  readonly passes: number;
  /** Pasos que tocaban con el ciclo local en el intervalo de impacto y no hubo. */
  readonly missingPasses: number | null;
  /** Suma de lo que los tiempos entre pasos superan la valla local. */
  readonly aboveFenceMs: number | null;
}

export interface WaveBuffer {
  /** AGV en el pulmón en cada minuto de la ventana. */
  readonly perMinute: readonly { readonly utcMs: number; readonly agvs: number }[];
  readonly beforeMedian: number | null;
  readonly minDuring: number | null;
  /** El pulmón llegó a vaciarse durante el impacto teniendo AGV antes. */
  readonly emptied: boolean | null;
}

export interface WaveEcho {
  /** Los AGV que salieron juntos de la cola (con el del epicentro) y volvieron a pasar por su tag. */
  readonly vehicles: number;
  /** Mediana de sus separaciones al volver a pasar, una vuelta después. */
  readonly medianHeadwayMs: number | null;
  /** El 20 % de las separaciones habituales en ese tag. */
  readonly usualLowMs: number | null;
  /** Siguen juntos: su separación mediana está por debajo del 20 % habitual. */
  readonly bunched: boolean | null;
}

export interface WaveMeasure {
  readonly epicenter: WaveEpicenter & {
    readonly zone: "cargado" | "vacio" | null;
    readonly durationMs: number | null;
    /** Tags del anillo. */
    readonly ringSize: number;
  };
  /** La vuelta p50 del circuito en producción: la suma de las medianas de sus tramos. */
  readonly lapMs: number | null;
  /** La ventana propuesta (ADR-0017 §2). */
  readonly window: { readonly fromUtcMs: number; readonly toUtcMs: number };
  readonly queue: {
    readonly members: readonly WaveQueueMember[];
    readonly depth: number;
    /** Tags por detrás hasta el último retenido. */
    readonly reach: number;
    /** Tags por minuto a los que crece la cola; `null` si no se puede medir. */
    readonly frontTagsPerMin: number | null;
    /** De fin del epicentro a la salida del último retenido. */
    readonly dischargeMs: number | null;
    /** `baja` en zona vacía: allí se puede rodear al parado (R-FLO-002, R-FLO-006). */
    readonly confidence: "normal" | "baja";
  };
  readonly downstream: readonly WavePoint[];
  readonly line: WaveLineImpact | null;
  readonly buffer: WaveBuffer | null;
  readonly cost: WaveCost;
  /** Exceso sobre el p50 por distancia al epicentro (negativo, detrás), en el intervalo de impacto. */
  readonly attenuation: readonly { readonly offset: number; readonly excessMs: number; readonly transitions: number }[];
  readonly echo: WaveEcho | null;
  readonly calm: WaveCalm;
  /** Otras paradas sin explicación dentro del impacto y del alcance: ondas superpuestas. */
  readonly superposed: readonly { readonly agvId: string; readonly tagId: string; readonly fromUtcMs: number }[];
  readonly lines: readonly string[];
}

interface Track {
  readonly times: number[];
  readonly tags: string[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function lowQuantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

function minutes(ms: number): string {
  return ms >= 120_000 ? `${(ms / 60_000).toFixed(1).replace(".", ",")} min` : `${Math.round(ms / 1000)} s`;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.from < b.to && b.from < a.to;
}

/** La vuelta p50 en producción: la suma de las medianas de los tramos del anillo; `null` si falta alguno. */
export function lapP50Ms(bands: SegmentBands): number | null {
  const { ring } = bands;
  if (ring.length < 2) return null;
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const band = bandFor(bands, ring[index] as string, ring[(index + 1) % ring.length] as string, "produccion");
    if (band === null) return null;
    total += band.p50Ms;
  }
  return total;
}

export function measureWave(input: WaveInput, epicenter: WaveEpicenter, thresholds: WaveThresholds): WaveMeasure {
  const { bands, regimeOf } = input;
  const ring = bands.ring;
  const n = ring.length;
  const positionOf = bands.positionOf;
  const epiPosition = positionOf.get(epicenter.tagId);
  const lapMs = lapP50Ms(bands);
  const floorMs = Math.max(thresholds.minMarginMs, bands.marginMs);

  // El tramo de cobertura del epicentro: lo que está fuera no se mira (R-DAT-007).
  const spans = mergeIntervals([...input.coverage]);
  const allTimes = input.transitions.flatMap((transition) => [transition.fromTime, transition.toTime]);
  const span =
    spans.find((entry) => entry.from <= epicenter.fromUtcMs && epicenter.fromUtcMs <= entry.to) ??
    { from: Math.min(...allTimes, epicenter.fromUtcMs), to: Math.max(...allTimes, epicenter.fromUtcMs) };

  // Dónde estaba cada AGV: su último tag leído.
  const tracks = new Map<string, Track>();
  for (const transition of [...input.transitions].sort((a, b) => a.fromTime - b.fromTime || a.toTime - b.toTime)) {
    let own = tracks.get(transition.agvId);
    if (own === undefined) {
      own = { times: [], tags: [] };
      tracks.set(transition.agvId, own);
    }
    if (own.times[own.times.length - 1] !== transition.fromTime || own.tags[own.tags.length - 1] !== transition.from) {
      own.times.push(transition.fromTime);
      own.tags.push(transition.from);
    }
    own.times.push(transition.toTime);
    own.tags.push(transition.to);
  }
  const tagAt = (agvId: string, utcMs: number): string | null => {
    const own = tracks.get(agvId);
    if (own === undefined) return null;
    let lo = 0;
    let hi = own.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((own.times[mid] as number) <= utcMs) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? null : (own.tags[lo - 1] as string);
  };
  /** Los pasos por un tag: la primera lectura de cada racha del mismo tag, de cada AGV. */
  const passCache = new Map<string, { agvId: string; utcMs: number }[]>();
  const passesAt = (tagId: string): { agvId: string; utcMs: number }[] => {
    const cached = passCache.get(tagId);
    if (cached !== undefined) return cached;
    const found: { agvId: string; utcMs: number }[] = [];
    for (const [agvId, own] of tracks) {
      own.tags.forEach((tag, index) => {
        if (tag === tagId && own.tags[index - 1] !== tagId) found.push({ agvId, utcMs: own.times[index] as number });
      });
    }
    found.sort((a, b) => a.utcMs - b.utcMs || (a.agvId < b.agvId ? -1 : 1));
    passCache.set(tagId, found);
    return found;
  };

  const epiEnd = epicenter.toUtcMs;
  const windowFrom = Math.max(span.from, epicenter.fromUtcMs - (lapMs ?? 0));
  const afterCap =
    epiEnd === null || lapMs === null ? span.to : Math.min(span.to, epiEnd + thresholds.maxAfterLaps * lapMs);
  const inProductionStop = (from: number, to: number): boolean =>
    input.productionStops.some((stop) => overlaps({ from, to }, { from: stop.fromUtcMs, to: stop.toUtcMs }));

  // Aguas arriba: la cola. Una retención es de la cola si quien retiene es el epicentro mientras está
  // parado, o uno de la cola **mientras él mismo está retenido**: la cola que el grupo forma después en
  // otro sitio (la entrada de la línea, por ejemplo) es otra cola, no la del epicentro.
  const epiHeld: Interval = { from: epicenter.fromUtcMs, to: epiEnd ?? afterCap };
  const chosen: Retention[] = [];
  const heldIntervals = new Map<string, Interval[]>([[epicenter.agvId, [epiHeld]]]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const retention of input.retentions) {
      if (retention.agvId === epicenter.agvId || chosen.includes(retention)) continue;
      const own: Interval = { from: retention.fromUtcMs, to: retention.toUtcMs };
      if (!(heldIntervals.get(retention.holderAgvId) ?? []).some((interval) => overlaps(own, interval))) continue;
      chosen.push(retention);
      heldIntervals.set(retention.agvId, [...(heldIntervals.get(retention.agvId) ?? []), own]);
      changed = true;
    }
  }
  const held = new Set<string>(chosen.map((retention) => retention.agvId));
  const members: WaveQueueMember[] = [];
  for (const agvId of [...held].sort()) {
    const own = chosen.filter((retention) => retention.agvId === agvId).sort((a, b) => a.fromUtcMs - b.fromUtcMs);
    const first = own[0];
    if (first === undefined) continue;
    const position = positionOf.get(first.fromTagId);
    const behind = position === undefined || epiPosition === undefined ? -1 : (epiPosition - position + n) % n;
    members.push({
      agvId,
      tagId: first.fromTagId,
      behind,
      joinedUtcMs: first.fromUtcMs,
      releasedUtcMs: Math.max(...own.map((retention) => retention.toUtcMs)),
      waitMs: own.reduce((sum, retention) => sum + retention.waitMs, 0),
      holderAgvId: first.holderAgvId,
    });
  }
  members.sort((a, b) => a.behind - b.behind || a.joinedUtcMs - b.joinedUtcMs);
  const reach = members.reduce((most, member) => Math.max(most, member.behind), 0);
  const farthest = members.filter((member) => member.behind === reach).sort((a, b) => a.joinedUtcMs - b.joinedUtcMs)[0];
  const frontSpan = farthest === undefined ? 0 : farthest.joinedUtcMs - epicenter.fromUtcMs;
  const frontTagsPerMin = farthest === undefined || reach <= 0 || frontSpan <= 0 ? null : reach / (frontSpan / 60_000);
  const lastRelease = members.reduce((latest, member) => Math.max(latest, member.releasedUtcMs), Number.NEGATIVE_INFINITY);
  const dischargeMs = epiEnd === null || members.length === 0 ? null : Math.max(0, lastRelease - epiEnd);
  const zone = input.zoneOf(epicenter.tagId);

  // Lo habitual de un punto: el tiempo entre pasos seguidos, de producción, fuera de la ventana y de las
  // paradas de la producción, en el mismo tramo de cobertura.
  const headwaysAt = (tagId: string): number[] => {
    const passes = passesAt(tagId);
    const gaps: number[] = [];
    for (let index = 1; index < passes.length; index += 1) {
      const from = (passes[index - 1] as { utcMs: number }).utcMs;
      const to = (passes[index] as { utcMs: number }).utcMs;
      if (from < span.from || to > span.to) continue;
      if (overlaps({ from, to }, { from: windowFrom, to: afterCap })) continue;
      if (inProductionStop(from, to) || regimeOf((from + to) / 2) !== "produccion") continue;
      gaps.push(to - from);
    }
    return gaps;
  };
  const headwayBand = (tagId: string): Band | null => {
    const gaps = headwaysAt(tagId);
    return gaps.length >= thresholds.minSamples ? bandOf(gaps, floorMs) : null;
  };

  // Aguas abajo: el hueco en cada punto vigilado por delante.
  const downstream: WavePoint[] = [];
  if (epiPosition !== undefined) {
    for (const tagId of [...new Set(input.watchTags)]) {
      const position = positionOf.get(tagId);
      if (position === undefined) continue;
      const ahead = (position - epiPosition + n) % n;
      if (ahead === 0) continue;
      const passes = passesAt(tagId);
      const own = passes.find((pass) => pass.agvId === epicenter.agvId && pass.utcMs > epicenter.fromUtcMs && pass.utcMs <= afterCap);
      const limit = own?.utcMs ?? afterCap;
      const previous = [...passes].reverse().find((pass) => pass.agvId !== epicenter.agvId && pass.utcMs < limit && pass.utcMs >= windowFrom);
      const usual = headwayBand(tagId);
      const holeMs = own === undefined || previous === undefined ? null : own.utcMs - previous.utcMs;
      downstream.push({
        tagId,
        ahead,
        previousUtcMs: previous?.utcMs ?? null,
        epicenterUtcMs: own?.utcMs ?? null,
        holeMs,
        usual,
        expectedUtcMs: previous === undefined || usual === null ? null : previous.utcMs + usual.p50Ms,
        overFence: holeMs === null || usual === null ? null : holeMs > usual.fenceMs,
      });
    }
  }
  downstream.sort((a, b) => a.ahead - b.ahead);

  // La línea: el ciclo local justo antes y la valla de la cadencia.
  const linePasses = input.line === null ? [] : [...input.line.passTimes].sort((a, b) => a - b);
  const lineGaps: { from: number; to: number }[] = [];
  for (let index = 1; index < linePasses.length; index += 1) {
    lineGaps.push({ from: linePasses[index - 1] as number, to: linePasses[index] as number });
  }
  const cleanGap = (gap: { from: number; to: number }): boolean =>
    gap.from >= span.from && gap.to <= span.to && !inProductionStop(gap.from, gap.to) && regimeOf((gap.from + gap.to) / 2) === "produccion";
  const cadenceGaps = lineGaps.filter((gap) => cleanGap(gap) && !overlaps(gap, { from: windowFrom, to: afterCap })).map((gap) => gap.to - gap.from);
  const cadence = input.line !== null && cadenceGaps.length >= thresholds.minSamples ? bandOf(cadenceGaps, floorMs) : null;
  const beforeGaps = lineGaps.filter((gap) => gap.to <= epicenter.fromUtcMs && cleanGap(gap)).slice(-thresholds.minSamples);
  const localCycleMs =
    beforeGaps.length >= thresholds.minSamples ? median(beforeGaps.map((gap) => gap.to - gap.from)) : (cadence?.p50Ms ?? null);
  const localFenceMs = localCycleMs === null || cadence === null ? null : localCycleMs + (cadence.fenceMs - cadence.p50Ms);

  // Qué AGV están afectados: el del epicentro y su cola. Cuándo vuelven a una transición libre.
  const byVehicle = new Map<string, Transition[]>();
  for (const transition of input.transitions) {
    const list = byVehicle.get(transition.agvId);
    if (list === undefined) byVehicle.set(transition.agvId, [transition]);
    else list.push(transition);
  }
  for (const list of byVehicle.values()) list.sort((a, b) => a.fromTime - b.fromTime);
  const transitionsOf = (agvId: string): readonly Transition[] => byVehicle.get(agvId) ?? [];
  const bandOfTransition = (transition: Transition) =>
    bandFor(bands, transition.from, transition.to, transitionRegime(transition, regimeOf));
  const firstFreeEnd = (agvId: string, afterUtcMs: number): number | null => {
    for (const transition of transitionsOf(agvId)) {
      if (transition.fromTime < afterUtcMs || transition.from === transition.to) continue;
      const band = bandOfTransition(transition);
      if (band !== null && transition.toTime - transition.fromTime <= band.p80Ms) return transition.toTime;
    }
    return null;
  };

  // La vuelta a la calma (OQ-159).
  const calm = ((): WaveCalm => {
    const none = (status: WaveCalmStatus, reason: string, atLeastMs: number | null = null, stabilizationMs: number | null = null): WaveCalm => ({
      status,
      calmUtcMs: null,
      recoveryMs: null,
      atLeastMs,
      stabilizationMs,
      reason,
    });
    if (epiEnd === null) return none("abierta", "el epicentro no termina en lo cargado: no vuelve a leer");
    if (lapMs === null) return none("sin-medir", "sin vuelta p50: falta la horquilla de algún tramo del anillo");
    const stabilizationMs = thresholds.calmLaps * lapMs;
    let candidate = Math.max(epiEnd, lastRelease);
    const released = new Map<string, number>([[epicenter.agvId, epiEnd]]);
    for (const member of members) released.set(member.agvId, member.releasedUtcMs);
    for (const [agvId, from] of released) {
      const free = firstFreeEnd(agvId, from);
      if (free === null) {
        return none("fuera-de-cobertura", `${agvId} no vuelve a una transición libre en lo cargado`, span.to - epiEnd, stabilizationMs);
      }
      candidate = Math.max(candidate, free);
    }
    const affected = [...released.keys()];
    // Se busca un tramo de estabilización sin nada por encima de su valla: ni la línea ni un afectado.
    for (let guard = 0; guard < 10_000; guard += 1) {
      const until = candidate + stabilizationMs;
      if (until > span.to) {
        return none("fuera-de-cobertura", "la cobertura acaba antes de aguantar el tramo de estabilización", span.to - epiEnd, stabilizationMs);
      }
      if (until - epiEnd > thresholds.maxAfterLaps * lapMs + stabilizationMs) {
        return none("sin-medir", `no llega la calma antes del tope de ${thresholds.maxAfterLaps} vueltas`, null, stabilizationMs);
      }
      let next = candidate;
      if (localFenceMs !== null) {
        for (const gap of lineGaps) {
          if (gap.to > candidate && gap.from < until && gap.to - gap.from > localFenceMs) next = Math.max(next, gap.to);
        }
      }
      for (const agvId of affected) {
        for (const transition of transitionsOf(agvId)) {
          if (transition.toTime <= candidate || transition.fromTime >= until) continue;
          const band = bandOfTransition(transition);
          if (band !== null && transition.toTime - transition.fromTime > band.fenceMs) next = Math.max(next, transition.toTime);
        }
      }
      if (next === candidate) break;
      candidate = next;
    }
    const until = candidate + stabilizationMs;
    if (inProductionStop(epicenter.fromUtcMs, until)) {
      return none("interrumpida", "una parada de la producción cae dentro: la calma no se alarga hasta después", null, stabilizationMs);
    }
    for (let at = epicenter.fromUtcMs; at <= until; at += 60_000) {
      if (regimeOf(at) !== "produccion") {
        return none("interrumpida", "la noche empieza antes de la calma", null, stabilizationMs);
      }
    }
    return {
      status: "medida",
      calmUtcMs: candidate,
      recoveryMs: candidate - epiEnd,
      atLeastMs: null,
      stabilizationMs,
      reason:
        `cola descargada, cada AGV afectado con una transición por debajo del p80 y ` +
        `${input.line === null ? "sus transiciones" : "la línea y sus transiciones"} dentro de la valla ` +
        `durante ${minutes(stabilizationMs)}`,
    };
  })();

  const impactEnd = calm.calmUtcMs ?? afterCap;
  const windowTo = Math.min(span.to, calm.calmUtcMs !== null && lapMs !== null ? calm.calmUtcMs + lapMs : afterCap);

  // La línea en el intervalo de impacto.
  let line: WaveLineImpact | null = null;
  if (input.line !== null) {
    const inside = linePasses.filter((time) => time >= epicenter.fromUtcMs && time <= impactEnd).length;
    const aboveFenceMs =
      localFenceMs === null
        ? null
        : lineGaps
            .filter((gap) => gap.to > epicenter.fromUtcMs && gap.from < impactEnd)
            .reduce((sum, gap) => sum + Math.max(0, gap.to - gap.from - localFenceMs), 0);
    line = {
      localCycleMs,
      passes: inside,
      missingPasses: localCycleMs === null ? null : Math.max(0, Math.floor((impactEnd - epicenter.fromUtcMs) / localCycleMs) - inside),
      aboveFenceMs,
    };
  }

  // El pulmón minuto a minuto.
  let buffer: WaveBuffer | null = null;
  if (input.line !== null && input.line.bufferTags.length > 0) {
    const members = new Set(input.line.bufferTags);
    const perMinute: { utcMs: number; agvs: number }[] = [];
    for (let at = Math.ceil(windowFrom / 60_000) * 60_000; at <= windowTo; at += 60_000) {
      let agvs = 0;
      for (const agvId of tracks.keys()) {
        const tag = tagAt(agvId, at);
        if (tag !== null && members.has(tag)) agvs += 1;
      }
      perMinute.push({ utcMs: at, agvs });
    }
    const before = perMinute.filter((entry) => entry.utcMs < epicenter.fromUtcMs).map((entry) => entry.agvs);
    const during = perMinute.filter((entry) => entry.utcMs >= epicenter.fromUtcMs && entry.utcMs <= impactEnd).map((entry) => entry.agvs);
    const beforeMedian = median(before);
    const minDuring = during.length === 0 ? null : Math.min(...during);
    buffer = {
      perMinute,
      beforeMedian,
      minDuring,
      emptied: beforeMedian === null || minDuring === null ? null : beforeMedian > 0 && minDuring === 0,
    };
  }

  // Coste y atenuación: transiciones de producción con el punto medio en el impacto.
  const measurable = measurableTransitions(input.transitions, input.coverage, input.laneTags);
  const part = (): { excessMs: number; transitions: number; unknown: number } => ({ excessMs: 0, transitions: 0, unknown: 0 });
  const cost = { epicenter: part(), queue: part(), rest: part() };
  const queueIds = new Set(members.map((member) => member.agvId));
  const byOffset = new Map<number, { excessMs: number; transitions: number }>();
  let beforeExcess = 0;
  const beforeVehicles = new Set<string>();
  for (const transition of measurable) {
    const middle = (transition.fromTime + transition.toTime) / 2;
    if (transitionRegime(transition, regimeOf) !== "produccion" || inProductionStop(transition.fromTime, transition.toTime)) continue;
    const band = bandOfTransition(transition);
    const excess = band === null ? 0 : Math.max(0, transition.toTime - transition.fromTime - band.p50Ms);
    if (middle >= windowFrom && middle < epicenter.fromUtcMs && band !== null) {
      beforeExcess += excess;
      beforeVehicles.add(transition.agvId);
      continue;
    }
    if (middle < epicenter.fromUtcMs || middle > impactEnd) continue;
    const target = transition.agvId === epicenter.agvId ? cost.epicenter : queueIds.has(transition.agvId) ? cost.queue : cost.rest;
    target.transitions += 1;
    if (band === null) {
      target.unknown += 1;
      continue;
    }
    target.excessMs += excess;
    const position = positionOf.get(transition.from);
    if (position !== undefined && epiPosition !== undefined) {
      let offset = (position - epiPosition + n) % n;
      if (offset > n / 2) offset -= n;
      const entry = byOffset.get(offset) ?? { excessMs: 0, transitions: 0 };
      entry.excessMs += excess;
      entry.transitions += 1;
      byOffset.set(offset, entry);
    }
  }
  const beforeMs = epicenter.fromUtcMs - windowFrom;
  const restVehicles = [...tracks.keys()].filter((agvId) => agvId !== epicenter.agvId && !queueIds.has(agvId)).length;
  const restExpectedMs =
    beforeMs <= 0 || beforeVehicles.size === 0
      ? null
      : (beforeExcess / (beforeVehicles.size * beforeMs)) * restVehicles * (impactEnd - epicenter.fromUtcMs);
  const attenuation = [...byOffset.entries()]
    .map(([offset, entry]) => ({ offset, excessMs: entry.excessMs, transitions: entry.transitions }))
    .sort((a, b) => a.offset - b.offset);

  // El eco: los que salieron juntos, ¿siguen juntos una vuelta después?
  let echo: WaveEcho | null = null;
  if (epiEnd !== null && lapMs !== null && members.length > 0) {
    const group = new Map<string, number>([[epicenter.agvId, epiEnd]]);
    for (const member of members) group.set(member.agvId, member.releasedUtcMs);
    const next: number[] = [];
    for (const [agvId, release] of group) {
      const pass = passesAt(epicenter.tagId).find(
        (entry) => entry.agvId === agvId && entry.utcMs > release + lapMs / 2 && entry.utcMs <= release + 1.5 * lapMs,
      );
      if (pass !== undefined) next.push(pass.utcMs);
    }
    next.sort((a, b) => a - b);
    const headways = next.slice(1).map((time, index) => time - (next[index] as number));
    const usualLowMs = lowQuantile(headwaysAt(epicenter.tagId), 0.2);
    const medianHeadwayMs = median(headways);
    echo = {
      vehicles: next.length,
      medianHeadwayMs,
      usualLowMs,
      bunched: medianHeadwayMs === null || usualLowMs === null ? null : medianHeadwayMs < usualLowMs,
    };
  }

  // Ondas superpuestas: otras paradas sin explicación en el impacto y en el alcance.
  const aheadExtent = Math.max(thresholds.reachTags, ...downstream.filter((point) => point.overFence === true).map((point) => point.ahead));
  const behindExtent = reach + thresholds.reachTags;
  const superposed = input.stops
    .filter((stop) => stop.justification === "sin-explicacion" && stop.agvId !== epicenter.agvId && !queueIds.has(stop.agvId))
    .filter((stop) => overlaps({ from: stop.fromUtcMs, to: stop.toUtcMs }, { from: epicenter.fromUtcMs, to: impactEnd }))
    .filter((stop) => {
      const position = positionOf.get(stop.fromTagId);
      if (position === undefined || epiPosition === undefined) return false;
      let offset = (position - epiPosition + n) % n;
      if (offset > n / 2) offset -= n;
      return offset >= -behindExtent && offset <= aheadExtent;
    })
    .map((stop) => ({ agvId: stop.agvId, tagId: stop.fromTagId, fromUtcMs: stop.fromUtcMs }));

  const measure: Omit<WaveMeasure, "lines"> = {
    epicenter: {
      ...epicenter,
      zone,
      durationMs: epiEnd === null ? null : epiEnd - epicenter.fromUtcMs,
      ringSize: n,
    },
    lapMs,
    window: { fromUtcMs: windowFrom, toUtcMs: windowTo },
    queue: {
      members,
      depth: members.length,
      reach,
      frontTagsPerMin,
      dischargeMs,
      confidence: zone === "vacio" ? "baja" : "normal",
    },
    downstream,
    line,
    buffer,
    cost: { ...cost, restExpectedMs },
    attenuation,
    echo,
    calm,
    superposed,
  };
  return { ...measure, lines: waveLines(measure) };
}

/** La onda en frases, en el orden de la medida. Hechos con sus cifras, sin causa (R-INC-007). */
function waveLines(measure: Omit<WaveMeasure, "lines">): string[] {
  const { epicenter, queue, downstream, line, buffer, cost, echo, calm, superposed } = measure;
  const lines: string[] = [];
  const zone = epicenter.zone === "cargado" ? " en zona cargada" : epicenter.zone === "vacio" ? " en zona vacía" : "";
  lines.push(
    `Epicentro: ${epicenter.agvId} en ${epicenter.tagId}${zone}, ` +
      (epicenter.durationMs === null ? "sin volver a leer en lo cargado." : `${minutes(epicenter.durationMs)} sin avanzar.`),
  );
  if (queue.depth === 0) {
    lines.push("Aguas arriba: nadie quedó retenido detrás.");
  } else {
    lines.push(
      `Aguas arriba: ${queue.depth} AGV retenidos detrás, hasta ${queue.reach} tags atrás` +
        (queue.frontTagsPerMin === null ? "" : `; la cola creció a ${queue.frontTagsPerMin.toFixed(1).replace(".", ",")} tags/min`) +
        (queue.dischargeMs === null ? "." : `; se descargó ${minutes(queue.dischargeMs)} después de reanudar.`),
    );
    if (queue.confidence === "baja") lines.push("En zona vacía se puede rodear al parado: la cola se da con confianza baja.");
  }
  for (const point of downstream.filter((entry) => entry.holeMs !== null && entry.usual !== null)) {
    lines.push(
      `Aguas abajo, ${point.tagId} (${point.ahead} tags delante): hueco de ${minutes(point.holeMs as number)} ` +
        `frente a ${minutes((point.usual as Band).p50Ms)} habituales${point.overFence === true ? ", por encima de la valla" : ""}.`,
    );
  }
  if (line !== null) {
    lines.push(
      line.missingPasses === null
        ? "Línea: sin ciclo local con que medir."
        : `Línea: ${line.passes} pasos; faltaron ${line.missingPasses} frente al ciclo local de ${minutes(line.localCycleMs as number)}` +
            (line.aboveFenceMs === null ? "." : `, ${minutes(line.aboveFenceMs)} sin paso por encima de la valla. Compatible con el hueco, no causado por él.`),
    );
  }
  if (buffer !== null && buffer.beforeMedian !== null && buffer.minDuring !== null) {
    lines.push(
      `Pulmón: ${buffer.beforeMedian} AGV antes, ${buffer.minDuring} como mínimo durante` +
        (buffer.emptied === true ? ": se vació." : "."),
    );
  }
  const agvMin = (ms: number): string => (ms / 60_000).toFixed(1).replace(".", ",");
  lines.push(
    `Coste: ${agvMin(cost.epicenter.excessMs)} AGV·min del epicentro, ${agvMin(cost.queue.excessMs)} de la cola y ` +
      `${agvMin(cost.rest.excessMs)} del resto` +
      (cost.restExpectedMs === null ? "" : ` (${agvMin(cost.restExpectedMs)} sin incidencia, a su ritmo de antes)`) +
      `, por encima del p50 de cada tramo.`,
  );
  const unknown = cost.epicenter.unknown + cost.queue.unknown + cost.rest.unknown;
  if (unknown > 0) lines.push(`${unknown} transiciones sin horquilla: su exceso es desconocido, no cero.`);
  if (echo !== null && echo.bunched !== null) {
    lines.push(
      echo.bunched
        ? `Eco: una vuelta después, ${echo.vehicles} AGV siguen juntos (${minutes(echo.medianHeadwayMs as number)} entre ellos).`
        : `Eco: una vuelta después ya no van juntos.`,
    );
  }
  lines.push(
    calm.status === "medida"
      ? `Vuelta a la calma ${minutes(calm.recoveryMs as number)} después de reanudar: ${calm.reason}.`
      : calm.status === "fuera-de-cobertura"
        ? `Vuelta a la calma: al menos ${minutes(calm.atLeastMs as number)} (${calm.reason}).`
        : `Vuelta a la calma sin medir (${calm.reason}).`,
  );
  if (superposed.length > 0) {
    lines.push(
      `Ondas superpuestas con ${superposed.map((entry) => `${entry.agvId} en ${entry.tagId}`).join(", ")}: ` +
        "las cifras son de todas juntas y el reparto es desconocido.",
    );
  }
  return lines;
}
