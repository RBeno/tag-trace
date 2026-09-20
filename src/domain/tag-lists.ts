/**
 * Qué listas de tags existen y qué forma tiene su fichero (`CONFIG_SCHEMA.md` §3.8).
 *
 * Está en el dominio y no en la ingesta **porque hay que enseñarlo antes de pedir el fichero**. No
 * existe forma de descargar estas listas del sistema de planta: se escriben a mano. Cuando el
 * formato lo decide quien escribe, pedirle que adivine el que esperamos es el modo más seguro de
 * que no coincida, así que la estructura se declara en la pantalla y el parseo la comparte.
 */

/** Las listas que el producto ya sabe usar. Cualquier otra se conserva con su nombre. */
export const KNOWN_LISTS = [
  "circuito",
  "memoria",
  "mantenimiento",
  "emergencia",
  "carga-online",
  "critico",
] as const;

export type KnownList = (typeof KNOWN_LISTS)[number];

/** Para qué sirve cada una, en la frase que se enseña junto al selector. */
export const LIST_PURPOSE: Readonly<Record<KnownList, string>> = {
  circuito: "los tags que Vsystem declara como parte del circuito",
  memoria: "la lista maestra que cada vehículo debería llevar cargada",
  mantenimiento: "tags de mantenimiento, fuera del recorrido productivo",
  emergencia: "tags de sustitución de emergencia",
  "carga-online": "los tags de las calles de carga, en su orden",
  critico: "paradas precisas, cruces, semáforos, dejar/recoger carro, cambios de mapa y bifurcaciones",
};

/** Lo que se le enseña al usuario antes de pedirle el fichero. */
export const EXPECTED_STRUCTURE = {
  header: ["lista", "tag"] as const,
  optional: ["orden", "nota"] as const,
  lists: KNOWN_LISTS,
  example: [
    "lista;tag;orden",
    "circuito;51944;1",
    "circuito;102185;2",
    "memoria;51944",
    "mantenimiento;57544",
  ] as const,
} as const;
