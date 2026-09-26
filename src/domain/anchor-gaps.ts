/**
 * Las sumas entre anclas de **un solo fichero**, para la instantánea (ADR-0015, R-DAT-021).
 *
 * `anchor-sums.ts` compara dos ventanas a partir de las lecturas; sus pasadas entre anclas son
 * privadas y se recalculan en cada comparación. Cuando las lecturas de un fichero anterior ya no
 * están (R-DAT-023), lo que queda para comparar es lo que aquí se guarda: por cada hueco entre dos
 * anclas seguidas, cuántas pasadas hubo, la suma por régimen y, por tag, en cuántas pasadas se leyó y
 * por cuántos AGV distintos. `structureBetweenSnapshots` lee esto de dos instantáneas.
 *
 * Mismo criterio de pasada que `anchor-sums.ts`: de la lectura de un ancla a la primera lectura de la
 * ancla siguiente por el mismo AGV, sin otra ancla ni calle de carga en medio, dentro del mismo tramo
 * de cobertura, sin cruzar una parada de la producción ni una entrega agrupada (R-DAT-020). Los tags
 * leídos entre medias se apuntan una vez por pasada.
 *
 * Qué anclas: las declaradas en la lista `ancla` que están en el anillo, en el orden del anillo, y si
 * no hay dos, el ancla del circuito sola —el hueco es entonces la vuelta entera, y `readsByTag` es la
 * lectura de cada tag por vuelta—.
 */

import { anchorSequences } from "./anchor-sums.js";
import { mergeIntervals, type Interval } from "./coverage.js";
import { quantile } from "./graph.js";
import type { SourceDirection } from "./order.js";
import type { Reading } from "./reading.js";
import type { Regime } from "./segment-bands.js";
import type { SnapshotAnchorGap } from "./snapshot.js";

export interface AnchorGapInput {
  /** Las lecturas del cohorte principal dentro de la ventana del fichero. */
  readonly readings: readonly Reading[];
  readonly direction: SourceDirection;
  /** El anillo del fichero, desde el ancla. */
  readonly ring: readonly string[];
  /** Las anclas, en el orden del anillo; al menos una. */
  readonly anchors: readonly string[];
  /** La ventana del fichero (R-DAT-007). */
  readonly coverage: readonly Interval[];
  readonly productionStops: readonly Interval[];
  readonly laneTags: ReadonlySet<string>;
  readonly regimeOf: (utcMs: number) => Regime;
  /** Lecturas que llegaron juntas (R-DAT-020): una pasada que las cruza no mide tiempo. */
  readonly deliveries: readonly { readonly agvId: string; readonly fromUtcMs: number; readonly toUtcMs: number }[];
}

interface Pass {
  readonly agvId: string;
  readonly regime: Regime;
  readonly totalMs: number;
  /** Desfase desde el ancla de salida de cada tag leído entre medias (el primero, si se repite). */
  readonly inner: ReadonlyMap<string, number>;
}

/** Los tags del anillo entre `from` y `to`, sin incluirlos; con una sola ancla, todo el anillo menos ella. */
export function ringBetween(ring: readonly string[], from: string, to: string): readonly string[] {
  const start = ring.indexOf(from);
  const end = ring.indexOf(to);
  if (start === -1 || end === -1) return [];
  const size = ring.length;
  const length = (end - start + size) % size || size;
  return Array.from({ length: length - 1 }, (_, step) => ring[(start + 1 + step) % size] as string);
}

function overlaps(intervals: readonly Interval[], from: number, to: number): boolean {
  return intervals.some((interval) => from < interval.to && to > interval.from);
}

/** La suma del hueco en un régimen: p50 y p80, que es lo que la regla de la horquilla necesita (R-TIM-010). */
function summary(passes: readonly Pass[], regime: Regime): { readonly samples: number; readonly p50Ms: number; readonly p80Ms: number } | null {
  const totals = passes.filter((pass) => pass.regime === regime).map((pass) => pass.totalMs).sort((a, b) => a - b);
  if (totals.length === 0) return null;
  return { samples: totals.length, p50Ms: quantile(totals, 0.5), p80Ms: quantile(totals, 0.8) };
}

