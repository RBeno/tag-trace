/**
 * Retención de lecturas por fuente y partición del registro antiguo (ADR-0015 §2, R-DAT-023).
 *
 * Son las dos funciones puras que sostienen la versión 6 del almacén: qué fuentes conservan sus
 * lecturas y cómo se parte un circuito de la versión 5. Se prueban sin IndexedDB, que es lo que las
 * hace probables en Node; la migración de verdad la cubre la prueba de navegador.
 */

import { describe, expect, it } from "vitest";

import type { Provenance, Reading } from "../../src/domain/reading.js";
import {
  distinctSources,
  partitionReadingsBySource,
  RETAINED_EXPORTS,
  retainedSources,
  splitLegacyCircuit,
  windowsOverlap,
} from "../../src/persistence/retention.js";

const HOUR = 3_600_000;

function source(sourceId: string, from: number | null, to: number | null, sourceHash = sourceId) {
  return { sourceId, sourceHash, complete: from === null || to === null ? null : { from, to } };
}

function reading(sourceId: string, row: number, utcMs: number, alsoFrom: readonly Provenance[] = []): Reading {
  const base = {
    time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" as const },
    agvId: "V1",
    tagId: "T1",
    provenance: { sourceId, sourceHash: sourceId, sourceRow: row },
  };
  return alsoFrom.length === 0 ? base : ({ ...base, alsoFrom } as Reading);
}

describe("R-DAT-023 · qué fuentes conservan sus lecturas", () => {
  it("sin fuentes no se retiene nada", () => {
    expect(retainedSources([])).toEqual(new Set());
  });

  it("con una sola fuente se retiene esa", () => {
    expect(retainedSources([source("a", 0, HOUR)])).toEqual(new Set(["a"]));
  });

  it("las dos últimas cargadas se retienen, se solapen o no (OQ-143 a, propietario 2026-09-27)", () => {
    // Solapadas: las dos.
    expect(retainedSources([source("a", 0, 2 * HOUR), source("b", HOUR, 3 * HOUR)])).toEqual(new Set(["a", "b"]));
    // Disjuntas: también las dos. Hasta el 2026-09-27 solo se retenía la última; la regla cambió.
    expect(retainedSources([source("a", 0, HOUR), source("b", 2 * HOUR, 3 * HOUR)])).toEqual(new Set(["a", "b"]));
    expect(RETAINED_EXPORTS).toBe(2);
  });

  it("nunca se retienen más de dos: la antepenúltima se retira aunque se solape con las otras", () => {
    const sources = [source("a", 0, 3 * HOUR), source("b", HOUR, 4 * HOUR), source("c", 2 * HOUR, 5 * HOUR)];
    expect(retainedSources(sources)).toEqual(new Set(["b", "c"]));
  });

  it("«últimas» es en orden de carga, no en el tiempo", () => {
    const sources = [source("tarde", 5 * HOUR, 6 * HOUR), source("medio", 3 * HOUR, 4 * HOUR), source("pronto", 0, HOUR)];
    expect(retainedSources(sources)).toEqual(new Set(["medio", "pronto"]));
  });

  it("volver a cargar un fichero retirado lo pone el último, con el sourceId de su primera carga (OQ-143 b)", () => {
    const sources = [source("a", 0, HOUR), source("b", 2 * HOUR, 3 * HOUR), source("c", 4 * HOUR, 5 * HOUR)];
    expect(retainedSources(sources)).toEqual(new Set(["b", "c"]));
    // El mismo fichero «a», con otro sourceId pero la misma huella: vuelve a la ventana y «b» sale.
    const reloaded = [...sources, source("a-bis", 0, HOUR, "a")];
    expect(retainedSources(reloaded)).toEqual(new Set(["c", "a"]));
    // Sigue sin ser una fuente nueva (R-DAT-005, INV-005).
    expect(distinctSources(reloaded).map((entry) => entry.sourceId)).toEqual(["a", "b", "c"]);
  });

  it("recargar uno que ya está retenido no cambia qué se retiene", () => {
    const sources = [source("a", 0, HOUR), source("b", 2 * HOUR, 3 * HOUR)];
    expect(retainedSources([...sources, source("b-bis", 2 * HOUR, 3 * HOUR, "b")])).toEqual(new Set(["a", "b"]));
    expect(retainedSources([...sources, source("a-bis", 0, HOUR, "a")])).toEqual(new Set(["a", "b"]));
  });

  it("una fuente sin ventana completa cuenta igual como carga", () => {
    expect(windowsOverlap(null, { from: 0, to: HOUR })).toBe(false);
    expect(retainedSources([source("a", 0, HOUR), source("b", null, null)])).toEqual(new Set(["a", "b"]));
  });
});

