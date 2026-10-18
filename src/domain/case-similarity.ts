/**
 * Biblioteca de casos y similitud explicada (ALG-017, ADR-0018 D10, `INCIDENTS_REPORTING.md` §6).
 *
 * Solo entre expedientes **del mismo circuito** (ADR-0004) y sin los descartados («no es una
 * incidencia»). Cada característica se compara a la vista —igual, parecido con su diferencia, distinto o
 * sin dato— y **no hay una puntuación oculta**: se ordena por cuántas coinciden (igual o parecido), todas
 * con el mismo peso, y a igualdad, el síntoma más reciente primero.
 *
 * Una causa confirmada en otro caso se enseña como «confirmado en aquel caso» y **no es evidencia para
 * este**: no cambia ninguna etiqueta del expediente actual. Que un hecho se repita en otros casos se
 * cuenta y se dice; llamarlo `correlaciona` exige una prueba de azar con la frecuencia del hecho fuera
 * de las incidencias, que todavía no se mide (OQ-172), así que no se hace.
 */

import type { Chronology, ChronologyFact } from "./case-backtrack.js";
import type { HypothesisView } from "./case-hypotheses.js";
import { CASE_STATE_TEXT, type CaseRevision } from "./incident-case.js";
import { localHourReader } from "./silence-kind.js";

/** Versión del procedimiento; viaja con cada comparación (`VERSIONING.md`). */
const SIMILARITY_ALGORITHM = "similitud-1";

export type FeatureVerdict = "igual" | "parecido" | "distinto" | "sin-dato";

export interface FeatureComparison {
  readonly feature: string;
  readonly verdict: FeatureVerdict;
  /** Lo de este caso frente a lo de aquel, en palabras. */
  readonly text: string;
}

export interface SimilarCase {
  readonly caseId: string;
  readonly title: string;
  readonly stateText: string;
  readonly symptomFrom: number;
  /** Cuántas características coinciden (igual o parecido) de cuántas se pudieron comparar. */
  readonly matches: number;
  readonly compared: number;
  readonly features: readonly FeatureComparison[];
  /** Lo que una persona confirmó en aquel caso. No es evidencia para este. */
  readonly confirmedThere: readonly string[];
}

export interface Repetition {
  /** El hecho de este caso que precede al síntoma, en palabras. */
  readonly text: string;
  /** En qué otros casos parecidos precede también. */
  readonly caseIds: readonly string[];
}

/** Lo que se enseña de un expediente frente a los demás. */
export interface CaseSimilarity {
  readonly algorithm: string;
  readonly similar: readonly SimilarCase[];
  readonly repetitions: readonly Repetition[];
}

export interface CaseLibraryEntry {
  readonly revision: CaseRevision;
  readonly chronology: Chronology | null;
  readonly hypotheses: readonly HypothesisView[];
}

export interface SimilarityThresholds {
  readonly zone: string;
  /** «A la misma hora» (`flow_stops.same_time_tolerance_ms`, el mismo concepto que las paradas). */
  readonly sameTimeToleranceMs: number;
  /** Horas de arranque de turno (`silence_kind.shift_start_hours`). */
  readonly shiftStartHours: readonly number[];
  /** Cuántas veces más larga puede ser una duración para ser parecida (`incident_case.similarity_duration_ratio`). */
  readonly durationRatio: number;
}

/** Lo que de un caso se compara, sacado de su revisión y de lo calculado de su recorte. */
interface Features {
  readonly symptomKind: "sin-paso" | "silencio-agv" | "otro";
  readonly tags: ReadonlySet<string>;
  readonly declared: ReadonlySet<string>;
  readonly durationMs: number;
  readonly startMinute: number;
  readonly shift: number | null;
  readonly agvs: ReadonlySet<string>;
  readonly kinds: ReadonlySet<string>;
  readonly firstDeviation: string | null;
  readonly confirmed: readonly HypothesisView[];
  readonly preceding: readonly ChronologyFact[];
}

const ALGO_MINUTE = 60_000;

