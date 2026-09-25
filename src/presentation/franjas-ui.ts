/**
 * «Mediciones por fichero» (R-TIM-011), en su propio módulo como la revisión en campo: `main.ts` ya
 * es muy largo, y esta sección solo necesita de él cómo se dibuja una tarjeta y cómo se escribe una
 * hora.
 *
 * Una franja es un fichero. Cada uno se mide por separado; la sección enseña la tabla de ficheros con
 * su CSV, el anillo en tiempo y los tramos que cambian de un fichero a otro. Nada de esto se guarda
 * como referencia: se rehace en cada importación (consolidar es F4).
 */

import type { CircuitViews } from "../application/protocol.js";
import { franjaCsv, type HistoryKind } from "../domain/franjas.js";
import { plainTable, scrollBox } from "./charts.js";
import { ringTimeChart, segmentHistoryChart, type RingTimeRow, type SegmentHistoryPanel } from "./diagnostic-charts.js";

export interface FranjaUiDeps {
  readonly finding: (title: string, figure: string, evidence: string, review?: readonly string[]) => HTMLElement;
  readonly formatInstant: (utcMs: number) => string;
  readonly formatTick: (utcMs: number) => string;
  readonly duration: (ms: number | null) => string;
  readonly circuitId: string | null;
}

/** Tarjetas de tramo que cambian, de entrada. Parámetro de pantalla. */
const PER_KIND = 5;
/** Paneles de historia dibujados, como mucho. Parámetro de pantalla. */
const HISTORY_PANELS = 9;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className !== undefined) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

const KIND_TEXT: Readonly<Record<HistoryKind, string>> = {
  escalon: "Un único salto que se mantiene en los ficheros siguientes: el tramo cambió en ese fichero.",
  deriva: "Sin un salto entre dos ficheros seguidos, pero moviéndose siempre hacia el mismo lado: se va alargando o acortando poco a poco.",
  cambio: "Con dos ficheros no se distingue un escalón de una deriva: hace falta un tercero.",
};

