/// <reference lib="webworker" />
/**
 * Worker de importación.
 *
 * Es el **único** lugar donde se parsea. La presentación no importa nada de `ingestion/`, así que
 * el defecto del prototipo —parsear en el hilo principal «para comprobar» y volver a parsear aquí—
 * no es posible por construcción.
 *
 * La cancelación es cooperativa (WP-004): se marca una bandera y el núcleo la consulta en sus
 * puntos de control. `terminate()` queda como último recurso de la interfaz, no como mecanismo.
 */

import {
  PROTOCOL_VERSION,
  type FromWorker,
  type OutgoingPayload,
  type Stage,
  type ToWorker,
} from "../src/application/protocol.js";
import {
  ImportCancelled,
  ImportFailure,
  importReadings,
} from "../src/ingestion/importer.js";
import { decodeSource } from "../src/ingestion/decode.js";
import { CatalogFailure, EXPECTED_STRUCTURE, importCatalog } from "../src/ingestion/catalog.js";
import { unionReadings } from "../src/ingestion/union.js";
import { mergeIntervals, sourceCoverage, type Interval } from "../src/domain/coverage.js";
import { assessAffinity, tagsOf } from "../src/domain/affinity.js";
import { activityBand, hourlyProfile } from "../src/domain/activity.js";
import { buildTagInventory, describeAction } from "../src/domain/inventory.js";
import { assignCohorts } from "../src/domain/cohort.js";
import { buildTransitions } from "../src/domain/graph.js";
import {
  findDominantCycle,
  resolveDeclaredAnchor,
  segmentLaps,
  type Lap,
  type LapAnchor,
} from "../src/domain/laps.js";
import { buildReadMatrix, type OrderEvidenceLimits } from "../src/domain/read-matrix.js";
import { detectTagChanges } from "../src/domain/tag-changes.js";
import { describeVehicleReading } from "../src/domain/vehicle-reading.js";
import { buildChargingReport, findLaneJunctions } from "../src/domain/charging.js";
import { buildFifoReport, loadedZoneSpans } from "../src/domain/fifo.js";
import {
  classifyCrossings,
  findBifurcationCandidates,
  findPrecisePauseCandidates,
  findTrafficLightCandidates,
  transitionDurationsByTag,
} from "../src/domain/critical-points.js";
import { compareDistantPeriods } from "../src/domain/drift.js";
import { buildFleetTimeline, mergeFleetPeriods } from "../src/domain/fleet.js";
import { classifySilence, usualSegmentTimes, type UsualTimes } from "../src/domain/silence-kind.js";
import {
  bandChangesBetweenPeriods,
  buildSegmentBands,
  measurableTransitions,
  regimeExposure,
  regimeReader,
  transitionRegime,
} from "../src/domain/segment-bands.js";
import { buildCircuitState } from "../src/domain/circuit-state.js";
import { collapseGroupedDeliveries, summarizeDeliveries } from "../src/domain/grouped-delivery.js";
import { franjaWindows, measureFranjaCohort, segmentHistories } from "../src/domain/franjas.js";
import {
  anchorSequences,
  changedTags,
  compareAnchorGaps,
  structureBoundaries,
  windowsAroundChanges,
  type AnchorGapChange,
  type AnchorSumContext,
  type StructureSet,
} from "../src/domain/anchor-sums.js";
import {
  flowStops,
  outsideProductionStops,
  productionStops,
  type FlowReport,
  type VehicleStop,
} from "../src/domain/flow-stops.js";
import { FLEET_STRUCTURE, FleetFailure, importFleetHistory } from "../src/ingestion/fleet-history.js";
import {
  laneEntryTags,
  readCoLanes,
  readCriticalPoints,
  readLapAnchors,
  readZones,
  type ConfigEntry,
} from "../src/domain/circuit-config.js";
import { buildAllAgvDossiers, buildAllTagDossiers } from "../src/domain/dossier.js";
import { compareAgainstVsystem } from "../src/domain/vsystem.js";
import { buildReplayFrames } from "../src/domain/replay.js";
import { PROVISIONAL_CONFIG } from "../src/domain/config.js";
import type { CircuitViews } from "../src/application/protocol.js";
import { isAvailable, loadCircuit, saveCircuit } from "../src/persistence/store.js";
import type { Reading } from "../src/domain/reading.js";
import type { SourceDirection } from "../src/domain/order.js";
import type { TruthState } from "../src/domain/truth.js";
import type { AccumulationReport } from "../src/application/protocol.js";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let currentJobId: string | null = null;
let cancelRequested = false;
let seq = 0;

function emit(message: OutgoingPayload, jobId: string): void {
  seq += 1;
  scope.postMessage({ ...message, protocolVersion: PROTOCOL_VERSION, jobId, seq } as FromWorker);
}

/** Hash del contenido completo: identidad del fichero (DATA_CONTRACTS §3). */
async function hashFile(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}


/**
 * Suma una fuente recién importada al circuito, uniéndola con lo ya guardado.
 *
 * El almacén se lee y se escribe **aquí**, no en el hilo principal: así ni las lecturas guardadas
 * ni las nuevas cruzan un `postMessage`, y la unión —que recorre las dos series— tampoco bloquea la
 * interfaz.
 */
async function accumulate(
  circuitId: string,
  circuitName: string,
  zone: string,
  result: { summary: { sourceId: string; sourceHash: string; fileName: string; acceptedRows: number };
    readings: readonly Reading[] },
): Promise<AccumulationReport | undefined> {
  if (!isAvailable()) return undefined;

  const existing = await loadCircuit(circuitId);
  const previous = existing?.readings ?? [];

  // La afinidad se comprueba **antes de unir y antes de escribir**: una fuente ajena que llegue
  // hasta el almacén ya no se puede separar de las demás, porque la unión no conserva de qué
  // circuito venía cada lectura. Aquí todavía hay dónde parar (FR-003, R-DAT-006).
  const affinity = assessAffinity(
    tagsOf(result.readings),
    tagsOf(previous),
    PROVISIONAL_CONFIG.affinity,
  );
  if (!affinity.mayAccumulate) {
    return {
      circuitId,
      coverage: existing?.coverage ?? [],
      totalReadings: previous.length,
      sources: existing?.sources.length ?? 0,
      shared: 0,
      disagreements: 0,
      affinity,
      accumulated: false,
    };
  }

  const union = unionReadings(previous, result.readings);
  const complete = sourceCoverage(result.readings).complete;

  const sources = [
    ...(existing?.sources ?? []),
    {
      sourceId: result.summary.sourceId,
      sourceHash: result.summary.sourceHash,
      fileName: result.summary.fileName,
      importedAt: Date.now(),
      acceptedRows: result.summary.acceptedRows,
      complete,
    },
  ];
  const coverage = mergeIntervals(
    sources.map((source) => source.complete).filter((span): span is Interval => span !== null),
  );

  await saveCircuit({
    circuitId,
    name: existing?.name ?? circuitName,
    zone,
    sources,
    coverage,
    readings: union.readings,
    // Las listas sobreviven a la llegada de una fuente nueva. Sin esto, cargar una exportación
    // borraba en silencio las listas de planta del circuito —el objeto se reescribe entero— y el
    // inventario desaparecía sin que nada lo dijera. Lo destapó la prueba de navegador.
    ...(existing?.lists === undefined ? {} : { lists: existing.lists }),
    // Y el historial de flota, por la misma razón: lo destapó la prueba de navegador de la Parte 39.
    ...(existing?.fleet === undefined ? {} : { fleet: existing.fleet }),
    updatedAt: Date.now(),
  });

  return {
    circuitId,
    coverage,
    totalReadings: union.readings.length,
    sources: sources.length,
    shared: union.shared,
    disagreements: union.disagreements,
    affinity,
    accumulated: true,
  };
}

