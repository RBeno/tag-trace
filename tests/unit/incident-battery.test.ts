/**
 * La batería de mediciones de cada incidencia (`src/domain/incident-battery.ts`, R-AGV-021).
 *
 * Lo que se fija, con el ejemplo del propietario: la última lectura; si la línea siguió con su
 * cadencia; cuánto avanzó el de delante; si los de detrás pasaron su sitio (entonces avanzaba sin
 * registrar, porque en una guía no se adelanta) o se quedaron detrás (parado de verdad); una vuelta
 * entera de los de detrás no deja afirmar que siguiera en la guía; el cambio de AGV; la cola de una
 * parada de la línea; la calle de carga; y los AGV que dejan de leer, cada uno contra sí mismo.
 */

import { describe, expect, it } from "vitest";

import type { Band } from "../../src/domain/segment-bands.js";
import type { Reading } from "../../src/domain/reading.js";
import { abandonedReadings, buildIncidentContext, incidentBattery } from "../../src/domain/incident-battery.js";

let row = 0;
const r = (agvId: string, tagId: string, utcMs: number): Reading => ({
  time: { utcMs, raw: String(utcMs), zone: "UTC", flag: "ok" },
  agvId,
  tagId,
  provenance: { sourceId: "s", sourceHash: "s", sourceRow: ++row },
});
const band: Band = { samples: 50, p50Ms: 60_000, p80Ms: 60_000, p95Ms: 70_000, fenceMs: 90_000 };
const S = 1_000;

describe("batería de mediciones de una incidencia", () => {
  // X lee C a los 100 s y no vuelve hasta D a los 400 s. Delante va A; detrás, B.
  const base = [
    r("A", "C", 90 * S), r("A", "D", 110 * S), r("A", "E", 200 * S), r("A", "F", 300 * S),
    r("X", "B", 80 * S), r("X", "C", 100 * S), r("X", "D", 400 * S),
  ];
  const incident = { agvId: "X", fromTagId: "C", fromUtcMs: 100 * S, toTagId: "D", toUtcMs: 400 * S };
  const passes = [150 * S, 210 * S, 270 * S, 330 * S, 390 * S];

  it("los de detrás siguen avanzando y él reaparece por delante: avanzaba sin registrar, con la línea en marcha", () => {
    // X reaparece en G, por delante de B, que en ese tiempo llegó hasta E.
    const readings = [...base.filter((entry) => !(entry.agvId === "X" && entry.tagId === "D")), r("X", "G", 400 * S), r("B", "C", 150 * S), r("B", "D", 170 * S), r("B", "E", 250 * S)];
    const battery = incidentBattery(
      buildIncidentContext(readings, passes, () => band),
      { ...incident, toTagId: "G" },
      1_000 * S,
    );
    expect(battery.line).toEqual({ passes: 5, moving: true, cycleMs: 60_000 });
    expect(battery.ahead).toEqual({ agvId: "A", tagsAdvanced: 3, lastTagId: "F" });
    expect(battery.behind.moved).toEqual(["B"]);
    expect(battery.reading).toBe("no-registra");
    expect(battery.lines.join(" ")).toContain("no lee tags o no tiene wifi");
    expect(battery.lines[0]).toBe("Última lectura de X: C. La siguiente, 5,0 min después, en G.");
  });

  it("los de detrás llegan a donde él reaparece antes que él: lo adelantaron, no se movía en la guía", () => {
    const readings = [...base, r("B", "C", 150 * S), r("B", "D", 170 * S), r("B", "E", 250 * S)];
    const battery = incidentBattery(buildIncidentContext(readings, passes, () => band), incident, 1_000 * S);
    expect(battery.behind.overtook).toEqual(["B"]);
    expect(battery.reading).toBe("adelantado");
    expect(battery.lines.join(" ")).toContain("no se movía en la guía");
  });

  it("los de detrás se quedan en su sitio: estaba parado de verdad", () => {
    const readings = [...base, r("B", "C", 150 * S), r("B", "D", 420 * S)];
    const battery = incidentBattery(buildIncidentContext(readings, [], () => band), incident, 1_000 * S);
    expect(battery.line).toBeNull();
    expect(battery.behind.held).toEqual(["B"]);
    expect(battery.reading).toBe("parado-con-cola");
  });

  it("si los de detrás dan una vuelta entera, no se afirma que siguiera en la guía", () => {
    const readings = [...base, r("B", "C", 150 * S), r("B", "E", 170 * S), r("B", "C", 350 * S)];
    const battery = incidentBattery(buildIncidentContext(readings, [], () => band), { ...incident, toTagId: "G" }, 1_000 * S);
    expect(battery.reading).toBe("fuera-o-sin-registrar");
  });

  it("la cola de una parada de la línea y la calle de carga se dicen", () => {
    const context = buildIncidentContext(base, [], () => band, [{ from: 120 * S, to: 390 * S }], new Map([["C", "calle-2"]]));
    const battery = incidentBattery(context, incident, 1_000 * S);
    expect(battery.lineStoppedMs).toBe(270 * S);
    expect(battery.lines.join(" ")).toContain("es la cola de la línea parada");
    expect(battery.lines.join(" ")).toContain("calle de carga calle-2");
  });

  it("si no vuelve a leer: cambio de AGV candidato, y deja de leer contra su propio hueco más largo", () => {
    const readings = [
      r("X", "B", 0), r("X", "C", 50 * S), r("X", "D", 100 * S),
      r("A", "B", 0), r("A", "C", 400 * S), r("A", "D", 900 * S),
      r("Y", "D", 300 * S), r("Y", "E", 320 * S),
    ];
    const context = buildIncidentContext(readings, [], () => null);
    const abandoned = abandonedReadings(context, 1_000 * S);
    expect(abandoned.map((entry) => entry.agvId)).toEqual(["X", "Y"]);
    const battery = incidentBattery(context, abandoned[0] as (typeof abandoned)[number], 1_000 * S);
    expect(battery.swap).toEqual({ agvId: "Y", tagId: "D", afterMs: 200 * S });
    expect(battery.lines.join(" ")).toContain("Cambio de AGV candidato: Y");
  });
});
