/**
 * Hipótesis, contramedidas y verificación del expediente (ADR-0018 D6 y D9, entrega 4).
 *
 * Lo que se fija:
 * - en el caso de TC-012, la hipótesis del AGV parado en `71012` es **compatible** y la sostienen él y
 *   los que esperan detrás; las de los de detrás están **contradichas** (había alguien parado delante);
 *   la de la conexión de `207` está **contradicha** porque siguió leyendo durante el corte; cada una
 *   dice qué comprobación la discrimina, y ninguna afirma una causa;
 * - confirmar o descartar exige texto y se guarda aparte, sin tocar la evidencia; una contradicha que
 *   alguien confirma cuenta, una descartada no;
 * - la métrica propuesta es la del síntoma; la verificación cuenta episodios en producción, en tiempo
 *   cubierto y fuera de otros expedientes, y propone eficaz, parcial, ineficaz o sin exposición con la
 *   prueba de azar; el texto no afirma causas;
 * - el ciclo de vida usa todo eso: planificar pide una hipótesis en pie y una contramedida; verificar,
 *   la contramedida aplicada; cerrar como verificada, la verificación registrada.
 */

import { describe, expect, it } from "vitest";

import { backtrack } from "../../src/domain/case-backtrack.js";
import { caseHypotheses, viableCount } from "../../src/domain/case-hypotheses.js";
import { metricText, proposeMetric, verificationText, verifyCountermeasure, type CaseMetric } from "../../src/domain/case-verification.js";
import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";
import {
  addCountermeasure,
  addHypothesis,
  applyCountermeasure,
  causalWordsIn,
  createCase,
  decideHypothesis,
  recordVerification,
  transition,
  transitionsFrom,
  type CaseRevision,
  type CaseWindow,
  type FrozenEvidence,
} from "../../src/domain/incident-case.js";
import type { Reading } from "../../src/domain/reading.js";
import { buildCriticalPointScenario, CRITICAL_TAG, scenarioContext, STALL_TAG, STALLED_AGV, WIFI_AGV, ZONE } from "../support/caso-punto-critico.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("hipótesis del caso de TC-012", () => {
  const scenario = buildCriticalPointScenario();
  const { truth } = scenario;
  const window: CaseWindow = { symptomFrom: truth.absenceFrom + MIN, symptomTo: truth.absenceTo, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN };
  const span = { from: window.symptomFrom - window.marginBeforeMs, to: window.symptomTo + window.marginAfterMs };
  const readings = scenario.readings.filter((reading) => reading.time.utcMs >= span.from && reading.time.utcMs <= span.to);
  const evidence: FrozenEvidence = { readings, connections: scenario.connections, context: scenarioContext(scenario.readings) };
  const chronology = backtrack({ window, agvId: null, tagIds: [CRITICAL_TAG], evidence });
  const views = caseHypotheses(chronology, evidence, []);

  it("el AGV parado aguas arriba es compatible, va primero y lo sostienen los que esperan detrás", () => {
    const first = views[0];
    expect(first?.key.startsWith(`detenido|${STALLED_AGV}|${STALL_TAG}|`)).toBe(true);
    expect(first?.status).toBe("compatible");
    expect(first?.favor[0]).toBe(chronology.firstDeviation);
    expect(first?.favor.length).toBeGreaterThan(1);
    expect(first?.check).toContain(`AGV ${STALLED_AGV} en ${STALL_TAG}`);
  });

  it("los de detrás están contradichos: alguien estaba parado delante cuando se detuvieron", () => {
    const followers = views.filter((view) => view.key.startsWith("detenido|") && !view.key.startsWith(`detenido|${STALLED_AGV}|`));
    expect(followers.length).toBeGreaterThan(0);
    for (const view of followers) {
      expect(view.status).toBe("contradicha");
      expect(view.against[0]?.text).toContain("ya estaba parado delante");
    }
  });

  it("la conexión de 207 está contradicha: siguió leyendo y avanzando durante el corte", () => {
    const wifi = views.find((view) => view.key.startsWith(`conexion|${WIFI_AGV}|`));
    expect(wifi?.status).toBe("contradicha");
    expect(wifi?.against[0]?.text).toMatch(/^Durante el corte siguió leyendo: \d+ lecturas en \d+ tags distintos/);
    expect(wifi?.against[0]?.provenance).toHaveLength(2);
  });

  it("las no contradichas van antes, y ningún texto afirma una causa", () => {
    const firstContradicted = views.findIndex((view) => view.status === "contradicha");
    expect(views.slice(firstContradicted).every((view) => view.status === "contradicha")).toBe(true);
    for (const view of views) for (const text of [view.text, view.check, ...view.against.map((entry) => entry.text)]) expect(causalWordsIn(text), text).toEqual([]);
    expect(viableCount(views)).toBe(views.filter((view) => view.status !== "contradicha").length);
  });

  it("una decisión se conserva por su clave; descartar baja al final y confirmar una contradicha la cuenta", () => {
    const top = views[0]!;
    const wifi = views.find((view) => view.key.startsWith("conexion|"))!;
    const decided = caseHypotheses(chronology, evidence, [
      { key: top.key, text: top.text, origin: "programa", decision: { state: "descartada", note: "El operario lo movió a mano.", at: 1 } },
      { key: wifi.key, text: wifi.text, origin: "programa", decision: { state: "confirmada", note: "Su registro lo dice.", at: 1 } },
      { key: "persona|1", text: "Una hipótesis mía.", origin: "persona", decision: null },
    ]);
    expect(decided[decided.length - 1]?.key).toBe(top.key);
    expect(decided.find((view) => view.key === wifi.key)?.decision?.state).toBe("confirmada");
    // Evidencia intacta: la decisión no cambia lo que dice el programa.
    expect(decided.find((view) => view.key === wifi.key)?.status).toBe("contradicha");
    expect(decided.find((view) => view.key === "persona|1")).toMatchObject({ origin: "persona", status: "abierta" });
    expect(viableCount(decided)).toBe(viableCount(views) - 1 + 1 + 1);
  });
});

