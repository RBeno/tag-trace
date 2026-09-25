/**
 * Escribe las plantillas de Excel que se entregan al propietario: las listas del circuito y el
 * historial de flota, para rellenar e importar.
 *
 *   npx vite-node scripts/generar-plantillas-excel.ts [carpeta]
 *
 * La aplicación no las genera: se entregan como ficheros. Por omisión se escriben en `local/`, que
 * `.gitignore` excluye; el repositorio no guarda ningún `.xlsx` (`scripts/check_data.sh`).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fleetTemplate, listsTemplate } from "../tests/support/plantillas-excel.js";
import { writeXlsx } from "../tests/support/xlsx-writer.js";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destino = resolve(process.argv[2] ?? resolve(raiz, "local"));
mkdirSync(destino, { recursive: true });

for (const [nombre, hojas] of [
  ["plantilla-listas.xlsx", listsTemplate()],
  ["plantilla-flota.xlsx", fleetTemplate()],
] as const) {
  const ruta = resolve(destino, nombre);
  writeFileSync(ruta, await writeXlsx(hojas));
  console.log(ruta);
}
