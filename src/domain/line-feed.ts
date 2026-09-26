/**
 * Alimentación de la línea (R-FLO-010): cuántos AGV hay en el pulmón antes de la línea, cuándo la
 * línea se queda sin paso y si fue con AGV esperando o sin ninguno.
 *
 * El propietario (2026-09-26): «si por la línea no pasan AGV está parada; creo que entran 8 AGV como
 * pulmón, pero seguro que sale mejor de las medidas». Y antes: «cuánto se separa el AGV anterior al que
 * retiene, también cuando la entrada a la línea se queda sin AGV; con los tags anteriores a la línea y
 * sus tiempos de recorrido se puede saber cuántos AGV tiene a borde de línea».
 *
 * Todo sale de las lecturas, sin ninguna constante nueva:
 *
 * - **La entrada** es el primer tag de la lista `linea`. Sus pasos, de producción, dan la **cadencia**:
 *   la horquilla del tiempo entre dos AGV seguidos (la misma de R-FLO-007). Un tiempo entre pasos por
 *   encima de la valla es la línea **sin paso**: parada.
 * - **Cuánto le falta a cada AGV**: la mediana del tiempo desde cada tag hasta la entrada, en la misma
 *   vuelta, de producción. Con el último tag que leyó un AGV, lo que le falta es esa mediana menos lo
 *   que lleva desde entonces. Es tiempo de recorrido, nunca distancia (R-TIM-011).
 * - **El pulmón se mide**: a mitad de cada parada larga (la mitad más larga), los AGV que ya deberían
 *   haber llegado y no han llegado están esperando. Los tags donde se les encuentra en la mitad de
 *   esas paradas o más son la
 *   zona del pulmón, desde el más alejado hasta la entrada; lo que se ve una sola vez es otra cosa (un
 *   AGV cargando, uno retirado) y no la define. Su **capacidad** es lo más que llegó a caber.
 * - **Cada parada se clasifica**: si durante la parada algún AGV esperó en el pulmón más de lo que la
 *   línea tarda en tomar uno (la mitad de la cadencia), la línea paró con AGV esperando; si ninguno,
 *   **le faltaron AGV**. Si el AGV que entró después ya estaba en el pulmón cuando tocaba entrar,
 *   tampoco le faltaba: lo tenía en la puerta. Cuando le faltaron, se dice dónde estaba el siguiente en
 *   entrar y dónde se abrió el hueco entre el AGV que entró antes y el que entró después: el tag desde
 *   el que el de detrás se quedó a más de la valla del de delante. Si el de detrás es uno que retiene a
 *   otros (R-AGV-020), se dice: es el hueco que abre delante de sí.
 *
 * Hechos con sus tiempos, sin causa (R-EVI-006).
 */

import type { Interval } from "./coverage.js";
import type { Reading } from "./reading.js";
import { bandOf, type Band, type Regime } from "./segment-bands.js";

export interface LineFeedThresholds {
  /** Muestras mínimas para una mediana de recorrido o para la cadencia (`bands.minBandSamples`). */
  readonly minSamples: number;
  /** Margen mínimo de la valla sobre el 95 % (`flowStops.minStopExcessMs`). */
  readonly minMarginMs: number;
}

export type LineStopKind = "con-pulmon" | "sin-agv" | "sin-medir";

export interface LineStop {
  readonly regime: Regime;
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly durationMs: number;
  readonly kind: LineStopKind;
  /** Lo más que llegaron a esperar a la vez en el pulmón durante la parada. */
  readonly waiting: number;
  /** El AGV que entró antes del hueco y el que entró después. */
  readonly before: string;
  readonly after: string;
  /**
   * Dónde estaba, cuando tocaba entrar, el AGV que acabó el hueco, y cuánto le faltaba. Es él y no «el
   * más cercano»: uno cercano puede ir por otro camino y no llegar nunca a la línea.
   */
  readonly arriving: { readonly agvId: string; readonly tagId: string; readonly remainingMs: number } | null;
  /** Dónde se abrió el hueco entre `before` y `after`, y cuánto era al principio de la vuelta. */
  readonly hole: {
    readonly tagId: string;
    readonly headwayMs: number;
    readonly startTagId: string;
    readonly startHeadwayMs: number;
  } | null;
  /** `after` retiene a otros (R-AGV-020). */
  readonly afterIsHolder: boolean;
  readonly evidence: string;
}

export type LinePassIssueKind = "no-sigue" | "sin-parada";

/** Un paso por la línea que no se comportó como los demás. */
export interface LinePassIssue {
  readonly kind: LinePassIssueKind;
  readonly agvId: string;
  readonly fromUtcMs: number;
  /** Tags de la línea que se leen en la mitad de los pasos o más y este no leyó. */
  readonly missed: readonly string[];
  /** Hasta el siguiente paso por la línea, de otro AGV. */
  readonly nextGapMs: number | null;
  /** De su última lectura en la línea a la siguiente. */
  readonly exitMs: number | null;
  readonly evidence: string;
}

