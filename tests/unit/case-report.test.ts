/**
 * El informe del expediente y su exportación (ADR-0018 D11, `INCIDENTS_REPORTING.md` §8, entrega 5).
 *
 * Lo que se fija, sobre el caso de TC-012:
 * - el informe trae los diez apartados de §8 en orden, la revisión con su hash y las versiones;
 * - es autocontenido: ni una URL de fuera, ni un script;
 * - lo escrito por una persona se escapa y va marcado como suyo; el texto que genera el programa no
 *   afirma causas ni enseña referencias internas;
 * - el resumen del circuito pone un expediente por fila;
 * - los CSV traen una fila por hecho y por lectura, con su procedencia, sin que un texto rompa una fila.
 */

import { describe, expect, it } from "vitest";

import type { CaseView } from "../../src/application/protocol.js";
import { backtrack } from "../../src/domain/case-backtrack.js";
import { chronologyCsv, evidenceCsv } from "../../src/domain/case-export.js";
import { caseHypotheses, viableCount } from "../../src/domain/case-hypotheses.js";
import {
  caseSpan,
  causalWordsIn,
  contextText,
  createCase,
  decideHypothesis,
  evidenceText,
  originText,
  transition,
  transitionsFrom,
  type CaseWindow,
  type FrozenEvidence,
} from "../../src/domain/incident-case.js";
import { buildCaseReportHtml, caseReportFileName, casesSummaryHtml } from "../../src/presentation/case-report.js";
import { buildCriticalPointScenario, CRITICAL_TAG, scenarioContext } from "../support/caso-punto-critico.js";

const MIN = 60_000;
const iso = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 19).replace("T", " ");

async function caseView(): Promise<CaseView> {
  const scenario = buildCriticalPointScenario();
  const { truth } = scenario;
  const window: CaseWindow = { symptomFrom: truth.absenceFrom + MIN, symptomTo: truth.absenceTo, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN };
  const span = caseSpan(window);
  const readings = scenario.readings.filter((reading) => reading.time.utcMs >= span.from && reading.time.utcMs <= span.to);
  const evidence: FrozenEvidence = { readings, connections: scenario.connections, context: scenarioContext(scenario.readings) };
  const summary = { algorithm: "recorte-2", hash: "f".repeat(64), readings: readings.length, vehicles: 8, sources: [{ sourceId: "s", sourceHash: "h-punto-critico", fileName: "punto-critico.csv", from: "retenidas" as const, readings: readings.length }], missing: [], connections: 2, context: evidence.context?.origin ?? null };
  const draft = await createCase({
    circuitId: "critico",
    caseId: "INC-critico-20260120-01",
    now: truth.absenceTo + 60 * MIN,
    author: "Ana",
    title: "Sin llegada <script>alert(1)</script>",
    symptom: "Más de diez minutos sin llegadas; nota con ; y\\nsalto.",
    origin: { kind: "sintoma" },
    agvId: null,
    tagIds: [CRITICAL_TAG],
    window,
    evidence: summary,
    references: { memory: { version: 1, hash: "a".repeat(64) }, configVersion: "provisional-0", appVersion: "3.79.0" },
  });
  const review = await transition(draft, "UnderReview", null, draft.createdAt + MIN, null);
  const investigating = await transition(review, "Investigating", null, draft.createdAt + 2 * MIN, null);
  const chronology = backtrack({ window, agvId: null, tagIds: [CRITICAL_TAG], evidence });
  const first = caseHypotheses(chronology, evidence, [])[0]!;
  const decided = await decideHypothesis(investigating, { key: first.key, text: first.text, state: "confirmada", note: "El operario confirma un freno bloqueado." }, draft.createdAt + 3 * MIN, "Ana");
  const hypotheses = caseHypotheses(chronology, evidence, decided.hypotheses);
  return {
    current: decided,
    history: [draft, review, investigating, decided].map((entry) => ({ revision: entry.revision, createdAt: entry.createdAt, author: entry.author, change: entry.change, state: entry.state })),
    transitions: transitionsFrom(decided, { viableHypotheses: viableCount(hypotheses) }),
    span,
    originText: originText(decided.origin),
    evidenceText: evidenceText(decided.evidence),
    integrity: [],
    chronology,
    contextText: contextText(decided.evidence.context),
    hypotheses,
    metricProposal: null,
    similar: null,
  };
}