export function measureAnchorGaps(input: AnchorGapInput): readonly SnapshotAnchorGap[] {
  const anchors = input.anchors.filter((tagId) => input.ring.includes(tagId));
  if (anchors.length === 0 || input.ring.length === 0) return [];
  const nextOf = new Map(anchors.map((tagId, index) => [tagId, anchors[(index + 1) % anchors.length] as string]));
  const stops = mergeIntervals([...input.productionStops]);
  const deliveriesOf = new Map<string, Interval[]>();
  for (const delivery of input.deliveries) {
    deliveriesOf.set(delivery.agvId, [...(deliveriesOf.get(delivery.agvId) ?? []), { from: delivery.fromUtcMs, to: delivery.toUtcMs }]);
  }

  const passes = new Map<string, Pass[]>();
  for (const [agvId, steps] of anchorSequences(input.readings, input.direction, input.coverage)) {
    const own = deliveriesOf.get(agvId) ?? [];
    let open: { readonly tagId: string; readonly utcMs: number; readonly span: number; readonly inner: Map<string, number> } | null = null;
    for (const step of steps) {
      if (input.laneTags.has(step.tagId) || step.span === -1) {
        open = null;
        continue;
      }
      if (open !== null && step.span !== open.span) open = null;
      const next = nextOf.get(step.tagId);
      if (next === undefined) {
        if (open !== null && !open.inner.has(step.tagId)) open.inner.set(step.tagId, step.utcMs - open.utcMs);
        continue;
      }
      if (open !== null && nextOf.get(open.tagId) === step.tagId) {
        const from = open.utcMs;
        const to = step.utcMs;
        if (!overlaps(stops, from, to) && !overlaps(own, from, to)) {
          const key = `${open.tagId}\u0000${step.tagId}`;
          const pass: Pass = { agvId, regime: input.regimeOf((from + to) / 2), totalMs: to - from, inner: open.inner };
          const list = passes.get(key);
          if (list === undefined) passes.set(key, [pass]);
          else list.push(pass);
        }
      }
      open = { tagId: step.tagId, utcMs: step.utcMs, span: step.span, inner: new Map() };
    }
  }

  return anchors.map((fromAnchor, index): SnapshotAnchorGap => {
    const toAnchor = anchors[(index + 1) % anchors.length] as string;
    const own = passes.get(`${fromAnchor}\u0000${toAnchor}`) ?? [];
    const tags = ringBetween(input.ring, fromAnchor, toAnchor);
    // Por tag: en cuántas pasadas se leyó, por cuántos AGV distintos y la mediana de su desfase desde
    // el ancla de salida. Los tags del anillo del hueco figuran aunque nadie los leyera: un cero es un
    // hecho, y la ausencia de la clave no lo sería.
    const passesByTag = new Map<string, number>();
    const vehiclesByTag = new Map<string, Set<string>>();
    const offsetsByTag = new Map<string, number[]>();
    for (const pass of own) {
      for (const [tagId, offsetMs] of pass.inner) {
        passesByTag.set(tagId, (passesByTag.get(tagId) ?? 0) + 1);
        const vehicles = vehiclesByTag.get(tagId) ?? new Set<string>();
        vehicles.add(pass.agvId);
        vehiclesByTag.set(tagId, vehicles);
        offsetsByTag.set(tagId, [...(offsetsByTag.get(tagId) ?? []), offsetMs]);
      }
    }
    const readsByTag: Record<string, { readonly passes: number; readonly vehicles: number; readonly offsetMs?: number }> = {};
    for (const tagId of new Set([...tags, ...passesByTag.keys()])) {
      const offsets = (offsetsByTag.get(tagId) ?? []).sort((a, b) => a - b);
      readsByTag[tagId] = {
        passes: passesByTag.get(tagId) ?? 0,
        vehicles: vehiclesByTag.get(tagId)?.size ?? 0,
        ...(offsets.length === 0 ? {} : { offsetMs: quantile(offsets, 0.5) }),
      };
    }
    return {
      fromAnchor,
      toAnchor,
      tags,
      produccion: summary(own, "produccion"),
      noche: summary(own, "noche"),
      passes: own.length,
      readsByTag,
      vehicleIds: [...new Set(own.map((pass) => pass.agvId))].sort(),
    };
  });
}
