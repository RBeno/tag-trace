/**
 * Contenedor `.agvproj` (ADR-0012).
 *
 * El prototipo resolvió el formato como texto plano leído con `parseProjectFile(text)`: sin
 * manifiesto, sin hash y sin versión de esquema, de modo que un fichero truncado o manipulado no se
 * distinguía de uno válido. Aquí un proyecto corrupto **se nota**.
 *
 * Lo que va dentro y lo que no: `.agvproj` lleva la identidad del circuito, su configuración, el
 * inventario de fuentes con sus hashes, la cobertura y, desde el esquema 2, **las instantáneas de
 * cada fichero** (sección `instantaneas`, ADR-0015 §5): es lo que hace que el circuito viaje con toda
 * su evolución. Desde el esquema 3 lleva además **la memoria consolidada** (sección `memoria`, F4,
 * `MEMORY_CONSOLIDATION.md` §10 y §11): las versiones y el estado de linaje, para que al abrirlo se
 * compare la cadena de hashes con la local. Desde el esquema 4 lleva **el plano físico** (sección
 * `plano`, ADR-0016): sus eventos append-only. Desde el esquema 5 lleva **los valores de planta
 * confirmados** (sección `valores`, OQ-140): sus eventos append-only. **No lleva el bruto**, por decisión de ADR-0012. Las lecturas se acumulan en el
 * dispositivo; el fichero es lo que viaja entre dispositivos, que además es un intercambio manual
 * (CON-002).
 */

import { sortVersions, type ConsolidatedVersion, type LineageEvent, type LineageRef, type LineageState } from "../domain/memory.js";
import type { PlanEvent } from "../domain/plan.js";
import { plantValueEventProblem, type PlantValueEvent } from "../domain/plant-values.js";
import { canonicalise, semanticHash } from "../domain/semantic-hash.js";
import { readZip, writeZip, ZipError } from "./zip.js";

/** Un número desconocido se rechaza sin tocar nada. Subirlo obliga a escribir su migración. */
export const AGVPROJ_SCHEMA_VERSION = 5;

/**
 * Los esquemas anteriores que esta versión sigue abriendo, con lo que hay que hacer con cada uno.
 *
 * El 1 no llevaba la sección `instantaneas`: un proyecto de entonces se abre tal cual, sin
 * instantáneas, y lo dice quien lo enseña (`instantaneas` ausente). El 2 no llevaba `memoria`: se
 * abre igual, sin memoria (`memoria` ausente, que es «sin-memoria» al clasificar el linaje). El 3 no
 * llevaba `plano`: se abre igual, sin plano (`plano` ausente, que es «sin-plano» al importarlo). El 4
 * no llevaba `valores`: se abre igual, sin valores confirmados (rigen los provisionales). No hay
 * nada que reescribir: las secciones que traían significan lo mismo. Un esquema que no esté aquí ni
 * sea el vigente se rechaza.
 */
export const AGVPROJ_READABLE_VERSIONS: readonly number[] = [1, 2, 3, 4, AGVPROJ_SCHEMA_VERSION];

const MANIFEST = "manifest.json";

export class ProjectError extends Error {
  constructor(
    readonly reason: string,
    readonly recovery: string,
  ) {
    super(reason);
    this.name = "ProjectError";
  }
}

export interface SectionDigest {
  readonly name: string;
  readonly hash: string;
  readonly bytes: number;
}

export interface ProjectManifest {
  readonly schema_version: number;
  readonly circuit_id: string;
  readonly exported_at: number;
  readonly sections: readonly SectionDigest[];
  /** Hash sobre el manifiesto **ya completo**, incluidos los hashes de sección. */
  readonly hash: string;
}

export interface Project {
  readonly manifest: ProjectManifest;
  readonly sections: Readonly<Record<string, unknown>>;
}

function encode(value: unknown): Uint8Array {
  // Canónico también aquí: dos exportaciones del mismo estado deben dar bytes idénticos, o el
  // hash global cambiaría sin que el proyecto haya cambiado (INV-010).
  return new TextEncoder().encode(canonicalise(value));
}

