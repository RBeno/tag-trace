/**
 * La memoria consolidada que viaja en el `.agvproj` (F4, `MEMORY_CONSOLIDATION.md` §10 y §11).
 *
 * El hilo principal abre el proyecto con `readProject` y **no analiza**: clasificar la relación entre
 * la memoria entrante y la local es comparar dos cadenas de hashes, y persistir lo que toque es una
 * escritura del almacén. Las dos cosas viven aquí, en persistencia, para que la presentación pueda
 * llamarlas sin importar nada del Worker ni del análisis (WP-001).
 *
 * Nunca se fusionan dos historiales (R-MEM-002): ante una bifurcación el entrante queda esperando la
 * decisión humana, y el Worker la aplica con `resolve-fork`.
 *
 * Lo que decide qué entra (`planMemoryImport`) y lo que comprueba que lo que llega es íntegro
 * (`verifyProjectMemory`) son funciones puras: se prueban sin almacén. `importProjectMemory` solo
 * las une con las lecturas y escrituras de IndexedDB.
 */

import {
  classifyLineage,
  emptyLineageState,
  lineageChainProblem,
  pendingForkBlocks,
  sortVersions,
  versionHashProblem,
  versionsOfLineage,
  withArchivedLineages,
  withForeignEvents,
  withIncoming,
  type ConsolidatedVersion,
  type LineageRef,
  type LineageRelation,
  type LineageState,
} from "../domain/memory.js";
import { MEMORY_SECTION, memorySection, ProjectError, type ProjectMemorySection } from "./agvproj.js";
import { isAvailable, loadMemoryState, loadVersions, saveMemory } from "./store.js";

/** La sección `memoria` para exportar el circuito, o `undefined` si no tiene versiones. */
export async function exportProjectMemory(circuitId: string): Promise<ProjectMemorySection | undefined> {
  if (!isAvailable()) return undefined;
  const [versions, state] = await Promise.all([loadVersions(circuitId), loadMemoryState(circuitId)]);
  return memorySection(versions, state);
}

/**
 * Incorpora la memoria de un `.agvproj` abierto y devuelve la relación clasificada (§10):
 *
 * - `sin-memoria`: el proyecto no trae versiones; solo se anota la relación.
 * - `identica` y `local-adelantada`: no entra ninguna versión; se anota la relación.
 * - `entrante-adelantada`: entran las versiones que faltan y el linaje entrante pasa a ser el activo.
 * - `bifurcada`: entran las versiones entrantes **sin tocar el linaje activo** y quedan esperando la
 *   decisión humana; hasta entonces la consolidación está bloqueada.
 *
 * La relación se clasifica contra el **linaje activo** del proyecto: sus linajes archivados no forman
 * parte de su cadena. Los archivados que trae y aquí no estaban entran como archivados, con sus
 * versiones: son historia, no una decisión.
 *
 * Con una bifurcación ya pendiente aquí, un proyecto cuya relación no sea `identica` ni
 * `sin-memoria` **no entra** (`pendingForkBlocked`): ni se adopta ni sustituye al entrante que
 * espera. Primero se resuelve la que hay.
 *
 * En todos los casos, una versión que el proyecto trae **revocada** y aquí no lo está se marca
 * revocada: la revocación es un hecho del historial, no una decisión que reinterpretar. Pero cambia
 * la versión vigente, así que se devuelve para que la interfaz lo diga (OQ-144). Y las elecciones de
 * linaje del otro dispositivo se añaden al historial, marcadas como suyas.
 */
export interface ProjectMemoryImport {
  readonly relation: LineageRelation;
  /** Versiones que llegaron revocadas y aquí no lo estaban: ahora lo están. */
  readonly revocations: readonly { readonly version: number; readonly at: number; readonly reason: string }[];
  /** Elecciones de linaje de otro dispositivo que entraron en el historial. */
  readonly events: number;
  /** Linajes archivados del otro dispositivo que aquí no estaban y entraron como archivados. */
  readonly archived: number;
  /**
   * `true` si había una bifurcación sin resolver y por eso el linaje del proyecto no se adoptó ni
   * sustituyó al que espera decisión. La relación devuelta es la clasificada igualmente.
   */
  readonly pendingForkBlocked: boolean;
}

/** Lo que `planMemoryImport` decide: qué escribir en `memory` y el estado de linaje resultante. */
export interface ProjectMemoryPlan extends ProjectMemoryImport {
  readonly toWrite: readonly ConsolidatedVersion[];
  readonly state: LineageState;
}

/** El linaje entrante que cuenta: el activo del proyecto o, si no lo declara (esquema antiguo), todas sus versiones como uno. */
function incomingActive(incoming: ProjectMemorySection, versions: readonly ConsolidatedVersion[]): LineageRef | null {
  if (incoming.linaje.activo !== null) return incoming.linaje.activo;
  const chain = sortVersions(versions);
  const last = chain[chain.length - 1];
  return last === undefined ? null : { id: last.lineage, hashes: chain.map((version) => version.hash) };
}

