/**
 * La memoria consolidada del circuito (F4; ADR-0005, ADR-0015 §4, R-MEM-001..003).
 *
 * Una **versión** es una instantánea revisada que una persona eligió como referencia del circuito:
 * el «esperado» contra el que se comparan los ficheros siguientes. Se escribe **append-only**:
 * vN+1 nunca toca vN; un error se corrige con una revocación que apunta a la versión afectada y una
 * versión nueva, y el historial y la razón permanecen visibles (`MEMORY_CONSOLIDATION.md` §7).
 * Ninguna IA consolida: `consolidate` solo se llama tras la confirmación humana del flujo de §6.
 *
 * Este fichero fija el **contrato** (tipos y firmas). Los campos se añaden, no se renombran; cambiar
 * uno es subir `MEMORY_SCHEMA_VERSION` y escribir su migración.
 */

import type { ClassifiedChange, IncidentRecord } from "./change-class.js";
import type { ReviewEntry, ReviewState } from "./review.js";
import { semanticHash } from "./semantic-hash.js";
import { compareSnapshots, type CircuitSnapshot, type SnapshotDelta } from "./snapshot.js";
import type { TagChangeThresholds } from "./tag-changes.js";

export const MEMORY_SCHEMA_VERSION = 1;

/** Un hallazgo del periodo con la decisión humana que llevaba al consolidar (R-EVI-007). */
export interface MemoryDecision {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly figure: string;
  readonly state: ReviewState;
  readonly note: string | null;
}

export interface ConsolidatedVersion {
  readonly schemaVersion: number;
  readonly circuitId: string;
  /** 1, 2, 3… en orden de creación dentro del linaje. */
  readonly version: number;
  readonly createdAt: number;
  /** El fichero del que sale la instantánea consolidada. */
  readonly basedOn: {
    readonly sourceId: string;
    readonly sourceHash: string;
    readonly fileName: string;
    readonly window: { readonly from: number; readonly to: number };
  };
  /** Cadena de hashes (`MEMORY_CONSOLIDATION.md` §10): el de la versión anterior del linaje, o `null` en la primera. */
  readonly previousHash: string | null;
  /** Hash semántico del contenido de esta versión sin este campo (INV-010). */
  readonly hash: string;
  /** Identificador del linaje: el dispositivo que consolidó. Dos linajes distintos son una bifurcación. */
  readonly lineage: string;
  /** El grafo consolidado: la instantánea elegida, tal cual. */
  readonly snapshot: CircuitSnapshot;
  /** Lo que cambia frente a la versión anterior no revocada; `null` en la primera. */
  readonly delta: SnapshotDelta | null;
  /** Los hallazgos con su decisión: confirmados, descartados y pospuestos con su motivo. */
  readonly decisions: readonly MemoryDecision[];
  /** Justificación humana de la consolidación, opcional. */
  readonly note: string | null;
  readonly revoked: { readonly at: number; readonly reason: string } | null;
  /**
   * El esperado que deja esta versión (§8, OQ-146..148): lo observado salvo los cambios no adoptados
   * y lo que toca una incidencia. Ausente en las versiones anteriores a 3.55.0, que usan `snapshot`.
   */
  readonly expected?: CircuitSnapshot;
  /** Los cambios frente al esperado anterior, con su clase. */
  readonly changes?: readonly ClassifiedChange[];
  /** Las incidencias del periodo, guardadas aparte del esperado (R-INC-001). */
  readonly incidents?: readonly IncidentRecord[];
  /** Versión de la aplicación que consolidó. */
  readonly appVersion: string;
}

export type BlockerCode =
  /** Hay hallazgos sin revisar: solo bloquea lo pendiente (propietario, 2026-09-23). */
  | "hallazgos-pendientes"
  /** Hay hallazgos de rango 1 confirmados: es un periodo de incidencia, no memoria normal (§6, §8). */
  | "periodo-de-incidencia"
  /** El fichero elegido no tiene instantánea. */
  | "sin-instantanea"
  /** Ya hay una versión no revocada basada en ese mismo fichero (INV-007). */
  | "ya-consolidada"
  /** Hay una bifurcación de linaje sin resolver (§10). */
  | "bifurcacion-sin-resolver";

