/**
 * Vistas de diagnóstico (Parte 38): las diez propuestas de la galería que el propietario eligió
 * llevar a la aplicación.
 *
 * Mismas reglas que `charts.ts`, que aquí tampoco se negocian: el color nunca es el único canal,
 * «sin datos» y «no pasó» llevan trama y nunca se pintan como 0 % (R-DAT-007, R-OPP-013), ningún eje
 * es geometría, y este módulo no calcula nada — recibe agregados que el Worker ya produjo (WP-001).
 *
 * Dos diferencias deliberadas con los cuatro gráficos de `charts.ts`:
 *
 * 1. **Se dibujan al ancho real** del contenedor y se redibujan cuando cambia, en lugar de escalar
 *    un `viewBox` fijo. Con un lienzo de 640 unidades en un móvil de 360 px, un rótulo de 10 unidades
 *    se ve a 5,6 px; dibujando al ancho real se ve a 10.
 * 2. **La lectura al puntero es una sola región viva por gráfico**, nunca un `<title>` por marca —
 *    la lección de la banda de actividad, que llegó a emitir 10.368 nodos. La matriz tag × AGV, que
 *    es la que más celdas tiene, es un único `canvas`.
 *
 * Todo texto que viene del dato entra por `textContent` (TH-007).
 */

import type { CircuitViews } from "../application/protocol.js";
import { HATCH_ID, figure, hatchPattern, lazyDetails, legendList, plainTable, svg, table, text } from "./charts.js";
import { inspect } from "./pointer.js";

export interface Formats {
  /** Instante completo, para las lecturas al puntero y las tablas. */
  readonly instant: (utcMs: number) => string;
  /** Instante corto, para los rótulos de un eje. */
  readonly tick: (utcMs: number) => string;
}

type Matrix = CircuitViews["readMatrices"][number];

const HOUR = 3_600_000;
const HATCH_FILL = `url(#${HATCH_ID})`;
/** La misma trama, para una muestra de leyenda en HTML. */
const HATCH_SWATCH = "repeating-linear-gradient(135deg, var(--viz-empty) 0 2px, var(--panel) 2px 5px)";

function percent(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}

function minutes(ms: number): string {
  const value = Math.round(ms / 60_000);
  return value < 90 ? `${value} min` : `${(value / 60).toFixed(1).replace(".", ",")} h`;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

/**
 * Dibuja al ancho real del contenedor y vuelve a dibujar cuando cambia, o cuando el sistema pasa de
 * claro a oscuro (el `canvas` no hereda los tokens por sí solo). Devuelve un «redibuja ya» para los
 * controles que cambian lo que se enseña sin cambiar el ancho.
 */
function responsive(host: HTMLElement, draw: (width: number) => void): () => void {
  let last = -1;
  const observer = new ResizeObserver(() => {
    if (!host.isConnected) {
      if (last !== -1) observer.disconnect();
      return;
    }
    const width = Math.round(host.clientWidth);
    if (width <= 0 || width === last) return;
    last = width;
    draw(width);
  });
  observer.observe(host);
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (host.isConnected && last > 0) draw(last);
  });
  return () => {
    if (last > 0) draw(last);
  };
}

function host(): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "viz-host";
  return node;
}

/** La región viva de un gráfico: una frase en reposo y la lectura de la marca bajo el puntero. */
function readout(rest: string): { readonly node: HTMLParagraphElement; readonly show: (line: string | null) => void } {
  const node = document.createElement("p");
  node.className = "muted readout";
  node.setAttribute("aria-live", "polite");
  node.textContent = rest;
  return {
    node,
    show: (line) => {
      node.textContent = line ?? rest;
    },
  };
}

/** Marcas en el eje del tiempo a un paso redondo, las que quepan sin pisarse. */
const TIME_STEPS = [HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 48 * HOUR, 168 * HOUR, 336 * HOUR];
function timeTicks(from: number, to: number, maxTicks: number): number[] {
  const span = Math.max(1, to - from);
  const step = TIME_STEPS.find((candidate) => span / candidate <= maxTicks) ?? (TIME_STEPS[TIME_STEPS.length - 1] as number);
  const ticks: number[] = [];
  for (let tick = Math.ceil(from / step) * step; tick <= to; tick += step) ticks.push(tick);
  return ticks;
}

function timeAxis(
  parent: SVGElement,
  x: (utcMs: number) => number,
  from: number,
  to: number,
  gridTop: number,
  gridBottom: number,
  labelY: number,
  width: number,
  format: (utcMs: number) => string,
): void {
  for (const tick of timeTicks(from, to, Math.max(3, Math.floor(width / 90)))) {
    const px = x(tick);
    parent.append(svg("line", { x1: px, x2: px, y1: gridTop, y2: gridBottom, stroke: "var(--viz-grid)" }));
    const anchor = px < 40 ? "start" : px > width - 40 ? "end" : "middle";
    parent.append(text(px, labelY, format(tick), "axis", { "text-anchor": anchor }));
  }
}

/** Un paso redondo (1, 2 o 5 por potencia de diez) para rotular un eje de recuentos. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

function arcPath(cx: number, cy: number, inner: number, outer: number, from: number, to: number): string {
  const point = (radius: number, angle: number): string =>
    `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  const large = to - from > Math.PI ? 1 : 0;
  return (
    `M${point(outer, from)}A${outer} ${outer} 0 ${large} 1 ${point(outer, to)}` +
    `L${point(inner, to)}A${inner} ${inner} 0 ${large} 0 ${point(inner, from)}Z`
  );
}

/**
 * Cinco clases de omisión para las marcas discretas del anillo. Son **clases de pantalla**, no
 * umbrales de diagnóstico: el patrón de cada tag lo decide la matriz con su configuración; esto solo
 * elige en qué escalón de la rampa se pinta. Lo que no falta se funde con el fondo.
 */
const OMISSION_CLASSES: readonly (readonly [number, string, string])[] = [
  [0.05, "var(--viz-grid)", "menos del 5 %"],
  [0.2, "var(--viz-1)", "5–20 %"],
  [0.5, "var(--viz-2)", "20–50 %"],
  [0.8, "var(--viz-4)", "50–80 %"],
  [Number.POSITIVE_INFINITY, "var(--viz-5)", "80 % o más"],
];
function omissionFill(omission: number): string {
  return (OMISSION_CLASSES.find(([limit]) => omission < limit) ?? OMISSION_CLASSES[4])?.[1] ?? "var(--viz-5)";
}

// --- 2. Anillo radial ------------------------------------------------------

export interface RingTag {
  readonly tagId: string;
  /** `null` si nadie pasó por el punto: no es 0 %, es que no hay pasadas. */
  readonly omission: number | null;
  readonly passes: number;
  readonly pattern: string;
  readonly zone: string | null;
  readonly isAnchor: boolean;
}

export interface RingMark {
  readonly tagId: string;
  readonly label: string;
  /** Declarado en lista (dato de planta) frente a candidato por firma (R-GRA-007). */
  readonly declared: boolean;
}

export interface RingData {
  readonly tags: readonly RingTag[];
  readonly anchorTagId: string;
  readonly anchorDeclared: boolean;
  readonly marks: readonly RingMark[];
  readonly junctions: readonly { readonly laneId: string; readonly tagId: string; readonly served: boolean }[];
}

function isEmptyZone(zone: string): boolean {
  return zone.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().startsWith("vac");
}

/**
 * El anillo entero de un vistazo: dónde se concentra la omisión, qué zona es cuál, dónde están los
 * puntos críticos y de dónde cuelgan las calles. El ángulo es **orden**, no distancia.
 */
