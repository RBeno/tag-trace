/**
 * El informe del circuito (FR-026, UX_SPEC §4.8): un solo fichero HTML, autocontenido, que se descarga
 * y se abre en cualquier navegador sin red, y que «Imprimir → Guardar como PDF» convierte en PDF.
 *
 * Se monta **desde lo que la pantalla ya enseña**, no desde un segundo cálculo: cada sección es una
 * copia limpia de su pestaña —sin botones, sin controles, con los `canvas` convertidos en imagen y las
 * tablas del cajón desplegadas si se piden—, y los hallazgos son las tarjetas de la bandeja con su
 * estado de revisión. Así el informe dice exactamente lo que dijo la aplicación (R-EVI-007), y lo que
 * no se calculó no aparece.
 *
 * Quien lo pide elige qué entra (como un analizador de red monta su informe por secciones): las
 * pestañas, qué hallazgos (todos con su estado, o solo los de un estado) y si va el anexo de tablas.
 * La conclusión va primero (FR-028); la trazabilidad —versión de la aplicación, cobertura, ficheros,
 * memoria vigente, fecha— al principio y al final. Nada sale del dispositivo: la descarga es un
 * `Blob` local (NFR-001).
 */

import { REVIEW_LABEL, REVIEW_STATES, type ReviewState } from "../domain/review.js";
import { RANK_LABEL, findingKindOf, type FindingRank } from "../domain/finding-kinds.js";
import { drawerBuilder } from "./drawer.js";
import type { CaseView } from "../application/protocol.js";
import { casesSummaryHtml } from "./case-report.js";
import { escapeHtml, formatHours, reportFileName, type Status } from "./report-text.js";

export interface ReportSection {
  /** Identificador estable (el de la pestaña): `tags`, `agv`, `wifi`… */
  readonly id: string;
  readonly label: string;
  /** El contenido de la pestaña, tal como está en la página. */
  readonly panel: HTMLElement;
  /** `false` si no hay nada que enseñar (la WiFi sin registro). */
  readonly available: boolean;
}

export interface ReportSource {
  readonly circuitId: string;
  readonly appVersion: string;
  readonly coverage: readonly { readonly from: number; readonly to: number }[];
  readonly files: readonly string[];
  readonly memoryVersion: number | null;
  readonly status: Status;
  /** La tira de cifras del Resumen. */
  readonly tiles: HTMLElement;
  /** Los avisos del Resumen, si los hay. */
  readonly notices: HTMLElement | null;
  /** La bandeja con las tarjetas revisables (`data-tab`, `data-review`, `data-kind`). */
  readonly tray: HTMLElement;
  readonly sections: readonly ReportSection[];
  /** Los expedientes de incidencia del circuito (ADR-0018 D11), para su resumen. */
  readonly cases: readonly CaseView[];
  readonly formatInstant: (utcMs: number) => string;
}

export interface ReportSelection {
  readonly sections: ReadonlySet<string>;
  /** `null` = todos los hallazgos, cada uno con su estado. */
  readonly review: ReviewState | null;
  readonly tables: boolean;
  /** Si va el resumen de los expedientes de incidencia. */
  readonly cases: boolean;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className !== undefined) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * Una copia de un trozo de la página lista para el informe: sin nada que se pulse, con los enlaces
 * convertidos en texto, los `details` abiertos, lo escondido fuera y cada `canvas` como imagen.
 */
