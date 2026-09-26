/**
 * Tiempos por sección entre anclas (R-TIM-012).
 *
 * El propietario (OQ-141, 2026-09-26): «si se utilizan varias anclas en puntos críticos podría valer
 * también para medir tiempos promedios por zonas tipo kitting, cruce, línea». La lista `ancla`
 * (`CONFIG_SCHEMA.md` §3.4.2) sigue dando el ancla de vuelta —la primera por `orden`, R-GRA-009— y
 * además **todas** las anclas que estén en el anillo del cohorte, ordenadas por su posición en el
 * anillo, delimitan secciones consecutivas: A1→A2, A2→A3, …, An→A1. Con una sola ancla no hay
 * secciones: una sola es la vuelta entera, que ya existe.
 *
 * **Medida.** Por AGV, un paso de la sección Ai→Ai+1 es el tiempo entre su lectura de Ai y su
 * siguiente lectura de Ai+1, con estas condiciones, todas necesarias:
 *
 * - sin otra ancla en medio: si aparece Aj (j ≠ i+1) se descarta el paso abierto y se abre otro en Aj;
 * - sin lectura de un tag de calle de carga en medio: una carga no es tiempo de sección (R-CO-006);
 * - las lecturas repetidas del mismo ancla **seguidas** (sin otra lectura entre ellas) se colapsan a
 *   la primera: un AGV que se queda sobre el ancla la relee, y eso no es un segundo paso. Cuenta la
 *   primera lectura de Ai y la primera de Ai+1. Si el mismo ancla vuelve a leerse tras otros tags,
 *   es una vuelta que no leyó Ai+1: el paso abierto se descarta y se abre otro;
 * - las dos lecturas caen en el mismo tramo de cobertura (`sameSpan`, R-DAT-007) y el paso no cruza
 *   una parada de la producción (R-AGV-018), igual que las horquillas.
 *
 * El régimen es el del punto medio (R-TIM-009). Por sección y régimen se da la horquilla con el
 * mismo criterio que la de los tramos (`bandOf`: p50, p80, p95 y valla = p95 + max(p95 − p50,
 * margen, resolución)), y solo con al menos `minBandSamples` pasos. Además, por fichero de cobertura
 * (R-TIM-011) el p50 de producción, para ver la tendencia; con menos pasos que el mínimo, se dice el
 * número de pasos y no se afirma ningún p50.
 *
 * **Nombre.** Los tags de una sección son Ai y los del anillo estrictamente entre Ai y Ai+1: el
 * ancla de llegada pertenece a la sección siguiente. Si la lista `tramo` está cargada y **más de la
 * mitad** de esos tags pertenecen a un mismo tramo, la sección se llama así («kitting», «línea»,
 * «cruce»…); si no, «Ai → Ai+1». Sin constantes industriales: los mínimos salen de la configuración
 * de horquillas.
 */

import { mergeIntervals, sameSpan, type Interval } from "./coverage.js";
import { sortReadings, type SourceDirection } from "./order.js";
import type { Reading } from "./reading.js";
import { bandOf, REGIMES, sourceResolutionMs, type Band, type BandThresholds, type Regime } from "./segment-bands.js";

/** Un paso completo por una sección: de la primera lectura de Ai a la primera de Ai+1. */
export interface SectionPass {
  readonly agvId: string;
  readonly fromTime: number;
  readonly toTime: number;
}

export interface SectionBySource {
  readonly sourceId: string;
  /** Pasos de producción dentro de la ventana del fichero. */
  readonly samples: number;
  /** `null` con menos pasos que `minBandSamples`: no se afirma un p50 con una anécdota. */
  readonly p50Ms: number | null;
}

export interface AnchorSection {
  readonly fromTagId: string;
  readonly toTagId: string;
  /** El tramo declarado si la mayoría de sus tags lo comparte; si no, «Ai → Ai+1». */
  readonly name: string;
  /** Si el nombre salió de la lista `tramo`. */
  readonly namedByList: boolean;
  /** Ai y los tags del anillo hasta Ai+1, sin incluirlo. */
  readonly tags: readonly string[];
  readonly produccion: Band | null;
  readonly noche: Band | null;
  readonly bySource: readonly SectionBySource[];
}

