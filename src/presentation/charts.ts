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
const HATCH_ID = "tt-hatch";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** Un valor importado nunca se interpreta como marcado (TH-007). */
function text(
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
  return node;
}

function hatchPattern(): SVGDefsElement {
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

function figure(title: string, caption: string): HTMLElement {
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
 * La tabla equivalente de un gráfico, plegada por defecto: es la vía accesible y el respaldo
 * cuando el color falla, no la vista principal.
 */
function table(headers: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Ver los mismos datos en tabla";
  details.append(summary, plainTable(headers, rows));
  return details;
}

function legendList(items: readonly (readonly [string, string])[]): HTMLElement {
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
    "Lo que se puede analizar. Fuera de los tramos llenos no hay silencio: no hay datos.",
  );
  if (coverage.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Todavía no hay ningún tramo completo.";
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
  label.textContent = `Cobertura entre ${format(from)} y ${format(to)}, en ${coverage.length} tramo(s).`;
  canvas.append(label);

  // El fondo entero es «sin datos cargados»; encima se pintan los tramos que sí lo están. Así el
  // hueco no hay que calcularlo: es lo que queda sin tapar.
  canvas.append(
    withTooltip(
      svg("rect", { x: 0, y: 8, width, height: 26, fill: `url(#${HATCH_ID})`, rx: 4 }),
      "Sin datos cargados: no se analiza, y nunca es una parada ni un silencio.",
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
  wrapper.append(canvas);
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
    `Lecturas por hora del día, sumando los ${data.days} día(s) cargados. Un valle no es una parada: ` +
      "distinguirlo exige el calendario.",
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
  wrapper.append(canvas);
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
    "Una fila por AGV. Más oscuro, más lecturas en ese tramo. Una celda con trama es falta de datos, " +
      "no silencio del vehículo.",
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
        // con su borde, distinto de la trama, y el tooltip lo dice con todas las letras.
        canvas.append(
          withTooltip(
            svg("rect", {
              x,
              y,
              width: cellWidth,
              height: rowHeight,
              fill: "transparent",
              stroke: "var(--viz-grid)",
            }),
            `${row.agvId} · ${format(data.binStarts[bin] ?? 0)} — sin lecturas, con datos cargados`,
          ),
        );
        return;
      }
      canvas.append(
        withTooltip(
          svg("rect", {
            x,
            y,
            width: Math.max(1, cellWidth - 1),
            height: rowHeight,
            fill: rampStep(count, data.maxPerBin),
          }),
          `${row.agvId} · ${format(data.binStarts[bin] ?? 0)} — ${count.toLocaleString("es-ES")} lecturas`,
        ),
      );
    });
  });

  const axisY = data.rows.length * (rowHeight + gap) + 14;
  canvas.append(text(labelWidth, axisY, format(data.binStarts[0] ?? 0), "axis"));
  canvas.append(
    text(width, axisY, format(data.binStarts[binCount - 1] ?? 0), "axis", { "text-anchor": "end" }),
  );

  wrapper.append(canvas);
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
    "Cruce de lo declarado, lo que la memoria permite leer y lo observado. Ninguna clase es un " +
      "diagnóstico: la última columna dice qué hay que valorar.",
  );
  if (bars.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Carga las listas de tags para contrastar el inventario.";
    wrapper.append(empty);
    return wrapper;
  }

  const width = WIDTH;
  const rowHeight = 24;
  const labelWidth = 150;
  const height = bars.length * rowHeight + 8;
  const max = Math.max(1, ...bars.map((bar) => bar.count));

  const canvas = svg("svg", { viewBox: `0 0 ${width} ${height}`, role: "img" });
  bars.forEach((bar, index) => {
    const y = index * rowHeight + 4;
    const barWidth = Math.max(bar.count === 0 ? 0 : 3, (bar.count / max) * (width - labelWidth - 44));
    canvas.append(text(0, y + 13, bar.label, "axis"));
    canvas.append(
      withTooltip(
        svg("rect", {
          x: labelWidth,
          y,
          width: barWidth,
          height: rowHeight - 8,
          rx: 4,
          fill: "var(--viz-series)",
        }),
        `${bar.label}: ${bar.count} tag(s) · ${bar.truth} · ${bar.action}`,
      ),
    );
    // Rótulo directo con la cifra: el gráfico da la proporción, el número da el dato exacto.
    canvas.append(text(labelWidth + barWidth + 6, y + 13, String(bar.count), "value"));
  });

  wrapper.append(canvas);
  wrapper.append(
    table(
      ["Clase", "Tags", "Estado de verdad", "Qué valorar"],
      bars.map((bar) => [bar.label, String(bar.count), bar.truth, bar.action]),
    ),
  );
  return wrapper;
}