/** Tramos de la banda de actividad. Bastantes para ver la forma, pocos para que quepa en pantalla. */
const ACTIVITY_BINS = 96;

/**
 * Fotogramas del replay. No es configuración de planta —no representa nada del circuito, solo
 * cuántos puntos tiene el control temporal de la interfaz— así que vive aquí como parámetro técnico,
 * igual que `ACTIVITY_BINS`.
 */
const REPLAY_FRAMES = 200;

/**
 * Duraciones que viajan, como mucho, por distribución de permanencias dibujada. Parámetro técnico,
 * igual que `ACTIVITY_BINS`: por encima se toma una muestra de paso fijo, determinista, y la vista
 * dice de cuántas sale.
 */
const DURATION_SAMPLE_MAX = 1000;

/**
 * Lecturas agrupadas que viajan, como mucho, por cohorte: las más recientes. Parámetro técnico, igual
 * que `DURATION_SAMPLE_MAX`; la vista dice cuántas hubo en total.
 */
const DELIVERY_LIST_MAX = 1000;

/** Una muestra de paso fijo: determinista, sin azar, y declarada por quien la enseña. */
function strideSample(values: readonly number[], max: number): number[] {
  if (values.length <= max) return [...values];
  const step = values.length / max;
  return Array.from({ length: max }, (_, index) => values[Math.floor(index * step)] as number);
}

/**
 * Los agregados que alimentan las vistas.
 *
 * Se calculan **aquí** y no en la interfaz: recorrer doscientas mil lecturas para contarlas por
 * hora es justo el trabajo que WP-001 mantiene fuera del hilo principal, y lo que cruza el
 * `postMessage` son unos cientos de números en lugar de las lecturas otra vez.
 *
 * El grafo, las vueltas y el replay se recorren sobre `direction` de la **última fuente
 * importada**. Para un circuito con varias fuentes de sentido distinto esto es una aproximación: el
 * reloj (`utcMs`) ya decide el orden cronológico salvo empates exactos, y esos empates son
 * justamente los que R-DAT-013 marca `inferred` sin sostener topología — el desempate no cambia esa
 * conclusión, solo cuál de las dos direcciones empatadas se etiqueta.
 */
