/**
 * El banco de medida de la aplicación (F6, entrega 2; `PERFORMANCE_BUDGET.md` §2, §3 y §7).
 *
 * Solo la persona puede medir en su dispositivo de referencia (OQ-173), así que la medida va dentro
 * de la aplicación: genera aquí mismo los volúmenes sintéticos de PERF-D2, D3 y D4, los pasa por la
 * importación de verdad —sin circuito, así que se analiza y se dibuja todo pero no se guarda nada— y
 * deja un informe para devolver. Este módulo es la parte pura: la forma de cada volumen, su
 * generador con semilla, los presupuestos y el informe. El reloj y la página están en
 * `presentation/bench-ui.ts`.
 *
 * Los volúmenes son sintéticos y solo tienen la forma estadística (§2): AGV que recorren un anillo de
 * tags a una cadencia con variación, en el orden de pila descendente de la fuente real y con
 * resolución de segundo. Nada de esto es topología ni valores de planta.
 */

/** Un volumen de medida. */
export interface BenchScenario {
  readonly id: "PERF-D2" | "PERF-D3" | "PERF-D4";
  readonly label: string;
  readonly vehicles: number;
  readonly tags: number;
  /** Segundos de media entre dos lecturas de un mismo AGV. */
  readonly cadenceSeconds: number;
  /** Cuántas lecturas en total, o cuánto tiempo: lo que fija `PERFORMANCE_BUDGET.md` §2. */
  readonly events?: number;
  readonly durationHours?: number;
  readonly seed: number;
}

/**
 * Los tres de §2. PERF-D2 y D3 fijan el número de lecturas; PERF-D4, la duración (48 h con unos 40
 * AGV). La cadencia de PERF-D4, 15 s, no viene de planta: la elige el banco para que el volumen quede
 * entre D2 y D3 (unas 460.000 lecturas) y se declara así. Si la muestra real resulta más densa, se
 * cambia aquí y en `PERFORMANCE_BUDGET.md` §2.
 */
export const BENCH_SCENARIOS: readonly BenchScenario[] = [
  { id: "PERF-D2", label: "100.000 lecturas, 40 AGV, 120 tags", vehicles: 40, tags: 120, cadenceSeconds: 12, events: 100_000, seed: 20261017 },
  { id: "PERF-D3", label: "500.000 lecturas, 40 AGV, 120 tags", vehicles: 40, tags: 120, cadenceSeconds: 12, events: 500_000, seed: 20261018 },
  { id: "PERF-D4", label: "48 h, 40 AGV, 120 tags (replay)", vehicles: 40, tags: 120, cadenceSeconds: 15, durationHours: 48, seed: 20261019 },
];

/**
 * El mayor volumen que el banco mide (PERF-D3). Por encima, la aplicación lo dice al importar: en el
 * dispositivo no está comprobado (`PERFORMANCE_BUDGET.md` §3, «el móvil degradará o advertirá según
 * capacidad»). No es un límite: el fichero se importa igual.
 */
export const LARGEST_MEASURED_READINGS = 500_000;

/** El aviso de un fichero mayor que lo medido; `null` si no lo es. `memoryGb`, la memoria que declara el navegador. */
export function largeImportWarning(readings: number, memoryGb: number | null): string | null {
  if (readings <= LARGEST_MEASURED_READINGS) return null;
  const device = memoryGb === null ? "" : ` (este navegador declara ${memoryGb.toLocaleString("es-ES")} GB de memoria)`;
  return (
    `El fichero tiene ${readings.toLocaleString("es-ES")} lecturas, más que el mayor volumen medido (${LARGEST_MEASURED_READINGS.toLocaleString("es-ES")}): ` +
    `en este dispositivo${device} no está comprobado cuánto aguanta. Si la página va lenta o se cierra, exporta un periodo más corto. «Medir este dispositivo», en Datos, dice cómo responde con los volúmenes medidos.`
  );
}

/** Generador con semilla: determinista y sin dependencias. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const START_UTC = Date.UTC(2026, 0, 19, 5, 0, 0);
const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

/** `dd/mm/aaaa hh:mm:ss` en hora de pared; el sintético se pinta en UTC, sin cambio de hora. */
function stamp(utcMs: number): string {
  const at = new Date(utcMs);
  return `${pad(at.getUTCDate())}/${pad(at.getUTCMonth() + 1)}/${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`;
}

/**
 * Las lecturas del volumen, en orden ascendente de tiempo: cada AGV sale de su sitio del anillo y
 * avanza un tag cada `cadenceSeconds` ± 40 %. Con `events`, se corta en ese número; con
 * `durationHours`, al llegar a ese tiempo.
 */
