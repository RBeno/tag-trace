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
import { rowsToDelimitedText } from "../src/ingestion/xlsx-readings.js";
import { declaredTagInfo, tagSections } from "../src/domain/tag-info.js";
import { measureAnchorSections } from "../src/domain/anchor-sections.js";
import { reinforcementGroups, reinforcementPartners } from "../src/domain/critical-reinforcement.js";
import { buildListCleanup } from "../src/domain/list-cleanup.js";
import { lineStopExclusion, measureLineFeed, outsideLineStops } from "../src/domain/line-feed.js";
import {
  abandonedReadings,
  buildIncidentContext,
  incidentBattery,
  type Incident,
  type IncidentKind,
  type IncidentRecord,
} from "../src/domain/incident-battery.js";
import { dominantNeighbours, locateUndeclaredTags } from "../src/domain/undeclared-tags.js";
import { reconcileCircuitOrder } from "../src/domain/circuit-order.js";
import { CatalogFailure, EXPECTED_STRUCTURE, importCatalog, importCatalogRows } from "../src/ingestion/catalog.js";
import { looksLikeZip, readXlsxRows, XlsxError } from "../src/persistence/xlsx.js";
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
import { buildReadMatrix, type OrderEvidenceLimits, type ReadMatrix } from "../src/domain/read-matrix.js";
import { detectTagChanges, withoutTags } from "../src/domain/tag-changes.js";
import { describeVehicleReading } from "../src/domain/vehicle-reading.js";
import { buildChargingReport, findLaneJunctions } from "../src/domain/charging.js";
import { buildFifoReport, loadedZoneSpans } from "../src/domain/fifo.js";
import {
  classifyCrossings,
  findBifurcationCandidates,
  findPrecisePauseCandidates,
  findTrafficLightCandidates,
  timeSignaturesMeasurable,
  transitionDurationsByTag,
} from "../src/domain/critical-points.js";
import type { DriftComparison } from "../src/domain/drift.js";
import { buildFleetTimeline, mergeFleetPeriods } from "../src/domain/fleet.js";
import { classifySilence, usualSegmentTimes, type UsualTimes } from "../src/domain/silence-kind.js";
import {
  bandChangesBetweenPeriods,
  bandFor,
  buildSegmentBands,
  measurableTransitions,
  regimeExposure,
  regimeReader,
  transitionRegime,
} from "../src/domain/segment-bands.js";
import { buildCircuitState } from "../src/domain/circuit-state.js";
import { collapseGroupedDeliveries, summarizeDeliveries } from "../src/domain/grouped-delivery.js";
import { franjaWindows, measureFranjaCohort, segmentHistories } from "../src/domain/franjas.js";
import { paceInWindow, vehiclePace, type VehiclePaceThresholds } from "../src/domain/vehicle-pace.js";
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
import { FLEET_STRUCTURE, FleetFailure, importFleetHistory, importFleetRows } from "../src/ingestion/fleet-history.js";
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
import type { CircuitViews, MemoryViews, VersionSummary } from "../src/application/protocol.js";
import {
  isAvailable,
  loadCircuit,
  loadMemoryState,
  loadRetainedReadings,
  loadReviews,
  loadSnapshots,
  loadVersions,
  saveAccumulation,
  saveCircuit,
  saveMemory,
  saveSnapshot,
  saveVersion,
  type StoredCircuit,
  type StoredSource,
} from "../src/persistence/store.js";
import {
  compareToMemory,
  consolidate,
  currentVersion,
  emptyLineageState,
  previewConsolidation,
  previewWithoutSnapshot,
  resolveFork,
  revokeVersion,
  versionBytes,
  versionsOfLineage,
  withConsolidated,
  type ConsolidatedVersion,
  type ConsolidationPreview,
  type LineageState,
} from "../src/domain/memory.js";
import { findingKindOf } from "../src/domain/finding-kinds.js";
import { distinctSources, retainedSources } from "../src/persistence/retention.js";
import {
  buildSnapshot,
  compareSnapshots,
  driftBetweenSnapshots,
  historiesFromSnapshots,
  sortSnapshots,
  structureBetweenSnapshots,
  type CircuitSnapshot,
  type SnapshotDelta,
} from "../src/domain/snapshot.js";
import { anchorsOnRing } from "../src/domain/anchor-sections.js";
import { measureAnchorGaps } from "../src/domain/anchor-gaps.js";
import { buildSnapshotFindings } from "../src/domain/snapshot-findings.js";
import { assembleSnapshotInput } from "../src/application/snapshot-assembly.js";
import { APP_VERSION } from "../src/application/version.js";
import type { Reading } from "../src/domain/reading.js";
import type { SourceDirection } from "../src/domain/order.js";
import type { TruthState } from "../src/domain/truth.js";
import type { TagClass } from "../src/domain/inventory.js";
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


/** Lo que la acumulación deja para el análisis: el circuito guardado y la ventana de trabajo. */
interface Accumulated {
  readonly report: AccumulationReport;
  /** El circuito tal como quedó guardado; `undefined` si la afinidad impidió acumular. */
  readonly stored: StoredCircuit | undefined;
  /**
   * La ventana de trabajo (ADR-0015 §2): las lecturas de las fuentes retenidas ya unidas y, si la
   * fuente importada no está retenida —un fichero repetido cuya primera carga ya se retiró—, también
   * las suyas, porque es lo que se está mirando.
   */
  readonly working: readonly Reading[];
  /** La cobertura de la ventana de trabajo: solo donde hay lecturas. Fuera no hay silencio, hay instantánea. */
  readonly workingCoverage: readonly Interval[];
  /** Las instantáneas que el circuito ya tenía antes de esta importación, en orden de ventana. */
  readonly snapshots: readonly CircuitSnapshot[];
}

/** Une las lecturas de varias fuentes retenidas, en orden de ventana, con la unión por tramo común (R-DAT-005). */
function joinRetained(
  records: readonly { readonly sourceId: string; readonly readings: readonly Reading[] }[],
  sources: readonly StoredSource[],
): readonly Reading[] {
  const startOf = new Map(sources.map((source) => [source.sourceId, source.complete?.from ?? Infinity]));
  const ordered = [...records].sort((a, b) => (startOf.get(a.sourceId) ?? Infinity) - (startOf.get(b.sourceId) ?? Infinity));
  return ordered.reduce<readonly Reading[]>((joined, record) => (joined.length === 0 ? record.readings : unionReadings(joined, record.readings).readings), []);
}

/** Un informe de acumulación con lo que el circuito **ya tenía**: la fuente no se escribió. */
function unchangedReport(
  circuitId: string,
  existing: StoredCircuit | undefined,
  working: readonly Reading[],
  affinity: AccumulationReport["affinity"],
): AccumulationReport {
  const sources = existing?.sources ?? [];
  const distinct = distinctSources(sources);
  return {
    circuitId,
    coverage: existing?.coverage ?? [],
    totalReadings: working.length,
    sources: sources.length,
    shared: 0,
    disagreements: 0,
    affinity,
    accumulated: false,
    retained: { sourceIds: distinct.filter((source) => source.retained).map((source) => source.sourceId), distinctSources: distinct.length },
    snapshots: {
      withSnapshot: distinct.filter((source) => source.snapshot).length,
      withoutSnapshot: distinct.filter((source) => !source.snapshot).length,
    },
  };
}

/**
 * Suma una fuente recién importada al circuito.
 *
 * El almacén se lee y se escribe **aquí**, no en el hilo principal: así ni las lecturas guardadas
 * ni las nuevas cruzan un `postMessage`, y la unión —que recorre las dos series— tampoco bloquea la
 * interfaz.
 *
 * Desde la versión 6 del almacén (ADR-0015) el circuito no lleva sus lecturas: se cargan solo las
 * **retenidas** (R-DAT-023), se unen con las nuevas, las nuevas se guardan en su propio registro, se
 * aplica la retención —las dos últimas cargadas, se solapen o no— y el circuito se
 * guarda sin lecturas, todo en una transacción. Lo demás del circuito queda como instantánea.
 */
