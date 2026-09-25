/**
 * Tags leídos fuera de la lista del circuito (`src/domain/undeclared-tags.ts`, R-DAT-022).
 *
 * Lo que se fija, con las palabras del propietario: un tag que se lee de día en el mismo sitio es
 * candidato a esa posición, y si la lista tiene ahí un tag sin lecturas se nombra; uno que solo se lee
 * de noche, y de día se pasa por su sitio sin leerlo, es un tag de noche; si de día no hay pasadas
 * con las que comprobarlo, es posiblemente de noche; y sin lista del circuito no se evalúa.
 */

import { describe, expect, it } from "vitest";

import type { Reading } from "../../src/domain/reading.js";
import { locateUndeclaredTags, type UndeclaredTagThresholds } from "../../src/domain/undeclared-tags.js";

const THRESHOLDS: UndeclaredTagThresholds = { minSlotPasses: 10, maxChance: 0.001, maxReadsBetween: 2 };
const HOUR = 3_600_000;
/** Noche de 22 a 05, por la hora UTC del instante: basta para la prueba. */
const regimeOf = (utcMs: number) => {
  const hour = new Date(utcMs).getUTCHours();
  return hour >= 22 || hour < 5 ? ("noche" as const) : ("produccion" as const);
};

let row = 0;
function lap(agvId: string, start: number, tags: readonly string[]): Reading[] {
  return tags.map((tagId, index) => {
    row += 1;
    const utcMs = start + index * 10_000;
    return { time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" }, agvId, tagId, provenance: { sourceId: "s", sourceHash: "s", sourceRow: row } };
  });
}

/** Vueltas de dos AGV cada media hora, de 00:00 a 24:00; `extra` decide qué se lee en cada una. */
function day(extra: (start: number) => readonly string[]): Reading[] {
  const readings: Reading[] = [];
  for (let start = 0; start < 24 * HOUR; start += HOUR / 2) {
    readings.push(...lap("A", start, extra(start)), ...lap("B", start + 60_000, extra(start)));
  }
  return readings;
}

const isNight = (start: number) => regimeOf(start) === "noche";
const declared = ["01", "02", "0Z", "03", "04", "05"];

describe("tags leídos fuera de la lista del circuito", () => {
  it("de día en el mismo sitio: candidato a la posición, y se nombra el declarado sin lecturas", () => {
    const readings = day(() => ["01", "02", "X", "03", "04", "05"]);
    const report = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS);
    const x = report.tags.find((tag) => tag.tagId === "X");
    expect(x).toMatchObject({ verdict: "posicion", predecessor: "02", successor: "03", predecessorOrder: 2, successorOrder: 4 });
    expect(x?.declaredWithoutReadings).toEqual(["0Z"]);
    expect(x?.dayReadings).toBeGreaterThan(0);
    expect(x?.nightReadings).toBeGreaterThan(0);
  });

  it("solo de noche, y de día se pasa por su sitio sin leerlo: tag de noche", () => {
    const readings = day((start) => (isNight(start) ? ["01", "02", "03", "04", "N", "05"] : ["01", "02", "03", "04", "05"]));
    const n = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS).tags.find((tag) => tag.tagId === "N");
    expect(n?.verdict).toBe("noche");
    expect(n?.dayReadings).toBe(0);
    expect(n?.dayPasses).toBeGreaterThanOrEqual(THRESHOLDS.minSlotPasses);
    expect(n?.dayHits).toBe(0);
    expect(n?.evidence).toContain("tag de noche");
  });

  it("solo de noche y sin datos de día: posiblemente de noche", () => {
    const readings = day((start) => (isNight(start) ? ["01", "02", "03", "04", "N", "05"] : [])).filter((reading) => regimeOf(reading.time.utcMs) === "noche");
    const n = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS).tags.find((tag) => tag.tagId === "N");
    expect(n?.verdict).toBe("noche-probable");
    expect(n?.dayPasses).toBe(0);
  });

  it("los tags con su sitio en otra lista no se buscan, y sin lista del circuito no se evalúa", () => {
    const readings = day(() => ["01", "02", "M", "03", "04", "05"]);
    expect(locateUndeclaredTags(readings, declared, new Set(["M"]), regimeOf, THRESHOLDS).tags).toEqual([]);
    const sinLista = locateUndeclaredTags(readings, [], new Set(), regimeOf, THRESHOLDS);
    expect(sinLista.evaluated).toBe(false);
    expect(sinLista.reason).not.toBeNull();
  });
});
