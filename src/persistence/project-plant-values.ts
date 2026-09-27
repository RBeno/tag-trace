/**
 * Los valores de planta confirmados que viajan en el `.agvproj` (OQ-140, esquema 5, sección `valores`).
 *
 * Como el plano (`project-plan.ts`): el hilo principal abre el proyecto con `readProject` y no analiza;
 * comparar dos registros de eventos es comparar su prefijo, y escribir lo que falta es una transacción
 * del almacén. Nunca se mezclan dos historiales: solo entran eventos cuando el local es un prefijo
 * exacto del entrante. Si son distintos, no entra nada y se dice.
 */

import { classifyPlantValueEvents, type PlantValuesRelation } from "../domain/plant-values.js";
import { plantValuesSection, type ProjectPlantValuesSection } from "./agvproj.js";
import { appendPlantValues, isAvailable, loadPlantValues } from "./store.js";

/** La sección `valores` para exportar el circuito, o `undefined` si no tiene ningún valor confirmado. */
export async function exportProjectPlantValues(circuitId: string): Promise<ProjectPlantValuesSection | undefined> {
  if (!isAvailable()) return undefined;
  return plantValuesSection(await loadPlantValues(circuitId));
}

export interface ProjectPlantValuesImport {
  /**
   * - `sin-valores`: el proyecto no trae valores; no se toca nada.
   * - `identico` / `local-adelantado`: el entrante ya está aquí; no se añade nada.
   * - `entrante-adelantado`: el local es prefijo del entrante (o está vacío); se añaden los que faltan.
   * - `distinto`: los dos registros divergen; no se mezcla nada y los valores locales quedan como estaban.
   */
  readonly relation: PlantValuesRelation;
  /** Valores añadidos al almacén. */
  readonly added: number;
}

/** Incorpora los valores de planta de un `.agvproj` abierto según su relación con los locales. */
export async function importProjectPlantValues(
  circuitId: string,
  incoming: ProjectPlantValuesSection | undefined,
): Promise<ProjectPlantValuesImport> {
  if (!isAvailable()) return { relation: "sin-valores", added: 0 };
  const theirs = (incoming?.eventos ?? []).filter((event) => event.circuitId === circuitId);
  const local = await loadPlantValues(circuitId);
  const { relation, missing } = classifyPlantValueEvents(local, theirs);
  if (relation === "entrante-adelantado" && missing.length > 0) await appendPlantValues(missing);
  return { relation, added: relation === "entrante-adelantado" ? missing.length : 0 };
}
