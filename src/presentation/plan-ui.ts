/**
 * La sección «Plano del circuito» de la pestaña Memoria (ADR-0016).
 *
 * Aquí no se decide nada: el plano, lo que el fichero de trabajo dice de cada ubicación, las sumas de
 * todos los periodos y las propuestas llegan hechos del Worker (`PlanViews`). Este módulo los pone en
 * palabras y en botones. Lo único que sale de aquí son las acciones que una persona pide con un
 * botón y una razón escrita: crear el plano, confirmar una propuesta o registrar un cambio a mano.
 * Sin razón, el botón que envía está apagado. Ninguna propuesta se escribe sola.
 *
 * La única cuenta que se hace es de formato: la desviación típica de un tramo es la raíz de
 * `m2 / (n − 1)`, que el Worker ya dejó sumado. El desglose por AGV llega ya separado (por debajo de
 * la flota, el resto y los que no llegan a la muestra) y aquí solo se pone en palabras.
 *
 * Todo texto del dato entra por `textContent` (TH-007).
 */

import type { MemoryViews, PlanAction, PlanViews } from "../application/protocol.js";
import {
  nextLocationId,
  type EdgeSummary,
  type LocationObservation,
  type LocationSummary,
  type ManualResult,
  type Moments,
  type PlanEventInput,
  type PlanLocation,
  type PlanProposal,
  type PlanRelation,
  type VehicleBreakdown,
  type VehicleCounts,
} from "../domain/plan.js";
import { plainTable, scrollBox } from "./charts.js";
import type { MemoryWorkingFile } from "./memory-ui.js";
import { truthLabel } from "./labels.js";

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

/** Lo que encontró quien fue a mirar, en palabras. */
export const MANUAL_RESULT_LABEL: Readonly<Record<ManualResult, string>> = {
  correcto: "correcto",
  averiado: "averiado",
  "no-encontrado": "no encontrado",
};

/** La relación del plano de un `.agvproj` abierto con el local, en una frase (ADR-0016). */
export function planRelationText(relation: PlanRelation, added: number): string {
  switch (relation) {
    case "sin-plano":
      return "El proyecto no traía plano del circuito.";
    case "identico":
      return "El plano del proyecto es idéntico al de este dispositivo.";
    case "local-adelantado":
      return "El plano de este dispositivo va por delante del del proyecto: se conserva.";
    case "entrante-adelantado":
      return `El plano del proyecto va por delante: se ${added === 1 ? "añade 1 cambio" : `añaden ${added.toLocaleString("es-ES")} cambios`}.`;
    case "distinto":
      return "El plano del proyecto es distinto del de este dispositivo: no se mezcla, y el de aquí queda como estaba.";
  }
}

const plural = (count: number, one: string, many: string): string => `${count.toLocaleString("es-ES")} ${count === 1 ? one : many}`;