async function buildViews(
  circuitId: string | undefined,
  accumulation: AccumulationReport | undefined,
  imported: readonly Reading[],
  zone: string,
  direction: SourceDirection,
  importedSource: { readonly sourceId: string; readonly sourceHash: string; readonly fileName: string },
): Promise<CircuitViews | undefined> {
  const stored =
    circuitId !== undefined && accumulation?.accumulated === true && isAvailable()
      ? await loadCircuit(circuitId)
      : undefined;
  const readings = stored?.readings ?? imported;
  const coverage = stored?.coverage ?? [];
  if (readings.length === 0) return undefined;

  // --- Configuración de planta (OQ-B04, `CONFIG_SCHEMA.md` §3.4) -----------------------------
  //
  // Va **antes** que el análisis y no después, como estaba: las calles cambian lo que significa un
  // hueco de media hora (R-CO-006) y las zonas cambian qué prueba el orden de convoy (R-FLO-006).
  // Leerlas al final serviría para enseñarlas, no para usarlas.
  const lists = stored?.lists ?? [];
  const entriesOf = (name: string): readonly ConfigEntry[] =>
    lists.find((entry) => entry.list === name)?.entries ?? [];
  const laneConfig = readCoLanes(entriesOf("carga-online"));
  const zoneConfig = readZones(entriesOf("zona"));
  const lapAnchorsConfig = readLapAnchors(entriesOf("ancla"));
  // La función de un tag crítico se declara en la lista `critico`, o alternativamente en la columna
  // `funcion` del circuito virtual (`circuito`) — las dos conviven (Parte 36). `critico` va primero
  // para que gane en caso de contradicción; el filtro sobre `circuito` es imprescindible, porque sin
  // él cada tag ordinario del circuito (sin función) dispararía el aviso «no dice su función».
  const criticalPointsConfig = readCriticalPoints([
    ...entriesOf("critico"),
    ...entriesOf("circuito").filter((entry) => entry.funcion !== ""),
  ]);
  const orderLimits: OrderEvidenceLimits = {
    zoneOf: zoneConfig.zoneOf,
    laneEntryTags: laneEntryTags(laneConfig.lanes),
  };
  const charging = buildChargingReport(
    readings,
    laneConfig.lanes,
    coverage,
    PROVISIONAL_CONFIG.charging,
  );

  // --- Grafo, cohortes y vueltas (F2) -------------------------------------------------------
  //
  // El agrupamiento va primero porque las vueltas se segmentan **por cohorte**: dos circuitos
  // mezclados no comparten ancla, y buscar un ciclo dominante sobre los dos a la vez produciría un
  // ancla sin sentido para ninguno.
  const { transitions } = buildTransitions(readings, direction, coverage);
  const cohortAssignment = assignCohorts(readings, transitions);

  const laps: Lap[] = [];
  const shapes: CircuitViews["shapes"][number][] = [];
  const matrices: CircuitViews["readMatrices"][number][] = [];
  const vehicleReadings: CircuitViews["vehicleReading"][number][] = [];
  // Cambios de tag dentro de un mismo periodo (R-DAT-019), antes que la matriz: cuándo empezó o dejó
  // de leerse cada tag es lo que hace falta para medirlo solo dentro de su vida (R-OPP-016).
  const tagChanges = detectTagChanges(readings, direction, coverage, PROVISIONAL_CONFIG.tagChanges, {
    minPassesForNever: PROVISIONAL_CONFIG.vehicleReading.minPassesForNever,
    highRate: PROVISIONAL_CONFIG.readRate.highRate,
    minAdoptionShare: PROVISIONAL_CONFIG.drift.minAdoptionShare,
  });
  const fifoCohorts: NonNullable<CircuitViews["fifo"]>[number][] = [];
  const criticalPointCohorts: CircuitViews["criticalPoints"][number][] = [];
  /** El ancla efectiva de cada cohorte (declarada si se resolvió, si no la inferida). */
  const anchors = new Map<number, LapAnchor>();
  const lapAnchorProblems: string[] = [];
  /** Lo que suele tardar cada tramo del anillo, por turno, para el cohorte de cada AGV (R-AGV-017). */
  const usualByVehicle = new Map<string, UsualTimes>();
  // Cuándo estuvo parada la producción (R-AGV-018): ningún tag crítico leído, y no por azar. Va antes
  // que cualquier tiempo habitual, porque un descanso no mide un tramo.
  const production = productionStops(
    readings,
    new Set(criticalPointsConfig.funcionOf.keys()),
    coverage,
    zone,
    PROVISIONAL_CONFIG.silenceKind.shiftStartHours,
    PROVISIONAL_CONFIG.flowStops,
  );
  const laneTags = new Set(laneConfig.lanes.flatMap((lane) => [...lane.tags]));
  const flowReports: FlowReport[] = [];
  // Régimen de cada instante (R-TIM-009): la noche se mide aparte y no altera el estado normal.
  const regimeOf = regimeReader(zone, PROVISIONAL_CONFIG.regimes);
  const circuitStateCohorts: CircuitViews["circuitState"]["cohorts"][number][] = [];
  // Una franja es un fichero (R-TIM-011): su ventana completa. Sin almacén, la del fichero importado.
  const windows = franjaWindows(
    stored !== undefined
      ? stored.sources.map((source) => ({
          sourceId: source.sourceId,
          sourceHash: source.sourceHash,
          fileName: source.fileName,
          complete: source.complete,
        }))
      : [{ ...importedSource, complete: sourceCoverage(imported).complete }],
  );
  const measuredWindows = windows.filter((entry) => entry.duplicateOf === null);
  // Los tramos de cobertura donde se buscan cambios de estructura, y los instantes de los cambios de
  // tag que los agrupan (R-DAT-021). Sin almacén, el tramo es el del fichero importado.
  const structureSpans =
    coverage.length > 0
      ? mergeIntervals([...coverage])
      : [
          readings.reduce(
            (span, reading) => ({ from: Math.min(span.from, reading.time.utcMs), to: Math.max(span.to, reading.time.utcMs) }),
            { from: Infinity, to: -Infinity },
          ),
        ];
  const changeTimes = tagChanges.changes.flatMap((change) =>
    change.kind === "cambio" ? [change.oldLastUtcMs, change.newFirstUtcMs] : [change.kind === "deja" ? change.lastUtcMs : change.firstUtcMs],
  );
  const franjaCohorts: CircuitViews["franjas"]["cohorts"][number][] = [];

  for (const cohort of cohortAssignment.cohorts) {
    const vehicleSet = new Set(cohort.vehicles);
    const cohortTransitions = transitions.filter((entry) => vehicleSet.has(entry.agvId));
    const anchor = findDominantCycle(cohortTransitions);
    if (anchor === null) continue; // Sin ciclo dominante limpio: ese cohorte no tiene vueltas segmentadas.

    // Ancla declarada (R-GRA-009): la topología la sigue dando el tráfico observado, y una ancla
    // declarada solo rota dónde se corta ese mismo ciclo. Sin ninguna declarada, o si ninguna de
    // las declaradas aparece en el ciclo reconstruido, se sigue con la inferida — sin fingir un
    // corte que el dato no sostiene.
    let effective: LapAnchor = anchor;
    let anchorTruth: TruthState = "inferred";
    if (lapAnchorsConfig.anchors.length > 0) {
      const resolved = resolveDeclaredAnchor(anchor, lapAnchorsConfig.anchors);
      if (resolved === null) {
        lapAnchorProblems.push(
          `Cohorte ${cohort.id}: ninguna de las anclas declaradas aparece en el ciclo ` +
            `reconstruido; se sigue usando el ancla inferida «${anchor.tagId}».`,
        );
      } else {
        effective = { tagId: resolved.tagId, cycle: resolved.cycle, weakestShare: anchor.weakestShare };
        anchorTruth = "observed";
      }
    }
    anchors.set(cohort.id, effective);

    // Lecturas que llegaron juntas al servidor (R-DAT-020): la hora del fichero es la de llegada, así
    // que un hueco seguido de una ráfaga no es una parada. Se juzga con una horquilla previa —una
    // ráfaga es rara y apenas la mueve— y desde aquí todo lo de tiempos usa la ráfaga colapsada.
    const preliminaryBands = buildSegmentBands(
      measurableTransitions(outsideProductionStops(cohortTransitions, production.stops), coverage, laneTags),
      effective.cycle,
      regimeOf,
      PROVISIONAL_CONFIG.bands,
      PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
    );
    const grouped = collapseGroupedDeliveries(
      cohortTransitions,
      preliminaryBands,
      regimeOf,
      PROVISIONAL_CONFIG.readRate.minTimeRatio,
      laneTags,
      PROVISIONAL_CONFIG.groupedDelivery,
    );
    const cohortTimeline = grouped.transitions;

    // Las transiciones que cruzan una parada de la producción no miden ningún tramo.
    const timedTransitions = outsideProductionStops(cohortTimeline, production.stops);
    const usual = usualSegmentTimes(
      timedTransitions,
      effective.cycle,
      zone,
      PROVISIONAL_CONFIG.silenceKind.shiftStartHours,
    );
    for (const agvId of cohort.vehicles) usualByVehicle.set(agvId, usual);
    // La horquilla de cada tramo, por régimen (R-FLO-007): solo con transiciones que miden algo.
    const measuredTimed = measurableTransitions(timedTransitions, coverage, laneTags);
    const bands = buildSegmentBands(
      measuredTimed,
      effective.cycle,
      regimeOf,
      PROVISIONAL_CONFIG.bands,
      PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
    );
    const flow = flowStops(
      {
        transitions: cohortTimeline,
        coverage,
        bands,
        regimeOf,
        production,
        laneTags,
        functionOf: criticalPointsConfig.funcionOf,
      },
      PROVISIONAL_CONFIG.flowStops,
    );
    flowReports.push(flow);

    const cohortReadings = readings.filter((entry) => vehicleSet.has(entry.agvId));
    laps.push(...segmentLaps(cohortReadings, direction, coverage, effective.tagId, anchorTruth));

    // El ciclo dominante **es** la composición del circuito: cuántos tags lo forman y en qué orden.
    // Estaba calculado desde F2 y se descartaba entero salvo el tag de ancla.
    //
    // Y lo que queda fuera del ciclo no se puede callar: un tag que se lee tan poco que el sucesor
    // dominante lo salta **desaparecería del análisis justo por ser el más sospechoso**. Se cuentan
    // aparte, con sus lectores, sin decidir si son ramas o tags de la línea mal leídos — eso lo
    // separa la prueba de tiempos de OQ-118, que todavía no está implementada.
    const inRing = new Set(effective.cycle);
    const offRing = new Map<string, Set<string>>();
    for (const entry of cohortReadings) {
      if (inRing.has(entry.tagId)) continue;
      let readers = offRing.get(entry.tagId);
      if (readers === undefined) {
        readers = new Set();
        offRing.set(entry.tagId, readers);
      }
      readers.add(entry.agvId);
    }

    // Para dibujar el anillo: la zona de cada tag (solo con la lista `zona`) y el tag del anillo
    // del que cuelga cada calle (solo con la lista `carga-online`). Proyecciones de lo ya leído.
    const servedLanes = new Set(charging.lanes.filter((lane) => lane.served).map((lane) => lane.laneId));
    shapes.push({
      cohortId: cohort.id,
      vehicles: cohort.vehicles.length,
      tags: effective.cycle,
      anchorTagId: effective.tagId,
      anchorTruth,
      weakestShare: effective.weakestShare,
      offRingTags: [...offRing.entries()]
        .map(([tagId, readers]) => ({ tagId, readers: readers.size }))
        .sort((a, b) => b.readers - a.readers),
      ...(zoneConfig.zoneOf.size === 0
        ? {}
        : { zones: effective.cycle.map((tagId) => zoneConfig.zoneOf.get(tagId) ?? null) }),
      ...(laneConfig.lanes.length === 0
        ? {}
        : {
            laneJunctions: findLaneJunctions(laneConfig.lanes, cohortTransitions, effective.cycle).map(
              (junction) => ({ ...junction, served: servedLanes.has(junction.laneId) }),
            ),
          }),
    });
    const matrix = buildReadMatrix(
      cohort.id,
      cohortReadings,
      direction,
      coverage,
      effective.cycle,
      effective.tagId,
      PROVISIONAL_CONFIG.readRate,
      orderLimits,
      PROVISIONAL_CONFIG.trend,
      tagChanges.lives,
    );
    matrices.push(matrix);
    vehicleReadings.push({
      cohortId: cohort.id,
      ...describeVehicleReading(matrix, PROVISIONAL_CONFIG.readRate, PROVISIONAL_CONFIG.vehicleReading),
    });

    // FIFO en zona cargada (R-FLO-001): los tramos son propiedad del anillo de este cohorte, así
    // que se derivan aquí, no una sola vez fuera del bucle como las calles (que son de circuito).
    if (zoneConfig.zoneOf.size > 0) {
      const { spans, problems: spanProblems } = loadedZoneSpans(effective.cycle, zoneConfig.zoneOf);
      const fifoReport = buildFifoReport(cohort.id, cohortReadings, spans, PROVISIONAL_CONFIG.fifo);
      fifoCohorts.push({ cohortId: cohort.id, spans: fifoReport.spans, problems: spanProblems });
    }

    // Candidatos a punto crítico (R-GRA-007): sobre las transiciones del cohorte entero, no solo el
    // anillo — restringir a `anchor.cycle` escondería justo la rama fuera de él que la firma busca.
    const bifurcaciones = findBifurcationCandidates(cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.bifurcacion);
    const conCruces = classifyCrossings(bifurcaciones, cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.cruce);
    // Las firmas de tiempo, solo en producción: un descanso de 15 min rompería el coeficiente de
    // variación de una parada precisa (R-AGV-018), y la noche tiene su propio ritmo (R-TIM-009).
    const productionTimed = timedTransitions.filter((transition) => transitionRegime(transition, regimeOf) === "produccion");
    const paradas = findPrecisePauseCandidates(productionTimed, PROVISIONAL_CONFIG.criticalPoints.paradaPrecisa);
    const semaforos = findTrafficLightCandidates(productionTimed, PROVISIONAL_CONFIG.criticalPoints.semaforo);
    // Para dibujar la distribución que la firma resume: las duraciones de cada candidato de tiempo y
    // una muestra de referencia con todas las del cohorte (sin pares del mismo instante, R-DAT-013).
    const durations = transitionDurationsByTag(productionTimed);
    const allDurations = [...durations.values()].flat();
    criticalPointCohorts.push({
      cohortId: cohort.id,
      candidates: [
        ...conCruces,
        ...[...paradas, ...semaforos].map((candidate) => ({
          ...candidate,
          durationsMs: strideSample(durations.get(candidate.tagId) ?? [], DURATION_SAMPLE_MAX),
        })),
      ],
      referenceDurationsMs: strideSample(allDurations, DURATION_SAMPLE_MAX),
      referenceTotal: allDurations.length,
    });

    // El estado normal del circuito (R-TIM-009): una parada precisa o un semáforo, declarados o
    // candidatos, explican su espera y no son zona oscura.
    const timeCritical = new Map<string, string>();
    for (const [tagId, functionName] of criticalPointsConfig.funcionOf) {
      if (functionName === "parada-precisa" || functionName === "semaforo") timeCritical.set(tagId, functionName);
    }
    for (const candidate of [...paradas, ...semaforos]) {
      if (!timeCritical.has(candidate.tagId)) timeCritical.set(candidate.tagId, candidate.kind);
    }
    // La medición de cada fichero (R-TIM-011), con las mismas transiciones limpias.
    const measures = measuredWindows.map((entry) => ({
      sourceId: entry.source.sourceId,
      ...measureFranjaCohort(
        { cohortId: cohort.id, transitions: cohortTimeline, measured: measuredTimed, anchorTagId: effective.tagId },
        entry.window,
        regimeOf,
        PROVISIONAL_CONFIG.bands,
        PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
        PROVISIONAL_CONFIG.franjas,
        PROVISIONAL_CONFIG.tagChanges.maxReadsBetween,
      ),
    }));
    // Tags insertados y sustituidos, por la suma entre anclas (R-DAT-021): entre ficheros seguidos, y
    // alrededor de cada grupo de cambios de tag dentro de un tramo de cobertura. Un mismo conjunto de
    // tags cambiados se enseña una sola vez.
    const anchorContext: AnchorSumContext = {
      direction,
      coverage: structureSpans,
      laneTags,
      productionStops: production.stops.map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs })),
      regimeOf,
      deliveries: grouped.deliveries.map((delivery) => ({
        agvId: delivery.agvId,
        fromUtcMs: delivery.fromUtcMs,
        toUtcMs: delivery.toUtcMs,
      })),
      maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance,
      resolutionMs: preliminaryBands.resolutionMs,
    };
    // Las secuencias se preparan una vez. Dentro de un tramo de cobertura se mira alrededor de los
    // cambios de tag por su sitio (R-DAT-019) y de donde un tag empieza o deja de leerse: un bloque de
    // tags seguidos cambiado a la vez no tiene sitio que comparar, porque sus vecinos también cambiaron.
    const sequences = anchorSequences(cohortReadings, direction, structureSpans);
    const boundaries = structureBoundaries(sequences, structureSpans, PROVISIONAL_CONFIG.tagChanges.maxOverlapMs);
    // Un mismo cambio se enseña una vez. Primero dentro de cada fichero, que dice a qué hora; entre
    // ficheros solo lo que no esté ya dicho: los mismos tags, o menos, de un cambio ya enseñado.
    const structure: StructureSet[] = [];
    const shown: (readonly string[])[] = [];
    const keep = (gaps: readonly AnchorGapChange[]): AnchorGapChange[] =>
      gaps.filter((gap) => {
        const tags = changedTags(gap);
        if (shown.some((earlier) => tags.every((tagId) => earlier.includes(tagId)))) return false;
        shown.push(tags);
        return true;
      });
    for (const around of windowsAroundChanges([...changeTimes, ...boundaries], structureSpans, PROVISIONAL_CONFIG.tagChanges.maxOverlapMs)) {
      const gaps = keep(compareAnchorGaps(sequences, around.before, around.after, anchorContext, PROVISIONAL_CONFIG.anchorSums));
      if (gaps.length > 0) {
        structure.push({ source: "dentro-del-fichero", beforeSourceId: null, afterSourceId: null, atUtcMs: around.atUtcMs, gaps });
      }
    }
    for (let index = 1; index < measuredWindows.length; index += 1) {
      const early = measuredWindows[index - 1] as (typeof measuredWindows)[number];
      const late = measuredWindows[index] as (typeof measuredWindows)[number];
      const gaps = keep(compareAnchorGaps(sequences, early.window, late.window, anchorContext, PROVISIONAL_CONFIG.anchorSums));
      if (gaps.length > 0) {
        structure.push({
          source: "entre-ficheros",
          beforeSourceId: early.source.sourceId,
          afterSourceId: late.source.sourceId,
          atUtcMs: late.window.from,
          gaps,
        });
      }
    }
    franjaCohorts.push({ cohortId: cohort.id, measures, histories: segmentHistories(measures), structure });

    const size = effective.cycle.length;
    circuitStateCohorts.push({
      cohortId: cohort.id,
      resolutionMs: bands.resolutionMs,
      marginMs: bands.marginMs,
      bands: [...bands.pairs.values()]
        .filter((pair) => pair.produccion !== null || pair.noche !== null)
        .map((pair) => {
          const at = bands.positionOf.get(pair.from);
          const onRing = at !== undefined && size > 1 && effective.cycle[(at + 1) % size] === pair.to;
          return { ...pair, position: onRing ? (at as number) : null };
        })
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.from.localeCompare(b.from)),
      state: buildCircuitState(
        {
          bands,
          transitions: measuredTimed,
          regimeOf,
          flow,
          timeCritical,
          reachTags: PROVISIONAL_CONFIG.flowStops.reachTags,
          minVehicles: PROVISIONAL_CONFIG.readRate.minVehiclesForContrast,
          headStallMs: PROVISIONAL_CONFIG.flowStops.headStallMs,
        },
        PROVISIONAL_CONFIG.circuitState,
      ),
      groupedDelivery: {
        evaluated: grouped.evaluated,
        reason: grouped.reason,
        total: grouped.deliveries.length,
        deliveries: grouped.deliveries.slice(-DELIVERY_LIST_MAX),
        ...summarizeDeliveries(
          grouped.deliveries,
          measurableTransitions(cohortTransitions, coverage, laneTags),
          PROVISIONAL_CONFIG.circuitState.maxFalsePoints,
        ),
      },
      changes: bandChangesBetweenPeriods(
        measuredTimed,
        coverage,
        effective.cycle,
        regimeOf,
        PROVISIONAL_CONFIG.bands,
        PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
        PROVISIONAL_CONFIG.drift.minGapMs,
      ),
    });
  }

  // Un hueco entre dos exportaciones no es inactividad de nadie (R-DAT-007): el expediente recibe
  // los tramos de cobertura, no solo su final.
  const dossierCoverage =
    coverage.length > 0
      ? coverage
      : [{ from: (readings[0] as Reading).time.utcMs, to: (readings[readings.length - 1] as Reading).time.utcMs }];

  const agvDossiers = buildAllAgvDossiers(
    readings,
    cohortAssignment,
    laps,
    dossierCoverage,
    PROVISIONAL_CONFIG.silence.minGapMs,
    laneConfig.lanes,
  );
  const vehicleIds = agvDossiers.map((dossier) => dossier.agvId);
  const tagDossiers = buildAllTagDossiers(readings, vehicleIds, criticalPointsConfig.funcionOf);

  const replayFrames = buildReplayFrames(readings, REPLAY_FRAMES, PROVISIONAL_CONFIG.silence.minGapMs);

  // La flota a lo largo del tiempo (DS-012, R-AGV-014): reutiliza las inactividades del expediente
  // y los arranques en frío de las calles, y recorta todo a la cobertura (R-DAT-007). Cada hueco sin
  // carga lleva cómo reapareció el AGV (R-AGV-017): el expediente no cambia, esto solo alimenta la
  // vida de cada AGV.
  const maintenance = new Set(entriesOf("mantenimiento").map((entry) => entry.tagId));
  // Qué hacía el resto durante cada hueco (R-AGV-018): la parada de ese AGV que empieza donde empieza
  // el hueco, o, si no se pudo medir, si el hueco cae en una parada de la producción.
  const stopOfGap = new Map<string, VehicleStop>();
  for (const report of flowReports) {
    for (const stop of report.stops) stopOfGap.set(`${stop.agvId}\u0000${stop.fromUtcMs}`, stop);
  }
  const blockageBehind = new Map<string, number>();
  for (const report of flowReports) {
    for (const blockage of report.blockages) {
      if (blockage.behind.length > 0) blockageBehind.set(`${blockage.agvId}\u0000${blockage.fromUtcMs}`, blockage.behind.length);
    }
  }
  const productionIntervals = production.stops.map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs }));
  const justificationOf = (agvId: string, from: number, to: number) => {
    const stop = stopOfGap.get(`${agvId}\u0000${from}`);
    if (stop !== undefined) return stop.justification;
    const stopped = productionIntervals.reduce(
      (sum, stop) => sum + Math.max(0, Math.min(to, stop.to) - Math.max(from, stop.from)),
      0,
    );
    return stopped >= 0.5 * (to - from) ? ("produccion" as const) : null;
  };
  const fleet = buildFleetTimeline({
    readings,
    coverage,
    history: stored?.fleet?.periods ?? null,
    inactivity: new Map(
      agvDossiers.map((dossier) => [
        dossier.agvId,
        dossier.inactivity.map((gap) => {
          if (gap.cause === "carga-online") return gap;
          const justification = justificationOf(dossier.agvId, gap.fromUtcMs, gap.toUtcMs);
          return {
            ...gap,
            justification,
            blocking: blockageBehind.get(`${dossier.agvId}\u0000${gap.fromUtcMs}`) ?? 0,
            ...classifySilence(
              gap,
              { usual: usualByVehicle.get(dossier.agvId) ?? null, maintenance, justification },
              PROVISIONAL_CONFIG.silenceKind,
            ),
          };
        }),
      ]),
    ),
    coldStarts: new Map(
      charging.startedInside
        .filter((stay) => stay.leftUtcMs !== null)
        .map((stay) => [stay.agvId, stay.leftUtcMs as number]),
    ),
    minGapMs: PROVISIONAL_CONFIG.silence.minGapMs,
    longAbsenceMs: PROVISIONAL_CONFIG.silenceKind.longAbsenceMs,
    productionStops: productionIntervals,
  });

  // Cómo salió cada AGV de cada parada de la producción, sumando los cohortes.
  const productionView = {
    basis: production.basis,
    basisTags: production.basisTags,
    stops: production.stops.map((stop, index) => {
      const flows = flowReports.map((report) => report.productionFlow[index]).filter((flow) => flow !== undefined);
      const orders = flows.map((flow) => flow.orderKept).filter((kept): kept is boolean => kept !== null);
      return {
        ...stop,
        vehicles: flows.reduce((sum, flow) => sum + flow.vehicles, 0),
        inPlace: flows.reduce((sum, flow) => sum + flow.inPlace, 0),
        notInPlace: flows.flatMap((flow) => flow.notInPlace),
        orderKept: orders.length === 0 ? null : orders.every(Boolean),
        orderChanges: flows.flatMap((flow) => flow.orderChanges),
      };
    }),
  };
  const blockages = flowReports
    .flatMap((report) => report.blockages)
    .sort((a, b) => b.behind.length - a.behind.length || b.excessMs - a.excessMs);

  const views: CircuitViews = {
    hourly: hourlyProfile(readings, zone),
    activity: activityBand(readings, coverage, ACTIVITY_BINS),
    cohorts: cohortAssignment.cohorts,
    shapes,
    readMatrices: matrices,
    vehicleReading: vehicleReadings,
    tagChanges: { changes: tagChanges.changes, adoption: tagChanges.adoption },
    agvDossiers,
    tagDossiers,
    replay: replayFrames.map((frame) => ({ atUtcMs: frame.atUtcMs, vehicles: [...frame.vehicles] })),
    fleet: { ...fleet, circuitName: stored?.fleet?.circuitName ?? null, production: productionView, blockages },
    franjas: {
      sources: windows.map((entry) => ({
        sourceId: entry.source.sourceId,
        fileName: entry.source.fileName,
        from: entry.window.from,
        to: entry.window.to,
        duplicateOf: entry.duplicateOf,
        exposure: regimeExposure([entry.window], productionIntervals, regimeOf),
      })),
      cohorts: franjaCohorts,
    },
    ...(laneConfig.lanes.length === 0 && laneConfig.problems.length === 0
      ? {}
      : {
          charging: {
            lanes: charging.lanes.map((lane) => ({
              laneId: lane.laneId,
              capacity: lane.capacity,
              served: lane.served,
              stays: lane.stays.length,
              stayList: lane.stays.map((stay) => ({
                agvId: stay.agvId,
                enteredUtcMs: stay.enteredUtcMs,
                leftUtcMs: stay.leftUtcMs,
                state: stay.state,
              })),
              medianStayMs: lane.medianStayMs,
              longStays: lane.longStays.map((stay) => ({
                agvId: stay.agvId,
                durationMs: stay.durationMs,
              })),
              outOfSeniority: lane.outOfSeniority.map((breach) => ({
                waited: breach.waited,
                overtakenBy: [...breach.overtakenBy],
                waitedMs: breach.waitedMs,
              })),
            })),
            startedInside: charging.startedInside.map((stay) => ({
              agvId: stay.agvId,
              laneId: stay.laneId,
              leftUtcMs: stay.leftUtcMs,
            })),
            coverageStartUtcMs: charging.coverageStartUtcMs,
            neverCharged: charging.neverCharged,
            problems: [...laneConfig.problems, ...zoneConfig.problems],
          },
        }),
    ...(zoneConfig.zoneOf.size === 0
      ? {}
      : {
          zones: [...new Set(zoneConfig.zoneOf.values())].sort().map((zoneName) => ({
            zone: zoneName,
            tags: [...zoneConfig.zoneOf].filter(([, value]) => value === zoneName).length,
          })),
        }),
    ...(fifoCohorts.length === 0 ? {} : { fifo: fifoCohorts }),
    orderWithheld: matrices.reduce((total, matrix) => total + matrix.orderWithheld, 0),
    criticalPoints: criticalPointCohorts,
    circuitState: {
      exposure: regimeExposure(dossierCoverage, productionIntervals, regimeOf),
      night: {
        fromHour: PROVISIONAL_CONFIG.regimes.nightFromHour,
        toHour: PROVISIONAL_CONFIG.regimes.nightToHour,
      },
      cohorts: circuitStateCohorts,
    },
    ...(lapAnchorsConfig.problems.length === 0 && lapAnchorProblems.length === 0
      ? {}
      : { lapAnchorProblems: [...lapAnchorsConfig.problems, ...lapAnchorProblems] }),
  };

  if (lists.length === 0) return views;

  const byName = (name: string): ReadonlySet<string> =>
    new Set(lists.find((entry) => entry.list === name)?.tags ?? []);
  const unservedLaneTags = new Set(
    charging.lanes
      .filter((lane) => !lane.served)
      .flatMap((lane) => laneConfig.lanes.find((item) => item.laneId === lane.laneId)?.tags ?? []),
  );
  const knownTags = new Set([
    ...byName("circuito"),
    ...byName("memoria"),
    ...byName("mantenimiento"),
    ...byName("emergencia"),
    ...byName("carga-online"),
    ...criticalPointsConfig.funcionOf.keys(),
  ]);
  const inventory = buildTagInventory(
    readings,
    {
      virtual: byName("circuito"),
      memory: byName("memoria"),
      maintenance: byName("mantenimiento"),
      emergency: byName("emergencia"),
      charging: byName("carga-online"),
      unservedLaneTags,
      critical: criticalPointsConfig.funcionOf,
    },
    PROVISIONAL_CONFIG.blindness,
  );

  // Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013): usa la cobertura que ya existe
  // -la unión de todas las fuentes aceptadas-, nunca un segundo fichero pedido aparte.
  const drift = compareDistantPeriods(readings, coverage, knownTags, PROVISIONAL_CONFIG.drift);

  const counts = new Map<string, number>();
  const truthOf = new Map<string, string>();
  const actionOf = new Map<string, string>();
  for (const row of inventory.rows) {
    counts.set(row.tagClass, (counts.get(row.tagClass) ?? 0) + 1);
    truthOf.set(row.tagClass, row.truth);
    actionOf.set(row.tagClass, describeAction(row.action));
  }

  // El contraste contra Vsystem exige un **orden**, no solo la pertenencia al circuito: sin orden,
  // la lista es un conjunto y no hay secuencia con la que alinear el anillo. El orden declarado es
  // el orden en que el fichero trae las filas de la lista `circuito` — el importador lo conserva
  // (`Set` mantiene el primer orden de aparición) — así que no hace falta guardar una columna aparte.
  const declaredOrder = [...byName("circuito")];

  let vsystemContrast: CircuitViews["vsystemContrast"];
  const mainCohort = cohortAssignment.cohorts[0];
  if (declaredOrder.length > 0 && mainCohort !== undefined) {
    // El anillo observado con el que se contrasta: el ciclo dominante del cohorte mayor, que es el
    // que tiene más soporte y por tanto la reconstrucción más fiable. Ya se calculó arriba.
    const anchor = anchors.get(mainCohort.id);
    if (anchor !== undefined) {
      vsystemContrast = compareAgainstVsystem(
        declaredOrder,
        anchor.cycle,
        new Set(readings.map((entry) => entry.tagId)),
      );
    }
  }

  return {
    ...views,
    inventory: {
      counts: [...counts.entries()].map(([tagClass, count]) => ({
        tagClass,
        count,
        truth: truthOf.get(tagClass) ?? "unknown",
        action: actionOf.get(tagClass) ?? "",
      })),
      listsLoaded: lists.map((entry) => entry.list),
    },
    ...(vsystemContrast === undefined ? {} : { vsystemContrast }),
    ...(criticalPointsConfig.problems.length === 0
      ? {}
      : { criticalPointsProblems: criticalPointsConfig.problems }),
    ...(!drift.evaluated || drift.earlyPeriod === null || drift.latePeriod === null
      ? {}
      : {
          drift: {
            earlyPeriod: drift.earlyPeriod,
            latePeriod: drift.latePeriod,
            tagDrifts: drift.tagDrifts.map((entry) => ({
              tagId: entry.tagId,
              kind: entry.kind,
              readingsBefore: entry.kind === "desaparecido" || entry.kind === "sustitucion-candidata" ? entry.readingsBefore : 0,
              readingsAfter: entry.kind === "nuevo" || entry.kind === "sustitucion-candidata" ? entry.readingsAfter : 0,
              ...(entry.kind === "sustitucion-candidata"
                ? { nuevoTagId: entry.nuevoTagId, sharedNeighbor: entry.sharedNeighbor, neighborSide: entry.neighborSide }
                : {}),
            })),
            vehicleDrifts: drift.vehicleDrifts.map((entry) => ({
              agvId: entry.agvId,
              droppedTags: entry.droppedTags,
              notAdoptedTags: entry.notAdoptedTags,
            })),
          },
        }),
  };
}

