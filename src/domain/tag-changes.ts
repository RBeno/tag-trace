/**
 * Cambios de tag dentro de un mismo periodo cubierto (R-DAT-019).
 *
 * `drift.ts` compara dos periodos separados por un hueco. Esto mira **dentro** de un periodo: con una
 * sola exportación de dos o tres días, un tag que se sustituye a media ventana tiene que verse aquí.
 *
 * **El sitio de un tag** es su predecesor y su sucesor dominantes en la secuencia de lecturas de cada
 * AGV, y los de segundo orden (el predecesor del predecesor, el sucesor del sucesor). El segundo orden
 * hace falta cuando cambian dos tags seguidos: el vecino inmediato de uno es el otro, que también
 * deja de leerse.
 *
 * **Una pasada por el sitio** es un AGV que lee un vecino de un lado y, pocas lecturas después, uno
 * del otro, dentro del mismo tramo de cobertura. Es un acierto si leyó el tag entre medias. Una misma
 * pasada solo se cuenta una vez aunque encaje con varios pares de vecinos.
 *
 * **Dejó de leerse / empezó a leerse.** Tras la última lectura de la flota, quienes lo leían siguieron
 * pasando por su sitio sin leerlo; o, antes de la primera, quienes luego lo leen ya pasaban sin leerlo.
 * No basta con una racha: tiene que ser larga (`minSlotPasses`) y además **improbable por azar** dada
 * la tasa con que el tag se lee en el resto del periodo (`maxChance`). Un tag que se lee una de cada
 * cinco veces tiene rachas largas sin leer como ritmo normal, y eso no es un cambio.
 *
 * **Cambio de tag.** Uno que deja de leerse y otro que empieza en el mismo sitio —comparten vecino
 * dominante— sin solaparse más de `maxOverlapMs`. La pareja solo se forma si es unívoca en los dos
 * sentidos (R-EVI-004), igual que la sustitución candidata de `drift.ts` (R-DAT-017).
 *
 * **Frente al tag nuevo, por AGV** (R-AGV-016). Solo si la flota ya lo lee, se enseña la diferencia de
 * cada AGV: nunca, desde una hora 0 lecturas, empezó a leerlo más tarde, o el porcentaje de pasadas.
 * Son hechos: la causa la pone una persona (R-EVI-006).
 *
 * **Separación con `drift.ts`.** Solo cuenta lo que la flota siguió recorriendo dentro del mismo tramo
 * de cobertura. Un tag que deja de leerse justo al final de una exportación no sale aquí: sale en la
 * comparación entre periodos, y así el mismo cambio no se cuenta dos veces.
 */

import { mergeIntervals, type Interval } from "./coverage.js";
import { dominant, sharedNeighborMatch, type NeighborSignature } from "./drift.js";
import { compareReadings, type SourceDirection } from "./order.js";
import type { TagLife } from "./read-matrix.js";
import type { Reading } from "./reading.js";

export interface TagChangeThresholds {
  /** Pasadas mínimas por el sitio, fuera de la vida del tag, para hablar de que empezó o acabó. */
  readonly minSlotPasses: number;
  /** Probabilidad máxima de que esa racha sin leer sea casualidad, dada la tasa del tag. */
  readonly maxChance: number;
  /** Lecturas que caben entre los dos vecinos para que siga contando como paso por el sitio. */
  readonly maxReadsBetween: number;
  /** Solape máximo entre el tag que deja de leerse y el que empieza, para emparejarlos. */
  readonly maxOverlapMs: number;
}

/** Lo que hace falta para enseñar la diferencia de un AGV frente a un tag nuevo. */
export interface AdoptionThresholds {
  /** Pasadas mínimas para decir «nunca» o «desde tal hora, 0 lecturas». */
  readonly minPassesForNever: number;
  /** Tasa a partir de la cual se dice que un AGV lo lee. */
  readonly highRate: number;
  /** Cuota de AGV que ya lo leen para enseñar a los que no. */
  readonly minAdoptionShare: number;
}

