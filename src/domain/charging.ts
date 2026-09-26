/**
 * Las calles de carga online, leídas como la máquina de estados que R-CO-002 describe.
 *
 * Responde a una pregunta que el producto hasta ahora contestaba mal: **cuándo un vehículo quieto
 * durante media hora está averiado y cuándo está cargando**. El umbral de silencio son cinco
 * minutos, así que toda carga normal salía como inactividad; y una herramienta que llama avería a
 * lo que pasa todos los días deja de mirarse. El propio `dossier.ts` ya decía en un comentario que
 * separarlo «exige la configuración de calles que OQ-B04 todavía no ha dado». Ya la ha dado.
 *
 * Lo que se afirma y lo que no:
 *
 * - La **secuencia** de tags es `observed`: las lecturas están ahí.
 * - La **permanencia** —que estuviera cargando y no simplemente parado sobre ese tag— es
 *   `inferred`. R-CO-004 excluye el SOC del diagnóstico por poco fiable durante la carga, así que
 *   no hay ninguna medida que lo confirme; lo que hay es la firma de R-CO-006.
 * - **Ninguna causa.** Una salida fuera de antigüedad se enumera con quién se coló a quién;
 *   R-FLO-001 admite excepciones documentadas, así que llamarlo avería sería afirmar de más.
 *
 * Y una asimetría que importa más de lo que parece: **una calle por la que no entró nadie no
 * convierte sus tags en sospechosos**. Sin entradas no hubo oportunidad de leerlos, y un cero sin
 * oportunidad no es un cero (R-OPP-013). Es el mismo error que R-OPP-008 prohíbe en el anillo.
 */

import type { CoLane } from "./circuit-config.js";
import { mergeIntervals, uncoveredGaps, type Interval } from "./coverage.js";
import type { Reading } from "./reading.js";
import type { TruthState } from "./truth.js";

export interface ChargingThresholds {
  /**
   * Cuántas veces la mediana de **su propia calle** empieza a ser una permanencia fuera de lo
   * normal.
   *
   * Relativo y no absoluto a propósito (R-FLO-004): el tiempo de carga depende de la calle y del
   * contexto, y un umbral en minutos sería una constante industrial en el código.
   */
  readonly longStayRatio: number;
  /** Estancias mínimas de una calle para que su mediana signifique algo. */
  readonly minStaysForMedian: number;
}

/**
 * En qué estado deja la cobertura a una estancia.
 *
 * `abierta-al-inicio` no es un caso raro: si la ventana empieza a media jornada, los vehículos que
 * ya estaban cargando entran así, y son justamente los que un análisis ingenuo da por ausentes.
 */
export type LaneStayState = "completa" | "abierta-al-inicio" | "abierta-al-final" | "incompleta";

export interface LaneStay {
  readonly laneId: string;
  readonly agvId: string;
  /** `null` cuando entró **antes** de la cobertura: no es cero, es que no se sabe. */
  readonly enteredUtcMs: number | null;
  /** `null` cuando seguía dentro al terminar la cobertura. */
  readonly leftUtcMs: number | null;
  readonly durationMs: number | null;
  readonly state: LaneStayState;
  readonly truth: TruthState;
  readonly evidence: string;
}

/** Un vehículo que esperó dentro mientras otros que entraron después salieron antes (R-CO-003). */
export interface SeniorityBreach {
  readonly waited: string;
  readonly overtakenBy: readonly string[];
  readonly waitedMs: number;
}

export interface LaneReport {
  readonly laneId: string;
  readonly capacity: number | null;
  readonly stays: readonly LaneStay[];
  readonly medianStayMs: number | null;
  /**
   * Si entró alguien en toda la cobertura.
   *
   * `false` **no** es un diagnóstico del tag: es la ausencia de oportunidad de leerlo. Lo que sí
   * es, es una pregunta para planta: ¿está la calle fuera de servicio, o es la lista la que está
   * desactualizada?
   */
  readonly served: boolean;
  readonly outOfSeniority: readonly SeniorityBreach[];
  readonly longStays: readonly LaneStay[];
}

