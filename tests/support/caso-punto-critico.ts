/**
 * Caso de oro de TC-012 (ADR-0018, entrega 2): **un punto crítico sin llegada durante más de diez
 * minutos**, con verdad conocida.
 *
 * Es un escenario propio y pequeño, no una clase más del circuito de auditoría: plantar una parada de
 * trece minutos en aquel moverían las cifras medidas de sus otras clases (colas, paradas de la
 * producción, la línea) y la prueba de una no debe reescribir las de las demás.
 *
 * Lo que pasa, todo inventado:
 *
 * - Un anillo de 24 tags (`71001`…`71024`) en una sola guía, sin adelantar, y 8 AGV (`201`…`208`)
 *   separados tres tags; cada tramo se recorre en 30 s ± 3 s (semilla fija). Pasa un AGV por cada tag
 *   cada 90 s más o menos.
 * - El **punto crítico** es `71018`. A las 10:40 el AGV `205` llega a `71012`, seis tags antes, y se
 *   queda ahí trece minutos. Los de detrás se paran en cola; los de delante siguen y pasan por `71018`
 *   antes de que se note. Por `71018` no pasa nadie hasta que `205` vuelve a moverse y llega.
 * - **Distractor que precede**: el AGV `207` pierde la conexión de 10:30:00 a 10:33:20 según el registro
 *   de su terminal y sigue leyendo con normalidad. Ocurre antes del síntoma y no tiene que ver con él:
 *   el retroceso lo pone como `precede`, como todo lo anterior, sin decir que sea la causa.
 *
 * La fecha es el martes 20 de enero de 2026, de 10:00 a 12:00 en Madrid (UTC+1): sin cambio de hora.
 */

import type { FrozenConnection } from "../../src/domain/incident-case.js";
import type { Reading } from "../../src/domain/reading.js";

export const ZONE = "Europe/Madrid";
/** 10:00 en Madrid el 20/01/2026. */
export const START_UTC = Date.UTC(2026, 0, 20, 9, 0, 0);
const DURATION_S = 2 * 3600;

export const RING: readonly string[] = Array.from({ length: 24 }, (_, index) => String(71001 + index));
export const AGVS: readonly string[] = Array.from({ length: 8 }, (_, index) => String(201 + index));
export const CRITICAL_TAG = "71018";
export const STALL_TAG = "71012";
export const STALLED_AGV = "205";
export const WIFI_AGV = "207";
/** La parada: llega a `71012` desde las 10:40 y se queda 13 min de más. */
const STALL_FROM_S = 40 * 60;
const STALL_EXTRA_S = 13 * 60;
export const WIFI_FROM = START_UTC + 30 * 60_000;
export const WIFI_TO = START_UTC + 33 * 60_000 + 20_000;
const STEP_S = 30;
const JITTER_S = 3;

export interface CriticalPointScenario {
  readonly readings: readonly Reading[];
  readonly connections: readonly FrozenConnection[];
  /** El fichero de lecturas tal como lo exporta el servidor: `Fecha;AGV;Tag`, hora local. */
  readonly csv: string;
  /** Las filas del registro de conexiones del AGV `207`, para un libro de Excel (DS-013). */
  readonly connectionRows: readonly (readonly string[])[];
  readonly truth: {
    /** Cuándo llegó y cuándo se fue el AGV parado de `71012`. */
    readonly stallFrom: number;
    readonly stallTo: number;
    /** El mayor hueco entre dos pasos seguidos por `71018`: el síntoma. */
    readonly absenceFrom: number;
    readonly absenceTo: number;
    readonly lastBefore: string;
    readonly firstAfter: string;
  };
}

/** Generador congruencial con semilla: el mismo escenario siempre. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** «20/01/2026 10:40:05» en Madrid, para un instante UTC del escenario (UTC+1 todo el día). */
export function wallText(utcMs: number): string {
  const local = new Date(utcMs + 3_600_000);
  return `${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${local.getUTCHours()}:${two(local.getUTCMinutes())}:${two(local.getUTCSeconds())}`;
}

