/**
 * La batería de mediciones de cada incidencia (R-AGV-021).
 *
 * El propietario (2026-09-26): «los huecos pueden venir de cualquier punto anterior: AGV que no
 * avanzan, que no llegan al picking… Por eso localizar anomalías, cuellos de botella, AGV lentos,
 * puntos con muchas incidencias, pero bien documentado: la línea sigue en movimiento con cadencia, el
 * de delante avanza tantos tags durante tanto tiempo, el último tag de lectura cuando el fallo; si los
 * de atrás leen pero el del fallo no y los otros siguen avanzando, probablemente no lee tags o no tiene
 * wifi, pero todo avanza con normalidad; si hay un cambio de AGV, uno abandona las lecturas y empieza
 * otro… Por cada incidencia, una batería de mediciones para aportar datos».
 *
 * Una incidencia es un AGV que, desde su última lectura en un tag, tarda en volver a leer —o no vuelve—.
 * A cada una se le mide lo mismo, siempre en el mismo orden, para que se lean igual:
 *
 * 1. **La última lectura** y, si la hay, la siguiente: dónde y cuándo.
 * 2. **La línea**, si está declarada: cuántos AGV entraron mientras tanto y si fue con su cadencia o
 *    estuvo sin paso. Con la línea en marcha, el problema no es de toda la producción.
 * 3. **El de delante**: el último que había pasado por ese tag, cuántos tags avanzó y hasta dónde.
 * 4. **Los de detrás**: los que llegaron a su último tag mientras tanto. En una guía no se adelanta:
 *    - si siguen avanzando y él reaparece **por delante** de ellos, él también avanzaba: **no registra
 *      lecturas** (no lee tags o no tiene wifi) y todo avanza con normalidad;
 *    - si llegan a donde él reaparece **antes que él**, lo adelantaron: no se movía en la guía (fuera de
 *      ella, una maniobra manual o una calle de carga);
 *    - si no pasan de su sitio, estaba **parado de verdad** y retenía la cola.
 * 5. **Cambio de AGV**: si no vuelve a leer, el AGV que empieza a leer por primera vez después, y dónde.
 *
 * Hechos, con sus cifras. La lectura final (no registra / parado con cola / sin datos) se da como lo
 * que es, una deducción de la guía, nunca como causa (R-EVI-006). Una calle de carga es el único sitio
 * donde se puede adelantar, y se dice.
 */

import type { Band } from "./segment-bands.js";
import type { Reading } from "./reading.js";

interface Step {
  readonly tagId: string;
  readonly utcMs: number;
}

export interface IncidentContext {
  readonly steps: ReadonlyMap<string, readonly Step[]>;
  /** Pasos por la entrada de la línea, ordenados. Vacío sin línea declarada. */
  readonly linePasses: readonly number[];
  /** La horquilla del tiempo entre pasos de la línea en el instante dado (según régimen). */
  readonly lineBandAt: (utcMs: number) => Band | null;
  /** La primera lectura de cada AGV en todo lo cargado. */
  readonly firstRead: ReadonlyMap<string, Step>;
  /** Paradas de la línea con AGV esperando (R-FLO-010): la cola que dejan no es una incidencia del AGV. */
  readonly lineStops: readonly { readonly from: number; readonly to: number }[];
  /** La calle de carga de cada tag de calle: un AGV callado ahí puede estar cargando. */
  readonly laneOf: ReadonlyMap<string, string>;
}

export interface Incident {
  readonly agvId: string;
  readonly fromTagId: string;
  readonly fromUtcMs: number;
  /** La siguiente lectura del AGV, o `null` si no vuelve a leer. */
  readonly toTagId: string | null;
  readonly toUtcMs: number | null;
}

export type IncidentReading = "no-registra" | "adelantado" | "fuera-o-sin-registrar" | "parado-con-cola" | "sin-datos";

export interface IncidentBattery {
  readonly durationMs: number;
  readonly line: { readonly passes: number; readonly moving: boolean; readonly cycleMs: number } | null;
  readonly ahead: { readonly agvId: string; readonly tagsAdvanced: number; readonly lastTagId: string } | null;
  readonly behind: {
    readonly reached: readonly string[];
    /** Los que llegaron y siguieron avanzando mientras él no leía, sin llegar a donde reaparece. */
    readonly moved: readonly string[];
    /** Los que llegaron a donde él reaparece antes que él: lo adelantaron. */
    readonly overtook: readonly string[];
    /** Los que llegaron y no pasaron de su sitio mientras tanto. */
    readonly held: readonly string[];
  };
  readonly swap: { readonly agvId: string; readonly tagId: string; readonly afterMs: number } | null;
  /** La parte de la incidencia en que la línea estaba parada con AGV esperando. */
  readonly lineStoppedMs: number;
  readonly reading: IncidentReading;
  /** Las mediciones en frases, en el orden de la batería. */
  readonly lines: readonly string[];
}

