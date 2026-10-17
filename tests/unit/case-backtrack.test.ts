/**
 * Retroceso desde el síntoma (ALG-015, ADR-0018 entrega 2) y el caso de oro de TC-012.
 *
 * Lo que se fija:
 * - TC-012: en un punto crítico sin llegada más de diez minutos, la cronología da el último paso antes
 *   y el primero después, la primera desviación aguas arriba (el AGV parado, a seis tags) y el corte de
 *   WiFi de otro AGV, **los dos como `precede`**: más de un hecho precede y ninguno se afirma como causa;
 * - cada hecho lleva su fase, y solo los anteriores al síntoma llevan relación, y es `precede`;
 * - la cronología es determinista (mismo recorte, misma cronología, en cualquier orden de lectura);
 * - un recorte sin contexto (`recorte-1`) no busca desviaciones y lo dice;
 * - turnos, régimen de noche y silencios de un AGV se sitúan donde caen;
 * - ningún texto de la cronología afirma una causa.
 */

import { describe, expect, it } from "vitest";

import { backtrack, formatDuration, type Chronology } from "../../src/domain/case-backtrack.js";
import { causalWordsIn, type CaseWindow, type FrozenEvidence } from "../../src/domain/incident-case.js";
import type { Reading } from "../../src/domain/reading.js";
import {
  buildCriticalPointScenario,
  CRITICAL_TAG,
  STALL_TAG,
  STALLED_AGV,
  WIFI_AGV,
  WIFI_FROM,
  scenarioContext,
  ZONE,
} from "../support/caso-punto-critico.js";

const MIN = 60_000;

function texts(chronology: Chronology): readonly string[] {
  return [...chronology.facts.map((fact) => fact.text), ...chronology.limits, ...chronology.declared.map((entry) => entry.text)];
}

describe("TC-012: punto crítico sin llegada más de diez minutos", () => {
  const scenario = buildCriticalPointScenario();
  const { truth } = scenario;
  // La persona marca el síntoma desde que lo nota, un minuto después del último paso, hasta el siguiente.
  const window: CaseWindow = { symptomFrom: truth.absenceFrom + MIN, symptomTo: truth.absenceTo, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN };
  const span = { from: window.symptomFrom - window.marginBeforeMs, to: window.symptomTo + window.marginAfterMs };
  const inSpan = scenario.readings.filter((reading) => reading.time.utcMs >= span.from && reading.time.utcMs <= span.to);
  const evidence: FrozenEvidence = { readings: inSpan, connections: scenario.connections, context: scenarioContext(scenario.readings) };
  const chronology = backtrack({ window, agvId: null, tagIds: [CRITICAL_TAG], evidence });

  it("el escenario planta lo que dice: más de diez minutos sin paso por el punto crítico, por la parada aguas arriba", () => {
    expect(truth.absenceTo - truth.absenceFrom).toBeGreaterThan(10 * MIN);
    expect(truth.stallTo - truth.stallFrom).toBeGreaterThan(13 * MIN);
    // El hueco empieza antes de que el AGV parado llegue al punto crítico y termina cuando llega.
    expect(truth.absenceFrom).toBeLessThan(truth.stallTo);
    expect(truth.firstAfter).toBe(STALLED_AGV);
  });

  it("da el último paso antes y el primero después, con lo que duró el hueco frente a lo habitual", () => {
    const absence = chronology.facts.find((fact) => fact.kind === "sin-paso");
    expect(absence).toMatchObject({ at: truth.absenceFrom, until: truth.absenceTo, phase: "antes", relation: "precede", agvId: truth.lastBefore, tagIds: [CRITICAL_TAG] });
    expect(absence?.text).toContain(`Último paso por ${CRITICAL_TAG} antes del síntoma: AGV ${truth.lastBefore}.`);
    expect(absence?.text).toContain(`El siguiente, AGV ${truth.firstAfter}, ${formatDuration(truth.absenceTo - truth.absenceFrom)} después`);
    expect(absence?.text).toMatch(/lo habitual antes del síntoma, en la ventana, es un paso cada 1 min \d+ s/);
    expect(absence?.provenance).toHaveLength(2);
  });

  it("la primera desviación es el AGV parado en 71012, seis tags aguas arriba, y precede", () => {
    expect(chronology.firstDeviation).not.toBeNull();
    const first = chronology.facts[chronology.firstDeviation as number];
    expect(first).toMatchObject({ kind: "desviacion", agvId: STALLED_AGV, tagIds: [STALL_TAG, "71013"], upstream: 6, relation: "precede", at: truth.stallFrom });
    expect(first?.text).toContain("por encima de lo habitual del fichero en ese tramo");
    // Los de detrás también se desvían, después y en cola: el primero sigue siendo el parado.
    const deviations = chronology.facts.filter((fact) => fact.kind === "desviacion");
    expect(deviations.length).toBeGreaterThan(1);
    expect(deviations.every((fact) => fact.at >= truth.stallFrom)).toBe(true);
  });

  it("el corte de WiFi de otro AGV también precede, sin que nada lo distinga como causa", () => {
    const wifi = chronology.facts.find((fact) => fact.kind === "corte-wifi");
    expect(wifi).toMatchObject({ agvId: WIFI_AGV, at: WIFI_FROM, relation: "precede", phase: "antes" });
    expect(wifi?.text).toContain("según el registro del terminal");
    expect(wifi?.connectionRows).toEqual([{ sourceHash: "h-conexiones-207", sourceRow: 3 }]);
    // Causa única no demostrada: más de un tipo de hecho precede, y todos llevan lo mismo.
    const preceding = chronology.facts.filter((fact) => fact.phase === "antes");
    expect(new Set(preceding.map((fact) => fact.kind)).size).toBeGreaterThan(1);
    expect(preceding.every((fact) => fact.relation === "precede")).toBe(true);
    expect(chronology.facts.filter((fact) => fact.phase !== "antes").every((fact) => fact.relation === null)).toBe(true);
  });

  it("cuenta los pares durante el síntoma y dice lo declarado del punto crítico", () => {
    const peers = chronology.facts.find((fact) => fact.kind === "pares");
    expect(peers).toMatchObject({ phase: "durante", relation: null, at: window.symptomFrom });
    expect(peers?.text).toMatch(/^Durante el síntoma leen \d de 8 AGV de la ventana/);
    expect(chronology.declared).toEqual([{ tagId: CRITICAL_TAG, text: "función: parada precisa" }]);
  });

  it("es determinista: el mismo recorte en otro orden da la misma cronología", () => {
    const shuffled = [...inSpan].reverse();
    expect(backtrack({ window, agvId: null, tagIds: [CRITICAL_TAG], evidence: { ...evidence, readings: shuffled } })).toEqual(chronology);
  });

  it("ningún texto de la cronología afirma una causa", () => {
    for (const text of texts(chronology)) expect(causalWordsIn(text), text).toEqual([]);
  });
});

