/**
 * Verificación de una contramedida (ADR-0018 D9, R-INC-003, OQ-P07).
 *
 * La métrica es **la misma que define el síntoma**: si el síntoma es un hueco sin paso por un tag, se
 * cuentan los huecos sin paso por ese tag de al menos tanto; si es un AGV sin lecturas, los silencios de
 * ese AGV de al menos tanto. Se cuenta igual antes y después de la fecha de aplicación, en ventanas de la
 * misma longitud, solo en tiempo cubierto por lecturas, solo en producción (la noche es otro régimen,
 * R-TIM-009) y sin las ventanas de los demás expedientes. La comparación es una prueba de azar sobre las
 * tasas: dados los episodios que hay entre los dos periodos, ¿cuántas veces saldrían tan pocos después
 * por puro reparto según el tiempo de cada uno?
 *
 * El programa **propone** —eficaz, parcial, ineficaz o sin exposición suficiente— con umbrales
 * provisionales de configuración; la conclusión la escribe una persona y sin ella no hay verificación
 * (R-INC-003). Nada de aquí dice por qué bajó o no bajó.
 */

import { binomialTail } from "./charging.js";
import type { Interval } from "./coverage.js";
import type { Reading } from "./reading.js";
import { regimeReader, type RegimeThresholds } from "./segment-bands.js";

/** Versión del procedimiento; viaja con cada verificación (`VERSIONING.md`). */
export const VERIFICATION_ALGORITHM = "verificacion-1";

/** La métrica de una contramedida: la misma que define el síntoma. */
export type CaseMetric =
  | { readonly kind: "sin-paso"; readonly tagId: string; readonly minGapMs: number }
  | { readonly kind: "silencio-agv"; readonly agvId: string; readonly minGapMs: number };

export interface VerificationThresholds {
  /** Longitud de cada periodo, antes y después de la aplicación (`incident_case.verification_window_ms`). */
  readonly windowMs: number;
  /** Azar máximo para decir que bajó (`incident_case.verification_max_chance`). */
  readonly maxChance: number;
  /** Bajada mínima, en fracción, para proponer «eficaz» (`incident_case.verification_effective_reduction`). */
  readonly effectiveReduction: number;
  /** Episodios esperados después, con la tasa de antes, para que haya exposición suficiente. */
  readonly minExpectedEvents: number;
}

export interface PeriodCount {
  readonly from: number;
  readonly to: number;
  /** Tiempo de producción cubierto por lecturas y fuera de otros expedientes. */
  readonly exposureMs: number;
  /** Cuándo empieza cada episodio. */
  readonly eventsAt: readonly number[];
}

export type VerificationVerdict = "eficaz" | "parcial" | "ineficaz" | "sin-exposicion";

export interface VerificationResult {
  readonly algorithm: string;
  readonly metric: CaseMetric;
  readonly appliedAt: number;
  readonly before: PeriodCount;
  readonly after: PeriodCount;
  /** Episodios por hora de exposición; `null` sin exposición. */
  readonly rateBefore: number | null;
  readonly rateAfter: number | null;
  /** 1 − después/antes; `null` si antes no hubo episodios. */
  readonly reduction: number | null;
  /** Probabilidad de ver tan pocos después por azar; `null` sin exposición suficiente. */
  readonly chance: number | null;
  /** La propuesta del programa; la conclusión es de una persona. */
  readonly verdict: VerificationVerdict;
  readonly thresholds: VerificationThresholds;
  /** Los ficheros de los que salen las lecturas contadas. */
  readonly sources: readonly { readonly sourceHash: string; readonly fileName: string }[];
}

export const VERDICT_TEXT: Readonly<Record<VerificationVerdict, string>> = {
  eficaz: "eficaz",
  parcial: "parcial",
  ineficaz: "ineficaz",
  "sin-exposicion": "sin exposición suficiente",
};

/**
 * La métrica que propone el programa para un expediente: la del síntoma. Con tags, huecos sin paso por
 * el primero de al menos lo que duró el síntoma (en minutos enteros, al menos uno); sin tags y con AGV,
 * silencios de ese AGV; sin ninguno de los dos, ninguna.
 */
export function proposeMetric(input: { readonly tagIds: readonly string[]; readonly agvId: string | null; readonly symptomFrom: number; readonly symptomTo: number }): CaseMetric | null {
  const minute = 60_000;
  const minGapMs = Math.max(minute, Math.floor((input.symptomTo - input.symptomFrom) / minute) * minute);
  const tagId = input.tagIds[0];
  if (tagId !== undefined) return { kind: "sin-paso", tagId, minGapMs };
  if (input.agvId !== null) return { kind: "silencio-agv", agvId: input.agvId, minGapMs };
  return null;
}

/** La métrica en palabras. */
export function metricText(metric: CaseMetric): string {
  const minutes = Math.round(metric.minGapMs / 60_000);
  return metric.kind === "sin-paso"
    ? `huecos de al menos ${minutes} min sin paso por ${metric.tagId}, por hora de producción`
    : `silencios de al menos ${minutes} min del AGV ${metric.agvId}, por hora de producción`;
}

