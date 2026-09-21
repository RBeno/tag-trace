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
  | "mantenimiento-aislado"
  /** Carga online normal: entra, para media hora y sale. No es un silencio que explicar. */
  | "carga-online-normal"
  /** Una de las cinco calles por la que no entra ningún vehículo en toda la ventana. */
  | "calle-sin-servicio"
  /** Un vehículo al que le entran y le salen otros mientras él espera dentro (R-CO-003). */
  | "salida-fuera-de-antiguedad"
  /** Vehículos que ya estaban cargando cuando empezó la ventana (R-CO-007). */
  | "carga-anterior-a-la-ventana"
  /** La zona de vacíos declarada: contexto, no defecto. Declararla no puede cambiar veredictos. */
  | "zona-vacia-declarada";

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
  /** Listas de tags en el formato que el importador declara (`lista;tag;orden;funcion;grupo;…`). */
  readonly listsCsv: string;
  readonly defects: readonly PlantedDefect[];
  /** Tags sin nada plantado. Señalar uno de estos es un falso positivo. */
  readonly cleanTags: readonly string[];
  /** Todos los tags declarados en el circuito virtual, en orden. */
  readonly declaredRing: readonly string[];
  readonly vehicles: readonly string[];
  readonly fromUtcMs: number;
  readonly toUtcMs: number;
  /** Las cinco calles de carga, tal como la lista las declara. */
  readonly lanes: readonly {
    readonly laneId: string;
    readonly entry: string;
    readonly stop: string;
    readonly exit: string;
    readonly capacity: number;
  }[];
  /** Zona declarada de cada tag: `vacio` o `cargado`. */
  readonly zoneOf: ReadonlyMap<string, string>;
}

const RING_SIZE = 150;
const VEHICLES = 40;
const HOURS = 30;
/** Segundos entre dos tags consecutivos, antes de la variación aleatoria. */
const STEP_SECONDS = 12;
/** Cinco calles, que es lo que R-CO-001 fija para el fixture sintético. */
const LANES = 5;
/** Posición del anillo por la que se entra y se vuelve de las calles. Cae en la zona de vacíos. */
const LANE_JUNCTION = 25;
/**
 * Media hora de carga, que es la magnitud que dio el propietario.
 *
 * Vive aquí y no en `src/`: es una magnitud del escenario sintético, no una constante de planta
 * (AI_DEVELOPMENT_GOVERNANCE §4). El producto no la conoce ni la necesita — mide la mediana de cada
 * calle del propio dato.
 */
