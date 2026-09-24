/**
 * Revisión en campo, en un navegador de verdad (UX_SPEC §4.3, R-EVI-007).
 *
 * El recorrido es el del trabajo en planta: marcar unos hallazgos, cerrar, volver otro día, cargar
 * de nuevo la extracción y encontrar las marcas donde se dejaron. Y al final, sacar la revisión en
 * CSV. Se usa el circuito de auditoría porque trae hallazgos de sobra que marcar.
 */

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { buildAuditScenario } from "../support/circuito-auditoria.js";

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

test.describe("revisión en campo", () => {
  test.setTimeout(300_000);

  test("las marcas se guardan solas, sobreviven a recargar y reimportar, y salen en el CSV", async ({ page }) => {
    const scenario = buildAuditScenario();
    const readings = { name: "auditoria.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.readingsCsv, "utf8") };

    await freshPage(page);
    await page.locator("#circuit-name").fill("auditoria");
    await page.locator("#source-file").setInputFiles(readings);
    await expect(page.getByText("Circuito «auditoria»")).toBeVisible({ timeout: 120_000 });
    await page
      .locator("#lists-file")
      .setInputFiles({ name: "listas.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.listsCsv, "utf8") });
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 30_000 });
    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles(readings);

    // Una calle sin servicio solo existe con las listas cargadas: es la señal de que la vista ya es
    // la de la segunda importación.
    const lane = page.locator(".finding", { hasText: "Nadie entró en" }).first();
    await expect(lane).toBeVisible({ timeout: 180_000 });
    // La barra fija dice cuánto va revisado; el panel de debajo, el recuento, los filtros y el CSV.
    const bar = page.locator(".review-bar");
    const panel = page.locator(".review-panel");
    await expect(bar).toContainText(/Revisados 0 de \d+/);

    await lane.getByRole("button", { name: /Confirmado/ }).click();
    await lane.getByRole("textbox").fill("Calle cerrada por obra");
    await lane.getByRole("textbox").press("Tab");
    const broken = page.locator(".finding", { hasText: "dejó de leerse" }).first();
    await broken.getByRole("button", { name: /Pospuesto/ }).click();

    await expect(lane).toHaveAttribute("data-review", "confirmado");
    await expect(broken).toHaveAttribute("data-review", "pospuesto");
    await expect(bar).toContainText(/Revisados 2 de \d+/);
    await expect(panel).toContainText("✓ 1 confirmado ·");

    // El filtro esconde las tarjetas de otro estado y deja el resto de la vista.
    await panel.getByRole("button", { name: /confirmados/ }).click();
    await expect(broken).toBeHidden();
    await expect(lane).toBeVisible();
    await panel.getByRole("button", { name: "Todos" }).click();
    await expect(broken).toBeVisible();

    // Otro día: se recarga la página y se vuelve a cargar la extracción.
    await page.reload();
    await page.locator("#circuit-name").fill("auditoria");
    await page.locator("#source-file").setInputFiles(readings);
    const laneAgain = page.locator(".finding", { hasText: "Nadie entró en" }).first();
    await expect(laneAgain).toHaveAttribute("data-review", "confirmado", { timeout: 180_000 });
    await expect(laneAgain.getByRole("textbox")).toHaveValue("Calle cerrada por obra");
    await expect(page.locator(".finding", { hasText: "dejó de leerse" }).first()).toHaveAttribute("data-review", "pospuesto");
    await expect(page.locator(".review-bar")).toContainText(/Revisados 2 de \d+/);

    const download = page.waitForEvent("download");
    await page.locator(".review-panel").getByRole("button", { name: "Exportar revisión (CSV)" }).click();
    const file = await download;
    const csv = await readFile((await file.path()) as string, "utf8");
    expect(csv.split("\r\n")[0]).toBe("﻿estado;hallazgo;dato actual;dato al marcar;nota;marcado;aparece;clave");
    expect(csv).toContain("Calle cerrada por obra");
    expect(csv).toMatch(/\r\nConfirmado;Nadie entró en/);
    expect(csv).toMatch(/\r\nPospuesto;Tag \d+: dejó de leerse/);
    expect(csv).toMatch(/\r\nPendiente;/);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
