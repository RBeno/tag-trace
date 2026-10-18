/**
 * Estados y errores (`UX_SPEC.md` §8, F6 entrega 5), en un navegador de verdad.
 *
 * Lo que se fija, uno por estado que no tenía prueba:
 * - sin datos: la portada lo dice;
 * - fuente inválida: el error con su código, su causa, qué hacer y el esquema detectado, y todo vuelve a
 *   encenderse;
 * - un fichero que no es un `.agvproj`: se dice y el almacén no se toca;
 * - sin espacio en el dispositivo: la importación lo dice como tal —no como un defecto— y no deja el
 *   circuito a medias;
 * - borrar un circuito: antes se enumera lo que se pierde, hay que escribir su nombre, y se va entero;
 * - el espacio que ocupa la aplicación se ve.
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));

async function freshPage(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("tag-trace");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
  );
  await page.reload();
}

/** Cuántos circuitos hay en el almacén. */
function circuits(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("tag-trace");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("circuits")) {
            db.close();
            resolve(0);
            return;
          }
          const count = db.transaction("circuits", "readonly").objectStore("circuits").count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
        };
      }),
  );
}

test.describe("estados y errores", () => {
  test.setTimeout(120_000);

  test("sin datos, fuente inválida y un fichero que no es un .agvproj", async ({ page }) => {
    await freshPage(page);
    await expect(page.getByText("Todavía no hay análisis a la vista: elige o crea uno en «Análisis» y añádele un fichero de lecturas.")).toBeVisible();

    await page.locator("#circuit-name").fill("roto");
    await page.locator("#source-file").setInputFiles({ name: "roto.csv", mimeType: "text/csv", buffer: Buffer.from("hola;que\ntal;estas\n", "utf8") });
    const error = page.locator(".message", { has: page.getByRole("heading", { name: /^No se pudo importar \(/ }) });
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText("Esquema detectado");
    await expect(page.locator("#source-file")).toBeEnabled();
    expect(await circuits(page)).toBe(0);

    await openTab(page, "Datos");
    await page.locator("#project-file").setInputFiles({ name: "falso.agvproj", mimeType: "application/zip", buffer: Buffer.from("esto no es un zip", "utf8") });
    const project = page.locator(".message", { has: page.getByRole("heading", { name: "No se pudo abrir el proyecto" }) });
    await expect(project).toBeVisible();
    await expect(project).toContainText("no se ha tocado");
  });

  test("sin espacio en el dispositivo, la importación lo dice y no deja el circuito a medias", async ({ page }) => {
    await freshPage(page);
    // Cuota mínima para este origen: no cabe ninguna escritura.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Storage.overrideQuotaForOrigin", { origin: new URL(page.url()).origin, quotaSize: 1 });
    await page.locator("#circuit-name").fill("lleno");
    await page.locator("#source-file").setInputFiles(`${MEMORIA}periodo-1.csv`);
    const error = page.locator(".message", { has: page.getByRole("heading", { name: "No se pudo importar (STORAGE_FULL)" }) });
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(error).toContainText("No queda espacio en este dispositivo para guardar");
    await expect(error).toContainText("Sin circuito, un fichero se analiza sin guardar nada");
    await expect(error).not.toContainText("defecto");
    expect(await circuits(page)).toBe(0);
    await cdp.send("Storage.overrideQuotaForOrigin", { origin: new URL(page.url()).origin });
  });

  test("borrar un circuito: se enumera lo que se pierde, hay que escribir su nombre y se va entero", async ({ page }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("borrar");
    await page.locator("#source-file").setInputFiles(`${MEMORIA}periodo-1.csv`);
    await expect(page.getByRole("heading", { name: "Circuito «borrar»", exact: true })).toBeVisible({ timeout: 15_000 });
    expect(await circuits(page)).toBe(1);

    await openTab(page, "Datos");
    const storage = page.locator(".storage");
    await expect(storage.locator(".storage-usage")).toContainText("La aplicación usa");
    await storage.getByRole("button", { name: "Borrar el circuito…" }).click();
    const confirm = storage.locator(".storage-confirm");
    await expect(confirm).toContainText("Se borrará de este dispositivo todo lo del circuito «borrar»");
    await expect(confirm.locator(".storage-lost")).toContainText("1 fichero de lecturas con lo acumulado");
    await expect(confirm.locator(".storage-lost")).toContainText("1 instantánea");
    const go = confirm.getByRole("button", { name: "Borrar para siempre" });
    await expect(go).toBeDisabled();
    // «No borrar» no toca nada.
    await confirm.getByRole("button", { name: "No borrar" }).click();
    expect(await circuits(page)).toBe(1);

    await storage.getByRole("button", { name: "Borrar el circuito…" }).click();
    await page.getByLabel("Para confirmar, escribe «borrar»").fill("borra");
    await expect(go).toBeDisabled();
    await page.getByLabel("Para confirmar, escribe «borrar»").fill("borrar");
    await expect(go).toBeEnabled();
    await Promise.all([page.waitForEvent("load"), go.click()]);
    await expect(page.getByRole("heading", { name: "Circuito «borrar» borrado" })).toBeVisible();
    expect(await circuits(page)).toBe(0);
  });
});
