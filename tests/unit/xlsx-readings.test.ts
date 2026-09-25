/**
 * Lecturas en Excel (`src/ingestion/xlsx-readings.ts`).
 *
 * Lo que se fija: una exportación en `.xlsx` da exactamente las mismas lecturas que la misma
 * exportación en CSV —ceros de los AGV, orden de pila, fila de procedencia y filas sin tag, que Excel
 * guarda sin sus celdas vacías del final—, una fecha que
 * Excel guardó como número se lee como la que se escribió, y un `;` dentro de una celda no rompe las
 * columnas.
 */

import { describe, expect, it } from "vitest";

import { importReadings, type ImportCallbacks } from "../../src/ingestion/importer.js";
import { rowsToDelimitedText } from "../../src/ingestion/xlsx-readings.js";
import { readXlsxRows } from "../../src/persistence/xlsx.js";
import { writeXlsx } from "../support/xlsx-writer.js";

const ZONE = "Europe/Madrid";
const silent: ImportCallbacks = { onProgress: () => {}, isCancelled: () => false };
const options = { sourceId: "s", fileName: "f", byteSize: 1, zone: ZONE };

const rows = [
  ["Tipo", "Fecha", "AGV", "Circuito", "Tag"],
  ["Tag", "18/09/2026 6:03:26", "0712", "C1", "60012"],
  ["Uso", "18/09/2026 6:03:20", "0712", "C1", ""],
  ["Tag", "18/09/2026 6:03:10", "0712", "C1", "60006"],
  ["Tag", "18/09/2026 6:02:55", "7105", "C1", "60006"],
  ["Tag", "18/09/2026 6:02:40", "0712", "C1", "60009"],
];

describe("lecturas en Excel", () => {
  it("dan las mismas lecturas que el mismo fichero en CSV, con sus ceros y su fila", async () => {
    const csv = importReadings(rows.map((row) => row.join(";")).join("\r\n"), options, silent);
    const bytes = await writeXlsx([{ name: "Sheet", rows, header: true, widths: rows[0]?.map(() => 12) ?? [] }]);
    const xlsx = importReadings(rowsToDelimitedText(await readXlsxRows(bytes)), options, silent);

    expect(xlsx.readings).toEqual(csv.readings);
    expect(xlsx.quarantine).toEqual(csv.quarantine);
    expect(xlsx.summary.rowsWithoutTag).toBe(csv.summary.rowsWithoutTag);
    expect(xlsx.readings.map((reading) => reading.agvId)).toContain("0712");
    expect(xlsx.readings.find((reading) => reading.tagId === "60012")?.provenance.sourceRow).toBe(2);
  });

  it("una fecha que Excel guardó como número se lee como la que se escribió", () => {
    // 46283,25 es el 18/09/2026 a las 06:00:00 en la hora de pared de la hoja.
    const text = rowsToDelimitedText([
      ["Fecha", "AGV", "Tag"],
      ["46283.25", "0712", "60006"],
    ]);
    expect(text.split("\n")[1]).toBe("18/09/2026 06:00:00;0712;60006");
  });

  it("un «;» dentro de una celda cambia el separador en vez de partir la columna", () => {
    const text = rowsToDelimitedText([
      ["Fecha", "AGV", "Tag", "Uso"],
      ["18/09/2026 6:00:00", "0712", "60006", "PARADA; MANUAL"],
    ]);
    expect(text.split("\n")[1]?.split("\t")).toEqual(["18/09/2026 6:00:00", "0712", "60006", "PARADA; MANUAL"]);
  });
});
