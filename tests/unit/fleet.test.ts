/**
 * La flota a lo largo del tiempo (R-AGV-014, R-AGV-015): tramos de cada AGV y recuento N de M.
 *
 * Lo que se fija: un asignado sin lecturas es ausente, no silencio; un hueco de cobertura es sin
 * datos y nunca cuenta; la carga cuenta como en funcionamiento y el silencio no; quien lee sin estar
 * asignado sale aparte y no suma a N; una baja a mitad de ventana baja M desde ese instante; y el
 * rato antes de la primera lectura o después de la última solo es ausencia si pasa del umbral de
 * silencio — si no, el peor momento de la ventana sería siempre su borde.
 */

import { describe, expect, it } from "vitest";

import { buildFleetTimeline, type FleetInput, type FleetState } from "../../src/domain/fleet.js";
import type { Reading } from "../../src/domain/reading.js";

const MINUTE = 60_000;

function read(agvId: string, minute: number): Reading {
  const utcMs = minute * MINUTE;
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId: "1",
    provenance: { sourceId: "s", sourceHash: "h", sourceRow: 1 },
  };
}

/** Lecturas de un AGV cada minuto entre dos minutos, ambos incluidos. */
function every(agvId: string, from: number, to: number): Reading[] {
  return Array.from({ length: to - from + 1 }, (_, index) => read(agvId, from + index));
}

function input(partial: Partial<FleetInput>): FleetInput {
  return {
    readings: [],
    coverage: [{ from: 0, to: 60 * MINUTE }],
    history: null,
    inactivity: new Map(),
    coldStarts: new Map(),
    minGapMs: 5 * MINUTE,
    ...partial,
  };
}

function stateAt(timeline: ReturnType<typeof buildFleetTimeline>, agvId: string, minute: number): FleetState | undefined {
  const t = minute * MINUTE;
  return timeline.vehicles
    .find((vehicle) => vehicle.agvId === agvId)
    ?.segments.find((segment) => t >= segment.fromUtcMs && t < segment.toUtcMs)?.state;
}

function countAt(timeline: ReturnType<typeof buildFleetTimeline>, minute: number): string {
  const t = minute * MINUTE;
  const entry = timeline.counts.find((count) => t >= count.fromUtcMs && t < count.toUtcMs);
  return entry === undefined ? "sin recuento" : `${entry.inService} de ${entry.assigned} (+${entry.unassignedActive})`;
}

const all = (agvId: string) => ({ agvId, fromUtcMs: -1_000 * MINUTE, toUtcMs: null, note: "" });

