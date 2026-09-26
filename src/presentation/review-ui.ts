/**
 * La revisión en campo, en la interfaz (UX_SPEC §4.3).
 *
 * Pensada para usarse de pie delante del punto conflictivo, con el móvil en una mano: un solo control
 * en cada tarjeta que dice el estado y abre un menú con los cuatro y la nota, una marca que se guarda
 * sola al elegir, y arriba, siempre a la vista, cuánto queda y un botón que lleva al siguiente
 * pendiente. Nada de esto toca el análisis (R-EVI-007).
 */

import {
  REVIEW_LABEL,
  REVIEW_STATES,
  changedSinceReview,
  reviewCsv,
  reviewKey,
  summarizeReview,
  type ReviewEntry,
  type ReviewState,
} from "../domain/review.js";
import { loadReviews, saveReview } from "../persistence/store.js";

interface CardControl {
  readonly key: string;
  readonly card: HTMLElement;
  readonly title: string;
  readonly figure: string;
  /** El botón que enseña el estado y abre el menú. */
  readonly toggle: HTMLButtonElement;
  readonly popup: HTMLElement;
  readonly items: ReadonlyMap<ReviewState, HTMLButtonElement>;
  readonly note: HTMLInputElement;
  readonly changed: HTMLElement;
}

export interface ReviewSession {
  /** Añade el control de revisión a una tarjeta de hallazgo. `parts` es su tipo y su sujeto. */
  attach(card: HTMLElement, parts: readonly string[], title: string, figure: string): void;
  /**
   * La barra que se queda fija arriba al desplazarse: cuánto va revisado y el botón al siguiente
   * pendiente. Compacta a propósito: en el móvil, todo lo demás fijo taparía media pantalla.
   */
  readonly bar: HTMLElement;
  /** Recuento por estado, filtros y exportación. Va en el Resumen, junto a la bandeja, sin fijarse. */
  readonly panel: HTMLElement;
  /** Actualiza el progreso; se llama cuando ya están todas las tarjetas. */
  refresh(): void;
  /** El filtro de estado activo («» es todos). La bandeja lo combina con el suyo por tema. */
  filter(): string;
  /** Se avisa cada vez que cambia el filtro de estado o una marca, para que la bandeja se rehaga. */
  onChange(listener: () => void): void;
}

/** Lo último que se leyó del almacén, para no esperar a IndexedDB al volver a dibujar el mismo circuito. */
let cache: { circuitId: string; entries: Map<string, ReviewEntry> } | null = null;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const PLURAL: Readonly<Record<ReviewState, string>> = {
  pendiente: "pendientes",
  confirmado: "confirmados",
  descartado: "descartados",
  pospuesto: "pospuestos",
};

const counted = (count: number, state: ReviewState): string =>
  `${REVIEW_LABEL[state].icon} ${count} ${count === 1 ? REVIEW_LABEL[state].text.toLowerCase() : PLURAL[state]}`;

/** El menú abierto en toda la página, como mucho uno: abrir otro cierra el anterior. */
let openControl: CardControl | null = null;

function closeMenu(control: CardControl, focusToggle: boolean): void {
  control.popup.hidden = true;
  control.toggle.setAttribute("aria-expanded", "false");
  if (openControl === control) openControl = null;
  if (focusToggle) control.toggle.focus();
}

document.addEventListener("pointerdown", (event) => {
  // Tocar fuera del menú lo cierra; dentro (el propio botón, un estado o la nota) no.
  const control = openControl;
  if (control === null) return;
  const target = event.target;
  if (target instanceof Node && (control.popup.contains(target) || control.toggle.contains(target))) return;
  closeMenu(control, false);
});

