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
  memorySection,
  planSection,
  plantValuesSection,
  ProjectError,
  readMemorySection,
  readPlanSection,
  readPlantValuesSection,
  readProject,
  writeProject,
} from "../../src/persistence/agvproj.js";
import { emptyLineageState, withConsolidated, type ConsolidatedVersion } from "../../src/domain/memory.js";
import type { PlanEvent } from "../../src/domain/plan.js";
import type { PlantValueEvent } from "../../src/domain/plant-values.js";
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

describe("ADR-0015 §5 · el proyecto lleva las instantáneas y abre las versiones anteriores", () => {
  // ADR-0016 subió el esquema al 4 (sección `plano`) y los valores de planta confirmados (OQ-140) al 5
  // (sección `valores`): el número vigente cambia por decisión, no para que la prueba pase; lo que fija
  // esta prueba —que `instantaneas` viaja con su hash— no cambia.
  it("el esquema vigente es el 5 y la sección `instantaneas` viaja como cualquier otra, con su hash", async () => {
    const instantaneas = [{ schemaVersion: 1, sourceId: "s1", ring: ["T1", "T2"], vertices: [] }];
    const project = await readProject(await writeProject("c1", { ...sections, instantaneas }, EXPORTED_AT));
    expect(project.manifest.schema_version).toBe(5);
    expect(project.sections["instantaneas"]).toEqual(instantaneas);
    expect(project.manifest.sections.map((digest) => digest.name)).toContain("instantaneas");
  });

  it("un proyecto del esquema 1 —sin instantáneas— se sigue abriendo tal cual", async () => {
    const bytes = await writeProject("c1", sections, EXPORTED_AT);
    const entries = await readZip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode((entries[0] as { data: Uint8Array }).data)) as Record<string, unknown>;
    // El manifiesto se rehace con el esquema 1 y su propio hash, como lo escribió la versión anterior.
    const { hash: _hash, ...partial } = { ...manifest, schema_version: 1 } as Record<string, unknown>;
    const { semanticHash } = await import("../../src/domain/semantic-hash.js");
    const antiguo = { ...partial, hash: await semanticHash(partial) };
    const proyecto = await readProject(
      await writeZip([{ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(antiguo)) }, ...entries.slice(1)]),
    );
    expect(proyecto.manifest.schema_version).toBe(1);
    expect(proyecto.sections).toEqual(sections);
    expect(proyecto.sections["instantaneas"]).toBeUndefined();
  });
});

/** Una versión consolidada mínima para el contenedor: el grafo es un objeto cualquiera, aquí no se analiza. */
function version(number: number, hash: string, previousHash: string | null, lineage = "linaje-A"): ConsolidatedVersion {
  return {
    schemaVersion: 1,
    circuitId: "c1",
    version: number,
    createdAt: EXPORTED_AT - 1000 + number,
    basedOn: { sourceId: `s${number}`, sourceHash: `hash-s${number}`, fileName: `s${number}.csv`, window: { from: 1000 * number, to: 1000 * number + 500 } },
    previousHash,
    hash,
    lineage,
    snapshot: { schemaVersion: 1, circuitId: "c1", sourceId: `s${number}`, ring: ["T001"], vertices: [] } as unknown as ConsolidatedVersion["snapshot"],
    delta: null,
    decisions: [{ key: "tag-deja|T001", kind: "tag-deja", title: "tag que dejó de leerse", figure: "0 %", state: "pospuesto", note: "sin acceso" }],
    note: null,
    revoked: null,
    appVersion: "0.0.0-prueba",
  };
}

