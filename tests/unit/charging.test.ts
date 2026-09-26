/**
 * Calles de carga online: configuración y máquina de estados.
 *
 * Lo que se fija aquí no es que el código corra, sino las cuatro frases que el producto no puede
 * decir mal: una parada de media hora en una calle **no es un silencio**; una calle por la que no
 * pasó nadie **no convierte sus tags en sospechosos**; un vehículo que sale sin haber entrado
 * **ya estaba dentro** y su calle no estaba vacía; y sin calles configuradas nada de esto se
 * reconoce, que es la degradación que R-CO-006 exige en lugar de la proximidad.
 */

import { describe, expect, it } from "vitest";

import {
  laneEntryTags,
  laneTags,
  readCoLanes,
  readCriticalPoints,
  readZones,
  type ConfigEntry,
} from "../../src/domain/circuit-config.js";
import { buildChargingReport, findLaneJunctions, type ChargingThresholds } from "../../src/domain/charging.js";
import type { Reading } from "../../src/domain/reading.js";

const THRESHOLDS: ChargingThresholds = { longStayRatio: 2, minStaysForMedian: 4, usageMaxChance: 0.001, usageMinDeviation: 0.25 };

function entry(
  tagId: string,
  funcion: string,
  grupo: string,
  order: number | null = null,
  capacidad: number | null = null,
): ConfigEntry {
  return { tagId, order, funcion, grupo, capacidad };
}

function lane(id: string, base: number, capacity: number | null = 2): readonly ConfigEntry[] {
  return [
    entry(String(base), "entrada", id, 1, capacity),
    entry(String(base + 1), "parada-precisa", id, 2, capacity),
    entry(String(base + 2), "salida", id, 3, capacity),
  ];
}

const MINUTE = 60_000;

function read(agvId: string, tagId: string, utcMs: number): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "h", sourceRow: 1 },
  };
}

