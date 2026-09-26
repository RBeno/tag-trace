/**
 * La instantánea del circuito (ADR-0015): un grafo con fecha, lo que perdura de cada exportación.
 *
 * El propietario (2026-09-26): «guardar el estado del circuito como grafo con sus tags, posiciones
 * relativas, función y las últimas tendencias de tiempo; los vértices con la tasa de lectura si está
 * por debajo del 100 % y cualquier dato de interés; un grafo que va moviéndose, ampliando o
 * reduciendo sus vértices y aumentando o reduciendo sus caminos». Las lecturas en crudo solo viven en
 * la ventana de trabajo; la secuencia de instantáneas es la evolución.
 *
 * Este fichero fija el **contrato**: los tipos de abajo son los que el almacén guarda (`snapshots`,
 * versión 6), los que el `.agvproj` transporta (ADR-0012) y los que la vista de evolución dibuja.
 * Cambiar un campo es cambiar `SNAPSHOT_SCHEMA_VERSION` y escribir su migración. Los campos se
 * añaden; no se renombran.
 *
 * Qué **no** guarda, a propósito (`MEMORY_CONSOLIDATION.md` §4): lecturas, matriz completa, replay,
 * expedientes, estados por instante. Todo eso se reconstruye cargando el fichero otra vez.
 */

import {
  sumVerdict,
  type AnchorGapChange,
  type GapSide,
  type StructureChange,
  type StructureSet,
  type SumVerdict,
  type UnconfirmedAbsence,
} from "./anchor-sums.js";
import type { Interval } from "./coverage.js";
import {
  absenceTest,
  sharedNeighborMatch,
  type DriftComparison,
  type DriftThresholds,
  type NeighborSignature,
  type TagDrift,
  type VehicleDrift,
} from "./drift.js";
import { segmentHistories, type FranjaThresholds, type SegmentHistory } from "./franjas.js";
import type { TagClass } from "./inventory.js";
import { bandShift, pairKey, REGIMES, type Band, type Regime } from "./segment-bands.js";
import type { ReviewState } from "./review.js";
import type { TagChangeThresholds } from "./tag-changes.js";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/** Un tag del anillo o fuera de él, tal como quedó en este fichero. */
export interface SnapshotVertex {
  readonly tagId: string;
  /** Posición en el anillo (0…n−1) o `null` si se lee fuera del anillo o no se lee. */
  readonly position: number | null;
  /** Segundos de recorrido desde el ancla, en ms; `null` si no se pudo situar (R-TIM-011). */
  readonly offsetMs: number | null;
  /** Tramo declarado (kitting, línea, cruce…) o `null`. */
  readonly section: string | null;
  /** Función crítica declarada o candidata; `null` si ninguna. */
  readonly funcion: string | null;
  readonly declared: boolean;
  /** Tasa de lectura sobre las pasadas probadas (R-OPP-013); `null` sin pasadas. */
  readonly readRate: number | null;
  readonly passes: number;
  readonly readings: number;
  /** AGV que pasaron por su sitio y no lo leyeron nunca en este fichero. */
  readonly nonReaders: readonly string[];
  /** Vecinos dominantes en la secuencia de los AGV (R-DAT-019), para situar el tag sin el anillo. */
  readonly predecessor: string | null;
  readonly successor: string | null;
  readonly inventoryClass: TagClass | null;
  /** Dónde está: en el anillo, en una calle (con su identificador), en la línea, o fuera. */
  readonly situation: "anillo" | "calle" | "linea" | "fuera" | "sin-lecturas";
  readonly laneId: string | null;
  readonly isAnchor: boolean;
}

/** Un tramo del anillo con su horquilla por régimen en este fichero (R-FLO-007, R-TIM-011). */
export interface SnapshotEdge {
  readonly from: string;
  readonly to: string;
  readonly produccion: Band | null;
  readonly noche: Band | null;
}

/** Una sección entre anclas (R-TIM-012). */
export interface SnapshotSection {
  readonly fromTagId: string;
  readonly toTagId: string;
  readonly name: string;
  readonly namedByList: boolean;
  readonly tags: readonly string[];
  readonly produccion: Band | null;
  readonly noche: Band | null;
}

/** La suma entre dos anclas seguidas (R-DAT-021), para comparar la estructura entre ficheros. */
export interface SnapshotAnchorGap {
  readonly fromAnchor: string;
  readonly toAnchor: string;
  /** Tags del anillo entre las dos anclas, en orden. */
  readonly tags: readonly string[];
  /**
   * La suma por régimen. `p80Ms` es opcional (añadido en la versión 1 sin renombrar nada): sin él la
   * regla de la horquilla (R-TIM-010) no se puede aplicar y la suma queda `sin-medir` entre ficheros.
   */
  readonly produccion: { readonly samples: number; readonly p50Ms: number; readonly p80Ms?: number } | null;
  readonly noche: { readonly samples: number; readonly p50Ms: number; readonly p80Ms?: number } | null;
  /** Pasadas por el hueco y, por tag, en cuántas se leyó y por cuántos AGV distintos. */
  readonly passes: number;
  /**
   * Por tag: en cuántas pasadas se leyó, por cuántos AGV distintos y, si se midió, la mediana de su
   * desfase desde `fromAnchor` en ms (opcional; sin él se estima con `offsetMs` de los vértices).
   */
  readonly readsByTag: Readonly<Record<string, { readonly passes: number; readonly vehicles: number; readonly offsetMs?: number }>>;
  /**
   * Los AGV distintos que hicieron las pasadas del hueco (opcional). Una ausencia la sostienen al
   * menos dos AGV (R-DAT-021): sin esta lista se toma como cota inferior el mayor `vehicles` de
   * `readsByTag`, y una ausencia que solo sostiene uno queda sin afirmar y sin nombrar al AGV.
   */
  readonly vehicleIds?: readonly string[];
}

