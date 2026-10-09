/**
 * Expedientes de incidencia (F5, ADR-0018, entrega 1) en un navegador de verdad: la sección
 * «Expedientes de incidencia» de la pestaña Línea y calles.
 *
 * Lo que se fija:
 * - se crea un expediente desde un síntoma descrito a mano, en borrador, con su identificador
 *   `INC-<circuito>-<día>-01`, los márgenes propuestos y una copia de las lecturas de **todos** los AGV
 *   de su ventana;
 * - crear, añadir una nota, pasar a revisión, investigar, declararlo no concluyente y reabrirlo, y
 *   descartar otro, **no cambian nada** fuera de las dos tablas de expedientes: el resto del almacén
 *   queda byte a byte igual (INV-008, TC-017, ADR-0018 D5);
 * - un cambio de estado que exige texto no se puede enviar sin él, y uno que exige lo que el
 *   expediente todavía no tiene se enseña apagado con lo que falta;
 * - el expediente sobrevive a recargar la página y a volver a importar;
 * - cuando las lecturas de su ventana ya no están retenidas (R-DAT-023), el recorte sale del original
 *   archivado, y lo dice.
 *
 * Los ficheros son `fixtures/synthetic/memoria/periodo-1.csv` a `periodo-3.csv` (24 a 26/01/2026, unos
 * minutos de dos AGV cada uno).
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));

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

/**
 * Todo el almacén salvo las dos tablas de expedientes, serializado de forma estable. Los bytes
 * comprimidos se comparan como lista de números.
 */
async function storeOutsideCases(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = [...db.objectStoreNames].filter((name) => name !== "incidentCases" && name !== "incidentEvidence").sort();
    const out: Record<string, unknown> = {};
    for (const name of names) {
      out[name] = await new Promise((resolve, reject) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return JSON.stringify(out, (_key, value: unknown) => (value instanceof Uint8Array ? Array.from(value) : value));
  });
}

/** Cuántas revisiones de expediente hay guardadas. */
async function caseRows(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction("incidentCases", "readonly").objectStore("incidentCases").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count;
  });
}

async function createFromSymptom(page: Page, title: string, from: string, to: string): Promise<void> {
  const panel = page.locator(".cases-panel");
  await panel.getByRole("button", { name: "Nuevo expediente…" }).click();
  const form = panel.locator(".case-create");
  await form.getByLabel("Título").fill(title);
  const send = form.getByRole("button", { name: "Crear expediente" });
  // Sin síntoma ni ventana no se envía.
  await expect(send).toBeDisabled();
  await form.getByLabel("Síntoma: qué ocurrió, dónde y cuándo").fill("Nadie pasa por el tag 0300 en un minuto.");
  await form.getByLabel("Principio del síntoma").fill(from);
  await form.getByLabel("Fin del síntoma").fill(to);
  await form.getByLabel("Tags (opcionales, separados por comas)").fill("0300");
  await expect(send).toBeEnabled();
  await send.click();
}

