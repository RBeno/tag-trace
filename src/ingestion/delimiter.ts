/**
 * Detección de delimitador (R-DAT-002).
 *
 * Se decide por consistencia entre líneas, no por frecuencia: el separador correcto produce el
 * mismo número de campos en todas las filas. Un separador que aparece muchas veces pero de forma
 * irregular es texto, no estructura.
 */

export type Delimiter = ";" | "," | "\t";

const CANDIDATES: readonly Delimiter[] = [";", ",", "\t"];

export interface DelimiterDetection {
  readonly delimiter: Delimiter;
  /** 0–1. Proporción de líneas de muestra que coinciden con el número de campos dominante. */
  readonly confidence: number;
  readonly fieldCount: number;
}

/** Puntúa un candidato por la consistencia del número de campos que produce. */
function score(lines: readonly string[], delimiter: Delimiter): DelimiterDetection {
  const counts = new Map<number, number>();
  for (const line of lines) {
    const fields = line.split(delimiter).length;
    counts.set(fields, (counts.get(fields) ?? 0) + 1);
  }

  let bestFields = 1;
  let bestHits = 0;
  for (const [fields, hits] of counts) {
    if (fields > 1 && hits > bestHits) {
      bestFields = fields;
      bestHits = hits;
    }
  }

  return {
    delimiter,
    confidence: lines.length === 0 ? 0 : bestHits / lines.length,
    fieldCount: bestFields,
  };
}

/**
 * Puntúa los tres candidatos y los devuelve de mejor a peor.
 *
 * Quien llama necesita ver el segundo clasificado para poder distinguir «el separador es evidente»
 * de «hay dos igual de plausibles». Con solo el mejor no se puede: una confianza mediocre puede
 * significar un fichero con alguna fila mal formada o un empate real, y son cosas distintas.
 */
export function rankDelimiters(lines: readonly string[]): readonly DelimiterDetection[] {
  const usable = lines.filter((line) => line.trim().length > 0);
  return CANDIDATES.map((candidate) => score(usable, candidate)).sort(
    (a, b) => b.confidence - a.confidence || b.fieldCount - a.fieldCount,
  );
}

/**
 * Elige el delimitador más consistente entre las líneas de muestra.
 *
 * Devuelve siempre un candidato con su confianza; quien llama decide si la confianza basta. No se
 * acepta una fuente por debajo del mínimo sin que el usuario lo confirme en la vista previa.
 */
export function detectDelimiter(lines: readonly string[]): DelimiterDetection {
  return rankDelimiters(lines)[0] as DelimiterDetection;
}
