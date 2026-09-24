/**
 * Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013, R-DAT-017).
 *
 * Con una sola ventana, un tag sin lecturas es indistinguible entre obsoleto y averiado, y un
 * vehículo que no lee un tag es indistinguible entre «nunca lo llevó en memoria» y «lo perdió». Lo
 * que separa las dos explicaciones es el tiempo: leído antes y no ahora es un **cambio** —murió, se
 * sustituyó o se retiró—; no leído en ninguna ventana es obsoleto consolidado, con más soporte que
 * una sola muestra pero sin llegar a `confirmed` — eso exige ir a mirarlo (R-EVI-006).
 *
 * **Sustitución candidata (R-DAT-017).** Un tag que desaparece y otro que aparece pueden ocupar el
 * mismo hueco de la secuencia de lecturas: si comparten vecino dominante en el mismo lado —el mismo
 * predecesor o el mismo sucesor, medido directamente sobre la secuencia cronológica de lecturas de
 * cada vehículo, nunca sobre el anillo reconstruido— y coinciden en el tiempo (el mismo corte entre
 * periodos los separa a los dos), se correlacionan en un solo hallazgo. Sin una correlación mutua y
 * unívoca —cada desaparecido con exactamente un candidato y viceversa— no se empareja: dos tags
 * ambiguos se quedan como dos hallazgos sueltos, nunca una pareja forzada (R-EVI-004).
 *
 * **Adopción de tag nuevo (R-AGV-013 ampliada).** La misma comparación de un vehículo consigo mismo,
 * en la otra dirección: un tag nuevo —o el lado nuevo de una sustitución candidata— ya leído por casi
 * toda la flota en el periodo tardío, que un vehículo concreto y activo en ese mismo periodo no ha
 * leído ni una vez, es candidato a memoria no actualizada de ese vehículo.
 *
 * `coverage` ya trae esta comparación servida: es la unión de los intervalos de todas las fuentes
 * aceptadas (`mergeIntervals`), así que dos exportaciones separadas en el tiempo producen, sin nada
 * más, dos o más intervalos disjuntos. Esta función no pide un segundo fichero: usa el primero y el
 * último intervalo que ya existen.
 *
 * **Lo que no hace.** No compara periodos intermedios cuando hay más de dos intervalos: solo el
 * primero contra el último. No reclasifica el inventario de una sola ventana (`inventory.ts`): es una
 * vista complementaria que se cruza por `tagId`. No aplica el tercer descarte que R-DAT-016 también
 * anuncia —comprobar con tiempos si el tramo que rodea a un tag obsoleto se recorre en directo—, que
 * es geométrico y no temporal, y queda para otra entrega. Y no confirma ninguna sustitución física:
 * la correlación es de posición y de tiempo sobre el dato, nunca una conclusión de que sea el mismo
 * punto — eso, otra vez, exige ir a mirarlo (R-EVI-006). Tampoco necesita el anillo ni el ciclo
 * dominante para nada de esto: todo se calcula solo con lecturas, a propósito, para no acoplar este
 * módulo a `laps.ts`/`cohort.ts`.
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import type { Reading } from "./reading.js";

export interface DriftThresholds {
  /**
   * Separación mínima entre el fin del primer periodo cubierto y el inicio del último para tratarlos
   * como «distantes» y no como el hueco pequeño de una fuente casi contigua a otra.
   */
  readonly minGapMs: number;
  /**
   * Lecturas mínimas de un vehículo **dentro de cada periodo** para que compararlo entre los dos
   * signifique algo. Mismo concepto y mismo valor que `BlindnessThresholds.minReadingsPerVehicle`
   * (`inventory.ts`): un vehículo con tres lecturas en un periodo no informa de nada al contrastarlo
   * con el otro. El mismo umbral filtra también qué tags `desaparecido`/`nuevo` son candidatos a
   * sustitución: por debajo, cualquier vecino encontrado es anécdota, no un patrón sostenido.
   */
  readonly minReadingsPerVehicle: number;
  /**
   * Cuota mínima de testigos tardíos que ya leen un tag nuevo para considerarlo «adoptado por la
   * flota» y empezar a señalar a quien no lo lee. Mismo valor y mismo razonamiento que
   * `ReadRateThresholds.highRate` (`read-matrix.ts`): 0,8 separa «lo lee» de «no lo lee» con margen,
   * la misma idea aplicada aquí a cuántos vehículos leen un tag en vez de a cuántas veces se lee.
   */
  readonly minAdoptionShare: number;
}

