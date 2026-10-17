/**
 * Replay del expediente (ALG-016, ADR-0018 D8, entrega 3) sobre el caso de TC-012.
 *
 * Lo que se fija:
 * - los fotogramas recorren la ventana entera del expediente, con su fase;
 * - el AGV parado en `71012` queda **por detrás de lo esperado** mientras está parado, y la banda dice
 *   hasta dónde habría llegado a paso lento (p95) y habitual (p50); antes de parar, no;
 * - la banda es `expected` entre dos tags, nunca un punto, y el tránsito es una fracción de tiempo;
 * - la conexión sale del registro del terminal: `207` sin conexión dentro de su corte, conectado fuera,
 *   y los demás sin registro;
 * - cada hecho de la cronología cae en un solo fotograma;
 * - sin contexto no hay banda y se dice; mismo recorte, mismo replay.
 */

import { describe, expect, it } from "vitest";

import { backtrack } from "../../src/domain/case-backtrack.js";
import type { CaseWindow, FrozenEvidence } from "../../src/domain/incident-case.js";
import { buildCaseReplay, type CaseReplayFrame, type CaseReplayVehicle } from "../../src/domain/replay.js";
import {
  buildCriticalPointScenario,
  CRITICAL_TAG,
  scenarioContext,
  STALL_TAG,
  STALLED_AGV,
  WIFI_AGV,
  WIFI_FROM,
  WIFI_TO,
} from "../support/caso-punto-critico.js";

const MIN = 60_000;
const scenario = buildCriticalPointScenario();
const { truth } = scenario;
const window: CaseWindow = { symptomFrom: truth.absenceFrom + MIN, symptomTo: truth.absenceTo, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN };
const span = { from: window.symptomFrom - window.marginBeforeMs, to: window.symptomTo + window.marginAfterMs };
const readings = scenario.readings.filter((reading) => reading.time.utcMs >= span.from && reading.time.utcMs <= span.to);
const evidence: FrozenEvidence = { readings, connections: scenario.connections, context: scenarioContext(scenario.readings) };
const chronology = backtrack({ window, agvId: null, tagIds: [CRITICAL_TAG], evidence });
const replay = buildCaseReplay({ window, evidence, chronology, frameCount: 200 });

const vehicle = (frame: CaseReplayFrame, agvId: string): CaseReplayVehicle => frame.vehicles.find((entry) => entry.agvId === agvId) as CaseReplayVehicle;
const frameNear = (at: number): CaseReplayFrame =>
  replay.frames.reduce((best, frame) => (Math.abs(frame.atUtcMs - at) < Math.abs(best.atUtcMs - at) ? frame : best));

describe("replay del expediente de TC-012", () => {
  it("recorre la ventana entera, con la fase de cada fotograma", () => {
    expect(replay.frames).toHaveLength(200);
    expect(replay.frames[0]?.atUtcMs).toBe(span.from);
    expect(replay.frames[199]?.atUtcMs).toBe(span.to);
    expect(replay.frames[0]?.phase).toBe("antes");
    expect(frameNear((window.symptomFrom + window.symptomTo) / 2).phase).toBe("durante");
    expect(replay.frames[199]?.phase).toBe("despues");
    expect(replay.expectedFrom).toBe("instantanea");
    expect(replay.frames[0]?.vehicles.map((entry) => entry.agvId)).toEqual(["201", "202", "203", "204", "205", "206", "207", "208"]);
  });

  it("el AGV parado queda por detrás de lo esperado mientras está parado, y no antes", () => {
    const stopped = vehicle(frameNear(truth.stallFrom + 6 * MIN), STALLED_AGV);
    expect(stopped.state.kind === "en-tag" || stopped.state.kind === "silencio").toBe(true);
    expect(stopped.expected).toMatchObject({ fromTagId: STALL_TAG, behind: true, truncated: false });
    expect(stopped.expected?.slowSteps).toBeGreaterThanOrEqual(1);
    // A paso habitual habría llegado más lejos que a paso lento.
    expect(stopped.expected?.typicalSteps).toBeGreaterThanOrEqual(stopped.expected?.slowSteps ?? 0);
    const earlier = vehicle(frameNear(truth.stallFrom - 10 * MIN), STALLED_AGV);
    expect(earlier.expected?.behind).toBe(false);
  });

  it("antes de la parada casi nadie va por detrás de lo esperado", () => {
    const early = replay.frames.filter((frame) => frame.atUtcMs < truth.stallFrom - 2 * MIN);
    const flags = early.flatMap((frame) => frame.vehicles.map((entry) => entry.expected?.behind)).filter((flag) => flag !== null && flag !== undefined);
    const behind = flags.filter((flag) => flag === true).length;
    expect(flags.length).toBeGreaterThan(100);
    expect(behind / flags.length).toBeLessThan(0.05);
  });

  it("el tránsito es una fracción de tiempo, inferida, y la banda va entre dos tags", () => {
    const moving = replay.frames.flatMap((frame) => frame.vehicles).filter((entry) => entry.state.kind === "en-transito");
    expect(moving.length).toBeGreaterThan(0);
    for (const entry of moving) {
      if (entry.state.kind !== "en-transito") continue;
      expect(entry.state.truth).toBe("inferred");
      expect(entry.state.fraction).toBeGreaterThanOrEqual(0);
      expect(entry.state.fraction).toBeLessThanOrEqual(1);
    }
  });

  it("la conexión sale del registro del terminal", () => {
    const during = frameNear((WIFI_FROM + WIFI_TO) / 2);
    expect(vehicle(during, WIFI_AGV).connection).toBe("sin-conexion");
    expect(vehicle(frameNear(WIFI_TO + 5 * MIN), WIFI_AGV).connection).toBe("conectado");
    expect(vehicle(during, "201").connection).toBe("sin-registro");
  });

  it("cada hecho de la cronología cae en un solo fotograma", () => {
    const seen = replay.frames.flatMap((frame) => frame.events);
    const inside = chronology.facts.flatMap((fact, index) => (fact.at <= span.to ? [index] : []));
    expect([...seen].sort((a, b) => a - b)).toEqual(inside);
  });

  it("es determinista y, sin contexto, no dice dónde debería estar nadie", () => {
    expect(buildCaseReplay({ window, evidence: { ...evidence, readings: [...readings].reverse() }, chronology, frameCount: 200 })).toEqual(replay);
    const bare = buildCaseReplay({ window, evidence: { readings, connections: [], context: null }, chronology, frameCount: 20 });
    expect(bare.frames.every((frame) => frame.vehicles.every((entry) => entry.expected === null && entry.connection === "sin-registro"))).toBe(true);
    expect(bare.limits.join(" ")).toContain("no se dice dónde debería estar cada AGV");
    expect(buildCaseReplay({ window, evidence: { readings: [], connections: [], context: null }, chronology, frameCount: 20 }).frames).toEqual([]);
  });
});
