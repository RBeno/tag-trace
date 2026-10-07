/**
 * Cortes wifi de un AGV cruzados con sus lecturas, y el mapa de calor por tag (R-COM-004 a R-COM-008).
 *
 * El informe de conexiones (DS-013) dice **cuándo** un AGV perdió y recuperó la comunicación; las
 * lecturas dicen **dónde** estaba. Cruzarlos sirve para separar tres fallos que en el histórico
 * dejan la misma huella —un tag que no aparece—:
 *
 * - **comunicación**: el AGV leyó y ejecutó el tag, que está en su memoria, pero sin wifi la lectura
 *   no llegó al histórico (R-COM-001, R-COM-004). El hueco cae dentro de un corte.
 * - **lectura**: el hueco no cae en ningún corte y el tag lo leen los demás AGV: apunta al lector
 *   de ese AGV.
 * - **tag**: el hueco no cae en ningún corte y el tag lo saltan varios AGV: apunta al tag.
 * - **sin contraste**: el hueco no cae en ningún corte, pero ningún otro AGV lee ese tag: no hay con
 *   qué comparar, y no se culpa ni al lector ni al tag.
 *
 * Las dos últimas son una lectura de la guía, no una causa (R-EVI-006), y un AGV sin informe de
 * conexiones no se separa: su hueco queda `sin-informe`, nunca se supone comunicación ni lectura.
 *
 * Qué no hace: no decide por qué se cortó el wifi (cobertura, punto de acceso, equipo del AGV), y no
 * dice que una parada precisa proteja un cruce si nadie lo ha declarado (R-COM-006).
 */

import { findDominantCycle } from "./laps.js";
import type { Reading } from "./reading.js";

/** El evento de una fila del informe de conexiones. */
export type ConnectionKind = "conexion" | "desconexion" | "conexion-tras-apagado";

export interface ConnectionEvent {
  readonly utcMs: number;
  /** La fecha tal como venía en el fichero. */
  readonly raw: string;
  readonly kind: ConnectionKind;
  /** El campo `Datos Aux` tal cual: su significado no se conoce (OQ-161). */
  readonly aux: string;
  /** Fila física del fichero, contando la cabecera como fila 1. */
  readonly sourceRow: number;
}

/** La forma que se enseña antes de pedir el fichero. */
export const WIFI_STRUCTURE = {
  header: ["Fecha", "Conexión"],
  optional: ["Datos Aux"],
  kinds: ["Conexión", "Desconexión", "Conexión tras apagado"],
} as const;

/**
 * El AGV que sugiere el nombre del fichero: la última tira de dígitos (`CONEXIONES0123.xlsx` → `0123`,
 * con sus ceros). `null` si no hay ninguna. Es una propuesta: la confirma la persona.
 */
export function agvFromFileName(fileName: string): string | null {
  const base = fileName.replace(/\.[^.]*$/, "");
  const match = /(\d+)\D*$/.exec(base);
  return match === null ? null : (match[1] ?? null);
}

/** Umbrales de la clasificación. Ninguno está aprobado por planta (`CONFIG_SCHEMA.md` §3.10). */
export interface WifiCutThresholds {
  /** Un corte que dura esto o menos es un microcorte. */
  readonly microCutMaxMs: number;
  /** Reaparecer a más saltos de ruta que estos del último tag es reaparecer en otro sitio. */
  readonly farReappearanceHops: number;
  /** Tags seguidos que puede faltar entre dos lecturas para contarse como salto de lectura (R-OPP-014). */
  readonly maxSkippedTags: number;
  /** Pasadas mínimas de un AGV por un tag para dar su tasa de cortes en el mapa. */
  readonly minPassesForRate: number;
  /** Cuántos AGV distintos tienen que saltarse un tag, sin corte, para que apunte al tag y no al lector. */
  readonly minVehiclesForTagFault: number;
  /** Veces lo habitual de los tramos recorridos por encima de las cuales leer durante el corte no es ir en marcha. */
  readonly maxPaceFactor: number;
}

