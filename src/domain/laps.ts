/**
 * Vueltas por vehículo (ALG-004, R-GRA-002).
 *
 * Sin ancla de vuelta declarada (OQ-102, OQ-B04 sigue abierta para SE2/4), la única ancla
 * disponible es la que el propio grafo revela: el ciclo dominante del cohorte, siguiendo el sucesor
 * mayoritario desde cualquier tag hasta que uno se repite. Es el mismo método ya validado contra
 * tres exportaciones reales en `local/tags-criticos.py` (anillo de 149 tags en SE2/4, dominancia
 * mediana 1,000).
 *
 * Por eso una vuelta aquí **nunca es `observed`**: el ancla es inferida, no declarada, y se dice
 * así en cada resultado. Cuando exista `lap_anchors` en `CONFIG_SCHEMA.md`, esto se sustituye por
 * el ancla real y las vueltas pueden pasar a `observed`.
 */

import { mergeIntervals, uncoveredGaps, type Interval } from "./coverage.js";
import { sortReadings, type SourceDirection } from "./order.js";
import type { Reading } from "./reading.js";
import type { TruthState } from "./truth.js";

export type LapCompleteness = "completa" | "parcial" | "desconocida";

export interface Lap {
  readonly agvId: string;
  readonly completeness: LapCompleteness;
  readonly startUtcMs: number;
  readonly endUtcMs: number;
  readonly stops: number;
  readonly truth: TruthState;
}

export interface LapAnchor {
  readonly tagId: string;
  /** Tags que forman el ciclo dominante, en orden, empezando por el ancla. */
  readonly cycle: readonly string[];
  /** La cuota más débil de las aristas del ciclo: cuánto se sostiene el ancla como tal. */
  readonly weakestShare: number;
}

/**
 * Encuentra el ciclo dominante de un conjunto de transiciones y elige su ancla.
 *
 * El ancla es el **primer tag que se repite** siguiendo el sucesor mayoritario desde el tag de
 * mayor soporte total — no el punto de partida arbitrario, sino la entrada real al ciclo, que
 * puede no coincidir con él si el punto de partida está fuera del anillo principal.
 *
 * `null` si no hay transiciones suficientes para que un ciclo tenga sentido (menos de tres tags
 * distintos): con tan poca topología, cualquier "ancla" sería ruido con apariencia de método.
 */
export function findDominantCycle(
  transitions: readonly { readonly from: string; readonly to: string }[],
): LapAnchor | null {
  const outgoing = new Map<string, Map<string, number>>();
  const totalOut = new Map<string, number>();
  for (const { from, to } of transitions) {
    let counts = outgoing.get(from);
    if (counts === undefined) {
      counts = new Map<string, number>();
      outgoing.set(from, counts);
    }
    counts.set(to, (counts.get(to) ?? 0) + 1);
    totalOut.set(from, (totalOut.get(from) ?? 0) + 1);
  }
  if (outgoing.size < 3) return null;

  const dominant = (from: string): { to: string; share: number } | null => {
    const counts = outgoing.get(from);
    if (counts === undefined) return null;
    let bestTo = "";
    let bestCount = -1;
    for (const [to, count] of counts) {
      if (count > bestCount) {
        bestTo = to;
        bestCount = count;
      }
    }
    const total = totalOut.get(from) ?? 0;
    return total === 0 ? null : { to: bestTo, share: bestCount / total };
  };

  // Se arranca desde el tag de mayor tráfico total: es el que menos probable es que quede fuera
  // del anillo principal por casualidad de muestreo.
  let start = "";
  let startTotal = -1;
  for (const [tag, total] of totalOut) {
    if (total > startTotal) {
      start = tag;
      startTotal = total;
    }
  }

  const path: string[] = [start];
  const shares: number[] = [];
  const seen = new Set<string>([start]);
  let current = start;
  // Cota de pasos = número de nodos distintos: si no cierra en ese margen, no hay ciclo dominante
  // limpio y se declara así en vez de forzar una respuesta.
  for (let step = 0; step < outgoing.size + 1; step += 1) {
    const next = dominant(current);
    if (next === null) return null;
    shares.push(next.share);
    if (seen.has(next.to)) {
      const anchorIndex = path.indexOf(next.to);
      const cycle = path.slice(anchorIndex);
      const cycleShares = shares.slice(anchorIndex);
      return {
        tagId: next.to,
        cycle,
        weakestShare: Math.min(...cycleShares),
      };
    }
    path.push(next.to);
    seen.add(next.to);
    current = next.to;
  }
  return null;
}

