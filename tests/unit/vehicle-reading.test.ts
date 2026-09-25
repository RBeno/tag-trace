/**
 * Lectura por AGV sobre los tags que el resto lee bien (R-AGV-016).
 *
 * Lo que se fija: «nunca» es cero lecturas que no son casualidad, con sus pasadas, y nunca un «poco»
 * con un 0 %; «desde tal hora» exige que antes lo leyera bien;
 * un tag que lee mal casi toda la flota no cuenta contra ningún AGV; y «muchos» frente a «pocos» es
 * el 10 % de sus tags con un mínimo de cinco. Ninguna salida nombra causa.
 */

import { describe, expect, it } from "vitest";

import type { PairReadRate, ReadMatrix } from "../../src/domain/read-matrix.js";
import { describeVehicleReading, type VehicleReadingThresholds } from "../../src/domain/vehicle-reading.js";

const READ_RATE = { minPassesPerPair: 3, minVehiclesForContrast: 2, highRate: 0.8 };
const THRESHOLDS: VehicleReadingThresholds = {
  minPassesForNever: 8,
  fleetReadsWellShare: 0.75,
  manyTagsShare: 0.1,
  minManyTags: 5,
  maxChance: 0.001,
};

function cell(agvId: string, hits: number, passes: number, trailingMisses = 0): PairReadRate {
  return {
    agvId,
    passes,
    hits,
    byNeighbours: passes,
    byTime: 0,
    byOrder: 0,
    unproven: 0,
    firstHitUtcMs: hits > 0 ? 1_000 : null,
    lastHitUtcMs: hits > 0 ? 50_000 : null,
    leadingMisses: hits > 0 ? 0 : passes,
    trailingMisses: hits > 0 ? trailingMisses : passes,
  };
}

/** Cuatro AGV que leen bien cada tag, más las celdas que cada prueba añada. */
function matrix(rows: Record<string, readonly PairReadRate[]>): Pick<ReadMatrix, "tags"> {
  const good = ["G1", "G2", "G3", "G4"].map((agvId) => cell(agvId, 40, 40));
  return {
    tags: Object.entries(rows).map(([tagId, extra]) => ({
      tagId,
      isAnchor: false,
      byVehicle: [...good, ...extra],
    })) as unknown as ReadMatrix["tags"],
  };
}

