/**
 * Candidatos a punto crítico (R-GRA-007), leídos como firma estadística sobre el dato.
 *
 * Un tag crítico es el que cumple una función de la que depende que el vehículo haga lo correcto:
 * parada precisa, cruce, semáforo, dejar/recoger carro, cambio de mapa o bifurcación. La función es
 * dato de planta declarado, **nunca se deduce del fichero** — lo que el dato sí deja es una firma
 * por clase, que sirve para proponer candidatos al propietario, nunca para asignar la función.
 *
 * Cuatro de las siete clases tienen firma y están construidas:
 *
 * - **Bifurcación**: un tag cuyas salidas se reparten entre dos o más sucesores con cuota
 *   comparable, sostenida en el tiempo, ninguno dominante.
 * - **Cruce**: una bifurcación cuyas ramas **reconvergen** en pocos saltos — un cruce físico de dos
 *   caminos que se abren y se vuelven a cerrar, dentro del mismo cohorte. Distinto del cruce **entre
 *   circuitos** protegido por un par de tags (R-AGV-009/011), que sigue bloqueado por OQ-121 y no se
 *   construye aquí.
 * - **Parada precisa**: un tag donde la duración hasta la siguiente lectura es larga y de poca
 *   varianza — el vehículo se detiene con precisión, no de forma variable como el tráfico normal.
 * - **Semáforo**: un tag donde esa misma duración es **bimodal** — a veces cruza sin esperar, a
 *   veces espera un ciclo completo.
 *
 * Cambio de mapa, dejar carro y recoger carro no dejan firma distinguible con lo que hay disponible
 * hoy: ningún cambio de mapa se ve en la secuencia de tags, y ninguna lectura registra la dirección
 * de la interacción con un carro. Quedan fuera, documentadas, no silenciadas.
 */

/** Un sucesor de un tag, con cuánto tráfico sostiene esa rama. */
export interface BranchShare {
  readonly tagId: string;
  readonly support: number;
  readonly share: number;
}

export type CriticalPointCandidate =
  | {
      readonly kind: "bifurcacion";
      readonly tagId: string;
      /** Transiciones totales salientes del tag, sumando todas sus ramas. */
      readonly support: number;
      /** Las ramas que sostienen el candidato, ordenadas por cuota descendente. */
      readonly branches: readonly BranchShare[];
      readonly evidence: string;
    }
  | {
      readonly kind: "cruce";
      readonly tagId: string;
      readonly support: number;
      readonly branches: readonly BranchShare[];
      /** El tag donde dos ramas vuelven a coincidir. */
      readonly reconvergesAt: string;
      /** Saltos hasta encontrar ese punto común, mínimo entre las dos ramas que reconvergen. */
      readonly hops: number;
      readonly evidence: string;
    }
  | {
      readonly kind: "parada-precisa";
      readonly tagId: string;
      readonly samples: number;
      readonly meanDurationMs: number;
      readonly coefficientOfVariation: number;
      readonly evidence: string;
    }
  | {
      readonly kind: "semaforo";
      readonly tagId: string;
      readonly samples: number;
      readonly lowClusterMeanMs: number;
      readonly highClusterMeanMs: number;
      readonly evidence: string;
    };

export interface BifurcationThresholds {
  /** Cuota mínima de cada rama para contar como reparto real y no como excepción rara. */
  readonly minBranchShare: number;
  /** Transiciones mínimas por rama: una cuota del 50 % sobre dos pasadas no es consenso. */
  readonly minBranchSupport: number;
  /**
   * Cuota mínima de cada rama en **cada mitad** de las pasadas del tag, por recuento y no por
   * tiempo.
   *
   * Sin esta guarda, un tag que deja de leerse aguas abajo (una rotura súbita, por ejemplo) hace
   * parecer bifurcado al tag anterior: antes de la rotura casi todas las salidas van al sucesor de
   * siempre, después van todas al que lo sustituye por saltarse el tramo roto, y esas dos cuotas
   * agregadas sobre toda la ventana pueden ser perfectamente comparables sin que exista ningún
   * reparto real y estable. Una bifurcación real sostiene las dos ramas en las dos mitades; un
   * cambio de régimen sostiene una en cada una y desaparece en la otra.
   */
  readonly minBranchShareEachHalf: number;
}

export interface CruceThresholds {
  /**
   * Saltos que se sigue la rama minoritaria (y la mayoritaria) antes de rendirse. Pequeño a
   * propósito: un cruce físico de dos caminos reconverge cerca; una bifurcación real que diera la
   * vuelta al anillo para reencontrarse tardaría muchísimo más saltos que esto.
   */
  readonly maxHopsToReconverge: number;
}

