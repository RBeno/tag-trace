/**
 * «Medir este dispositivo» (F6, entrega 2; `PERFORMANCE_BUDGET.md` §3 y §7).
 *
 * Genera el volumen sintético, lo pasa por la importación de la aplicación —la misma que usa un
 * fichero de verdad, pero **sin circuito**: se analiza y se dibuja todo y no se guarda nada— y mide
 * desde la página lo que el presupuesto acota: el primer progreso, los huecos de fotograma mientras
 * trabaja, lo que tarda en dibujarse, la primera vista y el paso del replay, la cancelación y, si el
 * navegador lo da, la memoria del hilo principal. El informe se descarga en JSON para devolverlo.
 *
 * La página conecta aquí sus eventos con `BenchObserver`; este módulo no sabe nada del Worker.
 */

import {
  BENCH_SCENARIOS,
  benchMetrics,
  benchReport,
  formatMetric,
  scenarioCsv,
  scenarioRows,
  VERDICT_TEXT,
  type BenchDevice,
  type BenchRaw,
  type BenchRun,
  type BenchScenario,
} from "../application/perf-bench.js";

/** Lo que la página avisa a la medida en curso. */
export interface BenchObserver {
  progress(done: number, total: number): void;
  /** Llegaron los resultados del Worker. */
  arrived(): void;
  /** Terminó de dibujarlos, replay incluido. */
  rendered(): void;
  cancelled(): void;
  failed(reason: string): void;
}

export interface BenchPanel {
  readonly node: HTMLElement;
  setBusy(busy: boolean): void;
}

