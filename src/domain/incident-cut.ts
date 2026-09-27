/**
 * El recorte de la ventana de una incidencia al consolidar (OQ-148, propietario 2026-09-27: «recortar
 * la ventana de la incidencia —su principio y su fin, que elige la persona— cuando las lecturas estén
 * archivadas»).
 *
 * Lo elige una persona, incidencia a incidencia, con su principio y su fin; nada de aquí decide qué
 * se recorta. Dentro de `[from, to]` se quitan las lecturas del fichero; si la incidencia es de un AGV
 * (`agvId`), solo las de ese AGV: quitar las de todos vaciaría el periodo por algo que no es del
 * circuito. El tiempo recortado de un recorte de todo el circuito queda **sin cobertura**, no como
 * silencio: nadie dejó de leer, simplemente no se mira.
 *
 * Las lecturas no se inventan ni se mueven: solo se quitan. La instantánea guardada del fichero no
 * cambia (es medición); el recorte solo afecta a la versión consolidada, que lo lleva registrado.
 */

import type { Interval } from "./coverage.js";
import type { Reading } from "./reading.js";

/** Lo que la persona pide recortar de una incidencia. */
export interface IncidentCut {
  /** La clave de la incidencia (la del hallazgo confirmado). */
  readonly incidentKey: string;
  /** Principio y fin, en UTC, ambos incluidos. */
  readonly from: number;
  readonly to: number;
  /** Si la incidencia es de un AGV: solo se quitan sus lecturas. */
  readonly agvId?: string;
}

/** Un recorte aplicado, con cuántas lecturas quitó del fichero. */
export interface AppliedCut extends IncidentCut {
  readonly removed: number;
}

/**
 * Quita las lecturas de cada recorte. Una lectura que cae en dos recortes cuenta en el primero. Las
 * que quedan conservan su orden.
 */
export function cutReadings(
  readings: readonly Reading[],
  cuts: readonly IncidentCut[],
): { readonly kept: readonly Reading[]; readonly applied: readonly AppliedCut[] } {
  const removed = cuts.map(() => 0);
  const kept: Reading[] = [];
  for (const reading of readings) {
    const at = reading.time.utcMs;
    const index = cuts.findIndex((cut) => at >= cut.from && at <= cut.to && (cut.agvId === undefined || cut.agvId === reading.agvId));
    if (index < 0) kept.push(reading);
    else removed[index] = (removed[index] as number) + 1;
  }
  return { kept, applied: cuts.map((cut, index) => ({ ...copyCut(cut), removed: removed[index] as number })) };
}

/**
 * La cobertura sin el tiempo recortado de todo el circuito. Un recorte de un AGV no quita cobertura:
 * los demás AGV siguen observados en ese tiempo.
 */
export function coverageWithoutCuts(coverage: readonly Interval[], cuts: readonly IncidentCut[]): readonly Interval[] {
  let spans: Interval[] = [...coverage];
  for (const cut of cuts) {
    if (cut.agvId !== undefined) continue;
    spans = spans.flatMap((span) => {
      if (cut.to < span.from || cut.from > span.to) return [span];
      const out: Interval[] = [];
      if (cut.from - 1 >= span.from) out.push({ from: span.from, to: cut.from - 1 });
      if (cut.to + 1 <= span.to) out.push({ from: cut.to + 1, to: span.to });
      return out;
    });
  }
  return spans;
}

/**
 * Comprueba los recortes pedidos contra las incidencias del periodo y la ventana del fichero. Devuelve
 * los recortes normalizados (con el AGV de la incidencia, no el que venga en el mensaje) o lanza con
 * el motivo en palabras.
 */
export function checkCuts(
  cuts: readonly IncidentCut[],
  incidents: readonly { readonly key: string; readonly title: string; readonly agvId?: string; readonly window?: Interval; readonly windows?: readonly Interval[] }[],
  fileWindow: Interval,
): readonly IncidentCut[] {
  const byKey = new Map(incidents.map((incident) => [incident.key, incident]));
  const seen = new Set<string>();
  return cuts.map((cut) => {
    const incident = byKey.get(cut.incidentKey);
    if (incident === undefined) {
      throw new Error("Solo se recorta la ventana de una incidencia del periodo: un hallazgo grave confirmado.");
    }
    if (incident.window === undefined && (incident.windows ?? []).length === 0) {
      throw new Error(`La incidencia «${incident.title}» no tiene ventana: no hay nada que recortar.`);
    }
    if (seen.has(cut.incidentKey)) throw new Error(`La incidencia «${incident.title}» tiene dos recortes: elige uno.`);
    seen.add(cut.incidentKey);
    if (!Number.isFinite(cut.from) || !Number.isFinite(cut.to) || cut.from > cut.to) {
      throw new Error(`El recorte de «${incident.title}» necesita un principio anterior o igual a su fin.`);
    }
    if (cut.from < fileWindow.from || cut.to > fileWindow.to) {
      throw new Error(`El recorte de «${incident.title}» se sale de la ventana del fichero.`);
    }
    if (cut.agvId !== undefined && cut.agvId !== incident.agvId) {
      throw new Error(`El recorte de «${incident.title}» no es del AGV de la incidencia.`);
    }
    return { incidentKey: cut.incidentKey, from: cut.from, to: cut.to, ...(incident.agvId === undefined ? {} : { agvId: incident.agvId }) };
  });
}

function copyCut(cut: IncidentCut): IncidentCut {
  return { incidentKey: cut.incidentKey, from: cut.from, to: cut.to, ...(cut.agvId === undefined ? {} : { agvId: cut.agvId }) };
}
