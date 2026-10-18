/**
 * El expediente de incidencia (F5, ADR-0018): su identidad, su ciclo de vida, su ventana y su
 * evidencia congelada.
 *
 * Un expediente es una **investigación**, no una exclusión: la incidencia excluida de F4
 * (`IncidentRecord` de `change-class.ts`) sigue siendo lo que la consolidación aparta del esperado, y
 * un expediente solo la **referencia** (D1). Vive aparte de la memoria normal (ADR-0006, R-INC-001):
 * nada de aquí escribe ni lee versiones, plano, revisión ni valores de planta.
 *
 * **Revisiones append-only (D2).** Cada vez que una persona guarda, nace la revisión `n+1` con el hash
 * de la anterior. Una revisión guarda solo lo humano —síntoma, ventana, estado, notas, razones— y
 * **referencias** a lo calculado: el hash del recorte, la versión consolidada aplicable, la
 * configuración y la aplicación. Lo calculado se reproduce desde ahí y no es una revisión.
 *
 * **El programa propone y la persona decide (D3, R-EVI-006).** Ninguna transición la hace el programa:
 * aquí solo se dice cuáles se pueden hacer y qué falta para las demás, y se construye la revisión
 * que una persona confirma.
 *
 * **Solo local (OQ-169).** Un solo dispositivo: no hay linaje ni bifurcaciones, y el identificador es
 * un contador legible por circuito y día.
 */

import type { CaseMetric, VerificationResult, VerificationThresholds } from "./case-verification.js";
import type { ConnectionCutThresholds } from "./connection-cuts.js";
import type { ConnectionEvent } from "./connection-log.js";
import type { Reading } from "./reading.js";
import type { RegimeThresholds } from "./segment-bands.js";
import { semanticHash } from "./semantic-hash.js";
import type { SnapshotEdge } from "./snapshot.js";

/** Forma de la revisión guardada. Subirla obliga a leer las anteriores sin perderlas. */
const CASE_SCHEMA_VERSION = 1;

/**
 * Versión del procedimiento que congela el recorte; viaja en cada revisión (`VERSIONING.md`).
 * `recorte-1` (3.74.0) congelaba solo las lecturas; `recorte-2` (3.75.0) añade los eventos de conexión
 * de la ventana y el contexto del retroceso. Los de `recorte-1` se siguen leyendo, sin contexto.
 */
const EVIDENCE_ALGORITHM = "recorte-2";

/** Estados del ciclo de vida (`INCIDENTS_REPORTING.md` §7, OQ-170). */
export type CaseState =
  | "Draft"
  | "UnderReview"
  | "Investigating"
  | "CountermeasurePlanned"
  | "VerificationPending"
  | "VerifiedEffective"
  | "VerifiedIneffective"
  | "Inconclusive"
  | "Closed"
  | "Discarded";

export const CASE_STATE_TEXT: Readonly<Record<CaseState, string>> = {
  Draft: "borrador",
  UnderReview: "en revisión",
  Investigating: "investigando",
  CountermeasurePlanned: "contramedida planificada",
  VerificationPending: "pendiente de verificar",
  VerifiedEffective: "verificada eficaz",
  VerifiedIneffective: "verificada ineficaz",
  Inconclusive: "no concluyente",
  Closed: "cerrado",
  Discarded: "descartado",
};

/** De dónde nace el expediente (D1). Una referencia, nunca una copia de lo referenciado. */
export type CaseOrigin =
  | { readonly kind: "sintoma" }
  /** Una incidencia de la batería de mediciones (R-AGV-021), por su clave «AGV tag instante». */
  | { readonly kind: "incidencia-medida"; readonly key: string; readonly label: string }
  /** Una incidencia excluida de una versión consolidada (R-INC-004). */
  | { readonly kind: "incidencia-excluida"; readonly version: number; readonly versionHash: string; readonly key: string; readonly label: string }
  /** Un hallazgo, por su clave de revisión (R-EVI-007). */
  | { readonly kind: "hallazgo"; readonly key: string; readonly label: string };

export interface CaseWindow {
  /** El síntoma, en UTC, los dos extremos incluidos. Lo fija la persona. */
  readonly symptomFrom: number;
  readonly symptomTo: number;
  /** Los márgenes. Los propone el programa (`proposeMargins`) y la persona los puede cambiar. */
  readonly marginBeforeMs: number;
  readonly marginAfterMs: number;
}

/** De dónde salió cada parte del recorte. */
export interface EvidenceSource {
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  readonly from: "retenidas" | "archivo";
  readonly readings: number;
}

/**
 * El resumen del recorte congelado que guarda la revisión. Las lecturas van aparte, por su hash: una
 * revisión nueva sin cambio de ventana no las copia otra vez.
 */
export interface EvidenceSummary {
  readonly algorithm: string;
  /** `null` si no hay ninguna lectura que congelar: el expediente queda sin recorte (`unknown`). */
  readonly hash: string | null;
  readonly readings: number;
  readonly vehicles: number;
  readonly sources: readonly EvidenceSource[];
  /** Ficheros cuya cobertura toca la ventana y cuyas lecturas ya no están: hay que volver a cargarlos. */
  readonly missing: readonly { readonly sourceId: string; readonly fileName: string }[];
  /** Eventos del registro de conexiones congelados (DS-013). Ausente en `recorte-1`. */
  readonly connections?: number;
  /** De dónde sale el contexto del retroceso, o `null` si no lo hay. Ausente en `recorte-1`. */
  readonly context?: CaseContextOrigin | null;
}

