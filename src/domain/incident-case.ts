/**
 * El expediente de una incidencia como registro de eventos append-only (ADR-0017 §1–§3, R-INC-006).
 *
 * Como el plano (ADR-0016): un expediente es una lista de eventos con número, fecha, autor y razón, y
 * su estado vigente sale de recorrerlos (`foldCase`). Nada se sobrescribe: corregir el síntoma deja
 * visible el anterior, y retirar una hipótesis la marca retirada sin borrarla.
 *
 * Quién puede hacer qué:
 *
 * - **el programa** propone: la ventana, el recorte de evidencia, las mediciones (la onda, la batería),
 *   relaciones de orden o de mecanismo (`precede`, `es-compatible-con`, `correlaciona`) y notas;
 * - **solo una persona** abre el expediente, cambia su estado, fija el síntoma, escribe hipótesis,
 *   evidencia, contramedidas, verificaciones y la conclusión, y es la única que puede decir
 *   `confirmado-como-causa` (ADR-0017 §5, R-INC-007).
 *
 * Los estados son los de `INCIDENTS_REPORTING.md` §7. `cerrada` exige una conclusión escrita antes;
 * `verificada-eficaz` e `ineficaz`, una verificación registrada (R-INC-003).
 *
 * Nada de aquí toca la memoria normal (R-INC-001, R-INC-002): el expediente es un registro aparte.
 */

import type { Interval } from "./coverage.js";
import type { Reading } from "./reading.js";

export type CaseStatus =
  | "borrador"
  | "en-revision"
  | "investigando"
  | "contramedida-planificada"
  | "verificacion-pendiente"
  | "verificada-eficaz"
  | "verificada-ineficaz"
  | "inconclusa"
  | "cerrada";

/** Las transiciones de `INCIDENTS_REPORTING.md` §7, más reabrir un expediente cerrado. */
export const CASE_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
  borrador: ["en-revision"],
  "en-revision": ["investigando"],
  investigando: ["contramedida-planificada", "inconclusa"],
  "contramedida-planificada": ["verificacion-pendiente"],
  "verificacion-pendiente": ["verificada-eficaz", "verificada-ineficaz"],
  "verificada-ineficaz": ["investigando"],
  "verificada-eficaz": ["cerrada"],
  inconclusa: ["cerrada"],
  cerrada: ["investigando"],
};

/** Los cuatro verbos del lenguaje de causalidad (ADR-0017 §5). El último, solo una persona. */
export type CausalVerb = "precede" | "es-compatible-con" | "correlaciona" | "confirmado-como-causa";

export type CaseAuthor = { readonly kind: "persona"; readonly name: string } | { readonly kind: "programa"; readonly version: string };

export interface CaseSymptom extends Interval {
  readonly description: string;
}

/** Las versiones con que se midió: congeladas en el expediente para poder recalcular (ADR-0017 §3). */
export interface CaseVersions {
  readonly algorithm: string;
  readonly config: string;
  /** La versión consolidada vigente, o `null` si el circuito no tiene memoria. */
  readonly memory: string | null;
  /** El último evento del plano aplicado, o `null` sin plano. */
  readonly planSeq: number | null;
}

interface EventBase {
  readonly seq: number;
  readonly atUtcMs: number;
  readonly author: CaseAuthor;
  readonly reason: string;
}

