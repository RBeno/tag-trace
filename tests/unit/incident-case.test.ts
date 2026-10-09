/**
 * El expediente de incidencia (ADR-0018, entrega 1): identidad, márgenes, recorte congelado,
 * revisiones encadenadas, ciclo de vida y lenguaje sin causas (D6).
 *
 * Lo que se fija:
 * - el identificador es `INC-<circuito>-<aaaammdd>-<nn>` en el día de la zona del circuito;
 * - los márgenes propuestos salen de la configuración, la vuelta y la duración del síntoma;
 * - el recorte lleva las lecturas de todos los AGV en la ventana, sin repetir las de dos exportaciones
 *   que se solapan, y dice qué ficheros faltan sin inventar nada;
 * - cada revisión enlaza con la anterior, y una cadena manipulada se detecta;
 * - las transiciones son las de `INCIDENTS_REPORTING.md` §7 con `Discarded` y la reapertura (OQ-168),
 *   cada una con lo que exige;
 * - ningún texto que genera el módulo afirma una causa.
 */

import { describe, expect, it } from "vitest";

import {
  addNote,
  CASE_STATE_TEXT,
  caseSpan,
  CaseRefusal,
  causalWordsIn,
  changeWindow,
  createCase,
  evidenceText,
  freezeEvidence,
  nextCaseId,
  originText,
  proposeMargins,
  transition,
  transitionsFrom,
  verifyChain,
  type CaseOrigin,
  type CaseRevision,
  type CaseState,
  type CreateCaseInput,
  type EvidenceCandidate,
  type EvidenceSummary,
} from "../../src/domain/incident-case.js";
import type { Reading } from "../../src/domain/reading.js";

const MIN = 60_000;
const ZONE = "Europe/Madrid";
// 2026-10-09 10:00 en Madrid (UTC+2).
const T0 = Date.UTC(2026, 9, 9, 8, 0, 0);

function reading(agvId: string, tagId: string, utcMs: number, sourceId = "s1", row = 2): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId, sourceHash: `h-${sourceId}`, sourceRow: row },
  } as unknown as Reading;
}

const EMPTY_EVIDENCE: EvidenceSummary = { algorithm: "recorte-1", hash: null, readings: 0, vehicles: 0, sources: [], missing: [] };

function input(overrides: Partial<CreateCaseInput> = {}): CreateCaseInput {
  return {
    circuitId: "SINT",
    caseId: "INC-SINT-20261009-01",
    now: T0,
    author: null,
    title: "Punto crítico sin llegada",
    symptom: "Diez minutos sin AGV en el punto crítico de la línea.",
    origin: { kind: "sintoma" },
    agvId: null,
    tagIds: ["00120"],
    window: { symptomFrom: T0, symptomTo: T0 + 10 * MIN, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN },
    evidence: EMPTY_EVIDENCE,
    references: { memory: null, configVersion: "provisional-0", appVersion: "dev" },
    ...overrides,
  };
}

async function walk(start: CaseRevision, steps: readonly [CaseState, string | null][]): Promise<readonly CaseRevision[]> {
  const out = [start];
  let at = start.createdAt;
  for (const [to, text] of steps) {
    at += MIN;
    out.push(await transition(out[out.length - 1] as CaseRevision, to, text, at, null));
  }
  return out;
}

describe("identidad del expediente (OQ-167)", () => {
  it("es INC-<circuito>-<día en la zona>-<nn> y cuenta por circuito y día", () => {
    expect(nextCaseId("SINT", T0, ZONE, [])).toBe("INC-SINT-20261009-01");
    expect(nextCaseId("SINT", T0, ZONE, ["INC-SINT-20261009-01", "INC-SINT-20261009-03", "INC-OTRO-20261009-07"])).toBe("INC-SINT-20261009-04");
    // Otro día empieza en 01.
    expect(nextCaseId("SINT", T0 + 24 * 60 * MIN, ZONE, ["INC-SINT-20261009-05"])).toBe("INC-SINT-20261010-01");
  });

  it("el día es el de la zona del circuito, no el de UTC", () => {
    // 23:30 UTC del día 9 son las 01:30 del día 10 en Madrid.
    expect(nextCaseId("SINT", Date.UTC(2026, 9, 9, 23, 30), ZONE, [])).toBe("INC-SINT-20261010-01");
  });
});

