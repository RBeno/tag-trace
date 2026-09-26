/**
 * La instantánea del circuito (ADR-0015): un grafo con fecha, lo que perdura de cada exportación.
 *
 * El propietario (2026-09-26): «guardar el estado del circuito como grafo con sus tags, posiciones
 * relativas, función y las últimas tendencias de tiempo; los vértices con la tasa de lectura si está
 * por debajo del 100 % y cualquier dato de interés; un grafo que va moviéndose, ampliando o
 * reduciendo sus vértices y aumentando o reduciendo sus caminos». Las lecturas en crudo solo viven en
 * la ventana de trabajo; la secuencia de instantáneas es la evolución.
 *
 * Este fichero fija el **contrato**: los tipos de abajo son los que el almacén guarda (`snapshots`,
 * versión 6), los que el `.agvproj` transporta (ADR-0012) y los que la vista de evolución dibuja.
 * Cambiar un campo es cambiar `SNAPSHOT_SCHEMA_VERSION` y escribir su migración. Los campos se
 * añaden; no se renombran.
 *
 * Qué **no** guarda, a propósito (`MEMORY_CONSOLIDATION.md` §4): lecturas, matriz completa, replay,
 * expedientes, estados por instante. Todo eso se reconstruye cargando el fichero otra vez.
 */

import type { StructureSet } from "./anchor-sums.js";
import type { Interval } from "./coverage.js";
import type { DriftComparison, DriftThresholds } from "./drift.js";
import type { FranjaThresholds, SegmentHistory } from "./franjas.js";
import type { TagClass } from "./inventory.js";
import type { Band, Regime } from "./segment-bands.js";
import type { ReviewState } from "./review.js";
import type { TagChangeThresholds } from "./tag-changes.js";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Un tag del anillo o fuera de él, tal como quedó en este fichero. */
export interface SnapshotVertex {
  readonly tagId: string;
  /** Posición en el anillo (0…n−1) o `null` si se lee fuera del anillo o no se lee. */
  readonly position: number | null;
  /** Segundos de recorrido desde el ancla, en ms; `null` si no se pudo situar (R-TIM-011). */
  readonly offsetMs: number | null;
  /** Tramo declarado (kitting, línea, cruce…) o `null`. */
  readonly section: string | null;
  /** Función crítica declarada o candidata; `null` si ninguna. */
  readonly funcion: string | null;
  readonly declared: boolean;
  /** Tasa de lectura sobre las pasadas probadas (R-OPP-013); `null` sin pasadas. */
  readonly readRate: number | null;
  readonly passes: number;
  readonly readings: number;
  /** AGV que pasaron por su sitio y no lo leyeron nunca en este fichero. */
  readonly nonReaders: readonly string[];
  /** Vecinos dominantes en la secuencia de los AGV (R-DAT-019), para situar el tag sin el anillo. */
  readonly predecessor: string | null;
  readonly successor: string | null;
  readonly inventoryClass: TagClass | null;
  /** Dónde está: en el anillo, en una calle (con su identificador), en la línea, o fuera. */
  readonly situation: "anillo" | "calle" | "linea" | "fuera" | "sin-lecturas";
  readonly laneId: string | null;
  readonly isAnchor: boolean;
}

/** Un tramo del anillo con su horquilla por régimen en este fichero (R-FLO-007, R-TIM-011). */
export interface SnapshotEdge {
  readonly from: string;
  readonly to: string;
  readonly produccion: Band | null;
  readonly noche: Band | null;
}

/** Una sección entre anclas (R-TIM-012). */
export interface SnapshotSection {
  readonly fromTagId: string;
  readonly toTagId: string;
  readonly name: string;
  readonly namedByList: boolean;
  readonly tags: readonly string[];
  readonly produccion: Band | null;
  readonly noche: Band | null;
}

/** La suma entre dos anclas seguidas (R-DAT-021), para comparar la estructura entre ficheros. */
export interface SnapshotAnchorGap {
  readonly fromAnchor: string;
  readonly toAnchor: string;
  /** Tags del anillo entre las dos anclas, en orden. */
  readonly tags: readonly string[];
  readonly produccion: { readonly samples: number; readonly p50Ms: number } | null;
  readonly noche: { readonly samples: number; readonly p50Ms: number } | null;
  /** Pasadas por el hueco y, por tag, en cuántas se leyó y por cuántos AGV distintos. */
  readonly passes: number;
  readonly readsByTag: Readonly<Record<string, { readonly passes: number; readonly vehicles: number }>>;
}

export interface SnapshotFinding {
  /** La clave de revisión (R-EVI-007): tipo y sujeto. */
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly figure: string;
  readonly review: ReviewState | null;
}

export interface SnapshotFleet {
  /** «N de M» al final del fichero, y la mediana de la ventana. */
  readonly assigned: number;
  readonly inCircuitAtEnd: number;
  readonly inCircuitMedian: number;
  readonly historySource: "historial" | "lecturas" | "historial-vacio";
  readonly vehicles: readonly string[];
}

export interface SnapshotLine {
  readonly entryTagId: string;
  readonly passes: number;
  readonly cadence: Band | null;
  readonly stops: number;
  readonly stopsWithoutAgv: number;
  readonly aboveFenceMs: number;
  readonly cycleMs: number | null;
}

export interface SnapshotLane {
  readonly laneId: string;
  readonly served: boolean;
  readonly stays: number;
  readonly share: number | null;
  readonly usageVerdict: "menos" | "mas" | null;
  readonly medianStayMs: number | null;
}

