/**
 * PERF-D2 medido donde importa: en el navegador y a través del Worker.
 *
 * Medirlo en Node no valdría. Lo que el presupuesto acota no es lo rápido que parsea una función,
 * sino si la interfaz sigue respondiendo mientras se importa —que es justo donde cayó el
 * prototipo—, y eso solo existe con un hilo principal y un Worker de verdad.
 *
 * El fichero se genera aquí, con semilla, en lugar de versionarse: cien mil filas son unos 3 MB que
 * no aportan nada al repositorio y que además envejecen. Con semilla, la misma forma sale igual
 * siempre y la medida es comparable entre ejecuciones.
 */

import { expect, test } from "@playwright/test";

/** Forma de PERF-D2: 100.000 eventos, 40 AGV, 120 tags (`PERFORMANCE_BUDGET.md` §2). */
const EVENTS = 100_000;
const VEHICLES = 40;
const TAGS = 120;

/** Generador con semilla: determinista y sin dependencias. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function syntheticSource(): Buffer {
  const random = seeded(20260917);
  const lines: string[] = ["Fecha;AGV;Tag"];
  // En orden de pila descendente, como la fuente real: la primera fila es la más reciente.
  const start = Date.UTC(2026, 0, 24, 4, 0, 0);
  for (let index = EVENTS - 1; index >= 0; index -= 1) {
    const instant = new Date(start + index * 1000);
    const vehicle = String(Math.floor(random() * VEHICLES)).padStart(4, "0");
    const tag = String(50_000 + Math.floor(random() * TAGS));
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

test.describe("PERF-D2 · cien mil eventos", () => {
  test.setTimeout(180_000);

  test("importa y mantiene la interfaz viva mientras lo hace", async ({ page }) => {
    await page.goto("./");
    await page.evaluate(
      async () =>
        new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase("tag-trace");
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        }),
    );
    await page.reload();

    // Se muestrea la vivacidad del hilo principal mientras dura la importación: si el parseo se
    // colara ahí, estos latidos se espaciarían y el máximo delataría el bloqueo.
    await page.evaluate(() => {
      const gaps: number[] = [];
      let previous = performance.now();
      const beat = (): void => {
        const now = performance.now();
        gaps.push(now - previous);
        previous = now;
        requestAnimationFrame(beat);
      };
      requestAnimationFrame(beat);
      (window as unknown as { __gaps: number[] }).__gaps = gaps;
    });

    await page.locator("#circuit-name").fill("perf");
    await page.setInputFiles("#source-file", {
      name: "perf-d2.csv",
      mimeType: "text/csv",
      buffer: syntheticSource(),
    });
    await expect(page.getByText("Circuito «perf»")).toBeVisible({ timeout: 150_000 });

    const elapsed = await page
      .locator("dt", { hasText: "Tiempo de proceso" })
      .locator("xpath=following-sibling::dd[1]")
      .textContent();
    // Se mide el **p95**, que es lo que el presupuesto fija, y también el máximo: el máximo por sí
    // solo exagera —un único fotograma largo no describe la experiencia— y el p95 por sí solo
    // esconde un tirón puntual que el usuario sí nota.
    const { p95, worst } = await page.evaluate(() => {
      const gaps = [...(window as unknown as { __gaps: number[] }).__gaps].sort((a, b) => a - b);
      if (gaps.length === 0) return { p95: 0, worst: 0 };
      return {
        p95: gaps[Math.floor(gaps.length * 0.95)] ?? 0,
        worst: gaps[gaps.length - 1] ?? 0,
      };
    });

    console.log(
      `PERF-D2 · ${EVENTS} eventos · núcleo ${elapsed ?? "?"} · ` +
        `hueco de fotograma p95 ${p95.toFixed(0)} ms, máximo ${worst.toFixed(0)} ms`,
    );
    // El presupuesto de `PERFORMANCE_BUDGET.md` §3: p95 por debajo de 50 ms durante la importación.
    expect(p95).toBeLessThan(50);
    // La interfaz sigue viva y respondiendo cuando termina.
    expect(await page.locator("#circuit-name").inputValue()).toBe("perf");
  });
});
