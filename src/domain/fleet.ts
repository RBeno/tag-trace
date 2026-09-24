/**
 * La flota del circuito a lo largo del tiempo (DS-012, R-AGV-014, R-AGV-015).
 *
 * Responde «cuántos AGV de los asignados estaban en funcionamiento en cada momento» — el «38 de 40»
 * del propietario — y enseña la vida de cada uno en **tramos continuos**, no en franjas fijas:
 * leyendo, cargando, sin lecturas, ausente, fuera del circuito o sin datos.
 *
 * Dos fuentes que ya existen y una nueva:
 *
 * - las **inactividades** del expediente (`dossier.ts`), con su causa — silencio o carga en calle
 *   (R-CO-006) —, y los **arranques en frío** de `charging.ts` (R-CO-007);
 * - la **cobertura**, que manda sobre todo lo demás: fuera de ella no hay datos (R-DAT-007), y un
 *   hueco entre dos exportaciones nunca es un silencio;
 * - el **historial de flota** que declara el propietario: qué AGV estaba asignado al circuito y
 *   desde cuándo. Sin él, la flota asignada son los vehículos que aparecen en las lecturas, y la
 *   vista lo dice: un AGV asignado que no lee nada no se puede contar sin el historial.
 *
 * Cada hueco sin carga lleva además **cómo reapareció** el AGV (R-AGV-017, `silence-kind.ts`):
 * parado en su sitio, un tag o varios más allá, una hora o más fuera, o por un tag de mantenimiento.
 * Un hueco que ese tramo tiene a menudo en ese turno no es un hueco: se dibuja leyendo.
 *
 * Nada de esto decide por qué un vehículo está ausente, en silencio o leyendo sin estar asignado:
 * lo enseña con sus tramos (R-EVI-006).
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import type { Reading } from "./reading.js";
import type { SilenceDetail, SilenceKind } from "./silence-kind.js";

/** Un periodo de asignación de un AGV al circuito: `[desde, hasta)`. `hasta` nulo = sigue asignado. */
export interface FleetPeriod {
  readonly agvId: string;
  readonly fromUtcMs: number;
  readonly toUtcMs: number | null;
  readonly note: string;
}

/**
 * La forma del fichero de historial, para enseñarla **antes** de pedirlo: se escribe a mano, y quien
 * decide el formato no puede pedirle a quien escribe que lo adivine (mismo criterio que las listas).
 */
export const FLEET_STRUCTURE = {
  header: ["circuito", "agv", "desde", "hasta", "nota"],
  required: ["agv", "desde"],
  optional: ["circuito", "hasta", "nota"],
  example: [
    "circuito;agv;desde;hasta;nota",
    "SE2/4;7101;01/09/2026;;",
    "SE2/4;7120;01/09/2026;20/09/2026 14:30;pasa a SE6/8",
    "SE6/8;7120;20/09/2026 14:30;;",
  ],
} as const;

/**
 * Fusiona lo cargado con lo guardado, por la clave (AGV, `desde`).
 *
 * Es lo que permite al propietario subir **solo el cambio**: una fila con la misma clave sustituye a
 * la anterior —así se cierra un periodo, añadiéndole su `hasta`— y las demás se conservan. A
 * diferencia de las listas, que se sustituyen enteras, el historial crece con el circuito.
 */
export function mergeFleetPeriods(
  existing: readonly FleetPeriod[],
  incoming: readonly FleetPeriod[],
): { readonly periods: readonly FleetPeriod[]; readonly added: number; readonly replaced: number } {
  const key = (period: FleetPeriod): string => `${period.agvId}\u0000${period.fromUtcMs}`;
  const merged = new Map(existing.map((period) => [key(period), period]));
  let added = 0;
  let replaced = 0;
  for (const period of incoming) {
    if (merged.has(key(period))) replaced += 1;
    else added += 1;
    merged.set(key(period), period);
  }
  const periods = [...merged.values()].sort(
    (a, b) => a.agvId.localeCompare(b.agvId) || a.fromUtcMs - b.fromUtcMs,
  );
  return { periods, added, replaced };
}

