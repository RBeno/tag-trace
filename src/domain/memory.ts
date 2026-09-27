/**
 * La memoria consolidada del circuito (F4; ADR-0005, ADR-0015 §4, R-MEM-001..003).
 *
 * Una **versión** es una instantánea revisada que una persona eligió como referencia del circuito:
 * el «esperado» contra el que se comparan los ficheros siguientes. Se escribe **append-only**:
 * vN+1 nunca toca vN; un error se corrige con una revocación que apunta a la versión afectada y una
 * versión nueva, y el historial y la razón permanecen visibles (`MEMORY_CONSOLIDATION.md` §7).
 * Ninguna IA consolida: `consolidate` solo se llama tras la confirmación humana del flujo de §6.
 *
 * Este fichero fija el **contrato** (tipos y firmas). Los campos se añaden, no se renombran; cambiar
 * uno es subir `MEMORY_SCHEMA_VERSION` y escribir su migración.
 */

import {
  classifyChanges,
  expectedSnapshot,
  incidentSubjectsOf,
  type ChangeClassThresholds,
  type ClassifiedChange,
  type IncidentRecord,
} from "./change-class.js";
import type { AppliedCut } from "./incident-cut.js";
import type { ReviewEntry, ReviewState } from "./review.js";
import { canonicalise, semanticHash } from "./semantic-hash.js";
import { compareSnapshots, type CircuitSnapshot, type SnapshotDelta } from "./snapshot.js";
import type { TagChangeThresholds } from "./tag-changes.js";

export const MEMORY_SCHEMA_VERSION = 1;

/** Un hallazgo del periodo con la decisión humana que llevaba al consolidar (R-EVI-007). */
export interface MemoryDecision {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly figure: string;
  readonly state: ReviewState;
  readonly note: string | null;
}

export interface ConsolidatedVersion {
  readonly schemaVersion: number;
  readonly circuitId: string;
  /** 1, 2, 3… en orden de creación dentro del linaje. */
  readonly version: number;
  readonly createdAt: number;
  /** El fichero del que sale la instantánea consolidada. */
  readonly basedOn: {
    readonly sourceId: string;
    readonly sourceHash: string;
    readonly fileName: string;
    readonly window: { readonly from: number; readonly to: number };
  };
  /** Cadena de hashes (`MEMORY_CONSOLIDATION.md` §10): el de la versión anterior del linaje, o `null` en la primera. */
  readonly previousHash: string | null;
  /** Hash semántico del contenido de esta versión sin este campo (INV-010). */
  readonly hash: string;
  /** Identificador del linaje: el dispositivo que consolidó. Dos linajes distintos son una bifurcación. */
  readonly lineage: string;
  /** El grafo consolidado: la instantánea elegida, tal cual. */
  readonly snapshot: CircuitSnapshot;
  /** Lo que cambia frente a la versión anterior no revocada; `null` en la primera. */
  readonly delta: SnapshotDelta | null;
  /** Los hallazgos con su decisión: confirmados, descartados y pospuestos con su motivo. */
  readonly decisions: readonly MemoryDecision[];
  /** Justificación humana de la consolidación, opcional. */
  readonly note: string | null;
  readonly revoked: { readonly at: number; readonly reason: string } | null;
  /**
   * El esperado que deja esta versión (§8, OQ-146..148): lo observado salvo los cambios no adoptados
   * y lo que toca una incidencia. Ausente en las versiones anteriores a 3.55.0, que usan `snapshot`,
   * y también desde 3.55.0 cuando es idéntico a `snapshot` (no se guarda dos veces lo mismo, §9): en
   * los dos casos el esperado es `expected ?? snapshot` (`expectedOf`). Las versiones de 3.55.0 en
   * adelante se reconocen porque traen `changes` e `incidents`, aunque estén vacíos.
   */
  readonly expected?: CircuitSnapshot;
  /** Los cambios frente al esperado anterior, con su clase. */
  readonly changes?: readonly ClassifiedChange[];
  /** Las incidencias del periodo, guardadas aparte del esperado (R-INC-001). */
  readonly incidents?: readonly IncidentRecord[];
  /**
   * Los recortes de ventana que una persona eligió al consolidar (OQ-148), con cuántas lecturas quitó
   * cada uno. Con recortes, `snapshot` es la instantánea del fichero rehecha desde su original
   * archivado sin esas lecturas; la instantánea guardada del fichero no cambia. Ausente sin recortes.
   * Entra en el hash como el resto de la versión.
   */
  readonly cuts?: readonly AppliedCut[];
  /** Versión de la aplicación que consolidó. */
  readonly appVersion: string;
}

export type BlockerCode =
  /** Hay hallazgos sin revisar: solo bloquea lo pendiente (propietario, 2026-09-23). */
  | "hallazgos-pendientes"
  /**
   * Hay hallazgos de rango 1 confirmados. **Desde 3.55.0 no se produce** (OQ-148, propietario
   * 2026-09-27): el periodo se consolida entero y lo que toca la incidencia queda fuera del esperado.
   * Se conserva en la unión por compatibilidad con previsualizaciones y textos anteriores.
   */
  | "periodo-de-incidencia"
  /** El fichero elegido no tiene instantánea. */
  | "sin-instantanea"
  /** Ya hay una versión no revocada basada en ese mismo fichero (INV-007). */
  | "ya-consolidada"
  /** Hay una bifurcación de linaje sin resolver (§10). */
  | "bifurcacion-sin-resolver";

export interface ConsolidationBlocker {
  readonly code: BlockerCode;
  readonly detail: string;
  /** Claves de hallazgo, identificadores de fichero o versiones implicadas. */
  readonly items: readonly string[];
}

