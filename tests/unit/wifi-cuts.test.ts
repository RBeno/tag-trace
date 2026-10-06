/**
 * Cortes wifi y mapa de calor (R-COM-004 a R-COM-008, TC-321 a TC-324).
 *
 * Un anillo sintético de 20 tags y cuatro AGV que dan vueltas a un tag cada 10 s. Sobre él se plantan
 * una a una las clases de corte y las causas de hueco, cada una con su caso que **no** debe salir.
 */

import { describe, expect, it } from "vitest";
import type { Reading } from "../../src/domain/reading.js";
import { buildWifiHeatmap, type ConnectionEvent, type WifiCutThresholds } from "../../src/domain/wifi-cuts.js";

const RING = Array.from({ length: 20 }, (_, index) => `T${String(index + 1).padStart(2, "0")}`);
const STEP = 10_000;
const T0 = Date.UTC(2026, 9, 5, 6, 0, 0);

const THRESHOLDS: WifiCutThresholds = {
  microCutMaxMs: 10_000,
  farReappearanceHops: 10,
  maxSkippedTags: 3,
  minPassesForRate: 5,
  minVehiclesForTagFault: 2,
  maxPaceFactor: 3,
};

let row = 1;
function reading(agvId: string, tagId: string, utcMs: number): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "h", sourceRow: row },
  };
}

interface Lap {
  /** Tags que no se leen en esa vuelta. */
  readonly skip?: readonly string[];
  /** Espera tras leer un tag, en ms. */
  readonly waitAfter?: Readonly<Record<string, number>>;
}

/** Un AGV que da `laps` vueltas desde `startMs`, con huecos y esperas plantados por vuelta. */
function drive(agvId: string, startMs: number, laps: number, plan: Readonly<Record<number, Lap>> = {}): { readings: Reading[]; endMs: number } {
  const readings: Reading[] = [];
  let at = startMs;
  for (let lap = 0; lap < laps; lap += 1) {
    for (const tag of RING) {
      at += STEP;
      if (!(plan[lap]?.skip ?? []).includes(tag)) readings.push(reading(agvId, tag, at));
      at += plan[lap]?.waitAfter?.[tag] ?? 0;
    }
  }
  return { readings, endMs: at };
}

function cut(fromMs: number, toMs: number | null, reconnect: ConnectionEvent["kind"] = "conexion"): ConnectionEvent[] {
  const events: ConnectionEvent[] = [{ utcMs: fromMs, raw: "", kind: "desconexion", aux: "", sourceRow: 0 }];
  if (toMs !== null) events.push({ utcMs: toMs, raw: "", kind: reconnect, aux: "", sourceRow: 0 });
  return events;
}

/** Instante de la lectura de `tag` en la vuelta `lap` de un AGV sin esperas que arranca en `startMs`. */
function at(startMs: number, lap: number, tag: string): number {
  return startMs + (lap * RING.length + RING.indexOf(tag) + 1) * STEP;
}

describe("cortes wifi: clases (R-COM-007)", () => {
  // A1 da 12 vueltas sin esperas: los instantes se calculan con `at`.
  const a1 = drive("A1", T0, 12);
  const others = [drive("A2", T0 + 3_000, 12), drive("A3", T0 + 6_000, 12)];
  const readings = [...a1.readings, ...others.flatMap((entry) => entry.readings)];

  function classOf(events: ConnectionEvent[], preciseStops: ReadonlySet<string> = new Set()) {
    const heat = buildWifiHeatmap({ readings, connections: new Map([["A1", events]]), preciseStops, thresholds: THRESHOLDS });
    return heat.cuts.map((entry) => entry.cutClass);
  }

  it("un corte de 5 s en marcha es microcorte", () => {
    const start = at(T0, 2, "T04") + 2_000;
    expect(classOf(cut(start, start + 5_000))).toEqual(["microcorte"]);
  });

  it("si lee durante el corte, está en marcha: los tags se ejecutaron (R-COM-004)", () => {
    const start = at(T0, 2, "T04") + 2_000;
    expect(classOf(cut(start, start + 60_000))).toEqual(["en-marcha"]);
  });

  it("«tras apagado» es apagado aunque dure poco", () => {
    const start = at(T0, 2, "T04") + 2_000;
    expect(classOf(cut(start, start + 3_000, "conexion-tras-apagado"))).toEqual(["apagado"]);
  });

  it("sin reconexión en el informe es sin cierre", () => {
    expect(classOf(cut(at(T0, 11, "T19") + 1_000, null))).toEqual(["sin-cierre"]);
  });
});

