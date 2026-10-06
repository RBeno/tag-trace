/**
 * El informe de conexiones wifi (DS-013) y el mapa de calor (R-COM-004 a R-COM-008) en un navegador de
 * verdad (TC-326). El circuito se genera aquí y es sintético: 20 tags, tres AGV que dan vueltas a un
 * tag cada 10 s y un informe de conexiones del primero con un microcorte y un corte en marcha. Las
 * clases que dependen de esperas y adelantamientos se prueban en `tests/unit/wifi-cuts.test.ts`.
 */

import { expect, test, type Page } from "@playwright/test";

import { openTab } from "./pestanas.js";

const RING = Array.from({ length: 20 }, (_, index) => `W${String(index + 1).padStart(2, "0")}`);

function wall(utcMs: number): string {
  // Hora de pared en UTC+2 (horario de verano de Madrid en octubre), como la escribe Vsystem.
  const date = new Date(utcMs + 2 * 3_600_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ` +
    `${date.getUTCHours()}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function scenario(): { readings: string; wifi: string } {
  // Día 13: con día y mes intercambiables (05/10) la importación pide aclarar el orden (ADR-0013).
  const start = Date.UTC(2026, 9, 13, 6, 0, 0);
  const rows: [number, string, string][] = [];
  for (const [agv, offset] of [["E1", 0], ["E2", 3_000], ["E3", 6_000]] as const) {
    let at = start + offset;
    for (let lap = 0; lap < 8; lap += 1) {
      for (const tag of RING) {
        at += 10_000;
        rows.push([at, agv, tag]);
      }
    }
  }
  // Exportación en orden de pila descendente, como Vsystem.
  rows.sort((a, b) => b[0] - a[0]);
  const readings = ["Fecha;AGV;Tag", ...rows.map(([at, agv, tag]) => `${wall(at)};${agv};${tag}`)].join("\n");
  const lapStart = (lap: number): number => start + lap * RING.length * 10_000;
  const events: [number, string][] = [
    // Microcorte de 4 s en la vuelta 1, tras W03.
    [lapStart(1) + 35_000, "Desconexión"],
    [lapStart(1) + 39_000, "Conexión"],
    // 60 s en marcha en la vuelta 3, tras W05: lee seis tags durante el corte.
    [lapStart(3) + 55_000, "Desconexión"],
    [lapStart(3) + 115_000, "Conexión"],
  ];
  events.sort((a, b) => b[0] - a[0]);
  const wifi = ["Linea;Fecha;Conexión;Datos Aux", ...events.map(([at, kind]) => `Checked;${wall(at)};${kind};MTC 0`)].join("\n");
  return { readings, wifi };
}

async function freshPage(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("tag-trace");
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
}

test.describe("informe de conexiones wifi", () => {
  test.setTimeout(180_000);

  test("propone el AGV por el nombre, guarda el informe y enseña el mapa al volver a importar", async ({ page }) => {
    const { readings, wifi } = scenario();
    const readingsFile = { name: "lecturas.csv", mimeType: "text/csv", buffer: Buffer.from(readings, "utf8") };
    await freshPage(page);
    await page.locator("#circuit-name").fill("wifi");
    await page.locator("#source-file").setInputFiles(readingsFile);
    await expect(page.getByText("Circuito «wifi»").first()).toBeVisible({ timeout: 120_000 });

    // Sin AGV escrito ni número en el nombre, no lo adivina.
    await page.locator("#wifi-file").setInputFiles({ name: "conexiones.csv", mimeType: "text/csv", buffer: Buffer.from(wifi, "utf8") });
    await expect(page.getByText("Falta el AGV")).toBeVisible();

    // El AGV escrito manda sobre el nombre del fichero. Las cargas de planta viven en «Datos».
    await openTab(page, "Datos");
    await page.locator("#wifi-agv").fill("E1");
    await page.locator("#wifi-file").setInputFiles({ name: "CONEXIONES7.csv", mimeType: "text/csv", buffer: Buffer.from(wifi, "utf8") });
    await expect(page.getByText("Informe de conexiones cargado")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("AGV E1: 4 eventos leídos, 4 nuevos.")).toBeVisible();

    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles(readingsFile);
    await openTab(page, "Wifi");
    await expect(page.getByRole("heading", { name: "Cortes wifi y huecos de lectura" })).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(".finding", { hasText: "microcorte" })).toBeVisible();
    await expect(page.locator(".finding", { hasText: "en marcha" })).toBeVisible();
    // El mapa: una fila por tag con corte, con la celda del AGV E1 coloreada.
    const heat = page.locator("table.wifi-heat").first();
    await expect(heat.locator("th", { hasText: "AGV E1" })).toBeVisible();
    await expect(heat.locator("tr", { hasText: "W03" }).locator("td.heat-5")).toHaveText("1");
    // Sin paradas precisas declaradas, lo dice.
    await expect(page.getByText(/No hay paradas precisas declaradas/)).toBeVisible();
  });
});
