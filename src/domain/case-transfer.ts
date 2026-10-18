/**
 * Los expedientes que llegan en un `.agvproj` frente a los del dispositivo (OQ-174, ADR-0018 D2
 * enmendado; F6 entrega 7).
 *
 * La copia sirve para **recuperar**, no para trabajar en dos sitios: sigue habiendo un solo dispositivo
 * y nada se mezcla. Cada expediente es una cadena de revisiones append-only enlazadas por hash; se
 * compara la del fichero con la local, expediente a expediente:
 *
 * - `roto`: la cadena del fichero no está entera (falta una revisión, no enlaza o un hash no cuadra). No
 *   entra nada de ese expediente.
 * - `nuevo`: no está aquí; entra entero.
 * - `identico` / `local-adelantado`: lo del fichero ya está aquí (igual, o el local tiene más revisiones
 *   sobre las mismas); no entra nada.
 * - `entrante-adelantado`: lo local es el principio del fichero; entran las revisiones que faltan.
 * - `distinto`: las dos cadenas divergen; no entra nada y lo local queda como estaba.
 */

import { verifyChain, type CaseRevision } from "./incident-case.js";

export type CaseImportRelation = "roto" | "nuevo" | "identico" | "local-adelantado" | "entrante-adelantado" | "distinto";

export interface CaseImportPlan {
  readonly caseId: string;
  readonly relation: CaseImportRelation;
  /** Las revisiones que hay que añadir, en orden. */
  readonly missing: readonly CaseRevision[];
  /** Por qué la cadena del fichero está rota, en palabras. */
  readonly problems: readonly string[];
}

const byRevision = (a: CaseRevision, b: CaseRevision): number => a.revision - b.revision;

/** Qué hacer con cada expediente del fichero. Ordenado por expediente. */
export async function planCaseImport(local: readonly CaseRevision[], incoming: readonly CaseRevision[]): Promise<readonly CaseImportPlan[]> {
  const group = (revisions: readonly CaseRevision[]): Map<string, CaseRevision[]> => {
    const out = new Map<string, CaseRevision[]>();
    for (const revision of revisions) out.set(revision.caseId, [...(out.get(revision.caseId) ?? []), revision]);
    for (const list of out.values()) list.sort(byRevision);
    return out;
  };
  const mine = group(local);
  const theirs = group(incoming);
  const plans: CaseImportPlan[] = [];
  for (const caseId of [...theirs.keys()].sort()) {
    const chain = theirs.get(caseId) as CaseRevision[];
    const problems = await verifyChain(chain);
    if (problems.length > 0) {
      plans.push({ caseId, relation: "roto", missing: [], problems });
      continue;
    }
    const here = mine.get(caseId) ?? [];
    if (here.length === 0) {
      plans.push({ caseId, relation: "nuevo", missing: chain, problems: [] });
      continue;
    }
    const shared = Math.min(here.length, chain.length);
    const agree = here.slice(0, shared).every((revision, index) => revision.hash === (chain[index] as CaseRevision).hash);
    const relation: CaseImportRelation = !agree ? "distinto" : chain.length === here.length ? "identico" : chain.length < here.length ? "local-adelantado" : "entrante-adelantado";
    plans.push({ caseId, relation, missing: relation === "entrante-adelantado" ? chain.slice(here.length) : [], problems: [] });
  }
  return plans;
}

/** Lo que pasó con los expedientes al abrir un `.agvproj`, en palabras; vacío si no traía ninguno. */
export function caseImportText(plans: readonly CaseImportPlan[], evidenceRejected: number): readonly string[] {
  if (plans.length === 0) return [];
  const count = (relation: CaseImportRelation): number => plans.filter((plan) => plan.relation === relation).length;
  const added = plans.reduce((sum, plan) => sum + plan.missing.length, 0);
  const of = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
  const lines = [
    `Expedientes de incidencia: ${of(plans.length, "en el fichero", "en el fichero")}; ` +
      `${of(count("nuevo"), "nuevo", "nuevos")}, ${of(count("entrante-adelantado"), "con revisiones nuevas", "con revisiones nuevas")}, ` +
      `${of(count("identico") + count("local-adelantado"), "que ya estaba", "que ya estaban")} (${of(added, "revisión añadida", "revisiones añadidas")}).`,
  ];
  for (const plan of plans.filter((entry) => entry.relation === "distinto")) {
    lines.push(`El expediente ${plan.caseId} no coincide con el de este dispositivo: no se ha mezclado y se queda el de aquí.`);
  }
  for (const plan of plans.filter((entry) => entry.relation === "roto")) {
    lines.push(`El expediente ${plan.caseId} viene con la cadena rota (${plan.problems.join("; ")}): no se ha cargado.`);
  }
  if (evidenceRejected > 0) lines.push(`${of(evidenceRejected, "recorte no coincide", "recortes no coinciden")} con su huella y no se ${evidenceRejected === 1 ? "ha" : "han"} guardado: su expediente sale sin recorte.`);
  return lines;
}