export interface CircuitSnapshot {
  readonly schemaVersion: number;
  readonly circuitId: string;
  readonly zone: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  /** Tramo analizable del fichero (R-DAT-007). */
  readonly window: Interval;
  readonly capturedAt: number;
  /** Versión de la aplicación y del catálogo de algoritmos con que se calculó. */
  readonly appVersion: string;
  readonly acceptedRows: number;
  /** Exposición por régimen dentro de la ventana, en ms. */
  readonly exposure: Readonly<Record<Regime, number>>;
  readonly cohortId: number;
  readonly anchorTagId: string | null;
  readonly anchorDeclared: boolean;
  /** El anillo en orden, empezando por el ancla. */
  readonly ring: readonly string[];
  readonly lapMs: number | null;
  readonly vertices: readonly SnapshotVertex[];
  readonly edges: readonly SnapshotEdge[];
  readonly sections: readonly SnapshotSection[];
  readonly anchorGaps: readonly SnapshotAnchorGap[];
  readonly fleet: SnapshotFleet | null;
  readonly line: SnapshotLine | null;
  readonly lanes: readonly SnapshotLane[];
  readonly findings: readonly SnapshotFinding[];
}

/**
 * Lo que el Worker entrega para construir la instantánea. Son resultados que ya calcula; la función
 * `buildSnapshot` los reduce al contrato de arriba y no vuelve a medir nada.
 */
export interface SnapshotInput {
  readonly circuitId: string;
  readonly zone: string;
  readonly source: {
    readonly sourceId: string;
    readonly sourceHash: string;
    readonly fileName: string;
    readonly window: Interval;
    readonly acceptedRows: number;
  };
  readonly capturedAt: number;
  readonly appVersion: string;
  readonly exposure: Readonly<Record<Regime, number>>;
  readonly cohortId: number;
  readonly anchorTagId: string | null;
  readonly anchorDeclared: boolean;
  readonly ring: readonly string[];
  readonly lapMs: number | null;
  readonly vertices: readonly SnapshotVertex[];
  readonly edges: readonly SnapshotEdge[];
  readonly sections: readonly SnapshotSection[];
  readonly anchorGaps: readonly SnapshotAnchorGap[];
  readonly fleet: SnapshotFleet | null;
  readonly line: SnapshotLine | null;
  readonly lanes: readonly SnapshotLane[];
  readonly findings: readonly SnapshotFinding[];
}

/** Construye la instantánea: valida, ordena de forma canónica y sella la versión del esquema. */
export function buildSnapshot(input: SnapshotInput): CircuitSnapshot {
  throw new Error(`buildSnapshot: pendiente de implementar (${input.source.sourceId})`);
}

/** Un vértice que aparece, desaparece, se mueve o cambia de clase entre dos instantáneas. */
export interface VertexDelta {
  readonly tagId: string;
  readonly kind: "aparece" | "desaparece" | "se-mueve" | "cambia-de-clase" | "deja-de-leerse" | "empieza-a-leerse";
  readonly before: SnapshotVertex | null;
  readonly after: SnapshotVertex | null;
  readonly detail: string;
}

/** Una arista más lenta o más rápida entre dos instantáneas, con el criterio de R-TIM-010. */
export interface EdgeDelta {
  readonly from: string;
  readonly to: string;
  readonly regime: Regime;
  readonly direction: "mas-lento" | "mas-rapido";
  readonly before: Band;
  readonly after: Band;
}

export interface SnapshotDelta {
  readonly fromSourceId: string;
  readonly toSourceId: string;
  readonly vertices: readonly VertexDelta[];
  readonly edges: readonly EdgeDelta[];
  readonly lapShift: { readonly beforeMs: number; readonly afterMs: number } | null;
}

/** Qué cambió del grafo de una instantánea a la siguiente. */
export function compareSnapshots(before: CircuitSnapshot, after: CircuitSnapshot): SnapshotDelta {
  throw new Error(`compareSnapshots: pendiente de implementar (${before.sourceId} → ${after.sourceId})`);
}

// --- Comparaciones entre ficheros, desde las instantáneas (ADR-0015 §3) ---------------------------

/**
 * Qué tramos cambian a lo largo de los ficheros (R-TIM-010, R-TIM-011), leído de las instantáneas en
 * orden de ventana. Mismo criterio y mismo resultado que `segmentHistories` de `franjas.ts`.
 */
export function historiesFromSnapshots(
  snapshots: readonly CircuitSnapshot[],
  thresholds: FranjaThresholds,
): readonly SegmentHistory[] {
  throw new Error(`historiesFromSnapshots: pendiente de implementar (${snapshots.length} instantáneas, ${thresholds.minPositionSamples})`);
}

/**
 * Tags insertados, retirados o sustituidos entre dos ficheros seguidos por la suma entre anclas
 * (R-DAT-021), leído de `anchorGaps`. `null` si no comparten anclas.
 */
export function structureBetweenSnapshots(
  before: CircuitSnapshot,
  after: CircuitSnapshot,
  thresholds: TagChangeThresholds,
): StructureSet | null {
  throw new Error(`structureBetweenSnapshots: pendiente de implementar (${before.sourceId} → ${after.sourceId}, ${thresholds.maxChance})`);
}

/**
 * Deriva entre dos periodos distantes (R-DAT-016, R-AGV-013): tags desaparecidos y nuevos con su
 * prueba de azar, y AGV que dejaron de leer o no adoptaron, leído de los vértices.
 */
export function driftBetweenSnapshots(
  early: CircuitSnapshot,
  late: CircuitSnapshot,
  thresholds: DriftThresholds,
): DriftComparison {
  throw new Error(`driftBetweenSnapshots: pendiente de implementar (${early.sourceId} → ${late.sourceId}, ${thresholds.maxChance})`);
}

