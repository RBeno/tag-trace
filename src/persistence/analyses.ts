/**
 * Los análisis guardados en el dispositivo y crear uno nuevo, vacío o a partir de otro (`UX_SPEC.md`
 * §8.1, propietario, 2026-10-18).
 *
 * Un análisis es un circuito del almacén: sus lecturas acumuladas y todo lo que se le declara a mano
 * —las listas (circuito, áreas, carga online, función, zona cargada/vacía, tramos, críticos…), la
 * flota y las conexiones—. El almacén es la carpeta común: al cargar se enseñan los que hay para
 * elegir uno, y uno nuevo puede **partir de otro** copiando lo que se declaró, que es lo que no se
 * puede volver a descargar de planta.
 *
 * Lo que se copia es configuración y nada más. Las lecturas, las instantáneas, la memoria
 * consolidada, la revisión en campo, los expedientes y el registro de conexiones son **de su
 * análisis**: miden o juzgan un periodo concreto, y copiarlos haría pasar por observado aquí lo que se
 * observó allí (ADR-0004). Los valores de planta confirmados tampoco, de momento (OQ-177).
 */

import { distinctSources } from "./retention.js";
import { KNOWN_LISTS } from "../domain/tag-lists.js";
import { createCircuit, listCircuits, type CopiedFrom, type StoredCircuit } from "./store.js";

/** Lo que la lista de análisis enseña de cada uno. Puro: sale del registro del circuito, sin lecturas. */
export interface AnalysisSummary {
  readonly circuitId: string;
  readonly name: string;
  /** Ficheros de lecturas distintos (un repetido no cuenta dos veces, R-DAT-005). */
  readonly files: number;
  /** Primer y último instante cubiertos, o `null` sin lecturas. */
  readonly span: { readonly from: number; readonly to: number } | null;
  readonly lists: readonly { readonly list: string; readonly tags: number; readonly copied: boolean }[];
  /** Periodos del historial de flota y si se copió de otro análisis, o `null` sin historial. */
  readonly fleet: { readonly periods: number; readonly copied: boolean } | null;
  /** AGV con registro de conexiones, o `null` sin registro. */
  readonly connectionVehicles: number | null;
  readonly basedOn: CopiedFrom | null;
  readonly updatedAt: number;
}

export function summarizeAnalysis(circuit: StoredCircuit): AnalysisSummary {
  const coverage = circuit.coverage;
  const first = coverage[0];
  const last = coverage[coverage.length - 1];
  return {
    circuitId: circuit.circuitId,
    name: circuit.name,
    files: distinctSources(circuit.sources).length,
    span: first === undefined || last === undefined ? null : { from: first.from, to: last.to },
    lists: (circuit.lists ?? []).map((entry) => ({ list: entry.list, tags: entry.tags.length, copied: entry.copiedFrom !== undefined })),
    fleet: circuit.fleet === undefined ? null : { periods: circuit.fleet.periods.length, copied: circuit.fleet.copiedFrom !== undefined },
    connectionVehicles: circuit.connections === undefined ? null : new Set(circuit.connections.files.map((file) => file.agvId)).size,
    basedOn: circuit.basedOn ?? null,
    updatedAt: circuit.updatedAt,
  };
}

/** Los análisis guardados, el último tocado primero. */
export function sortAnalyses(summaries: readonly AnalysisSummary[]): readonly AnalysisSummary[] {
  return [...summaries].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "es"));
}

export async function listAnalyses(): Promise<readonly AnalysisSummary[]> {
  return sortAnalyses((await listCircuits()).map(summarizeAnalysis));
}

/**
 * Qué le pasa al nombre de un análisis nuevo, o `null` si vale. Uno que solo difiere en mayúsculas de
 * otro se rechaza también: en planta «PC2» y «pc2» son el mismo circuito, y acumular la mitad en cada
 * uno es justo lo que el gestor tiene que evitar.
 */
export function analysisNameProblem(name: string, existing: readonly string[]): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Escribe el nombre del análisis.";
  const twin = existing.find((other) => other.toLocaleLowerCase("es") === trimmed.toLocaleLowerCase("es"));
  if (twin === undefined) return null;
  return twin === trimmed
    ? `Ya existe «${twin}». Para añadirle lecturas, elígelo en la lista.`
    : `Ya existe «${twin}», que solo se distingue en mayúsculas. Elígelo en la lista o usa otro nombre.`;
}

/** Qué se copia del análisis base. */
export interface BaseCopy {
  readonly lists: boolean;
  readonly fleet: boolean;
}

/**
 * El registro de un análisis nuevo: sin lecturas y, si parte de otro, con una copia de lo elegido.
 * Cada lista y la flota copiadas llevan de dónde vienen; la zona horaria es la del análisis base,
 * porque las fechas de la flota se leyeron con ella. Puro.
 */
export function newAnalysis(input: {
  readonly name: string;
  readonly zone: string;
  readonly now: number;
  readonly base?: StoredCircuit;
  readonly copy?: BaseCopy;
}): StoredCircuit {
  const name = input.name.trim();
  const base = input.base;
  if (base === undefined) return { circuitId: name, name, zone: input.zone, sources: [], coverage: [], updatedAt: input.now };
  const copiedFrom: CopiedFrom = { circuitId: base.circuitId, at: input.now };
  const lists = input.copy?.lists === true ? (base.lists ?? []).map((entry) => ({ ...entry, copiedFrom })) : [];
  const fleet = input.copy?.fleet === true ? base.fleet : undefined;
  return {
    circuitId: name,
    name,
    zone: base.zone,
    sources: [],
    coverage: [],
    ...(lists.length === 0 ? {} : { lists }),
    ...(fleet === undefined ? {} : { fleet: { ...fleet, copiedFrom } }),
    basedOn: copiedFrom,
    updatedAt: input.now,
  };
}

/** Crea el análisis en el almacén; falla con `CircuitExistsError` si el nombre ya está. */
export async function createAnalysis(input: Parameters<typeof newAnalysis>[0]): Promise<StoredCircuit> {
  const circuit = newAnalysis(input);
  await createCircuit(circuit);
  return circuit;
}

/** Las listas conocidas que el análisis todavía no tiene, en el orden en que se enseñan al cargarlas. */
export function missingLists(summary: AnalysisSummary): readonly string[] {
  const loaded = new Set(summary.lists.map((entry) => entry.list));
  return KNOWN_LISTS.filter((list) => !loaded.has(list));
}
