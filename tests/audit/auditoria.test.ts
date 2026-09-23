/**
 * Auditoría del producto contra un circuito con la verdad conocida.
 *
 * No comprueba una función: comprueba **cuánto de lo que puede ir mal en un circuito real llega a
 * decirse**. Por cada clase de fallo plantada se mide si el producto la detecta, y por cada tag sano
 * se mide si lo señala sin motivo. El resultado es un informe por clase, y ese informe —no esta
 * prueba— es el entregable: dice qué construir después.
 *
 * Tres aserciones, y la tercera es la que impide que esto envejezca:
 *
 * 1. **Cero falsos positivos.** Señalar un tag sano es peor que no señalar uno enfermo: es lo que
 *    hace que nadie vuelva a mirar la herramienta.
 * 2. **Regresión**: lo que hoy se detecta tiene que seguir detectándose.
 * 3. **La deuda no se pudre en ninguna dirección**: las clases que hoy no se detectan están
 *    enumeradas, y si una empieza a detectarse la prueba **falla** pidiendo que se saque de la
 *    lista. Una lista de deuda que no se actualiza sola acaba mintiendo igual que un `TODO`.
 */

import { describe, expect, it } from "vitest";

import { buildAuditScenario, toRealUtc, type DefectClass } from "../support/circuito-auditoria.js";
import { importReadings } from "../../src/ingestion/importer.js";
import { buildTransitions } from "../../src/domain/graph.js";
import { assignCohorts } from "../../src/domain/cohort.js";
import { findDominantCycle, resolveDeclaredAnchor, segmentLaps, type Lap } from "../../src/domain/laps.js";
import { buildReadMatrix, type ReadMatrix } from "../../src/domain/read-matrix.js";
import { buildTagInventory } from "../../src/domain/inventory.js";
import { buildAllAgvDossiers, buildAllTagDossiers } from "../../src/domain/dossier.js";
import { buildChargingReport, type ChargingReport } from "../../src/domain/charging.js";
import { buildFifoReport, loadedZoneSpans, type FifoReport } from "../../src/domain/fifo.js";
import {
  classifyCrossings,
  findBifurcationCandidates,
  findPrecisePauseCandidates,
  findTrafficLightCandidates,
  type CriticalPointCandidate,
} from "../../src/domain/critical-points.js";
import { compareDistantPeriods, type DriftComparison } from "../../src/domain/drift.js";
import {
  laneEntryTags,
  readCoLanes,
  readCriticalPoints,
  readLapAnchors,
  readZones,
} from "../../src/domain/circuit-config.js";
import { importCatalog } from "../../src/ingestion/catalog.js";
import { PROVISIONAL_CONFIG } from "../../src/domain/config.js";

/**
 * Clases que hoy **no** se detectan, con el motivo.
 *
 * No es una excusa: es el resultado de la auditoría, escrito donde se puede comprobar. Se saca de
 * aquí en cuanto el detector exista, y la prueba avisa si alguien lo implementa y se olvida.
 *
 * Vacía desde R-OPP-015: rotura súbita y degradación progresiva —las dos únicas que había— ya se
 * detectan. Se deja el tipo declarado, y no se borra el mapa, porque la próxima clase de deuda que
 * aparezca tiene que caer en la misma estructura, no reinventarla.
 */
const DEUDA_CONOCIDA: ReadonlyMap<DefectClass, string> = new Map([]);

/**
 * Plazo por prueba.
 *
 * Una auditoría no es una unitaria: genera un cuarto de millón de lecturas y las hace pasar por el
 * encadenado entero, y dos veces cuando hay que contrastar con configuración y sin ella. El plazo
 * por defecto de Vitest está pensado para comprobar una función, y aquí solo serviría para que la
 * prueba fallara por lenta en vez de por falsa.
 */
const PLAZO = 120_000;

/** Deshace `stamp()` del generador (`dd/mm/aaaa H:MM:SS`), para comprobaciones cruzadas por fecha. */
function parseStamp(value: string): number {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (match === null) throw new Error(`fecha inesperada en el CSV generado: ${value}`);
  const [, day, month, year, hour, minute, second] = match as unknown as [
    string, string, string, string, string, string, string,
  ];
  return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
}

interface Analysis {
  readonly matrix: ReadMatrix | undefined;
  readonly ring: readonly string[];
  readonly offRing: readonly string[];
  readonly inventory: ReturnType<typeof buildTagInventory>;
  readonly charging: ChargingReport;
  readonly coLanes: ReturnType<typeof readCoLanes>["lanes"];
  readonly fifo: FifoReport | undefined;
  readonly criticalPoints: readonly CriticalPointCandidate[];
  readonly dossiers: ReturnType<typeof buildAllAgvDossiers>;
  /** Expedientes de tag (Parte 36): trae la función crítica declarada, venga de la fuente que venga. */
  readonly tagDossiers: ReturnType<typeof buildAllTagDossiers>;
  /** El ancla efectiva del cohorte principal, y las vueltas segmentadas con esa verdad (R-GRA-009). */
  readonly laps: readonly Lap[];
  readonly anchorTagId: string | undefined;
  readonly anchorTruth: "observed" | "inferred" | undefined;
  /** Comparación entre el primer y el último periodo, construidos a mano a partir del escenario. */
  readonly drift: DriftComparison;
  /** Para poder decir en el informe sobre cuánto dato se está midiendo. */
  readonly readings: number;
}