/** Periodos del mismo AGV que se pisan. No se rechazan —puede ser un traspaso a mitad de turno—: se avisan. */
export function overlappingPeriods(periods: readonly FleetPeriod[]): readonly string[] {
  const byAgv = new Map<string, FleetPeriod[]>();
  for (const period of periods) byAgv.set(period.agvId, [...(byAgv.get(period.agvId) ?? []), period]);
  const overlapping: string[] = [];
  for (const [agvId, list] of byAgv) {
    const sorted = [...list].sort((a, b) => a.fromUtcMs - b.fromUtcMs);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1] as FleetPeriod;
      const current = sorted[index] as FleetPeriod;
      if (previous.toUtcMs === null || current.fromUtcMs < previous.toUtcMs) {
        overlapping.push(agvId);
        break;
      }
    }
  }
  return overlapping;
}

export type FleetState =
  /** Asignado y leyendo: entre dos lecturas sin inactividad. En funcionamiento. */
  | "leyendo"
  /** Asignado y en una calle de carga (inferido, R-CO-006) o arranque en frío (R-CO-007). En funcionamiento. */
  | "carga"
  /** Asignado, entre dos lecturas, sin carga que explique el hueco: falta de lecturas (R-AGV-006). */
  | "silencio"
  /** Asignado y sin lecturas: antes de la primera, después de la última, o en toda la ventana. */
  | "ausente"
  /** No asignado según el historial, y sin actividad. No entra en la flota de ese momento. */
  | "fuera"
  /** Lee o carga sin estar asignado: historial desactualizado o AGV de otro circuito (R-AGV-015). */
  | "leyendo-sin-asignar"
  /** Fuera de la cobertura cargada: no hay datos y no se cuenta (R-DAT-007). */
  | "sin-datos";

/** Clase de un hueco en la vida de un AGV. «Habitual» no llega aquí: se dibuja leyendo. */
export type GapKind = Exclude<SilenceKind, "habitual">;

export interface FleetSegment {
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly state: FleetState;
  /** Solo en `silencio` y `ausente`: cómo reapareció (R-AGV-017). Sin él, un ausente corto. */
  readonly kind?: GapKind;
  readonly detail?: SilenceDetail;
}

/** Un hueco del expediente, con su causa y, si se clasificó, cómo reapareció el AGV. */
export interface FleetGap {
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly cause: "silencio" | "carga-online";
  readonly kind?: SilenceKind;
  readonly detail?: SilenceDetail;
}

export interface FleetVehicle {
  readonly agvId: string;
  /** Si el historial lo asigna al circuito en algún momento de la ventana. Sin historial, sí. */
  readonly assignedEver: boolean;
  readonly readings: number;
  readonly segments: readonly FleetSegment[];
}

/** Un intervalo con el mismo recuento. Solo dentro de la cobertura. */
export interface FleetCount {
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  /** N: asignados que leen o cargan. */
  readonly inService: number;
  /** M: asignados en ese momento. */
  readonly assigned: number;
  /** Los que leen o cargan sin estar asignados. Nunca suman a N. */
  readonly unassignedActive: number;
}

export interface FleetTimeline {
  readonly historyLoaded: boolean;
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  readonly vehicles: readonly FleetVehicle[];
  readonly counts: readonly FleetCount[];
}

export interface FleetInput {
  readonly readings: readonly Reading[];
  readonly coverage: readonly Interval[];
  /** `null` sin historial cargado: la flota son los vehículos que aparecen en las lecturas. */
  readonly history: readonly FleetPeriod[] | null;
  /** Las inactividades de cada vehículo, con su causa, tal como las calcula el expediente. */
  readonly inactivity: ReadonlyMap<string, readonly FleetGap[]>;
  /** Instante de salida de los que ya estaban cargando al empezar la cobertura (R-CO-007). */
  readonly coldStarts: ReadonlyMap<string, number>;
  /**
   * El mismo umbral de silencio con el que el expediente decide si un hueco entre dos lecturas es
   * inactividad. Se aplica igual a los bordes de cada tramo de cobertura: antes de la primera lectura
   * y después de la última, un hueco más corto es el ritmo normal de lectura, no una ausencia. Sin
   * valor por defecto (`AI_DEVELOPMENT_GOVERNANCE.md` §4).
   */
  readonly minGapMs: number;
  /**
   * A partir de cuánto un borde sin lecturas —antes de la primera o después de la última de un tramo
   * de cobertura— es desconexión y no un ausente corto (R-AGV-017). Sin valor por defecto.
   */
  readonly longAbsenceMs: number;
}

