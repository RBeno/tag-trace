/**
 * Protocolo entre la interfaz y los Workers (WORKER_PROTOCOL.md).
 *
 * Las reglas que este módulo hace cumplir por construcción:
 *
 * - WP-003: todo mensaje lleva `jobId` y `protocolVersion`. Un mensaje de un trabajo caducado se
 *   descarta sin tocar el estado.
 * - WP-005: cero filas aceptadas es una respuesta legítima y llega con causa, no un síntoma que la
 *   interfaz deba corregir.
 * - WP-008: el progreso va por etapa y con unidades reales, para que nadie invente porcentajes.
 *
 * Lo que no está aquí y es igual de importante: **no existe ninguna función de análisis exportada
 * hacia la presentación**. La interfaz no puede parsear aunque quiera.
 */

import type { ActivityBand, HourlyProfile } from "../domain/activity.js";
import type { AffinityReport } from "../domain/affinity.js";
import type { QuarantinedRow, Reading } from "../domain/reading.js";
import type { SourceDirection } from "../domain/order.js";
import type { MonotonicityReport } from "../ingestion/monotonicity.js";
import type { FieldOrder } from "../domain/time.js";
import type { Delimiter } from "../ingestion/delimiter.js";

/** Cambiar el número rompe la compatibilidad y obliga a recargar la aplicación. */
export const PROTOCOL_VERSION = 1;

export type Stage = "hashing" | "sampling" | "parsing" | "ordering" | "done";

/** Códigos de error estables (WORKER_PROTOCOL §6). */
export type ImportErrorCode =
  | "SOURCE_UNREADABLE"
  | "SCHEMA_UNRECOGNISED"
  | "DELIMITER_AMBIGUOUS"
  | "DATE_AMBIGUOUS"
  | "NO_ACCEPTED_ROWS"
  | "LIMIT_EXCEEDED"
  | "INTERNAL";

export interface StartMessage {
  readonly type: "start";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly file: File;
  readonly zone: string;
  /** Si el usuario ya fijó el orden de campos, se respeta; si no, se detecta y puede fallar. */
  readonly fieldOrder?: FieldOrder;
  /**
   * Circuito en el que **acumular** esta fuente, si lo hay.
   *
   * Va el identificador y no las lecturas ya guardadas: el Worker las lee del almacén por su
   * cuenta. Mandárselas por `postMessage` las clonaría y duplicaría el pico de memoria, que es
   * exactamente el defecto P4 del prototipo.
   */
  readonly circuitId?: string;
  readonly circuitName?: string;
}

/** Lo que la acumulación en un circuito añade al resultado de una importación. */
export interface AccumulationReport {
  readonly circuitId: string;
  /** Intervalos analizables del circuito tras sumar esta fuente (R-DAT-007). */
  readonly coverage: readonly { readonly from: number; readonly to: number }[];
  /** Lecturas del circuito entero, ya unidas. */
  readonly totalReadings: number;
  /** Fuentes acumuladas en el circuito. */
  readonly sources: number;
  /** Eventos que esta fuente ya traía otra: se cuentan una vez y conservan las dos procedencias. */
  readonly shared: number;
  /** Eventos del tramo común que solo una de las dos trae. La fuente se contradice consigo misma. */
  readonly disagreements: number;
  /** Qué tan de este circuito es la fuente (FR-003, R-DAT-006). */
  readonly affinity: AffinityReport;
  /**
   * Si la fuente llegó a escribirse en el circuito.
   *
   * Es falso cuando la afinidad la señala como de otro circuito. La importación sí se hizo y sus
   * lecturas se muestran —FR-003 separa analizar de consolidar—, pero el almacén no se tocó, y las
   * cifras de este informe son las que el circuito **ya tenía**, no las que tendría con la fuente.
   */
  readonly accumulated: boolean;
}

export interface CancelMessage {
  readonly type: "cancel";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly reason: string;
}

/**
 * Cargar las listas de tags de un circuito.
 *
 * Va por el Worker aunque el fichero sea pequeño, y no por comodidad: la presentación no tiene
 * forma de alcanzar `ingestion/` (WP-001/WP-002), y esa imposibilidad es lo que impide que alguien
 * añada «una comprobación rápida» en el hilo principal el día que haga falta.
 */
export interface LoadListsMessage {
  readonly type: "lists";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly file: File;
  readonly circuitId: string;
  /** Cuándo se extrajo de planta, si el usuario lo sabe. Sin fecha no se sabe qué periodo juzga. */
  readonly extractedAt?: number;
}

export interface ListsLoadedMessage extends Envelope {
  readonly type: "lists-loaded";
  readonly circuitId: string;
  readonly lists: readonly { readonly list: string; readonly tags: number }[];
  readonly accepted: number;
  readonly rejected: number;
  readonly warnings: readonly string[];
  readonly unknownLists: readonly string[];
}

export type ToWorker = StartMessage | CancelMessage | LoadListsMessage;

interface Envelope {
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly seq: number;
}

