/**
 * La acción de cada tag según las lecturas de un AGV con acciones (DS-014), y lo que hay que verificar
 * (R-AGV-023, R-AGV-024).
 *
 * El informe de lecturas con acciones dice, para cada lectura de un AGV, qué ordenó el tag
 * («Continuar / Continuar, Pin Abajo, Seguir recto, Mapa Aproximación, vel 20 m/min»), con qué MTC
 * iba el AGV y dos marcas: «No en memoria» y «No ejecutado». De ahí salen dos cosas:
 *
 * - **El catálogo por tag y MTC**: la acción que cada tag ordena, observada. La acción de un tag puede
 *   cambiar con el MTC (R-DAT-004, R-OPP-007), así que la clave es el par. No sustituye a la función
 *   declarada en las listas (R-GRA-007): es lo que el vehículo registró.
 * - **Los avisos para verificar**: cada tag con lecturas «No ejecutado» y cada lectura «No en memoria»
 *   (propietario, 2026-10-07: «se notifica para su verificación»). Un «No ejecutado» puede ser un tag
 *   condicional —se ejecuta sin wifi, o con un MTC concreto—, así que se contrasta con los cortes wifi
 *   del mismo AGV y con el MTC de cada lectura, y lo que se ve se dice como patrón, nunca como causa.
 *
 * Qué no hace todavía: la consecuencia de no leer un tag (R-AGV-022). El propietario pidió no
 * incorporarla aún.
 */

/** Una lectura del informe de un AGV con acciones. */
export interface ActionReading {
  readonly utcMs: number;
  /** La fecha tal como venía en el fichero. */
  readonly raw: string;
  /** Texto, con sus ceros (R-DAT-001). */
  readonly tagId: string;
  /** El MTC de la lectura: cadena vacía es el modo normal; si no, el número tal cual («1», «10»…). */
  readonly mtc: string;
  /** La acción tal como la escribe el informe. */
  readonly action: string;
  readonly notInMemory: boolean;
  readonly notExecuted: boolean;
  /** Fila física del fichero, contando la cabecera como fila 1. */
  readonly sourceRow: number;
}

/** La acción descompuesta en sus partes. Lo que no se reconoce se conserva en `other`. */
export interface ParsedAction {
  /** La orden: «Continuar», «Parada temporizada precisa», «Cambio nº modo circuito»… */
  readonly kind: string;
  readonly pin: string | null;
  /** «Seguir recto», «Giro izquierda», «Giro derecha». */
  readonly turn: string | null;
  readonly map: string | null;
  readonly speedMPerMin: number | null;
  readonly waitS: number | null;
  readonly beacon: string | null;
  readonly other: readonly string[];
}

export function parseAction(text: string): ParsedAction {
  const [head = "", rest = ""] = text.split(" / ", 2).map((part) => part.trim());
  const parts = rest.split(",").map((part) => part.trim()).filter((part) => part !== "");
  // La primera parte del detalle repite la orden.
  if (parts[0] === head) parts.shift();
  let pin: string | null = null;
  let turn: string | null = null;
  let map: string | null = null;
  let speedMPerMin: number | null = null;
  let waitS: number | null = null;
  let beacon: string | null = null;
  const other: string[] = [];
  for (const part of parts) {
    if (/^pin\s/i.test(part)) pin = part.replace(/^pin\s+/i, "");
    else if (/^mapa\s/i.test(part)) map = part.replace(/^mapa\s+/i, "");
    else if (/^vel\s/i.test(part)) speedMPerMin = Number(/(\d+(?:[.,]\d+)?)/.exec(part)?.[1]?.replace(",", ".") ?? Number.NaN);
    else if (/^temporizaci/i.test(part)) waitS = Number(/(\d+(?:[.,]\d+)?)/.exec(part)?.[1]?.replace(",", ".") ?? Number.NaN);
    else if (/^baliza\s/i.test(part)) beacon = part.replace(/^baliza\s+/i, "");
    else if (/^(seguir recto|giro izquierda|giro derecha)$/i.test(part)) turn = part;
    else other.push(part);
  }
  return {
    kind: head,
    pin,
    turn,
    map,
    speedMPerMin: speedMPerMin !== null && Number.isFinite(speedMPerMin) ? speedMPerMin : null,
    waitS: waitS !== null && Number.isFinite(waitS) ? waitS : null,
    beacon,
    other,
  };
}

export interface CatalogEntry {
  readonly tagId: string;
  /** Cadena vacía: modo normal. */
  readonly mtc: string;
  readonly reads: number;
  readonly agvs: readonly string[];
  /** La acción más leída para este par, descompuesta, y su texto. */
  readonly action: string;
  readonly parsed: ParsedAction;
  /** Otras acciones leídas para el mismo par, con cuántas veces: el tag no siempre dijo lo mismo. */
  readonly variants: readonly { readonly action: string; readonly reads: number }[];
  readonly notExecuted: number;
  readonly notInMemory: number;
}

