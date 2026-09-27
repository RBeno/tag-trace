/**
 * El expediente como registro de eventos append-only (ADR-0017 §1–§3, R-INC-006, R-INC-007).
 *
 * Lo que se fija:
 *
 * - el estado vigente sale de recorrer los eventos, y corregir el síntoma no borra el anterior;
 * - solo una persona cambia de estado, fija la ventana elegida y confirma una causa; el programa
 *   propone la ventana, mide y relaciona con `precede`, `es-compatible-con` o `correlaciona`;
 * - las transiciones son las de `INCIDENTS_REPORTING.md` §7: cerrar exige conclusión, eficaz exige
 *   verificación (R-INC-003), y un expediente cerrado solo se reabre o se anota;
 * - el recorte de evidencia es la ventana de toda la flota, en el orden de ADR-0013, y su hash se
 *   reproduce.
 */

import { describe, expect, it } from "vitest";

import {
  appendCaseEvent,
  caseEvidence,
  caseProblem,
  evidenceDigestInput,
  foldCase,
  type CaseEvent,
  type CaseVersions,
} from "../../src/domain/incident-case.js";
import type { Reading } from "../../src/domain/reading.js";
import { semanticHash } from "../../src/domain/semantic-hash.js";

const PERSON = { kind: "persona", name: "responsable" } as const;
const PROGRAM = { kind: "programa", version: "onda-1" } as const;
const T = Date.UTC(2026, 0, 5, 8, 0, 0);
const SYMPTOM = { from: T + 60 * 60_000, to: T + 67 * 60_000, description: "AGV cargado parado 7 min en T10" };
const VERSIONS: CaseVersions = { algorithm: "onda-1", config: "provisional-0", memory: "v3", planSeq: 12 };

type Draft = CaseEvent extends infer E ? (E extends CaseEvent ? Omit<E, "seq" | "atUtcMs"> : never) : never;

/** Numera y fecha los eventos en orden, un minuto entre cada uno. */
function log(...drafts: Draft[]): CaseEvent[] {
  return drafts.map((draft, index) => ({ ...draft, seq: index + 1, atUtcMs: T + 2 * 60 * 60_000 + index * 60_000 }) as CaseEvent);
}

const OPEN: Draft = {
  kind: "abrir",
  author: PERSON,
  reason: "la línea se quedó sin AGV",
  caseId: "INC-0001",
  circuitId: "C-SINT",
  title: "Parada de 7 min en zona cargada",
  origin: { kind: "hallazgo", findingKey: "bloqueo:H:T10" },
  symptom: SYMPTOM,
};

