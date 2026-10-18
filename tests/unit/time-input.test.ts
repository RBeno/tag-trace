/**
 * Los campos de fecha de la interfaz convierten con la misma regla que las lecturas (ADR-0013).
 *
 * Antes de 3.89.0, `cases-ui.ts` y `plan-ui.ts` convertían la hora escrita con el método iterativo
 * —suponer que la hora de pared es UTC, medir el desfase, corregir—, que en la hora repetida de
 * octubre converge siempre a la segunda ocurrencia (01:30Z para las 02:30) mientras el dominio
 * conserva la primera (00:30Z) y la marca. Esta prueba fija que haya una sola respuesta.
 */
import { describe, expect, it } from "vitest";
import { wallClockToUtc } from "../../src/domain/time.js";
import { fromDateTimeInput, isoDay, toDateTimeInput, zoneMidnight } from "../../src/presentation/time-input.js";

const ZONE = "Europe/Madrid";

describe("time-input · los campos de fecha convierten como el dominio (TC-373)", () => {
  it("la hora repetida de octubre es la primera ocurrencia, la misma que decide el dominio", () => {
    const written = "2026-10-25T02:30";
    const domain = wallClockToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 }, ZONE);
    expect(domain.flag).toBe("dst_ambiguous");
    expect(fromDateTimeInput(written, ZONE)).toBe(domain.utcMs);
    expect(fromDateTimeInput(written, ZONE)).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it("la hora inexistente de marzo cae donde terminó el salto", () => {
    const domain = wallClockToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 }, ZONE);
    expect(domain.flag).toBe("dst_nonexistent");
    expect(fromDateTimeInput("2026-03-29T02:30", ZONE)).toBe(domain.utcMs);
  });

  it("una hora normal va y vuelve, con y sin segundos", () => {
    const instant = Date.UTC(2026, 0, 27, 9, 5, 7);
    expect(toDateTimeInput(instant, ZONE)).toBe("2026-01-27T10:05:07");
    expect(toDateTimeInput(instant, ZONE, "minutes")).toBe("2026-01-27T10:05");
    expect(fromDateTimeInput("2026-01-27T10:05:07", ZONE)).toBe(instant);
    expect(fromDateTimeInput("2026-01-27T10:05", ZONE)).toBe(instant - 7_000);
  });

  it("la medianoche de un día es la de la zona, también el día del cambio de hora", () => {
    expect(zoneMidnight("2026-10-25", ZONE)).toBe(Date.UTC(2026, 9, 24, 22, 0));
    expect(zoneMidnight("2026-07-01", ZONE)).toBe(Date.UTC(2026, 5, 30, 22, 0));
    expect(isoDay(Date.UTC(2026, 9, 24, 22, 30), ZONE)).toBe("2026-10-25");
  });

  it("lo que no es una fecha es null, no una fecha inventada", () => {
    expect(fromDateTimeInput("", ZONE)).toBeNull();
    expect(fromDateTimeInput("ayer", ZONE)).toBeNull();
    expect(zoneMidnight("2026-10", ZONE)).toBeNull();
  });
});
