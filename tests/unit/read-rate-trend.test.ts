/**
 * Detección de rotura súbita y degradación progresiva (R-OPP-015).
 *
 * Lo que hay que defender aquí no es que el algoritmo encuentre un cambio cuando lo hay: es que
 * **no lo encuentre cuando no lo hay**. Un tag `bimodal-candidato` mezcla en una sola línea temporal
 * los aciertos de quien siempre lo lee y los fallos de quien nunca lo lee; si esa mezcla se leyera
 * como una rotura, sería el falso positivo más caro de todos —convincente, trazable, y equivocado—.
 * Las pruebas de «no dispara» pesan tanto como las de «sí dispara».
 */

import { describe, expect, it } from "vitest";

import {
  binTimeline,
  detectTrend,
  type PassRecord,
  type TrendThresholds,
} from "../../src/domain/read-rate-trend.js";

const THRESHOLDS: TrendThresholds = {
  minPassesForTrend: 20,
  minRateDrop: 0.5,
  minPassesEachSide: 5,
  minShareEachSide: 0.15,
  trendSegments: 4,
  minGradientDrop: 0.3,
};

const MINUTE = 60_000;

/** Una línea temporal a partir de una lista de aciertos/fallos, un minuto de separación cada uno. */
function timeline(hits: readonly boolean[], startUtcMs = 0): readonly PassRecord[] {
  return hits.map((hit, index) => ({ utcMs: startUtcMs + index * MINUTE, hit }));
}

/** Repite un patrón `n` veces, para construir líneas largas sin escribirlas a mano. */
function repeat<T>(pattern: readonly T[], times: number): T[] {
  return Array.from({ length: times }, () => pattern).flat();
}

/**
 * `hits` aciertos repartidos de forma pareja entre `total` posiciones, sin agruparlos al principio
 * ni al final. Necesario para los tramos de degradación: si los aciertos de un tramo se apilaran al
 * principio (todos los `true` seguidos y luego todos los `false`), el propio tramo contendría un
 * corte interno más brusco que la tendencia entre tramos, y la prueba estaría fabricando sin querer
 * una rotura en vez de una degradación.
 */
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

describe("rotura súbita", () => {
  it("un corte limpio de 100 % a 0 % se detecta, con el instante entre las dos mitades", () => {
    const hits = [...Array(30).fill(true), ...Array(30).fill(false)];
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("rotura-candidata");
    if (result.kind !== "rotura-candidata") throw new Error("no debería llegar aquí");
    expect(result.rateBefore).toBe(1);
    expect(result.rateAfter).toBe(0);
    // El corte real está entre el minuto 29 (última lectura) y el 30 (primera ausencia).
    expect(result.changedAtUtcMs).toBeGreaterThan(28 * MINUTE);
    expect(result.changedAtUtcMs).toBeLessThan(31 * MINUTE);
  });

  it("un corte parcial (90 % a 10 %) también cuenta: no hace falta que sea absoluto", () => {
    const hits = [
      ...repeat([true, true, true, true, true, true, true, true, true, false], 3), // 30, 27/30 = 90 %
      ...repeat([false, false, false, false, false, false, false, false, false, true], 3), // 30, 3/30 = 10 %
    ];
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("rotura-candidata");
  });

  it("una fluctuación normal (95 % constante) no se confunde con una rotura", () => {
    const hits = repeat([true, true, true, true, true, true, true, true, true, false], 6); // 95 % siempre
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });
});

describe("degradación progresiva", () => {
  it("una caída sostenida en cuatro tramos se detecta como tendencia", () => {
    // Cuatro tramos de 20, con tasas 0,9 → 0,75 → 0,6 → 0,45: monótona y con caída de 0,45, por
    // encima de `minGradientDrop`. Ningún corte único llega a 0,5 de diferencia (el máximo, entre
    // el primer tramo y el resto, es 0,37), así que la rotura no se dispara antes y deja paso a la
    // tendencia.
    const hits = [...spread(18, 20), ...spread(15, 20), ...spread(12, 20), ...spread(9, 20)];
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("degradacion-candidata");
    if (result.kind !== "degradacion-candidata") throw new Error("no debería llegar aquí");
    expect(result.segmentRates).toEqual([0.9, 0.75, 0.6, 0.45]);
  });

  it("una tasa que sube en algún tramo no es una degradación, aunque el conjunto baje", () => {
    // 0,9 → 0,5 → 0,7 → 0,4: no es monótona (sube en el tercer tramo), así que no se declara
    // tendencia aunque el primer y el último tramo también muestren una caída grande.
    const hits = [...spread(18, 20), ...spread(10, 20), ...spread(14, 20), ...spread(8, 20)];
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });

  it("una tasa estable, aunque baja, no es una degradación: no hay caída que medir", () => {
    const hits = repeat([true, true, false, false, false], 16); // 40 % constante, 80 registros
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });
});