type Piece = [number, number, FleetState, (GapKind | undefined)?, (SilenceDetail | undefined)?];

/** Parte `pieces` por los bordes de `spans` y aplica `inside`/`outside` a cada trozo. */
function splitBy(
  pieces: readonly Piece[],
  spans: readonly Interval[],
  relabel: (state: FleetState, inside: boolean) => FleetState,
): Piece[] {
  const out: Piece[] = [];
  for (const [from, to, state, kind, detail] of pieces) {
    let cursor = from;
    // Un tramo que cambia de estado pierde su clase: «fuera» o «sin datos» no reaparecen de ningún sitio.
    const piece = (a: number, b: number, inside: boolean): Piece => {
      const next = relabel(state, inside);
      return next === state ? [a, b, state, kind, detail] : [a, b, next];
    };
    for (const span of spans) {
      if (span.to <= cursor || span.from >= to) continue;
      if (span.from > cursor) out.push(piece(cursor, span.from, false));
      const end = Math.min(to, span.to);
      out.push(piece(Math.max(cursor, span.from), end, true));
      cursor = end;
    }
    if (cursor < to) out.push(piece(cursor, to, false));
  }
  return out;
}

function mergeAdjacent(pieces: readonly Piece[]): FleetSegment[] {
  const out: FleetSegment[] = [];
  for (const [from, to, state, kind, detail] of pieces) {
    if (to <= from) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.state === state && last.toUtcMs === from && last.kind === kind && last.detail === detail) {
      out[out.length - 1] = { ...last, toUtcMs: to };
    } else {
      out.push({ fromUtcMs: from, toUtcMs: to, state, ...(kind === undefined ? {} : { kind }), ...(detail === undefined ? {} : { detail }) });
    }
  }
  return out;
}

const IN_SERVICE: ReadonlySet<FleetState> = new Set(["leyendo", "carga"]);
const ASSIGNED: ReadonlySet<FleetState> = new Set(["leyendo", "carga", "silencio", "ausente"]);

