/**
 * El plano físico del circuito (ADR-0016): ubicaciones estables, el tag instalado en cada una a lo
 * largo del tiempo, y las salidas que se revisan a mano.
 *
 * - **Ubicación ≠ tag.** Sustituir el tag de una ubicación cambia la instalación, no la ubicación, y
 *   la historia del tramo sigue.
 * - **Eventos append-only con fecha efectiva.** El plano de un instante sale de recorrer los eventos
 *   hasta ese instante; ningún evento reescribe el pasado.
 * - **Ninguna IA cambia el plano.** `proposeChanges` propone con evidencia; solo la confirmación de
 *   una persona se convierte en evento (ADR-0010, R-MEM-001).
 * - **El plano persiste frente a las lecturas.** Una ubicación sin leer en un fichero queda «no
 *   observada» con sus pasadas, no fuera del plano.
 *
 * Este fichero fija el **contrato**. Los campos se añaden, no se renombran; cambiar uno es subir
 * `PLAN_SCHEMA_VERSION` y escribir su migración.
 */

import type { Interval } from "./coverage.js";
import type { ConsolidatedVersion } from "./memory.js";
import type { CircuitSnapshot, SnapshotDelta } from "./snapshot.js";
import type { TruthState } from "./truth.js";

export const PLAN_SCHEMA_VERSION = 1;

// --- Estadísticas combinables (ADR-0016 §6) ---------------------------------------------------------

/** Recuento, media y suma de cuadrados de desviaciones (Welford): se combinan sin las muestras. */
export interface Moments {
  readonly n: number;
  readonly meanMs: number;
  readonly m2: number;
}

/** Los momentos de una lista de duraciones; `n = 0` da media y M2 cero. */
export function momentsOf(durations: readonly number[]): Moments {
  throw new Error(`momentsOf: pendiente de implementar (${durations.length})`);
}

/** Combinación exacta de dos conjuntos (Chan et al.): el resultado es el de haber medido todo junto. */
export function combineMoments(a: Moments, b: Moments): Moments {
  throw new Error(`combineMoments: pendiente de implementar (${a.n}, ${b.n})`);
}

/** Varianza muestral (`m2 / (n − 1)`), o `null` con menos de dos muestras. */
export function varianceOf(moments: Moments): number | null {
  throw new Error(`varianceOf: pendiente de implementar (${moments.n})`);
}

// --- Eventos del plano -------------------------------------------------------------------------------

export type LocationKind = "anillo" | "salida";

/** Lo que encontró quien fue a mirar una ubicación. */
export type ManualResult = "correcto" | "averiado" | "no-encontrado";

export interface PlanEvidence {
  /** El fichero cuya instantánea sostiene el cambio; `null` en un cambio manual sin fichero. */
  readonly sourceId: string | null;
  readonly fileName: string | null;
  /** Qué se vio, en palabras: vecinos, pasadas, AGV distintos. */
  readonly detail: string;
}

interface PlanEventBase {
  readonly circuitId: string;
  /** 1, 2, 3… en orden de registro. Es la clave del evento en el almacén. */
  readonly seq: number;
  /** Desde cuándo vale el cambio (instante UTC). No tiene por qué ser el momento de registrarlo. */
  readonly effectiveAt: number;
  /** Cuándo se registró. */
  readonly recordedAt: number;
  /** Justificación humana. Nunca vacía. */
  readonly reason: string;
  readonly evidence: PlanEvidence | null;
  /** `propuesta`: nació de `proposeChanges` y una persona la confirmó; `manual`: la escribió una persona. */
  readonly origin: "manual" | "propuesta";
}

/** El cuerpo de cada tipo de evento, sin la base común. */
export type PlanEventBody =
  /** El plano nace de una versión consolidada: una ubicación de anillo por tag de su anillo, en orden. */
  | {
      readonly type: "crear-plano";
      readonly fromVersion: number;
      readonly ring: readonly { readonly locationId: string; readonly tagId: string }[];
    }
  /**
   * Una ubicación nueva. De anillo, detrás de `after` (la conexión `after → siguiente` se parte en
   * dos); o salida, colgando de `branchFrom`. Nace sin tag salvo que la acompañe un `instalar`.
   * `virtualTag`: el código que el circuito virtual declara para ese sitio, si lo hay, aunque no
   * esté instalado físicamente (R-OPP-011: sin tag físico no hay oportunidad).
   */
  | {
      readonly type: "crear-ubicacion";
      readonly locationId: string;
      readonly kind: LocationKind;
      readonly after: string | null;
      readonly branchFrom: string | null;
      readonly virtualTag: string | null;
    }
  /** Se instala un tag en una ubicación que no tenía ninguno. */
  | { readonly type: "instalar"; readonly locationId: string; readonly tagId: string }
  /** Se retira el tag; la ubicación sigue, sin tag físico. */
  | { readonly type: "retirar"; readonly locationId: string }
  /** Se cambia el tag de una ubicación por otro: la ubicación y su historia siguen. */
  | { readonly type: "sustituir"; readonly locationId: string; readonly tagId: string }
  /** La ubicación deja de existir; en el anillo, sus vecinos pasan a estar conectados. */
  | { readonly type: "cerrar-ubicacion"; readonly locationId: string }
  /** Alguien fue a mirar la ubicación: observación confirmada (ADR-0016 §5). */
  | { readonly type: "revision-manual"; readonly locationId: string; readonly result: ManualResult; readonly note: string };