async function accumulate(
  circuitId: string,
  circuitName: string,
  zone: string,
  result: { summary: { sourceId: string; sourceHash: string; fileName: string; acceptedRows: number };
    readings: readonly Reading[] },
): Promise<Accumulated | undefined> {
  if (!isAvailable()) return undefined;

  const existing = await loadCircuit(circuitId);
  const retainedRecords = await loadRetainedReadings(circuitId);
  const snapshots = await loadSnapshots(circuitId);
  const previous = joinRetained(retainedRecords, existing?.sources ?? []);
  const complete = sourceCoverage(result.readings).complete;

  // La afinidad se comprueba **antes de unir y antes de escribir**: una fuente ajena que llegue
  // hasta el almacén ya no se puede separar de las demás, porque la unión no conserva de qué
  // circuito venía cada lectura. Aquí todavía hay dónde parar (FR-003, R-DAT-006). Lo conocido del
  // circuito son los tags de las lecturas retenidas **y** los de sus instantáneas: un tag que solo se
  // leyó en un fichero ya retirado sigue siendo del circuito.
  const knownTags = new Set(tagsOf(previous));
  for (const snapshot of snapshots) for (const vertex of snapshot.vertices) if (vertex.readings > 0) knownTags.add(vertex.tagId);
  const affinity = assessAffinity(tagsOf(result.readings), knownTags, PROVISIONAL_CONFIG.affinity);
  if (!affinity.mayAccumulate) {
    return {
      report: unchangedReport(circuitId, existing, previous, affinity),
      stored: undefined,
      working: result.readings,
      workingCoverage: complete === null ? [] : [complete],
      snapshots,
    };
  }

  // Un fichero repetido (misma huella) no es una fuente nueva (R-DAT-005, INV-005): se anota su carga y
  // no crea instantánea, pero sí cuenta como la última carga (OQ-143 b): si sus lecturas se habían
  // retirado, vuelven al almacén bajo el `sourceId` de su primera carga.
  const twin = existing?.sources.find((source) => source.sourceHash === result.summary.sourceHash);
  const entry = {
    sourceId: result.summary.sourceId,
    sourceHash: result.summary.sourceHash,
    fileName: result.summary.fileName,
    importedAt: Date.now(),
    acceptedRows: result.summary.acceptedRows,
    complete,
    retained: false,
    snapshot: twin?.snapshot ?? false,
  };
  const retained = retainedSources([...(existing?.sources ?? []), entry]);
  const sources: StoredSource[] = [...(existing?.sources ?? []), entry].map((source) => ({ ...source, retained: retained.has(source.sourceId) }));
  const coverage = mergeIntervals(
    sources.map((source) => source.complete).filter((span): span is Interval => span !== null),
  );

  // Las lecturas retenidas que siguen retenidas, unidas con las nuevas: es la ventana de trabajo. Las
  // que dejan de estarlo se retiran del almacén en la misma transacción.
  const kept = joinRetained(
    retainedRecords.filter((record) => retained.has(record.sourceId)),
    sources,
  );
  const union = unionReadings(kept, result.readings);
  const drop = retainedRecords.map((record) => record.sourceId).filter((sourceId) => !retained.has(sourceId));

  const stored: StoredCircuit = {
    circuitId,
    name: existing?.name ?? circuitName,
    zone,
    sources,
    coverage,
    // Las listas sobreviven a la llegada de una fuente nueva. Sin esto, cargar una exportación
    // borraba en silencio las listas de planta del circuito —el objeto se reescribe entero— y el
    // inventario desaparecía sin que nada lo dijera. Lo destapó la prueba de navegador.
    ...(existing?.lists === undefined ? {} : { lists: existing.lists }),
    // Y el historial de flota, por la misma razón: lo destapó la prueba de navegador de la Parte 39.
    ...(existing?.fleet === undefined ? {} : { fleet: existing.fleet }),
    updatedAt: Date.now(),
  };
  // Un repetido cuyas lecturas ya no estaban guardadas las recupera, con la procedencia de su primera
  // carga: es el mismo fichero, fila a fila, así que la fila de origen no cambia.
  const recovered =
    twin !== undefined && retained.has(twin.sourceId) && !retainedRecords.some((record) => record.sourceId === twin.sourceId)
      ? result.readings.map((reading) => ({ ...reading, provenance: { ...reading.provenance, sourceId: twin.sourceId } }))
      : null;
  await saveAccumulation({
    circuit: stored,
    readings:
      twin === undefined
        ? [{ sourceId: entry.sourceId, readings: result.readings }]
        : recovered === null
          ? []
          : [{ sourceId: twin.sourceId, readings: recovered }],
    drop,
  });

  const distinct = distinctSources(sources);
  const workingCoverage = mergeIntervals([
    ...sources.filter((source) => retained.has(source.sourceId)).map((source) => source.complete),
    complete,
  ].filter((span): span is Interval => span !== null));
  return {
    report: {
      circuitId,
      coverage,
      totalReadings: union.readings.length,
      sources: sources.length,
      shared: union.shared,
      disagreements: union.disagreements,
      affinity,
      accumulated: true,
      retained: { sourceIds: [...retained], distinctSources: distinct.length },
      snapshots: {
        withSnapshot: distinct.filter((source) => source.snapshot).length,
        withoutSnapshot: distinct.filter((source) => !source.snapshot).length,
      },
    },
    stored,
    working: union.readings,
    workingCoverage,
    snapshots,
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
interface ViewsContext {
  /** El circuito guardado; `undefined` si la fuente no se acumuló. */
  readonly stored: StoredCircuit | undefined;
  /** La ventana de trabajo: las lecturas retenidas unidas (ADR-0015 §2), o las importadas sin circuito. */
  readonly working: readonly Reading[];
  readonly workingCoverage: readonly Interval[];
  /** Las instantáneas que el circuito ya tenía, en orden de ventana. */
  readonly snapshots: readonly CircuitSnapshot[];
  readonly imported: readonly Reading[];
  readonly zone: string;
  readonly direction: SourceDirection;
  readonly importedSource: { readonly sourceId: string; readonly sourceHash: string; readonly fileName: string; readonly acceptedRows: number };
}

interface ViewsResult {
  readonly views: CircuitViews;
  /** La instantánea de este fichero, o `null` si no se pudo construir (y `problems` dice por qué). */
  readonly snapshot: CircuitSnapshot | null;
  readonly problems: readonly string[];
}

/** Lo que una instantánea aporta a la vista «Mediciones por fichero» cuando sus lecturas ya no están. */
function measureFromSnapshot(
  snapshot: CircuitSnapshot,
  resolutionMs: number,
): CircuitViews["franjas"]["cohorts"][number]["measures"][number] {
  return {
    sourceId: snapshot.sourceId,
    cohortId: snapshot.cohortId,
    ring: snapshot.ring,
    anchorTagId: snapshot.ring[0] ?? null,
    // El anillo de la instantánea empieza por el ancla del circuito (`ring` «desde el ancla»).
    anchorShared: snapshot.anchorTagId !== null && snapshot.ring[0] === snapshot.anchorTagId,
    positions: snapshot.vertices
      .filter((vertex) => vertex.position !== null)
      .sort((a, b) => (a.position as number) - (b.position as number))
      // La instantánea no guarda con cuántos pasos se situó cada tag: no se inventa, va a cero.
      .map((vertex) => ({ tagId: vertex.tagId, offsetMs: vertex.offsetMs, samples: 0 })),
    lapMs: snapshot.lapMs,
    resolutionMs,
    bands: snapshot.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      produccion: edge.produccion,
      noche: edge.noche,
      firstSeenUtcMs: snapshot.window.from,
      lastSeenUtcMs: snapshot.window.to,
    })),
    // Sin lecturas no hay ritmo de cada AGV que medir (R-AGV-019): la vista lo enseña vacío.
    pace: { fleetRatio: null, testedVehicles: 0, enoughVehicles: false, vehicles: [], holders: [] },
  };
}