export function cleanClone(original: HTMLElement): HTMLElement {
  const clone = original.cloneNode(true) as HTMLElement;
  const originalCanvases = [...original.querySelectorAll("canvas")];
  const cloneCanvases = [...clone.querySelectorAll("canvas")];
  cloneCanvases.forEach((canvas, index) => {
    const source = originalCanvases[index];
    const img = node("img");
    img.alt = canvas.getAttribute("aria-label") ?? "";
    try {
      if (source !== undefined) img.src = source.toDataURL("image/png");
    } catch {
      // Un lienzo que no se puede leer (contaminado) se queda sin imagen: mejor vacío que roto.
    }
    if (source !== undefined) {
      img.width = source.width;
      img.height = source.height;
    }
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    canvas.replaceWith(img);
  });
  for (const gone of clone.querySelectorAll("button, input, select, textarea, .review, .findings-elsewhere, .theme-filter, [role='radiogroup'], .drawer-open, .evolution-host:empty, [hidden]")) {
    gone.remove();
  }
  for (const link of clone.querySelectorAll("a")) {
    const span = node("span", undefined, link.textContent ?? "");
    link.replaceWith(span);
  }
  for (const details of clone.querySelectorAll("details")) details.open = true;
  for (const el of clone.querySelectorAll<HTMLElement>("[tabindex]")) el.removeAttribute("tabindex");
  clone.removeAttribute("id");
  clone.removeAttribute("hidden");
  return clone;
}

/** Las reglas de estilo de la propia aplicación, para que el informe se vea como ella sin pedir nada fuera. */
export function appCss(): string {
  const rules: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) rules.push(rule.cssText);
    } catch {
      // Una hoja de otro origen no se puede leer; no hay ninguna en la aplicación, pero no se rompe por ella.
    }
  }
  return rules.join("\n");
}

const REPORT_CSS = `
body { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
.report-header { border-bottom: 1px solid var(--line, #ccc); padding-bottom: 12px; margin-bottom: 20px; }
.report-header h1 { font-size: 1.5rem; margin: 0 0 4px; }
.report-header .report-kicker { margin: 0; color: var(--muted, #666); }
.report-meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0 0; font-size: 0.9rem; }
.report-meta dt { color: var(--muted, #666); }
.report-meta dd { margin: 0; }
.report-status { font-size: 1.1rem; font-weight: 600; margin: 0 0 4px; }
.report-status-detail { margin: 0 0 12px; color: var(--muted, #666); }
.report-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px 16px; margin: 8px 0 16px; }
.report-tiles div { border-left: 3px solid var(--line, #ccc); padding-left: 10px; }
.report-tiles dt { font-size: 0.8rem; color: var(--muted, #666); }
.report-tiles dd { margin: 0; font-size: 1.3rem; font-weight: 600; }
.report-tiles dd small { display: block; font-size: 0.8rem; font-weight: 400; color: var(--muted, #666); }
.report-section { margin-top: 28px; padding-top: 8px; border-top: 1px solid var(--line, #ccc); break-before: page; }
.report-section > h2 { font-size: 1.25rem; }
.report-findings h3 { margin-top: 20px; }
.report-review { font-size: 0.85rem; color: var(--muted, #666); margin: 0 0 2px; }
.report-table { margin: 16px 0; }
.report-table h4 { margin: 0 0 4px; font-size: 0.95rem; }
.case-report-table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
.case-report-table th, .case-report-table td { text-align: left; padding: 3px 8px 3px 0; vertical-align: top; border-bottom: 1px solid var(--line, #ddd); }
.report-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid var(--line, #ccc); font-size: 0.85rem; color: var(--muted, #666); }
.tabpanel, .panel { background: transparent; border: none; padding: 0; box-shadow: none; }
figure.chart { break-inside: avoid; }
.finding { break-inside: avoid; }
@media print {
  body { padding: 0; }
  .report-section { break-before: page; }
  a { color: inherit; text-decoration: none; }
}
`;

