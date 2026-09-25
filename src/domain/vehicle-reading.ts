/**
 * Lectura de cada AGV sobre los tags que el resto de la flota lee bien (R-AGV-016).
 *
 * Separa lo que un AGV **no lee nunca** de lo que **lee poco**, y lo que **dejó de leer desde una
 * hora**. Enseña la diferencia medida —«0 de 41 pasadas», «el 51 %», «desde las 17:40, 0 de 12»— y no
 * nombra causa: memoria, lector o colocación los decide una persona (R-EVI-006).
 *
 * Solo cuentan los tags que el resto lee bien: si casi nadie lee un tag, el hallazgo es del tag y ya
 * sale como tal en su fila. Y cada celda viene medida dentro de la vida del tag (R-OPP-016), así que
 * un tag muerto o recién puesto no cuenta contra ningún AGV.
 *
 * «Poco» no es cualquier cifra por debajo del umbral: tiene que ser **improbable por azar** frente a lo
 * que lee el resto en ese mismo tag (`maxChance`). Un tag que la flota lee al 85 % deja a varios AGV en
 * el 76 % por pura casualidad, y eso no es una diferencia.
 *
 * «Nunca» es cero lecturas con la misma prueba de azar, se hayan dado las pasadas que se hayan dado, y
 * siempre con su cifra —«0 de 5», «0 de 41»—. Hasta la Parte 48 exigía además `minPassesForNever`
 * pasadas, y con menos el AGV salía como «lee poco» con un 0 %: un 0 % no es poco, es no leerlo nunca
 * (propietario, 2026-09-25, probando con datos de taller). Con pocas pasadas solo sale cuando el resto
 * lo lee casi siempre: si lo lee al 80 %, hacen falta cinco para que cero no sea casualidad.
 *
 * `extent` dice si le pasa en **muchos** tags o en **pocos**. Ordena y agrupa; no es un diagnóstico.
 */

import type { PairReadRate, ReadMatrix, ReadRateThresholds } from "./read-matrix.js";

export interface VehicleReadingThresholds {
  /** Pasadas mínimas sin leer para decir «desde tal hora, 0 lecturas». */
  readonly minPassesForNever: number;
  /** Cuota del resto de AGV que tiene que leer bien un tag para que cuente contra uno que no. */
  readonly fleetReadsWellShare: number;
  /** A partir de qué parte de sus tags se dice que lee poco en «muchos». */
  readonly manyTagsShare: number;
  /** Y con cuántos tags como mínimo. */
  readonly minManyTags: number;
  /** Probabilidad máxima de que leer tan poco sea casualidad, dada la tasa del resto en ese tag. */
  readonly maxChance: number;
}

export interface VehicleReading {
  readonly agvId: string;
  /** Tags que el resto lee bien y este AGV recorre con pasadas suficientes. */
  readonly consideredTags: number;
  readonly never: readonly { readonly tagId: string; readonly passes: number }[];
  readonly stopped: readonly { readonly tagId: string; readonly sinceUtcMs: number; readonly passesSince: number }[];
  readonly weak: readonly { readonly tagId: string; readonly hits: number; readonly passes: number }[];
  /** `null` si no lee poco ningún tag. */
  readonly extent: "muchos" | "pocos" | null;
}

/** Lo mismo visto desde el tag: quién no lo lee nunca, quién dejó de leerlo y quién lo lee poco. */
export interface TagReaders {
  readonly tagId: string;
  /** Con sus pasadas: «0 de 5» no pesa lo mismo que «0 de 41». */
  readonly never: readonly { readonly agvId: string; readonly passes: number }[];
  readonly stopped: readonly string[];
  readonly weak: readonly { readonly agvId: string; readonly hits: number; readonly passes: number }[];
  readonly good: number;
}

export interface VehicleReadingReport {
  /** Solo los AGV con alguna diferencia, en orden: nunca, desde una hora, poco en muchos, poco en pocos. */
  readonly vehicles: readonly VehicleReading[];
  /** Solo los tags que el resto lee bien y alguien no. */
  readonly tags: readonly TagReaders[];
}

type CellKind = "bien" | "nunca" | "desde" | "poco";

