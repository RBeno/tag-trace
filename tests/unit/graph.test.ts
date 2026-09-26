/**
 * Grafo observado (F2·0).
 *
 * Las tres pruebas que importan aquí no comprueban que el grafo se construya —eso es contar—, sino
 * que **no se construya de más**: que un hueco de cobertura no invente una arista, que un par del
 * mismo instante no afirme un orden que el reloj no da, y que un tiempo que la resolución no mide
 * salga `unknown` en lugar de mediana de ceros.
 */

import { describe, expect, it } from "vitest";

import {
  buildObservedGraph,
  buildTransitions,
  dominantSuccessor,
  type GraphThresholds,
} from "../../src/domain/graph.js";
import type { Interval } from "../../src/domain/coverage.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";
const SECOND = 1000;

/** Umbrales explícitos: la función no tiene valores por defecto, y esa es la intención. */
const THRESHOLDS: GraphThresholds = {
  minShareForObserved: 0.9,
  minSupportForObserved: 3,
  maxSameInstantShare: 0.5,
  resolutionMs: 0,
};

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

/** Un vehículo recorre `tags` con `stepMs` entre lecturas, `count` veces. */
function laps(
  agvId: string,
  tags: readonly string[],
  count: number,
  start: number,
  stepMs = 10 * SECOND,
): Reading[] {
  const out: Reading[] = [];
  let t = start;
  for (let lap = 0; lap < count; lap += 1) {
    for (const tag of tags) {
      out.push(reading((t += stepMs), agvId, tag));
    }
  }
  return out;
}

/** Cobertura que abarca todo lo que se le pase. */
function spanning(readings: readonly Reading[]): Interval[] {
  const times = readings.map((entry) => entry.time.utcMs);
  return [{ from: Math.min(...times), to: Math.max(...times) }];
}

function edgeBetween(
  graph: ReturnType<typeof buildObservedGraph>,
  from: string,
  to: string,
): ReturnType<typeof buildObservedGraph>["edges"][number] | undefined {
  return graph.edges.find((edge) => edge.from === from && edge.to === to);
}

