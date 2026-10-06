/**
 * «Cortes wifi» (R-COM-004 a R-COM-008), en su propio módulo como las franjas: `main.ts` ya es muy
 * largo, y esta pestaña solo necesita de él cómo se dibuja una tarjeta y cómo se escribe una hora.
 *
 * Tres piezas: el resumen por clase de corte, el **mapa de calor** —tags en orden de ruta, un AGV por
 * columna, el color es cuántos cortes empezaron con ese tag como último leído— con los huecos de
 * lectura separados por causa, y la lista de cortes con su frase.
 */

import type { CircuitViews } from "../application/protocol.js";
import { CUT_CLASS_LABEL, SKIP_CAUSE_LABEL, type CutClass, type SkipCause } from "../domain/wifi-cuts.js";
import { lazyTable, plainTable, scrollBox } from "./charts.js";

export interface WifiUiDeps {
  readonly finding: (title: string, figure: string, evidence: string, review?: readonly string[]) => HTMLElement;
  readonly formatInstant: (utcMs: number) => string;
  readonly duration: (ms: number | null) => string;
}

type WifiView = NonNullable<CircuitViews["wifi"]>;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const CUT_CLASS_TEXT: Readonly<Record<CutClass, string>> = {
  microcorte: "Cortes cortos. El AGV ejecuta los tags desde su memoria; solo se pierde una orden del servidor si llega en ese instante.",
  "en-marcha": "Leyó tags durante el corte: siguió moviéndose y ejecutándolos. Lo que falte en el histórico es comunicación, no lectura.",
  "espera-servidor": "Se quedó en una parada precisa sin wifi esperando la orden de continuar. Si un temporizador lo hiciera continuar y la parada protege un cruce, podría ocuparlo.",
  parado: "No leyó durante el corte y reaparece en la ruta: estaba parado. No es una parada precisa declarada, o no hay ninguna declarada.",
  "fuera-del-recorrido": "Sin wifi no siguió la ruta: reaparece lejos u otros AGV lo adelantaron. Salió del recorrido (maniobra manual, cambio de batería…); no es un fallo de red del circuito.",
  apagado: "Se reconecta «tras apagado»: el AGV se apagó.",
  "sin-cierre": "El informe termina sin la reconexión.",
  "sin-lecturas": "No hay lecturas suyas antes del corte para situarlo.",
};

const SKIP_TEXT: Readonly<Record<SkipCause, string>> = {
  comunicacion: "el hueco cae dentro de un corte wifi: el tag se ejecutó, la lectura no llegó",
  lectura: "sin corte, y los demás AGV sí lo leen: apunta al lector de ese AGV",
  tag: "sin corte, y lo saltan varios AGV: apunta al tag",
  "sin-contraste": "sin corte, pero ningún otro AGV lee ese tag: no hay con qué comparar",
  "sin-informe": "AGV sin informe de conexiones: no se puede separar",
};

/** Escalón de color 0–5 para una celda con `count` cortes frente al máximo del mapa. */
function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil((5 * count) / max)));
}

function heatmapTable(view: WifiView, rows: WifiView["rows"]): HTMLElement {
  const table = node("table", "data wifi-heat");
  const head = node("tr");
  const headers = ["Pos.", "Tag", ...view.agvs.map((agv) => `AGV ${agv}`), "Cortes", "Por 100 pasadas", "Clase dominante", "Huecos: comunicación", "lectura", "tag", "sin contraste", "sin informe"];
  for (const label of headers) head.append(node("th", undefined, label));
  table.append(head);
  let max = 0;
  for (const row of rows) for (const count of Object.values(row.cutsByAgv)) max = Math.max(max, count);
  for (const row of rows) {
    const line = node("tr");
    line.append(node("td", "mono", row.position === null ? "—" : String(row.position)));
    const tag = node("td", "mono", row.tagId);
    if (row.preciseStop) {
      tag.append(node("span", "muted", " · parada precisa"));
    }
    line.append(tag);
    for (const agv of view.agvs) {
      const count = row.cutsByAgv[agv] ?? 0;
      const passes = row.passesByAgv[agv] ?? 0;
      const cell = node("td", `heat-${heatLevel(count, max)}`, count === 0 ? "" : String(count));
      cell.title = `AGV ${agv}: ${count} ${count === 1 ? "corte" : "cortes"} en ${passes} ${passes === 1 ? "pasada" : "pasadas"}`;
      line.append(cell);
    }
    line.append(node("td", undefined, String(row.cuts)));
    line.append(node("td", undefined, row.cutsPer100 === null ? "—" : row.cutsPer100.toFixed(1)));
    const dominant = Object.entries(row.byClass).sort((a, b) => b[1] - a[1])[0];
    line.append(node("td", undefined, dominant === undefined ? "" : CUT_CLASS_LABEL[dominant[0] as CutClass] ?? dominant[0]));
    for (const cause of ["comunicacion", "lectura", "tag", "sin-contraste", "sin-informe"] as const) {
      const count = row.skips[cause] ?? 0;
      line.append(node("td", count > 0 && (cause === "lectura" || cause === "tag") ? "flag" : undefined, count === 0 ? "" : String(count)));
    }
    table.append(line);
  }
  return table;
}

