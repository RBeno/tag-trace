/**
 * Interfaz del importador mínimo (F1a·0).
 *
 * Sin marco, por ADR-0009: esto es un selector de fichero, una barra de progreso y una tabla.
 *
 * Lo que este módulo **no** importa es tan importante como lo que importa: no hay ninguna
 * referencia a `ingestion/`, así que la presentación no puede parsear ni analizar. Es la regla
 * WP-001/WP-002 sostenida por el grafo de dependencias y no por la disciplina de quien edita.
 */

import {
  PROTOCOL_VERSION,
  isCurrent,
  type FromWorker,
  type SourceSummary,
  type ToWorker,
} from "../application/protocol.js";
import type { QuarantinedRow, Reading } from "../domain/reading.js";

/** Zona horaria del piloto. Es configuración: vivirá en el circuito cuando exista (F1b). */
const ZONE = "Europe/Madrid";

/** Filas que se pintan de golpe. La tabla crece al desplazarse, no de una vez. */
const PAGE_SIZE = 200;

interface State {
  worker: Worker | null;
  jobId: string | null;
  summary: SourceSummary | null;
  readings: readonly Reading[];
  /** Lo que la tabla está mostrando: todas las lecturas, o las que pasan el filtro. */
  visible: readonly Reading[];
  quarantine: readonly QuarantinedRow[];
  warnings: readonly string[];
  shown: number;
}

const state: State = {
  worker: null,
  jobId: null,
  summary: null,
  readings: [],
  visible: [],
  quarantine: [],
  warnings: [],
  shown: 0,
};

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("Falta el contenedor #app");

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  // Siempre como texto: un valor importado nunca se interpreta como marcado (TH-007).
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatInstant(utcMs: number): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: ZONE,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(utcMs));
}

// --- Regiones de la página -------------------------------------------------

const header = element("header", "bar");
const title = element("h1", undefined, "TAG TRACE");
const subtitle = element("p", "muted", "Importador de lecturas · F1a·0");
header.append(title, subtitle);

const picker = element("section", "panel");
const fileInput = element("input");
fileInput.type = "file";
fileInput.accept = ".csv,.tsv,.txt,text/csv,text/plain";
fileInput.id = "source-file";
const fileLabel = element("label", undefined, "Fichero de lecturas");
fileLabel.htmlFor = "source-file";
const cancelButton = element("button", "danger", "Cancelar");
cancelButton.type = "button";
cancelButton.hidden = true;
picker.append(fileLabel, fileInput, cancelButton);

const progressPanel = element("section", "panel");
progressPanel.hidden = true;
const progressNote = element("p", "muted", "");
const progressBar = element("progress");
progressBar.max = 1;
progressBar.value = 0;
progressPanel.append(progressNote, progressBar);

const messagePanel = element("section", "panel");
messagePanel.hidden = true;

const summaryPanel = element("section", "panel");
summaryPanel.hidden = true;

const tablePanel = element("section", "panel");
tablePanel.hidden = true;

const agvFilter = element("input");
agvFilter.type = "search";
agvFilter.id = "filter-agv";
agvFilter.placeholder = "identificador exacto";
agvFilter.inputMode = "numeric";
const tagFilter = element("input");
tagFilter.type = "search";
tagFilter.id = "filter-tag";
tagFilter.placeholder = "identificador exacto";
tagFilter.inputMode = "numeric";
const filterNote = element("p", "muted", "");
agvFilter.addEventListener("input", () => applyFilter());
tagFilter.addEventListener("input", () => applyFilter());

app.append(header, picker, progressPanel, messagePanel, summaryPanel, tablePanel);

// --- Presentación ----------------------------------------------------------

function showMessage(kind: "error" | "warn" | "info", heading: string, lines: readonly string[]): void {
  messagePanel.replaceChildren();
  messagePanel.hidden = false;
  messagePanel.className = `panel message ${kind}`;
  messagePanel.append(element("h2", undefined, heading));
  for (const line of lines) messagePanel.append(element("p", undefined, line));
}

function clearMessages(): void {
  messagePanel.replaceChildren();
  messagePanel.hidden = true;
}