/**
 * El mismo encadenado que corre el Worker, sobre el escenario generado.
 *
 * `conConfiguracion` decide si se le dan las listas de planta. Se puede ejecutar sin ellas a
 * propósito: es la única forma de comprobar que declararlas no cambia el veredicto de un tag sano,
 * que es lo que la clase `zona-vacia-declarada` vigila.
 *
 * La lista `ancla` queda **fuera** de ese apagado: decide qué tag cierra la vuelta, y cambiarlo
 * desplaza dónde `traceLaps` corta cada vehículo — un efecto real (R-GRA-009) pero ajeno a lo que
 * esta comparación aísla. Alternar el ancla a la vez que la zona contaminaría la comparación con un
 * segundo efecto que no es el que la clase declara vigilar, así que el ancla se mantiene igual en
 * las dos ejecuciones y solo la zona (y el resto de listas) se apaga.
 */
function analyse(
  scenario: ReturnType<typeof buildAuditScenario>,
  conConfiguracion = true,
): Analysis {
  const result = importReadings(
    scenario.readingsCsv,
    {
      sourceId: "auditoria",
      fileName: "auditoria.csv",
      byteSize: scenario.readingsCsv.length,
      zone: "Europe/Madrid",
      encoding: "utf-8",
    },
    { onProgress: () => undefined, isCancelled: () => false },
  );

  // La configuración se lee **por el mismo camino que el producto**: del CSV de listas, con el
  // importador de catálogo. Construirla a mano aquí probaría el dominio y no el recorrido.
  const catalog = importCatalog(scenario.listsCsv);
  const entriesOf = (name: string) =>
    conConfiguracion || name === "ancla" ? (catalog.lists.get(name) ?? []) : [];
  const laneConfig = readCoLanes(entriesOf("carga-online"));
  const zoneConfig = readZones(entriesOf("zona"));
  // La función de un tag crítico se declara en «critico», o alternativamente en la columna `funcion`
  // del circuito virtual (Parte 36) — mismo merge que hace el Worker, `critico` primero.
  const criticalPointsConfig = readCriticalPoints([
    ...entriesOf("critico"),
    ...entriesOf("circuito").filter((entry) => entry.funcion !== ""),
  ]);
  const lapAnchorsConfig = readLapAnchors(entriesOf("ancla"));

  const readings = result.readings;
  const direction = result.summary.direction;
  const { transitions } = buildTransitions(readings, direction, []);
  const cohorts = assignCohorts(readings, transitions);
  const main = cohorts.cohorts[0];
  if (main === undefined) throw new Error("La auditoría necesita al menos un cohorte.");

  const vehicleSet = new Set(main.vehicles);
  const cohortTransitions = transitions.filter((entry) => vehicleSet.has(entry.agvId));
  const inferredAnchor = findDominantCycle(cohortTransitions);

  // Mismo encadenado que el Worker (Parte 32, R-GRA-009): el ancla declarada solo rota dónde se
  // corta el ciclo ya reconstruido, y solo si aparece en él.
  let anchor = inferredAnchor;
  let anchorTruth: "observed" | "inferred" | undefined = inferredAnchor === null ? undefined : "inferred";
  if (inferredAnchor !== null && lapAnchorsConfig.anchors.length > 0) {
    const resolved = resolveDeclaredAnchor(inferredAnchor, lapAnchorsConfig.anchors);
    if (resolved !== null) {
      anchor = { tagId: resolved.tagId, cycle: resolved.cycle, weakestShare: inferredAnchor.weakestShare };
      anchorTruth = "observed";
    }
  }

  const cohortReadings = readings.filter((entry) => vehicleSet.has(entry.agvId));

  const laps: Lap[] =
    anchor === null
      ? []
      : [...segmentLaps(cohortReadings, direction, [], anchor.tagId, anchorTruth ?? "inferred")];

  const charging = buildChargingReport(
    readings,
    laneConfig.lanes,
    [{ from: scenario.fromUtcMs, to: scenario.toUtcMs }],
    PROVISIONAL_CONFIG.charging,
  );

  const matrix =
    anchor === null
      ? undefined
      : buildReadMatrix(
          main.id,
          cohortReadings,
          direction,
          [],
          anchor.cycle,
          anchor.tagId,
          PROVISIONAL_CONFIG.readRate,
          { zoneOf: zoneConfig.zoneOf, laneEntryTags: laneEntryTags(laneConfig.lanes) },
          PROVISIONAL_CONFIG.trend,
        );

  const fifo =
    anchor === null
      ? undefined
      : buildFifoReport(
          main.id,
          cohortReadings,
          loadedZoneSpans(anchor.cycle, zoneConfig.zoneOf).spans,
          PROVISIONAL_CONFIG.fifo,
        );

  const bifurcaciones = findBifurcationCandidates(cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.bifurcacion);
  const criticalPoints = [
    ...classifyCrossings(bifurcaciones, cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.cruce),
    ...findPrecisePauseCandidates(cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.paradaPrecisa),
    ...findTrafficLightCandidates(cohortTransitions, PROVISIONAL_CONFIG.criticalPoints.semaforo),
  ];

  const ring = anchor?.cycle ?? [];
  const inRing = new Set(ring);
  const offRing = [...new Set(cohortReadings.map((entry) => entry.tagId))].filter(
    (tagId) => !inRing.has(tagId),
  );

  const declared = new Set(scenario.declaredRing);
  const laneTagsOf = (predicate: (laneId: string) => boolean): Set<string> =>
    new Set(
      laneConfig.lanes.filter((lane) => predicate(lane.laneId)).flatMap((lane) => [...lane.tags]),
    );
  const noServidas = new Set(
    charging.lanes.filter((lane) => !lane.served).map((lane) => lane.laneId),
  );
  const inventory = buildTagInventory(
    readings,
    {
      virtual: declared,
      memory: declared,
      maintenance: new Set(),
      emergency: new Set(),
      charging: laneTagsOf(() => true),
      unservedLaneTags: laneTagsOf((laneId) => noServidas.has(laneId)),
      critical: criticalPointsConfig.funcionOf,
    },
    PROVISIONAL_CONFIG.blindness,
  );

  const dossiers = buildAllAgvDossiers(
    readings,
    cohorts,
    laps,
    scenario.toUtcMs,
    PROVISIONAL_CONFIG.silence.minGapMs,
    laneConfig.lanes,
  );
  const tagDossiers = buildAllTagDossiers(
    readings,
    dossiers.map((entry) => entry.agvId),
    criticalPointsConfig.funcionOf,
  );

  // Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013): la cobertura de dos tramos se
  // construye a mano a partir del corte del propio escenario, con un margen a cada lado muy por
  // encima de `minGapMs` — mismo patrón ya usado para la cobertura de `charging` más arriba, y no una
  // segunda fuente real.
  const driftBuffer = 60 * 60_000;
  const driftCoverage = [
    { from: scenario.fromUtcMs, to: scenario.periodSplitUtcMs - driftBuffer },
    { from: scenario.periodSplitUtcMs + driftBuffer, to: scenario.toUtcMs },
  ];
  const knownTags = new Set([
    ...declared,
    ...laneTagsOf(() => true),
    ...criticalPointsConfig.funcionOf.keys(),
  ]);
  const drift = compareDistantPeriods(readings, driftCoverage, knownTags, PROVISIONAL_CONFIG.drift);

  return {
    matrix,
    ring,
    offRing,
    inventory,
    charging,
    coLanes: laneConfig.lanes,
    fifo,
    criticalPoints,
    dossiers,
    tagDossiers,
    laps,
    anchorTagId: anchor?.tagId,
    anchorTruth,
    drift,
    readings: readings.length,
  };
}