describe("cortes wifi: parado, espera al servidor y fuera del recorrido (R-COM-005, OQ-160)", () => {
  const plan = {
    3: { waitAfter: { T05: 120_000, T10: 120_000 } },
    // Sale del recorrido tras T12 y reaparece en T03 de la vuelta siguiente: 11 saltos y 30 min.
    5: { waitAfter: { T12: 30 * 60_000 }, skip: ["T13", "T14", "T15", "T16", "T17", "T18", "T19", "T20"] },
    6: { skip: ["T01", "T02"] },
  };
  const a1 = drive("A1", T0, 10, plan);
  // Los de detrás esperan en la misma guía (hacen cola): nadie adelanta a un AGV parado en ella. En la
  // vuelta 5 no: A1 sale del recorrido y ellos siguen.
  const queue = { 3: plan[3] };
  const others = [drive("A2", T0 + 3_000, 10, queue), drive("A3", T0 + 6_000, 10, queue)];
  const readings = [...a1.readings, ...others.flatMap((entry) => entry.readings)];
  const readAt = (tag: string, lap: number): number => {
    const own = a1.readings.filter((entry) => entry.tagId === tag);
    // La vuelta 5 pierde 8 tags y la 6 dos: se busca por orden de aparición, no por posición.
    return (own[lap] as Reading).time.utcMs;
  };

  it("parado en una parada precisa declarada, sin wifi, espera al servidor", () => {
    const start = readAt("T05", 3) + 5_000;
    const heat = buildWifiHeatmap({
      readings,
      connections: new Map([["A1", cut(start, start + 100_000)]]),
      preciseStops: new Set(["T05"]),
      thresholds: THRESHOLDS,
    });
    expect(heat.cuts[0]?.cutClass).toBe("espera-servidor");
    expect(heat.cuts[0]?.lastTagId).toBe("T05");
    expect(heat.cuts[0]?.evidence).toMatch(/cruce/);
  });

  it("el mismo corte sin parada precisa declarada es «parado» y lo dice", () => {
    const start = readAt("T05", 3) + 5_000;
    const heat = buildWifiHeatmap({
      readings,
      connections: new Map([["A1", cut(start, start + 100_000)]]),
      preciseStops: new Set(),
      thresholds: THRESHOLDS,
    });
    expect(heat.cuts[0]?.cutClass).toBe("parado");
    expect(heat.warnings.join(" ")).toMatch(/paradas precisas/);
  });

  it("parado en un tag que no es parada precisa no se toma por espera al servidor", () => {
    const start = readAt("T10", 3) + 5_000;
    const heat = buildWifiHeatmap({
      readings,
      connections: new Map([["A1", cut(start, start + 100_000)]]),
      preciseStops: new Set(["T05"]),
      thresholds: THRESHOLDS,
    });
    expect(heat.cuts[0]?.cutClass).toBe("parado");
  });

  it("si otro AGV lo adelanta durante el corte, no ocupaba la guía: fuera del recorrido, no parado", () => {
    // El mismo parado en T05, pero A2 no hace cola: pasa por T05 y llega a T06 antes que él.
    const free = [...a1.readings, ...drive("A2", T0 + 3_000, 10).readings, ...others[1]!.readings];
    const start = readAt("T05", 3) + 5_000;
    const heat = buildWifiHeatmap({
      readings: free,
      connections: new Map([["A1", cut(start, start + 100_000)]]),
      preciseStops: new Set(["T05"]),
      thresholds: THRESHOLDS,
    });
    expect(heat.cuts[0]?.cutClass).toBe("fuera-del-recorrido");
    expect(heat.cuts[0]?.overtakenBy).toEqual(["A2"]);
  });

  it("leer durante el corte mucho más lento que la ruta no es ir en marcha", () => {
    // Corte que abarca T10 (espera de 120 s) y la lectura de T11: leyó, pero a paso de parado.
    const start = readAt("T10", 3) + 5_000;
    const heat = buildWifiHeatmap({
      readings,
      connections: new Map([["A1", cut(start, readAt("T11", 3) + 2_000)]]),
      preciseStops: new Set(),
      thresholds: THRESHOLDS,
    });
    expect(heat.cuts[0]?.readsDuring).toBe(1);
    expect(heat.cuts[0]?.cutClass).toBe("parado");
  });

  it("un corte largo que reaparece a más de 10 tags es salir del recorrido, no una espera", () => {
    const start = readAt("T12", 5) + 5_000;
    const heat = buildWifiHeatmap({
      readings,
      connections: new Map([["A1", cut(start, start + 29 * 60_000)]]),
      preciseStops: new Set(["T12"]),
      thresholds: THRESHOLDS,
    });
    expect(heat.cuts[0]?.cutClass).toBe("fuera-del-recorrido");
    expect(heat.cuts[0]?.nextTagId).toBe("T03");
  });
});

