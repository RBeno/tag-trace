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
  "noche",
  "linea",
  "tramo",
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
    "puntos críticos, con su clase en `funcion`: parada precisa, parada, giro, cambio de MTC, cruce, " +
    "semáforo, dejar/recoger carro, cambio de mapa, bifurcación, vinculación, desvinculación, tramo " +
    "conflictivo o control wifi. Otra " +
    "función de planta también cuenta como crítica, con su nombre. Dos tags seguidos en el circuito " +
    "con la misma función son un refuerzo. También vale la columna `funcion` de la lista `circuito`",
  zona: "a qué zona pertenece cada tag: `grupo` = cargado o vacio",
  ancla:
    "el tag donde se corta cada vuelta (o varios, por prioridad en `orden`)",
  noche:
    "tags que pueden aparecer de noche en el circuito: explican un tag que solo se lee de noche",
  linea:
    "los tags de la línea de producción, en su orden: el primero es la entrada, donde se mide la cadencia y el pulmón",
  tramo:
    "a qué tramo pertenece cada tag, con su nombre en `grupo` (kitting, línea, cruce…): se dibuja en las gráficas del anillo y no cambia ningún cálculo",
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
    "parada",
    "giro",
    "cambio-de-mtc",
    "cruce",
    "semaforo",
    "dejar-carro",
    "recoger-carro",
    "cambio-de-mapa",
    "bifurcacion",
    "vinculacion",
    "desvinculacion",
    "tramo-conflictivo",
    "control-wifi",
  ] as const,
  zona: ["cargado", "vacio"] as const,
} as const;

/**
 * Qué es cada función crítica cuando el nombre no lo dice solo, en palabras del propietario. Se
 * enseña con la taxonomía para que quien escribe la lista sepa cuál poner.
 */
export const FUNCTION_MEANING: Readonly<Record<string, string>> = {
  "parada-precisa":
    "el AGV espera la señal del servidor; la condicionada (grupo «condicionada») espera el estado de un sensor, un pulsador o una señal de radio",
  parada:
    "seguridad para que el AGV no se vaya por otro circuito: lo detiene y solo vuelve a funcionar a mano. Un AGV parado ahí no es una espera normal",
  "cambio-de-mtc":
    "cambia el número de MTC (multicircuito) del AGV —normal, 1, 2… 15— para hacer alguna configuración especial; el número al que cambia va en «grupo»",
  bifurcacion:
    "el AGV sigue por un camino u otro; los tags MTC de carga online le ordenan girar hacia la calle que le asignó el servidor (la calle, en «grupo»)",
  "recoger-carro": "pin arriba: el AGV recoge el carro",
  "dejar-carro": "pin abajo: el AGV suelta el carro",
  cruce: "zona donde el circuito se cruza o comparte camino con otros, también con AGV que llevan baterías",
  "tramo-conflictivo":
    "tramo con un problema físico conocido, como una arqueta metálica bajo la guía magnética. Seguido es una zona, no un refuerzo",
  "control-wifi":
    "manda continuar a los AGV sin wifi para que no se detengan indefinidamente esperando la orden del servidor",
};

/** Lo que se le enseña al usuario antes de pedirle el fichero. */
export const EXPECTED_STRUCTURE = {
  header: ["lista", "tag"] as const,
  optional: ["orden", "funcion", "grupo", "capacidad", "nota"] as const,
  lists: KNOWN_LISTS,
  example: [
    "lista;tag;orden;funcion;grupo;capacidad",
    "circuito;51944;1",
    "circuito;103358;2;vinculacion",
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
