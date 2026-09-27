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
import type { SnapshotDelta } from "../domain/snapshot.js";
import type { ConsolidatedVersion, ConsolidationPreview, LineageRelation, MemoryComparison } from "../domain/memory.js";
import type {
  EdgeSummary,
  LocationSummary,
  PhysicalPlan,
  PlanEvent,
  PlanEventInput,
  PlanObservation,
  PlanProposal,
} from "../domain/plan.js";
import type { Interval } from "../domain/coverage.js";
import type { PaceReport } from "../domain/vehicle-pace.js";
import type { Band, PeriodBandChanges, RegimeExposure } from "../domain/segment-bands.js";
import type { AnchorSection } from "../domain/anchor-sections.js";
import type { AffinityReport } from "../domain/affinity.js";
import type { UndeclaredTag } from "../domain/undeclared-tags.js";
import type { ListCleanup } from "../domain/list-cleanup.js";
import type { LineFeed } from "../domain/line-feed.js";
import type { Incident, IncidentBattery, IncidentRecord } from "../domain/incident-battery.js";
import type { CircuitOrder } from "../domain/circuit-order.js";
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
  /**
   * Lecturas de la **ventana de trabajo**, ya unidas: las de las fuentes retenidas (R-DAT-023). Hasta
   * 3.49.0 eran todas las del circuito; ahora las de los ficheros anteriores quedan como instantánea.
   */
  readonly totalReadings: number;
  /** Fuentes acumuladas en el circuito, contando cada carga (un fichero repetido cuenta, INV-005). */
  readonly sources: number;
  /**
   * Qué fuentes conservan sus lecturas (ADR-0015 §2): las dos últimas cargadas, se solapen o no
   * (OQ-143). Lo que el expediente y el replay alcanzan es exactamente esto, y la vista lo dice.
   */
  readonly retained: {
    readonly sourceIds: readonly string[];
    /** Fuentes distintas del circuito (sin repetidos): el «M» de «lecturas retenidas: N ficheros de M». */
    readonly distinctSources: number;
  };
  /**
   * Cuántas fuentes distintas tienen instantánea y cuántas no. Sin instantánea quedan las anteriores a
   * la versión 6 del almacén y las que el análisis no pudo construir; volver a cargar el fichero la crea.
   */
  readonly snapshots: {
    readonly withSnapshot: number;
    readonly withoutSnapshot: number;
  };
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

/**
 * Consolidar un periodo (F4; `MEMORY_CONSOLIDATION.md` §6). `mode: "preview"` devuelve qué pasaría
 * sin escribir nada; `mode: "commit"` escribe vN+1 y solo se envía tras la confirmación humana. El
 * Worker no decide consolidar: ejecuta lo que la persona confirmó (R-MEM-001).
 */
export interface ConsolidateMessage {
  readonly type: "consolidate";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly circuitId: string;
  /** El fichero cuya instantánea se consolida. */
  readonly sourceId: string;
  readonly mode: "preview" | "commit";
  /** Justificación humana, solo en `commit`. */
  readonly note?: string;
}

/** Revocar una versión: no la borra, la marca con fecha y razón (§7). */
export interface RevokeMessage {
  readonly type: "revoke";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly circuitId: string;
  readonly version: number;
  readonly reason: string;
}

/**
 * Resolver una bifurcación de linaje (§10): conservar la memoria local o adoptar la entrante. El
 * linaje que no se elige queda archivado, nunca borrado; la elección y su razón quedan en el historial.
 */
export interface ResolveForkMessage {
  readonly type: "resolve-fork";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly circuitId: string;
  readonly choice: "conservar-local" | "adoptar-entrante";
  readonly reason: string;
}

/**
 * Un cambio del plano físico (ADR-0016). Todos los escribe una persona: crear el plano desde una
 * versión consolidada, aceptar una propuesta del Worker (que la vuelve a calcular desde el almacén
 * antes de escribirla, sin fiarse de la que tiene la interfaz) o registrar un evento a mano —una
 * salida, una revisión, una retirada—. La razón es obligatoria.
 */
