---
document_id: TT-REV-001-B
version: 0.1.0
status: informative
last_updated: 2026-10-18
---

# Anexo B — Lógica de dominio

> Informe de uno de los cinco frentes de la revisión general del 2026-10-18 ([`REVISION_2026-10-18.md`](../../REVISION_2026-10-18.md)),
> tal como lo entregó el revisor, sobre el commit `d5ecfee` (3.88.4). Las líneas citadas son las de ese commit;
> las correcciones aplicadas después (3.89.0) las resume el informe principal. Las rutas `<entorno de revisión>`
> eran ficheros temporales (scripts de reproducción, capturas) que no se conservan en el repositorio.
> No se ha editado el contenido.


Repositorio `/home/user/tag-trace`, HEAD `d5ecfee` (3.88.4). Las líneas citadas son las de ese commit.
**Nada del repositorio se ha modificado desde esta revisión.** Durante la sesión otro proceso dejó el árbol
de trabajo sucio (20 ficheros modificados y 3 nuevos, marcas de tiempo 02:49–02:50; en `src/domain` solo
limpieza y caché de formateadores: `activity.ts`, `config.ts`, `dossier.ts`, `graph.ts`,
`snapshot-findings.ts`, `truth.ts`); ninguno de esos cambios es de esta revisión y no se han revertido.
Ninguno mueve las líneas citadas salvo `dossier.ts` (−4 líneas al final).

Método: pruebas `*.test.ts` en `<entorno de revisión>/B/`
con una configuración temporal (`vitest.tmp.config.ts`, `root` apuntando al repo; hizo falta un enlace
simbólico `node_modules` en el scratchpad porque `import "vitest"` no resolvía desde `/tmp`). Se ejecutan con
`cd /home/user/tag-trace && npx vitest run --config <scratchpad>/review/B/vitest.tmp.config.ts`.
La reproducción del bucle infinito está aparte en `hang/` (se lanza con `timeout`) y la de coste en `slow/`.
Resultado final: 18 pruebas en 11 ficheros, todas pasan (es decir, todos los hallazgos se reproducen).

## 1. Cómo fluye el análisis (de lecturas normalizadas a diagnóstico)

1. **Normalizar**: `time.ts` convierte `d/m/aaaa H:MM[:SS]` a UTC en `Europe/Madrid` marcando la hora repetida
   (`dst_ambiguous`) y la inexistente (`dst_nonexistent`); el importador mide el sentido de la pila y ordena
   canónicamente (`order.ts`: instante, hash de fuente, fila). `reading.ts`: IDs de tag y AGV como texto.
2. **Cobertura**: `coverage.ts` da por fuente la ventana *completa* (hasta el penúltimo instante distinto) y la
   cola cortada; la unión de las fuentes es la cobertura. Todo lo que cruza un hueco es «sin datos».
3. **Grafo**: `graph.ts` saca transiciones por AGV (descarta las que cruzan un hueco o llevan hora no fiable),
   aristas con soporte/cuota y tiempo solo por encima de la resolución; `cohort.ts` agrupa AGV por circuito;
   `laps.ts` halla el ciclo dominante, rota al ancla declarada y corta vueltas.
4. **Matriz de lectura**: `read-matrix.ts` cuenta por (tag, AGV) las *pasadas probadas* (vecinos, tiempo, orden
   de convoy) y los aciertos; `tag-changes.ts` acota la vida de cada tag; `vehicle-reading.ts` separa «nunca»,
   «desde», «poco» con cola binomial; `read-rate-trend.ts` busca rotura y degradación.
5. **Tiempos**: `flow-stops.productionStops` detecta la producción parada (huecos de los tags críticos
   improbables por azar); `grouped-delivery.ts` colapsa ráfagas; `segment-bands.ts` da por tramo y régimen
   (producción/noche, `regimeReader`) la horquilla p50/p80/p95 y la valla; `flow-stops.flowStops` clasifica cada
   parada (producción, cola, sin explicación), bloqueos y retenciones.
6. **Estado del circuito**: `circuit-state.ts` concentra retenciones (cuellos), paradas sin explicación (puntos
   conflictivos) y huecos (zonas oscuras) con Poisson; `vehicle-pace.ts` el ritmo por AGV; `silence-kind.ts`
   cómo reaparece cada AGV; `fleet.ts` la vida y el «N de M».
