/**
 * Tiempo canónico (ADR-0013).
 *
 * Toda observación conserva a la vez el instante calculable, la cadena original y el contexto que
 * permitió interpretarla. El cambio horario estacional no se resuelve en silencio: se marca.
 */

/** Marca del estado de una conversión respecto al cambio horario estacional. */
export type TimeFlag =
  /** Instante único y no ambiguo. */
  | "ok"
  /** Hora repetida al retrasar el reloj: el mismo texto corresponde a dos instantes. */
  | "dst_ambiguous"
  /**
   * Hora repetida que se resolvió por la **posición en el fichero** (OQ-137, decisión del
   * propietario 2026-09-26). El texto sigue siendo el mismo para las dos ocurrencias, pero la
   * posición en la pila dice a cuál pertenece la fila, y con eso el instante vuelve a ordenar.
   */
  | "dst_by_position"
  /** Hora inexistente al adelantarlo: el texto no corresponde a ningún instante. */
  | "dst_nonexistent";

/**
 * Si el instante de una lectura sirve para afirmar orden.
 *
 * `ok` y `dst_by_position` sí: en el segundo caso la hora era repetida pero la posición en el
 * fichero dijo a qué ocurrencia pertenece. `dst_ambiguous` y `dst_nonexistent` no: el reloj no
 * separa las dos ocurrencias ni hay un instante al que corresponda el texto (ADR-0013).
 */
export function isOrderReliable(flag: TimeFlag): boolean {
  return flag === "ok" || flag === "dst_by_position";
}

/** Representación canónica de un instante. Nunca se guarda solo `utcMs`. */
export interface CanonicalTime {
  /** Milisegundos desde epoch UTC. Es el único valor que se usa para calcular. */
  readonly utcMs: number;
  /** La cadena original, sin normalizar. */
  readonly raw: string;
  /** Identificador IANA de la zona aplicada. */
  readonly zone: string;
  readonly flag: TimeFlag;
}

export type TimeParseError =
  /** El texto no encaja con ningún formato admitido. */
  | "UNPARSEABLE"
  /** Los campos existen pero no forman una fecha válida (mes 13, día 32…). */
  | "INVALID_FIELDS";

export type TimeParseResult =
  | { readonly ok: true; readonly time: CanonicalTime }
  | { readonly ok: false; readonly error: TimeParseError };

/** Componentes de reloj de pared, sin zona todavía. */
interface WallClock {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * `d/m/aaaa H:MM` y `d/m/aaaa H:MM:SS`, con día, mes y hora que pueden venir sin cero a la
 * izquierda. Es la forma que exporta la fuente real; el separador de fecha admite `/` o `-`.
 */
const WALL_PATTERN =
  /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(zone, formatter);
  }
  return formatter;
}

/** Lee qué hora de pared marca `utcMs` en `zone`. */
function wallClockAt(utcMs: number, zone: string): WallClock {
  const parts = zoneFormatter(zone).formatToParts(new Date(utcMs));
  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type);
    return part === undefined ? 0 : Number(part.value);
  };
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
}

function asUtcMs(wall: WallClock): number {
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
}

/**
 * Días reales del mes, bisiestos incluidos. El día cero del mes siguiente es el último del actual.
 *
 * Una fecha imposible (31 de abril) se rechaza **antes** de tocar la zona horaria: es un defecto de
 * la fuente, no un efecto del reloj, y confundir las dos cosas hacía que el 31 de abril acabara
 * marcado como hora inexistente en lugar de como fila inválida.
 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Desplazamiento de la zona, en milisegundos, en el instante dado. */
