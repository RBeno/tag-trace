/**
 * Rotura súbita y degradación progresiva (R-OPP-015).
 *
 * `read-matrix.ts` responde «¿es cosa del vehículo o del tag?» con una sola tasa sobre toda la
 * ventana. Esa tasa es ciega a **cuándo** ocurre lo que ocurre: un tag que se lee al 100 % y
 * desaparece de golpe a mitad de la ventana sale con el mismo aspecto que uno que siempre estuvo a
 * la mitad. Este módulo mira la misma evidencia —pasadas probadas, con acierto o sin él— pero
 * ordenada en el tiempo, y solo dice algo cuando el cambio es sostenido, no una fluctuación.
 *
 * **Es la segunda pasada del propietario, sin releer nada.** La primera pasada es el recorrido que
 * `buildReadMatrix` ya hace por cada vuelta y cada tag; lo único que cambia es que, además de sumar
 * a un contador, se retiene el instante de cada pasada probada. La segunda pasada es este módulo:
 * un post-proceso sobre esas listas compactas —del orden de las lecturas totales, no más—, nunca
 * una relectura de la fuente.
 *
 * Se aplica sobre **todos** los tags y AGV con pasadas suficientes, no solo los que ya salen
 * discrepantes en la matriz agregada: una rotura tardía puede dejar la tasa media todavía cerca del
 * umbral alto, y restringir la búsqueda a los ya sospechosos la dejaría sin ver.
 */

export interface PassRecord {
  readonly utcMs: number;
  readonly hit: boolean;
}

/**
 * Umbrales de la búsqueda de cambio. **Sin valor por defecto** (`AI_DEVELOPMENT_GOVERNANCE.md` §4):
 * son magnitudes que decide el propietario, y la llamada no compila sin ellas.
 */
export interface TrendThresholds {
  /** Pasadas mínimas en la línea de tiempo antes de intentar buscar nada (mismo espíritu que
   *  `minPassesPerPair`: por debajo, cualquier corte que se encuentre es ruido, no señal). */
  readonly minPassesForTrend: number;
  /** Caída mínima de tasa (antes − después) en el mejor corte para llamarlo rotura, no fluctuación. */
  readonly minRateDrop: number;
  /** Pasadas mínimas a cada lado del corte candidato, en absoluto. */
  readonly minPassesEachSide: number;
  /**
   * Proporción mínima de la línea que tiene que quedar a cada lado del corte, **además** de
   * `minPassesEachSide`.
   *
   * Sin esto, una línea larga con una mala racha diminuta al final —cinco pasadas seguidas sin
   * acierto entre cientos— puede parecer un corte más brusco que una tendencia real repartida por
   * toda la ventana: cinco pasadas son pocas frente a quinientas, aunque cumplan el mínimo absoluto.
   * El corte tiene que representar una fracción de verdad de la línea, no solo un recuento.
   */
  readonly minShareEachSide: number;
  /** En cuántos tramos (por recuento, no por tiempo) se divide la línea para medir tendencia. */
  readonly trendSegments: number;
  /** Caída mínima entre el primer y el último tramo para llamarlo degradación, no ruido. */
  readonly minGradientDrop: number;
}

export type ReadRateTrend =
  | { readonly kind: "sin-cambio" }
  | {
      readonly kind: "rotura-candidata";
      /** Punto medio entre la última pasada de «antes» y la primera de «después»: no se puede
       *  precisar más, y fingir un instante exacto sería afirmar de más. */
      readonly changedAtUtcMs: number;
      readonly rateBefore: number;
      readonly rateAfter: number;
    }
  | {
      readonly kind: "degradacion-candidata";
      /** Tasa de cada tramo, en orden temporal. Monótona no creciente por construcción. */
      readonly segmentRates: readonly number[];
    };

/**
 * Busca un cambio sostenido en una línea de pasadas ya ordenada por tiempo.
 *
 * Dos vías, en este orden y sin mezclarlas (mismo principio que R-OPP-014): primero se comprueba si
 * hay una **rotura** — un único corte que separa un régimen alto de uno bajo —, y solo si no la hay
 * se comprueba si hay una **degradación** — una caída sostenida a lo largo de varios tramos. Que una
 * rotura pueda leerse también como el último tramo de una degradación no es ambigüedad: es la razón
 * de mirar primero el corte más nítido.
 */
export function detectTrend(
  timeline: readonly PassRecord[],
  thresholds: TrendThresholds,
): ReadRateTrend {
  if (timeline.length < thresholds.minPassesForTrend) return { kind: "sin-cambio" };

  const rotura = findSuddenBreak(timeline, thresholds);
  if (rotura !== null) return rotura;

  const degradacion = findGradient(timeline, thresholds);
  return degradacion ?? { kind: "sin-cambio" };
}

/**
 * La misma línea de pasadas, repartida en tramos **de tiempo** iguales, para dibujarla.
 *
 * No decide nada: `detectTrend` ya decidió con los tramos por recuento. Esto es solo la forma de
 * enseñar el cambio en un eje de tiempo, y por eso reparte por calendario y no por recuento — al
 * revés que `findGradient`, cuya razón para no hacerlo aquí no aplica: un tramo casi vacío se dibuja
 * como tal, no decide ninguna tendencia.
 */
