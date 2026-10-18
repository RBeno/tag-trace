/**
 * La copia de los expedientes en el `.agvproj` (OQ-174, esquema 6; F6, entrega 7).
 *
 * Lo que se fija:
 * - cada expediente del fichero se clasifica frente al local: nuevo, idéntico, local por delante,
 *   fichero por delante (y entran solo las revisiones que faltan), distinto o roto; nunca se mezclan;
 * - una cadena rota —una revisión tocada o que no enlaza— no entra, y se dice por qué;
 * - la sección viaja de ida y vuelta por el `.agvproj` con sus hashes, y una forma inesperada se rechaza;
 * - el texto para la persona lo cuenta con la concordancia de la cifra.
 */

import { describe, expect, it } from "vitest";

import { caseImportText, planCaseImport } from "../../src/domain/case-transfer.js";
import { addNote, createCase, type CaseRevision, type EvidenceSummary } from "../../src/domain/incident-case.js";
import { incidentsSection, readIncidentsSection, readProject, writeProject, ProjectError } from "../../src/persistence/agvproj.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 9, 8, 0, 0);
const EMPTY: EvidenceSummary = { algorithm: "recorte-2", hash: null, readings: 0, vehicles: 0, sources: [], missing: [], connections: 0, context: null };

async function chain(caseId: string, notes: number): Promise<readonly CaseRevision[]> {
  const out: CaseRevision[] = [
    await createCase({
      circuitId: "SINT",
      caseId,
      now: T0,
      author: null,
      title: "Punto crítico sin llegada",
      symptom: "Diez minutos sin AGV.",
      origin: { kind: "sintoma" },
      agvId: null,
      tagIds: ["00120"],
      window: { symptomFrom: T0, symptomTo: T0 + 10 * MIN, marginBeforeMs: 30 * MIN, marginAfterMs: 30 * MIN },
      evidence: EMPTY,
      references: { memory: null, configVersion: "provisional-0", appVersion: "dev" },
    }),
  ];
  for (let index = 0; index < notes; index += 1) out.push(await addNote(out[out.length - 1] as CaseRevision, `Nota ${index + 1}`, T0 + (index + 1) * MIN, null));
  return out;
}

describe("expedientes de un .agvproj frente a los locales", () => {
  it("nuevo, idéntico, local por delante, fichero por delante y distinto", async () => {
    const a = await chain("INC-SINT-20261009-01", 2);
    const b = await chain("INC-SINT-20261009-02", 3);
    const c = await chain("INC-SINT-20261009-03", 1);
    const d = await chain("INC-SINT-20261009-04", 1);
    const dOther = [d[0] as CaseRevision, await addNote(d[0] as CaseRevision, "Otra nota", T0 + 9 * MIN, null)];
    const e = await chain("INC-SINT-20261009-05", 0);
    const local = [...a, ...b, ...c.slice(0, 1), ...dOther];
    const incoming = [...a, ...b.slice(0, 2), ...c, ...d, ...e];
    const plans = await planCaseImport(local, incoming);
    const relation = Object.fromEntries(plans.map((plan) => [plan.caseId, plan.relation]));
    expect(relation).toEqual({
      "INC-SINT-20261009-01": "identico",
      "INC-SINT-20261009-02": "local-adelantado",
      "INC-SINT-20261009-03": "entrante-adelantado",
      "INC-SINT-20261009-04": "distinto",
      "INC-SINT-20261009-05": "nuevo",
    });
    expect(plans.find((plan) => plan.caseId.endsWith("03"))?.missing.map((revision) => revision.revision)).toEqual([2]);
    expect(plans.filter((plan) => plan.relation === "distinto" || plan.relation === "identico").every((plan) => plan.missing.length === 0)).toBe(true);
    const text = caseImportText(plans, 0);
    expect(text[0]).toContain("1 nuevo, 1 con revisiones nuevas, 2 que ya estaban (2 revisiones añadidas)");
    expect(text.some((line) => line.includes("INC-SINT-20261009-04 no coincide"))).toBe(true);
  });

  it("una cadena rota no entra, y se dice por qué", async () => {
    const a = await chain("INC-SINT-20261009-01", 2);
    const tampered = [a[0] as CaseRevision, { ...(a[1] as CaseRevision), title: "Otro título" }, a[2] as CaseRevision];
    const plans = await planCaseImport([], tampered);
    expect(plans[0]).toMatchObject({ relation: "roto", missing: [] });
    expect(plans[0]?.problems.join("; ")).toContain("la revisión 2 no coincide con su hash");
    const gap = await planCaseImport([], [a[0] as CaseRevision, a[2] as CaseRevision]);
    expect(gap[0]?.relation).toBe("roto");
    expect(caseImportText(plans, 1).join(" ")).toContain("1 recorte no coincide con su huella");
  });

  it("la sección viaja de ida y vuelta, y una forma inesperada se rechaza", async () => {
    const a = await chain("INC-SINT-20261009-01", 1);
    const section = incidentsSection(a, []);
    expect(incidentsSection([], [])).toBeUndefined();
    const project = await readProject(await writeProject("SINT", { circuito: { id: "SINT" }, incidencias: section }, T0));
    expect(project.manifest.schema_version).toBe(6);
    const back = readIncidentsSection(project);
    expect(back?.revisiones.map((revision) => revision.hash)).toEqual(a.map((revision) => revision.hash));
    expect(await planCaseImport([], back?.revisiones ?? [])).toMatchObject([{ relation: "nuevo" }]);
    const broken = await readProject(await writeProject("SINT", { incidencias: { revisiones: [{ caseId: "x" }], recortes: [] } }, T0));
    expect(() => readIncidentsSection(broken)).toThrow(ProjectError);
  });
});
