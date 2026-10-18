/**
 * El esquema del almacén local: su versión, sus tablas y la escalera de migraciones que lleva una base
 * de cualquier versión anterior a la vigente. Separado de `store.ts` (revisión 2026-10-18) para que las
 * operaciones de lectura y escritura no compartan fichero con la historia del esquema; qué cambió en
 * cada versión está explicado en la cabecera de `store.ts`.
 */

import type { StoredSourceReadings } from "./store.js";
import { splitLegacyCircuit, type LegacyCircuitRecord } from "./retention.js";

/** Subirla sin añadir su paso en `MIGRATIONS` es un error, y el propio módulo lo comprueba. */
export const STORE_VERSION = 12;

export const DATABASE = "tag-trace";
export const CIRCUITS = "circuits";
/**
 * La revisión en campo, en su propia tabla y no dentro del circuito. No es orden: el Worker
 * reescribe el circuito entero en cada importación, y una marca guardada desde la interfaz mientras
 * tanto se perdería. Aquí solo escribe la interfaz, y cada marca es su propia transacción.
 */
export const REVIEWS = "reviews";
/** Las lecturas de cada fuente retenida, un registro por fuente: clave `[circuitId, sourceId]`. */
export const SOURCES = "sources";
/** Una instantánea por fuente (ADR-0015): clave `[circuitId, sourceId]`. */
export const SNAPSHOTS = "snapshots";
/** Las versiones consolidadas, append-only (F4): clave `[circuitId, hash]`. */
export const MEMORY = "memory";
/** El estado de linaje de cada circuito (§10): clave `circuitId`. */
export const MEMORY_STATE = "memoryState";
/** Los eventos del plano físico (ADR-0016), append-only: clave `[circuitId, seq]`. */
export const PLAN = "plan";
/**
 * El archivo de ficheros originales, comprimidos, uno por huella (OQ-145): clave
 * `[circuitId, sourceHash]`. Es la evidencia para revisar o volver a medir el pasado con reglas
 * nuevas; no viaja en el `.agvproj` (ADR-0012: el bruto no sale del dispositivo por defecto).
 */
export const ARCHIVE = "archive";
/** Los valores de planta confirmados (OQ-140), append-only: clave `[circuitId, seq]`. */
export const PLANT_VALUES = "plantValues";
/** Las revisiones de los expedientes (ADR-0018), append-only: clave `[circuitId, caseId, revision]`. */
export const INCIDENT_CASES = "incidentCases";
/** Los recortes congelados de los expedientes, comprimidos: clave `[circuitId, hash]`. */
export const INCIDENT_EVIDENCE = "incidentEvidence";

/**
 * La escalera de migraciones, un peldaño por versión.
 *
 * Cada paso recibe la base a medio abrir —y la transacción de actualización, que permite leer y
 * escribir— y deja el esquema en su versión destino. No se salta ninguno: abrir una base vieja
 * recorre los peldaños que le falten, en orden.
 */
export const MIGRATIONS: readonly { readonly to: number; readonly apply: (db: IDBDatabase, tx: IDBTransaction) => void }[] = [
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
  {
    to: 11,
    // El registro de conexiones del terminal entra en el circuito (DS-013, ADR-0017). Campo
    // opcional: un circuito anterior se abre sin registro y el mapa de estado de conexión dice que
    // no hay registro cargado, que es la verdad.
    apply: () => {},
  },
  {
    to: 12,
    // Los expedientes de incidencia (F5, ADR-0018): dos tablas nuevas y vacías. Nada que reescribir:
    // un expediente nace de una acción humana, y ningún circuito anterior lo tiene.
    apply: (db) => {
      db.createObjectStore(INCIDENT_CASES, { keyPath: ["circuitId", "caseId", "revision"] });
      db.createObjectStore(INCIDENT_EVIDENCE, { keyPath: ["circuitId", "hash"] });
    },
  },
];

if (MIGRATIONS[MIGRATIONS.length - 1]?.to !== STORE_VERSION) {
  throw new Error("STORE_VERSION cambió sin añadir su migración: el almacén no se abre así.");
}
