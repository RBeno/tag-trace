/**
 * Los estimadores de los valores de planta y la regla de coincidencia (OQ-151, propietario 2026-09-27:
 * «usa la propuesta pero si no coinciden que los valores los introduzca una persona»).
 *
 * Lo que se fija, con medidas sintéticas conocidas: cada estimador da el valor que su definición dice
 * —redondeado a la unidad del valor— y `null` con su porqué cuando el fichero no permite estimar, nunca
 * la hipótesis más probable; `measurePlantValues` recorta a la ventana del fichero lo que ya analizó el
 * Worker sin medir nada nuevo; la regla propone solo si las últimas tres versiones no revocadas estiman
 * lo mismo; y una propuesta confirmada se escribe con `origin: "propuesta"`, recalculada, nunca sola.
 */

import { describe, expect, it } from "vitest";

import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";
import type { ConsolidatedVersion } from "../../src/domain/memory.js";
import {
  estimatePlantValue,
  measurePlantValues,
  plantValueEventFor,
  plantValueEventProblem,
  plantValuesView,
  proposePlantValues,
  type PlantMeasureInput,
  type PlantValueEvent,
} from "../../src/domain/plant-values.js";
import type { CircuitSnapshot, SnapshotPlantMeasures } from "../../src/domain/snapshot.js";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
const THRESHOLDS = { sustainedFiles: PROVISIONAL_CONFIG.changeClass.sustainedFiles, config: PROVISIONAL_CONFIG };

/** Medidas vacías de un fichero de un día que cubre las 24 horas: nada estima nada salvo lo que se ponga. */
function measures(over: Partial<SnapshotPlantMeasures> = {}): SnapshotPlantMeasures {
  return {
    hourly: { readings: new Array<number>(24).fill(0), coveredMs: new Array<number>(24).fill(HOUR) },
    days: 1,
    productionStops: [],
    returnGaps: { n: 0, valueMs: null },
    headWaits: { n: 0, valueMs: null },
    loadedSpans: null,
    precisePauses: { declared: 0, measurable: true, n: 0, valueMs: null },
    ...over,
  };
}

/** Un perfil con 1.000 lecturas por hora salvo en `low`, que tienen 100. */
function profile(low: readonly number[]): SnapshotPlantMeasures["hourly"] {
  return {
    readings: Array.from({ length: 24 }, (_, hour) => (low.includes(hour) ? 100 : 1000)),
    coveredMs: new Array<number>(24).fill(HOUR),
  };
}

const NIGHT_21_TO_6 = [21, 22, 23, 0, 1, 2, 3, 4, 5];

function version(number: number, plantMeasures: SnapshotPlantMeasures | undefined, revoked = false): ConsolidatedVersion {
  const snapshot = { fileName: `periodo-${number}.csv`, ...(plantMeasures === undefined ? {} : { plantMeasures }) } as unknown as CircuitSnapshot;
  return {
    version: number,
    createdAt: number * DAY,
    revoked: revoked ? { at: number * DAY + 1, reason: "revocada en la prueba" } : null,
    snapshot,
  } as unknown as ConsolidatedVersion;
}

describe("estimatePlantValue · régimen de noche", () => {
  it("las horas seguidas por debajo de la mitad de la mediana de producción dan el inicio y el fin", () => {
    const m = measures({ hourly: profile(NIGHT_21_TO_6) });
    expect(estimatePlantValue("noche-desde", m, PROVISIONAL_CONFIG).value).toBe(21);
    expect(estimatePlantValue("noche-hasta", m, PROVISIONAL_CONFIG).value).toBe(6);
  });

  it("se mide por hora cubierta: una hora cubierta a medias con la mitad de lecturas no es noche", () => {
    const hourly = profile(NIGHT_21_TO_6);
    const readings = [...hourly.readings];
    const coveredMs = [...hourly.coveredMs];
    readings[12] = 500;
    coveredMs[12] = HOUR / 2;
    // Además cubierta dos veces entera (dos días): 2.000 lecturas en 2 h siguen siendo 1.000 por hora.
    readings[13] = 2000;
    coveredMs[13] = 2 * HOUR;
    const m = measures({ hourly: { readings, coveredMs } });
    expect(m.hourly.coveredMs[12]).toBeLessThan(HOUR);
    // La hora 12 no está cubierta entera: el fichero no permite estimar, no se completa.
    const partial = estimatePlantValue("noche-desde", m, PROVISIONAL_CONFIG);
    expect(partial.value).toBeNull();
    expect(partial.why).toMatch(/no cubre entera cada hora/);
    coveredMs[12] = HOUR;
    readings[12] = 1000;
    expect(estimatePlantValue("noche-desde", measures({ hourly: { readings, coveredMs } }), PROVISIONAL_CONFIG).value).toBe(21);
  });

  it("sin horas bajas, o con dos tramos bajos igual de largos, no estima", () => {
    const flat = estimatePlantValue("noche-desde", measures({ hourly: profile([]) }), PROVISIONAL_CONFIG);
    expect(flat.value).toBeNull();
    expect(flat.why).toMatch(/ninguna hora baja/);
    const twice = estimatePlantValue("noche-hasta", measures({ hourly: profile([2, 3, 14, 15]) }), PROVISIONAL_CONFIG);
    expect(twice.value).toBeNull();
    expect(twice.why).toMatch(/igual de largos/);
  });
});

