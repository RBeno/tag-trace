/**
 * Catálogo de los tipos de hallazgo revisables (R-EVI-007), con su tema y su rango.
 *
 * Vive en el dominio y no en la presentación porque el rango no es solo un orden de bandeja: la
 * consolidación (F4, `MEMORY_CONSOLIDATION.md` §6 y §8) bloquea un periodo con hallazgos de rango 1
 * confirmados —es una incidencia, no memoria normal—, y esa decisión la toma el Worker, que no puede
 * importar nada de `presentation/`. La presentación lo re-exporta desde `labels.ts`.
 */

/** Las pestañas por pregunta (UX_SPEC §2). El orden es el de la barra. */
export const THEMES = ["tags", "agv", "tiempos", "linea"] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Rango de un hallazgo: 1 puede parar la planta o perder una función, 2 degrada, 3 es limpieza y
 * contexto. Dentro de un rango manda el orden en que la vista lo produce.
 */
export type FindingRank = 1 | 2 | 3;

export const RANK_LABEL: Readonly<Record<FindingRank, string>> = {
  1: "Puede parar la planta o perder una función",
  2: "Degrada el circuito",
  3: "Limpieza y contexto",
};

/**
 * Cuántas tarjetas de cada lista se enseñan de entrada. Son parámetros de pantalla, no magnitudes de
 * planta, y viven aquí porque la instantánea (`snapshot-findings.ts`, en el Worker) tiene que llevar
 * exactamente las tarjetas revisables que la interfaz pinta: una que no se ve quedaría pendiente para
 * siempre y bloquearía la consolidación (OQ-149). `main.ts` los lee de aquí.
 */
export const CARDS_SHOWN = {
  /** Casos destacados de una lista (`HIGHLIGHTS` de `main.ts`). */
  highlights: 8,
  /** Tarjetas por tipo (`PER_KIND` de `main.ts`). */
  perKind: 5,
} as const;

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
  // Avisos para verificar del informe de lecturas con acciones (R-AGV-023, R-AGV-024): no son fallos.
  "tag-no-ejecutado": { theme: "tags", label: "tag no ejecutado", rank: 3 },
  "lectura-no-en-memoria": { theme: "tags", label: "lectura fuera de memoria", rank: 3 },
};

/** El tipo de un hallazgo por su clave; uno que no esté en el catálogo va a contexto, y se enseña tal cual. */
export function findingKindOf(kind: string): FindingKind {
  return FINDING_KINDS[kind] ?? { theme: "tiempos", label: kind, rank: 3 };
}
