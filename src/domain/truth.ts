/**
 * Los cinco estados de verdad del producto (`GLOSSARY.md`).
 *
 * Existen como tipo propio, y no como cadenas sueltas repartidas por cada módulo, porque son
 * vocabulario normativo: la diferencia entre `observed` e `inferred` es la que separa un hecho de
 * una hipótesis, y la que decide si algo puede presentarse como cierto en la interfaz (R-EVI-003).
 *
 * `unknown` no es un hueco a rellenar. Significa que hubo evidencia y no alcanza para decidir, y
 * sustituirlo por la hipótesis más probable está prohibido (R-EVI-004). Tampoco es «sin datos
 * cargados», que es la ausencia de evidencia y vive en `coverage.ts`: allí nunca hubo nada que
 * mirar, aquí sí lo hubo y no basta.
 */
export type TruthState = "observed" | "inferred" | "expected" | "unknown" | "confirmed";

/** Si un estado puede presentarse al usuario como hecho. Solo dos pueden. */
export function isFact(state: TruthState): boolean {
  return state === "observed" || state === "confirmed";
}
