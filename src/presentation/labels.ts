/**
 * Las etiquetas que ve el usuario para los valores internos del análisis.
 *
 * El dominio trabaja con identificadores estables (`observed`, `bimodal-candidato`…), que son los
 * que se guardan, se exportan y se prueban. En pantalla se enseña su nombre en castellano llano. Un
 * valor sin etiqueta se enseña tal cual, antes que esconderlo.
 */

const TRUTH: Readonly<Record<string, string>> = {
  observed: "observado",
  inferred: "inferido",
  expected: "esperado",
  unknown: "sin determinar",
  confirmed: "confirmado",
};

const PATTERN: Readonly<Record<string, string>> = {
  "uniforme-alto": "se lee bien",
  "bimodal-candidato": "unos AGV sí y otros no",
  "uniforme-bajo": "todos lo leen poco",
  gradiente: "desigual entre AGV",
  "sin-soporte": "pocas pasadas",
};

const TAG_CLASS: Readonly<Record<string, string>> = {
  activo: "activo",
  "ciego-parcial": "unos AGV no lo leen",
  "obsoleto-candidato": "posible obsoleto",
  "declarado-sin-memoria": "declarado, no en memoria",
  "no-declarado-leido": "leído, no declarado",
  especial: "especial",
  "calle-sin-servicio": "calle sin servicio",
  "critico-sin-lectura": "crítico sin lecturas",
  "refuerzo-sin-lectura": "refuerzo de un crítico sin lecturas",
};

const VERDICT: Readonly<Record<string, string>> = {
  coincide: "coincide",
  "sustituido-candidato": "posible sustitución o número mal escrito",
  "no-observado": "sin lecturas",
  "fuera-del-anillo": "se lee fuera del recorrido",
  "otro-orden": "la lista lo pone en otro sitio",
  "no-declarado": "no declarado",
};

const ZONE: Readonly<Record<string, string>> = { cargado: "cargada", vacio: "vacía" };

const CRITICAL_FUNCTION: Readonly<Record<string, string>> = {
  "parada-precisa": "parada precisa",
  parada: "parada",
  giro: "giro",
  "cambio-de-mtc": "cambio de MTC",
  cruce: "cruce",
  semaforo: "semáforo",
  "dejar-carro": "dejar carro",
  "recoger-carro": "recoger carro",
  "cambio-de-mapa": "cambio de mapa",
  bifurcacion: "bifurcación",
  vinculacion: "vinculación",
  desvinculacion: "desvinculación",
  "tramo-conflictivo": "tramo conflictivo",
  "control-wifi": "control wifi",
};

const ORDER_CHANGE: Readonly<Record<string, string>> = {
  igual: "en su sitio",
  "otro-sitio": "la lista lo pone en otro sitio",
  "no-en-la-lista": "no está en la lista",
  "fuera-del-recorrido": "fuera del recorrido principal",
  "sin-lecturas": "sin lecturas: posición según la lista",
};

const ORDER_READING: Readonly<Record<string, string>> = {
  leido: "leído",
  "fuera-del-recorrido": "leído fuera del recorrido",
  "sin-lecturas": "sin lecturas",
};

/** Los regímenes del circuito (`produccion`, `noche`) tal como se dicen en pantalla. */
const REGIME_WORDS: Readonly<Record<string, string>> = { produccion: "producción", noche: "noche" };

const pick = (map: Readonly<Record<string, string>>) => (value: string): string => map[value] ?? value;

export const truthLabel = pick(TRUTH);
export const patternLabel = pick(PATTERN);
export const tagClassLabel = pick(TAG_CLASS);
export const verdictLabel = pick(VERDICT);
export const zoneLabel = pick(ZONE);
export const criticalFunctionLabel = pick(CRITICAL_FUNCTION);
export const orderChangeLabel = pick(ORDER_CHANGE);
export const orderReadingLabel = pick(ORDER_READING);
export const regimeLabel = pick(REGIME_WORDS);

// --- Bandeja de hallazgos (UX_SPEC §4.5) -----------------------------------------------------------

/**
 * El catálogo de hallazgos —temas, rangos y tipos— vive en el dominio (`src/domain/finding-kinds.ts`):
 * el Worker lo necesita para bloquear la consolidación de un periodo de incidencia. Aquí se re-exporta
 * para que la presentación siga importándolo de un solo sitio.
 */
export { findingKindOf, RANK_LABEL, THEMES } from "../domain/finding-kinds.js";
export type { FindingRank, Theme } from "../domain/finding-kinds.js";

import type { Theme } from "../domain/finding-kinds.js";

export const THEME_LABEL: Readonly<Record<Theme, string>> = {
  tags: "Tags",
  agv: "AGV",
  wifi: "WiFi",
  tiempos: "Tiempos",
  linea: "Línea y calles",
};

/**
 * «Ver los 3 tramos» o, con uno, «Ver el tramo» (F6, entrega 4): antes salía «Ver los 1 tramos».
 * `feminine` elige la/las; «Detalle de» + el se contrae en «Detalle del».
 */
export function countedLabel(prefix: "Ver" | "Detalle de", count: number, feminine: boolean, one: string, many: string): string {
  const article = count === 1 ? (feminine ? "la" : "el") : `${feminine ? "las" : "los"} ${count.toLocaleString("es-ES")}`;
  const head = prefix === "Detalle de" && article === "el" ? "Detalle del" : `${prefix} ${article}`;
  return `${head} ${count === 1 ? one : many}`;
}
