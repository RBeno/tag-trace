/**
 * La memoria consolidada (F4; `MEMORY_CONSOLIDATION.md` §6-§9, UX_SPEC §6), en un navegador de verdad.
 *
 * El recorrido es el del flujo del botón «Consolidar periodo»: revisar los hallazgos, previsualizar,
 * confirmar, y otro día comparar el periodo nuevo con la memoria; y, si la versión estaba mal,
 * revocarla con su razón sin que desaparezca. Lo que se fija: que la pestaña existe y sin memoria lo
 * dice; que con un hallazgo pendiente la previsualización bloquea y **no** ofrece confirmar; que
 * confirmar produce v1 en la lista y en el tile del Resumen; que el periodo siguiente se compara con
 * v1; y que revocar deja la versión marcada y el circuito sin vigente. Ninguna de estas pruebas hace
 * que la aplicación consolide sola: el `commit` sale del botón que pulsa la prueba, como lo pulsaría
 * la persona.
 *
 * Los ficheros son los de `fixtures/synthetic/memoria/`: con sus listas cargadas, cada periodo deja
 * en la instantánea un hallazgo revisable (un tag fuera de la lista), que es lo que el bloqueo
 * necesita. Los de `acumulacion/` no producen ningún hallazgo y sirven para la pestaña vacía.
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));
const ACUMULACION = fileURLToPath(new URL("../../fixtures/synthetic/acumulacion/", import.meta.url));

/** Cada prueba empieza con el almacén vacío y sin service worker: la memoria vive en IndexedDB. */
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

/** Importa un fichero en un circuito y espera al título del Resumen, que solo se ve en esa pestaña. */
async function importInto(page: Page, circuit: string, path: string): Promise<void> {
  await openTab(page, "Resumen");
  await page.locator("#circuit-name").fill(circuit);
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles(path);
  await expect(page.getByRole("heading", { name: `Circuito «${circuit}»`, exact: true })).toBeVisible({ timeout: 15_000 });
}

/**
 * El circuito «memoria» con su primer periodo analizado **con las listas**: importar, cargar las
 * listas y volver a importar, como en `revision.spec.ts`. Deja al menos un hallazgo revisable.
 */
async function prepareCircuit(page: Page): Promise<void> {
  await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
  await page.locator("#lists-file").setInputFiles([]);
  await page.locator("#lists-file").setInputFiles(`${MEMORIA}listas.csv`);
  await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });
  await importInto(page, "memoria", `${MEMORIA}periodo-1.csv`);
  await expect(page.locator(".finding.reviewable").first()).toBeVisible();
}

/**
 * Marca todas las tarjetas de la bandeja desde su control (UX_SPEC §4.3): no hay «marcar todo», así
 * que se recorre una a una. Las de rango 1 se descartan y el resto se confirma, para que el periodo
 * quede como normal y no como incidencia.
 */
async function reviewAll(page: Page): Promise<number> {
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
  await expect(page.locator(".review-bar")).toContainText(`Revisados ${total} de ${total}`);
  return total;
}

