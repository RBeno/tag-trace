/**
 * El ritmo de cada AGV y quién retiene a otros (R-AGV-019, R-AGV-020).
 *
 * **Ritmo.** De cada transición libre de un AGV —de producción, que no es parada ni retención, con las
 * lecturas que llegaron juntas ya colapsadas— la razón entre lo que tardó y la mitad de las pasadas de
 * su tramo (el p50 de su horquilla). El ritmo del AGV es la mediana de sus razones, frente a la
 * mediana de toda la flota. Se señala si pasa dos pruebas a la vez:
 *
 * - **de signo**: cuántas razones suyas quedan por encima de la mediana de la flota, con los empates a
 *   mitad; que un reparto así salga por azar, multiplicado por los AGV mirados, no pasa de
 *   `maxFalsePoints`. Con miles de transiciones cualquier diferencia es significativa, así que además
 * - **de efecto**: el ritmo se aparta al menos `minPaceShift` del de la flota.
 *
 * Con zonas declaradas, lo mismo dentro de cada zona: «en toda la línea» o «solo en la zona cargada».
 *
 * **Quién retiene.** Las retenciones de producción (R-FLO-008) agrupadas por quien iba delante y no se
 * iba. Se señala quien retiene más de lo que da el azar según cuántas pasadas hizo él —la misma prueba
 * de los sitios del circuito, aquí por vehículo—, y a varios AGV distintos, no siempre al mismo.
 *
 * Hechos con su cifra. Ninguna causa: un AGV más lento puede llevar otra carga, otro firmware o ir en
 * otro modo; uno que retiene puede esperar más en un punto por su lector o por su programa (R-EVI-006).
 */

import { concentrated } from "./circuit-state.js";
import type { FlowReport } from "./flow-stops.js";
import type { Transition } from "./graph.js";
import type { Interval } from "./coverage.js";
import { bandFor, buildSegmentBands, transitionRegime, type BandThresholds, type Regime, type SegmentBands } from "./segment-bands.js";

export interface PaceThresholds {
  /** Cuánto se aparta el ritmo de un AGV del de la flota, como mínimo, para señalarlo. */
  readonly minPaceShift: number;
}

export interface VehiclePaceThresholds extends PaceThresholds {
  /** Transiciones libres mínimas de un AGV (en una zona) para dar su ritmo. */
  readonly minSamples: number;
  /** Azar admitido con todos los AGV mirados a la vez. */
  readonly maxFalsePoints: number;
  /** AGV retenidos distintos, como mínimo, para señalar a quien retiene. */
  readonly minVehiclesForContrast: number;
}

export interface PaceInput {
  /** Las transiciones del cohorte, colapsadas, medibles y fuera de las paradas de la producción. */
  readonly transitions: readonly Transition[];
  readonly bands: SegmentBands;
  readonly regimeOf: (utcMs: number) => Regime;
  /** Paradas y retenciones: no son transiciones libres. */
  readonly flow: Pick<FlowReport, "stops" | "retentions">;
  /** Zona declarada de cada tag; vacío sin zonas. */
  readonly zoneOf: ReadonlyMap<string, string>;
}

export type PaceVerdict = "mas-lento" | "mas-rapido";

export interface ZonePace {
  readonly zone: string;
  readonly samples: number;
  readonly ratio: number;
  readonly fleetRatio: number;
  readonly verdict: PaceVerdict | null;
}

export interface VehiclePace {
  readonly agvId: string;
  readonly samples: number;
  /** Mediana de sus razones duración / p50 del tramo. */
  readonly ratio: number;
  readonly fleetRatio: number;
  /** ratio / fleetRatio − 1. */
  readonly shift: number;
  /** Probabilidad de un reparto así por azar, ya multiplicada por los AGV mirados. */
  readonly chance: number;
  readonly verdict: PaceVerdict | null;
  readonly zones: readonly ZonePace[];
  /**
   * Dónde: `toda-la-linea` si en ninguna zona con muestras va a su paso (o no hay zonas); si no, las
   * zonas donde se aparta. Una zona va a su paso si su diferencia no llega al efecto mínimo. `null` si
   * no se señala.
   */
  readonly where: "toda-la-linea" | readonly string[] | null;
}

export interface Holder {
  readonly agvId: string;
  readonly retentions: number;
  /** AGV distintos que esperaron detrás de él. */
  readonly retained: readonly string[];
  /** Tiempo de espera sumado de todos los retenidos. */
  readonly waitMs: number;
  /** Tags donde estaba cuando retenía. */
  readonly sites: readonly string[];
  /** Sus transiciones de producción: la exposición con que se le compara. */
  readonly passes: number;
  /** Lo que daría el azar, si se señala. */
  readonly expected: number | null;
}

