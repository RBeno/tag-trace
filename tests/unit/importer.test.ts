/**
 * Casos de oro de F1a·0.
 *
 * TC-019 delimitadores e identidad, TC-020 en su parte cancelable, INV-002 ceros iniciales, y la
 * corrección de ADR-0013 que este proyecto descubrió contrastando la especificación contra datos
 * reales: el desempate dentro de un mismo instante depende del sentido de la fuente.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { decodeSource } from "../../src/ingestion/decode.js";
import { detectDelimiter } from "../../src/ingestion/delimiter.js";
import { measureMonotonicity } from "../../src/ingestion/monotonicity.js";
import { compareReadings, sortReadings } from "../../src/domain/order.js";
import { detectFieldOrder, parseTimestamp } from "../../src/domain/time.js";
import {
  ImportCancelled,
  ImportFailure,
  importReadings,
  type ImportCallbacks,
} from "../../src/ingestion/importer.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
const FIXTURES = new URL("../../fixtures/synthetic/importacion/", import.meta.url);

const silent: ImportCallbacks = { onProgress: () => {}, isCancelled: () => false };

function runFixture(name: string) {
  const text = readFileSync(new URL(name, FIXTURES), "utf8");
  return importReadings(
    text,
    { sourceId: `fixture-${name}`, fileName: name, byteSize: text.length, zone: ZONE },
    silent,
  );
}

function reading(utcMs: number, sourceRow: number, tagId: string): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId: "0007",
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow },
  };
}

describe("TC-019 · delimitadores e identidad", () => {
  const variants = [
    "lecturas-puntoycoma.csv",
    "lecturas-coma.csv",
    "lecturas-tabulador.tsv",
  ] as const;

  it("los tres separadores producen el mismo resultado semántico", () => {
    const results = variants.map(runFixture);
    const semantic = results.map((result) =>
      result.readings.map((entry) => `${entry.time.utcMs}|${entry.agvId}|${entry.tagId}`).join("\n"),
    );
    expect(semantic[1]).toBe(semantic[0]);
    expect(semantic[2]).toBe(semantic[0]);
  });

  it("detecta cada separador con confianza total", () => {
    for (const variant of variants) {
      expect(runFixture(variant).summary.delimiterConfidence).toBe(1);
    }
  });

  it("INV-002 · los ceros iniciales sobreviven al recorrido completo", () => {
    const { readings } = runFixture("lecturas-puntoycoma.csv");
    const ids = readings.map((entry) => entry.agvId);
    expect(ids).toContain("0007");
    expect(ids).toContain("0042");
    expect(ids).not.toContain("7");
    expect(ids).not.toContain("42");
  });

  it("la procedencia apunta a la fila física, con la cabecera como fila 1", () => {
    const { readings } = runFixture("lecturas-puntoycoma.csv");
    const rows = readings.map((entry) => entry.provenance.sourceRow).sort((a, b) => a - b);
    expect(rows).toEqual([2, 3, 4]);
  });
});

describe("orden canónico · la corrección de ADR-0013", () => {
  it("dentro de un mismo instante, el sentido de pila invierte el desempate", () => {
    const stack = [reading(1000, 2, "A"), reading(1000, 3, "B")];
    const ordered = sortReadings([...stack], "newest-first").map((entry) => entry.tagId);
    expect(ordered).toEqual(["B", "A"]);

    const ascending = sortReadings([...stack], "oldest-first").map((entry) => entry.tagId);
    expect(ascending).toEqual(["A", "B"]);
  });

  it("el comparador es total: nunca devuelve cero para filas distintas", () => {
    expect(compareReadings(reading(1000, 2, "A"), reading(1000, 3, "B"), "newest-first")).not.toBe(0);
  });

  it("el instante manda sobre la posición en el fichero", () => {
    const out = sortReadings([reading(2000, 2, "tarde"), reading(1000, 9, "pronto")], "newest-first");
    expect(out.map((entry) => entry.tagId)).toEqual(["pronto", "tarde"]);
  });
});

describe("monotonía · R-DAT-008", () => {
  it("reconoce una pila descendente limpia", () => {
    const report = measureMonotonicity([500, 400, 300, 200]);
    expect(report.direction).toBe("newest-first");
    expect(report.inversions).toBe(0);
    expect(report.confidence).toBe(1);
  });

  it("cuenta las inversiones como evidencia de entrega diferida, sin rechazar", () => {
    const report = measureMonotonicity([500, 400, 900, 300, 200]);
    expect(report.direction).toBe("newest-first");
    expect(report.inversions).toBe(1);
    expect(report.confidence).toBeLessThan(1);
  });

  it("los instantes iguales no aportan evidencia de sentido", () => {
    expect(measureMonotonicity([100, 100, 100]).direction).toBe("unknown");
  });
});

describe("formato de fecha · no se adivina", () => {
  it("un día mayor que doce determina el orden", () => {
    const detection = detectFieldOrder(["24/01/2026 5:03"]);
    expect(detection).toMatchObject({ determined: true, order: "day-first" });
  });

  it("si ninguna fecha supera el día doce, queda ambiguo en lugar de resolverse por mayoría", () => {
    const detection = detectFieldOrder(["05/01/2026 5:03", "06/02/2026 7:10", "07/03/2026 9:00"]);
    expect(detection).toMatchObject({ determined: false, reason: "AMBIGUOUS" });
  });

  it("una fuente incoherente se señala en lugar de elegir un orden", () => {
    const detection = detectFieldOrder(["24/01/2026 5:03", "01/24/2026 5:03"]);
    expect(detection).toMatchObject({ determined: false, reason: "CONTRADICTORY" });
  });

  it("no tener ninguna fecha reconocible no es lo mismo que no poder decidir", () => {
    expect(detectFieldOrder(["no-es-fecha", "tampoco"])).toMatchObject({
      determined: false,
      reason: "NO_DATES",
    });
  });

  it("un fichero ambiguo falla con DATE_AMBIGUOUS y no importa nada", () => {
    const text = "Fecha;AGV;Tag\n05/01/2026 5:03;0007;58022\n06/02/2026 5:04;0007;58023\n";
    expect(() =>
      importReadings(text, { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE }, silent),
    ).toThrowError(expect.objectContaining({ code: "DATE_AMBIGUOUS" }) as Error);
  });
});

describe("cambio horario · ADR-0013", () => {
  it("marca la hora repetida de octubre como ambigua", () => {
    const result = parseTimestamp("25/10/2026 2:30", { zone: ZONE, order: "day-first" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.time.flag).toBe("dst_ambiguous");
  });

  it("marca la hora inexistente de marzo", () => {
    const result = parseTimestamp("29/03/2026 2:30", { zone: ZONE, order: "day-first" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.time.flag).toBe("dst_nonexistent");
  });

  it("una hora normal no se marca", () => {
    const result = parseTimestamp("24/01/2026 5:03", { zone: ZONE, order: "day-first" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.time.flag).toBe("ok");
  });

  it("conserva la cadena original sin normalizar", () => {
    const result = parseTimestamp("24/01/2026 5:03", { zone: ZONE, order: "day-first" });
    if (result.ok) expect(result.time.raw).toBe("24/01/2026 5:03");
  });

  it("las horas de guarda alrededor de las dos transiciones no se marcan", () => {
    const guards = ["25/10/2026 0:30", "25/10/2026 4:30", "29/03/2026 1:30", "29/03/2026 4:30"];
    for (const guard of guards) {
      const result = parseTimestamp(guard, { zone: ZONE, order: "day-first" });
      expect(result.ok).toBe(true);
      if (result.ok) expect({ guard, flag: result.time.flag }).toEqual({ guard, flag: "ok" });
    }
  });

  it("un día que no existe en su mes es fila inválida, no hora inexistente", () => {
    // Antes se comprobaba después de convertir y solo si la marca era `ok`, así que el 31 de abril
    // salía como `dst_nonexistent` y se aceptaba desplazado al 1 de mayo.
    const result = parseTimestamp("31/04/2026 10:00", { zone: ZONE, order: "day-first" });
    expect(result).toEqual({ ok: false, error: "INVALID_FIELDS" });
    expect(parseTimestamp("29/02/2026 10:00", { zone: ZONE, order: "day-first" }).ok).toBe(false);
    expect(parseTimestamp("29/02/2024 10:00", { zone: ZONE, order: "day-first" }).ok).toBe(true);
  });
});

describe("WP-005 · cero filas es una respuesta con causa", () => {
  it("explica el desglose en lugar de devolver una tabla vacía", () => {
    const text = "Fecha;AGV;Tag\nno-es-fecha;0007;58022\ntampoco;0042;20108\n";
    try {
      importReadings(text, { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE }, silent);
      expect.unreachable("debía fallar");
    } catch (error) {
      expect(error).toBeInstanceOf(ImportFailure);
      const failure = error as ImportFailure;
      expect(failure.code).toBe("NO_ACCEPTED_ROWS");
      expect(failure.reason).toContain("DATE_UNPARSEABLE");
      expect(failure.recovery.length).toBeGreaterThan(0);
      expect(failure.sampleRows?.length).toBeGreaterThan(0);
    }
  });

  it("una cabecera irreconocible nombra las columnas que faltan", () => {
    const text = "Columna1;Columna2;Columna3\na;b;c\n";
    try {
      importReadings(text, { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE }, silent);
      expect.unreachable("debía fallar");
    } catch (error) {
      const failure = error as ImportFailure;
      expect(failure.code).toBe("SCHEMA_UNRECOGNISED");
      expect(failure.reason).toContain("fecha/hora");
      expect(failure.detectedSchema).toEqual(["Columna1", "Columna2", "Columna3"]);
    }
  });
});

describe("TC-020 · cancelación cooperativa", () => {
  it("detiene la importación sin producir resultado parcial", () => {
    const rows = Array.from(
      { length: 60_000 },
      (_, index) => `24/01/2026 5:03;0007;${10_000 + index}`,
    );
    const text = `Fecha;AGV;Tag\n${rows.join("\n")}\n`;

    let checks = 0;
    const cancelAfterFirstCheckpoint: ImportCallbacks = {
      onProgress: () => {},
      isCancelled: () => {
        checks += 1;
        return checks > 1;
      },
    };

    try {
      importReadings(
        text,
        { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE },
        cancelAfterFirstCheckpoint,
      );
      expect.unreachable("debía cancelarse");
    } catch (error) {
      expect(error).toBeInstanceOf(ImportCancelled);
      expect((error as ImportCancelled).stage).toBe("parsing");
    }
  });
});

describe("filas no aceptadas · se conservan con su motivo", () => {
  it("una fila con campos de más queda en cuarentena, no se descarta", () => {
    const text = "Fecha;AGV;Tag\n24/01/2026 5:03;0007;58022\n24/01/2026 5:04;0007;58023;sobra\n";
    const result = importReadings(
      text,
      { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE },
      silent,
    );
    expect(result.summary.acceptedRows).toBe(1);
    expect(result.quarantine).toHaveLength(1);
    expect(result.quarantine[0]?.code).toBe("FIELD_COUNT");
    expect(result.quarantine[0]?.provenance.sourceRow).toBe(3);
    // Una fila mal formada baja la consistencia del separador, pero no lo pone en duda: se importa
    // y se advierte, en lugar de rechazar el fichero entero con DELIMITER_AMBIGUOUS.
    expect(result.summary.delimiter).toBe(";");
    expect(result.warnings.some((warning) => warning.includes("separador"))).toBe(true);
  });

  it("una fila con instante y AGV pero sin tag no es un defecto: es otra cosa", () => {
    // Una fuente que mezcla eventos de vehículo con lecturas produce muchas así. Contarlas como
    // defectuosas diría que el 40 % del fichero está roto cuando no lo está.
    const text =
      "Tipo;Fecha;AGV;Tag\nTag;24/01/2026 5:03;0007;58022\nUso;24/01/2026 5:04;0007;\n";
    const result = importReadings(
      text,
      { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE },
      silent,
    );
    expect(result.summary.acceptedRows).toBe(1);
    expect(result.summary.rowsWithoutTag).toBe(1);
    expect(result.summary.quarantinedRows).toBe(0);
    // No se descarta: conserva su procedencia para poder volver a la fila.
    expect(result.quarantine[0]?.code).toBe("NO_TAG");
    expect(result.quarantine[0]?.provenance.sourceRow).toBe(3);
    expect(result.warnings.some((w) => w.includes("no son lecturas"))).toBe(true);
  });

  it("si ninguna fila trae tag, se dice eso y no que la fuente esté mal", () => {
    const text = "Fecha;AGV;Tag\n24/01/2026 5:03;0007;\n24/01/2026 5:04;0042;\n";
    try {
      importReadings(text, { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE }, silent);
      expect.unreachable("debía fallar");
    } catch (error) {
      const failure = error as ImportFailure;
      expect(failure.code).toBe("NO_ACCEPTED_ROWS");
      expect(failure.reason).toContain("no contiene lecturas de tag");
    }
  });

  it("la codificación se transporta y, si nadie la declara, no se supone", () => {
    const text = "Fecha;AGV;Tag\n24/01/2026 5:03;0007;58022\n";
    const sin = importReadings(
      text,
      { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE },
      silent,
    );
    expect(sin.summary.encoding).toBe("desconocida");

    const con = importReadings(
      text,
      { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE, encoding: "windows-1252" },
      silent,
    );
    expect(con.summary.encoding).toBe("windows-1252");
  });

  it("un campo vacío no se rellena con un valor por defecto", () => {
    const text = "Fecha;AGV;Tag\n24/01/2026 5:03;;58022\n";
    try {
      importReadings(text, { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE }, silent);
      expect.unreachable("debía fallar");
    } catch (error) {
      expect((error as ImportFailure).reason).toContain("EMPTY_FIELD");
    }
  });
});

describe("codificación · no se supone UTF-8", () => {
  it("una cabecera en Windows-1252 se lee entera en lugar de corromperse", () => {
    // `MTC nº` en cp1252: el `º` es el byte 0xBA, que no es UTF-8 válido. Antes llegaba como
    // `MTC n�` y la importación seguía adelante sin decir nada.
    const bytes = new Uint8Array([
      0x4d, 0x54, 0x43, 0x20, 0x6e, 0xba, 0x3b, 0x41, 0x47, 0x56, // "MTC nº;AGV"
    ]);
    const result = decodeSource(bytes.buffer);
    expect(result.encoding).toBe("windows-1252");
    expect(result.text).toBe("MTC nº;AGV");
    expect(result.text).not.toContain("�");
  });

  it("un fichero UTF-8 se lee como UTF-8 y se le quita el BOM", () => {
    const bytes = new TextEncoder().encode("﻿Fecha;AGV;Tag");
    const result = decodeSource(bytes.buffer as ArrayBuffer);
    expect(result).toEqual({ text: "Fecha;AGV;Tag", encoding: "utf-8" });
  });
});

describe("delimitador", () => {
  it("prefiere consistencia sobre frecuencia", () => {
    const lines = ["a;b;c", "1;2;3", "4;5;6"];
    expect(detectDelimiter(lines)).toMatchObject({ delimiter: ";", fieldCount: 3, confidence: 1 });
  });

  it("no acepta un separador que produce recuentos irregulares", () => {
    const lines = ["a,b", "1,2,3,4", "x"];
    expect(detectDelimiter(lines).confidence).toBeLessThan(0.9);
  });
});
