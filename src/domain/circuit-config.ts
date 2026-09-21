/**
 * La configuración de planta que llega en las listas, convertida en objetos con los que se puede
 * razonar: calles de carga online y zonas (`CONFIG_SCHEMA.md` §3.4, R-GRA-006).
 *
 * Existe porque una calle de carga **no es un conjunto de tags**. Es una secuencia con papeles —se
 * entra por uno, se para en otro y se sale por el tercero— y R-CO-006 depende de poder distinguir
 * los tres: la firma de una permanencia en carga es «la última lectura fue el tag de parada y la
 * reanudación recorre en orden la secuencia declarada». Con un conjunto sin orden ni papeles, esa
 * frase no se puede evaluar.
 *
 * **Lo que no se puede montar se declara, no se arregla.** Una calle a la que le falta la parada
 * precisa, o que trae dos tags con el mismo orden, no se usa — y aparece en `problems` con su
 * motivo. Es lo que R-CO-006 exige literalmente: «sin calles configuradas la firma no se reconoce y
 * el silencio queda `unknown`; no se sustituye por proximidad». Inventar el tag que falta sería
 * sustituirlo por proximidad.
 */

import { LIST_FUNCTIONS } from "./tag-lists.js";

/** Lo mínimo que hace falta de una entrada de lista para leer configuración de ella. */
export interface ConfigEntry {
  readonly tagId: string;
  readonly order: number | null;
  readonly funcion: string;
  readonly grupo: string;
  readonly capacidad: number | null;
}

export interface CoLane {
  /** El identificador declarado en `grupo`. */
  readonly laneId: string;
  /** Los tags de la calle, en el orden declarado. */
  readonly tags: readonly string[];
  readonly entryTagId: string;
  /** La parada precisa: donde el vehículo se detiene a cargar. */
  readonly stopTagId: string;
  /** El tag que se lee al salir, ya cargado. */
  readonly exitTagId: string;
  /** Cuántos vehículos caben, si la lista lo declara (R-CO-001). */
  readonly capacity: number | null;
}

export interface CoLaneConfig {
  readonly lanes: readonly CoLane[];
  /**
   * Por qué una calle declarada no se pudo montar, en la frase que se enseña.
   *
   * No es un registro de depuración: una calle que falta cambia el diagnóstico —sus paradas
   * vuelven a contarse como silencios—, así que quien mira la pantalla tiene que saberlo.
   */
  readonly problems: readonly string[];
}

/** Las zonas que el producto sabe tratar. Cualquier otra se conserva con su nombre. */
export type ZoneName = (typeof LIST_FUNCTIONS)["zona"][number];

export interface ZoneConfig {
  /** Zona declarada de cada tag. Un tag sin fila no tiene zona, que es distinto de tenerla vacía. */
  readonly zoneOf: ReadonlyMap<string, string>;
  readonly problems: readonly string[];
}

const LANE_ROLES = LIST_FUNCTIONS["carga-online"];

/**
 * Monta las calles a partir de las filas de la lista `carga-online`.
 *
 * El orden lo fija la columna `orden` cuando está y el orden del fichero cuando no, igual que hace
 * la lista `circuito`. Los papeles no admiten esa degradación: sin `funcion` no hay forma de saber
 * cuál de los tres tags es la parada, y adivinarlo por la posición sería inventar la regla.
 */