/** La vida de cada AGV en tramos continuos, y el recuento N de M a lo largo de la ventana. */
export function buildFleetTimeline(input: FleetInput): FleetTimeline {
  const coverage = mergeIntervals([...input.coverage]);
  const timesOf = new Map<string, number[]>();
  /** Qué tag leyó cada AGV en cada instante: lo que dice el borde de un tramo sin lecturas. */
  const tagsOf = new Map<string, Map<number, string>>();
  for (const reading of input.readings) {
    const list = timesOf.get(reading.agvId);
    if (list === undefined) timesOf.set(reading.agvId, [reading.time.utcMs]);
    else list.push(reading.time.utcMs);
    let tags = tagsOf.get(reading.agvId);
    if (tags === undefined) {
      tags = new Map();
      tagsOf.set(reading.agvId, tags);
    }
    tags.set(reading.time.utcMs, reading.tagId);
  }
  const stats = new Map<string, { first: number; last: number; count: number }>();
  for (const [agvId, times] of timesOf) {
    times.sort((a, b) => a - b);
    stats.set(agvId, { first: times[0] as number, last: times[times.length - 1] as number, count: times.length });
  }

  let windowFrom = Infinity;
  let windowTo = -Infinity;
  for (const span of coverage) {
    windowFrom = Math.min(windowFrom, span.from);
    windowTo = Math.max(windowTo, span.to);
  }
  for (const entry of stats.values()) {
    windowFrom = Math.min(windowFrom, entry.first);
    windowTo = Math.max(windowTo, entry.last);
  }
  if (!Number.isFinite(windowFrom) || windowTo <= windowFrom) {
    return { historyLoaded: input.history !== null, fromUtcMs: 0, toUtcMs: 0, vehicles: [], counts: [] };
  }
  const covered = coverage.length > 0 ? coverage : [{ from: windowFrom, to: windowTo }];

  // Periodos de asignación por AGV, recortados a la ventana.
  const assignment = new Map<string, Interval[]>();
  if (input.history !== null) {
    for (const period of input.history) {
      const from = Math.max(period.fromUtcMs, windowFrom);
      const to = Math.min(period.toUtcMs ?? windowTo, windowTo);
      if (to <= from) continue;
      assignment.set(period.agvId, [...(assignment.get(period.agvId) ?? []), { from, to }]);
    }
  }
  const ids = new Set<string>([...stats.keys(), ...assignment.keys()]);

  const vehicles: FleetVehicle[] = [...ids].sort().map((agvId) => {
    const own = stats.get(agvId);
    // 1. Lo que dicen las lecturas, tramo de cobertura a tramo de cobertura. Un hueco entre
    //    exportaciones no es de nadie: se parte en el borde de un tramo y el principio del siguiente,
    //    y cada borde se juzga por sí solo (R-DAT-007).
    // Lo que la ventana tiene fuera de la cobertura (el último minuto incompleto de una exportación,
    // por ejemplo) es sin datos desde el principio.
    const firstCovered = covered[0] as Interval;
    const lastCovered = covered[covered.length - 1] as Interval;
    const pieces0: Piece[] = [[windowFrom, firstCovered.from, "sin-datos"]];
    const times = timesOf.get(agvId) ?? [];
    const coldExit = input.coldStarts.get(agvId);
    const gaps = [...(input.inactivity.get(agvId) ?? [])].sort((a, b) => a.fromUtcMs - b.fromUtcMs);
    // Antes de la primera lectura o después de la última, un hueco más corto que el umbral de
    // silencio es el ritmo normal de lectura; más largo, el AGV no estaba (o no se sabe si estaba), y
    // a partir de `longAbsenceMs` es desconexión (R-AGV-017).
    const edge = (from: number, to: number, detail: SilenceDetail): Piece =>
      to - from < input.minGapMs
        ? [from, to, "leyendo"]
        : to - from >= input.longAbsenceMs
          ? [from, to, "ausente", "desconexion", detail]
          : [from, to, "ausente"];
    const edgeDetail = (
      edgeKind: "inicio" | "fin" | "todo",
      lastTagBefore: string | null,
      firstTagAfter: string | null,
    ): SilenceDetail => ({
      lastTagBefore,
      firstTagAfter,
      nextTagId: null,
      skipped: null,
      usualMs: null,
      shift: null,
      edge: edgeKind,
    });
    const tagAt = tagsOf.get(agvId) ?? new Map<number, string>();
    covered.forEach((span, index) => {
      const next = covered[index + 1];
      const inside = times.filter((t) => t >= span.from && t <= span.to);
      const first = inside[0];
      const last = inside[inside.length - 1];
      if (first === undefined || last === undefined) {
        pieces0.push(edge(span.from, span.to, edgeDetail("todo", null, null)));
      } else {
        pieces0.push(
          coldExit === first
            ? [span.from, first, "carga"]
            : edge(span.from, first, edgeDetail("inicio", null, tagAt.get(first) ?? null)),
        );
        let cursor = first;
        for (const gap of gaps) {
          // Solo los huecos enteros dentro del tramo: uno que cruza un hueco de cobertura no mide nada.
          if (gap.fromUtcMs < first || gap.toUtcMs > last) continue;
          if (gap.fromUtcMs > cursor) pieces0.push([cursor, gap.fromUtcMs, "leyendo"]);
          if (gap.cause === "carga-online") pieces0.push([gap.fromUtcMs, gap.toUtcMs, "carga"]);
          // Lo que ese tramo tarda a menudo en ese turno no es un hueco (R-AGV-017).
          else if (gap.kind === "habitual") pieces0.push([gap.fromUtcMs, gap.toUtcMs, "leyendo"]);
          else pieces0.push([gap.fromUtcMs, gap.toUtcMs, "silencio", gap.kind, gap.detail]);
          cursor = Math.max(cursor, gap.toUtcMs);
        }
        if (last > cursor) pieces0.push([cursor, last, "leyendo"]);
        const lastAt = Math.max(cursor, last);
        pieces0.push(edge(lastAt, span.to, edgeDetail("fin", tagAt.get(last) ?? null, null)));
      }
      if (next !== undefined) pieces0.push([span.to, next.from, "sin-datos"]);
    });
    pieces0.push([lastCovered.to, windowTo, "sin-datos"]);
    let pieces = pieces0;

    // 2. La asignación: fuera de ella, la actividad es «sin asignar» y la ausencia es «fuera».
    const assigned =
      input.history === null ? [{ from: windowFrom, to: windowTo }] : mergeIntervals(assignment.get(agvId) ?? []);
    pieces = splitBy(pieces, assigned, (state, inside) =>
      inside ? state : IN_SERVICE.has(state) ? "leyendo-sin-asignar" : "fuera",
    );

    // 3. La cobertura manda sobre todo: fuera de ella no hay datos (R-DAT-007).
    pieces = splitBy(pieces, covered, (state, inside) => (inside ? state : "sin-datos"));

    return {
      agvId,
      assignedEver: input.history === null || assigned.length > 0,
      readings: own?.count ?? 0,
      segments: mergeAdjacent(pieces),
    };
  });

  return {
    historyLoaded: input.history !== null,
    fromUtcMs: windowFrom,
    toUtcMs: windowTo,
    vehicles: vehicles.sort(
      (a, b) => Number(b.assignedEver) - Number(a.assignedEver) || a.agvId.localeCompare(b.agvId),
    ),
    counts: countOverTime(vehicles, covered),
  };
}

