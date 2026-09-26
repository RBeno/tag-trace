/**
 * El ritmo de cada AGV y quién retiene a otros (R-AGV-019, R-AGV-020).
 *
 * Lo que se fija, sobre un anillo de 20 tags hecho a mano: un AGV un 10 % más lento sale, uno un 1 %
 * más lento no aunque la prueba de signo lo encuentre; los empates cuentan a mitad; uno más rápido
 * también sale; en qué zona; las paradas y retenciones no cuentan como ritmo; con pocas muestras, nada;
 * y quien retiene a varios más de lo que da el azar sale, y quien retiene lo que le toca, no.
 */

import { describe, expect, it } from "vitest";

import type { Retention, VehicleStop } from "../../src/domain/flow-stops.js";
import type { Transition } from "../../src/domain/graph.js";
import { buildSegmentBands, type Regime } from "../../src/domain/segment-bands.js";
import { paceCsv, signTest, vehiclePace, type PaceInput } from "../../src/domain/vehicle-pace.js";

const RING = Array.from({ length: 20 }, (_, index) => `T${index}`);
const DAY = (): Regime => "produccion";
const SECOND = 1_000;
const THRESHOLDS = { minPaceShift: 0.05, minSamples: 20, maxFalsePoints: 0.01, minVehiclesForContrast: 2 };

/**
 * Diez AGV, cuarenta vueltas; cada tramo tarda 12–21 s según la vuelta y la posición. `factor` da, por
 * AGV y tag de salida, cuánto más lento va.
 */
function laps(factor: (vehicle: number, position: number) => number = () => 1, vehicles = 10, count = 40): Transition[] {
  const transitions: Transition[] = [];
  for (let vehicle = 0; vehicle < vehicles; vehicle += 1) {
    let time = vehicle * 90 * SECOND;
    for (let lap = 0; lap < count; lap += 1) {
      for (let position = 0; position < RING.length; position += 1) {
        const base = (12 + ((lap * 7 + position * 3 + vehicle) % 10)) * SECOND;
        const duration = Math.round(base * factor(vehicle, position));
        transitions.push({
          agvId: `V${vehicle}`,
          from: RING[position] as string,
          to: RING[(position + 1) % RING.length] as string,
          fromTime: time,
          toTime: time + duration,
          sameInstant: false,
        });
        time += duration;
      }
    }
  }
  return transitions;
}

function input(transitions: Transition[], extra: Partial<PaceInput> = {}): PaceInput {
  return {
    transitions,
    bands: buildSegmentBands(transitions, RING, DAY, { minBandSamples: 20 }, 30 * SECOND),
    regimeOf: DAY,
    flow: { stops: [], retentions: [] },
    zoneOf: new Map(),
    ...extra,
  };
}

function retention(agvId: string, holderAgvId: string, index: number): Retention {
  return {
    agvId,
    fromTagId: "T5",
    toTagId: "T6",
    fromUtcMs: index * 1000,
    toUtcMs: index * 1000 + 50 * SECOND,
    waitMs: 35 * SECOND,
    holderAgvId,
    holderTagId: "T6",
    regime: "produccion",
    stop: false,
  };
}

