/**
 * Almacén local del dispositivo (IndexedDB).
 *
 * Es donde se **acumula**: el servidor de planta guarda dos o tres días, así que lo que no se
 * extraiga y se guarde aquí se pierde para siempre. Todo lo que ha tenido valor en este proyecto
 * salió de comparar dos ventanas separadas por semanas, y eso solo existe si alguien las guarda.
 *
 * **Migraciones explícitas desde el primer día.** El prototipo se quedó en la versión 1 sin ninguna
 * ruta de migración, así que el primer cambio de forma le habría costado los datos del usuario —los
 * únicos que no se pueden volver a pedir—. Aquí subir `STORE_VERSION` obliga a escribir su paso.
 *
 * **Versión 6 (ADR-0015).** Tres tablas: `circuits` (identidad, fuentes con sus metadatos, cobertura,
 * listas, flota; **sin lecturas**), `sources` (las lecturas de cada fuente, solo mientras estén
 * retenidas, R-DAT-023) y `snapshots` (una instantánea por fuente, lo que perdura de cada fichero).
 * Hasta la versión 5 el circuito era un solo valor con todas sus lecturas, y el de auditoría pasó del
 * tamaño máximo de un valor de IndexedDB en Chromium (OQ-142).
 *
 * **Versión 7 (F4, ADR-0005).** Dos tablas más: `memory`, las versiones consolidadas del circuito,
 * **append-only** —clave `[circuitId, hash]`, porque en una bifurcación dos linajes pueden tener la
 * misma numeración y solo el hash las distingue; la única reescritura admitida es la copia revocada—,
 * y `memoryState`, el estado de linaje de cada circuito (activo, entrante sin resolver, archivados y
 * las elecciones registradas, `MEMORY_CONSOLIDATION.md` §10).
 *
 * **Versión 8 (ADR-0016).** La tabla `plan`: los eventos del plano físico de cada circuito, clave
 * `[circuitId, seq]`, **append-only** —se añaden con `add`, nunca se reescriben—. El plano de un
 * instante se reconstruye recorriéndolos (`planAt`).
 *
 * **Versión 10 (OQ-140, OQ-151).** La tabla `plantValues`: los valores de planta que una persona
 * confirma para el circuito, clave `[circuitId, seq]`, **append-only** como el plano —se añaden con
 * `add`, nunca se reescriben—. Lo vigente para un fichero se resuelve recorriéndolos (`plantValuesAt`).
 */

import type { Interval } from "../domain/coverage.js";
import type { PlanEvent } from "../domain/plan.js";
import type { PlantValueEvent } from "../domain/plant-values.js";
import type { FleetPeriod } from "../domain/fleet.js";
import type { ConnectionEvent } from "../domain/wifi-cuts.js";
import { sortVersions, type ConsolidatedVersion, type LineageState } from "../domain/memory.js";
import type { Reading } from "../domain/reading.js";
import type { ReviewEntry } from "../domain/review.js";
import type { CircuitSnapshot } from "../domain/snapshot.js";
import { gunzip, gunzipJson, gzip, gzipJson } from "./compression.js";
import { splitLegacyCircuit, type LegacyCircuitRecord } from "./retention.js";

/** Subirla sin añadir su paso en `MIGRATIONS` es un error, y el propio módulo lo comprueba. */
export const STORE_VERSION = 10;

const DATABASE = "tag-trace";
const CIRCUITS = "circuits";
/**
 * La revisión en campo, en su propia tabla y no dentro del circuito. No es orden: el Worker
 * reescribe el circuito entero en cada importación, y una marca guardada desde la interfaz mientras
 * tanto se perdería. Aquí solo escribe la interfaz, y cada marca es su propia transacción.
 */
const REVIEWS = "reviews";
/** Las lecturas de cada fuente retenida, un registro por fuente: clave `[circuitId, sourceId]`. */
const SOURCES = "sources";
/** Una instantánea por fuente (ADR-0015): clave `[circuitId, sourceId]`. */
const SNAPSHOTS = "snapshots";
/** Las versiones consolidadas, append-only (F4): clave `[circuitId, hash]`. */
const MEMORY = "memory";
/** El estado de linaje de cada circuito (§10): clave `circuitId`. */
const MEMORY_STATE = "memoryState";
/** Los eventos del plano físico (ADR-0016), append-only: clave `[circuitId, seq]`. */
const PLAN = "plan";
/**
 * El archivo de ficheros originales, comprimidos, uno por huella (OQ-145): clave
 * `[circuitId, sourceHash]`. Es la evidencia para revisar o volver a medir el pasado con reglas
 * nuevas; no viaja en el `.agvproj` (ADR-0012: el bruto no sale del dispositivo por defecto).
 */
const ARCHIVE = "archive";
/** Los valores de planta confirmados (OQ-140), append-only: clave `[circuitId, seq]`. */
const PLANT_VALUES = "plantValues";