export interface AcceptedMessage extends Envelope {
  readonly type: "accepted";
  readonly stages: readonly Stage[];
}

export interface ProgressMessage extends Envelope {
  readonly type: "progress";
  readonly stage: Stage;
  readonly done: number;
  readonly total: number;
  readonly note: string;
}

/** Lo que la interfaz necesita para explicar la fuente sin volver a leerla. */
export interface SourceSummary {
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly delimiter: Delimiter;
  readonly delimiterConfidence: number;
  readonly fieldOrder: FieldOrder;
  readonly fieldOrderEvidence: string;
  readonly zone: string;
  /** Codificación con la que se decodificó el fichero, o `desconocida` si nadie la declaró. */
  readonly encoding: string;
  readonly header: readonly string[];
  readonly monotonicity: MonotonicityReport;
  readonly direction: SourceDirection;
  /**
   * Pares de lecturas consecutivas **del mismo vehículo** que comparten instante (R-DAT-013).
   *
   * Su orden no lo da el reloj sino la posición en la pila, así que es `inferred` y una arista
   * construida sobre ellos no sostiene topología. Es distinto de `monotonicity.tiedPairs`, que
   * cuenta el fichero entero con todos los vehículos mezclados.
   */
  readonly sameInstantPairs: number;
  /** Pares consecutivos del mismo vehículo en total, que es contra lo que se lee el anterior. */
  readonly vehiclePairs: number;
  readonly totalRows: number;
  readonly acceptedRows: number;
  /** Solo filas con un defecto real. Las que no son lecturas van aparte, no aquí. */
  readonly quarantinedRows: number;
  /** Filas con instante y AGV pero sin tag: no son lecturas y tampoco son un defecto. */
  readonly rowsWithoutTag: number;
  readonly dstFlagged: number;
  /**
   * Primer y último instante **aceptado**, en epoch UTC.
   *
   * No se llama cobertura a propósito. La cobertura de R-DAT-007 es la unión de los intervalos de
   * todas las fuentes de un circuito y excluye el último minuto incompleto de una exportación; aquí
   * solo hay una fuente y no hay circuito todavía. Esto es lo que se ha observado, ni más ni menos.
   */
  readonly observedFrom: number;
  readonly observedTo: number;
  readonly elapsedMs: number;
}

/**
 * Los agregados que alimentan las vistas.
 *
 * Viajan ya calculados porque recorrer las lecturas para contarlas es trabajo, y el hilo principal
 * no hace trabajo (WP-001). Son unos cientos de números frente a las cientos de miles de lecturas
 * que los produjeron.
 */
export interface CircuitViews {
  readonly hourly: HourlyProfile;
  readonly activity: ActivityBand;
  /** Solo cuando el circuito tiene listas de planta cargadas: sin ellas no hay con qué contrastar. */
  readonly inventory?: {
    readonly counts: readonly { readonly tagClass: string; readonly count: number; readonly truth: string; readonly action: string }[];
    readonly listsLoaded: readonly string[];
  };
}

export interface CompleteMessage extends Envelope {
  readonly type: "complete";
  readonly summary: SourceSummary;
  readonly readings: readonly Reading[];
  readonly quarantine: readonly QuarantinedRow[];
  readonly warnings: readonly string[];
  /** Presente solo si la importación se acumuló en un circuito. */
  readonly accumulation?: AccumulationReport;
  /** Vistas del conjunto analizado. Ausente si no hubo nada que agregar. */
  readonly views?: CircuitViews;
}

export interface ErrorMessage extends Envelope {
  readonly type: "error";
  readonly code: ImportErrorCode;
  /** Causa legible. Nunca contiene una fila entera sin recortar (TH-003). */
  readonly cause: string;
  readonly detectedSchema?: readonly string[];
  readonly sampleRows?: readonly string[];
  readonly recovery: string;
}

export interface CancelledMessage extends Envelope {
  readonly type: "cancelled";
  readonly stage: Stage;
}

export type FromWorker =
  | AcceptedMessage
  | ProgressMessage
  | CompleteMessage
  | ErrorMessage
  | CancelledMessage
  | ListsLoadedMessage;

/**
 * `Omit` sobre una unión colapsa a las claves comunes y pierde el discriminante. Distribuyendo
 * sobre cada miembro se conserva la unión, que es lo que el emisor del Worker necesita para que
 * `type: "error"` siga admitiendo `code` y `type: "progress"` siga admitiendo `stage`.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Lo que el Worker compone; el sobre común lo añade el emisor. */
export type OutgoingPayload = DistributiveOmit<FromWorker, "protocolVersion" | "jobId" | "seq">;

/**
 * Filtro de mensajes caducados (WP-003).
 *
 * El prototipo no tenía esto, y por eso un `complete` tardío de un trabajo anterior podía pisar el
 * estado del trabajo en curso.
 */
export function isCurrent(message: FromWorker, expectedJobId: string): boolean {
  return message.protocolVersion === PROTOCOL_VERSION && message.jobId === expectedJobId;
}
