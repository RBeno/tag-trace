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
 * Quita las lecturas de cada recorte. Una lectura que cae en dos recortes (de incidencias distintas:
 * los de una misma no se solapan, `checkCuts`) cuenta en el primero. Las que quedan conservan su orden.
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

/** Una incidencia tal como la ve el recorte: su clave, su título, su AGV y sus ventanas (una o varias). */
export interface CuttableIncident {
  readonly key: string;
  readonly title: string;
  readonly agvId?: string;
  readonly window?: Interval;
  readonly windows?: readonly Interval[];
}

/**
 * Comprueba los recortes pedidos contra las incidencias del periodo y la ventana del fichero. Devuelve
 * los recortes normalizados (con el AGV de la incidencia, no el que venga en el mensaje) o lanza con
 * el motivo en palabras.
 *
 * No exige que el recorte se solape con la ventana de la incidencia: el principio y el fin los elige la
 * persona (OQ-148) y pueden quedar fuera de lo que el hallazgo midió. Eso se avisa, no se bloquea:
 * `cutWarnings`. Una incidencia admite varios recortes (OQ-155, propietario 2026-09-27: uno por parada
 * con varias `windows`), siempre que no se solapen entre sí: una lectura no puede caer en dos recortes
 * de la misma incidencia, porque contaría en uno solo y el otro diría lo que no quitó.
 */
export function checkCuts(cuts: readonly IncidentCut[], incidents: readonly CuttableIncident[], fileWindow: Interval): readonly IncidentCut[] {
  const byKey = new Map(incidents.map((incident) => [incident.key, incident]));
  const checked = cuts.map((cut) => {
    const incident = byKey.get(cut.incidentKey);
    if (incident === undefined) {
      throw new Error("Solo se recorta la ventana de una incidencia del periodo: un hallazgo grave confirmado.");
    }
    if (windowsOf(incident).length === 0) {
      throw new Error(`La incidencia «${incident.title}» no tiene ventana: no hay nada que recortar.`);
    }
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
  // Varios recortes de una incidencia, sí; que compartan un instante (ambos extremos incluidos), no.
  for (let index = 0; index < checked.length; index += 1) {
    const cut = checked[index] as IncidentCut;
    for (let other = index + 1; other < checked.length; other += 1) {
      const next = checked[other] as IncidentCut;
      if (next.incidentKey === cut.incidentKey && cut.from <= next.to && cut.to >= next.from) {
        const title = byKey.get(cut.incidentKey)?.title ?? cut.incidentKey;
        throw new Error(`Los recortes de «${title}» se solapan: sepáralos o une los dos en uno.`);
      }
    }
  }
  return checked;
}

/** Las ventanas de una incidencia: `windows` si las trae, si no `window`; ninguna si no tiene. */
function windowsOf(incident: CuttableIncident): readonly Interval[] {
  return incident.windows ?? (incident.window === undefined ? [] : [incident.window]);
}

/**
 * Avisos, no bloqueos, sobre recortes que ya pasaron `checkCuts`: uno por recorte que no se solapa con
 * ninguna ventana de su incidencia (ambos extremos incluidos). La persona eligió ese principio y ese fin
 * y puede tener razón —el hallazgo mide desde la primera lectura que falta, no desde que empezó lo que
 * pasó—, así que se le dice y se sigue. Un recorte de una incidencia desconocida no avisa aquí: lo
 * rechaza `checkCuts`.
 */
export function cutWarnings(cuts: readonly IncidentCut[], incidents: readonly CuttableIncident[]): readonly string[] {
  const byKey = new Map(incidents.map((incident) => [incident.key, incident]));
  const out: string[] = [];
  for (const cut of cuts) {
    const incident = byKey.get(cut.incidentKey);
    if (incident === undefined) continue;
    const windows = windowsOf(incident);
    if (windows.length === 0 || windows.some((window) => cut.from <= window.to && cut.to >= window.from)) continue;
    const which = windows.length === 1 ? "la ventana" : `ninguna de las ${windows.length} ventanas`;
    out.push(`El recorte de «${incident.title}» no se solapa con ${which} de la incidencia: se aplica tal como lo elegiste, pero quita tiempo que el hallazgo no midió.`);
  }
  return out;
}

function copyCut(cut: IncidentCut): IncidentCut {
  return { incidentKey: cut.incidentKey, from: cut.from, to: cut.to, ...(cut.agvId === undefined ? {} : { agvId: cut.agvId }) };
}
