/**
 * Expediente reducido de AGV y de tag (UX_SPEC §4.1, ROADMAP F2).
 *
 * "Reducido" es literal: recuentos frente a la cohorte, inactividad, última lectura conocida e
 * instante de cambio. **Sin tasa de salud** — eso exige oportunidades elegibles, que es F3 y
 * necesita las vueltas ya normalizadas y la memoria por vehículo, ninguna de las dos cerrada todavía.
 *
 * La comparación es siempre **contra la cohorte**, nunca contra la flota entera (R-AGV-001,
 * R-AGV-004): un vehículo de otro circuito no es un par válido.
 */

import type { Cohort } from "./cohort.js";
import type { CoLane } from "./circuit-config.js";
import type { Lap } from "./laps.js";
import type { Reading } from "./reading.js";
import type { TruthState } from "./truth.js";

export interface InactivityPeriod {
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly durationMs: number;
  /**
   * Los dos extremos del silencio: por dónde se fue y por dónde volvió (`UX_SPEC.md` §4.1).
   *
   * No es adorno. La forma de la reaparición es el quinto discriminante de ALG-019 y lo único que
   * separa una parada en carga de una avería: reaparecer en el mismo tag dice que estuvo ahí;
   * reaparecer más adelante dice que siguió circulando sin ser leído. El expediente muestra los dos
   * extremos y **no elige** entre esas lecturas: eso exige el contraste con la cohorte y la
   * configuración de calles que OQ-B04 todavía no ha dado.
   */
  readonly lastTagBefore: string;
  readonly firstTagAfter: string;
  /**
   * Qué explica el hueco.
   *
   * `carga-online` cuando la firma de R-CO-006 encaja: la última lectura es el tag de parada de una
   * calle configurada y la vuelta es la salida de **esa misma** calle. Es la diferencia entre media
   * hora que hay que explicar y media hora que pasa todos los días, y sin las calles cargadas no se
   * puede saber — así que sin ellas la causa es `silencio`, que es la degradación que la propia
   * regla exige: «no se sustituye por proximidad».
   */
  readonly cause: "silencio" | "carga-online";
  /** `observed` para la duración del hueco; `inferred` para lo que se afirma que pasó dentro. */
  readonly truth: TruthState;
  /** La calle, cuando la causa es una carga. */
  readonly laneId?: string;
}

export interface AgvDossier {
  readonly agvId: string;
  readonly cohortId: number | null;
  readonly cohortSize: number;
  readonly readingCount: number;
  /** Mediana de lecturas de los demás vehículos del cohorte, para poner el recuento en contexto. */
  readonly cohortMedianReadings: number;
  readonly laps: { readonly completas: number; readonly parciales: number; readonly desconocidas: number };
  readonly lastReading: { readonly tagId: string; readonly utcMs: number } | null;
  readonly inactivity: readonly InactivityPeriod[];
  /**
   * Si el vehículo lleva silencio hasta el final de la cobertura, el último instante con evidencia
   * (R-AGV-006: un AGV detenido no emite, así que esto no afirma cuándo dejó de funcionar, solo
   * hasta cuándo hay prueba).
   */
  readonly openSilenceSinceUtcMs: number | null;
}

/**
 * Construye el expediente de un vehículo.
 *
 * `minGapMs` decide qué separación entre lecturas cuenta como inactividad. **Sin valor por
 * defecto**: es el intervalo normal de lectura, configuración de planta (R-OPP-006), y quien llame
 * tiene que haberlo decidido.
 *
 * Agrupa `readings` por vehículo en cada llamada: correcto para una consulta aislada (como en las
 * pruebas), pero quien construya el expediente de **todos** los vehículos de un circuito debe usar
 * `buildAllAgvDossiers`, que agrupa una sola vez en vez de una vez por vehículo y por cada par de
 * su cohorte.
 */
export function buildAgvDossier(
  agvId: string,
  readings: readonly Reading[],
  cohorts: CohortLookup,
  laps: readonly Lap[],
  coverageEndUtcMs: number,
  minGapMs: number,
  lanes: readonly CoLane[],
): AgvDossier {
  return computeAgvDossier(
    agvId,
    groupByVehicle(readings),
    cohorts,
    laps,
    coverageEndUtcMs,
    minGapMs,
    laneSignatures(lanes),
  );
}