function featuresOf(entry: CaseLibraryEntry, thresholds: SimilarityThresholds): Features {
  const { revision, chronology } = entry;
  const hourOf = localHourReader(thresholds.zone);
  const minuteFormatter = new Intl.DateTimeFormat("en-US", { timeZone: thresholds.zone, minute: "2-digit" });
  const start = revision.window.symptomFrom;
  const hour = hourOf(start);
  const minute = Number(minuteFormatter.format(new Date(start)));
  const shifts = [...thresholds.shiftStartHours].sort((a, b) => a - b);
  let shift: number | null = null;
  if (shifts.length > 0) {
    shift = shifts.length - 1;
    for (let index = 0; index < shifts.length; index += 1) if (hour >= (shifts[index] as number)) shift = index;
    if (hour < (shifts[0] as number)) shift = shifts.length - 1;
  }
  const preceding = (chronology?.facts ?? []).filter((fact) => fact.relation === "precede");
  const first = chronology?.firstDeviation === null || chronology === null ? null : chronology.facts[chronology.firstDeviation];
  return {
    symptomKind: revision.tagIds.length > 0 ? "sin-paso" : revision.agvId !== null ? "silencio-agv" : "otro",
    tags: new Set(revision.tagIds),
    declared: new Set((chronology?.declared ?? []).map((entry) => entry.text)),
    durationMs: Math.max(0, revision.window.symptomTo - revision.window.symptomFrom),
    startMinute: hour * 60 + minute,
    shift,
    agvs: new Set(preceding.filter((fact) => fact.kind === "desviacion" || fact.kind === "silencio-agv" || fact.kind === "corte-wifi").map((fact) => fact.agvId as string)),
    kinds: new Set(preceding.map((fact) => fact.kind)),
    firstDeviation: first === undefined || first === null ? null : `${first.tagIds[0] ?? ""} → ${first.tagIds[1] ?? ""}`,
    confirmed: entry.hypotheses.filter((hypothesis) => hypothesis.decision?.state === "confirmada"),
    preceding,
  };
}

const SYMPTOM_TEXT = { "sin-paso": "sin paso por un tag", "silencio-agv": "un AGV sin lecturas", otro: "otro síntoma" } as const;
const KIND_TEXT: Readonly<Record<string, string>> = {
  desviacion: "AGV por encima de lo esperado",
  "silencio-agv": "AGV sin lecturas",
  "corte-wifi": "cortes de conexión",
  turno: "cambio de turno",
  regimen: "cambio de régimen",
  "sin-paso": "último paso",
};

function joined(values: ReadonlySet<string>): string {
  return [...values].sort().join(", ");
}

function setComparison(feature: string, here: ReadonlySet<string>, there: ReadonlySet<string>, render: (values: ReadonlySet<string>) => string = joined): FeatureComparison {
  if (here.size === 0 || there.size === 0) return { feature, verdict: "sin-dato", text: here.size === 0 ? "este caso no lo tiene" : "aquel caso no lo tiene" };
  const shared = new Set([...here].filter((value) => there.has(value)));
  if (shared.size === 0) return { feature, verdict: "distinto", text: `${render(here)} frente a ${render(there)}` };
  const same = shared.size === here.size && shared.size === there.size;
  return { feature, verdict: same ? "igual" : "parecido", text: same ? render(here) : `comparten ${render(shared)}; aquí ${render(here)}, allí ${render(there)}` };
}

