/**
 * Contenedor `.agvproj` e integridad (ADR-0012, INV-011).
 *
 * Lo que se comprueba aquí no es que el formato funcione cuando todo va bien —eso es lo fácil—
 * sino que **un proyecto corrupto se nota**. El prototipo leía el proyecto como texto plano, así
 * que un fichero truncado o manipulado era indistinguible de uno válido.
 */

import { describe, expect, it } from "vitest";

import {
  AGVPROJ_SCHEMA_VERSION,
  ProjectError,
  readProject,
  writeProject,
} from "../../src/persistence/agvproj.js";
import { readZip, writeZip, ZipError, ZIP_LIMITS } from "../../src/persistence/zip.js";

const EXPORTED_AT = 1_758_000_000_000;

const sections = {
  circuito: { id: "c1", nombre: "piloto", zona: "Europe/Madrid" },
  fuentes: [
    { sourceId: "s1", sourceHash: "aaa", aceptadas: 120, desde: 1000, hasta: 4000 },
    { sourceId: "s2", sourceHash: "bbb", aceptadas: 80, desde: 3000, hasta: 6000 },
  ],
  cobertura: [{ from: 1000, to: 6000 }],
};

describe("zip mínimo · sin dependencias", () => {
  it("una ida y vuelta devuelve exactamente los mismos bytes", async () => {
    const original = new TextEncoder().encode("x".repeat(50_000));
    const zip = await writeZip([{ name: "grande.json", data: original }]);
    const back = await readZip(zip);
    expect(back).toHaveLength(1);
    expect(new TextDecoder().decode((back[0] as { data: Uint8Array }).data)).toBe("x".repeat(50_000));
  });

  it("un contenido muy comprimible no se rechaza por serlo", async () => {
    // Un JSON de lecturas comprime muchísimo: sus claves se repiten en cada fila. Un guardián de
    // ratio habría rechazado dato legítimo, así que el límite es absoluto y se aplica al vuelo.
    const zip = await writeZip([{ name: "a.json", data: new TextEncoder().encode("a".repeat(200_000)) }]);
    await expect(readZip(zip)).resolves.toHaveLength(1);
    expect(zip.byteLength).toBeLessThan(2_000);
  });

  it("los límites están declarados y son parte del contrato, no una opción", () => {
    expect(ZIP_LIMITS.maxEntries).toBeGreaterThan(0);
    expect(ZIP_LIMITS.maxTotalBytes).toBeGreaterThan(0);
  });

  it("lo que no es un zip se rechaza con su motivo", async () => {
    await expect(readZip(new TextEncoder().encode("esto no es un zip"))).rejects.toBeInstanceOf(ZipError);
  });
});

describe("INV-011 · ida y vuelta de `.agvproj`", () => {
  it("reabrir conserva el estado semántico", async () => {
    const bytes = await writeProject("c1", sections, EXPORTED_AT);
    const project = await readProject(bytes);
    expect(project.manifest.schema_version).toBe(AGVPROJ_SCHEMA_VERSION);
    expect(project.manifest.circuit_id).toBe("c1");
    expect(project.sections).toEqual(sections);
  });

  it("INV-010 · el mismo estado exportado dos veces da los mismos hashes", async () => {
    const uno = await readProject(await writeProject("c1", sections, EXPORTED_AT));
    const otro = await readProject(await writeProject("c1", sections, EXPORTED_AT));
    expect(otro.manifest.hash).toBe(uno.manifest.hash);
    // Y el orden en que se pasen las secciones no puede cambiarlo.
    const alRevés = await readProject(
      await writeProject(
        "c1",
        { cobertura: sections.cobertura, fuentes: sections.fuentes, circuito: sections.circuito },
        EXPORTED_AT,
      ),
    );
    expect(alRevés.manifest.hash).toBe(uno.manifest.hash);
  });

  it("un estado distinto cambia el hash del manifiesto", async () => {
    const uno = await readProject(await writeProject("c1", sections, EXPORTED_AT));
    const otro = await readProject(
      await writeProject("c1", { ...sections, cobertura: [{ from: 1000, to: 9999 }] }, EXPORTED_AT),
    );
    expect(otro.manifest.hash).not.toBe(uno.manifest.hash);
  });
});

describe("apertura defensiva · ADR-0012", () => {
  it("una sección alterada invalida la carga entera, no solo esa sección", async () => {
    const bytes = await writeProject("c1", sections, EXPORTED_AT);
    // Se altera un byte del contenido comprimido.
    const roto = bytes.slice();
    roto[120] = (roto[120] as number) ^ 0xff;
    await expect(readProject(roto)).rejects.toBeInstanceOf(ProjectError);
  });

  it("un esquema desconocido se rechaza diciendo qué hacer, sin tocar nada", async () => {
    const bytes = await writeProject("c1", sections, EXPORTED_AT);
    const entries = await readZip(bytes);
    const manifest = JSON.parse(
      new TextDecoder().decode((entries[0] as { data: Uint8Array }).data),
    ) as Record<string, unknown>;
    manifest["schema_version"] = 99;
    const falseado = await writeZip([
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
      ...entries.slice(1),
    ]);
    const error = await readProject(falseado).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProjectError);
    expect((error as ProjectError).recovery).toContain("Actualízala");
  });

  it("un manifiesto manipulado no se cree a sí mismo", async () => {
    const bytes = await writeProject("c1", sections, EXPORTED_AT);
    const entries = await readZip(bytes);
    const manifest = JSON.parse(
      new TextDecoder().decode((entries[0] as { data: Uint8Array }).data),
    ) as Record<string, unknown>;
    // Se cambia el circuito conservando el hash: el manifiesto deja de avalarse solo.
    manifest["circuit_id"] = "otro";
    const falseado = await writeZip([
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
      ...entries.slice(1),
    ]);
    await expect(readProject(falseado)).rejects.toThrow(/hash/);
  });

  it("una sección declarada que falta deja la carga en nada", async () => {
    const bytes = await writeProject("c1", sections, EXPORTED_AT);
    const entries = await readZip(bytes);
    const sinUna = await writeZip(entries.filter((entry) => !entry.name.endsWith("cobertura.json")));
    await expect(readProject(sinUna)).rejects.toThrow(/Falta la sección/);
  });
});
