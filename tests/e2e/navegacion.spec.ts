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
    // Sin nada cargado ya hay pestañas, y la de entrada es el Resumen. La WiFi no está: solo existe con
    // un registro de conexiones cargado (3.69.0), y pedirla por el hash vuelve al Resumen.
    await page.goto("./#wifi");
    await expect(page.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveText(["Resumen", "Tags", "AGV", "Tiempos", "Línea y calles", "Memoria", "Datos"]);
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

    // Cada hallazgo que guarda la instantánea del fichero —los que cuentan al consolidar— tiene su
    // tarjeta revisable en la bandeja, aunque su sección solo enseñe los primeros de su tipo (3.57.0).
    // Sin ella quedaría pendiente para siempre y la consolidación no se podría hacer nunca.
    const snapshotKeys = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("tag-trace");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const rows = await new Promise<{ circuitId: string; snapshot: { findings: { key: string }[] } }[]>((resolve, reject) => {
          const request = db.transaction("snapshots", "readonly").objectStore("snapshots").getAll();
          request.onsuccess = () => resolve(request.result as { circuitId: string; snapshot: { findings: { key: string }[] } }[]);
          request.onerror = () => reject(request.error);
        });
        return rows.filter((row) => row.circuitId === "auditoria").flatMap((row) => row.snapshot.findings.map((item) => item.key));
      } finally {
        db.close();
      }
    });
    expect(snapshotKeys.length).toBeGreaterThan(0);
    const cardKeys = new Set(
      await page.locator(".tray .finding.reviewable").evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset["reviewKey"] ?? "")),
    );
    expect(snapshotKeys.filter((key) => !cardKeys.has(key))).toEqual([]);

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
    // Limpieza y contexto (rango 3) va plegado, con su recuento; lo que puede parar la planta o
    // degradar el circuito, a la vista (3.70.0).
    const fold = tray.locator("details.tray-fold");
    await expect(fold).toHaveCount(1);
    await expect(fold).not.toHaveAttribute("open", "");
    await expect(fold.locator("summary")).toHaveText(/Limpieza y contexto: \d+ hallazgos?/);
    expect(await fold.locator(".tray-group[data-rank='3']").count()).toBe(1);
    expect(await tray.locator(".tray-group[data-rank='1'] h3.tray-rank").count()).toBe(1);

    // La conclusión antes de las cifras (3.72.0, FR-028): una frase de estado con su contexto, y los
    // saltos locales. Con el circuito de auditoría hay rango 1 pendiente, así que es alerta.
    const estado = page.locator(".status-host .status");
    await expect(estado).toHaveText(/pueden parar la planta o perder una función/);
    await expect(estado).toHaveClass(/status-alerta/);
    await expect(page.locator(".status-host .status-detail")).toHaveText(/cobertura de .* · .*hallazgos revisados\./);
    await page.locator(".local-jumps").getByRole("button", { name: "Hallazgos" }).click();
    await expect(page.getByRole("heading", { name: "Hallazgos", exact: true })).toBeInViewport();

    // «Generar informe…» (3.72.0, FR-026): el cuadro deja elegir secciones y hallazgos; el fichero es un
    // HTML autocontenido con la conclusión, los avisos, los hallazgos con su estado y las secciones
    // elegidas, sin nada que salga del dispositivo.
    await page.locator(".local-jumps").getByRole("button", { name: "Generar informe…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Generar informe" })).toBeVisible();
    await expect(dialog.locator("input[name='section'][value='wifi']")).toBeDisabled();
    await dialog.locator("input[name='section'][value='tiempos']").uncheck();
    const [informe] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Generar y descargar" }).click()]);
    expect(informe.suggestedFilename()).toMatch(/^informe-auditoria-\d{4}-\d{2}-\d{2}-\d{4}\.html$/);
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(await informe.path(), "utf8");
    expect(html).toContain("<h1>Circuito «auditoria»</h1>");
    expect(html).toContain('<section id="conclusion">');
    expect(html).toContain('id="avisos"');
    expect(html).toContain('id="hallazgos"');
    expect(html).toContain('id="seccion-tags"');
    expect(html).toContain('id="seccion-agv"');
    expect(html).not.toContain('id="seccion-tiempos"');
    expect(html).toContain("Revisión en campo: ○ Pendiente");
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    expect(html).not.toContain("<button");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Informe generado" })).toBeVisible();

    // Los avisos del Resumen: lo que falta o no se pudo usar, con el enlace a su sitio (3.70.0). Sin
    // registro de conexiones, lo dice y lleva a Datos.
    const avisos = page.locator(".notices-host");
    await expect(avisos.getByRole("heading", { name: "Avisos" })).toBeVisible();
    const sinRegistro = avisos.locator("li", { hasText: "Sin registro de conexiones" });
    await expect(sinRegistro).toHaveCount(1);
    await sinRegistro.getByRole("link", { name: "ver en Datos" }).click();
    await expect(page.getByRole("tab", { name: "Datos" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Listas del circuito", exact: true })).toBeInViewport();
    await openTab(page, "Resumen");

    // El filtro por tema esconde las tarjetas de los demás temas.
    await page.getByRole("group", { name: "Tema" }).getByRole("button", { name: "Tiempos" }).click();
    const visibleThemes = await tray
      .locator(".finding.reviewable:not([hidden])")
      .evaluateAll((cards) => [...new Set(cards.map((card) => (card as HTMLElement).dataset["theme"]))]);
    expect(visibleThemes).toEqual(["tiempos"]);
    await page.getByRole("group", { name: "Tema" }).getByRole("button", { name: "Todos los temas" }).click();
    expect(await tray.locator(".finding.reviewable:not([hidden])").count()).toBe(total);

    // «Problemas detectados» abre Tags y AGV (3.71.0): el índice por tipo, con su rango y su recuento,
    // y cada línea lleva a la sección que lo detalla. En Tags los problemas van antes que el inventario.
    await openTab(page, "Tags");
    const indice = page.locator("#panel-tags .problem-index");
    await expect(indice.getByRole("heading", { name: "Problemas detectados" })).toBeVisible();
    const lineas = indice.locator(".problem-list li");
    expect(await lineas.count()).toBeGreaterThan(0);
    await expect(lineas.first()).toContainText(/\d+ × /);
    const sectionLink = lineas.first().getByRole("link", { name: /^ver en «/ });
    const sectionTitle = (await sectionLink.textContent())?.replace(/^ver en «|»$/g, "") ?? "";
    await sectionLink.click();
    await expect(page.getByRole("heading", { name: sectionTitle, exact: true })).toBeInViewport();
    const tagsOrder = await page.locator("#panel-tags h3, #panel-tags figure.chart h3").evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
    expect(tagsOrder.indexOf("Lo que hay que mirar")).toBeLessThan(tagsOrder.indexOf("Inventario de tags"));
    await openTab(page, "AGV");
    await expect(page.locator("#panel-agv .problem-index").getByRole("heading", { name: "Problemas detectados" })).toBeVisible();
    const agvOrder = await page.locator("#panel-agv h3").evaluateAll((nodes) => nodes.map((node) => node.textContent ?? ""));
    expect(agvOrder.indexOf("Lectura de cada AGV")).toBeLessThan(agvOrder.indexOf("Flota del circuito"));
    await openTab(page, "Resumen");

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

  test.describe("en un móvil de 390 px, con datos cargados", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    // La prueba de arriba mide el desborde sin importar nada, cuando la barra de revisión está oculta.
    // Hasta 3.54.0, con datos, «Siguiente pendiente» quedaba 146 px fuera de la pantalla: con cero
    // hallazgos, el título «Revisión: no hay hallazgos que revisar.» no se partía y lo empujaba.
    test("ninguna pestaña desborda, con y sin hallazgos que revisar", async ({ page }) => {
      const { fileURLToPath } = await import("node:url");
      const memoria = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));
      const tabs = ["Resumen", "Tags", "AGV", "Tiempos", "Línea y calles", "Memoria", "Datos"] as const;
      const overflowIn = async (): Promise<Record<string, number>> => {
        const result: Record<string, number> = {};
        for (const tab of tabs) {
          await openTab(page, tab);
          result[tab] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        }
        return result;
      };
      const importPeriod = async (): Promise<void> => {
        await openTab(page, "Resumen");
        await page.locator("#circuit-name").fill("movil");
        await page.locator("#source-file").setInputFiles([]);
        await page.locator("#source-file").setInputFiles(`${memoria}periodo-1.csv`);
        await expect(page.getByRole("heading", { name: "Circuito «movil»", exact: true })).toBeVisible({ timeout: 15_000 });
      };

      await freshPage(page);
      // Sin listas no hay hallazgos: la barra lo dice y no ofrece un salto que no lleva a nada.
      await importPeriod();
      const bar = page.locator(".review-bar");
      await expect(bar).toContainText("no hay hallazgos que revisar");
      await expect(bar.getByRole("button", { name: "Siguiente pendiente" })).toBeHidden();
      expect(await overflowIn()).toEqual(Object.fromEntries(tabs.map((tab) => [tab, 0])));

      // Con las listas aparece un hallazgo: el botón vuelve, y tampoco desborda.
      await page.locator("#lists-file").setInputFiles(`${memoria}listas.csv`);
      await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });
      await importPeriod();
      await expect(bar.getByRole("button", { name: "Siguiente pendiente" })).toBeVisible();
      expect(await overflowIn()).toEqual(Object.fromEntries(tabs.map((tab) => [tab, 0])));
    });
  });
});