export function ringChart(data: RingData): HTMLElement {
  const wrapper = figure(
    "Anillo del circuito",
    `Omisión por pasada de cada uno de los ${data.tags.length} tags, empezando arriba en el ancla y ` +
      "siguiendo el sentido de marcha. El ángulo es orden en el anillo, no distancia: el dato no " +
      "tiene geometría. Lo normal queda en gris; solo se colorea lo que falta.",
  );
  const area = host();
  const line = readout("Toca o pasa el puntero por el anillo para leer un tag.");
  const hasZones = data.tags.some((tag) => tag.zone !== null);
  const zoneNames = [...new Set(data.tags.map((tag) => tag.zone).filter((zone): zone is string => zone !== null))];

  const marks = data.marks.map((mark, index) => ({ ...mark, number: String(index + 1) }));
  const markByTag = new Map(marks.map((mark) => [mark.tagId, mark]));
  const indexOf = new Map(data.tags.map((tag, index) => [tag.tagId, index]));

  responsive(area, (width) => {
    area.replaceChildren();
    const size = Math.min(width, 520);
    const small = size < 420;
    const center = size / 2;
    const rMark = center - (small ? 10 : 13);
    const rZoneOut = rMark - (small ? 13 : 16);
    const rZoneIn = rZoneOut - 6;
    const rOut = hasZones ? rZoneIn - 5 : rZoneOut;
    const rIn = rOut - (small ? 16 : 24);
    const count = data.tags.length;
    const step = (2 * Math.PI) / Math.max(1, count);
    const start = -Math.PI / 2;
    const gap = Math.min(step * 0.3, 1.5 / rOut);

    const canvas = svg("svg", {
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      role: "img",
      "aria-label": `Anillo de ${count} tags coloreado por omisión por pasada`,
    });
    canvas.append(hatchPattern());

    data.tags.forEach((tag, index) => {
      const from = start + index * step + gap / 2;
      const to = start + (index + 1) * step - gap / 2;
      if (hasZones && tag.zone !== null) {
        canvas.append(
          svg("path", {
            d: arcPath(center, center, rZoneIn, rZoneOut, from, to),
            fill: isEmptyZone(tag.zone) ? HATCH_FILL : "var(--viz-neutral)",
          }),
        );
      }
      const fill = tag.isAnchor ? "var(--ink)" : tag.omission === null ? HATCH_FILL : omissionFill(tag.omission);
      canvas.append(svg("path", { d: arcPath(center, center, rIn, rOut, from, to), fill, "data-index": index }));
    });

    // Calles: un ramal hacia dentro por calle, desde el tag del que cuelga. Hueco si nadie entró.
    const byJunction = new Map<string, (typeof data.junctions)[number][]>();
    for (const junction of data.junctions) byJunction.set(junction.tagId, [...(byJunction.get(junction.tagId) ?? []), junction]);
    for (const [tagId, lanes] of byJunction) {
      const position = indexOf.get(tagId);
      if (position === undefined) continue;
      const angle = start + (position + 0.5) * step;
      lanes.forEach((lane, k) => {
        const spread = angle + (k - (lanes.length - 1) / 2) * 0.07;
        const length = small ? 18 : 26;
        const x0 = center + (rIn - 3) * Math.cos(angle);
        const y0 = center + (rIn - 3) * Math.sin(angle);
        const x1 = center + (rIn - 3 - length) * Math.cos(spread);
        const y1 = center + (rIn - 3 - length) * Math.sin(spread);
        canvas.append(svg("line", { x1: x0, y1: y0, x2: x1, y2: y1, stroke: "var(--muted)", "stroke-width": 1.5 }));
        canvas.append(
          svg("circle", {
            cx: x1,
            cy: y1,
            r: 3.5,
            fill: lane.served ? "var(--ink)" : "var(--panel)",
            stroke: "var(--ink)",
            "stroke-width": 1.2,
            "data-lane": lane.laneId,
          }),
        );
      });
    }

    // Puntos marcados, por fuera: relleno si está declarado, hueco si es candidato por firma.
    for (const mark of marks) {
      const position = indexOf.get(mark.tagId);
      if (position === undefined) continue;
      const angle = start + (position + 0.5) * step;
      const x = center + rMark * Math.cos(angle);
      const y = center + rMark * Math.sin(angle);
      const radius = small ? 7.5 : 9;
      canvas.append(svg("circle", { cx: x, cy: y, r: radius + 2, fill: "var(--panel)" }));
      canvas.append(
        svg("circle", {
          cx: x,
          cy: y,
          r: radius,
          fill: mark.declared ? "var(--ink)" : "var(--panel)",
          stroke: "var(--ink)",
          "stroke-width": 1.5,
          "data-mark": mark.tagId,
        }),
      );
      canvas.append(
        text(x, y + 3.5, mark.number, mark.declared ? "on-ink" : "value", {
          "text-anchor": "middle",
          "pointer-events": "none",
        }),
      );
    }

    canvas.append(text(center, center - 4, String(count), "big", { "text-anchor": "middle" }));
    canvas.append(text(center, center + 16, "tags en el anillo", "label", { "text-anchor": "middle" }));
    canvas.append(
      text(center, center + 33, `ancla ${data.anchorTagId} · ${data.anchorDeclared ? "declarada" : "inferida"}`, "axis", {
        "text-anchor": "middle",
      }),
    );

    inspect(
      canvas,
      (point) => {
        if (point === null) {
          line.show(null);
          return;
        }
        const target = point.target as SVGElement;
        const index = target.getAttribute("data-index");
        const markTag = target.getAttribute("data-mark");
        const laneId = target.getAttribute("data-lane");
        if (index !== null) {
          const tag = data.tags[Number(index)];
          if (tag === undefined) return;
          const where = `Tag ${tag.tagId} · posición ${Number(index) + 1} de ${count}` + (tag.zone === null ? "" : ` · zona ${tag.zone}`);
          line.show(
            tag.isAnchor
              ? `${where} — ancla de la vuelta: su tasa es 1 por construcción y no es evidencia de nada`
              : tag.omission === null
                ? `${where} — nadie pasó por este punto: sin pasadas no hay tasa`
                : `${where} — ${percent(tag.omission)} de omisión en ${tag.passes} pasadas · ${tag.pattern}`,
          );
        } else if (markTag !== null) {
          const mark = markByTag.get(markTag);
          if (mark !== undefined) {
            line.show(
              `${mark.number} · Tag ${mark.tagId} — ${mark.label}, ` +
                (mark.declared ? "declarado en lista (dato de planta)" : "candidato por firma, para confirmar o descartar (R-GRA-007)"),
            );
          }
        } else if (laneId !== null) {
          const lane = data.junctions.find((entry) => entry.laneId === laneId);
          line.show(`Calle «${laneId}» — ${lane?.served === false ? "nadie entró en toda la ventana" : "cuelga de este punto del anillo"}`);
        } else {
          line.show(null);
        }
      },
      { snap: "[data-index],[data-mark],[data-lane]" },
    );
    area.append(canvas);
  });

  wrapper.append(area, line.node);
  wrapper.append(
    legendList([
      ...OMISSION_CLASSES.map(([, fill, label]) => [fill, `omisión ${label}`] as const),
      [HATCH_SWATCH, "sin pasadas"],
      ["var(--ink)", "ancla"],
    ]),
  );
  if (hasZones) {
    wrapper.append(
      legendList(zoneNames.map((zone) => [isEmptyZone(zone) ? HATCH_SWATCH : "var(--viz-neutral)", `banda exterior: zona ${zone}`] as const)),
    );
  }
  if (marks.length > 0) {
    const list = document.createElement("ol");
    list.className = "ring-marks";
    for (const mark of marks) {
      const item = document.createElement("li");
      const badge = document.createElement("span");
      badge.className = mark.declared ? "mark declared" : "mark";
      badge.textContent = mark.number;
      const id = document.createElement("span");
      id.className = "mono";
      id.textContent = mark.tagId;
      const label = document.createElement("span");
      label.textContent = `${mark.label} · ${mark.declared ? "declarado" : "candidato"}`;
      item.append(badge, id, label);
      list.append(item);
    }
    wrapper.append(list);
  }
  // Su tabla equivalente es la lista ordenada del anillo que `main.ts` pone justo debajo, plegada:
  // repetirla aquí sería la misma tabla dos veces.
  return wrapper;
}

// --- 3. Mapa de calor tag × AGV --------------------------------------------

function parseColor(value: string): [number, number, number] {
  const hex = value.trim().replace("#", "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const n = Number.parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const match = value.match(/\d+(\.\d+)?/g);
  if (match !== null && match.length >= 3) return [Number(match[0]), Number(match[1]), Number(match[2])];
  return [128, 128, 128];
}

/** Rampa continua de omisión sobre los mismos tokens de la aplicación: lo normal, casi el fondo. */
function omissionScale(): (omission: number) => string {
  const style = getComputedStyle(document.documentElement);
  const stops: readonly (readonly [number, [number, number, number]])[] = [
    [0, parseColor(style.getPropertyValue("--viz-grid"))],
    [0.05, parseColor(style.getPropertyValue("--viz-1"))],
    [0.25, parseColor(style.getPropertyValue("--viz-2"))],
    [0.5, parseColor(style.getPropertyValue("--viz-3"))],
    [0.75, parseColor(style.getPropertyValue("--viz-4"))],
    [1, parseColor(style.getPropertyValue("--viz-5"))],
  ];
  return (omission) => {
    for (let k = 1; k < stops.length; k += 1) {
      const [p1, c1] = stops[k] as readonly [number, [number, number, number]];
      if (omission <= p1) {
        const [p0, c0] = stops[k - 1] as readonly [number, [number, number, number]];
        const t = (omission - p0) / (p1 - p0);
        return `rgb(${c0.map((channel, q) => Math.round(channel + ((c1[q] as number) - channel) * t)).join(",")})`;
      }
    }
    const last = stops[stops.length - 1] as readonly [number, [number, number, number]];
    return `rgb(${last[1].join(",")})`;
  };
}

function canvasHatch(context: CanvasRenderingContext2D): CanvasPattern | string {
  const tile = document.createElement("canvas");
  tile.width = 6;
  tile.height = 6;
  const pen = tile.getContext("2d");
  const style = getComputedStyle(document.documentElement);
  if (pen === null) return style.getPropertyValue("--viz-empty");
  pen.fillStyle = style.getPropertyValue("--panel");
  pen.fillRect(0, 0, 6, 6);
  pen.strokeStyle = style.getPropertyValue("--viz-empty");
  pen.lineWidth = 1.4;
  pen.beginPath();
  pen.moveTo(0, 6);
  pen.lineTo(6, 0);
  pen.moveTo(-1, 1);
  pen.lineTo(1, -1);
  pen.moveTo(5, 7);
  pen.lineTo(7, 5);
  pen.stroke();
  return context.createPattern(tile, "repeat") ?? style.getPropertyValue("--viz-empty");
}

/**
 * La matriz tag × AGV pintando **lo que falta**: la omisión por pasada. Lo sano se funde con el
 * fondo y un tag que unos vehículos no leen nunca salta como una fila con unas pocas celdas oscuras.
 * Los márgenes dicen si el problema es del tag (fila) o del vehículo (columna).
 *
 * `flaggedTags` y `flaggedVehicles` son los que la matriz ya destacó con su configuración: el color
 * de atención no introduce ningún umbral nuevo.
 */
export function readMatrixHeatmap(
  matrix: Matrix,
  flaggedTags: ReadonlySet<string>,
  flaggedVehicles: ReadonlySet<string>,
): HTMLElement {
  const wrapper = figure(
    "Mapa de omisión tag × AGV",
    "Omisión por pasada de cada tag (filas) para cada vehículo (columnas). Margen superior: omisión " +
      "de cada AGV en todo lo que pasa; margen derecho: de cada tag en toda la flota. En naranja, lo " +
      "que la matriz ya destaca. La trama es que ese vehículo no pasó por ese punto, que no es un 0 %.",
  );
  const toolbar = document.createElement("div");
  toolbar.className = "seg";
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Orden de las filas");
  const byRing = document.createElement("button");
  byRing.type = "button";
  byRing.textContent = "Orden del anillo";
  const byWorst = document.createElement("button");
  byWorst.type = "button";
  byWorst.textContent = "Peor omisión primero";
  toolbar.append(byRing, byWorst);

  const area = host();
  const line = readout("Toca o pasa el puntero por la matriz para leer una celda.");
  const vehicles = matrix.vehicles.map((vehicle) => vehicle.agvId);
  const cellsByTag = new Map(matrix.tags.map((tag) => [tag.tagId, new Map(tag.byVehicle.map((cell) => [cell.agvId, cell]))]));
  let order: "ring" | "worst" = "ring";

  const redraw = responsive(area, (width) => {
    area.replaceChildren();
    const rows =
      order === "ring"
        ? matrix.tags
        : [...matrix.tags].sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1) || a.position - b.position);
    const narrow = width < 600;
    const left = 48;
    const right = narrow ? 44 : 66;
    const top = 44;
    const bottom = 22;
    const columns = Math.max(1, vehicles.length);
    const cellWidth = Math.max(3, Math.floor(((width - left - right - 6) / columns) * 10) / 10);
    const rowHeight = rows.length > 220 ? 2 : narrow ? 3 : 4;
    const gridWidth = cellWidth * columns;
    const gridHeight = rows.length * rowHeight;
    const totalWidth = Math.min(width, left + gridWidth + 6 + right);
    const totalHeight = top + gridHeight + bottom;
    const ratio = window.devicePixelRatio || 1;

    const layer = (): HTMLCanvasElement => {
      const node = document.createElement("canvas");
      node.width = Math.round(totalWidth * ratio);
      node.height = Math.round(totalHeight * ratio);
      node.style.width = `${totalWidth}px`;
      node.style.height = `${totalHeight}px`;
      return node;
    };
    const base = layer();
    const overlay = layer();
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    base.setAttribute("role", "img");
    base.setAttribute("aria-label", `Mapa de omisión de ${rows.length} tags por ${columns} vehículos`);
    area.style.height = `${totalHeight}px`;
    area.append(base, overlay);

    const context = base.getContext("2d");
    const pointer = overlay.getContext("2d");
    if (context === null || pointer === null) return;
    context.scale(ratio, ratio);
    pointer.scale(ratio, ratio);
    const style = getComputedStyle(document.documentElement);
    const color = omissionScale();
    const hatch = canvasHatch(context);
    const accent = style.getPropertyValue("--viz-accent");
    const neutral = style.getPropertyValue("--viz-neutral");
    const ink = style.getPropertyValue("--ink");
    const muted = style.getPropertyValue("--muted");
    const inset = (size: number): number => (size > 5 ? size - 1 : size);

    rows.forEach((tag, r) => {
      const y = top + r * rowHeight;
      const cells = cellsByTag.get(tag.tagId);
      vehicles.forEach((agvId, j) => {
        const cell = cells?.get(agvId);
        context.fillStyle =
          cell === undefined || cell.passes === 0 ? hatch : tag.isAnchor ? style.getPropertyValue("--viz-grid") : color(1 - cell.hits / cell.passes);
        context.fillRect(left + j * cellWidth, y, inset(cellWidth), rowHeight > 3 ? rowHeight - 1 : rowHeight);
      });
      if (tag.rate !== null && !tag.isAnchor) {
        context.fillStyle = flaggedTags.has(tag.tagId) ? accent : neutral;
        context.fillRect(left + gridWidth + 6, y, Math.max(0.5, (right - 22) * (1 - tag.rate)), rowHeight > 3 ? rowHeight - 1 : rowHeight);
      }
    });

    const barSpace = top - 20;
    matrix.vehicles.forEach((vehicle, j) => {
      if (vehicle.rate === null) return;
      const omission = 1 - vehicle.rate;
      const height = Math.max(1, barSpace * Math.min(1, omission * 2));
      context.fillStyle = flaggedVehicles.has(vehicle.agvId) ? accent : neutral;
      context.fillRect(left + j * cellWidth, top - 6 - height, inset(cellWidth), height);
    });

    context.font = "10px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
    context.fillStyle = muted;
    context.textAlign = "right";
    rows.forEach((tag, r) => {
      if (r % 10 === 0) context.fillText(tag.tagId, left - 5, top + r * rowHeight + rowHeight + 3);
    });
    context.textAlign = "center";
    const every = Math.max(1, Math.ceil(40 / cellWidth));
    for (let j = 0; j < columns; j += every) context.fillText(vehicles[j] ?? "", left + j * cellWidth + cellWidth / 2, top + gridHeight + 15);
    context.textAlign = "left";
    context.fillText("tag", left + gridWidth + 6, top - 8);
    context.fillText("AGV", 0, top - 8);

    inspect(
      overlay,
      (point) => {
        if (point === null) {
          pointer.clearRect(0, 0, totalWidth, totalHeight);
          line.show(null);
          return;
        }
        const box = overlay.getBoundingClientRect();
        const x = point.clientX - box.left;
        const y = point.clientY - box.top;
        const j = Math.floor((x - left) / cellWidth);
        const r = Math.floor((y - top) / rowHeight);
        pointer.clearRect(0, 0, totalWidth, totalHeight);
        const tag = rows[r];
        const agvId = vehicles[j];
        if (tag === undefined || agvId === undefined || j < 0 || r < 0) {
          line.show(null);
          return;
        }
        pointer.strokeStyle = ink;
        pointer.lineWidth = 1;
        pointer.strokeRect(left - 0.5, top + r * rowHeight - 0.5, gridWidth + 1, rowHeight + 1);
        pointer.strokeRect(left + j * cellWidth - 0.5, top - 0.5, cellWidth + 1, gridHeight + 1);
        const cell = cellsByTag.get(tag.tagId)?.get(agvId);
        line.show(
          `Tag ${tag.tagId} × AGV ${agvId} — ` +
            (cell === undefined || cell.passes === 0
              ? "no pasó por este punto: no es un 0 %"
              : tag.isAnchor
                ? "ancla: su tasa es 1 por construcción"
                : `${percent(1 - cell.hits / cell.passes)} de omisión, ${cell.passes - cell.hits} de ${cell.passes} pasadas sin leer`) +
            (tag.rate === null ? "" : ` · el tag en la flota: ${percent(1 - tag.rate)}`),
        );
      },
    );
  });

  const setOrder = (next: "ring" | "worst"): void => {
    order = next;
    byRing.setAttribute("aria-pressed", String(next === "ring"));
    byWorst.setAttribute("aria-pressed", String(next === "worst"));
    redraw();
  };
  byRing.addEventListener("click", () => setOrder("ring"));
  byWorst.addEventListener("click", () => setOrder("worst"));
  byRing.setAttribute("aria-pressed", "true");
  byWorst.setAttribute("aria-pressed", "false");

  wrapper.append(toolbar, area, line.node);
  wrapper.append(
    legendList([
      ["var(--viz-grid)", "sin omisión"],
      ["var(--viz-2)", "intermedia"],
      ["var(--viz-5)", "omisión total"],
      [HATCH_SWATCH, "no pasó por ese punto"],
      ["var(--viz-accent)", "destacado por la matriz"],
    ]),
  );
  return wrapper;
}

