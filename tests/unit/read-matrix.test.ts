/**
 * Matriz de lectura tag × AGV por pasada.
 *
 * Lo que hay que defender aquí es el denominador. Una tasa de lectura mal normalizada es peor que
 * no tenerla: es convincente, trazable hasta filas reales y equivocada. Las dos trampas que estas
 * pruebas fijan: una rama que un vehículo no recorre no es un fallo suyo (R-OPP-008, TC-028), y un
 * reparto continuo no es un bimodal (OQ-118).
 */

import { describe, expect, it } from "vitest";

import {
  buildReadMatrix,
  type OrderEvidenceLimits,
  type ReadRateThresholds,
} from "../../src/domain/read-matrix.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
const THRESHOLDS: ReadRateThresholds = {
  minPassesPerPair: 2,
  minVehiclesForContrast: 2,
  highRate: 0.8,
  lowRate: 0.2,
  maxGapProvenByNeighbours: 1,
  minTimeRatio: 0.6,
};

/**
 * Sin zonas ni calles declaradas, que es el estado mientras OQ-B04 siga abierta.
 *
 * En ese estado R-FLO-006 no se puede aplicar —no se sabe qué tramo es zona vacía— y la vía de
 * orden vale en todo el anillo. Las pruebas que sí ejercitan la regla declaran su propia zona.
 */
