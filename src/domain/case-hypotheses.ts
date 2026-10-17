/**
 * Hipótesis del expediente (ADR-0018 D6, `INCIDENTS_REPORTING.md` §4, pasos 7 y 8).
 *
 * Las candidatas **salen de lo que ya se mide** (D6), una por cada hecho de la cronología que precede al
 * síntoma y que puede explicarlo, con su evidencia:
 *
 * - **AGV detenido aguas arriba** (desviación, R-FLO-007): «el AGV X se detiene en A sin nadie parado
 *   delante y los de detrás esperan». A favor, su desviación y las de los AGV que se paran detrás de él
 *   mientras tanto (la cola, R-AGV-018). **En contra**, que otro AGV estuviera ya parado delante de él
 *   cuando se detuvo: entonces no es el primero de la cola (R-AGV-020).
 * - **Pérdida de conexión** (registro del terminal, ADR-0017): «el AGV X se detiene al perder la conexión».
 *   **En contra**, que durante el corte siguiera leyendo tags distintos: avanzaba.
 * - **AGV sin lecturas** (silencio): «el AGV X deja de registrar lecturas». Sin evidencia en contra
 *   calculable: lo que discrimina es dónde reaparece (la batería de mediciones, R-AGV-021).
 * - **Turno o régimen**: «el cambio de turno» o «el paso a la noche». Sin evidencia en contra calculable.
 *
 * Su estado (D6) es **compatible** si tiene evidencia a favor y ninguna en contra, **contradicha** si algo
 * observado la contradice, y **abierta** si no hay ni lo uno ni lo otro (las que escribe la persona). No
 * hay probabilidades: se ordenan primero las no contradichas, después por cuántos hechos las sostienen y
 * a igualdad por tiempo. Cada una dice qué comprobación la separa de las demás. Confirmar o descartar es
 * de una persona y se guarda aparte (`decideHypothesis`); no cambia la evidencia.
 */

import type { Chronology, ChronologyFact } from "./case-backtrack.js";
import type { FrozenEvidence, Hypothesis, HypothesisDecision } from "./incident-case.js";
import type { Provenance, Reading } from "./reading.js";

export type HypothesisStatus = "compatible" | "contradicha" | "abierta";

export interface HypothesisView {
  readonly key: string;
  readonly text: string;
  readonly origin: "programa" | "persona";
  /** Lo que dice el programa (D6). */
  readonly status: HypothesisStatus;
  /** Lo que decidió una persona, si decidió. */
  readonly decision: HypothesisDecision | null;
  /** Hechos de la cronología que la sostienen, por índice. */
  readonly favor: readonly number[];
  /** Lo observado que la contradice, con las filas que lo sostienen. */
  readonly against: readonly { readonly text: string; readonly provenance: readonly Provenance[] }[];
  /** Qué comprobación la separa mejor de las demás (paso 8). */
  readonly check: string;
}

export const HYPOTHESIS_STATUS_TEXT: Readonly<Record<HypothesisStatus, string>> = {
  compatible: "es compatible con lo observado",
  contradicha: "algo observado la contradice",
  abierta: "sin evidencia calculada",
};

interface Candidate {
  readonly key: string;
  readonly text: string;
  readonly favor: readonly number[];
  readonly against: HypothesisView["against"];
  readonly check: string;
  readonly at: number;
}