describe("F4 · esquema 3: la memoria consolidada viaja en la sección `memoria` y el 2 se sigue abriendo", () => {
  const versions = [version(1, "h1", null), version(2, "h2", "h1")];
  const state = versions.reduce((acc, entry) => withConsolidated(acc, entry), emptyLineageState("c1"));

  it("ida y vuelta: versiones y estado de linaje vuelven iguales, con su hash de sección", async () => {
    const memoria = memorySection(versions, state);
    expect(memoria).toBeDefined();
    const project = await readProject(await writeProject("c1", { ...sections, memoria }, EXPORTED_AT));
    expect(project.manifest.schema_version).toBe(AGVPROJ_SCHEMA_VERSION);
    expect(project.manifest.sections.map((digest) => digest.name)).toContain("memoria");
    const back = readMemorySection(project);
    expect(back).toEqual(memoria);
    expect(back?.versiones.map((entry) => entry.hash)).toEqual(["h1", "h2"]);
    expect(back?.linaje.activo).toEqual({ id: "linaje-A", hashes: ["h1", "h2"] });
    expect(back?.linaje.archivados).toEqual([]);
    expect(back?.linaje.eventos).toEqual([]);
  });

  it("sin versiones no hay sección, y un linaje entrante sin resolver no viaja", () => {
    expect(memorySection([], state)).toBeUndefined();
    const other = version(2, "h2b", "h1", "linaje-B");
    const forked = { ...state, incoming: { id: "linaje-B", hashes: ["h1", "h2b"] } };
    expect(memorySection([...versions, other], forked)?.versiones.map((entry) => entry.hash)).toEqual(["h1", "h2"]);
  });

  it("una sección `memoria` con otra forma se rechaza diciendo qué falta", async () => {
    const project = await readProject(await writeProject("c1", { ...sections, memoria: { versiones: "no" } }, EXPORTED_AT));
    expect(() => readMemorySection(project)).toThrow(ProjectError);
    expect(() => readMemorySection(project)).toThrow(/versiones/);
  });

  it("un proyecto del esquema 2 —sin memoria— se sigue abriendo tal cual", async () => {
    const instantaneas = [{ schemaVersion: 1, sourceId: "s1", ring: ["T1", "T2"], vertices: [] }];
    const bytes = await writeProject("c1", { ...sections, instantaneas }, EXPORTED_AT);
    const entries = await readZip(bytes);
    const manifest = JSON.parse(new TextDecoder().decode((entries[0] as { data: Uint8Array }).data)) as Record<string, unknown>;
    const { hash: _hash, ...partial } = { ...manifest, schema_version: 2 } as Record<string, unknown>;
    const { semanticHash } = await import("../../src/domain/semantic-hash.js");
    const antiguo = { ...partial, hash: await semanticHash(partial) };
    const proyecto = await readProject(
      await writeZip([{ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(antiguo)) }, ...entries.slice(1)]),
    );
    expect(proyecto.manifest.schema_version).toBe(2);
    expect(proyecto.sections["instantaneas"]).toEqual(instantaneas);
    expect(proyecto.sections["memoria"]).toBeUndefined();
    expect(readMemorySection(proyecto)).toBeUndefined();
  });
});

/** Reescribe el manifiesto de un proyecto con otro número de esquema y su propio hash, como lo escribió una versión anterior. */
async function asSchema(bytes: Uint8Array, schema: number): Promise<Uint8Array> {
  const entries = await readZip(bytes);
  const manifest = JSON.parse(new TextDecoder().decode((entries[0] as { data: Uint8Array }).data)) as Record<string, unknown>;
  const { hash: _hash, ...partial } = { ...manifest, schema_version: schema } as Record<string, unknown>;
  const { semanticHash } = await import("../../src/domain/semantic-hash.js");
  const antiguo = { ...partial, hash: await semanticHash(partial) };
  return writeZip([{ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(antiguo)) }, ...entries.slice(1)]);
}

describe("ADR-0016 · esquema 4: el plano físico viaja en la sección `plano` y el 3 se sigue abriendo", () => {
  const eventos: PlanEvent[] = [
    {
      type: "crear-plano",
      circuitId: "c1",
      seq: 1,
      effectiveAt: 1000,
      recordedAt: 2000,
      reason: "plano inicial desde v1",
      evidence: { sourceId: "s1", fileName: "s1.csv", detail: "anillo de v1" },
      origin: "manual",
      fromVersion: 1,
      ring: [
        { locationId: "U-0001", tagId: "T001" },
        { locationId: "U-0002", tagId: "T002" },
      ],
    },
    { type: "sustituir", circuitId: "c1", seq: 2, effectiveAt: 3000, recordedAt: 4000, reason: "cambio en campo", evidence: null, origin: "propuesta", locationId: "U-0002", tagId: "T009" },
  ];

  it("ida y vuelta: los eventos vuelven iguales y en orden, con su hash de sección", async () => {
    const plano = planSection([...eventos].reverse());
    expect(plano?.eventos.map((event) => event.seq)).toEqual([1, 2]);
    const project = await readProject(await writeProject("c1", { ...sections, plano }, EXPORTED_AT));
    expect(project.manifest.schema_version).toBe(AGVPROJ_SCHEMA_VERSION);
    expect(project.manifest.sections.map((digest) => digest.name)).toContain("plano");
    expect(readPlanSection(project)).toEqual({ eventos });
  });

  it("sin eventos no hay sección", () => {
    expect(planSection([])).toBeUndefined();
  });

  it("una sección `plano` con otra forma se rechaza diciendo qué falla", async () => {
    const sinEventos = await readProject(await writeProject("c1", { ...sections, plano: { eventos: "no" } }, EXPORTED_AT));
    expect(() => readPlanSection(sinEventos)).toThrow(/eventos/);
    const sinRazon = await readProject(await writeProject("c1", { ...sections, plano: { eventos: [{ ...eventos[1], reason: " " }] } }, EXPORTED_AT));
    expect(() => readPlanSection(sinRazon)).toThrow(ProjectError);
    expect(() => readPlanSection(sinRazon)).toThrow(/razón/);
    const tipoRaro = await readProject(await writeProject("c1", { ...sections, plano: { eventos: [{ ...eventos[1], type: "mover" }] } }, EXPORTED_AT));
    expect(() => readPlanSection(tipoRaro)).toThrow(/tipo/);
  });

  it("un proyecto del esquema 3 —sin plano— se sigue abriendo tal cual", async () => {
    const memoria = memorySection([version(1, "h1", null)], undefined);
    const proyecto = await readProject(await asSchema(await writeProject("c1", { ...sections, memoria }, EXPORTED_AT), 3));
    expect(proyecto.manifest.schema_version).toBe(3);
    expect(readMemorySection(proyecto)).toEqual(memoria);
    expect(proyecto.sections["plano"]).toBeUndefined();
    expect(readPlanSection(proyecto)).toBeUndefined();
  });
});