/**
 * El expediente de todos los vehículos de un circuito, en una sola pasada de agrupamiento.
 *
 * Hacerlo vehículo a vehículo con `buildAgvDossier` sería O(vehículos² · lecturas) —cada consulta
 * de la mediana de la cohorte volvería a filtrar el array entero por cada compañero—, inviable en
 * un circuito de decenas de vehículos y cientos de miles de lecturas.
 */
export function buildAllAgvDossiers(
  readings: readonly Reading[],
  cohorts: CohortLookup,
  laps: readonly Lap[],
  coverageEndUtcMs: number,
  minGapMs: number,
  lanes: readonly CoLane[],
): readonly AgvDossier[] {
  const grouped = groupByVehicle(readings);
  const signatures = laneSignatures(lanes);
  return [...grouped.keys()]
    .sort()
    .map((agvId) =>
      computeAgvDossier(agvId, grouped, cohorts, laps, coverageEndUtcMs, minGapMs, signatures),
    );
}

/**
 * La firma de R-CO-006, indexada para poder resolverla de un vistazo por cada hueco.
 *
 * La clave es el par (tag de parada, tag de salida) de **la misma** calle. Que tenga que ser la
 * misma no es detalle: salir por la calle 3 después de haber parado en la 1 no es una carga, es
 * algo que hay que mirar, y una clave por tag suelto lo habría dado por bueno.
 */
function laneSignatures(lanes: readonly CoLane[]): ReadonlyMap<string, string> {
  return new Map(lanes.map((lane) => [`${lane.stopTagId}\u0000${lane.exitTagId}`, lane.laneId]));
}

function groupByVehicle(readings: readonly Reading[]): ReadonlyMap<string, readonly Reading[]> {
  const groups = new Map<string, Reading[]>();
  for (const entry of readings) {
    let list = groups.get(entry.agvId);
    if (list === undefined) {
      list = [];
      groups.set(entry.agvId, list);
    }
    list.push(entry);
  }
  for (const list of groups.values()) list.sort((a, b) => a.time.utcMs - b.time.utcMs);
  return groups;
}

function computeAgvDossier(
  agvId: string,
  grouped: ReadonlyMap<string, readonly Reading[]>,
  cohorts: CohortLookup,
  laps: readonly Lap[],
  coverageEndUtcMs: number,
  minGapMs: number,
  laneSignature: ReadonlyMap<string, string>,
): AgvDossier {
  const own = grouped.get(agvId) ?? [];

  const cohortId = cohorts.cohortOf.get(agvId) ?? null;
  const cohort = cohortId === null ? null : cohorts.cohorts[cohortId];
  const peers = cohort?.vehicles.filter((id) => id !== agvId) ?? [];
  const peerCounts = peers.map((peerId) => grouped.get(peerId)?.length ?? 0);

  const ownLaps = laps.filter((lap) => lap.agvId === agvId);

  const inactivity: InactivityPeriod[] = [];
  for (let index = 1; index < own.length; index += 1) {
    const previous = own[index - 1] as Reading;
    const current = own[index] as Reading;
    const gap = current.time.utcMs - previous.time.utcMs;
    if (gap >= minGapMs) {
      const laneId = laneSignature.get(`${previous.tagId}\u0000${current.tagId}`);
      inactivity.push({
        fromUtcMs: previous.time.utcMs,
        toUtcMs: current.time.utcMs,
        durationMs: gap,
        lastTagBefore: previous.tagId,
        firstTagAfter: current.tagId,
        cause: laneId === undefined ? "silencio" : "carga-online",
        // El hueco en sí siempre es un hecho: las dos lecturas están ahí. Lo que cambia es si se
        // puede decir **qué pasó dentro**, y eso solo cuando la firma de la calle encaja.
        truth: laneId === undefined ? "observed" : "inferred",
        ...(laneId === undefined ? {} : { laneId }),
      });
    }
  }

  const last = own[own.length - 1] ?? null;
  const openSilence =
    last !== null && coverageEndUtcMs - last.time.utcMs >= minGapMs ? last.time.utcMs : null;

  return {
    agvId,
    cohortId,
    cohortSize: cohort?.vehicles.length ?? 0,
    readingCount: own.length,
    cohortMedianReadings: median(peerCounts),
    laps: {
      completas: ownLaps.filter((lap) => lap.completeness === "completa").length,
      parciales: ownLaps.filter((lap) => lap.completeness === "parcial").length,
      desconocidas: ownLaps.filter((lap) => lap.completeness === "desconocida").length,
    },
    lastReading: last === null ? null : { tagId: last.tagId, utcMs: last.time.utcMs },
    inactivity,
    openSilenceSinceUtcMs: openSilence,
  };
}

