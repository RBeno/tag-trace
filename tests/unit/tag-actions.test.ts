/**
 * Lecturas con acciones de un AGV (DS-014): importador, catálogo por tag y MTC y avisos para verificar
 * (R-AGV-023, R-AGV-024; TC-328 a TC-331). Filas sintéticas con la forma de la exportación.
 */

import { describe, expect, it } from "vitest";
import { buildTagActions, parseAction, type ActionReading } from "../../src/domain/tag-actions.js";
import { ActionsFailure, importActionRows, importActionText, mergeActionReadings } from "../../src/ingestion/vehicle-actions.js";

const HEADER = ["Fecha", "Nº Tag", "MTC", "MTD", "Acciones", "No en memoria", "No ejecutado"];
const CONTINUAR = "Continuar / Continuar, Pin Abajo, Seguir recto, Mapa Aproximación, vel 20 m/min ";
const PARADA = "Parada temporizada / Parada temporizada, Pin Arriba, Temporización 4 segundos";

describe("importador de lecturas con acciones (DS-014)", () => {
  it("lee fecha día/mes, tag como texto, MTC por número y las dos marcas", () => {
    const result = importActionRows(
      [
        HEADER,
        ["13/10/2026 17:07:09", "0040", "", "", CONTINUAR, "False", "True"],
        ["13/10/2026 17:07:03", "T2", "MTC nº 7", "", PARADA, "True", "False"],
      ],
      "Europe/Madrid",
      true,
    );
    expect(result.readings.map((reading) => [reading.tagId, reading.mtc, reading.notInMemory, reading.notExecuted])).toEqual([
      ["0040", "", false, true],
      ["T2", "7", true, false],
    ]);
    expect(new Date(result.readings[0]?.utcMs ?? 0).getUTCMonth()).toBe(9);
    expect(result.warnings).toEqual([]);
  });

  it("sin las columnas de marcas lo avisa; sin «Acciones» no adivina", () => {
    const result = importActionText("Fecha;Nº Tag;Acciones\n13/10/2026 1:00:00;T1;Continuar / Continuar\n", "Europe/Madrid");
    expect(result.warnings.join(" ")).toMatch(/No en memoria/);
    expect(result.warnings.join(" ")).toMatch(/No ejecutado/);
    expect(() => importActionRows([["Fecha", "Nº Tag"], ["13/10/2026 1:00:00", "T1"]], "Europe/Madrid", false)).toThrow(ActionsFailure);
  });

  it("una fila sin tag o con fecha imposible se rechaza con su motivo", () => {
    const result = importActionRows(
      [HEADER, ["13/10/2026 1:00:00", "", "", "", CONTINUAR, "", ""], ["32/10/2026 1:00:00", "T1", "", "", CONTINUAR, "", ""], ["13/10/2026 1:00:00", "T1", "", "", CONTINUAR, "", ""]],
      "Europe/Madrid",
      false,
    );
    expect(result.rejected.map((entry) => entry.reason)).toEqual(["SIN_TAG", "FECHA_INVALIDA"]);
  });

  it("dos informes que se solapan no duplican lecturas", () => {
    const one = importActionText(`Fecha;Nº Tag;Acciones\n13/10/2026 1:00:00;T1;${PARADA}\n`, "Europe/Madrid");
    const two = importActionText(`Fecha;Nº Tag;Acciones\n13/10/2026 1:00:00;T1;${PARADA}\n13/10/2026 1:00:09;T2;${PARADA}\n`, "Europe/Madrid");
    expect(mergeActionReadings(one.readings, two.readings).added).toBe(1);
  });
});

describe("acción de un tag", () => {
  it("descompone orden, pin, giro, mapa, velocidad, espera y baliza", () => {
    expect(parseAction(CONTINUAR)).toEqual({
      kind: "Continuar",
      pin: "Abajo",
      turn: "Seguir recto",
      map: "Aproximación",
      speedMPerMin: 20,
      waitS: null,
      beacon: null,
      other: [],
    });
    expect(parseAction(PARADA).waitS).toBe(4);
    expect(parseAction("Parada condicionada / Parada condicionada, Pin Arriba, Baliza 000123").beacon).toBe("000123");
    expect(parseAction("Cambio nº modo circuito / Cambio nº modo circuito, Pin Arriba, Algo nuevo").other).toEqual(["Algo nuevo"]);
  });
});