export type PlanEvent = PlanEventBase & PlanEventBody;

/** Lo que la interfaz manda para registrar un evento: el cuerpo, su fecha efectiva y su evidencia. */
export type PlanEventInput = PlanEventBody & {
  readonly effectiveAt: number;
  readonly evidence: PlanEvidence | null;
};

// --- El plano de un instante -------------------------------------------------------------------------

export interface PlanLocation {
  readonly locationId: string;
  readonly kind: LocationKind;
  /** El tag instalado en ese instante, o `null` si la ubicación no tiene tag físico. */
  readonly tagId: string | null;
  readonly virtualTag: string | null;
  /** Solo en las salidas: la ubicación del anillo de la que cuelga. */
  readonly branchFrom: string | null;
  readonly createdAt: number;
  /** Cada tag que ha tenido, con su vigencia; el último con `to: null` si sigue instalado. */
  readonly history: readonly { readonly tagId: string; readonly from: number; readonly to: number | null }[];
  readonly lastReview: { readonly at: number; readonly result: ManualResult; readonly note: string } | null;
}

export interface PhysicalPlan {
  readonly circuitId: string;
  /** El instante al que corresponde. */
  readonly at: number;
  /** La versión consolidada de la que nació. */
  readonly fromVersion: number;
  /** Las ubicaciones del anillo en orden; la última conecta con la primera. */
  readonly ring: readonly string[];
  /** Todas las ubicaciones abiertas en ese instante: anillo y salidas. */
  readonly locations: readonly PlanLocation[];
}

/** El plano vigente en `at`, o `null` si en ese instante aún no había plano. Los eventos, en cualquier orden. */
export function planAt(events: readonly PlanEvent[], at: number): PhysicalPlan | null {
  throw new Error(`planAt: pendiente de implementar (${events.length}, ${at})`);
}

/**
 * ¿Se puede añadir este evento? Devuelve la razón en palabras si no: ubicación desconocida o
 * cerrada, tag ya instalado en otra ubicación abierta, instalar donde ya hay tag, sustituir o
 * retirar donde no lo hay, salida que cuelga de algo que no es anillo, razón vacía, plano repetido.
 */
export function validateEvent(events: readonly PlanEvent[], candidate: PlanEvent): string | null {
  throw new Error(`validateEvent: pendiente de implementar (${events.length}, ${candidate.type})`);
}

/** El siguiente identificador de ubicación libre: `U-0001`, `U-0002`… sin reutilizar nunca uno. */
export function nextLocationId(events: readonly PlanEvent[]): string {
  throw new Error(`nextLocationId: pendiente de implementar (${events.length})`);
}

/** El evento `crear-plano` desde una versión consolidada: su anillo, en orden, con ubicaciones nuevas. */
export function bootstrapPlan(
  version: ConsolidatedVersion,
  context: { readonly circuitId: string; readonly recordedAt: number; readonly reason: string },
): PlanEvent {
  throw new Error(`bootstrapPlan: pendiente de implementar (v${version.version}, ${context.circuitId})`);
}

/** Una línea en palabras para el historial del plano. */
export function describeEvent(event: PlanEvent): string {
  throw new Error(`describeEvent: pendiente de implementar (${event.type})`);
}

// --- Observación de un fichero contra el plano (ADR-0016 §4) ----------------------------------------

export type LocationState =
  /** Su tag se leyó en las pasadas por su sitio. */
  | "observado"
  /** Hubo pasadas por su sitio y su tag no se leyó en ninguna: «no observado», no «desaparece». */
  | "no-observado"
  /** No hay prueba de que se pasara por su sitio en este fichero. */
  | "sin-ocasion"
  /** La ubicación no tiene tag físico: no hay oportunidad (R-OPP-011). */
  | "sin-tag"
  /** Salida: su estado es la última revisión manual, no las lecturas. */
  | "revision-manual";

export interface LocationObservation {
  readonly locationId: string;
  readonly kind: LocationKind;
  readonly tagId: string | null;
  readonly state: LocationState;
  /** `observed` si se leyó; `inferred` si se deduce el paso por sus vecinos; `confirmed` en una revisión manual; `unknown` sin ocasión. */
  readonly truth: TruthState;
  /** Oportunidades evaluables: pasadas probadas por su sitio (R-OPP-013). */
  readonly evaluable: number;
  readonly successes: number;
  readonly omissions: number;
  /** Pasadas que no se pudieron dar por buenas ni por malas; `null` si la instantánea no permite contarlas. */
  readonly uncertain: number | null;
  readonly detail: string;
}

