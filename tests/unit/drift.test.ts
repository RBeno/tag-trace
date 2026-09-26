/**
 * Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013, R-DAT-017).
 *
 * Lo que importa comprobar: sin dos periodos separados lo bastante, no se evalúa nada; un tag
 * declarado y nunca leído solo se consolida como tal si se sabe que existe (`knownTags`); la deriva
 * de un vehículo nunca repite un tag que ya murió para toda la flota; un tag que desaparece y otro
 * que ocupa su mismo hueco se emparejan solo cuando la correlación es unívoca en los dos sentidos; y
 * la adopción de un tag nuevo no señala a un vehículo hasta que casi toda la flota ya lo detecta.
 */

import { describe, expect, it } from "vitest";

import { compareDistantPeriods, type DriftThresholds } from "../../src/domain/drift.js";
import type { Reading } from "../../src/domain/reading.js";

const THRESHOLDS: DriftThresholds = { minGapMs: 1000, minReadingsPerVehicle: 3, minAdoptionShare: 0.8 };

let row = 0;
function reading(utcMs: number, agvId: string, tagId: string): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: "Europe/Madrid", flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

/** Una pasada de un vehículo por una secuencia de tags, un tag cada `stepMs` a partir de `baseUtcMs`. */
function chain(agvId: string, tagIds: readonly string[], baseUtcMs: number, stepMs = 10): Reading[] {
  return tagIds.map((tagId, index) => reading(baseUtcMs + index * stepMs, agvId, tagId));
}

describe("evaluación de la comparación", () => {
  it("con un solo periodo cubierto, no se evalúa", () => {
    const result = compareDistantPeriods([], [{ from: 0, to: 1000 }], new Set(), THRESHOLDS);
    expect(result.evaluated).toBe(false);
    expect(result.reason).toContain("un periodo");
  });

  it("con un hueco menor que minGapMs, no se evalúa", () => {
    const coverage = [
      { from: 0, to: 1000 },
      { from: 1500, to: 2000 }, // hueco de 500 ms, por debajo de minGapMs = 1000
    ];
    const result = compareDistantPeriods([], coverage, new Set(), THRESHOLDS);
    expect(result.evaluated).toBe(false);
    expect(result.reason).toContain("pequeño");
  });

  it("con el hueco suficiente, se evalúa y expone los dos periodos", () => {
    const coverage = [
      { from: 0, to: 1000 },
      { from: 5000, to: 6000 },
    ];
    const result = compareDistantPeriods([], coverage, new Set(), THRESHOLDS);
    expect(result.evaluated).toBe(true);
    expect(result.earlyPeriod).toEqual({ from: 0, to: 1000 });
    expect(result.latePeriod).toEqual({ from: 5000, to: 6000 });
  });
});

describe("deriva de tags", () => {
  const coverage = [
    { from: 0, to: 1000 },
    { from: 5000, to: 6000 },
  ];

  it("leído en el periodo temprano y no en el tardío sale desaparecido", () => {
    const readings = [reading(100, "A1", "T1"), reading(200, "A2", "T1"), reading(300, "A1", "T1")];
    const result = compareDistantPeriods(readings, coverage, new Set(["T1"]), THRESHOLDS);
    const entry = result.tagDrifts.find((d) => d.tagId === "T1");
    expect(entry?.kind).toBe("desaparecido");
    expect(entry?.kind === "desaparecido" && entry.readingsBefore).toBe(3);
  });

  it("sin lecturas en el temprano y con lecturas en el tardío sale nuevo", () => {
    const readings = [reading(5100, "A1", "T2"), reading(5200, "A2", "T2")];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    const entry = result.tagDrifts.find((d) => d.tagId === "T2");
    expect(entry?.kind).toBe("nuevo");
    expect(entry?.kind === "nuevo" && entry.readingsAfter).toBe(2);
  });

  it("declarado y sin ninguna lectura en los dos periodos sale obsoleto-consolidado", () => {
    const result = compareDistantPeriods([], coverage, new Set(["T3"]), THRESHOLDS);
    const entry = result.tagDrifts.find((d) => d.tagId === "T3");
    expect(entry?.kind).toBe("obsoleto-consolidado");
  });

  it("sin declarar y sin ninguna lectura en los dos periodos, no aparece: no hay cómo saber que existe", () => {
    const result = compareDistantPeriods([], coverage, new Set(), THRESHOLDS);
    expect(result.tagDrifts.find((d) => d.tagId === "T4")).toBeUndefined();
  });

  it("leído en los dos periodos no produce ningún hallazgo", () => {
    const readings = [reading(100, "A1", "T5"), reading(5100, "A1", "T5")];
    const result = compareDistantPeriods(readings, coverage, new Set(["T5"]), THRESHOLDS);
    expect(result.tagDrifts.find((d) => d.tagId === "T5")).toBeUndefined();
  });
});

