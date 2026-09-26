/**
 * La vista de evolución (ADR-0015 §3): el anillo recorre el tiempo y lo que cambió de una
 * instantánea a la siguiente se enseña en cifras, en lista y resaltado en el propio anillo.
 *
 * El propietario (2026-09-26): «un grafo que va moviéndose, ampliando o reduciendo sus vértices
 * (tags) y aumentando o reduciendo sus caminos (tiempo)». Nada de esto calcula: la instantánea
 * (`CircuitSnapshot`) y su delta (`SnapshotDelta`) llegan ya hechos del Worker y del almacén; aquí
 * solo se traducen a lo que el anillo (`RingData`) y el gráfico de tiempos (`EvolutionData`) dibujan.
 *
 * Lo que la instantánea **no** guarda no se inventa: la zona del anillo, el patrón de lectura y las
 * paradas sin explicación por tag quedan fuera del dibujo de una instantánea antigua, y el pie del
 * anillo lo dice. Todo texto del dato entra por `textContent` (TH-007).
 */

import type { CircuitViews } from "../application/protocol.js";
import type { Interval } from "../domain/coverage.js";
import type { CircuitSnapshot, SnapshotDelta, VertexDelta } from "../domain/snapshot.js";
import { plainTable } from "./charts.js";
import { SECTION_TONES, type EvolutionData, type RingData, type RingMark } from "./diagnostic-charts.js";
import { tableDrawer } from "./drawer.js";
import { criticalFunctionLabel } from "./labels.js";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Marcas numeradas alrededor del anillo, como mucho: el mismo tope que `ringDataOf` en `main.ts`. */
const RING_MARKS = 20;
/** Cambios listados de entrada en «Evolución»; el resto, en el cajón. Parámetro de pantalla. */
const DELTA_ROWS = 8;

// --- 1. El anillo desde una instantánea ---------------------------------------------------------

/**
 * El `RingData` de una instantánea. Lo que se pierde frente al anillo de hoy, y por qué:
 * - **zona** (`zone`): la instantánea no la guarda; queda `null` y la banda exterior no se dibuja.
 * - **patrón** de lectura: tampoco; la lectura al puntero da la omisión sin patrón.
 * - **incidencias**: solo lo que los hallazgos de la instantánea dicen por tag —cuello de botella,
 *   punto conflictivo y zona oscura (esta, solo su primer tag: es lo que lleva la clave)—; las
 *   paradas sin explicación son incidencias con instante y no viajan en la instantánea. Sin ninguno
 *   de esos hallazgos la capa «Paradas» dice «sin medir», no «ninguna».
 * - **marcas**: cada vértice con `funcion`; «declarado» es `declared` del vértice, que dice si el
 *   tag está en la lista, no si la función lo está.
 * - **calles**: el vértice de calle no está en el anillo; el tag del que cuelga es su predecesor
 *   dominante (R-DAT-019) si está en el anillo. Si no, esa calle no se dibuja.
 */
