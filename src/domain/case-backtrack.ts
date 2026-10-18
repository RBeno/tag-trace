/**
 * Retroceso desde el síntoma (ALG-015, ADR-0018 D6 y D7, `INCIDENTS_REPORTING.md` §4).
 *
 * Trabaja **solo** sobre lo congelado en el expediente —las lecturas de todos los AGV de la ventana,
 * los eventos de conexión y el contexto (anillo, horquillas, regímenes, lo declarado)—, así que con el
 * mismo recorte da siempre la misma cronología, cambie lo que cambie después en el circuito.
 *
 * Sigue los pasos de §4 que el dato permite hoy:
 *
 * 1. **El síntoma y su primera evidencia**: por cada tag del síntoma, el último paso antes y el primero
 *    después, y el hueco frente a lo habitual antes del síntoma (lo de después puede venir alterado).
 * 2. **Lo afectado**: los AGV que no leen nada durante el síntoma.
 * 3. **La primera desviación**: la primera transición entre dos tags seguidos del anillo que pasa la
 *    valla de su tramo (R-FLO-007) en su régimen.
 * 4. **Aguas arriba**: a cuántos tags del síntoma, por el anillo, ocurre cada cosa.
 * 5. **Los pares**: cuántos AGV siguieron leyendo durante el síntoma y cuáles no.
 * 6. **Comunicación y calendario**: los cortes del registro del terminal (observados, DS-013) y los
 *    cambios de turno y de régimen dentro de la ventana. FIFO, calles de carga y proceso no se revisan
 *    todavía, y se dice.
 *
 * Los pasos 7 y 8 (hipótesis ordenadas y la comprobación que discrimina) son de la entrega 4.
 *
 * **Lenguaje (D6).** Un hecho anterior al síntoma lleva `precede` y nada más: el orden de la cronología
 * es temporal, no de importancia ni de causa. Lo de durante y después se sitúa en su fase sin etiqueta
 * de relación. `correlaciona` exige repetición y `confirmado como causa` lo pone una persona: aquí no
 * salen nunca. Ningún texto de este módulo afirma una causa (prueba de lenguaje).
 */

import { pairCuts, type ConnectionCut } from "./connection-cuts.js";
import type { CaseWindow, FrozenEvidence } from "./incident-case.js";
import type { Provenance, Reading } from "./reading.js";
import { regimeReader, type Band, type Regime } from "./segment-bands.js";
import { localHourReader } from "./silence-kind.js";

/** Versión del procedimiento; viaja con cada cronología (`VERSIONING.md`). */
const BACKTRACK_ALGORITHM = "retroceso-1";

export type ChronologyPhase = "antes" | "durante" | "despues";

export type ChronologyKind =
  | "sin-paso"
  | "desviacion"
  | "silencio-agv"
  | "corte-wifi"
  | "pares"
  | "turno"
  | "regimen";

export interface ChronologyFact {
  /** Cuándo empieza el hecho. */
  readonly at: number;
  /** Cuándo termina, si dura; `null` si es un instante o no termina dentro de la ventana. */
  readonly until: number | null;
  readonly phase: ChronologyPhase;
  /** `precede` si es anterior al síntoma; nada más (D6). */
  readonly relation: "precede" | null;
  readonly kind: ChronologyKind;
  readonly text: string;
  readonly agvId: string | null;
  readonly tagIds: readonly string[];
  /** A cuántos tags del síntoma, aguas arriba por el anillo; `null` si no se puede situar. */
  readonly upstream: number | null;
  /** Las filas que lo sostienen (archivo, hash y fila), o vacío si sale del registro de conexiones o del calendario. */
  readonly provenance: readonly Provenance[];
  /** Filas del registro de conexiones que lo sostienen, con la huella de su fichero. */
  readonly connectionRows: readonly { readonly sourceHash: string; readonly sourceRow: number }[];
}

export interface Chronology {
  readonly algorithm: string;
  readonly facts: readonly ChronologyFact[];
  /** Índice en `facts` de la primera desviación, o `null` si no la hay. */
  readonly firstDeviation: number | null;
  /** Lo declarado en planta de los tags del síntoma (R-GRA-022). */
  readonly declared: readonly { readonly tagId: string; readonly text: string }[];
  /** Lo que este retroceso no revisa o no pudo revisar, en palabras. Nunca se calla. */
  readonly limits: readonly string[];
}

export interface BacktrackInput {
  readonly window: CaseWindow;
  readonly agvId: string | null;
  readonly tagIds: readonly string[];
  readonly evidence: FrozenEvidence;
}

