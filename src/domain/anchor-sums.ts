/**
 * Tags insertados y sustituidos, por la suma entre anclas (R-DAT-021).
 *
 * Los tags casi nunca se mueven (propietario, 2026-09-25): son el marco fijo del circuito. El tiempo
 * entre dos tags que siguen en su sitio —dos **anclas**— es una propiedad del recorrido, y se conserva
 * cuando entre ellos se pone, se quita o se cambia un tag. Si cambia, lo que cambió es el
 * comportamiento del tramo, no el sitio.
 *
 * **Anclas.** Los tags de los dos anillos, el de antes y el de después, en el mismo orden cíclico: la
 * subsecuencia común más larga. Un tag cambiado no puede ser ancla —solo está en uno de los dos
 * lados—, y eso es lo que hace robusto el caso de mantenimiento: cuando se cambian dos o tres tags
 * seguidos, el vecino de cada uno es otro cambiado, y emparejar por vecino compartido (R-DAT-017,
 * R-DAT-019) deja suelto el del medio. Entre dos anclas estables, los tres quedan situados.
 *
 * **Pasadas.** En la secuencia de cada AGV, P y luego Q (la siguiente ancla) sin otra ancla en medio,
 * dentro de un mismo tramo de cobertura, sin calles, sin paradas de la producción y sin lecturas que
 * llegaron juntas. De cada una: T = t(Q) − t(P), el desfase de cada tag de en medio y su régimen. Qué
 * tags hay entre dos anclas no depende de la hora, así que la estructura se lee con todas; la suma y
 * los desfases se comparan dentro de un mismo régimen (R-TIM-007): producción, o la noche si a los dos
 * lados no hay bastante producción. Un mantenimiento a las diez de la noche tiene su después de noche.
 *
 * **Cambio de estructura.** Un tag del anillo de un lado, ausente en el otro, con la ausencia
 * improbable por azar dada su tasa en el lado donde sí se lee y sostenida por al menos dos AGV
 * distintos: si todas las pasadas sin él son del mismo vehículo, puede ser su lector y no el circuito,
 * y la ausencia queda sin afirmar (`unconfirmed`). Un tag que se lee en los dos lados,
 * aunque sea a medias, no es un cambio de estructura: eso es de la matriz de lectura. Y uno que se lee
 * de vez en cuando sin formar parte del anillo —un tag de mantenimiento— tampoco: el anillo es el
 * circuito, y un tag que no está en él no se pone ni se quita de la línea.
 *
 * **Emparejamiento sin parámetros.** Los que desaparecen y los que aparecen se emparejan conservando
 * el orden y minimizando la suma de las diferencias de desfase relativo; todos los del grupo más
 * pequeño se emparejan, y lo que sobra del grande es insertado o retirado.
 *
 * **Lectura.** Con la suma igual —la regla de la horquilla (`bandShift`)—: insertado es un tag nuevo en
 * la línea, sustituido con el mismo desfase está en su sitio. Con la suma distinta, el tramo cambió de
 * comportamiento. Un sustituido con otro desfase se lee en otro punto. Con pocas pasadas la estructura
 * se ve igual, porque la ausencia de un tag que se leía siempre se prueba enseguida; la suma queda
 * **sin medir** y se dice.
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import { quantile } from "./graph.js";
import { findDominantCycle } from "./laps.js";
import { compareReadings, type SourceDirection } from "./order.js";
import type { Reading } from "./reading.js";
import { bandShift, type Regime } from "./segment-bands.js";

export interface AnchorSumThresholds {
  /** Pasadas mínimas entre dos anclas en cada lado para comparar la suma. */
  readonly minAnchorPasses: number;
}

export interface AnchorSumContext {
  readonly direction: SourceDirection;
  /** Tramos de cobertura: una pasada no cruza un hueco entre exportaciones. */
  readonly coverage: readonly Interval[];
  readonly laneTags: ReadonlySet<string>;
  readonly productionStops: readonly Interval[];
  readonly regimeOf: (utcMs: number) => Regime;
  /** Lecturas que llegaron juntas (R-DAT-020): sus horas son de llegada, no miden desfases. */
  readonly deliveries: readonly { readonly agvId: string; readonly fromUtcMs: number; readonly toUtcMs: number }[];
  /** Probabilidad máxima de que una ausencia sea casualidad (`tagChanges.maxChance`). */
  readonly maxChance: number;
  /** La resolución de la fuente, el mínimo que se puede afirmar de un desfase. */
  readonly resolutionMs: number;
}

