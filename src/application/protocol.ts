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
import type { FleetTimeline } from "../domain/fleet.js";
import type { Blockage, ProductionStop } from "../domain/flow-stops.js";
import type { CircuitState } from "../domain/circuit-state.js";
import type { DeliveryConcentration, GroupedDelivery } from "../domain/grouped-delivery.js";
import type { FranjaCohort, SegmentHistory } from "../domain/franjas.js";
import type { StructureSet } from "../domain/anchor-sums.js";
import type { PaceReport } from "../domain/vehicle-pace.js";
import type { Band, PeriodBandChanges, RegimeExposure } from "../domain/segment-bands.js";
import type { AffinityReport } from "../domain/affinity.js";
import type { AgvDossier, TagDossier } from "../domain/dossier.js";
import type { ReadMatrix } from "../domain/read-matrix.js";
import type { TagChangeReport } from "../domain/tag-changes.js";
import type { VehicleReadingReport } from "../domain/vehicle-reading.js";
import type { VehicleReplayState } from "../domain/replay.js";
import type { VsystemComparisonRow } from "../domain/vsystem.js";
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

/** Cargar el historial de flota de un circuito (DS-012). */
export interface LoadFleetMessage {
  readonly type: "fleet";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly file: File;
  readonly circuitId: string;
  /** El valor de la columna `circuito` elegido, cuando el fichero trae varios. */
  readonly circuitName?: string;
}

export interface FleetLoadedMessage extends Envelope {
  readonly type: "fleet-loaded";
  readonly circuitId: string;
  readonly circuitName: string | null;
  readonly accepted: number;
  readonly rejected: readonly { readonly reason: string; readonly rows: number }[];
  /** Periodos nuevos y periodos que sustituyeron a uno guardado con el mismo AGV y la misma fecha de alta. */
  readonly added: number;
  readonly replaced: number;
  /** Periodos que quedan guardados tras la fusión. */
  readonly periods: number;
  readonly warnings: readonly string[];
}

/** El fichero trae varios circuitos y ninguno está elegido todavía: hay que preguntar cuál es este. */
export interface FleetChooseCircuitMessage extends Envelope {
  readonly type: "fleet-choose-circuit";
  readonly circuitId: string;
  readonly options: readonly { readonly name: string; readonly rows: number }[];
}

