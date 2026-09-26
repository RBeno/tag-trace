/**
 * Historial de flota (DS-012): lectura del fichero y fusión incremental.
 *
 * Lo que se fija: las columnas se buscan por nombre; las fechas son día/mes con hora opcional; una
 * fila que no se puede leer se cuenta con su motivo y no tumba el fichero; y cada carga **se suma** a
 * lo guardado — una fila con el mismo AGV y la misma fecha de alta sustituye a la anterior.
 */

import { describe, expect, it } from "vitest";

import { mergeFleetPeriods } from "../../src/domain/fleet.js";
import { FleetFailure, importFleetHistory } from "../../src/ingestion/fleet-history.js";

const ZONE = "Europe/Madrid";
/** 1 de septiembre de 2026 a las 00:00 en Madrid (UTC+2). */
const SEP_1 = Date.UTC(2026, 7, 31, 22, 0, 0);

describe("lectura del historial (importFleetHistory)", () => {
  it("columnas por nombre y en cualquier orden, fechas con y sin hora", () => {
    const result = importFleetHistory(
      ["nota;hasta;agv;desde;circuito", ";;7101;01/09/2026;SE2/4", "sale;20/09/2026 14:30;7120;01/09/2026;SE2/4"].join("\n"),
      ZONE,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ agvId: "7101", fromUtcMs: SEP_1, toUtcMs: null, circuit: "SE2/4" });
    expect(result.rows[1]?.toUtcMs).toBe(Date.UTC(2026, 8, 20, 12, 30, 0));
    expect(result.circuits).toEqual([{ name: "SE2/4", rows: 2 }]);
  });

  it("cuenta cada fila que no se puede leer con su motivo, y carga las demás", () => {
    const result = importFleetHistory(
      [
        "agv;desde;hasta",
        ";01/09/2026;", // sin AGV
        "7102;31/02/2026;", // fecha imposible
        "7103;10/09/2026;01/09/2026", // hasta antes de desde
        "7104;01/09/2026;",
      ].join("\n"),
      ZONE,
    );
    expect(result.rows.map((row) => row.agvId)).toEqual(["7104"]);
    expect(result.rejected.map((row) => row.reason)).toEqual(["SIN_AGV", "FECHA_INVALIDA", "HASTA_ANTES_DE_DESDE"]);
    expect(result.circuits).toEqual([]);
  });

  it("un «hasta» sin hora es el final de ese día: un alta y una baja el mismo día son un periodo válido", () => {
    // OQ-139: antes «hasta» sin hora valían las 00:00 de ese día, el periodo quedaba vacío y la fila se
    // rechazaba; el AGV quedaba fuera todo su último día. Ahora el periodo llega hasta las 00:00 del
    // día siguiente, exclusivo. Con hora, «hasta» sigue siendo el instante escrito.
    const result = importFleetHistory(
      ["agv;desde;hasta", "7101;01/09/2026;01/09/2026", "7102;01/09/2026;05/09/2026", "7103;01/09/2026 08:00;01/09/2026 08:00"].join("\n"),
      ZONE,
    );
    expect(result.rows.map((row) => [row.agvId, row.toUtcMs])).toEqual([
      ["7101", SEP_1 + 24 * 3_600_000],
      ["7102", SEP_1 + 5 * 24 * 3_600_000],
    ]);
    // Con hora e igual a «desde», el periodo es vacío y se rechaza: no asigna nada.
    expect(result.rejected.map((row) => row.reason)).toEqual(["HASTA_ANTES_DE_DESDE"]);
    // Y cuando «hasta», leído como final de su día, queda antes que «desde», se rechaza como siempre.
    const antes = importFleetHistory(["agv;desde;hasta", "7104;02/09/2026;01/09/2026", "7105;01/09/2026;"].join("\n"), ZONE);
    expect(antes.rejected.map((row) => row.reason)).toEqual(["HASTA_ANTES_DE_DESDE"]);
    expect(antes.rows).toHaveLength(1);
  });

  it("el final del día se calcula en la zona del circuito, también con cambio de hora", () => {
    // El 25/10/2026 Madrid pasa de UTC+2 a UTC+1: ese día tiene 25 h, y el final del día son las 00:00
    // del 26 en Madrid (23:00 UTC del 25), no 24 h después de su comienzo.
    const result = importFleetHistory(["agv;desde;hasta", "7101;25/10/2026;25/10/2026"].join("\n"), ZONE);
    expect(result.rows[0]?.toUtcMs).toBe(Date.UTC(2026, 9, 25, 23, 0, 0));
  });

  it("avisa de dos periodos del mismo AGV que se pisan, sin rechazarlos", () => {
    const result = importFleetHistory(["agv;desde;hasta", "7101;01/09/2026;", "7101;05/09/2026;"].join("\n"), ZONE);
    expect(result.rows).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("7101");
  });

  it("sin las columnas obligatorias no carga nada y dice cuáles faltan", () => {
    expect(() => importFleetHistory(["vehiculo;fecha", "7101;01/09/2026"].join("\n"), ZONE)).toThrow(FleetFailure);
  });
});

describe("fusión incremental (mergeFleetPeriods)", () => {
  const base = [
    { agvId: "7101", fromUtcMs: 1, toUtcMs: null, note: "" },
    { agvId: "7120", fromUtcMs: 1, toUtcMs: null, note: "" },
  ];

  it("una fila con el mismo AGV y la misma alta sustituye a la guardada; las demás se conservan", () => {
    const result = mergeFleetPeriods(base, [
      { agvId: "7120", fromUtcMs: 1, toUtcMs: 50, note: "baja" },
      { agvId: "7130", fromUtcMs: 10, toUtcMs: null, note: "" },
    ]);
    expect(result.added).toBe(1);
    expect(result.replaced).toBe(1);
    expect(result.periods.map((period) => `${period.agvId}:${period.toUtcMs}`)).toEqual([
      "7101:null",
      "7120:50",
      "7130:null",
    ]);
  });
});

describe("cabecera y campos escritos a mano", () => {
  it("la cabecera se reconoce con BOM, comillas y mayúsculas; las comillas no entran en el AGV; y las columnas desconocidas se avisan", () => {
    const result = importFleetHistory(['﻿"Circuito";AGV;"Desde";Hasta;Baja', 'SE2/4;"7101";01/09/2026;;x'].join("\n"), ZONE);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ agvId: "7101", fromUtcMs: SEP_1, toUtcMs: null, circuit: "SE2/4" });
    expect(result.warnings.join(" ")).toContain("baja");
  });
});