export type TagDrift =
  /** Se leía en el periodo temprano y no en el tardío: cambió, y el dato no dice por qué. */
  | { readonly kind: "desaparecido"; readonly tagId: string; readonly readingsBefore: number }
  /** Sin lecturas en el periodo temprano y con lecturas en el tardío: sustitución o instalación. */
  | { readonly kind: "nuevo"; readonly tagId: string; readonly readingsAfter: number }
  /** Sin ninguna lectura en los dos periodos: obsoleto consolidado, nunca confirmado por esto solo. */
  | { readonly kind: "obsoleto-consolidado"; readonly tagId: string }
  /**
   * Un tag que desaparece y otro que ocupa su mismo hueco en la secuencia de lecturas, correlacionados
   * por vecino compartido y por tiempo (R-DAT-017). `tagId` es el que desaparece, `nuevoTagId` el que
   * lo sustituye. Candidato, no confirmación: puede ser una sustitución física, o dos cambios sin
   * relación que casualmente comparten posición — el dato no lo distingue (R-EVI-006).
   */
  | {
      readonly kind: "sustitucion-candidata";
      readonly tagId: string;
      readonly nuevoTagId: string;
      readonly readingsBefore: number;
      readonly readingsAfter: number;
      readonly sharedNeighbor: string;
      readonly neighborSide: "predecesor" | "sucesor";
    };

export interface VehicleDrift {
  readonly agvId: string;
  /**
   * Tags que este vehículo leía en el periodo temprano y no lee ni una vez en el tardío, mientras el
   * tag sigue vivo para el resto de la flota.
   *
   * Un tag que además murió para todos **no** aparece aquí: ya está en `tagDrifts` como
   * `desaparecido`, y repetirlo por cada vehículo que lo leía sería la misma causa contada muchas
   * veces en vez de nombrarla una sola vez donde corresponde.
   */
  readonly droppedTags: readonly string[];
  /**
   * Tags nuevos —o el lado nuevo de una sustitución candidata— ya adoptados por la mayoría de la
   * flota en el periodo tardío, que este vehículo, activo en ese mismo periodo, no ha leído ni una
   * vez. Memoria probablemente desactualizada: el resto ya lo detecta y este vehículo no.
   */
  readonly notAdoptedTags: readonly string[];
}

export interface DriftComparison {
  readonly evaluated: boolean;
  /** Por qué no se evaluó, cuando `evaluated` es `false`. Nunca se calla (R-EVI-006). */
  readonly reason: string | null;
  readonly earlyPeriod: Interval | null;
  readonly latePeriod: Interval | null;
  readonly tagDrifts: readonly TagDrift[];
  readonly vehicleDrifts: readonly VehicleDrift[];
}

const NOT_EVALUATED: Omit<DriftComparison, "evaluated" | "reason"> = {
  earlyPeriod: null,
  latePeriod: null,
  tagDrifts: [],
  vehicleDrifts: [],
};

interface PeriodCounts {
  readonly readingsByTag: Map<string, number>;
  readonly readsByVehicleTag: Map<string, Map<string, number>>;
  readonly readingsByVehicle: Map<string, number>;
}

function countPeriod(readings: readonly Reading[], period: Interval): PeriodCounts {
  const readingsByTag = new Map<string, number>();
  const readsByVehicleTag = new Map<string, Map<string, number>>();
  const readingsByVehicle = new Map<string, number>();

  for (const entry of readings) {
    const instant = entry.time.utcMs;
    if (instant < period.from || instant > period.to) continue;
    readingsByTag.set(entry.tagId, (readingsByTag.get(entry.tagId) ?? 0) + 1);
    readingsByVehicle.set(entry.agvId, (readingsByVehicle.get(entry.agvId) ?? 0) + 1);
    let tags = readsByVehicleTag.get(entry.agvId);
    if (tags === undefined) {
      tags = new Map<string, number>();
      readsByVehicleTag.set(entry.agvId, tags);
    }
    tags.set(entry.tagId, (tags.get(entry.tagId) ?? 0) + 1);
  }

  return { readingsByTag, readsByVehicleTag, readingsByVehicle };
}

interface NeighborTally {
  readonly predecessors: Map<string, Map<string, number>>;
  readonly successors: Map<string, Map<string, number>>;
}

function bump(target: Map<string, Map<string, number>>, key: string, neighbor: string): void {
  let counts = target.get(key);
  if (counts === undefined) {
    counts = new Map<string, number>();
    target.set(key, counts);
  }
  counts.set(neighbor, (counts.get(neighbor) ?? 0) + 1);
}