/** Qué se ve en las lecturas de un tag «No ejecutado». Es un patrón, no una causa (R-EVI-006). */
export type NotExecutedPattern =
  /** No se ejecutó en ninguna lectura. */
  | "nunca"
  /** Se ejecutó solo dentro de cortes wifi y no fuera: se comporta como un tag de control wifi. */
  | "solo-sin-wifi"
  /** Se ejecutó solo con unos MTC y no con otros. */
  | "segun-mtc"
  /** Ni lo uno ni lo otro. */
  | "sin-patron";

export interface NotExecutedNotice {
  readonly tagId: string;
  readonly reads: number;
  readonly notExecuted: number;
  readonly agvs: readonly string[];
  /** Por MTC (cadena vacía, normal): lecturas y cuántas no ejecutadas. */
  readonly byMtc: readonly { readonly mtc: string; readonly reads: number; readonly notExecuted: number }[];
  /**
   * Contraste con los cortes wifi de los AGV que tienen informe de conexiones: lecturas ejecutadas y
   * no ejecutadas dentro y fuera de un corte. `null` si ningún AGV de estas lecturas tiene informe.
   */
  readonly wifi: {
    readonly executedInCut: number;
    readonly executedOutside: number;
    readonly notExecutedInCut: number;
    readonly notExecutedOutside: number;
  } | null;
  readonly pattern: NotExecutedPattern;
  readonly evidence: string;
}

export interface NotInMemoryNotice {
  readonly tagId: string;
  readonly reads: readonly { readonly agvId: string; readonly utcMs: number; readonly raw: string; readonly mtc: string }[];
  readonly evidence: string;
}

export interface TagActionsReport {
  readonly agvs: readonly string[];
  readonly catalog: readonly CatalogEntry[];
  readonly notExecuted: readonly NotExecutedNotice[];
  readonly notInMemory: readonly NotInMemoryNotice[];
}

export interface TagActionsInput {
  readonly readingsByAgv: ReadonlyMap<string, readonly ActionReading[]>;
  /** Los cortes wifi de cada AGV con informe de conexiones (`cutWindows`). */
  readonly cutsByAgv: ReadonlyMap<string, readonly (readonly [number, number])[]>;
}

const byTag = (a: string, b: string): number => a.localeCompare(b, "es", { numeric: true });
const mtcLabel = (mtc: string): string => (mtc === "" ? "normal" : `MTC ${mtc}`);

function inCut(cuts: readonly (readonly [number, number])[] | undefined, utcMs: number): boolean {
  return cuts !== undefined && cuts.some(([from, to]) => utcMs >= from && utcMs <= to);
}

function describeNotExecuted(
  notice: Omit<NotExecutedNotice, "pattern" | "evidence">,
): { readonly pattern: NotExecutedPattern; readonly evidence: string } {
  const executed = notice.reads - notice.notExecuted;
  const head = `${notice.notExecuted} de ${notice.reads} lecturas «No ejecutado».`;
  const wifi = notice.wifi;
  if (executed === 0) {
    const wifiText =
      wifi === null
        ? "Sin informe de conexiones de esos AGV no se puede comprobar si se ejecutaría sin wifi."
        : wifi.notExecutedInCut === 0
          ? "Ninguna lectura cayó sin wifi: no se puede comprobar si se ejecutaría sin wifi."
          : `Tampoco se ejecutó en ${wifi.notExecutedInCut} ${wifi.notExecutedInCut === 1 ? "lectura" : "lecturas"} sin wifi.`;
    return { pattern: "nunca", evidence: `${head} No se ejecutó nunca. ${wifiText} Puede ser un tag condicional: verificar.` };
  }
  if (wifi !== null && wifi.executedInCut > 0 && wifi.executedOutside === 0 && wifi.notExecutedInCut === 0) {
    return {
      pattern: "solo-sin-wifi",
      evidence: `${head} Se ejecutó solo sin wifi (${wifi.executedInCut} ${wifi.executedInCut === 1 ? "vez" : "veces"} dentro de un corte, ninguna fuera): se comporta como un tag de control wifi. Verificar.`,
    };
  }
  const executedIn = notice.byMtc.filter((entry) => entry.notExecuted < entry.reads).map((entry) => entry.mtc);
  const notIn = notice.byMtc.filter((entry) => entry.notExecuted > 0).map((entry) => entry.mtc);
  const overlap = executedIn.some((mtc) => notIn.includes(mtc));
  if (!overlap && executedIn.length > 0 && notIn.length > 0) {
    return {
      pattern: "segun-mtc",
      evidence: `${head} Se ejecutó con ${executedIn.map(mtcLabel).join(", ")} y no con ${notIn.map(mtcLabel).join(", ")}: depende del MTC. Verificar.`,
    };
  }
  return { pattern: "sin-patron", evidence: `${head} Ni el wifi ni el MTC lo explican con estas lecturas. Verificar.` };
}