/**
 * Qué pasó en un corte. El orden de la lista es el orden en que se decide.
 *
 * - `sin-cierre`: el informe no trae la reconexión.
 * - `apagado`: la reconexión es «tras apagado»: el AGV se apagó, no es un corte de red.
 * - `microcorte`: dura `microCutMaxMs` o menos.
 * - `fuera-del-recorrido`: no estaba en la guía entre su último tag y el de reaparición, por una de dos
 *   pruebas: reaparece a más de `farReappearanceHops` saltos de ruta, u **otro AGV lo adelantó** —pasó
 *   por su último tag y llegó al de reaparición antes que él (R-AGV-021)—. Por ejemplo, una maniobra
 *   manual o un cambio de batería (OQ-160). No es una espera. Se decide antes que `en-marcha`, porque
 *   la lectura con la que reaparece puede caer dentro del corte.
 * - `en-marcha`: el AGV leyó tags durante el corte al ritmo de la ruta —no más de `maxPaceFactor` veces
 *   lo habitual de esos tramos—: se movía y los ejecutaba (R-COM-004). Si leyó pero mucho más lento, se
 *   juzga como parado.
 * - `espera-servidor`: no leyó, su último tag es una parada precisa declarada y reaparece en la ruta:
 *   esperaba la orden de continuar del servidor (R-COM-005).
 * - `parado`: no leyó y reaparece en la ruta, sin parada precisa declarada: estaba parado, por qué no
 *   se sabe.
 * - `sin-lecturas`: no hay lecturas del AGV antes del corte para situarlo.
 */
export type CutClass =
  | "sin-cierre"
  | "apagado"
  | "microcorte"
  | "en-marcha"
  | "fuera-del-recorrido"
  | "espera-servidor"
  | "parado"
  | "sin-lecturas";

export interface WifiCut {
  readonly agvId: string;
  readonly startUtcMs: number;
  readonly startRaw: string;
  /** `null` si el informe no trae la reconexión. */
  readonly endUtcMs: number | null;
  readonly durationMs: number | null;
  readonly reconnection: ConnectionKind | null;
  /** El último tag que leyó antes del corte: dónde empieza. */
  readonly lastTagId: string | null;
  readonly msSinceLastRead: number | null;
  /** El primer tag que leyó después de empezar el corte. */
  readonly nextTagId: string | null;
  /** Lecturas suyas dentro del corte. */
  readonly readsDuring: number;
  /** Saltos de ruta del último tag al de reaparición; `null` si no se pueden contar. */
  readonly hops: number | null;
  /** Otros AGV que pasaron por su último tag y llegaron al de reaparición antes que él. */
  readonly overtakenBy: readonly string[];
  /**
   * En una espera al servidor, el primer cruce declarado que el recorrido alcanza antes de la siguiente
   * parada precisa, y a cuántos tags: el cruce que un temporizador le haría ocupar (R-COM-006).
   */
  readonly crossingAhead: { readonly tagId: string; readonly hops: number } | null;
  readonly cutClass: CutClass;
  readonly aux: string;
  readonly sourceRow: number;
  /** La frase que se enseña con el corte. */
  readonly evidence: string;
}

/** Por qué no aparece un tag entre dos lecturas seguidas de un AGV. */
export type SkipCause = "comunicacion" | "lectura" | "tag" | "sin-contraste" | "sin-informe";

export interface ReadSkip {
  readonly agvId: string;
  readonly tagId: string;
  readonly prevTagId: string;
  readonly nextTagId: string;
  readonly prevUtcMs: number;
  readonly nextUtcMs: number;
  readonly cause: SkipCause;
}

export interface HeatRow {
  readonly tagId: string;
  /** Posición en el anillo dominante; `null` si el tag está fuera de él. */
  readonly position: number | null;
  /** Si es un cruce declarado. */
  readonly crossing: boolean;
  /** Cortes que empezaron con este tag como último leído, por AGV. */
  readonly cutsByAgv: ReadonlyMap<string, number>;
  /** Pasadas (lecturas) de cada AGV con informe, dentro del periodo de su informe. */
  readonly passesByAgv: ReadonlyMap<string, number>;
  readonly cuts: number;
  /** Cortes por cada 100 pasadas de los AGV con informe; `null` sin pasadas suficientes. */
  readonly cutsPer100: number | null;
  readonly vehiclesWithCuts: number;
  /** Cortes de cada clase. */
  readonly byClass: ReadonlyMap<CutClass, number>;
  /** Huecos de este tag, por causa. */
  readonly skips: ReadonlyMap<SkipCause, number>;
  /** AGV distintos que se lo saltaron sin corte. */
  readonly vehiclesSkippingWithoutCut: number;
}

