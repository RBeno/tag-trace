/**
 * Inventario contrastado: declarado × memoria × observado (`DATA_CONTRACTS.md` §3.5).
 *
 * Cruzar los tres conjuntos clasifica cada tag **sin grafo, sin vueltas y sin ninguna constante
 * industrial**: es pertenencia a conjuntos y recuentos. Lo que aporta no es un cálculo difícil, sino
 * una separación que hasta ahora no existía y cuya ausencia producía el peor tipo de error.
 *
 * El error que este módulo impide: la memoria de un vehículo contiene tags del circuito virtual, de
 * mantenimiento, de sustitución de emergencia **y obsoletos que se retiraron del suelo y nunca se
 * borraron de la lista**. Un obsoleto no produce lectura, exactamente igual que un tag que falla.
 * Tratar «está en la memoria» como sinónimo de «pudo leerse» —que es lo que parecía obvio— convierte
 * cada obsoleto en una avería inventada, y viene con una lista detrás, así que parece fundada. La
 * condición correcta tiene dos partes: **en memoria y existente** (R-OPP-011).
 *
 * Lo que este módulo **no** hace, y es deliberado:
 *
 * - No emite ninguna tasa de salud. Eso es F3 y depende de las vueltas, que aquí no existen.
 * - No decide si un candidato a obsoleto es obsoleto o está averiado. Con una sola ventana las dos
 *   explicaciones producen el mismo dato y el estado es `unknown` (R-DAT-016). Lo resuelve comparar
 *   dos periodos distantes, no analizar más el mismo.
 * - No afirma qué lleva un vehículo concreto en memoria. Con una lista maestra eso es `expected`, y
 *   la desviación individual solo se infiere del patrón bimodal (R-OPP-012).
 */

import type { Reading } from "./reading.js";
import type { TruthState } from "./truth.js";

/**
 * Las cuatro listas de planta, ya normalizadas a conjuntos de texto.
 *
 * Son configuración versionada con vigencia (`CONFIG_SCHEMA.md` §3.8), no fuente de lecturas. Los
 * identificadores son texto: `0040` no es 40 (R-DAT-001).
 */
export interface TagLists {
  /** Tags que Vsystem declara como parte del circuito. */
  readonly virtual: ReadonlySet<string>;
  /** Lista maestra de memoria: lo que cada vehículo *debería* llevar cargado. */
  readonly memory: ReadonlySet<string>;
  /** Tags de mantenimiento: fuera del recorrido productivo (R-GRA-004). */
  readonly maintenance: ReadonlySet<string>;
  /** Tags de sustitución de emergencia. */
  readonly emergency: ReadonlySet<string>;
  /**
   * Tags de las calles de carga online.
   *
   * Están fuera del recorrido productivo, como mantenimiento y emergencia, pero con una diferencia
   * que decide una clase entera: **puede saberse si hubo oportunidad de leerlos**. Si nadie entró
   * en la calle, el cero no es un cero.
   */
  readonly charging: ReadonlySet<string>;
  /**
   * Calles por las que no entró nadie en toda la cobertura, con los tags que las forman.
   *
   * Sin esto, los tres tags de una calle que simplemente no se usó saldrían `obsoleto-candidato`,
   * afirmando que probablemente ya no están en el suelo. Es el falso positivo que más rápido
   * destruye la confianza en la herramienta: tres tags sanos acusados por no haber tenido ocasión.
   */
  readonly unservedLaneTags: ReadonlySet<string>;
  /**
   * Función crítica declarada de cada tag (R-GRA-007), cuando la lista `critico` está cargada.
   *
   * Es dato de planta declarado, nunca deducido: decide una clase aparte para su omisión
   * (`critico-sin-lectura`, R-GRA-008), pero no participa en ninguna otra regla de este módulo.
   */
  readonly critical: ReadonlyMap<string, string>;
}

