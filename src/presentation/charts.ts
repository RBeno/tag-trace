/**
 * Vistas del circuito (UX_SPEC §4).
 *
 * SVG a mano y sin ninguna dependencia: ADR-0014 prohíbe una CDN en ejecución, así que una librería
 * habría que empaquetarla igualmente, y estos cuatro gráficos son geometría sencilla.
 *
 * Tres reglas que aquí no se negocian, porque las tres separan «dibujar lo observado» de «insinuar
 * un diagnóstico»:
 *
 * 1. **El color nunca es el único medio** (UX §4). Cada gráfico lleva rótulos directos y su tabla
 *    equivalente; la magnitud se codifica por claridad dentro de un solo tono, de modo que un
 *    daltónico ve exactamente lo mismo que los demás.
 * 2. **Un periodo sin cobertura se dibuja distinto de un silencio** (R-DAT-007). En una banda las
 *    dos cosas son una celda vacía, así que la falta de datos lleva trama y se nombra. Dibujarlas
 *    igual sería la confusión que la regla existe para impedir.
 * 3. **Ningún eje es geometría**. Estos gráficos no son un plano del circuito y no dan distancias.
 *
 * Este módulo no calcula nada: recibe agregados que el Worker ya produjo (WP-001).
 */

import { tagClassLabel, truthLabel } from "./labels.js";
import { inspect } from "./pointer.js";
import { tableDrawer } from "./drawer.js";

const NS = "http://www.w3.org/2000/svg";

/**
 * Ancho del sistema de coordenadas, en unidades de `viewBox`.
 *
 * No es decorativo y no se elige al azar: **el texto de un SVG se escala con su `viewBox`**. Con un
 * lienzo de 1000 unidades mostrado en un panel de unos 600 píxeles, una etiqueta de 10 unidades se
 * ve a 6 píxeles y los identificadores de los vehículos se pisan unos con otros. Lo destapó mirar
 * el render, que es lo único que lo destapa: los tipos compilan y las pruebas pasan igual.
 *
 * Con el lienzo cerca del ancho real de pintado, la escala queda próxima a 1 y un texto de 10
 * unidades se lee como 10 píxeles.
 */
const WIDTH = 640;

/** Trama diagonal para «sin datos cargados». Se define una vez por SVG que la use. */
export const HATCH_ID = "tt-hatch";

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** Un valor importado nunca se interpreta como marcado (TH-007). */
export function text(
  x: number,
  y: number,
  content: string,
  className: string,
  extra: Readonly<Record<string, string | number>> = {},
): SVGTextElement {
  const node = svg("text", { x, y, class: className, ...extra });
  node.textContent = content;
  return node;
}

/**
 * La capa de interacción: un `<title>` por marca.
 *
 * Es el `tooltip` nativo del navegador, así que funciona con teclado, con lector de pantalla y sin
 * una línea de JavaScript de posicionamiento. Para cuatro gráficos de lectura, eso vale más que una
 * capa flotante propia que habría que mantener y probar.
 */
function withTooltip<T extends SVGElement>(node: T, label: string): T {
  const title = svg("title");
  title.textContent = label;
  node.append(title);
  // El mismo texto, para la línea de lectura: en una pantalla táctil el `<title>` no se ve nunca.
  node.setAttribute("data-tip", label);
  return node;
}

/**
 * La línea de lectura de un gráfico con `withTooltip`: con ratón acompaña al tooltip nativo, y con
 * el dedo es la única forma de leer una marca (UX_SPEC §7).
 */
function tipReadout(canvas: SVGSVGElement, rest: string): HTMLParagraphElement {
  const line = document.createElement("p");
  line.className = "muted readout";
  line.setAttribute("aria-live", "polite");
  line.textContent = rest;
  inspect(
    canvas,
    (point) => {
      line.textContent = point?.target.closest("[data-tip]")?.getAttribute("data-tip") ?? rest;
    },
    { snap: "[data-tip]" },
  );
  return line;
}

