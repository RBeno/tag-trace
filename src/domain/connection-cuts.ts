/**
 * Cortes de conexión de cada AGV, situados en el circuito (ADR-0017, R-COM-004 a R-COM-007).
 *
 * El registro de conexiones del terminal (DS-013) es evidencia **directa** de comunicación: cada
 * corte es un par `desconexion` → siguiente `conexion` del mismo AGV, con duración. Se sitúa con las
 * lecturas del mismo AGV: la última lectura anterior (P) y la primera posterior (Q). Si Q sigue a P en
 * el anillo, el corte es del tramo P→Q; si no, está «entre P y Q» sin poder situarlo más. Lo que se
 * afirma es dónde se perdió la señal; nunca por qué (R-EVI-006).
 *
 * Decisiones aplicadas (propietario, 2026-10-07, «usa tu recomendación»):
 *
 * - **Tres clases por duración**, de la configuración versionada (OQ-161): `microcorte`, `corte` y
 *   `caida`. Todas se cuentan y se enseñan, separadas.
 * - **`conexion-tras-apagado` cierra el corte pero es un encendido**, no una vuelta de la señal, y se
 *   dice así (`end: "tras-apagado"`).
 * - **Un corte sin cierre dentro de la ventana queda abierto**: su duración es «al menos» hasta el
 *   final de la ventana y se clasifica con ese mínimo.
 * - **Las lecturas con fecha dentro de un corte se cuentan** y se enseñan (OQ-159): si la hora del
 *   fichero fuera la de recepción por este enlace, tendrían que ser cero.
 * - **Un corte cerrado por `conexion-tras-apagado` es un apagado** (propietario, 2026-10-07: «si se
 *   desconectan todos a las 5 de la mañana es por apagado hasta las 6»): el terminal se apagó en
 *   algún momento del corte, así que no mide la señal y no entra en el mapa, aunque se cuenta.
 * - **Un corte colectivo** —una parte de los AGV con registro pierden la señal en la misma ventana—
 *   es apagado o infraestructura, no cobertura de un sitio (R-COM-003, R-COM-008): se marca, se
 *   lista con su hora y sus AGV, y no entra en el mapa ni en la concentración por sitio.
 * - **Un terminal ruidoso no contamina la muestra** (propietario, 2026-10-08: «los que tienen
 *   constantemente conexiones y desconexiones pueden ocultar las evidencias del resto»): un AGV cuya
 *   tasa de cortes propios por pasada supera `noisyVehicleRatio` veces la mediana de la flota se
 *   aparta del mapa, de las horas y de la concentración por sitio (R-COM-009). Sigue en su tarjeta y
 *   en la tabla por AGV: es un hallazgo de ese terminal, no desaparece.
 * - **Los que no reconectan** (R-COM-010): un corte abierto al final de la ventana, o cerrado solo
 *   por un encendido fuera de un apagado colectivo, los dos de más de `cutMaxMs`, se listan aparte.
 */

import { concentrated } from "./circuit-state.js";
import type { Transition } from "./graph.js";
import type { DeliveryConcentration, GroupedDelivery } from "./grouped-delivery.js";
import type { ConnectionEvent } from "./connection-log.js";

export interface ConnectionCutThresholds {
  /** Hasta aquí, microcorte (cambio de punto de acceso). */
  readonly microcutMaxMs: number;
  /** Hasta aquí, corte; por encima, caída. */
  readonly cutMaxMs: number;
  /** Margen con que una ráfaga (R-DAT-020) y un corte se consideran el mismo episodio. */
  readonly contrastToleranceMs: number;
  /** Ventana en la que varios AGV perdiendo la señal son un corte colectivo, y qué parte de los AGV con registro hace falta. */
  readonly collectiveWindowMs: number;
  readonly collectiveMinShare: number;
  /** Un terminal es ruidoso si su tasa de cortes propios por pasada supera tantas veces la mediana de la flota, con al menos tantos cortes. */
  readonly noisyVehicleRatio: number;
  readonly noisyVehicleMinCuts: number;
}