/**
 * El recuento N de M, por barrido: cada borde de tramo de cualquier vehículo es un posible cambio,
 * y entre dos bordes seguidos el estado de todos es constante. Un puntero por vehículo avanza a la
 * vez que el barrido, así que el coste es el número total de tramos, no su producto.
 */
function countOverTime(vehicles: readonly FleetVehicle[], coverage: readonly Interval[]): FleetCount[] {
  const borders = new Set<number>();
  for (const vehicle of vehicles) {
    for (const segment of vehicle.segments) {
      borders.add(segment.fromUtcMs);
      borders.add(segment.toUtcMs);
    }
  }
  const sorted = [...borders].sort((a, b) => a - b);
  const pointers = vehicles.map(() => 0);
  const counts: FleetCount[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const from = sorted[index - 1] as number;
    const to = sorted[index] as number;
    const middle = (from + to) / 2;
    if (!coverage.some((span) => middle >= span.from && middle <= span.to)) continue;
    let inService = 0;
    let assigned = 0;
    let unassignedActive = 0;
    vehicles.forEach((vehicle, v) => {
      let pointer = pointers[v] as number;
      while (pointer < vehicle.segments.length && (vehicle.segments[pointer] as FleetSegment).toUtcMs <= middle) pointer += 1;
      pointers[v] = pointer;
      const segment = vehicle.segments[pointer];
      if (segment === undefined || segment.fromUtcMs > middle) return;
      if (ASSIGNED.has(segment.state)) assigned += 1;
      if (IN_SERVICE.has(segment.state)) inService += 1;
      if (segment.state === "leyendo-sin-asignar") unassignedActive += 1;
    });
    const last = counts[counts.length - 1];
    if (
      last !== undefined &&
      last.toUtcMs === from &&
      last.inService === inService &&
      last.assigned === assigned &&
      last.unassignedActive === unassignedActive
    ) {
      counts[counts.length - 1] = { ...last, toUtcMs: to };
    } else {
      counts.push({ fromUtcMs: from, toUtcMs: to, inService, assigned, unassignedActive });
    }
  }
  return counts;
}
