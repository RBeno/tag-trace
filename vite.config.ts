import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, type Plugin } from "vite";

/** La última versión publicada en `CHANGELOG.md`: la fuente de verdad de la versión del producto. */
function changelogVersion(): string {
  const match = /^## \[(\d+\.\d+\.\d+)\]/m.exec(readFileSync(new URL("./CHANGELOG.md", import.meta.url), "utf8"));
  return match?.[1] ?? "dev";
}

/** La versión del almacén local, la misma que abre `src/persistence/store.ts`. */
function storeVersion(): string {
  const match = /^export const STORE_VERSION = (\d+);/m.exec(readFileSync(new URL("./src/persistence/store.ts", import.meta.url), "utf8"));
  if (match?.[1] === undefined) throw new Error("No se encuentra STORE_VERSION en src/persistence/store.ts.");
  return match[1];
}

/**
 * Sella `sw.js` con la versión, la del almacén y la lista de ficheros de esta compilación
 * (NFR-011, NFR-016). Así cada publicación tiene su service worker, que el navegador instala en
 * espera, y su caché propia con todo lo necesario para abrir sin red. Los mapas de fuente no van: no
 * hacen falta para usar la aplicación y pesan más que ella.
 */
function serviceWorkerManifest(version: string): Plugin {
  let outDir = "dist";
  return {
    name: "tag-trace-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    writeBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => !name.endsWith(".map") && name !== "index.html")
        .concat(["manifest.webmanifest", "icono.svg"])
        .sort()
        .map((name) => `./${name}`);
      const path = join(outDir, "sw.js");
      const source = readFileSync(path, "utf8");
      const sealed = source
        .replace('"__TT_APP_VERSION__"', JSON.stringify(version))
        .replace('"__TT_STORE_VERSION__"', JSON.stringify(storeVersion()))
        .replace('["__TT_PRECACHE__"]', JSON.stringify(["./", ...files]));
      if (sealed.includes("__TT_")) throw new Error("sw.js conserva alguna marca sin sustituir.");
      writeFileSync(path, sealed);
    },
  };
}

/**
 * El repositorio se publica en GitHub Pages bajo `/tag-trace/`, así que lo compilado no puede
 * colgar de la raíz.
 *
 * `preview` **también** tiene que servir en esa base. Antes no lo hacía —solo se miraba `command`,
 * que vale `"serve"` tanto en desarrollo como en vista previa— y el resultado era que
 * `npm run preview` servía `index.html` para cada recurso: la página salía en blanco y nadie lo
 * notaba, porque en desarrollo funciona y en producción también. Lo destapó la primera prueba de
 * navegador, que es justo lo que se le pedía.
 */
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview === true ? "/tag-trace/" : "/",
  build: { target: "es2022", sourcemap: true },
  worker: { format: "es" },
  plugins: [serviceWorkerManifest(changelogVersion())],
  // La versión sella cada instantánea (ADR-0015): `src/application/version.ts`.
  define: { __APP_VERSION__: JSON.stringify(changelogVersion()) },
}));