describe("estimatePlantValue · paradas de la producción que se repiten", () => {
  const stops: SnapshotPlantMeasures["productionStops"] = [
    { day: "2026-01-24", minute: 13 * 60 + 58, sameTimeAs: [1] },
    { day: "2026-01-25", minute: 14 * 60 + 3, sameTimeAs: [0] },
    { day: "2026-01-24", minute: 23 * 60 + 50, sameTimeAs: [3] },
    { day: "2026-01-25", minute: 6, sameTimeAs: [2] },
    // No se repite: no dice nada de los turnos.
    { day: "2026-01-24", minute: 10 * 60 + 20, sameTimeAs: [] },
  ];

  it("las horas de arranque son el inicio de las que se repiten, redondeado a la hora, como conjunto", () => {
    const estimate = estimatePlantValue("arranque-turnos", measures({ days: 2, productionStops: stops }), PROVISIONAL_CONFIG);
    // 13:58 y 14:03 → 14:00; 23:50 y 00:06 cruzan la medianoche → 23:58 → 00:00.
    expect(estimate.value).toEqual([0, 14]);
  });

  it("la tolerancia es la mayor diferencia de hora entre repeticiones, en minutos", () => {
    const estimate = estimatePlantValue("misma-hora", measures({ days: 2, productionStops: stops }), PROVISIONAL_CONFIG);
    expect(estimate.value).toBe(16 * MINUTE);
  });

  it("un fichero de un solo día no permite estimar ninguno de los dos, aunque traiga paradas", () => {
    for (const key of ["arranque-turnos", "misma-hora"] as const) {
      const estimate = estimatePlantValue(key, measures({ days: 1, productionStops: stops }), PROVISIONAL_CONFIG);
      expect(estimate.value).toBeNull();
      expect(estimate.why).toMatch(/un solo día/);
    }
  });

  it("sin paradas que se repitan no hay horas de turno, y repetir en el mismo minuto no da una tolerancia de cero", () => {
    const none = estimatePlantValue("arranque-turnos", measures({ days: 2, productionStops: [stops[4] as (typeof stops)[number]] }), PROVISIONAL_CONFIG);
    expect(none.value).toBeNull();
    expect(none.why).toMatch(/ninguna parada/);
    const exact: SnapshotPlantMeasures["productionStops"] = [
      { day: "2026-01-24", minute: 600, sameTimeAs: [1] },
      { day: "2026-01-25", minute: 600, sameTimeAs: [0] },
    ];
    const zero = estimatePlantValue("misma-hora", measures({ days: 2, productionStops: exact }), PROVISIONAL_CONFIG);
    expect(zero.value).toBeNull();
    expect(zero.why).toMatch(/mayor que cero/);
    expect(estimatePlantValue("arranque-turnos", measures({ days: 2, productionStops: exact }), PROVISIONAL_CONFIG).value).toEqual([10]);
  });
});