function clock(minuteOfDay: number): string {
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

function minutes(ms: number): string {
  return `${Math.round(ms / ALGO_MINUTE)} min`;
}

/** Compara este caso con aquel, característica por característica. */
function compare(here: Features, there: Features, thresholds: SimilarityThresholds): readonly FeatureComparison[] {
  const out: FeatureComparison[] = [];
  out.push({
    feature: "Síntoma",
    verdict: here.symptomKind === there.symptomKind ? "igual" : "distinto",
    text: here.symptomKind === there.symptomKind ? SYMPTOM_TEXT[here.symptomKind] : `${SYMPTOM_TEXT[here.symptomKind]} frente a ${SYMPTOM_TEXT[there.symptomKind]}`,
  });
  out.push(setComparison("Tags del síntoma", here.tags, there.tags));
  out.push(setComparison("Zona y función declaradas", here.declared, there.declared, (values) => [...values].sort().join("; ")));
  const long = Math.max(here.durationMs, there.durationMs);
  const short = Math.min(here.durationMs, there.durationMs);
  out.push({
    feature: "Duración",
    verdict: short === 0 ? "sin-dato" : long / short <= thresholds.durationRatio ? (long === short ? "igual" : "parecido") : "distinto",
    text: `${minutes(here.durationMs)} frente a ${minutes(there.durationMs)}`,
  });
  const gap = Math.min(Math.abs(here.startMinute - there.startMinute), 1440 - Math.abs(here.startMinute - there.startMinute));
  out.push({
    feature: "Hora del día",
    verdict: gap === 0 ? "igual" : gap * ALGO_MINUTE <= thresholds.sameTimeToleranceMs ? "parecido" : "distinto",
    text: `${clock(here.startMinute)} frente a ${clock(there.startMinute)}`,
  });
  out.push({
    feature: "Turno",
    verdict: here.shift === null || there.shift === null ? "sin-dato" : here.shift === there.shift ? "igual" : "distinto",
    text:
      here.shift === null || there.shift === null
        ? "sin turnos configurados"
        : `turno de las ${clock((thresholds.shiftStartHours[here.shift] as number) * 60)}${here.shift === there.shift ? "" : ` frente al de las ${clock((thresholds.shiftStartHours[there.shift] as number) * 60)}`}`,
  });
  out.push(setComparison("AGV que preceden", here.agvs, there.agvs));
  out.push({
    feature: "Cuántos AGV",
    verdict: here.agvs.size === 0 || there.agvs.size === 0 ? "sin-dato" : (here.agvs.size > 1) === (there.agvs.size > 1) ? "igual" : "distinto",
    text: `${here.agvs.size} frente a ${there.agvs.size}`,
  });
  out.push(setComparison("Lo que precede", here.kinds, there.kinds, (values) => [...values].map((kind) => KIND_TEXT[kind] ?? kind).sort().join(", ")));
  out.push({
    feature: "Primera desviación",
    verdict: here.firstDeviation === null || there.firstDeviation === null ? "sin-dato" : here.firstDeviation === there.firstDeviation ? "igual" : "distinto",
    text: here.firstDeviation === null || there.firstDeviation === null ? (here.firstDeviation === null ? "este caso no la tiene" : "aquel caso no la tiene") : here.firstDeviation === there.firstDeviation ? here.firstDeviation : `${here.firstDeviation} frente a ${there.firstDeviation}`,
  });
  out.push({ feature: "Calles de carga y FIFO", verdict: "sin-dato", text: "no se revisan todavía" });
  const kindOf = (hypothesis: HypothesisView): string => hypothesis.key.split("|")[0] ?? hypothesis.key;
  const hereKinds = new Set(here.confirmed.map(kindOf));
  const thereKinds = new Set(there.confirmed.map(kindOf));
  out.push({
    feature: "Diagnóstico confirmado",
    verdict: hereKinds.size === 0 || thereKinds.size === 0 ? "sin-dato" : [...hereKinds].some((kind) => thereKinds.has(kind)) ? "igual" : "distinto",
    text: thereKinds.size === 0 ? "aquel caso no tiene ninguna hipótesis confirmada" : `confirmado en aquel caso; no es evidencia para este`,
  });
  return out;
}

/**
 * Los casos parecidos a `target` entre los demás del circuito (sin los descartados), con su
 * comparación, en orden: más coincidencias primero, a igualdad el síntoma más reciente. Y los hechos de
 * `target` que preceden al síntoma que se repiten en ellos (mismo tipo, mismo AGV o mismo tramo).
 */
export function similarCases(
  target: CaseLibraryEntry,
  library: readonly CaseLibraryEntry[],
  thresholds: SimilarityThresholds,
): CaseSimilarity {
  const here = featuresOf(target, thresholds);
  const others = library.filter((entry) => entry.revision.caseId !== target.revision.caseId && entry.revision.state !== "Discarded");
  const similar = others
    .map((entry) => {
      const there = featuresOf(entry, thresholds);
      const features = compare(here, there, thresholds);
      const compared = features.filter((feature) => feature.verdict !== "sin-dato").length;
      const matches = features.filter((feature) => feature.verdict === "igual" || feature.verdict === "parecido").length;
      return {
        caseId: entry.revision.caseId,
        title: entry.revision.title,
        stateText: CASE_STATE_TEXT[entry.revision.state],
        symptomFrom: entry.revision.window.symptomFrom,
        matches,
        compared,
        features,
        confirmedThere: there.confirmed.map((hypothesis) => `${hypothesis.text} (${hypothesis.decision?.note ?? ""})`),
        there,
      };
    })
    .sort((a, b) => b.matches - a.matches || b.symptomFrom - a.symptomFrom || (a.caseId < b.caseId ? -1 : 1));
  // Las repeticiones: el mismo hecho (tipo y AGV, o tipo y tramo) precede también en otros casos.
  const signature = (fact: ChronologyFact): string | null =>
    fact.kind === "desviacion" ? `desviacion|${fact.agvId}|${fact.tagIds.join(">")}` : fact.kind === "corte-wifi" || fact.kind === "silencio-agv" ? `${fact.kind}|${fact.agvId}` : null;
  const seen = new Set<string>();
  const repetitions: Repetition[] = [];
  for (const fact of here.preceding) {
    const key = signature(fact);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    const caseIds = similar.filter((entry) => entry.there.preceding.some((other) => signature(other) === key)).map((entry) => entry.caseId);
    if (caseIds.length > 0) repetitions.push({ text: fact.text, caseIds });
  }
  return { algorithm: SIMILARITY_ALGORITHM, similar: similar.map(({ there: _there, ...entry }) => entry), repetitions };
}

export const VERDICT_WORD: Readonly<Record<FeatureVerdict, string>> = {
  igual: "igual",
  parecido: "parecido",
  distinto: "distinto",
  "sin-dato": "sin dato",
};
