/**
 * Cómo reaparece un AGV tras un hueco sin lecturas (R-AGV-017).
 *
 * Lo que se fija: lo habitual es la mediana de cada tramo por turno, en la hora local del circuito,
 * sin pares del mismo instante y con respaldo a toda la ventana; volver por el tag siguiente dentro
 * de tres veces lo habitual no es un hueco, y más tarde es una parada aunque dure horas; un tag
 * saltado sale como tal aunque el tiempo sea normal; una hora o más volviendo en otro punto es
 * desconexión; fuera del anillo no hay posición que comparar; y un tag de mantenimiento manda sobre
 * todo lo demás. Ninguna salida nombra causa.
 */

import { describe, expect, it } from "vitest";

import {
  classifySilence,
  shiftIndexOfHour,
  shiftLabel,
  usualSegmentTimes,
  type SilenceContext,
  type SilenceKindThresholds,
} from "../../src/domain/silence-kind.js";

const ZONE = "Europe/Madrid";
const THRESHOLDS: SilenceKindThresholds = { factorOverUsual: 3, longAbsenceMs: 60 * 60_000, shiftStartHours: [6, 14, 22] };
const RING = ["A", "B", "C", "D", "E"];
const SECOND = 1_000;
const MINUTE = 60_000;
/** 24/09/2026 a las 08:00 en Madrid (UTC+2): turno 06–14. */
const MORNING = Date.UTC(2026, 8, 24, 6, 0);

function step(from: string, to: string, fromTime: number, durationMs: number, sameInstant = false) {
  return { from, to, fromTime, toTime: fromTime + durationMs, sameInstant };
}

/** Cada tramo del anillo recorrido `laps` veces en `durationMs`, a partir de `start`. */
function laps(start: number, laps: number, durationMs: number): ReturnType<typeof step>[] {
  const out: ReturnType<typeof step>[] = [];
  for (let lap = 0; lap < laps; lap += 1) {
    RING.forEach((tagId, index) => {
      out.push(step(tagId, RING[(index + 1) % RING.length] as string, start + lap * 10 * MINUTE + index * MINUTE, durationMs));
    });
  }
  return out;
}

function context(maintenance: readonly string[] = []): SilenceContext {
  return { usual: usualSegmentTimes(laps(MORNING, 5, 40 * SECOND), RING, ZONE, THRESHOLDS.shiftStartHours), maintenance: new Set(maintenance) };
}

function gap(lastTagBefore: string, firstTagAfter: string, durationMs: number, from = MORNING + 3 * 60 * MINUTE) {
  return { fromUtcMs: from, toUtcMs: from + durationMs, lastTagBefore, firstTagAfter };
}

describe("lo habitual de cada tramo", () => {
  it("es la mediana por turno, en la hora local, sin pares del mismo instante ni pasos que saltan un tag", () => {
    const transitions = [
      ...laps(MORNING, 3, 40 * SECOND),
      step("A", "B", MORNING, 0, true),
      step("A", "C", MORNING, 5 * SECOND),
      // 04:30 UTC son las 06:30 en Madrid: turno 06–14, no 22–06.
      step("A", "B", Date.UTC(2026, 8, 24, 4, 30), 50 * SECOND),
      // 22:30 en Madrid: turno 22–06.
      step("A", "B", Date.UTC(2026, 8, 24, 20, 30), 90 * SECOND),
    ];
    const usual = usualSegmentTimes(transitions, RING, ZONE, THRESHOLDS.shiftStartHours);
    expect(usual.byShift[0]).toEqual([40 * SECOND, null, 90 * SECOND]);
    expect(usual.overall[0]).toBe(40 * SECOND);
  });

  it("los turnos se leen como el propietario los dice", () => {
    expect(shiftIndexOfHour(3, [6, 14, 22])).toBe(2);
    expect(shiftIndexOfHour(6, [6, 14, 22])).toBe(0);
    expect(shiftLabel(2, [6, 14, 22])).toBe("22–06");
    expect(shiftLabel(0, [6, 14, 22])).toBe("06–14");
  });
});