export interface PrecisePauseThresholds {
  /**
   * Piso de duración: por debajo, es tránsito normal, nunca una parada. Calibrado contra el jitter
   * propio del generador sintético (el paso normal ya varía unos segundos por diseño), no contra
   * ninguna medida de planta.
   */
  readonly minDurationMs: number;
  /** Coeficiente de variación máximo (desviación típica / media) para llamarlo «poca varianza». */
  readonly maxCv: number;
  /** Muestras mínimas para que la media y el coeficiente de variación signifiquen algo. */
  readonly minSamples: number;
}

export interface TrafficLightThresholds {
  /** Salto mínimo, como proporción, entre el grupo corto y el largo al partir las duraciones en dos. */
  readonly minGapRatio: number;
  /** Cada grupo, por separado, tiene que ser compacto — si no, el «salto» es ruido, no dos regímenes. */
  readonly maxWithinClusterCv: number;
  /** Muestras mínimas en cada uno de los dos grupos. */
  readonly minClusterSamples: number;
  /** Muestras mínimas totales antes de intentar partir la línea en dos. */
  readonly minSamples: number;
}

export interface CriticalPointThresholds {
  readonly bifurcacion: BifurcationThresholds;
  readonly cruce: CruceThresholds;
  readonly paradaPrecisa: PrecisePauseThresholds;
  readonly semaforo: TrafficLightThresholds;
}

type BifurcationCandidate = Extract<CriticalPointCandidate, { readonly kind: "bifurcacion" }>;
type PrecisePauseCandidate = Extract<CriticalPointCandidate, { readonly kind: "parada-precisa" }>;
type TrafficLightCandidate = Extract<CriticalPointCandidate, { readonly kind: "semaforo" }>;

function formatShare(branch: BranchShare): string {
  return `${branch.tagId} (${Math.round(branch.share * 100)} %, ${branch.support} pasadas)`;
}

/**
 * Busca tags cuyas salidas se reparten entre dos o más sucesores con cuota comparable, sostenida en
 * el tiempo.
 *
 * Sin distinguir todavía si las ramas reconvergen — eso lo hace `classifyCrossings` después, sobre
 * esta misma salida, para no mezclar las dos preguntas en una sola función.
 */
export function findBifurcationCandidates(
  transitions: readonly { readonly from: string; readonly to: string; readonly fromTime: number }[],
  thresholds: BifurcationThresholds,
): readonly CriticalPointCandidate[] {
  const outgoing = new Map<string, { readonly to: string; readonly fromTime: number }[]>();
  for (const { from, to, fromTime } of transitions) {
    let hits = outgoing.get(from);
    if (hits === undefined) {
      hits = [];
      outgoing.set(from, hits);
    }
    hits.push({ to, fromTime });
  }

  const candidates: BifurcationCandidate[] = [];
  for (const [tagId, hits] of outgoing) {
    const total = hits.length;
    const counts = new Map<string, number>();
    for (const hit of hits) counts.set(hit.to, (counts.get(hit.to) ?? 0) + 1);

    const surviving = [...counts.entries()]
      .map(([to, support]) => ({ tagId: to, support, share: support / total }))
      .filter((branch) => branch.share >= thresholds.minBranchShare && branch.support >= thresholds.minBranchSupport);
    if (surviving.length < 2) continue;

    // Persistencia temporal, por recuento y no por tiempo (misma razón que `read-rate-trend.ts`: la
    // densidad de pasadas no es uniforme). Una rama que no se sostiene en las dos mitades es un
    // cambio de régimen, no una bifurcación real.
    const byTime = [...hits].sort((a, b) => a.fromTime - b.fromTime);
    const middle = Math.floor(byTime.length / 2);
    const firstHalf = byTime.slice(0, middle);
    const secondHalf = byTime.slice(middle);
    const shareIn = (half: readonly { readonly to: string }[], to: string): number =>
      half.length === 0 ? 0 : half.filter((hit) => hit.to === to).length / half.length;

    const branches: BranchShare[] = surviving
      .filter(
        (branch) =>
          shareIn(firstHalf, branch.tagId) >= thresholds.minBranchShareEachHalf &&
          shareIn(secondHalf, branch.tagId) >= thresholds.minBranchShareEachHalf,
      )
      .sort((a, b) => b.share - a.share);

    if (branches.length < 2) continue;

    candidates.push({
      kind: "bifurcacion",
      tagId,
      support: total,
      branches,
      evidence:
        `Reparte sus salidas entre ${branches.length} sucesores con cuota comparable: ` +
        `${branches.map(formatShare).join(" y ")}. Ninguno domina.`,
    });
  }

  return candidates.sort((a, b) => b.support - a.support);
}

