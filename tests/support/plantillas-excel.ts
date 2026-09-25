/**
 * Las plantillas de Excel que se entregan al propietario: las listas del circuito y el historial de
 * flota, para rellenar e importar. **No las genera la aplicación**: se entregan como ficheros, hechos
 * con `scripts/generar-plantillas-excel.ts`.
 *
 * Las columnas van en el mismo orden y con los mismos nombres que el importador busca
 * (`EXPECTED_STRUCTURE`, `FLEET_STRUCTURE`), así que la primera hoja se importa tal cual; las pruebas lo
 * comprueban. Las demás hojas —instrucciones y ejemplo— no se importan nunca.
 */

import { FLEET_STRUCTURE } from "../../src/domain/fleet.js";
import { EXPECTED_STRUCTURE, KNOWN_LISTS, LIST_FUNCTIONS, LIST_PURPOSE } from "../../src/domain/tag-lists.js";

import type { XlsxSheet } from "./xlsx-writer.js";

/** Las columnas de una lista, en el orden en que se importan. */
export const LIST_COLUMNS: readonly string[] = [...EXPECTED_STRUCTURE.header, ...EXPECTED_STRUCTURE.optional];
export const LIST_WIDTHS = [16, 12, 8, 18, 14, 11, 44];
const FUNCTIONS = [...new Set([...LIST_FUNCTIONS["carga-online"], ...LIST_FUNCTIONS.critico])];
export const LIST_VALIDATIONS = [
  { column: 0, values: [...KNOWN_LISTS] },
  { column: 3, values: FUNCTIONS },
];

export function instructions(lines: readonly string[]): XlsxSheet {
  return { name: "Instrucciones", rows: lines.map((line) => [line]), header: false, widths: [120], wrap: true };
}

function example(name: string, lines: readonly string[]): XlsxSheet {
  const rows = lines.map((line) => line.split(";"));
  const width = Math.max(...rows.map((row) => row.length));
  return {
    name,
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
    header: true,
    widths: Array.from({ length: width }, () => 16),
  };
}

export const COMMON_LINES = [
  "Todas las columnas están en formato texto: escribe los tags y los AGV tal cual, con sus ceros a la izquierda (0712 no es 712).",
  "No cambies el nombre ni el orden de las columnas de la primera fila: el programa las busca por su nombre.",
  "Se importa el libro tal cual (.xlsx), sin convertirlo; también vale guardarlo como CSV separado por punto y coma.",
];

/** Plantilla de las listas del circuito (DS-002, DS-004, DS-005, DS-006, DS-008). */
export function listsTemplate(): readonly XlsxSheet[] {
  return [
    { name: "Listas", rows: [LIST_COLUMNS], header: true, widths: LIST_WIDTHS, validations: LIST_VALIDATIONS },
    instructions([
      "Rellena la hoja «Listas»: una fila por tag. Es la única que se importa.",
      ...COMMON_LINES,
      "Se carga en «Listas del circuito» → «Listas de tags». Cada lista que traiga el fichero sustituye entera a la que hubiera con ese nombre; las que no traiga se quedan como estaban.",
      "",
      "Columnas:",
      "lista — obligatoria: a qué lista pertenece la fila (desplegable). Una lista con otro nombre se conserva y se avisa.",
      "tag — obligatoria: el número del tag, tal cual.",
      "orden — opcional: posición dentro de la lista. En «circuito» es el orden del recorrido; en «carga-online», el de la calle; en «ancla», la prioridad.",
      "funcion — opcional: el papel del tag (desplegable). En «carga-online»: entrada, parada-precisa o salida. En «critico» (o en la misma fila de «circuito»): la clase del punto crítico.",
      "grupo — opcional: la calle en «carga-online» (calle-1, calle-2…) y la zona en «zona» (cargado o vacio).",
      "capacidad — opcional: cuántos AGV caben en la calle.",
      "nota — opcional: texto libre; se guarda y no se interpreta.",
      "",
      "Listas:",
      ...KNOWN_LISTS.map((list) => `${list} — ${LIST_PURPOSE[list]}.`),
      "",
      `Valores de «funcion» en carga-online: ${LIST_FUNCTIONS["carga-online"].join(", ")}.`,
      `Valores de «funcion» en critico: ${LIST_FUNCTIONS.critico.join(", ")}.`,
      `Valores de «grupo» en zona: ${LIST_FUNCTIONS.zona.join(", ")}.`,
      "",
      "La hoja «Ejemplo» enseña cómo queda; no se importa.",
    ]),
    example("Ejemplo", EXPECTED_STRUCTURE.example),
  ];
}

/** Plantilla del historial de flota (DS-012). */
export function fleetTemplate(): readonly XlsxSheet[] {
  return [
    { name: "Flota", rows: [[...FLEET_STRUCTURE.header]], header: true, widths: [14, 10, 20, 20, 44] },
    instructions([
      "Rellena la hoja «Flota»: una fila por AGV y periodo. Es la única que se importa.",
      ...COMMON_LINES,
      "Se carga en «Listas del circuito» → «Historial de flota».",
      "",
      "Columnas:",
      "circuito — opcional: a qué circuito pertenece la fila. Si el fichero trae varios, el programa pregunta cuál es este.",
      "agv — obligatoria: el número del AGV, tal cual.",
      "desde — obligatoria: cuándo se asignó, día/mes/año con hora opcional: 01/09/2026 o 01/09/2026 14:30.",
      "hasta — opcional: cuándo se dio de baja; vacío es que sigue asignado.",
      "nota — opcional: texto libre.",
      "",
      "Cada carga se suma a lo que ya había: basta subir las filas que cambian. Para cerrar un periodo, vuelve a subir su fila con «hasta».",
      "La hoja «Ejemplo» enseña cómo queda; no se importa.",
    ]),
    example("Ejemplo", FLEET_STRUCTURE.example),
  ];
}
