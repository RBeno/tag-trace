/**
 * Los hallazgos que la instantánea guarda, con su clave de revisión (ADR-0015, R-EVI-007).
 *
 * La clave de un hallazgo es su tipo y su sujeto unidos por `reviewKey` (`review.ts`), y hoy la
 * fabrica la presentación al pintar cada tarjeta (`finding(...)` en `main.ts`, con `attach` de
 * `review-ui.ts` para el sufijo `#n` de dos tarjetas iguales). El Worker no puede importar la
 * presentación, así que aquí se **replica el criterio exacto**: las mismas partes, en el mismo orden,
 * el mismo separador y el mismo sufijo por orden de aparición. Cambiar las partes de una tarjeta en
 * `main.ts` sin cambiarlas aquí desengancharía las marcas de revisión de la instantánea; el
 * comentario de cada tipo dice de qué tarjeta copia.
 *
 * Entran los hallazgos que hablan del **estado del circuito** —tags, AGV, calles, estructura, puntos
 * del anillo—, que es lo que una instantánea compara con la siguiente, y, desde OQ-149 (propietario
 * 2026-09-27), los de rango 1 que ocurren en un instante —primero de cola sin avanzar, parada y paso
 * de la línea, AGV que deja de leer, producción parada—, con su ventana de tiempo y su sujeto, para
 * que una persona los confirme y la consolidación los guarde como incidencias. De cada lista entra
 * **exactamente lo que la interfaz pinta** (`CARDS_SHOWN`, el mismo orden y el mismo recorte): una
 * tarjeta en la instantánea que no se ve quedaría pendiente para siempre y bloquearía la consolidación.
 */

import type { LaneReport, LaneUsage } from "./charging.js";
import type { CircuitState } from "./circuit-state.js";
import type { Interval } from "./coverage.js";
import { CARDS_SHOWN } from "./finding-kinds.js";
import type { Blockage, ProductionStop } from "./flow-stops.js";
import type { Incident, IncidentBattery } from "./incident-battery.js";
import type { LineFeed } from "./line-feed.js";
import type { ReadMatrix } from "./read-matrix.js";
import { reviewKey, type ReviewEntry } from "./review.js";
import type { SnapshotFinding } from "./snapshot.js";
import type { TagChange } from "./tag-changes.js";
import type { UndeclaredTag } from "./undeclared-tags.js";

export interface SnapshotFindingsInput {
  readonly zone: string;
  /** La matriz del cohorte principal: roturas y degradaciones de tags y de AGV (R-OPP-015). */
  readonly matrix: ReadMatrix | null;
  readonly tagChanges: readonly TagChange[];
  readonly lanes: readonly Pick<LaneReport, "laneId" | "served">[];
  readonly laneUsage: readonly LaneUsage[];
  readonly state: Pick<CircuitState, "bottlenecks" | "conflictPoints" | "darkZones"> | null;
  readonly undeclaredTags: readonly UndeclaredTag[];
  /** Las marcas de revisión del circuito, por clave. */
  readonly reviews: ReadonlyMap<string, ReviewEntry>;
  /**
   * Las paradas de la producción y los primeros de cola sin avanzar (`renderFlowStops`), con el número
   * de AGV de la flota: sin ninguno, la interfaz no pinta la sección. Opcional (OQ-149).
   */
  readonly flow?: {
    readonly vehicles: number;
    readonly production: { readonly stops: readonly Pick<ProductionStop, "fromUtcMs" | "toUtcMs" | "sameTimeOn">[] };
    /** En el orden de la vista: más AGV detrás primero. */
    readonly blockages: readonly Pick<Blockage, "agvId" | "tagId" | "nextTagId" | "fromUtcMs" | "toUtcMs" | "usualMs" | "functionAtTag">[];
  } | null;
  /** La alimentación de la línea de las vistas (`renderLineFeed`): paradas y pasos. Opcional (OQ-149). */
  readonly lineFeed?: Pick<LineFeed, "evaluated" | "cadence" | "entryTagId" | "stops" | "passages"> | null;
  /** Los AGV que dejan de leer de las vistas (`renderAbandoned`), en su orden. Opcional (OQ-149). */
  readonly abandoned?: readonly { readonly incident: Incident; readonly battery: Pick<IncidentBattery, "durationMs" | "swap"> }[];
}

/** Mismo formato que `formatInstant` de `main.ts`: la cifra de la tarjeta tiene que coincidir. */
function instant(zone: string, utcMs: number): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: zone, dateStyle: "short", timeStyle: "medium" }).format(new Date(utcMs));
}