describe("migración 5→6 · partición de las lecturas por procedencia", () => {
  it("cada lectura va con su procedencia principal", () => {
    const partition = partitionReadingsBySource([reading("a", 1, 0), reading("b", 1, HOUR), reading("a", 2, 2 * HOUR)]);
    expect([...partition.keys()].sort()).toEqual(["a", "b"]);
    expect(partition.get("a")?.map((entry) => entry.provenance.sourceRow)).toEqual([1, 2]);
    expect(partition.get("b")).toHaveLength(1);
  });

  it("una lectura avalada por dos exportaciones queda en las dos, cada copia con su procedencia como principal", () => {
    const shared = reading("a", 3, HOUR, [{ sourceId: "b", sourceHash: "b", sourceRow: 7 }]);
    const partition = partitionReadingsBySource([shared]);
    expect(partition.get("a")).toEqual([shared]);
    const copy = partition.get("b")?.[0] as Reading & { alsoFrom: readonly Provenance[] };
    expect(copy.provenance).toEqual({ sourceId: "b", sourceHash: "b", sourceRow: 7 });
    expect(copy.alsoFrom).toEqual([{ sourceId: "a", sourceHash: "a", sourceRow: 3 }]);
    expect(copy.time.utcMs).toBe(HOUR);
  });

  it("partir un circuito antiguo deja las fuentes marcadas, sin instantánea, y solo las lecturas retenidas", () => {
    // Tres fuentes: con la regla de las dos últimas cargadas (OQ-143), la primera se retira.
    const split = splitLegacyCircuit({
      circuitId: "c",
      sources: [
        { ...source("a", 0, HOUR), fileName: "a.csv", importedAt: 1, acceptedRows: 2 },
        { ...source("b", 2 * HOUR, 3 * HOUR), fileName: "b.csv", importedAt: 2, acceptedRows: 1 },
        { ...source("c", 4 * HOUR, 5 * HOUR), fileName: "c.csv", importedAt: 3, acceptedRows: 1 },
      ],
      readings: [reading("a", 1, 0), reading("a", 2, HOUR), reading("b", 1, 2 * HOUR), reading("c", 1, 4 * HOUR)],
    });
    expect(split.sources.map((entry) => [entry.sourceId, entry.retained, entry.snapshot])).toEqual([
      ["a", false, false],
      ["b", true, false],
      ["c", true, false],
    ]);
    expect(Object.fromEntries(split.readings.map((entry) => [entry.sourceId, entry.readings]))).toEqual({
      b: [reading("b", 1, 2 * HOUR)],
      c: [reading("c", 1, 4 * HOUR)],
    });
  });

  it("si la fuente retenida compartía tramo con la retirada, ese tramo sigue en la retenida", () => {
    // Registro antiguo: la lectura común quedó con procedencia «a» y «b» en `alsoFrom`. «a» se retira
    // porque detrás vienen «b» y «c».
    const common = reading("a", 2, HOUR, [{ sourceId: "b", sourceHash: "b", sourceRow: 1 }]);
    const split = splitLegacyCircuit({
      circuitId: "c",
      sources: [
        { ...source("a", 0, HOUR), fileName: "a.csv", importedAt: 1, acceptedRows: 2 },
        { ...source("b", HOUR, 2 * HOUR), fileName: "b.csv", importedAt: 2, acceptedRows: 2 },
        { ...source("c", 3 * HOUR, 4 * HOUR), fileName: "c.csv", importedAt: 3, acceptedRows: 1 },
      ],
      readings: [reading("a", 1, 0), common, reading("b", 2, 2 * HOUR), reading("c", 1, 3 * HOUR)],
    });
    // «b» tiene sus dos lecturas, no una: la común no se pierde con «a».
    expect(Object.fromEntries(split.readings.map((entry) => [entry.sourceId, entry.readings.length]))).toEqual({ b: 2, c: 1 });
  });
});
