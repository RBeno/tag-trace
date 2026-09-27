/**
 * Clasificación de los cambios observados frente al esperado (`MEMORY_CONSOLIDATION.md` §8).
 *
 * Un cambio observado no sustituye enseguida al esperado. Se clasifica como evento puntual,
 * incidencia, deriva pendiente, cambio colectivo sostenido o cambio confirmado, y **solo los dos
 * últimos** pasan al esperado de la versión que se consolida. Decisiones del propietario
 * (2026-09-27): un cambio es **sostenido** si se mantiene en `sustainedFiles` ficheros seguidos
 * (OQ-146, 3 por defecto, en configuración); es **colectivo** si lo muestra más de la mitad de los
 * AGV que pasan por el sitio (OQ-147, `collectiveShare`); y una incidencia se excluye del esperado
 * consolidando el periodo entero y dejando fuera de sus estadísticas lo que la incidencia toca
 * (OQ-148).
 *
 * Este fichero fija el contrato (tipos y firmas) y lo implementa (3.55.0). Una interpretación queda
 * escrita donde se hace: en una arista, «la mayoría» se mide sobre las pasadas y no sobre los AGV,
 * porque la instantánea no guarda los tiempos por AGV (`edgeCollective`).
 */

import type { PlanEvent } from "./plan.js";
import { pairKey, REGIMES, type Band, type Regime } from "./segment-bands.js";
import { buildSnapshot, compareSnapshots, type CircuitSnapshot, type SnapshotAnchorGap, type SnapshotDelta, type SnapshotEdge, type SnapshotVertex } from "./snapshot.js";

export type ChangeClass =
  /** Se vio en algún fichero desde el esperado y ya no está en el actual: volvió solo. Informativo. */
  | "evento-puntual"
  /** Lo toca un hallazgo grave confirmado del periodo: queda fuera del esperado. */
  | "incidencia"
  /** Está en el fichero actual pero no cumple todavía sostenido y colectivo, o no hay dato para decirlo. */
  | "deriva-pendiente"
  /** Se mantiene en `sustainedFiles` ficheros seguidos y lo muestra la mayoría de quien pasa. */
  | "cambio-colectivo-sostenido"
  /** Una persona lo confirmó: un evento del plano físico en el periodo (ADR-0016). */
  | "cambio-confirmado";

/** Qué cambia: un vértice (tag) o una arista (tramo en un régimen). */
export type ChangeSubject =
  | { readonly kind: "vertice"; readonly tagId: string }
  | { readonly kind: "arista"; readonly from: string; readonly to: string; readonly regime: Regime };

/** `vertice|T` o `arista|A|B|regimen`: la clave con la que se cruzan cambios, incidencias y confirmaciones. */
export function subjectKey(subject: ChangeSubject): string {
  return subject.kind === "vertice" ? `vertice|${subject.tagId}` : `arista|${subject.from}|${subject.to}|${subject.regime}`;
}

export interface ClassifiedChange {
  /** `subjectKey(subject)|change`. */
  readonly key: string;
  readonly subject: ChangeSubject;
  /** El tipo de cambio tal como lo da `compareSnapshots`: `deja-de-leerse`, `aparece`, `mas-lento`… */
  readonly change: string;
  readonly detail: string;
  readonly cls: ChangeClass;
  /** Ficheros seguidos, contando el actual, en los que el cambio está frente al esperado. */
  readonly files: number;
  /**
   * Quién lo muestra: la parte de los AGV que pasan por el sitio y lo muestran (`share`), con sus
   * recuentos; `null` si la instantánea no permite saberlo, y entonces no es colectivo.
   */
  readonly collective: { readonly share: number | null; readonly affected: number | null; readonly passing: number | null };
  /** Por qué tiene esta clase, en palabras y con sus cifras. */
  readonly reason: string;
  /** `true` solo en `cambio-colectivo-sostenido` y `cambio-confirmado`: pasa al esperado. */
  readonly adopted: boolean;
}

export interface ChangeClassThresholds {
  /** OQ-146: ficheros seguidos para que un cambio sea sostenido. */
  readonly sustainedFiles: number;
  /** OQ-147: parte de los AGV que pasan que tiene que mostrarlo; colectivo si la supera. */
  readonly collectiveShare: number;
}

