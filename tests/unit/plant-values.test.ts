/**
 * Valores de planta confirmados por una persona (OQ-140). Los estimadores de OQ-151 y su regla de
 * coincidencia se prueban en `plant-value-estimates.test.ts`.
 *
 * Lo que se fija: que cada valor se valida con su unidad; que lo vigente en un instante es el último
 * confirmado con fecha efectiva no posterior, en orden (fecha efectiva, número de evento); que aplicar
 * los valores no muta la configuración; que **sin valores confirmados el análisis usa exactamente la
 * configuración provisional** —el mismo objeto—, que es lo que hace que el Worker sin eventos dé las
 * mismas vistas que antes; y que dos registros distintos no se mezclan al abrir un `.agvproj`.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";
import {
  MAX_PLANT_DURATION_MS,
  PLANT_VALUES,
  applyPlantValues,
  classifyPlantValueEvents,
  formatPlantValue,
  plantValueEventProblem,
  plantValuesAt,
  plantValuesView,
  resolveAnalysisConfig,
  validatePlantValue,
  type PlantValueEvent,
} from "../../src/domain/plant-values.js";

const DAY = 24 * 60 * 60_000;

function event(seq: number, key: PlantValueEvent["key"], value: PlantValueEvent["value"], effectiveAt: number): PlantValueEvent {
  return { circuitId: "c1", seq, key, value, effectiveAt, recordedAt: 10 * DAY + seq, reason: `razón ${seq}`, origin: "manual" };
}

describe("catálogo · los siete valores (ocho claves: la noche son dos) y dónde viven", () => {
  it("son los siete de OQ-140 sin `drift.minGapMs`, en ocho claves, y leen los provisionales tal cual", () => {
    expect(PLANT_VALUES.map((entry) => entry.path)).toEqual([
      "regimes.nightFromHour",
      "regimes.nightToHour",
      "silenceKind.shiftStartHours",
      "silenceKind.longAbsenceMs",
      "flowStops.headStallMs",
      "flowStops.sameTimeToleranceMs",
      "fifo.minOvertakeMarginMs",
      "criticalPoints.paradaPrecisa.minDurationMs",
    ]);
    expect(PLANT_VALUES.map((entry) => entry.read(PROVISIONAL_CONFIG))).toEqual([22, 5, [6, 14, 22], 3_600_000, 120_000, 900_000, 180_000, 30_000]);
    // Los provisionales son válidos con su propia validación.
    for (const entry of PLANT_VALUES) expect(validatePlantValue(entry.key, entry.read(PROVISIONAL_CONFIG))).toBeNull();
  });
});

describe("validatePlantValue · cada valor con su unidad, con motivo en español", () => {
  it("horas: enteras de 0 a 23", () => {
    expect(validatePlantValue("noche-desde", 0)).toBeNull();
    expect(validatePlantValue("noche-hasta", 23)).toBeNull();
    expect(validatePlantValue("noche-desde", 24)).toMatch(/de 0 a 23/);
    expect(validatePlantValue("noche-desde", -1)).toMatch(/de 0 a 23/);
    expect(validatePlantValue("noche-desde", 21.5)).toMatch(/entero/);
    expect(validatePlantValue("noche-desde", "22")).toMatch(/entero/);
  });

  it("lista de horas: al menos una, cada una de 0 a 23, sin repetir", () => {
    expect(validatePlantValue("arranque-turnos", [6, 18])).toBeNull();
    expect(validatePlantValue("arranque-turnos", [])).toMatch(/al menos una/);
    expect(validatePlantValue("arranque-turnos", [6, 6, 14])).toMatch(/repetida/);
    expect(validatePlantValue("arranque-turnos", [6, 25])).toMatch(/de 0 a 23/);
    expect(validatePlantValue("arranque-turnos", 6)).toMatch(/al menos una/);
  });

  it("duraciones: milisegundos enteros, más que cero y hasta el tope de tecleo de 24 h", () => {
    expect(validatePlantValue("bloqueo-cabeza", 90_000)).toBeNull();
    expect(validatePlantValue("desconexion", MAX_PLANT_DURATION_MS)).toBeNull();
    expect(validatePlantValue("desconexion", MAX_PLANT_DURATION_MS + 1)).toMatch(/24 horas/);
    expect(validatePlantValue("margen-fifo", 0)).toMatch(/mayor que cero/);
    expect(validatePlantValue("margen-fifo", -5)).toMatch(/mayor que cero/);
    expect(validatePlantValue("parada-precisa-minima", 1.5)).toMatch(/entero/);
    expect(validatePlantValue("misma-hora", Number.NaN)).toMatch(/número/);
  });

  it("una clave que no es un valor de planta se rechaza, también `drift.minGapMs`", () => {
    expect(validatePlantValue("drift.minGapMs", 60_000)).toMatch(/no es un valor de planta/);
    expect(validatePlantValue("hueco-periodos", 60_000)).toMatch(/no es un valor de planta/);
  });
});

describe("plantValuesAt · lo vigente en el tiempo", () => {
  const events = [
    event(1, "noche-desde", 21, 5 * DAY),
    event(2, "noche-desde", 20, 8 * DAY),
    event(3, "bloqueo-cabeza", 180_000, 8 * DAY),
    // Registrado después pero con fecha efectiva anterior: corrige el pasado sin reescribir nada.
    event(4, "noche-desde", 23, 6 * DAY),
    // Misma fecha efectiva que el 2: gana el registrado después.
    event(5, "noche-desde", 19, 8 * DAY),
  ];

  it("antes de toda fecha efectiva no rige ningún confirmado", () => {
    expect(plantValuesAt(events, 5 * DAY - 1).size).toBe(0);
  });

  it("el último con fecha efectiva no posterior, en orden (fecha efectiva, número)", () => {
    expect(plantValuesAt(events, 5 * DAY).get("noche-desde")?.seq).toBe(1);
    expect(plantValuesAt(events, 7 * DAY).get("noche-desde")?.seq).toBe(4);
    expect(plantValuesAt(events, 8 * DAY).get("noche-desde")?.seq).toBe(5);
    expect(plantValuesAt(events, 8 * DAY).get("bloqueo-cabeza")?.value).toBe(180_000);
    expect(plantValuesAt(events, 7 * DAY).has("bloqueo-cabeza")).toBe(false);
  });

  it("no depende del orden en que lleguen los eventos", () => {
    expect(plantValuesAt([...events].reverse(), 9 * DAY).get("noche-desde")?.seq).toBe(5);
  });
});

describe("applyPlantValues · pone los valores sin mutar nada", () => {
  it("sin valores devuelve la misma configuración: el Worker sin eventos analiza como antes", () => {
    expect(applyPlantValues(PROVISIONAL_CONFIG, new Map())).toBe(PROVISIONAL_CONFIG);
    expect(resolveAnalysisConfig(PROVISIONAL_CONFIG, [], 1_000)).toBe(PROVISIONAL_CONFIG);
    // Con eventos que todavía no rigen, igual: la misma configuración.
    expect(resolveAnalysisConfig(PROVISIONAL_CONFIG, [event(1, "noche-desde", 20, 5 * DAY)], 4 * DAY)).toBe(PROVISIONAL_CONFIG);
  });

  it("con valores, pone cada uno en su sitio y deja el resto y la entrada intactos", () => {
    const before = JSON.stringify(PROVISIONAL_CONFIG);
    const values = plantValuesAt(
      [
        event(1, "noche-desde", 20, 0),
        event(2, "noche-hasta", 6, 0),
        event(3, "arranque-turnos", [7, 19], 0),
        event(4, "desconexion", 1_800_000, 0),
        event(5, "bloqueo-cabeza", 150_000, 0),
        event(6, "misma-hora", 600_000, 0),
        event(7, "margen-fifo", 240_000, 0),
        event(8, "parada-precisa-minima", 20_000, 0),
      ],
      1,
    );
    const config = applyPlantValues(PROVISIONAL_CONFIG, values);
    expect(JSON.stringify(PROVISIONAL_CONFIG)).toBe(before);
    expect(config.regimes).toEqual({ nightFromHour: 20, nightToHour: 6 });
    expect(config.silenceKind).toEqual({ ...PROVISIONAL_CONFIG.silenceKind, shiftStartHours: [7, 19], longAbsenceMs: 1_800_000 });
    expect(config.flowStops).toEqual({ ...PROVISIONAL_CONFIG.flowStops, headStallMs: 150_000, sameTimeToleranceMs: 600_000 });
    expect(config.fifo).toEqual({ ...PROVISIONAL_CONFIG.fifo, minOvertakeMarginMs: 240_000 });
    expect(config.criticalPoints.paradaPrecisa).toEqual({ ...PROVISIONAL_CONFIG.criticalPoints.paradaPrecisa, minDurationMs: 20_000 });
    expect(config.criticalPoints.semaforo).toBe(PROVISIONAL_CONFIG.criticalPoints.semaforo);
    // Lo que no es valor de planta no cambia, y `drift.minGapMs` tampoco.
    expect(config.drift).toBe(PROVISIONAL_CONFIG.drift);
    expect(config.readRate).toBe(PROVISIONAL_CONFIG.readRate);
    // La configuración dice con qué valores se hizo; su estado sigue siendo provisional.
    expect(config.state).toBe("draft");
    expect(config.configVersion).toBe(
      "provisional-0+planta(noche-desde#1,noche-hasta#2,arranque-turnos#3,desconexion#4,bloqueo-cabeza#5,misma-hora#6,margen-fifo#7,parada-precisa-minima#8)",
    );
  });

  it("la lista de horas se copia: cambiar el evento después no toca la configuración", () => {
    const hours = [7, 19];
    const config = resolveAnalysisConfig(PROVISIONAL_CONFIG, [event(1, "arranque-turnos", hours, 0)], 1);
    hours.push(3);
    expect(config.silenceKind.shiftStartHours).toEqual([7, 19]);
  });
});

describe("plantValuesView · lo que enseña la pestaña Datos", () => {
  const events = [event(1, "noche-desde", 20, 5 * DAY), event(2, "noche-desde", 21, 9 * DAY)];

  it("por valor: el provisional, lo vigente para el fichero, el historial y dónde se mide", () => {
    const view = plantValuesView({ events, provisional: PROVISIONAL_CONFIG, at: 6 * DAY, fileName: "f.csv", window: null, canConfirm: true });
    expect(view.values).toHaveLength(8);
    const night = view.values.find((entry) => entry.key === "noche-desde");
    expect(night?.provisional).toBe(22);
    expect(night?.current?.seq).toBe(1);
    expect(night?.history.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(night?.measuredIn?.heading).toBe("Perfil horario");
    expect(view.values.find((entry) => entry.key === "bloqueo-cabeza")?.current).toBeNull();
  });

  it("sin fichero no rige ningún confirmado", () => {
    const view = plantValuesView({ events, provisional: PROVISIONAL_CONFIG, at: null, fileName: null, window: null, canConfirm: false });
    expect(view.values.every((entry) => entry.current === null)).toBe(true);
  });

  it("un cambio dentro de la ventana de trabajo se declara (CONFIG_SCHEMA §4), no se calla", () => {
    const view = plantValuesView({ events, provisional: PROVISIONAL_CONFIG, at: 6 * DAY, fileName: "f.csv", window: { from: 4 * DAY, to: 10 * DAY }, canConfirm: true });
    expect(view.values.find((entry) => entry.key === "noche-desde")?.changesWithin?.seq).toBe(1);
    const later = plantValuesView({ events, provisional: PROVISIONAL_CONFIG, at: 6 * DAY, fileName: "f.csv", window: { from: 6 * DAY, to: 7 * DAY }, canConfirm: true });
    expect(later.values.find((entry) => entry.key === "noche-desde")?.changesWithin).toBeNull();
  });
});

describe("forma y viaje · `.agvproj` sección `valores`", () => {
  it("un evento guardado sin razón, con clave desconocida o con valor inválido se rechaza", () => {
    expect(plantValueEventProblem(event(1, "noche-desde", 20, 0))).toBeNull();
    expect(plantValueEventProblem({ ...event(1, "noche-desde", 20, 0), reason: "  " })).toMatch(/razón/);
    expect(plantValueEventProblem({ ...event(1, "noche-desde", 20, 0), key: "drift.minGapMs" })).toMatch(/clave/);
    expect(plantValueEventProblem({ ...event(1, "noche-desde", 30, 0) })).toMatch(/no vale/);
    expect(plantValueEventProblem({ ...event(1, "noche-desde", 20, 0), origin: "estimado" })).toMatch(/origen/);
  });

  it("solo entran eventos si el local es prefijo del entrante; si divergen, nada", () => {
    const a = event(1, "noche-desde", 20, 0);
    const b = event(2, "bloqueo-cabeza", 150_000, 0);
    expect(classifyPlantValueEvents([], [])).toEqual({ relation: "sin-valores", missing: [] });
    expect(classifyPlantValueEvents([a], [a, b])).toEqual({ relation: "entrante-adelantado", missing: [b] });
    expect(classifyPlantValueEvents([a, b], [a])).toEqual({ relation: "local-adelantado", missing: [] });
    expect(classifyPlantValueEvents([a, b], [b, a])).toEqual({ relation: "identico", missing: [] });
    expect(classifyPlantValueEvents([{ ...a, value: 21 }], [a, b])).toEqual({ relation: "distinto", missing: [] });
  });
});

describe("formatPlantValue · solo formato", () => {
  it("horas, lista de horas y duraciones en su unidad", () => {
    expect(formatPlantValue("hora", undefined, 5)).toBe("05:00");
    expect(formatPlantValue("horas", undefined, [22, 6, 14])).toBe("06:00, 14:00 y 22:00");
    expect(formatPlantValue("duracion", "min", 90_000)).toBe("1,5 min");
    expect(formatPlantValue("duracion", "s", 30_000)).toBe("30 s");
  });
});

describe("Worker · todo lo que analiza un fichero usa su configuración", () => {
  it("`buildViews` no lee `PROVISIONAL_CONFIG`: lo recibe resuelto por el contexto (`config`)", () => {
    // Sin eventos, `resolveAnalysisConfig` devuelve `PROVISIONAL_CONFIG` (probado arriba), así que el
    // análisis es idéntico al de antes; con eventos, ningún uso se queda con el provisional por descuido.
    const code = readFileSync(new URL("../../workers/import.worker.ts", import.meta.url), "utf8");
    const start = code.indexOf("async function buildViews(");
    const end = code.indexOf("async function runImport(");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = code.slice(start, end);
    expect(body).not.toMatch(/PROVISIONAL_CONFIG/);
    expect(body.match(/\bconfig\./g)?.length ?? 0).toBeGreaterThan(70);
    // Y el plano se lee con la misma configuración.
    const plan = code.slice(code.indexOf("function planViewsFrom("), code.indexOf("class PlanRefusal"));
    expect(plan).not.toMatch(/PROVISIONAL_CONFIG/);
  });
});