export function describeVehicleReading(
  matrix: Pick<ReadMatrix, "tags">,
  readRate: Pick<ReadRateThresholds, "minPassesPerPair" | "minVehiclesForContrast" | "highRate">,
  thresholds: VehicleReadingThresholds,
): VehicleReadingReport {
  const kindOf = (cell: PairReadRate): CellKind => {
    const rate = cell.hits / cell.passes;
    if (cell.hits === 0) return "nunca";
    if (
      cell.hits > 0 &&
      cell.trailingMisses >= thresholds.minPassesForNever &&
      cell.hits / (cell.passes - cell.trailingMisses) >= readRate.highRate
    ) {
      return "desde";
    }
    return rate >= readRate.highRate ? "bien" : "poco";
  };
  /** Tasa del resto de AGV con pasadas suficientes en ese tag, sin contar este. */
  const othersRate = (supported: readonly PairReadRate[], own: PairReadRate): number => {
    let hits = 0;
    let passes = 0;
    for (const cell of supported) {
      if (cell === own) continue;
      hits += cell.hits;
      passes += cell.passes;
    }
    return passes === 0 ? 0 : hits / passes;
  };

  const byVehicle = new Map<
    string,
    { considered: number; never: VehicleReading["never"][number][]; stopped: VehicleReading["stopped"][number][]; weak: VehicleReading["weak"][number][] }
  >();
  const entry = (agvId: string) => {
    let found = byVehicle.get(agvId);
    if (found === undefined) {
      found = { considered: 0, never: [], stopped: [], weak: [] };
      byVehicle.set(agvId, found);
    }
    return found;
  };
  const tags: TagReaders[] = [];

  for (const row of matrix.tags) {
    // El ancla se lee siempre por construcción: no dice nada de nadie.
    if (row.isAnchor) continue;
    const supported = row.byVehicle.filter((cell) => cell.passes >= readRate.minPassesPerPair);
    if (supported.length < readRate.minVehiclesForContrast + 1) continue;
    const good = supported.filter((cell) => cell.hits / cell.passes >= readRate.highRate).length;

    const never: TagReaders["never"][number][] = [];
    const stopped: string[] = [];
    const weak: TagReaders["weak"][number][] = [];
    for (const cell of supported) {
      const kind = kindOf(cell);
      // ¿Lo lee bien el resto? Se descuenta la propia celda del recuento.
      const others = supported.length - 1;
      const othersGood = good - (kind === "bien" ? 1 : 0);
      if (othersGood / others < thresholds.fleetReadsWellShare) continue;

      const own = entry(cell.agvId);
      own.considered += 1;
      if (kind === "nunca") {
        // Cero lecturas, pero solo si no es casualidad frente a lo que lee el resto; si lo es, sigue
        // contando como tag comparado y no se dice nada.
        if (lowerTail(0, cell.passes, othersRate(supported, cell)) > thresholds.maxChance) continue;
        own.never.push({ tagId: row.tagId, passes: cell.passes });
        never.push({ agvId: cell.agvId, passes: cell.passes });
      } else if (kind === "desde") {
        own.stopped.push({ tagId: row.tagId, sinceUtcMs: cell.lastHitUtcMs as number, passesSince: cell.trailingMisses });
        stopped.push(cell.agvId);
      } else if (kind === "poco") {
        // Sigue contando como tag comparado: lo lee dentro de lo que cabe esperar por azar.
        if (lowerTail(cell.hits, cell.passes, othersRate(supported, cell)) > thresholds.maxChance) continue;
        own.weak.push({ tagId: row.tagId, hits: cell.hits, passes: cell.passes });
        weak.push({ agvId: cell.agvId, hits: cell.hits, passes: cell.passes });
      }
    }
    if (never.length + stopped.length + weak.length > 0) {
      tags.push({ tagId: row.tagId, never, stopped, weak, good });
    }
  }

  const vehicles: VehicleReading[] = [...byVehicle]
    .filter(([, own]) => own.never.length + own.stopped.length + own.weak.length > 0)
    .map(([agvId, own]) => ({
      agvId,
      consideredTags: own.considered,
      never: own.never,
      stopped: own.stopped,
      weak: own.weak,
      extent:
        own.weak.length === 0
          ? null
          : own.weak.length >= thresholds.minManyTags && own.weak.length / own.considered >= thresholds.manyTagsShare
            ? "muchos"
            : "pocos",
    }));

  const rank = (vehicle: VehicleReading): number =>
    vehicle.never.length > 0 ? 0 : vehicle.stopped.length > 0 ? 1 : vehicle.extent === "muchos" ? 2 : 3;
  vehicles.sort((a, b) => rank(a) - rank(b) || b.weak.length - a.weak.length || a.agvId.localeCompare(b.agvId));
  return { vehicles, tags };
}

/**
 * Probabilidad de leer `hits` o menos en `passes` pasadas si se leyera como el resto (`rate`): la cola
 * inferior de una binomial, sumada en logaritmos para que no se pierda en ceros con muchas pasadas.
 */
function lowerTail(hits: number, passes: number, rate: number): number {
  if (rate >= 1) return hits < passes ? 0 : 1;
  if (rate <= 0) return 1;
  const logP = Math.log(rate);
  const logQ = Math.log(1 - rate);
  let logPmf = passes * logQ;
  let max = logPmf;
  const terms = [logPmf];
  for (let index = 0; index < hits; index += 1) {
    logPmf += Math.log(passes - index) - Math.log(index + 1) + logP - logQ;
    terms.push(logPmf);
    if (logPmf > max) max = logPmf;
  }
  let sum = 0;
  for (const term of terms) sum += Math.exp(term - max);
  return Math.min(1, Math.exp(max) * sum);
}
