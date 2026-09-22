/**
 * Configuración de análisis del circuito (`CONFIG_SCHEMA.md`, FR-030).
 *
 * Existe porque `AI_DEVELOPMENT_GOVERNANCE.md` §4 prohíbe que una magnitud industrial viva en el
 * código, y porque los módulos de dominio —afinidad, inventario, grafo— se escribieron **sin
 * valores por defecto** justamente para que nadie pudiera llamarlos sin decidir antes. Este fichero
 * es el único sitio donde esos valores se escriben, y ninguno de ellos está aprobado por planta.
 *
 * **Provisional no es un adorno del comentario: viaja con el análisis.** `state: "draft"` llega
 * hasta la interfaz y se muestra junto a cualquier cifra que dependa de él, de modo que nadie
 * confunda «el programa lo calculó» con «alguien decidió este umbral». Cuando el propietario fije
 * los valores, la configuración pasa a `active` con su vigencia y el mismo análisis, repetido, dirá
 * con cuál se hizo (FR-031).
 */

import type { AffinityThresholds } from "./affinity.js";
import type { BlindnessThresholds } from "./inventory.js";
import type { ChargingThresholds } from "./charging.js";
import type { CriticalPointThresholds } from "./critical-points.js";
import type { DriftThresholds } from "./drift.js";
import type { FifoThresholds } from "./fifo.js";
import type { GraphThresholds } from "./graph.js";
import type { ReadRateThresholds } from "./read-matrix.js";
import type { TrendThresholds } from "./read-rate-trend.js";

export interface SilenceThresholds {
  /**
   * Separación entre dos lecturas del mismo vehículo por encima de la cual cuenta como inactividad
   * (expediente de AGV) o como silencio en vez de tránsito (replay). Es el mismo concepto en los
   * dos sitios —"cuánto hay que esperar para que un hueco signifique algo"—, así que comparte un
   * único valor en vez de duplicarlo con otro nombre.
   */
  readonly minGapMs: number;
}

export interface AnalysisConfig {
  /**
   * `draft` permite explorar y **no** permite consolidar (`CONFIG_SCHEMA.md` §4).
   *
   * Es la diferencia entre mirar un resultado y fijarlo como memoria del circuito.
   */
  readonly state: "draft" | "active" | "superseded";
  /** Identidad de esta configuración, que se registra con cada análisis (FR-031). */
  readonly configVersion: string;
  readonly affinity: AffinityThresholds;
  readonly blindness: BlindnessThresholds;
  readonly graph: Omit<GraphThresholds, "resolutionMs">;
  readonly silence: SilenceThresholds;
  readonly readRate: ReadRateThresholds;
  readonly charging: ChargingThresholds;
  readonly trend: TrendThresholds;
  readonly fifo: FifoThresholds;
  readonly criticalPoints: CriticalPointThresholds;
  readonly drift: DriftThresholds;
}

