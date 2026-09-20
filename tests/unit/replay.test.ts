/**
 * Replay básico determinista.
 *
 * Lo que hay que defender: la posición es fracción **temporal**, nunca física; un hueco que ya es
 * silencio no se disfraza de tránsito; y un vehículo sin lectura previa al fotograma no tiene
 * posición inventada.
 */

import { describe, expect, it } from "vitest";

import { buildReplayFrames } from "../../src/domain/replay.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
let row = 0;

function reading(utcMs: number, agvId: string, tagId: string): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

describe("replay básico", () => {
  it("un vehículo justo en una lectura sale en-tag, observed", () => {
    const readings = [reading(0, "A", "0100"), reading(100_000, "A", "0200")];
    const frames = buildReplayFrames(readings, 2, 1_000_000);

    expect(frames[0]?.vehicles.get("A")).toEqual({ kind: "en-tag", tagId: "0100", truth: "observed" });
  });

  it("a mitad de camino entre dos lecturas cercanas, la fracción es 0.5 y nunca posición física", () => {
    const readings = [reading(0, "A", "0100"), reading(100_000, "A", "0200")];
    // Frame en el punto medio exacto del rango: t = 50.000
    const frames = buildReplayFrames(readings, 3, 1_000_000);

    const middle = frames[1];
    expect(middle?.atUtcMs).toBe(50_000);
    const state = middle?.vehicles.get("A");
    expect(state?.kind).toBe("en-transito");
    if (state?.kind === "en-transito") {
      expect(state.fromTagId).toBe("0100");
      expect(state.toTagId).toBe("0200");
      expect(state.fraction).toBeCloseTo(0.5);
      expect(state.truth).toBe("inferred");
    }
  });

  it("un hueco que ya es silencio no se disfraza de tránsito", () => {
    // El hueco entre las dos lecturas es de 40 minutos; el umbral de silencio es 10 minutos, así
    // que a mitad de camino no hay "tránsito a fracción 0.5": hay silencio desde la última lectura.
    const readings = [reading(0, "A", "0100"), reading(2_400_000, "A", "0200")];
    const frames = buildReplayFrames(readings, 3, 600_000);

    const middle = frames[1]?.vehicles.get("A");
    expect(middle?.kind).toBe("silencio");
    if (middle?.kind === "silencio") expect(middle.lastTagId).toBe("0100");
  });

  it("sin lectura previa al fotograma, el vehículo no tiene posición inventada", () => {
    // B lee pronto; A no lee hasta bien entrada la ventana. El primer fotograma se alinea con la
    // lectura más temprana de cualquiera (la de B), momento en el que A no ha leído nada todavía.
    const readings = [reading(0, "B", "0900"), reading(500_000, "A", "0100")];
    const frames = buildReplayFrames(readings, 2, 100_000);

    expect(frames[0]?.atUtcMs).toBe(0);
    expect(frames[0]?.vehicles.get("A")?.kind).toBe("silencio");
  });

  it("una última lectura reciente, sin siguiente, sigue en-tag hasta que pasa el umbral", () => {
    const readings = [reading(0, "A", "0100")];
    const frames = buildReplayFrames(readings, 2, 50_000);

    // Único fotograma en t=0: justo en la lectura.
    expect(frames[0]?.vehicles.get("A")?.kind).toBe("en-tag");
  });

  it("sin lecturas, no hay fotogramas", () => {
    expect(buildReplayFrames([], 10, 60_000)).toHaveLength(0);
  });
});
