/**
 * «Frente al periodo anterior» en el Resumen (R-DAT-024, R-GRA-023, `UX_SPEC.md` §4.9): qué hallazgos
 * del periodo anterior ya no aparecen, siguen o son nuevos; qué tags, AGV y tramos de WiFi leen o
 * cortan distinto de lo que da el azar; las sustituciones con lo que hereda el tag nuevo; y cuándo se
 * cargó por última vez cada dato declarado, para que lo que no se aportó con este periodo no se lea
 * como «sin cambios».
 */

import type { CircuitViews } from "../application/protocol.js";
import type { FindingComparison, RateChange } from "../domain/period-comparison.js";
import { REVIEW_LABEL } from "../domain/review.js";
import { roleText, type InheritedRole } from "../domain/substitution.js";

type Comparison = NonNullable<CircuitViews["comparison"]>;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Cuántos se enseñan de cada lista antes de «y N más». */
const SHOWN = 12;

const count = (value: number, one: string, many: string): string => `${value.toLocaleString("es-ES")} ${value === 1 ? one : many}`;
const percent = (part: number, total: number): string => (total === 0 ? "—" : `${Math.round((100 * part) / total)} %`);

/** «70 % → 99 % de lectura (200 → 180 pasadas)». Puro. */
export function readShift(change: RateChange): string {
  const before = percent(change.before.passes - change.before.misses, change.before.passes);
  const after = percent(change.after.passes - change.after.misses, change.after.passes);
  return `${before} → ${after} de lectura (${change.before.passes.toLocaleString("es-ES")} → ${change.after.passes.toLocaleString("es-ES")} pasadas)`;
}

/** «13 % → 1 % de pasadas con corte». Puro. */
export function cutShift(change: RateChange): string {
  return `${percent(change.before.misses, change.before.passes)} → ${percent(change.after.misses, change.after.passes)} de pasadas con corte (${change.before.passes.toLocaleString("es-ES")} → ${change.after.passes.toLocaleString("es-ES")} pasadas)`;
}

/** El recuento de los hallazgos por destino, en una línea. Puro. */
export function findingsLine(findings: readonly FindingComparison[]): string {
  const of = (fate: FindingComparison["fate"]): number => findings.filter((entry) => entry.fate === fate).length;
  const parts = [
    `${count(of("ya-no-aparece"), "ya no aparece", "ya no aparecen")}`,
    `${count(of("sigue"), "sigue", "siguen")}`,
    `${count(of("nuevo"), "nuevo", "nuevos")}`,
  ];
  const unjudged = of("sin-ocasion");
  if (unjudged > 0) parts.push(`${count(unjudged, "sin ocasión de repetirse", "sin ocasión de repetirse")}`);
  return parts.join(" · ");
}

/** Una sustitución en palabras, con lo que hereda o heredaría. Pura. */
export function substitutionLine(
  substitution: Comparison["substitutions"][number],
  roles: readonly InheritedRole[],
  format: (utcMs: number) => string,
): string {
  const own = roles.filter((role) => role.oldTagId === substitution.oldTagId && role.newTagId === substitution.newTagId);
  const inherited = own.map(roleText).join("; ");
  const head = `${substitution.oldTagId} → ${substitution.newTagId}`;
  if (substitution.status === "confirmada") {
    const where = `confirmada en el plano${substitution.locationId === null ? "" : ` (${substitution.locationId})`}${substitution.at === null ? "" : ` el ${format(substitution.at)}`}`;
    return own.length === 0 ? `${head}, ${where}: el sustituido no tenía nada declarado que heredar.` : `${head}, ${where}: hereda ${inherited}.`;
  }
  const when = substitution.at === null ? "" : ` desde ${format(substitution.at)}`;
  return own.length === 0
    ? `${head}, detectada en las lecturas${when}, sin confirmar: el sustituido no tenía nada declarado.`
    : `${head}, detectada en las lecturas${when}, sin confirmar: heredaría ${inherited} al confirmarla en el plano (Memoria → Plano del circuito).`;
}

/** Lo último que se cargó de cada dato declarado. Pura. */
export function suppliedLines(supplied: Comparison["supplied"], format: (utcMs: number) => string): readonly { readonly label: string; readonly text: string }[] {
  return [
    {
      label: "Listas",
      text:
        supplied.lists.length === 0
          ? "Ninguna cargada."
          : supplied.lists.map((entry) => `${entry.list}, ${format(entry.loadedAt)}`).join(" · "),
    },
    { label: "Flota", text: supplied.fleet === null ? "Sin historial de flota." : `Última carga: ${format(supplied.fleet.loadedAt)}.` },
    {
      label: "WiFi",
      text:
        supplied.connections === null
          ? "Sin registro de conexiones."
          : `Última actualización: ${format(supplied.connections.loadedAt)}${supplied.connections.until === null ? "" : `, con eventos hasta ${format(supplied.connections.until)}`}.`,
    },
  ];
}

function changeList(changes: readonly RateChange[], describe: (change: RateChange) => string, label: (change: RateChange) => string): HTMLElement {
  const list = element("ul", "comparison-list");
  for (const change of changes.slice(0, SHOWN)) list.append(element("li", undefined, `${label(change)}: ${describe(change)}`));
  if (changes.length > SHOWN) list.append(element("li", "muted", `y ${changes.length - SHOWN} más`));
  return list;
}

