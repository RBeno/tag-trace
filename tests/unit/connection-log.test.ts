/**
 * Registro de conexiones del terminal (DS-013, ADR-0017): el importador y los cortes.
 *
 * Lo que se fija: el AGV sale del nombre del fichero y se conserva tal cual; la cabecera del
 * terminal se reconoce por «Fecha» y «Conexión», con las demás columnas conservadas; los tres tipos
 * se normalizan y un cuarto queda `desconocido` sin perderse; una fecha de serie de Excel se lee como
 * la de pared; dos IP en un fichero avisan; los cortes se emparejan con la siguiente conexión, «tras
 * apagado» cierra pero se dice, un corte sin cierre queda abierto; la clase sale de los umbrales; la
 * localización usa P y Q y el anillo; y el resumen concentra por sitio y por AGV con su prueba de azar.
 */

import { describe, expect, it } from "vitest";

import { agvFromFileName, importConnectionLog, importConnectionRows, type ConnectionEvent } from "../../src/ingestion/connection-log.js";
import { classifyCut, locateCuts, pairCuts, summarizeConnections, type CutReading } from "../../src/domain/connection-cuts.js";
import type { Transition } from "../../src/domain/graph.js";

const ZONE = "Europe/Madrid";
const HEADER = ["Linea", "Fecha", "Conexión", "Nº Motor", "Op.", "Cober.", "Ver.", "RFID", "LCD", "PID", "Datos Aux", "Cimi", "IP Terminal"];
const row = (date: string, kind: string, cover: string, ip = "10.0.0.7", aux = "MTC 0 MTD 0; 07 15"): string[] =>
  ["Checked", date, kind, "2", "0", cover, "2.00", "2", "17", "1", aux, "0", ip];

describe("el AGV sale del nombre del fichero (OQ-160)", () => {
  it("reconoce CONEXIONES<agv> con cualquier separador y conserva los ceros", () => {
    expect(agvFromFileName("CONEXIONES1553.xlsx")).toBe("1553");
    expect(agvFromFileName("conexiones_0040.csv")).toBe("0040");
    expect(agvFromFileName("C:\\exportes\\Conexiones 395 (1).xlsx")).toBe("395");
    expect(agvFromFileName("conexión-7122.xlsx")).toBe("7122");
    // Con un prefijo delante (una copia, el hash de una subida): la palabra vale en cualquier sitio.
    expect(agvFromFileName("copia de CONEXIONES395.xlsx")).toBe("395");
    expect(agvFromFileName("63ddc2eb-CONEXIONES1553.xlsx")).toBe("1553");
    expect(agvFromFileName("desconexiones1553.xlsx")).toBeNull();
  });
  it("sin AGV en el nombre no inventa uno", () => {
    expect(agvFromFileName("registro.xlsx")).toBeNull();
    expect(agvFromFileName("LECTURAS1553.xlsx")).toBeNull();
  });
});