export interface ConsolidationBlocker {
  readonly code: BlockerCode;
  readonly detail: string;
  /** Claves de hallazgo, identificadores de fichero o versiones implicadas. */
  readonly items: readonly string[];
}

export interface ConsolidationPreview {
  readonly basedOn: ConsolidatedVersion["basedOn"];
  /** La versión vigente (última no revocada) o `null`. */
  readonly previous: ConsolidatedVersion | null;
  readonly nextVersion: number;
  readonly delta: SnapshotDelta | null;
  readonly blockers: readonly ConsolidationBlocker[];
  /** Avisos que no bloquean: pospuestos que volverán como pendientes, descartados, etc. */
  readonly warnings: readonly string[];
  readonly decisions: readonly MemoryDecision[];
  /** Tamaño estimado de la versión, en bytes, para el presupuesto (§9). */
  readonly estimatedBytes: number;
  /** Los cambios frente al esperado vigente con su clase; vacío en la primera versión. */
  readonly changes?: readonly ClassifiedChange[];
  /** Las incidencias que se excluirán del esperado (OQ-148). */
  readonly incidents?: readonly IncidentRecord[];
}

export interface ConsolidationInput {
  readonly snapshot: CircuitSnapshot;
  /** Las marcas de revisión del circuito, por clave. */
  readonly reviews: ReadonlyMap<string, ReviewEntry>;
  /** Todas las versiones guardadas, revocadas incluidas, en orden. */
  readonly versions: readonly ConsolidatedVersion[];
  /** Rango de cada tipo de hallazgo (1 puede parar la planta, 2 degrada, 3 limpieza). */
  readonly rankOf: (kind: string) => number;
  /** `true` si hay una bifurcación de linaje sin resolver (§10). */
  readonly forkUnresolved: boolean;
  readonly thresholds: Pick<TagChangeThresholds, "maxChance">;
}

/** Los hallazgos de la instantánea cruzados con la revisión: la decisión que llevaba cada uno (R-EVI-007). */
function decisionsOf(snapshot: CircuitSnapshot, reviews: ReadonlyMap<string, ReviewEntry>): readonly MemoryDecision[] {
  return snapshot.findings.map((finding) => {
    const review = reviews.get(finding.key);
    return {
      key: finding.key,
      kind: finding.kind,
      title: finding.title,
      figure: finding.figure,
      // «Pendiente» no se guarda como marca (`review.ts`): es la ausencia de decisión.
      state: review?.state ?? "pendiente",
      note: review === undefined || review.note.trim() === "" ? null : review.note,
    };
  });
}

/** El número que le toca a la siguiente versión: uno más que la mayor guardada, revocadas incluidas. */
function nextVersionNumber(versions: readonly ConsolidatedVersion[]): number {
  return versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
}

/**
 * Qué pasaría al consolidar: la previsualización de vN+1 (§6, paso E). No escribe nada.
 *
 * Bloquea **solo lo pendiente** (propietario, 2026-09-23): un hallazgo confirmado, descartado o
 * pospuesto no impide consolidar. Lo pospuesto pasa con su motivo y con aviso de que volverá como
 * pendiente en el periodo siguiente. Un hallazgo de rango 1 confirmado convierte el periodo en una
 * incidencia (§6, §8) y sí bloquea: la memoria normal no aprende de un periodo anómalo (ADR-0005).
 */