/** Las marcas de revisión de un circuito, por clave de hallazgo (`src/domain/review.ts`). */
export interface StoredReviews {
  readonly circuitId: string;
  readonly entries: Readonly<Record<string, ReviewEntry>>;
}

export interface StoredSource {
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  readonly importedAt: number;
  readonly acceptedRows: number;
  /** Tramo analizable de esta fuente; la cola cortada queda fuera (R-DAT-007). */
  readonly complete: Interval | null;
  /** Si sus lecturas siguen en la tabla `sources` (R-DAT-023). Sin ellas no hay expediente ni replay. */
  readonly retained: boolean;
  /**
   * Si tiene instantánea en la tabla `snapshots`. Es `false` en las fuentes anteriores a la versión 6
   * —no hay análisis guardado con que fabricarla— y cuando el análisis no pudo construirla; volver a
   * cargar el fichero la crea.
   */
  readonly snapshot: boolean;
}

/**
 * Una lista de tags declarada por planta, tal como se cargó (`CONFIG_SCHEMA.md` §3.8).
 *
 * Se guarda **con el circuito** y no aparte porque es parte de su estado en el momento del
 * análisis: repetir un análisis de hace tres meses tiene que usar las listas de hace tres meses, no
 * las de hoy. Si el técnico aplica los cambios propuestos y vuelve a cargarlas, el análisis
 * siguiente las recoge ya actualizadas, y el anterior sigue explicándose con las suyas.
 */
/**
 * Lo que una fila de lista declara sobre su tag, más allá de pertenecer a ella.
 *
 * Existe porque una calle de carga **no es un conjunto de tags**: es una secuencia con papeles
 * —entrada, parada precisa, salida— y una capacidad, y sin eso R-CO-006 no puede reconocer su firma.
 * Lo mismo vale para la zona de cada tag (R-FLO-001/002) y para la clase de un punto crítico.
 */
export interface StoredTagEntry {
  readonly tagId: string;
  readonly order: number | null;
  readonly funcion: string;
  readonly grupo: string;
  readonly capacidad: number | null;
  readonly note: string;
}

export interface StoredTagList {
  readonly list: string;
  /**
   * Los tags de la lista, sin repetir y **en el orden en que el fichero los trae**.
   *
   * Se conserva como lista plana además de `entries` porque es lo que consumen el inventario y el
   * contraste contra Vsystem, y porque un circuito guardado antes de la versión 3 solo tiene esto.
   */
  readonly tags: readonly string[];
  /** Los metadatos por tag. Ausente en circuitos guardados antes de la versión 3. */
  readonly entries?: readonly StoredTagEntry[];
  /** Cuándo se extrajo de planta. Sin esto no se sabe qué periodo puede juzgar (OQ-123). */
  readonly extractedAt: number | null;
  readonly loadedAt: number;
  readonly fileName: string;
}

/**
 * El circuito, sin lecturas: las lecturas retenidas viven en `sources` y lo que perdura de cada
 * fichero en `snapshots`. Este registro es pequeño y se reescribe entero en cada importación.
 */
export interface StoredCircuit {
  readonly circuitId: string;
  readonly name: string;
  readonly zone: string;
  /** Todas las fuentes cargadas, en orden de carga, con si están retenidas y si tienen instantánea. */
  readonly sources: readonly StoredSource[];
  /** La cobertura de **todas** las fuentes aceptadas (R-DAT-007), retenidas o no. */
  readonly coverage: readonly Interval[];
  /** Listas de planta vigentes. Ausente en circuitos guardados antes de la versión 2. */
  readonly lists?: readonly StoredTagList[];
  /** Historial de flota (DS-012). Ausente hasta que se carga, y en circuitos anteriores a la versión 4. */
  readonly fleet?: StoredFleet;
  /** Informes de conexiones wifi por AGV (DS-013). Ausente hasta que se carga el primero. */
  readonly wifi?: StoredWifi;
  readonly updatedAt: number;
}

/** Las lecturas de una fuente retenida. */
export interface StoredSourceReadings {
  readonly circuitId: string;
  readonly sourceId: string;
  readonly readings: readonly Reading[];
}

/**
 * Cómo se guarda de verdad un registro de lecturas: desde la versión 9, comprimido (`gz`, OQ-145).
 * Los guardados antes siguen con `readings` en claro y se leen igual; la siguiente escritura de esa
 * fuente ya los comprime. No hay migración que los reescriba: comprimir es asíncrono y una
 * transacción de migración de IndexedDB no puede esperar a nada que no sea el propio almacén.
 */
export interface SourceReadingsRow {
  readonly circuitId: string;
  readonly sourceId: string;
  readonly readings?: readonly Reading[];
  readonly gz?: Uint8Array;
}