export interface EdgeObservation {
  readonly fromLocation: string;
  readonly toLocation: string;
  /** `true` si salta ubicaciones del plano que no se leyeron: es una ruta, no una conexión del plano. */
  readonly composite: boolean;
  readonly produccion: Moments | null;
  readonly noche: Moments | null;
}

/** Un tag leído en el anillo del fichero que no está instalado en ninguna ubicación del plano. */
export interface UnplannedTag {
  readonly tagId: string;
  readonly readings: number;
  readonly passes: number;
  /** Las ubicaciones del plano entre las que se leyó, si se sabe. */
  readonly after: string | null;
  readonly before: string | null;
}

export interface PlanObservation {
  readonly sourceId: string;
  readonly fileName: string;
  readonly window: Interval;
  /** El plano con el que se interpretó: el vigente al final de la ventana del fichero. */
  readonly planAt: number;
  readonly locations: readonly LocationObservation[];
  readonly edges: readonly EdgeObservation[];
  readonly unplanned: readonly UnplannedTag[];
}

export function observeAgainstPlan(plan: PhysicalPlan, snapshot: CircuitSnapshot): PlanObservation {
  throw new Error(`observeAgainstPlan: pendiente de implementar (${plan.circuitId}, ${snapshot.sourceId})`);
}

// --- Propuestas de cambio (solo propuestas: las confirma una persona) --------------------------------

export type ProposalKind =
  /** Un código se lee entre dos ubicaciones y no está instalado en ninguna. */
  | "tag-nuevo"
  /** Un código nuevo aparece donde una ubicación deja de leerse, con los mismos vecinos. */
  | "sustitucion"
  /** Un tag de parada por salida de circuito (lista `critico`, función `parada`) sin ubicación en el plano. */
  | "salida-sin-ubicar";

export interface PlanProposal {
  /** Estable entre análisis del mismo fichero: `tipo|tag|ubicación`. */
  readonly id: string;
  readonly kind: ProposalKind;
  readonly title: string;
  readonly detail: string;
  readonly evidence: PlanEvidence;
  /**
   * Los eventos que se escribirían al confirmarla, en orden (una ubicación nueva va con su
   * `instalar`). En `salida-sin-ubicar` falta `branchFrom`: lo elige la persona.
   */
  readonly events: readonly PlanEventInput[];
}

export function proposeChanges(
  plan: PhysicalPlan,
  observation: PlanObservation,
  snapshot: CircuitSnapshot,
  context: {
    /** Tags de parada por salida de circuito declarados (lista `critico`, función `parada`). */
    readonly declaredExits: readonly string[];
    /** AGV distintos que tienen que leer un código para proponerlo (el mismo criterio que R-DAT-021). */
    readonly minVehicles: number;
  },
): readonly PlanProposal[] {
  throw new Error(`proposeChanges: pendiente de implementar (${plan.circuitId}, ${observation.sourceId}, ${snapshot.sourceId}, ${context.minVehicles})`);
}

// --- Resúmenes por periodo (ADR-0016 §6) --------------------------------------------------------------

export interface OpportunityCounts {
  readonly evaluable: number;
  readonly successes: number;
  readonly omissions: number;
  /** `null` si algún periodo no permitió contarlos: la suma no se inventa. */
  readonly uncertain: number | null;
}

export interface LocationSummary {
  readonly locationId: string;
  readonly kind: LocationKind;
  /** El tag vigente en el último periodo. */
  readonly tagId: string | null;
  readonly periods: readonly (OpportunityCounts & {
    readonly sourceId: string;
    readonly fileName: string;
    readonly window: Interval;
    readonly tagId: string | null;
    readonly state: LocationState;
  })[];
  readonly total: OpportunityCounts;
}

export interface EdgeSummary {
  readonly fromLocation: string;
  readonly toLocation: string;
  readonly composite: boolean;
  readonly produccion: Moments | null;
  readonly noche: Moments | null;
  /** En cuántos periodos se midió. */
  readonly periods: number;
}

/** Suma las observaciones de varios ficheros por ubicación y por conexión, con `combineMoments`. */
export function summarizePlan(observations: readonly PlanObservation[]): {
  readonly locations: readonly LocationSummary[];
  readonly edges: readonly EdgeSummary[];
} {
  throw new Error(`summarizePlan: pendiente de implementar (${observations.length})`);
}

/**
 * La evolución leída con el plano (ADR-0016 §4): un «desaparece» de un tag instalado en una
 * ubicación del plano pasa a «no-observado», con las pasadas por su sitio en el detalle. Lo demás
 * queda igual.
 */
export function reinterpretDelta(delta: SnapshotDelta, observationAfter: PlanObservation | null): SnapshotDelta {
  throw new Error(`reinterpretDelta: pendiente de implementar (${delta.vertices.length}, ${observationAfter?.sourceId ?? "-"})`);
}