describe("cómo reaparece el AGV", () => {
  it("vuelve por el siguiente en un tiempo que el tramo tiene a menudo: no es un hueco", () => {
    const result = classifySilence(gap("A", "B", 100 * SECOND), context(), THRESHOLDS);
    expect(result.kind).toBe("habitual");
    expect(result.detail).toMatchObject({ skipped: 0, usualMs: 40 * SECOND, shift: "06–14", nextTagId: "B" });
  });

  it("vuelve por el siguiente, más tarde de lo habitual: parado, aunque dure horas", () => {
    expect(classifySilence(gap("A", "B", 20 * MINUTE), context(), THRESHOLDS).kind).toBe("parada");
    expect(classifySilence(gap("A", "B", 3 * 60 * MINUTE), context(), THRESHOLDS).kind).toBe("parada");
    // Y vuelve por el mismo tag: estuvo ahí.
    expect(classifySilence(gap("C", "C", 20 * MINUTE), context(), THRESHOLDS).kind).toBe("parada");
  });

  it("un tag más allá es «salta-uno»; dos o más, «salta-varios», con lo habitual del recorrido entero", () => {
    const one = classifySilence(gap("A", "C", 10 * MINUTE), context(), THRESHOLDS);
    expect(one.kind).toBe("salta-uno");
    expect(one.detail).toMatchObject({ skipped: 1, usualMs: 80 * SECOND, nextTagId: "B" });
    const many = classifySilence(gap("A", "D", 10 * MINUTE), context(), THRESHOLDS);
    expect(many).toMatchObject({ kind: "salta-varios", detail: { skipped: 2 } });
    // Da la vuelta al anillo: de D a A son E en medio.
    expect(classifySilence(gap("D", "A", 10 * MINUTE), context(), THRESHOLDS).detail.skipped).toBe(1);
  });

  it("un tag saltado sale como tal aunque el tiempo sea normal: callarlo escondería la lectura que falta", () => {
    expect(classifySilence(gap("A", "C", 90 * SECOND), context(), THRESHOLDS).kind).toBe("salta-uno");
  });

  it("una hora o más y vuelve en otro punto: desconexión", () => {
    expect(classifySilence(gap("A", "D", 60 * MINUTE), context(), THRESHOLDS).kind).toBe("desconexion");
  });

  it("si la producción o el de delante estaban parados, una hora no es desconexión: se clasifica por la posición (R-AGV-018)", () => {
    const stopped = (justification: "produccion" | "cola" | "sin-explicacion") => ({ ...context(), justification });
    expect(classifySilence(gap("A", "D", 70 * MINUTE), stopped("produccion"), THRESHOLDS).kind).toBe("salta-varios");
    expect(classifySilence(gap("A", "B", 70 * MINUTE), stopped("cola"), THRESHOLDS).kind).toBe("parada");
    expect(classifySilence(gap("X", "B", 70 * MINUTE), stopped("cola"), THRESHOLDS).kind).toBe("sin-clasificar");
    // Sin nada que lo explique, la hora sigue mandando.
    expect(classifySilence(gap("A", "D", 70 * MINUTE), stopped("sin-explicacion"), THRESHOLDS).kind).toBe("desconexion");
  });

  it("fuera del anillo no hay posición que comparar: sin clasificar, o desconexión si pasa de una hora", () => {
    expect(classifySilence(gap("A", "X", 10 * MINUTE), context(), THRESHOLDS)).toMatchObject({
      kind: "sin-clasificar",
      detail: { skipped: null, usualMs: null },
    });
    expect(classifySilence(gap("X", "B", 2 * 60 * MINUTE), context(), THRESHOLDS).kind).toBe("desconexion");
    // Sin anillo del cohorte, igual.
    const none: SilenceContext = { usual: null, maintenance: new Set() };
    expect(classifySilence(gap("A", "B", 10 * MINUTE), none, THRESHOLDS).kind).toBe("sin-clasificar");
  });

  it("un tag de mantenimiento manda sobre todo lo demás", () => {
    expect(classifySilence(gap("A", "B", 20 * MINUTE), context(["B"]), THRESHOLDS).kind).toBe("mantenimiento");
    expect(classifySilence(gap("X", "A", 3 * 60 * MINUTE), context(["X"]), THRESHOLDS).kind).toBe("mantenimiento");
  });

  it("sin muestras de ese turno, lo habitual es el de toda la ventana", () => {
    // Todas las muestras son del turno de mañana; el hueco empieza a las 23:00 en Madrid.
    const night = Date.UTC(2026, 8, 24, 21, 0);
    const result = classifySilence(gap("A", "B", 100 * SECOND, night), context(), THRESHOLDS);
    expect(result).toMatchObject({ kind: "habitual", detail: { usualMs: 40 * SECOND, shift: "22–06" } });
  });
});