export interface TimelineSeries {
  readonly fromUtcMs: number;
  readonly binWidthMs: number;
  /** Tasa de acierto de cada tramo; `null` si el tramo no tiene pasadas — nunca un 0 inventado. */
  readonly rates: readonly (number | null)[];
}

export function binTimeline(timeline: readonly PassRecord[], bins: number): TimelineSeries | null {
  if (timeline.length < 2 || bins < 1) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const record of timeline) {
    if (record.utcMs < from) from = record.utcMs;
    if (record.utcMs > to) to = record.utcMs;
  }
  if (to <= from) return null;
  const binWidthMs = (to - from) / bins;
  const passes = new Array<number>(bins).fill(0);
  const hits = new Array<number>(bins).fill(0);
  for (const record of timeline) {
    const index = Math.min(bins - 1, Math.floor((record.utcMs - from) / binWidthMs));
    passes[index] = (passes[index] as number) + 1;
    if (record.hit) hits[index] = (hits[index] as number) + 1;
  }
  return {
    fromUtcMs: from,
    binWidthMs,
    rates: passes.map((count, index) => (count === 0 ? null : (hits[index] as number) / count)),
  };
}

/**
 * Segmentación binaria de un único corte, en `O(n)` mediante sumas acumuladas.
 *
 * Se prueba cada corte posible entre `minPassesEachSide` y `length − minPassesEachSide`, y se
 * queda el que maximiza la diferencia de tasa entre los dos lados. No es una búsqueda del cambio
 * más probable en sentido estadístico estricto: es la más simple que no necesita más umbrales que
 * los que ya existen, y por eso hay que exigirle un margen generoso (`minRateDrop`) antes de creerla.
 */
function findSuddenBreak(
  timeline: readonly PassRecord[],
  thresholds: TrendThresholds,
): Extract<ReadRateTrend, { kind: "rotura-candidata" }> | null {
  const length = timeline.length;
  const minSide = Math.max(
    thresholds.minPassesEachSide,
    Math.ceil(length * thresholds.minShareEachSide),
  );
  const prefixHits = new Array<number>(length + 1).fill(0);
  for (let index = 0; index < length; index += 1) {
    prefixHits[index + 1] = (prefixHits[index] as number) + (timeline[index]?.hit ? 1 : 0);
  }

  let best: { index: number; drop: number; rateBefore: number; rateAfter: number } | null = null;
  for (let cut = minSide; cut <= length - minSide; cut += 1) {
    const rateBefore = (prefixHits[cut] as number) / cut;
    const rateAfter = ((prefixHits[length] as number) - (prefixHits[cut] as number)) / (length - cut);
    const drop = rateBefore - rateAfter;
    if (best === null || drop > best.drop) best = { index: cut, drop, rateBefore, rateAfter };
  }

  if (best === null || best.drop < thresholds.minRateDrop) return null;

  const lastBefore = timeline[best.index - 1] as PassRecord;
  const firstAfter = timeline[best.index] as PassRecord;
  return {
    kind: "rotura-candidata",
    changedAtUtcMs: Math.round((lastBefore.utcMs + firstAfter.utcMs) / 2),
    rateBefore: best.rateBefore,
    rateAfter: best.rateAfter,
  };
}

/**
 * Divide la línea en `trendSegments` tramos por recuento y comprueba si la tasa **no crece nunca**
 * de un tramo al siguiente, con una caída total que alcance `minGradientDrop`.
 *
 * Por recuento y no por tiempo: la densidad de pasadas no tiene por qué ser uniforme a lo largo de
 * la ventana, y repartir por calendario podría dejar un tramo casi vacío decidiendo la tendencia.
 */
function findGradient(
  timeline: readonly PassRecord[],
  thresholds: TrendThresholds,
): Extract<ReadRateTrend, { kind: "degradacion-candidata" }> | null {
  const { trendSegments } = thresholds;
  if (trendSegments < 2 || timeline.length < trendSegments * thresholds.minPassesEachSide) {
    return null;
  }

  const segmentRates: number[] = [];
  for (let segment = 0; segment < trendSegments; segment += 1) {
    const from = Math.floor((segment * timeline.length) / trendSegments);
    const to = Math.floor(((segment + 1) * timeline.length) / trendSegments);
    const slice = timeline.slice(from, to);
    if (slice.length === 0) return null;
    const hits = slice.filter((record) => record.hit).length;
    segmentRates.push(hits / slice.length);
  }

  for (let index = 1; index < segmentRates.length; index += 1) {
    if ((segmentRates[index] as number) > (segmentRates[index - 1] as number)) return null;
  }

  const drop = (segmentRates[0] as number) - (segmentRates[segmentRates.length - 1] as number);
  if (drop < thresholds.minGradientDrop) return null;

  return { kind: "degradacion-candidata", segmentRates };
}