export interface SnapshotFinding {
  /** La clave de revisión (R-EVI-007): tipo y sujeto. */
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly figure: string;
  readonly review: ReviewState | null;
}

export interface SnapshotFleet {
  /** «N de M» al final del fichero, y la mediana de la ventana. */
  readonly assigned: number;
  readonly inCircuitAtEnd: number;
  readonly inCircuitMedian: number;
  readonly historySource: "historial" | "lecturas" | "historial-vacio";
  readonly vehicles: readonly string[];
}

export interface SnapshotLine {
  readonly entryTagId: string;
  readonly passes: number;
  readonly cadence: Band | null;
  readonly stops: number;
  readonly stopsWithoutAgv: number;
  readonly aboveFenceMs: number;
  readonly cycleMs: number | null;
}

export interface SnapshotLane {
  readonly laneId: string;
  readonly served: boolean;
  readonly stays: number;
  readonly share: number | null;
  readonly usageVerdict: "menos" | "mas" | null;
  readonly medianStayMs: number | null;
}

export interface CircuitSnapshot {
  readonly schemaVersion: number;
  readonly circuitId: string;
  readonly zone: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  /** Tramo analizable del fichero (R-DAT-007). */
  readonly window: Interval;
  readonly capturedAt: number;
  /** Versión de la aplicación y del catálogo de algoritmos con que se calculó. */
  readonly appVersion: string;
  readonly acceptedRows: number;
  /** Exposición por régimen dentro de la ventana, en ms. */
  readonly exposure: Readonly<Record<Regime, number>>;
  readonly cohortId: number;
  readonly anchorTagId: string | null;
  readonly anchorDeclared: boolean;
  /** El anillo en orden, empezando por el ancla. */
  readonly ring: readonly string[];
  readonly lapMs: number | null;
  readonly vertices: readonly SnapshotVertex[];
  readonly edges: readonly SnapshotEdge[];
  readonly sections: readonly SnapshotSection[];
  readonly anchorGaps: readonly SnapshotAnchorGap[];
  readonly fleet: SnapshotFleet | null;
  readonly line: SnapshotLine | null;
  readonly lanes: readonly SnapshotLane[];
  readonly findings: readonly SnapshotFinding[];
}

/**
 * Lo que el Worker entrega para construir la instantánea. Son resultados que ya calcula; la función
 * `buildSnapshot` los reduce al contrato de arriba y no vuelve a medir nada.
 */
export interface SnapshotInput {
  readonly circuitId: string;
  readonly zone: string;
  readonly source: {
    readonly sourceId: string;
    readonly sourceHash: string;
    readonly fileName: string;
    readonly window: Interval;
    readonly acceptedRows: number;
  };
  readonly capturedAt: number;
  readonly appVersion: string;
  readonly exposure: Readonly<Record<Regime, number>>;
  readonly cohortId: number;
  readonly anchorTagId: string | null;
  readonly anchorDeclared: boolean;
  readonly ring: readonly string[];
  readonly lapMs: number | null;
  readonly vertices: readonly SnapshotVertex[];
  readonly edges: readonly SnapshotEdge[];
  readonly sections: readonly SnapshotSection[];
  readonly anchorGaps: readonly SnapshotAnchorGap[];
  readonly fleet: SnapshotFleet | null;
  readonly line: SnapshotLine | null;
  readonly lanes: readonly SnapshotLane[];
  readonly findings: readonly SnapshotFinding[];
}

function invalid(reason: string): never {
  throw new TypeError(`buildSnapshot: ${reason}`);
}

function requireId(value: string, what: string): void {
  if (typeof value !== "string" || value.trim() === "") invalid(`${what} vacío`);
}

/** El orden de un tag en el anillo; los que no están en él van detrás, por identificador. */
function ringOrder(positionOf: ReadonlyMap<string, number>): (a: string, b: string) => number {
  const at = (tagId: string): number => positionOf.get(tagId) ?? Number.POSITIVE_INFINITY;
  return (a, b) => at(a) - at(b) || a.localeCompare(b);
}

function sortedRecord<T>(record: Readonly<Record<string, T>>): Readonly<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key] as T;
  return out;
}

/**
 * Construye la instantánea: valida, ordena de forma canónica y sella la versión del esquema. No mide
 * nada: el Worker ya calculó. Un input inválido lanza `TypeError` con el motivo, porque una
 * instantánea incoherente guardada se compararía durante meses sin que nadie lo notara.
 *
 * Orden canónico, para que dos instantáneas iguales sean bit a bit iguales (ADR-0013): vértices por
 * posición en el anillo y luego por id; aristas, secciones y huecos entre anclas en orden del anillo;
 * hallazgos por clave; `nonReaders`, `vehicles` y las claves de `readsByTag` ordenados.
 */