7. **Planta declarada**: `circuit-config.ts` lee calles, zonas, críticos, anclas; `charging.ts` (calles),
   `fifo.ts` (zona cargada), `line-feed.ts` (cadencia, pulmón, paradas de la línea), `critical-points.ts`
   (candidatos), `inventory.ts`/`undeclared-tags.ts`/`circuit-order.ts`/`list-cleanup.ts` (lista vs físico).
8. **Por fichero y entre ficheros**: `franjas.ts` mide cada exportación; `anchor-sections.ts`/`anchor-gaps.ts`/
   `anchor-sums.ts` las secciones y la suma entre anclas; `drift.ts` compara periodos distantes.
9. **Instantánea y memoria**: `snapshot.ts` reduce todo a un grafo con fecha y compara instantáneas;
   `memory.ts` consolida versiones (humano), `change-class.ts` decide qué cambios pasan al esperado,
   `plan.ts` mantiene el plano físico; `plant-values.ts` estima y propone valores de planta.
10. **Incidencias**: `incident-battery.ts` mide cada incidencia; `incident-case.ts` lleva el expediente
    (revisiones con hash), `case-backtrack.ts` la cronología, `replay.ts` el replay, `case-hypotheses.ts`,
    `case-verification.ts`, `case-similarity.ts`; `connection-cuts.ts` sitúa los cortes del terminal.

## 2. Tabla de hallazgos