/** Las versiones del proyecto que son de este circuito, en orden. */
function incomingVersionsOf(circuitId: string, incoming: ProjectMemorySection | undefined): readonly ConsolidatedVersion[] {
  return sortVersions((incoming?.versiones ?? []).filter((version) => version.circuitId === circuitId));
}

/**
 * Comprueba que la memoria que llega es la que dice ser, antes de compararla con nada (§11): cada
 * versión vuelve a dar su hash al calcularlo, y cada linaje —el activo y los archivados— encadena
 * versiones presentes con sus `previousHash`. Lanza `ProjectError` con lo que falla; no toca nada.
 */
export async function verifyProjectMemory(circuitId: string, incoming: ProjectMemorySection | undefined): Promise<void> {
  if (incoming === undefined) return;
  const corrupt = (what: string): ProjectError =>
    new ProjectError(`La sección «${MEMORY_SECTION}» no es íntegra: ${what}.`, "El fichero está alterado o lo escribió una versión con otra regla de hash. No se ha cargado nada.");
  const versions = incomingVersionsOf(circuitId, incoming);
  const hashProblem = await versionHashProblem(versions);
  if (hashProblem !== null) throw corrupt(hashProblem);
  const lineages = [...(incoming.linaje.activo === null ? [] : [incoming.linaje.activo]), ...incoming.linaje.archivados];
  for (const lineage of lineages) {
    const chainProblem = lineageChainProblem(versions, lineage);
    if (chainProblem !== null) throw corrupt(chainProblem);
  }
}

/**
 * Decide, sin tocar el almacén, qué entra de la memoria de un proyecto ya verificado: la relación,
 * las versiones a escribir, las revocaciones que llegan y el estado de linaje resultante.
 */
export function planMemoryImport(input: {
  readonly circuitId: string;
  readonly versions: readonly ConsolidatedVersion[];
  readonly state: LineageState | undefined;
  readonly incoming: ProjectMemorySection | undefined;
}): ProjectMemoryPlan {
  const { circuitId, versions, incoming } = input;
  const state = input.state ?? emptyLineageState(circuitId);
  const local = state.active === null ? sortVersions(versions) : versionsOfLineage(versions, state.active);
  const incomingVersions = incomingVersionsOf(circuitId, incoming);
  const activeRef = incoming === undefined ? null : incomingActive(incoming, incomingVersions);
  const activeVersions = versionsOfLineage(incomingVersions, activeRef);
  const relation = classifyLineage(local, activeVersions);
  const blocked = pendingForkBlocks(state, relation);

  // Los archivados del otro dispositivo que aquí no estaban: entran como archivados, con sus versiones.
  const archived = withArchivedLineages(state, incoming?.linaje.archivados ?? []);
  const archivedHashes = new Set(archived.state.archived.slice(state.archived.length).flatMap((lineage) => lineage.hashes));

  const known = new Map(versions.map((version) => [version.hash, version]));
  const toWrite: ConsolidatedVersion[] = [];
  const revocations: ProjectMemoryImport["revocations"][number][] = [];
  const adoptsActive = !blocked && (relation === "entrante-adelantada" || relation === "bifurcada");
  const activeHashes = new Set(activeVersions.map((version) => version.hash));
  for (const version of incomingVersions) {
    const mine = known.get(version.hash);
    if (mine === undefined) {
      if ((adoptsActive && activeHashes.has(version.hash)) || archivedHashes.has(version.hash)) toWrite.push(version);
    } else if (mine.revoked === null && version.revoked !== null) {
      toWrite.push({ ...mine, revoked: version.revoked });
      revocations.push({ version: mine.version, at: version.revoked.at, reason: version.revoked.reason });
    }
  }
  const events = withForeignEvents(withIncoming(archived.state, relation, activeRef), incoming?.linaje.eventos ?? []);
  return { relation, revocations, events: events.added, archived: archived.added, pendingForkBlocked: blocked, toWrite, state: events.state };
}

export async function importProjectMemory(circuitId: string, incoming: ProjectMemorySection | undefined): Promise<ProjectMemoryImport> {
  if (!isAvailable()) return { relation: "sin-memoria", revocations: [], events: 0, archived: 0, pendingForkBlocked: false };
  await verifyProjectMemory(circuitId, incoming);
  const [versions, stored] = await Promise.all([loadVersions(circuitId), loadMemoryState(circuitId)]);
  const plan = planMemoryImport({ circuitId, versions, state: stored, incoming });
  await saveMemory({ versions: plan.toWrite, state: plan.state });
  const { toWrite: _toWrite, state: _state, ...result } = plan;
  return result;
}