describe("estimatePlantValue · percentiles", () => {
  const minSamples = PROVISIONAL_CONFIG.bands.minBandSamples;

  it("desconexión: el percentil 99 de los huecos que volvieron, redondeado a minutos; con pocos, no", () => {
    expect(estimatePlantValue("desconexion", measures({ returnGaps: { n: minSamples, valueMs: 3_700_000 } }), PROVISIONAL_CONFIG).value).toBe(62 * MINUTE);
    const few = estimatePlantValue("desconexion", measures({ returnGaps: { n: minSamples - 1, valueMs: 3_700_000 } }), PROVISIONAL_CONFIG);
    expect(few.value).toBeNull();
    expect(few.why).toMatch(/hacen falta/);
    expect(estimatePlantValue("desconexion", measures(), PROVISIONAL_CONFIG).why).toMatch(/no hay huecos/);
  });

  it("bloqueo del primero de cola: el percentil 95 de sus esperas, redondeado a minutos", () => {
    expect(estimatePlantValue("bloqueo-cabeza", measures({ headWaits: { n: 40, valueMs: 140_000 } }), PROVISIONAL_CONFIG).value).toBe(2 * MINUTE);
    // Redondeado a minutos da 0: no vale como duración y no se propone.
    const zero = estimatePlantValue("bloqueo-cabeza", measures({ headWaits: { n: 40, valueMs: 20_000 } }), PROVISIONAL_CONFIG);
    expect(zero.value).toBeNull();
    expect(zero.why).toMatch(/mayor que cero/);
  });

  it("margen del FIFO: percentil 95 menos mediana del tránsito, el del tramo cargado que más varía", () => {
    const loadedSpans = [
      { spanId: "cargado-1", passes: 10, medianTransitMs: 250_000, p95TransitMs: 420_000 },
      { spanId: "cargado-2", passes: 10, medianTransitMs: 200_000, p95TransitMs: 260_000 },
    ];
    expect(estimatePlantValue("margen-fifo", measures({ loadedSpans }), PROVISIONAL_CONFIG).value).toBe(3 * MINUTE);
    expect(estimatePlantValue("margen-fifo", measures({ loadedSpans: null }), PROVISIONAL_CONFIG).why).toMatch(/lista «zona»/);
    expect(estimatePlantValue("margen-fifo", measures({ loadedSpans: [] }), PROVISIONAL_CONFIG).value).toBeNull();
  });

  it("parada precisa: el percentil 5 de las esperas en las declaradas, redondeado a segundos", () => {
    const pauses = { declared: 2, measurable: true, n: 12, valueMs: 31_400 };
    expect(estimatePlantValue("parada-precisa-minima", measures({ precisePauses: pauses }), PROVISIONAL_CONFIG).value).toBe(31_000);
    expect(estimatePlantValue("parada-precisa-minima", measures({ precisePauses: { ...pauses, declared: 0 } }), PROVISIONAL_CONFIG).why).toMatch(/no hay paradas precisas declaradas/);
    expect(estimatePlantValue("parada-precisa-minima", measures({ precisePauses: { ...pauses, measurable: false } }), PROVISIONAL_CONFIG).why).toMatch(/al minuto/);
    const few = { ...pauses, n: PROVISIONAL_CONFIG.criticalPoints.paradaPrecisa.minSamples - 1 };
    expect(estimatePlantValue("parada-precisa-minima", measures({ precisePauses: few }), PROVISIONAL_CONFIG).value).toBeNull();
  });
});

