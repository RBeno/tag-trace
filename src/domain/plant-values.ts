/**
 * Valores de planta del circuito: los que confirma una persona y los que propone la memoria (OQ-140,
 * OQ-151; `CONFIG_SCHEMA.md` §3.5 y §4).
 *
 * Siete valores de `PROVISIONAL_CONFIG` tienen aspecto de dato de planta —el régimen de noche, las
 * horas de arranque de turno, la hora sin leer que es desconexión, el bloqueo del primero de cola, la
 * tolerancia de «a la misma hora», el margen del FIFO y la duración mínima de una parada precisa—, que
 * son ocho claves porque la noche son dos (empieza y termina). El
 * propietario decidió (OQ-140) que no se fijan como configuración: tienen que salir del análisis y la
 * consolidación continua, y son provisionales hasta que la memoria los mida y una persona los confirme.
 *
 * El mecanismo: cada circuito guarda los valores que una persona confirma, cada uno con su fecha
 * efectiva y su razón, en un registro append-only (como el plano, ADR-0016). Al analizar un fichero
 * rige, por valor, el último confirmado cuya fecha efectiva no pasa del inicio del fichero; sin
 * ninguno, el provisional. Nada se aplica sin una persona que lo confirme con razón (ADR-0010).
 *
 * Los estimadores (OQ-151, propietario 2026-09-27: «usa la propuesta pero si no coinciden que los
 * valores los introduzca una persona»): cada instantánea guarda las medidas de su fichero
 * (`SnapshotPlantMeasures`, que produce `measurePlantValues` con lo que el Worker ya analizó), y
 * `estimatePlantValue` estima un valor con ellas. `proposePlantValues` aplica la regla de coincidencia
 * sobre las últimas versiones consolidadas no revocadas: solo si todas estiman lo mismo hay propuesta,
 * y una propuesta tampoco se aplica sola —la persona la confirma con razón (`origin: "propuesta"`)—.
 * Los números de la definición (la mitad de la mediana, los percentiles 99, 95 y 5) no están aquí:
 * viven en `AnalysisConfig.plantEstimators` con su razón.
 *
 * **Límite conocido (OQ-154).** Las repeticiones de una parada (`sameTimeAs`) se emparejan en
 * `flow-stops.ts` con la tolerancia **vigente** de «a la misma hora», y la noche se estima frente a la
 * noche **vigente**: el estimador de la tolerancia nunca propondrá un valor mayor que el vigente, y el
 * de las horas de turno solo ve las repeticiones que esa tolerancia dejó emparejar. Se dice en el
 * `why` de cada estimación; el estimador no cambia porque es la definición aprobada (OQ-151).
 *
 * `drift.minGapMs` (hueco entre periodos distantes) no está: OQ-151 lo sacó de la lista porque es de
 * análisis, no de planta.
 *
 * Puro: sin almacén, sin Worker, sin interfaz.
 */

import type { HourlyProfile } from "./activity.js";
import type { AnalysisConfig } from "./config.js";
import type { Interval } from "./coverage.js";
import type { InactivityPeriod } from "./dossier.js";
import type { SpanReport } from "./fifo.js";
import type { ProductionStop, VehicleStop } from "./flow-stops.js";
import { quantile } from "./graph.js";
import { sortVersions, type ConsolidatedVersion } from "./memory.js";
import { canonicalise } from "./semantic-hash.js";
import { localHourReader } from "./silence-kind.js";
import type { SnapshotPlantMeasures, SnapshotSampleSummary } from "./snapshot.js";

/** Las ocho claves de los siete valores de planta (la noche son dos), estables: viajan en el `.agvproj` y no se renombran. */
export type PlantValueKey =
  | "noche-desde"
  | "noche-hasta"
  | "arranque-turnos"
  | "desconexion"
  | "bloqueo-cabeza"
  | "misma-hora"
  | "margen-fifo"
  | "parada-precisa-minima";

/** Una hora del día (entera, 0–23), una lista de horas o una duración en milisegundos. */
export type PlantValueKind = "hora" | "horas" | "duracion";

/** Un valor: número (hora o milisegundos) o lista de horas. */
export type PlantValue = number | readonly number[];

/**
 * La sección de la interfaz donde el programa ya mide algo relacionado con el valor: la pestaña (por
 * su nombre visible), el título de la sección y qué se ve allí. Es para que la persona mire el dato
 * antes de confirmar; no es un estimador.
 */
export interface PlantValueSection {
  readonly tab: "Resumen" | "Tags" | "AGV" | "Tiempos" | "Línea y calles" | "Memoria" | "Datos";
  readonly heading: string;
  readonly what: string;
}

export interface PlantValueDefinition {
  readonly key: PlantValueKey;
  /** Qué es, en palabras de planta. */
  readonly label: string;
  readonly kind: PlantValueKind;
  /** Para una duración: en qué unidad se escribe y se enseña. */
  readonly inputUnit?: "min" | "s";
  /** Dónde vive en `AnalysisConfig`. */
  readonly path: string;
  /** La sección donde el programa mide algo relacionado, o `null` si no mide nada relacionado. */
  readonly measuredIn: PlantValueSection | null;
  /** El valor dentro de una configuración. */
  readonly read: (config: AnalysisConfig) => PlantValue;
  /** Una copia de la configuración con el valor puesto; no muta la de entrada. */
  readonly write: (config: AnalysisConfig, value: PlantValue) => AnalysisConfig;
}

/**
 * Tope de una duración: 24 h. **No es un dato de planta**: es un control de errores de tecleo (quien
 * quiere escribir 2 minutos y escribe 2000). Ninguno de estos valores tiene sentido por encima de un
 * día; si alguno lo tuviera, el tope se sube aquí con su razón.
 */
export const MAX_PLANT_DURATION_MS = 24 * 60 * 60_000;

const asNumber = (value: PlantValue): number => (typeof value === "number" ? value : Number.NaN);
const asHours = (value: PlantValue): readonly number[] => (typeof value === "number" ? [value] : [...value]);

