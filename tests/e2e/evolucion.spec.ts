/**
 * La vista de evolución (ADR-0015 §3; TC-282), en un navegador de verdad y con el circuito de
 * auditoría partido en dos exportaciones con 40 min de hueco, como en `vistas-diagnostico.spec.ts`.
 *
 * Lo que se fija: que el control de tiempo sobre el anillo tiene dos posiciones y arranca en la
 * última; que elegir la primera cambia el pie del anillo sin cambiar la cifra de tags del centro;
 * que «Evolución» da cifras y lista los dos tags de la rotura plantada como «desaparece» (el corte
 * cae en la rotura: en la segunda exportación no se leen ni una vez, así que no están en su anillo;
 * entre instantáneas eso es desaparecer, no «dejar de leerse», que `compareSnapshots` reserva para
 * un tag que sigue en el mismo sitio) y que «Ver todos los cambios» abre el cajón;
 * que en Tiempos la figura «El circuito a lo largo de los ficheros» lleva leyenda y tabla; y que en
 * Datos cada fichero lleva su indicador. En el móvil, el control cabe y no hay desborde.
 */

import { expect, test, type Page } from "@playwright/test";

import { openTab } from "./pestanas.js";

import { buildAuditScenario } from "../support/circuito-auditoria.js";

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