describe("measurePlantValues · recorta a la ventana del fichero lo que ya se analizó", () => {
  it("cobertura por hora, paradas con sus repeticiones dentro del fichero, huecos y esperas en la ventana", () => {
    const from = Date.UTC(2026, 0, 24, 8, 0);
    const window = { from, to: from + 90 * MINUTE };
    const input: PlantMeasureInput = {
      window,
      zone: "UTC",
      estimators: PROVISIONAL_CONFIG.plantEstimators,
      hourly: { counts: Array.from({ length: 24 }, (_, hour) => hour), days: 1 },
      productionStops: [
        { fromUtcMs: from + 10 * MINUTE, toUtcMs: from + 20 * MINUTE, sameTimeOn: [from + 30 * MINUTE, from - DAY] },
        { fromUtcMs: from + 30 * MINUTE, toUtcMs: from + 40 * MINUTE, sameTimeOn: [from + 10 * MINUTE] },
        { fromUtcMs: from - DAY, toUtcMs: from - DAY + 10 * MINUTE, sameTimeOn: [from + 10 * MINUTE] },
      ],
      gaps: [
        { fromUtcMs: from, toUtcMs: from + 5 * MINUTE, durationMs: 5 * MINUTE, cause: "silencio" },
        { fromUtcMs: from, toUtcMs: from + 50 * MINUTE, durationMs: 50 * MINUTE, cause: "carga-online" },
        { fromUtcMs: from - HOUR, toUtcMs: from + MINUTE, durationMs: HOUR + MINUTE, cause: "silencio" },
      ],
      vehicleStops: [
        { fromTagId: "A", toTagId: "B", fromUtcMs: from, toUtcMs: from + MINUTE, excessMs: 40_000, justification: "sin-explicacion" },
        { fromTagId: "A", toTagId: "A", fromUtcMs: from, toUtcMs: from + MINUTE, excessMs: 90_000, justification: "sin-explicacion" },
        { fromTagId: "A", toTagId: "B", fromUtcMs: from, toUtcMs: from + MINUTE, excessMs: 70_000, justification: "cola" },
      ],
      loadedSpans: [
        { spanId: "cargado-1", passes: 3, medianTransitMs: 100, p95TransitMs: 150 },
        { spanId: "cargado-2", passes: 1, medianTransitMs: null, p95TransitMs: null },
      ],
      precisePauses: { declared: 1, measurable: false, durationsMs: [30_000, 31_000] },
    };
    const out = measurePlantValues(input);
    expect(out.hourly.readings).toEqual(input.hourly.counts);
    expect(out.hourly.coveredMs[8]).toBe(HOUR);
    expect(out.hourly.coveredMs[9]).toBe(30 * MINUTE);
    expect(out.hourly.coveredMs.reduce((sum, ms) => sum + ms, 0)).toBe(90 * MINUTE);
    // La del día anterior no es de este fichero: ni está ni cuenta como repetición.
    expect(out.productionStops).toEqual([
      { day: "2026-01-24", minute: 8 * 60 + 10, sameTimeAs: [1] },
      { day: "2026-01-24", minute: 8 * 60 + 30, sameTimeAs: [0] },
    ]);
    expect(out.returnGaps).toEqual({ n: 1, valueMs: 5 * MINUTE });
    expect(out.headWaits).toEqual({ n: 1, valueMs: 40_000 });
    expect(out.loadedSpans).toEqual([{ spanId: "cargado-1", passes: 3, medianTransitMs: 100, p95TransitMs: 150 }]);
    // Con la hora al minuto no se miden esperas: ninguna muestra.
    expect(out.precisePauses).toEqual({ declared: 1, measurable: false, n: 0, valueMs: null });
  });

  it("los cuantiles son los de la configuración, no del código: con otros, otra medida", () => {
    const base: PlantMeasureInput = {
      window: { from: 0, to: HOUR },
      zone: "UTC",
      estimators: PROVISIONAL_CONFIG.plantEstimators,
      hourly: { counts: new Array<number>(24).fill(0), days: 1 },
      productionStops: [],
      gaps: Array.from({ length: 100 }, (_, index) => ({ fromUtcMs: 0, toUtcMs: (index + 1) * MINUTE, durationMs: (index + 1) * MINUTE, cause: "silencio" })),
      vehicleStops: [],
      loadedSpans: null,
      precisePauses: { declared: 0, measurable: true, durationsMs: [] },
    };
    const p99 = measurePlantValues(base).returnGaps.valueMs;
    const p50 = measurePlantValues({ ...base, estimators: { ...base.estimators, returnGapQuantile: 0.5 } }).returnGaps.valueMs;
    expect(p99).not.toBeNull();
    expect(p50).not.toBeNull();
    expect(p50 as number).toBeLessThan(p99 as number);
  });

  it("en el día del cambio de hora (Europe/Madrid, sintético) falta una hora local: la noche no se estima y lo dice", () => {
    // 2026-03-29: a las 02:00 CET los relojes pasan a las 03:00 CEST. Un día local entero son 23 horas.
    const from = Date.UTC(2026, 2, 28, 23, 0); // 00:00 del 29 en Madrid
    const to = Date.UTC(2026, 2, 29, 22, 0); // 00:00 del 30 en Madrid
    const out = measurePlantValues({
      window: { from, to },
      zone: "Europe/Madrid",
      estimators: PROVISIONAL_CONFIG.plantEstimators,
      hourly: { counts: Array.from({ length: 24 }, (_, hour) => (NIGHT_21_TO_6.includes(hour) ? 100 : 1000)), days: 1 },
      productionStops: [],
      gaps: [],
      vehicleStops: [],
      loadedSpans: null,
      precisePauses: { declared: 0, measurable: true, durationsMs: [] },
    });
    expect(out.hourly.coveredMs[2]).toBe(0);
    expect(out.hourly.coveredMs.reduce((sum, ms) => sum + ms, 0)).toBe(23 * HOUR);
    const estimate = estimatePlantValue("noche-desde", out, PROVISIONAL_CONFIG);
    expect(estimate.value).toBeNull();
    expect(estimate.why).toMatch(/no cubre entera cada hora del día \(le faltan 1 hora\)/);
  });
});

