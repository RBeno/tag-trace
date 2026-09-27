/**
 * El plano físico del circuito (ADR-0016), en un navegador de verdad: la sección «Plano del circuito»
 * de la pestaña Memoria.
 *
 * Lo que se fija: que el plano nace de una versión consolidada con un botón y una razón escrita; que
 * una ubicación cuyo tag no se lee sigue en el plano como «sin leer» y la evolución lo dice así; que
 * una sustitución sale como propuesta sin escribirse y solo al confirmarla la misma ubicación cambia
 * de tag conservando su historia; que una parada por salida de circuito se ubica eligiendo de qué
 * ubicación cuelga y se revisa a mano; y que los tramos se enseñan con sus pasadas y su media. Ninguna
 * de estas pruebas cambia el plano sin pulsar el botón que pulsaría la persona.
 *
 * Los ficheros son los de `fixtures/synthetic/memoria/`, con `listas-plano.csv` (las listas de la
 * memoria más la parada de salida `0900`, que nunca se lee).
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));

/** Cada prueba empieza con el almacén vacío y sin service worker: el plano vive en IndexedDB. */
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

/** Como en `memoria.spec.ts`, pero con las listas que declaran la parada de salida `0900`. */
async function prepareCircuit(page: Page): Promise<void> {
  await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
  await page.locator("#lists-file").setInputFiles([]);
  await page.locator("#lists-file").setInputFiles(`${MEMORIA}listas-plano.csv`);
  await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });
  await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
  await expect(page.locator(".finding.reviewable").first()).toBeVisible();
}

/** Las de rango 1 se descartan y el resto se confirma, para que el periodo sea normal. */
async function reviewAll(page: Page): Promise<void> {
  const cards = page.locator(".finding.reviewable");
  const total = await cards.count();
  for (let index = 0; index < total; index += 1) {
    const card = cards.nth(index);
    const critical = (await card.locator("xpath=ancestor::*[contains(@class,'tray-group')]").getAttribute("data-rank")) === "1";
    await card.getByRole("button", { name: /Revisión en campo/ }).click();
    await card.getByRole("menuitemradio", { name: critical ? /Descartado/ : /Confirmado/ }).click();
    await page.keyboard.press("Escape");
    await expect(card).toHaveAttribute("data-review", critical ? "descartado" : "confirmado");
  }
}