export interface ClassifyInput {
  /** El esperado vigente (el de la versión vigente), o `null` si todavía no hay memoria. */
  readonly expected: CircuitSnapshot | null;
  /** Las instantáneas posteriores al esperado, en orden de ventana, terminando en la que se consolida. */
  readonly history: readonly CircuitSnapshot[];
  /** Claves de sujeto (`subjectKey`) que toca una incidencia del periodo. */
  readonly incidentSubjects: ReadonlySet<string>;
  /** Claves de sujeto confirmadas por una persona en el periodo (eventos del plano). */
  readonly confirmedSubjects: ReadonlySet<string>;
  readonly thresholds: ChangeClassThresholds & { readonly maxChance: number };
}

/** Las clases en el orden en que se enseñan: primero lo que pasa al esperado. */
export const CHANGE_CLASSES: readonly ChangeClass[] = [
  "cambio-confirmado",
  "cambio-colectivo-sostenido",
  "deriva-pendiente",
  "incidencia",
  "evento-puntual",
];

/** Un cambio presente en una instantánea frente al esperado, antes de clasificarlo. */
interface RawChange {
  readonly key: string;
  readonly subject: ChangeSubject;
  readonly change: string;
  readonly detail: string;
}

const percent = (share: number): string => `${Math.round(share * 100)} %`;
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const REGIME_LABEL: Readonly<Record<Regime, string>> = { produccion: "producción", noche: "noche" };
const files = (count: number): string => `${count} ${count === 1 ? "fichero" : "ficheros"}`;

/** Los cambios de un delta como sujetos: primero los vértices y luego las aristas, en el orden del delta. */
function rawChanges(delta: SnapshotDelta): readonly RawChange[] {
  const out: RawChange[] = [];
  for (const vertex of delta.vertices) {
    const subject: ChangeSubject = { kind: "vertice", tagId: vertex.tagId };
    out.push({ key: `${subjectKey(subject)}|${vertex.kind}`, subject, change: vertex.kind, detail: vertex.detail });
  }
  for (const edge of delta.edges) {
    const subject: ChangeSubject = { kind: "arista", from: edge.from, to: edge.to, regime: edge.regime };
    out.push({
      key: `${subjectKey(subject)}|${edge.direction}`,
      subject,
      change: edge.direction,
      detail:
        `El tramo ${edge.from} → ${edge.to} (${REGIME_LABEL[edge.regime]}) va ${edge.direction === "mas-lento" ? "más lento" : "más rápido"}: ` +
        `mediana de ${seconds(edge.after.p50Ms)} frente a la horquilla ${seconds(edge.before.p50Ms)}–${seconds(edge.before.p80Ms)} del esperado.`,
    });
  }
  return out;
}

/** Cambios de vértice que se miden como «lo dejan de ver» frente a «lo empiezan a ver». */
const LOSING = new Set(["deja-de-leerse", "desaparece", "no-observado"]);
const GAINING = new Set(["aparece", "empieza-a-leerse"]);

/**
 * La sección entre anclas del fichero actual donde está el tag: la que lo tiene entre sus tags, en
 * sus lecturas o como ancla; si ya no está en el anillo actual, la que empieza en su predecesor más
 * cercano del esperado que sigue en el anillo (el sitio por donde pasaban los AGV que lo leían).
 */
function gapOf(tagId: string, current: CircuitSnapshot, expected: CircuitSnapshot): SnapshotAnchorGap | null {
  const direct = current.anchorGaps.find((gap) => gap.tags.includes(tagId) || Object.hasOwn(gap.readsByTag, tagId));
  if (direct !== undefined) return direct;
  const asAnchor = current.anchorGaps.find((gap) => gap.fromAnchor === tagId || gap.toAnchor === tagId);
  if (asAnchor !== undefined) return asAnchor;
  const ring = expected.ring;
  const at = ring.indexOf(tagId);
  if (at < 0) return null;
  const inCurrent = new Set(current.ring);
  for (let step = 1; step < ring.length; step += 1) {
    const predecessor = ring[(at - step + ring.length) % ring.length] as string;
    if (!inCurrent.has(predecessor)) continue;
    return current.anchorGaps.find((gap) => gap.fromAnchor === predecessor || gap.tags.includes(predecessor)) ?? null;
  }
  return null;
}

interface Collective {
  /** `true` colectivo, `false` no lo es, `null` no se sabe (y entonces no lo es). */
  readonly collective: boolean | null;
  readonly share: number | null;
  readonly affected: number | null;
  readonly passing: number | null;
  /** En palabras, con sus cifras. */
  readonly why: string;
}

