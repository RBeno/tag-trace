/**
 * Las pestañas por pregunta (UX_SPEC §2), para las pruebas de navegador.
 *
 * Desde 3.48.0 la página no es una lista de secciones: cada pregunta tiene su pestaña y lo que no
 * está en la activa no es visible. Una prueba que busca un texto de una sección la activa antes;
 * lo que afirma sobre los datos no cambia, solo cómo llega hasta ellos.
 */

import { expect, type Page } from "@playwright/test";

export type TabName = "Resumen" | "Tags" | "AGV" | "Tiempos" | "Línea y calles" | "Datos";

/** Activa una pestaña por su nombre y espera a que esté seleccionada. */
export async function openTab(page: Page, name: TabName): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}
