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
import { dominantNeighbours, locateUndeclaredTags, type UndeclaredTagThresholds } from "../../src/domain/undeclared-tags.js";

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
  it("solo de noche y en la lista de noche: tag de noche declarado, sin hacer falta pasadas de día", () => {
    // Solo de noche también sus vecinos: de día no hay pasadas por su sitio con las que comprobarlo.
    const readings = day((start) => (isNight(start) ? ["01", "02", "03", "04", "N", "05"] : []));
    const sinLista = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS).tags.find((tag) => tag.tagId === "N");
    expect(sinLista?.verdict).toBe("noche-probable");
    const n = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS, new Set(["N"])).tags.find(
      (tag) => tag.tagId === "N",
    );
    expect(n).toMatchObject({ verdict: "noche-declarado", declaredNight: true });
    expect(n?.evidence).toContain("tag de noche declarado");
  });

  it("en la lista de noche pero leído de día: manda lo leído, candidato a la posición, y se dice", () => {
    const readings = day(() => ["01", "02", "X", "03", "04", "05"]);
    const x = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS, new Set(["X"])).tags.find(
      (tag) => tag.tagId === "X",
    );
    expect(x).toMatchObject({ verdict: "posicion", declaredNight: true });
    expect(x?.evidence).toContain("La lista de tags de noche lo declara de noche, y se lee también de día.");
  });

  it("de día en el mismo sitio: candidato a la posición, y se nombra el declarado sin lecturas", () => {
    const readings = day(() => ["01", "02", "X", "03", "04", "05"]);
    const report = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS);
    const x = report.tags.find((tag) => tag.tagId === "X");
    expect(x).toMatchObject({ verdict: "posicion", predecessor: "02", successor: "03", predecessorOrder: 2, successorOrder: 4 });
    expect(x?.declaredWithoutReadings).toEqual(["0Z"]);
    expect(x?.evidence).toContain("la lista pone ahí 0Z, que no se lee: o se sustituyó, o el número está mal escrito en la lista");
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

  it("el sitio de cualquier tag lo dan sus vecinos leídos, y un tag sin lecturas no tiene sitio", () => {
    const readings = day(() => ["01", "02", "X", "03", "04", "05"]);
    const places = dominantNeighbours(readings, new Set(["X", "04", "0Z"]));
    expect(places.get("X")).toEqual({ predecessor: "02", successor: "03" });
    expect(places.get("04")).toEqual({ predecessor: "03", successor: "05" });
    expect(places.has("0Z")).toBe(false);
  });
});

describe("el sitio que cruza el final de la lista, y la lectura de día suelta", () => {
  it("entre el último y el primero de la lista: el declarado sin lecturas del final se nombra", () => {
    const lista = ["01", "02", "03", "04", "0Z"];
    const readings = day(() => ["01", "02", "03", "04", "X"]);
    const x = locateUndeclaredTags(readings, lista, new Set(), regimeOf, THRESHOLDS).tags.find((tag) => tag.tagId === "X");
    expect(x).toMatchObject({ verdict: "posicion", predecessor: "04", successor: "01", declaredWithoutReadings: ["0Z"] });
  });

  it("una sola lectura de día no convierte un tag de noche en candidato a la posición: sigue siendo de noche, y se dice", () => {
    const readings = day((start) => (isNight(start) ? ["01", "02", "03", "04", "N", "05"] : ["01", "02", "03", "04", "05"]));
    const stray = readings.find((entry) => entry.tagId === "01" && regimeOf(entry.time.utcMs) === "produccion") as Reading;
    readings.push({ ...stray, tagId: "N", time: { ...stray.time, utcMs: stray.time.utcMs + 45_000 } });
    const n = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS).tags.find((tag) => tag.tagId === "N");
    expect(n).toMatchObject({ verdict: "noche", dayReadings: 1 });
    expect(n?.evidence).toContain("Tuvo 1 lectura de día, ninguna en su sitio.");
    // En la lista de noche, lo mismo: declarado.
    const declaradoNoche = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS, new Set(["N"])).tags.find(
      (tag) => tag.tagId === "N",
    );
    expect(declaradoNoche?.verdict).toBe("noche-declarado");
  });

  it("una lectura de día en su sitio sí manda: candidato a la posición", () => {
    // Todas las noches y una sola vez de día, pero esa vez entre sus vecinos: lo leído lo sitúa ahí.
    let seen = false;
    const readings = day((start) => {
      if (isNight(start)) return ["01", "02", "X", "03", "04", "05"];
      if (seen) return ["01", "02", "03", "04", "05"];
      seen = true;
      return ["01", "02", "X", "03", "04", "05"];
    });
    const x = locateUndeclaredTags(readings, declared, new Set(), regimeOf, THRESHOLDS).tags.find((tag) => tag.tagId === "X");
    expect(x?.verdict).toBe("posicion");
    expect(x?.dayHits).toBeGreaterThan(0);
  });
});