/** Una versión consolidada tal como se guarda desde la versión 9: su clave y el JSON comprimido. */
export interface VersionRow {
  readonly circuitId: string;
  readonly hash: string;
  readonly gz: Uint8Array;
}

/** Un fichero original archivado (OQ-145). */
export interface ArchivedSource {
  readonly circuitId: string;
  readonly sourceHash: string;
  readonly sourceId: string;
  readonly fileName: string;
  readonly importedAt: number;
  /** Bytes del fichero sin comprimir. */
  readonly originalBytes: number;
}

interface ArchiveRow extends ArchivedSource {
  readonly gz: Uint8Array;
}

async function readingsRow(circuitId: string, sourceId: string, readings: readonly Reading[]): Promise<SourceReadingsRow> {
  return { circuitId, sourceId, gz: await gzipJson(readings) };
}

/** Las lecturas de una fila de `sources`: comprimidas desde la versión 9, o tal cual si se guardaron antes. */
export async function readingsOf(row: SourceReadingsRow): Promise<StoredSourceReadings> {
  const readings = row.gz !== undefined ? await gunzipJson<Reading[]>(row.gz) : (row.readings ?? []);
  return { circuitId: row.circuitId, sourceId: row.sourceId, readings };
}

async function versionRow(version: ConsolidatedVersion): Promise<VersionRow> {
  return { circuitId: version.circuitId, hash: version.hash, gz: await gzipJson(version) };
}

/** La versión de una fila de `memory`: descomprimida si es una fila de la versión 9, o la propia versión si se guardó antes. */
export async function versionOf(row: VersionRow | ConsolidatedVersion): Promise<ConsolidatedVersion> {
  return isVersionRow(row) ? gunzipJson<ConsolidatedVersion>(row.gz) : row;
}

/** Una fila de `memory`: comprimida desde la versión 9, o la propia versión si se guardó antes. */
function isVersionRow(row: VersionRow | ConsolidatedVersion): row is VersionRow {
  return (row as VersionRow).gz instanceof Uint8Array;
}

export interface StoredSnapshot {
  readonly circuitId: string;
  readonly sourceId: string;
  readonly snapshot: CircuitSnapshot;
}

/** Una versión consolidada tal como se guarda: la propia versión, cuya clave es `[circuitId, hash]`. */
export type StoredVersion = ConsolidatedVersion;

/** El estado de linaje de un circuito, tal como se guarda (`src/domain/memory.ts`). */
export type StoredMemoryState = LineageState;

/**
 * El historial de flota del circuito, **acumulado**: cada carga se fusiona por (AGV, `desde`) con lo
 * guardado, a diferencia de las listas, que se sustituyen enteras.
 */
export interface StoredFleet {
  /** El valor de la columna `circuito` que corresponde a este circuito, si el fichero trae varios. */
  readonly circuitName: string | null;
  readonly periods: readonly FleetPeriod[];
  readonly loadedAt: number;
  readonly fileNames: readonly string[];
}

/**
 * Los informes de conexiones wifi del circuito (DS-013), **acumulados** por AGV: cada carga se
 * fusiona con lo guardado de ese AGV, como el historial de flota. Un AGV sin informe no tiene
 * entrada, y eso es distinto de tenerla vacía: sus huecos de lectura no se pueden separar.
 */
export interface StoredWifi {
  readonly byAgv: Readonly<
    Record<string, { readonly events: readonly ConnectionEvent[]; readonly fileNames: readonly string[]; readonly loadedAt: number }>
  >;
}

/** Todas las claves `[circuitId, *]` de una tabla con clave compuesta: un array ordena después de cualquier texto. */
function circuitRange(circuitId: string): IDBKeyRange {
  return IDBKeyRange.bound([circuitId], [circuitId, []]);
}

/**
 * La escalera de migraciones, un peldaño por versión.
 *
 * Cada paso recibe la base a medio abrir —y la transacción de actualización, que permite leer y
 * escribir— y deja el esquema en su versión destino. No se salta ninguno: abrir una base vieja
 * recorre los peldaños que le falten, en orden.
 */
