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
import { CASE_STATE_TEXT, type CaseOrigin, type CaseState, type TransitionOption } from "../domain/incident-case.js";

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(text: string, className?: string): HTMLButtonElement {
  const out = node("button", className, text);
  out.type = "button";
  return out;
}

const MIN = 60_000;

/** «2026-10-09T10:40» en la zona del circuito, para un `datetime-local`. */
export function toLocalInput(utcMs: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** El instante UTC de un `datetime-local` leído en la zona del circuito, o `null` si no es una fecha. */
export function fromLocalInput(text: string, zone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (match === null) return null;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? "0"));
  // Dos pasadas: la diferencia entre lo que la zona enseña y lo pedido es su desfase en ese instante.
  let guess = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    const shown = fromLocalParts(guess, zone);
    guess += wall - shown;
  }
  return guess;
}

function fromLocalParts(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const part = (type: string): number => Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

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
}

export interface CasesPanel {
  readonly node: HTMLElement;
  update(context: CasesContext): void;
  showUpdated(written: string, caseId: string, views: CaseViews): void;
  showError(cause: string, recovery: string): void;
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
export function excludedStarts(excluded: readonly ExcludedIncidentStart[]): readonly CaseStart[] {
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
      from.input.value = chosen.from === null ? "" : toLocalInput(chosen.from, input.zone);
      to.input.value = chosen.to === null ? "" : toLocalInput(chosen.to, input.zone);
      applyBusy();
    };
    origin.input.addEventListener("change", fillStarts);
    start.input.addEventListener("change", pick);

    const ready = (): boolean =>
      context.circuitId !== null &&
      title.input.value.trim() !== "" &&
      symptom.input.value.trim() !== "" &&
      fromLocalInput(from.input.value, input.zone) !== null &&
      fromLocalInput(to.input.value, input.zone) !== null &&
      (origin.input.value === "sintoma" || chosen !== null);
    const create = sender("Crear expediente", "case-create-send", ready, () => {
      const symptomFrom = fromLocalInput(from.input.value, input.zone) as number;
      const symptomTo = fromLocalInput(to.input.value, input.zone) as number;
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
    from.input.value = toLocalInput(w.symptomFrom, input.zone);
    const to = field("Fin del síntoma", "plan-date case-window-to", "datetime-local");
    to.input.value = toLocalInput(w.symptomTo, input.zone);
    const before = field("Margen antes (minutos)", "plan-date case-window-before", "number");
    before.input.min = "0";
    before.input.value = String(Math.round(w.marginBeforeMs / MIN));
    const after = field("Margen después (minutos)", "plan-date case-window-after", "number");
    after.input.min = "0";
    after.input.value = String(Math.round(w.marginAfterMs / MIN));
    const read = (): { symptomFrom: number; symptomTo: number; marginBeforeMs: number; marginAfterMs: number } | null => {
      const a = fromLocalInput(from.input.value, input.zone);
      const b = fromLocalInput(to.input.value, input.zone);
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
    details.append(facts);

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
