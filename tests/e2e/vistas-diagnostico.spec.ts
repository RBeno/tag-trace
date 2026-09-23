/**
 * Las vistas de diagnóstico de la Parte 38, en un navegador de verdad y con el circuito de auditoría.
 *
 * El escenario no se versiona: se genera con la misma semilla que la auditoría
 * (`tests/support/circuito-auditoria.ts`) y se carga **en dos exportaciones** con un hueco de 40 min
 * entre medias. Con una sola fuente no hay dos periodos que comparar y la deriva no aparece, que es
 * lo correcto; aquí hace falta que aparezca.
 *
 * Lo que se sostiene, para cada vista nueva: que se dibuja, que lleva su lectura por tabla, y que no
 * emite un `<title>` por marca — la regla que la banda de actividad aprendió con 10.368 nodos.
 */

import { expect, test, type Page } from "@playwright/test";

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

/** La hora de pared de una fila `dd/mm/aaaa hh:mm:ss;AGV;Tag`, como número comparable. */
function wallClock(row: string): number {
  const [date = "", time = ""] = (row.split(";")[0] ?? "").split(" ");
  const [day, month, year] = date.split("/").map(Number) as [number, number, number];
  const [hour, minute, second] = time.split(":").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** Parte la exportación en dos, dejando 40 min sin datos en medio: dos periodos distantes. */
function splitInTwo(csv: string): readonly [Buffer, Buffer] {
  const [header = "", ...rows] = csv.split("\r\n");
  const times = rows.map(wallClock);
  // Con un bucle y no con `Math.min(...times)`: doscientos mil argumentos desbordan la pila.
  let first = Infinity;
  let last = -Infinity;
  for (const time of times) {
    if (time < first) first = time;
    if (time > last) last = time;
  }
  const middle = (first + last) / 2;
  const half = 20 * 60_000;
  const early = rows.filter((_, index) => (times[index] as number) < middle - half);
  const late = rows.filter((_, index) => (times[index] as number) > middle + half);
  return [Buffer.from([header, ...early].join("\r\n"), "utf8"), Buffer.from([header, ...late].join("\r\n"), "utf8")];
}

test.describe("vistas de diagnóstico sobre el circuito de auditoría", () => {
  test.setTimeout(300_000);

  test("cada vista nueva se dibuja, lleva su tabla y no emite un rótulo por marca", async ({ page }) => {
    const scenario = buildAuditScenario();
    const [early, late] = splitInTwo(scenario.readingsCsv);

    await freshPage(page);
    await page.locator("#circuit-name").fill("auditoria");
    await page.locator("#source-file").setInputFiles({ name: "temprano.csv", mimeType: "text/csv", buffer: early });
    await expect(page.getByText("Circuito «auditoria»")).toBeVisible({ timeout: 120_000 });

    await page
      .locator("#lists-file")
      .setInputFiles({ name: "listas.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.listsCsv, "utf8") });
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 30_000 });

    // El historial de flota trae dos circuitos: el programa pregunta cuál es este, no lo adivina.
    await page
      .locator("#fleet-file")
      .setInputFiles({ name: "flota.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.fleetCsv, "utf8") });
    await expect(page.getByText("El historial trae varios circuitos")).toBeVisible({ timeout: 30_000 });
    await page.locator("#fleet-circuit").selectOption(scenario.fleetCircuit);
    await page.getByRole("button", { name: "Cargar las filas de este circuito" }).click();
    await expect(page.getByText("Historial de flota cargado")).toBeVisible({ timeout: 30_000 });

    // Las vistas que dependen de las listas y de los dos periodos aparecen en la importación que
    // llega cuando ya están las dos cosas.
    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles({ name: "tardio.csv", mimeType: "text/csv", buffer: late });
    await expect(page.getByRole("heading", { name: "Deriva entre los dos periodos" })).toBeVisible({ timeout: 180_000 });

    const figureOf = (title: string | RegExp) =>
      page.locator("figure.chart", { has: page.getByRole("heading", { name: title }) }).first();

    // El anillo no repite tabla: la suya es la lista ordenada del anillo, plegada justo debajo.
    const ring = figureOf("Anillo del circuito");
    await expect(ring).toBeVisible();
    expect(await ring.locator("svg title").count()).toBe(0);
    await expect(page.getByText(/Ver los \d+ tags del anillo, en orden/).first()).toBeVisible();

    const withTable = [
      "Rotura y degradación, en el tiempo",
      "Permanencia en los candidatos de tiempo",
      "Salidas de los tags con reparto",
      "Ocupación de las calles de carga",
      /^Entrada y salida del tramo cargado/,
      "Inventario de tags",
    ];
    for (const title of withTable) {
      const figure = figureOf(title);
      await expect(figure, String(title)).toBeVisible();
      await expect(figure.getByText("Ver los mismos datos en tabla"), String(title)).toBeVisible();
      expect(await figure.locator("svg title").count(), String(title)).toBe(0);
    }

    // La deriva lleva su detalle en la tabla plegada de debajo, como antes.
    const drift = figureOf("Deriva entre los dos periodos");
    expect(await drift.locator("svg title").count()).toBe(0);
    await expect(page.getByText(/Detalle de los \d+ tags con deriva/)).toBeVisible();

    // La matriz es un único lienzo, nunca una celda por nodo; su tabla es la matriz completa plegada.
    const heatmap = figureOf("Mapa de omisión tag × AGV");
    await expect(heatmap.locator("canvas").first()).toBeVisible();
    expect(await heatmap.locator("svg").count()).toBe(0);
    await expect(page.getByText(/Ver la matriz completa/).first()).toBeVisible();
    await heatmap.getByRole("button", { name: "Peor omisión primero" }).click();
    await expect(heatmap.getByRole("button", { name: "Peor omisión primero" })).toHaveAttribute("aria-pressed", "true");

    // La flota: el recuento N de M, la vida de cada AGV en un único lienzo, el asignado que no lee
    // nunca y el que sigue leyendo después de su baja.
    await expect(page.getByRole("heading", { name: "Flota del circuito" })).toBeVisible();
    const count = figureOf("Flota en funcionamiento");
    await expect(count.getByText(/Menos en funcionamiento: \d+ de \d+/)).toBeVisible();
    await expect(count.getByText("Ver los mismos datos en tabla")).toBeVisible();
    expect(await count.locator("svg title").count()).toBe(0);
    const lifeline = figureOf("Vida de cada AGV en el circuito");
    await expect(lifeline.locator("canvas")).toBeVisible();
    await expect(page.locator(".finding", { hasText: "asignado no leyó nada" })).toContainText(scenario.fleetNeverRead);
    await expect(page.locator(".finding", { hasText: "sin estar asignado" })).toContainText(scenario.fleetLeavesMidway);

    // El expediente de un vehículo, en un solo eje de tiempo.
    await page.locator("#dossier-search").fill("7112");
    const timeline = figureOf("Expediente de 7112 en el tiempo");
    await expect(timeline).toBeVisible({ timeout: 15_000 });
    expect(await timeline.locator("svg title").count()).toBe(0);

    // Nada de esto desborda la página: lo ancho se desplaza dentro de su caja.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