export function buildSnapshot(input: SnapshotInput): CircuitSnapshot {
  requireId(input.circuitId, "circuitId");
  requireId(input.source.sourceId, "sourceId");
  requireId(input.source.sourceHash, "sourceHash");
  requireId(input.source.fileName, "fileName");
  const { window } = input.source;
  if (!Number.isFinite(window.from) || !Number.isFinite(window.to) || !(window.from < window.to)) {
    invalid(`ventana inválida: from (${window.from}) tiene que ser anterior a to (${window.to})`);
  }

  const ring = input.ring;
  const positionOf = new Map<string, number>();
  ring.forEach((tagId, index) => {
    requireId(tagId, `tag del anillo en la posición ${index}`);
    if (positionOf.has(tagId)) invalid(`el anillo repite el tag ${tagId}`);
    positionOf.set(tagId, index);
  });

  const seenVertices = new Set<string>();
  for (const vertex of input.vertices) {
    requireId(vertex.tagId, "tagId de un vértice");
    if (seenVertices.has(vertex.tagId)) invalid(`vértice repetido: ${vertex.tagId}`);
    seenVertices.add(vertex.tagId);
    const expected = positionOf.get(vertex.tagId);
    if (vertex.position !== null) {
      if (!Number.isInteger(vertex.position) || vertex.position !== expected) {
        invalid(`el vértice ${vertex.tagId} declara la posición ${vertex.position} y el anillo ${expected === undefined ? "no lo tiene" : `lo tiene en la ${expected}`}`);
      }
    } else if (expected !== undefined) {
      invalid(`el vértice ${vertex.tagId} está en el anillo (posición ${expected}) y no declara posición`);
    }
    for (const agvId of vertex.nonReaders) requireId(agvId, `AGV en nonReaders de ${vertex.tagId}`);
  }

  const edgeKeys = new Set<string>();
  for (const edge of input.edges) {
    const from = positionOf.get(edge.from);
    const to = positionOf.get(edge.to);
    if (from === undefined || to === undefined || (from + 1) % ring.length !== to) {
      invalid(`la arista ${edge.from} → ${edge.to} no une dos tags consecutivos del anillo`);
    }
    const key = pairKey(edge.from, edge.to);
    if (edgeKeys.has(key)) invalid(`arista repetida: ${edge.from} → ${edge.to}`);
    edgeKeys.add(key);
  }

  const byRing = ringOrder(positionOf);
  const vertices = [...input.vertices]
    .map((vertex) => ({ ...vertex, nonReaders: [...vertex.nonReaders].sort() }))
    .sort((a, b) => byRing(a.tagId, b.tagId));
  const edges = [...input.edges].sort((a, b) => byRing(a.from, b.from));
  const sections = [...input.sections].sort((a, b) => byRing(a.fromTagId, b.fromTagId) || a.name.localeCompare(b.name));
  const anchorGaps = [...input.anchorGaps]
    .map((gap) => ({
      ...gap,
      readsByTag: sortedRecord(gap.readsByTag),
      ...(gap.vehicleIds === undefined ? {} : { vehicleIds: [...gap.vehicleIds].sort() }),
    }))
    .sort((a, b) => byRing(a.fromAnchor, b.fromAnchor) || byRing(a.toAnchor, b.toAnchor));
  const lanes = [...input.lanes].sort((a, b) => a.laneId.localeCompare(b.laneId));
  const findings = [...input.findings].sort((a, b) => a.key.localeCompare(b.key) || a.kind.localeCompare(b.kind));
  const fleet = input.fleet === null ? null : { ...input.fleet, vehicles: [...input.fleet.vehicles].sort() };

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    circuitId: input.circuitId,
    zone: input.zone,
    sourceId: input.source.sourceId,
    sourceHash: input.source.sourceHash,
    fileName: input.source.fileName,
    window: { from: window.from, to: window.to },
    capturedAt: input.capturedAt,
    appVersion: input.appVersion,
    acceptedRows: input.source.acceptedRows,
    exposure: { produccion: input.exposure.produccion, noche: input.exposure.noche },
    cohortId: input.cohortId,
    anchorTagId: input.anchorTagId,
    anchorDeclared: input.anchorDeclared,
    ring: [...ring],
    lapMs: input.lapMs,
    vertices,
    edges,
    sections,
    anchorGaps,
    fleet,
    line: input.line,
    lanes,
    findings,
  };
}

/** Un vértice que aparece, desaparece, se mueve o cambia de clase entre dos instantáneas. */
export interface VertexDelta {
  readonly tagId: string;
  readonly kind: "aparece" | "desaparece" | "se-mueve" | "cambia-de-clase" | "deja-de-leerse" | "empieza-a-leerse";
  readonly before: SnapshotVertex | null;
  readonly after: SnapshotVertex | null;
  readonly detail: string;
}

/** Una arista más lenta o más rápida entre dos instantáneas, con el criterio de R-TIM-010. */
export interface EdgeDelta {
  readonly from: string;
  readonly to: string;
  readonly regime: Regime;
  readonly direction: "mas-lento" | "mas-rapido";
  readonly before: Band;
  readonly after: Band;
}

export interface SnapshotDelta {
  readonly fromSourceId: string;
  readonly toSourceId: string;
  readonly vertices: readonly VertexDelta[];
  readonly edges: readonly EdgeDelta[];
  readonly lapShift: { readonly beforeMs: number; readonly afterMs: number } | null;
}

/** Los vecinos de cada tag en un anillo (cíclico): predecesor y sucesor. */
function ringNeighbors(ring: readonly string[]): ReadonlyMap<string, { readonly predecessor: string; readonly successor: string }> {
  const out = new Map<string, { predecessor: string; successor: string }>();
  const size = ring.length;
  ring.forEach((tagId, index) => {
    out.set(tagId, { predecessor: ring[(index - 1 + size) % size] as string, successor: ring[(index + 1) % size] as string });
  });
  return out;
}

const percent = (rate: number): string => `${Math.round(rate * 100)} %`;