export interface WifiHeatmap {
  readonly cuts: readonly WifiCut[];
  readonly skips: readonly ReadSkip[];
  /** Una fila por tag con algún corte, pasada o hueco, en el orden de la ruta. */
  readonly rows: readonly HeatRow[];
  /** Los AGV con informe de conexiones, ordenados. */
  readonly agvsWithReport: readonly string[];
  /** Avisos que cambian la lectura del mapa. */
  readonly warnings: readonly string[];
}

export interface WifiHeatmapInput {
  /** Todas las lecturas del circuito: dan la ruta y los saltos de los demás AGV. */
  readonly readings: readonly Reading[];
  /** El informe de conexiones de cada AGV que lo tiene. */
  readonly connections: ReadonlyMap<string, readonly ConnectionEvent[]>;
  /** Las paradas precisas declaradas (lista `critico` o columna `funcion`). Vacío si no hay. */
  readonly preciseStops: ReadonlySet<string>;
  /**
   * Los tags de cruce declarados en el circuito (función `cruce` o tramo «cruce»; propietario,
   * 2026-10-07: «los cruces están descritos en el circuito»). Vacío si no hay.
   */
  readonly crossings?: ReadonlySet<string>;
  /**
   * Si un instante cae en la noche (`regimes` de la configuración). Opcional: sin él, un corte fuera
   * del recorrido no dice si fue de noche.
   */
  readonly isNight?: (utcMs: number) => boolean;
  readonly thresholds: WifiCutThresholds;
}

const CLASS_ORDER: readonly CutClass[] = [
  "sin-cierre",
  "apagado",
  "microcorte",
  "fuera-del-recorrido",
  "en-marcha",
  "espera-servidor",
  "parado",
  "sin-lecturas",
];

export const CUT_CLASS_LABEL: Readonly<Record<CutClass, string>> = {
  "sin-cierre": "sin reconexión en el informe",
  apagado: "apagado",
  microcorte: "microcorte",
  "en-marcha": "en marcha",
  "fuera-del-recorrido": "fuera del recorrido",
  "espera-servidor": "espera al servidor",
  parado: "parado",
  "sin-lecturas": "sin lecturas",
};

export const SKIP_CAUSE_LABEL: Readonly<Record<SkipCause, string>> = {
  comunicacion: "comunicación",
  lectura: "lectura",
  tag: "tag",
  "sin-contraste": "sin contraste",
  "sin-informe": "sin informe",
};

/** Las lecturas de cada AGV en orden de tiempo; a igual instante manda la fila del fichero. */
function readingsByAgv(readings: readonly Reading[]): ReadonlyMap<string, readonly Reading[]> {
  const byAgv = new Map<string, Reading[]>();
  for (const reading of readings) {
    let list = byAgv.get(reading.agvId);
    if (list === undefined) {
      list = [];
      byAgv.set(reading.agvId, list);
    }
    list.push(reading);
  }
  for (const list of byAgv.values()) {
    list.sort((a, b) => a.time.utcMs - b.time.utcMs || a.provenance.sourceRow - b.provenance.sourceRow);
  }
  return byAgv;
}

/** La ruta: el anillo dominante para las posiciones y el sucesor dominante para contar saltos. */
interface Route {
  readonly position: ReadonlyMap<string, number>;
  readonly next: ReadonlyMap<string, string>;
  /** Mediana de lo que tarda la flota en ir de un tag a su sucesor dominante, en ms. */
  readonly usualMs: ReadonlyMap<string, number>;
  /** Cuota del sucesor `to` entre las salidas de `from`. */
  share(from: string, to: string): number;
}

function transitionsOf(lists: Iterable<readonly Reading[]>): { from: string; to: string }[] {
  const transitions: { from: string; to: string }[] = [];
  for (const list of lists) {
    for (let i = 1; i < list.length; i += 1) {
      const from = (list[i - 1] as Reading).tagId;
      const to = (list[i] as Reading).tagId;
      if (from !== to) transitions.push({ from, to });
    }
  }
  return transitions;
}

/**
 * El sucesor dominante sale de toda la flota; las posiciones, del anillo de los AGV **con informe**,
 * y de toda la flota solo si ellos no forman uno. Una exportación puede mezclar recorridos, y el
 * anillo de la mayoría no tiene por qué ser el de los AGV que se miran.
 */