| ID | Tipo | Grav. | Dónde (HEAD d5ecfee) | Qué | Cómo se reprodujo | Propuesta |
|---|---|---|---|---|---|---|
| B-01 | Fallo | media | `read-matrix.ts:795-808` (`traceLaps`) | No colapsa las relecturas seguidas del ancla: dos lecturas de A separadas 1 s forman una «vuelta» que infla `laps` y cuenta un tramo «sin sostener» (`unproven`) en **todos** los tags. `laps.ts:312-317` sí las colapsa (R-GRA-009). La UI enseña `unproven` («tramos recorridos en menos tiempo», `main.ts:4206-4209`, «sin confirmar» `:5931`). | `b01-…test.ts`: laps=3 (laps.ts: 2), unproven V1=3, por tag `{A:0,B:1,C:1,D:1}` | Colapsar rachas del ancla como `laps.ts` o descartar vueltas sin ningún tag intermedio. |
| B-02 | Contradicción + Fallo | **alta** | `fifo.ts:300-302`, `charging.ts:362-364` (`straddlesGap`) | «Cruza un hueco» se evalúa como *encerrar un hueco entero* en vez de *los dos extremos en el mismo tramo* (`coverage.sameSpan`). Una entrada leída en la cola cortada de una exportación y la salida en la siguiente da una **estancia «completa» de 4 h (`inferred`)** y una **pasada FIFO completa**. Contradice R-DAT-007, R-FLO-001 («una pasada con los extremos en exportaciones distintas no es una pasada») y R-CO-002 («estancia que cruza un hueco… `incompleta` y `unknown`»). El Worker pasa las lecturas con cola y la cobertura de ventanas completas (`import.worker.ts:415,680,1006`). | `b02-…test.ts`: `sameSpan`=false; fifo `passes`=1; charging `completa inferred durationMs=14399000` | Usar `sameSpan(spans, entrada, salida)` como hacen `graph.ts`, `laps.ts`, `anchor-sections.ts`. |
| B-03 | Fallo | **alta** | `line-feed.ts:423` (bucle `for (at = due + p50; at < to; at += p50)`); causa en `:311-314` | Si la mitad o más de los tiempos entre pasos por la línea son 0 (varios AGV en el mismo instante, p. ej. resolución de minuto), la cadencia tiene `p50Ms = 0`, cualquier hueco largo supera la valla (= margen) y el bucle no avanza: **el Worker se cuelga**. Los pares del mismo instante no se excluyen (R-DAT-013) ni se comprueba la resolución (como sí hace `grouped-delivery.ts:103`). | `hang/b03-…test.ts` matado por `timeout 45` (exit 143); `b03b`: `bandOf(39×0 + 3,6 M)` → `p50Ms 0, fenceMs 30000`; misma entrada con 1 s de separación termina en 53 ms | Excluir gaps 0 y no medir con resolución de minuto; paso del bucle `max(p50, resolución)`; prueba con instantes repetidos. |
| B-04 | Unknown (regla documentada) | media | `time.ts:302-308` (`splitRepeatedHourRun`) | Racha ambigua sin retroceso **seguida** de 03:xx → se afirma «segunda ocurrencia»; **precedida** de 01:xx sin 03:xx → se deja ambigua. El código cumple ADR-0013 (nota 2026-09-26, l. 118-121) y R-DAT-013, pero las dos situaciones son simétricas: ambas requieren una hora entera sin lecturas de toda la flota, plausible la madrugada del domingo de octubre (parada de producción). Afirmar la segunda es elegir la hipótesis más probable, que la propia nota prohíbe en el caso simétrico. | `b04-…test.ts`: caso A `02:10 → 2026-10-25T01:10Z dst_by_position`; caso B `dst_ambiguous` | Decisión del propietario (OQ): exigir evidencia simétrica (01:xx delante **y** 03:xx detrás) o dejar ambas rachas ambiguas. |
| B-05 | Límite | baja | `graph.ts:314-317` (`quantile`), `segment-bands.ts:147-162` (`bandOf`) | `quantile([])` devuelve 0 y `bandOf([])` una horquilla de ceros con valla = margen y `samples: 0`. Hoy todos los llamadores guardan la longitud antes, pero es una API exportada que convierte «sin muestras» en 0. | `b05-…test.ts`: `{samples:0,p50Ms:0,p80Ms:0,p95Ms:0,fenceMs:30000}` | Devolver `null`/lanzar con lista vacía. |
| B-06 | Unknown | media | `snapshot.ts:970-978` (`driftBetweenSnapshots`, `droppedByVehicle`) | «No estar en `nonReaders` del periodo temprano» se toma como «lo leía» (ALGORITHM_CATALOG §6.21: «se toma como lector suyo»). Un AGV que **no pasó** por el sitio del tag en el periodo temprano sale con `droppedTags`. La versión desde lecturas (`drift.ts:464-471`) exige ≥ `minReadingsPerVehicle` lecturas del tag; las dos implementaciones de R-AGV-013 no dicen lo mismo. | `b06-…test.ts`: `[{"agvId":"V2","droppedTags":["B"],"notAdoptedTags":[]}]` con V2 sin pasada por B antes | Exigir lecturas previas con `byVehicle` del vértice (pasadas y aciertos, R-MEM-004); sin desglose, no afirmar. |
| B-07 | Contradicción (reconocida) | media | `inventory.ts:298-301, 394` | `ciego-parcial` = testigos con ≥ 10 lecturas que **nunca** leyeron el tag, sin probar que pasaran por su sitio. R-OPP-008: «“Tags que un AGV no ha leído” nunca se calcula como diferencia entre el catálogo del circuito y lo que leyó»; R-OPP-013 exige pasada probada. `config.ts:126-128` lo reconoce («cota grosera… hasta que existan las vueltas»), y las vueltas ya existen (`read-matrix.ts`). | `b07-…test.ts`: V3 solo recorre R1–R3 → T `ciego-parcial inferred revisar-memoria-de-vehiculos ['V3']` | Alimentar `blindVehicles` con `nonReaders` de la matriz (pasadas probadas) o degradar a `unknown` sin acción. |
| B-08 | Límite | baja | `flow-stops.ts:313` vs `plant-values.ts:503-505` | `sameTimeRepetitions` compara minutos del día sin dar la vuelta a medianoche (23:55 vs 00:05 → 1430 min); `plant-values.minuteDiff` sí es circular. | `b08-…test.ts`: `[1, 0, 1]` (la de 00:05 no empareja con 60 min de tolerancia) | Diferencia circular en `sameTimeRepetitions`. |
| B-09 | Rendimiento | baja | `connection-cuts.ts:148-157`, `fifo.ts:242-249`, `charging.ts:329-332`, `connection-cuts.ts:460-461`, `franjas.ts:264-270` | O(n²) sobre cortes, pasadas y estancias; O(cortes×ráfagas); O(pares²×franjas). No sobre lecturas (esas son O(n log n)). | `slow/b09-…test.ts`: `markCollective` 20 000 cortes 2 196 ms; FIFO 20 000 pasadas 1 764 ms | Ventana deslizante por tiempo (las listas ya están ordenadas). |
| B-10 | Determinismo | baja | `undeclared-tags.ts:99`, `line-feed.ts:208`, `dossier.ts:156`, `charging.ts:406`, `fifo.ts:327`, `incident-battery.ts:151`, `fleet.ts:314`, `replay.ts:78`, `connection-cuts.ts:109,191` | Ordenan solo por `utcMs`: dos lecturas del mismo instante heredan el orden del array; `compareReadings` (ADR-0013) no se usa. Hoy es determinista porque el importador ordena canónicamente antes (`importer.ts:500`), pero el dominio no lo garantiza. | `b10-…test.ts`: `dominantNeighbours` da `{P,Q}` o `{Q,R}` según el orden de dos lecturas del mismo instante | Ordenar con `sortReadings`/`compareReadings` o documentar la precondición en cada firma. |
| B-11 | Límite | baja | `segment-bands.ts:142-145` (`sourceResolutionMs`) | Una **sola** transición medible de exactamente 60 000 ms pone toda la fuente en «minuto»: se desactivan ráfagas (`grouped-delivery.ts:103`), parada precisa y semáforo (`critical-points.ts:374-376`) y la valla sube a ≥ 60 s. R-DAT-015 dice que la resolución «se mide al importar». | `b11-…test.ts`: `[{0,60000}]` → 60000; `[{0,61000}]` → 1000 | Mínimo de transiciones o tomar la resolución medida por el importador. |
| B-12 | Unknown → 0 | baja | `dossier.ts:237-244` + `:220` | `median([])` devuelve 0: un AGV solo en su cohorte sale con `cohortMedianReadings: 0` (la mediana de nadie). | `b11-…test.ts`: `cohortSize = 1 cohortMedianReadings = 0` | `null` y tipo `number \| null`. |
| B-13 | Límite | baja | `segment-bands.ts:107`, `plant-values.ts:244-245, 513-516` | `nightFromHour === nightToHour` ⇒ nunca noche, en silencio; `validatePlantValue` valida cada clave por separado, así que una persona puede confirmar `noche-desde = noche-hasta` y la noche desaparece sin aviso. CONFIG_SCHEMA §3.2 solo dice «puede cruzar la medianoche». | `b12-…test.ts`: ambas claves válidas con 22; `regimeReader(22,22)` → todo `produccion` | Validar el par (o declarar el caso) al confirmar. |
| B-14 | Constante fija | baja | ver §3.14 | Ningún valor de planta nuevo fuera de `config.ts`. Literales de criterio sin comentario: `QUARTER_MS` 15 min (`segment-bands.ts:236`, `flow-stops.ts:182`; en `silence-kind.ts:109-116` sí justificado), «la mitad» en `flow-stops.ts:602,727`, `fleet.ts:371`, `circuit-state.ts:435`, cuantiles 0,1/0,9 informativos `line-feed.ts:587-588`. | inspección (`literales.txt`) | Comentar o compartir la constante; nada que mover a configuración. |
| B-15 | Pruebas | media | `tests/unit`, `tests/audit` | Sin prueba propia: `time.ts` (451 l., solo vía `importer.test.ts`), `connection-cuts.ts` (542 l., solo `connection-log.test.ts`, 12 casos), `circuit-config.ts`, `config.ts` (coherencia con CONFIG_SCHEMA), `coverage.ts`, `order.ts`, `activity.ts`. Casos límite ausentes que habrían cazado B-01 (ancla releída en `read-matrix.test.ts`), B-02 (cola cortada: `charging.test.ts:315` y `fifo.test.ts:218` solo prueban «encierra un hueco entero»), B-03 (instantes repetidos en `line-feed.test.ts`), B-13. TC-266 (TEST_STRATEGY) fija el comportamiento de B-04 como intencionado. | `grep` de imports y casos | Añadir los casos límite citados; prueba de `regimeReader` y `plantValuesView` con horas iguales. |

