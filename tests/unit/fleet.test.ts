/**
 * La flota a lo largo del tiempo (R-AGV-014, R-AGV-015): tramos de cada AGV y recuento N de M.
 *
 * Lo que se fija: un asignado sin lecturas es ausente, no silencio; un hueco de cobertura es sin
 * datos y nunca cuenta; N es «en el circuito» —leyendo, cargando o parado entre dos lecturas—, y aparte
 * cuántos leen: un AGV sin lecturas no ha salido del circuito (R-AGV-018, decisión del propietario
 * 2026-09-24; antes un silencio restaba de N); quien lee sin estar
 * asignado sale aparte y no suma a N; una baja a mitad de ventana baja M desde ese instante; y el
 * rato antes de la primera lectura o después de la última solo es ausencia si pasa del umbral de
 * silencio — si no, el peor momento de la ventana sería siempre su borde.
 *
 * Y cómo reapareció cada AGV (R-AGV-017): la clase de cada hueco llega a su tramo con sus hechos; un
 * hueco habitual en ese tramo se dibuja leyendo y cuenta en N; un borde de una hora o más sin leer
 * es desconexión, y uno más corto sigue siendo un ausente sin clase.
 *
 * Y qué hacía el resto (R-AGV-018): la justificación y el bloqueo llegan al tramo; un borde que cae
 * en una parada de la producción es parado y justificado, y cuenta en el circuito; mantenimiento no.
 */

import { describe, expect, it } from "vitest";

import { buildFleetTimeline, type FleetInput, type FleetState } from "../../src/domain/fleet.js";
import type { Reading } from "../../src/domain/reading.js";
import type { SilenceDetail } from "../../src/domain/silence-kind.js";

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
    longAbsenceMs: 60 * MINUTE,
    productionStops: [],
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
  return entry === undefined
    ? "sin recuento"
    : `${entry.inCircuit} de ${entry.assigned}, ${entry.reading} leyendo (+${entry.unassignedActive})`;
}

const all = (agvId: string) => ({ agvId, fromUtcMs: -1_000 * MINUTE, toUtcMs: null, note: "" });

