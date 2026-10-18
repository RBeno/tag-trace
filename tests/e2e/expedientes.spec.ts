/**
 * Expedientes de incidencia (F5, ADR-0018, entrega 1) en un navegador de verdad: la sección
 * «Expedientes de incidencia» de la pestaña Línea y calles.
 *
 * Lo que se fija:
 * - se crea un expediente desde un síntoma descrito a mano, en borrador, con su identificador
 *   `INC-<circuito>-<día>-01`, los márgenes propuestos y una copia de las lecturas de **todos** los AGV
 *   de su ventana;
 * - crear, añadir una nota, pasar a revisión, investigar, declararlo no concluyente y reabrirlo, y
 *   descartar otro, **no cambian nada** fuera de las dos tablas de expedientes: el resto del almacén
 *   queda byte a byte igual (INV-008, TC-017, ADR-0018 D5);
 * - un cambio de estado que exige texto no se puede enviar sin él, y uno que exige lo que el
 *   expediente todavía no tiene se enseña apagado con lo que falta;
 * - el expediente sobrevive a recargar la página y a volver a importar;
 * - cuando las lecturas de su ventana ya no están retenidas (R-DAT-023), el recorte sale del original
 *   archivado, y lo dice.
 *
 * Los ficheros son `fixtures/synthetic/memoria/periodo-1.csv` a `periodo-3.csv` (24 a 26/01/2026, unos
 * minutos de dos AGV cada uno).
 */

import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { buildCriticalPointScenario, CRITICAL_TAG, STALL_TAG, STALLED_AGV, WIFI_AGV } from "../support/caso-punto-critico.js";
import { writeXlsx } from "../support/xlsx-writer.js";
import { openTab } from "./pestanas.js";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));

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

async function importInto(page: Page, circuit: string, path: string): Promise<void> {
  await openTab(page, "Resumen");
  await page.locator("#circuit-name").fill(circuit);
  await page.locator("#source-file").setInputFiles([]);
  await page.locator("#source-file").setInputFiles(path);
  await expect(page.getByRole("heading", { name: `Circuito «${circuit}»`, exact: true })).toBeVisible({ timeout: 15_000 });
}

/**
 * Todo el almacén salvo las dos tablas de expedientes, serializado de forma estable. Los bytes
 * comprimidos se comparan como lista de números.
 */
async function storeOutsideCases(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = [...db.objectStoreNames].filter((name) => name !== "incidentCases" && name !== "incidentEvidence").sort();
    const out: Record<string, unknown> = {};
    for (const name of names) {
      out[name] = await new Promise((resolve, reject) => {
        const request = db.transaction(name, "readonly").objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return JSON.stringify(out, (_key, value: unknown) => (value instanceof Uint8Array ? Array.from(value) : value));
  });
}

/** Cuántas revisiones de expediente hay guardadas. */
async function caseRows(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tag-trace");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction("incidentCases", "readonly").objectStore("incidentCases").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count;
  });
}

/**
 * Marca todas las tarjetas de la bandeja (como `valores-planta.spec.ts`): las de rango 1 se descartan y
 * el resto se confirma, para que el periodo se pueda consolidar. Lo hace la persona, no el programa.
 */
async function reviewAll(page: Page): Promise<void> {
  await openTab(page, "Resumen");
  // El rango 3 va plegado (3.70.0): se despliega para poder marcarlo.
  for (const fold of await page.locator("details.tray-fold").all()) {
    if ((await fold.getAttribute("open")) === null) await fold.locator("summary").click();
  }
  const cards = page.locator(".finding.reviewable");
  const total = await cards.count();
  for (let index = 0; index < total; index += 1) {
    const card = cards.nth(index);
    const critical = (await card.locator("xpath=ancestor::*[contains(@class,'tray-group')]").getAttribute("data-rank")) === "1";
    await card.getByRole("button", { name: /Revisión en campo/ }).click();
    await card.getByRole("menuitemradio", { name: critical ? /Descartado/ : /Confirmado/ }).click();
    await page.keyboard.press("Escape");
    await expect(card).toHaveAttribute("data-review", critical ? "descartado" : "confirmado");
  }
}