export function createReviewSession(
  circuitId: string,
  container: HTMLElement,
  formatInstant: (utcMs: number) => string,
  onError: (reason: string) => void,
  /** Deja una tarjeta a la vista antes de saltar a ella: la bandeja vive en una pestaña. */
  reveal: (card: HTMLElement) => void = () => {},
): ReviewSession {
  const entries: Map<string, ReviewEntry> =
    cache?.circuitId === circuitId ? cache.entries : new Map<string, ReviewEntry>();
  cache = { circuitId, entries };
  const controls = new Map<string, CardControl>();
  const listeners: (() => void)[] = [];
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  container.dataset["reviewFilter"] = "";

  // --- Barra fija y panel ----------------------------------------------------------------------
  const bar = node("div", "review-bar");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Progreso de la revisión en campo");
  const panel = node("div", "review-panel");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Revisión en campo");
  const heading = node("p", "review-heading");
  heading.setAttribute("role", "status");
  heading.setAttribute("aria-live", "polite");
  const progress = node("div", "review-progress");
  progress.setAttribute("aria-hidden", "true");
  const counts = node("p", "review-counts");
  const absent = node("p", "muted");
  absent.hidden = true;

  const filters = node("div", "seg");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Enseñar solo");
  const filterButtons = new Map<string, HTMLButtonElement>();
  for (const [value, label] of [
    ["", "Todos"],
    ...REVIEW_STATES.map((state) => [state, `${REVIEW_LABEL[state].icon} ${PLURAL[state]}`] as const),
  ] as const) {
    const button = node("button", undefined, label);
    button.type = "button";
    button.setAttribute("aria-pressed", String(value === ""));
    button.addEventListener("click", () => {
      container.dataset["reviewFilter"] = value;
      for (const [other, otherButton] of filterButtons) otherButton.setAttribute("aria-pressed", String(other === value));
      notify();
    });
    filterButtons.set(value, button);
    filters.append(button);
  }

  const next = node("button", undefined, "Siguiente pendiente");
  next.type = "button";
  next.addEventListener("click", () => {
    const pending = [...controls.values()].filter((control) => stateOf(control.key) === "pendiente" && !control.card.hidden);
    if (pending.length === 0) return;
    // El primero que queda por debajo de lo que se está viendo; si no hay, se vuelve al principio.
    const target = pending.find((control) => control.card.getBoundingClientRect().top > 120) ?? pending[0];
    if (target === undefined) return;
    reveal(target.card);
    target.card.scrollIntoView({ block: "center", behavior: "smooth" });
    target.toggle.focus({ preventScroll: true });
  });

  const exportButton = node("button", undefined, "Exportar revisión (CSV)");
  exportButton.type = "button";
  exportButton.addEventListener("click", () => {
    const visible = [...controls.values()].map(({ key, title, figure }) => ({ key, title, figure }));
    // Con BOM y `;`: es lo que una hoja de cálculo en español abre sin preguntar ni romper tildes.
    const csv = `﻿${reviewCsv(visible, entries, formatInstant)}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = node("a");
    link.href = url;
    link.download = `revision-${circuitId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  });

  const barRow = node("div", "review-bar-row");
  barRow.append(heading, next);
  bar.append(barRow, progress);
  // La barra es fija arriba y tapa lo que queda debajo. Su altura se escribe en una variable CSS
  // para que encabezados, figuras y tarjetas dejen ese margen al ser destino de un salto
  // (`scroll-margin-top` en styles.css); se mide, porque cambia con el dedo (44 px) y con el ancho.
  const measure = (): void => {
    document.documentElement.style.setProperty("--review-bar-height", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
  };
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(measure).observe(bar);
  const actions = node("div", "review-actions");
  actions.append(exportButton);
  panel.append(counts, filters, actions, absent);

  // --- Tarjetas ----------------------------------------------------------------------------------
  const stateOf = (key: string): ReviewState => entries.get(key)?.state ?? "pendiente";

  function paint(control: CardControl): void {
    const entry = entries.get(control.key);
    const state = entry?.state ?? "pendiente";
    control.card.dataset["review"] = state;
    control.toggle.dataset["state"] = state;
    control.toggle.replaceChildren(
      node("span", "review-icon", REVIEW_LABEL[state].icon),
      " ",
      node("span", "review-text", REVIEW_LABEL[state].text),
      " ",
      node("span", "review-caret", "▾"),
    );
    for (const [value, item] of control.items) item.setAttribute("aria-checked", String(value === state));
    control.note.hidden = state === "pendiente";
    if (document.activeElement !== control.note) control.note.value = entry?.note ?? "";
    const changed = entry !== undefined && changedSinceReview(entry, control.figure);
    control.changed.hidden = !changed;
    control.changed.textContent = changed
      ? `Marcado el ${formatInstant(entry.updatedAt)} con otros datos: «${entry.figure}». Conviene revisarlo de nuevo.`
      : "";
  }

  function commit(control: CardControl, state: ReviewState, note: string): void {
    const entry: ReviewEntry | null =
      state === "pendiente"
        ? null
        : { key: control.key, state, note, updatedAt: Date.now(), title: control.title, figure: control.figure };
    if (entry === null) entries.delete(control.key);
    else entries.set(control.key, entry);
    paint(control);
    refresh();
    notify();
    saveReview(circuitId, control.key, entry).catch(() =>
      onError("La marca se ve en pantalla pero no se ha podido guardar en el dispositivo. No recargues la página hasta volver a intentarlo."),
    );
  }

  function attach(card: HTMLElement, parts: readonly string[], title: string, figure: string): void {
    // Dos tarjetas con el mismo tipo y sujeto en un mismo análisis (dos esperas del mismo AGV en la
    // misma calle, por ejemplo) se distinguen por su orden, que es estable mientras los datos lo sean.
    let key = reviewKey(parts);
    for (let n = 2; controls.has(key); n += 1) key = reviewKey([...parts, `#${n}`]);

    const row = node("div", "review");
    const holder = node("div", "review-menu");
    // Un solo control por tarjeta: enseña el estado (icono y texto, nunca solo color) y abre el menú.
    // Cuatro botones por tarjeta eran 260 en una página real; con uno, la fila cabe a 390 px.
    const toggle = node("button", "review-toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", `Revisión en campo: ${title}`);
    const popup = node("div", "review-popup");
    popup.hidden = true;
    const menu = node("div", "seg review-states");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", `Estado de la revisión: ${title}`);
    const items = new Map<ReviewState, HTMLButtonElement>();
    const note = node("input", "review-note");
    note.type = "text";
    note.placeholder = "Nota (opcional): qué se vio, por qué se pospone…";
    note.setAttribute("aria-label", `Nota de la revisión: ${title}`);
    const changed = node("p", "review-changed");
    changed.hidden = true;
    const control: CardControl = { key, card, title, figure, toggle, popup, items, note, changed };

    const open = (focusItem: boolean): void => {
      if (openControl !== null && openControl !== control) closeMenu(openControl, false);
      popup.hidden = false;
      toggle.setAttribute("aria-expanded", "true");
      openControl = control;
      if (focusItem) items.get(stateOf(key))?.focus();
    };
    toggle.addEventListener("click", () => {
      if (popup.hidden) open(false);
      else closeMenu(control, false);
    });
    toggle.addEventListener("keydown", (event) => {
      // Flecha abajo abre el menú con el foco en el estado actual, como un menú de verdad.
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        open(true);
      }
    });

    for (const state of REVIEW_STATES) {
      const item = node("button");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", "false");
      item.dataset["state"] = state;
      item.append(node("span", "review-icon", REVIEW_LABEL[state].icon), " ", node("span", "review-text", REVIEW_LABEL[state].text));
      // Elegir un estado lo guarda y deja el menú abierto: la nota se escribe justo después, y es lo
      // que se hace de pie. Se cierra con Escape, tocando fuera o con el propio botón.
      item.addEventListener("click", () => commit(control, state, note.value.trim()));
      items.set(state, item);
      menu.append(item);
    }
    popup.addEventListener("keydown", (event) => {
      const order = [...items.values()];
      const index = order.findIndex((item) => item === document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(control, true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        if (index === -1) return;
        event.preventDefault();
        order[(index + 1) % order.length]?.focus();
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        if (index === -1) return;
        event.preventDefault();
        order[(index - 1 + order.length) % order.length]?.focus();
      } else if (event.key === "Home" && index !== -1) {
        event.preventDefault();
        order[0]?.focus();
      } else if (event.key === "End" && index !== -1) {
        event.preventDefault();
        order[order.length - 1]?.focus();
      }
    });
    note.addEventListener("change", () => {
      const state = stateOf(key);
      if (state !== "pendiente") commit(control, state, note.value.trim());
    });

    popup.append(menu, note);
    holder.append(toggle, popup);
    row.append(holder, changed);
    card.append(row);
    card.classList.add("reviewable");
    controls.set(key, control);
    paint(control);
  }

  function refresh(): void {
    const summary = summarizeReview([...controls.keys()], entries);
    const done = summary.total - summary.pendiente;
    heading.textContent =
      summary.total === 0
        ? "Revisión: no hay hallazgos que revisar."
        : `Revisados ${done} de ${summary.total}`;
    counts.textContent = REVIEW_STATES.filter((state) => state !== "pendiente")
      .map((state) => counted(summary[state], state))
      .concat(counted(summary.pendiente, "pendiente"))
      .join(" · ");
    progress.replaceChildren(
      ...REVIEW_STATES.filter((state) => summary[state] > 0).map((state) => {
        const part = node("span");
        part.dataset["state"] = state;
        part.style.flexGrow = String(summary[state]);
        return part;
      }),
    );
    absent.hidden = summary.absent === 0;
    absent.textContent =
      summary.absent === 1
        ? "1 marca es de un hallazgo que este análisis ya no produce. No se borra: va en el CSV."
        : `${summary.absent} marcas son de hallazgos que este análisis ya no produce. No se borran: van en el CSV.`;
    next.disabled = summary.pendiente === 0;
  }

  // La lectura del almacén es asíncrona; las tarjetas se dibujan ya y se pintan en cuanto llega.
  if (cache.entries.size === 0) {
    loadReviews(circuitId)
      .then((loaded) => {
        if (cache?.circuitId !== circuitId) return;
        for (const [key, entry] of loaded) entries.set(key, entry);
        for (const control of controls.values()) paint(control);
        refresh();
        notify();
      })
      .catch(() => onError("No se ha podido leer la revisión guardada de este circuito."));
  }

  return {
    attach,
    bar,
    panel,
    refresh,
    filter: () => container.dataset["reviewFilter"] ?? "",
    onChange: (listener) => {
      listeners.push(listener);
    },
  };
}