/** La hora de pared de una fila `dd/mm/aaaa hh:mm:ss;AGV;Tag`, como número comparable. */
function wallClock(row: string): number {
  const [date = "", time = ""] = (row.split(";")[0] ?? "").split(" ");
  const [day, month, year] = date.split("/").map(Number) as [number, number, number];
  const [hour, minute, second] = time.split(":").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/**
 * Parte la exportación en dos, dejando 50 min sin datos en medio, como `splitInTwo` de
 * `vistas-diagnostico.spec.ts` pero con el corte **en la rotura plantada** (al 55 % de la ventana,
 * `circuito-auditoria.ts`) y no en la mitad: así los dos tags rotos se leen en toda la primera
 * exportación y en ninguna pasada de la segunda, que es lo que «deja de leerse» exige entre
 * instantáneas (R-DAT-023). Con el corte en la mitad la rotura cae dentro del segundo fichero y es
 * una rotura de ese fichero, no un cambio entre dos.
 */
function splitAtBreak(csv: string): readonly [Buffer, Buffer] {
  const [header = "", ...rows] = csv.split("\r\n");
  const times = rows.map(wallClock);
  let first = Infinity;
  let last = -Infinity;
  for (const time of times) {
    if (time < first) first = time;
    if (time > last) last = time;
  }
  const middle = first + (last - first) * 0.55;
  const half = 25 * 60_000;
  const early = rows.filter((_, index) => (times[index] as number) < middle - half);
  const late = rows.filter((_, index) => (times[index] as number) > middle + half);
  return [Buffer.from([header, ...early].join("\r\n"), "utf8"), Buffer.from([header, ...late].join("\r\n"), "utf8")];
}

async function loadTwo(page: Page): Promise<readonly string[]> {
  const scenario = buildAuditScenario();
  const [early, late] = splitAtBreak(scenario.readingsCsv);
  await freshPage(page);
  await page.locator("#circuit-name").fill("auditoria");
  await page.locator("#source-file").setInputFiles({ name: "temprano.csv", mimeType: "text/csv", buffer: early });
  await expect(page.getByText("Circuito «auditoria»")).toBeVisible({ timeout: 120_000 });
  // Las listas después del primer fichero (necesitan el circuito): la primera instantánea queda sin
  // clases y la segunda con ellas, así que el delta trae un «cambia de clase» por tag. Va al final de
  // la lista y no resalta el anillo; lo que se afirma aquí es lo demás.
  await page
    .locator("#lists-file")
    .setInputFiles({ name: "listas.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.listsCsv, "utf8") });
  await expect(page.getByText("Listas cargadas")).toBeVisible({ timeout: 30_000 });
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles({ name: "tardio.csv", mimeType: "text/csv", buffer: late });
  // El control de tiempo llega cuando las instantáneas se leen del almacén, después de las vistas.
  await expect(page.getByRole("group", { name: "Instantánea del circuito" })).toBeVisible({ timeout: 180_000 });
  return scenario.defects.find((defect) => defect.kind === "rotura-subita")?.tags ?? [];
}

test.describe("evolución: el anillo recorre el tiempo", () => {
  test.setTimeout(300_000);

  test("control de tiempo, sección Evolución, gráfico de tiempos e indicadores por fichero", async ({ page }) => {
    const broken = await loadTwo(page);
    expect(broken.length).toBeGreaterThan(0);

    const ring = page.locator("figure.chart", { has: page.getByRole("heading", { name: "Anillo del circuito" }) });
    const control = ring.getByRole("group", { name: "Instantánea del circuito" });
    const range = control.getByRole("slider", { name: "Instantánea" });
    await expect(range).toHaveAttribute("max", "1");
    await expect(range).toHaveValue("1");
    await expect(range).toHaveAttribute("aria-valuetext", /^tardio\.csv, /);
    await expect(control.getByRole("button", { name: "Instantánea siguiente" })).toBeDisabled();
    await expect(control.locator(".time-label")).toContainText("Instantánea 2 de 2: tardio.csv");
    await expect(ring.locator("figcaption")).not.toContainText("Instantánea de");
    const tagsTile = page.locator(".tile[data-tile='tags'] .tile-value");
    const countToday = (await tagsTile.textContent()) ?? "";
    expect(countToday).toMatch(/^\d+$/);
    await expect(ring.locator("svg text.big")).toHaveText(countToday);

    // La sección Evolución, con la última elegida: de temprano a tardío, con la rotura plantada.
    const evolution = page.locator(".evolution");
    await expect(evolution.getByRole("heading", { name: "Evolución" })).toBeVisible();
    await expect(evolution).toContainText("De «temprano.csv» a «tardio.csv»");
    const figures = evolution.locator(".evo-figures .evo-figure");
    await expect(figures).toHaveCount(9);
    const gone = evolution.locator(".evo-figure", { hasText: "desaparecen" });
    expect(Number((await gone.locator(".evo-n").textContent()) ?? "0")).toBeGreaterThanOrEqual(broken.length);
    await expect(evolution.locator(".evo-list .chip", { hasText: /^desaparece$/ }).first()).toBeVisible();
    // Un cambio de estructura: los tags rotos desaparecen del anillo de la segunda instantánea. En la
    // tabla del cajón, que lleva todos los cambios; la lista de la página solo enseña los primeros.
    await evolution.getByRole("button", { name: /Ver todos los cambios/ }).click();
    const drawer = page.locator("aside.drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("#drawer-title")).toHaveText(/Ver todos los cambios/);
    for (const tagId of broken) {
      await expect(drawer.locator("table.data tr", { hasText: tagId }).filter({ hasText: "desaparece" }).first()).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // Y el anillo resalta esos tags con el acento por fuera (la de hoy no los tiene; la vecina sí).
    expect(await ring.locator("path[data-change]").count()).toBeGreaterThan(0);
    await expect(ring.locator(".ring-legend")).toContainText("cambia frente a la instantánea vecina");

    // Elegir la primera instantánea: el pie cambia, la cifra de tags se mantiene y la capa activa también.
    await ring.getByRole("radio", { name: "Tramos" }).click();
    await control.getByRole("button", { name: "Instantánea anterior" }).click();
    await expect(range).toHaveValue("0");
    await expect(range).toHaveAttribute("aria-valuetext", /^temprano\.csv, /);
    await expect(ring.locator("figcaption")).toContainText("Instantánea de temprano.csv");
    await expect(ring.locator("figcaption")).toContainText("hoy: tardio.csv");
    // El centro del anillo dice los tags de **esa** instantánea; el tile de la portada sigue diciendo los de hoy.
    await expect(ring.locator("svg text.big")).toHaveText(/^\d+$/);
    await expect(tagsTile).toHaveText(countToday);
    await expect(ring.getByRole("radio", { name: "Tramos" })).toHaveAttribute("aria-checked", "true");
    await expect(evolution).toContainText("«temprano.csv» es la primera instantánea");
    await expect(evolution.locator(".evo-figures .evo-figure")).toHaveCount(9);
    // El desplegable equivalente vuelve a la última.
    await control.getByRole("combobox", { name: "Instantánea (lista)" }).selectOption("1");
    await expect(range).toHaveValue("1");
    await expect(ring.locator("figcaption")).not.toContainText("Instantánea de");

    // Con la primera elegida, los tags rotos están en el anillo y llevan el acento.
    await control.getByRole("button", { name: "Instantánea anterior" }).click();
    for (const tagId of broken) await expect(ring.locator(`path[data-change="${tagId}"]`)).toHaveCount(1);
    await control.getByRole("button", { name: "Instantánea siguiente" }).click();
    await expect(range).toHaveValue("1");

    // El tile de la vuelta dice cuántas instantáneas y lleva a la figura de evolución de tiempos.
    await expect(page.locator(".tile[data-tile='vuelta'] .tile-note")).toContainText("2 instantáneas");
    await page.locator(".tile[data-tile='vuelta']").click();
    await expect(page.getByRole("tab", { name: "Tiempos" })).toHaveAttribute("aria-selected", "true");
    const chart = page.locator("figure.chart", { has: page.getByRole("heading", { name: "El circuito a lo largo de los ficheros" }) });
    await expect(chart).toBeInViewport();
    expect(await chart.locator(".legend li").count()).toBeGreaterThan(0);
    expect(await chart.locator("svg path[stroke-width='2']").count()).toBeGreaterThan(0);
    await chart.getByRole("button", { name: "Ver los mismos datos en tabla" }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.locator("table.data th").nth(1)).toHaveText("temprano.csv");
    await page.keyboard.press("Escape");

    // En Datos, cada fichero con su indicador.
    await openTab(page, "Datos");
    const sources = page.locator(".source-list li");
    await expect(sources).toHaveCount(2);
    await expect(sources.filter({ hasText: "tardio.csv" }).locator(".chip")).toHaveText("lecturas retenidas");
    await expect(sources.filter({ hasText: "temprano.csv" }).locator(".chip")).toHaveText(/lecturas retenidas|solo instantánea/);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test.describe("dedo", () => {
    test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    test("en el móvil, el control de tiempo cabe y no hay desborde", async ({ page }) => {
      await loadTwo(page);
      const ring = page.locator("figure.chart", { has: page.getByRole("heading", { name: "Anillo del circuito" }) });
      const control = ring.getByRole("group", { name: "Instantánea del circuito" });
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox()) as { x: number; width: number };
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      await control.getByRole("button", { name: "Instantánea anterior" }).click();
      await expect(ring.locator("figcaption")).toContainText("Instantánea de temprano.csv");
      await expect(page.locator(".evolution .evo-figures .evo-figure")).toHaveCount(9);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});
