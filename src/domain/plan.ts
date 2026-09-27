/**
 * El plano físico del circuito (ADR-0016): ubicaciones estables, el tag instalado en cada una a lo
 * largo del tiempo, y las salidas que se revisan a mano.
 *
 * - **Ubicación ≠ tag.** Sustituir el tag de una ubicación cambia la instalación, no la ubicación, y
 *   la historia del tramo sigue.
 * - **Eventos append-only con fecha efectiva.** El plano de un instante sale de recorrer los eventos
 *   hasta ese instante; ningún evento reescribe el pasado.
 * - **Ninguna IA cambia el plano.** `proposeChanges` propone con evidencia; solo la confirmación de
 *   una persona se convierte en evento (ADR-0010, R-MEM-001).
 * - **El plano persiste frente a las lecturas.** Una ubicación sin leer en un fichero queda «no
 *   observada» con sus pasadas, no fuera del plano.
 *
 * Este fichero fija el **contrato**. Los campos se añaden, no se renombran; cambiar uno es subir
 * `PLAN_SCHEMA_VERSION` y escribir su migración.
 */

import type { Interval } from "./coverage.js";
import type { ConsolidatedVersion } from "./memory.js";
import { pairKey, type Band } from "./segment-bands.js";
import { canonicalise } from "./semantic-hash.js";
import type { CircuitSnapshot, SnapshotAnchorGap, SnapshotDelta, SnapshotEdge } from "./snapshot.js";
import type { TruthState } from "./truth.js";

export const PLAN_SCHEMA_VERSION = 1;

// --- Estadísticas combinables (ADR-0016 §6) ---------------------------------------------------------

/** Recuento, media y suma de cuadrados de desviaciones (Welford): se combinan sin las muestras. */
export interface Moments {
  readonly n: number;
  readonly meanMs: number;
  readonly m2: number;
}

/** Los momentos de una lista de duraciones; `n = 0` da media y M2 cero. */
export function momentsOf(durations: readonly number[]): Moments {
  // Welford: una pasada, sin restar dos sumas grandes (que pierde precisión con tiempos en ms).
  let meanMs = 0;
  let m2 = 0;
  durations.forEach((value, index) => {
    const delta = value - meanMs;
    meanMs += delta / (index + 1);
    m2 += delta * (value - meanMs);
  });
  return { n: durations.length, meanMs, m2 };
}

/** Combinación exacta de dos conjuntos (Chan et al.): el resultado es el de haber medido todo junto. */
export function combineMoments(a: Moments, b: Moments): Moments {
  const n = a.n + b.n;
  if (n === 0) return { n: 0, meanMs: 0, m2: 0 };
  if (a.n === 0) return { n: b.n, meanMs: b.meanMs, m2: b.m2 };
  if (b.n === 0) return { n: a.n, meanMs: a.meanMs, m2: a.m2 };
  const delta = b.meanMs - a.meanMs;
  return { n, meanMs: a.meanMs + (delta * b.n) / n, m2: a.m2 + b.m2 + (delta * delta * a.n * b.n) / n };
}

/** Varianza muestral (`m2 / (n − 1)`), o `null` con menos de dos muestras. */
export function varianceOf(moments: Moments): number | null {
  return moments.n < 2 ? null : moments.m2 / (moments.n - 1);
}

// --- Eventos del plano -------------------------------------------------------------------------------

export type LocationKind = "anillo" | "salida";

/** Lo que encontró quien fue a mirar una ubicación. */
export type ManualResult = "correcto" | "averiado" | "no-encontrado";

export interface PlanEvidence {
  /** El fichero cuya instantánea sostiene el cambio; `null` en un cambio manual sin fichero. */
  readonly sourceId: string | null;
  readonly fileName: string | null;
  /** Qué se vio, en palabras: vecinos, pasadas, AGV distintos. */
  readonly detail: string;
}

interface PlanEventBase {
  readonly circuitId: string;
  /** 1, 2, 3… en orden de registro. Es la clave del evento en el almacén. */
  readonly seq: number;
  /** Desde cuándo vale el cambio (instante UTC). No tiene por qué ser el momento de registrarlo. */
  readonly effectiveAt: number;
  /** Cuándo se registró. */
  readonly recordedAt: number;
  /** Justificación humana. Nunca vacía. */
  readonly reason: string;
  readonly evidence: PlanEvidence | null;
  /** `propuesta`: nació de `proposeChanges` y una persona la confirmó; `manual`: la escribió una persona. */
  readonly origin: "manual" | "propuesta";
}

/** El cuerpo de cada tipo de evento, sin la base común. */
export type PlanEventBody =
  /** El plano nace de una versión consolidada: una ubicación de anillo por tag de su anillo, en orden. */
  | {
      readonly type: "crear-plano";
      readonly fromVersion: number;
      readonly ring: readonly { readonly locationId: string; readonly tagId: string }[];
    }
  /**
   * Una ubicación nueva. De anillo, detrás de `after` (la conexión `after → siguiente` se parte en
   * dos); o salida, colgando de `branchFrom`. Nace sin tag salvo que la acompañe un `instalar`.
   * `virtualTag`: el código que el circuito virtual declara para ese sitio, si lo hay, aunque no
   * esté instalado físicamente (R-OPP-011: sin tag físico no hay oportunidad).
   */
  | {
      readonly type: "crear-ubicacion";
      readonly locationId: string;
      readonly kind: LocationKind;
      readonly after: string | null;
      readonly branchFrom: string | null;
      readonly virtualTag: string | null;
    }
  /** Se instala un tag en una ubicación que no tenía ninguno. */
  | { readonly type: "instalar"; readonly locationId: string; readonly tagId: string }
  /** Se retira el tag; la ubicación sigue, sin tag físico. */
  | { readonly type: "retirar"; readonly locationId: string }
  /** Se cambia el tag de una ubicación por otro: la ubicación y su historia siguen. */
  | { readonly type: "sustituir"; readonly locationId: string; readonly tagId: string }
  /** La ubicación deja de existir; en el anillo, sus vecinos pasan a estar conectados. */
  | { readonly type: "cerrar-ubicacion"; readonly locationId: string }
  /** Alguien fue a mirar la ubicación: observación confirmada (ADR-0016 §5). */
  | { readonly type: "revision-manual"; readonly locationId: string; readonly result: ManualResult; readonly note: string };

export type PlanEvent = PlanEventBase & PlanEventBody;

/** Lo que la interfaz manda para registrar un evento: el cuerpo, su fecha efectiva y su evidencia. */
export type PlanEventInput = PlanEventBody & {
  readonly effectiveAt: number;
  readonly evidence: PlanEvidence | null;
};

// --- El plano de un instante -------------------------------------------------------------------------