export function previewConsolidation(input: ConsolidationInput): ConsolidationPreview {
  const { snapshot, versions } = input;
  const decisions = decisionsOf(snapshot, input.reviews);
  const previous = currentVersion(versions);
  const blockers: ConsolidationBlocker[] = [];
  const warnings: string[] = [];

  const pending = decisions.filter((decision) => decision.state === "pendiente");
  if (pending.length > 0) {
    blockers.push({
      code: "hallazgos-pendientes",
      detail: `${pending.length} ${pending.length === 1 ? "hallazgo sigue" : "hallazgos siguen"} sin revisar. Solo bloquea lo pendiente: confirma, descarta o pospón cada uno.`,
      items: pending.map((decision) => decision.key),
    });
  }

  const incident = decisions.filter((decision) => decision.state === "confirmado" && input.rankOf(decision.kind) === 1);
  if (incident.length > 0) {
    blockers.push({
      code: "periodo-de-incidencia",
      detail: `${incident.length} ${incident.length === 1 ? "hallazgo confirmado" : "hallazgos confirmados"} de rango 1: el periodo es una incidencia, no memoria normal. Trátalo como incidencia o descarta lo que no lo sea.`,
      items: incident.map((decision) => decision.key),
    });
  }

  const twin = versions.filter((version) => version.revoked === null && version.basedOn.sourceHash === snapshot.sourceHash);
  if (twin.length > 0) {
    blockers.push({
      code: "ya-consolidada",
      detail: `Ya existe una versión vigente basada en este mismo fichero (v${twin.map((version) => version.version).join(", v")}). Para corregirla, revócala y consolida de nuevo.`,
      items: twin.map((version) => `v${version.version}`),
    });
  }

  if (input.forkUnresolved) {
    blockers.push({
      code: "bifurcacion-sin-resolver",
      detail: "Hay una bifurcación de linaje sin resolver: elige qué memoria conservar antes de consolidar.",
      items: [],
    });
  }

  const postponed = decisions.filter((decision) => decision.state === "pospuesto");
  if (postponed.length > 0) {
    const motives = postponed.map((decision) => `${decision.title}${decision.note === null ? "" : ` (${decision.note})`}`);
    warnings.push(
      `${postponed.length} ${postponed.length === 1 ? "hallazgo pospuesto se consolida" : "hallazgos pospuestos se consolidan"} con su motivo y ${postponed.length === 1 ? "volverá" : "volverán"} como ${postponed.length === 1 ? "pendiente" : "pendientes"} en el periodo siguiente: ${motives.join("; ")}.`,
    );
  }
  const discarded = decisions.filter((decision) => decision.state === "descartado").length;
  if (discarded > 0) {
    warnings.push(`${discarded} ${discarded === 1 ? "hallazgo descartado queda" : "hallazgos descartados quedan"} en la versión con su decisión, sin cambiar el análisis.`);
  }

  const basedOn: ConsolidatedVersion["basedOn"] = {
    sourceId: snapshot.sourceId,
    sourceHash: snapshot.sourceHash,
    fileName: snapshot.fileName,
    window: { from: snapshot.window.from, to: snapshot.window.to },
  };
  const delta = previous === null ? null : compareSnapshots(previous.snapshot, snapshot, input.thresholds);
  const nextVersion = nextVersionNumber(versions);

  // El tamaño se estima sobre una versión provisional con el hash vacío: el hash real tiene siempre
  // la misma longitud, así que la diferencia es de decenas de bytes.
  const provisional: ConsolidatedVersion = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    circuitId: snapshot.circuitId,
    version: nextVersion,
    createdAt: 0,
    basedOn,
    previousHash: previous?.hash ?? null,
    hash: "",
    lineage: "",
    snapshot,
    delta,
    decisions,
    note: null,
    revoked: null,
    appVersion: "",
  };

  return { basedOn, previous, nextVersion, delta, blockers, warnings, decisions, estimatedBytes: versionBytes(provisional) };
}

/**
 * Una previsualización que solo dice que el fichero no tiene instantánea (`sin-instantanea`): el
 * Worker la emite cuando la fuente existe pero su instantánea no se pudo construir o es anterior a
 * la versión 6 del almacén. Volver a cargar el fichero la crea.
 */