const NO_MEASURE = { share: null, affected: null, passing: null } as const;

/**
 * Quién muestra un cambio de vértice (OQ-147): de los AGV que pasan por la sección entre anclas del
 * tag (`vehicleIds`), cuántos lo muestran. Para lo que deja de verse, los que no lo leen; para lo que
 * empieza a verse, los que lo leen. Sin la lista de AGV no se sabe, y no se supone.
 */
function vertexCollective(change: string, tagId: string, current: CircuitSnapshot, expected: CircuitSnapshot, threshold: number): Collective {
  if (!LOSING.has(change) && !GAINING.has(change)) {
    return {
      collective: false,
      ...NO_MEASURE,
      why: "un cambio de sitio o de clase no tiene medida colectiva: solo pasa al esperado si una persona lo confirma con un evento del plano",
    };
  }
  const gap = gapOf(tagId, current, expected);
  const passing = gap?.vehicleIds?.length ?? null;
  if (gap === null || passing === null || passing === 0) {
    return { collective: null, ...NO_MEASURE, why: "la instantánea no dice cuántos AGV pasan por su sitio" };
  }
  // Las pasadas de una sección empiezan y acaban leyendo sus anclas: todos los AGV que pasan leen el ancla.
  const isAnchor = gap.fromAnchor === tagId || gap.toAnchor === tagId;
  const readers = Math.min(passing, gap.readsByTag[tagId]?.vehicles ?? (isAnchor ? passing : 0));
  const affected = LOSING.has(change) ? passing - readers : readers;
  const share = affected / passing;
  const collective = share > threshold;
  return {
    collective,
    share,
    affected,
    passing,
    why: `lo ${affected === 1 ? "muestra" : "muestran"} ${affected} de ${passing} AGV que pasan por su sitio (${percent(share)}; hace falta más del ${percent(threshold)})`,
  };
}

/**
 * Quién muestra un cambio de arista. La instantánea no guarda los tiempos por AGV, así que «la
 * mayoría» se interpreta sobre las pasadas: el cambio lo marca la regla de la horquilla, que exige
 * que la **mediana** de las pasadas del fichero quede fuera de la horquilla del esperado; es decir, que
 * lo muestre al menos la mitad de las pasadas. Si la configuración pide más de la mitad, la mediana
 * no basta para decirlo y no es colectivo.
 */
function edgeCollective(threshold: number): Collective {
  if (threshold > 0.5) {
    return {
      collective: null,
      ...NO_MEASURE,
      why: `la mediana de las pasadas se movió, pero eso solo asegura la mitad de las pasadas y hace falta más del ${percent(threshold)}; la instantánea no guarda los tiempos por AGV`,
    };
  }
  return {
    collective: true,
    ...NO_MEASURE,
    why: "la mediana de las pasadas se movió: más de la mitad de las pasadas lo muestran (interpretación de «la mayoría» para un tramo, porque la instantánea no guarda los tiempos por AGV)",
  };
}

/**
 * Clasifica los cambios frente al esperado (§8, OQ-146..148). El fichero actual es el último de
 * `history`; sin esperado no hay nada con qué comparar y no hay cambios. Primero van los presentes en
 * el fichero actual, en el orden de `compareSnapshots`, y detrás los eventos puntuales por clave.
 */
