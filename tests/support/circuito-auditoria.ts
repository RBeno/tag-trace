/**
 * Circuito sintético con **todos los fallos conocidos plantados a propósito**.
 *
 * Existe para responder una pregunta que ninguna prueba unitaria responde: de todo lo que puede ir
 * mal en un circuito real, ¿qué detecta la aplicación, qué se le escapa y cuántas veces señala algo
 * que está sano? Como aquí se sabe dónde está cada fallo y qué debería delatarlo, la respuesta es
 * una cifra por clase y no una impresión.
 *
 * **No se versiona el fichero, se genera.** Cien mil filas son megabytes que envejecen; con semilla
 * el escenario es el mismo siempre y comparable entre ejecuciones. Es el mismo criterio que ya sigue
 * `tests/e2e/rendimiento.spec.ts`.
 *
 * Todo lo de aquí es inventado: identificadores, fechas y topología. No reproduce ninguna planta.
 */

/** Clases de fallo que el escenario planta. Cada una con su expectativa y su prohibición. */
export type DefectClass =
  /** Declarado en el circuito virtual y sin una sola lectura de nadie. */
  | "declarado-sin-lecturas"
  /** Se lee casi siempre: el caso sano con el que se cuentan los falsos positivos. */
  | "lectura-alta"
  /** Se lee a medias, de forma pareja entre vehículos. */
  | "lectura-media"
  /** Unos vehículos se lo saltan siempre y el resto no: memoria o lector de esos vehículos. */
  | "omision-por-memoria"
  /** Un vehículo se salta varios seguidos pero mantiene su sitio en el convoy. */
  | "omision-conservando-convoy"
  /** Se lee con normalidad y desaparece de golpe en un instante concreto. */
  | "rotura-subita"
  /** Empieza leyéndose al 90 % y termina al 40 %. */
  | "degradacion-progresiva"
  /** Lecturas sueltas fuera del recorrido productivo. */
  | "mantenimiento-aislado";

export interface PlantedDefect {
  readonly kind: DefectClass;
  readonly tags: readonly string[];
  readonly vehicles: readonly string[];
  /** Para la rotura y la degradación: cuándo ocurre, en epoch UTC. */
  readonly atUtcMs?: number;
  /** Qué tiene que decir el producto para que cuente como detectado. */
  readonly expect: string;
  /** Lo que **no** puede decir. Una detección que además afirma de más no es una detección. */
  readonly mustNotSay: string;
}

export interface AuditScenario {
  /** Lecturas en forma DS-001 (`Fecha;AGV;Tag`), en orden de pila descendente. */
  readonly readingsCsv: string;
  /** Listas de tags en el formato que el importador declara (`lista;tag;orden`). */
  readonly listsCsv: string;
  readonly defects: readonly PlantedDefect[];
  /** Tags sin nada plantado. Señalar uno de estos es un falso positivo. */
  readonly cleanTags: readonly string[];
  /** Todos los tags declarados en el circuito virtual, en orden. */
  readonly declaredRing: readonly string[];
  readonly vehicles: readonly string[];
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
}

const RING_SIZE = 150;
const VEHICLES = 40;
const HOURS = 30;
/** Segundos entre dos tags consecutivos, antes de la variación aleatoria. */
const STEP_SECONDS = 12;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function stamp(utcMs: number): string {
  const d = new Date(utcMs);
  return (
    `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/` +
    `${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:` +
    `${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`
  );
}

/**
 * Construye el escenario.
 *
 * El reparto de tags está fijado a propósito por posición y no al azar: así el escenario se puede
 * describir en el manifiesto y cualquiera puede comprobar a mano que lo plantado es lo que dice.
 */
