/**
 * Inventario contrastado: declarado × memoria × observado (`DATA_CONTRACTS.md` §3.5).
 *
 * La prueba que más importa aquí no es que las seis clases salgan: es que **el obsoleto no se
 * confunda con la avería**. Los dos producen cero lecturas, y la diferencia entre acertar y
 * fabricar un diagnóstico está en no elegir cuando el dato no distingue.
 */

import { describe, expect, it } from "vitest";

import {
  buildTagInventory,
  countByClass,
  describeAction,
  type BlindnessThresholds,
  type TagLists,
} from "../../src/domain/inventory.js";
import type { Reading } from "../../src/domain/reading.js";

const ZONE = "Europe/Madrid";

function reading(utcMs: number, agvId: string, tagId: string): Reading {
  return {
    time: { utcMs, raw: String(utcMs), zone: ZONE, flag: "ok" },
    agvId,
    tagId,
    provenance: { sourceId: "s", sourceHash: "s", sourceRow: utcMs },
  };
}

/** Un vehículo que recorre una lista de tags `laps` veces. */
function laps(agvId: string, tags: readonly string[], count: number, offset = 0): Reading[] {
  const out: Reading[] = [];
  let t = offset;
  for (let lap = 0; lap < count; lap += 1) {
    for (const tag of tags) {
      out.push(reading((t += 1000), agvId, tag));
    }
  }
  return out;
}

type SetLists = Exclude<keyof TagLists, "critical">;

function lists(
  partial: Partial<Record<SetLists, readonly string[]>> & { critical?: Record<string, string> },
): TagLists {
  return {
    virtual: new Set(partial.virtual ?? []),
    memory: new Set(partial.memory ?? []),
    maintenance: new Set(partial.maintenance ?? []),
    emergency: new Set(partial.emergency ?? []),
    charging: new Set(partial.charging ?? []),
    unservedLaneTags: new Set(partial.unservedLaneTags ?? []),
    critical: new Map(Object.entries(partial.critical ?? {})),
  };
}

/** Umbrales explícitos: la función no tiene valores por defecto, y esa es la intención. */
const THRESHOLDS: BlindnessThresholds = { minReadingsPerVehicle: 10, minReadersForContrast: 2 };

function classOf(inventory: ReturnType<typeof buildTagInventory>, tagId: string): string {
  const row = inventory.rows.find((candidate) => candidate.tagId === tagId);
  expect(row, `no hay fila para el tag ${tagId}`).toBeDefined();
  return row?.tagClass ?? "";
}

