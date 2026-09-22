/**
 * Vueltas por vehículo (ALG-004) y anclas de vuelta declaradas (R-GRA-009).
 *
 * Lo que importa comprobar: el ancla sale del ciclo dominante y no del punto de partida arbitrario;
 * sin ancla declarada las vueltas nunca son `observed`; con una declarada y resuelta, una vuelta
 * `completa` sí puede serlo, pero una `parcial` nunca —uno de sus dos extremos es siempre un corte
 * de los datos, no el ancla—; y un hueco de cobertura degrada la vuelta a parcial en vez de fingir
 * que el circuito se recorrió sin interrupción.
 */

import { describe, expect, it } from "vitest";

import {
  findDominantCycle,
  resolveDeclaredAnchor,
  segmentLaps,
  type LapAnchor,
} from "../../src/domain/laps.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
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

function laps(agvId: string, tags: readonly string[], count: number, start: number): Reading[] {
  const out: Reading[] = [];
  let t = start;
  for (let lap = 0; lap < count; lap += 1) {
    for (const tag of tags) out.push(reading((t += 10_000), agvId, tag));
  }
  return out;
}

describe("ciclo dominante", () => {
  const ANILLO = ["0100", "0200", "0300", "0400"];

  it("encuentra el ancla como la entrada real al ciclo, no el punto de partida", () => {
    // Un tag "0050" alimenta el anillo una sola vez y no forma parte de él: el ciclo debe
    // encontrarse igual, entrando por donde el ciclo empieza de verdad.
    const transitions = [
      { from: "0050", to: "0100" },
      ...ANILLO.flatMap((tag, index) => {
        const next = ANILLO[(index + 1) % ANILLO.length] as string;
        return Array.from({ length: 10 }, () => ({ from: tag, to: next }));
      }),
    ];
    const anchor = findDominantCycle(transitions);
    expect(anchor?.cycle).toHaveLength(4);
    expect(anchor?.weakestShare).toBe(1);
  });

  it("sin topología suficiente, no hay ancla y se declara así", () => {
    expect(findDominantCycle([{ from: "0100", to: "0200" }])).toBeNull();
  });
});

describe("resolveDeclaredAnchor", () => {
  const inferred: LapAnchor = {
    tagId: "0100",
    cycle: ["0100", "0200", "0300", "0400"],
    weakestShare: 1,
  };

  it("la ancla declarada que aparece en el ciclo gana y lo rota sin alterar el orden relativo", () => {
    const resolved = resolveDeclaredAnchor(inferred, ["0300"]);
    expect(resolved?.tagId).toBe("0300");
    expect(resolved?.cycle).toEqual(["0300", "0400", "0100", "0200"]);
  });

  it("una ancla declarada que no está en el ciclo devuelve null: no se inventa un corte", () => {
    expect(resolveDeclaredAnchor(inferred, ["0999"])).toBeNull();
  });

  it("con varias declaradas, se prueban en orden de prioridad y gana la primera que aparece", () => {
    // "0999" no está en el ciclo; se descarta y se prueba la siguiente.
    const resolved = resolveDeclaredAnchor(inferred, ["0999", "0400"]);
    expect(resolved?.tagId).toBe("0400");
    expect(resolved?.cycle).toEqual(["0400", "0100", "0200", "0300"]);
  });

  it("si la primera declarada ya coincide con el ancla inferida, la rotación no cambia nada", () => {
    const resolved = resolveDeclaredAnchor(inferred, ["0100"]);
    expect(resolved?.cycle).toEqual(inferred.cycle);
  });
});

describe("segmentación de vueltas", () => {
  const ANILLO = ["0100", "0200", "0300", "0400"];

  it("sin ancla declarada, una vuelta completa es inferred aunque los datos sean perfectos", () => {
    const readings = laps("A", ANILLO, 3, 0);
    const result = segmentLaps(readings, "oldest-first", [{ from: 0, to: 200_000 }], "0100", "inferred");

    const completas = result.filter((lap) => lap.completeness === "completa");
    expect(completas.length).toBeGreaterThan(0);
    expect(completas.every((lap) => lap.truth === "inferred")).toBe(true);
  });

  it("con ancla declarada y resuelta, una vuelta completa pasa a observed", () => {
    const readings = laps("A", ANILLO, 3, 0);
    const result = segmentLaps(readings, "oldest-first", [{ from: 0, to: 200_000 }], "0100", "observed");

    const completas = result.filter((lap) => lap.completeness === "completa");
    expect(completas.length).toBeGreaterThan(0);
    expect(completas.every((lap) => lap.truth === "observed")).toBe(true);
  });

  it("una vuelta parcial sigue inferred aunque el ancla sea declarada: uno de sus extremos es un corte de los datos", () => {
    const readings = [
      reading(1000, "A", "0300"),
      reading(2000, "A", "0400"),
      ...laps("A", ANILLO, 2, 2000),
    ];
    const result = segmentLaps(readings, "oldest-first", [{ from: 0, to: 200_000 }], "0100", "observed");

    expect(result[0]?.completeness).toBe("parcial");
    expect(result[0]?.stops).toBe(3); // 0300, 0400, y el primer 0100
    expect(result[0]?.truth).toBe("inferred");
  });

  it("un vehículo que nunca pasa por el ancla sale como una sola vuelta desconocida, declarada o no", () => {
    const readings = laps("Z", ["0900", "0910"], 3, 0);
    const result = segmentLaps(readings, "oldest-first", [{ from: 0, to: 200_000 }], "0100", "observed");

    expect(result).toHaveLength(1);
    expect(result[0]?.completeness).toBe("desconocida");
    expect(result[0]?.truth).toBe("unknown");
  });

  it("una vuelta que cruza un hueco de cobertura se degrada a parcial y sigue inferred aunque el ancla sea declarada", () => {
    const primera = laps("A", ANILLO, 2, 0);
    const segunda = laps("A", ANILLO, 2, 1_000_000_000);
    const readings = [...primera, ...segunda];
    const coverage = [
      { from: 0, to: 80_000 },
      { from: 1_000_000_000, to: 1_000_080_000 },
    ];
    const result = segmentLaps(readings, "oldest-first", coverage, "0100", "observed");

    // La vuelta que uniría el final de la primera ventana con el principio de la segunda cruza el
    // hueco de 38 días y no puede salir "completa": sería fingir un recorrido que no se observó.
    const cruzaHueco = result.find(
      (lap) => lap.startUtcMs < 1_000_000_000 && lap.endUtcMs >= 1_000_000_000,
    );
    expect(cruzaHueco?.completeness).toBe("parcial");
    expect(cruzaHueco?.truth).toBe("inferred");
  });
});