export function buildCriticalPointScenario(seed = 20260120): CriticalPointScenario {
  const random = seeded(seed);
  const step = (): number => STEP_S + Math.round((random() * 2 - 1) * JITTER_S);
  // El primero va delante: 201 en el tag 22 (índice 21), 202 tres tags detrás, y así.
  const at = AGVS.map((_, index) => (21 - 3 * index + RING.length) % RING.length);
  const nextMove = AGVS.map(() => step());
  const occupied = new Set(at);
  const events: { agvId: string; tagId: string; second: number }[] = [];
  AGVS.forEach((agvId, index) => events.push({ agvId, tagId: RING[at[index] as number] as string, second: 0 }));
  let stallFrom = -1;
  let stallTo = -1;
  let stalled = false;
  for (let second = 1; second <= DURATION_S; second += 1) {
    AGVS.forEach((agvId, index) => {
      if (second < (nextMove[index] as number)) return;
      const next = ((at[index] as number) + 1) % RING.length;
      // En una guía no se adelanta: si el siguiente tag está ocupado, espera.
      if (occupied.has(next)) return;
      occupied.delete(at[index] as number);
      occupied.add(next);
      at[index] = next;
      events.push({ agvId, tagId: RING[next] as string, second });
      let wait = step();
      if (agvId === STALLED_AGV && !stalled && RING[next] === STALL_TAG && second >= STALL_FROM_S) {
        stalled = true;
        stallFrom = second;
        wait += STALL_EXTRA_S;
        stallTo = second + wait;
      }
      nextMove[index] = second + wait;
    });
  }
  events.sort((a, b) => a.second - b.second || a.agvId.localeCompare(b.agvId));
  const readings: Reading[] = events.map((event, index) => {
    const utcMs = START_UTC + event.second * 1000;
    return {
      time: { utcMs, raw: wallText(utcMs), zone: ZONE, flag: "ok" },
      agvId: event.agvId,
      tagId: event.tagId,
      provenance: { sourceId: "punto-critico", sourceHash: "h-punto-critico", sourceRow: index + 2 },
    };
  });
  const passes = readings.filter((reading) => reading.tagId === CRITICAL_TAG);
  let best = { from: 0, to: 0, before: "", after: "" };
  for (let index = 1; index < passes.length; index += 1) {
    const a = passes[index - 1] as Reading;
    const b = passes[index] as Reading;
    if (b.time.utcMs - a.time.utcMs > best.to - best.from) best = { from: a.time.utcMs, to: b.time.utcMs, before: a.agvId, after: b.agvId };
  }
  const csv = ["Fecha;AGV;Tag", ...readings.map((reading) => `${reading.time.raw};${reading.agvId};${reading.tagId}`)].join("\r\n") + "\r\n";
  const connection = (utcMs: number, kind: "desconexion" | "conexion", sourceRow: number): FrozenConnection => ({
    agvId: WIFI_AGV,
    utcMs,
    kind,
    rawKind: kind === "desconexion" ? "Desconexión" : "Conexión",
    coverage: kind === "desconexion" ? "0" : "255",
    ipTerminal: "10.0.0.7",
    version: "2.00",
    aux: "MTC 0 MTD 0",
    mtc: "0",
    sourceRow,
    sourceHash: "h-conexiones-207",
  });
  const row = (utcMs: number, kind: string, cover: string): string[] => [
    "Checked", wallText(utcMs), kind, "2", "0", cover, "2.00", "2", "17", "1", "MTC 0 MTD 0", "0", "10.0.0.7",
  ];
  return {
    readings,
    // El registro viene del más nuevo al más antiguo, como lo exporta el terminal.
    connections: [connection(WIFI_TO, "conexion", 2), connection(WIFI_FROM, "desconexion", 3)],
    csv,
    connectionRows: [
      ["Linea", "Fecha", "Conexión", "Nº Motor", "Op.", "Cober.", "Ver.", "RFID", "LCD", "PID", "Datos Aux", "Cimi", "IP Terminal"],
      row(WIFI_TO, "Conexión", "255"),
      row(WIFI_FROM, "Desconexión", "0"),
    ],
    truth: {
      stallFrom: START_UTC + stallFrom * 1000,
      stallTo: START_UTC + stallTo * 1000,
      absenceFrom: best.from,
      absenceTo: best.to,
      lastBefore: best.before,
      firstAfter: best.after,
    },
  };
}
