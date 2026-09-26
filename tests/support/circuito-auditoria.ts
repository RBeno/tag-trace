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

import { wallClockToUtc } from "../../src/domain/time.js";

/** Zona declarada del escenario (`MANIFEST.md`): las fechas del CSV son hora local de Madrid. */
const ZONE = "Europe/Madrid";

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
  | "zona-vacia-declarada"
  /** Un AGV cuyo lector falla cada vez más en cualquier tag, no en uno concreto. */
  | "lector-agv-degradado"
  /** Un AGV que se demora en la zona cargada y el resto lo adelanta (R-FLO-001). */
  | "adelantamiento-en-zona-cargada"
  /** Un tag reparte sus salidas entre dos sucesores con cuota comparable (R-GRA-007). */
  | "bifurcacion-real"
  /** El ancla de vuelta declarada: contexto, no defecto. Declararla no cambia qué tags forman el anillo. */
  | "ancla-declarada"
  /** Un vehículo deja de leer un conjunto de tags a mitad de ventana; el resto los sigue leyendo. */
  | "memoria-actualizada-a-mitad-de-ventana"
  /** Un tag fuera de anillo no tiene ninguna lectura antes de la mitad y sí después. */
  | "tag-nuevo-a-mitad-de-ventana"
  /** Un tag desaparece y otro ocupa su mismo hueco en la secuencia, a partir del corte. */
  | "sustitucion-candidata"
  /** La mayoría de la flota ya lee el tag nuevo y un vehículo concreto no lo registra nunca. */
  | "memoria-no-actualizada"
  /** Dos ramas de una bifurcación que vuelven a coincidir en pocos saltos: un cruce físico. */
  | "cruce-real"
  /** Una espera larga y de poca varianza tras un tag: parada precisa. */
  | "parada-precisa-real"
  /** Una espera bimodal tras un tag: unas veces corta, otras larga. */
  | "semaforo-real"
  /** Función crítica declarada por la columna `funcion` del circuito virtual: contexto, no defecto. */
  | "vinculacion-declarada"
  /** Función crítica declarada por la lista `critico`, la vía de siempre: contexto, no defecto. */
  | "desvinculacion-declarada"
  /** Un AGV que lee dos tags en la mitad de sus pasadas y el resto de tags con normalidad. */
  | "lectura-desigual-en-pocos-tags"
  /** Toda la flota parada a la vez en tres franjas; ningún tag crítico leído (R-AGV-018). */
  | "parada-de-produccion"
  /** Un AGV parado mucho más de lo habitual, sin nadie parado delante y con la producción en marcha. */
  | "bloqueo-sin-justificar"
  /** De noche un tramo va más lento; la horquilla de producción no se entera (R-TIM-009). */
  | "noche-medida-aparte"
  /** Una sola parada de un minuto de más, sin nadie delante que lo retenga (R-FLO-007). */
  | "parada-sin-explicacion-aislada"
  /** Varios AGV paran sin explicación en el mismo sitio (R-FLO-009). */
  | "punto-conflictivo"
  /** Se forma cola detrás de un sitio que solo admite uno a la vez, y fluye (R-FLO-008). */
  | "cuello-de-botella"
  /** Un tramo donde falta información: tags que se saltan (R-GRA-014). */
  | "zona-oscura"
  /** Tras un hueco, varias lecturas llegan casi a la vez al servidor, con la suma normal (R-DAT-020). */
  | "entrega-agrupada"
  /** Contexto: la posición en tiempo de cada tag en cada fichero (R-TIM-011). */
  | "posicion-en-tiempo"
  /** Mantenimiento: tres tags seguidos cambiados a la vez, en su sitio (R-DAT-021). */
  | "tres-sustituidos-seguidos"
  /** Un tag nuevo entre dos que no cambia el recorrido (R-DAT-021). */
  | "insertado-misma-suma"
  | "ritmo-mas-lento-en-un-fichero"
  | "retiene-a-otros"
  /** Un tag fuera de la lista que solo se lee de noche; de día se pasa por su sitio sin leerlo (R-DAT-022). */
  | "tag-de-noche"
  /** La lista pone dos vecinos cambiados de sitio y otro lejos del suyo; las lecturas no cambian (R-GRA-015). */
  | "lista-con-otro-orden"
  /** La lista escribe un tag con un dígito cambiado; en su sitio se lee el de verdad (R-GRA-015). */
  | "lista-con-numero-mal-escrito"
  /**
   * Contexto: la limpieza de la lista junta lo que ya está plantado —los declarados que nadie lee, los
   * cambiados de orden y el refuerzo al que le falta un tag— sin plantar nada nuevo (R-GRA-017).
   */
  | "limpieza-de-la-lista"
  /**
   * Contexto: con una línea declarada, las tres paradas de la producción ya plantadas son paradas de
   * la línea con AGV esperando, y el pulmón se mide donde esperan (R-FLO-010).
   */
  | "linea-parada-con-pulmon"
  /**
   * Contexto: los vehículos que no tienen el 60 en memoria pasan por la línea sin leerlo, con la
   * cadencia normal: hacen la parada y no leen el tag (R-FLO-011).
   */
  | "linea-tag-sin-leer"
  /**
   * Contexto: la batería de mediciones del AGV que se demora y al que el resto adelanta dice que lo
   * adelantaron: no se movía en la guía (R-AGV-021).
   */
  | "bateria-del-bloqueo"
  /**
   * Contexto: el tiempo sin paso de la línea se mide contra su ciclo local, y el de las paradas de la
   * producción plantadas cuenta como línea parada con AGV esperando (R-FLO-010).
   */
  | "linea-tiempo-sin-paso"
  /** El mismo tag de noche, declarado en la lista `noche` de planta: explicado, sin comprobarlo. */
  | "tag-de-noche-declarado"
  /** Dos desvinculaciones seguidas en el circuito, una sin leerse nunca: la otra sostiene la función (R-GRA-016). */
  | "refuerzo-sin-lectura";

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
  /** El anillo físico, en el orden en que lo recorren los AGV: la verdad del escenario. */
  readonly physicalRing: readonly string[];
  /** La lista `circuito` tal como se escribe, con sus erratas plantadas (R-GRA-015). */
  readonly declaredList: readonly string[];
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
  /**
   * Corte entre el periodo temprano y el tardío, para la comparación entre dos periodos distantes
   * (R-DAT-016, Parte 33). No delimita una fuente real: la auditoría construye a mano la cobertura de
   * dos tramos a partir de este instante, igual que ya hace con la de `charging`.
   */
  readonly periodSplitUtcMs: number;
  /**
   * Las paradas de la producción plantadas (R-AGV-018, Parte 46): toda la flota congelada donde esté,
   * a la vez, y por tanto sin ninguna lectura en los tags críticos.
   */
  readonly productionStopsUtcMs: readonly { readonly fromUtcMs: number; readonly toUtcMs: number }[];
  /**
   * Lecturas que llegaron juntas (R-DAT-020, Parte 50): el instante real de la última lectura antes
   * de cada hueco plantado, una por ráfaga.
   */
  readonly groupedDeliveriesUtcMs: readonly number[];
  /**
   * Historial de flota (DS-012, Parte 39), en el formato que el importador declara. No cambia
   * ninguna lectura, así que la auditoría no cambia de resultado: los 40 vehículos asignados desde
   * antes de la ventana, uno asignado que no lee nunca (`fleetNeverRead`), uno que se da de baja a
   * mitad y sigue leyendo (`fleetLeavesMidway`), y una fila de otro circuito para el selector.
   */
  readonly fleetCsv: string;
  readonly fleetCircuit: string;
  readonly fleetNeverRead: string;
  readonly fleetLeavesMidway: string;
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
 * El instante UTC real de lo que `stamp()` va a escribir.
 *
 * El reloj interno del generador (`from`, `to`, `now`, `rotura`…) es un epoch UTC cualquiera, cómodo
 * para la simulación. Pero `stamp()` lo escribe como **dígitos**, y el escenario declara la zona
 * `Europe/Madrid` (`MANIFEST.md`): quien importe ese CSV con esa zona va a leer esos dígitos como
 * hora local de Madrid y convertirlos a UTC, **desplazándolos** por el huso horario del momento
 * (verano de 2026, CEST, UTC+2). Sin esta conversión, `fromUtcMs`/`toUtcMs`/`atUtcMs` prometen ser
 * «epoch UTC» y en realidad son el epoch de unos dígitos que, leídos por el propio producto, caen
 * dos horas antes — un desajuste que ninguna prueba relativa (proporciones, presencia de un campo)
 * llega a notar, pero que revienta en cuanto se compara un instante absoluto contra otro.
 */