function tilesAsList(tiles: HTMLElement): string {
  const items = [...tiles.querySelectorAll<HTMLElement>(".tile")].map((tile) => {
    const label = tile.querySelector(".tile-label")?.textContent ?? "";
    const value = tile.querySelector(".tile-value")?.textContent ?? "";
    const note = tile.querySelector(".tile-note")?.textContent ?? "";
    return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}<small>${escapeHtml(note)}</small></dd></div>`;
  });
  return `<dl class="report-tiles">${items.join("")}</dl>`;
}

function coverageText(source: ReportSource): { hours: number; span: string } {
  const hours = source.coverage.reduce((sum, span) => sum + Math.max(0, span.to - span.from), 0) / 3_600_000;
  const first = source.coverage.reduce<number | null>((min, span) => (min === null || span.from < min ? span.from : min), null);
  const last = source.coverage.reduce<number | null>((max, span) => (max === null || span.to > max ? span.to : max), null);
  const span = first === null || last === null ? "sin cobertura" : `de ${source.formatInstant(first)} a ${source.formatInstant(last)}`;
  return { hours, span };
}

function findingsHtml(source: ReportSource, selection: ReportSelection): { html: string; counts: Record<ReviewState, number>; total: number } {
  const counts: Record<ReviewState, number> = { pendiente: 0, confirmado: 0, descartado: 0, pospuesto: 0 };
  const byRank = new Map<FindingRank, HTMLElement[]>();
  let total = 0;
  for (const card of source.tray.querySelectorAll<HTMLElement>(".finding.reviewable")) {
    const tab = card.dataset["tab"] ?? "";
    if (!selection.sections.has(tab)) continue;
    const state = (card.dataset["review"] ?? "pendiente") as ReviewState;
    if (selection.review !== null && state !== selection.review) continue;
    counts[state] += 1;
    total += 1;
    const rank = findingKindOf(card.dataset["kind"] ?? "").rank;
    const clone = cleanClone(card);
    clone.hidden = false;
    const review = node("p", "report-review", `Revisión en campo: ${REVIEW_LABEL[state].icon} ${REVIEW_LABEL[state].text}`);
    const note = card.querySelector<HTMLElement>(".review .review-note");
    const noteText = note instanceof HTMLInputElement || note instanceof HTMLTextAreaElement ? note.value.trim() : (note?.textContent ?? "").trim();
    if (noteText !== "") review.append(` — ${noteText}`);
    const where = clone.querySelector(".finding-where");
    if (where !== null) where.after(review);
    else clone.prepend(review);
    const list = byRank.get(rank) ?? [];
    list.push(clone);
    byRank.set(rank, list);
  }
  const parts: string[] = [];
  for (const rank of [1, 2, 3] as const) {
    const cards = byRank.get(rank);
    if (cards === undefined || cards.length === 0) continue;
    parts.push(`<h3>${escapeHtml(RANK_LABEL[rank])} · ${cards.length}</h3>`);
    parts.push(cards.map((card) => card.outerHTML).join("\n"));
  }
  if (total === 0) {
    parts.push(
      `<p class="muted">${
        selection.review === null
          ? "Ningún hallazgo en las secciones elegidas."
          : `Ningún hallazgo ${REVIEW_LABEL[selection.review].text.toLowerCase()} en las secciones elegidas.`
      }</p>`,
    );
  }
  return { html: parts.join("\n"), counts, total };
}

function sectionHtml(section: ReportSection, withTables: boolean): string {
  const clone = cleanClone(section.panel);
  // El título de la pestaña ya es el de la sección del informe; el índice de problemas se queda, sin enlaces.
  for (const heading of clone.querySelectorAll(":scope > h2")) heading.remove();
  const parts = [`<section class="report-section" id="seccion-${escapeHtml(section.id)}"><h2>${escapeHtml(section.label)}</h2>`, clone.innerHTML];
  if (withTables) {
    const tables: string[] = [];
    for (const button of section.panel.querySelectorAll<HTMLElement>(".drawer-open")) {
      const builder = drawerBuilder(button);
      if (builder === undefined) continue;
      try {
        const built = cleanClone(builder.build());
        tables.push(`<div class="report-table"><h4>${escapeHtml(builder.label.replace(/^Ver /, ""))}</h4>${built.outerHTML}</div>`);
      } catch {
        tables.push(`<div class="report-table"><h4>${escapeHtml(builder.label)}</h4><p class="muted">No se pudo construir esta tabla.</p></div>`);
      }
    }
    if (tables.length > 0) parts.push(`<h3>Tablas de ${escapeHtml(section.label)}</h3>`, tables.join("\n"));
  }
  parts.push("</section>");
  return parts.join("\n");
}

export function buildReportHtml(source: ReportSource, selection: ReportSelection): string {
  const now = Date.now();
  const coverage = coverageText(source);
  const findings = findingsHtml(source, selection);
  const chosen = source.sections.filter((section) => section.available && selection.sections.has(section.id));
  const meta: readonly (readonly [string, string])[] = [
    ["Generado", source.formatInstant(now)],
    ["Cobertura", `${formatHours(coverage.hours)}, ${coverage.span}`],
    ["Ficheros", source.files.length === 0 ? "—" : source.files.join(", ")],
    ["Memoria consolidada", source.memoryVersion === null ? "sin consolidar" : `v${source.memoryVersion}`],
    ["Aplicación", `TAG TRACE ${source.appVersion}`],
    ["Secciones", [...chosen.map((section) => section.label), ...(selection.cases ? ["expedientes de incidencia"] : [])].join(", ") || "solo el resumen"],
    [
      "Hallazgos",
      selection.review === null ? "todos, cada uno con su estado de revisión" : `solo ${REVIEW_LABEL[selection.review].text.toLowerCase()}s`,
    ],
  ];
  const reviewSummary = REVIEW_STATES.map((state) => `${REVIEW_LABEL[state].icon} ${findings.counts[state]} ${REVIEW_LABEL[state].text.toLowerCase()}`).join(" · ");
  const parts: string[] = [];
  parts.push(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`);
  parts.push(`<title>Informe TAG TRACE · ${escapeHtml(source.circuitId)}</title>`);
  parts.push(`<style>${appCss()}\n${REPORT_CSS}</style></head><body>`);
  parts.push(`<header class="report-header"><p class="report-kicker">TAG TRACE · informe del análisis</p><h1>Circuito «${escapeHtml(source.circuitId)}»</h1>`);
  parts.push(`<dl class="report-meta">${meta.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("")}</dl></header>`);
  parts.push(`<section id="conclusion"><h2>Conclusión</h2><p class="report-status report-status-${source.status.tone}">${escapeHtml(source.status.headline)}</p><p class="report-status-detail">${escapeHtml(source.status.detail)}</p>`);
  parts.push(tilesAsList(source.tiles), "</section>");
  if (source.notices !== null) {
    const notices = cleanClone(source.notices);
    for (const heading of notices.querySelectorAll("h3")) heading.remove();
    parts.push(`<section class="report-section" id="avisos"><h2>Avisos</h2>${notices.innerHTML}</section>`);
  }
  parts.push(`<section class="report-section report-findings" id="hallazgos"><h2>Hallazgos · ${findings.total}</h2><p class="muted">${escapeHtml(reviewSummary)}. Cada tarjeta dice qué se midió y dónde; la causa no la dice el dato.</p>${findings.html}</section>`);
  if (selection.cases) {
    parts.push(`<section class="report-section" id="expedientes"><h2>Expedientes de incidencia · ${source.cases.length}</h2>${casesSummaryHtml(source.cases, source.formatInstant)}</section>`);
  }
  for (const section of chosen) parts.push(sectionHtml(section, selection.tables));
  parts.push(
    `<footer class="report-footer"><p>Generado por TAG TRACE ${escapeHtml(source.appVersion)} el ${escapeHtml(source.formatInstant(now))} en este dispositivo: ningún dato salió de él. ` +
      `Los hallazgos nombran evidencia, no causas (R-EVI-006); su estado de revisión es el de la revisión en campo en el momento de generar el informe. ` +
      `Una exportación es una instantánea: el análisis sigue vivo en la aplicación.</p></footer>`,
  );
  parts.push("</body></html>");
  return parts.join("\n");
}