/** Un tag que se lee cada 90 s durante `days` días desde `start`, con huecos de 20 min en `gaps`. */
function passes(start: number, days: number, gaps: readonly number[]): Reading[] {
  const out: Reading[] = [];
  const holes = [...gaps].sort((a, b) => a - b);
  let row = 2;
  for (let at = start; at < start + days * DAY; at += 90_000) {
    if (holes.some((hole) => at > hole && at < hole + 20 * MIN)) continue;
    out.push({ time: { utcMs: at, raw: "", zone: ZONE, flag: "ok" }, agvId: "201", tagId: "71018", provenance: { sourceId: "s", sourceHash: "h", sourceRow: row++ } });
  }
  return out;
}

describe("verificación de una contramedida", () => {
  // Lunes 2 de febrero de 2026, 00:00 en Madrid; la contramedida se aplica una semana después.
  const START = Date.UTC(2026, 1, 1, 23, 0);
  const APPLIED = START + 7 * DAY;
  const metric: CaseMetric = { kind: "sin-paso", tagId: "71018", minGapMs: 10 * MIN };
  const thresholds = PROVISIONAL_CONFIG.incidentCase.verification;
  /** `n` huecos en producción, ocho por día (a las 6:00, 8:00… 20:00), dentro de la semana del periodo. */
  const daytimeGaps = (from: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + Math.floor(i / 8) * DAY + (6 + 2 * (i % 8)) * HOUR);
  const run = (before: number, after: number, excluded: { from: number; to: number }[] = []) =>
    verifyCountermeasure({
      metric,
      appliedAt: APPLIED,
      readings: passes(START, 14, [...daytimeGaps(START, before), ...daytimeGaps(APPLIED, after)]),
      coverage: [{ from: START, to: START + 14 * DAY }],
      excluded,
      zone: ZONE,
      regimes: PROVISIONAL_CONFIG.regimes,
      thresholds,
      sources: [{ sourceHash: "h", fileName: "f.csv" }],
    });

  it("la métrica propuesta es la del síntoma", () => {
    expect(proposeMetric({ tagIds: ["71018"], agvId: null, symptomFrom: 0, symptomTo: 14.6 * MIN })).toEqual({ kind: "sin-paso", tagId: "71018", minGapMs: 14 * MIN });
    expect(proposeMetric({ tagIds: [], agvId: "7", symptomFrom: 0, symptomTo: 10_000 })).toEqual({ kind: "silencio-agv", agvId: "7", minGapMs: MIN });
    expect(proposeMetric({ tagIds: [], agvId: null, symptomFrom: 0, symptomTo: 1 })).toBeNull();
    expect(metricText(metric)).toBe("huecos de al menos 10 min sin paso por 71018, por hora de producción");
  });

  it("de 30 a 2: eficaz; de 40 a 25: parcial; de 20 a 18: ineficaz; sin episodios antes: sin exposición", () => {
    const strong = run(30, 2);
    expect(strong.before.eventsAt).toHaveLength(30);
    expect(strong.after.eventsAt).toHaveLength(2);
    expect(strong.verdict).toBe("eficaz");
    expect(strong.chance).toBeLessThan(0.001);
    expect(run(40, 25).verdict).toBe("parcial");
    expect(run(20, 18).verdict).toBe("ineficaz");
    const none = run(0, 0);
    expect(none.verdict).toBe("sin-exposicion");
    expect(none.chance).toBeNull();
  });

  it("solo cuenta la producción: la noche no suma exposición", () => {
    const result = run(5, 5);
    const nightShare = 7 / 24;
    expect(result.before.exposureMs).toBeCloseTo(7 * DAY * (1 - nightShare), -5);
  });

  it("las ventanas de otros expedientes no cuentan", () => {
    const firstDay = { from: START, to: START + DAY };
    const result = run(30, 2, [firstDay]);
    expect(result.before.eventsAt).toHaveLength(22);
    expect(result.before.exposureMs).toBeLessThan(run(30, 2).before.exposureMs);
  });

  it("el texto dice las cifras y la propuesta, sin causas", () => {
    const text = verificationText(run(30, 2));
    expect(text).toContain("Antes: 30 en");
    expect(text).toContain("Propuesta del programa: eficaz. La conclusión es tuya.");
    expect(causalWordsIn(text)).toEqual([]);
    expect(causalWordsIn(verificationText(run(0, 0)))).toEqual([]);
  });
});