/** Las hipótesis del expediente: las candidatas del programa y las de la persona, con sus decisiones. */
export function caseHypotheses(chronology: Chronology, evidence: FrozenEvidence, stored: readonly Hypothesis[]): readonly HypothesisView[] {
  const facts = chronology.facts;
  const candidates: Candidate[] = [];
  const preceding = facts.map((fact, index) => ({ fact, index })).filter((entry) => entry.fact.relation === "precede");

  // AGV detenido aguas arriba: la primera desviación de cada AGV, por delante de cualquier otra suya.
  const deviations = preceding.filter((entry) => entry.fact.kind === "desviacion" && entry.fact.agvId !== null && entry.fact.upstream !== null);
  const firstOf = new Map<string, { fact: ChronologyFact; index: number }>();
  for (const entry of deviations) if (!firstOf.has(entry.fact.agvId as string)) firstOf.set(entry.fact.agvId as string, entry);
  const allDeviations = facts.map((fact, index) => ({ fact, index })).filter((entry) => entry.fact.kind === "desviacion" && entry.fact.upstream !== null);
  for (const [agvId, { fact, index }] of firstOf) {
    const until = fact.until ?? fact.at;
    const from = fact.tagIds[0] as string;
    // Delante de él: otro AGV más cerca del síntoma (menos tags aguas arriba) parado cuando él se detuvo.
    const ahead = allDeviations.filter(
      (entry) => entry.fact.agvId !== agvId && (entry.fact.upstream as number) < (fact.upstream as number) && entry.fact.at <= fact.at && (entry.fact.until ?? entry.fact.at) > fact.at,
    );
    // Detrás de él: los que se paran más lejos del síntoma mientras él sigue parado.
    const behind = allDeviations.filter(
      (entry) => entry.fact.agvId !== agvId && (entry.fact.upstream as number) > (fact.upstream as number) && entry.fact.at >= fact.at && entry.fact.at <= until,
    );
    candidates.push({
      key: `detenido|${agvId}|${from}|${fact.at}`,
      text: `El AGV ${agvId} se detiene en ${from} sin nadie parado delante, y los de detrás esperan en cola sin llegar al punto del síntoma.`,
      favor: [index, ...behind.map((entry) => entry.index)],
      against: ahead.map((entry) => ({
        text: `Cuando se detiene, el AGV ${entry.fact.agvId as string} ya estaba parado delante, más cerca del síntoma: no es el primero de la cola.`,
        provenance: entry.fact.provenance,
      })),
      check: `Comprobar en planta qué tuvo parado al AGV ${agvId} en ${from}: su registro de eventos, el operario o el elemento de delante.`,
      at: fact.at,
    });
  }

  // Pérdida de conexión: contradicha si durante el corte siguió leyendo tags distintos.
  const byVehicle = new Map<string, Reading[]>();
  for (const reading of evidence.readings) {
    const own = byVehicle.get(reading.agvId);
    if (own === undefined) byVehicle.set(reading.agvId, [reading]);
    else own.push(reading);
  }
  for (const { fact, index } of preceding.filter((entry) => entry.fact.kind === "corte-wifi" && entry.fact.agvId !== null)) {
    const agvId = fact.agvId as string;
    const end = fact.until ?? Number.POSITIVE_INFINITY;
    const inside = (byVehicle.get(agvId) ?? []).filter((reading) => reading.time.utcMs > fact.at && reading.time.utcMs < end).sort((a, b) => a.time.utcMs - b.time.utcMs);
    const tags = new Set(inside.map((reading) => reading.tagId));
    const moved = tags.size >= 2;
    candidates.push({
      key: `conexion|${agvId}|${fact.at}`,
      text: `El AGV ${agvId} se detiene al perder la conexión con el servidor.`,
      favor: [index],
      against: moved
        ? [
            {
              text: `Durante el corte siguió leyendo: ${inside.length} lecturas en ${tags.size} tags distintos, de ${(inside[0] as Reading).tagId} a ${(inside[inside.length - 1] as Reading).tagId}. Avanzaba.`,
              provenance: [(inside[0] as Reading).provenance, (inside[inside.length - 1] as Reading).provenance],
            },
          ]
        : [],
      check: `Ver en el registro del AGV ${agvId} si se detuvo al perder la señal; la hora de las lecturas que llegan durante un corte está por confirmar con el fabricante.`,
      at: fact.at,
    });
  }

  // AGV sin lecturas.
  for (const { fact, index } of preceding.filter((entry) => entry.fact.kind === "silencio-agv" && entry.fact.agvId !== null)) {
    const agvId = fact.agvId as string;
    candidates.push({
      key: `silencio|${agvId}|${fact.at}`,
      text: `El AGV ${agvId} deja de registrar lecturas desde ${fact.tagIds[0] as string}.`,
      favor: [index],
      against: [],
      check: `Mirar dónde reaparece el AGV ${agvId}: si los de detrás llegan antes que él, no se movía; si reaparece por delante, avanzaba sin registrar (lector, memoria o WiFi).`,
      at: fact.at,
    });
  }

  // Calendario.
  for (const { fact, index } of preceding.filter((entry) => entry.fact.kind === "turno" || entry.fact.kind === "regimen")) {
    candidates.push({
      key: `${fact.kind}|${fact.at}`,
      text: fact.kind === "turno" ? `El cambio de turno: ${fact.text.replace(/\.$/, "").toLowerCase()}.` : `El cambio de régimen: ${fact.text.replace(/\.$/, "").toLowerCase()}.`,
      favor: [index],
      against: [],
      check: "Mirar el calendario del circuito: si hubo relevo, descanso o parada planificada a esa hora.",
      at: fact.at,
    });
  }

  const decided = new Map(stored.map((hypothesis) => [hypothesis.key, hypothesis]));
  const views: (HypothesisView & { readonly at: number })[] = candidates.map((candidate) => ({
    key: candidate.key,
    text: candidate.text,
    origin: "programa",
    status: candidate.against.length > 0 ? "contradicha" : candidate.favor.length > 0 ? "compatible" : "abierta",
    decision: decided.get(candidate.key)?.decision ?? null,
    favor: candidate.favor,
    against: candidate.against,
    check: candidate.check,
    at: candidate.at,
  }));
  const known = new Set(candidates.map((candidate) => candidate.key));
  for (const hypothesis of stored) {
    if (known.has(hypothesis.key)) continue;
    // Las de la persona, y las del programa que ya no salen del recorte pero alguien decidió: se conservan.
    views.push({
      key: hypothesis.key,
      text: hypothesis.text,
      origin: hypothesis.origin,
      status: "abierta",
      decision: hypothesis.decision,
      favor: [],
      against: [],
      check: hypothesis.origin === "persona" ? "La comprobación la decide quien la propuso." : "Ya no sale del recorte: se conserva por la decisión que se tomó.",
      at: Number.POSITIVE_INFINITY,
    });
  }
  const rank = (view: HypothesisView): number => (view.decision?.state === "descartada" ? 2 : view.status === "contradicha" ? 1 : 0);
  views.sort((a, b) => rank(a) - rank(b) || b.favor.length - a.favor.length || a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return views.map(({ at: _at, ...view }) => view);
}

/** Cuántas siguen en pie: no contradichas por el programa ni descartadas por una persona. */
export function viableCount(views: readonly HypothesisView[]): number {
  return views.filter((view) => view.decision?.state !== "descartada" && (view.status !== "contradicha" || view.decision?.state === "confirmada")).length;
}
