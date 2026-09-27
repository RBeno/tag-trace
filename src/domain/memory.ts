/**
 * La memoria consolidada del circuito (F4; ADR-0005, ADR-0015 §4, R-MEM-001..003).
 *
 * Una **versión** es una instantánea revisada que una persona eligió como referencia del circuito:
 * el «esperado» contra el que se comparan los ficheros siguientes. Se escribe **append-only**:
 * vN+1 nunca toca vN; un error se corrige con una revocación que apunta a la versión afectada y una
 * versión nueva, y el historial y la razón permanecen visibles (`MEMORY_CONSOLIDATION.md` §7).
 * Ninguna IA consolida: `consolidate` solo se llama tras la confirmación humana del flujo de §6.
 *
 * Este fichero fija el **contrato** (tipos y firmas). Los campos se añaden, no se renombran; cambiar
 * uno es subir `MEMORY_SCHEMA_VERSION` y escribir su migración.
 */

import type { ReviewEntry, ReviewState } from "./review.js";
import type { CircuitSnapshot, SnapshotDelta } from "./snapshot.js";
import type { TagChangeThresholds } from "./tag-changes.js";

export const MEMORY_SCHEMA_VERSION = 1;

/** Un hallazgo del periodo con la decisión humana que llevaba al consolidar (R-EVI-007). */
export interface MemoryDecision {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly figure: string;
  readonly state: ReviewState;
  readonly note: string | null;
}

export interface ConsolidatedVersion {
  readonly schemaVersion: number;
  readonly circuitId: string;
  /** 1, 2, 3… en orden de creación dentro del linaje. */
  readonly version: number;
  readonly createdAt: number;
  /** El fichero del que sale la instantánea consolidada. */
  readonly basedOn: {
    readonly sourceId: string;
    readonly sourceHash: string;
    readonly fileName: string;
    readonly window: { readonly from: number; readonly to: number };
  };
  /** Cadena de hashes (`MEMORY_CONSOLIDATION.md` §10): el de la versión anterior del linaje, o `null` en la primera. */
  readonly previousHash: string | null;
  /** Hash semántico del contenido de esta versión sin este campo (INV-010). */
  readonly hash: string;
  /** Identificador del linaje: el dispositivo que consolidó. Dos linajes distintos son una bifurcación. */
  readonly lineage: string;
  /** El grafo consolidado: la instantánea elegida, tal cual. */
  readonly snapshot: CircuitSnapshot;
  /** Lo que cambia frente a la versión anterior no revocada; `null` en la primera. */
  readonly delta: SnapshotDelta | null;
  /** Los hallazgos con su decisión: confirmados, descartados y pospuestos con su motivo. */
  readonly decisions: readonly MemoryDecision[];
  /** Justificación humana de la consolidación, opcional. */
  readonly note: string | null;
  readonly revoked: { readonly at: number; readonly reason: string } | null;
  /** Versión de la aplicación que consolidó. */
  readonly appVersion: string;
}

export type BlockerCode =
  /** Hay hallazgos sin revisar: solo bloquea lo pendiente (propietario, 2026-09-23). */
  | "hallazgos-pendientes"
  /** Hay hallazgos de rango 1 confirmados: es un periodo de incidencia, no memoria normal (§6, §8). */
  | "periodo-de-incidencia"
  /** El fichero elegido no tiene instantánea. */
  | "sin-instantanea"
  /** Ya hay una versión no revocada basada en ese mismo fichero (INV-007). */
  | "ya-consolidada"
  /** Hay una bifurcación de linaje sin resolver (§10). */
  | "bifurcacion-sin-resolver";

export interface ConsolidationBlocker {
  readonly code: BlockerCode;
  readonly detail: string;
  /** Claves de hallazgo, identificadores de fichero o versiones implicadas. */
  readonly items: readonly string[];
}

