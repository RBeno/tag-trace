/**
 * Presupuesto de crecimiento de la memoria (`MEMORY_CONSOLIDATION.md` §9), medido.
 *
 * El objetivo candidato de §9 es que, en periodos normales, lo que se consolida ocupe menos del 5 %
 * del bruto equivalente. Aquí se mide con el circuito sintético de auditoría —un cuarto de millón de
 * lecturas, 145 tags, 40 AGV— partido en cuatro periodos consecutivos e importados uno tras otro,
 * como llegarían las exportaciones de planta.
 *
 * Por periodo se mide, en bytes:
 *
 * - el bruto: el CSV tal como llega;
 * - las lecturas normalizadas tal como las guarda el almacén, y esas mismas comprimidas con gzip del
 *   navegador (`CompressionStream`), que es lo que costaría conservarlas todas (idea del esbozo
 *   inicial, pendiente de esta medida);
 * - la instantánea que queda del fichero;
 * - la versión consolidada que saldría de él: la instantánea, el delta frente al periodo anterior y
 *   las decisiones de sus hallazgos (`versionBytes`, el mismo cálculo que enseña la pestaña Memoria);
 * - el evento que crea el plano físico desde esa versión.
 *
 * La prueba no fija el 5 %: el objetivo es candidato y lo acepta o lo cambia el propietario. Afirma
 * lo que no depende de esa decisión y deja las cifras en el informe (`presupuesto-memoria.json`).
 */

import { expect, test } from "@playwright/test";
import { gzipSync } from "node:zlib";

import { buildAuditScenario } from "../support/circuito-auditoria.js";
import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";
import { versionBytes, type ConsolidatedVersion } from "../../src/domain/memory.js";
import { bootstrapPlan } from "../../src/domain/plan.js";
import { compareSnapshots, type CircuitSnapshot } from "../../src/domain/snapshot.js";

const PERIODS = 4;