describe("huecos de lectura: comunicación, lectura o tag (R-COM-008)", () => {
  // A1 se salta T15 en la vuelta 4, dentro de un corte: comunicación.
  // A2 se salta T07 en la vuelta 2, sin corte, y nadie más: lectura.
  // A2 y A3 se saltan T17 sin corte: tag.
  // A4 no tiene informe y se salta T09: sin informe.
  const a1 = drive("A1", T0, 8, { 4: { skip: ["T15"] } });
  const a2 = drive("A2", T0 + 2_000, 8, { 2: { skip: ["T07"] }, 3: { skip: ["T17"] } });
  const a3 = drive("A3", T0 + 4_000, 8, { 5: { skip: ["T17"] } });
  const a4 = drive("A4", T0 + 6_000, 8, { 1: { skip: ["T09"] } });
  const readings = [a1, a2, a3, a4].flatMap((entry) => entry.readings);
  const cutStart = at(T0, 4, "T14") + 2_000;
  const connections = new Map<string, ConnectionEvent[]>([
    ["A1", cut(cutStart, cutStart + 15_000)],
    // A2 y A3 tienen informe sin ningún corte en el periodo: un evento de conexión al principio y al final.
    ["A2", [{ utcMs: T0, raw: "", kind: "conexion", aux: "", sourceRow: 0 }, { utcMs: a2.endMs, raw: "", kind: "conexion", aux: "", sourceRow: 0 }]],
    ["A3", [{ utcMs: T0, raw: "", kind: "conexion", aux: "", sourceRow: 0 }, { utcMs: a3.endMs, raw: "", kind: "conexion", aux: "", sourceRow: 0 }]],
  ]);
  const heat = buildWifiHeatmap({ readings, connections, preciseStops: new Set(), thresholds: THRESHOLDS });
  const causeOf = (agvId: string, tagId: string) =>
    heat.skips.filter((skip) => skip.agvId === agvId && skip.tagId === tagId).map((skip) => skip.cause);

  it("el hueco dentro de un corte es comunicación, no lectura", () => {
    expect(causeOf("A1", "T15")).toEqual(["comunicacion"]);
  });

  it("el hueco de un solo AGV sin corte apunta a su lector", () => {
    expect(causeOf("A2", "T07")).toEqual(["lectura"]);
  });

  it("el mismo tag saltado sin corte por dos AGV apunta al tag", () => {
    expect(causeOf("A2", "T17")).toEqual(["tag"]);
    expect(causeOf("A3", "T17")).toEqual(["tag"]);
  });

  it("un AGV sin informe de conexiones no se separa", () => {
    expect(causeOf("A4", "T09")).toEqual(["sin-informe"]);
  });

  it("no inventa huecos donde todos leen", () => {
    expect(heat.skips).toHaveLength(5);
  });

  it("el mapa pone el corte en el último tag leído y en el orden de la ruta", () => {
    const row = heat.rows.find((entry) => entry.tagId === "T14");
    expect(row?.cuts).toBe(1);
    expect(row?.cutsByAgv.get("A1")).toBe(1);
    // Pasadas de los AGV con informe dentro de su periodo: 8 de A2, 8 de A3 y la de A1 que abre su corte.
    expect(row?.cutsPer100).toBeCloseTo(100 / 17);
    const positions = heat.rows.map((entry) => entry.position);
    expect(positions).toEqual([...positions].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("dos lecturas en el mismo instante no cuentan como hueco: el reloj no las ordena", () => {
    const same = [reading("A5", "T01", T0), reading("A5", "T04", T0)];
    const heatSame = buildWifiHeatmap({
      readings: [...readings, ...same],
      connections,
      preciseStops: new Set(),
      thresholds: THRESHOLDS,
    });
    expect(heatSame.skips.filter((skip) => skip.agvId === "A5")).toHaveLength(0);
  });

  it("es determinista", () => {
    const again = buildWifiHeatmap({ readings: [...readings].reverse(), connections, preciseStops: new Set(), thresholds: THRESHOLDS });
    expect(again.skips).toEqual(heat.skips);
    expect(again.cuts).toEqual(heat.cuts);
  });
});
