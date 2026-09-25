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
    await expect(page.getByRole("heading", { name: "Cambios entre los dos periodos" })).toBeVisible({ timeout: 180_000 });

    const figureOf = (title: string | RegExp) =>
      page.locator("figure.chart", { has: page.getByRole("heading", { name: title }) }).first();

    // El anillo no repite tabla: la suya es la lista ordenada del anillo, plegada justo debajo.
    const ring = figureOf("Anillo del circuito");
    await expect(ring).toBeVisible();
    expect(await ring.locator("svg title").count()).toBe(0);
    await expect(page.getByText(/Ver los \d+ tags del anillo, en orden/).first()).toBeVisible();

    const withTable = [
      "Rotura y degradación, en el tiempo",
      "Tiempo de parada en los posibles puntos críticos",
      "Tags donde el recorrido se divide",
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
    const drift = figureOf("Cambios entre los dos periodos");
    expect(await drift.locator("svg title").count()).toBe(0);
    await expect(page.getByText(/Detalle de los \d+ tags con cambios/)).toBeVisible();

    // La matriz es un único lienzo, nunca una celda por nodo; su tabla es la matriz completa plegada.
    const heatmap = figureOf("Mapa de omisión tag × AGV");
    await expect(heatmap.locator("canvas").first()).toBeVisible();
    expect(await heatmap.locator("svg").count()).toBe(0);
    await expect(page.getByText(/Ver la matriz completa/).first()).toBeVisible();
    await heatmap.getByRole("button", { name: "Peor omisión primero" }).click();
    await expect(heatmap.getByRole("button", { name: "Peor omisión primero" })).toHaveAttribute("aria-pressed", "true");

    // La flota: el recuento N de M —en el circuito, y cuántos leen—, la vida de cada AGV en un único
    // lienzo, el asignado que no lee nunca y el que sigue leyendo después de su baja.
    await expect(page.getByRole("heading", { name: "Flota del circuito" })).toBeVisible();
    const count = figureOf("Flota en el circuito");
    await expect(count.getByText(/Menos en el circuito: \d+ de \d+.*Menos leyendo: \d+ de \d+/)).toBeVisible();
    await expect(count.getByText("Ver los mismos datos en tabla")).toBeVisible();
    expect(await count.locator("svg title").count()).toBe(0);
    const lifeline = figureOf("Vida de cada AGV en el circuito");
    await expect(lifeline.locator("canvas")).toBeVisible();
    // Cómo volvió cada AGV tras cada hueco (R-AGV-017): la leyenda nombra las clases, y el AGV que se
    // retrasa 20 min en el tramo cargado y sigue por el tag siguiente sale parado.
    for (const kind of [
      "parado sin nada que lo explique: vuelve por el tag siguiente",
      "parado con la producción parada o en cola detrás de otro parado",
      "el primero de una cola, sin avanzar y sin nada que lo explique",
      "vuelve un tag más allá",
      "por un tag de mantenimiento",
    ]) {
      await expect(lifeline.getByText(kind), kind).toBeVisible();
    }
    const adelantado = scenario.defects.find((defect) => defect.kind === "adelantamiento-en-zona-cargada")?.vehicles[0] ?? "";
    await lifeline.getByText("Ver los mismos datos en tabla").click();
    const lifeRow = lifeline.locator("tr", { has: page.getByRole("cell", { name: adelantado, exact: true }) });
    await expect(lifeline.locator("th").nth(6)).toHaveText("Parado, sin explicar");
    await expect(lifeRow.locator("td").nth(6)).not.toHaveText("0 %");
    // Contra el flujo (R-AGV-018): las tres paradas de la producción plantadas, la de las 10:00
    // repetida, y el mismo AGV como el primero de su cola sin avanzar con la producción en marcha.
    await expect(page.locator(".finding", { hasText: "La producción se paró 3 veces" })).toContainText(
      "se repite a esa hora otro día",
    );
    await expect(page.locator(".finding", { hasText: "el primero de la cola" }).first()).toContainText(adelantado);
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
  test("con una sola exportación: el cambio de tag, quién no lee el nuevo, y la lectura por AGV con cifras", async ({ page }) => {
    const scenario = buildAuditScenario();
    const readings = { name: "auditoria.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.readingsCsv, "utf8") };
    const of = (kind: string) => scenario.defects.find((defect) => defect.kind === kind);
    const [viejo, nuevo] = of("sustitucion-candidata")?.tags ?? [];
    const sinActualizar = of("memoria-no-actualizada")?.vehicles[0] ?? "";

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

    // Se espera a la vista de la segunda importación, la que ya lleva las listas: la primera también
    // enseña los cambios de tag, y mirarla sería mirar una vista a punto de sustituirse.
    await expect(page.locator(".finding", { hasText: "Nadie entró en" }).first()).toBeVisible({ timeout: 180_000 });

    // El cambio de tag, dentro de un solo periodo, con el AGV que no lee el nuevo y su cifra.
    await expect(page.getByRole("heading", { name: "Cambios de tag" })).toBeVisible();
    const cambio = page.locator(".finding", { hasText: `${viejo} → ${nuevo}` }).first();
    await expect(cambio).toBeVisible();
    await expect(cambio).toContainText(`${sinActualizar}, nunca (0 de`);

    // La lectura por AGV: «nunca» con su cifra, y «poco» en pocos tags con su porcentaje. Sin causa.
    const ciego = of("omision-por-memoria")?.vehicles[0] ?? "";
    await expect(page.locator(".finding", { hasText: `AGV ${ciego} · no lee nunca` })).toContainText(": 0 de ");
    const desigual = of("lectura-desigual-en-pocos-tags")?.vehicles[0] ?? "";
    await expect(page.locator(".finding", { hasText: `AGV ${desigual} · lee poco en 2 tags` })).toContainText("%");
    await expect(page.locator(".finding", { hasText: /memoria|lector|colocación/i })).toHaveCount(0);

    // El estado normal del circuito (R-TIM-009): la horquilla de cada tramo dibujada, con su tabla y
    // sin un rótulo por marca, y los hallazgos medidos con ella, sin causa.
    await expect(page.getByRole("heading", { name: "Estado normal del circuito" })).toBeVisible();
    const bandsFigure = page.locator("figure.chart", { has: page.getByRole("heading", { name: "Horquilla de tiempos de cada tramo" }) });
    await expect(bandsFigure).toBeVisible();
    expect(await bandsFigure.locator("svg title").count()).toBe(0);
    await expect(bandsFigure.getByText(/Ver la horquilla de los \d+ tramos/)).toBeVisible();
    const cuello = of("cuello-de-botella")?.tags[0] ?? "";
    await expect(page.locator(".finding", { hasText: `Cuello de botella en ${cuello}` })).toContainText("La cola fluye");
    const [conflictoA, conflictoB] = of("punto-conflictivo")?.tags ?? [];
    await expect(page.locator(".finding", { hasText: `Punto conflictivo en ${conflictoA} y ${conflictoB}` })).toContainText("de 8 AGV");
    await expect(page.locator(".finding", { hasText: "Zona oscura de" }).first()).toContainText("se salta algún tag");
    const aislada = of("parada-sin-explicacion-aislada");
    await expect(
      page.locator(".finding", { hasText: `${aislada?.vehicles[0] ?? ""}:` }).filter({ hasText: `de más en ${aislada?.tags[0] ?? ""}` }),
    ).toContainText("Qué lo paró no lo dice el dato");
    await expect(page.getByText(/De noche \(de 22:00 a 05:00\): \d+ tramos cambian/)).toBeVisible();
    // Las lecturas que llegaron juntas al servidor (R-DAT-020): el AGV plantado, y el hueco no es parada.
    const agrupado = of("entrega-agrupada")?.vehicles[0] ?? "";
    await expect(page.locator(".finding", { hasText: `${agrupado}: le llegan lecturas juntas` })).toContainText("no paró");

    // La horquilla se descarga en CSV, una fila por tramo y régimen.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Descargar horquillas (CSV)" }).first().click(),
    ]);
    const path = await download.path();
    const { readFileSync } = await import("node:fs");
    const csv = readFileSync(path, "utf8").replace(/^\ufeff/, "");
    expect(csv.split("\r\n")[0]).toBe("desde;hasta;regimen;muestras;p50_s;p80_s;p95_s;valla_s");
    expect(csv).toContain(";noche;");
  });
});