// --- 4. Rotura y degradación en pequeños múltiplos -------------------------

export interface TrendPanel {
  readonly who: "Tag" | "AGV";
  readonly id: string;
  readonly kind: "rotura" | "degradación";
  readonly series: { readonly fromUtcMs: number; readonly binWidthMs: number; readonly rates: readonly (number | null)[] };
  readonly changedAtUtcMs?: number;
  readonly segmentRates?: readonly number[];
}

/**
 * Un panel por tag o vehículo con tendencia, todos con el mismo eje: la rotura se ve como escalón y
 * la degradación como rampa. El puntero lee la misma hora en todos a la vez.
 */
export function trendMultiplesChart(panels: readonly TrendPanel[], formats: Formats): HTMLElement {
  const wrapper = figure(
    "Rotura y degradación, en el tiempo",
    "Tasa de lectura por pasada a lo largo de la ventana. Todos los paneles comparten eje vertical " +
      "(0–100 %) y horizontal. Un tramo sin pasadas se deja en blanco: no es un 0 %.",
  );
  const area = host();
  area.classList.add("multiples");
  const line = readout("Toca o pasa el puntero por un panel: todos marcan el mismo instante.");
  const from = Math.min(...panels.map((panel) => panel.series.fromUtcMs));
  const to = Math.max(...panels.map((panel) => panel.series.fromUtcMs + panel.series.binWidthMs * panel.series.rates.length));
  const rateAt = (panel: TrendPanel, utcMs: number): number | null => {
    const index = Math.floor((utcMs - panel.series.fromUtcMs) / panel.series.binWidthMs);
    return index < 0 || index >= panel.series.rates.length ? null : (panel.series.rates[index] ?? null);
  };

  responsive(area, (width) => {
    area.replaceChildren();
    const columns = width >= 900 ? 3 : width >= 540 ? 2 : 1;
    const gapPx = 14;
    area.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    const panelWidth = Math.floor((width - gapPx * (columns - 1)) / columns);
    const height = 124;
    const margin = { left: 34, right: 10, top: 10, bottom: 22 };
    const innerWidth = panelWidth - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const x = (utcMs: number): number => margin.left + ((utcMs - from) / Math.max(1, to - from)) * innerWidth;
    const y = (rate: number): number => margin.top + (1 - rate) * innerHeight;
    const cursors: { readonly cross: SVGLineElement; readonly dot: SVGCircleElement; readonly panel: TrendPanel }[] = [];

    for (const panel of panels) {
      const box = document.createElement("div");
      box.className = "panel";
      const title = document.createElement("p");
      title.className = "panel-title";
      const id = document.createElement("span");
      id.className = "mono";
      id.textContent = `${panel.who} ${panel.id}`;
      const kind = document.createElement("span");
      kind.className = "chip attn";
      kind.textContent = panel.kind;
      title.append(id, kind);
      const canvas = svg("svg", { width: panelWidth, height, viewBox: `0 0 ${panelWidth} ${height}`, role: "img", "aria-label": `${panel.who} ${panel.id}: ${panel.kind}` });
      for (const value of [0, 0.5, 1]) {
        canvas.append(svg("line", { x1: margin.left, x2: margin.left + innerWidth, y1: y(value), y2: y(value), stroke: value === 0 ? "var(--line)" : "var(--viz-grid)" }));
        canvas.append(text(margin.left - 5, y(value) + 3.5, value === 1 ? "100 %" : value === 0 ? "0" : "50", "axis", { "text-anchor": "end" }));
      }
      canvas.append(text(margin.left, height - 5, formats.tick(from), "axis"));
      canvas.append(text(margin.left + innerWidth, height - 5, formats.tick(to), "axis", { "text-anchor": "end" }));

      // Un trazo por tramo contiguo con pasadas: un tramo vacío corta la línea, no la lleva a cero.
      let segment: string[] = [];
      const flush = (): void => {
        if (segment.length === 0) return;
        const first = segment[0] as string;
        const last = segment[segment.length - 1] as string;
        const firstX = first.split(" ")[0] as string;
        const lastX = last.split(" ")[0] as string;
        canvas.append(svg("path", { d: `M${firstX} ${y(0)}L${segment.join("L")}L${lastX} ${y(0)}Z`, fill: "var(--viz-series)", "fill-opacity": 0.1 }));
        canvas.append(svg("path", { d: `M${segment.join("L")}`, fill: "none", stroke: "var(--viz-series)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        segment = [];
      };
      panel.series.rates.forEach((rate, index) => {
        if (rate === null) {
          flush();
          return;
        }
        const center = panel.series.fromUtcMs + (index + 0.5) * panel.series.binWidthMs;
        segment.push(`${x(center).toFixed(1)} ${y(rate).toFixed(1)}`);
      });
      flush();

      if (panel.kind === "rotura" && panel.changedAtUtcMs !== undefined) {
        const px = x(panel.changedAtUtcMs);
        canvas.append(svg("line", { x1: px, x2: px, y1: margin.top - 2, y2: margin.top + innerHeight, stroke: "var(--viz-accent)", "stroke-width": 1.5 }));
        const anchor = px > panelWidth - 90 ? "end" : "start";
        canvas.append(text(px + (anchor === "start" ? 5 : -5), margin.top + 10, `≈ ${formats.tick(panel.changedAtUtcMs)}`, "value", { "text-anchor": anchor }));
      } else if (panel.segmentRates !== undefined && panel.segmentRates.length > 1) {
        const first = panel.segmentRates[0] as number;
        const last = panel.segmentRates[panel.segmentRates.length - 1] as number;
        canvas.append(text(margin.left + innerWidth - 4, y(Math.max(last, 0.12)) - 8, `${percent(first)} → ${percent(last)}`, "value", { "text-anchor": "end" }));
      }
      const cross = svg("line", { y1: margin.top, y2: margin.top + innerHeight, stroke: "var(--ink)", visibility: "hidden" });
      const dot = svg("circle", { r: 4, fill: "var(--panel)", stroke: "var(--ink)", "stroke-width": 2, visibility: "hidden" });
      canvas.append(cross, dot);
      cursors.push({ cross, dot, panel });

      inspect(
        canvas,
        (point) => {
          if (point === null) {
            for (const cursor of cursors) {
            cursor.cross.setAttribute("visibility", "hidden");
            cursor.dot.setAttribute("visibility", "hidden");
            }
            line.show(null);
            return;
          }
          const bounds = canvas.getBoundingClientRect();
          const at = from + ((point.clientX - bounds.left - margin.left) / innerWidth) * (to - from);
          if (at < from || at > to) return;
          const parts: string[] = [];
          for (const cursor of cursors) {
            const rate = rateAt(cursor.panel, at);
            cursor.cross.setAttribute("x1", String(x(at)));
            cursor.cross.setAttribute("x2", String(x(at)));
            cursor.cross.setAttribute("visibility", "visible");
            cursor.dot.setAttribute("visibility", rate === null ? "hidden" : "visible");
            if (rate !== null) {
              cursor.dot.setAttribute("cx", String(x(at)));
              cursor.dot.setAttribute("cy", String(y(rate)));
            }
            parts.push(`${cursor.panel.who} ${cursor.panel.id} ${rate === null ? "sin pasadas" : percent(rate)}`);
          }
          line.show(`${formats.instant(at)} — ${parts.join(" · ")}`);
        },
      );
      box.append(title, canvas);
      area.append(box);
    }
  });

  wrapper.append(area, line.node);
  wrapper.append(
    table(
      ["Objeto", "Cambio", "Instante o tramos"],
      panels.map((panel) => [
        `${panel.who} ${panel.id}`,
        panel.kind,
        panel.changedAtUtcMs !== undefined
          ? formats.instant(panel.changedAtUtcMs)
          : (panel.segmentRates ?? []).map((rate) => percent(rate)).join(" → "),
      ]),
    ),
  );
  return wrapper;
}

// --- 5. Distribución de permanencias ---------------------------------------

export interface DwellRow {
  readonly title: string;
  readonly detail: string;
  readonly note: string;
  readonly durationsMs: readonly number[];
  /** La fila de referencia se pinta en neutro: es contexto, no hallazgo. */
  readonly isReference: boolean;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] as number;
}

const NICE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/**
 * El tiempo hasta la siguiente lectura, en tramos iguales y en proporción de pasadas, con el mismo
 * eje para todas las filas: estrecha y desplazada es una parada precisa; dos montañas, un semáforo.
 */
export function dwellChart(rows: readonly DwellRow[]): HTMLElement {
  const wrapper = figure(
    "Permanencia en los candidatos de tiempo",
    "Tiempo desde la lectura del tag hasta la siguiente, en proporción de sus pasadas. Mismo eje y " +
      "misma escala en todas las filas; los pares en el mismo instante no entran (R-DAT-013). Es la " +
      "firma, nunca la función asignada (R-GRA-007).",
  );
  const area = host();
  const line = readout("Toca o pasa el puntero por una columna para leer su recuento.");
  const BINS = 40;
  const candidates = rows.filter((row) => !row.isReference);
  const basis = (candidates.length > 0 ? candidates : rows).map((row) => quantile([...row.durationsMs].sort((a, b) => a - b), 0.98));
  const maxMs = Math.max(10_000, ...basis) * 1.15;
  const binMs = maxMs / BINS;
  const histograms = rows.map((row) => {
    const counts = new Array<number>(BINS).fill(0);
    let beyond = 0;
    for (const value of row.durationsMs) {
      if (value >= maxMs) beyond += 1;
      else counts[Math.floor(value / binMs)] = (counts[Math.floor(value / binMs)] ?? 0) + 1;
    }
    return { counts, beyond, total: Math.max(1, row.durationsMs.length) };
  });
  const maxShare = Math.max(0.0001, ...histograms.flatMap((h) => h.counts.map((count) => count / h.total)));
  const stepSeconds = NICE_SECONDS.find((value) => maxMs / 1000 / value <= 6) ?? 3600;

  responsive(area, (width) => {
    area.replaceChildren();
    const rowHeight = 88;
    const plotHeight = 50;
    const axisHeight = 24;
    const height = rows.length * rowHeight + axisHeight;
    const wide = width >= 560;
    const canvas = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Distribución de permanencias" });
    const x = (ms: number): number => (ms / maxMs) * width;
    const barWidth = width / BINS;
    rows.forEach((row, r) => {
      const top = r * rowHeight;
      const base = top + 26 + plotHeight;
      canvas.append(text(0, top + 13, row.title, "label id"));
      if (wide) canvas.append(text(width, top + 13, row.note, "axis", { "text-anchor": "end" }));
      canvas.append(text(0, top + 25, wide ? row.detail : `${row.detail} · ${row.note}`, "axis"));
      for (let tick = 0; tick * stepSeconds * 1000 <= maxMs; tick += 1) {
        const px = x(tick * stepSeconds * 1000);
        canvas.append(svg("line", { x1: px, x2: px, y1: top + 30, y2: base, stroke: "var(--viz-grid)" }));
      }
      canvas.append(svg("line", { x1: 0, x2: width, y1: base, y2: base, stroke: "var(--line)" }));
      const histogram = histograms[r];
      if (histogram === undefined) return;
      histogram.counts.forEach((count, bin) => {
        if (count === 0) return;
        const barHeight = Math.max(1, (count / histogram.total / maxShare) * (plotHeight - 4));
        const w = Math.max(1, Math.min(24, barWidth - 2));
        canvas.append(
          svg("rect", {
            x: bin * barWidth + (barWidth - w) / 2,
            y: base - barHeight,
            width: w,
            height: barHeight,
            rx: Math.min(1.5, w / 2),
            fill: row.isReference ? "var(--viz-neutral)" : "var(--viz-series)",
            "data-k": `${r}:${bin}`,
          }),
        );
      });
    });
    const axisY = rows.length * rowHeight + 14;
    for (let tick = 0; tick * stepSeconds * 1000 <= maxMs; tick += 1) {
      const px = x(tick * stepSeconds * 1000);
      const anchor = px < 20 ? "start" : px > width - 30 ? "end" : "middle";
      canvas.append(text(px, axisY, stepSeconds >= 60 ? `${(tick * stepSeconds) / 60} min` : `${tick * stepSeconds} s`, "axis", { "text-anchor": anchor }));
    }
    inspect(
      canvas,
      (point) => {
        if (point === null) {
          line.show(null);
          return;
        }
        const key = (point.target as SVGElement).getAttribute("data-k");
        if (key === null) {
          line.show(null);
          return;
        }
        const [r, bin] = key.split(":").map(Number) as [number, number];
        const row = rows[r];
        const count = histograms[r]?.counts[bin] ?? 0;
        if (row === undefined) return;
        line.show(`${row.title} — entre ${seconds(bin * binMs)} y ${seconds((bin + 1) * binMs)}: ${count} pasadas (${percent(count / (histograms[r]?.total ?? 1))})`);
      },
      { snap: "[data-k]" },
    );
    area.append(canvas);
  });

  wrapper.append(area, line.node);
  const beyondNotes = rows
    .map((row, r) => ({ row, beyond: histograms[r]?.beyond ?? 0 }))
    .filter((entry) => entry.beyond > 0)
    .map((entry) => `${entry.row.title}: ${entry.beyond} por encima de ${seconds(maxMs)}`);
  if (beyondNotes.length > 0) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `Fuera del eje, sin dibujar: ${beyondNotes.join(" · ")}.`;
    wrapper.append(note);
  }
  wrapper.append(
    table(
      ["Fila", "Muestras", "Resumen"],
      rows.map((row) => [row.title, String(row.durationsMs.length), `${row.detail} · ${row.note}`]),
    ),
  );
  return wrapper;
}

// --- 6. Horquilla: cruce o bifurcación -------------------------------------

export interface ForkData {
  readonly tagId: string;
  readonly kind: "bifurcacion" | "cruce";
  readonly support: number;
  readonly branches: readonly { readonly tagId: string; readonly support: number; readonly share: number }[];
  readonly reconvergesAt?: string;
  readonly hops?: number;
}

/**
 * Las salidas de un tag con reparto: el grosor es la cuota de cada rama. En un cruce las ramas
 * vuelven a juntarse dentro del margen; en una bifurcación, no. La diferencia se ve.
 */
export function forkChart(forks: readonly ForkData[], maxHops: number): HTMLElement {
  const wrapper = figure(
    "Salidas de los tags con reparto",
    "El grosor de cada rama es su cuota de pasadas. La mayoritaria va recta; las demás, por arriba. " +
      "Candidatos por firma, nunca función asignada (R-GRA-007).",
  );
  const area = host();
  area.classList.add("forks");
  const line = readout("Toca o pasa el puntero por una rama para leer su soporte.");

  responsive(area, (width) => {
    area.replaceChildren();
    const columns = width >= 640 ? 2 : 1;
    area.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    const cardWidth = Math.floor((width - (columns - 1) * 24) / columns);
    for (const fork of forks) {
      const card = document.createElement("div");
      card.className = "fork";
      const heading = document.createElement("p");
      heading.className = "panel-title";
      const id = document.createElement("span");
      id.className = "mono";
      id.textContent = fork.tagId;
      const kind = document.createElement("span");
      kind.className = "chip";
      kind.textContent = fork.kind === "cruce" ? "candidato a cruce" : "candidato a bifurcación";
      heading.append(id, kind);

      const height = 150;
      const canvas = svg("svg", { width: cardWidth, height, viewBox: `0 0 ${cardWidth} ${height}`, role: "img", "aria-label": `Salidas de ${fork.tagId}` });
      const xs = 22;
      const xe = cardWidth - 22;
      const yb = 108;
      const shown = fork.branches.slice(0, 3);
      const bend = Math.min(60, (xe - xs) * 0.18);
      const tops = [44, 70];
      const paths: { d: string; branch: (typeof shown)[number] }[] = [];
      shown.forEach((branch, k) => {
        if (k === 0) {
          paths.push({ d: `M${xs} ${yb}L${xe} ${yb}`, branch });
          return;
        }
        const yt = tops[k - 1] ?? 44;
        const end = fork.kind === "cruce" ? `C${xe - bend * 0.4} ${yt} ${xe - bend * 0.6} ${yb} ${xe} ${yb}` : `L${xe} ${yt}`;
        paths.push({
          d: `M${xs} ${yb}C${xs + bend * 0.6} ${yb} ${xs + bend * 0.4} ${yt} ${xs + bend} ${yt}L${xe - bend} ${yt}${end}`,
          branch,
        });
      });
      [...paths].reverse().forEach(({ d, branch }, reversedIndex) => {
        const k = paths.length - 1 - reversedIndex;
        canvas.append(
          svg("path", {
            d,
            fill: "none",
            stroke: k === 0 ? "var(--viz-series)" : "var(--viz-1)",
            "stroke-width": 3 + branch.share * 22,
            "stroke-linejoin": "round",
          }),
        );
      });
      paths.forEach(({ d }, k) => canvas.append(svg("path", { d, fill: "none", stroke: "transparent", "stroke-width": 22, "pointer-events": "stroke", "data-k": k })));
      shown.forEach((branch, k) => {
        const yt = k === 0 ? yb : (tops[k - 1] ?? 44);
        const px = xs + bend + 16;
        canvas.append(svg("circle", { cx: px, cy: yt, r: 4, fill: "var(--ink)", stroke: "var(--panel)", "stroke-width": 2, "pointer-events": "none" }));
        canvas.append(text(px + 8, k === 0 ? yt + 20 : yt - 10, `${branch.tagId} · ${percent(branch.share)}`, "label id", { "pointer-events": "none" }));
      });
      canvas.append(svg("circle", { cx: xs, cy: yb, r: 6, fill: "var(--ink)", stroke: "var(--panel)", "stroke-width": 2 }));
      canvas.append(text(xs - 2, yb + 34, fork.tagId, "label id"));
      if (fork.kind === "cruce") {
        canvas.append(svg("circle", { cx: xe, cy: yb, r: 6, fill: "var(--ink)", stroke: "var(--panel)", "stroke-width": 2 }));
        canvas.append(text(xe + 2, yb + 34, fork.reconvergesAt ?? "", "label id", { "text-anchor": "end" }));
      } else {
        // Sin punto común dentro del margen: cada rama termina abierta, sin nodo de llegada compartido.
        for (const k of shown.keys()) {
          const yt = k === 0 ? yb : (tops[k - 1] ?? 44);
          canvas.append(svg("circle", { cx: xe, cy: yt, r: 4, fill: "var(--panel)", stroke: "var(--ink)", "stroke-width": 1.5 }));
        }
      }
      inspect(
        canvas,
        (point) => {
          if (point === null) {
            line.show(null);
            return;
          }
          const key = (point.target as SVGElement).getAttribute("data-k");
          const branch = key === null ? undefined : shown[Number(key)];
          line.show(
            branch === undefined
              ? null
              : `${fork.tagId} → ${branch.tagId}: ${branch.support} de ${fork.support} pasadas (${percent(branch.share)})`,
          );
        },
        { snap: "[data-k]" },
      );

      const verdict = document.createElement("p");
      verdict.className = "muted";
      const extra = fork.branches.length > shown.length ? ` Hay ${fork.branches.length - shown.length} rama(s) más, en la tabla.` : "";
      verdict.textContent =
        (fork.kind === "cruce"
          ? fork.hops === 0
            ? `La rama minoritaria vuelve a «${fork.reconvergesAt ?? "?"}», el mismo tag al que va directa la mayoritaria, dentro del margen de ${maxHops} saltos: firma de cruce.`
            : `Las ramas vuelven a coincidir en «${fork.reconvergesAt ?? "?"}» a los ${fork.hops ?? "?"} salto(s), dentro del margen de ${maxHops}: firma de cruce.`
          : `Las ramas no vuelven a coincidir en ${maxHops} saltos: firma de bifurcación.`) + extra;
      card.append(heading, canvas, verdict);
      area.append(card);
    }
  });

  wrapper.append(area, line.node);
  wrapper.append(
    table(
      ["Tag", "Clase", "Rama", "Pasadas", "Cuota"],
      forks.flatMap((fork) =>
        fork.branches.map((branch) => [fork.tagId, fork.kind, branch.tagId, String(branch.support), percent(branch.share)]),
      ),
    ),
  );
  return wrapper;
}

// --- 7. Carriles de ocupación por calle ------------------------------------

type ChargingView = NonNullable<CircuitViews["charging"]>;
type LaneView = ChargingView["lanes"][number];
type StayView = LaneView["stayList"][number];

/**
 * La ocupación de cada calle a lo largo de la ventana: una barra por estancia, de la lectura de
 * entrada a la de salida, en tantas pistas como hagan falta. La calle sin servicio es un carril vacío
 * y lo que queda fuera de la cobertura lleva trama: no es una calle vacía (R-CO-007, R-DAT-007).
 */
export function laneOccupancyChart(
  lanes: readonly LaneView[],
  coverage: readonly { readonly from: number; readonly to: number }[],
  formats: Formats,
): HTMLElement {
  const wrapper = figure(
    "Ocupación de las calles de carga",
    "Una barra por estancia, de la lectura de entrada a la de salida. Naranja: esperó mientras otros " +
      "que entraron después salían antes; azul, esos otros. Un triángulo marca el extremo que no se " +
      "ve; si falta la entrada o la salida, solo se dibuja el extremo conocido, nunca una duración.",
  );
  const area = host();
  const line = readout("Toca o pasa el puntero por una estancia para leerla.");
  const allTimes = lanes.flatMap((lane) => lane.stayList.flatMap((stay) => [stay.enteredUtcMs, stay.leftUtcMs])).filter((value): value is number => value !== null);
  const covFrom = coverage.length > 0 ? Math.min(...coverage.map((span) => span.from)) : Math.min(...allTimes);
  const covTo = coverage.length > 0 ? Math.max(...coverage.map((span) => span.to)) : Math.max(...allTimes);
  const pad = (covTo - covFrom) * 0.025;
  const domainFrom = covFrom - pad;

  // Estancias destacadas: la del que esperó, y las de quienes entraron después y salieron antes.
  const role = new Map<StayView, "espera" | "cola">();
  for (const lane of lanes) {
    for (const breach of lane.outOfSeniority) {
      const waited = lane.stayList.find(
        (stay) =>
          stay.agvId === breach.waited &&
          stay.enteredUtcMs !== null &&
          stay.leftUtcMs !== null &&
          Math.abs(stay.leftUtcMs - stay.enteredUtcMs - breach.waitedMs) < 1000,
      );
      if (waited === undefined || waited.enteredUtcMs === null || waited.leftUtcMs === null) continue;
      role.set(waited, "espera");
      for (const stay of lane.stayList) {
        if (
          breach.overtakenBy.includes(stay.agvId) &&
          stay.enteredUtcMs !== null &&
          stay.leftUtcMs !== null &&
          stay.enteredUtcMs > waited.enteredUtcMs &&
          stay.leftUtcMs < waited.leftUtcMs &&
          !role.has(stay)
        ) {
          role.set(stay, "cola");
        }
      }
    }
  }

  // Qué tramo de tiempo ocupa cada estancia en el dibujo. Solo se dibuja como barra lo que se sabe:
  // una estancia completa, o un arranque en frío (R-CO-007: ya estaba dentro al empezar la
  // cobertura). Una estancia de la que falta un extremo por otra razón —la salida no se vio, o no
  // consta la entrada— es una marca corta en el extremo conocido, nunca una barra que afirme horas.
  const stub = (covTo - covFrom) * 0.006;
  const extent = (stay: StayView): readonly [number, number] => {
    if (stay.enteredUtcMs !== null && stay.leftUtcMs !== null) return [stay.enteredUtcMs, stay.leftUtcMs];
    if (stay.state === "abierta-al-inicio" && stay.leftUtcMs !== null) return [covFrom, stay.leftUtcMs];
    if (stay.leftUtcMs !== null) return [stay.leftUtcMs - stub, stay.leftUtcMs];
    const entered = stay.enteredUtcMs ?? covFrom;
    return [entered, entered + stub];
  };

  // Pistas: cada estancia en la primera que esté libre cuando empieza.
  const tracks = lanes.map((lane) => {
    const ends: number[] = [];
    const placed = [...lane.stayList]
      .sort((a, b) => extent(a)[0] - extent(b)[0])
      .map((stay) => {
        const [start, end] = extent(stay);
        let track = ends.findIndex((value) => value <= start);
        if (track === -1) {
          track = ends.length;
          ends.push(end);
        } else {
          ends[track] = end;
        }
        return { stay, track };
      });
    return { lane, placed, count: Math.max(1, ends.length) };
  });
  const flat: StayView[] = tracks.flatMap((entry) => entry.placed.map((item) => item.stay));

  responsive(area, (width) => {
    area.replaceChildren();
    const left = 70;
    const right = 8;
    const trackHeight = 12;
    const top = 6;
    const rowHeights = tracks.map((entry) => entry.count * (trackHeight + 2) + 12);
    const plotHeight = rowHeights.reduce((sum, value) => sum + value, 0);
    const height = top + plotHeight + 24;
    const innerWidth = width - left - right;
    const x = (utcMs: number): number => left + ((utcMs - domainFrom) / Math.max(1, covTo - domainFrom)) * innerWidth;
    const canvas = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Ocupación de las calles de carga" });
    canvas.append(hatchPattern());
    // Fuera de cobertura: antes del inicio y en los huecos entre periodos cargados.
    const gaps: [number, number][] = [[domainFrom, covFrom]];
    const sorted = [...coverage].sort((a, b) => a.from - b.from);
    for (let k = 1; k < sorted.length; k += 1) {
      const previous = sorted[k - 1];
      const current = sorted[k];
      if (previous !== undefined && current !== undefined && current.from > previous.to) gaps.push([previous.to, current.from]);
    }
    for (const [a, b] of gaps) canvas.append(svg("rect", { x: x(a), y: top, width: Math.max(0, x(b) - x(a)), height: plotHeight, fill: HATCH_FILL }));
    timeAxis(canvas, x, covFrom, covTo, top, top + plotHeight, height - 6, width, formats.tick);

    let y = top;
    tracks.forEach((entry, index) => {
      const rowHeight = rowHeights[index] ?? 0;
      canvas.append(svg("line", { x1: left, x2: left + innerWidth, y1: y + rowHeight, y2: y + rowHeight, stroke: "var(--viz-grid)" }));
      canvas.append(text(0, y + rowHeight / 2 + 4, entry.lane.laneId, "label"));
      if (!entry.lane.served) canvas.append(text(x(covFrom) + 8, y + rowHeight / 2 + 4, "nadie entró en toda la ventana", "axis"));
      for (const { stay, track } of entry.placed) {
        const [start, end] = extent(stay);
        const x0 = x(start);
        const barWidth = Math.max(2, x(end) - x0 - 1);
        const barY = y + 6 + track * (trackHeight + 2);
        const kind = role.get(stay);
        canvas.append(
          svg("rect", {
            x: x0,
            y: barY,
            width: barWidth,
            height: trackHeight,
            rx: Math.min(2, barWidth / 2),
            fill: kind === "espera" ? "var(--viz-accent)" : kind === "cola" ? "var(--viz-series)" : "var(--viz-neutral)",
            "data-k": flat.indexOf(stay),
          }),
        );
        if (stay.enteredUtcMs === null) {
          canvas.append(svg("path", { d: `M${x0 - 1} ${barY + 1}L${x0 - 5} ${barY + trackHeight / 2}L${x0 - 1} ${barY + trackHeight - 1}Z`, fill: "var(--ink)" }));
        }
        if (stay.leftUtcMs === null) {
          const x1 = x0 + barWidth;
          canvas.append(svg("path", { d: `M${x1 + 1} ${barY + 1}L${x1 + 5} ${barY + trackHeight / 2}L${x1 + 1} ${barY + trackHeight - 1}Z`, fill: "var(--ink)" }));
        }
      }
      y += rowHeight;
    });

    inspect(
      canvas,
      (point) => {
        if (point === null) {
          line.show(null);
          return;
        }
        const key = (point.target as SVGElement).getAttribute("data-k");
        const stay = key === null ? undefined : flat[Number(key)];
        if (stay === undefined) {
          line.show(null);
          return;
        }
        const lane = tracks.find((entry) => entry.lane.stayList.includes(stay))?.lane;
        const entered =
          stay.enteredUtcMs !== null
            ? formats.instant(stay.enteredUtcMs)
            : stay.state === "abierta-al-inicio"
              ? "antes de la cobertura (ya estaba dentro)"
              : "no consta";
        const left_ = stay.leftUtcMs !== null ? formats.instant(stay.leftUtcMs) : "no se vio";
        const length = stay.enteredUtcMs !== null && stay.leftUtcMs !== null ? ` · ${minutes(stay.leftUtcMs - stay.enteredUtcMs)}` : "";
        const note = role.get(stay) === "espera" ? " · esperó mientras otros que entraron después salían antes" : role.get(stay) === "cola" ? " · entró después y salió antes" : "";
        line.show(`${stay.agvId} en «${lane?.laneId ?? "?"}» — entrada ${entered}, salida ${left_}${length}${note}`);
      },
      { snap: "[data-k]" },
    );
    area.append(canvas);
  });

  wrapper.append(area, line.node);
  wrapper.append(
    legendList([
      ["var(--viz-neutral)", "estancia"],
      ["var(--viz-accent)", "esperó de más"],
      ["var(--viz-series)", "entró después y salió antes"],
      [HATCH_SWATCH, "sin datos cargados"],
    ]),
  );
  wrapper.append(
    table(
      ["Calle", "AGV", "Entrada", "Salida", "Estancia", "Estado"],
      tracks.flatMap((entry) =>
        entry.placed.map(({ stay }) => [
          entry.lane.laneId,
          stay.agvId,
          stay.enteredUtcMs === null ? "antes de la cobertura" : formats.instant(stay.enteredUtcMs),
          stay.leftUtcMs === null ? "después de la cobertura" : formats.instant(stay.leftUtcMs),
          stay.enteredUtcMs !== null && stay.leftUtcMs !== null ? minutes(stay.leftUtcMs - stay.enteredUtcMs) : "—",
          stay.state,
        ]),
      ),
    ),
  );
  return wrapper;
}

// --- 8. FIFO: orden de entrada frente a orden de salida --------------------

type FifoSpan = NonNullable<CircuitViews["fifo"]>[number]["spans"][number];

/**
 * Pasadas consecutivas por un tramo cargado: a la izquierda en el orden en que entraron, a la
 * derecha en el que salieron. Si todo fuera FIFO las líneas serían paralelas; un adelantamiento es
 * una línea que cruza a las demás.
 */
export function fifoSlopeChart(span: FifoSpan, overtaken: string, formats: Formats): HTMLElement {
  const wrapper = figure(
    `Entrada y salida del tramo cargado «${span.spanId}»`,
    `${span.focus.length} pasadas consecutivas, de ${span.entryTagId} a ${span.exitTagId}. Izquierda: ` +
      "orden de entrada; derecha: orden de salida. Candidato, no avería: R-FLO-001 admite " +
      "excepciones y el dato no dice cuál (OQ-107).",
  );
  const area = host();
  const line = readout("Toca o pasa el puntero por una línea para leer su pasada.");
  const passes = [...span.focus].sort((a, b) => a.enteredUtcMs - b.enteredUtcMs);
  const exitRank = new Map([...passes].sort((a, b) => a.leftUtcMs - b.leftUtcMs).map((pass, rank) => [pass, rank]));
  const slow = passes.find((pass) => pass.agvId === overtaken);

  responsive(area, (width) => {
    area.replaceChildren();
    const rowHeight = 15;
    const top = 30;
    const height = top + passes.length * rowHeight + 6;
    const label = width < 480 ? 42 : 58;
    const xl = label + 6;
    const xr = width - label - 6;
    const canvas = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Orden de entrada frente a orden de salida" });
    canvas.append(text(xl, 12, `entrada · ${span.entryTagId}`, "axis", { "text-anchor": "middle" }));
    canvas.append(text(xr, 12, `salida · ${span.exitTagId}`, "axis", { "text-anchor": "middle" }));
    canvas.append(text(xl, 24, "1.º arriba", "axis", { "text-anchor": "middle" }));
    canvas.append(text(xr, 24, "1.º arriba", "axis", { "text-anchor": "middle" }));
    const y = (rank: number): number => top + rank * rowHeight + rowHeight / 2;
    const draw = (pass: (typeof passes)[number], index: number): void => {
      const highlighted = pass === slow;
      const ye = y(index);
      const yx = y(exitRank.get(pass) ?? index);
      const middle = (xl + xr) / 2;
      const d = `M${xl} ${ye}C${middle} ${ye} ${middle} ${yx} ${xr} ${yx}`;
      canvas.append(svg("path", { d, fill: "none", stroke: highlighted ? "var(--viz-accent)" : "var(--viz-neutral)", "stroke-width": highlighted ? 2.5 : 1.5 }));
      for (const [px, py] of [[xl, ye], [xr, yx]] as const) {
        canvas.append(svg("circle", { cx: px, cy: py, r: highlighted ? 4.5 : 3.5, fill: highlighted ? "var(--viz-accent)" : "var(--viz-neutral)", stroke: "var(--panel)", "stroke-width": 2 }));
      }
      canvas.append(text(xl - 9, ye + 3.5, pass.agvId, highlighted ? "value id" : "axis id", { "text-anchor": "end" }));
      canvas.append(text(xr + 9, yx + 3.5, pass.agvId, highlighted ? "value id" : "axis id"));
      canvas.append(svg("path", { d, fill: "none", stroke: "transparent", "stroke-width": 10, "pointer-events": "stroke", "data-k": index }));
    };
    passes.forEach((pass, index) => {
      if (pass !== slow) draw(pass, index);
    });
    passes.forEach((pass, index) => {
      if (pass === slow) draw(pass, index);
    });
    inspect(
      canvas,
      (point) => {
        if (point === null) {
          line.show(null);
          return;
        }
        const key = (point.target as SVGElement).getAttribute("data-k");
        const pass = key === null ? undefined : passes[Number(key)];
        if (pass === undefined) {
          line.show(null);
          return;
        }
        line.show(
          `${pass.agvId} — entra ${Number(key) + 1}.º (${formats.instant(pass.enteredUtcMs)}), sale ` +
            `${(exitRank.get(pass) ?? 0) + 1}.º (${formats.instant(pass.leftUtcMs)}), tránsito ${minutes(pass.leftUtcMs - pass.enteredUtcMs)}`,
        );
      },
      { snap: "[data-k]" },
    );
    area.append(canvas);
  });

  wrapper.append(area, line.node);
  wrapper.append(
    table(
      ["AGV", "Orden de entrada", "Orden de salida", "Entrada", "Salida", "Tránsito"],
      passes.map((pass, index) => [
        pass.agvId,
        String(index + 1),
        String((exitRank.get(pass) ?? 0) + 1),
        formats.instant(pass.enteredUtcMs),
        formats.instant(pass.leftUtcMs),
        minutes(pass.leftUtcMs - pass.enteredUtcMs),
      ]),
    ),
  );
  return wrapper;
}

// --- 9. Deriva entre dos periodos ------------------------------------------

type DriftView = NonNullable<CircuitViews["drift"]>;

/** Filas que se dibujan como mucho; el resto sigue en la tabla de detalle. Parámetro de pantalla. */
const DRIFT_ROWS = 16;

/**
 * Cada tag que cambió, como un trayecto entre sus lecturas del periodo temprano (hueco) y del tardío
 * (relleno). La sustitución candidata se dibuja como dos filas enlazadas: el tag que sale y el que
 * ocupa su hueco. Lo que no se leyó nunca queda anclado en cero.
 */
export function driftChart(drift: DriftView): HTMLElement {
  const wrapper = figure(
    "Deriva entre los dos periodos",
    "Lecturas de cada tag en el periodo temprano (hueco) y en el tardío (relleno). La barra naranja " +
      "une las dos filas de una sustitución candidata: mismo hueco de la secuencia, a la vez " +
      "(R-DAT-017). Correlación, nunca confirmación física (R-EVI-004).",
  );
  const area = host();
  const line = readout("Toca o pasa el puntero por una fila para leer sus recuentos.");
  const order: Readonly<Record<string, number>> = { desaparecido: 0, "sustitucion-candidata": 1, nuevo: 2, "obsoleto-consolidado": 3 };
  const rows: { tagId: string; kind: string; early: number; late: number; pair: number | null }[] = [];
  const sorted = [...drift.tagDrifts].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.tagId.localeCompare(b.tagId));
  for (const entry of sorted) {
    if (rows.length >= DRIFT_ROWS) break;
    if (entry.kind === "sustitucion-candidata") {
      const pair = rows.length;
      rows.push({ tagId: entry.tagId, kind: "sustitución: sale", early: entry.readingsBefore, late: 0, pair });
      rows.push({ tagId: entry.nuevoTagId ?? "?", kind: "sustitución: entra", early: 0, late: entry.readingsAfter, pair });
    } else {
      const kind = entry.kind === "obsoleto-consolidado" ? "obsoleto consolidado" : entry.kind;
      rows.push({ tagId: entry.tagId, kind, early: entry.readingsBefore, late: entry.readingsAfter, pair: null });
    }
  }
  const max = Math.max(1, ...rows.flatMap((row) => [row.early, row.late]));

  responsive(area, (width) => {
    area.replaceChildren();
    const label = width < 480 ? 120 : 170;
    const right = 44;
    const rowHeight = 34;
    const height = rows.length * rowHeight + 26;
    const innerWidth = width - label - right;
    const x = (value: number): number => label + (value / max) * innerWidth;
    const y = (index: number): number => index * rowHeight + rowHeight / 2;
    const canvas = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Lecturas por tag en los dos periodos" });
    const tickStep = niceStep(max / 4);
    const ticks = Array.from({ length: Math.floor(max / tickStep) + 1 }, (_, index) => index * tickStep);
    for (const tick of ticks) {
      canvas.append(svg("line", { x1: x(tick), x2: x(tick), y1: 0, y2: rows.length * rowHeight, stroke: tick === 0 ? "var(--line)" : "var(--viz-grid)" }));
      canvas.append(text(x(tick), height - 6, String(tick), "axis", { "text-anchor": tick === 0 ? "start" : "middle" }));
    }
    const pairs = new Map<number, number[]>();
    rows.forEach((row, index) => {
      if (row.pair !== null) pairs.set(row.pair, [...(pairs.get(row.pair) ?? []), index]);
    });
    for (const indices of pairs.values()) {
      const [a, b] = indices;
      if (a === undefined || b === undefined) continue;
      canvas.append(svg("path", { d: `M${label - 6} ${y(a)}H${label - 11}V${y(b)}H${label - 6}`, fill: "none", stroke: "var(--viz-accent)", "stroke-width": 2 }));
    }
    rows.forEach((row, index) => {
      const cy = y(index);
      canvas.append(svg("rect", { x: 0, y: cy - rowHeight / 2, width, height: rowHeight, fill: "transparent", "data-k": index }));
      canvas.append(text(0, cy - 2, row.tagId, "label id", { "pointer-events": "none" }));
      canvas.append(text(0, cy + 12, row.kind, "axis", { "pointer-events": "none" }));
      if (row.early !== row.late) {
        canvas.append(svg("line", { x1: x(row.early), x2: x(row.late), y1: cy, y2: cy, stroke: "var(--viz-neutral)", "stroke-width": 2, "pointer-events": "none" }));
      }
      canvas.append(svg("circle", { cx: x(row.early), cy, r: 5.5, fill: "var(--panel)", stroke: "var(--ink)", "stroke-width": 2, "pointer-events": "none" }));
      canvas.append(svg("circle", { cx: x(row.late), cy, r: row.early === row.late ? 3 : 5, fill: "var(--viz-series)", stroke: "var(--panel)", "stroke-width": row.early === row.late ? 0 : 2, "pointer-events": "none" }));
      canvas.append(
        text(
          row.early === row.late ? x(0) + 12 : Math.max(x(row.early), x(row.late)) + 10,
          cy + 4,
          row.early === row.late ? "0 en los dos periodos" : String(Math.max(row.early, row.late)),
          "axis",
          { "pointer-events": "none" },
        ),
      );
    });
    inspect(
      canvas,
      (point) => {
        if (point === null) {
          line.show(null);
          return;
        }
        const key = (point.target as SVGElement).getAttribute("data-k");
        const row = key === null ? undefined : rows[Number(key)];
        line.show(row === undefined ? null : `${row.tagId} · ${row.kind} — ${row.early} lecturas en el periodo temprano, ${row.late} en el tardío`);
      },
      { snap: "[data-k]" },
    );
    area.append(canvas);
  });

  wrapper.append(area, line.node);
  wrapper.append(
    legendList([
      ["radial-gradient(circle, var(--panel) 40%, var(--ink) 42%, var(--ink) 62%, transparent 64%)", "periodo temprano (hueco)"],
      ["var(--viz-series)", "periodo tardío (relleno)"],
      ["var(--viz-accent)", "sustitución candidata"],
    ]),
  );
  if (drift.tagDrifts.length > rows.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = `Se dibujan ${rows.length} filas; todos los tags con deriva están en el detalle de abajo.`;
    wrapper.append(note);
  }
  return wrapper;
}

