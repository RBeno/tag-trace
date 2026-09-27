/**
 * La pestaña «Memoria» (F4; `MEMORY_CONSOLIDATION.md` §6-§11, UX_SPEC §6).
 *
 * Aquí no se decide nada: la memoria consolidada llega hecha del Worker (`MemoryViews`,
 * `ConsolidationPreview`, `ConsolidatedVersion`) y este módulo la traduce a texto y botones. Lo único
 * que sale de aquí son los mensajes que la persona pide con un botón: previsualizar, confirmar,
 * revocar, elegir linaje y comparar dos versiones. La aplicación nunca consolida sola: el `commit` solo se envía desde el
 * botón «Confirmar y consolidar», y solo cuando la previsualización no tiene bloqueos (R-MEM-001).
 *
 * Todo texto del dato entra por `textContent` (TH-007).
 */

import type { MemoryViews, VersionSummary } from "../application/protocol.js";
import { CHANGE_CLASSES, type ChangeClass, type ChangeSummary, type ClassifiedChange, type IncidentRecord } from "../domain/change-class.js";
import type { AppliedCut, IncidentCut } from "../domain/incident-cut.js";
import type { BlockerCode, ConsolidatedVersion, ConsolidationPreview, LineageRelation, MemoryDecision, VersionComparison } from "../domain/memory.js";
import { REVIEW_LABEL, REVIEW_STATES, type ReviewState } from "../domain/review.js";
import { deltaView } from "./evolution.js";
import { regimeLabel } from "./labels.js";

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

/** Kilobytes con una decimal y coma, como el resto de cifras de la interfaz. */
export function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
}

/** Cada bloqueo, en palabras que no exigen conocer el código (UX_SPEC §4.4). */
export const BLOCKER_LABEL: Readonly<Record<BlockerCode, string>> = {
  "hallazgos-pendientes": "Hallazgos pendientes de revisar",
  "periodo-de-incidencia": "Periodo de incidencia: hay hallazgos confirmados que pueden parar la planta",
  "sin-instantanea": "El fichero no tiene instantánea",
  "ya-consolidada": "Ese fichero ya está consolidado en una versión vigente",
  "bifurcacion-sin-resolver": "Hay dos linajes sin resolver",
};

/** Cada clase de cambio frente al esperado (§8), y si pasa al esperado. */
export const CHANGE_CLASS_LABEL: Readonly<Record<ChangeClass, { readonly text: string; readonly adopted: boolean }>> = {
  "cambio-confirmado": { text: "Confirmados por una persona (plano físico)", adopted: true },
  "cambio-colectivo-sostenido": { text: "Colectivos y sostenidos", adopted: true },
  "deriva-pendiente": { text: "Derivas pendientes", adopted: false },
  incidencia: { text: "Tocados por una incidencia", adopted: false },
  "evento-puntual": { text: "Eventos puntuales: se vieron y ya no están", adopted: false },
};

/** «3 cambios adoptados, 5 pendientes, 1 incidencia excluida». */
export function changeSummaryLine(summary: ChangeSummary): string {
  return (
    `${summary.adopted} ${summary.adopted === 1 ? "cambio adoptado" : "cambios adoptados"}, ` +
    `${summary.pending} ${summary.pending === 1 ? "pendiente" : "pendientes"}, ` +
    `${summary.incidents} ${summary.incidents === 1 ? "incidencia excluida" : "incidencias excluidas"}`
  );
}

/** Lo que toca una incidencia, en palabras: sus tags y cuántos tramos; la de un AGV, que no toca el grafo. */
export function incidentReach(incident: IncidentRecord): string {
  const tags = incident.subjects.filter((key) => key.startsWith("vertice|")).map((key) => key.slice("vertice|".length));
  // Un tramo en dos regímenes es el mismo tramo.
  const edges = new Set(incident.subjects.filter((key) => key.startsWith("arista|")).map((key) => key.split("|").slice(1, 3).join("→"))).size;
  if (tags.length === 0 && incident.agvId !== undefined) return `AGV ${incident.agvId}: no toca el grafo; queda registrada con su ventana`;
  if (tags.length === 0) return "no toca ningún tag del anillo: el esperado no cambia por ella";
  return `toca ${tags.join(", ")} y ${edges} ${edges === 1 ? "tramo" : "tramos"}: quedan fuera de las estadísticas del esperado`;
}

/**
 * Cuándo ocurrió una incidencia (OQ-149): «de lun 12:05 a lun 12:40», «en lun 12:05» si es un instante,
 * y una por parada si hubo varias. Vacío en las incidencias guardadas antes, que no traen ventana.
 */
export function incidentWhen(incident: IncidentRecord, format: (utcMs: number) => string): string {
  const windows = incident.windows ?? (incident.window === undefined ? [] : [incident.window]);
  return windows.map((window) => (window.from === window.to ? `en ${format(window.from)}` : `de ${format(window.from)} a ${format(window.to)}`)).join(" · ");
}

/**
 * Las ventanas que se ofrecen recortar de una incidencia, una fila por cada una (OQ-155, propietario
 * 2026-09-27): `windows` si las trae (una por parada), si no su `window`; ninguna si no tiene.
 */
export function incidentWindows(incident: IncidentRecord): readonly { readonly from: number; readonly to: number }[] {
  return incident.windows ?? (incident.window === undefined ? [] : [incident.window]);
}

/** La clave de una fila de recorte: la incidencia y cuál de sus ventanas. */
function cutChoiceKey(incidentKey: string, windowIndex: number): string {
  return `${incidentKey}#${windowIndex}`;
}

/** Un recorte aplicado, en palabras (OQ-148): «de lun 12:05 a lun 12:40, solo el AGV 0007: quita 3 lecturas». */
export function cutLine(cut: AppliedCut, format: (utcMs: number) => string): string {
  const who = cut.agvId === undefined ? "todas las lecturas del fichero" : `solo las lecturas del AGV ${cut.agvId}`;
  const count = `${cut.removed} ${cut.removed === 1 ? "lectura" : "lecturas"}`;
  return `de ${format(cut.from)} a ${format(cut.to)}, ${who}: quita ${count}`;
}

/** La relación entre la memoria local y la del `.agvproj` abierto (§10), dicha en una frase. */
export const LINEAGE_LABEL: Readonly<Record<LineageRelation, string>> = {
  "sin-memoria": "El proyecto abierto no traía memoria consolidada.",
  identica: "La memoria del proyecto abierto es idéntica a la de este dispositivo.",
  "local-adelantada": "La memoria local va por delante de la del proyecto abierto: se conserva.",
  "entrante-adelantada": "La memoria entrante va por delante: se adopta.",
  bifurcada: "Las dos memorias están bifurcadas: hay que elegir cuál sigue.",
};

/** Un cambio adoptado, por su clave (`vertice|T|tipo` o `arista|A|B|régimen|sentido`), dicho en palabras. */
const CHANGE_WORDS: Readonly<Record<string, string>> = {
  aparece: "aparece",
  desaparece: "desaparece",
  "se-mueve": "se mueve",
  "cambia-de-clase": "cambia de clase",
  "deja-de-leerse": "deja de leerse",
  "empieza-a-leerse": "empieza a leerse",
  "no-observado": "sin leer en su ubicación",
  "mas-lento": "más lento",
  "mas-rapido": "más rápido",
};