export function previewWithoutSnapshot(
  basedOn: ConsolidatedVersion["basedOn"],
  versions: readonly ConsolidatedVersion[],
): ConsolidationPreview {
  return {
    basedOn,
    previous: currentVersion(versions),
    nextVersion: nextVersionNumber(versions),
    delta: null,
    blockers: [
      {
        code: "sin-instantanea",
        detail: `El fichero «${basedOn.fileName}» no tiene instantánea guardada. Vuelve a cargarlo para crearla.`,
        items: [basedOn.sourceId],
      },
    ],
    warnings: [],
    decisions: [],
    estimatedBytes: 0,
  };
}

/**
 * El hash de una versión: el hash semántico (INV-010) de su contenido **con `hash: ""`** y tal como
 * nació (`revoked: null`). Se calcula una vez, al consolidar; revocarla no lo cambia, que es lo que
 * permite que dos dispositivos comparen sus cadenas aunque uno haya revocado algo.
 */
export async function versionHash(version: ConsolidatedVersion): Promise<string> {
  return semanticHash({ ...version, hash: "", revoked: null });
}

/**
 * Escribe la versión vN+1 en memoria (no en el almacén): solo tras la confirmación humana (§6,
 * paso G). Lanza si la previsualización tiene bloqueos. El `hash` sale del hash semántico del
 * contenido y `previousHash` del vigente.
 */
export async function consolidate(
  preview: ConsolidationPreview,
  context: { readonly circuitId: string; readonly snapshot: CircuitSnapshot; readonly lineage: string; readonly appVersion: string; readonly now: number; readonly note: string | null },
): Promise<ConsolidatedVersion> {
  if (preview.blockers.length > 0) {
    throw new Error(`No se puede consolidar: ${preview.blockers.map((blocker) => blocker.code).join(", ")}.`);
  }
  if (context.snapshot.sourceHash !== preview.basedOn.sourceHash) {
    throw new Error("La instantánea no es la de la previsualización: la consolidación se rehace desde el principio.");
  }
  const unhashed: ConsolidatedVersion = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    circuitId: context.circuitId,
    version: preview.nextVersion,
    createdAt: context.now,
    basedOn: preview.basedOn,
    previousHash: preview.previous?.hash ?? null,
    hash: "",
    lineage: context.lineage,
    snapshot: context.snapshot,
    delta: preview.delta,
    decisions: preview.decisions,
    note: context.note === null || context.note.trim() === "" ? null : context.note,
    revoked: null,
    appVersion: context.appVersion,
  };
  return { ...unhashed, hash: await versionHash(unhashed) };
}

/** Revoca una versión: no la borra ni la edita, la marca con fecha y razón (§7). Devuelve una copia. */
export function revokeVersion(version: ConsolidatedVersion, reason: string, now: number): ConsolidatedVersion {
  if (version.revoked !== null) {
    throw new Error(`La versión v${version.version} ya estaba revocada.`);
  }
  if (reason.trim() === "") {
    throw new Error("Una revocación necesita su razón: queda en el historial (§7).");
  }
  return { ...version, revoked: { at: now, reason } };
}

/** Las versiones en orden de creación dentro del linaje: por número y, a igual número, por fecha. */
export function sortVersions(versions: readonly ConsolidatedVersion[]): readonly ConsolidatedVersion[] {
  return [...versions].sort((a, b) => a.version - b.version || a.createdAt - b.createdAt);
}

/** La versión vigente: la última no revocada, o `null`. */
export function currentVersion(versions: readonly ConsolidatedVersion[]): ConsolidatedVersion | null {
  const ordered = sortVersions(versions);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const version = ordered[index] as ConsolidatedVersion;
    if (version.revoked === null) return version;
  }
  return null;
}

/** Lo observado frente a la memoria: el delta del fichero actual contra la versión vigente. */
export interface MemoryComparison {
  readonly version: number;
  readonly basedOnFileName: string;
  readonly consolidatedAt: number;
  readonly delta: SnapshotDelta;
}

