/**
 * El gestor de análisis (`UX_SPEC.md` §8.1, propietario, 2026-10-18): al cargar se enseñan los análisis
 * guardados en el dispositivo para elegir uno y añadirle lecturas, y se puede crear uno nuevo, vacío o a
 * partir de otro con sus listas y su flota. Debajo, lo que el análisis elegido ya tiene y lo que le
 * falta, para ir incluyendo los datos según se disponga de ellos.
 *
 * El campo «Circuito» sigue siendo la fuente de verdad de a qué análisis va cada carga: el gestor lo
 * rellena al elegir, y escribir un nombre nuevo a mano sigue creando el análisis al importar su primer
 * fichero, como antes.
 */

import {
  analysisNameProblem,
  createAnalysis,
  listAnalyses,
  missingLists,
  type AnalysisSummary,
} from "../persistence/analyses.js";
import { CircuitExistsError, isAvailable, isStorageFull, loadCircuit } from "../persistence/store.js";

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const count = (value: number, one: string, many: string): string => `${value.toLocaleString("es-ES")} ${value === 1 ? one : many}`;

/** Una línea con lo que tiene un análisis, para la lista. Pura. */
export function analysisLine(summary: AnalysisSummary, format: (utcMs: number) => string): string {
  const parts = [
    summary.files === 0
      ? "sin lecturas todavía"
      : `${count(summary.files, "fichero", "ficheros")}${summary.span === null ? "" : `, de ${format(summary.span.from)} a ${format(summary.span.to)}`}`,
    summary.lists.length === 0 ? "sin listas" : count(summary.lists.length, "lista", "listas"),
    ...(summary.fleet === null ? [] : ["flota"]),
    ...(summary.connectionVehicles === null ? [] : [`conexiones de ${count(summary.connectionVehicles, "AGV", "AGV")}`]),
    ...(summary.basedOn === null ? [] : [`a partir de «${summary.basedOn.circuitId}»`]),
  ];
  return parts.join(" · ");
}

/** Lo que el análisis tiene y lo que le falta, una línea por tipo de dato. Pura. */
export function analysisDataLines(summary: AnalysisSummary, format: (utcMs: number) => string): readonly { readonly label: string; readonly text: string; readonly missing: boolean }[] {
  const copied = (yes: boolean): string => (yes && summary.basedOn !== null ? `, copiada de «${summary.basedOn.circuitId}»` : "");
  const missing = missingLists(summary);
  return [
    {
      label: "Lecturas",
      text:
        summary.files === 0
          ? "Ninguna todavía: elige abajo un fichero de lecturas."
          : `${count(summary.files, "fichero", "ficheros")}${summary.span === null ? "" : `, de ${format(summary.span.from)} a ${format(summary.span.to)}`}.`,
      missing: summary.files === 0,
    },
    {
      label: "Listas",
      text:
        summary.lists.length === 0
          ? "Ninguna cargada."
          : `${summary.lists.map((entry) => `${entry.list} (${count(entry.tags, "tag", "tags")}${copied(entry.copied)})`).join(", ")}.`,
      missing: summary.lists.length === 0,
    },
    ...(missing.length === 0 || summary.lists.length === 0 ? [] : [{ label: "Sin cargar", text: `${missing.join(", ")}.`, missing: true }]),
    {
      label: "Flota",
      text: summary.fleet === null ? "Sin historial de flota." : `${count(summary.fleet.periods, "periodo", "periodos")}${summary.fleet.copied && summary.basedOn !== null ? `, copiado de «${summary.basedOn.circuitId}»` : ""}.`,
      missing: summary.fleet === null,
    },
    {
      label: "Conexiones",
      text: summary.connectionVehicles === null ? "Sin registro de conexiones; la pestaña WiFi aparece al cargarlo." : `Registro de ${count(summary.connectionVehicles, "AGV", "AGV")}.`,
      missing: summary.connectionVehicles === null,
    },
  ];
}