describe("márgenes propuestos (D4, OQ-P02)", () => {
  const thresholds = { minMarginBeforeMs: 30 * MIN, minMarginAfterMs: 30 * MIN };

  it("sin vuelta y con un síntoma corto, el mínimo a cada lado", () => {
    const out = proposeMargins({ from: T0, to: T0 + 10 * MIN }, null, thresholds);
    expect(out).toMatchObject({ marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN });
    expect(out.reason).toContain("sin vuelta medida");
  });

  it("una vuelta más larga que el mínimo alarga solo el margen de antes", () => {
    const out = proposeMargins({ from: T0, to: T0 + 10 * MIN }, 45 * MIN, thresholds);
    expect(out).toMatchObject({ marginBeforeMs: 45 * MIN, marginAfterMs: 30 * MIN });
    expect(out.reason).toContain("vuelta mediana");
  });

  it("un síntoma más largo que todo alarga los dos", () => {
    const out = proposeMargins({ from: T0, to: T0 + 90 * MIN }, 45 * MIN, thresholds);
    expect(out).toMatchObject({ marginBeforeMs: 90 * MIN, marginAfterMs: 90 * MIN });
  });

  it("la ventana completa es el síntoma con sus márgenes", () => {
    expect(caseSpan({ symptomFrom: T0, symptomTo: T0 + MIN, marginBeforeMs: 5 * MIN, marginAfterMs: 2 * MIN })).toEqual({ from: T0 - 5 * MIN, to: T0 + 3 * MIN });
  });
});

describe("recorte congelado (D4)", () => {
  const span = { from: T0, to: T0 + 10 * MIN };
  const candidate = (sourceId: string, readings: readonly Reading[] | null, from: EvidenceCandidate["from"]): EvidenceCandidate => ({
    sourceId,
    sourceHash: `h-${sourceId}`,
    fileName: `${sourceId}.csv`,
    complete: { from: T0 - 60 * MIN, to: T0 + 60 * MIN },
    readings,
    from,
  });

  it("lleva todos los AGV de la ventana y nada de fuera", async () => {
    const out = await freezeEvidence(
      [candidate("s1", [reading("1", "A", T0 - MIN), reading("1", "A", T0 + MIN), reading("2", "B", T0 + 2 * MIN), reading("3", "C", T0 + 11 * MIN)], "retenidas")],
      span,
    );
    expect(out.readings.map((entry) => entry.agvId)).toEqual(["1", "2"]);
    expect(out.summary).toMatchObject({ readings: 2, vehicles: 2, missing: [] });
    expect(out.summary.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dos exportaciones que se solapan no repiten la misma lectura", async () => {
    const shared = reading("1", "A", T0 + MIN, "s1", 5);
    const again = reading("1", "A", T0 + MIN, "s2", 9);
    const out = await freezeEvidence([candidate("s1", [shared], "retenidas"), candidate("s2", [again, reading("2", "B", T0 + 3 * MIN, "s2", 10)], "archivo")], span);
    expect(out.readings).toHaveLength(2);
    expect(out.summary.sources.map((source) => [source.sourceId, source.from, source.readings])).toEqual([
      ["s1", "retenidas", 1],
      ["s2", "archivo", 1],
    ]);
  });

  it("una fuente que toca la ventana sin lecturas queda en «faltan», y sin ninguna no hay recorte", async () => {
    const out = await freezeEvidence([candidate("s1", null, null)], span);
    expect(out.summary).toMatchObject({ hash: null, readings: 0, missing: [{ sourceId: "s1", fileName: "s1.csv" }] });
    expect(evidenceText(out.summary)).toContain("desconocido");
    expect(evidenceText(out.summary)).toContain("«s1.csv»");
  });

  it("el hash no depende de campos accesorios de la unión", async () => {
    const plain = reading("1", "A", T0 + MIN);
    const withExtra = { ...plain, alsoFrom: ["s9"] } as unknown as Reading;
    const a = await freezeEvidence([candidate("s1", [plain], "retenidas")], span);
    const b = await freezeEvidence([candidate("s1", [withExtra], "retenidas")], span);
    expect(a.summary.hash).toBe(b.summary.hash);
  });
});

describe("creación y revisiones (D2)", () => {
  it("la revisión 1 es un borrador sellado, sin anterior", async () => {
    const first = await createCase(input({ author: "  Ana  " }));
    expect(first).toMatchObject({ revision: 1, state: "Draft", previousHash: null, author: "Ana", change: { kind: "creado" } });
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyChain([first])).toEqual([]);
  });

  it("sin título, sin síntoma o con la ventana al revés no se crea", async () => {
    await expect(createCase(input({ title: " " }))).rejects.toBeInstanceOf(CaseRefusal);
    await expect(createCase(input({ symptom: "" }))).rejects.toBeInstanceOf(CaseRefusal);
    await expect(createCase(input({ window: { symptomFrom: T0, symptomTo: T0 - 1, marginBeforeMs: 0, marginAfterMs: 0 } }))).rejects.toThrow(
      "anterior a su principio",
    );
    await expect(createCase(input({ window: { symptomFrom: T0, symptomTo: T0, marginBeforeMs: -1, marginAfterMs: 0 } }))).rejects.toThrow("negativo");
  });

  it("cada revisión enlaza con la anterior y una cadena manipulada se detecta", async () => {
    const first = await createCase(input());
    const second = await addNote(first, "Se avisa a mantenimiento.", T0 + MIN, null);
    const third = await transition(second, "UnderReview", null, T0 + 2 * MIN, null);
    expect(second).toMatchObject({ revision: 2, previousHash: first.hash, notes: [{ at: T0 + MIN, text: "Se avisa a mantenimiento." }] });
    expect(third.previousHash).toBe(second.hash);
    expect(await verifyChain([third, first, second])).toEqual([]);

    const tampered = { ...second, symptom: "Otra cosa." };
    expect(await verifyChain([first, tampered, third])).toEqual(["la revisión 2 no coincide con su hash"]);
    expect(await verifyChain([first, third])).toEqual(["falta la revisión 2", "la revisión 3 no enlaza con la anterior"]);
  });

  it("la ventana solo se cambia en borrador", async () => {
    const first = await createCase(input());
    const window = { symptomFrom: T0, symptomTo: T0 + 10 * MIN, marginBeforeMs: 60 * MIN, marginAfterMs: 45 * MIN };
    const changed = await changeWindow(first, window, EMPTY_EVIDENCE, first.references, T0 + MIN, null);
    expect(changed).toMatchObject({ revision: 2, window, change: { kind: "ventana" } });
    const review = await transition(changed, "UnderReview", null, T0 + 2 * MIN, null);
    await expect(changeWindow(review, window, EMPTY_EVIDENCE, first.references, T0 + 3 * MIN, null)).rejects.toThrow("solo se cambia en borrador");
  });

  it("una revisión no puede ser anterior a la vigente", async () => {
    const first = await createCase(input());
    await expect(addNote(first, "nota", T0 - 1, null)).rejects.toBeInstanceOf(CaseRefusal);
  });
});

