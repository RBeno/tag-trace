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
 * **Solo local (OQ-167).** Un solo dispositivo: no hay linaje ni bifurcaciones, y el identificador es
 * un contador legible por circuito y día.
 */

import { semanticHash } from "./semantic-hash.js";
import type { Reading } from "./reading.js";

/** Forma de la revisión guardada. Subirla obliga a leer las anteriores sin perderlas. */
export const CASE_SCHEMA_VERSION = 1;

/** Versión del procedimiento que congela el recorte; viaja en cada revisión (`VERSIONING.md`). */
export const EVIDENCE_ALGORITHM = "recorte-1";

/** Estados del ciclo de vida (`INCIDENTS_REPORTING.md` §7, OQ-168). */
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
}

/** Placeholders del modelo para el ciclo de vida; se rellenan desde la entrega 4 (D9). */
export interface Hypothesis {
  readonly text: string;
  readonly status: "abierta" | "compatible" | "contradicha" | "confirmada" | "descartada";
}

export interface Countermeasure {
  readonly action: string;
  readonly owner: string;
  readonly plannedAt: number;
  readonly appliedAt: number | null;
  readonly metric: string | null;
}

export interface Verification {
  readonly afterFrom: number;
  readonly afterTo: number;
  readonly conclusion: string;
}

/** Qué cambió una revisión, en palabras y por tipo. */
export interface CaseChange {
  readonly kind: "creado" | "estado" | "nota" | "ventana";
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
 * `INC-<circuito>-<aaaammdd>-<nn>` (OQ-167): el día de creación en la zona del circuito y un contador
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
): Promise<{ readonly summary: EvidenceSummary; readonly readings: readonly Reading[] }> {
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
  const hash = kept.length === 0 ? null : await evidenceHash(kept);
  return {
    summary: { algorithm: EVIDENCE_ALGORITHM, hash, readings: kept.length, vehicles, sources, missing },
    readings: kept,
  };
}

/** El hash del recorte: de las lecturas tal como se guardan, en su orden. */
export function evidenceHash(readings: readonly Reading[]): Promise<string> {
  return semanticHash(readings.map(plainReading));
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
export function revisionHash(revision: CaseRevision): Promise<string> {
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

interface Rule {
  readonly from: readonly CaseState[];
  readonly to: CaseState;
  readonly input: TransitionInput;
  readonly inputLabel: string | null;
  readonly check: (revision: CaseRevision) => readonly string[];
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
    check: (revision) => [
      ...(revision.hypotheses.some((hypothesis) => hypothesis.status !== "contradicha" && hypothesis.status !== "descartada")
        ? []
        : ["al menos una hipótesis que nada contradiga"]),
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
      revision.countermeasures.some((measure) => measure.appliedAt !== null && measure.metric !== null)
        ? []
        : ["la fecha de aplicación y la métrica de verificación de la contramedida"],
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
  // OQ-168: descartar («no es una incidencia») y reabrir con evidencia nueva.
  { from: ["Draft", "UnderReview"], to: "Discarded", input: "razon", inputLabel: "Por qué no es una incidencia", check: NONE },
  { from: ["Closed", "Inconclusive"], to: "Investigating", input: "evidencia-nueva", inputLabel: "Qué evidencia nueva lo reabre", check: NONE },
];

/** `Closed` y `Discarded` no admiten notas; `Closed` se reabre, `Discarded` no. */
function isFinal(state: CaseState): boolean {
  return state === "Closed" || state === "Discarded";
}

/** Las transiciones posibles desde el estado vigente, con lo que falta para cada una. */
export function transitionsFrom(revision: CaseRevision): readonly TransitionOption[] {
  return RULES.filter((rule) => rule.from.includes(revision.state)).map((rule) => ({
    to: rule.to,
    unmet: rule.check(revision),
    input: rule.input,
    inputLabel: rule.inputLabel,
  }));
}

/**
 * Hace la transición que una persona confirmó. Lanza `CaseRefusal` si no existe desde el estado
 * vigente, si falta algo del expediente o si falta el texto que exige.
 */
export async function transition(previous: CaseRevision, to: CaseState, text: string | null, now: number, author: string | null): Promise<CaseRevision> {
  const option = transitionsFrom(previous).find((entry) => entry.to === to);
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
  return `${evidence.readings.toLocaleString("es-ES")} ${evidence.readings === 1 ? "lectura" : "lecturas"} de ${evidence.vehicles.toLocaleString("es-ES")} AGV, congeladas de ${files}.${missing}`;
}

function cleanAuthor(author: string | null): string | null {
  const trimmed = (author ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Palabras que afirman causa (D6). El texto que genera el programa no las usa: solo una persona
 * confirma una causa, y eso lo escribe ella. La prueba de lenguaje recorre los textos de este módulo.
 */
export const CAUSAL_VOCABULARY: readonly RegExp[] = [
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