export interface AnalysesPanel {
  readonly node: HTMLDetailsElement;
  /** Pliega el gestor: tras importar, lo que se mira es el análisis. */
  collapse(): void;
  /** Los nombres guardados, para el `datalist` del campo «Circuito». */
  readonly names: HTMLDataListElement;
  /** Vuelve a leer los análisis del almacén (tras importar, cargar listas, abrir una copia…). */
  refresh(): void;
  /** El campo «Circuito» ha cambiado: se marca el elegido y se enseñan sus datos. */
  sync(): void;
  setBusy(busy: boolean): void;
}

export function createAnalysesPanel(hooks: {
  /** El nombre escrito en el campo «Circuito», recortado. */
  readonly selected: () => string;
  /** Escribe el nombre en el campo «Circuito». */
  readonly select: (name: string) => void;
  /** La zona horaria de un análisis nuevo vacío. */
  readonly zone: string;
  readonly format: (utcMs: number) => string;
  readonly notify: (kind: "info" | "warn" | "error", title: string, lines: readonly string[]) => void;
  /** Lleva a la pestaña Datos, a las listas del circuito. */
  readonly openLists: () => void;
}): AnalysesPanel {
  // Plegable: abierto al llegar y plegado tras una importación, cuando lo que importa es el análisis.
  const node = element("details", "analyses");
  node.open = true;
  const summaryLine = element("summary");
  const title = element("h2", undefined, "Análisis");
  const currentLabel = element("span", "muted analyses-current");
  summaryLine.append(title, currentLabel);
  const intro = element(
    "p",
    "muted",
    "Cada análisis guarda en este dispositivo las lecturas de un circuito y lo que se le declara: listas de tags, flota y conexiones. " +
      "Elige uno para añadirle lecturas nuevas, o crea uno nuevo vacío o a partir de otro.",
  );
  const listHeading = element("h3", undefined, "Guardados en este dispositivo");
  listHeading.id = "analyses-heading";
  const list = element("ul", "analyses-list");
  list.setAttribute("aria-labelledby", listHeading.id);
  const empty = element("p", "muted analyses-empty", "Todavía no hay análisis guardados en este dispositivo.");
  const names = element("datalist");
  names.id = "analysis-names";
  const openNew = element("button", undefined, "Nuevo análisis…");
  openNew.type = "button";
  openNew.id = "new-analysis";
  const form = element("div", "analysis-new");
  form.hidden = true;
  const data = element("div", "analysis-data");
  data.setAttribute("aria-live", "polite");
  node.append(summaryLine, intro, listHeading, list, empty, names, openNew, form, data);

  let summaries: readonly AnalysisSummary[] = [];
  let busy = false;
  let token = 0;

  const renderList = (): void => {
    const current = hooks.selected();
    list.replaceChildren();
    names.replaceChildren();
    for (const summary of summaries) {
      const item = element("li");
      const button = element("button", "analysis-item");
      button.type = "button";
      button.dataset["analysis"] = summary.circuitId;
      button.setAttribute("aria-pressed", String(summary.circuitId === current));
      button.disabled = busy;
      button.append(element("span", "analysis-name", summary.name), element("span", "analysis-detail", analysisLine(summary, hooks.format)));
      button.addEventListener("click", () => {
        hooks.select(summary.circuitId);
        sync();
      });
      item.append(button);
      list.append(item);
      const option = element("option");
      option.value = summary.circuitId;
      names.append(option);
    }
    list.hidden = summaries.length === 0;
    empty.hidden = summaries.length > 0 || !isAvailable();
    if (!isAvailable()) empty.textContent = "Este navegador no deja guardar datos: los ficheros se analizan sin guardar.";
  };

  const renderData = (): void => {
    const current = hooks.selected();
    data.replaceChildren();
    summaryCurrent(current);
    if (current === "") {
      data.append(element("p", "muted", "Sin análisis elegido: el fichero de lecturas se analizará sin guardar nada."));
      return;
    }
    const summary = summaries.find((entry) => entry.circuitId === current);
    if (summary === undefined) {
      data.append(
        element(
          "p",
          "muted",
          `«${current}» no está guardado: se creará al importar su primer fichero de lecturas. Para partir de las listas de otro análisis, usa «Nuevo análisis…».`,
        ),
      );
      return;
    }
    data.append(element("h3", undefined, `Datos de «${summary.name}»`));
    const facts = element("dl", "facts analysis-facts");
    for (const line of analysisDataLines(summary, hooks.format)) {
      facts.append(element("dt", undefined, line.label), element("dd", line.missing ? "muted" : undefined, line.text));
    }
    const load = element("button", undefined, "Cargar listas, flota o conexiones…");
    load.type = "button";
    load.disabled = busy;
    load.addEventListener("click", hooks.openLists);
    data.append(facts, load);
  };

  function summaryCurrent(name: string): void {
    currentLabel.textContent = name === "" ? " — sin guardar" : ` — «${name}»`;
  }

  const sync = (): void => {
    renderList();
    renderData();
  };

  const refresh = (): void => {
    if (!isAvailable()) {
      summaries = [];
      sync();
      return;
    }
    const mine = ++token;
    void listAnalyses()
      .then((loaded) => {
        if (mine !== token) return;
        summaries = loaded;
        sync();
      })
      .catch(() => {
        // Sin almacén utilizable la lista queda vacía; la importación dirá que no pudo guardar.
        if (mine !== token) return;
        summaries = [];
        sync();
      });
  };

  const closeForm = (): void => {
    form.replaceChildren();
    form.hidden = true;
    openNew.hidden = false;
  };

  openNew.addEventListener("click", () => {
    if (!isAvailable()) {
      hooks.notify("error", "No hay almacén local", ["Este navegador no deja guardar datos, así que no se puede crear un análisis. Los ficheros se analizan sin guardar."]);
      return;
    }
    form.replaceChildren();
    const nameLabel = element("label", undefined, "Nombre del análisis");
    const name = element("input");
    name.type = "text";
    name.id = "new-analysis-name";
    name.placeholder = "por ejemplo, el circuito y el periodo";
    nameLabel.htmlFor = name.id;
    const baseLabel = element("label", undefined, "Partir de");
    const base = element("select");
    base.id = "analysis-base";
    baseLabel.htmlFor = base.id;
    const none = element("option", undefined, "Ninguno: empezar vacío");
    none.value = "";
    base.append(none);
    for (const summary of summaries) {
      const option = element("option", undefined, summary.name);
      option.value = summary.circuitId;
      base.append(option);
    }
    const copies = element("fieldset", "analysis-copies");
    copies.append(element("legend", undefined, "Qué se copia del análisis base"));
    const listsBox = element("input");
    listsBox.type = "checkbox";
    listsBox.id = "copy-lists";
    const listsText = element("label");
    listsText.htmlFor = listsBox.id;
    const fleetBox = element("input");
    fleetBox.type = "checkbox";
    fleetBox.id = "copy-fleet";
    const fleetText = element("label");
    fleetText.htmlFor = fleetBox.id;
    const listsRow = element("div", "analysis-copy");
    listsRow.append(listsBox, listsText);
    const fleetRow = element("div", "analysis-copy");
    fleetRow.append(fleetBox, fleetText);
    copies.append(
      listsRow,
      fleetRow,
      element(
        "p",
        "muted",
        "No se copian las lecturas, las instantáneas, la memoria consolidada, la revisión en campo, los expedientes, el registro de conexiones ni los valores de planta confirmados: son del periodo de su análisis.",
      ),
    );
    const showCopies = (): void => {
      const chosen = summaries.find((entry) => entry.circuitId === base.value);
      copies.hidden = chosen === undefined;
      if (chosen === undefined) return;
      listsBox.disabled = chosen.lists.length === 0;
      listsBox.checked = chosen.lists.length > 0;
      listsText.textContent =
        chosen.lists.length === 0
          ? "Listas de tags: el análisis base no tiene ninguna."
          : `Listas de tags: ${chosen.lists.map((entry) => `${entry.list} (${count(entry.tags, "tag", "tags")})`).join(", ")}`;
      fleetBox.disabled = chosen.fleet === null;
      fleetBox.checked = chosen.fleet !== null;
      fleetText.textContent = chosen.fleet === null ? "Historial de flota: el análisis base no tiene." : `Historial de flota (${count(chosen.fleet.periods, "periodo", "periodos")})`;
    };
    base.addEventListener("change", showCopies);
    // Por defecto parte del elegido, si lo hay: es el caso de «el mismo circuito, otro periodo».
    if (summaries.some((entry) => entry.circuitId === hooks.selected())) base.value = hooks.selected();
    showCopies();
    const problem = element("p", "analysis-problem");
    problem.hidden = true;
    problem.setAttribute("role", "alert");
    const create = element("button", undefined, "Crear el análisis");
    create.type = "button";
    create.id = "create-analysis";
    create.disabled = busy;
    const cancel = element("button", undefined, "Cancelar");
    cancel.type = "button";
    cancel.addEventListener("click", closeForm);
    const actions = element("div", "analysis-actions");
    actions.append(create, cancel);
    create.addEventListener("click", () => {
      void (async () => {
        const wanted = name.value.trim();
        const issue = analysisNameProblem(wanted, summaries.map((entry) => entry.circuitId));
        if (issue !== null) {
          problem.textContent = issue;
          problem.hidden = false;
          name.focus();
          return;
        }
        problem.hidden = true;
        create.disabled = true;
        try {
          const baseCircuit = base.value === "" ? undefined : await loadCircuit(base.value);
          const copy = { lists: !listsBox.disabled && listsBox.checked, fleet: !fleetBox.disabled && fleetBox.checked };
          const created = await createAnalysis({
            name: wanted,
            zone: hooks.zone,
            now: Date.now(),
            ...(baseCircuit === undefined ? {} : { base: baseCircuit, copy }),
          });
          closeForm();
          hooks.select(created.circuitId);
          const copiedLists = created.lists ?? [];
          hooks.notify("info", `Análisis «${created.name}» creado`, [
            baseCircuit === undefined
              ? "Está vacío."
              : [
                  `A partir de «${baseCircuit.name}»:`,
                  copiedLists.length === 0 ? "sin listas" : `${count(copiedLists.length, "lista copiada", "listas copiadas")} (${copiedLists.map((entry) => entry.list).join(", ")})`,
                  created.fleet === undefined ? "y sin historial de flota." : "y el historial de flota.",
                ].join(" "),
            "Añádele un fichero de lecturas aquí arriba y, cuando las tengas, sus listas, flota y conexiones en la pestaña Datos. Cada carga se guarda en este análisis.",
          ]);
          refresh();
        } catch (error) {
          create.disabled = busy;
          if (error instanceof CircuitExistsError) {
            problem.textContent = analysisNameProblem(wanted, [wanted]) ?? error.message;
            problem.hidden = false;
            refresh();
            return;
          }
          hooks.notify("error", "No se pudo crear el análisis", [
            isStorageFull(error) ? "No queda espacio en este dispositivo para guardar." : "El almacén rechazó la operación.",
            "No se ha creado nada. Vuelve a intentarlo.",
          ]);
        }
      })();
    });
    form.append(element("h3", undefined, "Nuevo análisis"), nameLabel, name, baseLabel, base, copies, problem, actions);
    form.hidden = false;
    openNew.hidden = true;
    name.focus();
  });

  refresh();
  return {
    node,
    collapse(): void {
      node.open = false;
    },
    names,
    refresh,
    sync,
    setBusy(next: boolean): void {
      busy = next;
      for (const button of node.querySelectorAll<HTMLButtonElement>(".analysis-item, .analysis-data button, #create-analysis")) button.disabled = busy;
    },
  };
}
