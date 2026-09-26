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
 * | `sin-clasificar` | un extremo fuera del anillo inferido, o reaparece **por detrás** (media vuelta o más de «saltos»: en una guía única no se retrocede), o vuelve por su sitio pero el tramo no tiene habitual con que compararlo |
 *
 * «Habitual» solo se aplica cuando no falta ningún tag entre medias: un tag saltado es un tag sin
 * leer aunque el tiempo sea normal, y callarlo escondería justo lo que el producto existe para
 * enseñar. Un tag saltado sale como tal, con lo que suele tardar ese tramo al lado.
 *
 * «Lo habitual» es la **mediana** de cada tramo del anillo —un tag y el siguiente— en cada turno, en
 * la hora local de la zona del circuito. Volver por el mismo tag se compara con el tramo que sale de
 * él: lo que se suele tardar en dejarlo. Un par en el mismo instante no mide nada (R-DAT-013) y no
 * cuenta. Sin datos de ese turno se usa la mediana de toda la ventana, y sin ninguna, no se afirma lo
 * habitual.
 *
 * Antes que la forma de la reaparición va **qué hacía el resto** (R-AGV-008, R-AGV-018): si la
 * producción estaba parada o el AGV de delante también, la duración del hueco está explicada, y una
 * hora sin leer ya no es «desconexión» por sí sola. Eso lo decide `flow-stops.ts` y llega aquí como
 * `justification`.
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

/**
 * Qué explica una parada, mirando al resto del circuito (R-AGV-018): la producción parada (ningún
 * tag crítico leído), una cola (el AGV de delante también parado), o nada de lo que el dato enseña.
 */
export type StopJustification = "produccion" | "cola" | "sin-explicacion";

export interface SilenceContext {
  /** Lo habitual del cohorte del vehículo; `null` si su cohorte no tiene anillo. */
  readonly usual: UsualTimes | null;
  readonly maintenance: ReadonlySet<string>;
  /** Qué hacía el resto mientras tanto; sin ella, el hueco se juzga solo. */
  readonly justification?: StopJustification | null;
}

const QUARTER_MS = 15 * 60_000;

/**
 * La hora local de un instante. Los cambios de hora caen siempre en un múltiplo de un cuarto de hora
 * UTC (todas las zonas tienen desplazamientos de cuartos), así que dentro de un cuarto la hora local
 * no cambia y basta con leerla una vez por cuarto: miles de transiciones, unos pocos cientos de
 * llamadas a `Intl`.
 */
const hourReaders = new Map<string, (utcMs: number) => number>();

export function localHourReader(zone: string): (utcMs: number) => number {
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

/**
 * Lo que suele tardar el recorrido del anillo de `fromTagId` a `toTagId` en el turno de `atUtcMs`: la
 * suma de las medianas de sus tramos. `null` si alguno de los dos no está en el anillo, si es el mismo
 * tag, o si algún tramo no tiene muestras.
 */
export function ringUsualMs(usual: UsualTimes, fromTagId: string, toTagId: string, atUtcMs: number): number | null {
  const from = usual.positionOf.get(fromTagId);
  const to = usual.positionOf.get(toTagId);
  const size = usual.ring.length;
  if (from === undefined || to === undefined || from === to || size < 2) return null;
  const shiftIndex = shiftIndexOfHour(localHourReader(usual.zone)(atUtcMs), usual.shiftStartHours);
  const skipped = (to - from - 1 + size) % size;
  let total = 0;
  for (let step = 0; step <= skipped; step += 1) {
    const segment = (from + step) % size;
    const time = usual.byShift[segment]?.[shiftIndex] ?? usual.overall[segment] ?? null;
    if (time === null) return null;
    total += time;
  }
  return total;
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
    const ahead = sameTag ? 0 : (to - from - 1 + size) % size;
    // Reaparecer por detrás —media vuelta o más de «saltos»— no es avanzar casi una vuelta: en una guía
    // única no se retrocede, así que es un tag mal situado o una maniobra fuera de la guía. Sin
    // posición fiable que comparar, se trata como un extremo fuera del anillo (misma guarda que
    // `bandFor` y las zonas oscuras).
    if (ahead < size / 2) {
      skipped = ahead;
      // Volver por el mismo tag es haberse quedado ahí: lo habitual con que se compara es lo que se
      // suele tardar en dejar ese tag, el tramo hasta el siguiente del anillo.
      const target = sameTag ? (usual.ring[(from + 1) % size] as string) : gap.firstTagAfter;
      usualMs = ringUsualMs(usual, gap.lastTagBefore, target, gap.fromUtcMs);
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
  // Una hora sin leer solo dice algo por sí sola si nada del resto la explica (R-AGV-008).
  const explained = context.justification === "produccion" || context.justification === "cola";
  const long = duration >= thresholds.longAbsenceMs && !explained;

  if (context.maintenance.has(gap.lastTagBefore) || context.maintenance.has(gap.firstTagAfter)) {
    return { kind: "mantenimiento", detail };
  }
  if (skipped === null) return { kind: long ? "desconexion" : "sin-clasificar", detail };
  if (skipped === 0) {
    // «Más tarde de lo habitual» exige un habitual: sin muestras del tramo no se afirma que estuvo
    // parado, y el hueco queda sin clasificar, salvo que pase de una hora, que por sí sola ya dice algo.
    if (usualMs === null) return { kind: long ? "desconexion" : "sin-clasificar", detail };
    const within = duration <= thresholds.factorOverUsual * usualMs;
    return { kind: within ? "habitual" : "parada", detail };
  }
  if (long) return { kind: "desconexion", detail };
  return { kind: skipped === 1 ? "salta-uno" : "salta-varios", detail };
}