export type PlanAction =
  | { readonly kind: "crear-plano"; readonly fromVersion: number; readonly reason: string }
  | {
      readonly kind: "aceptar-propuesta";
      readonly proposalId: string;
      /** El fichero de cuya observación salió la propuesta: el Worker la recalcula desde su instantánea. */
      readonly sourceId: string;
      readonly reason: string;
      /** Solo en `salida-sin-ubicar`: la ubicación del anillo de la que cuelga la salida. */
      readonly branchFrom?: string;
    }
  | { readonly kind: "evento"; readonly event: PlanEventInput; readonly reason: string };

export interface PlanActionMessage {
  readonly type: "plan-action";
  readonly protocolVersion: number;
  readonly jobId: string;
  readonly circuitId: string;
  readonly action: PlanAction;
  /** El fichero de trabajo que la interfaz enseña: la respuesta trae el plano leído contra él. */
  readonly workingSourceId: string | null;
}

export type ToWorker =
  | PlanActionMessage
  | StartMessage
  | CancelMessage
  | LoadListsMessage
  | LoadFleetMessage
  | ConsolidateMessage
  | RevokeMessage
  | ResolveForkMessage;

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
  /** Lecturas que al parsear cayeron en una hora repetida o inexistente del cambio estacional. */
  readonly dstFlagged: number;
  /**
   * De las de hora repetida, cuántas se resolvieron por la posición en el fichero (`dst_by_position`,
   * OQ-137) y cuentan como fiables para el orden.
   */
  readonly dstResolvedByPosition: number;
  /** De las de hora repetida, cuántas siguen `dst_ambiguous` y no afirman orden. */
  readonly dstAmbiguous: number;
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
  /**
   * Lo que las listas declaran de cada tag —nota, función, calle—, para enseñarlo junto a cualquier
   * incidencia de ese tag. Información, no regla: no cambia ningún cálculo.
   */
  readonly tagInfo?: Readonly<Record<string, string>>;
  /** El tramo declarado de cada tag (kitting, línea, cruce…), para las gráficas del anillo. */
  readonly sections?: Readonly<Record<string, string>>;
  /** Solo si el circuito tiene la lista `circuito` cargada con orden: sin ella no hay con qué alinear. */
  readonly vsystemContrast?: readonly VsystemComparisonRow[];
  /** Tags que se leen y no están en la lista `circuito`: dónde y cuándo se leen (R-DAT-022). */
  readonly undeclaredTags?: readonly UndeclaredTag[];
  /** El orden del circuito según las lecturas, contrastado tag a tag con la lista (R-GRA-015). */
  readonly circuitOrder?: CircuitOrder;
  /**
   * Limpieza de la lista (R-GRA-017): declarados que no están en el físico, en otra posición, y los
   * refuerzos declarados contra el recorrido. Solo con el orden del circuito evaluado.
   */
  readonly listCleanup?: ListCleanup;
  /**
   * Alimentación de la línea (R-FLO-010): cadencia en la entrada, pulmón medido y paradas de la
   * línea, con AGV esperando o sin ellos. Solo con la lista `linea` cargada.
   */
  readonly lineFeed?: LineFeed;
  /**
   * La batería de mediciones de cada incidencia (R-AGV-021), por clave «AGV tag instante»: paradas sin
   * explicación y primeros de cola sin avanzar. Y los AGV que dejan de leer antes del final.
   */
  readonly incidents?: {
    readonly batteries: Readonly<Record<string, IncidentBattery>>;
    readonly abandoned: readonly { readonly incident: Incident; readonly battery: IncidentBattery }[];
    /** Todas, en orden de tiempo, para descargarlas. */
    readonly records: readonly IncidentRecord[];
  };
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
      /** Por tag de la calle, en cuántas estancias completas se leyó (R-CO-009). */
      readonly tagReads: readonly {
        readonly tagId: string;
        readonly role: "entrada" | "parada-precisa" | "salida" | "paso";
        readonly staysRead: number;
        readonly stays: number;
        readonly vehicles: number;
      }[];
    }[];
    /** El reparto de estancias entre las calles servidas (R-CO-009). */
    readonly usage: readonly {
      readonly laneId: string;
      readonly stays: number;
      readonly share: number;
      readonly expectedShare: number;
      readonly chance: number;
      readonly verdict: "menos" | "mas" | null;
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
    /** `false` con la hora al minuto: no se buscan paradas precisas ni semáforos, y se dice. */
    readonly timeSignatures: boolean;
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
   * Tiempos por sección entre anclas (R-TIM-012), en el cohorte principal: todas las anclas de la
   * lista `ancla` que están en el anillo, en el orden del anillo, delimitan secciones consecutivas y
   * cada una lleva su horquilla por régimen y su p50 por fichero. `sections` va vacío con menos de dos
   * anclas en el anillo; `declared` dice cuántas hay en la lista, para explicar por qué.
   */
  readonly anchorSections: {
    readonly declared: number;
    readonly onRing: readonly string[];
    readonly resolutionMs: number;
    readonly marginMs: number;
    readonly sections: readonly AnchorSection[];
  };
  /**
   * La flota del circuito a lo largo del tiempo (DS-012, R-AGV-014): la vida de cada AGV en tramos
   * continuos y el recuento N de M. Sin historial cargado, M son los vehículos que aparecen en las
   * lecturas, y `historyLoaded` y `historySource` lo dicen (un historial cargado sin periodos válidos
   * es «historial vacío», OQ-139).
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
   * Las instantáneas del circuito (ADR-0015): una por fuente distinta, en orden de ventana, y qué
   * cambió de cada una a la siguiente. Las que no la tienen aparecen igual, con `hasSnapshot: false`
   * —un fichero anterior a la versión 6 del almacén, o uno cuya instantánea no pudo construirse—.
   */
  readonly snapshots: {
    readonly list: readonly {
      readonly sourceId: string;
      readonly fileName: string;
      readonly window: Interval;
      /** Cuándo se tomó la instantánea; sin ella, cuándo se cargó el fichero. */
      readonly capturedAt: number;
      readonly retained: boolean;
      readonly hasSnapshot: boolean;
    }[];
    /** Entre instantáneas consecutivas (`compareSnapshots`). */
    readonly deltas: readonly SnapshotDelta[];
    /**
     * Por qué falta alguna instantánea o comparación, en palabras: nunca se calla (R-EVI-006). Vacío
     * cuando todo se pudo construir.
     */
    readonly problems: readonly string[];
  };
  /**
   * La memoria consolidada del circuito (F4). Ausente si el circuito no tiene versiones; con
   * `current: null` si todas están revocadas. `comparison` es lo observado (la instantánea del
   * fichero de trabajo) frente a la versión vigente, o `null` si no hay vigente o falta instantánea.
   */
  readonly memory?: MemoryViews;
  /**
   * El plano físico del circuito (ADR-0016). Ausente si el circuito no tiene plano ni versión
   * consolidada desde la que crearlo.
   */
  readonly plan?: PlanViews;
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
      /**
       * Solo en `desaparecido` y `nuevo` (OQ-138): si la ausencia es improbable por azar dadas las
       * pasadas por su sitio en el otro periodo. Sin afirmar se enseña igual, con su cifra.
       */
      readonly affirmed?: boolean;
      readonly chance?: number;
      readonly opportunities?: number;
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

/** Resumen de una versión consolidada, sin el grafo: lo que la lista de versiones necesita. */
export interface VersionSummary {
  readonly version: number;
  readonly createdAt: number;
  readonly basedOnFileName: string;
  readonly basedOnSourceId: string;
  readonly window: { readonly from: number; readonly to: number };
  readonly decisions: { readonly confirmed: number; readonly discarded: number; readonly postponed: number };
  readonly note: string | null;
  readonly revoked: { readonly at: number; readonly reason: string } | null;
  readonly hash: string;
  readonly bytes: number;
}

export interface MemoryViews {
  readonly versions: readonly VersionSummary[];
  /** Número de la versión vigente (última no revocada) o `null`. */
  readonly current: number | null;
  readonly comparison: MemoryComparison | null;
  /** Bytes que ocupan todas las versiones guardadas, revocadas incluidas (§9), sin comprimir. */
  readonly budgetBytes: number;
  /** Lo mismo tal como está guardado, comprimido (OQ-145). Ausente si el almacén no lo sabe. */
  readonly storedBytes?: number;
  /** Bytes del archivo de ficheros originales comprimidos del circuito (OQ-145). */
  readonly archiveBytes?: number;
  /** Relación con la memoria que traía el último `.agvproj` abierto, si hubo (§10). */
  readonly lineage: LineageRelation | null;
  /** Bifurcación sin resolver: los dos linajes, para que la persona elija. `null` si no la hay. */
  readonly fork: { readonly local: readonly VersionSummary[]; readonly incoming: readonly VersionSummary[] } | null;
  /** Las elecciones de linaje registradas (§10), la más reciente al final. */
  readonly lineageEvents: readonly {
    readonly at: number;
    readonly choice: "conservar-local" | "adoptar-entrante";
    readonly reason: string;
    /** Elección hecha en otro dispositivo, llegada con un `.agvproj` (OQ-144). */
    readonly origin?: "otro-dispositivo";
  }[];
}

/** El plano físico tal como lo enseña la interfaz: todo ya calculado en el Worker. */
export interface PlanViews {
  /** El plano vigente ahora, o `null` si todavía no hay. */
  readonly current: PhysicalPlan | null;
  /** Si no hay plano y hay versión vigente: desde cuál se puede crear. */
  readonly canBootstrap: { readonly version: number; readonly fileName: string } | null;
  /** Los eventos registrados, del primero al último, con su línea en palabras. */
  readonly events: readonly (PlanEvent & { readonly text: string })[];
  /** El fichero de trabajo leído contra el plano vigente al final de su ventana. */
  readonly observation: PlanObservation | null;
  /** Las observaciones de todas las instantáneas sumadas por ubicación y conexión. */
  readonly summary: { readonly locations: readonly LocationSummary[]; readonly edges: readonly EdgeSummary[] } | null;
  /** Cambios que el Worker propone con su evidencia; ninguno está escrito. */
  readonly proposals: readonly PlanProposal[];
}

export interface PlanUpdatedMessage extends Envelope {
  readonly type: "plan-updated";
  readonly circuitId: string;
  /** Qué evento o eventos se escribieron, en palabras. */
  readonly written: readonly string[];
  readonly plan: PlanViews;
}

/** Respuesta a `consolidate` en modo `preview`: nada se ha escrito. */
export interface ConsolidationPreviewMessage extends Envelope {
  readonly type: "consolidation-preview";
  readonly circuitId: string;
  readonly preview: ConsolidationPreview;
}

/** Respuesta a `consolidate` en modo `commit`: la versión ya está en el almacén. */
export interface ConsolidatedMessage extends Envelope {
  readonly type: "consolidated";
  readonly circuitId: string;
  readonly version: ConsolidatedVersion;
  readonly memory: MemoryViews;
}

export interface RevokedMessage extends Envelope {
  readonly type: "revoked";
  readonly circuitId: string;
  readonly version: number;
  readonly memory: MemoryViews;
}

export interface ForkResolvedMessage extends Envelope {
  readonly type: "fork-resolved";
  readonly circuitId: string;
  readonly memory: MemoryViews;
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
  | FleetChooseCircuitMessage
  | ConsolidationPreviewMessage
  | ConsolidatedMessage
  | RevokedMessage
  | ForkResolvedMessage
  | PlanUpdatedMessage;

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