/**
 * Los valores con los que el producto funciona hasta que planta fije los suyos.
 *
 * Cada uno lleva su razón, porque un número sin motivo es indistinguible de uno inventado:
 *
 * - **Afinidad.** Dos exportaciones del mismo circuito comparten casi todos los tags; el contraste
 *   de PC2 contra sus listas dio un 90,8 % de alineación con cuatro errores de lista de por medio.
 *   Por debajo de un 20 % de solape, lo que queda no es una ampliación: es otro sitio.
 * - **Ceguera.** Diez lecturas es lo mínimo para que el silencio de un vehículo sobre un tag no sea
 *   simplemente que apenas circuló. Es una cota grosera y lo seguirá siendo hasta que existan las
 *   vueltas, que es la normalización correcta (R-OPP-010).
 * - **Grafo.** Una cuota del 90 % sobre tres pasadas distingue un sucesor dominante de un reparto;
 *   por encima de la mitad de pares en el mismo instante, el orden no lo da el reloj (R-DAT-013).
 * - **Silencio.** Cinco minutos es una magnitud de piloto tomada de un caso ya documentado
 *   (`ALGORITHM_CATALOG.md` §4.2), no la duración real de ningún descanso ni parada de un circuito
 *   concreto — esas son configuración de planta y no se fijan aquí (R-TIM-005). Sirve para no
 *   confundir el tiempo normal de tránsito (segundos) con un hueco que merece explicarse.
 * - **Tasa de lectura.** Tres pasadas es lo mínimo para que una celda no sea anécdota, y dos
 *   vehículos lo mínimo para que exista contraste. El 0,8 y el 0,2 separan «lo lee» de «no lo lee»
 *   dejando en medio una franja ancha que sale como **gradiente**, que es `unknown` a propósito
 *   (OQ-118): estrechar esa franja convertiría en bimodal lo que todavía no se sabe qué es.
 *   Un solo tag sin leer entre dos lecturas se da por recorrido sin más comprobación; en cuanto
 *   faltan varios seguidos hay que mirar el tiempo, y el 0,6 admite que un tramo se recorra algo
 *   más rápido de lo normal sin admitir que se recorra en la mitad, que ya es la firma de no
 *   haberlo recorrido.
 * - **Carga online.** El doble de la mediana **de su propia calle** es lo que empieza a ser una
 *   permanencia fuera de lo normal: relativo y no en minutos porque el tiempo de carga depende de
 *   la calle y de cuánto haya que cargar (R-FLO-004), y ningún minutaje de planta se fija aquí.
 *   Cuatro estancias es lo mínimo para que esa mediana no la decida un solo vehículo.
 * - **Rotura y degradación (R-OPP-015).** Veinte pasadas mínimas para buscar algo, con cinco a cada
 *   lado de cualquier corte candidato **o el 15 % de la línea, lo que sea mayor**: con líneas largas
 *   un puñado de pasadas es ruido de borde, no una regla que se sostenga sobre una fracción real de
 *   la ventana. El 0,5 de caída mínima para llamarlo rotura es deliberadamente exigente — el caso de
 *   manual es 100 % → 0 %, y un umbral bajo cazaría fluctuaciones normales de un tag con ruido; el
 *   0,3 para degradación es más laxo porque ahí la señal es la forma sostenida en cuatro tramos, no
 *   un salto único. Los mismos umbrales sirven para AGV que para tags: la línea temporal es la misma
 *   idea, solo cambia qué se agrupa.
 * - **FIFO en zona cargada (R-FLO-001).** Cuatro pasadas mínimas para el tránsito mediano de un
 *   tramo, mismo razonamiento que las cuatro estancias de carga online: menos que eso y la mediana
 *   la decide un solo vehículo. El margen de adelantamiento es doble a propósito — tres minutos en
 *   absoluto, muy por encima del jitter normal de lectura, **o** el 15 % del tránsito mediano del
 *   propio tramo, lo que sea mayor (R-FLO-004: cuánto tarda un tramo cargado es local, no una
 *   constante universal). El 0,15 es deliberadamente el mismo número que `minShareEachSide`: las dos
 *   son la misma idea, una fracción real de la magnitud medida y no solo un conteo absoluto.
 * - **Candidatos a punto crítico (R-GRA-007).** Una cuota del 30 % por rama descarta un sucesor
 *   dominante con una excepción rara (95/5 no es reparto); cinco pasadas mínimas por rama, uno más
 *   que las cuatro estancias de carga online, descarta un 50/50 sostenido por un puñado de pasadas.
 *   Las dos guardas se exigen a la vez, mismo principio dual que el margen de FIFO y que
 *   `GraphThresholds.minShareForObserved`/`minSupportForObserved`. El 15 % en cada mitad de la
 *   ventana —mismo número que `minShareEachSide`/`minOvertakeMarginRatio`, la misma idea de fracción
 *   real y no solo un conteo— descarta el caso encontrado en la propia auditoría: un tag justo antes
 *   de una rotura súbita aguas abajo parece bifurcado porque casi todas sus salidas van al sucesor de
 *   siempre antes de la rotura y al que lo sustituye después, sin que exista ningún reparto estable.
 * - **Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013).** `minReadingsPerVehicle`
 *   reutiliza literalmente el valor ya elegido para `blindness`: es el mismo concepto —un vehículo
 *   con pocas lecturas no informa de nada— aplicado ahora dentro de cada periodo en vez de en toda la
 *   ventana. `minGapMs` es una magnitud claramente del escenario sintético (media hora, para que un
 *   fixture de 30 h la pueda ejercitar sin un segundo fichero): en planta, «distante» son días o
 *   semanas —el hueco real de 38 días de PC2 que motivó esta pieza—, y ese valor no se fija aquí ni
 *   se supone.
 */
export const PROVISIONAL_CONFIG: AnalysisConfig = {
  state: "draft",
  configVersion: "provisional-0",
  affinity: { compatible: 0.6, foreign: 0.2, minTagsToJudge: 5 },
  blindness: { minReadingsPerVehicle: 10, minReadersForContrast: 2 },
  graph: { minShareForObserved: 0.9, minSupportForObserved: 3, maxSameInstantShare: 0.5 },
  silence: { minGapMs: 5 * 60_000 },
  readRate: {
    minPassesPerPair: 3,
    minVehiclesForContrast: 2,
    highRate: 0.8,
    lowRate: 0.2,
    maxGapProvenByNeighbours: 1,
    minTimeRatio: 0.6,
  },
  charging: { longStayRatio: 2, minStaysForMedian: 4 },
  trend: {
    minPassesForTrend: 20,
    minRateDrop: 0.5,
    minPassesEachSide: 5,
    minShareEachSide: 0.15,
    trendSegments: 4,
    minGradientDrop: 0.3,
  },
  fifo: { minPassesForSpan: 4, minOvertakeMarginMs: 3 * 60_000, minOvertakeMarginRatio: 0.15 },
  criticalPoints: {
    bifurcacion: { minBranchShare: 0.3, minBranchSupport: 5, minBranchShareEachHalf: 0.15 },
  },
  drift: { minGapMs: 30 * 60_000, minReadingsPerVehicle: 10 },
};

/** Qué decirle al usuario sobre la configuración aplicada. Nunca se calla. */
export function describeConfig(config: AnalysisConfig): string {
  return config.state === "draft"
    ? `provisional (${config.configVersion}): los umbrales no los ha fijado planta todavía, así que ` +
        "sirven para explorar y no para consolidar"
    : `${config.configVersion} (${config.state})`;
}