/**
 * Umbrales del criterio de ceguera parcial.
 *
 * **No tienen valor por defecto a propósito.** Son magnitudes de planta, y
 * `AI_DEVELOPMENT_GOVERNANCE.md` §4 prohíbe fijarlas en el código; un valor por defecto es una
 * constante industrial disfrazada, con el agravante de que nadie la ve. Quien llame a esta función
 * tiene que sacarlos de la configuración del circuito (`CONFIG_SCHEMA.md` §3.5, `min_support`), y si
 * no existen, no hay clasificación de ceguera: la hay de todo lo demás.
 */
export interface BlindnessThresholds {
  /**
   * Lecturas mínimas de un vehículo para que su silencio sobre un tag signifique algo.
   *
   * Sin esto, un vehículo con tres lecturas en toda la ventana «no lee» casi todos los tags del
   * circuito y saldría como ciego a todos ellos. El recuento bruto está contaminado por cuántas
   * vueltas dio cada uno (R-OPP-010); mientras no existan las vueltas, el total de lecturas del
   * vehículo es la aproximación honesta, y por eso el umbral se declara en lugar de suponerse.
   */
  readonly minReadingsPerVehicle: number;
  /** Vehículos que sí leen el tag, por debajo de los cuales no hay contraste que sostenga nada. */
  readonly minReadersForContrast: number;
}

/** Clases del inventario. Describen la discordancia, no una causa. */
export type TagClass =
  /** Declarado, en memoria y leído por los vehículos que podían leerlo. Nada que ver aquí. */
  | "activo"
  /** Unos vehículos lo leen y otros nunca, teniendo recorrido de sobra: patrón bimodal. */
  | "ciego-parcial"
  /** Está en la memoria y **nadie lo ha leído jamás**. Obsoleto o averiado: no se sabe. */
  | "obsoleto-candidato"
  /** El circuito virtual lo declara y la lista maestra de memoria no lo tiene. */
  | "declarado-sin-memoria"
  /** Se lee y el circuito virtual no lo declara: la lista del circuito está desactualizada. */
  | "no-declarado-leido"
  /** Mantenimiento o sustitución de emergencia: fuera del circuito y de toda tasa. */
  | "especial"
  /**
   * Tag de una calle de carga por la que **no entró nadie** en toda la cobertura.
   *
   * No dice nada del tag: dice que no hubo ocasión de leerlo. Separarlo de `obsoleto-candidato` es
   * la diferencia entre preguntar por la calle y acusar al tag (R-OPP-013).
   */
  | "calle-sin-servicio"
  /**
   * Declarado crítico (R-GRA-007), en memoria y **nadie lo ha leído jamás**.
   *
   * No es un `obsoleto-candidato` más: la omisión pierde la función que sostenía —la parada no se
   * ejecuta, el giro no se ordena, la protección no detiene—, así que es candidata a hallazgo por sí
   * sola (R-GRA-008). Sigue sin ser avería: sin memoria, el tag cae en `declarado-sin-memoria` sin
   * matiz, porque R-OPP-009 ya explica el silencio del todo.
   */
  | "critico-sin-lectura";

/**
 * Qué tiene que **valorar una persona** en cada caso.
 *
 * El programa no decide ninguna de estas cosas y no puede: si un tag sin lecturas hay que
 * sustituirlo o borrarlo de Vsystem depende de si sigue instalado, y eso se comprueba yendo a
 * mirarlo. Lo que sí puede es **decir cuál es la pregunta**, para que quede reflejada junto al
 * hallazgo y no haya que reconstruirla cada vez que alguien abra el análisis.
 */