/** De dónde sale el contexto del retroceso: el esperado de una versión o, sin memoria, el fichero. */
export type CaseContextOrigin =
  | { readonly kind: "memoria"; readonly version: number; readonly hash: string }
  | { readonly kind: "instantanea"; readonly sourceId: string; readonly fileName: string };

/**
 * Lo que el retroceso (ALG-015) necesita además de las lecturas, congelado con ellas para que el
 * expediente se pueda volver a calcular igual aunque la memoria, las listas o la configuración cambien:
 * el anillo y las horquillas de sus tramos, cómo se separa la noche, los umbrales que usa y lo que planta
 * declara de cada tag.
 */
export interface CaseContext {
  readonly origin: CaseContextOrigin;
  readonly zone: string;
  /** El anillo en orden (el del esperado o el del fichero). */
  readonly ring: readonly string[];
  /** Las horquillas de los tramos del anillo, por régimen (R-FLO-007). */
  readonly edges: readonly SnapshotEdge[];
  readonly regimes: RegimeThresholds;
  /** Hueco sin lecturas de un AGV que cuenta como silencio (`silence.minGapMs`). */
  readonly silenceMinGapMs: number;
  /** Horas de arranque de turno (`silenceKind.shiftStartHours`). */
  readonly shiftStartHours: readonly number[];
  /** Pasos mínimos para dar una mediana de paso por un tag (`franjas.minPositionSamples`). */
  readonly minMedianSamples: number;
  readonly connectionCuts: ConnectionCutThresholds;
  /** Lo declarado en planta por tag (R-GRA-022), tal como lo enseña el análisis. */
  readonly declared: Readonly<Record<string, string>>;
}

/** Un evento del registro de conexiones congelado, con la huella de su fichero (procedencia). */
export type FrozenConnection = ConnectionEvent & { readonly sourceHash: string };

/** Lo que se guarda por hash en `incidentEvidence`. */
export interface FrozenEvidence {
  readonly readings: readonly Reading[];
  readonly connections: readonly FrozenConnection[];
  readonly context: CaseContext | null;
}

/**
 * Los eventos de conexión que hacen falta para la ventana: los de dentro y, por AGV, el último de antes
 * y el primero de después, para saber si un corte ya estaba abierto al empezar o se cierra al acabar.
 * Sin un margen inventado.
 */
function selectConnections(events: readonly FrozenConnection[], span: { readonly from: number; readonly to: number }): readonly FrozenConnection[] {
  const kept = new Set<FrozenConnection>();
  const before = new Map<string, FrozenConnection>();
  const after = new Map<string, FrozenConnection>();
  for (const event of events) {
    if (event.utcMs >= span.from && event.utcMs <= span.to) kept.add(event);
    else if (event.utcMs < span.from) {
      const known = before.get(event.agvId);
      if (known === undefined || event.utcMs > known.utcMs) before.set(event.agvId, event);
    } else {
      const known = after.get(event.agvId);
      if (known === undefined || event.utcMs < known.utcMs) after.set(event.agvId, event);
    }
  }
  for (const event of [...before.values(), ...after.values()]) kept.add(event);
  return [...kept].sort((a, b) => a.utcMs - b.utcMs || compareText(a.agvId, b.agvId) || a.sourceRow - b.sourceRow);
}

/** Un recorte guardado, de cualquiera de las dos formas: `recorte-1` era solo la lista de lecturas. */
export function normalizeEvidence(stored: readonly Reading[] | FrozenEvidence): FrozenEvidence {
  return Array.isArray(stored) ? { readings: stored as readonly Reading[], connections: [], context: null } : (stored as FrozenEvidence);
}

/** Lo que una persona decide sobre una hipótesis (D6): confirmarla con su comprobación, o descartarla. */
export interface HypothesisDecision {
  readonly state: "confirmada" | "descartada";
  /** La comprobación hecha (al confirmar) o la razón (al descartar). Obligatoria. */
  readonly note: string;
  readonly at: number;
}

/**
 * Una hipótesis guardada en la revisión: las que escribe la persona y las del programa **sobre las que
 * una persona decidió**. Las del programa sin decisión no se guardan: se recalculan desde el recorte
 * (`case-hypotheses.ts`). Se identifican por su clave, así que la decisión sobrevive a recalcular.
 */
export interface Hypothesis {
  readonly key: string;
  readonly text: string;
  readonly origin: "persona" | "programa";
  readonly decision: HypothesisDecision | null;
}

/** Una contramedida (D9). La métrica se fija al planificarla y no cambia. */
export interface Countermeasure {
  readonly id: string;
  readonly action: string;
  readonly owner: string;
  readonly plannedAt: number;
  readonly appliedAt: number | null;
  readonly risk: string;
  readonly metric: CaseMetric;
}

/** Una verificación registrada: lo medido con la versión del procedimiento, para la contramedida dada. */
export interface Verification {
  readonly countermeasureId: string;
  readonly recordedAt: number;
  readonly result: VerificationResult;
}

/** Qué cambió una revisión, en palabras y por tipo. */
export interface CaseChange {
  readonly kind: "creado" | "estado" | "nota" | "ventana" | "hipotesis" | "contramedida" | "verificacion";
  readonly text: string;
}

