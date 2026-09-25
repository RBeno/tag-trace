/**
 * Lectura de libros de Excel (`.xlsx`) mínima, sin dependencias: la primera hoja, como texto.
 *
 * Las listas del circuito y el historial de flota se escriben a mano, y se escriben en Excel. Un CSV
 * abierto en Excel pierde lo que más importa aquí: convierte `0712` en `712` —un AGV distinto
 * (R-DAT-001)— y las fechas en números; y al guardarlo hay que acertar con el separador y la
 * codificación. Si el programa lee el `.xlsx` directamente no hay paso intermedio donde equivocarse.
 * La aplicación no escribe libros: las plantillas se entregan como ficheros.
 *
 * Un `.xlsx` es un zip de XML, y el zip ya es nuestro (`zip.ts`), con sus límites de
 * descompresión. Se lee lo que Excel guarda para una tabla de texto: cadenas compartidas, cadenas en
 * línea y números. **No se evalúan fórmulas**: de una celda con fórmula se toma el último valor que
 * Excel guardó. Un fichero con declaración de tipo de documento se rechaza, que es la puerta de las
 * expansiones de entidades.
 */

import { readZip, ZipError } from "./zip.js";

export class XlsxError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "XlsxError";
  }
}

function columnIndex(name: string): number {
  let index = 0;
  for (const char of name) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
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
