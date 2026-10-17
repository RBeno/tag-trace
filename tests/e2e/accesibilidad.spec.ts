/**
 * Accesibilidad esencial, WCAG 2.2 nivel AA (NFR-013; F6, entrega 5).
 *
 * axe-core, con versión fija y solo en estas pruebas (OQ-175), recorre la aplicación con el circuito de
 * auditoría cargado. Lo que se fija:
 * - las siete pestañas, en tema claro y oscuro, sin ninguna infracción de las reglas WCAG 2.0, 2.1 y 2.2
 *   A y AA (antes, 154 de contraste: el azul de los enlaces era el de los gráficos);
 * - lo que se abre encima —la tabla de un gráfico, el cuadro del informe, el formulario de expediente,
 *   un error de importación y la confirmación de borrar un circuito— tampoco tiene ninguna;
 * - con el teclado, las flechas mueven entre pestañas y todo lo que recibe el foco lo enseña.
 *
 * axe se inyecta con `page.evaluate`, que no pasa por la política de seguridad de la página: la
 * aplicación publicada no lleva nada de esto.
 */

import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { buildAuditScenario } from "../support/circuito-auditoria.js";

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const TABS = ["Resumen", "Tags", "AGV", "Tiempos", "Línea y calles", "Memoria", "Datos"] as const;
const BASE = "http://127.0.0.1:4173/tag-trace/";
const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));

async function loaded(browser: Browser, colorScheme: "light" | "dark"): Promise<Page> {
  const page = await (await browser.newContext({ baseURL: BASE, colorScheme })).newPage();
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
  await page.evaluate(AXE);
  return page;
}

/** Las infracciones WCAG A y AA de la página tal como está, en una línea cada una. */
async function violations(page: Page): Promise<readonly string[]> {
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return result.violations.map((violation) => `${violation.id} × ${violation.nodes.length}: ${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(" | ")}`);
  });
}

test.describe("accesibilidad", () => {
  test.setTimeout(400_000);

  for (const scheme of ["light", "dark"] as const) {
    test(`las siete pestañas sin infracciones, tema ${scheme === "light" ? "claro" : "oscuro"}`, async ({ browser }) => {
      const page = await loaded(browser, scheme);
      for (const tab of TABS) {
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
        expect(await violations(page), tab).toEqual([]);
      }
      await page.context().close();
    });
  }

  test("lo que se abre encima tampoco tiene infracciones", async ({ browser }) => {
    const page = await loaded(browser, "light");
    // La tabla de un gráfico, en su cajón.
    await page.getByRole("tab", { name: "Tags", exact: true }).click();
    await page.getByRole("button", { name: "Ver los mismos datos en tabla" }).first().click();
    expect(await violations(page), "cajón de tabla").toEqual([]);
    await page.keyboard.press("Escape");
    // El cuadro del informe.
    await page.getByRole("tab", { name: "Resumen", exact: true }).click();
    await page.locator(".local-jumps").getByRole("button", { name: "Generar informe…" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await violations(page), "cuadro del informe").toEqual([]);
    await page.keyboard.press("Escape");
    // El formulario de un expediente nuevo.
    await page.getByRole("tab", { name: "Línea y calles", exact: true }).click();
    await page.locator(".cases-panel").getByRole("button", { name: "Nuevo expediente…" }).click();
    expect(await violations(page), "formulario de expediente").toEqual([]);
    // La confirmación de borrar un circuito.
    await page.getByRole("tab", { name: "Datos", exact: true }).click();
    await page.locator(".storage").getByRole("button", { name: "Borrar el circuito…" }).click();
    await expect(page.locator(".storage-confirm")).toBeVisible();
    expect(await violations(page), "confirmación de borrado").toEqual([]);
    // Un error de importación.
    await page.locator("#circuit-name").fill("");
    await page.locator("#source-file").setInputFiles({ name: "roto.csv", mimeType: "text/csv", buffer: Buffer.from("hola;que\ntal;estas\n", "utf8") });
    await expect(page.getByRole("heading", { name: /^No se pudo importar \(/ })).toBeVisible({ timeout: 15_000 });
    expect(await violations(page), "error de importación").toEqual([]);
    await page.context().close();
  });

  test("con el teclado: las flechas mueven entre pestañas y el foco siempre se ve", async ({ page }) => {
    await page.goto("./");
    await page.locator("#circuit-name").fill("teclado");
    await page.locator("#source-file").setInputFiles(`${MEMORIA}periodo-1.csv`);
    await expect(page.getByRole("heading", { name: "Circuito «teclado»", exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("tab", { name: "Resumen", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Tags", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Resumen", exact: true })).toBeFocused();
    // Treinta pasos con el tabulador: cada elemento con el foco lo enseña con un contorno.
    const hidden: string[] = [];
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press("Tab");
      const seen = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active === null || active === document.body) return null;
        const style = getComputedStyle(active);
        const visible = (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
        // El selector de fichero real está fuera de la vista: su foco se pinta en el botón que lo representa.
        const proxy = active.matches("input[type=file]") && active.nextElementSibling !== null && getComputedStyle(active.nextElementSibling).outlineStyle !== "none";
        // Una marca de un gráfico enseña el foco con su trazo: naranja y más grueso (`styles.css`).
        const mark = active instanceof SVGElement && Number.parseFloat(style.strokeWidth) >= 2.5;
        return visible || proxy || mark ? null : `${active.tagName.toLowerCase()}${active.id === "" ? "" : `#${active.id}`} «${(active.textContent ?? "").trim().slice(0, 30)}»`;
      });
      if (seen !== null) hidden.push(seen);
    }
    expect(hidden).toEqual([]);
  });
});
