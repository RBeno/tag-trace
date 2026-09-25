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
};

const VERDICT: Readonly<Record<string, string>> = {
  coincide: "coincide",
  "sustituido-candidato": "posible sustitución",
  "no-observado": "sin lecturas",
  "fuera-del-anillo": "se lee fuera del recorrido",
  "no-declarado": "no declarado",
};

const ZONE: Readonly<Record<string, string>> = { cargado: "cargada", vacio: "vacía" };

const CRITICAL_FUNCTION: Readonly<Record<string, string>> = {
  "parada-precisa": "parada precisa",
  cruce: "cruce",
  semaforo: "semáforo",
  "dejar-carro": "dejar carro",
  "recoger-carro": "recoger carro",
  "cambio-de-mapa": "cambio de mapa",
  bifurcacion: "bifurcación",
  vinculacion: "vinculación",
  desvinculacion: "desvinculación",
};

const pick = (map: Readonly<Record<string, string>>) => (value: string): string => map[value] ?? value;

export const truthLabel = pick(TRUTH);
export const patternLabel = pick(PATTERN);
export const tagClassLabel = pick(TAG_CLASS);
export const verdictLabel = pick(VERDICT);
export const zoneLabel = pick(ZONE);
export const criticalFunctionLabel = pick(CRITICAL_FUNCTION);