export interface PaceReport {
  readonly fleetRatio: number | null;
  /** Todos los AGV con muestras suficientes; primero los señalados. */
  readonly vehicles: readonly VehiclePace[];
  /** Todos los que retienen a alguien; primero los señalados. */
  readonly holders: readonly Holder[];
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** erfc(x) para x ≥ 0 (Abramowitz y Stegun 7.1.26, error menor que 1,5·10⁻⁷). */
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-x * x);
}

/**
 * Prueba de signo de dos colas, con los empates a mitad y por aproximación normal: la probabilidad de
 * que tantas razones queden a un lado de la mediana de la flota por azar.
 */
export function signTest(ratios: readonly number[], center: number): number {
  const n = ratios.length;
  if (n === 0) return 1;
  let above = 0;
  for (const ratio of ratios) above += ratio > center ? 1 : ratio === center ? 0.5 : 0;
  const z = Math.abs(above - n / 2) / Math.sqrt(n / 4);
  return Math.min(1, erfc(z / Math.SQRT2));
}

/** Ritmo de cada AGV y quién retiene, en un cohorte (o en un fichero, con la horquilla de ese fichero). */
export function vehiclePace(input: PaceInput, thresholds: VehiclePaceThresholds): PaceReport {
  const { transitions, bands, regimeOf, flow, zoneOf } = input;
  const key = (agvId: string, fromUtcMs: number): string => `${agvId}\u0000${fromUtcMs}`;
  const notFree = new Set([
    ...flow.stops.map((stop) => key(stop.agvId, stop.fromUtcMs)),
    ...flow.retentions.map((retention) => key(retention.agvId, retention.fromUtcMs)),
  ]);

  // Razones de cada transición libre de producción, por AGV y por zona.
  const byVehicle = new Map<string, number[]>();
  const byVehicleZone = new Map<string, Map<string, number[]>>();
  const passes = new Map<string, number>();
  for (const transition of transitions) {
    if (transition.sameInstant || transitionRegime(transition, regimeOf) !== "produccion") continue;
    passes.set(transition.agvId, (passes.get(transition.agvId) ?? 0) + 1);
    if (notFree.has(key(transition.agvId, transition.fromTime))) continue;
    const band = bandFor(bands, transition.from, transition.to, "produccion");
    if (band === null || band.p50Ms <= 0) continue;
    const ratio = (transition.toTime - transition.fromTime) / band.p50Ms;
    const list = byVehicle.get(transition.agvId);
    if (list === undefined) byVehicle.set(transition.agvId, [ratio]);
    else list.push(ratio);
    const zone = zoneOf.get(transition.from);
    if (zone !== undefined && zoneOf.get(transition.to) === zone) {
      let own = byVehicleZone.get(transition.agvId);
      if (own === undefined) byVehicleZone.set(transition.agvId, (own = new Map<string, number[]>()));
      const zoneList = own.get(zone);
      if (zoneList === undefined) own.set(zone, [ratio]);
      else zoneList.push(ratio);
    }
  }

  const tested = [...byVehicle].filter(([, ratios]) => ratios.length >= thresholds.minSamples);
  const fleetRatio = median(tested.flatMap(([, ratios]) => ratios));
  const zones = [...new Set(zoneOf.values())].sort();
  const fleetByZone = new Map(
    zones.map((zone) => [zone, median(tested.flatMap(([agvId]) => byVehicleZone.get(agvId)?.get(zone) ?? []))]),
  );
  const judge = (ratios: readonly number[], center: number, tests: number): { ratio: number; chance: number; verdict: PaceVerdict | null } => {
    const ratio = median(ratios) as number;
    const chance = Math.min(1, signTest(ratios, center) * tests);
    const shift = ratio / center - 1;
    const verdict =
      chance <= thresholds.maxFalsePoints && Math.abs(shift) >= thresholds.minPaceShift ? (shift > 0 ? "mas-lento" : "mas-rapido") : null;
    return { ratio, chance, verdict };
  };

  const vehicles: VehiclePace[] =
    fleetRatio === null
      ? []
      : tested.map(([agvId, ratios]) => {
          const overall = judge(ratios, fleetRatio, tested.length);
          const zonePaces: ZonePace[] = zones.flatMap((zone) => {
            const own = byVehicleZone.get(agvId)?.get(zone) ?? [];
            const center = fleetByZone.get(zone) ?? null;
            if (own.length < thresholds.minSamples || center === null) return [];
            const verdict = judge(own, center, tested.length * zones.length);
            return [{ zone, samples: own.length, ratio: verdict.ratio, fleetRatio: center, verdict: verdict.verdict }];
          });
          const flaggedZones = zonePaces.filter((zone) => zone.verdict !== null);
          const verdict = overall.verdict ?? (flaggedZones.length > 0 ? (flaggedZones[0] as ZonePace).verdict : null);
          // «Solo en una zona» afirma que en las demás va a su paso: eso lo dice su propia diferencia, por
          // debajo del efecto mínimo, no que su prueba no llegue con menos muestras.
          const deviates = (zone: ZonePace): boolean => {
            const zoneShift = zone.ratio / zone.fleetRatio - 1;
            return verdict === "mas-lento" ? zoneShift >= thresholds.minPaceShift : zoneShift <= -thresholds.minPaceShift;
          };
          const deviating = zonePaces.filter(deviates).map((zone) => zone.zone);
          const where =
            verdict === null
              ? null
              : overall.verdict === null
                ? flaggedZones.filter((zone) => zone.verdict === verdict).map((zone) => zone.zone)
                : deviating.length === 0 || deviating.length === zonePaces.length
                  ? "toda-la-linea"
                  : deviating;
          return {
            agvId,
            samples: ratios.length,
            ratio: overall.ratio,
            fleetRatio,
            shift: overall.ratio / fleetRatio - 1,
            chance: overall.chance,
            verdict,
            zones: zonePaces,
            where,
          };
        });
  vehicles.sort(
    (a, b) => Number(b.verdict !== null) - Number(a.verdict !== null) || Math.abs(b.shift) - Math.abs(a.shift) || a.agvId.localeCompare(b.agvId),
  );

  // Quién retiene: retenciones de producción por quien iba delante.
  const production = flow.retentions.filter((retention) => retention.regime === "produccion");
  const grouped = new Map<string, typeof production>();
  for (const retention of production) grouped.set(retention.holderAgvId, [...(grouped.get(retention.holderAgvId) ?? []), retention]);
  const flagged = concentrated(
    new Map([...grouped].map(([agvId, list]) => [agvId, list.length])),
    passes,
    thresholds.maxFalsePoints,
  );
  const holders: Holder[] = [...grouped].map(([agvId, list]) => {
    const retained = [...new Set(list.map((retention) => retention.agvId))].sort();
    const expected = flagged.get(agvId);
    return {
      agvId,
      retentions: list.length,
      retained,
      waitMs: list.reduce((sum, retention) => sum + retention.waitMs, 0),
      sites: [...new Set(list.map((retention) => retention.holderTagId))].sort(),
      passes: passes.get(agvId) ?? 0,
      expected: expected !== undefined && retained.length >= thresholds.minVehiclesForContrast ? expected : null,
    };
  });
  holders.sort(
    (a, b) => Number(b.expected !== null) - Number(a.expected !== null) || b.retentions - a.retentions || a.agvId.localeCompare(b.agvId),
  );
  return { fleetRatio, vehicles, holders };
}