describe("sustitución candidata (R-DAT-017)", () => {
  const coverage = [
    { from: 0, to: 2000 },
    { from: 5000, to: 7000 },
  ];

  it("un tag que desaparece y otro que ocupa su mismo hueco se emparejan", () => {
    const readings = [
      ...chain("A1", ["N1", "D", "N2"], 100),
      ...chain("A2", ["N1", "D", "N2"], 200),
      ...chain("A1", ["N1", "D", "N2"], 300),
      ...chain("A2", ["N1", "D", "N2"], 400),
      ...chain("A1", ["N1", "NEW", "N2"], 5100),
      ...chain("A2", ["N1", "NEW", "N2"], 5200),
      ...chain("A1", ["N1", "NEW", "N2"], 5300),
      ...chain("A2", ["N1", "NEW", "N2"], 5400),
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(["D"]), THRESHOLDS);
    const entry = result.tagDrifts.find((d) => d.tagId === "D");
    expect(entry?.kind).toBe("sustitucion-candidata");
    if (entry?.kind === "sustitucion-candidata") {
      expect(entry.nuevoTagId).toBe("NEW");
      expect(entry.readingsBefore).toBe(4);
      expect(entry.readingsAfter).toBe(4);
      // Coinciden los dos vecinos (N1 y N2): se reporta el sucesor por desempate determinista.
      expect(entry.neighborSide).toBe("sucesor");
      expect(entry.sharedNeighbor).toBe("N2");
    }
    // NEW no debe aparecer también como "nuevo" suelto: ya está absorbido en la pareja.
    expect(result.tagDrifts.some((d) => d.tagId === "NEW")).toBe(false);
  });

  it("dos desaparecidos que comparten vecino con el mismo nuevo no se emparejan (R-EVI-004)", () => {
    const readings = [
      ...chain("A1", ["P", "D1"], 100),
      ...chain("A2", ["P", "D1"], 200),
      ...chain("A3", ["P", "D1"], 300),
      ...chain("B1", ["P", "D2"], 400),
      ...chain("B2", ["P", "D2"], 500),
      ...chain("B3", ["P", "D2"], 600),
      ...chain("C1", ["P", "NEW"], 5100),
      ...chain("C2", ["P", "NEW"], 5200),
      ...chain("C3", ["P", "NEW"], 5300),
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(["D1", "D2"]), THRESHOLDS);
    expect(result.tagDrifts.find((d) => d.tagId === "D1")?.kind).toBe("desaparecido");
    expect(result.tagDrifts.find((d) => d.tagId === "D2")?.kind).toBe("desaparecido");
    expect(result.tagDrifts.find((d) => d.tagId === "NEW")?.kind).toBe("nuevo");
  });

  it("una cadena de tres sustituciones empareja los extremos por el vecino estable y deja el tramo central sin emparejar", () => {
    const readings = [
      ...chain("A1", ["X", "D3", "D2", "D1", "Y"], 100),
      ...chain("A2", ["X", "D3", "D2", "D1", "Y"], 200),
      ...chain("A3", ["X", "D3", "D2", "D1", "Y"], 300),
      ...chain("B1", ["X", "N3", "N2", "N1", "Y"], 5100),
      ...chain("B2", ["X", "N3", "N2", "N1", "Y"], 5200),
      ...chain("B3", ["X", "N3", "N2", "N1", "Y"], 5300),
    ];
    const knownTags = new Set(["D1", "D2", "D3"]);
    const result = compareDistantPeriods(readings, coverage, knownTags, THRESHOLDS);

    const d1 = result.tagDrifts.find((d) => d.tagId === "D1");
    expect(d1?.kind).toBe("sustitucion-candidata");
    if (d1?.kind === "sustitucion-candidata") {
      expect(d1.nuevoTagId).toBe("N1");
      expect(d1.neighborSide).toBe("sucesor");
      expect(d1.sharedNeighbor).toBe("Y");
    }

    const d3 = result.tagDrifts.find((d) => d.tagId === "D3");
    expect(d3?.kind).toBe("sustitucion-candidata");
    if (d3?.kind === "sustitucion-candidata") {
      expect(d3.nuevoTagId).toBe("N3");
      expect(d3.neighborSide).toBe("predecesor");
      expect(d3.sharedNeighbor).toBe("X");
    }

    // El tramo central no comparte ningún vecino con un mismo tag literal en el otro lado: se queda
    // como dos hallazgos sueltos, no como una pareja forzada.
    expect(result.tagDrifts.find((d) => d.tagId === "D2")?.kind).toBe("desaparecido");
    expect(result.tagDrifts.find((d) => d.tagId === "N2")?.kind).toBe("nuevo");
  });

  it("bajo el umbral de lecturas mínimas, no se intenta emparejar aunque compartan vecino", () => {
    const readings = [
      ...chain("A1", ["P", "D", "Q"], 100),
      ...chain("A2", ["P", "D", "Q"], 200),
      ...chain("A1", ["P", "NEW", "Q"], 5100),
      ...chain("A2", ["P", "NEW", "Q"], 5200),
    ];
    // Solo 2 lecturas de cada uno: por debajo de minReadingsPerVehicle = 3.
    const result = compareDistantPeriods(readings, coverage, new Set(["D"]), THRESHOLDS);
    expect(result.tagDrifts.find((d) => d.tagId === "D")?.kind).toBe("desaparecido");
    expect(result.tagDrifts.find((d) => d.tagId === "NEW")?.kind).toBe("nuevo");
  });
});