## 3. Detalle de cada hallazgo

### 3.1 B-01 — relectura seguida del ancla en `read-matrix.ts`

`traceLaps` (`read-matrix.ts:795-808`) corta una vuelta en **cada** lectura del ancla; `segmentLaps`
(`laps.ts:312-317`) colapsa las rachas («dos lecturas seguidas no son una vuelta de segundos», R-GRA-009).
Con anillo `A,B,C,D` y la secuencia `A B C D A A B C D A` (la segunda A a 1 s):

```ts
const laps = segmentLaps(readings, "oldest-first", [], "A", "inferred");           // 2 completas
const matrix = buildReadMatrix(1, readings, "oldest-first", [], ring, "A", cfg.readRate, limits, cfg.trend);
```

Salida real: `laps= 3 unproven por AGV= 3 unproven por tag= { A: 0, B: 1, C: 1, D: 1 }`. La mini‑vuelta
`[A, A]` encierra B, C y D con `expected` ≈ 40 s y `observed` = 1 s < 0,6·expected → `unproven`, que la vista
convierte en «tramos recorridos en menos tiempo del que tardan» y «sin confirmar».

### 3.2 B-02 — cola cortada en FIFO y calles

`straddlesGap = (from, to) => gaps.some((gap) => from <= gap.from && to >= gap.to)` (`fifo.ts:301-302`,
`charging.ts:363-364`). La cola cortada de una exportación está **fuera** de su tramo `complete`, así que
`from` cae dentro del hueco y la condición es falsa. Cobertura `[0, 60 min] ∪ [300, 540 min]`, entrada en el
minuto 61 (cola) y salida en el 301:

```ts
sameSpan(coverage, 61*MIN, 301*MIN)                              // false
buildFifoReport(1, [E@61min, X@301min], [span], cfg.fifo, coverage).spans[0].passes   // 1
buildChargingReport([E@61min, P@61min+1s, X@301min], [lane], coverage, cfg.charging).lanes[0].stays[0]
```

Salida real: `fifo passes completas = 1`; `charging stay = completa inferred durationMs = 14399000`.
R-DAT-007 (revisión 2026-09-26): «Una transición, una vuelta, una estancia o una pasada valen solo si sus
dos extremos caen en el mismo tramo de cobertura… la cola cortada de una exportación queda fuera de su
tramo completo y antes se emparejaba con la primera lectura de la siguiente». Esa estancia entra en la
mediana, en «permanencia larga» y en el orden de salida (R-CO-002 lo prohíbe). En el Worker
(`import.worker.ts:680`) `readings` incluye las colas (la unión las conserva, `union.ts:172`) y `coverage`
es la unión de `complete` (`:415`), así que el caso ocurre en cada frontera entre exportaciones.

### 3.3 B-03 — bucle infinito en `line-feed.ts`

`cadence = bandOf(gaps…)` (`:311-314`) sin excluir tiempos entre pasos de 0 ms. Con 40 AGV leyendo la entrada
en el mismo instante y uno a la hora, `durations = [0×39, 3 600 000]`:

```ts
bandOf([...Array(39).fill(0), 3_600_000], 30_000)   // { samples: 40, p50Ms: 0, p80Ms: 0, p95Ms: 0, fenceMs: 30000 }
```

El hueco de 1 h supera la valla (30 s) → es `stopGap` → `:423`: `for (let at = due + band.p50Ms; at < gap.to.utcMs; at += band.p50Ms)`
con `p50Ms = 0` no termina. Reproducción directa (`hang/b03-line-feed-hang.test.ts`, 81 lecturas sintéticas):
`timeout 45 npx vitest run --config …/hang/vitest.hang.config.ts` → `Terminated`, exit 143 a los 45 s. La
misma entrada con 1 s entre AGV: `p50 = 1000 stops = 1 ms = 51`. Con resolución de minuto (la fuente real,
«el 71 % de las transiciones tiene Δt cero», `graph.ts:20-22`) dos AGV por minuto en la entrada bastan.

### 3.4 B-04 — asimetría al resolver la hora repetida

```ts
resolveRepeatedHourByPosition([01:50 ok, 02:10 amb, 02:20 amb, 03:05 ok])  // caso A
resolveRepeatedHourByPosition([01:50 ok, 02:10 amb, 02:20 amb])            // caso B
```

Salida real: caso A `02:10 → 2026-10-25T01:10:00Z dst_by_position`, `02:20 → 01:20Z` (segunda ocurrencia,
`resolvedByPosition 2`); caso B las dos siguen `dst_ambiguous`. ADR-0013 (l. 118-121): «ningún retroceso y la
lectura siguiente es `ok`, del mismo día y de las 03:xx: la racha entera es la segunda ocurrencia; cualquier
otro caso —… precedida por 01:xx sin 03:xx detrás…— se queda `dst_ambiguous`. Parecer la primera no basta:
la exportación pudo cortarse en medio de la segunda». En A, que la racha sea la primera ocurrencia exige
una segunda hora (02:00–02:59 CET) sin ninguna lectura de la flota; en B, que sea la segunda exige una
primera hora igual de vacía. Las dos hipótesis descartadas son la misma («una hora entera sin lecturas»),
y en la madrugada del último domingo de octubre una parada de producción de una hora es ordinaria. El
código hace lo que la nota dice; la nota decide por verosimilitud en un caso y no en el otro (R-EVI-004).
`time.ts` solo se prueba a través de `importer.test.ts` (TC-266 fija este comportamiento).