describe("estimatePlantValue · lo que hereda de la configuración vigente lo dice (OQ-154)", () => {
  const stops: SnapshotPlantMeasures["productionStops"] = [
    { day: "2026-01-24", minute: 13 * 60 + 58, sameTimeAs: [1] },
    { day: "2026-01-25", minute: 14 * 60 + 3, sameTimeAs: [0] },
  ];

  it("«a la misma hora» y las horas de turno dicen la tolerancia vigente con que se emparejaron las repeticiones", () => {
    const tolerance = estimatePlantValue("misma-hora", measures({ days: 2, productionStops: stops }), PROVISIONAL_CONFIG);
    expect(tolerance.value).toBe(5 * MINUTE);
    expect(tolerance.why).toMatch(/tolerancia vigente de 15 min/);
    expect(tolerance.why).toMatch(/no puede salir un valor mayor/);
    expect(estimatePlantValue("arranque-turnos", measures({ days: 2, productionStops: stops }), PROVISIONAL_CONFIG).why).toMatch(/tolerancia vigente de 15 min/);
    expect(estimatePlantValue("misma-hora", measures({ days: 2 }), PROVISIONAL_CONFIG).why).toMatch(/tolerancia vigente de 15 min/);
  });

  it("la noche dice frente a qué noche vigente se midió la mediana de producción", () => {
    const night = estimatePlantValue("noche-desde", measures({ hourly: profile(NIGHT_21_TO_6) }), PROVISIONAL_CONFIG);
    expect(night.why).toMatch(/noche vigente, 22:00–05:00/);
  });

  it("los percentiles de los estimadores salen de la configuración", () => {
    const gaps = measures({ returnGaps: { n: 30, valueMs: 61 * MINUTE } });
    expect(estimatePlantValue("desconexion", gaps, PROVISIONAL_CONFIG).why).toMatch(/^percentil 99 de 30/);
    const other = { ...PROVISIONAL_CONFIG, plantEstimators: { ...PROVISIONAL_CONFIG.plantEstimators, returnGapQuantile: 0.9 } };
    expect(estimatePlantValue("desconexion", gaps, other).why).toMatch(/^percentil 90 de 30/);
  });
});