const MIGRATIONS: readonly { readonly to: number; readonly apply: (db: IDBDatabase, tx: IDBTransaction) => void }[] = [
  {
    to: 1,
    apply: (db) => {
      db.createObjectStore(CIRCUITS, { keyPath: "circuitId" });
    },
  },
  {
    to: 2,
    // Las listas de tags entran en el circuito. No hay nada que reescribir: el campo es opcional
    // al leer, así que un circuito de la versión 1 se abre sin listas y las gana cuando se carguen.
    //
    // El peldaño existe igualmente, y no es burocracia: es lo que deja constancia de que la forma
    // cambió aquí. Sin él, la próxima persona que suba la versión no sabría en qué estado encuentra
    // una base vieja, que es exactamente cómo el prototipo se quedó sin ruta de migración.
    apply: () => {},
  },
  {
    to: 3,
    // Las listas ganan metadatos por tag (`entries`): papel, grupo y capacidad. Tampoco hay nada
    // que reescribir —el campo es opcional—, y la degradación es la correcta: una lista guardada
    // en la versión 2 sigue leyéndose, no monta calles, y R-CO-006 dice justamente eso, que sin
    // calles configuradas la firma no se reconoce. Volver a cargar el fichero la completa.
    apply: () => {},
  },
  {
    to: 4,
    // El historial de flota entra en el circuito (DS-012). Campo opcional: un circuito anterior se
    // abre sin historial y su flota son los vehículos que aparecen en las lecturas, que es lo que
    // la vista dice cuando no hay historial.
    apply: () => {},
  },
  {
    to: 5,
    // La revisión en campo, en una tabla nueva y vacía: nada que reescribir en los circuitos.
    apply: (db) => {
      db.createObjectStore(REVIEWS, { keyPath: "circuitId" });
    },
  },
  {
    to: 6,
    // El circuito deja de llevar sus lecturas (ADR-0015). Se crean `sources` y `snapshots` y, en la
    // misma transacción de actualización, cada circuito antiguo se parte: sus lecturas van a
    // `sources` por procedencia, se aplica la retención (R-DAT-023) y el registro queda sin
    // `readings`. Las instantáneas de los ficheros antiguos no se pueden fabricar —no hay análisis
    // guardado— y las fuentes quedan con `snapshot: false` hasta que se vuelvan a cargar.
    //
    // Se hace aquí y no «la próxima vez que se importe» porque una base a medias —unos circuitos
    // partidos y otros no— es justo el estado que ninguna función de lectura sabría interpretar.
    apply: (db, tx) => {
      db.createObjectStore(SOURCES, { keyPath: ["circuitId", "sourceId"] });
      db.createObjectStore(SNAPSHOTS, { keyPath: ["circuitId", "sourceId"] });
      const circuits = tx.objectStore(CIRCUITS);
      const sources = tx.objectStore(SOURCES);
      const cursor = circuits.openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (current === null) return;
        const legacy = current.value as LegacyCircuitRecord & Record<string, unknown>;
        const split = splitLegacyCircuit({ ...legacy, readings: legacy.readings ?? [], sources: legacy.sources ?? [] });
        for (const entry of split.readings) {
          sources.put({ circuitId: legacy.circuitId, sourceId: entry.sourceId, readings: entry.readings } satisfies StoredSourceReadings);
        }
        const { readings: _readings, ...rest } = legacy;
        current.update({ ...rest, sources: split.sources });
        current.continue();
      };
    },
  },
  {
    to: 7,
    // La memoria consolidada (F4): dos tablas nuevas y vacías. Nada que reescribir: ningún circuito
    // anterior tiene versiones —consolidar es una acción humana que hasta ahora no existía— y el
    // estado de linaje se crea con la primera consolidación o el primer `.agvproj` con memoria.
    apply: (db) => {
      db.createObjectStore(MEMORY, { keyPath: ["circuitId", "hash"] });
      db.createObjectStore(MEMORY_STATE, { keyPath: "circuitId" });
    },
  },
  {
    to: 8,
    // El plano físico (ADR-0016): una tabla nueva y vacía. Nada que reescribir: el plano nace con una
    // acción humana desde una versión consolidada, y ningún circuito anterior lo tiene.
    apply: (db) => {
      db.createObjectStore(PLAN, { keyPath: ["circuitId", "seq"] });
    },
  },
  {
    to: 9,
    // El archivo de ficheros originales comprimidos (OQ-145): una tabla nueva. Las lecturas retenidas
    // y las versiones pasan a guardarse comprimidas en su próxima escritura; las de antes se leen igual.
    apply: (db) => {
      db.createObjectStore(ARCHIVE, { keyPath: ["circuitId", "sourceHash"] });
    },
  },
  {
    to: 10,
    // Los valores de planta confirmados (OQ-140): una tabla nueva y vacía. Nada que reescribir: sin
    // eventos rige el provisional, que es exactamente lo que cada circuito anterior venía usando.
    apply: (db) => {
      db.createObjectStore(PLANT_VALUES, { keyPath: ["circuitId", "seq"] });
    },
  },
];

if (MIGRATIONS[MIGRATIONS.length - 1]?.to !== STORE_VERSION) {
  throw new Error("STORE_VERSION cambió sin añadir su migración: el almacén no se abre así.");
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, STORE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction as IDBTransaction;
      const from = event.oldVersion;
      for (const step of MIGRATIONS) {
        if (step.to > from) step.apply(db, tx);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir el almacén local."));
  });
}

function run<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Operación rechazada por el almacén."));
    void store;
  });
}