export interface PlanLocation {
  readonly locationId: string;
  readonly kind: LocationKind;
  /** El tag instalado en ese instante, o `null` si la ubicación no tiene tag físico. */
  readonly tagId: string | null;
  readonly virtualTag: string | null;
  /** Solo en las salidas: la ubicación del anillo de la que cuelga. */
  readonly branchFrom: string | null;
  readonly createdAt: number;
  /** Cada tag que ha tenido, con su vigencia; el último con `to: null` si sigue instalado. */
  readonly history: readonly { readonly tagId: string; readonly from: number; readonly to: number | null }[];
  readonly lastReview: { readonly at: number; readonly result: ManualResult; readonly note: string } | null;
}

export interface PhysicalPlan {
  readonly circuitId: string;
  /** El instante al que corresponde. */
  readonly at: number;
  /** La versión consolidada de la que nació. */
  readonly fromVersion: number;
  /** Las ubicaciones del anillo en orden; la última conecta con la primera. */
  readonly ring: readonly string[];
  /** Todas las ubicaciones abiertas en ese instante: anillo y salidas. */
  readonly locations: readonly PlanLocation[];
  /**
   * El primer identificador libre (`nextLocationId` de **todos** los eventos, cerradas incluidas),
   * para que las propuestas no reutilicen uno. Opcional: un plano construido a mano puede no traerlo.
   */
  readonly nextLocationId?: string;
}

// --- Reproducción de eventos -------------------------------------------------------------------------

interface MutableLocation {
  readonly locationId: string;
  readonly kind: LocationKind;
  tagId: string | null;
  readonly virtualTag: string | null;
  readonly branchFrom: string | null;
  readonly createdAt: number;
  readonly history: { tagId: string; from: number; to: number | null }[];
  lastReview: { readonly at: number; readonly result: ManualResult; readonly note: string } | null;
}

interface ReplayState {
  created: boolean;
  circuitId: string;
  fromVersion: number;
  ring: string[];
  /** Ubicaciones abiertas, en orden de creación. */
  readonly open: Map<string, MutableLocation>;
  readonly closed: Set<string>;
}

const MANUAL_RESULTS: readonly ManualResult[] = ["correcto", "averiado", "no-encontrado"];

/** El orden en que valen los eventos: fecha efectiva y, a igual fecha, orden de registro. */
function byEffect(a: PlanEvent, b: PlanEvent): number {
  return a.effectiveAt - b.effectiveAt || a.seq - b.seq;
}

function emptyState(): ReplayState {
  return { created: false, circuitId: "", fromVersion: 0, ring: [], open: new Map(), closed: new Set() };
}

function locationIdsOf(event: PlanEvent): readonly string[] {
  if (event.type === "crear-plano") return event.ring.map((entry) => entry.locationId);
  if (event.type === "crear-ubicacion") return [event.locationId];
  return [];
}

function installedIn(state: ReplayState, tagId: string): string | null {
  for (const location of state.open.values()) if (location.tagId === tagId) return location.locationId;
  return null;
}

/** La ubicación abierta que el evento nombra, o el motivo por el que no vale. */
function openLocation(state: ReplayState, locationId: string | null, role = "La ubicación"): MutableLocation | string {
  if (locationId === null || locationId === "") return `${role} no está indicada.`;
  const location = state.open.get(locationId);
  if (location !== undefined) return location;
  return state.closed.has(locationId) ? `${role} ${locationId} está cerrada.` : `${role} ${locationId} no existe en el plano en esa fecha.`;
}

/** ¿Vale el evento sobre este estado? El motivo en palabras si no. No toca el estado. */
function checkEvent(state: ReplayState, event: PlanEvent): string | null {
  if (typeof event.reason !== "string" || event.reason.trim() === "") return "La razón está vacía: todo cambio del plano lleva su justificación.";
  if (!Number.isFinite(event.effectiveAt)) return "La fecha efectiva no es válida.";
  if (event.type === "crear-plano") {
    if (state.created) return `El plano ya existe (creado desde la versión v${state.fromVersion}): no se crea dos veces.`;
    if (event.ring.length === 0) return "El plano necesita al menos una ubicación de anillo.";
    const ids = new Set<string>();
    const tags = new Set<string>();
    for (const entry of event.ring) {
      if (entry.locationId === "" || ids.has(entry.locationId)) return `La ubicación ${entry.locationId || "sin identificador"} se repite en el anillo inicial.`;
      if (entry.tagId === "" || tags.has(entry.tagId)) return `El tag ${entry.tagId || "vacío"} se repite en el anillo inicial.`;
      ids.add(entry.locationId);
      tags.add(entry.tagId);
    }
    return null;
  }
  if (!state.created) return "En esa fecha todavía no hay plano: el evento es anterior a su creación.";

  switch (event.type) {
    case "crear-ubicacion": {
      if (state.open.has(event.locationId) || state.closed.has(event.locationId)) return `El identificador ${event.locationId} ya se usó: no se reutiliza.`;
      if (event.kind === "anillo") {
        if (event.branchFrom !== null) return "Una ubicación de anillo no cuelga de otra: branchFrom tiene que ser null.";
        const after = openLocation(state, event.after, "La ubicación de delante");
        if (typeof after === "string") return after;
        if (after.kind !== "anillo") return `${after.locationId} es una salida: una ubicación de anillo va detrás de otra del anillo.`;
        return null;
      }
      if (event.kind !== "salida") return "Clase de ubicación desconocida.";
      if (event.after !== null) return "Una salida no va en el anillo: after tiene que ser null.";
      if (event.branchFrom === null) return "Una salida tiene que colgar de una ubicación del anillo (branchFrom).";
      const from = openLocation(state, event.branchFrom, "La ubicación de la que cuelga la salida");
      if (typeof from === "string") return from;
      if (from.kind !== "anillo") return `La salida cuelga de ${from.locationId}, que no es una ubicación del anillo.`;
      return null;
    }
    case "instalar":
    case "sustituir": {
      const location = openLocation(state, event.locationId);
      if (typeof location === "string") return location;
      if (typeof event.tagId !== "string" || event.tagId.trim() === "") return "Falta el código del tag.";
      if (event.type === "instalar" && location.tagId !== null) return `${location.locationId} ya tiene instalado ${location.tagId}: para cambiarlo, sustitúyelo.`;
      if (event.type === "sustituir" && location.tagId === null) return `${location.locationId} no tiene tag: para ponerle uno, instálalo.`;
      if (location.tagId === event.tagId) return `${location.locationId} ya tiene instalado ${event.tagId}.`;
      const other = installedIn(state, event.tagId);
      if (other !== null) return `${event.tagId} ya está instalado en ${other}.`;
      return null;
    }
    case "retirar": {
      const location = openLocation(state, event.locationId);
      if (typeof location === "string") return location;
      return location.tagId === null ? `${location.locationId} no tiene tag que retirar.` : null;
    }
    case "cerrar-ubicacion": {
      const location = openLocation(state, event.locationId);
      if (typeof location === "string") return location;
      if (location.kind === "anillo") {
        const hanging = [...state.open.values()].filter((entry) => entry.branchFrom === location.locationId).map((entry) => entry.locationId);
        if (hanging.length > 0) return `De ${location.locationId} cuelgan salidas (${hanging.join(", ")}): ciérralas antes.`;
        if (state.ring.length <= 1) return "No se puede cerrar la última ubicación del anillo.";
      }
      return null;
    }
    case "revision-manual": {
      const location = openLocation(state, event.locationId);
      if (typeof location === "string") return location;
      if (!MANUAL_RESULTS.includes(event.result)) return `Resultado de revisión desconocido: «${String(event.result)}».`;
      return typeof event.note === "string" ? null : "La nota de la revisión no es texto.";
    }
  }
}

