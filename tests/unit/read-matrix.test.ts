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
  TREND_SERIES_BINS,
} from "../../src/domain/read-matrix.js";
import type { TrendThresholds } from "../../src/domain/read-rate-trend.js";
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
 * Umbral de tendencia que no se alcanza con los escenarios pequeños de este fichero (unas pocas
 * vueltas cada uno). No es que la búsqueda esté desactivada: es que aquí no hay pasadas de sobra
 * para que signifique algo, y `read-rate-trend.test.ts` es donde se prueba el detector en sí.
 */
const SIN_TENDENCIA: TrendThresholds = {
  minPassesForTrend: 10_000,
  minRateDrop: 0.5,
  minPassesEachSide: 5,
  minShareEachSide: 0.15,
  trendSegments: 4,
  minGradientDrop: 0.3,
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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], conRama, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

    const tag = matrix.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.pattern).toBe("gradiente");
    expect(tag?.truth).toBe("unknown");
  });

  it("pocas pasadas no son un cero: salen sin soporte y con la razón declarada", () => {
    const readings = [...laps("A", RING, 1), ...laps("B", RING, 1)];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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
      SIN_TENDENCIA,
    );

    const anchor = matrix.tags.find((entry) => entry.tagId === "0100");
    expect(anchor?.isAnchor).toBe(true);
    expect(anchor?.rate).toBe(1);
    expect(matrix.tags.filter((entry) => entry.isAnchor)).toHaveLength(1);
  });

  it("sin vueltas cerradas no hay matriz que sostener, y se dice", () => {
    // Un vehículo que nunca vuelve a pasar por el ancla no cierra ninguna vuelta.
    const readings = [reading("A", "0100"), reading("A", "0200"), reading("A", "0300")];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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

    const matrix = buildReadMatrix(0, readings, "oldest-first", [], anillo, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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

    const matrix = buildReadMatrix(0, readings, "oldest-first", [], anillo, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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

    const conHueco = buildReadMatrix(0, readings, "oldest-first", cobertura, RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);
    const sinHueco = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

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
    }, SIN_TENDENCIA);
    const enVacio = buildReadMatrix(0, readings, "oldest-first", [], anillo, "0100", THRESHOLDS, {
      zoneOf: new Map(anillo.map((tagId) => [tagId, "vacio"])),
      laneEntryTags: new Set(),
    }, SIN_TENDENCIA);

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
    }, SIN_TENDENCIA);

    expect(matrix.tags.find((entry) => entry.tagId === "0400")?.byOrder ?? 0).toBe(0);
    expect(matrix.orderWithheld).toBeGreaterThan(0);
  });
});

/**
 * Rotura súbita, degradación progresiva y lector de AGV degradado (R-OPP-015), extremo a extremo.
 *
 * El detector en sí ya está probado a fondo en `read-rate-trend.test.ts`, incluidos los casos que
 * **no** deben disparar nada. Lo que hace falta aquí es el cableado: que `buildReadMatrix` reúna la
 * línea temporal correcta para cada tag y cada vehículo, y que el campo aparezca en la fila que le
 * corresponde y no en otra.
 */
const TREND: TrendThresholds = {
  minPassesForTrend: 20,
  minRateDrop: 0.5,
  minPassesEachSide: 5,
  minShareEachSide: 0.15,
  trendSegments: 4,
  minGradientDrop: 0.3,
};

/**
 * Lecturas a ritmo constante: el vehículo avanza una posición del anillo cada 1000 ms, la lea o no.
 *
 * Con el ayudante `reading()` de arriba, saltarse varios tags seguidos acorta el reloj —cada
 * llamada omitida es un segundo que no transcurre— y eso parece un atajo real (recorrer el tramo en
 * mucho menos de lo que tarda), rechazado a propósito por `minTimeRatio`. Aquí el vehículo sigue
 * circulando al mismo ritmo aunque no lea: es lo que hace falta para que un lector que se salta dos
 * o tres tags seguidos siga demostrando el paso por tiempo, en vez de parecer un vehículo que se
 * teletransporta.
 */
function constantPaceReadings(
  agvId: string,
  ring: readonly string[],
  lapsCount: number,
  skip: (lap: number, tagId: string) => boolean = () => false,
): Reading[] {
  const out: Reading[] = [];
  let t = 0;
  for (let lap = 0; lap <= lapsCount; lap += 1) {
    for (const tagId of ring) {
      t += 1000;
      if (tagId !== ring[0] && skip(lap, tagId)) continue;
      row += 1;
      out.push({
        time: { utcMs: t, raw: String(t), zone: ZONE, flag: "ok" },
        agvId,
        tagId,
        provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
      });
    }
  }
  return out;
}

/** `hits` aciertos repartidos de forma pareja entre `total`, sin agrupar al principio ni al final. */
function spread(hits: number, total: number): boolean[] {
  const result: boolean[] = [];
  let acc = 0;
  for (let index = 0; index < total; index += 1) {
    acc += hits;
    if (acc >= total) {
      acc -= total;
      result.push(true);
    } else {
      result.push(false);
    }
  }
  return result;
}