export function buildAuditScenario(seed = 20260920): AuditScenario {
  const random = seeded(seed);
  const ring = Array.from({ length: RING_SIZE }, (_, index) => String(60_000 + index * 3));
  const vehicles = Array.from({ length: VEHICLES }, (_, index) => String(7100 + index));

  // --- Reparto de papeles, por posición en el anillo -----------------------------------------
  const nuncaLeidos = [ring[13], ring[77], ring[131]] as string[];
  const lecturaAlta = ring.slice(20, 30); // 10 tags entre el 95 y el 100 %
  const lecturaMedia = ring.slice(40, 50); // 10 tags entre el 20 y el 90 %
  const porMemoria = [ring[60], ring[61]] as string[]; // los saltan siempre unos vehículos
  const tramoConvoy = ring.slice(90, 95) as string[]; // varios seguidos, conservando convoy
  const rotos = [ring[100], ring[101]] as string[];
  const degradados = [ring[110], ring[111]] as string[];
  const mantenimiento = ["90001", "90002"]; // fuera del anillo declarado

  const ciegos = vehicles.filter((_, index) => index % 8 === 0); // se saltan `porMemoria`
  const saltador = vehicles[5] as string; // se salta `tramoConvoy` al azar

  const tasaAlta = new Map(lecturaAlta.map((tag, index) => [tag, 0.95 + (index % 6) * 0.01]));
  const tasaMedia = new Map(lecturaMedia.map((tag, index) => [tag, 0.2 + index * 0.078]));

  const from = Date.UTC(2026, 8, 14, 5, 0, 0);
  const to = from + HOURS * 3_600_000;
  const rotura = from + Math.floor((to - from) * 0.55);

  const filas: Array<{ t: number; v: string; tag: string }> = [];

  for (const vehicle of vehicles) {
    const esCiego = ciegos.includes(vehicle);
    let position = Math.floor(random() * RING_SIZE);
    let now = from + Math.floor(random() * 900_000);
    // El salto de convoy dura varias vueltas seguidas y después se recupera, para que el vehículo
    // conserve su sitio entre los mismos AGV en vez de descolgarse.
    let saltandoTramo = false;

    while (now < to) {
      const tag = ring[position] as string;
      if (position === 90) saltandoTramo = vehicle === saltador && random() < 0.35;

      const avance = Math.round((to - from) === 0 ? 0 : ((now - from) / (to - from)) * 100) / 100;
      let lee = true;

      if (nuncaLeidos.includes(tag)) lee = false;
      else if (esCiego && porMemoria.includes(tag)) lee = false;
      else if (saltandoTramo && tramoConvoy.includes(tag)) lee = false;
      else if (rotos.includes(tag)) lee = now < rotura;
      else if (degradados.includes(tag)) lee = random() < 0.9 - 0.5 * avance;
      else if (tasaAlta.has(tag)) lee = random() < (tasaAlta.get(tag) as number);
      else if (tasaMedia.has(tag)) lee = random() < (tasaMedia.get(tag) as number);

      if (lee) filas.push({ t: now, v: vehicle, tag });

      now += (STEP_SECONDS + Math.floor(random() * 9)) * 1000;
      position = (position + 1) % RING_SIZE;
    }
  }

  // Mantenimiento: lecturas sueltas, de pocos vehículos y fuera del anillo.
  for (let index = 0; index < 14; index += 1) {
    filas.push({
      t: from + Math.floor(random() * (to - from)),
      v: vehicles[index % 4] as string,
      tag: mantenimiento[index % mantenimiento.length] as string,
    });
  }

  filas.sort((a, b) => b.t - a.t); // Pila: lo más reciente primero, como la fuente real.

  const readingsCsv = ["Fecha;AGV;Tag"]
    .concat(filas.map((fila) => `${stamp(fila.t)};${fila.v};${fila.tag}`))
    .join("\r\n");

  const listsCsv = ["lista;tag;orden"]
    .concat(ring.map((tag, index) => `circuito;${tag};${index + 1}`))
    .join("\r\n");

  const plantados = new Set([
    ...nuncaLeidos,
    ...lecturaAlta,
    ...lecturaMedia,
    ...porMemoria,
    ...tramoConvoy,
    ...rotos,
    ...degradados,
  ]);

  const defects: PlantedDefect[] = [
    {
      kind: "declarado-sin-lecturas",
      tags: nuncaLeidos,
      vehicles: [],
      expect: "obsoleto-candidato, con estado unknown",
      mustNotSay: "avería del tag, ni omitirlo del inventario",
    },
    {
      kind: "lectura-alta",
      tags: lecturaAlta,
      vehicles: [],
      expect: "uniforme-alto: nada que mirar",
      mustNotSay: "bimodal ni uniforme-bajo",
    },
    {
      kind: "lectura-media",
      tags: lecturaMedia,
      vehicles: [],
      expect: "uniforme-bajo o gradiente, apuntando al tag y no a un vehículo",
      mustNotSay: "señalar a vehículos concretos como responsables",
    },
    {
      kind: "omision-por-memoria",
      tags: porMemoria,
      vehicles: ciegos,
      expect: "bimodal-candidato, enumerando exactamente los vehículos que no lo leen",
      mustNotSay: "que el tag esté averiado: el resto de la flota lo lee sin problema",
    },
    {
      kind: "omision-conservando-convoy",
      tags: tramoConvoy,
      vehicles: [saltador],
      expect: "el paso se prueba por tiempo u orden; el tramo no se cuenta como fallo del tag",
      mustNotSay: "que esos tags fallen, ni que el vehículo se saliera del circuito",
    },
    {
      kind: "rotura-subita",
      tags: rotos,
      vehicles: [],
      atUtcMs: rotura,
      expect: "un cambio con su instante: se leía y dejó de leerse",
      mustNotSay: "una tasa media que mezcle el antes y el después como si fuera un régimen",
    },
    {
      kind: "degradacion-progresiva",
      tags: degradados,
      vehicles: [],
      atUtcMs: from,
      expect: "una tendencia a la baja a lo largo de la ventana",
      mustNotSay: "una tasa media estable que esconda que va a peor",
    },
    {
      kind: "mantenimiento-aislado",
      tags: mantenimiento,
      vehicles: [],
      expect: "fuera del anillo, enumerado aparte y sin clasificar (R-GRA-011)",
      mustNotSay: "contarlos como parte del circuito ni como tags fallados",
    },
  ];

  return {
    readingsCsv,
    listsCsv,
    defects,
    cleanTags: ring.filter((tag) => !plantados.has(tag)),
    declaredRing: ring,
    vehicles,
    fromUtcMs: from,
    toUtcMs: to,
  };
}
