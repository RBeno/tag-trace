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
  /** Hora inexistente al adelantarlo: el texto no corresponde a ningún instante. */
  | "dst_nonexistent";

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
  const naive = asUtcMs(wall);
  const offsets = [zoneOffsetMs(naive - DAY_MS, zone), zoneOffsetMs(naive + DAY_MS, zone)];
  const candidates = [...new Set(offsets.map((offset) => naive - offset))];
  const matches = candidates.filter((candidate) => sameWallClock(wallClockAt(candidate, zone), wall));

  if (matches.length >= 2) {
    // Hora repetida: se conserva la primera ocurrencia y se marca. No se usa para afirmar orden
    // dentro de la ventana afectada.
    return { utcMs: Math.min(...matches), flag: "dst_ambiguous" };
  }
  if (matches.length === 1) {
    return { utcMs: matches[0] as number, flag: "ok" };
  }
  // Hora inexistente: el reloj saltó por encima. Se conserva el instante en que el salto terminó.
  return { utcMs: Math.max(...candidates), flag: "dst_nonexistent" };
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

export type FieldOrderDetection =
  | { readonly determined: true; readonly order: FieldOrder; readonly evidence: string }
  | { readonly determined: false; readonly reason: "AMBIGUOUS" | "CONTRADICTORY" | "NO_DATES" };

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

  for (const sample of samples) {
    const match = WALL_PATTERN.exec(sample.trim());
    if (match === null) continue;
    recognised += 1;
    if (Number(match[1]) > 12) firstExceedsTwelve = true;
    if (Number(match[2]) > 12) secondExceedsTwelve = true;
  }

  if (recognised === 0) return { determined: false, reason: "NO_DATES" };
  if (firstExceedsTwelve && secondExceedsTwelve) return { determined: false, reason: "CONTRADICTORY" };
  if (firstExceedsTwelve) {
    return { determined: true, order: "day-first", evidence: "el primer campo supera 12 en alguna fila" };
  }
  if (secondExceedsTwelve) {
    return { determined: true, order: "month-first", evidence: "el segundo campo supera 12 en alguna fila" };
  }
  return { determined: false, reason: "AMBIGUOUS" };
}