describe("deriva de vehículos", () => {
  const coverage = [
    { from: 0, to: 1000 },
    { from: 5000, to: 6000 },
  ];

  /** Tres lecturas por vehículo y periodo: alcanza `minReadingsPerVehicle` sin sobrar. */
  function witness(agvId: string, tagIds: readonly string[], baseUtcMs: number): Reading[] {
    const out: Reading[] = [];
    let t = baseUtcMs;
    for (let i = 0; i < 3; i += 1) {
      for (const tagId of tagIds) out.push(reading((t += 1), agvId, tagId));
    }
    return out;
  }

  it("un vehículo que deja de leer un tag que el resto sigue leyendo sale con esa deriva", () => {
    const readings = [
      ...witness("A1", ["TF", "TG"], 100),
      ...witness("A2", ["TF", "TG"], 100),
      ...witness("A1", ["TF"], 5100), // A1 deja TG en el periodo tardío
      ...witness("A2", ["TF", "TG"], 5100), // A2 lo sigue leyendo: TG sigue vivo para la flota
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    const a1 = result.vehicleDrifts.find((entry) => entry.agvId === "A1");
    expect(a1?.droppedTags).toEqual(["TG"]);
    expect(a1?.notAdoptedTags).toEqual([]);
    // A2 no dejó de leer nada.
    expect(result.vehicleDrifts.find((entry) => entry.agvId === "A2")).toBeUndefined();
  });

  it("un tag que muere para toda la flota sale como desaparecido y no se repite por vehículo", () => {
    const readings = [...witness("A1", ["TH"], 100), ...witness("A2", ["TH"], 100)];
    // Nadie lee TH en el periodo tardío: muere circuito-wide.
    const result = compareDistantPeriods(readings, coverage, new Set(["TH"]), THRESHOLDS);
    expect(result.tagDrifts.find((entry) => entry.tagId === "TH")?.kind).toBe("desaparecido");
    for (const entry of result.vehicleDrifts) {
      expect(entry.droppedTags).not.toContain("TH");
    }
  });

  it("un vehículo sin lecturas suficientes en algún periodo no se evalúa para deriva", () => {
    const readings = [
      ...witness("A1", ["TI"], 100),
      reading(5100, "A1", "TI"), // una sola lectura en el periodo tardío: no alcanza el mínimo (3)
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    expect(result.vehicleDrifts.find((entry) => entry.agvId === "A1")).toBeUndefined();
  });
});

describe("adopción de tag nuevo (R-AGV-013 ampliada)", () => {
  const coverage = [
    { from: 0, to: 1000 },
    { from: 5000, to: 6000 },
  ];

  /** Un testigo tardío: tres lecturas de `COMMON`, y de `NEWTAG` si `adopta` es verdadero. */
  function lateWitness(agvId: string, adopta: boolean, baseUtcMs: number): Reading[] {
    const out = [
      reading(baseUtcMs, agvId, "COMMON"),
      reading(baseUtcMs + 10, agvId, "COMMON"),
      reading(baseUtcMs + 20, agvId, "COMMON"),
    ];
    if (adopta) out.push(reading(baseUtcMs + 30, agvId, "NEWTAG"));
    return out;
  }

  it("un tag nuevo adoptado por el 80 % de los testigos tardíos señala a quien no lo lee", () => {
    const readings = [
      ...lateWitness("V1", true, 5100),
      ...lateWitness("V2", true, 5200),
      ...lateWitness("V3", true, 5300),
      ...lateWitness("V4", true, 5400),
      ...lateWitness("V5", false, 5500), // el único que no adopta
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    expect(result.tagDrifts.find((d) => d.tagId === "NEWTAG")?.kind).toBe("nuevo");
    const v5 = result.vehicleDrifts.find((entry) => entry.agvId === "V5");
    expect(v5?.notAdoptedTags).toEqual(["NEWTAG"]);
    expect(v5?.droppedTags).toEqual([]);
    for (const agvId of ["V1", "V2", "V3", "V4"]) {
      expect(result.vehicleDrifts.find((entry) => entry.agvId === agvId)).toBeUndefined();
    }
  });

  it("por debajo de la cuota de adopción, no se señala a nadie", () => {
    const readings = [
      ...lateWitness("V1", true, 5100),
      ...lateWitness("V2", false, 5200),
      ...lateWitness("V3", false, 5300),
      ...lateWitness("V4", false, 5400),
      ...lateWitness("V5", false, 5500),
    ];
    // Solo 1 de 5 (20 %) lo lee: muy por debajo de minAdoptionShare = 0,8.
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    for (const entry of result.vehicleDrifts) {
      expect(entry.notAdoptedTags).not.toContain("NEWTAG");
    }
  });

  it("un vehículo con las dos derivas a la vez aparece una sola vez, con las dos listas pobladas", () => {
    const readings = [
      // COMMON, leído en los dos periodos por alguien: no es él mismo un tag nuevo, solo el
      // testigo que hace que NEWTAG llegue al 80 % de adopción entre los cinco testigos tardíos.
      reading(50, "Z", "COMMON"),
      // TF: toda la flota lo lee en los dos periodos, salvo A1 en el tardío (droppedTags).
      reading(100, "A1", "TF"),
      reading(110, "A1", "TF"),
      reading(120, "A1", "TF"),
      reading(200, "A2", "TF"),
      reading(210, "A2", "TF"),
      reading(220, "A2", "TF"),
      reading(5200, "A2", "TF"),
      reading(5210, "A2", "TF"),
      reading(5220, "A2", "TF"),
      // NEWTAG: aparece en el periodo tardío. Lo adoptan A2..A5 (80 % de los cinco testigos
      // tardíos) y A1 no lo lee ni una vez (notAdoptedTags).
      reading(5100, "A1", "COMMON"),
      reading(5110, "A1", "COMMON"),
      reading(5120, "A1", "COMMON"),
      reading(5230, "A2", "NEWTAG"),
      reading(5300, "A3", "COMMON"),
      reading(5310, "A3", "COMMON"),
      reading(5320, "A3", "COMMON"),
      reading(5330, "A3", "NEWTAG"),
      reading(5400, "A4", "COMMON"),
      reading(5410, "A4", "COMMON"),
      reading(5420, "A4", "COMMON"),
      reading(5430, "A4", "NEWTAG"),
      reading(5500, "A5", "COMMON"),
      reading(5510, "A5", "COMMON"),
      reading(5520, "A5", "COMMON"),
      reading(5530, "A5", "NEWTAG"),
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    const matches = result.vehicleDrifts.filter((entry) => entry.agvId === "A1");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.droppedTags).toEqual(["TF"]);
    expect(matches[0]?.notAdoptedTags).toEqual(["NEWTAG"]);
  });
});

describe("soporte débil de un desaparecido o un nuevo", () => {
  it("un tag leído una vez antes y nunca después sale desaparecido, con el soporte débil dicho", () => {
    const coverage = [
      { from: 0, to: 1000 },
      { from: 5000, to: 6000 },
    ];
    const readings = [
      ...chain("A1", ["TA", "TB", "TC", "TA", "TB", "TC"], 0),
      reading(200, "A1", "M"),
      ...chain("A1", ["TA", "TB", "TC", "TA", "TB", "TC"], 5000),
      reading(5200, "A1", "N"),
      ...chain("A1", ["NX", "NX", "NX"], 5300),
    ];
    const result = compareDistantPeriods(readings, coverage, new Set(), THRESHOLDS);
    expect(result.tagDrifts).toContainEqual({ kind: "desaparecido", tagId: "M", readingsBefore: 1, weakSupport: true });
    expect(result.tagDrifts).toContainEqual({ kind: "nuevo", tagId: "N", readingsAfter: 1, weakSupport: true });
    expect(result.tagDrifts).toContainEqual({ kind: "nuevo", tagId: "NX", readingsAfter: 3, weakSupport: false });
  });

  it("la firma de vecinos desempata dos lecturas del mismo instante por fichero y fila, no por el orden del array", () => {
    // D desaparece, N aparece en su hueco; N y su sucesor TC caen en el mismo instante. Con las filas al
    // revés en el array la pareja tiene que salir igual.
    const early = [...chain("A1", ["TA", "D", "TC", "TA", "D", "TC", "TA", "D", "TC"], 0)];
    const lateRows = [
      reading(5000, "A1", "TA"),
      reading(5010, "A1", "N"),
      reading(5010, "A1", "TC"),
      reading(5020, "A1", "TA"),
      reading(5030, "A1", "N"),
      reading(5030, "A1", "TC"),
      reading(5040, "A1", "TA"),
      reading(5050, "A1", "N"),
      reading(5050, "A1", "TC"),
    ];
    const coverage = [
      { from: 0, to: 1000 },
      { from: 5000, to: 6000 },
    ];
    const straight = compareDistantPeriods([...early, ...lateRows], coverage, new Set(), THRESHOLDS);
    const reversed = compareDistantPeriods([...early, ...lateRows.reverse()], coverage, new Set(), THRESHOLDS);
    expect(straight.tagDrifts).toEqual(reversed.tagDrifts);
    expect(straight.tagDrifts.find((entry) => entry.tagId === "D")?.kind).toBe("sustitucion-candidata");
  });
});
