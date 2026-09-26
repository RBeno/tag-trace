/**
 * Auditoría del producto contra un circuito con la verdad conocida.
 *
 * No comprueba una función: comprueba **cuánto de lo que puede ir mal en un circuito real llega a
 * decirse**. Por cada clase de fallo plantada se mide si el producto la detecta, y por cada tag sano
 * se mide si lo señala sin motivo. El resultado es un informe por clase, y ese informe —no esta
 * prueba— es el entregable: dice qué construir después.
 *
 * Tres aserciones, y la tercera es la que impide que esto envejezca:
 *
 * 1. **Cero falsos positivos.** Señalar un tag sano es peor que no señalar uno enfermo: es lo que
 *    hace que nadie vuelva a mirar la herramienta.
 * 2. **Regresión**: lo que hoy se detecta tiene que seguir detectándose.
 * 3. **La deuda no se pudre en ninguna dirección**: las clases que hoy no se detectan están
 *    enumeradas, y si una empieza a detectarse la prueba **falla** pidiendo que se saque de la
 *    lista. Una lista de deuda que no se actualiza sola acaba mintiendo igual que un `TODO`.
 */

import { describe, expect, it } from "vitest";

import { buildAuditScenario, toRealUtc, type DefectClass } from "../support/circuito-auditoria.js";
import { importReadings } from "../../src/ingestion/importer.js";
import { buildTransitions } from "../../src/domain/graph.js";
import { assignCohorts } from "../../src/domain/cohort.js";
import { dominantNeighbours, locateUndeclaredTags, type UndeclaredTagReport } from "../../src/domain/undeclared-tags.js";
import { reconcileCircuitOrder, type CircuitOrder } from "../../src/domain/circuit-order.js";
import { compareAgainstVsystem, type VsystemComparisonRow } from "../../src/domain/vsystem.js";
import { findDominantCycle, resolveDeclaredAnchor, segmentLaps, type Lap } from "../../src/domain/laps.js";
import { buildReadMatrix, type ReadMatrix } from "../../src/domain/read-matrix.js";
import { buildTagInventory } from "../../src/domain/inventory.js";
import { reinforcementGroups, reinforcementPartners } from "../../src/domain/critical-reinforcement.js";
import { buildListCleanup } from "../../src/domain/list-cleanup.js";
import { lineStopExclusion, measureLineFeed, outsideLineStops, type LineFeed } from "../../src/domain/line-feed.js";
import { abandonedReadings, buildIncidentContext, incidentBattery, type IncidentContext } from "../../src/domain/incident-battery.js";
import { buildAllAgvDossiers, buildAllTagDossiers } from "../../src/domain/dossier.js";
import { buildChargingReport, type ChargingReport } from "../../src/domain/charging.js";
import { buildFifoReport, loadedZoneSpans, type FifoReport } from "../../src/domain/fifo.js";
import {
  classifyCrossings,
  findBifurcationCandidates,
  findPrecisePauseCandidates,
  findTrafficLightCandidates,
  type CriticalPointCandidate,
} from "../../src/domain/critical-points.js";
import { compareDistantPeriods, type DriftComparison } from "../../src/domain/drift.js";
import { detectTagChanges, withoutTags, type TagChangeReport } from "../../src/domain/tag-changes.js";
import { describeVehicleReading, type VehicleReadingReport } from "../../src/domain/vehicle-reading.js";
import { classifySilence, usualSegmentTimes, type SilenceClass } from "../../src/domain/silence-kind.js";
import {
  flowStops,
  outsideProductionStops,
  productionStops,
  type FlowReport,
  type ProductionStopReport,
} from "../../src/domain/flow-stops.js";
import {
  laneEntryTags,
  readCoLanes,
  readCriticalPoints,
  readLapAnchors,
  readZones,
} from "../../src/domain/circuit-config.js";
import { importCatalog } from "../../src/ingestion/catalog.js";
import {
  buildSegmentBands,
  measurableTransitions,
  pairKey,
  regimeReader,
  transitionRegime,
  type Regime,
  type SegmentBands,
} from "../../src/domain/segment-bands.js";
import { buildCircuitState, type CircuitState } from "../../src/domain/circuit-state.js";
import { measureFranjaCohort, type FranjaCohort } from "../../src/domain/franjas.js";
import type { Interval } from "../../src/domain/coverage.js";
import { paceInWindow, vehiclePace, type PaceReport, type VehiclePaceThresholds } from "../../src/domain/vehicle-pace.js";
import {
  anchorSequences,
  compareAnchorGaps,
  structureBoundaries,
  windowsAroundChanges,
  type AnchorGapChange,
  type AnchorSumContext,
} from "../../src/domain/anchor-sums.js";
import {
  collapseGroupedDeliveries,
  summarizeDeliveries,
  type DeliverySummary,
  type GroupedDeliveryReport,
} from "../../src/domain/grouped-delivery.js";
import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";

/**
 * Clases que hoy **no** se detectan, con el motivo.
 *
 * No es una excusa: es el resultado de la auditoría, escrito donde se puede comprobar. Se saca de
 * aquí en cuanto el detector exista, y la prueba avisa si alguien lo implementa y se olvida.
 *
 * Vacía desde R-OPP-015: rotura súbita y degradación progresiva —las dos únicas que había— ya se
 * detectan. Se deja el tipo declarado, y no se borra el mapa, porque la próxima clase de deuda que
 * aparezca tiene que caer en la misma estructura, no reinventarla.
 */
const DEUDA_CONOCIDA: ReadonlyMap<DefectClass, string> = new Map([]);

/**
 * Plazo por prueba.
 *
 * Una auditoría no es una unitaria: genera un cuarto de millón de lecturas y las hace pasar por el
 * encadenado entero, y dos veces cuando hay que contrastar con configuración y sin ella. El plazo
 * por defecto de Vitest está pensado para comprobar una función, y aquí solo serviría para que la
 * prueba fallara por lenta en vez de por falsa.
 */
const PLAZO = 120_000;

