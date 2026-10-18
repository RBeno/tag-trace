/**
 * La sección «Expedientes de incidencia» de la pestaña Línea y calles (F5, ADR-0018, entrega 1).
 *
 * Aquí no se decide ni se calcula nada: la lista, el historial, los cambios de estado posibles con lo
 * que falta para cada uno, el recorte y la integridad llegan hechos del Worker (`CaseViews`). Este
 * módulo los pone en palabras y en formularios. Lo único que sale de aquí es lo que una persona
 * confirma con un botón: crear un expediente, cambiar su ventana en borrador, cambiar su estado o
 * añadir una nota. El Worker lo vuelve a comprobar contra la revisión guardada antes de escribir.
 *
 * Leer «2026-10-09T10:40» de un campo de fecha es formato de entrada, no análisis.
 *
 * Todo texto del dato entra por `textContent` (TH-007).
 */

import type { CaseAction, CaseView, CaseViews, ExcludedIncidentStart } from "../application/protocol.js";
import type { CaseReplay, CaseReplayVehicle, ConnectionState } from "../domain/replay.js";
import { HYPOTHESIS_STATUS_TEXT, type HypothesisView } from "../domain/case-hypotheses.js";
import { metricText, verificationText, type CaseMetric } from "../domain/case-verification.js";
import { VERDICT_WORD } from "../domain/case-similarity.js";
import { PHASE_TEXT, type Chronology, type ChronologyPhase } from "../domain/case-backtrack.js";
import { CASE_STATE_TEXT, type CaseOrigin, type CaseState, type TransitionOption } from "../domain/incident-case.js";
import { button, node } from "./dom.js";
import { fromDateTimeInput, toDateTimeInput } from "./time-input.js";

const MIN = 60_000;

const CONNECTION_TEXT: Readonly<Record<ConnectionState, string>> = {
  conectado: "conectado (registro)",
  "sin-conexion": "sin conexión (registro)",
  "sin-registro": "sin registro",
};

/** Un punto de partida para un expediente: una incidencia medida, una excluida o un hallazgo (D1). */
export interface CaseStart {
  readonly origin: CaseOrigin;
  readonly title: string;
  readonly agvId: string | null;
  readonly tagIds: readonly string[];
  /** La ventana que trae, si trae alguna; un hallazgo sin instante la deja a la persona. */
  readonly from: number | null;
  readonly to: number | null;
}

export interface CasesContext {
  readonly circuitId: string | null;
  /** `null` sin análisis o sin almacén. */
  readonly views: CaseViews | null;
  /** Las incidencias de la batería de mediciones del análisis (R-AGV-021). */
  readonly measured: readonly CaseStart[];
  /** Los hallazgos con tarjeta en la bandeja. */
  readonly findings: readonly CaseStart[];
}

export interface CasesPanelInput {
  readonly formatInstant: (utcMs: number) => string;
  readonly zone: string;
  /** Solo lo llama un botón de confirmar. */
  readonly send: (action: CaseAction) => void;
  /** Pide el replay de un expediente al Worker. Solo lee. */
  readonly requestReplay: (caseId: string) => void;
  /** Descarga el informe del expediente, su cronología en CSV o las lecturas de su recorte (D11). Solo lee. */
  readonly exportCase: (kind: "informe" | "cronologia" | "lecturas", view: CaseView) => void;
}

export interface CasesPanel {
  readonly node: HTMLElement;
  update(context: CasesContext): void;
  showUpdated(written: string, caseId: string, views: CaseViews): void;
  showError(cause: string, recovery: string): void;
  /** El replay de un expediente, calculado sobre el recorte de esa revisión. */
  showReplay(caseId: string, revision: number, replay: CaseReplay): void;
  notice(text: string): void;
  setBusy(busy: boolean): void;
}

const ORIGIN_CHOICE = {
  sintoma: "Un síntoma que describes",
  "incidencia-medida": "Una incidencia medida (batería de mediciones)",
  "incidencia-excluida": "Una incidencia excluida de la memoria vigente",
  hallazgo: "Un hallazgo de la bandeja",
} as const;

type OriginKind = keyof typeof ORIGIN_CHOICE;

function minutes(ms: number): string {
  const value = Math.round(ms / MIN);
  return `${value.toLocaleString("es-ES")} min`;
}

/** Las incidencias excluidas de la versión vigente como puntos de partida. */
function excludedStarts(excluded: readonly ExcludedIncidentStart[]): readonly CaseStart[] {
  return excluded.map((entry) => ({
    origin: { kind: "incidencia-excluida", version: entry.version, versionHash: entry.versionHash, key: entry.key, label: entry.label },
    title: entry.label,
    agvId: entry.agvId,
    tagIds: entry.tagIds,
    from: entry.from,
    to: entry.to,
  }));
}