export interface ConsolidationPreview {
  readonly basedOn: ConsolidatedVersion["basedOn"];
  /** La versión vigente (última no revocada) o `null`. */
  readonly previous: ConsolidatedVersion | null;
  readonly nextVersion: number;
  readonly delta: SnapshotDelta | null;
  readonly blockers: readonly ConsolidationBlocker[];
  /** Avisos que no bloquean: pospuestos que volverán como pendientes, descartados, etc. */
  readonly warnings: readonly string[];
  readonly decisions: readonly MemoryDecision[];
  /** Tamaño estimado de la versión, en bytes, para el presupuesto (§9). */
  readonly estimatedBytes: number;
  /** Los cambios frente al esperado vigente con su clase; vacío en la primera versión. */
  readonly changes?: readonly ClassifiedChange[];
  /** Las incidencias que se excluirán del esperado (OQ-148). */
  readonly incidents?: readonly IncidentRecord[];
  /** Los recortes de ventana aplicados (OQ-148), con cuántas lecturas quitó cada uno. Ausente sin recortes. */
  readonly cuts?: readonly AppliedCut[];
  /**
   * Si el fichero original está archivado con su huella, que es lo que permite recortar (OQ-145,
   * OQ-148). `false` con el motivo en `cutUnavailable`. Ausente si quien previsualiza no lo comprobó.
   */
  readonly originalArchived?: boolean;
  readonly cutUnavailable?: string;
}

export interface ConsolidationInput {
  readonly snapshot: CircuitSnapshot;
  /** Las marcas de revisión del circuito, por clave. */
  readonly reviews: ReadonlyMap<string, ReviewEntry>;
  /** Todas las versiones guardadas, revocadas incluidas, en orden. */
  readonly versions: readonly ConsolidatedVersion[];
  /** Rango de cada tipo de hallazgo (1 puede parar la planta, 2 degrada, 3 limpieza). */
  readonly rankOf: (kind: string) => number;
  /** `true` si hay una bifurcación de linaje sin resolver (§10). */
  readonly forkUnresolved: boolean;
  /**
   * `maxChance` compara instantáneas. `changeClass` (OQ-146, OQ-147) es opcional para no romper las
   * llamadas anteriores: sin él no se clasifican los cambios (`changes` queda ausente) y el esperado
   * es lo observado salvo lo que toca una incidencia.
   */
  readonly thresholds: Pick<TagChangeThresholds, "maxChance"> & { readonly changeClass?: ChangeClassThresholds };
  /**
   * Las instantáneas posteriores al esperado vigente, en orden de ventana, terminando en la que se
   * consolida (si no termina en ella, se añade). Sin ella, solo la que se consolida.
   */
  readonly history?: readonly CircuitSnapshot[];
  /** Claves de sujeto (`subjectKey`) que una persona confirmó en el periodo con eventos del plano. */
  readonly confirmedSubjects?: ReadonlySet<string>;
  /**
   * Los recortes que se aplicaron para obtener `snapshot` (OQ-148): la instantánea ya viene rehecha sin
   * esas lecturas. Solo se registran; la previsualización no recorta nada.
   */
  readonly cuts?: readonly AppliedCut[];
}

/** El esperado de una versión: `expected` si lo guarda, o la instantánea (anteriores a 3.55.0, o idéntico). */
export function expectedOf(version: ConsolidatedVersion): CircuitSnapshot {
  return version.expected ?? version.snapshot;
}

/** Las claves de sujeto que tocan las incidencias. */
export function incidentSubjectSet(incidents: readonly IncidentRecord[]): ReadonlySet<string> {
  return new Set(incidents.flatMap((incident) => incident.subjects));
}

/**
 * Lo que la versión guarda del esperado, sus cambios y sus incidencias. `expected` solo si difiere de
 * la instantánea: si no, sería guardar dos veces lo mismo (§9).
 */
function expectationFields(
  preview: ConsolidationPreview,
  snapshot: CircuitSnapshot,
): Pick<ConsolidatedVersion, "expected" | "changes" | "incidents"> {
  const incidents = preview.incidents ?? [];
  const changes = preview.changes ?? [];
  const expected = expectedSnapshot(preview.previous === null ? null : expectedOf(preview.previous), snapshot, changes, incidentSubjectSet(incidents));
  const same = canonicalise(expected) === canonicalise(snapshot);
  return { ...(same ? {} : { expected }), changes, incidents };
}

/** Los hallazgos de la instantánea cruzados con la revisión: la decisión que llevaba cada uno (R-EVI-007). */
function decisionsOf(snapshot: CircuitSnapshot, reviews: ReadonlyMap<string, ReviewEntry>): readonly MemoryDecision[] {
  return snapshot.findings.map((finding) => {
    const review = reviews.get(finding.key);
    return {
      key: finding.key,
      kind: finding.kind,
      title: finding.title,
      figure: finding.figure,
      // «Pendiente» no se guarda como marca (`review.ts`): es la ausencia de decisión.
      state: review?.state ?? "pendiente",
      note: review === undefined || review.note.trim() === "" ? null : review.note,
    };
  });
}

/** El número que le toca a la siguiente versión: uno más que la mayor guardada, revocadas incluidas. */
function nextVersionNumber(versions: readonly ConsolidatedVersion[]): number {
  return versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
}

/** El principio de la razón que habla de ficheros seguidos, tal como lo escribe `classifyChanges`. */
const CONSECUTIVE_CLAUSE = /^(?:Se mantiene en \d+ ficheros? seguidos \(hacen falta \d+\)|Lleva \d+ de \d+ ficheros seguidos: todavía no es sostenido)/;

