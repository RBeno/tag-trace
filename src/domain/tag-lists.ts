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
  "zona",
  "ancla",
] as const;

export type KnownList = (typeof KNOWN_LISTS)[number];

/** Para qué sirve cada una, en la frase que se enseña junto al selector. */
export const LIST_PURPOSE: Readonly<Record<KnownList, string>> = {
  circuito: "los tags que Vsystem declara como parte del circuito",
  memoria: "la lista maestra que cada vehículo debería llevar cargada",
  mantenimiento: "tags de mantenimiento, fuera del recorrido productivo",
  emergencia: "tags de sustitución de emergencia",
  "carga-online":
    "los tags de las calles de carga, en su orden, con `grupo` = calle y `funcion` = entrada, " +
    "parada-precisa o salida",
  critico:
    "paradas precisas, cruces, semáforos, dejar/recoger carro, cambios de mapa y bifurcaciones, " +
    "con la clase en `funcion`",
  zona: "a qué zona pertenece cada tag: `grupo` = cargado o vacio (R-FLO-001, R-FLO-002)",
  ancla:
    "el tag, o varios en orden de prioridad con `orden`, que el propietario declara como corte de " +
    "vuelta (R-GRA-009)",
};

/**
 * Los valores que `funcion` admite en las listas que la usan.
 *
 * Se declaran aquí, y no repartidos por los consumidores, porque son parte de lo que se le enseña
 * al usuario antes de pedirle el fichero: una taxonomía que hay que adivinar no la acierta nadie.
 * Un valor fuera de esta lista **no se rechaza** —la fila sigue siendo un tag de esa lista—, pero
 * la calle o el punto crítico que dependan de él no se montan, y se dice por qué.
 */
export const LIST_FUNCTIONS = {
  "carga-online": ["entrada", "parada-precisa", "salida"] as const,
  critico: [
    "parada-precisa",
    "cruce",
    "semaforo",
    "dejar-carro",
    "recoger-carro",
    "cambio-de-mapa",
    "bifurcacion",
  ] as const,
  zona: ["cargado", "vacio"] as const,
} as const;

/** Lo que se le enseña al usuario antes de pedirle el fichero. */
export const EXPECTED_STRUCTURE = {
  header: ["lista", "tag"] as const,
  optional: ["orden", "funcion", "grupo", "capacidad", "nota"] as const,
  lists: KNOWN_LISTS,
  example: [
    "lista;tag;orden;funcion;grupo;capacidad",
    "circuito;51944;1",
    "circuito;102185;2",
    "memoria;51944",
    "mantenimiento;57544",
    "carga-online;70011;1;entrada;calle-1;2",
    "carga-online;70012;2;parada-precisa;calle-1;2",
    "carga-online;70013;3;salida;calle-1;2",
    "zona;51944;;;vacio",
    "critico;102185;;bifurcacion",
    "ancla;51944;1",
  ] as const,
} as const;