export function hatchPattern(): SVGDefsElement {
  const defs = svg("defs");
  const pattern = svg("pattern", {
    id: HATCH_ID,
    width: 6,
    height: 6,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)",
  });
  pattern.append(svg("rect", { width: 6, height: 6, fill: "var(--panel)" }));
  pattern.append(svg("rect", { width: 2, height: 6, fill: "var(--viz-empty)", opacity: 0.55 }));
  defs.append(pattern);
  return defs;
}

export function figure(title: string, caption: string): HTMLElement {
  const wrapper = document.createElement("figure");
  wrapper.className = "chart";
  const heading = document.createElement("h3");
  heading.textContent = title;
  heading.style.font = "inherit";
  heading.style.fontWeight = "600";
  heading.style.margin = "0 0 2px";
  const legend = document.createElement("figcaption");
  legend.textContent = caption;
  wrapper.append(heading, legend);
  return wrapper;
}

/** La tabla en sí, visible sin plegar: encabezados y filas de texto. */
export function plainTable(headers: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const node = document.createElement("table");
  // Sin clase, estas tablas usaban el estilo por defecto del navegador, que dimensiona por
  // contenido: en pantalla de móvil la del expediente medía 469 px sobre 360 y había que arrastrar
  // en horizontal para leerla, que es justo lo que `UX_SPEC.md` §5.1 prohíbe.
  node.className = "data";
  const head = document.createElement("tr");
  for (const label of headers) {
    const cell = document.createElement("th");
    cell.textContent = label;
    head.append(cell);
  }
  node.append(head);
  for (const row of rows) {
    const line = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      line.append(cell);
    }
    node.append(line);
  }
  return node;
}

/**
 * La tabla equivalente de un gráfico: es la vía accesible y el respaldo cuando el color falla, no la
 * vista principal. Desde 3.49.0 se abre en el cajón lateral único (`drawer.ts`) en vez de plegarse
 * bajo el gráfico, y se construye solo al abrirla.
 */
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  return tableDrawer("Ver los mismos datos en tabla", () => plainTable(headers, rows));
}

/**
 * Una tabla o lista larga cuyo contenido **no se construye hasta que alguien la abre**.
 *
 * La matriz completa de un circuito real son miles de celdas. Construirlas de entrada para dejarlas
 * escondidas es pagar el coste entero sin enseñar nada — que es justo el defecto que la banda de
 * actividad tenía con sus rótulos por celda. Aquí el conjunto completo está disponible y no pesa
 * hasta que se pide. Hasta 3.48.0 era un `<details>` en la propia página; ahora es el botón que abre
 * el cajón lateral único, para que abrir una tabla no empuje el resto de la pestaña.
 */
export function lazyTable(summary: string, build: () => HTMLElement): HTMLElement {
  return tableDrawer(summary, build);
}

/** Contenedor con desplazamiento propio: una matriz ancha se desplaza dentro, no rompe la página. */
export function scrollBox(node: HTMLElement): HTMLElement {
  const box = document.createElement("div");
  box.className = "scrollbox";
  box.append(node);
  return box;
}

export function legendList(items: readonly (readonly [string, string])[]): HTMLElement {
  const list = document.createElement("ul");
  list.className = "legend";
  for (const [fill, label] of items) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = fill;
    const caption = document.createElement("span");
    caption.textContent = label;
    item.append(swatch, caption);
    list.append(item);
  }
  return list;
}

// --- 1. Cobertura ----------------------------------------------------------

export interface CoverageSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * La ventana cargada, con sus huecos dibujados como lo que son.
 *
 * Es el gráfico que sostiene R-DAT-007 visualmente: entre dos exportaciones separadas por semanas
 * hay un hueco que **no es un silencio del circuito**, y verlo evita la pregunta equivocada. Sin
 * esto, la cobertura es una frase en una lista de datos y nadie la relaciona con las cifras.
 */
