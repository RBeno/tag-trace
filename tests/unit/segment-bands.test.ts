/**
 * La horquilla de tiempos de cada tramo, por régimen (R-FLO-007, R-TIM-009, R-TIM-010).
 *
 * Lo que se fija: la noche es la de la hora local y cruza la medianoche; la horquilla es el p50, p80
 * y p95 del propio tramo con su valla, y el ejemplo del propietario (el 80 % en 17 s, el resto hasta
 * 30 s) da una valla de 60 s; lo que pasa de noche no toca la horquilla de producción; sin muestras
 * suficientes no hay horquilla y se usa la suma de los tramos del anillo; las esperas de un semáforo
 * quedan dentro; y un tramo solo cambia entre periodos si su horquilla se mueve de verdad.
 */

import { describe, expect, it } from "vitest";

import type { Transition } from "../../src/domain/graph.js";
import {
  bandChangesBetweenPeriods,
  bandFor,
  bandsCsv,
  buildSegmentBands,
  compareBands,
  pairKey,
  regimeExposure,
  regimeReader,
  sourceResolutionMs,
  type Regime,
} from "../../src/domain/segment-bands.js";

const HOUR = 3_600_000;
const SECOND = 1_000;
const DAY_START = Date.UTC(2026, 8, 24, 8, 0); // 08:00 en UTC
const NIGHT = { nightFromHour: 22, nightToHour: 5 };
const DAY: (utcMs: number) => Regime = () => "produccion";

let row = 0;
function step(from: string, to: string, fromTime: number, durationMs: number): Transition {
  row += 1;
  return { agvId: `A${row % 7}`, from, to, fromTime, toTime: fromTime + durationMs, sameInstant: false };
}

/** `count` pasos de `from` a `to`, uno por minuto desde `start`, con las duraciones dadas en ciclo. */
function many(from: string, to: string, start: number, durations: readonly number[], count = durations.length): Transition[] {
  return Array.from({ length: count }, (_, index) => step(from, to, start + index * 60_000, durations[index % durations.length] as number));
}

describe("régimen", () => {
  it("la noche es la de la hora local y cruza la medianoche", () => {
    const utc = regimeReader("UTC", NIGHT);
    expect(utc(Date.UTC(2026, 8, 24, 23, 0))).toBe("noche");
    expect(utc(Date.UTC(2026, 8, 24, 4, 59))).toBe("noche");
    expect(utc(Date.UTC(2026, 8, 24, 5, 0))).toBe("produccion");
    expect(utc(Date.UTC(2026, 8, 24, 21, 59))).toBe("produccion");
    // 20:30 UTC son las 22:30 en Madrid en septiembre.
    expect(regimeReader("Europe/Madrid", NIGHT)(Date.UTC(2026, 8, 24, 20, 30))).toBe("noche");
  });

  it("el tiempo cubierto se reparte entre producción, noche y paradas de la producción", () => {
    const at = (hour: number, minute = 0) => Date.UTC(2026, 8, 24, hour, minute);
    const exposure = regimeExposure(
      [{ from: at(20), to: at(24) }],
      [{ from: at(20), to: at(20, 15) }],
      regimeReader("UTC", NIGHT),
    );
    expect(exposure).toEqual({ produccionMs: 1.75 * HOUR, nocheMs: 2 * HOUR, paradaMs: 0.25 * HOUR });
  });

  it("la resolución de la fuente es de un minuto si ningún intervalo baja del minuto", () => {
    expect(sourceResolutionMs([step("A", "B", 0, 60_000), step("A", "B", 0, 120_000)])).toBe(60_000);
    expect(sourceResolutionMs([step("A", "B", 0, 60_000), step("A", "B", 0, 17_000)])).toBe(1_000);
  });
});

