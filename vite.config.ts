import { defineConfig } from "vite";

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
}));
