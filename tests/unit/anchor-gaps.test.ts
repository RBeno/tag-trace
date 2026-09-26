/**
 * Las sumas entre anclas de un solo fichero, para la instantánea (ADR-0015, R-DAT-021).
 *
 * Lo que se fija: una pasada va de un ancla a la siguiente por el mismo AGV, apunta los tags leídos
 * entre medias con su desfase, y no cruza una parada de la producción ni una calle de carga; con una
 * sola ancla el hueco es la vuelta entera; y lo que se guarda —p50, p80, pasadas, AGV distintos y
 * lecturas por tag— es lo que `structureBetweenSnapshots` necesita para comparar dos ficheros.
 */

import { describe, expect, it } from "vitest";

import { measureAnchorGaps, ringBetween } from "../../src/domain/anchor-gaps.js";
import type { Reading } from "../../src/domain/reading.js";

const SECOND = 1_000;
const RING = ["A", "B", "C", "D", "E", "F"];

let row = 0;
function reading(agvId: string, tagId: string, utcMs: number): Reading {
  row += 1;
  return { time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" }, agvId, tagId, provenance: { sourceId: "s", sourceHash: "s", sourceRow: row } };
}

/** `laps` vueltas de cada AGV, diez segundos por tramo; `skip` dice qué tags no lee cada AGV. */
function run(vehicles: readonly string[], laps: number, skip: (agvId: string) => ReadonlySet<string>): Reading[] {
  const out: Reading[] = [];
  vehicles.forEach((agvId, offset) => {
    for (let lap = 0; lap < laps; lap += 1) {
      const start = offset * SECOND + lap * RING.length * 10 * SECOND;
      RING.forEach((tagId, index) => {
        if (!skip(agvId).has(tagId)) out.push(reading(agvId, tagId, start + index * 10 * SECOND));
      });
    }
  });
  return out;
}

const WINDOW = { from: 0, to: 24 * 3_600_000 };
const context = (readings: readonly Reading[], anchors: readonly string[], productionStops: { from: number; to: number }[] = []) => ({
  readings,
  direction: "oldest-first" as const,
  ring: RING,
  anchors,
  coverage: [WINDOW],
  productionStops,
  laneTags: new Set<string>(),
  regimeOf: () => "produccion" as const,
  deliveries: [],
});

describe("ringBetween", () => {
  it("da los tags entre dos anclas sin incluirlas, dando la vuelta si hace falta", () => {
    expect(ringBetween(RING, "A", "D")).toEqual(["B", "C"]);
    expect(ringBetween(RING, "E", "B")).toEqual(["F", "A"]);
    expect(ringBetween(RING, "A", "A")).toEqual(["B", "C", "D", "E", "F"]);
  });
});

describe("measureAnchorGaps", () => {
  it("con dos anclas mide los dos huecos, con sus pasadas, sus AGV y las lecturas de cada tag", () => {
    const readings = run(["V1", "V2", "V3"], 4, (agvId) => new Set(agvId === "V3" ? ["C"] : []));
    const gaps = measureAnchorGaps(context(readings, ["A", "D"]));
    expect(gaps.map((gap) => [gap.fromAnchor, gap.toAnchor, gap.tags])).toEqual([
      ["A", "D", ["B", "C"]],
      ["D", "A", ["E", "F"]],
    ]);
    const first = gaps[0]!;
    expect(first.passes).toBe(12);
    expect(first.vehicleIds).toEqual(["V1", "V2", "V3"]);
    expect(first.produccion).toEqual({ samples: 12, p50Ms: 30 * SECOND, p80Ms: 30 * SECOND });
    expect(first.noche).toBeNull();
    expect(first.readsByTag["B"]).toEqual({ passes: 12, vehicles: 3, offsetMs: 10 * SECOND });
    // V3 nunca lee C: doce pasadas, ocho con C, de dos AGV.
    expect(first.readsByTag["C"]).toEqual({ passes: 8, vehicles: 2, offsetMs: 20 * SECOND });
    // La última vuelta de cada AGV no cierra el hueco D→A: tres pasadas menos.
    expect(gaps[1]!.passes).toBe(9);
  });

  it("con una sola ancla el hueco es la vuelta entera y todos los demás tags cuentan como leídos entre medias", () => {
    const readings = run(["V1", "V2"], 3, () => new Set());
    const gaps = measureAnchorGaps(context(readings, ["A"]));
    expect(gaps).toHaveLength(1);
    const lap = gaps[0]!;
    expect([lap.fromAnchor, lap.toAnchor]).toEqual(["A", "A"]);
    expect(lap.tags).toEqual(["B", "C", "D", "E", "F"]);
    expect(lap.passes).toBe(4);
    expect(lap.produccion?.p50Ms).toBe(60 * SECOND);
    expect(Object.keys(lap.readsByTag).sort()).toEqual(["B", "C", "D", "E", "F"]);
    expect(lap.readsByTag["F"]).toEqual({ passes: 4, vehicles: 2, offsetMs: 50 * SECOND });
  });

  it("un tag del hueco que nadie lee figura con cero, no desaparece", () => {
    const readings = run(["V1", "V2"], 2, () => new Set(["E"]));
    const gaps = measureAnchorGaps(context(readings, ["A", "D"]));
    expect(gaps[1]!.readsByTag["E"]).toEqual({ passes: 0, vehicles: 0 });
  });

  it("una pasada que cruza una parada de la producción no cuenta", () => {
    const readings = run(["V1"], 2, () => new Set());
    // La primera pasada A→D del único AGV (0 s → 30 s) cae dentro de la parada.
    const gaps = measureAnchorGaps(context(readings, ["A", "D"], [{ from: 5 * SECOND, to: 15 * SECOND }]));
    expect(gaps[0]!.passes).toBe(1);
  });

  it("un tag leído entre medias que no está en el anillo también se apunta: es un candidato a insertado", () => {
    const base = run(["V1", "V2"], 2, () => new Set());
    const extra = base.filter((entry) => entry.tagId === "B").map((entry) => reading(entry.agvId, "X", entry.time.utcMs + 5 * SECOND));
    const gaps = measureAnchorGaps(context([...base, ...extra], ["A", "D"]));
    expect(gaps[0]!.readsByTag["X"]).toEqual({ passes: 4, vehicles: 2, offsetMs: 15 * SECOND });
    expect(gaps[0]!.tags).toEqual(["B", "C"]);
  });

  it("sin anclas en el anillo no hay huecos", () => {
    expect(measureAnchorGaps(context(run(["V1"], 1, () => new Set()), ["Z"]))).toEqual([]);
  });
});
