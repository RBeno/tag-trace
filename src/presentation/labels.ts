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

const pick = (map: Readonly<Record<string, string>>) => (value: string): string => map[value] ?? value;

export const truthLabel = pick(TRUTH);
export const patternLabel = pick(PATTERN);
export const tagClassLabel = pick(TAG_CLASS);
export const verdictLabel = pick(VERDICT);
export const zoneLabel = pick(ZONE);
export const criticalFunctionLabel = pick(CRITICAL_FUNCTION);
export const orderChangeLabel = pick(ORDER_CHANGE);
export const orderReadingLabel = pick(ORDER_READING);

// --- Bandeja de hallazgos (UX_SPEC §4.5) -----------------------------------------------------------

/** Las pestañas por pregunta (UX_SPEC §2). El orden es el de la barra. */
export const THEMES = ["tags", "agv", "tiempos", "linea"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABEL: Readonly<Record<Theme, string>> = {
  tags: "Tags",
  agv: "AGV",
  tiempos: "Tiempos",
  linea: "Línea y calles",
};

/**
 * Rango de un hallazgo en la bandeja: 1 puede parar la planta o perder una función, 2 degrada, 3 es
 * limpieza y contexto. Dentro de un rango manda el orden en que la vista lo produce.
 */
export type FindingRank = 1 | 2 | 3;

export const RANK_LABEL: Readonly<Record<FindingRank, string>> = {
  1: "Puede parar la planta o perder una función",
  2: "Degrada el circuito",
  3: "Limpieza y contexto",
};

export interface FindingKind {
  readonly theme: Theme;
  readonly label: string;
  readonly rank: FindingRank;
}

/**
 * Catálogo de los tipos de hallazgo revisables, por el primer elemento de su clave de revisión
 * (R-EVI-007). El tema es el de la pregunta que responde el hallazgo, no la sección donde se calcula:
 * «Ver evidencia» lleva a la sección; el tema es lo que se filtra en la bandeja.
 */
export const FINDING_KINDS: Readonly<Record<string, FindingKind>> = {
  // Rango 1: bloqueos, cuellos, puntos conflictivos, roturas, calle sin servicio, línea sin paso.
  bloqueo: { theme: "tiempos", label: "primero de cola sin avanzar", rank: 1 },
  "cuello-de-botella": { theme: "tiempos", label: "cuello de botella", rank: 1 },
  "punto-conflictivo": { theme: "tiempos", label: "punto conflictivo", rank: 1 },
  "produccion-parada": { theme: "tiempos", label: "producción parada", rank: 1 },
  "tag-rotura": { theme: "tags", label: "rotura de un tag", rank: 1 },
  "agv-rotura": { theme: "agv", label: "rotura de un AGV", rank: 1 },
  "deja-de-leer": { theme: "agv", label: "AGV que deja de leer", rank: 1 },
  "calle-sin-servicio": { theme: "linea", label: "calle sin servicio", rank: 1 },
  linea: { theme: "linea", label: "parada de la línea", rank: 1 },
  "linea-paso": { theme: "linea", label: "paso por la línea", rank: 1 },
  // Rango 2: zonas oscuras, lectura por AGV, tags que dejan de leerse, ritmo, retenciones, entregas.
  "zona-oscura": { theme: "tiempos", label: "zona oscura", rank: 2 },
  "parada-sin-explicacion": { theme: "tiempos", label: "parada sin explicación", rank: 2 },
  "entrega-agrupada-agv": { theme: "agv", label: "lecturas que llegan juntas", rank: 2 },
  "entrega-agrupada-sitio": { theme: "tiempos", label: "lecturas que llegan juntas", rank: 2 },
  "cambio-de-horquilla": { theme: "tiempos", label: "cambio de la horquilla", rank: 2 },
  "tramo-entre-ficheros": { theme: "tiempos", label: "tramo que cambia entre ficheros", rank: 2 },
  "estructura-entre-ficheros": { theme: "tiempos", label: "cambio de estructura entre ficheros", rank: 2 },
  "tag-lectura": { theme: "tags", label: "lectura del tag", rank: 2 },
  "tag-deja": { theme: "tags", label: "tag que dejó de leerse", rank: 2 },
  "tag-empieza": { theme: "tags", label: "tag que empezó a leerse", rank: 2 },
  "tag-degradacion": { theme: "tags", label: "degradación de un tag", rank: 2 },
  "cambio-tag": { theme: "tags", label: "cambio de tag", rank: 2 },
  estructura: { theme: "tags", label: "cambio de estructura", rank: 2 },
  "agv-nunca": { theme: "agv", label: "AGV que no lee nunca", rank: 2 },
  "agv-desde": { theme: "agv", label: "AGV que dejó de leer", rank: 2 },
  "agv-poco": { theme: "agv", label: "AGV que lee poco", rank: 2 },
  "agv-degradacion": { theme: "agv", label: "degradación de un AGV", rank: 2 },
  "ritmo-agv": { theme: "agv", label: "ritmo del AGV", rank: 2 },
  "retiene-agv": { theme: "agv", label: "retiene a otros", rank: 2 },
  "flota-sin-lecturas": { theme: "agv", label: "asignados sin lecturas", rank: 2 },
  "flota-sin-asignar": { theme: "agv", label: "leen sin estar asignados", rank: 2 },
  "calle-lectura": { theme: "linea", label: "tag de calle sin leer", rank: 2 },
  "calle-espera": { theme: "linea", label: "turno saltado en la calle", rank: 2 },
  "calle-permanencia": { theme: "linea", label: "permanencia larga en la calle", rank: 2 },
  "sin-carga": { theme: "linea", label: "AGV sin entrar a cargar", rank: 2 },
  fifo: { theme: "linea", label: "adelantamiento en zona cargada", rank: 2 },
  // Rango 3: lista, fuera de la lista, deriva sin afirmar, uso de calles, candidatos.
  deriva: { theme: "tags", label: "cambio entre periodos", rank: 3 },
  "deriva-agv": { theme: "agv", label: "AGV con cambios entre periodos", rank: 3 },
  "tag-fuera-del-circuito": { theme: "tags", label: "tag fuera de la lista", rank: 3 },
  "calle-uso": { theme: "linea", label: "uso de la calle", rank: 3 },
  "arranque-en-frio": { theme: "linea", label: "cargando al empezar los datos", rank: 3 },
  "punto-critico": { theme: "tiempos", label: "candidato a punto crítico", rank: 3 },
};

/** El tipo de un hallazgo por su clave; uno que no esté en el catálogo va a contexto, y se enseña tal cual. */
export function findingKindOf(kind: string): FindingKind {
  return FINDING_KINDS[kind] ?? { theme: "tiempos", label: kind, rank: 3 };
}