/** Determinista: misma entrada, mismo resultado y mismo orden. */
export function buildTagActions(input: TagActionsInput): TagActionsReport {
  const agvs = [...input.readingsByAgv.keys()].sort(byTag);
  const pairs = new Map<string, { tagId: string; mtc: string; agvs: Set<string>; actions: Map<string, number>; notExecuted: number; notInMemory: number }>();
  const tags = new Map<
    string,
    {
      reads: number;
      notExecuted: number;
      agvs: Set<string>;
      byMtc: Map<string, { reads: number; notExecuted: number }>;
      wifi: { executedInCut: number; executedOutside: number; notExecutedInCut: number; notExecutedOutside: number } | null;
    }
  >();
  const notInMemory = new Map<string, { agvId: string; utcMs: number; raw: string; mtc: string }[]>();

  for (const agvId of agvs) {
    const cuts = input.cutsByAgv.get(agvId);
    const rows = [...(input.readingsByAgv.get(agvId) ?? [])].sort((a, b) => a.utcMs - b.utcMs || a.sourceRow - b.sourceRow);
    for (const row of rows) {
      const key = `${row.tagId}\u0000${row.mtc}`;
      let pair = pairs.get(key);
      if (pair === undefined) {
        pair = { tagId: row.tagId, mtc: row.mtc, agvs: new Set(), actions: new Map(), notExecuted: 0, notInMemory: 0 };
        pairs.set(key, pair);
      }
      pair.agvs.add(agvId);
      pair.actions.set(row.action, (pair.actions.get(row.action) ?? 0) + 1);
      if (row.notExecuted) pair.notExecuted += 1;
      if (row.notInMemory) {
        pair.notInMemory += 1;
        const list = notInMemory.get(row.tagId) ?? [];
        list.push({ agvId, utcMs: row.utcMs, raw: row.raw, mtc: row.mtc });
        notInMemory.set(row.tagId, list);
      }

      let tag = tags.get(row.tagId);
      if (tag === undefined) {
        tag = { reads: 0, notExecuted: 0, agvs: new Set(), byMtc: new Map(), wifi: null };
        tags.set(row.tagId, tag);
      }
      tag.reads += 1;
      tag.agvs.add(agvId);
      if (row.notExecuted) tag.notExecuted += 1;
      const mtc = tag.byMtc.get(row.mtc) ?? { reads: 0, notExecuted: 0 };
      mtc.reads += 1;
      if (row.notExecuted) mtc.notExecuted += 1;
      tag.byMtc.set(row.mtc, mtc);
      if (cuts !== undefined) {
        tag.wifi ??= { executedInCut: 0, executedOutside: 0, notExecutedInCut: 0, notExecutedOutside: 0 };
        const inside = inCut(cuts, row.utcMs);
        if (row.notExecuted) {
          if (inside) tag.wifi.notExecutedInCut += 1;
          else tag.wifi.notExecutedOutside += 1;
        } else if (inside) tag.wifi.executedInCut += 1;
        else tag.wifi.executedOutside += 1;
      }
    }
  }

  const catalog: CatalogEntry[] = [...pairs.values()]
    .map((pair) => {
      const ranked = [...pair.actions.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const [action = ""] = ranked[0] ?? [];
      let total = 0;
      for (const count of pair.actions.values()) total += count;
      return {
        tagId: pair.tagId,
        mtc: pair.mtc,
        reads: total,
        agvs: [...pair.agvs].sort(byTag),
        action,
        parsed: parseAction(action),
        variants: ranked.slice(1).map(([text, count]) => ({ action: text, reads: count })),
        notExecuted: pair.notExecuted,
        notInMemory: pair.notInMemory,
      };
    })
    .sort((a, b) => byTag(a.tagId, b.tagId) || byTag(a.mtc, b.mtc));

  const notExecuted: NotExecutedNotice[] = [...tags.entries()]
    .filter(([, tag]) => tag.notExecuted > 0)
    .map(([tagId, tag]) => {
      const base = {
        tagId,
        reads: tag.reads,
        notExecuted: tag.notExecuted,
        agvs: [...tag.agvs].sort(byTag),
        byMtc: [...tag.byMtc.entries()].sort((a, b) => byTag(a[0], b[0])).map(([mtc, entry]) => ({ mtc, ...entry })),
        wifi: tag.wifi,
      };
      return { ...base, ...describeNotExecuted(base) };
    })
    .sort((a, b) => b.notExecuted - a.notExecuted || byTag(a.tagId, b.tagId));

  const notInMemoryNotices: NotInMemoryNotice[] = [...notInMemory.entries()]
    .map(([tagId, reads]) => {
      const agvList = [...new Set(reads.map((read) => read.agvId))].sort(byTag);
      return {
        tagId,
        reads,
        evidence:
          `${reads.length} ${reads.length === 1 ? "lectura" : "lecturas"} «No en memoria» (AGV ${agvList.join(", ")}): ` +
          "el AGV leyó un tag que no tiene cargado. O la memoria del vehículo no es la que dice la lista, o el tag no debería estar ahí. Verificar.",
      };
    })
    .sort((a, b) => b.reads.length - a.reads.length || byTag(a.tagId, b.tagId));

  return { agvs, catalog, notExecuted, notInMemory: notInMemoryNotices };
}