/**
 * Ejecuta una comparación entre instantáneas y, si falla, lo dice en vez de tirar la importación
 * entera: el análisis del fichero actual no depende de ella (R-EVI-006: nunca se calla).
 */
function attempt<T>(what: string, problems: string[], fallback: T, compute: () => T): T {
  try {
    return compute();
  } catch (error) {
    problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    return fallback;
  }
}

async function buildViews(context: ViewsContext): Promise<ViewsResult | undefined> {
  const { stored, imported, zone, direction, importedSource } = context;
  const readings = context.working;
  const coverage = context.workingCoverage;
  if (readings.length === 0) return undefined;
  /** Por qué falta una instantánea o una comparación: lo esperado (`notes`) y lo que falló (`failures`). */
  const notes: string[] = [];
  const failures: string[] = [];
  /** Qué fuentes tienen lecturas en la ventana de trabajo: las retenidas y la que se acaba de importar. */
  const withReadings = new Set([
    ...(stored?.sources ?? []).filter((source) => source.retained).map((source) => source.sourceId),
    importedSource.sourceId,
  ]);

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
  const cohortAssignment = assignCohorts(readings, transitions, PROVISIONAL_CONFIG.cohorts);

  const laps: Lap[] = [];
  const shapes: CircuitViews["shapes"][number][] = [];
  const matrices: CircuitViews["readMatrices"][number][] = [];
  const vehicleReadings: CircuitViews["vehicleReading"][number][] = [];
  // Cambios de tag dentro de un mismo periodo (R-DAT-019), antes que la matriz: cuándo empezó o dejó
  // de leerse cada tag es lo que hace falta para medirlo solo dentro de su vida (R-OPP-016).
  // Régimen de cada instante (R-TIM-009): la noche se mide aparte y no altera el estado normal.
  const regimeOf = regimeReader(zone, PROVISIONAL_CONFIG.regimes);
  // Los tags que se leen y no están en la lista del circuito: dónde y cuándo se leen (R-DAT-022). Va
  // antes que los cambios de tag porque un tag de noche empieza y deja de leerse cada día por su
  // horario, no porque cambie: no es un cambio de tag ni parte la ventana en dos.
  const byName = (name: string): ReadonlySet<string> =>
    new Set(lists.find((entry) => entry.list === name)?.tags ?? []);
  // El contraste contra Vsystem y la posición de un tag no declarado exigen un **orden**: el orden en
  // que el fichero trae las filas de la lista `circuito`, que el importador conserva.
  const declaredOrder = [...byName("circuito")];
  const readTagSet = new Set(readings.map((entry) => entry.tagId));
  // Los refuerzos de cada punto crítico (R-GRA-016): seguidos en ese mismo orden declarado y con la
  // misma función. Una omisión en uno no pierde la función si el otro se lee.
  const declaredReinforcements = reinforcementGroups(
    declaredOrder,
    criticalPointsConfig.funcionOf,
    criticalPointsConfig.groupOf,
  );
  const reinforcement = reinforcementPartners(declaredReinforcements);
  const undeclared = locateUndeclaredTags(
    readings,
    declaredOrder,
    new Set([...byName("carga-online"), ...byName("mantenimiento"), ...byName("emergencia")]),
    regimeOf,
    {
      minSlotPasses: PROVISIONAL_CONFIG.tagChanges.minSlotPasses,
      maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance,
      maxReadsBetween: PROVISIONAL_CONFIG.tagChanges.maxReadsBetween,
    },
    byName("noche"),
  );
  // Solo el tag de noche comprobado o declarado en la lista `noche`: «posiblemente de noche» es una
  // hipótesis y no se usa como hecho.
  const nightTags = new Set(
    undeclared.tags
      .filter((tag) => tag.verdict === "noche" || tag.verdict === "noche-declarado")
      .map((tag) => tag.tagId),
  );
  const tagChanges = withoutTags(
    detectTagChanges(readings, direction, coverage, PROVISIONAL_CONFIG.tagChanges, {
      minPassesForNever: PROVISIONAL_CONFIG.vehicleReading.minPassesForNever,
      highRate: PROVISIONAL_CONFIG.readRate.highRate,
      minAdoptionShare: PROVISIONAL_CONFIG.drift.minAdoptionShare,
    }),
    nightTags,
  );
  const fifoCohorts: NonNullable<CircuitViews["fifo"]>[number][] = [];
  const criticalPointCohorts: CircuitViews["criticalPoints"][number][] = [];
  /** El ancla efectiva de cada cohorte (declarada si se resolvió, si no la inferida). */
  const anchors = new Map<number, LapAnchor>();
  const lapAnchorProblems: string[] = [];
  /** Lo que suele tardar cada tramo del anillo, por turno, para el cohorte de cada AGV (R-AGV-017). */
  const usualByVehicle = new Map<string, UsualTimes>();
  /** Lo habitual, por régimen, de dejar cada tag del anillo (la valla de su tramo): para la batería (R-AGV-021). */
  const usualDwellByTag = new Map<string, { produccion: number | null; noche: number | null }>();
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
  // Las paradas de la línea con AGV esperando (R-FLO-010), antes que cualquier tiempo habitual: la cola
  // del pulmón mientras la línea no toma no es el tiempo de esos tramos. Se miden con el cohorte mayor,
  // que es el que pasa por la línea, y sin saber aún quién retiene: eso no cambia las paradas.
  const lineTagList = lists.find((entry) => entry.list === "linea")?.tags ?? [];
  const lineFeedThresholds = {
    minSamples: PROVISIONAL_CONFIG.bands.minBandSamples,
    minMarginMs: PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
  };
  const mainVehicleSet = new Set(cohortAssignment.cohorts[0]?.vehicles ?? []);
  const mainReadings = readings.filter((entry) => mainVehicleSet.has(entry.agvId));
  const productionStopIntervals = production.stops.map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs }));
  const lineExclusion =
    lineTagList.length === 0
      ? { intervals: [], tags: new Set<string>() }
      : lineStopExclusion(
          measureLineFeed(
            mainReadings,
            lineTagList,
            coverage,
            regimeOf,
            lineFeedThresholds,
            new Set(),
            criticalPointsConfig.funcionOf,
            productionStopIntervals,
          ),
        );
  const flowReports: FlowReport[] = [];
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
  const keepByCohort = new Map<number, (gaps: readonly AnchorGapChange[]) => AnchorGapChange[]>();
  /** Lo del cohorte principal que la instantánea necesita (ADR-0015): su ancla, su medición y su matriz. */
  let mainCohort:
    | {
        readonly cohortId: number;
        readonly effective: LapAnchor;
        readonly anchorTruth: TruthState;
        readonly measures: CircuitViews["franjas"]["cohorts"][number]["measures"];
        readonly matrix: ReadMatrix;
        readonly deliveries: readonly { readonly agvId: string; readonly fromUtcMs: number; readonly toUtcMs: number }[];
        readonly candidates: ReadonlyMap<string, string>;
      }
    | undefined;

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
      measurableTransitions(
        outsideLineStops(outsideProductionStops(cohortTransitions, production.stops), lineExclusion),
        coverage,
        laneTags,
      ),
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

    // Las transiciones que cruzan una parada de la producción no miden ningún tramo, ni las de la cola
    // del pulmón mientras la línea estaba parada con AGV esperando.
    const timedTransitions = outsideLineStops(outsideProductionStops(cohortTimeline, production.stops), lineExclusion);
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
    for (const [index, from] of bands.ring.entries()) {
      const to = bands.ring[(index + 1) % bands.ring.length];
      if (to === undefined || to === from) continue;
      usualDwellByTag.set(from, {
        produccion: bandFor(bands, from, to, "produccion")?.fenceMs ?? null,
        noche: bandFor(bands, from, to, "noche")?.fenceMs ?? null,
      });
    }
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
      const fifoReport = buildFifoReport(cohort.id, cohortReadings, spans, PROVISIONAL_CONFIG.fifo, coverage);
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
      timeSignatures: timeSignaturesMeasurable(productionTimed),
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
    // El ritmo de cada AGV y quién retiene (R-AGV-019, R-AGV-020), en todo lo cargado y en cada fichero.
    const paceThresholds: VehiclePaceThresholds = {
      ...PROVISIONAL_CONFIG.pace,
      minSamples: PROVISIONAL_CONFIG.bands.minBandSamples,
      maxFalsePoints: PROVISIONAL_CONFIG.circuitState.maxFalsePoints,
      minVehiclesForContrast: PROVISIONAL_CONFIG.readRate.minVehiclesForContrast,
    };
    const paceInput = { transitions: measuredTimed, regimeOf, flow, zoneOf: zoneConfig.zoneOf };
    // La medición de cada fichero (R-TIM-011), con las mismas transiciones limpias: solo de los ficheros
    // cuyas lecturas están en la ventana de trabajo. Los demás se leen de su instantánea (ADR-0015 §3).
    const measures = measuredWindows.filter((entry) => withReadings.has(entry.source.sourceId)).map((entry) => {
      const measure = measureFranjaCohort(
        { cohortId: cohort.id, transitions: cohortTimeline, measured: measuredTimed, anchorTagId: effective.tagId },
        entry.window,
        regimeOf,
        PROVISIONAL_CONFIG.bands,
        PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
        PROVISIONAL_CONFIG.franjas,
        PROVISIONAL_CONFIG.tagChanges.maxReadsBetween,
      );
      return {
        sourceId: entry.source.sourceId,
        ...measure,
        pace: paceInWindow(
          paceInput,
          entry.window,
          measure.ring,
          PROVISIONAL_CONFIG.bands,
          PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
          paceThresholds,
        ),
      };
    });
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
    const boundaries = structureBoundaries(sequences, structureSpans, PROVISIONAL_CONFIG.tagChanges.maxOverlapMs, nightTags);
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
    // Entre ficheros seguidos se compara desde las instantáneas (ADR-0015 §3), después del bucle: las
    // lecturas de un fichero anterior pueden no estar ya. Se guarda el filtro para no repetir un cambio.
    keepByCohort.set(cohort.id, keep);
    franjaCohorts.push({ cohortId: cohort.id, measures, histories: segmentHistories(measures), structure });
    if (cohort === cohortAssignment.cohorts[0]) {
      mainCohort = {
        cohortId: cohort.id,
        effective,
        anchorTruth,
        measures,
        matrix,
        deliveries: grouped.deliveries.map((delivery) => ({ agvId: delivery.agvId, fromUtcMs: delivery.fromUtcMs, toUtcMs: delivery.toUtcMs })),
        candidates: new Map([
          ...[...timeCritical].filter(([tagId]) => !criticalPointsConfig.funcionOf.has(tagId)),
          ...conCruces.map((candidate) => [candidate.tagId, candidate.kind] as const),
        ]),
      };
    }

    const size = effective.cycle.length;
    circuitStateCohorts.push({
      cohortId: cohort.id,
      pace: vehiclePace({ ...paceInput, bands }, paceThresholds),
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
          declaredOrder,
          readTags: readTagSet,
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
  // Lo que planta declara de cada tag, para acompañar sus incidencias: información, no regla.
  const tagInfo = declaredTagInfo(lists, reinforcement);
  // El tramo de cada tag (kitting, línea, cruce…), para dibujarlo en las gráficas del anillo.
  const sections = tagSections(lists, criticalPointsConfig.funcionOf);
  // Tiempos por sección entre anclas (R-TIM-012), con el cohorte principal: todas las anclas declaradas
  // que están en su anillo cortan secciones, con las mismas exclusiones que las horquillas.
  const mainAnchorCohort = cohortAssignment.cohorts[0];
  const mainRing = mainAnchorCohort === undefined ? undefined : anchors.get(mainAnchorCohort.id)?.cycle;
  const anchorSections = measureAnchorSections(
    {
      readings: mainReadings,
      direction,
      ring: mainRing ?? [],
      anchors: lapAnchorsConfig.anchors,
      coverage,
      productionStops: productionStopIntervals,
      laneTags,
      regimeOf,
      sectionOf: sections,
      windows: measuredWindows
        .filter((entry) => withReadings.has(entry.source.sourceId))
        .map((entry) => ({ sourceId: entry.source.sourceId, window: entry.window })),
    },
    PROVISIONAL_CONFIG.bands,
    PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
  );

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

  const baseViews: Omit<CircuitViews, "snapshots"> = {
    hourly: hourlyProfile(readings, zone),
    activity: activityBand(readings, coverage, ACTIVITY_BINS),
    cohorts: cohortAssignment.cohorts,
    shapes,
    readMatrices: matrices,
    vehicleReading: vehicleReadings,
    tagChanges: { changes: tagChanges.changes, adoption: tagChanges.adoption },
    agvDossiers,
    tagDossiers,
    ...(tagInfo.size === 0 ? {} : { tagInfo: Object.fromEntries(tagInfo) }),
    ...(sections.size === 0 ? {} : { sections: Object.fromEntries(sections) }),
    anchorSections: { declared: lapAnchorsConfig.anchors.length, ...anchorSections },
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
              tagReads: lane.tagReads.map((tag) => ({
                tagId: tag.tagId,
                role: tag.role,
                staysRead: tag.staysRead,
                stays: tag.stays,
                vehicles: tag.vehicles,
              })),
            })),
            usage: charging.usage.map((entry) => ({ ...entry })),
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

  // Lo que solo existe con listas de planta cargadas: inventario, contraste, limpieza, línea e
  // incidencias. Va en una función para que la instantánea, que viene después, tenga el inventario.
  let inventoryClassOf: ReadonlyMap<string, TagClass> = new Map();
  const withLists = (): Partial<CircuitViews> => {
  if (lists.length === 0) return {};

  const unservedLaneTags = new Set(
    charging.lanes
      .filter((lane) => !lane.served)
      .flatMap((lane) => laneConfig.lanes.find((item) => item.laneId === lane.laneId)?.tags ?? []),
  );
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
      reinforcement,
      night: byName("noche"),
    },
    PROVISIONAL_CONFIG.blindness,
  );

  inventoryClassOf = new Map(inventory.rows.map((row) => [row.tagId, row.tagClass]));

  const counts = new Map<string, number>();
  const truthOf = new Map<string, string>();
  const actionOf = new Map<string, string>();
  for (const row of inventory.rows) {
    counts.set(row.tagClass, (counts.get(row.tagClass) ?? 0) + 1);
    truthOf.set(row.tagClass, row.truth);
    actionOf.set(row.tagClass, describeAction(row.action));
  }

  let vsystemContrast: CircuitViews["vsystemContrast"];
  let circuitOrder: CircuitViews["circuitOrder"];
  // El vecino leído de cada tag de un refuerzo, para comprobarlo en el recorrido (R-GRA-017).
  let reinforcementPlaces: ReturnType<typeof dominantNeighbours> | undefined;
  const mainCohort = cohortAssignment.cohorts[0];
  if (declaredOrder.length > 0 && mainCohort !== undefined) {
    // El anillo observado con el que se contrasta: el ciclo dominante del cohorte mayor, que es el
    // que tiene más soporte y por tanto la reconstrucción más fiable. Ya se calculó arriba.
    const anchor = anchors.get(mainCohort.id);
    if (anchor !== undefined) {
      const readTags = new Set(readings.map((entry) => entry.tagId));
      vsystemContrast = compareAgainstVsystem(declaredOrder, anchor.cycle, readTags);
      // El orden del circuito según las lecturas (R-GRA-015): el anillo, lo leído fuera de él en su
      // sitio leído, y lo declarado sin lecturas donde lo pone la lista.
      const inRing = new Set(anchor.cycle);
      const mainVehicles = new Set(mainCohort.vehicles);
      const toPlace = new Set([
        ...declaredOrder.filter((tagId) => readTags.has(tagId) && !inRing.has(tagId)),
        ...undeclared.tags.map((tag) => tag.tagId).filter((tagId) => !inRing.has(tagId)),
      ]);
      reinforcementPlaces = dominantNeighbours(
        readings.filter((entry) => mainVehicles.has(entry.agvId)),
        new Set(declaredReinforcements.flatMap((group) => group.tags)),
      );
      circuitOrder = reconcileCircuitOrder(
        declaredOrder,
        anchor.cycle,
        readTags,
        dominantNeighbours(
          readings.filter((entry) => mainVehicles.has(entry.agvId)),
          toPlace,
        ),
      );
    }
  }

  // La alimentación de la línea (R-FLO-010), en el cohorte mayor: el que pasa por la línea declarada.
  const lineFeed =
    lineTagList.length === 0 || mainCohort === undefined
      ? undefined
      : measureLineFeed(
          mainReadings,
          lineTagList,
          coverage,
          regimeOf,
          lineFeedThresholds,
          new Set(
            (circuitStateCohorts[0]?.pace.holders ?? [])
              .filter((holder) => holder.expected !== null)
              .map((holder) => holder.agvId),
          ),
          criticalPointsConfig.funcionOf,
          productionIntervals,
        );

  // La batería de mediciones de cada incidencia (R-AGV-021): paradas sin explicación, primeros de cola
  // sin avanzar y AGV que dejan de leer. Cada una, con lo mismo medido en el mismo orden.
  const windowEnd = Math.max(0, ...coverage.map((span) => span.to));
  const incidentContext = buildIncidentContext(
    readings,
    lineFeed?.passTimes ?? [],
    (utcMs) => (lineFeed === undefined ? null : regimeOf(utcMs) === "produccion" ? lineFeed.cadence : lineFeed.nightCadence),
    (lineFeed?.stops ?? []).filter((stop) => stop.kind === "con-pulmon").map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs })),
    new Map(laneConfig.lanes.flatMap((lane) => lane.tags.map((tagId) => [tagId, lane.laneId] as const))),
    (tagId, utcMs) => usualDwellByTag.get(tagId)?.[regimeOf(utcMs)] ?? null,
    // El «deja de leer» mide su hueco de referencia solo con huecos de producción (OQ-138).
    regimeOf,
    production.stops,
  );
  const batteries: Record<string, ReturnType<typeof incidentBattery>> = {};
  const records: IncidentRecord[] = [];
  const addBattery = (kind: IncidentKind, incident: Incident): void => {
    const battery = incidentBattery(incidentContext, incident, windowEnd);
    batteries[`${incident.agvId} ${incident.fromTagId} ${incident.fromUtcMs}`] = battery;
    records.push({ kind, incident, battery });
  };
  for (const cohort of circuitStateCohorts) {
    for (const stop of [...cohort.state.unexplained.produccion, ...cohort.state.unexplained.noche]) {
      addBattery("parada-sin-explicacion", {
        agvId: stop.agvId,
        fromTagId: stop.fromTagId,
        fromUtcMs: stop.fromUtcMs,
        toTagId: stop.toTagId,
        toUtcMs: stop.toUtcMs,
      });
    }
  }
  for (const report of flowReports) {
    for (const blockage of report.blockages) {
      addBattery("bloqueo", {
        agvId: blockage.agvId,
        fromTagId: blockage.tagId,
        fromUtcMs: blockage.fromUtcMs,
        toTagId: blockage.nextTagId,
        toUtcMs: blockage.toUtcMs,
      });
    }
  }
  const abandoned = abandonedReadings(incidentContext, windowEnd).map((incident) => {
    const battery = incidentBattery(incidentContext, incident, windowEnd);
    records.push({ kind: "deja-de-leer", incident, battery });
    return { incident, battery };
  });
  records.sort((a, b) => a.incident.fromUtcMs - b.incident.fromUtcMs);

  return {
    incidents: { batteries, abandoned, records },
    ...(lineFeed === undefined ? {} : { lineFeed }),
    ...(undeclared.evaluated ? { undeclaredTags: undeclared.tags } : {}),
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
    ...(circuitOrder === undefined || !circuitOrder.evaluated
      ? {}
      : {
          circuitOrder,
          // Lo que la lista declara y el físico no confirma, para ordenarla (R-GRA-017).
          listCleanup: buildListCleanup(
            circuitOrder,
            criticalPointsConfig.funcionOf,
            declaredReinforcements,
            reinforcementPlaces,
          ),
        }),
    ...(criticalPointsConfig.problems.length === 0
      ? {}
      : { criticalPointsProblems: criticalPointsConfig.problems }),
  };
  };
  const listViews = withLists();

  // --- La instantánea de este fichero (ADR-0015 §1) ---------------------------------------------
  //
  // Se construye con lo que ya está calculado, medido **sobre la ventana de este fichero**: la matriz,
  // los vecinos, las secciones, las sumas entre anclas, la línea y las calles se recalculan aquí sobre
  // sus lecturas para que la instantánea diga lo que pasó en ese fichero y no en la ventana de trabajo
  // entera. Un fichero repetido no crea instantánea (R-DAT-005); uno sin ventana completa, tampoco.
  const importedWindow = windows.find((entry) => entry.source.sourceId === importedSource.sourceId);
  let snapshot: CircuitSnapshot | null = null;
  if (stored === undefined) {
    // Sin circuito no hay dónde guardar una instantánea, y no es un problema: no se pidió acumular.
  } else if (importedWindow === undefined) {
    notes.push("La fuente importada no tiene ventana completa (un solo instante): sin instantánea.");
  } else if (importedWindow.duplicateOf !== null) {
    notes.push(`El fichero repite «${importedWindow.duplicateOf}»: no es una fuente nueva y no crea instantánea (R-DAT-005).`);
  } else {
    const window = importedWindow.window;
    const inWindow = (entry: Reading): boolean => entry.time.utcMs >= window.from && entry.time.utcMs <= window.to;
    // Sin cohorte (un fichero tan corto que no agrupa vehículos) la instantánea es de todas las lecturas,
    // sin anillo: sigue siendo un grafo con fecha, y es lo que hace que el fichero quede registrado.
    const fileReadings = (mainAnchorCohort === undefined ? readings : mainReadings).filter(inWindow);
    const snapshotCohortId = mainAnchorCohort?.id ?? 0;
    const measure = mainCohort?.measures.find((entry) => entry.sourceId === importedSource.sourceId) ?? null;
    const ring = measure?.ring ?? [];
    const anchor = mainCohort?.effective ?? null;
    const readingsByTag = new Map<string, number>();
    for (const entry of fileReadings) readingsByTag.set(entry.tagId, (readingsByTag.get(entry.tagId) ?? 0) + 1);
    const declared = new Set([...declaredOrder, ...criticalPointsConfig.funcionOf.keys()]);
    const reviews = await loadReviews(stored.circuitId);
    const declaredOnRing = anchorsOnRing(ring, lapAnchorsConfig.anchors);
    const fileLine =
      lineTagList.length === 0
        ? null
        : measureLineFeed(
            fileReadings,
            lineTagList,
            [window],
            regimeOf,
            lineFeedThresholds,
            new Set((circuitStateCohorts[0]?.pace.holders ?? []).filter((holder) => holder.expected !== null).map((holder) => holder.agvId)),
            criticalPointsConfig.funcionOf,
            productionIntervals,
          );
    const fileCharging = laneConfig.lanes.length === 0 ? null : buildChargingReport(readings.filter(inWindow), laneConfig.lanes, [window], PROVISIONAL_CONFIG.charging);
    snapshot = attempt("La instantánea de este fichero no se pudo construir", failures, null, () =>
      buildSnapshot(
        assembleSnapshotInput({
          circuitId: stored.circuitId,
          zone,
          source: { ...importedSource, window },
          capturedAt: Date.now(),
          appVersion: APP_VERSION,
          exposure: regimeExposure([window], productionIntervals, regimeOf),
          cohortId: snapshotCohortId,
          anchorTagId: anchor?.tagId ?? null,
          anchorDeclared: mainCohort?.anchorTruth === "observed",
          measure,
          matrix:
            anchor === null || ring.length === 0
              ? null
              : buildReadMatrix(
                  snapshotCohortId,
                  fileReadings,
                  direction,
                  [window],
                  ring,
                  ring[0] as string,
                  PROVISIONAL_CONFIG.readRate,
                  orderLimits,
                  PROVISIONAL_CONFIG.trend,
                  tagChanges.lives,
                ),
          readingsByTag,
          neighbours: dominantNeighbours(fileReadings, new Set([...ring, ...readingsByTag.keys(), ...declared])),
          declared,
          sectionOf: sections,
          funcionOf: criticalPointsConfig.funcionOf,
          candidateFunctionOf: mainCohort?.candidates ?? new Map(),
          inventoryClassOf,
          laneOfTag: new Map(laneConfig.lanes.flatMap((lane) => lane.tags.map((tagId) => [tagId, lane.laneId] as const))),
          lineTags: new Set(lineTagList),
          declaredAnchors: new Set(lapAnchorsConfig.anchors),
          sections:
            ring.length === 0
              ? []
              : measureAnchorSections(
                  {
                    readings: fileReadings,
                    direction,
                    ring,
                    anchors: lapAnchorsConfig.anchors,
                    coverage: [window],
                    productionStops: productionIntervals,
                    laneTags,
                    regimeOf,
                    sectionOf: sections,
                    windows: [{ sourceId: importedSource.sourceId, window }],
                  },
                  PROVISIONAL_CONFIG.bands,
                  PROVISIONAL_CONFIG.flowStops.minStopExcessMs,
                ).sections,
          anchorGaps:
            ring.length === 0 || anchor === null
              ? []
              : measureAnchorGaps({
                  readings: fileReadings,
                  direction,
                  ring,
                  // Las anclas declaradas que están en el anillo; si no hay dos, el ancla del circuito
                  // sola y el hueco es la vuelta entera.
                  anchors: declaredOnRing.length >= 2 ? declaredOnRing : [ring[0] as string],
                  coverage: [window],
                  productionStops: productionIntervals,
                  laneTags,
                  regimeOf,
                  deliveries: mainCohort?.deliveries ?? [],
                }),
          fleet,
          line: fileLine,
          lanes: fileCharging?.lanes ?? [],
          laneUsage: fileCharging?.usage ?? [],
          findings: buildSnapshotFindings({
            zone,
            matrix: mainCohort?.matrix ?? null,
            tagChanges: tagChanges.changes,
            lanes: charging.lanes,
            laneUsage: charging.usage,
            state: circuitStateCohorts[0]?.state ?? null,
            undeclaredTags: undeclared.evaluated ? undeclared.tags : [],
            reviews,
          }),
        }),
      ),
    );
  }

  // --- Lo que compara ficheros se lee de las instantáneas (ADR-0015 §3) -------------------------
  const allSnapshots = sortSnapshots([
    ...context.snapshots.filter((entry) => snapshot === null || entry.sourceId !== snapshot.sourceId),
    ...(snapshot === null ? [] : [snapshot]),
  ]);
  const snapshotOf = new Map(allSnapshots.map((entry) => [entry.sourceId, entry]));
  const franjaCohortsFinal = franjaCohorts.map((cohort) => {
    if (mainCohort === undefined || cohort.cohortId !== mainCohort.cohortId) return cohort;
    // Las mediciones de los ficheros anteriores salen de su instantánea; la del fichero actual, de su
    // medición; un fichero anterior sin instantánea pero con lecturas retenidas, de su medición.
    const resolutionMs = cohort.measures.find((entry) => entry.sourceId === importedSource.sourceId)?.resolutionMs ?? 0;
    const measures = measuredWindows.flatMap((entry) => {
      const sourceId = entry.source.sourceId;
      const measured = cohort.measures.find((item) => item.sourceId === sourceId);
      if (sourceId === importedSource.sourceId && measured !== undefined) return [measured];
      const own = snapshotOf.get(sourceId);
      if (own !== undefined) return [measureFromSnapshot(own, resolutionMs)];
      return measured === undefined ? [] : [measured];
    });
    const keep = keepByCohort.get(cohort.cohortId) ?? ((gaps: readonly AnchorGapChange[]): AnchorGapChange[] => [...gaps]);
    const structure = [...cohort.structure];
    for (let index = 1; index < allSnapshots.length; index += 1) {
      const early = allSnapshots[index - 1] as CircuitSnapshot;
      const late = allSnapshots[index] as CircuitSnapshot;
      const set = attempt(`La estructura entre «${early.fileName}» y «${late.fileName}» no se pudo comparar`, failures, null, () =>
        structureBetweenSnapshots(early, late, PROVISIONAL_CONFIG.tagChanges),
      );
      if (set === null) continue;
      const gaps = keep(set.gaps);
      if (gaps.length > 0) structure.push({ ...set, gaps });
    }
    const histories = attempt("Las horquillas entre ficheros no se pudieron leer de las instantáneas", failures, cohort.histories, () =>
      historiesFromSnapshots(allSnapshots, PROVISIONAL_CONFIG.franjas),
    );
    return { cohortId: cohort.cohortId, measures, histories, structure };
  });
  // El p50 por fichero de cada sección (R-TIM-012): de la instantánea, en los ficheros sin lecturas.
  const anchorSectionsFinal: CircuitViews["anchorSections"] = {
    ...baseViews.anchorSections,
    sections: anchorSections.sections.map((section) => {
      const extra = allSnapshots
        .filter((entry) => !withReadings.has(entry.sourceId))
        .flatMap((entry) => {
          const own = entry.sections.find((item) => item.fromTagId === section.fromTagId && item.toTagId === section.toTagId);
          return own === undefined ? [] : [{ sourceId: entry.sourceId, samples: own.produccion?.samples ?? 0, p50Ms: own.produccion?.p50Ms ?? null }];
        });
      const order = new Map(measuredWindows.map((entry, index) => [entry.source.sourceId, index]));
      const bySource = [...extra, ...section.bySource].sort((a, b) => (order.get(a.sourceId) ?? Infinity) - (order.get(b.sourceId) ?? Infinity));
      return { ...section, bySource };
    }),
  };
  const deltas: SnapshotDelta[] = [];
  for (let index = 1; index < allSnapshots.length; index += 1) {
    const early = allSnapshots[index - 1] as CircuitSnapshot;
    const late = allSnapshots[index] as CircuitSnapshot;
    const delta = attempt(`El cambio entre «${early.fileName}» y «${late.fileName}» no se pudo calcular`, failures, null, () =>
      compareSnapshots(early, late, PROVISIONAL_CONFIG.tagChanges),
    );
    if (delta !== null) deltas.push(delta);
  }
  // Deriva entre la primera y la última instantánea (R-DAT-016, R-AGV-013), si son distantes: solo con
  // listas cargadas, como antes, y solo desde instantáneas, nunca desde lecturas de ficheros anteriores.
  const first = allSnapshots[0];
  const last = allSnapshots[allSnapshots.length - 1];
  const drift: DriftComparison | null =
    lists.length === 0 || first === undefined || last === undefined || first === last
      ? null
      : attempt("La deriva entre periodos no se pudo leer de las instantáneas", failures, null, () =>
          driftBetweenSnapshots(first, last, PROVISIONAL_CONFIG.drift),
        );
  const retainedIds = new Set((stored?.sources ?? []).filter((source) => source.retained).map((source) => source.sourceId));
  const sourceList = (stored?.sources ?? []).length === 0 ? [{ ...importedSource, importedAt: Date.now(), complete: importedWindow?.window ?? null }] : distinctSources(stored?.sources ?? []);
  const snapshotsView: CircuitViews["snapshots"] = {
    list: sourceList
      .flatMap((source) => {
        const own = snapshotOf.get(source.sourceId);
        const window = own?.window ?? source.complete;
        if (window === null) return [];
        return [
          {
            sourceId: source.sourceId,
            fileName: source.fileName,
            window,
            capturedAt: own?.capturedAt ?? source.importedAt,
            retained: retainedIds.has(source.sourceId) || source.sourceId === importedSource.sourceId,
            hasSnapshot: own !== undefined,
          },
        ];
      })
      .sort((a, b) => a.window.from - b.window.from || a.window.to - b.window.to),
    deltas,
    problems: [...notes, ...failures],
  };

  // La memoria consolidada (F4): solo si el circuito tiene versiones. Lo observado es la instantánea
  // del fichero de trabajo —la recién construida o, si no se pudo, la guardada de esa misma fuente—.
  let memory: MemoryViews | undefined;
  if (stored !== undefined && isAvailable()) {
    try {
      memory = await buildMemoryViews(stored.circuitId, snapshot ?? snapshotOf.get(importedSource.sourceId) ?? null);
    } catch (error) {
      failures.push(`La memoria consolidada no se pudo leer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const views: CircuitViews = {
    ...baseViews,
    anchorSections: anchorSectionsFinal,
    franjas: { ...baseViews.franjas, cohorts: franjaCohortsFinal },
    snapshots: snapshotsView,
    ...(memory === undefined ? {} : { memory }),
    ...listViews,
    ...(drift === null || !drift.evaluated || drift.earlyPeriod === null || drift.latePeriod === null
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
              ...(entry.kind === "desaparecido" || entry.kind === "nuevo"
                ? { affirmed: entry.affirmed, chance: entry.chance, opportunities: entry.opportunities }
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
  return { views, snapshot, problems: failures };
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
  // Un libro de Excel se lee directamente, primera hoja (DS-001, DS-011 en `.xlsx`); si no, es texto.
  let text: string;
  let encoding: string;
  const bytes = new Uint8Array(buffer);
  if (looksLikeZip(bytes)) {
    emit({ type: "progress", stage: "hashing", done: 0, total: 1, note: "Leyendo el libro de Excel" }, jobId);
    try {
      text = rowsToDelimitedText(await readXlsxRows(bytes));
      encoding = "xlsx";
    } catch (error) {
      emit(
        {
          type: "error",
          code: "SOURCE_UNREADABLE",
          cause: error instanceof XlsxError ? error.reason : "El libro de Excel no pudo leerse.",
          recovery: "Guarda el libro de nuevo en Excel (.xlsx) o expórtalo como CSV.",
        },
        jobId,
      );
      return;
    }
  } else {
    ({ text, encoding } = decodeSource(buffer));
  }

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
    const accumulated =
      message.circuitId === undefined
        ? undefined
        : await accumulate(message.circuitId, message.circuitName ?? message.circuitId, zone, result);

    // Las vistas se calculan sobre lo que se está mirando: la ventana de trabajo del circuito si la
    // fuente se acumuló, y solo esta fuente si no. Calcularlas siempre sobre el circuito sería mentir
    // cuando la afinidad ha impedido acumular, porque el usuario estaría viendo un conjunto que no
    // incluye el fichero que acaba de cargar.
    const built = await buildViews({
      stored: accumulated?.stored,
      working: accumulated?.working ?? result.readings,
      workingCoverage: accumulated?.workingCoverage ?? [],
      snapshots: accumulated?.snapshots ?? [],
      imported: result.readings,
      zone,
      direction: result.summary.direction,
      importedSource: result.summary,
    });

    // La instantánea se guarda sola (ADR-0015 §4): es una medición con fecha, no memoria consolidada.
    // Con ella, la fuente queda marcada como «con instantánea» en el circuito.
    let accumulation = accumulated?.report;
    if (built?.snapshot !== null && built?.snapshot !== undefined && accumulated?.stored !== undefined) {
      const own = built.snapshot;
      await saveSnapshot(own);
      const sources = accumulated.stored.sources.map((source) => (source.sourceHash === own.sourceHash ? { ...source, snapshot: true } : source));
      await saveCircuit({ ...accumulated.stored, sources });
      const distinct = distinctSources(sources);
      accumulation = {
        ...(accumulation as AccumulationReport),
        snapshots: {
          withSnapshot: distinct.filter((source) => source.snapshot).length,
          withoutSnapshot: distinct.filter((source) => !source.snapshot).length,
        },
      };
    }

    emit(
      {
        type: "complete",
        summary: result.summary,
        readings: result.readings,
        quarantine: result.quarantine,
        // Lo que no se pudo construir o comparar se dice con el resto de advertencias (R-EVI-006).
        warnings: [...result.warnings, ...(built?.problems ?? [])],
        ...(accumulation === undefined ? {} : { accumulation }),
        ...(built === undefined ? {} : { views: built.views }),
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
    // El defecto se enseña con su nombre y su primera línea de pila: sin eso no se puede reproducir con
    // un fixture sintético, que es lo que el mensaje pide. Nunca lleva datos: solo el tipo del error, su
    // texto y dónde saltó.
    const detail =
      error instanceof Error
        ? `${error.name}: ${error.message}${error.stack === undefined ? "" : ` — ${error.stack.split("\n").slice(1, 3).join(" | ").trim()}`}`
        : String(error);
    emit(
      {
        type: "error",
        code: "INTERNAL",
        cause: `Fallo no previsto del motor de importación (${detail}).`,
        recovery: "Vuelve a intentarlo; si persiste, es un defecto y debe reproducirse con un fixture sintético.",
      },
      jobId,
    );
  }
}

// --- Memoria consolidada (F4) ----------------------------------------------------------------------

/** Los umbrales con que se comparan instantáneas: los mismos que los cambios de tag (OQ-138). */
const MEMORY_THRESHOLDS = { maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance };

/** Lo que la lista de versiones necesita de cada una, sin el grafo. */
function summarizeVersion(version: ConsolidatedVersion): VersionSummary {
  const count = (state: string): number => version.decisions.filter((decision) => decision.state === state).length;
  return {
    version: version.version,
    createdAt: version.createdAt,
    basedOnFileName: version.basedOn.fileName,
    basedOnSourceId: version.basedOn.sourceId,
    window: version.basedOn.window,
    decisions: { confirmed: count("confirmado"), discarded: count("descartado"), postponed: count("pospuesto") },
    note: version.note,
    revoked: version.revoked,
    hash: version.hash,
    bytes: versionBytes(version),
  };
}

/** Las versiones guardadas y el estado de linaje del circuito; sin estado guardado, todas forman el linaje activo. */
async function loadMemory(circuitId: string): Promise<{
  readonly all: readonly ConsolidatedVersion[];
  readonly active: readonly ConsolidatedVersion[];
  readonly state: LineageState;
}> {
  const [all, stored] = await Promise.all([loadVersions(circuitId), loadMemoryState(circuitId)]);
  const state = stored ?? emptyLineageState(circuitId);
  const active = state.active === null ? all : versionsOfLineage(all, state.active);
  return { all, active, state };
}

/** Las vistas de la memoria del circuito, o `undefined` si no tiene ninguna versión. */
async function buildMemoryViews(circuitId: string, observed: CircuitSnapshot | null): Promise<MemoryViews | undefined> {
  const { all, active, state } = await loadMemory(circuitId);
  if (all.length === 0) return undefined;
  const current = currentVersion(active);
  return {
    versions: active.map(summarizeVersion),
    current: current?.version ?? null,
    comparison: current === null || observed === null ? null : compareToMemory(observed, current, MEMORY_THRESHOLDS),
    budgetBytes: all.reduce((sum, version) => sum + versionBytes(version), 0),
    lineage: state.lastRelation,
    fork:
      state.incoming === null
        ? null
        : { local: active.map(summarizeVersion), incoming: versionsOfLineage(all, state.incoming).map(summarizeVersion) },
    lineageEvents: state.lineageEvents,
  };
}

/**
 * La previsualización de consolidar un fichero, calculada **aquí** desde el almacén: nunca se confía
 * en una previsualización que venga del hilo principal. El mismo cálculo sirve para `preview` y para
 * `commit`, que es lo que garantiza que lo confirmado es lo que se escribe.
 */
async function previewFor(circuitId: string, sourceId: string): Promise<{ readonly preview: ConsolidationPreview; readonly snapshot: CircuitSnapshot | null; readonly state: LineageState }> {
  const stored = await loadCircuit(circuitId);
  if (stored === undefined) throw new Error(`El circuito ${circuitId} no está en el almacén.`);
  const source = stored.sources.find((entry) => entry.sourceId === sourceId);
  if (source === undefined) throw new Error(`El fichero ${sourceId} no es una fuente del circuito.`);
  const [snapshots, reviews, memory] = await Promise.all([loadSnapshots(circuitId), loadReviews(circuitId), loadMemory(circuitId)]);
  const snapshot = snapshots.find((entry) => entry.sourceId === sourceId) ?? null;
  if (snapshot === null) {
    const basedOn = {
      sourceId: source.sourceId,
      sourceHash: source.sourceHash,
      fileName: source.fileName,
      window: source.complete ?? { from: source.importedAt, to: source.importedAt },
    };
    return { preview: previewWithoutSnapshot(basedOn, memory.active), snapshot: null, state: memory.state };
  }
  const preview = previewConsolidation({
    snapshot,
    reviews,
    versions: memory.active,
    rankOf: (kind) => findingKindOf(kind).rank,
    forkUnresolved: memory.state.incoming !== null,
    thresholds: MEMORY_THRESHOLDS,
  });
  return { preview, snapshot, state: memory.state };
}

/**
 * Consolidación, revocación y resolución de bifurcaciones (F4). El Worker no decide nada: ejecuta lo
 * que la persona confirmó (R-MEM-001), y lo escribe append-only (R-MEM-002).
 */
async function runMemory(message: Extract<ToWorker, { type: "consolidate" | "revoke" | "resolve-fork" }>): Promise<void> {
  const { jobId, circuitId } = message;
  const fail = (cause: string, recovery: string): void => {
    emit({ type: "error", code: "INTERNAL", cause, recovery }, jobId);
  };
  if (!isAvailable()) {
    fail("No hay almacén local: la memoria consolidada necesita IndexedDB.", "Abre la aplicación en un navegador con datos de sitio permitidos.");
    return;
  }
  try {
    if (message.type === "consolidate") {
      const { preview, snapshot, state } = await previewFor(circuitId, message.sourceId);
      if (message.mode === "preview") {
        emit({ type: "consolidation-preview", circuitId, preview }, jobId);
        return;
      }
      if (preview.blockers.length > 0 || snapshot === null) {
        fail(
          `No se puede consolidar: ${preview.blockers.map((blocker) => blocker.detail).join(" ")}`,
          "Resuelve lo que bloquea y vuelve a previsualizar.",
        );
        return;
      }
      const lineage = state.active?.id ?? crypto.randomUUID();
      const version = await consolidate(preview, {
        circuitId,
        snapshot,
        lineage,
        appVersion: APP_VERSION,
        now: Date.now(),
        note: message.note ?? null,
      });
      await saveMemory({ versions: [version], state: withConsolidated(state, version) });
      const memory = await buildMemoryViews(circuitId, snapshot);
      if (memory === undefined) throw new Error("La versión se guardó pero no se pudo volver a leer.");
      emit({ type: "consolidated", circuitId, version, memory }, jobId);
      return;
    }

    if (message.type === "revoke") {
      const { active } = await loadMemory(circuitId);
      const target = active.find((version) => version.version === message.version);
      if (target === undefined) {
        fail(`La versión v${message.version} no está en el linaje activo del circuito.`, "Comprueba el número en la lista de versiones.");
        return;
      }
      await saveVersion(revokeVersion(target, message.reason, Date.now()));
      const snapshots = await loadSnapshots(circuitId);
      const memory = await buildMemoryViews(circuitId, snapshots[snapshots.length - 1] ?? null);
      if (memory === undefined) throw new Error("La revocación se guardó pero no se pudo volver a leer.");
      emit({ type: "revoked", circuitId, version: message.version, memory }, jobId);
      return;
    }

    const { state } = await loadMemory(circuitId);
    const resolved = resolveFork(state, message.choice, message.reason, Date.now());
    await saveMemory({ versions: [], state: resolved });
    const snapshots = await loadSnapshots(circuitId);
    const memory = await buildMemoryViews(circuitId, snapshots[snapshots.length - 1] ?? null);
    if (memory === undefined) throw new Error("La elección se guardó pero no se pudo volver a leer.");
    emit({ type: "fork-resolved", circuitId, memory }, jobId);
  } catch (error) {
    // Solo el tipo del error y su texto: nunca datos (AGENTS.md).
    fail(
      `La operación de memoria falló (${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}).`,
      "Vuelve a intentarlo; si persiste, es un defecto y debe reproducirse con un fixture sintético.",
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
    // Un libro de Excel se lee directamente, primera hoja; si no, es texto (R-DAT-001: tal cual).
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = looksLikeZip(bytes) ? importCatalogRows(await readXlsxRows(bytes)) : importCatalog(decodeSource(bytes.buffer).text);
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
    const failure =
      error instanceof CatalogFailure
        ? error
        : error instanceof XlsxError
          ? { reason: error.reason, recovery: "Guarda el libro de nuevo en Excel (.xlsx) o expórtalo como CSV." }
          : null;
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
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = looksLikeZip(bytes)
      ? importFleetRows(await readXlsxRows(bytes), existing.zone)
      : importFleetHistory(decodeSource(bytes.buffer).text, existing.zone);

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
    const failure =
      error instanceof FleetFailure
        ? error
        : error instanceof XlsxError
          ? { reason: error.reason, recovery: "Guarda el libro de nuevo en Excel (.xlsx) o expórtalo como CSV." }
          : null;
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

  if (message.type === "consolidate" || message.type === "revoke" || message.type === "resolve-fork") {
    currentJobId = message.jobId;
    seq = 0;
    void runMemory(message);
    return;
  }

  currentJobId = message.jobId;
  cancelRequested = false;
  seq = 0;
  void runImport(message);
};
