/**
 * Biblioteca de casos y similitud explicada (ALG-017, ADR-0018 D10, entrega 6).
 *
 * Lo que se fija:
 * - otro caso del mismo punto crítico con la misma parada aguas arriba va antes que uno de otro tag y
 *   otra duración; cada característica se compara a la vista (igual, parecido, distinto, sin dato);
 * - el orden es por cuántas coinciden, con el mismo peso, y a igualdad el más reciente;
 * - un descartado no entra; el propio caso tampoco;
 * - lo confirmado en otro caso se enseña aparte y no toca nada del actual: su cronología y sus
 *   hipótesis siguen iguales;
 * - un hecho que se repite se cuenta, sin llamarlo correlación;
 * - ningún texto afirma una causa.
 */

import { describe, expect, it } from "vitest";

import { backtrack } from "../../src/domain/case-backtrack.js";
import { caseHypotheses } from "../../src/domain/case-hypotheses.js";
import { similarCases, type CaseLibraryEntry, type SimilarityThresholds } from "../../src/domain/case-similarity.js";
import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";
import { caseSpan, causalWordsIn, createCase, type CaseRevision, type CaseState, type CaseWindow, type FrozenEvidence } from "../../src/domain/incident-case.js";
import { buildCriticalPointScenario, CRITICAL_TAG, scenarioContext, STALL_TAG, STALLED_AGV, ZONE } from "../support/caso-punto-critico.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const thresholds: SimilarityThresholds = {
  zone: ZONE,
  sameTimeToleranceMs: PROVISIONAL_CONFIG.flowStops.sameTimeToleranceMs,
  shiftStartHours: PROVISIONAL_CONFIG.silenceKind.shiftStartHours,
  durationRatio: PROVISIONAL_CONFIG.incidentCase.similarityDurationRatio,
};

/** Un caso sobre el escenario de TC-012, desplazado `days` días, con su tag y su ventana. */
async function entry(caseId: string, options: { seed?: number; days?: number; tag?: string; lengthMs?: number; state?: CaseState; confirm?: boolean } = {}): Promise<CaseLibraryEntry> {
  const scenario = buildCriticalPointScenario(options.seed);
  const shift = (options.days ?? 0) * DAY;
  const readings = scenario.readings.map((reading) => ({ ...reading, time: { ...reading.time, utcMs: reading.time.utcMs + shift } }));
  const symptomFrom = scenario.truth.absenceFrom + MIN + shift;
  const window: CaseWindow = { symptomFrom, symptomTo: symptomFrom + (options.lengthMs ?? scenario.truth.absenceTo - scenario.truth.absenceFrom - MIN), marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN };
  const span = caseSpan(window);
  const evidence: FrozenEvidence = {
    readings: readings.filter((reading) => reading.time.utcMs >= span.from && reading.time.utcMs <= span.to),
    connections: [],
    context: scenarioContext(readings),
  };
  const tag = options.tag ?? CRITICAL_TAG;
  const chronology = backtrack({ window, agvId: null, tagIds: [tag], evidence });
  let revision: CaseRevision = await createCase({
    circuitId: "c",
    caseId,
    now: span.to + MIN,
    author: null,
    title: `Caso ${caseId}`,
    symptom: "Sin llegadas.",
    origin: { kind: "sintoma" },
    agvId: null,
    tagIds: [tag],
    window,
    evidence: { algorithm: "recorte-2", hash: "h", readings: evidence.readings.length, vehicles: 8, sources: [], missing: [] },
    references: { memory: null, configVersion: "provisional-0", appVersion: "dev" },
  });
  if (options.state !== undefined) revision = { ...revision, state: options.state };
  let hypotheses = caseHypotheses(chronology, evidence, []);
  if (options.confirm === true) {
    const top = hypotheses[0]!;
    hypotheses = caseHypotheses(chronology, evidence, [{ key: top.key, text: top.text, origin: "programa", decision: { state: "confirmada", note: "Freno bloqueado.", at: 1 } }]);
  }
  return { revision, chronology, hypotheses };
}

describe("casos parecidos", () => {
  it("la misma parada aguas arriba del mismo punto va antes que otro tag con otra duración", async () => {
    const target = await entry("A");
    const twin = await entry("B", { seed: 20260121, days: 1, confirm: true });
    const other = await entry("C", { days: 2, tag: "71005", lengthMs: 50 * MIN });
    const out = similarCases(target, [target, other, twin], thresholds);
    expect(out.similar.map((entry) => entry.caseId)).toEqual(["B", "C"]);
    const b = out.similar[0]!;
    const verdict = (name: string): string | undefined => b.features.find((feature) => feature.feature === name)?.verdict;
    expect(verdict("Síntoma")).toBe("igual");
    expect(verdict("Tags del síntoma")).toBe("igual");
    expect(b.features.find((feature) => feature.feature === "Primera desviación")).toMatchObject({ verdict: "igual", text: `${STALL_TAG} → 71013` });
    expect(["igual", "parecido"]).toContain(verdict("Hora del día"));
    expect(["igual", "parecido"]).toContain(verdict("Duración"));
    expect(verdict("Calles de carga y FIFO")).toBe("sin-dato");
    const c = out.similar[1]!;
    expect(c.features.find((feature) => feature.feature === "Tags del síntoma")).toMatchObject({ verdict: "distinto", text: `${CRITICAL_TAG} frente a 71005` });
    expect(c.features.find((feature) => feature.feature === "Duración")?.verdict).toBe("distinto");
    expect(b.matches).toBeGreaterThan(c.matches);
    expect(b.compared).toBe(b.features.filter((feature) => feature.verdict !== "sin-dato").length);
  });

  it("lo confirmado allí se enseña aparte y no toca el caso actual", async () => {
    const target = await entry("A");
    const before = JSON.stringify(target);
    const twin = await entry("B", { seed: 20260121, days: 1, confirm: true });
    const out = similarCases(target, [twin], thresholds);
    expect(out.similar[0]?.confirmedThere[0]).toContain("Freno bloqueado.");
    expect(out.similar[0]?.features.find((feature) => feature.feature === "Diagnóstico confirmado")).toMatchObject({ verdict: "sin-dato", text: "confirmado en aquel caso; no es evidencia para este" });
    expect(JSON.stringify(target)).toBe(before);
  });

  it("un hecho que se repite se cuenta, sin llamarlo correlación", async () => {
    const target = await entry("A");
    const out = similarCases(target, [await entry("B", { seed: 20260121, days: 1 })], thresholds);
    const repeated = out.repetitions.find((repetition) => repetition.text.startsWith(`AGV ${STALLED_AGV} tarda`));
    expect(repeated?.caseIds).toEqual(["B"]);
    expect(JSON.stringify(out)).not.toContain("correlaciona");
  });

  it("sin descartados ni el propio caso; a igualdad, el más reciente primero; ningún texto afirma una causa", async () => {
    const target = await entry("A");
    const older = await entry("B", { days: 1 });
    const newer = await entry("D", { days: 7 });
    const discarded = await entry("X", { days: 3, state: "Discarded" });
    const out = similarCases(target, [target, older, newer, discarded], thresholds);
    expect(out.similar.map((entry) => entry.caseId)).toEqual(["D", "B"]);
    for (const entry of out.similar) for (const feature of entry.features) expect(causalWordsIn(feature.text), feature.text).toEqual([]);
    expect(similarCases(target, [target, older, newer, discarded], thresholds)).toEqual(out);
  });
});
