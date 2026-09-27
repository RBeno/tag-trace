/**
 * La huella de una previsualización (F4, `WORKER_PROTOCOL.md` §4): lo que la persona confirma es lo
 * que vio. Lo que se fija: la misma previsualización da la misma huella; cambiar una decisión la
 * cambia; el tamaño estimado y las notas de recorte no cuentan; y la versión anterior entra por su
 * identidad (hash y número), no por su instantánea.
 */

import { describe, expect, it } from "vitest";

import { fingerprintSubject, previewFingerprint } from "../../src/domain/consolidation-fingerprint.js";
import type { ConsolidatedVersion, ConsolidationPreview, MemoryDecision } from "../../src/domain/memory.js";

const decision = (key: string, state: MemoryDecision["state"]): MemoryDecision => ({
  key,
  kind: "fuera-de-lista",
  title: `Tag ${key}`,
  figure: "3 lecturas",
  state,
  note: null,
});

const base: ConsolidationPreview = {
  basedOn: { sourceId: "s-1", sourceHash: "h-1", fileName: "periodo-1.csv", window: { from: 1_000, to: 2_000 } },
  previous: null,
  nextVersion: 1,
  delta: null,
  blockers: [],
  warnings: ["Un pospuesto volverá como pendiente."],
  decisions: [decision("00017", "confirmado"), decision("00018", "descartado")],
  estimatedBytes: 4_096,
  changes: [],
  incidents: [],
  originalArchived: true,
};

describe("huella de la previsualización", () => {
  it("la misma previsualización da la misma huella, aunque las claves vengan en otro orden", async () => {
    const reordered: ConsolidationPreview = { ...base, decisions: [...base.decisions] };
    expect(await previewFingerprint(reordered)).toBe(await previewFingerprint(base));
    expect(await previewFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("cambiar una decisión cambia la huella", async () => {
    const changed: ConsolidationPreview = { ...base, decisions: [decision("00017", "confirmado"), decision("00018", "pospuesto")] };
    expect(await previewFingerprint(changed)).not.toBe(await previewFingerprint(base));
  });

  it("el tamaño estimado y las notas sobre el recorte no cuentan", async () => {
    const bigger: ConsolidationPreview = { ...base, estimatedBytes: 999_999, originalArchived: false, cutUnavailable: "sin original" };
    expect(await previewFingerprint(bigger)).toBe(await previewFingerprint(base));
    expect(fingerprintSubject(base)).not.toHaveProperty("estimatedBytes");
  });

  it("un recorte distinto o un bloqueo nuevo cambian la huella", async () => {
    const cut: ConsolidationPreview = { ...base, cuts: [{ incidentKey: "deja-de-leer|0007", from: 1_200, to: 1_300, agvId: "0007", removed: 4 }] };
    const blocked: ConsolidationPreview = { ...base, blockers: [{ code: "hallazgos-pendientes", detail: "1 pendiente", items: ["00019"] }] };
    const plain = await previewFingerprint(base);
    expect(await previewFingerprint(cut)).not.toBe(plain);
    expect(await previewFingerprint(blocked)).not.toBe(plain);
    // Sin recortes y con la lista vacía es lo mismo: ausente.
    expect(await previewFingerprint({ ...base, cuts: [] })).toBe(plain);
  });

  it("la versión anterior entra por su identidad, no por su instantánea", async () => {
    const previous = {
      version: 1,
      hash: "abc",
      snapshot: { sourceId: "s-0", sourceHash: "h-0" },
    } as unknown as ConsolidatedVersion;
    const other = { ...previous, snapshot: { sourceId: "s-0", sourceHash: "h-0", ring: ["1"] } } as unknown as ConsolidatedVersion;
    const a = await previewFingerprint({ ...base, previous, nextVersion: 2 });
    const b = await previewFingerprint({ ...base, previous: other, nextVersion: 2 });
    expect(a).toBe(b);
    expect(a).not.toBe(await previewFingerprint(base));
    expect(fingerprintSubject({ ...base, previous, nextVersion: 2 })["previous"]).toEqual({ version: 1, hash: "abc" });
  });
});
