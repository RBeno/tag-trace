/**
 * Expediente reducido de AGV y de tag (UX_SPEC §4.1).
 *
 * Lo que hay que defender: la comparación es contra la cohorte, nunca la flota entera; sin `minGapMs`
 * no hay inactividad que contar (no hay valor por defecto); y un silencio abierto hasta el final de
 * la cobertura se distingue de uno que ya cerró.
 */

import { describe, expect, it } from "vitest";

import { buildAgvDossier, buildAllAgvDossiers, buildAllTagDossiers, buildTagDossier } from "../../src/domain/dossier.js";
import { readCoLanes } from "../../src/domain/circuit-config.js";
import type { Cohort } from "../../src/domain/cohort.js";
import type { Lap } from "../../src/domain/laps.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
let row = 0;

function reading(utcMs: number, agvId: string, tagId: string): Reading {
  row += 1;
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: row },
  };
}

const COHORTS: readonly Cohort[] = [{ id: 0, vehicles: ["A", "B", "C"] }];
const cohortOf = new Map([
  ["A", 0],
  ["B", 0],
  ["C", 0],
]);
const LOOKUP = { cohorts: COHORTS, cohortOf };

describe("expediente de AGV", () => {
  it("compara el recuento contra la mediana del cohorte, no contra la flota", () => {
    const readings = [
      ...Array.from({ length: 10 }, (_, index) => reading(index * 1000, "A", "0100")),
      ...Array.from({ length: 20 }, (_, index) => reading(index * 1000, "B", "0100")),
      ...Array.from({ length: 30 }, (_, index) => reading(index * 1000, "C", "0100")),
    ];
    const dossier = buildAgvDossier("A", readings, LOOKUP, [], [{ from: 0, to: 100_000 }], 10_000, []);

    expect(dossier.readingCount).toBe(10);
    expect(dossier.cohortMedianReadings).toBe(25); // mediana de B(20) y C(30)
    expect(dossier.cohortSize).toBe(3);
  });

  it("cuenta la inactividad solo por encima del umbral que se le pasa", () => {
    const readings = [
      reading(0, "A", "0100"),
      reading(5_000, "A", "0200"), // hueco de 5 s, por debajo del umbral
      reading(65_000, "A", "0300"), // hueco de 60 s, por encima
    ];
    const dossier = buildAgvDossier("A", readings, LOOKUP, [], [{ from: 0, to: 65_000 }], 30_000, []);

    expect(dossier.inactivity).toHaveLength(1);
    expect(dossier.inactivity[0]?.durationMs).toBe(60_000);
  });

  it("cada silencio conserva sus dos extremos: por dónde se fue y por dónde volvió", () => {
    // `UX_SPEC.md` §4.1 no pide la duración sola: pide cómo se fue y **cómo reapareció**, porque
    // es lo que separa una parada en su sitio de un tramo recorrido sin leer. Sin los dos extremos
    // el expediente muestra un hueco y obliga a ir a buscar el dato a la tabla de lecturas.
    const quieto = [reading(0, "A", "0100"), reading(60_000, "A", "0100")];
    const avanzado = [reading(0, "B", "0100"), reading(60_000, "B", "0400")];

    const mismoTag = buildAgvDossier("A", quieto, LOOKUP, [], [{ from: 0, to: 60_000 }], 30_000, []).inactivity[0];
    expect(mismoTag?.lastTagBefore).toBe("0100");
    expect(mismoTag?.firstTagAfter).toBe("0100");

    const masAdelante = buildAgvDossier("B", avanzado, LOOKUP, [], [{ from: 0, to: 60_000 }], 30_000, []).inactivity[0];
    expect(masAdelante?.lastTagBefore).toBe("0100");
    expect(masAdelante?.firstTagAfter).toBe("0400");
  });

  it("un silencio que llega hasta el final de la cobertura queda abierto, y se distingue del que ya cerró", () => {
    const cerrado = [reading(0, "A", "0100"), reading(65_000, "A", "0200"), reading(66_000, "A", "0300")];
    const abierto = buildAgvDossier("A", cerrado.slice(0, 2), LOOKUP, [], [{ from: 0, to: 200_000 }], 30_000, []);
    const cerradoDossier = buildAgvDossier("A", cerrado, LOOKUP, [], [{ from: 0, to: 66_000 }], 30_000, []);

    expect(abierto.openSilenceSinceUtcMs).toBe(65_000);
    // Con una lectura justo después, el mismo hueco ya no está abierto: el silencio terminó.
    expect(cerradoDossier.openSilenceSinceUtcMs).toBeNull();
  });

  it("un hueco entre dos exportaciones no es inactividad; un silencio dentro de un tramo sí (R-DAT-007)", () => {
    // Dos exportaciones con 40 min sin datos entre medias. El AGV lee hasta el final de la primera y
    // desde el principio de la segunda: lo que hizo en el hueco no se sabe, así que no hay silencio.
    const coverage = [
      { from: 0, to: 600_000 },
      { from: 3_000_000, to: 4_000_000 },
    ];
    const readings = [
      // Primer tramo: lecturas cada menos de 300 s, ningún silencio.
      reading(0, "A", "0100"),
      reading(200_000, "A", "0150"),
      reading(400_000, "A", "0170"),
      reading(590_000, "A", "0200"),
      reading(3_010_000, "A", "0300"),
      // Este sí es un silencio medible: las dos lecturas caen dentro del segundo tramo.
      reading(3_100_000, "A", "0400"),
      reading(3_900_000, "A", "0500"),
    ];
    const dossier = buildAgvDossier("A", readings, LOOKUP, [], coverage, 300_000, []);

    expect(dossier.inactivity).toHaveLength(1);
    expect(dossier.inactivity[0]).toMatchObject({ fromUtcMs: 3_100_000, toUtcMs: 3_900_000, lastTagBefore: "0400" });
    // El silencio abierto se sigue midiendo contra el final del último tramo.
    expect(dossier.openSilenceSinceUtcMs).toBeNull();
    const cortado = buildAgvDossier("A", readings.slice(0, 6), LOOKUP, [], coverage, 300_000, []);
    expect(cortado.openSilenceSinceUtcMs).toBe(3_100_000);
  });

  it("una parada entre la parada precisa y la salida de la misma calle es carga, no silencio (R-CO-006)", () => {
    // Es el falso positivo que más daño hace: media hora cargando es lo normal, y llamarlo
    // inactividad convierte en hallazgo lo que pasa todos los días.
    const { lanes } = readCoLanes([
      { tagId: "7000", order: 1, funcion: "entrada", grupo: "calle-1", capacidad: null },
      { tagId: "7001", order: 2, funcion: "parada-precisa", grupo: "calle-1", capacidad: null },
      { tagId: "7002", order: 3, funcion: "salida", grupo: "calle-1", capacidad: null },
    ]);
    const cargando = [reading(0, "A", "7001"), reading(60_000, "A", "7002")];

    const conCalles = buildAgvDossier("A", cargando, LOOKUP, [], [{ from: 0, to: 60_000 }], 30_000, lanes);
    expect(conCalles.inactivity[0]?.cause).toBe("carga-online");
    expect(conCalles.inactivity[0]?.laneId).toBe("calle-1");
    expect(conCalles.inactivity[0]?.truth).toBe("inferred");

    // **Sin** las calles cargadas la firma no se reconoce y el hueco sigue siendo un silencio: la
    // regla dice literalmente que no se sustituye por proximidad.
    const sinCalles = buildAgvDossier("A", cargando, LOOKUP, [], [{ from: 0, to: 60_000 }], 30_000, []);
    expect(sinCalles.inactivity[0]?.cause).toBe("silencio");
    expect(sinCalles.inactivity[0]?.truth).toBe("observed");
    expect(sinCalles.inactivity[0]?.laneId).toBeUndefined();
  });

  it("en una calle que empieza en su parada, la espera hasta el paso intermedio también es carga", () => {
    // Así termina la espera en un circuito real: parada, un paso intermedio al segundo, y la salida.
    const { lanes } = readCoLanes([
      { tagId: "7100", order: 1, funcion: "parada-precisa", grupo: "calle-1", capacidad: null },
      { tagId: "7101", order: 2, funcion: "", grupo: "calle-1", capacidad: null },
      { tagId: "7102", order: 3, funcion: "salida", grupo: "calle-1", capacidad: null },
    ]);
    const cargando = [reading(0, "A", "7100"), reading(3_600_000, "A", "7101"), reading(3_601_000, "A", "7102")];
    const dossier = buildAgvDossier("A", cargando, LOOKUP, [], [{ from: 0, to: 3_601_000 }], 30_000, lanes);
    expect(dossier.inactivity).toHaveLength(1);
    expect(dossier.inactivity[0]?.cause).toBe("carga-online");
    expect(dossier.inactivity[0]?.laneId).toBe("calle-1");
  });

  it("parar en una calle y salir por otra no es una carga", () => {
    // La firma exige la **misma** calle. Con una clave por tag suelto, esto habría pasado por una
    // carga normal cuando es justo lo contrario: algo que hay que mirar.
    const { lanes } = readCoLanes([
      { tagId: "7000", order: 1, funcion: "entrada", grupo: "calle-1", capacidad: null },
      { tagId: "7001", order: 2, funcion: "parada-precisa", grupo: "calle-1", capacidad: null },
      { tagId: "7002", order: 3, funcion: "salida", grupo: "calle-1", capacidad: null },
      { tagId: "7010", order: 1, funcion: "entrada", grupo: "calle-2", capacidad: null },
      { tagId: "7011", order: 2, funcion: "parada-precisa", grupo: "calle-2", capacidad: null },
      { tagId: "7012", order: 3, funcion: "salida", grupo: "calle-2", capacidad: null },
    ]);
    const cruzado = [reading(0, "A", "7001"), reading(60_000, "A", "7012")];
    const dossier = buildAgvDossier("A", cruzado, LOOKUP, [], [{ from: 0, to: 60_000 }], 30_000, lanes);

    expect(dossier.inactivity[0]?.cause).toBe("silencio");
  });

  it("las vueltas se cuentan por clase y solo las del vehículo consultado", () => {
    const laps: Lap[] = [
      { agvId: "A", completeness: "completa", startUtcMs: 0, endUtcMs: 1, stops: 4, truth: "inferred" },
      { agvId: "A", completeness: "parcial", startUtcMs: 1, endUtcMs: 2, stops: 2, truth: "inferred" },
      { agvId: "B", completeness: "completa", startUtcMs: 0, endUtcMs: 1, stops: 4, truth: "inferred" },
    ];
    const dossier = buildAgvDossier("A", [reading(0, "A", "0100")], LOOKUP, laps, [{ from: 0, to: 100 }], 10, []);

    expect(dossier.laps).toEqual({ completas: 1, parciales: 1, desconocidas: 0 });
  });
});