### 3.5 B-05 — `quantile` y `bandOf` con lista vacía

`quantile([], 0.5)` → `sorted[-1] ?? 0` = 0. `bandOf([], 30_000)` →
`{ samples: 0, meanMs: 0, m2: 0, p50Ms: 0, p80Ms: 0, p95Ms: 0, fenceMs: 30000 }`. Todos los llamadores actuales
comprueban la longitud (`anchor-gaps.ts:309`, `plant-values.ts:394`, `segment-bands.ts:190`, `line-feed.ts:299`),
pero una horquilla «válida» de ceros es justo el 0 silencioso que CONFIG_SCHEMA §2.5 prohíbe.

### 3.6 B-06 — `droppedTags` desde instantáneas

```ts
early: B.nonReaders = []        // V2 no pasó por el sitio de B: ni lector ni no lector
late:  B.nonReaders = ["V2"]
driftBetweenSnapshots(early, late, cfg.drift).vehicleDrifts
```

Salida real: `[{"agvId":"V2","droppedTags":["B"],"notAdoptedTags":[]}]`. `snapshot.ts:973-976`:
`readBefore = new Set(previous.nonReaders)` y se añade si `!readBefore.has(agvId)`. La instantánea sí trae con
qué hacerlo bien (`byVehicle: [pasadas, aciertos]` por AGV, R-MEM-004), y `drift.ts:464-471` desde lecturas
exige `count >= minReadingsPerVehicle` del propio tag. El catálogo lo documenta como aproximación
(«se toma como lector suyo»), pero R-AGV-013 habla de «un vehículo que leía un conjunto de tags».

### 3.7 B-07 — `ciego-parcial` sin pasada probada

```ts
// V1, V2: 10 vueltas por A,T,B.  V3: 10 vueltas por R1,R2,R3 (otra rama).  Todos los tags en circuito y memoria.
buildTagInventory(readings, lists, cfg.blindness).rows.find(r => r.tagId === "T")
```

Salida real: `ciego-parcial inferred revisar-memoria-de-vehiculos [ 'V3' ]`. `inventory.ts:298-301`:
`blindVehicles = readers.size >= minReadersForContrast ? witnesses.filter(agv => !readers.has(agv)) : []`.
R-OPP-008: «“Tags que un AGV no ha leído” nunca se calcula como diferencia entre el catálogo del circuito y
lo que leyó. Solo cuentan las oportunidades elegibles: un tag de una rama que ese AGV no recorre… no es una
ausencia». El propio comentario de `config.ts:126-128` lo asume: «Es una cota grosera y lo seguirá siendo
hasta que existan las vueltas, que es la normalización correcta (R-OPP-010)»; las vueltas y las pasadas
probadas ya existen (`read-matrix.ts`, `TagReadRow.byVehicle`, `nonReaders` en la instantánea).

### 3.8 B-08 — «a la misma hora» no cruza la medianoche

```ts
sameTimeRepetitions([01/09 23:55, 03/09 00:05, 05/09 23:50], "Europe/Madrid", 60*60_000)
```

Salida real: `[1, 0, 1]` — la parada de las 00:05 no se empareja con la de las 23:55 (|5 − 1435| = 1430 min)
aunque disten 10 min de reloj. `plant-values.ts:503-505` (`minuteDiff`) sí hace el camino corto.

### 3.9 B-09 — coste cuadrático

`markCollective` (`connection-cuts.ts:148-157`) recorre todos los cortes para cada corte; `findOvertakes`
(`fifo.ts:242-249`) y `seniorityBreaches` (`charging.ts:329-332`) comparan cada pasada con las posteriores;
`burstsWithCut`/`cutsWithBurst` (`connection-cuts.ts:460-461`) cortes × ráfagas; `segmentHistories`
(`franjas.ts:264-270`) hace `find` por par y franja. Medido: `markCollective 20k cortes: 2196 ms`,
`fifo 20k pasadas: 1764 ms`. Un terminal ruidoso (R-COM-009, «constantemente conexiones y desconexiones»)
en tres días llega a esas cifras; 100 000 cortes serían ~25×. No es sobre el número de lecturas.

### 3.10 B-10 — empates de instante

```ts
a = [P@1000, U@2000, Q@2000, R@3000];  b = [P, Q, U, R]  // mismas lecturas
dominantNeighbours(a, {U}).get("U")  // { predecessor: 'P', successor: 'Q' }
dominantNeighbours(b, {U}).get("U")  // { predecessor: 'Q', successor: 'R' }
```