export function adoptedChangeText(key: string): string {
  const parts = key.split("|");
  if (parts[0] === "vertice" && parts.length === 3) return `${parts[1]} ${CHANGE_WORDS[parts[2] as string] ?? parts[2]}`;
  if (parts[0] === "arista" && parts.length === 5) {
    return `tramo ${parts[1]} → ${parts[2]} ${CHANGE_WORDS[parts[4] as string] ?? parts[4]} (${regimeLabel(parts[3] as string)})`;
  }
  return key;
}

/** «Entre medias: 2 versiones, 1 revocada.» */
export function betweenLine(between: VersionComparison["between"]): string {
  if (between.versions === 0) return "Entre medias: ninguna versión.";
  const count = `${between.versions} ${between.versions === 1 ? "versión" : "versiones"}`;
  const revoked = between.revoked === 0 ? "ninguna revocada" : `${between.revoked} ${between.revoked === 1 ? "revocada" : "revocadas"}`;
  return `Entre medias: ${count}, ${revoked}.`;
}

const CHOICE_LABEL = {
  "conservar-local": "se conservó la memoria local",
  "adoptar-entrante": "se adoptó la memoria entrante; la local quedó archivada",
} as const;

/** El fichero cuya instantánea se consolidaría: el del análisis en pantalla. */
export interface MemoryWorkingFile {
  readonly sourceId: string;
  readonly fileName: string;
  readonly hasSnapshot: boolean;
}

/** Lo que la bandeja de hallazgos dice de la revisión, contado en sus tarjetas. `null` sin bandeja. */
export interface FindingsStatus {
  readonly total: number;
  readonly pending: number;
  /** Confirmados de rango 1: lo que hace del periodo una incidencia y no memoria normal (§6, §8). */
  readonly confirmedCritical: number;
}

export interface MemoryContext {
  readonly circuitId: string | null;
  readonly memory: MemoryViews | null;
  readonly working: MemoryWorkingFile | null;
}

export interface MemoryPanelInput {
  readonly formatInstant: (utcMs: number) => string;
  readonly formatWindow: (window: { readonly from: number; readonly to: number }) => string;
  /** El instante corto (día de la semana y hora) de la ventana de una incidencia; sin él, `formatInstant`. */
  readonly formatTick?: (utcMs: number) => string;
  readonly findings: () => FindingsStatus | null;
  /** Lleva a la bandeja del Resumen, filtrada por pendientes si se puede. */
  readonly goToPending: () => void;
  /** Con `cuts`, los recortes de ventana que la persona eligió (OQ-148). */
  readonly preview: (sourceId: string, cuts?: readonly IncidentCut[]) => void;
  /**
   * Solo lo llama el botón «Confirmar y consolidar», con los recortes de la previsualización que se
   * confirma y la huella (`previewHash`) con la que llegó: el Worker comprueba que lo que escribe es lo que se vio.
   */
  readonly commit: (sourceId: string, note: string | null, cuts: readonly IncidentCut[] | undefined, previewHash: string) => void;
  /**
   * Un instante como valor de un campo de fecha y hora (`aaaa-mm-ddThh:mm:ss`) en la zona del circuito,
   * y al revés (`null` si no es una fecha válida). Sin ellos no se ofrece recortar.
   */
  readonly toDateTimeInput?: (utcMs: number) => string;
  readonly fromDateTimeInput?: (value: string) => number | null;
  readonly revoke: (version: number, reason: string) => void;
  readonly resolveFork: (choice: "conservar-local" | "adoptar-entrante", reason: string) => void;
  /** Pide al Worker el esperado de `from` frente al de `to`. Solo lee. */
  readonly compare: (from: number, to: number) => void;
}

export interface MemoryPanel {
  readonly node: HTMLElement;
  /** Con cada análisis: la memoria que traen las vistas, el circuito y el fichero de trabajo. */
  update(context: MemoryContext): void;
  /**
   * Vuelve a pintar solo la lista de condiciones, que lee la bandeja y cambia con cada marca de
   * revisión; lo demás —la nota escrita, el foco, una previsualización abierta— se queda como está.
   */
  refresh(): void;
  /** La previsualización recibida, su huella (que vuelve tal cual en el `commit`) y los avisos sobre los recortes. */
  showPreview(preview: ConsolidationPreview, previewHash: string, cutWarnings: readonly string[]): void;
  showConsolidated(version: ConsolidatedVersion, memory: MemoryViews): void;
  showRevoked(version: number, memory: MemoryViews): void;
  showForkResolved(memory: MemoryViews): void;
  showComparison(comparison: VersionComparison): void;
  showError(cause: string, recovery: string): void;
  /** Un aviso que no es un error: por ejemplo, que hay otro trabajo en curso. */
  notice(line: string): void;
  /** Mientras el Worker trabaja, los botones que envían mensajes se apagan. */
  setBusy(busy: boolean): void;
}

const decisionsLine = (decisions: VersionSummary["decisions"]): string =>
  `${REVIEW_LABEL.confirmado.icon} ${decisions.confirmed} · ${REVIEW_LABEL.descartado.icon} ${decisions.discarded} · ${REVIEW_LABEL.pospuesto.icon} ${decisions.postponed}`;