export type StructureChange =
  | {
      readonly kind: "sustituido";
      readonly oldTagId: string;
      readonly newTagId: string;
      readonly oldOffsetMs: number;
      readonly newOffsetMs: number;
      readonly placement: "mismo-sitio" | "otro-punto";
    }
  | { readonly kind: "insertado"; readonly tagId: string; readonly offsetMs: number }
  | { readonly kind: "retirado"; readonly tagId: string; readonly offsetMs: number };

export interface GapSide {
  /** Todas las pasadas, de cualquier régimen: con ellas se lee la estructura. */
  readonly passes: number;
  /** Cuántos AGV distintos hicieron esas pasadas: una ausencia la tienen que sostener al menos dos. */
  readonly vehicles: number;
  /** Las del régimen en que se compara la suma (todas, si no hay ninguno con bastantes a los dos lados). */
  readonly p50Ms: number | null;
  readonly p80Ms: number | null;
}

export type SumVerdict = "igual" | "mas-lento" | "mas-rapido" | "sin-medir";

/**
 * Una ausencia que solo sostiene un AGV: el tag del anillo de un lado no aparece en el otro, pero todas
 * las pasadas sin él son del mismo vehículo. Eso puede ser el lector de ese AGV (R-AGV-013), no un
 * cambio del circuito, y no se afirma: queda `unknown` hasta que pase otro.
 */
export interface UnconfirmedAbsence {
  readonly tagId: string;
  /** En qué lado falta: `retirado` si falta después, `insertado` si faltaba antes. */
  readonly kind: "retirado" | "insertado";
  /** Pasadas sin el tag, todas del mismo AGV. */
  readonly passes: number;
  readonly agvId: string;
}

export interface AnchorGapChange {
  readonly fromAnchor: string;
  readonly toAnchor: string;
  readonly before: GapSide;
  readonly after: GapSide;
  /** El régimen en que se comparó la suma; `null` si ninguno tiene bastantes pasadas a los dos lados. */
  readonly regime: Regime | null;
  readonly sum: SumVerdict;
  readonly changes: readonly StructureChange[];
  /** Ausencias que un solo AGV sostiene, sin afirmar. */
  readonly unconfirmed: readonly UnconfirmedAbsence[];
}

interface Step {
  readonly tagId: string;
  readonly utcMs: number;
  readonly span: number;
}

interface Pass {
  readonly agvId: string;
  readonly regime: Regime;
  readonly totalMs: number;
  /** Desfase desde P de cada tag leído entre medias (el primero, si se repite). */
  readonly inner: ReadonlyMap<string, number>;
}

/** Las secuencias de cada AGV, preparadas una vez para varias comparaciones. */
export type AnchorSequences = ReadonlyMap<string, readonly Step[]>;

/** La secuencia de cada AGV, sin repeticiones inmediatas, con el tramo de cobertura de cada lectura. */
export function anchorSequences(
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
): ReadonlyMap<string, readonly Step[]> {
  const spans = mergeIntervals([...coverage]);
  const spanOf = (utcMs: number): number => {
    if (spans.length === 0) return 0;
    let low = 0;
    let high = spans.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const interval = spans[middle] as Interval;
      if (utcMs < interval.from) high = middle - 1;
      else if (utcMs > interval.to) low = middle + 1;
      else return middle;
    }
    return -1;
  };
  const byVehicle = new Map<string, Reading[]>();
  for (const reading of readings) {
    const own = byVehicle.get(reading.agvId);
    if (own === undefined) byVehicle.set(reading.agvId, [reading]);
    else own.push(reading);
  }
  const sequences = new Map<string, Step[]>();
  for (const [agvId, own] of byVehicle) {
    own.sort((a, b) => compareReadings(a, b, direction));
    const steps: Step[] = [];
    for (const reading of own) {
      if (steps.length > 0 && (steps[steps.length - 1] as Step).tagId === reading.tagId) continue;
      steps.push({ tagId: reading.tagId, utcMs: reading.time.utcMs, span: spanOf(reading.time.utcMs) });
    }
    sequences.set(agvId, steps);
  }
  return sequences;
}

function within(steps: readonly Step[], window: Interval): readonly Step[] {
  return steps.filter((step) => step.utcMs >= window.from && step.utcMs <= window.to);
}

