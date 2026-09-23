/**
 * La revisión en campo, en la interfaz (UX_SPEC §4.3).
 *
 * Pensada para usarse de pie delante del punto conflictivo, con el móvil en una mano: cuatro botones
 * grandes en cada tarjeta, una marca que se guarda sola al pulsar, y arriba, siempre a la vista, cuánto
 * queda y un botón que lleva al siguiente pendiente. Nada de esto toca el análisis (R-EVI-007).
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
  readonly buttons: ReadonlyMap<ReviewState, HTMLButtonElement>;
  readonly note: HTMLInputElement;
  readonly changed: HTMLElement;
}

export interface ReviewSession {
  /** Añade los botones de revisión a una tarjeta de hallazgo. `parts` es su tipo y su sujeto. */
  attach(card: HTMLElement, parts: readonly string[], title: string, figure: string): void;
  /**
   * La barra que se queda fija arriba al desplazarse: cuánto va revisado y el botón al siguiente
   * pendiente. Compacta a propósito: en el móvil, todo lo demás fijo taparía media pantalla.
   */
  readonly bar: HTMLElement;
  /** Recuento por estado, filtros y exportación. Va justo debajo de la barra, sin quedarse fijo. */
  readonly panel: HTMLElement;
  /** Actualiza el progreso; se llama cuando ya están todas las tarjetas. */
  refresh(): void;
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

export function createReviewSession(
  circuitId: string,
  container: HTMLElement,
  formatInstant: (utcMs: number) => string,
  onError: (reason: string) => void,
): ReviewSession {
  const entries: Map<string, ReviewEntry> =
    cache?.circuitId === circuitId ? cache.entries : new Map<string, ReviewEntry>();
  cache = { circuitId, entries };
  const controls = new Map<string, CardControl>();
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
    });
    filterButtons.set(value, button);
    filters.append(button);
  }

  const next = node("button", undefined, "Siguiente pendiente");
  next.type = "button";
  next.addEventListener("click", () => {
    const pending = [...controls.values()].filter((control) => stateOf(control.key) === "pendiente");
    if (pending.length === 0) return;
    // El primero que queda por debajo de lo que se está viendo; si no hay, se vuelve al principio.
    const target = pending.find((control) => control.card.getBoundingClientRect().top > 120) ?? pending[0];
    target?.card.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.buttons.get("confirmado")?.focus({ preventScroll: true });
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
  const actions = node("div", "review-actions");
  actions.append(exportButton);
  panel.append(counts, filters, actions, absent);

  // --- Tarjetas ----------------------------------------------------------------------------------
  const stateOf = (key: string): ReviewState => entries.get(key)?.state ?? "pendiente";

  function paint(control: CardControl): void {
    const entry = entries.get(control.key);
    const state = entry?.state ?? "pendiente";
    control.card.dataset["review"] = state;
    for (const [value, button] of control.buttons) button.setAttribute("aria-pressed", String(value === state));
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
    saveReview(circuitId, control.key, entry).catch(() =>
      onError("La marca se ve en pantalla pero no se ha podido guardar en el dispositivo. No recargues la página hasta volver a intentarlo."),
    );
  }

  function attach(card: HTMLElement, parts: readonly string[], title: string, figure: string): void {
    // Dos tarjetas con el mismo tipo y sujeto en un mismo análisis (dos esperas del mismo AGV en la
    // misma calle, por ejemplo) se distinguen por su orden, que es estable mientras los datos lo sean.
    let key = reviewKey(parts);
    for (let n = 2; controls.has(key); n += 1) key = reviewKey([...parts, `#${n}`]);

    const bar = node("div", "review");
    const group = node("div", "seg");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `Revisión en campo: ${title}`);
    const buttons = new Map<ReviewState, HTMLButtonElement>();
    const note = node("input", "review-note");
    note.type = "text";
    note.placeholder = "Nota (opcional): qué se vio, por qué se pospone…";
    note.setAttribute("aria-label", `Nota de la revisión: ${title}`);
    const changed = node("p", "review-changed");
    changed.hidden = true;
    const control: CardControl = { key, card, title, figure, buttons, note, changed };

    for (const state of REVIEW_STATES) {
      const button = node("button", undefined, `${REVIEW_LABEL[state].icon} ${REVIEW_LABEL[state].text}`);
      button.type = "button";
      button.dataset["state"] = state;
      button.addEventListener("click", () => commit(control, state, note.value.trim()));
      buttons.set(state, button);
      group.append(button);
    }
    note.addEventListener("change", () => {
      const state = stateOf(key);
      if (state !== "pendiente") commit(control, state, note.value.trim());
    });

    bar.append(group, note, changed);
    card.append(bar);
    card.classList.add("reviewable");
    controls.set(key, control);
    paint(control);
  }

  function refresh(): void {
    const summary = summarizeReview([...controls.keys()], entries);
    const done = summary.total - summary.pendiente;
    heading.textContent =
      summary.total === 0
        ? "Revisión en campo: no hay hallazgos que revisar en este análisis."
        : `Revisión: ${done} de ${summary.total} revisados`;
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
      })
      .catch(() => onError("No se ha podido leer la revisión guardada de este circuito."));
  }

  return { attach, bar, panel, refresh };
}