export type TagChange =
  /** Un tag deja de leerse y otro empieza en su mismo sitio. */
  | {
      readonly kind: "cambio";
      readonly oldTagId: string;
      readonly newTagId: string;
      readonly oldLastUtcMs: number;
      readonly newFirstUtcMs: number;
      readonly sharedNeighbor: string;
      readonly neighborSide: "predecesor" | "sucesor";
      /** Pasadas por el sitio sin leer el viejo, después de su última lectura. */
      readonly passesAfterOld: number;
      /** Pasadas por el sitio sin leer el nuevo, antes de su primera lectura. */
      readonly passesBeforeNew: number;
    }
  | { readonly kind: "deja"; readonly tagId: string; readonly lastUtcMs: number; readonly passesAfter: number }
  | { readonly kind: "empieza"; readonly tagId: string; readonly firstUtcMs: number; readonly passesBefore: number };

export type AdoptionFact =
  /** 0 lecturas en todas sus pasadas desde que el tag empezó a leerse. */
  | { readonly kind: "nunca"; readonly passes: number }
  /** Lo leía y, desde su última lectura, pasó sin leerlo. */
  | { readonly kind: "desde"; readonly sinceUtcMs: number; readonly passesSince: number }
  /** Empezó a leerlo más tarde que el resto, tras varias pasadas sin leerlo. */
  | { readonly kind: "tarde"; readonly startedUtcMs: number; readonly passesBefore: number }
  /** Lo lee en menos pasadas que el resto. */
  | { readonly kind: "poco"; readonly hits: number; readonly passes: number };

export interface AdoptionIssue {
  readonly agvId: string;
  readonly tagId: string;
  readonly fact: AdoptionFact;
}

export interface TagChangeReport {
  /** Por orden de tiempo. */
  readonly changes: readonly TagChange[];
  readonly adoption: readonly AdoptionIssue[];
  /** Cuándo empezó o dejó de leerse cada tag con cambio, para medirlo solo dentro de su vida. */
  readonly lives: ReadonlyMap<string, TagLife>;
}

interface Step {
  readonly tagId: string;
  readonly utcMs: number;
  readonly span: number;
}

interface SlotPass {
  readonly agvId: string;
  readonly utcMs: number;
  readonly span: number;
  readonly hit: boolean;
}

interface Boundary {
  readonly tagId: string;
  readonly utcMs: number;
  readonly passes: number;
}