/** El anillo dominante de una ventana, con los pasos seguidos de un mismo tramo de cobertura. */
function ringOf(sequences: ReadonlyMap<string, readonly Step[]>, window: Interval): readonly string[] {
  const transitions: { from: string; to: string }[] = [];
  for (const steps of sequences.values()) {
    const inside = within(steps, window);
    for (let index = 1; index < inside.length; index += 1) {
      const previous = inside[index - 1] as Step;
      const current = inside[index] as Step;
      if (previous.span === current.span && previous.span !== -1) transitions.push({ from: previous.tagId, to: current.tagId });
    }
  }
  return findDominantCycle(transitions)?.cycle ?? [];
}

/**
 * La subsecuencia común más larga de dos anillos, en orden cíclico: las anclas estables. La LCS es
 * lineal, así que se prueba la rotación en cada tag común y se conserva la más larga: rotar solo al
 * primer tag común fallaba cuando ese tag era justo el que había cambiado de sitio, y sus vecinos
 * sanos dejaban de ser anclas. En empate, la que empieza por el primer tag común del anillo de antes.
 */
export function stableAnchors(before: readonly string[], after: readonly string[]): readonly string[] {
  const inAfter = new Set(after);
  const rotate = (ring: readonly string[], start: string): string[] => {
    const at = ring.indexOf(start);
    return [...ring.slice(at), ...ring.slice(0, at)];
  };
  let best: string[] = [];
  for (const start of before) {
    if (!inAfter.has(start)) continue;
    const common = linearCommonSubsequence(rotate(before, start), rotate(after, start));
    if (common.length > best.length) best = common;
  }
  return best;
}

function linearCommonSubsequence(a: readonly string[], b: readonly string[]): string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const common: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      common.push(a[i] as string);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return common;
}

/** Las pasadas entre cada ancla y la siguiente, en una ventana, por clave `P\u0000Q`. */
function passesBetween(
  sequences: ReadonlyMap<string, readonly Step[]>,
  window: Interval,
  anchors: readonly string[],
  context: AnchorSumContext,
): ReadonlyMap<string, Pass[]> {
  const nextOf = new Map(anchors.map((tagId, index) => [tagId, anchors[(index + 1) % anchors.length] as string]));
  const stops = mergeIntervals([...context.productionStops]);
  const deliveriesOf = new Map<string, Interval[]>();
  for (const delivery of context.deliveries) {
    deliveriesOf.set(delivery.agvId, [...(deliveriesOf.get(delivery.agvId) ?? []), { from: delivery.fromUtcMs, to: delivery.toUtcMs }]);
  }
  const overlaps = (intervals: readonly Interval[], from: number, to: number): boolean =>
    intervals.some((interval) => from < interval.to && to > interval.from);

  const passes = new Map<string, Pass[]>();
  for (const [agvId, steps] of sequences) {
    const own = deliveriesOf.get(agvId) ?? [];
    let open: { from: Step; inner: Map<string, number> } | null = null;
    for (const step of within(steps, window)) {
      if (context.laneTags.has(step.tagId) || step.span === -1) {
        open = null;
        continue;
      }
      if (open !== null && step.span !== open.from.span) open = null;
      const next = nextOf.get(step.tagId);
      if (next === undefined) {
        if (open !== null && !open.inner.has(step.tagId)) open.inner.set(step.tagId, step.utcMs - open.from.utcMs);
        continue;
      }
      if (open !== null && nextOf.get(open.from.tagId) === step.tagId) {
        const from = open.from.utcMs;
        const to = step.utcMs;
        if (!overlaps(stops, from, to) && !overlaps(own, from, to)) {
          const key = `${open.from.tagId}\u0000${step.tagId}`;
          const list = passes.get(key);
          const pass: Pass = { agvId, regime: context.regimeOf((from + to) / 2), totalMs: to - from, inner: open.inner };
          if (list === undefined) passes.set(key, [pass]);
          else list.push(pass);
        }
      }
      open = { from: step, inner: new Map() };
    }
  }
  return passes;
}

interface InnerTag {
  readonly tagId: string;
  readonly share: number;
  readonly count: number;
  readonly offsetMs: number;
}

function summarize(passes: readonly Pass[]): { side: GapSide; tags: ReadonlyMap<string, InnerTag> } {
  const totals = passes.map((pass) => pass.totalMs).sort((a, b) => a - b);
  const offsets = new Map<string, number[]>();
  for (const pass of passes) {
    for (const [tagId, offset] of pass.inner) {
      const list = offsets.get(tagId);
      if (list === undefined) offsets.set(tagId, [offset]);
      else list.push(offset);
    }
  }
  const tags = new Map<string, InnerTag>();
  for (const [tagId, list] of offsets) {
    const sorted = [...list].sort((a, b) => a - b);
    tags.set(tagId, { tagId, count: list.length, share: list.length / passes.length, offsetMs: quantile(sorted, 0.5) });
  }
  return {
    side: {
      passes: passes.length,
      vehicles: new Set(passes.map((pass) => pass.agvId)).size,
      p50Ms: totals.length === 0 ? null : quantile(totals, 0.5),
      p80Ms: totals.length === 0 ? null : quantile(totals, 0.8),
    },
    tags,
  };
}

