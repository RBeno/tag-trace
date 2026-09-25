/**
 * Libro de Excel (`.xlsx`) mínimo, sin dependencias: escribir plantillas y leer la primera hoja.
 *
 * Las listas del circuito y el historial de flota se escriben a mano, y se escriben en Excel. Un CSV
 * abierto en Excel pierde lo que más importa aquí: convierte `0712` en `712` —un AGV distinto
 * (R-DAT-001)— y las fechas en números; y al guardarlo hay que acertar con el separador y la
 * codificación. Un `.xlsx` con las columnas en formato texto conserva lo que se escribe tal cual, y
 * si el programa lo lee directamente no hay paso intermedio donde equivocarse.
 *
 * Un `.xlsx` es un zip de XML, y el zip ya es nuestro (`zip.ts`), con sus límites de
 * descompresión. Se escribe lo imprescindible —libro, hojas con texto en línea, estilos, validación
 * de listas desplegables— y se lee lo que Excel guarda para una tabla de texto: cadenas compartidas,
 * cadenas en línea y números. **No se evalúan fórmulas**: de una celda con fórmula se toma el último
 * valor que Excel guardó. Un fichero con declaración de tipo de documento se rechaza, que es la
 * puerta de las expansiones de entidades.
 */

import { readZip, writeZip, ZipError } from "./zip.js";

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

export class XlsxError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "XlsxError";
  }
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

function columnIndex(name: string): number {
  let index = 0;
  for (const char of name) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
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
  if (sheets.length === 0) throw new XlsxError("Un libro necesita al menos una hoja.");
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

/** ¿Empieza como un zip? Un `.xlsx` sí; un CSV no puede. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function decodeXml(text: string): string {
  return text
    .replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, entity: string) => {
      switch (entity) {
        case "lt":
          return "<";
        case "gt":
          return ">";
        case "amp":
          return "&";
        case "quot":
          return '"';
        case "apos":
          return "'";
        default:
          return String.fromCodePoint(entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10));
      }
    })
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match === null ? null : decodeXml(match[1] as string);
}

/** El texto de un elemento de cadena: todos sus `<t>`, sin las guías fonéticas (`<rPh>`). */
function stringText(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let text = "";
  for (const match of withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)) text += decodeXml(match[1] ?? "");
  return text;
}

/**
 * Las filas de la **primera hoja** de un libro, como texto. Las celdas vacías son cadenas vacías; una
 * fila que Excel no guardó, una fila vacía. Un número se devuelve como Excel lo guarda.
 */
export async function readXlsxRows(bytes: Uint8Array): Promise<readonly (readonly string[])[]> {
  let entries: Awaited<ReturnType<typeof readZip>>;
  try {
    entries = await readZip(bytes);
  } catch (error) {
    throw new XlsxError(error instanceof ZipError ? `No es un libro de Excel legible: ${error.reason}` : "No es un libro de Excel legible.");
  }
  const decoder = new TextDecoder("utf-8");
  const parts = new Map(entries.map((entry) => [entry.name.replace(/^\//, ""), entry.data]));
  const text = (name: string): string | null => {
    const data = parts.get(name);
    if (data === undefined) return null;
    const xml = decoder.decode(data);
    if (/<!DOCTYPE/i.test(xml)) throw new XlsxError(`«${name}» declara un tipo de documento: el libro se rechaza.`);
    return xml;
  };

  const workbook = text("xl/workbook.xml");
  if (workbook === null) throw new XlsxError("No es un libro de Excel: falta xl/workbook.xml.");
  const firstSheet = workbook.match(/<sheet\b[^>]*>/);
  if (firstSheet === null) throw new XlsxError("El libro no tiene ninguna hoja.");
  const relationId = attribute(firstSheet[0], "r:id");
  const relations = text("xl/_rels/workbook.xml.rels") ?? "";
  let target: string | null = null;
  for (const match of relations.matchAll(/<Relationship\b[^>]*>/g)) {
    if (attribute(match[0], "Id") === relationId) target = attribute(match[0], "Target");
  }
  if (target === null) throw new XlsxError("No se encuentra la primera hoja del libro.");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = text(sheetPath);
  if (sheet === null) throw new XlsxError(`Falta la hoja «${sheetPath}».`);

  const shared: string[] = [];
  const sharedXml = text("xl/sharedStrings.xml");
  if (sharedXml !== null) {
    for (const match of sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)) shared.push(stringText(match[1] ?? ""));
  }

  const rows: string[][] = [];
  let nextRow = 0;
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const declared = attribute(rowMatch[1] ?? "", "r");
    const rowIndex = declared === null ? nextRow : Number.parseInt(declared, 10) - 1;
    nextRow = rowIndex + 1;
    const cells: string[] = [];
    let nextColumn = 0;
    for (const cellMatch of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";
      const reference = attribute(attributes, "r");
      const column = reference === null ? nextColumn : columnIndex(reference.replace(/\d+$/, ""));
      nextColumn = column + 1;
      const type = attribute(attributes, "t");
      const value = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      let cell: string;
      if (type === "inlineStr") cell = stringText(inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (type === "s") cell = shared[Number.parseInt(value ?? "", 10)] ?? "";
      else cell = value === undefined ? "" : decodeXml(value);
      while (cells.length < column) cells.push("");
      cells[column] = cell;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}