describe("inventario contrastado", () => {
  const RUTA = ["0100", "0200", "0300"];

  it("un tag de la ruta que todos leen sale activo", () => {
    const readings = [...laps("A", RUTA, 5), ...laps("B", RUTA, 5, 100_000)];
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: RUTA, memory: RUTA }),
      THRESHOLDS,
    );

    expect(classOf(inventory, "0100")).toBe("activo");
    expect(inventory.activeVehicles).toBe(2);
    expect(inventory.blindnessEvaluated).toBe(true);
  });

  it("un tag en memoria que nadie ha leído jamás es candidato a obsoleto, y queda unknown", () => {
    const readings = [...laps("A", RUTA, 5), ...laps("B", RUTA, 5, 100_000)];
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: [...RUTA, "0999"], memory: [...RUTA, "0999"] }),
      THRESHOLDS,
    );

    const row = inventory.rows.find((candidate) => candidate.tagId === "0999");
    expect(row?.tagClass).toBe("obsoleto-candidato");
    // Lo que esta prueba defiende de verdad: no se resuelve a favor de ninguna de las dos
    // explicaciones. Con una ventana, obsoleto y averiado son el mismo dato (R-DAT-016).
    expect(row?.truth).toBe("unknown");
    expect(row?.readingCount).toBe(0);
    // Y el programa no elige por el técnico: enuncia la pregunta que él tiene que resolver yendo
    // a mirar, y la deja registrada con el hallazgo.
    expect(row?.action).toBe("valorar-sustituir-o-eliminar");
    expect(describeAction(row?.action ?? "ninguna")).toContain("sigue instalado");
  });

  it("un punto crítico declarado, en memoria y nunca leído es critico-sin-lectura, no obsoleto-candidato (R-GRA-008)", () => {
    const readings = [...laps("A", RUTA, 5), ...laps("B", RUTA, 5, 100_000)];
    const inventory = buildTagInventory(
      readings,
      lists({
        virtual: [...RUTA, "0999"],
        memory: [...RUTA, "0999"],
        critical: { "0999": "bifurcacion" },
      }),
      THRESHOLDS,
    );

    const row = inventory.rows.find((candidate) => candidate.tagId === "0999");
    expect(row?.tagClass).toBe("critico-sin-lectura");
    // Sigue sin ser avería: el dato no distingue obsoleto de averiado (R-DAT-016).
    expect(row?.truth).toBe("unknown");
    expect(row?.criticalFunction).toBe("bifurcacion");
    expect(row?.action).toBe("valorar-funcion-critica-perdida");
    expect(describeAction(row?.action ?? "ninguna")).toContain("perdió su función");
  });

  it("un punto crítico sin memoria se queda declarado-sin-memoria, sin matiz (R-OPP-009 manda sobre R-GRA-008)", () => {
    const readings = [...laps("A", RUTA, 5), ...laps("B", RUTA, 5, 100_000)];
    const inventory = buildTagInventory(
      readings,
      lists({
        virtual: [...RUTA, "0999"],
        memory: RUTA, // "0999" declarado, pero fuera de la memoria maestra
        critical: { "0999": "bifurcacion" },
      }),
      THRESHOLDS,
    );

    const row = inventory.rows.find((candidate) => candidate.tagId === "0999");
    expect(row?.tagClass).toBe("declarado-sin-memoria");
  });

  it("un punto crítico que sí se lee sigue activo, y lleva su función nombrada", () => {
    const readings = [
      ...laps("A", [...RUTA, "0999"], 5),
      ...laps("B", [...RUTA, "0999"], 5, 100_000),
    ];
    const inventory = buildTagInventory(
      readings,
      lists({
        virtual: [...RUTA, "0999"],
        memory: [...RUTA, "0999"],
        critical: { "0999": "cruce" },
      }),
      THRESHOLDS,
    );

    const row = inventory.rows.find((candidate) => candidate.tagId === "0999");
    expect(row?.tagClass).toBe("activo");
    expect(row?.criticalFunction).toBe("cruce");
  });

  it("cada clase indica qué hay que valorar, y solo dos no abren ninguna tarea", () => {
    const readings = [
      ...laps("A", [...RUTA, "0555"], 5),
      ...laps("B", RUTA, 5, 100_000),
      ...laps("C", ["0100", "0300"], 8, 200_000),
    ];
    const inventory = buildTagInventory(
      readings,
      lists({
        virtual: [...RUTA, "0777"],
        memory: [...RUTA, "0555", "0800"],
        maintenance: ["0800"],
      }),
      THRESHOLDS,
    );

    const actionOf = (tagId: string): string =>
      inventory.rows.find((row) => row.tagId === tagId)?.action ?? "";

    expect(actionOf("0100")).toBe("ninguna");
    expect(actionOf("0200")).toBe("revisar-memoria-de-vehiculos");
    expect(actionOf("0777")).toBe("anadir-a-la-memoria");
    expect(actionOf("0555")).toBe("declarar-en-vsystem");
    expect(actionOf("0800")).toBe("ninguna");
  });

  it("un tag que unos leen siempre y otro nunca sale ciego-parcial, y como inferencia", () => {
    const readings = [
      ...laps("A", RUTA, 5),
      ...laps("B", RUTA, 5, 100_000),
      // C recorre lo mismo salvo 0200: quince lecturas, de sobra para que su silencio cuente.
      ...laps("C", ["0100", "0300"], 8, 200_000),
    ];
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: RUTA, memory: RUTA }),
      THRESHOLDS,
    );

    const row = inventory.rows.find((candidate) => candidate.tagId === "0200");
    expect(row?.tagClass).toBe("ciego-parcial");
    expect(row?.truth).toBe("inferred");
    // La evidencia sale enumerada, no resumida: el expediente tiene que abrirse por el vehículo.
    expect(row?.blindVehicles).toEqual(["C"]);
    expect(classOf(inventory, "0100")).toBe("activo");
  });

  it("un vehículo con poco recorrido no convierte en ciego a ningún tag", () => {
    const readings = [
      ...laps("A", RUTA, 5),
      ...laps("B", RUTA, 5, 100_000),
      // D tiene dos lecturas en total: que no haya leído 0200 no dice absolutamente nada.
      ...laps("D", ["0100"], 2, 300_000),
    ];
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: RUTA, memory: RUTA }),
      THRESHOLDS,
    );

    expect(classOf(inventory, "0200")).toBe("activo");
    expect(inventory.activeVehicles).toBe(3);
    expect(inventory.vehiclesWithEnoughRecord).toBe(2);
  });

  it("un tag declarado que ninguna memoria contiene es un punto ciego de configuración", () => {
    const readings = [...laps("A", RUTA, 5), ...laps("B", RUTA, 5, 100_000)];
    const inventory = buildTagInventory(
      readings,
      // 0777 está en el circuito virtual y no en la lista maestra de memoria: existe y nadie
      // puede leerlo. No es avería de nada.
      lists({ virtual: [...RUTA, "0777"], memory: RUTA }),
      THRESHOLDS,
    );

    const row = inventory.rows.find((candidate) => candidate.tagId === "0777");
    expect(row?.tagClass).toBe("declarado-sin-memoria");
    expect(row?.truth).toBe("observed");
    expect(row?.inMemory).toBe(false);
  });

  it("un tag que se lee sin estar declarado delata que la lista del circuito va por detrás", () => {
    const readings = [
      ...laps("A", [...RUTA, "0555"], 5),
      ...laps("B", [...RUTA, "0555"], 5, 100_000),
    ];
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: RUTA, memory: [...RUTA, "0555"] }),
      THRESHOLDS,
    );

    expect(classOf(inventory, "0555")).toBe("no-declarado-leido");
  });

  it("mantenimiento y emergencia se cuentan aparte y no entran en ninguna otra clase", () => {
    const readings = [
      ...laps("A", RUTA, 5),
      ...laps("B", RUTA, 5, 100_000),
      ...laps("A", ["0800"], 1, 400_000),
    ];
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: RUTA, memory: [...RUTA, "0800", "0801"], maintenance: ["0800"], emergency: ["0801"] }),
      THRESHOLDS,
    );

    expect(classOf(inventory, "0800")).toBe("especial");
    // El de emergencia no se ha leído nunca, y aun así **no** es candidato a obsoleto: está fuera
    // del recorrido productivo por definición, así que su silencio no significa lo mismo.
    expect(classOf(inventory, "0801")).toBe("especial");
  });

  it("ningún tag cae en dos clases y el universo cubre la unión de listas y lecturas", () => {
    const readings = [
      ...laps("A", [...RUTA, "0555"], 5),
      ...laps("B", RUTA, 5, 100_000),
      ...laps("C", ["0100", "0300"], 8, 200_000),
    ];
    const inventory = buildTagInventory(
      readings,
      lists({
        virtual: [...RUTA, "0777", "0999"],
        memory: [...RUTA, "0555", "0999", "0800"],
        maintenance: ["0800"],
      }),
      THRESHOLDS,
    );

    const ids = inventory.rows.map((row) => row.tagId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["0100", "0200", "0300", "0555", "0777", "0800", "0999"]);

    const counts = countByClass(inventory);
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(inventory.rows.length);
    expect(counts.get("obsoleto-candidato")).toBe(1);
    expect(counts.get("declarado-sin-memoria")).toBe(1);
    expect(counts.get("no-declarado-leido")).toBe(1);
    expect(counts.get("especial")).toBe(1);
    expect(counts.get("ciego-parcial")).toBe(1);
  });

  it("sin ningún vehículo con recorrido suficiente, la ceguera se declara no comprobada", () => {
    const readings = laps("D", ["0100"], 2);
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: RUTA, memory: RUTA }),
      THRESHOLDS,
    );

    // Y la diferencia importa: «no se comprobó» no es «se comprobó y no había».
    expect(inventory.blindnessEvaluated).toBe(false);
    expect(inventory.rows.every((row) => row.tagClass !== "ciego-parcial")).toBe(true);
    // 0200 y 0300 están en memoria y nadie los ha leído: candidatos a obsoleto, no averías.
    expect(classOf(inventory, "0200")).toBe("obsoleto-candidato");
  });

  it("un tag de una calle por la que no entró nadie no es un candidato a obsoleto", () => {
    // La distinción que evita el falso positivo más destructivo: tres tags perfectamente sanos
    // acusados de no estar ya en el suelo cuando lo único que pasó es que nadie fue a cargar allí.
    const readings = laps("A", ["0100", "0200"], 12);
    const calle = ["7001", "7002", "7003"];

    const sinSaberlo = buildTagInventory(
      readings,
      lists({ virtual: ["0100", "0200"], memory: [...calle, "0100", "0200"] }),
      THRESHOLDS,
    );
    expect(classOf(sinSaberlo, "7002")).toBe("obsoleto-candidato");

    const sabiendolo = buildTagInventory(
      readings,
      lists({
        virtual: ["0100", "0200"],
        memory: [...calle, "0100", "0200"],
        charging: calle,
        unservedLaneTags: calle,
      }),
      THRESHOLDS,
    );
    expect(classOf(sabiendolo, "7002")).toBe("calle-sin-servicio");
    const fila = sabiendolo.rows.find((row) => row.tagId === "7002");
    // `unknown`, y la pregunta apunta a la calle, no al tag.
    expect(fila?.truth).toBe("unknown");
    expect(fila?.action).toBe("comprobar-si-la-calle-se-usa");
  });

  it("un tag de calle que sí se lee queda fuera de toda tasa, como mantenimiento", () => {
    const readings = [...laps("A", ["0100", "0200"], 12), ...laps("A", ["7002"], 3)];
    const inventory = buildTagInventory(
      readings,
      lists({ virtual: ["0100", "0200"], memory: ["0100", "0200"], charging: ["7002"] }),
      THRESHOLDS,
    );

    // Sin la lista de carga habría salido `no-declarado-leido`, abriendo una tarea que no existe.
    expect(classOf(inventory, "7002")).toBe("especial");
    expect(inventory.rows.find((row) => row.tagId === "7002")?.action).toBe("ninguna");
  });
});