`undeclared-tags.ts:99` ordena con `(a, b) => a.utcMs - b.utcMs`; la ordenación es estable y el empate lo
decide el orden de entrada, no `compareReadings` (`order.ts`, hash de fuente y fila con el sentido de la
pila). Mismo patrón en `line-feed.ts:208`, `dossier.ts:156`, `charging.ts:406`, `fifo.ts:327`,
`incident-battery.ts:151`, `fleet.ts:314`, `replay.ts:78`, `connection-cuts.ts:109,191`. Hoy no se manifiesta
porque `importer.ts:500` ordena canónicamente antes, pero `anchor-sums.ts`, `drift.ts`, `tag-changes.ts`,
`case-backtrack.ts` y `incident-case.ts` sí desempatan explícitamente: el criterio no es uniforme.

### 3.11 B-11 — resolución decidida por una transición

`sourceResolutionMs` (`segment-bands.ts:142-145`) devuelve 60 000 si **todas** las transiciones medibles son
múltiplos de 60 s: `[{0,60000}]` → 60000, `[{0,60000},{0,120000}]` → 60000, `[{0,61000}]` → 1000. Con pocas
transiciones (fichero corto, cohorte pequeño, franja) una coincidencia pone el análisis en modo minuto.

### 3.12 B-12 — mediana de cohorte vacía = 0

`buildAgvDossier("V1", …, { cohorts: [{ id: 0, vehicles: ["V1"] }] }, …)` →
`cohortSize = 1 cohortMedianReadings = 0`. `dossier.ts:237-244`: `if (values.length === 0) return 0`.

### 3.13 B-13 — noche con inicio = fin

`validatePlantValue("noche-desde", 22)` y `("noche-hasta", 22)` → `null` (válidos);
`regimeReader("Europe/Madrid", { nightFromHour: 22, nightToHour: 22 })` → `produccion` a las 0, 6, 12, 18, 22
y 23 h locales (`segment-bands.ts:107`: `from === to ? false : …`). Cada clave se confirma por separado
(`plantValueEventFor`), así que el par degenerado se puede guardar sin aviso.

### 3.14 B-14 — inventario de literales numéricos (fuera de `config.ts`)

Barrido con `grep` (fichero `literales.txt` en el scratchpad) y lectura de cada línea:

- **Justificados con comentario y/o regla**: `MIN_TESTED_VEHICLES = 3` (`vehicle-pace.ts:119-124`, R-AGV-019),
  `REGIME_SCAN_MS`/`REGIME_RESOLUTION_MS` (`incident-battery.ts:385-392`), `QUARTER_MS` en
  `silence-kind.ts:109-116`, `MAX_PLANT_DURATION_MS` 24 h (`plant-values.ts:102-107`), `SIGNIFICANT_DIGITS 12`
  (`semantic-hash.ts:22-28`), `FIFO_FOCUS_MAX 30` y `TREND_SERIES_BINS 24` (pantalla), `CARDS_SHOWN`
  (`finding-kinds.ts:144-155`), Stirling (`charging.ts:522-531`) y erfc (`vehicle-pace.ts:169-174`), los cuantiles
  0,5/0,8/0,95 de `bandOf` (R-FLO-007), `quantileOf(0.05)` (`line-feed.ts:637`, R-FLO-011 «el 5 %»),
  `count * 2 >= n` («la mitad de los pasos», R-FLO-010/011), `lineStoppedMs * 2 >= durationMs` (R-AGV-021).
- **Sin comentario propio**: `QUARTER_MS` en `segment-bands.ts:236` y `flow-stops.ts:182` (paso de muestreo,
  copiado de `silence-kind.ts`); `0.5 * stop.excessMs` (`flow-stops.ts:602`, «a mitad de la parada» de
  R-AGV-018, pero mide solape con la producción parada, no la mitad); `0.5 * duración de la parada`
  (`flow-stops.ts:727`, qué AGV cuentan como «dentro»); `stopped >= 0.5 * (to - from)` (`fleet.ts:371`);
  `skipShare >= 0.5` (`circuit-state.ts:435`, «la mitad o más» en §6.7); `at(0.1)`/`at(0.9)` del ciclo local
  (`line-feed.ts:587-588`, solo informativos, sin regla).
