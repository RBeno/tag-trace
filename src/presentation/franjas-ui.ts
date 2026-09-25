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
import type { AnchorGapChange, StructureChange } from "../domain/anchor-sums.js";
import { franjaCsv, type HistoryKind } from "../domain/franjas.js";
import { paceCsv } from "../domain/vehicle-pace.js";
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

/** Tarjetas de cambio de estructura entre ficheros, de entrada. Parámetro de pantalla. */
const STRUCTURE_CARDS = 5;

/** Qué es cada cambio, con la tabla aprobada por el propietario (R-DAT-021). Nunca una causa. */
function changeLabel(change: StructureChange, gap: AnchorGapChange): string {
  const summed = gap.sum === "mas-lento" || gap.sum === "mas-rapido";
  switch (change.kind) {
    case "insertado":
      return summed ? "tag nuevo que cambia el recorrido: revisar su configuración" : "tag nuevo en la línea";
    case "retirado":
      return `ya no se lee entre ${gap.fromAnchor} y ${gap.toAnchor}`;
    case "sustituido":
      if (change.placement === "otro-punto") return summed ? "se lee en otro punto, y el tramo tiene otro comportamiento" : "se lee en otro punto";
      return summed ? "sustituido, con otro comportamiento del tramo" : "sustituido en su sitio";
  }
}

/** La suma entre las dos anclas, antes y después. */
export function sumLine(gap: AnchorGapChange, duration: (ms: number | null) => string): string {
  const between = `entre ${gap.fromAnchor} y ${gap.toAnchor}`;
  const when = gap.regime === "noche" ? ", de noche" : "";
  switch (gap.sum) {
    case "igual":
      return `La suma ${between} sigue igual${when} (${duration(gap.before.p50Ms)} → ${duration(gap.after.p50Ms)}).`;
    case "mas-lento":
      return `La suma ${between} pasa de ${duration(gap.before.p50Ms)} a ${duration(gap.after.p50Ms)}${when}: tarda más.`;
    case "mas-rapido":
      return `La suma ${between} pasa de ${duration(gap.before.p50Ms)} a ${duration(gap.after.p50Ms)}${when}: tarda menos.`;
    case "sin-medir":
      return (
        `La suma ${between} todavía no se puede comparar: hay ${gap.before.passes} pasadas antes y ${gap.after.passes} ` +
        "después, pero no bastantes del mismo régimen —producción o noche— a los dos lados. Qué tags cambiaron " +
        "ya se ve; si el tramo tarda lo mismo, con unas pasadas más."
      );
  }
}

/** Un cambio en una frase, con su desfase desde la primera ancla. */
function changeText(change: StructureChange, gap: AnchorGapChange, duration: (ms: number | null) => string): string {
  if (change.kind === "sustituido") {
    return (
      `${change.oldTagId} → ${change.newTagId}: ${changeLabel(change, gap)} (${change.oldTagId} a ${duration(change.oldOffsetMs)} de ` +
      `${gap.fromAnchor}; ${change.newTagId} a ${duration(change.newOffsetMs)})`
    );
  }
  return `${change.tagId}: ${changeLabel(change, gap)} (a ${duration(change.offsetMs)} de ${gap.fromAnchor})`;
}

/**
 * La línea que se añade a una tarjeta que ya existe —un tag que empieza o deja de leerse, un cambio de
 * tag, una deriva entre periodos— cuando la suma entre anclas lo sitúa.
 */
export function gapLineFor(tagId: string, gap: AnchorGapChange, duration: (ms: number | null) => string): string {
  const change = gap.changes.find((entry) =>
    entry.kind === "sustituido" ? entry.oldTagId === tagId || entry.newTagId === tagId : entry.tagId === tagId,
  );
  if (change === undefined) return "";
  return ` Entre anclas: ${changeText(change, gap, duration)}. ${sumLine(gap, duration)}`;
}