export function classifyChanges(input: ClassifyInput): readonly ClassifiedChange[] {
  const { expected, history, thresholds } = input;
  const current = history[history.length - 1];
  if (expected === null || current === undefined) return [];
  const compareWith = { maxChance: thresholds.maxChance };
  const perFile = history.map((snapshot) => rawChanges(compareSnapshots(expected, snapshot, compareWith)));
  const keysPerFile = perFile.map((list) => new Set(list.map((change) => change.key)));
  const last = history.length - 1;
  const present = perFile[last] as readonly RawChange[];
  const presentKeys = keysPerFile[last] as ReadonlySet<string>;
  const sustained = thresholds.sustainedFiles;

  const out: ClassifiedChange[] = [];
  for (const change of present) {
    let count = 0;
    for (let index = last; index >= 0 && (keysPerFile[index] as ReadonlySet<string>).has(change.key); index -= 1) count += 1;
    const key = subjectKey(change.subject);
    const measured =
      change.subject.kind === "vertice"
        ? vertexCollective(change.change, change.subject.tagId, current, expected, thresholds.collectiveShare)
        : edgeCollective(thresholds.collectiveShare);
    const collective = { share: measured.share, affected: measured.affected, passing: measured.passing };
    const base = { key: change.key, subject: change.subject, change: change.change, detail: change.detail, files: count, collective };
    if (input.incidentSubjects.has(key)) {
      out.push({
        ...base,
        cls: "incidencia",
        reason: "Lo toca un hallazgo grave confirmado del periodo: es una incidencia y queda fuera del esperado, que conserva su valor anterior.",
        adopted: false,
      });
    } else if (input.confirmedSubjects.has(key)) {
      out.push({ ...base, cls: "cambio-confirmado", reason: "Una persona lo confirmó con un evento del plano físico en el periodo: pasa al esperado.", adopted: true });
    } else if (count >= sustained && measured.collective === true) {
      out.push({
        ...base,
        cls: "cambio-colectivo-sostenido",
        reason: `Se mantiene en ${files(count)} seguidos (hacen falta ${sustained}) y es colectivo: ${measured.why}. Pasa al esperado.`,
        adopted: true,
      });
    } else {
      const parts: string[] = [];
      parts.push(count >= sustained ? `Se mantiene en ${files(count)} seguidos (hacen falta ${sustained}).` : `Lleva ${count} de ${sustained} ficheros seguidos: todavía no es sostenido.`);
      if (measured.collective === true) parts.push(`Es colectivo: ${measured.why}.`);
      else if (measured.collective === false) parts.push(`No es colectivo: ${measured.why}.`);
      else parts.push(`No se sabe si es colectivo, así que no se toma como tal: ${measured.why}.`);
      parts.push("Queda pendiente y el esperado conserva su valor anterior.");
      out.push({ ...base, cls: "deriva-pendiente", reason: parts.join(" "), adopted: false });
    }
  }

  // Eventos puntuales: vistos en algún fichero anterior del periodo y ausentes del actual.
  const gone = new Map<string, { change: RawChange; seen: number; lastFile: string }>();
  for (let index = 0; index < last; index += 1) {
    for (const change of perFile[index] as readonly RawChange[]) {
      if (presentKeys.has(change.key)) continue;
      const known = gone.get(change.key);
      gone.set(change.key, { change, seen: (known?.seen ?? 0) + 1, lastFile: (history[index] as CircuitSnapshot).fileName });
    }
  }
  for (const key of [...gone.keys()].sort()) {
    const { change, seen, lastFile } = gone.get(key) as { change: RawChange; seen: number; lastFile: string };
    out.push({
      key,
      subject: change.subject,
      change: change.change,
      detail: change.detail,
      cls: "evento-puntual",
      files: 0,
      collective: { ...NO_MEASURE },
      reason: `Se vio en ${seen} de los ${files(last)} anteriores del periodo (el último, ${lastFile}) y no está en el actual: volvió solo. No cambia el esperado.`,
      adopted: false,
    });
  }
  return out;
}

/**
 * El esperado que se consolida: lo observado, salvo en lo que no se adopta. Para cada vértice o
 * arista con un cambio no adoptado se conserva el valor del esperado anterior; lo que toca una
 * incidencia se conserva del anterior o, si no lo hay, queda sin medida (`null`), nunca con la
 * medida de la incidencia. Lo que no cambió sale de lo observado.
 */