/** `apagado`: cerrado por un encendido; el terminal se apagó durante el corte y no mide la señal. */
export type CutClass = "microcorte" | "corte" | "caida" | "apagado";
export type CutEnd = "conexion" | "tras-apagado" | "abierto";
export type CutLocation = "tramo" | "entre" | "sin-situar";

export interface ConnectionCut {
  readonly agvId: string;
  readonly fromUtcMs: number;
  /** Cuándo volvió la conexión; `null` si no volvió dentro de la ventana. */
  readonly toUtcMs: number | null;
  /** La duración, o el mínimo conocido si el corte está abierto. */
  readonly durationMs: number;
  readonly end: CutEnd;
  readonly cutClass: CutClass;
  /** Perdió la señal a la vez que una parte de la flota con registro (R-COM-008): apagado o infraestructura. */
  readonly collective: boolean;
  /** La última lectura antes de perder la señal (P) y la primera después (Q). */
  readonly lastTagId: string | null;
  readonly lastReadUtcMs: number | null;
  readonly nextTagId: string | null;
  readonly nextReadUtcMs: number | null;
  readonly location: CutLocation;
  /** Lecturas con fecha dentro del corte (OQ-159). */
  readonly readingsInside: number;
  readonly sourceRow: number;
}

/** Lo mínimo de una lectura que hace falta para situar un corte. */
export interface CutReading {
  readonly agvId: string;
  readonly tagId: string;
  readonly utcMs: number;
}

export function classifyCut(durationMs: number, thresholds: ConnectionCutThresholds, end: CutEnd = "conexion"): CutClass {
  if (end === "tras-apagado") return "apagado";
  return durationMs <= thresholds.microcutMaxMs ? "microcorte" : durationMs <= thresholds.cutMaxMs ? "corte" : "caida";
}

/**
 * Empareja cada `desconexion` con la siguiente `conexion` o `conexion-tras-apagado` del mismo AGV.
 * Una `desconexion` seguida de otra sin conexión en medio es un corte que no llegó a cerrarse en el
 * registro: se cierra con la siguiente conexión que haya, y la segunda desconexión no abre otro. Los
 * eventos `desconocido` no abren ni cierran nada.
 */
export function pairCuts(events: readonly ConnectionEvent[], windowEndUtcMs: number, thresholds: ConnectionCutThresholds): ConnectionCut[] {
  const byVehicle = new Map<string, ConnectionEvent[]>();
  for (const event of events) {
    const own = byVehicle.get(event.agvId);
    if (own === undefined) byVehicle.set(event.agvId, [event]);
    else own.push(event);
  }
  const cuts: ConnectionCut[] = [];
  for (const own of byVehicle.values()) {
    const ordered = [...own].sort((a, b) => a.utcMs - b.utcMs);
    let open: ConnectionEvent | null = null;
    for (const event of ordered) {
      if (event.kind === "desconexion") {
        if (open === null) open = event;
        continue;
      }
      if (open !== null && (event.kind === "conexion" || event.kind === "conexion-tras-apagado")) {
        const durationMs = Math.max(0, event.utcMs - open.utcMs);
        cuts.push(unlocated(open, event.utcMs, durationMs, event.kind === "conexion" ? "conexion" : "tras-apagado", thresholds));
        open = null;
      }
    }
    if (open !== null) {
      const durationMs = Math.max(0, windowEndUtcMs - open.utcMs);
      cuts.push(unlocated(open, null, durationMs, "abierto", thresholds));
    }
  }
  return markCollective(
    cuts.sort((a, b) => a.fromUtcMs - b.fromUtcMs || a.agvId.localeCompare(b.agvId)),
    new Set(events.map((event) => event.agvId)).size,
    thresholds,
  );
}

