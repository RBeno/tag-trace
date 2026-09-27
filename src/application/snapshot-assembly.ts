/**
 * Ensambla el `SnapshotInput` (ADR-0015) con lo que el Worker ya calculó para el fichero.
 *
 * No mide nada: proyecta al contrato de la instantánea resultados que existen para las vistas —el
 * anillo y las posiciones en tiempo de la franja del fichero (R-TIM-011), su matriz de lectura
 * (R-OPP-013), sus vecinos dominantes (R-DAT-019), sus secciones entre anclas (R-TIM-012), sus sumas
 * entre anclas (R-DAT-021), la flota, la línea, las calles y los hallazgos—. Vive en la capa de
 * aplicación porque junta módulos de dominio distintos; `buildSnapshot` valida y sella.
 *
 * De dónde sale cada campo está en el tipo de entrada, campo por campo, para que quien cambie una
 * medición sepa qué parte de la instantánea toca.
 */

import type { AnchorSection } from "../domain/anchor-sections.js";
import type { LaneReport, LaneUsage } from "../domain/charging.js";
import type { Interval } from "../domain/coverage.js";
import type { FleetTimeline } from "../domain/fleet.js";
import type { FranjaCohort } from "../domain/franjas.js";
import type { TagClass } from "../domain/inventory.js";
import type { LineFeed } from "../domain/line-feed.js";
import type { ReadMatrix } from "../domain/read-matrix.js";
import type { RegimeExposure } from "../domain/segment-bands.js";
import type {
  SnapshotAnchorGap,
  SnapshotEdge,
  SnapshotFinding,
  SnapshotFleet,
  SnapshotInput,
  SnapshotLane,
  SnapshotLine,
  SnapshotSection,
  SnapshotVehicleCell,
  SnapshotVertex,
} from "../domain/snapshot.js";
import type { TagPlace } from "../domain/undeclared-tags.js";

export interface SnapshotAssemblyInput {
  readonly circuitId: string;
  readonly zone: string;
  /** El resumen de la fuente importada y su ventana completa (R-DAT-007). */
  readonly source: {
    readonly sourceId: string;
    readonly sourceHash: string;
    readonly fileName: string;
    readonly window: Interval;
    readonly acceptedRows: number;
  };
  readonly capturedAt: number;
  readonly appVersion: string;
  /** La configuración con que se midió (FR-031). */
  readonly configVersion?: string;
  /** `regimeExposure` sobre la ventana del fichero. */
  readonly exposure: RegimeExposure;
  /** El cohorte principal y su ancla efectiva (R-GRA-009). */
  readonly cohortId: number;
  readonly anchorTagId: string | null;
  readonly anchorDeclared: boolean;
  /** La medición de este fichero (`measureFranjaCohort`): anillo, posiciones, vuelta y horquillas. */
  readonly measure: Pick<FranjaCohort, "ring" | "positions" | "lapMs" | "bands"> | null;
  /** La matriz de lectura del cohorte principal **sobre este fichero** (`buildReadMatrix` en su ventana). */
  readonly matrix: Pick<ReadMatrix, "tags"> | null;
  /** Lecturas por tag en la ventana del fichero (cohorte principal). */
  readonly readingsByTag: ReadonlyMap<string, number>;
  /** Vecinos dominantes en la secuencia de los AGV (`dominantNeighbours`). */
  readonly neighbours: ReadonlyMap<string, TagPlace>;
  /** La lista `circuito` y la lista `critico`: lo declarado. */
  readonly declared: ReadonlySet<string>;
  /** El tramo de cada tag (`tagSections`). */
  readonly sectionOf: ReadonlyMap<string, string>;
  /** Función crítica declarada (`readCriticalPoints`) y, si no, la candidata (parada precisa, semáforo, bifurcación…). */
  readonly funcionOf: ReadonlyMap<string, string>;
  readonly candidateFunctionOf: ReadonlyMap<string, string>;
  /** La clase de inventario (`buildTagInventory`); vacío sin listas. */
  readonly inventoryClassOf: ReadonlyMap<string, TagClass>;
  /** A qué calle pertenece cada tag de calle (`readCoLanes`). */
  readonly laneOfTag: ReadonlyMap<string, string>;
  /** Los tags de la lista `linea`. */
  readonly lineTags: ReadonlySet<string>;
  /** Las anclas declaradas en la lista `ancla`. */
  readonly declaredAnchors: ReadonlySet<string>;
  /** Las secciones entre anclas de este fichero (`measureAnchorSections` en su ventana). */
  readonly sections: readonly Pick<AnchorSection, "fromTagId" | "toTagId" | "name" | "namedByList" | "tags" | "produccion" | "noche">[];
  /** Las sumas entre anclas de este fichero (`measureAnchorGaps`). */
  readonly anchorGaps: readonly SnapshotAnchorGap[];
  /** La flota del circuito (`buildFleetTimeline`); se recorta a la ventana del fichero. */
  readonly fleet: Pick<FleetTimeline, "historySource" | "vehicles" | "counts"> | null;
  /** La alimentación de la línea medida en la ventana del fichero (`measureLineFeed`). */
  readonly line: Pick<LineFeed, "evaluated" | "entryTagId" | "passes" | "cadence" | "stops" | "rhythm"> | null;
  /** Las calles en la ventana del fichero (`buildChargingReport`). */
  readonly lanes: readonly Pick<LaneReport, "laneId" | "served" | "stays" | "medianStayMs">[];
  readonly laneUsage: readonly Pick<LaneUsage, "laneId" | "share" | "verdict">[];
  readonly findings: readonly SnapshotFinding[];
}