async function runImport(message: Extract<ToWorker, { type: "start" }>): Promise<void> {
  const { jobId, file, zone } = message;
  const stages: readonly Stage[] = ["hashing", "sampling", "parsing", "ordering", "done"];
  emit({ type: "accepted", stages }, jobId);

  let buffer: ArrayBuffer;
  try {
    emit({ type: "progress", stage: "hashing", done: 0, total: 1, note: "Leyendo el fichero" }, jobId);
    buffer = await file.arrayBuffer();
  } catch {
    emit(
      {
        type: "error",
        code: "SOURCE_UNREADABLE",
        cause: "El fichero no pudo leerse desde el disco.",
        recovery: "Comprueba que sigue disponible y vuelve a seleccionarlo.",
      },
      jobId,
    );
    return;
  }

  if (cancelRequested) {
    emit({ type: "cancelled", stage: "hashing" }, jobId);
    return;
  }

  const sourceHash = await hashFile(buffer);
  const { text, encoding } = decodeSource(buffer);

  try {
    const result = importReadings(
      text,
      {
        sourceId: sourceHash,
        fileName: file.name,
        byteSize: file.size,
        zone,
        encoding,
        fieldOrder: message.fieldOrder,
      },
      {
        onProgress: (stage, done, total, note) =>
          emit({ type: "progress", stage, done, total, note }, jobId),
        isCancelled: () => cancelRequested,
      },
    );
    // La acumulación ocurre **después** de que la importación haya terminado del todo, y en una
    // sola transacción: cancelar a mitad no deja nada escrito (INV-006).
    const accumulation =
      message.circuitId === undefined
        ? undefined
        : await accumulate(message.circuitId, message.circuitName ?? message.circuitId, zone, result);

    // Las vistas se calculan sobre lo que se está mirando: el circuito entero si la fuente se
    // acumuló, y solo esta fuente si no. Calcularlas siempre sobre el circuito sería mentir cuando
    // la afinidad ha impedido acumular, porque el usuario estaría viendo un conjunto que no
    // incluye el fichero que acaba de cargar.
    const views = await buildViews(message.circuitId, accumulation, result.readings, zone, result.summary.direction, result.summary);

    emit(
      {
        type: "complete",
        summary: result.summary,
        readings: result.readings,
        quarantine: result.quarantine,
        warnings: result.warnings,
        ...(accumulation === undefined ? {} : { accumulation }),
        ...(views === undefined ? {} : { views }),
      },
      jobId,
    );
  } catch (error) {
    if (error instanceof ImportCancelled) {
      emit({ type: "cancelled", stage: error.stage }, jobId);
      return;
    }
    if (error instanceof ImportFailure) {
      emit(
        {
          type: "error",
          code: error.code,
          // El protocolo llama `cause` a lo que la clase llama `reason`.
          cause: error.reason,
          recovery: error.recovery,
          ...(error.detectedSchema === undefined ? {} : { detectedSchema: error.detectedSchema }),
          ...(error.sampleRows === undefined ? {} : { sampleRows: error.sampleRows }),
        },
        jobId,
      );
      return;
    }
    emit(
      {
        type: "error",
        code: "INTERNAL",
        cause: "Fallo no previsto del motor de importación.",
        recovery: "Vuelve a intentarlo; si persiste, es un defecto y debe reproducirse con un fixture sintético.",
      },
      jobId,
    );
  }
}

