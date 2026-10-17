/**
 * Los textos del Resumen y del informe que se pueden probar sin navegador (UX_SPEC §4.8, FR-026).
 *
 * La frase de estado es la conclusión antes de las cifras (FR-028: primero la conclusión): el nivel 2
 * de la conciencia situacional de Endsley —qué significa lo que se ve— en una línea, con el tono
 * reservado al riesgo, como manda la HMI de alto rendimiento: una planta sana no lleva color.
 */

export interface StatusInput {
  /** Hallazgos de rango 1 pendientes de revisar. */
  readonly pendingRank1: number;
  /** Hallazgos de rango 2 pendientes de revisar. */
  readonly pendingRank2: number;
  /** Todas las tarjetas de la bandeja, en cualquier estado. */
  readonly totalFindings: number;
  /** Tarjetas ya revisadas (confirmadas, descartadas o pospuestas). */
  readonly reviewed: number;
  /** Avisos del Resumen (UX_SPEC §4.6). */
  readonly notices: number;
  readonly coverageHours: number | null;
  readonly agvInCircuit: number | null;
  readonly agvAssigned: number | null;
}

export type StatusTone = "alerta" | "atencion" | "normal";

export interface Status {
  readonly tone: StatusTone;
  /** La conclusión, en una frase. */
  readonly headline: string;
  /** El contexto que la acompaña: cobertura, flota, avisos y revisión. */
  readonly detail: string;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function statusSentence(input: StatusInput): Status {
  let tone: StatusTone;
  let headline: string;
  if (input.pendingRank1 > 0) {
    tone = "alerta";
    headline = `${plural(input.pendingRank1, "hallazgo pendiente puede", "hallazgos pendientes pueden")} parar la planta o perder una función`;
    if (input.pendingRank2 > 0) headline += `; ${plural(input.pendingRank2, "más degrada", "más degradan")} el circuito`;
    headline += ".";
  } else if (input.pendingRank2 > 0) {
    tone = "atencion";
    headline = `Nada pendiente que pare la planta; ${plural(input.pendingRank2, "hallazgo degrada", "hallazgos degradan")} el circuito.`;
  } else if (input.totalFindings > 0) {
    tone = "normal";
    headline = "Nada pendiente que pare la planta ni degrade el circuito: lo que queda es limpieza y contexto, o ya está revisado.";
  } else {
    tone = "normal";
    headline = "Ningún hallazgo con lo cargado.";
  }
  const parts: string[] = [];
  parts.push(input.coverageHours === null ? "cobertura sin datos" : `cobertura de ${formatHours(input.coverageHours)}`);
  if (input.agvInCircuit !== null && input.agvAssigned !== null) parts.push(`${input.agvInCircuit} de ${input.agvAssigned} AGV en el circuito`);
  parts.push(input.notices === 0 ? "sin avisos" : plural(input.notices, "aviso", "avisos"));
  if (input.totalFindings > 0) parts.push(`${input.reviewed} de ${input.totalFindings} hallazgos revisados`);
  return { tone, headline, detail: `${parts.join(" · ")}.` };
}

export function formatHours(hours: number): string {
  if (hours >= 48) return `${Math.round(hours / 24)} días (${Math.round(hours)} h)`;
  return hours >= 10 ? `${Math.round(hours)} h` : `${hours.toFixed(1).replace(".", ",")} h`;
}

/** `informe-<circuito>-AAAA-MM-DD-HHMM.html`, con el circuito sin nada que un sistema de ficheros rechace. */
export function reportFileName(circuitId: string, at: Date): string {
  const slug = circuitId
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `informe-${slug === "" ? "circuito" : slug}-${stamp}.html`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string);
}