/** El sucesor con más cuenta por tag, sin ninguna guarda de cuota — solo «por dónde sigue normalmente». */
function dominantSuccessorMap(
  transitions: readonly { readonly from: string; readonly to: string }[],
): ReadonlyMap<string, string> {
  const outgoing = new Map<string, Map<string, number>>();
  for (const { from, to } of transitions) {
    let counts = outgoing.get(from);
    if (counts === undefined) {
      counts = new Map<string, number>();
      outgoing.set(from, counts);
    }
    counts.set(to, (counts.get(to) ?? 0) + 1);
  }

  const dominant = new Map<string, string>();
  for (const [from, counts] of outgoing) {
    let bestTag: string | null = null;
    let bestCount = 0;
    for (const [to, count] of counts) {
      if (count > bestCount) {
        bestTag = to;
        bestCount = count;
      }
    }
    if (bestTag !== null) dominant.set(from, bestTag);
  }
  return dominant;
}

/** Los tags visitados siguiendo el sucesor dominante, empezando por `from` (incluido), hasta `steps` saltos. */
function walk(from: string, steps: number, dominant: ReadonlyMap<string, string>): readonly string[] {
  const path = [from];
  let current = from;
  for (let i = 0; i < steps; i += 1) {
    const next = dominant.get(current);
    if (next === undefined) break;
    path.push(next);
    current = next;
  }
  return path;
}

/** El primer tag común entre dos caminos, con el salto mínimo al que se encuentra en cualquiera de los dos. */
function firstCommon(
  pathA: readonly string[],
  pathB: readonly string[],
): { readonly tag: string; readonly hops: number } | null {
  const indexInA = new Map(pathA.map((tag, index) => [tag, index]));
  let best: { readonly tag: string; readonly hops: number } | null = null;
  for (const [indexB, tag] of pathB.entries()) {
    const indexA = indexInA.get(tag);
    if (indexA === undefined) continue;
    const hops = Math.min(indexA, indexB);
    if (best === null || hops < best.hops) best = { tag, hops };
  }
  return best;
}

/**
 * Reclasifica como `cruce` los candidatos a bifurcación cuyas ramas reconvergen en pocos saltos:
 * dos caminos que se abren y se vuelven a cerrar son un cruce físico, no un reparto que dura. Con
 * 3 o más ramas, basta que un par reconverja para reclasificar el candidato entero — probar todos
 * los pares a la vez queda fuera, límite conocido y no silenciado.
 */
export function classifyCrossings(
  candidates: readonly CriticalPointCandidate[],
  transitions: readonly { readonly from: string; readonly to: string }[],
  thresholds: CruceThresholds,
): readonly CriticalPointCandidate[] {
  const dominant = dominantSuccessorMap(transitions);

  return candidates.map((candidate) => {
    if (candidate.kind !== "bifurcacion") return candidate;

    const paths = candidate.branches.map((branch) => walk(branch.tagId, thresholds.maxHopsToReconverge, dominant));
    let reconvergence: { readonly tag: string; readonly hops: number } | null = null;
    outer: for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        const found = firstCommon(paths[i] as readonly string[], paths[j] as readonly string[]);
        if (found !== null && (reconvergence === null || found.hops < reconvergence.hops)) {
          reconvergence = found;
          if (reconvergence.hops === 0) break outer;
        }
      }
    }

    if (reconvergence === null) return candidate;

    return {
      kind: "cruce",
      tagId: candidate.tagId,
      support: candidate.support,
      branches: candidate.branches,
      reconvergesAt: reconvergence.tag,
      hops: reconvergence.hops,
      evidence:
        `${candidate.evidence} Las ramas vuelven a coincidir en «${reconvergence.tag}» ` +
        `en ${reconvergence.hops} salto(s): un cruce, no un reparto que dure.`,
    };
  });
}

/**
 * Duraciones salientes por tag, descartando pares en el mismo instante (R-DAT-013: no miden nada).
 *
 * Exportada para que la vista dibuje la distribución que las firmas de parada precisa y semáforo ya
 * resumen en una media y un coeficiente: es la misma evidencia, sin resumir.
 */