export function readCoLanes(entries: readonly ConfigEntry[]): CoLaneConfig {
  const byLane = new Map<string, ConfigEntry[]>();
  const problems: string[] = [];

  for (const entry of entries) {
    if (entry.grupo === "") {
      problems.push(
        `El tag ${entry.tagId} está en la lista de carga online y no dice a qué calle pertenece ` +
          "(columna «grupo»). No se le puede asignar ninguna.",
      );
      continue;
    }
    let group = byLane.get(entry.grupo);
    if (group === undefined) {
      group = [];
      byLane.set(entry.grupo, group);
    }
    group.push(entry);
  }

  const lanes: CoLane[] = [];
  for (const [laneId, group] of [...byLane].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    const unknownRole = group.filter(
      (entry) => !(LANE_ROLES as readonly string[]).includes(entry.funcion),
    );
    if (unknownRole.length > 0) {
      problems.push(
        `La calle «${laneId}» declara papeles que no existen en ` +
          `${unknownRole.map((entry) => `${entry.tagId}=«${entry.funcion || "vacío"}»`).join(", ")}. ` +
          `Se esperan ${LANE_ROLES.join(", ")}.`,
      );
      continue;
    }

    const roleOf = (role: string): readonly ConfigEntry[] =>
      group.filter((entry) => entry.funcion === role);
    const missing = LANE_ROLES.filter((role) => roleOf(role).length === 0);
    if (missing.length > 0) {
      problems.push(
        `La calle «${laneId}» no se monta: le falta ${missing.map((role) => `«${role}»`).join(" y ")}.`,
      );
      continue;
    }
    const duplicated = LANE_ROLES.filter((role) => roleOf(role).length > 1);
    if (duplicated.length > 0) {
      problems.push(
        `La calle «${laneId}» declara ${duplicated.map((role) => `«${role}»`).join(" y ")} más de ` +
          "una vez. No se monta: cuál de los dos es el bueno no lo decide el programa.",
      );
      continue;
    }

    // Con `orden` cuando lo hay, y con el orden del fichero cuando no: es la misma degradación que
    // ya sigue la lista `circuito`, y ahí sí es honesta porque la secuencia física existe igual.
    const ordered = [...group].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const entry = roleOf("entrada")[0] as ConfigEntry;
    const stop = roleOf("parada-precisa")[0] as ConfigEntry;
    const exit = roleOf("salida")[0] as ConfigEntry;

    lanes.push({
      laneId,
      tags: ordered.map((item) => item.tagId),
      entryTagId: entry.tagId,
      stopTagId: stop.tagId,
      exitTagId: exit.tagId,
      capacity: group.find((item) => item.capacidad !== null)?.capacidad ?? null,
    });
  }

  return { lanes, problems };
}

/** Lee la zona de cada tag de la lista `zona`. */
export function readZones(entries: readonly ConfigEntry[]): ZoneConfig {
  const zoneOf = new Map<string, string>();
  const problems: string[] = [];
  const known = LIST_FUNCTIONS.zona as readonly string[];

  for (const entry of entries) {
    // La zona viaja en `grupo`; se admite `funcion` porque escribir «vacio» en una columna llamada
    // «funcion» es un error previsible y el dato sigue siendo inequívoco.
    const zone = entry.grupo !== "" ? entry.grupo : entry.funcion;
    if (zone === "") {
      problems.push(`El tag ${entry.tagId} está en la lista de zonas y no dice cuál (columna «grupo»).`);
      continue;
    }
    if (!known.includes(zone)) {
      problems.push(
        `El tag ${entry.tagId} declara la zona «${zone}», que no es ${known.join(" ni ")}. ` +
          "Se conserva, pero las reglas de FIFO no la reconocen.",
      );
    }
    const previous = zoneOf.get(entry.tagId);
    if (previous !== undefined && previous !== zone) {
      problems.push(
        `El tag ${entry.tagId} aparece en dos zonas, «${previous}» y «${zone}». Se queda con la ` +
          "primera: un tag en dos zonas es una contradicción de la lista, no un dato.",
      );
      continue;
    }
    zoneOf.set(entry.tagId, zone);
  }

  return { zoneOf, problems };
}

/**
 * Los tags por los que se entra a una calle.
 *
 * R-FLO-006 los trata aparte: entrar en una calle CO es «una salida legítima del orden», así que
 * el vecindario de convoy deja de ser evidencia justo ahí.
 */
export function laneEntryTags(lanes: readonly CoLane[]): ReadonlySet<string> {
  return new Set(lanes.map((lane) => lane.entryTagId));
}

/** Todos los tags que pertenecen a alguna calle: fuera del recorrido productivo del anillo. */
export function laneTags(lanes: readonly CoLane[]): ReadonlySet<string> {
  return new Set(lanes.flatMap((lane) => lane.tags));
}
