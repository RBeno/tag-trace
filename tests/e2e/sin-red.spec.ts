/**
 * El flujo entero sin red (NFR-001, NFR-010, TH-002; F6, entrega 6).
 *
 * Se abre la aplicación, el service worker guarda su versión y **se corta la red**. Sin ella se recorre
 * todo lo que hace una persona: importar dos periodos con sus listas, revisar y consolidar, crear un
 * expediente y ver su replay, descargar su informe y sus CSV y el informe del circuito, exportar el
 * `.agvproj` y volver a abrirlo, y borrar el circuito. Lo que se fija:
 * - todo funciona sin red;
 * - **ninguna** petición sale del propio origen, de la página ni de sus Workers;
 * - ninguna acción choca con la política de contenido publicada, que niega toda conexión
 *   (`connect-src 'none'`) y solo admite Workers del propio origen.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));
const ORIGIN = "http://127.0.0.1:4173";

async function importInto(page: Page, circuit: string, path: string): Promise<void> {
  await openTab(page, "Resumen");
  await page.locator("#circuit-name").fill(circuit);
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles(path);
  await expect(page.getByRole("heading", { name: `Circuito «${circuit}»`, exact: true })).toBeVisible({ timeout: 15_000 });
}

test.describe("sin red", () => {
  test.setTimeout(240_000);

  test("el flujo entero funciona sin red, sin una sola petición fuera del origen y sin chocar con la política de contenido", async ({ page, context }) => {
    const outside: string[] = [];
    context.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== ORIGIN && url.protocol !== "blob:" && url.protocol !== "data:") outside.push(request.url());
    });
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __csp: string[] }).__csp = seen;
      document.addEventListener("securitypolicyviolation", (event) => seen.push(`${event.violatedDirective} ${event.blockedURI}`));
    });

    // Con red, solo para que el service worker guarde esta versión; después, nunca más.
    await page.goto("./");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".app-version")).toBeVisible();

    // Importar dos periodos y las listas.
    await importInto(page, "sin-red", `${MEMORIA}periodo-1.csv`);
    await page.locator("#lists-file").setInputFiles(`${MEMORIA}listas.csv`);
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });
    await importInto(page, "sin-red", `${MEMORIA}periodo-2.csv`);

    // Revisar lo que haya y consolidar.
    for (const fold of await page.locator("details.tray-fold").all()) {
      if ((await fold.getAttribute("open")) === null) await fold.locator("summary").click();
    }
    const cards = page.locator(".finding.reviewable");
    for (let index = 0; index < (await cards.count()); index += 1) {
      const card = cards.nth(index);
      const critical = (await card.locator("xpath=ancestor::*[contains(@class,'tray-group')]").getAttribute("data-rank")) === "1";
      await card.getByRole("button", { name: /Revisión en campo/ }).click();
      await card.getByRole("menuitemradio", { name: critical ? /Descartado/ : /Confirmado/ }).click();
      await page.keyboard.press("Escape");
    }
    await openTab(page, "Memoria");
    const memory = page.locator(".memory-panel");
    await memory.getByRole("button", { name: /^Previsualizar v\d+$/ }).click();
    await expect(memory.locator(".memory-preview")).toBeVisible({ timeout: 15_000 });
    await memory.locator(".memory-preview").getByRole("button", { name: "Confirmar y consolidar" }).click();
    await expect(memory.locator(".memory-status")).toContainText("consolidada", { timeout: 15_000 });

    // Un expediente, su replay, su informe y sus CSV.
    await openTab(page, "Línea y calles");
    const cases = page.locator(".cases-panel");
    await cases.getByRole("button", { name: "Nuevo expediente…" }).click();
    const form = cases.locator(".case-create");
    await form.getByLabel("Título").fill("Sin paso por 0300");
    await form.getByLabel("Síntoma: qué ocurrió, dónde y cuándo").fill("Nadie pasa por el tag 0300 en dos minutos.");
    await form.getByLabel("Principio del síntoma").fill("2026-01-25T08:01");
    await form.getByLabel("Fin del síntoma").fill("2026-01-25T08:03");
    await form.getByLabel("Tags (opcionales, separados por comas)").fill("0300");
    await form.getByRole("button", { name: "Crear expediente" }).click();
    await expect(cases.locator(".cases-status")).toContainText("creado en borrador", { timeout: 15_000 });
    const item = cases.locator(".case-item").first();
    await item.getByRole("button", { name: "Ver el replay" }).click();
    await expect(item.locator(".case-replay-table")).toBeVisible({ timeout: 15_000 });
    for (const name of ["Informe del expediente", "Cronología (CSV)", "Lecturas del recorte (CSV)"]) {
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), item.getByRole("button", { name }).click()]);
      expect(readFileSync(await download.path(), "utf8").length, name).toBeGreaterThan(0);
    }

    // El informe del circuito.
    await openTab(page, "Resumen");
    await page.locator(".local-jumps").getByRole("button", { name: "Generar informe…" }).click();
    const [report] = await Promise.all([page.waitForEvent("download"), page.getByRole("dialog").getByRole("button", { name: "Generar y descargar" }).click()]);
    expect(readFileSync(await report.path(), "utf8")).toContain("<html");

    // Exportar el `.agvproj` y volver a abrirlo.
    await openTab(page, "Datos");
    const [project] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar circuito (.agvproj)" }).click()]);
    await page.locator("#project-file").setInputFiles(await project.path());
    await expect(page.getByText("Integridad verificada")).toBeVisible({ timeout: 15_000 });

    // Y borrarlo.
    await page.locator(".storage").getByRole("button", { name: "Borrar el circuito…" }).click();
    await page.getByLabel("Para confirmar, escribe «sin-red»").fill("sin-red");
    await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Borrar para siempre" }).click()]);
    await expect(page.getByRole("heading", { name: "Circuito «sin-red» borrado" })).toBeVisible();

    expect(outside, "peticiones fuera del origen").toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), "choques con la política de contenido").toEqual([]);
    await context.setOffline(false);
  });
});