export function createMemoryPanel(input: MemoryPanelInput): MemoryPanel {
  const root = node("section", "panel memory-panel");
  root.hidden = false;
  let context: MemoryContext = { circuitId: null, memory: null, working: null };
  let preview: ConsolidationPreview | null = null;
  /** La huella con la que llegó `preview`; viaja de vuelta en el `commit`. */
  let previewHash: string | null = null;
  /** Los avisos sobre los recortes de `preview`: se enseñan junto a ellos y no bloquean nada. */
  let cutNotes: readonly string[] = [];
  /**
   * `true` mientras lo elegido en las casillas y los campos de recorte no coincide con lo que la
   * previsualización aplicó: entonces «Confirmar y consolidar» se apaga hasta volver a previsualizar.
   */
  let cutsDiffer = false;
  let status: { readonly kind: "info" | "error"; readonly lines: readonly string[] } | null = null;
  let busy = false;
  /** Lo elegido en «Comparar versiones» y la última comparación recibida. */
  let compareFrom: number | null = null;
  let compareTo: number | null = null;
  let comparison: VersionComparison | null = null;
  /** Los botones que hablan con el Worker, para apagarlos mientras responde. */
  const senders: HTMLButtonElement[] = [];
  /**
   * Lo que la persona eligió recortar de cada ventana de cada incidencia (OQ-148; una fila por parada,
   * OQ-155), por `cutChoiceKey`: la casilla y los dos campos tal como los escribió. Se conserva entre
   * previsualizaciones y se olvida con otro análisis.
   */
  const cutChoices = new Map<string, { enabled: boolean; from: string; to: string }>();

  const heading = node("h2", undefined, "Memoria del circuito");
  const statusBox = node("div", "memory-status");
  statusBox.setAttribute("role", "status");
  statusBox.setAttribute("aria-live", "polite");
  const body = node("div", "memory-body");
  root.append(heading, statusBox, body);

  function sender(text: string, className?: string): HTMLButtonElement {
    const out = button(text, className);
    out.disabled = busy;
    senders.push(out);
    return out;
  }

  function paintStatus(): void {
    statusBox.replaceChildren();
    statusBox.className = status === null ? "memory-status" : `memory-status ${status.kind}`;
    if (status === null) return;
    for (const line of status.lines) statusBox.append(node("p", undefined, line));
  }

  // --- 1. La versión vigente ----------------------------------------------------------------------

  function currentBlock(memory: MemoryViews | null): HTMLElement {
    const box = node("div", "memory-current");
    if (context.circuitId === null) {
      box.append(node("p", "muted", "Sin circuito no hay memoria: escribe el nombre del circuito e importa sus lecturas."));
      return box;
    }
    const current = memory === null || memory.current === null ? null : memory.versions.find((entry) => entry.version === memory.current);
    if (current === undefined || current === null) {
      box.append(node("p", "memory-none", "Sin memoria consolidada todavía."));
      if (memory !== null && memory.versions.length > 0) {
        box.append(
          node(
            "p",
            "muted",
            memory.versions.length === 1
              ? "La única versión guardada está revocada; sigue en la lista con su razón."
              : `Las ${memory.versions.length} versiones guardadas están revocadas; siguen en la lista con su razón.`,
          ),
        );
      } else {
        box.append(node("p", "muted", "Revisa los hallazgos del periodo y consolida cuando sea un periodo normal: esa versión será la referencia con la que se compare lo que venga."));
      }
    } else {
      const line = node("p", "memory-current-line");
      line.append(node("strong", undefined, `Versión vigente: v${current.version}`));
      line.append(
        ` — de ${current.basedOnFileName} (${input.formatWindow(current.window)}), consolidada el ${input.formatInstant(current.createdAt)}. ` +
          `Decisiones: ${decisionsLine(current.decisions)}.`,
      );
      box.append(line);
      if (current.note !== null && current.note !== "") box.append(node("p", "muted", `Nota: ${current.note}`));
    }
    if (memory !== null && memory.lineage !== null) box.append(node("p", "muted memory-lineage", LINEAGE_LABEL[memory.lineage]));
    return box;
  }

  // --- 2. Lo observado frente a la memoria -------------------------------------------------------

  function comparisonBlock(memory: MemoryViews | null): readonly HTMLElement[] {
    const comparison = memory?.comparison ?? null;
    if (comparison === null) {
      const cause =
        context.circuitId === null
          ? "no hay circuito."
          : memory === null || memory.current === null
            ? "no hay versión vigente con la que comparar."
            : memory.fork !== null
              ? "hay una bifurcación de linaje sin resolver, y mientras tanto la comparación queda incompleta."
              : context.working === null || !context.working.hasSnapshot
                ? "el fichero de trabajo no tiene instantánea."
                : "el Worker no la construyó; vuelve a importar el fichero.";
      return [node("h3", undefined, "Lo observado frente a la memoria"), node("p", "muted", `Sin comparación: ${cause}`)];
    }
    const title = node("h3", undefined, `Lo observado frente a la memoria v${comparison.version}`);
    const intro = node(
      "p",
      "muted",
      `${context.working?.fileName ?? "El fichero de trabajo"} frente a la versión v${comparison.version}, de ${comparison.basedOnFileName} ` +
        `(consolidada el ${input.formatInstant(comparison.consolidatedAt)}). Hechos, no causas: lo que el grafo enseña distinto de lo consolidado.`,
    );
    return [title, intro, ...deltaView(comparison.delta, "Nada distinto de la memoria: mismos tags, en el mismo sitio, con las mismas horquillas.")];
  }

  // --- 3. Consolidar periodo ---------------------------------------------------------------------

  function check(ok: boolean | null, text: string): HTMLElement {
    const item = node("li", "memory-check");
    item.dataset["ok"] = ok === null ? "desconocido" : ok ? "si" : "no";
    item.append(node("span", "memory-check-mark", ok === null ? "—" : ok ? "✓" : "○"), " ", node("span", undefined, text));
    return item;
  }

  function consolidateBlock(memory: MemoryViews | null): readonly HTMLElement[] {
    const out: HTMLElement[] = [node("h3", undefined, "Consolidar periodo")];
    out.push(
      node(
        "p",
        "muted",
        "Consolidar escribe la instantánea del fichero de trabajo, con la revisión de sus hallazgos, como versión nueva de la memoria. " +
          "Primero se previsualiza; nada se escribe hasta que confirmes.",
      ),
    );
    const working = context.working;
    out.push(checksList(memory));

    const next = preview?.nextVersion ?? (memory?.versions.length ?? 0) + 1;
    const go = sender(`Previsualizar v${next}`, "memory-preview-button");
    go.disabled = busy || context.circuitId === null || working === null || !working.hasSnapshot;
    go.addEventListener("click", () => {
      if (working === null) return;
      status = null;
      paintStatus();
      input.preview(working.sourceId);
    });
    out.push(go);
    if (preview !== null) out.push(previewBlock(preview));
    return out;
  }

  /** La lista de condiciones: lee la bandeja, así que se vuelve a pintar sola con cada marca de revisión. */
  function checksList(memory: MemoryViews | null): HTMLElement {
    const findings = input.findings();
    const working = context.working;
    const checks = node("ul", "memory-checks");
    checks.setAttribute("aria-label", "Condiciones para consolidar");
    checks.append(
      check(
        working === null ? null : working.hasSnapshot,
        working === null
          ? "Fichero de trabajo: ninguno; importa las lecturas del circuito."
          : working.hasSnapshot
            ? `Fichero de trabajo con instantánea: ${working.fileName}.`
            : `El fichero de trabajo (${working.fileName}) no tiene instantánea.`,
      ),
      check(
        findings === null ? null : findings.pending === 0,
        findings === null
          ? "Hallazgos: sin bandeja que revisar."
          : findings.total === 0
            ? "Hallazgos: ninguno en este análisis."
            : findings.pending === 0
              ? `Hallazgos: sin pendientes (${findings.total} revisados).`
              : `Hallazgos: ${findings.pending} ${findings.pending === 1 ? "pendiente" : "pendientes"} de ${findings.total}.`,
      ),
      // OQ-148: una incidencia ya no impide consolidar; se excluye del esperado lo que toca.
      check(
        findings === null ? null : true,
        findings === null
          ? "Incidencias: sin bandeja no se sabe."
          : findings.confirmedCritical === 0
            ? "Sin incidencias: ningún hallazgo confirmado puede parar la planta."
            : `Incidencias: ${findings.confirmedCritical} ${findings.confirmedCritical === 1 ? "hallazgo confirmado puede" : "hallazgos confirmados pueden"} parar la planta. No impide consolidar: el periodo se consolida entero y la previsualización dice qué queda fuera del esperado.`,
      ),
      check(memory === null || memory.fork === null, memory !== null && memory.fork !== null ? "Bifurcación de linaje sin resolver." : "Sin bifurcación de linaje."),
    );
    return checks;
  }

  function itemsList(items: readonly string[]): HTMLElement {
    const list = node("ul", "memory-items");
    const shown = items.slice(0, 8);
    for (const item of shown) list.append(node("li", undefined, item));
    if (items.length > shown.length) list.append(node("li", "muted", `y ${items.length - shown.length} más`));
    return list;
  }

  function decisionsBlock(decisions: readonly MemoryDecision[]): HTMLElement {
    const box = node("div", "memory-decisions");
    box.append(node("p", undefined, `Decisiones que viajan con la versión: ${decisions.length}.`));
    for (const state of REVIEW_STATES as readonly ReviewState[]) {
      const group = decisions.filter((decision) => decision.state === state);
      if (group.length === 0) continue;
      const details = node("details");
      const summary = node("summary", undefined, `${REVIEW_LABEL[state].icon} ${REVIEW_LABEL[state].text}: ${group.length}`);
      details.append(summary);
      const list = node("ul", "memory-items");
      for (const decision of group) {
        const item = node("li");
        item.append(node("span", undefined, decision.title), " ", node("span", "muted", decision.figure));
        if (decision.note !== null && decision.note !== "") item.append(" ", node("span", "muted", `— ${decision.note}`));
        list.append(item);
      }
      details.append(list);
      box.append(details);
    }
    return box;
  }

  /**
   * Los recortes marcados (OQ-148), leídos de sus campos: uno por fila encendida, que con varias paradas
   * es uno por parada (OQ-155). Un campo que conserva el valor propuesto da el instante exacto de la
   * ventana, sin redondear al segundo. Devuelve el motivo si alguno no se entiende.
   */
  function chosenCuts(shown: ConsolidationPreview): { readonly cuts: readonly IncidentCut[] } | { readonly error: string } {
    const toInput = input.toDateTimeInput;
    const fromInput = input.fromDateTimeInput;
    if (toInput === undefined || fromInput === undefined) return { cuts: [] };
    const cuts: IncidentCut[] = [];
    for (const incident of shown.incidents ?? []) {
      const applied = (shown.cuts ?? []).filter((cut) => cut.incidentKey === incident.key);
      const windows = incidentWindows(incident);
      for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
        const window = windows[windowIndex] as { readonly from: number; readonly to: number };
        const choice = cutChoices.get(cutChoiceKey(incident.key, windowIndex));
        if (choice === undefined || !choice.enabled) continue;
        const exact = (value: string): number | null => {
          for (const known of [window.from, window.to, ...applied.flatMap((cut) => [cut.from, cut.to])]) {
            if (toInput(known) === value) return known;
          }
          return fromInput(value);
        };
        const from = exact(choice.from);
        const to = exact(choice.to);
        const which = windows.length === 1 ? `El recorte de «${incident.title}»` : `El recorte ${windowIndex + 1} de «${incident.title}»`;
        if (from === null || to === null) return { error: `${which} necesita un principio y un fin con fecha y hora.` };
        if (from > to) return { error: `${which} empieza después de terminar.` };
        cuts.push({ incidentKey: incident.key, from, to, ...(incident.agvId === undefined ? {} : { agvId: incident.agvId }) });
      }
    }
    return { cuts };
  }

  /**
   * ¿Lo marcado en las casillas y los campos es lo que esta previsualización aplicó? Si no, confirmar
   * escribiría otra cosa que la que se ve: el botón se apaga hasta volver a previsualizar. Se comparan
   * como conjuntos, ordenados: con varios recortes de una incidencia el orden de las filas no importa.
   */
  function cutsMatchShown(shown: ConsolidationPreview): boolean {
    const chosen = chosenCuts(shown);
    if ("error" in chosen) return false;
    const applied = shown.cuts ?? [];
    if (chosen.cuts.length !== applied.length) return false;
    const key = (cut: IncidentCut): string => `${cut.incidentKey}\u0000${cut.from}\u0000${cut.to}\u0000${cut.agvId ?? ""}`;
    const left = chosen.cuts.map(key).sort();
    const right = applied.map(key).sort();
    return left.every((entry, index) => entry === right[index]);
  }

  /** Se fija al pintar la previsualización; cada cambio en un recorte lo llama para apagar o encender «Confirmar». */
  let syncConfirm: () => void = () => {};

  /**
   * Una fila de recorte de una incidencia con ventana: la casilla («Recortar su ventana al consolidar»
   * con una sola ventana; «Recortar esta parada al consolidar» con varias, OQ-155) y sus dos campos,
   * propuestos con esa ventana. `windowIndex` dice cuál de las `count` ventanas de la incidencia es.
   */
  function cutControls(
    incident: IncidentRecord,
    window: { readonly from: number; readonly to: number },
    shown: ConsolidationPreview,
    index: number,
    windowIndex: number,
    count: number,
  ): HTMLElement {
    const holder = node("div", "memory-cut");
    holder.dataset["window"] = String(windowIndex);
    const toInput = input.toDateTimeInput;
    const available = shown.originalArchived === true && toInput !== undefined && input.fromDateTimeInput !== undefined;
    const toggle = node("input", "memory-cut-toggle");
    toggle.type = "checkbox";
    toggle.id = `memory-cut-${index}-${windowIndex}`;
    const label = node("label", "memory-cut-label");
    label.htmlFor = toggle.id;
    if (count > 1) {
      const format = input.formatTick ?? input.formatInstant;
      const when = window.from === window.to ? `en ${format(window.from)}` : `de ${format(window.from)} a ${format(window.to)}`;
      holder.append(node("p", "muted memory-cut-which", `Parada ${windowIndex + 1} de ${count}: ${when}`));
    }
    label.append(toggle, count > 1 ? " Recortar esta parada al consolidar" : " Recortar su ventana al consolidar");
    holder.append(label);
    if (!available || toInput === undefined) {
      toggle.disabled = true;
      // Con varias paradas el motivo se dice una vez, en la primera fila.
      if (windowIndex === 0) {
        holder.append(node("p", "muted memory-cut-unavailable", shown.cutUnavailable ?? "Sin el fichero original archivado no se puede recortar: vuelve a cargarlo."));
      }
      return holder;
    }
    // Sin elección guardada, la fila arranca con el recorte que esta previsualización aplicó a esa
    // ventana (el que la toca), y si no hay, apagada y con la ventana propuesta.
    const appliedAll = (shown.cuts ?? []).filter((cut) => cut.incidentKey === incident.key);
    const applied = count === 1 ? appliedAll[0] : appliedAll.find((cut) => cut.from <= window.to && cut.to >= window.from);
    const choiceKey = cutChoiceKey(incident.key, windowIndex);
    let choice = cutChoices.get(choiceKey);
    if (choice === undefined) {
      choice = { enabled: applied !== undefined, from: toInput(applied?.from ?? window.from), to: toInput(applied?.to ?? window.to) };
      cutChoices.set(choiceKey, choice);
    }
    const current = choice;
    toggle.checked = current.enabled;
    const fields = node("div", "memory-cut-fields");
    fields.hidden = !current.enabled;
    const fileWindow = shown.basedOn.window;
    for (const [side, text] of [
      ["from", "Desde"],
      ["to", "Hasta"],
    ] as const) {
      const id = `memory-cut-${index}-${windowIndex}-${side}`;
      const fieldLabel = node("label", undefined, text);
      fieldLabel.htmlFor = id;
      const field = node("input", `memory-cut-${side}`);
      field.type = "datetime-local";
      field.id = id;
      field.step = "1";
      field.min = toInput(fileWindow.from);
      field.max = toInput(fileWindow.to);
      field.value = current[side];
      field.addEventListener("change", () => {
        current[side] = field.value;
        syncConfirm();
      });
      fields.append(fieldLabel, field);
    }
    fields.append(
      node(
        "p",
        "muted",
        incident.agvId === undefined
          ? "Se quitan todas las lecturas del fichero en ese tiempo, que queda sin cobertura: no cuenta como silencio."
          : `Se quitan solo las lecturas del AGV ${incident.agvId} en ese tiempo; las de los demás AGV se quedan.`,
      ),
    );
    toggle.addEventListener("change", () => {
      current.enabled = toggle.checked;
      fields.hidden = !toggle.checked;
      syncConfirm();
    });
    holder.append(fields);
    return holder;
  }

  /** Los recortes que aplicó esta previsualización (OQ-148), con cuántas lecturas quitó cada uno. */
  function appliedCutsBlock(shown: ConsolidationPreview): readonly HTMLElement[] {
    const cuts = shown.cuts ?? [];
    if (cuts.length === 0) return [];
    const box = node("div", "memory-cuts");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Recortes de ventana");
    box.append(node("p", "memory-cuts-title", `Recortes de ventana en esta previsualización: ${cuts.length}`));
    const list = node("ul", "memory-items memory-incident-list");
    const format = input.formatTick ?? input.formatInstant;
    for (const cut of cuts) {
      const item = node("li");
      item.dataset["key"] = cut.incidentKey;
      const title = (shown.incidents ?? []).find((incident) => incident.key === cut.incidentKey)?.title ?? cut.incidentKey;
      item.append(node("strong", undefined, title), " ", node("span", "memory-cut-applied", cutLine(cut, format)));
      list.append(item);
    }
    box.append(list);
    if (cutNotes.length > 0) {
      const warnings = node("ul", "memory-cut-warnings");
      warnings.setAttribute("aria-label", "Avisos sobre los recortes");
      for (const warning of cutNotes) warnings.append(node("li", undefined, warning));
      box.append(node("p", "memory-cut-warnings-title", "Avisos (no bloquean):"), warnings);
    }
    box.append(
      node(
        "p",
        "muted",
        "La versión se construye sin esas lecturas, desde el fichero original archivado; la instantánea guardada del fichero no cambia. Las incidencias recortadas siguen registradas en la versión.",
      ),
    );
    return [box];
  }

  function incidentsBlock(shown: ConsolidationPreview): readonly HTMLElement[] {
    const incidents = shown.incidents ?? [];
    if (incidents.length === 0) return [];
    const box = node("div", "memory-incidents");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Incidencias excluidas del esperado");
    box.append(node("h4", undefined, "Incidencias excluidas del esperado"));
    box.append(
      node(
        "p",
        "muted",
        "Hallazgos confirmados que pueden parar la planta. El periodo se consolida entero; cada incidencia se guarda aparte y lo que toca no entra en las estadísticas del esperado, que conserva su valor anterior o queda sin medida.",
      ),
    );
    const list = node("ul", "memory-items memory-incident-list");
    let withWindow = 0;
    incidents.forEach((incident, index) => {
      const item = node("li");
      item.dataset["key"] = incident.key;
      item.append(node("strong", undefined, incident.title), " ", node("span", "muted", incident.figure), " — ");
      const when = incidentWhen(incident, input.formatTick ?? input.formatInstant);
      if (when !== "") item.append(node("span", "memory-incident-window", when), " · ");
      item.append(node("span", undefined, incidentReach(incident)));
      const windows = incidentWindows(incident);
      if (windows.length > 0) {
        withWindow += 1;
        // Una fila por ventana: con varias paradas, cada una se recorta (o no) por su cuenta (OQ-155).
        const rows = node("div", "memory-cut-rows");
        windows.forEach((window, windowIndex) => rows.append(cutControls(incident, window, shown, index, windowIndex, windows.length)));
        item.append(rows);
      }
      list.append(item);
    });
    box.append(list);
    if (withWindow > 0 && shown.originalArchived === true && input.toDateTimeInput !== undefined && input.fromDateTimeInput !== undefined) {
      const again = sender("Volver a previsualizar con el recorte", "memory-cut-preview");
      again.addEventListener("click", () => {
        const chosen = chosenCuts(shown);
        if ("error" in chosen) {
          status = { kind: "error", lines: [chosen.error, "Corrige el recorte y vuelve a previsualizar."] };
          paintStatus();
          return;
        }
        status = null;
        paintStatus();
        input.preview(shown.basedOn.sourceId, chosen.cuts.length === 0 ? undefined : chosen.cuts);
      });
      box.append(again);
    }
    box.append(...appliedCutsBlock(shown));
    return [box];
  }

  /** Los cambios de una clase: el hecho y la razón de su clase. Plegado si son muchos. */
  function changeGroup(cls: ChangeClass, group: readonly ClassifiedChange[]): HTMLElement {
    const label = CHANGE_CLASS_LABEL[cls];
    const details = node("details", "memory-change-group");
    details.dataset["class"] = cls;
    details.open = group.length <= 5 && cls !== "evento-puntual";
    details.append(node("summary", undefined, `${label.text}: ${group.length} — ${label.adopted ? "pasan al esperado" : "no pasan al esperado"}`));
    const list = node("ul", "memory-items");
    const shown = group.slice(0, 30);
    for (const change of shown) {
      const item = node("li");
      item.dataset["key"] = change.key;
      item.append(node("span", undefined, change.detail), " ", node("span", "muted", change.reason));
      list.append(item);
    }
    if (group.length > shown.length) list.append(node("li", "muted", `y ${group.length - shown.length} más`));
    details.append(list);
    return details;
  }

  function changesBlock(shown: ConsolidationPreview): readonly HTMLElement[] {
    const box = node("div", "memory-changes");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Cambios frente al esperado");
    box.append(node("h4", undefined, "Cambios frente al esperado"));
    if (shown.previous === null) {
      box.append(node("p", "muted", "Primera versión: no hay esperado anterior. El esperado será lo observado, salvo lo que toque una incidencia."));
      return [box];
    }
    if (shown.changes === undefined) {
      box.append(node("p", "muted", "Esta previsualización no clasifica los cambios; el delta de abajo los enseña sin clase."));
      return [box];
    }
    box.append(
      node(
        "p",
        "muted",
        "Un cambio no sustituye enseguida al esperado. Solo pasan los colectivos y sostenidos y los que una persona confirmó con el plano físico; los demás quedan fuera y el esperado conserva su valor anterior.",
      ),
    );
    if (shown.changes.length === 0) {
      box.append(node("p", undefined, "Ningún cambio frente al esperado vigente."));
      return [box];
    }
    for (const cls of CHANGE_CLASSES) {
      const group = shown.changes.filter((change) => change.cls === cls);
      if (group.length > 0) box.append(changeGroup(cls, group));
    }
    return [box];
  }

  function previewBlock(shown: ConsolidationPreview): HTMLElement {
    const box = node("div", "memory-preview");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", `Previsualización de la versión v${shown.nextVersion}`);
    box.append(node("h4", undefined, `Previsualización de v${shown.nextVersion}`));
    box.append(
      node(
        "p",
        "muted",
        `Fichero base: ${shown.basedOn.fileName} (${input.formatWindow(shown.basedOn.window)}). ` +
          (shown.previous === null ? "Sería la primera versión de la memoria." : `Sustituiría como vigente a v${shown.previous.version}, que queda en el historial.`),
      ),
    );

    if (shown.blockers.length > 0) {
      const blockers = node("div", "memory-blockers");
      blockers.append(node("p", "memory-blockers-title", "No se puede consolidar todavía"));
      const list = node("ul");
      for (const blocker of shown.blockers) {
        const item = node("li");
        item.dataset["code"] = blocker.code;
        item.append(node("strong", undefined, BLOCKER_LABEL[blocker.code]), " ", node("span", "muted", blocker.detail));
        if (blocker.code === "hallazgos-pendientes") {
          const link = button("Ir a los hallazgos pendientes", "link-button");
          link.addEventListener("click", () => input.goToPending());
          item.append(" ", link);
        }
        // Un hallazgo se nombra por su título, no por su clave interna (UX_SPEC §4.4); lo demás, tal cual.
        const named = blocker.items.map((key) => shown.decisions.find((decision) => decision.key === key)?.title ?? key);
        if (named.length > 0) item.append(itemsList(named));
        list.append(item);
      }
      blockers.append(list);
      box.append(blockers);
    }

    if (shown.warnings.length > 0) {
      const warnings = node("div", "memory-warnings");
      warnings.append(node("p", undefined, "Avisos (no bloquean):"));
      const list = node("ul");
      for (const warning of shown.warnings) list.append(node("li", undefined, warning));
      warnings.append(list);
      box.append(warnings);
    }

    box.append(...incidentsBlock(shown));
    box.append(decisionsBlock(shown.decisions));
    box.append(...changesBlock(shown));

    box.append(node("h4", undefined, shown.previous === null ? "Frente a la memoria" : `Frente a la versión vigente v${shown.previous.version}`));
    if (shown.delta === null) {
      box.append(node("p", "muted", shown.previous === null ? "Primera versión: no hay memoria anterior con la que comparar." : "Sin comparación con la versión vigente."));
    } else {
      box.append(...deltaView(shown.delta, "Nada cambia frente a la versión vigente: mismos tags, en el mismo sitio, con las mismas horquillas."));
    }
    box.append(node("p", "muted", `Tamaño estimado de la versión: ${kilobytes(shown.estimatedBytes)}.`));

    const actions = node("div", "button-row memory-actions");
    const cancel = button("Cancelar");
    cancel.addEventListener("click", () => {
      preview = null;
      previewHash = null;
      render();
    });
    syncConfirm = () => {};
    cutsDiffer = false;
    if (shown.blockers.length === 0) {
      const noteLabel = node("label", undefined, "Nota (opcional): por qué se consolida este periodo");
      noteLabel.htmlFor = "memory-note";
      const note = node("input", "memory-note");
      note.type = "text";
      note.id = "memory-note";
      note.placeholder = "Periodo normal tras la revisión del turno…";
      box.append(noteLabel, note);
      const confirm = sender("Confirmar y consolidar", "memory-confirm");
      // Con un recorte tocado después de previsualizar, lo que se confirmaría no es lo que se ve.
      const hint = node("p", "muted memory-confirm-hint", "Vuelve a previsualizar con el recorte para confirmar");
      hint.hidden = true;
      syncConfirm = () => {
        cutsDiffer = !cutsMatchShown(shown);
        hint.hidden = !cutsDiffer;
        confirm.disabled = busy || cutsDiffer;
      };
      const hash = previewHash;
      confirm.addEventListener("click", () => {
        // El único sitio de la aplicación que envía `mode: "commit"`: lo pulsa la persona.
        if (hash === null || cutsDiffer) return;
        const text = note.value.trim();
        status = null;
        paintStatus();
        // Con los recortes de esta previsualización, no con lo que se haya tocado después: se consolida lo que se ve.
        const cuts = (shown.cuts ?? []).map(({ removed: _removed, ...cut }) => cut);
        input.commit(shown.basedOn.sourceId, text === "" ? null : text, cuts.length === 0 ? undefined : cuts, hash);
      });
      actions.append(cancel, confirm);
      box.append(hint);
      syncConfirm();
    } else {
      actions.append(cancel);
    }
    box.append(actions);
    return box;
  }

  // --- 4. Versiones ------------------------------------------------------------------------------

  function versionItem(entry: VersionSummary, current: number | null, withRevoke: boolean): HTMLElement {
    const item = node("li", entry.revoked === null ? "memory-version" : "memory-version revoked");
    item.dataset["version"] = String(entry.version);
    const head = node("div", "memory-version-head");
    head.append(node("span", "memory-vn", `v${entry.version}`));
    if (entry.revoked !== null) head.append(node("span", "chip revoked", "revocada"));
    else if (entry.version === current) head.append(node("span", "chip current", "vigente"));
    head.append(
      node(
        "span",
        "muted",
        `${entry.basedOnFileName} · ${input.formatWindow(entry.window)} · consolidada el ${input.formatInstant(entry.createdAt)} · ${decisionsLine(entry.decisions)} · ${kilobytes(entry.bytes)}`,
      ),
    );
    item.append(head);
    const changeSummary = entry.changeSummary;
    if (changeSummary !== undefined) item.append(node("p", "muted memory-version-changes", `${changeSummaryLine(changeSummary)}.`));
    if (entry.note !== null && entry.note !== "") item.append(node("p", "muted", `Nota: ${entry.note}`));
    if (entry.revoked !== null) {
      item.append(node("p", "memory-revoked-reason", `Revocada el ${input.formatInstant(entry.revoked.at)}: ${entry.revoked.reason}`));
    } else if (withRevoke) {
      const holder = node("div", "memory-revoke");
      const open = sender("Revocar…", "memory-revoke-open");
      open.setAttribute("aria-label", `Revocar la versión v${entry.version}`);
      holder.append(open);
      open.addEventListener("click", () => {
        open.hidden = true;
        const form = node("div", "memory-revoke-form");
        const label = node("label", undefined, `Razón de la revocación de v${entry.version} (obligatoria)`);
        const id = `memory-revoke-reason-${entry.version}`;
        label.htmlFor = id;
        const reason = node("input", "memory-revoke-reason");
        reason.type = "text";
        reason.id = id;
        reason.placeholder = "Qué estaba mal en esta versión";
        const send = sender(`Revocar la versión v${entry.version}`, "danger memory-revoke-send");
        send.disabled = true;
        reason.addEventListener("input", () => {
          send.disabled = busy || reason.value.trim() === "";
        });
        send.addEventListener("click", () => {
          const text = reason.value.trim();
          if (text === "") return;
          status = null;
          paintStatus();
          input.revoke(entry.version, text);
        });
        const cancel = button("Cancelar");
        cancel.addEventListener("click", () => {
          form.remove();
          open.hidden = false;
          open.focus();
        });
        const row = node("div", "button-row");
        row.append(send, cancel);
        form.append(label, reason, row);
        holder.append(form);
        reason.focus();
      });
      item.append(holder);
    }
    return item;
  }

  function versionsBlock(memory: MemoryViews | null): readonly HTMLElement[] {
    const out: HTMLElement[] = [node("h3", undefined, "Versiones")];
    if (memory === null || memory.versions.length === 0) {
      out.push(node("p", "muted", "Ninguna versión guardada."));
      return out;
    }
    out.push(
      node(
        "p",
        "muted",
        "Una versión nunca se edita ni se borra. Si está mal, se revoca con su razón y se consolida otra; la revocada sigue aquí, marcada.",
      ),
    );
    const list = node("ul", "memory-versions");
    list.setAttribute("aria-label", "Versiones de la memoria");
    for (const entry of [...memory.versions].sort((a, b) => b.version - a.version)) list.append(versionItem(entry, memory.current, true));
    out.push(list);
    return out;
  }

  // --- 5. Comparar versiones ----------------------------------------------------------------------

  /** Por defecto, la primera y la vigente; si coinciden, la primera y la última. Lo elegido se conserva si sigue en la lista. */
  function compareChoices(versions: readonly VersionSummary[], current: number | null): { readonly from: number; readonly to: number } {
    const numbers = versions.map((entry) => entry.version).sort((a, b) => a - b);
    const first = numbers[0] as number;
    const last = numbers[numbers.length - 1] as number;
    const from = compareFrom !== null && numbers.includes(compareFrom) ? compareFrom : first;
    const defaultTo = current !== null && current !== first ? current : last;
    const to = compareTo !== null && numbers.includes(compareTo) ? compareTo : defaultTo;
    return { from, to };
  }

  function versionSelect(id: string, text: string, versions: readonly VersionSummary[], value: number, onChange: (value: number) => void): readonly HTMLElement[] {
    const label = node("label", undefined, text);
    label.htmlFor = id;
    const select = node("select", "memory-compare-select");
    select.id = id;
    for (const entry of [...versions].sort((a, b) => a.version - b.version)) {
      const option = node("option", undefined, `v${entry.version} — ${entry.basedOnFileName}${entry.revoked === null ? "" : " (revocada)"}`);
      option.value = String(entry.version);
      select.append(option);
    }
    select.value = String(value);
    select.addEventListener("change", () => onChange(Number(select.value)));
    return [label, select];
  }

  function compareBlock(memory: MemoryViews | null): readonly HTMLElement[] {
    if (memory === null || memory.versions.length < 2) return [];
    const box = node("div", "memory-compare");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Comparar versiones");
    box.append(node("h3", undefined, "Comparar versiones"));
    box.append(node("p", "muted", "El esperado de una versión frente al de otra, y lo que se adoptó entre medias. Solo se lee: no cambia la memoria."));
    const choice = compareChoices(memory.versions, memory.current);
    const go = sender("Comparar", "memory-compare-button");
    const sync = (): void => {
      go.disabled = busy || compareFrom === compareTo;
    };
    compareFrom = choice.from;
    compareTo = choice.to;
    const row = node("div", "button-row memory-compare-row");
    row.append(
      ...versionSelect("memory-compare-from", "De", memory.versions, choice.from, (value) => {
        compareFrom = value;
        sync();
      }),
      ...versionSelect("memory-compare-to", "a", memory.versions, choice.to, (value) => {
        compareTo = value;
        sync();
      }),
      go,
    );
    sync();
    go.addEventListener("click", () => {
      if (compareFrom === null || compareTo === null || compareFrom === compareTo) return;
      status = null;
      paintStatus();
      input.compare(compareFrom, compareTo);
    });
    box.append(row);
    if (comparison !== null) box.append(comparisonResult(comparison));
    return [box];
  }

  function comparisonResult(shown: VersionComparison): HTMLElement {
    const box = node("div", "memory-compare-result");
    const end = (side: VersionComparison["from"]): string => `v${side.version} (${side.fileName}, ${input.formatWindow(side.window)})`;
    box.append(node("h4", undefined, `De ${end(shown.from)} a ${end(shown.to)}`));
    const revoked = [shown.from, shown.to].filter((side) => side.revoked).map((side) => `v${side.version}`);
    if (revoked.length > 0) {
      box.append(
        node(
          "p",
          "memory-compare-revoked",
          `${revoked.join(" y ")} ${revoked.length === 1 ? "está revocada" : "están revocadas"}: su esperado no forma parte de la cadena vigente.`,
        ),
      );
    }
    box.append(node("p", "muted memory-compare-between", betweenLine(shown.between)));
    box.append(node("p", "muted", `Del esperado de v${shown.from.version} al de v${shown.to.version}. Hechos, no causas.`));
    box.append(...deltaView(shown.delta, "Mismo esperado en las dos versiones: mismos tags, en el mismo sitio, con las mismas horquillas."));
    box.append(adoptedHistory(shown.adoptedAlongTheWay));
    return box;
  }

  /** «Adoptado en v2: …; en v3: …». Plegado si es largo. */
  function adoptedHistory(steps: VersionComparison["adoptedAlongTheWay"]): HTMLElement {
    const withChanges = steps.filter((step) => step.keys.length > 0);
    if (withChanges.length === 0) return node("p", "memory-compare-history", "Ninguna versión adoptó cambios por el camino.");
    const phrases = withChanges.map(
      (step, index) => `${index === 0 ? "Adoptado en" : "en"} v${step.version}${step.revoked === true ? " (revocada)" : ""}: ${step.keys.map(adoptedChangeText).join(", ")}`,
    );
    const text = `${phrases.join("; ")}.`;
    const total = withChanges.reduce((sum, step) => sum + step.keys.length, 0);
    if (total <= 5) return node("p", "memory-compare-history", text);
    const details = node("details", "memory-compare-history");
    details.append(node("summary", undefined, `Adoptado por el camino: ${total} cambios en ${withChanges.length} ${withChanges.length === 1 ? "versión" : "versiones"}`));
    details.append(node("p", undefined, text));
    return details;
  }

  function budgetLine(memory: MemoryViews | null): HTMLElement {
    const count = memory?.versions.length ?? 0;
    return node(
      "p",
      "muted memory-budget",
      count === 0
        ? "La memoria no ocupa nada todavía."
        : `La memoria ocupa ${kilobytes(memory?.budgetBytes ?? 0)} en ${count} ${count === 1 ? "versión" : "versiones"}.` +
            // Lo guardado de verdad, comprimido, y el archivo de ficheros originales (OQ-145).
            (memory?.storedBytes === undefined ? "" : ` Guardada comprimida: ${kilobytes(memory.storedBytes)}.`) +
            (memory?.archiveBytes === undefined || memory.archiveBytes === 0
              ? ""
              : ` Ficheros originales archivados: ${kilobytes(memory.archiveBytes)}.`),
    );
  }

  // --- 6. Dos linajes ------------------------------------------------------------------------------

  function forkBlock(memory: MemoryViews): readonly HTMLElement[] {
    const fork = memory.fork;
    if (fork === null) return [];
    const box = node("div", "memory-fork");
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Dos linajes");
    box.append(node("h3", undefined, "Dos linajes"));
    box.append(
      node(
        "p",
        undefined,
        "Este dispositivo y el proyecto abierto consolidaron por separado a partir de la misma memoria. No se fusionan: " +
          "elige cuál sigue. El otro queda archivado con su historial, no se borra. Mientras no elijas, no se puede consolidar.",
      ),
    );
    const columns = node("div", "memory-fork-columns");
    for (const [title, versions] of [
      ["Memoria local", fork.local],
      ["Memoria entrante", fork.incoming],
    ] as const) {
      const column = node("div", "memory-fork-column");
      column.append(node("h4", undefined, `${title} (${versions.length} ${versions.length === 1 ? "versión" : "versiones"})`));
      const list = node("ul", "memory-versions");
      for (const entry of versions) list.append(versionItem(entry, null, false));
      column.append(list);
      columns.append(column);
    }
    box.append(columns);
    const label = node("label", undefined, "Razón de la elección (obligatoria)");
    label.htmlFor = "memory-fork-reason";
    const reason = node("input", "memory-fork-reason");
    reason.type = "text";
    reason.id = "memory-fork-reason";
    reason.placeholder = "Por qué sigue este linaje y no el otro";
    const keep = sender("Conservar la memoria local", "memory-fork-keep");
    const adopt = sender("Adoptar la entrante (la local queda archivada)", "memory-fork-adopt");
    keep.disabled = true;
    adopt.disabled = true;
    reason.addEventListener("input", () => {
      const empty = reason.value.trim() === "";
      keep.disabled = busy || empty;
      adopt.disabled = busy || empty;
    });
    const send = (choice: "conservar-local" | "adoptar-entrante") => (): void => {
      const text = reason.value.trim();
      if (text === "") return;
      status = null;
      paintStatus();
      input.resolveFork(choice, text);
    };
    keep.addEventListener("click", send("conservar-local"));
    adopt.addEventListener("click", send("adoptar-entrante"));
    const row = node("div", "button-row");
    row.append(keep, adopt);
    box.append(label, reason, row);
    return [box];
  }

  function lineageEventsBlock(memory: MemoryViews | null): readonly HTMLElement[] {
    if (memory === null || memory.lineageEvents.length === 0) return [];
    const out: HTMLElement[] = [node("h3", undefined, "Elecciones de linaje")];
    const list = node("ul", "memory-lineage-events");
    for (const event of [...memory.lineageEvents].reverse()) {
      const where = event.origin === "otro-dispositivo" ? " (en otro dispositivo)" : "";
      list.append(node("li", undefined, `${input.formatInstant(event.at)}${where}: ${CHOICE_LABEL[event.choice]} — ${event.reason}`));
    }
    out.push(list);
    return out;
  }

  // --- Montaje -------------------------------------------------------------------------------------

  function render(): void {
    senders.length = 0;
    const memory = context.memory;
    body.replaceChildren(
      currentBlock(memory),
      ...(memory === null ? [] : forkBlock(memory)),
      ...comparisonBlock(memory),
      ...consolidateBlock(memory),
      ...versionsBlock(memory),
      ...compareBlock(memory),
      budgetLine(memory),
      ...lineageEventsBlock(memory),
    );
    paintStatus();
  }

  render();

  return {
    node: root,
    update(next) {
      context = next;
      preview = null;
      previewHash = null;
      cutNotes = [];
      cutChoices.clear();
      comparison = null;
      render();
    },
    refresh() {
      // Solo la lista de condiciones: rehacer el panel entero borraría la nota escrita y el foco.
      const current = body.querySelector(".memory-checks");
      if (current === null) {
        render();
        return;
      }
      current.replaceWith(checksList(context.memory));
    },
    showPreview(next, hash, warnings) {
      preview = next;
      previewHash = hash;
      cutNotes = warnings;
      render();
      body.querySelector<HTMLElement>(".memory-preview h4")?.scrollIntoView({ block: "start" });
    },
    showConsolidated(version, memory) {
      context = { ...context, memory };
      preview = null;
      previewHash = null;
      cutChoices.clear();
      comparison = null;
      const cuts = version.cuts ?? [];
      status = {
        kind: "info",
        lines: [
          `Versión v${version.version} consolidada.`,
          `Base: ${version.basedOn.fileName}; ${version.decisions.length} decisiones; ${kilobytes(memory.budgetBytes)} en total.`,
          ...(cuts.length === 0
            ? []
            : [`Con ${cuts.length} ${cuts.length === 1 ? "recorte" : "recortes"} de ventana: ${cuts.reduce((sum, cut) => sum + cut.removed, 0)} lecturas fuera de la versión.`]),
        ],
      };
      render();
    },
    showRevoked(version, memory) {
      context = { ...context, memory };
      preview = null;
      comparison = null;
      status = {
        kind: "info",
        lines: [`Versión v${version} revocada.`, memory.current === null ? "No queda ninguna versión vigente." : `La vigente pasa a ser v${memory.current}.`],
      };
      render();
    },
    showForkResolved(memory) {
      context = { ...context, memory };
      preview = null;
      comparison = null;
      status = { kind: "info", lines: ["Linaje elegido. La elección y su razón quedan en el historial."] };
      render();
    },
    showComparison(next) {
      comparison = next;
      compareFrom = next.from.version;
      compareTo = next.to.version;
      render();
      body.querySelector<HTMLElement>(".memory-compare-result h4")?.scrollIntoView({ block: "start" });
    },
    showError(cause, recovery) {
      status = { kind: "error", lines: [`No se pudo completar la operación: ${cause}`, recovery] };
      paintStatus();
      applyBusy(busy);
    },
    notice(line) {
      status = { kind: "info", lines: [line] };
      paintStatus();
    },
    setBusy(next) {
      busy = next;
      applyBusy(next);
    },
  };

  /** Apaga los botones que hablan con el Worker mientras responde; los que exigen razón escrita siguen apagados hasta que la haya. */
  function applyBusy(next: boolean): void {
    for (const control of senders) {
      if (control.classList.contains("memory-revoke-send") || control.classList.contains("memory-fork-keep") || control.classList.contains("memory-fork-adopt")) {
        const reason = control.closest(".memory-revoke-form, .memory-fork")?.querySelector<HTMLInputElement>("input");
        control.disabled = next || (reason?.value.trim() ?? "") === "";
      } else if (control.classList.contains("memory-compare-button")) {
        control.disabled = next || compareFrom === compareTo;
      } else if (control.classList.contains("memory-preview-button")) {
        control.disabled = next || context.circuitId === null || context.working === null || !context.working.hasSnapshot;
      } else if (control.classList.contains("memory-confirm")) {
        control.disabled = next || cutsDiffer;
      } else {
        control.disabled = next;
      }
    }
  }
}