/** Un AGV que no lee un tag de la línea en la mitad de sus pasos o más, con la cadencia normal. */
export interface LineReader {
  readonly agvId: string;
  readonly passes: number;
  readonly missedPasses: number;
  readonly tags: readonly string[];
}

export interface LinePassages {
  readonly total: number;
  /** Los tags de la línea que se leen en la mitad de los pasos o más: los que se esperan. */
  readonly expected: readonly string[];
  /** De la última lectura en la línea a la siguiente, de producción. */
  readonly exit: Band | null;
  /** Por debajo, el siguiente entró antes de lo que la línea permite: el de delante no paró. */
  readonly minGapMs: number | null;
  /** Una línea de vinculación: el AGV sigue en paralelo, así que no se busca «sin parada». */
  readonly parallel: boolean;
  readonly readers: readonly LineReader[];
  readonly issues: readonly LinePassIssue[];
}

/**
 * El ritmo de la línea en un régimen. El ciclo no es fijo (propietario, 2026-09-26: «normalmente se
 * fabrica un vehículo en 55 segundos, no es fijo: habrá periodos de 50 y otros de 60; por la noche es
 * diferente»), así que cada tiempo entre pasos se compara con el **ciclo local**, la mediana de los
 * tiempos que lo rodean, y no con uno del día entero.
 */
export interface LineRhythm {
  readonly regime: Regime;
  readonly gaps: number;
  /** Mediana de todo el régimen. */
  readonly cycleMs: number;
  /** Entre qué valores anda el ciclo local: el 10 % y el 90 % de los ciclos locales. */
  readonly cycleLowMs: number;
  readonly cycleHighMs: number;
  /** Tiempo con la línea observada: la suma de los tiempos entre pasos. */
  readonly observedMs: number;
  /** Lo que los tiempos entre pasos se pasan de su ciclo local, sumado: la línea sin paso. */
  readonly lostMs: number;
  /**
   * De eso, con AGV esperando y sin ninguno; `null` sin pulmón. En una parada, como la parada; en un
   * hueco corto, según hubiera en el pulmón, cuando tocaba entrar, un AGV que ya tenía que haber llegado.
   */
  readonly lostWithAgvMs: number | null;
  readonly lostWithoutAgvMs: number | null;
}

export interface LineFeed {
  readonly evaluated: boolean;
  readonly reason: string | null;
  readonly entryTagId: string;
  readonly passes: number;
  /** Tiempo entre dos AGV seguidos en la entrada, de producción. */
  readonly cadence: Band | null;
  /** Lo mismo de noche, si hay muestras. */
  readonly nightCadence: Band | null;
  /** Cada paso por la línea, ordenado: la batería de cada incidencia mira si la línea seguía. */
  readonly passTimes: readonly number[];
  /** La zona del pulmón medida, o `null` si no hubo paradas bastantes para medirla. */
  readonly zone: {
    /** Donde esperan en las paradas largas; `typical` es lo habitual en ellas y `capacity`, lo más. */
    readonly tags: readonly string[];
    /** Todos los tags del pulmón, desde su inicio hasta la línea incluida. */
    readonly members: readonly string[];
    readonly fromTagId: string;
    readonly etaMs: number;
    readonly capacity: number;
    readonly typical: number;
    readonly stopsMeasured: number;
  } | null;
  /** Minutos de producción con cada número de AGV en el pulmón. */
  readonly occupancy: readonly { readonly agvs: number; readonly minutes: number }[];
  /** Todas las paradas de la entrada, de la más larga a la más corta. */
  readonly stops: readonly LineStop[];
  /** Cada paso por la línea: qué tags lee, si sigue y si hace la parada. */
  readonly passages: LinePassages | null;
  /** El ritmo de la línea, en producción y de noche. */
  readonly rhythm: readonly LineRhythm[];
}