let row = 1;
function read(tagId: string, utcMs: number, options: Partial<ActionReading> = {}): ActionReading {
  row += 1;
  return { utcMs, raw: "", tagId, mtc: "", action: CONTINUAR, notInMemory: false, notExecuted: false, sourceRow: row, ...options };
}

describe("catálogo y avisos (R-AGV-023, R-AGV-024)", () => {
  const T0 = Date.UTC(2026, 9, 13, 6, 0, 0);
  const minute = 60_000;

  it("el catálogo va por tag y MTC, con la acción más leída y sus variantes", () => {
    const report = buildTagActions({
      readingsByAgv: new Map([
        ["A1", [read("T1", T0), read("T1", T0 + minute), read("T1", T0 + 2 * minute, { mtc: "7", action: PARADA }), read("T1", T0 + 3 * minute, { action: PARADA })]],
      ]),
      cutsByAgv: new Map(),
    });
    expect(report.catalog.map((entry) => [entry.tagId, entry.mtc, entry.reads, entry.parsed.kind, entry.variants.length])).toEqual([
      ["T1", "", 3, "Continuar", 1],
      ["T1", "7", 1, "Parada temporizada", 0],
    ]);
  });

  it("un tag que no se ejecuta nunca se avisa, y dice si llegó a pasar sin wifi", () => {
    const readings = [read("T9", T0, { notExecuted: true }), read("T9", T0 + 10 * minute, { notExecuted: true })];
    const sinInforme = buildTagActions({ readingsByAgv: new Map([["A1", readings]]), cutsByAgv: new Map() });
    expect(sinInforme.notExecuted[0]?.pattern).toBe("nunca");
    expect(sinInforme.notExecuted[0]?.evidence).toMatch(/Sin informe de conexiones/);
    const sinCortes = buildTagActions({ readingsByAgv: new Map([["A1", readings]]), cutsByAgv: new Map([["A1", []]]) });
    expect(sinCortes.notExecuted[0]?.evidence).toMatch(/Ninguna lectura cayó sin wifi/);
  });

  it("si solo se ejecuta dentro de cortes wifi, se comporta como control wifi", () => {
    const report = buildTagActions({
      readingsByAgv: new Map([["A1", [read("T9", T0, { notExecuted: true }), read("T9", T0 + 10 * minute), read("T9", T0 + 20 * minute, { notExecuted: true })]]]),
      cutsByAgv: new Map([["A1", [[T0 + 9 * minute, T0 + 11 * minute]]]]),
    });
    expect(report.notExecuted[0]?.pattern).toBe("solo-sin-wifi");
    expect(report.notExecuted[0]?.wifi).toEqual({ executedInCut: 1, executedOutside: 0, notExecutedInCut: 0, notExecutedOutside: 2 });
  });

  it("si se ejecuta con un MTC y no con otro, depende del MTC", () => {
    const report = buildTagActions({
      readingsByAgv: new Map([["A1", [read("T9", T0, { notExecuted: true }), read("T9", T0 + minute, { mtc: "1" })]]]),
      cutsByAgv: new Map(),
    });
    expect(report.notExecuted[0]?.pattern).toBe("segun-mtc");
    expect(report.notExecuted[0]?.evidence).toMatch(/Se ejecutó con MTC 1 y no con normal/);
  });

  it("sin patrón lo dice, y un tag sin «No ejecutado» no se avisa", () => {
    const report = buildTagActions({
      readingsByAgv: new Map([["A1", [read("T9", T0, { notExecuted: true }), read("T9", T0 + minute), read("T8", T0 + 2 * minute)]]]),
      cutsByAgv: new Map(),
    });
    expect(report.notExecuted.map((notice) => [notice.tagId, notice.pattern])).toEqual([["T9", "sin-patron"]]);
  });

  it("cada lectura «No en memoria» se avisa con AGV, hora y MTC", () => {
    const report = buildTagActions({
      readingsByAgv: new Map([
        ["A2", [read("T5", T0 + minute, { notInMemory: true, mtc: "3" })]],
        ["A1", [read("T5", T0, { notInMemory: true }), read("T6", T0)]],
      ]),
      cutsByAgv: new Map(),
    });
    expect(report.notInMemory).toHaveLength(1);
    expect(report.notInMemory[0]?.reads.map((entry) => [entry.agvId, entry.mtc])).toEqual([["A1", ""], ["A2", "3"]]);
    expect(report.notInMemory[0]?.evidence).toMatch(/AGV A1, A2/);
  });
});