/**
 * Vecino dominante de cada tag, por periodo, medido directamente sobre la secuencia cronológica de
 * lecturas de cada vehículo — nunca sobre el anillo reconstruido (`laps.ts` no entra aquí a
 * propósito). Una repetición inmediata del mismo tag no aporta vecino y se descarta, mismo criterio
 * que ya usa `read-matrix.ts` para pasos nulos.
 */
function buildNeighborTally(readings: readonly Reading[], period: Interval): NeighborTally {
  const byVehicle = new Map<string, Array<{ readonly tagId: string; readonly utcMs: number }>>();
  for (const entry of readings) {
    const instant = entry.time.utcMs;
    if (instant < period.from || instant > period.to) continue;
    let seq = byVehicle.get(entry.agvId);
    if (seq === undefined) {
      seq = [];
      byVehicle.set(entry.agvId, seq);
    }
    seq.push({ tagId: entry.tagId, utcMs: instant });
  }

  const predecessors = new Map<string, Map<string, number>>();
  const successors = new Map<string, Map<string, number>>();
  for (const seq of byVehicle.values()) {
    seq.sort((a, b) => a.utcMs - b.utcMs);
    for (let index = 1; index < seq.length; index += 1) {
      const prev = seq[index - 1] as { readonly tagId: string; readonly utcMs: number };
      const curr = seq[index] as { readonly tagId: string; readonly utcMs: number };
      if (prev.tagId === curr.tagId) continue;
      bump(successors, prev.tagId, curr.tagId);
      bump(predecessors, curr.tagId, prev.tagId);
    }
  }
  return { predecessors, successors };
}

/** El vecino con más cuenta. Empate exacto en el máximo: sin dominante, `null` — sin firma no hay
 *  pareja posible, en vez de adivinar cuál de los empatados es el vecino real (R-EVI-004). */
export function dominant(counts: Map<string, number> | undefined): string | null {
  if (counts === undefined || counts.size === 0) return null;
  let max = 0;
  for (const count of counts.values()) if (count > max) max = count;
  const winners = [...counts.entries()].filter(([, count]) => count === max).map(([tag]) => tag);
  return winners.length === 1 ? (winners[0] as string) : null;
}

export interface NeighborSignature {
  readonly predecessor: string | null;
  readonly successor: string | null;
}

function signatureOf(tagId: string, tally: NeighborTally): NeighborSignature {
  return {
    predecessor: dominant(tally.predecessors.get(tagId)),
    successor: dominant(tally.successors.get(tagId)),
  };
}

export interface SharedNeighborMatch {
  readonly side: "predecesor" | "sucesor";
  readonly neighbor: string;
}

/**
 * ¿Comparten un vecino dominante el desaparecido (firma temprana) y el nuevo (firma tardía)? Se
 * prueba el sucesor antes que el predecesor —si coinciden los dos, se reporta el sucesor, elección
 * arbitraria pero determinista—.
 *
 * El vecino compartido nunca puede ser a su vez un tag que desaparece o aparece, y no hace falta
 * comprobarlo aparte: para que `early.successor(D)` valga X, X tiene que tener lecturas tempranas
 * -es como se construyó `earlyTally`-, y para que `late.successor(NEW)` valga ese mismo X, X tiene
 * que tener lecturas tardías. Un vecino que coincide en los dos lados ya tiene lecturas en los dos
 * periodos por construcción, así que nunca puede estar en la lista de tags que desaparecen o
 * aparecen (que exigen lecturas en uno solo). Es una garantía del propio dato, no una comprobación
 * añadida por si acaso (no se valida lo que no puede ocurrir).
 */
export function sharedNeighborMatch(early: NeighborSignature, late: NeighborSignature): SharedNeighborMatch | null {
  if (early.successor !== null && early.successor === late.successor) {
    return { side: "sucesor", neighbor: early.successor };
  }
  if (early.predecessor !== null && early.predecessor === late.predecessor) {
    return { side: "predecesor", neighbor: early.predecessor };
  }
  return null;
}

/**
 * Compara el primer y el último periodo cubiertos, a partir de la cobertura ya calculada del
 * circuito. `knownTags` es la unión de las listas de planta declaradas (circuito, memoria,
 * mantenimiento, emergencia, carga online, crítico): es lo único que permite saber que un tag existe
 * cuando no tiene ninguna lectura en ningún periodo.
 */