export function coverageChart(
  coverage: readonly CoverageSpan[],
  format: (utcMs: number) => string,
): HTMLElement {
  const wrapper = figure(
    "Cobertura cargada",
    "Periodos con datos. Fuera de ellos no hay datos, no silencio.",
  );
  if (coverage.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Todavía no hay ningún periodo completo.";
    wrapper.append(empty);
    return wrapper;
  }

  const width = WIDTH;
  const height = 56;
  const from = Math.min(...coverage.map((span) => span.from));
  const to = Math.max(...coverage.map((span) => span.to));
  const span = Math.max(1, to - from);
  const scale = (value: number): number => ((value - from) / span) * width;

  const canvas = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  canvas.append(hatchPattern());
  const label = svg("title");
  label.textContent = `Cobertura entre ${format(from)} y ${format(to)}, en ${coverage.length} ${coverage.length === 1 ? "tramo" : "tramos"}.`;
  canvas.append(label);

  // El fondo entero es «sin datos cargados»; encima se pintan los tramos que sí lo están. Así el
  // hueco no hay que calcularlo: es lo que queda sin tapar.
  canvas.append(
    withTooltip(
      svg("rect", { x: 0, y: 8, width, height: 26, fill: `url(#${HATCH_ID})`, rx: 4 }),
      "Sin datos cargados: no es una parada ni un silencio.",
    ),
  );

  for (const piece of coverage) {
    const x = scale(piece.from);
    const pieceWidth = Math.max(2, scale(piece.to) - x);
    canvas.append(
      withTooltip(
        svg("rect", {
          x,
          y: 8,
          width: pieceWidth,
          height: 26,
          rx: 4,
          fill: "var(--viz-series)",
        }),
        `Cubierto: ${format(piece.from)} → ${format(piece.to)}`,
      ),
    );
  }

  canvas.append(text(0, 50, format(from), "axis"));
  canvas.append(text(width, 50, format(to), "axis", { "text-anchor": "end" }));
  wrapper.append(canvas, tipReadout(canvas, "Toca o pasa el puntero por la barra para leer un tramo."));
  wrapper.append(
    legendList([
      ["var(--viz-series)", "cargado y analizable"],
      ["var(--viz-empty)", "sin datos cargados (con trama)"],
    ]),
  );
  wrapper.append(
    table(
      ["Tramo", "Desde", "Hasta"],
      coverage.map((piece, index) => [String(index + 1), format(piece.from), format(piece.to)]),
    ),
  );
  return wrapper;
}

// --- 2. Perfil horario -----------------------------------------------------

export interface HourlyData {
  readonly counts: readonly number[];
  readonly days: number;
}

/**
 * Lecturas por hora del día.
 *
 * Es el contexto que hace legible cualquier silencio colectivo: un valle a las cinco de la mañana
 * significa una cosa si el resto de la noche también está bajo y otra muy distinta si no.
 * Deliberadamente **no** marca nada como anómalo — para eso hace falta el calendario, que es
 * OQ-108 y sigue abierta.
 */