/** Espera a que una transacción de escritura termine; o queda todo lo escrito o no queda nada. */
function settle(tx: IDBTransaction, failure: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(failure));
    tx.onabort = () => reject(tx.error ?? new Error(`${failure} La escritura se abortó.`));
  });
}

/** ¿Hay almacén? En un contexto sin IndexedDB —o con datos de sitio bloqueados— no lo hay. */
export function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Abre el almacén y lo cierra: sirve para que la migración pendiente se haga **al abrir la
 * aplicación**, no a mitad de la primera importación, que es cuando menos se espera una espera larga.
 */
export async function ensureStore(): Promise<void> {
  const db = await open();
  db.close();
}

export async function listCircuits(): Promise<readonly StoredCircuit[]> {
  const db = await open();
  try {
    const tx = db.transaction(CIRCUITS, "readonly");
    const store = tx.objectStore(CIRCUITS);
    return await run(store, store.getAll() as IDBRequest<StoredCircuit[]>);
  } finally {
    db.close();
  }
}

export async function loadCircuit(circuitId: string): Promise<StoredCircuit | undefined> {
  const db = await open();
  try {
    const tx = db.transaction(CIRCUITS, "readonly");
    const store = tx.objectStore(CIRCUITS);
    return await run(store, store.get(circuitId) as IDBRequest<StoredCircuit | undefined>);
  } finally {
    db.close();
  }
}

/**
 * Guarda el registro del circuito —sin lecturas— en una transacción.
 *
 * O queda el estado nuevo o queda el anterior: nunca una mezcla. Es lo que hace que cancelar a
 * mitad no deje un proyecto a medias con aspecto de estar bien (INV-006).
 */
export async function saveCircuit(circuit: StoredCircuit): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(CIRCUITS, "readwrite");
    tx.objectStore(CIRCUITS).put(circuit);
    await settle(tx, "No se pudo guardar el circuito.");
  } finally {
    db.close();
  }
}

/**
 * Una importación acumulada, en **una sola** transacción: el circuito sin lecturas, las lecturas de
 * la fuente nueva y la retirada de las que dejan de estar retenidas. Tres transacciones dejarían,
 * ante un cierre a mitad, un circuito que dice retener lo que ya no está (INV-006).
 */
export async function saveAccumulation(input: {
  readonly circuit: StoredCircuit;
  readonly readings: readonly { readonly sourceId: string; readonly readings: readonly Reading[] }[];
  readonly drop: readonly string[];
}): Promise<void> {
  // Se comprime antes de abrir la transacción: una transacción de IndexedDB se cierra sola en cuanto
  // se espera algo que no sea el propio almacén.
  const rows = await Promise.all(input.readings.map((entry) => readingsRow(input.circuit.circuitId, entry.sourceId, entry.readings)));
  const db = await open();
  try {
    const tx = db.transaction([CIRCUITS, SOURCES], "readwrite");
    tx.objectStore(CIRCUITS).put(input.circuit);
    const sources = tx.objectStore(SOURCES);
    for (const row of rows) sources.put(row);
    for (const sourceId of input.drop) sources.delete([input.circuit.circuitId, sourceId]);
    await settle(tx, "No se pudo guardar la importación.");
  } finally {
    db.close();
  }
}

/** Las lecturas de las fuentes retenidas de un circuito, un registro por fuente (R-DAT-023). */
export async function loadRetainedReadings(circuitId: string): Promise<readonly StoredSourceReadings[]> {
  const db = await open();
  try {
    const tx = db.transaction(SOURCES, "readonly");
    const store = tx.objectStore(SOURCES);
    const rows = await run(store, store.getAll(circuitRange(circuitId)) as IDBRequest<SourceReadingsRow[]>);
    db.close();
    return await Promise.all(rows.map(readingsOf));
  } finally {
    db.close();
  }
}

export async function saveSourceReadings(circuitId: string, sourceId: string, readings: readonly Reading[]): Promise<void> {
  const row = await readingsRow(circuitId, sourceId, readings);
  const db = await open();
  try {
    const tx = db.transaction(SOURCES, "readwrite");
    tx.objectStore(SOURCES).put(row);
    await settle(tx, "No se pudieron guardar las lecturas de la fuente.");
  } finally {
    db.close();
  }
}

/** Retira del almacén las lecturas de esas fuentes: dejan de estar retenidas y quedan como instantánea. */
export async function dropSourceReadings(circuitId: string, sourceIds: readonly string[]): Promise<void> {
  if (sourceIds.length === 0) return;
  const db = await open();
  try {
    const tx = db.transaction(SOURCES, "readwrite");
    const store = tx.objectStore(SOURCES);
    for (const sourceId of sourceIds) store.delete([circuitId, sourceId]);
    await settle(tx, "No se pudieron retirar las lecturas.");
  } finally {
    db.close();
  }
}

