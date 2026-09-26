/**
 * FIFO en zona cargada (R-FLO-001), leído como inversión de orden dentro de un tramo del anillo.
 *
 * La zona cargada espera que quien entra primero salga primero; la zona vacía admite reordenación y
 * queda fuera de aquí (R-FLO-002). El cálculo es el mismo que ya resuelve `charging.ts` para una
 * calle de carga —quién entró antes pero salió después de otro—, aplicado a un tramo del anillo en
 * vez de a una calle: entrada y salida del tramo en lugar de entrada y salida de la calle.
 *
 * La diferencia que importa: una calle de carga es una cola física real, así que cualquier inversión
 * de orden es señal fuerte. Un tramo de zona cargada es tránsito abierto — dos vehículos sanos
 * muestran pequeñas diferencias de orden por el simple jitter de lectura, y un vehículo que vuelve
 * de cargar (una de las excepciones que la propia R-FLO-001 nombra) reaparece con una fase nueva
 * frente a sus antiguos vecinos, lo que puede producir una inversión grande y enteramente inocente.
 * Por eso el adelantamiento exige un margen mínimo, absoluto **y** proporcional al tránsito propio
 * del tramo (el que sea mayor de los dos) — la misma guarda dual que la degradación/rotura de
 * `read-rate-trend.ts` necesitó tras encontrarse un falso positivo real en una línea larga.
 *
 * OQ-107 sigue abierta: qué excepciones legítimas admite el FIFO cargado no lo dice el dato. Por
 * eso lo que este módulo produce son candidatos, nunca averías confirmadas.
 */

import { mergeIntervals, uncoveredGaps, type Interval } from "./coverage.js";
import type { Reading } from "./reading.js";

export interface FifoThresholds {
  /** Pasadas «completa» mínimas de un tramo antes de calcular su tránsito mediano o buscar nada. */
  readonly minPassesForSpan: number;
  /** Margen absoluto mínimo para que una inversión de orden cuente como adelantamiento. */
  readonly minOvertakeMarginMs: number;
  /**
   * Margen mínimo como fracción del tránsito mediano **del propio tramo** — manda el mayor de los
   * dos. Relativo a propósito (R-FLO-004): cuánto tarda un tramo cargado es local, no una constante
   * universal.
   */
  readonly minOvertakeMarginRatio: number;
}

/** Un tramo contiguo de zona cargada a lo largo del anillo, con su entrada y su salida. */
export interface LoadedSpan {
  readonly spanId: string;
  readonly tags: readonly string[];
  readonly entryTagId: string;
  readonly exitTagId: string;
}

export interface LoadedZoneLayout {
  readonly spans: readonly LoadedSpan[];
  readonly problems: readonly string[];
}

/**
 * Deriva los tramos de zona cargada del anillo. No se configuran directamente: se declara la zona
 * de cada tag (`readZones`) y el tramo sale de qué tags cargados quedan contiguos en el anillo.
 *
 * Un tag cuenta como cargado solo si su zona es exactamente `"cargado"` — nunca por omisión. Un tag
 * sin zona declarada no se convierte en parte de un tramo: eso sería inventar configuración que
 * nadie ha dado.
 */
export function loadedZoneSpans(
  ring: readonly string[],
  zoneOf: ReadonlyMap<string, string>,
): LoadedZoneLayout {
  const isLoaded = (tagId: string): boolean => zoneOf.get(tagId) === "cargado";

  if (ring.length === 0) return { spans: [], problems: [] };
  if (ring.every(isLoaded)) {
    return {
      spans: [],
      problems: ["todo el anillo está declarado como zona cargada: sin frontera con una zona vacía no hay tramos que acotar"],
    };
  }
  if (ring.every((tag) => !isLoaded(tag))) return { spans: [], problems: [] };

  // Arrancar en cualquier posición no cargada garantiza que un tramo que cruza el índice 0 del
  // array se recorra entero sin partirse en dos: se camina un ciclo completo desde fuera de él.
  const anchorIndex = ring.findIndex((tag) => !isLoaded(tag));
  const spans: LoadedSpan[] = [];
  const problems: string[] = [];
  let run: string[] = [];
  let spanCount = 0;

  const flush = (): void => {
    if (run.length === 0) return;
    if (run.length === 1) {
      problems.push(
        `el tag ${run[0]} es el único de su tramo de zona cargada: no se puede distinguir entrada de salida con una sola lectura`,
      );
    } else {
      spanCount += 1;
      const tags = run;
      spans.push({
        spanId: `cargado-${spanCount}`,
        tags,
        entryTagId: tags[0] as string,
        exitTagId: tags[tags.length - 1] as string,
      });
    }
    run = [];
  };

  for (let step = 1; step <= ring.length; step += 1) {
    const tag = ring[(anchorIndex + step) % ring.length] as string;
    if (isLoaded(tag)) run.push(tag);
    else flush();
  }
  flush();

  return { spans, problems };
}

type SpanPassState = "completa" | "abierta-al-inicio" | "abierta-al-final" | "incompleta";

