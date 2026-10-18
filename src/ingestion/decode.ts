/**
 * Decodificación del fichero de origen.
 *
 * Está aquí y no en el Worker porque es una decisión de ingesta, no fontanería de hilos: qué bytes
 * son qué texto determina si `MTC nº` es `MTC nº` o basura, y eso hay que poder probarlo.
 */

/** Codificaciones que este importador sabe leer, en orden de preferencia. */
export type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";

export interface Decoded {
  readonly text: string;
  readonly encoding: Encoding;
  /** Algo de la decodificación que la persona debe saber; sin ella, nada que decir. */
  readonly warning?: string;
}

/**
 * Cuántas secuencias multibyte UTF-8 bien formadas hay, hasta `limit`. Sirve para distinguir un
 * Windows-1252 de verdad —donde casi nunca aparecen— de un UTF-8 con algún byte dañado.
 */
function validUtf8Sequences(bytes: Uint8Array, limit: number): number {
  let found = 0;
  for (let index = 0; index < bytes.length && found < limit; index += 1) {
    const lead = bytes[index] as number;
    const length = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
    if (length === 0 || index + length > bytes.length) continue;
    let continuation = true;
    for (let next = 1; next < length; next += 1) {
      const byte = bytes[index + next] as number;
      if (byte < 0x80 || byte > 0xbf) continuation = false;
    }
    if (continuation) {
      found += 1;
      index += length - 1;
    }
  }
  return found;
}

/** UTF-16 con su BOM. Si algún par no encaja se sustituye y se dice, en vez de leerlo como otra cosa. */
function decodeUtf16(buffer: ArrayBuffer, encoding: "utf-16le" | "utf-16be"): Decoded {
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(buffer), encoding };
  } catch {
    return {
      text: new TextDecoder(encoding).decode(buffer),
      encoding,
      warning:
        "El fichero está en UTF-16 pero trae bytes que no encajan: se han sustituido por «�». " +
        "Si afectan a una fila, irá a cuarentena; si se repite, vuelve a exportarlo.",
    };
  }
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
  const bytes = new Uint8Array(buffer);
  // «Texto Unicode» de Excel: UTF-16 con BOM. Leído como Windows-1252 salía una cabecera con NUL
  // entre cada letra y un «no se reconocieron las columnas» que no apuntaba a la causa.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(buffer, "utf-16le");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(buffer, "utf-16be");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text: text.replace(/^﻿/, ""), encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("windows-1252").decode(buffer);
    // Un solo byte dañado en un UTF-8 (una exportación cortada a mitad de carácter) lo vuelca todo a
    // Windows-1252 y «Vehículo» llega como «VehÃ­culo». Se lee igual, pero se dice.
    if (validUtf8Sequences(bytes, 1) === 0) return { text, encoding: "windows-1252" };
    return {
      text,
      encoding: "windows-1252",
      warning:
        "El fichero no es UTF-8 válido, pero trae caracteres que sí lo son: se ha leído como " +
        "Windows-1252 y algunas letras pueden salir cambiadas («Ã­» en lugar de «í»). Si las ves, la " +
        "exportación está dañada o mezcla codificaciones: vuelve a extraerla.",
    };
  }
}