describe("lectura por AGV", () => {
  it("separa «nunca», «desde tal hora» y «poco», con sus cifras", () => {
    const report = describeVehicleReading(
      matrix({ T1: [cell("N", 0, 40)], T2: [cell("D", 20, 30, 10)], T3: [cell("P", 20, 40)] }),
      READ_RATE,
      THRESHOLDS,
    );
    const of = (agvId: string) => report.vehicles.find((vehicle) => vehicle.agvId === agvId);
    expect(of("N")?.never).toEqual([{ tagId: "T1", passes: 40 }]);
    expect(of("D")?.stopped).toEqual([{ tagId: "T2", sinceUtcMs: 50_000, passesSince: 10 }]);
    expect(of("P")?.weak).toEqual([{ tagId: "T3", hits: 20, passes: 40 }]);
    expect(report.vehicles.map((vehicle) => vehicle.agvId)).toEqual(["N", "D", "P"]);
    expect(report.tags).toEqual([
      { tagId: "T1", never: [{ agvId: "N", passes: 40 }], stopped: [], weak: [], good: 4 },
      { tagId: "T2", never: [], stopped: ["D"], weak: [], good: 4 },
      { tagId: "T3", never: [], stopped: [], weak: [{ agvId: "P", hits: 20, passes: 40 }], good: 4 },
    ]);
  });

  it("si en un mismo tag fallan demasiados, el resto ya no «lo lee bien» y no cuenta contra nadie", () => {
    // Cuatro lo leen bien y tres no: para cada uno de los tres, solo cuatro de los otros seis (67 %)
    // lo leen bien, por debajo del 75 %.
    const report = describeVehicleReading(
      matrix({ T1: [cell("N", 0, 40), cell("D", 20, 30, 10), cell("P", 20, 40)] }),
      READ_RATE,
      THRESHOLDS,
    );
    expect(report.vehicles).toEqual([]);
  });

  it("con pocas pasadas y ninguna lectura es «nunca», con su cifra; nunca un «poco» con un 0 %", () => {
    // Hasta la Parte 48 esto salía como «lee poco: 0 %». El propietario lo vio con datos de taller: un
    // 0 % no es poco, es no leerlo nunca. La regla cambia (R-AGV-016), no la prueba para que pase.
    const report = describeVehicleReading(matrix({ T1: [cell("X", 0, 5)] }), READ_RATE, THRESHOLDS);
    const vehicle = report.vehicles[0];
    expect(vehicle?.never).toEqual([{ tagId: "T1", passes: 5 }]);
    expect(vehicle?.weak).toEqual([]);
    expect(report.tags[0]?.never).toEqual([{ agvId: "X", passes: 5 }]);
  });

  it("cero lecturas en pocas pasadas no se dice si el azar lo explica frente a lo que lee el resto", () => {
    // El resto lo lee al 85 %: fallar tres seguidas por azar es un 0,3 %, por encima del 0,1 %; cuatro,
    // un 0,05 %, ya no.
    const flock = ["G1", "G2", "G3", "G4"].map((agvId) => cell(agvId, 34, 40));
    const tags = (extra: PairReadRate) =>
      ({ tags: [{ tagId: "T1", isAnchor: false, byVehicle: [...flock, extra] }] }) as unknown as Pick<ReadMatrix, "tags">;
    expect(describeVehicleReading(tags(cell("X", 0, 3)), READ_RATE, THRESHOLDS).vehicles).toEqual([]);
    expect(describeVehicleReading(tags(cell("X", 0, 4)), READ_RATE, THRESHOLDS).vehicles[0]?.never).toEqual([
      { tagId: "T1", passes: 4 },
    ]);
  });

  it("dejar de leer exige haberlo leído bien antes", () => {
    // 10 de 30 antes de la racha final: ya lo leía poco, así que no es «desde tal hora».
    const report = describeVehicleReading(matrix({ T1: [cell("X", 10, 40, 10)] }), READ_RATE, THRESHOLDS);
    expect(report.vehicles[0]?.stopped).toEqual([]);
    expect(report.vehicles[0]?.weak).toHaveLength(1);
  });

  it("un tag que lee mal casi toda la flota no cuenta contra ningún AGV", () => {
    const rows = {
      T1: [cell("G1", 20, 40), cell("G2", 20, 40), cell("G3", 20, 40), cell("G4", 20, 40), cell("X", 0, 40)],
    };
    const report = describeVehicleReading(
      { tags: [{ tagId: "T1", isAnchor: false, byVehicle: rows.T1 }] as unknown as ReadMatrix["tags"] },
      READ_RATE,
      THRESHOLDS,
    );
    expect(report.vehicles).toEqual([]);
    expect(report.tags).toEqual([]);
  });

  it("«muchos» es el 10 % de sus tags y al menos cinco; si no, «pocos»", () => {
    const rows: Record<string, PairReadRate[]> = {};
    for (let index = 0; index < 20; index += 1) {
      rows[`T${index}`] = [
        cell("M", index < 6 ? 20 : 40, 40), // lee poco 6 de 20
        cell("F", index < 2 ? 20 : 40, 40), // lee poco 2 de 20
      ];
    }
    const report = describeVehicleReading(matrix(rows), READ_RATE, THRESHOLDS);
    const of = (agvId: string) => report.vehicles.find((vehicle) => vehicle.agvId === agvId);
    expect(of("M")).toMatchObject({ extent: "muchos", consideredTags: 20 });
    expect(of("F")).toMatchObject({ extent: "pocos", consideredTags: 20 });
    expect(report.vehicles.map((vehicle) => vehicle.agvId)).toEqual(["M", "F"]);
  });

  it("«poco» exige que la diferencia con el resto no sea casualidad", () => {
    // El resto lo lee al 85 %: un 75 % cabe por azar; un 50 %, no.
    const rest = ["G1", "G2", "G3", "G4", "G5", "G6"].map((agvId) => cell(agvId, 34, 40));
    const tags = [
      { tagId: "T1", isAnchor: false, byVehicle: [...rest, cell("X", 30, 40)] },
      { tagId: "T2", isAnchor: false, byVehicle: [...rest, cell("X", 20, 40)] },
    ] as unknown as ReadMatrix["tags"];
    const report = describeVehicleReading({ tags }, READ_RATE, THRESHOLDS);
    expect(report.vehicles[0]?.weak).toEqual([{ tagId: "T2", hits: 20, passes: 40 }]);
    expect(report.vehicles[0]?.consideredTags).toBe(2);
  });

  it("el ancla no dice nada de nadie", () => {
    const report = describeVehicleReading(
      { tags: [{ tagId: "A", isAnchor: true, byVehicle: [cell("G1", 40, 40), cell("G2", 40, 40), cell("G3", 40, 40), cell("X", 0, 40)] }] as unknown as ReadMatrix["tags"] },
      READ_RATE,
      THRESHOLDS,
    );
    expect(report.vehicles).toEqual([]);
  });
});
