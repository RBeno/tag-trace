/**
 * Calles de carga online: configuración y máquina de estados.
 *
 * Lo que se fija aquí no es que el código corra, sino las cuatro frases que el producto no puede
 * decir mal: una parada de media hora en una calle **no es un silencio**; una calle por la que no
 * pasó nadie **no convierte sus tags en sospechosos**; un vehículo que sale sin haber entrado
 * **ya estaba dentro** y su calle no estaba vacía; y sin calles configuradas nada de esto se
 * reconoce, que es la degradación que R-CO-006 exige en lugar de la proximidad.
 */

import { describe, expect, it } from "vitest";

import {
  laneEntryTags,
  laneTags,
  readCoLanes,
  readZones,
  type ConfigEntry,
} from "../../src/domain/circuit-config.js";
import { buildChargingReport, type ChargingThresholds } from "../../src/domain/charging.js";
import type { Reading } from "../../src/domain/reading.js";

const THRESHOLDS: ChargingThresholds = { longStayRatio: 2, minStaysForMedian: 4 };

function entry(
  tagId: string,
  funcion: string,
  grupo: string,
  order: number | null = null,
  capacidad: number | null = null,
): ConfigEntry {
  return { tagId, order, funcion, grupo, capacidad };
}

function lane(id: string, base: number, capacity: number | null = 2): readonly ConfigEntry[] {
  return [
    entry(String(base), "entrada", id, 1, capacity),
    entry(String(base + 1), "parada-precisa", id, 2, capacity),
    entry(String(base + 2), "salida", id, 3, capacity),
  ];
}

const MINUTE = 60_000;

function read(agvId: string, tagId: string, utcMs: number): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "h", sourceRow: 1 },
  };
}

describe("configuración de calles (R-CO-001)", () => {
  it("monta una calle con sus tres papeles y su capacidad", () => {
    const { lanes, problems } = readCoLanes([...lane("calle-1", 700), ...lane("calle-2", 710)]);
    expect(problems).toEqual([]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.tags).toEqual(["700", "701", "702"]);
    expect(lanes[0]?.stopTagId).toBe("701");
    expect(lanes[0]?.exitTagId).toBe("702");
    expect(lanes[0]?.capacity).toBe(2);
    expect([...laneEntryTags(lanes)]).toEqual(["700", "710"]);
    expect(laneTags(lanes).size).toBe(6);
  });

  it("una calle sin parada precisa no se monta, y se dice por qué", () => {
    // Adivinar cuál de los tres es la parada por su posición sería sustituir la configuración por
    // proximidad, que es exactamente lo que R-CO-006 prohíbe.
    const incompleta = [entry("800", "entrada", "calle-x", 1), entry("802", "salida", "calle-x", 2)];
    const { lanes, problems } = readCoLanes(incompleta);
    expect(lanes).toEqual([]);
    expect(problems.join(" ")).toContain("parada-precisa");
  });

  it("una calle con el mismo papel dos veces no se monta", () => {
    const ambigua = [
      ...lane("calle-1", 700),
      entry("709", "parada-precisa", "calle-1", 4),
    ];
    const { lanes, problems } = readCoLanes(ambigua);
    expect(lanes).toEqual([]);
    expect(problems.join(" ")).toContain("más de");
  });

  it("un tag de carga sin calle se declara en vez de repartirse a ojo", () => {
    const { lanes, problems } = readCoLanes([entry("900", "entrada", "")]);
    expect(lanes).toEqual([]);
    expect(problems.join(" ")).toContain("900");
  });

  it("las zonas se leen por grupo y una contradicción se declara", () => {
    const { zoneOf, problems } = readZones([
      entry("10", "", "vacio"),
      entry("11", "", "cargado"),
      entry("10", "", "cargado"),
    ]);
    expect(zoneOf.get("10")).toBe("vacio");
    expect(zoneOf.get("11")).toBe("cargado");
    expect(problems.join(" ")).toContain("dos zonas");
  });
});

