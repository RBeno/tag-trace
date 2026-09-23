/**
 * FIFO en zona cargada (R-FLO-001): derivación de tramos y detección de adelantamiento.
 *
 * Lo que se fija aquí: un tramo que cruza el índice 0 del anillo no se corte en dos por accidente;
 * un tramo de un solo tag no se monta, porque no distingue entrada de salida; y —lo que más importa—
 * una inversión de orden dentro del jitter normal de lectura **no** cuenta como adelantamiento. Sin
 * esa guarda, cualquier tramo largo con tráfico honesto produciría hallazgos de la nada.
 */

import { describe, expect, it } from "vitest";

import {
  FIFO_FOCUS_MAX,
  buildFifoReport,
  loadedZoneSpans,
  type FifoThresholds,
  type LoadedSpan,
} from "../../src/domain/fifo.js";
import type { Reading } from "../../src/domain/reading.js";

const MINUTE = 60_000;

function read(agvId: string, tagId: string, utcMs: number): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "h", sourceRow: 1 },
  };
}

describe("tramos de zona cargada (loadedZoneSpans)", () => {
  it("un tramo contiguo simple", () => {
    const ring = ["A", "B", "C", "D", "E"];
    const zoneOf = new Map([
      ["A", "vacio"],
      ["B", "cargado"],
      ["C", "cargado"],
      ["D", "cargado"],
      ["E", "vacio"],
    ]);
    const { spans, problems } = loadedZoneSpans(ring, zoneOf);
    expect(problems).toEqual([]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.tags).toEqual(["B", "C", "D"]);
    expect(spans[0]?.entryTagId).toBe("B");
    expect(spans[0]?.exitTagId).toBe("D");
  });

  it("varios tramos discontiguos", () => {
    const ring = ["A", "B", "C", "D", "E", "F"];
    const zoneOf = new Map([
      ["A", "cargado"],
      ["B", "cargado"],
      ["C", "vacio"],
      ["D", "cargado"],
      ["E", "cargado"],
      ["F", "vacio"],
    ]);
    const { spans, problems } = loadedZoneSpans(ring, zoneOf);
    expect(problems).toEqual([]);
    expect(spans).toHaveLength(2);
    const tagSets = spans.map((span) => span.tags).sort();
    expect(tagSets).toEqual([
      ["A", "B"],
      ["D", "E"],
    ]);
  });

  it("un tramo que cruza el índice 0 del anillo no se parte en dos", () => {
    const ring = ["A", "B", "C", "D"];
    const zoneOf = new Map([
      ["A", "cargado"],
      ["B", "vacio"],
      ["C", "cargado"],
      ["D", "cargado"],
    ]);
    const { spans, problems } = loadedZoneSpans(ring, zoneOf);
    expect(problems).toEqual([]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.tags).toEqual(["C", "D", "A"]);
    expect(spans[0]?.entryTagId).toBe("C");
    expect(spans[0]?.exitTagId).toBe("A");
  });

  it("un anillo enteramente cargado no tiene frontera con la que acotar un tramo", () => {
    const ring = ["A", "B", "C"];
    const zoneOf = new Map(ring.map((tag) => [tag, "cargado"]));
    const { spans, problems } = loadedZoneSpans(ring, zoneOf);
    expect(spans).toEqual([]);
    expect(problems.join(" ")).toContain("frontera");
  });

  it("un anillo sin ninguna zona cargada declarada no produce tramos ni problemas", () => {
    const ring = ["A", "B", "C"];
    const zoneOf = new Map(ring.map((tag) => [tag, "vacio"]));
    const { spans, problems } = loadedZoneSpans(ring, zoneOf);
    expect(spans).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("un tramo de un solo tag no se monta: no distingue entrada de salida", () => {
    const ring = ["A", "B", "C", "D"];
    const zoneOf = new Map([
      ["A", "vacio"],
      ["B", "cargado"],
      ["C", "vacio"],
      ["D", "vacio"],
    ]);
    const { spans, problems } = loadedZoneSpans(ring, zoneOf);
    expect(spans).toEqual([]);
    expect(problems.join(" ")).toContain("B");
  });
});

describe("adelantamiento en un tramo (buildFifoReport, R-FLO-001)", () => {
  const SPAN: LoadedSpan = { spanId: "cargado-1", tags: ["100", "101", "102"], entryTagId: "100", exitTagId: "102" };
  const THRESHOLDS: FifoThresholds = { minPassesForSpan: 3, minOvertakeMarginMs: 1 * MINUTE, minOvertakeMarginRatio: 0.1 };

  function pass(agvId: string, enterMin: number, exitMin: number): readonly Reading[] {
    return [read(agvId, SPAN.entryTagId, enterMin * MINUTE), read(agvId, SPAN.exitTagId, exitMin * MINUTE)];
  }

  it("quien entra casi a la vez pero sale mucho después es adelantado por quien entró más tarde", () => {
    const readings = [
      ...pass("A", 0, 30),
      ...pass("D", 1, 50), // entra casi con A, pero se demora y sale el último
      ...pass("B", 10, 35),
      ...pass("C", 20, 40),
    ].flat();
    const report = buildFifoReport(1, readings, [SPAN], THRESHOLDS);
    const span = report.spans[0];
    expect(span?.passes).toBe(4);
    expect(span?.evaluated).toBe(true);
    expect(span?.overtakes).toHaveLength(1);
    expect(span?.overtakes[0]?.overtaken).toBe("D");
    expect(span?.overtakes[0]?.overtakenBy).toEqual(["B", "C"]);
    expect(span?.overtakes[0]?.transitMs).toBe(49 * MINUTE);
  });

  it("un margen de entrada insuficiente no cuenta como adelantamiento (regresión de falso positivo)", () => {
    const readings = [
      ...pass("A", 0, 30),
      ...pass("B", 1000, 1030),
      ...pass("C", 2000, 2030),
      // P y Q entran con solo 2 min de diferencia (< 1 min absoluto no, pero < 10% de 30 min = 3 min):
      // la inversión de salida existe, pero el margen de entrada no la sostiene.
      ...pass("P", 3000, 3030),
      ...pass("Q", 3002, 3028),
    ].flat();
    const report = buildFifoReport(1, readings, [SPAN], THRESHOLDS);
    const span = report.spans[0];
    expect(span?.evaluated).toBe(true);
    expect(span?.overtakes).toEqual([]);
  });

  it("un margen de salida insuficiente no cuenta como adelantamiento, aunque la entrada se separe de sobra", () => {
    const readings = [
      ...pass("A", 0, 30),
      ...pass("B", 1000, 1030),
      ...pass("C", 2000, 2030),
      // R y S entran separados 10 min (de sobra), pero S solo sale 2 min antes que R.
      ...pass("R", 4000, 4030),
      ...pass("S", 4010, 4028),
    ].flat();
    const report = buildFifoReport(1, readings, [SPAN], THRESHOLDS);
    const span = report.spans[0];
    expect(span?.evaluated).toBe(true);
    expect(span?.overtakes).toEqual([]);
  });

  it("por debajo de las pasadas mínimas no se evalúa el tramo, aunque exista una inversión fabricada", () => {
    const readings = [...pass("A", 0, 60), ...pass("B", 10, 20)].flat(); // B adelanta claramente a A
    const report = buildFifoReport(1, readings, [SPAN], THRESHOLDS);
    const span = report.spans[0];
    expect(span?.evaluated).toBe(false);
    expect(span?.medianTransitMs).toBeNull();
    expect(span?.overtakes).toEqual([]);
  });

  it("una pasada incompleta nunca se cuenta ni se fabrica", () => {
    const readings = [
      ...pass("A", 0, 30),
      ...pass("B", 10, 40),
      ...pass("C", 20, 50),
      // D entra dos veces seguidas sin salir entre medias: la primera entrada queda incompleta.
      read("D", SPAN.entryTagId, 60 * MINUTE),
      read("D", SPAN.entryTagId, 65 * MINUTE),
      read("D", SPAN.exitTagId, 90 * MINUTE),
      // E sale sin haber entrado antes: como es su primera lectura del tramo, queda «abierta al
      // inicio» (ya estaba dentro), no «incompleta» — y tampoco cuenta como pasada completa.
      read("E", SPAN.exitTagId, 5 * MINUTE),
      read("E", SPAN.entryTagId, 100 * MINUTE),
      read("E", SPAN.exitTagId, 130 * MINUTE),
      // F entra y se queda dentro: pasada abierta al final, sin salida en la muestra.
      read("F", SPAN.entryTagId, 200 * MINUTE),
    ].flat();
    const report = buildFifoReport(1, readings, [SPAN], THRESHOLDS);
    const span = report.spans[0];
    // Solo A, B, C, la segunda entrada de D y la segunda pasada de E son "completa": 5 pasadas.
    expect(span?.passes).toBe(5);
  });

  it("sin tramos no hay nada que evaluar", () => {
    const report = buildFifoReport(1, [], [], THRESHOLDS);
    expect(report.spans).toEqual([]);
  });
});

describe("ventana que se dibuja alrededor del adelantamiento (SpanReport.focus)", () => {
  const SPAN: LoadedSpan = { spanId: "cargado-1", tags: ["100", "101", "102"], entryTagId: "100", exitTagId: "102" };
  const THRESHOLDS: FifoThresholds = { minPassesForSpan: 3, minOvertakeMarginMs: 1 * MINUTE, minOvertakeMarginRatio: 0.1 };
  const pass = (agvId: string, enterMin: number, exitMin: number): readonly Reading[] => [
    read(agvId, SPAN.entryTagId, enterMin * MINUTE),
    read(agvId, SPAN.exitTagId, exitMin * MINUTE),
  ];

  it("lleva al adelantado y a todos los que lo adelantaron, en orden de entrada", () => {
    const readings = [...pass("A", 0, 30), ...pass("D", 1, 50), ...pass("B", 10, 35), ...pass("C", 20, 40)];
    const span = buildFifoReport(1, readings, [SPAN], THRESHOLDS).spans[0];
    expect(span?.focus.map((entry) => entry.agvId)).toEqual(["A", "D", "B", "C"]);
  });

  it("sin adelantamientos queda vacía", () => {
    const readings = [...pass("A", 0, 30), ...pass("B", 10, 40), ...pass("C", 20, 50)];
    expect(buildFifoReport(1, readings, [SPAN], THRESHOLDS).spans[0]?.focus).toEqual([]);
  });

  it("nunca pasa del tope, aunque el adelantado tenga decenas de vehículos por delante", () => {
    const readings = [
      ...pass("S", 0, 1000),
      ...Array.from({ length: 40 }, (_, index) => pass(`V${index}`, 10 + index * 2, 40 + index * 2)).flat(),
    ];
    const span = buildFifoReport(1, readings, [SPAN], THRESHOLDS).spans[0];
    expect(span?.focus.length).toBe(FIFO_FOCUS_MAX);
    expect(span?.focus[0]?.agvId).toBe("S");
  });
});