describe("ciclo de vida (D3, OQ-168)", () => {
  it("borrador → revisión → investigando, sin nada más que la decisión", async () => {
    const steps = await walk(await createCase(input()), [
      ["UnderReview", null],
      ["Investigating", null],
    ]);
    expect(steps.map((step) => step.state)).toEqual(["Draft", "UnderReview", "Investigating"]);
  });

  it("planificar una contramedida exige hipótesis y contramedida; se dice qué falta", async () => {
    const [, , investigating] = await walk(await createCase(input()), [
      ["UnderReview", null],
      ["Investigating", null],
    ]);
    const option = transitionsFrom(investigating as CaseRevision).find((entry) => entry.to === "CountermeasurePlanned");
    expect(option?.unmet).toEqual(["al menos una hipótesis que nada contradiga", "una contramedida con responsable y fecha"]);
    await expect(transition(investigating as CaseRevision, "CountermeasurePlanned", null, T0 + 9 * MIN, null)).rejects.toThrow("falta al menos una hipótesis");
  });

  it("no concluyente exige qué falta, y se reabre con evidencia nueva", async () => {
    const steps = await walk(await createCase(input()), [
      ["UnderReview", null],
      ["Investigating", null],
      ["Inconclusive", "Faltan las lecturas del turno de noche."],
      ["Investigating", "Llegó la exportación del turno de noche."],
    ]);
    expect(steps[3]).toMatchObject({ state: "Inconclusive", stateReason: "Faltan las lecturas del turno de noche." });
    expect(steps[4]).toMatchObject({ state: "Investigating", change: { text: "Reabierto: de no concluyente a investigando." } });
    const investigating = steps[2] as CaseRevision;
    await expect(transition(investigating, "Inconclusive", "  ", T0 + 20 * MIN, null)).rejects.toThrow("hay que escribir");
  });

  it("descartar exige razón, solo desde borrador o revisión, y es final", async () => {
    const draft = await createCase(input());
    await expect(transition(draft, "Discarded", null, T0 + MIN, null)).rejects.toThrow("hay que escribir");
    const discarded = await transition(draft, "Discarded", "Parada planificada que nadie anotó.", T0 + MIN, null);
    expect(discarded).toMatchObject({ state: "Discarded", stateReason: "Parada planificada que nadie anotó." });
    expect(transitionsFrom(discarded)).toEqual([]);
    await expect(addNote(discarded, "nota", T0 + 2 * MIN, null)).rejects.toThrow("no admite notas");
    const [, , investigating] = await walk(draft, [
      ["UnderReview", null],
      ["Investigating", null],
    ]);
    await expect(transition(investigating as CaseRevision, "Discarded", "no", T0 + 9 * MIN, null)).rejects.toThrow("no pasa a descartado");
  });

  it("cada estado ofrece exactamente las transiciones del diagrama", async () => {
    const draft = await createCase(input());
    const from = (state: CaseState): readonly CaseState[] => transitionsFrom({ ...draft, state }).map((option) => option.to);
    expect(from("Draft")).toEqual(["UnderReview", "Discarded"]);
    expect(from("UnderReview")).toEqual(["Investigating", "Discarded"]);
    expect(from("Investigating")).toEqual(["CountermeasurePlanned", "Inconclusive"]);
    expect(from("CountermeasurePlanned")).toEqual(["VerificationPending"]);
    expect(from("VerificationPending")).toEqual(["VerifiedEffective", "VerifiedIneffective"]);
    expect(from("VerifiedEffective")).toEqual(["Closed"]);
    expect(from("VerifiedIneffective")).toEqual(["Investigating"]);
    expect(from("Inconclusive")).toEqual(["Investigating"]);
    expect(from("Closed")).toEqual(["Investigating"]);
    expect(from("Discarded")).toEqual([]);
  });
});