/**
 * Qué cambió del grafo de una instantánea a la siguiente. Hechos, nunca causas (R-EVI-006): cada
 * delta dice qué se ve distinto y en qué fichero, no por qué.
 *
 * - **aparece** / **desaparece**: el tag está en el anillo de una y no en el de la otra.
 * - **se-mueve**: está en los dos anillos y, en el anillo restringido a los tags comunes, cambian
 *   **su predecesor y su sucesor**. Se comparan vecinos, no posiciones: insertar un tag desplaza el
 *   índice de todos los demás. Y se restringe a los comunes porque un tag insertado o retirado cambia
 *   un vecino de los dos tags que lo rodean sin que esos se hayan movido: al que solo le cambia un
 *   vecino no se ha movido él, se ha movido su vecino.
 * - **cambia-de-clase**: otra clase de inventario.
 * - **deja-de-leerse** / **empieza-a-leerse**: para un tag que sigue en el mismo sitio (en los dos
 *   anillos o en ninguno), con lecturas en una y ninguna en la otra habiendo pasadas. Con
 *   `thresholds.maxChance` se exige además que la ausencia sea improbable por azar con la tasa del
 *   periodo en que se leía y las pasadas del otro (`(1 − tasa)^pasadas ≤ maxChance`); sin él basta
 *   con que hubiera al menos una pasada.
 * - **aristas**: la regla de la horquilla de R-TIM-010 (`bandShift`), por régimen.
 * - **vuelta**: se enseña siempre que las dos estén medidas y sean distintas; la horquilla de la vuelta
 *   no se guarda, así que aquí no se aplica R-TIM-010 y quien mira decide.
 */
export function compareSnapshots(
  before: CircuitSnapshot,
  after: CircuitSnapshot,
  thresholds?: Pick<TagChangeThresholds, "maxChance">,
): SnapshotDelta {
  const verticesBefore = new Map(before.vertices.map((vertex) => [vertex.tagId, vertex]));
  const verticesAfter = new Map(after.vertices.map((vertex) => [vertex.tagId, vertex]));
  const inBefore = new Set(before.ring);
  const inAfter = new Set(after.ring);
  const neighborsBefore = ringNeighbors(before.ring);
  const neighborsAfter = ringNeighbors(after.ring);
  const commonBefore = ringNeighbors(before.ring.filter((tagId) => inAfter.has(tagId)));
  const commonAfter = ringNeighbors(after.ring.filter((tagId) => inBefore.has(tagId)));
  const commonCount = commonBefore.size;

  const deltas: VertexDelta[] = [];
  const tagIds = [...new Set([...before.ring, ...after.ring, ...verticesBefore.keys(), ...verticesAfter.keys()])].sort();
  for (const tagId of tagIds) {
    const a = verticesBefore.get(tagId) ?? null;
    const b = verticesAfter.get(tagId) ?? null;
    const wasInRing = inBefore.has(tagId);
    const isInRing = inAfter.has(tagId);
    if (isInRing && !wasInRing) {
      const at = neighborsAfter.get(tagId) as { predecessor: string; successor: string };
      deltas.push({
        tagId,
        kind: "aparece",
        before: a,
        after: b,
        detail: `${tagId} está en el anillo de ${after.fileName}, entre ${at.predecessor} y ${at.successor}, y no estaba en el de ${before.fileName}.`,
      });
    } else if (wasInRing && !isInRing) {
      const at = neighborsBefore.get(tagId) as { predecessor: string; successor: string };
      deltas.push({
        tagId,
        kind: "desaparece",
        before: a,
        after: b,
        detail: `${tagId} estaba en el anillo de ${before.fileName}, entre ${at.predecessor} y ${at.successor}, y no está en el de ${after.fileName}.`,
      });
    } else if (wasInRing && isInRing && commonCount >= 3) {
      const old = commonBefore.get(tagId) as { predecessor: string; successor: string };
      const now = commonAfter.get(tagId) as { predecessor: string; successor: string };
      if (old.predecessor !== now.predecessor && old.successor !== now.successor) {
        deltas.push({
          tagId,
          kind: "se-mueve",
          before: a,
          after: b,
          detail: `${tagId} iba entre ${old.predecessor} y ${old.successor} en ${before.fileName} y va entre ${now.predecessor} y ${now.successor} en ${after.fileName}.`,
        });
      }
    }

    if (a === null || b === null) continue;
    if (a.inventoryClass !== b.inventoryClass) {
      deltas.push({
        tagId,
        kind: "cambia-de-clase",
        before: a,
        after: b,
        detail: `${tagId} era «${a.inventoryClass ?? "sin clase"}» en ${before.fileName} y es «${b.inventoryClass ?? "sin clase"}» en ${after.fileName}.`,
      });
    }
    if (wasInRing !== isInRing) continue;
    const readingChange = readingShift(a, b, thresholds?.maxChance);
    if (readingChange === "deja-de-leerse") {
      deltas.push({
        tagId,
        kind: "deja-de-leerse",
        before: a,
        after: b,
        detail: `${tagId} se leía en ${a.readings} de ${a.passes} pasadas (${percent(a.readRate ?? 0)}) en ${before.fileName} y en ninguna de ${b.passes} en ${after.fileName}.`,
      });
    } else if (readingChange === "empieza-a-leerse") {
      deltas.push({
        tagId,
        kind: "empieza-a-leerse",
        before: a,
        after: b,
        detail: `${tagId} no se leyó en ninguna de ${a.passes} pasadas en ${before.fileName} y se lee en ${b.readings} de ${b.passes} (${percent(b.readRate ?? 0)}) en ${after.fileName}.`,
      });
    }
  }

  const edgesBefore = new Map(before.edges.map((edge) => [pairKey(edge.from, edge.to), edge]));
  const edgeDeltas: EdgeDelta[] = [];
  for (const edge of after.edges) {
    const previous = edgesBefore.get(pairKey(edge.from, edge.to));
    if (previous === undefined) continue;
    for (const regime of REGIMES) {
      const x = previous[regime];
      const y = edge[regime];
      if (x === null || y === null) continue;
      const direction = bandShift(x, y);
      if (direction !== null) edgeDeltas.push({ from: edge.from, to: edge.to, regime, direction, before: x, after: y });
    }
  }

  const lapShift =
    before.lapMs !== null && after.lapMs !== null && before.lapMs !== after.lapMs ? { beforeMs: before.lapMs, afterMs: after.lapMs } : null;
  return { fromSourceId: before.sourceId, toSourceId: after.sourceId, vertices: deltas, edges: edgeDeltas, lapShift };
}