/**
 * Empareja en orden, minimizando la suma de las diferencias de desfase relativo. Todos los de la
 * lista más corta se emparejan; devuelve los pares como índices (viejo, nuevo).
 */
function pairInOrder(old: readonly number[], fresh: readonly number[]): readonly (readonly [number, number])[] {
  const swap = old.length > fresh.length;
  const small = swap ? fresh : old;
  const large = swap ? old : fresh;
  const n = small.length;
  const m = large.length;
  if (n === 0) return [];
  // cost[i][j]: lo mejor emparejando los i primeros del corto dentro de los j primeros del largo.
  const cost: number[][] = Array.from({ length: n + 1 }, (_, i) => new Array<number>(m + 1).fill(i === 0 ? 0 : Infinity));
  const took: boolean[][] = Array.from({ length: n + 1 }, () => new Array<boolean>(m + 1).fill(false));
  for (let i = 1; i <= n; i += 1) {
    for (let j = i; j <= m; j += 1) {
      const skip = cost[i]![j - 1]!;
      const take = cost[i - 1]![j - 1]! + Math.abs((small[i - 1] as number) - (large[j - 1] as number));
      cost[i]![j] = Math.min(skip, take);
      took[i]![j] = take <= skip;
    }
  }
  const pairs: (readonly [number, number])[] = [];
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (took[i]![j]) {
      pairs.push(swap ? [j - 1, i - 1] : [i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else j -= 1;
  }
  return pairs.reverse();
}

/**
 * Qué cambió de estructura entre dos ventanas, tramo entre anclas por tramo entre anclas. Solo se
 * devuelven los tramos donde algún tag aparece o desaparece con la ausencia afirmada por al menos dos
 * AGV; una ausencia que sostiene un solo vehículo va en `unconfirmed` del tramo, si el tramo sale.
 */
export function compareAnchorGaps(
  readings: readonly Reading[] | AnchorSequences,
  before: Interval,
  after: Interval,
  context: AnchorSumContext,
  thresholds: AnchorSumThresholds,
): readonly AnchorGapChange[] {
  const sequences = readings instanceof Map ? readings : anchorSequences(readings as readonly Reading[], context.direction, context.coverage);
  const ringBefore = ringOf(sequences, before);
  const ringAfter = ringOf(sequences, after);
  if (ringBefore.length === 0 || ringAfter.length === 0) return [];
  const anchors = stableAnchors(ringBefore, ringAfter);
  if (anchors.length < 2) return [];
  const inRingBefore = new Set(ringBefore);
  const inRingAfter = new Set(ringAfter);
  const passesBefore = passesBetween(sequences, before, anchors, context);
  const passesAfter = passesBetween(sequences, after, anchors, context);

  const gaps: AnchorGapChange[] = [];
  anchors.forEach((fromAnchor, index) => {
    const toAnchor = anchors[(index + 1) % anchors.length] as string;
    const key = `${fromAnchor}\u0000${toAnchor}`;
    const allBefore = passesBefore.get(key) ?? [];
    const allAfter = passesAfter.get(key) ?? [];
    const early = summarize(allBefore);
    const late = summarize(allAfter);
    // Una ausencia es improbable por azar dada la tasa del tag donde sí se lee; y la afirman al menos
    // dos AGV distintos: si todas las pasadas sin el tag son del mismo vehículo, puede ser su lector
    // (R-AGV-013) y no el circuito, y queda sin afirmar.
    const unlikely = (tag: InnerTag, otherPasses: number): boolean =>
      otherPasses > 0 && (1 - Math.min(1, tag.share)) ** otherPasses <= context.maxChance;
    const soleVehicle = (passes: readonly Pass[]): string | null => {
      const ids = new Set(passes.map((pass) => pass.agvId));
      return ids.size === 1 ? [...ids][0]! : null;
    };
    const unconfirmed: UnconfirmedAbsence[] = [];
    const confirmed = (tag: InnerTag, kind: UnconfirmedAbsence["kind"], otherPasses: readonly Pass[]): boolean => {
      if (!unlikely(tag, otherPasses.length)) return false;
      const agvId = soleVehicle(otherPasses);
      if (agvId === null) return true;
      unconfirmed.push({ tagId: tag.tagId, kind, passes: otherPasses.length, agvId });
      return false;
    };
    const retiredTags = [...early.tags.values()].filter(
      (tag) => inRingBefore.has(tag.tagId) && !late.tags.has(tag.tagId) && confirmed(tag, "retirado", allAfter),
    );
    const addedTags = [...late.tags.values()].filter(
      (tag) => inRingAfter.has(tag.tagId) && !early.tags.has(tag.tagId) && confirmed(tag, "insertado", allBefore),
    );
    if (retiredTags.length === 0 && addedTags.length === 0) return;

    // La suma y los desfases, dentro de un mismo régimen: producción si hay bastante a los dos lados, si
    // no la noche; si ninguno, con todas las pasadas, y la suma sin medir.
    const count = (passes: readonly Pass[], regime: Regime): number => passes.filter((pass) => pass.regime === regime).length;
    const regime =
      (["produccion", "noche"] as const).find(
        (candidate) => count(allBefore, candidate) >= thresholds.minAnchorPasses && count(allAfter, candidate) >= thresholds.minAnchorPasses,
      ) ?? null;
    const timedEarly = regime === null ? early : summarize(allBefore.filter((pass) => pass.regime === regime));
    const timedLate = regime === null ? late : summarize(allAfter.filter((pass) => pass.regime === regime));
    const timed = (tag: InnerTag, side: ReturnType<typeof summarize>): InnerTag => side.tags.get(tag.tagId) ?? tag;
    const retired = retiredTags.map((tag) => timed(tag, timedEarly)).sort((a, b) => a.offsetMs - b.offsetMs);
    const added = addedTags.map((tag) => timed(tag, timedLate)).sort((a, b) => a.offsetMs - b.offsetMs);

    const relative = (tag: InnerTag, side: GapSide): number => tag.offsetMs / Math.max(1, side.p50Ms ?? 1);
    const pairs = pairInOrder(
      retired.map((tag) => relative(tag, timedEarly.side)),
      added.map((tag) => relative(tag, timedLate.side)),
    );
    const spread =
      timedLate.side.p50Ms === null || timedLate.side.p80Ms === null
        ? context.resolutionMs
        : Math.max(context.resolutionMs, timedLate.side.p80Ms - timedLate.side.p50Ms);
    const pairedOld = new Set(pairs.map(([o]) => o));
    const pairedNew = new Set(pairs.map(([, n]) => n));
    const changes: StructureChange[] = [
      ...pairs.map(([o, n]): StructureChange => {
        const oldTag = retired[o] as InnerTag;
        const newTag = added[n] as InnerTag;
        return {
          kind: "sustituido",
          oldTagId: oldTag.tagId,
          newTagId: newTag.tagId,
          oldOffsetMs: oldTag.offsetMs,
          newOffsetMs: newTag.offsetMs,
          placement: Math.abs(newTag.offsetMs - oldTag.offsetMs) <= spread ? "mismo-sitio" : "otro-punto",
        };
      }),
      ...added
        .filter((_, n) => !pairedNew.has(n))
        .map((tag): StructureChange => ({ kind: "insertado", tagId: tag.tagId, offsetMs: tag.offsetMs })),
      ...retired
        .filter((_, o) => !pairedOld.has(o))
        .map((tag): StructureChange => ({ kind: "retirado", tagId: tag.tagId, offsetMs: tag.offsetMs })),
    ];
    const a = timedEarly.side;
    const b = timedLate.side;
    const shift =
      regime === null || a.p50Ms === null || a.p80Ms === null || b.p50Ms === null || b.p80Ms === null
        ? null
        : bandShift({ p50Ms: a.p50Ms, p80Ms: a.p80Ms }, { p50Ms: b.p50Ms, p80Ms: b.p80Ms });
    gaps.push({
      fromAnchor,
      toAnchor,
      before: { passes: early.side.passes, vehicles: early.side.vehicles, p50Ms: a.p50Ms, p80Ms: a.p80Ms },
      after: { passes: late.side.passes, vehicles: late.side.vehicles, p50Ms: b.p50Ms, p80Ms: b.p80Ms },
      regime,
      sum: regime === null ? "sin-medir" : (shift ?? "igual"),
      changes,
      unconfirmed,
    });
  });
  return gaps;
}

/** Tags que cambian en un tramo: para no enseñar dos veces el mismo cambio. */
export function changedTags(gap: AnchorGapChange): readonly string[] {
  return gap.changes
    .flatMap((change) => (change.kind === "sustituido" ? [change.oldTagId, change.newTagId] : [change.tagId]))
    .sort();
}

/** Un conjunto de cambios de estructura, con de dónde sale la comparación. */
export interface StructureSet {
  /** Entre dos ficheros seguidos, o alrededor de un cambio de tag dentro de un tramo de cobertura. */
  readonly source: "entre-ficheros" | "dentro-del-fichero";
  readonly beforeSourceId: string | null;
  readonly afterSourceId: string | null;
  /** Dónde empieza lo de después. */
  readonly atUtcMs: number;
  readonly gaps: readonly AnchorGapChange[];
}

/** Agrupa instantes que distan como mucho `maxGapMs` del anterior: un mantenimiento, un grupo. */
export function changeClusters(times: readonly number[], maxGapMs: number): readonly Interval[] {
  const sorted = [...times].sort((a, b) => a - b);
  const clusters: Interval[] = [];
  for (const time of sorted) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && time - last.to <= maxGapMs) clusters[clusters.length - 1] = { from: last.from, to: time };
    else clusters.push({ from: time, to: time });
  }
  return clusters;
}

