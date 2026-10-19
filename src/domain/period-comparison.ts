/**
 * Las lecturas nuevas frente al periodo anterior del mismo análisis (R-DAT-024, propietario,
 * 2026-10-19: «las lecturas nuevas se tienen que comparar con las del análisis y su lista de
 * descubrimientos […] tags sustituidos, AGV que mejoran sus lecturas o tramos con menos pérdidas wifi»).
 *
 * Compara dos instantáneas seguidas (ADR-0015): la del fichero recién cargado y la del fichero
 * inmediatamente anterior en el tiempo. Nada se vuelve a medir: todo sale de lo que cada instantánea
 * guardó de su ventana.
 *
 * - **Hallazgos.** Por su clave (tipo y sujeto, R-EVI-007): los que **ya no aparecen**, los que
 *   **siguen** y los **nuevos**. Un hallazgo que no aparece no está «resuelto» si su sitio no tuvo
 *   ocasión: sin pasadas por sus tags, o sin su AGV en el periodo nuevo, queda **sin ocasión** y no se
 *   juzga (R-DAT-007). Se dice qué decidió la revisión en campo sobre él, sin cambiarla.
 * - **Tags y AGV que mejoran o empeoran.** Las omisiones (pasadas sin lectura) de cada periodo, con
 *   la misma prueba de azar que la verificación de una contramedida (`case-verification.ts`): con las
 *   omisiones de los dos periodos, ¿es improbable que el nuevo tenga tan pocas (o tantas), dado lo
 *   que pasó por el sitio en cada uno? Umbral: `maxChance` de los cambios de tag (OQ-138).
 * - **WiFi.** Los cortes que miden cobertura por tramo (R-COM-004), con la misma prueba sobre las
 *   pasadas de cada periodo. Sin registro en el periodo nuevo no se compara: se dice cuándo se cargó
 *   por última vez y hasta cuándo llega, para que nadie lea «sin cambios» donde no hay datos.
 *
 * Hechos, nunca causas (R-EVI-006): «mejora» dice que el periodo nuevo lee más, no por qué.
 */

import { binomialTail } from "./charging.js";
import { incidentSubjectsOf } from "./change-class.js";
import type { ReviewState } from "./review.js";
import type { CircuitSnapshot, SnapshotConnections, SnapshotFinding } from "./snapshot.js";

export type FindingFate = "ya-no-aparece" | "sin-ocasion" | "sigue" | "nuevo";

export interface FindingComparison {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly fate: FindingFate;
  readonly figureBefore: string | null;
  readonly figureAfter: string | null;
  /** Lo que decidió la revisión en campo, si se revisó. */
  readonly review: Exclude<ReviewState, "pendiente"> | null;
}

/** Un sujeto con lo que pasó por él en cada periodo y en cuántas no se leyó (o se cortó). */
export interface RateChange {
  readonly id: string;
  /** Para un tramo, el tag de llegada. */
  readonly to?: string;
  readonly before: { readonly passes: number; readonly misses: number };
  readonly after: { readonly passes: number; readonly misses: number };
  readonly direction: "mejora" | "empeora";
  /** La probabilidad de ver un cambio así sin que cambie nada. */
  readonly chance: number;
}

export type WifiComparison =
  | { readonly status: "comparado"; readonly better: readonly RateChange[]; readonly worse: readonly RateChange[]; readonly segments: number }
  /** El periodo nuevo no tiene registro: se dice cuándo se actualizó el registro por última vez. */
  | { readonly status: "sin-datos-nuevos" }
  /** El periodo anterior no tenía registro con que comparar. */
  | { readonly status: "sin-referencia" }
  | { readonly status: "sin-registro" };

export interface PeriodComparison {
  readonly before: { readonly sourceId: string; readonly fileName: string; readonly from: number; readonly to: number };
  readonly after: { readonly sourceId: string; readonly fileName: string; readonly from: number; readonly to: number };
  readonly findings: readonly FindingComparison[];
  readonly tags: { readonly better: readonly RateChange[]; readonly worse: readonly RateChange[]; readonly compared: number };
  readonly vehicles: { readonly better: readonly RateChange[]; readonly worse: readonly RateChange[]; readonly compared: number };
  readonly wifi: WifiComparison;
}

