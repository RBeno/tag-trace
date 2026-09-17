import { defineConfig } from "vitest/config";

/**
 * Qué mira Vitest, y qué no.
 *
 * Sin esto, Vitest recoge también los ficheros de Playwright —ambos acaban en `.spec.ts` o
 * `.test.ts` y el patrón por defecto no distingue— e intenta ejecutarlos, con el resultado de
 * «Playwright Test did not expect test.describe() to be called here». Los dos corredores se pisan
 * porque nadie les ha dicho dónde mirar.
 *
 * Se declara el territorio de cada uno en lugar de confiar en la convención de nombres: Vitest solo
 * `tests/unit/`, Playwright solo `tests/e2e/` (fijado en `playwright.config.ts`). Añadir una prueba
 * en el sitio equivocado falla al ejecutarla, que es cuando se quiere descubrir.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    // Explícito aunque `include` ya lo deje fuera: si alguien amplía `include`, esto sigue en pie.
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
