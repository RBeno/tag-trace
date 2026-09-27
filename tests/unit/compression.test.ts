/**
 * Compresión del almacén (OQ-145): lo que se comprime vuelve igual, byte a byte y valor a valor.
 */

import { describe, expect, it } from "vitest";

import { gunzip, gunzipJson, gzip, gzipJson } from "../../src/persistence/compression.js";

describe("OQ-145 · compresión con el gzip del navegador", () => {
  it("unos bytes comprimidos vuelven iguales, y ocupan menos si se repiten", async () => {
    const bytes = new TextEncoder().encode("Fecha;AGV;Tag\r\n".repeat(2_000));
    const packed = await gzip(bytes);
    expect(packed.length).toBeLessThan(bytes.length / 10);
    expect(await gunzip(packed)).toEqual(bytes);
  });

  it("un valor JSON comprimido vuelve igual", async () => {
    const readings = Array.from({ length: 500 }, (_, index) => ({
      time: { utcMs: 1_700_000_000_000 + index * 1000, raw: String(index), zone: "Europe/Madrid", flag: "ok" },
      agvId: `AGV-${index % 7}`,
      tagId: `T${String(index % 40).padStart(3, "0")}`,
      provenance: { sourceId: "sintetico", sourceHash: "sintetico", sourceRow: index + 2 },
    }));
    const packed = await gzipJson(readings);
    expect(packed.length).toBeLessThan(new TextEncoder().encode(JSON.stringify(readings)).length / 5);
    expect(await gunzipJson(packed)).toEqual(readings);
  });

  it("un vacío también vuelve", async () => {
    expect(await gunzipJson(await gzipJson([]))).toEqual([]);
    expect(await gunzip(await gzip(new Uint8Array()))).toEqual(new Uint8Array());
  });
});