function renderSummary(summary: SourceSummary): void {
  summaryPanel.replaceChildren();
  summaryPanel.hidden = false;
  summaryPanel.append(element("h2", undefined, "Fuente"));

  const delimiterName =
    summary.delimiter === "\t" ? "tabulador" : summary.delimiter === ";" ? "punto y coma" : "coma";
  /**
   * Los pares de un mismo vehículo que el reloj no ordena, con su peso sobre el total.
   *
   * Se dice lo que significan, no solo cuántos son: un recuento sin su consecuencia invita a
   * leerlo como un defecto de la fuente, y no lo es — es el límite de lo que la fuente afirma.
   */
  const describeSameInstant = (facts: SourceSummary): string => {
    if (facts.vehiclePairs === 0) return "sin pares que comparar";
    if (facts.sameInstantPairs === 0) return "ninguno: el reloj ordena toda la secuencia";
    const share = ((facts.sameInstantPairs / facts.vehiclePairs) * 100).toFixed(1);
    return (
      `${facts.sameInstantPairs.toLocaleString("es-ES")} de ` +
      `${facts.vehiclePairs.toLocaleString("es-ES")} (${share} %) — su orden lo da la posición en ` +
      "el fichero, no el reloj"
    );
  };

  const directionName =
    summary.direction === "newest-first"
      ? "pila: lo más reciente primero"
      : summary.direction === "oldest-first"
        ? "cronológico ascendente"
        : "indeterminado";

  const rows: readonly (readonly [string, string])[] = [
    ["Fichero", summary.fileName],
    ["Hash", `${summary.sourceHash.slice(0, 16)}…`],
    ["Separador", `${delimiterName} (confianza ${(summary.delimiterConfidence * 100).toFixed(0)} %)`],
    ["Columnas", summary.header.join(" · ")],
    [
      "Formato de fecha",
      `${summary.fieldOrder === "day-first" ? "día/mes" : "mes/día"} — ${summary.fieldOrderEvidence}`,
    ],
    ["Zona horaria", summary.zone],
    ["Codificación", summary.encoding],
    [
      "Observado",
      `${formatInstant(summary.observedFrom)} → ${formatInstant(summary.observedTo)} ` +
        `(${(((summary.observedTo - summary.observedFrom) / 3_600_000) || 0).toFixed(1)} h)`,
    ],
    [
      "Sentido de la fuente",
      `${directionName} (coherencia ${(summary.monotonicity.confidence * 100).toFixed(1)} %)`,
    ],
    // El reloj no ordena dentro de un instante: ahí manda la posición en el fichero, que es
    // `inferred` (R-DAT-013). Se cuenta **por vehículo**, que es donde amenaza a la topología;
    // dos AGV distintos leyendo a la vez es lo normal y no dice nada.
    ["Mismo instante, mismo vehículo", describeSameInstant(summary)],
    ["Filas de datos", summary.totalRows.toLocaleString("es-ES")],
    ["Aceptadas", summary.acceptedRows.toLocaleString("es-ES")],
    // Se separan a propósito: una fila sin tag no es una fila rota, y mezclarlas haría parecer
    // averiada una fuente que solo trae eventos además de lecturas.
    ["Sin tag (no son lecturas)", summary.rowsWithoutTag.toLocaleString("es-ES")],
    ["En cuarentena", summary.quarantinedRows.toLocaleString("es-ES")],
    ["Tiempo de proceso", `${summary.elapsedMs.toLocaleString("es-ES")} ms`],
  ];

  const list = element("dl", "facts");
  for (const [term, value] of rows) {
    list.append(element("dt", undefined, term), element("dd", undefined, value));
  }
  summaryPanel.append(list);
}

/**
 * Filtro por AGV y por tag.
 *
 * Es la vía de trabajo declarada como principal —«qué le pasa al 3524»— y sin ella una importación
 * de sesenta mil filas no responde a ninguna pregunta: son trescientas pulsaciones de «mostrar más»
 * para llegar al final.
 *
 * La comparación es **exacta sobre el texto recortado**, nunca numérica ni parcial: `0040` y `40`
 * son identificadores distintos (INV-002) y una coincidencia parcial mezclaría `2032` con `20321`.
 */
function applyFilter(): void {
  const agv = agvFilter.value.trim();
  const tag = tagFilter.value.trim();
  state.visible =
    agv === "" && tag === ""
      ? state.readings
      : state.readings.filter(
          (entry) => (agv === "" || entry.agvId === agv) && (tag === "" || entry.tagId === tag),
        );
  state.shown = 0;
  const body = tablePanel.querySelector("tbody");
  if (body !== null) body.replaceChildren();
  renderCount();
  appendRows();
}

function renderCount(): void {
  const total = state.readings.length.toLocaleString("es-ES");
  const shown = state.visible.length.toLocaleString("es-ES");
  filterNote.textContent =
    state.visible.length === state.readings.length
      ? `${total} lecturas`
      : state.visible.length === 0
        ? `Ninguna de las ${total} lecturas coincide. El identificador se compara entero: los ceros iniciales cuentan.`
        : `${shown} de ${total} lecturas`;
}

function renderTableSkeleton(): void {
  tablePanel.replaceChildren();
  tablePanel.hidden = false;
  tablePanel.append(element("h2", undefined, "Lecturas normalizadas"));

  const filters = element("div", "filters");
  const agvLabel = element("label", undefined, "AGV");
  agvLabel.htmlFor = "filter-agv";
  const tagLabel = element("label", undefined, "Tag");
  tagLabel.htmlFor = "filter-tag";
  filters.append(agvLabel, agvFilter, tagLabel, tagFilter);
  tablePanel.append(filters, filterNote);

  const table = element("table", "readings");
  const head = element("thead");
  const headRow = element("tr");
  for (const label of ["Instante", "AGV", "Tag", "Fila origen", "Original"]) {
    headRow.append(element("th", undefined, label));
  }
  head.append(headRow);
  table.append(head, element("tbody"));
  tablePanel.append(table);

  const more = element("button", undefined, "Mostrar más");
  more.type = "button";
  more.id = "show-more";
  more.addEventListener("click", () => appendRows());
  tablePanel.append(more);
}