interface Step {
  readonly tagId: string;
  readonly utcMs: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function duration(ms: number): string {
  return ms >= 120_000 ? `${(ms / 60_000).toFixed(1).replace(".", ",")} min` : `${Math.round(ms / 1000)} s`;
}

/** Las lecturas de cada AGV en orden, con las repeticiones seguidas del mismo tag en una. */
function vehicleSteps(readings: readonly Reading[]): Map<string, Step[]> {
  const byVehicle = new Map<string, Step[]>();
  for (const reading of readings) {
    const steps = byVehicle.get(reading.agvId) ?? [];
    steps.push({ tagId: reading.tagId, utcMs: reading.time.utcMs });
    byVehicle.set(reading.agvId, steps);
  }
  for (const [agvId, steps] of byVehicle) {
    steps.sort((a, b) => a.utcMs - b.utcMs);
    byVehicle.set(
      agvId,
      steps.filter((step, index) => index === 0 || (steps[index - 1] as Step).tagId !== step.tagId),
    );
  }
  return byVehicle;
}

function covered(coverage: readonly Interval[], from: number, to: number): boolean {
  return coverage.length === 0 || coverage.some((span) => span.from <= from && to <= span.to);
}

export function measureLineFeed(
  readings: readonly Reading[],
  lineTags: readonly string[],
  coverage: readonly Interval[],
  regimeOf: (utcMs: number) => Regime,
  thresholds: LineFeedThresholds,
  holders: ReadonlySet<string> = new Set(),
  /** Funciones críticas declaradas: una línea con `vinculacion` sigue en paralelo y no para. */
  funcionOf: ReadonlyMap<string, string> = new Map(),
  /**
   * Las paradas de la producción (R-AGV-018): con toda la flota parada, un AGV que no sigue tras la
   * línea no dice nada de él, así que ahí no se señala ningún paso.
   */
  productionStops: readonly Interval[] = [],
): LineFeed {
  const entryTagId = lineTags[0] ?? "";
  const empty = (reason: string, passes = 0, cadence: Band | null = null): LineFeed => ({
    evaluated: false,
    reason,
    entryTagId,
    passes,
    cadence,
    nightCadence: null,
    passTimes: [],
    zone: null,
    occupancy: [],
    stops: [],
    passages: null,
    rhythm: [],
  });
  if (entryTagId === "") return empty("No hay lista «linea» cargada: sin ella no se sabe dónde entra la línea.");

  const byVehicle = vehicleSteps(readings);
  const production = (utcMs: number): boolean => regimeOf(utcMs) === "produccion";

  // Lo que tarda cada tag hasta la línea, en la misma vuelta, y los pasos por la línea. Un paso es leer
  // cualquiera de sus tags, no solo la entrada: un AGV que no lee la entrada pero sí el resto también
  // pasó, y sin contarlo la cadencia vería un hueco doble donde no lo hay.
  const lineSet = new Set(lineTags);
  const etaSamples = new Map<string, number[]>();
  const passes: { utcMs: number; agvId: string; index: number }[] = [];
  for (const [agvId, steps] of byVehicle) {
    let seen = new Map<string, number>();
    for (const [index, step] of steps.entries()) {
      if (!lineSet.has(step.tagId)) {
        seen.set(step.tagId, step.utcMs);
        continue;
      }
      if (index > 0 && lineSet.has((steps[index - 1] as Step).tagId)) continue;
      passes.push({ utcMs: step.utcMs, agvId, index });
      if (production(step.utcMs)) {
        for (const [tagId, utcMs] of seen) {
          if (!production(utcMs)) continue;
          const list = etaSamples.get(tagId) ?? [];
          list.push(step.utcMs - utcMs);
          etaSamples.set(tagId, list);
        }
      }
      seen = new Map();
    }
  }
  const eta = new Map<string, number>(lineTags.map((tagId) => [tagId, 0]));
  for (const [tagId, samples] of etaSamples) {
    if (samples.length >= thresholds.minSamples) eta.set(tagId, median(samples));
  }

  passes.sort((a, b) => a.utcMs - b.utcMs);
  const gaps: { from: (typeof passes)[number]; to: (typeof passes)[number]; regime: Regime }[] = [];
  for (let index = 1; index < passes.length; index += 1) {
    const from = passes[index - 1] as (typeof passes)[number];
    const to = passes[index] as (typeof passes)[number];
    // Cada tiempo entre pasos, en su régimen: la noche tiene otro ritmo y se mide aparte (R-TIM-009).
    const regime = regimeOf(from.utcMs);
    if (regimeOf(to.utcMs) === regime && covered(coverage, from.utcMs, to.utcMs)) gaps.push({ from, to, regime });
  }
  const productionGaps = gaps.filter((gap) => gap.regime === "produccion");
  if (productionGaps.length < thresholds.minSamples) {
    return empty(
      `Por la línea pasan ${passes.length} AGV: hacen falta ${thresholds.minSamples} tiempos entre pasos de producción para medir su cadencia.`,
      passes.length,
    );
  }
  // La cadencia, sin los tiempos que cruzan una parada de la producción: un descanso no dice cada
  // cuánto entra un AGV. Esos huecos siguen siendo paradas de la línea; solo no miden su ritmo.
  const inProductionStop = (gap: (typeof gaps)[number]): boolean =>
    productionStops.some((stop) => stop.from < gap.to.utcMs && gap.from.utcMs < stop.to);
  const cadenceGaps = productionGaps.filter((gap) => !inProductionStop(gap));
  const cadence = bandOf(
    (cadenceGaps.length >= thresholds.minSamples ? cadenceGaps : productionGaps).map((gap) => gap.to.utcMs - gap.from.utcMs),
    thresholds.minMarginMs,
  );
  const nightGaps = gaps.filter((gap) => gap.regime === "noche");
  const nightCadence =
    nightGaps.length >= thresholds.minSamples
      ? bandOf(
          nightGaps.map((gap) => gap.to.utcMs - gap.from.utcMs),
          thresholds.minMarginMs,
        )
      : null;
  const bandFor = (regime: Regime): Band | null => (regime === "produccion" ? cadence : nightCadence);
  const stopGaps = gaps.filter((gap) => {
    const band = bandFor(gap.regime);
    return band !== null && gap.to.utcMs - gap.from.utcMs > band.fenceMs;
  });
  const longest = Math.max(0, ...stopGaps.map((gap) => gap.to.utcMs - gap.from.utcMs));

  // Dónde está cada AGV en un instante: su último tag leído y lo que le falta hasta la entrada.
  const lastStep = (steps: readonly Step[], utcMs: number): Step | null => {
    let lo = 0;
    let hi = steps.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((steps[mid] as Step).utcMs <= utcMs) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? null : (steps[lo - 1] as Step);
  };
  const positions = (utcMs: number, maxAgeMs: number) => {
    const out: { agvId: string; tagId: string; etaMs: number; remainingMs: number }[] = [];
    for (const [agvId, steps] of byVehicle) {
      const step = lastStep(steps, utcMs);
      if (step === null || utcMs - step.utcMs > maxAgeMs) continue;
      const etaMs = eta.get(step.tagId);
      if (etaMs === undefined) continue;
      out.push({ agvId, tagId: step.tagId, etaMs, remainingMs: etaMs - (utcMs - step.utcMs) });
    }
    return out;
  };

  // El pulmón: los tags donde esperan, a mitad de cada parada, los AGV que ya deberían haber entrado.
  // Se mira en la mitad más larga de las paradas: en una corta los AGV no llegan a acumularse, y con
  // muchas paradas cortas el pulmón salía medido en los dos últimos tags.
  const durations = stopGaps.map((gap) => gap.to.utcMs - gap.from.utcMs);
  const halfMs = durations.length === 0 ? 0 : median(durations);
  // El pulmón se mide con las paradas de producción: de noche el ritmo y la flota son otros.
  const longStops = stopGaps.filter((gap) => gap.regime === "produccion" && gap.to.utcMs - gap.from.utcMs >= halfMs);
  const overdueTags = new Map<string, number>();
  for (const gap of longStops) {
    const mid = (gap.from.utcMs + gap.to.utcMs) / 2;
    const tags = new Set(
      positions(mid, longest)
        .filter((entry) => entry.remainingMs <= 0 && !lineSet.has(entry.tagId))
        .map((entry) => entry.tagId),
    );
    for (const tagId of tags) overdueTags.set(tagId, (overdueTags.get(tagId) ?? 0) + 1);
  }
  const zoneTags = [...overdueTags]
    .filter(([, count]) => longStops.length >= 2 && count * 2 >= longStops.length)
    .map(([tagId]) => tagId)
    .sort((a, b) => (eta.get(b) ?? 0) - (eta.get(a) ?? 0));
  const zoneEta = zoneTags.length === 0 ? null : (eta.get(zoneTags[0] as string) as number);
  // Los tags del pulmón son los que los AGV recorren de verdad desde su inicio hasta la entrada, en la
  // mitad de esos recorridos o más. No se decide por lo que le falta a cada tag: un tag de otra parte
  // del circuito puede tener una mediana corta si a veces se lee por otro camino.
  const zoneSet = new Set<string>();
  if (zoneEta !== null) {
    const fromTagId = zoneTags[0] as string;
    const seen = new Map<string, number>();
    let runs = 0;
    for (const steps of byVehicle.values()) {
      let run: Set<string> | null = null;
      for (const step of steps) {
        if (step.tagId === fromTagId) run = new Set([fromTagId]);
        else if (lineSet.has(step.tagId)) {
          if (run !== null) {
            runs += 1;
            for (const tagId of run) seen.set(tagId, (seen.get(tagId) ?? 0) + 1);
          }
          run = null;
        } else run?.add(step.tagId);
      }
    }
    for (const [tagId, count] of seen) if (count * 2 >= runs) zoneSet.add(tagId);
    for (const tagId of lineTags) zoneSet.add(tagId);
  }
  const inZone = (utcMs: number): number =>
    positions(utcMs, longest).filter((entry) => zoneSet.has(entry.tagId) && entry.remainingMs > -longest).length;
  // Esperando: en el pulmón y con su llegada vencida en más de lo que la línea tarda en tomar el
  // siguiente AGV, que es la mitad de la cadencia.
  const waitingIn = (utcMs: number, cycleMs: number): number =>
    positions(utcMs, longest).filter(
      (entry) =>
        zoneSet.has(entry.tagId) && !lineSet.has(entry.tagId) && entry.remainingMs < -cycleMs && entry.remainingMs > -longest,
    ).length;

  const stops: LineStop[] = [];
  for (const gap of stopGaps) {
    const band = bandFor(gap.regime) as Band;
    const durationMs = gap.to.utcMs - gap.from.utcMs;
    const due = gap.from.utcMs + band.p50Ms;
    // Se mira a lo largo de la parada, a paso de la cadencia: un AGV que esperó en el pulmón más de lo
    // que la línea tarda en tomarlo prueba que la línea no tomaba. Mirar solo al principio llamaba «le
    // faltaron AGV» a una parada en que los AGV llegaron un momento después y se quedaron esperando.
    let waiting = 0;
    for (let at = due + band.p50Ms; at < gap.to.utcMs; at += band.p50Ms) waiting = Math.max(waiting, waitingIn(at, band.p50Ms));
    const afterAt = positions(due, longest).find((entry) => entry.agvId === gap.to.agvId);
    const arriving: LineStop["arriving"] =
      afterAt === undefined ? null : { agvId: afterAt.agvId, tagId: afterAt.tagId, remainingMs: afterAt.remainingMs };
    // Si el que entró después ya estaba en el pulmón cuando tocaba entrar, a la línea no le faltaba AGV:
    // lo tenía en la puerta y no lo tomó.
    const atTheDoor = arriving !== null && zoneSet.has(arriving.tagId);
    const waitingOthers = waiting;
    if (atTheDoor) waiting = Math.max(waiting, 1);
    // Sin pulmón medido no se puede decir si esperaban o faltaban: se dice que no se sabe.
    const kind: LineStopKind = zoneEta === null ? "sin-medir" : waiting === 0 ? "sin-agv" : "con-pulmon";
    let hole: LineStop["hole"] = null;
    if (kind === "sin-agv") {
      // El hueco: en los tags que leyeron los dos en esta vuelta, cuánto iba el de detrás del de delante.
      const lapOf = (agvId: string, index: number): Map<string, number> => {
        const steps = byVehicle.get(agvId) ?? [];
        const lap = new Map<string, number>();
        for (let at = index - 1; at >= 0 && !lineSet.has((steps[at] as Step).tagId); at -= 1) {
          const step = steps[at] as Step;
          if (!lap.has(step.tagId)) lap.set(step.tagId, step.utcMs);
        }
        return lap;
      };
      const lapBefore = lapOf(gap.from.agvId, gap.from.index);
      const lapAfter = lapOf(gap.to.agvId, gap.to.index);
      const shared = [...lapAfter]
        .filter(([tagId]) => lapBefore.has(tagId))
        .sort((a, b) => a[1] - b[1])
        .map(([tagId, utcMs]) => ({ tagId, headwayMs: utcMs - (lapBefore.get(tagId) as number) }));
      // El hueco es el tramo final en que el de detrás va a más de la valla del de delante, hasta la
      // entrada: un tag suelto con una separación enorme es un desvío de uno de los dos (una calle de
      // carga, por ejemplo), no el hueco.
      let from = shared.length;
      while (from > 0 && (shared[from - 1] as (typeof shared)[number]).headwayMs > band.fenceMs) from -= 1;
      const opened = from < shared.length ? shared[from] : undefined;
      const start = shared[0];
      if (opened !== undefined && start !== undefined) {
        hole = { tagId: opened.tagId, headwayMs: opened.headwayMs, startTagId: start.tagId, startHeadwayMs: start.headwayMs };
      }
    }
    const afterIsHolder = holders.has(gap.to.agvId);
    const evidence =
      kind === "sin-medir"
        ? `La entrada estuvo ${duration(durationMs)} sin paso. Sin el pulmón medido no se sabe si había AGV esperando o si faltaban.`
        : kind === "con-pulmon"
        ? atTheDoor && waitingOthers === 0
          ? `La entrada estuvo ${duration(durationMs)} sin paso con ${gap.to.agvId} ya en el pulmón, en ${arriving?.tagId ?? "—"}: la línea paró con un AGV en la puerta.`
          : `La entrada estuvo ${duration(durationMs)} sin paso con hasta ${waiting} AGV esperando en el pulmón: la línea paró con AGV esperando.`
        : `La entrada estuvo ${duration(durationMs)} sin paso y sin ningún AGV en el pulmón cuando tocaba entrar el siguiente: le faltaron AGV.` +
          (arriving === null
            ? ""
            : ` ${arriving.agvId}, el siguiente en entrar, estaba en ${arriving.tagId}, a ${duration(Math.max(0, arriving.remainingMs))} de la entrada (lo que se tarda de mediana desde ahí).`) +
          (hole === null
            ? ""
            : hole.tagId === hole.startTagId
              ? ` Entre ${gap.from.agvId}, que entró antes, y ${gap.to.agvId}, que entró después, ya había ${duration(hole.startHeadwayMs)} al empezar la vuelta, ` +
                `en ${hole.startTagId} (lo habitual entre dos AGV en la entrada, ${duration(band.p50Ms)}): el hueco venía de antes y el pulmón ya no lo cubrió.`
              : ` Entre ${gap.from.agvId}, que entró antes, y ${gap.to.agvId}, que entró después, había ${duration(hole.startHeadwayMs)} en ${hole.startTagId}; ` +
                `el hueco se abrió en ${hole.tagId}, donde ya eran ${duration(hole.headwayMs)} (lo habitual entre dos AGV en la entrada, ${duration(band.p50Ms)}).`) +
          (afterIsHolder ? ` ${gap.to.agvId} es de los que retienen a otros: es el hueco que abre delante de sí.` : "");
    stops.push({
      regime: gap.regime,
      fromUtcMs: gap.from.utcMs,
      toUtcMs: gap.to.utcMs,
      durationMs,
      kind,
      waiting,
      before: gap.from.agvId,
      after: gap.to.agvId,
      arriving,
      hole,
      afterIsHolder,
      evidence,
    });
  }
  stops.sort((a, b) => b.durationMs - a.durationMs);

  const zone =
    zoneEta === null
      ? null
      : (() => {
          const perStop = stops.filter((stop) => stop.kind === "con-pulmon").map((stop) => stop.waiting);
          // Lo habitual, en las paradas largas: en una corta el pulmón no llega a llenarse.
          const perLongStop = stops
            .filter((stop) => stop.kind === "con-pulmon" && stop.durationMs >= halfMs)
            .map((stop) => stop.waiting);
          return {
            tags: zoneTags,
            members: [...zoneSet].sort(),
            fromTagId: zoneTags[0] as string,
            etaMs: zoneEta,
            capacity: Math.max(0, ...perStop),
            typical: perLongStop.length === 0 ? 0 : Math.round(median(perLongStop)),
            stopsMeasured: stopGaps.length,
          };
        })();

  // Minuto a minuto de producción cubierta, cuántos AGV había en el pulmón.
  const counts = new Map<number, number>();
  if (zone !== null) {
    const first = passes[0]?.utcMs ?? 0;
    const last = passes[passes.length - 1]?.utcMs ?? 0;
    for (let utcMs = first; utcMs <= last; utcMs += 60_000) {
      if (!production(utcMs) || !covered(coverage, utcMs, utcMs)) continue;
      const agvs = inZone(utcMs);
      counts.set(agvs, (counts.get(agvs) ?? 0) + 1);
    }
  }

  // El ritmo en cada régimen: cada tiempo entre pasos contra su ciclo local, la mediana de los que lo
  // rodean (tantos como muestras mínimas pide una horquilla). Lo que se pasa es línea sin paso; se
  // separa según hubiera en el pulmón, cuando tocaba entrar, un AGV que ya tenía que haber llegado.
  const rhythm: LineRhythm[] = [];
  const stopKindAt = new Map(stops.map((stop) => [stop.fromUtcMs, stop.kind]));
  for (const regime of ["produccion", "noche"] as const) {
    const list = gaps.filter((gap) => gap.regime === regime);
    if (list.length < thresholds.minSamples) continue;
    const values = list.map((gap) => gap.to.utcMs - gap.from.utcMs);
    const half = Math.floor(thresholds.minSamples / 2);
    const local = values.map((_, index) =>
      median(values.slice(Math.max(0, index - half), Math.min(values.length, index + half + 1))),
    );
    let lostMs = 0;
    let withAgv = 0;
    let withoutAgv = 0;
    list.forEach((gap, index) => {
      const cycleMs = local[index] as number;
      const extra = (values[index] as number) - cycleMs;
      if (extra <= 0) return;
      lostMs += extra;
      if (zoneEta === null) return;
      // Un hueco que es una parada se reparte como la parada, que mira a lo largo de toda ella: en el
      // instante en que tocaba entrar, los AGV de un descanso aún no llevan retraso y parecerían faltar.
      const stop = stopKindAt.get(gap.from.utcMs);
      if (stop !== undefined) {
        if (stop === "con-pulmon") withAgv += extra;
        else if (stop === "sin-agv") withoutAgv += extra;
        return;
      }
      const due = gap.from.utcMs + cycleMs;
      const ready = positions(due, longest).some(
        (entry) => zoneSet.has(entry.tagId) && !lineSet.has(entry.tagId) && entry.remainingMs <= 0 && entry.remainingMs > -longest,
      );
      if (ready) withAgv += extra;
      else withoutAgv += extra;
    });
    const sortedLocal = [...local].sort((a, b) => a - b);
    const at = (q: number): number => sortedLocal[Math.floor(q * (sortedLocal.length - 1))] as number;
    rhythm.push({
      regime,
      gaps: list.length,
      cycleMs: median(values),
      cycleLowMs: at(0.1),
      cycleHighMs: at(0.9),
      observedMs: values.reduce((sum, value) => sum + value, 0),
      lostMs,
      lostWithAgvMs: zoneEta === null ? null : withAgv,
      lostWithoutAgvMs: zoneEta === null ? null : withoutAgv,
    });
  }

  // Cada paso por la línea (R-FLO-011): qué tags de la línea lee, si sigue después y si el siguiente
  // entra antes de lo que la línea permite, que es la señal de que este no hizo la parada.
  const runs: { agvId: string; fromUtcMs: number; lastUtcMs: number; read: Set<string>; next: Step | null }[] = [];
  for (const [agvId, steps] of byVehicle) {
    for (let index = 0; index < steps.length; index += 1) {
      if (!lineSet.has((steps[index] as Step).tagId)) continue;
      let end = index;
      while (end + 1 < steps.length && lineSet.has((steps[end + 1] as Step).tagId)) end += 1;
      const first = steps[index] as Step;
      if (production(first.utcMs)) {
        runs.push({
          agvId,
          fromUtcMs: first.utcMs,
          lastUtcMs: (steps[end] as Step).utcMs,
          read: new Set(steps.slice(index, end + 1).map((step) => step.tagId)),
          next: steps[end + 1] ?? null,
        });
      }
      index = end;
    }
  }
  runs.sort((a, b) => a.fromUtcMs - b.fromUtcMs);
  const readCount = new Map<string, number>();
  for (const run of runs) for (const tagId of run.read) readCount.set(tagId, (readCount.get(tagId) ?? 0) + 1);
  const expected = lineTags.filter((tagId) => (readCount.get(tagId) ?? 0) * 2 >= runs.length);
  const exitSamples = runs.filter((run) => run.next !== null).map((run) => (run.next as Step).utcMs - run.lastUtcMs);
  const exit = exitSamples.length >= thresholds.minSamples ? bandOf(exitSamples, thresholds.minMarginMs) : null;
  const nextGap = new Map<(typeof runs)[number], number>();
  for (let index = 0; index + 1 < runs.length; index += 1) {
    const run = runs[index] as (typeof runs)[number];
    const following = runs[index + 1] as (typeof runs)[number];
    if (covered(coverage, run.fromUtcMs, following.fromUtcMs)) nextGap.set(run, following.fromUtcMs - run.fromUtcMs);
  }
  const sortedGaps = [...nextGap.values()].sort((a, b) => a - b);
  // El mínimo que la línea permite entre dos AGV, en espejo de la valla: el 5 % de los tiempos entre
  // pasos, menos lo que va de ahí a la mitad (y al menos el margen de siempre).
  const quantileOf = (q: number): number => sortedGaps[Math.floor(q * (sortedGaps.length - 1))] as number;
  const minGapMs =
    sortedGaps.length >= thresholds.minSamples
      ? (() => {
          const low = quantileOf(0.05);
          const value = low - Math.max(quantileOf(0.5) - low, thresholds.minMarginMs);
          return value > 0 ? value : null;
        })()
      : null;
  const parallel = lineTags.some((tagId) => funcionOf.get(tagId) === "vinculacion");

  const issues: LinePassIssue[] = [];
  const perAgv = new Map<string, { passes: number; missedPasses: number; tags: Set<string> }>();
  for (const run of runs) {
    const missed = expected.filter((tagId) => !run.read.has(tagId));
    const gapMs = nextGap.get(run) ?? null;
    const exitMs = run.next === null ? null : run.next.utcMs - run.lastUtcMs;
    const missedText = missed.length === 0 ? "" : ` No leyó ${missed.join(", ")}.`;
    const until = run.next?.utcMs ?? run.lastUtcMs;
    if (productionStops.some((stop) => stop.from < until && run.fromUtcMs < stop.to)) continue;
    if (exit !== null && exitMs !== null && exitMs > exit.fenceMs && run.next !== null) {
      issues.push({
        kind: "no-sigue",
        agvId: run.agvId,
        fromUtcMs: run.fromUtcMs,
        missed,
        nextGapMs: gapMs,
        exitMs,
        evidence:
          `${run.agvId} pasó por la línea y tardó ${duration(exitMs)} en leer el siguiente tag (${run.next.tagId}); ` +
          `lo habitual, hasta ${duration(exit.fenceMs)}.${missedText} Comprobar si se quedó en la línea, por ejemplo con el pin del carro sin bajar.`,
      });
    } else if (!parallel && minGapMs !== null && gapMs !== null && gapMs < minGapMs) {
      issues.push({
        kind: "sin-parada",
        agvId: run.agvId,
        fromUtcMs: run.fromUtcMs,
        missed,
        nextGapMs: gapMs,
        exitMs,
        evidence:
          `El siguiente AGV pasó por la línea ${duration(gapMs)} después de ${run.agvId}; la línea no deja menos de ${duration(minGapMs)} ` +
          `entre dos.${missedText} ${run.agvId} no hizo la parada: comprobar si se fue con el carro.`,
      });
    } else {
      const entry = perAgv.get(run.agvId) ?? { passes: 0, missedPasses: 0, tags: new Set<string>() };
      entry.passes += 1;
      if (missed.length > 0) {
        entry.missedPasses += 1;
        for (const tagId of missed) entry.tags.add(tagId);
      }
      perAgv.set(run.agvId, entry);
    }
  }
  const readers = [...perAgv]
    .filter(([, entry]) => entry.missedPasses * 2 >= entry.passes && entry.missedPasses > 0)
    .map(([agvId, entry]) => ({ agvId, passes: entry.passes, missedPasses: entry.missedPasses, tags: [...entry.tags].sort() }))
    .sort((a, b) => b.missedPasses - a.missedPasses || a.agvId.localeCompare(b.agvId));
  const passages: LinePassages = { total: runs.length, expected, exit, minGapMs, parallel, readers, issues };
  // Una parada que empieza con un AGV que no siguió tras la línea: la línea paró detrás de él.
  const stuckAt = new Map(
    issues.filter((issue) => issue.kind === "no-sigue").map((issue) => [`${issue.agvId}\u0000${issue.fromUtcMs}`, issue]),
  );
  const annotated = stops.map((stop) => {
    const stuck = stuckAt.get(`${stop.before}\u0000${stop.fromUtcMs}`);
    return stuck === undefined
      ? stop
      : { ...stop, evidence: `${stop.evidence} ${stop.before}, el último en entrar, no siguió tras la línea: tardó ${duration(stuck.exitMs ?? 0)} en leer el siguiente tag.` };
  });

  return {
    passages,
    rhythm,
    evaluated: true,
    reason: zone === null ? "Sin dos paradas de la línea o más no se puede medir dónde esperan los AGV: el pulmón queda sin medir." : null,
    entryTagId,
    passes: passes.length,
    cadence,
    nightCadence,
    passTimes: passes.map((pass) => pass.utcMs),
    zone,
    occupancy: [...counts].sort((a, b) => a[0] - b[0]).map(([agvs, minutes]) => ({ agvs, minutes })),
    stops: annotated,
  };
}

/** Las paradas de la línea y los pasos que no se comportaron como los demás, en CSV con `;`, para planta. */
export function lineStopsCsv(feed: LineFeed, formatTime: (utcMs: number) => string): string {
  const lines = ["desde;hasta;regimen;minutos;tipo;agv_esperando;entro_antes;entro_despues;donde_estaba;le_faltaba_s;hueco_en;hueco_s;retiene;evidencia"];
  const cell = (value: string | number | null): string => (value === null ? "" : String(value).replace(/;/g, ","));
  for (const stop of feed.stops) {
    lines.push(
      [
        formatTime(stop.fromUtcMs),
        formatTime(stop.toUtcMs),
        stop.regime === "produccion" ? "producción" : "noche",
        (stop.durationMs / 60_000).toFixed(1).replace(".", ","),
        stop.kind === "con-pulmon" ? "con AGV esperando" : stop.kind === "sin-agv" ? "le faltaron AGV" : "sin medir",
        stop.waiting,
        stop.before,
        stop.after,
        stop.arriving === null ? null : stop.arriving.tagId,
        stop.arriving === null ? null : Math.round(Math.max(0, stop.arriving.remainingMs) / 1000),
        stop.hole?.tagId ?? null,
        stop.hole === null ? null : Math.round(stop.hole.headwayMs / 1000),
        stop.afterIsHolder ? "sí" : "",
        stop.evidence,
      ]
        .map(cell)
        .join(";"),
    );
  }
  for (const issue of feed.passages?.issues ?? []) {
    lines.push(
      [
        formatTime(issue.fromUtcMs),
        null,
        "producción",
        null,
        issue.kind === "no-sigue" ? "no sigue tras la línea" : "pasó sin la parada",
        null,
        issue.agvId,
        null,
        null,
        null,
        null,
        null,
        "",
        issue.evidence,
      ]
        .map(cell)
        .join(";"),
    );
  }
  return lines.join("\r\n");
}

/**
 * Lo que una parada de la línea no deja medir: los AGV que esperaban en el pulmón mientras la línea
 * estaba parada con AGV esperando. Sus transiciones son cola, no el tiempo del tramo, y contaminarían la
 * horquilla de esos tramos igual que un descanso (R-AGV-018). Los AGV que siguen moviéndose fuera del
 * pulmón sí miden, así que solo se quitan los tags del pulmón y de la línea, y solo durante la parada.
 */
export interface LineStopExclusion {
  readonly intervals: readonly Interval[];
  readonly tags: ReadonlySet<string>;
}

export function lineStopExclusion(feed: LineFeed): LineStopExclusion {
  if (feed.zone === null) return { intervals: [], tags: new Set() };
  return {
    intervals: feed.stops.filter((stop) => stop.kind === "con-pulmon").map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs })),
    tags: new Set(feed.zone.members),
  };
}

/** Las transiciones que no salen del pulmón mientras la línea estaba parada con AGV esperando. */
export function outsideLineStops<T extends { readonly from: string; readonly fromTime: number; readonly toTime: number }>(
  transitions: readonly T[],
  exclusion: LineStopExclusion,
): readonly T[] {
  if (exclusion.intervals.length === 0) return transitions;
  return transitions.filter(
    (transition) =>
      !exclusion.tags.has(transition.from) ||
      !exclusion.intervals.some((stop) => stop.from < transition.toTime && transition.fromTime < stop.to),
  );
}
