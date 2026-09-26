/**
 * Tiempos por sección entre anclas (R-TIM-012).
 *
 * Lo que importa comprobar: todas las anclas del anillo cortan secciones consecutivas en el orden del
 * anillo, no en el de la lista; cada paso va de la primera lectura de un ancla a la primera de la
 * siguiente; un hueco de cobertura, una parada de la producción o una entrada a calle en medio lo
 * descartan; el nombre sale de la lista `tramo` solo con mayoría; y con una sola ancla no hay
 * secciones, porque una sola es la vuelta entera.
 */

import { describe, expect, it } from "vitest";

import {
  anchorSectionsCsv,
  anchorsOnRing,
  measureAnchorSections,
  sectionName,
  sectionPasses,
  type AnchorSectionsInput,
} from "../../src/domain/anchor-sections.js";
import type { Reading } from "../../src/domain/reading.js";
import type { Regime } from "../../src/domain/segment-bands.js";

const ZONE = "Europe/Madrid";
const SECOND = 1_000;
/** Anillo sintético de 12 tags con anclas en las posiciones 0, 4 y 8. */
const RING = Array.from({ length: 12 }, (_, index) => `T${String(index).padStart(2, "0")}`);
const ANCHORS = ["T00", "T04", "T08"];
const DAY: (utcMs: number) => Regime = () => "produccion";
const THRESHOLDS = { minBandSamples: 3 };
const MARGIN = 30 * SECOND;

let row = 0;
function reading(utcMs: number, agvId: string, tagId: string): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

/**
 * `count` vueltas de un AGV por el anillo desde `start`, con un tiempo por tramo distinto en cada
 * sección: `perSection[k]` segundos entre dos tags consecutivos de la sección k (T00→T04, T04→T08,
 * T08→T00). Cuatro tramos por sección, así que la sección k dura 4 · perSection[k].
 */
function laps(agvId: string, count: number, start: number, perSection: readonly [number, number, number]): Reading[] {
  const out: Reading[] = [];
  let t = start;
  for (let lap = 0; lap < count; lap += 1) {
    for (const [index, tag] of RING.entries()) {
      out.push(reading(t, agvId, tag));
      t += (perSection[Math.floor(index / 4)] as number) * SECOND;
    }
  }
  // La lectura final del ancla cierra la última sección.
  out.push(reading(t, agvId, "T00"));
  return out;
}

function input(readings: readonly Reading[], overrides: Partial<AnchorSectionsInput> = {}): AnchorSectionsInput {
  return {
    readings,
    direction: "oldest-first",
    ring: RING,
    anchors: ANCHORS,
    coverage: [{ from: 0, to: 10 * 3_600_000 }],
    productionStops: [],
    laneTags: new Set(),
    regimeOf: DAY,
    sectionOf: new Map(),
    windows: [{ sourceId: "f1", window: { from: 0, to: 10 * 3_600_000 } }],
    ...overrides,
  };
}

describe("anclas como fronteras", () => {
  it("las anclas del anillo se ordenan por su posición en el anillo, no por el orden de la lista", () => {
    // La lista trae T08 primero (es el ancla de vuelta): las secciones se cortan igual, por el anillo.
    expect(anchorsOnRing(RING, ["T08", "T00", "T04", "T99"])).toEqual(["T00", "T04", "T08"]);
  });

  it("con una sola ancla no hay secciones: una sola es la vuelta entera, que ya existe", () => {
    const report = measureAnchorSections(input(laps("A", 4, 0, [10, 20, 30]), { anchors: ["T00"] }), THRESHOLDS, MARGIN);
    expect(report.onRing).toEqual(["T00"]);
    expect(report.sections).toEqual([]);
  });
});

