/**
 * Tableta y portátil, con dedo, ratón o panel táctil (UX_SPEC §7).
 *
 * Lo que se fija, en una tableta emulada con pantalla táctil y el circuito de auditoría cargado:
 * un toque en un gráfico fija su lectura y la lectura **sigue ahí** al levantar el dedo (antes el
 * `pointerleave` del propio toque la borraba); un toque a pocos píxeles de una marca fina la lee
 * igual; un toque en un hueco vuelve al reposo; con el ratón todo sigue como antes; los botones miden
 * 44 px con dedo; y ninguna anchura de tableta o de portátil desborda la página.
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

test.describe("tableta táctil y portátil", () => {
  test.setTimeout(300_000);
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test("el dedo lee los gráficos y la lectura se queda; el ratón sigue igual; nada desborda", async ({ page }) => {
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
    await expect(page.locator(".finding", { hasText: "Nadie entró en" }).first()).toBeVisible({ timeout: 180_000 });

    expect(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches)).toBe(true);

    const figureOf = (title: string) =>
      page.locator("figure.chart", { has: page.getByRole("heading", { name: title }) }).first();

    // Vida de cada AGV: un toque en una fila escribe su AGV, y la lectura se queda.
    await openTab(page, "AGV");
    const lifeline = figureOf("Vida de cada AGV en el circuito");
    const lifelineCanvas = lifeline.locator("canvas");
    // En una fila de en medio del lienzo, no en la primera: arriba están fijas la barra de pestañas
    // y la de revisión, y el borde superior del lienzo puede quedar debajo de ellas.
    await lifelineCanvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const box = (await lifelineCanvas.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.touchscreen.tap(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const lifelineReadout = lifeline.locator(".readout");
    await expect(lifelineReadout).toContainText(/71\d\d/);
    await page.waitForTimeout(400);
    await expect(lifelineReadout).toContainText(/71\d\d/);

    // Anillo (en Resumen desde 3.49.0): un toque cerca de un segmento, sin caer encima de ninguna marca,
    // lo toca igual —el navegador ajusta el toque al objetivo más cercano, y cada segmento es un botón—
    // y abre su expediente: el buscador se rellena con el tag y AGV se activa.
    await openTab(page, "Resumen");
    const ring = figureOf("Anillo del circuito");
    await ring.scrollIntoViewIfNeeded();
    const near = await ring.evaluate((root) => {
      const marks = "[data-index],[data-mark],[data-lane]";
      const segment = root.querySelector('[data-index="40"]') as Element;
      const rect = segment.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let radius = 6; radius <= 18; radius += 2) {
        for (let step = 0; step < 16; step += 1) {
          const angle = (step / 16) * Math.PI * 2;
          const x = cx + Math.cos(angle) * (rect.width / 2 + radius);
          const y = cy + Math.sin(angle) * (rect.height / 2 + radius);
          const hit = document.elementFromPoint(x, y);
          if (hit !== null && root.contains(hit) && hit.closest(marks) === null) return { x, y };
        }
      }
      return null;
    });
    expect(near).not.toBeNull();
    await page.touchscreen.tap(near?.x as number, near?.y as number);
    await expect(page.getByRole("tab", { name: "AGV" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#dossier-search")).toHaveValue(/^\d+$/);
    await expect(page.getByRole("heading", { name: /^Tag \d+$/ })).toBeVisible();

    // Un toque en el centro del anillo, lejos de toda marca, vuelve al texto de reposo.
    await openTab(page, "Resumen");
    const ringReadout = ring.locator(".readout");
    const ringSvg = (await ring.locator("svg").first().boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.touchscreen.tap(ringSvg.x + ringSvg.width / 2, ringSvg.y + ringSvg.height / 2);
    await expect(ringReadout).toHaveText("Toca o pasa el puntero por el anillo para leer un tag; tocar un tag abre su expediente.");

    // Con dedo, los botones de los gráficos miden al menos 44 px.
    await openTab(page, "Tags");
    const heatmapButton = figureOf("Mapa de omisión tag × AGV").getByRole("button", { name: "Peor omisión primero" });
    expect(((await heatmapButton.boundingBox()) as { height: number }).height).toBeGreaterThanOrEqual(44);

    // Con ratón (o panel táctil), la lectura sigue al puntero y se va al salir, como antes.
    await openTab(page, "AGV");
    await lifelineCanvas.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const again = (await lifelineCanvas.boundingBox()) as { x: number; y: number; width: number; height: number };
    await page.mouse.move(again.x + again.width * 0.6, again.y + again.height * 0.5);
    await expect(lifelineReadout).toContainText(/71\d\d/);
    await page.mouse.move(again.x + again.width * 0.6, again.y + again.height + 40);
    await expect(lifelineReadout).toHaveText("Toca o pasa el puntero por una fila para leer el tramo.");

    // Tableta en vertical y apaisada, y tres portátiles: ninguna anchura desborda la página.
    for (const [width, height] of [
      [768, 1024],
      [1024, 768],
      [1366, 768],
      [1536, 864],
      [1920, 1080],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${width}×${height}`).toBeLessThanOrEqual(0);
    }
  });
});