/** El catálogo, en el orden en que se enseña. */
export const PLANT_VALUES: readonly PlantValueDefinition[] = [
  {
    key: "noche-desde",
    label: "Empieza la noche (régimen de noche)",
    kind: "hora",
    path: "regimes.nightFromHour",
    measuredIn: { tab: "Datos", heading: "Perfil horario", what: "las lecturas de cada hora del día: dónde baja la actividad" },
    read: (config) => config.regimes.nightFromHour,
    write: (config, value) => ({ ...config, regimes: { ...config.regimes, nightFromHour: asNumber(value) } }),
  },
  {
    key: "noche-hasta",
    label: "Termina la noche (régimen de noche)",
    kind: "hora",
    path: "regimes.nightToHour",
    measuredIn: { tab: "Datos", heading: "Perfil horario", what: "las lecturas de cada hora del día: dónde vuelve la actividad" },
    read: (config) => config.regimes.nightToHour,
    write: (config, value) => ({ ...config, regimes: { ...config.regimes, nightToHour: asNumber(value) } }),
  },
  {
    key: "arranque-turnos",
    label: "Horas de arranque de turno",
    kind: "horas",
    path: "silenceKind.shiftStartHours",
    measuredIn: { tab: "AGV", heading: "Flota del circuito", what: "las paradas de la producción, con su hora" },
    read: (config) => config.silenceKind.shiftStartHours,
    write: (config, value) => ({ ...config, silenceKind: { ...config.silenceKind, shiftStartHours: asHours(value) } }),
  },
  {
    key: "desconexion",
    label: "Tiempo sin leer que ya es desconexión",
    kind: "duracion",
    inputUnit: "min",
    path: "silenceKind.longAbsenceMs",
    measuredIn: { tab: "AGV", heading: "Vida de cada AGV en el circuito", what: "los huecos sin lecturas de cada AGV y cómo volvió" },
    read: (config) => config.silenceKind.longAbsenceMs,
    write: (config, value) => ({ ...config, silenceKind: { ...config.silenceKind, longAbsenceMs: asNumber(value) } }),
  },
  {
    key: "bloqueo-cabeza",
    label: "Bloqueo del primero de la cola",
    kind: "duracion",
    inputUnit: "min",
    path: "flowStops.headStallMs",
    measuredIn: { tab: "AGV", heading: "Flota del circuito", what: "los primeros de cola sin avanzar, con cuánto tiempo" },
    read: (config) => config.flowStops.headStallMs,
    write: (config, value) => ({ ...config, flowStops: { ...config.flowStops, headStallMs: asNumber(value) } }),
  },
  {
    key: "misma-hora",
    label: "Tolerancia de «a la misma hora»",
    kind: "duracion",
    inputUnit: "min",
    path: "flowStops.sameTimeToleranceMs",
    measuredIn: { tab: "AGV", heading: "Flota del circuito", what: "las paradas de la producción que se repiten a esa hora otro día" },
    read: (config) => config.flowStops.sameTimeToleranceMs,
    write: (config, value) => ({ ...config, flowStops: { ...config.flowStops, sameTimeToleranceMs: asNumber(value) } }),
  },
  {
    key: "margen-fifo",
    label: "Margen del FIFO en zona cargada",
    kind: "duracion",
    inputUnit: "min",
    path: "fifo.minOvertakeMarginMs",
    measuredIn: {
      tab: "Línea y calles",
      heading: "Orden de paso en zona cargada (FIFO)",
      what: "el tránsito de cada tramo cargado y los adelantamientos (solo con la lista «zona»)",
    },
    read: (config) => config.fifo.minOvertakeMarginMs,
    write: (config, value) => ({ ...config, fifo: { ...config.fifo, minOvertakeMarginMs: asNumber(value) } }),
  },
  {
    key: "parada-precisa-minima",
    label: "Duración mínima de una parada precisa",
    kind: "duracion",
    inputUnit: "s",
    path: "criticalPoints.paradaPrecisa.minDurationMs",
    measuredIn: { tab: "Tiempos", heading: "Candidatos a punto crítico", what: "las esperas de los candidatos a parada precisa" },
    read: (config) => config.criticalPoints.paradaPrecisa.minDurationMs,
    write: (config, value) => ({
      ...config,
      criticalPoints: { ...config.criticalPoints, paradaPrecisa: { ...config.criticalPoints.paradaPrecisa, minDurationMs: asNumber(value) } },
    }),
  },
];

const BY_KEY = new Map<string, PlantValueDefinition>(PLANT_VALUES.map((definition) => [definition.key, definition]));

/** La definición de una clave, o `undefined` si no es un valor de planta. */
export function plantValueDefinition(key: string): PlantValueDefinition | undefined {
  return BY_KEY.get(key);
}

export function isPlantValueKey(key: unknown): key is PlantValueKey {
  return typeof key === "string" && BY_KEY.has(key);
}

/**
 * Un valor confirmado. Append-only: nunca se reescribe; una corrección es otro evento con su fecha y
 * su razón. `effectiveAt` es desde cuándo rige; `recordedAt`, cuándo se escribió.
 */
export interface PlantValueEvent {
  readonly circuitId: string;
  readonly seq: number;
  readonly key: PlantValueKey;
  readonly value: PlantValue;
  readonly effectiveAt: number;
  readonly recordedAt: number;
  /** Por qué: no vacía. */
  readonly reason: string;
  /**
   * Siempre lo confirma una persona. `manual`: el valor lo escribió ella. `propuesta`: confirmó la
   * propuesta de la memoria (OQ-151), que el Worker volvió a calcular antes de escribir.
   */
  readonly origin: "manual" | "propuesta";
  /** Solo con `origin: "propuesta"`: las versiones consolidadas en que coincidieron las estimaciones. */
  readonly fromVersions?: readonly number[];
}

const isHour = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 23;

/**
 * Qué le pasa a un valor para esa clave, en español, o `null` si vale. Horas: enteras de 0 a 23. Lista
 * de horas: al menos una, cada una entera de 0 a 23, sin repetir. Duración: milisegundos enteros, más
 * que cero y hasta `MAX_PLANT_DURATION_MS`.
 */
