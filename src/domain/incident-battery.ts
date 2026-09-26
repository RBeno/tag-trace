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
 *    - si no pasan de su sitio y esperan ahí más de lo habitual del tramo, estaba **parado de verdad**
 *      y retenía la cola; uno que acaba de llegar no prueba nada. Lo habitual es la valla del tramo
 *      o, sin horquilla, lo que el propio AGV tardó en llegar a ese tag; sin ninguna, no se afirma.
 * 5. **Cambio de AGV**: si no vuelve a leer, el AGV que empieza a leer por primera vez después, y dónde.
 *
 * Hechos, con sus cifras. La lectura final (no registra / parado con cola / sin datos) se da como lo
 * que es, una deducción de la guía, nunca como causa (R-EVI-006). Una calle de carga es el único sitio
 * donde se puede adelantar, y se dice.
 */

import type { Band, Regime } from "./segment-bands.js";
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
  /**
   * Lo habitual desde un tag hasta la siguiente lectura en ese instante (la valla de su horquilla), o
   * `null` sin horquilla. Con ella se juzga si un AGV que llegó al tag de la incidencia y no pasó de
   * ahí esperó de verdad o simplemente acababa de llegar (sin ella, con el paso del propio AGV).
   */
  readonly usualDwellMs: (tagId: string, utcMs: number) => number | null;
  /**
   * El régimen de cada instante (R-TIM-009). El «deja de leer» mide el hueco de referencia de cada AGV
   * solo con sus huecos de producción: quien vivió una noche no puede callar siete horas sin
   * declararse (OQ-138, 2026-09-26). Por defecto todo es producción, que es lo que se hacía antes.
   */
  readonly regimeOf: (utcMs: number) => Regime;
  /** Las paradas de la producción (R-AGV-018): un hueco que cruza una no es un hueco de producción. */
  readonly productionStops: readonly { readonly fromUtcMs: number; readonly toUtcMs: number }[];
}

/**
 * Con qué se comparó un «deja de leer»: el silencio final del AGV, contado solo en producción, contra
 * su hueco de producción más largo del que volvió. Va en la incidencia para que la evidencia lo diga.
 */
export interface AbandonReference {
  /** El hueco de producción más largo del que el AGV volvió a leer. */
  readonly referenceGapMs: number;
  /** Cuántos huecos de producción lo sostienen. */
  readonly productionGaps: number;
  /** Cuántos huecos suyos se dejaron fuera por cruzar la noche o una parada de la producción. */
  readonly excludedGaps: number;
  /** El silencio final medido en producción: sin la noche ni las paradas de la producción. */
  readonly silenceMs: number;
}

export interface Incident {
  readonly agvId: string;
  readonly fromTagId: string;
  readonly fromUtcMs: number;
  /** La siguiente lectura del AGV, o `null` si no vuelve a leer. */
  readonly toTagId: string | null;
  readonly toUtcMs: number | null;
  /** Solo en un «deja de leer»: con qué hueco de referencia se comparó. */
  readonly reference?: AbandonReference;
}

export type IncidentReading = "no-registra" | "adelantado" | "fuera-o-sin-registrar" | "parado-con-cola" | "sin-datos";

