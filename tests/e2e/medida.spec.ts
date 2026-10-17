/**
 * «Medir este dispositivo» (F6, entrega 2; `PERFORMANCE_BUDGET.md` §3 y §7).
 *
 * Lo que se fija, con los tres volúmenes de verdad:
 * - mide aunque el campo tenga un circuito escrito, y no guarda nada: el almacén sigue vacío;
 * - cada volumen sale con su número de lecturas, su huella y sus métricas frente al presupuesto;
 *   PERF-D4 con la primera vista y el paso del replay, PERF-D3 con la cancelación;
 * - el informe descargado es el JSON del banco, con la versión, el equipo y las mismas cifras, y sin
 *   nada que no sea el sintético;
 * - las cifras de este contenedor **no** son las del dispositivo de referencia: no se juzgan aquí.
 *   La cancelación sí se mira, porque es un hecho y no una cifra: hoy la lectura de filas no la
 *   atiende y el banco tiene que decirlo como «fuera», no como «sin medir».
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

import { openTab } from "./pestanas.js";

test.describe("banco de medida", () => {
  test.setTimeout(600_000);

  test("mide los tres volúmenes sin guardar nada y descarga el informe", async ({ page }) => {
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
    // Un circuito escrito no cambia nada: la medida importa sin él.
    await page.locator("#circuit-name").fill("no-se-guarda");
    await openTab(page, "Datos");
    const panel = page.locator(".bench-panel");
    await expect(panel.getByRole("heading", { name: "Medir este dispositivo" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Descargar el informe (JSON)" })).toBeDisabled();
    await panel.getByRole("button", { name: "Medir los tres" }).click();
    await expect(panel.getByRole("button", { name: "Medir los tres" })).toBeDisabled();
    await expect(panel.locator(".bench-status")).toContainText("Medida terminada", { timeout: 570_000 });

    for (const [id, rows] of [["PERF-D2", "100.000"], ["PERF-D3", "500.000"], ["PERF-D4", ""]] as const) {
      const table = panel.locator(`.bench-table[data-scenario="${id}"]`);
      await expect(table.locator("caption")).toContainText(`${id} · ${rows}`);
      await expect(table.locator("tr", { hasText: "Hueco de fotograma, p95" }).locator("td").nth(3)).toHaveText(/^(dentro|fuera)$/);
    }
    const d4 = panel.locator('.bench-table[data-scenario="PERF-D4"]');
    await expect(d4.locator("tr", { hasText: "Primera vista del replay" }).locator("td").nth(3)).toHaveText(/^(dentro|fuera)$/);
    await expect(d4.locator("tr", { hasText: "Paso del replay" }).locator("td").nth(1)).toHaveText(/^\d+ fps$/);
    const d3 = panel.locator('.bench-table[data-scenario="PERF-D3"]');
    const cancel = d3.locator("tr", { hasText: "Confirmación de cancelación" });
    await expect(cancel.locator("td").nth(3)).toHaveText(/^(dentro|fuera)$/);
    await expect(cancel.locator("td").nth(1)).not.toHaveText("—");

    // Nada guardado: ningún circuito en el almacén.
    const circuits = await page.evaluate(
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
          request.onerror = () => resolve(-1);
        }),
    );
    expect(circuits).toBe(0);

    const [download] = await Promise.all([page.waitForEvent("download"), panel.getByRole("button", { name: "Descargar el informe (JSON)" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^medida-tag-trace-\d+\.\d+\.\d+-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const report = JSON.parse(readFileSync(await download.path(), "utf8")) as {
      kind: string;
      appVersion: string;
      device: { cores: number | null; pointer: string };
      runs: { scenario: { id: string }; rows: number; csvHash: string; metrics: { key: string; value: number | null; verdict: string | null }[] }[];
    };
    // Las cifras al registro, como en `rendimiento.spec.ts`: de este contenedor, no del dispositivo.
    for (const run of report.runs) {
      console.log(`${run.scenario.id} · ${run.rows} lecturas · ${run.metrics.map((metric) => `${metric.key}=${metric.value === null ? "—" : Math.round(metric.value)}${metric.verdict === null ? "" : `(${metric.verdict})`}`).join(" ")}`);
    }
    expect(report.kind).toBe("tag-trace-medida");
    expect(report.runs.map((run) => run.scenario.id)).toEqual(["PERF-D2", "PERF-D3", "PERF-D4"]);
    expect(report.runs[0]?.rows).toBe(100_000);
    expect(report.runs[0]?.csvHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.runs[2]?.metrics.map((metric) => metric.key)).toContain("replay-fps");
    // Chromium da la memoria del hilo principal: no sale «sin medir».
    expect(report.runs[0]?.metrics.find((metric) => metric.key === "memoria")?.verdict).not.toBe("sin-medir");
  });
});