export function expectedSnapshot(
  previousExpected: CircuitSnapshot | null,
  observed: CircuitSnapshot,
  changes: readonly ClassifiedChange[],
  incidentSubjects: ReadonlySet<string>,
): CircuitSnapshot {
  const previousVertices = new Map((previousExpected?.vertices ?? []).map((vertex) => [vertex.tagId, vertex]));
  const vertices = new Map(observed.vertices.map((vertex) => [vertex.tagId, vertex]));
  let ring = [...observed.ring];
  // Los cambios presentes que no se adoptan; los eventos puntuales ya no están en lo observado.
  const kept = changes.filter((change) => !change.adopted && change.cls !== "evento-puntual");

  if (previousExpected !== null) {
    const reinsert = new Set<string>();
    for (const change of kept) {
      if (change.subject.kind !== "vertice") continue;
      const tagId = change.subject.tagId;
      const before = previousVertices.get(tagId) ?? null;
      const now = vertices.get(tagId) ?? null;
      switch (change.change) {
        case "aparece":
          // Un tag que aparece sin adoptarse no entra en el anillo del esperado.
          ring = ring.filter((id) => id !== tagId);
          if (before === null) vertices.delete(tagId);
          else vertices.set(tagId, before);
          break;
        case "desaparece":
        case "se-mueve":
          // Vuelve a su sitio del esperado anterior, con su medida anterior.
          ring = ring.filter((id) => id !== tagId);
          reinsert.add(tagId);
          if (before !== null) vertices.set(tagId, before);
          break;
        case "cambia-de-clase":
          if (now !== null && before !== null) vertices.set(tagId, { ...now, inventoryClass: before.inventoryClass });
          break;
        default:
          // `deja-de-leerse`, `empieza-a-leerse`: la lectura del esperado anterior.
          if (now !== null && before !== null) {
            // El desglose por AGV va con las cifras de las que sale: el del esperado anterior, nunca el
            // del fichero nuevo junto a las pasadas del anterior.
            const { byVehicle: _observed, ...rest } = now;
            vertices.set(tagId, {
              ...rest,
              readRate: before.readRate,
              passes: before.passes,
              readings: before.readings,
              nonReaders: before.nonReaders,
              situation: before.situation,
              ...(before.byVehicle === undefined ? {} : { byVehicle: before.byVehicle }),
            });
          }
      }
    }
    const previousRing = previousExpected.ring;
    const previousIndex = new Map(previousRing.map((tagId, index) => [tagId, index]));
    for (const tagId of [...reinsert].sort((a, b) => (previousIndex.get(a) ?? 0) - (previousIndex.get(b) ?? 0))) {
      const at = previousIndex.get(tagId);
      if (at === undefined) continue;
      const present = new Set(ring);
      let insertAt = 0;
      for (let step = 1; step < previousRing.length; step += 1) {
        const predecessor = previousRing[(at - step + previousRing.length) % previousRing.length] as string;
        if (present.has(predecessor)) {
          insertAt = ring.indexOf(predecessor) + 1;
          break;
        }
      }
      ring.splice(insertAt, 0, tagId);
    }
  }

  // Lo que toca una incidencia: el valor anterior o, sin anterior, sin medida; nunca la de la incidencia.
  for (const key of incidentSubjects) {
    if (!key.startsWith("vertice|")) continue;
    const tagId = key.slice("vertice|".length);
    const now = vertices.get(tagId);
    if (now === undefined) continue;
    const before = previousVertices.get(tagId);
    if (before !== undefined) {
      vertices.set(tagId, before);
    } else {
      // Sin medida: tampoco desglose por AGV, que sería la medida de la incidencia.
      const { byVehicle: _observed, ...rest } = now;
      vertices.set(tagId, { ...rest, readRate: null, passes: 0, readings: 0, nonReaders: [] });
    }
  }

  // El anillo manda: posiciones de nuevo, y un tag fuera del anillo no tiene posición.
  const positionOf = new Map(ring.map((tagId, index) => [tagId, index]));
  const finalVertices: SnapshotVertex[] = [...vertices.values()].map((vertex) => ({ ...vertex, position: positionOf.get(vertex.tagId) ?? null }));

  // Aristas: las observadas donde el anillo es el observado; las del esperado anterior donde se restauró.
  const observedEdges = new Map(observed.edges.map((edge) => [pairKey(edge.from, edge.to), edge]));
  const previousEdges = new Map((previousExpected?.edges ?? []).map((edge) => [pairKey(edge.from, edge.to), edge]));
  const observedPairs = new Set(observed.ring.length < 2 ? [] : observed.ring.map((tagId, index) => pairKey(tagId, observed.ring[(index + 1) % observed.ring.length] as string)));
  const edges = new Map<string, SnapshotEdge>();
  if (ring.length >= 2) {
    ring.forEach((from, index) => {
      const to = ring[(index + 1) % ring.length] as string;
      const key = pairKey(from, to);
      const edge = observedPairs.has(key) ? observedEdges.get(key) : previousEdges.get(key);
      if (edge !== undefined) edges.set(key, edge);
    });
  }
  const setBand = (from: string, to: string, regime: Regime, band: Band | null): void => {
    const key = pairKey(from, to);
    const edge = edges.get(key);
    if (edge !== undefined) edges.set(key, { ...edge, [regime]: band });
  };
  for (const change of kept) {
    if (change.subject.kind !== "arista") continue;
    const { from, to, regime } = change.subject;
    setBand(from, to, regime, previousEdges.get(pairKey(from, to))?.[regime] ?? null);
  }
  for (const key of incidentSubjects) {
    const parts = key.split("|");
    if (parts[0] !== "arista" || parts.length !== 4) continue;
    const [, from, to, regime] = parts as [string, string, string, string];
    if (!(REGIMES as readonly string[]).includes(regime)) continue;
    setBand(from, to, regime as Regime, previousEdges.get(pairKey(from, to))?.[regime as Regime] ?? null);
  }

  const inRing = (tagId: string | null): boolean => tagId !== null && positionOf.has(tagId);
  const anchorTagId = inRing(observed.anchorTagId) ? observed.anchorTagId : inRing(previousExpected?.anchorTagId ?? null) ? (previousExpected?.anchorTagId ?? null) : null;

  // Pasa por `buildSnapshot`: la misma validación y el mismo orden canónico que cualquier instantánea.
  // Secciones, huecos entre anclas, flota, línea, calles y hallazgos son los de lo observado.
  return buildSnapshot({
    circuitId: observed.circuitId,
    zone: observed.zone,
    source: { sourceId: observed.sourceId, sourceHash: observed.sourceHash, fileName: observed.fileName, window: observed.window, acceptedRows: observed.acceptedRows },
    capturedAt: observed.capturedAt,
    appVersion: observed.appVersion,
    exposure: observed.exposure,
    cohortId: observed.cohortId,
    anchorTagId,
    anchorDeclared: anchorTagId === observed.anchorTagId ? observed.anchorDeclared : (previousExpected?.anchorDeclared ?? false),
    ring,
    lapMs: observed.lapMs,
    vertices: finalVertices,
    edges: [...edges.values()],
    sections: observed.sections,
    anchorGaps: observed.anchorGaps,
    fleet: observed.fleet,
    line: observed.line,
    lanes: observed.lanes,
    findings: observed.findings,
  });
}

