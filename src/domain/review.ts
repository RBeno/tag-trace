/**
 * Revisión en campo de los hallazgos (UX_SPEC §4.3, R-EVI-007).
 *
 * Una revisión es una **decisión humana** sobre un hallazgo —se fue a mirarlo y el fallo existe, o
 * no existe, o queda para otro día—. Se guarda aparte del análisis y no lo toca: ninguna cifra,
 * patrón ni estado de verdad del análisis cambia porque alguien marque una tarjeta. Lo que cambia es
 * que el hallazgo gana una confirmación humana, que se enseña como tal y conservando su origen
 * (`GLOSSARY.md`, estado `confirmed`).
 *
 * Tres decisiones que conviene no deshacer:
 *
 * - **La clave es el tipo y el sujeto del hallazgo, no su posición ni su texto.** Al cargar otra
 *   extracción el análisis se rehace y las cifras cambian; la marca tiene que seguir en su tarjeta.
 * - **Se guarda lo que decía la tarjeta cuando se marcó.** Si al volver a cargar la cifra es otra,
 *   se avisa: una confirmación sobre datos distintos no es la misma confirmación.
 * - **«Pendiente» no se guarda.** Es la ausencia de decisión; volver a pendiente borra la marca.
 */

export const REVIEW_STATES = ["pendiente", "confirmado", "descartado", "pospuesto"] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

/** Lo que se enseña de cada estado. El icono va siempre con su texto: el color nunca va solo. */
export const REVIEW_LABEL: Readonly<Record<ReviewState, { readonly icon: string; readonly text: string }>> = {
  pendiente: { icon: "○", text: "Pendiente" },
  confirmado: { icon: "✓", text: "Confirmado" },
  descartado: { icon: "✕", text: "Descartado" },
  pospuesto: { icon: "»", text: "Pospuesto" },
};

export interface ReviewEntry {
  readonly key: string;
  readonly state: Exclude<ReviewState, "pendiente">;
  readonly note: string;
  readonly updatedAt: number;
  /** El título y la cifra de la tarjeta cuando se marcó, para saber si los datos cambiaron después. */
  readonly title: string;
  readonly figure: string;
}

/**
 * La clave de un hallazgo: su tipo y su sujeto (tag, AGV, calle, tramo…), unidos con un separador
 * que no aparece en un identificador. Sin instantes: una rotura vuelta a medir con más datos puede
 * mover su instante unos minutos, y sigue siendo la misma rotura del mismo tag.
 */
export function reviewKey(parts: readonly string[]): string {
  return parts.join("|");
}

/** ¿Cambió la cifra de la tarjeta desde que se marcó? */
export function changedSinceReview(entry: ReviewEntry, currentFigure: string): boolean {
  return entry.figure !== currentFigure;
}

export interface ReviewSummary {
  readonly total: number;
  readonly pendiente: number;
  readonly confirmado: number;
  readonly descartado: number;
  readonly pospuesto: number;
  /** Marcas de hallazgos que el análisis actual ya no produce. No se borran: se enseñan aparte. */
  readonly absent: number;
}

/** Recuento de los hallazgos que se están viendo, y de las marcas que ya no tienen tarjeta. */
export function summarizeReview(
  visibleKeys: readonly string[],
  entries: ReadonlyMap<string, ReviewEntry>,
): ReviewSummary {
  const counts = { pendiente: 0, confirmado: 0, descartado: 0, pospuesto: 0 };
  const visible = new Set(visibleKeys);
  for (const key of visible) counts[entries.get(key)?.state ?? "pendiente"] += 1;
  let absent = 0;
  for (const key of entries.keys()) if (!visible.has(key)) absent += 1;
  return { total: visible.size, ...counts, absent };
}

/** Una celda de CSV con `;`: entre comillas si hace falta, con las comillas dobladas. */
function cell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * La revisión en CSV, para llevarla o entregarla. Una fila por hallazgo visible —también los
 * pendientes, que son la lista de lo que falta— y una por cada marca cuyo hallazgo ya no aparece.
 */
export function reviewCsv(
  visible: readonly { readonly key: string; readonly title: string; readonly figure: string }[],
  entries: ReadonlyMap<string, ReviewEntry>,
  formatInstant: (utcMs: number) => string,
): string {
  const header = ["estado", "hallazgo", "dato actual", "dato al marcar", "nota", "marcado", "aparece", "clave"];
  const rows: string[][] = [];
  const seen = new Set<string>();
  for (const item of visible) {
    seen.add(item.key);
    const entry = entries.get(item.key);
    rows.push([
      REVIEW_LABEL[entry?.state ?? "pendiente"].text,
      item.title,
      item.figure,
      entry?.figure ?? "",
      entry?.note ?? "",
      entry === undefined ? "" : formatInstant(entry.updatedAt),
      "sí",
      item.key,
    ]);
  }
  for (const entry of entries.values()) {
    if (seen.has(entry.key)) continue;
    rows.push([
      REVIEW_LABEL[entry.state].text,
      entry.title,
      "",
      entry.figure,
      entry.note,
      formatInstant(entry.updatedAt),
      "no",
      entry.key,
    ]);
  }
  return [header, ...rows].map((row) => row.map(cell).join(";")).join("\r\n");
}
