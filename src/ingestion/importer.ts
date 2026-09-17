/**
 * Importación de una fuente de lecturas.
 *
 * Núcleo puro: no conoce el DOM, ni `postMessage`, ni el Worker que lo aloja. Recibe un lector de
 * bloques y devuelve el resultado, lo que permite probarlo en Node sin navegador.
 *
 * **Una sola pasada.** El fichero se recorre una vez y se parsea una vez. El defecto del prototipo
 * era parsear en el hilo principal «para comprobar» y volver a parsear dentro del Worker; aquí no
 * hay ningún camino que permita repetirlo.
 */

import { rankDelimiters, type Delimiter, type DelimiterDetection } from "./delimiter.js";
import { measureMonotonicity } from "./monotonicity.js";
import { measureSameInstant } from "./same-instant.js";
import {
  detectFieldOrder,
  parseTimestamp,
  type FieldOrder,
  type TimeParseOptions,
} from "../domain/time.js";
import { sortReadings } from "../domain/order.js";
import { isDefect } from "../domain/reading.js";
import type { Provenance, QuarantinedRow, Reading, RejectionCode } from "../domain/reading.js";
import type { ImportErrorCode, SourceSummary, Stage } from "../application/protocol.js";

/** Límites defensivos (TH-006). Un fichero mayor se rechaza en lugar de agotar la memoria. */
export const LIMITS = {
  maxBytes: 512 * 1024 * 1024,
  maxRows: 5_000_000,
  maxFieldChars: 4_096,
} as const;

/**
 * Consistencia mínima para considerar viable a un separador.
 *
 * No es el umbral de calidad de la fuente, sino el de **identificación**: por debajo de la mitad de
 * la muestra el separador ya no explica la estructura del fichero. Una fuente buena con alguna fila
 * mal formada baja la consistencia sin dejar de ser evidente, y esas filas son cuarentena fila a
 * fila (`FIELD_COUNT`), no motivo para rechazar el fichero entero.
 */
const MIN_DELIMITER_CONSISTENCY = 0.5;

/** Por encima de esto el separador se acepta en silencio; por debajo se acepta pero se advierte. */
const CLEAN_DELIMITER_CONSISTENCY = 0.9;

/** Distancia mínima entre el mejor candidato y el segundo para que la elección sea inequívoca. */
const DELIMITER_MARGIN = 0.1;

/**
 * F1a·0 no tiene todavía vista previa con elección manual de separador, así que la recuperación no
 * puede prometerla. Se dice lo que el usuario puede hacer hoy, no lo que hará la aplicación luego.
 */
const NO_MANUAL_DELIMITER =
  "Comprueba que la exportación usa un solo separador y que todas las filas tienen el mismo " +
  "número de campos. Fijarlo a mano todavía no es posible.";

/** Cada cuántas filas se atiende la cancelación y se informa del progreso. */
const CHECKPOINT_ROWS = 20_000;

/** Cuántos valores de fecha bastan para determinar el orden de campos en un fichero sano. */
const SAMPLE_LIMIT = 5_000;

/**
 * Proporción de pasos de un vehículo que comparten instante a partir de la cual se avisa.
 *
 * No es una magnitud industrial —no describe la planta, sino la relación entre la resolución de la
 * fuente y su ritmo de eventos—, así que vive aquí y no en la configuración del circuito. El valor
 * es deliberadamente bajo: por encima de una décima parte ya hay tramos enteros de secuencia cuyo
 * orden no lo da el reloj, y eso hay que decirlo mientras la fuente todavía se pueda reexportar.
 */
const DEGRADED_RESOLUTION = 0.1;

export interface ImportOptions {
  readonly sourceId: string;
  readonly fileName: string;
  readonly byteSize: number;
  readonly zone: string;
  readonly fieldOrder?: FieldOrder | undefined;
  /**
   * Codificación con la que el llamante decodificó el texto. El núcleo recibe texto ya decodificado
   * y no puede averiguarla, así que solo la transporta. Si nadie la declara se dice «desconocida»,
   * no se supone `utf-8`.
   */
  readonly encoding?: string | undefined;
}

export interface ImportCallbacks {
  readonly onProgress: (stage: Stage, done: number, total: number, note: string) => void;
  /** Punto de control cooperativo: si devuelve true, la importación se detiene sin efectos. */
  readonly isCancelled: () => boolean;
}