export type CaseEvent = EventBase &
  (
    | {
        readonly kind: "abrir";
        readonly caseId: string;
        readonly circuitId: string;
        readonly title: string;
        readonly origin: { readonly kind: "sintoma" | "intervalo" | "hallazgo"; readonly findingKey?: string };
        readonly symptom: CaseSymptom;
      }
    | { readonly kind: "sintoma"; readonly symptom: CaseSymptom }
    | { readonly kind: "ventana"; readonly window: Interval; readonly proposed: boolean }
    | { readonly kind: "evidencia-minima"; readonly readings: number; readonly hash: string; readonly versions: CaseVersions }
    | { readonly kind: "medicion"; readonly measure: "onda" | "bateria"; readonly algorithm: string; readonly resultHash: string }
    | { readonly kind: "hipotesis"; readonly hypothesisId: string; readonly text: string }
    | { readonly kind: "retirar-hipotesis"; readonly hypothesisId: string }
    | { readonly kind: "evidencia"; readonly hypothesisId: string; readonly stance: "a-favor" | "en-contra"; readonly text: string }
    | { readonly kind: "relacion"; readonly subject: string; readonly verb: CausalVerb; readonly object: string }
    | {
        readonly kind: "contramedida";
        readonly countermeasureId: string;
        readonly action: string;
        readonly owner: string;
        readonly dueUtcMs: number;
        readonly risk: string;
      }
    | {
        readonly kind: "verificacion";
        readonly countermeasureId: string;
        readonly before: string;
        readonly after: string;
        readonly effective: boolean;
      }
    | { readonly kind: "estado"; readonly to: CaseStatus }
    | { readonly kind: "conclusion"; readonly text: string }
    | { readonly kind: "nota"; readonly text: string }
  );

/** Lo que el programa puede registrar por su cuenta: proponer y medir, nunca decidir. */
const PROGRAM_KINDS: ReadonlySet<CaseEvent["kind"]> = new Set(["ventana", "evidencia-minima", "medicion", "relacion", "nota"]);

export interface CaseView {
  readonly caseId: string;
  readonly circuitId: string;
  readonly title: string;
  readonly origin: Extract<CaseEvent, { kind: "abrir" }>["origin"];
  readonly status: CaseStatus;
  readonly symptom: CaseSymptom;
  /** Los síntomas anteriores, del más antiguo al más reciente: corregir no borra. */
  readonly symptomHistory: readonly CaseSymptom[];
  /** La última ventana propuesta por el programa y la última elegida por una persona. */
  readonly proposedWindow: Interval | null;
  readonly window: Interval | null;
  readonly evidence: Extract<CaseEvent, { kind: "evidencia-minima" }> | null;
  readonly measurements: readonly Extract<CaseEvent, { kind: "medicion" }>[];
  readonly hypotheses: readonly {
    readonly hypothesisId: string;
    readonly text: string;
    readonly retired: boolean;
    readonly inFavour: readonly string[];
    readonly against: readonly string[];
  }[];
  readonly relations: readonly { readonly subject: string; readonly verb: CausalVerb; readonly object: string; readonly author: CaseAuthor }[];
  readonly countermeasures: readonly {
    readonly countermeasureId: string;
    readonly action: string;
    readonly owner: string;
    readonly dueUtcMs: number;
    readonly risk: string;
    readonly verifications: readonly { readonly before: string; readonly after: string; readonly effective: boolean }[];
  }[];
  readonly conclusion: string | null;
  readonly notes: readonly string[];
  readonly lastSeq: number;
}

/**
 * El primer problema de un registro de eventos, o `null` si es válido. Es la única puerta: un evento
 * que lo haría inválido no se añade (`appendCaseEvent`).
 */
