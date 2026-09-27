/**
 * La sección «Valores de planta del circuito» de la pestaña Datos (OQ-140, OQ-151).
 *
 * Aquí no se decide ni se mide nada: lo vigente para el fichero de trabajo, el historial, dónde mide
 * el programa algo relacionado y lo que propone la memoria —la propuesta, o por qué no la hay, con la
 * estimación de cada versión consolidada— llegan hechos del Worker (`PlantValuesView`). Este módulo los
 * pone en palabras y en un formulario. Lo único que sale de aquí es lo que una persona confirma con un
 * botón: el valor (o la propuesta), la fecha desde la que rige y una razón escrita. Sin razón, el botón
 * que envía está apagado. Una propuesta no se aplica sola: el Worker la vuelve a comprobar al escribir.
 *
 * Leer lo que se escribe en el formulario —«6, 14, 22», «2», «1,5»— es formato de entrada, no análisis;
 * la validación que se enseña es la misma del dominio, y el Worker la repite antes de escribir.
 *
 * Todo texto del dato entra por `textContent` (TH-007).
 */

import {
  formatPlantValue,
  validatePlantValue,
  type PlantValue,
  type PlantValueEvent,
  type PlantValueKey,
  type PlantValueProposal,
  type PlantValueProposals,
  type PlantValueSection,
  type PlantValueView,
  type PlantValuesRelation,
  type PlantValuesView,
} from "../domain/plant-values.js";
import { isoDay, zoneMidnight } from "./plan-ui.js";

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

/** La relación de los valores de un `.agvproj` abierto con los locales, en una frase. */
export function plantValuesRelationText(relation: PlantValuesRelation, added: number): string {
  switch (relation) {
    case "sin-valores":
      return "El proyecto no traía valores de planta confirmados.";
    case "identico":
      return "Los valores de planta del proyecto son idénticos a los de este dispositivo.";
    case "local-adelantado":
      return "Los valores de planta de este dispositivo van por delante de los del proyecto: se conservan.";
    case "entrante-adelantado":
      return `Los valores de planta del proyecto van por delante: se ${added === 1 ? "añade 1 valor confirmado" : `añaden ${added.toLocaleString("es-ES")} valores confirmados`}.`;
    case "distinto":
      return "Los valores de planta del proyecto son distintos de los de este dispositivo: no se mezclan, y los de aquí quedan como estaban.";
  }
}

export interface PlantValueSendRequest {
  readonly key: PlantValueKey;
  readonly value: PlantValue;
  readonly effectiveAt: number;
  readonly reason: string;
  readonly origin: "manual" | "propuesta";
}

export interface PlantValuesContext {
  readonly circuitId: string | null;
  /** `null` si todavía no hay análisis. */
  readonly view: PlantValuesView | null;
}

export interface PlantValuesPanelInput {
  readonly formatInstant: (utcMs: number) => string;
  /** La zona del circuito: la fecha efectiva que se elige es un día en esa zona. */
  readonly zone: string;
  /**
   * Solo lo llama un botón de confirmar, con la razón escrita: `manual` si el valor lo escribió la
   * persona, `propuesta` si confirma la propuesta de la memoria.
   */
  readonly send: (request: PlantValueSendRequest) => void;
  /** Lleva a la sección donde el programa mide algo relacionado. */
  readonly goTo: (section: PlantValueSection) => void;
}

export interface PlantValuesPanel {
  readonly node: HTMLElement;
  update(context: PlantValuesContext): void;
  showUpdated(written: string, appliesToWorking: boolean, view: PlantValuesView): void;
  showError(cause: string, recovery: string): void;
  setBusy(busy: boolean): void;
  /** Las propuestas nuevas tras consolidar, revocar o elegir linaje; lo demás de la vista no cambia. */
  proposalsChanged(proposals: PlantValueProposals | null): void;
}

