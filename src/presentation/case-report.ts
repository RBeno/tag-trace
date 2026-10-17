/**
 * El informe de un expediente de incidencia (ADR-0018 D11, `INCIDENTS_REPORTING.md` §8, FR-026): un solo
 * HTML autocontenido, sin red, que se imprime a PDF desde el navegador (OQ-P03).
 *
 * A diferencia del informe del circuito, que copia la pantalla, este se monta **desde los datos del
 * expediente** (`CaseView`): la revisión vigente, la cronología y las hipótesis calculadas del recorte
 * congelado y la verificación registrada. Así dice lo mismo siempre que se genere desde la misma
 * revisión, y se puede probar sin navegador. Lleva la revisión y su hash: es una instantánea, y el
 * expediente sigue vivo en la aplicación.
 *
 * Los diez apartados de §8, en orden: conclusión; alcance y calidad de datos; cronología;
 * observado frente a esperado; AGV, tags y sistemas implicados; hipótesis; evidencia y trazabilidad;
 * contramedidas; verificación; versiones. Lo que escribió una persona va marcado como suyo; el texto que
 * genera el programa no afirma causas (D6).
 */

import type { CaseView } from "../application/protocol.js";
import { PHASE_TEXT, type ChronologyFact } from "../domain/case-backtrack.js";
import { HYPOTHESIS_STATUS_TEXT } from "../domain/case-hypotheses.js";
import { metricText, verificationText } from "../domain/case-verification.js";
import { CASE_STATE_TEXT } from "../domain/incident-case.js";
import { escapeHtml } from "./report-text.js";

export interface CaseReportOptions {
  readonly formatInstant: (utcMs: number) => string;
  /** El estilo de la aplicación (`appCss`), para que se vea como ella sin pedir nada fuera. */
  readonly css: string;
  readonly appVersion: string;
  readonly now: number;
}

const CASE_REPORT_CSS = `
body { max-width: 1000px; margin: 0 auto; padding: 24px 16px 48px; }
.report-header { border-bottom: 1px solid var(--line, #ccc); padding-bottom: 12px; margin-bottom: 20px; }
.report-header h1 { font-size: 1.4rem; margin: 0 0 4px; }
.report-kicker { margin: 0; color: var(--muted, #666); }
.report-meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 12px 0 0; font-size: 0.9rem; }
.report-meta dt { color: var(--muted, #666); }
.report-meta dd { margin: 0; }
.report-section { margin-top: 24px; padding-top: 8px; border-top: 1px solid var(--line, #ccc); }
.report-section h2 { font-size: 1.15rem; }
.case-report-human { border-left: 3px solid var(--line, #ccc); padding-left: 10px; }
.case-report-table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
.case-report-table th, .case-report-table td { text-align: left; padding: 3px 8px 3px 0; vertical-align: top; border-bottom: 1px solid var(--line, #ddd); }
.report-footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid var(--line, #ccc); font-size: 0.85rem; color: var(--muted, #666); }
@media print { body { padding: 0; } .report-section { break-inside: avoid-page; } }
`;

const h = escapeHtml;

function section(id: string, title: string, body: string): string {
  return `<section class="report-section" id="${id}"><h2>${h(title)}</h2>${body}</section>`;
}