export function validatePlantValue(key: string, value: unknown): string | null {
  const definition = BY_KEY.get(key);
  if (definition === undefined) return `«${key}» no es un valor de planta.`;
  switch (definition.kind) {
    case "hora":
      return isHour(value) ? null : "La hora tiene que ser un número entero de 0 a 23.";
    case "horas": {
      if (!Array.isArray(value) || value.length === 0) return "Hace falta al menos una hora de arranque.";
      if (!value.every(isHour)) return "Cada hora de arranque tiene que ser un número entero de 0 a 23.";
      if (new Set(value).size !== value.length) return "Hay una hora de arranque repetida.";
      return null;
    }
    case "duracion":
      if (typeof value !== "number" || !Number.isFinite(value)) return "La duración tiene que ser un número.";
      if (value <= 0) return "La duración tiene que ser mayor que cero.";
      if (!Number.isInteger(value)) return "La duración tiene que ser un número entero de milisegundos.";
      if (value > MAX_PLANT_DURATION_MS) return "La duración pasa de 24 horas: revisa si está bien escrita.";
      return null;
  }
}

/** Qué le falta a un evento guardado o traído en un `.agvproj` para tener la forma esperada, o `null`. */
export function plantValueEventProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "un valor no es un objeto";
  const event = value as Record<string, unknown>;
  if (typeof event["circuitId"] !== "string") return "un valor no tiene circuito";
  if (!Number.isInteger(event["seq"])) return "un valor no tiene número";
  if (!isPlantValueKey(event["key"])) return "un valor tiene una clave desconocida";
  if (typeof event["effectiveAt"] !== "number" || !Number.isFinite(event["effectiveAt"])) return "un valor no tiene fecha efectiva";
  if (typeof event["recordedAt"] !== "number" || !Number.isFinite(event["recordedAt"])) return "un valor no tiene fecha de registro";
  if (typeof event["reason"] !== "string" || event["reason"].trim() === "") return "un valor no tiene razón";
  if (event["origin"] !== "manual" && event["origin"] !== "propuesta") return "un valor no tiene origen";
  const from = event["fromVersions"];
  if (from !== undefined && (!Array.isArray(from) || !from.every((entry) => Number.isInteger(entry)))) return "un valor tiene versiones de origen inválidas";
  const problem = validatePlantValue(event["key"], event["value"]);
  return problem === null ? null : `un valor no vale: ${problem}`;
}

/** Orden de vigencia: fecha efectiva y, a igual fecha, el registrado después. */
function byEffect(a: PlantValueEvent, b: PlantValueEvent): number {
  return a.effectiveAt - b.effectiveAt || a.seq - b.seq;
}

/**
 * Los valores que rigen en un instante: por clave, el último evento con `effectiveAt <= at` en orden
 * (`effectiveAt`, `seq`). Una clave sin evento vigente no está en el resultado: rige la provisional.
 */
export function plantValuesAt(events: readonly PlantValueEvent[], at: number): ReadonlyMap<PlantValueKey, PlantValueEvent> {
  const out = new Map<PlantValueKey, PlantValueEvent>();
  for (const event of [...events].sort(byEffect)) {
    if (event.effectiveAt > at) break;
    out.set(event.key, event);
  }
  return out;
}

/**
 * La configuración con los valores confirmados puestos, sin mutar la de entrada. Sin valores devuelve
 * **la misma** configuración (no una copia): el análisis sin valores confirmados es el de siempre.
 * Con alguno, `configVersion` dice cuáles —clave y número de evento—, para que el análisis repetido
 * diga con qué se hizo (FR-031). El estado no cambia: el resto de la configuración sigue provisional.
 */
export function applyPlantValues(config: AnalysisConfig, values: ReadonlyMap<PlantValueKey, Pick<PlantValueEvent, "value" | "seq">>): AnalysisConfig {
  if (values.size === 0) return config;
  let out = config;
  const applied: string[] = [];
  for (const definition of PLANT_VALUES) {
    const entry = values.get(definition.key);
    if (entry === undefined) continue;
    out = definition.write(out, entry.value);
    applied.push(`${definition.key}#${entry.seq}`);
  }
  return { ...out, configVersion: `${config.configVersion}+planta(${applied.join(",")})` };
}

/** La configuración con que se analiza un fichero que empieza en `at`: la base con lo confirmado hasta entonces. */
export function resolveAnalysisConfig(base: AnalysisConfig, events: readonly PlantValueEvent[], at: number): AnalysisConfig {
  return applyPlantValues(base, plantValuesAt(events, at));
}

/** Un valor en palabras: «22:00», «06:00, 14:00 y 22:00», «2 min», «30 s». Solo formato. */
export function formatPlantValue(kind: PlantValueKind, inputUnit: "min" | "s" | undefined, value: PlantValue): string {
  const hour = (entry: number): string => `${String(entry).padStart(2, "0")}:00`;
  if (kind === "hora") return typeof value === "number" ? hour(value) : "—";
  if (kind === "horas") {
    const hours = (typeof value === "number" ? [value] : [...value]).sort((a, b) => a - b).map(hour);
    return hours.length <= 1 ? (hours[0] ?? "—") : `${hours.slice(0, -1).join(", ")} y ${hours[hours.length - 1] as string}`;
  }
  if (typeof value !== "number") return "—";
  const unitMs = inputUnit === "s" ? 1000 : 60_000;
  const amount = (value / unitMs).toLocaleString("es-ES", { maximumFractionDigits: 3 });
  return `${amount} ${inputUnit ?? "min"}`;
}

// --- Medidas y estimadores (OQ-151) --------------------------------------------------------------

const HOUR_MS = 3_600_000;
const DAY_MINUTES = 24 * 60;

/**
 * Los números de la definición de los estimadores (OQ-151), en configuración (`PROVISIONAL_CONFIG.plantEstimators`):
 * la parte de la mediana de producción por debajo de la cual una hora es de noche, y los cuantiles de
 * los huecos que volvieron, de las esperas del primero de cola y de las esperas en una parada precisa.
 */
export interface PlantEstimatorThresholds {
  readonly nightLowShare: number;
  readonly returnGapQuantile: number;
  readonly headWaitQuantile: number;
  readonly precisePauseQuantile: number;
}

