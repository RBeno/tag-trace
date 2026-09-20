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
  type AccumulationReport,
  type CircuitViews,
  type FromWorker,
  type SourceSummary,
  type ToWorker,
} from "../application/protocol.js";
import { EXPECTED_STRUCTURE, LIST_PURPOSE } from "../domain/tag-lists.js";
import { activityChart, coverageChart, hourlyChart, inventoryChart, plainTable } from "./charts.js";
import type { QuarantinedRow, Reading } from "../domain/reading.js";
import type { FieldOrder } from "../domain/time.js";
import { ProjectError, readProject, writeProject } from "../persistence/agvproj.js";
import { isAvailable, loadCircuit } from "../persistence/store.js";

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
  /** El último fichero elegido, para poder reintentar con el orden de fecha que fije el usuario. */
  file: File | null;
  /** Cobertura del circuito, que las vistas necesitan para dibujar los huecos como lo que son. */
  coverage: readonly { readonly from: number; readonly to: number }[];
  /** Últimas vistas recibidas: el expediente y el replay se consultan sobre ellas, ya calculadas. */
  views: CircuitViews | null;
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
  file: null,
  coverage: [],
  views: null,
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
const subtitle = element(
  "p",
  "muted",
  "Diagnóstico local de circuitos AGV · análisis y evidencia, nunca control",
);
header.append(title, subtitle);

const picker = element("section", "panel");
const fileInput = element("input");
fileInput.type = "file";
fileInput.accept = ".csv,.tsv,.txt,text/csv,text/plain";
fileInput.id = "source-file";
const fileLabel = element("label", undefined, "Fichero de lecturas");
fileLabel.htmlFor = "source-file";

// El circuito es lo que convierte «importar un fichero» en «acumular». Con una ventana de servidor
// de pocos días, lo que no se acumule aquí se pierde: por eso el campo va junto al selector y no
// escondido en una pantalla aparte.
const circuitInput = element("input");
circuitInput.type = "text";
circuitInput.id = "circuit-name";
circuitInput.placeholder = "por ejemplo, PC2";
const circuitLabel = element("label", undefined, "Acumular en el circuito");
circuitLabel.htmlFor = "circuit-name";
const exportButton = element("button", undefined, "Exportar .agvproj");
exportButton.type = "button";
const projectInput = element("input");
projectInput.type = "file";
projectInput.accept = ".agvproj";
projectInput.id = "project-file";
const projectLabel = element("label", undefined, "Abrir un .agvproj");
projectLabel.htmlFor = "project-file";
const cancelButton = element("button", "danger", "Cancelar");
cancelButton.type = "button";
cancelButton.hidden = true;
picker.append(fileLabel, fileInput, circuitLabel, circuitInput, cancelButton);
const projectPanel = element("section", "panel");
projectPanel.append(element("h2", undefined, "Proyecto"), exportButton, projectLabel, projectInput);

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

/**
 * Las listas de tags del circuito, con su estructura a la vista **antes** de pedir el fichero.
 *
 * No hay forma de descargarlas del sistema de planta: se escriben a mano. Cuando el formato lo
 * decide quien escribe el fichero, enseñarle el que esperamos es la diferencia entre que acierte a
 * la primera y que adivine tres veces. Por eso el ejemplo va aquí y no en un mensaje de error.
 */
const listsPanel = element("section", "panel");
const listsInput = element("input");
listsInput.type = "file";
listsInput.accept = ".csv,.txt,text/csv,text/plain";
listsInput.id = "lists-file";
const listsLabel = element("label", undefined, "Listas de tags del circuito");
listsLabel.htmlFor = "lists-file";
const listsNote = element("p", "muted", "");