/**
 * Un corte es colectivo si al menos `collectiveMinShare` de los AGV con registro (y al menos dos)
 * **pierden la señal en la ventana `collectiveWindowMs` alrededor de su inicio**, o si, siendo un
 * apagado, **están apagados a la vez** con él en algún momento del corte. La primera firma es la de
 * una infraestructura que cae de golpe; la segunda, la de un apagado escalonado (los AGV se apagan
 * uno a uno durante varios minutos y vuelven juntos una hora después), que una ventana de inicios no
 * ve. El solapamiento solo cuenta entre apagados: una caída larga de un AGV no hace colectivo a cada
 * microcorte ajeno que caiga dentro de ella.
 */
export function markCollective(cuts: readonly ConnectionCut[], vehiclesWithLog: number, thresholds: ConnectionCutThresholds): ConnectionCut[] {
  const ordered = [...cuts].sort((a, b) => a.fromUtcMs - b.fromUtcMs);
  const needed = Math.max(2, Math.ceil(vehiclesWithLog * thresholds.collectiveMinShare));
  const window = thresholds.collectiveWindowMs;
  const endOf = (cut: ConnectionCut): number => cut.toUtcMs ?? cut.fromUtcMs + cut.durationMs;
  return ordered.map((cut) => {
    const near = new Set<string>();
    const overlapping = new Set<string>();
    for (const other of ordered) {
      if (other.fromUtcMs >= cut.fromUtcMs - window && other.fromUtcMs <= cut.fromUtcMs + window) near.add(other.agvId);
      if (cut.end === "tras-apagado" && other.end === "tras-apagado" && other.fromUtcMs <= endOf(cut) && endOf(other) >= cut.fromUtcMs) {
        overlapping.add(other.agvId);
      }
    }
    return { ...cut, collective: near.size >= needed || overlapping.size >= needed };
  });
}

function unlocated(open: ConnectionEvent, toUtcMs: number | null, durationMs: number, end: CutEnd, thresholds: ConnectionCutThresholds): ConnectionCut {
  return {
    agvId: open.agvId,
    fromUtcMs: open.utcMs,
    toUtcMs,
    durationMs,
    end,
    cutClass: classifyCut(durationMs, thresholds, end),
    collective: false,
    lastTagId: null,
    lastReadUtcMs: null,
    nextTagId: null,
    nextReadUtcMs: null,
    location: "sin-situar",
    readingsInside: 0,
    sourceRow: open.sourceRow,
  };
}

/**
 * Sitúa cada corte con las lecturas de su AGV. `rings` son los anillos de los cohortes del circuito,
 * para decir si P→Q es un tramo; sin anillos, todo lo situado queda «entre P y Q».
 */
export function locateCuts(cuts: readonly ConnectionCut[], readings: readonly CutReading[], rings: readonly (readonly string[])[]): ConnectionCut[] {
  const byVehicle = new Map<string, CutReading[]>();
  for (const reading of readings) {
    const own = byVehicle.get(reading.agvId);
    if (own === undefined) byVehicle.set(reading.agvId, [reading]);
    else own.push(reading);
  }
  for (const own of byVehicle.values()) own.sort((a, b) => a.utcMs - b.utcMs);
  const successor = new Map<string, string>();
  for (const ring of rings) ring.forEach((tagId, index) => successor.set(tagId, ring[(index + 1) % ring.length] as string));

  return cuts.map((cut) => {
    const own = byVehicle.get(cut.agvId) ?? [];
    const times = own.map((reading) => reading.utcMs);
    const before = lowerBound(times, cut.fromUtcMs); // primera lectura con t >= from
    const last = before > 0 ? (own[before - 1] as CutReading) : null;
    const closeAt = cut.toUtcMs ?? Number.POSITIVE_INFINITY;
    const after = upperBound(times, closeAt); // primera lectura con t > to
    const next = after < own.length ? (own[after] as CutReading) : null;
    const readingsInside = Math.max(0, after - before);
    const location: CutLocation =
      last === null || next === null ? "sin-situar" : successor.get(last.tagId) === next.tagId || last.tagId === next.tagId ? "tramo" : "entre";
    return {
      ...cut,
      lastTagId: last?.tagId ?? null,
      lastReadUtcMs: last?.utcMs ?? null,
      nextTagId: next?.tagId ?? null,
      nextReadUtcMs: next?.utcMs ?? null,
      location,
      readingsInside,
    };
  });
}

function lowerBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] as number) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((sorted[mid] as number) <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

export interface CutClassCounts {
  readonly microcorte: number;
  readonly corte: number;
  readonly caida: number;
  readonly apagado: number;
}

/** El mapa de estado de conexión por tag: cortes que empezaron al salir de ese tag (su P). */
export interface ConnectionHeatCell {
  readonly tagId: string;
  /** Las transiciones del cohorte que salen del tag: las pasadas con que se compara. */
  readonly passes: number;
  readonly cuts: number;
  readonly byClass: CutClassCounts;
  /** Tiempo sin señal sumado de los cortes que empezaron aquí. */
  readonly withoutSignalMs: number;
  readonly vehicles: readonly string[];
}

export interface ConnectionSegmentCell {
  readonly from: string;
  readonly to: string;
  readonly passes: number;
  readonly cuts: number;
  readonly withoutSignalMs: number;
}

export interface ConnectionVehicleSummary {
  readonly agvId: string;
  readonly events: number;
  readonly cuts: number;
  readonly byClass: CutClassCounts;
  readonly withoutSignalMs: number;
  /** Cortes sin situar: sin lecturas del AGV a un lado o a otro. */
  readonly unlocated: number;
  readonly ips: readonly string[];
  /** Cortes propios (sin apagados ni colectivos) por día local, en orden: para ver si van a más. */
  readonly perDay: readonly { readonly day: string; readonly cuts: number }[];
  readonly collective: number;
  /** Cortes propios por mil pasadas, y cuántas veces la mediana de la flota. */
  readonly rate: number;
  readonly rateRatio: number;
  /** Apartado del mapa por ruidoso (R-COM-009). */
  readonly noisy: boolean;
}

/** Un AGV que no reconectó: corte abierto al final de la ventana, o cerrado solo por un encendido. */
export interface NotReconnecting {
  readonly agvId: string;
  readonly fromUtcMs: number;
  readonly toUtcMs: number | null;
  readonly durationMs: number;
  readonly end: CutEnd;
  readonly lastTagId: string | null;
}

/** Un corte colectivo: la ventana en que una parte de la flota perdió la señal, y quiénes. */
export interface CollectiveCut {
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly vehicles: readonly string[];
  readonly byClass: CutClassCounts;
}

/** El contraste entre el registro (observado) y las ráfagas de R-DAT-020 (inferido). */
export interface ConnectionContrast {
  readonly bursts: number;
  readonly burstsWithCut: number;
  readonly cuts: number;
  readonly cutsWithBurst: number;
  /** Lecturas con fecha dentro de una caída: si la hora fuera la de recepción, serían cero (OQ-159). */
  readonly readingsInsideFalls: number;
  readonly falls: number;
}

export interface ConnectionSummary {
  readonly total: number;
  readonly byClass: CutClassCounts;
  readonly withoutSignalMs: number;
  /** Los cortes que miden cobertura: ni apagados ni colectivos. Son los del mapa, salvo los de terminales ruidosos. */
  readonly individual: number;
  /** Cortes propios de terminales ruidosos, apartados del mapa (R-COM-009). */
  readonly excludedNoisy: number;
  readonly noisyVehicles: readonly string[];
  /** Mediana de la flota de cortes propios por mil pasadas, con la que se mide cada terminal. */
  readonly fleetMedianRate: number;
  readonly notReconnecting: readonly NotReconnecting[];
  /** Cortes propios por hora local de inicio (24 posiciones). */
  readonly byHour: readonly number[];
  readonly collectives: readonly CollectiveCut[];
  readonly vehicles: readonly ConnectionVehicleSummary[];
  readonly heat: readonly ConnectionHeatCell[];
  readonly segments: readonly ConnectionSegmentCell[];
  /** Dónde y a quién le pasa más de lo que da el azar, con la misma prueba que los cuellos de botella. */
  readonly sites: readonly DeliveryConcentration[];
  readonly concentratedVehicles: readonly DeliveryConcentration[];
  readonly contrast: ConnectionContrast;
}

type Classes = { microcorte: number; corte: number; caida: number; apagado: number };
function emptyClasses(): Classes {
  return { microcorte: 0, corte: 0, caida: 0, apagado: 0 };
}

/** Un corte que mide cobertura: ni apagado ni colectivo. */
export function measuresCoverage(cut: ConnectionCut): boolean {
  return cut.cutClass !== "apagado" && !cut.collective;
}

export function summarizeConnections(
  cuts: readonly ConnectionCut[],
  events: readonly ConnectionEvent[],
  transitions: readonly Transition[],
  deliveries: readonly GroupedDelivery[],
  thresholds: ConnectionCutThresholds,
  maxFalsePoints: number,
  clock: { readonly hourOf: (utcMs: number) => number; readonly dayOf: (utcMs: number) => string },
): ConnectionSummary {
  const byClass = emptyClasses();
  let withoutSignalMs = 0;
  const byHour: number[] = Array.from({ length: 24 }, () => 0);
  const heat = new Map<string, { passes: number; cuts: number; byClass: Classes; withoutSignalMs: number; vehicles: Set<string> }>();
  const segments = new Map<string, { from: string; to: string; passes: number; cuts: number; withoutSignalMs: number }>();
  const vehicles = new Map<string, { events: number; cuts: number; byClass: Classes; withoutSignalMs: number; unlocated: number; ips: Set<string>; perDay: Map<string, number>; collective: number }>();
  const vehicleOf = (agvId: string) => {
    const own = vehicles.get(agvId);
    if (own !== undefined) return own;
    const created = { events: 0, cuts: 0, byClass: emptyClasses(), withoutSignalMs: 0, unlocated: 0, ips: new Set<string>(), perDay: new Map<string, number>(), collective: 0 };
    vehicles.set(agvId, created);
    return created;
  };
  const days = new Set<string>();

  // Primero, quién es ruidoso: la tasa de cortes propios por mil pasadas de cada AGV frente a la
  // mediana de la flota. Un terminal que no para de cortar apartaría a los demás del mapa (R-COM-009).
  const passesByVehicle = new Map<string, number>();
  for (const transition of transitions) passesByVehicle.set(transition.agvId, (passesByVehicle.get(transition.agvId) ?? 0) + 1);
  const ownCutsByVehicle = new Map<string, number>();
  for (const cut of cuts) if (measuresCoverage(cut)) ownCutsByVehicle.set(cut.agvId, (ownCutsByVehicle.get(cut.agvId) ?? 0) + 1);
  const rateOf = (agvId: string): number => {
    const passes = passesByVehicle.get(agvId) ?? 0;
    return passes === 0 ? 0 : (1000 * (ownCutsByVehicle.get(agvId) ?? 0)) / passes;
  };
  const logged = [...new Set(events.map((event) => event.agvId))];
  const rates = logged.map(rateOf).sort((a, b) => a - b);
  const fleetMedianRate = rates.length === 0 ? 0 : rates.length % 2 === 1 ? (rates[(rates.length - 1) / 2] as number) : ((rates[rates.length / 2 - 1] as number) + (rates[rates.length / 2] as number)) / 2;
  const noisy = new Set(
    logged.filter(
      (agvId) =>
        (ownCutsByVehicle.get(agvId) ?? 0) >= thresholds.noisyVehicleMinCuts &&
        fleetMedianRate > 0 &&
        rateOf(agvId) >= thresholds.noisyVehicleRatio * fleetMedianRate,
    ),
  );
  const inMap = (cut: ConnectionCut): boolean => measuresCoverage(cut) && !noisy.has(cut.agvId);
  for (const event of events) {
    const own = vehicleOf(event.agvId);
    own.events += 1;
    if (event.ipTerminal !== "") own.ips.add(event.ipTerminal);
  }
  for (const transition of transitions) {
    // Las pasadas de un terminal ruidoso tampoco cuentan: su exposición va con sus cortes.
    if (noisy.has(transition.agvId)) continue;
    const cell = heat.get(transition.from) ?? { passes: 0, cuts: 0, byClass: emptyClasses(), withoutSignalMs: 0, vehicles: new Set<string>() };
    cell.passes += 1;
    heat.set(transition.from, cell);
    const key = `${transition.from}\u0000${transition.to}`;
    const segment = segments.get(key) ?? { from: transition.from, to: transition.to, passes: 0, cuts: 0, withoutSignalMs: 0 };
    segment.passes += 1;
    segments.set(key, segment);
  }
  for (const cut of cuts) {
    byClass[cut.cutClass] += 1;
    withoutSignalMs += cut.durationMs;
    const own = vehicleOf(cut.agvId);
    own.cuts += 1;
    own.byClass[cut.cutClass] += 1;
    own.withoutSignalMs += cut.durationMs;
    if (cut.collective) own.collective += 1;
    days.add(clock.dayOf(cut.fromUtcMs));
    // Solo los cortes que miden cobertura van a los días de su AGV; y al mapa, a la concentración y a
    // las horas solo si su terminal no es ruidoso.
    if (!measuresCoverage(cut)) continue;
    const day = clock.dayOf(cut.fromUtcMs);
    own.perDay.set(day, (own.perDay.get(day) ?? 0) + 1);
    if (!inMap(cut)) continue;
    const hour = clock.hourOf(cut.fromUtcMs);
    byHour[hour] = (byHour[hour] ?? 0) + 1;
    if (cut.lastTagId === null) {
      own.unlocated += 1;
      continue;
    }
    const cell = heat.get(cut.lastTagId) ?? { passes: 0, cuts: 0, byClass: emptyClasses(), withoutSignalMs: 0, vehicles: new Set<string>() };
    cell.cuts += 1;
    cell.byClass[cut.cutClass] += 1;
    cell.withoutSignalMs += cut.durationMs;
    cell.vehicles.add(cut.agvId);
    heat.set(cut.lastTagId, cell);
    if (cut.nextTagId !== null && cut.location === "tramo") {
      const key = `${cut.lastTagId}\u0000${cut.nextTagId}`;
      const segment = segments.get(key) ?? { from: cut.lastTagId, to: cut.nextTagId, passes: 0, cuts: 0, withoutSignalMs: 0 };
      segment.cuts += 1;
      segment.withoutSignalMs += cut.durationMs;
      segments.set(key, segment);
    }
  }

  const siteCounts = new Map([...heat].filter(([, cell]) => cell.cuts > 0).map(([tagId, cell]) => [tagId, cell.cuts]));
  const siteExposure = new Map([...heat].map(([tagId, cell]) => [tagId, cell.passes]));
  const vehicleCounts = new Map([...ownCutsByVehicle].filter(([, count]) => count > 0));
  const vehicleExposure = passesByVehicle;
  const flagged = (counts: Map<string, number>, exposure: Map<string, number>): DeliveryConcentration[] =>
    [...concentrated(counts, exposure, maxFalsePoints)]
      .map(([id, expected]) => ({ id, count: counts.get(id) ?? 0, expected }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

  // Contraste con las ráfagas: el mismo AGV y el mismo episodio, con un margen.
  const tolerance = thresholds.contrastToleranceMs;
  const overlaps = (cut: ConnectionCut, delivery: GroupedDelivery): boolean =>
    cut.agvId === delivery.agvId && cut.fromUtcMs - tolerance <= delivery.toUtcMs && (cut.toUtcMs ?? Number.POSITIVE_INFINITY) + tolerance >= delivery.fromUtcMs;
  const burstsWithCut = deliveries.filter((delivery) => cuts.some((cut) => overlaps(cut, delivery))).length;
  const cutsWithBurst = cuts.filter((cut) => deliveries.some((delivery) => overlaps(cut, delivery))).length;
  const falls = cuts.filter((cut) => cut.cutClass === "caida");

  // Los cortes colectivos, agrupados: una ventana por grupo de inicios seguidos a menos de la ventana.
  const collectives: CollectiveCut[] = [];
  const collectiveCuts = [...cuts].filter((cut) => cut.collective).sort((a, b) => a.fromUtcMs - b.fromUtcMs);
  let group: ConnectionCut[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    const classes = emptyClasses();
    for (const cut of group) classes[cut.cutClass] += 1;
    collectives.push({
      fromUtcMs: group[0]?.fromUtcMs ?? 0,
      toUtcMs: Math.max(...group.map((cut) => cut.toUtcMs ?? cut.fromUtcMs + cut.durationMs)),
      vehicles: [...new Set(group.map((cut) => cut.agvId))].sort(),
      byClass: classes,
    });
    group = [];
  };
  let groupEnd = Number.NEGATIVE_INFINITY;
  for (const cut of collectiveCuts) {
    const last = group[group.length - 1];
    // Un grupo nuevo cuando el corte ni empieza cerca del anterior ni se solapa con el grupo (apagado escalonado).
    if (last !== undefined && cut.fromUtcMs - last.fromUtcMs > thresholds.collectiveWindowMs && cut.fromUtcMs > groupEnd) {
      flush();
      groupEnd = Number.NEGATIVE_INFINITY;
    }
    group.push(cut);
    groupEnd = Math.max(groupEnd, cut.toUtcMs ?? cut.fromUtcMs + cut.durationMs);
  }
  flush();
  const orderedDays = [...days].sort();
  const notReconnecting: NotReconnecting[] = cuts
    .filter(
      (cut) =>
        cut.durationMs >= thresholds.cutMaxMs && ((cut.end === "abierto") || (cut.end === "tras-apagado" && !cut.collective)),
    )
    .map((cut) => ({ agvId: cut.agvId, fromUtcMs: cut.fromUtcMs, toUtcMs: cut.toUtcMs, durationMs: cut.durationMs, end: cut.end, lastTagId: cut.lastTagId }));

  return {
    total: cuts.length,
    byClass,
    withoutSignalMs,
    individual: cuts.filter(measuresCoverage).length,
    excludedNoisy: cuts.filter((cut) => measuresCoverage(cut) && noisy.has(cut.agvId)).length,
    noisyVehicles: [...noisy].sort(),
    fleetMedianRate,
    notReconnecting,
    byHour,
    collectives,
    vehicles: [...vehicles]
      .map(([agvId, own]) => ({
        agvId,
        events: own.events,
        cuts: own.cuts,
        byClass: own.byClass,
        withoutSignalMs: own.withoutSignalMs,
        unlocated: own.unlocated,
        ips: [...own.ips].sort(),
        perDay: orderedDays.map((day) => ({ day, cuts: own.perDay.get(day) ?? 0 })),
        collective: own.collective,
        rate: rateOf(agvId),
        rateRatio: fleetMedianRate > 0 ? rateOf(agvId) / fleetMedianRate : 0,
        noisy: noisy.has(agvId),
      }))
      .sort((a, b) => b.cuts - a.cuts || a.agvId.localeCompare(b.agvId)),
    heat: [...heat]
      .map(([tagId, cell]) => ({ tagId, passes: cell.passes, cuts: cell.cuts, byClass: cell.byClass, withoutSignalMs: cell.withoutSignalMs, vehicles: [...cell.vehicles].sort() }))
      .sort((a, b) => a.tagId.localeCompare(b.tagId)),
    segments: [...segments.values()].filter((segment) => segment.cuts > 0).sort((a, b) => b.cuts - a.cuts || a.from.localeCompare(b.from)),
    sites: flagged(siteCounts, siteExposure),
    concentratedVehicles: flagged(vehicleCounts, vehicleExposure),
    contrast: {
      bursts: deliveries.length,
      burstsWithCut,
      cuts: cuts.length,
      cutsWithBurst,
      readingsInsideFalls: falls.reduce((sum, cut) => sum + cut.readingsInside, 0),
      falls: falls.length,
    },
  };
}
