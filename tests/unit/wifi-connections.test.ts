/**
 * Importador del informe de conexiones wifi (DS-013, TC-325). Las filas son sintéticas y copian solo
 * la forma de la exportación de Vsystem.
 */

import { describe, expect, it } from "vitest";
import { WifiFailure, agvFromFileName, importWifiRows, importWifiText, mergeWifiEvents } from "../../src/ingestion/wifi-connections.js";

const HEADER = ["Linea", "Fecha", "Conexión", "Nº Motor", "Cober.", "Datos Aux"];

describe("informe de conexiones wifi (DS-013)", () => {
  it("lee los tres tipos de evento con fecha día/mes y conserva Datos Aux sin interpretar", () => {
    const result = importWifiRows(
      [
        HEADER,
        ["Checked", "13/10/2026 10:20:30", "Conexión               ", "2", "255", "MTC 0 MTD 0; 00 11 00 00"],
        ["Unchecked", "13/10/2026 10:20:28", "Desconexión            ", "2", "0", ""],
        ["?", "12/10/2026 6:10:00", "Conexión tras apagado", "2", "255", "x"],
      ],
      "Europe/Madrid",
      true,
    );
    expect(result.events.map((event) => event.kind)).toEqual(["conexion", "desconexion", "conexion-tras-apagado"]);
    expect(result.events[0]?.aux).toBe("MTC 0 MTD 0; 00 11 00 00");
    // 6 de octubre, no 10 de junio: día/mes declarado.
    expect(new Date(result.events[0]?.utcMs ?? 0).getUTCMonth()).toBe(9);
    expect(result.events[2]?.sourceRow).toBe(4);
  });

  it("un tipo desconocido o una fecha que no se entiende se rechaza con su motivo, no se descarta en silencio", () => {
    const result = importWifiRows(
      [HEADER, ["", "13/10/2026 10:20:30", "Reinicio", "", "", ""], ["", "32/10/2026 1:00:00", "Conexión", "", "", ""], ["", "06/10/2026 1:00:00", "Conexión", "", "", ""]],
      "Europe/Madrid",
      false,
    );
    expect(result.rejected.map((entry) => entry.reason)).toEqual(["EVENTO_DESCONOCIDO", "FECHA_INVALIDA"]);
    expect(result.events).toHaveLength(1);
  });

  it("sin «Fecha» o «Conexión» en la cabecera no adivina columnas", () => {
    expect(() => importWifiRows([["Fecha", "Estado"], ["06/10/2026 1:00:00", "Conexión"]], "Europe/Madrid", false)).toThrow(WifiFailure);
  });

  it("lee el mismo informe en texto separado por punto y coma", () => {
    const result = importWifiText("Fecha;Conexión\n06/10/2026 1:00:00;Desconexión\n06/10/2026 1:00:05;Conexión\n", "Europe/Madrid");
    expect(result.events).toHaveLength(2);
  });

  it("el AGV del nombre del fichero es una propuesta que conserva los ceros", () => {
    expect(agvFromFileName("CONEXIONES123.xlsx")).toBe("123");
    expect(agvFromFileName("conexiones 0040 (2).xlsx")).toBe("2");
    expect(agvFromFileName("CONEXIONES0040.xlsx")).toBe("0040");
    expect(agvFromFileName("conexiones.xlsx")).toBeNull();
  });

  it("dos informes que se solapan no duplican eventos", () => {
    const first = importWifiText("Fecha;Conexión\n06/10/2026 1:00:00;Desconexión\n06/10/2026 1:00:05;Conexión\n", "Europe/Madrid");
    const second = importWifiText("Fecha;Conexión\n06/10/2026 1:00:05;Conexión\n06/10/2026 2:00:00;Desconexión\n", "Europe/Madrid");
    const merged = mergeWifiEvents(first.events, second.events);
    expect(merged.added).toBe(1);
    expect(merged.events.map((event) => event.kind)).toEqual(["desconexion", "conexion", "desconexion"]);
  });
});
