/**
 * Descargar un libro de Excel hecho en el navegador: las plantillas de las listas y del historial de
 * flota, y el borrador del circuito de un análisis (`domain/list-templates.ts`). Solo da forma a lo
 * que ya está calculado; no analiza nada.
 */

import type { TableSheet } from "../domain/list-templates.js";
import { writeXlsx } from "../persistence/xlsx.js";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function downloadWorkbook(fileName: string, sheets: readonly TableSheet[]): Promise<void> {
  const bytes = await writeXlsx(sheets);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** Un botón que descarga un libro; se deshabilita mientras se escribe. */
export function workbookButton(label: string, fileName: () => string, sheets: () => readonly TableSheet[]): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    button.disabled = true;
    void downloadWorkbook(fileName(), sheets()).finally(() => {
      button.disabled = false;
    });
  });
  return button;
}
