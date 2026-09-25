/**
 * Una exportación de lecturas en Excel (`.xlsx`) como el texto que el importador ya sabe leer
 * (DS-001, DS-011).
 *
 * El informe se puede sacar directamente en Excel, y pasarlo a CSV a mano es donde se pierden los
 * ceros de los AGV y se estropean las fechas. Aquí la primera hoja se convierte en líneas con un
 * separador que no aparece en ninguna celda, y el resto —cabecera por nombre, orden de fecha,
 * sentido de la pila, cuarentena— lo hace el importador de siempre, con las mismas reglas. Cada fila
 * sigue en su número, así que la procedencia apunta a la fila del libro, y cada fila se completa hasta
 * el ancho de la cabecera, porque Excel no guarda las celdas vacías del final.
 *
 * Una fecha que Excel guardó como número (la celda no estaba en texto) se lee como la fecha de
 * pared que se escribió (`excelSerialToText`), igual que en el historial de flota.
 */

import { excelSerialToText } from "./fleet-history.js";
import { HEADER_ALIASES, normaliseHeaderCell } from "./importer.js";

/** Las filas de la hoja como texto delimitado, listo para `importReadings`. */
export function rowsToDelimitedText(rows: readonly (readonly string[])[]): string {
  // Excel no guarda las celdas vacías del final de una fila: sin rellenarlas, una fila `Uso` sin tag
  // tendría menos campos que la cabecera y caería en cuarentena por eso, no por no traer tag.
  const width = rows[0]?.length ?? 0;
  const cells = rows.map((row) =>
    row.length === 0 ? [] : Array.from({ length: Math.max(width, row.length) }, (_, index) => (row[index] ?? "").replace(/[\r\n]+/g, " ")),
  );
  const delimiter = cells.some((row) => row.some((cell) => cell.includes(";"))) ? "\t" : ";";
  const header = cells[0] ?? [];
  const dateColumn = header.findIndex((name) => (HEADER_ALIASES.time as readonly string[]).includes(normaliseHeaderCell(name)));
  return cells
    .map((row, index) =>
      (index > 0 && dateColumn >= 0 ? row.map((cell, column) => (column === dateColumn ? excelSerialToText(cell) : cell)) : row).join(delimiter),
    )
    .join("\n");
}