export function hourlyChart(data: HourlyData): HTMLElement {
  const wrapper = figure(
    "Perfil horario",
    `Lecturas por hora del día, sumando ${data.days} ${data.days === 1 ? "día" : "días"}. Un valle no es necesariamente una parada.`,
  );

  const width = WIDTH;
  const height = 170;
  const bottom = 142;
  const max = Math.max(1, ...data.counts);
  const slot = width / 24;
  // 2px de separación entre barras contiguas: el hueco es de superficie, no una barra más estrecha.
  const barWidth = slot - 2;

  const canvas = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  const label = svg("title");
  label.textContent = `Perfil horario: máximo ${max.toLocaleString("es-ES")} lecturas en una hora.`;
  canvas.append(label);

  for (const fraction of [0.5, 1]) {
    const y = bottom - fraction * (bottom - 16);
    canvas.append(svg("line", { x1: 0, y1: y, x2: width, y2: y, class: "grid" }));
    canvas.append(text(0, y - 4, Math.round(max * fraction).toLocaleString("es-ES"), "axis"));
  }

  data.counts.forEach((count, hour) => {
    const barHeight = Math.max(count === 0 ? 0 : 2, (count / max) * (bottom - 16));
    const x = hour * slot + 1;
    canvas.append(
      withTooltip(
        svg("rect", {
          x,
          y: bottom - barHeight,
          width: barWidth,
          height: barHeight,
          // Extremo redondeado de 4px, anclado a la línea base.
          rx: Math.min(4, barWidth / 2),
          fill: "var(--viz-series)",
        }),
        `${String(hour).padStart(2, "0")}:00 — ${count.toLocaleString("es-ES")} lecturas`,
      ),
    );
    // Rótulo directo selectivo: solo cada tres horas, para que el eje se lea sin ruido.
    if (hour % 3 === 0) {
      canvas.append(text(x + barWidth / 2, bottom + 14, String(hour).padStart(2, "0"), "axis", {
        "text-anchor": "middle",
      }));
    }
  });

  canvas.append(svg("line", { x1: 0, y1: bottom, x2: width, y2: bottom, class: "grid" }));
  wrapper.append(canvas, tipReadout(canvas, "Toca o pasa el puntero por una barra para leer su hora."));
  wrapper.append(
    table(
      ["Hora", "Lecturas"],
      data.counts.map((count, hour) => [
        `${String(hour).padStart(2, "0")}:00`,
        count.toLocaleString("es-ES"),
      ]),
    ),
  );
  return wrapper;
}

// --- 3. Banda de actividad -------------------------------------------------

export interface ActivityData {
  readonly rows: readonly { readonly agvId: string; readonly bins: readonly number[]; readonly total: number }[];
  readonly binStarts: readonly number[];
  readonly uncoveredBins: readonly number[];
  readonly maxPerBin: number;
}

/**
 * Una fila por vehículo, el tiempo en horizontal.
 *
 * De lejos el gráfico que más información da por píxel: salen solos los vehículos que empiezan a
 * media jornada, los que apenas aparecen y los que no leen ni un tag en toda la ventana. Ninguna de
 * las tres cosas es un diagnóstico; las tres son por dónde empezar uno.
 */