export class ImportFailure extends Error {
  /**
   * `reason` y no `cause`: en `Error`, `cause` significa «el error que provocó este», y aquí es un
   * texto para el usuario. Se traduce al campo `cause` del protocolo al emitir el mensaje.
   */
  constructor(
    readonly code: ImportErrorCode,
    readonly reason: string,
    readonly recovery: string,
    readonly detectedSchema?: readonly string[],
    readonly sampleRows?: readonly string[],
  ) {
    super(reason);
    this.name = "ImportFailure";
  }
}

/** Señal interna de cancelación atendida. */
export class ImportCancelled extends Error {
  constructor(readonly stage: Stage) {
    super("cancelled");
    this.name = "ImportCancelled";
  }
}

export interface ImportResult {
  readonly summary: SourceSummary;
  readonly readings: Reading[];
  readonly quarantine: QuarantinedRow[];
  readonly warnings: string[];
}

/** El alcance en palabras, para que el mensaje se lea como una frase y no como un volcado. */
function describeSpan(days: number): string {
  if (days === 0) return "un solo día";
  return days === 1 ? "dos días seguidos" : `${days} días`;
}

/** Recorta un valor para que pueda mostrarse sin volcar una fila entera. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 120 ? flat : `${flat.slice(0, 117)}…`;
}

/** Nombres de columna admitidos para cada campo del contrato mínimo. */
const HEADER_ALIASES = {
  time: ["fecha", "fecha/hora", "date", "timestamp", "instante"],
  agv: ["agv", "vehiculo", "vehículo", "carro"],
  tag: ["tag", "punto", "baliza"],
} as const;

interface ColumnMap {
  readonly time: number;
  readonly agv: number;
  readonly tag: number;
}

function normaliseHeaderCell(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Asigna columnas por nombre de cabecera.
 *
 * Si la cabecera no se reconoce se falla con el esquema detectado a la vista, en lugar de asumir un
 * orden posicional que produciría lecturas silenciosamente equivocadas.
 */
export function mapColumns(header: readonly string[]): ColumnMap {
  const normalised = header.map(normaliseHeaderCell);
  const find = (aliases: readonly string[]): number =>
    normalised.findIndex((cell) => aliases.includes(cell));

  const time = find(HEADER_ALIASES.time);
  const agv = find(HEADER_ALIASES.agv);
  const tag = find(HEADER_ALIASES.tag);

  if (time < 0 || agv < 0 || tag < 0) {
    const missing = [
      time < 0 ? "fecha/hora" : null,
      agv < 0 ? "AGV" : null,
      tag < 0 ? "tag" : null,
    ].filter((name): name is string => name !== null);
    throw new ImportFailure(
      "SCHEMA_UNRECOGNISED",
      `No se reconocieron las columnas obligatorias: ${missing.join(", ")}.`,
      "Comprueba que la primera fila es la cabecera y que incluye fecha, AGV y tag.",
      header,
    );
  }
  return { time, agv, tag };
}

/** Parte una línea sin usar expresiones regulares, y recorta campos desmesurados. */
function splitLine(line: string, delimiter: Delimiter): string[] {
  const fields = line.split(delimiter);
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] as string;
    if (field.length > LIMITS.maxFieldChars) fields[index] = field.slice(0, LIMITS.maxFieldChars);
  }
  return fields;
}

/**
 * Ejecuta la importación completa sobre un texto ya decodificado.
 *
 * Se recibe el texto entero porque F1a·0 trabaja con muestras de pocos días; el troceado por
 * bloques con presupuesto de memoria llega con PERF-D3, y la firma no cambiará al hacerlo porque el
 * recorrido ya es por líneas y con puntos de control.
 */
