/**
 * El informe de lecturas con acciones (DS-014) en un navegador de verdad (TC-332). Circuito sintético:
 * 20 tags y dos AGV que dan vueltas a un tag cada 10 s; el informe de acciones del primero marca un
 * tag «No ejecutado» en todas sus lecturas y una lectura «No en memoria». Los dos avisos tienen que
 * salir en Tags y en la bandeja, y el catálogo en el cajón.
 */

import { expect, test, type Page } from "@playwright/test";

import { openTab } from "./pestanas.js";

const RING = Array.from({ length: 20 }, (_, index) => `K${String(index + 1).padStart(2, "0")}`);

function wall(utcMs: number): string {
  // Hora de pared en UTC+2 (horario de verano de Madrid en octubre).
  const date = new Date(utcMs + 2 * 3_600_000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ` +
    `${date.getUTCHours()}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

function scenario(): { readings: string; actions: string } {
  // Día 13: con día y mes intercambiables la importación pide aclarar el orden (ADR-0013).
  const start = Date.UTC(2026, 9, 13, 6, 0, 0);
  const rows: [number, string, string][] = [];
  for (const [agv, offset] of [["E1", 0], ["E2", 4_000]] as const) {
    let at = start + offset;
    for (let lap = 0; lap < 6; lap += 1) {
      for (const tag of RING) {
        at += 10_000;
        rows.push([at, agv, tag]);
      }
    }
  }
  rows.sort((a, b) => b[0] - a[0]);
  const readings = ["Fecha;AGV;Tag", ...rows.map(([at, agv, tag]) => `${wall(at)};${agv};${tag}`)].join("\n");
  const own = rows.filter(([, agv]) => agv === "E1");
  let memoryMarked = false;
  const actions = [
    "Fecha;Nº Tag;MTC;Acciones;No en memoria;No ejecutado",
    ...own.map(([at, , tag]) => {
      const notExecuted = tag === "K05";
      const notInMemory = !memoryMarked && tag === "K12";
      if (notInMemory) memoryMarked = true;
      return `${wall(at)};${tag};;Continuar / Continuar, Pin Arriba, Seguir recto, Mapa Crucero, vel 30 m/min;${notInMemory ? "True" : "False"};${notExecuted ? "True" : "False"}`;
    }),
  ].join("\n");
  return { readings, actions };
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

test.describe("lecturas con acciones", () => {
  test.setTimeout(180_000);

  test("los «No ejecutado» y «No en memoria» se avisan para verificar y van a la bandeja", async ({ page }) => {
    const { readings, actions } = scenario();
    const readingsFile = { name: "lecturas.csv", mimeType: "text/csv", buffer: Buffer.from(readings, "utf8") };
    await freshPage(page);
    await page.locator("#circuit-name").fill("acciones");
    await page.locator("#source-file").setInputFiles(readingsFile);
    await expect(page.getByText("Circuito «acciones»").first()).toBeVisible({ timeout: 120_000 });

    // Sin AGV escrito ni número en el nombre, no lo adivina.
    await openTab(page, "Datos");
    await page.locator("#actions-file").setInputFiles({ name: "lecturas-acciones.csv", mimeType: "text/csv", buffer: Buffer.from(actions, "utf8") });
    await expect(page.getByText("Falta el AGV")).toBeVisible();
    await page.locator("#actions-agv").fill("E1");
    await page.locator("#actions-file").setInputFiles({ name: "LECTURAS.csv", mimeType: "text/csv", buffer: Buffer.from(actions, "utf8") });
    await expect(page.getByText("Informe de acciones cargado")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("AGV E1: 120 lecturas leídas, 120 nuevas.")).toBeVisible();

    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles(readingsFile);
    await openTab(page, "Tags");
    await expect(page.getByRole("heading", { name: "Acciones de los tags" })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Catálogo de acciones por tag y MTC (20)")).toBeVisible();

    // Los dos avisos son revisables: viven en la bandeja del Resumen, no en la sección (UX_SPEC §4.5).
    await openTab(page, "Resumen");
    await expect(page.locator(".finding.reviewable", { hasText: "Tag que no se ejecuta nunca: K05" })).toBeVisible();
    await expect(page.locator(".finding.reviewable", { hasText: "Lectura fuera de memoria: K12" })).toBeVisible();
  });
});