async function consolidateFirst(page: Page): Promise<void> {
  await openTab(page, "Memoria");
  const panel = page.locator(".memory-panel");
  await panel.getByRole("button", { name: "Previsualizar v1" }).click();
  const preview = panel.locator(".memory-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  await expect(preview.locator(".memory-blockers")).toHaveCount(0);
  await preview.getByRole("button", { name: "Confirmar y consolidar" }).click();
  await expect(panel.locator(".memory-status")).toContainText("Versión v1 consolidada", { timeout: 15_000 });
}

async function createFromSymptom(page: Page, title: string, from: string, to: string): Promise<void> {
  const panel = page.locator(".cases-panel");
  await panel.getByRole("button", { name: "Nuevo expediente…" }).click();
  const form = panel.locator(".case-create");
  await form.getByLabel("Título").fill(title);
  const send = form.getByRole("button", { name: "Crear expediente" });
  // Sin síntoma ni ventana no se envía.
  await expect(send).toBeDisabled();
  await form.getByLabel("Síntoma: qué ocurrió, dónde y cuándo").fill("Nadie pasa por el tag 0300 en un minuto.");
  await form.getByLabel("Principio del síntoma").fill(from);
  await form.getByLabel("Fin del síntoma").fill(to);
  await form.getByLabel("Tags (opcionales, separados por comas)").fill("0300");
  await expect(send).toBeEnabled();
  await send.click();
}

test.describe("expedientes de incidencia", () => {
  test.setTimeout(120_000);

  test("se crea, cambia de estado y se descarta sin tocar nada fuera de los expedientes", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "exp", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    const panel = page.locator(".cases-panel");
    await expect(panel.getByRole("heading", { name: "Expedientes de incidencia" })).toBeVisible();
    await expect(panel).toContainText("Este circuito no tiene expedientes.");
    await expect(panel).toContainText("borrar los datos del navegador lo pierde");
    // Sin referencias internas en el texto visible (UX_SPEC §4.4).
    await expect(panel).not.toContainText("OQ-");
    await expect(panel).not.toContainText("ADR-");

    const before = await storeOutsideCases(page);

    await createFromSymptom(page, "Sin paso por 0300", "2026-01-24T08:01", "2026-01-24T08:02");
    await expect(panel.locator(".cases-status")).toContainText("Expediente INC-exp-", { timeout: 15_000 });
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador");
    const item = panel.locator(".case-item").first();
    await expect(item).toHaveAttribute("data-state", "Draft");
    const caseId = (await item.getAttribute("data-case-id")) ?? "";
    expect(caseId).toMatch(/^INC-exp-\d{8}-01$/);
    // El recorte: las 24 lecturas del fichero, de los dos AGV, porque el fichero entero cae en la ventana.
    await expect(item.locator(".case-evidence")).toHaveText(/^24 lecturas de 2 AGV, congeladas de «periodo-1\.csv» \(lecturas retenidas\)\. Sin registro de conexiones del terminal en la ventana\.$/);
    await expect(item.locator(".case-window-text")).toContainText("30 min antes y 30 min después");
    await expect(item.locator(".case-references")).toContainText("Sin memoria consolidada");

    // Una nota, y pasar a revisión e investigar: cada cosa, una revisión más.
    await item.getByLabel("Añadir una nota").fill("Se avisa al turno de mañana.");
    await item.getByRole("button", { name: "Guardar la nota" }).click();
    await expect(panel.locator(".cases-status")).toContainText("Nota añadida", { timeout: 15_000 });
    await item.getByRole("button", { name: "Pasar a en revisión" }).click();
    await expect(item).toHaveAttribute("data-state", "UnderReview", { timeout: 15_000 });
    await item.getByRole("button", { name: "Pasar a investigando" }).click();
    await expect(item).toHaveAttribute("data-state", "Investigating", { timeout: 15_000 });

    // Planificar una contramedida exige lo que todavía no tiene: se enseña apagado y se dice qué falta.
    const plan = item.locator('.case-transition[data-to="CountermeasurePlanned"]');
    await expect(plan.getByRole("button", { name: "Pasar a contramedida planificada" })).toBeDisabled();
    await expect(plan).toContainText("Falta al menos una hipótesis que nada contradiga y una contramedida con responsable y fecha.");

    // No concluyente exige escribir qué falta; reabrir exige la evidencia nueva.
    const inconclusive = item.locator('.case-transition[data-to="Inconclusive"]');
    await expect(inconclusive.getByRole("button", { name: "Pasar a no concluyente" })).toBeDisabled();
    await inconclusive.getByLabel("Qué evidencia falta").fill("Las lecturas del turno anterior.");
    await inconclusive.getByRole("button", { name: "Pasar a no concluyente" }).click();
    await expect(item).toHaveAttribute("data-state", "Inconclusive", { timeout: 15_000 });
    const reopen = item.locator('.case-transition[data-to="Investigating"]');
    await reopen.getByLabel("Qué evidencia nueva lo reabre").fill("Llegó la exportación del turno anterior.");
    await reopen.getByRole("button", { name: "Pasar a investigando" }).click();
    await expect(item).toHaveAttribute("data-state", "Investigating", { timeout: 15_000 });
    await expect(item.locator(".case-history li")).toHaveCount(6);
    await expect(item.locator(".case-history")).toContainText("Reabierto: de no concluyente a investigando.");

    // Un segundo expediente del mismo día lleva 02, y se descarta con razón.
    await createFromSymptom(page, "Falsa alarma", "2026-01-24T08:02", "2026-01-24T08:03");
    await expect(panel.locator(".cases-status")).toContainText(/INC-exp-\d{8}-02/, { timeout: 15_000 });
    const second = panel.locator(".case-item", { has: page.locator(".case-title", { hasText: "Falsa alarma" }) });
    const discard = second.locator('.case-transition[data-to="Discarded"]');
    await discard.getByLabel("Por qué no es una incidencia").fill("Parada planificada que nadie anotó.");
    await discard.getByRole("button", { name: "Pasar a descartado" }).click();
    await expect(second).toHaveAttribute("data-state", "Discarded", { timeout: 15_000 });
    await expect(second.locator(".case-actions button")).toHaveCount(0);

    // INV-008: nada fuera de los expedientes ha cambiado.
    expect(await storeOutsideCases(page)).toBe(before);
    expect(await caseRows(page)).toBe(8);

    // Sobrevive a recargar y volver a importar, con su cadena entera.
    await page.reload();
    await importInto(page, "exp", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    await expect(panel.locator(".case-item")).toHaveCount(2);
    await expect(panel.locator(`.case-item[data-case-id="${caseId}"]`)).toHaveAttribute("data-state", "Investigating");
    await expect(panel.locator(".case-integrity")).toHaveCount(0);
  });

  test("con las lecturas ya no retenidas, el recorte sale del original archivado", async ({ page }) => {
    await freshPage(page);
    // Se retienen las dos últimas exportaciones: tras la tercera, las del 24 solo están en el archivo.
    await importInto(page, "arch", `${MEMORIA}periodo-1.csv`);
    await importInto(page, "arch", `${MEMORIA}periodo-2.csv`);
    await importInto(page, "arch", `${MEMORIA}periodo-3.csv`);
    await openTab(page, "Línea y calles");
    await createFromSymptom(page, "Del primer día", "2026-01-24T08:01", "2026-01-24T08:02");
    const panel = page.locator(".cases-panel");
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador", { timeout: 15_000 });
    await expect(panel.locator(".case-item").first().locator(".case-evidence")).toHaveText(
      /^24 lecturas de 2 AGV, congeladas de «periodo-1\.csv» \(original archivado\)\. Sin registro de conexiones del terminal en la ventana\.$/,
    );
  });

  test("TC-012: el punto crítico sin llegada se investiga hacia atrás frente al esperado, sin tocarlo", async ({ page }) => {
    test.setTimeout(180_000);
    const scenario = buildCriticalPointScenario();
    await freshPage(page);
    await openTab(page, "Resumen");
    await page.locator("#circuit-name").fill("critico");
    await page.locator("#source-file").setInputFiles({ name: "punto-critico.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.csv, "utf8") });
    await expect(page.getByRole("heading", { name: "Circuito «critico»", exact: true })).toBeVisible({ timeout: 30_000 });
    // El registro de conexiones del AGV 207 (DS-013), con su AGV en el nombre.
    const book = Buffer.from(await writeXlsx([{ name: "Sheet", rows: scenario.connectionRows, header: true, widths: [10, 20, 24, 8, 6, 8, 8, 6, 6, 6, 30, 6, 18] }]));
    await page.locator("#connections-file").setInputFiles({
      name: `CONEXIONES${WIFI_AGV}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: book,
    });
    await openTab(page, "Datos");
    await page.getByRole("button", { name: "Cargar el fichero" }).click();
    await expect(page.getByRole("heading", { name: "Registro de conexiones cargado" })).toBeVisible({ timeout: 30_000 });
    // Se vuelve a cargar el fichero para que el análisis lea el registro.
    await openTab(page, "Resumen");
    await page.locator("#source-file").setInputFiles([]);
    await page.locator("#source-file").setInputFiles({ name: "punto-critico.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.csv, "utf8") });
    await expect(page.getByRole("heading", { name: "Circuito «critico»", exact: true })).toBeVisible({ timeout: 30_000 });

    // La persona revisa y consolida el periodo: el expediente se mirará frente a ese esperado.
    await reviewAll(page);
    await consolidateFirst(page);

    await openTab(page, "Línea y calles");
    const before = await storeOutsideCases(page);
    const { truth } = scenario;
    const local = (utcMs: number): string => new Date(utcMs + 3_600_000).toISOString().slice(0, 16);
    const panel = page.locator(".cases-panel");
    await panel.getByRole("button", { name: "Nuevo expediente…" }).click();
    const form = panel.locator(".case-create");
    await form.getByLabel("Título").fill("Punto crítico sin llegada");
    await form.getByLabel("Síntoma: qué ocurrió, dónde y cuándo").fill("Más de diez minutos sin que llegue ningún AGV al punto crítico.");
    await form.getByLabel("Principio del síntoma").fill(local(truth.absenceFrom + 60_000));
    await form.getByLabel("Fin del síntoma").fill(local(truth.absenceTo));
    await form.getByLabel("Tags (opcionales, separados por comas)").fill(CRITICAL_TAG);
    await form.getByRole("button", { name: "Crear expediente" }).click();
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador", { timeout: 30_000 });

    const item = panel.locator(".case-item").first();
    await expect(item.locator(".case-evidence")).toContainText("8 AGV");
    await expect(item.locator(".case-evidence")).toContainText("eventos del registro de conexiones del terminal");
    const chronology = item.locator(".case-chronology");
    await expect(chronology.getByRole("heading", { name: "Retroceso desde el síntoma" })).toBeVisible();
    await expect(chronology.locator(".case-context")).toContainText("Anillo y horquillas del esperado de la versión consolidada v1.");
    await expect(item.locator(".case-references")).toContainText("Memoria v1");
    // El síntoma en el punto crítico, la primera desviación aguas arriba y el corte de WiFi: todo precede.
    const absence = chronology.locator('.case-fact[data-kind="sin-paso"]');
    await expect(absence).toContainText(`Último paso por ${CRITICAL_TAG} antes del síntoma`);
    await expect(absence.locator(".case-fact-relation")).toHaveText("precede");
    const first = chronology.locator('.case-fact[data-first="si"]');
    await expect(first).toHaveCount(1);
    await expect(first).toContainText(`AGV ${STALLED_AGV} tarda`);
    await expect(first).toContainText(`de ${STALL_TAG} a 71013, por encima de lo esperado en ese tramo`);
    await expect(first).toContainText("6 tags antes del síntoma por el anillo");
    await expect(first.locator(".case-fact-relation")).toHaveText("precede");
    const wifi = chronology.locator('.case-fact[data-kind="corte-wifi"]');
    await expect(wifi).toContainText(`AGV ${WIFI_AGV} sin conexión con el servidor`);
    await expect(wifi.locator(".case-fact-relation")).toHaveText("precede");
    // Lo de durante no lleva relación, y ninguna línea afirma una causa.
    await expect(chronology.locator('ol[data-phase="durante"] .case-fact-relation')).toHaveCount(0);
    await expect(chronology).not.toContainText(/\bcausa\b|debido a|provoc/i);
    await expect(chronology).toContainText("FIFO, calles de carga, la línea y el proceso no se revisan todavía");
    await expect(chronology).not.toContainText("OQ-");

    // El replay (ALG-016), a petición: lo visto, lo esperado y la conexión de cada AGV.
    await item.getByRole("button", { name: "Ver el replay" }).click();
    const replay = page.locator(".cases-panel .case-item").first().locator(".case-replay");
    await expect(replay.locator(".case-replay-table")).toBeVisible({ timeout: 30_000 });
    await expect(replay.locator(".case-replay-table tbody tr")).toHaveCount(8);
    await expect(replay.locator(".case-replay-note")).toContainText("según el esperado de la versión consolidada");
    // Desde el corte de WiFi, su fotograma: el AGV 207 sin conexión según el registro.
    await page.locator('.cases-panel .case-item').first().locator('.case-fact[data-kind="corte-wifi"]').getByRole("button", { name: "Ver en el replay" }).click();
    await expect(replay.locator(`tr[data-agv="${WIFI_AGV}"] td`).nth(3)).toHaveText("sin conexión (registro)");
    await expect(replay.locator(`tr[data-agv="201"] td`).nth(3)).toHaveText("sin registro");
    await expect(replay.locator(".case-replay-events")).toContainText(`AGV ${WIFI_AGV} sin conexión con el servidor`);
    // A mitad del síntoma, el AGV parado va por detrás de lo esperado, y se dice en palabras.
    const middle = Math.round(((truth.absenceFrom + 60_000 + truth.absenceTo) / 2 - (truth.absenceFrom + 60_000 - 30 * 60_000)) / ((truth.absenceTo + 30 * 60_000 - (truth.absenceFrom + 60_000 - 30 * 60_000)) / 199));
    await replay.locator(".case-replay-slider").fill(String(middle));
    await expect(replay.locator(".case-replay-when")).toHaveAttribute("data-phase", "durante");
    const stalled = replay.locator(`tr[data-agv="${STALLED_AGV}"]`);
    await expect(stalled).toHaveAttribute("data-behind", "si");
    await expect(stalled.locator("td").nth(1)).toContainText(STALL_TAG);
    await expect(stalled.locator("td").nth(2)).toContainText("va por detrás incluso del paso lento");
    await expect(replay).not.toContainText(/\bcausa\b|debido a|provoc/i);

    // Sobrevive a recargar con la misma cronología, y nada fuera de los expedientes cambió.
    const facts = await chronology.locator(".case-fact-text").allTextContents();
    expect(await storeOutsideCases(page)).toBe(before);
    await page.reload();
    await openTab(page, "Resumen");
    await page.locator("#circuit-name").fill("critico");
    await page.locator("#source-file").setInputFiles({ name: "punto-critico.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.csv, "utf8") });
    await expect(page.getByRole("heading", { name: "Circuito «critico»", exact: true })).toBeVisible({ timeout: 30_000 });
    await openTab(page, "Línea y calles");
    await panel.locator(".case-item").first().locator("summary").click();
    expect(await panel.locator(".case-item").first().locator(".case-fact-text").allTextContents()).toEqual(facts);
  });

  test("D5: la consolidación propone la ventana del expediente como incidencia excluida, y la persona la puede soltar", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "d5", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    await createFromSymptom(page, "Sin paso por 0300", "2026-01-24T08:01", "2026-01-24T08:02");
    const cases = page.locator(".cases-panel");
    await expect(cases.locator(".cases-status")).toContainText("creado en borrador", { timeout: 15_000 });
    const caseId = (await cases.locator(".case-item").first().getAttribute("data-case-id")) ?? "";
    const caseRowsBefore = await caseRows(page);

    await reviewAll(page);
    await openTab(page, "Memoria");
    const panel = page.locator(".memory-panel");
    await panel.getByRole("button", { name: "Previsualizar v1" }).click();
    const preview = panel.locator(".memory-preview");
    await expect(preview).toBeVisible({ timeout: 15_000 });
    const proposed = preview.locator(`.memory-case-list li[data-case-id="${caseId}"]`);
    await expect(proposed).toContainText("Sin paso por 0300");
    await expect(proposed).toContainText("borrador");
    const keep = proposed.getByLabel("Excluir su ventana del esperado");
    await expect(keep).toBeChecked();
    // Entra como una incidencia más, con su ventana.
    await expect(preview.locator(`.memory-incident-list li[data-key="expediente|${caseId}"]`)).toContainText(`Expediente ${caseId}`);

    // Soltarlo apaga «Confirmar» hasta volver a previsualizar.
    await keep.uncheck();
    const confirm = preview.getByRole("button", { name: "Confirmar y consolidar" });
    await expect(confirm).toBeDisabled();
    await expect(preview.locator(".memory-case-hint")).toBeVisible();
    await preview.getByRole("button", { name: "Volver a previsualizar con estos expedientes" }).click();
    await expect(panel.locator(`.memory-case-list li[data-case-id="${caseId}"]`).getByLabel("Excluir su ventana del esperado")).not.toBeChecked({ timeout: 15_000 });
    await expect(panel.locator(`.memory-incident-list li[data-key="expediente|${caseId}"]`)).toHaveCount(0);

    // Se vuelve a marcar, se previsualiza y se consolida: la versión guarda la incidencia del expediente.
    await panel.locator(`.memory-case-list li[data-case-id="${caseId}"]`).getByLabel("Excluir su ventana del esperado").check();
    await panel.getByRole("button", { name: "Volver a previsualizar con estos expedientes" }).click();
    await expect(panel.locator(`.memory-incident-list li[data-key="expediente|${caseId}"]`)).toHaveCount(1, { timeout: 15_000 });
    await panel.getByRole("button", { name: "Confirmar y consolidar" }).click();
    await expect(panel.locator(".memory-status")).toContainText("Versión v1 consolidada", { timeout: 15_000 });
    const keys = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("tag-trace");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<{ gz?: Uint8Array; incidents?: { key: string }[] }[]>((resolve, reject) => {
        const request = db.transaction("memory", "readonly").objectStore("memory").getAll();
        request.onsuccess = () => resolve(request.result as { gz?: Uint8Array }[]);
        request.onerror = () => reject(request.error);
      });
      db.close();
      const out: string[] = [];
      for (const row of rows) {
        const version =
          row.gz === undefined
            ? row
            : (JSON.parse(await new Response(new Blob([row.gz as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"))).text()) as { incidents?: { key: string }[] });
        for (const incident of version.incidents ?? []) out.push(incident.key);
      }
      return out;
    });
    expect(keys).toContain(`expediente|${caseId}`);
    // El expediente no se escribió: la consolidación solo lo lee.
    expect(await caseRows(page)).toBe(caseRowsBefore);
  });

  test("hipótesis, contramedida y verificación sobre el caso de TC-012, sin tocar nada fuera del expediente", async ({ page }) => {
    test.setTimeout(180_000);
    const scenario = buildCriticalPointScenario();
    const { truth } = scenario;
    await freshPage(page);
    await openTab(page, "Resumen");
    await page.locator("#circuit-name").fill("hipotesis");
    await page.locator("#source-file").setInputFiles({ name: "punto-critico.csv", mimeType: "text/csv", buffer: Buffer.from(scenario.csv, "utf8") });
    await expect(page.getByRole("heading", { name: "Circuito «hipotesis»", exact: true })).toBeVisible({ timeout: 30_000 });
    await openTab(page, "Línea y calles");
    const before = await storeOutsideCases(page);
    const local = (utcMs: number): string => new Date(utcMs + 3_600_000).toISOString().slice(0, 16);
    const panel = page.locator(".cases-panel");
    await panel.getByRole("button", { name: "Nuevo expediente…" }).click();
    const form = panel.locator(".case-create");
    await form.getByLabel("Título").fill("Punto crítico sin llegada");
    await form.getByLabel("Síntoma: qué ocurrió, dónde y cuándo").fill("Más de diez minutos sin llegadas al punto crítico.");
    await form.getByLabel("Principio del síntoma").fill(local(truth.absenceFrom + 60_000));
    await form.getByLabel("Fin del síntoma").fill(local(truth.absenceTo));
    await form.getByLabel("Tags (opcionales, separados por comas)").fill(CRITICAL_TAG);
    await form.getByRole("button", { name: "Crear expediente" }).click();
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador", { timeout: 30_000 });
    const item = panel.locator(".case-item").first();
    await item.getByRole("button", { name: "Pasar a en revisión" }).click();
    await expect(item).toHaveAttribute("data-state", "UnderReview", { timeout: 15_000 });
    await item.getByRole("button", { name: "Pasar a investigando" }).click();
    await expect(item).toHaveAttribute("data-state", "Investigating", { timeout: 15_000 });

    // La primera hipótesis es la del AGV parado, compatible, con lo que la sostiene y su comprobación.
    const first = item.locator(".case-hypothesis").first();
    await expect(first).toHaveAttribute("data-status", "compatible");
    await expect(first).toContainText(`El AGV ${STALLED_AGV} se detiene en ${STALL_TAG}`);
    await expect(first.locator(".case-hypothesis-status")).toHaveText("es compatible con lo observado");
    await expect(first.locator(".case-hypothesis-favor li").first()).toContainText(`AGV ${STALLED_AGV} tarda`);
    await expect(first.locator(".case-hypothesis-check")).toContainText(`qué tuvo parado al AGV ${STALLED_AGV}`);
    // Los de detrás, contradichos: había alguien parado delante.
    await expect(item.locator('.case-hypothesis[data-status="contradicha"]').first()).toContainText("ya estaba parado delante");
    // Confirmar exige la comprobación.
    const confirm = first.getByRole("button", { name: "Confirmar" });
    await expect(confirm).toBeDisabled();
    await first.getByLabel("Comprobación hecha (para confirmar) o razón (para descartar)").fill("El operario confirma un freno bloqueado en 205.");
    await confirm.click();
    await expect(panel.locator(`.case-hypothesis[data-decision="confirmada"]`)).toHaveCount(1, { timeout: 15_000 });
    await expect(panel.locator(".case-hypothesis-decision").first()).toHaveText("confirmada por una persona");

    // Una contramedida con la métrica del síntoma; planificar, aplicar y pasar a verificar.
    const fresh = panel.locator(".case-item").first();
    const cm = fresh.locator(".case-countermeasure-form");
    await expect(cm.locator(".case-cm-metric")).toContainText(`sin paso por ${CRITICAL_TAG}, por hora de producción`);
    await cm.getByLabel("Acción").fill("Revisar el freno de 205");
    await cm.getByLabel("Responsable").fill("Mantenimiento");
    await cm.getByLabel("Fecha prevista").fill(local(truth.absenceTo));
    await cm.getByRole("button", { name: "Guardar la contramedida" }).click();
    await expect(panel.locator(".case-countermeasure")).toHaveCount(1, { timeout: 15_000 });
    await panel.locator(".case-item").first().getByRole("button", { name: "Pasar a contramedida planificada" }).click();
    await expect(panel.locator(".case-item").first()).toHaveAttribute("data-state", "CountermeasurePlanned", { timeout: 15_000 });
    const measure = panel.locator(".case-countermeasure").first();
    await measure.getByLabel("Fecha de aplicación").fill(local(truth.absenceTo + 10 * 60_000));
    await measure.getByRole("button", { name: "Registrar la aplicación" }).click();
    await expect(panel.locator(".case-countermeasure-applied").first()).toContainText("Aplicada", { timeout: 15_000 });
    await panel.locator(".case-item").first().getByRole("button", { name: "Pasar a pendiente de verificar" }).click();
    await expect(panel.locator(".case-item").first()).toHaveAttribute("data-state", "VerificationPending", { timeout: 15_000 });

    // Verificar mide y propone; con dos horas de datos no hay exposición suficiente, y lo dice.
    await panel.locator(".case-countermeasure").first().getByRole("button", { name: "Medir y registrar la verificación" }).click();
    const verification = panel.locator(".case-verification");
    await expect(verification).toHaveAttribute("data-verdict", "sin-exposicion", { timeout: 30_000 });
    await expect(verification).toContainText("Propuesta del programa: sin exposición suficiente. La conclusión es tuya.");
    const ineffective = panel.locator(".case-item").first().locator('.case-transition[data-to="VerifiedIneffective"]');
    await ineffective.getByLabel("Conclusión de la verificación").fill("Sin datos de la semana siguiente: se vuelve a mirar con la próxima exportación.");
    await ineffective.getByRole("button", { name: "Pasar a verificada ineficaz" }).click();
    await expect(panel.locator(".case-item").first()).toHaveAttribute("data-state", "VerifiedIneffective", { timeout: 15_000 });
    await expect(panel).not.toContainText(/\bcausa\b|debido a|provoc/i);
    await expect(panel).not.toContainText("OQ-");
    // Nada fuera de los expedientes cambió.
    expect(await storeOutsideCases(page)).toBe(before);
  });

  test("informe del expediente, sus CSV y el resumen de expedientes en el informe del circuito", async ({ page }) => {
    const { readFileSync } = await import("node:fs");
    await freshPage(page);
    await importInto(page, "informe", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    await createFromSymptom(page, "Sin paso por 0300", "2026-01-24T08:01", "2026-01-24T08:02");
    const panel = page.locator(".cases-panel");
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador", { timeout: 15_000 });
    const item = panel.locator(".case-item").first();
    const caseId = (await item.getAttribute("data-case-id")) ?? "";
    const before = await storeOutsideCases(page);

    // El informe del expediente: un HTML autocontenido con los diez apartados y su revisión.
    const [report] = await Promise.all([page.waitForEvent("download"), item.getByRole("button", { name: "Informe del expediente" }).click()]);
    expect(report.suggestedFilename()).toMatch(/^expediente-inc-informe-\d{8}-01-\d{4}-\d{2}-\d{2}-\d{4}\.html$/);
    const html = readFileSync(await report.path(), "utf8");
    expect([...html.matchAll(/<h2>(\d+)\. /g)].map((match) => Number(match[1]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(html).toContain(`<h1>${caseId}: Sin paso por 0300</h1>`);
    expect(html).toContain("24 lecturas de 2 AGV");
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    expect(html).not.toContain("<button");

    // La cronología y las lecturas del recorte, en CSV.
    const [chronology] = await Promise.all([page.waitForEvent("download"), item.getByRole("button", { name: "Cronología (CSV)" }).click()]);
    expect(chronology.suggestedFilename()).toMatch(/^cronologia-inc-informe-.*\.csv$/);
    expect(readFileSync(await chronology.path(), "utf8")).toContain("fase;desde;hasta;relacion;tipo;agv;tags;tags_aguas_arriba;primera_desviacion;hecho;filas;filas_registro_conexiones");
    const [readings] = await Promise.all([page.waitForEvent("download", { timeout: 15_000 }), item.getByRole("button", { name: "Lecturas del recorte (CSV)" }).click()]);
    expect(readings.suggestedFilename()).toMatch(/^lecturas-inc-informe-.*\.csv$/);
    const rows = readFileSync(await readings.path(), "utf8").replace(/^\ufeff/, "").split("\r\n");
    expect(rows.filter((row) => row.startsWith("lectura;"))).toHaveLength(24);

    // El informe del circuito trae el resumen de expedientes.
    await openTab(page, "Resumen");
    await page.locator(".local-jumps").getByRole("button", { name: "Generar informe…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("input[name='cases']")).toBeChecked();
    const [circuit] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Generar y descargar" }).click()]);
    const circuitHtml = readFileSync(await circuit.path(), "utf8");
    expect(circuitHtml).toContain("Expedientes de incidencia · 1");
    expect(circuitHtml).toContain(`<tr><td>${caseId}</td><td>Sin paso por 0300</td><td>borrador</td>`);
    // Exportar no escribe nada.
    expect(await storeOutsideCases(page)).toBe(before);
  });
  test("casos parecidos: cada expediente se compara con los demás del circuito, característica a característica, sin afirmar causas", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "parecidos", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    const panel = page.locator(".cases-panel");
    await createFromSymptom(page, "Sin paso por 0300", "2026-01-24T08:01", "2026-01-24T08:02");
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador", { timeout: 15_000 });
    // Con uno solo no hay con qué comparar.
    await expect(panel.locator(".case-item").first().locator(".case-similar")).toContainText("No hay otros expedientes en este circuito");
    await createFromSymptom(page, "Otra vez sin paso por 0300", "2026-01-24T08:03", "2026-01-24T08:04");
    await expect(panel.locator(".case-item")).toHaveCount(2, { timeout: 15_000 });
    const before = await storeOutsideCases(page);
    const items = panel.locator(".case-item");
    const ids = await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-case-id") ?? ""));
    expect(new Set(ids).size).toBe(2);
    for (const [index, id] of ids.entries()) {
      const other = ids[1 - index]!;
      const details = items.nth(index).locator(".case-details");
      if ((await details.getAttribute("open")) === null) await details.locator("> summary").click();
      const similar = items.nth(index).locator(".case-similar");
      await expect(similar.getByRole("heading", { name: "Casos parecidos" })).toBeVisible();
      const entry = similar.locator(`.case-similar-item[data-case-id="${other}"]`);
      await expect(entry).toHaveCount(1);
      await expect(similar.locator(`.case-similar-item[data-case-id="${id}"]`)).toHaveCount(0);
      await expect(entry.locator("summary")).toContainText(/coinciden \d+ de \d+/);
      await entry.locator("summary").click();
      await expect(entry.locator('tr:has(td:text-is("Tags del síntoma")) td').nth(1)).toHaveText("igual");
      const text = (await similar.innerText()).toLowerCase();
      for (const word of ["causa", "provoca", "debido a", "correlaciona", "oq-", "adr-"]) expect(text, word).not.toContain(word);
    }
    // Comparar no escribe nada.
    expect(await storeOutsideCases(page)).toBe(before);
  });
  test("copia en el .agvproj: se borra el circuito, se abre la copia y el expediente vuelve entero (OQ-174)", async ({ page }) => {
    await freshPage(page);
    await importInto(page, "copia", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    await createFromSymptom(page, "Sin paso por 0300", "2026-01-24T08:01", "2026-01-24T08:02");
    const panel = page.locator(".cases-panel");
    await expect(panel.locator(".cases-status")).toContainText("creado en borrador", { timeout: 15_000 });
    const caseId = (await panel.locator(".case-item").first().getAttribute("data-case-id")) ?? "";
    const history = await panel.locator(".case-item").first().locator(".case-history").innerText();
    expect(history).toContain("Revisión 1");

    await openTab(page, "Datos");
    const [project] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar circuito (.agvproj)" }).click()]);
    await expect(page.locator(".message")).toContainText("Incluye el expediente de incidencia, con sus revisiones y recortes.");
    const path = await project.path();

    // Se pierde todo lo del dispositivo.
    await page.locator(".storage").getByRole("button", { name: "Borrar el circuito…" }).click();
    await expect(page.locator(".storage-lost")).toContainText("1 expediente de incidencia (1 revisión)");
    await page.getByLabel("Para confirmar, escribe «copia»").fill("copia");
    await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Borrar para siempre" }).click()]);

    // Se abre la copia: el expediente entra entero, con su recorte.
    await openTab(page, "Datos");
    await page.locator("#project-file").setInputFiles(path);
    await expect(page.locator(".message")).toContainText("Expedientes de incidencia: 1 en el fichero; 1 nuevo");
    await expect(page.locator(".message")).toContainText("(1 revisión añadida)");
    await expect(page.locator(".message")).not.toContainText("cadena rota");
    // Con las lecturas otra vez, el expediente se ve igual que antes.
    await importInto(page, "copia", `${MEMORIA}periodo-1.csv`);
    await openTab(page, "Línea y calles");
    const item = panel.locator(`.case-item[data-case-id="${caseId}"]`);
    await expect(item).toHaveCount(1);
    await item.locator(".case-details > summary").click();
    await expect(item.locator(".case-history")).toHaveText(history);
    await expect(item.locator(".case-evidence")).toContainText("24 lecturas de 2 AGV");
    await expect(item.locator(".case-integrity, .case-broken")).toHaveCount(0);

    // Abrirla otra vez no duplica nada.
    await openTab(page, "Datos");
    await page.locator("#project-file").setInputFiles([]);
    await page.locator("#project-file").setInputFiles(path);
    await expect(page.locator(".message")).toContainText("1 que ya estaba (0 revisiones añadidas)");
  });
});