/** Sin lecturas en un lado habiendo pasadas, y con lecturas en el otro; con `maxChance`, además improbable por azar. */
function readingShift(a: SnapshotVertex, b: SnapshotVertex, maxChance: number | undefined): "deja-de-leerse" | "empieza-a-leerse" | null {
  const silent = (vertex: SnapshotVertex): boolean => vertex.passes > 0 && (vertex.readings === 0 || vertex.readRate === 0 || vertex.situation === "sin-lecturas");
  const unlikely = (read: SnapshotVertex, other: SnapshotVertex): boolean => {
    if (maxChance === undefined) return true;
    const rate = read.readRate ?? (read.passes > 0 ? Math.min(1, read.readings / read.passes) : 0);
    return (1 - Math.min(1, rate)) ** other.passes <= maxChance;
  };
  if (a.readings > 0 && silent(b) && unlikely(a, b)) return "deja-de-leerse";
  if (b.readings > 0 && silent(a) && unlikely(b, a)) return "empieza-a-leerse";
  return null;
}

// --- Comparaciones entre ficheros, desde las instantáneas (ADR-0015 §3) ---------------------------

/** Las instantáneas en orden de ventana (inicio, fin, fichero), como `franjaWindows`. */
export function sortSnapshots(snapshots: readonly CircuitSnapshot[]): readonly CircuitSnapshot[] {
  return [...snapshots].sort((a, b) => a.window.from - b.window.from || a.window.to - b.window.to || a.sourceId.localeCompare(b.sourceId));
}

/**
 * Qué tramos cambian a lo largo de los ficheros (R-TIM-010, R-TIM-011), leído de las instantáneas en
 * orden de ventana. Mismo criterio y mismo resultado que `segmentHistories` de `franjas.ts`: las
 * aristas de cada instantánea son las horquillas de esa franja, y se clasifican con la misma función
 * (`classifyHistory`) a través de `segmentHistories`. Una instantánea con la misma huella que otra
 * (`sourceHash`) es el mismo fichero cargado dos veces y se cuenta una sola vez, como en
 * `franjaWindows`. `thresholds` no interviene: los mínimos de muestras ya los aplicó el Worker al
 * medir cada fichero; se conserva en la firma porque es el contrato.
 */
export function historiesFromSnapshots(
  snapshots: readonly CircuitSnapshot[],
  _thresholds: FranjaThresholds,
): readonly SegmentHistory[] {
  const seenHashes = new Set<string>();
  const franjas = sortSnapshots(snapshots)
    .filter((snapshot) => {
      if (seenHashes.has(snapshot.sourceHash)) return false;
      seenHashes.add(snapshot.sourceHash);
      return true;
    })
    .map((snapshot) => ({ sourceId: snapshot.sourceId, bands: snapshot.edges }));
  return segmentHistories(franjas);
}

/** La tasa de un tag en el hueco: pasadas en que se leyó sobre las pasadas del hueco. */
function gapRate(gap: SnapshotAnchorGap, tagId: string): number {
  if (gap.passes <= 0) return 0;
  return Math.min(1, (gap.readsByTag[tagId]?.passes ?? 0) / gap.passes);
}

/** Cuántos AGV distintos pasaron por el hueco: la lista si está; si no, la cota inferior de `readsByTag`. */
function gapVehicles(gap: SnapshotAnchorGap): number {
  if (gap.vehicleIds !== undefined) return new Set(gap.vehicleIds).size;
  let most = 0;
  for (const entry of Object.values(gap.readsByTag)) if (entry.vehicles > most) most = entry.vehicles;
  return most;
}

/** El desfase de un tag desde `fromAnchor`: el del hueco si se guardó; si no, la diferencia de posiciones en tiempo. */
function gapOffset(gap: SnapshotAnchorGap, tagId: string, offsets: ReadonlyMap<string, number | null>): number {
  const stored = gap.readsByTag[tagId]?.offsetMs;
  if (stored !== undefined) return stored;
  const anchor = offsets.get(gap.fromAnchor) ?? null;
  const own = offsets.get(tagId) ?? null;
  return anchor === null || own === null ? Number.NaN : own - anchor;
}