export function caseProblem(events: readonly CaseEvent[]): string | null {
  let status: CaseStatus | null = null;
  let symptom: CaseSymptom | null = null;
  let concluded = false;
  const hypotheses = new Set<string>();
  const countermeasures = new Set<string>();
  const verified = new Set<string>();
  let previousAt = Number.NEGATIVE_INFINITY;
  for (const [index, event] of events.entries()) {
    const where = `evento ${event.seq} (${event.kind})`;
    if (event.seq !== index + 1) return `${where}: el número tiene que ser ${index + 1}`;
    if (event.atUtcMs < previousAt) return `${where}: la fecha es anterior a la del evento previo`;
    previousAt = event.atUtcMs;
    if (event.reason.trim() === "") return `${where}: sin razón`;
    if (event.author.kind === "programa" && !PROGRAM_KINDS.has(event.kind)) {
      return `${where}: el programa propone y mide; esto lo registra una persona`;
    }
    if (index === 0) {
      if (event.kind !== "abrir") return `${where}: un expediente empieza por «abrir»`;
      status = "borrador";
      symptom = event.symptom;
      if (symptom.to < symptom.from) return `${where}: el síntoma acaba antes de empezar`;
      continue;
    }
    if (status === "cerrada" && !(event.kind === "estado" && event.to === "investigando") && event.kind !== "nota") {
      return `${where}: el expediente está cerrado; solo se reabre o se anota`;
    }
    switch (event.kind) {
      case "abrir":
        return `${where}: el expediente ya está abierto`;
      case "sintoma":
        if (event.symptom.to < event.symptom.from) return `${where}: el síntoma acaba antes de empezar`;
        symptom = event.symptom;
        break;
      case "ventana": {
        const current = symptom as CaseSymptom;
        if (event.window.from > current.from || event.window.to < current.to) {
          return `${where}: la ventana tiene que contener el síntoma`;
        }
        if (!event.proposed && event.author.kind !== "persona") return `${where}: la ventana elegida la fija una persona`;
        break;
      }
      case "relacion":
        if (event.verb === "confirmado-como-causa" && event.author.kind !== "persona") {
          return `${where}: solo una persona confirma una causa`;
        }
        break;
      case "hipotesis":
        if (hypotheses.has(event.hypothesisId)) return `${where}: la hipótesis ${event.hypothesisId} ya existe`;
        hypotheses.add(event.hypothesisId);
        break;
      case "retirar-hipotesis":
      case "evidencia":
        if (!hypotheses.has(event.hypothesisId)) return `${where}: no hay hipótesis ${event.hypothesisId}`;
        break;
      case "contramedida":
        if (countermeasures.has(event.countermeasureId)) return `${where}: la contramedida ${event.countermeasureId} ya existe`;
        countermeasures.add(event.countermeasureId);
        break;
      case "verificacion":
        if (!countermeasures.has(event.countermeasureId)) return `${where}: no hay contramedida ${event.countermeasureId}`;
        verified.add(event.countermeasureId);
        break;
      case "conclusion":
        if (event.text.trim() === "") return `${where}: la conclusión está vacía`;
        concluded = true;
        break;
      case "estado": {
        const from = status as CaseStatus;
        if (!CASE_TRANSITIONS[from].includes(event.to)) return `${where}: de «${from}» no se pasa a «${event.to}»`;
        if (event.to === "contramedida-planificada" && countermeasures.size === 0) {
          return `${where}: no hay ninguna contramedida registrada`;
        }
        if ((event.to === "verificada-eficaz" || event.to === "verificada-ineficaz") && verified.size === 0) {
          return `${where}: una contramedida solo es eficaz o ineficaz tras una verificación registrada (R-INC-003)`;
        }
        if (event.to === "cerrada" && !concluded) return `${where}: cerrar exige una conclusión humana escrita antes`;
        status = event.to;
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/** Añade un evento si el registro sigue siendo válido; si no, devuelve el problema y no cambia nada. */
export function appendCaseEvent(
  events: readonly CaseEvent[],
  event: CaseEvent,
): { readonly events: readonly CaseEvent[]; readonly problem: null } | { readonly events: readonly CaseEvent[]; readonly problem: string } {
  const next = [...events, event];
  const problem = caseProblem(next);
  return problem === null ? { events: next, problem: null } : { events, problem };
}

/** El estado vigente del expediente: recorrer sus eventos. Lanza si el registro no es válido. */
export function foldCase(events: readonly CaseEvent[]): CaseView {
  const problem = caseProblem(events);
  if (problem !== null) throw new Error(`expediente inválido: ${problem}`);
  const opening = events[0] as Extract<CaseEvent, { kind: "abrir" }>;
  let status: CaseStatus = "borrador";
  let symptom = opening.symptom;
  const symptomHistory: CaseSymptom[] = [];
  let proposedWindow: Interval | null = null;
  let window: Interval | null = null;
  let evidence: CaseView["evidence"] = null;
  const measurements: Extract<CaseEvent, { kind: "medicion" }>[] = [];
  const hypotheses = new Map<string, { hypothesisId: string; text: string; retired: boolean; inFavour: string[]; against: string[] }>();
  const relations: { subject: string; verb: CausalVerb; object: string; author: CaseAuthor }[] = [];
  const countermeasures = new Map<
    string,
    { countermeasureId: string; action: string; owner: string; dueUtcMs: number; risk: string; verifications: { before: string; after: string; effective: boolean }[] }
  >();
  let conclusion: string | null = null;
  const notes: string[] = [];
  for (const event of events.slice(1)) {
    switch (event.kind) {
      case "sintoma":
        symptomHistory.push(symptom);
        symptom = event.symptom;
        break;
      case "ventana":
        if (event.proposed) proposedWindow = event.window;
        else window = event.window;
        break;
      case "evidencia-minima":
        evidence = event;
        break;
      case "medicion":
        measurements.push(event);
        break;
      case "hipotesis":
        hypotheses.set(event.hypothesisId, { hypothesisId: event.hypothesisId, text: event.text, retired: false, inFavour: [], against: [] });
        break;
      case "retirar-hipotesis":
        (hypotheses.get(event.hypothesisId) as { retired: boolean }).retired = true;
        break;
      case "evidencia": {
        const entry = hypotheses.get(event.hypothesisId) as { inFavour: string[]; against: string[] };
        (event.stance === "a-favor" ? entry.inFavour : entry.against).push(event.text);
        break;
      }
      case "relacion":
        relations.push({ subject: event.subject, verb: event.verb, object: event.object, author: event.author });
        break;
      case "contramedida":
        countermeasures.set(event.countermeasureId, {
          countermeasureId: event.countermeasureId,
          action: event.action,
          owner: event.owner,
          dueUtcMs: event.dueUtcMs,
          risk: event.risk,
          verifications: [],
        });
        break;
      case "verificacion":
        countermeasures.get(event.countermeasureId)?.verifications.push({ before: event.before, after: event.after, effective: event.effective });
        break;
      case "estado":
        status = event.to;
        break;
      case "conclusion":
        conclusion = event.text;
        break;
      case "nota":
        notes.push(event.text);
        break;
      default:
        break;
    }
  }
  return {
    caseId: opening.caseId,
    circuitId: opening.circuitId,
    title: opening.title,
    origin: opening.origin,
    status,
    symptom,
    symptomHistory,
    proposedWindow,
    window,
    evidence,
    measurements,
    hypotheses: [...hypotheses.values()],
    relations,
    countermeasures: [...countermeasures.values()],
    conclusion,
    notes,
    lastSeq: events.length,
  };
}

/**
 * El recorte de evidencia de un expediente (ADR-0017 §3): las lecturas de **toda la flota** dentro de
 * la ventana, ambos extremos incluidos, en el orden total de ADR-0013 `(t_utc, source_hash,
 * source_row)`. Con él y las versiones congeladas el expediente se recalcula cuando las lecturas en
 * crudo ya se han retirado del almacén (ADR-0015). No inventa ni mueve nada: solo copia.
 */
export function caseEvidence(readings: readonly Reading[], window: Interval): readonly Reading[] {
  return readings
    .filter((reading) => reading.time.utcMs >= window.from && reading.time.utcMs <= window.to)
    .sort(
      (a, b) =>
        a.time.utcMs - b.time.utcMs ||
        (a.provenance.sourceHash < b.provenance.sourceHash ? -1 : a.provenance.sourceHash > b.provenance.sourceHash ? 1 : 0) ||
        a.provenance.sourceRow - b.provenance.sourceRow,
    );
}

/**
 * Lo que se firma del recorte: cada lectura con su procedencia, y las versiones. El hash de esto
 * (`semanticHash`) va en el evento `evidencia-minima`; recalcularlo desde el recorte guardado prueba
 * que no ha cambiado.
 */
export function evidenceDigestInput(evidence: readonly Reading[], versions: CaseVersions): unknown {
  return {
    versions,
    readings: evidence.map((reading) => [
      reading.time.utcMs,
      reading.agvId,
      reading.tagId,
      reading.provenance.sourceHash,
      reading.provenance.sourceRow,
    ]),
  };
}