/** Escribe un `.agvproj`: cada sección con su hash, y el manifiesto con el suyo al final. */
export async function writeProject(
  circuitId: string,
  sections: Readonly<Record<string, unknown>>,
  exportedAt: number,
): Promise<Uint8Array> {
  const names = Object.keys(sections).sort();
  const payloads = names.map((name) => ({ name, data: encode(sections[name]) }));
  const digests: SectionDigest[] = [];
  for (const { name, data } of payloads) {
    digests.push({ name, hash: await semanticHash(sections[name]), bytes: data.byteLength });
  }

  const partial = {
    schema_version: AGVPROJ_SCHEMA_VERSION,
    circuit_id: circuitId,
    exported_at: exportedAt,
    sections: digests,
  };
  const manifest: ProjectManifest = { ...partial, hash: await semanticHash(partial) };

  return writeZip([
    { name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest)) },
    ...payloads.map(({ name, data }) => ({ name: `sections/${name}.json`, data })),
  ]);
}

/**
 * Lee un `.agvproj` en el orden que fija ADR-0012.
 *
 * Nada de lo que devuelve es utilizable hasta que **todo** ha validado: una sección corrupta
 * invalida la carga entera. Quien llama recibe un proyecto completo o una excepción, nunca un
 * proyecto a medias — que es lo que hace posible la carga transaccional.
 */
export async function readProject(bytes: Uint8Array): Promise<Project> {
  let entries;
  try {
    entries = await readZip(bytes);
  } catch (error) {
    if (error instanceof ZipError) {
      throw new ProjectError(
        `El contenedor no es un proyecto válido: ${error.reason}`,
        "Vuelve a exportarlo desde el dispositivo de origen. El proyecto local no se ha tocado.",
      );
    }
    throw error;
  }

  // 1. El manifiesto, antes que ninguna sección.
  const manifestEntry = entries.find((entry) => entry.name === MANIFEST);
  if (manifestEntry === undefined) {
    throw new ProjectError("El contenedor no trae manifiesto.", "No es un `.agvproj`.");
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestEntry.data)) as ProjectManifest;

  // 2. Una versión desconocida se rechaza sin tocar el almacenamiento local. Las anteriores conocidas
  //    se abren: el esquema 1 es el 2 sin la sección `instantaneas`, el 2 es el 3 sin `memoria`, el 3
  //    es el 4 sin `plano` y el 4 es el 5 sin `valores`.
  if (!AGVPROJ_READABLE_VERSIONS.includes(manifest.schema_version)) {
    throw new ProjectError(
      `El proyecto usa el esquema ${manifest.schema_version} y esta versión entiende el ` +
        `${AGVPROJ_SCHEMA_VERSION}.`,
      manifest.schema_version > AGVPROJ_SCHEMA_VERSION
        ? "Se creó con una versión más nueva de la aplicación. Actualízala para abrirlo."
        : "Hace falta una migración explícita, que esta versión todavía no incluye.",
    );
  }

  // 3. El manifiesto tiene que avalarse a sí mismo antes de creerle los hashes de sección.
  const { hash, ...partial } = manifest;
  if ((await semanticHash(partial)) !== hash) {
    throw new ProjectError(
      "El manifiesto no coincide con su propio hash.",
      "El fichero está alterado o truncado. No se ha cargado nada.",
    );
  }

  // 4. Cada sección contra su hash declarado. Una sola que falle invalida la carga completa.
  const sections: Record<string, unknown> = {};
  for (const digest of manifest.sections) {
    const entry = entries.find((item) => item.name === `sections/${digest.name}.json`);
    if (entry === undefined) {
      throw new ProjectError(
        `Falta la sección «${digest.name}», que el manifiesto declara.`,
        "El fichero está incompleto. No se ha cargado nada.",
      );
    }
    const value = JSON.parse(new TextDecoder().decode(entry.data)) as unknown;
    if ((await semanticHash(value)) !== digest.hash) {
      throw new ProjectError(
        `La sección «${digest.name}» no coincide con su hash.`,
        "El fichero está alterado. No se ha cargado nada.",
      );
    }
    sections[digest.name] = value;
  }

  return { manifest, sections };
}

// --- Sección `memoria` (esquema 3) -----------------------------------------------------------------

/** El nombre de la sección de memoria en el contenedor. */
export const MEMORY_SECTION = "memoria";

/**
 * Lo que viaja de la memoria consolidada: las versiones del linaje activo y de los archivados —tal
 * cual, con su hash, para que el destino pueda encadenarlas y clasificar la relación— y el estado de
 * linaje. Un linaje entrante sin resolver **no** viaja: es una decisión pendiente de este dispositivo.
 */
export interface ProjectMemorySection {
  readonly versiones: readonly ConsolidatedVersion[];
  readonly linaje: {
    readonly activo: LineageRef | null;
    readonly archivados: readonly LineageRef[];
    readonly eventos: readonly LineageEvent[];
  };
}

