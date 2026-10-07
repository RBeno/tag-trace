/**
 * El contrato del registro de conexiones del terminal (DS-013, ADR-0017): lo que un evento es, la
 * forma que exporta el terminal y de dónde sale el AGV. Vive en el dominio para que la presentación
 * pueda enseñar la forma y leer el AGV del nombre sin tocar la ingesta (WP-001).
 */

export type ConnectionEventKind = "desconexion" | "conexion" | "conexion-tras-apagado" | "desconocido";

export interface ConnectionEvent {
  readonly agvId: string;
  readonly utcMs: number;
  readonly kind: ConnectionEventKind;
  /** El texto original del tipo, para enseñar un `desconocido` tal cual. */
  readonly rawKind: string;
  readonly coverage: string;
  readonly ipTerminal: string;
  readonly version: string;
  /** El campo auxiliar entero, sin interpretar; `mtc` es lo único que se extrae de él. */
  readonly aux: string;
  readonly mtc: string | null;
  /** Fila física del fichero, contando la cabecera como fila 1. */
  readonly sourceRow: number;
}

/** La forma que exporta el terminal, para enseñarla antes de pedir el fichero. */
export const CONNECTION_STRUCTURE = {
  required: ["fecha", "conexion"],
  optional: ["cober.", "ver.", "ip terminal", "datos aux"],
  fileName: "CONEXIONES<agv>.xlsx",
  example: ["Linea;Fecha;Conexión;Nº Motor;Op.;Cober.;Ver.;RFID;LCD;PID;Datos Aux;Cimi;IP Terminal", "Unchecked;06/10/2026 7:12:03;Desconexión;2;0;0;2.00;2;17;1;MTC 0 MTD 0; ...;10.0.0.1"],
} as const;

/** El AGV que lleva el nombre del fichero: `CONEXIONES1553.xlsx`, `conexiones_0040.csv`, `Conexiones 395 (1).xlsx`. */
export function agvFromFileName(fileName: string): string | null {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const match = /^conexion(?:es)?[\s_-]*([0-9A-Za-z]+)/i.exec(base.normalize("NFD").replace(/[̀-ͯ]/g, ""));
  if (match === null) return null;
  const id = match[1] as string;
  // El identificador se conserva tal cual: `0040` no es 40 (R-DAT-001).
  return id === "" ? null : id;
}