describe("medida por sección", () => {
  it("dos AGV y varias vueltas dan tres secciones con el p50 del tiempo entre un ancla y la siguiente", () => {
    // A tarda 40, 80 y 120 s por sección; B, 40, 80 y 120 también pero desplazado: p50 sin ambigüedad.
    const readings = [...laps("A", 4, 0, [10, 20, 30]), ...laps("B", 4, 5 * SECOND, [10, 20, 30])];
    const report = measureAnchorSections(input(readings), THRESHOLDS, MARGIN);

    expect(report.sections.map((section) => [section.fromTagId, section.toTagId])).toEqual([
      ["T00", "T04"],
      ["T04", "T08"],
      ["T08", "T00"],
    ]);
    expect(report.sections.map((section) => section.produccion?.samples)).toEqual([8, 8, 8]);
    expect(report.sections.map((section) => section.produccion?.p50Ms)).toEqual([40 * SECOND, 80 * SECOND, 120 * SECOND]);
    // Los tags que abarca: el ancla de salida y los del anillo hasta la de llegada, sin incluirla.
    expect(report.sections[0]?.tags).toEqual(["T00", "T01", "T02", "T03"]);
    expect(report.sections[2]?.tags).toEqual(["T08", "T09", "T10", "T11"]);
    // Sin lista `tramo`, el nombre es «Ai → Ai+1».
    expect(report.sections[0]?.name).toBe("T00 → T04");
    expect(report.sections[0]?.namedByList).toBe(false);
    // La valla sigue el criterio de las horquillas: p95 + max(p95 − p50, margen).
    const band = report.sections[0]?.produccion;
    expect(band?.fenceMs).toBe((band?.p95Ms ?? 0) + Math.max((band?.p95Ms ?? 0) - (band?.p50Ms ?? 0), MARGIN));
  });

  it("el p50 por fichero sale solo de los pasos de esa ventana, y no se afirma con menos del mínimo", () => {
    const readings = [...laps("A", 4, 0, [10, 20, 30]), ...laps("B", 4, 5 * SECOND, [10, 20, 30])];
    const total = 4 * 4 * 60 * SECOND; // cuatro vueltas de 240 s
    const report = measureAnchorSections(
      input(readings, {
        windows: [
          { sourceId: "f1", window: { from: 0, to: total / 2 } },
          { sourceId: "f2", window: { from: total / 2, to: total + 60 * SECOND } },
        ],
      }),
      { minBandSamples: 5 },
      MARGIN,
    );
    const first = report.sections[0]?.bySource;
    expect(first?.map((entry) => entry.sourceId)).toEqual(["f1", "f2"]);
    // Cada AGV hace unas dos vueltas por ventana: cuatro pasos, por debajo del mínimo de cinco.
    expect(first?.every((entry) => entry.samples > 0 && entry.samples < 5)).toBe(true);
    expect(first?.every((entry) => entry.p50Ms === null)).toBe(true);
  });

  it("un paso que cruza un hueco de cobertura se descarta, y la llegada al ancla abre el siguiente", () => {
    // La lectura de T04 de la primera vuelta cae en la segunda ventana: T00→T04 cruza el hueco.
    const readings = laps("A", 2, 0, [10, 20, 30]);
    const passes = sectionPasses(
      readings,
      "oldest-first",
      ANCHORS,
      [
        { from: 0, to: 35 * SECOND },
        { from: 40 * SECOND, to: 3_600_000 },
      ],
      [],
      new Set(),
    );
    // Dos vueltas dan dos pasos por sección; el primero de T00→T04 cruza el hueco y se pierde.
    expect(passes[0]).toHaveLength(1);
    expect(passes[1]).toHaveLength(2);
    expect(passes[2]).toHaveLength(2);
  });

  it("un paso que cruza una parada de la producción se descarta", () => {
    const readings = laps("A", 2, 0, [10, 20, 30]);
    // La parada cae dentro del primer T04→T08 (de 40 s a 120 s).
    const passes = sectionPasses(readings, "oldest-first", ANCHORS, [], [{ from: 60 * SECOND, to: 70 * SECOND }], new Set());
    expect(passes[0]).toHaveLength(2);
    expect(passes[1]).toHaveLength(1);
    expect(passes[2]).toHaveLength(2);
  });

  it("una entrada a calle de carga en medio descarta el paso: una carga no es tiempo de sección", () => {
    const readings = laps("A", 1, 0, [10, 20, 30]);
    // Entre T05 (60 s) y T06 (80 s) el AGV lee un tag de la calle CO1.
    readings.splice(6, 0, reading(70 * SECOND, "A", "CO1-ENTRADA"));
    const passes = sectionPasses(readings, "oldest-first", ANCHORS, [], [], new Set(["CO1-ENTRADA"]));
    expect(passes[0]).toHaveLength(1);
    expect(passes[1]).toHaveLength(0);
    expect(passes[2]).toHaveLength(1);
  });

  it("las relecturas seguidas del ancla se colapsan a la primera, en la salida y en la llegada", () => {
    // El AGV relee T00 al arrancar (0 y 3 s) y T04 al llegar (40 y 47 s): el paso es 0→40, no 3→47.
    const readings = [
      reading(0, "A", "T00"),
      reading(3 * SECOND, "A", "T00"),
      reading(10 * SECOND, "A", "T01"),
      reading(20 * SECOND, "A", "T02"),
      reading(30 * SECOND, "A", "T03"),
      reading(40 * SECOND, "A", "T04"),
      reading(47 * SECOND, "A", "T04"),
    ];
    const passes = sectionPasses(readings, "oldest-first", ANCHORS, [], [], new Set());
    expect(passes[0]).toEqual([{ agvId: "A", fromTime: 0, toTime: 40 * SECOND }]);
  });

  it("el mismo ancla tras otros tags no es relectura: es una vuelta que no leyó la siguiente, y se descarta", () => {
    // T00, T01, T02, y otra vez T00 (no leyó T04 ni T08): el paso abierto se pierde y el nuevo cierra en T04.
    const readings = [
      reading(0, "A", "T00"),
      reading(10 * SECOND, "A", "T01"),
      reading(20 * SECOND, "A", "T02"),
      reading(300 * SECOND, "A", "T00"),
      reading(340 * SECOND, "A", "T04"),
    ];
    const passes = sectionPasses(readings, "oldest-first", ANCHORS, [], [], new Set());
    expect(passes[0]).toEqual([{ agvId: "A", fromTime: 300 * SECOND, toTime: 340 * SECOND }]);
  });

  it("saltar un ancla descarta el paso abierto: sin otra ancla en medio", () => {
    // De T00 se pasa a T08 sin leer T04: ni T00→T04 ni T04→T08 se miden; T08→T00 sí.
    const readings = [reading(0, "A", "T00"), reading(80 * SECOND, "A", "T08"), reading(200 * SECOND, "A", "T00")];
    const passes = sectionPasses(readings, "oldest-first", ANCHORS, [], [], new Set());
    expect(passes[0]).toHaveLength(0);
    expect(passes[1]).toHaveLength(0);
    expect(passes[2]).toEqual([{ agvId: "A", fromTime: 80 * SECOND, toTime: 200 * SECOND }]);
  });
});

