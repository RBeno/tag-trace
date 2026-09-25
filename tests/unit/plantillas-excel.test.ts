/**
 * Plantillas de Excel que se entregan al propietario (`tests/support/plantillas-excel.ts`) y su lectura
 * (`importCatalogRows`, `importFleetRows`).
 *
 * Lo que se fija: las plantillas llevan las columnas en el orden y con el nombre que el importador
 * busca, así que la primera hoja se importa tal cual; una hoja de Excel conserva los ceros y admite
 * celdas que faltan al final; y una fecha que Excel guardó como número se lee como la que se escribió.
 */

import { describe, expect, it } from "vitest";

import { EXPECTED_STRUCTURE } from "../../src/domain/tag-lists.js";
import { FLEET_STRUCTURE } from "../../src/domain/fleet.js";
import { importCatalog, importCatalogRows } from "../../src/ingestion/catalog.js";
import { excelSerialToText, importFleetRows } from "../../src/ingestion/fleet-history.js";
import { fleetTemplate, LIST_COLUMNS, listsTemplate } from "../support/plantillas-excel.js";

describe("plantillas", () => {
  it("la de listas lleva las columnas del importador, en su orden, y desplegables de lista y función", () => {
    const [sheet, help, example] = listsTemplate();
    expect(LIST_COLUMNS).toEqual(["lista", "tag", "orden", "funcion", "grupo", "capacidad", "nota"]);
    expect(sheet?.rows).toEqual([LIST_COLUMNS]);
    expect(sheet?.validations?.map((validation) => validation.column)).toEqual([0, 3]);
    expect(sheet?.validations?.[1]?.values).toContain("parada-precisa");
    expect(help?.rows.flat().join(" ")).toContain("0712 no es 712");
    expect(example?.rows[0]).toEqual(EXPECTED_STRUCTURE.example[0].split(";"));
  });

  it("la de flota lleva las columnas del importador", () => {
    expect(fleetTemplate()[0]?.rows).toEqual([[...FLEET_STRUCTURE.header]]);
  });
});

describe("una hoja de Excel se importa igual que un texto", () => {
  it("listas: mismas filas, los ceros se conservan y una celda que falta al final es una celda vacía", () => {
    const text = importCatalog("lista;tag;orden;funcion\ncircuito;0712;1;\ncritico;102185;;bifurcacion");
    const rows = importCatalogRows([["lista", "tag", "orden", "funcion"], ["circuito", "0712", "1"], [], ["critico", "102185", "", "bifurcacion"]]);
    expect(rows.lists).toEqual(text.lists);
    expect(rows.delimiter).toBeNull();
    const missingTag = importCatalogRows([["lista", "tag"], ["circuito", "1"], ["circuito"]]);
    expect(missingTag.rejected.map((row) => row.reason)).toEqual(["SIN_TAG"]);
  });

  it("flota: una fecha que Excel guardó como número se lee como la que se escribió", () => {
    // 46266,5 es el 1/9/2026 a las 12:00 en la hora de pared de la hoja.
    expect(excelSerialToText("46266.5")).toBe("01/09/2026 12:00:00");
    expect(excelSerialToText("01/09/2026")).toBe("01/09/2026");
    expect(excelSerialToText("7")).toBe("7");
    const result = importFleetRows(
      [
        ["circuito", "agv", "desde", "hasta"],
        ["SE2/4", "0712", "46266.5"],
        ["SE2/4", "7101", "01/09/2026", "15/09/2026 14:00"],
      ],
      "Europe/Madrid",
    );
    expect(result.rows.map((row) => [row.agvId, new Date(row.fromUtcMs).toISOString(), row.toUtcMs === null ? null : new Date(row.toUtcMs).toISOString()])).toEqual([
      ["0712", "2026-09-01T10:00:00.000Z", null],
      ["7101", "2026-08-31T22:00:00.000Z", "2026-09-15T12:00:00.000Z"],
    ]);
  });
});