/** El vecino estable de cada tag de un hueco, a cada lado: el ancla o el tag común más cercano. */
function stableSlots(tags: readonly string[], stable: ReadonlySet<string>, fromAnchor: string, toAnchor: string): ReadonlyMap<string, string> {
  const slotOf = new Map<string, string>();
  tags.forEach((tagId, index) => {
    if (stable.has(tagId)) return;
    let left = fromAnchor;
    for (let i = index - 1; i >= 0; i -= 1) if (stable.has(tags[i] as string)) { left = tags[i] as string; break; }
    let right = toAnchor;
    for (let i = index + 1; i < tags.length; i += 1) if (stable.has(tags[i] as string)) { right = tags[i] as string; break; }
    slotOf.set(tagId, pairKey(left, right));
  });
  return slotOf;
}

/**
 * Tags insertados, retirados o sustituidos entre dos ficheros seguidos por la suma entre anclas
 * (R-DAT-021), leído de `anchorGaps`. `null` si no comparten anclas: ningún hueco con el mismo par.
 *
 * Por cada hueco presente en los dos:
 *
 * - **retirado**: un tag del hueco de antes ausente del de después (ni en sus tags ni en sus lecturas),
 *   si `(1 − tasa)^pasadas ≤ maxChance` con la tasa de antes (`readsByTag[tag].passes / passes`) y
 *   las pasadas de después, y además esas pasadas las hicieron **al menos dos AGV** (`vehicleIds` o,
 *   sin ellos, la cota inferior del mayor `vehicles` de `readsByTag`). Con un solo AGV, o sin poder
 *   contar dos, la ausencia va en `unconfirmed` y no cuenta como cambio (R-AGV-013).
 * - **insertado**: lo simétrico, con la tasa de después y las pasadas de antes.
 * - **sustituido**: un retirado y un insertado en el **mismo sitio**: entre los mismos vecinos
 *   estables (el ancla o el tag común más cercano a cada lado), emparejados en orden dentro de ese
 *   sitio; los que sobran quedan como retirado o insertado. `placement` es `mismo-sitio` salvo que
 *   los dos desfases se conozcan y disten más que la dispersión de después (p80 − p50, o cero).
 * - **suma**: producción si los dos lados tienen muestras y p80; si no, la noche; si no, `sin-medir`.
 *   Mismo veredicto que `compareAnchorGaps` (`sumVerdict`).
 *
 * Se devuelven solo los huecos con algún cambio o alguna ausencia sin afirmar.
 */
export function structureBetweenSnapshots(
  before: CircuitSnapshot,
  after: CircuitSnapshot,
  thresholds: TagChangeThresholds,
): StructureSet | null {
  const afterGaps = new Map(after.anchorGaps.map((gap) => [pairKey(gap.fromAnchor, gap.toAnchor), gap]));
  const shared = before.anchorGaps
    .map((gap) => ({ early: gap, late: afterGaps.get(pairKey(gap.fromAnchor, gap.toAnchor)) }))
    .filter((pair): pair is { early: SnapshotAnchorGap; late: SnapshotAnchorGap } => pair.late !== undefined);
  if (shared.length === 0) return null;

  const offsetsBefore = new Map(before.vertices.map((vertex) => [vertex.tagId, vertex.offsetMs]));
  const offsetsAfter = new Map(after.vertices.map((vertex) => [vertex.tagId, vertex.offsetMs]));
  const unlikely = (rate: number, passes: number): boolean => passes > 0 && (1 - rate) ** passes <= thresholds.maxChance;

  const gaps: AnchorGapChange[] = [];
  for (const { early, late } of shared) {
    const unconfirmed: UnconfirmedAbsence[] = [];
    const affirmed = (tagId: string, kind: UnconfirmedAbsence["kind"], read: SnapshotAnchorGap, other: SnapshotAnchorGap): boolean => {
      if (!unlikely(gapRate(read, tagId), other.passes)) return false;
      if (gapVehicles(other) >= 2) return true;
      unconfirmed.push({ tagId, kind, passes: other.passes, agvId: other.vehicleIds?.[0] ?? "sin-identificar" });
      return false;
    };
    const lateTags = new Set([...late.tags, ...Object.keys(late.readsByTag)]);
    const earlyTags = new Set([...early.tags, ...Object.keys(early.readsByTag)]);
    const retired = early.tags.filter((tagId) => !lateTags.has(tagId) && affirmed(tagId, "retirado", early, late));
    const inserted = late.tags.filter((tagId) => !earlyTags.has(tagId) && affirmed(tagId, "insertado", late, early));
    if (retired.length === 0 && inserted.length === 0 && unconfirmed.length === 0) continue;

    // Mismo sitio: mismos vecinos estables. Un bloque de tags seguidos cambiado a la vez tiene por
    // vecinos estables las anclas o los comunes de los extremos, y se empareja en orden dentro del sitio.
    const stable = new Set(early.tags.filter((tagId) => late.tags.includes(tagId)));
    const slotBefore = stableSlots(early.tags, stable, early.fromAnchor, early.toAnchor);
    const slotAfter = stableSlots(late.tags, stable, late.fromAnchor, late.toAnchor);
    const insertedBySlot = new Map<string, string[]>();
    for (const tagId of inserted) {
      const slot = slotAfter.get(tagId) as string;
      insertedBySlot.set(slot, [...(insertedBySlot.get(slot) ?? []), tagId]);
    }
    const regime = (["produccion", "noche"] as const).find((candidate) => {
      const a = early[candidate];
      const b = late[candidate];
      return a !== null && b !== null && a.samples > 0 && b.samples > 0 && a.p80Ms !== undefined && b.p80Ms !== undefined;
    }) ?? null;
    const side = (gap: SnapshotAnchorGap): GapSide => {
      const timed = regime === null ? null : gap[regime];
      return { passes: gap.passes, vehicles: gapVehicles(gap), p50Ms: timed?.p50Ms ?? null, p80Ms: timed?.p80Ms ?? null };
    };
    const a = side(early);
    const b = side(late);
    const spread = b.p50Ms === null || b.p80Ms === null ? 0 : Math.max(0, b.p80Ms - b.p50Ms);

    const changes: StructureChange[] = [];
    const paired = new Set<string>();
    for (const oldTagId of retired) {
      const queue = insertedBySlot.get(slotBefore.get(oldTagId) as string);
      const newTagId = queue?.shift();
      const oldOffsetMs = gapOffset(early, oldTagId, offsetsBefore);
      if (newTagId === undefined) {
        changes.push({ kind: "retirado", tagId: oldTagId, offsetMs: oldOffsetMs });
        continue;
      }
      paired.add(newTagId);
      const newOffsetMs = gapOffset(late, newTagId, offsetsAfter);
      const known = Number.isFinite(oldOffsetMs) && Number.isFinite(newOffsetMs);
      changes.push({
        kind: "sustituido",
        oldTagId,
        newTagId,
        oldOffsetMs,
        newOffsetMs,
        placement: known && Math.abs(newOffsetMs - oldOffsetMs) > spread ? "otro-punto" : "mismo-sitio",
      });
    }
    for (const tagId of inserted) {
      if (!paired.has(tagId)) changes.push({ kind: "insertado", tagId, offsetMs: gapOffset(late, tagId, offsetsAfter) });
    }
    const sum: SumVerdict = sumVerdict(regime, a, b);
    gaps.push({ fromAnchor: early.fromAnchor, toAnchor: early.toAnchor, before: a, after: b, regime, sum, changes, unconfirmed });
  }

  return {
    source: "entre-ficheros",
    beforeSourceId: before.sourceId,
    afterSourceId: after.sourceId,
    atUtcMs: after.window.from,
    gaps,
  };
}

