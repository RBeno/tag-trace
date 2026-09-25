/**
 * Lecturas que llegaron juntas al servidor (R-DAT-020).
 *
 * La hora de cada lectura del fichero es la de **recepción en el servidor**, no la de lectura en el
 * AGV (propietario, 2026-09-25). Un AGV que se queda sin comunicación sigue leyendo tags, los guarda y
 * los vuelca al reconectar: el servidor los recibe todos casi a la vez. En el fichero eso no desordena
 * nada —la pila es el orden de llegada—; se ve como **un hueco largo seguido de varias lecturas casi
 * seguidas**. Leído tal cual, el hueco parece una parada del AGV, y no lo es.
 *
 * **La firma**, en la secuencia de un AGV:
 *
 * 1. una transición P → X1 por encima del p95 de su horquilla (el hueco);
 * 2. después, `minFastSteps` o más transiciones seguidas, cada una del mismo instante o por debajo de
 *    `fastRatio` veces la mitad de su tramo;
 * 3. todas juntas en menos de `fastRatio` veces el tramo más corto de ellas: varios tags recorridos
 *    en menos de lo que cuesta uno. Ningún AGV lo hace circulando;
 * 4. y el hueco se lleva al menos `fastRatio` del recorrido habitual de P a Q: las lecturas de en medio
 *    llegaron cuando el AGV ya estaba cerca de Q, así que el tiempo del recorrido cayó en el hueco.
 *
 * La tercera condición separa una ráfaga de un AGV que recupera el ritmo tras una espera: dos pasos de
 * medio tramo son rápidos cada uno, pero juntos cuestan un tramo entero. La cuarta separa una ráfaga de
 * un AGV que simplemente va más deprisa que la horquilla de su régimen —al empezar la noche, por
 * ejemplo, cuando la horquilla ya es la de noche y él aún va a ritmo de día—: ahí los pasos parecen
 * rápidos, pero el hueco es un tramo normal y no se lleva nada del recorrido.
 *
 * **La suma entre P y Q** (la última lectura de la ráfaga) decide qué pasó:
 *
 * - dentro de la valla de P a Q → `sin-parada`: el AGV no paró, las lecturas llegaron tarde;
 * - por encima → `con-tiempo-de-mas`: hubo una espera entre P y Q, pero no se puede decir dónde,
 *   porque las horas de en medio son de llegada.
 *
 * En los dos casos las horas de en medio no miden nada, así que la ráfaga se **colapsa** en una sola
 * transición de P a Q para todo el análisis de tiempos: horquillas, paradas, lo habitual de cada tramo
 * y las firmas de tiempo. Una espera real sigue saliendo, ahora de P a Q. La topología no cambia: esos
 * tags se leyeron.
 *
 * Con resolución de minuto no se evalúa: ahí casi todas las transiciones son del mismo instante y
 * «casi seguidas» no distingue nada.
 */

import { concentrated } from "./circuit-state.js";
import type { Transition } from "./graph.js";
import { bandFor, transitionRegime, type Regime, type SegmentBands } from "./segment-bands.js";

export interface GroupedDeliveryThresholds {
  /** Transiciones casi seguidas, como mínimo, tras el hueco para hablar de ráfaga. */
  readonly minFastSteps: number;
}

export type GroupedDeliveryKind = "sin-parada" | "con-tiempo-de-mas";

export interface GroupedDelivery {
  readonly agvId: string;
  /** La última lectura antes del hueco. */
  readonly fromTagId: string;
  readonly fromUtcMs: number;
  /** Las lecturas que llegaron juntas, en orden; la última es Q. */
  readonly tags: readonly string[];
  /** Cuándo llegó la primera de la ráfaga. */
  readonly arrivedUtcMs: number;
  /** Cuándo llegó la última: el final del recorrido de P a Q. */
  readonly toUtcMs: number;
  /** El hueco sin nada antes de la ráfaga. */
  readonly gapMs: number;
  /** Lo que tardaron en llegar todas las de la ráfaga. */
  readonly spreadMs: number;
  /** El recorrido entero, de P a Q. */
  readonly totalMs: number;
  /** Lo habitual de P a Q en su régimen, y su valla. */
  readonly usualMs: number;
  readonly fenceMs: number;
  readonly regime: Regime;
  readonly kind: GroupedDeliveryKind;
}

