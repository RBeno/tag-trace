import { defineConfig } from "vite";

// El repositorio se publica en GitHub Pages bajo /tag-trace/, así que la base
// no puede ser "/". En desarrollo sí, para que el servidor local sirva la raíz.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/tag-trace/" : "/",
  build: { target: "es2022", sourcemap: true },
  worker: { format: "es" },
}));