/**
 * Las ventanas de antes y de después de cada grupo de cambios dentro de un tramo de cobertura: desde
 * el grupo anterior del mismo tramo, o su inicio, hasta el siguiente, o su final. Comparar contra todo
 * el resto del tramo metería otro cambio en uno de los dos lados, a medias, y su suma se mediría
 * mezclada.
 *
 * Los cortes quedan **fuera** de las dos ventanas: los instantes del grupo son la primera lectura del
 * tag que empieza y la última del que acaba, y una ventana cerrada en ellos los metería en el lado
 * equivocado. Con la primera lectura del tag nuevo dentro de «antes», bastaba que el ancla siguiente
 * se leyera en el mismo instante (resolución de minuto) para que la pasada cerrara ahí y el tag nuevo
 * dejara de ser insertado.
 */
export function windowsAroundChanges(
  times: readonly number[],
  spans: readonly Interval[],
  maxGapMs: number,
): readonly { readonly atUtcMs: number; readonly before: Interval; readonly after: Interval }[] {
  const windows: { atUtcMs: number; before: Interval; after: Interval }[] = [];
  for (const span of mergeIntervals([...spans])) {
    const clusters = changeClusters(
      times.filter((time) => time >= span.from && time <= span.to),
      maxGapMs,
    );
    clusters.forEach((cluster, index) => {
      windows.push({
        atUtcMs: cluster.to,
        before: { from: clusters[index - 1]?.to ?? span.from, to: cluster.from - 1 },
        after: { from: cluster.to + 1, to: clusters[index + 1]?.from ?? span.to },
      });
    });
  }
  return windows;
}

