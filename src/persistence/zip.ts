/**
 * Zip mínimo, sin dependencias.
 *
 * ADR-0012 fija zip como contenedor de `.agvproj` y ADR-0014 prohíbe cualquier recurso de CDN en
 * ejecución, así que una librería tendría que ir empaquetada. No hace falta: `CompressionStream`
 * está en el navegador y en Node 22, y un zip es cabecera local, entradas y directorio central.
 * Escribirlo aquí mantiene la línea del proyecto —cero dependencias de runtime— y, sobre todo,
 * **deja los límites de descompresión bajo nuestro control**, que ADR-0012 exige como parte del
 * contrato y no como una opción que se pueda olvidar.
 *
 * Se implementa lo que el formato necesita y nada más: sin cifrado, sin zip64, sin carpetas. Un
 * fichero que necesite algo de eso se rechaza en lugar de interpretarse a medias.
 */

/** Límites de TH-005. Un contenedor que los supere se rechaza antes de descomprimir nada. */
export const ZIP_LIMITS = {
  /** Tamaño total descomprimido. */
  maxTotalBytes: 256 * 1024 * 1024,
  /** Entradas del directorio central. */
  maxEntries: 512,
} as const;

export class ZipError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ZipError";
  }
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Descomprime acotando **mientras ocurre**, no después.
 *
 * Es la diferencia entre protegerse de una bomba de descompresión y creer que uno se protege: una
 * cabecera puede mentir sobre el tamaño, y comprobarlo al final significa que la memoria ya se
 * pidió. Aquí el flujo se corta en cuanto la salida pasa de lo declarado.
 *
 * Por eso no hay guardián de ratio: además de no cubrir ese caso, rechazaba datos legítimos —un
 * JSON de lecturas, con sus claves repetidas, comprime muchísimo—.
 */
async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (expected > ZIP_LIMITS.maxTotalBytes) {
    throw new ZipError("Una entrada declara más tamaño del admitido.");
  }
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();

  const out = new Uint8Array(expected);
  let written = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (written + value.byteLength > expected) {
      await reader.cancel();
      throw new ZipError("Una entrada descomprime más de lo que declara: contenedor rechazado.");
    }
    out.set(value, written);
    written += value.byteLength;
  }
  if (written !== expected) {
    throw new ZipError(`Una entrada declara ${expected} bytes y descomprime ${written}.`);
  }
  return out;
}

/** CRC-32, que el formato exige por entrada y es lo que detecta una corrupción silenciosa. */
function crc32(data: Uint8Array): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Escribe un zip con las entradas dadas, cada una comprimida con deflate. */
export async function writeZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressed = await deflate(entry.data);
    // Si comprimir no gana nada —ya ocurre con datos pequeños— se guarda tal cual.
    const useDeflate = compressed.byteLength < entry.data.byteLength;
    const payload = useDeflate ? compressed : entry.data;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const sum = crc32(entry.data);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, LOCAL_HEADER, true);
    header.setUint16(4, 20, true); // versión necesaria
    header.setUint16(6, 0, true); // sin banderas: nada de cifrado ni descriptor diferido
    header.setUint16(8, method, true);
    header.setUint32(14, sum, true);
    header.setUint32(18, payload.byteLength, true);
    header.setUint32(22, entry.data.byteLength, true);
    header.setUint16(26, name.byteLength, true);
    chunks.push(new Uint8Array(header.buffer), name, payload);

    const directory = new DataView(new ArrayBuffer(46));
    directory.setUint32(0, CENTRAL_HEADER, true);
    directory.setUint16(4, 20, true);
    directory.setUint16(6, 20, true);
    directory.setUint16(10, method, true);
    directory.setUint32(16, sum, true);
    directory.setUint32(20, payload.byteLength, true);
    directory.setUint32(24, entry.data.byteLength, true);
    directory.setUint16(28, name.byteLength, true);
    directory.setUint32(42, offset, true);
    central.push(new Uint8Array(directory.buffer), name);

    offset += 30 + name.byteLength + payload.byteLength;
  }

  const centralSize = central.reduce((total, part) => total + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_OF_DIRECTORY, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.byteLength;
  }
  return out;
}

/**
 * Lee un zip entero aplicando los límites **antes** de descomprimir.
 *
 * El orden importa: comprobar después de descomprimir es no comprobar nada, porque para entonces
 * la memoria ya se ha pedido.
 */
export async function readZip(bytes: Uint8Array): Promise<readonly ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let endOffset = -1;
  for (let index = bytes.byteLength - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === END_OF_DIRECTORY) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw new ZipError("No es un zip: falta el fin del directorio central.");

  const count = view.getUint16(endOffset + 10, true);
  if (count > ZIP_LIMITS.maxEntries) {
    throw new ZipError(`El contenedor declara ${count} entradas, por encima del límite.`);
  }

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let cursor = view.getUint32(endOffset + 16, true);
  let totalUncompressed = 0;

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_HEADER) {
      throw new ZipError("El directorio central está corrupto.");
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > ZIP_LIMITS.maxTotalBytes) {
      throw new ZipError("El contenido descomprimido supera el límite de tamaño.");
    }
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      throw new ZipError(`La entrada «${name}» usa un método de compresión no admitido.`);
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const payload = bytes.subarray(start, start + compressedSize);
    const data = method === METHOD_DEFLATE ? await inflate(payload, uncompressedSize) : payload;

    if (crc32(data) !== view.getUint32(cursor + 16, true)) {
      throw new ZipError(`La entrada «${name}» no supera su comprobación de integridad.`);
    }
    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