export function importReadings(
  text: string,
  options: ImportOptions,
  callbacks: ImportCallbacks,
): ImportResult {
  const startedAt = Date.now();

  if (options.byteSize > LIMITS.maxBytes) {
    throw new ImportFailure(
      "LIMIT_EXCEEDED",
      `El fichero ocupa ${options.byteSize} bytes y el límite es ${LIMITS.maxBytes}.`,
      "Exporta un periodo más corto y vuelve a intentarlo.",
    );
  }

  const lines = text.split(/\r\n|\n|\r/);
  while (lines.length > 0 && (lines[lines.length - 1] as string).trim() === "") lines.pop();

  if (lines.length < 2) {
    throw new ImportFailure(
      "SCHEMA_UNRECOGNISED",
      "El fichero no contiene una cabecera y al menos una fila de datos.",
      "Comprueba que la exportación no está vacía.",
    );
  }
  if (lines.length > LIMITS.maxRows) {
    throw new ImportFailure(
      "LIMIT_EXCEEDED",
      `El fichero tiene ${lines.length} filas y el límite es ${LIMITS.maxRows}.`,
      "Exporta un periodo más corto y vuelve a intentarlo.",
    );
  }

  // --- Muestreo: delimitador y orden de campos, sobre una muestra acotada ---
  callbacks.onProgress("sampling", 0, 1, "Detectando estructura");
  const sample = lines.slice(0, Math.min(lines.length, 500));
  const ranking = rankDelimiters(sample);
  const viable = ranking.filter(
    (candidate) =>
      candidate.fieldCount > 1 && candidate.confidence >= MIN_DELIMITER_CONSISTENCY,
  );

  if (viable.length === 0) {
    throw new ImportFailure(
      "DELIMITER_AMBIGUOUS",
      `Ningún separador produce un número de campos consistente (mejor intento: ` +
        `${(ranking[0]?.confidence ?? 0).toFixed(2)} de consistencia).`,
      NO_MANUAL_DELIMITER,
      undefined,
      sample.slice(0, 3).map(excerpt),
    );
  }

  const detection = viable[0] as DelimiterDetection;
  const runnerUp = viable[1];
  if (runnerUp !== undefined && detection.confidence - runnerUp.confidence < DELIMITER_MARGIN) {
    throw new ImportFailure(
      "DELIMITER_AMBIGUOUS",
      `Dos separadores explican el fichero casi igual de bien ` +
        `(«${detection.delimiter}» ${detection.confidence.toFixed(2)} frente a ` +
        `«${runnerUp.delimiter}» ${runnerUp.confidence.toFixed(2)}): elegir uno sería adivinar.`,
      NO_MANUAL_DELIMITER,
      undefined,
      sample.slice(0, 3).map(excerpt),
    );
  }

  const header = splitLine(lines[0] as string, detection.delimiter).map((cell) =>
    cell.replace(/^\ufeff/, "").trim(),
  );
  const columns = mapColumns(header);

  let fieldOrder: FieldOrder;
  let fieldOrderEvidence: string;
  if (options.fieldOrder !== undefined) {
    fieldOrder = options.fieldOrder;
    fieldOrderEvidence = "fijado por el usuario";
  } else {
    const collectTimeSamples = (limit: number): string[] => {
      const values: string[] = [];
      for (let index = 1; index < lines.length; index += 1) {
        const fields = splitLine(lines[index] as string, detection.delimiter);
        const value = fields[columns.time];
        if (value !== undefined) values.push(value);
        if (values.length >= limit) break;
      }
      return values;
    };

    let timeSamples = collectTimeSamples(SAMPLE_LIMIT);
    let order = detectFieldOrder(timeSamples);
    const inconclusive =
      !order.determined && (order.reason === "NO_DATES" || order.reason === "AMBIGUOUS");
    if (inconclusive && timeSamples.length >= SAMPLE_LIMIT) {
      // La muestra no decidió. Antes de rendirse se mira el resto del fichero: es barato —solo la
      // columna de fecha— y solo ocurre cuando ya se ha agotado el recurso normal.
      //
      // Para `AMBIGUOUS` no es un lujo, es obligatorio, y por dos motivos. Uno: la fuente entrega
      // como pila, así que las primeras cinco mil filas son el mismo día, y un día 13 que resolvería
      // la ambigüedad puede estar en la fila cincuenta mil. Rendirse antes declara irresoluble un
      // fichero que se resuelve solo. Dos: el alcance que se le enseña al usuario para que decida
      // sale de estas fechas, y calculado sobre un solo día no distingue nada.
      timeSamples = collectTimeSamples(Number.POSITIVE_INFINITY);
      order = detectFieldOrder(timeSamples);
    }

    if (!order.determined && order.reason === "NO_DATES") {
      // No hay ninguna fecha reconocible en todo el fichero. Fallar aquí con DATE_AMBIGUOUS mandaría
      // al usuario a fijar el orden de unos campos que no existen. Se sigue con un orden
      // provisional, que es demostrablemente inocuo —si ninguna fecha encaja con el patrón, ninguna
      // fila puede aceptarse— y la pasada de parseo acaba en NO_ACCEPTED_ROWS con el desglose real.
      fieldOrder = "day-first";
      fieldOrderEvidence =
        "provisional: ninguna fecha de la fuente encaja con los formatos admitidos";
    } else if (!order.determined) {
      // La ambigüedad no se resuelve por mayoría ni por idioma, pero tampoco se deja al usuario a
      // ciegas: se le enseña qué abarcaría el fichero con cada lectura. «01/09 y 02/09» no se puede
      // contestar de memoria; «dos días seguidos o dos días a 31 días» sí (R-DAT-014).
      const alcances =
        order.reason === "AMBIGUOUS"
          ? order.interpretations
              .map(
                (view) =>
                  `${view.order === "day-first" ? "día/mes" : "mes/día"}: del ${view.from} al ` +
                  `${view.to} (${describeSpan(view.spanDays)})`,
              )
              .join("; ")
          : "";
      throw new ImportFailure(
        "DATE_AMBIGUOUS",
        order.reason === "AMBIGUOUS"
          ? "Ninguna fecha supera el día 12, así que no puede distinguirse día/mes de mes/día. " +
            `Leído ${alcances}.`
          : "Hay fechas que solo encajan como día/mes y otras solo como mes/día: la fuente es incoherente.",
        order.reason === "AMBIGUOUS"
          ? "Elige el orden de los campos de fecha y vuelve a importar."
          : "Corrige la fuente: ninguno de los dos órdenes explica todas sus fechas.",
        header,
        timeSamples.slice(0, 3).map(excerpt),
      );
    } else {
      fieldOrder = order.order;
      fieldOrderEvidence = order.evidence;
    }
  }

  // --- Parseo: una sola pasada ---
  const timeOptions: TimeParseOptions = { zone: options.zone, order: fieldOrder };
  const provenanceBase = { sourceId: options.sourceId, sourceHash: options.sourceId };
  const readings: Reading[] = [];
  const quarantine: QuarantinedRow[] = [];
  const utcSequence: number[] = [];
  let dstFlagged = 0;

  const dataRows = lines.length - 1;
  for (let index = 1; index < lines.length; index += 1) {
    if (index % CHECKPOINT_ROWS === 0) {
      if (callbacks.isCancelled()) throw new ImportCancelled("parsing");
      callbacks.onProgress("parsing", index - 1, dataRows, "Normalizando filas");
    }

    const line = lines[index] as string;
    // La fila 1 es la cabecera, así que la fila física de `lines[i]` es `i + 1`.
    const provenance: Provenance = { ...provenanceBase, sourceRow: index + 1 };
    if (line.trim() === "") continue;

    const fields = splitLine(line, detection.delimiter);
    const reject = (code: RejectionCode): void => {
      quarantine.push({ provenance, code, rawExcerpt: excerpt(line) });
    };

    if (fields.length !== header.length) {
      reject("FIELD_COUNT");
      continue;
    }

    const rawTime = (fields[columns.time] ?? "").trim();
    // Los identificadores se recortan pero **no** se normalizan: `0040` conserva su cero.
    const agvId = (fields[columns.agv] ?? "").trim();
    const tagId = (fields[columns.tag] ?? "").trim();

    if (rawTime === "" || agvId === "") {
      reject("EMPTY_FIELD");
      continue;
    }
    if (tagId === "") {
      // Instante y AGV pero sin tag: no es una lectura defectuosa, es otra cosa. Se conserva con su
      // procedencia y se cuenta aparte, sin decidir qué es.
      reject("NO_TAG");
      continue;
    }

    const parsed = parseTimestamp(rawTime, timeOptions);
    if (!parsed.ok) {
      reject(parsed.error === "UNPARSEABLE" ? "DATE_UNPARSEABLE" : "DATE_INVALID");
      continue;
    }
    if (parsed.time.flag !== "ok") dstFlagged += 1;

    readings.push({ time: parsed.time, agvId, tagId, provenance });
    utcSequence.push(parsed.time.utcMs);
  }

  if (callbacks.isCancelled()) throw new ImportCancelled("parsing");

  const defectiveRows = quarantine.filter((row) => isDefect(row.code)).length;
  const rowsWithoutTag = quarantine.length - defectiveRows;

  // Cero filas aceptadas es una respuesta legítima, pero nunca sin explicar por qué (WP-005).
  if (readings.length === 0) {
    const reasons = new Map<RejectionCode, number>();
    for (const row of quarantine) reasons.set(row.code, (reasons.get(row.code) ?? 0) + 1);
    const breakdown = [...reasons.entries()]
      .map(([code, count]) => `${code}: ${count}`)
      .join(", ");
    throw new ImportFailure(
      "NO_ACCEPTED_ROWS",
      rowsWithoutTag === dataRows
        ? `Se leyeron ${dataRows} filas y ninguna trae tag: traen instante y AGV, así que esta ` +
          `fuente no contiene lecturas de tag (${breakdown}).`
        : `Se leyeron ${dataRows} filas y ninguna superó la validación (${breakdown}).`,
      "Revisa la asignación de columnas y el formato de fecha en la vista previa.",
      header,
      quarantine.slice(0, 3).map((row) => row.rawExcerpt),
    );
  }

  // --- Sentido y orden ---
  callbacks.onProgress("ordering", 0, 1, "Midiendo el sentido de la fuente");
  const monotonicity = measureMonotonicity(utcSequence);
  sortReadings(readings, monotonicity.direction);
  // Después de ordenar, no antes: dos lecturas «consecutivas» de un vehículo solo lo son una vez
  // la secuencia está en orden cronológico (R-DAT-013).
  const sameInstant = measureSameInstant(readings);

  const warnings: string[] = [];
  if (detection.confidence < CLEAN_DELIMITER_CONSISTENCY) {
    warnings.push(
      `El separador «${detection.delimiter}» solo produce ${detection.fieldCount} campos en el ` +
        `${(detection.confidence * 100).toFixed(0)} % de la muestra. Se ha aceptado porque ningún ` +
        `otro lo explica mejor; las filas discordantes están en cuarentena con su motivo.`,
    );
  }
  if (monotonicity.inversions > 0) {
    warnings.push(
      `${monotonicity.inversions} pares contradicen el sentido ${monotonicity.direction} de la ` +
        `fuente. Es compatible con una entrega diferida y las filas se conservan señaladas.`,
    );
  }
  if (dstFlagged > 0) {
    warnings.push(
      `${dstFlagged} lecturas caen en una hora repetida o inexistente del cambio estacional y no ` +
        `deben usarse para afirmar orden dentro de esa ventana.`,
    );
  }
  if (rowsWithoutTag > 0) {
    warnings.push(
      `${rowsWithoutTag} filas traen instante y AGV pero no traen tag, así que no son lecturas. ` +
        `Se conservan con su procedencia y no cuentan como filas defectuosas. Si la fuente mezcla ` +
        `eventos de vehículo con lecturas, esos eventos necesitan su propio contrato.`,
    );
  }
  if (defectiveRows > 0) {
    warnings.push(`${defectiveRows} filas quedaron en cuarentena y se conservan con su motivo.`);
  }
  // Se avisa **ahora**, no en el informe. La fuente es una ventana deslizante: lo que cae por
  // debajo se pierde, así que una exportación con la resolución degradada puede no poder rehacerse
  // pasados unos días. Si el aviso llega al analizar, ya es tarde; si llega al importar, puede que
  // todavía se esté a tiempo de volver a extraerla bien (R-DAT-015).
  if (
    sameInstant.vehiclePairs > 0 &&
    sameInstant.pairs / sameInstant.vehiclePairs >= DEGRADED_RESOLUTION
  ) {
    const share = ((sameInstant.pairs / sameInstant.vehiclePairs) * 100).toFixed(0);
    warnings.push(
      `En el ${share} % de los pasos de un vehículo al siguiente, las dos lecturas comparten ` +
        `instante: el reloj de la fuente no los ordena y su orden sale de la posición en el ` +
        `fichero. La secuencia de esta fuente es en esa medida inferida, no observada. Si la ` +
        `fuente admite exportar con una resolución más fina, conviene rehacerla mientras sus ` +
        `datos sigan disponibles.`,
    );
  }

  callbacks.onProgress("done", dataRows, dataRows, "Importación terminada");

  return {
    summary: {
      sourceId: options.sourceId,
      sourceHash: options.sourceId,
      fileName: options.fileName,
      byteSize: options.byteSize,
      delimiter: detection.delimiter,
      delimiterConfidence: detection.confidence,
      fieldOrder,
      fieldOrderEvidence,
      zone: options.zone,
      encoding: options.encoding ?? "desconocida",
      header,
      monotonicity,
      direction: monotonicity.direction,
      sameInstantPairs: sameInstant.pairs,
      vehiclePairs: sameInstant.vehiclePairs,
      totalRows: dataRows,
      acceptedRows: readings.length,
      quarantinedRows: defectiveRows,
      rowsWithoutTag,
      dstFlagged,
      // Las lecturas ya están ordenadas, así que los extremos son los dos bordes de lo observado.
      observedFrom: (readings[0] as Reading).time.utcMs,
      observedTo: (readings[readings.length - 1] as Reading).time.utcMs,
      elapsedMs: Date.now() - startedAt,
    },
    readings,
    quarantine,
    warnings,
  };
}