describe("proposePlantValues · la regla de coincidencia", () => {
  const same = measures({ hourly: profile(NIGHT_21_TO_6) });

  it("si las tres últimas versiones estiman lo mismo, se propone y se dice en cuáles", () => {
    const out = proposePlantValues([version(4, same), version(5, same), version(6, same)], THRESHOLDS);
    expect(out["noche-desde"].proposal).toBe(21);
    expect(out["noche-desde"].outcome).toBe("coinciden");
    expect(out["noche-desde"].reason).toBe("coincide en v4, v5 y v6");
    expect(out["noche-hasta"].proposal).toBe(6);
    expect(out["noche-desde"].estimates.map((estimate) => [estimate.version, estimate.value])).toEqual([
      [4, 21],
      [5, 21],
      [6, 21],
    ]);
    // Lo que ninguna versión permite estimar no se propone.
    expect(out.desconexion.proposal).toBeNull();
  });

  it("si no coinciden, no se propone nada y se enseña la estimación de cada una", () => {
    const other = measures({ hourly: profile([22, 23, 0, 1, 2, 3, 4, 5]) });
    const out = proposePlantValues([version(4, same), version(5, other), version(6, same)], THRESHOLDS);
    expect(out["noche-desde"].proposal).toBeNull();
    expect(out["noche-desde"].outcome).toBe("no-coinciden");
    expect(out["noche-desde"].reason).toBe("las estimaciones no coinciden");
    expect(out["noche-desde"].estimates.map((estimate) => estimate.value)).toEqual([21, 22, 21]);
    // El fin coincide en las tres: ese sí se propone.
    expect(out["noche-hasta"].proposal).toBe(6);
  });

  it("si una versión no permite estimar (instantánea sin medidas, o sin datos), no hay propuesta", () => {
    const out = proposePlantValues([version(4, same), version(5, undefined), version(6, same)], THRESHOLDS);
    expect(out["noche-desde"].proposal).toBeNull();
    expect(out["noche-desde"].estimates[1]).toMatchObject({ version: 5, value: null });
    expect(out["noche-desde"].estimates[1]?.why).toMatch(/anterior a las medidas/);
    expect(out["noche-desde"].reason).toBe("no todas las versiones permiten estimarlo");
    expect(out.desconexion.reason).toBe("ninguna versión permite estimarlo");
    const partial = measures({ hourly: { ...profile(NIGHT_21_TO_6), coveredMs: new Array<number>(24).fill(0) } });
    expect(proposePlantValues([version(4, same), version(5, partial), version(6, same)], THRESHOLDS)["noche-desde"].proposal).toBeNull();
  });

  it("con menos de tres versiones no revocadas no se propone, aunque coincidan", () => {
    const out = proposePlantValues([version(1, same), version(2, same)], THRESHOLDS);
    expect(out["noche-desde"].proposal).toBeNull();
    expect(out["noche-desde"].outcome).toBe("faltan-versiones");
    expect(out["noche-desde"].reason).toBe("hacen falta 3 versiones consolidadas no revocadas y hay 2");
    expect(proposePlantValues([], THRESHOLDS)["noche-desde"].reason).toMatch(/no hay ninguna/);
  });

  it("con todas las versiones revocadas, o con una sola, faltan versiones y no hay propuesta", () => {
    const revoked = proposePlantValues([version(1, same, true), version(2, same, true), version(3, same, true)], THRESHOLDS);
    expect(revoked["noche-desde"]).toMatchObject({ proposal: null, outcome: "faltan-versiones", estimates: [] });
    expect(revoked["noche-desde"].reason).toMatch(/no hay ninguna/);
    const single = proposePlantValues([version(1, same)], THRESHOLDS);
    expect(single["noche-desde"]).toMatchObject({ proposal: null, outcome: "faltan-versiones" });
    expect(single["noche-desde"].reason).toBe("hacen falta 3 versiones consolidadas no revocadas y hay 1");
    expect(single["noche-desde"].estimates.map((estimate) => [estimate.version, estimate.value])).toEqual([[1, 21]]);
  });

  it("una versión revocada no cuenta: ni para coincidir ni para romper la coincidencia", () => {
    const other = measures({ hourly: profile([22, 23, 0, 1, 2, 3, 4, 5]) });
    // v4 revocada y distinta: se miran v1, v2 y v3, que coinciden.
    const out = proposePlantValues([version(1, same), version(2, same), version(3, same), version(4, other, true)], THRESHOLDS);
    expect(out["noche-desde"].proposal).toBe(21);
    expect(out["noche-desde"].estimates.map((estimate) => estimate.version)).toEqual([1, 2, 3]);
    // Con v2 revocada solo quedan dos: no hay propuesta.
    const short = proposePlantValues([version(1, same), version(2, same, true), version(3, same)], THRESHOLDS);
    expect(short["noche-desde"].outcome).toBe("faltan-versiones");
  });

  it("solo miran las tres últimas: una versión antigua distinta no impide la propuesta", () => {
    const other = measures({ hourly: profile([22, 23, 0, 1, 2, 3, 4, 5]) });
    const out = proposePlantValues([version(1, other), version(2, same), version(3, same), version(4, same)], THRESHOLDS);
    expect(out["noche-desde"].proposal).toBe(21);
    expect(out["noche-desde"].reason).toBe("coincide en v2, v3 y v4");
  });

  it("las horas de turno se comparan como conjunto", () => {
    const stops = (order: number): SnapshotPlantMeasures["productionStops"] =>
      order === 0
        ? [
            { day: "2026-01-24", minute: 6 * 60, sameTimeAs: [1] },
            { day: "2026-01-25", minute: 6 * 60, sameTimeAs: [0] },
            { day: "2026-01-24", minute: 14 * 60, sameTimeAs: [3] },
            { day: "2026-01-25", minute: 14 * 60, sameTimeAs: [2] },
          ]
        : [
            { day: "2026-01-24", minute: 14 * 60, sameTimeAs: [1] },
            { day: "2026-01-25", minute: 14 * 60 + 2, sameTimeAs: [0] },
            { day: "2026-01-24", minute: 6 * 60 + 1, sameTimeAs: [3] },
            { day: "2026-01-25", minute: 5 * 60 + 59, sameTimeAs: [2] },
          ];
    const out = proposePlantValues(
      [0, 1, 0].map((order, index) => version(index + 1, measures({ days: 2, productionStops: stops(order) }))),
      THRESHOLDS,
    );
    expect(out["arranque-turnos"].proposal).toEqual([6, 14]);
  });
});