describe("máquina de estados de la calle (R-CO-002)", () => {
  const { lanes } = readCoLanes([...lane("calle-1", 700), ...lane("calle-2", 710)]);
  const coverage = [{ from: 0, to: 600 * MINUTE }];

  it("entrada, parada y salida de la misma calle es una estancia, no un silencio", () => {
    const readings = [
      read("A", "700", 10 * MINUTE),
      read("A", "701", 11 * MINUTE),
      read("A", "702", 41 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.served).toBe(true);
    expect(calle1?.stays).toHaveLength(1);
    expect(calle1?.stays[0]?.state).toBe("completa");
    expect(calle1?.stays[0]?.durationMs).toBe(30 * MINUTE);
    // La secuencia es observada; que estuviera cargando, inferido. Nunca `observed`.
    expect(calle1?.stays[0]?.truth).toBe("inferred");
  });

  it("una calle por la que no entró nadie no tiene estancias, y eso no acusa a sus tags", () => {
    const readings = [read("A", "700", 1 * MINUTE), read("A", "701", 2 * MINUTE), read("A", "702", 32 * MINUTE)];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle2 = report.lanes.find((item) => item.laneId === "calle-2");
    expect(calle2?.served).toBe(false);
    expect(calle2?.stays).toEqual([]);
    // No hay ningún campo que diga «tag sospechoso»: sin entradas no hubo oportunidad de leerlo.
    expect(calle2?.longStays).toEqual([]);
    expect(calle2?.outOfSeniority).toEqual([]);
  });

  it("el que sale sin haber entrado ya estaba dentro antes de la cobertura (R-CO-007)", () => {
    const readings = [
      // La primera lectura de toda su vida en esta ventana es la salida de la calle.
      read("B", "702", 5 * MINUTE),
      read("B", "999", 6 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    expect(report.startedInside).toHaveLength(1);
    expect(report.startedInside[0]?.agvId).toBe("B");
    expect(report.startedInside[0]?.state).toBe("abierta-al-inicio");
    expect(report.startedInside[0]?.enteredUtcMs).toBeNull();
    expect(report.startedInside[0]?.truth).toBe("inferred");
    // Y con el inicio de la cobertura se puede decir desde cuándo no se sabía, en vez de afirmar
    // que la calle estuvo vacía esos cinco minutos.
    expect(report.coverageStartUtcMs).toBe(0);
  });

  it("salir de una calle habiendo circulado antes no es arranque en frío", () => {
    const readings = [
      read("C", "999", 1 * MINUTE),
      read("C", "702", 5 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    expect(report.startedInside).toEqual([]);
  });

  it("al que entró antes y salió después se le saltó el turno (R-CO-003)", () => {
    const readings = [
      // D entra primero y sale el último; E y F entran después y salen antes.
      read("D", "700", 1 * MINUTE),
      read("D", "701", 2 * MINUTE),
      read("E", "700", 5 * MINUTE),
      read("E", "701", 6 * MINUTE),
      read("E", "702", 36 * MINUTE),
      read("F", "700", 40 * MINUTE),
      read("F", "701", 41 * MINUTE),
      read("F", "702", 71 * MINUTE),
      read("D", "702", 120 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.outOfSeniority).toHaveLength(1);
    expect(calle1?.outOfSeniority[0]?.waited).toBe("D");
    expect(calle1?.outOfSeniority[0]?.overtakenBy).toEqual(["E", "F"]);
  });

  it("sin calles configuradas no se reconoce nada, en vez de aproximarlo (R-CO-006)", () => {
    const readings = [read("A", "700", 1 * MINUTE), read("A", "702", 31 * MINUTE)];
    const report = buildChargingReport(readings, [], coverage, THRESHOLDS);
    expect(report.lanes).toEqual([]);
    expect(report.startedInside).toEqual([]);
  });

  it("una permanencia larga se mide contra la mediana de su propia calle", () => {
    const normal = (agv: string, start: number) => [
      read(agv, "700", start),
      read(agv, "701", start + MINUTE),
      read(agv, "702", start + 31 * MINUTE),
    ];
    const readings = [
      ...normal("A", 0),
      ...normal("B", 60 * MINUTE),
      ...normal("C", 120 * MINUTE),
      ...normal("D", 180 * MINUTE),
      // E se queda dentro tres horas: seis veces la mediana de media hora.
      read("E", "700", 240 * MINUTE),
      read("E", "701", 241 * MINUTE),
      read("E", "702", 421 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.medianStayMs).toBe(30 * MINUTE);
    expect(calle1?.longStays.map((stay) => stay.agvId)).toEqual(["E"]);
  });

  it("con pocas estancias no hay mediana, así que no se señala ninguna permanencia", () => {
    // Dos estancias no sostienen una mediana, y llamar «larga» a la mayor de dos es inventarse un
    // hallazgo. Sin soporte, no se dice nada.
    const readings = [
      read("A", "700", 0),
      read("A", "702", 30 * MINUTE),
      read("B", "700", 60 * MINUTE),
      read("B", "702", 300 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.medianStayMs).toBeNull();
    expect(calle1?.longStays).toEqual([]);
  });
});