export interface CaseRevision {
  readonly schemaVersion: number;
  readonly circuitId: string;
  readonly caseId: string;
  /** 1, 2, 3… */
  readonly revision: number;
  readonly createdAt: number;
  /** Nombre opcional, solo local (D2). */
  readonly author: string | null;
  readonly previousHash: string | null;
  /** Hash semántico de la revisión sin este campo. */
  readonly hash: string;
  readonly change: CaseChange;
  readonly state: CaseState;
  /** La razón del último cambio de estado que la exige (descartar, no concluyente, reabrir). */
  readonly stateReason: string | null;
  readonly title: string;
  readonly symptom: string;
  readonly origin: CaseOrigin;
  /** AGV del síntoma, si es de uno. */
  readonly agvId: string | null;
  /** Tags que nombra el síntoma, si nombra alguno. */
  readonly tagIds: readonly string[];
  readonly window: CaseWindow;
  readonly evidence: EvidenceSummary;
  readonly references: {
    /** La versión consolidada vigente al crear o al cambiar la ventana: de ahí saldrá el esperado. */
    readonly memory: { readonly version: number; readonly hash: string } | null;
    readonly configVersion: string;
    readonly appVersion: string;
  };
  readonly notes: readonly { readonly at: number; readonly text: string }[];
  readonly hypotheses: readonly Hypothesis[];
  readonly countermeasures: readonly Countermeasure[];
  readonly verification: Verification | null;
  readonly conclusion: string | null;
}

/** Un expediente es la lista de sus revisiones; la vigente es la última. */
export function currentRevision(revisions: readonly CaseRevision[]): CaseRevision {
  const last = [...revisions].sort((a, b) => a.revision - b.revision).at(-1);
  if (last === undefined) throw new Error("Un expediente sin revisiones no existe.");
  return last;
}

/** Una acción que no vale: el motivo y qué hacer, para decirlo tal cual en la interfaz. */
export class CaseRefusal extends Error {
  constructor(
    readonly reason: string,
    readonly recovery: string,
  ) {
    super(reason);
    this.name = "CaseRefusal";
  }
}

// --- Identidad ------------------------------------------------------------------------------------

/**
 * `INC-<circuito>-<aaaammdd>-<nn>` (OQ-169): el día de creación en la zona del circuito y un contador
 * por circuito y día, a partir de los que ya existen. Con un solo dispositivo no choca.
 */
export function nextCaseId(circuitId: string, now: number, zone: string, existing: readonly string[]): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const of = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "00";
  const prefix = `INC-${circuitId}-${of("year")}${of("month")}${of("day")}-`;
  const used = existing
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number.parseInt(id.slice(prefix.length), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  const next = (used.length === 0 ? 0 : Math.max(...used)) + 1;
  return `${prefix}${String(next).padStart(2, "0")}`;
}

// --- Ventana --------------------------------------------------------------------------------------

export interface MarginThresholds {
  /** Margen mínimo antes del síntoma (`incident_case.min_margin_before_ms`). */
  readonly minMarginBeforeMs: number;
  /** Margen mínimo después del síntoma (`incident_case.min_margin_after_ms`). */
  readonly minMarginAfterMs: number;
}

/** La configuración del expediente: márgenes (D4) y verificación de contramedidas (D9). */
export interface CaseThresholds extends MarginThresholds {
  readonly verification: VerificationThresholds;
  /** Cuántas veces más larga puede ser la duración de otro síntoma para ser parecida (D10, ALG-017). */
  readonly similarityDurationRatio: number;
}

/**
 * Los márgenes que propone el programa (D4, OQ-P02): antes, el mayor del mínimo, la duración del
 * síntoma y la vuelta mediana —el retroceso necesita ver pasar al menos una vez a cada AGV por aguas
 * arriba—; después, el mayor del mínimo y la duración del síntoma, para ver la recuperación. Sin vuelta
 * medida, no cuenta: no se inventa.
 */
export function proposeMargins(
  symptom: { readonly from: number; readonly to: number },
  lapMs: number | null,
  thresholds: MarginThresholds,
): { readonly marginBeforeMs: number; readonly marginAfterMs: number; readonly reason: string } {
  const duration = Math.max(0, symptom.to - symptom.from);
  const before = Math.max(thresholds.minMarginBeforeMs, duration, lapMs ?? 0);
  const after = Math.max(thresholds.minMarginAfterMs, duration);
  const why =
    before === lapMs && lapMs !== thresholds.minMarginBeforeMs && lapMs !== duration
      ? "antes, una vuelta mediana del circuito"
      : before === duration && duration !== thresholds.minMarginBeforeMs
        ? "antes, lo que dura el síntoma"
        : "antes, el mínimo configurado";
  const whyAfter = after === duration && duration !== thresholds.minMarginAfterMs ? "después, lo que dura el síntoma" : "después, el mínimo configurado";
  return { marginBeforeMs: before, marginAfterMs: after, reason: `${why}; ${whyAfter}${lapMs === null ? " (sin vuelta medida)" : ""}` };
}

/** La ventana completa del expediente: el síntoma con sus márgenes. */
export function caseSpan(window: CaseWindow): { readonly from: number; readonly to: number } {
  return { from: window.symptomFrom - window.marginBeforeMs, to: window.symptomTo + window.marginAfterMs };
}