/** Descarga el informe como fichero HTML y devuelve su nombre. */
export function downloadReport(source: ReportSource, selection: ReportSelection): string {
  const html = buildReportHtml(source, selection);
  const name = reportFileName(source.circuitId, new Date());
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/**
 * El cuadro «Generar informe»: qué secciones, qué hallazgos y si va el anexo de tablas. Lo que no hay
 * no se ofrece (la WiFi sin registro); por defecto va todo lo disponible, con todos los hallazgos y
 * sin tablas, que es el informe que se lee; el anexo se pide a propósito porque puede ser largo.
 */
export function openReportDialog(getSource: () => ReportSource, onDone: (fileName: string) => void): void {
  const source = getSource();
  const dialog = node("dialog", "report-dialog");
  dialog.setAttribute("aria-labelledby", "report-dialog-title");
  const form = node("form");
  form.method = "dialog";
  form.append(node("h2", undefined, "Generar informe"));
  (form.firstElementChild as HTMLElement).id = "report-dialog-title";
  form.append(
    node(
      "p",
      "muted",
      "Un solo fichero HTML con lo que la aplicación enseña ahora: la conclusión, los avisos, los hallazgos con su estado de revisión y las secciones que elijas. Se abre sin red y se imprime a PDF desde el navegador.",
    ),
  );

  const sections = node("fieldset");
  sections.append(node("legend", undefined, "Secciones"));
  for (const section of source.sections) {
    const label = node("label", "report-option");
    const box = node("input");
    box.type = "checkbox";
    box.name = "section";
    box.value = section.id;
    box.checked = section.available;
    box.disabled = !section.available;
    label.append(box, ` ${section.label}${section.available ? "" : " (sin datos cargados)"}`);
    sections.append(label);
  }
  form.append(sections);

  const review = node("fieldset");
  review.append(node("legend", undefined, "Hallazgos"));
  for (const [value, text] of [["", "Todos, cada uno con su estado de revisión"], ...REVIEW_STATES.map((state) => [state, `Solo ${REVIEW_LABEL[state].text.toLowerCase()}s`] as const)] as const) {
    const label = node("label", "report-option");
    const radio = node("input");
    radio.type = "radio";
    radio.name = "review";
    radio.value = value;
    radio.checked = value === "";
    label.append(radio, ` ${text}`);
    review.append(label);
  }
  form.append(review);

  const tablesLabel = node("label", "report-option");
  const tablesBox = node("input");
  tablesBox.type = "checkbox";
  tablesBox.name = "tables";
  tablesLabel.append(tablesBox, " Anexo con las tablas completas de cada sección (puede ser largo)");
  form.append(tablesLabel);

  // Los expedientes (ADR-0018 D11): un resumen, uno por fila; cada uno tiene además su propio informe.
  const casesLabel = node("label", "report-option");
  const casesBox = node("input");
  casesBox.type = "checkbox";
  casesBox.name = "cases";
  casesBox.checked = source.cases.length > 0;
  casesBox.disabled = source.cases.length === 0;
  casesLabel.append(casesBox, ` Resumen de los expedientes de incidencia${source.cases.length === 0 ? " (no hay ninguno)" : ` (${source.cases.length})`}`);
  form.append(casesLabel);

  const actions = node("div", "report-actions");
  const cancel = node("button", undefined, "Cancelar");
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const generate = node("button", "primary", "Generar y descargar");
  generate.type = "submit";
  actions.append(cancel, generate);
  form.append(actions);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const chosen = new Set(data.getAll("section").map(String));
    const reviewValue = String(data.get("review") ?? "");
    const selection: ReportSelection = {
      sections: chosen,
      review: (REVIEW_STATES as readonly string[]).includes(reviewValue) ? (reviewValue as ReviewState) : null,
      tables: data.get("tables") !== null,
      cases: data.get("cases") !== null,
    };
    const name = downloadReport(getSource(), selection);
    dialog.close();
    onDone(name);
  });
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(form);
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}