interface Hooks {
  /** Importa sin circuito y sin guardar. */
  readonly startImport: (file: File) => void;
  readonly cancel: () => void;
  readonly observe: (observer: BenchObserver | null) => void;
  readonly appVersion: string;
  readonly saveDownload: (text: string, type: string, name: string) => void;
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** La memoria del hilo principal, solo en navegadores que la dan (Chrome); `null` en los demás. */
function heapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return memory === undefined ? null : memory.usedJSHeapSize;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function device(): BenchDevice {
  return {
    userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency ?? null,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    screen: `${screen.width}×${screen.height}`,
    pixelRatio: window.devicePixelRatio,
    pointer: matchMedia("(any-pointer: coarse)").matches ? "táctil" : "puntero",
  };
}

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function createBenchPanel(hooks: Hooks): BenchPanel {
  const node = element("section", "panel bench-panel");
  const status = element("p", "muted bench-status");
  status.setAttribute("role", "status");
  const results = element("div", "bench-results");
  const buttons = BENCH_SCENARIOS.map((scenario) => {
    const button = element("button", undefined, `Medir ${scenario.id}`);
    button.type = "button";
    button.title = scenario.label;
    button.addEventListener("click", () => void run([scenario]));
    return button;
  });
  const all = element("button", undefined, "Medir los tres");
  all.type = "button";
  all.addEventListener("click", () => void run(BENCH_SCENARIOS));
  const download = element("button", undefined, "Descargar el informe (JSON)");
  download.type = "button";
  download.disabled = true;
  const actions = element("div", "bench-actions");
  actions.append(...buttons, all, download);
  node.append(
    element("h2", undefined, "Medir este dispositivo"),
    element(
      "p",
      "muted",
      "Genera aquí volúmenes sintéticos del tamaño del presupuesto y los importa como un fichero de lecturas, pero sin circuito: se analizan y se dibujan y no se guarda nada. " +
        "Lo que estés viendo se sustituye por el sintético. Deja la pestaña a la vista mientras mide: tarda unos minutos y, en segundo plano, el navegador para la página y la medida no sirve.",
    ),
    actions,
    status,
    results,
  );

  let busy = false;
  let running = false;
  const runs: BenchRun[] = [];
  let visibleThroughout = true;
  let lastReport = "";
  const refresh = (): void => {
    for (const button of [...buttons, all]) button.disabled = busy || running;
    download.disabled = running || runs.length === 0;
  };
  document.addEventListener("visibilitychange", () => {
    if (running && document.visibilityState !== "visible") visibleThroughout = false;
  });
  download.addEventListener("click", () => {
    const at = new Date();
    const stamp = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}-${String(at.getHours()).padStart(2, "0")}${String(at.getMinutes()).padStart(2, "0")}`;
    hooks.saveDownload(lastReport, "application/json;charset=utf-8", `medida-tag-trace-${hooks.appVersion}-${stamp}.json`);
  });

  /** Una importación del volumen, observada de principio a fin. */
  const measureImport = (file: File, cancelAt: number | null): Promise<{ firstProgressMs: number | null; totalMs: number | null; arrivedAt: number | null; renderedAt: number | null; cancelMs: number | null; cancelIgnored: boolean; failed: string | null }> =>
    new Promise((resolve) => {
      const started = performance.now();
      let firstProgressMs: number | null = null;
      let arrivedAt: number | null = null;
      let cancelRequested: number | null = null;
      const finish = (outcome: { renderedAt: number | null; cancelMs: number | null; cancelIgnored: boolean; failed: string | null }): void => {
        hooks.observe(null);
        resolve({ firstProgressMs, totalMs: outcome.renderedAt === null ? null : outcome.renderedAt - started, arrivedAt, ...outcome });
      };
      hooks.observe({
        progress(done, total) {
          if (firstProgressMs === null) firstProgressMs = performance.now() - started;
          if (cancelAt !== null && cancelRequested === null && total > 0 && done / total >= cancelAt) {
            cancelRequested = performance.now();
            hooks.cancel();
          }
        },
        arrived() {
          arrivedAt = performance.now();
        },
        rendered() {
          // Si se pidió cancelar y aun así terminó, la cancelación no se atendió.
          const now = performance.now();
          finish({ renderedAt: now, cancelMs: cancelRequested === null ? null : now - cancelRequested, cancelIgnored: cancelRequested !== null, failed: null });
        },
        cancelled() {
          finish({ renderedAt: null, cancelMs: cancelRequested === null ? null : performance.now() - cancelRequested, cancelIgnored: false, failed: null });
        },
        failed(reason) {
          finish({ renderedAt: null, cancelMs: null, cancelIgnored: false, failed: reason });
        },
      });
      hooks.startImport(file);
    });

  const measure = async (scenario: BenchScenario): Promise<BenchRun> => {
    status.textContent = `${scenario.id}: preparando ${scenario.label}…`;
    await nextFrame();
    const generationStart = performance.now();
    const rows = scenarioRows(scenario);
    const csv = scenarioCsv(rows);
    const generationMs = performance.now() - generationStart;
    const csvHash = await sha256(csv);
    const file = new File([csv], `${scenario.id.toLowerCase()}.csv`, { type: "text/csv" });

    status.textContent = `${scenario.id}: importando, analizando y dibujando ${rows.length.toLocaleString("es-ES")} lecturas…`;
    await nextFrame();
    const gaps: number[] = [];
    let sampling = true;
    let previous = performance.now();
    const beat = (): void => {
      if (!sampling) return;
      const now = performance.now();
      gaps.push(now - previous);
      previous = now;
      requestAnimationFrame(beat);
    };
    requestAnimationFrame(beat);
    let heapPeak = heapBytes();
    const heapTimer = setInterval(() => {
      const now = heapBytes();
      if (now !== null && (heapPeak === null || now > heapPeak)) heapPeak = now;
    }, 200);
    const outcome = await measureImport(file, null);
    // Un fotograma más: el que sigue a dibujar los resultados es parte de lo que se ve.
    await nextFrame();
    await nextFrame();
    sampling = false;
    clearInterval(heapTimer);

    const replayStepMs: number[] = [];
    let replayFirstViewMs: number | null = null;
    if (scenario.id === "PERF-D4" && outcome.failed === null) {
      // Desde que llegan los resultados hasta que está pintado el primer fotograma del replay.
      replayFirstViewMs = outcome.arrivedAt === null || outcome.renderedAt === null ? null : outcome.renderedAt - outcome.arrivedAt;
      const slider = document.querySelector<HTMLInputElement>("#replay-slider");
      if (slider !== null && Number(slider.max) > 0) {
        const max = Number(slider.max);
        for (let step = 1; step <= 30; step += 1) {
          slider.value = String(Math.round((step * max) / 30));
          const before = performance.now();
          slider.dispatchEvent(new Event("input"));
          replayStepMs.push(performance.now() - before);
          await nextFrame();
        }
      }
    }

    let cancelMs: number | null = null;
    let cancelIgnored = false;
    if (scenario.id === "PERF-D3" && outcome.failed === null) {
      status.textContent = `${scenario.id}: probando la cancelación…`;
      await nextFrame();
      const cancelled = await measureImport(file, 0.3);
      cancelMs = cancelled.cancelMs;
      cancelIgnored = cancelled.cancelIgnored;
    }

    const raw: BenchRaw = {
      generationMs,
      firstProgressMs: outcome.firstProgressMs,
      totalMs: outcome.totalMs,
      frameGaps: gaps,
      heapPeakBytes: heapPeak,
      replayFirstViewMs,
      replayStepMs,
      cancelMs,
      cancelIgnored,
      failed: outcome.failed,
    };
    return { scenario, rows: rows.length, csvHash, metrics: benchMetrics(scenario, raw), failed: outcome.failed };
  };

  const render = (): void => {
    results.replaceChildren();
    for (const run of runs) {
      const table = element("table", "bench-table");
      table.dataset["scenario"] = run.scenario.id;
      const caption = element("caption", undefined, `${run.scenario.id} · ${run.rows.toLocaleString("es-ES")} lecturas · huella ${run.csvHash.slice(0, 12)}`);
      const head = element("tr");
      for (const title of ["Métrica", "Medida", "Presupuesto", "Resultado"]) head.append(element("th", undefined, title));
      table.append(caption, head);
      for (const metric of run.metrics) {
        const row = element("tr");
        if (metric.verdict !== null) row.dataset["verdict"] = metric.verdict;
        const name = element("td", undefined, metric.label);
        if (metric.note !== null) name.append(element("span", "muted bench-note", metric.note));
        row.append(name, element("td", undefined, formatMetric(metric)), element("td", undefined, metric.budget ?? "—"), element("td", undefined, metric.verdict === null ? "se informa" : VERDICT_TEXT[metric.verdict]));
        table.append(row);
      }
      results.append(table);
      if (run.failed !== null) results.append(element("p", "bench-failed", `${run.scenario.id} no terminó: ${run.failed}`));
    }
  };

  const run = async (scenarios: readonly BenchScenario[]): Promise<void> => {
    if (running || busy) return;
    running = true;
    visibleThroughout = document.visibilityState === "visible";
    runs.length = 0;
    render();
    refresh();
    try {
      for (const scenario of scenarios) {
        runs.push(await measure(scenario));
        render();
      }
      lastReport = JSON.stringify(benchReport({ appVersion: hooks.appVersion, measuredAt: Date.now(), device: device(), visibleThroughout, runs }), null, 2);
      status.textContent = visibleThroughout
        ? "Medida terminada. Descarga el informe y devuélvelo; lo que se ve ahora es el sintético, vuelve a cargar tu fichero para seguir."
        : "Medida terminada, pero la pestaña dejó de verse en algún momento: los huecos de fotograma no valen. Repítela con la pestaña a la vista.";
    } finally {
      running = false;
      refresh();
    }
  };

  refresh();
  return {
    node,
    setBusy(next: boolean): void {
      busy = next;
      refresh();
    },
  };
}