/** Una incidencia del periodo: el hallazgo grave confirmado y lo que toca. Se guarda aparte del esperado (R-INC-001). */
export interface IncidentRecord {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly figure: string;
  /** Claves de sujeto que toca: los tags que nombra el hallazgo y los tramos que salen de ellos o llegan a ellos. */
  readonly subjects: readonly string[];
  /** Opcionales (OQ-149): la ventana del hallazgo, una por parada si hubo varias, y su AGV si es de un AGV. */
  readonly window?: { readonly from: number; readonly to: number };
  readonly windows?: readonly { readonly from: number; readonly to: number }[];
  readonly agvId?: string;
}

/**
 * Los sujetos que toca un hallazgo: los tags del anillo de la instantánea que aparecen en las partes
 * de su clave de revisión (también dentro de una parte que junta varios con «+»), y las aristas que
 * entran o salen de ellos en los dos regímenes. Un hallazgo que no nombra ningún tag del anillo (un
 * AGV, una calle) no toca el grafo: se guarda como incidencia y el esperado no cambia por él.
 *
 * Con `tagIds` (el hallazgo trae sus sujetos explícitos, OQ-149) mandan ellos y la clave no se lee:
 * cada uno que sea un vértice de la instantánea o esté en el anillo toca su vértice, y los del anillo
 * también los tramos de entrada y salida en los dos regímenes. Vacío, no toca nada del grafo. Sin
 * `tagIds` (instantáneas anteriores), como hasta ahora.
 */
export function incidentSubjectsOf(findingKey: string, snapshot: CircuitSnapshot, tagIds?: readonly string[]): readonly string[] {
  const inRing = new Set(snapshot.ring);
  const index = new Map(snapshot.ring.map((tagId, at) => [tagId, at]));
  const byRing = (a: string, b: string): number =>
    (index.get(a) ?? Number.POSITIVE_INFINITY) - (index.get(b) ?? Number.POSITIVE_INFINITY) || a.localeCompare(b);
  let tags: string[];
  if (tagIds !== undefined) {
    const known = new Set([...snapshot.ring, ...snapshot.vertices.map((vertex) => vertex.tagId)]);
    tags = [...new Set(tagIds.filter((tagId) => known.has(tagId)))].sort(byRing);
  } else {
    // Una parte puede juntar varios tags con «+» (`punto-conflictivo|T1+T2`, `snapshot-findings.ts`).
    const parts = findingKey.split("|").flatMap((part) => [part, ...part.split("+")]);
    tags = [...new Set(parts.filter((part) => inRing.has(part)))].sort(byRing);
  }
  const out = new Set<string>(tags.map((tagId) => subjectKey({ kind: "vertice", tagId })));
  for (const tagId of tags) for (const key of edgeSubjectsAround(tagId, snapshot.ring)) out.add(key);
  return [...out];
}