describe("configuración de calles (R-CO-001)", () => {
  it("monta una calle con sus tres papeles y su capacidad", () => {
    const { lanes, problems } = readCoLanes([...lane("calle-1", 700), ...lane("calle-2", 710)]);
    expect(problems).toEqual([]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.tags).toEqual(["700", "701", "702"]);
    expect(lanes[0]?.stopTagId).toBe("701");
    expect(lanes[0]?.exitTagId).toBe("702");
    expect(lanes[0]?.capacity).toBe(2);
    expect([...laneEntryTags(lanes)]).toEqual(["700", "710"]);
    expect(laneTags(lanes).size).toBe(6);
  });

  it("una calle sin parada precisa no se monta, y se dice por qué", () => {
    // Adivinar cuál de los tres es la parada por su posición sería sustituir la configuración por
    // proximidad, que es exactamente lo que R-CO-006 prohíbe.
    const incompleta = [entry("800", "entrada", "calle-x", 1), entry("802", "salida", "calle-x", 2)];
    const { lanes, problems } = readCoLanes(incompleta);
    expect(lanes).toEqual([]);
    expect(problems.join(" ")).toContain("parada-precisa");
  });

  it("una calle con el mismo papel dos veces no se monta", () => {
    const ambigua = [
      ...lane("calle-1", 700),
      entry("709", "parada-precisa", "calle-1", 4),
    ];
    const { lanes, problems } = readCoLanes(ambigua);
    expect(lanes).toEqual([]);
    expect(problems.join(" ")).toContain("más de");
  });

  it("una calle puede empezar en su parada precisa: sin entrada, y con pasos intermedios sin función", () => {
    // Así son las calles de un circuito real: el vehículo entra y se para en el primer tag, espera la
    // carga, y sale por los siguientes.
    const { lanes, problems } = readCoLanes([
      entry("730", "parada-precisa", "calle-a", 1),
      entry("731", "", "calle-a", 2),
      entry("732", "salida", "calle-a", 3),
      entry("740", "parada-precisa", "calle-b", 1),
      entry("741", "salida", "calle-b", 2),
    ]);
    expect(problems).toEqual([]);
    expect(lanes.map((item) => [item.laneId, item.entryTagId, item.stopTagId, item.exitTagId, item.tags])).toEqual([
      ["calle-a", "730", "730", "732", ["730", "731", "732"]],
      ["calle-b", "740", "740", "741", ["740", "741"]],
    ]);
  });

  it("sin salida una calle no se monta, aunque empiece en su parada", () => {
    const { lanes, problems } = readCoLanes([entry("750", "parada-precisa", "calle-c", 1), entry("751", "", "calle-c", 2)]);
    expect(lanes).toEqual([]);
    expect(problems.join(" ")).toContain("salida");
  });

  it("una calle que da el mismo tag a dos papeles, o repite un tag o un orden, no se monta", () => {
    const mismoTag = readCoLanes([entry("760", "entrada", "calle-d", 1), entry("760", "parada-precisa", "calle-d", 2), entry("762", "salida", "calle-d", 3)]);
    expect(mismoTag.lanes).toEqual([]);
    expect(mismoTag.problems.join(" ")).toContain("repite el tag 760");
    const paradaYSalida = readCoLanes([entry("770", "parada-precisa", "calle-e", 1), entry("771", "", "calle-e", 2), entry("770", "salida", "calle-e", 3)]);
    expect(paradaYSalida.lanes).toEqual([]);
    const mismoOrden = readCoLanes([entry("780", "entrada", "calle-f", 1), entry("781", "parada-precisa", "calle-f", 1), entry("782", "salida", "calle-f", 3)]);
    expect(mismoOrden.lanes).toEqual([]);
    expect(mismoOrden.problems.join(" ")).toContain("mismo «orden»");
  });

  it("dos calles que comparten la parada precisa o la salida no se montan; una entrada común solo avisa", () => {
    const compartida = readCoLanes([
      ...lane("calle-g", 800),
      entry("810", "entrada", "calle-h", 1),
      entry("801", "parada-precisa", "calle-h", 2),
      entry("812", "salida", "calle-h", 3),
      ...lane("calle-i", 820),
    ]);
    expect(compartida.lanes.map((lane) => lane.laneId)).toEqual(["calle-i"]);
    expect(compartida.problems.join(" ")).toContain("comparten la parada precisa 801");
    const entradaComun = readCoLanes([
      ...lane("calle-j", 830),
      entry("830", "entrada", "calle-k", 1),
      entry("841", "parada-precisa", "calle-k", 2),
      entry("842", "salida", "calle-k", 3),
    ]);
    expect(entradaComun.lanes.map((lane) => lane.laneId)).toEqual(["calle-j", "calle-k"]);
    expect(entradaComun.problems.join(" ")).toContain("comparten la entrada 830");
  });

  it("con «orden» solo en parte de las filas manda el orden del fichero, y se avisa; un null no va primero", () => {
    const { lanes, problems } = readCoLanes([
      entry("850", "entrada", "calle-l", 1),
      entry("851", "parada-precisa", "calle-l", null),
      entry("852", "salida", "calle-l", 3),
    ]);
    expect(lanes[0]?.tags).toEqual(["850", "851", "852"]);
    expect(problems.join(" ")).toContain("orden a medias");
  });

  it("un tag de carga sin calle se declara en vez de repartirse a ojo", () => {
    const { lanes, problems } = readCoLanes([entry("900", "entrada", "")]);
    expect(lanes).toEqual([]);
    expect(problems.join(" ")).toContain("900");
  });

  it("las zonas se leen por grupo y una contradicción se declara", () => {
    const { zoneOf, problems } = readZones([
      entry("10", "", "vacio"),
      entry("11", "", "cargado"),
      entry("10", "", "cargado"),
    ]);
    expect(zoneOf.get("10")).toBe("vacio");
    expect(zoneOf.get("11")).toBe("cargado");
    expect(problems.join(" ")).toContain("dos zonas");
  });

  it("los puntos críticos se leen por función, y una función fuera de la taxonomía se conserva con aviso (R-GRA-007)", () => {
    const { funcionOf, problems } = readCriticalPoints([
      entry("102185", "bifurcacion", ""),
      entry("103358", "parada-precisa", ""),
      entry("999999", "girar-a-la-izquierda", ""),
    ]);
    expect(funcionOf.get("102185")).toBe("bifurcacion");
    expect(funcionOf.get("103358")).toBe("parada-precisa");
    expect(funcionOf.get("999999")).toBe("girar-a-la-izquierda");
    expect(problems.join(" ")).toContain("999999");
  });

  it("un punto crítico con dos funciones contradictorias se queda con la primera", () => {
    const { funcionOf, problems } = readCriticalPoints([
      entry("102185", "bifurcacion", ""),
      entry("102185", "cruce", ""),
    ]);
    expect(funcionOf.get("102185")).toBe("bifurcacion");
    expect(problems.join(" ")).toContain("dos funciones");
  });

  it("las nueve funciones de la taxonomía original se aceptan sin aviso (Parte 36: vinculación/desvinculación)", () => {
    const { funcionOf, problems } = readCriticalPoints([
      entry("1", "parada-precisa", ""),
      entry("2", "cruce", ""),
      entry("3", "semaforo", ""),
      entry("4", "dejar-carro", ""),
      entry("5", "recoger-carro", ""),
      entry("6", "cambio-de-mapa", ""),
      entry("7", "bifurcacion", ""),
      entry("8", "vinculacion", ""),
      entry("9", "desvinculacion", ""),
    ]);
    expect(funcionOf.get("8")).toBe("vinculacion");
    expect(funcionOf.get("9")).toBe("desvinculacion");
    expect(problems).toHaveLength(0);
  });

  it("parada, giro, cambio de MTC, tramo conflictivo y control wifi entran en la taxonomía sin aviso (propietario, 2026-09-26)", () => {
    const { funcionOf, problems } = readCriticalPoints([
      entry("1", "parada", ""),
      entry("2", "giro", ""),
      entry("3", "cambio-de-mtc", ""),
      entry("6", "tramo-conflictivo", ""),
      entry("7", "control-wifi", ""),
    ]);
    expect([...funcionOf.values()]).toEqual(["parada", "giro", "cambio-de-mtc", "tramo-conflictivo", "control-wifi"]);
    expect(problems).toHaveLength(0);
    const conGrupo = readCriticalPoints([entry("4", "cambio-de-mtc", "C.O.1"), entry("5", "giro", "")]);
    expect([...conGrupo.groupOf]).toEqual([["4", "C.O.1"]]);
  });

  it("una función de planta fuera de la taxonomía cuenta como crítica y se avisa una vez por función", () => {
    const { funcionOf, problems } = readCriticalPoints([
      entry("1", "luz-de-aviso", ""),
      entry("2", "pin-arriba", ""),
      entry("3", "luz-de-aviso", ""),
    ]);
    expect(funcionOf.get("1")).toBe("luz-de-aviso");
    expect(funcionOf.get("3")).toBe("luz-de-aviso");
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("«luz-de-aviso» (tags 1, 3)");
    expect(problems[0]).toContain("Cuenta como punto crítico");
  });

  it("la función crítica se lee igual venga de «critico» o del circuito virtual — es el llamador quien combina las fuentes, no esta función", () => {
    // `readCriticalPoints` no distingue de qué lista vienen las entradas: el merge de fuentes
    // (Parte 36) vive en el punto de llamada (`import.worker.ts`/`auditoria.test.ts`), concatenando
    // las entradas de «critico» con las de «circuito» que sí declaran función. Aquí basta confirmar
    // que dos arrays concatenados, simulando cada fuente, se comportan como una sola lista.
    const desdeCritico = [entry("102185", "vinculacion", "")];
    const desdeCircuito = [entry("103358", "desvinculacion", "")];
    const { funcionOf } = readCriticalPoints([...desdeCritico, ...desdeCircuito]);
    expect(funcionOf.get("102185")).toBe("vinculacion");
    expect(funcionOf.get("103358")).toBe("desvinculacion");
  });
});