/** Los AGV de una instantánea: la flota si se guardó; si no, los que algún tag nombra como no lectores. */
function vehiclesOf(snapshot: CircuitSnapshot): ReadonlySet<string> {
  if (snapshot.fleet !== null) return new Set(snapshot.fleet.vehicles);
  return new Set(snapshot.vertices.flatMap((vertex) => vertex.nonReaders));
}

/**
 * Deriva entre dos periodos distantes (R-DAT-016, R-AGV-013), leída de los vértices, con el mismo
 * tipo que `compareDistantPeriods`. Los periodos son las ventanas de las dos instantáneas; si distan
 * menos de `minGapMs` no son distantes y no se evalúa (misma guarda, R-TIM-008).
 *
 * - **desaparecido**: leído en `early` (`readings > 0`) y ausente o con 0 en `late`; **nuevo**, lo
 *   simétrico; **obsoleto-consolidado**: 0 en los dos y declarado en alguno.
 * - **Prueba de azar** (`absenceTest`): la tasa es `readings` del tag entre `readings` de su vecino
 *   dominante (`predecessor`/`successor` del vértice, R-DAT-019) en el periodo en que se leía, tomando
 *   el vecino con más lecturas en el otro periodo; las oportunidades, las lecturas de ese vecino en el
 *   otro periodo; `chance = (1 − tasa)^oportunidades`; afirmado si hay oportunidades y
 *   `chance ≤ maxChance`.
 * - **sustitucion-candidata**: un desaparecido y un nuevo, ambos con al menos `minReadingsPerVehicle`
 *   lecturas, con el mismo vecino dominante al mismo lado (`sharedNeighborMatch`) y unívocos en los
 *   dos sentidos (R-EVI-004).
 * - **vehicleDrifts**, desde `nonReaders` y la flota: un AGV de las dos flotas que en `early` no
 *   está entre los no lectores de un tag leído (se toma como lector suyo) y en `late` sí lo está,
 *   siguiendo vivo el tag para la flota → `droppedTags`; un tag nuevo (o el lado nuevo de una
 *   sustitución) con `readRate ≥ minAdoptionShare` en `late` que un AGV de la flota tardía tiene en
 *   sus `nonReaders` → `notAdoptedTags`.
 */