describe("grafo observado", () => {
  const ANILLO = ["0100", "0200", "0300", "0400"];

  it("reconstruye las aristas de un anillo recorrido por varios vehículos", () => {
    const readings = [
      ...laps("A", ANILLO, 5, 0),
      ...laps("B", ANILLO, 5, 1_000_000),
    ];
    const graph = buildObservedGraph(readings, "oldest-first", spanning(readings), THRESHOLDS);

    const edge = edgeBetween(graph, "0100", "0200");
    expect(edge?.support).toBe(10);
    expect(edge?.vehicles).toBe(2);
    expect(edge?.share).toBe(1);
    expect(edge?.truth).toBe("observed");
    expect(edge?.orderEvidence).toBe("reloj");
    expect(graph.discardedAcrossGaps).toBe(0);
  });

  it("no empareja a través de un hueco de cobertura, y lo dice", () => {
    // Dos ventanas separadas: la última lectura de una y la primera de la otra son consecutivas en
    // la lista y no en la realidad. Emparejarlas inventaría una arista 0400→0100 con un tramo de
    // once días, que es exactamente el falso hallazgo que R-DAT-007 existe para impedir.
    const primera = laps("A", ANILLO, 3, 0);
    const segunda = laps("A", ANILLO, 3, 1_000_000_000);
    const readings = [...primera, ...segunda];
    const coverage: Interval[] = [...spanning(primera), ...spanning(segunda)];

    const graph = buildObservedGraph(readings, "oldest-first", coverage, THRESHOLDS);

    expect(graph.discardedAcrossGaps).toBe(1);
    // El anillo cierra 0400→0100 dentro de cada ventana: cinco veces, no seis.
    expect(edgeBetween(graph, "0400", "0100")?.support).toBe(4);
    // Y ninguna arista arrastra un tiempo de tramo absurdo.
    const worst = Math.max(...graph.edges.map((edge) => edge.time.p90Ms ?? 0));
    expect(worst).toBeLessThan(60 * SECOND);
  });

  it("una arista sostenida en pares del mismo instante no puede ser observed", () => {
    // Los dos tags se leen siempre a la vez: son un punto, no dos (R-DAT-013). El orden que
    // aparece es posición de pila, y afirmar la secuencia sería afirmar el fichero, no el reloj.
    const readings: Reading[] = [];
    let t = 0;
    for (let lap = 0; lap < 8; lap += 1) {
      readings.push(reading((t += 10 * SECOND), "A", "0100"));
      readings.push(reading(t, "A", "0101"));
      readings.push(reading((t += 10 * SECOND), "A", "0200"));
    }
    const graph = buildObservedGraph(readings, "oldest-first", spanning(readings), THRESHOLDS);

    const edge = edgeBetween(graph, "0100", "0101");
    expect(edge?.support).toBe(8);
    expect(edge?.sameInstant).toBe(8);
    expect(edge?.orderEvidence).toBe("mismo-instante");
    // Cuota 1,0 y soporte 8: cumple los dos umbrales y aun así no es `observed`.
    expect(edge?.share).toBe(1);
    expect(edge?.truth).toBe("inferred");
    expect(graph.sameInstantTransitions).toBe(8);
  });

  it("con la resolución de la fuente por encima del paso real, el tiempo es unknown", () => {
    // Resolución de minuto y un anillo que se recorre en segundos: la secuencia se observa, el
    // tiempo no se mide. Publicar una mediana aquí sería inventar precisión (ROADMAP F2).
    const readings = laps("A", ANILLO, 5, 0, 30 * SECOND);
    const graph = buildObservedGraph(readings, "oldest-first", spanning(readings), {
      ...THRESHOLDS,
      resolutionMs: 60 * SECOND,
    });

    const edge = edgeBetween(graph, "0100", "0200");
    expect(edge?.truth).toBe("observed");
    expect(edge?.time.truth).toBe("unknown");
    expect(edge?.time.measurable).toBe(0);
    expect(edge?.time.medianMs).toBeNull();
  });

  it("mide el tiempo del tramo cuando el intervalo supera la resolución", () => {
    const readings = laps("A", ANILLO, 6, 0, 30 * SECOND);
    const graph = buildObservedGraph(readings, "oldest-first", spanning(readings), THRESHOLDS);

    const edge = edgeBetween(graph, "0100", "0200");
    expect(edge?.time.truth).toBe("observed");
    expect(edge?.time.measurable).toBe(6);
    expect(edge?.time.medianMs).toBe(30 * SECOND);
  });

  it("una bifurcación reparte la cuota y ninguna de las dos ramas se afirma sola", () => {
    // 0200 sale la mitad de las veces por cada rama. Con cuota 0,5 ninguna llega al umbral, así
    // que las dos son `inferred`: la línea se abre de verdad y el grafo no elige por el usuario.
    const readings: Reading[] = [];
    let t = 0;
    for (let lap = 0; lap < 10; lap += 1) {
      readings.push(reading((t += 10 * SECOND), "A", "0100"));
      readings.push(reading((t += 10 * SECOND), "A", "0200"));
      readings.push(reading((t += 10 * SECOND), "A", lap % 2 === 0 ? "0300" : "0350"));
      readings.push(reading((t += 10 * SECOND), "A", "0400"));
    }
    const graph = buildObservedGraph(readings, "oldest-first", spanning(readings), THRESHOLDS);

    expect(edgeBetween(graph, "0200", "0300")?.share).toBe(0.5);
    expect(edgeBetween(graph, "0200", "0350")?.share).toBe(0.5);
    expect(edgeBetween(graph, "0200", "0300")?.truth).toBe("inferred");
    expect(edgeBetween(graph, "0200", "0350")?.truth).toBe("inferred");
    // Y la que no se bifurca sí se afirma.
    expect(edgeBetween(graph, "0100", "0200")?.truth).toBe("observed");
  });

  it("el sentido de la fuente decide la dirección, y equivocarlo invierte el grafo", () => {
    // La misma pila leída con el sentido correcto y con el contrario. Es el hallazgo que obligó a
    // corregir ADR-0013: con el sentido equivocado el grafo sale plausible y del revés.
    const readings = laps("A", ANILLO, 5, 0, 0);
    const coverage = spanning(readings);

    const correcto = buildObservedGraph(readings, "oldest-first", coverage, THRESHOLDS);
    const invertido = buildObservedGraph(readings, "newest-first", coverage, THRESHOLDS);

    expect(edgeBetween(correcto, "0100", "0200")).toBeDefined();
    expect(edgeBetween(correcto, "0200", "0100")).toBeUndefined();
    expect(edgeBetween(invertido, "0200", "0100")).toBeDefined();
    expect(edgeBetween(invertido, "0100", "0200")).toBeUndefined();
  });

  it("el sucesor dominante devuelve la arista entera, con su cuota y su estado", () => {
    const readings = [...laps("A", ANILLO, 5, 0), ...laps("B", ANILLO, 5, 1_000_000)];
    const graph = buildObservedGraph(readings, "oldest-first", spanning(readings), THRESHOLDS);

    const next = dominantSuccessor(graph, "0100");
    expect(next?.to).toBe("0200");
    expect(next?.truth).toBe("observed");
    expect(dominantSuccessor(graph, "9999")).toBeNull();
  });

  it("los nodos cuentan lecturas, vehículos y grados", () => {
    const readings = [...laps("A", ANILLO, 5, 0), ...laps("B", ANILLO, 5, 1_000_000)];
    const graph = buildObservedGraph(readings, "oldest-first", spanning(readings), THRESHOLDS);

    const node = graph.nodes.find((candidate) => candidate.tagId === "0100");
    expect(node?.readings).toBe(10);
    expect(node?.vehicles).toBe(2);
    expect(node?.outgoing).toBe(1);
    expect(node?.incoming).toBe(1);
    expect(graph.nodes).toHaveLength(4);
  });

  it("no inventa transiciones entre vehículos distintos", () => {
    // Si el corte por vehículo fallara, A y B producirían aristas cruzadas. Es la comprobación que
    // impide reconstruir un circuito a partir del solapamiento temporal de dos AGV.
    const readings: Reading[] = [];
    let t = 0;
    for (let lap = 0; lap < 5; lap += 1) {
      readings.push(reading((t += 10 * SECOND), "A", "0100"));
      readings.push(reading((t += 1 * SECOND), "B", "0900"));
      readings.push(reading((t += 10 * SECOND), "A", "0200"));
      readings.push(reading((t += 1 * SECOND), "B", "0901"));
    }
    const { transitions } = buildTransitions(readings, "oldest-first", spanning(readings));

    expect(transitions.every((transition) => transition.from !== "0900" || transition.to === "0901"))
      .toBe(true);
    expect(edgeBetween(
      buildObservedGraph(readings, "oldest-first", spanning(readings), THRESHOLDS),
      "0100",
      "0900",
    )).toBeUndefined();
  });
});