/** La mediana de una serie de recuentos ponderada por lo que duró cada uno. */
function weightedMedian(entries: readonly { readonly value: number; readonly weight: number }[]): number {
  const sorted = [...entries].filter((entry) => entry.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return sorted[Math.floor(sorted.length / 2)]?.value ?? 0;
  let cursor = 0;
  for (const entry of sorted) {
    cursor += entry.weight;
    if (cursor * 2 >= total) return entry.value;
  }
  return sorted[sorted.length - 1]?.value ?? 0;
}

/** Las celdas de la matriz con pasadas, como las guarda la instantánea. */
function vehicleCells(cells: ReadMatrix["tags"][number]["byVehicle"]): Readonly<Record<string, SnapshotVehicleCell>> {
  const out: Record<string, SnapshotVehicleCell> = {};
  for (const cell of cells) if (cell.passes > 0) out[cell.agvId] = [cell.passes, cell.hits];
  return out;
}

function buildVertices(input: SnapshotAssemblyInput): readonly SnapshotVertex[] {
  const ring = input.measure?.ring ?? [];
  const positionOf = new Map(ring.map((tagId, index) => [tagId, index]));
  const offsetOf = new Map((input.measure?.positions ?? []).map((position) => [position.tagId, position.offsetMs]));
  const rowOf = new Map((input.matrix?.tags ?? []).map((row) => [row.tagId, row]));
  const universe = new Set<string>([...ring, ...input.readingsByTag.keys(), ...input.declared, ...rowOf.keys()]);

  return [...universe].sort().map((tagId): SnapshotVertex => {
    const position = positionOf.get(tagId) ?? null;
    const row = rowOf.get(tagId);
    const readings = input.readingsByTag.get(tagId) ?? 0;
    const laneId = input.laneOfTag.get(tagId) ?? null;
    const situation: SnapshotVertex["situation"] =
      position !== null ? "anillo" : laneId !== null ? "calle" : input.lineTags.has(tagId) ? "linea" : readings > 0 ? "fuera" : "sin-lecturas";
    const place = input.neighbours.get(tagId);
    return {
      tagId,
      position,
      offsetMs: offsetOf.get(tagId) ?? null,
      section: input.sectionOf.get(tagId) ?? null,
      funcion: input.funcionOf.get(tagId) ?? input.candidateFunctionOf.get(tagId) ?? null,
      declared: input.declared.has(tagId),
      readRate: row?.rate ?? null,
      passes: row?.passes ?? 0,
      readings,
      // Los AGV que pasaron por su sitio y no lo leyeron nunca en este fichero: pasadas sin lectura.
      nonReaders: (row?.byVehicle ?? []).filter((cell) => cell.passes > 0 && cell.hits === 0).map((cell) => cell.agvId),
      // Por AGV, sus pasadas probadas y sus aciertos, tal como los dejó la matriz (R-MEM-004).
      ...(row === undefined ? {} : { byVehicle: vehicleCells(row.byVehicle) }),
      predecessor: place?.predecessor ?? null,
      successor: place?.successor ?? null,
      inventoryClass: input.inventoryClassOf.get(tagId) ?? null,
      situation,
      laneId,
      isAnchor: tagId === input.anchorTagId || input.declaredAnchors.has(tagId),
    };
  });
}

/** Solo las horquillas de tramos consecutivos del anillo: eso es una arista; el resto son atajos medidos. */
function buildEdges(input: SnapshotAssemblyInput): readonly SnapshotEdge[] {
  const ring = input.measure?.ring ?? [];
  if (ring.length < 2) return [];
  const positionOf = new Map(ring.map((tagId, index) => [tagId, index]));
  const seen = new Set<string>();
  const edges: SnapshotEdge[] = [];
  for (const band of input.measure?.bands ?? []) {
    const from = positionOf.get(band.from);
    const to = positionOf.get(band.to);
    if (from === undefined || to === undefined || (from + 1) % ring.length !== to) continue;
    const key = `${band.from}\u0000${band.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: band.from, to: band.to, produccion: band.produccion, noche: band.noche });
  }
  return edges;
}

function buildFleet(input: SnapshotAssemblyInput): SnapshotFleet | null {
  if (input.fleet === null) return null;
  const { from, to } = input.source.window;
  const inside = input.fleet.counts
    .filter((count) => count.toUtcMs > from && count.fromUtcMs < to)
    .map((count) => ({ ...count, fromUtcMs: Math.max(from, count.fromUtcMs), toUtcMs: Math.min(to, count.toUtcMs) }));
  const last = inside[inside.length - 1];
  return {
    assigned: last?.assigned ?? 0,
    inCircuitAtEnd: last?.inCircuit ?? 0,
    inCircuitMedian: weightedMedian(inside.map((count) => ({ value: count.inCircuit, weight: count.toUtcMs - count.fromUtcMs }))),
    historySource: input.fleet.historySource,
    vehicles: input.fleet.vehicles.map((vehicle) => vehicle.agvId),
  };
}

function buildLine(input: SnapshotAssemblyInput): SnapshotLine | null {
  const feed = input.line;
  if (feed === null || !feed.evaluated) return null;
  const production = feed.rhythm.find((rhythm) => rhythm.regime === "produccion");
  return {
    entryTagId: feed.entryTagId,
    passes: feed.passes,
    cadence: feed.cadence,
    stops: feed.stops.length,
    stopsWithoutAgv: feed.stops.filter((stop) => stop.kind === "sin-agv").length,
    aboveFenceMs: production?.aboveFenceMs ?? 0,
    cycleMs: production?.cycleMs ?? null,
  };
}

function buildLanes(input: SnapshotAssemblyInput): readonly SnapshotLane[] {
  const usageOf = new Map(input.laneUsage.map((usage) => [usage.laneId, usage]));
  return input.lanes.map((lane): SnapshotLane => {
    const usage = usageOf.get(lane.laneId);
    return {
      laneId: lane.laneId,
      served: lane.served,
      stays: lane.stays.length,
      share: usage?.share ?? null,
      usageVerdict: usage?.verdict ?? null,
      medianStayMs: lane.medianStayMs,
    };
  });
}

export function assembleSnapshotInput(input: SnapshotAssemblyInput): SnapshotInput {
  return {
    circuitId: input.circuitId,
    zone: input.zone,
    source: input.source,
    capturedAt: input.capturedAt,
    appVersion: input.appVersion,
    ...(input.configVersion === undefined ? {} : { configVersion: input.configVersion }),
    exposure: { produccion: input.exposure.produccionMs, noche: input.exposure.nocheMs },
    cohortId: input.cohortId,
    anchorTagId: input.anchorTagId,
    anchorDeclared: input.anchorDeclared,
    ring: input.measure?.ring ?? [],
    lapMs: input.measure?.lapMs ?? null,
    vertices: buildVertices(input),
    edges: buildEdges(input),
    sections: input.sections.map(
      (section): SnapshotSection => ({
        fromTagId: section.fromTagId,
        toTagId: section.toTagId,
        name: section.name,
        namedByList: section.namedByList,
        tags: section.tags,
        produccion: section.produccion,
        noche: section.noche,
      }),
    ),
    anchorGaps: input.anchorGaps,
    fleet: buildFleet(input),
    line: buildLine(input),
    lanes: buildLanes(input),
    findings: input.findings,
  };
}