export async function saveSnapshot(snapshot: CircuitSnapshot): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(SNAPSHOTS, "readwrite");
    tx.objectStore(SNAPSHOTS).put({ circuitId: snapshot.circuitId, sourceId: snapshot.sourceId, snapshot } satisfies StoredSnapshot);
    await settle(tx, "No se pudo guardar la instantánea.");
  } finally {
    db.close();
  }
}

/** Las instantáneas de un circuito, en orden de ventana: la secuencia es la evolución (ADR-0015 §3). */
export async function loadSnapshots(circuitId: string): Promise<readonly CircuitSnapshot[]> {
  const db = await open();
  try {
    const tx = db.transaction(SNAPSHOTS, "readonly");
    const store = tx.objectStore(SNAPSHOTS);
    const stored = await run(store, store.getAll(circuitRange(circuitId)) as IDBRequest<StoredSnapshot[]>);
    return stored
      .map((entry) => entry.snapshot)
      .sort((a, b) => a.window.from - b.window.from || a.window.to - b.window.to || a.sourceId.localeCompare(b.sourceId));
  } finally {
    db.close();
  }
}

export async function deleteCircuit(circuitId: string): Promise<void> {
  const db = await open();
  try {
    // El circuito, sus lecturas, sus instantáneas, su revisión, su memoria, su plano y sus valores de
    // planta se van juntos: nada de eso sin su circuito significa nada.
    const tx = db.transaction([CIRCUITS, REVIEWS, SOURCES, SNAPSHOTS, MEMORY, MEMORY_STATE, PLAN, ARCHIVE, PLANT_VALUES], "readwrite");
    tx.objectStore(CIRCUITS).delete(circuitId);
    tx.objectStore(REVIEWS).delete(circuitId);
    tx.objectStore(SOURCES).delete(circuitRange(circuitId));
    tx.objectStore(SNAPSHOTS).delete(circuitRange(circuitId));
    tx.objectStore(MEMORY).delete(circuitRange(circuitId));
    tx.objectStore(MEMORY_STATE).delete(circuitId);
    tx.objectStore(PLAN).delete(circuitRange(circuitId));
    tx.objectStore(ARCHIVE).delete(circuitRange(circuitId));
    tx.objectStore(PLANT_VALUES).delete(circuitRange(circuitId));
    await settle(tx, "No se pudo borrar el circuito.");
  } finally {
    db.close();
  }
}

/** Las marcas de revisión de un circuito; vacías si nunca se ha marcado nada. */
export async function loadReviews(circuitId: string): Promise<ReadonlyMap<string, ReviewEntry>> {
  const db = await open();
  try {
    const tx = db.transaction(REVIEWS, "readonly");
    const store = tx.objectStore(REVIEWS);
    const stored = await run(store, store.get(circuitId) as IDBRequest<StoredReviews | undefined>);
    return new Map(Object.entries(stored?.entries ?? {}));
  } finally {
    db.close();
  }
}

/**
 * Guarda o borra una marca, leyendo y escribiendo en la **misma** transacción: dos pulsaciones
 * seguidas no se pisan. `null` la borra, que es volver a «pendiente».
 */
export async function saveReview(circuitId: string, key: string, entry: ReviewEntry | null): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(REVIEWS, "readwrite");
      const store = tx.objectStore(REVIEWS);
      const request = store.get(circuitId) as IDBRequest<StoredReviews | undefined>;
      request.onsuccess = () => {
        const entries = { ...(request.result?.entries ?? {}) };
        if (entry === null) delete entries[key];
        else entries[key] = entry;
        store.put({ circuitId, entries } satisfies StoredReviews);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar la revisión."));
      tx.onabort = () => reject(tx.error ?? new Error("La escritura de la revisión se abortó."));
    });
  } finally {
    db.close();
  }
}

// --- Memoria consolidada (F4) ----------------------------------------------------------------------

/**
 * Guarda una versión: la añade si es nueva o, si ya existe con ese hash, la sustituye. La única
 * sustitución legítima es la **copia revocada** (`revokeVersion`): el hash no cambia al revocar, así
 * que la clave es la misma y lo demás de la versión también.
 */
export async function saveVersion(version: ConsolidatedVersion): Promise<void> {
  const row = await versionRow(version);
  const db = await open();
  try {
    const tx = db.transaction(MEMORY, "readwrite");
    tx.objectStore(MEMORY).put(row);
    await settle(tx, "No se pudo guardar la versión consolidada.");
  } finally {
    db.close();
  }
}

/**
 * Versiones y estado de linaje en **una sola** transacción: una consolidación es la versión nueva más
 * el linaje que la incorpora, y abrir un `.agvproj` con memoria son sus versiones más la relación
 * clasificada. Dos transacciones dejarían, ante un cierre a mitad, un linaje que nombra un hash que no
 * está o una versión que ningún linaje reclama (INV-006).
 */