/** Un tiempo corto: segundos con una decimal hasta minuto y medio, minutos después. */
function clock(ms: number): string {
  return ms < 90_000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${(ms / 60_000).toFixed(1).replace(".", ",")} min`;
}

/** Desviación típica para enseñar: raíz de la varianza muestral; con menos de dos pasadas, «—». */
function spread(moments: Moments): string {
  if (moments.n < 2) return "—";
  return clock(Math.sqrt(moments.m2 / (moments.n - 1)));
}

export interface PlanContext {
  readonly circuitId: string | null;
  /** `null` si las vistas no traen plano: el circuito no tiene plano ni versión desde la que crearlo. */
  readonly plan: PlanViews | null;
  readonly working: MemoryWorkingFile | null;
}

export interface PlanPanelInput {
  readonly formatInstant: (utcMs: number) => string;
  /** El día corto, «12/01», para la historia de tags de una ubicación. */
  readonly formatDay: (utcMs: number) => string;
  /** La zona del circuito: la fecha efectiva que se elige es un día en esa zona. */
  readonly zone: string;
  /** Solo lo llaman los botones de envío, con la razón escrita. */
  readonly send: (action: PlanAction) => void;
}

export interface PlanPanel {
  readonly node: HTMLElement;
  /** Con cada análisis: el plano que traen las vistas, el circuito y el fichero de trabajo. */
  update(context: PlanContext): void;
  /**
   * La memoria cambió (se consolidó o se revocó una versión) sin análisis nuevo. Si todavía no hay
   * plano, la versión desde la que se puede crear es la vigente que acaba de decir el Worker.
   */
  memoryChanged(memory: MemoryViews): void;
  showUpdated(written: readonly string[], plan: PlanViews): void;
  showError(cause: string, recovery: string): void;
  /** Un aviso que no es un error: por ejemplo, que hay otro trabajo en curso. */
  notice(line: string): void;
  setBusy(busy: boolean): void;
}

/** «2026-01-27» del instante, en la zona del circuito: lo que un `input[type=date]` entiende. */
export function isoDay(utcMs: number, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utcMs));
}

/** Las 00:00 de un día en la zona del circuito, como instante UTC. */
export function zoneMidnight(day: string, zone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return null;
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guess));
  const part = (type: string): number => Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  const shown = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return guess - (shown - guess);
}

type ManualKind = "sustituir" | "retirar" | "instalar" | "detras" | "cerrar";

const MANUAL_LABEL: Readonly<Record<ManualKind, string>> = {
  sustituir: "Sustituir tag…",
  retirar: "Retirar tag…",
  instalar: "Instalar tag…",
  detras: "Añadir ubicación detrás…",
  cerrar: "Cerrar ubicación…",
};

export function createPlanPanel(input: PlanPanelInput): PlanPanel {
  const root = node("section", "panel plan-panel");
  root.setAttribute("aria-labelledby", "plan-heading");
  let context: PlanContext = { circuitId: null, plan: null, working: null };
  let status: { readonly kind: "info" | "error"; readonly lines: readonly string[] } | null = null;
  let busy = false;
  /** Cada botón que envía, con lo que le falta para poder enviar (la razón, un código…). */
  const senders: { readonly control: HTMLButtonElement; readonly ready: () => boolean }[] = [];

  const heading = node("h2", undefined, "Plano del circuito");
  heading.id = "plan-heading";
  const statusBox = node("div", "plan-status");
  statusBox.setAttribute("role", "status");
  statusBox.setAttribute("aria-live", "polite");
  const body = node("div", "plan-body");
  root.append(heading, statusBox, body);

  function paintStatus(): void {
    statusBox.replaceChildren();
    statusBox.className = status === null ? "plan-status" : `plan-status ${status.kind}`;
    if (status === null) return;
    for (const line of status.lines) statusBox.append(node("p", undefined, line));
  }

  function applyBusy(): void {
    for (const { control, ready } of senders) control.disabled = busy || !ready();
  }

  function sender(text: string, ready: () => boolean, className?: string): HTMLButtonElement {
    const out = button(text, className);
    senders.push({ control: out, ready });
    out.disabled = busy || !ready();
    return out;
  }

  function sendAction(action: PlanAction): void {
    status = null;
    paintStatus();
    input.send(action);
  }

  let fieldCount = 0;
  /** Un campo de texto con su etiqueta; cada cambio vuelve a mirar qué botones pueden enviar. */
  function textField(labelText: string, className: string, placeholder: string): { readonly box: HTMLElement; readonly field: HTMLInputElement } {
    fieldCount += 1;
    const id = `plan-field-${fieldCount}`;
    const label = node("label", undefined, labelText);
    label.htmlFor = id;
    const field = node("input", `plan-input ${className}`);
    field.type = "text";
    field.id = id;
    field.placeholder = placeholder;
    field.addEventListener("input", applyBusy);
    const box = node("div", "plan-field");
    box.append(label, field);
    return { box, field };
  }

  function reasonField(placeholder: string): { readonly box: HTMLElement; readonly field: HTMLInputElement } {
    return textField("Razón (obligatoria)", "plan-reason", placeholder);
  }

  /** La fecha efectiva: hoy por defecto. Hoy vale desde ahora; otro día, desde sus 00:00 en la zona del circuito. */
  function dateField(): { readonly box: HTMLElement; readonly value: () => number | null } {
    fieldCount += 1;
    const id = `plan-field-${fieldCount}`;
    const label = node("label", undefined, "Desde (fecha efectiva)");
    label.htmlFor = id;
    const field = node("input", "plan-input plan-date");
    field.type = "date";
    field.id = id;
    const today = isoDay(Date.now(), input.zone);
    field.value = today;
    field.addEventListener("input", applyBusy);
    const box = node("div", "plan-field");
    box.append(label, field);
    return { box, value: () => (field.value === today ? Date.now() : zoneMidnight(field.value, input.zone)) };
  }

  /**
   * Un formulario que se abre en su sitio: campos, «Enviar» (apagado hasta que `ready`) y «Cancelar».
   * El botón que lo abre se esconde mientras está abierto.
   */
  function inlineForm(
    holder: HTMLElement,
    opener: HTMLElement,
    title: string,
    fields: readonly HTMLElement[],
    sendText: string,
    ready: () => boolean,
    onSend: () => void,
  ): HTMLElement {
    // Si otro botón del mismo sitio tenía su formulario abierto, se cierra y ese botón vuelve a verse.
    holder.querySelector(".plan-form")?.remove();
    for (const other of holder.querySelectorAll<HTMLElement>("[data-form-opener]")) {
      other.hidden = false;
      delete other.dataset["formOpener"];
    }
    opener.hidden = true;
    opener.dataset["formOpener"] = "si";
    const form = node("div", "plan-form");
    form.setAttribute("role", "group");
    form.setAttribute("aria-label", title);
    form.append(node("p", "plan-form-title", title), ...fields);
    const send = sender(sendText, ready, "plan-send");
    send.addEventListener("click", () => {
      if (!ready()) return;
      onSend();
    });
    const cancel = button("Cancelar");
    cancel.addEventListener("click", () => {
      form.remove();
      opener.hidden = false;
      delete opener.dataset["formOpener"];
      opener.focus();
    });
    const row = node("div", "button-row");
    row.append(send, cancel);
    form.append(row);
    holder.append(form);
    form.querySelector<HTMLInputElement>("input, select")?.focus();
    return form;
  }

  // --- Sin plano ------------------------------------------------------------------------------------

  function noPlanBlock(plan: PlanViews | null): readonly HTMLElement[] {
    if (context.circuitId === null) return [node("p", "muted", "Sin circuito no hay plano: escribe el nombre del circuito e importa sus lecturas.")];
    const out: HTMLElement[] = [
      node(
        "p",
        "muted",
        "El plano fija las ubicaciones del circuito. Cada ubicación guarda su historia aunque cambie el tag que tiene puesto: sustituir un tag no la borra.",
      ),
    ];
    const bootstrap = plan?.canBootstrap ?? null;
    if (bootstrap === null) {
      out.push(node("p", "plan-none", "Consolida un periodo para crear el plano."));
      return out;
    }
    const holder = node("div", "plan-bootstrap");
    holder.append(node("p", undefined, `Se crea desde la versión v${bootstrap.version}, de ${bootstrap.fileName}: una ubicación por cada tag de su anillo, en orden.`));
    const open = button(`Crear el plano desde v${bootstrap.version}`, "plan-bootstrap-open");
    open.addEventListener("click", () => {
      const reason = reasonField("Por qué esta versión es la base del plano");
      inlineForm(holder, open, `Crear el plano desde v${bootstrap.version}`, [reason.box], `Crear el plano desde v${bootstrap.version}`, () => reason.field.value.trim() !== "", () =>
        sendAction({ kind: "crear-plano", fromVersion: bootstrap.version, reason: reason.field.value.trim() }),
      );
    });
    holder.append(open);
    out.push(holder);
    return out;
  }

  // --- Con plano: cifras ---------------------------------------------------------------------------

  function figuresBlock(plan: PlanViews): HTMLElement {
    const current = plan.current;
    const exits = current?.locations.filter((location) => location.kind === "salida").length ?? 0;
    const unread = plan.observation?.locations.filter((location) => location.state === "no-observado").length ?? null;
    const items: (readonly [string, string, boolean])[] = [
      [String(current?.ring.length ?? 0), (current?.ring.length ?? 0) === 1 ? "ubicación en el anillo" : "ubicaciones en el anillo", (current?.ring.length ?? 0) === 0],
      [String(exits), exits === 1 ? "salida" : "salidas", exits === 0],
      unread === null ? ["—", "sin leer en su sitio (sin fichero de trabajo)", true] : [String(unread), "sin leer en su sitio", unread === 0],
      [String(plan.proposals.length), plan.proposals.length === 1 ? "cambio propuesto" : "cambios propuestos", plan.proposals.length === 0],
    ];
    const list = node("ul", "evo-figures plan-figures");
    list.setAttribute("aria-label", "Cifras del plano");
    for (const [value, label, zero] of items) {
      const item = node("li", zero ? "evo-figure zero" : "evo-figure");
      item.append(node("span", "evo-n", value), " ", node("span", undefined, label));
      list.append(item);
    }
    return list;
  }

  // --- Ubicaciones del anillo ----------------------------------------------------------------------

  const tagText = (location: PlanLocation): string =>
    location.tagId !== null ? location.tagId : location.virtualTag === null ? "sin tag físico" : `sin tag físico (código virtual ${location.virtualTag})`;

  /** La ubicación, con su tag para reconocerla: «U-0002 (0200)». */
  function locationName(locationId: string): string {
    const location = context.plan?.current?.locations.find((entry) => entry.locationId === locationId);
    if (location === undefined) return locationId;
    return `${locationId} (${location.tagId ?? "sin tag"})`;
  }

  function observationText(observation: LocationObservation | undefined): { readonly text: string; readonly truth: string | null } {
    if (observation === undefined) return { text: context.working === null ? "sin fichero de trabajo" : "sin dato en el fichero de trabajo", truth: null };
    const uncertain = observation.uncertain !== null && observation.uncertain > 0 ? `; ${plural(observation.uncertain, "pasada incierta", "pasadas inciertas")}` : "";
    switch (observation.state) {
      case "observado":
        return { text: `leído en ${observation.successes} de ${plural(observation.evaluable, "pasada", "pasadas")}${uncertain}`, truth: truthLabel(observation.truth) };
      case "no-observado":
        return { text: `sin leer: ${plural(observation.evaluable, "pasada", "pasadas")} por su sitio${uncertain}`, truth: truthLabel(observation.truth) };
      case "sin-ocasion":
        return { text: "sin ocasión: nada prueba que se pasara por su sitio", truth: null };
      case "sin-tag":
        return { text: "sin tag: no hay nada que leer", truth: null };
      case "revision-manual":
        return { text: "se revisa a mano", truth: truthLabel(observation.truth) };
    }
  }

  function totalText(summary: LocationSummary | undefined): string | null {
    if (summary === undefined || summary.periods.length === 0) return null;
    const total = summary.total;
    const periods = plural(summary.periods.length, "periodo", "periodos");
    if (total.evaluable === 0) return `En ${periods}: ninguna pasada evaluable.`;
    const uncertain = total.uncertain === null ? "; inciertas sin contar" : total.uncertain > 0 ? `; ${plural(total.uncertain, "incierta", "inciertas")}` : "";
    return `En ${periods}: leído en ${total.successes.toLocaleString("es-ES")} de ${plural(total.evaluable, "pasada", "pasadas")}${uncertain}.`;
  }

  /** «AGV-07: 2 de 20 pasadas»: la tasa por AGV nunca va sin su número de pasadas (R-MEM-004). */
  function vehicleText(cell: VehicleCounts): string {
    return `${cell.agvId}: ${cell.successes.toLocaleString("es-ES")} de ${plural(cell.evaluable, "pasada", "pasadas")}`;
  }

  function vehicleList(cells: readonly VehicleCounts[], label: string): HTMLElement {
    const list = node("ul", "plan-vehicle-list");
    list.setAttribute("aria-label", label);
    for (const cell of cells) list.append(node("li", "mono", vehicleText(cell)));
    return list;
  }

  /** La línea plegable «Por AGV» de una ubicación: los que leen menos que la flota primero, el resto plegado. */
  function vehiclesBlock(summary: LocationSummary | undefined): HTMLElement | null {
    const breakdown: VehicleBreakdown | undefined = summary?.byVehicle;
    if (summary === undefined || breakdown === undefined) return null;
    const box = node("details", "plan-vehicles");
    const supported = breakdown.lower.length + breakdown.others.length;
    const head =
      supported === 0
        ? "ningún AGV con muestra suficiente"
        : breakdown.lower.length === 0
          ? `ninguno de ${plural(supported, "AGV", "AGV")} por debajo de la flota`
          : `${breakdown.lower.length.toLocaleString("es-ES")} de ${plural(supported, "AGV", "AGV")} por debajo de la flota`;
    box.append(node("summary", undefined, `Por AGV: ${head}`));
    const coverage =
      breakdown.periods < summary.periods.length ? ` en ${breakdown.periods.toLocaleString("es-ES")} de ${plural(summary.periods.length, "periodo", "periodos")} (los otros no traen desglose)` : "";
    box.append(
      node(
        "p",
        "muted plan-vehicles-fleet",
        `Toda la flota${coverage}: leído en ${breakdown.fleet.successes.toLocaleString("es-ES")} de ${plural(breakdown.fleet.evaluable, "pasada probada", "pasadas probadas")} por su sitio.`,
      ),
    );
    if (breakdown.lower.length > 0) box.append(vehicleList(breakdown.lower, "AGV por debajo de la flota"));
    if (breakdown.others.length > 0) {
      const rest = node("details", "plan-vehicles-rest");
      rest.append(node("summary", undefined, `${plural(breakdown.others.length, "AGV", "AGV")} a la par o por encima de la flota`));
      rest.append(vehicleList(breakdown.others, "AGV a la par o por encima de la flota"));
      box.append(rest);
    }
    if (breakdown.vehiclesBelowSample > 0) {
      box.append(
        node(
          "p",
          "muted plan-vehicles-below",
          `${plural(breakdown.vehiclesBelowSample, "AGV", "AGV")} sin muestra suficiente (menos de ${plural(breakdown.minPasses, "pasada", "pasadas")} por su sitio): sin tasa.`,
        ),
      );
    }
    return box;
  }

  function historyText(location: PlanLocation): string | null {
    const history = location.history;
    if (history.length === 0 || (history.length === 1 && history[0]?.to === null)) return null;
    const parts = history.map((entry, index) => {
      const previous = history[index - 1];
      const since = previous !== undefined && previous.to === entry.from ? "desde entonces" : `desde ${input.formatDay(entry.from)}`;
      return entry.to === null ? `${entry.tagId} ${since}` : index === 0 ? `${entry.tagId} hasta ${input.formatDay(entry.to)}` : `${entry.tagId} ${since} hasta ${input.formatDay(entry.to)}`;
    });
    return `Historia: ${parts.join(", ")}.`;
  }

  /** El menú compacto de cambios a mano de una ubicación. */
  function manualMenu(location: PlanLocation, holder: HTMLElement): HTMLElement {
    const menu = node("details", "plan-menu");
    const summary = node("summary", undefined, "Cambiar…");
    summary.setAttribute("aria-label", `Cambiar la ubicación ${location.locationId}`);
    menu.append(summary);
    const kinds: ManualKind[] =
      location.tagId === null ? ["instalar"] : ["sustituir", "retirar"];
    if (location.kind === "anillo") kinds.push("detras");
    kinds.push("cerrar");
    const row = node("div", "plan-menu-items");
    for (const kind of kinds) {
      const item = button(MANUAL_LABEL[kind], "plan-menu-item");
      item.dataset["action"] = kind;
      item.addEventListener("click", () => {
        menu.open = false;
        openManual(kind, location, holder, summary);
      });
      row.append(item);
    }
    menu.append(row);
    return menu;
  }

  function openManual(kind: ManualKind, location: PlanLocation, holder: HTMLElement, opener: HTMLElement): void {
    const date = dateField();
    const reason = reasonField("Qué se hizo en planta y por qué");
    const fields: HTMLElement[] = [];
    let code: HTMLInputElement | null = null;
    let title: string;
    if (kind === "sustituir" || kind === "instalar") {
      const field = textField(kind === "sustituir" ? `Código del tag nuevo (sustituye a ${location.tagId ?? "—"})` : "Código del tag que se instala", "plan-code", "0301");
      code = field.field;
      fields.push(field.box);
      title = kind === "sustituir" ? `Sustituir el tag de ${location.locationId}` : `Instalar un tag en ${location.locationId}`;
    } else if (kind === "detras") {
      const field = textField("Código virtual (opcional): el que el circuito virtual declara para ese sitio", "plan-code", "");
      code = field.field;
      fields.push(field.box);
      title = `Añadir una ubicación detrás de ${location.locationId}`;
      fields.push(node("p", "muted", "Nace sin tag físico. Si ya hay uno puesto, instálalo después."));
    } else if (kind === "retirar") {
      title = `Retirar el tag ${location.tagId ?? ""} de ${location.locationId}`;
      fields.push(node("p", "muted", "La ubicación sigue en el plano, sin tag físico."));
    } else {
      title = `Cerrar la ubicación ${location.locationId}`;
      fields.push(node("p", "muted", location.kind === "anillo" ? "Deja de existir desde esa fecha; sus vecinas quedan conectadas. Su historia no se borra." : "Deja de existir desde esa fecha. Su historia no se borra."));
    }
    fields.push(date.box, reason.box);
    const codeField = code;
    const needsCode = kind === "sustituir" || kind === "instalar";
    const ready = (): boolean => reason.field.value.trim() !== "" && date.value() !== null && (!needsCode || (codeField?.value.trim() ?? "") !== "");
    inlineForm(holder, opener, title, fields, MANUAL_LABEL[kind].replace("…", ""), ready, () => {
      const effectiveAt = date.value();
      if (effectiveAt === null) return;
      const typed = codeField?.value.trim() ?? "";
      const base = { effectiveAt, evidence: null };
      let event: PlanEventInput;
      if (kind === "sustituir") event = { ...base, type: "sustituir", locationId: location.locationId, tagId: typed };
      else if (kind === "instalar") event = { ...base, type: "instalar", locationId: location.locationId, tagId: typed };
      else if (kind === "retirar") event = { ...base, type: "retirar", locationId: location.locationId };
      else if (kind === "cerrar") event = { ...base, type: "cerrar-ubicacion", locationId: location.locationId };
      else
        event = {
          ...base,
          type: "crear-ubicacion",
          locationId: nextLocationId(context.plan?.events ?? []),
          kind: "anillo",
          after: location.locationId,
          branchFrom: null,
          virtualTag: typed === "" ? null : typed,
        };
      sendAction({ kind: "evento", event, reason: reason.field.value.trim() });
    });
  }

  function ringBlock(plan: PlanViews): readonly HTMLElement[] {
    const current = plan.current;
    if (current === null) return [];
    const out: HTMLElement[] = [node("h3", undefined, "Ubicaciones del anillo")];
    out.push(
      node(
        "p",
        "muted",
        context.working === null
          ? "En orden de paso; la última conecta con la primera."
          : `En orden de paso; la última conecta con la primera. El estado es el de ${plan.observation?.fileName ?? context.working.fileName}.`,
      ),
    );
    const list = node("ol", "plan-locations");
    list.setAttribute("aria-label", "Ubicaciones del anillo");
    const byId = new Map(current.locations.map((location) => [location.locationId, location]));
    for (const locationId of current.ring) {
      const location = byId.get(locationId);
      if (location === undefined) continue;
      list.append(locationItem(location, plan));
    }
    out.push(list);
    return out;
  }

  function locationItem(location: PlanLocation, plan: PlanViews): HTMLElement {
    const item = node("li", "plan-location");
    item.dataset["location"] = location.locationId;
    const observation = plan.observation?.locations.find((entry) => entry.locationId === location.locationId);
    if (observation !== undefined) item.dataset["state"] = observation.state;
    const head = node("div", "plan-location-head");
    head.append(node("span", "mono plan-id", location.locationId), " ", node("span", location.tagId === null ? "plan-tag muted" : "mono plan-tag", tagText(location)));
    const seen = observationText(observation);
    const stateLine = node("span", "plan-state", seen.text);
    head.append(" ", stateLine);
    if (seen.truth !== null && observation?.state === "no-observado") head.append(" ", node("span", "chip plan-truth", seen.truth));
    item.append(head);
    const summary = plan.summary?.locations.find((entry) => entry.locationId === location.locationId);
    const total = totalText(summary);
    if (total !== null) item.append(node("p", "muted plan-total", total));
    const vehicles = vehiclesBlock(summary);
    if (vehicles !== null) item.append(vehicles);
    const history = historyText(location);
    if (history !== null) item.append(node("p", "muted plan-history", history));
    const holder = node("div", "plan-location-actions");
    holder.append(manualMenu(location, holder));
    item.append(holder);
    return item;
  }

  // --- Salidas -------------------------------------------------------------------------------------

  function exitsBlock(plan: PlanViews): readonly HTMLElement[] {
    const current = plan.current;
    if (current === null) return [];
    const exits = current.locations.filter((location) => location.kind === "salida");
    const out: HTMLElement[] = [node("h3", undefined, "Salidas por revisar a mano")];
    out.push(
      node(
        "p",
        "muted",
        "Paradas por salida hacia otros circuitos: casi nunca se recorren, así que las lecturas no dicen nada de ellas. Su estado es la última revisión en planta.",
      ),
    );
    if (exits.length === 0) {
      out.push(node("p", "muted", "Ninguna salida en el plano."));
      return out;
    }
    const list = node("ul", "plan-exits");
    list.setAttribute("aria-label", "Salidas por revisar a mano");
    for (const exit of exits) {
      const item = node("li", "plan-exit");
      item.dataset["location"] = exit.locationId;
      const head = node("div", "plan-location-head");
      head.append(node("span", "mono plan-id", exit.locationId), " ", node("span", exit.tagId === null ? "plan-tag muted" : "mono plan-tag", tagText(exit)));
      head.append(" ", node("span", "muted", exit.branchFrom === null ? "sin ubicación de la que cuelgue" : `cuelga de ${locationName(exit.branchFrom)}`));
      item.append(head);
      const review = exit.lastReview;
      item.append(
        node(
          "p",
          review === null ? "plan-review none" : `plan-review ${review.result}`,
          review === null
            ? "Sin revisar todavía."
            : `Revisada el ${input.formatInstant(review.at)}: ${MANUAL_RESULT_LABEL[review.result]}${review.note === "" ? "" : ` — ${review.note}`}.`,
        ),
      );
      const history = historyText(exit);
      if (history !== null) item.append(node("p", "muted plan-history", history));
      const holder = node("div", "plan-location-actions");
      const open = button("Registrar revisión…", "plan-review-open");
      open.setAttribute("aria-label", `Registrar una revisión de ${exit.locationId}`);
      open.addEventListener("click", () => openReview(exit, holder, open));
      holder.append(open, manualMenu(exit, holder));
      item.append(holder);
      list.append(item);
    }
    out.push(list);
    return out;
  }

  function openReview(exit: PlanLocation, holder: HTMLElement, opener: HTMLElement): void {
    fieldCount += 1;
    const id = `plan-field-${fieldCount}`;
    const resultBox = node("div", "plan-field");
    const resultLabel = node("label", undefined, "Qué se encontró");
    resultLabel.htmlFor = id;
    const result = node("select", "plan-input plan-result");
    result.id = id;
    for (const value of ["correcto", "averiado", "no-encontrado"] as const) {
      const option = node("option", undefined, MANUAL_RESULT_LABEL[value]);
      option.value = value;
      result.append(option);
    }
    resultBox.append(resultLabel, result);
    const note = textField("Nota (opcional)", "plan-note", "Qué se vio");
    const reason = reasonField("Por qué se revisó");
    inlineForm(holder, opener, `Revisión de ${exit.locationId}`, [resultBox, note.box, reason.box], "Registrar la revisión", () => reason.field.value.trim() !== "", () =>
      sendAction({
        kind: "evento",
        event: {
          type: "revision-manual",
          locationId: exit.locationId,
          result: result.value as ManualResult,
          note: note.field.value.trim(),
          effectiveAt: Date.now(),
          evidence: null,
        },
        reason: reason.field.value.trim(),
      }),
    );
  }

  // --- Propuestas ----------------------------------------------------------------------------------

  function proposalsBlock(plan: PlanViews): readonly HTMLElement[] {
    if (plan.current === null) return [];
    const out: HTMLElement[] = [node("h3", undefined, "Cambios propuestos")];
    if (plan.proposals.length === 0) {
      out.push(node("p", "muted", context.working === null ? "Sin fichero de trabajo no hay nada que proponer." : "Ninguno: el fichero de trabajo encaja con el plano."));
      return out;
    }
    out.push(node("p", "muted", "Lo que el fichero de trabajo sugiere. No se ha escrito nada: el plano solo cambia si confirmas."));
    const list = node("div", "plan-proposals");
    for (const proposal of plan.proposals) list.append(proposalCard(proposal, plan));
    out.push(list);
    return out;
  }

  function proposalCard(proposal: PlanProposal, plan: PlanViews): HTMLElement {
    const card = node("div", "plan-proposal");
    card.dataset["kind"] = proposal.kind;
    card.dataset["proposal"] = proposal.id;
    card.append(node("h4", undefined, proposal.title));
    card.append(node("p", undefined, proposal.detail));
    const evidence = proposal.evidence;
    // La evidencia dice de qué fichero sale; su detalle solo se repite si añade algo al de la propuesta.
    const evidenceDetail = evidence.detail === proposal.detail ? "" : `: ${evidence.detail}`;
    card.append(node("p", "muted plan-evidence", `Evidencia: ${evidence.fileName ?? "sin fichero"}${evidenceDetail}`));
    card.append(node("p", "plan-unwritten", "Propuesta: todavía no se ha escrito nada."));
    const holder = node("div", "plan-proposal-actions");
    const sourceId = evidence.sourceId;
    if (sourceId === null) {
      holder.append(node("p", "muted", "Sin fichero que la sostenga no se puede confirmar."));
      card.append(holder);
      return card;
    }
    const open = button("Confirmar…", "plan-proposal-open");
    open.setAttribute("aria-label", `Confirmar: ${proposal.title}`);
    open.addEventListener("click", () => {
      const fields: HTMLElement[] = [];
      let branch: HTMLSelectElement | null = null;
      if (proposal.kind === "salida-sin-ubicar") {
        fieldCount += 1;
        const id = `plan-field-${fieldCount}`;
        const label = node("label", undefined, "Cuelga de la ubicación del anillo");
        label.htmlFor = id;
        const select = node("select", "plan-input plan-branch");
        select.id = id;
        const empty = node("option", undefined, "Elige una ubicación");
        empty.value = "";
        select.append(empty);
        for (const locationId of plan.current?.ring ?? []) {
          const option = node("option", undefined, locationName(locationId));
          option.value = locationId;
          select.append(option);
        }
        select.addEventListener("change", applyBusy);
        const box = node("div", "plan-field");
        box.append(label, select);
        fields.push(box);
        branch = select;
      }
      const reason = reasonField("Por qué es correcto este cambio");
      fields.push(reason.box);
      const chosen = branch;
      inlineForm(
        holder,
        open,
        `Confirmar: ${proposal.title}`,
        fields,
        "Confirmar y escribir en el plano",
        () => reason.field.value.trim() !== "" && (chosen === null || chosen.value !== ""),
        () =>
          sendAction({
            kind: "aceptar-propuesta",
            proposalId: proposal.id,
            sourceId,
            reason: reason.field.value.trim(),
            ...(chosen === null ? {} : { branchFrom: chosen.value }),
          }),
      );
    });
    holder.append(open);
    card.append(holder);
    return card;
  }

  // --- Tramos --------------------------------------------------------------------------------------

  function edgesBlock(plan: PlanViews): readonly HTMLElement[] {
    if (plan.current === null) return [];
    const out: HTMLElement[] = [node("h3", undefined, "Tramos entre ubicaciones")];
    const edges = plan.summary?.edges ?? [];
    if (edges.length === 0) {
      out.push(node("p", "muted", "Sin tramos medidos todavía: hacen falta instantáneas de ficheros leídas con el plano."));
      return out;
    }
    out.push(
      node(
        "p",
        "muted",
        "Todos los periodos sumados. «Ruta» es un paso que salta ubicaciones sin leer: no es una conexión del plano. Con menos de dos pasadas no hay desviación.",
      ),
    );
    const cells = (moments: Moments | null): readonly string[] =>
      moments === null || moments.n === 0 ? ["0", "—", "—"] : [moments.n.toLocaleString("es-ES"), clock(moments.meanMs), spread(moments)];
    const rows = edges.map((edge: EdgeSummary) => [
      locationName(edge.fromLocation),
      locationName(edge.toLocation),
      edge.composite ? "ruta" : "conexión",
      ...cells(edge.produccion),
      ...cells(edge.noche),
      String(edge.periods),
    ]);
    const table = plainTable(
      ["De", "A", "Tipo", "Producción: pasadas", "Producción: media", "Producción: desv. típica", "Noche: pasadas", "Noche: media", "Noche: desv. típica", "Periodos"],
      rows,
    );
    table.classList.add("plan-edges");
    out.push(scrollBox(table));
    return out;
  }

  // --- Historial -----------------------------------------------------------------------------------

  function historyBlock(plan: PlanViews): readonly HTMLElement[] {
    if (plan.events.length === 0) return [];
    const out: HTMLElement[] = [node("h3", undefined, "Historial del plano")];
    out.push(node("p", "muted", "Nada se borra: cada cambio queda con su fecha efectiva y su razón."));
    const list = node("ul", "plan-events");
    list.setAttribute("aria-label", "Historial del plano");
    for (const event of [...plan.events].reverse()) {
      const item = node("li", "plan-event");
      item.dataset["seq"] = String(event.seq);
      const head = node("div");
      head.append(node("span", "plan-event-when", `Desde ${input.formatInstant(event.effectiveAt)}`), " ", node("span", undefined, event.text));
      if (event.origin === "propuesta") head.append(" ", node("span", "chip", "propuesta confirmada"));
      item.append(head);
      item.append(node("p", "muted", `Razón: ${event.reason} · registrado el ${input.formatInstant(event.recordedAt)}`));
      list.append(item);
    }
    out.push(list);
    return out;
  }

  // --- Montaje -------------------------------------------------------------------------------------

  function render(): void {
    senders.length = 0;
    const plan = context.plan;
    if (plan === null || plan.current === null) {
      body.replaceChildren(...noPlanBlock(plan), ...(plan === null ? [] : historyBlock(plan)));
    } else {
      body.replaceChildren(
        figuresBlock(plan),
        ...ringBlock(plan),
        ...exitsBlock(plan),
        ...proposalsBlock(plan),
        ...edgesBlock(plan),
        ...historyBlock(plan),
      );
    }
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
    memoryChanged(memory) {
      const plan = context.plan;
      if (context.circuitId === null || (plan !== null && plan.current !== null)) return;
      const current = memory.current === null ? undefined : memory.versions.find((entry) => entry.version === memory.current);
      const canBootstrap = current === undefined ? null : { version: current.version, fileName: current.basedOnFileName };
      context = {
        ...context,
        plan: plan === null ? { current: null, canBootstrap, events: [], observation: null, summary: null, proposals: [] } : { ...plan, canBootstrap },
      };
      render();
    },
    showUpdated(written, plan) {
      context = { ...context, plan };
      status = { kind: "info", lines: ["Plano actualizado.", ...written] };
      render();
    },
    showError(cause, recovery) {
      status = { kind: "error", lines: [`No se pudo cambiar el plano: ${cause}`, recovery] };
      paintStatus();
      applyBusy();
    },
    notice(line) {
      status = { kind: "info", lines: [line] };
      paintStatus();
    },
    setBusy(next) {
      busy = next;
      applyBusy();
    },
  };
}