function duration(ms: number): string {
  return ms >= 120_000 ? `${(ms / 60_000).toFixed(1).replace(".", ",")} min` : `${Math.round(ms / 1000)} s`;
}

export function buildIncidentContext(
  readings: readonly Reading[],
  linePasses: readonly number[],
  lineBandAt: (utcMs: number) => Band | null,
  lineStops: readonly { readonly from: number; readonly to: number }[] = [],
  laneOf: ReadonlyMap<string, string> = new Map(),
): IncidentContext {
  const steps = new Map<string, Step[]>();
  for (const reading of readings) {
    const list = steps.get(reading.agvId) ?? [];
    list.push({ tagId: reading.tagId, utcMs: reading.time.utcMs });
    steps.set(reading.agvId, list);
  }
  const firstRead = new Map<string, Step>();
  for (const [agvId, list] of steps) {
    list.sort((a, b) => a.utcMs - b.utcMs);
    const collapsed = list.filter((step, index) => index === 0 || (list[index - 1] as Step).tagId !== step.tagId);
    steps.set(agvId, collapsed);
    if (collapsed[0] !== undefined) firstRead.set(agvId, collapsed[0]);
  }
  return { steps, linePasses: [...linePasses].sort((a, b) => a - b), lineBandAt, firstRead, lineStops, laneOf };
}

