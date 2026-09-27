/**
 * Valores de planta del circuito confirmados por una persona (OQ-140), en un navegador de verdad: la
 * sección «Valores de planta del circuito» de la pestaña Datos.
 *
 * Lo que se fija: que sin nada confirmado rigen los provisionales y la interfaz lo dice; que confirmar
 * un valor exige una razón escrita; que el valor confirmado queda vigente para el fichero de trabajo si
 * su fecha efectiva no pasa del inicio del fichero; que el análisis **no cambia hasta volver a
 * analizar**; y que, al volver a cargar el fichero, el análisis lo usa. El valor elegido es el inicio de
 * la noche, porque su efecto se ve en la interfaz: «Estado normal del circuito» dice el régimen de noche
 * con que se midió. Un valor con fecha efectiva posterior al fichero no rige para él.
 *
 * El fichero es `fixtures/synthetic/memoria/periodo-1.csv` (24/01/2026).
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));

/** Cada prueba empieza con el almacén vacío y sin service worker: los valores viven en IndexedDB. */
async function freshPage(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    for (const registration of registrations ?? []) await registration.unregister();
    for (const name of await caches.keys()) await caches.delete(name);
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("tag-trace");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
}

async function importInto(page: Page, circuit: string, path: string): Promise<void> {
  await openTab(page, "Resumen");
  await page.locator("#circuit-name").fill(circuit);
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles(path);
  await expect(page.getByRole("heading", { name: `Circuito «${circuit}»`, exact: true })).toBeVisible({ timeout: 15_000 });
}

/** La línea de «Estado normal del circuito» que dice cuánto se cargó de noche y con qué régimen. */
async function nightInUse(page: Page): Promise<string> {
  await openTab(page, "Tiempos");
  await expect(page.getByRole("heading", { name: "Estado normal del circuito" })).toBeVisible();
  const line = page.locator("p", { hasText: /^Tiempo cargado:/ });
  return (await line.textContent()) ?? "";
}

test.describe("valores de planta", () => {
  test.setTimeout(120_000);

  test("se confirma el inicio de la noche con razón, rige para el fichero y el análisis lo usa al volver a cargarlo", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "valores", `${MEMORIA}periodo-1.csv`);

    // Sin nada confirmado, el análisis usa la noche provisional (22 a 5).
    expect(await nightInUse(page)).toContain("(de 22:00 a 05:00)");

    await openTab(page, "Datos");
    const panel = page.locator(".plant-values-panel");
    await expect(panel.getByRole("heading", { name: "Valores de planta del circuito" })).toBeVisible();
    await expect(panel).toContainText("Rigen los provisionales hasta que confirmes el valor de tu planta.");
    await expect(panel).toContainText("OQ-151");
    await expect(panel.locator(".plant-value")).toHaveCount(8);
    const night = panel.locator('.plant-value[data-key="noche-desde"]');
    await expect(night).toHaveAttribute("data-state", "provisional");
    await expect(night).toContainText("Provisional: 22:00");
    await expect(night).toContainText("Rige el provisional: 22:00.");

    // El enlace lleva a donde el programa mide algo relacionado: el perfil horario.
    await night.getByRole("button", { name: "Datos › Perfil horario" }).click();
    await expect(page.getByRole("heading", { name: "Perfil horario" })).toBeVisible();

    // «Cambiar…»: valor, fecha efectiva (por defecto hoy) y razón obligatoria.
    await night.getByRole("button", { name: "Cambiar «Empieza la noche (régimen de noche)»" }).click();
    const form = night.locator(".plant-value-form");
    await expect(form).toBeVisible();
    await expect(form).toContainText("se aplica al volver a analizarlos");
    await form.locator(".plant-value-input").fill("20");
    // El fichero es del 24/01/2026: la fecha efectiva tiene que ser anterior para que rija para él.
    await form.locator(".plant-value-date").fill("2026-01-01");
    const send = form.getByRole("button", { name: "Confirmar el valor" });
    await expect(send).toBeDisabled();
    await form.locator(".plant-value-reason").fill("En planta la noche empieza a las 20:00 desde enero");
    await expect(send).toBeEnabled();
    await send.click();

    const status = panel.locator(".plant-values-status");
    await expect(status).toContainText("Valor confirmado", { timeout: 15_000 });
    await expect(status).toContainText("Rige ya para el fichero de trabajo");
    await expect(night).toHaveAttribute("data-state", "confirmado");
    await expect(night).toContainText("Rige 20:00");
    await expect(night).toContainText("En planta la noche empieza a las 20:00 desde enero");
    await night.locator(".plant-value-history > summary").click();
    await expect(night.locator(".plant-value-history")).toContainText("20:00");

    // Confirmar no vuelve a analizar: lo que está en pantalla sigue siendo el análisis anterior.
    expect(await nightInUse(page)).toContain("(de 22:00 a 05:00)");

    // Al volver a cargar el fichero, el análisis usa el valor confirmado.
    await importInto(page, "valores", `${MEMORIA}periodo-1.csv`);
    expect(await nightInUse(page)).toContain("(de 20:00 a 05:00)");
    await openTab(page, "Datos");
    await expect(night).toHaveAttribute("data-state", "confirmado");
    await expect(panel).toContainText("Lo vigente es para el fichero de trabajo «periodo-1.csv»");
    // El resto sigue con su provisional.
    await expect(panel.locator('.plant-value[data-key="noche-hasta"]')).toHaveAttribute("data-state", "provisional");
  });

  test("un valor con fecha efectiva posterior al fichero no rige para él, y sin razón no se envía", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "valores", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Datos");
    const panel = page.locator(".plant-values-panel");
    const stall = panel.locator('.plant-value[data-key="bloqueo-cabeza"]');
    await expect(stall).toContainText("Provisional: 2 min");
    await stall.getByRole("button", { name: /^Cambiar/ }).click();
    const form = stall.locator(".plant-value-form");
    // Un valor que no vale se dice y no se puede enviar.
    await form.locator(".plant-value-input").fill("0");
    await form.locator(".plant-value-reason").fill("Medido con cronómetro en la línea");
    await expect(form.locator(".plant-value-problem")).toContainText("mayor que cero");
    await expect(form.getByRole("button", { name: "Confirmar el valor" })).toBeDisabled();
    // Fecha por defecto: hoy, posterior al fichero.
    await form.locator(".plant-value-input").fill("3");
    await form.locator(".plant-value-reason").fill("");
    await expect(form.getByRole("button", { name: "Confirmar el valor" })).toBeDisabled();
    await form.locator(".plant-value-reason").fill("Medido con cronómetro en la línea");
    await form.getByRole("button", { name: "Confirmar el valor" }).click();
    await expect(panel.locator(".plant-values-status")).toContainText("No rige para el fichero de trabajo", { timeout: 15_000 });
    await expect(stall).toHaveAttribute("data-state", "provisional");
    await expect(stall.locator(".plant-value-history")).toContainText("3 min");
  });
});
