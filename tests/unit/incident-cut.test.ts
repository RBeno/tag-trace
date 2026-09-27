/**
 * El recorte de la ventana de una incidencia al consolidar (OQ-148, propietario 2026-09-27).
 *
 * Lo que se fija: dentro de `[from, to]` se quitan las lecturas, ambos extremos incluidos; con AGV,
 * solo las de ese AGV; cada recorte cuenta lo que quitó; el tiempo de un recorte de todo el circuito
 * sale de la cobertura (sin cobertura, no silencio) y el de un AGV no; y los recortes pedidos se
 * comprueban contra las incidencias y la ventana del fichero, con el AGV de la incidencia.
 */

import { describe, expect, it } from "vitest";

import { checkCuts, coverageWithoutCuts, cutReadings } from "../../src/domain/incident-cut.js";
import type { Reading } from "../../src/domain/reading.js";

const SECOND = 1_000;

let row = 0;
function reading(agvId: string, tagId: string, utcMs: number): Reading {
  row += 1;
  return { time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" }, agvId, tagId, provenance: { sourceId: "s", sourceHash: "s", sourceRow: row } };
}

/** Dos AGV leyendo cada diez segundos de 0 a 100 s. */
const READINGS: readonly Reading[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].flatMap((second) => [
  reading("0007", "T1", second * SECOND),
  reading("0042", "T2", second * SECOND + 1),
]);

describe("cutReadings · por ventana y por AGV", () => {
  it("sin AGV quita todas las lecturas de la ventana, extremos incluidos, y cuenta cuántas", () => {
    const { kept, applied } = cutReadings(READINGS, [{ incidentKey: "k", from: 20 * SECOND, to: 40 * SECOND }]);
    // 20, 30 y 40 de 0007; 20 y 30 de 0042 (la de 40 s + 1 ms queda fuera).
    expect(applied).toEqual([{ incidentKey: "k", from: 20 * SECOND, to: 40 * SECOND, removed: 5 }]);
    expect(kept).toHaveLength(READINGS.length - 5);
    expect(kept.some((entry) => entry.time.utcMs >= 20 * SECOND && entry.time.utcMs <= 40 * SECOND)).toBe(false);
    // Las que quedan conservan su orden.
    expect(kept).toEqual(READINGS.filter((entry) => entry.time.utcMs < 20 * SECOND || entry.time.utcMs > 40 * SECOND));
  });

  it("con AGV solo quita las de ese AGV: las de los demás se quedan", () => {
    const { kept, applied } = cutReadings(READINGS, [{ incidentKey: "k", from: 20 * SECOND, to: 60 * SECOND, agvId: "0007" }]);
    expect(applied[0]?.removed).toBe(5);
    expect(kept.filter((entry) => entry.agvId === "0042")).toHaveLength(11);
    expect(kept.filter((entry) => entry.agvId === "0007").map((entry) => entry.time.utcMs / SECOND)).toEqual([0, 10, 70, 80, 90, 100]);
  });

  it("una lectura en dos recortes cuenta en el primero; un recorte sin lecturas quita cero", () => {
    const { applied } = cutReadings(READINGS, [
      { incidentKey: "a", from: 0, to: 10 * SECOND, agvId: "0007" },
      { incidentKey: "b", from: 10 * SECOND, to: 10 * SECOND + 1 },
      { incidentKey: "c", from: 200 * SECOND, to: 300 * SECOND },
    ]);
    expect(applied.map((cut) => cut.removed)).toEqual([2, 1, 0]);
  });
});

describe("coverageWithoutCuts · sin cobertura, no silencio", () => {
  it("el recorte de todo el circuito sale de la cobertura; el de un AGV no", () => {
    const coverage = [{ from: 0, to: 100 * SECOND }];
    expect(coverageWithoutCuts(coverage, [{ incidentKey: "k", from: 20 * SECOND, to: 40 * SECOND }])).toEqual([
      { from: 0, to: 20 * SECOND - 1 },
      { from: 40 * SECOND + 1, to: 100 * SECOND },
    ]);
    expect(coverageWithoutCuts(coverage, [{ incidentKey: "k", from: 20 * SECOND, to: 40 * SECOND, agvId: "0007" }])).toEqual(coverage);
    // Hasta el final: no queda cola.
    expect(coverageWithoutCuts(coverage, [{ incidentKey: "k", from: 90 * SECOND, to: 100 * SECOND }])).toEqual([{ from: 0, to: 90 * SECOND - 1 }]);
  });
});

describe("checkCuts · contra las incidencias y la ventana del fichero", () => {
  const incidents = [
    { key: "deja-de-leer|0007", title: "0007: deja de leer", agvId: "0007", window: { from: 20 * SECOND, to: 60 * SECOND } },
    { key: "parada|linea", title: "Producción parada", windows: [{ from: 10 * SECOND, to: 20 * SECOND }] },
    { key: "sin-ventana", title: "Sin ventana" },
  ];
  const file = { from: 0, to: 100 * SECOND };

  it("normaliza con el AGV de la incidencia, aunque el mensaje no lo traiga", () => {
    expect(checkCuts([{ incidentKey: "deja-de-leer|0007", from: 25 * SECOND, to: 50 * SECOND }], incidents, file)).toEqual([
      { incidentKey: "deja-de-leer|0007", from: 25 * SECOND, to: 50 * SECOND, agvId: "0007" },
    ]);
    expect(checkCuts([{ incidentKey: "parada|linea", from: 10 * SECOND, to: 20 * SECOND }], incidents, file)).toEqual([
      { incidentKey: "parada|linea", from: 10 * SECOND, to: 20 * SECOND },
    ]);
  });

  it("rechaza lo que no es una incidencia con ventana, un fin antes del principio, salirse del fichero y otro AGV", () => {
    expect(() => checkCuts([{ incidentKey: "otro", from: 0, to: 1 }], incidents, file)).toThrow(/Solo se recorta la ventana de una incidencia/);
    expect(() => checkCuts([{ incidentKey: "sin-ventana", from: 0, to: 1 }], incidents, file)).toThrow(/no tiene ventana/);
    expect(() => checkCuts([{ incidentKey: "parada|linea", from: 30 * SECOND, to: 20 * SECOND }], incidents, file)).toThrow(/principio anterior o igual/);
    expect(() => checkCuts([{ incidentKey: "parada|linea", from: 0, to: 200 * SECOND }], incidents, file)).toThrow(/se sale de la ventana del fichero/);
    expect(() => checkCuts([{ incidentKey: "deja-de-leer|0007", from: 20 * SECOND, to: 30 * SECOND, agvId: "0042" }], incidents, file)).toThrow(/no es del AGV/);
    expect(() =>
      checkCuts(
        [
          { incidentKey: "parada|linea", from: 10 * SECOND, to: 12 * SECOND },
          { incidentKey: "parada|linea", from: 14 * SECOND, to: 16 * SECOND },
        ],
        incidents,
        file,
      ),
    ).toThrow(/dos recortes/);
  });
});