/** Índice de la primera lectura con hora > `utcMs`. */
function after(list: readonly Step[], utcMs: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as Step).utcMs <= utcMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function incidentBattery(context: IncidentContext, incident: Incident, windowEndUtcMs: number): IncidentBattery {
  const end = incident.toUtcMs ?? windowEndUtcMs;
  const durationMs = end - incident.fromUtcMs;
  const lines: string[] = [];
  lines.push(
    `Última lectura de ${incident.agvId}: ${incident.fromTagId}. ` +
      (incident.toTagId === null || incident.toUtcMs === null
        ? `No vuelve a leer en lo cargado (${duration(durationMs)} hasta el final).`
        : `La siguiente, ${duration(durationMs)} después, en ${incident.toTagId}.`),
  );

  const lane = context.laneOf.get(incident.fromTagId);
  if (lane !== undefined) {
    lines.push(`Su último tag es de la calle de carga ${lane}: allí se espera a cargar, y una carga es un silencio largo.`);
  }

  // 2. La línea.
  let line: IncidentBattery["line"] = null;
  const band = context.lineBandAt(incident.fromUtcMs);
  if (context.linePasses.length > 0 && band !== null) {
    const inside = context.linePasses.filter((utcMs) => utcMs > incident.fromUtcMs && utcMs <= end);
    const bounds = [incident.fromUtcMs, ...inside, end];
    let longest = 0;
    for (let index = 1; index < bounds.length; index += 1) longest = Math.max(longest, (bounds[index] as number) - (bounds[index - 1] as number));
    const moving = inside.length > 0 && longest <= band.fenceMs;
    line = { passes: inside.length, moving, cycleMs: band.p50Ms };
    const entered = `${inside.length === 1 ? "entró 1 AGV" : `entraron ${inside.length} AGV`}`;
    lines.push(
      moving
        ? `La línea siguió con su cadencia: ${entered}, lo habitual es uno cada ${duration(band.p50Ms)}.`
        : inside.length === 0
          ? "La línea estuvo sin paso todo ese tiempo."
          : `La línea estuvo sin paso hasta ${duration(longest)} seguidos en ese tiempo; ${entered}.`,
    );
  }

  // La parte en que la línea estaba parada con AGV esperando: la cola de la línea llega hasta aquí.
  let lineStoppedMs = 0;
  for (const stop of context.lineStops) {
    lineStoppedMs += Math.max(0, Math.min(stop.to, end) - Math.max(stop.from, incident.fromUtcMs));
  }
  if (lineStoppedMs * 2 >= durationMs && lineStoppedMs > 0) {
    lines.push(
      `La línea estuvo parada con AGV esperando ${duration(lineStoppedMs)} de esos ${duration(durationMs)}: es la cola de la línea parada, no algo del AGV.`,
    );
  }

  // 3. El de delante: el último otro AGV que pasó por su tag antes que él.
  let ahead: IncidentBattery["ahead"] = null;
  let aheadAt = -Infinity;
  for (const [agvId, list] of context.steps) {
    if (agvId === incident.agvId) continue;
    const index = after(list, incident.fromUtcMs) - 1;
    for (let at = index; at >= 0; at -= 1) {
      const step = list[at] as Step;
      if (step.tagId !== incident.fromTagId) continue;
      if (step.utcMs > aheadAt) {
        aheadAt = step.utcMs;
        const during = list.filter((entry) => entry.utcMs > incident.fromUtcMs && entry.utcMs <= end);
        ahead = { agvId, tagsAdvanced: during.length, lastTagId: during[during.length - 1]?.tagId ?? step.tagId };
      }
      break;
    }
  }
  if (ahead !== null) {
    lines.push(
      ahead.tagsAdvanced === 0
        ? `El de delante, ${ahead.agvId}, tampoco leyó ningún tag mientras tanto.`
        : `El de delante, ${ahead.agvId}, avanzó ${ahead.tagsAdvanced} ${ahead.tagsAdvanced === 1 ? "tag" : "tags"} en ese tiempo, hasta ${ahead.lastTagId}.`,
    );
  }

  // 4. Los de detrás: los que llegan a su último tag mientras él no lee.
  const reached: string[] = [];
  const moved: string[] = [];
  const overtook: string[] = [];
  const held: string[] = [];
  let lapped = 0;
  for (const [agvId, list] of context.steps) {
    if (agvId === incident.agvId) continue;
    const start = after(list, incident.fromUtcMs);
    let arrived = -1;
    for (let at = start; at < list.length && (list[at] as Step).utcMs <= end; at += 1) {
      if ((list[at] as Step).tagId === incident.fromTagId) {
        arrived = at;
        break;
      }
    }
    if (arrived < 0) continue;
    reached.push(agvId);
    const beyond = list.slice(arrived + 1).filter((step) => step.utcMs <= end);
    // Pasar dos veces por su sitio es una vuelta entera: ya no se puede decir que él siguiera en la guía.
    if (beyond.some((step) => step.tagId === incident.fromTagId)) lapped += 1;
    // Llegar a donde él reaparece antes que él es adelantarlo.
    if (incident.toTagId !== null && beyond.some((step) => step.tagId === incident.toTagId)) overtook.push(agvId);
    else if (beyond.length > 0) moved.push(agvId);
    else held.push(agvId);
  }
  if (reached.length === 0) lines.push("Ningún AGV llegó a su último tag mientras tanto.");
  else {
    const parts = [
      moved.length === 0 ? null : `${moved.length} ${moved.length === 1 ? "siguió avanzando" : "siguieron avanzando"}`,
      overtook.length === 0
        ? null
        : `${overtook.length} ${overtook.length === 1 ? "llegó" : "llegaron"} a ${incident.toTagId ?? "—"} antes que él`,
      held.length === 0 ? null : `${held.length} no ${held.length === 1 ? "pasó" : "pasaron"} de ahí`,
    ].filter((part): part is string => part !== null);
    lines.push(
      `Detrás, ${reached.length} ${reached.length === 1 ? "AGV llegó" : "AGV llegaron"} a ${incident.fromTagId} mientras tanto: ${parts.join(", ")}.`,
    );
  }

  // 5. Cambio de AGV: si no vuelve, el primero que empieza a leer después.
  let swap: IncidentBattery["swap"] = null;
  if (incident.toUtcMs === null) {
    let best: IncidentBattery["swap"] = null;
    for (const [agvId, first] of context.firstRead) {
      if (agvId === incident.agvId || first.utcMs <= incident.fromUtcMs) continue;
      const afterMs = first.utcMs - incident.fromUtcMs;
      if (best === null || afterMs < best.afterMs) best = { agvId, tagId: first.tagId, afterMs };
    }
    swap = best;
    lines.push(
      swap === null
        ? "Ningún AGV nuevo empieza a leer después."
        : `Cambio de AGV candidato: ${swap.agvId} empieza a leer ${duration(swap.afterMs)} después, en ${swap.tagId}.`,
    );
  }

  const reading: IncidentReading =
    overtook.length > 0
      ? "adelantado"
      : moved.length > 0
        ? lapped > 0 || incident.toTagId === null
          ? "fuera-o-sin-registrar"
          : "no-registra"
        : held.length > 0
          ? "parado-con-cola"
          : "sin-datos";
  lines.push(
    reading === "adelantado"
      ? `Los de detrás llegaron a ${incident.toTagId ?? "—"} antes que ${incident.agvId}, y en una guía no se adelanta: ${incident.agvId} no se movía en la guía (fuera de ella, una maniobra manual o una calle de carga).`
      : reading === "fuera-o-sin-registrar"
        ? `Los de detrás siguieron avanzando${lapped > 0 ? ` y ${lapped} ${lapped === 1 ? "dio" : "dieron"} una vuelta entera` : ""} mientras tanto: ${incident.agvId} salió de la guía o avanzó sin registrar lecturas. El dato no dice cuál.`
        : reading === "no-registra"
          ? `Los de detrás siguieron avanzando y ${incident.agvId} reapareció por delante de ellos: avanzaba sin que se registraran sus lecturas. Probablemente no lee tags o no tiene wifi, y todo avanza con normalidad.`
          : reading === "parado-con-cola"
            ? `Los que llegaron detrás no pasaron de su sitio: ${incident.agvId} estaba parado de verdad y retenía la cola.`
            : "Sin AGV detrás en ese tiempo, el dato no dice si avanzaba sin registrar o estaba parado.",
  );

  return { durationMs, line, ahead, behind: { reached, moved, overtook, held }, swap, lineStoppedMs, reading, lines };
}