describe("lo que el grafo no afirma · hora repetida y cola cortada", () => {
  const ANILLO = ["0100", "0200", "0300", "0400"];

  it("una lectura en hora repetida no forma transición con sus vecinas, y se cuenta aparte (ADR-0013)", () => {
    // En la hora repetida de octubre las dos ocurrencias reciben el mismo instante calculado, así que
    // el orden entre ellas no lo da el reloj. Emparejarlas fabricaba aristas hacia atrás.
    const vuelta = laps("A", ANILLO, 1, 0);
    const marcada = vuelta[2] as Reading;
    const readings = [
      ...vuelta.slice(0, 2),
      { ...marcada, time: { ...marcada.time, flag: "dst_ambiguous" as const } },
      ...vuelta.slice(3),
    ];

    const { transitions, discardedUnreliableTime } = buildTransitions(readings, "oldest-first", []);

    // 0100→0200 sí; 0200→0300 y 0300→0400 tocan la lectura marcada y no se afirman.
    expect(transitions.map((t) => `${t.from}>${t.to}`)).toEqual(["0100>0200"]);
    expect(discardedUnreliableTime).toBe(2);
  });

  it("la cola cortada de una exportación no se empareja con la primera lectura de la siguiente (R-DAT-007)", () => {
    // La cobertura de una fuente termina en su último instante completo; la lectura de la cola queda
    // fuera. Con el criterio de «encerrar un hueco entero» esa lectura, al estar ya dentro del hueco,
    // se emparejaba con la primera de la ventana siguiente: una arista con treinta días de tramo.
    const primera = laps("A", ANILLO, 1, 0); // 0100..0400, la última (0400) es la cola cortada
    const segunda = laps("A", ANILLO, 1, 30 * 24 * 3600 * SECOND);
    const coverage: Interval[] = [
      { from: 0, to: (primera[2] as Reading).time.utcMs },
      { from: (segunda[0] as Reading).time.utcMs, to: (segunda[2] as Reading).time.utcMs },
    ];

    const { transitions, discardedAcrossGaps } = buildTransitions([...primera, ...segunda], "oldest-first", coverage);
    const edges = transitions.map((t) => `${t.from}>${t.to}`);

    expect(edges).not.toContain("0400>0100");
    // Las dos transiciones que tocan una cola (0300→0400 en cada ventana) tampoco: fuera de la
    // cobertura no se analiza, y la que cruza el hueco hace la tercera.
    expect(discardedAcrossGaps).toBe(3);
    expect(edges).toEqual(["0100>0200", "0200>0300", "0100>0200", "0200>0300"]);
  });
});