describe("lenguaje (D6)", () => {
  it("reconoce el vocabulario causal, con acentos y sin falsos positivos por subcadena", () => {
    expect(causalWordsIn("El corte causó la parada")).toEqual(["causó"]);
    expect(causalWordsIn("Se paró debido a la WiFi")).toEqual(["debido a"]);
    expect(causalWordsIn("La causa es el lector")).toEqual(["causa"]);
    expect(causalWordsIn("Precede al síntoma en dos minutos")).toEqual([]);
    expect(causalWordsIn("encausado")).toEqual([]);
  });

  it("ningún texto que genera el expediente afirma una causa", async () => {
    const texts: string[] = [...Object.values(CASE_STATE_TEXT)];
    const origins: readonly CaseOrigin[] = [
      { kind: "sintoma" },
      { kind: "incidencia-medida", key: "k", label: "AGV 7 en 00120" },
      { kind: "incidencia-excluida", version: 3, versionHash: "h", key: "k", label: "Primero de cola" },
      { kind: "hallazgo", key: "k", label: "Tag sin lecturas" },
    ];
    texts.push(...origins.map(originText));
    texts.push(evidenceText(EMPTY_EVIDENCE), evidenceText({ ...EMPTY_EVIDENCE, missing: [{ sourceId: "s", fileName: "f.csv" }] }));
    texts.push(proposeMargins({ from: 0, to: MIN }, null, { minMarginBeforeMs: MIN, minMarginAfterMs: MIN }).reason);
    // Todos los textos de cambio, de falta y de rechazo del ciclo de vida.
    const draft = await createCase(input());
    texts.push(draft.change.text);
    for (const state of Object.keys(CASE_STATE_TEXT) as CaseState[]) {
      for (const option of transitionsFrom({ ...draft, state })) {
        texts.push(...option.unmet, option.inputLabel ?? "");
        try {
          const done = await transition({ ...draft, state }, option.to, "texto", T0 + MIN, null);
          texts.push(done.change.text);
        } catch (error) {
          if (error instanceof CaseRefusal) texts.push(error.reason, error.recovery);
        }
      }
    }
    for (const text of texts) expect(causalWordsIn(text), text).toEqual([]);
  });
});
