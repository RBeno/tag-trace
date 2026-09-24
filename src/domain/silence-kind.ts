/**
 * Cómo reaparece un AGV tras un hueco sin lecturas (R-AGV-017).
 *
 * El expediente ya guarda los dos extremos de cada hueco —por qué tag se fue y por cuál volvió— y
 * el anillo inferido dice cuántos tags hay entre los dos. Con eso, y con lo que suele tardar ese
 * mismo tramo en ese turno, cada hueco se describe por un hecho, sin nombrar causa (R-EVI-006):
 *
 * | Clase | Hecho |
 * |---|---|
 * | `habitual` | vuelve por el tag siguiente en un tiempo que ese tramo tiene a menudo en ese turno: no es un hueco |
 * | `parada` | vuelve por el tag siguiente (o por el mismo), más tarde de lo habitual: estuvo ahí |
 * | `salta-uno` | vuelve un tag más allá |
 * | `salta-varios` | vuelve dos o más tags más allá |
 * | `desconexion` | una hora o más sin leer y vuelve en otro punto, o sin leer al principio o al final |
 * | `mantenimiento` | se fue o volvió por un tag de la lista de mantenimiento |
 * | `sin-clasificar` | uno de los dos extremos está fuera del anillo inferido: no hay posición que comparar |
 *
 * «Habitual» solo se aplica cuando no falta ningún tag entre medias: un tag saltado es un tag sin
 * leer aunque el tiempo sea normal, y callarlo escondería justo lo que el producto existe para
 * enseñar. Un tag saltado sale como tal, con lo que suele tardar ese tramo al lado.
 *
 * «Lo habitual» es la **mediana** de cada tramo del anillo —un tag y el siguiente— en cada turno, en
 * la hora local de la zona del circuito. Un par en el mismo instante no mide nada (R-DAT-013) y no
 * cuenta. Sin datos de ese turno se usa la mediana de toda la ventana, y sin ninguna, no se afirma lo
 * habitual.
 */

import type { Transition } from "./graph.js";

export type SilenceKind =
  | "habitual"
  | "parada"
  | "salta-uno"
  | "salta-varios"
  | "desconexion"
  | "mantenimiento"
  | "sin-clasificar";

export interface SilenceKindThresholds {
  /** Cuántas veces lo habitual del tramo tiene que durar un hueco para salirse de lo normal. */
  readonly factorOverUsual: number;
  /** A partir de cuánto un hueco sin reaparecer en su sitio, o un borde sin lecturas, es desconexión. */
  readonly longAbsenceMs: number;
  /** Horas locales en que empieza cada turno, p. ej. `[6, 14, 22]`. */
  readonly shiftStartHours: readonly number[];
}

/** Lo que suele tardar cada tramo del anillo de un cohorte, por turno. */
export interface UsualTimes {
  readonly ring: readonly string[];
  readonly positionOf: ReadonlyMap<string, number>;
  /** `[tramo][turno]`: mediana en ms del tag `ring[i]` al `ring[i + 1]`; `null` sin muestras. */
  readonly byShift: readonly (readonly (number | null)[])[];
  /** `[tramo]`: mediana de toda la ventana, el respaldo cuando un turno no tiene muestras. */
  readonly overall: readonly (number | null)[];
  readonly zone: string;
  readonly shiftStartHours: readonly number[];
}

/** Los hechos que acompañan a la clase, para leerlos al tocar el tramo. */
export interface SilenceDetail {
  readonly lastTagBefore: string | null;
  readonly firstTagAfter: string | null;
  /** El tag que sigue a `lastTagBefore` en el anillo, si está en él. */
  readonly nextTagId: string | null;
  /** Tags del anillo que quedaron sin leer entre los dos extremos; `null` si alguno está fuera. */
  readonly skipped: number | null;
  /** Lo que suele tardar ese recorrido en ese turno; `null` si no hay muestras. */
  readonly usualMs: number | null;
  /** Turno en que empezó el hueco, «06–14». */
  readonly shift: string | null;
  /** Solo en los bordes de un tramo de cobertura: sin lecturas al principio, al final o en todo. */
  readonly edge?: "inicio" | "fin" | "todo";
}

export interface SilenceClass {
  readonly kind: SilenceKind;
  readonly detail: SilenceDetail;
}

/** Un hueco entre dos lecturas del mismo vehículo, con sus dos extremos. */
export interface SilenceGap {
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly lastTagBefore: string;
  readonly firstTagAfter: string;
}

export interface SilenceContext {
  /** Lo habitual del cohorte del vehículo; `null` si su cohorte no tiene anillo. */
  readonly usual: UsualTimes | null;
  readonly maintenance: ReadonlySet<string>;
}

const QUARTER_MS = 15 * 60_000;

/**
 * La hora local de un instante. Los cambios de hora caen siempre en un múltiplo de un cuarto de hora
 * UTC (todas las zonas tienen desplazamientos de cuartos), así que dentro de un cuarto la hora local
 * no cambia y basta con leerla una vez por cuarto: miles de transiciones, unos pocos cientos de
 * llamadas a `Intl`.
 */
const hourReaders = new Map<string, (utcMs: number) => number>();

