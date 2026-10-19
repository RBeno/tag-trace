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
import { compareSnapshots, type CircuitSnapshot, type SnapshotConnections, type SnapshotFinding, type SnapshotVertex, type VertexDelta } from "./snapshot.js";
import type { Substitution } from "./substitution.js";

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

/**
 * Una modificación detectada entre los dos periodos, vinculada a los hallazgos del anterior que toca
 * (propietario, 2026-10-19: «lo primero mostraría las modificaciones detectadas y si resuelven un
 * problema previo y evidencias»).
 */
export interface Modification {
  readonly kind:
    | "sustitucion"
    | Exclude<VertexDelta["kind"], "no-observado">
    | "tag-lee-mas"
    | "tag-lee-menos"
    | "agv-lee-mas"
    | "agv-lee-menos"
    | "wifi-menos-cortes"
    | "wifi-mas-cortes";
  /** Lo que cambió, en palabras: «0200 → 0900, confirmada en el plano». */
  readonly title: string;
  readonly tags: readonly string[];
  readonly agvId: string | null;
  /**
   * - `resuelve`: todos los hallazgos anteriores que toca ya no aparecen.
   * - `resuelve-en-parte`: unos ya no aparecen y otros siguen.
   * - `no-resuelve`: los que toca siguen.
   * - `sin-ocasion`: los que toca no tuvieron ocasión de repetirse; no se juzga.
   * - `sin-problema-previo`: no tocaba ningún hallazgo del periodo anterior.
   */
  readonly verdict: "resuelve" | "resuelve-en-parte" | "no-resuelve" | "sin-ocasion" | "sin-problema-previo";
  /** Las claves de los hallazgos anteriores que toca, con su destino, y los nuevos sobre los mismos sujetos. */
  readonly previous: readonly { readonly key: string; readonly title: string; readonly figure: string; readonly fate: FindingFate; readonly review: FindingComparison["review"] }[];
  readonly appeared: readonly { readonly key: string; readonly title: string; readonly figure: string }[];
  /** Las cifras que la sostienen, en palabras, antes y ahora. */
  readonly evidence: readonly string[];
}

export interface PeriodComparison {
  readonly before: { readonly sourceId: string; readonly fileName: string; readonly from: number; readonly to: number };
  readonly after: { readonly sourceId: string; readonly fileName: string; readonly from: number; readonly to: number };
  /** Lo primero que se enseña: lo que cambió y si resuelve algo del periodo anterior. */
  readonly modifications: readonly Modification[];
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
  /** Las sustituciones del análisis (plano y detectadas); se toman las que tocan estos dos periodos. */
  readonly substitutions?: readonly Substitution[];
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

  const tags = compareCounts(tagCounts(before), tagCounts(after), maxChance);
  const vehicles = compareCounts(vehicleCounts(before), vehicleCounts(after), maxChance);
  const wifi = compareWifi(before.connections, after.connections, maxChance);
  return {
    before: { sourceId: before.sourceId, fileName: before.fileName, from: before.window.from, to: before.window.to },
    after: { sourceId: after.sourceId, fileName: after.fileName, from: after.window.from, to: after.window.to },
    modifications: detectModifications({ before, after, findings, tags, vehicles, wifi, maxChance, substitutions: input.substitutions ?? [] }),
    findings,
    tags,
    vehicles,
    wifi,
  };
}

// --- Modificaciones vinculadas a los hallazgos anteriores ------------------------------------------

/** Los tags y el AGV de un hallazgo: los de su clave y sus `tagIds`, en el anillo o fuera de él. */
function subjectsOf(finding: SnapshotFinding, snapshot: CircuitSnapshot): { readonly tags: ReadonlySet<string>; readonly agvId: string | null } {
  const known = new Set(snapshot.vertices.map((vertex) => vertex.tagId));
  const tags = new Set(
    incidentSubjectsOf(finding.key, snapshot, finding.tagIds)
      .filter((subject) => subject.startsWith("vertice|"))
      .map((subject) => subject.slice("vertice|".length)),
  );
  if (finding.tagIds === undefined) {
    for (const part of finding.key.split("|").flatMap((piece) => [piece, ...piece.split("+")])) if (known.has(part)) tags.add(part);
  }
  const vehicles = new Set(snapshot.fleet?.vehicles ?? []);
  const agvId = finding.agvId ?? finding.key.split("|").find((part) => vehicles.has(part)) ?? null;
  return { tags, agvId };
}

