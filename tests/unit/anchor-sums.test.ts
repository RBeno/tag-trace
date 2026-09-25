/**
 * Tags insertados y sustituidos, por la suma entre anclas (R-DAT-021).
 *
 * Lo que se fija, con un anillo de diez tags hecho a mano: tres tags seguidos cambiados a la vez
 * salen como tres sustituciones en su sitio, **incluido el del medio**; un tag nuevo que no cambia la
 * suma está en la línea, y uno que la alarga cambia el recorrido; un sustituido que se lee en otro
 * punto se dice; con pocas pasadas después la estructura sale y la suma no se mide; un tag que se lee
 * a medias en los dos lados no es un cambio; y las anclas son la subsecuencia común de los dos anillos.
 */

import { describe, expect, it } from "vitest";

import {
  anchorSequences,
  changedTags,
  compareAnchorGaps,
  stableAnchors,
  structureBoundaries,
  windowsAroundChanges,
  type AnchorSumContext,
} from "../../src/domain/anchor-sums.js";
import type { Reading } from "../../src/domain/reading.js";
import type { Regime } from "../../src/domain/segment-bands.js";

const SECOND = 1_000;
const RING = ["T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"];
/** Diez segundos por paso: una vuelta de 100 s. */
const BASE: readonly (readonly [string, number])[] = RING.map((tagId, index) => [tagId, index * 10]);

let row = 0;
function reading(agvId: string, tagId: string, utcMs: number): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

/**
 * Seis AGV, cada uno un segundo detrás del anterior, `laps` vueltas. `layout` da, para cada vuelta, los
 * tags que se leen y a cuántos segundos del principio de la vuelta. La vuelta dura lo que diga el
 * último tag más diez segundos.
 */
function run(laps: number, layout: (lap: number) => readonly (readonly [string, number])[]): Reading[] {
  const out: Reading[] = [];
  for (let vehicle = 0; vehicle < 6; vehicle += 1) {
    let start = vehicle * SECOND;
    for (let lap = 0; lap < laps; lap += 1) {
      const tags = layout(lap);
      for (const [tagId, seconds] of tags) out.push(reading(`V${vehicle}`, tagId, start + seconds * SECOND));
      start += ((tags[tags.length - 1]?.[1] ?? 0) + 10) * SECOND;
    }
  }
  return out;
}

const DAY = (): Regime => "produccion";

function context(readings: readonly Reading[]): AnchorSumContext {
  const times = readings.map((entry) => entry.time.utcMs);
  return {
    direction: "oldest-first",
    coverage: [{ from: Math.min(...times), to: Math.max(...times) }],
    laneTags: new Set(),
    productionStops: [],
    regimeOf: DAY,
    deliveries: [],
    maxChance: 0.001,
    resolutionMs: SECOND,
  };
}

/** Antes y después de la vuelta `cut`, como dos ficheros. */
function windows(readings: readonly Reading[], cut: number) {
  const lapMs = 100 * SECOND;
  return {
    before: { from: 0, to: cut * lapMs - 1 },
    after: { from: cut * lapMs + 6 * SECOND, to: Math.max(...readings.map((entry) => entry.time.utcMs)) },
  };
}

/** Sustituye, desde la vuelta `from`, los tags dados por otros, en el mismo segundo. */
const replaced = (from: number, map: Readonly<Record<string, string>>, layout = BASE) => (lap: number) =>
  lap < from ? layout : layout.map(([tagId, seconds]) => [map[tagId] ?? tagId, seconds] as const);