export async function saveMemory(
  input: {
    readonly versions: readonly ConsolidatedVersion[];
    readonly state: StoredMemoryState;
  },
  /**
   * Opcional: los hashes del linaje activo tal como estaban cuando quien escribe **leyó** el estado
   * (`null` si no había linaje activo). Se comparan con lo guardado dentro de la misma transacción y,
   * si difieren, no se escribe nada y se lanza `MemoryChangedError`: el hilo principal pudo escribir
   * la memoria al abrir un `.agvproj` mientras el Worker preparaba una consolidación, y una escritura
   * a ciegas encima dejaría un linaje que no corresponde a lo que la persona confirmó. Sin este
   * argumento se escribe como hasta ahora (la importación de un proyecto, que ya trae la relación resuelta).
   */
  expected?: { readonly activeHashes: readonly string[] | null },
): Promise<void> {
  const rows = await Promise.all(input.versions.map(versionRow));
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([MEMORY, MEMORY_STATE], "readwrite");
      const memory = tx.objectStore(MEMORY);
      const states = tx.objectStore(MEMORY_STATE);
      const write = (): void => {
        for (const row of rows) memory.put(row);
        states.put(input.state);
      };
      let refused: MemoryChangedError | null = null;
      if (expected === undefined) {
        write();
      } else {
        const request = states.get(input.state.circuitId) as IDBRequest<StoredMemoryState | undefined>;
        request.onsuccess = () => {
          const stored = request.result?.active?.hashes ?? null;
          if (sameHashes(stored, expected.activeHashes)) {
            write();
            return;
          }
          refused = new MemoryChangedError();
          tx.abort();
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(refused ?? tx.error ?? new Error("No se pudo guardar la memoria del circuito."));
      tx.onabort = () => reject(refused ?? tx.error ?? new Error("No se pudo guardar la memoria del circuito. La escritura se abortó."));
    });
  } finally {
    db.close();
  }
}

/** La memoria guardada ya no es la que se leyó antes de preparar la escritura: nada se ha escrito. */
export class MemoryChangedError extends Error {
  constructor() {
    super("La memoria del circuito cambió mientras se preparaba la escritura.");
    this.name = "MemoryChangedError";
  }
}

function sameHashes(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) return a === b;
  return a.length === b.length && a.every((hash, index) => hash === b[index]);
}

/** Todas las versiones de un circuito —de todos los linajes, revocadas incluidas—, en orden de versión y fecha. */
export async function loadVersions(circuitId: string): Promise<readonly ConsolidatedVersion[]> {
  const db = await open();
  try {
    const tx = db.transaction(MEMORY, "readonly");
    const store = tx.objectStore(MEMORY);
    const rows = await run(store, store.getAll(circuitRange(circuitId)) as IDBRequest<(VersionRow | StoredVersion)[]>);
    db.close();
    const versions = await Promise.all(rows.map(versionOf));
    return sortVersions(versions);
  } finally {
    db.close();
  }
}

/** Bytes que ocupan las versiones del circuito tal como están guardadas (comprimidas desde la versión 9). */
export async function memoryStoredBytes(circuitId: string): Promise<number> {
  const db = await open();
  try {
    const tx = db.transaction(MEMORY, "readonly");
    const store = tx.objectStore(MEMORY);
    const rows = await run(store, store.getAll(circuitRange(circuitId)) as IDBRequest<(VersionRow | StoredVersion)[]>);
    return rows.reduce((sum, row) => sum + (isVersionRow(row) ? row.gz.length : new TextEncoder().encode(JSON.stringify(row)).length), 0);
  } finally {
    db.close();
  }
}

/**
 * Archiva el fichero original comprimido (OQ-145). Si ya está archivado con esa huella no se vuelve
 * a comprimir: es el mismo fichero, byte a byte.
 */
export async function archiveSource(entry: Omit<ArchivedSource, "originalBytes">, bytes: Uint8Array): Promise<boolean> {
  if (await hasArchive(entry.circuitId, entry.sourceHash)) return false;
  const row: ArchiveRow = { ...entry, originalBytes: bytes.length, gz: await gzip(bytes) };
  const db = await open();
  try {
    const tx = db.transaction(ARCHIVE, "readwrite");
    tx.objectStore(ARCHIVE).put(row);
    await settle(tx, "No se pudo archivar el fichero original.");
    return true;
  } finally {
    db.close();
  }
}

async function hasArchive(circuitId: string, sourceHash: string): Promise<boolean> {
  const db = await open();
  try {
    const tx = db.transaction(ARCHIVE, "readonly");
    const store = tx.objectStore(ARCHIVE);
    return (await run(store, store.count([circuitId, sourceHash]))) > 0;
  } finally {
    db.close();
  }
}

