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
