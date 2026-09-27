/**
 * Huella de una previsualización de consolidación (F4; `WORKER_PROTOCOL.md` §4, `MEMORY_CONSOLIDATION.md` §6).
 *
 * Lo que la persona confirma con «Confirmar y consolidar» es **lo que vio**. El Worker no guarda la
 * previsualización que envió: al recibir el `commit` la vuelve a calcular desde el almacén, y hasta
 * ahora solo comprobaba que el fichero base tuviera la misma huella. Entre medias pudo cambiar una
 * marca de revisión, llegar otra versión desde un `.agvproj` o variar un recorte, y lo escrito ya no
 * sería lo confirmado.
 *
 * La huella resume el contenido que la persona pudo leer en pantalla y que acaba en la versión:
 * fichero base, versión anterior (por su hash, no por su instantánea), número, delta, bloqueos,
 * avisos, decisiones, cambios clasificados, incidencias y recortes. Queda fuera lo que no es contenido:
 * el tamaño estimado y las notas sobre si se puede recortar. El hash es el semántico (INV-010): mismo
 * contenido, misma huella, en el hilo principal y en el Worker.
 */

import type { ConsolidationPreview } from "./memory.js";
import { semanticHash } from "./semantic-hash.js";

/** Lo que entra en la huella: la previsualización sin sus campos informativos y con la anterior reducida a su identidad. */
export function fingerprintSubject(preview: ConsolidationPreview): Record<string, unknown> {
  return {
    basedOn: preview.basedOn,
    previous: preview.previous === null ? null : { version: preview.previous.version, hash: preview.previous.hash },
    nextVersion: preview.nextVersion,
    delta: preview.delta,
    blockers: preview.blockers,
    warnings: preview.warnings,
    decisions: preview.decisions,
    changes: preview.changes ?? null,
    incidents: preview.incidents ?? null,
    cuts: preview.cuts === undefined || preview.cuts.length === 0 ? null : preview.cuts,
  };
}

/** La huella hexadecimal de la previsualización: la que viaja con `consolidation-preview` y vuelve en el `commit`. */
export async function previewFingerprint(preview: ConsolidationPreview): Promise<string> {
  return semanticHash(fingerprintSubject(preview));
}
