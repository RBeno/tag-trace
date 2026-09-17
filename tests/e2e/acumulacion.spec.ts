/**
 * Acumulación en un circuito, en un navegador de verdad.
 *
 * Estas pruebas existen porque hasta ahora `src/persistence/store.ts` y la función `accumulate()`
 * del Worker **no se habían ejecutado nunca**: compilaban y estaban tipadas, y ninguna prueba las
 * tocaba. Las de Node cubren las piezas puras —cobertura, unión, hash, `.agvproj`— porque son las
 * que corren sin navegador. Todo lo que necesita IndexedDB o un Worker se quedaba fuera, y es justo
 * lo que sostiene la afirmación de que el producto acumula.
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const FIXTURES = fileURLToPath(new URL("../../fixtures/synthetic/acumulacion/", import.meta.url));

/** Cada prueba empieza con el almacén vacío: si no, una arrastraría el estado de la anterior. */
async function freshPage(page: Page): Promise<void> {
  await page.goto("./");
  // Además del almacén, se retira el service worker y sus cachés: si no, una prueba podría estar
  // ejecutándose contra la compilación de la anterior sin que nada lo delate.
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    for (const registration of registrations ?? []) await registration.unregister();
    for (const name of await caches.keys()) await caches.delete(name);
  });
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

async function importInto(page: Page, circuit: string, fixture: string): Promise<void> {
  await page.locator("#circuit-name").fill(circuit);
  // Se vacía primero para que elegir **el mismo** fichero dos veces vuelva a emitir `change`. En la
  // aplicación real lo hace el propio selector al abrirse; aquí hay que reproducirlo a mano.
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles(`${FIXTURES}${fixture}`);
  await expect(page.getByText(`Circuito «${circuit}»`)).toBeVisible({ timeout: 15_000 });
}

/** Lo que el almacén tiene de verdad, leído del almacén y no del mensaje que la interfaz muestra. */
async function storedCircuit(
  page: Page,
  circuitId: string,
): Promise<{ readings: number; sources: number; coverage: number } | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("circuits")) return null;
      const record = await new Promise<
        { readings: unknown[]; sources: unknown[]; coverage: unknown[] } | undefined
      >((resolve, reject) => {
        const request = db.transaction("circuits", "readonly").objectStore("circuits").get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (record === undefined) return null;
      return {
        readings: record.readings.length,
        sources: record.sources.length,
        coverage: record.coverage.length,
      };
    } finally {
      db.close();
    }
  }, circuitId);
}

test.describe("acumular un circuito", () => {
  test("dos exportaciones solapadas se cuentan una vez", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", "ventana-1.csv");
    expect(await storedCircuit(page, "piloto")).toEqual({ readings: 6, sources: 1, coverage: 1 });

    await importInto(page, "piloto", "ventana-2.csv");
    // 6 + 6 = 12 filas, pero tres son el mismo evento: quedan 9.
    expect(await storedCircuit(page, "piloto")).toEqual({ readings: 9, sources: 2, coverage: 1 });
    await expect(page.getByText(/3 eventos ya estaban/)).toBeVisible();
  });

  test("volver a cargar la misma exportación no cambia ninguna cifra", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", "ventana-1.csv");
    await importInto(page, "piloto", "ventana-1.csv");
    // INV-005: la procedencia se conserva —son dos fuentes— pero las métricas no se duplican.
    expect(await storedCircuit(page, "piloto")).toMatchObject({ readings: 6, sources: 2 });
  });

  test("dos ventanas disjuntas dejan el hueco al descubierto, y no es un silencio", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", "ventana-1.csv");
    await importInto(page, "piloto", "ventana-lejana.csv");

    const stored = await storedCircuit(page, "piloto");
    expect(stored).toMatchObject({ readings: 10, sources: 2, coverage: 2 });
    // Y la interfaz lo dice con todas las letras, que es lo que impide el falso diagnóstico.
    await expect(page.getByText(/no hay datos cargados/)).toBeVisible();
    await expect(page.getByText(/no es un silencio del circuito/)).toBeVisible();
  });

  test("lo acumulado sobrevive a cerrar la pestaña", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", "ventana-1.csv");
    // Sin esto, «acumular» no significaría nada: el servidor de planta guarda dos o tres días.
    await page.reload();
    expect(await storedCircuit(page, "piloto")).toMatchObject({ readings: 6, sources: 1 });
  });

  test("sin circuito, importar no escribe nada en el almacén", async ({ page }) => {
    await freshPage(page);
    await page.locator("#source-file").setInputFiles(`${FIXTURES}ventana-1.csv`);
    await expect(page.getByRole("heading", { name: "Fuente" })).toBeVisible({ timeout: 15_000 });
    expect(await storedCircuit(page, "piloto")).toBeNull();
  });
});
