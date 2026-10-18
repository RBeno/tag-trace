/**
 * WP-001 y WP-002 sostenidos por el grafo de dependencias.
 *
 * El defecto que hundió al prototipo no fue de rendimiento: fue que la interfaz **podía** parsear, y
 * acabó haciéndolo dos veces —una como «comprobación previa» y otra dentro del Worker— además de
 * recalcularlo todo en el hilo principal cuando el Worker devolvía cero lecturas.
 *
 * Un comentario no impide eso. Lo impide que la capa de presentación no tenga forma de alcanzar el
 * núcleo de ingesta. Esta prueba comprueba exactamente eso, para que una importación añadida sin
 * pensar falle aquí y no en el móvil de un operario.
 */

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PRESENTATION = new URL("../../src/presentation/", import.meta.url);
const DOMAIN = new URL("../../src/domain/", import.meta.url);
const APPLICATION = new URL("../../src/application/", import.meta.url);
const PERSISTENCE = new URL("../../src/persistence/", import.meta.url);
const WORKERS = new URL("../../workers/", import.meta.url);

function sourcesOf(folder: URL): { readonly name: string; readonly code: string }[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, code: readFileSync(new URL(name, folder), "utf8") }));
}

/** Las carpetas de `src/` (o `src/<carpeta>/` desde `workers/`) que importa un módulo. */
function importedLayers(code: string): string[] {
  return [...code.matchAll(/from\s+["'](?:\.\.\/)+(?:src\/)?([a-z]+)\//g)].map((match) => match[1] as string);
}

function presentationSources(): { readonly name: string; readonly code: string }[] {
  return readdirSync(PRESENTATION)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, code: readFileSync(new URL(name, PRESENTATION), "utf8") }));
}

describe("WP-001/WP-002 · la presentación no puede analizar", () => {
  it("hay módulos de presentación que revisar", () => {
    // Sin esto las tres comprobaciones siguientes pasarían solas si la carpeta cambiara de sitio,
    // que es la forma más silenciosa que tiene una prueba de dejar de proteger nada.
    expect(presentationSources().map((source) => source.name)).toContain("main.ts");
  });

  it("ningún módulo de presentación importa de ingestion/", () => {
    for (const { name, code } of presentationSources()) {
      expect({ name, importsIngestion: /from\s+["'][^"']*ingestion\//.test(code) }).toEqual({
        name,
        importsIngestion: false,
      });
    }
  });

  it("ningún módulo de presentación importa el Worker como módulo", () => {
    // `new Worker(new URL(...))` sí es legítimo: eso arranca un hilo, no trae el código al principal.
    for (const { name, code } of presentationSources()) {
      expect({ name, importsWorker: /from\s+["'][^"']*workers\//.test(code) }).toEqual({
        name,
        importsWorker: false,
      });
    }
  });

  it("la presentación no tiene ningún camino de repuesto que recalcule al fallar el Worker", () => {
    for (const { name, code } of presentationSources()) {
      // El prototipo re-ejecutaba el análisis completo cuando el Worker devolvía cero lecturas.
      // Aquí `onerror` solo informa; si algún día vuelve a haber cálculo, no será por descuido.
      expect({ name, hasFallback: /fallback|recalcul|analyzeProject/i.test(code) }).toEqual({
        name,
        hasFallback: false,
      });
    }
  });
});


/**
 * Las reglas de `ARCHITECTURE.md` §3 que el código cumple de verdad, convertidas en prueba para que
 * dejen de ser un dibujo: el núcleo (dominio y aplicación) no sabe de navegador, de almacén ni de
 * Workers, y el Worker no trae la presentación consigo.
 */
describe("ARCHITECTURE §3 · las capas que existen", () => {
  it("el dominio solo importa dominio", () => {
    for (const { name, code } of sourcesOf(DOMAIN)) {
      expect({ name, layers: importedLayers(code) }).toEqual({ name, layers: [] });
    }
  });

  it("la aplicación importa dominio e ingesta, nada más", () => {
    for (const { name, code } of sourcesOf(APPLICATION)) {
      const foreign = importedLayers(code).filter((layer) => layer !== "domain" && layer !== "ingestion");
      expect({ name, foreign }).toEqual({ name, foreign: [] });
    }
  });

  it("la persistencia solo importa dominio", () => {
    for (const { name, code } of sourcesOf(PERSISTENCE)) {
      const foreign = importedLayers(code).filter((layer) => layer !== "domain");
      expect({ name, foreign }).toEqual({ name, foreign: [] });
    }
  });

  it("ni el dominio ni la aplicación tocan el navegador, el almacén ni el Worker", () => {
    // `window` no entra en la lista porque es también el nombre de un parámetro (`CaseWindow`).
    const browser = /\bdocument\.|\bindexedDB\b|\blocalStorage\b|\bsessionStorage\b|\bnavigator\.|\bpostMessage\(|new Worker\(|\bself\.|requestAnimationFrame|\bfetch\(/;
    for (const { name, code } of [...sourcesOf(DOMAIN), ...sourcesOf(APPLICATION)]) {
      expect({ name, touchesBrowser: browser.test(code) }).toEqual({ name, touchesBrowser: false });
    }
  });

  it("el Worker no importa la presentación", () => {
    const sources = sourcesOf(WORKERS);
    expect(sources.length).toBeGreaterThan(0);
    for (const { name, code } of sources) {
      expect({ name, layers: importedLayers(code).filter((layer) => layer === "presentation") }).toEqual({ name, layers: [] });
    }
  });
});