/** Las aristas de un tag en un anillo (la que llega y la que sale), en los dos regímenes. */
function edgeSubjectsAround(tagId: string, ring: readonly string[]): readonly string[] {
  const at = ring.indexOf(tagId);
  if (at < 0 || ring.length < 2) return [];
  const predecessor = ring[(at - 1 + ring.length) % ring.length] as string;
  const successor = ring[(at + 1) % ring.length] as string;
  const out: string[] = [];
  for (const [from, to] of [
    [predecessor, tagId],
    [tagId, successor],
  ] as const) {
    for (const regime of REGIMES) out.push(subjectKey({ kind: "arista", from, to, regime }));
  }
  return out;
}

/**
 * Los sujetos que una persona confirmó en el periodo con eventos del plano físico (ADR-0016): los tags
 * que se instalan, se sustituyen (el nuevo y el anterior), se retiran, los declarados al crear una
 * ubicación (`virtualTag`) y los de las ubicaciones que se cierran, con `effectiveAt` en
 * `(after, until]` (`after` `null`: desde el principio). Cada tag lleva su vértice y las aristas que
 * entran y salen de él en los anillos de `snapshots` (el esperado y lo observado). Una revisión
 * manual no confirma ningún cambio: es una observación.
 */
export function confirmedSubjectsOf(
  events: readonly PlanEvent[],
  period: { readonly after: number | null; readonly until: number },
  snapshots: readonly CircuitSnapshot[],
): ReadonlySet<string> {
  const inPeriod = (at: number): boolean => (period.after === null || at > period.after) && at <= period.until;
  const tagOf = new Map<string, string | null>();
  const tags = new Set<string>();
  const add = (tagId: string | null | undefined): void => {
    if (typeof tagId === "string" && tagId !== "") tags.add(tagId);
  };
  const ordered = [...events].sort((a, b) => a.effectiveAt - b.effectiveAt || a.seq - b.seq);
  for (const event of ordered) {
    const counts = inPeriod(event.effectiveAt);
    switch (event.type) {
      case "crear-plano":
        for (const entry of event.ring) tagOf.set(entry.locationId, entry.tagId);
        break;
      case "crear-ubicacion":
        tagOf.set(event.locationId, null);
        if (counts) add(event.virtualTag);
        break;
      case "instalar":
        if (counts) add(event.tagId);
        tagOf.set(event.locationId, event.tagId);
        break;
      case "sustituir":
        if (counts) {
          add(tagOf.get(event.locationId));
          add(event.tagId);
        }
        tagOf.set(event.locationId, event.tagId);
        break;
      case "retirar":
        if (counts) add(tagOf.get(event.locationId));
        tagOf.set(event.locationId, null);
        break;
      case "cerrar-ubicacion":
        if (counts) add(tagOf.get(event.locationId));
        tagOf.delete(event.locationId);
        break;
      case "revision-manual":
        break;
    }
  }
  const out = new Set<string>();
  for (const tagId of [...tags].sort()) {
    out.add(subjectKey({ kind: "vertice", tagId }));
    for (const snapshot of snapshots) for (const key of edgeSubjectsAround(tagId, snapshot.ring)) out.add(key);
  }
  return out;
}

/** Lo que una versión dice de sus cambios, en tres cifras para la lista de versiones. */
export interface ChangeSummary {
  /** Cambios que pasaron al esperado: colectivos sostenidos y confirmados. */
  readonly adopted: number;
  /** Derivas pendientes: presentes y todavía fuera del esperado. */
  readonly pending: number;
  /** Incidencias del periodo excluidas del esperado. */
  readonly incidents: number;
}

export function summarizeChanges(changes: readonly ClassifiedChange[], incidents: readonly IncidentRecord[]): ChangeSummary {
  return {
    adopted: changes.filter((change) => change.adopted).length,
    pending: changes.filter((change) => change.cls === "deriva-pendiente").length,
    incidents: incidents.length,
  };
}
