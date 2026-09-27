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
import type { BlockerCode, ConsolidatedVersion, ConsolidationPreview, LineageRelation, MemoryDecision, VersionComparison } from "../domain/memory.js";
import { REVIEW_LABEL, REVIEW_STATES, type ReviewState } from "../domain/review.js";
import { deltaView } from "./evolution.js";

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

/** Lo que toca una incidencia, en palabras: sus tags y cuántos tramos. */
export function incidentReach(incident: IncidentRecord): string {
  const tags = incident.subjects.filter((key) => key.startsWith("vertice|")).map((key) => key.slice("vertice|".length));
  // Un tramo en dos regímenes es el mismo tramo.
  const edges = new Set(incident.subjects.filter((key) => key.startsWith("arista|")).map((key) => key.split("|").slice(1, 3).join("→"))).size;
  if (tags.length === 0) return "no toca ningún tag del anillo: el esperado no cambia por ella";
  return `toca ${tags.join(", ")} y ${edges} ${edges === 1 ? "tramo" : "tramos"}: quedan fuera de las estadísticas del esperado`;
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
const REGIME_WORDS: Readonly<Record<string, string>> = { produccion: "producción", noche: "noche" };

export function adoptedChangeText(key: string): string {
  const parts = key.split("|");
  if (parts[0] === "vertice" && parts.length === 3) return `${parts[1]} ${CHANGE_WORDS[parts[2] as string] ?? parts[2]}`;
  if (parts[0] === "arista" && parts.length === 5) {
    return `tramo ${parts[1]} → ${parts[2]} ${CHANGE_WORDS[parts[4] as string] ?? parts[4]} (${REGIME_WORDS[parts[3] as string] ?? parts[3]})`;
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
  readonly findings: () => FindingsStatus | null;
  /** Lleva a la bandeja del Resumen, filtrada por pendientes si se puede. */
  readonly goToPending: () => void;
  readonly preview: (sourceId: string) => void;
  /** Solo lo llama el botón «Confirmar y consolidar». */
  readonly commit: (sourceId: string, note: string | null) => void;
  readonly revoke: (version: number, reason: string) => void;
  readonly resolveFork: (choice: "conservar-local" | "adoptar-entrante", reason: string) => void;
  /** Pide al Worker el esperado de `from` frente al de `to`. Solo lee. */
  readonly compare: (from: number, to: number) => void;
}

export interface MemoryPanel {
  readonly node: HTMLElement;
  /** Con cada análisis: la memoria que traen las vistas, el circuito y el fichero de trabajo. */
  update(context: MemoryContext): void;
  /** Vuelve a pintar con lo mismo: la lista de condiciones lee la bandeja, que cambia con cada marca de revisión. */
  refresh(): void;
  showPreview(preview: ConsolidationPreview): void;
  showConsolidated(version: ConsolidatedVersion, memory: MemoryViews): void;
  showRevoked(version: number, memory: MemoryViews): void;
  showForkResolved(memory: MemoryViews): void;
  showComparison(comparison: VersionComparison): void;
  showError(cause: string, recovery: string): void;
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
  let status: { readonly kind: "info" | "error"; readonly lines: readonly string[] } | null = null;
  let busy = false;
  /** Lo elegido en «Comparar versiones» y la última comparación recibida. */
  let compareFrom: number | null = null;
  let compareTo: number | null = null;
  let comparison: VersionComparison | null = null;
  /** Los botones que hablan con el Worker, para apagarlos mientras responde. */
  const senders: HTMLButtonElement[] = [];

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
    out.push(checks);

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

  function incidentsBlock(incidents: readonly IncidentRecord[]): readonly HTMLElement[] {
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
    const list = node("ul", "memory-items");
    for (const incident of incidents) {
      const item = node("li");
      item.dataset["key"] = incident.key;
      item.append(node("strong", undefined, incident.title), " ", node("span", "muted", incident.figure), " — ", node("span", undefined, incidentReach(incident)));
      list.append(item);
    }
    box.append(list);
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

    box.append(...incidentsBlock(shown.incidents ?? []));
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
      render();
    });
    if (shown.blockers.length === 0) {
      const noteLabel = node("label", undefined, "Nota (opcional): por qué se consolida este periodo");
      noteLabel.htmlFor = "memory-note";
      const note = node("input", "memory-note");
      note.type = "text";
      note.id = "memory-note";
      note.placeholder = "Periodo normal tras la revisión del turno…";
      box.append(noteLabel, note);
      const confirm = sender("Confirmar y consolidar", "memory-confirm");
      confirm.addEventListener("click", () => {
        // El único sitio de la aplicación que envía `mode: "commit"`: lo pulsa la persona.
        const text = note.value.trim();
        status = null;
        paintStatus();
        input.commit(shown.basedOn.sourceId, text === "" ? null : text);
      });
      actions.append(cancel, confirm);
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
      comparison = null;
      render();
    },
    refresh() {
      render();
    },
    showPreview(next) {
      preview = next;
      render();
      body.querySelector<HTMLElement>(".memory-preview h4")?.scrollIntoView({ block: "start" });
    },
    showConsolidated(version, memory) {
      context = { ...context, memory };
      preview = null;
      comparison = null;
      status = { kind: "info", lines: [`Versión v${version.version} consolidada.`, `Base: ${version.basedOn.fileName}; ${version.decisions.length} decisiones; ${kilobytes(memory.budgetBytes)} en total.`] };
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
      } else {
        control.disabled = next;
      }
    }
  }
}