export interface GroupedDeliveryReport {
  readonly evaluated: boolean;
  /** Por qué no se evaluó, cuando no se evaluó. Nunca se calla. */
  readonly reason: string | null;
  /** Las transiciones con cada ráfaga sustituida por una sola de P a Q, en el mismo orden. */
  readonly transitions: readonly Transition[];
  readonly deliveries: readonly GroupedDelivery[];
}

const SECOND_MS = 1_000;

/**
 * Busca las ráfagas y las colapsa. `bands` es una horquilla previa, hecha con las mismas
 * transiciones: una ráfaga es rara, así que apenas la mueve, y sin ella no hay con qué juzgar qué es
 * un hueco ni qué es imposible de rápido.
 */
export function collapseGroupedDeliveries(
  transitions: readonly Transition[],
  bands: SegmentBands | null,
  regimeOf: (utcMs: number) => Regime,
  fastRatio: number,
  laneTags: ReadonlySet<string>,
  thresholds: GroupedDeliveryThresholds,
): GroupedDeliveryReport {
  if (bands === null) {
    return { evaluated: false, reason: "sin horquilla con que comparar", transitions, deliveries: [] };
  }
  if (bands.resolutionMs > SECOND_MS) {
    return {
      evaluated: false,
      reason: "con resolución de minuto no se distinguen lecturas que llegaron juntas",
      transitions,
      deliveries: [],
    };
  }

  // Secuencia de cada AGV, con el índice original para devolver el mismo orden.
  const byVehicle = new Map<string, number[]>();
  transitions.forEach((transition, index) => {
    const own = byVehicle.get(transition.agvId);
    if (own === undefined) byVehicle.set(transition.agvId, [index]);
    else own.push(index);
  });

  const inLane = (transition: Transition): boolean => laneTags.has(transition.from) || laneTags.has(transition.to);
  const bandOf = (transition: Transition) =>
    bandFor(bands, transition.from, transition.to, transitionRegime(transition, regimeOf));
  const follows = (previous: Transition, next: Transition): boolean =>
    previous.toTime === next.fromTime && previous.to === next.from;

  /** Índice original → transición que ocupa ese sitio en la salida (la colapsada, o nada). */
  const replaced = new Map<number, Transition>();
  const dropped = new Set<number>();
  const deliveries: GroupedDelivery[] = [];

  for (const [agvId, indices] of byVehicle) {
    let i = 0;
    while (i < indices.length) {
      const first = transitions[indices[i] as number] as Transition;
      const gap = first.toTime - first.fromTime;
      const firstBand = first.sameInstant || inLane(first) ? null : bandOf(first);
      if (firstBand === null || gap <= firstBand.p95Ms) {
        i += 1;
        continue;
      }

      // La ráfaga más larga que sigue cumpliendo: cada paso imposible de rápido, y todos juntos
      // en menos de lo que cuesta el tramo más corto de ellos.
      let end = i;
      let shortestUsual = Infinity;
      for (let j = i + 1; j < indices.length; j += 1) {
        const previous = transitions[indices[j - 1] as number] as Transition;
        const next = transitions[indices[j] as number] as Transition;
        if (!follows(previous, next) || inLane(next)) break;
        const band = bandOf(next);
        const took = next.toTime - next.fromTime;
        const fast = next.sameInstant || (band !== null && took < fastRatio * band.p50Ms);
        if (!fast) break;
        const usual = band === null ? shortestUsual : Math.min(shortestUsual, band.p50Ms);
        const start = (transitions[indices[i + 1] as number] as Transition).fromTime;
        if (next.toTime - start >= fastRatio * usual) break;
        shortestUsual = usual;
        end = j;
      }
      const steps = end - i;
      if (steps < thresholds.minFastSteps) {
        i += 1;
        continue;
      }

      const last = transitions[indices[end] as number] as Transition;
      const whole: Transition = {
        agvId,
        from: first.from,
        to: last.to,
        fromTime: first.fromTime,
        toTime: last.toTime,
        sameInstant: false,
      };
      const regime = transitionRegime(whole, regimeOf);
      const expected = whole.from === whole.to ? null : bandFor(bands, whole.from, whole.to, regime);
      if (expected === null || gap < fastRatio * expected.p50Ms) {
        // Sin horquilla de P a Q no hay suma con que comparar; y si el hueco no se lleva el recorrido,
        // no es una ráfaga: se deja como está.
        i += 1;
        continue;
      }
      const totalMs = whole.toTime - whole.fromTime;
      const arrivedUtcMs = first.toTime;
      deliveries.push({
        agvId,
        fromTagId: first.from,
        fromUtcMs: first.fromTime,
        tags: indices.slice(i, end + 1).map((index) => (transitions[index] as Transition).to),
        arrivedUtcMs,
        toUtcMs: last.toTime,
        gapMs: gap,
        spreadMs: last.toTime - arrivedUtcMs,
        totalMs,
        usualMs: expected.p50Ms,
        fenceMs: expected.fenceMs,
        regime,
        kind: totalMs <= expected.fenceMs ? "sin-parada" : "con-tiempo-de-mas",
      });
      replaced.set(indices[i] as number, whole);
      for (let k = i + 1; k <= end; k += 1) dropped.add(indices[k] as number);
      i = end + 1;
    }
  }

  const collapsed: Transition[] = [];
  transitions.forEach((transition, index) => {
    if (dropped.has(index)) return;
    collapsed.push(replaced.get(index) ?? transition);
  });
  deliveries.sort((a, b) => a.fromUtcMs - b.fromUtcMs || a.agvId.localeCompare(b.agvId));
  return { evaluated: true, reason: null, transitions: collapsed, deliveries };
}