describe("vida de cada AGV (buildFleetTimeline)", () => {
  it("un asignado que no lee nunca está ausente toda la ventana, y cuenta en M pero no en N", () => {
    const timeline = buildFleetTimeline(
      input({ readings: every("A", 0, 60), history: [all("A"), all("B")] }),
    );
    expect(stateAt(timeline, "B", 30)).toBe("ausente");
    expect(countAt(timeline, 30)).toBe("1 de 2 (+0)");
  });

  it("tres asignados con uno en silencio dan 2 de 3 exactamente en ese intervalo", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 60), ...every("B", 0, 60), ...every("C", 0, 20), ...every("C", 40, 60)],
        history: [all("A"), all("B"), all("C")],
        inactivity: new Map([["C", [{ fromUtcMs: 20 * MINUTE, toUtcMs: 40 * MINUTE, cause: "silencio" as const }]]]),
      }),
    );
    expect(stateAt(timeline, "C", 30)).toBe("silencio");
    expect(countAt(timeline, 10)).toBe("3 de 3 (+0)");
    expect(countAt(timeline, 30)).toBe("2 de 3 (+0)");
    expect(countAt(timeline, 50)).toBe("3 de 3 (+0)");
  });

  it("la carga cuenta como en funcionamiento; el arranque en frío es carga hasta su salida", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 20), ...every("A", 50, 60), ...every("B", 15, 60)],
        history: [all("A"), all("B")],
        inactivity: new Map([["A", [{ fromUtcMs: 20 * MINUTE, toUtcMs: 50 * MINUTE, cause: "carga-online" as const }]]]),
        coldStarts: new Map([["B", 15 * MINUTE]]),
      }),
    );
    expect(stateAt(timeline, "A", 30)).toBe("carga");
    expect(stateAt(timeline, "B", 5)).toBe("carga");
    expect(countAt(timeline, 30)).toBe("2 de 2 (+0)");
  });

  it("un hueco de cobertura es sin datos, nunca silencio, y no tiene recuento", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 20), ...every("A", 40, 60)],
        coverage: [
          { from: 0, to: 20 * MINUTE },
          { from: 40 * MINUTE, to: 60 * MINUTE },
        ],
        history: [all("A")],
        inactivity: new Map([["A", [{ fromUtcMs: 20 * MINUTE, toUtcMs: 40 * MINUTE, cause: "silencio" as const }]]]),
      }),
    );
    expect(stateAt(timeline, "A", 30)).toBe("sin-datos");
    expect(countAt(timeline, 30)).toBe("sin recuento");
  });

  it("antes de la primera lectura y después de la última, solo es ausencia si pasa del umbral de silencio", () => {
    const timeline = buildFleetTimeline(
      input({ readings: [...every("A", 2, 57), ...every("B", 20, 60)], history: [all("A"), all("B")] }),
    );
    // A empieza a leer a los 2 min y acaba a los 57: ritmo normal, en funcionamiento de borde a borde.
    expect(stateAt(timeline, "A", 1)).toBe("leyendo");
    expect(stateAt(timeline, "A", 59)).toBe("leyendo");
    // B tarda 20 min en leer por primera vez: eso sí es ausencia.
    expect(stateAt(timeline, "B", 10)).toBe("ausente");
    expect(countAt(timeline, 1)).toBe("1 de 2 (+0)");
  });

  it("un silencio que cruza un hueco de cobertura no deja trozos de silencio en sus bordes", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 18), ...every("A", 42, 60)],
        coverage: [
          { from: 0, to: 20 * MINUTE },
          { from: 40 * MINUTE, to: 60 * MINUTE },
        ],
        history: [all("A")],
        // El expediente todavía cuenta este hueco como inactividad (anotado en `[3.17.0]`).
        inactivity: new Map([["A", [{ fromUtcMs: 18 * MINUTE, toUtcMs: 42 * MINUTE, cause: "silencio" as const }]]]),
      }),
    );
    expect(stateAt(timeline, "A", 19)).toBe("leyendo");
    expect(stateAt(timeline, "A", 30)).toBe("sin-datos");
    expect(stateAt(timeline, "A", 41)).toBe("leyendo");
    expect(countAt(timeline, 19)).toBe("1 de 1 (+0)");
  });

  it("quien lee sin estar asignado sale aparte y no suma a N", () => {
    const timeline = buildFleetTimeline(input({ readings: [...every("A", 0, 60), ...every("X", 0, 60)], history: [all("A")] }));
    expect(stateAt(timeline, "X", 30)).toBe("leyendo-sin-asignar");
    expect(countAt(timeline, 30)).toBe("1 de 1 (+1)");
  });

  it("una baja a mitad de ventana baja M desde ese instante, y el AGV pasa a fuera", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 60), ...every("B", 0, 30)],
        history: [all("A"), { agvId: "B", fromUtcMs: -1_000 * MINUTE, toUtcMs: 30 * MINUTE, note: "" }],
      }),
    );
    expect(countAt(timeline, 10)).toBe("2 de 2 (+0)");
    expect(stateAt(timeline, "B", 45)).toBe("fuera");
    expect(countAt(timeline, 45)).toBe("1 de 1 (+0)");
  });

  it("sin historial, M son los vehículos que aparecen en las lecturas", () => {
    const timeline = buildFleetTimeline(input({ readings: [...every("A", 0, 60), ...every("B", 0, 30)] }));
    expect(timeline.historyLoaded).toBe(false);
    expect(countAt(timeline, 10)).toBe("2 de 2 (+0)");
    // Después de su última lectura, B está ausente: sigue en M y no en N.
    expect(countAt(timeline, 45)).toBe("1 de 2 (+0)");
  });
});