export interface ConsolidationPreview {
  readonly basedOn: ConsolidatedVersion["basedOn"];
  /** La versión vigente (última no revocada) o `null`. */
  readonly previous: ConsolidatedVersion | null;
  readonly nextVersion: number;
  readonly delta: SnapshotDelta | null;
  readonly blockers: readonly ConsolidationBlocker[];
  /** Avisos que no bloquean: pospuestos que volverán como pendientes, descartados, etc. */
  readonly warnings: readonly string[];
  readonly decisions: readonly MemoryDecision[];
  /** Tamaño estimado de la versión, en bytes, para el presupuesto (§9). */
  readonly estimatedBytes: number;
}

export interface ConsolidationInput {
  readonly snapshot: CircuitSnapshot;
  /** Las marcas de revisión del circuito, por clave. */
  readonly reviews: ReadonlyMap<string, ReviewEntry>;
  /** Todas las versiones guardadas, revocadas incluidas, en orden. */
  readonly versions: readonly ConsolidatedVersion[];
  /** Rango de cada tipo de hallazgo (1 puede parar la planta, 2 degrada, 3 limpieza). */
  readonly rankOf: (kind: string) => number;
  /** `true` si hay una bifurcación de linaje sin resolver (§10). */
  readonly forkUnresolved: boolean;
  readonly thresholds: Pick<TagChangeThresholds, "maxChance">;
}

/** Qué pasaría al consolidar: la previsualización de vN+1 (§6, paso E). No escribe nada. */
export function previewConsolidation(input: ConsolidationInput): ConsolidationPreview {
  throw new Error(`previewConsolidation: pendiente de implementar (${input.snapshot.sourceId})`);
}

/**
 * Escribe la versión vN+1 en memoria (no en el almacén): solo tras la confirmación humana (§6,
 * paso G). Lanza si la previsualización tiene bloqueos. El `hash` sale del hash semántico del
 * contenido y `previousHash` del vigente.
 */
export async function consolidate(
  preview: ConsolidationPreview,
  context: { readonly circuitId: string; readonly snapshot: CircuitSnapshot; readonly lineage: string; readonly appVersion: string; readonly now: number; readonly note: string | null },
): Promise<ConsolidatedVersion> {
  throw new Error(`consolidate: pendiente de implementar (${context.circuitId}, v${preview.nextVersion})`);
}

/** Revoca una versión: no la borra ni la edita, la marca con fecha y razón (§7). */
export function revokeVersion(version: ConsolidatedVersion, reason: string, now: number): ConsolidatedVersion {
  throw new Error(`revokeVersion: pendiente de implementar (v${version.version}, ${reason}, ${now})`);
}

/** La versión vigente: la última no revocada, o `null`. */
export function currentVersion(versions: readonly ConsolidatedVersion[]): ConsolidatedVersion | null {
  throw new Error(`currentVersion: pendiente de implementar (${versions.length})`);
}

/** Lo observado frente a la memoria: el delta del fichero actual contra la versión vigente. */
export interface MemoryComparison {
  readonly version: number;
  readonly basedOnFileName: string;
  readonly consolidatedAt: number;
  readonly delta: SnapshotDelta;
}

export function compareToMemory(
  current: CircuitSnapshot,
  memory: ConsolidatedVersion,
  thresholds: Pick<TagChangeThresholds, "maxChance">,
): MemoryComparison {
  throw new Error(`compareToMemory: pendiente de implementar (${current.sourceId}, v${memory.version}, ${thresholds.maxChance})`);
}

/** Relación entre la memoria local y la de un `.agvproj` que se abre (§10). */
export type LineageRelation = "sin-memoria" | "identica" | "local-adelantada" | "entrante-adelantada" | "bifurcada";

export function classifyLineage(
  local: readonly ConsolidatedVersion[],
  incoming: readonly ConsolidatedVersion[],
): LineageRelation {
  throw new Error(`classifyLineage: pendiente de implementar (${local.length}, ${incoming.length})`);
}

/** Bytes que ocupa una versión serializada, para el presupuesto de crecimiento (§9). */
export function versionBytes(version: ConsolidatedVersion): number {
  return new TextEncoder().encode(JSON.stringify(version)).length;
}