function list(items: readonly string[], empty: string): string {
  return items.length === 0 ? `<p class="muted">${h(empty)}</p>` : `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function human(label: string, text: string): string {
  return `<p class="case-report-human"><strong>${h(label)}</strong> ${h(text)}</p>`;
}

/** `expediente-<id>-AAAA-MM-DD-HHMM.html`, sin nada que un sistema de ficheros rechace. */
export function caseReportFileName(caseId: string, at: Date, extension = "html"): string {
  const slug = caseId
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `expediente-${slug === "" ? "sin-nombre" : slug}-${stamp}.${extension}`;
}

/** El informe del expediente, entero. */
export function buildCaseReportHtml(view: CaseView, options: CaseReportOptions): string {
  const { formatInstant: at } = options;
  const current = view.current;
  const chronology = view.chronology;
  const facts = chronology?.facts ?? [];
  const factLine = (fact: ChronologyFact, index: number): string =>
    `<strong>${h(at(fact.at))}</strong>${fact.relation === null ? "" : ` · ${h(fact.relation)}`}${index === chronology?.firstDeviation ? " · primera desviación" : ""} — ${h(fact.text)}` +
    (fact.upstream !== null && fact.upstream > 0 ? ` <span class="muted">(${fact.upstream} ${fact.upstream === 1 ? "tag" : "tags"} antes del síntoma)</span>` : "");

  // 1. Conclusión: solo lo que escribió una persona; el programa no concluye.
  const confirmed = view.hypotheses.filter((hypothesis) => hypothesis.decision?.state === "confirmada");
  const conclusion = [
    `<p><strong>Estado:</strong> ${h(CASE_STATE_TEXT[current.state])}.</p>`,
    current.conclusion === null ? `<p class="muted">Sin conclusión escrita todavía.</p>` : human("Conclusión de una persona:", current.conclusion),
    current.stateReason !== null && current.stateReason !== current.conclusion ? human("Razón del último estado:", current.stateReason) : "",
    confirmed.length === 0
      ? `<p class="muted">Ninguna hipótesis confirmada por una persona.</p>`
      : confirmed.map((hypothesis) => human("Confirmada por una persona:", `${hypothesis.text} Comprobación: ${hypothesis.decision?.note ?? ""}`)).join(""),
  ].join("");

  // 2. Alcance y calidad de datos.
  const w = current.window;
  const scope = [
    `<p>Síntoma de ${h(at(w.symptomFrom))} a ${h(at(w.symptomTo))}; se mira de ${h(at(view.span.from))} a ${h(at(view.span.to))}.</p>`,
    `<p>${h(view.evidenceText)}</p>`,
    `<p>${h(view.contextText)}</p>`,
    view.integrity.length === 0 ? `<p>La cadena de revisiones está entera.</p>` : `<p><strong>La cadena de revisiones no está entera:</strong> ${h(view.integrity.join("; "))}.</p>`,
    human("Síntoma descrito por una persona:", current.symptom),
  ].join("");

  // 3. Cronología.
  const timeline =
    chronology === null
      ? `<p class="muted">Sin recorte de lecturas no hay cronología: lo que pasó en la ventana es desconocido.</p>`
      : (["antes", "durante", "despues"] as const)
          .map((phase) => {
            const entries = facts.map((fact, index) => ({ fact, index })).filter((entry) => entry.fact.phase === phase);
            return entries.length === 0 ? "" : `<h3>${h(PHASE_TEXT[phase])}</h3><ol>${entries.map((entry) => `<li>${factLine(entry.fact, entry.index)}</li>`).join("")}</ol>`;
          })
          .join("") +
        `<p class="muted">En orden de tiempo. «Precede» solo dice que ocurrió antes del síntoma.</p>` +
        (chronology.limits.length === 0 ? "" : `<p class="muted">No se revisa: ${h(chronology.limits.join(" "))}</p>`);

  // 4. Observado frente a esperado: lo que la cronología compara con lo habitual o lo esperado.
  const compared = facts.map((fact, index) => ({ fact, index })).filter((entry) => entry.fact.kind === "sin-paso" || entry.fact.kind === "desviacion");
  const expected = list(
    compared.map((entry) => factLine(entry.fact, entry.index)),
    "La cronología no compara nada con lo esperado en esta ventana.",
  ) + `<p class="muted">El replay, con dónde debería estar cada AGV en cada momento, se consulta en la aplicación.</p>`;

  // 5. Implicados.
  const agvs = [...new Set([current.agvId, ...facts.map((fact) => fact.agvId)].filter((agv): agv is string => agv !== null))].sort();
  const tags = [...new Set([...current.tagIds, ...facts.flatMap((fact) => fact.tagIds)])].sort();
  const involved = [
    `<p><strong>Del síntoma:</strong> ${h(current.agvId === null ? "sin AGV" : `AGV ${current.agvId}`)}; ${h(current.tagIds.length === 0 ? "sin tags" : `tags ${current.tagIds.join(", ")}`)}.</p>`,
    `<p><strong>En la cronología:</strong> ${h(agvs.length === 0 ? "ningún AGV" : `AGV ${agvs.join(", ")}`)}; ${h(tags.length === 0 ? "ningún tag" : `tags ${tags.join(", ")}`)}.</p>`,
    ...(chronology?.declared ?? []).map((entry) => `<p><strong>Declarado en planta, ${h(entry.tagId)}:</strong> ${h(entry.text)}.</p>`),
    `<p>${h(facts.some((fact) => fact.kind === "corte-wifi") ? "Con cortes del registro de conexiones del terminal en la ventana." : "Sin cortes del registro de conexiones en la ventana, o sin registro.")}</p>`,
  ].join("");

  // 6. Hipótesis, sin porcentajes.
  const hypotheses = list(
    view.hypotheses.map((hypothesis) => {
      const favor = hypothesis.favor.map((index) => facts[index]).filter((fact): fact is ChronologyFact => fact !== undefined);
      return (
        `<p><strong>${h(hypothesis.text)}</strong> — ${h(hypothesis.origin === "persona" ? "de una persona" : HYPOTHESIS_STATUS_TEXT[hypothesis.status])}` +
        `${hypothesis.decision === null ? "" : `; ${h(hypothesis.decision.state === "confirmada" ? "confirmada por una persona" : "descartada por una persona")}`}.</p>` +
        (favor.length === 0 ? "" : `<p>A favor: ${favor.map((fact) => h(`${at(fact.at)}, ${fact.text}`)).join(" · ")}</p>`) +
        (hypothesis.against.length === 0 ? "" : `<p>En contra: ${hypothesis.against.map((entry) => h(entry.text)).join(" · ")}</p>`) +
        `<p class="muted">Lo que la separa de las demás: ${h(hypothesis.check)}</p>` +
        (hypothesis.decision === null ? "" : human(hypothesis.decision.state === "confirmada" ? "Comprobación:" : "Razón:", hypothesis.decision.note))
      );
    }),
    "Sin hipótesis.",
  );

  // 7. Evidencia y trazabilidad.
  const sources = current.evidence.sources.map(
    (source) => `<tr><td>${h(source.fileName)}</td><td>${h(source.sourceHash)}</td><td>${h(source.from === "retenidas" ? "lecturas retenidas" : "original archivado")}</td><td>${source.readings}</td></tr>`,
  );
  const evidence = [
    sources.length === 0
      ? `<p class="muted">Sin ficheros en el recorte.</p>`
      : `<table class="case-report-table"><thead><tr><th>Fichero</th><th>Huella</th><th>De</th><th>Lecturas</th></tr></thead><tbody>${sources.join("")}</tbody></table>`,
    `<p>Cada hecho de la cronología lleva sus filas en el CSV de la cronología; las lecturas del recorte, con fichero, huella y fila, en el CSV de lecturas.</p>`,
    `<h3>Revisiones</h3><ol>${view.history
      .map((entry) => `<li>${h(at(entry.createdAt))}${entry.author === null ? "" : ` · ${h(entry.author)}`} — ${h(entry.change.text)}</li>`)
      .join("")}</ol>`,
    current.notes.length === 0 ? "" : `<h3>Notas</h3>${current.notes.map((note) => human(`${at(note.at)}:`, note.text)).join("")}`,
  ].join("");

  // 8. Contramedidas.
  const measures = list(
    current.countermeasures.map(
      (measure) =>
        `<strong>${h(measure.id)}: ${h(measure.action)}</strong> — ${h(measure.owner)}, prevista ${h(at(measure.plannedAt))}; ` +
        `${h(measure.appliedAt === null ? "sin aplicar" : `aplicada ${at(measure.appliedAt)}`)}. Métrica: ${h(metricText(measure.metric))}.${measure.risk === "" ? "" : ` Riesgo: ${h(measure.risk)}.`}`,
    ),
    "Sin contramedidas.",
  );

  // 9. Verificación.
  const verification =
    current.verification === null
      ? `<p class="muted">Sin verificación registrada.</p>`
      : `<p>Verificación de ${h(current.verification.countermeasureId)}, medida ${h(at(current.verification.recordedAt))}: ${h(verificationText(current.verification.result))}</p>` +
        `<p class="muted">Ficheros contados: ${h(current.verification.result.sources.map((source) => source.fileName).join(", ") || "ninguno")}.</p>`;

  // 10. Versiones.
  const refs = current.references;
  const versions: readonly (readonly [string, string])[] = [
    ["Revisión", `${current.revision} · ${current.hash}`],
    ["Memoria", refs.memory === null ? "sin memoria consolidada" : `v${refs.memory.version} · ${refs.memory.hash}`],
    ["Configuración", refs.configVersion],
    ["Aplicación al guardar", refs.appVersion],
    ["Aplicación al generar", options.appVersion],
    ["Procedimientos", [current.evidence.algorithm, chronology?.algorithm, current.verification?.result.algorithm].filter((entry): entry is string => entry !== undefined && entry !== "").join(", ")],
  ];

  const meta: readonly (readonly [string, string])[] = [
    ["Generado", at(options.now)],
    ["Circuito", current.circuitId],
    ["Estado", CASE_STATE_TEXT[current.state]],
    ["Nace de", view.originText],
    ["Revisión", `${current.revision} (${current.hash.slice(0, 12)}…)`],
  ];
  return [
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>Expediente ${h(current.caseId)} · TAG TRACE</title>`,
    `<style>${options.css}\n${CASE_REPORT_CSS}</style></head><body>`,
    `<header class="report-header"><p class="report-kicker">TAG TRACE · informe del expediente</p><h1>${h(current.caseId)}: ${h(current.title)}</h1>`,
    `<dl class="report-meta">${meta.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join("")}</dl></header>`,
    section("conclusion", "1. Conclusión", conclusion),
    section("alcance", "2. Alcance y calidad de datos", scope),
    section("cronologia", "3. Cronología antes, durante y después", timeline),
    section("esperado", "4. Observado frente a esperado", expected),
    section("implicados", "5. AGV, tags y sistemas implicados", involved),
    section("hipotesis", "6. Hipótesis", hypotheses),
    section("evidencia", "7. Evidencia y trazabilidad", evidence),
    section("contramedidas", "8. Contramedidas", measures),
    section("verificacion", "9. Verificación posterior", verification),
    section("versiones", "10. Versiones", `<dl class="report-meta">${versions.map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join("")}</dl>`),
    `<footer class="report-footer"><p>Generado por TAG TRACE ${h(options.appVersion)} el ${h(at(options.now))} en este dispositivo: ningún dato salió de él. ` +
      `Es una instantánea de la revisión ${current.revision}; el expediente sigue vivo en la aplicación. Lo que dice el programa nombra evidencia y no dice por qué ocurrió; ` +
      `lo marcado como de una persona lo escribió ella.</p></footer>`,
    `</body></html>`,
  ].join("\n");
}