/**
 * Carga las listas de tags de un circuito y las guarda **con él**.
 *
 * Con el circuito y no aparte porque son parte de su estado en el momento del análisis: repetir un
 * análisis de hace tres meses tiene que usar las listas de hace tres meses. Si el técnico aplica
 * los cambios propuestos y vuelve a cargarlas, el análisis siguiente las recoge ya actualizadas y
 * el anterior sigue explicándose con las suyas.
 */
async function runLists(message: Extract<ToWorker, { type: "lists" }>): Promise<void> {
  const { jobId, file, circuitId } = message;
  if (!isAvailable()) {
    emit(
      {
        type: "error",
        code: "INTERNAL",
        cause: "Este navegador no permite guardar datos de sitio.",
        recovery: "Sin almacén local no hay dónde guardar las listas del circuito.",
      },
      jobId,
    );
    return;
  }

  try {
    const { text } = decodeSource(await file.arrayBuffer());
    const result = importCatalog(text);
    const existing = await loadCircuit(circuitId);
    if (existing === undefined) {
      emit(
        {
          type: "error",
          code: "INTERNAL",
          cause: `El circuito «${circuitId}» todavía no existe.`,
          recovery: "Importa al menos una fuente de lecturas en ese circuito y vuelve a intentarlo.",
        },
        jobId,
      );
      return;
    }

    const loadedAt = Date.now();
    const incoming = [...result.lists.entries()].map(([list, entries]) => ({
      list,
      tags: [...new Set(entries.map((entry) => entry.tagId))],
      // Los metadatos se guardan **sin deduplicar**: un tag repetido en la misma calle es una
      // contradicción de la lista, y quien lee la configuración tiene que poder verla y decirla,
      // no encontrársela ya resuelta a favor de la primera fila.
      entries: entries.map((entry) => ({
        tagId: entry.tagId,
        order: entry.order,
        funcion: entry.funcion,
        grupo: entry.grupo,
        capacidad: entry.capacidad,
        note: entry.note,
      })),
      extractedAt: message.extractedAt ?? null,
      loadedAt,
      fileName: file.name,
    }));
    // Una lista cargada de nuevo **sustituye** a la suya anterior y no se fusiona: fusionar haría
    // imposible retirar un tag de una lista, que es justo una de las acciones que el inventario
    // propone. Las demás listas se conservan.
    const kept = (existing.lists ?? []).filter(
      (stored) => !incoming.some((entry) => entry.list === stored.list),
    );
    await saveCircuit({ ...existing, lists: [...kept, ...incoming], updatedAt: loadedAt });

    emit(
      {
        type: "lists-loaded",
        circuitId,
        lists: incoming.map((entry) => ({ list: entry.list, tags: entry.tags.length })),
        accepted: result.accepted,
        rejected: result.rejected.length,
        warnings: result.warnings,
        unknownLists: result.unknownLists,
      },
      jobId,
    );
  } catch (error) {
    const failure = error instanceof CatalogFailure ? error : null;
    emit(
      {
        type: "error",
        code: "SCHEMA_UNRECOGNISED",
        cause: failure?.reason ?? "No se pudo leer el fichero de listas.",
        recovery:
          failure?.recovery ??
          `Se espera una cabecera «${EXPECTED_STRUCTURE.header.join(";")}» y una fila por tag.`,
      },
      jobId,
    );
  }
}