/** Lo escrito en el campo, leído como valor; o el motivo de que no se pueda leer. */
function parseInput(entry: PlantValueView, text: string): { readonly value: PlantValue } | { readonly problem: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { problem: "Escribe el valor." };
  if (entry.kind === "hora") {
    return /^\d{1,2}$/.test(trimmed) ? { value: Number(trimmed) } : { problem: "Escribe la hora como un número entero, de 0 a 23." };
  }
  if (entry.kind === "horas") {
    const parts = trimmed.split(/[\s,;y]+/).filter((part) => part !== "");
    if (!parts.every((part) => /^\d{1,2}$/.test(part))) return { problem: "Escribe las horas separadas por comas, por ejemplo «6, 14, 22»." };
    return { value: parts.map(Number) };
  }
  if (!/^\d+(?:[.,]\d+)?$/.test(trimmed)) return { problem: `Escribe un número de ${entry.inputUnit === "s" ? "segundos" : "minutos"}, por ejemplo «2» o «1,5».` };
  const unitMs = entry.inputUnit === "s" ? 1000 : 60_000;
  return { value: Math.round(Number(trimmed.replace(",", ".")) * unitMs) };
}

/** El valor tal como se escribe en el campo, en la unidad del campo. */
function toInput(entry: PlantValueView, value: PlantValue): string {
  if (typeof value !== "number") return [...value].sort((a, b) => a - b).join(", ");
  if (entry.kind === "hora") return String(value);
  const unitMs = entry.inputUnit === "s" ? 1000 : 60_000;
  return (value / unitMs).toLocaleString("es-ES", { maximumFractionDigits: 3, useGrouping: false });
}

