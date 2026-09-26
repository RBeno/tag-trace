/**
 * Pestañas por pregunta y bandeja de hallazgos (UX_SPEC §2, §4.3, §4.5), en un navegador de verdad.
 *
 * Lo que se fija, con el circuito de auditoría cargado: las seis pestañas existen y la activa va en
 * el `hash`, que sobrevive a recargar; la bandeja del Resumen tiene tantas tarjetas como dice la
 * barra de revisión («Revisados 0 de N»); «Ver evidencia» de una tarjeta lleva a la pestaña y a la
 * sección que la explica; el filtro por tema esconde las demás; y el control compacto de revisión
 * cambia el estado desde su menú, con teclado y con ratón.
 */

import { expect, test, type Page } from "@playwright/test";

import { openTab } from "./pestanas.js";
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

test.describe("pestañas y bandeja de hallazgos", () => {
  test.setTimeout(300_000);

  test("seis pestañas con su hash, la bandeja con todas las tarjetas, la evidencia y el control de revisión", async ({ page }) => {
    const scenario = buildAuditScenario();
    const readings = { name: "auditoria.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.readingsCsv, "utf8") };

    await freshPage(page);
    // Sin nada cargado ya hay pestañas, y la de entrada es el Resumen.
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveText(["Resumen", "Tags", "AGV", "Tiempos", "Línea y calles", "Datos"]);
    await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");

    await page.locator("#circuit-name").fill("auditoria");
    await page.locator("#source-file").setInputFiles(readings);
    await expect(page.getByText("Circuito «auditoria»")).toBeVisible({ timeout: 120_000 });
    await page
      .locator("#lists-file")
      .setInputFiles({ name: "listas.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.listsCsv, "utf8") });
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 30_000 });
    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles(readings);
    await expect(page.locator(".finding", { hasText: "Nadie entró en" }).first()).toBeVisible({ timeout: 180_000 });

    // La bandeja tiene tantas tarjetas como hallazgos cuenta la barra, y ninguna queda en su sección.
    const bar = page.locator(".review-bar");
    await expect(bar).toContainText(/Revisados 0 de \d+/);
    const total = Number(/Revisados 0 de (\d+)/.exec((await bar.textContent()) ?? "")?.[1] ?? "0");
    expect(total).toBeGreaterThan(10);
    const tray = page.locator(".tray");
    expect(await tray.locator(".finding.reviewable").count()).toBe(total);
    expect(await page.locator(".finding.reviewable").count()).toBe(total);
    // Por rango: lo que puede parar la planta va delante de lo que degrada.
    const ranks = await tray.locator(".tray-group").evaluateAll((groups) => groups.map((group) => (group as HTMLElement).dataset["rank"]));
    expect(ranks).toEqual([...ranks].sort());
    expect(ranks[0]).toBe("1");

    // El filtro por tema esconde las tarjetas de los demás temas.
    await page.getByRole("group", { name: "Tema" }).getByRole("button", { name: "Tiempos" }).click();
    const visibleThemes = await tray
      .locator(".finding.reviewable:not([hidden])")
      .evaluateAll((cards) => [...new Set(cards.map((card) => (card as HTMLElement).dataset["theme"]))]);
    expect(visibleThemes).toEqual(["tiempos"]);
    await page.getByRole("group", { name: "Tema" }).getByRole("button", { name: "Todos los temas" }).click();
    expect(await tray.locator(".finding.reviewable:not([hidden])").count()).toBe(total);

    // Una sección conserva su contexto con la línea que lleva a la bandeja; sin repetir la tarjeta.
    await openTab(page, "Línea y calles");
    const elsewhere = page.locator("#panel-linea .findings-elsewhere").first();
    await expect(elsewhere).toBeVisible();
    await expect(elsewhere).toContainText(/\d+ hallazgos? de esta sección/);
    await elsewhere.getByRole("link", { name: "ver en Resumen" }).click();
    await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("group", { name: "Tema" }).getByRole("button", { name: "Todos los temas" }).click();

    // «Ver evidencia» activa la pestaña de la sección y la deja a la vista.
    const lane = page.locator(".finding", { hasText: "Nadie entró en" }).first();
    await lane.getByRole("link", { name: /Ver evidencia/ }).click();
    await expect(page.getByRole("tab", { name: "Línea y calles" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Calles de carga", exact: true })).toBeInViewport();
    await expect(page).toHaveURL(/#linea$/);

    // El control compacto: un botón con el estado, un menú con los cuatro y la nota.
    await openTab(page, "Resumen");
    const control = lane.getByRole("button", { name: /Revisión en campo/ });
    await expect(control).toContainText("Pendiente");
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await control.click();
    await expect(control).toHaveAttribute("aria-expanded", "true");
    const menu = lane.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
    await menu.getByRole("menuitemradio", { name: /Confirmado/ }).click();
    await expect(lane).toHaveAttribute("data-review", "confirmado");
    await expect(control).toContainText("Confirmado");
    await expect(bar).toContainText(new RegExp(`Revisados 1 de ${total}`));
    await page.keyboard.press("Escape");
    await expect(control).toHaveAttribute("aria-expanded", "false");

    // Con teclado: flecha abajo abre el menú en el estado actual, flechas mueven, Enter elige.
    await control.focus();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name: /Confirmado/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name: /Descartado/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(lane).toHaveAttribute("data-review", "descartado");
    await page.keyboard.press("Escape");
    await expect(control).toBeFocused();

    // «Siguiente pendiente» lleva el foco al control de la tarjeta.
    await bar.getByRole("button", { name: "Siguiente pendiente" }).click();
    await expect(page.locator(".finding.reviewable[data-review='pendiente'] .review-toggle:focus")).toHaveCount(1);

    // Las flechas mueven entre pestañas, y el hash sigue a la activa.
    await page.getByRole("tab", { name: "Resumen" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Tags" })).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/#tags$/);
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Datos" })).toHaveAttribute("aria-selected", "true");

    // Recargar conserva la pestaña.
    await openTab(page, "Tiempos");
    await expect(page).toHaveURL(/#tiempos$/);
    await page.reload();
    await expect(page.getByRole("tab", { name: "Tiempos" })).toHaveAttribute("aria-selected", "true");
    // Sin importar nada la pestaña está vacía, pero es la activa: no lleva `hidden`.
    await expect(page.locator("#panel-tiempos")).toHaveJSProperty("hidden", false);
    await expect(page.locator("#panel-resumen")).toHaveJSProperty("hidden", true);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
