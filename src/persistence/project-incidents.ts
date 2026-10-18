/**
 * Los expedientes de incidencia que viajan en el `.agvproj` (OQ-174, esquema 6, sección `incidencias`).
 *
 * Como el plano y los valores de planta: el hilo principal abre el proyecto con `readProject` y no
 * analiza. Exportar lee las revisiones y los recortes que nombran; incorporar compara cada cadena con la
 * local (`planCaseImport`) y escribe lo que falta en una sola transacción. Nunca se mezclan dos
 * historiales. Un recorte entra solo si su huella coincide con su contenido; si no, se dice y su
 * expediente queda sin recorte (el retroceso y el replay dirán que no hay lecturas).
 */

import { planCaseImport, type CaseImportPlan } from "../domain/case-transfer.js";
import { evidenceHash, type FrozenEvidence } from "../domain/incident-case.js";
import { incidentsSection, type ProjectIncidentsSection } from "./agvproj.js";
import { appendCaseRevisions, isAvailable, loadCaseEvidence, loadCaseRevisions } from "./store.js";

/** La sección `incidencias` para exportar el circuito, o `undefined` si no tiene expedientes. */
export async function exportProjectIncidents(circuitId: string): Promise<ProjectIncidentsSection | undefined> {
  if (!isAvailable()) return undefined;
  const revisions = await loadCaseRevisions(circuitId);
  const hashes = [...new Set(revisions.map((revision) => revision.evidence.hash).filter((hash): hash is string => hash !== null))];
  const evidence: { hash: string; datos: FrozenEvidence }[] = [];
  for (const hash of hashes) {
    const datos = await loadCaseEvidence(circuitId, hash);
    if (datos !== undefined) evidence.push({ hash, datos });
  }
  return incidentsSection(revisions, evidence);
}

export interface ProjectIncidentsImport {
  readonly plans: readonly CaseImportPlan[];
  /** Recortes que no coincidían con su huella y no se guardaron. */
  readonly evidenceRejected: number;
}

/** Incorpora los expedientes de un `.agvproj` abierto, expediente a expediente y sin mezclar. */
export async function importProjectIncidents(circuitId: string, incoming: ProjectIncidentsSection | undefined): Promise<ProjectIncidentsImport> {
  if (!isAvailable() || incoming === undefined) return { plans: [], evidenceRejected: 0 };
  const theirs = incoming.revisiones.filter((revision) => revision.circuitId === circuitId);
  const plans = await planCaseImport(await loadCaseRevisions(circuitId), theirs);
  const adding = plans.flatMap((plan) => plan.missing);
  // Solo los recortes que nombran las revisiones que entran, y solo si su huella cuadra.
  const wanted = new Set(adding.map((revision) => revision.evidence.hash).filter((hash): hash is string => hash !== null));
  const evidence: { circuitId: string; hash: string; evidence: FrozenEvidence }[] = [];
  let evidenceRejected = 0;
  for (const entry of incoming.recortes) {
    if (!wanted.has(entry.hash)) continue;
    if ((await evidenceHash(entry.datos)) === entry.hash) evidence.push({ circuitId, hash: entry.hash, evidence: entry.datos });
    else evidenceRejected += 1;
  }
  await appendCaseRevisions(adding, evidence);
  return { plans, evidenceRejected };
}