/** «percentil 99». */
const percentile = (quantile: number): string => `percentil ${Math.round(quantile * 100)}`;

/** «la mitad» o «el 40 %» de algo. */
const shareText = (share: number): string => (share === 0.5 ? "la mitad" : `el ${Math.round(share * 100)} %`);

/**
 * Lo que el Worker ya analizó para la ventana de trabajo, para reducirlo a las medidas de un fichero.
 * Nada de esto se vuelve a medir aquí: se recorta a la ventana del fichero y se resume.
 */
export interface PlantMeasureInput {
  /** La ventana completa del fichero (R-DAT-007). */
  readonly window: Interval;
  readonly zone: string;
  /** Los cuantiles con que se resumen las muestras (`config.plantEstimators`): los de la definición aprobada. */
  readonly estimators: PlantEstimatorThresholds;
  /** `hourlyProfile` sobre las lecturas de la flota en la ventana del fichero. */
  readonly hourly: Pick<HourlyProfile, "counts" | "days">;
  /** `productionStops(...).stops` de la ventana de trabajo. */
  readonly productionStops: readonly ProductionStop[];
  /** `AgvDossier.inactivity` de todos los AGV. */
  readonly gaps: readonly Pick<InactivityPeriod, "fromUtcMs" | "toUtcMs" | "durationMs" | "cause">[];
  /** `flowStops(...).stops` de todos los cohortes. */
  readonly vehicleStops: readonly Pick<VehicleStop, "fromTagId" | "toTagId" | "fromUtcMs" | "toUtcMs" | "excessMs" | "justification">[];
  /** `buildFifoReport` del cohorte principal en la ventana del fichero; `null` sin lista `zona`. */
  readonly loadedSpans: readonly Pick<SpanReport, "spanId" | "passes" | "medianTransitMs" | "p95TransitMs">[] | null;
  /**
   * Las esperas de producción en las paradas precisas declaradas (`transitionDurationsByTag`) que
   * empiezan en la ventana del fichero, cuántas hay declaradas y si la hora de la fuente permite medir
   * esperas (`timeSignaturesMeasurable`).
   */
  readonly precisePauses: { readonly declared: number; readonly measurable: boolean; readonly durationsMs: readonly number[] };
}

function summary(values: readonly number[], fraction: number): SnapshotSampleSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, valueMs: sorted.length === 0 ? null : quantile(sorted, fraction) };
}