export interface ChargingReport {
  readonly lanes: readonly LaneReport[];
  /**
   * Vehículos cuya primera lectura de toda la cobertura es el tag de salida de una calle.
   *
   * Son los que ya estaban dentro antes de empezar a mirar. Se enumeran aparte porque sostienen la
   * afirmación que hay que **no** hacer: durante esos primeros minutos la calle no estaba vacía,
   * estaba en `sin datos cargados` (R-CO-007).
   */
  readonly startedInside: readonly LaneStay[];
  /**
   * Cuándo empieza la cobertura.
   *
   * Es lo que convierte `startedInside` en una frase que se puede decir: desde aquí hasta que cada
   * uno de ellos salió, su calle **no estaba vacía**, estaba en `sin datos cargados` (R-DAT-007).
   * Sin el instante, la vista solo podría decir que alguien salió sin haber entrado.
   */
  readonly coverageStartUtcMs: number | null;
  /**
   * Vehículos con lecturas y **ninguna estancia** en ninguna calle declarada, en ningún estado.
   *
   * Es un hecho sobre las calles declaradas y nada más: puede cargar en una calle que la lista no
   * recoge, o haber estado poco tiempo dentro de la ventana — por eso viaja con su primera y su
   * última lectura. Y no dice nada de su batería: sin SOC fiable no se juzga (R-CO-004).
   */
  readonly neverCharged: readonly NeverCharged[];
}

export interface NeverCharged {
  readonly agvId: string;
  readonly firstUtcMs: number;
  readonly lastUtcMs: number;
  readonly readings: number;
}

/** Los tres papeles de un tag dentro de una calle, para clasificar una lectura de un vistazo. */
type LaneRole = "entrada" | "parada" | "salida";

interface LaneHit {
  readonly lane: CoLane;
  readonly role: LaneRole;
  readonly utcMs: number;
}