/** Comprueba una ventana antes de aceptarla; lanza `CaseRefusal` con el motivo. */
export function checkWindow(window: CaseWindow): void {
  const numbers = [window.symptomFrom, window.symptomTo, window.marginBeforeMs, window.marginAfterMs];
  if (!numbers.every((value) => Number.isFinite(value))) {
    throw new CaseRefusal("La ventana del síntoma no tiene principio y fin válidos.", "Escribe el principio y el fin del síntoma.");
  }
  if (window.symptomTo < window.symptomFrom) {
    throw new CaseRefusal("El fin del síntoma es anterior a su principio.", "Corrige el principio o el fin.");
  }
  if (window.marginBeforeMs < 0 || window.marginAfterMs < 0) {
    throw new CaseRefusal("Un margen no puede ser negativo.", "Escribe márgenes de cero minutos o más.");
  }
}

// --- Recorte congelado ------------------------------------------------------------------------------

/** Lo que el Worker sabe de cada fuente del circuito para congelar el recorte. */
export interface EvidenceCandidate {
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly fileName: string;
  /** Tramo analizable de la fuente, o `null` si no lo tiene. */
  readonly complete: { readonly from: number; readonly to: number } | null;
  /** Sus lecturas, si se pueden obtener (retenidas o del archivo); `null` si no. */
  readonly readings: readonly Reading[] | null;
  readonly from: "retenidas" | "archivo" | null;
}

/**
 * Congela el recorte (D4): las lecturas de **todos** los AGV del circuito dentro de la ventana con
 * márgenes, con su procedencia, sin repetir la misma lectura que traen dos exportaciones que se
 * solapan (misma procedencia de fila, o mismo AGV, tag e instante). Nunca se completa nada: una fuente
 * cuya cobertura toca la ventana y cuyas lecturas no están queda en `missing`.
 */
export async function freezeEvidence(
  candidates: readonly EvidenceCandidate[],
  span: { readonly from: number; readonly to: number },
  extras: { readonly connections: readonly FrozenConnection[]; readonly context: CaseContext | null } = { connections: [], context: null },
): Promise<{ readonly summary: EvidenceSummary; readonly evidence: FrozenEvidence }> {
  const touches = (complete: EvidenceCandidate["complete"]): boolean => complete !== null && complete.from <= span.to && complete.to >= span.from;
  const seen = new Set<string>();
  const kept: Reading[] = [];
  const sources: EvidenceSource[] = [];
  const missing: { sourceId: string; fileName: string }[] = [];
  for (const candidate of candidates) {
    if (candidate.readings === null || candidate.from === null) {
      if (touches(candidate.complete)) missing.push({ sourceId: candidate.sourceId, fileName: candidate.fileName });
      continue;
    }
    let count = 0;
    for (const reading of candidate.readings) {
      const at = reading.time.utcMs;
      if (at < span.from || at > span.to) continue;
      const same = `${reading.agvId}\u0000${reading.tagId}\u0000${at}\u0000${reading.time.raw}`;
      if (seen.has(same)) continue;
      seen.add(same);
      kept.push(plainReading(reading));
      count += 1;
    }
    if (count > 0) sources.push({ sourceId: candidate.sourceId, sourceHash: candidate.sourceHash, fileName: candidate.fileName, from: candidate.from, readings: count });
  }
  kept.sort((a, b) => a.time.utcMs - b.time.utcMs || compareText(a.agvId, b.agvId) || compareText(a.tagId, b.tagId) || a.provenance.sourceRow - b.provenance.sourceRow);
  const vehicles = new Set(kept.map((reading) => reading.agvId)).size;
  const connections = selectConnections(extras.connections, span);
  const evidence: FrozenEvidence = { readings: kept, connections, context: extras.context };
  // Sin lecturas no hay recorte: lo que pasó en la ventana es desconocido, haya o no contexto.
  const hash = kept.length === 0 ? null : await evidenceHash(evidence);
  return {
    summary: {
      algorithm: EVIDENCE_ALGORITHM,
      hash,
      readings: kept.length,
      vehicles,
      sources,
      missing,
      connections: connections.length,
      context: extras.context?.origin ?? null,
    },
    evidence,
  };
}

/** El hash del recorte: de las lecturas, los eventos de conexión y el contexto, tal como se guardan. */
export function evidenceHash(evidence: FrozenEvidence): Promise<string> {
  return semanticHash({ readings: evidence.readings.map(plainReading), connections: evidence.connections, context: evidence.context });
}

