/**
 * Fechas y horas que entran y salen por campos `datetime-local` y `date`, en la zona del circuito.
 *
 * Una sola conversión de hora de pared a instante: `wallClockToUtc` (ADR-0013). Hasta 3.89.0 dos
 * paneles la rehacían por su cuenta con el método iterativo que `time.ts` rechaza, y en la hora
 * repetida de octubre daban un instante distinto al del dominio para la misma hora escrita: una
 * ventana de expediente tecleada a las 02:30 del día del cambio quedaba una hora desplazada
 * respecto a las lecturas.
 */
import { wallClockToUtc } from "../domain/time.js";

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const partFormatters = new Map<string, Intl.DateTimeFormat>();

/** Las partes de un instante en la zona, con dos cifras y ciclo de 0 a 23; un formateador por zona. */
function partsIn(zone: string, utcMs: number): (type: Intl.DateTimeFormatPartTypes) => string {
  let formatter = partFormatters.get(zone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(new Date(utcMs));
  return (type) => parts.find((entry) => entry.type === type)?.value ?? "00";
}

/**
 * Un instante como valor de un `datetime-local` (`aaaa-mm-ddThh:mm:ss`, o sin segundos), en la zona
 * del circuito.
 */
export function toDateTimeInput(utcMs: number, zone: string, precision: "seconds" | "minutes" = "seconds"): string {
  const part = partsIn(zone, utcMs);
  const base = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  return precision === "seconds" ? `${base}:${part("second")}` : base;
}

/** El valor de un `datetime-local`, leído en la zona del circuito; `null` si no es una fecha. */
export function fromDateTimeInput(value: string, zone: string): number | null {
  const match = DATE_TIME.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((field) => Number(field ?? "0")) as [number, number, number, number, number, number];
  return wallClockToUtc({ year, month, day, hour, minute, second }, zone).utcMs;
}

/** «2026-01-27» del instante, en la zona del circuito: lo que un `input[type=date]` entiende. */
export function isoDay(utcMs: number, zone: string): string {
  const part = partsIn(zone, utcMs);
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Las 00:00 de un día en la zona del circuito, como instante UTC; `null` si no es una fecha. */
export function zoneMidnight(day: string, zone: string): number | null {
  const match = DAY.exec(day);
  if (match === null) return null;
  const [year, month, dayOfMonth] = match.slice(1).map(Number) as [number, number, number];
  return wallClockToUtc({ year, month, day: dayOfMonth, hour: 0, minute: 0, second: 0 }, zone).utcMs;
}