export function detectTagChanges(
  readings: readonly Reading[],
  direction: SourceDirection,
  coverage: readonly Interval[],
  thresholds: TagChangeThresholds,
  adoptionThresholds: AdoptionThresholds,
): TagChangeReport {
  const merged = mergeIntervals(coverage);
  const spanOf = (utcMs: number): number => {
    if (merged.length === 0) return 0;
    let low = 0;
    let high = merged.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const interval = merged[middle] as Interval;
      if (utcMs < interval.from) high = middle - 1;
      else if (utcMs > interval.to) low = middle + 1;
      else return middle;
    }
    return -1;
  };

  // Secuencia de cada AGV en orden canónico (ADR-0013), sin repeticiones inmediatas del mismo tag.
  const byVehicle = new Map<string, Reading[]>();
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const readers = new Map<string, Set<string>>();
  for (const reading of readings) {
    const utcMs = reading.time.utcMs;
    let own = byVehicle.get(reading.agvId);
    if (own === undefined) {
      own = [];
      byVehicle.set(reading.agvId, own);
    }
    own.push(reading);
    if (!first.has(reading.tagId) || utcMs < (first.get(reading.tagId) as number)) first.set(reading.tagId, utcMs);
    if (!last.has(reading.tagId) || utcMs > (last.get(reading.tagId) as number)) last.set(reading.tagId, utcMs);
    let who = readers.get(reading.tagId);
    if (who === undefined) {
      who = new Set();
      readers.set(reading.tagId, who);
    }
    who.add(reading.agvId);
  }
  const sequences = new Map<string, Step[]>();
  for (const [agvId, own] of byVehicle) {
    own.sort((a, b) => compareReadings(a, b, direction));
    const seq: Step[] = [];
    for (const reading of own) {
      if (seq.length > 0 && (seq[seq.length - 1] as Step).tagId === reading.tagId) continue;
      seq.push({ tagId: reading.tagId, utcMs: reading.time.utcMs, span: spanOf(reading.time.utcMs) });
    }
    sequences.set(agvId, seq);
  }

  // Vecinos dominantes, contados solo entre lecturas del mismo tramo de cobertura.
  const predecessors = new Map<string, Map<string, number>>();
  const successors = new Map<string, Map<string, number>>();
  const bump = (target: Map<string, Map<string, number>>, key: string, neighbor: string): void => {
    let counts = target.get(key);
    if (counts === undefined) {
      counts = new Map();
      target.set(key, counts);
    }
    counts.set(neighbor, (counts.get(neighbor) ?? 0) + 1);
  };
  for (const seq of sequences.values()) {
    for (let index = 1; index < seq.length; index += 1) {
      const prev = seq[index - 1] as Step;
      const curr = seq[index] as Step;
      if (prev.span !== curr.span || prev.span === -1) continue;
      bump(successors, prev.tagId, curr.tagId);
      bump(predecessors, curr.tagId, prev.tagId);
    }
  }
  const signature = (tagId: string): NeighborSignature => ({
    predecessor: dominant(predecessors.get(tagId)),
    successor: dominant(successors.get(tagId)),
  });

  // Índice de sitios: cada par (vecino de antes, vecino de después) apunta a los tags que encierra.
  const slotIndex = new Map<string, string[]>();
  for (const tagId of first.keys()) {
    const own = signature(tagId);
    const before = [own.predecessor, own.predecessor === null ? null : dominant(predecessors.get(own.predecessor))];
    const after = [own.successor, own.successor === null ? null : dominant(successors.get(own.successor))];
    for (const p of before) {
      for (const s of after) {
        if (p === null || s === null || p === s || p === tagId || s === tagId) continue;
        const key = `${p}|${s}`;
        const tags = slotIndex.get(key) ?? [];
        if (!tags.includes(tagId)) tags.push(tagId);
        slotIndex.set(key, tags);
      }
    }
  }

  // Pasadas por el sitio de cada tag. Una pasada se cuenta una vez: si empieza antes de que acabe la
  // última registrada para ese tag y ese AGV, es la misma vista con otro par de vecinos.
  const passes = new Map<string, SlotPass[]>();
  for (const [agvId, seq] of sequences) {
    const lastEnd = new Map<string, number>();
    for (let i = 0; i < seq.length; i += 1) {
      const from = seq[i] as Step;
      if (from.span === -1) continue;
      const limit = Math.min(seq.length - 1, i + 1 + thresholds.maxReadsBetween);
      for (let j = i + 1; j <= limit; j += 1) {
        const to = seq[j] as Step;
        if (to.span !== from.span) break;
        const tags = slotIndex.get(`${from.tagId}|${to.tagId}`);
        if (tags === undefined) continue;
        for (const tagId of tags) {
          const previous = lastEnd.get(tagId);
          if (previous !== undefined && i < previous) continue;
          let hit = false;
          for (let k = i + 1; k < j; k += 1) if ((seq[k] as Step).tagId === tagId) hit = true;
          const list = passes.get(tagId) ?? [];
          list.push({ agvId, utcMs: to.utcMs, span: to.span, hit });
          passes.set(tagId, list);
          lastEnd.set(tagId, j);
        }
      }
    }
  }
  for (const list of passes.values()) list.sort((a, b) => a.utcMs - b.utcMs);

  // ¿La racha fuera de la vida del tag es larga e improbable por azar?
  const boundary = (tagId: string, side: "fin" | "inicio"): number | null => {
    const list = passes.get(tagId);
    const who = readers.get(tagId);
    if (list === undefined || who === undefined) return null;
    const cut = side === "fin" ? (last.get(tagId) as number) : (first.get(tagId) as number);
    const cutSpan = spanOf(cut);
    let inside = 0;
    let insideHits = 0;
    let outside = 0;
    for (const pass of list) {
      if (!who.has(pass.agvId)) continue;
      const beyond = side === "fin" ? pass.utcMs > cut : pass.utcMs < cut;
      if (beyond) {
        if (pass.span === cutSpan) outside += 1;
      } else {
        inside += 1;
        if (pass.hit) insideHits += 1;
      }
    }
    if (inside === 0 || outside < thresholds.minSlotPasses) return null;
    const rate = insideHits / inside;
    const chance = rate >= 1 ? 0 : (1 - rate) ** outside;
    return chance <= thresholds.maxChance ? outside : null;
  };

  const ends: Boundary[] = [];
  const starts: Boundary[] = [];
  for (const tagId of first.keys()) {
    const after = boundary(tagId, "fin");
    if (after !== null) ends.push({ tagId, utcMs: last.get(tagId) as number, passes: after });
    const before = boundary(tagId, "inicio");
    if (before !== null) starts.push({ tagId, utcMs: first.get(tagId) as number, passes: before });
  }

  // Pareja unívoca en los dos sentidos: mismo sitio y sin solaparse más de lo admitido.
  const candidatesOf = new Map<string, Array<{ start: Boundary; side: "predecesor" | "sucesor"; neighbor: string }>>();
  const endsOf = new Map<string, string[]>();
  for (const end of ends) {
    const found: Array<{ start: Boundary; side: "predecesor" | "sucesor"; neighbor: string }> = [];
    for (const start of starts) {
      if (start.tagId === end.tagId) continue;
      if (start.utcMs < end.utcMs - thresholds.maxOverlapMs) continue;
      const match = sharedNeighborMatch(signature(end.tagId), signature(start.tagId));
      if (match === null) continue;
      found.push({ start, side: match.side, neighbor: match.neighbor });
      endsOf.set(start.tagId, [...(endsOf.get(start.tagId) ?? []), end.tagId]);
    }
    candidatesOf.set(end.tagId, found);
  }

  const changes: TagChange[] = [];
  const pairedStarts = new Set<string>();
  for (const end of ends) {
    const found = candidatesOf.get(end.tagId) ?? [];
    const only = found.length === 1 ? found[0] : undefined;
    const back = only === undefined ? [] : (endsOf.get(only.start.tagId) ?? []);
    if (only !== undefined && back.length === 1 && back[0] === end.tagId) {
      pairedStarts.add(only.start.tagId);
      changes.push({
        kind: "cambio",
        oldTagId: end.tagId,
        newTagId: only.start.tagId,
        oldLastUtcMs: end.utcMs,
        newFirstUtcMs: only.start.utcMs,
        sharedNeighbor: only.neighbor,
        neighborSide: only.side,
        passesAfterOld: end.passes,
        passesBeforeNew: only.start.passes,
      });
      continue;
    }
    changes.push({ kind: "deja", tagId: end.tagId, lastUtcMs: end.utcMs, passesAfter: end.passes });
  }
  for (const start of starts) {
    if (pairedStarts.has(start.tagId)) continue;
    changes.push({ kind: "empieza", tagId: start.tagId, firstUtcMs: start.utcMs, passesBefore: start.passes });
  }
  changes.sort((a, b) => changeAt(a) - changeAt(b));

  const lives = new Map<string, TagLife>();
  const setLife = (tagId: string, part: Partial<TagLife>): void => {
    const current = lives.get(tagId) ?? { from: null, to: null };
    lives.set(tagId, { ...current, ...part });
  };
  for (const end of ends) setLife(end.tagId, { to: end.utcMs });
  for (const start of starts) setLife(start.tagId, { from: start.utcMs });

  return { changes, adoption: adoptionOf(starts, passes, adoptionThresholds), lives };
}

