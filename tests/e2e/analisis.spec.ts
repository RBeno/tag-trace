/**
 * TC-374: el gestor de análisis en un navegador de verdad (`UX_SPEC.md` §8.1). Los análisis guardados
 * se enseñan al cargar y se eligen; uno nuevo nace vacío o a partir de otro con sus listas, admite
 * listas antes que lecturas, y el elegido acumula lo que se le añade.
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ANILLO = fileURLToPath(new URL("../../fixtures/synthetic/anillo/", import.meta.url));

async function freshPage(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("tag-trace");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
}

/** El registro del circuito tal como está en el almacén, sin pasar por la interfaz. */
async function stored(page: Page, circuitId: string): Promise<{ sources: number; lists: readonly string[]; copied: boolean; basedOn: string | null } | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const value = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
        const request = db.transaction("circuits").objectStore("circuits").get(id);
        request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
        request.onerror = () => reject(request.error);
      });
      if (value === undefined) return null;
      const lists = (value["lists"] as { list: string; copiedFrom?: unknown }[] | undefined) ?? [];
      return {
        sources: (value["sources"] as unknown[]).length,
        lists: lists.map((entry) => entry.list),
        copied: lists.length > 0 && lists.every((entry) => entry.copiedFrom !== undefined),
        basedOn: (value["basedOn"] as { circuitId: string } | undefined)?.circuitId ?? null,
      };
    } finally {
      db.close();
    }
  }, circuitId);
}

test.describe("TC-374 gestor de análisis", () => {
  test("elegir un guardado, crear otro a partir de él y añadir lecturas al elegido", async ({ page }) => {
    await freshPage(page);
    await expect(page.getByText("Todavía no hay análisis guardados en este dispositivo.")).toBeVisible();

    // Un análisis con lecturas y listas, como los de siempre: escribiendo el nombre.
    await page.locator("#circuit-name").fill("SINT-BASE");
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Circuito «SINT-BASE»")).toBeVisible({ timeout: 15_000 });
    await page.locator("#lists-file").setInputFiles(`${ANILLO}listas.csv`);
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });

    // Al volver a abrir, el guardado se enseña con lo que tiene.
    await page.reload();
    const saved = page.locator('.analysis-item[data-analysis="SINT-BASE"]');
    await expect(saved).toBeVisible();
    await expect(saved).toContainText("1 fichero");
    await expect(saved).toHaveAttribute("aria-pressed", "false");

    // Nuevo a partir de él: se copian las listas, no las lecturas.
    await page.locator("#new-analysis").click();
    await page.locator("#new-analysis-name").fill("SINT-NUEVO");
    await page.locator("#analysis-base").selectOption("SINT-BASE");
    await expect(page.locator("#copy-lists")).toBeChecked();
    await page.locator("#create-analysis").click();
    await expect(page.getByText("Análisis «SINT-NUEVO» creado")).toBeVisible();
    await expect(page.locator("#circuit-name")).toHaveValue("SINT-NUEVO");
    await expect(page.getByText("Datos de «SINT-NUEVO»")).toBeVisible();
    await expect(page.locator(".analysis-facts")).toContainText("copiada de «SINT-BASE»");
    await expect(page.locator('.analysis-item[data-analysis="SINT-NUEVO"]')).toHaveAttribute("aria-pressed", "true");
    expect(await stored(page, "SINT-NUEVO")).toEqual({ sources: 0, lists: (await stored(page, "SINT-BASE"))?.lists, copied: true, basedOn: "SINT-BASE" });

    // El mismo nombre, aunque sea en minúsculas, no se pisa.
    await page.locator("#new-analysis").click();
    await page.locator("#new-analysis-name").fill("sint-base");
    await page.locator("#create-analysis").click();
    await expect(page.locator(".analysis-problem")).toContainText("solo se distingue en mayúsculas");
    await page.getByRole("button", { name: "Cancelar", exact: true }).first().click();

    // Uno vacío admite sus listas antes que sus lecturas.
    await page.locator("#new-analysis").click();
    await page.locator("#new-analysis-name").fill("SINT-VACIO");
    await page.locator("#analysis-base").selectOption("");
    await page.locator("#create-analysis").click();
    await expect(page.getByText("Análisis «SINT-VACIO» creado")).toBeVisible();
    await page.locator("#lists-file").setInputFiles(`${ANILLO}listas.csv`);
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });
    const vacio = await stored(page, "SINT-VACIO");
    expect(vacio?.sources).toBe(0);
    expect(vacio?.lists.length).toBeGreaterThan(0);
    expect(vacio?.copied).toBe(false);

    // Elegir el base en la lista y añadirle lecturas: van a él.
    await page.locator('.analysis-item[data-analysis="SINT-BASE"]').click();
    await expect(page.locator("#circuit-name")).toHaveValue("SINT-BASE");
    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Circuito «SINT-BASE»")).toBeVisible({ timeout: 15_000 });
    expect((await stored(page, "SINT-BASE"))?.sources).toBe(2);
    expect((await stored(page, "SINT-NUEVO"))?.sources).toBe(0);
  });
});

const ACUMULACION = fileURLToPath(new URL("../../fixtures/synthetic/acumulacion/", import.meta.url));

test.describe("TC-376 frente al periodo anterior", () => {
  test("el primer periodo lo dice; el segundo se compara con el primero y dice cuándo se cargó cada dato", async ({ page }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("SINT-PERIODOS");
    await page.locator("#source-file").setInputFiles(`${ACUMULACION}ventana-1.csv`);
    await expect(page.getByText("Circuito «SINT-PERIODOS»")).toBeVisible({ timeout: 15_000 });
    const section = page.locator("section.comparison");
    await expect(section).toContainText("Es el primer periodo con instantánea de este análisis");
    await expect(section).toContainText("Sin registro de conexiones.");

    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles(`${ACUMULACION}ventana-2.csv`);
    await expect(section).toContainText("«ventana-2.csv»", { timeout: 15_000 });
    await expect(section).toContainText("frente a «ventana-1.csv»");
    // Lo primero, las modificaciones detectadas; después, los hallazgos.
    await expect(section.locator("h4").first()).toHaveText("Modificaciones detectadas");
    await expect(section.getByRole("heading", { name: "Hallazgos" })).toBeVisible();
    await expect(section).toContainText("Sin registro de conexiones en ninguno de los dos periodos");
    await expect(section.getByRole("heading", { name: "Sustituciones de tag" })).toBeVisible();
  });
});
