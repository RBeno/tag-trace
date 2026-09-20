/**
 * Configuración de análisis del circuito (`CONFIG_SCHEMA.md`, FR-030).
 *
 * Existe porque `AI_DEVELOPMENT_GOVERNANCE.md` §4 prohíbe que una magnitud industrial viva en el
 * código, y porque los módulos de dominio —afinidad, inventario, grafo— se escribieron **sin
 * valores por defecto** justamente para que nadie pudiera llamarlos sin decidir antes. Este fichero
 * es el único sitio donde esos valores se escriben, y ninguno de ellos está aprobado por planta.
 *
 * **Provisional no es un adorno del comentario: viaja con el análisis.** `state: "draft"` llega
 * hasta la interfaz y se muestra junto a cualquier cifra que dependa de él, de modo que nadie
 * confunda «el programa lo calculó» con «alguien decidió este umbral». Cuando el propietario fije
 * los valores, la configuración pasa a `active` con su vigencia y el mismo análisis, repetido, dirá
 * con cuál se hizo (FR-031).
 */

import type { AffinityThresholds } from "./affinity.js";
import type { BlindnessThresholds } from "./inventory.js";
import type { GraphThresholds } from "./graph.js";

export interface AnalysisConfig {
  /**
   * `draft` permite explorar y **no** permite consolidar (`CONFIG_SCHEMA.md` §4).
   *
   * Es la diferencia entre mirar un resultado y fijarlo como memoria del circuito.
   */
  readonly state: "draft" | "active" | "superseded";
  /** Identidad de esta configuración, que se registra con cada análisis (FR-031). */
  readonly configVersion: string;
  readonly affinity: AffinityThresholds;
  readonly blindness: BlindnessThresholds;
  readonly graph: Omit<GraphThresholds, "resolutionMs">;
}

/**
 * Los valores con los que el producto funciona hasta que planta fije los suyos.
 *
 * Cada uno lleva su razón, porque un número sin motivo es indistinguible de uno inventado:
 *
 * - **Afinidad.** Dos exportaciones del mismo circuito comparten casi todos los tags; el contraste
 *   de PC2 contra sus listas dio un 90,8 % de alineación con cuatro errores de lista de por medio.
 *   Por debajo de un 20 % de solape, lo que queda no es una ampliación: es otro sitio.
 * - **Ceguera.** Diez lecturas es lo mínimo para que el silencio de un vehículo sobre un tag no sea
 *   simplemente que apenas circuló. Es una cota grosera y lo seguirá siendo hasta que existan las
 *   vueltas, que es la normalización correcta (R-OPP-010).
 * - **Grafo.** Una cuota del 90 % sobre tres pasadas distingue un sucesor dominante de un reparto;
 *   por encima de la mitad de pares en el mismo instante, el orden no lo da el reloj (R-DAT-013).
 */
export const PROVISIONAL_CONFIG: AnalysisConfig = {
  state: "draft",
  configVersion: "provisional-0",
  affinity: { compatible: 0.6, foreign: 0.2, minTagsToJudge: 5 },
  blindness: { minReadingsPerVehicle: 10, minReadersForContrast: 2 },
  graph: { minShareForObserved: 0.9, minSupportForObserved: 3, maxSameInstantShare: 0.5 },
};

/** Qué decirle al usuario sobre la configuración aplicada. Nunca se calla. */
export function describeConfig(config: AnalysisConfig): string {
  return config.state === "draft"
    ? `provisional (${config.configVersion}): los umbrales no los ha fijado planta todavía, así que ` +
        "sirven para explorar y no para consolidar"
    : `${config.configVersion} (${config.state})`;
}