const SIN_ZONAS: OrderEvidenceLimits = { zoneOf: new Map(), laneEntryTags: new Set() };

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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS);

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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS);

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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], conRama, "0100", THRESHOLDS, SIN_ZONAS);

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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS);

    const tag = matrix.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.pattern).toBe("gradiente");
    expect(tag?.truth).toBe("unknown");
  });

  it("pocas pasadas no son un cero: salen sin soporte y con la razón declarada", () => {
    const readings = [...laps("A", RING, 1), ...laps("B", RING, 1)];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS);

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
      SIN_ZONAS,
    );

    const anchor = matrix.tags.find((entry) => entry.tagId === "0100");
    expect(anchor?.isAnchor).toBe(true);
    expect(anchor?.rate).toBe(1);
    expect(matrix.tags.filter((entry) => entry.isAnchor)).toHaveLength(1);
  });

  it("sin vueltas cerradas no hay matriz que sostener, y se dice", () => {
    // Un vehículo que nunca vuelve a pasar por el ancla no cierra ninguna vuelta.
    const readings = [reading("A", "0100"), reading("A", "0200"), reading("A", "0300")];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS);

    expect(matrix.supported).toBe(false);
    expect(matrix.vehicles[0]?.laps).toBe(0);
    expect(matrix.tags.every((tag) => tag.rate === null)).toBe(true);
  });

  it("varios tags seguidos sin leer siguen contando como pasada si el tiempo cuadra", () => {
    // El caso que el encierro por vecinos inmediatos perdía: el vehículo pierde **tres** tags
    // seguidos. Antes, al faltar también el vecino, la pasada desaparecía justo cuando el problema
    // era peor. Ahora se encierra entre las lecturas que sí hubo y decide el tiempo.
    clock = 0;
    const anillo = ["0100", "0200", "0300", "0400", "0500", "0600"];
    const readings: Reading[] = [];
    const paso = (agvId: string, tagId: string, segundos: number): void => {
      clock += segundos * 1000;
      readings.push(reading(agvId, tagId));
    };

    // `A` recorre todo y fija el tiempo normal de cada segmento: 10 s.
    for (let lap = 0; lap <= 5; lap += 1) for (const tagId of anillo) paso("A", tagId, 10);
    paso("A", "0100", 10);

    // `B` pierde 0300, 0400 y 0500, pero tarda lo que se tarda en recorrerlos: 40 s de 0200 a 0600.
    for (let lap = 0; lap <= 5; lap += 1) {
      paso("B", "0100", 10);
      paso("B", "0200", 10);
      paso("B", "0600", 40);
    }
    paso("B", "0100", 10);

    const matrix = buildReadMatrix(0, readings, "oldest-first", [], anillo, "0100", THRESHOLDS, SIN_ZONAS);

    const tag = matrix.tags.find((entry) => entry.tagId === "0400");
    const celda = tag?.byVehicle.find((cell) => cell.agvId === "B");
    expect(celda?.passes).toBeGreaterThan(0);
    // Y consta **cómo** se probó: por tiempo, no por vecinos.
    expect(celda?.byTime).toBeGreaterThan(0);
    expect(celda?.byNeighbours).toBe(0);
    expect(celda?.hits).toBe(0);
  });

  it("si el tiempo desmiente el tramo, no es una pasada ni un fallo del tag: es un atajo", () => {
    clock = 0;
    const anillo = ["0100", "0200", "0300", "0400", "0500", "0600"];
    const readings: Reading[] = [];
    const paso = (agvId: string, tagId: string, segundos: number): void => {
      clock += segundos * 1000;
      readings.push(reading(agvId, tagId));
    };

    for (let lap = 0; lap <= 5; lap += 1) for (const tagId of anillo) paso("A", tagId, 10);
    paso("A", "0100", 10);

    // `B` va de 0200 a 0600 en 3 s cuando ese tramo son 40: no lo recorrió.
    for (let lap = 0; lap <= 5; lap += 1) {
      paso("B", "0100", 10);
      paso("B", "0200", 10);
      paso("B", "0600", 3);
    }
    paso("B", "0100", 10);

    const matrix = buildReadMatrix(0, readings, "oldest-first", [], anillo, "0100", THRESHOLDS, SIN_ZONAS);

    const tag = matrix.tags.find((entry) => entry.tagId === "0400");
    // `B` no aparece con pasadas, y el tramo queda registrado como no sostenido en vez de
    // desaparecer sin más.
    expect(tag?.byVehicle.find((cell) => cell.agvId === "B")).toBeUndefined();
    expect(tag?.unproven).toBeGreaterThan(0);
    // Y el tag no queda señalado por culpa de `B`: solo `A` tiene pasadas ahí.
    expect(tag?.lowReaders).not.toContain("B");
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

    const conHueco = buildReadMatrix(0, readings, "oldest-first", cobertura, RING, "0100", THRESHOLDS, SIN_ZONAS);
    const sinHueco = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS);

    // La vuelta que va de un lado al otro del hueco se descarta: en medio no hubo circulación,
    // hubo ausencia de datos.
    expect((conHueco.vehicles[0]?.laps ?? 0)).toBeLessThan(sinHueco.vehicles[0]?.laps ?? 0);
  });

  it("en zona vacía el orden de convoy deja de probar el paso (R-FLO-006)", () => {
    // La regla es explícita: el vecindario es firme en zona cargada y **débil en zona vacía**,
    // porque ahí la reordenación está admitida. Salir del tramo entre los mismos vehículos deja de
    // demostrar que se recorrió, así que el tramo se queda sin sostener en vez de darse por bueno.
    const readings = convoyDeDos();
    const anillo = ["0100", "0200", "0300", "0400", "0500", "0600"];

    const enCargado = buildReadMatrix(0, readings, "oldest-first", [], anillo, "0100", THRESHOLDS, {
      zoneOf: new Map(anillo.map((tagId) => [tagId, "cargado"])),
      laneEntryTags: new Set(),
    });
    const enVacio = buildReadMatrix(0, readings, "oldest-first", [], anillo, "0100", THRESHOLDS, {
      zoneOf: new Map(anillo.map((tagId) => [tagId, "vacio"])),
      laneEntryTags: new Set(),
    });

    const porOrden = (matrix: typeof enCargado): number =>
      matrix.tags.find((entry) => entry.tagId === "0400")?.byOrder ?? 0;

    expect(porOrden(enCargado)).toBeGreaterThan(0);
    expect(porOrden(enVacio)).toBe(0);
    // Y no desaparece en silencio: se cuenta lo que la regla retiró.
    expect(enVacio.orderWithheld).toBeGreaterThan(0);
    expect(enCargado.orderWithheld).toBe(0);
  });

  it("una entrada de calle en el tramo también retira la vía de orden (R-FLO-006)", () => {
    // Todo en zona cargada, pero por 0300 se entra a una calle: entrar es una salida legítima del
    // orden, así que conservarlo ya no demuestra haber recorrido el tramo.
    const anillo = ["0100", "0200", "0300", "0400", "0500", "0600"];
    const matrix = buildReadMatrix(0, convoyDeDos(), "oldest-first", [], anillo, "0100", THRESHOLDS, {
      zoneOf: new Map(anillo.map((tagId) => [tagId, "cargado"])),
      laneEntryTags: new Set(["0300"]),
    });

    expect(matrix.tags.find((entry) => entry.tagId === "0400")?.byOrder ?? 0).toBe(0);
    expect(matrix.orderWithheld).toBeGreaterThan(0);
  });
});

/**
 * Dos vehículos pegados que se saltan 0300, 0400 y 0500 en todas sus vueltas.
 *
 * Como **nadie** lee esos tres seguidos, ningún segmento de ese tramo tiene tiempo mediano y la
 * decisión recae en la tercera vía, que es justo la que R-FLO-006 acota. `B` y `C` pasan por cada
 * punto con dos segundos de diferencia, así que el convoy se conserva de un extremo al otro.
 */
function convoyDeDos(): readonly Reading[] {
  const readings: Reading[] = [];
  const at = (agvId: string, tagId: string, utcMs: number): void => {
    clock = utcMs - 1000; // `reading` avanza el reloj un segundo antes de sellar.
    readings.push(reading(agvId, tagId));
  };

  for (let lap = 0; lap <= 5; lap += 1) {
    const base = lap * 60_000;
    at("B", "0100", base);
    at("C", "0100", base + 2_000);
    at("B", "0200", base + 7_000);
    at("C", "0200", base + 9_000);
    at("B", "0600", base + 29_000);
    at("C", "0600", base + 31_000);
  }
  at("B", "0100", 360_000);
  at("C", "0100", 362_000);
  return readings;
}
