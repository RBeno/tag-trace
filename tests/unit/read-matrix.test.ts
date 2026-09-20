/**
 * Matriz de lectura tag × AGV por pasada.
 *
 * Lo que hay que defender aquí es el denominador. Una tasa de lectura mal normalizada es peor que
 * no tenerla: es convincente, trazable hasta filas reales y equivocada. Las dos trampas que estas
 * pruebas fijan: una rama que un vehículo no recorre no es un fallo suyo (R-OPP-008, TC-028), y un
 * reparto continuo no es un bimodal (OQ-118).
 */

import { describe, expect, it } from "vitest";

import { buildReadMatrix, type ReadRateThresholds } from "../../src/domain/read-matrix.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
const THRESHOLDS: ReadRateThresholds = {
  minPassesPerPair: 2,
  minVehiclesForContrast: 2,
  highRate: 0.8,
  lowRate: 0.2,
};

let row = 0;
let clock = 0;

function reading(agvId: string, tagId: string): Reading {
  row += 1;
  clock += 1000;
  return {
    time: { utcMs: clock, raw: String(clock), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

/** Recorre el anillo `laps` veces, omitiendo los tags que `skip` diga en cada vuelta. */
function laps(
  agvId: string,
  ring: readonly string[],
  count: number,
  skip: (lap: number, tagId: string) => boolean = () => false,
): Reading[] {
  const out: Reading[] = [];
  for (let lap = 0; lap <= count; lap += 1) {
    for (const tagId of ring) {
      // El ancla siempre se lee: es lo que cierra la vuelta.
      if (tagId !== ring[0] && skip(lap, tagId)) continue;
      out.push(reading(agvId, tagId));
    }
  }
  return out;
}

const RING = ["0100", "0200", "0300", "0400"];

describe("matriz de lectura por pasada", () => {
  it("un tag que unos leen siempre y otros nunca sale bimodal, con los dos grupos enumerados", () => {
    const readings = [
      ...laps("A", RING, 4),
      ...laps("B", RING, 4, (_lap, tagId) => tagId === "0300"),
    ];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS);

    const tag = matrix.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.pattern).toBe("bimodal-candidato");
    expect(tag?.truth).toBe("inferred");
    expect(tag?.highReaders).toEqual(["A"]);
    expect(tag?.lowReaders).toEqual(["B"]);
  });

  it("un tag que todos leen poco sale uniforme-bajo, que apunta al tag y no a los vehículos", () => {
    // Los dos lo leen una de cada seis vueltas: por debajo del 0,2 que separa «no lo lee».
    // Con una de cada cuatro (25 %) el patrón sale `gradiente`, y está bien que salga: la franja
    // de en medio existe justamente para no llamar bimodal ni uniforme a lo que no lo es.
    const omite = (lap: number, tagId: string): boolean => tagId === "0300" && lap % 6 !== 0;
    const readings = [...laps("A", RING, 11, omite), ...laps("B", RING, 11, omite)];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS);

    const tag = matrix.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.pattern).toBe("uniforme-bajo");
    expect(tag?.lowReaders).toEqual(["A", "B"]);
  });

  it("**una rama que un vehículo no recorre no cuenta como fallo suyo** (R-OPP-008, TC-028)", () => {
    // El anillo tiene una rama, `0900`, entre 0400 y 0100. `A` la recorre; `B` nunca entra en ella
    // y por tanto tampoco lee a sus vecinos por ese lado.
    const conRama = ["0100", "0200", "0300", "0400", "0900"];
    const readings = [
      ...laps("A", conRama, 4),
      // `B` hace el anillo corto: nunca pasa por 0900 ni por su vecindad inmediata.
      ...laps("B", ["0100", "0200", "0300"], 4),
    ];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], conRama, "0100", THRESHOLDS);

    const rama = matrix.tags.find((entry) => entry.tagId === "0900");
    // `B` no aparece como lector fallido de 0900: sencillamente no pasó por ahí. Si contara, `B`
    // saldría con 0 % y la rama parecería un tag averiado para media flota.
    expect(rama?.lowReaders).not.toContain("B");
    expect(rama?.byVehicle.find((cell) => cell.agvId === "B")).toBeUndefined();
    // Y con un solo vehículo con soporte no hay contraste que sostenga un patrón.
    expect(rama?.pattern).toBe("sin-soporte");
    expect(rama?.truth).toBe("unknown");
  });

  it("un reparto continuo es gradiente y queda unknown, no bimodal (OQ-118)", () => {
    // Tres vehículos: uno lo lee siempre, otro la mitad, otro un tercio. No hay dos grupos.
    const readings = [
      ...laps("A", RING, 5),
      ...laps("B", RING, 5, (lap, tagId) => tagId === "0300" && lap % 2 === 0),
      ...laps("C", RING, 5, (lap, tagId) => tagId === "0300" && lap % 3 !== 0),
    ];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS);

    const tag = matrix.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.pattern).toBe("gradiente");
    expect(tag?.truth).toBe("unknown");
  });

  it("pocas pasadas no son un cero: salen sin soporte y con la razón declarada", () => {
    const readings = [...laps("A", RING, 1), ...laps("B", RING, 1)];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS);

    for (const tag of matrix.tags) {
      expect(tag.pattern).toBe("sin-soporte");
      expect(tag.truth).toBe("unknown");
    }
  });

  it("el ancla se marca, porque su 100 % lo fabrica el método y no es evidencia", () => {
    const matrix = buildReadMatrix(
      0,
      laps("A", RING, 4),
      "oldest-first",
      [],
      RING,
      "0100",
      THRESHOLDS,
    );

    const anchor = matrix.tags.find((entry) => entry.tagId === "0100");
    expect(anchor?.isAnchor).toBe(true);
    expect(anchor?.rate).toBe(1);
    expect(matrix.tags.filter((entry) => entry.isAnchor)).toHaveLength(1);
  });

  it("sin vueltas cerradas no hay matriz que sostener, y se dice", () => {
    // Un vehículo que nunca vuelve a pasar por el ancla no cierra ninguna vuelta.
    const readings = [reading("A", "0100"), reading("A", "0200"), reading("A", "0300")];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS);

    expect(matrix.supported).toBe(false);
    expect(matrix.vehicles[0]?.laps).toBe(0);
    expect(matrix.tags.every((tag) => tag.rate === null)).toBe(true);
  });

  it("una vuelta que cruza un hueco de cobertura no cuenta (R-DAT-007)", () => {
    clock = 0;
    const primera = laps("A", RING, 2);
    // Salto de cobertura: la siguiente tanda ocurre mucho después, fuera de lo cargado.
    clock += 10_000_000;
    const segunda = laps("A", RING, 2);
    const readings = [...primera, ...segunda];
    const cobertura = [
      { from: 0, to: (primera[primera.length - 1] as Reading).time.utcMs },
      { from: (segunda[0] as Reading).time.utcMs, to: clock },
    ];

    const conHueco = buildReadMatrix(0, readings, "oldest-first", cobertura, RING, "0100", THRESHOLDS);
    const sinHueco = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS);

    // La vuelta que va de un lado al otro del hueco se descarta: en medio no hubo circulación,
    // hubo ausencia de datos.
    expect((conHueco.vehicles[0]?.laps ?? 0)).toBeLessThan(sinHueco.vehicles[0]?.laps ?? 0);
  });
});