// --- 11. Expediente de un vehículo en un solo eje de tiempo ----------------

/** Los trozos de `[from, to]` que caen dentro de algún intervalo cargado. Sin cobertura, entero. */
function clipToCoverage(
  from: number,
  to: number,
  spans: readonly { readonly from: number; readonly to: number }[],
): readonly (readonly [number, number])[] {
  if (spans.length === 0) return [[from, to]];
  const pieces: [number, number][] = [];
  for (const span of spans) {
    const a = Math.max(from, span.from);
    const b = Math.min(to, span.to);
    if (b > a) pieces.push([a, b]);
  }
  return pieces;
}

export interface AgvTimelineData {
  readonly agvId: string;
  readonly bins: readonly number[];
  readonly binStarts: readonly number[];
  readonly binWidthMs: number;
  readonly uncoveredBins: readonly number[];
  readonly inactivity: readonly {
    readonly fromUtcMs: number;
    readonly toUtcMs: number;
    readonly cause: "silencio" | "carga-online";
    readonly lastTagBefore: string;
    readonly firstTagAfter: string;
    readonly laneId?: string;
  }[];
  readonly coverage: readonly { readonly from: number; readonly to: number }[];
}

/**
 * Todo lo del vehículo alineado: cuándo lee, cuándo carga (inferido), cuándo calla (causa
 * desconocida) y qué periodo está cargado. Fuera de la cobertura, trama: no es un silencio.
 */
