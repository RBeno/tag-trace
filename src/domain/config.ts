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
import type { AnchorSumThresholds } from "./anchor-sums.js";
import type { PaceThresholds } from "./vehicle-pace.js";
import type { CircuitStateThresholds } from "./circuit-state.js";
import type { BandThresholds, RegimeThresholds } from "./segment-bands.js";
import type { BlindnessThresholds } from "./inventory.js";
import type { ChargingThresholds } from "./charging.js";
import type { CriticalPointThresholds } from "./critical-points.js";
import type { DriftThresholds } from "./drift.js";
import type { FifoThresholds } from "./fifo.js";
import type { FlowStopThresholds } from "./flow-stops.js";
import type { FranjaThresholds } from "./franjas.js";
import type { GraphThresholds } from "./graph.js";
import type { GroupedDeliveryThresholds } from "./grouped-delivery.js";
import type { ReadRateThresholds } from "./read-matrix.js";
import type { SilenceKindThresholds } from "./silence-kind.js";
import type { TrendThresholds } from "./read-rate-trend.js";
import type { TagChangeThresholds } from "./tag-changes.js";
import type { VehicleReadingThresholds } from "./vehicle-reading.js";

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
  readonly vehicleReading: VehicleReadingThresholds;
  readonly tagChanges: TagChangeThresholds;
  readonly silenceKind: SilenceKindThresholds;
  readonly flowStops: FlowStopThresholds;
  readonly regimes: RegimeThresholds;
  readonly bands: BandThresholds;
  readonly circuitState: CircuitStateThresholds;
  readonly groupedDelivery: GroupedDeliveryThresholds;
  readonly franjas: FranjaThresholds;
  readonly anchorSums: AnchorSumThresholds;
  readonly pace: PaceThresholds;
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
 *   **Cruce, parada precisa y semáforo, ampliación (R-GRA-007).** Tres saltos para dar por
 *   reconvergidas dos ramas separa con margen el cruce del escenario sintético (reconverge en 1
 *   salto) de la bifurcación sin reconvergencia que también planta (cadena de 6, muy por encima).
 *   Para parada precisa, el jitter normal del propio generador ya produce un coeficiente de
 *   variación en torno a 0,16 solo por el paso aleatorio; 0,1 queda claramente por debajo, y una
 *   parada añadida de magnitud fija lo baja hasta ~0,04. Semáforo reproduce la misma separación para
 *   dos regímenes: 0,25 de compacidad por grupo y un salto de 3x entre ellos. `minClusterSamples`
 *   reutiliza la razón de `minStaysForMedian`/`minPassesForSpan` (cuatro es lo mínimo para que un
 *   grupo no lo decida un solo vehículo); `minSamples` de semáforo reutiliza literalmente el valor y
 *   la razón de `TrendThresholds.minPassesForTrend` (por debajo, un corte encontrado es casualidad).
 * - **Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013).** `minReadingsPerVehicle`
 *   reutiliza literalmente el valor ya elegido para `blindness`: es el mismo concepto —un vehículo
 *   con pocas lecturas no informa de nada— aplicado ahora dentro de cada periodo en vez de en toda la
 *   ventana. `minGapMs` es una magnitud claramente del escenario sintético (media hora, para que un
 *   fixture de 30 h la pueda ejercitar sin un segundo fichero): en planta, «distante» son días o
 *   semanas —el hueco real de 38 días de PC2 que motivó esta pieza—, y ese valor no se fija aquí ni
 *   se supone. `minAdoptionShare` (sustitución candidata y adopción de tag nuevo, R-DAT-017) es
 *   deliberadamente el mismo número que `readRate.highRate`: la misma idea de «lo lee casi todo el
 *   mundo», aplicada aquí a cuántos vehículos adoptan un tag en vez de a cuántas veces se lee.
 * - **Lectura por AGV (R-AGV-016).** Ocho pasadas sin leer para decir «desde tal hora» («nunca» ya no
 *   las exige desde la Parte 48: cero lecturas cuenta en cuanto no es casualidad frente al resto):
 *   que un AGV que lee un tag la mitad de las veces falle ocho seguidas por azar es un 0,4 %. Un tag
 *   cuenta contra un AGV solo si tres de cada cuatro del resto lo leen bien. «Muchos tags» es el 10 %
 *   de los que recorre y como mínimo cinco, decisión del propietario (2026-09-24). «Lee poco» exige
 *   además menos de un 0,1 % de que sea casualidad frente a lo que lee el resto en ese tag, el mismo
 *   listón que los cambios de tag: sin él, un tag que la flota lee al 85 % deja a varios AGV en el
 *   76 % solo por azar, y así salió en la propia auditoría.
 * - **Cambios de tag dentro de un periodo (R-DAT-019).** Diez pasadas por el sitio fuera de la vida
 *   del tag, y que esa racha sin leer tenga menos de un 0,1 % de ser casualidad dada su tasa: un tag
 *   que se lee una de cada cinco veces necesita más de treinta seguidas. Dos lecturas entre los dos
 *   vecinos admiten el propio tag y uno más al lado. Una hora de solape admite poner el nuevo antes
 *   de quitar el viejo; más que eso ya no es una sustitución, son dos tags que conviven.
 * - **Cómo reaparece un AGV (R-AGV-017).** Tres veces lo habitual de un tramo en su turno es lo que
 *   empieza a ser una parada: por debajo, es el ritmo de ese tramo (una estación de trabajo que
 *   siempre tarda). Una hora para «desconexión» y turnos de 8 h (06–14, 14–22, 22–06) son decisión
 *   del propietario (2026-09-24), no medidas de planta: las horas reales de relevo siguen abiertas
 *   (OQ-108) y se cambian aquí.
 * - **Paradas contra el flujo (R-AGV-018).** Dos minutos del primero de la cola sin avanzar, y dos
 *   minutos sin lecturas críticas para hablar de producción parada, son del propietario (2026-09-24).
 *   Treinta segundos por encima de lo habitual es lo mínimo para llamar parada a una transición: una
 *   cola que fluye avanza cada ~40 s y no debe dejar cabezas de dos minutos. Dos tags por delante es
 *   hasta dónde cuenta como «el de delante»: en cola, los AGV se quedan en el mismo tag o en el de al
 *   lado. Una centésima de parada falsa por turno es el margen de azar: con dos tags críticos, un hueco
 *   de tres minutos sale decenas de veces en 30 h por pura casualidad. Quince minutos de margen para
 *   decir que una parada se repite a la misma hora. Cuatro veces un paso, como las cuatro estancias de
 *   las calles, para darlo por habitual al salir de una parada de la producción.
 * - **Estado normal del circuito (R-TIM-009, R-FLO-007/008/009, R-GRA-014).** La noche de 22:00 a
 *   05:00 es del propietario (2026-09-24), como los turnos, y se cambia aquí hasta que el calendario
 *   del circuito exista (OQ-108). Veinte muestras para una horquilla, la misma razón que
 *   `trend.minPassesForTrend`: con menos, un p95 es una anécdota. `flowStops.minStopExcessMs` pasa a
 *   ser el margen mínimo de la valla sobre el p95: un tramo muy regular no convierte en parada un par
 *   de segundos de más, y con él el ejemplo del propietario (17 s y hasta 30 s) da una valla de 60 s.
 *   Zona oscura a 1,5 veces el hueco típico del circuito: perder un tag alarga el hueco un 100 %, y el
 *   jitter normal de un tramo ronda el 16 %; 1,5 queda entre los dos. Una centésima de punto marcado
 *   por azar en todo el circuito, la misma idea que `flowStops.maxFalseStops`.
 * - **Lecturas que llegaron juntas (R-DAT-020).** La hora del fichero es la de llegada al servidor
 *   (propietario, 2026-09-25). Dos pasos casi seguidos tras un hueco, como mínimo, para hablar de
 *   ráfaga: con uno solo, un tag muy cerca del siguiente tras una espera real ya lo imitaría. Lo que es
 *   «imposible de rápido» no es un número nuevo: es `readRate.minTimeRatio`, el mismo 0,6 que ya dice
 *   que un tramo recorrido en menos de ese tanto de lo normal no se recorrió circulando.
 * - **Medición por fichero y posición en tiempo (R-TIM-011).** Cuatro pasos para dar la mediana de un
 *   paso al situar un tag, la misma razón que las cuatro estancias de carga: con menos, la mediana la
 *   decide un solo vehículo. Es menos que las veinte de una horquilla a propósito: una mediana se
 *   sostiene con pocas muestras y un p95 no, y un fichero corto, justo después de cambiar un tag, tiene
 *   que poder situarlo. Para saltar un tag sin medir se reutiliza `tagChanges.maxReadsBetween`.
 * - **Suma entre anclas (R-DAT-021).** Cinco pasadas en cada lado para comparar la suma entre dos
 *   anclas: una más que las cuatro de una mediana, porque aquí se compara además el 80 %. La ausencia
 *   de un tag no necesita ese mínimo —se prueba con el mismo 0,1 % de azar que los cambios de tag
 *   (`tagChanges.maxChance`)—, y así un fichero corto justo después de un mantenimiento ya enseña qué
 *   tags cambiaron, aunque diga que la suma todavía no se puede medir.
 * - **Ritmo de cada AGV (R-AGV-019).** Un 5 % de diferencia con el de la flota, como mínimo, además de
 *   la prueba de signo: con miles de transiciones un 1 % sale significativo y no le dice nada a nadie en
 *   planta, y un 5 % es un AGV que pierde una vuelta de cada veinte. Las muestras mínimas son las de una
 *   horquilla (`bands.minBandSamples`), el azar el de los sitios del circuito (`circuitState.maxFalsePoints`)
 *   y, para quien retiene, los AGV distintos de un contraste (`readRate.minVehiclesForContrast`).
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
    cruce: { maxHopsToReconverge: 3 },
    paradaPrecisa: { minDurationMs: 30_000, maxCv: 0.1, minSamples: 4 },
    semaforo: { minGapRatio: 3, maxWithinClusterCv: 0.25, minClusterSamples: 4, minSamples: 20 },
  },
  drift: { minGapMs: 30 * 60_000, minReadingsPerVehicle: 10, minAdoptionShare: 0.8 },
  vehicleReading: { minPassesForNever: 8, fleetReadsWellShare: 0.75, manyTagsShare: 0.1, minManyTags: 5, maxChance: 0.001 },
  tagChanges: { minSlotPasses: 10, maxChance: 0.001, maxReadsBetween: 2, maxOverlapMs: 60 * 60_000 },
  silenceKind: { factorOverUsual: 3, longAbsenceMs: 60 * 60_000, shiftStartHours: [6, 14, 22] },
  flowStops: {
    headStallMs: 2 * 60_000,
    minProductionStopMs: 2 * 60_000,
    minStopExcessMs: 30_000,
    reachTags: 2,
    maxFalseStops: 0.01,
    sameTimeToleranceMs: 15 * 60_000,
    minPairSamples: 4,
  },
  regimes: { nightFromHour: 22, nightToHour: 5 },
  bands: { minBandSamples: 20 },
  circuitState: { darkZoneFactor: 1.5, maxFalsePoints: 0.01 },
  groupedDelivery: { minFastSteps: 2 },
  franjas: { minPositionSamples: 4 },
  anchorSums: { minAnchorPasses: 5 },
  pace: { minPaceShift: 0.05 },
};

/** Qué decirle al usuario sobre la configuración aplicada. Nunca se calla. */
export function describeConfig(config: AnalysisConfig): string {
  return config.state === "draft"
    ? `provisional (${config.configVersion}): los umbrales no los ha fijado planta todavía, así que ` +
        "sirven para explorar y no para consolidar"
    : `${config.configVersion} (${config.state})`;
}
