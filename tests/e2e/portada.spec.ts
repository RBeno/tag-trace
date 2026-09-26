/**
 * La portada (UX_SPEC §2, §4.2, §5.3; 3.49.0), en un navegador de verdad.
 *
 * Lo que se fija, con el circuito de auditoría cargado: la tira de seis cifras y que la de hallazgos
 * coincide con la barra «Revisados 0 de N»; que cada tile lleva a su pestaña; que el selector de capas
 * cambia la leyenda del anillo y que tocar un tag rellena el buscador y activa AGV; y que el cajón de
 * tablas abre con el foco dentro, enseña la tabla, cierra con Escape y devuelve el foco. En el móvil,
 * el cajón ocupa la pantalla y no hay desborde horizontal.
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

async function loadAudit(page: Page): Promise<void> {
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
}

test.describe("portada: cifras, anillo con capas y cajón de tablas", () => {
  test.setTimeout(300_000);

  test("seis tiles, el anillo con sus capas y el cajón, en escritorio", async ({ page }) => {
    await loadAudit(page);

    // Seis tiles con su cifra, y el de hallazgos dice lo mismo que la barra de revisión.
    const tiles = page.locator(".tiles [role='listitem'] .tile");
    await expect(tiles).toHaveCount(6);
    const labels = await tiles.locator(".tile-label").allTextContents();
    expect(labels).toEqual(["AGV en el circuito", "Tags en el anillo", "Cobertura", "Hallazgos", "Vuelta", "Línea"]);
    for (const value of await tiles.locator(".tile-value").allTextContents()) expect(value).toMatch(/\d/);
    const bar = page.locator(".review-bar");
    const total = Number(/Revisados 0 de (\d+)/.exec((await bar.textContent()) ?? "")?.[1] ?? "0");
    expect(total).toBeGreaterThan(10);
    const findingsTile = page.locator(".tile[data-tile='hallazgos']");
    await expect(findingsTile.locator(".tile-value")).toHaveText(`${total} de ${total}`);
    await expect(findingsTile.locator(".tile-note")).toContainText(/\d+ pueden? parar la planta/);
    await expect(findingsTile).toHaveClass(/attn/);
    // La cifra de tags es la del anillo, y la de la vuelta es la de «Mediciones por fichero».
    await expect(page.locator(".tile[data-tile='tags'] .tile-value")).toHaveText("145");
    await expect(page.locator(".tile[data-tile='vuelta'] .tile-value")).toHaveText(/\d+ min/);

    // Pulsar el tile de la vuelta activa Tiempos y deja «Mediciones por fichero» a la vista.
    await page.locator(".tile[data-tile='vuelta']").click();
    await expect(page.getByRole("tab", { name: "Tiempos" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Mediciones por fichero" })).toBeInViewport();
    await openTab(page, "Resumen");

    // El anillo está en el Resumen, con su selector de capas; cambiar la capa cambia la leyenda.
    const ring = page.locator("figure.chart", { has: page.getByRole("heading", { name: "Anillo del circuito" }) });
    await expect(ring).toBeVisible();
    const layers = ring.getByRole("radiogroup", { name: "Capa del anillo" });
    await expect(layers.getByRole("radio")).toHaveCount(4);
    await expect(layers.getByRole("radio", { name: "Omisión" })).toHaveAttribute("aria-checked", "true");
    await expect(ring.locator(".ring-legend")).toContainText("omisión menos del 5 %");
    await layers.getByRole("radio", { name: "Tramos" }).click();
    await expect(layers.getByRole("radio", { name: "Tramos" })).toHaveAttribute("aria-checked", "true");
    await expect(ring.locator(".ring-legend")).toContainText("tramo kitting");
    await expect(ring.locator(".ring-legend")).not.toContainText("omisión");
    await layers.getByRole("radio", { name: "Paradas" }).click();
    await expect(ring.locator(".ring-legend")).toContainText("incidencias: ninguna");
    await layers.getByRole("radio", { name: "Calles" }).click();
    await expect(ring.locator(".ring-legend")).toContainText("entrada de una calle servida");
    // Con teclado: la flecha cambia de capa.
    await layers.getByRole("radio", { name: "Calles" }).focus();
    await page.keyboard.press("ArrowLeft");
    await expect(layers.getByRole("radio", { name: "Paradas" })).toHaveAttribute("aria-checked", "true");
    // La lectura al tocar dice lo de la capa activa.
    await ring.locator("path[data-index='2']").hover();
    await expect(ring.locator(".readout")).toContainText(/Tag \d+ · posición 3 de 145 .*— /);

    // Tocar un tag abre su expediente: rellena el buscador y activa AGV.
    const tagId = (await ring.locator("path[data-index='3']").getAttribute("aria-label") ?? "").replace(/^Tag (\S+),.*$/, "$1");
    await ring.locator("path[data-index='3']").dispatchEvent("click");
    await expect(page.getByRole("tab", { name: "AGV" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#dossier-search")).toHaveValue(tagId);
    await expect(page.getByRole("heading", { name: `Tag ${tagId}` })).toBeVisible();
    // Y con Enter sobre el segmento con foco.
    await openTab(page, "Resumen");
    await ring.locator("path[data-index='0']").focus();
    await page.keyboard.press("ArrowRight");
    await expect(ring.locator("path[data-index='1']")).toBeFocused();
    const secondTag = (await ring.locator("path[data-index='1']").getAttribute("aria-label") ?? "").replace(/^Tag (\S+),.*$/, "$1");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "AGV" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#dossier-search")).toHaveValue(secondTag);

    // El cajón: abre con el foco dentro, enseña la tabla, cierra con Escape y devuelve el foco.
    await openTab(page, "Tiempos");
    const opener = page.getByRole("button", { name: /Ver los \d+ tags del anillo, en orden/ });
    await opener.click();
    const drawer = page.locator("aside.drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAttribute("aria-modal", "false");
    await expect(drawer.locator("#drawer-title")).toHaveText(/Ver los \d+ tags del anillo, en orden/);
    await expect(drawer.locator(".drawer-where")).toHaveText("El anillo del circuito");
    expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await expect(drawer.locator("table.data tr")).toHaveCount(146);
    // La página sigue visible detrás: el cajón ocupa el tercio derecho.
    const box = (await drawer.boundingBox()) as { x: number; width: number };
    const viewport = page.viewportSize() as { width: number };
    expect(box.x).toBeGreaterThan(viewport.width * 0.5);
    expect(box.x + box.width).toBeCloseTo(viewport.width, -1);
    // Abrir otra tabla sustituye a la anterior en el mismo cajón.
    await page.getByRole("button", { name: /Ver los \d+ tags fuera del anillo/ }).click();
    await expect(page.locator("aside.drawer")).toHaveCount(1);
    await expect(drawer.locator("#drawer-title")).toHaveText(/tags fuera del anillo/);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("button", { name: /Ver los \d+ tags fuera del anillo/ })).toBeFocused();
    // El botón «Cerrar» hace lo mismo y devuelve el foco al botón que abrió.
    await opener.click();
    await drawer.getByRole("button", { name: "Cerrar" }).click();
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();

    // Ningún desplegable de tabla queda en la página: los `details` que quedan son de texto corto.
    const details = await page.locator("details summary").allTextContents();
    expect(details.every((text) => !/^Ver |^Detalle de/.test(text))).toBe(true);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test.describe("dedo", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("en el móvil, dos columnas de tiles y el cajón a pantalla completa, sin desborde", async ({ page }) => {
      await loadAudit(page);

      // Dos columnas: el segundo tile está a la derecha del primero, y el tercero debajo.
      const tiles = page.locator(".tiles .tile");
      await expect(tiles).toHaveCount(6);
      const boxes = await tiles.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, h: r.height }; }));
      expect(boxes[1]?.x ?? 0).toBeGreaterThan(boxes[0]?.x ?? 0);
      expect(boxes[2]?.y ?? 0).toBeGreaterThan(boxes[0]?.y ?? 0);
      expect(Math.abs((boxes[0]?.h ?? 0) - (boxes[1]?.h ?? 0))).toBeLessThan(2);

      await openTab(page, "Tiempos");
      await page.getByRole("button", { name: /Ver los \d+ tags del anillo, en orden/ }).click();
      const drawer = page.locator("aside.drawer");
      await expect(drawer).toBeVisible();
      const box = (await drawer.boundingBox()) as { x: number; width: number; height: number };
      expect(box.x).toBe(0);
      expect(box.width).toBe(390);
      expect(box.height).toBe(844);
      await expect(drawer.locator("table.data")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      const overflowAfter = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowAfter).toBeLessThanOrEqual(0);
    });
  });
});