export function toRealUtc(digitsUtcMs: number): number {
  const d = new Date(digitsUtcMs);
  return wallClockToUtc(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    },
    ZONE,
  ).utcMs;
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
  /**
   * Cruce (R-GRA-007, Parte 35): la rama que se desvía por `cruceRama` vuelve a coincidir con la
   * rama mayoritaria en `ring[121]` un salto después —el código no toca `position` al desviar, así
   * que el siguiente tag leído es siempre el mismo, tome o no el desvío—. Es la firma exacta de un
   * cruce físico de dos caminos que se abren y se cierran enseguida, no de una bifurcación que dure.
   */
  const cruceTag = ring[120] as string;
  /** Fuera del anillo declarado, numeración distinta de `mantenimiento` para distinguirla a simple vista. */
  const cruceRama = "96001";
  /**
   * Bifurcación sin reconvergencia (R-GRA-007, Parte 35): la rama minoritaria recorre una cadena de
   * seis tags fuera de anillo antes de reincorporarse a `ring[126]`. Seis saltos es más del doble de
   * `maxHopsToReconverge` (3), así que el paseo desde esta rama no alcanza nunca el territorio de la
   * mayoritaria dentro del margen: se queda como bifurcación, nunca como cruce.
   */
  const bifurcacionSinConvergerTag = ring[30] as string;
  const ramaLarga = ["95001", "95002", "95003", "95004", "95005", "95006"];
  /**
   * Parada precisa (R-GRA-007, Parte 35): todos los vehículos suman una espera fija tras leerlo, sin
   * `random()` adicional. El jitter propio del paso ya varía unos segundos; sumarle una constante
   * grande sube la media y dejar la desviación intacta baja el coeficiente de variación muy por
   * debajo del de un tránsito normal.
   */
  const paradaPrecisaTag = ring[70] as string;
  const PARADA_PRECISA_MS = 45_000;
  /**
   * Semáforo (R-GRA-007, Parte 35): un contador de pasadas por vehículo, determinista, marca una de
   * cada tres pasadas como «rojo» (espera larga); las otras dos quedan en tránsito normal («verde»).
   * Dos grupos claramente separados, cada uno compacto por separado.
   */
  const semaforoTag = ring[105] as string;
  const SEMAFORO_ROJO_MS = 90_000;
  /**
   * El tag inmediatamente siguiente a cada punto crítico de tiempo. La duración que se mide es
   * siempre «desde el punto crítico hasta la siguiente lectura de este vehículo»: basta con que esa
   * siguiente lectura concreta sea fiable para que la transición sea de un solo salto, sin importar
   * qué ocurra más adelante en el anillo (Parte 35, ver `enPuntoCriticoDeTiempo` más abajo).
   */
  const paradaPrecisaSiguienteTag = ring[71] as string;
  const semaforoSiguienteTag = ring[106] as string;
  /**
   * Vinculación y desvinculación (R-GRA-007, Parte 36): declaración pura, sin firma en el dato — el
   * mismo caso que `cambio-de-mapa`. Ninguno de los dos tags necesita ningún mecanismo nuevo en el
   * generador de lecturas: se leen con normalidad, y lo único que cambia es la declaración en
   * `listsCsv`, por las dos vías que ahora conviven. `vinculacionTag` se declara por la columna
   * `funcion` del propio circuito virtual (`circuito`); `desvinculacionTag`, por la lista `critico`
   * de siempre — para que el escenario ejercite las dos fuentes a la vez, no solo una.
   */
  const vinculacionTag = ring[15] as string;
  const desvinculacionTag = ring[65] as string;
  /**
   * Refuerzo (R-GRA-016, Parte 54): el tag siguiente a la desvinculación se declara con la misma
   * función y no se lee nunca. La desvinculación se sigue leyendo: es un refuerzo haciendo su
   * trabajo, con la función en pie y la redundancia perdida. Se apoya en un tag crítico que ya se
   * leía para no añadir lecturas críticas nuevas, que son la base de la parada de la producción
   * (R-AGV-018) y moverían las franjas de otras clases.
   */
  const refuerzoSinLectura = ring[66] as string;
  const refuerzoLeido = desvinculacionTag;
  /**
   * La línea (R-FLO-010, R-FLO-011): el 59 y el 60. Los vehículos «ciegos» no leen nunca el 60 (no lo
   * tienen en memoria, `omision-por-memoria`), así que pasan por la línea leyendo solo el 59: hacen la
   * parada, pero no leen el tag. Solo declaración: las lecturas no cambian.
   */
  const lineaPosicion = 59;
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
  /**
   * Su lector va fallando cada vez más en **cualquier** tag, no en uno concreto (R-OPP-015).
   *
   * Libre de cualquier otro papel a propósito: si arrastrara además `ciego` o `saltador`, la caída
   * de su propio lector se mezclaría con otra causa y dejaría de ser un caso limpio.
   */
  const lectorDegradado = vehicles[20] as string;
  /**
   * Excluir los dos puntos críticos de tiempo y su siguiente inmediato del efecto de este vehículo
   * (Parte 35, ver `enPuntoCriticoDeTiempo` más abajo) resta margen a la caída medida entre el
   * primer y el último tramo -esas lecturas, siempre garantizadas para él, ya no declinan con
   * `avance`-. Con el coeficiente original de la Parte 28 (0,7) la caída real quedaba justo por
   * debajo de `minGradientDrop` (0,3). Este valor la devuelve por encima con margen, calibrado para
   * no acercarse tampoco a una rotura de un solo corte (`minRateDrop` es 0,5) ni bajar tanto el
   * suelo de lectura que algún tag aislado, de por sí con pocas pasadas en la mitad tardía, acabe
   * con cero lecturas de este vehículo por puro azar -eso lo contaría `drift.ts` como una deriva de
   * memoria que nadie plantó-.
   */
  const LECTOR_DEGRADADO_COEFICIENTE = 0.74;
  /**
   * Se demora una sola vez al entrar en la zona cargada y el resto de la flota lo adelanta con su
   * propio reloj (R-FLO-001). Libre de cualquier otro papel por la misma razón que `lectorDegradado`:
   * si arrastrara otro defecto, el adelantamiento se mezclaría con otra causa.
   */
  const elAdelantado = vehicles[13] as string;
  /**
   * Libre de cualquier otro papel: deja de leer un tramo de tags que sí leía, a partir de la mitad de
   * la ventana, mientras el resto de la flota los sigue leyendo con normalidad (R-AGV-013).
   */
  const memoriaActualizada = vehicles[25] as string;
  /** El tramo de cinco tags contiguos que `memoriaActualizada` deja de leer a partir de la mitad. */
  const tagsDejados = ring.slice(140, 145) as string[];
  /** Fuera de anillo: no tiene ninguna lectura antes de la mitad de la ventana y sí después (R-DAT-016). */
  const tagNuevo = "98001";
  /**
   * Sustitución candidata (R-DAT-017): a partir del corte, `sustitucionOriginal` deja de leerse por
   * completo —igual mecanismo que `rotos`— y `sustitucionNueva` ocupa su mismo hueco en la secuencia
   * —igual mecanismo que `tagNuevo`—, con el mismo predecesor y el mismo sucesor a cada lado. Es la
   * firma posicional que R-DAT-017 correlaciona, construida sin ambigüedad a propósito.
   */
  const sustitucionPosicion = 146;
  const sustitucionOriginal = ring[sustitucionPosicion] as string;
  const sustitucionNueva = "99001";
  /**
   * Libre de cualquier otro papel: no se ha actualizado con el resto de la flota, así que no lee
   * `sustitucionNueva` ni una sola vez, aunque la gran mayoría ya la detecta (R-AGV-013 ampliada).
   */
  const memoriaNoActualizada = vehicles[30] as string;
  /**
   * Un AGV que lee dos tags concretos en la mitad de sus pasadas, y todos los demás con normalidad
   * (Parte 43, R-AGV-016). Uno sí y uno no, con un contador por tag y **sin `random()`**, en dos tags
   * sin otro papel que no consumen sorteo: así no mueve la cascada compartida entre vehículos.
   */
  const lecturaDesigual = vehicles[9] as string;
  const tagsDesiguales = [ring[80], ring[81]] as string[];
  const pasesDesiguales = new Map<string, number>();

  // --- Estado normal del circuito (Parte 47, R-TIM-009) ---------------------------------------
  //
  // Todo con la deuda de reloj de la Parte 35 (`debtMs`): el tiempo que se añade se devuelve en los
  // pasos siguientes sin dejar de sortear el jitter, así que ni cambia cuántas veces se llama a
  // `random()` ni el reloj total de cada vehículo.
  /**
   * De noche, cuatro tramos seguidos van más lentos: 45 s de más en cada uno, en cada pasada. La
   * horquilla de producción de esos tramos no tiene que enterarse, y la de noche tiene que medirlo.
   */
  const nocheLenta = [54, 55, 56, 57];
  const NOCHE_EXTRA_MS = 45_000;
  /**
   * La deuda de la noche se devuelve a un segundo por paso, no a medio paso: devolverla deprisa
   * dejaría media vuelta de noche con pasos de la mitad, y esa horquilla aplastada convertiría en
   * parada a cualquier AGV que fuera a su ritmo. A un segundo por paso, ningún tramo se acorta más de
   * un 6 %, y lo que quede al amanecer se devuelve igual de despacio.
   */
  const NOCHE_DEVOLUCION_MS = 1_000;
  /** Una parada de un minuto de más, una sola vez, de un AGV sin otro papel (el ejemplo del propietario). */
  const paradaAislada = { vehicle: vehicles[1] as string, position: 86, extraMs: 63_000 };
  /** Ocho AGV sin otro papel paran sin explicación en el mismo sitio, dos veces cada uno. */
  const conflicto = [2, 4, 6, 11, 14, 15, 18, 19].map((index) => vehicles[index] as string);
  const conflictoPosiciones = [72, 73];
  const CONFLICTO_EXTRA_MS = 70_000;
  /** Un sitio que solo admite un AGV a la vez, durante hora y media: se forma cola y fluye. */
  const cuelloPosicion = 116;
  const CUELLO_ESPERA_MS = 40_000;
  const ocupacionCuello: { from: number; to: number }[] = [];
  /**
   * Quién retiene a otros (Parte 50, R-AGV-020): un AGV sin otro papel se queda en el semáforo más que
   * nadie, en cada pasada de día, y los que llegan detrás —ya lo tenían delante al leer el tag de
   * antes— esperan a que salga. Su espera cabe en la horquilla del semáforo, así que él no para: retiene.
   * Con la deuda de reloj, sin `random()`. El lector degradado no espera, por lo mismo que en el cuello.
   */
  const retenedor = vehicles[7] as string;
  const RETENEDOR_ESPERA_MS = 105_000;
  const semaforoPosicion = 105;
  const ocupacionRetenedor: { from: number; to: number }[] = [];

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
  /**
   * Corte entre el periodo temprano y el tardío para la comparación entre dos periodos distantes
   * (R-DAT-016). No es una segunda fuente real: la auditoría construye la cobertura de dos tramos a
   * mano a partir de este mismo instante (Parte 33), igual que ya hace con la cobertura de `charging`.
   *
   * Coincide **a propósito** con `rotura`: si el corte cayera antes, la ventana tardía arrancaría
   * todavía dentro del tramo en que los tags rotos se siguen leyendo con normalidad, y no saldrían
   * `desaparecido` sino con lecturas en los dos periodos. Con el mismo instante, el margen de la
   * comparación (`driftBuffer` en la auditoría) queda centrado justo en la rotura y la deja entera
   * dentro del hueco entre periodos, a un lado o al otro.
   */
  const periodSplit = rotura;
  const PARADA_PRODUCCION_MS = 15 * 60_000;
  /** Inicio de cada franja en el reloj **final** (10:00 y 18:00 del día 1, 10:00 del día 2). */
  const franjas = [5, 13, 29].map((horas) => from + horas * 3_600_000);
  /** El mismo inicio en el reloj con que se generó, antes de desplazar las franjas anteriores. */
  const franjasOriginales = franjas.map((inicio, index) => inicio - index * PARADA_PRODUCCION_MS);
  const congelar = (t: number): number =>
    t + PARADA_PRODUCCION_MS * franjasOriginales.filter((inicio) => t >= inicio).length;
  /**
   * Horas de la Parte 47 en el reloj con que se genera. La noche (22:00–05:00 en el reloj final) cae
   * después de dos franjas congeladas, así que en el de generación empieza media hora antes.
   */
  const HORA = 3_600_000;
  const nocheDesde = from + 16.5 * HORA + 10 * 60_000;
  const nocheHasta = from + 23.5 * HORA - 10 * 60_000;
  const paradaAisladaDesde = from + 9 * HORA;
  const conflictoDesde = [from + 2 * HORA, from + 7 * HORA];
  /** De 19:30 a 21:00 en el reloj final: de día, lejos de las paradas y antes de la noche. */
  const cuelloDesde = from + 14 * HORA;
  const cuelloHasta = from + 15.5 * HORA;

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
    // Solo la primera pasada de `elAdelantado` por la zona cargada se demora: una vez basta para que
    // el resto de la flota lo adelante, y repetirlo en cada vuelta dejaría de ser un caso limpio.
    let primerPaseCargado = true;
    // Contadores deterministas de pasadas para la bifurcación sin reconvergencia y el semáforo
    // (Parte 35): sin `random()`, para no arriesgar la cascada compartida entre vehículos.
    let bifurcacionSinConvergerPases = 0;
    let semaforoPases = 0;
    /**
     * Deuda de reloj (Parte 35). Las tres paradas sintéticas de esta parte (precisa, semáforo,
     * cadena sin reconvergencia) tienen que añadir minutos reales para que la duración se vea en el
     * dato — no hay atajo ahí. Pero sin devolver ese tiempo, cada vehículo completaría menos vueltas
     * en las mismas 30 h, y eso desplaza cuántas veces llama a `random()` antes de ceder el turno al
     * siguiente vehículo: la misma fragilidad de cascada ya diagnosticada en las Partes 30, 31 y 33,
     * aquí por una vía distinta —no son sorteos de más, es reloj de más—. Se devuelve descontando el
     * mismo tiempo del avance normal de los pasos siguientes, sin dejar nunca de sortear el jitter
     * -mismo número de llamadas a `random()`, en el mismo orden, con o sin deuda-, así que el total
     * transcurrido por vehículo en toda la ventana no cambia.
     */
    let debtMs = 0;
    let debtNocheMs = 0;
    // Parte 47: cada plantación ocurre una vez por vehículo y posición.
    const conflictoHecho = new Set<number>();
    let paradaAisladaHecha = false;
    let entradaCuello: number | null = null;
    let ultimaLectura = -Infinity;

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
      else if (vehicle === memoriaActualizada && tagsDejados.includes(tag) && now >= periodSplit) {
        lee = false;
      } else if (tag === sustitucionOriginal && now >= periodSplit) lee = false;
      else if (vehicle === lecturaDesigual && tagsDesiguales.includes(tag)) {
        const pase = pasesDesiguales.get(tag) ?? 0;
        pasesDesiguales.set(tag, pase + 1);
        lee = pase % 2 === 0;
      }

      // Se aplica **después** de las reglas del tag, nunca en su lugar: el lector degradado sigue
      // sin leer lo que nadie lee, y encima cada vez menos de lo que sí se lee, en cualquier tag...
      // salvo en los tags de punto crítico de tiempo (parada precisa y semáforo, Parte 35) **y su
      // siguiente inmediato**. Su señal exige duraciones limpias, y un salto de varias posiciones por
      // una lectura fallida no solo pierde esa lectura -lo que ya se prueba en otros tags-, sino que
      // fusiona el tránsito de dos o más tramos en una sola transición de duración intermedia,
      // exactamente entre los dos grupos que el semáforo necesita separar. Excluir solo el propio tag
      // crítico no basta: la duración medida es «hasta la siguiente lectura de este vehículo», así
      // que si esa siguiente lectura (el tag inmediatamente posterior) se pierde, la transición sigue
      // fusionándose igual, ahora un tramo más allá. Con el siguiente también garantizado, la
      // transición desde el punto crítico es siempre de un solo salto, sea cual sea el destino
      // posterior de la degradación. El resultado no era un hallazgo del lector degradado: era ruido
      // topológico sobre la firma de otro punto crítico, indistinguible de una tercera clase que
      // nadie plantó. Se mantiene la degradación en el resto del anillo, que es donde este defecto sí
      // debe verse.
      //
      // El sorteo se hace siempre que `lee && vehicle === lectorDegradado`, en el mismo orden que
      // antes de esta exclusión -nunca condicionado al tag-, para no desplazar cuántas llamadas a
      // `random()` consume este vehículo frente a la línea base (la misma fragilidad de cascada de
      // las Partes 30/31/33, aquí por omitir un sorteo en vez de añadir uno de más). Solo se descarta
      // el resultado cuando el tag es un punto crítico de tiempo o su siguiente inmediato.
      const enPuntoCriticoDeTiempo =
        tag === paradaPrecisaTag ||
        tag === semaforoTag ||
        tag === paradaPrecisaSiguienteTag ||
        tag === semaforoSiguienteTag;
      if (lee && vehicle === lectorDegradado) {
        const roll = random() < 1 - LECTOR_DEGRADADO_COEFICIENTE * avance;
        if (!enPuntoCriticoDeTiempo) lee = roll;
      }

      // Cuello de botella (Parte 47, R-FLO-008): quien llega mientras otro ocupa el sitio espera a
      // que salga. Solo se conocen los vehículos ya generados, así que la cola se forma detrás de la
      // mitad de ellos: basta para que se vea, y nunca se fabrica una espera que el reloj no pida.
      //
      // Se espera a **un** ocupante, no a una cadena: generando un vehículo detrás de otro, el último
      // vería ocupado el sitio por los 39 anteriores y esperaría minutos, que ya no es una cola que
      // fluye. El lector degradado queda fuera: su tendencia se mide sobre pasadas probadas por
      // tiempo, y devolver la deuda con pasos cortos le quitaría justo esas pruebas.
      const enVentanaCuello = now >= cuelloDesde && now < cuelloHasta && vehicle !== lectorDegradado;
      if (position === cuelloPosicion && enVentanaCuello) {
        const ocupado = ocupacionCuello.find((entry) => entry.from <= now && now < entry.to);
        if (ocupado !== undefined) {
          const extra = ocupado.to + 2_000 - now;
          now += extra;
          debtMs += extra;
        }
      }
      if (position === cuelloPosicion + 1 && entradaCuello !== null) {
        ocupacionCuello.push({ from: entradaCuello, to: now });
        entradaCuello = null;
      }

      // Detrás del que retiene en el semáforo: solo quien ya lo tenía delante al leer el tag anterior.
      if (position === semaforoPosicion && vehicle !== retenedor && vehicle !== lectorDegradado) {
        const ocupado = ocupacionRetenedor.find((entry) => entry.from <= ultimaLectura && now < entry.to);
        if (ocupado !== undefined) {
          const extra = ocupado.to + 2_000 - now;
          now += extra;
          debtMs += extra;
        }
      }

      // El refuerzo que no se lee (Parte 54) se calla aquí, al final, y no arriba con los nunca leídos:
      // así consume los mismos sorteos que antes y no desplaza la secuencia de ningún vehículo.
      if (tag === refuerzoSinLectura) lee = false;

      if (lee) {
        filas.push({ t: now, v: vehicle, tag });
        ultimaLectura = now;
      }

      if (position === cuelloPosicion && enVentanaCuello) {
        entradaCuello = now;
        now += CUELLO_ESPERA_MS;
        debtMs += CUELLO_ESPERA_MS;
      }

      // Justo tras entrar en el tramo cargado (posición 50 es la entrada; aquí, la siguiente), se
      // demora 20 min: muy por encima de la desviación típica del tránsito por jitter de lectura
      // (segundos), y de sobra para que otros vehículos, entrando después, lo adelanten sin ayuda.
      if (position === 51 && vehicle === elAdelantado && primerPaseCargado) {
        now += 20 * 60_000;
        primerPaseCargado = false;
      }

      // Cruce (R-GRA-007, Parte 35): al 42 % de las pasadas por esta posición, el vehículo se desvía
      // por un tag fuera de anillo antes de reincorporarse en `ring[121]` — el mismo tag al que
      // llega la rama mayoritaria, porque el código nunca toca `position` al desviar. Dos caminos
      // que se abren y se cierran enseguida: un cruce, no una bifurcación que dure. No es un defecto
      // de un vehículo concreto, así que no depende de `vehicle`. El 42 % y no el 50 %: con semilla
      // fija, un reparto exacto podría voltear cuál de los dos tags queda en el ciclo dominante de
      // `findDominantCycle`, que usa `>` estricto.
      if (position === 120 && random() < 0.42) {
        now += (STEP_SECONDS + Math.floor(random() * 9)) * 1000;
        filas.push({ t: now, v: vehicle, tag: cruceRama });
      }

      // Bifurcación sin reconvergencia (R-GRA-007, Parte 35): 2 de cada 5 pasadas (40 %),
      // determinista por vehículo, desvían por una cadena de seis tags fuera de anillo antes de
      // reincorporarse con normalidad. Seis saltos superan `maxHopsToReconverge`, así que esta rama
      // nunca reconverge dentro del margen: se queda como bifurcación, nunca como cruce.
      //
      // Ninguna de las tres deudas nuevas se abre si no queda margen de sobra para devolverla antes
      // de que la ventana termine: sin esto, el último tramo de cada vehículo podría cerrar el
      // `while` con deuda pendiente, que es exactamente el resto de tiempo que desplazaría cuántas
      // llamadas a `random()` consume ese vehículo frente a la línea base. Veinte minutos son muchas
      // veces más que lo que cualquiera de las tres tarda en devolverse a este ritmo.
      //
      // Y las tres posiciones (30, 70, 105) están deliberadamente lejos entre sí, no contiguas: con
      // el tope al 50 % del avance nominal, devolver una deuda de 45-90 s tarda del orden de 5-9
      // pasos. Probado primero con las tres muy juntas (125, 128, 133): la deuda de una nunca llegaba
      // a cero antes de que la siguiente añadiera más, así que quedaba flotando permanentemente y
      // contaminaba la duración medida del tramo intermedio —apareció como candidato a semáforo
      // espurio en un tag completamente ajeno a esta parte—. Con 35-40 pasos de margen entre cada
      // una, la deuda siempre llega a cero mucho antes de la siguiente.
      const margenSuficiente = to - now > 20 * 60_000;

      // Noche más lenta (Parte 47): solo con la transición entera dentro de la noche, con diez
      // minutos de margen a cada lado, para que ni una muestra lenta caiga en la horquilla de producción.
      if (margenSuficiente && nocheLenta.includes(position) && now >= nocheDesde && now < nocheHasta) {
        now += NOCHE_EXTRA_MS;
        debtNocheMs += NOCHE_EXTRA_MS;
      }
      // Parada aislada (Parte 47): la primera pasada por su sitio pasada la hora fijada.
      if (
        margenSuficiente &&
        vehicle === paradaAislada.vehicle &&
        position === paradaAislada.position &&
        !paradaAisladaHecha &&
        now >= paradaAisladaDesde
      ) {
        now += paradaAislada.extraMs;
        debtMs += paradaAislada.extraMs;
        paradaAisladaHecha = true;
      }
      // Punto conflictivo (Parte 47): cada uno de los ocho, una vez en cada posición, a horas de día
      // lejos de las paradas de la producción.
      const conflictoHora = conflictoPosiciones.indexOf(position);
      if (
        margenSuficiente &&
        conflictoHora >= 0 &&
        conflicto.includes(vehicle) &&
        !conflictoHecho.has(position) &&
        now >= (conflictoDesde[conflictoHora] as number)
      ) {
        now += CONFLICTO_EXTRA_MS;
        debtMs += CONFLICTO_EXTRA_MS;
        conflictoHecho.add(position);
      }

      if (margenSuficiente && position === 30) {
        bifurcacionSinConvergerPases += 1;
        if (bifurcacionSinConvergerPases % 5 < 2) {
          for (const ramaTag of ramaLarga) {
            now += STEP_SECONDS * 1000;
            debtMs += STEP_SECONDS * 1000;
            filas.push({ t: now, v: vehicle, tag: ramaTag });
          }
        }
      }

      // Parada precisa (R-GRA-007, Parte 35): espera fija tras leer el tag, para todos los
      // vehículos y sin `random()` adicional. El jitter propio del paso ya varía unos segundos;
      // sumarle una constante grande sube la media sin tocar la desviación, así que el coeficiente
      // de variación baja muy por debajo del de un tránsito normal. El lector degradado no toca este
      // tag (exclusión ya aplicada arriba, en `enPuntoCriticoDeTiempo`), así que todas las pasadas
      // están garantizadas de un solo salto.
      if (margenSuficiente && position === 70) {
        now += PARADA_PRECISA_MS;
        debtMs += PARADA_PRECISA_MS;
      }

      // Semáforo (R-GRA-007, Parte 35): contador determinista de pasadas por vehículo, sin
      // `random()`. Una de cada tres pasadas es «rojo» (espera larga); las otras dos son «verde»
      // (tránsito normal). Dos grupos claramente separados y compactos por separado. Mismo motivo de
      // exclusión del lector degradado que la parada precisa: un salto de varias posiciones aquí
      // fragmentaría justo el salto bimodal que este tag necesita mostrar.
      const deDia = now < nocheDesde - 20 * 60_000 || now >= nocheHasta + 20 * 60_000;
      if (margenSuficiente && position === semaforoPosicion && vehicle === retenedor && deDia) {
        semaforoPases += 1;
        ocupacionRetenedor.push({ from: now, to: now + RETENEDOR_ESPERA_MS });
        now += RETENEDOR_ESPERA_MS;
        debtMs += RETENEDOR_ESPERA_MS;
      } else if (margenSuficiente && position === semaforoPosicion) {
        semaforoPases += 1;
        if (semaforoPases % 3 === 0) {
          now += SEMAFORO_ROJO_MS;
          debtMs += SEMAFORO_ROJO_MS;
        }
      }

      // Tag nuevo a mitad de ventana (R-DAT-016): a partir del corte, cualquier vehículo que pase
      // por esta posición también lee el tag nuevo justo después — sin depender de un vehículo
      // concreto, como una instalación o sustitución real y no un defecto de uno solo.
      //
      // Sin jitter aleatorio a propósito: a diferencia de la bifurcación (que ya consumía random()
      // desde la Parte 31), esta inyección se dispara para los 40 vehículos en toda la mitad tardía
      // de la ventana. Un `random()` extra ahí desplaza el estado compartido de todos los vehículos
      // que se procesan después — la misma fragilidad de cascada ya diagnosticada en las Partes 30 y
      // 31 —, y llegó a borrar la tendencia de `lectorAgvDegradado` (vehículo 20) al correrlo. El paso
      // sigue siendo determinista y de igual duración que el resto.
      if (position === 135 && now >= periodSplit) {
        now += STEP_SECONDS * 1000;
        filas.push({ t: now, v: vehicle, tag: tagNuevo });
      }

      // Sustitución candidata (R-DAT-017): tras el corte, justo donde `sustitucionOriginal` dejó de
      // leerse (arriba), aparece `sustitucionNueva` en el mismo hueco de la secuencia -mismo
      // predecesor y mismo sucesor-, salvo para `memoriaNoActualizada`, que no se ha actualizado y
      // no la lee nunca (memoria no actualizada, R-AGV-013 ampliada). Sin `random()` adicional, por
      // la misma razón que la inyección de `tagNuevo`: un sorteo extra aquí desplazaría el estado
      // compartido de todos los vehículos procesados después (Partes 30, 31 y 33).
      if (position === sustitucionPosicion && now >= periodSplit && vehicle !== memoriaNoActualizada) {
        now += STEP_SECONDS * 1000;
        filas.push({ t: now, v: vehicle, tag: sustitucionNueva });
      }

      // El avance normal del paso siempre sortea el jitter, con o sin deuda pendiente, para no
      // desplazar cuántas llamadas a `random()` consume este vehículo. Con deuda, ese avance se
      // descuenta (nunca por debajo de cero) en vez de sumarse, hasta devolver lo añadido arriba.
      //
      // El descuento se limita a la mitad del avance nominal, nunca a su totalidad: si `now` se
      // quedara exactamente igual dos pasos seguidos, esas dos lecturas del mismo vehículo caerían
      // en el mismo instante, y R-DAT-013 dice que un empate así no ordena nada — el importador
      // reconstruiría la sucesión en cualquiera de las dos direcciones, fabricando justo el ruido
      // topológico que este mecanismo debía evitar. Con el tope a la mitad, `now` avanza siempre
      // algo, la deuda se devuelve en un puñado de pasos más en vez de en uno solo, y no se inventa
      // ningún instante repetido.
      const jitterRoll = Math.floor(random() * 9);
      const nominal = (STEP_SECONDS + jitterRoll) * 1000;
      const payback = Math.min(debtMs, Math.floor(nominal / 2));
      debtMs -= payback;
      const paybackNoche = Math.min(debtNocheMs, NOCHE_DEVOLUCION_MS, Math.floor(nominal / 2) - payback);
      debtNocheMs -= paybackNoche;
      now += nominal - payback - paybackNoche;
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
  //
  // Aisladas de verdad: si el instante al azar cae dentro de una estancia de carga del mismo
  // vehículo, se vuelve a sortear. Sin esto, una lectura de mantenimiento puede interponerse entre
  // la parada precisa y la salida de una calle por pura coincidencia, y la estancia deja de
  // reconocerse como carga — no porque el detector falle, sino porque el escenario mezcló sin
  // querer dos clases plantadas que se declaran independientes.
  const laneTagsAll = new Set(lanes.flatMap((lane) => [lane.entry, lane.stop, lane.exit]));
  const chargingWindowsByVehicle = new Map<string, Array<readonly [number, number]>>();
  for (const vehicle of vehicles) {
    const hits = filas
      .filter((fila) => fila.v === vehicle && laneTagsAll.has(fila.tag))
      .sort((a, b) => a.t - b.t);
    const windows: Array<readonly [number, number]> = [];
    let openAt: number | null = null;
    for (const hit of hits) {
      if (lanes.some((lane) => lane.entry === hit.tag)) {
        openAt = hit.t;
      } else if (lanes.some((lane) => lane.exit === hit.tag) && openAt !== null) {
        windows.push([openAt, hit.t]);
        openAt = null;
      }
    }
    chargingWindowsByVehicle.set(vehicle, windows);
  }

  for (let index = 0; index < 14; index += 1) {
    const vehicle = vehicles[index % 4] as string;
    const windows = chargingWindowsByVehicle.get(vehicle) ?? [];
    let t: number;
    do {
      t = from + Math.floor(random() * (to - from));
    } while (windows.some(([start, end]) => t >= start && t <= end));
    filas.push({ t, v: vehicle, tag: mantenimiento[index % mantenimiento.length] as string });
  }

  // Paradas de la producción (Parte 46, R-AGV-018): la flota entera se congela donde esté durante
  // 15 min a las 10:00 y a las 18:00 del primer día y a las 10:00 del segundo, las franjas de descanso
  // que el propietario describe. Se hace **después** de generar, desplazando cada fila posterior a
  // una franja: ni una llamada más a `random()` (sin cascada), el orden relativo de todos se conserva,
  // y los tags críticos declarados se quedan sin lecturas en la franja. Lo que pasa de `to` se
  // descarta. La verdad plantada con instante (`rotura`, `periodSplit`) pasa por la misma función.
  // Con un bucle y no con `splice(…, ...congeladas)`: doscientos mil argumentos desbordan la pila.
  // Un AGV más lento en el segundo fichero (Parte 50, R-AGV-019): desde la mañana del segundo día, ya
  // pasada la noche, sus lecturas se estiran un 10 % respecto a esa hora, antes de congelar. Después de
  // generar, sin `random()`, y donde ninguna otra plantación depende de su reloj: el corte, la rotura,
  // el tag nuevo, la noche lenta y el cuello quedan antes.
  const ritmoLento = vehicles[22] as string;
  const RITMO_LENTO = 1.1;
  const lentoDesde = from + 23.5 * HORA + 10 * 60_000;
  for (let index = 0; index < filas.length; index += 1) {
    const fila = filas[index] as (typeof filas)[number];
    if (fila.v === ritmoLento && fila.t > lentoDesde) {
      filas[index] = { ...fila, t: lentoDesde + Math.round(((fila.t - lentoDesde) * RITMO_LENTO) / 1000) * 1000 };
    }
  }

  let quedan = 0;
  for (const fila of filas) {
    const t = congelar(fila.t);
    if (t <= to) filas[quedan++] = { ...fila, t };
  }
  filas.length = quedan;

  // Lecturas que llegaron juntas al servidor (Parte 50, R-DAT-020): cuatro veces, de día, tres lecturas
  // de un AGV sin otro papel se reciben en los tres segundos antes de la siguiente, como un volcado
  // tras perder la comunicación. Se hace **después** de generar y de congelar, moviendo solo la hora de
  // esas tres filas: ni una llamada más a `random()`, y el recorrido entero, del tag de antes del hueco
  // al último, tarda exactamente lo mismo. Fuera de las ráfagas quedan las calles, las ramas y los
  // puntos críticos de tiempo, cuyas esperas son de otra clase plantada.
  const entregaAgrupada = vehicles[21] as string;
  const entregaDesde = [3, 8, 11, 26].map((horas) => from + horas * HORA);
  const fueraDeRafaga = new Set([30, 70, 71, 105, 106, 116, 117, 120].map((index) => ring[index] as string));
  const posicionDe = new Map(ring.map((tag, index) => [tag, index]));
  const propias = filas
    .map((fila, index) => ({ fila, index }))
    .filter((entry) => entry.fila.v === entregaAgrupada)
    .sort((a, b) => a.fila.t - b.fila.t);
  const entregasPlantadas: number[] = [];
  for (const desde of entregaDesde) {
    for (let k = 0; k + 4 < propias.length; k += 1) {
      const tramo = propias.slice(k, k + 5);
      const primera = tramo[0] as (typeof propias)[number];
      const ultima = tramo[4] as (typeof propias)[number];
      if (primera.fila.t < desde) continue;
      const posiciones = tramo.map((entry) => posicionDe.get(entry.fila.tag));
      const seguidas = posiciones.every(
        (posicion, i) =>
          posicion !== undefined &&
          !fueraDeRafaga.has((tramo[i] as (typeof propias)[number]).fila.tag) &&
          (i === 0 || posicion === ((posiciones[i - 1] as number) + 1) % RING_SIZE),
      );
      if (!seguidas || ultima.fila.t - primera.fila.t >= 2 * 60_000) continue;
      for (const [offset, entry] of tramo.slice(1, 4).entries()) {
        filas[entry.index] = { ...entry.fila, t: ultima.fila.t - (3 - offset) * 1000 };
      }
      entregasPlantadas.push(primera.fila.t);
      break;
    }
  }

  // Mantenimiento a mitad de ventana (Parte 50, R-DAT-021), después de generar y de congelar, sin
  // `random()`. Tres tags seguidos se cambian a la vez: desde el corte, sus lecturas llevan el nombre
  // del nuevo, en el mismo instante. Y un tag nuevo aparece entre dos, en el punto medio de cada paso,
  // sin mover el reloj: el recorrido entre los dos tarda lo mismo.
  const corte = congelar(periodSplit);
  const bloqueViejo = [96, 97, 98].map((index) => ring[index] as string);
  const bloqueNuevo = ["97001", "97002", "97003"];
  for (let index = 0; index < filas.length; index += 1) {
    const fila = filas[index] as (typeof filas)[number];
    const at = bloqueViejo.indexOf(fila.tag);
    if (at >= 0 && fila.t >= corte) filas[index] = { ...fila, tag: bloqueNuevo[at] as string };
  }
  const antesDelNuevo = ring[36] as string;
  const despuesDelNuevo = ring[37] as string;
  const tagInsertado = "97101";
  const porVehiculo = new Map<string, (typeof filas)[number][]>();
  for (const fila of filas) porVehiculo.set(fila.v, [...(porVehiculo.get(fila.v) ?? []), fila]);
  const insertadas: (typeof filas)[number][] = [];
  for (const [vehicle, propias] of porVehiculo) {
    propias.sort((a, b) => a.t - b.t);
    for (let index = 1; index < propias.length; index += 1) {
      const a = propias[index - 1] as (typeof filas)[number];
      const b = propias[index] as (typeof filas)[number];
      if (a.tag !== antesDelNuevo || b.tag !== despuesDelNuevo || a.t < corte || b.t - a.t < 4_000) continue;
      insertadas.push({ t: Math.floor((a.t + b.t) / 2000) * 1000, v: vehicle, tag: tagInsertado });
    }
  }
  filas.push(...insertadas);

  // Un tag de noche (Parte 52, R-DAT-022), después de generar y de congelar, sin `random()`: entre dos
  // tags del anillo, solo de 22:00 a 05:00 (la hora de los dígitos es la hora local), en el punto medio
  // de cada paso. De día se sigue pasando por ahí sin leerlo. No está en ninguna lista.
  const antesDeNoche = ring[84] as string;
  const despuesDeNoche = ring[85] as string;
  const tagDeNoche = "97201";
  const deNoche = (t: number): boolean => new Date(t).getUTCHours() >= 22 || new Date(t).getUTCHours() < 5;
  const nocturnas: (typeof filas)[number][] = [];
  for (const [vehicle, propias] of porVehiculo) {
    for (let index = 1; index < propias.length; index += 1) {
      const a = propias[index - 1] as (typeof filas)[number];
      const b = propias[index] as (typeof filas)[number];
      if (a.tag !== antesDeNoche || b.tag !== despuesDeNoche || !deNoche(a.t) || b.t - a.t < 4_000) continue;
      nocturnas.push({ t: Math.floor((a.t + b.t) / 2000) * 1000, v: vehicle, tag: tagDeNoche });
    }
  }
  filas.push(...nocturnas);

  filas.sort((a, b) => b.t - a.t); // Pila: lo más reciente primero, como la fuente real.

  const readingsCsv = ["Fecha;AGV;Tag"]
    .concat(filas.map((fila) => `${stamp(fila.t)};${fila.v};${fila.tag}`))
    .join("\r\n");

  // Las listas llevan ya las columnas de configuración: sin `funcion` y `grupo` una calle es un
  // conjunto de tres tags sin orden ni papeles, y R-CO-006 no se puede evaluar sobre eso.
  // Erratas en la lista (Parte 53, R-GRA-015), solo aquí: las lecturas no cambian. Dos vecinos
  // escritos al revés, uno escrito lejos de su sitio y otro con un dígito cambiado, que no existe.
  const listaCambiados = [ring[7], ring[8]] as string[];
  const listaMovido = ring[113] as string;
  const listaMalEscritoReal = ring[88] as string;
  const listaMalEscrito = `${listaMalEscritoReal.slice(0, -1)}${(Number(listaMalEscritoReal.slice(-1)) + 1) % 10}`;
  if (ring.includes(listaMalEscrito)) throw new Error("el número mal escrito coincide con un tag del anillo");
  const listaOrden = ring.filter((tag) => tag !== listaMovido);
  listaOrden.splice(listaOrden.indexOf(ring[52] as string) + 1, 0, listaMovido);
  listaOrden.splice(listaOrden.indexOf(ring[7] as string), 2, ring[8] as string, ring[7] as string);
  const declaredList = listaOrden.map((tag) => (tag === listaMalEscritoReal ? listaMalEscrito : tag));

  const listsCsv = ["lista;tag;orden;funcion;grupo;capacidad"]
    .concat(
      declaredList.map((tag, index) =>
        // Vinculación (Parte 36) se declara aquí, en la propia columna `funcion` del circuito
        // virtual — la vía alternativa a la lista `critico`, para ejercitar las dos fuentes.
        `circuito;${tag};${index + 1};${tag === vinculacionTag ? "vinculacion" : ""};;`,
      ),
    )
    .concat([`critico;${desvinculacionTag};;desvinculacion`])
    .concat([`critico;${refuerzoSinLectura};;desvinculacion`])
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
    .concat([`ancla;${ring[0] as string};1`])
    // La línea (Parte 56, R-FLO-010): solo declaración, no cambia ninguna lectura.
    .concat([`linea;${ring[lineaPosicion] as string};1`, `linea;${ring[lineaPosicion + 1] as string};2`])
    .join("\r\n");

  const plantados = new Set([
    ...nuncaLeidos,
    ...lecturaAlta,
    ...lecturaMedia,
    ...porMemoria,
    ...tramoConvoy,
    ...rotos,
    ...degradados,
    cruceTag,
    ...tagsDejados,
    sustitucionOriginal,
    bifurcacionSinConvergerTag,
    paradaPrecisaTag,
    semaforoTag,
    ...tagsDesiguales,
    // Parte 47: los tramos plantados, con sus dos extremos.
    ...[...nocheLenta, 58].map((index) => ring[index] as string),
    ring[paradaAislada.position] as string,
    ring[paradaAislada.position + 1] as string,
    ...[...conflictoPosiciones, 74].map((index) => ring[index] as string),
    ring[cuelloPosicion - 1] as string,
    ring[cuelloPosicion] as string,
    ring[cuelloPosicion + 1] as string,
    // Parte 50: el bloque de tres cambiado en su sitio.
    ...bloqueViejo,
    // Parte 52: los dos vecinos del tag de noche, cuyo paso cambia de noche.
    ring[84] as string,
    ring[85] as string,
    // Parte 53: el tag de verdad del número mal escrito, que la lista no tiene. Los cambiados de
    // orden siguen limpios: una errata de la lista no puede decir nada de un tag leído.
    listaMalEscritoReal,
    // Parte 54: el tag del refuerzo que no se lee. El otro sigue limpio: se lee con normalidad.
    refuerzoSinLectura,
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
      atUtcMs: toRealUtc(congelar(rotura)),
      expect: "un cambio con su instante: se leía y dejó de leerse",
      mustNotSay: "una tasa media que mezcle el antes y el después como si fuera un régimen",
    },
    {
      kind: "degradacion-progresiva",
      tags: degradados,
      vehicles: [],
      atUtcMs: toRealUtc(from),
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
    {
      kind: "lector-agv-degradado",
      tags: [],
      vehicles: [lectorDegradado],
      atUtcMs: toRealUtc(from),
      expect: "una tendencia a la baja en la fila del propio AGV, no del tag",
      mustNotSay: "que los tags que lee ese AGV estén fallando",
    },
    {
      kind: "adelantamiento-en-zona-cargada",
      tags: [],
      vehicles: [elAdelantado],
      expect: "se enumera a quién adelantó y con qué margen, como candidato, en el tramo en que se le adelantó",
      mustNotSay: "llamarlo avería: R-FLO-001 admite excepciones y OQ-107 no tiene el catálogo",
    },
    {
      kind: "bifurcacion-real",
      tags: [bifurcacionSinConvergerTag, ramaLarga[0] as string],
      vehicles: [],
      expect: "candidato a bifurcación en el tag, con las dos ramas y su cuota; sigue siendo bifurcación, nunca cruce",
      mustNotSay: "que sea una avería, ni reclasificarla como cruce sin que reconverja de verdad (R-GRA-007)",
    },
    {
      kind: "cruce-real",
      tags: [cruceTag, cruceRama],
      vehicles: [],
      expect: "candidato a cruce: las dos ramas reconvergen en pocos saltos (R-GRA-007)",
      mustNotSay: "que sea una avería, ni dejarla como bifurcación sin más porque reconverge",
    },
    {
      kind: "parada-precisa-real",
      tags: [paradaPrecisaTag],
      vehicles: [],
      expect: "candidato a parada precisa: duración larga y de poca varianza (R-GRA-007)",
      mustNotSay: "que sea una avería o una carga; la función sigue siendo dato de planta",
    },
    {
      kind: "semaforo-real",
      tags: [semaforoTag],
      vehicles: [],
      expect: "candidato a semáforo: duración bimodal, unas veces corta y otras larga (R-GRA-007)",
      mustNotSay: "una tendencia de rotura o degradación (R-OPP-015): es alternancia estable, no cambio sostenido",
    },
    {
      kind: "ancla-declarada",
      tags: [ring[0] as string],
      vehicles: [],
      expect:
        "las vueltas completas del cohorte principal salen observed; el ancla efectiva es la " +
        "declarada y el anillo mostrado empieza ahí (R-GRA-009)",
      mustNotSay: "que declarar el ancla cambie qué tags forman el anillo, más allá de rotar el punto de inicio",
    },
    {
      kind: "tag-nuevo-a-mitad-de-ventana",
      tags: [tagNuevo],
      vehicles: [],
      atUtcMs: toRealUtc(congelar(periodSplit)),
      expect: "tag nuevo: sin lecturas en el periodo temprano, con lecturas en el tardío (R-DAT-016)",
      mustNotSay: "que sea un tag obsoleto, o que existiera desde el principio de la ventana",
    },
    {
      kind: "memoria-actualizada-a-mitad-de-ventana",
      tags: tagsDejados,
      vehicles: [memoriaActualizada],
      atUtcMs: toRealUtc(congelar(periodSplit)),
      expect:
        "deriva de ese vehículo: dejó de leer un conjunto de tags que sí leía antes, mientras el " +
        "resto de la flota los sigue leyendo (R-AGV-013)",
      mustNotSay: "que esos tags estén averiados, o acusar a otro vehículo",
    },
    {
      kind: "sustitucion-candidata",
      tags: [sustitucionOriginal, sustitucionNueva],
      vehicles: [],
      atUtcMs: toRealUtc(congelar(periodSplit)),
      expect:
        "candidato a sustitución: el tag que desaparece y el que ocupa su mismo hueco en la " +
        "secuencia, correlacionados por vecino compartido y por tiempo (R-DAT-017)",
      mustNotSay:
        "tratarlos como dos hallazgos sueltos sin relación, ni afirmar que es físicamente el " +
        "mismo punto sin más evidencia (R-EVI-004)",
    },
    {
      kind: "memoria-no-actualizada",
      tags: [sustitucionNueva],
      vehicles: [memoriaNoActualizada],
      atUtcMs: toRealUtc(congelar(periodSplit)),
      expect:
        "el vehículo señalado como candidato a memoria no actualizada: no registra el tag nuevo " +
        "mientras la mayoría de la flota ya lo hace (R-AGV-013)",
      mustNotSay: "que el tag nuevo esté averiado, ni que sea culpa de otro vehículo",
    },
    {
      kind: "vinculacion-declarada",
      tags: [vinculacionTag],
      vehicles: [],
      expect: "el expediente del tag muestra la función crítica «vinculacion» (R-GRA-007)",
      mustNotSay: "que sea un hallazgo estadístico, ni que el producto la haya propuesto",
    },
    {
      kind: "desvinculacion-declarada",
      tags: [desvinculacionTag],
      vehicles: [],
      expect: "el expediente del tag muestra la función crítica «desvinculacion» (R-GRA-007)",
      mustNotSay: "que sea un hallazgo estadístico, ni que el producto la haya propuesto",
    },
    {
      kind: "lectura-desigual-en-pocos-tags",
      tags: tagsDesiguales,
      vehicles: [lecturaDesigual],
      expect: "el AGV sale como «lee poco» en esos dos tags, en pocos tags, con su porcentaje (R-AGV-016)",
      mustNotSay: "una causa (lector, memoria o colocación), ni que los dos tags fallen para el resto",
    },
    {
      kind: "parada-de-produccion",
      tags: [vinculacionTag, desvinculacionTag],
      vehicles: [],
      atUtcMs: toRealUtc(franjas[0] as number),
      expect:
        "tres paradas de la producción en las franjas plantadas, la de las 10:00 repetida al día " +
        "siguiente; todas las paradas de AGV dentro, justificadas; todos siguen por su sitio. El orden " +
        "no es verdad plantada: el generador deja adelantar al circular",
      mustNotSay: "que algún AGV se desconectara o saliera del circuito, ni un bloqueo dentro de una franja",
    },
    {
      kind: "bloqueo-sin-justificar",
      tags: [],
      vehicles: [elAdelantado],
      expect: "el primero de su cola, sin avanzar y con la producción en marcha: un bloqueo con sus lecturas críticas",
      mustNotSay: "una causa, ni justificarlo con una parada de la producción que no hubo",
    },
    {
      kind: "noche-medida-aparte",
      tags: nocheLenta.map((index) => ring[index] as string),
      vehicles: [],
      expect:
        "la horquilla de producción de esos tramos como la de uno limpio, la de noche con el doble o " +
        "más, y ninguna parada de noche por esa lentitud",
      mustNotSay: "mezclar la noche con el día, ni llamar parada a lo que de noche es lo normal",
    },
    {
      kind: "parada-sin-explicacion-aislada",
      tags: [ring[paradaAislada.position] as string],
      vehicles: [paradaAislada.vehicle],
      expect: "una parada candidata sin explicación, con quién iba delante y cuánto avanzó mientras tanto",
      mustNotSay: "una causa (batería, revisión, persona…), ni un bloqueo, ni un punto conflictivo",
    },
    {
      kind: "punto-conflictivo",
      tags: conflictoPosiciones.map((index) => ring[index] as string),
      vehicles: conflicto,
      expect: "un punto conflictivo que une los dos tags, con los ocho AGV",
      mustNotSay: "que sea de un solo AGV, ni un bloqueo",
    },
    {
      kind: "cuello-de-botella",
      tags: [ring[cuelloPosicion] as string],
      vehicles: [],
      expect: "un cuello de botella en ese tag, con su cola y sin bloqueos: fluye",
      mustNotSay: "una avería, ni paradas sin explicación de los que esperan detrás",
    },
    {
      kind: "zona-oscura",
      tags: lecturaMedia.slice(0, 4),
      vehicles: [],
      expect: "una zona oscura que incluye los tags poco leídos, con la causa «se salta el tag»",
      mustNotSay: "que el tramo sea largo, ni una zona en tramos limpios",
    },
    {
      kind: "entrega-agrupada",
      tags: [],
      vehicles: [entregaAgrupada],
      atUtcMs: toRealUtc(entregasPlantadas[0] ?? from),
      expect:
        "cada ráfaga como lecturas que llegaron juntas con la suma normal (no paró), el AGV concentrado, y " +
        "ninguna parada suya en esos tramos",
      mustNotSay: "una parada en el hueco, ni lecturas agrupadas de otro AGV",
    },
    {
      kind: "tres-sustituidos-seguidos",
      tags: [...bloqueViejo, ...bloqueNuevo],
      vehicles: [],
      atUtcMs: toRealUtc(corte),
      expect:
        "tres sustituciones en su sitio entre las dos anclas que los rodean, con la suma igual, incluido el " +
        "del medio, que el vecino compartido no empareja",
      mustNotSay: "tres cambios sueltos sin relación, ni el del medio como un tag que deja de leerse y otro que empieza",
    },
    {
      kind: "insertado-misma-suma",
      tags: [antesDelNuevo, tagInsertado, despuesDelNuevo],
      vehicles: [],
      atUtcMs: toRealUtc(corte),
      expect: "un tag nuevo en la línea entre sus dos vecinos, con la suma igual",
      mustNotSay: "que cambie el recorrido",
    },
    {
      kind: "tag-de-noche",
      tags: [antesDeNoche, tagDeNoche, despuesDeNoche],
      vehicles: [],
      expect: "el tag como de noche, entre sus dos vecinos, con las pasadas de día por su sitio sin leerlo",
      mustNotSay: "que sea candidato a una posición del circuito, ni que otro tag sea de noche",
    },
    {
      kind: "linea-parada-con-pulmon",
      tags: [ring[lineaPosicion] as string],
      vehicles: [],
      expect: "cada parada de la producción plantada, una parada de la línea con AGV esperando en el pulmón, y el pulmón medido",
      mustNotSay: "que a la línea le faltaron AGV en una parada de la producción",
    },
    {
      kind: "linea-tiempo-sin-paso",
      tags: [],
      vehicles: [],
      expect: "el tiempo sin paso con AGV esperando cubre casi entero el de las tres paradas de la producción plantadas",
      mustNotSay: "que en esas paradas le faltaran AGV a la línea",
    },
    {
      kind: "bateria-del-bloqueo",
      tags: [],
      vehicles: [elAdelantado],
      expect: "su última lectura, el de delante avanzando y los de detrás llegando a su siguiente tag antes que él: lo adelantaron",
      mustNotSay: "que avanzaba sin registrar lecturas",
    },
    {
      kind: "linea-tag-sin-leer",
      tags: [ring[lineaPosicion + 1] as string],
      vehicles: ciegos,
      expect: "exactamente los vehículos sin el 60 en memoria, que pasan por la línea sin leerlo en todos sus pasos",
      mustNotSay: "que no hicieran la parada, o cualquier otro vehículo",
    },
    {
      kind: "limpieza-de-la-lista",
      tags: [refuerzoSinLectura, ...nuncaLeidos, listaMalEscrito, ...listaCambiados, listaMovido],
      vehicles: [],
      expect:
        "como no está en el físico, el refuerzo sin lecturas primero y después los nunca leídos y el número mal " +
        "escrito; en otra posición, los cambiados de orden; el refuerzo de la desvinculación, incompleto",
      mustNotSay: "ningún otro tag fuera del físico o en otra posición, ni un refuerzo comprobado que falte",
    },
    {
      kind: "tag-de-noche-declarado",
      tags: [antesDeNoche, tagDeNoche, despuesDeNoche],
      vehicles: [],
      expect: "con el tag en la lista de noche, tag de noche declarado en su sitio, y el resto de tags fuera de la lista igual",
      mustNotSay: "otro veredicto para él, o que la lista cambie el de otro tag",
    },
    {
      kind: "lista-con-otro-orden",
      tags: [...listaCambiados, listaMovido, ring[52] as string],
      vehicles: [],
      expect:
        "en el orden según las lecturas, los tres donde los leen los AGV; el contraste dice que la lista " +
        "los pone en otro sitio, con su sitio en cada lado",
      mustNotSay: "ningún otro hallazgo sobre esos tags: la errata es de la lista, no del circuito",
    },
    {
      kind: "lista-con-numero-mal-escrito",
      tags: [listaMalEscritoReal, listaMalEscrito],
      vehicles: [],
      expect:
        "el número mal escrito, sin lecturas, junto al tag de verdad en el orden según las lecturas; el " +
        "contraste, «posible sustitución o número mal escrito»; y el de verdad, candidato a esa posición",
      mustNotSay: "decidir por el número si es errata o sustitución",
    },
    {
      kind: "refuerzo-sin-lectura",
      tags: [refuerzoSinLectura, refuerzoLeido],
      vehicles: [],
      expect:
        "el tag sin lecturas como refuerzo de un crítico sin lecturas, con su refuerzo nombrado; el otro, activo",
      mustNotSay: "que se perdió la función, ni nada del tag del refuerzo que se lee",
    },
    {
      kind: "ritmo-mas-lento-en-un-fichero",
      tags: [],
      vehicles: [ritmoLento],
      atUtcMs: toRealUtc(congelar(lentoDesde)),
      expect:
        "en el fichero de después, un 10 % más lento que la flota contra la horquilla de ese fichero, en toda la línea; " +
        "en el de antes, a su paso",
      mustNotSay: "una causa, ni otro AGV más lento o más rápido",
    },
    {
      kind: "retiene-a-otros",
      tags: [ring[semaforoPosicion] as string],
      vehicles: [retenedor],
      expect: "quien retiene a varios AGV más de lo que da el azar por sus pasadas, en el semáforo, sin pararse él",
      mustNotSay: "que retenga otro AGV, o una parada sin explicación de quien espera detrás",
    },
    {
      kind: "posicion-en-tiempo",
      tags: [...nuncaLeidos, tagNuevo],
      vehicles: [],
      expect:
        "en cada fichero, posiciones crecientes desde el ancla; los tags nunca leídos sin posición y el siguiente " +
        "situado igual; el tag nuevo situado entre sus dos vecinos en el fichero de después",
      mustNotSay: "una posición interpolada para un tag sin lecturas, ni el tag nuevo en el fichero de antes",
    },
  ];

  const fleetCircuit = "SE-AUDITORIA";
  const fleetNeverRead = "7199";
  const fleetLeavesMidway = vehicles[10] as string;
  const fleetCsv = ["circuito;agv;desde;hasta;nota"]
    .concat(
      vehicles.map(
        (vehicle) => `${fleetCircuit};${vehicle};01/09/2026;${vehicle === fleetLeavesMidway ? stamp(periodSplit) : ""};`,
      ),
    )
    .concat([`${fleetCircuit};${fleetNeverRead};01/09/2026;;asignado y sin lecturas`, "OTRO-CIRCUITO;7201;01/09/2026;;"])
    .join("\r\n");

  return {
    readingsCsv,
    listsCsv,
    fleetCsv,
    fleetCircuit,
    fleetNeverRead,
    fleetLeavesMidway,
    defects,
    cleanTags: ring.filter((tag) => !plantados.has(tag)),
    physicalRing: ring,
    declaredList,
    vehicles,
    fromUtcMs: toRealUtc(from),
    toUtcMs: toRealUtc(to),
    lanes,
    zoneOf,
    periodSplitUtcMs: toRealUtc(congelar(periodSplit)),
    groupedDeliveriesUtcMs: entregasPlantadas.map(toRealUtc),
    productionStopsUtcMs: franjas.map((inicio) => ({
      fromUtcMs: toRealUtc(inicio),
      toUtcMs: toRealUtc(inicio + PARADA_PRODUCCION_MS),
    })),
  };
}