function appendRows(): void {
  const body = tablePanel.querySelector("tbody");
  if (body === null) return;

  const end = Math.min(state.shown + PAGE_SIZE, state.visible.length);
  for (let index = state.shown; index < end; index += 1) {
    const reading = state.visible[index] as Reading;
    const row = element("tr");
    if (reading.time.flag !== "ok") row.className = "flagged";

    row.append(element("td", undefined, formatInstant(reading.time.utcMs)));
    row.append(element("td", "mono", reading.agvId));
    row.append(element("td", "mono", reading.tagId));
    // La procedencia es navegable: la fila física del fichero está siempre a la vista.
    row.append(element("td", "mono", String(reading.provenance.sourceRow)));
    row.append(element("td", "mono raw", reading.time.raw));
    body.append(row);
  }
  state.shown = end;

  const more = tablePanel.querySelector<HTMLButtonElement>("#show-more");
  if (more !== null) {
    more.hidden = state.shown >= state.visible.length;
    more.textContent = `Mostrar más (${(state.visible.length - state.shown).toLocaleString("es-ES")} restantes)`;
  }
}

function setBusy(busy: boolean): void {
  fileInput.disabled = busy;
  cancelButton.hidden = !busy;
  progressPanel.hidden = !busy;
}

// --- Ciclo de vida del trabajo --------------------------------------------

function disposeWorker(): void {
  state.worker?.terminate();
  state.worker = null;
  state.jobId = null;
}

function handleMessage(message: FromWorker): void {
  // WP-003: un mensaje de un trabajo caducado se descarta sin tocar el estado.
  if (state.jobId === null || !isCurrent(message, state.jobId)) return;

  switch (message.type) {
    case "accepted":
      progressNote.textContent = "Trabajo aceptado por el proceso auxiliar";
      return;

    case "progress":
      progressNote.textContent =
        message.total > 1
          ? `${message.note} — ${message.done.toLocaleString("es-ES")} de ${message.total.toLocaleString("es-ES")}`
          : message.note;
      progressBar.value = message.total === 0 ? 0 : message.done / message.total;
      return;

    case "complete": {
      state.summary = message.summary;
      state.readings = message.readings;
      state.visible = message.readings;
      state.quarantine = message.quarantine;
      state.warnings = message.warnings;
      state.shown = 0;

      clearMessages();
      if (message.warnings.length > 0) {
        showMessage("warn", "Advertencias", message.warnings);
      }
      renderSummary(message.summary);
      renderTableSkeleton();
      agvFilter.value = "";
      tagFilter.value = "";
      renderCount();
      appendRows();
      setBusy(false);
      disposeWorker();
      return;
    }

    case "error": {
      // WP-005: cero filas es una respuesta legítima, y llega siempre con causa y recuperación.
      const lines = [message.cause, message.recovery];
      if (message.detectedSchema !== undefined) {
        lines.push(`Esquema detectado: ${message.detectedSchema.join(" · ")}`);
      }
      if (message.sampleRows !== undefined) {
        lines.push(...message.sampleRows.map((row) => `Ejemplo: ${row}`));
      }
      showMessage("error", `No se pudo importar (${message.code})`, lines);
      setBusy(false);
      disposeWorker();
      return;
    }

    case "cancelled":
      showMessage("info", "Importación cancelada", [
        `Se detuvo en la etapa «${message.stage}». Las fuentes y el estado anterior quedan intactos.`,
      ]);
      setBusy(false);
      disposeWorker();
      return;
  }
}

function startImport(file: File): void {
  disposeWorker();
  clearMessages();
  summaryPanel.hidden = true;
  tablePanel.hidden = true;

  const jobId = crypto.randomUUID();
  const worker = new Worker(new URL("../../workers/import.worker.ts", import.meta.url), {
    type: "module",
  });
  state.worker = worker;
  state.jobId = jobId;

  worker.onmessage = (event: MessageEvent<FromWorker>) => handleMessage(event.data);
  worker.onerror = () => {
    // No hay cálculo de repuesto en el hilo principal (WP-002): si el Worker cae, se informa.
    showMessage("error", "El proceso auxiliar se detuvo", [
      "La importación no llegó a completarse.",
      "Vuelve a seleccionar el fichero. El estado anterior no se ha modificado.",
    ]);
    setBusy(false);
    disposeWorker();
  };

  setBusy(true);
  progressNote.textContent = "Preparando";
  progressBar.value = 0;

  const start: ToWorker = { type: "start", protocolVersion: PROTOCOL_VERSION, jobId, file, zone: ZONE };
  worker.postMessage(start);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file !== undefined) startImport(file);
});

cancelButton.addEventListener("click", () => {
  if (state.worker === null || state.jobId === null) return;
  progressNote.textContent = "Cancelando…";
  const cancel: ToWorker = {
    type: "cancel",
    protocolVersion: PROTOCOL_VERSION,
    jobId: state.jobId,
    reason: "petición del usuario",
  };
  state.worker.postMessage(cancel);
});