{
  listsPanel.append(element("h2", undefined, "Listas declaradas"), listsLabel, listsInput);
  const structure = element("details");
  structure.append(element("summary", undefined, "Qué forma tiene que tener el fichero"));
  structure.append(
    element(
      "p",
      "muted",
      `Una fila por tag. Cabecera «${EXPECTED_STRUCTURE.header.join(";")}»; ` +
        `«${EXPECTED_STRUCTURE.optional.join("» y «")}» son opcionales. El separador se detecta.`,
    ),
  );
  const example = element("pre", "mono raw", EXPECTED_STRUCTURE.example.join("\n"));
  example.style.overflowX = "auto";
  structure.append(example);
  const purposes = element("dl", "facts");
  for (const list of EXPECTED_STRUCTURE.lists) {
    purposes.append(
      element("dt", "mono", list),
      element("dd", undefined, LIST_PURPOSE[list]),
    );
  }
  structure.append(purposes);
  structure.append(
    element(
      "p",
      "muted",
      "Una lista con un nombre que no esté en esa tabla no se rechaza: se conserva con su nombre y " +
        "se avisa, porque una categoría nueva es información y no un defecto.",
    ),
  );
  listsPanel.append(structure, listsNote);
}

const viewsPanel = element("section", "panel");
viewsPanel.hidden = true;

/**
 * Expediente de AGV o tag: la vía de trabajo declarada como principal — «qué le pasa al 3524» — y
 * por eso se entra escribiendo un identificador en vez de navegar (UX_SPEC §4.1).
 */
const dossierPanel = element("section", "panel");
dossierPanel.hidden = true;
const dossierInput = element("input");
dossierInput.type = "search";
dossierInput.id = "dossier-search";
dossierInput.placeholder = "identificador de AGV o de tag";
dossierInput.inputMode = "numeric";
const dossierLabel = element("label", undefined, "Expediente");
dossierLabel.htmlFor = "dossier-search";
const dossierResult = element("div");
dossierInput.addEventListener("input", () => renderDossier());

/**
 * Replay básico (ROADMAP F2). Un control temporal y una tabla, no un mapa: el circuito es
 * topológico y la posición es fracción temporal, nunca física (`PERFORMANCE_BUDGET.md` §6).
 */
const replayPanel = element("section", "panel");
replayPanel.hidden = true;
const replaySlider = element("input");
replaySlider.type = "range";
replaySlider.id = "replay-slider";
replaySlider.min = "0";
replaySlider.value = "0";
const replayLabel = element("label", undefined, "Instante del replay");
replayLabel.htmlFor = "replay-slider";
const replayTime = element("p", "muted", "");
const replayTable = element("div");
replaySlider.addEventListener("input", () => renderReplayFrame());

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

app.append(
  header,
  picker,
  listsPanel,
  projectPanel,
  progressPanel,
  messagePanel,
  summaryPanel,
  // El expediente va **antes** que las vistas, no después. Es la vía de trabajo declarada más
  // frecuente —«qué le pasa al 3524»— y medido en un circuito real quedaba a 3.569 px del principio
  // en pantalla de móvil: cuatro pantallas y media de desplazamiento por delante de lo que más se
  // usa, detrás de los agregados que se consultan de vez en cuando (`UX_SPEC.md` §4.1).
  dossierPanel,
  viewsPanel,
  replayPanel,
  tablePanel,
);

{
  dossierPanel.append(element("h2", undefined, "Expediente de AGV o tag"), dossierLabel, dossierInput, dossierResult);
  replayPanel.append(
    element("h2", undefined, "Replay"),
    replayLabel,
    replaySlider,
    replayTime,
    element(
      "p",
      "muted",
      "La posición es fracción temporal del tramo, nunca posición física: no hay plano, solo orden.",
    ),
    replayTable,
  );
}


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

/**
 * La salida de una fuente cuya fecha no se puede resolver sola.
 *
 * Sin esto el mensaje de error pedía «indica el orden de los campos» y **no había forma de
 * indicarlo**: una promesa que el programa no cumplía, y una exportación legítima de los primeros
 * días de un mes quedaba fuera para siempre. El programa sigue sin elegir por el usuario; le da el
 * alcance de cada lectura —que ya va en el mensaje— y un control para decidir (R-DAT-014).
 */