/** Deshace `stamp()` del generador (`dd/mm/aaaa H:MM:SS`), para comprobaciones cruzadas por fecha. */
function parseStamp(value: string): number {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (match === null) throw new Error(`fecha inesperada en el CSV generado: ${value}`);
  const [, day, month, year, hour, minute, second] = match as unknown as [
    string, string, string, string, string, string, string,
  ];
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

interface Analysis {
  /** Contraste con la lista y el orden según las lecturas (R-GRA-001, R-GRA-015). */
  readonly contrast: readonly VsystemComparisonRow[];
  readonly circuitOrder: CircuitOrder;
  readonly matrix: ReadMatrix | undefined;
  readonly ring: readonly string[];
  readonly offRing: readonly string[];
  readonly inventory: ReturnType<typeof buildTagInventory>;
  readonly charging: ChargingReport;
  readonly coLanes: ReturnType<typeof readCoLanes>["lanes"];
  readonly fifo: FifoReport | undefined;
  readonly criticalPoints: readonly CriticalPointCandidate[];
  readonly dossiers: ReturnType<typeof buildAllAgvDossiers>;
  /** Expedientes de tag (Parte 36): trae la función crítica declarada, venga de la fuente que venga. */
  readonly tagDossiers: ReturnType<typeof buildAllTagDossiers>;
  /** El ancla efectiva del cohorte principal, y las vueltas segmentadas con esa verdad (R-GRA-009). */
  readonly laps: readonly Lap[];
  readonly anchorTagId: string | undefined;
  readonly anchorTruth: "observed" | "inferred" | undefined;
  /** Comparación entre el primer y el último periodo, construidos a mano a partir del escenario. */
  readonly drift: DriftComparison;
  /** Cambios de tag dentro de **un solo** periodo, el de la ventana entera (R-DAT-019). */
  readonly tagChanges: TagChangeReport;
  /** Lectura de cada AGV sobre los tags que el resto lee bien (R-AGV-016). */
  readonly vehicleReading: VehicleReadingReport;
  /** Cuándo estuvo parada la producción, y las paradas de cada AGV leídas contra el flujo (R-AGV-018). */
  readonly production: ProductionStopReport;
  readonly flow: FlowReport;
  /** La horquilla de cada tramo por régimen, y el estado normal medido con ella (R-TIM-009). */
  readonly bands: SegmentBands | null;
  readonly circuitState: CircuitState | null;
  readonly regimeOf: (utcMs: number) => Regime;
  /** Cómo reapareció cada AGV tras cada hueco sin carga (R-AGV-017), por vehículo. */
  readonly silences: ReadonlyMap<
    string,
    readonly (SilenceClass & {
      readonly fromUtcMs: number;
      readonly toUtcMs: number;
      readonly justification: "produccion" | "cola" | "sin-explicacion" | null;
    })[]
  >;
  /**
   * La medición de dos ficheros (R-TIM-011): el temprano y el tardío, a una hora del corte, como si se
   * hubieran exportado por separado. Mismas transiciones limpias que el Worker.
   */
  readonly franjas: readonly (FranjaCohort & { readonly sourceId: string })[];
  /**
   * Cambios de estructura por la suma entre anclas (R-DAT-021): entre los dos ficheros, y dentro de la
   * ventana entera como una sola exportación, alrededor de cada cambio de tag y de cada borde de lectura.
   */
  readonly structure: {
    readonly entreFicheros: readonly AnchorGapChange[];
    readonly dentroDelFichero: readonly AnchorGapChange[];
  };
  /** Ritmo de cada AGV y quién retiene, en toda la ventana y en cada fichero (R-AGV-019, R-AGV-020). */
  readonly pace: PaceReport | null;
  readonly franjaPace: readonly PaceReport[];
  /** Lecturas que llegaron juntas al servidor, y dónde se concentran (R-DAT-020). */
  readonly groupedDelivery: GroupedDeliveryReport;
  readonly deliverySummary: DeliverySummary;
  /** Para poder decir en el informe sobre cuánto dato se está midiendo. */
  readonly readings: number;
  /** Tags leídos fuera de la lista del circuito, con su sitio y si de noche (R-DAT-022). */
  readonly undeclared: UndeclaredTagReport;
  /** Lo mismo con el tag de noche plantado en la lista `noche` de planta: tag de noche declarado. */
  readonly undeclaredWithNightList: UndeclaredTagReport;
  /** Alimentación de la línea declarada (R-FLO-010, R-FLO-011). */
  readonly lineFeed: LineFeed;
  /** La misma medida con la entrada en un tramo limpio, para el pulmón. */
  readonly lineFeedPulmon: LineFeed;
  /** Las lecturas de cada AGV, para la batería de cada incidencia (R-AGV-021). */
  readonly incidentContext: IncidentContext;
  /** Funciones críticas declaradas y su grupo, para la limpieza de la lista (R-GRA-017). */
  readonly criticalPointsFuncionOf: ReadonlyMap<string, string>;
  readonly criticalPointsGroupOf: ReadonlyMap<string, string>;
  /** El vecino leído de cada tag de los refuerzos declarados, como en el Worker. */
  readonly reinforcementPlaces: ReturnType<typeof dominantNeighbours>;
}

/**
 * El mismo encadenado que corre el Worker, sobre el escenario generado.
 *
 * `conConfiguracion` decide si se le dan las listas de planta. Se puede ejecutar sin ellas a
 * propósito: es la única forma de comprobar que declararlas no cambia el veredicto de un tag sano,
 * que es lo que la clase `zona-vacia-declarada` vigila.
 *
 * La lista `ancla` queda **fuera** de ese apagado: decide qué tag cierra la vuelta, y cambiarlo
 * desplaza dónde `traceLaps` corta cada vehículo — un efecto real (R-GRA-009) pero ajeno a lo que
 * esta comparación aísla. Alternar el ancla a la vez que la zona contaminaría la comparación con un
 * segundo efecto que no es el que la clase declara vigilar, así que el ancla se mantiene igual en
 * las dos ejecuciones y solo la zona (y el resto de listas) se apaga.
 */
function analyse(
  scenario: ReturnType<typeof buildAuditScenario>,
  conConfiguracion = true,
): Analysis {
  const result = importReadings(
    scenario.readingsCsv,
    {
      sourceId: "auditoria",
      fileName: "auditoria.csv",
      byteSize: scenario.readingsCsv.length,
      zone: "Europe/Madrid",
      encoding: "utf-8",
    },
    { onProgress: () => undefined, isCancelled: () => false },
  );

  // La configuración se lee **por el mismo camino que el producto**: del CSV de listas, con el
  // importador de catálogo. Construirla a mano aquí probaría el dominio y no el recorrido.
  const catalog = importCatalog(scenario.listsCsv);
  const entriesOf = (name: string) =>
    conConfiguracion || name === "ancla" ? (catalog.lists.get(name) ?? []) : [];
  const laneConfig = readCoLanes(entriesOf("carga-online"));
  const zoneConfig = readZones(entriesOf("zona"));
  // La función de un tag crítico se declara en «critico», o alternativamente en la columna `funcion`
  // del circuito virtual (Parte 36) — mismo merge que hace el Worker, `critico` primero.
  const criticalPointsConfig = readCriticalPoints([
    ...entriesOf("critico"),
    ...entriesOf("circuito").filter((entry) => entry.funcion !== ""),
  ]);
  const lapAnchorsConfig = readLapAnchors(entriesOf("ancla"));

  const readings = result.readings;
  const direction = result.summary.direction;
  const { transitions } = buildTransitions(readings, direction, []);
  const cohorts = assignCohorts(readings, transitions, PROVISIONAL_CONFIG.cohorts);
  const main = cohorts.cohorts[0];
  if (main === undefined) throw new Error("La auditoría necesita al menos un cohorte.");

  const vehicleSet = new Set(main.vehicles);
  const cohortTransitions = transitions.filter((entry) => vehicleSet.has(entry.agvId));
  const inferredAnchor = findDominantCycle(cohortTransitions);

  // Mismo encadenado que el Worker (Parte 32, R-GRA-009): el ancla declarada solo rota dónde se
  // corta el ciclo ya reconstruido, y solo si aparece en él.
  let anchor = inferredAnchor;
  let anchorTruth: "observed" | "inferred" | undefined = inferredAnchor === null ? undefined : "inferred";
  if (inferredAnchor !== null && lapAnchorsConfig.anchors.length > 0) {
    const resolved = resolveDeclaredAnchor(inferredAnchor, lapAnchorsConfig.anchors);
    if (resolved !== null) {
      anchor = { tagId: resolved.tagId, cycle: resolved.cycle, weakestShare: inferredAnchor.weakestShare };
      anchorTruth = "observed";
    }
  }

  const cohortReadings = readings.filter((entry) => vehicleSet.has(entry.agvId));

  // Mismo encadenado que el Worker: la lista del circuito en su orden, sin los de calles ni
  // mantenimiento (R-DAT-022). Va antes que los cambios de tag: un tag de noche no es un cambio.
  const regimeOf = regimeReader("Europe/Madrid", PROVISIONAL_CONFIG.regimes);
  const undeclared = locateUndeclaredTags(
    readings,
    entriesOf("circuito").map((entry) => entry.tagId),
    new Set([...entriesOf("carga-online"), ...entriesOf("mantenimiento"), ...entriesOf("emergencia")].map((entry) => entry.tagId)),
    regimeOf,
    {
      minSlotPasses: PROVISIONAL_CONFIG.tagChanges.minSlotPasses,
      maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance,
      maxReadsBetween: PROVISIONAL_CONFIG.tagChanges.maxReadsBetween,
    },
  );
  const undeclaredWithNightList = locateUndeclaredTags(
    readings,
    entriesOf("circuito").map((entry) => entry.tagId),
    new Set([...entriesOf("carga-online"), ...entriesOf("mantenimiento"), ...entriesOf("emergencia")].map((entry) => entry.tagId)),
    regimeOf,
    {
      minSlotPasses: PROVISIONAL_CONFIG.tagChanges.minSlotPasses,
      maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance,
      maxReadsBetween: PROVISIONAL_CONFIG.tagChanges.maxReadsBetween,
    },
    new Set(scenario.defects.find((d) => d.kind === "tag-de-noche-declarado")?.tags.slice(1, 2) ?? []),
  );

  // Cambios de tag dentro de un solo periodo (R-DAT-019), con la ventana entera como cobertura —el
  // caso de una sola exportación—, antes que la matriz: su vida es lo que la matriz mide (R-OPP-016).
  const nightTags = new Set(undeclared.tags.filter((tag) => tag.verdict === "noche").map((tag) => tag.tagId));
  const tagChanges = withoutTags(
    detectTagChanges(
      readings,
      direction,
      [{ from: scenario.fromUtcMs, to: scenario.toUtcMs }],
      PROVISIONAL_CONFIG.tagChanges,
      {
        minPassesForNever: PROVISIONAL_CONFIG.vehicleReading.minPassesForNever,
        highRate: PROVISIONAL_CONFIG.readRate.highRate,
        minAdoptionShare: PROVISIONAL_CONFIG.drift.minAdoptionShare,
      },
    ),
    nightTags,
  );

  const laps: Lap[] =
    anchor === null
      ? []
      : [...segmentLaps(cohortReadings, direction, [], anchor.tagId, anchorTruth ?? "inferred")];

  const charging = buildChargingReport(
    readings,
    laneConfig.lanes,
    [{ from: scenario.fromUtcMs, to: scenario.toUtcMs }],
    PROVISIONAL_CONFIG.charging,
  );

  const matrix =
    anchor === null
      ? undefined
      : buildReadMatrix(
          main.id,
          cohortReadings,
          direction,
          [],
          anchor.cycle,
          anchor.tagId,
          PROVISIONAL_CONFIG.readRate,
          { zoneOf: zoneConfig.zoneOf, laneEntryTags: laneEntryTags(laneConfig.lanes) },
          PROVISIONAL_CONFIG.trend,
          tagChanges.lives,
        );
  const vehicleReading =
    matrix === undefined
      ? { vehicles: [], tags: [] }
      : describeVehicleReading(matrix, PROVISIONAL_CONFIG.readRate, PROVISIONAL_CONFIG.vehicleReading);

  const fifo =
    anchor === null
      ? undefined
      : buildFifoReport(
          main.id,
          cohortReadings,
          loadedZoneSpans(anchor.cycle, zoneConfig.zoneOf).spans,
          PROVISIONAL_CONFIG.fifo,
        );

  // Mismo encadenado que el Worker (R-AGV-018): cuándo estuvo parada la producción, y las firmas de
  // tiempo y lo habitual sin esas franjas — un descanso no mide un tramo.
  const production = productionStops(
    readings,
    new Set(criticalPointsConfig.funcionOf.keys()),
    [{ from: scenario.fromUtcMs, to: scenario.toUtcMs }],
    "Europe/Madrid",
    PROVISIONAL_CONFIG.silenceKind.shiftStartHours,
    PROVISIONAL_CONFIG.flowStops,
  );
  const laneTags = new Set(laneConfig.lanes.flatMap((lane) => [...lane.tags]));
  const window = [{ from: scenario.fromUtcMs, to: scenario.toUtcMs }];
  // Mismo encadenado que el Worker (R-FLO-010): la cola del pulmón mientras la línea está parada con
  // AGV esperando no mide ningún tramo.
  const lineExclusion = lineStopExclusion(
    measureLineFeed(
      readings,
      entriesOf("linea").map((entry) => entry.tagId),
      window,
      regimeOf,
      { minSamples: PROVISIONAL_CONFIG.bands.minBandSamples, minMarginMs: PROVISIONAL_CONFIG.flowStops.minStopExcessMs },
      new Set(),
      criticalPointsConfig.funcionOf,
      production.stops.map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs })),
    ),
  );
  // Mismo encadenado que el Worker (R-DAT-020): las lecturas que llegaron juntas se colapsan en un solo
  // recorrido antes de medir ningún tiempo, juzgadas con una horquilla previa.
  const preliminaryBands =
    anchor === null
      ? null
      : buildSegmentBands(
          measurableTransitions(outsideLineStops(outsideProductionStops(cohortTransitions, production.stops), lineExclusion), window, laneTags),
          anchor.cycle,
          regimeOf,
          PROVISIONAL_CONFIG.bands,
          PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
        );
  const groupedDelivery = collapseGroupedDeliveries(
    cohortTransitions,
    preliminaryBands,
    regimeOf,
    PROVISIONAL_CONFIG.readRate.minTimeRatio,
    laneTags,
    PROVISIONAL_CONFIG.groupedDelivery,
  );
  const cohortTimeline = groupedDelivery.transitions;
  const deliverySummary = summarizeDeliveries(
    groupedDelivery.deliveries,
    measurableTransitions(cohortTransitions, window, laneTags),
    PROVISIONAL_CONFIG.circuitState.maxFalsePoints,
  );
  const timedTransitions = outsideLineStops(outsideProductionStops(cohortTimeline, production.stops), lineExclusion);
  const productionTimed = timedTransitions.filter((transition) => transitionRegime(transition, regimeOf) === "produccion");

  const bifurcaciones = findBifurcationCandidates(cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.bifurcacion);
  const criticalPoints = [
    ...classifyCrossings(bifurcaciones, cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.cruce),
    ...findPrecisePauseCandidates(productionTimed, PROVISIONAL_CONFIG.criticalPoints.paradaPrecisa),
    ...findTrafficLightCandidates(productionTimed, PROVISIONAL_CONFIG.criticalPoints.semaforo),
  ];

  const ring = anchor?.cycle ?? [];
  const inRing = new Set(ring);
  const offRing = [...new Set(cohortReadings.map((entry) => entry.tagId))].filter(
    (tagId) => !inRing.has(tagId),
  );

  // La lista tal como se escribe, con sus erratas: es lo que carga el Worker (R-GRA-015).
  const declared = new Set(scenario.declaredList);
  const laneTagsOf = (predicate: (laneId: string) => boolean): Set<string> =>
    new Set(
      laneConfig.lanes.filter((lane) => predicate(lane.laneId)).flatMap((lane) => [...lane.tags]),
    );
  const noServidas = new Set(
    charging.lanes.filter((lane) => !lane.served).map((lane) => lane.laneId),
  );
  const inventory = buildTagInventory(
    readings,
    {
      virtual: declared,
      memory: declared,
      maintenance: new Set(),
      emergency: new Set(),
      charging: laneTagsOf(() => true),
      unservedLaneTags: laneTagsOf((laneId) => noServidas.has(laneId)),
      critical: criticalPointsConfig.funcionOf,
      // Refuerzos (R-GRA-016), sobre la lista tal como se escribe: lo mismo que hace el Worker.
      reinforcement: reinforcementPartners(
        reinforcementGroups(scenario.declaredList, criticalPointsConfig.funcionOf, criticalPointsConfig.groupOf),
      ),
    },
    PROVISIONAL_CONFIG.blindness,
  );

  const dossiers = buildAllAgvDossiers(
    readings,
    cohorts,
    laps,
    [{ from: scenario.fromUtcMs, to: scenario.toUtcMs }],
    PROVISIONAL_CONFIG.silence.minGapMs,
    laneConfig.lanes,
  );
  // Mismo encadenado que el Worker para la vida de cada AGV (R-AGV-017): lo habitual por tramo y
  // turno del cohorte principal, y la lista de mantenimiento tal como llega en el CSV.
  const usual =
    anchor === null
      ? null
      : usualSegmentTimes(timedTransitions, anchor.cycle, "Europe/Madrid", PROVISIONAL_CONFIG.silenceKind.shiftStartHours);
  const maintenanceTags = new Set(entriesOf("mantenimiento").map((entry) => entry.tagId));
  const measuredTimed = measurableTransitions(timedTransitions, window, laneTags);
  const bands =
    anchor === null
      ? null
      : buildSegmentBands(measuredTimed, anchor.cycle, regimeOf, PROVISIONAL_CONFIG.bands, PROVISIONAL_CONFIG.flowStops.minStopExcessMs);
  const flow = flowStops(
    {
      transitions: cohortTimeline,
      coverage: window,
      bands,
      regimeOf,
      production,
      laneTags,
      functionOf: criticalPointsConfig.funcionOf,
    },
    PROVISIONAL_CONFIG.flowStops,
  );
  // Mismo encadenado que el Worker: una parada precisa o un semáforo explican su espera.
  const timeCritical = new Map<string, string>();
  for (const [tagId, functionName] of criticalPointsConfig.funcionOf) {
    if (functionName === "parada-precisa" || functionName === "semaforo") timeCritical.set(tagId, functionName);
  }
  for (const candidate of criticalPoints) {
    if ((candidate.kind === "parada-precisa" || candidate.kind === "semaforo") && !timeCritical.has(candidate.tagId)) {
      timeCritical.set(candidate.tagId, candidate.kind);
    }
  }
  const circuitState =
    bands === null
      ? null
      : buildCircuitState(
          {
            bands,
            transitions: measuredTimed,
            regimeOf,
            flow,
            timeCritical,
            declaredOrder: entriesOf("circuito").map((entry) => entry.tagId),
            readTags: new Set(readings.map((entry) => entry.tagId)),
            reachTags: PROVISIONAL_CONFIG.flowStops.reachTags,
            minVehicles: PROVISIONAL_CONFIG.readRate.minVehiclesForContrast,
            headStallMs: PROVISIONAL_CONFIG.flowStops.headStallMs,
          },
          PROVISIONAL_CONFIG.circuitState,
        );
  const stopOfGap = new Map(flow.stops.map((stop) => [`${stop.agvId}\u0000${stop.fromUtcMs}`, stop]));
  const justificationOf = (agvId: string, from: number, to: number) => {
    const stop = stopOfGap.get(`${agvId}\u0000${from}`);
    if (stop !== undefined) return stop.justification;
    const stopped = production.stops.reduce(
      (sum, entry) => sum + Math.max(0, Math.min(to, entry.toUtcMs) - Math.max(from, entry.fromUtcMs)),
      0,
    );
    return stopped >= 0.5 * (to - from) ? ("produccion" as const) : null;
  };
  const silences = new Map(
    dossiers.map((dossier) => [
      dossier.agvId,
      dossier.inactivity
        .filter((gap) => gap.cause === "silencio")
        .map((gap) => ({
          fromUtcMs: gap.fromUtcMs,
          toUtcMs: gap.toUtcMs,
          justification: justificationOf(dossier.agvId, gap.fromUtcMs, gap.toUtcMs),
          ...classifySilence(
            gap,
            {
              usual: vehicleSet.has(dossier.agvId) ? usual : null,
              maintenance: maintenanceTags,
              justification: justificationOf(dossier.agvId, gap.fromUtcMs, gap.toUtcMs),
            },
            PROVISIONAL_CONFIG.silenceKind,
          ),
        })),
    ]),
  );
  const tagDossiers = buildAllTagDossiers(
    readings,
    dossiers.map((entry) => entry.agvId),
    criticalPointsConfig.funcionOf,
  );

  // Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013): la cobertura de dos tramos se
  // construye a mano a partir del corte del propio escenario, con un margen a cada lado muy por
  // encima de `minGapMs` — mismo patrón ya usado para la cobertura de `charging` más arriba, y no una
  // segunda fuente real.
  const driftBuffer = 60 * 60_000;
  const driftCoverage = [
    { from: scenario.fromUtcMs, to: scenario.periodSplitUtcMs - driftBuffer },
    { from: scenario.periodSplitUtcMs + driftBuffer, to: scenario.toUtcMs },
  ];
  const knownTags = new Set([
    ...declared,
    ...laneTagsOf(() => true),
    ...criticalPointsConfig.funcionOf.keys(),
  ]);
  const drift = compareDistantPeriods(readings, driftCoverage, knownTags, PROVISIONAL_CONFIG.drift);

  // Dos ficheros (R-TIM-011), con las mismas ventanas que la comparación entre periodos.
  const franjas =
    anchor === null
      ? []
      : driftCoverage.map((window, index) => ({
          sourceId: `f${index + 1}`,
          ...measureFranjaCohort(
            { cohortId: main.id, transitions: cohortTimeline, measured: measuredTimed, anchorTagId: anchor.tagId },
            window,
            regimeOf,
            PROVISIONAL_CONFIG.bands,
            PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
            PROVISIONAL_CONFIG.franjas,
            PROVISIONAL_CONFIG.tagChanges.maxReadsBetween,
          ),
        }));

  // Ritmo y quién retiene (R-AGV-019, R-AGV-020), como el Worker: en toda la ventana y en cada fichero.
  const paceThresholds: VehiclePaceThresholds = {
    ...PROVISIONAL_CONFIG.pace,
    minSamples: PROVISIONAL_CONFIG.bands.minBandSamples,
    maxFalsePoints: PROVISIONAL_CONFIG.circuitState.maxFalsePoints,
    minVehiclesForContrast: PROVISIONAL_CONFIG.readRate.minVehiclesForContrast,
  };
  const paceInput = { transitions: measuredTimed, regimeOf, flow, zoneOf: zoneConfig.zoneOf };
  const pace = bands === null ? null : vehiclePace({ ...paceInput, bands }, paceThresholds);
  const franjaPace = franjas.map((franja, index) =>
    paceInWindow(
      paceInput,
      driftCoverage[index] as Interval,
      franja.ring,
      PROVISIONAL_CONFIG.bands,
      PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
      paceThresholds,
    ),
  );

  // Cambios de estructura (R-DAT-021), con el mismo contexto que el Worker: ni calles, ni paradas de la
  // producción, ni noche, ni lecturas que llegaron juntas.
  const anchorContext: AnchorSumContext = {
    direction,
    coverage: window,
    laneTags,
    productionStops: production.stops.map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs })),
    regimeOf,
    deliveries: groupedDelivery.deliveries,
    maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance,
    resolutionMs: preliminaryBands?.resolutionMs ?? 1000,
  };
  const sequences = anchorSequences(cohortReadings, direction, window);
  const [ficheroTemprano, ficheroTardio] = driftCoverage as [Interval, Interval];
  const entreFicheros = compareAnchorGaps(sequences, ficheroTemprano, ficheroTardio, anchorContext, PROVISIONAL_CONFIG.anchorSums);
  const changeTimes = tagChanges.changes.flatMap((change) =>
    change.kind === "cambio" ? [change.oldLastUtcMs, change.newFirstUtcMs] : [change.kind === "deja" ? change.lastUtcMs : change.firstUtcMs],
  );
  const boundaries = structureBoundaries(sequences, window, PROVISIONAL_CONFIG.tagChanges.maxOverlapMs, nightTags);
  const dentroDelFichero = windowsAroundChanges([...changeTimes, ...boundaries], window, PROVISIONAL_CONFIG.tagChanges.maxOverlapMs).flatMap(
    (around) => compareAnchorGaps(sequences, around.before, around.after, anchorContext, PROVISIONAL_CONFIG.anchorSums),
  );

  // El contraste y el orden según las lecturas, como en el Worker (R-GRA-015).
  const declaredOrder = entriesOf("circuito").map((entry) => entry.tagId);
  const readTags = new Set(readings.map((entry) => entry.tagId));
  const contrast = compareAgainstVsystem(declaredOrder, ring, readTags);
  const toPlace = new Set([
    ...declaredOrder.filter((tagId) => readTags.has(tagId) && !inRing.has(tagId)),
    ...undeclared.tags.map((tag) => tag.tagId).filter((tagId) => !inRing.has(tagId)),
  ]);
  const circuitOrder = reconcileCircuitOrder(declaredOrder, ring, readTags, dominantNeighbours(cohortReadings, toPlace));

  return {
    contrast,
    circuitOrder,
    undeclared,
    undeclaredWithNightList,
    lineFeed: measureLineFeed(
      readings,
      entriesOf("linea").map((entry) => entry.tagId),
      [],
      regimeOf,
      { minSamples: PROVISIONAL_CONFIG.bands.minBandSamples, minMarginMs: PROVISIONAL_CONFIG.flowStops.minStopExcessMs },
      new Set(),
      criticalPointsConfig.funcionOf,
      scenario.productionStopsUtcMs.map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs })),
    ),
    // El pulmón se mide aparte, con la entrada en un tramo limpio del anillo: con la línea declarada
    // en el 59 las paradas de la producción paran a la flota en sitios distintos y no marcan un pulmón.
    incidentContext: buildIncidentContext(readings, [], () => null),
    lineFeedPulmon: measureLineFeed(
      readings,
      [scenario.physicalRing[136] as string],
      [],
      regimeOf,
      { minSamples: PROVISIONAL_CONFIG.bands.minBandSamples, minMarginMs: PROVISIONAL_CONFIG.flowStops.minStopExcessMs },
    ),
    criticalPointsFuncionOf: criticalPointsConfig.funcionOf,
    criticalPointsGroupOf: criticalPointsConfig.groupOf,
    reinforcementPlaces: dominantNeighbours(
      readings,
      new Set(
        reinforcementGroups(scenario.declaredList, criticalPointsConfig.funcionOf, criticalPointsConfig.groupOf).flatMap(
          (group) => group.tags,
        ),
      ),
    ),
    matrix,
    ring,
    offRing,
    inventory,
    charging,
    coLanes: laneConfig.lanes,
    fifo,
    criticalPoints,
    dossiers,
    tagDossiers,
    silences,
    production,
    flow,
    bands,
    circuitState,
    regimeOf,
    laps,
    anchorTagId: anchor?.tagId,
    anchorTruth,
    drift,
    tagChanges,
    vehicleReading,
    groupedDelivery,
    deliverySummary,
    franjas,
    structure: { entreFicheros, dentroDelFichero },
    pace,
    franjaPace,
    readings: readings.length,
  };
}