export function compareToMemory(
  current: CircuitSnapshot,
  memory: ConsolidatedVersion,
  thresholds: Pick<TagChangeThresholds, "maxChance">,
): MemoryComparison {
  return {
    version: memory.version,
    basedOnFileName: memory.basedOn.fileName,
    consolidatedAt: memory.createdAt,
    delta: compareSnapshots(memory.snapshot, current, thresholds),
  };
}

/** Relación entre la memoria local y la de un `.agvproj` que se abre (§10). */
export type LineageRelation = "sin-memoria" | "identica" | "local-adelantada" | "entrante-adelantada" | "bifurcada";

/** ¿Es `prefix` un prefijo (propio o no) de `chain`? */
function isPrefix(prefix: readonly string[], chain: readonly string[]): boolean {
  return prefix.length <= chain.length && prefix.every((hash, index) => chain[index] === hash);
}

/**
 * Clasifica por la **cadena de hashes**, en orden de versión:
 *
 * - `sin-memoria`: el proyecto no trae versiones (haya o no memoria local: no hay nada que comparar).
 * - `identica`: las dos cadenas son iguales.
 * - `local-adelantada`: la entrante es un prefijo de la local.
 * - `entrante-adelantada`: la local es un prefijo de la entrante (también si la local está vacía).
 * - `bifurcada`: ancestro común y ramas distintas, o ningún ancestro común con las dos no vacías.
 */
export function classifyLineage(
  local: readonly ConsolidatedVersion[],
  incoming: readonly ConsolidatedVersion[],
): LineageRelation {
  const localChain = sortVersions(local).map((version) => version.hash);
  const incomingChain = sortVersions(incoming).map((version) => version.hash);
  if (incomingChain.length === 0) return "sin-memoria";
  if (localChain.length === incomingChain.length && isPrefix(localChain, incomingChain)) return "identica";
  if (isPrefix(incomingChain, localChain)) return "local-adelantada";
  if (isPrefix(localChain, incomingChain)) return "entrante-adelantada";
  return "bifurcada";
}

/** Bytes que ocupa una versión serializada, para el presupuesto de crecimiento (§9). */
export function versionBytes(version: ConsolidatedVersion): number {
  return new TextEncoder().encode(JSON.stringify(version)).length;
}

// --- Linajes (§10) ---------------------------------------------------------------------------------

/**
 * Un linaje: su identificador y los hashes de sus versiones, en orden. Se identifica por hashes y no
 * solo por `lineage` porque dos dispositivos que consolidan en paralelo desde la misma versión heredan
 * el mismo identificador y producen versiones con el mismo número: solo el hash las distingue.
 */
export interface LineageRef {
  readonly id: string;
  readonly hashes: readonly string[];
}

export interface LineageEvent {
  readonly at: number;
  readonly choice: "conservar-local" | "adoptar-entrante";
  readonly reason: string;
  /** Presente si la elección se hizo en otro dispositivo y llegó con un `.agvproj` (OQ-144). */
  readonly origin?: "otro-dispositivo";
}

/** Dos eventos son el mismo si coinciden instante, elección y razón; de dónde vinieron no cuenta. */
function eventKey(event: LineageEvent): string {
  return `${event.at}|${event.choice}|${event.reason}`;
}

/**
 * Añade al historial las elecciones de linaje que trae un `.agvproj` y aquí no estaban (OQ-144,
 * propietario 2026-09-27). Solo se añaden, marcadas como de otro dispositivo: son decisiones humanas
 * ajenas que se registran, no que se aplican ni se reinterpretan (R-MEM-002). Devuelve el estado y
 * cuántas entraron.
 */
export function withForeignEvents(
  state: LineageState,
  incoming: readonly LineageEvent[],
): { readonly state: LineageState; readonly added: number } {
  const known = new Set(state.lineageEvents.map(eventKey));
  const added: LineageEvent[] = [];
  for (const event of incoming) {
    const key = eventKey(event);
    if (known.has(key)) continue;
    known.add(key);
    added.push({ at: event.at, choice: event.choice, reason: event.reason, origin: "otro-dispositivo" });
  }
  if (added.length === 0) return { state, added: 0 };
  const lineageEvents = [...state.lineageEvents, ...added].sort((a, b) => a.at - b.at);
  return { state: { ...state, lineageEvents }, added: added.length };
}