export function transitionDurationsByTag(
  transitions: readonly {
    readonly from: string;
    readonly fromTime: number;
    readonly toTime: number;
    readonly sameInstant: boolean;
  }[],
): ReadonlyMap<string, number[]> {
  const byTag = new Map<string, number[]>();
  for (const entry of transitions) {
    if (entry.sameInstant) continue;
    let list = byTag.get(entry.from);
    if (list === undefined) {
      list = [];
      byTag.set(entry.from, list);
    }
    list.push(entry.toTime - entry.fromTime);
  }
  return byTag;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values: readonly number[], average: number): number {
  if (average === 0) return 0;
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance) / average;
}

/**
 * Tags con una duración hasta la siguiente lectura larga y de poca varianza: el vehículo se detiene
 * con precisión, en vez de circular con la variabilidad normal del tráfico.
 */
export function findPrecisePauseCandidates(
  transitions: readonly {
    readonly from: string;
    readonly fromTime: number;
    readonly toTime: number;
    readonly sameInstant: boolean;
  }[],
  thresholds: PrecisePauseThresholds,
): readonly CriticalPointCandidate[] {
  const candidates: PrecisePauseCandidate[] = [];
  for (const [tagId, durations] of transitionDurationsByTag(transitions)) {
    if (durations.length < thresholds.minSamples) continue;
    const average = mean(durations);
    if (average < thresholds.minDurationMs) continue;
    const cv = coefficientOfVariation(durations, average);
    if (cv > thresholds.maxCv) continue;

    candidates.push({
      kind: "parada-precisa",
      tagId,
      samples: durations.length,
      meanDurationMs: average,
      coefficientOfVariation: cv,
      evidence:
        `Duración media de ${Math.round(average / 1000)} s con coeficiente de variación ` +
        `${cv.toFixed(2)} sobre ${durations.length} pasadas: parada consistente, no tráfico variable.`,
    });
  }
  return candidates.sort((a, b) => b.samples - a.samples);
}

interface ClusterSplit {
  readonly low: readonly number[];
  readonly high: readonly number[];
  readonly gapRatio: number;
}

/** El mayor salto proporcional entre dos duraciones consecutivas, con al menos `minEachSide` a cada lado. */
function biggestGapSplit(sorted: readonly number[], minEachSide: number): ClusterSplit | null {
  let best: ClusterSplit | null = null;
  for (let i = minEachSide; i <= sorted.length - minEachSide; i += 1) {
    const lower = sorted[i - 1] as number;
    const upper = sorted[i] as number;
    const gapRatio = lower <= 0 ? Number.POSITIVE_INFINITY : upper / lower;
    if (best === null || gapRatio > best.gapRatio) {
      best = { low: sorted.slice(0, i), high: sorted.slice(i), gapRatio };
    }
  }
  return best;
}

/**
 * Tags con una duración hasta la siguiente lectura **bimodal**: a veces se cruza sin esperar, a
 * veces se espera un ciclo completo. Exige un salto claro entre los dos grupos **y** que cada uno,
 * por separado, sea compacto — un salto sin grupos compactos a los lados es ruido con un pico, no
 * dos regímenes reales (misma disciplina de guarda doble que `fifo.ts` y `read-rate-trend.ts`).
 */
export function findTrafficLightCandidates(
  transitions: readonly {
    readonly from: string;
    readonly fromTime: number;
    readonly toTime: number;
    readonly sameInstant: boolean;
  }[],
  thresholds: TrafficLightThresholds,
): readonly CriticalPointCandidate[] {
  const candidates: TrafficLightCandidate[] = [];
  for (const [tagId, durations] of transitionDurationsByTag(transitions)) {
    if (durations.length < thresholds.minSamples) continue;
    const sorted = [...durations].sort((a, b) => a - b);
    const split = biggestGapSplit(sorted, thresholds.minClusterSamples);
    if (split === null || split.gapRatio < thresholds.minGapRatio) continue;

    const lowMean = mean(split.low);
    const highMean = mean(split.high);
    const lowCv = coefficientOfVariation(split.low, lowMean);
    const highCv = coefficientOfVariation(split.high, highMean);
    if (lowCv > thresholds.maxWithinClusterCv || highCv > thresholds.maxWithinClusterCv) continue;

    candidates.push({
      kind: "semaforo",
      tagId,
      samples: durations.length,
      lowClusterMeanMs: lowMean,
      highClusterMeanMs: highMean,
      evidence:
        `Duración bimodal sobre ${durations.length} pasadas: ${Math.round(lowMean / 1000)} s ` +
        `en ${split.low.length} de ellas, ${Math.round(highMean / 1000)} s en las otras ` +
        `${split.high.length} — un salto de ${split.gapRatio.toFixed(1)}x entre los dos grupos.`,
    });
  }
  return candidates.sort((a, b) => b.samples - a.samples);
}
