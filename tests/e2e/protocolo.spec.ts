/**
 * Los criterios de aceptación de `WORKER_PROTOCOL.md` §7 y la prueba de red de
 * `SECURITY_PRIVACY.md` §4.
 *
 * Llevan escritos desde F0 como casillas sin marcar. Son exactamente el tipo de requisito que no se
 * puede comprobar leyendo el código: o se ejecuta en una página o no se ha comprobado.
 */

import { expect, test, type Page } from "@playwright/test";

import { openTab } from "./pestanas.js";
import { fileURLToPath } from "node:url";

const FIXTURES = fileURLToPath(new URL("../../fixtures/synthetic/acumulacion/", import.meta.url));

async function freshPage(page: Page): Promise<void> {
  await page.goto("./");
  // Además del almacén, se retira el service worker y sus cachés: si no, una prueba podría estar
  // ejecutándose contra la compilación de la anterior sin que nada lo delate.
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    for (const registration of registrations ?? []) await registration.unregister();
    for (const name of await caches.keys()) await caches.delete(name);
  });
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
}

async function circuitExists(page: Page, circuitId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("circuits")) return false;
      return await new Promise<boolean>((resolve) => {
        const request = db.transaction("circuits", "readonly").objectStore("circuits").get(id);
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => resolve(false);
      });
    } finally {
      db.close();
    }
  }, circuitId);
}

test.describe("SECURITY_PRIVACY §4 · el flujo analítico no sale a la red", () => {
  test("importar y acumular no genera ninguna petición externa", async ({ page }) => {
    const external: string[] = [];
    // Se intercepta **todo**, no solo lo que se espera: una petición que nadie previó es
    // justamente la que hay que detectar. Lo del propio origen sigue; lo demás se anota y se corta.
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === "http://127.0.0.1:4173" || url.protocol === "blob:" || url.protocol === "data:") {
        void route.continue();
        return;
      }
      external.push(route.request().url());
      void route.abort();
    });

    await freshPage(page);
    await page.locator("#circuit-name").fill("piloto");
    await page.locator("#source-file").setInputFiles(`${FIXTURES}ventana-1.csv`);
    await expect(page.getByText("Circuito «piloto»")).toBeVisible({ timeout: 15_000 });

    expect(external, `El análisis pidió recursos externos: ${external.join(", ")}`).toEqual([]);
  });
});

test.describe("WORKER_PROTOCOL §7 · criterios de aceptación", () => {
  test("cancelar deja el almacén exactamente como estaba", async ({ page }) => {
    await freshPage(page);
    // Primero se acumula algo, para que haya un estado anterior que preservar.
    await page.locator("#circuit-name").fill("piloto");
    await page.locator("#source-file").setInputFiles(`${FIXTURES}ventana-1.csv`);
    await expect(page.getByText("Circuito «piloto»")).toBeVisible({ timeout: 15_000 });

    const antes = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tag-trace");
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const record = await new Promise<unknown>((resolve) => {
          const request = db.transaction("circuits", "readonly").objectStore("circuits").get("piloto");
          request.onsuccess = () => resolve(request.result);
        });
        return JSON.stringify(record);
      } finally {
        db.close();
      }
    });

    // Se lanza otra importación y se cancela en cuanto la interfaz ofrece el botón.
    await page.locator("#source-file").setInputFiles(`${FIXTURES}ventana-2.csv`);
    // La importación puede terminar antes de que dé tiempo a pulsar: las dos salidas son legítimas
    // y lo que se comprueba es que ninguna deja el almacén a medias.
    const cancel = page.getByRole("button", { name: "Cancelar" });
    await cancel.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);

    const despues = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("tag-trace");
        request.onsuccess = () => resolve(request.result);
      });
      try {
        const record = await new Promise<unknown>((resolve) => {
          const request = db.transaction("circuits", "readonly").objectStore("circuits").get("piloto");
          request.onsuccess = () => resolve(request.result);
        });
        return JSON.stringify(record);
      } finally {
        db.close();
      }
    });

    // O la importación terminó y acumuló, o se canceló y no tocó nada: nunca un estado a medias.
    const acumulada = JSON.parse(despues) as { sources: unknown[] };
    const previa = JSON.parse(antes) as { sources: unknown[] };
    expect([previa.sources.length, previa.sources.length + 1]).toContain(acumulada.sources.length);
  });

  test("un fichero sin filas válidas explica qué se rechazó, y no escribe nada", async ({ page }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("vacio");
    await page.setInputFiles("#source-file", {
      name: "sin-lecturas.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Fecha;AGV;Tag\nno es una fecha;0007;58022\n"),
    });
    await expect(page.getByText(/NO_ACCEPTED_ROWS/)).toBeVisible({ timeout: 15_000 });
    // WP-005: cero filas es una respuesta legítima con causa, no un cuelgue ni un circuito vacío.
    expect(await circuitExists(page, "vacio")).toBe(false);
  });
});

test.describe("ida y vuelta de `.agvproj` por la interfaz", () => {
  test("exportar y reabrir muestra lo mismo; un byte alterado se rechaza sin tocar el almacén", async ({
    page,
  }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("piloto");
    await page.locator("#source-file").setInputFiles(`${FIXTURES}ventana-1.csv`);
    await expect(page.getByText("Circuito «piloto»")).toBeVisible({ timeout: 15_000 });

    await openTab(page, "Datos");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar circuito (.agvproj)" }).click(),
    ]);
    // Ruta sin acentos: `outputPath` la deriva del título de la prueba, y este lleva `ñ`.
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const carpeta = mkdtempSync(join(tmpdir(), "agvproj-"));
    const exported = join(carpeta, "piloto.agvproj");
    await download.saveAs(exported);
    // Se espera a que la exportación haya terminado de hablar antes de pedir otra cosa.
    await expect(page.locator("section.message")).toContainText(/Proyecto exportado/);

    await page.locator("#project-file").setInputFiles(exported);
    // Se afirma sobre el panel entero y no sobre un texto suelto: si falla, el mensaje del fallo
    // dice **qué se mostró en su lugar**, que es la mitad del trabajo de diagnosticarlo.
    const panel = page.locator("section.message");
    await expect(panel).toContainText(/Integridad verificada/, { timeout: 10_000 });
    await expect(panel).toContainText(/1 fuentes declaradas/);

    // Y ahora el mismo fichero con un byte cambiado dentro del contenido.
    const { readFileSync, writeFileSync } = await import("node:fs");
    const bytes = readFileSync(exported);
    const middle = Math.floor(bytes.length / 2);
    bytes[middle] = (bytes[middle] as number) ^ 0xff;
    const alterado = join(carpeta, "alterado.agvproj");
    writeFileSync(alterado, bytes);

    await page.locator("#project-file").setInputFiles(alterado);
    await expect(panel).toContainText(/No se pudo abrir el proyecto/, { timeout: 10_000 });
    // Lo que importa no es el mensaje: es que el almacén siga intacto después de rechazarlo.
    expect(await circuitExists(page, "piloto")).toBe(true);
  });
});