function localHourReader(zone: string): (utcMs: number) => number {
  const known = hourReaders.get(zone);
  if (known !== undefined) return known;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" });
  const cache = new Map<number, number>();
  const reader = (utcMs: number): number => {
    const quarter = Math.floor(utcMs / QUARTER_MS);
    let hour = cache.get(quarter);
    if (hour === undefined) {
      const part = formatter.formatToParts(new Date(quarter * QUARTER_MS)).find((entry) => entry.type === "hour");
      hour = Number(part?.value ?? 0) % 24;
      cache.set(quarter, hour);
    }
    return hour;
  };
  hourReaders.set(zone, reader);
  return reader;
}

/** Índice del turno de una hora local: el último inicio que no la pasa; antes del primero, el último. */
export function shiftIndexOfHour(hour: number, shiftStartHours: readonly number[]): number {
  const starts = [...shiftStartHours].sort((a, b) => a - b);
  let index = starts.length - 1;
  starts.forEach((start, position) => {
    if (start <= hour) index = position;
  });
  return index;
}

/** «06–14», «22–06». */
export function shiftLabel(index: number, shiftStartHours: readonly number[]): string {
  const starts = [...shiftStartHours].sort((a, b) => a - b);
  const pad = (hour: number): string => String(hour).padStart(2, "0");
  const from = starts[index] ?? 0;
  const to = starts[(index + 1) % starts.length] ?? from;
  return `${pad(from)}–${pad(to)}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] as number)
    : ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}

/**
 * Mediana de cada tramo del anillo —de un tag al siguiente— por turno y en toda la ventana. Solo
 * cuentan las transiciones directas entre los dos tags: un paso que se salta un tag no mide ese tramo.
 */
export function usualSegmentTimes(
  transitions: readonly Pick<Transition, "from" | "to" | "fromTime" | "toTime" | "sameInstant">[],
  ring: readonly string[],
  zone: string,
  shiftStartHours: readonly number[],
): UsualTimes {
  const positionOf = new Map(ring.map((tagId, index) => [tagId, index]));
  const shifts = Math.max(1, shiftStartHours.length);
  const byShift = ring.map(() => Array.from({ length: shifts }, (): number[] => []));
  const overall = ring.map((): number[] => []);
  const hourOf = localHourReader(zone);
  for (const transition of transitions) {
    if (transition.sameInstant) continue;
    const position = positionOf.get(transition.from);
    if (position === undefined || ring[(position + 1) % ring.length] !== transition.to) continue;
    const duration = transition.toTime - transition.fromTime;
    const shift = shiftIndexOfHour(hourOf(transition.fromTime), shiftStartHours);
    byShift[position]?.[shift]?.push(duration);
    overall[position]?.push(duration);
  }
  return {
    ring,
    positionOf,
    byShift: byShift.map((perShift) => perShift.map(median)),
    overall: overall.map(median),
    zone,
    shiftStartHours,
  };
}

/** Clasifica un hueco sin carga que lo explique por cómo reaparece el AGV. */
export function classifySilence(
  gap: SilenceGap,
  context: SilenceContext,
  thresholds: SilenceKindThresholds,
): SilenceClass {
  const duration = gap.toUtcMs - gap.fromUtcMs;
  const usual = context.usual;
  const from = usual?.positionOf.get(gap.lastTagBefore);
  const to = usual?.positionOf.get(gap.firstTagAfter);
  const size = usual?.ring.length ?? 0;
  const sameTag = gap.lastTagBefore === gap.firstTagAfter;
  const shiftIndex =
    usual === null ? null : shiftIndexOfHour(localHourReader(usual.zone)(gap.fromUtcMs), usual.shiftStartHours);

  let skipped: number | null = null;
  let usualMs: number | null = null;
  if (usual !== null && from !== undefined && to !== undefined && size > 1) {
    skipped = sameTag ? 0 : (to - from - 1 + size) % size;
    if (!sameTag) {
      let total = 0;
      for (let step = 0; step <= skipped; step += 1) {
        const segment = (from + step) % size;
        const time = usual.byShift[segment]?.[shiftIndex as number] ?? usual.overall[segment] ?? null;
        if (time === null) {
          total = Number.NaN;
          break;
        }
        total += time;
      }
      usualMs = Number.isNaN(total) ? null : total;
    }
  }
  const detail: SilenceDetail = {
    lastTagBefore: gap.lastTagBefore,
    firstTagAfter: gap.firstTagAfter,
    nextTagId: usual !== null && from !== undefined ? (usual.ring[(from + 1) % size] ?? null) : null,
    skipped,
    usualMs,
    shift: usual === null || shiftIndex === null ? null : shiftLabel(shiftIndex, usual.shiftStartHours),
  };
  const long = duration >= thresholds.longAbsenceMs;

  if (context.maintenance.has(gap.lastTagBefore) || context.maintenance.has(gap.firstTagAfter)) {
    return { kind: "mantenimiento", detail };
  }
  if (skipped === null) return { kind: long ? "desconexion" : "sin-clasificar", detail };
  if (skipped === 0) {
    const within = usualMs !== null && duration <= thresholds.factorOverUsual * usualMs;
    return { kind: within ? "habitual" : "parada", detail };
  }
  if (long) return { kind: "desconexion", detail };
  return { kind: skipped === 1 ? "salta-uno" : "salta-varios", detail };
}
