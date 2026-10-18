/**
 * Equivalencia de las reescrituras de rendimiento (B-09, revisión del 2026-10-18).
 *
 * Cinco cálculos eran cuadráticos —«para cada uno, todos los demás»— sobre cortes, pasadas,
 * estancias, ráfagas y tramos por franja: `markCollective` y el contraste con las ráfagas de
 * `summarizeConnections` (`connection-cuts.ts`), `findOvertakes` (`fifo.ts`), `seniorityBreaches`
 * (`charging.ts`) y el `find` por par y franja de `segmentHistories` (`franjas.ts`). Se reescribieron
 * con ventana deslizante, búsqueda binaria e índices, **sin cambiar ningún resultado**.
 *
 * Lo que se fija aquí es justo eso: la versión anterior de cada uno, copiada tal cual estaba en
 * 3.89.0, y la nueva dan exactamente la misma salida —mismo orden incluido— sobre cientos de casos
 * sintéticos generados con semilla fija. Los generadores fuerzan lo que rompe una ventana mal hecha:
 * empates de instante, solapes, listas vacías, un solo elemento, márgenes cero o negativos, cortes
 * abiertos y fracciones que no caen en milisegundos enteros.
 */

import { describe, expect, it } from "vitest";

import {
  markCollective,
  summarizeConnections,
  type ConnectionCut,
  type ConnectionCutThresholds,
  type CutEnd,
} from "../../src/domain/connection-cuts.js";
import type { ConnectionEvent } from "../../src/domain/connection-log.js";
import { findOvertakes, type FifoOvertake, type FifoThresholds } from "../../src/domain/fifo.js";
import { seniorityBreaches, type LaneStay, type LaneStayState, type SeniorityBreach } from "../../src/domain/charging.js";
import { classifyHistory, segmentHistories, type SegmentHistory, type SegmentHistoryPoint } from "../../src/domain/franjas.js";
import type { GroupedDelivery } from "../../src/domain/grouped-delivery.js";
import { minKeyScanner } from "../../src/domain/graph.js";
import { pairKey, REGIMES, type Band } from "../../src/domain/segment-bands.js";

/** Generador pseudoaleatorio con semilla (mulberry32): mismos casos en cada ejecución. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(random: () => number, options: readonly T[]): T => options[Math.floor(random() * options.length)] as T;
/** Tamaño de lista: vacía, un elemento o varios, con el peso puesto en los bordes. */
const sizeOf = (random: () => number, max: number): number => pick(random, [0, 1, 2, 3, Math.floor(random() * max)]);

const T0 = Date.UTC(2026, 9, 6, 5, 0, 0);
const CASES = 400;

// --- Versiones anteriores (3.89.0), copiadas tal cual como referencia -------------------------------

function oldMarkCollective(cuts: readonly ConnectionCut[], vehiclesWithLog: number, thresholds: ConnectionCutThresholds): ConnectionCut[] {
  const ordered = [...cuts].sort((a, b) => a.fromUtcMs - b.fromUtcMs);
  const needed = Math.max(2, Math.ceil(vehiclesWithLog * thresholds.collectiveMinShare));
  const window = thresholds.collectiveWindowMs;
  const endOf = (cut: ConnectionCut): number => cut.toUtcMs ?? cut.fromUtcMs + cut.durationMs;
  return ordered.map((cut) => {
    const near = new Set<string>();
    const overlapping = new Set<string>();
    for (const other of ordered) {
      if (other.fromUtcMs >= cut.fromUtcMs - window && other.fromUtcMs <= cut.fromUtcMs + window) near.add(other.agvId);
      if (cut.end === "tras-apagado" && other.end === "tras-apagado" && other.fromUtcMs <= endOf(cut) && endOf(other) >= cut.fromUtcMs) {
        overlapping.add(other.agvId);
      }
    }
    return { ...cut, collective: near.size >= needed || overlapping.size >= needed };
  });
}

function oldContrast(cuts: readonly ConnectionCut[], deliveries: readonly GroupedDelivery[], tolerance: number): { burstsWithCut: number; cutsWithBurst: number } {
  const overlaps = (cut: ConnectionCut, delivery: GroupedDelivery): boolean =>
    cut.agvId === delivery.agvId && cut.fromUtcMs - tolerance <= delivery.toUtcMs && (cut.toUtcMs ?? Number.POSITIVE_INFINITY) + tolerance >= delivery.fromUtcMs;
  const burstsWithCut = deliveries.filter((delivery) => cuts.some((cut) => overlaps(cut, delivery))).length;
  const cutsWithBurst = cuts.filter((cut) => deliveries.some((delivery) => overlaps(cut, delivery))).length;
  return { burstsWithCut, cutsWithBurst };
}