/** Aplica un evento ya validado. */
function applyEvent(state: ReplayState, event: PlanEvent): void {
  const at = event.effectiveAt;
  const closeHistory = (location: MutableLocation): void => {
    const last = location.history[location.history.length - 1];
    if (last !== undefined && last.to === null) last.to = at;
  };
  switch (event.type) {
    case "crear-plano":
      state.created = true;
      state.circuitId = event.circuitId;
      state.fromVersion = event.fromVersion;
      for (const entry of event.ring) {
        state.open.set(entry.locationId, {
          locationId: entry.locationId,
          kind: "anillo",
          tagId: entry.tagId,
          virtualTag: null,
          branchFrom: null,
          createdAt: at,
          history: [{ tagId: entry.tagId, from: at, to: null }],
          lastReview: null,
        });
        state.ring.push(entry.locationId);
      }
      return;
    case "crear-ubicacion":
      state.open.set(event.locationId, {
        locationId: event.locationId,
        kind: event.kind,
        tagId: null,
        virtualTag: event.virtualTag,
        branchFrom: event.kind === "salida" ? event.branchFrom : null,
        createdAt: at,
        history: [],
        lastReview: null,
      });
      if (event.kind === "anillo") state.ring.splice(state.ring.indexOf(event.after as string) + 1, 0, event.locationId);
      return;
    case "instalar":
    case "sustituir": {
      const location = state.open.get(event.locationId) as MutableLocation;
      closeHistory(location);
      location.tagId = event.tagId;
      location.history.push({ tagId: event.tagId, from: at, to: null });
      return;
    }
    case "retirar": {
      const location = state.open.get(event.locationId) as MutableLocation;
      closeHistory(location);
      location.tagId = null;
      return;
    }
    case "cerrar-ubicacion": {
      const location = state.open.get(event.locationId) as MutableLocation;
      closeHistory(location);
      state.open.delete(event.locationId);
      state.closed.add(event.locationId);
      state.ring = state.ring.filter((id) => id !== event.locationId);
      return;
    }
    case "revision-manual": {
      const location = state.open.get(event.locationId) as MutableLocation;
      location.lastReview = { at, result: event.result, note: event.note };
      return;
    }
  }
}

/**
 * Recorre los eventos en orden de efecto hasta `until` (inclusive) y devuelve el estado y los que no
 * se pudieron aplicar, con su motivo. Un evento que no vale se salta: el plano nunca se construye a
 * medias sobre él (y `validateEvent` impide escribirlo).
 */
function replay(events: readonly PlanEvent[], until: (event: PlanEvent) => boolean): { readonly state: ReplayState; readonly errors: ReadonlyMap<number, string> } {
  const state = emptyState();
  const errors = new Map<number, string>();
  for (const event of [...events].sort(byEffect)) {
    if (!until(event)) break;
    const error = checkEvent(state, event);
    if (error !== null) {
      errors.set(event.seq, error);
      continue;
    }
    applyEvent(state, event);
  }
  return { state, errors };
}

function freeze(state: ReplayState, at: number): PhysicalPlan {
  const copy = (location: MutableLocation): PlanLocation => ({
    locationId: location.locationId,
    kind: location.kind,
    tagId: location.tagId,
    virtualTag: location.virtualTag,
    branchFrom: location.branchFrom,
    createdAt: location.createdAt,
    history: location.history.map((entry) => ({ ...entry })),
    lastReview: location.lastReview === null ? null : { ...location.lastReview },
  });
  const ringSet = new Set(state.ring);
  const locations = [
    ...state.ring.map((id) => copy(state.open.get(id) as MutableLocation)),
    ...[...state.open.values()].filter((location) => !ringSet.has(location.locationId)).map(copy),
  ];
  return { circuitId: state.circuitId, at, fromVersion: state.fromVersion, ring: [...state.ring], locations };
}

/** El plano vigente en `at`, o `null` si en ese instante aún no había plano. Los eventos, en cualquier orden. */
export function planAt(events: readonly PlanEvent[], at: number): PhysicalPlan | null {
  const { state } = replay(events, (event) => event.effectiveAt <= at);
  return state.created ? { ...freeze(state, at), nextLocationId: nextLocationId(events) } : null;
}

/**
 * ¿Se puede añadir este evento? Devuelve la razón en palabras si no: ubicación desconocida o
 * cerrada, tag ya instalado en otra ubicación abierta, instalar donde ya hay tag, sustituir o
 * retirar donde no lo hay, salida que cuelga de algo que no es anillo, razón vacía, plano repetido.
 *
 * Se comprueba en su fecha efectiva —con el plano que había entonces— y, como puede ser anterior a
 * eventos ya registrados, se comprueba también que ninguno de los posteriores deje de valer con él.
 */
export function validateEvent(events: readonly PlanEvent[], candidate: PlanEvent): string | null {
  if (typeof candidate.reason !== "string" || candidate.reason.trim() === "") return "La razón está vacía: todo cambio del plano lleva su justificación.";
  if (!Number.isInteger(candidate.seq) || candidate.seq < 1) return "El número de evento no es válido.";
  if (events.some((event) => event.seq === candidate.seq)) return `Ya hay un evento con el número ${candidate.seq}.`;
  if (events.some((event) => event.circuitId !== candidate.circuitId)) return "El evento es de otro circuito.";
  if (candidate.type === "crear-plano" && events.some((event) => event.type === "crear-plano")) return "El plano ya existe: no se crea dos veces.";
  const used = new Set(events.flatMap(locationIdsOf));
  const reused = locationIdsOf(candidate).find((id) => used.has(id));
  if (reused !== undefined) return `El identificador ${reused} ya se usó: no se reutiliza.`;

  const before = replay(events, () => true).errors;
  const after = replay([...events, candidate], () => true).errors;
  const own = after.get(candidate.seq);
  if (own !== undefined) return own;
  for (const event of [...events].sort(byEffect)) {
    const error = after.get(event.seq);
    if (error !== undefined && !before.has(event.seq)) {
      return `Deja sin valor un evento posterior (nº ${event.seq}: ${describeEvent(event)}): ${error}`;
    }
  }
  return null;
}