export type TagAction =
  /** Nada que valorar. */
  | "ninguna"
  /** Ir a ver si el tag sigue instalado, y según eso sustituirlo o retirarlo de Vsystem. */
  | "valorar-sustituir-o-eliminar"
  /** Revisar la memoria de los vehículos que nunca lo leen. */
  | "revisar-memoria-de-vehiculos"
  /**
   * Está declarado en el circuito y no en la lista de memoria: si nadie lo lee, nadie puede leerlo;
   * si se lee, la lista de memoria va por detrás.
   */
  | "anadir-a-la-memoria"
  /** Se lee y no está declarado: la lista del circuito va por detrás del suelo. */
  | "declarar-en-vsystem"
  /** Nadie entró en esa calle: antes de mirar el tag, hay que saber si la calle sigue en uso. */
  | "comprobar-si-la-calle-se-usa"
  /** Se perdió una función crítica, no solo una lectura: valorar con la urgencia de esa función. */
  | "valorar-funcion-critica-perdida";

export interface TagInventoryRow {
  readonly tagId: string;
  readonly tagClass: TagClass;
  /** Estado de verdad de lo que la clase afirma, no del hecho de que el tag exista. */
  readonly truth: TruthState;
  /** Lo que hay que valorar, y que decide una persona. Queda registrado con el análisis. */
  readonly action: TagAction;
  readonly inVirtual: boolean;
  readonly inMemory: boolean;
  readonly isSpecial: boolean;
  /** Cuántos vehículos lo leyeron alguna vez. */
  readonly readerCount: number;
  /** Lecturas totales del tag en la cobertura cargada. */
  readonly readingCount: number;
  /**
   * Vehículos con recorrido suficiente que **nunca** lo leyeron.
   *
   * Es la evidencia de `ciego-parcial`, y se entrega enumerada en lugar de resumida en un
   * porcentaje: el expediente tiene que poder abrirse por el vehículo concreto.
   */
  readonly blindVehicles: readonly string[];
  /** Función crítica declarada (R-GRA-007), o `null` si el tag no está en la lista `critico`. */
  readonly criticalFunction: string | null;
}

export interface TagInventory {
  readonly rows: readonly TagInventoryRow[];
  /** Vehículos con al menos una lectura en lo cargado. */
  readonly activeVehicles: number;
  /** De ellos, los que superan `minReadingsPerVehicle` y por tanto pueden sostener una ceguera. */
  readonly vehiclesWithEnoughRecord: number;
  /**
   * Si el criterio de ceguera llegó a aplicarse.
   *
   * Falso cuando ningún vehículo alcanza el mínimo: entonces `ciego-parcial` no puede salir y la
   * interfaz debe decir que no se ha comprobado, en vez de dejar creer que se comprobó y no había.
   */
  readonly blindnessEvaluated: boolean;
}

/** Recuento por tag y por vehículo, en una sola pasada sobre las lecturas. */
interface Observation {
  readonly readersByTag: Map<string, Set<string>>;
  readonly readingsByTag: Map<string, number>;
  readonly readingsByVehicle: Map<string, number>;
}

function observe(readings: readonly Reading[]): Observation {
  const readersByTag = new Map<string, Set<string>>();
  const readingsByTag = new Map<string, number>();
  const readingsByVehicle = new Map<string, number>();

  for (const reading of readings) {
    const { tagId, agvId } = reading;
    let readers = readersByTag.get(tagId);
    if (readers === undefined) {
      readers = new Set<string>();
      readersByTag.set(tagId, readers);
    }
    readers.add(agvId);
    readingsByTag.set(tagId, (readingsByTag.get(tagId) ?? 0) + 1);
    readingsByVehicle.set(agvId, (readingsByVehicle.get(agvId) ?? 0) + 1);
  }

  return { readersByTag, readingsByTag, readingsByVehicle };
}

/**
 * Clasifica el universo de tags cruzando las listas con lo observado.
 *
 * El universo es la unión de las cuatro listas y de lo leído: un tag que se lee sin estar en ninguna
 * lista **no se descarta**, porque es precisamente la señal de que una lista está desactualizada.
 * Descartarlo por no estar declarado sería decidir que la lista tiene razón frente al dato.
 */