/** La diferencia de cada AGV frente a un tag que empezó a leerse, si la flota ya lo lee. */
function adoptionOf(
  starts: readonly Boundary[],
  passes: ReadonlyMap<string, readonly SlotPass[]>,
  thresholds: AdoptionThresholds,
): AdoptionIssue[] {
  const issues: AdoptionIssue[] = [];
  for (const start of starts) {
    const byVehicle = new Map<string, SlotPass[]>();
    for (const pass of passes.get(start.tagId) ?? []) {
      if (pass.utcMs < start.utcMs) continue;
      const list = byVehicle.get(pass.agvId) ?? [];
      list.push(pass);
      byVehicle.set(pass.agvId, list);
    }
    const eligible = [...byVehicle].filter(([, list]) => list.length >= thresholds.minPassesForNever);
    if (eligible.length === 0) continue;
    const adopters = eligible.filter(([, list]) => list.some((pass) => pass.hit)).length;
    if (adopters / eligible.length < thresholds.minAdoptionShare) continue;

    for (const [agvId, list] of eligible) {
      const fact = factOf(list, thresholds);
      if (fact !== null) issues.push({ agvId, tagId: start.tagId, fact });
    }
  }
  return issues.sort((a, b) => a.tagId.localeCompare(b.tagId) || a.agvId.localeCompare(b.agvId));
}