const CHARGE_MEAN_MS = 30 * 60_000;
/** Cada cuánto vuelve a tocarle cargar a un vehículo: dos cargas en la ventana de 30 h. */
const CHARGE_EVERY_MS = 11 * 3_600_000;

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

  // --- Calles de carga online (R-CO-001: cinco, y una sin servicio) --------------------------
  //
  // Los vehículos se reparten entre las **cuatro primeras**, así que en la quinta no entra nadie.
  // No es un descuido del reparto: es la clase plantada. Sus tres tags quedan a cero lecturas
  // estando perfectamente sanos, que es el caso en el que el producto tiene que preguntar por la
  // calle en vez de acusar al tag.
  const lanes = Array.from({ length: LANES }, (_, index) => ({
    laneId: `calle-${index + 1}`,
    entry: String(80_000 + index * 10 + 1),
    stop: String(80_000 + index * 10 + 2),
    exit: String(80_000 + index * 10 + 3),
    capacity: 2,
  }));
  const calleServida = (index: number) => lanes[index % (LANES - 1)] as (typeof lanes)[number];
  const calleMuerta = lanes[LANES - 1] as (typeof lanes)[number];

  /** Los cinco que ya estaban dentro cuando se abrió la ventana: su primera lectura es la salida. */
  const arranqueEnFrio = vehicles.slice(VEHICLES - 5);
  /** El que se queda dentro mientras otros de su misma calle entran y salen (R-CO-003). */
  const esperaDeMas = vehicles[12] as string;

  // --- Zonas (R-FLO-003: la carga online va dentro de la zona vacía) -------------------------
  //
  // Un tercio contiguo del anillo alrededor del empalme, más las quince tags de calle.
  const zoneOf = new Map<string, string>();
  const tercio = Math.floor(RING_SIZE / 3);
  const inicioVacio = LANE_JUNCTION - Math.floor(tercio / 2);
  ring.forEach((tag, index) => {
    const desde = (index - inicioVacio + RING_SIZE) % RING_SIZE;
    zoneOf.set(tag, desde < tercio ? "vacio" : "cargado");
  });
  for (const lane of lanes) {
    for (const tag of [lane.entry, lane.stop, lane.exit]) zoneOf.set(tag, "vacio");
  }

  const tasaAlta = new Map(lecturaAlta.map((tag, index) => [tag, 0.95 + (index % 6) * 0.01]));
  const tasaMedia = new Map(lecturaMedia.map((tag, index) => [tag, 0.2 + index * 0.078]));

  const from = Date.UTC(2026, 8, 14, 5, 0, 0);
  const to = from + HOURS * 3_600_000;
  const rotura = from + Math.floor((to - from) * 0.55);

  const filas: Array<{ t: number; v: string; tag: string }> = [];

  for (const [vehicleIndex, vehicle] of vehicles.entries()) {
    const esCiego = ciegos.includes(vehicle);
    const calle = calleServida(vehicleIndex);
    const enFrio = arranqueEnFrio.includes(vehicle);

    let position = enFrio ? LANE_JUNCTION : Math.floor(random() * RING_SIZE);
    let now = from + Math.floor(random() * 900_000);
    // El salto de convoy dura varias vueltas seguidas y después se recupera, para que el vehículo
    // conserve su sitio entre los mismos AGV en vez de descolgarse.
    let saltandoTramo = false;

    if (enFrio) {
      // Ya estaba cargando antes de que empezara la ventana, así que **no tiene ninguna lectura
      // previa**: lo primero que se ve de él es la salida de su calle. Es el caso que un análisis
      // ingenuo cuenta como ausencia, y que el propietario pide que se infiera.
      now = from + Math.floor(random() * 25 * 60_000);
      filas.push({ t: now, v: vehicle, tag: calle.exit });
      now += STEP_SECONDS * 1000;
    }

    // La primera carga se reparte a lo largo de la ventana para que las calles no se llenen todas
    // a la vez, y quien arranca dentro no vuelve a cargar hasta pasado el intervalo completo.
    let proximaCarga = now + Math.floor(random() * CHARGE_EVERY_MS) + (enFrio ? CHARGE_EVERY_MS : 0);
    let primeraCarga = true;

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

      if (position === LANE_JUNCTION && now >= proximaCarga && now < to) {
        // Entra a cargar: entrada, parada precisa, la espera, y la salida ya cargado.
        //
        // A uno de los vehículos se le alarga muchísimo la primera estancia. No se le fabrica el
        // hallazgo: simplemente se queda, y como sus compañeros de calle siguen entrando y
        // saliendo con normalidad, la violación de antigüedad **emerge del mismo reloj**.
        const espera =
          vehicle === esperaDeMas && primeraCarga
            ? 5 * 3_600_000
            : Math.round(CHARGE_MEAN_MS * (0.7 + random() * 0.6));
        filas.push({ t: now, v: vehicle, tag: calle.entry });
        now += 10_000;
        filas.push({ t: now, v: vehicle, tag: calle.stop });
        now += espera;
        filas.push({ t: now, v: vehicle, tag: calle.exit });
        now += 10_000;
        proximaCarga = now + CHARGE_EVERY_MS;
        primeraCarga = false;
      }
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

  // Las listas llevan ya las columnas de configuración: sin `funcion` y `grupo` una calle es un
  // conjunto de tres tags sin orden ni papeles, y R-CO-006 no se puede evaluar sobre eso.
  const listsCsv = ["lista;tag;orden;funcion;grupo;capacidad"]
    .concat(ring.map((tag, index) => `circuito;${tag};${index + 1};;;`))
    .concat(
      lanes.flatMap((lane) =>
        (
          [
            [lane.entry, 1, "entrada"],
            [lane.stop, 2, "parada-precisa"],
            [lane.exit, 3, "salida"],
          ] as const
        ).map(([tag, orden, funcion]) => `carga-online;${tag};${orden};${funcion};${lane.laneId};${lane.capacity}`),
      ),
    )
    .concat([...zoneOf].map(([tag, zona]) => `zona;${tag};;;${zona};`))
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
    {
      kind: "carga-online-normal",
      tags: lanes.slice(0, LANES - 1).flatMap((lane) => [lane.entry, lane.stop, lane.exit]),
      vehicles: [],
      expect:
        "la parada entre la parada precisa y la salida es una carga (R-CO-006), con la mediana " +
        "de cada calle rondando la media hora",
      mustNotSay: "contar esa media hora como periodo de inactividad ni como silencio",
    },
    {
      kind: "calle-sin-servicio",
      tags: [calleMuerta.entry, calleMuerta.stop, calleMuerta.exit],
      vehicles: [],
      expect: "la calle se enumera como no servida y sus tags salen `calle-sin-servicio`, unknown",
      mustNotSay: "que esos tres tags sean candidatos a obsoleto: nadie tuvo ocasión de leerlos",
    },
    {
      kind: "salida-fuera-de-antiguedad",
      tags: [],
      vehicles: [esperaDeMas],
      expect: "se enumera a quién se le saltó el turno y quién salió antes habiendo entrado después",
      mustNotSay: "llamarlo avería: R-FLO-001 admite excepciones y el dato no dice cuál es",
    },
    {
      kind: "carga-anterior-a-la-ventana",
      tags: [],
      vehicles: arranqueEnFrio,
      expect:
        "se infiere que estaban dentro antes de la cobertura (R-CO-007) y su calle no se declara " +
        "vacía durante esos primeros minutos",
      mustNotSay: "que esos vehículos estuvieran ausentes, ni que las calles estuvieran vacías",
    },
    {
      kind: "zona-vacia-declarada",
      tags: [],
      vehicles: [],
      expect: "la zona se enumera y las calles caen dentro de ella (R-FLO-003)",
      mustNotSay: "que declarar la zona cambie el veredicto de ningún tag sano",
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
    lanes,
    zoneOf,
  };
}