/** El estado de linaje del circuito: qué memoria está vigente, cuál espera decisión y cuáles quedaron archivadas. */
export interface LineageState {
  readonly circuitId: string;
  /** El linaje sobre el que se consolida; `null` hasta la primera versión. */
  readonly active: LineageRef | null;
  /** El linaje entrante de una bifurcación sin resolver, o `null`. */
  readonly incoming: LineageRef | null;
  /** Linajes que una elección dejó como histórico: se conservan, nunca se borran. */
  readonly archived: readonly LineageRef[];
  /** La última relación clasificada al abrir un `.agvproj`, o `null` si nunca se abrió uno con memoria. */
  readonly lastRelation: LineageRelation | null;
  readonly lineageEvents: readonly LineageEvent[];
}

export function emptyLineageState(circuitId: string): LineageState {
  return { circuitId, active: null, incoming: null, archived: [], lastRelation: null, lineageEvents: [] };
}

/** Las versiones de un linaje, en orden. Sin linaje (`null`) no hay ninguna. */
export function versionsOfLineage(versions: readonly ConsolidatedVersion[], lineage: LineageRef | null): readonly ConsolidatedVersion[] {
  if (lineage === null) return [];
  const wanted = new Set(lineage.hashes);
  return sortVersions(versions.filter((version) => wanted.has(version.hash)));
}

/** El estado tras consolidar `version` en el linaje activo: lo crea si es la primera versión. */
export function withConsolidated(state: LineageState, version: ConsolidatedVersion): LineageState {
  const active = state.active ?? { id: version.lineage, hashes: [] };
  return { ...state, active: { id: active.id, hashes: [...active.hashes, version.hash] } };
}

/**
 * Aplica la relación con la memoria de un `.agvproj` abierto (§10). No decide nada por la persona:
 *
 * - `entrante-adelantada` adopta el linaje entrante como activo (la local era su prefijo, así que no se
 *   pierde ninguna decisión);
 * - `bifurcada` deja el entrante **esperando decisión** (`incoming`), y mientras tanto la consolidación
 *   queda bloqueada;
 * - las demás solo anotan la relación.
 */
export function withIncoming(state: LineageState, relation: LineageRelation, incoming: readonly ConsolidatedVersion[]): LineageState {
  const chain = sortVersions(incoming);
  const last = chain[chain.length - 1];
  const ref: LineageRef | null = last === undefined ? null : { id: last.lineage, hashes: chain.map((version) => version.hash) };
  if (relation === "entrante-adelantada" && ref !== null) {
    return { ...state, active: ref, incoming: null, lastRelation: relation };
  }
  if (relation === "bifurcada" && ref !== null) {
    return { ...state, incoming: ref, lastRelation: relation };
  }
  return { ...state, lastRelation: relation };
}

/** Resuelve la bifurcación con la elección humana y la deja en el historial con su razón (§10). */
export function resolveFork(state: LineageState, choice: LineageEvent["choice"], reason: string, now: number): LineageState {
  if (state.incoming === null) {
    throw new Error("No hay ninguna bifurcación sin resolver.");
  }
  if (reason.trim() === "") {
    throw new Error("La elección de linaje necesita su justificación: queda en el historial (§10).");
  }
  const event: LineageEvent = { at: now, choice, reason };
  if (choice === "conservar-local") {
    return { ...state, incoming: null, archived: [...state.archived, state.incoming], lineageEvents: [...state.lineageEvents, event] };
  }
  return {
    ...state,
    active: state.incoming,
    incoming: null,
    archived: state.active === null ? state.archived : [...state.archived, state.active],
    lineageEvents: [...state.lineageEvents, event],
  };
}
