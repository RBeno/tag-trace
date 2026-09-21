/**
 * Vuelca el circuito de auditoría a `local/`, para cargarlo a mano en el navegador.
 *
 *   npx vite-node scripts/generar-auditoria.ts
 *
 * Es el **mismo generador y la misma semilla** que usa `tests/audit/auditoria.test.ts`: lo que se
 * audita en automático y lo que se mira a ojo son el mismo escenario, así que un hallazgo en la
 * pantalla se puede buscar en el informe y al revés.
 *
 * Escribe en `local/`, que `.gitignore` excluye. No porque estos datos sean sensibles —son
 * inventados— sino porque son megabytes que envejecen: lo que se conserva es el generador.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildAuditScenario } from "../tests/support/circuito-auditoria.js";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destino = resolve(raiz, "local");
mkdirSync(destino, { recursive: true });

const escenario = buildAuditScenario();
const lecturas = resolve(destino, "auditoria-lecturas.csv");
const listas = resolve(destino, "auditoria-listas.csv");

writeFileSync(lecturas, escenario.readingsCsv, "utf8");
writeFileSync(listas, escenario.listsCsv, "utf8");

const filas = escenario.readingsCsv.split("\r\n").length - 1;
console.log(`Lecturas: ${lecturas} (${filas.toLocaleString("es-ES")} filas)`);
console.log(`Listas:   ${listas} (${escenario.declaredRing.length} tags declarados)`);
console.log("");
console.log("Lo que hay plantado, para poder buscarlo en la pantalla:");
for (const defecto of escenario.defects) {
  const quien = defecto.vehicles.length > 0 ? ` · AGV ${defecto.vehicles.join(", ")}` : "";
  console.log(`  ${defecto.kind}: ${defecto.tags.join(", ")}${quien}`);
  console.log(`      debe decir: ${defecto.expect}`);
  console.log(`      no puede decir: ${defecto.mustNotSay}`);
}
