/**
 * El orden del circuito según las lecturas, contrastado tag a tag con la lista (R-GRA-015).
 *
 * El propietario: «el orden de tags del circuito no tiene por qué ser del todo correcto: puede
 * contener erratas al transcribir o un orden diferente al real. Al final las lecturas de los AGV son
 * las que dictan la posición real de los tags». Así que aquí manda lo leído:
 *
 * 1. **Los tags del anillo**, en el orden en que los leen los AGV. El anillo se rota al tag de la lista
 *    con el que más orden comparte (`alignToDeclared`); en empate, al más cercano al comienzo de la lista. Un tag
 *    en la subsecuencia común con la lista está `igual`; uno declarado fuera de ella, en `otro-sitio`
 *    —la lista lo pone en otro sitio, y se corrige la lista—; uno que la lista no tiene,
 *    `no-en-la-lista`.
 * 2. **Los tags leídos fuera del anillo** que se pidan, detrás de su predecesor dominante leído. Si no
 *    se puede, al final, sin un sitio fijo.
 * 3. **Los declarados sin lecturas**, detrás del último tag que les precede en la lista y ya está
 *    colocado. Su posición es la de la lista y nada más: se dice así, no se da por leída.
 *
 * El número de un tag no prueba nada: los tags vienen en familias de números seguidos, y un número
 * parecido a otro es lo normal. Lo que prueba una errata o una sustitución es el sitio.
 */

import type { TagPlace } from "./undeclared-tags.js";
import { alignToDeclared, neighbours } from "./vsystem.js";

export type OrderReading = "leido" | "fuera-del-recorrido" | "sin-lecturas";
export type OrderChange = "igual" | "otro-sitio" | "no-en-la-lista" | "fuera-del-recorrido" | "sin-lecturas";

export interface CircuitOrderRow {
  /** 1…n en el orden según las lecturas. */
  readonly position: number;
  readonly tagId: string;
  readonly reading: OrderReading;
  /** 1…n en la lista; `null` si la lista no lo tiene. */
  readonly listPosition: number | null;
  readonly change: OrderChange;
  /** Dónde lo sitúan las lecturas; `null` sin lecturas. */
  readonly readBetween: string | null;
  /** Dónde lo pone la lista; `null` si la lista no lo tiene. */
  readonly listBetween: string | null;
}

export interface CircuitOrder {
  readonly evaluated: boolean;
  readonly reason: string | null;
  readonly rows: readonly CircuitOrderRow[];
  readonly summary: Readonly<Record<OrderChange, number>>;
}

interface Slot {
  readonly tagId: string;
  readonly reading: OrderReading;
  readonly change: OrderChange;
  readonly readBetween: string | null;
}

const EMPTY_SUMMARY: Readonly<Record<OrderChange, number>> = {
  igual: 0,
  "otro-sitio": 0,
  "no-en-la-lista": 0,
  "fuera-del-recorrido": 0,
  "sin-lecturas": 0,
};

/**
 * `ring` es el anillo observado del circuito; `readTags`, los tags con alguna lectura; `placeOf`, el
 * sitio leído (predecesor y sucesor dominantes) de los tags fuera del anillo que hay que colocar.
 */
export function reconcileCircuitOrder(
  declaredOrder: readonly string[],
  ring: readonly string[],
  readTags: ReadonlySet<string>,
  placeOf: ReadonlyMap<string, TagPlace>,
): CircuitOrder {
  if (declaredOrder.length === 0) {
    return { evaluated: false, reason: "No hay lista «circuito» cargada con la que comparar.", rows: [], summary: EMPTY_SUMMARY };
  }
  const declared = new Set(declaredOrder);
  const listIndex = new Map(declaredOrder.map((tagId, index) => [tagId, index]));
  // La rotación que más orden comparte con la lista: si se rotara al primer tag de la lista y fuera
  // ese el mal colocado, sus vecinos sanos saldrían como «otro sitio» (R-GRA-015: no acusar a un tag sano).
  const { aligned, common: commonList } = alignToDeclared(ring, declaredOrder);
  const common = new Set(commonList);
  const ringBetween = neighbours(aligned, true);

  // 1. El anillo, en el orden en que se lee.
  const sequence: Slot[] = aligned.map((tagId) => ({
    tagId,
    reading: "leido",
    change: common.has(tagId) ? "igual" : declared.has(tagId) ? "otro-sitio" : "no-en-la-lista",
    readBetween: ringBetween.get(tagId) ?? null,
  }));
  const placed = new Set(aligned);

  // 2. Lo leído fuera del anillo, detrás de su predecesor dominante; en cadena, hasta que no avance.
  const offRing = [...placeOf.keys()].filter((tagId) => !placed.has(tagId)).sort((a, b) => a.localeCompare(b));
  const offRingSlot = (tagId: string, readBetween: string): Slot => ({
    tagId,
    reading: "fuera-del-recorrido",
    change: declared.has(tagId) ? "fuera-del-recorrido" : "no-en-la-lista",
    readBetween,
  });
  let pending = offRing;
  for (let progress = true; progress && pending.length > 0; ) {
    progress = false;
    const next: string[] = [];
    for (const tagId of pending) {
      const place = placeOf.get(tagId) as TagPlace;
      const at = place.predecessor === null ? -1 : sequence.findIndex((slot) => slot.tagId === place.predecessor);
      if (at === -1) {
        next.push(tagId);
        continue;
      }
      sequence.splice(at + 1, 0, offRingSlot(tagId, `entre ${place.predecessor} y ${place.successor ?? "—"}`));
      placed.add(tagId);
      progress = true;
    }
    pending = next;
  }
  for (const tagId of pending) {
    sequence.push(offRingSlot(tagId, "sin un sitio fijo"));
    placed.add(tagId);
  }

  // 3. Lo declarado que falta —sin lecturas, o leído sin sitio—, donde lo pone la lista.
  let front = 0;
  for (const [index, tagId] of declaredOrder.entries()) {
    if (placed.has(tagId)) continue;
    let anchor = -1;
    for (let back = index - 1; back >= 0 && anchor === -1; back -= 1) {
      anchor = sequence.findIndex((slot) => slot.tagId === declaredOrder[back]);
    }
    const slot: Slot = readTags.has(tagId)
      ? { tagId, reading: "fuera-del-recorrido", change: "fuera-del-recorrido", readBetween: "sin un sitio fijo" }
      : { tagId, reading: "sin-lecturas", change: "sin-lecturas", readBetween: null };
    if (anchor === -1) {
      sequence.splice(front, 0, slot);
      front += 1;
    } else sequence.splice(anchor + 1, 0, slot);
    placed.add(tagId);
  }

  const listBetween = neighbours(declaredOrder, false);
  const summary = { ...EMPTY_SUMMARY };
  const rows = sequence.map((slot, index): CircuitOrderRow => {
    summary[slot.change] += 1;
    const listAt = listIndex.get(slot.tagId);
    return {
      position: index + 1,
      tagId: slot.tagId,
      reading: slot.reading,
      listPosition: listAt === undefined ? null : listAt + 1,
      change: slot.change,
      readBetween: slot.readBetween,
      listBetween: listAt === undefined ? null : (listBetween.get(slot.tagId) ?? null),
    };
  });
  return { evaluated: true, reason: null, rows, summary };
}
