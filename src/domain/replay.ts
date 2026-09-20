/**
 * Replay básico determinista (ROADMAP F2, PERFORMANCE_BUDGET §6).
 *
 * Se precalculan un número fijo de fotogramas **en el dominio**, no en la presentación: recorrer
 * las lecturas fotograma a fotograma es trabajo, y el hilo principal no hace trabajo (WP-001). Lo
 * que viaja a la interfaz es un array pequeño de fotogramas, no las lecturas otra vez.
 *
 * La posición dentro de un tramo es **fracción temporal, nunca posición física**
 * (`PERFORMANCE_BUDGET.md` §6): el grafo es topológico, no un plano, y no hay geometría que
 * interpolar. Un vehículo entre dos lecturas se sitúa como "a mitad de camino en el tiempo entre
 * A y B", que es lo único que el dato sostiene.
 *
 * Nunca se interpola **entre tags que no son una transición observada**: si la última lectura de un
 * vehículo es muy anterior al fotograma y no hay una siguiente que la siga de cerca, su estado es
 * `unknown` — silencio, no movimiento inventado (R-AGV-006, R-EVI-002).
 */

import type { Reading } from "./reading.js";
import type { TruthState } from "./truth.js";

export type VehicleReplayState =
  | { readonly kind: "en-tag"; readonly tagId: string; readonly truth: TruthState }
  | {
      readonly kind: "en-transito";
      readonly fromTagId: string;
      readonly toTagId: string;
      /** 0–1, fracción **temporal** del tramo recorrida. Nunca distancia física. */
      readonly fraction: number;
      readonly truth: TruthState;
    }
  | { readonly kind: "silencio"; readonly lastTagId: string; readonly sinceUtcMs: number }
  /**
   * Antes de la primera lectura del vehículo en la ventana. No es un silencio: un silencio exige
   * una posición conocida que deja de confirmarse, y aquí no la hay todavía. Es el estado «sin
   * datos cargados» de R-DAT-007 acotado a un objeto, y se distingue porque confundirlos convierte
   * el arranque de la ventana en una avería colectiva que nadie ha observado.
   */
  | { readonly kind: "sin-datos"; readonly firstReadingUtcMs: number };

export interface ReplayFrame {
  readonly atUtcMs: number;
  readonly vehicles: ReadonlyMap<string, VehicleReplayState>;
}

/**
 * Construye `frameCount` fotogramas repartidos uniformemente sobre el rango cubierto.
 *
 * `silenceThresholdMs` decide cuándo una última lectura sin continuación cuenta como silencio en
 * vez de "todavía en ese tag": sin valor por defecto, es la misma magnitud de planta que decide
 * inactividad en el expediente (R-OPP-006) y debe venir del mismo sitio.
 */
export function buildReplayFrames(
  readings: readonly Reading[],
  frameCount: number,
  silenceThresholdMs: number,
): readonly ReplayFrame[] {
  if (readings.length === 0 || frameCount <= 0) return [];

  let from = Infinity;
  let to = -Infinity;
  const byVehicle = new Map<string, Reading[]>();
  for (const entry of readings) {
    if (entry.time.utcMs < from) from = entry.time.utcMs;
    if (entry.time.utcMs > to) to = entry.time.utcMs;
    let list = byVehicle.get(entry.agvId);
    if (list === undefined) {
      list = [];
      byVehicle.set(entry.agvId, list);
    }
    list.push(entry);
  }
  for (const list of byVehicle.values()) list.sort((a, b) => a.time.utcMs - b.time.utcMs);

  const span = Math.max(1, to - from);
  const frames: ReplayFrame[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const atUtcMs = from + (span * index) / Math.max(1, frameCount - 1);
    const vehicles = new Map<string, VehicleReplayState>();
    for (const [agvId, entries] of byVehicle) {
      vehicles.set(agvId, stateAt(entries, atUtcMs, silenceThresholdMs));
    }
    frames.push({ atUtcMs, vehicles });
  }
  return frames;
}

function stateAt(
  entries: readonly Reading[],
  atUtcMs: number,
  silenceThresholdMs: number,
): VehicleReplayState {
  // Última lectura en o antes de `atUtcMs`, y la primera después: búsqueda lineal, aceptable
  // porque el número de fotogramas y de vehículos es pequeño (cientos, no cientos de miles).
  let before: Reading | null = null;
  let after: Reading | null = null;
  for (const entry of entries) {
    if (entry.time.utcMs <= atUtcMs) {
      before = entry;
    } else {
      after = entry;
      break;
    }
  }

  if (before === null) {
    // El vehículo no había leído nada todavía en este instante. No se inventa una posición de
    // partida, pero tampoco se declara un silencio que nadie ha observado: lo que se sabe es
    // cuándo llega su primera lectura, y eso es un hecho, no una hipótesis.
    return { kind: "sin-datos", firstReadingUtcMs: entries[0]?.time.utcMs ?? atUtcMs };
  }

  // El fotograma cae exactamente en una lectura: es observado, siempre — haya o no una lectura
  // posterior. Sin este caso aparte, un fotograma que coincidiera con el instante exacto de una
  // lectura saldría "en tránsito, fracción 0" en vez de "en el tag", que es peor información con
  // la misma evidencia.
  if (before.time.utcMs === atUtcMs) {
    return { kind: "en-tag", tagId: before.tagId, truth: "observed" };
  }

  if (after === null) {
    const sinceLastReading = atUtcMs - before.time.utcMs;
    return sinceLastReading >= silenceThresholdMs
      ? { kind: "silencio", lastTagId: before.tagId, sinceUtcMs: before.time.utcMs }
      : { kind: "en-tag", tagId: before.tagId, truth: "observed" };
  }

  // Entre dos lecturas: si el hueco entre ellas ya es un silencio por sí mismo, el vehículo está
  // "detenido en el último tag conocido" con incertidumbre, no en tránsito — no hay transición
  // observada que sostenga el movimiento.
  const gap = after.time.utcMs - before.time.utcMs;
  if (gap >= silenceThresholdMs) {
    return { kind: "silencio", lastTagId: before.tagId, sinceUtcMs: before.time.utcMs };
  }
  if (before.tagId === after.tagId) {
    return { kind: "en-tag", tagId: before.tagId, truth: "observed" };
  }
  const fraction = gap === 0 ? 0 : (atUtcMs - before.time.utcMs) / gap;
  return {
    kind: "en-transito",
    fromTagId: before.tagId,
    toTagId: after.tagId,
    fraction: Math.min(1, Math.max(0, fraction)),
    truth: "inferred",
  };
}