describe("importador del registro de conexiones (DS-013)", () => {
  it("lee la exportación del terminal: tipos normalizados, atributos conservados, orden por instante", () => {
    const result = importConnectionRows(
      [
        HEADER,
        row("06/10/2026 7:12:05", "Conexión       ", "255"),
        row("06/10/2026 7:12:03", "Desconexión", "0"),
        row("05/10/2026 5:18:42", "Conexión tras apagado", "1", "10.0.0.7", "MTC 7 MTD 0; 06 15"),
      ],
      ZONE,
      "1553",
    );
    expect(result.agvId).toBe("1553");
    expect(result.events.map((event) => event.kind)).toEqual(["conexion-tras-apagado", "desconexion", "conexion"]);
    expect(result.events[0]).toMatchObject({ agvId: "1553", coverage: "1", ipTerminal: "10.0.0.7", version: "2.00", mtc: "7", sourceRow: 4 });
    expect(result.events[1]?.utcMs).toBeLessThan(result.events[2]?.utcMs ?? 0);
    expect(result.ips).toEqual(["10.0.0.7"]);
    expect(result.warnings).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("un tipo que no conoce queda `desconocido`, con su texto, y se avisa; una fila sin fecha se rechaza con su fila", () => {
    const result = importConnectionRows(
      [HEADER, row("06/10/2026 7:12:05", "Reinicio", "255"), row("ayer", "Conexión", "255"), row("06/10/2026 7:12:03", "Desconexión", "0")],
      ZONE,
      "1553",
    );
    expect(result.events.map((event) => [event.kind, event.rawKind])).toEqual([
      ["desconexion", "Desconexión"],
      ["desconocido", "Reinicio"],
    ]);
    expect(result.rejected).toEqual([{ sourceRow: 3, reason: "FECHA_INVALIDA", excerpt: expect.stringContaining("ayer") }]);
    expect(result.warnings.join(" ")).toContain("Reinicio");
  });

  it("una fecha guardada como serie de Excel se lee como la de pared; dos IP en un fichero avisan", () => {
    // 46301.3 = 06/10/2026 07:12:00 (serie de Excel, sin zona).
    const result = importConnectionRows([HEADER, row("46301.3", "Desconexión", "0", "10.0.0.7"), row("46301.30005", "Conexión", "255", "10.0.0.9")], ZONE, "395");
    expect(result.events).toHaveLength(2);
    expect(result.ips).toEqual(["10.0.0.7", "10.0.0.9"]);
    expect(result.warnings.join(" ")).toContain("2 IP");
  });

  it("también en CSV, y sin «Fecha» o «Conexión» falla diciendo qué espera", () => {
    const text = ["Fecha;Conexión;Cober.", "06/10/2026 7:12:03;Desconexión;0", "06/10/2026 7:12:05;Conexión;255"].join("\n");
    const result = importConnectionLog(text, ZONE, "0040");
    expect(result.events.map((event) => event.kind)).toEqual(["desconexion", "conexion"]);
    expect(result.delimiter).toBe(";");
    expect(() => importConnectionLog("Fecha;Cober.\n06/10/2026 7:12:03;0", ZONE, "0040")).toThrow(/Conexión/);
  });
});

// --- Cortes ---------------------------------------------------------------

const THRESHOLDS = { microcutMaxMs: 10_000, cutMaxMs: 600_000, contrastToleranceMs: 30_000, collectiveWindowMs: 120_000, collectiveMinShare: 0.5, noisyVehicleRatio: 3, noisyVehicleMinCuts: 10 };
/** Reloj de pruebas: hora y día en UTC, sin zona. */
const CLOCK = {
  hourOf: (utcMs: number): number => new Date(utcMs).getUTCHours(),
  dayOf: (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10),
};
const T0 = Date.UTC(2026, 9, 6, 5, 0, 0);
const S = 1000;
const event = (agvId: string, offsetS: number, kind: ConnectionEvent["kind"], sourceRow = 2): ConnectionEvent => ({
  agvId,
  utcMs: T0 + offsetS * S,
  kind,
  rawKind: kind,
  coverage: kind === "desconexion" ? "0" : "255",
  ipTerminal: "10.0.0.7",
  version: "2.00",
  aux: "",
  mtc: null,
  sourceRow,
});
const RING = ["A", "B", "C", "D", "E", "F"];
/** Un AGV que recorre el anillo a 10 s por tramo desde `startS`, tantas vueltas como se pida. */
function laps(agvId: string, startS: number, count: number): CutReading[] {
  const readings: CutReading[] = [];
  for (let lap = 0; lap < count; lap += 1) {
    RING.forEach((tagId, index) => readings.push({ agvId, tagId, utcMs: T0 + (startS + lap * 60 + index * 10) * S }));
  }
  return readings;
}
function transitionsOf(readings: readonly CutReading[]): Transition[] {
  const byVehicle = new Map<string, CutReading[]>();
  for (const reading of readings) byVehicle.set(reading.agvId, [...(byVehicle.get(reading.agvId) ?? []), reading]);
  const out: Transition[] = [];
  for (const own of byVehicle.values()) {
    own.sort((a, b) => a.utcMs - b.utcMs);
    for (let i = 1; i < own.length; i += 1) {
      const from = own[i - 1] as CutReading;
      const to = own[i] as CutReading;
      out.push({ agvId: from.agvId, from: from.tagId, to: to.tagId, fromTime: from.utcMs, toTime: to.utcMs, sameInstant: false });
    }
  }
  return out;
}

describe("cortes del registro (R-COM-004, R-COM-005)", () => {
  it("empareja cada desconexión con la siguiente conexión, clasifica por duración y deja abierto el que no cierra", () => {
    const cuts = pairCuts(
      [
        event("V1", 0, "desconexion", 10),
        event("V1", 2, "conexion", 9),
        event("V1", 100, "desconexion", 8),
        event("V1", 100, "desconocido", 7),
        event("V1", 400, "conexion-tras-apagado", 6),
        event("V1", 1000, "desconexion", 5),
        event("V1", 1010, "desconexion", 4),
        event("V1", 2000, "conexion", 3),
        event("V1", 5000, "desconexion", 2),
      ],
      T0 + 6000 * S,
      THRESHOLDS,
    );
    // El cerrado por «tras apagado» es un apagado: el terminal se apagó durante el corte (propietario,
    // 2026-10-07: a las 5 se apagan hasta las 6). Con un solo AGV, ninguno es colectivo.
    expect(cuts.map((cut) => [cut.durationMs / S, cut.cutClass, cut.end, cut.sourceRow, cut.collective])).toEqual([
      [2, "microcorte", "conexion", 10, false],
      [300, "apagado", "tras-apagado", 8, false],
      [1000, "caida", "conexion", 5, false],
      [1000, "caida", "abierto", 2, false],
    ]);
    expect(cuts[3]?.toUtcMs).toBeNull();
    expect(classifyCut(10_000, THRESHOLDS)).toBe("microcorte");
    expect(classifyCut(10_001, THRESHOLDS)).toBe("corte");
    expect(classifyCut(600_001, THRESHOLDS)).toBe("caida");
    expect(classifyCut(1, THRESHOLDS, "tras-apagado")).toBe("apagado");
  });

  it("sitúa el corte entre la última lectura anterior y la primera posterior, y dice si es un tramo del anillo", () => {
    const readings = laps("V1", 0, 3);
    // Corte a los 12 s: después de B (10 s) y antes de C (20 s): tramo B→C. Otro a los 75 s que dura
    // 40 s: después de B de la segunda vuelta (70 s), vuelve antes de E (100 s): entre B y E, sin situar más.
    const cuts = locateCuts(
      pairCuts([event("V1", 12, "desconexion"), event("V1", 14, "conexion"), event("V1", 75, "desconexion"), event("V1", 95, "conexion")], T0 + 200 * S, THRESHOLDS),
      readings,
      [RING],
    );
    expect(cuts.map((cut) => [cut.lastTagId, cut.nextTagId, cut.location, cut.readingsInside])).toEqual([
      ["B", "C", "tramo", 0],
      ["B", "E", "entre", 2],
    ]);
    // Sin lecturas antes del corte, no se sitúa; y sin anillo, lo situado queda «entre».
    const early = locateCuts(pairCuts([event("V1", -5, "desconexion"), event("V1", -3, "conexion")], T0 + 200 * S, THRESHOLDS), readings, [RING]);
    expect(early[0]?.location).toBe("sin-situar");
    expect(locateCuts(cuts, readings, [])[0]?.location).toBe("entre");
  });

  it("resume por tag (el P), por tramo y por AGV, y concentra con la prueba de azar; el contraste cuenta ráfagas y lecturas dentro de caídas", () => {
    const readings = [...laps("V1", 0, 20), ...laps("V2", 5, 20), ...laps("V3", 7, 20)];
    // V1 pierde la señal al salir de B en 12 vueltas (microcortes); V2 y V3 una vez cada uno en D.
    const events: ConnectionEvent[] = [];
    for (let lap = 0; lap < 12; lap += 1) events.push(event("V1", lap * 60 + 12, "desconexion"), event("V1", lap * 60 + 14, "conexion"));
    // Lejos de los de V1 (más de la ventana colectiva), para que sean propios.
    events.push(event("V2", 5 + 780 + 32, "desconexion"), event("V2", 5 + 780 + 33, "conexion"), event("V3", 7 + 1020 + 32, "desconexion"), event("V3", 7 + 1020 + 33, "conexion"));
    // Y una caída de V2 con lecturas dentro, al salir de A.
    events.push(event("V2", 5 + 840 + 2, "desconexion"), event("V2", 5 + 840 + 2 + 700, "conexion"));
    const cuts = locateCuts(pairCuts(events, T0 + 2000 * S, THRESHOLDS), readings, [RING]);
    const summary = summarizeConnections(cuts, events, transitionsOf(readings), [], THRESHOLDS, 0.01, CLOCK);
    expect(summary.total).toBe(15);
    expect(summary.individual).toBe(15);
    // V1 corta doce veces en 120 pasadas (100 por mil) frente a una mediana de la flota de 8,3 por mil
    // (V2 con una caída y un microcorte, V3 con uno): es un terminal ruidoso y se aparta del mapa.
    expect(summary.noisyVehicles).toEqual(["V1"]);
    expect(summary.excludedNoisy).toBe(12);
    expect(summary.vehicles[0]).toMatchObject({ agvId: "V1", noisy: true });
    expect(summary.vehicles[0]?.rateRatio ?? 0).toBeGreaterThan(3);
    expect(summary.byClass).toEqual({ microcorte: 14, corte: 0, caida: 1, apagado: 0 });
    expect(summary.byHour.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(summary.byHour[5]).toBe(3);
    expect(summary.collectives).toEqual([]);
    // En el mapa no queda nada de V1: ni sus cortes ni sus pasadas. B tiene 40 pasadas (V2 y V3) y
    // ningún corte; D, los dos de V2 y V3; A, la caída de V2. Sin V1, ningún sitio pasa la prueba de azar.
    const b = summary.heat.find((cell) => cell.tagId === "B");
    expect(b).toMatchObject({ cuts: 0, passes: 40, vehicles: [] });
    expect(summary.heat.find((cell) => cell.tagId === "D")).toMatchObject({ cuts: 2, passes: 40, vehicles: ["V2", "V3"] });
    expect(summary.heat.find((cell) => cell.tagId === "A")).toMatchObject({ cuts: 1, byClass: { caida: 1 } });
    // La caída de V2 no tiene lectura posterior en la ventana: se cuenta en A pero no es de ningún tramo.
    expect(summary.segments.map((segment) => [segment.from, segment.to, segment.cuts])).toEqual([["D", "E", 2]]);
    expect(summary.sites).toEqual([]);
    expect(summary.byHour.reduce((sum, value) => sum + value, 0)).toBe(3);
    // V1 sigue concentrado por vehículo y en su tarjeta: es un hallazgo de su terminal, no desaparece.
    expect(summary.concentratedVehicles.map((entry) => entry.id)).toEqual(["V1"]);
    expect(summary.vehicles[0]).toMatchObject({ agvId: "V1", cuts: 12, events: 24, ips: ["10.0.0.7"] });
    expect(summary.contrast).toMatchObject({ bursts: 0, burstsWithCut: 0, cuts: 15, falls: 1 });
    expect(summary.contrast.readingsInsideFalls).toBeGreaterThan(10);
    expect(summary.vehicles[0]?.perDay).toEqual([{ day: "2026-10-06", cuts: 12 }]);
    expect(summary.notReconnecting).toEqual([]);
  });

  it("los que no reconectan (R-COM-010): un corte abierto largo, o cerrado solo por un encendido fuera del apagado colectivo", () => {
    const readings = [...laps("V1", 0, 20), ...laps("V2", 5, 20), ...laps("V3", 7, 20)];
    const events: ConnectionEvent[] = [
      // V1 pierde la señal y no vuelve en la ventana (abierto, 50 min hasta el final).
      event("V1", 100, "desconexion"),
      // V2 pierde la señal y solo vuelve al apagar y encender, 20 min después, él solo.
      event("V2", 5 + 400, "desconexion"), event("V2", 5 + 400 + 1200, "conexion-tras-apagado"),
      // V3: un microcorte cualquiera, y un apagado corto (no cuenta: menos de cutMaxMs).
      event("V3", 7 + 60 + 12, "desconexion"), event("V3", 7 + 60 + 14, "conexion"),
      event("V3", 7 + 1500, "desconexion"), event("V3", 7 + 1500 + 30, "conexion-tras-apagado"),
    ];
    const cuts = locateCuts(pairCuts(events, T0 + 3100 * S, THRESHOLDS), readings, [RING]);
    const summary = summarizeConnections(cuts, events, transitionsOf(readings), [], THRESHOLDS, 0.01, CLOCK);
    expect(summary.notReconnecting.map((entry) => [entry.agvId, entry.end, Math.round(entry.durationMs / 60_000)])).toEqual([
      ["V1", "abierto", 50],
      ["V2", "tras-apagado", 20],
    ]);
    expect(summary.noisyVehicles).toEqual([]);
  });

  it("un corte colectivo —la mitad o más de los AGV con registro en la misma ventana— es apagado o infraestructura y sale del mapa (R-COM-008)", () => {
    const readings = [...laps("V1", 0, 20), ...laps("V2", 5, 20), ...laps("V3", 7, 20), ...laps("V4", 9, 20)];
    const events: ConnectionEvent[] = [
      // A las 5:00:12, 5:00:40 y 5:01:30 pierden la señal V1, V2 y V3: tres de cuatro, en dos minutos.
      event("V1", 12, "desconexion"), event("V1", 14, "conexion"),
      event("V2", 40, "desconexion"), event("V2", 41, "conexion"),
      event("V3", 90, "desconexion"), event("V3", 95, "conexion"),
      // V4 solo, diez minutos después, al salir de A: propio.
      event("V4", 9 + 600 + 2, "desconexion"), event("V4", 9 + 600 + 3, "conexion"),
      // El apagado de la noche: V1 y V2 se desconectan a la vez y vuelven «tras apagado» una hora después.
      event("V1", 3600, "desconexion"), event("V1", 7200, "conexion-tras-apagado"),
      event("V2", 3605, "desconexion"), event("V2", 7205, "conexion-tras-apagado"),
    ];
    const cuts = locateCuts(pairCuts(events, T0 + 8000 * S, THRESHOLDS), readings, [RING]);
    expect(cuts.map((cut) => [cut.agvId, cut.cutClass, cut.collective])).toEqual([
      ["V1", "microcorte", true],
      ["V2", "microcorte", true],
      ["V3", "microcorte", true],
      ["V4", "microcorte", false],
      ["V1", "apagado", true],
      ["V2", "apagado", true],
    ]);
    const summary = summarizeConnections(cuts, events, transitionsOf(readings), [], THRESHOLDS, 0.01, CLOCK);
    expect(summary.total).toBe(6);
    expect(summary.individual).toBe(1);
    expect(summary.byClass).toEqual({ microcorte: 4, corte: 0, caida: 0, apagado: 2 });
    expect(summary.collectives.map((entry) => [entry.vehicles, entry.byClass.apagado])).toEqual([
      [["V1", "V2", "V3"], 0],
      [["V1", "V2"], 2],
    ]);
    // El mapa y las horas solo llevan el corte propio de V4; los colectivos y los apagados, no.
    expect(summary.heat.filter((cell) => cell.cuts > 0).map((cell) => [cell.tagId, cell.vehicles])).toEqual([["A", ["V4"]]]);
    expect(summary.byHour.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(summary.sites).toEqual([]);
    expect(summary.vehicles.find((own) => own.agvId === "V1")).toMatchObject({ cuts: 2, collective: 2, byClass: { apagado: 1 }, perDay: [{ day: "2026-10-06", cuts: 0 }] });
  });
});