describe("nombre de la sección", () => {
  it("toma el nombre de la lista `tramo` cuando más de la mitad de sus tags están en ese tramo", () => {
    const sectionOf = new Map([
      ["T00", "kitting"],
      ["T01", "kitting"],
      ["T02", "kitting"],
      ["T09", "línea"],
    ]);
    expect(sectionName(["T00", "T01", "T02", "T03"], "T04", sectionOf)).toEqual({ name: "kitting", namedByList: true });
    // Uno de cuatro no es mayoría: se queda con «Ai → Ai+1».
    expect(sectionName(["T08", "T09", "T10", "T11"], "T00", sectionOf)).toEqual({ name: "T08 → T00", namedByList: false });
  });

  it("la mitad justa no es mayoría: dos tramos a partes iguales no eligen ninguno", () => {
    const sectionOf = new Map([
      ["T04", "cruce"],
      ["T05", "cruce"],
      ["T06", "línea"],
      ["T07", "línea"],
    ]);
    expect(sectionName(["T04", "T05", "T06", "T07"], "T08", sectionOf).namedByList).toBe(false);
  });

  it("en el informe completo, el nombre de la lista acompaña a la sección y sale en el CSV", () => {
    const sectionOf = new Map(["T04", "T05", "T06"].map((tagId) => [tagId, "línea"]));
    const report = measureAnchorSections(input(laps("A", 4, 0, [10, 20, 30]), { sectionOf }), THRESHOLDS, MARGIN);
    expect(report.sections.map((section) => section.name)).toEqual(["T00 → T04", "línea", "T08 → T00"]);
    const csv = anchorSectionsCsv(report.sections);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("seccion;desde;hasta;tags;regimen_o_fichero;muestras;p50_s;p80_s;p95_s;valla_s");
    // La fila de producción de «línea» y su fila por fichero, con coma decimal.
    expect(lines.some((line) => line.startsWith("línea;T04;T08;T04 T05 T06 T07;produccion;4;80,0;"))).toBe(true);
    expect(lines.some((line) => line.startsWith("línea;T04;T08;T04 T05 T06 T07;f1;4;80,0;;;"))).toBe(true);
  });
});