/** La lectura sin campos accesorios (`alsoFrom` de la unión): solo lo que define la observación. */
function plainReading(reading: Reading): Reading {
  return {
    time: { ...reading.time },
    agvId: reading.agvId,
    tagId: reading.tagId,
    provenance: { sourceId: reading.provenance.sourceId, sourceHash: reading.provenance.sourceHash, sourceRow: reading.provenance.sourceRow },
  };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- Creación y revisiones ------------------------------------------------------------------------

export interface CreateCaseInput {
  readonly circuitId: string;
  readonly caseId: string;
  readonly now: number;
  readonly author: string | null;
  readonly title: string;
  readonly symptom: string;
  readonly origin: CaseOrigin;
  readonly agvId: string | null;
  readonly tagIds: readonly string[];
  readonly window: CaseWindow;
  readonly evidence: EvidenceSummary;
  readonly references: CaseRevision["references"];
}

/** Comprueba título y síntoma antes de crear; lanza `CaseRefusal` con el motivo. */
export function checkCaseText(title: string, symptom: string): void {
  if (title.trim() === "") throw new CaseRefusal("El expediente necesita un título.", "Escribe en pocas palabras qué ocurrió.");
  if (symptom.trim() === "") throw new CaseRefusal("El expediente necesita el síntoma: qué ocurrió, dónde y cuándo.", "Descríbelo con tus palabras.");
}

/** La revisión 1, en `Draft`. Exige título, síntoma y ventana válida (D3). */
export async function createCase(input: CreateCaseInput): Promise<CaseRevision> {
  checkCaseText(input.title, input.symptom);
  checkWindow(input.window);
  const title = input.title.trim();
  const symptom = input.symptom.trim();
  return seal({
    schemaVersion: CASE_SCHEMA_VERSION,
    circuitId: input.circuitId,
    caseId: input.caseId,
    revision: 1,
    createdAt: input.now,
    author: cleanAuthor(input.author),
    previousHash: null,
    hash: "",
    change: { kind: "creado", text: `Creado desde ${originText(input.origin)}.` },
    state: "Draft",
    stateReason: null,
    title,
    symptom,
    origin: input.origin,
    agvId: input.agvId,
    tagIds: [...new Set(input.tagIds)].sort(compareText),
    window: input.window,
    evidence: input.evidence,
    references: input.references,
    notes: [],
    hypotheses: [],
    countermeasures: [],
    verification: null,
    conclusion: null,
  });
}

/** El hash de una revisión: su contenido sin el propio hash. */
function revisionHash(revision: CaseRevision): Promise<string> {
  return semanticHash({ ...revision, hash: "" });
}

async function seal(revision: CaseRevision): Promise<CaseRevision> {
  return { ...revision, hash: await revisionHash(revision) };
}

/** La revisión siguiente a `previous`, con lo que cambia, sellada y encadenada. */
async function next(previous: CaseRevision, now: number, author: string | null, changes: Partial<CaseRevision> & { readonly change: CaseChange }): Promise<CaseRevision> {
  if (now < previous.createdAt) {
    throw new CaseRefusal("La revisión nueva sería anterior a la vigente.", "Comprueba el reloj del dispositivo.");
  }
  return seal({ ...previous, ...changes, revision: previous.revision + 1, createdAt: now, author: cleanAuthor(author), previousHash: previous.hash, hash: "" });
}

/** Añade una nota: una revisión nueva, sin cambio de estado. */
export async function addNote(previous: CaseRevision, text: string, now: number, author: string | null): Promise<CaseRevision> {
  const note = text.trim();
  if (note === "") throw new CaseRefusal("La nota está vacía.", "Escribe la nota.");
  if (isFinal(previous.state)) throw new CaseRefusal(`Un expediente ${CASE_STATE_TEXT[previous.state]} no admite notas.`, "Reábrelo si hay evidencia nueva.");
  return next(previous, now, author, { change: { kind: "nota", text: "Nota añadida." }, notes: [...previous.notes, { at: now, text: note }] });
}

/**
 * Cambia la ventana y el recorte congelado. Solo en `Draft`: pasar a revisión es confirmar los márgenes
 * (D3), y después la ventana es la de la investigación.
 */
export async function changeWindow(
  previous: CaseRevision,
  window: CaseWindow,
  evidence: EvidenceSummary,
  references: CaseRevision["references"],
  now: number,
  author: string | null,
): Promise<CaseRevision> {
  if (previous.state !== "Draft") {
    throw new CaseRefusal("La ventana solo se cambia en borrador: al pasar a revisión quedó confirmada.", "Si hace falta otra ventana, abre otro expediente.");
  }
  checkWindow(window);
  return next(previous, now, author, { change: { kind: "ventana", text: "Ventana y recorte cambiados." }, window, evidence, references });
}

// --- Ciclo de vida (D3) ---------------------------------------------------------------------------

/** Qué tiene que escribir la persona para hacer la transición. */
export type TransitionInput = "razon" | "falta" | "evidencia-nueva" | "conclusion" | null;

export interface TransitionOption {
  readonly to: CaseState;
  /** Lo que falta en el expediente; vacío si se puede hacer ya. */
  readonly unmet: readonly string[];
  readonly input: TransitionInput;
  readonly inputLabel: string | null;
}

/**
 * Lo que las reglas necesitan saber y la revisión no guarda: cuántas hipótesis siguen en pie (las del
 * programa no contradichas, las de la persona, y ninguna descartada). Lo calcula quien tiene el recorte
 * (`case-hypotheses.ts`); sin él, solo cuentan las de la persona y las confirmadas.
 */
export interface CaseAnalysis {
  readonly viableHypotheses: number;
}

function viableStored(revision: CaseRevision): number {
  return revision.hypotheses.filter((hypothesis) =>
    hypothesis.decision === null ? hypothesis.origin === "persona" : hypothesis.decision.state === "confirmada",
  ).length;
}

interface Rule {
  readonly from: readonly CaseState[];
  readonly to: CaseState;
  readonly input: TransitionInput;
  readonly inputLabel: string | null;
  readonly check: (revision: CaseRevision, analysis: CaseAnalysis) => readonly string[];
}

const NONE = (): readonly string[] => [];

const RULES: readonly Rule[] = [
  {
    from: ["Draft"],
    to: "UnderReview",
    input: null,
    inputLabel: null,
    // Pasar a revisión es confirmar los márgenes; el recorte puede faltar, y entonces se dice.
    check: NONE,
  },
  { from: ["UnderReview"], to: "Investigating", input: null, inputLabel: null, check: NONE },
  {
    from: ["Investigating"],
    to: "CountermeasurePlanned",
    input: null,
    inputLabel: null,
    check: (revision, analysis) => [
      ...(analysis.viableHypotheses > 0 ? [] : ["al menos una hipótesis que nada contradiga"]),
      ...(revision.countermeasures.some((measure) => measure.action.trim() !== "" && measure.owner.trim() !== "")
        ? []
        : ["una contramedida con responsable y fecha"]),
    ],
  },
  {
    from: ["CountermeasurePlanned"],
    to: "VerificationPending",
    input: null,
    inputLabel: null,
    check: (revision) =>
      revision.countermeasures.some((measure) => measure.appliedAt !== null)
        ? []
        : ["la fecha de aplicación de la contramedida"],
  },
  {
    from: ["VerificationPending"],
    to: "VerifiedEffective",
    input: "conclusion",
    inputLabel: "Conclusión de la verificación",
    check: (revision) => (revision.verification === null ? ["un periodo posterior cargado con la métrica calculada"] : []),
  },
  {
    from: ["VerificationPending"],
    to: "VerifiedIneffective",
    input: "conclusion",
    inputLabel: "Conclusión de la verificación",
    check: (revision) => (revision.verification === null ? ["un periodo posterior cargado con la métrica calculada"] : []),
  },
  { from: ["VerifiedIneffective"], to: "Investigating", input: null, inputLabel: null, check: NONE },
  { from: ["Investigating"], to: "Inconclusive", input: "falta", inputLabel: "Qué evidencia falta", check: NONE },
  { from: ["VerifiedEffective"], to: "Closed", input: "conclusion", inputLabel: "Conclusión", check: NONE },
  // OQ-170: descartar («no es una incidencia») y reabrir con evidencia nueva.
  { from: ["Draft", "UnderReview"], to: "Discarded", input: "razon", inputLabel: "Por qué no es una incidencia", check: NONE },
  { from: ["Closed", "Inconclusive"], to: "Investigating", input: "evidencia-nueva", inputLabel: "Qué evidencia nueva lo reabre", check: NONE },
];

/** `Closed` y `Discarded` no admiten notas; `Closed` se reabre, `Discarded` no. */
function isFinal(state: CaseState): boolean {
  return state === "Closed" || state === "Discarded";
}

/** Las transiciones posibles desde el estado vigente, con lo que falta para cada una. */
export function transitionsFrom(revision: CaseRevision, analysis?: CaseAnalysis): readonly TransitionOption[] {
  const known = analysis ?? { viableHypotheses: viableStored(revision) };
  return RULES.filter((rule) => rule.from.includes(revision.state)).map((rule) => ({
    to: rule.to,
    unmet: rule.check(revision, known),
    input: rule.input,
    inputLabel: rule.inputLabel,
  }));
}

/**
 * Hace la transición que una persona confirmó. Lanza `CaseRefusal` si no existe desde el estado
 * vigente, si falta algo del expediente o si falta el texto que exige.
 */
export async function transition(
  previous: CaseRevision,
  to: CaseState,
  text: string | null,
  now: number,
  author: string | null,
  analysis?: CaseAnalysis,
): Promise<CaseRevision> {
  const option = transitionsFrom(previous, analysis).find((entry) => entry.to === to);
  if (option === undefined) {
    throw new CaseRefusal(
      `Un expediente ${CASE_STATE_TEXT[previous.state]} no pasa a ${CASE_STATE_TEXT[to]}.`,
      "Elige uno de los cambios de estado que se ofrecen.",
    );
  }
  if (option.unmet.length > 0) {
    throw new CaseRefusal(`Para pasar a ${CASE_STATE_TEXT[to]} falta ${option.unmet.join(" y ")}.`, "Complétalo en el expediente y vuelve a intentarlo.");
  }
  const written = (text ?? "").trim();
  if (option.input !== null && written === "") {
    throw new CaseRefusal(`Para pasar a ${CASE_STATE_TEXT[to]} hay que escribir: ${(option.inputLabel ?? "").toLowerCase()}.`, "Escríbelo y vuelve a intentarlo.");
  }
  const reopened = (previous.state === "Closed" || previous.state === "Inconclusive") && to === "Investigating";
  return next(previous, now, author, {
    change: {
      kind: "estado",
      text: `${reopened ? "Reabierto" : "Estado"}: de ${CASE_STATE_TEXT[previous.state]} a ${CASE_STATE_TEXT[to]}.`,
    },
    state: to,
    stateReason: option.input === null ? null : written,
    ...(option.input === "conclusion" ? { conclusion: written } : {}),
  });
}

// --- Hipótesis, contramedidas y verificación (D6, D9) -----------------------------------------------

/** Estados en que se investiga: se pueden añadir hipótesis y contramedidas. */
const WORKING: readonly CaseState[] = ["Investigating", "CountermeasurePlanned", "VerificationPending", "VerifiedIneffective"];

function requireWorking(previous: CaseRevision, what: string): void {
  if (!WORKING.includes(previous.state)) {
    throw new CaseRefusal(`Un expediente ${CASE_STATE_TEXT[previous.state]} no admite ${what}.`, "Pásalo a «investigando» primero.");
  }
}

/** Añade una hipótesis escrita por la persona. */
export async function addHypothesis(previous: CaseRevision, text: string, now: number, author: string | null): Promise<CaseRevision> {
  requireWorking(previous, "hipótesis nuevas");
  const written = text.trim();
  if (written === "") throw new CaseRefusal("La hipótesis está vacía.", "Escribe la hipótesis.");
  const n = previous.hypotheses.filter((hypothesis) => hypothesis.origin === "persona").length + 1;
  return next(previous, now, author, {
    change: { kind: "hipotesis", text: `Hipótesis añadida: ${written}` },
    hypotheses: [...previous.hypotheses, { key: `persona|${n}`, text: written, origin: "persona", decision: null }],
  });
}

/**
 * Lo que una persona decide sobre una hipótesis (D6): confirmarla —con la comprobación que hizo— o
 * descartarla —con su razón—. Una del programa se guarda entonces con su texto; la decisión no cambia la
 * evidencia, se añade a ella (R-EVI-005).
 */
export async function decideHypothesis(
  previous: CaseRevision,
  input: { readonly key: string; readonly text: string; readonly state: HypothesisDecision["state"]; readonly note: string },
  now: number,
  author: string | null,
): Promise<CaseRevision> {
  requireWorking(previous, "decisiones sobre hipótesis");
  const note = input.note.trim();
  if (note === "") {
    throw new CaseRefusal(
      input.state === "confirmada" ? "Para confirmar una hipótesis hay que escribir la comprobación que se hizo." : "Para descartar una hipótesis hay que escribir por qué.",
      "Escríbelo y vuelve a intentarlo.",
    );
  }
  const decision: HypothesisDecision = { state: input.state, note, at: now };
  const known = previous.hypotheses.find((hypothesis) => hypothesis.key === input.key);
  const hypotheses = known === undefined
    ? [...previous.hypotheses, { key: input.key, text: input.text.trim(), origin: "programa" as const, decision }]
    : previous.hypotheses.map((hypothesis) => (hypothesis.key === input.key ? { ...hypothesis, decision } : hypothesis));
  const text = (known?.text ?? input.text).trim();
  return next(previous, now, author, {
    change: { kind: "hipotesis", text: `Hipótesis ${input.state === "confirmada" ? "confirmada por una persona" : "descartada"}: ${text}` },
    hypotheses,
  });
}

/** Añade una contramedida con su métrica, que no cambia después (D9). */
export async function addCountermeasure(
  previous: CaseRevision,
  input: { readonly action: string; readonly owner: string; readonly plannedAt: number; readonly risk: string; readonly metric: CaseMetric },
  now: number,
  author: string | null,
): Promise<CaseRevision> {
  requireWorking(previous, "contramedidas nuevas");
  const action = input.action.trim();
  const owner = input.owner.trim();
  if (action === "" || owner === "") throw new CaseRefusal("Una contramedida necesita la acción y su responsable.", "Escribe las dos.");
  if (!Number.isFinite(input.plannedAt)) throw new CaseRefusal("Una contramedida necesita su fecha prevista.", "Escríbela.");
  if (!(input.metric.minGapMs > 0)) throw new CaseRefusal("La métrica necesita una duración mayor que cero.", "Corrígela.");
  const id = `C${previous.countermeasures.length + 1}`;
  return next(previous, now, author, {
    change: { kind: "contramedida", text: `Contramedida ${id} planificada: ${action} (${owner}).` },
    countermeasures: [...previous.countermeasures, { id, action, owner, plannedAt: input.plannedAt, appliedAt: null, risk: input.risk.trim(), metric: input.metric }],
  });
}

/** Registra cuándo se aplicó una contramedida. Una vez aplicada, la fecha no cambia. */
export async function applyCountermeasure(previous: CaseRevision, id: string, appliedAt: number, now: number, author: string | null): Promise<CaseRevision> {
  requireWorking(previous, "cambios en contramedidas");
  const measure = previous.countermeasures.find((entry) => entry.id === id);
  if (measure === undefined) throw new CaseRefusal(`La contramedida ${id} no está en el expediente.`, "Vuelve a mirarlo.");
  if (measure.appliedAt !== null) throw new CaseRefusal(`La contramedida ${id} ya consta como aplicada.`, "Si se volvió a aplicar, planifica otra.");
  if (!Number.isFinite(appliedAt)) throw new CaseRefusal("Falta la fecha de aplicación.", "Escríbela.");
  return next(previous, now, author, {
    change: { kind: "contramedida", text: `Contramedida ${id} aplicada.` },
    countermeasures: previous.countermeasures.map((entry) => (entry.id === id ? { ...entry, appliedAt } : entry)),
  });
}

/**
 * Registra la verificación medida de una contramedida aplicada. Solo pendiente de verificar; la
 * conclusión llega con el cambio de estado, y la escribe una persona (R-INC-003).
 */
export async function recordVerification(previous: CaseRevision, result: VerificationResult, countermeasureId: string, now: number, author: string | null): Promise<CaseRevision> {
  if (previous.state !== "VerificationPending") {
    throw new CaseRefusal("La verificación se registra con el expediente pendiente de verificar.", "Pasa el expediente a «pendiente de verificar».");
  }
  const measure = previous.countermeasures.find((entry) => entry.id === countermeasureId);
  if (measure === undefined || measure.appliedAt === null) throw new CaseRefusal(`La contramedida ${countermeasureId} no consta como aplicada.`, "Registra antes su fecha de aplicación.");
  return next(previous, now, author, {
    change: { kind: "verificacion", text: `Verificación de ${countermeasureId} registrada (${result.verdict === "sin-exposicion" ? "sin exposición suficiente" : `propuesta: ${result.verdict}`}).` },
    verification: { countermeasureId, recordedAt: now, result },
  });
}

// --- Integridad ---------------------------------------------------------------------------------------

/**
 * Comprueba la cadena de un expediente: revisiones 1…n sin huecos, cada una con el hash de la anterior
 * y su propio hash correcto. Devuelve los problemas en palabras; vacío si está entera.
 */
export async function verifyChain(revisions: readonly CaseRevision[]): Promise<readonly string[]> {
  const sorted = [...revisions].sort((a, b) => a.revision - b.revision);
  const problems: string[] = [];
  for (const [index, revision] of sorted.entries()) {
    if (revision.revision !== index + 1) problems.push(`falta la revisión ${index + 1}`);
    const previous = index === 0 ? null : (sorted[index - 1] as CaseRevision).hash;
    if (revision.previousHash !== previous) problems.push(`la revisión ${revision.revision} no enlaza con la anterior`);
    if ((await revisionHash(revision)) !== revision.hash) problems.push(`la revisión ${revision.revision} no coincide con su hash`);
  }
  return problems;
}

// --- Texto ----------------------------------------------------------------------------------------------

/** De dónde sale el contexto del retroceso, en palabras. */
export function contextText(origin: CaseContextOrigin | null | undefined): string {
  if (origin === undefined) return "Recorte anterior a 3.75.0: sin el anillo ni las horquillas congelados.";
  if (origin === null) return "Sin anillo ni horquillas: ni versión consolidada ni instantánea del fichero que cubra la ventana.";
  return origin.kind === "memoria"
    ? `Anillo y horquillas del esperado de la versión consolidada v${origin.version}.`
    : `Anillo y horquillas del propio fichero «${origin.fileName}», sin esperado consolidado.`;
}

export function originText(origin: CaseOrigin): string {
  switch (origin.kind) {
    case "sintoma":
      return "un síntoma descrito a mano";
    case "incidencia-medida":
      return `la incidencia medida ${origin.label}`;
    case "incidencia-excluida":
      return `la incidencia excluida de v${origin.version}: ${origin.label}`;
    case "hallazgo":
      return `el hallazgo ${origin.label}`;
  }
}

/** Lo que se sabe del recorte, en una frase. Nunca calla lo que falta. */
export function evidenceText(evidence: EvidenceSummary): string {
  const missing =
    evidence.missing.length === 0
      ? ""
      : ` Faltan las lecturas de ${evidence.missing.map((entry) => `«${entry.fileName}»`).join(", ")}: vuelve a cargar ${evidence.missing.length === 1 ? "ese fichero" : "esos ficheros"} y abre otro expediente o cambia la ventana en borrador.`;
  if (evidence.hash === null) return `Sin recorte: no hay lecturas guardadas en la ventana, así que lo que pasó en ella es desconocido.${missing}`;
  const files = evidence.sources.map((source) => `«${source.fileName}» (${source.from === "retenidas" ? "lecturas retenidas" : "original archivado"})`).join(", ");
  const connections =
    evidence.connections === undefined
      ? ""
      : evidence.connections === 0
        ? " Sin registro de conexiones del terminal en la ventana."
        : ` Con ${evidence.connections.toLocaleString("es-ES")} ${evidence.connections === 1 ? "evento" : "eventos"} del registro de conexiones del terminal.`;
  return `${evidence.readings.toLocaleString("es-ES")} ${evidence.readings === 1 ? "lectura" : "lecturas"} de ${evidence.vehicles.toLocaleString("es-ES")} AGV, congeladas de ${files}.${connections}${missing}`;
}

function cleanAuthor(author: string | null): string | null {
  const trimmed = (author ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Palabras que afirman causa (D6). El texto que genera el programa no las usa: solo una persona
 * confirma una causa, y eso lo escribe ella. La prueba de lenguaje recorre los textos de este módulo.
 */
const CAUSAL_VOCABULARY: readonly RegExp[] = [
  "causa",
  "causas",
  "causado",
  "causada",
  "causó",
  "causaron",
  "provoca",
  "provocó",
  "provocaron",
  "provocado",
  "provocada",
  "debido a",
  "por culpa de",
  "el origen es",
].map((phrase) => new RegExp(`(?<!\\p{L})${phrase}(?!\\p{L})`, "iu"));

/** Las palabras causales que contiene un texto, para la prueba de lenguaje. */
export function causalWordsIn(text: string): readonly string[] {
  return CAUSAL_VOCABULARY.flatMap((pattern) => {
    const match = pattern.exec(text);
    return match === null ? [] : [match[0]];
  });
}