export interface DeliveryConcentration {
  readonly id: string;
  readonly count: number;
  /** Lo que daría el azar con su exposición: sus transiciones (AGV) o sus pasadas (sitio). */
  readonly expected: number;
}

export interface DeliverySummary {
  /** AGV y sitios (el tag P) donde se concentran más de lo que da el azar, de más a menos. */
  readonly vehicles: readonly DeliveryConcentration[];
  readonly sites: readonly DeliveryConcentration[];
}

/**
 * Dónde se concentran: un AGV al que le pasa mucho más que al resto apunta a su comunicación; un
 * sitio donde le pasa a muchos, a la cobertura de ese sitio. Con el mismo test que los cuellos de
 * botella (`concentrated`): lo que daría el azar con su exposición, mirando todos a la vez.
 */
export function summarizeDeliveries(
  deliveries: readonly GroupedDelivery[],
  transitions: readonly Transition[],
  maxFalsePoints: number,
): DeliverySummary {
  const count = (key: (delivery: GroupedDelivery) => string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const delivery of deliveries) counts.set(key(delivery), (counts.get(key(delivery)) ?? 0) + 1);
    return counts;
  };
  const exposure = (key: (transition: Transition) => string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const transition of transitions) counts.set(key(transition), (counts.get(key(transition)) ?? 0) + 1);
    return counts;
  };
  const flagged = (counts: Map<string, number>, exposed: Map<string, number>): DeliveryConcentration[] =>
    [...concentrated(counts, exposed, maxFalsePoints)]
      .map(([id, expected]) => ({ id, count: counts.get(id) ?? 0, expected }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return {
    vehicles: flagged(
      count((delivery) => delivery.agvId),
      exposure((transition) => transition.agvId),
    ),
    sites: flagged(
      count((delivery) => delivery.fromTagId),
      exposure((transition) => transition.from),
    ),
  };
}
