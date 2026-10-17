/**
 * Actualización segura y sin red (NFR-010, NFR-011, NFR-016, `UX_SPEC.md` §9).
 *
 * Lo que se fija, en el navegador y con el `sw.js` compilado:
 * - la versión abierta está a la vista y su caché lleva su nombre, con la compilación entera;
 * - sin red, la aplicación se vuelve a abrir e importa un fichero;
 * - una versión nueva se instala en espera y se avisa con su número y lo que pasa con lo guardado;
 * - con una importación en curso no se puede activar; al terminar, sí, y la página se recarga con
 *   la versión nueva.
 *
 * La «versión nueva» es el mismo `sw.js` servido con otro número: lo que se prueba es el camino de
 * la espera, el aviso y la activación, no el contenido de otra compilación. Como el navegador pide el
 * script del service worker sin pasar por la interceptación de Playwright, esa prueba se sirve desde
 * un servidor propio sobre `dist`, en otro puerto, para no tocar lo que ven las demás pruebas.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const MEMORIA = fileURLToPath(new URL("../../fixtures/synthetic/memoria/", import.meta.url));
const VERSION = /^## \[(\d+\.\d+\.\d+)\]/m.exec(readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8"))?.[1] ?? "dev";

const DIST = fileURLToPath(new URL("../../dist/", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

/** Sirve `dist` bajo `/tag-trace/`; `swVersion` cambia la versión con la que sale `sw.js`. */
function distServer(state: { swVersion: string | null }): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://x").pathname.replace(/^\/tag-trace\//, "");
    const file = normalize(join(DIST, path === "" ? "index.html" : path));
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end();
      return;
    }
    try {
      let body: Buffer | string = readFileSync(file);
      if (path === "sw.js" && state.swVersion !== null) body = body.toString("utf8").replace(`const VERSION = "${VERSION}";`, `const VERSION = "${state.swVersion}";`);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/tag-trace/` });
    });
  });
}

/**
 * Cada prueba tiene un contexto de navegador nuevo, sin service worker ni cachés: basta con abrir y
 * esperar a que el primero se instale, se active solo (no hay otro al que esperar) y tome la página.
 */
async function freshControlled(page: Page, url = "./"): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 15_000 });
}

/** Un fichero grande, para que la importación dure lo bastante como para mirar el aviso a mitad. */
function bigSource(): Buffer {
  const lines = ["Fecha;AGV;Tag"];
  const start = Date.UTC(2026, 0, 24, 4, 0, 0);
  for (let index = 150_000 - 1; index >= 0; index -= 1) {
    const instant = new Date(start + index * 1000);
    const stamp = `24/01/2026 ${String(instant.getUTCHours()).padStart(2, "0")}:${String(instant.getUTCMinutes()).padStart(2, "0")}:${String(instant.getUTCSeconds()).padStart(2, "0")}`;
    lines.push(`${stamp};${String(index % 40).padStart(4, "0")};${50_000 + (index % 120)}`);
  }
  return Buffer.from(lines.join("\r\n"), "utf8");
}

test.describe("actualización y sin red", () => {
  test.setTimeout(120_000);

  test("la versión abierta se ve, su caché tiene la compilación entera y sin red se abre e importa", async ({ page, context }) => {
    await freshControlled(page);
    await expect(page.locator(".app-version")).toHaveText(`Versión ${VERSION}`);
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const cache = await caches.open(names.find((name) => name.startsWith("tag-trace-")) ?? "");
      return { names, urls: (await cache.keys()).map((request) => new URL(request.url).pathname) };
    });
    expect(cached.names).toEqual([`tag-trace-${VERSION}`]);
    expect(cached.urls).toContain("/tag-trace/");
    expect(cached.urls.some((url) => /\/assets\/import\.worker-.*\.js$/.test(url))).toBe(true);
    expect(cached.urls.some((url) => url.endsWith(".map"))).toBe(false);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator(".app-version")).toHaveText(`Versión ${VERSION}`);
    await page.locator("#circuit-name").fill("sin-red");
    await page.locator("#source-file").setInputFiles(`${MEMORIA}periodo-1.csv`);
    await expect(page.getByRole("heading", { name: "Circuito «sin-red»", exact: true })).toBeVisible({ timeout: 15_000 });
    await context.setOffline(false);
  });

  test("una versión nueva espera, se avisa, no se activa con una importación en curso y al terminar sí", async ({ page }) => {
    const state: { swVersion: string | null } = { swVersion: null };
    const { server, url } = await distServer(state);
    test.info().attachments.push({ name: "servidor", contentType: "text/plain", body: Buffer.from(url) });
    try {
      await freshControlled(page, url);
    const notice = page.locator(".update-notice");
    await expect(notice).toBeHidden();

    // El mismo `sw.js`, con otro número de versión: para el navegador es una versión nueva.
    state.swVersion = "9.9.9";
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(notice.getByRole("heading")).toHaveText(`Hay una versión nueva: 9.9.9 (abierta: ${VERSION}).`);
    await expect(notice).toContainText("Lo guardado en este dispositivo se abre igual.");
    // Sigue mandando la versión abierta: la nueva está en espera.
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration?.waiting !== null))).toBe(true);

    const button = notice.getByRole("button", { name: "Cambiar a 9.9.9" });
    await expect(button).toBeEnabled();
    await page.locator("#circuit-name").fill("grande");
    await page.locator("#source-file").setInputFiles({ name: "grande.csv", mimeType: "text/csv", buffer: bigSource() });
    await expect(button).toBeDisabled();
    await expect(notice).toContainText("Se podrá actualizar cuando termine la operación en curso.");
    await expect(page.getByRole("heading", { name: "Circuito «grande»", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(button).toBeEnabled();

    await Promise.all([page.waitForEvent("load"), button.click()]);
    await page.waitForFunction(
      async () => {
        const controller = navigator.serviceWorker.controller;
        if (controller === null) return false;
        const channel = new MessageChannel();
        const answer = new Promise<string>((resolve) => {
          channel.port1.onmessage = (event: MessageEvent<{ version: string }>) => resolve(event.data.version);
        });
        controller.postMessage({ type: "version" }, [channel.port2]);
        return (await answer) === "9.9.9";
      },
      undefined,
      { timeout: 15_000 },
    );
    await expect(notice).toBeHidden();
    } finally {
      server.close();
    }
  });
});