describe("auditoría del circuito con verdad conocida", () => {
  const scenario = buildAuditScenario();
  const analysis = analyse(scenario);
  const {
    matrix,
    ring,
    offRing,
    inventory,
    charging,
    coLanes,
    fifo,
    criticalPoints,
    dossiers,
    tagDossiers,
    silences,
    production,
    flow,
    bands,
    circuitState,
    laps,
    anchorTagId,
    anchorTruth,
    drift,
    tagChanges,
    vehicleReading,
    groupedDelivery,
    deliverySummary,
    franjas,
    structure,
    pace,
    franjaPace,
    readings,
    undeclared,
    undeclaredWithNightList,
    lineFeed,
    lineFeedPulmon,
    incidentContext,
    criticalPointsFuncionOf,
    criticalPointsGroupOf,
    reinforcementPlaces,
    contrast,
    circuitOrder,
  } = analysis;

  /**
   * El mismo análisis **sin** las listas de planta, para poder contrastar los dos.
   *
   * Se calcula una sola vez y solo si hace falta: generar y analizar el escenario son unos segundos,
   * y las sondas se ejecutan una vez por prueba.
   */
  let sinConfigCache: Analysis | null = null;
  const sinConfiguracion = (): Analysis => (sinConfigCache ??= analyse(scenario, false));

  /** Qué dice el producto de un tag, en la forma que la auditoría compara. */
  const rowOf = (tagId: string) => matrix?.tags.find((entry) => entry.tagId === tagId);
  const classOf = (tagId: string) =>
    inventory.rows.find((entry) => entry.tagId === tagId)?.tagClass;

  const detecta: Record<DefectClass, () => { ok: boolean; detail: string }> = {
    "declarado-sin-lecturas": () => {
      const tags = scenario.defects.find((d) => d.kind === "declarado-sin-lecturas")?.tags ?? [];
      const clases = tags.map(classOf);
      return {
        ok: clases.every((clase) => clase === "obsoleto-candidato"),
        detail: `clases: ${clases.join(", ")}`,
      };
    },
    "lectura-alta": () => {
      const tags = scenario.defects.find((d) => d.kind === "lectura-alta")?.tags ?? [];
      const malos = tags.filter((tag) => {
        const pattern = rowOf(tag)?.pattern;
        return pattern === "bimodal-candidato" || pattern === "uniforme-bajo";
      });
      return { ok: malos.length === 0, detail: `señalados sin motivo: ${malos.length}/${tags.length}` };
    },
    "lectura-media": () => {
      const tags = scenario.defects.find((d) => d.kind === "lectura-media")?.tags ?? [];
      const vistos = tags.filter((tag) => {
        const pattern = rowOf(tag)?.pattern;
        return pattern === "uniforme-bajo" || pattern === "gradiente";
      });
      return { ok: vistos.length >= tags.length / 2, detail: `${vistos.length}/${tags.length}` };
    },
    "omision-por-memoria": () => {
      const defect = scenario.defects.find((d) => d.kind === "omision-por-memoria");
      const tags = defect?.tags ?? [];
      const esperados = new Set(defect?.vehicles ?? []);
      const aciertos = tags.filter((tag) => {
        const row = rowOf(tag);
        if (row?.pattern !== "bimodal-candidato") return false;
        // Y además tiene que nombrar a los vehículos correctos, no a unos cualesquiera.
        return row.lowReaders.length > 0 && row.lowReaders.every((agv) => esperados.has(agv));
      });
      return { ok: aciertos.length === tags.length, detail: `${aciertos.length}/${tags.length}` };
    },
    "omision-conservando-convoy": () => {
      const defect = scenario.defects.find((d) => d.kind === "omision-conservando-convoy");
      const tags = defect?.tags ?? [];
      const saltador = (defect?.vehicles ?? [])[0] ?? "";
      // Lo que se exige no es detectarlo, sino **no acusar al tag**: el vehículo que se salta el
      // tramo no puede aparecer como prueba de que esos tags fallan.
      const acusados = tags.filter((tag) => rowOf(tag)?.lowReaders.includes(saltador) === true);
      return { ok: acusados.length === 0, detail: `tags acusados por su culpa: ${acusados.length}` };
    },
    // Las dos clases se sondean **con tolerancia real contra la verdad plantada**, no solo con la
    // presencia del campo: ahora que el detector existe (R-OPP-015), basta con encender el campo no
    // demuestra que apunte al sitio correcto.
    "rotura-subita": () => {
      const defect = scenario.defects.find((d) => d.kind === "rotura-subita");
      const tags = defect?.tags ?? [];
      const plantado = defect?.atUtcMs ?? 0;
      // Un par de vueltas de margen: el instante que se publica es el punto medio entre la última
      // pasada de antes y la primera de después, nunca el corte plantado exacto. 20 s por tag es
      // generoso frente a los 12-20 s reales del generador.
      const margenMs = 2 * ring.length * 20_000;
      const aciertos = tags.filter((tag) => {
        const row = rowOf(tag);
        return (
          typeof row?.changedAtUtcMs === "number" &&
          Math.abs(row.changedAtUtcMs - plantado) <= margenMs
        );
      });
      return {
        ok: aciertos.length === tags.length && tags.length > 0,
        detail: `con el instante dentro de margen: ${aciertos.length}/${tags.length}`,
      };
    },
    "degradacion-progresiva": () => {
      const tags = scenario.defects.find((d) => d.kind === "degradacion-progresiva")?.tags ?? [];
      const conTendencia = tags.filter((tag) => {
        const row = rowOf(tag);
        if (row?.trend !== "bajando") return false;
        const rates = row.segmentRates ?? [];
        // Estrictamente decreciente y con una caída real, no un empate declarado tendencia.
        return (
          rates.length >= 2 &&
          rates.every((rate, index) => index === 0 || rate <= (rates[index - 1] as number)) &&
          (rates[0] as number) - (rates[rates.length - 1] as number) > 0.2
        );
      });
      return {
        ok: conTendencia.length === tags.length && tags.length > 0,
        detail: `con tendencia sostenida: ${conTendencia.length}/${tags.length}`,
      };
    },
    "mantenimiento-aislado": () => {
      const tags = scenario.defects.find((d) => d.kind === "mantenimiento-aislado")?.tags ?? [];
      const fuera = tags.filter((tag) => offRing.includes(tag));
      return { ok: fuera.length === tags.length, detail: `fuera del anillo: ${fuera.length}/${tags.length}` };
    },
    "carga-online-normal": () => {
      // Dos cosas, y las dos tienen que darse: que las estancias se reconozcan con una mediana
      // sensata, y —lo que de verdad importa— que esas medias horas **no** aparezcan como
      // periodos de inactividad en el expediente de nadie.
      //
      // El filtro se acota a los huecos que **empiezan en la parada precisa de una calle servida**:
      // esos son los únicos candidatos a ser una carga mal reconocida. Desde R-OPP-015 el escenario
      // tiene otra clase (`adelantamiento-en-zona-cargada`) que planta un silencio real de más de
      // quince minutos en mitad del anillo, sin relación con ninguna calle; contarlo aquí confundiría
      // dos causas distintas de silencio, que es justo lo que esta sonda existe para no hacer.
      const servidas = charging.lanes.filter((lane) => lane.served);
      const conMediana = servidas.filter(
        (lane) =>
          lane.medianStayMs !== null &&
          lane.medianStayMs > 15 * 60_000 &&
          lane.medianStayMs < 50 * 60_000,
      );
      const servidasIds = new Set(servidas.map((lane) => lane.laneId));
      const stopTags = new Set(
        coLanes.filter((lane) => servidasIds.has(lane.laneId)).map((lane) => lane.stopTagId),
      );
      const huecos = dossiers.flatMap((dossier) => dossier.inactivity);
      const comoSilencio = huecos.filter(
        (period) => period.cause === "silencio" && stopTags.has(period.lastTagBefore),
      ).length;
      const comoCarga = huecos.filter((period) => period.cause === "carga-online").length;
      return {
        ok: conMediana.length === servidas.length && servidas.length > 0 && comoSilencio === 0,
        detail:
          `${conMediana.length}/${servidas.length} calles con mediana en torno a la media hora; ` +
          `${comoCarga} paradas leídas como carga y ${comoSilencio} como silencio`,
      };
    },
    "calle-sin-servicio": () => {
      const tags = scenario.defects.find((d) => d.kind === "calle-sin-servicio")?.tags ?? [];
      const sinServicio = charging.lanes.filter((lane) => !lane.served).length;
      const clases = tags.map(classOf);
      return {
        ok: sinServicio === 1 && clases.every((clase) => clase === "calle-sin-servicio"),
        detail: `${sinServicio} calle sin entradas; clases: ${clases.join(", ")}`,
      };
    },
    "salida-fuera-de-antiguedad": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "salida-fuera-de-antiguedad")
        ?.vehicles ?? [])[0];
      // Ordenadas por lo que esperó cada uno, sobre todas las calles. Lo que se exige no es que el
      // plantado aparezca —aparecería también en una lista de cincuenta— sino que salga **el
      // primero**: dos cargas simultáneas de duración distinta invierten el orden de salida con
      // toda normalidad, así que lo que separa la espera anómala del ruido es su magnitud.
      const todas = charging.lanes
        .flatMap((lane) => lane.outOfSeniority)
        .sort((a, b) => b.waitedMs - a.waitedMs);
      const primera = todas[0];
      return {
        ok: esperado !== undefined && primera?.waited === esperado,
        detail:
          primera === undefined
            ? "nadie señalado"
            : `el primero por espera es ${primera.waited} (se esperaba ${esperado ?? "—"}), ` +
              `${Math.round(primera.waitedMs / 60_000)} min; ${todas.length - 1} inversiones más, ` +
              "que son cargas simultáneas de duración distinta y no un hallazgo",
      };
    },
    "carga-anterior-a-la-ventana": () => {
      const esperados = new Set(
        scenario.defects.find((d) => d.kind === "carga-anterior-a-la-ventana")?.vehicles ?? [],
      );
      const inferidos = new Set(charging.startedInside.map((stay) => stay.agvId));
      const aciertos = [...esperados].filter((agv) => inferidos.has(agv));
      // Exacto en los dos sentidos: se exige encontrarlos **y** no inventarse ninguno más, porque
      // afirmar que un vehículo estaba cargando cuando no lo estaba es el mismo error al revés.
      return {
        ok: aciertos.length === esperados.size && inferidos.size === esperados.size,
        detail: `${aciertos.length}/${esperados.size} inferidos, ${inferidos.size} señalados en total`,
      };
    },
    "zona-vacia-declarada": () => {
      // La zona es contexto, no defecto: lo que se mide es que **declararla no mueva ningún
      // veredicto de un tag sano**. Una configuración que cambia diagnósticos que no debería
      // tocar es un defecto por sí misma, y solo se ve comparando las dos ejecuciones.
      const sinConfig = sinConfiguracion();
      const patron = (source: Analysis, tagId: string) =>
        source.matrix?.tags.find((entry) => entry.tagId === tagId)?.pattern;
      const movidos = scenario.cleanTags.filter(
        (tag) => patron(sinConfig, tag) !== patron(analysis, tag),
      );
      const enZona = scenario.lanes.every((lane) => scenario.zoneOf.get(lane.stop) === "vacio");
      return {
        ok: movidos.length === 0 && enZona,
        detail:
          `${[...new Set(scenario.zoneOf.values())].length} zonas declaradas, calles dentro de ` +
          `la vacía: ${enZona ? "sí" : "no"}; tags sanos con veredicto movido: ${movidos.length}; ` +
          `pasadas retiradas de la vía de orden: ${matrix?.orderWithheld ?? 0}`,
      };
    },
    "lector-agv-degradado": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "lector-agv-degradado")
        ?.vehicles ?? [])[0];
      const vehicle = matrix?.vehicles.find((entry) => entry.agvId === esperado);
      const rates = vehicle?.segmentRates ?? [];
      const sostenida =
        vehicle?.trend === "bajando" &&
        rates.length >= 2 &&
        rates.every((rate, index) => index === 0 || rate <= (rates[index - 1] as number));
      // Y sus tags no pueden acusarse: el fallo es del vehículo, y la flota los diluye. Se mira
      // solo sobre los tags **sanos**: `rotos` y `degradados` ya tienen su propia tendencia o
      // rotura por derecho propio (son otras dos clases plantadas), y contarlos aquí confundiría
      // el efecto de ese AGV con un hallazgo que no es suyo.
      const tagsAcusados = scenario.cleanTags.filter((tagId) => {
        const tag = matrix?.tags.find((entry) => entry.tagId === tagId);
        return tag?.trend === "bajando" || tag?.changedAtUtcMs !== undefined;
      });
      return {
        ok: sostenida && tagsAcusados.length === 0,
        detail:
          `${esperado ?? "?"}: ${vehicle?.trend ?? "sin tendencia"} ` +
          `(${rates.map((r) => `${Math.round(r * 100)}%`).join(" → ")}); ` +
          `tags con tendencia o rotura por su culpa: ${tagsAcusados.length}`,
      };
    },
    "adelantamiento-en-zona-cargada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "adelantamiento-en-zona-cargada")
        ?.vehicles ?? [])[0];
      // Mismo criterio que `salida-fuera-de-antiguedad`: lo que se exige es que el plantado salga
      // **el primero** por margen, no que sea el único — una parada de carga real en el mismo
      // escenario puede producir inversiones menores y legítimas en otro punto del mismo tramo.
      const todas = (fifo?.spans ?? [])
        .flatMap((span) => span.overtakes)
        .sort((a, b) => b.marginMs - a.marginMs);
      const primera = todas[0];
      return {
        ok: esperado !== undefined && primera?.overtaken === esperado,
        detail:
          primera === undefined
            ? "nadie señalado"
            : `el primero por margen es ${primera.overtaken} (se esperaba ${esperado ?? "—"}), ` +
              `${Math.round(primera.marginMs / 60_000)} min de margen; ${todas.length - 1} más`,
      };
    },
    "bifurcacion-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "bifurcacion-real");
      const [tagBifurcado, ramaEsperada] = plantado?.tags ?? [];
      const candidato = criticalPoints.find((entry) => entry.tagId === tagBifurcado);
      const ramas =
        candidato?.kind === "bifurcacion" || candidato?.kind === "cruce"
          ? (candidato.branches ?? []).map((branch) => branch.tagId)
          : [];
      return {
        ok:
          candidato !== undefined &&
          candidato.kind === "bifurcacion" && // nunca `cruce`: es la regresión que Part 35 previene
          ramas.length >= 2 &&
          ramaEsperada !== undefined &&
          ramas.includes(ramaEsperada),
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : `${candidato.kind}, ${ramas.length} ramas: ${ramas.join(", ")}`,
      };
    },
    "cruce-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "cruce-real");
      const tagCruce = plantado?.tags[0];
      const candidato = criticalPoints.find((entry) => entry.tagId === tagCruce);
      return {
        ok: candidato?.kind === "cruce" && candidato.reconvergesAt !== undefined,
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : candidato.kind === "cruce"
              ? `reconverge en «${candidato.reconvergesAt}» a ${candidato.hops} salto(s)`
              : `salió como ${candidato.kind}, no cruce`,
      };
    },
    "parada-precisa-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "parada-precisa-real");
      const tag = plantado?.tags[0];
      const candidato = criticalPoints.find((entry) => entry.tagId === tag);
      return {
        ok: candidato?.kind === "parada-precisa",
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : candidato.kind === "parada-precisa"
              ? `media ${Math.round((candidato.meanDurationMs ?? 0) / 1000)} s, cv ${(candidato.coefficientOfVariation ?? 0).toFixed(2)}`
              : `salió como ${candidato.kind}, no parada precisa`,
      };
    },
    "semaforo-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "semaforo-real");
      const tag = plantado?.tags[0];
      const candidato = criticalPoints.find((entry) => entry.tagId === tag);
      return {
        ok: candidato?.kind === "semaforo",
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : candidato.kind === "semaforo"
              ? `${Math.round((candidato.lowClusterMeanMs ?? 0) / 1000)} s / ${Math.round((candidato.highClusterMeanMs ?? 0) / 1000)} s`
              : `salió como ${candidato.kind}, no semáforo`,
      };
    },
    "ancla-declarada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "ancla-declarada")?.tags ?? [])[0];
      const completas = laps.filter((lap) => lap.completeness === "completa");
      return {
        ok:
          anchorTagId === esperado &&
          anchorTruth === "observed" &&
          completas.length > 0 &&
          completas.every((lap) => lap.truth === "observed"),
        detail:
          `ancla efectiva: ${anchorTagId ?? "—"} (${anchorTruth ?? "sin ancla"}); ` +
          `${completas.length} vueltas completas, ` +
          `${completas.filter((lap) => lap.truth === "observed").length} con truth observed`,
      };
    },
    "tag-nuevo-a-mitad-de-ventana": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "tag-nuevo-a-mitad-de-ventana")
        ?.tags ?? [])[0];
      const hallado = drift.tagDrifts.find((entry) => entry.tagId === esperado);
      return {
        ok: drift.evaluated && hallado?.kind === "nuevo",
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "sin hallazgo para el tag plantado"
            : `${hallado.kind}` +
              (hallado.kind === "nuevo" ? `, ${hallado.readingsAfter} lecturas en el periodo tardío` : ""),
      };
    },
    "memoria-actualizada-a-mitad-de-ventana": () => {
      const defect = scenario.defects.find((d) => d.kind === "memoria-actualizada-a-mitad-de-ventana");
      const esperado = defect?.vehicles[0];
      const esperados = new Set(defect?.tags ?? []);
      const hallado = drift.vehicleDrifts.find((entry) => entry.agvId === esperado);
      const dropped = new Set(hallado?.droppedTags ?? []);
      const coincide = esperados.size > 0 && [...esperados].every((tag) => dropped.has(tag));
      return {
        ok: drift.evaluated && hallado !== undefined && coincide,
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "vehículo plantado sin deriva señalada"
            : `${hallado.droppedTags.length} tags dejados: ${hallado.droppedTags.join(", ")}`,
      };
    },
    "sustitucion-candidata": () => {
      const defect = scenario.defects.find((d) => d.kind === "sustitucion-candidata");
      const [esperadoViejo, esperadoNuevo] = defect?.tags ?? [];
      const hallado = drift.tagDrifts.find(
        (entry) => entry.kind === "sustitucion-candidata" && entry.tagId === esperadoViejo,
      );
      const coincide =
        hallado !== undefined &&
        hallado.kind === "sustitucion-candidata" &&
        hallado.nuevoTagId === esperadoNuevo;
      return {
        ok: drift.evaluated && coincide,
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "sin sustitución candidata para el par plantado"
            : hallado.kind === "sustitucion-candidata"
              ? `${hallado.tagId} → ${hallado.nuevoTagId}, mismo ${hallado.neighborSide} (${hallado.sharedNeighbor})`
              : `salió como ${hallado.kind}, no emparejado`,
      };
    },
    "memoria-no-actualizada": () => {
      const defect = scenario.defects.find((d) => d.kind === "memoria-no-actualizada");
      const esperadoVehiculo = defect?.vehicles[0];
      const esperadoTag = defect?.tags[0];
      const hallado = drift.vehicleDrifts.find((entry) => entry.agvId === esperadoVehiculo);
      const coincide = esperadoTag !== undefined && (hallado?.notAdoptedTags.includes(esperadoTag) ?? false);
      return {
        ok: drift.evaluated && coincide,
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "vehículo plantado sin adopción señalada"
            : `no adoptados: ${hallado.notAdoptedTags.join(", ") || "ninguno"}`,
      };
    },
    "vinculacion-declarada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "vinculacion-declarada")?.tags ?? [])[0];
      const hallado = tagDossiers.find((entry) => entry.tagId === esperado);
      return {
        ok: hallado?.criticalFunction === "vinculacion",
        detail: `función declarada: ${hallado?.criticalFunction ?? "ninguna"}`,
      };
    },
    "desvinculacion-declarada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "desvinculacion-declarada")?.tags ?? [])[0];
      const hallado = tagDossiers.find((entry) => entry.tagId === esperado);
      return {
        ok: hallado?.criticalFunction === "desvinculacion",
        detail: `función declarada: ${hallado?.criticalFunction ?? "ninguna"}`,
      };
    },
    "lectura-desigual-en-pocos-tags": () => {
      const defect = scenario.defects.find((d) => d.kind === "lectura-desigual-en-pocos-tags");
      const hallado = vehicleReading.vehicles.find((entry) => entry.agvId === defect?.vehicles[0]);
      const weak = new Set(hallado?.weak.map((entry) => entry.tagId) ?? []);
      return {
        ok:
          hallado?.extent === "pocos" &&
          (defect?.tags ?? []).every((tag) => weak.has(tag)) &&
          hallado.never.length === 0 &&
          hallado.stopped.length === 0,
        detail:
          hallado === undefined
            ? "AGV plantado sin diferencias"
            : `${hallado.extent ?? "sin «poco»"}: ${hallado.weak.map((entry) => `${entry.tagId} ${entry.hits}/${entry.passes}`).join(", ")}`,
      };
    },
    "parada-de-produccion": () => {
      // Cada franja plantada tiene su parada detectada que la cubre, y no hay ninguna más.
      const planted = scenario.productionStopsUtcMs;
      const covering = planted.map((band) =>
        production.stops.findIndex((stop) => stop.fromUtcMs <= band.fromUtcMs + 60_000 && stop.toUtcMs >= band.toUtcMs - 60_000),
      );
      // El orden se informa pero no se exige: el generador deja que un AGV adelante a otro al circular
      // (no modela una vía única), así que no es verdad plantada. Lo fija la prueba unitaria.
      const flows = flow.productionFlow;
      const allInPlace = flows.every((entry) => entry.notInPlace.length === 0);
      const repeated = covering[0] !== undefined && covering[0] >= 0 && (production.stops[covering[0]]?.sameTimeOn.length ?? 0) > 0;
      const insideJustified = flow.stops
        .filter((stop) => planted.some((band) => stop.fromUtcMs < band.toUtcMs && stop.toUtcMs > band.fromUtcMs))
        .every((stop) => stop.justification === "produccion");
      return {
        ok:
          production.basis === "criticos" &&
          covering.every((index) => index >= 0) &&
          production.stops.length === planted.length &&
          allInPlace &&
          repeated &&
          insideJustified,
        detail:
          `${production.stops.length} paradas (${planted.length} plantadas), ` +
          `${flows
            .map(
              (entry) =>
                `${entry.inPlace}/${entry.vehicles} por su sitio` +
                (entry.notInPlace.length === 0
                  ? ""
                  : ` (no: ${entry.notInPlace.map((miss) => `${miss.agvId} ${miss.fromTagId}→${miss.toTagId}`).join(", ")})`) +
                (entry.orderChanges.length === 0
                  ? ""
                  : ` (orden: ${entry.orderChanges.map((change) => `${change.agvId} delante de ${change.passed}`).join(", ")})`),
            )
            .join(", ")}` +
          `${repeated ? ", la de las 10:00 se repite" : ", sin repetición"}` +
          `${insideJustified ? "" : ", alguna parada dentro sin justificar"}`,
      };
    },
    "bloqueo-sin-justificar": () => {
      const esperado = scenario.defects.find((d) => d.kind === "bloqueo-sin-justificar")?.vehicles[0];
      const hallado = flow.blockages.find((blockage) => blockage.agvId === esperado);
      return {
        ok: hallado !== undefined && hallado.basisReads > 0,
        detail:
          hallado === undefined
            ? `sin bloqueo de ${esperado ?? "?"}; ${flow.blockages.length} bloqueos en total`
            : `${hallado.agvId} en ${hallado.tagId}, ${Math.round(hallado.excessMs / 60_000)} min de más, ` +
              `${hallado.basisReads} lecturas críticas mientras tanto, ${hallado.behind.length} detrás`,
      };
    },
    "noche-medida-aparte": () => {
      const defect = scenario.defects.find((d) => d.kind === "noche-medida-aparte");
      if (bands === null || circuitState === null || defect === undefined) return { ok: false, detail: "sin anillo" };
      const clean = new Set(scenario.cleanTags);
      const physicalRing = scenario.physicalRing;
      const nextOf = (tag: string): string => physicalRing[(physicalRing.indexOf(tag) + 1) % physicalRing.length] as string;
      // La horquilla de producción de un tramo limpio, para comparar.
      const cleanP95 = physicalRing
        .filter((tag) => clean.has(tag) && clean.has(nextOf(tag)))
        .map((tag) => bands.pairs.get(pairKey(tag, nextOf(tag)))?.produccion?.p95Ms)
        .filter((value): value is number => value !== undefined)
        .sort((a, b) => a - b);
      const typicalP95 = cleanP95[Math.floor(cleanP95.length / 2)] ?? 0;
      const rows = defect.tags.map((tag) => {
        const pair = bands.pairs.get(pairKey(tag, nextOf(tag)));
        return { tag, produccion: pair?.produccion ?? null, noche: pair?.noche ?? null };
      });
      const tags = new Set(defect.tags);
      const nightStops = circuitState.unexplained.noche.filter((stop) => tags.has(stop.fromTagId)).length;
      const dayStops = circuitState.unexplained.produccion.filter((stop) => tags.has(stop.fromTagId)).length;
      const ok =
        rows.every(
          (row) =>
            row.produccion !== null &&
            row.noche !== null &&
            row.produccion.p95Ms <= 1.25 * typicalP95 &&
            row.noche.p50Ms >= 2 * row.produccion.p50Ms,
        ) &&
        nightStops === 0 &&
        dayStops === 0;
      return {
        ok,
        detail:
          rows
            .map(
              (row) =>
                `${row.tag}: producción ${((row.produccion?.p50Ms ?? 0) / 1000).toFixed(0)}/${((row.produccion?.p95Ms ?? 0) / 1000).toFixed(0)} s, ` +
                `noche ${((row.noche?.p50Ms ?? 0) / 1000).toFixed(0)} s`,
            )
            .join("; ") +
          ` (p95 de un tramo limpio: ${(typicalP95 / 1000).toFixed(0)} s); paradas sin explicación ahí: ${nightStops} de noche, ${dayStops} de día`,
      };
    },
    "parada-sin-explicacion-aislada": () => {
      const defect = scenario.defects.find((d) => d.kind === "parada-sin-explicacion-aislada");
      const hallada = circuitState?.unexplained.produccion.find(
        (stop) => stop.agvId === defect?.vehicles[0] && stop.fromTagId === defect?.tags[0],
      );
      return {
        ok: hallada !== undefined && hallada.aheadEvidence !== null,
        detail:
          hallada === undefined
            ? `sin parada de ${defect?.vehicles[0]} en ${defect?.tags[0]}`
            : `${hallada.agvId} en ${hallada.fromTagId}: ${(hallada.excessMs / 1000).toFixed(0)} s de más sobre ${(hallada.usualMs / 1000).toFixed(0)} s; ` +
              (hallada.aheadEvidence === null
                ? "sin nadie delante"
                : `${hallada.aheadEvidence.agvId} iba ${hallada.aheadEvidence.distanceAtStart} tags delante y avanzó ${hallada.aheadEvidence.tagsAdvanced ?? "?"}`),
      };
    },
    "punto-conflictivo": () => {
      const defect = scenario.defects.find((d) => d.kind === "punto-conflictivo");
      const punto = circuitState?.conflictPoints.find((point) => (defect?.tags ?? []).every((tag) => point.tags.includes(tag)));
      const bloqueos = flow.blockages.filter((blockage) => (defect?.tags ?? []).includes(blockage.tagId)).length;
      return {
        ok: punto !== undefined && punto.ofOneVehicle === null && punto.vehicles.length >= 8 && bloqueos === 0,
        detail:
          punto === undefined
            ? `ningún punto con ${defect?.tags.join(" y ")}; puntos: ${circuitState?.conflictPoints.map((point) => point.tags.join("+")).join(", ") || "ninguno"}`
            : `${punto.tags.join("+")}: ${punto.stops} paradas sin explicación (el azar daría ${punto.expected.toFixed(2)}), ${punto.vehicles.length} AGV, ${bloqueos} bloqueos`,
      };
    },
    "cuello-de-botella": () => {
      const defect = scenario.defects.find((d) => d.kind === "cuello-de-botella");
      const tag = defect?.tags[0] as string;
      const physicalRing = scenario.physicalRing;
      const antes = physicalRing[(physicalRing.indexOf(tag) - 1 + physicalRing.length) % physicalRing.length];
      const cuello = circuitState?.bottlenecks.find((entry) => entry.tagId === tag);
      const detras = circuitState?.unexplained.produccion.filter((stop) => stop.fromTagId === antes).length ?? 0;
      return {
        ok: cuello !== undefined && cuello.blockages === 0 && detras === 0,
        detail:
          cuello === undefined
            ? `sin cuello en ${tag}; cuellos: ${circuitState?.bottlenecks.map((entry) => entry.tagId).join(", ") || "ninguno"}`
            : `${tag}: ${cuello.retentions} retenciones (el azar daría ${cuello.expected.toFixed(1)}), ${cuello.episodes} colas, la más larga de ${cuello.longestQueue}, ${cuello.blockages} bloqueos; ${detras} sin explicación detrás`,
      };
    },
    "zona-oscura": () => {
      const defect = scenario.defects.find((d) => d.kind === "zona-oscura");
      const zona = circuitState?.darkZones.find((zone) => (defect?.tags ?? []).some((tag) => zone.tags.includes(tag)));
      return {
        ok: zona !== undefined && zona.cause === "salta-tag",
        detail:
          zona === undefined
            ? "ninguna zona con los tags poco leídos"
            : `${zona.tags[0]}…${zona.tags[zona.tags.length - 1]}: ${(zona.gapMs / 1000).toFixed(0)} s sin leer frente a ${(zona.typicalMs / 1000).toFixed(0)} s típicos, ${zona.cause} (${(zona.skipShare * 100).toFixed(0)} % salta)`,
      };
    },
    "posicion-en-tiempo": () => {
      const declared = scenario.physicalRing;
      const nunca = scenario.defects.find((d) => d.kind === "declarado-sin-lecturas")?.tags ?? [];
      const nuevo = scenario.defects.find((d) => d.kind === "tag-nuevo-a-mitad-de-ventana")?.tags[0] ?? "";
      const problems: string[] = [];
      for (const franja of franjas) {
        const known = franja.positions.filter((entry) => entry.offsetMs !== null);
        const increasing = known.every((entry, index) => index === 0 || (entry.offsetMs as number) > ((known[index - 1] as typeof entry).offsetMs as number));
        if (!increasing) problems.push(`${franja.sourceId}: posiciones no crecientes`);
        const offsetOf = new Map(franja.positions.map((entry) => [entry.tagId, entry.offsetMs]));
        for (const tag of nunca) {
          if (offsetOf.get(tag) !== undefined && offsetOf.get(tag) !== null) problems.push(`${franja.sourceId}: ${tag} situado`);
          const next = declared[(declared.indexOf(tag) + 1) % declared.length] as string;
          if ((offsetOf.get(next) ?? null) === null) problems.push(`${franja.sourceId}: ${next} sin situar`);
        }
      }
      const [temprana, tardia] = franjas;
      const antes = declared[135] as string;
      const despues = declared[136] as string;
      const tardiaOffset = new Map((tardia?.positions ?? []).map((entry) => [entry.tagId, entry.offsetMs ?? null]));
      const n = tardiaOffset.get(nuevo) ?? null;
      const a = tardiaOffset.get(antes) ?? null;
      const b = tardiaOffset.get(despues) ?? null;
      if (temprana?.positions.some((entry) => entry.tagId === nuevo)) problems.push(`${nuevo} en el fichero de antes`);
      if (n === null || a === null || b === null || !(a < n && n < b)) problems.push(`${nuevo} no queda entre ${antes} y ${despues}`);
      return {
        ok: franjas.length === 2 && problems.length === 0,
        detail:
          problems.length > 0
            ? problems.slice(0, 4).join("; ")
            : `vuelta ${franjas.map((franja) => `${franja.sourceId} ${((franja.lapMs ?? 0) / 60_000).toFixed(1)} min`).join(", ")}; ` +
              `${nuevo} a ${((n ?? 0) / 1000).toFixed(0)} s, entre ${((a ?? 0) / 1000).toFixed(0)} y ${((b ?? 0) / 1000).toFixed(0)} s`,
      };
    },
    "tres-sustituidos-seguidos": () => {
      const defect = scenario.defects.find((d) => d.kind === "tres-sustituidos-seguidos");
      const viejos = (defect?.tags ?? []).slice(0, 3);
      const nuevos = (defect?.tags ?? []).slice(3);
      const esperado = viejos.map((tag, index) => `${tag}>${nuevos[index]}`).join(" ");
      const lee = (gaps: readonly AnchorGapChange[]): { ok: boolean; detail: string } => {
        const gap = gaps.find((entry) => entry.changes.some((change) => change.kind === "sustituido" && viejos.includes(change.oldTagId)));
        if (gap === undefined) return { ok: false, detail: "ningún tramo entre anclas con el bloque" };
        const pares = gap.changes
          .map((change) => (change.kind === "sustituido" ? `${change.oldTagId}>${change.newTagId}${change.placement === "mismo-sitio" ? "" : "*"}` : `${change.kind}:${change.tagId}`))
          .join(" ");
        return {
          ok: pares === esperado && gap.sum === "igual",
          detail: `${gap.fromAnchor}→${gap.toAnchor}: ${pares}, suma ${gap.sum} (${gap.before.passes}/${gap.after.passes} pasadas)`,
        };
      };
      const entre = lee(structure.entreFicheros);
      const dentro = lee(structure.dentroDelFichero);
      return { ok: entre.ok && dentro.ok, detail: `entre ficheros ${entre.detail}; dentro ${dentro.detail}` };
    },
    "insertado-misma-suma": () => {
      const defect = scenario.defects.find((d) => d.kind === "insertado-misma-suma");
      const [antes, nuevo, despues] = defect?.tags ?? [];
      const lee = (gaps: readonly AnchorGapChange[]): { ok: boolean; detail: string } => {
        const gap = gaps.find((entry) => entry.changes.some((change) => change.kind === "insertado" && change.tagId === nuevo));
        if (gap === undefined) return { ok: false, detail: `${nuevo} no sale como insertado` };
        return {
          ok: gap.fromAnchor === antes && gap.toAnchor === despues && gap.changes.length === 1 && gap.sum === "igual",
          detail: `${gap.fromAnchor}→${gap.toAnchor}: ${gap.changes.length} cambio(s), suma ${gap.sum}`,
        };
      };
      const entre = lee(structure.entreFicheros);
      const dentro = lee(structure.dentroDelFichero);
      return { ok: entre.ok && dentro.ok, detail: `entre ficheros ${entre.detail}; dentro ${dentro.detail}` };
    },
    "tag-de-noche": () => {
      const [antes, nocturno, despues] = scenario.defects.find((d) => d.kind === "tag-de-noche")?.tags ?? [];
      const tag = undeclared.tags.find((entry) => entry.tagId === nocturno);
      if (tag === undefined) return { ok: false, detail: `${nocturno} no sale entre los tags fuera de la lista` };
      return {
        ok: tag.verdict === "noche" && tag.predecessor === antes && tag.successor === despues && tag.dayReadings === 0 && tag.dayHits === 0,
        detail:
          `${nocturno}: ${tag.verdict}, entre ${tag.predecessor} y ${tag.successor}; ${tag.nightReadings} lecturas de noche; ` +
          `de día ${tag.dayPasses} pasadas por su sitio y ${tag.dayHits} lecturas`,
      };
    },
    "linea-parada-con-pulmon": () => {
      const planted = scenario.productionStopsUtcMs;
      const overlapping = (stop: LineFeed["stops"][number]) =>
        planted.find((span) => stop.fromUtcMs < span.toUtcMs && span.fromUtcMs < stop.toUtcMs);
      const onPlanted = lineFeedPulmon.stops.filter((stop) => overlapping(stop) !== undefined);
      const kinds = onPlanted.map((stop) => `${stop.kind}(${stop.waiting})`);
      const others = lineFeedPulmon.stops.filter((stop) => overlapping(stop) === undefined).map((stop) => stop.kind);
      return {
        ok:
          planted.every((span) => onPlanted.some((stop) => overlapping(stop) === span)) &&
          onPlanted.every((stop) => stop.kind === "con-pulmon" && stop.waiting > 0) &&
          lineFeedPulmon.zone !== null,
        detail:
          `en las paradas plantadas: ${kinds.join(", ")}; pulmón desde ${lineFeedPulmon.zone?.fromTagId ?? "—"}, hasta ${lineFeedPulmon.zone?.capacity ?? 0} AGV; ` +
          `otras paradas de la línea: ${others.join(", ") || "ninguna"}`,
      };
    },
    "linea-tiempo-sin-paso": () => {
      const day = lineFeedPulmon.rhythm.find((entry) => entry.regime === "produccion");
      const planted = scenario.productionStopsUtcMs.reduce((sum, stop) => sum + (stop.toUtcMs - stop.fromUtcMs), 0);
      const withAgv = day?.lostWithAgvMs ?? 0;
      return {
        // Cada parada cuesta su duración menos un ciclo, así que no llega al 100 %: basta con el 90 %.
        ok: day !== undefined && withAgv >= planted * 0.9,
        detail:
          `sin paso ${Math.round((day?.lostMs ?? 0) / 60_000)} min: con AGV esperando ${Math.round(withAgv / 60_000)} min, ` +
          `sin AGV ${Math.round((day?.lostWithoutAgvMs ?? 0) / 60_000)} min; paradas plantadas, ${Math.round(planted / 60_000)} min; ` +
          `ciclo entre ${Math.round((day?.cycleLowMs ?? 0) / 1000)} y ${Math.round((day?.cycleHighMs ?? 0) / 1000)} s`,
      };
    },
    "zona-oscura-por-tag-sin-lecturas": () => {
      const tags = scenario.defects.find((d) => d.kind === "zona-oscura-por-tag-sin-lecturas")?.tags ?? [];
      const zones = circuitState?.darkZones ?? [];
      const found = tags.map((tag) => zones.find((zone) => zone.cause === "tag-sin-lecturas" && zone.missingTags.includes(tag)));
      const spurious = zones.filter((zone) => zone.cause === "tramo-largo");
      return {
        ok: found.every((zone) => zone !== undefined) && spurious.length === 0,
        detail:
          tags.map((tag, index) => `${tag}: ${found[index] === undefined ? "sin zona" : `${found[index]?.tags[0]}…${found[index]?.tags.at(-1)}`}`).join(", ") +
          `; «tramo tarda» sin tag declarado: ${spurious.length}`,
      };
    },
    "bateria-del-que-salta": () => {
      const defect = scenario.defects.find((d) => d.kind === "bateria-del-que-salta");
      const agv = defect?.vehicles[0] ?? "";
      const tramo = new Set(defect?.tags ?? []);
      const steps = incidentContext.steps.get(agv) ?? [];
      const physical = scenario.physicalRing;
      const before = physical[physical.indexOf(defect?.tags[0] ?? "") - 1];
      const afterTag = physical[physical.indexOf(defect?.tags.at(-1) ?? "") + 1];
      // Un hueco de producción en que se saltó el tramo entero: del tag anterior al posterior.
      const regime = regimeReader("Europe/Madrid", PROVISIONAL_CONFIG.regimes);
      const index = steps.findIndex(
        (step, at) => step.tagId === before && steps[at + 1]?.tagId === afterTag && regime(step.utcMs) === "produccion",
      );
      const from = steps[index];
      const to = steps[index + 1];
      if (from === undefined || to === undefined || tramo.size === 0) return { ok: false, detail: `${agv} no se salta el tramo entero` };
      const battery = incidentBattery(incidentContext, { agvId: agv, fromTagId: from.tagId, fromUtcMs: from.utcMs, toTagId: to.tagId, toUtcMs: to.utcMs }, scenario.toUtcMs);
      return {
        ok: battery.reading === "no-registra" && battery.behind.overtook.length === 0,
        detail: battery.lines.join(" | "),
      };
    },
    "bateria-de-la-parada-aislada": () => {
      const defect = scenario.defects.find((d) => d.kind === "bateria-de-la-parada-aislada");
      const stop = flow.stops.find((entry) => entry.agvId === defect?.vehicles[0] && entry.fromTagId === defect?.tags[0]);
      if (stop === undefined) return { ok: false, detail: "sin la parada aislada" };
      const battery = incidentBattery(
        incidentContext,
        { agvId: stop.agvId, fromTagId: stop.fromTagId, fromUtcMs: stop.fromUtcMs, toTagId: stop.toTagId, toUtcMs: stop.toUtcMs },
        scenario.toUtcMs,
      );
      return {
        ok: battery.reading === "parado-con-cola" && battery.behind.held.length > 0 && battery.behind.overtook.length === 0,
        detail: battery.lines.join(" | "),
      };
    },
    "bateria-del-bloqueo": () => {
      const agv = scenario.defects.find((d) => d.kind === "bateria-del-bloqueo")?.vehicles[0];
      const blockage = flow.blockages.find((entry) => entry.agvId === agv);
      if (blockage === undefined) return { ok: false, detail: `sin bloqueo de ${agv ?? "?"}` };
      const battery = incidentBattery(
        incidentContext,
        { agvId: blockage.agvId, fromTagId: blockage.tagId, fromUtcMs: blockage.fromUtcMs, toTagId: blockage.nextTagId, toUtcMs: blockage.toUtcMs },
        scenario.toUtcMs,
      );
      return {
        // El resto de la flota lo adelanta con su propio reloj (así se plantó): no se movía en la guía.
        ok: battery.reading === "adelantado" && battery.behind.overtook.length > 0,
        detail: battery.lines.join(" | "),
      };
    },
    "linea-tag-sin-leer": () => {
      const defect = scenario.defects.find((d) => d.kind === "linea-tag-sin-leer");
      const readers = lineFeed.passages?.readers ?? [];
      // El lector degradado (plantado aparte) también deja de leer tags de la línea: es verdad y se admite.
      const degradado = scenario.defects.find((d) => d.kind === "lector-agv-degradado")?.vehicles ?? [];
      const flagged = readers.map((reader) => reader.agvId).filter((agvId) => !degradado.includes(agvId)).sort();
      const expectedAgvs = [...(defect?.vehicles ?? [])].sort();
      const sinParada = (lineFeed.passages?.issues ?? []).filter(
        (issue) => issue.kind === "sin-parada" && expectedAgvs.includes(issue.agvId),
      );
      return {
        ok:
          flagged.join(",") === expectedAgvs.join(",") &&
          readers
            .filter((reader) => expectedAgvs.includes(reader.agvId))
            .every((reader) => reader.tags.join(",") === defect?.tags.join(",") && reader.missedPasses === reader.passes) &&
          sinParada.length === 0,
        detail:
          `sin leer: ${readers.map((reader) => `${reader.agvId} (${reader.tags.join(",")}, ${reader.missedPasses}/${reader.passes})`).join(", ") || "nadie"}; ` +
          `pasos señalados: ${(lineFeed.passages?.issues ?? []).map((issue) => `${issue.kind} ${issue.agvId}`).join(", ") || "ninguno"}`,
      };
    },
    "limpieza-de-la-lista": () => {
      const tags = scenario.defects.find((d) => d.kind === "limpieza-de-la-lista")?.tags ?? [];
      const [refuerzo, n1, n2, n3, malEscrito, ...movidos] = tags;
      const cleanup = buildListCleanup(
        circuitOrder,
        criticalPointsFuncionOf,
        reinforcementGroups(scenario.declaredList, criticalPointsFuncionOf, criticalPointsGroupOf),
        reinforcementPlaces,
      );
      const fuera = cleanup.notPhysical.map((tag) => tag.tagId);
      const otra = cleanup.moved.map((tag) => tag.tagId).sort();
      const refuerzos = cleanup.reinforcements.map((group) => `${group.tags.join("+")}:${group.status}`);
      return {
        ok:
          fuera[0] === refuerzo &&
          [...fuera].sort().join(",") === [refuerzo, n1, n2, n3, malEscrito].sort().join(",") &&
          // De dos vecinos cambiados, uno basta para decirlo (la subsecuencia común conserva el otro).
          otra.includes(movidos[2] as string) &&
          (otra.includes(movidos[0] as string) || otra.includes(movidos[1] as string)) &&
          otra.length === 2 &&
          refuerzos.length === 1 &&
          refuerzos[0]?.endsWith(":incompleto") === true,
        detail: `fuera del físico: ${fuera.join(", ")}; en otra posición: ${otra.join(", ")}; refuerzos: ${refuerzos.join(", ")}`,
      };
    },
    "tag-de-noche-declarado": () => {
      const [antes, nocturno, despues] = scenario.defects.find((d) => d.kind === "tag-de-noche-declarado")?.tags ?? [];
      const tag = undeclaredWithNightList.tags.find((entry) => entry.tagId === nocturno);
      const otros = undeclaredWithNightList.tags
        .filter((entry) => entry.tagId !== nocturno)
        .map((entry) => `${entry.tagId}:${entry.verdict}`)
        .join(", ");
      const antesSin = undeclared.tags
        .filter((entry) => entry.tagId !== nocturno)
        .map((entry) => `${entry.tagId}:${entry.verdict}`)
        .join(", ");
      if (tag === undefined) return { ok: false, detail: `${nocturno} no sale entre los tags fuera de la lista` };
      return {
        ok:
          tag.verdict === "noche-declarado" &&
          tag.declaredNight &&
          tag.predecessor === antes &&
          tag.successor === despues &&
          otros === antesSin,
        detail: `${nocturno}: ${tag.verdict}, entre ${tag.predecessor} y ${tag.successor}; los demás, igual que sin la lista: ${otros === antesSin ? "sí" : "no"}`,
      };
    },
    "lista-con-otro-orden": () => {
      const [a, b, movido] = scenario.defects.find((d) => d.kind === "lista-con-otro-orden")?.tags ?? [];
      const rows = circuitOrder.rows;
      const at = (tag: string | undefined): number => rows.findIndex((row) => row.tagId === tag);
      const change = (tag: string | undefined) => rows[at(tag)]?.change;
      const physical = scenario.physicalRing;
      const i = physical.indexOf(movido as string);
      const enOrdenLeido = at(a) < at(b) && at(physical[i - 1]) < at(movido) && at(movido) < at(physical[i + 1]);
      const cambiados = [change(a), change(b)].filter((value) => value === "otro-sitio").length;
      const otros = rows.filter((row) => row.change === "otro-sitio" && ![a, b, movido].includes(row.tagId)).map((row) => row.tagId);
      const enContraste = contrast.filter((row) => row.verdict === "otro-orden").map((row) => row.declaredTag);
      const movidoFila = rows[at(movido)];
      return {
        ok:
          enOrdenLeido &&
          cambiados === 1 &&
          change(movido) === "otro-sitio" &&
          otros.length === 0 &&
          enContraste.includes(movido as string) &&
          (enContraste.includes(a as string) || enContraste.includes(b as string)),
        detail:
          `${a} y ${b} en orden leído: ${at(a) < at(b) ? "sí" : "no"}, ${cambiados} marcado como otro sitio; ` +
          `${movido}: ${change(movido)}, según las lecturas ${movidoFila?.readBetween}, según la lista ${movidoFila?.listBetween}; ` +
          `otros en otro sitio: ${otros.length === 0 ? "ninguno" : otros.join(", ")}`,
      };
    },
    "lista-con-numero-mal-escrito": () => {
      const [real, escrito] = scenario.defects.find((d) => d.kind === "lista-con-numero-mal-escrito")?.tags ?? [];
      const fila = contrast.find((row) => row.declaredTag === escrito);
      const fuera = undeclared.tags.find((tag) => tag.tagId === real);
      const ids = circuitOrder.rows.map((row) => row.tagId);
      const juntos = Math.abs(ids.indexOf(real as string) - ids.indexOf(escrito as string)) === 1;
      return {
        ok:
          fila?.verdict === "sustituido-candidato" &&
          fila.observedTag === real &&
          fuera?.verdict === "posicion" &&
          fuera.declaredWithoutReadings.includes(escrito as string) &&
          juntos,
        detail:
          `${escrito} → ${fila?.verdict ?? "sin fila"} con ${fila?.observedTag ?? "—"}; ${real}: ${fuera?.verdict ?? "no sale fuera de la lista"}` +
          `${fuera === undefined ? "" : `, la lista pone ahí ${fuera.declaredWithoutReadings.join(", ") || "nada"}`}; juntos en el orden leído: ${juntos ? "sí" : "no"}`,
      };
    },
    "refuerzo-sin-lectura": () => {
      const [sinLectura, leido] = scenario.defects.find((d) => d.kind === "refuerzo-sin-lectura")?.tags ?? [];
      const fila = inventory.rows.find((row) => row.tagId === sinLectura);
      const otro = inventory.rows.find((row) => row.tagId === leido);
      return {
        ok:
          fila?.tagClass === "refuerzo-sin-lectura" &&
          fila.criticalFunction === "desvinculacion" &&
          fila.reinforcement.includes(leido as string) &&
          otro?.tagClass === "activo" &&
          !inventory.rows.some((row) => row.tagClass === "critico-sin-lectura"),
        detail:
          `${sinLectura}: ${fila?.tagClass ?? "sin fila"} (${fila?.criticalFunction ?? "—"}, refuerzo con ${fila?.reinforcement.join(", ") || "nadie"}); ` +
          `${leido}: ${otro?.tagClass ?? "sin fila"}`,
      };
    },
    "ritmo-mas-lento-en-un-fichero": () => {
      const agv = scenario.defects.find((d) => d.kind === "ritmo-mas-lento-en-un-fichero")?.vehicles[0] ?? "";
      const [temprano, tardio] = franjaPace;
      const antes = temprano?.vehicles.find((vehicle) => vehicle.agvId === agv);
      const despues = tardio?.vehicles.find((vehicle) => vehicle.agvId === agv);
      const ratio = despues === undefined ? null : despues.ratio / despues.fleetRatio;
      return {
        ok:
          antes?.verdict === null &&
          despues?.verdict === "mas-lento" &&
          despues.where === "toda-la-linea" &&
          ratio !== null &&
          Math.abs(ratio - 1.1) < 0.04,
        detail:
          `${agv}: fichero de antes ${antes === undefined ? "sin medir" : `${(antes.ratio / antes.fleetRatio).toFixed(3)} ${antes.verdict ?? "a su paso"}`}; ` +
          `de después ${despues === undefined ? "sin medir" : `${(ratio as number).toFixed(3)} ${despues.verdict ?? "a su paso"} (${JSON.stringify(despues.where)}, ${despues.samples} transiciones; ${despues.zones.map((zone) => `${zone.zone} ${zone.samples} ${(zone.ratio / zone.fleetRatio).toFixed(3)} ${zone.verdict ?? "—"}`).join(", ")})`}`,
      };
    },
    "retiene-a-otros": () => {
      const defect = scenario.defects.find((d) => d.kind === "retiene-a-otros");
      const agv = defect?.vehicles[0] ?? "";
      const holder = pace?.holders.find((entry) => entry.agvId === agv);
      return {
        ok: holder !== undefined && holder.expected !== null && holder.sites.includes(defect?.tags[0] ?? ""),
        detail:
          holder === undefined
            ? `${agv} no retiene a nadie`
            : `${agv}: ${holder.retentions} retenciones de ${holder.retained.length} AGV (el azar daría ${(holder.expected ?? 0).toFixed(1)}), ` +
              `${(holder.waitMs / 60_000).toFixed(1)} min esperados detrás, en ${holder.sites.join(", ")}`,
      };
    },
    "entrega-agrupada": () => {
      const defect = scenario.defects.find((d) => d.kind === "entrega-agrupada");
      const agv = defect?.vehicles[0] as string;
      const plantadas = scenario.groupedDeliveriesUtcMs;
      const suyas = groupedDelivery.deliveries.filter((delivery) => delivery.agvId === agv);
      const halladas = plantadas.filter((at) => suyas.some((delivery) => delivery.fromUtcMs === at && delivery.kind === "sin-parada"));
      // Sin el colapso, el hueco de cada ráfaga saldría como parada de ese AGV justo ahí.
      const paradasEnRafaga = flow.stops.filter(
        (stop) => stop.agvId === agv && plantadas.some((at) => stop.fromUtcMs >= at && stop.fromUtcMs < at + 2 * 60_000),
      ).length;
      const concentrado = deliverySummary.vehicles.some((entry) => entry.id === agv);
      return {
        ok: plantadas.length > 0 && halladas.length === plantadas.length && paradasEnRafaga === 0 && concentrado,
        detail:
          `${halladas.length} de ${plantadas.length} ráfagas de ${agv} halladas sin parada; ${paradasEnRafaga} paradas en ellas; ` +
          `${concentrado ? "concentrado en él" : "no concentrado"}; total de ráfagas: ${groupedDelivery.deliveries.length}`,
      };
    },
  };

  /** Resumen del estado normal medido, para leerlo en el informe junto a las clases. */
  const describeState = (): string => {
    if (circuitState === null || bands === null) return "  sin anillo: no se mide";
    const s = circuitState;
    const pos = (tagId: string): string => `${tagId}@${bands.positionOf.get(tagId) ?? "—"}`;
    return [
      `  horquillas: ${[...bands.pairs.values()].filter((pair) => pair.produccion !== null).length} con producción, ` +
        `${[...bands.pairs.values()].filter((pair) => pair.noche !== null).length} con noche; resolución ${bands.resolutionMs} ms`,
      `  cuellos de botella: ${s.bottlenecks.map((b) => `${pos(b.tagId)} (${b.retentions} vs ${b.expected.toFixed(1)}, ${b.episodes} ep., cola ${b.longestQueue}, ${b.blockages} bloq.)`).join("; ") || "ninguno"}`,
      `  puntos conflictivos: ${s.conflictPoints.map((c) => `${c.tags.map(pos).join("+")} (${c.stops} vs ${c.expected.toFixed(2)}, ${c.vehicles.length} AGV${c.ofOneVehicle === null ? "" : `, solo ${c.ofOneVehicle}`})`).join("; ") || "ninguno"}`,
      `  zonas oscuras (típico ${((s.typicalGapMs ?? 0) / 1000).toFixed(1)} s): ${s.darkZones.map((z) => `${pos(z.tags[0] as string)}…${pos(z.tags[z.tags.length - 1] as string)} ${(z.gapMs / 1000).toFixed(0)} s ${z.cause} (${(z.skipShare * 100).toFixed(0)} % salta)`).join("; ") || "ninguna"}`,
      `  explicadas por parada precisa o semáforo: ${s.explainedSlow.map((e) => `${pos(e.tagId)} ${e.function}`).join(", ") || "ninguna"}`,
      `  sin explicación, producción: ${s.unexplained.produccion.length} (${s.unexplained.produccion.slice(0, 6).map((u) => `${u.agvId} ${pos(u.fromTagId)} +${(u.excessMs / 1000).toFixed(0)} s`).join(", ")})`,
      `  sin explicación, noche: ${s.unexplained.noche.length} (${s.unexplained.noche.slice(0, 6).map((u) => `${u.agvId} ${pos(u.fromTagId)} +${(u.excessMs / 1000).toFixed(0)} s`).join(", ")})`,
      `  noche frente a producción: ${s.night.slice(0, 5).map((n) => `${pos(n.from)} ${(n.produccionP50Ms / 1000).toFixed(0)}→${(n.nocheP50Ms / 1000).toFixed(0)} s`).join(", ")}`,
      `  retenciones de producción: ${flow.retentions.filter((r) => r.regime === "produccion").length}; paradas: ${flow.stops.length}`,
      `  ritmo: ${pace?.vehicles.filter((v) => v.verdict !== null).map((v) => `${v.agvId} ${v.verdict} ${(v.ratio / v.fleetRatio).toFixed(3)}`).join(", ") || "nadie"}; ` +
        `por fichero: ${franjaPace.map((report, index) => `f${index + 1} ${report.vehicles.filter((v) => v.verdict !== null).map((v) => `${v.agvId} ${v.verdict} ${(v.ratio / v.fleetRatio).toFixed(3)}`).join(", ") || "nadie"}`).join("; ")}`,
      `  quién retiene: ${pace?.holders.slice(0, 5).map((h) => `${h.agvId} ${h.retentions}${h.expected === null ? "" : ` (azar ${h.expected.toFixed(1)})`}`).join(", ") || "nadie"}`,
      `  lecturas que llegaron juntas: ${groupedDelivery.deliveries.length} (${groupedDelivery.deliveries.map((d) => `${d.agvId} ${pos(d.fromTagId)} ${d.kind}`).join(", ") || "ninguna"})`,
    ].join("\n");
  };

  /** Todos los cambios de estructura, para leerlos en el informe. */
  const describeStructure = (): string => {
    const line = (gap: AnchorGapChange): string =>
      `${gap.fromAnchor}→${gap.toAnchor} [${gap.sum}, ${((gap.before.p50Ms ?? 0) / 1000).toFixed(0)}→${((gap.after.p50Ms ?? 0) / 1000).toFixed(0)} s]: ` +
      gap.changes
        .map((change) =>
          change.kind === "sustituido"
            ? `${change.oldTagId}>${change.newTagId} ${change.placement}`
            : `${change.kind} ${change.tagId} a ${(change.offsetMs / 1000).toFixed(0)} s`,
        )
        .join(", ");
    return [
      `  entre ficheros: ${structure.entreFicheros.map(line).join("; ") || "nada"}`,
      `  dentro del fichero: ${structure.dentroDelFichero.map(line).join("; ") || "nada"}`,
    ].join("\n");
  };

  it("publica el informe por clase", () => {
    const lineas: string[] = [];
    for (const defect of scenario.defects) {
      const resultado = (detecta[defect.kind] as () => { ok: boolean; detail: string })();
      const deuda = DEUDA_CONOCIDA.get(defect.kind);
      const estado = resultado.ok ? "DETECTA" : deuda === undefined ? "FALLA" : "NO DETECTA";
      lineas.push(`  ${estado.padEnd(11)} ${defect.kind} — ${resultado.detail}`);
    }
    console.log(
      `\n=== AUDITORÍA ===\n` +
        `${readings.toLocaleString("es-ES")} lecturas, ${scenario.vehicles.length} vehículos. ` +
        `Anillo reconstruido: ${ring.length} tags de ${scenario.physicalRing.length} declarados. ` +
        `Fuera del anillo: ${offRing.length}.\n` +
        lineas.join("\n") +
        `\n--- Estado normal del circuito (R-TIM-009) ---\n` +
        describeState() +
        `\n--- Cambios de estructura (R-DAT-021) ---\n` +
        describeStructure() +
        `\n=================\n`,
    );
    expect(ring.length).toBeGreaterThan(0);
  }, PLAZO);

  it("el generador planta lo que dice que planta", () => {
    // Una auditoría cuyo escenario miente es peor que no tener auditoría: daría por bueno un
    // producto que falla, o al revés. Así que el escenario se comprueba contra sí mismo, contando
    // en el CSV generado.
    const cuenta = new Map<string, number>();
    for (const linea of scenario.readingsCsv.split("\r\n").slice(1)) {
      const tag = linea.split(";")[2] as string;
      cuenta.set(tag, (cuenta.get(tag) ?? 0) + 1);
    }

    const base = [...scenario.cleanTags]
      .map((tag) => cuenta.get(tag) ?? 0)
      .sort((a, b) => a - b)[Math.floor(scenario.cleanTags.length / 2)] as number;
    expect(base).toBeGreaterThan(100);

    for (const tag of scenario.defects.find((d) => d.kind === "declarado-sin-lecturas")?.tags ?? []) {
      expect(cuenta.get(tag) ?? 0).toBe(0);
    }

    const altos = scenario.defects.find((d) => d.kind === "lectura-alta")?.tags ?? [];
    for (const tag of altos) {
      const proporcion = (cuenta.get(tag) ?? 0) / base;
      expect(proporcion, `${tag} debería rondar el 95-100 %`).toBeGreaterThan(0.9);
      expect(proporcion).toBeLessThanOrEqual(1.05);
    }

    const medios = scenario.defects.find((d) => d.kind === "lectura-media")?.tags ?? [];
    for (const tag of medios) {
      const proporcion = (cuenta.get(tag) ?? 0) / base;
      expect(proporcion, `${tag} debería quedar entre el 20 y el 90 %`).toBeGreaterThan(0.15);
      expect(proporcion).toBeLessThan(0.95);
    }

    // La rotura parte la ventana por la mitad larga: el tag se lee antes y no después.
    const rotura = scenario.defects.find((d) => d.kind === "rotura-subita");
    for (const tag of rotura?.tags ?? []) {
      const proporcion = (cuenta.get(tag) ?? 0) / base;
      expect(proporcion, `${tag} debería leerse solo hasta la rotura`).toBeGreaterThan(0.3);
      expect(proporcion).toBeLessThan(0.75);
    }

    // El lector degradado tiene que leer bastante menos en la segunda mitad de la ventana que en
    // la primera: es su propio recuento, sin pasar por el producto, lo que prueba que el escenario
    // planta lo que dice y no que el detector lo esté imaginando.
    const degradado = (scenario.defects.find((d) => d.kind === "lector-agv-degradado")
      ?.vehicles ?? [])[0];
    const mitad = (scenario.fromUtcMs + scenario.toUtcMs) / 2;
    let antes = 0;
    let despues = 0;
    for (const linea of scenario.readingsCsv.split("\r\n").slice(1)) {
      const [fecha, agv] = linea.split(";");
      if (agv !== degradado) continue;
      // `parseStamp` deshace los dígitos del CSV; `scenario.fromUtcMs`/`toUtcMs` son el instante
      // real una vez interpretados con la zona declarada (`toRealUtc`). Sin pasar los dos por el
      // mismo marco, la comparación se desplaza dos horas (CEST) y compara cosas distintas.
      if (toRealUtc(parseStamp(fecha as string)) < mitad) antes += 1;
      else despues += 1;
    }
    expect(antes, "el lector degradado debería tener lecturas en la primera mitad").toBeGreaterThan(0);
    expect(despues, "y bastantes menos en la segunda").toBeLessThan(antes * 0.8);
  }, PLAZO);

  it("el estado normal no señala nada limpio: cuellos, conflictos, zonas oscuras y paradas sin explicación (R-TIM-009)", () => {
    const clean = new Set(scenario.cleanTags);
    const physicalRing = scenario.physicalRing;
    expect(circuitState).not.toBeNull();
    const state = circuitState as CircuitState;
    expect(state.bottlenecks.filter((entry) => clean.has(entry.tagId)).map((entry) => entry.tagId)).toEqual([]);
    expect(state.conflictPoints.flatMap((point) => point.tags).filter((tag) => clean.has(tag))).toEqual([]);
    // Una zona oscura tiene que tocar algo plantado entre su primer y su último tag.
    const limpias = state.darkZones.filter((zone) => {
      const first = physicalRing.indexOf(zone.tags[0] as string);
      const last = physicalRing.indexOf(zone.tags[zone.tags.length - 1] as string);
      const span = (last - first + physicalRing.length) % physicalRing.length;
      return Array.from({ length: span + 1 }, (_, step) => physicalRing[(first + step) % physicalRing.length] as string).every(
        (tag) => clean.has(tag),
      );
    });
    expect(limpias.map((zone) => zone.tags.join("…"))).toEqual([]);
    // Las paradas sin explicación son las plantadas, y ninguna de noche.
    const plantadas = new Set(
      scenario.defects
        .filter((d) => d.kind === "parada-sin-explicacion-aislada" || d.kind === "punto-conflictivo")
        .flatMap((d) => d.vehicles),
    );
    expect(
      state.unexplained.produccion.filter((stop) => !plantadas.has(stop.agvId)).map((stop) => `${stop.agvId}@${stop.fromTagId}`),
    ).toEqual([]);
    expect(state.unexplained.noche.map((stop) => `${stop.agvId}@${stop.fromTagId}`)).toEqual([]);

    // Ritmo y quién retiene (R-AGV-019, R-AGV-020): solo los plantados, en toda la ventana y en cada fichero.
    const lento = scenario.defects.find((d) => d.kind === "ritmo-mas-lento-en-un-fichero")?.vehicles[0];
    const retiene = scenario.defects.find((d) => d.kind === "retiene-a-otros")?.vehicles[0];
    const ritmos = [pace, ...franjaPace].flatMap((report, index) =>
      (report?.vehicles ?? [])
        .filter((vehicle) => vehicle.verdict !== null && vehicle.agvId !== lento && vehicle.agvId !== retiene)
        .map((vehicle) => `${index === 0 ? "todo" : `f${index}`} ${vehicle.agvId} ${vehicle.verdict}`),
    );
    expect(ritmos, "ritmos señalados sin plantar").toEqual([]);
    // El retenedor devuelve su espera del semáforo a la mitad de cada paso siguiente (deuda de reloj
    // del generador), así que en la zona cargada va de verdad más rápido. Si el ritmo lo señala, solo
    // puede ser por eso: más rápido, y solo ahí.
    for (const report of [pace, ...franjaPace]) {
      const vehicle = report?.vehicles.find((entry) => entry.agvId === retiene);
      if (vehicle === undefined || vehicle.verdict === null) continue;
      expect(vehicle.verdict).toBe("mas-rapido");
      expect(vehicle.where).toEqual(["cargado"]);
    }
    const retenedores = [pace, ...franjaPace].flatMap((report, index) =>
      (report?.holders ?? [])
        .filter((holder) => holder.expected !== null && holder.agvId !== retiene)
        .map((holder) => `${index === 0 ? "todo" : `f${index}`} ${holder.agvId}`),
    );
    expect(retenedores, "retenedores señalados sin plantar").toEqual([]);
  }, PLAZO);

  it("no señala ningún tag sano: cero falsos positivos", () => {
    const falsos = scenario.cleanTags.filter((tag) => {
      const pattern = rowOf(tag)?.pattern;
      return pattern === "bimodal-candidato" || pattern === "uniforme-bajo";
    });
    expect(falsos, `falsos positivos: ${falsos.slice(0, 8).join(", ")}`).toHaveLength(0);

    // Ningún tag sano debe salir como candidato a punto crítico tampoco.
    const candidatosSobreSanos = scenario.cleanTags.filter((tag) =>
      criticalPoints.some((candidate) => candidate.tagId === tag),
    );
    expect(
      candidatosSobreSanos,
      `candidatos espurios: ${candidatosSobreSanos.slice(0, 8).join(", ")}`,
    ).toHaveLength(0);

    // Ningún tag sano debe traer una función crítica declarada que nadie plantó (Parte 36): las dos
    // vías —«critico» y la columna del circuito virtual— solo declaran los dos tags plantados.
    const funcionesEsperadas = new Set(
      scenario.defects
        .filter(
          (d) =>
            d.kind === "vinculacion-declarada" || d.kind === "desvinculacion-declarada" || d.kind === "refuerzo-sin-lectura",
        )
        .flatMap((d) => d.tags),
    );
    const funcionesEspurias = scenario.cleanTags.filter((tag) => {
      if (funcionesEsperadas.has(tag)) return false;
      return tagDossiers.find((entry) => entry.tagId === tag)?.criticalFunction != null;
    });
    expect(
      funcionesEspurias,
      `funciones críticas sin plantar: ${funcionesEspurias.slice(0, 8).join(", ")}`,
    ).toHaveLength(0);

    // Ningún tag sano debe aparecer con deriva entre los dos periodos, y ningún vehículo salvo el
    // plantado debe aparecer con tags dejados de leer.
    const derivaSobreSanos = scenario.cleanTags.filter((tag) =>
      drift.tagDrifts.some((entry) => entry.tagId === tag),
    );
    expect(
      derivaSobreSanos,
      `deriva espuria sobre tags sanos: ${derivaSobreSanos.slice(0, 8).join(", ")}`,
    ).toHaveLength(0);

    const esperado = (scenario.defects.find((d) => d.kind === "memoria-actualizada-a-mitad-de-ventana")
      ?.vehicles ?? [])[0];
    const esperadoAdopcion = (scenario.defects.find((d) => d.kind === "memoria-no-actualizada")
      ?.vehicles ?? [])[0];
    const vehiculosConDerivaEspuria = drift.vehicleDrifts.filter(
      (entry) =>
        (entry.droppedTags.length > 0 && entry.agvId !== esperado) ||
        (entry.notAdoptedTags.length > 0 && entry.agvId !== esperadoAdopcion),
    );
    expect(
      vehiculosConDerivaEspuria.map((entry) => entry.agvId),
      `vehículos con deriva sin plantar: ${vehiculosConDerivaEspuria.map((entry) => entry.agvId).join(", ")}`,
    ).toHaveLength(0);

    // La sustitución candidata no puede emparejar de más: el tag nuevo instalado a mitad de ventana
    // (98001, sin ningún desaparecido en su misma posición) tiene que seguir siendo `nuevo` suelto.
    const tagNuevoInstalado = (scenario.defects.find((d) => d.kind === "tag-nuevo-a-mitad-de-ventana")
      ?.tags ?? [])[0];
    const halladoTagNuevo = drift.tagDrifts.find((entry) => entry.tagId === tagNuevoInstalado);
    expect(halladoTagNuevo?.kind, "98001 no debería emparejarse con ningún desaparecido").toBe("nuevo");

    // Lecturas que llegaron juntas (R-DAT-020): solo las del AGV plantado. El generador devuelve su
    // deuda de reloj con pasos de medio tramo tras cada espera plantada; si eso se confundiera con una
    // ráfaga, saldrían aquí los AGV del punto conflictivo, la parada aislada o el cuello.
    const agrupadoEsperado = (scenario.defects.find((d) => d.kind === "entrega-agrupada")?.vehicles ?? [])[0];
    const agrupadasEspurias = groupedDelivery.deliveries.filter((delivery) => delivery.agvId !== agrupadoEsperado);
    expect(
      agrupadasEspurias.map((delivery) => `${delivery.agvId} ${delivery.fromTagId}`),
      "lecturas agrupadas sin plantar",
    ).toHaveLength(0);

    // Ningún AGV «deja de leer» (R-AGV-021): todos leen hasta el final de lo cargado. Con el umbral de
    // cada AGV contra sí mismo, un silencio normal —la noche, una carga— no puede salir como abandono.
    const abandonados = abandonedReadings(incidentContext, scenario.toUtcMs).map((entry) => entry.agvId);
    expect(abandonados, "AGV que dejan de leer sin plantar").toEqual([]);
  }, PLAZO);

  it("con una sola exportación, los cambios de tag y la lectura por AGV coinciden con lo plantado", () => {
    const of = (kind: DefectClass) => scenario.defects.find((d) => d.kind === kind);

    // Cambios dentro del periodo (R-DAT-019): la sustitución, las dos roturas y el tag nuevo suelto.
    const sustitucion = of("sustitucion-candidata")?.tags ?? [];
    const cambios = tagChanges.changes.filter((change) => change.kind === "cambio");
    expect(cambios.map((change) => (change.kind === "cambio" ? [change.oldTagId, change.newTagId] : []))).toEqual([
      sustitucion,
    ]);
    const dejan = tagChanges.changes.filter((change) => change.kind === "deja").map((change) => change.tagId).sort();
    expect(dejan).toEqual([...(of("rotura-subita")?.tags ?? [])].sort());
    // Empiezan a leerse el tag nuevo suelto y el insertado entre dos (Parte 50): los dos se plantaron a la
    // hora del corte. El bloque de tres sustituidos seguidos no sale aquí —sus vecinos también cambiaron,
    // no tienen sitio que comparar—: lo ve la suma entre anclas (R-DAT-021).
    const empiezan = tagChanges.changes.filter((change) => change.kind === "empieza").map((change) => change.tagId).sort();
    expect(empiezan).toEqual(
      [...(of("tag-nuevo-a-mitad-de-ventana")?.tags ?? []), (of("insertado-misma-suma")?.tags ?? [])[1] as string].sort(),
    );

    // Frente al tag nuevo, solo el AGV plantado, y con «nunca».
    const noActualizado = of("memoria-no-actualizada");
    expect(tagChanges.adoption.map((issue) => [issue.agvId, issue.tagId, issue.fact.kind])).toEqual([
      [noActualizado?.vehicles[0], noActualizado?.tags[0], "nunca"],
    ]);

    // Lectura por AGV (R-AGV-016): los ciegos no leen nunca sus tags, el de memoria actualizada deja
    // de leer los suyos a la hora del corte, y el lector degradado lee poco en muchos.
    const byId = new Map(vehicleReading.vehicles.map((entry) => [entry.agvId, entry]));
    const memoria = of("omision-por-memoria");
    for (const agvId of memoria?.vehicles ?? []) {
      expect(byId.get(agvId)?.never.map((entry) => entry.tagId).sort(), agvId).toEqual([...(memoria?.tags ?? [])].sort());
    }
    const actualizada = of("memoria-actualizada-a-mitad-de-ventana");
    const parado = byId.get(actualizada?.vehicles[0] ?? "");
    expect(parado?.stopped.map((entry) => entry.tagId).sort()).toEqual([...(actualizada?.tags ?? [])].sort());
    for (const entry of parado?.stopped ?? []) {
      expect(Math.abs(entry.sinceUtcMs - scenario.periodSplitUtcMs)).toBeLessThan(60 * 60_000);
    }
    expect(byId.get(of("lector-agv-degradado")?.vehicles[0] ?? "")?.extent).toBe("muchos");
  }, PLAZO);

  it("con una sola exportación, ni cambios de tag ni lectura por AGV fuera de lo plantado", () => {
    const of = (kind: DefectClass) => scenario.defects.find((d) => d.kind === kind);
    const tocados = new Set(
      tagChanges.changes.flatMap((change) => (change.kind === "cambio" ? [change.oldTagId, change.newTagId] : [change.tagId])),
    );
    const cambiosSobreSanos = scenario.cleanTags.filter((tag) => tocados.has(tag));
    expect(cambiosSobreSanos, `cambios espurios: ${cambiosSobreSanos.join(", ")}`).toHaveLength(0);

    // Ningún tag sano en un cambio de estructura por la suma entre anclas (R-DAT-021), ni entre ficheros
    // ni dentro de la ventana entera.
    const estructura = new Set(
      [...structure.entreFicheros, ...structure.dentroDelFichero].flatMap((gap) =>
        gap.changes.flatMap((change) => (change.kind === "sustituido" ? [change.oldTagId, change.newTagId] : [change.tagId])),
      ),
    );
    const estructuraSobreSanos = scenario.cleanTags.filter((tag) => estructura.has(tag));
    expect(estructuraSobreSanos, `cambios de estructura espurios: ${estructuraSobreSanos.join(", ")}`).toHaveLength(0);

    // «Nunca» y «dejó de leer» solo en los AGV plantados para eso; «poco» solo en los que tienen una
    // lectura desigual plantada (el de la tanda de tags saltados, el lector degradado y el nuevo caso).
    const nunca = new Set(of("omision-por-memoria")?.vehicles ?? []);
    const desde = new Set(of("memoria-actualizada-a-mitad-de-ventana")?.vehicles ?? []);
    const poco = new Set([
      ...(of("omision-conservando-convoy")?.vehicles ?? []),
      ...(of("lector-agv-degradado")?.vehicles ?? []),
      ...(of("lectura-desigual-en-pocos-tags")?.vehicles ?? []),
    ]);
    const espurios = vehicleReading.vehicles.filter(
      (entry) =>
        (entry.never.length > 0 && !nunca.has(entry.agvId)) ||
        (entry.stopped.length > 0 && !desde.has(entry.agvId)) ||
        (entry.weak.length > 0 && !poco.has(entry.agvId)),
    );
    expect(
      espurios.map((entry) => entry.agvId),
      `AGV con diferencias sin plantar: ${espurios
        .map((entry) => `${entry.agvId} (nunca ${entry.never.length}, desde ${entry.stopped.length}, poco ${entry.weak.map((w) => `${w.tagId} ${w.hits}/${w.passes}`).join(" ")})`)
        .join("; ")}`,
    ).toHaveLength(0);
  }, PLAZO);

  it("la vida de cada AGV: el adelantado sale parado en su sitio, con el tag siguiente (R-AGV-017)", () => {
    // `adelantamiento-en-zona-cargada` planta 20 min de espera justo después de un tag y el AGV sigue
    // por el siguiente: la firma exacta de «parado». Es la misma verdad que la sonda de FIFO, leída
    // desde la vida del vehículo.
    const adelantado = scenario.defects.find((d) => d.kind === "adelantamiento-en-zona-cargada")?.vehicles[0] ?? "";
    const suyos = silences.get(adelantado) ?? [];
    const parada = suyos.find((entry) => entry.kind === "parada" && entry.toUtcMs - entry.fromUtcMs >= 20 * 60_000);
    expect(parada, `huecos de ${adelantado}: ${suyos.map((entry) => entry.kind).join(", ")}`).toBeDefined();
    expect(parada?.detail.firstTagAfter).toBe(parada?.detail.nextTagId);
    expect(parada?.detail.usualMs).not.toBeNull();
    // Sin nadie parado delante y con la producción en marcha: lo único sin explicar (R-AGV-018).
    expect(parada?.justification).toBe("sin-explicacion");

    const reparto = new Map<string, number>();
    for (const list of silences.values()) {
      for (const entry of list) {
        const key = `${entry.kind}/${entry.justification ?? "—"}`;
        reparto.set(key, (reparto.get(key) ?? 0) + 1);
      }
    }
    console.log(`\n=== HUECOS POR CLASE === ${[...reparto].map(([kind, n]) => `${kind}: ${n}`).join(" · ")}\n`);
  }, PLAZO);

  it("contra el flujo: los huecos de las franjas, justificados por la producción; ningún otro sin explicar (R-AGV-018)", () => {
    const adelantado = scenario.defects.find((d) => d.kind === "bloqueo-sin-justificar")?.vehicles[0] ?? "";
    const sinExplicar = [...silences].flatMap(([agvId, list]) =>
      list.filter((entry) => entry.justification !== "produccion" && entry.justification !== "cola").map((entry) => ({ agvId, entry })),
    );
    expect(
      sinExplicar.filter(({ agvId }) => agvId !== adelantado).map(({ agvId, entry }) => `${agvId} ${entry.kind}`),
    ).toEqual([]);
    // Ningún hueco de la flota es «desconexión»: todos vuelven por su sitio.
    expect([...silences.values()].flat().filter((entry) => entry.kind === "desconexion")).toEqual([]);
    // Y el único bloqueo es el plantado.
    expect(flow.blockages.map((blockage) => blockage.agvId)).toEqual([adelantado]);
    // Un hueco que no se puede clasificar por su tramo (sin tiempo habitual: el AGV estaba en una rama o
    // en un tag sustituido) solo ocurre dentro de una parada de la producción. Fuera de ellas, todo
    // hueco tiene clase.
    const sinClase = [...silences].flatMap(([agvId, list]) =>
      list.filter((entry) => entry.kind === "sin-clasificar" && entry.justification !== "produccion").map((entry) => `${agvId} ${entry.detail.lastTagBefore}`),
    );
    expect(sinClase, "huecos sin clasificar fuera de una parada de la producción").toEqual([]);
  }, PLAZO);

  it("fuera de la lista del circuito, solo el tag plantado sale como de noche (R-DAT-022)", () => {
    const nocturno = scenario.defects.find((d) => d.kind === "tag-de-noche")?.tags[1];
    const deNoche = undeclared.tags.filter((tag) => tag.verdict !== "posicion").map((tag) => tag.tagId);
    expect(deNoche).toEqual([nocturno]);
    // Y ningún tag de la lista sale como leído fuera de ella.
    const declarados = new Set(scenario.declaredList);
    expect(undeclared.tags.filter((tag) => declarados.has(tag.tagId))).toEqual([]);
  });

  it("detecta las clases que ya sabe detectar, y sigue haciéndolo", () => {
    const fallos: string[] = [];
    for (const defect of scenario.defects) {
      if (DEUDA_CONOCIDA.has(defect.kind)) continue;
      const resultado = (detecta[defect.kind] as () => { ok: boolean; detail: string })();
      if (!resultado.ok) fallos.push(`${defect.kind}: ${resultado.detail}`);
    }
    expect(fallos, fallos.join(" | ")).toHaveLength(0);
  }, PLAZO);

  it("la deriva entre dos periodos coincide con otras clases ya plantadas, sin sonda propia", () => {
    // Los tags de rotura súbita mueren circuito-wide antes de la mitad de la ventana: tienen que
    // aparecer como `desaparecido` sin que nadie los haya plantado a propósito para esta clase.
    const rotos = scenario.defects.find((d) => d.kind === "rotura-subita")?.tags ?? [];
    const desaparecidos = new Set(
      drift.tagDrifts.filter((entry) => entry.kind === "desaparecido").map((entry) => entry.tagId),
    );
    for (const tag of rotos) expect(desaparecidos.has(tag), `${tag} debería salir desaparecido`).toBe(true);

    // Los tags nunca leídos por nadie tienen que consolidarse con la segunda ventana.
    const nuncaLeidos = scenario.defects.find((d) => d.kind === "declarado-sin-lecturas")?.tags ?? [];
    const consolidados = new Set(
      drift.tagDrifts.filter((entry) => entry.kind === "obsoleto-consolidado").map((entry) => entry.tagId),
    );
    for (const tag of nuncaLeidos) {
      expect(consolidados.has(tag), `${tag} debería salir obsoleto-consolidado`).toBe(true);
    }
  }, PLAZO);

  it("las calles servidas se usan por igual, sus tags son del circuito y cada estancia lee sus tags (R-CO-009, OQ-135)", () => {
    // El generador reparte los AGV entre las calles servidas por turno: ninguna debe salir señalada.
    const servidas = charging.lanes.filter((lane) => lane.served);
    expect(servidas.length).toBeGreaterThanOrEqual(2);
    expect(charging.usage.map((entry) => `${entry.laneId}:${entry.verdict}`)).toEqual(
      servidas.map((lane) => `${lane.laneId}:null`),
    );
    // La carga online pertenece al circuito: ningún tag de calle servida es `especial` ni «no declarado».
    const tagsServidos = new Set(servidas.flatMap((lane) => lane.tagReads.map((tag) => tag.tagId)));
    const clases = inventory.rows
      .filter((row) => tagsServidos.has(row.tagId))
      .map((row) => `${row.tagId}:${row.tagClass}`);
    expect(clases.filter((entry) => entry.endsWith(":especial") || entry.endsWith(":no-declarado-leido"))).toEqual([]);
    // Dentro de cada estancia completa se leen la entrada, la parada y la salida: la cifra lo dice.
    for (const lane of servidas) {
      for (const tag of lane.tagReads) {
        expect(tag.stays, `${lane.laneId} ${tag.tagId}`).toBeGreaterThan(0);
        expect(tag.staysRead / tag.stays, `${lane.laneId} ${tag.tagId} (${tag.role})`).toBeGreaterThanOrEqual(0.9);
      }
    }
  }, PLAZO);

  it("la lista de deuda conocida no miente: si algo empieza a detectarse, hay que sacarlo", () => {
    const yaDetectadas: string[] = [];
    for (const [kind] of DEUDA_CONOCIDA) {
      const resultado = (detecta[kind] as () => { ok: boolean; detail: string })();
      if (resultado.ok) yaDetectadas.push(kind);
    }
    expect(
      yaDetectadas,
      `ya se detectan y siguen en DEUDA_CONOCIDA: ${yaDetectadas.join(", ")}`,
    ).toHaveLength(0);
  }, PLAZO);
});