describe("el ritmo de cada AGV (R-AGV-019)", () => {
  it("un AGV un 10 % más lento, en toda la línea", () => {
    const report = vehiclePace(input(laps((vehicle) => (vehicle === 3 ? 1.1 : 1))), THRESHOLDS);
    const flagged = report.vehicles.filter((vehicle) => vehicle.verdict !== null);
    expect(flagged.map((vehicle) => [vehicle.agvId, vehicle.verdict, vehicle.where])).toEqual([["V3", "mas-lento", "toda-la-linea"]]);
    // Con diez duraciones posibles la mediana va a saltos: un 10 % más lento se mide como un 6,8 %.
    expect(flagged[0]?.shift).toBeGreaterThan(0.05);
  });

  it("uno un 1 % más lento no sale, aunque la prueba de signo lo encuentre", () => {
    const report = vehiclePace(input(laps((vehicle) => (vehicle === 3 ? 1.01 : 1), 10, 200)), THRESHOLDS);
    expect(report.vehicles.filter((vehicle) => vehicle.verdict !== null)).toEqual([]);
  });

  it("uno más rápido también sale", () => {
    const report = vehiclePace(input(laps((vehicle) => (vehicle === 7 ? 0.88 : 1))), THRESHOLDS);
    expect(report.vehicles.filter((vehicle) => vehicle.verdict !== null).map((vehicle) => [vehicle.agvId, vehicle.verdict])).toEqual([
      ["V7", "mas-rapido"],
    ]);
  });

  it("solo en la zona donde va más lento", () => {
    const zoneOf = new Map(RING.map((tagId, index) => [tagId, index < 10 ? "cargado" : "vacio"]));
    const report = vehiclePace(input(laps((vehicle, position) => (vehicle === 2 && position < 9 ? 1.15 : 1)), { zoneOf }), THRESHOLDS);
    const v2 = report.vehicles.find((vehicle) => vehicle.agvId === "V2");
    expect(v2?.verdict).toBe("mas-lento");
    expect(v2?.where).toEqual(["cargado"]);
    expect(v2?.zones.find((zone) => zone.zone === "vacio")?.verdict).toBeNull();
  });

  it("una zona con pocas muestras y la misma diferencia no convierte «toda la línea» en «solo aquí»", () => {
    const zoneOf = new Map(RING.map((tagId, index) => [tagId, index < 16 ? "cargado" : "vacio"]));
    const report = vehiclePace(input(laps((vehicle) => (vehicle === 3 ? 1.1 : 1), 10, 20), { zoneOf }), THRESHOLDS);
    const v3 = report.vehicles.find((vehicle) => vehicle.agvId === "V3");
    expect(v3?.zones.find((zone) => zone.zone === "vacio")?.verdict).toBeNull();
    expect(v3?.where).toBe("toda-la-linea");
  });

  it("las paradas no son ritmo: un AGV que para mucho, pero va a su paso, no sale", () => {
    const transitions = laps((vehicle, position) => (vehicle === 4 && position === 5 ? 6 : 1));
    const stops: VehicleStop[] = transitions
      .filter((transition) => transition.agvId === "V4" && transition.from === "T5")
      .map((transition) => ({
        agvId: "V4",
        fromTagId: "T5",
        toTagId: "T6",
        fromUtcMs: transition.fromTime,
        toUtcMs: transition.toTime,
        usualMs: 16 * SECOND,
        excessMs: 60 * SECOND,
        regime: "produccion",
        justification: "sin-explicacion",
        aheadAgvId: null,
        headAgvId: null,
        behind: 0,
        aheadEvidence: null,
      }));
    const report = vehiclePace(input(transitions, { flow: { stops, retentions: [] } }), THRESHOLDS);
    expect(report.vehicles.find((vehicle) => vehicle.agvId === "V4")?.samples).toBe(40 * 19);
    expect(report.vehicles.filter((vehicle) => vehicle.verdict !== null)).toEqual([]);
  });

  it("con pocas muestras, nada", () => {
    const report = vehiclePace(input(laps((vehicle) => (vehicle === 3 ? 1.5 : 1), 10, 1)), { ...THRESHOLDS, minSamples: 30 });
    expect(report.vehicles).toEqual([]);
    expect(report.fleetRatio).toBeNull();
  });

  it("cada AGV se compara con la mediana de los demás, no con una que lo incluye", () => {
    // Con diez AGV y uno un 10 % más lento, la referencia del lento es la de los otros nueve y la de un
    // sano incluye al lento: distintas, y la del lento es la menor.
    const report = vehiclePace(input(laps((vehicle) => (vehicle === 3 ? 1.1 : 1))), THRESHOLDS);
    const slow = report.vehicles.find((vehicle) => vehicle.agvId === "V3");
    const sane = report.vehicles.find((vehicle) => vehicle.agvId === "V0");
    expect(slow?.fleetRatio).toBeLessThan(sane?.fleetRatio ?? 0);
    expect(report).toMatchObject({ testedVehicles: 10, enoughVehicles: true });
  });

  it("con menos de tres AGV probados no se afirma ningún ritmo, y se dice", () => {
    // Dos AGV, uno un 20 % más lento: la referencia de cada uno es solo el otro, y el sano saldría
    // «más rápido». Se enseñan las cifras, sin veredicto.
    const report = vehiclePace(input(laps((vehicle) => (vehicle === 1 ? 1.2 : 1), 2)), THRESHOLDS);
    expect(report).toMatchObject({ testedVehicles: 2, enoughVehicles: false });
    expect(report.vehicles).toHaveLength(2);
    expect(report.vehicles.filter((vehicle) => vehicle.verdict !== null)).toEqual([]);
    expect(report.vehicles.find((vehicle) => vehicle.agvId === "V1")?.shift).toBeGreaterThan(0.1);
  });

  it("la prueba de signo cuenta los empates a mitad", () => {
    expect(signTest([1, 1, 1, 1, 1, 1, 1, 1], 1)).toBeCloseTo(1, 6);
    expect(signTest([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 1)).toBeLessThan(1e-4);
    expect(signTest([2, 0, 2, 0, 2, 0], 1)).toBeCloseTo(1, 6);
  });
});

describe("quién retiene a otros (R-AGV-020)", () => {
  it("quien retiene a varios más de lo que da el azar sale; los que retienen lo que les toca, no", () => {
    const transitions = laps();
    const retentions: Retention[] = [
      ...Array.from({ length: 12 }, (_, index) => retention(`V${(index % 4) + 1}`, "V0", index)),
      retention("V2", "V5", 100),
      retention("V3", "V6", 101),
      retention("V8", "V7", 102),
    ];
    const report = vehiclePace(input(transitions, { flow: { stops: [], retentions } }), THRESHOLDS);
    const flagged = report.holders.filter((holder) => holder.expected !== null);
    expect(flagged.map((holder) => [holder.agvId, holder.retentions, holder.retained])).toEqual([["V0", 12, ["V1", "V2", "V3", "V4"]]]);
    expect(flagged[0]?.waitMs).toBe(12 * 35 * SECOND);
  });

  it("siempre al mismo AGV no basta: hacen falta varios retenidos", () => {
    const retentions = Array.from({ length: 12 }, (_, index) => retention("V1", "V0", index));
    const report = vehiclePace(input(laps(), { flow: { stops: [], retentions } }), THRESHOLDS);
    expect(report.holders.filter((holder) => holder.expected !== null)).toEqual([]);
  });

  it("quien retiene sin ninguna pasada propia en la ventana no se señala: sin exposición no hay azar con que comparar", () => {
    // Dos retenciones de AGV distintos atribuidas a «V99», que no tiene ninguna transición de producción
    // aquí (sus pasadas quedaron fuera de la ventana). Antes salía señalado con esperado 0.
    const retentions = [retention("V1", "V99", 1), retention("V2", "V99", 2)];
    const report = vehiclePace(input(laps(), { flow: { stops: [], retentions } }), THRESHOLDS);
    expect(report.holders.find((holder) => holder.agvId === "V99")).toMatchObject({ retentions: 2, passes: 0, expected: null });
  });

  it("el CSV de un fichero, con coma decimal", () => {
    const retentions = [retention("V2", "V0", 1), retention("V3", "V0", 2)];
    const csv = paceCsv(vehiclePace(input(laps((vehicle) => (vehicle === 3 ? 1.1 : 1)), { flow: { stops: [], retentions } }), THRESHOLDS));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("agv;muestras;ritmo;veredicto;retenciones;min_retenidos");
    expect(lines.find((line) => line.startsWith("V0;"))).toMatch(/^V0;800;[01],\d{3};;2;1,2$/);
    expect(lines.find((line) => line.startsWith("V3;"))?.split(";")[3]).toBe("mas-lento");
  });
});