describe("máquina de estados de la calle (R-CO-002)", () => {
  const { lanes } = readCoLanes([...lane("calle-1", 700), ...lane("calle-2", 710)]);
  const coverage = [{ from: 0, to: 600 * MINUTE }];

  it("entrada, parada y salida de la misma calle es una estancia, no un silencio", () => {
    const readings = [
      read("A", "700", 10 * MINUTE),
      read("A", "701", 11 * MINUTE),
      read("A", "702", 41 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.served).toBe(true);
    expect(calle1?.stays).toHaveLength(1);
    expect(calle1?.stays[0]?.state).toBe("completa");
    expect(calle1?.stays[0]?.durationMs).toBe(30 * MINUTE);
    // La secuencia es observada; que estuviera cargando, inferido. Nunca `observed`.
    expect(calle1?.stays[0]?.truth).toBe("inferred");
  });

  it("en una calle que empieza en su parada, la estancia va de la parada a la salida", () => {
    const { lanes: desdeLaParada } = readCoLanes([
      entry("730", "parada-precisa", "calle-a", 1),
      entry("731", "", "calle-a", 2),
      entry("732", "salida", "calle-a", 3),
    ]);
    const readings = [
      read("A", "730", 10 * MINUTE),
      // Leer otra vez la parada estando dentro no es otra entrada.
      read("A", "730", 12 * MINUTE),
      read("A", "731", 90 * MINUTE),
      read("A", "732", 91 * MINUTE),
    ];
    const report = buildChargingReport(readings, desdeLaParada, coverage, THRESHOLDS);
    const stays = report.lanes[0]?.stays ?? [];
    expect(stays).toHaveLength(1);
    expect(stays[0]?.state).toBe("completa");
    expect(stays[0]?.durationMs).toBe(81 * MINUTE);
    expect(stays[0]?.evidence).toContain("parada precisa y salida");
  });

  it("una calle por la que no entró nadie no tiene estancias, y eso no acusa a sus tags", () => {
    const readings = [read("A", "700", 1 * MINUTE), read("A", "701", 2 * MINUTE), read("A", "702", 32 * MINUTE)];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle2 = report.lanes.find((item) => item.laneId === "calle-2");
    expect(calle2?.served).toBe(false);
    expect(calle2?.stays).toEqual([]);
    // No hay ningún campo que diga «tag sospechoso»: sin entradas no hubo oportunidad de leerlo.
    expect(calle2?.longStays).toEqual([]);
    expect(calle2?.outOfSeniority).toEqual([]);
  });

  it("el que sale sin haber entrado ya estaba dentro antes de la cobertura (R-CO-007)", () => {
    const readings = [
      // La primera lectura de toda su vida en esta ventana es la salida de la calle.
      read("B", "702", 5 * MINUTE),
      read("B", "999", 6 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    expect(report.startedInside).toHaveLength(1);
    expect(report.startedInside[0]?.agvId).toBe("B");
    expect(report.startedInside[0]?.state).toBe("abierta-al-inicio");
    expect(report.startedInside[0]?.enteredUtcMs).toBeNull();
    expect(report.startedInside[0]?.truth).toBe("inferred");
    // Y con el inicio de la cobertura se puede decir desde cuándo no se sabía, en vez de afirmar
    // que la calle estuvo vacía esos cinco minutos.
    expect(report.coverageStartUtcMs).toBe(0);
  });

  it("una estancia que cruza el hueco entre dos exportaciones no se sabe cuánto duró: incompleta, y no acusa a nadie", () => {
    // A entra en la primera exportación y su siguiente lectura es la salida, en la segunda, un día
    // después. B, C, D y E cargan 30 min en la segunda. Darla por completa la hacía permanencia larga
    // y «salida fuera de antigüedad» frente a los cuatro (R-DAT-007: el hueco es sin datos, no espera).
    const twoExports = [
      { from: 0, to: 60 * MINUTE },
      { from: 25 * 60 * MINUTE, to: 26 * 60 * MINUTE },
    ];
    const readings = [
      read("A", "700", 50 * MINUTE),
      read("A", "701", 51 * MINUTE),
      read("A", "702", 25 * 60 * MINUTE + 10 * MINUTE),
      ...["B", "C", "D", "E"].flatMap((agvId, index) => [
        read(agvId, "700", 25 * 60 * MINUTE + index * MINUTE),
        read(agvId, "701", 25 * 60 * MINUTE + index * MINUTE + 10_000),
        read(agvId, "702", 25 * 60 * MINUTE + index * MINUTE + 30 * MINUTE),
      ]),
    ];
    const calle1 = buildChargingReport(readings, lanes, twoExports, THRESHOLDS).lanes.find((item) => item.laneId === "calle-1");
    const a = calle1?.stays.find((stay) => stay.agvId === "A");
    expect(a).toMatchObject({ state: "incompleta", truth: "unknown", durationMs: null, enteredUtcMs: 50 * MINUTE, leftUtcMs: 25 * 60 * MINUTE + 10 * MINUTE });
    expect(a?.evidence).toContain("sin datos cargados");
    expect(calle1?.longStays).toEqual([]);
    expect(calle1?.outOfSeniority).toEqual([]);
    // La mediana se hace con las cuatro completas.
    expect(calle1?.medianStayMs).toBe(30 * MINUTE - 10_000);
  });

  it("salir de una calle habiendo circulado antes no es arranque en frío", () => {
    const readings = [
      read("C", "999", 1 * MINUTE),
      read("C", "702", 5 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    expect(report.startedInside).toEqual([]);
  });

  it("al que entró antes y salió después se le saltó el turno (R-CO-003)", () => {
    const readings = [
      // D entra primero y sale el último; E y F entran después y salen antes.
      read("D", "700", 1 * MINUTE),
      read("D", "701", 2 * MINUTE),
      read("E", "700", 5 * MINUTE),
      read("E", "701", 6 * MINUTE),
      read("E", "702", 36 * MINUTE),
      read("F", "700", 40 * MINUTE),
      read("F", "701", 41 * MINUTE),
      read("F", "702", 71 * MINUTE),
      read("D", "702", 120 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.outOfSeniority).toHaveLength(1);
    expect(calle1?.outOfSeniority[0]?.waited).toBe("D");
    expect(calle1?.outOfSeniority[0]?.overtakenBy).toEqual(["E", "F"]);
  });

  it("sin calles configuradas no se reconoce nada, en vez de aproximarlo (R-CO-006)", () => {
    const readings = [read("A", "700", 1 * MINUTE), read("A", "702", 31 * MINUTE)];
    const report = buildChargingReport(readings, [], coverage, THRESHOLDS);
    expect(report.lanes).toEqual([]);
    expect(report.startedInside).toEqual([]);
  });

  it("una permanencia larga se mide contra la mediana de su propia calle", () => {
    const normal = (agv: string, start: number) => [
      read(agv, "700", start),
      read(agv, "701", start + MINUTE),
      read(agv, "702", start + 31 * MINUTE),
    ];
    const readings = [
      ...normal("A", 0),
      ...normal("B", 60 * MINUTE),
      ...normal("C", 120 * MINUTE),
      ...normal("D", 180 * MINUTE),
      // E se queda dentro tres horas: seis veces la mediana de media hora.
      read("E", "700", 240 * MINUTE),
      read("E", "701", 241 * MINUTE),
      read("E", "702", 421 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.medianStayMs).toBe(30 * MINUTE);
    expect(calle1?.longStays.map((stay) => stay.agvId)).toEqual(["E"]);
  });

  it("con pocas estancias no hay mediana, así que no se señala ninguna permanencia", () => {
    // Dos estancias no sostienen una mediana, y llamar «larga» a la mayor de dos es inventarse un
    // hallazgo. Sin soporte, no se dice nada.
    const readings = [
      read("A", "700", 0),
      read("A", "702", 30 * MINUTE),
      read("B", "700", 60 * MINUTE),
      read("B", "702", 300 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, coverage, THRESHOLDS);
    const calle1 = report.lanes.find((item) => item.laneId === "calle-1");
    expect(calle1?.medianStayMs).toBeNull();
    expect(calle1?.longStays).toEqual([]);
  });
});

describe("de qué tag del anillo cuelga cada calle (findLaneJunctions)", () => {
  const { lanes } = readCoLanes([...lane("calle-1", 700), ...lane("calle-2", 710)]);
  const ring = ["A", "B", "C"];

  it("es el predecesor del anillo más frecuente de su tag de entrada", () => {
    const transitions = [
      { from: "A", to: "700" },
      { from: "A", to: "700" },
      { from: "B", to: "700" },
      // Muchas desde fuera del anillo no cuentan: la calle se dibuja colgada del anillo.
      ...Array.from({ length: 5 }, () => ({ from: "X", to: "700" })),
    ];
    expect(findLaneJunctions(lanes, transitions, ring)).toEqual([{ laneId: "calle-1", tagId: "A" }]);
  });

  it("una calle en la que nadie entró desde el anillo no tiene punto de enganche inventado", () => {
    expect(findLaneJunctions(lanes, [{ from: "A", to: "700" }], ring).map((junction) => junction.laneId)).toEqual([
      "calle-1",
    ]);
  });
});

describe("vehículos que no entraron en ninguna calle (neverCharged)", () => {
  const { lanes } = readCoLanes([...lane("calle-1", 700)]);

  it("sale quien no tiene ninguna estancia; no salen ni una estancia completa ni un arranque en frío", () => {
    const readings = [
      // A entra, para y sale: tiene estancia.
      read("A", "1", 0),
      read("A", "700", 1 * MINUTE),
      read("A", "701", 2 * MINUTE),
      read("A", "702", 30 * MINUTE),
      // B circula y no entra nunca.
      read("B", "1", 0),
      read("B", "2", 5 * MINUTE),
      // C ya estaba dentro al empezar (R-CO-007): su estancia es abierta al inicio, pero es estancia.
      read("C", "702", 0),
      read("C", "1", 1 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, [{ from: 0, to: 60 * MINUTE }], THRESHOLDS);
    expect(report.neverCharged.map((entry) => entry.agvId)).toEqual(["B"]);
    expect(report.neverCharged[0]).toMatchObject({ firstUtcMs: 0, lastUtcMs: 5 * MINUTE, readings: 2 });
  });
});

describe("las tres comprobaciones de planta sobre las calles (R-CO-009)", () => {
  const { lanes } = readCoLanes([...lane("calle-1", 700), ...lane("calle-2", 710), ...lane("calle-3", 720)]);
  /** Una estancia completa de `agvId` en la calle `base`: entrada, parada y salida, `skip` sin leer. */
  const stay = (agvId: string, base: number, at: number, skip: readonly string[] = []): Reading[] =>
    [String(base), String(base + 1), String(base + 2)]
      .filter((tagId) => !skip.includes(tagId))
      .map((tagId, index) => read(agvId, tagId, at + index * 2 * MINUTE));

  it("por tag de la calle, en cuántas estancias completas se leyó: la parada que no se lee sale con su cifra", () => {
    const readings = [
      ...stay("A", 700, 0),
      ...stay("B", 700, 20 * MINUTE, ["701"]),
      ...stay("C", 700, 40 * MINUTE, ["701"]),
      ...stay("A", 710, 60 * MINUTE),
    ];
    const report = buildChargingReport(readings, lanes, [{ from: 0, to: 120 * MINUTE }], THRESHOLDS);
    const calle1 = report.lanes.find((entry) => entry.laneId === "calle-1");
    expect(calle1?.tagReads).toEqual([
      { tagId: "700", role: "entrada", staysRead: 3, stays: 3, readings: 3, vehicles: 3 },
      { tagId: "701", role: "parada-precisa", staysRead: 1, stays: 3, readings: 1, vehicles: 1 },
      { tagId: "702", role: "salida", staysRead: 3, stays: 3, readings: 3, vehicles: 3 },
    ]);
  });

  it("una calle servida mucho menos que las demás se señala con su cuota; un reparto parejo no dice nada", () => {
    const parejo: Reading[] = [];
    for (let i = 0; i < 20; i += 1) {
      parejo.push(...stay("A", 700, i * 60 * MINUTE), ...stay("B", 710, i * 60 * MINUTE), ...stay("C", 720, i * 60 * MINUTE + 5 * MINUTE));
    }
    const igual = buildChargingReport(parejo, lanes, [{ from: 0, to: 24 * 60 * MINUTE }], THRESHOLDS);
    expect(igual.usage.map((entry) => entry.verdict)).toEqual([null, null, null]);

    const desigual: Reading[] = [];
    for (let i = 0; i < 30; i += 1) {
      desigual.push(...stay("A", 700, i * 60 * MINUTE), ...stay("B", 710, i * 60 * MINUTE));
      if (i % 10 === 0) desigual.push(...stay("C", 720, i * 60 * MINUTE + 5 * MINUTE));
    }
    const report = buildChargingReport(desigual, lanes, [{ from: 0, to: 36 * 60 * MINUTE }], THRESHOLDS);
    const calle3 = report.usage.find((entry) => entry.laneId === "calle-3");
    expect(calle3).toMatchObject({ stays: 3, verdict: "menos" });
    expect(calle3?.chance).toBeLessThan(0.001);
    expect(report.usage.filter((entry) => entry.laneId !== "calle-3").map((entry) => entry.verdict)).toEqual([null, null]);
  });

  it("el reparto solo compara calles servidas: la que nadie usa ya tiene su clase, y con una sola servida no hay reparto", () => {
    const readings = [...stay("A", 700, 0), ...stay("B", 700, 30 * MINUTE)];
    const report = buildChargingReport(readings, lanes, [{ from: 0, to: 120 * MINUTE }], THRESHOLDS);
    expect(report.usage).toEqual([]);
    expect(report.neverCharged).toEqual([]);
  });
});