function oldFindOvertakes(
  entered: readonly { readonly agvId: string; readonly enteredUtcMs: number; readonly leftUtcMs: number }[],
  medianTransitMs: number,
  thresholds: FifoThresholds,
): readonly FifoOvertake[] {
  const sorted = [...entered].sort((a, b) => a.enteredUtcMs - b.enteredUtcMs);
  const margin = Math.max(thresholds.minOvertakeMarginMs, medianTransitMs * thresholds.minOvertakeMarginRatio);

  const overtakes: FifoOvertake[] = [];
  for (const [index, pass] of sorted.entries()) {
    const overtakenBy = sorted
      .slice(index + 1)
      .filter(
        (other) =>
          other.enteredUtcMs - pass.enteredUtcMs >= margin && pass.leftUtcMs - other.leftUtcMs >= margin,
      )
      .map((other) => other.agvId);
    if (overtakenBy.length > 0) {
      overtakes.push({
        overtaken: pass.agvId,
        overtakenBy: [...new Set(overtakenBy)],
        transitMs: pass.leftUtcMs - pass.enteredUtcMs,
        marginMs: margin,
      });
    }
  }
  return overtakes.sort((a, b) => b.marginMs - a.marginMs);
}

function oldSeniorityBreaches(stays: readonly LaneStay[]): readonly SeniorityBreach[] {
  const closed = stays
    .filter(
      (stay): stay is LaneStay & { enteredUtcMs: number; leftUtcMs: number } =>
        stay.state === "completa" && stay.enteredUtcMs !== null && stay.leftUtcMs !== null,
    )
    .sort((a, b) => a.enteredUtcMs - b.enteredUtcMs);

  const breaches: SeniorityBreach[] = [];
  for (const [index, stay] of closed.entries()) {
    const overtakenBy = closed
      .slice(index + 1)
      .filter((other) => other.enteredUtcMs > stay.enteredUtcMs && other.leftUtcMs < stay.leftUtcMs)
      .map((other) => other.agvId);
    if (overtakenBy.length > 0) {
      breaches.push({
        waited: stay.agvId,
        overtakenBy: [...new Set(overtakenBy)],
        waitedMs: stay.leftUtcMs - stay.enteredUtcMs,
      });
    }
  }
  return breaches.sort((a, b) => b.waitedMs - a.waitedMs);
}

type HistoryBandRow = { readonly from: string; readonly to: string; readonly produccion: Band | null; readonly noche: Band | null };

function oldSegmentHistories(franjas: readonly { readonly sourceId: string; readonly bands: readonly HistoryBandRow[] }[]): readonly SegmentHistory[] {
  const keys = new Map<string, { from: string; to: string }>();
  for (const franja of franjas) for (const row of franja.bands) keys.set(pairKey(row.from, row.to), { from: row.from, to: row.to });

  const histories: SegmentHistory[] = [];
  for (const [key, pair] of keys) {
    for (const regime of REGIMES) {
      const points: (SegmentHistoryPoint & { readonly band: Band })[] = [];
      for (const franja of franjas) {
        const band = franja.bands.find((row) => pairKey(row.from, row.to) === key)?.[regime] ?? null;
        if (band !== null) {
          points.push({ sourceId: franja.sourceId, p50Ms: band.p50Ms, p80Ms: band.p80Ms, p95Ms: band.p95Ms, samples: band.samples, band });
        }
      }
      const verdict = classifyHistory(points.map((point) => point.band));
      if (verdict === null) continue;
      histories.push({
        from: pair.from,
        to: pair.to,
        regime,
        kind: verdict.kind,
        direction: verdict.direction,
        atSourceId: verdict.at === null ? null : (points[verdict.at]?.sourceId ?? null),
        points: points.map(({ band: _band, ...point }) => point),
      });
    }
  }
  const size = (history: SegmentHistory): number => {
    const first = history.points[0]?.p50Ms ?? 1;
    const last = history.points[history.points.length - 1]?.p50Ms ?? 1;
    return Math.abs(last / Math.max(1, first) - 1);
  };
  return histories.sort((a, b) => size(b) - size(a) || a.from.localeCompare(b.from));
}

// --- Generadores ---------------------------------------------------------------------------------

/** Instantes en una rejilla gruesa para que haya empates, a partir de una fecha real (ms grandes). */
const instant = (random: () => number, spanS: number, stepS: number): number => T0 + Math.floor((random() * spanS) / stepS) * stepS * 1000;

