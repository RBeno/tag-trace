/**
 * Los textos del Resumen y del informe (`src/presentation/report-text.ts`, UX_SPEC §4.8, FR-026).
 *
 * Lo que se fija: la frase de estado dice primero lo que puede parar la planta y solo lleva tono de
 * alerta con rango 1 pendiente; sin nada pendiente lo dice sin inventar un «todo bien»; el nombre del
 * fichero del informe lleva el circuito saneado y la fecha; el escape de HTML no deja nada abierto.
 */

import { describe, expect, it } from "vitest";

import { escapeHtml, formatHours, reportFileName, statusSentence } from "../../src/presentation/report-text.js";

const base = { totalFindings: 20, reviewed: 5, notices: 2, coverageHours: 47.6, agvInCircuit: 40, agvAssigned: 42 };

describe("la frase de estado", () => {
  it("con rango 1 pendiente es alerta y lo dice primero, con el rango 2 detrás", () => {
    const status = statusSentence({ ...base, pendingRank1: 3, pendingRank2: 7 });
    expect(status.tone).toBe("alerta");
    expect(status.headline).toBe("3 hallazgos pendientes pueden parar la planta o perder una función; 7 más degradan el circuito.");
    expect(status.detail).toBe("cobertura de 48 h · 40 de 42 AGV en el circuito · 2 avisos · 5 de 20 hallazgos revisados.");
  });

  it("sin rango 1 pendiente es atención, y sin nada pendiente es normal sin afirmar que todo va bien", () => {
    expect(statusSentence({ ...base, pendingRank1: 0, pendingRank2: 1 })).toMatchObject({
      tone: "atencion",
      headline: "Nada pendiente que pare la planta; 1 hallazgo degrada el circuito.",
    });
    expect(statusSentence({ ...base, pendingRank1: 0, pendingRank2: 0 }).tone).toBe("normal");
    expect(statusSentence({ ...base, pendingRank1: 0, pendingRank2: 0, totalFindings: 0, reviewed: 0 }).headline).toBe("Ningún hallazgo con lo cargado.");
  });

  it("sin cobertura ni flota lo dice en gris, no con un cero", () => {
    const status = statusSentence({ pendingRank1: 0, pendingRank2: 0, totalFindings: 0, reviewed: 0, notices: 0, coverageHours: null, agvInCircuit: null, agvAssigned: null });
    expect(status.detail).toBe("cobertura sin datos · sin avisos.");
  });

  it("las horas se leen como horas o como días", () => {
    expect(formatHours(3.25)).toBe("3,3 h");
    expect(formatHours(30)).toBe("30 h");
    expect(formatHours(72)).toBe("3 días (72 h)");
  });
});

describe("el fichero del informe", () => {
  it("lleva el circuito saneado y la fecha al minuto", () => {
    expect(reportFileName("SE6/8: TECNA", new Date(2026, 9, 17, 9, 5))).toBe("informe-se6-8-tecna-2026-10-17-0905.html");
    expect(reportFileName("", new Date(2026, 0, 1, 0, 0))).toBe("informe-circuito-2026-01-01-0000.html");
  });

  it("escapa lo que rompería el HTML", () => {
    expect(escapeHtml(`<b class="x">a & 'b'</b>`)).toBe("&lt;b class=&quot;x&quot;&gt;a &amp; &#39;b&#39;&lt;/b&gt;");
  });
});