export function ringDataFromSnapshot(snapshot: CircuitSnapshot): RingData {
  const vertexOf = new Map(snapshot.vertices.map((vertex) => [vertex.tagId, vertex]));
  const inRing = new Set(snapshot.ring);
  const bottleneck = new Set<string>();
  const conflict = new Set<string>();
  const dark = new Set<string>();
  for (const finding of snapshot.findings) {
    const subject = finding.key.split("|")[1] ?? "";
    if (finding.kind === "cuello-de-botella") bottleneck.add(subject);
    else if (finding.kind === "punto-conflictivo") for (const tagId of subject.split("+")) conflict.add(tagId);
    else if (finding.kind === "zona-oscura") dark.add(subject);
  }
  const measured = bottleneck.size + conflict.size + dark.size > 0;

  const marks: RingMark[] = [];
  for (const tagId of snapshot.ring) {
    const vertex = vertexOf.get(tagId);
    if (vertex?.funcion !== null && vertex?.funcion !== undefined && marks.length < RING_MARKS) {
      marks.push({ tagId, label: criticalFunctionLabel(vertex.funcion), declared: vertex.declared });
    }
  }

  const servedOf = new Map(snapshot.lanes.map((lane) => [lane.laneId, lane.served]));
  const seenLanes = new Set<string>();
  const junctions: { laneId: string; tagId: string; served: boolean }[] = [];
  for (const vertex of snapshot.vertices) {
    if (vertex.situation !== "calle" || vertex.laneId === null || seenLanes.has(vertex.laneId)) continue;
    seenLanes.add(vertex.laneId);
    const hang = vertex.predecessor;
    if (hang === null || !inRing.has(hang)) continue;
    junctions.push({ laneId: vertex.laneId, tagId: hang, served: servedOf.get(vertex.laneId) ?? true });
  }

  const anchorTagId = snapshot.anchorTagId ?? snapshot.ring[0] ?? "";
  return {
    tags: snapshot.ring.map((tagId) => {
      const vertex = vertexOf.get(tagId);
      return {
        tagId,
        omission: vertex === undefined || vertex.readRate === null ? null : Math.max(0, 1 - vertex.readRate),
        passes: vertex?.passes ?? 0,
        pattern: "",
        zone: null,
        isAnchor: tagId === anchorTagId,
        section: vertex?.section ?? null,
        ...(measured
          ? { incidents: { stops: 0, bottleneckEpisodes: bottleneck.has(tagId) ? 1 : 0, conflict: conflict.has(tagId), dark: dark.has(tagId) } }
          : {}),
      };
    }),
    anchorTagId,
    anchorDeclared: snapshot.anchorDeclared,
    marks,
    junctions,
  };
}

// --- 2. Lo que cambió ---------------------------------------------------------------------------

const VERTEX_KIND_LABEL: Readonly<Record<VertexDelta["kind"], string>> = {
  aparece: "aparece",
  desaparece: "desaparece",
  "se-mueve": "se mueve",
  "cambia-de-clase": "cambia de clase",
  "deja-de-leerse": "deja de leerse",
  "empieza-a-leerse": "empieza a leerse",
};

/** El delta que explica la instantánea elegida: el que llega a ella o, si es la primera, el que sale de ella. */
export function deltaAround(
  deltas: readonly SnapshotDelta[],
  sourceId: string,
): { readonly delta: SnapshotDelta; readonly direction: "desde-anterior" | "hacia-siguiente" } | null {
  const into = deltas.find((delta) => delta.toSourceId === sourceId);
  if (into !== undefined) return { delta: into, direction: "desde-anterior" };
  const from = deltas.find((delta) => delta.fromSourceId === sourceId);
  return from === undefined ? null : { delta: from, direction: "hacia-siguiente" };
}