export function compareDistantPeriods(
  readings: readonly Reading[],
  coverage: readonly Interval[],
  knownTags: ReadonlySet<string>,
  thresholds: DriftThresholds,
): DriftComparison {
  const merged = mergeIntervals(coverage);
  if (merged.length < 2) {
    return { evaluated: false, reason: "Solo hay un periodo cubierto: no hay con qué compararlo.", ...NOT_EVALUATED };
  }

  const earlyPeriod = merged[0] as Interval;
  const latePeriod = merged[merged.length - 1] as Interval;
  if (latePeriod.from - earlyPeriod.to < thresholds.minGapMs) {
    return {
      evaluated: false,
      reason: "El hueco entre el primer y el último periodo cubierto es demasiado pequeño para tratarlos como distantes.",
      ...NOT_EVALUATED,
    };
  }

  const early = countPeriod(readings, earlyPeriod);
  const late = countPeriod(readings, latePeriod);

  const allTags = new Set<string>([...knownTags, ...early.readingsByTag.keys(), ...late.readingsByTag.keys()]);
  const disappeared: Array<{ readonly tagId: string; readonly readingsBefore: number }> = [];
  const appeared: Array<{ readonly tagId: string; readonly readingsAfter: number }> = [];
  const consolidated: string[] = [];
  const deadEverywhere = new Set<string>();
  for (const tagId of allTags) {
    const before = early.readingsByTag.get(tagId) ?? 0;
    const after = late.readingsByTag.get(tagId) ?? 0;
    if (before > 0 && after === 0) {
      disappeared.push({ tagId, readingsBefore: before });
      deadEverywhere.add(tagId);
    } else if (before === 0 && after > 0) {
      appeared.push({ tagId, readingsAfter: after });
    } else if (before === 0 && after === 0 && knownTags.has(tagId)) {
      consolidated.push(tagId);
      deadEverywhere.add(tagId);
    }
  }

  // Sustitución candidata (R-DAT-017): emparejamiento bipartito unívoco en los dos sentidos. Solo se
  // intenta con soporte de sobra a cada lado (mismo umbral que ya filtra ruido en `vehicleDrifts`).
  const disappearedCandidates = disappeared.filter(
    (entry) => entry.readingsBefore >= thresholds.minReadingsPerVehicle,
  );
  const appearedCandidates = appeared.filter((entry) => entry.readingsAfter >= thresholds.minReadingsPerVehicle);

  const paired = new Map<string, { readonly nuevoTagId: string; readonly side: "predecesor" | "sucesor"; readonly neighbor: string }>();
  const absorbedNuevo = new Set<string>();

  if (disappearedCandidates.length > 0 && appearedCandidates.length > 0) {
    const earlyTally = buildNeighborTally(readings, earlyPeriod);
    const lateTally = buildNeighborTally(readings, latePeriod);

    const matchesForD = new Map<string, Array<{ readonly nTag: string; readonly match: SharedNeighborMatch }>>();
    const matchesForN = new Map<string, string[]>();
    for (const d of disappearedCandidates) {
      const dSignature = signatureOf(d.tagId, earlyTally);
      const hits: Array<{ readonly nTag: string; readonly match: SharedNeighborMatch }> = [];
      for (const n of appearedCandidates) {
        const nSignature = signatureOf(n.tagId, lateTally);
        const match = sharedNeighborMatch(dSignature, nSignature);
        if (match === null) continue;
        hits.push({ nTag: n.tagId, match });
        const forN = matchesForN.get(n.tagId) ?? [];
        forN.push(d.tagId);
        matchesForN.set(n.tagId, forN);
      }
      if (hits.length > 0) matchesForD.set(d.tagId, hits);
    }

    for (const [dTag, hits] of matchesForD) {
      if (hits.length !== 1) continue; // ambiguo: varios candidatos, no se fuerza pareja (R-EVI-004)
      const hit = hits[0] as { readonly nTag: string; readonly match: SharedNeighborMatch };
      const forN = matchesForN.get(hit.nTag) ?? [];
      if (forN.length !== 1 || forN[0] !== dTag) continue; // el nuevo también tiene que ser unívoco
      paired.set(dTag, { nuevoTagId: hit.nTag, side: hit.match.side, neighbor: hit.match.neighbor });
      absorbedNuevo.add(hit.nTag);
    }
  }

  const tagDrifts: TagDrift[] = [];
  for (const entry of disappeared) {
    const pair = paired.get(entry.tagId);
    if (pair === undefined) {
      tagDrifts.push({ kind: "desaparecido", tagId: entry.tagId, readingsBefore: entry.readingsBefore });
      continue;
    }
    tagDrifts.push({
      kind: "sustitucion-candidata",
      tagId: entry.tagId,
      nuevoTagId: pair.nuevoTagId,
      readingsBefore: entry.readingsBefore,
      readingsAfter: late.readingsByTag.get(pair.nuevoTagId) ?? 0,
      sharedNeighbor: pair.neighbor,
      neighborSide: pair.side,
    });
  }
  for (const entry of appeared) {
    if (absorbedNuevo.has(entry.tagId)) continue;
    tagDrifts.push({ kind: "nuevo", tagId: entry.tagId, readingsAfter: entry.readingsAfter });
  }
  for (const tagId of consolidated) {
    tagDrifts.push({ kind: "obsoleto-consolidado", tagId });
  }
  tagDrifts.sort((a, b) => a.tagId.localeCompare(b.tagId));

  const witnessesEarly = new Set(
    [...early.readingsByVehicle].filter(([, count]) => count >= thresholds.minReadingsPerVehicle).map(([agvId]) => agvId),
  );
  const witnessesLate = new Set(
    [...late.readingsByVehicle].filter(([, count]) => count >= thresholds.minReadingsPerVehicle).map(([agvId]) => agvId),
  );

  const droppedByVehicle = new Map<string, string[]>();
  for (const agvId of witnessesEarly) {
    if (!witnessesLate.has(agvId)) continue;
    const readEarly = early.readsByVehicleTag.get(agvId) ?? new Map<string, number>();
    const readLate = late.readsByVehicleTag.get(agvId) ?? new Map<string, number>();
    const dropped = [...readEarly.entries()]
      .filter(
        ([tagId, count]) =>
          // Un puñado de lecturas de un tag que ya es probabilístico por diseño (una degradación o
          // una tasa media ajena a esta comparación) no demuestra un patrón sólido que la ausencia
          // después pueda contradecir. Mismo umbral y misma razón que `minReadingsPerVehicle`: por
          // debajo, el silencio no significa nada por sí solo.
          count >= thresholds.minReadingsPerVehicle && !readLate.has(tagId) && !deadEverywhere.has(tagId),
      )
      .map(([tagId]) => tagId)
      .sort();
    if (dropped.length > 0) droppedByVehicle.set(agvId, dropped);
  }

  // Adopción de tag nuevo (R-AGV-013 ampliada): la misma comparación al revés. Un tag ya leído por
  // casi todos los testigos tardíos y que un testigo tardío concreto no ha leído ni una vez es
  // candidato a memoria no actualizada de ese vehículo. Sin necesidad del anillo: si el tag es de una
  // rama que solo recorre parte de la flota, su cuota de adopción entre **todos** los testigos
  // tardíos no llega al umbral y el mecanismo simplemente no dispara, en vez de fabricar un falso
  // positivo sobre quien no pasa por ahí.
  const adoptionCandidates = new Set<string>();
  for (const entry of tagDrifts) {
    if (entry.kind === "nuevo") adoptionCandidates.add(entry.tagId);
    else if (entry.kind === "sustitucion-candidata") adoptionCandidates.add(entry.nuevoTagId);
  }

  const notAdoptedByVehicle = new Map<string, string[]>();
  if (witnessesLate.size > 0) {
    for (const tagId of adoptionCandidates) {
      let adopters = 0;
      for (const agvId of witnessesLate) {
        if ((late.readsByVehicleTag.get(agvId)?.get(tagId) ?? 0) > 0) adopters += 1;
      }
      if (adopters / witnessesLate.size < thresholds.minAdoptionShare) continue;
      for (const agvId of witnessesLate) {
        if ((late.readsByVehicleTag.get(agvId)?.get(tagId) ?? 0) > 0) continue;
        const list = notAdoptedByVehicle.get(agvId) ?? [];
        list.push(tagId);
        notAdoptedByVehicle.set(agvId, list);
      }
    }
  }

  const vehicleIds = new Set<string>([...droppedByVehicle.keys(), ...notAdoptedByVehicle.keys()]);
  const vehicleDrifts: VehicleDrift[] = [...vehicleIds]
    .sort()
    .map((agvId) => ({
      agvId,
      droppedTags: droppedByVehicle.get(agvId) ?? [],
      notAdoptedTags: (notAdoptedByVehicle.get(agvId) ?? []).slice().sort(),
    }));

  return { evaluated: true, reason: null, earlyPeriod, latePeriod, tagDrifts, vehicleDrifts };
}
