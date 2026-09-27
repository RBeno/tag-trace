/**
 * El plano físico que viaja en el `.agvproj` (ADR-0016, esquema 4, sección `plano`).
 *
 * Como la memoria (`project-memory.ts`): el hilo principal abre el proyecto con `readProject` y no
 * analiza; comparar dos registros de eventos es comparar su prefijo, y escribir lo que falta es una
 * transacción del almacén. Vive aquí, en persistencia, para que la presentación pueda llamarlo sin
 * importar nada del Worker (WP-001).
 *
 * Nunca se mezclan dos historiales (R-MEM-002): el plano es append-only, así que solo entran eventos
 * cuando el local es un prefijo exacto del entrante. Si son distintos, no entra nada y se dice.
 */

import { classifyPlanEvents, type PlanRelation } from "../domain/plan.js";
import { planSection, type ProjectPlanSection } from "./agvproj.js";
import { appendPlanEvents, isAvailable, loadPlanEvents } from "./store.js";

/** La sección `plano` para exportar el circuito, o `undefined` si no tiene plano. */
export async function exportProjectPlan(circuitId: string): Promise<ProjectPlanSection | undefined> {
  if (!isAvailable()) return undefined;
  return planSection(await loadPlanEvents(circuitId));
}

export interface ProjectPlanImport {
  /**
   * - `sin-plano`: el proyecto no trae plano; no se toca nada.
   * - `identico` / `local-adelantado`: el entrante ya está aquí; no se añade nada.
   * - `entrante-adelantado`: el local es prefijo del entrante (o está vacío); se añaden los que faltan.
   * - `distinto`: los dos registros divergen; no se mezcla nada y el plano local queda como estaba.
   */
  readonly relation: PlanRelation;
  /** Eventos añadidos al almacén. */
  readonly added: number;
}

/** Incorpora el plano de un `.agvproj` abierto según su relación con el local. */
export async function importProjectPlan(circuitId: string, incoming: ProjectPlanSection | undefined): Promise<ProjectPlanImport> {
  if (!isAvailable()) return { relation: "sin-plano", added: 0 };
  const theirs = (incoming?.eventos ?? []).filter((event) => event.circuitId === circuitId);
  const local = await loadPlanEvents(circuitId);
  const { relation, missing } = classifyPlanEvents(local, theirs);
  if (relation === "entrante-adelantado" && missing.length > 0) await appendPlanEvents(missing);
  return { relation, added: relation === "entrante-adelantado" ? missing.length : 0 };
}