export interface VerifyInput {
  readonly metric: CaseMetric;
  readonly appliedAt: number;
  readonly readings: readonly Reading[];
  /** Tiempo cubierto por las lecturas del circuito (R-DAT-007). */
  readonly coverage: readonly Interval[];
  /** Ventanas que no cuentan: las de los demás expedientes. */
  readonly excluded: readonly Interval[];
  readonly zone: string;
  readonly regimes: RegimeThresholds;
  readonly thresholds: VerificationThresholds;
  readonly sources: VerificationResult["sources"];
}

const MINUTE = 60_000;

/** Cuenta la métrica antes y después de la aplicación y propone. Determinista. */
export function verifyCountermeasure(input: VerifyInput): VerificationResult {
  const { metric, appliedAt, thresholds } = input;
  const regimeOf = regimeReader(input.zone, input.regimes);
  const inside = (at: number, spans: readonly Interval[]): boolean => spans.some((span) => at >= span.from && at <= span.to);
  // Un minuto cuenta si está cubierto, es de producción y no cae en otro expediente.
  const usable = (at: number): boolean => inside(at, input.coverage) && !inside(at, input.excluded) && regimeOf(at) === "produccion";
  const exposure = (from: number, to: number): number => {
    let total = 0;
    for (let at = from; at < to; at += MINUTE) if (usable(at + MINUTE / 2)) total += MINUTE;
    return total;
  };
  // Los episodios: huecos de al menos `minGapMs` entre dos lecturas seguidas de la métrica, enteros
  // dentro de tiempo cubierto y que empiezan en tiempo que cuenta. Un hueco que cruza tiempo sin cubrir
  // no es un episodio: es falta de datos.
  const relevant = input.readings
    .filter((reading) => (metric.kind === "sin-paso" ? reading.tagId === metric.tagId : reading.agvId === metric.agvId))
    .map((reading) => reading.time.utcMs)
    .sort((a, b) => a - b);
  const episodes: number[] = [];
  for (let index = 1; index < relevant.length; index += 1) {
    const a = relevant[index - 1] as number;
    const b = relevant[index] as number;
    if (b - a < metric.minGapMs) continue;
    const covered = input.coverage.some((span) => span.from <= a && b <= span.to);
    if (covered && usable(a)) episodes.push(a);
  }
  const period = (from: number, to: number): PeriodCount => ({
    from,
    to,
    exposureMs: exposure(from, to),
    eventsAt: episodes.filter((at) => at >= from && at < to),
  });
  const before = period(appliedAt - thresholds.windowMs, appliedAt);
  const after = period(appliedAt, appliedAt + thresholds.windowMs);
  const hour = 3_600_000;
  const rateBefore = before.exposureMs === 0 ? null : before.eventsAt.length / (before.exposureMs / hour);
  const rateAfter = after.exposureMs === 0 ? null : after.eventsAt.length / (after.exposureMs / hour);
  const reduction = rateBefore === null || rateAfter === null || rateBefore === 0 ? null : 1 - rateAfter / rateBefore;
  const expectedAfter = rateBefore === null ? 0 : rateBefore * (after.exposureMs / hour);
  let chance: number | null = null;
  let verdict: VerificationVerdict = "sin-exposicion";
  if (expectedAfter >= thresholds.minExpectedEvents && before.exposureMs > 0 && after.exposureMs > 0) {
    const a = before.eventsAt.length;
    const b = after.eventsAt.length;
    const share = after.exposureMs / (before.exposureMs + after.exposureMs);
    chance = binomialTail(b, a + b, share, "lower");
    verdict = chance <= thresholds.maxChance ? ((reduction ?? 0) >= thresholds.effectiveReduction ? "eficaz" : "parcial") : "ineficaz";
  }
  return {
    algorithm: VERIFICATION_ALGORITHM,
    metric,
    appliedAt,
    before,
    after,
    rateBefore,
    rateAfter,
    reduction,
    chance,
    verdict,
    thresholds,
    sources: input.sources,
  };
}

/** La verificación en una frase, con sus cifras. No dice por qué. */
export function verificationText(result: VerificationResult): string {
  const hours = (ms: number): string => (ms / 3_600_000).toLocaleString("es-ES", { maximumFractionDigits: 1 });
  const rate = (value: number | null): string => (value === null ? "sin tiempo medido" : `${value.toLocaleString("es-ES", { maximumFractionDigits: 2 })} por hora`);
  const lines = [
    `Antes: ${result.before.eventsAt.length} en ${hours(result.before.exposureMs)} h (${rate(result.rateBefore)}).`,
    `Después: ${result.after.eventsAt.length} en ${hours(result.after.exposureMs)} h (${rate(result.rateAfter)}).`,
  ];
  if (result.reduction !== null) lines.push(`${result.reduction >= 0 ? "Baja" : "Sube"} un ${Math.round(Math.abs(result.reduction) * 100)} %.`);
  if (result.chance !== null) {
    lines.push(`Ver tan pocos después por puro azar: ${result.chance < 0.001 ? "menos de 1 entre mil" : `${(result.chance * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`}.`);
  } else {
    lines.push("Con la tasa de antes, en el periodo de después se esperarían demasiado pocos para decir nada.");
  }
  lines.push(`Propuesta del programa: ${VERDICT_TEXT[result.verdict]}. La conclusión es tuya.`);
  return lines.join(" ");
}