/** Previsualiza y confirma la primera versión; devuelve con el estado «Versión v1 consolidada» a la vista. */
async function consolidateFirst(page: Page): Promise<void> {
  await openTab(page, "Memoria");
  await page.getByRole("button", { name: "Previsualizar v1" }).click();
  const preview = page.locator(".memory-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator(".memory-blockers")).toHaveCount(0);
  await preview.locator("#memory-note").fill("Periodo normal de prueba");
  // El único sitio que consolida: el botón, pulsado aquí como lo pulsaría la persona.
  await preview.getByRole("button", { name: "Confirmar y consolidar" }).click();
  await expect(page.locator(".memory-status")).toContainText("Versión v1 consolidada", { timeout: 15_000 });
}

test.describe("memoria consolidada", () => {
  test.setTimeout(120_000);

  test("la pestaña existe y sin memoria lo dice, en la pestaña y en el tile del Resumen", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", `${ACUMULACION}ventana-1.csv`);

    // El tile va con las seis cifras del análisis y lleva a la pestaña.
    const tile = page.locator(".tile[data-tile='memoria']");
    await expect(tile.locator(".tile-label")).toHaveText("Memoria");
    await expect(tile.locator(".tile-value")).toHaveText("sin consolidar");
    await tile.click();
    await expect(page.getByRole("tab", { name: "Memoria", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(new URL(page.url()).hash).toBe("#memoria");

    const panel = page.locator(".memory-panel");
    await expect(panel.getByRole("heading", { name: "Memoria del circuito" })).toBeVisible();
    await expect(panel).toContainText("Sin memoria consolidada todavía.");
    await expect(panel).toContainText("Sin comparación: no hay versión vigente con la que comparar.");
    await expect(panel).toContainText("Ninguna versión guardada.");
    await expect(panel).toContainText("La memoria no ocupa nada todavía.");
    // Sin hallazgos no hay nada pendiente, así que previsualizar está permitido; nada se escribe con ello.
    await expect(panel.getByRole("button", { name: "Previsualizar v1" })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Confirmar y consolidar" })).toHaveCount(0);
  });

  test("con hallazgos pendientes, previsualizar bloquea y no ofrece confirmar", async ({ page }) => {
    await freshPage(page);
    await prepareCircuit(page);
    await openTab(page, "Memoria");

    const panel = page.locator(".memory-panel");
    // La lista de condiciones ya lo avisa antes de previsualizar.
    await expect(panel.locator(".memory-check[data-ok='no']")).toContainText(/Hallazgos: \d+ pendientes? de \d+/);
    await panel.getByRole("button", { name: "Previsualizar v1" }).click();

    const preview = panel.locator(".memory-preview");
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview.getByRole("heading", { name: "Previsualización de v1" })).toBeVisible();
    const blockers = preview.locator(".memory-blockers");
    await expect(blockers).toContainText("No se puede consolidar todavía");
    await expect(blockers.locator("li[data-code='hallazgos-pendientes']")).toContainText("Hallazgos pendientes de revisar");
    await expect(blockers).toContainText(/\d+ hallazgos? sigue[n]? sin revisar/);
    // El hallazgo bloqueado se nombra por su título, no por su clave interna.
    await expect(blockers.locator(".memory-items li").first()).toContainText(/0400/);
    await expect(blockers.locator(".memory-items li").first()).not.toContainText("|");
    // Sin confirmar: el botón no existe, no es que esté apagado.
    await expect(preview.getByRole("button", { name: "Confirmar y consolidar" })).toHaveCount(0);
    await expect(preview.locator("#memory-note")).toHaveCount(0);
    // Nada se ha escrito.
    await expect(panel).toContainText("Ninguna versión guardada.");
    await expect(page.locator(".tile[data-tile='memoria'] .tile-value")).toHaveText("sin consolidar");

    // El enlace del bloqueo lleva a la bandeja del Resumen.
    await blockers.getByRole("button", { name: "Ir a los hallazgos pendientes" }).click();
    await expect(page.getByRole("tab", { name: "Resumen", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".tray-panel")).toBeInViewport();

    // Cancelar cierra la previsualización.
    await openTab(page, "Memoria");
    await preview.getByRole("button", { name: "Cancelar" }).click();
    await expect(panel.locator(".memory-preview")).toHaveCount(0);
  });

  test("revisados todos, previsualizar y confirmar produce v1; el periodo siguiente se compara con ella", async ({ page }) => {
    await freshPage(page);
    await prepareCircuit(page);
    const total = await reviewAll(page);
    expect(total).toBeGreaterThan(0);

    await openTab(page, "Memoria");
    const panel = page.locator(".memory-panel");
    await expect(panel.locator(".memory-check[data-ok='no']")).toHaveCount(0);
    await panel.getByRole("button", { name: "Previsualizar v1" }).click();
    const preview = panel.locator(".memory-preview");
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview.locator(".memory-blockers")).toHaveCount(0);
    await expect(preview).toContainText("Sería la primera versión de la memoria.");
    await expect(preview).toContainText(/Decisiones que viajan con la versión: \d+\./);
    await expect(preview).toContainText(/Tamaño estimado de la versión: \d+,\d KB\./);
    const confirm = preview.getByRole("button", { name: "Confirmar y consolidar" });
    await expect(confirm).toBeEnabled();
    await preview.locator("#memory-note").fill("Periodo normal de prueba");
    await confirm.click();

    // El resultado, la cabecera, la lista y el tile dicen lo mismo: v1.
    await expect(panel.locator(".memory-status")).toContainText("Versión v1 consolidada", { timeout: 15_000 });
    await expect(panel).toContainText("Versión vigente: v1");
    const version = panel.locator(".memory-version[data-version='1']");
    await expect(version).toContainText("v1");
    await expect(version.locator(".chip.current")).toHaveText("vigente");
    await expect(version).toContainText("Nota: Periodo normal de prueba");
    await expect(version).toContainText("periodo-1.csv");
    await expect(version.getByRole("button", { name: "Revocar la versión v1" })).toBeVisible();
    await expect(panel.locator(".memory-budget")).toHaveText(/La memoria ocupa \d+,\d KB en 1 versión\./);
    await expect(panel.getByRole("button", { name: "Previsualizar v2" })).toBeVisible();
    await expect(page.locator(".tile[data-tile='memoria'] .tile-value")).toHaveText("v1");
    // La misma instantánea frente a sí misma: la comparación existe y no enseña cambios.
    await expect(panel.getByRole("heading", { name: "Lo observado frente a la memoria v1" })).toBeVisible();

    // Otro periodo del mismo circuito: lo observado se compara con la memoria v1, no con el fichero anterior.
    await importInto(page, "memoria", `${MEMORIA}periodo-2.csv`);
    await expect(page.locator(".tile[data-tile='memoria'] .tile-value")).toHaveText("v1");
    await openTab(page, "Memoria");
    await expect(panel.getByRole("heading", { name: "Lo observado frente a la memoria v1" })).toBeVisible();
    await expect(panel).toContainText("periodo-2.csv frente a la versión v1, de periodo-1.csv");
    await expect(panel.locator(".evo-figures")).toBeVisible();
    // La memoria sobrevive a recargar: está en el almacén, no en la página.
    await page.reload();
    await importInto(page, "memoria", `${MEMORIA}periodo-2.csv`);
    await expect(page.locator(".tile[data-tile='memoria'] .tile-value")).toHaveText("v1");
  });

  test("revocar v1 exige razón, la deja marcada en la lista y el circuito queda sin vigente", async ({ page }) => {
    await freshPage(page);
    await prepareCircuit(page);
    await reviewAll(page);
    await consolidateFirst(page);

    const panel = page.locator(".memory-panel");
    const version = panel.locator(".memory-version[data-version='1']");
    await version.getByRole("button", { name: "Revocar la versión v1" }).click();
    // Sin razón no se envía nada.
    const send = version.locator(".memory-revoke-send");
    await expect(send).toBeDisabled();
    await version.locator(".memory-revoke-reason").fill("La instantánea era de un día de pruebas");
    await expect(send).toBeEnabled();
    await send.click();

    await expect(panel.locator(".memory-status")).toContainText("Versión v1 revocada", { timeout: 15_000 });
    await expect(panel.locator(".memory-status")).toContainText("No queda ninguna versión vigente.");
    // La versión no desaparece: queda marcada, con su razón, y ya no se puede volver a revocar.
    const revoked = panel.locator(".memory-version.revoked[data-version='1']");
    await expect(revoked.locator(".chip.revoked")).toHaveText("revocada");
    await expect(revoked).toContainText("La instantánea era de un día de pruebas");
    await expect(revoked.getByRole("button", { name: /Revocar/ })).toHaveCount(0);
    await expect(panel).toContainText("Sin memoria consolidada todavía.");
    await expect(panel).toContainText("La única versión guardada está revocada");
    await expect(panel.locator(".memory-budget")).toHaveText(/en 1 versión\./);
    await expect(panel).toContainText("Sin comparación: no hay versión vigente con la que comparar.");
    await expect(page.locator(".tile[data-tile='memoria'] .tile-value")).toHaveText("sin consolidar");
    // La siguiente sería v2: la numeración no se reutiliza.
    await expect(panel.getByRole("button", { name: "Previsualizar v2" })).toBeVisible();
  });

  test("la memoria viaja en el .agvproj: reabrirlo aquí es «idéntica»; en un dispositivo vacío, la entrante se adopta", async ({ page }) => {
    await freshPage(page);
    await prepareCircuit(page);
    await reviewAll(page);
    await consolidateFirst(page);

    await openTab(page, "Datos");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar circuito (.agvproj)" }).click()]);
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const exported = join(mkdtempSync(join(tmpdir(), "agvproj-memoria-")), "memoria.agvproj");
    await download.saveAs(exported);
    const message = page.locator("section.message");
    await expect(message).toContainText(/Proyecto exportado/);
    await expect(message).toContainText("Incluye la memoria consolidada: 1 versión.");

    // El mismo dispositivo reabre su propio proyecto: la cadena de hashes es la misma.
    await page.locator("#project-file").setInputFiles(exported);
    await expect(message).toContainText(/Integridad verificada/, { timeout: 10_000 });
    await expect(message).toContainText("Memoria consolidada: 1 versión. La memoria del proyecto abierto es idéntica a la de este dispositivo.");

    // Otro dispositivo, sin nada: la memoria entrante va por delante y se adopta, y el circuito la enseña al importar.
    await freshPage(page);
    await page.locator("#project-file").setInputFiles(exported);
    await expect(message).toContainText("La memoria entrante va por delante: se adopta.", { timeout: 10_000 });
    await importInto(page, "memoria", `${MEMORIA}periodo-2.csv`);
    await expect(page.locator(".tile[data-tile='memoria'] .tile-value")).toHaveText("v1");
    await openTab(page, "Memoria");
    const panel = page.locator(".memory-panel");
    await expect(panel).toContainText("Versión vigente: v1");
    await expect(panel.locator(".memory-lineage")).toHaveText("La memoria entrante va por delante: se adopta.");
    await expect(panel.getByRole("heading", { name: "Lo observado frente a la memoria v1" })).toBeVisible();
  });

  test("una revocación que llega en un .agvproj se aplica y se dice (OQ-144)", async ({ page }) => {
    await freshPage(page);
    await prepareCircuit(page);
    await reviewAll(page);
    await consolidateFirst(page);
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const folder = mkdtempSync(join(tmpdir(), "agvproj-revocacion-"));
    const exportTo = async (name: string): Promise<string> => {
      await openTab(page, "Datos");
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar circuito (.agvproj)" }).click()]);
      const path = join(folder, name);
      await download.saveAs(path);
      return path;
    };

    // Primera copia con v1 vigente; después se revoca aquí y se exporta la segunda copia.
    const vigente = await exportTo("vigente.agvproj");
    await openTab(page, "Memoria");
    const version = page.locator(".memory-panel .memory-version[data-version='1']");
    await version.getByRole("button", { name: "Revocar la versión v1" }).click();
    await version.locator(".memory-revoke-reason").fill("La instantánea era de un día de pruebas");
    await version.locator(".memory-revoke-send").click();
    await expect(page.locator(".memory-panel .memory-status")).toContainText("Versión v1 revocada", { timeout: 15_000 });
    const revocada = await exportTo("revocada.agvproj");

    // Otro dispositivo adopta la copia con v1 vigente y después abre la que la trae revocada: la
    // revocación se aplica, porque es un hecho del historial, y el mensaje lo dice con su razón.
    await freshPage(page);
    const message = page.locator("section.message");
    await page.locator("#project-file").setInputFiles(vigente);
    await expect(message).toContainText("La memoria entrante va por delante: se adopta.", { timeout: 10_000 });
    await page.locator("#project-file").setInputFiles(revocada);
    await expect(message).toContainText("La memoria del proyecto abierto es idéntica a la de este dispositivo.", { timeout: 10_000 });
    await expect(message).toContainText(/El proyecto trae la revocación de v1 \(.+\): La instantánea era de un día de pruebas\. Aquí queda revocada\./);
    // Abrirla otra vez ya no avisa: no hay nada nuevo que revocar.
    await page.locator("#project-file").setInputFiles([]);
    await page.locator("#project-file").setInputFiles(revocada);
    await expect(message).toContainText(/Integridad verificada/, { timeout: 10_000 });
    await expect(message).not.toContainText("El proyecto trae la revocación");
  });
});