describe("retroceso sin contexto o con calendario", () => {
  const T0 = Date.UTC(2026, 0, 20, 12, 30); // 13:30 en Madrid
  const reading = (agvId: string, tagId: string, utcMs: number, row: number): Reading => ({
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "h", sourceRow: row },
  });
  const readings = [
    reading("1", "71001", T0, 2),
    reading("1", "71002", T0 + MIN, 3),
    // 20 min sin leer, saltando de tag: un silencio, no una desviación.
    reading("1", "71009", T0 + 21 * MIN, 4),
    reading("2", "71005", T0 + 2 * MIN, 5),
  ];
  const window: CaseWindow = { symptomFrom: T0 + 25 * MIN, symptomTo: T0 + 35 * MIN, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN };

  it("un recorte de la entrega 1, sin contexto, no busca desviaciones y lo dice", () => {
    const out = backtrack({ window, agvId: null, tagIds: ["71009"], evidence: { readings, connections: [], context: null } });
    expect(out.facts.some((fact) => fact.kind === "desviacion" || fact.kind === "silencio-agv")).toBe(false);
    expect(out.limits.join(" ")).toContain("no se buscan desviaciones");
    expect(out.limits.join(" ")).toContain("Sin registro de conexiones del terminal");
  });

  it("con contexto: el cambio de turno de las 14:00 y el silencio del AGV, cada uno en su sitio", () => {
    const context = { ...scenarioContext(buildCriticalPointScenario().readings), edges: [] };
    const out = backtrack({ window, agvId: "2", tagIds: ["71009"], evidence: { readings, connections: [], context } });
    const shift = out.facts.find((fact) => fact.kind === "turno");
    // El síntoma va de 13:55 a 14:05: el turno empieza durante él, y lo de durante no lleva relación.
    expect(shift).toMatchObject({ at: Date.UTC(2026, 0, 20, 13, 0), phase: "durante", relation: null, text: "Empieza el turno de las 14:00." });
    const silence = out.facts.find((fact) => fact.kind === "silencio-agv" && fact.agvId === "1");
    expect(silence).toMatchObject({ at: T0 + MIN, until: T0 + 21 * MIN, upstream: 7, relation: "precede" });
    // El AGV 2 deja de leer al principio y no vuelve: silencio hasta el final de la ventana.
    expect(out.facts.find((fact) => fact.kind === "silencio-agv" && fact.agvId === "2")?.text).toContain("hasta el final de la ventana");
    const peers = out.facts.find((fact) => fact.kind === "pares");
    expect(peers?.text).toBe("Durante el síntoma leen 0 de 2 AGV de la ventana; sin ninguna lectura: 1, 2. El AGV del síntoma, 2, es de los que no leen.");
    for (const text of texts(out)) expect(causalWordsIn(text), text).toEqual([]);
  });

  it("un síntoma sin tags lo dice, y un tag que nadie lee en la ventana es desconocido", () => {
    const none = backtrack({ window, agvId: null, tagIds: [], evidence: { readings, connections: [], context: null } });
    expect(none.limits.join(" ")).toContain("no nombra ningún tag");
    const unread = backtrack({ window, agvId: null, tagIds: ["79999"], evidence: { readings, connections: [], context: null } });
    expect(unread.facts.find((fact) => fact.kind === "sin-paso")?.text).toBe("Ningún AGV lee 79999 en toda la ventana: no se sabe cuándo dejó de pasar.");
  });

  it("las duraciones se dicen en llano", () => {
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(12 * MIN + 30_000)).toBe("12 min 30 s");
    expect(formatDuration(125 * MIN)).toBe("2 h 5 min");
  });
});