function factOf(list: readonly SlotPass[], thresholds: AdoptionThresholds): AdoptionFact | null {
  const hits = list.filter((pass) => pass.hit).length;
  if (hits === 0) return { kind: "nunca", passes: list.length };
  const firstHit = list.findIndex((pass) => pass.hit);
  let lastHit = list.length - 1;
  while (lastHit >= 0 && !(list[lastHit] as SlotPass).hit) lastHit -= 1;
  const trailing = list.length - 1 - lastHit;
  if (trailing >= thresholds.minPassesForNever && hits / (list.length - trailing) >= thresholds.highRate) {
    return { kind: "desde", sinceUtcMs: (list[lastHit] as SlotPass).utcMs, passesSince: trailing };
  }
  if (firstHit >= thresholds.minPassesForNever && hits / (list.length - firstHit) >= thresholds.highRate) {
    return { kind: "tarde", startedUtcMs: (list[firstHit] as SlotPass).utcMs, passesBefore: firstHit };
  }
  if (hits / list.length < thresholds.highRate) return { kind: "poco", hits, passes: list.length };
  return null;
}

/**
 * El informe sin estos tags: los que se leen solo en un régimen, como un tag de noche (R-DAT-022),
 * empiezan y dejan de leerse cada día por su horario, no porque cambien. Un cambio emparejado con uno
 * de ellos se queda en lo que dice el otro lado: el que deja de leerse, o el que empieza.
 */
function changeAt(change: TagChange): number {
  return change.kind === "cambio" ? change.oldLastUtcMs : change.kind === "deja" ? change.lastUtcMs : change.firstUtcMs;
}

export function withoutTags(report: TagChangeReport, tags: ReadonlySet<string>): TagChangeReport {
  if (tags.size === 0) return report;
  const changes: TagChange[] = [];
  for (const change of report.changes) {
    if (change.kind !== "cambio") {
      if (!tags.has(change.tagId)) changes.push(change);
      continue;
    }
    const oldOut = tags.has(change.oldTagId);
    const newOut = tags.has(change.newTagId);
    if (!oldOut && !newOut) changes.push(change);
    else if (!oldOut) changes.push({ kind: "deja", tagId: change.oldTagId, lastUtcMs: change.oldLastUtcMs, passesAfter: change.passesAfterOld });
    else if (!newOut) changes.push({ kind: "empieza", tagId: change.newTagId, firstUtcMs: change.newFirstUtcMs, passesBefore: change.passesBeforeNew });
  }
  changes.sort((a, b) => changeAt(a) - changeAt(b));
  return {
    changes,
    adoption: report.adoption.filter((issue) => !tags.has(issue.tagId)),
    lives: new Map([...report.lives].filter(([tagId]) => !tags.has(tagId))),
  };
}