describe("expediente de incidencia", () => {
  it("el estado vigente sale de recorrer los eventos, y corregir el síntoma deja visible el anterior", () => {
    const events = log(
      OPEN,
      { kind: "ventana", author: PROGRAM, reason: "una vuelta p50 antes, hasta la calma más una vuelta", proposed: true, window: { from: SYMPTOM.from - 800_000, to: SYMPTOM.to + 1_600_000 } },
      { kind: "sintoma", author: PERSON, reason: "empezó un minuto antes", symptom: { ...SYMPTOM, from: SYMPTOM.from - 60_000 } },
      { kind: "ventana", author: PERSON, reason: "acepto la propuesta", proposed: false, window: { from: SYMPTOM.from - 800_000, to: SYMPTOM.to + 1_600_000 } },
      { kind: "medicion", author: PROGRAM, reason: "onda del epicentro", measure: "onda", algorithm: "onda-1", resultHash: "abc" },
      { kind: "relacion", author: PROGRAM, reason: "el hueco llega a la línea con su tiempo de viaje", subject: "hueco H", verb: "es-compatible-con", object: "línea sin AGV" },
      { kind: "estado", author: PERSON, reason: "revisado", to: "en-revision" },
      { kind: "estado", author: PERSON, reason: "se investiga", to: "investigando" },
      { kind: "hipotesis", author: PERSON, reason: "primera idea", hypothesisId: "H1", text: "obstáculo en T10" },
      { kind: "evidencia", author: PERSON, reason: "cámara", hypothesisId: "H1", stance: "a-favor", text: "carro mal colocado" },
      { kind: "hipotesis", author: PERSON, reason: "alternativa", hypothesisId: "H2", text: "fallo de lector" },
      { kind: "retirar-hipotesis", author: PERSON, reason: "el AGV leyó bien antes y después", hypothesisId: "H2" },
    );
    const view = foldCase(events);
    expect(view.status).toBe("investigando");
    expect(view.symptom.from).toBe(SYMPTOM.from - 60_000);
    expect(view.symptomHistory).toEqual([SYMPTOM]);
    expect(view.proposedWindow).toEqual(view.window);
    expect(view.measurements.map((entry) => entry.measure)).toEqual(["onda"]);
    expect(view.hypotheses).toEqual([
      { hypothesisId: "H1", text: "obstáculo en T10", retired: false, inFavour: ["carro mal colocado"], against: [] },
      { hypothesisId: "H2", text: "fallo de lector", retired: true, inFavour: [], against: [] },
    ]);
    expect(view.relations[0]?.verb).toBe("es-compatible-con");
    expect(view.lastSeq).toBe(12);
  });

  it("el programa propone y mide, pero no decide: ni estado, ni ventana elegida, ni causa confirmada", () => {
    const base = log(OPEN);
    const at = { seq: 2, atUtcMs: T + 3 * 60 * 60_000 };
    for (const event of [
      { ...at, kind: "estado", author: PROGRAM, reason: "auto", to: "en-revision" },
      { ...at, kind: "ventana", author: PROGRAM, reason: "auto", proposed: false, window: { from: SYMPTOM.from, to: SYMPTOM.to } },
      { ...at, kind: "relacion", author: PROGRAM, reason: "auto", subject: "H", verb: "confirmado-como-causa", object: "línea" },
      { ...at, kind: "hipotesis", author: PROGRAM, reason: "auto", hypothesisId: "H1", text: "x" },
    ] as CaseEvent[]) {
      const result = appendCaseEvent(base, event);
      expect(result.problem).not.toBeNull();
      expect(result.events).toBe(base);
    }
    const confirmed = appendCaseEvent(base, { ...at, kind: "relacion", author: PERSON, reason: "visto en planta", subject: "H", verb: "confirmado-como-causa", object: "línea" });
    expect(confirmed.problem).toBeNull();
  });

  it("las transiciones son las de §7: cerrar exige conclusión, eficaz exige verificación, cerrado solo se reabre", () => {
    const toInvestigating = log(
      OPEN,
      { kind: "estado", author: PERSON, reason: "r", to: "en-revision" },
      { kind: "estado", author: PERSON, reason: "r", to: "investigando" },
    );
    const next = (events: CaseEvent[], draft: Draft) =>
      appendCaseEvent(events, { ...draft, seq: events.length + 1, atUtcMs: T + 4 * 60 * 60_000 + events.length * 60_000 } as CaseEvent);

    // Saltarse pasos no vale.
    expect(caseProblem(log(OPEN, { kind: "estado", author: PERSON, reason: "r", to: "cerrada" }))).toMatch(/no se pasa/);
    // Sin contramedida registrada no se planifica ninguna.
    expect(next(toInvestigating, { kind: "estado", author: PERSON, reason: "r", to: "contramedida-planificada" }).problem).toMatch(/contramedida/);

    let events = [...toInvestigating];
    const apply = (draft: Draft): void => {
      const result = next(events, draft);
      expect(result.problem).toBeNull();
      events = [...result.events];
    };
    apply({ kind: "contramedida", author: PERSON, reason: "r", countermeasureId: "C1", action: "señalizar T10", owner: "mantenimiento", dueUtcMs: T, risk: "bajo" });
    apply({ kind: "estado", author: PERSON, reason: "r", to: "contramedida-planificada" });
    apply({ kind: "estado", author: PERSON, reason: "r", to: "verificacion-pendiente" });
    // Eficaz sin verificación registrada, no (R-INC-003).
    expect(next(events, { kind: "estado", author: PERSON, reason: "r", to: "verificada-eficaz" }).problem).toMatch(/R-INC-003/);
    apply({ kind: "verificacion", author: PERSON, reason: "r", countermeasureId: "C1", before: "recuperación 13 min", after: "recuperación 4 min", effective: true });
    apply({ kind: "estado", author: PERSON, reason: "r", to: "verificada-eficaz" });
    // Cerrar sin conclusión escrita, no.
    expect(next(events, { kind: "estado", author: PERSON, reason: "r", to: "cerrada" }).problem).toMatch(/conclusión/);
    apply({ kind: "conclusion", author: PERSON, reason: "r", text: "la señalización redujo la recuperación" });
    apply({ kind: "estado", author: PERSON, reason: "r", to: "cerrada" });
    // Cerrado: nada salvo reabrir o anotar.
    expect(next(events, { kind: "hipotesis", author: PERSON, reason: "r", hypothesisId: "H9", text: "x" }).problem).toMatch(/cerrado/);
    apply({ kind: "nota", author: PROGRAM, reason: "r", text: "caso similar el día siguiente" });
    apply({ kind: "estado", author: PERSON, reason: "reaparece", to: "investigando" });
    expect(foldCase(events).status).toBe("investigando");
    expect(foldCase(events).countermeasures[0]?.verifications).toHaveLength(1);
  });

  it("el registro se valida entero: numeración, fechas, razón y ventana que contiene el síntoma", () => {
    const events = log(OPEN, { kind: "nota", author: PERSON, reason: "r", text: "x" });
    expect(caseProblem([{ ...(events[0] as CaseEvent), seq: 2 }])).toMatch(/número/);
    expect(caseProblem([events[0] as CaseEvent, { ...(events[1] as CaseEvent), atUtcMs: T }])).toMatch(/fecha/);
    expect(caseProblem([events[0] as CaseEvent, { ...(events[1] as CaseEvent), reason: " " }])).toMatch(/razón/);
    expect(caseProblem(log({ kind: "nota", author: PERSON, reason: "r", text: "x" }))).toMatch(/abrir/);
    expect(caseProblem(log(OPEN, { kind: "ventana", author: PERSON, reason: "r", proposed: false, window: { from: SYMPTOM.from + 1, to: SYMPTOM.to } }))).toMatch(/contener/);
    expect(caseProblem(log(OPEN, { kind: "evidencia", author: PERSON, reason: "r", hypothesisId: "H1", stance: "a-favor", text: "x" }))).toMatch(/H1/);
    expect(() => foldCase(log(OPEN, OPEN))).toThrow(/ya está abierto/);
  });

  it("el recorte es la ventana de toda la flota en el orden de ADR-0013, y su hash se reproduce", async () => {
    const reading = (utcMs: number, agvId: string, tagId: string, sourceHash: string, sourceRow: number): Reading => ({
      time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" },
      agvId,
      tagId,
      provenance: { sourceId: sourceHash, sourceHash, sourceRow },
    });
    const readings = [
      reading(T + 30, "A2", "T3", "hb", 7),
      reading(T - 1, "A1", "T1", "ha", 1),
      reading(T + 30, "A1", "T4", "ha", 9),
      reading(T, "A3", "0040", "hb", 2),
      reading(T + 61, "A1", "T5", "ha", 10),
    ];
    const cut = caseEvidence(readings, { from: T, to: T + 60 });
    // Fuera de la ventana no entra; en el mismo instante, por hash y fila; los ceros se conservan.
    expect(cut.map((entry) => `${entry.agvId}:${entry.tagId}`)).toEqual(["A3:0040", "A1:T4", "A2:T3"]);
    const first = await semanticHash(evidenceDigestInput(cut, VERSIONS));
    const again = await semanticHash(evidenceDigestInput(caseEvidence([...readings].reverse(), { from: T, to: T + 60 }), VERSIONS));
    expect(again).toBe(first);
    expect(await semanticHash(evidenceDigestInput(cut, { ...VERSIONS, config: "otra" }))).not.toBe(first);
  });
});