export function agvTimelineChart(data: AgvTimelineData, formats: Formats): HTMLElement {
  const wrapper = figure(
    `Expediente de ${data.agvId} en el tiempo`,
    "Lecturas por tramo, estado y cobertura en el mismo eje. La carga en calle es inferida (R-CO-006); " +
      "un silencio tiene causa desconocida (R-AGV-006); fuera de la cobertura no hay datos (R-DAT-007).",
  );
  const area = host();
  const line = readout("Toca o pasa el puntero por un tramo para leerlo.");
  const first = data.binStarts[0] ?? 0;
  const last = (data.binStarts[data.binStarts.length - 1] ?? first) + data.binWidthMs;
  const covFrom = data.coverage.length > 0 ? Math.min(...data.coverage.map((span) => span.from)) : first;
  const covTo = data.coverage.length > 0 ? Math.max(...data.coverage.map((span) => span.to)) : last;
  const from = Math.min(first, covFrom);
  const to = Math.max(last, covTo);
  const uncovered = new Set(data.uncoveredBins);
  const maxBin = Math.max(1, ...data.bins);

  responsive(area, (width) => {
    area.replaceChildren();
    const left = width < 480 ? 66 : 80;
    const right = 6;
    const laneReadings = 44;
    const laneState = 18;
    const laneCoverage = 8;
    const gap = 12;
    const yReadings = 4;
    const yState = yReadings + laneReadings + gap;
    const yCoverage = yState + laneState + gap;
    const height = yCoverage + laneCoverage + 26;
    const innerWidth = width - left - right;
    const x = (utcMs: number): number => left + ((utcMs - from) / Math.max(1, to - from)) * innerWidth;
    const canvas = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Expediente de ${data.agvId} en el tiempo` });
    canvas.append(hatchPattern());
    canvas.append(text(0, yReadings + laneReadings / 2 + 4, "lecturas", "label"));
    canvas.append(text(0, yState + laneState / 2 + 4, "estado", "label"));
    canvas.append(text(0, yCoverage + laneCoverage / 2 + 4, "cobertura", "label"));
    timeAxis(canvas, x, from, to, yReadings, yCoverage + laneCoverage, height - 6, width, formats.tick);

    // Cobertura: los intervalos cargados en neutro; lo demás, trama en todas las pistas.
    const spans = [...data.coverage].sort((a, b) => a.from - b.from);
    const gaps: [number, number][] = [];
    let cursor = from;
    for (const span of spans) {
      if (span.from > cursor) gaps.push([cursor, span.from]);
      cursor = Math.max(cursor, span.to);
    }
    if (cursor < to) gaps.push([cursor, to]);
    for (const [a, b] of gaps) {
      canvas.append(svg("rect", { x: x(a), y: yReadings, width: Math.max(0, x(b) - x(a)), height: yCoverage + laneCoverage - yReadings, fill: HATCH_FILL }));
    }
    for (const span of spans) {
      canvas.append(svg("rect", { x: x(span.from), y: yCoverage, width: Math.max(1, x(span.to) - x(span.from)), height: laneCoverage, rx: 2, fill: "var(--viz-neutral)", "data-k": "cov" }));
    }
    canvas.append(svg("line", { x1: left, x2: left + innerWidth, y1: yReadings + laneReadings, y2: yReadings + laneReadings, stroke: "var(--line)" }));

    const binWidthPx = x(first + data.binWidthMs) - x(first);
    data.bins.forEach((count, bin) => {
      if (count === 0 || uncovered.has(bin)) return;
      const start = data.binStarts[bin] ?? first;
      const barHeight = Math.max(1, (count / maxBin) * (laneReadings - 4));
      canvas.append(
        svg("rect", {
          x: x(start) + (binWidthPx > 3 ? 0.5 : 0),
          y: yReadings + laneReadings - barHeight,
          width: Math.max(0.6, binWidthPx - (binWidthPx > 3 ? 1 : 0)),
          height: barHeight,
          fill: "var(--viz-series)",
          "data-k": `b${bin}`,
        }),
      );
    });

    // Solo la parte de cada periodo que cae dentro de la cobertura: lo que queda fuera no es un
    // silencio ni una carga, es que no hay datos (R-DAT-007).
    data.inactivity.forEach((period, index) => {
      const pieces = clipToCoverage(period.fromUtcMs, period.toUtcMs, spans);
      for (const [a, b] of pieces) {
        const x0 = x(a);
        const w = Math.max(3, x(b) - x0);
        canvas.append(
          period.cause === "carga-online"
            ? svg("rect", { x: x0, y: yState, width: w, height: laneState, rx: 2, fill: "var(--viz-3)", "data-k": `s${index}` })
            : svg("rect", { x: x0 + 0.75, y: yState + 0.75, width: Math.max(1.5, w - 1.5), height: laneState - 1.5, rx: 2, fill: "var(--viz-accent-wash)", stroke: "var(--viz-accent)", "stroke-width": 1.5, "data-k": `s${index}` }),
        );
      }
    });

    inspect(
      canvas,
      (point) => {
        if (point === null) {
          line.show(null);
          return;
        }
        const key = (point.target as SVGElement).getAttribute("data-k");
        if (key === null) {
          line.show(null);
          return;
        }
        if (key === "cov") {
          line.show(`Cobertura cargada — fuera de ella no hay datos, y no es un silencio`);
          return;
        }
        if (key.startsWith("b")) {
          const bin = Number(key.slice(1));
          line.show(`${formats.instant(data.binStarts[bin] ?? first)} — ${data.bins[bin] ?? 0} lecturas en el tramo`);
          return;
        }
        const period = data.inactivity[Number(key.slice(1))];
        if (period === undefined) return;
        const covered = clipToCoverage(period.fromUtcMs, period.toUtcMs, spans).reduce((sum, [a, b]) => sum + (b - a), 0);
        const clipped = covered < period.toUtcMs - period.fromUtcMs - 1000;
        line.show(
          (period.cause === "carga-online"
            ? `En carga${period.laneId === undefined ? "" : ` en «${period.laneId}»`} (inferido)`
            : "Silencio, causa desconocida") +
            ` — ${formats.instant(period.fromUtcMs)} → ${formats.instant(period.toUtcMs)}, ${minutes(period.toUtcMs - period.fromUtcMs)}; ` +
            `se fue tras ${period.lastTagBefore} y volvió en ${period.firstTagAfter}` +
            (clipped ? `; solo ${minutes(covered)} caen dentro de la cobertura, el resto no tiene datos` : ""),
        );
      },
      { snap: "[data-k]" },
    );
    area.append(canvas);
  });

  wrapper.append(area, line.node);
  wrapper.append(
    legendList([
      ["var(--viz-series)", "lecturas"],
      ["var(--viz-3)", "en carga (inferido)"],
      ["var(--viz-accent)", "silencio, causa desconocida"],
      [HATCH_SWATCH, "sin datos cargados"],
    ]),
  );
  return wrapper;
}

// --- Flota del circuito (Parte 39) ------------------------------------------

type FleetView = CircuitViews["fleet"];
type FleetStateName = FleetView["vehicles"][number]["segments"][number]["state"];

/** Nombre de cada estado tal como se lee en la vista. */
const FLEET_STATE_LABEL: Readonly<Record<FleetStateName, string>> = {
  leyendo: "leyendo",
  carga: "en carga (inferido)",
  silencio: "falta de lecturas: causa desconocida",
  ausente: "ausente: asignado y sin lecturas",
  fuera: "fuera del circuito: no asignado",
  "leyendo-sin-asignar": "lee sin estar asignado",
  "sin-datos": "sin datos cargados",
};

/**
 * Cuántos de los asignados están en funcionamiento en cada momento — «38 de 40» —, como dos series
 * escalonadas: la flota asignada detrás y los que leen o cargan delante (R-AGV-014). Los que leen sin
 * estar asignados van aparte, en naranja, y nunca suman a N (R-AGV-015).
 */
export function fleetCountChart(
  fleet: FleetView,
  coverage: readonly { readonly from: number; readonly to: number }[],
  formats: Formats,
): HTMLElement {
  const wrapper = figure(
    "Flota en funcionamiento",
    "En funcionamiento: asignados que leen o están en una calle de carga (inferido). Un AGV en " +
      "silencio o ausente no cuenta. Fuera de la cobertura no se cuenta nada (R-DAT-007).",
  );
  const counts = fleet.counts;
  const area = host();
  const line = readout("Toca o pasa el puntero por la gráfica para leer el recuento de ese momento.");
  if (counts.length === 0) {
    wrapper.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Sin tramos cubiertos que contar." }));
    return wrapper;
  }

  // El peor momento, que es lo que se busca al mirar esto: la menor proporción en funcionamiento.
  const withFleet = counts.filter((entry) => entry.assigned > 0);
  const worst =
    withFleet.length === 0
      ? null
      : withFleet.reduce((best, entry) =>
          entry.inService / entry.assigned < best.inService / best.assigned ? entry : best,
        );
  const summary = document.createElement("p");
  summary.className = "muted";
  summary.textContent =
    worst === null
      ? "Ningún AGV asignado dentro de la cobertura."
      : `Menos en funcionamiento: ${worst.inService} de ${worst.assigned}, de ` +
        `${formats.instant(worst.fromUtcMs)} a ${formats.instant(worst.toUtcMs)}.`;
  const maxAssigned = Math.max(1, ...counts.map((entry) => Math.max(entry.assigned, entry.inService + entry.unassignedActive)));
  const describe = (entry: (typeof counts)[number]): string =>
    `de ${formats.instant(entry.fromUtcMs)} a ${formats.instant(entry.toUtcMs)} · ${entry.inService} de ` +
    `${entry.assigned} en funcionamiento` +
    (entry.unassignedActive > 0 ? ` (+${entry.unassignedActive} leyendo sin estar asignados)` : "");

  responsive(area, (width) => {
    area.replaceChildren();
    const left = 34;
    const right = 8;
    const top = 8;
    const plotHeight = 150;
    const height = top + plotHeight + 26;
    const innerWidth = width - left - right;
    const x = (utcMs: number): number => left + ((utcMs - fleet.fromUtcMs) / Math.max(1, fleet.toUtcMs - fleet.fromUtcMs)) * innerWidth;
    const y = (value: number): number => top + plotHeight - (value / maxAssigned) * plotHeight;
    const canvas = svg("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Flota en funcionamiento a lo largo del tiempo" });
    canvas.append(hatchPattern());
    const tickStep = niceStep(maxAssigned / 4);
    for (let value = 0; value <= maxAssigned; value += tickStep) {
      canvas.append(svg("line", { x1: left, x2: left + innerWidth, y1: y(value), y2: y(value), stroke: value === 0 ? "var(--line)" : "var(--viz-grid)" }));
      canvas.append(text(left - 5, y(value) + 3.5, String(value), "axis", { "text-anchor": "end" }));
    }
    // Huecos de cobertura: sin datos, con trama.
    const spans = [...coverage].sort((a, b) => a.from - b.from);
    let cursor = fleet.fromUtcMs;
    for (const span of spans) {
      if (span.from > cursor) canvas.append(svg("rect", { x: x(cursor), y: top, width: x(span.from) - x(cursor), height: plotHeight, fill: HATCH_FILL }));
      cursor = Math.max(cursor, span.to);
    }
    timeAxis(canvas, x, fleet.fromUtcMs, fleet.toUtcMs, top, top + plotHeight, height - 6, width, formats.tick);

    const step = (pick: (entry: (typeof counts)[number]) => number): string[] => {
      const paths: string[] = [];
      let current = "";
      let previousEnd: number | null = null;
      for (const entry of counts) {
        const value = y(pick(entry));
        if (previousEnd === null || entry.fromUtcMs !== previousEnd) {
          if (current !== "") paths.push(current);
          current = `M${x(entry.fromUtcMs).toFixed(1)} ${value.toFixed(1)}`;
        } else {
          current += `V${value.toFixed(1)}`;
        }
        current += `H${x(entry.toUtcMs).toFixed(1)}`;
        previousEnd = entry.toUtcMs;
      }
      if (current !== "") paths.push(current);
      return paths;
    };
    for (const d of step((entry) => entry.assigned)) {
      canvas.append(svg("path", { d, fill: "none", stroke: "var(--viz-neutral)", "stroke-width": 2 }));
    }
    for (const d of step((entry) => entry.inService)) {
      canvas.append(svg("path", { d, fill: "none", stroke: "var(--viz-series)", "stroke-width": 2 }));
    }
    if (counts.some((entry) => entry.unassignedActive > 0)) {
      for (const d of step((entry) => entry.unassignedActive)) {
        canvas.append(svg("path", { d, fill: "none", stroke: "var(--viz-accent)", "stroke-width": 1.5 }));
      }
    }
    const cross = svg("line", { y1: top, y2: top + plotHeight, stroke: "var(--ink)", visibility: "hidden" });
    canvas.append(cross);
    inspect(
      canvas,
      (point) => {
        if (point === null) {
          cross.setAttribute("visibility", "hidden");
          line.show(null);
          return;
        }
        const box = canvas.getBoundingClientRect();
        const at = fleet.fromUtcMs + ((point.clientX - box.left - left) / innerWidth) * (fleet.toUtcMs - fleet.fromUtcMs);
        const entry = counts.find((candidate) => at >= candidate.fromUtcMs && at < candidate.toUtcMs);
        if (entry === undefined) {
          cross.setAttribute("visibility", "hidden");
          line.show(at >= fleet.fromUtcMs && at <= fleet.toUtcMs ? `${formats.instant(at)} — sin datos cargados: no se cuenta` : null);
          return;
        }
        cross.setAttribute("x1", String(x(at)));
        cross.setAttribute("x2", String(x(at)));
        cross.setAttribute("visibility", "visible");
        line.show(describe(entry));
      },
    );
    area.append(canvas);
  });

  wrapper.append(summary, area, line.node);
  wrapper.append(
    legendList([
      ["var(--viz-series)", "en funcionamiento (N)"],
      ["var(--viz-neutral)", "asignados (M)"],
      ["var(--viz-accent)", "leyendo sin estar asignados"],
      [HATCH_SWATCH, "sin datos cargados"],
    ]),
  );
  wrapper.append(
    lazyDetails("Ver los mismos datos en tabla", () =>
      plainTable(
        ["Desde", "Hasta", "En funcionamiento", "Asignados", "Leyendo sin asignar"],
        counts.map((entry) => [
          formats.instant(entry.fromUtcMs),
          formats.instant(entry.toUtcMs),
          String(entry.inService),
          String(entry.assigned),
          String(entry.unassignedActive),
        ]),
      ),
    ),
  );
  return wrapper;
}

/**
 * La vida de cada AGV en tramos continuos, una fila por vehículo: los asignados primero y después
 * los que leen sin estarlo. Un único `canvas`: un circuito real son decenas de vehículos con decenas
 * de tramos cada uno, y un nodo por tramo es la lección de la banda de actividad.
 */
export function fleetLifelineChart(fleet: FleetView, formats: Formats): HTMLElement {
  const wrapper = figure(
    "Vida de cada AGV en el circuito",
    "Una fila por AGV y sus tramos continuos a lo largo de la ventana. La ausencia —asignado y sin " +
      "lecturas— va en naranja; la falta de lecturas entre dos lecturas, en contorno naranja. Quien " +
      "lee sin estar asignado va a media altura.",
  );
  const area = host();
  const line = readout("Toca o pasa el puntero por una fila para leer el tramo.");
  const vehicles = fleet.vehicles;

  responsive(area, (width) => {
    area.replaceChildren();
    const left = 56;
    const right = 6;
    const rowHeight = 11;
    const gap = 3;
    const top = 4;
    const plotHeight = vehicles.length * (rowHeight + gap);
    const height = top + plotHeight + 22;
    const innerWidth = width - left - right;
    const x = (utcMs: number): number => left + ((utcMs - fleet.fromUtcMs) / Math.max(1, fleet.toUtcMs - fleet.fromUtcMs)) * innerWidth;
    const ratio = window.devicePixelRatio || 1;
    const node = document.createElement("canvas");
    node.width = Math.round(width * ratio);
    node.height = Math.round(height * ratio);
    node.style.width = `${width}px`;
    node.style.height = `${height}px`;
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", `Vida de ${vehicles.length} AGV en el circuito`);
    area.append(node);
    const context = node.getContext("2d");
    if (context === null) return;
    context.scale(ratio, ratio);
    const style = getComputedStyle(document.documentElement);
    const color = (name: string): string => style.getPropertyValue(name).trim();
    const hatch = canvasHatch(context);
    const fills: Readonly<Record<FleetStateName, string | CanvasPattern>> = {
      leyendo: color("--viz-series"),
      carga: color("--viz-5"),
      silencio: color("--viz-accent-wash"),
      ausente: color("--viz-accent"),
      fuera: color("--viz-grid"),
      "leyendo-sin-asignar": color("--viz-series"),
      "sin-datos": hatch,
    };
    context.font = "10px ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
    vehicles.forEach((vehicle, row) => {
      const y = top + row * (rowHeight + gap);
      context.fillStyle = color("--muted");
      context.textAlign = "right";
      context.fillText(vehicle.agvId, left - 6, y + rowHeight - 2);
      for (const segment of vehicle.segments) {
        const x0 = x(segment.fromUtcMs);
        const w = Math.max(0.8, x(segment.toUtcMs) - x0);
        context.fillStyle = fills[segment.state];
        if (segment.state === "leyendo-sin-asignar") {
          context.fillRect(x0, y + rowHeight / 4, w, rowHeight / 2);
        } else {
          context.fillRect(x0, y, w, rowHeight);
        }
        if (segment.state === "silencio") {
          context.strokeStyle = color("--viz-accent");
          context.lineWidth = 1;
          context.strokeRect(x0 + 0.5, y + 0.5, Math.max(0, w - 1), rowHeight - 1);
        }
      }
    });
    context.fillStyle = color("--muted");
    context.font = "10px system-ui, -apple-system, 'Segoe UI', sans-serif";
    for (const tick of timeTicks(fleet.fromUtcMs, fleet.toUtcMs, Math.max(3, Math.floor(width / 90)))) {
      const px = x(tick);
      context.textAlign = px < 40 ? "left" : px > width - 40 ? "right" : "center";
      context.fillText(formats.tick(tick), px, top + plotHeight + 14);
    }

    inspect(
      node,
      (point) => {
        if (point === null) {
          line.show(null);
          return;
        }
        const box = node.getBoundingClientRect();
        const row = Math.floor((point.clientY - box.top - top) / (rowHeight + gap));
        const vehicle = vehicles[row];
        const at = fleet.fromUtcMs + ((point.clientX - box.left - left) / innerWidth) * (fleet.toUtcMs - fleet.fromUtcMs);
        const segment = vehicle?.segments.find((candidate) => at >= candidate.fromUtcMs && at < candidate.toUtcMs);
        if (vehicle === undefined || segment === undefined) {
          line.show(null);
          return;
        }
        line.show(
          `${vehicle.agvId} — ${FLEET_STATE_LABEL[segment.state]}, de ${formats.instant(segment.fromUtcMs)} a ` +
            `${formats.instant(segment.toUtcMs)} (${minutes(segment.toUtcMs - segment.fromUtcMs)})`,
        );
      },
    );
  });

  const share = (vehicle: FleetView["vehicles"][number], state: FleetStateName): number => {
    const total = vehicle.segments
      .filter((segment) => segment.state !== "sin-datos" && segment.state !== "fuera" && segment.state !== "leyendo-sin-asignar")
      .reduce((sum, segment) => sum + (segment.toUtcMs - segment.fromUtcMs), 0);
    const part = vehicle.segments
      .filter((segment) => segment.state === state)
      .reduce((sum, segment) => sum + (segment.toUtcMs - segment.fromUtcMs), 0);
    return total === 0 ? 0 : part / total;
  };
  wrapper.append(area, line.node);
  wrapper.append(
    legendList([
      ["var(--viz-series)", FLEET_STATE_LABEL.leyendo],
      ["var(--viz-5)", FLEET_STATE_LABEL.carga],
      ["var(--viz-accent-wash)", FLEET_STATE_LABEL.silencio],
      ["var(--viz-accent)", FLEET_STATE_LABEL.ausente],
      ["var(--viz-grid)", FLEET_STATE_LABEL.fuera],
      ["linear-gradient(transparent 30%, var(--viz-series) 30% 70%, transparent 70%)", FLEET_STATE_LABEL["leyendo-sin-asignar"]],
      [HATCH_SWATCH, FLEET_STATE_LABEL["sin-datos"]],
    ]),
  );
  wrapper.append(
    lazyDetails("Ver los mismos datos en tabla", () =>
      plainTable(
        ["AGV", "Asignado", "Lecturas", "Leyendo", "En carga", "Falta de lecturas", "Ausente", "Lee sin asignar"],
        vehicles.map((vehicle) => [
          vehicle.agvId,
          vehicle.assignedEver ? "sí" : "no",
          vehicle.readings.toLocaleString("es-ES"),
          percent(share(vehicle, "leyendo")),
          percent(share(vehicle, "carga")),
          percent(share(vehicle, "silencio")),
          percent(share(vehicle, "ausente")),
          vehicle.segments.some((segment) => segment.state === "leyendo-sin-asignar") ? "sí" : "no",
        ]),
      ),
    ),
  );
  return wrapper;
}
