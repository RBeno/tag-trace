/**
 * Contenedor `.agvproj` (ADR-0012).
 *
 * El prototipo resolvió el formato como texto plano leído con `parseProjectFile(text)`: sin
 * manifiesto, sin hash y sin versión de esquema, de modo que un fichero truncado o manipulado no se
 * distinguía de uno válido. Aquí un proyecto corrupto **se nota**.
 *
 * Lo que va dentro y lo que no: `.agvproj` lleva la identidad del circuito, su configuración, el
 * inventario de fuentes con sus hashes y la cobertura. **No lleva el bruto**, por decisión de
 * ADR-0012. Las lecturas se acumulan en el dispositivo; el fichero es lo que viaja entre
 * dispositivos, que además es un intercambio manual (CON-002).
 */

import { canonicalise, semanticHash } from "../domain/semantic-hash.js";
import { readZip, writeZip, ZipError } from "./zip.js";

/** Un número desconocido se rechaza sin tocar nada. Subirlo obliga a escribir su migración. */
export const AGVPROJ_SCHEMA_VERSION = 1;

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

  // 2. Una versión desconocida se rechaza sin tocar el almacenamiento local.
  if (manifest.schema_version !== AGVPROJ_SCHEMA_VERSION) {
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