describe("OQ-140 · esquema 5: los valores de planta confirmados viajan en la sección `valores` y el 4 se sigue abriendo", () => {
  const eventos: PlantValueEvent[] = [
    { circuitId: "c1", seq: 1, key: "noche-desde", value: 20, effectiveAt: 1000, recordedAt: 2000, reason: "la noche empieza a las 20 en planta", origin: "manual" },
    { circuitId: "c1", seq: 2, key: "arranque-turnos", value: [7, 19], effectiveAt: 3000, recordedAt: 4000, reason: "dos turnos desde enero", origin: "manual" },
  ];

  it("ida y vuelta: los eventos vuelven iguales y en orden, con su hash de sección", async () => {
    const valores = plantValuesSection([...eventos].reverse());
    expect(valores?.eventos.map((event) => event.seq)).toEqual([1, 2]);
    const project = await readProject(await writeProject("c1", { ...sections, valores }, EXPORTED_AT));
    expect(project.manifest.schema_version).toBe(AGVPROJ_SCHEMA_VERSION);
    expect(AGVPROJ_SCHEMA_VERSION).toBe(5);
    expect(project.manifest.sections.map((digest) => digest.name)).toContain("valores");
    expect(readPlantValuesSection(project)).toEqual({ eventos });
  });

  it("sin valores confirmados no hay sección", () => {
    expect(plantValuesSection([])).toBeUndefined();
  });

  it("una sección `valores` con otra forma o un valor inválido se rechaza diciendo qué falla", async () => {
    const sinEventos = await readProject(await writeProject("c1", { ...sections, valores: { eventos: "no" } }, EXPORTED_AT));
    expect(() => readPlantValuesSection(sinEventos)).toThrow(/eventos/);
    const sinRazon = await readProject(await writeProject("c1", { ...sections, valores: { eventos: [{ ...eventos[0], reason: "" }] } }, EXPORTED_AT));
    expect(() => readPlantValuesSection(sinRazon)).toThrow(ProjectError);
    expect(() => readPlantValuesSection(sinRazon)).toThrow(/razón/);
    const horaImposible = await readProject(await writeProject("c1", { ...sections, valores: { eventos: [{ ...eventos[0], value: 25 }] } }, EXPORTED_AT));
    expect(() => readPlantValuesSection(horaImposible)).toThrow(/de 0 a 23/);
    const claveRara = await readProject(await writeProject("c1", { ...sections, valores: { eventos: [{ ...eventos[0], key: "drift.minGapMs" }] } }, EXPORTED_AT));
    expect(() => readPlantValuesSection(claveRara)).toThrow(/clave/);
  });

  it("un proyecto del esquema 4 —sin valores— se sigue abriendo tal cual, con su plano", async () => {
    const plano = planSection([
      { type: "sustituir", circuitId: "c1", seq: 1, effectiveAt: 3000, recordedAt: 4000, reason: "cambio en campo", evidence: null, origin: "manual", locationId: "U-0002", tagId: "T009" },
    ]);
    const proyecto = await readProject(await asSchema(await writeProject("c1", { ...sections, plano }, EXPORTED_AT), 4));
    expect(proyecto.manifest.schema_version).toBe(4);
    expect(readPlanSection(proyecto)).toEqual(plano);
    expect(proyecto.sections["valores"]).toBeUndefined();
    expect(readPlantValuesSection(proyecto)).toBeUndefined();
  });
});