function download(fileName: string, csv: string): void {
  // Con BOM y `;`: lo abre una hoja de cálculo en español sin preguntar ni romper tildes.
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function renderFranjas(panel: HTMLElement, views: CircuitViews, deps: FranjaUiDeps): void {
  const { sources, cohorts } = views.franjas;
  if (sources.length === 0 || cohorts.length === 0) return;
  const hours = (ms: number): string => `${(ms / 3_600_000).toFixed(1).replace(".", ",")} h`;
  const labelOf = new Map(sources.map((source) => [source.sourceId, source.fileName]));
  const measured = sources.filter((source) => source.duplicateOf === null);

  panel.append(node("h3", undefined, "Mediciones por fichero"));
  panel.append(
    node(
      "p",
      "muted",
      `${measured.length} ${measured.length === 1 ? "fichero medido" : "ficheros medidos"}, cada uno por separado con sus ` +
        "propias lecturas: la horquilla de cada tramo y la posición en tiempo de cada tag. Se rehacen en cada " +
        "importación y se descargan en CSV; guardarlas como referencia y compararlas mes a mes es la memoria del " +
        "circuito (F4).",
    ),
  );
  const repeated = sources.filter((source) => source.duplicateOf !== null);
  if (repeated.length > 0) {
    panel.append(
      node(
        "p",
        "muted",
        `Repetidos, medidos una sola vez: ${repeated
          .map((source) => `«${source.fileName}» (igual que «${labelOf.get(source.duplicateOf ?? "") ?? "—"}»)`)
          .join(", ")}.`,
      ),
    );
  }

  for (const cohort of cohorts) {
    if (cohorts.length > 1) panel.append(node("p", "muted", `Circuito ${cohort.cohortId}:`));
    const bySource = new Map(cohort.measures.map((measure) => [measure.sourceId, measure]));

    // En una caja con desplazamiento, como las demás tablas anchas: en el móvil no cabe y no se parte.
    panel.append(
      scrollBox(
        plainTable(
          ["Fichero", "Ventana", "Producción / noche", "Tags", "Vuelta", "Tramos medidos"],
          measured.map((source) => {
            const measure = bySource.get(source.sourceId);
            return [
              source.fileName,
              `${deps.formatTick(source.from)} → ${deps.formatTick(source.to)}`,
              `${hours(source.exposure.produccionMs)} / ${hours(source.exposure.nocheMs)}`,
              measure === undefined || measure.ring.length === 0 ? "sin anillo" : String(measure.ring.length),
              measure === undefined ? "—" : deps.duration(measure.lapMs),
              measure === undefined ? "—" : String(measure.bands.filter((row) => row.produccion !== null).length),
            ];
          }),
        ),
      ),
    );
    const buttons = node("p", "button-row");
    for (const source of measured) {
      const measure = bySource.get(source.sourceId);
      if (measure === undefined) continue;
      const button = node("button", undefined, `Descargar «${source.fileName}» (CSV)`);
      button.type = "button";
      button.addEventListener("click", () => {
        const base = source.fileName.replace(/\.[^.]+$/, "");
        download(`medicion-${deps.circuitId ?? "circuito"}-${cohort.cohortId}-${base}.csv`, franjaCsv(measure, deps.formatInstant));
      });
      buttons.append(button);
    }
    panel.append(buttons);

    const rows: RingTimeRow[] = cohort.measures
      .filter((measure) => measure.ring.length > 0)
      .map((measure) => ({
        label: labelOf.get(measure.sourceId) ?? measure.sourceId,
        lapMs: measure.lapMs,
        tags: measure.positions.map((position) => ({ tagId: position.tagId, offsetMs: position.offsetMs })),
      }));
    if (rows.length > 0) panel.append(ringTimeChart(rows));
    const unshared = cohort.measures.filter((measure) => measure.ring.length > 0 && !measure.anchorShared);
    if (unshared.length > 0) {
      panel.append(
        node(
          "p",
          "muted",
          `En ${unshared.map((measure) => `«${labelOf.get(measure.sourceId) ?? measure.sourceId}»`).join(", ")} el ancla del ` +
            "circuito no está en el anillo: sus posiciones empiezan en otro tag y no se comparan con las demás.",
        ),
      );
    }

    if (cohort.measures.length < 2) {
      panel.append(node("p", "muted", "Con un solo fichero no hay nada que comparar: la historia de cada tramo necesita dos."));
      continue;
    }
    const histories = cohort.histories.filter((history) => history.regime === "produccion");
    if (histories.length === 0) {
      panel.append(node("p", "muted", "Ningún tramo cambia de horquilla de un fichero a otro, en producción."));
      continue;
    }
    for (const history of histories.slice(0, PER_KIND)) {
      const first = history.points[0];
      const last = history.points[history.points.length - 1];
      const at = history.atSourceId === null ? null : (labelOf.get(history.atSourceId) ?? history.atSourceId);
      const direction = history.direction === "mas-lento" ? "más lento" : "más rápido";
      panel.append(
        deps.finding(
          `${history.from} → ${history.to}: ${direction}${at === null ? " poco a poco" : ` desde «${at}»`}`,
          `La mitad de las pasadas tardaba ${deps.duration(first?.p50Ms ?? null)} y ahora ${deps.duration(last?.p50Ms ?? null)} ` +
            `(${history.points.length} ficheros)`,
          `${KIND_TEXT[history.kind]} Comparado dentro de producción, con la regla de la horquilla: la mitad de un fichero ` +
            "frente al 80 % del otro.",
          ["tramo-entre-ficheros", `${history.from} ${history.to}`],
        ),
      );
    }
    const panels: SegmentHistoryPanel[] = histories.slice(0, HISTORY_PANELS).map((history) => ({
      title: `${history.from} → ${history.to}`,
      atLabel: history.atSourceId === null ? null : (labelOf.get(history.atSourceId) ?? history.atSourceId),
      points: history.points.map((point) => ({ ...point, label: labelOf.get(point.sourceId) ?? point.sourceId })),
    }));
    panel.append(segmentHistoryChart(panels));
  }
}