/**
 * AGV que dejan de leer antes del final de lo cargado: su silencio hasta el final es más largo que el
 * hueco más largo que ese mismo AGV tuvo antes y del que volvió. Cada AGV contra sí mismo, porque los
 * silencios normales van de una hora a varias según el AGV (noche, carga, sin conexión).
 */
export function abandonedReadings(context: IncidentContext, windowEndUtcMs: number): readonly Incident[] {
  const out: Incident[] = [];
  for (const [agvId, list] of context.steps) {
    const last = list[list.length - 1];
    if (last === undefined || list.length < 2) continue;
    let longest = 0;
    for (let index = 1; index < list.length; index += 1) {
      longest = Math.max(longest, (list[index] as Step).utcMs - (list[index - 1] as Step).utcMs);
    }
    if (windowEndUtcMs - last.utcMs > longest) {
      out.push({ agvId, fromTagId: last.tagId, fromUtcMs: last.utcMs, toTagId: null, toUtcMs: null });
    }
  }
  return out.sort((a, b) => a.fromUtcMs - b.fromUtcMs);
}

export type IncidentKind = "parada-sin-explicacion" | "bloqueo" | "deja-de-leer";

export interface IncidentRecord {
  readonly kind: IncidentKind;
  readonly incident: Incident;
  readonly battery: IncidentBattery;
}

const KIND_TEXT: Readonly<Record<IncidentKind, string>> = {
  "parada-sin-explicacion": "parada sin explicación",
  bloqueo: "primero de cola sin avanzar",
  "deja-de-leer": "deja de leer",
};

const READING_TEXT: Readonly<Record<IncidentReading, string>> = {
  "no-registra": "avanzaba sin registrar",
  adelantado: "lo adelantaron",
  "fuera-o-sin-registrar": "fuera de la guía o sin registrar",
  "parado-con-cola": "parado con cola",
  "sin-datos": "sin datos",
};

/** Todas las incidencias con su batería, en CSV con `;`: una fila por incidencia, para planta. */
export function incidentsCsv(records: readonly IncidentRecord[], formatTime: (utcMs: number) => string): string {
  const cell = (value: string | number | null): string => (value === null ? "" : String(value).replace(/[;\r\n]/g, ","));
  const lines = [
    "tipo;agv;ultimo_tag;desde;siguiente_tag;hasta;minutos;linea_pasos;linea_con_cadencia;min_linea_parada;delante;delante_tags;detras_llegan;detras_avanzan;detras_adelantan;detras_se_quedan;cambio_de_agv;lectura;mediciones",
  ];
  for (const { kind, incident, battery } of records) {
    lines.push(
      [
        KIND_TEXT[kind],
        incident.agvId,
        incident.fromTagId,
        formatTime(incident.fromUtcMs),
        incident.toTagId,
        incident.toUtcMs === null ? null : formatTime(incident.toUtcMs),
        (battery.durationMs / 60_000).toFixed(1).replace(".", ","),
        battery.line?.passes ?? null,
        battery.line === null ? null : battery.line.moving ? "sí" : "no",
        (battery.lineStoppedMs / 60_000).toFixed(1).replace(".", ","),
        battery.ahead?.agvId ?? null,
        battery.ahead?.tagsAdvanced ?? null,
        battery.behind.reached.length,
        battery.behind.moved.length,
        battery.behind.overtook.length,
        battery.behind.held.length,
        battery.swap === null ? null : `${battery.swap.agvId} en ${battery.swap.tagId}`,
        READING_TEXT[battery.reading],
        battery.lines.join(" "),
      ]
        .map(cell)
        .join(";"),
    );
  }
  return lines.join("\r\n");
}