function buildRoute(byAgv: ReadonlyMap<string, readonly Reading[]>, reporting: readonly string[]): Route {
  const transitions: { from: string; to: string }[] = [];
  for (const list of byAgv.values()) {
    for (let i = 1; i < list.length; i += 1) {
      const from = (list[i - 1] as Reading).tagId;
      const to = (list[i] as Reading).tagId;
      if (from !== to) transitions.push({ from, to });
    }
  }
  const counts = new Map<string, Map<string, number>>();
  for (const { from, to } of transitions) {
    let out = counts.get(from);
    if (out === undefined) {
      out = new Map<string, number>();
      counts.set(from, out);
    }
    out.set(to, (out.get(to) ?? 0) + 1);
  }
  const elapsed = new Map<string, number[]>();
  for (const list of byAgv.values()) {
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1] as Reading;
      const b = list[i] as Reading;
      if (a.tagId === b.tagId) continue;
      const key = `${a.tagId}\u0000${b.tagId}`;
      let values = elapsed.get(key);
      if (values === undefined) {
        values = [];
        elapsed.set(key, values);
      }
      values.push(b.time.utcMs - a.time.utcMs);
    }
  }
  const next = new Map<string, string>();
  for (const [from, out] of counts) {
    let best = "";
    let bestCount = -1;
    for (const [to, count] of out) {
      if (count > bestCount || (count === bestCount && to < best)) {
        best = to;
        bestCount = count;
      }
    }
    next.set(from, best);
  }
  const usualMs = new Map<string, number>();
  for (const [from, to] of next) {
    const values = [...(elapsed.get(`${from}\u0000${to}`) ?? [])].sort((a, b) => a - b);
    if (values.length > 0) usualMs.set(from, values[Math.floor(values.length / 2)] as number);
  }
  const own = transitionsOf(reporting.map((agvId) => byAgv.get(agvId) ?? []));
  const cycle = findDominantCycle(own)?.cycle ?? findDominantCycle(transitions)?.cycle ?? [];
  const position = new Map(cycle.map((tag, index) => [tag, index]));
  return {
    position,
    next,
    usualMs,
    share(from, to) {
      const out = counts.get(from);
      if (out === undefined) return 0;
      let total = 0;
      for (const count of out.values()) total += count;
      return total === 0 ? 0 : (out.get(to) ?? 0) / total;
    },
  };
}

/** Saltos siguiendo el sucesor dominante desde `from` hasta `to`, sin pasar de `limit`; `null` si no llega. */
function hopsBetween(route: Route, from: string, to: string, limit: number): number | null {
  if (from === to) return 0;
  let current = from;
  for (let hop = 1; hop <= limit; hop += 1) {
    const step = route.next.get(current);
    if (step === undefined) return null;
    if (step === to) return hop;
    current = step;
  }
  return null;
}

/** Los tags del camino dominante estrictamente entre `from` y `to`. */
function tagsBetween(route: Route, from: string, hops: number): readonly string[] {
  const between: string[] = [];
  let current = from;
  for (let hop = 1; hop < hops; hop += 1) {
    const step = route.next.get(current);
    if (step === undefined) break;
    between.push(step);
    current = step;
  }
  return between;
}

/**
 * Los cortes de un informe como intervalos `[inicio, fin]`; un corte sin reconexión llega hasta el
 * infinito. Para quien solo necesita saber si un instante cayó sin wifi (R-AGV-023).
 */
export function cutWindows(events: readonly ConnectionEvent[]): readonly (readonly [number, number])[] {
  return pairCuts(events).map(({ start, end }) => [start.utcMs, end?.utcMs ?? Number.POSITIVE_INFINITY] as const);
}

/** Empareja cada desconexión con la conexión que la cierra. */
function pairCuts(events: readonly ConnectionEvent[]): readonly {
  readonly start: ConnectionEvent;
  readonly end: ConnectionEvent | null;
}[] {
  // A igual instante, la desconexión va antes: una reconexión en el mismo segundo la cierra.
  const sorted = [...events].sort(
    (a, b) => a.utcMs - b.utcMs || Number(b.kind === "desconexion") - Number(a.kind === "desconexion"),
  );
  const pairs: { start: ConnectionEvent; end: ConnectionEvent | null }[] = [];
  let open: ConnectionEvent | null = null;
  for (const event of sorted) {
    if (event.kind === "desconexion") {
      if (open !== null) pairs.push({ start: open, end: null });
      open = event;
    } else if (open !== null) {
      pairs.push({ start: open, end: event });
      open = null;
    }
  }
  if (open !== null) pairs.push({ start: open, end: null });
  return pairs;
}