/**
 * Dónde mirar dentro de un tramo de cobertura: la primera lectura de cada tag que empieza a leerse
 * más de `marginMs` después del inicio del tramo, y la última de cada uno que deja de leerse más de
 * `marginMs` antes del final. No depende de los cambios de tag por su sitio (R-DAT-019), que no ven un
 * bloque de tags seguidos cambiado a la vez: ahí el sitio de cada uno es otro que también cambió.
 *
 * `ignore` son los tags que empiezan y dejan de leerse por su horario, como un tag de noche
 * (R-DAT-022): no son un cambio de estructura y no parten el tramo.
 */
export function structureBoundaries(
  sequences: AnchorSequences,
  spans: readonly Interval[],
  marginMs: number,
  ignore: ReadonlySet<string>,
): readonly number[] {
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  for (const steps of sequences.values()) {
    for (const step of steps) {
      if (step.span < 0 || ignore.has(step.tagId)) continue;
      const key = `${step.span}\u0000${step.tagId}`;
      if (!first.has(key) || step.utcMs < (first.get(key) as number)) first.set(key, step.utcMs);
      if (!last.has(key) || step.utcMs > (last.get(key) as number)) last.set(key, step.utcMs);
    }
  }
  const times: number[] = [];
  for (const [key, at] of first) {
    const span = spans[Number(key.slice(0, key.indexOf("\u0000")))];
    if (span === undefined) continue;
    if (at - span.from > marginMs) times.push(at);
    const end = last.get(key) as number;
    if (span.to - end > marginMs) times.push(end);
  }
  return times;
}