export function createCasesPanel(input: CasesPanelInput): CasesPanel {
  const root = node("section", "panel cases-panel");
  root.setAttribute("aria-labelledby", "cases-heading");
  let context: CasesContext = { circuitId: null, views: null, measured: [], findings: [] };
  let status: { readonly kind: "info" | "error"; readonly lines: readonly string[] } | null = null;
  let busy = false;
  /** El expediente abierto, para dejarlo abierto al volver a pintar. */
  let open: string | null = null;
  /** Los replays recibidos, por expediente, con la revisión de la que salen y el fotograma elegido. */
  const replays = new Map<string, { readonly revision: number; readonly replay: CaseReplay; frame: number }>();
  const senders: { readonly control: HTMLButtonElement; readonly ready: () => boolean }[] = [];

  const heading = node("h2", undefined, "Expedientes de incidencia");
  heading.id = "cases-heading";
  const intro = node(
    "p",
    "muted",
    "Un expediente conserva una incidencia para investigarla, aparte de la memoria del circuito: crearlo, guardarlo, " +
      "cambiarlo de estado o cerrarlo no cambia el esperado ni ninguna versión. Guarda una copia de las lecturas de todos los AGV " +
      "en su ventana, así que sigue pudiéndose estudiar aunque esas lecturas dejen de estar retenidas. Solo existe en este " +
      "dispositivo: borrar los datos del navegador lo pierde.",
  );
  const statusBox = node("div", "plan-status cases-status");
  statusBox.setAttribute("role", "status");
  statusBox.setAttribute("aria-live", "polite");
  const body = node("div", "cases-body");
  root.append(heading, intro, statusBox, body);

  function paintStatus(): void {
    statusBox.replaceChildren();
    statusBox.className = status === null ? "plan-status cases-status" : `plan-status cases-status ${status.kind}`;
    if (status === null) return;
    for (const line of status.lines) statusBox.append(node("p", undefined, line));
  }

  function applyBusy(): void {
    for (const { control, ready } of senders) control.disabled = busy || !ready();
  }

  function sender(text: string, className: string, ready: () => boolean, onClick: () => void): HTMLButtonElement {
    const control = button(text, `plan-send ${className}`);
    senders.push({ control, ready });
    control.disabled = busy || !ready();
    control.addEventListener("click", () => {
      if (busy || !ready()) return;
      onClick();
    });
    return control;
  }

  let fieldCount = 0;
  function field(labelText: string, className: string, type: string): { readonly box: HTMLElement; readonly input: HTMLInputElement } {
    fieldCount += 1;
    const id = `case-field-${fieldCount}`;
    const label = node("label", undefined, labelText);
    label.htmlFor = id;
    const control = node("input", `plan-input ${className}`);
    control.type = type;
    control.id = id;
    control.addEventListener("input", applyBusy);
    const box = node("div", "plan-field");
    box.append(label, control);
    // El navegador enseña el campo en su formato y sin zona: se dice en qué hora se escribe.
    if (type === "datetime-local") box.append(node("p", "muted plan-hint", `Hora de la planta (${input.zone}).`));
    return { box, input: control };
  }

  function textArea(labelText: string, className: string): { readonly box: HTMLElement; readonly input: HTMLTextAreaElement } {
    fieldCount += 1;
    const id = `case-field-${fieldCount}`;
    const label = node("label", undefined, labelText);
    label.htmlFor = id;
    const control = node("textarea", `plan-input ${className}`);
    control.id = id;
    control.rows = 3;
    control.addEventListener("input", applyBusy);
    const box = node("div", "plan-field");
    box.append(label, control);
    return { box, input: control };
  }

  function select(labelText: string, className: string): { readonly box: HTMLElement; readonly input: HTMLSelectElement } {
    fieldCount += 1;
    const id = `case-field-${fieldCount}`;
    const label = node("label", undefined, labelText);
    label.htmlFor = id;
    const control = node("select", `plan-input ${className}`);
    control.id = id;
    const box = node("div", "plan-field");
    box.append(label, control);
    return { box, input: control };
  }

  const author = field("Tu nombre (opcional, solo en este dispositivo)", "case-author", "text");

  // --- Crear ---------------------------------------------------------------------------------------

  function startsOf(kind: OriginKind): readonly CaseStart[] {
    if (kind === "incidencia-medida") return context.measured;
    if (kind === "incidencia-excluida") return excludedStarts(context.views?.excluded ?? []);
    if (kind === "hallazgo") return context.findings;
    return [];
  }

  function createForm(): HTMLElement {
    const box = node("div", "plan-form case-create");
    box.append(node("p", "plan-form-title", "Nuevo expediente"));
    const origin = select("Empieza desde", "case-origin");
    for (const [kind, text] of Object.entries(ORIGIN_CHOICE) as [OriginKind, string][]) {
      const option = node("option", undefined, text);
      option.value = kind;
      const count = startsOf(kind).length;
      if (kind !== "sintoma" && count === 0) {
        option.disabled = true;
        option.textContent = `${text} (ninguna en este análisis)`;
      }
      origin.input.append(option);
    }
    const start = select("Cuál", "case-start");
    start.box.hidden = true;
    const title = field("Título", "case-title", "text");
    title.input.placeholder = "En pocas palabras, qué ocurrió";
    const symptom = textArea("Síntoma: qué ocurrió, dónde y cuándo", "case-symptom");
    const from = field("Principio del síntoma", "plan-date case-from", "datetime-local");
    const to = field("Fin del síntoma", "plan-date case-to", "datetime-local");
    const agv = field("AGV (opcional)", "case-agv", "text");
    const tags = field("Tags (opcionales, separados por comas)", "case-tags", "text");
    const margins = context.views?.margins;
    const marginNote = node(
      "p",
      "muted case-margins-note",
      margins === undefined
        ? "El programa propone los márgenes antes y después del síntoma al crear el expediente."
        : `Al crear, el programa propone los márgenes: como mínimo ${minutes(margins.minBeforeMs)} antes y ${minutes(margins.minAfterMs)} después ` +
            `(${margins.configState === "draft" ? "provisional" : "configuración"}), más si el síntoma dura más` +
            `${margins.lapMs === null ? "" : ` o, antes, si la vuelta del circuito (${minutes(margins.lapMs)}) es más larga`}. ` +
            "En borrador se pueden cambiar.",
    );
    let chosen: CaseStart | null = null;

    const fillStarts = (): void => {
      const kind = origin.input.value as OriginKind;
      start.input.replaceChildren();
      chosen = null;
      const list = startsOf(kind);
      start.box.hidden = kind === "sintoma";
      list.forEach((entry, index) => {
        const option = node("option", undefined, entry.title);
        option.value = String(index);
        start.input.append(option);
      });
      if (kind !== "sintoma") pick();
      applyBusy();
    };
    const pick = (): void => {
      const list = startsOf(origin.input.value as OriginKind);
      chosen = list[Number(start.input.value)] ?? null;
      if (chosen === null) return;
      title.input.value = chosen.title;
      agv.input.value = chosen.agvId ?? "";
      tags.input.value = chosen.tagIds.join(", ");
      from.input.value = chosen.from === null ? "" : toDateTimeInput(chosen.from, input.zone, "minutes");
      to.input.value = chosen.to === null ? "" : toDateTimeInput(chosen.to, input.zone, "minutes");
      applyBusy();
    };
    origin.input.addEventListener("change", fillStarts);
    start.input.addEventListener("change", pick);

    const ready = (): boolean =>
      context.circuitId !== null &&
      title.input.value.trim() !== "" &&
      symptom.input.value.trim() !== "" &&
      fromDateTimeInput(from.input.value, input.zone) !== null &&
      fromDateTimeInput(to.input.value, input.zone) !== null &&
      (origin.input.value === "sintoma" || chosen !== null);
    const create = sender("Crear expediente", "case-create-send", ready, () => {
      const symptomFrom = fromDateTimeInput(from.input.value, input.zone) as number;
      const symptomTo = fromDateTimeInput(to.input.value, input.zone) as number;
      input.send({
        kind: "crear",
        title: title.input.value,
        symptom: symptom.input.value,
        origin: origin.input.value === "sintoma" || chosen === null ? { kind: "sintoma" } : chosen.origin,
        agvId: agv.input.value.trim() === "" ? null : agv.input.value.trim(),
        tagIds: tags.input.value
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== ""),
        symptomFrom,
        symptomTo,
        author: author.input.value,
      });
    });
    box.append(origin.box, start.box, title.box, symptom.box, from.box, to.box, agv.box, tags.box, marginNote, create);
    return box;
  }

  // --- Un expediente -------------------------------------------------------------------------------

  function windowText(view: CaseView): string {
    const w = view.current.window;
    return (
      `Síntoma de ${input.formatInstant(w.symptomFrom)} a ${input.formatInstant(w.symptomTo)}; ` +
      `se mira de ${input.formatInstant(view.span.from)} a ${input.formatInstant(view.span.to)} ` +
      `(${minutes(w.marginBeforeMs)} antes y ${minutes(w.marginAfterMs)} después).`
    );
  }

  function transitionControl(view: CaseView, option: TransitionOption): HTMLElement {
    const holder = node("div", "case-transition");
    holder.dataset["to"] = option.to;
    const label = `Pasar a ${CASE_STATE_TEXT[option.to]}`;
    if (option.unmet.length > 0) {
      const off = button(label, "plan-send case-transition-send");
      off.disabled = true;
      holder.append(off, node("p", "muted case-unmet", `Falta ${option.unmet.join(" y ")}.`));
      return holder;
    }
    if (option.input === null) {
      holder.append(sender(label, "case-transition-send", () => true, () => sendState(view, option.to, null)));
      return holder;
    }
    const text = field(option.inputLabel ?? "Texto", "case-transition-text", "text");
    holder.append(
      text.box,
      sender(label, "case-transition-send", () => text.input.value.trim() !== "", () => sendState(view, option.to, text.input.value)),
    );
    return holder;
  }

  function sendState(view: CaseView, to: CaseState, text: string | null): void {
    input.send({ kind: "estado", caseId: view.current.caseId, expectedRevision: view.current.revision, to, text, author: author.input.value });
  }

  function windowForm(view: CaseView): HTMLElement {
    const box = node("div", "plan-form case-window");
    box.append(node("p", "plan-form-title", "Cambiar la ventana (solo en borrador)"));
    const w = view.current.window;
    const from = field("Principio del síntoma", "plan-date case-window-from", "datetime-local");
    from.input.value = toDateTimeInput(w.symptomFrom, input.zone, "minutes");
    const to = field("Fin del síntoma", "plan-date case-window-to", "datetime-local");
    to.input.value = toDateTimeInput(w.symptomTo, input.zone, "minutes");
    const before = field("Margen antes (minutos)", "plan-date case-window-before", "number");
    before.input.min = "0";
    before.input.value = String(Math.round(w.marginBeforeMs / MIN));
    const after = field("Margen después (minutos)", "plan-date case-window-after", "number");
    after.input.min = "0";
    after.input.value = String(Math.round(w.marginAfterMs / MIN));
    const read = (): { symptomFrom: number; symptomTo: number; marginBeforeMs: number; marginAfterMs: number } | null => {
      const a = fromDateTimeInput(from.input.value, input.zone);
      const b = fromDateTimeInput(to.input.value, input.zone);
      const m1 = Number(before.input.value);
      const m2 = Number(after.input.value);
      if (a === null || b === null || !Number.isFinite(m1) || !Number.isFinite(m2) || before.input.value === "" || after.input.value === "") return null;
      return { symptomFrom: a, symptomTo: b, marginBeforeMs: m1 * MIN, marginAfterMs: m2 * MIN };
    };
    box.append(
      from.box,
      to.box,
      before.box,
      after.box,
      node("p", "muted", "Cambiar la ventana vuelve a copiar las lecturas de la ventana nueva."),
      sender("Guardar la ventana", "case-window-send", () => read() !== null, () => {
        const next = read();
        if (next === null) return;
        input.send({ kind: "ventana", caseId: view.current.caseId, expectedRevision: view.current.revision, window: next, author: author.input.value });
      }),
    );
    return box;
  }

  function noteForm(view: CaseView): HTMLElement {
    const box = node("div", "plan-form case-note");
    const text = textArea("Añadir una nota", "case-note-text");
    box.append(
      text.box,
      sender("Guardar la nota", "case-note-send", () => text.input.value.trim() !== "", () =>
        input.send({ kind: "nota", caseId: view.current.caseId, expectedRevision: view.current.revision, text: text.input.value, author: author.input.value }),
      ),
    );
    return box;
  }

  /**
   * El retroceso desde el síntoma (ALG-015): la cronología por fases, en orden de tiempo. Lo anterior al
   * síntoma lleva «precede» y nada más; el orden no dice qué importa más ni qué lo produjo (D6).
   */
  function chronologyBlock(view: CaseView): HTMLElement {
    const box = node("section", "case-chronology");
    box.append(node("h4", undefined, "Retroceso desde el síntoma"));
    const chronology: Chronology | null = view.chronology;
    if (chronology === null) {
      box.append(node("p", "muted", "Sin recorte de lecturas no hay retroceso: lo que pasó en la ventana es desconocido."));
      return box;
    }
    box.append(
      node(
        "p",
        "muted case-chronology-note",
        "En orden de tiempo. «Precede» solo dice que ocurrió antes del síntoma: ni que importe más ni que tenga que ver con él. " +
          "Nada de aquí dice por qué ocurrió: eso lo confirma una persona.",
      ),
      node("p", "muted case-context", `${view.contextText} Método de cálculo: ${chronology.algorithm}.`),
    );
    if (chronology.declared.length > 0) {
      box.append(
        node(
          "p",
          "case-declared",
          `Declarado en planta: ${chronology.declared.map((entry) => (chronology.declared.length === 1 ? entry.text : `${entry.tagId}, ${entry.text}`)).join("; ")}.`,
        ),
      );
    }
    for (const phase of ["antes", "durante", "despues"] as const satisfies readonly ChronologyPhase[]) {
      const entries = chronology.facts.map((fact, index) => ({ fact, index })).filter((entry) => entry.fact.phase === phase);
      if (entries.length === 0) continue;
      const list = node("ol", "case-facts-list");
      list.dataset["phase"] = phase;
      for (const { fact, index } of entries) {
        const item = node("li", "case-fact");
        item.dataset["kind"] = fact.kind;
        if (index === chronology.firstDeviation) item.dataset["first"] = "si";
        const head = node("span", "case-fact-when", input.formatInstant(fact.at));
        item.append(head);
        if (fact.relation !== null) item.append(node("span", "chip case-fact-relation", fact.relation));
        if (index === chronology.firstDeviation) item.append(node("span", "chip case-fact-first", "primera desviación"));
        item.append(node("span", "case-fact-text", fact.text));
        if (fact.upstream !== null && fact.upstream > 0) {
          item.append(node("span", "muted case-fact-upstream", `${fact.upstream.toLocaleString("es-ES")} ${fact.upstream === 1 ? "tag" : "tags"} antes del síntoma por el anillo`));
        }
        const rows = fact.provenance.map((row) => `fila ${row.sourceRow}`).concat(fact.connectionRows.map((row) => `registro, fila ${row.sourceRow}`));
        if (rows.length > 0) item.title = `Evidencia: ${rows.join(", ")}`;
        // Con el replay cargado, cada hecho lleva al fotograma en que cae.
        const loaded = replays.get(view.current.caseId);
        if (loaded !== undefined && loaded.revision === view.current.revision) {
          const target = loaded.replay.frames.findIndex((frame) => frame.events.includes(index));
          if (target >= 0) {
            const go = button("Ver en el replay", "case-fact-go");
            go.addEventListener("click", () => {
              loaded.frame = target;
              render();
            });
            item.append(go);
          }
        }
        list.append(item);
      }
      box.append(node("h5", undefined, PHASE_TEXT[phase]), list);
    }
    if (chronology.facts.length === 0) box.append(node("p", "muted", "El recorte no muestra nada que contar en la ventana."));
    if (chronology.limits.length > 0) {
      const limits = node("ul", "case-limits");
      for (const limit of chronology.limits) limits.append(node("li", undefined, limit));
      box.append(node("p", "muted", "Lo que este retroceso no revisa:"), limits);
    }
    return box;
  }

  /**
   * El replay del expediente (ALG-016): a petición, sobre el recorte de la revisión vigente. Por AGV, lo
   * observado (tag, tránsito como fracción de tiempo, silencio o sin datos), la banda de lo esperado
   * desde su última lectura y la conexión del registro del terminal. Lo esperado no se ha visto: se dice.
   */
  function replayBlock(view: CaseView): HTMLElement {
    const box = node("section", "case-replay");
    box.append(node("h4", undefined, "Replay del expediente"));
    if (view.chronology === null) {
      box.append(node("p", "muted", "Sin recorte de lecturas no hay replay."));
      return box;
    }
    const loaded = replays.get(view.current.caseId);
    if (loaded === undefined || loaded.revision !== view.current.revision) {
      box.append(
        node("p", "muted", "Cada AGV en cada momento de la ventana: lo visto, dónde debería estar según lo esperado y su conexión."),
        sender("Ver el replay", "case-replay-request", () => true, () => input.requestReplay(view.current.caseId)),
      );
      return box;
    }
    const { replay } = loaded;
    if (replay.frames.length === 0) {
      box.append(node("p", "muted", replay.limits.join(" ")));
      return box;
    }
    const index = Math.min(replay.frames.length - 1, Math.max(0, loaded.frame));
    fieldCount += 1;
    const sliderId = `case-replay-${fieldCount}`;
    const label = node("label", undefined, "Momento de la ventana");
    label.htmlFor = sliderId;
    const slider = node("input", "case-replay-slider");
    slider.type = "range";
    slider.id = sliderId;
    slider.min = "0";
    slider.max = String(replay.frames.length - 1);
    slider.value = String(index);
    const when = node("p", "case-replay-when");
    const events = node("ul", "case-replay-events");
    const table = node("table", "case-replay-table");
    const paint = (at: number): void => {
      const current = replay.frames[at] as CaseReplay["frames"][number];
      when.textContent = `${input.formatInstant(current.atUtcMs)} · ${PHASE_TEXT[current.phase].toLowerCase()}`;
      when.dataset["phase"] = current.phase;
      events.replaceChildren();
      for (const factIndex of current.events) {
        const fact = view.chronology?.facts[factIndex];
        if (fact !== undefined) events.append(node("li", undefined, `${input.formatInstant(fact.at)}: ${fact.text}`));
      }
      events.hidden = current.events.length === 0;
      const head = node("thead");
      const headRow = node("tr");
      for (const title of ["AGV", "Visto", "Esperado", "Conexión"]) headRow.append(node("th", undefined, title));
      head.append(headRow);
      const body = node("tbody");
      for (const entry of current.vehicles) body.append(replayRow(entry));
      table.replaceChildren(head, body);
    };
    slider.addEventListener("input", () => {
      loaded.frame = Number(slider.value);
      paint(loaded.frame);
    });
    paint(index);
    const note = node(
      "p",
      "muted case-replay-note",
      `«Esperado» es dónde debería estar cada AGV desde su última lectura, entre el paso lento (p95) y el habitual (p50) de cada tramo, ` +
        `${replay.expectedFrom === "memoria" ? "según el esperado de la versión consolidada" : replay.expectedFrom === "instantanea" ? "según lo habitual del propio fichero" : "y aquí no se puede decir"}: no se ha visto. Método de cálculo: ${replay.algorithm}.`,
    );
    const limits = node("ul", "case-limits");
    for (const limit of replay.limits) limits.append(node("li", undefined, limit));
    box.append(note, label, slider, when, events, table, limits);
    return box;
  }

  function replayRow(entry: CaseReplayVehicle): HTMLTableRowElement {
    const row = node("tr");
    row.dataset["agv"] = entry.agvId;
    row.dataset["state"] = entry.state.kind;
    if (entry.expected?.behind === true) row.dataset["behind"] = "si";
    const seen = ((): string => {
      switch (entry.state.kind) {
        case "en-tag":
          return `en ${entry.state.tagId} (visto)`;
        case "en-transito":
          return `entre ${entry.state.fromTagId} y ${entry.state.toTagId}, al ${Math.round(entry.state.fraction * 100)} % del tiempo (inferido)`;
        case "silencio":
          return `sin lecturas desde ${entry.state.lastTagId}, ${input.formatInstant(entry.state.sinceUtcMs)} (desconocido)`;
        default:
          return `aún sin lecturas; la primera, ${input.formatInstant(entry.state.firstReadingUtcMs)}`;
      }
    })();
    const expected = ((): string => {
      const band = entry.expected;
      if (band === null) return "no se puede decir";
      if (band.beyondLap) return `a paso habitual, más de una vuelta desde ${band.fromTagId}`;
      const range =
        band.slowTagId === band.typicalTagId
          ? `en ${band.slowTagId}`
          : `entre ${band.slowTagId} y ${band.typicalTagId}`;
      const steps = band.typicalSteps === 0 ? "" : ` (${band.slowSteps} a ${band.typicalSteps} ${band.typicalSteps === 1 ? "tag" : "tags"} después de ${band.fromTagId})`;
      const behind = band.behind === true ? "; va por detrás incluso del paso lento" : "";
      return `${range}${steps}${band.truncated ? "; más allá, sin horquilla" : ""}${behind}`;
    })();
    for (const text of [entry.agvId, seen, expected, CONNECTION_TEXT[entry.connection]]) row.append(node("td", undefined, text));
    return row;
  }

  /**
   * El informe del expediente y su exportación (D11): un HTML autocontenido con los diez apartados, que
   * se imprime a PDF desde el navegador, y dos CSV, la cronología y las lecturas del recorte. Es una
   * instantánea de la revisión vigente; nada sale del dispositivo.
   */
  function exportBlock(view: CaseView): HTMLElement {
    const box = node("div", "case-export");
    const report = button("Informe del expediente", "case-export-report");
    report.addEventListener("click", () => input.exportCase("informe", view));
    box.append(report);
    if (view.chronology !== null) {
      const chronology = button("Cronología (CSV)", "case-export-chronology");
      chronology.addEventListener("click", () => input.exportCase("cronologia", view));
      box.append(chronology, sender("Lecturas del recorte (CSV)", "case-export-readings", () => true, () => input.exportCase("lecturas", view)));
    }
    box.append(node("p", "muted", `Instantánea de la revisión ${view.current.revision}. El informe se abre sin red; «Imprimir → Guardar como PDF» lo convierte en PDF.`));
    return box;
  }

  /**
   * Los casos parecidos del mismo circuito (ALG-017, D10): cada característica comparada a la vista, sin
   * puntuación oculta; lo confirmado en aquel caso, que no es evidencia para este; y los hechos de este
   * caso que se repiten en otros, contados sin llamarlo correlación.
   */
  function similarBlock(view: CaseView): HTMLElement {
    const box = node("section", "case-similar");
    box.append(
      node("h4", undefined, "Casos parecidos"),
      node(
        "p",
        "muted",
        "Otros expedientes de este circuito, ordenados por cuántas características coinciden, todas con el mismo peso. " +
          "Lo que se confirmó en otro caso no es evidencia para este.",
      ),
    );
    const similarity = view.similar;
    if (similarity === null || similarity.similar.length === 0) {
      box.append(node("p", "muted", "No hay otros expedientes en este circuito con que compararlo."));
      return box;
    }
    if (similarity.repetitions.length > 0) {
      const repeated = node("ul", "case-repetitions");
      for (const repetition of similarity.repetitions) {
        repeated.append(
          node(
            "li",
            undefined,
            `${repetition.text} También precede en ${repetition.caseIds.join(", ")}. Que se repita no basta para decir que va con el síntoma: hace falta saber cuánto ocurre fuera de las incidencias, y eso todavía no se mide.`,
          ),
        );
      }
      box.append(node("p", undefined, "Lo que se repite en otros casos:"), repeated);
    }
    const list = node("ol", "case-similar-list");
    for (const entry of similarity.similar) {
      const item = node("li", "case-similar-item");
      item.dataset["caseId"] = entry.caseId;
      const details = node("details");
      details.append(
        node(
          "summary",
          undefined,
          `${entry.caseId}: ${entry.title} — ${entry.stateText}, ${input.formatInstant(entry.symptomFrom)} · coinciden ${entry.matches} de ${entry.compared}`,
        ),
      );
      const table = node("table", "case-similar-table");
      const head = node("tr");
      for (const title of ["Característica", "Comparación", "Este caso frente a aquel"]) head.append(node("th", undefined, title));
      table.append(head);
      for (const feature of entry.features) {
        const row = node("tr");
        row.dataset["verdict"] = feature.verdict;
        for (const text of [feature.feature, VERDICT_WORD[feature.verdict], feature.text]) row.append(node("td", undefined, text));
        table.append(row);
      }
      details.append(table);
      for (const confirmed of entry.confirmedThere) details.append(node("p", "case-similar-confirmed", `Confirmado en aquel caso: ${confirmed}. No es evidencia para este.`));
      item.append(details);
      list.append(item);
    }
    box.append(list, node("p", "muted", `Método de cálculo: ${similarity.algorithm}.`));
    return box;
  }

  /** ¿Admite el expediente hipótesis y contramedidas? Solo mientras se investiga. */
  const working = (view: CaseView): boolean =>
    ["Investigating", "CountermeasurePlanned", "VerificationPending", "VerifiedIneffective"].includes(view.current.state);

  /**
   * Las hipótesis (D6): las del programa con lo que las sostiene y lo que las contradice, y las de la
   * persona. Sin porcentajes: el orden es primero las que siguen en pie. Confirmar exige escribir la
   * comprobación hecha; descartar, la razón. Lo que decide la persona se enseña como suyo.
   */
  function hypothesesBlock(view: CaseView): HTMLElement {
    const box = node("section", "case-hypotheses");
    box.append(
      node("h4", undefined, "Hipótesis"),
      node(
        "p",
        "muted",
        "Salen de lo que precede al síntoma en la cronología. «Es compatible» no quiere decir que sea la explicación: quiere decir que nada de lo observado la contradice. " +
          "La que se confirma la confirma una persona, con la comprobación que hizo.",
      ),
    );
    if (view.hypotheses.length === 0) box.append(node("p", "muted", "Todavía no hay hipótesis."));
    const list = node("ol", "case-hypothesis-list");
    for (const hypothesis of view.hypotheses) list.append(hypothesisItem(view, hypothesis));
    box.append(list);
    if (working(view)) {
      const text = field("Añadir una hipótesis tuya", "case-hypothesis-text", "text");
      box.append(
        text.box,
        sender("Guardar la hipótesis", "case-hypothesis-send", () => text.input.value.trim() !== "", () =>
          input.send({ kind: "hipotesis", caseId: view.current.caseId, expectedRevision: view.current.revision, text: text.input.value, author: author.input.value }),
        ),
      );
    }
    return box;
  }

  function hypothesisItem(view: CaseView, hypothesis: HypothesisView): HTMLElement {
    const item = node("li", "case-hypothesis");
    item.dataset["key"] = hypothesis.key;
    item.dataset["status"] = hypothesis.status;
    if (hypothesis.decision !== null) item.dataset["decision"] = hypothesis.decision.state;
    const head = node("p", "case-hypothesis-head");
    head.append(node("span", "case-hypothesis-text-value", hypothesis.text), " ");
    head.append(node("span", "chip case-hypothesis-status", hypothesis.origin === "persona" ? "tuya" : HYPOTHESIS_STATUS_TEXT[hypothesis.status]));
    if (hypothesis.decision !== null) {
      head.append(" ", node("span", "chip case-hypothesis-decision", hypothesis.decision.state === "confirmada" ? "confirmada por una persona" : "descartada por una persona"));
    }
    item.append(head);
    const facts = view.chronology?.facts ?? [];
    if (hypothesis.favor.length > 0) {
      const favor = node("ul", "case-hypothesis-favor");
      for (const index of hypothesis.favor) {
        const fact = facts[index];
        if (fact !== undefined) favor.append(node("li", undefined, `A favor, ${input.formatInstant(fact.at)}: ${fact.text}`));
      }
      item.append(favor);
    }
    if (hypothesis.against.length > 0) {
      const against = node("ul", "case-hypothesis-against");
      for (const entry of hypothesis.against) {
        const line = node("li", undefined, `En contra: ${entry.text}`);
        if (entry.provenance.length > 0) line.title = `Evidencia: ${entry.provenance.map((row) => `fila ${row.sourceRow}`).join(", ")}`;
        against.append(line);
      }
      item.append(against);
    }
    item.append(node("p", "muted case-hypothesis-check", `Lo que la separa de las demás: ${hypothesis.check}`));
    if (hypothesis.decision !== null) item.append(node("p", "case-hypothesis-note", `${hypothesis.decision.state === "confirmada" ? "Comprobación" : "Razón"}: ${hypothesis.decision.note}`));
    if (working(view) && hypothesis.decision === null) {
      const note = field("Comprobación hecha (para confirmar) o razón (para descartar)", "case-hypothesis-note-input", "text");
      const row = node("div", "case-hypothesis-actions");
      const decide = (state: "confirmada" | "descartada"): void =>
        input.send({ kind: "decidir-hipotesis", caseId: view.current.caseId, expectedRevision: view.current.revision, key: hypothesis.key, state, note: note.input.value, author: author.input.value });
      row.append(
        sender("Confirmar", "case-hypothesis-confirm", () => note.input.value.trim() !== "", () => decide("confirmada")),
        sender("Descartar", "case-hypothesis-discard", () => note.input.value.trim() !== "", () => decide("descartada")),
      );
      item.append(note.box, row);
    }
    return item;
  }

  /**
   * Las contramedidas (D9): acción, responsable, fecha prevista, riesgo y la métrica, que es la del
   * síntoma y no cambia. Aplicada, se registra su fecha; pendiente de verificar, se mide y se registra la
   * verificación, que propone y no concluye.
   */
  function countermeasuresBlock(view: CaseView): HTMLElement {
    const box = node("section", "case-countermeasures");
    box.append(node("h4", undefined, "Contramedidas y verificación"));
    const current = view.current;
    if (current.countermeasures.length === 0) box.append(node("p", "muted", "Todavía no hay contramedidas."));
    const list = node("ul", "case-countermeasure-list");
    for (const measure of current.countermeasures) {
      const item = node("li", "case-countermeasure");
      item.dataset["id"] = measure.id;
      item.append(
        node("p", "case-countermeasure-head", `${measure.id}: ${measure.action} — ${measure.owner}, prevista ${input.formatInstant(measure.plannedAt)}`),
        node("p", "muted", `Métrica: ${metricText(measure.metric)}.${measure.risk === "" ? "" : ` Riesgo: ${measure.risk}.`}`),
        node("p", "case-countermeasure-applied", measure.appliedAt === null ? "Sin aplicar." : `Aplicada ${input.formatInstant(measure.appliedAt)}.`),
      );
      if (working(view) && measure.appliedAt === null) {
        const at = field("Fecha de aplicación", "plan-date case-applied-at", "datetime-local");
        at.input.value = toDateTimeInput(Date.now(), input.zone, "minutes");
        item.append(
          at.box,
          sender("Registrar la aplicación", "case-apply-send", () => fromDateTimeInput(at.input.value, input.zone) !== null, () =>
            input.send({
              kind: "aplicar",
              caseId: current.caseId,
              expectedRevision: current.revision,
              countermeasureId: measure.id,
              appliedAt: fromDateTimeInput(at.input.value, input.zone) as number,
              author: author.input.value,
            }),
          ),
        );
      }
      if (current.state === "VerificationPending" && measure.appliedAt !== null) {
        item.append(
          node("p", "muted", "Se cuenta la métrica una semana antes y otra después de la aplicación, con las lecturas del circuito que haya en este dispositivo."),
          sender("Medir y registrar la verificación", "case-verify-send", () => true, () =>
            input.send({ kind: "verificar", caseId: current.caseId, expectedRevision: current.revision, countermeasureId: measure.id, author: author.input.value }),
          ),
        );
      }
      list.append(item);
    }
    box.append(list);
    if (current.verification !== null) {
      const verification = node("div", "case-verification");
      verification.dataset["verdict"] = current.verification.result.verdict;
      verification.append(
        node("p", "case-verification-head", `Verificación de ${current.verification.countermeasureId}, medida ${input.formatInstant(current.verification.recordedAt)}:`),
        node("p", "case-verification-text", verificationText(current.verification.result)),
        node("p", "muted", `Método de cálculo: ${current.verification.result.algorithm}. La conclusión se escribe al pasar el expediente a verificada eficaz o ineficaz.`),
      );
      box.append(verification);
    }
    if (working(view) && current.state !== "VerificationPending") box.append(countermeasureForm(view));
    return box;
  }

  function countermeasureForm(view: CaseView): HTMLElement {
    const box = node("div", "plan-form case-countermeasure-form");
    box.append(node("p", "plan-form-title", "Nueva contramedida"));
    const action = field("Acción", "case-cm-action", "text");
    const owner = field("Responsable", "case-cm-owner", "text");
    const planned = field("Fecha prevista", "plan-date case-cm-planned", "datetime-local");
    planned.input.value = toDateTimeInput(Date.now(), input.zone, "minutes");
    const risk = field("Riesgo (opcional)", "case-cm-risk", "text");
    const proposal: CaseMetric | null = view.metricProposal;
    const gap = field("Episodio: hueco de al menos (minutos)", "plan-date case-cm-gap", "number");
    gap.input.min = "1";
    gap.input.value = proposal === null ? "" : String(Math.round(proposal.minGapMs / MIN));
    const metricOf = (): CaseMetric | null => {
      const minutes = Number(gap.input.value);
      if (proposal === null || !Number.isFinite(minutes) || minutes <= 0) return null;
      return { ...proposal, minGapMs: minutes * MIN };
    };
    const metricNote = node(
      "p",
      "muted case-cm-metric",
      proposal === null
        ? "El síntoma no nombra un tag ni un AGV: no hay métrica que medir. Añade el tag o el AGV al expediente."
        : `Métrica, la del síntoma: ${metricText(proposal)}. Queda fija con la contramedida.`,
    );
    const ready = (): boolean =>
      action.input.value.trim() !== "" && owner.input.value.trim() !== "" && fromDateTimeInput(planned.input.value, input.zone) !== null && metricOf() !== null;
    box.append(
      action.box,
      owner.box,
      planned.box,
      risk.box,
      metricNote,
      gap.box,
      sender("Guardar la contramedida", "case-cm-send", ready, () => {
        const metric = metricOf();
        if (metric === null) return;
        input.send({
          kind: "contramedida",
          caseId: view.current.caseId,
          expectedRevision: view.current.revision,
          countermeasure: {
            action: action.input.value,
            owner: owner.input.value,
            plannedAt: fromDateTimeInput(planned.input.value, input.zone) as number,
            risk: risk.input.value,
            metric,
          },
          author: author.input.value,
        });
      }),
    );
    return box;
  }

  function caseItem(view: CaseView): HTMLElement {
    const current = view.current;
    const item = node("li", "case-item");
    item.dataset["caseId"] = current.caseId;
    item.dataset["state"] = current.state;
    const details = node("details", "case-details");
    details.open = open === current.caseId;
    details.addEventListener("toggle", () => {
      if (details.open) open = current.caseId;
      else if (open === current.caseId) open = null;
    });
    const summary = node("summary", "case-summary");
    summary.append(
      node("span", "case-id", current.caseId),
      node("span", "chip case-state", CASE_STATE_TEXT[current.state]),
      node("span", "case-title", current.title),
    );
    details.append(summary);
    const facts = node("div", "case-facts");
    facts.append(
      node("p", "case-window-text", windowText(view)),
      node("p", "muted case-origin-text", `Nace de ${view.originText}.`),
      node("p", "case-evidence", view.evidenceText),
    );
    if (view.integrity.length > 0) {
      facts.append(node("p", "case-integrity", `La cadena de revisiones no está entera: ${view.integrity.join("; ")}.`));
    }
    facts.append(node("p", "case-symptom-text", current.symptom));
    const who = [current.agvId === null ? null : `AGV ${current.agvId}`, current.tagIds.length === 0 ? null : `tags ${current.tagIds.join(", ")}`].filter(
      (entry): entry is string => entry !== null,
    );
    if (who.length > 0) facts.append(node("p", "muted", who.join(" · ")));
    const refs = current.references;
    facts.append(
      node(
        "p",
        "muted case-references",
        `${refs.memory === null ? "Sin memoria consolidada" : `Memoria v${refs.memory.version}`} · configuración ${refs.configVersion} · aplicación ${refs.appVersion} · ${current.evidence.algorithm}`,
      ),
    );
    if (current.stateReason !== null) facts.append(node("p", "case-reason", `Razón del estado: ${current.stateReason}`));
    if (current.notes.length > 0) {
      const notes = node("ul", "case-notes");
      for (const note of current.notes) notes.append(node("li", undefined, `${input.formatInstant(note.at)}: ${note.text}`));
      facts.append(node("h4", undefined, "Notas"), notes);
    }
    const history = node("ol", "case-history");
    for (const entry of view.history) {
      history.append(
        node("li", undefined, `Revisión ${entry.revision}, ${input.formatInstant(entry.createdAt)}${entry.author === null ? "" : `, ${entry.author}`}: ${entry.change.text}`),
      );
    }
    facts.append(node("h4", undefined, "Historial"), history);
    details.append(exportBlock(view), facts, chronologyBlock(view), replayBlock(view), hypothesesBlock(view), similarBlock(view), countermeasuresBlock(view));

    const actions = node("div", "case-actions");
    if (view.transitions.length > 0) {
      actions.append(node("h4", undefined, "Cambiar de estado"));
      for (const option of view.transitions) actions.append(transitionControl(view, option));
    }
    if (current.state === "Draft") actions.append(windowForm(view));
    if (current.state !== "Closed" && current.state !== "Discarded") actions.append(noteForm(view));
    details.append(actions);
    item.append(details);
    return item;
  }

  function render(): void {
    senders.length = 0;
    body.replaceChildren();
    paintStatus();
    if (context.circuitId === null || context.views === null) {
      body.append(node("p", "muted", "Los expedientes son de un circuito guardado en este dispositivo: importa sus lecturas."));
      return;
    }
    const views = context.views;
    const opener = button("Nuevo expediente…", "case-new");
    const holder = node("div", "case-new-holder");
    opener.addEventListener("click", () => {
      opener.hidden = true;
      holder.replaceChildren(createForm());
    });
    body.append(author.box, opener, holder);
    if (views.cases.length === 0) {
      body.append(node("p", "plan-none", "Este circuito no tiene expedientes."));
    } else {
      const list = node("ul", "cases-list");
      for (const view of views.cases) list.append(caseItem(view));
      body.append(list);
    }
    body.append(node("p", "muted cases-bytes", `Los expedientes ocupan ${(views.storedBytes / 1024).toLocaleString("es-ES", { maximumFractionDigits: 1 })} KB en este dispositivo, comprimidos.`));
    applyBusy();
  }

  render();

  return {
    node: root,
    update(next) {
      context = next;
      status = null;
      render();
    },
    showUpdated(written, caseId, views) {
      context = { ...context, views };
      open = caseId;
      status = { kind: "info", lines: [written] };
      render();
    },
    showReplay(caseId, revision, replay) {
      replays.set(caseId, { revision, replay, frame: 0 });
      open = caseId;
      status = null;
      render();
    },
    showError(cause, recovery) {
      status = { kind: "error", lines: [cause, recovery] };
      paintStatus();
    },
    notice(text) {
      status = { kind: "info", lines: [text] };
      paintStatus();
    },
    setBusy(next) {
      busy = next;
      applyBusy();
    },
  };
}