function consecutiveClause(total: number, carried: number, sustained: number): string {
  const from = `contando ${carried} de periodos ya consolidados`;
  return total >= sustained
    ? `Se mantiene en ${total} ficheros seguidos, ${from} (hacen falta ${sustained})`
    : `Lleva ${total} de ${sustained} ficheros seguidos, ${from}: todavía no es sostenido`;
}

/**
 * Los ficheros seguidos continúan entre consolidaciones (OQ-146, «tres ficheros seguidos»). La
 * historia de una consolidación empieza después de la versión vigente, así que, consolidando cada
 * periodo, `classifyChanges` contaría siempre un fichero y un cambio permanente no se adoptaría nunca
 * (lo encontró la prueba de oro, `historia-oro.test.ts`). Un cambio que la versión vigente guardó sin
 * adoptar, con `files > 0`, y que sigue en **todos** los ficheros de la historia, suma los de esa
 * versión. Si con la suma llega a sostenido, la clase la decide otra vez `classifyChanges` pidiendo
 * los ficheros que faltan, con su misma medida colectiva; solo se reescribe la cuenta de la razón.
 *
 * No se arrastra lo que la versión vigente guardó como `incidencia` (OQ-158, propietario 2026-09-27):
 * la medida de un tag o un tramo bajo un hallazgo grave confirmado no es prueba de un cambio permanente,
 * así que sus ficheros no cuentan hacia sostenido; si el cambio sigue después, la cuenta empieza con la
 * historia nueva. Tampoco se arrastra un `evento-puntual` (tiene `files` 0). Solo continúa la cuenta de
 * una `deriva-pendiente`, la única clase que guarda ficheros seguidos sin adoptar.
 */
function carryConsecutive(
  changes: readonly ClassifiedChange[],
  previous: ConsolidatedVersion,
  historyLength: number,
  sustained: number,
  classify: (sustainedFiles: number) => readonly ClassifiedChange[],
): readonly ClassifiedChange[] {
  const carried = new Map<string, number>();
  for (const change of previous.changes ?? []) {
    if (!change.adopted && change.cls === "deriva-pendiente" && change.files > 0) carried.set(change.key, change.files);
  }
  if (carried.size === 0) return changes;
  const reruns = new Map<number, ReadonlyMap<string, ClassifiedChange>>();
  const rerun = (sustainedFiles: number): ReadonlyMap<string, ClassifiedChange> => {
    let found = reruns.get(sustainedFiles);
    if (found === undefined) {
      found = new Map(classify(sustainedFiles).map((change) => [change.key, change]));
      reruns.set(sustainedFiles, found);
    }
    return found;
  };
  return changes.map((change) => {
    const before = carried.get(change.key);
    if (before === undefined || change.files !== historyLength || change.cls === "evento-puntual") return change;
    const total = change.files + before;
    if (change.cls !== "deriva-pendiente") return { ...change, files: total };
    const decided = total >= sustained ? (rerun(Math.max(1, sustained - before)).get(change.key) ?? change) : change;
    return { ...decided, files: total, reason: decided.reason.replace(CONSECUTIVE_CLAUSE, consecutiveClause(total, before, sustained)) };
  });
}

/**
 * Lo que la versión vigente guardó pendiente y ya no está (OQ-150 (2), propietario 2026-09-27). Un
 * cambio que vN guardó sin adoptar, de clase `deriva-pendiente` y con `files > 0`, y que **no está en
 * el último fichero de la historia** —el que se consolida— volvió: se lista como `evento-puntual`,
 * informativo, sin adoptarse, con la razón «se vio en vN y volvió». El criterio es el último fichero,
 * no «ninguno de la historia»: es el mismo que `classifyChanges` aplica dentro del periodo (lo que no
 * está en el actual es un evento puntual), y un cambio que va y viene dentro del periodo pero ya no
 * está al final también volvió. No duplica: si la clave ya sale en `changes` —presente en el último
 * fichero con cualquier clase, o como evento puntual que `classifyChanges` produjo porque se vio en un
 * fichero anterior de la propia historia—, no se añade. Sin esperado vigente no hay nada que volver.
 */
