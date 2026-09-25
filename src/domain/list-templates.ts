/**
 * Libros de Excel para rellenar e importar: las plantillas de las listas y del historial de flota, y
 * el **borrador del circuito** sacado de un análisis, con sus diferencias con Vsystem.
 *
 * Las columnas van en el mismo orden y con los mismos nombres que el importador busca
 * (`EXPECTED_STRUCTURE`, `FLEET_STRUCTURE`), así que la primera hoja se importa tal cual. Las demás
 * hojas —instrucciones, ejemplo, lo que queda fuera del anillo— no se importan nunca.
 *
 * El borrador ahorra la parte mecánica de escribir la lista `circuito`: el recorrido observado, en su
 * orden, con cada diferencia con Vsystem dicha en su fila. **Sigue siendo un borrador**: la lista
 * `circuito` es lo que Vsystem declara, no lo que se observa (R-GRA-001), así que se corrige contra
 * Vsystem antes de importarla; y la función de un punto crítico es dato de planta (R-GRA-007): un
 * «posible semáforo» va en la nota, nunca en `funcion`.
 */

import { FLEET_STRUCTURE } from "./fleet.js";
import { EXPECTED_STRUCTURE, KNOWN_LISTS, LIST_FUNCTIONS, LIST_PURPOSE } from "./tag-lists.js";
import type { VsystemComparisonRow } from "./vsystem.js";

/** Una hoja de un libro: la forma que el escritor de `.xlsx` recibe. */
export interface TableSheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
  readonly header: boolean;
  readonly widths: readonly number[];
  readonly validations?: readonly { readonly column: number; readonly values: readonly string[] }[];
  readonly wrap?: boolean;
}

/** Las columnas de una lista, en el orden en que se importan. */
export const LIST_COLUMNS: readonly string[] = [...EXPECTED_STRUCTURE.header, ...EXPECTED_STRUCTURE.optional];
const LIST_WIDTHS = [16, 12, 8, 18, 14, 11, 44];
const FUNCTIONS = [...new Set([...LIST_FUNCTIONS["carga-online"], ...LIST_FUNCTIONS.critico])];
const LIST_VALIDATIONS = [
  { column: 0, values: [...KNOWN_LISTS] },
  { column: 3, values: FUNCTIONS },
];

function instructions(lines: readonly string[]): TableSheet {
  return { name: "Instrucciones", rows: lines.map((line) => [line]), header: false, widths: [120], wrap: true };
}

function example(name: string, lines: readonly string[]): TableSheet {
  const rows = lines.map((line) => line.split(";"));
  const width = Math.max(...rows.map((row) => row.length));
  return {
    name,
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
    header: true,
    widths: Array.from({ length: width }, () => 16),
  };
}

const COMMON_LINES = [
  "Todas las columnas están en formato texto: escribe los tags y los AGV tal cual, con sus ceros a la izquierda (0712 no es 712).",
  "No cambies el nombre ni el orden de las columnas de la primera fila: el programa las busca por su nombre.",
  "Se importa el libro tal cual (.xlsx), sin convertirlo; también vale guardarlo como CSV.",
];