export function buildTagInventory(
  readings: readonly Reading[],
  lists: TagLists,
  thresholds: BlindnessThresholds,
): TagInventory {
  const { readersByTag, readingsByTag, readingsByVehicle } = observe(readings);

  const witnesses: string[] = [];
  for (const [agvId, count] of readingsByVehicle) {
    if (count >= thresholds.minReadingsPerVehicle) witnesses.push(agvId);
  }
  witnesses.sort();
  const blindnessEvaluated = witnesses.length > 0;

  const universe = new Set<string>([
    ...lists.virtual,
    ...lists.memory,
    ...lists.maintenance,
    ...lists.emergency,
    ...lists.charging,
    ...lists.critical.keys(),
    ...readersByTag.keys(),
  ]);

  const rows: TagInventoryRow[] = [];
  for (const tagId of [...universe].sort()) {
    const inVirtual = lists.virtual.has(tagId);
    const inMemory = lists.memory.has(tagId);
    const isSpecial =
      lists.maintenance.has(tagId) || lists.emergency.has(tagId) || lists.charging.has(tagId);
    const readers = readersByTag.get(tagId) ?? new Set<string>();
    const readingCount = readingsByTag.get(tagId) ?? 0;

    const blindVehicles =
      readers.size >= thresholds.minReadersForContrast
        ? witnesses.filter((agvId) => !readers.has(agvId))
        : [];

    const criticalFunction = lists.critical.get(tagId) ?? null;
    const { tagClass, truth } = classify({
      inVirtual,
      inMemory,
      isSpecial,
      readerCount: readers.size,
      blindCount: blindVehicles.length,
      inUnservedLane: lists.unservedLaneTags.has(tagId),
      isCritical: criticalFunction !== null,
    });

    rows.push({
      tagId,
      tagClass,
      truth,
      action: ACTION_BY_CLASS[tagClass],
      inVirtual,
      inMemory,
      isSpecial,
      readerCount: readers.size,
      readingCount,
      blindVehicles,
      criticalFunction,
    });
  }

  return {
    rows,
    activeVehicles: readingsByVehicle.size,
    vehiclesWithEnoughRecord: witnesses.length,
    blindnessEvaluated,
  };
}

interface ClassifyInput {
  readonly inVirtual: boolean;
  readonly inMemory: boolean;
  readonly isSpecial: boolean;
  readonly readerCount: number;
  readonly blindCount: number;
  readonly inUnservedLane: boolean;
  readonly isCritical: boolean;
}

/**
 * El orden de las comprobaciones es la regla, no un detalle de implementación.
 *
 * `especial` va primero porque mantenimiento y emergencia están legítimamente fuera del recorrido
 * productivo (R-GRA-004): contarlos con el resto ensucia cualquier cifra. Y entre los leídos, la
 * discordancia de lista manda sobre la ceguera: si el tag se lee y una lista no lo tiene, el hallazgo
 * es la lista, no el vehículo.
 */