/** El día y el minuto locales de un instante, en la zona del circuito. */
function localDayMinute(zone: string): (utcMs: number) => { readonly day: string; readonly minute: number } {
  const clock = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (utcMs) => {
    const parts = clock.formatToParts(new Date(utcMs));
    const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "0";
    return { day: `${get("year")}-${get("month")}-${get("day")}`, minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
  };
}

/** Cuánto de cada hora local cubre una ventana, en ms: por cuartos de hora, como `productionStops`. */
function hourlyCoverage(window: Interval, zone: string): readonly number[] {
  const covered = new Array<number>(24).fill(0);
  const hourOf = localHourReader(zone);
  const quarter = 15 * 60_000;
  for (let cursor = window.from; cursor < window.to; ) {
    const next = Math.min(window.to, (Math.floor(cursor / quarter) + 1) * quarter);
    const hour = hourOf(cursor);
    covered[hour] = (covered[hour] ?? 0) + (next - cursor);
    cursor = next;
  }
  return covered;
}

/**
 * Las medidas de los valores de planta de un fichero, para su instantánea. Recorta a la ventana del
 * fichero lo que el Worker ya analizó y lo resume en los percentiles que piden los estimadores
 * (`quantile` de `graph.ts`, el mismo de las horquillas):
 *
 * - huecos de los AGV que volvieron a leer: los del expediente (todos terminan en una lectura), sin
 *   los que explica una calle de carga, que nunca se comparan con `longAbsenceMs`; cuantil
 *   `estimators.returnGapQuantile` (99 en la definición aprobada);
 * - esperas del primero de cola: las paradas `sin-explicacion` —las que `flowStops` compara con
 *   `headStallMs` para decir «bloqueo»— que acabaron en otro tag, con su exceso sobre lo habitual;
 *   cuantil `estimators.headWaitQuantile` (95);
 * - esperas en las paradas precisas declaradas: cuantil `estimators.precisePauseQuantile` (5).
 *
 * Las repeticiones de cada parada (`sameTimeAs`) son las que `flow-stops.ts` emparejó con la
 * tolerancia vigente de «a la misma hora»: la medida hereda ese límite (OQ-154).
 */
export function measurePlantValues(input: PlantMeasureInput): SnapshotPlantMeasures {
  const { window, estimators } = input;
  const inside = (from: number, to: number): boolean => from >= window.from && to <= window.to;
  const local = localDayMinute(input.zone);
  const stops = input.productionStops.filter((stop) => stop.fromUtcMs >= window.from && stop.fromUtcMs <= window.to);
  const indexOf = new Map(stops.map((stop, index) => [stop.fromUtcMs, index]));
  return {
    hourly: { readings: [...input.hourly.counts], coveredMs: hourlyCoverage(window, input.zone) },
    days: input.hourly.days,
    productionStops: stops.map((stop) => ({
      ...local(stop.fromUtcMs),
      sameTimeAs: stop.sameTimeOn
        .map((from) => indexOf.get(from))
        .filter((index): index is number => index !== undefined)
        .sort((a, b) => a - b),
    })),
    returnGaps: summary(
      input.gaps.filter((gap) => gap.cause !== "carga-online" && inside(gap.fromUtcMs, gap.toUtcMs)).map((gap) => gap.durationMs),
      estimators.returnGapQuantile,
    ),
    headWaits: summary(
      input.vehicleStops
        .filter((stop) => stop.justification === "sin-explicacion" && stop.toTagId !== stop.fromTagId && inside(stop.fromUtcMs, stop.toUtcMs))
        .map((stop) => stop.excessMs),
      estimators.headWaitQuantile,
    ),
    loadedSpans:
      input.loadedSpans === null
        ? null
        : input.loadedSpans.flatMap((span) =>
            span.medianTransitMs === null || span.p95TransitMs === null
              ? []
              : [{ spanId: span.spanId, passes: span.passes, medianTransitMs: span.medianTransitMs, p95TransitMs: span.p95TransitMs }],
          ),
    precisePauses: {
      declared: input.precisePauses.declared,
      measurable: input.precisePauses.measurable,
      ...summary(input.precisePauses.measurable ? input.precisePauses.durationsMs : [], estimators.precisePauseQuantile),
    },
  };
}

/** Una estimación de un fichero: el valor redondeado a su unidad, o `null` y por qué no se puede. */
export interface PlantValueEstimation {
  readonly value: PlantValue | null;
  readonly why: string;
}

const fmtCount = (value: number): string => value.toLocaleString("es-ES");

/** Diferencia de minutos del día, con signo, por el camino corto (cruza la medianoche). */
function minuteDiff(a: number, b: number): number {
  return ((((a - b + DAY_MINUTES / 2) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES) - DAY_MINUTES / 2;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const isNightHour = (hour: number, config: AnalysisConfig): boolean => {
  const { nightFromHour: from, nightToHour: to } = config.regimes;
  return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to;
};

/**
 * El régimen de noche de un fichero: las horas seguidas cuyas lecturas de la flota por hora quedan por
 * debajo de `nightLowShare` (la mitad) de la mediana de las horas de producción (las de fuera de la
 * noche vigente: la referencia depende de la noche que rige, OQ-154). Lecturas por hora cubierta, para
 * que una hora que el fichero cubre a medias no parezca de noche; y cada hora del día tiene que estar
 * cubierta entera al menos una vez, o no hay perfil de un día que leer. Con dos tramos bajos igual de
 * largos no se elige.
 */
function estimateNight(measures: SnapshotPlantMeasures, config: AnalysisConfig): { readonly from: number; readonly to: number } | { readonly why: string } {
  const { readings, coveredMs } = measures.hourly;
  const uncovered = coveredMs.map((ms, hour) => (ms < HOUR_MS ? hour : -1)).filter((hour) => hour >= 0);
  if (coveredMs.length !== 24 || uncovered.length > 0) {
    return { why: `el fichero no cubre entera cada hora del día (le faltan ${uncovered.length === 1 ? "1 hora" : `${uncovered.length} horas`})` };
  }
  const rates = readings.map((count, hour) => (count / (coveredMs[hour] as number)) * HOUR_MS);
  const production = rates.filter((_, hour) => !isNightHour(hour, config));
  if (production.length === 0) return { why: "la noche vigente ocupa todo el día: no hay horas de producción con que comparar" };
  const reference = median(production);
  if (reference <= 0) return { why: "las horas de producción no tienen lecturas" };
  const share = config.plantEstimators.nightLowShare;
  const low = rates.map((rate) => rate < reference * share);
  if (!low.some(Boolean)) return { why: `ninguna hora baja de ${shareText(share)} de la mediana de producción (${fmtCount(Math.round(reference))} lecturas por hora)` };
  if (low.every(Boolean)) return { why: `todas las horas quedan por debajo de ${shareText(share)} de la mediana de producción` };
  const runs: { from: number; length: number }[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    if (!low[hour] || low[(hour + 23) % 24]) continue;
    let length = 0;
    while (low[(hour + length) % 24]) length += 1;
    runs.push({ from: hour, length });
  }
  const longest = Math.max(...runs.map((run) => run.length));
  const best = runs.filter((run) => run.length === longest);
  if (best.length > 1) return { why: `hay ${best.length} tramos de horas bajas igual de largos (${longest} h): no se elige uno` };
  const run = best[0] as { from: number; length: number };
  return { from: run.from, to: (run.from + run.length) % 24 };
}

/** El minuto del día en torno al que se repite una parada: el suyo más la media de las diferencias con sus repeticiones. */
function repeatCentre(stops: SnapshotPlantMeasures["productionStops"], index: number): number {
  const own = stops[index] as SnapshotPlantMeasures["productionStops"][number];
  const others = own.sameTimeAs.map((other) => (stops[other] as SnapshotPlantMeasures["productionStops"][number]).minute);
  const shift = [0, ...others.map((minute) => minuteDiff(minute, own.minute))].reduce((sum, value) => sum + value, 0) / (others.length + 1);
  return (((own.minute + shift) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
}

/** Una duración redondeada a la unidad del catálogo (minutos o segundos), validada. */
function durationEstimate(definition: PlantValueDefinition, ms: number, what: string): PlantValueEstimation {
  const unitMs = definition.inputUnit === "s" ? 1000 : 60_000;
  const value = Math.round(ms / unitMs) * unitMs;
  const problem = validatePlantValue(definition.key, value);
  if (problem !== null) {
    return { value: null, why: `${what} redondeado a ${definition.inputUnit === "s" ? "segundos" : "minutos"} no vale: ${problem}` };
  }
  return { value, why: what };
}

function sampleEstimate(
  definition: PlantValueDefinition,
  sample: SnapshotSampleSummary,
  minSamples: number,
  names: { readonly what: string; readonly samples: string },
): PlantValueEstimation {
  if (sample.n === 0 || sample.valueMs === null) return { value: null, why: `sin datos: no hay ${names.samples}` };
  if (sample.n < minSamples) {
    return { value: null, why: `sin datos: solo ${fmtCount(sample.n)} ${names.samples}, y hacen falta ${fmtCount(minSamples)}` };
  }
  return durationEstimate(definition, sample.valueMs, `${names.what} de ${fmtCount(sample.n)} ${names.samples}`);
}

/**
 * La estimación de un valor de planta con las medidas de **un** fichero, redondeada a la unidad del
 * valor (hora entera; lista de horas como conjunto; minutos o segundos según el catálogo). `null`, con
 * su porqué, cuando el fichero no permite estimarlo: nunca se completa con la hipótesis más probable.
 *
 * `currentConfig` es la configuración vigente: da la noche vigente (para saber qué horas son de
 * producción) y las muestras mínimas, que no son nuevas: `bands.minBandSamples` para los huecos y las
 * esperas del primero de cola, `criticalPoints.paradaPrecisa.minSamples` para las paradas precisas, y
 * `fifo.minPassesForSpan` ya filtró los tramos cargados al medirlos.
 */
export function estimatePlantValue(key: PlantValueKey, measures: SnapshotPlantMeasures, currentConfig: AnalysisConfig): PlantValueEstimation {
  const definition = BY_KEY.get(key) as PlantValueDefinition;
  switch (key) {
    case "noche-desde":
    case "noche-hasta": {
      const night = estimateNight(measures, currentConfig);
      if ("why" in night) return { value: null, why: `sin datos: ${night.why}` };
      const pad = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
      const { nightFromHour, nightToHour } = currentConfig.regimes;
      return {
        value: key === "noche-desde" ? night.from : night.to,
        why:
          `horas por debajo de ${shareText(currentConfig.plantEstimators.nightLowShare)} de la mediana de producción: de ${pad(night.from)} a ${pad(night.to)}` +
          ` (la mediana es la de fuera de la noche vigente, ${pad(nightFromHour)}–${pad(nightToHour)}; OQ-154)`,
      };
    }
    case "arranque-turnos":
    case "misma-hora": {
      if (measures.days < 2) return { value: null, why: "sin datos: el fichero es de un solo día y hacen falta dos para ver una parada que se repite" };
      const stops = measures.productionStops;
      const repeating = stops.map((stop, index) => ({ stop, index })).filter(({ stop }) => stop.sameTimeAs.length > 0);
      // OQ-154: las repeticiones se emparejaron con la tolerancia vigente, así que la estimación hereda ese límite.
      const tolerance = formatPlantValue("duracion", "min", currentConfig.flowStops.sameTimeToleranceMs);
      if (repeating.length === 0) {
        return { value: null, why: `sin datos: ninguna parada de la producción se repite a la misma hora otro día (con la tolerancia vigente de ${tolerance}; OQ-154)` };
      }
      if (key === "arranque-turnos") {
        const hours = [...new Set(repeating.map(({ index }) => Math.round(repeatCentre(stops, index) / 60) % 24))].sort((a, b) => a - b);
        return {
          value: hours,
          why: `${fmtCount(repeating.length)} paradas de la producción que se repiten a la misma hora otro día (emparejadas con la tolerancia vigente de ${tolerance}; OQ-154)`,
        };
      }
      let widest = 0;
      for (const { stop } of repeating) {
        for (const other of stop.sameTimeAs) {
          widest = Math.max(widest, Math.abs(minuteDiff((stops[other] as typeof stop).minute, stop.minute)));
        }
      }
      return durationEstimate(
        definition,
        widest * 60_000,
        `mayor diferencia de hora entre ${fmtCount(repeating.length)} repeticiones, emparejadas con la tolerancia vigente de ${tolerance}: no puede salir un valor mayor que ella (OQ-154)`,
      );
    }
    case "desconexion":
      return sampleEstimate(definition, measures.returnGaps, currentConfig.bands.minBandSamples, {
        samples: "huecos de AGV que volvieron a leer",
        what: percentile(currentConfig.plantEstimators.returnGapQuantile),
      });
    case "bloqueo-cabeza":
      return sampleEstimate(definition, measures.headWaits, currentConfig.bands.minBandSamples, {
        samples: "esperas del primero de cola que acabaron avanzando",
        what: percentile(currentConfig.plantEstimators.headWaitQuantile),
      });
    case "margen-fifo": {
      if (measures.loadedSpans === null) return { value: null, why: "sin datos: sin la lista «zona» no hay tramos de zona cargada" };
      if (measures.loadedSpans.length === 0) return { value: null, why: "sin datos: ningún tramo de zona cargada tiene pasadas completas suficientes" };
      // Con varios tramos cargados rige un solo margen: el del tramo que más varía, para que ninguno
      // convierta su vaivén normal en adelantamientos.
      const widest = Math.max(...measures.loadedSpans.map((span) => span.p95TransitMs - span.medianTransitMs));
      return durationEstimate(
        definition,
        widest,
        `percentil 95 menos mediana del tránsito${measures.loadedSpans.length === 1 ? "" : ` (el mayor de ${measures.loadedSpans.length} tramos cargados)`}`,
      );
    }
    case "parada-precisa-minima": {
      const pauses = measures.precisePauses;
      if (pauses.declared === 0) return { value: null, why: "sin datos: no hay paradas precisas declaradas" };
      if (!pauses.measurable) return { value: null, why: "sin datos: la hora del fichero va al minuto y no mide esperas" };
      return sampleEstimate(definition, pauses, currentConfig.criticalPoints.paradaPrecisa.minSamples, {
        samples: "esperas en las paradas precisas declaradas",
        what: percentile(currentConfig.plantEstimators.precisePauseQuantile),
      });
    }
  }
}

// --- Regla de coincidencia (OQ-151) --------------------------------------------------------------

/** La estimación de una versión consolidada. */
export interface PlantValueEstimate {
  readonly version: number;
  readonly fileName: string;
  readonly value: PlantValue | null;
  readonly why: string;
}

/** Lo que la memoria propone para un valor: la propuesta, o `null`, con las estimaciones de cada versión. */
export interface PlantValueProposal {
  readonly key: PlantValueKey;
  /** El valor en que coinciden todas las estimaciones; `null` si no coinciden o alguna no se puede hacer. */
  readonly proposal: PlantValue | null;
  /** Una por versión mirada, de la más antigua a la última. */
  readonly estimates: readonly PlantValueEstimate[];
  /** Por qué hay o no hay propuesta, en una frase que la interfaz enseña tal cual. */
  readonly reason: string;
  /** Qué hace falta: `coinciden`, `no-coinciden` o `faltan-versiones`. */
  readonly outcome: "coinciden" | "no-coinciden" | "faltan-versiones";
}

export type PlantValueProposals = Readonly<Record<PlantValueKey, PlantValueProposal>>;

export interface PlantProposalThresholds {
  /** Versiones seguidas que tienen que coincidir: `changeClass.sustainedFiles` (3, OQ-146). */
  readonly sustainedFiles: number;
  /** La configuración vigente: la noche vigente y las muestras mínimas de cada estimador. */
  readonly config: AnalysisConfig;
}

/** Forma canónica de un valor para compararlo: un número, o la lista de horas como conjunto ordenado. */
export function plantValueKey(value: PlantValue): string {
  return typeof value === "number" ? String(value) : [...new Set(value)].sort((a, b) => a - b).join(",");
}

/** «v4, v5 y v6». */
function versionList(versions: readonly number[]): string {
  const names = versions.map((version) => `v${version}`);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1] as string}`;
}

/**
 * La regla de coincidencia (OQ-151; interpretación del orquestador, 2026-09-27): se estima en cada una
 * de las últimas `sustainedFiles` versiones consolidadas **no revocadas** del linaje que se pasa (el
 * activo), con las medidas de la instantánea de cada una. Si hay al menos `sustainedFiles`
 * estimaciones y todas coinciden, se propone ese valor. Si no coinciden, o alguna versión no permite
 * estimar —instantánea anterior a las medidas, sin datos, o un fichero de un solo día para lo que
 * necesita dos—, no se propone nada y se enseñan las estimaciones de cada una para que una persona
 * introduzca el valor. Una propuesta nunca se aplica sola.
 */
export function proposePlantValues(
  versions: readonly Pick<ConsolidatedVersion, "version" | "createdAt" | "revoked" | "snapshot">[],
  thresholds: PlantProposalThresholds,
): PlantValueProposals {
  const wanted = Math.max(1, thresholds.sustainedFiles);
  const live = sortVersions(versions as readonly ConsolidatedVersion[]).filter((version) => version.revoked === null);
  const last = live.slice(-wanted);
  const out = {} as Record<PlantValueKey, PlantValueProposal>;
  for (const definition of PLANT_VALUES) {
    const estimates: PlantValueEstimate[] = last.map((version) => {
      const measures = version.snapshot.plantMeasures;
      if (measures === undefined) {
        return { version: version.version, fileName: version.snapshot.fileName, value: null, why: "sin datos: su instantánea es anterior a las medidas de planta" };
      }
      const estimation = estimatePlantValue(definition.key, measures, thresholds.config);
      return { version: version.version, fileName: version.snapshot.fileName, value: estimation.value, why: estimation.why };
    });
    const numbers = estimates.map((estimate) => estimate.version);
    let proposal: PlantValue | null = null;
    let outcome: PlantValueProposal["outcome"];
    let reason: string;
    if (estimates.length < wanted) {
      outcome = "faltan-versiones";
      reason =
        `hacen falta ${wanted} versiones consolidadas no revocadas y ` +
        (estimates.length === 0 ? "no hay ninguna" : estimates.length === 1 ? "hay 1" : `hay ${estimates.length}`);
    } else {
      const values = estimates.map((estimate) => estimate.value);
      const keys = new Set(values.map((value) => (value === null ? null : plantValueKey(value))));
      const first = values[0];
      if (keys.size === 1 && first !== null && first !== undefined) {
        outcome = "coinciden";
        proposal = typeof first === "number" ? first : [...new Set(first)].sort((a, b) => a - b);
        reason = `coincide en ${versionList(numbers)}`;
      } else {
        outcome = "no-coinciden";
        const known = new Set(values.flatMap((value) => (value === null ? [] : [plantValueKey(value)])));
        reason =
          known.size > 1
            ? "las estimaciones no coinciden"
            : known.size === 0
              ? "ninguna versión permite estimarlo"
              : "no todas las versiones permiten estimarlo";
      }
    }
    out[definition.key] = { key: definition.key, proposal, estimates, reason, outcome };
  }
  return out;
}

// --- Confirmar un valor ---------------------------------------------------------------------------

/** Lo que pide la persona al confirmar un valor, a mano o desde la propuesta de la memoria. */
export interface PlantValueRequest {
  readonly key: unknown;
  readonly value: unknown;
  readonly effectiveAt: unknown;
  readonly reason: unknown;
  readonly origin: "manual" | "propuesta";
}

/**
 * El evento que se escribe al confirmar un valor, o por qué no se escribe. Todo se valida aquí aunque
 * la interfaz ya lo validara: razón no vacía, clave conocida, valor válido y fecha efectiva.
 *
 * Con `origin: "propuesta"`, `proposal` es la propuesta **recalculada por el Worker** con las versiones
 * consolidadas, no la que enseñó la interfaz: si ya no hay propuesta, o el valor pedido no es el
 * propuesto, se rechaza. El evento guarda el valor propuesto, `origin: "propuesta"` y las versiones
 * en que coincidió. Ninguna propuesta se escribe sin una persona que la confirme con su razón.
 */
export function plantValueEventFor(input: {
  readonly circuitId: string;
  readonly events: readonly PlantValueEvent[];
  readonly request: PlantValueRequest;
  readonly recordedAt: number;
  readonly proposal?: PlantValueProposal | null;
}): { readonly event: PlantValueEvent } | { readonly cause: string; readonly recovery: string } {
  const { request } = input;
  const reason = typeof request.reason === "string" ? request.reason.trim() : "";
  if (reason === "") {
    return { cause: "La razón está vacía: ningún valor de planta se confirma sin su justificación.", recovery: "Escribe por qué es ese el valor de tu planta y vuelve a confirmarlo." };
  }
  if (!isPlantValueKey(request.key)) return { cause: `«${String(request.key)}» no es un valor de planta.`, recovery: "Elige uno de la lista." };
  const problem = validatePlantValue(request.key, request.value);
  if (problem !== null) return { cause: problem, recovery: "Corrige el valor y vuelve a confirmarlo." };
  if (typeof request.effectiveAt !== "number" || !Number.isFinite(request.effectiveAt)) {
    return { cause: "Falta la fecha desde la que rige el valor.", recovery: "Elige la fecha efectiva y vuelve a confirmarlo." };
  }
  const value = request.value as PlantValue;
  const base = {
    circuitId: input.circuitId,
    seq: input.events.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1,
    key: request.key,
    effectiveAt: request.effectiveAt,
    recordedAt: input.recordedAt,
    reason,
  };
  if (request.origin !== "propuesta") {
    return { event: { ...base, value: typeof value === "number" ? value : [...value], origin: "manual" } };
  }
  const proposal = input.proposal ?? null;
  if (proposal === null || proposal.key !== request.key || proposal.proposal === null) {
    return {
      cause: `La memoria ya no propone ningún valor para «${plantValueDefinition(request.key)?.label ?? request.key}»${proposal === null ? "" : `: ${proposal.reason}`}.`,
      recovery: "No se ha guardado nada. Vuelve a cargar el fichero para ver las estimaciones e introduce el valor a mano.",
    };
  }
  if (plantValueKey(proposal.proposal) !== plantValueKey(value)) {
    return {
      cause: "La propuesta de la memoria ha cambiado desde que se enseñó.",
      recovery: "No se ha guardado nada. Vuelve a cargar el fichero para ver la propuesta de ahora.",
    };
  }
  const proposed = proposal.proposal;
  return {
    event: {
      ...base,
      value: typeof proposed === "number" ? proposed : [...proposed],
      origin: "propuesta",
      fromVersions: proposal.estimates.map((estimate) => estimate.version),
    },
  };
}

// --- Vista ---------------------------------------------------------------------------------------

/** Un valor tal como lo enseña la pestaña Datos: todo ya resuelto aquí, la interfaz solo lo pone en palabras. */
export interface PlantValueView {
  readonly key: PlantValueKey;
  readonly label: string;
  readonly kind: PlantValueKind;
  readonly inputUnit?: "min" | "s";
  readonly path: string;
  readonly provisional: PlantValue;
  /** El confirmado que rige para el fichero de trabajo, o `null`: rige el provisional. */
  readonly current: PlantValueEvent | null;
  /**
   * Un confirmado cuya fecha efectiva cae dentro de la ventana de trabajo, después de su inicio: todo
   * lo cargado se analiza con el vigente al inicio del fichero, así que a un lado de esa fecha se lee
   * con un valor que allí no regía (`CONFIG_SCHEMA.md` §4: se declara, no se calla). `null` si no hay.
   */
  readonly changesWithin: PlantValueEvent | null;
  /** Todos los confirmados de esta clave, del primero al último registrado. */
  readonly history: readonly PlantValueEvent[];
  readonly measuredIn: PlantValueSection | null;
  /**
   * Lo que propone la memoria (OQ-151): la propuesta o su ausencia, con las estimaciones de cada
   * versión. `null` si no se calculó (sin circuito donde haya memoria).
   */
  readonly proposal: PlantValueProposal | null;
}

export interface PlantValuesView {
  /** El instante con que se resuelve lo vigente: el inicio del fichero de trabajo, o `null` si no hay. */
  readonly at: number | null;
  readonly fileName: string | null;
  /** Si el circuito puede guardar valores: sin circuito acumulado no hay dónde. */
  readonly canConfirm: boolean;
  readonly values: readonly PlantValueView[];
}

/**
 * La vista de los ocho valores para un fichero de trabajo que empieza en `at` (o sin fichero, `null`,
 * donde no rige ningún confirmado). `window` es la ventana de trabajo, para declarar un cambio dentro.
 * `proposals` son las propuestas de la memoria, que el Worker calcula con `proposePlantValues`.
 */
export function plantValuesView(input: {
  readonly events: readonly PlantValueEvent[];
  readonly provisional: AnalysisConfig;
  readonly at: number | null;
  readonly fileName: string | null;
  readonly window: { readonly from: number; readonly to: number } | null;
  readonly canConfirm: boolean;
  /** Las propuestas de la memoria (`proposePlantValues`); sin ellas, `proposal: null` en cada valor. */
  readonly proposals?: PlantValueProposals | null;
}): PlantValuesView {
  const current = input.at === null ? new Map<PlantValueKey, PlantValueEvent>() : plantValuesAt(input.events, input.at);
  const ordered = [...input.events].sort((a, b) => a.seq - b.seq);
  const window = input.window;
  return {
    at: input.at,
    fileName: input.fileName,
    canConfirm: input.canConfirm,
    values: PLANT_VALUES.map((definition) => {
      const history = ordered.filter((event) => event.key === definition.key);
      const changesWithin =
        window === null
          ? null
          : ([...history].sort(byEffect).find((event) => event.effectiveAt > window.from && event.effectiveAt <= window.to) ?? null);
      return {
        key: definition.key,
        label: definition.label,
        kind: definition.kind,
        ...(definition.inputUnit === undefined ? {} : { inputUnit: definition.inputUnit }),
        path: definition.path,
        provisional: definition.read(input.provisional),
        current: current.get(definition.key) ?? null,
        changesWithin,
        history,
        measuredIn: definition.measuredIn,
        proposal: input.proposals?.[definition.key] ?? null,
      };
    }),
  };
}

// --- Viaje en el `.agvproj` ----------------------------------------------------------------------

/**
 * La relación entre el registro local y el que trae un `.agvproj` (mismo criterio que el plano,
 * `classifyPlanEvents`): solo entran eventos si el local es un prefijo exacto del entrante. Dos
 * registros distintos no se mezclan.
 */
export type PlantValuesRelation = "sin-valores" | "identico" | "local-adelantado" | "entrante-adelantado" | "distinto";

export function classifyPlantValueEvents(
  local: readonly PlantValueEvent[],
  incoming: readonly PlantValueEvent[],
): { readonly relation: PlantValuesRelation; readonly missing: readonly PlantValueEvent[] } {
  const bySeq = (events: readonly PlantValueEvent[]): readonly PlantValueEvent[] => [...events].sort((a, b) => a.seq - b.seq);
  const mine = bySeq(local);
  const theirs = bySeq(incoming);
  if (theirs.length === 0) return { relation: "sin-valores", missing: [] };
  const shared = Math.min(mine.length, theirs.length);
  for (let index = 0; index < shared; index += 1) {
    if (canonicalise(mine[index]) !== canonicalise(theirs[index])) return { relation: "distinto", missing: [] };
  }
  if (mine.length === theirs.length) return { relation: "identico", missing: [] };
  if (mine.length > theirs.length) return { relation: "local-adelantado", missing: [] };
  return { relation: "entrante-adelantado", missing: theirs.slice(mine.length) };
}