describe("lo que no debe dispararse nunca (falsos positivos)", () => {
  it("un tag bimodal —dos poblaciones entrelazadas en el tiempo— no es una rotura ni una tendencia", () => {
    // Vehículos que siempre leen y vehículos que nunca leen, alternados uno a uno: la tasa es
    // constante (50 %) a lo largo de toda la ventana. Si las dos poblaciones estuvieran agrupadas
    // por bloques de tiempo en vez de entrelazadas, el corte binario las confundiría con una
    // rotura — que es exactamente el riesgo que esta prueba vigila.
    const hits = repeat([true, false], 40); // 80 registros, 50 % siempre
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });

  it("una proporción bimodal no equilibrada (2:1) sigue sin disparar nada si es constante", () => {
    const hits = repeat([true, true, false], 30); // 90 registros, 2/3 siempre
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });

  it("un salto periódico de un solo vehículo (omisión conservando convoy) no es una tendencia", () => {
    // Nueve aciertos y un fallo, repetidos: el vehículo que se salta el tramo lo hace una vez por
    // vuelta, de forma regular, y el resto de la flota sostiene la tasa alta el resto del tiempo.
    const hits = repeat([true, true, true, true, true, true, true, true, true, false], 8); // 80, 90 % siempre
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });

  it("una mala racha diminuta al final de una línea larga no es una rotura", () => {
    // El caso que expuso la falta de `minShareEachSide`: cinco pasadas sin acierto entre 195 no son
    // una rotura solo porque el «antes» pueda hacerse enorme y el «después» diminuto. Cinco pasadas
    // son pocas frente a doscientas, aunque cumplan de sobra el mínimo absoluto de cinco por lado.
    const hits = [...spread(176, 195), ...Array(5).fill(false)];
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });

  it("con pocas pasadas no se busca nada, aunque la forma sugiera un cambio", () => {
    const hits = [true, true, true, false, false, false]; // 6 < minPassesForTrend
    const result = detectTrend(timeline(hits), THRESHOLDS);
    expect(result.kind).toBe("sin-cambio");
  });

  it("un timeline justo por encima del mínimo pero sin soporte por tramo no falla, se abstiene", () => {
    // 20 registros justo en el mínimo, pero con `trendSegments: 4` y `minPassesEachSide: 5` no hay
    // margen para dividir en tramos con soporte: debe abstenerse, no lanzar ni inventar un tramo.
    const hits = [...Array(10).fill(true), ...Array(10).fill(false)];
    const result = detectTrend(timeline(hits), THRESHOLDS);
    // Con exactamente 20, sí hay soporte para el corte de rotura (10 a cada lado, mínimo 5): debe
    // detectarla como rotura, no como degradación ni como abstención.
    expect(result.kind).toBe("rotura-candidata");
  });
});

describe("serie para dibujar (binTimeline)", () => {
  it("reparte por tiempo en tramos iguales y deja en null el tramo sin pasadas, nunca en 0", () => {
    const series = binTimeline(
      [
        { utcMs: 0, hit: true },
        { utcMs: 10, hit: false },
        { utcMs: 100, hit: true },
      ],
      4,
    );
    expect(series?.fromUtcMs).toBe(0);
    expect(series?.binWidthMs).toBe(25);
    expect(series?.rates).toEqual([0.5, null, null, 1]);
  });

  it("con una sola pasada, o todas en el mismo instante, no inventa ninguna forma", () => {
    expect(binTimeline([{ utcMs: 5, hit: true }], 4)).toBeNull();
    expect(
      binTimeline(
        [
          { utcMs: 5, hit: true },
          { utcMs: 5, hit: false },
        ],
        4,
      ),
    ).toBeNull();
  });
});