interface SpanPass {
  readonly enteredUtcMs: number | null;
  readonly leftUtcMs: number | null;
  readonly state: SpanPassState;
}

/**
 * Recorre las lecturas de un vehículo en un tramo y saca sus pasadas.
 *
 * Calcada de `staysOf` en `charging.ts`, sin la parada intermedia: solo entrada y salida. Lo que no
 * encaja sale como `incompleta` en vez de forzarse.
 */
function passesOf(
  hits: readonly { readonly role: "entrada" | "salida"; readonly utcMs: number }[],
  straddlesGap: (fromUtcMs: number, toUtcMs: number) => boolean,
): readonly SpanPass[] {
  const passes: SpanPass[] = [];
  let open: number | null = null;

  for (const [index, hit] of hits.entries()) {
    if (hit.role === "entrada") {
      if (open !== null) {
        passes.push({ enteredUtcMs: open, leftUtcMs: null, state: "incompleta" });
      }
      open = hit.utcMs;
      continue;
    }

    // Salida. Con un tramo entero sin datos cargados entre la entrada y la salida no se sabe cuánto
    // tardó (R-DAT-007): darla por completa la haría «adelantada» por todos los que pasaron en la
    // exportación siguiente.
    if (open !== null) {
      passes.push({ enteredUtcMs: open, leftUtcMs: hit.utcMs, state: straddlesGap(open, hit.utcMs) ? "incompleta" : "completa" });
      open = null;
      continue;
    }

    // Salida sin entrada previa. Si es la primera lectura del vehículo en el tramo, ya estaba
    // dentro (equivalente de R-CO-007 para un tramo del anillo en vez de una calle).
    passes.push({
      enteredUtcMs: null,
      leftUtcMs: hit.utcMs,
      state: index === 0 ? "abierta-al-inicio" : "incompleta",
    });
  }

  if (open !== null) passes.push({ enteredUtcMs: open, leftUtcMs: null, state: "abierta-al-final" });

  return passes;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export interface FifoOvertake {
  readonly overtaken: string;
  readonly overtakenBy: readonly string[];
  readonly transitMs: number;
  readonly marginMs: number;
}

/** Una pasada completa por un tramo: entró por su primer tag y salió por el último. */
export interface FifoPass {
  readonly agvId: string;
  readonly enteredUtcMs: number;
  readonly leftUtcMs: number;
}

/**
 * Cuántas pasadas, como mucho, lleva la ventana que se dibuja alrededor de un adelantamiento.
 * Parámetro de pantalla, no magnitud de planta: no decide ningún adelantamiento, solo cuántos
 * vecinos se enseñan a su alrededor.
 */
export const FIFO_FOCUS_MAX = 30;

export interface SpanReport {
  readonly spanId: string;
  readonly entryTagId: string;
  readonly exitTagId: string;
  readonly tagCount: number;
  readonly passes: number;
  readonly medianTransitMs: number | null;
  readonly evaluated: boolean;
  readonly overtakes: readonly FifoOvertake[];
  /**
   * Pasadas completas, en orden de entrada, alrededor del adelantamiento con más vehículos por
   * delante: desde un poco antes del adelantado hasta el último que lo adelantó. Es lo que la vista
   * dibuja como orden de entrada frente a orden de salida. Vacía si no hay adelantamientos.
   */
  readonly focus: readonly FifoPass[];
}

export interface FifoReport {
  readonly cohortId: number;
  readonly spans: readonly SpanReport[];
}

/**
 * Quién adelantó a quién dentro de un tramo: entró después pero salió antes, por un margen que no
 * se explica por el jitter normal de lectura.
 *
 * El margen se exige en las dos puntas a propósito: si la diferencia de entrada ya está dentro del
 * ruido, «quién es el más antiguo» es tan incierto como la inversión de salida que supuestamente
 * explica, y admitirla fabricaría el mismo hallazgo con otro nombre.
 *
 * Sale ordenado por margen descendente — el adelantamiento más nítido primero. A diferencia de
 * `seniorityBreaches` (que ordena por cuánto esperó el vehículo), aquí «esperar» no tiene el mismo
 * sentido que en una cola física: lo que importa es la claridad de la inversión, no su duración.
 */
function findOvertakes(
  entered: readonly { readonly agvId: string; readonly enteredUtcMs: number; readonly leftUtcMs: number }[],
  medianTransitMs: number,
  thresholds: FifoThresholds,
): readonly FifoOvertake[] {
  const sorted = [...entered].sort((a, b) => a.enteredUtcMs - b.enteredUtcMs);
  const margin = Math.max(thresholds.minOvertakeMarginMs, medianTransitMs * thresholds.minOvertakeMarginRatio);

  const overtakes: FifoOvertake[] = [];
  for (const [index, pass] of sorted.entries()) {
    const overtakenBy = sorted
      .slice(index + 1)
      .filter(
        (other) =>
          other.enteredUtcMs - pass.enteredUtcMs >= margin && pass.leftUtcMs - other.leftUtcMs >= margin,
      )
      .map((other) => other.agvId);
    if (overtakenBy.length > 0) {
      overtakes.push({
        overtaken: pass.agvId,
        overtakenBy: [...new Set(overtakenBy)],
        transitMs: pass.leftUtcMs - pass.enteredUtcMs,
        marginMs: margin,
      });
    }
  }
  return overtakes.sort((a, b) => b.marginMs - a.marginMs);
}

/**
 * La ventana de pasadas que enseña un adelantamiento: el adelantado, los que lo adelantaron y unos
 * pocos vecinos a cada lado para que se vea que los demás sí conservaron el orden.
 */
function focusWindow(completed: readonly FifoPass[], overtakes: readonly FifoOvertake[]): readonly FifoPass[] {
  const top = overtakes.reduce<FifoOvertake | undefined>(
    (best, overtake) => (best === undefined || overtake.overtakenBy.length > best.overtakenBy.length ? overtake : best),
    undefined,
  );
  if (top === undefined) return [];
  const sorted = [...completed].sort((a, b) => a.enteredUtcMs - b.enteredUtcMs);
  const start = sorted.findIndex(
    (pass) => pass.agvId === top.overtaken && pass.leftUtcMs - pass.enteredUtcMs === top.transitMs,
  );
  if (start === -1) return [];
  const slow = sorted[start] as FifoPass;
  const overtakers = new Set(top.overtakenBy);
  let end = start;
  for (let index = start + 1; index < sorted.length; index += 1) {
    const pass = sorted[index] as FifoPass;
    if (pass.enteredUtcMs >= slow.leftUtcMs) break;
    if (overtakers.has(pass.agvId) && pass.leftUtcMs < slow.leftUtcMs) end = index;
  }
  const from = Math.max(0, start - 3);
  const to = Math.min(sorted.length - 1, end + 2, from + FIFO_FOCUS_MAX - 1);
  return sorted.slice(from, to + 1);
}

/** Construye el informe de FIFO de un cohorte, un tramo a la vez. */
export function buildFifoReport(
  cohortId: number,
  cohortReadings: readonly Reading[],
  spans: readonly LoadedSpan[],
  thresholds: FifoThresholds,
  /** Los tramos con datos cargados: una pasada que cruza el hueco entre dos no es una pasada. */
  coverage: readonly Interval[] = [],
): FifoReport {
  if (spans.length === 0) return { cohortId, spans: [] };
  const gaps = uncoveredGaps(mergeIntervals([...coverage]));
  const straddlesGap = (fromUtcMs: number, toUtcMs: number): boolean =>
    gaps.some((gap) => fromUtcMs <= gap.from && toUtcMs >= gap.to);

  const spanByEntryOrExit = new Map<string, { readonly span: LoadedSpan; readonly role: "entrada" | "salida" }>();
  for (const span of spans) {
    spanByEntryOrExit.set(span.entryTagId, { span, role: "entrada" });
    spanByEntryOrExit.set(span.exitTagId, { span, role: "salida" });
  }

  const hitsByVehicleAndSpan = new Map<string, { readonly role: "entrada" | "salida"; readonly utcMs: number }[]>();
  for (const reading of cohortReadings) {
    const hit = spanByEntryOrExit.get(reading.tagId);
    if (hit === undefined) continue;
    const key = `${reading.agvId}\u0000${hit.span.spanId}`;
    let hits = hitsByVehicleAndSpan.get(key);
    if (hits === undefined) {
      hits = [];
      hitsByVehicleAndSpan.set(key, hits);
    }
    hits.push({ role: hit.role, utcMs: reading.time.utcMs });
  }

  const completedBySpan = new Map<string, { readonly agvId: string; readonly enteredUtcMs: number; readonly leftUtcMs: number }[]>();
  for (const span of spans) completedBySpan.set(span.spanId, []);
  for (const [key, hits] of hitsByVehicleAndSpan) {
    const [agvId, spanId] = key.split("\u0000") as [string, string];
    hits.sort((a, b) => a.utcMs - b.utcMs);
    for (const pass of passesOf(hits, straddlesGap)) {
      if (pass.state === "completa" && pass.enteredUtcMs !== null && pass.leftUtcMs !== null) {
        completedBySpan.get(spanId)?.push({ agvId, enteredUtcMs: pass.enteredUtcMs, leftUtcMs: pass.leftUtcMs });
      }
    }
  }

  const report: SpanReport[] = spans.map((span) => {
    const completed = completedBySpan.get(span.spanId) ?? [];
    const medianTransitMs =
      completed.length >= thresholds.minPassesForSpan
        ? median(completed.map((pass) => pass.leftUtcMs - pass.enteredUtcMs))
        : null;
    const overtakes = medianTransitMs === null ? [] : findOvertakes(completed, medianTransitMs, thresholds);
    return {
      spanId: span.spanId,
      entryTagId: span.entryTagId,
      exitTagId: span.exitTagId,
      tagCount: span.tags.length,
      passes: completed.length,
      medianTransitMs,
      evaluated: medianTransitMs !== null,
      overtakes,
      focus: focusWindow(completed, overtakes),
    };
  });

  return { cohortId, spans: report };
}