export interface AnchorSectionsReport {
  /** Las anclas declaradas que están en el anillo, en el orden del anillo. */
  readonly onRing: readonly string[];
  /** Vacío con menos de dos anclas en el anillo. */
  readonly sections: readonly AnchorSection[];
  readonly resolutionMs: number;
  readonly marginMs: number;
}

export interface AnchorSectionsInput {
  readonly readings: readonly Reading[];
  readonly direction: SourceDirection;
  /** El anillo del cohorte, en orden. */
  readonly ring: readonly string[];
  /** La lista `ancla`, en su orden; aquí solo importa cuáles están en el anillo. */
  readonly anchors: readonly string[];
  readonly coverage: readonly Interval[];
  readonly productionStops: readonly Interval[];
  readonly laneTags: ReadonlySet<string>;
  readonly regimeOf: (utcMs: number) => Regime;
  /** El tramo declarado de cada tag (`tagSections`), para el nombre. */
  readonly sectionOf: ReadonlyMap<string, string>;
  /** Las ventanas de cada fichero medido (R-TIM-011), para la tendencia. */
  readonly windows: readonly { readonly sourceId: string; readonly window: Interval }[];
}

/** Las anclas declaradas que están en el anillo, en el orden del anillo (no en el de la lista). */
export function anchorsOnRing(ring: readonly string[], anchors: readonly string[]): readonly string[] {
  const declared = new Set(anchors);
  return ring.filter((tagId) => declared.has(tagId));
}

/**
 * Los pasos completos por cada sección, por AGV. Devuelve un array por sección, en el orden de
 * `onRing` (la sección k va de `onRing[k]` a `onRing[(k + 1) % n]`).
 */
export function sectionPasses(
  readings: readonly Reading[],
  direction: SourceDirection,
  onRing: readonly string[],
  coverage: readonly Interval[],
  productionStops: readonly Interval[],
  laneTags: ReadonlySet<string>,
): readonly (readonly SectionPass[])[] {
  const count = onRing.length;
  const passes: SectionPass[][] = onRing.map(() => []);
  if (count < 2) return passes;
  const indexOf = new Map(onRing.map((tagId, index) => [tagId, index]));
  const spans = mergeIntervals(coverage);
  const stops = mergeIntervals(productionStops);
  const crossesStop = (from: number, to: number): boolean => stops.some((stop) => from < stop.to && to > stop.from);

  const byVehicle = new Map<string, Reading[]>();
  for (const entry of sortReadings([...readings], direction)) {
    let list = byVehicle.get(entry.agvId);
    if (list === undefined) {
      list = [];
      byVehicle.set(entry.agvId, list);
    }
    list.push(entry);
  }

  for (const [agvId, entries] of byVehicle) {
    let open: { readonly anchor: number; readonly at: number } | null = null;
    let previousTag: string | null = null;
    for (const entry of entries) {
      const tagId = entry.tagId;
      if (laneTags.has(tagId)) {
        // Una carga en medio no es tiempo de sección: el paso abierto se descarta.
        open = null;
        previousTag = tagId;
        continue;
      }
      const anchor = indexOf.get(tagId);
      if (anchor === undefined) {
        previousTag = tagId;
        continue;
      }
      if (open !== null && anchor === open.anchor && previousTag === tagId) {
        // Relectura seguida del mismo ancla: cuenta la primera. Nada que abrir ni cerrar.
        previousTag = tagId;
        continue;
      }
      if (open !== null && anchor === (open.anchor + 1) % count) {
        const from = open.at;
        const to = entry.time.utcMs;
        // Cruzar un hueco de cobertura o una parada de la producción no mide la sección (R-DAT-007,
        // R-AGV-018): se descarta el paso, pero la llegada a Ai+1 sí abre el siguiente.
        if (sameSpan(spans, from, to) && !crossesStop(from, to)) {
          (passes[open.anchor] as SectionPass[]).push({ agvId, fromTime: from, toTime: to });
        }
      }
      // Cualquier otra ancla (la esperada, la misma tras otros tags, o una saltada) abre un paso nuevo.
      open = { anchor, at: entry.time.utcMs };
      previousTag = tagId;
    }
  }
  return passes;
}

/**
 * El nombre de la sección: el tramo que comparte más de la mitad de sus tags, o «Ai → Ai+1».
 * Se devuelve también si salió de la lista, para que la vista pueda decirlo.
 */
