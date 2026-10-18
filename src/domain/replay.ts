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

import type { Chronology } from "./case-backtrack.js";
import { pairCuts } from "./connection-cuts.js";
import { caseSpan, type CaseWindow, type FrozenEvidence } from "./incident-case.js";
import type { Reading } from "./reading.js";
import { regimeReader, type Band } from "./segment-bands.js";
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
 *
 * Precondición (B-10, revisión del 2026-10-18): `readings` llega en orden canónico —`sortReadings`
 * con el sentido de su fuente (ADR-0013)—. Las ordenaciones por instante de aquí dentro son estables y
 * conservan ese desempate entre dos lecturas del mismo AGV en el mismo instante; no se puede rehacer
 * aquí porque el sentido de la pila no llega a esta función, y desempatar por fila ascendente
 * invertiría el orden de las fuentes `newest-first`.
 */
export function buildReplayFrames(
  readings: readonly Reading[],
  frameCount: number,
  silenceThresholdMs: number,
  /** Opcional: el intervalo que recorren los fotogramas; sin él, el que cubren las lecturas. */
  range?: { readonly from: number; readonly to: number },
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
  if (range !== undefined) {
    from = range.from;
    to = range.to;
  }

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

// --- Replay del expediente (ALG-016, ADR-0018 D8) ----------------------------------------------------

/** Versión del procedimiento; viaja con cada replay (`VERSIONING.md`). */
const CASE_REPLAY_ALGORITHM = "replay-caso-1";

/**
 * Dónde debería estar un AGV según lo esperado, desde su última lectura: recorriendo el anillo con la
 * mediana (p50) de cada tramo, el sitio **habitual**; con el p95, el **lento**. Es una banda entre dos
 * tags, nunca un punto, y es `expected`: no se ha visto.
 */
export interface ExpectedBand {
  /** El tag de su última lectura y cuándo fue. */
  readonly fromTagId: string;
  readonly sinceUtcMs: number;
  /** Hasta dónde llega a paso lento (p95) y a paso habitual (p50), y cuántos tags son. */
  readonly slowTagId: string;
  readonly slowSteps: number;
  readonly typicalTagId: string;
  readonly typicalSteps: number;
  /** `true` si el recorrido se cortó en un tramo sin horquilla: más allá no se sabe. */
  readonly truncated: boolean;
  /** `true` si a paso habitual ya habría dado una vuelta entera: la banda deja de decir dónde. */
  readonly beyondLap: boolean;
  /**
   * `true` si lo observado queda por detrás incluso del paso lento: ni a paso de p95 seguiría donde
   * está. `null` si lo observado no se puede comparar (un salto de varios tags entre dos lecturas).
   */
  readonly behind: boolean | null;
}

export type ConnectionState = "conectado" | "sin-conexion" | "sin-registro";

export interface CaseReplayVehicle {
  readonly agvId: string;
  readonly state: VehicleReplayState;
  /** `null` sin lectura anterior, sin anillo congelado o sin horquilla en su primer tramo. */
  readonly expected: ExpectedBand | null;
  /** Lo que dice el registro de conexiones del terminal (observado); `sin-registro` si no hay. */
  readonly connection: ConnectionState;
}

export interface CaseReplayFrame {
  readonly atUtcMs: number;
  readonly phase: "antes" | "durante" | "despues";
  /** En orden de identificador. */
  readonly vehicles: readonly CaseReplayVehicle[];
  /** Índices en la cronología de los hechos que empiezan desde el fotograma anterior hasta este. */
  readonly events: readonly number[];
}

export interface CaseReplay {
  readonly algorithm: string;
  readonly frames: readonly CaseReplayFrame[];
  /** De dónde sale lo esperado, o `null` si no hay anillo congelado. */
  readonly expectedFrom: "memoria" | "instantanea" | null;
  /** Lo que el replay no puede enseñar, en palabras. */
  readonly limits: readonly string[];
}

export interface CaseReplayInput {
  readonly window: CaseWindow;
  readonly evidence: FrozenEvidence;
  readonly chronology: Chronology;
  readonly frameCount: number;
}

/**
 * El replay de un expediente sobre su recorte congelado: los fotogramas recorren la ventana entera con
 * sus márgenes, cada AGV con su estado (`replay.ts`, como el replay del circuito), la banda esperada
 * desde su última lectura, su conexión y los hechos de la cronología que caen en cada fotograma.
 * Determinista: mismo recorte, mismo replay.
 */
export function buildCaseReplay(input: CaseReplayInput): CaseReplay {
  const { window, evidence } = input;
  const context = evidence.context;
  const span = caseSpan(window);
  const limits: string[] = [];
  if (evidence.readings.length === 0) return { algorithm: CASE_REPLAY_ALGORITHM, frames: [], expectedFrom: null, limits: ["Sin lecturas en el recorte no hay replay."] };
  // Sin contexto no hay silencio configurado: se toma la ventana entera, así nada pasa por silencio.
  const silenceMs = context?.silenceMinGapMs ?? Number.POSITIVE_INFINITY;
  const base = buildReplayFrames(evidence.readings, input.frameCount, silenceMs, span);

  const byVehicle = new Map<string, Reading[]>();
  for (const reading of evidence.readings) {
    const own = byVehicle.get(reading.agvId);
    if (own === undefined) byVehicle.set(reading.agvId, [reading]);
    else own.push(reading);
  }
  for (const own of byVehicle.values()) own.sort((a, b) => a.time.utcMs - b.time.utcMs || a.provenance.sourceRow - b.provenance.sourceRow);

  const ring = context?.ring ?? [];
  const position = new Map(ring.map((tagId, index) => [tagId, index]));
  const bands = new Map((context?.edges ?? []).map((edge) => [`${edge.from}\u0000${edge.to}`, edge]));
  const regimeOf = context === null ? null : regimeReader(context.zone, context.regimes);
  if (context === null) limits.push("Sin el anillo ni las horquillas congelados no se dice dónde debería estar cada AGV.");

  const expectedAt = (agvId: string, at: number, state: VehicleReplayState): ExpectedBand | null => {
    if (regimeOf === null || ring.length < 2) return null;
    let last: Reading | null = null;
    for (const reading of byVehicle.get(agvId) ?? []) {
      if (reading.time.utcMs > at) break;
      last = reading;
    }
    if (last === null) return null;
    const start = position.get(last.tagId);
    if (start === undefined) return null;
    const regime = regimeOf(last.time.utcMs);
    const bandOf = (step: number): Band | null =>
      bands.get(`${ring[(start + step) % ring.length] as string}\u0000${ring[(start + step + 1) % ring.length] as string}`)?.[regime] ?? null;
    // Sin horquilla en el primer tramo no hay nada esperado que decir.
    if (bandOf(0) === null) return null;
    const elapsed = at - last.time.utcMs;
    let slowSteps = 0;
    let typicalSteps = 0;
    let slowSum = 0;
    let typicalSum = 0;
    let truncated = false;
    let beyondLap = true;
    // Una vez que el paso lento no llega a un tag, no llega a ninguno de los siguientes.
    let slowStopped = false;
    for (let step = 0; step < ring.length; step += 1) {
      const band = bandOf(step);
      if (band === null) {
        truncated = true;
        beyondLap = false;
        break;
      }
      const typicalFits = typicalSum + band.p50Ms <= elapsed;
      if (!slowStopped && slowSum + band.p95Ms <= elapsed) {
        slowSum += band.p95Ms;
        slowSteps = step + 1;
      } else {
        slowStopped = true;
      }
      if (!typicalFits) {
        // El p50 no pasa del p95: si el paso habitual no llega al siguiente tag, el lento tampoco.
        beyondLap = false;
        break;
      }
      typicalSum += band.p50Ms;
      typicalSteps = step + 1;
    }
    // Lo observado frente al paso lento: quieto en su tag o en silencio desde él, 0 tags; en tránsito
    // hacia el siguiente del anillo, todavía 0; un salto de varios tags no se puede comparar.
    const successor = ring[(start + 1) % ring.length] as string;
    const comparable =
      state.kind === "en-tag" || state.kind === "silencio" || (state.kind === "en-transito" && state.fromTagId === last.tagId && state.toTagId === successor);
    return {
      fromTagId: last.tagId,
      sinceUtcMs: last.time.utcMs,
      slowTagId: ring[(start + slowSteps) % ring.length] as string,
      slowSteps,
      typicalTagId: ring[(start + typicalSteps) % ring.length] as string,
      typicalSteps,
      truncated,
      beyondLap,
      behind: comparable ? slowSteps >= 1 : null,
    };
  };

  // Conexión: los cortes del registro del terminal, observados (DS-013).
  const registered = new Set(evidence.connections.map((event) => event.agvId));
  const cuts = context === null || evidence.connections.length === 0 ? [] : pairCuts(evidence.connections, span.to, context.connectionCuts);
  if (evidence.connections.length === 0) limits.push("Sin registro de conexiones del terminal: la conexión de cada AGV no se sabe.");
  else if (context === null) limits.push("Sin los umbrales congelados no se emparejan los cortes del registro de conexiones.");
  const connectionAt = (agvId: string, at: number): ConnectionState => {
    if (!registered.has(agvId)) return "sin-registro";
    return cuts.some((cut) => cut.agvId === agvId && cut.fromUtcMs <= at && (cut.toUtcMs ?? span.to) >= at) ? "sin-conexion" : "conectado";
  };

  const facts = input.chronology.facts;
  const frames: CaseReplayFrame[] = base.map((frame, index) => {
    const previous = index === 0 ? Number.NEGATIVE_INFINITY : (base[index - 1] as ReplayFrame).atUtcMs;
    const events = facts.flatMap((fact, factIndex) => (fact.at > previous && fact.at <= frame.atUtcMs ? [factIndex] : []));
    const vehicles = [...frame.vehicles.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([agvId, state]) => ({ agvId, state, expected: expectedAt(agvId, frame.atUtcMs, state), connection: connectionAt(agvId, frame.atUtcMs) }));
    const phase = frame.atUtcMs < window.symptomFrom ? "antes" : frame.atUtcMs <= window.symptomTo ? "durante" : "despues";
    return { atUtcMs: frame.atUtcMs, phase, vehicles, events };
  });
  limits.push("La posición dentro de un tramo es una fracción del tiempo entre dos lecturas, no una distancia: el AGV está en algún punto del tramo.");
  return { algorithm: CASE_REPLAY_ALGORITHM, frames, expectedFrom: context?.origin.kind ?? null, limits };
}
