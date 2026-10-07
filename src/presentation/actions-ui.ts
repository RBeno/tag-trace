/**
 * «Acciones de los tags» (DS-014, R-AGV-023, R-AGV-024), en su propio módulo como el wifi.
 *
 * Dos piezas en la pestaña Tags: los **avisos para verificar** —tags con lecturas «No ejecutado» y
 * lecturas «No en memoria»—, como tarjetas revisables que van a la bandeja; y el **catálogo** de la
 * acción de cada tag por MTC, como tabla en el cajón. No hay consecuencias de no leer un tag: el
 * propietario pidió no incorporarlas aún.
 */

import type { CircuitViews } from "../application/protocol.js";
import { CARDS_SHOWN } from "../domain/finding-kinds.js";
import { lazyTable, plainTable } from "./charts.js";

export interface ActionsUiDeps {
  readonly finding: (title: string, figure: string, evidence: string, review?: readonly string[]) => HTMLElement;
  readonly formatInstant: (utcMs: number) => string;
}

type ActionsView = NonNullable<CircuitViews["tagActions"]>;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const mtcLabel = (mtc: string): string => (mtc === "" ? "normal" : `MTC ${mtc}`);

const PATTERN_TITLE: Readonly<Record<string, string>> = {
  nunca: "Tag que no se ejecuta nunca",
  "solo-sin-wifi": "Tag que solo se ejecuta sin wifi",
  "segun-mtc": "Tag que se ejecuta según el MTC",
  "sin-patron": "Tag no ejecutado",
};

function catalogTable(view: ActionsView): HTMLElement {
  return plainTable(
    ["Tag", "MTC", "Orden", "Pin", "Giro", "Mapa", "Vel. (m/min)", "Espera (s)", "Baliza", "Lecturas", "Otras acciones", "No ejecutado", "No en memoria"],
    view.catalog.map((entry) => [
      entry.tagId,
      mtcLabel(entry.mtc),
      entry.kind,
      entry.pin ?? "",
      entry.turn ?? "",
      entry.map ?? "",
      entry.speedMPerMin === null ? "" : String(entry.speedMPerMin),
      entry.waitS === null ? "" : String(entry.waitS),
      entry.beacon ?? "",
      String(entry.reads),
      entry.variants === 0 ? "" : String(entry.variants),
      entry.notExecuted === 0 ? "" : String(entry.notExecuted),
      entry.notInMemory === 0 ? "" : String(entry.notInMemory),
    ]),
  );
}

export function renderTagActions(out: HTMLElement, views: CircuitViews, deps: ActionsUiDeps): void {
  const view = views.tagActions;
  if (view === undefined) return;
  out.append(node("h3", undefined, "Acciones de los tags"));
  const pairs = view.catalog.length;
  const tags = new Set(view.catalog.map((entry) => entry.tagId)).size;
  out.append(
    node(
      "p",
      "muted",
      `Lo que ordena cada tag según las lecturas con acciones de ${view.agvs.length} AGV (${view.agvs.join(", ")}): ` +
        `${tags} tags en ${pairs} combinaciones de tag y MTC, porque la acción de un tag puede cambiar con el MTC. ` +
        "Es lo que registró el vehículo, no la función declarada en las listas. Las marcas «No ejecutado» y " +
        "«No en memoria» se avisan para verificarlas en planta: el programa no decide si son un fallo.",
    ),
  );

  if (view.notExecuted.length === 0 && view.notInMemory.length === 0) {
    out.append(node("p", "muted", "Ninguna lectura «No ejecutado» ni «No en memoria»."));
  }
  for (const notice of view.notExecuted.slice(0, CARDS_SHOWN.perKind)) {
    const mtcs = notice.byMtc.map((entry) => `${mtcLabel(entry.mtc)}: ${entry.notExecuted} de ${entry.reads}`).join(" · ");
    out.append(
      deps.finding(
        `${PATTERN_TITLE[notice.pattern] ?? "Tag no ejecutado"}: ${notice.tagId}`,
        `${notice.notExecuted} de ${notice.reads} lecturas`,
        `${notice.evidence} Por MTC: ${mtcs}. AGV: ${notice.agvs.join(", ")}.`,
        ["tag-no-ejecutado", notice.tagId],
      ),
    );
  }
  if (view.notExecuted.length > CARDS_SHOWN.perKind) {
    out.append(
      lazyTable(`Los ${view.notExecuted.length} tags con lecturas «No ejecutado»`, () =>
        plainTable(
          ["Tag", "No ejecutado", "Lecturas", "Patrón", "Lectura"],
          view.notExecuted.map((notice) => [notice.tagId, String(notice.notExecuted), String(notice.reads), notice.pattern, notice.evidence]),
        ),
      ),
    );
  }
  for (const notice of view.notInMemory.slice(0, CARDS_SHOWN.perKind)) {
    const first = notice.reads[0];
    out.append(
      deps.finding(
        `Lectura fuera de memoria: ${notice.tagId}`,
        `${notice.reads.length} ${notice.reads.length === 1 ? "lectura" : "lecturas"}`,
        `${notice.evidence}${first === undefined ? "" : ` Primera: ${deps.formatInstant(first.utcMs)}, AGV ${first.agvId}, ${mtcLabel(first.mtc)}.`}`,
        ["lectura-no-en-memoria", notice.tagId],
      ),
    );
  }
  if (view.notInMemory.length > CARDS_SHOWN.perKind) {
    out.append(
      lazyTable(`Las lecturas «No en memoria» de ${view.notInMemory.length} tags`, () =>
        plainTable(
          ["Tag", "AGV", "Hora", "MTC"],
          view.notInMemory.flatMap((notice) =>
            notice.reads.map((read) => [notice.tagId, read.agvId, deps.formatInstant(read.utcMs), mtcLabel(read.mtc)]),
          ),
        ),
      ),
    );
  }
  out.append(lazyTable(`Catálogo de acciones por tag y MTC (${pairs})`, () => catalogTable(view)));
}
