/**
 * Decodificación del fichero de origen.
 *
 * Está aquí y no en el Worker porque es una decisión de ingesta, no fontanería de hilos: qué bytes
 * son qué texto determina si `MTC nº` es `MTC nº` o basura, y eso hay que poder probarlo.
 */

/** Codificaciones que este importador sabe leer, en orden de preferencia. */
export type Encoding = "utf-8" | "windows-1252";

export interface Decoded {
  readonly text: string;
  readonly encoding: Encoding;
}

/**
 * Decodifica declarando qué codificación se usó, en lugar de suponer UTF-8 y estropear el resto.
 *
 * `TextDecoder("utf-8", { fatal: false })` no falla nunca: sustituye en silencio cada byte que no
 * entiende por un carácter de reemplazo. Un informe exportado en Windows-1252 —lo que hace la
 * fuente real— pasaba así la validación con la cabecera ya corrompida y sin que nadie lo dijera.
 * Con `fatal: true` el intento falla en vez de mentir, y entonces se prueba la codificación que la
 * fuente usa de verdad.
 *
 * Windows-1252 no es una suposición gratuita: no puede fallar —cada byte tiene significado— así que
 * es el último recurso honesto, y por eso la codificación elegida se muestra siempre en el resumen
 * en lugar de quedarse dentro.
 */
export function decodeSource(buffer: ArrayBuffer): Decoded {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(buffer), encoding: "windows-1252" };
  }
}