function rateBlock(
  host: HTMLElement,
  title: string,
  result: { readonly better: readonly RateChange[]; readonly worse: readonly RateChange[]; readonly compared: number },
  betterText: string,
  worseText: string,
  noun: (n: number) => string,
  label: (change: RateChange) => string,
): void {
  host.append(element("h4", undefined, title));
  if (result.compared === 0) {
    host.append(element("p", "muted", `Ningún ${noun(1)} con pasadas en los dos periodos: no hay con qué comparar.`));
    return;
  }
  if (result.better.length === 0 && result.worse.length === 0) {
    host.append(element("p", "muted", `Ninguno cambia más de lo que da el azar (${count(result.compared, noun(1), noun(2))} comparados).`));
    return;
  }
  if (result.better.length > 0) {
    host.append(element("p", "comparison-better", `${betterText} (${result.better.length}):`), changeList(result.better, title === "WiFi" ? cutShift : readShift, label));
  }
  if (result.worse.length > 0) {
    host.append(element("p", "comparison-worse", `${worseText} (${result.worse.length}):`), changeList(result.worse, title === "WiFi" ? cutShift : readShift, label));
  }
}

function findingGroup(title: string, entries: readonly FindingComparison[], open: boolean, describe: (entry: FindingComparison) => string): HTMLElement {
  const group = element("details", "comparison-findings");
  group.open = open && entries.length > 0;
  group.append(element("summary", undefined, `${title} (${entries.length})`));
  if (entries.length === 0) {
    group.append(element("p", "muted", "Ninguno."));
    return group;
  }
  const list = element("ul", "comparison-list");
  for (const entry of entries.slice(0, SHOWN)) {
    const review = entry.review === null ? "" : ` · revisión en campo: ${REVIEW_LABEL[entry.review].text.toLowerCase()}`;
    const item = element("li", undefined, `${entry.title} — ${describe(entry)}${review}`);
    item.dataset["reviewKey"] = entry.key;
    list.append(item);
  }
  if (entries.length > SHOWN) list.append(element("li", "muted", `y ${entries.length - SHOWN} más`));
  group.append(list);
  return group;
}

export function comparisonSection(comparison: Comparison, format: (utcMs: number) => string): HTMLElement {
  const node = element("section", "comparison");
  node.append(element("h3", undefined, "Frente al periodo anterior"));
  const periods = comparison.periods;
  if (periods === null) {
    node.append(element("p", "muted", "Es el primer periodo con instantánea de este análisis: todavía no hay un periodo anterior con que comparar."));
  } else {
    node.append(
      element(
        "p",
        undefined,
        `«${periods.after.fileName}» (de ${format(periods.after.from)} a ${format(periods.after.to)}) frente a «${periods.before.fileName}» (de ${format(periods.before.from)} a ${format(periods.before.to)}).`,
      ),
    );
    node.append(element("h4", undefined, "Hallazgos"), element("p", "muted", findingsLine(periods.findings)));
    const of = (fate: FindingComparison["fate"]): readonly FindingComparison[] => periods.findings.filter((entry) => entry.fate === fate);
    node.append(
      findingGroup("Ya no aparecen", of("ya-no-aparece"), true, (entry) => `antes ${entry.figureBefore ?? "—"}, ahora no se repite`),
      findingGroup("Nuevos", of("nuevo"), true, (entry) => `ahora ${entry.figureAfter ?? "—"}`),
      findingGroup("Siguen", of("sigue"), false, (entry) => `${entry.figureBefore ?? "—"} → ${entry.figureAfter ?? "—"}`),
      findingGroup("Sin ocasión de repetirse", of("sin-ocasion"), false, () => "su sitio o su AGV no tuvo pasadas en este periodo: no se juzga"),
    );
    rateBlock(node, "Tags", periods.tags, "Leen más", "Leen menos", (n) => (n === 1 ? "tag" : "tags"), (change) => change.id);
    rateBlock(node, "AGV", periods.vehicles, "Leen más", "Leen menos", (n) => (n === 1 ? "AGV" : "AGV"), (change) => `AGV ${change.id}`);
    const wifi = periods.wifi;
    if (wifi.status === "comparado") {
      rateBlock(
        node,
        "WiFi",
        { better: wifi.better, worse: wifi.worse, compared: wifi.segments },
        "Tramos con menos cortes",
        "Tramos con más cortes",
        (n) => (n === 1 ? "tramo" : "tramos"),
        (change) => `${change.id} → ${change.to ?? "?"}`,
      );
    } else {
      node.append(element("h4", undefined, "WiFi"));
      const connections = comparison.supplied.connections;
      const last =
        connections === null
          ? ""
          : ` La última actualización del registro fue el ${format(connections.loadedAt)}${connections.until === null ? "" : `, con eventos hasta ${format(connections.until)}`}.`;
      const text =
        wifi.status === "sin-registro"
          ? "Sin registro de conexiones en ninguno de los dos periodos: no se compara."
          : wifi.status === "sin-referencia"
            ? `El periodo anterior no tenía registro de conexiones: no hay con qué comparar.${last}`
            : `Sin registro de conexiones en este periodo: no se compara, y no significa «sin cambios».${last}`;
      node.append(element("p", "muted", text));
    }
  }

  node.append(element("h4", undefined, "Sustituciones de tag"));
  if (comparison.substitutions.length === 0) {
    node.append(element("p", "muted", "Ninguna confirmada en el plano ni detectada en las lecturas."));
  } else {
    const list = element("ul", "comparison-list");
    for (const substitution of comparison.substitutions.slice(0, SHOWN)) {
      list.append(element("li", substitution.status === "confirmada" ? undefined : "muted", substitutionLine(substitution, comparison.roles, format)));
    }
    if (comparison.substitutions.length > SHOWN) list.append(element("li", "muted", `y ${comparison.substitutions.length - SHOWN} más`));
    node.append(list);
  }

  node.append(element("h4", undefined, "Información aportada"));
  const facts = element("dl", "facts");
  for (const line of suppliedLines(comparison.supplied, format)) facts.append(element("dt", undefined, line.label), element("dd", undefined, line.text));
  node.append(facts);
  return node;
}