/** Plantilla de las listas del circuito (DS-002, DS-004, DS-005, DS-006, DS-008). */
export function listsTemplate(): readonly TableSheet[] {
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
export function fleetTemplate(): readonly TableSheet[] {
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

export interface CircuitDraftInput {
  /** El anillo observado del cohorte, en su orden, desde su ancla. */
  readonly ring: readonly string[];
  readonly anchorTagId: string;
  readonly anchorTruth: "observed" | "inferred";
  readonly offRing: readonly { readonly tagId: string; readonly readers: number }[];
  /** El contraste con la lista `circuito` cargada; `null` sin lista, o para otro cohorte. */
  readonly contrast: readonly VsystemComparisonRow[] | null;
  readonly readingsOf: ReadonlyMap<string, number>;
  /** Función ya declarada de cada tag crítico. */
  readonly functionOf: ReadonlyMap<string, string>;
  /** Candidato a punto crítico de cada tag, como se enseña («posible semáforo»). */
  readonly candidateOf: ReadonlyMap<string, string>;
}

/** Las columnas del borrador: las de una lista y tres que el importador no lee. */
export const DRAFT_COLUMNS: readonly string[] = [...LIST_COLUMNS, "vsystem", "lecturas", "origen"];

interface DraftEntry {
  readonly tagId: string;
  readonly observed: boolean;
  readonly vsystem: string;
}

/** El recorrido, en el orden de Vsystem si hay contraste, con cada diferencia en su sitio. */
function draftEntries(input: CircuitDraftInput): readonly DraftEntry[] {
  if (input.contrast === null) return input.ring.map((tagId) => ({ tagId, observed: true, vsystem: "" }));
  const inRing = new Set(input.ring);
  const entries: DraftEntry[] = [];
  for (const row of input.contrast) {
    const { declaredTag: declared, observedTag: observed } = row;
    switch (row.verdict) {
      case "coincide":
        entries.push({ tagId: observed as string, observed: true, vsystem: "coincide" });
        break;
      case "sustituido-candidato":
        entries.push({ tagId: observed as string, observed: true, vsystem: `no está en Vsystem; en su sitio Vsystem tiene ${declared}, que no se lee` });
        entries.push({ tagId: declared as string, observed: false, vsystem: `en Vsystem y sin lecturas; en su sitio se lee ${observed}` });
        break;
      case "no-observado":
        entries.push({ tagId: declared as string, observed: false, vsystem: "en Vsystem y sin lecturas" });
        break;
      case "no-declarado":
        if (observed !== null) {
          entries.push({
            tagId: observed,
            observed: true,
            vsystem: declared === null ? "no está en Vsystem" : `no está en Vsystem; aquí Vsystem tiene ${declared}, que se lee en otro sitio`,
          });
        }
        if (declared !== null && !inRing.has(declared)) {
          entries.push({ tagId: declared, observed: false, vsystem: "en Vsystem; se lee fuera del recorrido dominante" });
        }
        break;
    }
  }
  return entries;
}

/**
 * El borrador de la lista `circuito` de un cohorte: el recorrido observado en su orden —el de Vsystem
 * si hay lista con la que contrastarlo—, con lo que difiere de Vsystem en su fila. Las filas de
 * Vsystem que no están en el recorrido van en su sitio y sin `orden`. Se importa tal cual.
 */
export function circuitDraft(input: CircuitDraftInput): readonly TableSheet[] {
  const entries = draftEntries(input);
  const declared = new Set((input.contrast ?? []).flatMap((row) => (row.declaredTag === null ? [] : [row.declaredTag])));
  let position = 0;
  const rows = entries.map((entry) => {
    const notes = [
      entry.tagId === input.anchorTagId ? `ancla de vuelta (${input.anchorTruth === "observed" ? "declarada" : "inferida"})` : "",
      input.candidateOf.get(entry.tagId) ?? "",
    ].filter((note) => note !== "");
    return [
      "circuito",
      entry.tagId,
      entry.observed ? String((position += 1)) : "",
      input.functionOf.get(entry.tagId) ?? "",
      "",
      "",
      notes.join("; "),
      entry.vsystem,
      String(input.readingsOf.get(entry.tagId) ?? 0),
      entry.observed ? "recorrido observado" : "Vsystem",
    ];
  });
  const offRing = input.offRing.map((entry) => [
    entry.tagId,
    String(entry.readers),
    String(input.readingsOf.get(entry.tagId) ?? 0),
    input.contrast === null ? "—" : declared.has(entry.tagId) ? "sí" : "no",
  ]);
  return [
    { name: "Listas", rows: [DRAFT_COLUMNS, ...rows], header: true, widths: [...LIST_WIDTHS, 40, 10, 20], validations: LIST_VALIDATIONS },
    { name: "Fuera del anillo", rows: [["tag", "AGV que lo leen", "lecturas", "en Vsystem"], ...offRing], header: true, widths: [12, 16, 10, 12] },
    instructions([
      "Borrador de la lista «circuito» sacado del recorrido observado en este análisis. El orden es el del recorrido (inferido), no una medida del trazado.",
      input.contrast === null
        ? "No había lista «circuito» de Vsystem con la que compararlo: la columna «vsystem» va vacía."
        : "Va en el orden de la lista de Vsystem cargada, y la columna «vsystem» dice en cada fila dónde difiere: «coincide» no pide nada.",
      "Las filas sin «orden» están en Vsystem y no en el recorrido observado: déjalas en su sitio si siguen en Vsystem, o bórralas.",
      "Corrígelo contra Vsystem antes de importarlo como lista «circuito»: esa lista es lo que Vsystem declara, no lo que se observa.",
      "En «nota» van el ancla de vuelta y los posibles puntos críticos. La función de un punto crítico es dato de planta: si lo es, escríbela en «funcion».",
      "Las columnas «vsystem», «lecturas» y «origen» no se importan; «nota» se guarda tal cual.",
      "En la misma hoja «Listas» puedes añadir otras listas (zona, critico, ancla, carga-online…) con su nombre en «lista».",
      "La hoja «Fuera del anillo» no se importa: tags leídos que el recorrido dominante no incluye (ramas, mantenimiento, tags que se leen poco).",
      ...COMMON_LINES,
    ]),
  ];
}