async function consolidateFirst(page: Page): Promise<void> {
  await openTab(page, "Memoria");
  await page.getByRole("button", { name: "Previsualizar v1" }).click();
  const preview = page.locator(".memory-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator(".memory-blockers")).toHaveCount(0);
  await preview.getByRole("button", { name: "Confirmar y consolidar" }).click();
  await expect(page.locator(".memory-status")).toContainText("Versión v1 consolidada", { timeout: 15_000 });
}

/** Crea el plano desde v1 con su razón; devuelve la sección. */
async function createPlan(page: Page): Promise<Locator> {
  await openTab(page, "Memoria");
  const panel = page.locator(".plan-panel");
  await panel.getByRole("button", { name: "Crear el plano desde v1" }).click();
  const send = panel.locator(".plan-send");
  await expect(send).toHaveText("Crear el plano desde v1");
  await panel.locator(".plan-reason").fill("La versión v1 es un periodo normal revisado");
  await send.click();
  await expect(panel.locator(".plan-status")).toContainText("Plano actualizado", { timeout: 15_000 });
  return panel;
}

async function planned(page: Page): Promise<Locator> {
  await freshPage(page);
  await prepareCircuit(page);
  await reviewAll(page);
  await consolidateFirst(page);
  return createPlan(page);
}

/** El identificador de la ubicación del anillo que tiene instalado ese tag. */
async function locationOf(panel: Locator, tagId: string): Promise<string> {
  const row = panel.locator(".plan-location").filter({ has: panel.page().locator(".plan-tag", { hasText: new RegExp(`^${tagId}$`) }) });
  await expect(row).toHaveCount(1);
  return (await row.getAttribute("data-location")) ?? "";
}

test.describe("plano físico", () => {
  test.setTimeout(150_000);

  test("tras consolidar v1 se ofrece crear el plano, exige razón y enseña las ubicaciones", async ({ page }) => {
    await freshPage(page);
    await prepareCircuit(page);
    await reviewAll(page);
    await consolidateFirst(page);

    const panel = page.locator(".plan-panel");
    await expect(panel.getByRole("heading", { name: "Plano del circuito" })).toBeVisible();
    await expect(panel).toContainText("sustituir un tag no la borra");
    const open = panel.getByRole("button", { name: "Crear el plano desde v1" });
    await expect(open).toBeVisible();
    await open.click();
    // Sin razón no se envía nada.
    const send = panel.locator(".plan-send");
    await expect(send).toBeDisabled();
    await panel.locator(".plan-reason").fill("   ");
    await expect(send).toBeDisabled();
    await panel.locator(".plan-reason").fill("La versión v1 es un periodo normal revisado");
    await expect(send).toBeEnabled();
    await send.click();

    await expect(panel.locator(".plan-status")).toContainText("Plano actualizado", { timeout: 15_000 });
    const locations = panel.locator(".plan-location");
    await expect(locations).toHaveCount(4);
    await expect(locations.first().locator(".plan-id")).toHaveText(/^U-\d{4}$/);
    await expect(panel.locator(".plan-location[data-location='U-0001']")).toBeVisible();
    for (const tagId of ["0100", "0200", "0300", "0400"]) await locationOf(panel, tagId);
    await expect(panel.locator(".plan-figures")).toContainText("4 ubicaciones en el anillo");
    await expect(panel.getByRole("heading", { name: "Historial del plano" })).toBeVisible();
    await expect(panel.locator(".plan-event")).toHaveCount(1);
    await expect(panel.locator(".plan-event")).toContainText("La versión v1 es un periodo normal revisado");
    // Ya no se ofrece crear otro.
    await expect(panel.getByRole("button", { name: /Crear el plano/ })).toHaveCount(0);
  });

  test("un tag que no se lee sigue en el plano como «sin leer», y la evolución no dice que desaparece", async ({ page }) => {
    const panel = await planned(page);
    const location = await locationOf(panel, "0300");

    await importInto(page, "memoria", `${MEMORIA}periodo-3.csv`);
    await openTab(page, "Memoria");
    await expect(panel.locator(".plan-location")).toHaveCount(4);
    const row = panel.locator(`.plan-location[data-location='${location}']`);
    await expect(row.locator(".plan-tag")).toHaveText("0300");
    await expect(row).toHaveAttribute("data-state", "no-observado");
    await expect(row.locator(".plan-state")).toHaveText(/^sin leer: \d+ pasadas? por su sitio/);
    await expect(row.locator(".plan-truth")).toHaveText("inferido");
    await expect(panel.locator(".plan-figures")).toContainText("1 sin leer en su sitio");

    await openTab(page, "Resumen");
    const evolution = page.locator(".evolution");
    const about = evolution.locator(".evo-list li", { hasText: "0300" });
    await expect(about.first()).toContainText("sin leer en su ubicación");
    await expect(about.locator(".chip", { hasText: /^desaparece$/ })).toHaveCount(0);
  });

  test("una sustitución se propone sin escribirse y, confirmada, la misma ubicación sigue con su historia", async ({ page }) => {
    const panel = await planned(page);
    const location = await locationOf(panel, "0300");

    await importInto(page, "memoria", `${MEMORIA}periodo-4.csv`);
    await openTab(page, "Memoria");
    const card = panel.locator(".plan-proposal[data-kind='sustitucion']");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("0301");
    await expect(card).toContainText("todavía no se ha escrito nada");
    // Nada escrito: la ubicación sigue con 0300 y el historial con un solo evento.
    await expect(panel.locator(`.plan-location[data-location='${location}'] .plan-tag`)).toHaveText("0300");
    await expect(panel.locator(".plan-event")).toHaveCount(1);

    await card.getByRole("button", { name: /^Confirmar/ }).click();
    const send = card.locator(".plan-send");
    await expect(send).toBeDisabled();
    await card.locator(".plan-reason").fill("Se cambió el tag averiado por uno nuevo");
    await expect(send).toBeEnabled();
    await send.click();

    await expect(panel.locator(".plan-status")).toContainText("Plano actualizado", { timeout: 15_000 });
    const row = panel.locator(`.plan-location[data-location='${location}']`);
    await expect(row.locator(".plan-tag")).toHaveText("0301");
    await expect(row.locator(".plan-history")).toContainText(/0300 hasta \d{2}\/\d{2}, 0301 desde entonces/);
    await expect(panel.locator(".plan-location")).toHaveCount(4);
    await expect(panel.locator(".plan-proposal[data-kind='sustitucion']")).toHaveCount(0);
    await expect(panel.locator(".plan-event").first()).toContainText("propuesta confirmada");
    await expect(panel.locator(".plan-event").first()).toContainText("Se cambió el tag averiado por uno nuevo");
  });

  test("la parada de salida se ubica eligiendo de dónde cuelga y se revisa a mano", async ({ page }) => {
    const panel = await planned(page);
    const hang = await locationOf(panel, "0200");

    const card = panel.locator(".plan-proposal[data-kind='salida-sin-ubicar']");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("0900");
    await expect(card).toContainText("todavía no se ha escrito nada");
    await expect(panel.locator(".plan-exit")).toHaveCount(0);
    await expect(panel).toContainText("Ninguna salida en el plano.");

    await card.getByRole("button", { name: /^Confirmar/ }).click();
    const send = card.locator(".plan-send");
    await card.locator(".plan-reason").fill("Parada de salida hacia el circuito vecino");
    // Con razón pero sin ubicación de la que cuelgue, todavía no.
    await expect(send).toBeDisabled();
    await card.locator(".plan-branch").selectOption(hang);
    await expect(send).toBeEnabled();
    await send.click();

    await expect(panel.locator(".plan-status")).toContainText("Plano actualizado", { timeout: 15_000 });
    const exit = panel.locator(".plan-exit", { hasText: "0900" });
    await expect(exit).toHaveCount(1);
    await expect(exit).toContainText(`cuelga de ${hang} (0200)`);
    await expect(exit.locator(".plan-review")).toHaveText("Sin revisar todavía.");
    // La salida no entra en el anillo.
    await expect(panel.locator(".plan-location")).toHaveCount(4);
    await expect(panel.locator(".plan-figures")).toContainText("1 salida");

    await exit.locator(".plan-review-open").click();
    const register = exit.locator(".plan-send");
    await expect(register).toBeDisabled();
    await exit.locator(".plan-result").selectOption("averiado");
    await exit.locator(".plan-note").fill("El lector no responde");
    await exit.locator(".plan-reason").fill("Ronda de mantenimiento");
    await expect(register).toBeEnabled();
    await register.click();

    await expect(panel.locator(".plan-status")).toContainText("Plano actualizado", { timeout: 15_000 });
    await expect(panel.locator(".plan-exit", { hasText: "0900" }).locator(".plan-review")).toHaveText(
      /^Revisada el \d{1,2}\/\d{1,2}\/\d{2,4}.*: averiado — El lector no responde\.$/,
    );
  });

  test("la tabla de tramos enseña las pasadas y la media de cada tramo", async ({ page }) => {
    const panel = await planned(page);
    // Una horquilla necesita 20 pasadas por tramo: los periodos cortos no llegan y la tabla lo dice.
    await expect(panel).toContainText("Sin tramos medidos todavía");
    await importInto(page, "memoria", `${MEMORIA}periodo-5.csv`);
    await openTab(page, "Memoria");
    await expect(panel.getByRole("heading", { name: "Tramos entre ubicaciones" })).toBeVisible();
    const rows = panel.locator("table.plan-edges tr").filter({ has: page.locator("td") });
    expect(await rows.count()).toBeGreaterThan(0);
    for (let index = 0; index < (await rows.count()); index += 1) {
      const cells = rows.nth(index).locator("td");
      await expect(cells.nth(0)).toHaveText(/^U-\d{4}/);
      await expect(cells.nth(1)).toHaveText(/^U-\d{4}/);
      const production = Number((await cells.nth(3).textContent()) ?? "0");
      const night = Number((await cells.nth(6).textContent()) ?? "0");
      expect(production + night).toBeGreaterThan(0);
      const mean = production > 0 ? cells.nth(4) : cells.nth(7);
      await expect(mean).toHaveText(/^\d+,\d (s|min)$/);
    }
  });
  test("el plano viaja en el .agvproj: reabrirlo aquí es idéntico; en un dispositivo vacío se añaden sus cambios", async ({ page }) => {
    await planned(page);
    await openTab(page, "Datos");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar circuito (.agvproj)" }).click()]);
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const exported = join(mkdtempSync(join(tmpdir(), "agvproj-plano-")), "plano.agvproj");
    await download.saveAs(exported);
    const message = page.locator("section.message");
    await expect(message).toContainText("Incluye el plano del circuito: 1 cambio registrado.");

    await page.locator("#project-file").setInputFiles(exported);
    await expect(message).toContainText(/Integridad verificada/, { timeout: 10_000 });
    await expect(message).toContainText("El plano del proyecto es idéntico al de este dispositivo.");

    await freshPage(page);
    await page.locator("#project-file").setInputFiles(exported);
    await expect(message).toContainText("El plano del proyecto va por delante: se añade 1 cambio.", { timeout: 10_000 });
    await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Memoria");
    await expect(page.locator(".plan-panel .plan-location")).toHaveCount(4);
  });
});