export type ToWorker = StartMessage | CancelMessage | LoadListsMessage | LoadFleetMessage;

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
  /** Grupos detectados por aristas exclusivas (R-DAT-012). Uno solo si no hay circuitos mezclados. */
  readonly cohorts: readonly { readonly id: number; readonly vehicles: readonly string[] }[];
  /**
   * Composición del circuito de cada cohorte: **cuántos tags lo forman y en qué orden**.
   *
   * Sale del ciclo dominante, así que el orden es `inferred` —sucesor mayoritario, no trazado
   * medido— y un cohorte sin ciclo limpio no aparece aquí en lugar de aparecer con un orden
   * inventado.
   */
  readonly shapes: readonly {
    readonly cohortId: number;
    readonly vehicles: number;
    readonly tags: readonly string[];
    readonly anchorTagId: string;
    /**
     * `"observed"` cuando el ancla es una de las declaradas en la lista `ancla` (R-GRA-009) y
     * apareció en el ciclo reconstruido; `"inferred"` cuando es el ciclo dominante sin más.
     */
    readonly anchorTruth: "observed" | "inferred";
    readonly weakestShare: number;
    /**
     * Tags leídos por el cohorte que **no** están en el anillo.
     *
     * O son ramas que solo algunos recorren, o son tags de la línea que se leen tan poco que el
     * sucesor dominante los saltó. Se enumeran porque el segundo caso es justamente el más
     * sospechoso, y callarlo lo haría invisible por ser sospechoso.
     */
    readonly offRingTags: readonly { readonly tagId: string; readonly readers: number }[];
    /** Zona declarada de cada tag del anillo, en el mismo orden que `tags`. Solo con la lista `zona`. */
    readonly zones?: readonly (string | null)[];
    /**
     * De qué tag del anillo cuelga cada calle de carga, observado en el dato (la lista no lo dice).
     * Solo con la lista `carga-online`; una calle sin entradas desde el anillo no aparece.
     */
    readonly laneJunctions?: readonly { readonly laneId: string; readonly tagId: string; readonly served: boolean }[];
  }[];
  /** Tasa de lectura por tag y vehículo, normalizada por pasada (R-OPP-010). Nunca es salud. */
  readonly readMatrices: readonly ReadMatrix[];
  /**
   * Lectura de cada AGV sobre los tags que el resto lee bien, por cohorte (R-AGV-016): nunca, desde
   * una hora, poco. La diferencia medida, sin causa.
   */
  readonly vehicleReading: readonly (VehicleReadingReport & { readonly cohortId: number })[];
  /** Cambios de tag dentro de un mismo periodo cubierto (R-DAT-019) y la diferencia de cada AGV frente al nuevo. */
  readonly tagChanges: Pick<TagChangeReport, "changes" | "adoption">;
  /** Expediente reducido por AGV: búsqueda por identificador (UX_SPEC §4.1). Sin tasa de salud. */
  readonly agvDossiers: readonly AgvDossier[];
  /** Expediente reducido por tag. */
  readonly tagDossiers: readonly TagDossier[];
  /** Solo si el circuito tiene la lista `circuito` cargada con orden: sin ella no hay con qué alinear. */
  readonly vsystemContrast?: readonly VsystemComparisonRow[];
  /** Fotogramas del replay, en fracción temporal — nunca posición física (`PERFORMANCE_BUDGET.md` §6). */
  readonly replay: readonly SerializedReplayFrame[];
  /**
   * Calles de carga online. Solo cuando el circuito tiene la lista `carga-online` cargada.
   *
   * Lleva los recuentos y los casos notables y, desde la Parte 38, también las estancias una a una
   * (`stayList`): son las que dibujan los carriles de ocupación. Cuatro campos por estancia y unas
   * pocas por vehículo y día — cientos de números, no las lecturas otra vez (WP-001).
   */
  readonly charging?: {
    readonly lanes: readonly {
      readonly laneId: string;
      readonly capacity: number | null;
      readonly served: boolean;
      readonly stays: number;
      readonly stayList: readonly {
        readonly agvId: string;
        /** `null` si entró antes de la cobertura: no se sabe cuándo (R-CO-007). */
        readonly enteredUtcMs: number | null;
        /** `null` si seguía dentro al terminar la cobertura. */
        readonly leftUtcMs: number | null;
        readonly state: "completa" | "abierta-al-inicio" | "abierta-al-final" | "incompleta";
      }[];
      readonly medianStayMs: number | null;
      readonly longStays: readonly { readonly agvId: string; readonly durationMs: number | null }[];
      readonly outOfSeniority: readonly {
        readonly waited: string;
        readonly overtakenBy: readonly string[];
        readonly waitedMs: number;
      }[];
    }[];
    /** Los que ya estaban dentro antes de empezar la cobertura (R-CO-007). */
    readonly startedInside: readonly {
      readonly agvId: string;
      readonly laneId: string;
      readonly leftUtcMs: number | null;
    }[];
    readonly coverageStartUtcMs: number | null;
    /** Vehículos sin ninguna estancia en ninguna calle declarada: nada se dice de su batería (R-CO-004). */
    readonly neverCharged: readonly {
      readonly agvId: string;
      readonly firstUtcMs: number;
      readonly lastUtcMs: number;
      readonly readings: number;
    }[];
    /** Calles y zonas declaradas que no se pudieron montar, con su motivo. */
    readonly problems: readonly string[];
  };
  /** Zonas declaradas y cuántos tags tiene cada una. Solo con la lista `zona` cargada. */
  readonly zones?: readonly { readonly zone: string; readonly tags: number }[];
  /**
   * Pasadas que R-FLO-006 retiró de la vía de orden, sumadas sobre los cohortes.
   *
   * Se publica para que el cambio de criterio sea visible: sin la cifra, un análisis repetido tras
   * cargar las zonas daría menos pasadas sin que nada explicara por qué.
   */
  readonly orderWithheld: number;
  /**
   * FIFO en zona cargada (R-FLO-001), por cohorte: los tramos derivados del anillo y quién adelantó
   * a quién dentro de cada uno. Solo con la lista `zona` cargada. Nunca es una avería confirmada:
   * OQ-107 no tiene el catálogo de excepciones legítimas, así que lo que sale son candidatos.
   */
  readonly fifo?: readonly {
    readonly cohortId: number;
    readonly spans: readonly {
      readonly spanId: string;
      readonly entryTagId: string;
      readonly exitTagId: string;
      readonly tagCount: number;
      readonly passes: number;
      readonly medianTransitMs: number | null;
      readonly evaluated: boolean;
      readonly overtakes: readonly {
        readonly overtaken: string;
        readonly overtakenBy: readonly string[];
        readonly transitMs: number;
        readonly marginMs: number;
      }[];
      /** Pasadas completas alrededor del adelantamiento con más vehículos por delante, en orden de entrada. */
      readonly focus: readonly {
        readonly agvId: string;
        readonly enteredUtcMs: number;
        readonly leftUtcMs: number;
      }[];
    }[];
    readonly problems: readonly string[];
  }[];
  /**
   * Candidatos a punto crítico (R-GRA-007), por cohorte. No necesita ninguna lista cargada: solo
   * las transiciones que ya hacen falta para `shapes`/`readMatrices`.
   *
   * Firma estadística, nunca función asignada: la función de un tag crítico es dato de planta
   * declarado, no se deduce del fichero. Cuatro clases con firma: bifurcación, cruce (una
   * bifurcación cuyas ramas reconvergen), parada precisa y semáforo.
   */
  readonly criticalPoints: readonly {
    readonly cohortId: number;
    readonly candidates: readonly {
      readonly tagId: string;
      readonly kind: "bifurcacion" | "cruce" | "parada-precisa" | "semaforo";
      readonly evidence: string;
      /** Presentes en `bifurcacion` y `cruce`. */
      readonly support?: number;
      readonly branches?: readonly { readonly tagId: string; readonly support: number; readonly share: number }[];
      /** Presentes solo en `cruce`. */
      readonly reconvergesAt?: string;
      readonly hops?: number;
      /** Presentes en `parada-precisa` y `semaforo`. */
      readonly samples?: number;
      /** Presente solo en `parada-precisa`. */
      readonly meanDurationMs?: number;
      readonly coefficientOfVariation?: number;
      /** Presentes solo en `semaforo`. */
      readonly lowClusterMeanMs?: number;
      readonly highClusterMeanMs?: number;
      /** Presente en `parada-precisa` y `semaforo`: las duraciones que la firma resume, para dibujarlas. */
      readonly durationsMs?: readonly number[];
    }[];
    /**
     * Referencia para esas distribuciones: duraciones de todas las transiciones del cohorte, sin
     * pares del mismo instante (R-DAT-013), en muestra de paso fijo si pasan del tope.
     */
    readonly referenceDurationsMs: readonly number[];
    /** De cuántas duraciones sale la muestra de referencia. */
    readonly referenceTotal: number;
  }[];
  /** Por qué una fila de la lista `critico` no se pudo usar. Solo con la lista `critico` cargada. */
  readonly criticalPointsProblems?: readonly string[];
  /**
   * Por qué un ancla declarada no se pudo usar (R-GRA-009): repetida en la lista `ancla`, o
   * ninguna de las declaradas apareció en el ciclo reconstruido de algún cohorte. Global, no por
   * cohorte: la lista `ancla` es de circuito completo.
   */
  readonly lapAnchorProblems?: readonly string[];
  /**
   * La flota del circuito a lo largo del tiempo (DS-012, R-AGV-014): la vida de cada AGV en tramos
   * continuos y el recuento N de M. Sin historial cargado, M son los vehículos que aparecen en las
   * lecturas, y `historyLoaded` lo dice.
   */
  readonly fleet: FleetTimeline & {
    readonly circuitName: string | null;
    /**
     * Cuándo estuvo parada la producción y cómo salió cada AGV de cada parada (R-AGV-018): cuántos
     * siguieron por su sitio, quién no, y si se mantuvo el orden a lo largo del anillo.
     */
    readonly production: {
      readonly basis: "criticos" | "flota";
      readonly basisTags: number;
      readonly stops: readonly (ProductionStop & {
        readonly vehicles: number;
        readonly inPlace: number;
        readonly notInPlace: readonly {
          readonly agvId: string;
          readonly fromTagId: string;
          readonly toTagId: string;
          readonly skipped: number | null;
        }[];
        readonly orderKept: boolean | null;
        readonly orderChanges: readonly { readonly agvId: string; readonly passed: string }[];
      })[];
    };
    /** El primero de una cola sin avanzar, sin nada que lo explique (R-AGV-018). */
    readonly blockages: readonly Blockage[];
  };
  /**
   * El estado normal del circuito (R-TIM-009): la horquilla de cada tramo por régimen y lo que se
   * mide con ella en producción —cuellos de botella, puntos conflictivos, zonas oscuras, paradas sin
   * explicación—, la noche aparte y el cambio de la horquilla entre el primer y el último periodo.
   */
  readonly circuitState: {
    readonly exposure: RegimeExposure;
    readonly night: { readonly fromHour: number; readonly toHour: number };
    readonly cohorts: readonly {
      readonly cohortId: number;
      /** El ritmo de cada AGV frente a la flota y quién retiene a otros (R-AGV-019, R-AGV-020). */
      readonly pace: PaceReport;
      readonly resolutionMs: number;
      readonly marginMs: number;
      /** Cada par con horquilla; `position` es su sitio en el anillo si es un tramo del anillo. */
      readonly bands: readonly {
        readonly from: string;
        readonly to: string;
        readonly position: number | null;
        readonly produccion: Band | null;
        readonly noche: Band | null;
      }[];
      readonly state: CircuitState;
      /**
       * Lecturas que llegaron juntas al servidor (R-DAT-020): cada ráfaga, ya colapsada en todo lo
       * de tiempos, y dónde se concentran. `deliveries` trae las más recientes; `total`, cuántas hubo.
       */
      readonly groupedDelivery: {
        readonly evaluated: boolean;
        readonly reason: string | null;
        readonly total: number;
        readonly deliveries: readonly GroupedDelivery[];
        readonly vehicles: readonly DeliveryConcentration[];
        readonly sites: readonly DeliveryConcentration[];
      };
      readonly changes: PeriodBandChanges | null;
    }[];
  };
  /**
   * La medición de cada fichero (R-TIM-011): una franja es un fichero. Por circuito, la horquilla de
   * cada tramo, el anillo y la posición en tiempo de cada tag en cada fichero, y los tramos que cambian
   * de un fichero a otro. Se rehace en cada importación; no se guarda una copia fija (eso es F4).
   */
  readonly franjas: {
    readonly sources: readonly {
      readonly sourceId: string;
      readonly fileName: string;
      readonly from: number;
      readonly to: number;
      /** El fichero anterior idéntico, si lo hay: no se mide dos veces. */
      readonly duplicateOf: string | null;
      readonly exposure: RegimeExposure;
    }[];
    readonly cohorts: readonly {
      readonly cohortId: number;
      /** Cada fichero, con el ritmo de cada AGV contra la horquilla de ese fichero (R-AGV-019). */
      readonly measures: readonly (FranjaCohort & { readonly sourceId: string; readonly pace: PaceReport })[];
      readonly histories: readonly SegmentHistory[];
      /**
       * Tags insertados, retirados y sustituidos, por la suma entre anclas (R-DAT-021): entre ficheros
       * seguidos, y alrededor de cada grupo de cambios de tag dentro de un tramo de cobertura.
       */
      readonly structure: readonly StructureSet[];
    }[];
  };
  /**
   * Comparación entre el primer y el último periodo cubiertos (R-DAT-016, R-AGV-013). Solo cuando
   * el circuito tiene listas de planta cargadas **y** al menos dos periodos distantes: con una sola
   * fuente cargada no hay con qué comparar, y no mostrar nada es más honesto que un aviso permanente.
   */
  readonly drift?: {
    readonly earlyPeriod: { readonly from: number; readonly to: number };
    readonly latePeriod: { readonly from: number; readonly to: number };
    readonly tagDrifts: readonly {
      readonly tagId: string;
      readonly kind: "desaparecido" | "nuevo" | "obsoleto-consolidado" | "sustitucion-candidata";
      readonly readingsBefore: number;
      readonly readingsAfter: number;
      /** Presentes solo cuando `kind === "sustitucion-candidata"` (R-DAT-017). */
      readonly nuevoTagId?: string;
      readonly sharedNeighbor?: string;
      readonly neighborSide?: "predecesor" | "sucesor";
    }[];
    readonly vehicleDrifts: readonly {
      readonly agvId: string;
      readonly droppedTags: readonly string[];
      readonly notAdoptedTags: readonly string[];
    }[];
  };
}

/** `ReplayFrame` tal como cruza el `postMessage`: el mapa de vehículos, ya como pares. */
export interface SerializedReplayFrame {
  readonly atUtcMs: number;
  readonly vehicles: readonly (readonly [string, VehicleReplayState])[];
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
  | ListsLoadedMessage
  | FleetLoadedMessage
  | FleetChooseCircuitMessage;

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
