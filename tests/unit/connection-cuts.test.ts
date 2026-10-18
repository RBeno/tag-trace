/**
 * Cortes de conexión (`src/domain/connection-cuts.ts`, ADR-0017): casos límite, de caracterización.
 *
 * `connection-log.test.ts` prueba el camino normal —emparejar, clasificar, situar, resumir, colectivos
 * y los que no reconectan— con doce casos. Aquí se fijan los bordes que faltaban (revisión del
 * 2026-10-18, B-15): listas vacías y eventos que no abren nada, la clase en el límite exacto, un corte
 * abierto con la ventana antes de su inicio, los bordes inclusivos de la ventana colectiva y del solape
 * de apagados, que un solo AGV nunca hace un colectivo, lo que cuenta como «dentro» de un corte al
 * situarlo y el resumen sin nada.
 */

import { describe, expect, it } from "vitest";

import {
  classifyCut,
  locateCuts,
  markCollective,
  measuresCoverage,
  pairCuts,
  summarizeConnections,
  type ConnectionCut,
  type CutEnd,
  type CutReading,
} from "../../src/domain/connection-cuts.js";
import type { ConnectionEvent } from "../../src/domain/connection-log.js";

const THRESHOLDS = { microcutMaxMs: 10_000, cutMaxMs: 600_000, contrastToleranceMs: 30_000, collectiveWindowMs: 120_000, collectiveMinShare: 0.5, noisyVehicleRatio: 3, noisyVehicleMinCuts: 10 };
const T0 = Date.UTC(2026, 9, 6, 5, 0, 0);
const S = 1000;
const CLOCK = { hourOf: (utcMs: number): number => new Date(utcMs).getUTCHours(), dayOf: (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10) };

function event(agvId: string, offsetS: number, kind: ConnectionEvent["kind"], sourceRow = 2): ConnectionEvent {
  return { agvId, utcMs: T0 + offsetS * S, kind, rawKind: kind, coverage: "", ipTerminal: "", version: "", aux: "", mtc: null, sourceRow };
}

function cut(agvId: string, fromS: number, toS: number | null, end: CutEnd = "conexion"): ConnectionCut {
  const durationMs = toS === null ? 60 * S : (toS - fromS) * S;
  return {
    agvId,
    fromUtcMs: T0 + fromS * S,
    toUtcMs: toS === null ? null : T0 + toS * S,
    durationMs,
    end,
    cutClass: classifyCut(durationMs, THRESHOLDS, end),
    collective: false,
    lastTagId: null,
    lastReadUtcMs: null,
    nextTagId: null,
    nextReadUtcMs: null,
    location: "sin-situar",
    readingsInside: 0,
    sourceRow: 2,
  };
}

