/**
 * El banco de medida (F6, entrega 2; `PERFORMANCE_BUDGET.md` §2, §3 y §7).
 *
 * Lo que se fija:
 * - cada volumen tiene la forma de §2: PERF-D2 y D3 con su número exacto de lecturas, PERF-D4 con 48 h
 *   y 40 AGV, todos con 120 tags;
 * - el generador es determinista: la misma semilla da el mismo CSV;
 * - el CSV va en orden de pila descendente y el importador de verdad lo lee entero, sin cuarentena;
 * - cada métrica se juzga contra su presupuesto de §3 y lo que no se pudo medir sale «sin medir»,
 *   nunca «dentro»;
 * - el informe no lleva nada más que el sintético, el equipo y las cifras.
 */

import { describe, expect, it } from "vitest";

import { BENCH_SCENARIOS, benchMetrics, largeImportWarning, LARGEST_MEASURED_READINGS, benchReport, formatMetric, percentile, scenarioCsv, scenarioRows, type BenchRaw } from "../../src/application/perf-bench.js";
import { importReadings } from "../../src/ingestion/importer.js";

const scenario = (id: string) => BENCH_SCENARIOS.find((entry) => entry.id === id)!;
const raw: BenchRaw = { generationMs: 300, firstProgressMs: 120, totalMs: 9_000, frameGaps: [16, 17, 16, 40, 18, 16, 16, 17, 16, 300], heapPeakBytes: 180 * 1024 * 1024, replayFirstViewMs: 800, replayStepMs: [20, 30, 25], cancelMs: 400, failed: null };

describe("volúmenes de medida", () => {
  it("tienen la forma de §2", () => {
    expect(scenarioRows(scenario("PERF-D2"))).toHaveLength(100_000);
    const d4 = scenarioRows(scenario("PERF-D4"));
    const times = d4.map((row) => row.split(";")[0]!);
    expect(new Set(d4.map((row) => row.split(";")[1])).size).toBe(40);
    expect(new Set(d4.map((row) => row.split(";")[2])).size).toBe(120);
    expect(times[0]!.startsWith("19/01/2026 05:00:")).toBe(true);
    expect(times[times.length - 1]!.startsWith("21/01/2026 0")).toBe(true);
    expect(d4.length).toBeGreaterThan(400_000);
    expect(d4.length).toBeLessThan(500_000);
  });

  it("es determinista y va en orden de pila descendente", () => {
    const d2 = scenario("PERF-D2");
    const csv = scenarioCsv(scenarioRows(d2));
    expect(scenarioCsv(scenarioRows(d2))).toBe(csv);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Fecha;AGV;Tag");
    expect(lines[1]! > lines[lines.length - 1]!).toBe(true);
  });

  it("el importador de verdad lo lee entero", () => {
    const csv = scenarioCsv(scenarioRows(scenario("PERF-D2")));
    const result = importReadings(csv, { sourceId: "s", fileName: "perf-d2.csv", byteSize: csv.length, zone: "Europe/Madrid" }, { onProgress: () => {}, isCancelled: () => false });
    expect(result.readings).toHaveLength(100_000);
    expect(result.quarantine).toHaveLength(0);
  });
});

describe("métricas frente al presupuesto", () => {
  it("cada una con su presupuesto y su veredicto", () => {
    const metrics = benchMetrics(scenario("PERF-D2"), raw);
    const of = (key: string) => metrics.find((metric) => metric.key === key)!;
    expect(of("primer-progreso")).toMatchObject({ verdict: "dentro", budget: "< 500 ms" });
    expect(of("hueco-p95")).toMatchObject({ value: 300, verdict: "fuera" });
    expect(percentile([16, 17, 18, 19], 0.5)).toBe(18);
    expect(of("memoria")).toMatchObject({ verdict: "dentro", budget: "≤ 250 MiB" });
    expect(of("memoria").note).toContain("Solo el hilo principal");
    expect(metrics.some((metric) => metric.key === "replay-primera")).toBe(false);
  });

  it("lo que no se pudo medir sale «sin medir», nunca «dentro»", () => {
    const metrics = benchMetrics(scenario("PERF-D3"), { ...raw, heapPeakBytes: null, firstProgressMs: null, cancelMs: null, frameGaps: [] });
    for (const key of ["memoria", "primer-progreso", "cancelar", "hueco-p95"]) expect(metrics.find((metric) => metric.key === key)?.verdict, key).toBe("sin-medir");
    expect(metrics.find((metric) => metric.key === "memoria")?.note).toContain("administrador de tareas");
  });

  it("una cancelación que no se atendió queda fuera, no «sin medir»", () => {
    const metric = benchMetrics(scenario("PERF-D3"), { ...raw, cancelMs: 4_000, cancelIgnored: true }).find((entry) => entry.key === "cancelar")!;
    expect(metric).toMatchObject({ verdict: "fuera", value: 4_000 });
    expect(metric.note).toContain("No se atendió");
  });

  it("PERF-D4 añade la primera vista y el paso del replay", () => {
    const metrics = benchMetrics(scenario("PERF-D4"), raw);
    expect(metrics.find((metric) => metric.key === "replay-primera")).toMatchObject({ verdict: "dentro", budget: "< 2 s" });
    const fps = metrics.find((metric) => metric.key === "replay-fps")!;
    expect(fps).toMatchObject({ value: 40, verdict: "dentro" });
    expect(formatMetric(fps)).toBe("40 fps");
    expect(formatMetric({ ...fps, unit: "ms", value: 12_345 })).toBe("12,3 s");
  });

  it("el informe lleva el sintético, el equipo y las cifras, y nada más", () => {
    const report = benchReport({
      appVersion: "3.83.0",
      measuredAt: Date.UTC(2026, 9, 17),
      device: { userAgent: "x", cores: 8, memoryGb: 8, screen: "1080×2340", pixelRatio: 3, pointer: "táctil" },
      visibleThroughout: true,
      runs: [{ scenario: scenario("PERF-D2"), rows: 100_000, csvHash: "h", metrics: benchMetrics(scenario("PERF-D2"), raw), failed: null }],
    });
    expect(Object.keys(report)).toEqual(["kind", "format", "appVersion", "measuredAt", "device", "visibleThroughout", "runs"]);
    expect(report.measuredAt).toBe("2026-10-17T00:00:00.000Z");
  });

  it("un fichero mayor que lo medido avisa, con la memoria que declara el navegador si la hay", () => {
    expect(largeImportWarning(LARGEST_MEASURED_READINGS, 8)).toBeNull();
    const warning = largeImportWarning(800_000, 4);
    expect(warning).toContain("800.000 lecturas");
    expect(warning).toContain("declara 4 GB");
    expect(largeImportWarning(800_000, null)).not.toContain("declara");
  });
});