/** La hora de pared de una fila `dd/mm/aaaa hh:mm:ss;AGV;Tag`, como número comparable. */
function wallClock(row: string): number {
  const [date = "", time = ""] = (row.split(";")[0] ?? "").split(" ");
  const [day, month, year] = date.split("/").map(Number) as [number, number, number];
  const [hour, minute, second] = time.split(":").map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

/** Parte la exportación en periodos consecutivos de la misma duración, sin hueco entre ellos. */
function splitInPeriods(csv: string, count: number): readonly Buffer[] {
  const [header = "", ...rows] = csv.split("\r\n");
  const times = rows.map(wallClock);
  let first = Infinity;
  let last = -Infinity;
  for (const time of times) {
    if (time < first) first = time;
    if (time > last) last = time;
  }
  const span = (last - first + 1) / count;
  const buckets: string[][] = Array.from({ length: count }, () => []);
  rows.forEach((row, index) => {
    const bucket = Math.min(count - 1, Math.floor(((times[index] as number) - first) / span));
    buckets[bucket]?.push(row);
  });
  return buckets.map((bucket) => Buffer.from([header, ...bucket].join("\r\n"), "utf8"));
}

interface StoredSizes {
  readonly snapshot: CircuitSnapshot;
  /** Bytes de las lecturas normalizadas de esta fuente, como JSON, y comprimidas con gzip. */
  readonly readingsJson: number;
  readonly readingsGzip: number;
  readonly readings: number;
}

test.describe("presupuesto de la memoria (MEMORY_CONSOLIDATION §9)", () => {
  test.setTimeout(900_000);

  test("cada periodo consolidado ocupa una fracción del bruto, y las cifras quedan en el informe", async ({ page }, testInfo) => {
    const scenario = buildAuditScenario();
    const files = splitInPeriods(scenario.readingsCsv, PERIODS);

    await page.goto("./");
    await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker?.getRegistrations?.();
      for (const registration of registrations ?? []) await registration.unregister();
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase("tag-trace");
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      });
    });
    await page.reload();

    const rows: Record<string, number | string>[] = [];
    let previous: CircuitSnapshot | null = null;
    for (const [index, buffer] of files.entries()) {
      const name = `periodo-${index + 1}.csv`;
      await page.locator("#circuit-name").fill("presupuesto");
      await page.locator("#source-file").setInputFiles([]);
      await page.locator("#source-file").setInputFiles({ name, mimeType: "text/csv", buffer });
      await expect(page.getByRole("heading", { name: "Circuito «presupuesto»", exact: true })).toBeVisible({ timeout: 240_000 });
      // La vista es la de este fichero cuando la lista de ficheros lo nombra.
      await expect(page.getByText(name).first()).toBeAttached({ timeout: 240_000 });

      const sizes = await page.evaluate(async (fileName): Promise<StoredSizes | null> => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("tag-trace");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const all = <T>(store: string): Promise<T[]> =>
          new Promise((resolve, reject) => {
            const request = db.transaction(store, "readonly").objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result as T[]);
            request.onerror = () => reject(request.error);
          });
        try {
          const snapshots = await all<{ circuitId: string; sourceId: string; snapshot: CircuitSnapshot }>("snapshots");
          const row = snapshots.find((entry) => entry.circuitId === "presupuesto" && entry.snapshot.fileName === fileName);
          if (row === undefined) return null;
          const sources = await all<{ circuitId: string; sourceId: string; readings: unknown[] }>("sources");
          const readings = sources.find((entry) => entry.circuitId === "presupuesto" && entry.sourceId === row.sourceId)?.readings ?? [];
          const json = new TextEncoder().encode(JSON.stringify(readings));
          const gzip = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
          const compressed = new Uint8Array(await new Response(gzip).arrayBuffer());
          return { snapshot: row.snapshot, readingsJson: json.length, readingsGzip: compressed.length, readings: readings.length };
        } finally {
          db.close();
        }
      }, name);
      expect(sizes, `instantánea de ${name}`).not.toBeNull();
      if (sizes === null) return;

      const snapshot = sizes.snapshot;
      const delta = previous === null ? null : compareSnapshots(previous, snapshot, { maxChance: PROVISIONAL_CONFIG.tagChanges.maxChance });
      const version: ConsolidatedVersion = {
        schemaVersion: 1,
        circuitId: "presupuesto",
        version: index + 1,
        createdAt: snapshot.capturedAt,
        basedOn: { sourceId: snapshot.sourceId, sourceHash: "0".repeat(64), fileName: name, window: snapshot.window },
        previousHash: previous === null ? null : "0".repeat(64),
        hash: "0".repeat(64),
        lineage: "00000000-0000-0000-0000-000000000000",
        snapshot,
        delta,
        decisions: snapshot.findings.map((finding) => ({
          key: finding.key,
          kind: finding.kind,
          title: finding.title,
          figure: finding.figure,
          state: "confirmado" as const,
          note: null,
        })),
        note: null,
        revoked: null,
        appVersion: snapshot.appVersion,
      };
      const planEvent = bootstrapPlan(version, { circuitId: "presupuesto", recordedAt: snapshot.capturedAt, reason: "medida del presupuesto" });
      const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
      const raw = buffer.length;
      const consolidated = versionBytes(version);
      rows.push({
        periodo: name,
        lecturas: sizes.readings,
        bruto_csv: raw,
        lecturas_json: sizes.readingsJson,
        lecturas_gzip: sizes.readingsGzip,
        instantanea: bytes(snapshot),
        delta: bytes(delta),
        decisiones: bytes(version.decisions),
        version: consolidated,
        // La misma versión comprimida con gzip: el JSON de una instantánea repite mucho sus claves.
        version_gzip: gzipSync(Buffer.from(JSON.stringify(version), "utf8")).length,
        evento_plano: bytes(planEvent),
        // Qué pesa dentro de la instantánea: sus cuatro partes mayores, en bytes.
        partes: Object.entries(snapshot)
          .map(([key, value]) => [key, bytes(value)] as const)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 4)
          .map(([key, size]) => `${key} ${size}`)
          .join(", "),
        version_sobre_bruto: Number((consolidated / raw).toFixed(4)),
        gzip_sobre_bruto: Number((sizes.readingsGzip / raw).toFixed(4)),
        version_gzip_sobre_bruto: Number((gzipSync(Buffer.from(JSON.stringify(version), "utf8")).length / raw).toFixed(4)),
      });

      // Lo que no depende de aceptar el 5 %: lo consolidado ocupa menos que el bruto del que sale,
      // y conservar las lecturas comprimidas cuesta menos que el CSV.
      expect(consolidated).toBeLessThan(raw);
      expect(sizes.readingsGzip).toBeLessThan(raw);
      previous = snapshot;
    }

    console.table(rows);
    await testInfo.attach("presupuesto-memoria.json", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/presupuesto-memoria.json", JSON.stringify(rows, null, 2));
  });
});