/** Una tarjeta para un tramo entre anclas con sus cambios. */
export function describeGap(
  gap: AnchorGapChange,
  duration: (ms: number | null) => string,
): { readonly title: string; readonly figure: string; readonly evidence: string } {
  const count = (predicate: (change: StructureChange) => boolean): number => gap.changes.filter(predicate).length;
  const inPlace = count((change) => change.kind === "sustituido" && change.placement === "mismo-sitio");
  const elsewhere = count((change) => change.kind === "sustituido" && change.placement === "otro-punto");
  const added = count((change) => change.kind === "insertado");
  const retired = count((change) => change.kind === "retirado");
  const parts = [
    inPlace === 0 ? "" : `${inPlace} ${inPlace === 1 ? "sustituido" : "sustituidos"} en su sitio`,
    elsewhere === 0 ? "" : `${elsewhere} ${elsewhere === 1 ? "sustituido que se lee" : "sustituidos que se leen"} en otro punto`,
    added === 0 ? "" : `${added} ${added === 1 ? "tag nuevo" : "tags nuevos"}`,
    retired === 0 ? "" : `${retired} ${retired === 1 ? "que ya no se lee" : "que ya no se leen"}`,
  ].filter((part) => part !== "");
  return {
    title: `Entre ${gap.fromAnchor} y ${gap.toAnchor}: ${parts.join(", ")}`,
    figure: sumLine(gap, duration),
    evidence:
      `${gap.changes.map((change) => changeText(change, gap, duration)).join("; ")}. ` +
      `${gap.fromAnchor} y ${gap.toAnchor} siguen en su sitio a los dos lados: son las anclas, y el tiempo entre ellas se ` +
      "conserva si solo cambia lo de en medio (R-DAT-021).",
  };
}

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
      const base = source.fileName.replace(/\.[^.]+$/, "");
      const button = node("button", undefined, `Descargar «${source.fileName}» (CSV)`);
      button.type = "button";
      button.addEventListener("click", () => {
        download(`medicion-${deps.circuitId ?? "circuito"}-${cohort.cohortId}-${base}.csv`, franjaCsv(measure, deps.formatInstant));
      });
      // El ritmo de cada AGV en ese fichero (R-AGV-019, R-AGV-020): un segundo CSV.
      const paceButton = node("button", undefined, `Descargar ritmo de «${source.fileName}» (CSV)`);
      paceButton.type = "button";
      paceButton.addEventListener("click", () => {
        download(`ritmo-${deps.circuitId ?? "circuito"}-${cohort.cohortId}-${base}.csv`, paceCsv(measure.pace));
      });
      buttons.append(button, paceButton);
    }
    panel.append(buttons);

    // Lo que cambia de un fichero al siguiente se marca en los dos: lo nuevo en el de después y lo que
    // ya no se lee en el de antes. Lo que cambia dentro de un fichero, en ese mismo fichero, con la hora
    // (R-DAT-021); su tarjeta está en «Cambios de tag».
    const between = cohort.structure.filter((set) => set.source === "entre-ficheros");
    const marks = new Map<string, { mark: "nuevo" | "retirado" | "sustituido"; note: string }>();
    for (const set of cohort.structure) {
      const inside =
        set.source === "dentro-del-fichero"
          ? (measured.find((source) => source.from <= set.atUtcMs && set.atUtcMs <= source.to)?.sourceId ?? null)
          : null;
      const beforeId = inside ?? set.beforeSourceId;
      const afterId = inside ?? set.afterSourceId;
      const when = inside === null ? "" : ` (${deps.formatInstant(set.atUtcMs)})`;
      for (const gap of set.gaps) {
        for (const change of gap.changes) {
          if (change.kind === "sustituido") {
            marks.set(`${afterId}\u0000${change.newTagId}`, { mark: "sustituido", note: `sustituye a ${change.oldTagId}${when}` });
            marks.set(`${beforeId}\u0000${change.oldTagId}`, { mark: "retirado", note: `sustituido por ${change.newTagId}${when}` });
          } else if (change.kind === "insertado") {
            marks.set(`${afterId}\u0000${change.tagId}`, { mark: "nuevo", note: `${changeLabel(change, gap)}${when}` });
          } else {
            marks.set(`${beforeId}\u0000${change.tagId}`, { mark: "retirado", note: `${changeLabel(change, gap)}${when}` });
          }
        }
      }
    }
    const rows: RingTimeRow[] = cohort.measures
      .filter((measure) => measure.ring.length > 0)
      .map((measure) => ({
        label: labelOf.get(measure.sourceId) ?? measure.sourceId,
        lapMs: measure.lapMs,
        tags: measure.positions.map((position) => {
          const marked = marks.get(`${measure.sourceId}\u0000${position.tagId}`);
          return marked === undefined
            ? { tagId: position.tagId, offsetMs: position.offsetMs }
            : { tagId: position.tagId, offsetMs: position.offsetMs, mark: marked.mark, note: marked.note };
        }),
      }));
    if (rows.length > 0) panel.append(ringTimeChart(rows));
    const gapCards = between.flatMap((set) =>
      set.gaps.map((gap) => {
        const text = describeGap(gap, deps.duration);
        const at = `de «${labelOf.get(set.beforeSourceId ?? "") ?? "—"}» a «${labelOf.get(set.afterSourceId ?? "") ?? "—"}»`;
        return deps.finding(`${text.title} (${at})`, text.figure, text.evidence, ["estructura-entre-ficheros", gap.fromAnchor, gap.toAnchor]);
      }),
    );
    for (const card of gapCards.slice(0, STRUCTURE_CARDS)) panel.append(card);
    if (gapCards.length > STRUCTURE_CARDS) {
      panel.append(
        node("p", "muted", `Se enseñan ${STRUCTURE_CARDS} tramos de ${gapCards.length} con cambios; el resto, marcados en el anillo.`),
      );
    }
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

    // El ritmo de cada AGV fichero a fichero, contra la horquilla de cada uno: los que se apartan de la
    // flota en alguno, o retienen a otros.
    const pacedIds = [
      ...new Set(
        cohort.measures.flatMap((measure) => [
          ...measure.pace.vehicles.filter((vehicle) => vehicle.verdict !== null).map((vehicle) => vehicle.agvId),
          ...measure.pace.holders.filter((holder) => holder.expected !== null).map((holder) => holder.agvId),
        ]),
      ),
    ].sort();
    if (pacedIds.length > 0) {
      const withPace = cohort.measures.filter((measure) => measure.pace.vehicles.length > 0);
      panel.append(
        node(
          "p",
          "muted",
          "Ritmo de cada AGV en cada fichero, frente a la flota y contra la horquilla de ese fichero: los que se apartan un " +
            "5 % o más en alguno, o retienen a otros. Así se ve si un AGV se vuelve más lento de un fichero al siguiente.",
        ),
      );
      panel.append(
        scrollBox(
          plainTable(
            ["AGV", ...withPace.map((measure) => labelOf.get(measure.sourceId) ?? measure.sourceId)],
            pacedIds.map((agvId) => [
              agvId,
              ...withPace.map((measure) => {
                const vehicle = measure.pace.vehicles.find((entry) => entry.agvId === agvId);
                const holder = measure.pace.holders.find((entry) => entry.agvId === agvId && entry.expected !== null);
                const pace =
                  vehicle === undefined
                    ? "—"
                    : `${Math.round((vehicle.ratio / vehicle.fleetRatio) * 100)} %` +
                      (vehicle.verdict === null ? "" : vehicle.verdict === "mas-lento" ? ", más lento" : ", más rápido");
                return holder === undefined ? pace : `${pace}; retiene a ${holder.retained.length} (${holder.retentions} veces)`;
              }),
            ]),
          ),
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