/** Última lectura con instante ≤ `utcMs`: índice en la lista, o -1. */
function lastAtOrBefore(list: readonly Reading[], utcMs: number): number {
  let low = 0;
  let high = list.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((list[middle] as Reading).time.utcMs <= utcMs) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function seconds(ms: number): string {
  return ms < 120_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`;
}

/** Lo habitual de recorrer `hops` tramos dominantes desde `from`; `null` si falta alguno. */
function usualAlong(route: Route, from: string, hops: number): number | null {
  let total = 0;
  let current = from;
  for (let hop = 0; hop < hops; hop += 1) {
    const usual = route.usualMs.get(current);
    const step = route.next.get(current);
    if (usual === undefined || step === undefined) return null;
    total += usual;
    current = step;
  }
  return total;
}

/**
 * Los AGV que pasaron por `fromTag` después de `afterMs` y leyeron `toTag` antes de `beforeMs`: lo
 * adelantaron, así que entre esos dos tags él no ocupaba la guía (R-AGV-021).
 */
function overtakers(
  byAgv: ReadonlyMap<string, readonly Reading[]>,
  agvId: string,
  fromTag: string,
  toTag: string,
  afterMs: number,
  beforeMs: number,
): readonly string[] {
  const found: string[] = [];
  for (const [other, list] of byAgv) {
    if (other === agvId) continue;
    let passed = false;
    for (let i = lastAtOrBefore(list, afterMs) + 1; i < list.length; i += 1) {
      const reading = list[i] as Reading;
      if (reading.time.utcMs >= beforeMs) break;
      if (reading.tagId === fromTag) passed = true;
      else if (passed && reading.tagId === toTag) {
        found.push(other);
        break;
      }
    }
  }
  return found.sort();
}

/**
 * El primer cruce declarado siguiendo el sucesor dominante desde una parada precisa, sin pasar de la
 * siguiente parada precisa: un cruce más allá lo protege esa otra. `null` si no hay ninguno.
 */
function crossingAheadOf(
  route: Route,
  from: string,
  preciseStops: ReadonlySet<string>,
  crossings: ReadonlySet<string>,
): { readonly tagId: string; readonly hops: number } | null {
  if (crossings.size === 0) return null;
  const seen = new Set<string>([from]);
  let current = from;
  for (let hop = 1; hop <= route.next.size; hop += 1) {
    const step = route.next.get(current);
    if (step === undefined || seen.has(step)) return null;
    if (crossings.has(step)) return { tagId: step, hops: hop };
    if (preciseStops.has(step)) return null;
    seen.add(step);
    current = step;
  }
  return null;
}

function classify(
  agvId: string,
  start: ConnectionEvent,
  end: ConnectionEvent | null,
  byAgv: ReadonlyMap<string, readonly Reading[]>,
  route: Route,
  input: WifiHeatmapInput,
): WifiCut {
  const { thresholds, preciseStops } = input;
  const list = byAgv.get(agvId) ?? [];
  const before = lastAtOrBefore(list, start.utcMs);
  const last = before >= 0 ? (list[before] as Reading) : null;
  const following = list[before + 1] ?? null;
  const endUtcMs = end?.utcMs ?? null;
  const durationMs = endUtcMs === null ? null : endUtcMs - start.utcMs;
  let readsDuring = 0;
  if (endUtcMs !== null) {
    for (let i = before + 1; i < list.length && (list[i] as Reading).time.utcMs <= endUtcMs; i += 1) readsDuring += 1;
  }
  const hops =
    last !== null && following !== null
      ? hopsBetween(route, last.tagId, following.tagId, thresholds.farReappearanceHops)
      : null;
  const overtakenBy =
    last !== null && following !== null && last.tagId !== following.tagId
      ? overtakers(byAgv, agvId, last.tagId, following.tagId, last.time.utcMs, following.time.utcMs)
      : [];
  // Leer durante el corte solo es ir en marcha si se hizo al ritmo de la ruta.
  const usual = last !== null && hops !== null && hops > 0 ? usualAlong(route, last.tagId, hops) : null;
  const elapsed = last !== null && following !== null ? following.time.utcMs - last.time.utcMs : null;
  const atPace =
    usual !== null && elapsed !== null && elapsed <= thresholds.maxPaceFactor * usual + thresholds.microCutMaxMs;

  let cutClass: CutClass;
  let evidence: string;
  let crossingAhead: { readonly tagId: string; readonly hops: number } | null = null;
  const crossings = input.crossings ?? new Set<string>();
  // Por qué sale un AGV del recorrido lo sabe planta, no el dato (OQ-160, propietario 2026-10-07): se
  // enumera, y de noche se añade la retirada por menor producción, que solo es posible entonces.
  const atNight = input.isNight?.(start.utcMs) ?? false;
  const outsideCauses =
    "Puede ser una avería, un cambio de batería o un carro en mal estado" +
    (atNight ? ", o una retirada de noche por menor producción: empezó de noche." : ".");
  const lasted = seconds(durationMs ?? 0);
  const where = last === null ? "" : ` Último tag ${last.tagId}${following === null ? "" : `, reaparece en ${following.tagId}`}.`;
  if (end === null) {
    cutClass = "sin-cierre";
    evidence = "El informe no trae la reconexión: no se sabe cuánto duró." + where;
  } else if (end.kind === "conexion-tras-apagado") {
    cutClass = "apagado";
    evidence = `Se reconecta tras apagarse, ${lasted} después: no es un corte de red.` + where;
  } else if (last === null) {
    cutClass = "sin-lecturas";
    evidence = "No hay lecturas suyas antes del corte para situarlo.";
  } else if ((durationMs ?? 0) <= thresholds.microCutMaxMs) {
    cutClass = "microcorte";
    evidence = `Corte de ${lasted}.` + where;
  } else if (following !== null && hops === null) {
    // Antes que «en marcha»: la lectura con la que reaparece puede caer justo antes de la reconexión,
    // y esa lectura no es moverse por la ruta sino volver a ella.
    cutClass = "fuera-del-recorrido";
    evidence =
      `Durante ${lasted} sin wifi no siguió la ruta: reaparece a más de ${thresholds.farReappearanceHops} ` +
      "tags del último leído. Salió del recorrido, no esperaba. " + outsideCauses + where;
  } else if (overtakenBy.length > 0) {
    cutClass = "fuera-del-recorrido";
    evidence =
      `Durante ${lasted} sin wifi, ${overtakenBy.length} ${overtakenBy.length === 1 ? "AGV pasó" : "AGV pasaron"} por su último tag y ` +
      "llegaron antes que él al de reaparición: no ocupaba la guía. Salió del recorrido, no esperaba. " +
      outsideCauses +
      where;
  } else if (readsDuring > 0 && atPace) {
    cutClass = "en-marcha";
    evidence =
      `Leyó ${readsDuring} tag${readsDuring === 1 ? "" : "s"} durante ${lasted} sin wifi, al ritmo de la ruta: ` +
      "se movía y los ejecutaba desde su memoria." + where;
  } else if (preciseStops.has(last.tagId)) {
    cutClass = "espera-servidor";
    crossingAhead = crossingAheadOf(route, last.tagId, preciseStops, crossings);
    const crossingText =
      crossingAhead !== null
        ? `Antes de la siguiente parada precisa el recorrido pasa por el cruce declarado ${crossingAhead.tagId}, ` +
          `a ${crossingAhead.hops} ${crossingAhead.hops === 1 ? "tag" : "tags"}: un temporizador que lo hiciera ` +
          "continuar sin wifi podría ocuparlo."
        : crossings.size > 0
          ? "Hasta la siguiente parada precisa no pasa por ningún cruce declarado."
          : "Sin cruces declarados en el circuito no se sabe si esta parada protege uno.";
    evidence =
      `Su último tag es una parada precisa y no siguió durante ${lasted} sin wifi: ` +
      `esperaba la orden de continuar del servidor. ${crossingText}` + where;
  } else {
    cutClass = "parado";
    evidence =
      `No siguió la ruta durante ${lasted} y reaparece en ella sin que nadie lo adelantara: estaba parado. ` +
      (preciseStops.size === 0 ? "Sin paradas precisas declaradas no se sabe si esperaba al servidor." : "No es una parada precisa declarada.") +
      where;
  }

  return {
    agvId,
    startUtcMs: start.utcMs,
    startRaw: start.raw,
    endUtcMs,
    durationMs,
    reconnection: end?.kind ?? null,
    lastTagId: last?.tagId ?? null,
    msSinceLastRead: last === null ? null : start.utcMs - last.time.utcMs,
    nextTagId: following?.tagId ?? null,
    readsDuring,
    hops,
    overtakenBy,
    crossingAhead,
    cutClass,
    aux: end?.aux ?? start.aux,
    sourceRow: start.sourceRow,
    evidence,
  };
}

/** Los cortes de un AGV como intervalos; un corte sin cierre llega hasta su última lectura conocida. */
function cutIntervals(cuts: readonly WifiCut[]): readonly (readonly [number, number])[] {
  return cuts.map((cut) => [cut.startUtcMs, cut.endUtcMs ?? Number.POSITIVE_INFINITY] as const);
}

function overlaps(intervals: readonly (readonly [number, number])[], from: number, to: number): boolean {
  return intervals.some(([start, end]) => start <= to && end >= from);
}

/**
 * Cruza los informes de conexiones con las lecturas y arma el mapa de calor.
 *
 * Determinista: misma entrada y umbrales, mismo resultado y mismo orden.
 */
export function buildWifiHeatmap(input: WifiHeatmapInput): WifiHeatmap {
  const { thresholds } = input;
  const byAgv = readingsByAgv(input.readings);
  const agvsWithReport = [...input.connections.keys()].sort();
  const route = buildRoute(byAgv, agvsWithReport);
  const warnings: string[] = [];

  if (route.position.size === 0) {
    warnings.push("Las lecturas no forman un anillo dominante: los tags se ordenan por número, no por ruta.");
  }
  if (input.preciseStops.size === 0) {
    warnings.push(
      "No hay paradas precisas declaradas: un AGV parado sin wifi sale como «parado», sin poder decir si esperaba al servidor.",
    );
  }

  const cuts: WifiCut[] = [];
  const periodOf = new Map<string, readonly [number, number]>();
  for (const agvId of agvsWithReport) {
    const events = input.connections.get(agvId) ?? [];
    const list = byAgv.get(agvId) ?? [];
    if (list.length === 0) warnings.push(`El AGV ${agvId} tiene informe de conexiones pero ninguna lectura en este circuito.`);
    if (events.length > 0) {
      // El periodo del informe empieza en la lectura que precede a su primer evento: un informe que
      // abre con un corte sitúa ese corte en la pasada que lo precede, y esa pasada cuenta.
      const times = events.map((event) => event.utcMs);
      const first = Math.min(...times);
      const before = lastAtOrBefore(list, first);
      periodOf.set(agvId, [before >= 0 ? (list[before] as Reading).time.utcMs : first, Math.max(...times)]);
    }
    for (const { start, end } of pairCuts(events)) cuts.push(classify(agvId, start, end, byAgv, route, input));
  }
  cuts.sort((a, b) => a.startUtcMs - b.startUtcMs || a.agvId.localeCompare(b.agvId));

  const intervalsOf = new Map<string, readonly (readonly [number, number])[]>();
  for (const agvId of agvsWithReport) intervalsOf.set(agvId, cutIntervals(cuts.filter((cut) => cut.agvId === agvId)));

  // Huecos de lectura: entre dos lecturas seguidas cuyo paso no es habitual y que el camino dominante
  // une saltándose pocos tags. A igual instante no se cuenta: el reloj no ordena las dos lecturas.
  const rawSkips: Omit<ReadSkip, "cause">[] = [];
  for (const agvId of [...byAgv.keys()].sort()) {
    const list = byAgv.get(agvId) ?? [];
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1] as Reading;
      const next = list[i] as Reading;
      if (prev.tagId === next.tagId || next.time.utcMs <= prev.time.utcMs) continue;
      if (route.share(prev.tagId, next.tagId) >= 0.1) continue;
      const hops = hopsBetween(route, prev.tagId, next.tagId, thresholds.maxSkippedTags + 1);
      if (hops === null || hops < 2) continue;
      for (const tagId of tagsBetween(route, prev.tagId, hops)) {
        rawSkips.push({
          agvId,
          tagId,
          prevTagId: prev.tagId,
          nextTagId: next.tagId,
          prevUtcMs: prev.time.utcMs,
          nextUtcMs: next.time.utcMs,
        });
      }
    }
  }

  const readersOf = new Map<string, Set<string>>();
  for (const [agvId, list] of byAgv) {
    for (const reading of list) {
      let set = readersOf.get(reading.tagId);
      if (set === undefined) {
        set = new Set<string>();
        readersOf.set(reading.tagId, set);
      }
      set.add(agvId);
    }
  }

  // Sin corte, un tag que se saltan varios AGV apunta al tag; si solo uno y otros lo leen, a su lector.
  const vehiclesWithoutCut = new Map<string, Set<string>>();
  const withoutCut = (skip: Omit<ReadSkip, "cause">): boolean => {
    const intervals = intervalsOf.get(skip.agvId);
    return intervals !== undefined && !overlaps(intervals, skip.prevUtcMs, skip.nextUtcMs);
  };
  for (const skip of rawSkips) {
    if (!withoutCut(skip)) continue;
    let set = vehiclesWithoutCut.get(skip.tagId);
    if (set === undefined) {
      set = new Set<string>();
      vehiclesWithoutCut.set(skip.tagId, set);
    }
    set.add(skip.agvId);
  }
  // Los AGV sin informe también cuentan para decir que el tag falla a varios: su hueco puede ser
  // comunicación, pero si lo saltan muchos con informe el patrón ya lo da el tag.
  const skips: ReadSkip[] = rawSkips.map((skip) => {
    const intervals = intervalsOf.get(skip.agvId);
    let cause: SkipCause;
    if (intervals === undefined) cause = "sin-informe";
    else if (overlaps(intervals, skip.prevUtcMs, skip.nextUtcMs)) cause = "comunicacion";
    else if ((vehiclesWithoutCut.get(skip.tagId)?.size ?? 0) >= thresholds.minVehiclesForTagFault) cause = "tag";
    // Culpar al lector exige que otro AGV sí lea el tag; si nadie más lo lee, no hay con qué contrastar.
    else cause = (readersOf.get(skip.tagId)?.size ?? 0) > ((readersOf.get(skip.tagId)?.has(skip.agvId) ?? false) ? 1 : 0) ? "lectura" : "sin-contraste";
    return { ...skip, cause };
  });

  // Filas del mapa.
  const rowsByTag = new Map<
    string,
    { cutsByAgv: Map<string, number>; passesByAgv: Map<string, number>; byClass: Map<CutClass, number>; skips: Map<SkipCause, number> }
  >();
  const rowOf = (tagId: string) => {
    let row = rowsByTag.get(tagId);
    if (row === undefined) {
      row = { cutsByAgv: new Map(), passesByAgv: new Map(), byClass: new Map(), skips: new Map() };
      rowsByTag.set(tagId, row);
    }
    return row;
  };
  for (const agvId of agvsWithReport) {
    const period = periodOf.get(agvId);
    if (period === undefined) continue;
    for (const reading of byAgv.get(agvId) ?? []) {
      if (reading.time.utcMs < period[0] || reading.time.utcMs > period[1]) continue;
      const row = rowOf(reading.tagId);
      row.passesByAgv.set(agvId, (row.passesByAgv.get(agvId) ?? 0) + 1);
    }
  }
  for (const cut of cuts) {
    if (cut.lastTagId === null) continue;
    const row = rowOf(cut.lastTagId);
    row.cutsByAgv.set(cut.agvId, (row.cutsByAgv.get(cut.agvId) ?? 0) + 1);
    row.byClass.set(cut.cutClass, (row.byClass.get(cut.cutClass) ?? 0) + 1);
  }
  for (const skip of skips) {
    const row = rowOf(skip.tagId);
    row.skips.set(skip.cause, (row.skips.get(skip.cause) ?? 0) + 1);
  }

  const rows: HeatRow[] = [...rowsByTag.entries()].map(([tagId, row]) => {
    let cutsTotal = 0;
    for (const count of row.cutsByAgv.values()) cutsTotal += count;
    let passes = 0;
    for (const count of row.passesByAgv.values()) passes += count;
    const byClass = new Map<CutClass, number>();
    for (const cls of CLASS_ORDER) {
      const count = row.byClass.get(cls);
      if (count !== undefined) byClass.set(cls, count);
    }
    return {
      tagId,
      position: route.position.get(tagId) ?? null,
      crossing: input.crossings?.has(tagId) ?? false,
      cutsByAgv: row.cutsByAgv,
      passesByAgv: row.passesByAgv,
      cuts: cutsTotal,
      cutsPer100: passes >= thresholds.minPassesForRate ? (100 * cutsTotal) / passes : null,
      vehiclesWithCuts: row.cutsByAgv.size,
      byClass,
      skips: row.skips,
      vehiclesSkippingWithoutCut: vehiclesWithoutCut.get(tagId)?.size ?? 0,
    };
  });
  rows.sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return a.tagId.localeCompare(b.tagId, "es", { numeric: true });
  });

  return { cuts, skips, rows, agvsWithReport, warnings };
}