interface CohortLookup {
  readonly cohorts: readonly Cohort[];
  readonly cohortOf: ReadonlyMap<string, number>;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
    : (sorted[middle] as number);
}

// --- Expediente de tag --------------------------------------------------

export interface TagReaderStatus {
  readonly agvId: string;
  /** `null` si ese vehículo nunca ha leído este tag. */
  readonly lastReadUtcMs: number | null;
}

export interface TagDossier {
  readonly tagId: string;
  readonly readers: readonly TagReaderStatus[];
  readonly totalReadings: number;
  /** Función crítica declarada (R-GRA-007), o `null` si el tag no está en la lista `critico` ni en
   *  la columna `funcion` del circuito virtual. Dato de planta, nunca deducido. */
  readonly criticalFunction: string | null;
}

/**
 * Expediente de un tag: qué vehículos lo leen y desde cuándo dejaron de hacerlo los que sí lo
 * conocían. `vehicles` fija el universo a comprobar — normalmente el cohorte del tag, no la flota
 * entera, por la misma razón que el expediente de AGV compara contra su cohorte.
 *
 * Para **todos** los tags de un circuito, usar `buildAllTagDossiers`: recorre las lecturas una vez
 * en lugar de una vez por tag.
 */
export function buildTagDossier(
  tagId: string,
  readings: readonly Reading[],
  vehicles: readonly string[],
  funcionOf: ReadonlyMap<string, string>,
): TagDossier {
  const lastByVehicle = new Map<string, number>();
  let total = 0;
  for (const entry of readings) {
    if (entry.tagId !== tagId) continue;
    total += 1;
    const current = lastByVehicle.get(entry.agvId);
    if (current === undefined || entry.time.utcMs > current) lastByVehicle.set(entry.agvId, entry.time.utcMs);
  }

  return {
    tagId,
    readers: readerStatuses(lastByVehicle, vehicles),
    totalReadings: total,
    criticalFunction: funcionOf.get(tagId) ?? null,
  };
}

/** El expediente de todos los tags, en una sola pasada sobre las lecturas. */
export function buildAllTagDossiers(
  readings: readonly Reading[],
  vehicles: readonly string[],
  funcionOf: ReadonlyMap<string, string>,
): readonly TagDossier[] {
  const lastByTagAndVehicle = new Map<string, Map<string, number>>();
  const totalByTag = new Map<string, number>();
  for (const entry of readings) {
    totalByTag.set(entry.tagId, (totalByTag.get(entry.tagId) ?? 0) + 1);
    let byVehicle = lastByTagAndVehicle.get(entry.tagId);
    if (byVehicle === undefined) {
      byVehicle = new Map<string, number>();
      lastByTagAndVehicle.set(entry.tagId, byVehicle);
    }
    const current = byVehicle.get(entry.agvId);
    if (current === undefined || entry.time.utcMs > current) byVehicle.set(entry.agvId, entry.time.utcMs);
  }

  return [...totalByTag.keys()].sort().map((tagId) => ({
    tagId,
    readers: readerStatuses(lastByTagAndVehicle.get(tagId) ?? new Map(), vehicles),
    totalReadings: totalByTag.get(tagId) ?? 0,
    criticalFunction: funcionOf.get(tagId) ?? null,
  }));
}

function readerStatuses(
  lastByVehicle: ReadonlyMap<string, number>,
  vehicles: readonly string[],
): readonly TagReaderStatus[] {
  return vehicles
    .map((agvId) => ({ agvId, lastReadUtcMs: lastByVehicle.get(agvId) ?? null }))
    .sort((a, b) => a.agvId.localeCompare(b.agvId));
}

/** Estado de verdad de un expediente: siempre `observed` en lo que cuenta, `inferred` en las vueltas. */
export function dossierTruth(hasLaps: boolean): TruthState {
  return hasLaps ? "inferred" : "observed";
}
