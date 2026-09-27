/**
 * Las filas del almacén de dos épocas (OQ-145): desde la versión 9 las lecturas de una fuente y las
 * versiones de la memoria se guardan comprimidas (`gz`); las anteriores están tal cual. Lo que se
 * fija: una fila `sources` sin `gz` devuelve sus `readings` tal cual; una fila `memory` que es la
 * propia versión se devuelve sin descomprimir; y las comprimidas vuelven iguales.
 */

import { describe, expect, it } from "vitest";

import type { ConsolidatedVersion } from "../../src/domain/memory.js";
import type { Reading } from "../../src/domain/reading.js";
import { gzipJson } from "../../src/persistence/compression.js";
import { readingsOf, versionOf } from "../../src/persistence/store.js";

const reading: Reading = {
  time: { utcMs: 1_700_000_000_000, raw: "1", zone: "Europe/Madrid", flag: "ok" },
  agvId: "0007",
  tagId: "00017",
  provenance: { sourceId: "s-1", sourceHash: "h-1", sourceRow: 2 },
} as unknown as Reading;

const version = {
  schemaVersion: 1,
  circuitId: "c",
  version: 1,
  hash: "abc",
  createdAt: 0,
  decisions: [],
  note: null,
  revoked: null,
} as unknown as ConsolidatedVersion;

describe("filas del almacén de las dos épocas", () => {
  it("una fila de fuente sin `gz` (versión 8) devuelve sus lecturas tal cual", async () => {
    const row = { circuitId: "c", sourceId: "s-1", readings: [reading] };
    expect(await readingsOf(row)).toEqual({ circuitId: "c", sourceId: "s-1", readings: [reading] });
    expect(await readingsOf({ circuitId: "c", sourceId: "s-2" })).toEqual({ circuitId: "c", sourceId: "s-2", readings: [] });
  });

  it("una fila de fuente comprimida vuelve igual", async () => {
    const row = { circuitId: "c", sourceId: "s-1", gz: await gzipJson([reading]) };
    expect(await readingsOf(row)).toEqual({ circuitId: "c", sourceId: "s-1", readings: [reading] });
  });

  it("una fila de memoria que es la propia versión se devuelve sin descomprimir, y la comprimida vuelve igual", async () => {
    expect(await versionOf(version)).toBe(version);
    expect(await versionOf({ circuitId: "c", hash: "abc", gz: await gzipJson(version) })).toEqual(version);
  });
});