function classify(input: ClassifyInput): { tagClass: TagClass; truth: TruthState } {
  // Antes que nada: si es de una calle por la que no pasó nadie, no hay nada que leer en su
  // silencio. Va primero porque cualquier otra clase que se le asigne después sería una afirmación
  // sobre un tag que nunca tuvo la ocasión de demostrar nada.
  if (input.inUnservedLane && input.readerCount === 0) {
    return { tagClass: "calle-sin-servicio", truth: "unknown" };
  }
  if (input.isSpecial) return { tagClass: "especial", truth: "observed" };

  if (input.readerCount === 0) {
    // En memoria y nadie lo ha leído nunca. Obsoleto o averiado: el dato es idéntico y no se elige
    // (R-DAT-016). Prevalece sobre `declarado-sin-memoria` porque estar en la memoria es lo que
    // hace que la ausencia total signifique algo.
    if (input.inMemory) {
      // Declarado crítico además: la omisión pierde una función, no solo una lectura (R-GRA-008).
      // Sigue subordinado a la memoria: si no estuviera en memoria, R-OPP-009 ya explicaría el
      // silencio del todo y no haría falta el matiz — por eso esta rama vive dentro de `inMemory`.
      if (input.isCritical) return { tagClass: "critico-sin-lectura", truth: "unknown" };
      return { tagClass: "obsoleto-candidato", truth: "unknown" };
    }
    // Declarado, fuera de la memoria maestra y sin una sola lectura: nadie puede leerlo aunque
    // exista. Es un punto ciego de configuración, no una avería.
    return { tagClass: "declarado-sin-memoria", truth: "observed" };
  }

  if (!input.inVirtual) return { tagClass: "no-declarado-leido", truth: "observed" };
  // Se lee, luego alguna memoria real lo tiene, y la lista maestra no: la lista va por detrás.
  if (!input.inMemory) return { tagClass: "declarado-sin-memoria", truth: "observed" };
  // La memoria del vehículo individual no se observa, así que la ceguera es inferencia (R-OPP-012).
  if (input.blindCount > 0) return { tagClass: "ciego-parcial", truth: "inferred" };
  return { tagClass: "activo", truth: "observed" };
}

/** Qué valorar en cada clase. Es una tabla y no una cadena de `if` porque es una decisión, no lógica. */
const ACTION_BY_CLASS: Readonly<Record<TagClass, TagAction>> = {
  activo: "ninguna",
  // El caso que el propietario nombró: el programa no puede saber si el tag sigue en el suelo.
  "obsoleto-candidato": "valorar-sustituir-o-eliminar",
  "ciego-parcial": "revisar-memoria-de-vehiculos",
  "declarado-sin-memoria": "anadir-a-la-memoria",
  "no-declarado-leido": "declarar-en-vsystem",
  // Mantenimiento y emergencia están fuera del recorrido productivo: su silencio no significa lo
  // mismo y no abre ninguna tarea.
  especial: "ninguna",
  // Preguntar por la calle antes que por el tag: sin entradas, el tag no ha dicho nada de sí mismo.
  "calle-sin-servicio": "comprobar-si-la-calle-se-usa",
  // No es un obsoleto más: se perdió una función (R-GRA-008), y la urgencia la marca esa función.
  "critico-sin-lectura": "valorar-funcion-critica-perdida",
};

/** La acción, en la frase que se le enseña a quien tiene que decidir. */
export function describeAction(action: TagAction): string {
  switch (action) {
    case "ninguna":
      return "Nada que valorar";
    case "valorar-sustituir-o-eliminar":
      return "Comprobar en planta si sigue instalado: si lo está, sustituirlo; si no, retirarlo de Vsystem";
    case "revisar-memoria-de-vehiculos":
      return "Revisar la memoria de los vehículos que nunca lo leen";
    case "anadir-a-la-memoria":
      return "Añadirlo a la lista de memoria: está declarado y la lista de memoria no lo tiene";
    case "declarar-en-vsystem":
      return "Declararlo en Vsystem: existe y se lee, pero no está en la lista del circuito";
    case "comprobar-si-la-calle-se-usa":
      return "Ningún vehículo entró en esa calle: comprobar si sigue en servicio antes de mirar el tag";
    case "valorar-funcion-critica-perdida":
      return "Es un punto crítico declarado y nadie lo ha leído nunca: se perdió su función, no solo una lectura";
  }
}

/** Recuento por clase, para el resumen. El orden es el de `TagClass`, no el de aparición. */
export function countByClass(inventory: TagInventory): ReadonlyMap<TagClass, number> {
  const counts = new Map<TagClass, number>();
  for (const row of inventory.rows) {
    counts.set(row.tagClass, (counts.get(row.tagClass) ?? 0) + 1);
  }
  return counts;
}