export function sectionName(
  tags: readonly string[],
  toTagId: string,
  sectionOf: ReadonlyMap<string, string>,
): { readonly name: string; readonly namedByList: boolean } {
  const votes = new Map<string, number>();
  for (const tagId of tags) {
    const section = sectionOf.get(tagId);
    if (section !== undefined) votes.set(section, (votes.get(section) ?? 0) + 1);
  }
  for (const [section, count] of votes) {
    if (count * 2 > tags.length) return { name: section, namedByList: true };
  }
  return { name: `${tags[0] ?? "?"} → ${toTagId}`, namedByList: false };
}

/** Las secciones entre anclas del anillo, con su horquilla por régimen y su p50 por fichero. */
export function measureAnchorSections(input: AnchorSectionsInput, thresholds: BandThresholds, minMarginMs: number): AnchorSectionsReport {
  const onRing = anchorsOnRing(input.ring, input.anchors);
  const passes = sectionPasses(input.readings, input.direction, onRing, input.coverage, input.productionStops, input.laneTags);
  const all = passes.flat();
  // Misma resolución y margen que las horquillas de los tramos: la valla no afirma nada por debajo de
  // lo que la fuente distingue.
  const resolutionMs = sourceResolutionMs(all);
  const marginMs = Math.max(minMarginMs, resolutionMs);
  if (onRing.length < 2) return { onRing, sections: [], resolutionMs, marginMs };

  const positionOf = new Map(input.ring.map((tagId, index) => [tagId, index]));
  const size = input.ring.length;
  const band = (durations: number[]): Band | null => (durations.length >= thresholds.minBandSamples ? bandOf(durations, marginMs) : null);

  const sections = onRing.map((fromTagId, index): AnchorSection => {
    const toTagId = onRing[(index + 1) % onRing.length] as string;
    const start = positionOf.get(fromTagId) as number;
    const end = positionOf.get(toTagId) as number;
    const length = (end - start + size) % size || size; // con dos anclas iguales no pasa: son distintas
    const tags = Array.from({ length }, (_, step) => input.ring[(start + step) % size] as string);
    const own = passes[index] as readonly SectionPass[];
    const byRegime: Record<Regime, number[]> = { produccion: [], noche: [] };
    for (const pass of own) byRegime[input.regimeOf((pass.fromTime + pass.toTime) / 2)].push(pass.toTime - pass.fromTime);
    const bySource = input.windows.map(({ sourceId, window }): SectionBySource => {
      const durations = own
        .filter(
          (pass) =>
            pass.fromTime >= window.from && pass.toTime <= window.to && input.regimeOf((pass.fromTime + pass.toTime) / 2) === "produccion",
        )
        .map((pass) => pass.toTime - pass.fromTime);
      return { sourceId, samples: durations.length, p50Ms: band(durations)?.p50Ms ?? null };
    });
    return {
      fromTagId,
      toTagId,
      ...sectionName(tags, toTagId, input.sectionOf),
      tags,
      produccion: band(byRegime.produccion),
      noche: band(byRegime.noche),
      bySource,
    };
  });
  return { onRing, sections, resolutionMs, marginMs };
}

/**
 * Las secciones en CSV (`;`, coma decimal), como las horquillas: una fila por sección y régimen, y
 * una por sección y fichero con su p50. No lleva nada que no esté en pantalla.
 */
export function anchorSectionsCsv(sections: readonly AnchorSection[]): string {
  const secondsOf = (ms: number | null): string => (ms === null ? "" : (ms / 1000).toFixed(1).replace(".", ","));
  const lines = ["seccion;desde;hasta;tags;regimen_o_fichero;muestras;p50_s;p80_s;p95_s;valla_s"];
  for (const section of sections) {
    const head = [section.name, section.fromTagId, section.toTagId, section.tags.join(" ")];
    for (const regime of REGIMES) {
      const band = section[regime];
      if (band === null) continue;
      lines.push([...head, regime, String(band.samples), secondsOf(band.p50Ms), secondsOf(band.p80Ms), secondsOf(band.p95Ms), secondsOf(band.fenceMs)].join(";"));
    }
    for (const entry of section.bySource) {
      lines.push([...head, entry.sourceId, String(entry.samples), secondsOf(entry.p50Ms), "", "", ""].join(";"));
    }
  }
  return lines.join("\r\n");
}
