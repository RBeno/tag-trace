import { defineConfig, devices } from "@playwright/test";

/**
 * Pruebas de navegador.
 *
 * Existen porque hay afirmaciones del producto que Node no puede comprobar: que el almacén local
 * guarda de verdad, que la acumulación sobrevive a cerrar la pestaña, que cancelar no deja nada
 * escrito, y que el flujo analítico **no sale a la red**. Todo eso solo se ve en una página.
 *
 * Se prueba sobre `dist`, no sobre el servidor de desarrollo: lo que hay que verificar es lo que
 * se publica, incluidos el Worker empaquetado y la separación de capas real del bundle.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: process.env["CI"] === undefined ? "list" : [["list"], ["github"]],
  use: {
    // La aplicación se publica bajo `/tag-trace/` (ADR-0014, Pages), así que la raíz sirve
    // el HTML pero no sus recursos. Se prueba la ruta real, no una que solo existe aquí.
    baseURL: "http://127.0.0.1:4173/tag-trace/",
    trace: "retain-on-failure",
    launchOptions: {
      // Chromium, por su cuenta, consulta actualizaciones de componentes y comprueba conectividad.
      // Eso no es la aplicación, pero ensucia cualquier juicio sobre si «el producto sale a la red»
      // y en un equipo de planta sin salida sería ruido en los registros. Se apaga.
      args: [
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      // El navegador va **apuntado**, no descargado. Playwright espera la compilación que su
      // versión fija; si no coincide con la que el entorno trae, intenta bajarla, y aquí eso no
      // debe pasar: lo mismo valdrá en un equipo sin salida a Internet, que es la norma en planta.
      ...(process.env["CHROMIUM_PATH"] === undefined
        ? {}
        : { executablePath: process.env["CHROMIUM_PATH"] }),
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/tag-trace/",
    reuseExistingServer: process.env["CI"] === undefined,
    timeout: 60_000,
  },
});