describe("la suma entre anclas (R-DAT-021)", () => {
  it("tres tags seguidos cambiados a la vez: tres sustituciones en su sitio, incluido el del medio", () => {
    const readings = run(40, replaced(20, { T3: "X3", T4: "X4", T5: "X5" }));
    const { before, after } = windows(readings, 20);
    const gaps = compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ fromAnchor: "T2", toAnchor: "T6", sum: "igual" });
    expect(gaps[0]?.changes).toEqual([
      { kind: "sustituido", oldTagId: "T3", newTagId: "X3", oldOffsetMs: 10 * SECOND, newOffsetMs: 10 * SECOND, placement: "mismo-sitio" },
      { kind: "sustituido", oldTagId: "T4", newTagId: "X4", oldOffsetMs: 20 * SECOND, newOffsetMs: 20 * SECOND, placement: "mismo-sitio" },
      { kind: "sustituido", oldTagId: "T5", newTagId: "X5", oldOffsetMs: 30 * SECOND, newOffsetMs: 30 * SECOND, placement: "mismo-sitio" },
    ]);
    expect(changedTags(gaps[0]!)).toEqual(["T3", "T4", "T5", "X3", "X4", "X5"]);
  });

  it("un tag nuevo entre dos que no cambia la suma: tag nuevo en la línea", () => {
    const withNew = [...BASE.slice(0, 8), ["N", 75] as const, ...BASE.slice(8)];
    const readings = run(40, (lap) => (lap < 20 ? BASE : withNew));
    const { before, after } = windows(readings, 20);
    const gaps = compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 });
    expect(gaps).toMatchObject([{ fromAnchor: "T7", toAnchor: "T8", sum: "igual", changes: [{ kind: "insertado", tagId: "N", offsetMs: 5 * SECOND }] }]);
  });

  it("el ejemplo del propietario: de 20 s a 26 s con un tag nuevo entre medias cambia el recorrido", () => {
    // T7 → T9 son 20 s; después hay un tag nuevo entre ellos y tardan 26 s.
    const early = BASE.filter(([tagId]) => tagId !== "T8");
    const late = [...early.slice(0, 8), ["N", 83] as const, ["T9", 96] as const];
    const readings = run(40, (lap) => (lap < 20 ? early : late));
    const { before, after } = windows(readings, 20);
    const gaps = compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 });
    expect(gaps).toMatchObject([
      { fromAnchor: "T7", toAnchor: "T9", sum: "mas-lento", before: { p50Ms: 20 * SECOND }, after: { p50Ms: 26 * SECOND }, changes: [{ kind: "insertado", tagId: "N" }] },
    ]);
  });

  it("un sustituido que se lee en otro punto, con la suma igual", () => {
    const moved = BASE.map(([tagId, seconds]) => (tagId === "T4" ? (["X4", seconds + 4] as const) : ([tagId, seconds] as const)));
    const readings = run(40, (lap) => (lap < 20 ? BASE : moved));
    const { before, after } = windows(readings, 20);
    const gaps = compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 });
    expect(gaps).toMatchObject([
      { fromAnchor: "T3", toAnchor: "T5", sum: "igual", changes: [{ kind: "sustituido", oldTagId: "T4", newTagId: "X4", placement: "otro-punto" }] },
    ]);
  });

  it("dos viejos y tres nuevos: dos sustituidos y el que sobra, insertado donde no hay nadie", () => {
    const late = [...BASE.slice(0, 3), ["X3", 30] as const, ["X4", 40] as const, ["Y", 47] as const, ...BASE.slice(5)];
    const readings = run(40, (lap) => (lap < 20 ? BASE : late));
    const { before, after } = windows(readings, 20);
    const gaps = compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 });
    expect(gaps[0]?.changes.map((change) => (change.kind === "sustituido" ? `${change.oldTagId}>${change.newTagId}` : `${change.kind}:${"tagId" in change ? change.tagId : ""}`))).toEqual([
      "T3>X3",
      "T4>X4",
      "insertado:Y",
    ]);
  });

  it("con tres pasadas después: la estructura sale y la suma queda sin medir", () => {
    const readings = run(23, replaced(20, { T3: "X3", T4: "X4", T5: "X5" })).filter(
      (entry) => entry.agvId === "V0" || entry.time.utcMs < 20 * 100 * SECOND,
    );
    const { before, after } = windows(readings, 20);
    const gaps = compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 });
    expect(gaps).toMatchObject([{ fromAnchor: "T2", toAnchor: "T6", sum: "sin-medir", after: { passes: 3 } }]);
    expect(gaps[0]?.changes).toHaveLength(3);
  });

  it("con el después de noche, la estructura sale igual y la suma se compara de noche o no se compara", () => {
    const readings = run(40, replaced(20, { T3: "X3", T4: "X4", T5: "X5" }));
    const { before, after } = windows(readings, 20);
    const nightAfter = { ...context(readings), regimeOf: (utcMs: number): Regime => (utcMs >= after.from ? "noche" : "produccion") };
    const [gap] = compareAnchorGaps(readings, before, after, nightAfter, { minAnchorPasses: 5 });
    expect(gap?.changes.map((change) => change.kind)).toEqual(["sustituido", "sustituido", "sustituido"]);
    expect(gap).toMatchObject({ regime: null, sum: "sin-medir" });

    const nightBoth = { ...context(readings), regimeOf: (): Regime => "noche" };
    expect(compareAnchorGaps(readings, before, after, nightBoth, { minAnchorPasses: 5 })[0]).toMatchObject({ regime: "noche", sum: "igual" });
  });

  it("un tag que se lee a medias en los dos lados no es un cambio de estructura", () => {
    let flip = 0;
    const half = () => BASE.filter(([tagId]) => tagId !== "T4" || (flip += 1) % 2 === 0);
    const readings = run(40, half);
    const { before, after } = windows(readings, 20);
    expect(compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 })).toEqual([]);
  });

  it("un tag que se lee de vez en cuando fuera del anillo no es un tag nuevo en la línea", () => {
    // Un tag de mantenimiento: después del corte, uno de cada doce pasos por T4 lo lee.
    let pass = 0;
    const readings = run(40, (lap) =>
      lap >= 20 && (pass += 1) % 12 === 0 ? [...BASE.slice(0, 5), ["M", 45] as const, ...BASE.slice(5)] : BASE,
    );
    const { before, after } = windows(readings, 20);
    expect(compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 })).toEqual([]);
  });

  it("sin cambios, nada", () => {
    const readings = run(40, () => BASE);
    const { before, after } = windows(readings, 20);
    expect(compareAnchorGaps(readings, before, after, context(readings), { minAnchorPasses: 5 })).toEqual([]);
  });
});

