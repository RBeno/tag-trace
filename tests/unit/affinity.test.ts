/**
 * Afinidad de circuito (FR-003, R-DAT-006).
 *
 * Lo que se defiende aquí es un error que no avisa: una exportación de otro circuito se importa sin
 * una sola queja —mismas columnas, mismas fechas— y deja el circuito con dos anillos superpuestos.
 * Nadie lo nota hasta que las conclusiones salen raras, meses después.
 */

import { describe, expect, it } from "vitest";

import { assessAffinity, tagsOf, type AffinityThresholds } from "../../src/domain/affinity.js";
import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";

const THRESHOLDS: AffinityThresholds = PROVISIONAL_CONFIG.affinity;

function tags(...values: readonly string[]): ReadonlySet<string> {
  return new Set(values);
}

describe("afinidad de circuito", () => {
  const CIRCUITO = tags("0100", "0200", "0300", "0400", "0500", "0600");

  it("una segunda exportación del mismo circuito es compatible y se acumula", () => {
    const report = assessAffinity(tags("0100", "0200", "0300", "0400", "0500"), CIRCUITO, THRESHOLDS);

    expect(report.verdict).toBe("compatible");
    expect(report.overlap).toBe(1);
    expect(report.mayAccumulate).toBe(true);
    expect(report.truth).toBe("observed");
  });

  it("una exportación de otro circuito no se acumula, y dice por qué", () => {
    const report = assessAffinity(tags("9100", "9200", "9300", "9400", "9500"), CIRCUITO, THRESHOLDS);

    expect(report.verdict).toBe("foreign-suspected");
    expect(report.mayAccumulate).toBe(false);
    // El veredicto es una inferencia, no un hecho: el solape es la evidencia, no la prueba.
    expect(report.truth).toBe("inferred");
    expect(report.reason).toContain("otro");
  });

  it("un solape intermedio no decide: puede ser ampliación o mezcla, y se acumula diciéndolo", () => {
    const report = assessAffinity(
      tags("0100", "0200", "0300", "9400", "9500", "9600"),
      CIRCUITO,
      THRESHOLDS,
    );

    expect(report.verdict).toBe("partially-compatible");
    expect(report.mayAccumulate).toBe(true);
    expect(report.truth).toBe("inferred");
    expect(report.newTags).toBe(3);
  });

  it("el primer fichero de un circuito vacío se acepta sin haberlo comprobado, y se declara", () => {
    // Es el único caso en que la ausencia de juicio no bloquea: no hay contra qué comparar. Negarlo
    // dejaría el producto sin forma de empezar un circuito.
    const report = assessAffinity(tags("0100", "0200", "0300"), tags(), THRESHOLDS);

    expect(report.verdict).toBe("unknown");
    expect(report.mayAccumulate).toBe(true);
    expect(report.truth).toBe("unknown");
    expect(report.reason).toContain("no porque se haya comprobado");
  });

  it("una fuente demasiado pequeña no se juzga en lugar de juzgarse mal", () => {
    // Tres tags ajenos darían solape cero y parecerían otro circuito. Con tan poca evidencia, un
    // veredicto es una casualidad con formato de conclusión.
    const report = assessAffinity(tags("9100", "9200", "9300"), CIRCUITO, THRESHOLDS);

    expect(report.verdict).toBe("unknown");
    expect(report.mayAccumulate).toBe(true);
    expect(report.reason).toContain("menos de los");
  });

  it("el solape se mide sobre los tags de la fuente, no sobre los del circuito", () => {
    // Una exportación corta trae pocos tags y todos suyos. Dividir entre el catálogo del circuito
    // la haría parecer ajena, que es el falso positivo que bloquearía trabajo legítimo.
    const grande = tags(...Array.from({ length: 200 }, (_, index) => String(index).padStart(4, "0")));
    const corta = tags("0001", "0002", "0003", "0004", "0005", "0006");

    const report = assessAffinity(corta, grande, THRESHOLDS);
    expect(report.verdict).toBe("compatible");
    expect(report.overlap).toBe(1);
  });

  it("`tagsOf` extrae los identificadores distintos conservando el texto", () => {
    const readings = [{ tagId: "0040" }, { tagId: "40" }, { tagId: "0040" }];
    const extracted = tagsOf(readings);

    // `0040` y `40` son identificadores distintos (INV-002, R-DAT-001).
    expect(extracted.size).toBe(2);
    expect(extracted.has("0040")).toBe(true);
  });
});
