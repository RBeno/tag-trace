/**
 * Empates de instante en el dominio (B-10, revisión del 2026-10-18).
 *
 * Dos lecturas del mismo AGV en el mismo instante no se ordenan por el reloj: las ordena la posición
 * en el fichero, y esa posición solo significa algo con el **sentido** de la fuente (ADR-0013,
 * `order.ts`). Los módulos que reciben lecturas sin ese sentido —vecinos de un tag, línea, calles,
 * FIFO, expedientes, batería, replay, flota, cortes— ordenan por instante con un `sort` estable y
 * escriben la precondición en su comentario: las lecturas llegan en orden canónico. Lo que se fija
 * aquí:
 *
 * - con la entrada en orden canónico, el resultado no depende de cómo llegaron las lecturas, y el
 *   empate se resuelve como dice `compareReadings` en los dos sentidos. Es lo que impide «arreglar»
 *   el empate dentro del módulo por fila ascendente, que daría la vuelta a las pilas `newest-first`;
 * - el registro de conexiones, que sí trae la fila y un sentido fijo (de más reciente a más antiguo),
 *   desempata él mismo: `pairCuts` da los mismos cortes con los eventos en cualquier orden.
 */

import { describe, expect, it } from "vitest";

import { pairCuts } from "../../src/domain/connection-cuts.js";
import type { ConnectionEvent } from "../../src/domain/connection-log.js";
import { sortReadings, type SourceDirection } from "../../src/domain/order.js";
import type { Reading } from "../../src/domain/reading.js";
import { dominantNeighbours } from "../../src/domain/undeclared-tags.js";

function reading(utcMs: number, tagId: string, sourceRow: number): Reading {
  return { time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" }, agvId: "V1", tagId, provenance: { sourceId: "s", sourceHash: "h", sourceRow } };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe("B-10 · un empate de instante lo decide el orden canónico, no el orden de llegada (TC-382)", () => {
  // El caso del informe: U y Q leídos en el mismo instante. U está en la fila 3 y Q en la 4.
  const readings = [reading(1000, "P", 2), reading(2000, "U", 3), reading(2000, "Q", 4), reading(3000, "R", 5)];

  const placeOfU = (input: readonly Reading[], direction: SourceDirection) =>
    dominantNeighbours(sortReadings([...input], direction), new Set(["U"])).get("U");

  it("dominantNeighbours: en orden canónico, las 24 maneras de llegar dan el mismo sitio, y el sentido de la pila decide el empate", () => {
    const oldestFirst = permutations(readings).map((input) => placeOfU(input, "oldest-first"));
    const newestFirst = permutations(readings).map((input) => placeOfU(input, "newest-first"));
    expect(new Set(oldestFirst.map((place) => JSON.stringify(place))).size).toBe(1);
    expect(new Set(newestFirst.map((place) => JSON.stringify(place))).size).toBe(1);
    // Fichero de más antiguo a más reciente: la fila 3 (U) va antes que la 4 (Q).
    expect(oldestFirst[0]).toEqual({ predecessor: "P", successor: "Q" });
    // Una pila: bajar por el fichero es retroceder, así que la fila 4 (Q) es la anterior.
    expect(newestFirst[0]).toEqual({ predecessor: "Q", successor: "R" });
  });

  it("pairCuts: una desconexión y su conexión del mismo segundo dan el mismo corte con los eventos en cualquier orden", () => {
    const T0 = Date.UTC(2026, 9, 6, 5, 0, 0);
    const event = (offsetS: number, kind: ConnectionEvent["kind"], sourceRow: number): ConnectionEvent => ({
      agvId: "V1",
      utcMs: T0 + offsetS * 1000,
      kind,
      rawKind: kind,
      coverage: "",
      ipTerminal: "",
      version: "",
      aux: "",
      mtc: null,
      sourceRow,
    });
    // El fichero del terminal, de más reciente a más antiguo: la conexión de las 5:00:10 está encima
    // (fila 4) de su desconexión del mismo segundo (fila 5).
    const events = [event(110, "conexion", 2), event(100, "desconexion", 3), event(10, "conexion", 4), event(10, "desconexion", 5)];
    const thresholds = { microcutMaxMs: 10_000, cutMaxMs: 600_000, contrastToleranceMs: 30_000, collectiveWindowMs: 120_000, collectiveMinShare: 0.5, noisyVehicleRatio: 3, noisyVehicleMinCuts: 10 };
    const outcomes = permutations(events).map((input) =>
      pairCuts(input, T0 + 200_000, thresholds).map((cut) => [cut.fromUtcMs - T0, cut.durationMs, cut.end, cut.sourceRow]),
    );
    expect(new Set(outcomes.map((outcome) => JSON.stringify(outcome))).size).toBe(1);
    expect(outcomes[0]).toEqual([
      [10_000, 0, "conexion", 5],
      [100_000, 10_000, "conexion", 3],
    ]);
  });
});
