/**
 * Contrato mínimo de lecturas (DATA_CONTRACTS §3).
 *
 * Los identificadores son texto sin excepción: `0040` no es 40. Toda observación arrastra su
 * procedencia hasta la fila del fichero, para que cualquier cifra de la interfaz pueda abrirse.
 */

import type { CanonicalTime } from "./time.js";

/** De dónde salió una fila, con el detalle suficiente para volver a ella. */
export interface Provenance {
  /** Identidad del lote importado. */
  readonly sourceId: string;
  /** Hash del fichero completo. */
  readonly sourceHash: string;
  /** Fila física original, contando la cabecera como fila 1. */
  readonly sourceRow: number;
}

/** Una lectura aceptada. Su estado de verdad es siempre `observed`. */
export interface Reading {
  readonly time: CanonicalTime;
  readonly agvId: string;
  readonly tagId: string;
  readonly provenance: Provenance;
}

/** Por qué una fila no llegó a ser lectura. Los códigos son estables. */
export type RejectionCode =
  | "FIELD_COUNT"
  | "EMPTY_FIELD"
  | "DATE_UNPARSEABLE"
  | "DATE_INVALID";

/** Una fila rechazada se conserva: no se descarta en silencio. */
export interface QuarantinedRow {
  readonly provenance: Provenance;
  readonly code: RejectionCode;
  /** Texto original de la fila, recortado. Nunca se registra en consola (TH-003). */
  readonly rawExcerpt: string;
}