describe("la horquilla de un tramo", () => {
  it("el ejemplo del propietario: el 80 % en 17 s y el resto hasta 30 s da una valla de 60 s", () => {
    const durations = [...Array.from({ length: 80 }, () => 17 * SECOND), ...Array.from({ length: 20 }, () => 30 * SECOND)];
    const bands = buildSegmentBands(many("A", "B", DAY_START, durations), ["A", "B"], DAY, { minBandSamples: 20 }, 30 * SECOND);
    const band = bands.pairs.get(pairKey("A", "B"))?.produccion;
    expect(band).toMatchObject({ samples: 100, p50Ms: 17 * SECOND, p95Ms: 30 * SECOND, fenceMs: 60 * SECOND });
    // 80 s se sale; 45 s no.
    expect(80 * SECOND > (band?.fenceMs ?? 0)).toBe(true);
    expect(45 * SECOND > (band?.fenceMs ?? 0)).toBe(false);
  });

  it("lo que pasa de noche no toca la horquilla de producción, y la de noche se mide aparte", () => {
    const day = many("A", "B", DAY_START, [16 * SECOND, 17 * SECOND, 18 * SECOND], 60);
    const night = many("A", "B", Date.UTC(2026, 8, 24, 23, 0), [60 * SECOND, 62 * SECOND], 40);
    const bands = buildSegmentBands([...day, ...night], ["A", "B"], regimeReader("UTC", NIGHT), { minBandSamples: 20 }, 30 * SECOND);
    const pair = bands.pairs.get(pairKey("A", "B"));
    expect(pair?.produccion?.p95Ms).toBe(18 * SECOND);
    expect(pair?.noche?.p50Ms).toBe(62 * SECOND);
  });

  it("sin muestras suficientes no hay horquilla, y un paso que salta un tag usa la suma de los tramos", () => {
    const bands = buildSegmentBands(
      [
        ...many("A", "B", DAY_START, [16 * SECOND], 30),
        ...many("B", "C", DAY_START, [20 * SECOND], 30),
        ...many("A", "C", DAY_START, [36 * SECOND], 19),
      ],
      ["A", "B", "C"],
      DAY,
      { minBandSamples: 20 },
      30 * SECOND,
    );
    expect(bands.pairs.get(pairKey("A", "C"))?.produccion).toBeNull();
    expect(bandFor(bands, "A", "C", "produccion")).toEqual({
      p50Ms: 36 * SECOND,
      p80Ms: 36 * SECOND,
      p95Ms: 36 * SECOND,
      fenceMs: 66 * SECOND,
      source: "anillo",
    });
    // Sin horquilla de noche, de noche no se mide.
    expect(bandFor(bands, "A", "B", "noche")).toBeNull();
  });

  it("reaparecer por detrás no se mide: media vuelta o más de «saltos» no es un paso por esos tramos", () => {
    // En un anillo de seis, de A a F (el tag anterior) serían cuatro saltados hacia delante: sumar esos
    // tramos daría una horquilla enorme que nunca sería parada y una razón de ritmo cercana a cero.
    const ring = ["A", "B", "C", "D", "E", "F"];
    const transitions = ring.flatMap((from, index) => many(from, ring[(index + 1) % ring.length] as string, DAY_START, [20 * SECOND], 30));
    const bands = buildSegmentBands(transitions, ring, DAY, { minBandSamples: 20 }, 30 * SECOND);
    expect(bandFor(bands, "A", "F", "produccion")).toBeNull();
    expect(bandFor(bands, "A", "E", "produccion")).toBeNull();
    // Dos saltados (menos de media vuelta) sí se suman.
    expect(bandFor(bands, "A", "D", "produccion")?.p50Ms).toBe(60 * SECOND);
  });

  it("las esperas de un semáforo, una de cada tres, quedan dentro de la horquilla", () => {
    const bands = buildSegmentBands(
      many("S", "T", DAY_START, [16 * SECOND, 17 * SECOND, 106 * SECOND], 60),
      ["S", "T"],
      DAY,
      { minBandSamples: 20 },
      30 * SECOND,
    );
    const band = bands.pairs.get(pairKey("S", "T"))?.produccion;
    expect(band?.p95Ms).toBe(106 * SECOND);
    expect(106 * SECOND > (band?.fenceMs ?? 0)).toBe(false);
  });
});

describe("la horquilla entre dos periodos (R-TIM-010)", () => {
  const ring = ["A", "B", "C", "D"];
  const build = (durations: Record<string, number>, start: number) =>
    Object.entries(durations).flatMap(([pair, ms]) => {
      const [from, to] = pair.split("") as [string, string];
      return many(from, to, start, [ms - SECOND, ms, ms + SECOND], 30);
    });

  it("más lento, más rápido o igual, siempre dentro del mismo régimen", () => {
    const early = buildSegmentBands(build({ AB: 16_000, BC: 30_000, CD: 20_000 }, DAY_START), ring, DAY, { minBandSamples: 20 }, 30 * SECOND);
    const late = buildSegmentBands(build({ AB: 30_000, BC: 16_000, CD: 20_500 }, DAY_START), ring, DAY, { minBandSamples: 20 }, 30 * SECOND);
    const changes = compareBands(early, late);
    expect(changes.map((change) => `${change.from}${change.to} ${change.kind}`).sort()).toEqual(["AB mas-lento", "BC mas-rapido"]);
  });

  it("con dos tramos de cobertura separados se comparan el primero y el último; con uno solo, no", () => {
    const second = DAY_START + 7 * 24 * HOUR;
    const transitions = [...build({ AB: 16_000 }, DAY_START), ...build({ AB: 40_000 }, second)];
    const coverage = [
      { from: DAY_START, to: DAY_START + 2 * HOUR },
      { from: second, to: second + 2 * HOUR },
    ];
    const result = bandChangesBetweenPeriods(transitions, coverage, ring, DAY, { minBandSamples: 20 }, 30 * SECOND, 30 * 60_000);
    expect(result?.changes).toMatchObject([{ from: "A", to: "B", kind: "mas-lento" }]);
    expect(bandChangesBetweenPeriods(transitions, [coverage[0] as { from: number; to: number }], ring, DAY, { minBandSamples: 20 }, 30 * SECOND, 30 * 60_000)).toBeNull();
  });
});

describe("la horquilla en CSV", () => {
  it("una fila por tramo y régimen, con `;` y coma decimal; sin horquilla, sin fila", () => {
    const band = { samples: 30, p50Ms: 16_500, p80Ms: 19_000, p95Ms: 20_000, fenceMs: 50_000 };
    const csv = bandsCsv([
      { from: "A", to: "B", produccion: band, noche: { ...band, p50Ms: 60_000 } },
      { from: "B", to: "C", produccion: null, noche: null },
    ]);
    expect(csv.split("\r\n")).toEqual([
      "desde;hasta;regimen;muestras;p50_s;p80_s;p95_s;valla_s",
      "A;B;produccion;30;16,5;19,0;20,0;50,0",
      "A;B;noche;30;60,0;19,0;20,0;50,0",
    ]);
  });
});