/**
 * El ritmo dentro de un fichero, contra la horquilla de ese fichero (R-TIM-011): así se ve si un AGV se
 * vuelve más lento de un fichero al siguiente. Las paradas y retenciones son las del análisis entero,
 * recortadas a la ventana.
 */
export function paceInWindow(
  input: Omit<PaceInput, "bands">,
  window: Interval,
  ring: readonly string[],
  bandThresholds: BandThresholds,
  minMarginMs: number,
  thresholds: VehiclePaceThresholds,
): PaceReport {
  const inside = <T extends { readonly fromTime: number; readonly toTime: number }>(entry: T): boolean =>
    entry.fromTime >= window.from && entry.toTime <= window.to;
  const transitions = input.transitions.filter(inside);
  const bands = buildSegmentBands(transitions, ring, input.regimeOf, bandThresholds, minMarginMs);
  const within = (from: number, to: number): boolean => from >= window.from && to <= window.to;
  return vehiclePace(
    {
      ...input,
      transitions,
      bands,
      flow: {
        stops: input.flow.stops.filter((stop) => within(stop.fromUtcMs, stop.toUtcMs)),
        retentions: input.flow.retentions.filter((retention) => within(retention.fromUtcMs, retention.toUtcMs)),
      },
    },
    thresholds,
  );
}

/** Un número con coma decimal, para una hoja de cálculo en español. */
function decimal(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

/**
 * El CSV del ritmo de un fichero: `agv;muestras;ritmo;veredicto;retenciones;min_retenidos`. El ritmo es
 * el del AGV frente al de la flota (1 = igual); retenciones y minutos, los de los AGV que esperaron
 * detrás de él.
 */
export function paceCsv(report: PaceReport): string {
  const holders = new Map(report.holders.map((holder) => [holder.agvId, holder]));
  const ids = [...new Set([...report.vehicles.map((vehicle) => vehicle.agvId), ...holders.keys()])].sort();
  const byId = new Map(report.vehicles.map((vehicle) => [vehicle.agvId, vehicle]));
  const rows = ids.map((agvId) => {
    const vehicle = byId.get(agvId);
    const holder = holders.get(agvId);
    return [
      agvId,
      String(vehicle?.samples ?? 0),
      vehicle === undefined ? "" : decimal(vehicle.ratio / vehicle.fleetRatio, 3),
      vehicle?.verdict ?? "",
      String(holder?.retentions ?? 0),
      decimal((holder?.waitMs ?? 0) / 60_000, 1),
    ].join(";");
  });
  return ["agv;muestras;ritmo;veredicto;retenciones;min_retenidos", ...rows].join("\r\n");
}