describe("expediente de tag", () => {
  it("dice desde cuándo cada vehículo dejó de leerlo, y quién nunca lo ha leído", () => {
    const readings = [
      reading(1000, "A", "0500"),
      reading(5000, "A", "0500"),
      reading(2000, "B", "0500"),
    ];
    const dossier = buildTagDossier("0500", readings, ["A", "B", "C"], new Map());

    expect(dossier.totalReadings).toBe(3);
    expect(dossier.readers.find((r) => r.agvId === "A")?.lastReadUtcMs).toBe(5000);
    expect(dossier.readers.find((r) => r.agvId === "B")?.lastReadUtcMs).toBe(2000);
    expect(dossier.readers.find((r) => r.agvId === "C")?.lastReadUtcMs).toBeNull();
    expect(dossier.criticalFunction).toBeNull();
  });

  it("lleva la función crítica declarada (R-GRA-007), sin importar de qué lista venga", () => {
    const readings = [reading(1000, "A", "0500")];
    const funcionOf = new Map([["0500", "vinculacion"]]);
    const dossier = buildTagDossier("0500", readings, ["A"], funcionOf);

    expect(dossier.criticalFunction).toBe("vinculacion");
  });
});

describe("expedientes en lote", () => {
  it("buildAllAgvDossiers da el mismo resultado que llamar uno a uno", () => {
    const readings = [
      ...Array.from({ length: 5 }, (_, index) => reading(index * 1000, "A", "0100")),
      ...Array.from({ length: 8 }, (_, index) => reading(index * 1000, "B", "0100")),
    ];
    const uno = buildAgvDossier("A", readings, LOOKUP, [], [{ from: 0, to: 100_000 }], 10_000, []);
    const lote = buildAllAgvDossiers(readings, LOOKUP, [], [{ from: 0, to: 100_000 }], 10_000, []);

    expect(lote.find((d) => d.agvId === "A")).toEqual(uno);
    expect(lote).toHaveLength(2);
  });

  it("buildAllTagDossiers da el mismo resultado que llamar uno a uno", () => {
    const readings = [reading(1000, "A", "0500"), reading(2000, "B", "0500"), reading(3000, "A", "0600")];
    const funcionOf = new Map([["0600", "cruce"]]);
    const uno = buildTagDossier("0500", readings, ["A", "B"], funcionOf);
    const lote = buildAllTagDossiers(readings, ["A", "B"], funcionOf);

    expect(lote.find((d) => d.tagId === "0500")).toEqual(uno);
    expect(lote.map((d) => d.tagId)).toEqual(["0500", "0600"]);
    expect(lote.find((d) => d.tagId === "0600")?.criticalFunction).toBe("cruce");
  });
});