const KIND_ORDER: Readonly<Record<ChronologyKind, number>> = {
  turno: 0,
  regimen: 1,
  "corte-wifi": 2,
  desviacion: 3,
  "silencio-agv": 4,
  "sin-paso": 5,
  pares: 6,
};

/** «12 min 30 s», «45 s», «2 h 5 min». Solo duraciones: la hora la pone la interfaz. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** La cronología del expediente desde su recorte. Determinista: mismo recorte, misma cronología. */
export function backtrack(input: BacktrackInput): Chronology {
  const { window, evidence } = input;
  const { readings, context } = evidence;
  const symptomFrom = window.symptomFrom;
  const symptomTo = window.symptomTo;
  const spanFrom = symptomFrom - window.marginBeforeMs;
  const spanTo = symptomTo + window.marginAfterMs;
  const phaseOf = (at: number): ChronologyPhase => (at < symptomFrom ? "antes" : at <= symptomTo ? "durante" : "despues");
  const facts: ChronologyFact[] = [];
  const push = (fact: Omit<ChronologyFact, "phase" | "relation" | "connectionRows"> & { readonly connectionRows?: ChronologyFact["connectionRows"] }): void => {
    const phase = phaseOf(fact.at);
    facts.push({ connectionRows: [], ...fact, phase, relation: phase === "antes" ? "precede" : null });
  };
  const limits: string[] = [];
  const subjects = [...new Set(input.tagIds)];

  // Aguas arriba: pasos por el anillo desde un tag hasta el primer tag del síntoma que encuentra.
  const ring = context?.ring ?? [];
  const position = new Map(ring.map((tagId, index) => [tagId, index]));
  const subjectPositions = subjects.map((tagId) => position.get(tagId)).filter((index): index is number => index !== undefined);
  const upstreamOf = (tagId: string): number | null => {
    const at = position.get(tagId);
    if (at === undefined || subjectPositions.length === 0) return null;
    return Math.min(...subjectPositions.map((target) => (target - at + ring.length) % ring.length));
  };

  const byVehicle = new Map<string, Reading[]>();
  for (const reading of readings) {
    const own = byVehicle.get(reading.agvId);
    if (own === undefined) byVehicle.set(reading.agvId, [reading]);
    else own.push(reading);
  }
  for (const own of byVehicle.values()) own.sort((a, b) => a.time.utcMs - b.time.utcMs || a.provenance.sourceRow - b.provenance.sourceRow);
  const vehicles = [...byVehicle.keys()].sort(compareText);

  // 1. El síntoma en cada tag: último paso antes, primero después, y lo habitual fuera del síntoma.
  const minSamples = context?.minMedianSamples ?? null;
  for (const tagId of subjects) {
    const passes = readings.filter((reading) => reading.tagId === tagId).sort((a, b) => a.time.utcMs - b.time.utcMs);
    if (passes.length === 0) {
      push({
        at: spanFrom,
        until: null,
        kind: "sin-paso",
        text: `Ningún AGV lee ${tagId} en toda la ventana: no se sabe cuándo dejó de pasar.`,
        agvId: null,
        tagIds: [tagId],
        upstream: 0,
        provenance: [],
      });
      continue;
    }
    const last = [...passes].reverse().find((reading) => reading.time.utcMs < symptomFrom) ?? null;
    const next = passes.find((reading) => reading.time.utcMs > (last?.time.utcMs ?? symptomFrom - 1) && reading.time.utcMs >= symptomFrom) ?? null;
    const intervals: number[] = [];
    for (let index = 1; index < passes.length; index += 1) {
      const a = (passes[index - 1] as Reading).time.utcMs;
      const b = (passes[index] as Reading).time.utcMs;
      // Antes del síntoma: lo de después puede venir alterado por el propio síntoma (una cola que se
      // suelta pasa en tropel), así que no sirve de referencia.
      if (b < symptomFrom) intervals.push(b - a);
    }
    const usual =
      minSamples === null
        ? "sin el contexto congelado no se dice lo habitual"
        : intervals.length >= minSamples
          ? `lo habitual antes del síntoma, en la ventana, es un paso cada ${formatDuration(median(intervals))}`
          : "no hay pasos suficientes antes del síntoma para decir lo habitual";
    if (last === null) {
      push({
        at: spanFrom,
        until: next?.time.utcMs ?? null,
        kind: "sin-paso",
        text: `Ningún paso por ${tagId} antes del síntoma dentro de la ventana${next === null ? ", ni después" : `; el primero después, AGV ${next.agvId}`}; ${usual}.`,
        agvId: null,
        tagIds: [tagId],
        upstream: 0,
        provenance: next === null ? [] : [next.provenance],
      });
      continue;
    }
    const gap = next === null ? spanTo - last.time.utcMs : next.time.utcMs - last.time.utcMs;
    push({
      at: last.time.utcMs,
      until: next?.time.utcMs ?? null,
      kind: "sin-paso",
      text:
        `Último paso por ${tagId} antes del síntoma: AGV ${last.agvId}. ` +
        (next === null
          ? `No vuelve a pasar nadie dentro de la ventana (al menos ${formatDuration(gap)})`
          : `El siguiente, AGV ${next.agvId}, ${formatDuration(gap)} después`) +
        `; ${usual}.`,
      agvId: last.agvId,
      tagIds: [tagId],
      upstream: 0,
      provenance: next === null ? [last.provenance] : [last.provenance, next.provenance],
    });
  }

  // 3 y 4. Desviaciones y silencios de cada AGV, antes y durante el síntoma.
  const regimeOf = context === null ? null : regimeReader(context.zone, context.regimes);
  const bands = new Map((context?.edges ?? []).map((edge) => [`${edge.from}\u0000${edge.to}`, edge]));
  const successor = (tagId: string): string | null => {
    const at = position.get(tagId);
    return at === undefined || ring.length < 2 ? null : (ring[(at + 1) % ring.length] as string);
  };
  const expectedWord = context?.origin.kind === "memoria" ? "lo esperado" : "lo habitual del fichero";
  const silenceMs = context?.silenceMinGapMs ?? null;
  for (const agvId of vehicles) {
    const own = byVehicle.get(agvId) as Reading[];
    for (let index = 1; index < own.length; index += 1) {
      const a = own[index - 1] as Reading;
      const b = own[index] as Reading;
      const from = a.time.utcMs;
      const to = b.time.utcMs;
      if (from > symptomTo) break;
      const duration = to - from;
      if (successor(a.tagId) === b.tagId && regimeOf !== null) {
        const edge = bands.get(`${a.tagId}\u0000${b.tagId}`);
        const regime: Regime = regimeOf((from + to) / 2);
        const band: Band | null = edge === undefined ? null : edge[regime];
        if (band !== null && duration > band.fenceMs) {
          push({
            at: from,
            until: to,
            kind: "desviacion",
            text:
              `AGV ${agvId} tarda ${formatDuration(duration)} de ${a.tagId} a ${b.tagId}, por encima de ${expectedWord} en ese tramo ` +
              `(como mucho ${formatDuration(band.fenceMs)}${regime === "noche" ? ", de noche" : ""}).`,
            agvId,
            tagIds: [a.tagId, b.tagId],
            upstream: upstreamOf(a.tagId),
            provenance: [a.provenance, b.provenance],
          });
        }
        continue;
      }
      if (silenceMs !== null && duration > silenceMs) {
        push({
          at: from,
          until: to,
          kind: "silencio-agv",
          text: `AGV ${agvId} sin lecturas ${formatDuration(duration)} desde ${a.tagId}; vuelve a leer en ${b.tagId}.`,
          agvId,
          tagIds: [a.tagId, b.tagId],
          upstream: upstreamOf(a.tagId),
          provenance: [a.provenance, b.provenance],
        });
      }
    }
    const last = own[own.length - 1] as Reading;
    if (silenceMs !== null && last.time.utcMs <= symptomTo && spanTo - last.time.utcMs > silenceMs) {
      push({
        at: last.time.utcMs,
        until: null,
        kind: "silencio-agv",
        text: `AGV ${agvId} sin lecturas desde ${last.tagId} hasta el final de la ventana (al menos ${formatDuration(spanTo - last.time.utcMs)}).`,
        agvId,
        tagIds: [last.tagId],
        upstream: upstreamOf(last.tagId),
        provenance: [last.provenance],
      });
    }
  }
  if (context === null) {
    limits.push(
      "Sin el anillo ni las horquillas congelados no se buscan desviaciones ni silencios, ni se dice a cuántos tags del síntoma ocurre cada cosa.",
    );
  }

  // 5. Los pares: quién siguió leyendo durante el síntoma.
  if (vehicles.length > 0) {
    const silent = vehicles.filter((agvId) => !(byVehicle.get(agvId) as Reading[]).some((reading) => reading.time.utcMs >= symptomFrom && reading.time.utcMs <= symptomTo));
    const reading = vehicles.length - silent.length;
    push({
      at: symptomFrom,
      until: symptomTo,
      kind: "pares",
      text:
        `Durante el síntoma leen ${reading.toLocaleString("es-ES")} de ${vehicles.length.toLocaleString("es-ES")} AGV de la ventana` +
        (silent.length === 0 ? "." : `; sin ninguna lectura: ${silent.join(", ")}.`) +
        (input.agvId !== null && byVehicle.has(input.agvId) ? (silent.includes(input.agvId) ? ` El AGV del síntoma, ${input.agvId}, es de los que no leen.` : ` El AGV del síntoma, ${input.agvId}, sigue leyendo.`) : ""),
      agvId: null,
      tagIds: [],
      upstream: null,
      provenance: [],
    });
  }

  // 6. Comunicación: los cortes del registro del terminal (observados).
  if (context !== null && evidence.connections.length > 0) {
    const cuts: ConnectionCut[] = pairCuts(evidence.connections, spanTo, context.connectionCuts);
    const rowOf = new Map(evidence.connections.map((event) => [`${event.agvId}\u0000${event.sourceRow}`, event.sourceHash]));
    for (const cut of cuts) {
      const end = cut.toUtcMs ?? spanTo;
      if (end < spanFrom || cut.fromUtcMs > spanTo) continue;
      const lastTag = lastTagBefore(byVehicle.get(cut.agvId) ?? [], cut.fromUtcMs);
      push({
        at: cut.fromUtcMs,
        until: cut.toUtcMs,
        kind: "corte-wifi",
        text:
          `AGV ${cut.agvId} sin conexión con el servidor ${cut.toUtcMs === null ? `desde entonces hasta el final de la ventana (al menos ${formatDuration(spanTo - cut.fromUtcMs)})` : formatDuration(cut.durationMs)}, según el registro del terminal` +
          `${cut.end === "tras-apagado" ? "; vuelve al encenderse" : ""}${cut.collective ? "; a la vez que otros AGV" : ""}` +
          `${lastTag === null ? "" : `; su última lectura antes, en ${lastTag}`}.`,
        agvId: cut.agvId,
        tagIds: lastTag === null ? [] : [lastTag],
        upstream: lastTag === null ? null : upstreamOf(lastTag),
        provenance: [],
        connectionRows: [{ sourceHash: rowOf.get(`${cut.agvId}\u0000${cut.sourceRow}`) ?? "", sourceRow: cut.sourceRow }],
      });
    }
  } else {
    limits.push("Sin registro de conexiones del terminal en la ventana, la comunicación no se revisa: sin registro no es lo mismo que sin cortes.");
  }

  // 6. Calendario: cambios de turno y de régimen dentro de la ventana.
  if (context !== null) {
    const hourOf = localHourReader(context.zone);
    const regime = regimeReader(context.zone, context.regimes);
    const hour = 3_600_000;
    let at = Math.ceil(spanFrom / hour) * hour;
    for (; at <= spanTo; at += hour) {
      const local = hourOf(at);
      if (hourOf(at - 1) === local) continue;
      if (context.shiftStartHours.includes(local)) {
        push({ at, until: null, kind: "turno", text: `Empieza el turno de las ${String(local).padStart(2, "0")}:00.`, agvId: null, tagIds: [], upstream: null, provenance: [] });
      }
      if (regime(at - 1) !== regime(at)) {
        push({
          at,
          until: null,
          kind: "regimen",
          text: regime(at) === "noche" ? "Empieza el régimen de noche." : "Termina el régimen de noche.",
          agvId: null,
          tagIds: [],
          upstream: null,
          provenance: [],
        });
      }
    }
  }
  limits.push("FIFO, calles de carga, la línea y el proceso no se revisan todavía en el retroceso.");
  if (subjects.length === 0) limits.push("El síntoma no nombra ningún tag: no se mira el paso por un punto ni se dice qué está aguas arriba.");

  facts.sort((a, b) => a.at - b.at || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || compareText(a.agvId ?? "", b.agvId ?? "") || compareText(a.text, b.text));
  const first = facts.findIndex((fact) => fact.kind === "desviacion");
  const declared = subjects
    .filter((tagId) => context?.declared[tagId] !== undefined)
    .map((tagId) => ({ tagId, text: context?.declared[tagId] as string }));
  return { algorithm: BACKTRACK_ALGORITHM, facts, firstDeviation: first < 0 ? null : first, declared, limits };
}

function lastTagBefore(own: readonly Reading[], at: number): string | null {
  let found: string | null = null;
  for (const reading of own) {
    if (reading.time.utcMs > at) break;
    found = reading.tagId;
  }
  return found;
}

/** Cómo se llama cada fase en la interfaz. */
export const PHASE_TEXT: Readonly<Record<ChronologyPhase, string>> = {
  antes: "Antes del síntoma",
  durante: "Durante el síntoma",
  despues: "Después del síntoma",
};
