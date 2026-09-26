/**
 * Afinidad, listas y vistas, en un navegador de verdad.
 *
 * Las tres cosas que estas pruebas sostienen no se pueden comprobar en Node: la afinidad porque
 * decide una escritura en IndexedDB, las listas porque viajan por el Worker, y los gráficos porque
 * son SVG en una página.
 *
 * La que más protege es la primera. Cargar en un circuito la exportación de otro **no produce
 * ningún error**: las columnas son las mismas y las fechas también. Lo que produce es un circuito
 * con dos anillos superpuestos, y como la unión no conserva de qué circuito venía cada lectura, una
 * vez dentro no hay forma de separarlas.
 */

import { expect, test, type Page } from "@playwright/test";

import { openTab } from "./pestanas.js";
import { fileURLToPath } from "node:url";

const LECTURAS = fileURLToPath(new URL("../../fixtures/synthetic/acumulacion/", import.meta.url));
const LISTAS = fileURLToPath(new URL("../../fixtures/synthetic/listas/", import.meta.url));

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

async function importInto(page: Page, circuit: string, fixture: string): Promise<void> {
  await page.locator("#circuit-name").fill(circuit);
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles(`${LECTURAS}${fixture}`);
}

/** Lecturas que el almacén tiene de verdad, leídas del almacén y no del mensaje de la interfaz. */
async function storedReadings(page: Page, circuitId: string): Promise<number | null> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("circuits")) return null;
      const record = await new Promise<{ readings: unknown[] } | undefined>((resolve, reject) => {
        const request = db.transaction("circuits", "readonly").objectStore("circuits").get(id);
        request.onsuccess = () => resolve(request.result as { readings: unknown[] } | undefined);
        request.onerror = () => reject(request.error);
      });
      return record === undefined ? null : record.readings.length;
    } finally {
      db.close();
    }
  }, circuitId);
}

test.describe("afinidad de circuito", () => {
  test("una exportación de otro circuito no se acumula, y el almacén no se toca", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "sintetico", "ventana-1.csv");
    await expect(page.getByText("Circuito «sintetico»")).toBeVisible({ timeout: 15_000 });
    const before = await storedReadings(page, "sintetico");
    expect(before).toBeGreaterThan(0);

    await importInto(page, "sintetico", "circuito-ajeno.csv");
    await expect(page.getByText("parece de otro circuito")).toBeVisible({ timeout: 15_000 });

    // Lo que de verdad importa: el almacén está exactamente como estaba. Comprobado leyéndolo, no
    // confiando en el mensaje que la interfaz enseña.
    expect(await storedReadings(page, "sintetico")).toBe(before);
    // Y sus lecturas sí se muestran: FR-003 separa analizar de consolidar, y ver el fichero dudoso
    // es cómo se averigua si lo es.
    await openTab(page, "Datos");
    await expect(page.locator("table.readings tbody tr").first()).toBeVisible();
  });

  test("la primera fuente de un circuito vacío entra, declarando que no se ha comprobado", async ({
    page,
  }) => {
    await freshPage(page);
    await importInto(page, "nuevo", "circuito-ajeno.csv");
    await expect(page.getByText("Circuito «nuevo»")).toBeVisible({ timeout: 15_000 });

    expect(await storedReadings(page, "nuevo")).toBeGreaterThan(0);
    await openTab(page, "Datos");
    await expect(page.getByText(/no porque se haya comprobado/)).toBeVisible();
  });
});

