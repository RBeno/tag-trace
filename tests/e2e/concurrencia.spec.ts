/**
 * Un solo trabajo a la vez (WP-004, UX_SPEC §8), en un navegador de verdad.
 *
 * Lo que se fija: mientras una importación larga está en marcha, los botones de la pestaña Memoria y
 * el selector de `.agvproj` están apagados —antes, pulsar «Previsualizar» mataba al Worker de la
 * importación a mitad de sus escrituras—, «Cancelar» sí se ofrece, y la importación termina; y que
 * tras una acción del plano, que no ofrece «Cancelar», los botones del plano y de la memoria vuelven
 * a encenderse (el trabajo se cierra y no queda ningún panel atascado en «ocupado»).
 *
 * La importación larga es la de `rendimiento.spec.ts`: cien mil filas generadas con semilla, que no
 * se versionan. Los ficheros pequeños de `fixtures/synthetic/memoria/` preparan el circuito.
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Cien mil eventos, 40 AGV, 120 tags: la misma forma que PERF-D2. */
function longSource(): Buffer {
  const random = seeded(20260927);
  const lines: string[] = ["Fecha;AGV;Tag"];
  // Días por encima del 12: si no, día y mes no se distinguen y la importación pide el formato.
  const start = Date.UTC(2026, 0, 24, 4, 0, 0);
  for (let index = 100_000 - 1; index >= 0; index -= 1) {
    const instant = new Date(start + index * 1000);
    const vehicle = String(Math.floor(random() * 40)).padStart(4, "0");
    const tag = String(50_000 + Math.floor(random() * 120));
    const stamp =
      `${String(instant.getUTCDate()).padStart(2, "0")}/` +
      `${String(instant.getUTCMonth() + 1).padStart(2, "0")}/${instant.getUTCFullYear()} ` +
      `${String(instant.getUTCHours()).padStart(2, "0")}:` +
      `${String(instant.getUTCMinutes()).padStart(2, "0")}:` +
      `${String(instant.getUTCSeconds()).padStart(2, "0")}`;
    lines.push(`${stamp};${vehicle};${tag}`);
  }
  return Buffer.from(lines.join("\r\n"), "utf8");
}

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

/** Como en `plano.spec.ts`: el circuito con las listas del plano y un hallazgo revisable. */
async function prepareCircuit(page: Page): Promise<void> {
  await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
  await page.locator("#lists-file").setInputFiles([]);
  await page.locator("#lists-file").setInputFiles(`${MEMORIA}listas-plano.csv`);
  await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });
  await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
  await expect(page.locator(".finding.reviewable").first()).toBeVisible();
}

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

test.describe("un solo trabajo a la vez", () => {
  test.setTimeout(240_000);

  test("durante una importación larga, memoria y proyecto quedan apagados, hay «Cancelar», y la importación termina", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
    // Con circuito y fichero con instantánea, previsualizar está permitido.
    await openTab(page, "Memoria");
    const preview = page.locator(".memory-panel").getByRole("button", { name: /^Previsualizar v\d+$/ });
    await expect(preview).toBeEnabled();
    await expect(page.locator("#project-file")).toBeEnabled();

    // Arranca la importación larga en otro circuito y vuelve a Memoria sin esperar.
    await openTab(page, "Resumen");
    await page.locator("#circuit-name").fill("largo");
    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles({ name: "largo.csv", mimeType: "text/csv", buffer: longSource() });
    await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeVisible();
    await expect(page.locator("#project-file")).toBeDisabled();
    await expect(page.locator("#lists-file")).toBeDisabled();
    await openTab(page, "Memoria");
    // El botón de memoria está apagado: no se puede matar la importación desde aquí.
    await expect(preview).toBeDisabled();

    // La importación termina entera, con su resumen, y todo vuelve a encenderse.
    await openTab(page, "Resumen");
    await expect(page.getByRole("heading", { name: "Circuito «largo»", exact: true })).toBeVisible({ timeout: 180_000 });
    await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeHidden();
    await expect(page.locator("#project-file")).toBeEnabled();
    await expect(page.locator("#source-file")).toBeEnabled();
    await openTab(page, "Memoria");
    await expect(page.locator(".memory-panel").getByRole("button", { name: /^Previsualizar v\d+$/ })).toBeEnabled();
  });

  test("una acción del plano no ofrece «Cancelar» y, al terminar, los botones del plano y de la memoria vuelven a encenderse", async ({ page }) => {
    await freshPage(page);
    await prepareCircuit(page);
    await reviewAll(page);
    await openTab(page, "Memoria");
    const memory = page.locator(".memory-panel");
    await memory.getByRole("button", { name: "Previsualizar v1" }).click();
    const shown = memory.locator(".memory-preview");
    await expect(shown).toBeVisible({ timeout: 15_000 });
    await expect(shown.locator(".memory-blockers")).toHaveCount(0);
    await shown.getByRole("button", { name: "Confirmar y consolidar" }).click();
    await expect(memory.locator(".memory-status")).toContainText("Versión v1 consolidada", { timeout: 15_000 });

    const panel = page.locator(".plan-panel");
    await panel.getByRole("button", { name: "Crear el plano desde v1" }).click();
    await panel.locator(".plan-reason").fill("La versión v1 es un periodo normal revisado");
    const send = panel.locator(".plan-send");
    await expect(send).toBeEnabled();
    await send.click();
    // El trabajo del plano escribe de una vez: no hay «Cancelar» que ofrecer (UX_SPEC §8).
    await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toBeHidden();
    await expect(panel.locator(".plan-status")).toContainText("Plano actualizado", { timeout: 15_000 });

    // El plano existe y sus controles responden; la memoria también.
    await expect(panel.getByRole("button", { name: "Crear el plano desde v1" })).toHaveCount(0);
    const first = panel.locator(".plan-location").first();
    await expect(first).toBeVisible();
    await first.locator("summary").click();
    await expect(first.locator(".plan-menu-item").first()).toBeEnabled();
    await expect(memory.getByRole("button", { name: "Previsualizar v2" })).toBeEnabled();
    await expect(page.locator("#source-file")).toBeEnabled();
    await expect(page.locator("#project-file")).toBeEnabled();
  });
});