function zoneOffsetMs(utcMs: number, zone: string): number {
  return asUtcMs(wallClockAt(utcMs, zone)) - utcMs;
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Convierte una hora de pared a instante UTC, detectando los dos casos del cambio estacional.
 *
 * **Por qué no se itera.** El método habitual —suponer que la hora de pared es UTC, medir el
 * desplazamiento, corregir y volver a medir— converge, y ese es justo el problema: en el cambio de
 * octubre converge siempre al segundo instante, así que los dos desplazamientos salen iguales y la
 * hora repetida se daría por única. Una hora que ocurre dos veces entraría como normal.
 *
 * Lo que se hace en su lugar es tomar los dos regímenes de desplazamiento que rodean cualquier
 * transición —el de 24 h antes y el de 24 h después—, construir los candidatos que producen y
 * contar cuántos, releídos en la zona, reproducen exactamente la hora pedida: los dos (hora
 * repetida), uno (hora normal) o ninguno (hora inexistente).
 */
export function wallClockToUtc(
  wall: WallClock,
  zone: string,
): { readonly utcMs: number; readonly flag: TimeFlag } {
  const { candidates, matches } = instantsFor(wall, zone);

  if (matches.length >= 2) {
    // Hora repetida: se conserva la primera ocurrencia y se marca. Por sí sola no sirve para afirmar
    // orden; la posición en el fichero puede resolverla después (`resolveRepeatedHourByPosition`).
    return { utcMs: Math.min(...matches), flag: "dst_ambiguous" };
  }
  if (matches.length === 1) {
    return { utcMs: matches[0] as number, flag: "ok" };
  }
  // Hora inexistente: el reloj saltó por encima. Se conserva el instante en que el salto terminó.
  return { utcMs: Math.max(...candidates), flag: "dst_nonexistent" };
}

/** Los instantes que producen los dos regímenes de desplazamiento y cuáles reproducen la hora pedida. */
function instantsFor(
  wall: WallClock,
  zone: string,
): { readonly candidates: readonly number[]; readonly matches: readonly number[] } {
  const naive = asUtcMs(wall);
  const offsets = [zoneOffsetMs(naive - DAY_MS, zone), zoneOffsetMs(naive + DAY_MS, zone)];
  const candidates = [...new Set(offsets.map((offset) => naive - offset))];
  const matches = candidates.filter((candidate) => sameWallClock(wallClockAt(candidate, zone), wall));
  return { candidates, matches };
}

/**
 * Los dos instantes de una hora repetida: el de antes de retrasar el reloj y el de después.
 *
 * Se parte del instante ya calculado (la primera ocurrencia) y se relee su hora de pared, así que no
 * hace falta volver a parsear la cadena original ni conocer el orden de campos con que se leyó.
 */
function repeatedHourInstants(
  utcMs: number,
  zone: string,
): { readonly first: number; readonly second: number } | undefined {
  const wall = wallClockAt(utcMs, zone);
  const { matches } = instantsFor(wall, zone);
  if (matches.length < 2) return undefined;
  return { first: Math.min(...matches), second: Math.max(...matches) };
}

export interface RepeatedHourResolution {
  /** Los mismos instantes, en el mismo orden, con las horas repetidas resueltas donde se pudo. */
  readonly times: readonly CanonicalTime[];
  /** Cuántas horas repetidas pasaron a `dst_by_position`. */
  readonly resolvedByPosition: number;
  /** Cuántas siguen `dst_ambiguous` porque el fichero no dio contexto para afirmar nada. */
  readonly stillAmbiguous: number;
}

/**
 * Desambigua la hora repetida del cambio de octubre por la **posición en el fichero** (OQ-137).
 *
 * La hora de cada fila es la de recepción en el servidor y el fichero es una pila global, así que
 * la posición ordena las filas de todos los vehículos a la vez: el criterio es global, no por
 * vehículo. Quien llama debe pasar los instantes **en el orden cronológico del fichero** (leído del
 * revés si la fuente emite como pila); si el sentido no se pudo medir no debe llamar, porque la
 * posición no significa nada sin él.
 *
 * Las filas `dst_ambiguous` forman rachas contiguas. Dentro de una racha la hora de pared sube de
 * 02:00 a 02:59 y, si el fichero abarca las dos ocurrencias, **vuelve a empezar** en 02:00:
 *
 * - con exactamente un retroceso, las filas de antes son la primera ocurrencia (el instante que ya
 *   tenían) y las de después la segunda (una hora más tarde en Europa/Madrid);
 * - sin retroceso, la racha es la segunda ocurrencia si la fila que la sigue cronológicamente es
 *   una hora normal de la hora de pared **inmediatamente siguiente** del mismo día (03:xx): entre
 *   una racha y esas filas no cabe otra ocurrencia entera;
 * - en cualquier otro caso —racha al final del fichero, precedida por 01:xx y sin 03:xx detrás, o
 *   con varios retrocesos, que es un desorden y no un cambio de hora— no se afirma nada y la racha
 *   sigue `dst_ambiguous`.
 *
 * Una racha precedida por 01:xx y sin 03:xx detrás **no** se declara primera ocurrencia aunque lo
 * parezca: la exportación pudo cortarse en medio de la segunda con la primera vacía, y elegir la
 * hipótesis más probable es justo lo que ADR-0013 prohíbe.
 */
export function resolveRepeatedHourByPosition(times: readonly CanonicalTime[]): RepeatedHourResolution {
  const out = [...times];
  let resolvedByPosition = 0;
  let stillAmbiguous = 0;

  let index = 0;
  while (index < out.length) {
    if ((out[index] as CanonicalTime).flag !== "dst_ambiguous") {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < out.length && (out[end] as CanonicalTime).flag === "dst_ambiguous") end += 1;

    const split = splitRepeatedHourRun(out, index, end);
    if (split === undefined) {
      stillAmbiguous += end - index;
    } else {
      for (let at = index; at < end; at += 1) {
        const time = out[at] as CanonicalTime;
        const instants = repeatedHourInstants(time.utcMs, time.zone);
        if (instants === undefined) {
          // No debería ocurrir: una `dst_ambiguous` siempre tiene dos instantes. Si pasa, no se inventa.
          stillAmbiguous += 1;
          continue;
        }
        out[at] = {
          ...time,
          utcMs: at < split ? instants.first : instants.second,
          flag: "dst_by_position",
        };
        resolvedByPosition += 1;
      }
    }
    index = end;
  }

  return { times: out, resolvedByPosition, stillAmbiguous };
}

/**
 * Dónde empieza la segunda ocurrencia dentro de la racha `[start, end)`, o `undefined` si el
 * fichero no permite afirmarlo. `start` significa «toda la racha es la segunda ocurrencia».
 *
 * Todas las filas de la racha llevan el instante de la primera ocurrencia, así que compararlos
 * equivale a comparar sus horas de pared: un retroceso del instante es un retroceso del reloj.
 */
function splitRepeatedHourRun(
  times: readonly CanonicalTime[],
  start: number,
  end: number,
): number | undefined {
  const zone = (times[start] as CanonicalTime).zone;
  const setbacks: number[] = [];
  for (let at = start + 1; at < end; at += 1) {
    const previous = times[at - 1] as CanonicalTime;
    const current = times[at] as CanonicalTime;
    // Zonas distintas en la misma racha no tienen comparación posible; se deja sin afirmar.
    if (current.zone !== zone) return undefined;
    if (current.utcMs < previous.utcMs) setbacks.push(at);
  }

  if (setbacks.length === 1) return setbacks[0] as number;
  if (setbacks.length > 1) return undefined;

  const follower = times[end];
  if (follower === undefined || follower.flag !== "ok" || follower.zone !== zone) return undefined;
  const last = wallClockAt((times[end - 1] as CanonicalTime).utcMs, zone);
  const next = wallClockAt(follower.utcMs, zone);
  const sameDay = last.year === next.year && last.month === next.month && last.day === next.day;
  return sameDay && next.hour === last.hour + 1 ? start : undefined;
}

/** Orden de los dos primeros campos de una fecha numérica. */
export type FieldOrder = "day-first" | "month-first";

export interface TimeParseOptions {
  readonly zone: string;
  readonly order: FieldOrder;
}

/**
 * Interpreta un texto de fecha con un orden de campos **declarado**.
 *
 * El orden nunca se adivina aquí: quien llama debe haberlo determinado antes sobre el conjunto del
 * fichero (ver `detectFieldOrder`). Una fila suelta no contiene información suficiente para
 * decidirlo, y suponerlo es el error que ADR-0013 prohíbe.
 */
export function parseTimestamp(raw: string, options: TimeParseOptions): TimeParseResult {
  const match = WALL_PATTERN.exec(raw.trim());
  if (match === null) return { ok: false, error: "UNPARSEABLE" };

  const first = Number(match[1]);
  const second = Number(match[2]);
  const wall: WallClock = {
    year: Number(match[3]),
    month: options.order === "day-first" ? second : first,
    day: options.order === "day-first" ? first : second,
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: match[6] === undefined ? 0 : Number(match[6]),
  };

  if (
    wall.month < 1 ||
    wall.month > 12 ||
    wall.day < 1 ||
    wall.day > daysInMonth(wall.year, wall.month) ||
    wall.hour > 23 ||
    wall.minute > 59 ||
    wall.second > 59
  ) {
    return { ok: false, error: "INVALID_FIELDS" };
  }

  const { utcMs, flag } = wallClockToUtc(wall, options.zone);
  return { ok: true, time: { utcMs, raw, zone: options.zone, flag } };
}

/**
 * Qué abarcaría el fichero leído con cada uno de los dos órdenes posibles.
 *
 * Es lo que convierte una pregunta imposible en una obvia. Ante «01/09 y 02/09», nadie puede decir
 * de memoria si son días o meses; ante «dos días seguidos» frente a «dos días a 31 días de
 * distancia», cualquiera que conozca la planta responde al instante. El programa no elige: mide las
 * dos lecturas y las pone delante.
 */
export interface FieldOrderInterpretation {
  readonly order: FieldOrder;
  /** Primera y última fecha bajo esta lectura, en formato `dd/mm/aaaa`. */
  readonly from: string;
  readonly to: string;
  /** Días que separan la primera de la última. */
  readonly spanDays: number;
}

export type FieldOrderDetection =
  | { readonly determined: true; readonly order: FieldOrder; readonly evidence: string }
  | { readonly determined: false; readonly reason: "CONTRADICTORY" | "NO_DATES" }
  | {
      readonly determined: false;
      readonly reason: "AMBIGUOUS";
      readonly interpretations: readonly FieldOrderInterpretation[];
    };

/**
 * Determina el orden de los campos observando el conjunto de fechas.
 *
 * Un valor mayor que doce en una posición la descarta como mes. Si ninguna de las dos posiciones
 * supera nunca doce, el fichero es **ambiguo** y no se resuelve por mayoría, por idioma ni por el
 * orden de aparición: se devuelve sin determinar para que el usuario lo fije.
 *
 * `NO_DATES` es un caso distinto de `AMBIGUOUS` y no debe tratarse igual: no es que las fechas no
 * permitan decidir, es que **no hay fechas**. Pedirle al usuario que fije el orden de unos campos
 * que no existen le manda a arreglar lo que no está roto; quien llama debe explicar qué se rechazó.
 */
export function detectFieldOrder(samples: readonly string[]): FieldOrderDetection {
  let firstExceedsTwelve = false;
  let secondExceedsTwelve = false;
  let recognised = 0;
  // Las fechas distintas, no las filas: un fichero de doscientas mil líneas cubre unos pocos días.
  const dates = new Set<string>();

  for (const sample of samples) {
    const match = WALL_PATTERN.exec(sample.trim());
    if (match === null) continue;
    recognised += 1;
    if (Number(match[1]) > 12) firstExceedsTwelve = true;
    if (Number(match[2]) > 12) secondExceedsTwelve = true;
    dates.add(`${match[1]}/${match[2]}/${match[3]}`);
  }

  if (recognised === 0) return { determined: false, reason: "NO_DATES" };
  if (firstExceedsTwelve && secondExceedsTwelve) return { determined: false, reason: "CONTRADICTORY" };
  if (firstExceedsTwelve) {
    return { determined: true, order: "day-first", evidence: "el primer campo supera 12 en alguna fila" };
  }
  if (secondExceedsTwelve) {
    return { determined: true, order: "month-first", evidence: "el segundo campo supera 12 en alguna fila" };
  }
  return { determined: false, reason: "AMBIGUOUS", interpretations: interpret(dates) };
}

/** El alcance del fichero bajo cada lectura posible, para que el usuario pueda elegir con datos. */
function interpret(dates: ReadonlySet<string>): readonly FieldOrderInterpretation[] {
  const out: FieldOrderInterpretation[] = [];
  for (const order of ["day-first", "month-first"] as const) {
    const stamps: number[] = [];
    for (const key of dates) {
      const [a, b, year] = key.split("/").map(Number) as [number, number, number];
      const day = order === "day-first" ? a : b;
      const month = order === "day-first" ? b : a;
      // Ambiguo significa que ninguno de los dos campos supera doce, pero sí pueden ser cero: el
      // patrón admite `00/05/2026`. Un mes cero daría diciembre del año anterior y un día cero el
      // último del mes previo, así que una fecha imposible se descarta en vez de desplazarse.
      if (day >= 1 && month >= 1 && day <= daysInMonth(year, month)) {
        stamps.push(Date.UTC(year, month - 1, day));
      }
    }
    if (stamps.length === 0) continue;
    const min = Math.min(...stamps);
    const max = Math.max(...stamps);
    out.push({
      order,
      from: formatDate(min),
      to: formatDate(max),
      spanDays: Math.round((max - min) / 86_400_000),
    });
  }
  return out;
}

function formatDate(utcMs: number): string {
  const date = new Date(utcMs);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}