export function renderWifi(out: HTMLElement, views: CircuitViews, deps: WifiUiDeps): void {
  const view = views.wifi;
  if (view === undefined) return;
  out.append(node("h3", undefined, "Cortes wifi y huecos de lectura"));
  out.append(
    node(
      "p",
      "muted",
      `Informes de conexiones de ${view.agvs.length} ${view.agvs.length === 1 ? "AGV" : "AGV"} (${view.agvs.join(", ")}), ` +
        "cruzados con sus lecturas. Los tags están en la memoria del vehículo: sin wifi los sigue ejecutando, y lo único " +
        "que no recibe son las órdenes del servidor, como continuar en una parada precisa.",
    ),
  );
  for (const warning of view.warnings) out.append(node("p", "muted", warning));

  // Resumen por clase.
  const byClass = new Map<string, number>();
  for (const cut of view.cuts) byClass.set(cut.cutClass, (byClass.get(cut.cutClass) ?? 0) + 1);
  const cards = node("div");
  for (const cls of Object.keys(CUT_CLASS_TEXT) as CutClass[]) {
    const count = byClass.get(cls) ?? 0;
    if (count === 0) continue;
    cards.append(deps.finding(CUT_CLASS_LABEL[cls], String(count), CUT_CLASS_TEXT[cls]));
  }
  out.append(cards);

  // Huecos por causa.
  const skipLines = (["comunicacion", "lectura", "tag", "sin-contraste", "sin-informe"] as const)
    .filter((cause) => (view.skipsByCause[cause] ?? 0) > 0)
    .map((cause) => `${view.skipsByCause[cause]} por ${SKIP_CAUSE_LABEL[cause]}: ${SKIP_TEXT[cause]}.`);
  if (skipLines.length > 0) {
    out.append(node("h4", undefined, "Tags que faltan entre dos lecturas"));
    const list = node("ul");
    for (const line of skipLines) list.append(node("li", undefined, line));
    out.append(list);
  }

  // Mapa de calor: de entrada solo los tags con algún corte o hueco; la tabla completa, aparte.
  const marked = view.rows.filter((row) => row.cuts > 0 || Object.keys(row.skips).length > 0);
  out.append(node("h4", undefined, "Mapa de calor por tag, en orden de ruta"));
  out.append(
    node(
      "p",
      "muted",
      "Cada celda: cortes que empezaron con ese tag como el último que leyó ese AGV. Más oscuro, más cortes. " +
        "Los huecos de lectura van aparte por causa; «lectura» y «tag» se resaltan porque no los explica el wifi.",
    ),
  );
  out.append(scrollBox(heatmapTable(view, marked)));
  out.append(lazyTable(`Todos los tags (${view.rows.length})`, () => heatmapTable(view, view.rows)));

  // Lista de cortes.
  out.append(
    lazyTable(`Los ${view.cuts.length} cortes, uno por uno`, () =>
      plainTable(
        ["AGV", "Inicio", "Duración", "Último tag", "Reaparece en", "Lecturas durante", "Clase", "Datos Aux", "Lectura"],
        view.cuts.map((cut) => [
          cut.agvId,
          deps.formatInstant(cut.startUtcMs),
          deps.duration(cut.durationMs),
          cut.lastTagId ?? "—",
          cut.nextTagId ?? "—",
          String(cut.readsDuring),
          CUT_CLASS_LABEL[cut.cutClass as CutClass] ?? cut.cutClass,
          cut.aux,
          cut.evidence,
        ]),
      ),
    ),
  );
}
