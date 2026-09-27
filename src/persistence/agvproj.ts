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
 * compare la cadena de hashes con la local. **No lleva el bruto**, por decisión de ADR-0012. Las lecturas se acumulan en el
 * dispositivo; el fichero es lo que viaja entre dispositivos, que además es un intercambio manual
 * (CON-002).
 */

import { sortVersions, type ConsolidatedVersion, type LineageEvent, type LineageRef, type LineageState } from "../domain/memory.js";
import { canonicalise, semanticHash } from "../domain/semantic-hash.js";
import { readZip, writeZip, ZipError } from "./zip.js";

/** Un número desconocido se rechaza sin tocar nada. Subirlo obliga a escribir su migración. */
export const AGVPROJ_SCHEMA_VERSION = 3;

/**
 * Los esquemas anteriores que esta versión sigue abriendo, con lo que hay que hacer con cada uno.
 *
 * El 1 no llevaba la sección `instantaneas`: un proyecto de entonces se abre tal cual, sin
 * instantáneas, y lo dice quien lo enseña (`instantaneas` ausente). El 2 no llevaba `memoria`: se
 * abre igual, sin memoria (`memoria` ausente, que es «sin-memoria» al clasificar el linaje). No hay
 * nada que reescribir: las secciones que traían significan lo mismo. Un esquema que no esté aquí ni
 * sea el vigente se rechaza.
 */
export const AGVPROJ_READABLE_VERSIONS: readonly number[] = [1, 2, AGVPROJ_SCHEMA_VERSION];

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
  //    se abren: el esquema 1 es el 2 sin la sección `instantaneas`, y el 2 es el 3 sin `memoria`.
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
