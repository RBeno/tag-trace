/**
 * Alimentación de la línea (`src/domain/line-feed.ts`, R-FLO-010).
 *
 * Un anillo sintético de doce tags, con la entrada a la línea en «E» y el pulmón delante («Q»). Los
 * AGV dan vueltas seguidas; en dos momentos la línea para con AGV esperando en «Q», y en otro al
 * pulmón le falta un AGV porque uno se queda atrás. Lo que se fija: la cadencia sale de los pasos por
 * la entrada; el pulmón se mide donde esperan en las paradas; y cada parada se clasifica con AGV
 * esperando o sin ellos, con el hueco y quien retiene.
 */

import { describe, expect, it } from "vitest";

import type { Reading } from "../../src/domain/reading.js";
import { lineStopExclusion, lineStopsCsv, measureLineFeed, outsideLineStops } from "../../src/domain/line-feed.js";

const RING = ["A", "B", "C", "D", "F", "G", "H", "Q", "E", "L", "M", "Z"];
const STEP = 10_000; // 10 s entre tags: una vuelta de 120 s, con tres AGV repartidos
let row = 0;
const reading = (agvId: string, tagId: string, utcMs: number): Reading => ({
  time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" },
  agvId,
  tagId,
  provenance: { sourceId: "s", sourceHash: "s", sourceRow: ++row },
});

/**
 * Tres AGV repartidos por el anillo. `hold(t)` dice hasta cuándo retiene la entrada a quien llega a «Q» en t
 * (la línea parada), y `late` retrasa en «A» a un AGV y a los que van detrás, una sola vez (un hueco).
 */
interface Quirks {
  /** Nunca lee «E»: hace la parada, pero no lee el tag. */
  readonly blind?: string;
  /** Se queda tras «L» este tiempo, una vez, en esta vuelta. */
  readonly stay?: { readonly agv: string; readonly atLap: number; readonly ms: number };
  /** El primer AGV que entra desde este instante no hace la parada: el siguiente entra enseguida. */
  readonly noStopFrom?: number;
}

function simulate(
  stops: readonly [number, number][],
  late: { agvs: readonly string[]; atLap: number; ms: number; at?: string } | null,
  quirks: Quirks = {},
): Reading[] {
  const out: Reading[] = [];
  const agvs = ["1", "2", "3"];
  // Repartidos por el anillo: uno cada 40 s.
  const clock = new Map(agvs.map((agv, index) => [agv, index * 4 * STEP]));
  let entryFree = 0;
  let noStopUsed = false;
  for (let lap = 0; lap < 60; lap += 1) {
    for (const agv of agvs) {
      let t = clock.get(agv) as number;
      for (const tag of RING) {
        // En una guía no se adelanta: el retraso es del rezagado y de los que van detrás de él.
        if (tag === (late?.at ?? "A") && late !== null && late.agvs.includes(agv) && late.atLap === lap) t += late.ms;
        if (tag === "E") {
          t = Math.max(t, entryFree);
          for (const [from, to] of stops) if (t >= from && t < to) t = to;
          // La línea toma un AGV cada 40 s: tras una parada los suelta a su ritmo, no todos a la vez.
          const skips = quirks.noStopFrom !== undefined && !noStopUsed && t >= quirks.noStopFrom;
          if (skips) noStopUsed = true;
          entryFree = t + (skips ? STEP : 4 * STEP);
        }
        if (!(tag === "E" && quirks.blind === agv)) out.push(reading(agv, tag, t));
        t += STEP;
        if (tag === "L" && quirks.stay !== undefined && quirks.stay.agv === agv && quirks.stay.atLap === lap) t += quirks.stay.ms;
      }
      clock.set(agv, t);
    }
  }
  return out;
}

const regimeOf = () => "produccion" as const;
const thresholds = { minSamples: 5, minMarginMs: 1_000 };