describe("auditoría del circuito con verdad conocida", () => {
  const scenario = buildAuditScenario();
  const analysis = analyse(scenario);
  const {
    matrix,
    ring,
    offRing,
    inventory,
    charging,
    coLanes,
    fifo,
    criticalPoints,
    dossiers,
    tagDossiers,
    laps,
    anchorTagId,
    anchorTruth,
    drift,
    readings,
  } = analysis;

  /**
   * El mismo análisis **sin** las listas de planta, para poder contrastar los dos.
   *
   * Se calcula una sola vez y solo si hace falta: generar y analizar el escenario son unos segundos,
   * y las sondas se ejecutan una vez por prueba.
   */
  let sinConfigCache: Analysis | null = null;
  const sinConfiguracion = (): Analysis => (sinConfigCache ??= analyse(scenario, false));

  /** Qué dice el producto de un tag, en la forma que la auditoría compara. */
  const rowOf = (tagId: string) => matrix?.tags.find((entry) => entry.tagId === tagId);
  const classOf = (tagId: string) =>
    inventory.rows.find((entry) => entry.tagId === tagId)?.tagClass;

  const detecta: Record<DefectClass, () => { ok: boolean; detail: string }> = {
    "declarado-sin-lecturas": () => {
      const tags = scenario.defects.find((d) => d.kind === "declarado-sin-lecturas")?.tags ?? [];
      const clases = tags.map(classOf);
      return {
        ok: clases.every((clase) => clase === "obsoleto-candidato"),
        detail: `clases: ${clases.join(", ")}`,
      };
    },
    "lectura-alta": () => {
      const tags = scenario.defects.find((d) => d.kind === "lectura-alta")?.tags ?? [];
      const malos = tags.filter((tag) => {
        const pattern = rowOf(tag)?.pattern;
        return pattern === "bimodal-candidato" || pattern === "uniforme-bajo";
      });
      return { ok: malos.length === 0, detail: `señalados sin motivo: ${malos.length}/${tags.length}` };
    },
    "lectura-media": () => {
      const tags = scenario.defects.find((d) => d.kind === "lectura-media")?.tags ?? [];
      const vistos = tags.filter((tag) => {
        const pattern = rowOf(tag)?.pattern;
        return pattern === "uniforme-bajo" || pattern === "gradiente";
      });
      return { ok: vistos.length >= tags.length / 2, detail: `${vistos.length}/${tags.length}` };
    },
    "omision-por-memoria": () => {
      const defect = scenario.defects.find((d) => d.kind === "omision-por-memoria");
      const tags = defect?.tags ?? [];
      const esperados = new Set(defect?.vehicles ?? []);
      const aciertos = tags.filter((tag) => {
        const row = rowOf(tag);
        if (row?.pattern !== "bimodal-candidato") return false;
        // Y además tiene que nombrar a los vehículos correctos, no a unos cualesquiera.
        return row.lowReaders.length > 0 && row.lowReaders.every((agv) => esperados.has(agv));
      });
      return { ok: aciertos.length === tags.length, detail: `${aciertos.length}/${tags.length}` };
    },
    "omision-conservando-convoy": () => {
      const defect = scenario.defects.find((d) => d.kind === "omision-conservando-convoy");
      const tags = defect?.tags ?? [];
      const saltador = (defect?.vehicles ?? [])[0] ?? "";
      // Lo que se exige no es detectarlo, sino **no acusar al tag**: el vehículo que se salta el
      // tramo no puede aparecer como prueba de que esos tags fallan.
      const acusados = tags.filter((tag) => rowOf(tag)?.lowReaders.includes(saltador) === true);
      return { ok: acusados.length === 0, detail: `tags acusados por su culpa: ${acusados.length}` };
    },
    // Las dos clases se sondean **con tolerancia real contra la verdad plantada**, no solo con la
    // presencia del campo: ahora que el detector existe (R-OPP-015), basta con encender el campo no
    // demuestra que apunte al sitio correcto.
    "rotura-subita": () => {
      const defect = scenario.defects.find((d) => d.kind === "rotura-subita");
      const tags = defect?.tags ?? [];
      const plantado = defect?.atUtcMs ?? 0;
      // Un par de vueltas de margen: el instante que se publica es el punto medio entre la última
      // pasada de antes y la primera de después, nunca el corte plantado exacto. 20 s por tag es
      // generoso frente a los 12-20 s reales del generador.
      const margenMs = 2 * ring.length * 20_000;
      const aciertos = tags.filter((tag) => {
        const row = rowOf(tag);
        return (
          typeof row?.changedAtUtcMs === "number" &&
          Math.abs(row.changedAtUtcMs - plantado) <= margenMs
        );
      });
      return {
        ok: aciertos.length === tags.length && tags.length > 0,
        detail: `con el instante dentro de margen: ${aciertos.length}/${tags.length}`,
      };
    },
    "degradacion-progresiva": () => {
      const tags = scenario.defects.find((d) => d.kind === "degradacion-progresiva")?.tags ?? [];
      const conTendencia = tags.filter((tag) => {
        const row = rowOf(tag);
        if (row?.trend !== "bajando") return false;
        const rates = row.segmentRates ?? [];
        // Estrictamente decreciente y con una caída real, no un empate declarado tendencia.
        return (
          rates.length >= 2 &&
          rates.every((rate, index) => index === 0 || rate <= (rates[index - 1] as number)) &&
          (rates[0] as number) - (rates[rates.length - 1] as number) > 0.2
        );
      });
      return {
        ok: conTendencia.length === tags.length && tags.length > 0,
        detail: `con tendencia sostenida: ${conTendencia.length}/${tags.length}`,
      };
    },
    "mantenimiento-aislado": () => {
      const tags = scenario.defects.find((d) => d.kind === "mantenimiento-aislado")?.tags ?? [];
      const fuera = tags.filter((tag) => offRing.includes(tag));
      return { ok: fuera.length === tags.length, detail: `fuera del anillo: ${fuera.length}/${tags.length}` };
    },
    "carga-online-normal": () => {
      // Dos cosas, y las dos tienen que darse: que las estancias se reconozcan con una mediana
      // sensata, y —lo que de verdad importa— que esas medias horas **no** aparezcan como
      // periodos de inactividad en el expediente de nadie.
      //
      // El filtro se acota a los huecos que **empiezan en la parada precisa de una calle servida**:
      // esos son los únicos candidatos a ser una carga mal reconocida. Desde R-OPP-015 el escenario
      // tiene otra clase (`adelantamiento-en-zona-cargada`) que planta un silencio real de más de
      // quince minutos en mitad del anillo, sin relación con ninguna calle; contarlo aquí confundiría
      // dos causas distintas de silencio, que es justo lo que esta sonda existe para no hacer.
      const servidas = charging.lanes.filter((lane) => lane.served);
      const conMediana = servidas.filter(
        (lane) =>
          lane.medianStayMs !== null &&
          lane.medianStayMs > 15 * 60_000 &&
          lane.medianStayMs < 50 * 60_000,
      );
      const servidasIds = new Set(servidas.map((lane) => lane.laneId));
      const stopTags = new Set(
        coLanes.filter((lane) => servidasIds.has(lane.laneId)).map((lane) => lane.stopTagId),
      );
      const huecos = dossiers.flatMap((dossier) => dossier.inactivity);
      const comoSilencio = huecos.filter(
        (period) => period.cause === "silencio" && stopTags.has(period.lastTagBefore),
      ).length;
      const comoCarga = huecos.filter((period) => period.cause === "carga-online").length;
      return {
        ok: conMediana.length === servidas.length && servidas.length > 0 && comoSilencio === 0,
        detail:
          `${conMediana.length}/${servidas.length} calles con mediana en torno a la media hora; ` +
          `${comoCarga} paradas leídas como carga y ${comoSilencio} como silencio`,
      };
    },
    "calle-sin-servicio": () => {
      const tags = scenario.defects.find((d) => d.kind === "calle-sin-servicio")?.tags ?? [];
      const sinServicio = charging.lanes.filter((lane) => !lane.served).length;
      const clases = tags.map(classOf);
      return {
        ok: sinServicio === 1 && clases.every((clase) => clase === "calle-sin-servicio"),
        detail: `${sinServicio} calle sin entradas; clases: ${clases.join(", ")}`,
      };
    },
    "salida-fuera-de-antiguedad": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "salida-fuera-de-antiguedad")
        ?.vehicles ?? [])[0];
      // Ordenadas por lo que esperó cada uno, sobre todas las calles. Lo que se exige no es que el
      // plantado aparezca —aparecería también en una lista de cincuenta— sino que salga **el
      // primero**: dos cargas simultáneas de duración distinta invierten el orden de salida con
      // toda normalidad, así que lo que separa la espera anómala del ruido es su magnitud.
      const todas = charging.lanes
        .flatMap((lane) => lane.outOfSeniority)
        .sort((a, b) => b.waitedMs - a.waitedMs);
      const primera = todas[0];
      return {
        ok: esperado !== undefined && primera?.waited === esperado,
        detail:
          primera === undefined
            ? "nadie señalado"
            : `el primero por espera es ${primera.waited} (se esperaba ${esperado ?? "—"}), ` +
              `${Math.round(primera.waitedMs / 60_000)} min; ${todas.length - 1} inversiones más, ` +
              "que son cargas simultáneas de duración distinta y no un hallazgo",
      };
    },
    "carga-anterior-a-la-ventana": () => {
      const esperados = new Set(
        scenario.defects.find((d) => d.kind === "carga-anterior-a-la-ventana")?.vehicles ?? [],
      );
      const inferidos = new Set(charging.startedInside.map((stay) => stay.agvId));
      const aciertos = [...esperados].filter((agv) => inferidos.has(agv));
      // Exacto en los dos sentidos: se exige encontrarlos **y** no inventarse ninguno más, porque
      // afirmar que un vehículo estaba cargando cuando no lo estaba es el mismo error al revés.
      return {
        ok: aciertos.length === esperados.size && inferidos.size === esperados.size,
        detail: `${aciertos.length}/${esperados.size} inferidos, ${inferidos.size} señalados en total`,
      };
    },
    "zona-vacia-declarada": () => {
      // La zona es contexto, no defecto: lo que se mide es que **declararla no mueva ningún
      // veredicto de un tag sano**. Una configuración que cambia diagnósticos que no debería
      // tocar es un defecto por sí misma, y solo se ve comparando las dos ejecuciones.
      const sinConfig = sinConfiguracion();
      const patron = (source: Analysis, tagId: string) =>
        source.matrix?.tags.find((entry) => entry.tagId === tagId)?.pattern;
      const movidos = scenario.cleanTags.filter(
        (tag) => patron(sinConfig, tag) !== patron(analysis, tag),
      );
      const enZona = scenario.lanes.every((lane) => scenario.zoneOf.get(lane.stop) === "vacio");
      return {
        ok: movidos.length === 0 && enZona,
        detail:
          `${[...new Set(scenario.zoneOf.values())].length} zonas declaradas, calles dentro de ` +
          `la vacía: ${enZona ? "sí" : "no"}; tags sanos con veredicto movido: ${movidos.length}; ` +
          `pasadas retiradas de la vía de orden: ${matrix?.orderWithheld ?? 0}`,
      };
    },
    "lector-agv-degradado": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "lector-agv-degradado")
        ?.vehicles ?? [])[0];
      const vehicle = matrix?.vehicles.find((entry) => entry.agvId === esperado);
      const rates = vehicle?.segmentRates ?? [];
      const sostenida =
        vehicle?.trend === "bajando" &&
        rates.length >= 2 &&
        rates.every((rate, index) => index === 0 || rate <= (rates[index - 1] as number));
      // Y sus tags no pueden acusarse: el fallo es del vehículo, y la flota los diluye. Se mira
      // solo sobre los tags **sanos**: `rotos` y `degradados` ya tienen su propia tendencia o
      // rotura por derecho propio (son otras dos clases plantadas), y contarlos aquí confundiría
      // el efecto de ese AGV con un hallazgo que no es suyo.
      const tagsAcusados = scenario.cleanTags.filter((tagId) => {
        const tag = matrix?.tags.find((entry) => entry.tagId === tagId);
        return tag?.trend === "bajando" || tag?.changedAtUtcMs !== undefined;
      });
      return {
        ok: sostenida && tagsAcusados.length === 0,
        detail:
          `${esperado ?? "?"}: ${vehicle?.trend ?? "sin tendencia"} ` +
          `(${rates.map((r) => `${Math.round(r * 100)}%`).join(" → ")}); ` +
          `tags con tendencia o rotura por su culpa: ${tagsAcusados.length}`,
      };
    },
    "adelantamiento-en-zona-cargada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "adelantamiento-en-zona-cargada")
        ?.vehicles ?? [])[0];
      // Mismo criterio que `salida-fuera-de-antiguedad`: lo que se exige es que el plantado salga
      // **el primero** por margen, no que sea el único — una parada de carga real en el mismo
      // escenario puede producir inversiones menores y legítimas en otro punto del mismo tramo.
      const todas = (fifo?.spans ?? [])
        .flatMap((span) => span.overtakes)
        .sort((a, b) => b.marginMs - a.marginMs);
      const primera = todas[0];
      return {
        ok: esperado !== undefined && primera?.overtaken === esperado,
        detail:
          primera === undefined
            ? "nadie señalado"
            : `el primero por margen es ${primera.overtaken} (se esperaba ${esperado ?? "—"}), ` +
              `${Math.round(primera.marginMs / 60_000)} min de margen; ${todas.length - 1} más`,
      };
    },
    "bifurcacion-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "bifurcacion-real");
      const [tagBifurcado, ramaEsperada] = plantado?.tags ?? [];
      const candidato = criticalPoints.find((entry) => entry.tagId === tagBifurcado);
      const ramas =
        candidato?.kind === "bifurcacion" || candidato?.kind === "cruce"
          ? (candidato.branches ?? []).map((branch) => branch.tagId)
          : [];
      return {
        ok:
          candidato !== undefined &&
          candidato.kind === "bifurcacion" && // nunca `cruce`: es la regresión que Part 35 previene
          ramas.length >= 2 &&
          ramaEsperada !== undefined &&
          ramas.includes(ramaEsperada),
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : `${candidato.kind}, ${ramas.length} ramas: ${ramas.join(", ")}`,
      };
    },
    "cruce-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "cruce-real");
      const tagCruce = plantado?.tags[0];
      const candidato = criticalPoints.find((entry) => entry.tagId === tagCruce);
      return {
        ok: candidato?.kind === "cruce" && candidato.reconvergesAt !== undefined,
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : candidato.kind === "cruce"
              ? `reconverge en «${candidato.reconvergesAt}» a ${candidato.hops} salto(s)`
              : `salió como ${candidato.kind}, no cruce`,
      };
    },
    "parada-precisa-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "parada-precisa-real");
      const tag = plantado?.tags[0];
      const candidato = criticalPoints.find((entry) => entry.tagId === tag);
      return {
        ok: candidato?.kind === "parada-precisa",
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : candidato.kind === "parada-precisa"
              ? `media ${Math.round((candidato.meanDurationMs ?? 0) / 1000)} s, cv ${(candidato.coefficientOfVariation ?? 0).toFixed(2)}`
              : `salió como ${candidato.kind}, no parada precisa`,
      };
    },
    "semaforo-real": () => {
      const plantado = scenario.defects.find((d) => d.kind === "semaforo-real");
      const tag = plantado?.tags[0];
      const candidato = criticalPoints.find((entry) => entry.tagId === tag);
      return {
        ok: candidato?.kind === "semaforo",
        detail:
          candidato === undefined
            ? "sin candidato para el tag plantado"
            : candidato.kind === "semaforo"
              ? `${Math.round((candidato.lowClusterMeanMs ?? 0) / 1000)} s / ${Math.round((candidato.highClusterMeanMs ?? 0) / 1000)} s`
              : `salió como ${candidato.kind}, no semáforo`,
      };
    },
    "ancla-declarada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "ancla-declarada")?.tags ?? [])[0];
      const completas = laps.filter((lap) => lap.completeness === "completa");
      return {
        ok:
          anchorTagId === esperado &&
          anchorTruth === "observed" &&
          completas.length > 0 &&
          completas.every((lap) => lap.truth === "observed"),
        detail:
          `ancla efectiva: ${anchorTagId ?? "—"} (${anchorTruth ?? "sin ancla"}); ` +
          `${completas.length} vueltas completas, ` +
          `${completas.filter((lap) => lap.truth === "observed").length} con truth observed`,
      };
    },
    "tag-nuevo-a-mitad-de-ventana": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "tag-nuevo-a-mitad-de-ventana")
        ?.tags ?? [])[0];
      const hallado = drift.tagDrifts.find((entry) => entry.tagId === esperado);
      return {
        ok: drift.evaluated && hallado?.kind === "nuevo",
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "sin hallazgo para el tag plantado"
            : `${hallado.kind}` +
              (hallado.kind === "nuevo" ? `, ${hallado.readingsAfter} lecturas en el periodo tardío` : ""),
      };
    },
    "memoria-actualizada-a-mitad-de-ventana": () => {
      const defect = scenario.defects.find((d) => d.kind === "memoria-actualizada-a-mitad-de-ventana");
      const esperado = defect?.vehicles[0];
      const esperados = new Set(defect?.tags ?? []);
      const hallado = drift.vehicleDrifts.find((entry) => entry.agvId === esperado);
      const dropped = new Set(hallado?.droppedTags ?? []);
      const coincide = esperados.size > 0 && [...esperados].every((tag) => dropped.has(tag));
      return {
        ok: drift.evaluated && hallado !== undefined && coincide,
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "vehículo plantado sin deriva señalada"
            : `${hallado.droppedTags.length} tags dejados: ${hallado.droppedTags.join(", ")}`,
      };
    },
    "sustitucion-candidata": () => {
      const defect = scenario.defects.find((d) => d.kind === "sustitucion-candidata");
      const [esperadoViejo, esperadoNuevo] = defect?.tags ?? [];
      const hallado = drift.tagDrifts.find(
        (entry) => entry.kind === "sustitucion-candidata" && entry.tagId === esperadoViejo,
      );
      const coincide =
        hallado !== undefined &&
        hallado.kind === "sustitucion-candidata" &&
        hallado.nuevoTagId === esperadoNuevo;
      return {
        ok: drift.evaluated && coincide,
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "sin sustitución candidata para el par plantado"
            : hallado.kind === "sustitucion-candidata"
              ? `${hallado.tagId} → ${hallado.nuevoTagId}, mismo ${hallado.neighborSide} (${hallado.sharedNeighbor})`
              : `salió como ${hallado.kind}, no emparejado`,
      };
    },
    "memoria-no-actualizada": () => {
      const defect = scenario.defects.find((d) => d.kind === "memoria-no-actualizada");
      const esperadoVehiculo = defect?.vehicles[0];
      const esperadoTag = defect?.tags[0];
      const hallado = drift.vehicleDrifts.find((entry) => entry.agvId === esperadoVehiculo);
      const coincide = esperadoTag !== undefined && (hallado?.notAdoptedTags.includes(esperadoTag) ?? false);
      return {
        ok: drift.evaluated && coincide,
        detail: !drift.evaluated
          ? `no evaluado: ${drift.reason ?? "sin razón"}`
          : hallado === undefined
            ? "vehículo plantado sin adopción señalada"
            : `no adoptados: ${hallado.notAdoptedTags.join(", ") || "ninguno"}`,
      };
    },
    "vinculacion-declarada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "vinculacion-declarada")?.tags ?? [])[0];
      const hallado = tagDossiers.find((entry) => entry.tagId === esperado);
      return {
        ok: hallado?.criticalFunction === "vinculacion",
        detail: `función declarada: ${hallado?.criticalFunction ?? "ninguna"}`,
      };
    },
    "desvinculacion-declarada": () => {
      const esperado = (scenario.defects.find((d) => d.kind === "desvinculacion-declarada")?.tags ?? [])[0];
      const hallado = tagDossiers.find((entry) => entry.tagId === esperado);
      return {
        ok: hallado?.criticalFunction === "desvinculacion",
        detail: `función declarada: ${hallado?.criticalFunction ?? "ninguna"}`,
      };
    },
  };

  it("publica el informe por clase", () => {
    const lineas: string[] = [];
    for (const defect of scenario.defects) {
      const resultado = (detecta[defect.kind] as () => { ok: boolean; detail: string })();
      const deuda = DEUDA_CONOCIDA.get(defect.kind);
      const estado = resultado.ok ? "DETECTA" : deuda === undefined ? "FALLA" : "NO DETECTA";
      lineas.push(`  ${estado.padEnd(11)} ${defect.kind} — ${resultado.detail}`);
    }
    console.log(
      `\n=== AUDITORÍA ===\n` +
        `${readings.toLocaleString("es-ES")} lecturas, ${scenario.vehicles.length} vehículos. ` +
        `Anillo reconstruido: ${ring.length} tags de ${scenario.declaredRing.length} declarados. ` +
        `Fuera del anillo: ${offRing.length}.\n` +
        lineas.join("\n") +
        `\n=================\n`,
    );
    expect(ring.length).toBeGreaterThan(0);
  }, PLAZO);

  it("el generador planta lo que dice que planta", () => {
    // Una auditoría cuyo escenario miente es peor que no tener auditoría: daría por bueno un
    // producto que falla, o al revés. Así que el escenario se comprueba contra sí mismo, contando
    // en el CSV generado.
    const cuenta = new Map<string, number>();
    for (const linea of scenario.readingsCsv.split("\r\n").slice(1)) {
      const tag = linea.split(";")[2] as string;
      cuenta.set(tag, (cuenta.get(tag) ?? 0) + 1);
    }

    const base = [...scenario.cleanTags]
      .map((tag) => cuenta.get(tag) ?? 0)
      .sort((a, b) => a - b)[Math.floor(scenario.cleanTags.length / 2)] as number;
    expect(base).toBeGreaterThan(100);

    for (const tag of scenario.defects.find((d) => d.kind === "declarado-sin-lecturas")?.tags ?? []) {
      expect(cuenta.get(tag) ?? 0).toBe(0);
    }

    const altos = scenario.defects.find((d) => d.kind === "lectura-alta")?.tags ?? [];
    for (const tag of altos) {
      const proporcion = (cuenta.get(tag) ?? 0) / base;
      expect(proporcion, `${tag} debería rondar el 95-100 %`).toBeGreaterThan(0.9);
      expect(proporcion).toBeLessThanOrEqual(1.05);
    }

    const medios = scenario.defects.find((d) => d.kind === "lectura-media")?.tags ?? [];
    for (const tag of medios) {
      const proporcion = (cuenta.get(tag) ?? 0) / base;
      expect(proporcion, `${tag} debería quedar entre el 20 y el 90 %`).toBeGreaterThan(0.15);
      expect(proporcion).toBeLessThan(0.95);
    }

    // La rotura parte la ventana por la mitad larga: el tag se lee antes y no después.
    const rotura = scenario.defects.find((d) => d.kind === "rotura-subita");
    for (const tag of rotura?.tags ?? []) {
      const proporcion = (cuenta.get(tag) ?? 0) / base;
      expect(proporcion, `${tag} debería leerse solo hasta la rotura`).toBeGreaterThan(0.3);
      expect(proporcion).toBeLessThan(0.75);
    }

    // El lector degradado tiene que leer bastante menos en la segunda mitad de la ventana que en
    // la primera: es su propio recuento, sin pasar por el producto, lo que prueba que el escenario
    // planta lo que dice y no que el detector lo esté imaginando.
    const degradado = (scenario.defects.find((d) => d.kind === "lector-agv-degradado")
      ?.vehicles ?? [])[0];
    const mitad = (scenario.fromUtcMs + scenario.toUtcMs) / 2;
    let antes = 0;
    let despues = 0;
    for (const linea of scenario.readingsCsv.split("\r\n").slice(1)) {
      const [fecha, agv] = linea.split(";");
      if (agv !== degradado) continue;
      // `parseStamp` deshace los dígitos del CSV; `scenario.fromUtcMs`/`toUtcMs` son el instante
      // real una vez interpretados con la zona declarada (`toRealUtc`). Sin pasar los dos por el
      // mismo marco, la comparación se desplaza dos horas (CEST) y compara cosas distintas.
      if (toRealUtc(parseStamp(fecha as string)) < mitad) antes += 1;
      else despues += 1;
    }
    expect(antes, "el lector degradado debería tener lecturas en la primera mitad").toBeGreaterThan(0);
    expect(despues, "y bastantes menos en la segunda").toBeLessThan(antes * 0.8);
  }, PLAZO);

  it("no señala ningún tag sano: cero falsos positivos", () => {
    const falsos = scenario.cleanTags.filter((tag) => {
      const pattern = rowOf(tag)?.pattern;
      return pattern === "bimodal-candidato" || pattern === "uniforme-bajo";
    });
    expect(falsos, `falsos positivos: ${falsos.slice(0, 8).join(", ")}`).toHaveLength(0);

    // Ningún tag sano debe salir como candidato a punto crítico tampoco.
    const candidatosSobreSanos = scenario.cleanTags.filter((tag) =>
      criticalPoints.some((candidate) => candidate.tagId === tag),
    );
    expect(
      candidatosSobreSanos,
      `candidatos espurios: ${candidatosSobreSanos.slice(0, 8).join(", ")}`,
    ).toHaveLength(0);

    // Ningún tag sano debe traer una función crítica declarada que nadie plantó (Parte 36): las dos
    // vías —«critico» y la columna del circuito virtual— solo declaran los dos tags plantados.
    const funcionesEsperadas = new Set(
      scenario.defects
        .filter((d) => d.kind === "vinculacion-declarada" || d.kind === "desvinculacion-declarada")
        .flatMap((d) => d.tags),
    );
    const funcionesEspurias = scenario.cleanTags.filter((tag) => {
      if (funcionesEsperadas.has(tag)) return false;
      return tagDossiers.find((entry) => entry.tagId === tag)?.criticalFunction != null;
    });
    expect(
      funcionesEspurias,
      `funciones críticas sin plantar: ${funcionesEspurias.slice(0, 8).join(", ")}`,
    ).toHaveLength(0);

    // Ningún tag sano debe aparecer con deriva entre los dos periodos, y ningún vehículo salvo el
    // plantado debe aparecer con tags dejados de leer.
    const derivaSobreSanos = scenario.cleanTags.filter((tag) =>
      drift.tagDrifts.some((entry) => entry.tagId === tag),
    );
    expect(
      derivaSobreSanos,
      `deriva espuria sobre tags sanos: ${derivaSobreSanos.slice(0, 8).join(", ")}`,
    ).toHaveLength(0);

    const esperado = (scenario.defects.find((d) => d.kind === "memoria-actualizada-a-mitad-de-ventana")
      ?.vehicles ?? [])[0];
    const esperadoAdopcion = (scenario.defects.find((d) => d.kind === "memoria-no-actualizada")
      ?.vehicles ?? [])[0];
    const vehiculosConDerivaEspuria = drift.vehicleDrifts.filter(
      (entry) =>
        (entry.droppedTags.length > 0 && entry.agvId !== esperado) ||
        (entry.notAdoptedTags.length > 0 && entry.agvId !== esperadoAdopcion),
    );
    expect(
      vehiculosConDerivaEspuria.map((entry) => entry.agvId),
      `vehículos con deriva sin plantar: ${vehiculosConDerivaEspuria.map((entry) => entry.agvId).join(", ")}`,
    ).toHaveLength(0);

    // La sustitución candidata no puede emparejar de más: el tag nuevo instalado a mitad de ventana
    // (98001, sin ningún desaparecido en su misma posición) tiene que seguir siendo `nuevo` suelto.
    const tagNuevoInstalado = (scenario.defects.find((d) => d.kind === "tag-nuevo-a-mitad-de-ventana")
      ?.tags ?? [])[0];
    const halladoTagNuevo = drift.tagDrifts.find((entry) => entry.tagId === tagNuevoInstalado);
    expect(halladoTagNuevo?.kind, "98001 no debería emparejarse con ningún desaparecido").toBe("nuevo");
  }, PLAZO);

  it("detecta las clases que ya sabe detectar, y sigue haciéndolo", () => {
    const fallos: string[] = [];
    for (const defect of scenario.defects) {
      if (DEUDA_CONOCIDA.has(defect.kind)) continue;
      const resultado = (detecta[defect.kind] as () => { ok: boolean; detail: string })();
      if (!resultado.ok) fallos.push(`${defect.kind}: ${resultado.detail}`);
    }
    expect(fallos, fallos.join(" | ")).toHaveLength(0);
  }, PLAZO);

  it("la deriva entre dos periodos coincide con otras clases ya plantadas, sin sonda propia", () => {
    // Los tags de rotura súbita mueren circuito-wide antes de la mitad de la ventana: tienen que
    // aparecer como `desaparecido` sin que nadie los haya plantado a propósito para esta clase.
    const rotos = scenario.defects.find((d) => d.kind === "rotura-subita")?.tags ?? [];
    const desaparecidos = new Set(
      drift.tagDrifts.filter((entry) => entry.kind === "desaparecido").map((entry) => entry.tagId),
    );
    for (const tag of rotos) expect(desaparecidos.has(tag), `${tag} debería salir desaparecido`).toBe(true);

    // Los tags nunca leídos por nadie tienen que consolidarse con la segunda ventana.
    const nuncaLeidos = scenario.defects.find((d) => d.kind === "declarado-sin-lecturas")?.tags ?? [];
    const consolidados = new Set(
      drift.tagDrifts.filter((entry) => entry.kind === "obsoleto-consolidado").map((entry) => entry.tagId),
    );
    for (const tag of nuncaLeidos) {
      expect(consolidados.has(tag), `${tag} debería salir obsoleto-consolidado`).toBe(true);
    }
  }, PLAZO);

  it("la lista de deuda conocida no miente: si algo empieza a detectarse, hay que sacarlo", () => {
    const yaDetectadas: string[] = [];
    for (const [kind] of DEUDA_CONOCIDA) {
      const resultado = (detecta[kind] as () => { ok: boolean; detail: string })();
      if (resultado.ok) yaDetectadas.push(kind);
    }
    expect(
      yaDetectadas,
      `ya se detectan y siguen en DEUDA_CONOCIDA: ${yaDetectadas.join(", ")}`,
    ).toHaveLength(0);
  }, PLAZO);
});