export function driftBetweenSnapshots(
  early: CircuitSnapshot,
  late: CircuitSnapshot,
  thresholds: DriftThresholds,
): DriftComparison {
  const earlyPeriod = early.window;
  const latePeriod = late.window;
  if (latePeriod.from - earlyPeriod.to < thresholds.minGapMs) {
    return {
      evaluated: false,
      reason: "El hueco entre las ventanas de las dos instantáneas es demasiado pequeño para tratarlas como distantes.",
      earlyPeriod: null,
      latePeriod: null,
      tagDrifts: [],
      vehicleDrifts: [],
    };
  }

  const before = new Map(early.vertices.map((vertex) => [vertex.tagId, vertex]));
  const after = new Map(late.vertices.map((vertex) => [vertex.tagId, vertex]));
  const readingsBefore = new Map(early.vertices.map((vertex) => [vertex.tagId, vertex.readings]));
  const readingsAfter = new Map(late.vertices.map((vertex) => [vertex.tagId, vertex.readings]));
  const signature = (vertex: SnapshotVertex | undefined): NeighborSignature => ({
    predecessor: vertex?.predecessor ?? null,
    successor: vertex?.successor ?? null,
  });

  const disappeared: string[] = [];
  const appeared: string[] = [];
  const consolidated: string[] = [];
  for (const tagId of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(tagId);
    const b = after.get(tagId);
    const x = a?.readings ?? 0;
    const y = b?.readings ?? 0;
    if (x > 0 && y === 0) disappeared.push(tagId);
    else if (x === 0 && y > 0) appeared.push(tagId);
    else if (x === 0 && y === 0 && ((a?.declared ?? false) || (b?.declared ?? false))) consolidated.push(tagId);
  }

  // Sustitución candidata (R-DAT-017): unívoca en los dos sentidos, con soporte de sobra a cada lado.
  const enough = (readings: number): boolean => readings >= thresholds.minReadingsPerVehicle;
  const hitsForD = new Map<string, { nTag: string; side: "predecesor" | "sucesor"; neighbor: string }[]>();
  const hitsForN = new Map<string, string[]>();
  for (const dTag of disappeared.filter((tagId) => enough(readingsBefore.get(tagId) ?? 0))) {
    for (const nTag of appeared.filter((tagId) => enough(readingsAfter.get(tagId) ?? 0))) {
      const match = sharedNeighborMatch(signature(before.get(dTag)), signature(after.get(nTag)));
      if (match === null) continue;
      hitsForD.set(dTag, [...(hitsForD.get(dTag) ?? []), { nTag, side: match.side, neighbor: match.neighbor }]);
      hitsForN.set(nTag, [...(hitsForN.get(nTag) ?? []), dTag]);
    }
  }
  const paired = new Map<string, { nTag: string; side: "predecesor" | "sucesor"; neighbor: string }>();
  for (const [dTag, hits] of hitsForD) {
    if (hits.length !== 1) continue;
    const hit = hits[0] as { nTag: string; side: "predecesor" | "sucesor"; neighbor: string };
    const forN = hitsForN.get(hit.nTag) ?? [];
    if (forN.length === 1 && forN[0] === dTag) paired.set(dTag, hit);
  }
  const absorbed = new Set([...paired.values()].map((hit) => hit.nTag));

  const tagDrifts: TagDrift[] = [];
  for (const tagId of disappeared) {
    const pair = paired.get(tagId);
    const readings = readingsBefore.get(tagId) ?? 0;
    if (pair === undefined) {
      tagDrifts.push({
        kind: "desaparecido",
        tagId,
        readingsBefore: readings,
        ...absenceTest(readings, signature(before.get(tagId)), readingsBefore, readingsAfter, thresholds.maxChance),
      });
    } else {
      tagDrifts.push({
        kind: "sustitucion-candidata",
        tagId,
        nuevoTagId: pair.nTag,
        readingsBefore: readings,
        readingsAfter: readingsAfter.get(pair.nTag) ?? 0,
        sharedNeighbor: pair.neighbor,
        neighborSide: pair.side,
      });
    }
  }
  for (const tagId of appeared) {
    if (absorbed.has(tagId)) continue;
    const readings = readingsAfter.get(tagId) ?? 0;
    tagDrifts.push({
      kind: "nuevo",
      tagId,
      readingsAfter: readings,
      ...absenceTest(readings, signature(after.get(tagId)), readingsAfter, readingsBefore, thresholds.maxChance),
    });
  }
  for (const tagId of consolidated) tagDrifts.push({ kind: "obsoleto-consolidado", tagId });
  tagDrifts.sort((a, b) => a.tagId.localeCompare(b.tagId));

  // Deriva de vehículos (R-AGV-013), desde `nonReaders`. Un tag muerto para toda la flota ya está en
  // `tagDrifts` y no se repite por vehículo.
  const deadEverywhere = new Set([...disappeared, ...consolidated]);
  const fleetEarly = vehiclesOf(early);
  const fleetLate = vehiclesOf(late);
  const droppedByVehicle = new Map<string, string[]>();
  for (const vertex of late.vertices) {
    const previous = before.get(vertex.tagId);
    if (previous === undefined || previous.readings === 0 || vertex.readings === 0 || deadEverywhere.has(vertex.tagId)) continue;
    const readBefore = new Set(previous.nonReaders);
    for (const agvId of vertex.nonReaders) {
      if (!fleetEarly.has(agvId) || !fleetLate.has(agvId) || readBefore.has(agvId)) continue;
      droppedByVehicle.set(agvId, [...(droppedByVehicle.get(agvId) ?? []), vertex.tagId]);
    }
  }

  const adoptionCandidates = new Set<string>();
  for (const entry of tagDrifts) {
    if (entry.kind === "nuevo") adoptionCandidates.add(entry.tagId);
    else if (entry.kind === "sustitucion-candidata") adoptionCandidates.add(entry.nuevoTagId);
  }
  const notAdoptedByVehicle = new Map<string, string[]>();
  for (const tagId of [...adoptionCandidates].sort()) {
    const vertex = after.get(tagId);
    if (vertex === undefined || vertex.readRate === null || vertex.readRate < thresholds.minAdoptionShare) continue;
    for (const agvId of vertex.nonReaders) {
      if (!fleetLate.has(agvId)) continue;
      notAdoptedByVehicle.set(agvId, [...(notAdoptedByVehicle.get(agvId) ?? []), tagId]);
    }
  }

  const vehicleDrifts: VehicleDrift[] = [...new Set([...droppedByVehicle.keys(), ...notAdoptedByVehicle.keys()])]
    .sort()
    .map((agvId) => ({
      agvId,
      droppedTags: [...(droppedByVehicle.get(agvId) ?? [])].sort(),
      notAdoptedTags: [...(notAdoptedByVehicle.get(agvId) ?? [])].sort(),
    }));

  return { evaluated: true, reason: null, earlyPeriod, latePeriod, tagDrifts, vehicleDrifts };
}
