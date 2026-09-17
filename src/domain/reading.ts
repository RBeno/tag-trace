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

/**
 * Por qué una fila no llegó a ser lectura. Los códigos son estables.
 *
 * `NO_TAG` no es un defecto y por eso está separado del resto: la fila trae instante y AGV pero no
 * trae tag. Una fuente que mezcla eventos de vehículo con lecturas produce muchas así, y contarlas
 * como filas defectuosas dice que el 40 % del fichero está roto cuando no lo está. Qué significan
 * esos eventos es una regla de dominio que el importador no conoce y no debe suponer.
 */
export type RejectionCode =
  | "FIELD_COUNT"
  | "EMPTY_FIELD"
  | "DATE_UNPARSEABLE"
  | "DATE_INVALID"
  | "NO_TAG";

/** Las filas que sí son un defecto de la fuente. `NO_TAG` queda fuera a propósito. */
export function isDefect(code: RejectionCode): boolean {
  return code !== "NO_TAG";
}

/** Una fila rechazada se conserva: no se descarta en silencio. */
export interface QuarantinedRow {
  readonly provenance: Provenance;
  readonly code: RejectionCode;
  /** Texto original de la fila, recortado. Nunca se registra en consola (TH-003). */
  readonly rawExcerpt: string;
}