const FLEET_REJECTION_LABEL: Readonly<Record<string, string>> = {
  SIN_AGV: "sin AGV",
  FECHA_INVALIDA: "fecha no válida (día/mes/año)",
  HASTA_ANTES_DE_DESDE: "«hasta» no posterior a «desde»",
  CAMPOS_INSUFICIENTES: "faltan columnas en la fila",
};

/**
 * Carga el historial de flota de un circuito (DS-012) y lo **fusiona** con el guardado por (AGV,
 * `desde`): para registrar un cambio basta subir esa fila. Si el fichero trae varios circuitos y
 * ninguno está elegido, pregunta cuál es este en lugar de elegirlo por proximidad del nombre.
 */
async function runFleet(message: Extract<ToWorker, { type: "fleet" }>): Promise<void> {
  const { jobId, file, circuitId } = message;
  const fail = (cause: string, recovery: string): void =>
    emit({ type: "error", code: "INTERNAL", cause, recovery }, jobId);
  if (!isAvailable()) {
    fail("Este navegador no permite guardar datos de sitio.", "Sin almacén local no hay dónde guardar el historial.");
    return;
  }
  try {
    const existing = await loadCircuit(circuitId);
    if (existing === undefined) {
      fail(
        `El circuito «${circuitId}» todavía no existe.`,
        "Importa al menos una fuente de lecturas en ese circuito y vuelve a intentarlo.",
      );
      return;
    }
    const { text } = decodeSource(await file.arrayBuffer());
    const result = importFleetHistory(text, existing.zone);

    let circuitName: string | null = null;
    if (result.circuits.length > 1) {
      const wanted = message.circuitName ?? existing.fleet?.circuitName ?? undefined;
      if (wanted === undefined || !result.circuits.some((entry) => entry.name === wanted)) {
        emit({ type: "fleet-choose-circuit", circuitId, options: result.circuits }, jobId);
        return;
      }
      circuitName = wanted;
    } else if (result.circuits.length === 1) {
      circuitName = result.circuits[0]?.name ?? null;
    }
    const incoming = result.rows
      .filter((row) => circuitName === null || row.circuit === circuitName || row.circuit === "")
      .map((row) => ({ agvId: row.agvId, fromUtcMs: row.fromUtcMs, toUtcMs: row.toUtcMs, note: row.note }));
    const merged = mergeFleetPeriods(existing.fleet?.periods ?? [], incoming);
    const loadedAt = Date.now();
    await saveCircuit({
      ...existing,
      fleet: {
        circuitName,
        periods: merged.periods,
        loadedAt,
        fileNames: [...(existing.fleet?.fileNames ?? []), file.name],
      },
      updatedAt: loadedAt,
    });

    const rejectedBy = new Map<string, number>();
    for (const row of result.rejected) {
      const label = FLEET_REJECTION_LABEL[row.reason] ?? row.reason;
      rejectedBy.set(label, (rejectedBy.get(label) ?? 0) + 1);
    }
    emit(
      {
        type: "fleet-loaded",
        circuitId,
        circuitName,
        accepted: incoming.length,
        rejected: [...rejectedBy.entries()].map(([reason, rows]) => ({ reason, rows })),
        added: merged.added,
        replaced: merged.replaced,
        periods: merged.periods.length,
        warnings: result.warnings,
      },
      jobId,
    );
  } catch (error) {
    const failure = error instanceof FleetFailure ? error : null;
    emit(
      {
        type: "error",
        code: "SCHEMA_UNRECOGNISED",
        cause: failure?.reason ?? "No se pudo leer el historial de flota.",
        recovery: failure?.recovery ?? `Se espera una cabecera «${FLEET_STRUCTURE.header.join(";")}».`,
      },
      jobId,
    );
  }
}

scope.onmessage = (event: MessageEvent<ToWorker>): void => {
  const message = event.data;
  if (message.protocolVersion !== PROTOCOL_VERSION) return;

  if (message.type === "lists") {
    currentJobId = message.jobId;
    seq = 0;
    void runLists(message);
    return;
  }

  if (message.type === "fleet") {
    currentJobId = message.jobId;
    seq = 0;
    void runFleet(message);
    return;
  }

  if (message.type === "cancel") {
    // Solo cancela el trabajo vigente: una cancelación tardía de otro trabajo no afecta a este.
    if (message.jobId === currentJobId) cancelRequested = true;
    return;
  }

  currentJobId = message.jobId;
  cancelRequested = false;
  seq = 0;
  void runImport(message);
};