/** El resumen de los expedientes para el informe del circuito: uno por fila, sin su contenido entero. */
export function casesSummaryHtml(cases: readonly CaseView[], formatInstant: (utcMs: number) => string): string {
  if (cases.length === 0) return `<p class="muted">El circuito no tiene expedientes de incidencia en este dispositivo.</p>`;
  const rows = cases.map((view) => {
    const current = view.current;
    const confirmed = view.hypotheses.filter((hypothesis) => hypothesis.decision?.state === "confirmada").length;
    return (
      `<tr><td>${h(current.caseId)}</td><td>${h(current.title)}</td><td>${h(CASE_STATE_TEXT[current.state])}</td>` +
      `<td>${h(formatInstant(current.window.symptomFrom))} a ${h(formatInstant(current.window.symptomTo))}</td>` +
      `<td>${h(current.conclusion ?? "sin conclusión")}</td><td>${confirmed}</td><td>${current.countermeasures.length}</td></tr>`
    );
  });
  return (
    `<table class="case-report-table"><thead><tr><th>Expediente</th><th>Título</th><th>Estado</th><th>Síntoma</th><th>Conclusión de una persona</th>` +
    `<th>Hipótesis confirmadas</th><th>Contramedidas</th></tr></thead><tbody>${rows.join("")}</tbody></table>` +
    `<p class="muted">Cada expediente tiene su propio informe, con su cronología, sus hipótesis y su verificación, desde la sección de expedientes.</p>`
  );
}