const clock = (ms: number): string => (ms < 90_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1).replace(".", ",")} min`);

/**
 * Cada tag con delta, con una frase corta para la lectura del anillo. Un tag con dos deltas los
 * lleva juntos. El cambio de clase de inventario **no** resalta el anillo: es una etiqueta que
 * cambia con las listas cargadas (cargar la lista después del primer fichero reclasifica todos los
 * tags), no un movimiento del grafo; va en la lista y en la tabla, al final.
 */
export function changedTagsOf(delta: SnapshotDelta): ReadonlyMap<string, string> {
  const out = new Map<string, string[]>();
  const add = (tagId: string, text: string): void => {
    out.set(tagId, [...(out.get(tagId) ?? []), text]);
  };
  for (const vertex of delta.vertices) if (vertex.kind !== "cambia-de-clase") add(vertex.tagId, VERTEX_KIND_LABEL[vertex.kind]);
  for (const edge of delta.edges) {
    add(edge.from, `tramo hasta ${edge.to} ${edge.direction === "mas-lento" ? "más lento" : "más rápido"} en ${edge.regime} (${clock(edge.before.p50Ms)} → ${clock(edge.after.p50Ms)})`);
  }
  return new Map([...out].map(([tagId, texts]) => [tagId, texts.join("; ")]));
}

interface DeltaRow {
  readonly what: string;
  readonly subject: string;
  readonly detail: string;
}

/** Las filas de la lista y de la tabla: primero el grafo (tags y tramos), la vuelta, y al final las clases. */
function deltaRows(delta: SnapshotDelta): readonly DeltaRow[] {
  const row = (vertex: VertexDelta): DeltaRow => ({ what: VERTEX_KIND_LABEL[vertex.kind], subject: vertex.tagId, detail: vertex.detail });
  const vertices = delta.vertices.filter((vertex) => vertex.kind !== "cambia-de-clase").map(row);
  const classes = delta.vertices.filter((vertex) => vertex.kind === "cambia-de-clase").map(row);
  const edges = delta.edges.map((edge) => ({
    what: edge.direction === "mas-lento" ? "tramo más lento" : "tramo más rápido",
    subject: `${edge.from} → ${edge.to}`,
    detail:
      `En ${edge.regime}, la mitad de las pasadas tardaba ${clock(edge.before.p50Ms)} (el 80 %, ${clock(edge.before.p80Ms)}) ` +
      `y ahora ${clock(edge.after.p50Ms)} (el 80 %, ${clock(edge.after.p80Ms)}); ${edge.before.samples} y ${edge.after.samples} pasadas.`,
  }));
  const lap =
    delta.lapShift === null
      ? []
      : [{ what: "vuelta", subject: "anillo", detail: `La vuelta mediana pasa de ${clock(delta.lapShift.beforeMs)} a ${clock(delta.lapShift.afterMs)}.` }];
  return [...vertices, ...edges, ...lap, ...classes];
}

/** La línea de cifras: cuántos de cada cosa, con el cero en gris porque también informa. */
function figuresOf(delta: SnapshotDelta): HTMLElement {
  const count = (kind: VertexDelta["kind"]): number => delta.vertices.filter((vertex) => vertex.kind === kind).length;
  const items: (readonly [number, string])[] = [
    [count("aparece"), "aparecen"],
    [count("desaparece"), "desaparecen"],
    [count("se-mueve"), "se mueven"],
    [count("deja-de-leerse"), "dejan de leerse"],
    [count("empieza-a-leerse"), "empiezan a leerse"],
    [delta.edges.filter((edge) => edge.direction === "mas-lento").length, "tramos más lentos"],
    [delta.edges.filter((edge) => edge.direction === "mas-rapido").length, "tramos más rápidos"],
    [count("cambia-de-clase"), "cambian de clase"],
  ];
  const list = node("ul", "evo-figures");
  list.setAttribute("aria-label", "Cifras del cambio");
  for (const [value, label] of items) {
    const item = node("li", value === 0 ? "evo-figure zero" : "evo-figure");
    item.append(node("span", "evo-n", String(value)), " ", node("span", undefined, label));
    list.append(item);
  }
  const lap = node("li", delta.lapShift === null ? "evo-figure zero" : "evo-figure");
  lap.append(
    node("span", "evo-n", delta.lapShift === null ? "=" : `${clock(delta.lapShift.beforeMs)} → ${clock(delta.lapShift.afterMs)}`),
    " ",
    node("span", undefined, delta.lapShift === null ? "vuelta igual" : "vuelta"),
  );
  list.append(lap);
  return list;
}

export interface EvolutionSectionInput {
  readonly snapshots: readonly CircuitSnapshot[];
  readonly deltas: readonly SnapshotDelta[];
  readonly selected: number;
  /** La ventana del fichero, escrita: es la fecha de la instantánea que importa, no la de su cálculo. */
  readonly formatWindow: (window: Interval) => string;
}

/** La sección «Evolución» de la portada, para la instantánea elegida. Se rehace al cambiar de instantánea. */
export function evolutionSection(input: EvolutionSectionInput): HTMLElement {
  const box = node("div", "evolution");
  box.append(node("h3", undefined, "Evolución"));
  const current = input.snapshots[input.selected];
  if (input.snapshots.length < 2 || current === undefined) {
    box.append(node("p", "muted", "Con un solo fichero no hay evolución que enseñar; carga el siguiente."));
    return box;
  }
  const around = deltaAround(input.deltas, current.sourceId);
  if (around === null) {
    box.append(node("p", "muted", `No hay comparación guardada para «${current.fileName}»: la instantánea vecina no se pudo construir.`));
    return box;
  }
  const { delta, direction } = around;
  const other = input.snapshots.find((snapshot) => snapshot.sourceId === (direction === "desde-anterior" ? delta.fromSourceId : delta.toSourceId));
  const otherName = other?.fileName ?? "—";
  box.append(
    node(
      "p",
      "muted",
      direction === "desde-anterior"
        ? `De «${otherName}» a «${current.fileName}» (${input.formatWindow(current.window)}): lo que el grafo enseña distinto. Hechos, no causas.`
        : `«${current.fileName}» es la primera instantánea: lo que cambió después, hasta «${otherName}». Hechos, no causas.`,
    ),
  );
  box.append(figuresOf(delta));
  const rows = deltaRows(delta);
  if (rows.length === 0) {
    box.append(node("p", "muted", "Nada cambió entre las dos instantáneas: mismos tags, en el mismo sitio, con las mismas horquillas."));
    return box;
  }
  const list = node("ul", "evo-list");
  for (const row of rows.slice(0, DELTA_ROWS)) {
    const item = node("li");
    item.append(node("span", "chip", row.what), " ", node("span", "mono", row.subject), " ", node("span", "muted", row.detail));
    list.append(item);
  }
  box.append(list);
  if (rows.length > DELTA_ROWS) box.append(node("p", "muted", `${rows.length - DELTA_ROWS} cambios más en la tabla.`));
  box.append(
    tableDrawer(`Ver todos los cambios (${rows.length})`, () =>
      plainTable(
        ["Qué", "Tag o tramo", "Detalle"],
        rows.map((row) => [row.what, row.subject, row.detail]),
      ),
    ),
  );
  return box;
}

// --- 3. El control de tiempo --------------------------------------------------------------------

export interface TimeControlEntry {
  readonly label: string;
  readonly date: string;
}

/**
 * El selector de instantánea sobre el anillo: un `range` con `aria-valuetext` (fichero y fecha),
 * «anterior» y «siguiente», y la misma lista como `select` para teclado y lector de pantalla. Los
 * tres mueven la misma posición; el que cambia se lo dice a los otros dos.
 */
export function timeControl(entries: readonly TimeControlEntry[], initial: number, onChange: (index: number) => void): HTMLElement {
  const box = node("div", "time-control");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", "Instantánea del circuito");
  const last = entries.length - 1;
  let index = initial;

  const previous = node("button", "time-step", "‹ Anterior");
  previous.type = "button";
  previous.setAttribute("aria-label", "Instantánea anterior");
  const next = node("button", "time-step", "Siguiente ›");
  next.type = "button";
  next.setAttribute("aria-label", "Instantánea siguiente");
  const range = node("input", "time-range");
  range.type = "range";
  range.min = "0";
  range.max = String(last);
  range.step = "1";
  range.setAttribute("aria-label", "Instantánea");
  const select = node("select", "time-select");
  select.setAttribute("aria-label", "Instantánea (lista)");
  entries.forEach((entry, position) => {
    const option = node("option", undefined, `${position + 1} de ${entries.length}: ${entry.label}, ${entry.date}`);
    option.value = String(position);
    select.append(option);
  });
  const label = node("p", "muted time-label");
  label.setAttribute("aria-live", "polite");

  const apply = (position: number, notify: boolean): void => {
    index = Math.max(0, Math.min(last, position));
    const entry = entries[index] as TimeControlEntry;
    range.value = String(index);
    range.setAttribute("aria-valuetext", `${entry.label}, ${entry.date}`);
    select.value = String(index);
    previous.disabled = index === 0;
    next.disabled = index === last;
    label.textContent = `Instantánea ${index + 1} de ${entries.length}: ${entry.label}, ${entry.date}${index === last ? " (la de hoy)" : ""}`;
    if (notify) onChange(index);
  };
  previous.addEventListener("click", () => apply(index - 1, true));
  next.addEventListener("click", () => apply(index + 1, true));
  range.addEventListener("input", () => apply(Number(range.value), true));
  select.addEventListener("change", () => apply(Number(select.value), true));
  const row = node("div", "time-row");
  row.append(previous, range, next, select);
  box.append(row, label);
  apply(initial, false);
  return box;
}

// --- 4. El gráfico de tiempos ---------------------------------------------------------------------

/**
 * Las series del gráfico: una por sección entre anclas, con la mitad de las pasadas en producción de
 * cada instantánea. Más de ocho secciones: las ocho con mayor tiempo se quedan y el resto se suma en
 * «otras». Sin secciones en ninguna instantánea, la vuelta. Con menos de dos instantáneas, `null`.
 */
export function evolutionDataOf(snapshots: readonly CircuitSnapshot[], formatWindow: (window: Interval) => string): EvolutionData | null {
  if (snapshots.length < 2) return null;
  const labels = snapshots.map((snapshot) => snapshot.fileName);
  const dates = snapshots.map((snapshot) => formatWindow(snapshot.window));
  const names: string[] = [];
  for (const snapshot of snapshots) for (const section of snapshot.sections) if (!names.includes(section.name)) names.push(section.name);
  if (names.length === 0) {
    return {
      labels,
      dates,
      measure: "la vuelta mediana del anillo",
      series: [{ name: "vuelta", color: "var(--viz-tramo-1)", p50Ms: snapshots.map((snapshot) => snapshot.lapMs) }],
    };
  }
  const valueOf = (snapshot: CircuitSnapshot, name: string): number | null =>
    snapshot.sections.find((section) => section.name === name)?.produccion?.p50Ms ?? null;
  const all = names.map((name) => ({ name, p50Ms: snapshots.map((snapshot) => valueOf(snapshot, name)) }));
  const peak = (values: readonly (number | null)[]): number => Math.max(0, ...values.filter((value): value is number => value !== null));
  // El color sigue a la sección por su orden en el anillo, no a su tamaño: al plegar el resto, las
  // que se quedan conservan su tono.
  const kept = all.length <= SECTION_TONES ? all : [...all].sort((a, b) => peak(b.p50Ms) - peak(a.p50Ms)).slice(0, SECTION_TONES - 1);
  const keptNames = new Set(kept.map((series) => series.name));
  const ordered = all.filter((series) => keptNames.has(series.name));
  const series = ordered.map((entry, index) => ({ ...entry, color: `var(--viz-tramo-${index + 1})` }));
  if (all.length > SECTION_TONES) {
    const rest = all.filter((entry) => !keptNames.has(entry.name));
    series.push({
      name: `otras (suma de ${rest.length})`,
      color: `var(--viz-tramo-${SECTION_TONES})`,
      p50Ms: snapshots.map((_, index) => {
        const values = rest.map((entry) => entry.p50Ms[index]).filter((value): value is number => value !== null && value !== undefined);
        return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
      }),
    });
  }
  return { labels, dates, measure: "la mitad de las pasadas en producción de una sección entre anclas", series };
}

// --- 5. Los ficheros en Datos -----------------------------------------------------------------------

/** Por fichero, qué queda de él en este dispositivo (R-DAT-023): lecturas retenidas, solo instantánea, o nada. */
export function sourceStatusList(snapshots: CircuitViews["snapshots"], formatTick: (utcMs: number) => string): HTMLElement {
  const box = node("div", "source-status");
  box.append(node("h3", undefined, "Ficheros del circuito"));
  box.append(
    node(
      "p",
      "muted",
      "Las lecturas en crudo solo viven en la ventana de trabajo: la última exportación y, si se solapa con ella, la anterior. " +
        "Lo demás queda como instantánea, que es lo que la evolución compara.",
    ),
  );
  const list = node("ul", "source-list");
  for (const entry of snapshots.list) {
    const item = node("li");
    item.dataset["source"] = entry.sourceId;
    const status = entry.retained ? "lecturas retenidas" : entry.hasSnapshot ? "solo instantánea" : "sin instantánea (vuelve a cargarlo)";
    const chip = node("span", entry.retained ? "chip retained" : entry.hasSnapshot ? "chip snapshot" : "chip missing", status);
    item.append(node("span", "mono", entry.fileName), " ", node("span", "muted", `${formatTick(entry.window.from)} → ${formatTick(entry.window.to)}`), " ", chip);
    list.append(item);
  }
  box.append(list);
  for (const problem of snapshots.problems) box.append(node("p", "muted", problem));
  return box;
}