describe("rotura y degradación, extremo a extremo (R-OPP-015)", () => {
  const RING6 = ["0100", "0200", "0300", "0400", "0500", "0600"];

  it("un tag que toda la flota deja de leer a mitad de la ventana sale con su instante de cambio", () => {
    const skip = (lap: number, tagId: string): boolean => tagId === "0300" && lap >= 40;
    const readings = [
      ...constantPaceReadings("H1", RING6, 80, skip),
      ...constantPaceReadings("H2", RING6, 80, skip),
      ...constantPaceReadings("H3", RING6, 80, skip),
    ];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING6, "0100", THRESHOLDS, SIN_ZONAS, TREND);

    const tag = matrix.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.changedAtUtcMs).toBeTypeOf("number");
    expect(tag?.rateBefore).toBeGreaterThan(0.9);
    expect(tag?.rateAfter).toBeLessThan(0.1);
    // El corte real cae en la vuelta 40, a seis posiciones por vuelta: sobre los 240.000 ms.
    expect(tag?.changedAtUtcMs).toBeGreaterThan(200_000);
    expect(tag?.changedAtUtcMs).toBeLessThan(280_000);
    // Y no se confunde con una tendencia: es un corte, no una caída en varios tramos.
    expect(tag?.trend).toBeUndefined();
    // La serie para dibujar el escalón viaja con la rotura, en tramos de tiempo iguales.
    expect(tag?.trendSeries?.rates).toHaveLength(TREND_SERIES_BINS);
    // Y no viaja en un tag sin cambio: no hay forma que enseñar.
    expect(matrix.tags.find((entry) => entry.tagId === "0200")?.trendSeries).toBeUndefined();
  });

  it("un tag que toda la flota lee cada vez menos sale con una tendencia a la baja", () => {
    // Mismo patrón 0,9 → 0,75 → 0,6 → 0,45 que fija `read-rate-trend.test.ts`, aplicado a las
    // mismas vueltas de dos vehículos: es el tag el que se degrada, así que todos lo notan igual.
    const hitPattern = [...spread(18, 20), ...spread(15, 20), ...spread(12, 20), ...spread(9, 20)];
    const skip = (lap: number, tagId: string): boolean => tagId === "0300" && !hitPattern[lap];
    const readings = [
      ...constantPaceReadings("H1", RING6, 79, skip),
      ...constantPaceReadings("H2", RING6, 79, skip),
    ];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING6, "0100", THRESHOLDS, SIN_ZONAS, TREND);

    const tag = matrix.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.trend).toBe("bajando");
    expect(tag?.segmentRates).toBeDefined();
    const rates = tag?.segmentRates as readonly number[];
    for (let index = 1; index < rates.length; index += 1) {
      expect(rates[index]).toBeLessThanOrEqual(rates[index - 1] as number);
    }
    expect(tag?.changedAtUtcMs).toBeUndefined();
    expect(tag?.trendSeries?.rates).toHaveLength(TREND_SERIES_BINS);
  });

  it("un AGV cuyo lector se degrada en varios tags sale marcado él, y sus tags siguen sanos", () => {
    // `D` pierde, cada vez con más frecuencia, los tres tags no ancla de una misma vuelta —su
    // lector falla, no un tag concreto—, mientras `H1` y `H2` los leen siempre. La flota diluye el
    // efecto sobre cada tag por debajo del umbral; en `D` no hay con qué diluirlo.
    const hitPattern = [...spread(18, 20), ...spread(15, 20), ...spread(12, 20), ...spread(9, 20)];
    const skip = (lap: number, tagId: string): boolean => tagId !== "0100" && !hitPattern[lap];
    const readings = [
      ...constantPaceReadings("H1", RING6, 79),
      ...constantPaceReadings("H2", RING6, 79),
      ...constantPaceReadings("D", RING6, 79, skip),
    ];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING6, "0100", THRESHOLDS, SIN_ZONAS, TREND);

    const vehicleD = matrix.vehicles.find((entry) => entry.agvId === "D");
    expect(vehicleD?.trend).toBe("bajando");

    for (const tagId of ["0200", "0300", "0400", "0500", "0600"]) {
      const tag = matrix.tags.find((entry) => entry.tagId === tagId);
      expect(tag?.trend, `${tagId} no debería mostrar tendencia`).toBeUndefined();
      expect(tag?.changedAtUtcMs, `${tagId} no debería mostrar rotura`).toBeUndefined();
    }
    // Y las otras dos vueltas no deberían mostrar nada: leen siempre.
    for (const agvId of ["H1", "H2"]) {
      const vehicle = matrix.vehicles.find((entry) => entry.agvId === agvId);
      expect(vehicle?.trend, `${agvId} no debería mostrar tendencia`).toBeUndefined();
    }
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

/**
 * Vida del tag y rachas por celda (R-OPP-016). Lo que se fija: con la vida detectada, un tag recién
 * puesto no suma como fallos las pasadas de antes de existir, y sin ella sí —es la diferencia entre
 * «se lee bien desde que está» y «todos lo leen poco»—; y cada celda lleva su primera y última
 * lectura y las rachas sin leer de los dos extremos, que es de donde sale «desde tal hora, 0
 * lecturas».
 */
describe("vida del tag y rachas por celda (R-OPP-016)", () => {
  const RING6 = ["0100", "0200", "0300", "0400", "0500", "0600"];

  it("con la vida detectada, las pasadas de antes de que el tag empezara a leerse no cuentan", () => {
    const skip = (lap: number, tagId: string): boolean => tagId === "0300" && lap < 20;
    const readings = ["H1", "H2", "H3"].flatMap((agvId) => constantPaceReadings(agvId, RING6, 40, skip));
    const start = Math.min(...readings.filter((entry) => entry.tagId === "0300").map((entry) => entry.time.utcMs));

    const sinVida = buildReadMatrix(0, readings, "oldest-first", [], RING6, "0100", THRESHOLDS, SIN_ZONAS, TREND);
    const conVida = buildReadMatrix(0, readings, "oldest-first", [], RING6, "0100", THRESHOLDS, SIN_ZONAS, TREND,
      new Map([["0300", { from: start, to: null }]]));

    expect(sinVida.tags.find((entry) => entry.tagId === "0300")?.rate).toBe(0.5);
    const tag = conVida.tags.find((entry) => entry.tagId === "0300");
    expect(tag?.rate).toBe(1);
    expect(tag?.pattern).toBe("uniforme-alto");
  });

  it("cada celda lleva su primera y última lectura y las rachas sin leer de los dos extremos", () => {
    const readings = [
      ...constantPaceReadings("H1", RING6, 40),
      ...constantPaceReadings("H2", RING6, 40, (lap, tagId) => tagId === "0300" && (lap < 5 || lap >= 30)),
      ...constantPaceReadings("H3", RING6, 40),
    ];
    const matrix = buildReadMatrix(0, readings, "oldest-first", [], RING6, "0100", THRESHOLDS, SIN_ZONAS, TREND);
    const cell = matrix.tags.find((entry) => entry.tagId === "0300")?.byVehicle.find((entry) => entry.agvId === "H2");

    expect(cell?.leadingMisses).toBe(5);
    expect(cell?.trailingMisses).toBe(10);
    // Vuelta 5 y vuelta 29, seis posiciones por vuelta a un segundo cada una: 0300 es la tercera.
    expect(cell?.firstHitUtcMs).toBe(33_000);
    expect(cell?.lastHitUtcMs).toBe(177_000);
  });
});

describe("vueltas que la matriz no cuenta · cola cortada y hora repetida", () => {
  it("una vuelta que se cierra en la cola cortada de la exportación no cuenta (R-DAT-007)", () => {
    clock = 0;
    const readings = [reading("A", "0100"), reading("A", "0200"), reading("A", "0300"), reading("A", "0400"), reading("A", "0100")];
    // La cobertura completa termina en 4000: el paso por el ancla de 5000 es la cola cortada.
    const cobertura = [{ from: 0, to: 4000 }];

    const conCobertura = buildReadMatrix(0, readings, "oldest-first", cobertura, RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);
    const sinCobertura = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

    expect(sinCobertura.vehicles[0]?.laps).toBe(1);
    // Con la cobertura declarada, los dos extremos de la vuelta no caen en el mismo tramo.
    expect(conCobertura.vehicles[0]?.laps).toBe(0);
    expect(conCobertura.supported).toBe(false);
  });

  it("una vuelta con una lectura en hora repetida no se usa como pasada (ADR-0013)", () => {
    clock = 0;
    const readings = [reading("A", "0100"), reading("A", "0200"), reading("A", "0300"), reading("A", "0400"), reading("A", "0100")];
    const tercera = readings[2] as Reading;
    readings[2] = { ...tercera, time: { ...tercera.time, flag: "dst_ambiguous" } };

    const matriz = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

    // Dentro de esa hora el instante no separa las dos ocurrencias: ni el orden de los pasos ni el
    // tiempo de los tramos son medida, así que la vuelta no sostiene ninguna celda.
    expect(matriz.vehicles[0]?.laps).toBe(0);
  });

  it("una vuelta con una hora repetida resuelta por posición sí cuenta como pasada (OQ-137)", () => {
    // La posición en el fichero asignó la ocurrencia, así que el instante vuelve a ordenar los pasos
    // y a medir los tramos: la vuelta es una pasada normal.
    clock = 0;
    const readings = [reading("A", "0100"), reading("A", "0200"), reading("A", "0300"), reading("A", "0400"), reading("A", "0100")];
    const tercera = readings[2] as Reading;
    readings[2] = { ...tercera, time: { ...tercera.time, flag: "dst_by_position" } };

    const matriz = buildReadMatrix(0, readings, "oldest-first", [], RING, "0100", THRESHOLDS, SIN_ZONAS, SIN_TENDENCIA);

    expect(matriz.vehicles[0]?.laps).toBe(1);
  });
});