/**
 * ¿Cambió la tasa de fallos entre dos periodos? Condicionada al total de fallos, la parte del periodo
 * nuevo sigue una binomial con la parte de su exposición (las pasadas). Devuelve el sentido y la
 * probabilidad, o `null` si no es improbable o no hay con qué medir.
 */
export function rateShift(
  before: { readonly passes: number; readonly misses: number },
  after: { readonly passes: number; readonly misses: number },
  maxChance: number,
): { readonly direction: "mejora" | "empeora"; readonly chance: number } | null {
  if (before.passes === 0 || after.passes === 0) return null;
  const total = before.misses + after.misses;
  if (total === 0) return null;
  const share = after.passes / (before.passes + after.passes);
  const rateBefore = before.misses / before.passes;
  const rateAfter = after.misses / after.passes;
  if (rateAfter < rateBefore) {
    const chance = binomialTail(after.misses, total, share, "lower");
    return chance <= maxChance ? { direction: "mejora", chance } : null;
  }
  if (rateAfter > rateBefore) {
    const chance = binomialTail(after.misses, total, share, "upper");
    return chance <= maxChance ? { direction: "empeora", chance } : null;
  }
  return null;
}

const missesOf = (passes: number, hits: number): { passes: number; misses: number } => ({ passes, misses: Math.max(0, passes - Math.min(passes, hits)) });

/** Pasadas y lecturas de cada tag en sus pasadas probadas (R-OPP-013). */
function tagCounts(snapshot: CircuitSnapshot): ReadonlyMap<string, { passes: number; misses: number }> {
  const out = new Map<string, { passes: number; misses: number }>();
  for (const vertex of snapshot.vertices) {
    if (vertex.passes === 0 || vertex.readRate === null) continue;
    out.set(vertex.tagId, missesOf(vertex.passes, Math.round(vertex.readRate * vertex.passes)));
  }
  return out;
}

/** Pasadas y lecturas de cada AGV sumando sus celdas por tag; sin desglose por AGV, nada. */
function vehicleCounts(snapshot: CircuitSnapshot): ReadonlyMap<string, { passes: number; misses: number }> {
  const sums = new Map<string, { passes: number; hits: number }>();
  for (const vertex of snapshot.vertices) {
    for (const [agvId, cell] of Object.entries(vertex.byVehicle ?? {})) {
      const own = sums.get(agvId) ?? { passes: 0, hits: 0 };
      own.passes += cell[0];
      own.hits += cell[1];
      sums.set(agvId, own);
    }
  }
  return new Map([...sums].map(([agvId, sum]) => [agvId, missesOf(sum.passes, sum.hits)]));
}

function compareCounts(
  before: ReadonlyMap<string, { passes: number; misses: number }>,
  after: ReadonlyMap<string, { passes: number; misses: number }>,
  maxChance: number,
): { better: RateChange[]; worse: RateChange[]; compared: number } {
  const better: RateChange[] = [];
  const worse: RateChange[] = [];
  let compared = 0;
  for (const [id, now] of after) {
    const then = before.get(id);
    if (then === undefined || then.passes === 0 || now.passes === 0) continue;
    compared += 1;
    const shift = rateShift(then, now, maxChance);
    if (shift === null) continue;
    (shift.direction === "mejora" ? better : worse).push({ id, before: then, after: now, ...shift });
  }
  const bySize = (a: RateChange, b: RateChange): number => a.chance - b.chance || a.id.localeCompare(b.id);
  return { better: better.sort(bySize), worse: worse.sort(bySize), compared };
}