test.describe("expedientes de incidencia", () => {
  test.setTimeout(120_000);

  test("se crea, cambia de estado y se descarta sin tocar nada fuera de los expedientes", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "exp", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    const panel = page.locator(".cases-panel");
    await expect(panel.getByRole("heading", { name: "Expedientes de incidencia" })).toBeVisible();
    await expect(panel).toContainText("Este circuito no tiene expedientes.");
    await expect(panel).toContainText("borrar los datos del navegador lo pierde");
    // Sin referencias internas en el texto visible (UX_SPEC §4.4).
    await expect(panel).not.toContainText("OQ-");
    await expect(panel).not.toContainText("ADR-");

    const before = await storeOutsideCases(page);

    await createFromSymptom(page, "Sin paso por 0300", "2026-01-24T08:01", "2026-01-24T08:02");
    await expect(panel.locator(".cases-status")).toContainText("Expediente INC-exp-", { timeout: 15_000 });
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador");
    const item = panel.locator(".case-item").first();
    await expect(item).toHaveAttribute("data-state", "Draft");
    const caseId = (await item.getAttribute("data-case-id")) ?? "";
    expect(caseId).toMatch(/^INC-exp-\d{8}-01$/);
    // El recorte: las 24 lecturas del fichero, de los dos AGV, porque el fichero entero cae en la ventana.
    await expect(item.locator(".case-evidence")).toHaveText(/^24 lecturas de 2 AGV, congeladas de «periodo-1\.csv» \(lecturas retenidas\)\.$/);
    await expect(item.locator(".case-window-text")).toContainText("30 min antes y 30 min después");
    await expect(item.locator(".case-references")).toContainText("Sin memoria consolidada");

    // Una nota, y pasar a revisión e investigar: cada cosa, una revisión más.
    await item.getByLabel("Añadir una nota").fill("Se avisa al turno de mañana.");
    await item.getByRole("button", { name: "Guardar la nota" }).click();
    await expect(panel.locator(".cases-status")).toContainText("Nota añadida", { timeout: 15_000 });
    await item.getByRole("button", { name: "Pasar a en revisión" }).click();
    await expect(item).toHaveAttribute("data-state", "UnderReview", { timeout: 15_000 });
    await item.getByRole("button", { name: "Pasar a investigando" }).click();
    await expect(item).toHaveAttribute("data-state", "Investigating", { timeout: 15_000 });

    // Planificar una contramedida exige lo que todavía no tiene: se enseña apagado y se dice qué falta.
    const plan = item.locator('.case-transition[data-to="CountermeasurePlanned"]');
    await expect(plan.getByRole("button", { name: "Pasar a contramedida planificada" })).toBeDisabled();
    await expect(plan).toContainText("Falta al menos una hipótesis que nada contradiga y una contramedida con responsable y fecha.");

    // No concluyente exige escribir qué falta; reabrir exige la evidencia nueva.
    const inconclusive = item.locator('.case-transition[data-to="Inconclusive"]');
    await expect(inconclusive.getByRole("button", { name: "Pasar a no concluyente" })).toBeDisabled();
    await inconclusive.getByLabel("Qué evidencia falta").fill("Las lecturas del turno anterior.");
    await inconclusive.getByRole("button", { name: "Pasar a no concluyente" }).click();
    await expect(item).toHaveAttribute("data-state", "Inconclusive", { timeout: 15_000 });
    const reopen = item.locator('.case-transition[data-to="Investigating"]');
    await reopen.getByLabel("Qué evidencia nueva lo reabre").fill("Llegó la exportación del turno anterior.");
    await reopen.getByRole("button", { name: "Pasar a investigando" }).click();
    await expect(item).toHaveAttribute("data-state", "Investigating", { timeout: 15_000 });
    await expect(item.locator(".case-history li")).toHaveCount(6);
    await expect(item.locator(".case-history")).toContainText("Reabierto: de no concluyente a investigando.");

    // Un segundo expediente del mismo día lleva 02, y se descarta con razón.
    await createFromSymptom(page, "Falsa alarma", "2026-01-24T08:02", "2026-01-24T08:03");
    await expect(panel.locator(".cases-status")).toContainText(/INC-exp-\d{8}-02/, { timeout: 15_000 });
    const second = panel.locator(".case-item", { has: page.locator(".case-title", { hasText: "Falsa alarma" }) });
    const discard = second.locator('.case-transition[data-to="Discarded"]');
    await discard.getByLabel("Por qué no es una incidencia").fill("Parada planificada que nadie anotó.");
    await discard.getByRole("button", { name: "Pasar a descartado" }).click();
    await expect(second).toHaveAttribute("data-state", "Discarded", { timeout: 15_000 });
    await expect(second.locator(".case-actions button")).toHaveCount(0);

    // INV-008: nada fuera de los expedientes ha cambiado.
    expect(await storeOutsideCases(page)).toBe(before);
    expect(await caseRows(page)).toBe(8);

    // Sobrevive a recargar y volver a importar, con su cadena entera.
    await page.reload();
    await importInto(page, "exp", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    await expect(panel.locator(".case-item")).toHaveCount(2);
    await expect(panel.locator(`.case-item[data-case-id="${caseId}"]`)).toHaveAttribute("data-state", "Investigating");
    await expect(panel.locator(".case-integrity")).toHaveCount(0);
  });

  test("con las lecturas ya no retenidas, el recorte sale del original archivado", async ({ page }) => {
    await freshPage(page);
    // Se retienen las dos últimas exportaciones: tras la tercera, las del 24 solo están en el archivo.
    await importInto(page, "arch", `${MEMORIA}periodo-1.csv`);
    await importInto(page, "arch", `${MEMORIA}periodo-2.csv`);
    await importInto(page, "arch", `${MEMORIA}periodo-3.csv`);
    await openTab(page, "Línea y calles");
    await createFromSymptom(page, "Del primer día", "2026-01-24T08:01", "2026-01-24T08:02");
    const panel = page.locator(".cases-panel");
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador", { timeout: 15_000 });
    await expect(panel.locator(".case-item").first().locator(".case-evidence")).toHaveText(
      /^24 lecturas de 2 AGV, congeladas de «periodo-1\.csv» \(original archivado\)\.$/,
    );
  });
});