describe("alimentación de la línea", () => {
  it("sin lista «linea» no se evalúa, y se dice", () => {
    const feed = measureLineFeed(simulate([], null), [], [], regimeOf, thresholds);
    expect(feed.evaluated).toBe(false);
    expect(feed.reason).toContain("lista «linea»");
  });

  it("la cadencia sale de la entrada, y las paradas con AGV esperando miden el pulmón", () => {
    const readings = simulate([[600_000, 900_000], [1_500_000, 1_800_000]], null);
    const feed = measureLineFeed(readings, ["E", "L"], [], regimeOf, thresholds);
    expect(feed.evaluated).toBe(true);
    expect(feed.cadence?.p50Ms).toBe(4 * STEP);
    expect(feed.stops).toHaveLength(2);
    expect(feed.stops.every((stop) => stop.kind === "con-pulmon")).toBe(true);
    expect(feed.zone?.tags.length).toBeGreaterThan(0);
    expect(feed.zone?.capacity).toBeGreaterThan(0);
    expect(feed.occupancy.reduce((sum, entry) => sum + entry.minutes, 0)).toBeGreaterThan(0);
  });

  it("un AGV que se queda atrás deja a la línea sin AGV: se dice el hueco y si retiene", () => {
    const readings = simulate([[600_000, 900_000], [1_500_000, 1_800_000]], { agvs: ["2", "3"], atLap: 40, ms: 60_000 });
    const feed = measureLineFeed(readings, ["E", "L"], [], regimeOf, thresholds, new Set(["2"]));
    const starved = feed.stops.filter((stop) => stop.kind === "sin-agv");
    expect(starved).toHaveLength(1);
    const [stop] = starved;
    expect(stop?.after).toBe("2");
    expect(stop?.afterIsHolder).toBe(true);
    expect(stop?.hole?.tagId).toBe("A");
    expect(stop?.evidence).toContain("le faltaron AGV");
    expect(stop?.evidence).toContain("el hueco se abrió en A");
    expect(lineStopsCsv(feed, String).split("\r\n")).toHaveLength(1 + feed.stops.length);
  });

  it("si el que entra después ya estaba en el pulmón, la línea tenía un AGV en la puerta", () => {
    // El mismo retraso, pero después de leer «Q»: el AGV está en el pulmón y no entra.
    const readings = simulate([[600_000, 900_000], [1_500_000, 1_800_000]], { agvs: ["2", "3"], atLap: 40, ms: 60_000, at: "E" });
    const feed = measureLineFeed(readings, ["E", "L"], [], regimeOf, thresholds);
    const stop = feed.stops.find((entry) => entry.after === "2" && entry.fromUtcMs > 1_800_000);
    expect(stop?.kind).toBe("con-pulmon");
    expect(stop?.evidence).toContain("un AGV en la puerta");
    expect(feed.stops.some((entry) => entry.kind === "sin-agv")).toBe(false);
  });

  it("cada paso por la línea: quién no lee un tag, quién no sigue y quién no hace la parada", () => {
    const readings = simulate([[600_000, 900_000], [1_500_000, 1_800_000]], null, {
      blind: "1",
      stay: { agv: "1", atLap: 30, ms: 300_000 },
      noStopFrom: 900_000,
    });
    const feed = measureLineFeed(readings, ["E", "L"], [], regimeOf, thresholds);
    const passages = feed.passages;
    expect(passages?.expected).toEqual(["E", "L"]);
    expect(passages?.readers.map((reader) => [reader.agvId, reader.tags])).toEqual([["1", ["E"]]]);
    const kinds = passages?.issues.map((issue) => [issue.kind, issue.agvId]);
    expect(kinds).toContainEqual(["no-sigue", "1"]);
    expect(passages?.issues.filter((issue) => issue.kind === "sin-parada")).toHaveLength(1);
    expect(passages?.issues.find((issue) => issue.kind === "no-sigue")?.evidence).toContain("pin del carro");
    expect(passages?.issues.find((issue) => issue.kind === "sin-parada")?.evidence).toContain("se fue con el carro");
  });

  it("en una línea de vinculación el AGV sigue en paralelo: no se busca si hizo la parada", () => {
    const readings = simulate([[600_000, 900_000], [1_500_000, 1_800_000]], null, { noStopFrom: 900_000 });
    const feed = measureLineFeed(readings, ["E", "L"], [], regimeOf, thresholds, new Set(), new Map([["E", "vinculacion"]]));
    expect(feed.passages?.parallel).toBe(true);
    expect(feed.passages?.issues.some((issue) => issue.kind === "sin-parada")).toBe(false);
  });

  it("el ciclo no es fijo: cada tiempo se mide contra su ciclo local, y la noche aparte", () => {
    // Tres AGV; la línea toma uno cada 40 s hasta el minuto 60 y cada 50 s después, y a partir del
    // minuto 90 es de noche, con un AGV cada 80 s.
    const out: Reading[] = [];
    let t = 0;
    let n = 0;
    while (t < 7_200_000) {
      const agv = String((n % 3) + 1);
      out.push(reading(agv, "Q", t - 10_000), reading(agv, "E", t), reading(agv, "L", t + 10_000));
      n += 1;
      t += t < 3_600_000 ? 40_000 : t < 5_400_000 ? 50_000 : 80_000;
      if (n === 30) t += 20_000; // una espera de 20 s de más
    }
    const night = (utcMs: number) => (utcMs >= 5_400_000 ? ("noche" as const) : ("produccion" as const));
    const feed = measureLineFeed(out, ["E", "L"], [], night, thresholds);
    const day = feed.rhythm.find((entry) => entry.regime === "produccion");
    const noche = feed.rhythm.find((entry) => entry.regime === "noche");
    expect(day?.cycleLowMs).toBe(40_000);
    expect(day?.cycleHighMs).toBe(50_000);
    expect(noche?.cycleMs).toBe(80_000);
    // Lo único de más es la espera de 20 s: el paso de 40 a 50 s no cuenta como línea sin paso.
    expect(day?.lostMs).toBe(20_000);
    expect(noche?.lostMs).toBe(0);
  });

  it("la cola del pulmón durante una parada con AGV esperando no mide ningún tramo; lo demás sí", () => {
    const readings = simulate([[600_000, 900_000], [1_500_000, 1_800_000]], null);
    const feed = measureLineFeed(readings, ["E", "L"], [], regimeOf, thresholds);
    const exclusion = lineStopExclusion(feed);
    expect(exclusion.intervals).toHaveLength(2);
    expect(exclusion.tags.has("Q")).toBe(true);
    const inQueue = { from: "Q", to: "E", fromTime: 700_000, toTime: 900_000 };
    const elsewhere = { from: "A", to: "B", fromTime: 700_000, toTime: 710_000 };
    const later = { from: "Q", to: "E", fromTime: 1_000_000, toTime: 1_010_000 };
    expect(outsideLineStops([inQueue, elsewhere, later], exclusion)).toEqual([elsewhere, later]);
  });
});