export interface IncidentBattery {
  readonly durationMs: number;
  /**
   * `moving` es `true` con paso y ningún hueco por encima de la valla, `false` con un hueco por encima,
   * y `null` cuando la incidencia es más corta que la valla y no entró nadie: no le tocaba entrar a
   * ningún AGV, así que no se puede juzgar la línea.
   */
  readonly line: { readonly passes: number; readonly moving: boolean | null; readonly cycleMs: number } | null;
  readonly ahead: { readonly agvId: string; readonly tagsAdvanced: number; readonly lastTagId: string } | null;
  readonly behind: {
    readonly reached: readonly string[];
    /** Los que llegaron y siguieron avanzando mientras él no leía, sin llegar a donde reaparece. */
    readonly moved: readonly string[];
    /** Los que llegaron a donde él reaparece antes que él: lo adelantaron. */
    readonly overtook: readonly string[];
    /** Los que llegaron y no pasaron de su sitio mientras tanto, esperando más de lo habitual. */
    readonly held: readonly string[];
    /**
     * Los que llegaron y no pasaron de su sitio sin que se pueda decir que esperaran: acababan de
     * llegar, o no hay horquilla con que medirlo.
     */
    readonly unsure: readonly string[];
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
  usualDwellMs: (tagId: string, utcMs: number) => number | null = () => null,
  regimeOf: (utcMs: number) => Regime = () => "produccion",
  productionStops: readonly { readonly fromUtcMs: number; readonly toUtcMs: number }[] = [],
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
  return {
    steps,
    linePasses: [...linePasses].sort((a, b) => a - b),
    lineBandAt,
    firstRead,
    lineStops,
    laneOf,
    usualDwellMs,
    regimeOf,
    productionStops,
  };
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
    // Sin ningún paso dentro y con la incidencia más corta que la valla, no le tocaba entrar a nadie:
    // decir «sin paso» sería afirmar una parada de la línea que el dato no sostiene.
    const moving: boolean | null = longest <= band.fenceMs ? (inside.length > 0 ? true : null) : false;
    line = { passes: inside.length, moving, cycleMs: band.p50Ms };
    const entered = `${inside.length === 1 ? "entró 1 AGV" : `entraron ${inside.length} AGV`}`;
    lines.push(
      moving === true
        ? `La línea siguió con su cadencia: ${entered}, lo habitual es uno cada ${duration(band.p50Ms)}.`
        : moving === null
          ? `La incidencia (${duration(durationMs)}) es más corta que un ciclo de la línea (hasta ${duration(band.fenceMs)}): no se puede juzgar si la línea seguía.`
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
  const unsure: string[] = [];
  const dwellText: string[] = [];
  let lapped = 0;
  // Con qué se compara lo que espera el de detrás: la valla del tramo si hay horquilla; si no, lo que
  // el propio AGV de la incidencia tardó en llegar a ese tag desde su lectura anterior, un paso
  // circulando medido ahí mismo. Sin ninguna de las dos, no se afirma que nadie esperara.
  const usualAt = (utcMs: number): number | null => {
    const fromBand = context.usualDwellMs(incident.fromTagId, utcMs);
    if (fromBand !== null) return fromBand;
    const own = context.steps.get(incident.agvId) ?? [];
    const index = after(own, incident.fromUtcMs) - 1;
    const previous = index > 0 && (own[index] as Step).tagId === incident.fromTagId ? own[index - 1] : undefined;
    return previous === undefined || incident.fromUtcMs <= previous.utcMs ? null : incident.fromUtcMs - previous.utcMs;
  };
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
    const arrival = list[arrived] as Step;
    const beyond = list.slice(arrived + 1).filter((step) => step.utcMs <= end);
    // Pasar dos veces por su sitio es una vuelta entera: ya no se puede decir que él siguiera en la guía.
    if (beyond.some((step) => step.tagId === incident.fromTagId)) lapped += 1;
    // Llegar a donde él reaparece antes que él es adelantarlo. Si reaparece por su mismo tag, llegar a
    // ese tag ya es llegar a donde reaparece: el otro pasó por ahí y él volvió a leerlo detrás.
    if (incident.toTagId !== null && (incident.toTagId === incident.fromTagId || beyond.some((step) => step.tagId === incident.toTagId))) {
      overtook.push(agvId);
    } else if (beyond.length > 0) moved.push(agvId);
    else {
      // No pasó de ahí. Solo cuenta como retenido si esperó en el tag más de lo habitual de ese tramo:
      // uno que llegó justo antes de que él reapareciera no prueba ninguna cola. Lo que esperó va
      // hasta su siguiente lectura, o hasta el final de la incidencia si no la hay: es un mínimo.
      const next = list[arrived + 1];
      const dwellMs = (next?.utcMs ?? end) - arrival.utcMs;
      const usual = usualAt(arrival.utcMs);
      const waited = usual !== null && dwellMs > usual;
      (waited ? held : unsure).push(agvId);
      dwellText.push(
        `${agvId} ${next === undefined ? "seguía allí" : "estuvo"} ${duration(dwellMs)}${
          usual === null ? " (sin nada con que comparar lo que se tarda ahí)" : waited ? ` (lo habitual ahí, hasta ${duration(usual)})` : ` (dentro de lo habitual ahí, hasta ${duration(usual)})`
        }`,
      );
    }
  }
  if (reached.length === 0) lines.push("Ningún AGV llegó a su último tag mientras tanto.");
  else {
    const stayed = held.length + unsure.length;
    const parts = [
      moved.length === 0 ? null : `${moved.length} ${moved.length === 1 ? "siguió avanzando" : "siguieron avanzando"}`,
      overtook.length === 0
        ? null
        : `${overtook.length} ${overtook.length === 1 ? "llegó" : "llegaron"} a ${incident.toTagId ?? "—"} antes que él`,
      stayed === 0 ? null : `${stayed} no ${stayed === 1 ? "pasó" : "pasaron"} de ahí (${dwellText.join("; ")})`,
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

  // Un «deja de leer» dice con qué se comparó: el silencio en producción y el hueco de referencia,
  // medido solo con huecos de producción (OQ-138).
  if (incident.reference !== undefined) {
    const ref = incident.reference;
    lines.push(
      `Deja de leer: lleva ${duration(ref.silenceMs)} de producción sin leer hasta el final, más que su hueco de producción ` +
        `más largo del que volvió, ${duration(ref.referenceGapMs)} (de ${ref.productionGaps} ${ref.productionGaps === 1 ? "hueco" : "huecos"} ` +
        `de producción${ref.excludedGaps > 0 ? `; ${ref.excludedGaps} que ${ref.excludedGaps === 1 ? "cruza" : "cruzan"} la noche o una parada de la producción no ${ref.excludedGaps === 1 ? "cuenta" : "cuentan"}` : ""}). ` +
        "Medido en producción: la noche y las paradas de la producción no suman.",
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
  const onlyUnsure = reading === "sin-datos" && unsure.length > 0;
  lines.push(
    reading === "adelantado"
      ? `Los de detrás llegaron a ${incident.toTagId ?? "—"} antes que ${incident.agvId}, y en una guía no se adelanta: ${incident.agvId} no se movía en la guía (fuera de ella, una maniobra manual o una calle de carga).`
      : reading === "fuera-o-sin-registrar"
        ? `Los de detrás siguieron avanzando${lapped > 0 ? ` y ${lapped} ${lapped === 1 ? "dio" : "dieron"} una vuelta entera` : ""} mientras tanto: ${incident.agvId} salió de la guía o avanzó sin registrar lecturas. El dato no dice cuál.`
        : reading === "no-registra"
          ? `Los de detrás siguieron avanzando y ${incident.agvId} reapareció por delante de ellos: avanzaba sin que se registraran sus lecturas. Probablemente no lee tags o no tiene wifi, y todo avanza con normalidad.`
          : reading === "parado-con-cola"
            ? `Los que llegaron detrás esperaron en su sitio más de lo habitual: ${incident.agvId} estaba parado de verdad y retenía la cola.`
            : onlyUnsure
              ? `Los que llegaron detrás no pasaron de su sitio, pero no esperaron más de lo habitual (o no hay con qué medirlo): el dato no dice si ${incident.agvId} avanzaba sin registrar o estaba parado.`
              : "Sin AGV detrás en ese tiempo, el dato no dice si avanzaba sin registrar o estaba parado.",
  );

  return { durationMs, line, ahead, behind: { reached, moved, overtook, held, unsure }, swap, lineStoppedMs, reading, lines };
}

/** Con qué paso se busca un cambio de régimen dentro de un tramo, y a qué resolución se afina. */
const REGIME_SCAN_MS = 15 * 60_000;
const REGIME_RESOLUTION_MS = 60_000;

/**
 * Cuánto de `[from, to]` es producción según `regimeOf`. El régimen se muestrea cada cuarto de hora y
 * cada cambio se afina al minuto por bisección: es una resolución de cálculo, no una constante de
 * planta (los regímenes se declaran por horas en la configuración).
 */
function productionMs(from: number, to: number, regimeOf: (utcMs: number) => Regime): number {
  if (to <= from) return 0;
  let total = 0;
  let cursor = from;
  let regime = regimeOf(from);
  while (cursor < to) {
    const next = Math.min(to, cursor + REGIME_SCAN_MS);
    const nextRegime = regimeOf(next);
    if (nextRegime === regime) {
      if (regime === "produccion") total += next - cursor;
      cursor = next;
      continue;
    }
    // Cambio dentro del tramo: se busca el instante al minuto.
    let lo = cursor;
    let hi = next;
    while (hi - lo > REGIME_RESOLUTION_MS) {
      const mid = (lo + hi) / 2;
      if (regimeOf(mid) === regime) lo = mid;
      else hi = mid;
    }
    if (regime === "produccion") total += hi - cursor;
    cursor = hi;
    regime = nextRegime;
  }
  return total;
}

/**
 * AGV que dejan de leer antes del final de lo cargado: su silencio hasta el final, contado solo en
 * producción, es más largo que el **hueco de producción** más largo que ese mismo AGV tuvo antes y del
 * que volvió. Cada AGV contra sí mismo, porque los silencios normales van de minutos a horas según el
 * AGV (carga, sin conexión). Un hueco que cruza la noche o una parada de la producción no es un hueco de
 * producción y no entra en la referencia (OQ-138, 2026-09-26): con él, quien vivió una noche podía
 * callar siete horas sin declararse. Sin ningún hueco de producción no hay referencia y no se juzga.
 */
export function abandonedReadings(context: IncidentContext, windowEndUtcMs: number): readonly Incident[] {
  const out: Incident[] = [];
  const inProductionStop = (from: number, to: number): boolean =>
    context.productionStops.some((stop) => stop.fromUtcMs < to && from < stop.toUtcMs);
  for (const [agvId, list] of context.steps) {
    const last = list[list.length - 1];
    if (last === undefined || list.length < 2) continue;
    let longest = 0;
    let productionGaps = 0;
    let excludedGaps = 0;
    for (let index = 1; index < list.length; index += 1) {
      const from = (list[index - 1] as Step).utcMs;
      const to = (list[index] as Step).utcMs;
      // Un hueco es de producción si toda su duración es producción y no cruza ninguna parada de la
      // producción. La propia lectura puede caer justo al cambiar el régimen: se admite la resolución.
      const isProduction = !inProductionStop(from, to) && to - from - productionMs(from, to, context.regimeOf) < REGIME_RESOLUTION_MS;
      if (!isProduction) {
        excludedGaps += 1;
        continue;
      }
      productionGaps += 1;
      longest = Math.max(longest, to - from);
    }
    if (productionGaps === 0) continue;
    const silenceMs = outsideStops(last.utcMs, windowEndUtcMs, context.productionStops).reduce(
      (sum, piece) => sum + productionMs(piece.from, piece.to, context.regimeOf),
      0,
    );
    if (silenceMs > longest) {
      out.push({
        agvId,
        fromTagId: last.tagId,
        fromUtcMs: last.utcMs,
        toTagId: null,
        toUtcMs: null,
        reference: { referenceGapMs: longest, productionGaps, excludedGaps, silenceMs },
      });
    }
  }
  return out.sort((a, b) => a.fromUtcMs - b.fromUtcMs);
}

/** Los trozos de `[from, to]` que quedan fuera de las paradas de la producción. */
function outsideStops(
  from: number,
  to: number,
  stops: readonly { readonly fromUtcMs: number; readonly toUtcMs: number }[],
): readonly { readonly from: number; readonly to: number }[] {
  const pieces: { from: number; to: number }[] = [];
  let cursor = from;
  for (const stop of [...stops].sort((a, b) => a.fromUtcMs - b.fromUtcMs)) {
    if (stop.toUtcMs <= cursor || stop.fromUtcMs >= to) continue;
    if (stop.fromUtcMs > cursor) pieces.push({ from: cursor, to: stop.fromUtcMs });
    cursor = Math.max(cursor, stop.toUtcMs);
  }
  if (cursor < to) pieces.push({ from: cursor, to });
  return pieces;
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
        battery.line === null ? null : battery.line.moving === null ? "sin juzgar" : battery.line.moving ? "sí" : "no",
        (battery.lineStoppedMs / 60_000).toFixed(1).replace(".", ","),
        battery.ahead?.agvId ?? null,
        battery.ahead?.tagsAdvanced ?? null,
        battery.behind.reached.length,
        battery.behind.moved.length,
        battery.behind.overtook.length,
        battery.behind.held.length + battery.behind.unsure.length,
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