test.describe("listas de tags e inventario", () => {
  test("la estructura se enseña antes de pedir el fichero", async ({ page }) => {
    await freshPage(page);
    // Es un fichero que se escribe a mano: si no se dice qué forma tiene, no hay forma de acertar.
    await openTab(page, "Datos");
    await page.getByText("Qué forma tiene que tener el fichero").click();
    await expect(page.getByText("lista;tag;orden")).toBeVisible();
    await expect(page.getByText("la lista maestra que cada vehículo debería llevar")).toBeVisible();
  });

  test("cargar listas y ver el inventario contrastado, con el obsoleto sin diagnosticar", async ({
    page,
  }) => {
    await freshPage(page);
    await importInto(page, "sintetico", "ventana-1.csv");
    await expect(page.getByText("Circuito «sintetico»")).toBeVisible({ timeout: 15_000 });

    await page.locator("#lists-file").setInputFiles(`${LISTAS}listas-circuito.csv`);
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });
    // Una lista que el producto no conoce se conserva y se avisa; no se pierde el fichero por ella.
    // Aparece en dos sitios y los dos son correctos —el aviso y el recuento por lista—, así que se
    // comprueba el aviso, que es el que dice qué se ha hecho con ella.
    await expect(page.getByText(/no sabe usar: semaforo-nuevo/)).toBeVisible();

    // El inventario aparece en la importación siguiente, que es cuando hay con qué contrastar.
    await importInto(page, "sintetico", "ventana-2.csv");
    await openTab(page, "Tags");
    await expect(page.getByText("Inventario de tags")).toBeVisible({ timeout: 15_000 });

    const inventario = page.locator("figure.chart", { hasText: "Inventario de tags" });
    // La tabla se abre en el cajón lateral único (3.49.0), no bajo el gráfico.
    await inventario.getByRole("button", { name: "Ver los mismos datos en tabla" }).click();
    const cajon = page.locator("aside.drawer");
    // El tag retirado del suelo y nunca borrado de la lista sale como pregunta, no como avería.
    await expect(cajon.getByRole("cell", { name: "posible obsoleto" })).toBeVisible();
    await expect(cajon.getByRole("cell", { name: "sin determinar" })).toBeVisible();
    // Sobre la celda, no sobre el texto suelto: el mismo texto está además en el `<title>` del SVG
    // —que es el tooltip— y un `<title>` nunca es visible, así que la aserción fallaría por donde
    // no toca.
    await expect(cajon.getByRole("cell", { name: /sigue instalado/ })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});

test.describe("vistas", () => {
  test("las cuatro se dibujan y cada una trae su tabla equivalente", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "sintetico", "ventana-1.csv");
    await expect(page.getByText("Circuito «sintetico»")).toBeVisible({ timeout: 15_000 });
    await importInto(page, "sintetico", "ventana-lejana.csv");
    // Cobertura, perfil y actividad viven en Datos; el inventario, en Tags.
    await openTab(page, "Datos");
    await expect(page.getByText("Cobertura cargada")).toBeVisible({ timeout: 15_000 });

    for (const title of ["Cobertura cargada", "Perfil horario", "Actividad por vehículo"]) {
      await expect(page.locator("figure.chart", { hasText: title })).toBeVisible();
    }
    await openTab(page, "Tags");
    await expect(page.locator("figure.chart", { hasText: "Inventario de tags" })).toBeVisible();
    await openTab(page, "Datos");

    // El color no puede ser el único medio (UX §4): cada gráfico lleva su tabla, en el cajón (3.49.0).
    const tablas = page.locator("figure.chart button.drawer-open");
    expect(await tablas.count()).toBeGreaterThanOrEqual(3);

    // Dos ventanas separadas por dos días: la cobertura sale en dos tramos, y lo de en medio se
    // dibuja como falta de datos, nunca como un silencio del circuito (R-DAT-007).
    const cobertura = page.locator("figure.chart", { hasText: "Cobertura cargada" });
    await cobertura.getByRole("button", { name: "Ver los mismos datos en tabla" }).click();
    expect(await page.locator("aside.drawer table tr").count()).toBe(3);
    await page.keyboard.press("Escape");
    await expect(cobertura.getByText("sin datos cargados (con trama)")).toBeVisible();
  });

  test("la banda de actividad no emite un rótulo por celda", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "sintetico", "ventana-1.csv");
    await openTab(page, "Datos");
    await expect(page.getByText("Cobertura cargada")).toBeVisible({ timeout: 15_000 });

    // Medido en un circuito real de 54 vehículos y 96 tramos: un `<title>` por celda eran 10.368
    // nodos, el 86 % de la página entera, y una tarea de 958 ms que bloqueaba el hilo principal
    // justo después de importar — el fallo exacto con el que el prototipo se cayó en el móvil.
    // La información no se pierde: se lee al pasar el puntero, en una región viva.
    const banda = page.locator("figure.chart", { hasText: "Actividad por vehículo" });
    const celdas = await banda.locator("svg rect").count();
    const rotulos = await banda.locator("svg title").count();
    expect(celdas).toBeGreaterThan(10);
    // Solo el rótulo del gráfico entero, nunca uno por celda.
    expect(rotulos).toBeLessThanOrEqual(1);
    await expect(banda.getByText("Toca o pasa el puntero por la banda para leer una celda.")).toBeVisible();
  });
});