/** Los ficheros archivados de un circuito, sin su contenido, con lo que ocupan comprimidos. */
export async function listArchive(circuitId: string): Promise<readonly (ArchivedSource & { readonly storedBytes: number })[]> {
  const db = await open();
  try {
    const tx = db.transaction(ARCHIVE, "readonly");
    const store = tx.objectStore(ARCHIVE);
    const rows = await run(store, store.getAll(circuitRange(circuitId)) as IDBRequest<ArchiveRow[]>);
    return rows.map(({ gz, ...entry }) => ({ ...entry, storedBytes: gz.length }));
  } finally {
    db.close();
  }
}

/** El fichero original, descomprimido, o `undefined` si no está archivado. */
export async function loadArchivedSource(circuitId: string, sourceHash: string): Promise<Uint8Array | undefined> {
  const db = await open();
  let row: ArchiveRow | undefined;
  try {
    const tx = db.transaction(ARCHIVE, "readonly");
    const store = tx.objectStore(ARCHIVE);
    row = await run(store, store.get([circuitId, sourceHash]) as IDBRequest<ArchiveRow | undefined>);
  } finally {
    db.close();
  }
  return row === undefined ? undefined : gunzip(row.gz);
}

/** El estado de linaje del circuito, o `undefined` si nunca consolidó ni abrió un proyecto con memoria. */
export async function loadMemoryState(circuitId: string): Promise<StoredMemoryState | undefined> {
  const db = await open();
  try {
    const tx = db.transaction(MEMORY_STATE, "readonly");
    const store = tx.objectStore(MEMORY_STATE);
    return await run(store, store.get(circuitId) as IDBRequest<StoredMemoryState | undefined>);
  } finally {
    db.close();
  }
}

export async function saveMemoryState(state: StoredMemoryState): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(MEMORY_STATE, "readwrite");
    tx.objectStore(MEMORY_STATE).put(state);
    await settle(tx, "No se pudo guardar el estado de linaje.");
  } finally {
    db.close();
  }
}

// --- Plano físico (ADR-0016) ------------------------------------------------------------------------

/**
 * Añade eventos del plano en **una sola** transacción, con `add`: si alguno ya existe con ese
 * `[circuitId, seq]`, la transacción se aborta y no queda ninguno. Un evento nunca se reescribe; una
 * corrección es otro evento (append-only, como la memoria).
 */
export async function appendPlanEvents(events: readonly PlanEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await open();
  try {
    const tx = db.transaction(PLAN, "readwrite");
    const store = tx.objectStore(PLAN);
    // Una clave repetida hace fallar su `add`; el error sube a la transacción, que se aborta entera.
    for (const event of events) store.add(event);
    await settle(tx, "No se pudieron guardar los eventos del plano (¿número de evento repetido?).");
  } finally {
    db.close();
  }
}

/** Los eventos del plano de un circuito, en orden de registro (`seq`); vacío si no tiene plano. */
export async function loadPlanEvents(circuitId: string): Promise<readonly PlanEvent[]> {
  const db = await open();
  try {
    const tx = db.transaction(PLAN, "readonly");
    const store = tx.objectStore(PLAN);
    const stored = await run(store, store.getAll(circuitRange(circuitId)) as IDBRequest<PlanEvent[]>);
    return [...stored].sort((a, b) => a.seq - b.seq);
  } finally {
    db.close();
  }
}

// --- Valores de planta confirmados (OQ-140) -------------------------------------------------------

/**
 * Añade valores de planta en **una sola** transacción, con `add`: si alguno ya existe con ese
 * `[circuitId, seq]`, la transacción se aborta y no queda ninguno. Un valor nunca se reescribe; una
 * corrección es otro evento con su fecha y su razón.
 */
export async function appendPlantValues(events: readonly PlantValueEvent[]): Promise<void> {
  if (events.length === 0) return;
  const db = await open();
  try {
    const tx = db.transaction(PLANT_VALUES, "readwrite");
    const store = tx.objectStore(PLANT_VALUES);
    for (const event of events) store.add(event);
    await settle(tx, "No se pudieron guardar los valores de planta (¿número de evento repetido?).");
  } finally {
    db.close();
  }
}

/** Añade un valor de planta confirmado (append-only). */
export async function appendPlantValue(event: PlantValueEvent): Promise<void> {
  await appendPlantValues([event]);
}

/** Los valores de planta confirmados de un circuito, en orden de registro (`seq`); vacío si no tiene. */
export async function loadPlantValues(circuitId: string): Promise<readonly PlantValueEvent[]> {
  const db = await open();
  try {
    const tx = db.transaction(PLANT_VALUES, "readonly");
    const store = tx.objectStore(PLANT_VALUES);
    const stored = await run(store, store.getAll(circuitRange(circuitId)) as IDBRequest<PlantValueEvent[]>);
    return [...stored].sort((a, b) => a.seq - b.seq);
  } finally {
    db.close();
  }
}
