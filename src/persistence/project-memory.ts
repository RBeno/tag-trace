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
 */

import {
  classifyLineage,
  emptyLineageState,
  sortVersions,
  versionsOfLineage,
  withForeignEvents,
  withIncoming,
  type ConsolidatedVersion,
  type LineageRelation,
} from "../domain/memory.js";
import { memorySection, type ProjectMemorySection } from "./agvproj.js";
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
}

export async function importProjectMemory(circuitId: string, incoming: ProjectMemorySection | undefined): Promise<ProjectMemoryImport> {
  if (!isAvailable()) return { relation: "sin-memoria", revocations: [], events: 0 };
  const [versions, stored] = await Promise.all([loadVersions(circuitId), loadMemoryState(circuitId)]);
  const state = stored ?? emptyLineageState(circuitId);
  const local = state.active === null ? sortVersions(versions) : versionsOfLineage(versions, state.active);
  const incomingVersions = sortVersions((incoming?.versiones ?? []).filter((version) => version.circuitId === circuitId));
  const relation = classifyLineage(local, incomingVersions);

  const known = new Map(versions.map((version) => [version.hash, version]));
  const toWrite: ConsolidatedVersion[] = [];
  const revocations: ProjectMemoryImport["revocations"][number][] = [];
  for (const version of incomingVersions) {
    const mine = known.get(version.hash);
    if (mine === undefined) {
      if (relation === "entrante-adelantada" || relation === "bifurcada") toWrite.push(version);
    } else if (mine.revoked === null && version.revoked !== null) {
      toWrite.push({ ...mine, revoked: version.revoked });
      revocations.push({ version: mine.version, at: version.revoked.at, reason: version.revoked.reason });
    }
  }
  const events = withForeignEvents(withIncoming(state, relation, incomingVersions), incoming?.linaje.eventos ?? []);
  await saveMemory({ versions: toWrite, state: events.state });
  return { relation, revocations, events: events.added };
}