const share = (vertex: SnapshotVertex | undefined): string =>
  vertex === undefined || vertex.passes === 0 ? "sin pasadas" : `${vertex.readings.toLocaleString("es-ES")} lecturas en ${vertex.passes.toLocaleString("es-ES")} pasadas${vertex.readRate === null ? "" : ` (${Math.round(vertex.readRate * 100)} %)`}`;

const rateText = (counts: { readonly passes: number; readonly misses: number }, what: "lectura" | "corte"): string => {
  const part = what === "lectura" ? counts.passes - counts.misses : counts.misses;
  return `${Math.round((100 * part) / Math.max(1, counts.passes))} % de ${what === "lectura" ? "lectura" : "pasadas con corte"} en ${counts.passes.toLocaleString("es-ES")} pasadas`;
};

const DELTA_TITLE: Readonly<Record<Exclude<VertexDelta["kind"], "no-observado">, string>> = {
  aparece: "aparece en el anillo",
  desaparece: "desaparece del anillo",
  "se-mueve": "cambia de sitio en el anillo",
  "cambia-de-clase": "cambia de clase",
  "deja-de-leerse": "deja de leerse",
  "empieza-a-leerse": "empieza a leerse",
};

function detectModifications(input: {
  readonly before: CircuitSnapshot;
  readonly after: CircuitSnapshot;
  readonly findings: readonly FindingComparison[];
  readonly tags: { readonly better: readonly RateChange[]; readonly worse: readonly RateChange[] };
  readonly vehicles: { readonly better: readonly RateChange[]; readonly worse: readonly RateChange[] };
  readonly wifi: WifiComparison;
  readonly maxChance: number;
  readonly substitutions: readonly Substitution[];
}): readonly Modification[] {
  const { before, after, findings } = input;
  const vertexBefore = new Map(before.vertices.map((vertex) => [vertex.tagId, vertex]));
  const vertexAfter = new Map(after.vertices.map((vertex) => [vertex.tagId, vertex]));
  const previous = before.findings.map((finding) => ({ finding, subjects: subjectsOf(finding, before), fate: findings.find((entry) => entry.key === finding.key) }));
  const appearedFindings = after.findings
    .filter((finding) => !before.findings.some((old) => old.key === finding.key))
    .map((finding) => ({ finding, subjects: subjectsOf(finding, after) }));
  const touches = (subjects: { readonly tags: ReadonlySet<string>; readonly agvId: string | null }, tags: readonly string[], agvId: string | null): boolean =>
    (agvId !== null && subjects.agvId === agvId) || tags.some((tagId) => subjects.tags.has(tagId));

  const build = (kind: Modification["kind"], title: string, tags: readonly string[], agvId: string | null, evidence: readonly string[]): Modification => {
    const linked = previous
      .filter((entry) => touches(entry.subjects, tags, agvId))
      .map((entry) => ({
        key: entry.finding.key,
        title: entry.finding.title,
        figure: entry.finding.figure,
        fate: entry.fate?.fate ?? "ya-no-aparece",
        review: entry.fate?.review ?? null,
      }));
    const appeared = appearedFindings
      .filter((entry) => touches(entry.subjects, tags, agvId))
      .map((entry) => ({ key: entry.finding.key, title: entry.finding.title, figure: entry.finding.figure }));
    const gone = linked.filter((entry) => entry.fate === "ya-no-aparece").length;
    const kept = linked.filter((entry) => entry.fate === "sigue").length;
    const verdict: Modification["verdict"] =
      linked.length === 0 ? "sin-problema-previo" : gone > 0 && kept === 0 ? "resuelve" : gone > 0 ? "resuelve-en-parte" : kept > 0 ? "no-resuelve" : "sin-ocasion";
    return { kind, title, tags, agvId, verdict, previous: linked, appeared, evidence };
  };

  const out: Modification[] = [];
  const covered = new Set<string>();
  // Las sustituciones primero: el sustituido estaba en el periodo anterior o el nuevo se lee en este.
  for (const substitution of input.substitutions) {
    const old = vertexBefore.get(substitution.oldTagId);
    const now = vertexAfter.get(substitution.newTagId);
    if (old === undefined && now === undefined) continue;
    if (substitution.at !== null && (substitution.at > after.window.to || substitution.at < before.window.from)) continue;
    covered.add(substitution.oldTagId);
    covered.add(substitution.newTagId);
    out.push(
      build(
        "sustitucion",
        `${substitution.oldTagId} → ${substitution.newTagId}, ${substitution.status === "confirmada" ? "confirmada en el plano" : "detectada en las lecturas, sin confirmar"}`,
        [substitution.oldTagId, substitution.newTagId],
        null,
        [
          `${substitution.oldTagId} en «${before.fileName}»: ${share(old)}; en «${after.fileName}»: ${share(vertexAfter.get(substitution.oldTagId))}.`,
          `${substitution.newTagId} en «${after.fileName}»: ${share(now)}.`,
        ],
      ),
    );
  }
  // Los cambios del grafo (ADR-0015): un tag que aparece, desaparece, se mueve, cambia de clase o deja o empieza a leerse.
  for (const delta of compareSnapshots(before, after, { maxChance: input.maxChance }).vertices) {
    if (delta.kind === "no-observado" || covered.has(delta.tagId)) continue;
    covered.add(delta.tagId);
    out.push(build(delta.kind, `${delta.tagId} ${DELTA_TITLE[delta.kind]}`, [delta.tagId], null, [delta.detail]));
  }
  for (const change of input.tags.better) {
    if (covered.has(change.id)) continue;
    out.push(build("tag-lee-mas", `${change.id} lee más`, [change.id], null, [`Antes ${rateText(change.before, "lectura")}; ahora ${rateText(change.after, "lectura")}.`]));
  }
  for (const change of input.tags.worse) {
    if (covered.has(change.id)) continue;
    out.push(build("tag-lee-menos", `${change.id} lee menos`, [change.id], null, [`Antes ${rateText(change.before, "lectura")}; ahora ${rateText(change.after, "lectura")}.`]));
  }
  for (const change of input.vehicles.better) {
    out.push(build("agv-lee-mas", `AGV ${change.id} lee más`, [], change.id, [`Antes ${rateText(change.before, "lectura")}; ahora ${rateText(change.after, "lectura")}.`]));
  }
  for (const change of input.vehicles.worse) {
    out.push(build("agv-lee-menos", `AGV ${change.id} lee menos`, [], change.id, [`Antes ${rateText(change.before, "lectura")}; ahora ${rateText(change.after, "lectura")}.`]));
  }
  if (input.wifi.status === "comparado") {
    for (const [list, kind, word] of [
      [input.wifi.better, "wifi-menos-cortes", "menos"],
      [input.wifi.worse, "wifi-mas-cortes", "más"],
    ] as const) {
      for (const change of list) {
        out.push(
          build(kind, `Tramo ${change.id} → ${change.to ?? "?"} con ${word} cortes de WiFi`, [change.id, change.to ?? ""].filter((tagId) => tagId !== ""), null, [
            `Antes ${rateText(change.before, "corte")}; ahora ${rateText(change.after, "corte")}.`,
          ]),
        );
      }
    }
  }
  const order: Readonly<Record<Modification["verdict"], number>> = { resuelve: 0, "resuelve-en-parte": 1, "no-resuelve": 2, "sin-ocasion": 3, "sin-problema-previo": 4 };
  // Primero lo que resuelve algo; dentro de cada veredicto, el orden de detección.
  return out.map((entry, index) => ({ entry, index })).sort((a, b) => order[a.entry.verdict] - order[b.entry.verdict] || a.index - b.index).map((item) => item.entry);
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