describe("dónde mirar dentro de un mismo fichero", () => {
  it("los bordes de lectura caen donde se cambió el bloque, aunque sus vecinos también cambiaran", () => {
    const readings = run(40, replaced(20, { T3: "X3", T4: "X4", T5: "X5" }));
    const times = readings.map((entry) => entry.time.utcMs);
    const span = { from: Math.min(...times), to: Math.max(...times) };
    const boundaries = structureBoundaries(anchorSequences(readings, "oldest-first", [span]), [span], 10 * 100 * SECOND);
    // Seis bordes (la última lectura de cada viejo, la primera de cada nuevo), todos en torno a la vuelta 20.
    expect(boundaries).toHaveLength(6);
    for (const at of boundaries) expect(Math.abs(at - 20 * 100 * SECOND)).toBeLessThan(100 * SECOND);
  });

  it("cada grupo se compara con lo que hay entre él y el grupo vecino, no con el resto del tramo", () => {
    const hour = 3_600_000;
    const windows = windowsAroundChanges([10 * hour, 10 * hour + 60_000, 20 * hour], [{ from: 0, to: 30 * hour }], hour);
    expect(windows).toEqual([
      { atUtcMs: 10 * hour + 60_000, before: { from: 0, to: 10 * hour }, after: { from: 10 * hour + 60_000, to: 20 * hour } },
      { atUtcMs: 20 * hour, before: { from: 10 * hour + 60_000, to: 20 * hour }, after: { from: 20 * hour, to: 30 * hour } },
    ]);
  });
});

describe("anclas estables", () => {
  it("la subsecuencia común más larga, en orden cíclico, aunque los anillos empiecen en otro sitio", () => {
    expect(stableAnchors(["A", "B", "C", "D", "E"], ["C", "X", "E", "A", "B"])).toEqual(["A", "B", "C", "E"]);
    expect(stableAnchors(["A", "B"], ["C", "D"])).toEqual([]);
  });
});
