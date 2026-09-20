/**
 * F2: cohortes, vueltas, expediente y contraste Vsystem, en un navegador de verdad.
 *
 * `fixtures/synthetic/acumulacion/` es deliberadamente lineal —sirve para cobertura y unión, no
 * para topología— así que estas cinco piezas necesitan su propio fixture con un anillo que
 * realmente se repita (`fixtures/synthetic/anillo/`).
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const ANILLO = fileURLToPath(new URL("../../fixtures/synthetic/anillo/", import.meta.url));

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

test.describe("grafo, cohortes y vueltas", () => {
  test("dos vehículos que comparten el mismo anillo salen en un solo cohorte", async ({ page }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("anillo");
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Circuito «anillo»")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Agrupamiento por circuito")).toBeVisible();
    await expect(page.getByText("1 circuito de 2 vehículos")).toBeVisible();
  });

  test("el expediente de un AGV cuenta sus vueltas frente a la cohorte, no frente a la flota", async ({
    page,
  }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("anillo");
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Circuito «anillo»")).toBeVisible({ timeout: 15_000 });

    await page.locator("#dossier-search").fill("0007");
    await expect(page.getByRole("heading", { name: "AGV 0007" })).toBeVisible();
    // 0007 recorre el anillo tres veces: dos vueltas completas y una parcial (el corte es de los
    // datos, no del circuito).
    await expect(page.getByText("2 completas, 1 parciales, 0 desconocidas")).toBeVisible();
    // La mediana de la cohorte es la de 0042 (8 lecturas), nunca la de una flota que no existe.
    await expect(page.getByText(/mediana del resto: 8/)).toBeVisible();
  });

  test("un identificador que no existe ni como AGV ni como tag lo dice, no se calla", async ({ page }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("anillo");
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Circuito «anillo»")).toBeVisible({ timeout: 15_000 });

    await page.locator("#dossier-search").fill("9999");
    await expect(page.getByText(/Ningún AGV ni tag/)).toBeVisible();
  });
});

test.describe("contraste contra Vsystem", () => {
  test("un tag declarado sin lecturas sale sustituido-candidato por el que ocupa su hueco", async ({
    page,
  }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("anillo");
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Circuito «anillo»")).toBeVisible({ timeout: 15_000 });

    await page.locator("#lists-file").setInputFiles(`${ANILLO}listas.csv`);
    await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 15_000 });

    // El inventario y el contraste aparecen en la importación siguiente, que es cuando hay listas
    // con las que cruzar.
    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Contraste contra Vsystem")).toBeVisible({ timeout: 15_000 });

    const contraste = page.locator("h3", { hasText: "Contraste contra Vsystem" });
    const fila = contraste.locator("xpath=following-sibling::table[1]//tr[td]");
    await expect(fila).toHaveCount(1);
    await expect(fila.getByRole("cell", { name: "0999", exact: true })).toBeVisible();
    await expect(fila.getByRole("cell", { name: "0400", exact: true })).toBeVisible();
    await expect(fila.getByRole("cell", { name: "sustituido-candidato", exact: true })).toBeVisible();
    // Es una hipótesis, nunca un hecho asignado.
    await expect(fila.getByRole("cell", { name: "inferred", exact: true })).toBeVisible();
  });
});

test.describe("replay básico", () => {
  test("la posición es fracción temporal, y antes de la primera lectura no hay silencio sino ausencia de datos", async ({
    page,
  }) => {
    await freshPage(page);
    await page.locator("#circuit-name").fill("anillo");
    await page.locator("#source-file").setInputFiles(`${ANILLO}lecturas.csv`);
    await expect(page.getByText("Circuito «anillo»")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Replay" })).toBeVisible();
    // En el primer fotograma, 0042 —cuya primera lectura es dos minutos después del inicio del
    // anillo— todavía no ha leído nada: no se le inventa una posición de partida, y tampoco se le
    // atribuye un silencio. Un silencio afirma que una posición conocida dejó de confirmarse, y
    // aquí no la hubo nunca; lo que se dice es cuándo llega su primera lectura.
    await expect(page.getByText(/aún sin lecturas; la primera, a las/)).toBeVisible();
    await expect(page.getByRole("cell", { name: "sin datos", exact: true })).toBeVisible();
  });
});