function returnedPending(changes: readonly ClassifiedChange[], previous: ConsolidatedVersion, lastFile: string): readonly ClassifiedChange[] {
  const listed = new Set(changes.map((change) => change.key));
  const out: ClassifiedChange[] = [];
  for (const change of previous.changes ?? []) {
    if (change.adopted || change.cls !== "deriva-pendiente" || change.files <= 0 || listed.has(change.key)) continue;
    listed.add(change.key);
    out.push({
      key: change.key,
      subject: change.subject,
      change: change.change,
      detail: change.detail,
      cls: "evento-puntual",
      files: 0,
      collective: { share: null, affected: null, passing: null },
      reason:
        `Se vio en v${previous.version} y volvió: quedó pendiente allí tras ${change.files === 1 ? "1 fichero" : `${change.files} ficheros seguidos`} ` +
        `y no está en el último del periodo (${lastFile}). No cambia el esperado.`,
      adopted: false,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Qué pasaría al consolidar: la previsualización de vN+1 (§6, paso E). No escribe nada.
 *
 * Bloquea **solo lo pendiente** (propietario, 2026-09-23): un hallazgo confirmado, descartado o
 * pospuesto no impide consolidar. Lo pospuesto pasa con su motivo y con aviso de que volverá como
 * pendiente en el periodo siguiente.
 *
 * Un hallazgo de rango 1 confirmado es una **incidencia** y, desde 3.55.0, ya no bloquea (OQ-148,
 * propietario 2026-09-27): el periodo se consolida entero, la incidencia se guarda aparte
 * (`incidents`, R-INC-001) y lo que toca queda fuera de las estadísticas del esperado. Con
 * `thresholds.changeClass`, los cambios frente al esperado vigente se clasifican (§8, `changes`).
 */
export function previewConsolidation(input: ConsolidationInput): ConsolidationPreview {
  const { snapshot, versions } = input;
  const decisions = decisionsOf(snapshot, input.reviews);
  const previous = currentVersion(versions);
  const blockers: ConsolidationBlocker[] = [];
  const warnings: string[] = [];

  const pending = decisions.filter((decision) => decision.state === "pendiente");
  if (pending.length > 0) {
    blockers.push({
      code: "hallazgos-pendientes",
      detail: `${pending.length} ${pending.length === 1 ? "hallazgo sigue" : "hallazgos siguen"} sin revisar. Solo bloquea lo pendiente: confirma, descarta o pospón cada uno.`,
      items: pending.map((decision) => decision.key),
    });
  }

  // OQ-148: un rango 1 confirmado no bloquea; se excluye del esperado lo que toca. OQ-149: con su
  // ventana, su AGV si es de un AGV, y los tags explícitos del hallazgo si los trae.
  const findingOf = new Map(snapshot.findings.map((finding) => [finding.key, finding]));
  const incidents: IncidentRecord[] = decisions
    .filter((decision) => decision.state === "confirmado" && input.rankOf(decision.kind) === 1)
    .map((decision) => {
      const finding = findingOf.get(decision.key);
      return {
        key: decision.key,
        kind: decision.kind,
        title: decision.title,
        figure: decision.figure,
        subjects: incidentSubjectsOf(decision.key, snapshot, finding?.tagIds),
        ...(finding?.window === undefined ? {} : { window: { from: finding.window.from, to: finding.window.to } }),
        ...(finding?.windows === undefined ? {} : { windows: finding.windows.map((window) => ({ from: window.from, to: window.to })) }),
        ...(finding?.agvId === undefined ? {} : { agvId: finding.agvId }),
      };
    });

  const twin = versions.filter((version) => version.revoked === null && version.basedOn.sourceHash === snapshot.sourceHash);
  if (twin.length > 0) {
    blockers.push({
      code: "ya-consolidada",
      detail: `Ya existe una versión vigente basada en este mismo fichero (v${twin.map((version) => version.version).join(", v")}). Para corregirla, revócala y consolida de nuevo.`,
      items: twin.map((version) => `v${version.version}`),
    });
  }

  if (input.forkUnresolved) {
    blockers.push({
      code: "bifurcacion-sin-resolver",
      detail: "Hay una bifurcación de linaje sin resolver: elige qué memoria conservar antes de consolidar.",
      items: [],
    });
  }

  const postponed = decisions.filter((decision) => decision.state === "pospuesto");
  if (postponed.length > 0) {
    const motives = postponed.map((decision) => `${decision.title}${decision.note === null ? "" : ` (${decision.note})`}`);
    warnings.push(
      `${postponed.length} ${postponed.length === 1 ? "hallazgo pospuesto se consolida" : "hallazgos pospuestos se consolidan"} con su motivo y ${postponed.length === 1 ? "volverá" : "volverán"} como ${postponed.length === 1 ? "pendiente" : "pendientes"} en el periodo siguiente: ${motives.join("; ")}.`,
    );
  }
  const discarded = decisions.filter((decision) => decision.state === "descartado").length;
  if (discarded > 0) {
    warnings.push(`${discarded} ${discarded === 1 ? "hallazgo descartado queda" : "hallazgos descartados quedan"} en la versión con su decisión, sin cambiar el análisis.`);
  }

  const basedOn: ConsolidatedVersion["basedOn"] = {
    sourceId: snapshot.sourceId,
    sourceHash: snapshot.sourceHash,
    fileName: snapshot.fileName,
    window: { from: snapshot.window.from, to: snapshot.window.to },
  };
  const expected = previous === null ? null : expectedOf(previous);
  const delta = expected === null ? null : compareSnapshots(expected, snapshot, { maxChance: input.thresholds.maxChance });
  const nextVersion = nextVersionNumber(versions);

  const changeClass = input.thresholds.changeClass;
  let changes: readonly ClassifiedChange[] | undefined;
  if (changeClass !== undefined) {
    const given = input.history ?? [];
    const history = given[given.length - 1]?.sourceId === snapshot.sourceId ? given : [...given.filter((entry) => entry.sourceId !== snapshot.sourceId), snapshot];
    const classify = (sustainedFiles: number): readonly ClassifiedChange[] =>
      classifyChanges({
        expected,
        history,
        incidentSubjects: incidentSubjectSet(incidents),
        confirmedSubjects: input.confirmedSubjects ?? new Set(),
        thresholds: { ...changeClass, sustainedFiles, maxChance: input.thresholds.maxChance },
      });
    changes = classify(changeClass.sustainedFiles);
    // La cuenta de ficheros seguidos no empieza de cero en cada consolidación (OQ-146): sin historia
    // explícita no se sabe si los ficheros son contiguos, y no se arrastra nada.
    if (previous !== null && input.history !== undefined) {
      changes = carryConsecutive(changes, previous, history.length, changeClass.sustainedFiles, classify);
    }
    if (previous !== null) changes = [...changes, ...returnedPending(changes, previous, snapshot.fileName)];
  }

  // El tamaño se estima sobre una versión provisional con el hash vacío: el hash real tiene siempre
  // la misma longitud, así que la diferencia es de decenas de bytes.
  const provisional: ConsolidatedVersion = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    circuitId: snapshot.circuitId,
    version: nextVersion,
    createdAt: 0,
    basedOn,
    previousHash: previous?.hash ?? null,
    hash: "",
    lineage: "",
    snapshot,
    delta,
    decisions,
    note: null,
    revoked: null,
    appVersion: "",
  };
  const shown: ConsolidationPreview = {
    basedOn,
    previous,
    nextVersion,
    delta,
    blockers,
    warnings,
    decisions,
    estimatedBytes: 0,
    ...(changes === undefined ? {} : { changes }),
    incidents,
    ...(input.cuts === undefined || input.cuts.length === 0 ? {} : { cuts: input.cuts }),
  };
  const estimatedBytes = versionBytes({ ...provisional, ...expectationFields(shown, snapshot), ...(shown.cuts === undefined ? {} : { cuts: shown.cuts }) });

  return { ...shown, estimatedBytes };
}

/**
 * Una previsualización que solo dice que el fichero no tiene instantánea (`sin-instantanea`): el
 * Worker la emite cuando la fuente existe pero su instantánea no se pudo construir o es anterior a
 * la versión 6 del almacén. Volver a cargar el fichero la crea.
 */
export function previewWithoutSnapshot(
  basedOn: ConsolidatedVersion["basedOn"],
  versions: readonly ConsolidatedVersion[],
): ConsolidationPreview {
  return {
    basedOn,
    previous: currentVersion(versions),
    nextVersion: nextVersionNumber(versions),
    delta: null,
    blockers: [
      {
        code: "sin-instantanea",
        detail: `El fichero «${basedOn.fileName}» no tiene instantánea guardada. Vuelve a cargarlo para crearla.`,
        items: [basedOn.sourceId],
      },
    ],
    warnings: [],
    decisions: [],
    estimatedBytes: 0,
  };
}

/**
 * El hash de una versión: el hash semántico (INV-010) de su contenido **con `hash: ""`** y tal como
 * nació (`revoked: null`). Se calcula una vez, al consolidar; revocarla no lo cambia, que es lo que
 * permite que dos dispositivos comparen sus cadenas aunque uno haya revocado algo.
 */
export async function versionHash(version: ConsolidatedVersion): Promise<string> {
  return semanticHash({ ...version, hash: "", revoked: null });
}

/**
 * Escribe la versión vN+1 en memoria (no en el almacén): solo tras la confirmación humana (§6,
 * paso G). Lanza si la previsualización tiene bloqueos. El `hash` sale del hash semántico del
 * contenido y `previousHash` del vigente.
 */
export async function consolidate(
  preview: ConsolidationPreview,
  context: { readonly circuitId: string; readonly snapshot: CircuitSnapshot; readonly lineage: string; readonly appVersion: string; readonly now: number; readonly note: string | null },
): Promise<ConsolidatedVersion> {
  if (preview.blockers.length > 0) {
    throw new Error(`No se puede consolidar: ${preview.blockers.map((blocker) => blocker.code).join(", ")}.`);
  }
  if (context.snapshot.sourceHash !== preview.basedOn.sourceHash) {
    throw new Error("La instantánea no es la de la previsualización: la consolidación se rehace desde el principio.");
  }
  const unhashed: ConsolidatedVersion = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    circuitId: context.circuitId,
    version: preview.nextVersion,
    createdAt: context.now,
    basedOn: preview.basedOn,
    previousHash: preview.previous?.hash ?? null,
    hash: "",
    lineage: context.lineage,
    snapshot: context.snapshot,
    delta: preview.delta,
    decisions: preview.decisions,
    note: context.note === null || context.note.trim() === "" ? null : context.note,
    revoked: null,
    ...expectationFields(preview, context.snapshot),
    ...(preview.cuts === undefined || preview.cuts.length === 0 ? {} : { cuts: preview.cuts.map(copyApplied) }),
    appVersion: context.appVersion,
  };
  return { ...unhashed, hash: await versionHash(unhashed) };
}

function copyApplied(cut: AppliedCut): AppliedCut {
  return { incidentKey: cut.incidentKey, from: cut.from, to: cut.to, ...(cut.agvId === undefined ? {} : { agvId: cut.agvId }), removed: cut.removed };
}

/** Revoca una versión: no la borra ni la edita, la marca con fecha y razón (§7). Devuelve una copia. */
export function revokeVersion(version: ConsolidatedVersion, reason: string, now: number): ConsolidatedVersion {
  if (version.revoked !== null) {
    throw new Error(`La versión v${version.version} ya estaba revocada.`);
  }
  if (reason.trim() === "") {
    throw new Error("Una revocación necesita su razón: queda en el historial (§7).");
  }
  return { ...version, revoked: { at: now, reason } };
}

/** Las versiones en orden de creación dentro del linaje: por número y, a igual número, por fecha. */
export function sortVersions(versions: readonly ConsolidatedVersion[]): readonly ConsolidatedVersion[] {
  return [...versions].sort((a, b) => a.version - b.version || a.createdAt - b.createdAt);
}

/** La versión vigente: la última no revocada, o `null`. */
export function currentVersion(versions: readonly ConsolidatedVersion[]): ConsolidatedVersion | null {
  const ordered = sortVersions(versions);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const version = ordered[index] as ConsolidatedVersion;
    if (version.revoked === null) return version;
  }
  return null;
}

/** Lo observado frente a la memoria: el delta del fichero actual contra el esperado de la versión vigente. */
export interface MemoryComparison {
  readonly version: number;
  readonly basedOnFileName: string;
  readonly consolidatedAt: number;
  readonly delta: SnapshotDelta;
}

/**
 * Dos versiones consolidadas cualesquiera comparadas entre sí (F4, «comparador entre versiones»): el
 * esperado de `from` frente al esperado de `to`, con lo que hay entre medias. Sirve para ver cómo
 * evolucionó el circuito de v1 a v4 sin pasar por lo observado.
 */
export interface VersionComparison {
  readonly from: { readonly version: number; readonly fileName: string; readonly window: { readonly from: number; readonly to: number }; readonly revoked: boolean };
  readonly to: { readonly version: number; readonly fileName: string; readonly window: { readonly from: number; readonly to: number }; readonly revoked: boolean };
  /** Versiones del mismo linaje entre las dos, sin contarlas, y cuántas de ellas están revocadas. */
  readonly between: { readonly versions: number; readonly revoked: number };
  /**
   * Los cambios que cada versión posterior a la menor, hasta la mayor, adoptó, en orden de número: la
   * historia de cómo se llegó. `revoked` (añadido con la implementación) dice si esa versión está
   * revocada: lo que adoptó no forma parte de la cadena vigente.
   */
  readonly adoptedAlongTheWay: readonly { readonly version: number; readonly keys: readonly string[]; readonly revoked?: boolean }[];
  readonly delta: SnapshotDelta;
}

/**
 * `from` y `to` son números de versión del conjunto dado (normalmente el linaje activo). Lanza si
 * alguno no existe, si está repetido o si son la misma. El orden importa: el delta va del esperado de
 * `from` al de `to`, y `from` puede ser posterior a `to` para ver el cambio al revés. La historia de
 * adopciones va siempre en orden de número, de la menor (sin incluirla) a la mayor.
 */
export function compareVersions(
  versions: readonly ConsolidatedVersion[],
  from: number,
  to: number,
  thresholds: Pick<TagChangeThresholds, "maxChance">,
): VersionComparison {
  if (from === to) {
    throw new Error(`No se compara una versión consigo misma (v${from}): elige dos versiones distintas.`);
  }
  const ordered = sortVersions(versions);
  const find = (number: number): ConsolidatedVersion => {
    const found = ordered.filter((version) => version.version === number);
    if (found.length === 0) throw new Error(`La versión v${number} no está entre las versiones del linaje.`);
    if (found.length > 1) throw new Error(`Hay ${found.length} versiones v${number}: compara dentro de un solo linaje.`);
    return found[0] as ConsolidatedVersion;
  };
  const a = find(from);
  const b = find(to);
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const inside = ordered.filter((version) => version.version > low && version.version < high);
  const side = (version: ConsolidatedVersion): VersionComparison["from"] => ({
    version: version.version,
    fileName: version.basedOn.fileName,
    window: { from: version.basedOn.window.from, to: version.basedOn.window.to },
    revoked: version.revoked !== null,
  });
  return {
    from: side(a),
    to: side(b),
    between: { versions: inside.length, revoked: inside.filter((version) => version.revoked !== null).length },
    adoptedAlongTheWay: ordered
      .filter((version) => version.version > low && version.version <= high)
      .map((version) => ({
        version: version.version,
        keys: (version.changes ?? []).filter((change) => change.adopted).map((change) => change.key),
        revoked: version.revoked !== null,
      })),
    delta: compareSnapshots(expectedOf(a), expectedOf(b), { maxChance: thresholds.maxChance }),
  };
}

export function compareToMemory(
  current: CircuitSnapshot,
  memory: ConsolidatedVersion,
  thresholds: Pick<TagChangeThresholds, "maxChance">,
): MemoryComparison {
  return {
    version: memory.version,
    basedOnFileName: memory.basedOn.fileName,
    consolidatedAt: memory.createdAt,
    delta: compareSnapshots(expectedOf(memory), current, thresholds),
  };
}

/** Relación entre la memoria local y la de un `.agvproj` que se abre (§10). */
export type LineageRelation = "sin-memoria" | "identica" | "local-adelantada" | "entrante-adelantada" | "bifurcada";

/** ¿Es `prefix` un prefijo (propio o no) de `chain`? */
function isPrefix(prefix: readonly string[], chain: readonly string[]): boolean {
  return prefix.length <= chain.length && prefix.every((hash, index) => chain[index] === hash);
}

/**
 * Clasifica por la **cadena de hashes**, en orden de versión:
 *
 * - `sin-memoria`: el proyecto no trae versiones (haya o no memoria local: no hay nada que comparar).
 * - `identica`: las dos cadenas son iguales.
 * - `local-adelantada`: la entrante es un prefijo de la local.
 * - `entrante-adelantada`: la local es un prefijo de la entrante (también si la local está vacía).
 * - `bifurcada`: ancestro común y ramas distintas, o ningún ancestro común con las dos no vacías.
 */
export function classifyLineage(
  local: readonly ConsolidatedVersion[],
  incoming: readonly ConsolidatedVersion[],
): LineageRelation {
  const localChain = sortVersions(local).map((version) => version.hash);
  const incomingChain = sortVersions(incoming).map((version) => version.hash);
  if (incomingChain.length === 0) return "sin-memoria";
  if (localChain.length === incomingChain.length && isPrefix(localChain, incomingChain)) return "identica";
  if (isPrefix(incomingChain, localChain)) return "local-adelantada";
  if (isPrefix(localChain, incomingChain)) return "entrante-adelantada";
  return "bifurcada";
}

/** Bytes que ocupa una versión serializada, para el presupuesto de crecimiento (§9). */
export function versionBytes(version: ConsolidatedVersion): number {
  return new TextEncoder().encode(JSON.stringify(version)).length;
}

// --- Linajes (§10) ---------------------------------------------------------------------------------

/**
 * Un linaje: su identificador y los hashes de sus versiones, en orden. Se identifica por hashes y no
 * solo por `lineage` porque dos dispositivos que consolidan en paralelo desde la misma versión heredan
 * el mismo identificador y producen versiones con el mismo número: solo el hash las distingue.
 */
export interface LineageRef {
  readonly id: string;
  readonly hashes: readonly string[];
}

export interface LineageEvent {
  readonly at: number;
  readonly choice: "conservar-local" | "adoptar-entrante";
  readonly reason: string;
  /** Presente si la elección se hizo en otro dispositivo y llegó con un `.agvproj` (OQ-144). */
  readonly origin?: "otro-dispositivo";
}

/** Dos eventos son el mismo si coinciden instante, elección y razón; de dónde vinieron no cuenta. */
function eventKey(event: LineageEvent): string {
  return `${event.at}|${event.choice}|${event.reason}`;
}

/**
 * Añade al historial las elecciones de linaje que trae un `.agvproj` y aquí no estaban (OQ-144,
 * propietario 2026-09-27). Solo se añaden, marcadas como de otro dispositivo: son decisiones humanas
 * ajenas que se registran, no que se aplican ni se reinterpretan (R-MEM-002). Devuelve el estado y
 * cuántas entraron.
 */
export function withForeignEvents(
  state: LineageState,
  incoming: readonly LineageEvent[],
): { readonly state: LineageState; readonly added: number } {
  const known = new Set(state.lineageEvents.map(eventKey));
  const added: LineageEvent[] = [];
  for (const event of incoming) {
    const key = eventKey(event);
    if (known.has(key)) continue;
    known.add(key);
    added.push({ at: event.at, choice: event.choice, reason: event.reason, origin: "otro-dispositivo" });
  }
  if (added.length === 0) return { state, added: 0 };
  const lineageEvents = [...state.lineageEvents, ...added].sort((a, b) => a.at - b.at);
  return { state: { ...state, lineageEvents }, added: added.length };
}

/** El estado de linaje del circuito: qué memoria está vigente, cuál espera decisión y cuáles quedaron archivadas. */
export interface LineageState {
  readonly circuitId: string;
  /** El linaje sobre el que se consolida; `null` hasta la primera versión. */
  readonly active: LineageRef | null;
  /** El linaje entrante de una bifurcación sin resolver, o `null`. */
  readonly incoming: LineageRef | null;
  /** Linajes que una elección dejó como histórico: se conservan, nunca se borran. */
  readonly archived: readonly LineageRef[];
  /** La última relación clasificada al abrir un `.agvproj`, o `null` si nunca se abrió uno con memoria. */
  readonly lastRelation: LineageRelation | null;
  readonly lineageEvents: readonly LineageEvent[];
}

export function emptyLineageState(circuitId: string): LineageState {
  return { circuitId, active: null, incoming: null, archived: [], lastRelation: null, lineageEvents: [] };
}

/** Las versiones de un linaje, en orden. Sin linaje (`null`) no hay ninguna. */
export function versionsOfLineage(versions: readonly ConsolidatedVersion[], lineage: LineageRef | null): readonly ConsolidatedVersion[] {
  if (lineage === null) return [];
  const wanted = new Set(lineage.hashes);
  return sortVersions(versions.filter((version) => wanted.has(version.hash)));
}

/** El estado tras consolidar `version` en el linaje activo: lo crea si es la primera versión. */
export function withConsolidated(state: LineageState, version: ConsolidatedVersion): LineageState {
  const active = state.active ?? { id: version.lineage, hashes: [] };
  return { ...state, active: { id: active.id, hashes: [...active.hashes, version.hash] } };
}

/** ¿Son el mismo linaje? Mismo identificador y misma cadena de hashes, en el mismo orden. */
export function sameLineage(a: LineageRef, b: LineageRef): boolean {
  return a.id === b.id && a.hashes.length === b.hashes.length && a.hashes.every((hash, index) => b.hashes[index] === hash);
}

/**
 * ¿Bloquea la bifurcación pendiente lo que trae este `.agvproj`? Sí cuando hay un linaje entrante
 * esperando decisión y la relación con el nuevo proyecto no es `identica` ni `sin-memoria`: adoptar
 * o sustituir el entrante sería decidir por la persona (R-MEM-002). Primero se resuelve la que hay.
 */
export function pendingForkBlocks(state: LineageState, relation: LineageRelation): boolean {
  return state.incoming !== null && relation !== "identica" && relation !== "sin-memoria";
}

/**
 * Aplica la relación con la memoria de un `.agvproj` abierto (§10). No decide nada por la persona:
 *
 * - `entrante-adelantada` adopta el linaje entrante como activo (la local era su prefijo, así que no se
 *   pierde ninguna decisión);
 * - `bifurcada` deja el entrante **esperando decisión** (`incoming`), y mientras tanto la consolidación
 *   queda bloqueada;
 * - las demás solo anotan la relación.
 *
 * `incoming` es el linaje **activo** del proyecto que se abre, no todas sus versiones: las de sus
 * linajes archivados no forman parte de su cadena. Con una bifurcación ya pendiente
 * (`pendingForkBlocks`), nada se adopta ni se sustituye: el estado se queda como está, solo con la
 * relación anotada, y quien llama lo dice.
 */
export function withIncoming(state: LineageState, relation: LineageRelation, incoming: LineageRef | null): LineageState {
  const ref = incoming === null || incoming.hashes.length === 0 ? null : incoming;
  if (pendingForkBlocks(state, relation)) {
    return { ...state, lastRelation: relation };
  }
  if (relation === "entrante-adelantada" && ref !== null) {
    return { ...state, active: ref, incoming: null, lastRelation: relation };
  }
  if (relation === "bifurcada" && ref !== null) {
    return { ...state, incoming: ref, lastRelation: relation };
  }
  return { ...state, lastRelation: relation };
}

/**
 * Añade como archivados los linajes archivados que trae un `.agvproj` y aquí no estaban: son
 * historia de otro dispositivo, no una decisión que tomar. No se repite uno que ya esté archivado,
 * ni se archiva el que aquí es el activo o el que espera decisión. Devuelve el estado y cuántos entraron.
 */
export function withArchivedLineages(state: LineageState, incoming: readonly LineageRef[]): { readonly state: LineageState; readonly added: number } {
  const present: LineageRef[] = [...state.archived, ...(state.active === null ? [] : [state.active]), ...(state.incoming === null ? [] : [state.incoming])];
  const added: LineageRef[] = [];
  for (const lineage of incoming) {
    if (lineage.hashes.length === 0) continue;
    if (present.some((known) => sameLineage(known, lineage)) || added.some((known) => sameLineage(known, lineage))) continue;
    added.push({ id: lineage.id, hashes: [...lineage.hashes] });
  }
  if (added.length === 0) return { state, added: 0 };
  return { state: { ...state, archived: [...state.archived, ...added] }, added: added.length };
}

// --- Verificación de una memoria que llega (§10, §11) ----------------------------------------------

/**
 * Qué falla en la cadena de un linaje, o `null` si es consistente. Cada hash del linaje tiene que
 * ser el de una versión presente, y cada `previousHash` tiene que apuntar a una versión **anterior
 * del mismo linaje**: la vigente al consolidar, que no es siempre la inmediata anterior porque la
 * anterior pudo estar revocada. La primera versión no tiene anterior; una posterior solo puede no
 * tenerla si todas las anteriores estaban revocadas. Y un linaje no puede tener dos versiones con el
 * mismo número (OQ-157, propietario 2026-09-27): el número lo da `nextVersionNumber` —uno más que el
 * mayor guardado, revocadas incluidas—, así que dos versiones vN con distinto hash en un mismo linaje
 * no las escribió esta regla, y se rechazan como cadena rota.
 */
export function lineageChainProblem(versions: readonly ConsolidatedVersion[], lineage: LineageRef): string | null {
  const byHash = new Map(versions.map((version) => [version.hash, version]));
  const seen = new Set<string>();
  const numbers = new Set<number>();
  for (let index = 0; index < lineage.hashes.length; index += 1) {
    const hash = lineage.hashes[index] as string;
    const version = byHash.get(hash);
    if (version === undefined) return `el linaje «${lineage.id}» apunta a una versión que no viene en el proyecto`;
    if (seen.has(hash)) return `el linaje «${lineage.id}» repite la versión v${version.version}`;
    if (numbers.has(version.version)) return `el linaje «${lineage.id}» tiene dos versiones v${version.version}`;
    numbers.add(version.version);
    if (index === 0) {
      if (version.previousHash !== null) return `la primera versión del linaje «${lineage.id}» (v${version.version}) declara una anterior`;
    } else if (version.previousHash === null) {
      const earlier = lineage.hashes.slice(0, index).map((previous) => byHash.get(previous) as ConsolidatedVersion);
      if (earlier.some((previous) => previous.revoked === null)) {
        return `la versión v${version.version} del linaje «${lineage.id}» no declara anterior y hay anteriores sin revocar`;
      }
    } else if (!seen.has(version.previousHash)) {
      return `la versión v${version.version} del linaje «${lineage.id}» no encadena con ninguna anterior del linaje`;
    }
    seen.add(hash);
  }
  return null;
}

/**
 * Qué versión no coincide con su propio hash al volver a calcularlo (`versionHash`), o `null` si todas
 * coinciden. Vale para cualquier versión escrita desde la primera consolidación (F4): la regla del
 * hash y `CANONICAL_VERSION` no han cambiado, y los campos añadidos después son opcionales y no se
 * escriben cuando faltan, así que una versión antigua vuelve a dar el hash con el que nació.
 */
export async function versionHashProblem(versions: readonly ConsolidatedVersion[]): Promise<string | null> {
  for (const version of versions) {
    if ((await versionHash(version)) !== version.hash) {
      return `la versión v${version.version} del linaje «${version.lineage}» no coincide con su hash`;
    }
  }
  return null;
}

/** Resuelve la bifurcación con la elección humana y la deja en el historial con su razón (§10). */
export function resolveFork(state: LineageState, choice: LineageEvent["choice"], reason: string, now: number): LineageState {
  if (state.incoming === null) {
    throw new Error("No hay ninguna bifurcación sin resolver.");
  }
  if (reason.trim() === "") {
    throw new Error("La elección de linaje necesita su justificación: queda en el historial (§10).");
  }
  const event: LineageEvent = { at: now, choice, reason };
  if (choice === "conservar-local") {
    return { ...state, incoming: null, archived: [...state.archived, state.incoming], lineageEvents: [...state.lineageEvents, event] };
  }
  return {
    ...state,
    active: state.incoming,
    incoming: null,
    archived: state.active === null ? state.archived : [...state.archived, state.active],
    lineageEvents: [...state.lineageEvents, event],
  };
}