export function activityChart(data: ActivityData, format: (utcMs: number) => string): HTMLElement {
  const wrapper = figure(
    "Actividad por vehículo",
    "Una fila por AGV; más oscuro, más lecturas. Con trama: sin datos cargados.",
  );
  if (data.rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No hay lecturas que mostrar.";
    wrapper.append(empty);
    return wrapper;
  }

  const labelWidth = 46;
  const rowHeight = 14;
  const gap = 3;
  const binCount = data.binStarts.length;
  const width = WIDTH;
  const plotWidth = width - labelWidth;
  const cellWidth = plotWidth / Math.max(1, binCount);
  const height = data.rows.length * (rowHeight + gap) + 28;
  const uncovered = new Set(data.uncoveredBins);

  const canvas = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  canvas.append(hatchPattern());
  const label = svg("title");
  label.textContent =
    `Actividad de ${data.rows.length} vehículos a lo largo de la ventana cargada, ` +
    `con un máximo de ${data.maxPerBin.toLocaleString("es-ES")} lecturas por celda.`;
  canvas.append(label);

  data.rows.forEach((row, index) => {
    const y = index * (rowHeight + gap);
    canvas.append(text(0, y + rowHeight - 2, row.agvId, "axis"));
    row.bins.forEach((count, bin) => {
      const x = labelWidth + bin * cellWidth;
      if (uncovered.has(bin)) {
        canvas.append(
          svg("rect", { x, y, width: cellWidth, height: rowHeight, fill: `url(#${HATCH_ID})` }),
        );
        return;
      }
      if (count === 0) {
        // Cero **dentro** de cobertura sí es un hecho: el vehículo no leyó ahí. Se deja en blanco
        // con su borde, distinto de la trama, y la lectura al puntero lo dice con todas las letras.
        canvas.append(
          svg("rect", {
            x,
            y,
            width: cellWidth,
            height: rowHeight,
            fill: "transparent",
            stroke: "var(--viz-grid)",
          }),
        );
        return;
      }
      canvas.append(
        svg("rect", {
          x,
          y,
          width: Math.max(1, cellWidth - 1),
          height: rowHeight,
          fill: rampStep(count, data.maxPerBin),
        }),
      );
    });
  });

  const axisY = data.rows.length * (rowHeight + gap) + 14;
  canvas.append(text(labelWidth, axisY, format(data.binStarts[0] ?? 0), "axis"));
  canvas.append(
    text(width, axisY, format(data.binStarts[binCount - 1] ?? 0), "axis", { "text-anchor": "end" }),
  );

  wrapper.append(canvas);

  /**
   * Una sola lectura para toda la banda, en vez de un `<title>` por celda.
   *
   * Medido en un circuito real (54 vehículos × 96 tramos): con un rótulo por celda la banda
   * emitía 10.368 nodos —el 86 % de toda la página— y dejaba el hilo principal bloqueado casi un
   * segundo justo después de importar, que es el fallo con el que el prototipo se cayó en el
   * móvil. La celda se deduce de la posición del puntero, así que no hace falta ningún nodo
   * adicional, y una región viva se lee mejor con lector de pantalla que cinco mil títulos.
   */
  const readout = document.createElement("p");
  readout.className = "muted readout";
  readout.setAttribute("aria-live", "polite");
  const REPOSO = "Toca o pasa el puntero por la banda para leer una celda.";
  readout.textContent = REPOSO;
  inspect(
    canvas,
    (point) => {
      if (point === null) {
        readout.textContent = REPOSO;
        return;
      }
      const box = canvas.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const localX = ((point.clientX - box.left) * width) / box.width;
      const localY = ((point.clientY - box.top) * height) / box.height;
      const rowIndex = Math.floor(localY / (rowHeight + gap));
      const bin = Math.floor((localX - labelWidth) / cellWidth);
      const row = data.rows[rowIndex];
      if (row === undefined || bin < 0 || bin >= binCount) {
        readout.textContent = REPOSO;
        return;
      }
      const instant = format(data.binStarts[bin] ?? 0);
      const count = row.bins[bin] ?? 0;
      readout.textContent = uncovered.has(bin)
        ? `${row.agvId} · ${instant} — sin datos cargados`
        : count === 0
          ? `${row.agvId} · ${instant} — sin lecturas`
          : `${row.agvId} · ${instant} — ${count.toLocaleString("es-ES")} lecturas`;
    },
  );
  wrapper.append(readout);

  wrapper.append(
    legendList([
      ["var(--viz-1)", "pocas lecturas"],
      ["var(--viz-3)", "intermedio"],
      ["var(--viz-5)", "muchas"],
      ["var(--viz-empty)", "sin datos cargados"],
    ]),
  );
  wrapper.append(
    table(
      ["AGV", "Lecturas", "Tramos con actividad"],
      data.rows.map((row) => [
        row.agvId,
        row.total.toLocaleString("es-ES"),
        `${row.bins.filter((count) => count > 0).length} de ${binCount}`,
      ]),
    ),
  );
  return wrapper;
}

/** Cinco escalones de un solo tono: la magnitud se lee por claridad, no por matiz. */
function rampStep(value: number, max: number): string {
  const fraction = max <= 0 ? 0 : value / max;
  if (fraction <= 0.2) return "var(--viz-1)";
  if (fraction <= 0.4) return "var(--viz-2)";
  if (fraction <= 0.6) return "var(--viz-3)";
  if (fraction <= 0.8) return "var(--viz-4)";
  return "var(--viz-5)";
}

// --- 4. Inventario por clase ----------------------------------------------