/**
 * Segmenta la secuencia de cada vehículo en vueltas, cortando en cada paso por el ancla.
 *
 * Una vuelta es `completa` cuando empieza y termina en el ancla sin cruzar un hueco de cobertura;
 * `parcial` cuando el corte de los datos —no del circuito— la deja abierta por un lado (el primer
 * tramo antes del primer paso por el ancla, o el último después del último); `desconocida` cuando
 * el vehículo nunca pasa por el ancla y no hay forma de segmentar nada de lo suyo.
 */
export function segmentLaps(
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
  anchor: string,
): readonly Lap[] {
  const ordered = sortReadings([...readings], direction);
  const gaps = uncoveredGaps(mergeIntervals(coverage));
  const byVehicle = new Map<string, Reading[]>();
  for (const entry of ordered) {
    let list = byVehicle.get(entry.agvId);
    if (list === undefined) {
      list = [];
      byVehicle.set(entry.agvId, list);
    }
    list.push(entry);
  }

  const laps: Lap[] = [];
  for (const [agvId, entries] of byVehicle) {
    const anchorIndices: number[] = [];
    entries.forEach((entry, index) => {
      if (entry.tagId === anchor) anchorIndices.push(index);
    });

    if (anchorIndices.length === 0) {
      const first = entries[0] as Reading;
      const last = entries[entries.length - 1] as Reading;
      laps.push({
        agvId,
        completeness: "desconocida",
        startUtcMs: first.time.utcMs,
        endUtcMs: last.time.utcMs,
        stops: entries.length,
        truth: "unknown",
      });
      continue;
    }

    // Tramo antes del primer paso por el ancla: parcial, porque no se sabe dónde empezó la vuelta.
    const firstAnchor = anchorIndices[0] as number;
    if (firstAnchor > 0) {
      laps.push(
        buildLap(agvId, entries.slice(0, firstAnchor + 1), "parcial", gaps),
      );
    }

    for (let index = 0; index < anchorIndices.length - 1; index += 1) {
      const from = anchorIndices[index] as number;
      const to = anchorIndices[index + 1] as number;
      laps.push(buildLap(agvId, entries.slice(from, to + 1), "completa", gaps));
    }

    // Tramo después del último paso por el ancla: parcial, la cobertura corta ahí, no el circuito.
    const lastAnchor = anchorIndices[anchorIndices.length - 1] as number;
    if (lastAnchor < entries.length - 1) {
      laps.push(buildLap(agvId, entries.slice(lastAnchor), "parcial", gaps));
    }
  }

  return laps;
}

function buildLap(
  agvId: string,
  segment: readonly Reading[],
  completeness: LapCompleteness,
  gaps: readonly Interval[],
): Lap {
  const start = (segment[0] as Reading).time.utcMs;
  const end = (segment[segment.length - 1] as Reading).time.utcMs;
  // Una vuelta que cruza un hueco de cobertura no es una vuelta: lo que hay en medio es ausencia
  // de datos, no circulación (R-DAT-007). Degrada a `parcial` en vez de fingir continuidad.
  const crossesGap = gaps.some((gap) => start <= gap.from && end >= gap.to);
  return {
    agvId,
    completeness: crossesGap ? "parcial" : completeness,
    startUtcMs: start,
    endUtcMs: end,
    stops: segment.length,
    // El ancla es inferida (ciclo dominante, no declarada): nunca observed, aunque la vuelta sea
    // completa en sus datos.
    truth: "inferred",
  };
}