describe("confirmar una propuesta · siempre una persona con razón, con origen `propuesta`", () => {
  const same = measures({ hourly: profile(NIGHT_21_TO_6) });
  const proposals = proposePlantValues([version(4, same), version(5, same), version(6, same)], THRESHOLDS);
  const request = { key: "noche-desde", value: 21, effectiveAt: 5 * DAY, reason: "La memoria lo mide igual en tres periodos", origin: "propuesta" as const };

  it("la propuesta confirmada lleva `origin: \"propuesta\"`, el valor propuesto y las versiones en que coincidió", () => {
    const built = plantValueEventFor({ circuitId: "c1", events: [], request, recordedAt: 7 * DAY, proposal: proposals["noche-desde"] });
    expect("event" in built).toBe(true);
    const event = (built as { event: PlantValueEvent }).event;
    expect(event).toEqual({
      circuitId: "c1",
      seq: 1,
      key: "noche-desde",
      value: 21,
      effectiveAt: 5 * DAY,
      recordedAt: 7 * DAY,
      reason: "La memoria lo mide igual en tres periodos",
      origin: "propuesta",
      fromVersions: [4, 5, 6],
    });
    // Y se guarda y viaja: la forma del evento vale.
    expect(plantValueEventProblem(event)).toBeNull();
  });

  it("sin razón, sin propuesta de ahora o con otro valor no se escribe nada", () => {
    expect(plantValueEventFor({ circuitId: "c1", events: [], request: { ...request, reason: "  " }, recordedAt: 0, proposal: proposals["noche-desde"] })).toMatchObject({
      cause: expect.stringMatching(/razón/),
    });
    expect(plantValueEventFor({ circuitId: "c1", events: [], request, recordedAt: 0, proposal: null })).toMatchObject({ cause: expect.stringMatching(/ya no propone/) });
    expect(plantValueEventFor({ circuitId: "c1", events: [], request, recordedAt: 0, proposal: proposals.desconexion })).toMatchObject({ cause: expect.stringMatching(/ya no propone/) });
    expect(plantValueEventFor({ circuitId: "c1", events: [], request: { ...request, value: 20 }, recordedAt: 0, proposal: proposals["noche-desde"] })).toMatchObject({
      cause: expect.stringMatching(/ha cambiado/),
    });
  });

  it("a mano, el origen es `manual` aunque haya propuesta, y sin versiones de origen", () => {
    const built = plantValueEventFor({ circuitId: "c1", events: [], request: { ...request, value: 20, origin: "manual" }, recordedAt: 0, proposal: proposals["noche-desde"] });
    const event = (built as { event: PlantValueEvent }).event;
    expect(event.origin).toBe("manual");
    expect(event.value).toBe(20);
    expect(event.fromVersions).toBeUndefined();
  });

  it("la vista lleva la propuesta de cada valor, y sin propuestas calculadas, `null`", () => {
    const view = plantValuesView({ events: [], provisional: PROVISIONAL_CONFIG, at: DAY, fileName: "f.csv", window: null, canConfirm: true, proposals });
    expect(view.values.find((entry) => entry.key === "noche-desde")?.proposal?.proposal).toBe(21);
    const bare = plantValuesView({ events: [], provisional: PROVISIONAL_CONFIG, at: DAY, fileName: "f.csv", window: null, canConfirm: true });
    expect(bare.values.every((entry) => entry.proposal === null)).toBe(true);
  });
});
