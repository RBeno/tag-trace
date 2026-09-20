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
 */

import type { Interval } from "../domain/coverage.js";
import type { Reading } from "../domain/reading.js";

/** Subirla sin añadir su paso en `MIGRATIONS` es un error, y el propio módulo lo comprueba. */
export const STORE_VERSION = 2;

const DATABASE = "tag-trace";
const CIRCUITS = "circuits";

export interface StoredSource {
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  readonly importedAt: number;
  readonly acceptedRows: number;
  /** Tramo analizable de esta fuente; la cola cortada queda fuera (R-DAT-007). */
  readonly complete: Interval | null;
}

/**
 * Una lista de tags declarada por planta, tal como se cargó (`CONFIG_SCHEMA.md` §3.8).
 *
 * Se guarda **con el circuito** y no aparte porque es parte de su estado en el momento del
 * análisis: repetir un análisis de hace tres meses tiene que usar las listas de hace tres meses, no
 * las de hoy. Si el técnico aplica los cambios propuestos y vuelve a cargarlas, el análisis
 * siguiente las recoge ya actualizadas, y el anterior sigue explicándose con las suyas.
 */
export interface StoredTagList {
  readonly list: string;
  readonly tags: readonly string[];
  /** Cuándo se extrajo de planta. Sin esto no se sabe qué periodo puede juzgar (OQ-123). */
  readonly extractedAt: number | null;
  readonly loadedAt: number;
  readonly fileName: string;
}

export interface StoredCircuit {
  readonly circuitId: string;
  readonly name: string;
  readonly zone: string;
  readonly sources: readonly StoredSource[];
  readonly coverage: readonly Interval[];
  readonly readings: readonly Reading[];
  /** Listas de planta vigentes. Ausente en circuitos guardados antes de la versión 2. */
  readonly lists?: readonly StoredTagList[];
  readonly updatedAt: number;
}

/**
 * La escalera de migraciones, un peldaño por versión.
 *
 * Cada paso recibe la base a medio abrir y deja el esquema en su versión destino. No se salta
 * ninguno: abrir una base vieja recorre los peldaños que le falten, en orden.
 */
const MIGRATIONS: readonly { readonly to: number; readonly apply: (db: IDBDatabase) => void }[] = [
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
];

if (MIGRATIONS[MIGRATIONS.length - 1]?.to !== STORE_VERSION) {
  throw new Error("STORE_VERSION cambió sin añadir su migración: el almacén no se abre así.");
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, STORE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const from = event.oldVersion;
      for (const step of MIGRATIONS) {
        if (step.to > from) step.apply(db);
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

/** ¿Hay almacén? En un contexto sin IndexedDB —o con datos de sitio bloqueados— no lo hay. */
export function isAvailable(): boolean {
  return typeof indexedDB !== "undefined";
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
 * Guarda un circuito entero en una transacción.
 *
 * O queda el estado nuevo o queda el anterior: nunca una mezcla. Es lo que hace que cancelar a
 * mitad no deje un proyecto a medias con aspecto de estar bien (INV-006).
 */
export async function saveCircuit(circuit: StoredCircuit): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CIRCUITS, "readwrite");
      tx.objectStore(CIRCUITS).put(circuit);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("No se pudo guardar el circuito."));
      tx.onabort = () => reject(tx.error ?? new Error("La escritura se abortó."));
    });
  } finally {
    db.close();
  }
}

export async function deleteCircuit(circuitId: string): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CIRCUITS, "readwrite");
      tx.objectStore(CIRCUITS).delete(circuitId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("No se pudo borrar el circuito."));
    });
  } finally {
    db.close();
  }
}
