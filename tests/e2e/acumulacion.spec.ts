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

import { openTab } from "./pestanas.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { STORE_VERSION } from "../../src/persistence/store.js";
import { writeXlsx } from "../support/xlsx-writer.js";

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

/** Lo que el almacén guarda de un circuito, tabla por tabla (versión 6, ADR-0015). */
interface StoredShape {
  /** Lecturas **retenidas** en la tabla `sources`, sumando sus registros: la ventana de trabajo en crudo. */
  readonly readings: number;
  /** Fuentes anotadas en el circuito, contando cada carga. */
  readonly sources: number;
  readonly coverage: number;
  /** Las fuentes con lecturas en la tabla `sources`, por nombre de fichero, en orden de carga. */
  readonly retained: readonly string[];
  /** Las fuentes con instantánea en la tabla `snapshots`, por nombre de fichero, en orden de ventana. */
  readonly snapshots: readonly string[];
  /** El registro del circuito, ¿lleva todavía `readings`? Desde la versión 6, nunca. */
  readonly circuitHasReadings: boolean;
  readonly version: number;
  /** Las tablas de la memoria consolidada (almacén 7): `memory` y `memoryState`. */
  readonly memoryStores: boolean;
}

/** Lo que el almacén tiene de verdad, leído del almacén y no del mensaje que la interfaz muestra. */
async function storedCircuit(page: Page, circuitId: string): Promise<StoredShape | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = <T>(store: string): Promise<T[]> =>
      new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) {
          resolve([]);
          return;
        }
        const request = db.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    try {
      if (!db.objectStoreNames.contains("circuits")) return null;
      const record = await new Promise<
        { readings?: unknown[]; sources: { sourceId: string; fileName: string }[]; coverage: unknown[] } | undefined
      >((resolve, reject) => {
        const request = db.transaction("circuits", "readonly").objectStore("circuits").get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (record === undefined) return null;
      const nameOf = new Map(record.sources.map((source) => [source.sourceId, source.fileName]));
      const sources = (await all<{ circuitId: string; sourceId: string; readings: unknown[] }>("sources")).filter((row) => row.circuitId === id);
      const snapshots = (await all<{ circuitId: string; sourceId: string; snapshot: { fileName: string; window: { from: number } } }>("snapshots")).filter(
        (row) => row.circuitId === id,
      );
      return {
        readings: sources.reduce((sum, row) => sum + row.readings.length, 0),
        sources: record.sources.length,
        coverage: record.coverage.length,
        retained: record.sources.filter((source) => sources.some((row) => row.sourceId === source.sourceId)).map((source) => source.fileName),
        snapshots: snapshots
          .sort((a, b) => a.snapshot.window.from - b.snapshot.window.from)
          .map((row) => nameOf.get(row.sourceId) ?? row.snapshot.fileName),
        circuitHasReadings: record.readings !== undefined,
        version: db.version,
        memoryStores: db.objectStoreNames.contains("memory") && db.objectStoreNames.contains("memoryState"),
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
    expect(await storedCircuit(page, "piloto")).toMatchObject({ readings: 6, sources: 1, coverage: 1, retained: ["ventana-1.csv"] });

    await importInto(page, "piloto", "ventana-2.csv");
    // 6 + 6 = 12 filas, pero tres son el mismo evento: la ventana de trabajo tiene 9. Desde la versión 6
    // (ADR-0015) el almacén guarda cada fuente aparte —12 filas en dos registros— y la unión se rehace al
    // cargar; las dos se retienen porque se solapan (R-DAT-023).
    expect(await storedCircuit(page, "piloto")).toMatchObject({
      readings: 12,
      sources: 2,
      coverage: 1,
      retained: ["ventana-1.csv", "ventana-2.csv"],
      circuitHasReadings: false,
    });
    await openTab(page, "Datos");
    await expect(page.getByText(/3 eventos ya estaban/)).toBeVisible();
    await expect(page.getByText(/9 lecturas de 2 ficheros de 2/)).toBeVisible();
  });

  test("la misma exportación en Excel se lee igual que en CSV, y se cuenta una vez", async ({ page }) => {
    await freshPage(page);
    // La exportación de la ventana 1, tal cual, como libro de Excel: primera hoja, en texto.
    const rows = readFileSync(`${FIXTURES}ventana-1.csv`, "utf8").trim().split(/\r?\n/).map((line) => line.split(";"));
    const book = await writeXlsx([{ name: "Sheet", rows, header: true, widths: [20, 8, 10] }]);
    await page.locator("#circuit-name").fill("piloto");
    await page.locator("#source-file").setInputFiles({
      name: "ventana-1.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(book),
    });
    await expect(page.getByText("Circuito «piloto»")).toBeVisible({ timeout: 15_000 });
    expect(await storedCircuit(page, "piloto")).toMatchObject({ readings: 6, sources: 1, coverage: 1 });

    // Y el mismo contenido en CSV no suma nada a la ventana de trabajo: son los mismos eventos. Es otro
    // fichero (otra huella), así que se guarda aparte y se retiene con el anterior, con el que se solapa.
    await importInto(page, "piloto", "ventana-1.csv");
    expect(await storedCircuit(page, "piloto")).toMatchObject({ readings: 12, sources: 2, retained: ["ventana-1.xlsx", "ventana-1.csv"] });
    await openTab(page, "Datos");
    await expect(page.getByText(/6 lecturas de 2 ficheros de 2/)).toBeVisible();
  });

  test("volver a cargar la misma exportación no cambia ninguna cifra", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", "ventana-1.csv");
    await importInto(page, "piloto", "ventana-1.csv");
    // INV-005: la procedencia se conserva —son dos cargas— pero las métricas no se duplican: un fichero
    // repetido no es una fuente nueva, no guarda lecturas aparte ni crea otra instantánea (R-DAT-005).
    expect(await storedCircuit(page, "piloto")).toMatchObject({ readings: 6, sources: 2, snapshots: ["ventana-1.csv"] });
    await openTab(page, "Datos");
    await expect(page.getByText(/6 lecturas de 1 fichero de 1/)).toBeVisible();
  });

  test("dos ventanas disjuntas dejan el hueco al descubierto, y no es un silencio", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", "ventana-1.csv");
    await importInto(page, "piloto", "ventana-lejana.csv");

    // Disjuntas: solo la última cargada conserva sus lecturas (R-DAT-023); la primera queda como instantánea.
    const stored = await storedCircuit(page, "piloto");
    expect(stored).toMatchObject({ readings: 4, sources: 2, coverage: 2, retained: ["ventana-lejana.csv"] });
    // Y la interfaz lo dice con todas las letras, que es lo que impide el falso diagnóstico.
    await openTab(page, "Datos");
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

  test("tres exportaciones seguidas: la primera deja de estar retenida, las tres tienen instantánea, y la acumulación lo dice", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "piloto", "ventana-1.csv");
    await importInto(page, "piloto", "ventana-2.csv");
    await importInto(page, "piloto", "ventana-3.csv");

    // La última y la anterior se solapan y se retienen; la primera se retira del almacén (ADR-0015 §2).
    // Las tres dejan instantánea (§1), y el circuito ya no lleva lecturas.
    expect(await storedCircuit(page, "piloto")).toMatchObject({
      sources: 3,
      coverage: 1,
      retained: ["ventana-2.csv", "ventana-3.csv"],
      snapshots: ["ventana-1.csv", "ventana-2.csv", "ventana-3.csv"],
      circuitHasReadings: false,
      version: STORE_VERSION,
      memoryStores: true,
    });
    await openTab(page, "Datos");
    // 6 + 6 filas de las dos retenidas, tres eventos comunes: 9 en la ventana de trabajo.
    await expect(page.getByText(/9 lecturas de 2 ficheros de 3/)).toBeVisible();
    await expect(page.getByText(/^3 de 3 ficheros$/)).toBeVisible();
  });

  test("una base de la versión 5 se migra al abrir: el circuito sin lecturas, la última fuente retenida y la vista lo dice", async ({ page }) => {
    await freshPage(page);
    // Se borra lo que la aplicación acaba de crear al abrirse y se siembra una base de la versión 5 con un
    // circuito antiguo: dos fuentes disjuntas y todas sus lecturas en el mismo registro.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("tag-trace");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
      const hour = 3_600_000;
      const first = Date.UTC(2026, 0, 24, 4, 8); // 24/01/2026 5:08 en Madrid
      const second = Date.UTC(2026, 0, 26, 8, 0); // 26/01/2026 9:00 en Madrid
      const reading = (sourceId: string, row: number, utcMs: number, agvId: string, tagId: string) => ({
        time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
        agvId,
        tagId,
        provenance: { sourceId, sourceHash: sourceId, sourceRow: row },
      });
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("tag-trace", 5);
        request.onupgradeneeded = () => {
          request.result.createObjectStore("circuits", { keyPath: "circuitId" });
          request.result.createObjectStore("reviews", { keyPath: "circuitId" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("circuits", "readwrite");
        tx.objectStore("circuits").put({
          circuitId: "antiguo",
          name: "antiguo",
          zone: "Europe/Madrid",
          sources: [
            { sourceId: "s1", sourceHash: "s1", fileName: "antigua-1.csv", importedAt: 1, acceptedRows: 3, complete: { from: first, to: first + hour } },
            { sourceId: "s2", sourceHash: "s2", fileName: "antigua-2.csv", importedAt: 2, acceptedRows: 3, complete: { from: second, to: second + hour } },
          ],
          coverage: [
            { from: first, to: first + hour },
            { from: second, to: second + hour },
          ],
          readings: [
            reading("s1", 2, first, "0007", "58021"),
            reading("s1", 3, first + 60_000, "0007", "58022"),
            reading("s1", 4, first + 120_000, "0042", "20107"),
            reading("s2", 2, second, "0007", "58023"),
            reading("s2", 3, second + 60_000, "0007", "58024"),
            reading("s2", 4, second + 120_000, "0042", "20108"),
          ],
          updatedAt: 3,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    });

    // Al abrir la aplicación se abre el almacén y las migraciones 5→6 y 6→7 se hacen solas, en orden:
    // la 6 parte el circuito por fuentes y la 7 añade las tablas de la memoria consolidada.
    await page.reload();
    await expect.poll(async () => (await storedCircuit(page, "antiguo"))?.version, { timeout: 15_000 }).toBe(STORE_VERSION);
    expect(await storedCircuit(page, "antiguo")).toMatchObject({
      memoryStores: true,
      readings: 3,
      sources: 2,
      coverage: 2,
      retained: ["antigua-2.csv"],
      snapshots: [],
      circuitHasReadings: false,
    });

    // Y al cargar un fichero nuevo en ese circuito, la vista dice qué está retenido y qué no tiene instantánea.
    await importInto(page, "antiguo", "ventana-1.csv");
    expect(await storedCircuit(page, "antiguo")).toMatchObject({ sources: 3, retained: ["ventana-1.csv"], snapshots: ["ventana-1.csv"] });
    await openTab(page, "Datos");
    await expect(page.getByText(/6 lecturas de 1 fichero de 3/)).toBeVisible();
    await expect(page.getByText(/1 de 3 ficheros; 2 sin instantánea/)).toBeVisible();
  });

  test("sin circuito, importar no escribe nada en el almacén", async ({ page }) => {
    await freshPage(page);
    await page.locator("#source-file").setInputFiles(`${FIXTURES}ventana-1.csv`);
    await openTab(page, "Datos");
    await expect(page.getByRole("heading", { name: "Fuente" })).toBeVisible({ timeout: 15_000 });
    expect(await storedCircuit(page, "piloto")).toBeNull();
  });
});