describe("vida de cada AGV (buildFleetTimeline)", () => {
  it("un asignado que no lee nunca está ausente toda la ventana, y cuenta en M pero no en N", () => {
    const timeline = buildFleetTimeline(
      input({ readings: every("A", 0, 60), history: [all("A"), all("B")] }),
    );
    expect(stateAt(timeline, "B", 30)).toBe("ausente");
    expect(countAt(timeline, 30)).toBe("1 de 2, 1 leyendo (+0)");
  });

  it("tres asignados con uno en silencio: 3 de 3 en el circuito, y 2 leyendo exactamente en ese intervalo", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 60), ...every("B", 0, 60), ...every("C", 0, 20), ...every("C", 40, 60)],
        history: [all("A"), all("B"), all("C")],
        inactivity: new Map([["C", [{ fromUtcMs: 20 * MINUTE, toUtcMs: 40 * MINUTE, cause: "silencio" as const }]]]),
      }),
    );
    expect(stateAt(timeline, "C", 30)).toBe("silencio");
    expect(countAt(timeline, 10)).toBe("3 de 3, 3 leyendo (+0)");
    expect(countAt(timeline, 30)).toBe("3 de 3, 2 leyendo (+0)");
    expect(countAt(timeline, 50)).toBe("3 de 3, 3 leyendo (+0)");
  });

  it("la carga cuenta en el circuito; el arranque en frío es carga hasta su salida", () => {
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
    expect(countAt(timeline, 30)).toBe("2 de 2, 1 leyendo (+0)");
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
    // B tarda 20 min en leer por primera vez: eso sí es ausencia de lecturas, pero no de circuito
    // (R-AGV-018): cuenta en N y no leyendo.
    expect(stateAt(timeline, "B", 10)).toBe("ausente");
    expect(countAt(timeline, 1)).toBe("2 de 2, 1 leyendo (+0)");
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
        // El expediente ya no produce un silencio que cruce un hueco (`[3.18.3]`); se prueba igual,
        // por si otra fuente de inactividad lo hiciera.
        inactivity: new Map([["A", [{ fromUtcMs: 18 * MINUTE, toUtcMs: 42 * MINUTE, cause: "silencio" as const }]]]),
      }),
    );
    expect(stateAt(timeline, "A", 19)).toBe("leyendo");
    expect(stateAt(timeline, "A", 30)).toBe("sin-datos");
    expect(stateAt(timeline, "A", 41)).toBe("leyendo");
    expect(countAt(timeline, 19)).toBe("1 de 1, 1 leyendo (+0)");
  });

  it("un tramo de cobertura corto sin ninguna lectura del AGV no es «leyendo»: no tiene ritmo que juzgar", () => {
    // Dos exportaciones: la segunda dura 4 min (menos que el umbral de silencio). A lee en las dos;
    // B solo en la primera. En la segunda B no aparece, y eso no puede dibujarse como leyendo.
    const timeline = buildFleetTimeline(
      input({
        coverage: [
          { from: 0, to: 60 * MINUTE },
          { from: 120 * MINUTE, to: 124 * MINUTE },
        ],
        readings: [...every("A", 0, 60), ...every("A", 120, 124), ...every("B", 0, 60)],
        history: [all("A"), all("B")],
      }),
    );
    expect(stateAt(timeline, "A", 122)).toBe("leyendo");
    expect(stateAt(timeline, "B", 122)).not.toBe("leyendo");
  });

  it("quien lee sin estar asignado sale aparte y no suma a N", () => {
    const timeline = buildFleetTimeline(input({ readings: [...every("A", 0, 60), ...every("X", 0, 60)], history: [all("A")] }));
    expect(stateAt(timeline, "X", 30)).toBe("leyendo-sin-asignar");
    expect(countAt(timeline, 30)).toBe("1 de 1, 1 leyendo (+1)");
  });

  it("una baja a mitad de ventana baja M desde ese instante, y el AGV pasa a fuera", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 60), ...every("B", 0, 30)],
        history: [all("A"), { agvId: "B", fromUtcMs: -1_000 * MINUTE, toUtcMs: 30 * MINUTE, note: "" }],
      }),
    );
    expect(countAt(timeline, 10)).toBe("2 de 2, 2 leyendo (+0)");
    expect(stateAt(timeline, "B", 45)).toBe("fuera");
    expect(countAt(timeline, 45)).toBe("1 de 1, 1 leyendo (+0)");
  });

  it("cada hueco lleva cómo reapareció el AGV, y uno habitual en su tramo se dibuja leyendo y cuenta en N", () => {
    const detail: SilenceDetail = {
      lastTagBefore: "60210",
      firstTagAfter: "60213",
      nextTagId: "60213",
      skipped: 0,
      usualMs: 40_000,
      shift: "06–14",
    };
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 10), ...every("A", 20, 30), ...every("A", 45, 60), ...every("B", 0, 60)],
        history: [all("A"), all("B")],
        inactivity: new Map([
          [
            "A",
            [
              { fromUtcMs: 10 * MINUTE, toUtcMs: 20 * MINUTE, cause: "silencio" as const, kind: "habitual" as const, detail },
              { fromUtcMs: 30 * MINUTE, toUtcMs: 45 * MINUTE, cause: "silencio" as const, kind: "parada" as const, detail },
            ],
          ],
        ]),
      }),
    );
    expect(stateAt(timeline, "A", 15)).toBe("leyendo");
    expect(countAt(timeline, 15)).toBe("2 de 2, 2 leyendo (+0)");
    const stop = timeline.vehicles
      .find((vehicle) => vehicle.agvId === "A")
      ?.segments.find((segment) => segment.fromUtcMs === 30 * MINUTE);
    expect(stop).toMatchObject({ state: "silencio", kind: "parada", toUtcMs: 45 * MINUTE });
    expect(stop?.detail).toBe(detail);
    expect(countAt(timeline, 35)).toBe("2 de 2, 1 leyendo (+0)");
  });

  it("un borde de una hora o más sin leer es desconexión; uno más corto, un ausente sin clase", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 70, 180), ...every("B", 20, 180)],
        coverage: [{ from: 0, to: 180 * MINUTE }],
        history: [all("A"), all("B"), all("C")],
      }),
    );
    const first = (agvId: string) => timeline.vehicles.find((vehicle) => vehicle.agvId === agvId)?.segments[0];
    expect(first("A")).toMatchObject({ state: "ausente", kind: "desconexion", toUtcMs: 70 * MINUTE });
    expect(first("A")?.detail).toMatchObject({ edge: "inicio", firstTagAfter: "1" });
    expect(first("B")?.state).toBe("ausente");
    expect(first("B")?.kind).toBeUndefined();
    // Un asignado que no lee nada en tres horas: desconexión en todo el tramo.
    expect(first("C")).toMatchObject({ state: "ausente", kind: "desconexion", toUtcMs: 180 * MINUTE });
  });

  it("la justificación y el bloqueo llegan al tramo; mantenimiento no cuenta en el circuito", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 10), ...every("A", 20, 60), ...every("B", 0, 30), ...every("B", 45, 60)],
        history: [all("A"), all("B")],
        inactivity: new Map([
          [
            "A",
            [{ fromUtcMs: 10 * MINUTE, toUtcMs: 20 * MINUTE, cause: "silencio" as const, kind: "parada" as const, justification: "sin-explicacion" as const, blocking: 3 }],
          ],
          ["B", [{ fromUtcMs: 30 * MINUTE, toUtcMs: 45 * MINUTE, cause: "silencio" as const, kind: "mantenimiento" as const }]],
        ]),
      }),
    );
    const stop = timeline.vehicles.find((vehicle) => vehicle.agvId === "A")?.segments.find((segment) => segment.fromUtcMs === 10 * MINUTE);
    expect(stop).toMatchObject({ kind: "parada", justification: "sin-explicacion", blocking: 3 });
    expect(countAt(timeline, 35)).toBe("1 de 2, 1 leyendo (+0)");
  });

  it("un borde sin lecturas dentro de una parada de la producción es parado y justificado, y cuenta en el circuito", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 60), ...every("B", 20, 60)],
        history: [all("A"), all("B")],
        productionStops: [{ from: 0, to: 18 * MINUTE }],
      }),
    );
    const first = timeline.vehicles.find((vehicle) => vehicle.agvId === "B")?.segments[0];
    expect(first).toMatchObject({ state: "silencio", kind: "parada", justification: "produccion", toUtcMs: 20 * MINUTE });
    expect(countAt(timeline, 10)).toBe("2 de 2, 1 leyendo (+0)");
  });

  it("sin historial, M son los vehículos que aparecen en las lecturas", () => {
    const timeline = buildFleetTimeline(input({ readings: [...every("A", 0, 60), ...every("B", 0, 30)] }));
    expect(timeline.historyLoaded).toBe(false);
    expect(countAt(timeline, 10)).toBe("2 de 2, 2 leyendo (+0)");
    // Después de su última lectura, B está ausente de lecturas, pero menos de una hora: sigue en el
    // circuito (R-AGV-018).
    expect(countAt(timeline, 45)).toBe("2 de 2, 1 leyendo (+0)");
  });

  it("una hora o más sin leer que nada explica sí saca del recuento; mantenimiento también", () => {
    const timeline = buildFleetTimeline(
      input({
        readings: [...every("A", 0, 180), ...every("B", 0, 30)],
        coverage: [{ from: 0, to: 180 * MINUTE }],
        history: [all("A"), all("B")],
      }),
    );
    // B deja de leer a los 30 min y no vuelve en dos horas y media: desconexión, fuera de N.
    expect(countAt(timeline, 120)).toBe("1 de 2, 1 leyendo (+0)");
  });
});
