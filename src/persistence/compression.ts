/**
 * Compresión con el gzip del propio navegador (`CompressionStream`), sin dependencias (OQ-145).
 *
 * Medido el 2026-09-27 (`MEMORY_CONSOLIDATION.md` §9): una versión consolidada ocupa menos del 1 %
 * del CSV de su periodo comprimida, frente al 5 % sin comprimir; las lecturas normalizadas, un 37 %
 * del CSV comprimidas, frente a diez veces el CSV sin comprimir. El propietario decidió guardarlas
 * comprimidas. Existe en los navegadores, en los Workers y en Node 18+, así que se prueba en Node.
 */

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new CompressionStream("gzip"));
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return pipe(bytes, new DecompressionStream("gzip"));
}

export function gzipJson(value: unknown): Promise<Uint8Array> {
  return gzip(new TextEncoder().encode(JSON.stringify(value)));
}

export async function gunzipJson<T>(bytes: Uint8Array): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await gunzip(bytes))) as T;
}
