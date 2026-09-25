/**
 * Escritor mínimo de libros de Excel (`.xlsx`), sin dependencias, para las pruebas y para generar los
 * libros que se entregan al propietario (`scripts/generar-plantillas-excel.ts`).
 *
 * **La aplicación no escribe libros**: solo los lee (`src/persistence/xlsx.ts`). Las plantillas y los
 * circuitos en Excel se entregan como ficheros; esto está aquí para que las pruebas comprueben que lo
 * que se entrega se importa tal cual.
 *
 * Se escribe lo imprescindible: libro, hojas con texto en línea, estilos y listas desplegables. Las
 * columnas quedan en formato texto, así que `0712` sigue siendo `0712` al escribir en Excel.
 */

import { writeZip } from "../../src/persistence/zip.js";

export interface XlsxValidation {
  /** Columna, desde 0. */
  readonly column: number;
  readonly values: readonly string[];
}

export interface XlsxSheet {
  /** Nombre de la pestaña: hasta 31 caracteres, sin `[]:*?/\`. */
  readonly name: string;
  /** Todas las celdas como texto; una cadena vacía es una celda vacía. */
  readonly rows: readonly (readonly string[])[];
  /** La primera fila es cabecera: en negrita y fija al desplazarse. */
  readonly header: boolean;
  /** Ancho de cada columna, en caracteres. Esas columnas quedan en formato texto para lo que se escriba. */
  readonly widths: readonly number[];
  /** Listas desplegables por columna, desde la segunda fila. Avisan, no prohíben: la lista admite otros valores. */
  readonly validations?: readonly XlsxValidation[];
  /** Ajustar el texto largo a la celda (para instrucciones). */
  readonly wrap?: boolean;
}

/** Filas en las que se aplica el formato de texto y las listas desplegables. */
const FILL_ROWS = 5000;

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Caracteres de control que XML 1.0 no admite: Excel los escribe como `_xHHHH_`.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (char) => `_x${char.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}_`);
}

/** A, B, …, Z, AA, AB… */
export function columnName(index: number): string {
  let name = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
  }
  return name;
}

/** Estilos: 0 normal, 1 texto, 2 texto en negrita, 3 texto ajustado. */
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="${MAIN_NS}">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
  `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

function sheetXml(sheet: XlsxSheet): string {
  const body = sheet.wrap === true ? 3 : 1;
  const views = sheet.header
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const cols = `<cols>${sheet.widths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" style="${body}" customWidth="1"/>`)
    .join("")}</cols>`;
  const rows = sheet.rows
    .map((row, rowIndex) => {
      const style = sheet.header && rowIndex === 0 ? 2 : body;
      const cells = row
        .map((value, columnIndexValue) =>
          value === ""
            ? ""
            : `<c r="${columnName(columnIndexValue)}${rowIndex + 1}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`,
        )
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const validations = sheet.validations ?? [];
  const validationXml =
    validations.length === 0
      ? ""
      : `<dataValidations count="${validations.length}">${validations
          .map((validation) => {
            const column = columnName(validation.column);
            const list = escapeXml(`"${validation.values.join(",")}"`);
            return (
              `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" ` +
              `errorTitle="Valor fuera de la lista" error="No es uno de los valores conocidos. Se puede dejar: el programa lo conserva y avisa." ` +
              `sqref="${column}2:${column}${FILL_ROWS}"><formula1>${list}</formula1></dataValidation>`
            );
          })
          .join("")}</dataValidations>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">${views}${cols}<sheetData>${rows}</sheetData>${validationXml}` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  );
}

/** Un libro con las hojas dadas, en ese orden. La primera es la que se importa. */
export async function writeXlsx(sheets: readonly XlsxSheet[]): Promise<Uint8Array> {
  if (sheets.length === 0) throw new Error("Un libro necesita al menos una hoja.");
  const encoder = new TextEncoder();
  const file = (name: string, text: string) => ({ name, data: encoder.encode(text) });
  const sheetEntries = sheets.map((sheet, index) => file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet)));
  return writeZip([
    file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map(
            (_, index) =>
              `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join("") +
        `</Types>`,
    ),
    file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${PKG_REL_NS}"><Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>` +
        sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("") +
        `</sheets></workbook>`,
    ),
    file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="${PKG_REL_NS}">` +
        sheets
          .map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
          .join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    ),
    file("xl/styles.xml", STYLES),
    ...sheetEntries,
  ]);
}
