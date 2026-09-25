/**
 * Importador de **listas de tags** (DS-002, DS-005, DS-006, DS-008).
 *
 * No son lecturas y no se parecen: una lectura es un hecho con instante y procedencia; una lista es
 * una declaración de planta. Comparten el lector de CSV y nada más, así que tienen su propio camino.
 *
 * **La estructura la fija este programa, y por eso se declara.** No hay forma de descargar estas
 * listas del sistema de planta: se escriben a mano. Cuando el formato lo decide quien escribe el
 * fichero, pedirle que adivine el que esperamos es el modo más seguro de que no coincida — así que
 * `EXPECTED_STRUCTURE` se enseña en la interfaz **antes** de cargar nada, y el mensaje de error
 * vuelve a enseñarla si algo no encaja.
 *
 * Una lista desconocida **no se rechaza**. El propietario ya anticipó ampliaciones, y un fichero
 * que trae una categoría que todavía no existe aquí es información, no un defecto: se conserva con
 * su nombre y se avisa. Rechazarla obligaría a tocar el código para poder anotar algo nuevo.
 */

import { EXPECTED_STRUCTURE, KNOWN_LISTS } from "../domain/tag-lists.js";
import { detectDelimiter, type Delimiter } from "./delimiter.js";

export { EXPECTED_STRUCTURE, KNOWN_LISTS } from "../domain/tag-lists.js";
export type { KnownList } from "../domain/tag-lists.js";

export interface CatalogEntry {
  readonly list: string;
  readonly tagId: string;
  /** Orden declarado dentro de la lista, si el fichero lo trae. El circuito virtual sí lo usa. */
  readonly order: number | null;
  /**
   * Qué papel cumple el tag dentro de su lista: `parada-precisa` y `salida` en una calle de carga,
   * `cruce` o `bifurcacion` en la lista de críticos (`LIST_FUNCTIONS`).
   *
   * Se conserva **tal cual viene**, normalizado solo en forma. Un valor que no esté en la taxonomía
   * no invalida la fila: el tag sigue perteneciendo a su lista, y es el consumidor quien decide que
   * con eso no puede montar la calle y lo dice.
   */
  readonly funcion: string;
  /** A qué agrupación pertenece: la calle en `carga-online`, la zona en `zona`. */
  readonly grupo: string;
  /** Capacidad declarada de la agrupación, cuando la tiene (R-CO-001). */
  readonly capacidad: number | null;
  readonly note: string;
  /** Fila física del fichero, contando la cabecera como fila 1. */
  readonly sourceRow: number;
}

export type CatalogRejection = "SIN_LISTA" | "SIN_TAG" | "CAMPOS_INSUFICIENTES";

export interface CatalogRejectedRow {
  readonly sourceRow: number;
  readonly reason: CatalogRejection;
  readonly excerpt: string;
}

export interface CatalogImport {
  /** El separador del texto; `null` si vino de una hoja de Excel, que no tiene. */
  readonly delimiter: Delimiter | null;
  /** Cada lista con sus tags, en el orden en que el fichero los trae. */
  readonly lists: ReadonlyMap<string, readonly CatalogEntry[]>;
  readonly accepted: number;
  readonly rejected: readonly CatalogRejectedRow[];
  readonly warnings: readonly string[];
  /** Listas del fichero que este producto todavía no sabe usar. Se conservan, no se tiran. */
  readonly unknownLists: readonly string[];
}

export class CatalogFailure extends Error {
  constructor(
    readonly reason: string,
    readonly recovery: string,
  ) {
    super(reason);
    this.name = "CatalogFailure";
  }
}

/**
 * Baja un valor escrito a mano a su forma canónica: sin acentos, en minúsculas y con guiones.
 *
 * Quien escribe el fichero escribirá `Parada Precisa`, `parada_precisa` o `PARADA-PRECISA` según el
 * día, y ninguna de las tres es un error que merezca perder la fila. Se normaliza la **forma**, que
 * es ortografía; nunca el **contenido**, que sería adivinar.
 */
function normaliseToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[_\s]+/g, "-");
}

/**
 * Normaliza el nombre de una lista.
 *
 * Sobre la normalización de forma, admite además el plural —`Críticos` es `critico`— porque es la
 * variación que más aparece escribiendo en español. Lo que **no** se hace es adivinar: un nombre
 * que no se reconoce se conserva tal cual.
 */
export function normaliseListName(raw: string): string {
  const base = normaliseToken(raw);
  const singular = base.endsWith("s") ? base.slice(0, -1) : base;
  return (KNOWN_LISTS as readonly string[]).includes(singular) ? singular : base;
}

function tooShort(): CatalogFailure {
  return new CatalogFailure(
    "El fichero no tiene cabecera y al menos una fila.",
    `Se espera «${EXPECTED_STRUCTURE.header.join(";")}» en la primera fila y una fila por tag.`,
  );
}

/** Lee un fichero de listas ya decodificado a texto. */
export function importCatalog(text: string): CatalogImport {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw tooShort();
  const delimiter = detectDelimiter(lines.slice(0, 50)).delimiter;
  return importCatalogTable(
    lines.map((line) => line.split(delimiter)),
    delimiter,
  );
}