function roleIndex(lanes: readonly CoLane[]): ReadonlyMap<string, { lane: CoLane; role: LaneRole }> {
  const index = new Map<string, { lane: CoLane; role: LaneRole }>();
  for (const lane of lanes) {
    index.set(lane.entryTagId, { lane, role: "entrada" });
    // Una calle que empieza en su parada: leerla es entrar y pararse a la vez.
    if (lane.stopTagId !== lane.entryTagId) index.set(lane.stopTagId, { lane, role: "parada" });
    index.set(lane.exitTagId, { lane, role: "salida" });
  }
  return index;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Recorre las lecturas de un vehículo y saca sus estancias en calles.
 *
 * La máquina es deliberadamente simple porque el dato lo es: entrada, parada y salida de la misma
 * calle, en ese orden. Lo que no encaja sale como `incompleta` en lugar de forzarse — una entrada
 * sin salida dentro de la ventana, o una salida de una calle en la que no consta que entrara, son
 * hechos, no ruido que haya que suavizar.
 */
function staysOf(
  agvId: string,
  hits: readonly LaneHit[],
  straddlesGap: (fromUtcMs: number, toUtcMs: number) => boolean,
): { readonly stays: readonly LaneStay[]; readonly startedInside: LaneStay | null } {
  const stays: LaneStay[] = [];
  let startedInside: LaneStay | null = null;
  let open: { lane: CoLane; enteredUtcMs: number; stoppedUtcMs: number | null } | null = null;

  for (const [index, hit] of hits.entries()) {
    if (hit.role === "entrada") {
      const startsAtStop = hit.lane.stopTagId === hit.lane.entryTagId;
      // Volver a leer la parada de la calle en la que ya está no es otra entrada.
      if (startsAtStop && open !== null && open.lane.laneId === hit.lane.laneId) continue;
      if (open !== null) {
        stays.push({
          laneId: open.lane.laneId,
          agvId,
          enteredUtcMs: open.enteredUtcMs,
          leftUtcMs: null,
          durationMs: null,
          state: "incompleta",
          truth: "unknown",
          evidence: `entró en «${open.lane.laneId}» y la siguiente lectura de calle es otra entrada`,
        });
      }
      open = { lane: hit.lane, enteredUtcMs: hit.utcMs, stoppedUtcMs: startsAtStop ? hit.utcMs : null };
      continue;
    }

    if (hit.role === "parada") {
      if (open !== null && open.lane.laneId === hit.lane.laneId) open.stoppedUtcMs = hit.utcMs;
      continue;
    }

    // Salida.
    if (open !== null && open.lane.laneId === hit.lane.laneId) {
      const from = open.stoppedUtcMs ?? open.enteredUtcMs;
      // Si entre la entrada y la salida hay un tramo entero sin datos cargados, lo que duró la estancia
      // no se sabe: el hueco es «sin datos», no espera (R-DAT-007). Darla por completa la convertiría
      // en permanencia larga y en una salida fuera de antigüedad frente a todo el que cargó después.
      if (straddlesGap(open.enteredUtcMs, hit.utcMs)) {
        stays.push({
          laneId: hit.lane.laneId,
          agvId,
          enteredUtcMs: open.enteredUtcMs,
          leftUtcMs: hit.utcMs,
          durationMs: null,
          state: "incompleta",
          truth: "unknown",
          evidence: `entró en «${hit.lane.laneId}» y salió tras un tramo sin datos cargados: no se sabe cuánto duró`,
        });
        open = null;
        continue;
      }
      stays.push({
        laneId: hit.lane.laneId,
        agvId,
        enteredUtcMs: open.enteredUtcMs,
        leftUtcMs: hit.utcMs,
        durationMs: hit.utcMs - from,
        state: "completa",
        truth: "inferred",
        evidence:
          open.stoppedUtcMs === null
            ? `entró y salió de «${hit.lane.laneId}» sin leer la parada precisa`
            : hit.lane.stopTagId === hit.lane.entryTagId
              ? `parada precisa y salida de «${hit.lane.laneId}» en orden`
              : `entrada, parada precisa y salida de «${hit.lane.laneId}» en orden`,
      });
      open = null;
      continue;
    }

    // Una salida sin entrada previa. Si es además la **primera** lectura de calle del vehículo y
    // no hubo ninguna lectura anterior, es el arranque en frío de R-CO-007: ya estaba dentro.
    const stay: LaneStay = {
      laneId: hit.lane.laneId,
      agvId,
      enteredUtcMs: null,
      leftUtcMs: hit.utcMs,
      durationMs: null,
      state: index === 0 ? "abierta-al-inicio" : "incompleta",
      truth: index === 0 ? "inferred" : "unknown",
      evidence:
        index === 0
          ? `su primera lectura es la salida de «${hit.lane.laneId}»: ya estaba dentro al empezar los datos`
          : `salió de «${hit.lane.laneId}» sin que conste su entrada`,
    };
    stays.push(stay);
    if (index === 0) startedInside = stay;
    open = null;
  }

  if (open !== null) {
    stays.push({
      laneId: open.lane.laneId,
      agvId,
      enteredUtcMs: open.enteredUtcMs,
      leftUtcMs: null,
      durationMs: null,
      state: "abierta-al-final",
      truth: "inferred",
      evidence: `entró en «${open.lane.laneId}» y la cobertura termina sin verle salir`,
    });
  }

  return { stays, startedInside };
}

/**
 * Quién esperó dentro de una calle mientras otros se le colaban (R-CO-003).
 *
 * La regla dice que la salida se relaciona con mayor antigüedad, así que lo observable es el par
 * de órdenes: si A entró antes que B y B salió antes que A, a A se le saltó el turno. Solo se
 * miran estancias con los dos extremos conocidos: con una entrada o una salida fuera de la
 * cobertura no hay dos órdenes que comparar, y forzarlo sería fabricar el hallazgo.
 *
 * **Salen ordenadas por lo que esperó cada uno, y eso no es cosmética.** Dos vehículos dentro a la
 * vez con cargas de duración distinta producen inversiones de orden que son normales: quien
 * terminó antes sale antes. Lo que distingue una espera anómala de esa rutina es su magnitud, así
 * que la lista se entrega del que más esperó al que menos y quien mire empieza por arriba. El
 * módulo **no recorta** la lista: decidir cuántas merecen mirarse es de la vista, y esconder las
 * demás aquí las haría indistinguibles de no existir.
 */
function seniorityBreaches(stays: readonly LaneStay[]): readonly SeniorityBreach[] {
  const closed = stays
    .filter(
      (stay): stay is LaneStay & { enteredUtcMs: number; leftUtcMs: number } =>
        stay.state === "completa" && stay.enteredUtcMs !== null && stay.leftUtcMs !== null,
    )
    .sort((a, b) => a.enteredUtcMs - b.enteredUtcMs);

  const breaches: SeniorityBreach[] = [];
  for (const [index, stay] of closed.entries()) {
    const overtakenBy = closed
      .slice(index + 1)
      .filter((other) => other.enteredUtcMs > stay.enteredUtcMs && other.leftUtcMs < stay.leftUtcMs)
      .map((other) => other.agvId);
    if (overtakenBy.length > 0) {
      breaches.push({
        waited: stay.agvId,
        overtakenBy: [...new Set(overtakenBy)],
        waitedMs: stay.leftUtcMs - stay.enteredUtcMs,
      });
    }
  }
  return breaches.sort((a, b) => b.waitedMs - a.waitedMs);
}

/**
 * Construye el informe de calles.
 *
 * `coverage` fija hasta cuándo hay datos: una estancia que no cierra dentro de la cobertura queda
 * abierta, y una que cruza un tramo entero sin datos queda `incompleta`; ninguna de las dos cuenta
 * como permanencia larga ni en la antigüedad, porque no se sabe cuánto duró (R-DAT-007).
 */
export function buildChargingReport(
  readings: readonly Reading[],
  lanes: readonly CoLane[],
  coverage: readonly Interval[],
  thresholds: ChargingThresholds,
): ChargingReport {
  if (lanes.length === 0) return { lanes: [], startedInside: [], coverageStartUtcMs: null, neverCharged: [] };

  const index = roleIndex(lanes);
  const coverageStartUtcMs =
    coverage.length === 0 ? null : Math.min(...coverage.map((interval) => interval.from));
  const gaps = uncoveredGaps(mergeIntervals([...coverage]));
  const straddlesGap = (fromUtcMs: number, toUtcMs: number): boolean =>
    gaps.some((gap) => fromUtcMs <= gap.from && toUtcMs >= gap.to);

  // Una pasada por las lecturas, agrupando por vehículo. El resto trabaja ya sobre lecturas de
  // calle, que son una fracción diminuta del total (WP-001: nada de recorrer el CSV varias veces).
  const byVehicle = new Map<string, LaneHit[]>();
  const firstReadingOf = new Map<string, number>();
  const lastReadingOf = new Map<string, number>();
  const readingCount = new Map<string, number>();
  for (const reading of readings) {
    const previous = firstReadingOf.get(reading.agvId);
    if (previous === undefined || reading.time.utcMs < previous) {
      firstReadingOf.set(reading.agvId, reading.time.utcMs);
    }
    const latest = lastReadingOf.get(reading.agvId);
    if (latest === undefined || reading.time.utcMs > latest) lastReadingOf.set(reading.agvId, reading.time.utcMs);
    readingCount.set(reading.agvId, (readingCount.get(reading.agvId) ?? 0) + 1);
    const role = index.get(reading.tagId);
    if (role === undefined) continue;
    let hits = byVehicle.get(reading.agvId);
    if (hits === undefined) {
      hits = [];
      byVehicle.set(reading.agvId, hits);
    }
    hits.push({ lane: role.lane, role: role.role, utcMs: reading.time.utcMs });
  }

  const staysByLane = new Map<string, LaneStay[]>();
  for (const lane of lanes) staysByLane.set(lane.laneId, []);
  const startedInside: LaneStay[] = [];
  const withStay = new Set<string>();

  for (const [agvId, hits] of byVehicle) {
    hits.sort((a, b) => a.utcMs - b.utcMs);
    const result = staysOf(agvId, hits, straddlesGap);
    if (result.stays.length > 0) withStay.add(agvId);
    for (const stay of result.stays) staysByLane.get(stay.laneId)?.push(stay);
    // Solo cuenta como arranque en frío si esa salida es también la primera lectura **de todas**
    // las del vehículo. Si antes hubo lecturas de anillo, no estaba dentro: entró y no se le vio.
    const first = firstReadingOf.get(agvId);
    if (result.startedInside !== null && first === result.startedInside.leftUtcMs) {
      startedInside.push(result.startedInside);
    }
  }

  const report: LaneReport[] = lanes.map((lane) => {
    const stays = (staysByLane.get(lane.laneId) ?? []).sort(
      (a, b) => (a.enteredUtcMs ?? a.leftUtcMs ?? 0) - (b.enteredUtcMs ?? b.leftUtcMs ?? 0),
    );
    const durations = stays
      .filter((stay) => stay.state === "completa" && stay.durationMs !== null)
      .map((stay) => stay.durationMs as number);
    const medianStayMs = durations.length >= thresholds.minStaysForMedian ? median(durations) : null;
    const longStays =
      medianStayMs === null
        ? []
        : stays.filter(
            (stay) =>
              stay.durationMs !== null && stay.durationMs > medianStayMs * thresholds.longStayRatio,
          );
    return {
      laneId: lane.laneId,
      capacity: lane.capacity,
      stays,
      medianStayMs,
      served: stays.length > 0,
      outOfSeniority: seniorityBreaches(stays),
      longStays,
    };
  });

  const neverCharged: NeverCharged[] = [...firstReadingOf.keys()]
    .filter((agvId) => !withStay.has(agvId))
    .sort()
    .map((agvId) => ({
      agvId,
      firstUtcMs: firstReadingOf.get(agvId) as number,
      lastUtcMs: lastReadingOf.get(agvId) as number,
      readings: readingCount.get(agvId) ?? 0,
    }));

  return { lanes: report, startedInside, coverageStartUtcMs, neverCharged };
}

/** De qué tag del anillo cuelga una calle: el que precede con más frecuencia a su tag de entrada. */
export interface LaneJunction {
  readonly laneId: string;
  readonly tagId: string;
}

/**
 * El punto del anillo del que sale cada calle, para poder dibujarla colgada de él.
 *
 * Es el predecesor **observado** más frecuente del tag de entrada, restringido al anillo: la calle
 * se declara (R-CO-001), pero dónde se engancha al circuito no viene en la lista, así que se mira en
 * el dato. Una calle en la que nadie entró desde el anillo no tiene punto de enganche y no se
 * inventa uno: no aparece.
 */
export function findLaneJunctions(
  lanes: readonly CoLane[],
  transitions: readonly { readonly from: string; readonly to: string }[],
  ring: readonly string[],
): readonly LaneJunction[] {
  const inRing = new Set(ring);
  const junctions: LaneJunction[] = [];
  for (const lane of lanes) {
    const counts = new Map<string, number>();
    for (const entry of transitions) {
      if (entry.to !== lane.entryTagId || !inRing.has(entry.from)) continue;
      counts.set(entry.from, (counts.get(entry.from) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [tagId, count] of counts) {
      if (count > bestCount || (count === bestCount && best !== null && tagId < best)) {
        best = tagId;
        bestCount = count;
      }
    }
    if (best !== null) junctions.push({ laneId: lane.laneId, tagId: best });
  }
  return junctions;
}
