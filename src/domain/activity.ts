/**
 * Agregados para las vistas (UX_SPEC §4).
 *
 * Viven en el dominio y los calcula el Worker, no la presentación: recorrer doscientas mil lecturas
 * para contar por hora es exactamente el trabajo que WP-001 mantiene fuera del hilo principal. Lo
 * que viaja a la interfaz son unos cientos de números, no las lecturas otra vez.
 *
 * Los tres agregados de aquí **describen lo observado y no concluyen nada**. Un valle en el perfil
 * horario no es una parada, y una fila vacía en la banda de actividad no es una avería: puede ser
 * un vehículo que no circuló. Quien dibuja tiene que poder distinguir eso, y por eso el hueco de
 * cobertura viaja aparte —marcado como tal— en lugar de aparecer como un cero más.
 */

import type { Interval } from "./coverage.js";
import type { Reading } from "./reading.js";

/** Lecturas por hora del día, agregadas sobre todos los días cargados. */
export interface HourlyProfile {
  /** 24 posiciones, de las 00 a las 23, en la zona horaria del circuito. */
  readonly counts: readonly number[];
  readonly zone: string;
  /** Días distintos que contribuyen. Sin esto, una hora con 5.000 lecturas no se sabe si es mucha. */
  readonly days: number;
}

/**
 * Cuenta por hora del día en la zona del circuito.
 *
 * Se agrega por hora **del reloj de pared** y no por hora absoluta del calendario porque la
 * pregunta que responde es «cómo cambia el circuito a lo largo de la jornada», y esa se contesta
 * superponiendo los días. El precio es que un cambio entre días se promedia, y por eso viaja el
 * número de días: sin él, una barra alta puede ser un día intenso o veinte normales.
 */
export function hourlyProfile(readings: readonly Reading[], zone: string): HourlyProfile {
  const counts = new Array<number>(24).fill(0);
  const days = new Set<string>();
  if (readings.length === 0) return { counts, zone, days: 0 };

  const formatter = new Intl.DateTimeFormat("es-ES", {
    timeZone: zone,
    hour: "2-digit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  for (const entry of readings) {
    const parts = formatter.formatToParts(new Date(entry.time.utcMs));
    const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "", 10);
    if (Number.isNaN(hour) || hour < 0 || hour > 23) continue;
    counts[hour] = (counts[hour] ?? 0) + 1;
    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    days.add(`${year}-${month}-${day}`);
  }

  return { counts, zone, days: days.size };
}

export interface ActivityRow {
  readonly agvId: string;
  /** Lecturas en cada tramo temporal. Mismo número de posiciones para todas las filas. */
  readonly bins: readonly number[];
  readonly total: number;
}

export interface ActivityBand {
  readonly rows: readonly ActivityRow[];
  /** Inicio de cada tramo, para poder rotular el eje sin recalcularlo. */
  readonly binStarts: readonly number[];
  readonly binWidthMs: number;
  /** Tramos que caen **fuera de la cobertura**: no son silencio, es que no hay datos (R-DAT-007). */
  readonly uncoveredBins: readonly number[];
  readonly maxPerBin: number;
}

/**
 * Banda de actividad: una fila por vehículo, el tiempo en horizontal.
 *
 * Es el gráfico que más información da por píxel de todo lo que se ha probado en este proyecto: de
 * un vistazo salen los vehículos que empiezan a media jornada, los que apenas aparecen y los que no
 * leen ni un tag. Ninguna de esas tres cosas es un diagnóstico, y las tres son el punto de partida
 * de uno.
 *
 * Los tramos **sin cobertura se marcan** en lugar de contarse como cero. Un cero dibujado igual que
 * un hueco de datos es la confusión que R-DAT-007 prohíbe, y en una banda es especialmente fácil de
 * cometer porque las dos cosas se ven idénticas: una celda vacía.
 */
export function activityBand(
  readings: readonly Reading[],
  coverage: readonly Interval[],
  binCount: number,
): ActivityBand {
  if (readings.length === 0 || binCount <= 0) {
    return { rows: [], binStarts: [], binWidthMs: 0, uncoveredBins: [], maxPerBin: 0 };
  }

  let from = Infinity;
  let to = -Infinity;
  for (const entry of readings) {
    if (entry.time.utcMs < from) from = entry.time.utcMs;
    if (entry.time.utcMs > to) to = entry.time.utcMs;
  }
  const span = Math.max(1, to - from);
  const binWidthMs = span / binCount;

  const byVehicle = new Map<string, number[]>();
  for (const entry of readings) {
    let bins = byVehicle.get(entry.agvId);
    if (bins === undefined) {
      bins = new Array<number>(binCount).fill(0);
      byVehicle.set(entry.agvId, bins);
    }
    const index = Math.min(binCount - 1, Math.floor((entry.time.utcMs - from) / binWidthMs));
    bins[index] = (bins[index] ?? 0) + 1;
  }

  const binStarts = Array.from({ length: binCount }, (_, index) => from + index * binWidthMs);

  // Un tramo está sin cobertura si su punto medio no cae en ningún intervalo cargado. El punto
  // medio y no el borde: los bordes coinciden con los extremos de la cobertura y darían falsos.
  const uncoveredBins: number[] = [];
  if (coverage.length > 0) {
    for (let index = 0; index < binCount; index += 1) {
      const middle = (binStarts[index] ?? from) + binWidthMs / 2;
      const covered = coverage.some((span_) => middle >= span_.from && middle <= span_.to);
      if (!covered) uncoveredBins.push(index);
    }
  }

  let maxPerBin = 0;
  const rows: ActivityRow[] = [];
  for (const [agvId, bins] of byVehicle) {
    let total = 0;
    for (const value of bins) {
      total += value;
      if (value > maxPerBin) maxPerBin = value;
    }
    rows.push({ agvId, bins, total });
  }
  // Por identificador, no por volumen: quien busca «el 3524» lo busca donde siempre está, y un
  // orden que cambia con los datos obliga a buscarlo de nuevo en cada análisis.
  rows.sort((a, b) => (a.agvId < b.agvId ? -1 : a.agvId > b.agvId ? 1 : 0));

  return { rows, binStarts, binWidthMs, uncoveredBins, maxPerBin };
}