export function scenarioRows(scenario: BenchScenario): readonly string[] {
  const random = seeded(scenario.seed);
  const endMs = scenario.durationHours === undefined ? Number.POSITIVE_INFINITY : START_UTC + scenario.durationHours * 3_600_000;
  const limit = scenario.events ?? Number.POSITIVE_INFINITY;
  const next: number[] = [];
  const position: number[] = [];
  for (let vehicle = 0; vehicle < scenario.vehicles; vehicle += 1) {
    next.push(START_UTC + Math.floor(random() * scenario.cadenceSeconds * 1000));
    position.push(Math.floor((vehicle * scenario.tags) / scenario.vehicles));
  }
  const rows: string[] = [];
  while (rows.length < limit) {
    // El AGV con la lectura más próxima; con 40 basta recorrerlos.
    let vehicle = 0;
    for (let index = 1; index < next.length; index += 1) if ((next[index] as number) < (next[vehicle] as number)) vehicle = index;
    const at = next[vehicle] as number;
    if (at > endMs) break;
    const second = Math.floor(at / 1000) * 1000;
    rows.push(`${stamp(second)};${pad(201 + vehicle, 4)};${50_001 + (position[vehicle] as number)}`);
    position[vehicle] = ((position[vehicle] as number) + 1) % scenario.tags;
    next[vehicle] = at + Math.round(scenario.cadenceSeconds * 1000 * (0.6 + 0.8 * random()));
  }
  return rows;
}

/** El CSV del volumen tal como lo exporta la fuente: cabecera y la fila más reciente primero. */
export function scenarioCsv(rows: readonly string[]): string {
  return ["Fecha;AGV;Tag", ...[...rows].reverse()].join("\r\n");
}

// --- Presupuestos y resultado --------------------------------------------------------------------

export type Verdict = "dentro" | "fuera" | "sin-medir";

export interface BenchMetric {
  readonly key: string;
  readonly label: string;
  /** La medida en milisegundos (o en MiB o fotogramas por segundo, según `unit`); `null` si no se pudo. */
  readonly value: number | null;
  readonly unit: "ms" | "MiB" | "fps";
  /** El presupuesto de `PERFORMANCE_BUDGET.md` §3, en palabras; `null` si la métrica solo se informa. */
  readonly budget: string | null;
  readonly verdict: Verdict | null;
  /** Por qué no se midió, o una aclaración de cómo. */
  readonly note: string | null;
}

/** Las medidas en bruto que toma la página de una ejecución. */
export interface BenchRaw {
  readonly generationMs: number;
  readonly firstProgressMs: number | null;
  readonly totalMs: number | null;
  readonly frameGaps: readonly number[];
  readonly heapPeakBytes: number | null;
  /** Desde que llegan los resultados hasta el primer fotograma del replay pintado. */
  readonly replayFirstViewMs: number | null;
  /** Lo que tarda en pintarse cada paso del replay. */
  readonly replayStepMs: readonly number[];
  /** Desde pulsar «Cancelar» hasta la confirmación, si se probó. */
  readonly cancelMs: number | null;
  /** La importación no atendió «Cancelar» y terminó entera; `cancelMs` es entonces lo que tardó en acabar. */
  readonly cancelIgnored?: boolean;
  readonly failed: string | null;
}

const MIB = 1024 * 1024;