/** Construye la sección `memoria` a partir de lo guardado. `undefined` si el circuito no tiene versiones. */
export function memorySection(versions: readonly ConsolidatedVersion[], state: LineageState | undefined): ProjectMemorySection | undefined {
  if (versions.length === 0) return undefined;
  const active = state?.active ?? null;
  const archived = state?.archived ?? [];
  const travelling = new Set([...(active?.hashes ?? []), ...archived.flatMap((lineage) => lineage.hashes)]);
  // Sin estado guardado (no debería pasar: se escriben juntos) viajan todas las versiones como un linaje.
  const versiones = state === undefined ? sortVersions(versions) : sortVersions(versions.filter((version) => travelling.has(version.hash)));
  return {
    versiones,
    linaje: {
      activo: active ?? (versiones.length === 0 ? null : { id: (versiones[versiones.length - 1] as ConsolidatedVersion).lineage, hashes: versiones.map((version) => version.hash) }),
      archivados: archived,
      eventos: state?.lineageEvents ?? [],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLineageRef(value: unknown): value is LineageRef {
  return isRecord(value) && typeof value["id"] === "string" && Array.isArray(value["hashes"]) && value["hashes"].every((hash) => typeof hash === "string");
}

/**
 * La sección `memoria` de un proyecto ya validado por hash, con su forma comprobada; `undefined` si el
 * proyecto no la trae (esquemas 1 y 2). Una forma que no sea la esperada se rechaza: los hashes
 * garantizan que nadie tocó el fichero, no que lo escribiera una versión que entendemos.
 */
export function readMemorySection(project: Project): ProjectMemorySection | undefined {
  const raw = project.sections[MEMORY_SECTION];
  if (raw === undefined) return undefined;
  const malformed = (what: string): ProjectError =>
    new ProjectError(`La sección «${MEMORY_SECTION}» no tiene la forma esperada: ${what}.`, "El proyecto se creó con otra versión de la aplicación. No se ha cargado nada.");
  if (!isRecord(raw)) throw malformed("no es un objeto");
  const versiones = raw["versiones"];
  if (!Array.isArray(versiones)) throw malformed("faltan las versiones");
  for (const version of versiones as unknown[]) {
    if (!isRecord(version) || typeof version["hash"] !== "string" || typeof version["version"] !== "number" || typeof version["lineage"] !== "string" || !isRecord(version["snapshot"])) {
      throw malformed("una versión no tiene hash, número, linaje o instantánea");
    }
  }
  const linaje = raw["linaje"];
  if (!isRecord(linaje)) throw malformed("falta el linaje");
  const activo = linaje["activo"];
  const archivados = linaje["archivados"];
  const eventos = linaje["eventos"];
  if (activo !== null && !isLineageRef(activo)) throw malformed("el linaje activo no es válido");
  if (!Array.isArray(archivados) || !archivados.every(isLineageRef)) throw malformed("los linajes archivados no son válidos");
  if (!Array.isArray(eventos)) throw malformed("faltan los eventos de linaje");
  return {
    versiones: versiones as readonly ConsolidatedVersion[],
    linaje: { activo: activo as LineageRef | null, archivados: archivados as readonly LineageRef[], eventos: eventos as readonly LineageEvent[] },
  };
}

// --- Sección `plano` (esquema 4) -------------------------------------------------------------------

/** El nombre de la sección del plano físico en el contenedor. */
export const PLAN_SECTION = "plano";

/** Lo que viaja del plano físico (ADR-0016): sus eventos, tal cual, en orden de registro. */
export interface ProjectPlanSection {
  readonly eventos: readonly PlanEvent[];
}

/** Construye la sección `plano`. `undefined` si el circuito no tiene plano. */
export function planSection(events: readonly PlanEvent[]): ProjectPlanSection | undefined {
  if (events.length === 0) return undefined;
  return { eventos: [...events].sort((a, b) => a.seq - b.seq) };
}

const PLAN_EVENT_TYPES = ["crear-plano", "crear-ubicacion", "instalar", "retirar", "sustituir", "cerrar-ubicacion", "revision-manual"];

/** Qué le falta a un evento del plano para tener la forma esperada, o `null` si la tiene. */
function planEventProblem(value: unknown): string | null {
  if (!isRecord(value)) return "un evento no es un objeto";
  const { type } = value;
  if (typeof type !== "string" || !PLAN_EVENT_TYPES.includes(type)) return "un evento tiene un tipo desconocido";
  if (typeof value["circuitId"] !== "string") return "un evento no tiene circuito";
  if (!Number.isInteger(value["seq"])) return "un evento no tiene número";
  if (typeof value["effectiveAt"] !== "number" || typeof value["recordedAt"] !== "number") return "un evento no tiene sus fechas";
  if (typeof value["reason"] !== "string" || value["reason"].trim() === "") return "un evento no tiene razón";
  if (value["origin"] !== "manual" && value["origin"] !== "propuesta") return "un evento no tiene origen";
  const evidence = value["evidence"];
  if (evidence !== null && (!isRecord(evidence) || typeof evidence["detail"] !== "string")) return "un evento tiene una evidencia sin detalle";
  if (type === "crear-plano") {
    const ring = value["ring"];
    if (typeof value["fromVersion"] !== "number" || !Array.isArray(ring)) return "el evento de creación no tiene versión o anillo";
    if (!ring.every((entry) => isRecord(entry) && typeof entry["locationId"] === "string" && typeof entry["tagId"] === "string")) return "el anillo inicial no es válido";
    return null;
  }
  if (typeof value["locationId"] !== "string") return "un evento no nombra su ubicación";
  if (type === "crear-ubicacion") {
    if (value["kind"] !== "anillo" && value["kind"] !== "salida") return "una ubicación nueva no tiene clase";
    for (const field of ["after", "branchFrom", "virtualTag"]) {
      const entry = value[field];
      if (entry !== null && typeof entry !== "string") return `una ubicación nueva tiene «${field}» inválido`;
    }
  }
  if ((type === "instalar" || type === "sustituir") && typeof value["tagId"] !== "string") return "un evento de instalación no nombra el tag";
  if (type === "revision-manual" && (typeof value["result"] !== "string" || typeof value["note"] !== "string")) return "una revisión manual no tiene resultado o nota";
  return null;
}

/**
 * La sección `plano` de un proyecto ya validado por hash, con su forma comprobada; `undefined` si el
 * proyecto no la trae (esquemas 1 a 3). Una forma que no sea la esperada se rechaza.
 */
export function readPlanSection(project: Project): ProjectPlanSection | undefined {
  const raw = project.sections[PLAN_SECTION];
  if (raw === undefined) return undefined;
  const malformed = (what: string): ProjectError =>
    new ProjectError(`La sección «${PLAN_SECTION}» no tiene la forma esperada: ${what}.`, "El proyecto se creó con otra versión de la aplicación. No se ha cargado nada.");
  if (!isRecord(raw)) throw malformed("no es un objeto");
  const eventos = raw["eventos"];
  if (!Array.isArray(eventos)) throw malformed("faltan los eventos");
  for (const event of eventos as unknown[]) {
    const problem = planEventProblem(event);
    if (problem !== null) throw malformed(problem);
  }
  return { eventos: eventos as readonly PlanEvent[] };
}

// --- Sección `valores` (esquema 5) -----------------------------------------------------------------

/** El nombre de la sección de valores de planta confirmados en el contenedor. */
export const PLANT_VALUES_SECTION = "valores";

/** Lo que viaja de los valores de planta confirmados (OQ-140): sus eventos, tal cual, en orden de registro. */
export interface ProjectPlantValuesSection {
  readonly eventos: readonly PlantValueEvent[];
}

/** Construye la sección `valores`. `undefined` si el circuito no tiene ningún valor confirmado. */
export function plantValuesSection(events: readonly PlantValueEvent[]): ProjectPlantValuesSection | undefined {
  if (events.length === 0) return undefined;
  return { eventos: [...events].sort((a, b) => a.seq - b.seq) };
}

/**
 * La sección `valores` de un proyecto ya validado por hash, con su forma comprobada —cada valor contra
 * su validación, como si lo hubiera escrito una persona aquí—; `undefined` si el proyecto no la trae
 * (esquemas 1 a 4). Una forma que no sea la esperada se rechaza.
 */
export function readPlantValuesSection(project: Project): ProjectPlantValuesSection | undefined {
  const raw = project.sections[PLANT_VALUES_SECTION];
  if (raw === undefined) return undefined;
  const malformed = (what: string): ProjectError =>
    new ProjectError(`La sección «${PLANT_VALUES_SECTION}» no tiene la forma esperada: ${what}.`, "El proyecto se creó con otra versión de la aplicación. No se ha cargado nada.");
  if (!isRecord(raw)) throw malformed("no es un objeto");
  const eventos = raw["eventos"];
  if (!Array.isArray(eventos)) throw malformed("faltan los eventos");
  for (const event of eventos as unknown[]) {
    const problem = plantValueEventProblem(event);
    if (problem !== null) throw malformed(problem);
  }
  return { eventos: eventos as readonly PlantValueEvent[] };
}