/** Mismo formato que `formatTick` de `main.ts`: día de la semana y hora. */
function tick(zone: string, utcMs: number): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(utcMs));
}

function percent(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)} %`;
}

/** Mismo formato que `duration` de `main.ts`. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 90_000) return `${Math.round(ms / 1000)} s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

/** Mismo recorte que `few` de `renderCircuitState` (main.ts). */
function few(ids: readonly string[]): string {
  return ids.length > 4 ? `${ids.slice(0, 4).join(", ")}…` : ids.join(", ");
}

interface Draft {
  readonly parts: readonly string[];
  readonly title: string;
  readonly figure: string;
  readonly window?: Interval;
  readonly windows?: readonly Interval[];
  readonly agvId?: string;
  readonly tagIds?: readonly string[];
}

/** La ventana de un instante: empieza y acaba en él. */
function at0(utcMs: number): Interval {
  return { from: utcMs, to: utcMs };
}

export function buildSnapshotFindings(input: SnapshotFindingsInput): readonly SnapshotFinding[] {
  const drafts: Draft[] = [];
  const at = (utcMs: number): string => instant(input.zone, utcMs);
  const short = (utcMs: number): string => tick(input.zone, utcMs);

  if (input.matrix !== null) {
    // `renderTagTrends` / `renderVehicleTrends` (main.ts): rotura = cambio de golpe; degradación = tendencia.
    for (const tag of input.matrix.tags.filter((row) => row.changedAtUtcMs !== undefined)) {
      drafts.push({
        parts: ["tag-rotura", tag.tagId],
        title: `Tag ${tag.tagId}: su lectura cae de golpe`,
        figure: `${percent(tag.rateBefore)} → ${percent(tag.rateAfter)} desde ${at(tag.changedAtUtcMs as number)}`,
        window: at0(tag.changedAtUtcMs as number),
      });
    }
    for (const tag of input.matrix.tags.filter((row) => row.trend === "bajando")) {
      drafts.push({
        parts: ["tag-degradacion", tag.tagId],
        title: `Tag ${tag.tagId}: su lectura baja a lo largo del periodo`,
        figure: (tag.segmentRates ?? []).map((rate) => percent(rate)).join(" → "),
      });
    }
    for (const vehicle of input.matrix.vehicles.filter((row) => row.changedAtUtcMs !== undefined)) {
      drafts.push({
        parts: ["agv-rotura", vehicle.agvId],
        title: `AGV ${vehicle.agvId}: su lectura cae de golpe`,
        figure: `${percent(vehicle.rateBefore)} → ${percent(vehicle.rateAfter)} desde ${at(vehicle.changedAtUtcMs as number)}`,
        // OQ-149: es de un AGV, no de un sitio. Con su instante de cambio y sin tags del grafo (un AGV
        // cuyo identificador coincidiera con el de un tag no debe tocar ese tag).
        window: at0(vehicle.changedAtUtcMs as number),
        agvId: vehicle.agvId,
        tagIds: [],
      });
    }
    for (const vehicle of input.matrix.vehicles.filter((row) => row.trend === "bajando")) {
      drafts.push({
        parts: ["agv-degradacion", vehicle.agvId],
        title: `AGV ${vehicle.agvId}: su lectura baja a lo largo del periodo`,
        figure: (vehicle.segmentRates ?? []).map((rate) => percent(rate)).join(" → "),
      });
    }
  }

  // `renderTagChanges` (main.ts): cambio de tag, dejó de leerse, empezó a leerse (R-DAT-019).
  for (const change of input.tagChanges) {
    if (change.kind === "cambio") {
      drafts.push({
        parts: ["cambio-tag", change.oldTagId, change.newTagId],
        title: `${change.oldTagId} → ${change.newTagId}`,
        figure: `${change.oldTagId} dejó de leerse ${at(change.oldLastUtcMs)}; ${change.newTagId} empezó ${at(change.newFirstUtcMs)}`,
      });
    } else if (change.kind === "deja") {
      drafts.push({
        parts: ["tag-deja", change.tagId],
        title: `Tag ${change.tagId}: dejó de leerse`,
        figure: `última lectura ${at(change.lastUtcMs)}`,
      });
    } else {
      drafts.push({
        parts: ["tag-empieza", change.tagId],
        title: `Tag ${change.tagId}: empezó a leerse`,
        figure: `primera lectura ${at(change.firstUtcMs)}`,
      });
    }
  }

  // `renderCharging` (main.ts): calles sin servicio y uso desigual (R-CO-009).
  for (const lane of input.lanes.filter((entry) => !entry.served)) {
    drafts.push({ parts: ["calle-sin-servicio", lane.laneId], title: `Nadie entró en «${lane.laneId}»`, figure: "0 estancias" });
  }
  for (const entry of input.laneUsage.filter((usage) => usage.verdict !== null)) {
    drafts.push({
      parts: ["calle-uso", entry.laneId],
      title: `«${entry.laneId}» se usa ${entry.verdict === "menos" ? "menos" : "más"} que las demás`,
      figure: `${entry.stays} estancias, el ${Math.round(entry.share * 100)} %`,
    });
  }

  // `renderCircuitState` (main.ts): cuellos de botella, puntos conflictivos y zonas oscuras (R-TIM-009).
  if (input.state !== null) {
    for (const bottleneck of input.state.bottlenecks) {
      drafts.push({
        parts: ["cuello-de-botella", bottleneck.tagId],
        title: `Cuello de botella en ${bottleneck.tagId}`,
        figure:
          `${bottleneck.retentions} esperas detrás de un AGV que no avanzaba, en ${bottleneck.episodes} colas ` +
          `(la más larga, de ${bottleneck.longestQueue}); ${duration(bottleneck.waitMs)} de espera en total`,
      });
    }
    for (const point of input.state.conflictPoints) {
      const where = point.tags.join(" y ");
      drafts.push({
        parts: ["punto-conflictivo", point.tags.join("+")],
        title: point.ofOneVehicle === null ? `Punto conflictivo en ${where}` : `${point.ofOneVehicle} para una y otra vez en ${where}`,
        figure:
          `${point.stops} paradas sin explicación` +
          (point.ofOneVehicle === null ? ` de ${point.vehicles.length} AGV (${few(point.vehicles)})` : ", todas del mismo AGV"),
      });
    }
    for (const zone of input.state.darkZones) {
      const first = zone.tags[0] ?? "—";
      const last = zone.tags[zone.tags.length - 1] ?? "—";
      drafts.push({
        parts: ["zona-oscura", first],
        title: `Zona oscura de ${first} a ${last}`,
        figure: `${duration(zone.gapMs)} entre dos lecturas al pasar por ahí; lo típico del circuito, ${duration(zone.typicalMs)}`,
      });
    }
  }

  // `renderUndeclaredTags` (main.ts): tags leídos fuera de la lista del circuito (R-DAT-022).
  const label = {
    posicion: "candidato a una posición",
    noche: "tag de noche",
    "noche-probable": "posiblemente de noche",
    "noche-declarado": "tag de noche declarado",
  } as const;
  for (const tag of input.undeclaredTags) {
    drafts.push({
      parts: ["tag-fuera-del-circuito", tag.tagId],
      title: `${tag.tagId}: ${label[tag.verdict]}`,
      figure: `${(tag.dayReadings + tag.nightReadings).toLocaleString("es-ES")} lecturas`,
    });
  }

  // --- Rango 1 con instante (OQ-149): lo que la interfaz pinta, en su orden y con su recorte. ------

  // `renderFlowStops` (main.ts): solo si `renderFleet` pinta la flota (algún AGV). Una tarjeta para
  // todas las paradas de la producción y, después, los primeros de cola sin avanzar (`PER_KIND`).
  const flow = input.flow;
  if (flow !== undefined && flow !== null && flow.vehicles > 0) {
    const stops = flow.production.stops;
    if (stops.length > 0) {
      drafts.push({
        parts: ["produccion-parada", "circuito"],
        title: stops.length === 1 ? "La producción se paró 1 vez" : `La producción se paró ${stops.length} veces`,
        figure: stops
          .map((stop) => `${short(stop.fromUtcMs)} a ${short(stop.toUtcMs)}` + (stop.sameTimeOn.length > 0 ? " (se repite a esa hora otro día)" : ""))
          .join(" · "),
        // Sin sujeto del grafo: una ventana por parada, y la que las abarca.
        window: { from: Math.min(...stops.map((stop) => stop.fromUtcMs)), to: Math.max(...stops.map((stop) => stop.toUtcMs)) },
        windows: stops.map((stop) => ({ from: stop.fromUtcMs, to: stop.toUtcMs })),
        tagIds: [],
      });
    }
    for (const blockage of flow.blockages.slice(0, CARDS_SHOWN.perKind)) {
      const where = blockage.functionAtTag === null ? blockage.tagId : `${blockage.tagId} (${blockage.functionAtTag})`;
      drafts.push({
        parts: ["bloqueo", `${blockage.agvId} ${blockage.tagId} ${blockage.fromUtcMs}`],
        title: `${blockage.agvId}: el primero de la cola, sin avanzar ${duration(blockage.toUtcMs - blockage.fromUtcMs)}`,
        figure:
          `En ${where}, de ${short(blockage.fromUtcMs)} a ${short(blockage.toUtcMs)}; lo habitual hasta ` +
          `${blockage.nextTagId}: ${duration(blockage.usualMs)}`,
        window: { from: blockage.fromUtcMs, to: blockage.toUtcMs },
        tagIds: [blockage.tagId],
      });
    }
  }

  // `renderLineFeed` (main.ts): sin evaluar o sin cadencia no pinta tarjetas. Primero las paradas en
  // que le faltaron AGV, luego las que tenían AGV esperando (`HIGHLIGHTS`); después, los pasos.
  const feed = input.lineFeed;
  if (feed !== undefined && feed !== null && feed.evaluated && feed.cadence !== null) {
    const faltaron = feed.stops.filter((stop) => stop.kind === "sin-agv");
    const shownStops = [...faltaron, ...feed.stops.filter((stop) => stop.kind === "con-pulmon")].slice(0, CARDS_SHOWN.highlights);
    for (const stop of shownStops) {
      const what = stop.kind === "sin-agv" ? "le faltaron AGV" : stop.kind === "con-pulmon" ? "parada con AGV esperando" : "parada, sin pulmón medido";
      drafts.push({
        parts: ["linea", stop.after],
        title: `${at(stop.fromUtcMs)}${stop.regime === "noche" ? " (noche)" : ""}: ${what}`,
        figure: `${duration(stop.durationMs)} sin paso · entró antes ${stop.before}, después ${stop.after}`,
        window: { from: stop.fromUtcMs, to: stop.toUtcMs },
        tagIds: [feed.entryTagId],
      });
    }
    for (const issue of (feed.passages?.issues ?? []).slice(0, CARDS_SHOWN.highlights)) {
      drafts.push({
        parts: ["linea-paso", issue.agvId],
        title: `${at(issue.fromUtcMs)}: ${issue.kind === "no-sigue" ? "no sigue tras la línea" : "pasó sin la parada"}`,
        figure: issue.agvId,
        window: at0(issue.fromUtcMs),
        tagIds: [feed.entryTagId],
      });
    }
  }

  // `renderAbandoned` (main.ts): los AGV que dejan de leer (`HIGHLIGHTS`). Sin sujeto del grafo: el AGV
  // y su ventana, del instante en que deja de leer a su siguiente lectura o al final de lo cargado.
  for (const { incident, battery } of (input.abandoned ?? []).slice(0, CARDS_SHOWN.highlights)) {
    drafts.push({
      parts: ["deja-de-leer", `${incident.agvId} ${incident.fromTagId} ${incident.fromUtcMs}`],
      title: `${incident.agvId}: deja de leer en ${incident.fromTagId}`,
      figure: `Desde ${at(incident.fromUtcMs)}${battery.swap === null ? "" : ` · empieza ${battery.swap.agvId}`}`,
      window: { from: incident.fromUtcMs, to: incident.fromUtcMs + battery.durationMs },
      agvId: incident.agvId,
      tagIds: [],
    });
  }

  // El sufijo `#n` de dos tarjetas con la misma clave, por orden de aparición (`attach`, review-ui.ts).
  const used = new Set<string>();
  return drafts.map((draft): SnapshotFinding => {
    let key = reviewKey(draft.parts);
    for (let n = 2; used.has(key); n += 1) key = reviewKey([...draft.parts, `#${n}`]);
    used.add(key);
    return {
      key,
      kind: draft.parts[0] ?? "",
      title: draft.title,
      figure: draft.figure,
      review: input.reviews.get(key)?.state ?? null,
      ...(draft.window === undefined ? {} : { window: draft.window }),
      ...(draft.windows === undefined ? {} : { windows: draft.windows }),
      ...(draft.agvId === undefined ? {} : { agvId: draft.agvId }),
      ...(draft.tagIds === undefined ? {} : { tagIds: draft.tagIds }),
    };
  });
}