describe("el ciclo de vida con hipótesis, contramedidas y verificación", () => {
  const T0 = Date.UTC(2026, 0, 20, 9, 0);
  async function investigating(): Promise<CaseRevision> {
    const draft = await createCase({
      circuitId: "c",
      caseId: "INC-c-20260120-01",
      now: T0,
      author: null,
      title: "Sin paso",
      symptom: "Nadie llega al punto crítico.",
      origin: { kind: "sintoma" },
      agvId: null,
      tagIds: ["71018"],
      window: { symptomFrom: T0, symptomTo: T0 + 10 * MIN, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN },
      evidence: { algorithm: "recorte-2", hash: null, readings: 0, vehicles: 0, sources: [], missing: [] },
      references: { memory: null, configVersion: "provisional-0", appVersion: "dev" },
    });
    const review = await transition(draft, "UnderReview", null, T0 + MIN, null);
    return transition(review, "Investigating", null, T0 + 2 * MIN, null);
  }
  const metric: CaseMetric = { kind: "sin-paso", tagId: "71018", minGapMs: 10 * MIN };

  it("planificar exige una hipótesis en pie y una contramedida; el análisis manda sobre lo guardado", async () => {
    const start = await investigating();
    expect(transitionsFrom(start, { viableHypotheses: 0 }).find((option) => option.to === "CountermeasurePlanned")?.unmet).toHaveLength(2);
    const measured = await addCountermeasure(start, { action: "Revisar el freno de 205", owner: "Mantenimiento", plannedAt: T0 + DAY, risk: "Ninguno", metric }, T0 + 3 * MIN, null);
    expect(measured.countermeasures[0]).toMatchObject({ id: "C1", appliedAt: null, metric });
    expect(transitionsFrom(measured, { viableHypotheses: 1 }).find((option) => option.to === "CountermeasurePlanned")?.unmet).toEqual([]);
    // Sin análisis, cuenta solo lo guardado: una hipótesis de la persona.
    const withOwn = await addHypothesis(measured, "El freno de 205.", T0 + 4 * MIN, "Ana");
    expect(withOwn.hypotheses[0]).toMatchObject({ key: "persona|1", origin: "persona", decision: null });
    expect(transitionsFrom(withOwn).find((option) => option.to === "CountermeasurePlanned")?.unmet).toEqual([]);
  });

  it("decidir exige texto; aplicar una vez; verificar solo pendiente de verificar y con la aplicada", async () => {
    const start = await investigating();
    await expect(decideHypothesis(start, { key: "k", text: "t", state: "confirmada", note: " " }, T0 + 3 * MIN, null)).rejects.toThrow("la comprobación que se hizo");
    const confirmed = await decideHypothesis(start, { key: "k", text: "Algo.", state: "confirmada", note: "Lo vi en planta." }, T0 + 3 * MIN, null);
    expect(confirmed.hypotheses).toEqual([{ key: "k", text: "Algo.", origin: "programa", decision: { state: "confirmada", note: "Lo vi en planta.", at: T0 + 3 * MIN } }]);
    expect(confirmed.change.text).toBe("Hipótesis confirmada por una persona: Algo.");
    const measured = await addCountermeasure(confirmed, { action: "Ajuste", owner: "Mantenimiento", plannedAt: T0 + DAY, risk: "", metric }, T0 + 4 * MIN, null);
    const planned = await transition(measured, "CountermeasurePlanned", null, T0 + 5 * MIN, null);
    expect(transitionsFrom(planned).find((option) => option.to === "VerificationPending")?.unmet).toEqual(["la fecha de aplicación de la contramedida"]);
    const applied = await applyCountermeasure(planned, "C1", T0 + DAY, T0 + DAY, null);
    await expect(applyCountermeasure(applied, "C1", T0 + 2 * DAY, T0 + 2 * DAY, null)).rejects.toThrow("ya consta como aplicada");
    const result = verifyCountermeasure({
      metric,
      appliedAt: T0 + DAY,
      readings: [],
      coverage: [],
      excluded: [],
      zone: ZONE,
      regimes: PROVISIONAL_CONFIG.regimes,
      thresholds: PROVISIONAL_CONFIG.incidentCase.verification,
      sources: [],
    });
    await expect(recordVerification(applied, result, "C1", T0 + 9 * DAY, null)).rejects.toThrow("pendiente de verificar");
    const pending = await transition(applied, "VerificationPending", null, T0 + 2 * DAY, null);
    expect(transitionsFrom(pending).find((option) => option.to === "VerifiedEffective")?.unmet).toEqual(["un periodo posterior cargado con la métrica calculada"]);
    const verified = await recordVerification(pending, result, "C1", T0 + 9 * DAY, null);
    expect(verified.verification).toMatchObject({ countermeasureId: "C1", result: { verdict: "sin-exposicion" } });
    const done = await transition(verified, "VerifiedIneffective", "Sin datos suficientes después; se vuelve a investigar.", T0 + 9 * DAY, null);
    expect(done).toMatchObject({ state: "VerifiedIneffective", conclusion: "Sin datos suficientes después; se vuelve a investigar." });
    for (const text of [confirmed.change.text, measured.change.text, applied.change.text, verified.change.text]) expect(causalWordsIn(text), text).toEqual([]);
  });

  it("fuera de la investigación no se añaden hipótesis ni contramedidas", async () => {
    const start = await investigating();
    const inconclusive = await transition(start, "Inconclusive", "Falta todo.", T0 + 3 * MIN, null);
    await expect(addHypothesis(inconclusive, "x", T0 + 4 * MIN, null)).rejects.toThrow("no admite hipótesis nuevas");
    await expect(addCountermeasure(inconclusive, { action: "a", owner: "b", plannedAt: T0, risk: "", metric }, T0 + 4 * MIN, null)).rejects.toThrow("no admite contramedidas");
  });
});
