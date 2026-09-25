/**
 * Lectura de libros de Excel (`src/persistence/xlsx.ts`), y el escritor de las pruebas
 * (`tests/support/xlsx-writer.ts`) con el que se hacen los libros que se entregan.
 *
 * Lo que se fija: lo que se escribe se lee igual —ceros a la izquierda, tildes, punto y coma dentro de
 * una celda, `<&>` y celdas vacías en medio—; se lee siempre la primera hoja; un libro como los que
 * guarda Excel —cadenas compartidas, texto enriquecido, guías fonéticas, números, filas sin guardar—
 * se lee bien; y un fichero con declaración de tipo de documento, o que no es un zip, se rechaza.
 */

import { describe, expect, it } from "vitest";

import { looksLikeZip, readXlsxRows, XlsxError } from "../../src/persistence/xlsx.js";
import { writeZip } from "../../src/persistence/zip.js";
import { columnName, writeXlsx } from "../support/xlsx-writer.js";

describe("libro de Excel", () => {
  it("lo que se escribe se lee igual, en la primera hoja", async () => {
    const rows = [
      ["agv", "desde", "nota"],
      ["0712", "01/09/2026", "vacío; con punto y coma"],
      ["7101", "", "<&> \"comillas\""],
    ];
    const bytes = await writeXlsx([
      { name: "Flota", rows, header: true, widths: [10, 20, 30], validations: [{ column: 0, values: ["0712", "7101"] }] },
      { name: "Instrucciones", rows: [["no se importa"]], header: false, widths: [80], wrap: true },
    ]);
    expect(looksLikeZip(bytes)).toBe(true);
    expect(await readXlsxRows(bytes)).toEqual(rows);
  });

  it("lee un libro como los que guarda Excel: cadenas compartidas, texto enriquecido, números y filas sin guardar", async () => {
    const encoder = new TextEncoder();
    const file = (name: string, text: string) => ({ name, data: encoder.encode(text) });
    const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const bytes = await writeZip([
      file(
        "xl/workbook.xml",
        `<workbook xmlns="${main}" xmlns:r="r"><sheets><sheet name="Listas" sheetId="7" r:id="rId3"/><sheet name="Otra" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      file(
        "xl/_rels/workbook.xml.rels",
        `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId3" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
      ),
      file(
        "xl/sharedStrings.xml",
        `<sst xmlns="${main}"><si><t>lista</t></si><si><r><t>ta</t></r><r><rPr><b/></rPr><t>g</t></r><rPh><t>ignorar</t></rPh></si><si><t xml:space="preserve">circuito</t></si><si><t>a&amp;b_x000D_</t></si></sst>`,
      ),
      file("xl/worksheets/sheet1.xml", `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>no</t></is></c></row></sheetData></worksheet>`),
      file(
        "xl/worksheets/sheet2.xml",
        `<worksheet xmlns="${main}"><sheetData>` +
          `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
          `<row r="3" spans="1:3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>51944</v></c><c r="D3" t="s"><v>3</v></c></row>` +
          `<row r="4"><c r="A4" t="str"><f>A3</f><v>circuito</v></c><c r="B4" s="1"/></row>` +
          `</sheetData></worksheet>`,
      ),
    ]);
    expect(await readXlsxRows(bytes)).toEqual([
      ["lista", "tag"],
      [],
      ["circuito", "51944", "", "a&b\r"],
      ["circuito", ""],
    ]);
  });

  it("rechaza un libro con declaración de tipo de documento, y lo que no es un zip", async () => {
    const encoder = new TextEncoder();
    const bytes = await writeZip([
      { name: "xl/workbook.xml", data: encoder.encode(`<!DOCTYPE x [<!ENTITY a "aaaa">]><workbook/>`) },
    ]);
    await expect(readXlsxRows(bytes)).rejects.toBeInstanceOf(XlsxError);
    await expect(readXlsxRows(encoder.encode("lista;tag\ncircuito;1"))).rejects.toBeInstanceOf(XlsxError);
    expect(looksLikeZip(encoder.encode("lista;tag"))).toBe(false);
  });

  it("nombra las columnas como Excel", () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"]);
  });
});
