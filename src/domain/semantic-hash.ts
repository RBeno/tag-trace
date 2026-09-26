/**
 * Hash semántico de un estado (INV-010, INV-011).
 *
 * «Mismo input, misma configuración y mismas versiones producen el mismo hash» solo se sostiene si
 * la serialización es canónica. Dos objetos con las mismas claves en otro orden, o un número con
 * otra representación, darían hashes distintos y el invariante no valdría nada.
 *
 * La parte delicada son los números, y ADR-0013 lo exige de forma explícita: `0.1 + 0.2` es
 * `0.30000000000000004` y `0.3` no lo es, así que una mediana calculada por dos caminos distintos
 * pero equivalentes rompería el hash sin que nada esté mal. La regla está escrita abajo y forma
 * parte del contrato: cambiarla cambia todos los hashes, y por eso va versionada.
 */

/**
 * Versión de la regla de canonicalización.
 *
 * Va dentro del hash. Si la regla cambia, los hashes viejos dejan de coincidir **a propósito**, en
 * lugar de coincidir por casualidad y hacer pasar por iguales dos estados que no lo son.
 */
export const CANONICAL_VERSION = 1;

/**
 * Cifras significativas con las que se serializa un número no entero.
 *
 * Los enteros se escriben exactos. Un no entero se redondea aquí porque el último bit de un
 * `double` no es información del dominio: es ruido de cómo se calculó.
 */
const SIGNIFICANT_DIGITS = 12;

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    // NaN e infinito no son estados representables: que aparezcan es un defecto aguas arriba, y
    // hashearlos lo escondería detrás de una cadena de aspecto normal.
    throw new TypeError(`Un valor no finito no puede formar parte de un hash semántico: ${value}`);
  }
  if (Number.isInteger(value)) return String(value);
  // `toPrecision` da notación exponencial en los extremos; `Number(...)` la normaliza de vuelta a
  // la forma más corta que representa el mismo valor, que es lo que se quiere escribir.
  return String(Number(value.toPrecision(SIGNIFICANT_DIGITS)));
}

/**
 * Serializa de forma determinista: claves ordenadas, sin espacios y sin `undefined`.
 *
 * `undefined` se omite en lugar de escribirse, para que «ausente» y «presente como indefinido» —que
 * en este dominio son lo mismo— no produzcan hashes distintos.
 */
export function canonicalise(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return canonicalNumber(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalise(item === undefined ? null : item)).join(",")}]`;
  }
  if (value instanceof Map || value instanceof Set || value instanceof Date) {
    // `Object.entries` de un Map, un Set o un Date es vacío: los tres se serializaban como `{}` y
    // dos estados distintos daban el mismo hash, que es lo contrario de lo que INV-010 promete.
    // Quien hashea convierte antes a objeto plano, array o entero; aquí se falla en vez de mentir.
    throw new TypeError(
      `Un ${value.constructor.name} no puede formar parte de un hash semántico: conviértelo antes a objeto plano, array o número`,
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalise(item)}`).join(",")}}`;
  }
  throw new TypeError(`Tipo no serializable en un hash semántico: ${typeof value}`);
}

/** Hash SHA-256 en hexadecimal del estado canonicalizado, con la versión de la regla dentro. */
export async function semanticHash(value: unknown): Promise<string> {
  const payload = `v${CANONICAL_VERSION}:${canonicalise(value)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