/** ¿Tuvo el sujeto del hallazgo ocasión de repetirse en el periodo nuevo? */
function hadOccasion(finding: SnapshotFinding, before: CircuitSnapshot, after: CircuitSnapshot): boolean {
  if (finding.agvId !== undefined) {
    const vehicles = new Set([...(after.fleet?.vehicles ?? []), ...vehicleCounts(after).keys()]);
    return vehicles.has(finding.agvId);
  }
  const tags = incidentSubjectsOf(finding.key, before, finding.tagIds)
    .filter((subject) => subject.startsWith("vertice|"))
    .map((subject) => subject.slice("vertice|".length));
  if (tags.length === 0) return true;
  const passes = new Map(after.vertices.map((vertex) => [vertex.tagId, vertex.passes]));
  return tags.some((tagId) => (passes.get(tagId) ?? 0) > 0);
}

export function comparePeriods(input: {
  readonly before: CircuitSnapshot;
  readonly after: CircuitSnapshot;
  readonly reviews: ReadonlyMap<string, { readonly state: Exclude<ReviewState, "pendiente"> }>;
  readonly maxChance: number;
}): PeriodComparison {
  const { before, after, reviews, maxChance } = input;
  const beforeByKey = new Map(before.findings.map((finding) => [finding.key, finding]));
  const afterByKey = new Map(after.findings.map((finding) => [finding.key, finding]));
  const findings: FindingComparison[] = [];
  const reviewOf = (key: string): FindingComparison["review"] => reviews.get(key)?.state ?? null;
  for (const finding of before.findings) {
    const now = afterByKey.get(finding.key);
    if (now !== undefined) {
      findings.push({ key: finding.key, kind: finding.kind, title: now.title, fate: "sigue", figureBefore: finding.figure, figureAfter: now.figure, review: reviewOf(finding.key) });
    } else {
      const fate: FindingFate = hadOccasion(finding, before, after) ? "ya-no-aparece" : "sin-ocasion";
      findings.push({ key: finding.key, kind: finding.kind, title: finding.title, fate, figureBefore: finding.figure, figureAfter: null, review: reviewOf(finding.key) });
    }
  }
  for (const finding of after.findings) {
    if (beforeByKey.has(finding.key)) continue;
    findings.push({ key: finding.key, kind: finding.kind, title: finding.title, fate: "nuevo", figureBefore: null, figureAfter: finding.figure, review: reviewOf(finding.key) });
  }

  return {
    before: { sourceId: before.sourceId, fileName: before.fileName, from: before.window.from, to: before.window.to },
    after: { sourceId: after.sourceId, fileName: after.fileName, from: after.window.from, to: after.window.to },
    findings,
    tags: compareCounts(tagCounts(before), tagCounts(after), maxChance),
    vehicles: compareCounts(vehicleCounts(before), vehicleCounts(after), maxChance),
    wifi: compareWifi(before.connections, after.connections, maxChance),
  };
}

function compareWifi(before: SnapshotConnections | undefined, after: SnapshotConnections | undefined, maxChance: number): WifiComparison {
  if (before === undefined && after === undefined) return { status: "sin-registro" };
  if (after === undefined || !after.covered) return { status: "sin-datos-nuevos" };
  if (before === undefined || !before.covered) return { status: "sin-referencia" };
  const key = (from: string, to: string): string => `${from}\u0000${to}`;
  const toCounts = (connections: SnapshotConnections): Map<string, { passes: number; misses: number }> =>
    new Map(connections.segments.map((segment) => [key(segment.from, segment.to), { passes: segment.passes, misses: Math.min(segment.passes, segment.cuts) }]));
  const result = compareCounts(toCounts(before), toCounts(after), maxChance);
  const split = (change: RateChange): RateChange => {
    const [from, to] = change.id.split("\u0000") as [string, string];
    return { ...change, id: from, to };
  };
  return { status: "comparado", better: result.better.map(split), worse: result.worse.map(split), segments: result.compared };
}

/** La instantánea inmediatamente anterior a otra en el tiempo (por ventana), o `null`. */
export function previousSnapshot(sorted: readonly CircuitSnapshot[], current: CircuitSnapshot): CircuitSnapshot | null {
  const at = sorted.findIndex((entry) => entry.sourceId === current.sourceId);
  return at > 0 ? (sorted[at - 1] as CircuitSnapshot) : null;
}
