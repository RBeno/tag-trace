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
import { PROVISIONAL_CONFIG } from "../src/domain/config.js";
import type { CircuitViews } from "../src/application/protocol.js";
import { isAvailable, loadCircuit, saveCircuit } from "../src/persistence/store.js";
import type { Reading } from "../src/domain/reading.js";
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
 * Los agregados que alimentan las vistas.
 *
 * Se calculan **aquí** y no en la interfaz: recorrer doscientas mil lecturas para contarlas por
 * hora es justo el trabajo que WP-001 mantiene fuera del hilo principal, y lo que cruza el
 * `postMessage` son unos cientos de números en lugar de las lecturas otra vez.
 */
async function buildViews(
  circuitId: string | undefined,
  accumulation: AccumulationReport | undefined,
  imported: readonly Reading[],
  zone: string,
): Promise<CircuitViews | undefined> {
  const stored =
    circuitId !== undefined && accumulation?.accumulated === true && isAvailable()
      ? await loadCircuit(circuitId)
      : undefined;
  const readings = stored?.readings ?? imported;
  const coverage = stored?.coverage ?? [];
  if (readings.length === 0) return undefined;

  const views: CircuitViews = {
    hourly: hourlyProfile(readings, zone),
    activity: activityBand(readings, coverage, ACTIVITY_BINS),
  };

  const lists = stored?.lists ?? [];
  if (lists.length === 0) return views;

  const byName = (name: string): ReadonlySet<string> =>
    new Set(lists.find((entry) => entry.list === name)?.tags ?? []);
  const inventory = buildTagInventory(
    readings,
    {
      virtual: byName("circuito"),
      memory: byName("memoria"),
      maintenance: byName("mantenimiento"),
      emergency: byName("emergencia"),
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
    const views = await buildViews(message.circuitId, accumulation, result.readings, zone);

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