/** El texto del informe sin etiquetas, quitando lo que escribió una persona. */
function programText(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, "")
    .replace(/<p class="case-report-human">[\s\S]*?<\/p>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/g, " ");
}

describe("informe del expediente", () => {
  it("trae los diez apartados en orden, la revisión con su hash y las versiones", async () => {
    const view = await caseView();
    const html = buildCaseReportHtml(view, { formatInstant: iso, css: "", appVersion: "3.79.0", now: Date.UTC(2026, 9, 17) });
    const headings = [...html.matchAll(/<h2>(\d+)\. /g)].map((match) => Number(match[1]));
    expect(headings).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(html).toContain(view.current.hash);
    expect(html).toContain("recorte-2, retroceso-1");
    expect(html).toContain(`v1 · ${"a".repeat(64)}`);
    expect(html).toContain("Antes del síntoma");
    expect(html).toContain("primera desviación");
    expect(html).toContain("Confirmada por una persona:");
  });

  it("es autocontenido y escapa lo que escribe la persona", async () => {
    const html = buildCaseReportHtml(await caseView(), { formatInstant: iso, css: "", appVersion: "3.79.0", now: 0 });
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("el texto del programa no afirma causas ni enseña referencias internas", async () => {
    const text = programText(buildCaseReportHtml(await caseView(), { formatInstant: iso, css: "", appVersion: "3.79.0", now: 0 }));
    expect(causalWordsIn(text)).toEqual([]);
    expect(text).not.toMatch(/\b(OQ|ADR|R-[A-Z]{3})-\d/);
  });

  it("el resumen del circuito pone un expediente por fila", async () => {
    const view = await caseView();
    const html = casesSummaryHtml([view, view], iso);
    expect(html.match(/<tr><td>INC-critico-20260120-01<\/td>/g)).toHaveLength(2);
    expect(casesSummaryHtml([], iso)).toContain("no tiene expedientes");
  });

  it("el nombre del fichero no lleva nada que un sistema de ficheros rechace", () => {
    expect(caseReportFileName("INC-Línea 2/3-20260120-01", new Date(2026, 9, 17, 9, 5))).toBe("expediente-inc-linea-2-3-20260120-01-2026-10-17-0905.html");
    expect(caseReportFileName("INC-x", new Date(2026, 9, 17, 9, 5), "csv")).toBe("expediente-inc-x-2026-10-17-0905.csv");
  });
});

describe("exportación en CSV", () => {
  it("la cronología: una fila por hecho, con su relación y sus filas, sin romper ninguna", async () => {
    const view = await caseView();
    const csv = chronologyCsv(view.chronology!, iso, { caseId: view.current.caseId, revision: view.current.revision, hash: view.current.hash });
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(view.chronology!.facts.length + 2);
    expect(lines[0]).toContain(`revision ${view.current.revision}, hash ${view.current.hash}`);
    expect(lines.slice(2).every((line) => line.split(";").length === 12)).toBe(true);
    expect(lines.some((line) => line.includes(";precede;desviacion;"))).toBe(true);
    expect(lines.filter((line) => line.split(";")[8] === "sí")).toHaveLength(1);
  });

  it("las lecturas: una fila por lectura y por evento de conexión, con fichero, huella y fila", () => {
    const scenario = buildCriticalPointScenario();
    const evidence: FrozenEvidence = { readings: scenario.readings.slice(0, 5), connections: scenario.connections, context: null };
    const lines = evidenceCsv(evidence, { caseId: "c", revision: 2, hash: "x" }).split("\r\n");
    expect(lines).toHaveLength(5 + 2 + 2);
    expect(lines[2]).toMatch(/^lectura;20\/01\/2026 10:00:00;2026-01-20T09:00:00\.000Z;\d{3};\d{5};punto-critico;h-punto-critico;\d+$/);
    expect(lines[lines.length - 1]).toMatch(/^conexion;;2026-01-20T09:30:00\.000Z;207;Desconexión;;h-conexiones-207;3$/);
  });
});