function randomCuts(random: () => number, max: number): ConnectionCut[] {
  const vehicles = 1 + Math.floor(random() * 6);
  return Array.from({ length: sizeOf(random, max) }, (_, index) => {
    const fromUtcMs = instant(random, 1800, pick(random, [1, 30, 60]));
    const end = pick<CutEnd>(random, ["conexion", "tras-apagado", "tras-apagado", "abierto"]);
    // Duraciones en la misma rejilla que los inicios para que finales e inicios coincidan (bordes).
    const durationMs = pick(random, [0, 1000, 30_000, 60_000, Math.floor(random() * 900_000)]);
    // A veces incoherente a propósito (cierre antes del inicio): la función es pública y la
    // equivalencia tiene que valer para cualquier entrada, no solo para la que da `pairCuts`.
    const toUtcMs = end === "abierto" ? null : random() < 0.1 ? fromUtcMs - 5000 : fromUtcMs + durationMs;
    return {
      agvId: `V${Math.floor(random() * vehicles)}`,
      fromUtcMs,
      toUtcMs,
      durationMs,
      end,
      cutClass: end === "tras-apagado" ? "apagado" : "corte",
      collective: false,
      lastTagId: null,
      lastReadUtcMs: null,
      nextTagId: null,
      nextReadUtcMs: null,
      location: "sin-situar",
      readingsInside: 0,
      sourceRow: index + 2,
    } satisfies ConnectionCut;
  });
}

function randomThresholds(random: () => number): ConnectionCutThresholds {
  return {
    microcutMaxMs: 10_000,
    cutMaxMs: 600_000,
    contrastToleranceMs: pick(random, [0, 30_000, -5_000, 1_234.5]),
    collectiveWindowMs: pick(random, [0, 30_000, 120_000, 600_000, -1]),
    collectiveMinShare: pick(random, [0, 0.3, 0.5, 1]),
    noisyVehicleRatio: 3,
    noisyVehicleMinCuts: 10,
  };
}

function randomDeliveries(random: () => number, max: number): GroupedDelivery[] {
  const vehicles = 1 + Math.floor(random() * 6);
  return Array.from({ length: sizeOf(random, max) }, () => {
    const fromUtcMs = instant(random, 1800, pick(random, [1, 30]));
    const toUtcMs = random() < 0.1 ? fromUtcMs - 1000 : fromUtcMs + pick(random, [0, 30_000, Math.floor(random() * 120_000)]);
    return { agvId: `V${Math.floor(random() * vehicles)}`, fromTagId: "A", fromUtcMs, tags: ["B"], arrivedUtcMs: toUtcMs, toUtcMs, gapMs: 0, spreadMs: 0 } as unknown as GroupedDelivery;
  });
}

function randomPasses(random: () => number, max: number): { agvId: string; enteredUtcMs: number; leftUtcMs: number }[] {
  const vehicles = 1 + Math.floor(random() * 8);
  return Array.from({ length: sizeOf(random, max) }, () => {
    const enteredUtcMs = instant(random, 3600, pick(random, [1, 10, 60]));
    const transit = pick(random, [0, 60_000, Math.floor(random() * 400_000), -2000]);
    return { agvId: `V${Math.floor(random() * vehicles)}`, enteredUtcMs, leftUtcMs: enteredUtcMs + transit };
  });
}

function randomStays(random: () => number, max: number): LaneStay[] {
  const vehicles = 1 + Math.floor(random() * 8);
  return Array.from({ length: sizeOf(random, max) }, () => {
    const enteredUtcMs = random() < 0.1 ? null : instant(random, 7200, pick(random, [1, 60]));
    const base = enteredUtcMs ?? T0;
    // La mitad de las salidas en una rejilla gruesa propia: salidas empatadas con entradas distintas.
    const leftUtcMs =
      random() < 0.1 ? null : random() < 0.5 ? instant(random, 7200, 600) : base + pick(random, [0, 600_000, Math.floor(random() * 3_600_000), -1000]);
    const state = pick<LaneStayState>(random, ["completa", "completa", "completa", "incompleta", "abierta-al-inicio", "abierta-al-final"]);
    return { laneId: "C1", agvId: `V${Math.floor(random() * vehicles)}`, enteredUtcMs, leftUtcMs, durationMs: null, state, truth: "inferred", evidence: "" };
  });
}

function randomBand(random: () => number, base: number): Band | null {
  if (random() < 0.25) return null;
  const p50Ms = base + Math.floor(random() * 4000);
  return { samples: 5 + Math.floor(random() * 20), p50Ms, p80Ms: p50Ms + 1500, p95Ms: p50Ms + 3000, fenceMs: p50Ms + 33_000 };
}