export function createPlantValuesPanel(input: PlantValuesPanelInput): PlantValuesPanel {
  const root = node("section", "panel plant-values-panel");
  root.setAttribute("aria-labelledby", "plant-values-heading");
  let context: PlantValuesContext = { circuitId: null, view: null };
  let status: { readonly kind: "info" | "error"; readonly lines: readonly string[] } | null = null;
  let busy = false;
  const senders: { readonly control: HTMLButtonElement; readonly ready: () => boolean }[] = [];

  const heading = node("h2", undefined, "Valores de planta del circuito");
  heading.id = "plant-values-heading";
  const intro = node(
    "p",
    "muted",
    "Rigen los provisionales hasta que confirmes el valor de tu planta. La memoria propone un valor cuando lo estima igual en las " +
      "últimas versiones consolidadas (OQ-151); si no coinciden, lo introduces tú. Nada se aplica sin tu confirmación.",
  );
  const statusBox = node("div", "plan-status plant-values-status");
  statusBox.setAttribute("role", "status");
  statusBox.setAttribute("aria-live", "polite");
  const body = node("div", "plant-values-body");
  root.append(heading, intro, statusBox, body);

  const fmt = (entry: PlantValueView, value: PlantValue): string => formatPlantValue(entry.kind, entry.inputUnit, value);

  function paintStatus(): void {
    statusBox.replaceChildren();
    statusBox.className = status === null ? "plan-status plant-values-status" : `plan-status plant-values-status ${status.kind}`;
    if (status === null) return;
    for (const line of status.lines) statusBox.append(node("p", undefined, line));
  }

  function applyBusy(): void {
    for (const { control, ready } of senders) control.disabled = busy || !ready();
  }

  let fieldCount = 0;
  function field(labelText: string, className: string, type: string): { readonly box: HTMLElement; readonly input: HTMLInputElement } {
    fieldCount += 1;
    const id = `plant-field-${fieldCount}`;
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

  function openForm(entry: PlantValueView, holder: HTMLElement, opener: HTMLButtonElement): void {
    holder.querySelector(".plan-form")?.remove();
    opener.hidden = true;
    const unit =
      entry.kind === "hora" ? "hora del día, de 0 a 23" : entry.kind === "horas" ? "horas del día, separadas por comas" : entry.inputUnit === "s" ? "segundos" : "minutos";
    const valueField = field(`Valor de tu planta (${unit})`, "plant-value-input", "text");
    valueField.input.inputMode = entry.kind === "horas" ? "text" : "decimal";
    valueField.input.value = toInput(entry, entry.current?.value ?? entry.provisional);
    const problem = node("p", "muted plant-value-problem");
    problem.setAttribute("aria-live", "polite");

    const today = isoDay(Date.now(), input.zone);
    const dateField = field("Desde (fecha efectiva)", "plan-date plant-value-date", "date");
    dateField.input.value = today;
    const effectiveAt = (): number | null => (dateField.input.value === today ? Date.now() : zoneMidnight(dateField.input.value, input.zone));

    const reasonField = field("Razón (obligatoria)", "plan-reason plant-value-reason", "text");
    reasonField.input.placeholder = "Por qué es ese el valor de tu planta";

    const parsed = (): { readonly value: PlantValue } | { readonly problem: string } => {
      const read = parseInput(entry, valueField.input.value);
      if ("problem" in read) return read;
      const invalid = validatePlantValue(entry.key, read.value);
      return invalid === null ? read : { problem: invalid };
    };
    const ready = (): boolean => "value" in parsed() && effectiveAt() !== null && reasonField.input.value.trim() !== "";
    valueField.input.addEventListener("input", () => {
      const read = parsed();
      problem.textContent = "problem" in read ? read.problem : "";
    });

    const form = node("div", "plan-form plant-value-form");
    form.setAttribute("role", "group");
    form.setAttribute("aria-label", `Cambiar «${entry.label}»`);
    form.append(
      node("p", "plan-form-title", `Cambiar «${entry.label}»`),
      valueField.box,
      problem,
      dateField.box,
      node(
        "p",
        "muted",
        "Rige para los ficheros que empiezan desde esa fecha, y se aplica al volver a analizarlos: lo ya analizado no cambia hasta que vuelvas a cargarlo.",
      ),
      reasonField.box,
    );
    const send = button("Confirmar el valor", "plan-send plant-value-send");
    senders.push({ control: send, ready });
    send.disabled = busy || !ready();
    send.addEventListener("click", () => {
      const read = parsed();
      const at = effectiveAt();
      if (!("value" in read) || at === null || reasonField.input.value.trim() === "") return;
      status = null;
      paintStatus();
      input.send({ key: entry.key, value: read.value, effectiveAt: at, reason: reasonField.input.value.trim(), origin: "manual" });
    });
    const cancel = button("Cancelar");
    cancel.addEventListener("click", () => {
      form.remove();
      opener.hidden = false;
      opener.focus();
    });
    const row = node("div", "button-row");
    row.append(send, cancel);
    form.append(row);
    holder.append(form);
    valueField.input.focus();
  }

  /** «v4, v5 y v6». */
  const versionNames = (versions: readonly number[]): string => {
    const names = versions.map((version) => `v${version}`);
    return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1] as string}`;
  };

  /** Confirmar la propuesta de la memoria: fecha efectiva y razón obligatoria; el valor no se edita. */
  function openProposalForm(entry: PlantValueView, proposed: PlantValue, holder: HTMLElement, opener: HTMLButtonElement): void {
    holder.querySelector(".plan-form")?.remove();
    opener.hidden = true;
    const today = isoDay(Date.now(), input.zone);
    const dateField = field("Desde (fecha efectiva)", "plan-date plant-value-date", "date");
    dateField.input.value = today;
    const effectiveAt = (): number | null => (dateField.input.value === today ? Date.now() : zoneMidnight(dateField.input.value, input.zone));
    const reasonField = field("Razón (obligatoria)", "plan-reason plant-value-reason", "text");
    reasonField.input.placeholder = "Por qué la propuesta es el valor de tu planta";
    const ready = (): boolean => effectiveAt() !== null && reasonField.input.value.trim() !== "";

    const form = node("div", "plan-form plant-value-form plant-proposal-form");
    form.setAttribute("role", "group");
    form.setAttribute("aria-label", `Confirmar la propuesta para «${entry.label}»`);
    form.append(
      node("p", "plan-form-title", `Confirmar la propuesta para «${entry.label}»: ${fmt(entry, proposed)}`),
      dateField.box,
      node(
        "p",
        "muted",
        "Rige para los ficheros que empiezan desde esa fecha, y se aplica al volver a analizarlos: lo ya analizado no cambia hasta que vuelvas a cargarlo.",
      ),
      reasonField.box,
    );
    const send = button("Confirmar la propuesta", "plan-send plant-proposal-send");
    senders.push({ control: send, ready });
    send.disabled = busy || !ready();
    send.addEventListener("click", () => {
      const at = effectiveAt();
      if (at === null || reasonField.input.value.trim() === "") return;
      status = null;
      paintStatus();
      input.send({ key: entry.key, value: proposed, effectiveAt: at, reason: reasonField.input.value.trim(), origin: "propuesta" });
    });
    const cancel = button("Cancelar");
    cancel.addEventListener("click", () => {
      form.remove();
      opener.hidden = false;
      opener.focus();
    });
    const row = node("div", "button-row");
    row.append(send, cancel);
    form.append(row);
    holder.append(form);
    reasonField.input.focus();
  }

  /** La estimación de cada versión, con su porqué. */
  function estimatesBlock(entry: PlantValueView, proposal: PlantValueProposal): HTMLElement | null {
    if (proposal.estimates.length === 0) return null;
    const box = node("details", "plant-value-estimates");
    box.append(node("summary", undefined, "Estimación de cada versión"));
    const list = node("ul");
    for (const estimate of proposal.estimates) {
      const item = node("li");
      item.dataset["version"] = String(estimate.version);
      item.textContent = `v${estimate.version} (${estimate.fileName}): ${estimate.value === null ? "sin datos" : fmt(entry, estimate.value)} — ${estimate.why}.`;
      list.append(item);
    }
    box.append(list);
    return box;
  }

  /** Lo que propone la memoria: la propuesta con su botón, o por qué no la hay y las estimaciones. */
  function proposalBlock(entry: PlantValueView, canConfirm: boolean, actions: HTMLElement): HTMLElement | null {
    const proposal = entry.proposal;
    if (proposal === null) return null;
    const box = node("div", "plant-value-proposal");
    box.dataset["outcome"] = proposal.outcome;
    const proposed = proposal.proposal;
    if (proposed !== null) {
      box.append(node("p", "plant-proposal-line", `Propuesta de la memoria: ${fmt(entry, proposed)} (${proposal.reason}).`));
      if (canConfirm) {
        const opener = button("Confirmar la propuesta…", "plant-proposal-open");
        opener.setAttribute("aria-label", `Confirmar la propuesta para «${entry.label}»`);
        opener.addEventListener("click", () => openProposalForm(entry, proposed, actions, opener));
        actions.append(opener);
      }
    } else {
      const each = proposal.estimates.map((estimate) => `v${estimate.version}: ${estimate.value === null ? "sin datos" : fmt(entry, estimate.value)}`);
      box.append(
        node(
          "p",
          "plant-proposal-line",
          `Sin propuesta: ${proposal.reason}${each.length === 0 ? "" : ` — ${each.join(", ")}`}. Introduce el valor.`,
        ),
      );
    }
    const estimates = estimatesBlock(entry, proposal);
    if (estimates !== null) box.append(estimates);
    return box;
  }

  function historyBlock(entry: PlantValueView): HTMLElement | null {
    if (entry.history.length === 0) return null;
    const box = node("details", "plant-value-history");
    box.append(node("summary", undefined, `Historial (${entry.history.length === 1 ? "1 valor confirmado" : `${entry.history.length} valores confirmados`})`));
    const list = node("ul", "plan-events");
    for (const event of [...entry.history].reverse()) {
      const item = node("li", "plan-event");
      item.dataset["seq"] = String(event.seq);
      const head = node("div");
      head.append(node("span", "plan-event-when", `Desde ${input.formatInstant(event.effectiveAt)}`), " ", node("span", undefined, fmt(entry, event.value)));
      const origin =
        event.origin === "propuesta"
          ? ` · propuesta de la memoria${event.fromVersions === undefined || event.fromVersions.length === 0 ? "" : ` (${versionNames(event.fromVersions)})`}`
          : "";
      item.append(head, node("p", "muted", `Razón: ${event.reason} · registrado el ${input.formatInstant(event.recordedAt)}${origin}`));
      list.append(item);
    }
    box.append(list);
    return box;
  }

  function currentLine(entry: PlantValueView, current: PlantValueEvent | null): HTMLElement {
    const line = node("p", "plant-value-current");
    if (current === null) {
      line.append(node("span", "chip", "provisional"), " ", `Rige el provisional: ${fmt(entry, entry.provisional)}.`);
    } else {
      line.append(
        node("span", "chip confirmed", "confirmado"),
        " ",
        `Rige ${fmt(entry, current.value)}, desde ${input.formatInstant(current.effectiveAt)}` +
          `${current.origin === "propuesta" ? " (propuesta de la memoria)" : ""}. Razón: ${current.reason}`,
      );
    }
    return line;
  }

  function valueItem(entry: PlantValueView, canConfirm: boolean): HTMLElement {
    const item = node("li", "plant-value");
    item.dataset["key"] = entry.key;
    item.dataset["state"] = entry.current === null ? "provisional" : "confirmado";
    item.append(node("p", "plant-value-label", entry.label));
    item.append(node("p", "muted", `Provisional: ${fmt(entry, entry.provisional)}`));
    item.append(currentLine(entry, entry.current));
    if (entry.changesWithin !== null) {
      item.append(
        node(
          "p",
          "plant-value-boundary",
          `Cambia dentro de lo cargado: desde ${input.formatInstant(entry.changesWithin.effectiveAt)} rige ${fmt(entry, entry.changesWithin.value)}. ` +
            "Todo lo cargado se analiza con el vigente al inicio de este fichero, así que a un lado de esa fecha se lee con un valor que allí no regía.",
        ),
      );
    }
    const where = entry.measuredIn;
    if (where === null) {
      item.append(node("p", "muted", "El programa todavía no mide nada relacionado con este valor."));
    } else {
      const line = node("p", "muted plant-value-where");
      const link = button(`${where.tab} › ${where.heading}`, "link-button plant-value-link");
      link.addEventListener("click", () => input.goTo(where));
      line.append("Dónde lo mide el programa: ", link, ` — ${where.what}.`);
      item.append(line);
    }
    const actions = node("div", "plant-value-actions");
    const proposal = proposalBlock(entry, canConfirm, actions);
    if (proposal !== null) item.append(proposal);
    if (canConfirm) {
      const opener = button("Cambiar…", "plant-value-open");
      opener.setAttribute("aria-label", `Cambiar «${entry.label}»`);
      opener.addEventListener("click", () => openForm(entry, actions, opener));
      actions.append(opener);
    }
    item.append(actions);
    const history = historyBlock(entry);
    if (history !== null) item.append(history);
    return item;
  }

  function render(): void {
    senders.length = 0;
    const view = context.view;
    if (view === null) {
      body.replaceChildren(node("p", "muted", "Todavía no hay análisis: importa las lecturas del circuito."));
      paintStatus();
      return;
    }
    const out: HTMLElement[] = [];
    out.push(
      node(
        "p",
        "plant-values-note",
        "Un cambio se aplica al volver a analizar los ficheros de su vigencia (los que empiezan desde su fecha efectiva): lo ya analizado no cambia hasta que vuelvas a cargarlo.",
      ),
    );
    if (view.at !== null) {
      out.push(node("p", "muted", `Lo vigente es para el fichero de trabajo${view.fileName === null ? "" : ` «${view.fileName}»`}, que empieza el ${input.formatInstant(view.at)}.`));
    }
    const canConfirm = view.canConfirm && context.circuitId !== null;
    if (!canConfirm) {
      out.push(node("p", "muted", "Sin un circuito donde se haya acumulado el fichero no hay dónde guardar valores confirmados: se analiza con los provisionales."));
    }
    const list = node("ul", "plant-values");
    list.setAttribute("aria-label", "Valores de planta");
    for (const entry of view.values) list.append(valueItem(entry, canConfirm));
    out.push(list);
    body.replaceChildren(...out);
    paintStatus();
  }

  render();

  return {
    node: root,
    update(next) {
      context = next;
      status = null;
      render();
    },
    showUpdated(written, appliesToWorking, view) {
      context = { ...context, view };
      status = {
        kind: "info",
        lines: [
          `Valor confirmado. ${written}`,
          appliesToWorking
            ? "Rige ya para el fichero de trabajo: se aplica al volver a analizarlo (vuelve a cargarlo)."
            : "No rige para el fichero de trabajo, que empieza antes de la fecha efectiva: se aplicará a los ficheros que empiecen desde entonces.",
        ],
      };
      render();
    },
    showError(cause, recovery) {
      status = { kind: "error", lines: [`No se pudo confirmar el valor: ${cause}`, recovery] };
      paintStatus();
      applyBusy();
    },
    setBusy(next) {
      busy = next;
      applyBusy();
    },
    proposalsChanged(proposals) {
      const view = context.view;
      if (view === null) return;
      context = { ...context, view: { ...view, values: view.values.map((entry) => ({ ...entry, proposal: proposals?.[entry.key] ?? null })) } };
      render();
    },
  };
}
