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
import { findDominantCycle, segmentLaps, type Lap, type LapAnchor } from "../src/domain/laps.js";
import { buildReadMatrix, type OrderEvidenceLimits } from "../src/domain/read-matrix.js";
import { buildChargingReport } from "../src/domain/charging.js";
import {
  laneEntryTags,
  readCoLanes,
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
  /** El ancla de cada cohorte, guardada para no volver a buscar el mismo ciclo más abajo. */
  const anchors = new Map<number, LapAnchor>();

  for (const cohort of cohortAssignment.cohorts) {
    const vehicleSet = new Set(cohort.vehicles);
    const cohortTransitions = transitions.filter((entry) => vehicleSet.has(entry.agvId));
    const anchor = findDominantCycle(cohortTransitions);
    if (anchor === null) continue; // Sin ciclo dominante limpio: ese cohorte no tiene vueltas segmentadas.
    anchors.set(cohort.id, anchor);
    const cohortReadings = readings.filter((entry) => vehicleSet.has(entry.agvId));
    laps.push(...segmentLaps(cohortReadings, direction, coverage, anchor.tagId));

    // El ciclo dominante **es** la composición del circuito: cuántos tags lo forman y en qué orden.
    // Estaba calculado desde F2 y se descartaba entero salvo el tag de ancla.
    //
    // Y lo que queda fuera del ciclo no se puede callar: un tag que se lee tan poco que el sucesor
    // dominante lo salta **desaparecería del análisis justo por ser el más sospechoso**. Se cuentan
    // aparte, con sus lectores, sin decidir si son ramas o tags de la línea mal leídos — eso lo
    // separa la prueba de tiempos de OQ-118, que todavía no está implementada.
    const inRing = new Set(anchor.cycle);
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

    shapes.push({
      cohortId: cohort.id,
      vehicles: cohort.vehicles.length,
      tags: anchor.cycle,
      anchorTagId: anchor.tagId,
      weakestShare: anchor.weakestShare,
      offRingTags: [...offRing.entries()]
        .map(([tagId, readers]) => ({ tagId, readers: readers.size }))
        .sort((a, b) => b.readers - a.readers),
    });
    matrices.push(
      buildReadMatrix(
        cohort.id,
        cohortReadings,
        direction,
        coverage,
        anchor.cycle,
        anchor.tagId,
        PROVISIONAL_CONFIG.readRate,
        orderLimits,
        PROVISIONAL_CONFIG.trend,
      ),
    );
  }

  const coverageEnd =
    coverage.length > 0
      ? Math.max(...coverage.map((span) => span.to))
      : (readings[readings.length - 1] as Reading).time.utcMs;

  const agvDossiers = buildAllAgvDossiers(
    readings,
    cohortAssignment,
    laps,
    coverageEnd,
    PROVISIONAL_CONFIG.silence.minGapMs,
    laneConfig.lanes,
  );
  const vehicleIds = agvDossiers.map((dossier) => dossier.agvId);
  const tagDossiers = buildAllTagDossiers(readings, vehicleIds);

  const replayFrames = buildReplayFrames(readings, REPLAY_FRAMES, PROVISIONAL_CONFIG.silence.minGapMs);

  const views: CircuitViews = {
    hourly: hourlyProfile(readings, zone),
    activity: activityBand(readings, coverage, ACTIVITY_BINS),
    cohorts: cohortAssignment.cohorts,
    shapes,
    readMatrices: matrices,
    agvDossiers,
    tagDossiers,
    replay: replayFrames.map((frame) => ({ atUtcMs: frame.atUtcMs, vehicles: [...frame.vehicles] })),
    ...(laneConfig.lanes.length === 0 && laneConfig.problems.length === 0
      ? {}
      : {
          charging: {
            lanes: charging.lanes.map((lane) => ({
              laneId: lane.laneId,
              capacity: lane.capacity,
              served: lane.served,
              stays: lane.stays.length,
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
    orderWithheld: matrices.reduce((total, matrix) => total + matrix.orderWithheld, 0),
  };

  if (lists.length === 0) return views;

  const byName = (name: string): ReadonlySet<string> =>
    new Set(lists.find((entry) => entry.list === name)?.tags ?? []);
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
    },
    PROVISIONAL_CONFIG.blindness,
  );

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
    const views = await buildViews(message.circuitId, accumulation, result.readings, zone, result.summary.direction);

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

scope.onmessage = (event: MessageEvent<ToWorker>): void => {
  const message = event.data;
  if (message.protocolVersion !== PROTOCOL_VERSION) return;

  if (message.type === "lists") {
    currentJobId = message.jobId;
    seq = 0;
    void runLists(message);
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