/** El percentil `p` (0–1) de una lista; `null` si está vacía. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;
}

const under = (value: number | null, limit: number): Verdict => (value === null ? "sin-medir" : value < limit ? "dentro" : "fuera");

/** Las métricas de una ejecución frente a §3. Puro. */
export function benchMetrics(scenario: BenchScenario, raw: BenchRaw): readonly BenchMetric[] {
  const p95 = percentile(raw.frameGaps, 0.95);
  const worst = raw.frameGaps.length === 0 ? null : Math.max(...raw.frameGaps);
  const heapLimit = scenario.id === "PERF-D2" ? 250 : scenario.id === "PERF-D3" ? 512 : null;
  const heap = raw.heapPeakBytes === null ? null : raw.heapPeakBytes / MIB;
  const metrics: BenchMetric[] = [
    { key: "generacion", label: "Preparar el volumen sintético", value: raw.generationMs, unit: "ms", budget: null, verdict: null, note: "No cuenta para el presupuesto: es la preparación de la medida." },
    { key: "primer-progreso", label: "Primer progreso visible", value: raw.firstProgressMs, unit: "ms", budget: "< 500 ms", verdict: under(raw.firstProgressMs, 500), note: null },
    { key: "total", label: "Importar, analizar y dibujar", value: raw.totalMs, unit: "ms", budget: null, verdict: null, note: "Se informa; el presupuesto acota que la interfaz responda, no lo que tarda." },
    { key: "hueco-p95", label: "Hueco de fotograma, p95", value: p95, unit: "ms", budget: "< 50 ms", verdict: under(p95, 50), note: null },
    { key: "hueco-max", label: "Hueco de fotograma, máximo", value: worst, unit: "ms", budget: null, verdict: null, note: "Se informa: un tirón puntual que el p95 no enseña." },
    {
      key: "memoria",
      label: "Pico de memoria",
      value: heap,
      unit: "MiB",
      budget: heapLimit === null ? null : `≤ ${heapLimit} MiB`,
      verdict: heapLimit === null ? null : heap === null ? "sin-medir" : heap <= heapLimit ? "dentro" : "fuera",
      note:
        heap === null
          ? "Este navegador no da la memoria a la página. Mídela con su administrador de tareas mientras dura la importación."
          : "Solo el hilo principal: el Worker no se ve desde la página, así que el pico real es mayor.",
    },
  ];
  if (scenario.id === "PERF-D4") {
    const meanStep = raw.replayStepMs.length === 0 ? null : raw.replayStepMs.reduce((sum, value) => sum + value, 0) / raw.replayStepMs.length;
    const fps = meanStep === null ? null : 1000 / Math.max(meanStep, 1000 / 60);
    metrics.push(
      { key: "replay-primera", label: "Primera vista del replay", value: raw.replayFirstViewMs, unit: "ms", budget: "< 2 s", verdict: under(raw.replayFirstViewMs, 2000), note: "Desde que llegan los resultados, con los índices ya hechos." },
      {
        key: "replay-fps",
        label: "Paso del replay",
        value: fps === null ? null : Math.round(fps),
        unit: "fps",
        budget: "objetivo 30, mínimo 20",
        verdict: fps === null ? "sin-medir" : fps >= 20 ? "dentro" : "fuera",
        note: "Fotogramas por segundo que permitiría pintar cada paso, como mucho 60.",
      },
    );
  }
  if (raw.cancelMs !== null || scenario.id === "PERF-D3") {
    const ignored = raw.cancelIgnored === true;
    metrics.push({
      key: "cancelar",
      label: "Confirmación de cancelación",
      value: raw.cancelMs,
      unit: "ms",
      budget: "< 1 s",
      // Si no se atendió, no hubo confirmación: queda fuera, se tarde lo que se tarde en acabar.
      verdict: ignored ? "fuera" : under(raw.cancelMs, 1000),
      note: ignored
        ? "No se atendió: la importación siguió hasta el final. La cifra es lo que tardó en acabar desde que se pulsó «Cancelar»."
        : "Una segunda importación del mismo volumen, cancelada al 30 % de las filas.",
    });
  }
  return metrics;
}

/** El dispositivo, en lo que la página puede saber de él. */
export interface BenchDevice {
  readonly userAgent: string;
  readonly cores: number | null;
  readonly memoryGb: number | null;
  readonly screen: string;
  readonly pixelRatio: number;
  readonly pointer: "táctil" | "puntero";
}

export interface BenchRun {
  readonly scenario: BenchScenario;
  readonly rows: number;
  /** SHA-256 del CSV: la misma huella en dos dispositivos prueba que midieron lo mismo. */
  readonly csvHash: string;
  readonly metrics: readonly BenchMetric[];
  readonly failed: string | null;
}

export interface BenchReport {
  readonly kind: "tag-trace-medida";
  readonly format: 1;
  readonly appVersion: string;
  readonly measuredAt: string;
  readonly device: BenchDevice;
  readonly visibleThroughout: boolean;
  readonly runs: readonly BenchRun[];
}

/** El informe que la persona descarga y devuelve. Sin datos de planta: solo el sintético y el equipo. */
export function benchReport(input: {
  readonly appVersion: string;
  readonly measuredAt: number;
  readonly device: BenchDevice;
  readonly visibleThroughout: boolean;
  readonly runs: readonly BenchRun[];
}): BenchReport {
  return {
    kind: "tag-trace-medida",
    format: 1,
    appVersion: input.appVersion,
    measuredAt: new Date(input.measuredAt).toISOString(),
    device: input.device,
    visibleThroughout: input.visibleThroughout,
    runs: input.runs,
  };
}

/** Lo que dice el veredicto, en palabras. */
export const VERDICT_TEXT: Readonly<Record<Verdict, string>> = { dentro: "dentro", fuera: "fuera", "sin-medir": "sin medir" };

/** Una cifra con su unidad, en español. */
export function formatMetric(metric: BenchMetric): string {
  if (metric.value === null) return "—";
  if (metric.unit === "ms") return metric.value >= 10_000 ? `${(metric.value / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s` : `${Math.round(metric.value).toLocaleString("es-ES")} ms`;
  if (metric.unit === "MiB") return `${Math.round(metric.value).toLocaleString("es-ES")} MiB`;
  return `${Math.round(metric.value)} fps`;
}