/**
 * Lee las filas de la primera hoja de un libro de Excel. Misma forma y mismas reglas que el texto: la
 * cabecera se busca por nombre y cada celda se toma tal cual —en formato texto, `0712` sigue siendo
 * `0712`—. Una celda que falta al final de la fila es una celda vacía, no un campo de menos.
 */
export function importCatalogRows(rows: readonly (readonly string[])[]): CatalogImport {
  const filled = rows.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (filled.length < 2) throw tooShort();
  const width = (filled[0] ?? []).length;
  return importCatalogTable(
    filled.map((row) => Array.from({ length: Math.max(width, row.length) }, (_, index) => row[index] ?? "")),
    null,
  );
}

function importCatalogTable(table: readonly (readonly string[])[], delimiter: Delimiter | null): CatalogImport {
  const separator = delimiter ?? ";";
  const header = (table[0] ?? []).map((field) => field.trim().toLowerCase());

  const listColumn = header.indexOf("lista");
  const tagColumn = header.indexOf("tag");
  if (listColumn === -1 || tagColumn === -1) {
    throw new CatalogFailure(
      `La cabecera es «${header.join(separator)}» y faltan las columnas obligatorias.`,
      `Se esperan «lista» y «tag»; «${EXPECTED_STRUCTURE.optional.join("» y «")}» son opcionales.`,
    );
  }
  const orderColumn = header.indexOf("orden");
  const noteColumn = header.indexOf("nota");
  const funcionColumn = header.indexOf("funcion");
  const grupoColumn = header.indexOf("grupo");
  const capacidadColumn = header.indexOf("capacidad");

  /** Una celda opcional: ausente la columna, o ausente el campo en esta fila, es cadena vacía. */
  const cell = (fields: readonly string[], column: number): string =>
    column === -1 ? "" : (fields[column] ?? "").trim();
  /** Un entero opcional. Vacío o ilegible es `null`, nunca un cero que parecería un dato. */
  const integer = (raw: string): number | null => {
    if (raw === "") return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const lists = new Map<string, CatalogEntry[]>();
  const rejected: CatalogRejectedRow[] = [];
  const unknown = new Set<string>();
  let accepted = 0;

  for (let index = 1; index < table.length; index += 1) {
    const fields = table[index] ?? [];
    const line = fields.join(separator);
    const sourceRow = index + 1;
    if (fields.length <= Math.max(listColumn, tagColumn)) {
      rejected.push({ sourceRow, reason: "CAMPOS_INSUFICIENTES", excerpt: excerpt(line) });
      continue;
    }

    const rawList = (fields[listColumn] ?? "").trim();
    // El identificador se conserva **tal cual**: `0040` no es 40 (R-DAT-001, INV-002).
    const tagId = (fields[tagColumn] ?? "").trim();
    if (rawList === "") {
      rejected.push({ sourceRow, reason: "SIN_LISTA", excerpt: excerpt(line) });
      continue;
    }
    if (tagId === "") {
      rejected.push({ sourceRow, reason: "SIN_TAG", excerpt: excerpt(line) });
      continue;
    }

    const list = normaliseListName(rawList);
    if (!(KNOWN_LISTS as readonly string[]).includes(list)) unknown.add(list);

    let entries = lists.get(list);
    if (entries === undefined) {
      entries = [];
      lists.set(list, entries);
    }
    entries.push({
      list,
      tagId,
      order: integer(cell(fields, orderColumn)),
      // Misma normalización de forma que el nombre de lista: quien escribe a mano escribirá
      // «Parada Precisa» y no es un error que merezca perder la fila.
      funcion: normaliseToken(cell(fields, funcionColumn)),
      grupo: normaliseToken(cell(fields, grupoColumn)),
      capacidad: integer(cell(fields, capacidadColumn)),
      note: cell(fields, noteColumn),
      sourceRow,
    });
    accepted += 1;
  }

  const warnings: string[] = [];
  if (unknown.size > 0) {
    warnings.push(
      `Listas que este producto todavía no sabe usar: ${[...unknown].join(", ")}. Se conservan con ` +
        "su nombre y no se pierden, pero no entran en el inventario contrastado.",
    );
  }
  for (const [list, entries] of lists) {
    const seen = new Set<string>();
    const repeated = entries.filter((entry) => !seen.add(entry.tagId)).length;
    if (repeated > 0) {
      warnings.push(`La lista «${list}» repite ${repeated} tag(s); se conservan tal cual.`);
    }
  }
  if (accepted === 0) {
    throw new CatalogFailure(
      "Ninguna fila tenía lista y tag.",
      `Comprueba la cabecera y el separador. Se espera «${EXPECTED_STRUCTURE.header.join(";")}».`,
    );
  }

  return { delimiter, lists, accepted, rejected, warnings, unknownLists: [...unknown] };
}

/** Recorte seguro para mensajes: nunca se vuelca una fila entera (TH-003). */
function excerpt(line: string): string {
  return line.length <= 80 ? line : `${line.slice(0, 80)}…`;
}

/** Los tags de una lista, sin orden ni repetidos, que es lo que el inventario consume. */
export function tagSet(result: CatalogImport, list: string): ReadonlySet<string> {
  return new Set((result.lists.get(list) ?? []).map((entry) => entry.tagId));
}
