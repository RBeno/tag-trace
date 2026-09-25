/**
 * Libros para rellenar e importar (`domain/list-templates.ts`) y su lectura (`importCatalogRows`,
 * `importFleetRows`).
 *
 * Lo que se fija: las plantillas llevan las columnas en el orden y con el nombre que el importador
 * busca, y la primera hoja se importa tal cual; el borrador del circuito va en el orden de Vsystem
 * con cada diferencia en su fila, lo que falta del recorrido va en su sitio y sin orden, y se importa
 * tal cual como lista `circuito`; sin Vsystem, es el recorrido desde su ancla; los candidatos a punto
 * crítico van en la nota y nunca en `funcion`; una hoja de Excel conserva los ceros y admite celdas
 * que faltan al final; y una fecha que Excel guardó como número se lee como la que se escribió.
 */

import { describe, expect, it } from "vitest";

import { compareAgainstVsystem } from "../../src/domain/vsystem.js";
import { circuitDraft, DRAFT_COLUMNS, fleetTemplate, LIST_COLUMNS, listsTemplate, type CircuitDraftInput } from "../../src/domain/list-templates.js";
import { EXPECTED_STRUCTURE } from "../../src/domain/tag-lists.js";
import { FLEET_STRUCTURE } from "../../src/domain/fleet.js";
import { importCatalog, importCatalogRows } from "../../src/ingestion/catalog.js";
import { excelSerialToText, importFleetRows } from "../../src/ingestion/fleet-history.js";

function draftInput(overrides: Partial<CircuitDraftInput> = {}): CircuitDraftInput {
  return {
    ring: ["T2", "T3", "X4", "T5", "T6", "T1"],
    anchorTagId: "T2",
    anchorTruth: "inferred",
    offRing: [{ tagId: "M1", readers: 2 }],
    contrast: null,
    readingsOf: new Map([
      ["T2", 40],
      ["X4", 38],
      ["M1", 3],
    ]),
    functionOf: new Map([["T5", "cruce"]]),
    candidateOf: new Map([["T3", "posible semáforo"]]),
    ...overrides,
  };
}

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

describe("el borrador del circuito", () => {
  it("sin Vsystem, es el recorrido desde su ancla, con el ancla y los candidatos en la nota", () => {
    const [sheet, offRing] = circuitDraft(draftInput());
    expect(sheet?.rows[0]).toEqual(DRAFT_COLUMNS);
    expect(sheet?.rows.slice(1).map((row) => [row[1], row[2], row[3], row[6], row[7]])).toEqual([
      ["T2", "1", "", "ancla de vuelta (inferida)", ""],
      ["T3", "2", "", "posible semáforo", ""],
      ["X4", "3", "", "", ""],
      ["T5", "4", "cruce", "", ""],
      ["T6", "5", "", "", ""],
      ["T1", "6", "", "", ""],
    ]);
    expect(offRing?.rows).toEqual([["tag", "AGV que lo leen", "lecturas", "en Vsystem"], ["M1", "2", "3", "—"]]);
  });

  it("con Vsystem, va en su orden con cada diferencia en su fila, y lo que falta del recorrido en su sitio y sin orden", () => {
    const declared = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"];
    const contrast = compareAgainstVsystem(declared, ["T2", "T3", "X4", "T5", "T6", "T1"], new Set(["T1", "T2", "T3", "X4", "T5", "T6", "M1"]));
    const [sheet] = circuitDraft(draftInput({ contrast }));
    const rows = (sheet?.rows ?? []).slice(1);
    expect(rows.map((row) => [row[1], row[2], row[7]])).toEqual([
      ["T1", "1", "coincide"],
      ["T2", "2", "coincide"],
      ["T3", "3", "coincide"],
      ["X4", "4", "no está en Vsystem; en su sitio Vsystem tiene T4, que no se lee"],
      ["T4", "", "en Vsystem y sin lecturas; en su sitio se lee X4"],
      ["T5", "5", "coincide"],
      ["T6", "6", "coincide"],
      ["T7", "", "en Vsystem y sin lecturas"],
    ]);
    expect(rows.map((row) => row[9])).toEqual([
      "recorrido observado",
      "recorrido observado",
      "recorrido observado",
      "recorrido observado",
      "Vsystem",
      "recorrido observado",
      "recorrido observado",
      "Vsystem",
    ]);
    // Los candidatos van en la nota, nunca en «funcion» (R-GRA-007).
    expect(rows.find((row) => row[1] === "T3")?.[3]).toBe("");
  });

  it("se importa tal cual como lista «circuito»: las columnas de más no se leen", () => {
    const declared = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"];
    const contrast = compareAgainstVsystem(declared, ["T2", "T3", "X4", "T5", "T6", "T1"], new Set(["T1", "T2", "T3", "X4", "T5", "T6"]));
    const [sheet] = circuitDraft(draftInput({ contrast }));
    const result = importCatalogRows(sheet?.rows ?? []);
    expect(result.rejected).toEqual([]);
    expect(result.lists.get("circuito")?.map((entry) => entry.tagId)).toEqual(["T1", "T2", "T3", "X4", "T4", "T5", "T6", "T7"]);
    expect(result.lists.get("circuito")?.find((entry) => entry.tagId === "T5")?.funcion).toBe("cruce");
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
