/**
 * Exportación local del expediente (ADR-0018 D11, OQ-P03): la cronología y el recorte de lecturas en
 * CSV, como los demás CSV del producto (punto y coma, CRLF, sin celdas que rompan una fila).
 *
 * Una exportación es una **instantánea**: lleva la revisión y su hash para que se sepa de qué estado del
 * expediente sale; el expediente sigue vivo en la aplicación. Nada de aquí sale del dispositivo: lo
 * descarga la persona (ADR-0007).
 */

import type { Chronology } from "./case-backtrack.js";
import type { FrozenEvidence } from "./incident-case.js";

function cell(value: string | number | null): string {
  return value === null ? "" : String(value).replace(/[;\r\n]/g, ",");
}

/** La cronología del retroceso: una fila por hecho, en su orden, con sus filas de evidencia. */
export function chronologyCsv(chronology: Chronology, formatTime: (utcMs: number) => string, stamp: { readonly caseId: string; readonly revision: number; readonly hash: string }): string {
  const lines = [
    `# expediente ${stamp.caseId}, revision ${stamp.revision}, hash ${stamp.hash}, procedimiento ${chronology.algorithm}`,
    "fase;desde;hasta;relacion;tipo;agv;tags;tags_aguas_arriba;primera_desviacion;hecho;filas;filas_registro_conexiones",
  ];
  chronology.facts.forEach((fact, index) => {
    lines.push(
      [
        fact.phase,
        formatTime(fact.at),
        fact.until === null ? null : formatTime(fact.until),
        fact.relation,
        fact.kind,
        fact.agvId,
        fact.tagIds.join(" "),
        fact.upstream,
        index === chronology.firstDeviation ? "sí" : null,
        fact.text,
        fact.provenance.map((row) => `${row.sourceHash.slice(0, 12)}:${row.sourceRow}`).join(" "),
        fact.connectionRows.map((row) => `${row.sourceHash.slice(0, 12)}:${row.sourceRow}`).join(" "),
      ]
        .map(cell)
        .join(";"),
    );
  });
  return lines.join("\r\n");
}

/**
 * Las lecturas del recorte congelado, con su procedencia completa (fichero, huella y fila, R-EVI-001),
 * y los eventos del registro de conexiones de la ventana. La hora va como la trae el fichero y en UTC.
 */
export function evidenceCsv(evidence: FrozenEvidence, stamp: { readonly caseId: string; readonly revision: number; readonly hash: string }): string {
  const lines = [
    `# expediente ${stamp.caseId}, revision ${stamp.revision}, recorte ${stamp.hash}`,
    "tipo;hora_fichero;utc;agv;tag_o_evento;fuente;huella;fila",
  ];
  for (const reading of evidence.readings) {
    lines.push(
      ["lectura", reading.time.raw, new Date(reading.time.utcMs).toISOString(), reading.agvId, reading.tagId, reading.provenance.sourceId, reading.provenance.sourceHash, reading.provenance.sourceRow]
        .map(cell)
        .join(";"),
    );
  }
  for (const event of evidence.connections) {
    lines.push(["conexion", null, new Date(event.utcMs).toISOString(), event.agvId, event.rawKind, null, event.sourceHash, event.sourceRow].map(cell).join(";"));
  }
  return lines.join("\r\n");
}
