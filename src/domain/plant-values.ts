/**
 * Valores de planta del circuito confirmados por una persona (OQ-140, OQ-151; `CONFIG_SCHEMA.md` §3.5
 * y §4).
 *
 * Ocho valores de `PROVISIONAL_CONFIG` tienen aspecto de dato de planta —el régimen de noche, las
 * horas de arranque de turno, la hora sin leer que es desconexión, el bloqueo del primero de cola, la
 * tolerancia de «a la misma hora», el margen del FIFO y la duración mínima de una parada precisa—. El
 * propietario decidió (OQ-140) que no se fijan como configuración: tienen que salir del análisis y la
 * consolidación continua, y son provisionales hasta que la memoria los mida y una persona los confirme.
 * Cómo los mediría la memoria es OQ-151, abierta: **aquí no hay ningún estimador**.
 *
 * Lo que hay es el mecanismo: cada circuito guarda los valores que una persona confirma, cada uno con
 * su fecha efectiva y su razón, en un registro append-only (como el plano, ADR-0016). Al analizar un
 * fichero rige, por valor, el último confirmado cuya fecha efectiva no pasa del inicio del fichero; sin
 * ninguno, el provisional. Nada se aplica sin una persona que lo confirme con razón (ADR-0010).
 *
 * `drift.minGapMs` (hueco entre periodos distantes) no está: OQ-151 propone sacarlo de la lista porque
 * es de análisis, no de planta.
 *
 * Puro: sin almacén, sin Worker, sin interfaz.
 */

import type { AnalysisConfig } from "./config.js";
import { canonicalise } from "./semantic-hash.js";

/** Los ocho valores de planta, por su clave estable (viaja en el `.agvproj`: no se renombra). */
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
 * quiere escribir 2 minutos y escribe 2000). Ninguno de estos ocho valores tiene sentido por encima de
 * un día; si alguno lo tuviera, el tope se sube aquí con su razón.
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
  /** Hoy solo lo escribe una persona. Cuando la memoria proponga (OQ-151), la propuesta confirmada tendrá su origen. */
  readonly origin: "manual";
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
  if (event["origin"] !== "manual") return "un valor no tiene origen";
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
 */
export function plantValuesView(input: {
  readonly events: readonly PlantValueEvent[];
  readonly provisional: AnalysisConfig;
  readonly at: number | null;
  readonly fileName: string | null;
  readonly window: { readonly from: number; readonly to: number } | null;
  readonly canConfirm: boolean;
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