const LOCATION_ID = /^U-(\d+)$/;

function formatLocationId(number: number): string {
  return `U-${String(number).padStart(4, "0")}`;
}

/** El siguiente identificador de ubicación libre: `U-0001`, `U-0002`… sin reutilizar nunca uno. */
export function nextLocationId(events: readonly PlanEvent[]): string {
  let max = 0;
  for (const id of events.flatMap(locationIdsOf)) {
    const match = LOCATION_ID.exec(id);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return formatLocationId(max + 1);
}

/** El evento `crear-plano` desde una versión consolidada: su anillo, en orden, con ubicaciones nuevas. */
export function bootstrapPlan(
  version: ConsolidatedVersion,
  context: { readonly circuitId: string; readonly recordedAt: number; readonly reason: string },
): PlanEvent {
  // El plano nace del esperado de la versión, no de lo observado (3.55.0): un tag que no se leyó y cuyo
  // cambio no se adoptó sigue en el esperado, y por tanto en el plano.
  const ring = (version.expected ?? version.snapshot).ring.map((tagId, index) => ({ locationId: formatLocationId(index + 1), tagId }));
  return {
    type: "crear-plano",
    circuitId: context.circuitId,
    seq: 1,
    effectiveAt: version.basedOn.window.from,
    recordedAt: context.recordedAt,
    reason: context.reason,
    origin: "manual",
    evidence: {
      sourceId: version.basedOn.sourceId,
      fileName: version.basedOn.fileName,
      detail: `El anillo de la versión consolidada v${version.version}: ${ring.length} ${ring.length === 1 ? "tag" : "tags"} en orden${ring.length === 0 ? "" : `, desde ${ring[0]?.tagId}`}.`,
    },
    fromVersion: version.version,
    ring,
  };
}

/**
 * Una línea en palabras para el historial del plano. Con `events` (todos los del plano) nombra además
 * el tag que había antes de una sustitución o una retirada.
 */
export function describeEvent(event: PlanEvent, events: readonly PlanEvent[] = []): string {
  const previousTag = (): string | null => {
    if (events.length === 0) return null;
    const { state } = replay(events, (other) => byEffect(other, event) < 0);
    return state.open.get("locationId" in event ? event.locationId : "")?.tagId ?? null;
  };
  switch (event.type) {
    case "crear-plano": {
      const first = event.ring[0]?.locationId;
      const last = event.ring[event.ring.length - 1]?.locationId;
      return `Se crea el plano desde la versión v${event.fromVersion}: ${event.ring.length} ${event.ring.length === 1 ? "ubicación" : "ubicaciones"} de anillo${first === undefined ? "" : ` (${first}${first === last ? "" : `…${last}`})`}.`;
    }
    case "crear-ubicacion": {
      const virtual = event.virtualTag === null ? "" : `; el circuito virtual declara ${event.virtualTag}`;
      return event.kind === "anillo"
        ? `${event.locationId}: nueva ubicación de anillo detrás de ${event.after ?? "?"}${virtual}.`
        : `${event.locationId}: nueva salida que cuelga de ${event.branchFrom ?? "(sin elegir)"}${virtual}.`;
    }
    case "instalar":
      return `${event.locationId}: se instala ${event.tagId}.`;
    case "sustituir": {
      const old = previousTag();
      return old === null ? `${event.locationId}: se sustituye su tag por ${event.tagId}.` : `${event.locationId}: se sustituye ${old} por ${event.tagId}.`;
    }
    case "retirar": {
      const old = previousTag();
      return old === null ? `${event.locationId}: se retira su tag; la ubicación sigue, sin tag físico.` : `${event.locationId}: se retira ${old}; la ubicación sigue, sin tag físico.`;
    }
    case "cerrar-ubicacion":
      return `${event.locationId}: se cierra la ubicación.`;
    case "revision-manual":
      return `${event.locationId}: revisión manual, ${event.result}${event.note.trim() === "" ? "" : ` (${event.note.trim()})`}.`;
  }
}

// --- Observación de un fichero contra el plano (ADR-0016 §4) ----------------------------------------

export type LocationState =
  /** Su tag se leyó en las pasadas por su sitio. */
  | "observado"
  /** Hubo pasadas por su sitio y su tag no se leyó en ninguna: «no observado», no «desaparece». */
  | "no-observado"
  /** No hay prueba de que se pasara por su sitio en este fichero. */
  | "sin-ocasion"
  /** La ubicación no tiene tag físico: no hay oportunidad (R-OPP-011). */
  | "sin-tag"
  /** Salida: su estado es la última revisión manual, no las lecturas. */
  | "revision-manual";

export interface LocationObservation {
  readonly locationId: string;
  readonly kind: LocationKind;
  readonly tagId: string | null;
  readonly state: LocationState;
  /** `observed` si se leyó; `inferred` si se deduce el paso por sus vecinos; `confirmed` en una revisión manual; `unknown` sin ocasión. */
  readonly truth: TruthState;
  /** Oportunidades evaluables: pasadas probadas por su sitio (R-OPP-013). */
  readonly evaluable: number;
  readonly successes: number;
  readonly omissions: number;
  /** Pasadas que no se pudieron dar por buenas ni por malas; `null` si la instantánea no permite contarlas. */
  readonly uncertain: number | null;
  readonly detail: string;
}

export interface EdgeObservation {
  readonly fromLocation: string;
  readonly toLocation: string;
  /** `true` si salta ubicaciones del plano que no se leyeron: es una ruta, no una conexión del plano. */
  readonly composite: boolean;
  readonly produccion: Moments | null;
  readonly noche: Moments | null;
}

/** Un tag leído en el anillo del fichero que no está instalado en ninguna ubicación del plano. */
export interface UnplannedTag {
  readonly tagId: string;
  readonly readings: number;
  readonly passes: number;
  /** Las ubicaciones del plano entre las que se leyó, si se sabe. */
  readonly after: string | null;
  readonly before: string | null;
}

export interface PlanObservation {
  readonly sourceId: string;
  readonly fileName: string;
  readonly window: Interval;
  /** El plano con el que se interpretó: el vigente al final de la ventana del fichero. */
  readonly planAt: number;
  readonly locations: readonly LocationObservation[];
  readonly edges: readonly EdgeObservation[];
  readonly unplanned: readonly UnplannedTag[];
}

/** Los momentos de una horquilla, o `null` si no la hay o es de una instantánea anterior a 3.53.0 (sin media ni M2). */
function momentsOfBand(band: Band | null): Moments | null {
  if (band === null || band.meanMs === undefined || band.m2 === undefined) return null;
  return { n: band.samples, meanMs: band.meanMs, m2: band.m2 };
}

/** Las muestras de una arista, de los dos regímenes. */
function edgeSamples(edge: SnapshotEdge | undefined): number {
  if (edge === undefined) return 0;
  return (edge.produccion?.samples ?? 0) + (edge.noche?.samples ?? 0);
}

/** Las ubicaciones del anillo del plano estrictamente entre `from` y `to` (cíclico); con `from === to`, todas las demás. */
function ringBetweenLocations(ring: readonly string[], from: string, to: string): readonly string[] {
  const start = ring.indexOf(from);
  const end = ring.indexOf(to);
  if (start === -1 || end === -1) return [];
  const size = ring.length;
  const length = (end - start + size) % size || size;
  return Array.from({ length: length - 1 }, (_, step) => ring[(start + 1 + step) % size] as string);
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/**
 * El fichero leído con el plano (ADR-0016 §4). `plan` es el vigente al final de la ventana del
 * fichero (`planAt(eventos, snapshot.window.to)`).
 *
 * Por ubicación de anillo con tag, la prueba de paso por su sitio se busca en este orden:
 *
 * 1. **Sección entre anclas** (`anchorGaps`) que la contiene según el orden del **plano** entre sus
 *    dos anclas: las oportunidades son las pasadas completas de ancla a ancla, y los aciertos, en
 *    cuántas de ellas se leyó su tag.
 * 2. **Su vértice en el anillo del fichero**, con pasadas probadas (R-OPP-013): `readRate` es
 *    aciertos entre pasadas probadas (`read-matrix.ts`), así que `readRate × pasadas` son los aciertos.
 * 3. **Sus vecinos del plano más cercanos que sí se leyeron**, seguidos en el anillo del fichero —o
 *    con solo tags fuera del plano entre ellos—: las pasadas son las muestras de esa arista (o la
 *    menor de las aristas del camino) y la observación es inferida.
 * 4. Si nada de eso, **sin ocasión**: no hay prueba de que se pasara.
 *
 * Los inciertos se dan como `null` en las ubicaciones con tag: la instantánea no guarda cuántas
 * pasadas quedaron sin sostener (ni las cortadas de las secciones ni las `unproven` de la matriz), y
 * no se inventan. En una ubicación sin tag o en una salida no hay oportunidades, y son cero.
 */
export function observeAgainstPlan(plan: PhysicalPlan, snapshot: CircuitSnapshot): PlanObservation {
  const byId = new Map(plan.locations.map((location) => [location.locationId, location]));
  const ringLocationOfTag = new Map<string, string>();
  for (const id of plan.ring) {
    const tagId = byId.get(id)?.tagId ?? null;
    if (tagId !== null) ringLocationOfTag.set(tagId, id);
  }
  const installed = new Set(plan.locations.flatMap((location) => (location.tagId === null ? [] : [location.tagId])));
  const snapRing = snapshot.ring;
  const size = snapRing.length;
  const positionOf = new Map(snapRing.map((tagId, index) => [tagId, index]));
  const vertexOf = new Map(snapshot.vertices.map((vertex) => [vertex.tagId, vertex]));
  const edgeOf = new Map(snapshot.edges.map((edge) => [pairKey(edge.from, edge.to), edge]));

  // Qué sección entre anclas contiene cada ubicación, según el orden del plano.
  const gapOfLocation = new Map<string, SnapshotAnchorGap>();
  for (const gap of snapshot.anchorGaps) {
    if (gap.passes <= 0) continue;
    const from = ringLocationOfTag.get(gap.fromAnchor);
    const to = ringLocationOfTag.get(gap.toAnchor);
    if (from === undefined || to === undefined) continue;
    for (const id of ringBetweenLocations(plan.ring, from, to)) if (!gapOfLocation.has(id)) gapOfLocation.set(id, gap);
  }

  /** Los vecinos del plano más cercanos, a cada lado, cuyo tag está en el anillo del fichero. */
  const readNeighbours = (locationId: string): { readonly before: string; readonly after: string } | null => {
    const index = plan.ring.indexOf(locationId);
    const n = plan.ring.length;
    let before: string | null = null;
    let after: string | null = null;
    for (let step = 1; step < n && before === null; step += 1) {
      const id = plan.ring[(index - step + n) % n] as string;
      const tagId = byId.get(id)?.tagId ?? null;
      if (tagId !== null && positionOf.has(tagId)) before = id;
    }
    for (let step = 1; step < n && after === null; step += 1) {
      const id = plan.ring[(index + step) % n] as string;
      const tagId = byId.get(id)?.tagId ?? null;
      if (tagId !== null && positionOf.has(tagId)) after = id;
    }
    return before === null || after === null || before === after ? null : { before, after };
  };

  /** Las pasadas de `from` a `to` por el anillo del fichero si entre ellos solo hay tags fuera del plano. */
  const pathPasses = (fromTag: string, toTag: string): { readonly passes: number; readonly through: readonly string[] } | null => {
    const start = positionOf.get(fromTag);
    const end = positionOf.get(toTag);
    if (start === undefined || end === undefined || size < 2) return null;
    const steps = (end - start + size) % size;
    if (steps === 0) return null;
    const through: string[] = [];
    let passes = Number.POSITIVE_INFINITY;
    for (let step = 0; step < steps; step += 1) {
      const a = snapRing[(start + step) % size] as string;
      const b = snapRing[(start + step + 1) % size] as string;
      if (step > 0) {
        if (ringLocationOfTag.has(a)) return null;
        through.push(a);
      }
      passes = Math.min(passes, edgeSamples(edgeOf.get(pairKey(a, b))));
    }
    return { passes: Number.isFinite(passes) ? passes : 0, through };
  };

  const locations: LocationObservation[] = plan.locations.map((location): LocationObservation => {
    const base = { locationId: location.locationId, kind: location.kind, tagId: location.tagId };
    if (location.kind === "salida") {
      const review = location.lastReview;
      return {
        ...base,
        state: "revision-manual",
        truth: review === null ? "unknown" : "confirmed",
        evaluable: 0,
        successes: 0,
        omissions: 0,
        uncertain: 0,
        detail:
          review === null
            ? `Salida que cuelga de ${location.branchFrom ?? "?"}: no se recorre en ruta y no tiene ninguna revisión manual registrada.`
            : `Salida que cuelga de ${location.branchFrom ?? "?"}: última revisión el ${new Date(review.at).toISOString().slice(0, 10)}, ${review.result}${review.note.trim() === "" ? "" : ` (${review.note.trim()})`}.`,
      };
    }
    const tagId = location.tagId;
    if (tagId === null) {
      return {
        ...base,
        state: "sin-tag",
        truth: "expected",
        evaluable: 0,
        successes: 0,
        omissions: 0,
        uncertain: 0,
        detail:
          location.virtualTag === null
            ? "Ubicación sin tag físico: sin tag no hay oportunidad de lectura (R-OPP-011)."
            : `Ubicación sin tag físico; el circuito virtual declara ${location.virtualTag} aquí. Sin tag no hay oportunidad de lectura (R-OPP-011).`,
      };
    }

    const counted = (evaluable: number, successes: number, detail: string): LocationObservation => ({
      ...base,
      state: successes > 0 ? "observado" : evaluable > 0 ? "no-observado" : "sin-ocasion",
      truth: successes > 0 ? "observed" : evaluable > 0 ? "inferred" : "unknown",
      evaluable,
      successes,
      omissions: evaluable - successes,
      uncertain: null,
      detail,
    });

    const gap = gapOfLocation.get(location.locationId);
    if (gap !== undefined) {
      const successes = Math.min(gap.passes, gap.readsByTag[tagId]?.passes ?? 0);
      return counted(
        gap.passes,
        successes,
        `${tagId} se leyó en ${successes} de ${plural(gap.passes, "pasada completa", "pasadas completas")} entre las anclas ${gap.fromAnchor} y ${gap.toAnchor}.`,
      );
    }

    const vertex = vertexOf.get(tagId);
    if (vertex !== undefined && vertex.position !== null && vertex.passes > 0) {
      const successes = Math.min(vertex.passes, Math.round((vertex.readRate ?? 0) * vertex.passes));
      return counted(vertex.passes, successes, `${tagId} se leyó en ${successes} de ${plural(vertex.passes, "pasada probada", "pasadas probadas")} por su sitio.`);
    }

    const unread = vertex === undefined || vertex.readings === 0;
    const neighbours = unread ? readNeighbours(location.locationId) : null;
    if (neighbours !== null) {
      const beforeTag = byId.get(neighbours.before)?.tagId as string;
      const afterTag = byId.get(neighbours.after)?.tagId as string;
      const path = pathPasses(beforeTag, afterTag);
      if (path !== null && path.passes > 0) {
        const between = path.through.length === 0 ? "seguidos" : `con ${path.through.join(", ")} en medio, fuera del plano`;
        return counted(
          path.passes,
          0,
          `${tagId} no se leyó; sus vecinos del plano ${beforeTag} (${neighbours.before}) y ${afterTag} (${neighbours.after}) sí, ${between} en el anillo del fichero: ${plural(path.passes, "pasada", "pasadas")} entre ellos.`,
        );
      }
    }

    return {
      ...base,
      state: "sin-ocasion",
      truth: "unknown",
      evaluable: 0,
      successes: 0,
      omissions: 0,
      uncertain: null,
      detail:
        vertex !== undefined && vertex.readings > 0
          ? `${tagId} se leyó ${plural(vertex.readings, "vez", "veces")} fuera del anillo del fichero: no hay pasadas probadas por su sitio.`
          : `No hay prueba de que se pasara por el sitio de ${tagId} en este fichero.`,
    };
  });

  const edges: EdgeObservation[] = [];
  if (size >= 2) {
    const planSize = plan.ring.length;
    snapRing.forEach((from, index) => {
      const to = snapRing[(index + 1) % size] as string;
      const fromLocation = ringLocationOfTag.get(from);
      const toLocation = ringLocationOfTag.get(to);
      const edge = edgeOf.get(pairKey(from, to));
      if (fromLocation === undefined || toLocation === undefined || edge === undefined || fromLocation === toLocation) return;
      const consecutive = (plan.ring.indexOf(fromLocation) + 1) % planSize === plan.ring.indexOf(toLocation);
      edges.push({ fromLocation, toLocation, composite: !consecutive, produccion: momentsOfBand(edge.produccion), noche: momentsOfBand(edge.noche) });
    });
  }

  const nearestPlanned = (index: number, direction: 1 | -1): string | null => {
    for (let step = 1; step < size; step += 1) {
      const tagId = snapRing[(((index + direction * step) % size) + size) % size] as string;
      const id = ringLocationOfTag.get(tagId);
      if (id !== undefined) return id;
    }
    return null;
  };
  const unplanned: UnplannedTag[] = snapRing.flatMap((tagId, index) => {
    if (installed.has(tagId)) return [];
    const vertex = vertexOf.get(tagId);
    return [{ tagId, readings: vertex?.readings ?? 0, passes: vertex?.passes ?? 0, after: nearestPlanned(index, -1), before: nearestPlanned(index, 1) }];
  });

  return {
    sourceId: snapshot.sourceId,
    fileName: snapshot.fileName,
    window: { from: snapshot.window.from, to: snapshot.window.to },
    planAt: plan.at,
    locations,
    edges,
    unplanned,
  };
}

// --- Propuestas de cambio (solo propuestas: las confirma una persona) --------------------------------

export type ProposalKind =
  /** Un código se lee entre dos ubicaciones y no está instalado en ninguna. */
  | "tag-nuevo"
  /** Un código nuevo aparece donde una ubicación deja de leerse, con los mismos vecinos. */
  | "sustitucion"
  /** Un tag de parada por salida de circuito (lista `critico`, función `parada`) sin ubicación en el plano. */
  | "salida-sin-ubicar";

export interface PlanProposal {
  /** Estable entre análisis del mismo fichero: `tipo|tag|ubicación`. */
  readonly id: string;
  readonly kind: ProposalKind;
  readonly title: string;
  readonly detail: string;
  readonly evidence: PlanEvidence;
  /**
   * Los eventos que se escribirían al confirmarla, en orden (una ubicación nueva va con su
   * `instalar`). En `salida-sin-ubicar` falta `branchFrom`: lo elige la persona.
   */
  readonly events: readonly PlanEventInput[];
}

/** Cuántos AGV distintos leyeron un tag en las secciones entre anclas, o `null` si ninguna lo dice. */
function vehiclesReading(snapshot: CircuitSnapshot, tagId: string): number | null {
  let most: number | null = null;
  for (const gap of snapshot.anchorGaps) {
    const entry = gap.readsByTag[tagId];
    if (entry !== undefined) most = Math.max(most ?? 0, entry.vehicles);
  }
  return most;
}

/**
 * Lo que el Worker propone cambiar en el plano, con su evidencia. **Solo propone**: ninguna se
 * escribe sin que una persona la confirme (ADR-0016 §3).
 *
 * - **sustitucion**: entre dos ubicaciones leídas A y B hay exactamente un código fuera del plano y
 *   exactamente una ubicación del plano no observada con pasadas por su sitio.
 * - **tag-nuevo**: el resto de códigos fuera del plano leídos por al menos `minVehicles` AGV
 *   distintos (R-DAT-021). Los AGV salen de `readsByTag` de las secciones entre anclas; si la
 *   instantánea no lo dice, **no se propone**: no se sabe si lo sostiene más de un lector.
 *   La ubicación nueva va detrás de la ubicación planificada más cercana antes de él en el anillo del
 *   fichero, que ya existe; así cada propuesta se puede aceptar sola y en cualquier orden, y varios
 *   seguidos quedan en el orden del fichero (cada uno se inserta justo detrás de la anterior leída).
 * - **salida-sin-ubicar**: un tag de parada por salida de circuito declarado sin ubicación ni código
 *   virtual en el plano. Falta `branchFrom`, que elige la persona al aceptar.
 *
 * Los tags declarados como salida no se proponen como tag nuevo ni como sustitución del anillo.
 */
export function proposeChanges(
  plan: PhysicalPlan,
  observation: PlanObservation,
  snapshot: CircuitSnapshot,
  context: {
    /** Tags de parada por salida de circuito declarados (lista `critico`, función `parada`). */
    readonly declaredExits: readonly string[];
    /** AGV distintos que tienen que leer un código para proponerlo (el mismo criterio que R-DAT-021). */
    readonly minVehicles: number;
  },
): readonly PlanProposal[] {
  const byId = new Map(plan.locations.map((location) => [location.locationId, location]));
  const observed = new Map(observation.locations.map((entry) => [entry.locationId, entry]));
  const exits = new Set(context.declaredExits);
  const effectiveAt = snapshot.window.from;
  const evidence = (detail: string): PlanEvidence => ({ sourceId: snapshot.sourceId, fileName: snapshot.fileName, detail });
  const tagOf = (id: string | null): string => (id === null ? "?" : (byId.get(id)?.tagId ?? "sin tag"));
  const where = (id: string | null): string => (id === null ? "?" : `${id} (${tagOf(id)})`);
  const agvText = (vehicles: number | null): string => (vehicles === null ? "" : ` por ${plural(vehicles, "AGV distinto", "AGV distintos")}`);

  // Identificadores nuevos, progresivos en toda la lista para que ninguna propuesta enseñe el de otra.
  // `plan.nextLocationId` sale de todos los eventos (cerradas incluidas); sin él, de las abiertas.
  const firstFree = plan.nextLocationId ?? formatLocationId(Math.max(0, ...plan.locations.map((location) => Number(LOCATION_ID.exec(location.locationId)?.[1] ?? 0))) + 1);
  let nextNumber = Number(LOCATION_ID.exec(firstFree)?.[1] ?? "1");
  const allocate = (): string => formatLocationId(nextNumber++);

  const substitutions: PlanProposal[] = [];
  const newTags: PlanProposal[] = [];
  const consumed = new Set<string>();

  const groups = new Map<string, UnplannedTag[]>();
  for (const entry of observation.unplanned) {
    if (exits.has(entry.tagId)) continue;
    const key = `${entry.after ?? ""}\u0000${entry.before ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    const first = group[0] as UnplannedTag;
    if (group.length !== 1 || first.after === null || first.before === null) continue;
    const silent = ringBetweenLocations(plan.ring, first.after, first.before).filter((id) => {
      const entry = observed.get(id);
      return entry !== undefined && entry.state === "no-observado" && entry.evaluable > 0;
    });
    if (silent.length !== 1) continue;
    const locationId = silent[0] as string;
    const old = observed.get(locationId) as LocationObservation;
    const vehicles = vehiclesReading(snapshot, first.tagId);
    const detail =
      `${first.tagId} se leyó en ${plural(first.passes, "pasada", "pasadas")}${agvText(vehicles)} entre ${where(first.after)} y ${where(first.before)}, ` +
      `y ${old.tagId ?? "su tag"}, instalado en ${locationId} entre esas dos ubicaciones, no se leyó en ninguna de ${plural(old.evaluable, "pasada", "pasadas")} por su sitio.`;
    consumed.add(first.tagId);
    substitutions.push({
      id: `sustitucion|${first.tagId}|${locationId}`,
      kind: "sustitucion",
      title: `Sustitución en ${locationId}: ${first.tagId} en lugar de ${old.tagId ?? "su tag"}`,
      detail,
      evidence: evidence(detail),
      events: [{ type: "sustituir", locationId, tagId: first.tagId, effectiveAt, evidence: evidence(detail) }],
    });
  }

  for (const entry of observation.unplanned) {
    if (exits.has(entry.tagId) || consumed.has(entry.tagId) || entry.after === null) continue;
    const vehicles = vehiclesReading(snapshot, entry.tagId);
    if (vehicles === null || vehicles < context.minVehicles) continue;
    const locationId = allocate();
    const detail =
      `${entry.tagId} se leyó en ${plural(entry.passes, "pasada", "pasadas")}${agvText(vehicles)} entre ${where(entry.after)} y ${where(entry.before)}, ` +
      `y no está instalado en ninguna ubicación del plano.`;
    newTags.push({
      id: `tag-nuevo|${entry.tagId}|${entry.after}`,
      kind: "tag-nuevo",
      title: `Tag nuevo ${entry.tagId} detrás de ${entry.after}`,
      detail,
      evidence: evidence(detail),
      events: [
        { type: "crear-ubicacion", locationId, kind: "anillo", after: entry.after, branchFrom: null, virtualTag: null, effectiveAt, evidence: evidence(detail) },
        { type: "instalar", locationId, tagId: entry.tagId, effectiveAt, evidence: evidence(detail) },
      ],
    });
  }

  const placed = new Set(plan.locations.flatMap((location) => [location.tagId, location.virtualTag].filter((tagId): tagId is string => tagId !== null)));
  const vertexOf = new Map(snapshot.vertices.map((vertex) => [vertex.tagId, vertex]));
  const exitProposals: PlanProposal[] = [...new Set(context.declaredExits)]
    .filter((tagId) => tagId !== "" && !placed.has(tagId))
    .sort()
    .map((tagId) => {
      const vertex = vertexOf.get(tagId);
      const seen =
        vertex === undefined || vertex.readings === 0
          ? "No se lee en este fichero, como es normal en una salida."
          : `Se leyó ${plural(vertex.readings, "vez", "veces")} en este fichero.`;
      const detail =
        `${tagId} está en la lista «critico» con función «parada» (parada por salida de circuito) y no tiene ubicación en el plano. ` +
        `${seen} Elige de qué ubicación del anillo cuelga; su estado será la revisión manual.`;
      const locationId = allocate();
      return {
        id: `salida-sin-ubicar|${tagId}|-`,
        kind: "salida-sin-ubicar" as const,
        title: `Salida sin ubicar: ${tagId}`,
        detail,
        evidence: evidence(detail),
        events: [
          { type: "crear-ubicacion" as const, locationId, kind: "salida" as const, after: null, branchFrom: null, virtualTag: null, effectiveAt, evidence: evidence(detail) },
          { type: "instalar" as const, locationId, tagId, effectiveAt, evidence: evidence(detail) },
        ],
      };
    });

  return [...substitutions, ...newTags, ...exitProposals];
}

// --- Resúmenes por periodo (ADR-0016 §6) --------------------------------------------------------------

export interface OpportunityCounts {
  readonly evaluable: number;
  readonly successes: number;
  readonly omissions: number;
  /** `null` si algún periodo no permitió contarlos: la suma no se inventa. */
  readonly uncertain: number | null;
}

export interface LocationSummary {
  readonly locationId: string;
  readonly kind: LocationKind;
  /** El tag vigente en el último periodo. */
  readonly tagId: string | null;
  readonly periods: readonly (OpportunityCounts & {
    readonly sourceId: string;
    readonly fileName: string;
    readonly window: Interval;
    readonly tagId: string | null;
    readonly state: LocationState;
  })[];
  readonly total: OpportunityCounts;
}

export interface EdgeSummary {
  readonly fromLocation: string;
  readonly toLocation: string;
  readonly composite: boolean;
  readonly produccion: Moments | null;
  readonly noche: Moments | null;
  /** En cuántos periodos se midió. */
  readonly periods: number;
}

/** Suma las observaciones de varios ficheros por ubicación y por conexión, con `combineMoments`. */
export function summarizePlan(observations: readonly PlanObservation[]): {
  readonly locations: readonly LocationSummary[];
  readonly edges: readonly EdgeSummary[];
} {
  const ordered = [...observations].sort((a, b) => a.window.from - b.window.from || a.window.to - b.window.to || a.sourceId.localeCompare(b.sourceId));
  const periodsOf = new Map<string, { kind: LocationKind; periods: LocationSummary["periods"][number][] }>();
  const edgesOf = new Map<string, { fromLocation: string; toLocation: string; composite: boolean; produccion: Moments | null; noche: Moments | null; periods: number }>();
  const merge = (a: Moments | null, b: Moments | null): Moments | null => (a === null ? b : b === null ? a : combineMoments(a, b));

  for (const observation of ordered) {
    for (const location of observation.locations) {
      const entry = periodsOf.get(location.locationId) ?? { kind: location.kind, periods: [] };
      entry.kind = location.kind;
      entry.periods.push({
        sourceId: observation.sourceId,
        fileName: observation.fileName,
        window: observation.window,
        tagId: location.tagId,
        state: location.state,
        evaluable: location.evaluable,
        successes: location.successes,
        omissions: location.omissions,
        uncertain: location.uncertain,
      });
      periodsOf.set(location.locationId, entry);
    }
    for (const edge of observation.edges) {
      const key = `${edge.fromLocation}\u0000${edge.toLocation}\u0000${edge.composite ? "1" : "0"}`;
      const entry = edgesOf.get(key) ?? { fromLocation: edge.fromLocation, toLocation: edge.toLocation, composite: edge.composite, produccion: null, noche: null, periods: 0 };
      entry.produccion = merge(entry.produccion, edge.produccion);
      entry.noche = merge(entry.noche, edge.noche);
      if (edge.produccion !== null || edge.noche !== null) entry.periods += 1;
      edgesOf.set(key, entry);
    }
  }

  const locations: LocationSummary[] = [...periodsOf.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([locationId, entry]) => {
      const total = entry.periods.reduce<OpportunityCounts>(
        (sum, period) => ({
          evaluable: sum.evaluable + period.evaluable,
          successes: sum.successes + period.successes,
          omissions: sum.omissions + period.omissions,
          uncertain: sum.uncertain === null || period.uncertain === null ? null : sum.uncertain + period.uncertain,
        }),
        { evaluable: 0, successes: 0, omissions: 0, uncertain: 0 },
      );
      return { locationId, kind: entry.kind, tagId: entry.periods[entry.periods.length - 1]?.tagId ?? null, periods: entry.periods, total };
    });
  const edges: EdgeSummary[] = [...edgesOf.values()].sort(
    (a, b) => a.fromLocation.localeCompare(b.fromLocation) || a.toLocation.localeCompare(b.toLocation) || Number(a.composite) - Number(b.composite),
  );
  return { locations, edges };
}

/**
 * La evolución leída con el plano (ADR-0016 §4): un «desaparece» de un tag instalado en una
 * ubicación del plano pasa a «no-observado», con las pasadas por su sitio en el detalle. Lo demás
 * queda igual.
 */
export function reinterpretDelta(delta: SnapshotDelta, observationAfter: PlanObservation | null): SnapshotDelta {
  const byTag = new Map(
    (observationAfter?.locations ?? [])
      .filter((entry) => entry.tagId !== null && (entry.state === "no-observado" || entry.state === "sin-ocasion"))
      .map((entry) => [entry.tagId as string, entry]),
  );
  return {
    ...delta,
    vertices: delta.vertices.map((vertex) => {
      const location = vertex.kind === "desaparece" ? byTag.get(vertex.tagId) : undefined;
      if (location === undefined) return { ...vertex };
      const passes =
        location.state === "no-observado" ? `${plural(location.evaluable, "pasada", "pasadas")} por su sitio sin leerlo` : "sin prueba de paso por su sitio";
      return { ...vertex, kind: "no-observado" as const, detail: `${vertex.tagId} sigue en su ubicación ${location.locationId}; ${passes}.` };
    }),
    edges: [...delta.edges],
  };
}

// --- Plano entrante de un `.agvproj` -------------------------------------------------------------------

/**
 * Relación entre los eventos del plano locales y los de un `.agvproj` (append-only, R-MEM-002): se
 * comparan por `seq` y contenido. `missing` son los entrantes que faltan aquí; solo se añaden cuando
 * el local es prefijo del entrante (o está vacío). Dos historiales distintos no se mezclan.
 */
export type PlanRelation = "sin-plano" | "identico" | "local-adelantado" | "entrante-adelantado" | "distinto";

export function classifyPlanEvents(
  local: readonly PlanEvent[],
  incoming: readonly PlanEvent[],
): { readonly relation: PlanRelation; readonly missing: readonly PlanEvent[] } {
  const bySeq = (events: readonly PlanEvent[]): readonly PlanEvent[] => [...events].sort((a, b) => a.seq - b.seq);
  const mine = bySeq(local);
  const theirs = bySeq(incoming);
  if (theirs.length === 0) return { relation: "sin-plano", missing: [] };
  const shared = Math.min(mine.length, theirs.length);
  for (let index = 0; index < shared; index += 1) {
    if (canonicalise(mine[index]) !== canonicalise(theirs[index])) return { relation: "distinto", missing: [] };
  }
  if (mine.length === theirs.length) return { relation: "identico", missing: [] };
  if (mine.length > theirs.length) return { relation: "local-adelantado", missing: [] };
  return { relation: "entrante-adelantado", missing: theirs.slice(mine.length) };
}
