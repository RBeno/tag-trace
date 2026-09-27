/**
 * El recorte de la ventana de una incidencia al consolidar (OQ-148, propietario 2026-09-27).
 *
 * Lo que se fija: dentro de `[from, to]` se quitan las lecturas, ambos extremos incluidos; con AGV,
 * solo las de ese AGV; cada recorte cuenta lo que quitó; el tiempo de un recorte de todo el circuito
 * sale de la cobertura (sin cobertura, no silencio) y el de un AGV no; y los recortes pedidos se
 * comprueban contra las incidencias y la ventana del fichero, con el AGV de la incidencia. Una
 * incidencia admite varios recortes, uno por parada, siempre que no se solapen (OQ-155).
 */

import { describe, expect, it } from "vitest";

import { checkCuts, coverageWithoutCuts, cutReadings, cutWarnings } from "../../src/domain/incident-cut.js";
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

  it("un recorte de un instante (`from === to`) quita solo lo que cae justo en él", () => {
    const { kept, applied } = cutReadings(READINGS, [{ incidentKey: "k", from: 30 * SECOND, to: 30 * SECOND }]);
    expect(applied[0]?.removed).toBe(1);
    expect(kept).toHaveLength(READINGS.length - 1);
    expect(kept.some((entry) => entry.time.utcMs === 30 * SECOND)).toBe(false);
    expect(kept.some((entry) => entry.time.utcMs === 30 * SECOND + 1)).toBe(true);
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

  it("un recorte que empieza justo en el principio, o acaba justo en el fin, no deja un tramo vacío ni invertido", () => {
    const coverage = [{ from: 0, to: 100 * SECOND }];
    expect(coverageWithoutCuts(coverage, [{ incidentKey: "k", from: 0, to: 10 * SECOND }])).toEqual([{ from: 10 * SECOND + 1, to: 100 * SECOND }]);
    expect(coverageWithoutCuts(coverage, [{ incidentKey: "k", from: 95 * SECOND, to: 100 * SECOND }])).toEqual([{ from: 0, to: 95 * SECOND - 1 }]);
    // Todo el tramo: no queda cobertura.
    expect(coverageWithoutCuts(coverage, [{ incidentKey: "k", from: 0, to: 100 * SECOND }])).toEqual([]);
    // Un recorte que cubre el tramo por fuera también lo quita entero.
    expect(coverageWithoutCuts(coverage, [{ incidentKey: "k", from: -1, to: 200 * SECOND }])).toEqual([]);
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
  });

  // OQ-155 (propietario 2026-09-27): varios recortes por incidencia, uno por parada; nunca solapados.
  it("dos recortes de una incidencia que no se solapan pasan, y `cutReadings` quita los dos", () => {
    const cuts = checkCuts(
      [
        { incidentKey: "parada|linea", from: 10 * SECOND, to: 12 * SECOND },
        { incidentKey: "parada|linea", from: 14 * SECOND, to: 16 * SECOND },
      ],
      incidents,
      file,
    );
    expect(cuts).toEqual([
      { incidentKey: "parada|linea", from: 10 * SECOND, to: 12 * SECOND },
      { incidentKey: "parada|linea", from: 14 * SECOND, to: 16 * SECOND },
    ]);
    // Lecturas a 10, 11, 12 s y a 14, 15, 16 s: cada recorte quita las suyas, y las de en medio (13 s) se quedan.
    const readings = [10, 11, 12, 13, 14, 15, 16, 17].map((second) => reading("0007", "T1", second * SECOND));
    const { kept, applied } = cutReadings(readings, cuts);
    expect(applied.map((cut) => cut.removed)).toEqual([3, 3]);
    expect(kept.map((entry) => entry.time.utcMs / SECOND)).toEqual([13, 17]);
    // Tocarse en un extremo ya es solaparse (ambos incluidos): 12 s caería en los dos.
    expect(() =>
      checkCuts(
        [
          { incidentKey: "parada|linea", from: 10 * SECOND, to: 12 * SECOND },
          { incidentKey: "parada|linea", from: 12 * SECOND, to: 16 * SECOND },
        ],
        incidents,
        file,
      ),
    ).toThrow(/Los recortes de «Producción parada» se solapan: sepáralos o une los dos en uno/);
    // Uno dentro del otro también; y el orden en que llegan no importa.
    expect(() =>
      checkCuts(
        [
          { incidentKey: "parada|linea", from: 14 * SECOND, to: 15 * SECOND },
          { incidentKey: "parada|linea", from: 10 * SECOND, to: 16 * SECOND },
        ],
        incidents,
        file,
      ),
    ).toThrow(/se solapan/);
    // Dos incidencias distintas sí pueden recortar el mismo tiempo: la de un AGV y la del circuito.
    expect(
      checkCuts(
        [
          { incidentKey: "deja-de-leer|0007", from: 10 * SECOND, to: 16 * SECOND },
          { incidentKey: "parada|linea", from: 10 * SECOND, to: 16 * SECOND },
        ],
        incidents,
        file,
      ),
    ).toHaveLength(2);
  });

  it("con tres paradas (`windows`) se admite un recorte por parada, cada uno con la suya, y `cutWarnings` no avisa", () => {
    const three = [
      {
        key: "parada|linea",
        title: "La producción se paró 3 veces",
        windows: [
          { from: 10 * SECOND, to: 20 * SECOND },
          { from: 40 * SECOND, to: 45 * SECOND },
          { from: 70 * SECOND, to: 90 * SECOND },
        ],
      },
    ];
    const requested = three[0]!.windows.map((window) => ({ incidentKey: "parada|linea", from: window.from, to: window.to }));
    const cuts = checkCuts(requested, three, file);
    expect(cuts).toEqual(requested);
    expect(cutWarnings(cuts, three)).toEqual([]);
    // Recortar solo la segunda y la tercera también vale: la persona elige cuáles.
    expect(checkCuts(requested.slice(1), three, file)).toHaveLength(2);
    // Con los tres recortes, las lecturas de fuera de las paradas se quedan y las de dentro se van, cada una
    // a su recorte: 10 y 20 s de 0007 más 10 s + 1 ms de 0042 (la de 20 s + 1 ms queda fuera); 40 s de los dos;
    // 70, 80 y 90 s de 0007 más 70 y 80 s + 1 ms de 0042.
    const { kept, applied } = cutReadings(READINGS, cuts);
    expect(applied.map((cut) => cut.removed)).toEqual([3, 2, 5]);
    expect(kept.filter((entry) => entry.agvId === "0007").map((entry) => entry.time.utcMs / SECOND)).toEqual([0, 30, 50, 60, 100]);
    // Y la cobertura pierde los tres tramos, no la envolvente.
    expect(coverageWithoutCuts([file], cuts)).toEqual([
      { from: 0, to: 10 * SECOND - 1 },
      { from: 20 * SECOND + 1, to: 40 * SECOND - 1 },
      { from: 45 * SECOND + 1, to: 70 * SECOND - 1 },
      { from: 90 * SECOND + 1, to: 100 * SECOND },
    ]);
  });

  it("un recorte fuera de la ventana de su incidencia pasa, pero `cutWarnings` lo avisa; uno que la toca, no", () => {
    const outside = [{ incidentKey: "deja-de-leer|0007", from: 70 * SECOND, to: 80 * SECOND }];
    expect(checkCuts(outside, incidents, file)).toHaveLength(1);
    const warnings = cutWarnings(outside, incidents);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/«0007: deja de leer» no se solapa con la ventana/);
    // Tocar el extremo ya es solaparse (ambos incluidos).
    expect(cutWarnings([{ incidentKey: "deja-de-leer|0007", from: 60 * SECOND, to: 80 * SECOND }], incidents)).toEqual([]);
    expect(cutWarnings([{ incidentKey: "deja-de-leer|0007", from: 0, to: 20 * SECOND }], incidents)).toEqual([]);
    // Con varias paradas basta con tocar una; fuera de todas, dice cuántas son.
    const several = [{ key: "parada|linea", title: "Producción parada", windows: [{ from: 10 * SECOND, to: 20 * SECOND }, { from: 50 * SECOND, to: 60 * SECOND }] }];
    expect(cutWarnings([{ incidentKey: "parada|linea", from: 55 * SECOND, to: 58 * SECOND }], several)).toEqual([]);
    expect(cutWarnings([{ incidentKey: "parada|linea", from: 30 * SECOND, to: 40 * SECOND }], several)[0]).toMatch(/ninguna de las 2 ventanas/);
    // Una incidencia desconocida o sin ventana no avisa aquí: la rechaza `checkCuts`.
    expect(cutWarnings([{ incidentKey: "otro", from: 0, to: 1 }, { incidentKey: "sin-ventana", from: 0, to: 1 }], incidents)).toEqual([]);
  });
});