function randomFranjas(random: () => number): { sourceId: string; bands: HistoryBandRow[] }[] {
  const tags = ["A", "B", "C", "D", "E"].slice(0, 2 + Math.floor(random() * 4));
  const trend = pick(random, [0, 2500, -2500, 6000]);
  return Array.from({ length: sizeOf(random, 7) }, (_, index) => ({
    sourceId: `F${index}`,
    // Pares repetidos dentro de una misma franja a propósito: manda el primero, como hacía `find`.
    bands: Array.from({ length: sizeOf(random, 10) }, () => ({
      from: pick(random, tags),
      to: pick(random, tags),
      produccion: randomBand(random, 20_000 + trend * index),
      noche: randomBand(random, 30_000 - trend * index),
    })),
  }));
}

// --- Pruebas -------------------------------------------------------------------------------------

describe("B-09 · las reescrituras dan exactamente lo mismo que la versión cuadrática (TC-381)", () => {
  it("markCollective: ventana deslizante de inicios y solape de apagados, con empates, ventanas cero o negativas y cortes incoherentes", () => {
    const random = rng(381_001);
    for (let round = 0; round < CASES; round += 1) {
      const cuts = randomCuts(random, 80);
      const thresholds = randomThresholds(random);
      const vehiclesWithLog = Math.floor(random() * 8);
      expect(markCollective(cuts, vehiclesWithLog, thresholds)).toEqual(oldMarkCollective(cuts, vehiclesWithLog, thresholds));
    }
  });

  it("summarizeConnections: el contraste cortes ↔ ráfagas por AGV, con tolerancia cero, negativa o fraccionaria y cortes abiertos", () => {
    const random = rng(381_002);
    const clock = { hourOf: (utcMs: number): number => new Date(utcMs).getUTCHours(), dayOf: (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10) };
    for (let round = 0; round < CASES; round += 1) {
      const cuts = randomCuts(random, 60);
      const deliveries = randomDeliveries(random, 60);
      const thresholds = randomThresholds(random);
      const events: ConnectionEvent[] = [];
      const { contrast } = summarizeConnections(cuts, events, [], deliveries, thresholds, 0.01, clock);
      expect({ burstsWithCut: contrast.burstsWithCut, cutsWithBurst: contrast.cutsWithBurst }).toEqual(oldContrast(cuts, deliveries, thresholds.contrastToleranceMs));
    }
  });

  it("findOvertakes (FIFO): mismo adelantado, mismos adelantadores y mismo orden, con márgenes cero, negativos o fraccionarios", () => {
    const random = rng(381_003);
    for (let round = 0; round < CASES; round += 1) {
      const passes = randomPasses(random, 80);
      const thresholds: FifoThresholds = {
        minPassesForSpan: 1,
        minOvertakeMarginMs: pick(random, [0, 1000, 5000, -1000]),
        minOvertakeMarginRatio: pick(random, [0, 0.25, 0.37, 1]),
      };
      const median = pick(random, [0, 60_000, 12_345, -10_000]);
      expect(findOvertakes(passes, median, thresholds)).toEqual(oldFindOvertakes(passes, median, thresholds));
    }
  });

  it("seniorityBreaches (calles): mismas salidas fuera de antigüedad, en el mismo orden, con estancias abiertas e incompletas mezcladas", () => {
    const random = rng(381_004);
    for (let round = 0; round < CASES; round += 1) {
      const stays = randomStays(random, 80);
      expect(seniorityBreaches(stays)).toEqual(oldSeniorityBreaches(stays));
    }
  });

  it("segmentHistories: el par de cada franja por índice da las mismas historias que el `find` lineal, también con pares repetidos", () => {
    const random = rng(381_005);
    for (let round = 0; round < CASES; round += 1) {
      const franjas = randomFranjas(random);
      expect(segmentHistories(franjas)).toEqual(oldSegmentHistories(franjas));
    }
  });

  it("el índice de mínimos recorre en orden exactamente las posiciones aceptadas del rango, y corta cuando se le pide", () => {
    const random = rng(381_006);
    for (let round = 0; round < CASES; round += 1) {
      const keys = Array.from({ length: sizeOf(random, 70) }, () => Math.floor(random() * 50) - 10);
      const scan = minKeyScanner(keys);
      const from = Math.floor(random() * (keys.length + 2));
      const to = Math.floor(random() * (keys.length + 3));
      const limit = Math.floor(random() * 50) - 10;
      const seen: number[] = [];
      scan(from, to, (key) => key <= limit, (index) => {
        seen.push(index);
      });
      const expected = keys.map((key, index) => ({ key, index })).filter(({ key, index }) => index >= from && index < to && key <= limit).map(({ index }) => index);
      expect(seen).toEqual(expected);
      const firstTwo: number[] = [];
      scan(from, to, (key) => key <= limit, (index) => {
        firstTwo.push(index);
        return firstTwo.length === 2;
      });
      expect(firstTwo).toEqual(expected.slice(0, 2));
    }
  });
});