describe("cortes de conexión · casos límite (TC-386)", () => {
  it("pairCuts: sin eventos, solo conexiones o solo eventos desconocidos, no hay cortes", () => {
    expect(pairCuts([], T0, THRESHOLDS)).toEqual([]);
    expect(pairCuts([event("V1", 0, "conexion"), event("V1", 5, "conexion-tras-apagado")], T0 + 10 * S, THRESHOLDS)).toEqual([]);
    expect(pairCuts([event("V1", 0, "desconocido"), event("V1", 5, "desconocido")], T0 + 10 * S, THRESHOLDS)).toEqual([]);
  });

  it("la clase en el límite exacto: hasta el máximo de microcorte es microcorte y hasta el de corte es corte", () => {
    expect(classifyCut(0, THRESHOLDS)).toBe("microcorte");
    expect(classifyCut(600_000, THRESHOLDS)).toBe("corte");
    // Un abierto se clasifica con su mínimo conocido, como cualquier otro.
    expect(classifyCut(600_001, THRESHOLDS, "abierto")).toBe("caida");
  });

  it("un corte abierto con el final de la ventana antes de su inicio dura cero, no un número negativo", () => {
    const [open] = pairCuts([event("V1", 100, "desconexion")], T0 + 50 * S, THRESHOLDS);
    expect(open).toMatchObject({ end: "abierto", toUtcMs: null, durationMs: 0, cutClass: "microcorte" });
  });

  it("markCollective: un solo AGV nunca es colectivo, y la ventana de inicios incluye sus dos bordes", () => {
    // Dos cortes del mismo AGV a la vez: hacen falta dos AGV distintos.
    expect(markCollective([cut("V1", 0, 2), cut("V1", 0, 3)], 1, THRESHOLDS).map((entry) => entry.collective)).toEqual([false, false]);
    // V2 empieza justo a la ventana (120 s) de V1: colectivo; a 121 s, no.
    expect(markCollective([cut("V1", 0, 2), cut("V2", 120, 122)], 2, THRESHOLDS).map((entry) => entry.collective)).toEqual([true, true]);
    expect(markCollective([cut("V1", 0, 2), cut("V2", 121, 123)], 2, THRESHOLDS).map((entry) => entry.collective)).toEqual([false, false]);
    // Con cuatro AGV con registro y la mitad, hacen falta dos; con cinco, tres.
    expect(markCollective([cut("V1", 0, 2), cut("V2", 10, 12)], 5, THRESHOLDS).map((entry) => entry.collective)).toEqual([false, false]);
  });

  it("markCollective: dos apagados que solo se tocan en un instante se solapan; un corte normal largo no hace colectivo a un apagado", () => {
    // V2 se apaga justo cuando V1 vuelve (fin de uno = inicio del otro), fuera de la ventana de inicios.
    const touching = markCollective([cut("V1", 0, 3600, "tras-apagado"), cut("V2", 3600, 7200, "tras-apagado")], 2, THRESHOLDS);
    expect(touching.map((entry) => entry.collective)).toEqual([true, true]);
    // La caída de V1 encierra el apagado de V2, pero el solape solo cuenta entre apagados.
    const mixed = markCollective([cut("V1", 0, 7200), cut("V2", 3600, 4000, "tras-apagado")], 2, THRESHOLDS);
    expect(mixed.map((entry) => entry.collective)).toEqual([false, false]);
  });

  it("locateCuts: sin lecturas del AGV no se sitúa; una lectura en el instante del corte o de la reconexión cuenta como dentro; P y Q en el mismo tag es un tramo", () => {
    const readings: CutReading[] = [
      { agvId: "V1", tagId: "A", utcMs: T0 },
      { agvId: "V1", tagId: "B", utcMs: T0 + 10 * S },
      { agvId: "V1", tagId: "C", utcMs: T0 + 20 * S },
      { agvId: "V1", tagId: "C", utcMs: T0 + 30 * S },
      { agvId: "V1", tagId: "C", utcMs: T0 + 40 * S },
    ];
    const [lonely] = locateCuts([cut("V9", 5, 6)], readings, [["A", "B", "C"]]);
    expect(lonely).toMatchObject({ location: "sin-situar", lastTagId: null, nextTagId: null, readingsInside: 0 });
    // Del segundo 10 (lectura de B) al 30 (lectura de C): las dos son «dentro», P es A y Q la C del 40.
    const [inclusive] = locateCuts([cut("V1", 10, 30)], readings, [["A", "B", "C"]]);
    expect(inclusive).toMatchObject({ lastTagId: "A", nextTagId: "C", readingsInside: 3, location: "entre" });
    // Entre dos lecturas de C: P y Q son el mismo tag, y eso es un tramo.
    const [sameTag] = locateCuts([cut("V1", 32, 35)], readings, [["A", "B", "C"]]);
    expect(sameTag).toMatchObject({ lastTagId: "C", nextTagId: "C", readingsInside: 0, location: "tramo" });
    // Un corte abierto no tiene Q: todo lo de después es «dentro» y no se sitúa.
    const [open] = locateCuts([cut("V1", 25, null, "abierto")], readings, [["A", "B", "C"]]);
    expect(open).toMatchObject({ lastTagId: "C", nextTagId: null, readingsInside: 2, location: "sin-situar" });
  });

  it("measuresCoverage: un apagado o un colectivo no miden la cobertura; el resto, sí", () => {
    expect(measuresCoverage(cut("V1", 0, 2))).toBe(true);
    expect(measuresCoverage(cut("V1", 0, 2, "tras-apagado"))).toBe(false);
    expect(measuresCoverage({ ...cut("V1", 0, 2), collective: true })).toBe(false);
  });

  it("summarizeConnections sin nada: ceros, 24 horas vacías y ningún terminal ruidoso", () => {
    const summary = summarizeConnections([], [], [], [], THRESHOLDS, 0.01, CLOCK);
    expect(summary).toMatchObject({
      total: 0,
      byClass: { microcorte: 0, corte: 0, caida: 0, apagado: 0 },
      withoutSignalMs: 0,
      individual: 0,
      excludedNoisy: 0,
      noisyVehicles: [],
      fleetMedianRate: 0,
      notReconnecting: [],
      collectives: [],
      vehicles: [],
      heat: [],
      segments: [],
      sites: [],
      concentratedVehicles: [],
      contrast: { bursts: 0, burstsWithCut: 0, cuts: 0, cutsWithBurst: 0, readingsInsideFalls: 0, falls: 0 },
    });
    expect(summary.byHour).toEqual(Array.from({ length: 24 }, () => 0));
  });
});
