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
  quarantine: readonly QuarantinedRow[];
  warnings: readonly string[];
  shown: number;
}

const state: State = {
  worker: null,
  jobId: null,
  summary: null,
  readings: [],
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
    [
      "Sentido de la fuente",
      `${directionName} (coherencia ${(summary.monotonicity.confidence * 100).toFixed(1)} %)`,
    ],
    ["Filas de datos", summary.totalRows.toLocaleString("es-ES")],
    ["Aceptadas", summary.acceptedRows.toLocaleString("es-ES")],
    ["En cuarentena", summary.quarantinedRows.toLocaleString("es-ES")],
    ["Tiempo de proceso", `${summary.elapsedMs.toLocaleString("es-ES")} ms`],
  ];

  const list = element("dl", "facts");
  for (const [term, value] of rows) {
    list.append(element("dt", undefined, term), element("dd", undefined, value));
  }
  summaryPanel.append(list);
}

function renderTableSkeleton(): void {
  tablePanel.replaceChildren();
  tablePanel.hidden = false;
  tablePanel.append(element("h2", undefined, "Lecturas normalizadas"));

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

  const end = Math.min(state.shown + PAGE_SIZE, state.readings.length);
  for (let index = state.shown; index < end; index += 1) {
    const reading = state.readings[index] as Reading;
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
    more.hidden = state.shown >= state.readings.length;
    more.textContent = `Mostrar más (${(state.readings.length - state.shown).toLocaleString("es-ES")} restantes)`;
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
      state.quarantine = message.quarantine;
      state.warnings = message.warnings;
      state.shown = 0;

      clearMessages();
      if (message.warnings.length > 0) {
        showMessage("warn", "Advertencias", message.warnings);
      }
      renderSummary(message.summary);
      renderTableSkeleton();
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
