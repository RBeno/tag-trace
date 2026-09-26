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

  it("la última cargada se retiene siempre, y la anterior solo si sus ventanas se solapan", () => {
    // Solapadas: las dos.
    expect(retainedSources([source("a", 0, 2 * HOUR), source("b", HOUR, 3 * HOUR)])).toEqual(new Set(["a", "b"]));
    // Disjuntas: solo la última.
    expect(retainedSources([source("a", 0, HOUR), source("b", 2 * HOUR, 3 * HOUR)])).toEqual(new Set(["b"]));
    // Contiguas por un instante también se solapan: no hay hueco entre ellas.
    expect(retainedSources([source("a", 0, HOUR), source("b", HOUR, 2 * HOUR)])).toEqual(new Set(["a", "b"]));
  });

  it("nunca se retienen más de dos: la antepenúltima se retira aunque se solape con las otras", () => {
    const sources = [source("a", 0, 3 * HOUR), source("b", HOUR, 4 * HOUR), source("c", 2 * HOUR, 5 * HOUR)];
    expect(retainedSources(sources)).toEqual(new Set(["b", "c"]));
  });

  it("«anterior» es la anterior en orden de carga, no la más cercana en el tiempo", () => {
    // Se carga primero la ventana más tardía y después la más temprana, disjuntas: solo la última cargada.
    expect(retainedSources([source("tarde", 5 * HOUR, 6 * HOUR), source("pronto", 0, HOUR)])).toEqual(new Set(["pronto"]));
  });

  it("un fichero repetido no es una fuente nueva: no cambia la retención (R-DAT-005, INV-005)", () => {
    const withoutRepeat = [source("a", 0, HOUR), source("b", 2 * HOUR, 3 * HOUR)];
    // El mismo fichero «a» cargado otra vez, con otro sourceId pero la misma huella.
    const withRepeat = [...withoutRepeat, source("a-bis", 0, HOUR, "a")];
    expect(retainedSources(withRepeat)).toEqual(retainedSources(withoutRepeat));
    expect(distinctSources(withRepeat).map((entry) => entry.sourceId)).toEqual(["a", "b"]);
  });

  it("una fuente sin ventana completa no se solapa con nada", () => {
    expect(windowsOverlap(null, { from: 0, to: HOUR })).toBe(false);
    expect(retainedSources([source("a", 0, HOUR), source("b", null, null)])).toEqual(new Set(["b"]));
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
    const split = splitLegacyCircuit({
      circuitId: "c",
      sources: [
        { ...source("a", 0, HOUR), fileName: "a.csv", importedAt: 1, acceptedRows: 2 },
        { ...source("b", 2 * HOUR, 3 * HOUR), fileName: "b.csv", importedAt: 2, acceptedRows: 1 },
      ],
      readings: [reading("a", 1, 0), reading("a", 2, HOUR), reading("b", 1, 2 * HOUR)],
    });
    expect(split.sources.map((entry) => [entry.sourceId, entry.retained, entry.snapshot])).toEqual([
      ["a", false, false],
      ["b", true, false],
    ]);
    expect(split.readings).toEqual([{ sourceId: "b", readings: [reading("b", 1, 2 * HOUR)] }]);
  });

  it("si la fuente retenida compartía tramo con la retirada, ese tramo sigue en la retenida", () => {
    // Registro antiguo: la lectura común quedó con procedencia «a» y «b» en `alsoFrom`.
    const common = reading("a", 2, HOUR, [{ sourceId: "b", sourceHash: "b", sourceRow: 1 }]);
    const split = splitLegacyCircuit({
      circuitId: "c",
      sources: [
        { ...source("a", 0, HOUR), fileName: "a.csv", importedAt: 1, acceptedRows: 2 },
        { ...source("b", HOUR, 2 * HOUR), fileName: "b.csv", importedAt: 2, acceptedRows: 2 },
      ],
      readings: [reading("a", 1, 0), common, reading("b", 2, 2 * HOUR)],
    });
    // Solapadas: las dos se retienen, y «b» tiene sus dos lecturas, no una.
    expect(split.readings.map((entry) => [entry.sourceId, entry.readings.length])).toEqual([
      ["b", 2],
      ["a", 2],
    ]);
  });
});