function offerFieldOrder(file: File): void {
  const chooser = element("div", "chooser");
  const select = element("select");
  select.id = "field-order";
  for (const [value, label] of [
    ["day-first", "día/mes (31/12/2026)"],
    ["month-first", "mes/día (12/31/2026)"],
  ] as const) {
    const option = element("option", undefined, label);
    option.value = value;
    select.append(option);
  }
  const label = element("label", undefined, "Orden de los campos de fecha ");
  label.htmlFor = "field-order";
  const retry = element("button", undefined, "Importar con este orden");
  retry.type = "button";
  retry.addEventListener("click", () => {
    startImport(file, select.value as FieldOrder);
  });
  chooser.append(label, select, retry);
  messagePanel.append(chooser);
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
      if (message.accumulation !== undefined) {
        state.coverage = message.accumulation.coverage;
        renderAccumulation(message.accumulation);
        renderAffinity(message.accumulation);
      }
      if (message.views !== undefined) renderViews(message.views);
      state.views = message.views ?? null;
      renderDossier();
      renderReplaySkeleton();
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
      // Una fuente ambigua no es una fuente rota: es una que el programa no puede resolver solo.
      // Se ofrece la salida en lugar de dejar al usuario con una instrucción que no puede seguir.
      if (message.code === "DATE_AMBIGUOUS" && state.file !== null) offerFieldOrder(state.file);
      setBusy(false);
      disposeWorker();
      return;
    }

    case "lists-loaded": {
      const detail = message.lists
        .map((entry) => `${entry.list}: ${entry.tags.toLocaleString("es-ES")} tags`)
        .join(" · ");
      listsNote.textContent = `Circuito «${message.circuitId}» — ${detail}`;
      const lines = [
        `${message.accepted.toLocaleString("es-ES")} filas aceptadas en ${message.lists.length} lista(s).`,
        ...message.warnings,
      ];
      if (message.rejected > 0) {
        lines.push(`${message.rejected} fila(s) sin lista o sin tag, que no se han cargado.`);
      }
      lines.push(
        "Vuelve a importar una fuente de lecturas de este circuito para ver el inventario contrastado.",
      );
      showMessage(message.warnings.length > 0 ? "warn" : "info", "Listas cargadas", lines);
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

function startImport(file: File, fieldOrder?: FieldOrder): void {
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

  const circuitName = circuitInput.value.trim();
  const start: ToWorker = {
    type: "start",
    protocolVersion: PROTOCOL_VERSION,
    jobId,
    file,
    zone: ZONE,
    // Solo viaja si el usuario lo fijó: sin él, la detección manda y puede declararse incapaz.
    ...(fieldOrder === undefined ? {} : { fieldOrder }),
    // Solo el identificador: las lecturas ya guardadas las lee el Worker del almacén, para no
    // clonarlas entre hilos (defecto P4 del prototipo).
    ...(circuitName === "" ? {} : { circuitId: circuitName, circuitName }),
  };
  state.file = file;
  worker.postMessage(start);
}

/** Arranca la carga de listas. Mismo Worker y mismo protocolo: el parseo no vive aquí. */
function startLists(file: File, circuitId: string): void {
  disposeWorker();
  clearMessages();

  const jobId = crypto.randomUUID();
  const worker = new Worker(new URL("../../workers/import.worker.ts", import.meta.url), {
    type: "module",
  });
  state.worker = worker;
  state.jobId = jobId;
  worker.onmessage = (event: MessageEvent<FromWorker>) => handleMessage(event.data);
  worker.onerror = () => {
    showMessage("error", "El proceso auxiliar se detuvo", [
      "Las listas no llegaron a cargarse y el circuito no se ha modificado.",
    ]);
    setBusy(false);
    disposeWorker();
  };

  setBusy(true);
  progressNote.textContent = "Leyendo las listas";
  progressBar.value = 0;
  const load: ToWorker = {
    type: "lists",
    protocolVersion: PROTOCOL_VERSION,
    jobId,
    file,
    circuitId,
  };
  worker.postMessage(load);
}

/**
 * Permite volver a elegir **el mismo fichero** y que vuelva a importarse.
 *
 * Sin esto, `change` no se dispara la segunda vez y el usuario ve que no pasa nada. No es un caso
 * raro en este producto: los solapes entre exportaciones son deliberados y reimportar una que ya
 * está cargada es una operación normal.
 *
 * El valor se reinicia **al abrir el selector**, no al procesar el fichero. Limpiarlo después de
 * elegir vacía la `FileList` y con ella el `File` que aún no se ha leído: `arrayBuffer()` falla y
 * la carga se rechaza sola. Es exactamente el defecto que introdujo el primer intento de arreglo
 * de esto, y lo destapó la prueba de navegador en la misma ejecución.
 */
for (const input of [fileInput, projectInput, listsInput]) {
  input.addEventListener("click", () => {
    input.value = "";
  });
}

listsInput.addEventListener("change", () => {
  const file = listsInput.files?.[0];
  if (file === undefined) return;
  const circuitId = circuitInput.value.trim();
  if (circuitId === "") {
    showMessage("warn", "Falta el circuito", [
      "Las listas pertenecen a un circuito concreto: escribe cuál antes de cargarlas.",
    ]);
    return;
  }
  startLists(file, circuitId);
});

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

// --- Proyecto: acumular en el dispositivo y llevárselo ----------------------

function formatSpan(from: number, to: number): string {
  return `${formatInstant(from)} → ${formatInstant(to)}`;
}

/**
 * Lo que la acumulación añade al resumen.
 *
 * La cobertura va **siempre** junto a cualquier cifra temporal (R-DAT-007): fuera de ella no hay
 * silencio, hay ausencia de datos, y dar una cifra sin decir qué periodo cubre invita justo a la
 * confusión que la regla prohíbe.
 */
function renderAccumulation(report: {
  readonly circuitId: string;
  readonly coverage: readonly { readonly from: number; readonly to: number }[];
  readonly totalReadings: number;
  readonly sources: number;
  readonly shared: number;
  readonly disagreements: number;
}): void {
  summaryPanel.append(element("h2", undefined, `Circuito «${report.circuitId}»`));
  const rows: readonly (readonly [string, string])[] = [
    ["Fuentes acumuladas", String(report.sources)],
    ["Lecturas del circuito", report.totalReadings.toLocaleString("es-ES")],
    [
      "Cobertura",
      report.coverage.length === 0
        ? "sin ningún tramo completo todavía"
        : report.coverage.map((span) => formatSpan(span.from, span.to)).join("  ·  "),
    ],
    [
      "Solape con lo ya cargado",
      report.shared === 0
        ? "ninguno: esta fuente no repite nada"
        : `${report.shared.toLocaleString("es-ES")} eventos ya estaban y se cuentan una vez`,
    ],
  ];
  const list = element("dl", "facts");
  for (const [term, value] of rows) {
    list.append(element("dt", undefined, term), element("dd", undefined, value));
  }
  summaryPanel.append(list);

  if (report.coverage.length > 1) {
    summaryPanel.append(
      element(
        "p",
        "muted",
        "Entre esos tramos no hay datos cargados. Ese hueco no es un silencio del circuito y no " +
          "puede diagnosticarse: simplemente no se exportó ese periodo.",
      ),
    );
  }
  if (report.disagreements > 0) {
    summaryPanel.append(
      element(
        "p",
        "muted",
        `${report.disagreements} eventos del tramo común los trae solo una de las dos ` +
          "exportaciones. Se conservan los dos lados: la fuente no entregó lo mismo dos veces, y " +
          "eso es información sobre la fuente, no algo que se resuelva eligiendo.",
      ),
    );
  }
}

/**
 * El veredicto de afinidad, que es lo que impide el error que no avisa.
 *
 * Cargar en un circuito la exportación de otro no produce ningún mensaje: las columnas son las
 * mismas y las fechas también. Lo que produce es un circuito con dos anillos superpuestos y
 * conclusiones equivocadas meses después, cuando ya no hay forma de separarlos.
 */
function renderAffinity(report: AccumulationReport): void {
  const { affinity } = report;
  if (!report.accumulated) {
    showMessage("error", "No se ha acumulado: parece de otro circuito", [
      affinity.reason,
      `Coinciden ${affinity.sharedTags} de los ${affinity.sourceTags} tags de la fuente.`,
      "Las lecturas se muestran abajo para que puedas comprobarlo —analizar no es consolidar—, " +
        "pero el circuito no se ha tocado. Si de verdad es de este circuito, cárgalo en el suyo o " +
        "revisa el nombre que has escrito.",
    ]);
    return;
  }
  if (affinity.verdict === "partially-compatible") {
    summaryPanel.append(element("p", "muted", `Afinidad: ${affinity.reason}`));
  }
  if (affinity.verdict === "unknown") {
    summaryPanel.append(element("p", "muted", `Afinidad: ${affinity.reason}`));
  }
}

/** Las cuatro vistas, en el orden en que responden preguntas: qué hay, cuándo, quién, y qué falta. */
function renderViews(views: CircuitViews): void {
  viewsPanel.replaceChildren();
  viewsPanel.hidden = false;
  viewsPanel.append(element("h2", undefined, "Vistas"));

  if (state.coverage.length > 0) viewsPanel.append(coverageChart(state.coverage, formatInstant));
  viewsPanel.append(hourlyChart({ counts: views.hourly.counts, days: views.hourly.days }));
  viewsPanel.append(
    activityChart(
      {
        rows: views.activity.rows,
        binStarts: views.activity.binStarts,
        uncoveredBins: views.activity.uncoveredBins,
        maxPerBin: views.activity.maxPerBin,
      },
      formatInstant,
    ),
  );
  viewsPanel.append(
    inventoryChart(
      (views.inventory?.counts ?? []).map((entry) => ({
        label: entry.tagClass,
        count: entry.count,
        truth: entry.truth,
        action: entry.action,
      })),
    ),
  );

  // Cohortes (R-DAT-012): un solo grupo es lo esperado; más de uno avisa de que el fichero mezcla
  // circuitos, que es justo el error que la comparación por cohorte existe para impedir.
  const cohortLine =
    views.cohorts.length === 1
      ? `1 circuito de ${views.cohorts[0]?.vehicles.length ?? 0} vehículos`
      : `${views.cohorts.length} circuitos detectados en el mismo fichero: ` +
        views.cohorts.map((cohort) => `${cohort.vehicles.length} vehículos`).join(", ");
  viewsPanel.append(element("h3", undefined, "Agrupamiento por circuito"));
  viewsPanel.append(element("p", "muted", cohortLine));

  if (views.vsystemContrast !== undefined) {
    viewsPanel.append(element("h3", undefined, "Contraste contra Vsystem"));
    viewsPanel.append(
      element(
        "p",
        "muted",
        "Alineación por secuencia entre lo declarado y el anillo observado del cohorte mayor. " +
          "Ninguna fila es un hecho asignado: «sustituido-candidato» es una hipótesis con su evidencia.",
      ),
    );
    viewsPanel.append(
      plainTable(
        ["Declarado", "Observado", "Veredicto", "Estado", "Evidencia"],
        views.vsystemContrast
          .filter((row) => row.verdict !== "coincide")
          .map((row) => [
            row.declaredTag ?? "—",
            row.observedTag ?? "—",
            row.verdict,
            row.truth,
            row.evidence,
          ]),
      ),
    );
  }
}

/**
 * Expediente por identificador (UX_SPEC §4.1): busca primero en AGV, después en tags, y muestra lo
 * que encuentre. Un identificador que no aparece en ninguno de los dos se dice, no se calla.
 */
function renderDossier(): void {
  const query = dossierInput.value.trim();
  dossierResult.replaceChildren();
  if (query === "" || state.views === null) {
    dossierPanel.hidden = state.views === null;
    return;
  }
  dossierPanel.hidden = false;

  const agv = state.views.agvDossiers.find((entry) => entry.agvId === query);
  const tag = state.views.tagDossiers.find((entry) => entry.tagId === query);

  if (agv === undefined && tag === undefined) {
    dossierResult.append(
      element("p", "muted", `Ningún AGV ni tag con el identificador exacto «${query}».`),
    );
    return;
  }

  if (agv !== undefined) {
    const rows: readonly (readonly [string, string])[] = [
      ["Cohorte", agv.cohortId === null ? "sin cohorte reconocible" : `${agv.cohortSize} vehículos`],
      [
        "Lecturas frente a la cohorte",
        `${agv.readingCount.toLocaleString("es-ES")} — mediana del resto: ` +
          agv.cohortMedianReadings.toLocaleString("es-ES"),
      ],
      [
        "Vueltas (ancla inferida)",
        `${agv.laps.completas} completas, ${agv.laps.parciales} parciales, ${agv.laps.desconocidas} desconocidas`,
      ],
      [
        "Última lectura",
        agv.lastReading === null
          ? "ninguna"
          : `${agv.lastReading.tagId} — ${formatInstant(agv.lastReading.utcMs)}`,
      ],
      [
        "Silencio abierto",
        agv.openSilenceSinceUtcMs === null
          ? "no: hay lectura reciente o la cobertura ya terminó antes"
          : `desde ${formatInstant(agv.openSilenceSinceUtcMs)}, sin cerrar dentro de la cobertura`,
      ],
    ];
    const list = element("dl", "facts");
    for (const [term, value] of rows) list.append(element("dt", undefined, term), element("dd", undefined, value));
    dossierResult.append(element("h3", undefined, `AGV ${agv.agvId}`), list);
    if (agv.inactivity.length > 0) {
      dossierResult.append(
        element(
          "p",
          "muted",
          `${agv.inactivity.length} periodos de inactividad. Cada uno con sus dos extremos: por ` +
            "dónde se fue y por dónde volvió. Volver al mismo tag y volver más adelante son " +
            "hechos distintos, y ninguno de los dos es por sí solo una avería (R-AGV-006).",
        ),
      );
      dossierResult.append(
        plainTable(
          ["Desde", "Hasta", "Duración", "Se fue por", "Volvió por", "Reaparición"],
          agv.inactivity.map((period) => [
            formatInstant(period.fromUtcMs),
            formatInstant(period.toUtcMs),
            `${Math.round(period.durationMs / 60_000)} min`,
            period.lastTagBefore,
            period.firstTagAfter,
            period.lastTagBefore === period.firstTagAfter ? "en el mismo tag" : "más adelante",
          ]),
        ),
      );
    }
  }

  if (tag !== undefined) {
    dossierResult.append(
      element("h3", undefined, `Tag ${tag.tagId}`),
      element("p", "muted", `${tag.totalReadings.toLocaleString("es-ES")} lecturas en total.`),
      plainTable(
        ["AGV", "Última lectura"],
        tag.readers.map((reader) => [
          reader.agvId,
          reader.lastReadUtcMs === null ? "nunca" : formatInstant(reader.lastReadUtcMs),
        ]),
      ),
    );
  }
}

/** Prepara el control temporal del replay para el rango de fotogramas recibido. */
function renderReplaySkeleton(): void {
  const frames = state.views?.replay ?? [];
  replayPanel.hidden = frames.length === 0;
  if (frames.length === 0) return;
  replaySlider.max = String(frames.length - 1);
  replaySlider.value = "0";
  renderReplayFrame();
}

/** Dibuja el fotograma seleccionado: qué tag o qué tramo, y con qué estado de verdad. */
function renderReplayFrame(): void {
  const frames = state.views?.replay ?? [];
  const index = Math.min(frames.length - 1, Math.max(0, Number.parseInt(replaySlider.value, 10)));
  const frame = frames[index];
  replayTable.replaceChildren();
  if (frame === undefined) return;

  replayTime.textContent = formatInstant(frame.atUtcMs);
  // Primero lo que tiene posición, después lo que no: ordenar por identificador enterraba a los
  // pocos vehículos en movimiento entre decenas de filas sin nada que mirar.
  const RANK = { "en-transito": 0, "en-tag": 1, silencio: 2, "sin-datos": 3 } as const;
  const rows = [...frame.vehicles]
    .sort(([agvA, a], [agvB, b]) =>
      RANK[a.kind] !== RANK[b.kind] ? RANK[a.kind] - RANK[b.kind] : agvA.localeCompare(agvB),
    )
    .map(([agvId, vehicleState]): readonly string[] => {
      switch (vehicleState.kind) {
        case "en-tag":
          return [agvId, vehicleState.tagId, "—", vehicleState.truth];
        case "en-transito":
          return [
            agvId,
            vehicleState.fromTagId,
            `→ ${vehicleState.toTagId} (${Math.round(vehicleState.fraction * 100)} %)`,
            vehicleState.truth,
          ];
        case "silencio":
          return [
            agvId,
            vehicleState.lastTagId,
            `silencio desde ${formatInstant(vehicleState.sinceUtcMs)}`,
            "unknown",
          ];
        default:
          // Antes de su primera lectura no hay silencio que diagnosticar: hay ausencia de datos
          // para ese vehículo, y lo que sí se sabe es cuándo deja de haberla.
          return [
            agvId,
            "—",
            `aún sin lecturas; la primera, a las ${formatInstant(vehicleState.firstReadingUtcMs)}`,
            "sin datos",
          ];
      }
    });
  replayTable.append(plainTable(["AGV", "Tag", "Tránsito / silencio", "Estado"], rows));
}


exportButton.addEventListener("click", () => {
  void (async () => {
    const circuitId = circuitInput.value.trim();
    if (circuitId === "") {
      showMessage("warn", "Falta el circuito", ["Escribe el nombre del circuito que quieres exportar."]);
      return;
    }
    if (!isAvailable()) {
      showMessage("error", "No hay almacén local", [
        "Este navegador no permite guardar datos de sitio, así que no hay nada acumulado que exportar.",
      ]);
      return;
    }
    const circuit = await loadCircuit(circuitId);
    if (circuit === undefined) {
      showMessage("warn", "Ese circuito no existe todavía", [
        "Importa al menos una fuente indicando ese circuito y vuelve a intentarlo.",
      ]);
      return;
    }
    // Sin el bruto, por ADR-0012: el dispositivo acumula las lecturas y el fichero lleva el
    // proyecto. Meter doscientas mil lecturas en cada exportación haría el fichero inmanejable
    // sin añadir nada que el dispositivo de destino no pueda volver a importar.
    const bytes = await writeProject(
      circuitId,
      {
        circuito: { id: circuit.circuitId, nombre: circuit.name, zona: circuit.zone },
        fuentes: circuit.sources,
        cobertura: circuit.coverage,
      },
      Date.now(),
    );
    // La confirmación se muestra **antes** de disparar la descarga, no después. Al revés, esta
    // línea se ejecuta cuando el navegador ya ha entregado el fichero, y si para entonces el
    // usuario ya ha hecho otra cosa —abrir un proyecto, por ejemplo— le pisa su mensaje con uno
    // que corresponde a la acción anterior.
    showMessage("info", "Proyecto exportado", [
      `${circuit.sources.length} fuentes y su cobertura. Las lecturas se quedan en este dispositivo.`,
    ]);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const link = element("a");
    link.href = url;
    link.download = `${circuitId}.agvproj`;
    link.click();
    URL.revokeObjectURL(url);
  })();
});

projectInput.addEventListener("change", () => {
  void (async () => {
    const file = projectInput.files?.[0];
    if (file === undefined) return;
    clearMessages();
    try {
      const project = await readProject(new Uint8Array(await file.arrayBuffer()));
      const circuito = project.sections["circuito"] as { nombre?: string } | undefined;
      const fuentes = project.sections["fuentes"] as readonly unknown[] | undefined;
      const cobertura = project.sections["cobertura"] as
        | readonly { from: number; to: number }[]
        | undefined;
      showMessage("info", `Proyecto «${circuito?.nombre ?? project.manifest.circuit_id}»`, [
        `${fuentes?.length ?? 0} fuentes declaradas, exportado el ${formatInstant(project.manifest.exported_at)}.`,
        cobertura === undefined || cobertura.length === 0
          ? "Sin cobertura declarada."
          : `Cobertura: ${cobertura.map((span) => formatSpan(span.from, span.to)).join("  ·  ")}`,
        "Integridad verificada: manifiesto y todas sus secciones coinciden con sus hashes.",
      ]);
    } catch (error) {
      if (error instanceof ProjectError) {
        showMessage("error", "No se pudo abrir el proyecto", [error.reason, error.recovery]);
        return;
      }
      showMessage("error", "No se pudo abrir el proyecto", [
        "El fichero no tiene la forma de un `.agvproj`.",
        "Comprueba que es el fichero correcto. El almacén local no se ha tocado.",
      ]);
    }
  })();
});

// --- Sin red -----------------------------------------------------------------

/**
 * Registra el service worker para que la aplicación abra sin conexión.
 *
 * Va al final y sin bloquear nada: si el registro falla —contexto no seguro, permisos del
 * navegador, modo privado— la aplicación sigue funcionando exactamente igual con red. Una PWA que
 * se rompe porque no pudo instalarse es peor que no tenerla.
 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
      // No se informa al usuario: no ha perdido ninguna capacidad, solo la de abrir sin red.
    });
  });
}
