/**
 * El espacio del dispositivo y lo que se pierde al borrar un circuito (`UX_SPEC.md` §8; F6, entrega 5).
 *
 * Lo que se fija:
 * - el espacio usado se dice en MB, con el límite del navegador, y si el guardado es persistente o no;
 *   sin datos del navegador, se dice que no los da;
 * - lo que se pierde enumera solo lo que hay, con la concordancia de la cifra.
 */

import { describe, expect, it } from "vitest";

import { inventoryLines, storageText } from "../../src/presentation/storage-ui.js";

const MB = 1024 * 1024;

describe("espacio y borrado", () => {
  it("el espacio usado y si es persistente", () => {
    expect(storageText({ usage: 12.34 * MB, quota: 2048 * MB }, true)).toBe(
      "La aplicación usa 12,3 MB de los 2048 MB que este navegador le deja. Guardado persistente: el navegador no lo borrará por falta de espacio.",
    );
    expect(storageText({ usage: 0, quota: 10 * MB }, false)).toContain("puede borrarlo; exporta la copia de cada circuito");
    expect(storageText(null, null)).toBe("Este navegador no dice cuánto espacio usa la aplicación.");
  });

  it("lo que se pierde, solo lo que hay y en singular o plural", () => {
    const lines = inventoryLines({ exists: true, sources: 1, snapshots: 3, archived: 1, memoryVersions: 0, planEvents: 0, plantValues: 2, caseRevisions: 4, cases: 1, reviewed: 0 });
    expect(lines).toEqual([
      "1 fichero de lecturas con lo acumulado",
      "1 original archivado",
      "3 instantáneas",
      "2 valores de planta confirmados",
      "1 expediente de incidencia (4 revisiones)",
    ]);
  });
});
