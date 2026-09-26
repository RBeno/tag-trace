/**
 * Casos de oro de F1a·0.
 *
 * TC-019 delimitadores e identidad, TC-020 en su parte cancelable, INV-002 ceros iniciales, y la
 * corrección de ADR-0013 que este proyecto descubrió contrastando la especificación contra datos
 * reales: el desempate dentro de un mismo instante depende del sentido de la fuente.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildTransitions } from "../../src/domain/graph.js";
import { decodeSource } from "../../src/ingestion/decode.js";
import { detectDelimiter } from "../../src/ingestion/delimiter.js";
import { measureMonotonicity } from "../../src/ingestion/monotonicity.js";
import { measureSameInstant } from "../../src/ingestion/same-instant.js";
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

function reading(utcMs: number, sourceRow: number, tagId: string, agvId = "0007"): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
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
    expect(report.tiedPairs).toBe(0);
  });

  it("cuenta las inversiones como evidencia de entrega diferida, sin rechazar", () => {
    const report = measureMonotonicity([500, 400, 900, 300, 200]);
    expect(report.direction).toBe("newest-first");
    expect(report.inversions).toBe(1);
    expect(report.confidence).toBeLessThan(1);
    expect(report.tiedPairs).toBe(0);
  });

  it("los instantes iguales no aportan evidencia de sentido", () => {
    expect(measureMonotonicity([100, 100, 100]).direction).toBe("unknown");
  });
});

describe("instantes empatados · R-DAT-013", () => {
  // Que no ordenen no los convierte en ruido descartable: son el régimen en el que la secuencia
  // se apoya en la posición en el fichero, y eso hay que poder decirlo con una cifra.
  it("los cuenta en lugar de tirarlos, sin confundirlos con inversiones", () => {
    const report = measureMonotonicity([500, 500, 400, 400, 300]);
    expect(report.direction).toBe("newest-first");
    expect(report.inversions).toBe(0);
    expect(report.tiedPairs).toBe(2);
    // La coherencia se mide solo sobre los pares que sí ordenan: un empate no la degrada.
    expect(report.comparedPairs).toBe(2);
    expect(report.confidence).toBe(1);
  });

  it("una fuente que solo empata no tiene sentido, pero sí recuento", () => {
    const report = measureMonotonicity([100, 100, 100]);
    expect(report.direction).toBe("unknown");
    expect(report.comparedPairs).toBe(0);
    expect(report.tiedPairs).toBe(2);
  });

  // La distinción que separa una cifra útil de una convincente y equivocada. Sobre una exportación
  // real, contar el fichero entero da un 39 % y contar por vehículo un 3 %: las dos son ciertas y
  // solo la segunda habla de la topología.
  it("dos vehículos distintos a la vez no comprometen ningún orden", () => {
    const report = measureSameInstant([
      reading(1000, 1, "a", "2001"),
      reading(1000, 2, "b", "2002"),
      reading(1000, 3, "c", "2003"),
    ]);
    expect(report.pairs).toBe(0);
    expect(report.vehiclePairs).toBe(0);
  });

  it("dos lecturas del mismo vehículo a la vez sí, y se cuentan sobre sus propios pares", () => {
    const report = measureSameInstant([
      reading(1000, 1, "a", "2001"),
      reading(1000, 2, "b", "2001"),
      reading(2000, 3, "c", "2001"),
      reading(1000, 4, "d", "2002"),
      reading(3000, 5, "e", "2002"),
    ]);
    // 2001: a→b empatados, b→c no. 2002: d→e no. Tres pares de vehículo, uno empatado.
    expect(report.pairs).toBe(1);
    expect(report.vehiclePairs).toBe(3);
  });
});

describe("resolución degradada · R-DAT-015", () => {
  // El aviso tiene que salir al IMPORTAR. La fuente es una ventana deslizante de pocos días: si el
  // problema se descubre al analizar, la exportación buena ya no se puede pedir.
  function csv(lines: readonly string[]): string {
    return ["Fecha;AGV;Tag", ...lines].join("\n");
  }

  it("avisa cuando el reloj de la fuente no ordena los pasos de un vehículo", () => {
    // Resolución de minuto con varias lecturas por minuto: el caso de una exportación real.
    const rows = [
      "24/01/2026 10:00;0007;A",
      "24/01/2026 10:00;0007;B",
      "24/01/2026 10:00;0007;C",
      "24/01/2026 10:01;0007;D",
    ];
    const { warnings, summary } = importReadings(
      csv(rows),
      { sourceId: "s", fileName: "s.csv", byteSize: 200, zone: ZONE },
      silent,
    );
    expect(summary.sameInstantPairs).toBe(2);
    expect(summary.vehiclePairs).toBe(3);
    const aviso = warnings.find((line) => line.includes("comparten"));
    expect(aviso).toBeDefined();
    // El aviso sirve de poco si no dice qué hacer mientras aún se puede.
    expect(aviso).toContain("rehacerla");
  });

  it("una fuente con resolución suficiente no arrastra el aviso", () => {
    const rows = [
      "24/01/2026 10:00:01;0007;A",
      "24/01/2026 10:00:09;0007;B",
      "24/01/2026 10:00:18;0007;C",
    ];
    const { warnings, summary } = importReadings(
      csv(rows),
      { sourceId: "s", fileName: "s.csv", byteSize: 200, zone: ZONE },
      silent,
    );
    expect(summary.sameInstantPairs).toBe(0);
    expect(warnings.some((line) => line.includes("comparten"))).toBe(false);
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

  // Una exportación de dos días al principio de un mes es legítima y no tiene ninguna fecha que
  // supere el doce. Quedarse en «no se puede decidir» la deja fuera para siempre; lo que se puede
  // hacer es enseñar qué abarca cada lectura, que convierte la pregunta en contestable.
  it("una fuente ambigua entrega el alcance de las dos lecturas para que el usuario decida", () => {
    const detection = detectFieldOrder(["01/09/2026 0:00", "02/09/2026 16:19"]);
    expect(detection).toMatchObject({ determined: false, reason: "AMBIGUOUS" });
    if (detection.determined || detection.reason !== "AMBIGUOUS") throw new Error("esperaba AMBIGUOUS");
    expect(detection.interpretations).toEqual([
      { order: "day-first", from: "01/09/2026", to: "02/09/2026", spanDays: 1 },
      { order: "month-first", from: "09/01/2026", to: "09/02/2026", spanDays: 31 },
    ]);
  });

  it("el alcance descarta la fecha imposible en lugar de desplazarla a otro mes", () => {
    // `00/05` pasa el patrón y ningún campo supera doce, así que llega aquí. Un cero no es un día
    // ni un mes: contarlo daría diciembre del año anterior y un alcance inventado.
    const detection = detectFieldOrder(["00/05/2026 1:00", "04/05/2026 2:00", "06/05/2026 3:00"]);
    if (detection.determined || detection.reason !== "AMBIGUOUS") throw new Error("esperaba AMBIGUOUS");
    for (const view of detection.interpretations) {
      expect(view.from.endsWith("/2026")).toBe(true);
      expect(view.from.startsWith("00/")).toBe(false);
      expect(view.to.startsWith("00/")).toBe(false);
    }
    // Solo cuentan 04/05 y 06/05: día/mes son el 4 y el 6 de mayo (2 días); mes/día, el 5 de abril
    // y el 5 de junio (61). La del cero no aparece en ninguna de las dos.
    expect(detection.interpretations.map((view) => view.spanDays)).toEqual([2, 61]);
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

  it("la ventana observada son los dos bordes de lo aceptado, no lo que diga el fichero", () => {
    const text =
      "Fecha;AGV;Tag\n24/01/2026 5:05;0007;58024\n24/01/2026 5:03;0007;58022\nno-es-fecha;0007;1\n";
    const result = importReadings(
      text,
      { sourceId: "x", fileName: "x", byteSize: text.length, zone: ZONE },
      silent,
    );
    const { observedFrom, observedTo } = result.summary;
    expect(observedTo - observedFrom).toBe(120_000);
    // La fila rechazada no estira la ventana, y los extremos coinciden con las lecturas ordenadas.
    expect(observedFrom).toBe(result.readings[0]?.time.utcMs);
    expect(observedTo).toBe(result.readings[result.readings.length - 1]?.time.utcMs);
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

describe("hora repetida de octubre · ADR-0013", () => {
  it("los pares con una lectura marcada no cuentan como inversión y se cuentan aparte", () => {
    // 900 está en hora repetida: su instante calculado no es medida del reloj y no puede acusar a
    // la fuente de retroceder.
    const report = measureMonotonicity([500, 400, 900, 300], ["ok", "ok", "dst_ambiguous", "ok"]);
    expect(report.direction).toBe("newest-first");
    expect(report.inversions).toBe(0);
    expect(report.unreliablePairs).toBe(2);
    expect(report.comparedPairs).toBe(1);
  });

  it("una pila íntegra que cruza la hora repetida no tiene inversiones y sus aristas se afirman por posición (OQ-137)", () => {
    // 25/10/2026: 02:00–02:59 ocurre dos veces. Todas las filas van en orden de pila.
    //
    // Hasta el 2026-09-26 estas lecturas no afirmaban orden: las dos ocurrencias colapsaban sobre
    // la primera, los pares que las tocaban se contaban como `unreliablePairs` (5) y solo se
    // afirmaban las aristas con los dos extremos fuera de la hora repetida (Z>A y F>G). Por decisión
    // del propietario (OQ-137) la posición en la pila asigna cada fila a su ocurrencia: el retroceso
    // de 02:40 a 02:10 separa la primera (B, C) de la segunda (D, E), y con instante propio todas
    // ordenan.
    const text = [
      "Fecha;AGV;Tag",
      "25/10/2026 04:00:00;0040;G",
      "25/10/2026 03:10:00;0040;F",
      "25/10/2026 02:40:00;0040;E",
      "25/10/2026 02:10:00;0040;D",
      "25/10/2026 02:40:00;0040;C",
      "25/10/2026 02:10:00;0040;B",
      "25/10/2026 01:40:00;0040;A",
      "25/10/2026 00:30:00;0040;Z",
    ].join("\n");
    const result = importReadings(text, { sourceId: "dst", fileName: "dst.csv", byteSize: text.length, zone: ZONE }, silent);

    expect(result.summary.dstFlagged).toBe(4);
    expect(result.summary.dstResolvedByPosition).toBe(4);
    expect(result.summary.dstAmbiguous).toBe(0);
    expect(result.summary.monotonicity.direction).toBe("newest-first");
    // Antes de la revisión salía una inversión: la segunda ocurrencia colapsaba sobre la primera y
    // el fichero parecía retroceder, con aviso de «entrega diferida» sobre una fuente íntegra. Con
    // los instantes resueltos la pila compara entera y sigue íntegra.
    expect(result.summary.monotonicity.inversions).toBe(0);
    expect(result.summary.monotonicity.unreliablePairs).toBe(0);

    const { transitions, discardedUnreliableTime } = buildTransitions(result.readings, result.summary.direction, []);
    // Las siete transiciones, incluidas las que cruzan y las que están dentro de la hora repetida.
    expect(transitions.map((t) => `${t.from}>${t.to}`)).toEqual(["Z>A", "A>B", "B>C", "C>D", "D>E", "E>F", "F>G"]);
    expect(discardedUnreliableTime).toBe(0);
  });
});

describe("comillas, BOM y líneas en blanco", () => {
  it("las comillas envolventes no forman parte del identificador y la comilla doblada se deshace", () => {
    const text = [
      '﻿"Fecha";"AGV";"Tag"',
      '"13/09/2026 10:00";"0040";"T01"',
      '13/09/2026 10:01;0040;"di""jo"',
      '13/09/2026 10:02;0040;T"03',
    ].join("\n");
    const result = importReadings(text, { sourceId: "q", fileName: "q.csv", byteSize: text.length, zone: ZONE }, silent);

    expect(result.summary.header).toEqual(["Fecha", "AGV", "Tag"]);
    expect(result.readings.map((entry) => entry.agvId)).toEqual(["0040", "0040", "0040"]);
    // `"T01"` es el tag `T01`, no otro; `""` es una comilla; una comilla suelta se conserva.
    expect(result.readings.map((entry) => entry.tagId)).toEqual(["T01", 'di"jo', 'T"03']);
  });

  it("las líneas en blanco se cuentan aparte y totalRows es la suma exacta de las cubetas", () => {
    const text = ["Fecha;AGV;Tag", "13/09/2026 10:00;0040;T01", "", "13/09/2026 10:01;0040;", "   ", "13/09/2026 10:02;0040;T02"].join("\n");
    const result = importReadings(text, { sourceId: "b", fileName: "b.csv", byteSize: text.length, zone: ZONE }, silent);

    expect(result.blankRows).toBe(2);
    expect(result.summary.totalRows).toBe(3);
    expect(result.summary.totalRows).toBe(
      result.summary.acceptedRows + result.summary.quarantinedRows + result.summary.rowsWithoutTag,
    );
    // La procedencia sigue siendo la fila física, con las líneas vacías contadas.
    expect(result.readings[1]?.provenance.sourceRow).toBe(6);
  });
});

describe("hora repetida · desambiguación por posición (OQ-137)", () => {
  /** 25/10/2026 02:MM en la primera ocurrencia (CEST, UTC+2) y en la segunda (CET, UTC+1). */
  const primera = (minute: number): number => Date.UTC(2026, 9, 25, 0, minute);
  const segunda = (minute: number): number => Date.UTC(2026, 9, 25, 1, minute);

  const CABECERA = "Fecha;AGV;Tag";
  /**
   * Un fichero íntegro que cruza el cambio, en orden cronológico, con dos vehículos entrelazados. La
   * hora es la de recepción en el servidor, así que la pila ordena a los dos a la vez: el retroceso
   * de 02:50 (vehículo 0007) a 02:05 (vehículo 0042) es global, no de un vehículo.
   */
  const CRONOLOGICO = [
    "25/10/2026 01:40:00;0007;A",
    "25/10/2026 01:50:00;0042;K",
    "25/10/2026 02:10:00;0007;B",
    "25/10/2026 02:20:00;0042;L",
    "25/10/2026 02:50:00;0007;C",
    "25/10/2026 02:05:00;0042;M",
    "25/10/2026 02:30:00;0007;D",
    "25/10/2026 02:45:00;0042;N",
    "25/10/2026 03:10:00;0007;E",
    "25/10/2026 03:20:00;0042;O",
  ];

  function importar(filas: readonly string[]) {
    const text = [CABECERA, ...filas].join("\n");
    return importReadings(text, { sourceId: "dst", fileName: "dst.csv", byteSize: text.length, zone: ZONE }, silent);
  }

  function porTag(result: ReturnType<typeof importar>): Map<string, Reading> {
    return new Map(result.readings.map((entry) => [entry.tagId, entry]));
  }

  it("una pila íntegra con las dos ocurrencias resuelve todas por posición, sin inversiones y con las aristas correctas", () => {
    const result = importar([...CRONOLOGICO].reverse());

    expect(result.summary.direction).toBe("newest-first");
    expect(result.summary.dstFlagged).toBe(6);
    expect(result.summary.dstResolvedByPosition).toBe(6);
    expect(result.summary.dstAmbiguous).toBe(0);
    // Con los instantes resueltos la pila vuelve a compararse entera y sigue íntegra.
    expect(result.summary.monotonicity.inversions).toBe(0);
    expect(result.summary.monotonicity.unreliablePairs).toBe(0);

    const tag = porTag(result);
    // Antes del retroceso, primera ocurrencia: el instante que ya tenían. Después, una hora más.
    expect(tag.get("B")?.time).toMatchObject({ utcMs: primera(10), flag: "dst_by_position" });
    expect(tag.get("L")?.time).toMatchObject({ utcMs: primera(20), flag: "dst_by_position" });
    expect(tag.get("C")?.time).toMatchObject({ utcMs: primera(50), flag: "dst_by_position" });
    expect(tag.get("M")?.time).toMatchObject({ utcMs: segunda(5), flag: "dst_by_position" });
    expect(tag.get("D")?.time).toMatchObject({ utcMs: segunda(30), flag: "dst_by_position" });
    expect(tag.get("N")?.time).toMatchObject({ utcMs: segunda(45), flag: "dst_by_position" });
    // La cadena original y las horas normales no cambian.
    expect(tag.get("M")?.time.raw).toBe("25/10/2026 02:05:00");
    expect(tag.get("E")?.time.flag).toBe("ok");

    const { transitions, discardedUnreliableTime } = buildTransitions(result.readings, result.summary.direction, []);
    expect(transitions.map((t) => `${t.from}>${t.to}`).sort()).toEqual(
      ["A>B", "B>C", "C>D", "D>E", "K>L", "L>M", "M>N", "N>O"].sort(),
    );
    expect(discardedUnreliableTime).toBe(0);
    expect(result.warnings.some((w) => w.includes("por la posición en el fichero"))).toBe(true);
  });

  it("un fichero oldest-first íntegro se resuelve igual: el criterio depende del sentido medido, no del orden físico", () => {
    const result = importar(CRONOLOGICO);

    expect(result.summary.direction).toBe("oldest-first");
    expect(result.summary.dstResolvedByPosition).toBe(6);
    expect(result.summary.dstAmbiguous).toBe(0);
    expect(result.summary.monotonicity.inversions).toBe(0);

    const tag = porTag(result);
    expect(tag.get("C")?.time.utcMs).toBe(primera(50));
    expect(tag.get("M")?.time.utcMs).toBe(segunda(5));

    const { transitions } = buildTransitions(result.readings, result.summary.direction, []);
    expect(transitions.map((t) => `${t.from}>${t.to}`).sort()).toEqual(
      ["A>B", "B>C", "C>D", "D>E", "K>L", "L>M", "M>N", "N>O"].sort(),
    );
  });

  it("una racha sin retroceso seguida de 03:xx es la segunda ocurrencia", () => {
    // La exportación empieza dentro del cambio: no hay primera ocurrencia en el fichero. Entre estas
    // filas y las de 03:xx no cabe otra hora entera, así que son la segunda (UTC = local − 1 h).
    const result = importar([
      "25/10/2026 03:30:00;0007;G",
      "25/10/2026 03:05:00;0042;F",
      "25/10/2026 02:45:00;0007;E",
      "25/10/2026 02:20:00;0042;D",
    ]);

    expect(result.summary.direction).toBe("newest-first");
    expect(result.summary.dstResolvedByPosition).toBe(2);
    expect(result.summary.dstAmbiguous).toBe(0);
    const tag = porTag(result);
    expect(tag.get("D")?.time).toMatchObject({ utcMs: segunda(20), flag: "dst_by_position" });
    expect(tag.get("E")?.time).toMatchObject({ utcMs: segunda(45), flag: "dst_by_position" });
  });

  it("una racha precedida por 01:xx y sin 03:xx detrás sigue ambigua: parece la primera, pero no se afirma", () => {
    // La exportación pudo cortarse en medio de la segunda ocurrencia con la primera vacía. Elegir
    // la hipótesis más probable es lo que ADR-0013 prohíbe.
    const result = importar([
      "25/10/2026 02:45:00;0007;C",
      "25/10/2026 02:20:00;0042;B",
      "25/10/2026 01:40:00;0007;A",
      "25/10/2026 01:10:00;0042;Z",
    ]);

    expect(result.summary.direction).toBe("newest-first");
    expect(result.summary.dstFlagged).toBe(2);
    expect(result.summary.dstResolvedByPosition).toBe(0);
    expect(result.summary.dstAmbiguous).toBe(2);
    const tag = porTag(result);
    expect(tag.get("B")?.time).toMatchObject({ utcMs: primera(20), flag: "dst_ambiguous" });
    expect(tag.get("C")?.time).toMatchObject({ utcMs: primera(45), flag: "dst_ambiguous" });
    expect(result.summary.monotonicity.unreliablePairs).toBe(2);
    expect(result.warnings.some((w) => w.includes("sin que el fichero permita resolverla"))).toBe(true);
  });

  it("un fichero solo con la hora repetida no tiene sentido medible y no resuelve nada", () => {
    // Todas las filas son ambiguas: la monotonía no compara ningún par y el sentido queda `unknown`.
    // Sin sentido, la posición no significa nada.
    const result = importar(["25/10/2026 02:45:00;0007;C", "25/10/2026 02:20:00;0007;B"]);

    expect(result.summary.direction).toBe("unknown");
    expect(result.summary.dstResolvedByPosition).toBe(0);
    expect(result.summary.dstAmbiguous).toBe(2);
    expect(result.readings.every((entry) => entry.time.flag === "dst_ambiguous")).toBe(true);
  });

  it("la hora inexistente de marzo no cambia: la posición no crea un instante que no existe", () => {
    const result = importar([
      "29/03/2026 03:20:00;0007;C",
      "29/03/2026 02:30:00;0007;B",
      "29/03/2026 01:40:00;0007;A",
    ]);

    expect(result.summary.dstFlagged).toBe(1);
    expect(result.summary.dstResolvedByPosition).toBe(0);
    expect(result.summary.dstAmbiguous).toBe(0);
    expect(porTag(result).get("B")?.time.flag).toBe("dst_nonexistent");
    expect(result.summary.monotonicity.unreliablePairs).toBe(2);
  });

  it("varios retrocesos dentro de la racha son desorden, no un cambio de hora, y no se afirma nada", () => {
    const result = importar([
      "25/10/2026 03:10:00;0007;F",
      "25/10/2026 02:40:00;0007;E",
      "25/10/2026 02:10:00;0007;D",
      "25/10/2026 02:50:00;0007;C",
      "25/10/2026 02:20:00;0007;B",
      "25/10/2026 02:35:00;0007;A",
      "25/10/2026 01:40:00;0007;Z",
    ]);

    expect(result.summary.dstResolvedByPosition).toBe(0);
    expect(result.summary.dstAmbiguous).toBe(5);
  });
});