export interface InventoryBar {
  readonly label: string;
  readonly count: number;
  readonly truth: string;
  readonly action: string;
}

/**
 * Los tags por clase del inventario contrastado.
 *
 * Barras de un solo tono **a propósito**: pintar `obsoleto-candidato` de rojo diría que es un
 * problema, y no lo es todavía — es una pregunta para el técnico. El estado de verdad y la acción
 * a valorar van escritos al lado, que es donde no se pueden malinterpretar.
 */
export function inventoryChart(bars: readonly InventoryBar[]): HTMLElement {
  const wrapper = figure(
    "Inventario de tags",
    "Lo declarado, lo que los AGV llevan en memoria y lo que se lee, cruzado. Cada clase dice " +
      "qué hay que comprobar.",
  );
  if (bars.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Carga las listas de tags para ver el inventario.";
    wrapper.append(empty);
    return wrapper;
  }

  // Primero la proporción que pide atención frente a la que no (Parte 38, propuesta 10); después
  // cada clase con su acción en la misma línea, que es lo que antes solo estaba en la tabla.
  const groupOf = (label: string): "ok" | "ctx" | "val" =>
    label === "activo" ? "ok" : label === "especial" ? "ctx" : "val";
  const groups: readonly (readonly ["ok" | "ctx" | "val", string, string])[] = [
    ["ok", "nada que valorar", "var(--viz-neutral)"],
    // Azul de serie y no naranja: ninguna clase del inventario lleva color de severidad (UX §5.2).
    ["val", "a valorar", "var(--viz-series)"],
    ["ctx", "fuera de toda tasa", "repeating-linear-gradient(135deg, var(--viz-empty) 0 2px, var(--panel) 2px 5px)"],
  ];
  const total = Math.max(1, bars.reduce((sum, bar) => sum + bar.count, 0));
  const strip = document.createElement("div");
  strip.className = "inv-strip";
  strip.setAttribute("role", "img");
  const stripLabels = document.createElement("ul");
  stripLabels.className = "legend";
  const summary: string[] = [];
  for (const [group, label, fill] of groups) {
    const count = bars.filter((bar) => groupOf(bar.label) === group).reduce((sum, bar) => sum + bar.count, 0);
    if (count === 0) continue;
    const part = document.createElement("div");
    part.style.flex = `${count} 1 0`;
    part.style.background = fill;
    strip.append(part);
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = fill;
    const caption = document.createElement("span");
    caption.textContent = `${label}: ${count} (${Math.round((count / total) * 100)} %)`;
    item.append(swatch, caption);
    stripLabels.append(item);
    summary.push(`${label} ${count}`);
  }
  strip.setAttribute("aria-label", `Inventario: ${summary.join(", ")}`);

  const rows = document.createElement("div");
  rows.className = "inv-rows";
  const max = Math.max(1, ...bars.map((bar) => bar.count));
  for (const bar of [...bars].sort((a, b) => b.count - a.count)) {
    const name = document.createElement("span");
    name.className = "inv-name";
    name.textContent = tagClassLabel(bar.label);
    const track = document.createElement("span");
    track.className = "inv-track";
    const fill = document.createElement("span");
    fill.className = "inv-bar";
    fill.style.width = `${(bar.count / max) * 100}%`;
    fill.style.background = groupOf(bar.label) === "val" ? "var(--viz-series)" : "var(--viz-neutral)";
    track.append(fill);
    const count = document.createElement("span");
    count.className = "inv-count";
    count.textContent = String(bar.count);
    const action = document.createElement("span");
    action.className = "inv-action muted";
    action.textContent = bar.action;
    rows.append(name, track, count, action);
  }

  wrapper.append(strip, stripLabels, rows);
  wrapper.append(
    table(
      ["Clase", "Tags", "Certeza", "Qué comprobar"],
      bars.map((bar) => [tagClassLabel(bar.label), String(bar.count), truthLabel(bar.truth), bar.action]),
    ),
  );
  return wrapper;
}