- **Ninguno es un valor de planta**: no hay minutos, horas de turno ni capacidades fuera de `PROVISIONAL_CONFIG`.
- **IDs**: todas las conversiones a número son sobre contadores, índices o campos de fecha
  (`anchor-sums.ts:574` índice de tramo; `plan.ts:450,972` número de `U-000n`; `incident-case.ts:294`
  contador del expediente; `time.ts:327-335`). Ningún `Number(tagId)`/`Number(agvId)`.

### 3.15 B-15 — pruebas

Módulos de `src/domain` sin fichero de prueba propio: `activity`, `case-export`, `case-verification`,
`circuit-config`, `config`, `connection-cuts`, `coverage`, `order`, `reading`, `semantic-hash`,
`snapshot-findings`, `tag-lists`, `time`, `truth`. Los que pesan: `time.ts` (451 líneas; `parseTimestamp`,
`resolveRepeatedHourByPosition` y `detectFieldOrder` solo a través de `importer.test.ts`),
`connection-cuts.ts` (542; `markCollective`, `summarizeConnections`, `locateCuts` solo desde
`connection-log.test.ts`, 12 casos), `circuit-config.ts` (371; calles mal declaradas solo de paso en
`charging.test.ts`). Casos límite que habrían cazado los hallazgos: ancla releída (`read-matrix.test.ts`),
entrada en la cola cortada (`charging.test.ts:315-335` y `fifo.test.ts:218-232` prueban solo «encierra un
hueco entero»), pasos por la línea en el mismo instante (`line-feed.test.ts`), horas de noche iguales, lista
vacía en `quantile`/`bandOf`. `tests/audit/auditoria.test.ts` (2 225 líneas) es un buen contrapeso (cero
falsos positivos sobre un circuito con la verdad plantada), pero su generador no produce instantes repetidos
ni colas cortadas, que son las dos entradas que rompen.

## 4. Qué está bien hecho

- **Secuencia y tiempo separados** (`graph.ts`): pares del mismo instante y horas no fiables no forman
  arista ni tiempo; `sameSpan` se aplica en grafo, vueltas, secciones y sumas entre anclas.
- **`unknown` respetado casi en todo**: `sin-ocasion`/`sin-medir`/`sin-juzgar`/`null` en matriz, plano,
  sumas, batería; `dominant` devuelve `null` en empate (R-EVI-004); `classifySilence` no afirma «parado» sin
  habitual; `readingShift`/`absenceTest` exigen oportunidades.
- **Estadística robusta y numéricamente cuidada**: Poisson y binomial en logaritmos, Stirling, Welford y
  combinación de Chan (`plan.ts`), pruebas de azar con corrección por número de sitios.
- **Determinismo**: ningún `Date.now`/`Math.random` en el dominio; `canonicalise` rechaza NaN, Map y Set;
  `cohort.ts` evita `localeCompare` sin locale; `localeCompare` solo aparece en ordenaciones de presentación
  y con locale fijo donde importa (`circuit-config.ts:117`).
- **IDs como texto** en todo el dominio; `0040` nunca se convierte.
- **Cobertura y procedencia**: cada hallazgo lleva fila/hash; `freezeEvidence` deduplica por procedencia;
  cadenas de hash en memoria y expedientes verificables (`lineageChainProblem`, `verifyChain`).
- **Configuración**: todos los umbrales de planta viven en `PROVISIONAL_CONFIG` con su razón escrita; las
  funciones de dominio no tienen valores por defecto.
- **DST**: `wallClockToUtc` detecta las dos ocurrencias y la hora inexistente sin iterar, y `localHourReader`
  cachea por cuartos de hora de forma correcta para `Europe/Madrid`.

## Ficheros de la reproducción

`<entorno de revisión>/B/`:
`vitest.tmp.config.ts`, `helpers.ts`, `b01-read-matrix-anchor-reread.test.ts`, `b02-straddles-gap.test.ts`,
`b03b-line-feed-cause.test.ts`, `b04-dst-asymmetry.test.ts`, `b05-quantile-empty.test.ts`,
`b06-drift-snapshots-nonreaders.test.ts`, `b07-inventory-blind.test.ts`, `b08-same-time-midnight.test.ts`,
`b10-tie-order.test.ts`, `b11-minor-edges.test.ts`, `b12-night-equal-hours.test.ts`,
`hang/b03-line-feed-hang.test.ts` (+ `hang/vitest.hang.config.ts`, lanzar con `timeout`),
`slow/b09-quadratic.test.ts` (+ `slow/vitest.slow.config.ts`), `literales.txt`.
