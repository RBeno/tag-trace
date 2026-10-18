/**
 * Interfaz coherente en el móvil y en el portátil (F6, entrega 4; `UX_SPEC.md` §7).
 *
 * Con el circuito sintético de auditoría cargado, se recorren las siete pestañas en un móvil táctil
 * (360 × 780) y en un portátil (1.366 × 768), y en cada una se fija:
 * - nada se sale del ancho de la pantalla, salvo dentro de una caja con su propio desplazamiento;
 * - con dedo, cada botón, pestaña, campo, desplegable y «Ver evidencia» mide al menos 44 px de alto
 *   (antes «Ver los mismos datos en tabla» medía 32: una regla posterior pisaba la del modo táctil);
 * - todos los campos tienen el aspecto de la aplicación, no el del navegador;
 * - la escala de títulos va en orden: el de un panel, mayor que sus apartados;
 * - ningún texto dice «1» con el nombre en plural («Ver los 1 refuerzos declarados»).
 */

import { expect, test, type Browser, type Page } from "@playwright/test";

import { buildAuditScenario } from "../support/circuito-auditoria.js";

const TABS = ["Resumen", "Tags", "AGV", "Tiempos", "Línea y calles", "Memoria", "Datos"] as const;
const BASE = "http://127.0.0.1:4173/tag-trace/";

async function loaded(browser: Browser, mobile: boolean): Promise<Page> {
  const context = await browser.newContext(
    mobile ? { baseURL: BASE, viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { baseURL: BASE, viewport: { width: 1366, height: 768 } },
  );
  const page = await context.newPage();
  const scenario = buildAuditScenario();
  const readings = { name: "auditoria.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.readingsCsv, "utf8") };
  await page.goto("./");
  await page.locator("#circuit-name").fill("auditoria");
  await page.locator("#source-file").setInputFiles(readings);
  await expect(page.getByText("Circuito «auditoria»").first()).toBeVisible({ timeout: 120_000 });
  await page.locator("#lists-file").setInputFiles({ name: "listas.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.listsCsv, "utf8") });
  await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 30_000 });
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles(readings);
  await expect(page.getByText("Circuito «auditoria»").first()).toBeVisible({ timeout: 120_000 });
  return page;
}

/** Lo que se mira en la pestaña abierta. Sin capturas de página entera: apagan la emulación táctil. */
function inspect(page: Page, touch: boolean) {
  return page.evaluate((touch) => {
    const width = window.innerWidth;
    const shown = (element: Element): boolean => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
    };
    const inScrollBox = (element: Element): boolean => {
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return true;
      }
      return false;
    };
    const describe = (element: Element): string => `${element.tagName.toLowerCase()}${element.id === "" ? "" : `#${element.id}`} «${(element.textContent ?? "").trim().slice(0, 40)}»`;
    const overflow = [...document.querySelectorAll("#app *")].filter((element) => shown(element) && element.getBoundingClientRect().right > width + 1 && !inScrollBox(element)).map(describe);
    const controls = "#app button, #app [role=tab], #app select, #app input[type=text], #app input[type=search], #app input[type=number], #app input[type=datetime-local], #app a.evidence, #app .file-button";
    const small = touch ? [...document.querySelectorAll(controls)].filter((element) => shown(element) && element.getBoundingClientRect().height < 43.5).map((element) => `${describe(element)} ${Math.round(element.getBoundingClientRect().height)} px`) : [];
    const unstyled = [...document.querySelectorAll("#app input[type=text], #app input[type=search], #app input[type=number], #app input[type=datetime-local], #app select")].filter((element) => shown(element) && getComputedStyle(element).borderTopLeftRadius === "0px").map(describe);
    const size = (selector: string): number | null => {
      const element = [...document.querySelectorAll(`#app ${selector}`)].find(shown);
      return element === undefined ? null : Number.parseFloat(getComputedStyle(element).fontSize);
    };
    const text = (document.querySelector("#app") as HTMLElement).innerText;
    const plural = [...text.matchAll(/(?<![\d.,])1 ([a-záéíóúñ]+s)\b/giu)]
      .filter((match) => !/^(de|mes|más|ms|análisis|tras|lunes|martes|miércoles|jueves|viernes)$/i.test(match[1] ?? ""))
      .map((match) => text.slice(Math.max(0, (match.index ?? 0) - 30), (match.index ?? 0) + 30).replace(/\s+/g, " "));
    return { overflow, small, unstyled, plural, h2: size(".panel > h2"), h3: size(".panel h3") };
  }, touch);
}

test.describe("interfaz coherente", () => {
  test.setTimeout(400_000);

  for (const mobile of [true, false]) {
    test(mobile ? "en un móvil táctil" : "en un portátil", async ({ browser }) => {
      const page = await loaded(browser, mobile);
      for (const tab of TABS) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
        const seen = await inspect(page, mobile);
        expect(seen.overflow, `${tab}: se sale del ancho`).toEqual([]);
        expect(seen.small, `${tab}: menos de 44 px con dedo`).toEqual([]);
        expect(seen.unstyled, `${tab}: campos con el aspecto del navegador`).toEqual([]);
        expect(seen.plural, `${tab}: «1» con el nombre en plural`).toEqual([]);
        if (seen.h2 !== null && seen.h3 !== null) expect(seen.h2, `${tab}: el título del panel no es mayor que sus apartados`).toBeGreaterThan(seen.h3);
      }
      await page.context().close();
    });
  }
});
