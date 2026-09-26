---
document_id: TT-TRACE-001
version: 0.51.0
status: baseline-candidate
last_updated: 2026-09-26
---

# Matriz de trazabilidad

La matriz se ampliará hasta una relación automática cuando exista código. En F0 demuestra que cada bloque de valor posee reglas, algoritmos, pruebas y puerta. Desde F1a·0 ya existe código, y la sección final relaciona cada caso cubierto con el módulo y la prueba que lo sostienen.

| Requisitos | Reglas/decisión | Algoritmos | Pruebas | Fase/puerta |
|---|---|---|---|---|
| FR-001–003 | R-DAT-006, ADR-0004 | ALG-003 | TC-014, INV-009 | F1/G1 |
| FR-004–008 | R-DAT-001–008, ADR-0002, ADR-0013 | ALG-001–002 | TC-015, TC-019–023, INV-001–006, INV-013–014 | F1/G1 |
| FR-009–011 | R-GRA-001–006, ADR-0003 | ALG-004–006 | TC-001, TC-005–006, TC-018 | F2/G2 |
| FR-012–015 | R-EVI-001–005, R-AGV-001–005, R-OPP-007 | ALG-007–010 | TC-002–007, TC-016, TC-024–025 | F3/G3 |
| FR-033–035 | R-AGV-001, R-AGV-004, R-AGV-006, R-OPP-008, R-COM-003, R-DAT-007 | ALG-018–019 | TC-026–029 | F2/G2 reducido y F3/G3 completo |
| FR-016 | R-FLO-001–005, R-CO-001–005 | ALG-011–013 | TC-008–012 | F3/G3 |
| FR-017, FR-030 | R-TIM-001–007, `CONFIG_SCHEMA.md` | ALG-010, ALG-013 | TC-012–013 | F1/G1 y F3/G3 |
| FR-018–021, FR-027 | R-MEM-001–003, ADR-0005, ADR-0012 | ALG-014 | TC-017–018, INV-006–011 | F1/G1 y F4/G4 |
| FR-022–026 | R-INC-001–003, ADR-0006 | ALG-015–017 | TC-012, TC-017, INV-008 | F5/G5 |
| FR-028–029 | ADR-0008 | Todos vía vistas | E2E por flujo, accesibilidad | F3–F6/G6 |
| FR-031–032 | ADR-0003, ADR-0010 | Registro común | INV-010–012 | F1–F6 |
| NFR-001–002, NFR-015 | ADR-0001, ADR-0007, ADR-0014 | N/A | Pruebas de red/secretos, guardián de datos en CI | Todas |
| NFR-003, NFR-009 | ADR-0008, `WORKER_PROTOCOL.md` | ALG-001 y pipeline | TC-020, PERF-D2–D4 | F1/F6 |
| NFR-004–006, NFR-014 | ADR-0002–0003, ADR-0013 | Todos | Casos de oro + determinismo | F2–F6 |
| NFR-007–008 | ADR-0005 | ALG-014 | Round-trip y crecimiento | F4/G4 |
| NFR-010–012, NFR-016 | ADR-0001, ADR-0009, ADR-0014 | Build/PWA | Offline, update, rollback | F6/G6 |
| NFR-013 | UX specification | Presentación | E2E/accesibilidad | F6/G6 |

## Implementación

Lo cubierto hoy por código ejecutable. Lo que no aparece aquí **no está implementado**, aunque su
regla exista: la matriz no es una lista de intenciones.

| Caso o invariante | Módulo | Prueba |
|---|---|---|
| TC-019 delimitadores e identidad | `src/ingestion/delimiter.ts` | `tests/unit/importer.test.ts` · «TC-019 · delimitadores e identidad» |
| TC-020 cancelación cooperativa (parte de importación) | `src/ingestion/importer.ts`, `workers/import.worker.ts` | «TC-020 · cancelación cooperativa» |
| INV-002 ceros iniciales conservados | `src/ingestion/importer.ts` | «INV-002 · los ceros iniciales sobreviven al recorrido completo» |
| ADR-0013 orden de pila y desempate intra-instante | `src/domain/order.ts` | «orden canónico · la corrección de ADR-0013» |
| ADR-0013 tiempo canónico y marca DST | `src/domain/time.ts` | «cambio horario · ADR-0013» |
| R-DAT-008 monotonía medida, no exigida | `src/ingestion/monotonicity.ts` | «monotonía · R-DAT-008» |
| WP-001/WP-002 sin cálculo en el hilo principal | `src/presentation/main.ts` (sin importar `ingestion/`) | `tests/unit/layering.test.ts` |
| WP-003 mensajes caducados descartados | `src/application/protocol.ts` (`isCurrent`) | Pendiente de prueba propia |
| WP-005 cero filas con causa | `src/ingestion/importer.ts` | «WP-005 · cero filas es una respuesta con causa» |
| Cuarentena con motivo y procedencia | `src/domain/reading.ts`, `src/ingestion/importer.ts` | «filas no aceptadas · se conservan con su motivo» |
| R-DAT-009 una fila sin tag no es un defecto | `src/domain/reading.ts` (`isDefect`), `src/ingestion/importer.ts` | «una fila con instante y AGV pero sin tag no es un defecto» |
| R-DAT-010 codificación detectada y declarada | `src/ingestion/decode.ts` | «codificación · no se supone UTF-8» |
| TC-015 / TC-021 unión por tramo común | `src/ingestion/union.ts` | `tests/unit/circuit.test.ts` |
| R-DAT-007 cobertura y borde parcial | `src/domain/coverage.ts` | `tests/unit/circuit.test.ts` |
| INV-010 / INV-011 hash semántico e ida y vuelta | `src/domain/semantic-hash.ts`, `src/persistence/agvproj.ts` | `tests/unit/agvproj.test.ts`, `tests/e2e/protocolo.spec.ts` |
| TC-036–TC-041 acumulación, persistencia, protocolo y red | `src/persistence/store.ts`, `workers/import.worker.ts` | `tests/e2e/` |
| TC-042–TC-047 inventario contrastado | `src/domain/inventory.ts` | `tests/unit/inventory.test.ts` |
| R-DAT-016 obsoleto y averiado no se separan con una ventana | `src/domain/inventory.ts` (`classify`) | «un tag en memoria que nadie ha leído jamás…» |
| R-OPP-011 en memoria **y** existente | `src/domain/inventory.ts` | «…es candidato a obsoleto, y queda unknown» |
| R-OPP-012 la memoria individual no se observa | `src/domain/inventory.ts` (`truth: "inferred"`) | «un tag que unos leen siempre y otro nunca…» |
| FR-009 / ALG-005 grafo observado por transiciones | `src/domain/graph.ts` | `tests/unit/graph.test.ts` |
| FR-011 soporte, cuota y confianza por arista | `src/domain/graph.ts` (`Edge`) | «reconstruye las aristas de un anillo…», «una bifurcación reparte la cuota…» |
| TC-048 una transición no cruza un hueco de cobertura | `src/domain/graph.ts` (`straddlesGap`) | «no empareja a través de un hueco de cobertura, y lo dice» |
| TC-049 / R-DAT-013 el mismo instante no ordena | `src/domain/graph.ts` (`sequenceTruth`) | «una arista sostenida en pares del mismo instante…» |
| TC-050 secuencia `observed` con tiempo `unknown` | `src/domain/graph.ts` (`summariseTime`) | «con la resolución de la fuente por encima del paso real…» |
| TC-052 / ADR-0013 el sentido decide la dirección | `src/domain/order.ts`, `src/domain/graph.ts` | «el sentido de la fuente decide la dirección…» |
| FR-003 / R-DAT-006 / ALG-003 afinidad de circuito | `src/domain/affinity.ts`, `workers/import.worker.ts` | `tests/unit/affinity.test.ts`, `tests/e2e/vistas.spec.ts` |
| TC-053 una fuente ajena no se consolida | `workers/import.worker.ts` (`accumulate`) | «una exportación de otro circuito no se acumula…» |
| DS-002 / DS-006 / DS-008 importación de listas | `src/ingestion/catalog.ts`, `src/domain/tag-lists.ts` | `tests/unit/catalog.test.ts` |
| TC-056 las listas sobreviven a una importación | `workers/import.worker.ts` (`accumulate`) | «cargar listas y ver el inventario contrastado…» |
| R-EVI-006 el programa enuncia, la persona decide | `src/domain/inventory.ts` (`describeAction`) | «cada clase indica qué hay que valorar…» |
| FR-030 umbrales fuera del código | `src/domain/config.ts` | Todos los módulos los exigen como parámetro: sin ellos no compilan |
| UX §5.2 las cuatro vistas | `src/domain/activity.ts`, `src/presentation/charts.ts` | `tests/e2e/vistas.spec.ts` |
| R-DAT-012 / TC-207 agrupamiento por circuito (parecido de tags, aristas y tags propios) | `src/domain/cohort.ts`, `src/domain/config.ts` (`cohorts`) | `tests/unit/cohort.test.ts` |
| ALG-004 vueltas por AGV, ancla por ciclo dominante o declarada (`resolveDeclaredAnchor`, R-GRA-009) | `src/domain/laps.ts`, `src/domain/circuit-config.ts` (`readLapAnchors`) | `tests/unit/laps.test.ts` |
| ALG-018 expediente de AGV y tag (`UX_SPEC.md` §4.1) | `src/domain/dossier.ts` | `tests/unit/dossier.test.ts` |
| R-GRA-001 contraste contra Vsystem por alineación de secuencia (LCS) | `src/domain/vsystem.ts` | `tests/unit/vsystem.test.ts` |
| `PERFORMANCE_BUDGET.md` §6 replay básico determinista, posición como fracción temporal | `src/domain/replay.ts` | `tests/unit/replay.test.ts` |
| R-GRA-010 / TC-065 antes de la primera lectura es `sin datos`, no silencio | `src/domain/replay.ts` (`stateAt`) | «antes de su primera lectura, el vehículo no tiene posición inventada **ni silencio**», `tests/e2e/f2.spec.ts` |
| TC-067 / UX §4.1 los dos extremos de cada silencio | `src/domain/dossier.ts` (`InactivityPeriod`) | «cada silencio conserva sus dos extremos…» |
| R-OPP-013 / TC-069–073 tasa de lectura por pasada probada | `src/domain/read-matrix.ts` | `tests/unit/read-matrix.test.ts` |
| TC-069 una rama no recorrida no es un fallo del vehículo | `src/domain/read-matrix.ts` (regla de los dos vecinos) | «una rama que un vehículo no recorre no cuenta como fallo suyo» |
| R-OPP-014 / TC-076–079 paso probado por vecinos, tiempo u orden de convoy | `src/domain/read-matrix.ts` (`enclose`, `expectedTime`, `keptConvoy`) | `tests/unit/read-matrix.test.ts` |
| R-GRA-011 / TC-074 lo que queda fuera del anillo se enumera | `workers/import.worker.ts` (`offRingTags`), `src/presentation/main.ts` | `tests/e2e/f2.spec.ts` |
| Composición del circuito: número y orden de tags | `src/domain/laps.ts` (`findDominantCycle`), `workers/import.worker.ts` (`shapes`) | «el número y el orden de los tags salen junto al número de vehículos» |
| TC-075 / UX §4 destacados primero, conjunto a demanda | `src/presentation/main.ts` (`finding`), `src/presentation/charts.ts` (`lazyDetails`) | `tests/e2e/f2.spec.ts` |
| TC-068 la banda de actividad no emite un rótulo por celda | `src/presentation/charts.ts` (`activityChart`) | `tests/e2e/vistas.spec.ts` · «la banda de actividad no emite un rótulo por celda» |
| `TEST_STRATEGY.md` §7 / G3 falsos positivos y desconocidos medidos por categoría | `tests/support/circuito-auditoria.ts` (verdad plantada) | `tests/audit/auditoria.test.ts` · informe por clase, cero falsos positivos y deuda que no se pudre |
| `CONFIG_SCHEMA.md` §3.4.3 la configuración de planta entra como CSV | `src/domain/tag-lists.ts`, `src/ingestion/catalog.ts`, `src/persistence/store.ts` (peldaño 3) | `tests/unit/catalog.test.ts`, `tests/unit/charging.test.ts` |
| R-CO-001 / R-CO-002 cinco calles y su máquina de estados | `src/domain/circuit-config.ts`, `src/domain/charging.ts` | `tests/unit/charging.test.ts` |
| R-CO-006 / TC-080–082 la parada en carga no es un silencio | `src/domain/dossier.ts` (`laneSignatures`, `cause`) | `tests/unit/dossier.test.ts` · «una parada entre la parada precisa y la salida…» |
| R-CO-007 / TC-084–085 el que ya estaba dentro antes de la cobertura | `src/domain/charging.ts` (`staysOf`, `startedInside`) | `tests/unit/charging.test.ts` |
| R-CO-003 / TC-086 la salida se relaciona con mayor antigüedad | `src/domain/charging.ts` (`seniorityBreaches`) | `tests/unit/charging.test.ts` |
| R-CO-008 / TC-083 una calle sin servicio no acusa a sus tags | `src/domain/inventory.ts` (`calle-sin-servicio`) | `tests/unit/inventory.test.ts` |
| R-FLO-006 / TC-089 el orden de convoy no prueba nada en zona vacía | `src/domain/read-matrix.ts` (`orderUsableByPosition`, `stretchAllows`) | `tests/unit/read-matrix.test.ts` |
| R-OPP-015 / ALG-020 / TC-091–096 rotura súbita y degradación progresiva, por tag y por AGV | `src/domain/read-rate-trend.ts` | `tests/unit/read-rate-trend.test.ts`, `tests/unit/read-matrix.test.ts` |
| R-FLO-001 / ALG-011 / TC-097–101 FIFO en zona cargada, adelantamiento candidato | `src/domain/fifo.ts` | `tests/unit/fifo.test.ts` |
| R-GRA-007 / ALG-021 / TC-102–105 candidatos a bifurcación; TC-125–136 cruce interno, parada precisa y semáforo (Parte 35); TC-137–140 vinculación/desvinculación y declaración dual por `critico`/`circuito` (Parte 36); R-GRA-008 / TC-106–107 omisión crítica diferenciada | `src/domain/critical-points.ts`, `src/domain/inventory.ts`, `src/domain/circuit-config.ts`, `src/domain/dossier.ts`, `src/domain/tag-lists.ts` | `tests/unit/critical-points.test.ts`, `tests/unit/inventory.test.ts`, `tests/unit/charging.test.ts`, `tests/unit/dossier.test.ts` |
| R-GRA-009 / `CONFIG_SCHEMA.md` §3.4.2 / TC-108–111 anclas de vuelta declaradas, `truth` condicional a completitud | `src/domain/laps.ts` (`resolveDeclaredAnchor`, `buildLap`), `src/domain/circuit-config.ts` (`readLapAnchors`), `workers/import.worker.ts` | `tests/unit/laps.test.ts`, `tests/unit/vsystem.test.ts` (invariancia a la rotación), `tests/audit/auditoria.test.ts` |
| R-DAT-016 / R-AGV-013 / R-DAT-017 / ALG-009 §6.1–6.2 / TC-112–124 comparación entre dos periodos distantes, sustitución candidata y adopción de tag nuevo | `src/domain/drift.ts` (`compareDistantPeriods`) | `tests/unit/drift.test.ts`, `tests/audit/auditoria.test.ts` |
| `UX_SPEC.md` §5.3 / TC-141–147 vistas de diagnóstico (Parte 38): anillo, mapa de omisión, tendencias, permanencias, horquilla, calles, FIFO, deriva, inventario y expediente en el tiempo | `src/presentation/diagnostic-charts.ts`, `src/presentation/charts.ts` (`inventoryChart`), `src/domain/read-rate-trend.ts` (`binTimeline`), `src/domain/read-matrix.ts` (`trendSeries`), `src/domain/fifo.ts` (`focus`), `src/domain/charging.ts` (`findLaneJunctions`), `src/domain/critical-points.ts` (`transitionDurationsByTag`), `workers/import.worker.ts` | `tests/unit/read-rate-trend.test.ts`, `tests/unit/read-matrix.test.ts`, `tests/unit/fifo.test.ts`, `tests/unit/charging.test.ts`, `tests/unit/critical-points.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| DS-012 / R-AGV-014 / R-AGV-015 / TC-148–157 flota del circuito y vehículos que no cargan (Parte 39): historial de flota incremental, vida de cada AGV en tramos, recuento «N de M» | `src/domain/fleet.ts`, `src/ingestion/fleet-history.ts`, `src/domain/charging.ts` (`neverCharged`), `src/persistence/store.ts` (`fleet`, versión 4), `workers/import.worker.ts` (`runFleet`, `accumulate`), `src/presentation/diagnostic-charts.ts` (`fleetCountChart`, `fleetLifelineChart`) | `tests/unit/fleet.test.ts`, `tests/unit/fleet-history.test.ts`, `tests/unit/charging.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-DAT-007 / TC-158 el expediente de un AGV no cuenta un hueco de cobertura como inactividad | `src/domain/dossier.ts` (`coverage` por tramos), `workers/import.worker.ts` | `tests/unit/dossier.test.ts` |
| R-EVI-007 / TC-159–160 revisión en campo de los hallazgos | `src/domain/review.ts`, `src/persistence/store.ts` (tabla `reviews`, versión 5), `src/presentation/review-ui.ts`, `src/presentation/main.ts` (`finding`, `.agvproj`) | `tests/unit/review.test.ts`, `tests/e2e/revision.spec.ts` |
| `UX_SPEC.md` §2, §4.2, §5.3 / TC-275 portada con cifras, anillo con capas y cajón de tablas | `src/presentation/main.ts` (`renderTiles`, `renderFindingsTile`, `jumpTo`, `renderRingFigure`, `renderRing`, `ringDataOf`, `openDossier`), `src/presentation/diagnostic-charts.ts` (`ringChart`, `RingLayer`), `src/presentation/drawer.ts`, `src/presentation/charts.ts` (`table`, `lazyTable`), `src/presentation/styles.css` | `tests/e2e/portada.spec.ts`, `tests/e2e/f2.spec.ts`, `tests/e2e/vistas.spec.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| `UX_SPEC.md` §2, §4.3, §4.5 / TC-274 pestañas por pregunta, bandeja de hallazgos, tarjetas gemelas y control compacto de revisión | `src/presentation/main.ts` (`activateTab`, `renderViews`, `buildTray`, `groupHighlights`, `groupedTagCard`, `renderVehicleReading`, `renderPace`, `renderRing`, `renderReadMatrix`), `src/presentation/review-ui.ts`, `src/presentation/labels.ts` (`FINDING_KINDS`), `src/presentation/styles.css` | `tests/e2e/navegacion.spec.ts`, `tests/e2e/revision.spec.ts`, `tests/e2e/tactil.spec.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| `UX_SPEC.md` §7 / TC-161–162 lectura de gráficos con dedo, ratón o panel táctil; tamaños de tableta y portátil | `src/presentation/pointer.ts`, `src/presentation/diagnostic-charts.ts`, `src/presentation/charts.ts`, `src/presentation/styles.css` | `tests/unit/pointer.test.ts`, `tests/e2e/tactil.spec.ts` |
| `UX_SPEC.md` §4.4 lenguaje de la interfaz: sin referencias internas, identificadores traducidos a castellano llano | `src/presentation/labels.ts`, `src/presentation/main.ts`, `src/presentation/charts.ts`, `src/presentation/diagnostic-charts.ts` | `tests/e2e/f2.spec.ts`, `tests/e2e/vistas.spec.ts`, `tests/e2e/vistas-diagnostico.spec.ts` (fijan los textos visibles) |
| R-DAT-019 / R-OPP-016 / TC-163–167 cambios de tag dentro de un periodo y vida del tag | `src/domain/tag-changes.ts`, `src/domain/read-matrix.ts` (`TagLife`, rachas por celda), `workers/import.worker.ts`, `src/presentation/main.ts` (`renderTagChanges`) | `tests/unit/tag-changes.test.ts`, `tests/unit/read-matrix.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-AGV-016 / TC-168–170 lectura por AGV: nunca, desde una hora, poco | `src/domain/vehicle-reading.ts`, `src/domain/config.ts`, `src/presentation/main.ts` (`renderVehicleReading`, `explain`) | `tests/unit/vehicle-reading.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-AGV-018 / R-AGV-014 / TC-175–179 paradas contra el flujo y flota en el circuito | `src/domain/flow-stops.ts`, `src/domain/fleet.ts`, `src/domain/silence-kind.ts`, `src/domain/config.ts` (`flowStops`), `workers/import.worker.ts`, `src/presentation/diagnostic-charts.ts` (`fleetCountChart`, `fleetLifelineChart`), `src/presentation/main.ts` (`renderFlowStops`) | `tests/unit/flow-stops.test.ts`, `tests/unit/fleet.test.ts`, `tests/unit/silence-kind.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-TIM-009 / R-TIM-010 / R-FLO-007–009 / R-GRA-014 / R-AGV-018 (cola física) / TC-180–185 estado normal del circuito | `src/domain/segment-bands.ts`, `src/domain/circuit-state.ts`, `src/domain/flow-stops.ts` (valla, cola, retenciones, `aheadEvidence`), `src/domain/graph.ts` (`quantile`), `src/domain/config.ts` (`regimes`, `bands`, `circuitState`), `workers/import.worker.ts`, `src/application/protocol.ts` (`circuitState`), `src/presentation/diagnostic-charts.ts` (`segmentBandChart`), `src/presentation/main.ts` (`renderCircuitState`) | `tests/unit/segment-bands.test.ts`, `tests/unit/flow-stops.test.ts`, `tests/unit/circuit-state.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-DAT-020 / TC-187–190 lecturas que llegaron juntas al servidor | `src/domain/grouped-delivery.ts`, `src/domain/circuit-state.ts` (`concentrated`), `src/domain/config.ts` (`groupedDelivery`), `workers/import.worker.ts` (colapso antes de medir tiempos), `src/application/protocol.ts` (`circuitState.cohorts[].groupedDelivery`), `src/presentation/main.ts` (`renderCircuitState`) | `tests/unit/grouped-delivery.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-TIM-011 / R-TIM-010 (entre ficheros) / TC-191–194 medición por fichero y posición en tiempo | `src/domain/franjas.ts`, `src/domain/segment-bands.ts` (`bandShift`), `src/domain/config.ts` (`franjas`), `workers/import.worker.ts`, `src/application/protocol.ts` (`franjas`), `src/presentation/franjas-ui.ts`, `src/presentation/diagnostic-charts.ts` (`ringTimeChart`, `segmentHistoryChart`) | `tests/unit/franjas.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-DAT-021 / TC-195–199 cambios de estructura por la suma entre anclas | `src/domain/anchor-sums.ts`, `src/domain/config.ts` (`anchorSums`), `workers/import.worker.ts` (dentro de cada fichero y entre ficheros), `src/application/protocol.ts` (`franjas.cohorts[].structure`), `src/presentation/franjas-ui.ts` (`describeGap`, `gapLineFor`, marcas del anillo en tiempo), `src/presentation/main.ts` (`renderTagChanges`, `renderDrift`) | `tests/unit/anchor-sums.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-AGV-019 / R-AGV-020 / TC-200–203 ritmo de cada AGV y quién retiene | `src/domain/vehicle-pace.ts`, `src/domain/config.ts` (`pace`), `workers/import.worker.ts` (en todo lo cargado y por fichero), `src/application/protocol.ts` (`circuitState.cohorts[].pace`, `franjas.cohorts[].measures[].pace`), `src/presentation/main.ts` (`renderCircuitState`), `src/presentation/franjas-ui.ts` (tabla y CSV de ritmo por fichero) | `tests/unit/vehicle-pace.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| DATA_CONTRACTS §3.7 / TC-204–206 listas e historial en Excel | `src/persistence/xlsx.ts` (lectura), `src/ingestion/catalog.ts` (`importCatalogRows`), `src/ingestion/fleet-history.ts` (`importFleetRows`, `excelSerialToText`), `workers/import.worker.ts` (lee `.xlsx`), `src/presentation/main.ts` (los selectores aceptan `.xlsx`); plantillas que se entregan: `tests/support/plantillas-excel.ts`, `tests/support/xlsx-writer.ts`, `scripts/generar-plantillas-excel.ts` | `tests/unit/xlsx.test.ts`, `tests/unit/plantillas-excel.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| R-GRA-001 / TC-208 declarado de Vsystem que se lee fuera del recorrido dominante | `src/domain/vsystem.ts` (`fuera-del-anillo`), `src/presentation/labels.ts` | `tests/unit/vsystem.test.ts` |
| R-GRA-007 / TC-209 sin firmas de tiempo con la hora al minuto | `src/domain/critical-points.ts` (`timeSignaturesMeasurable`), `workers/import.worker.ts`, `src/application/protocol.ts` (`criticalPoints[].timeSignatures`), `src/presentation/main.ts` (`renderCriticalPoints`) | `tests/unit/critical-points.test.ts` |
| R-AGV-017 / TC-171–174 cómo reaparece un AGV tras un hueco | `src/domain/silence-kind.ts`, `src/domain/fleet.ts`, `src/domain/config.ts` (`silenceKind`), `workers/import.worker.ts`, `src/presentation/diagnostic-charts.ts` (`fleetLifelineChart`), `src/presentation/styles.css` | `tests/unit/silence-kind.test.ts`, `tests/unit/fleet.test.ts`, `tests/audit/auditoria.test.ts`, `tests/e2e/vistas-diagnostico.spec.ts` |
| DATA_CONTRACTS §3.8 / TC-210–211 lecturas en Excel | `src/ingestion/xlsx-readings.ts` (`rowsToDelimitedText`), `src/ingestion/importer.ts` (`HEADER_ALIASES`), `workers/import.worker.ts` (`runImport`), `src/presentation/main.ts` (selector) | `tests/unit/xlsx-readings.test.ts`, `tests/e2e/acumulacion.spec.ts` |
| R-CO-002 / TC-212 calle que empieza en su parada precisa | `src/domain/circuit-config.ts` (`readCoLanes`), `src/domain/charging.ts`, `src/domain/dossier.ts` (`laneSignatures`) | `tests/unit/charging.test.ts`, `tests/unit/dossier.test.ts` |
| R-GRA-007 / TC-213 lo declarado en planta junto a cada incidencia | `src/domain/tag-info.ts`, `workers/import.worker.ts` (`tagInfo`), `src/presentation/main.ts` (`finding`, expediente) | `tests/unit/tag-info.test.ts` |
| R-DAT-022 / R-DAT-019 / TC-214–215 tags fuera de la lista del circuito, de día y de noche | `src/domain/undeclared-tags.ts`, `src/domain/tag-changes.ts` (`withoutTags`), `src/domain/anchor-sums.ts` (`structureBoundaries`), `workers/import.worker.ts`, `src/presentation/main.ts` (`renderUndeclaredTags`) | `tests/unit/undeclared-tags.test.ts`, `tests/unit/tag-changes.test.ts`, `tests/audit/auditoria.test.ts` |
| R-GRA-001 / TC-216 declarado en el anillo en otro punto del orden | `src/domain/vsystem.ts` (`otro-orden`), `src/presentation/labels.ts` | `tests/unit/vsystem.test.ts` |
| R-GRA-015 / TC-217–219 la posición de un tag la dan las lecturas | `src/domain/circuit-order.ts`, `src/domain/undeclared-tags.ts` (`dominantNeighbours`), `src/domain/vsystem.ts`, `workers/import.worker.ts` (`circuitOrder`), `src/presentation/main.ts` (`renderCircuitOrder`), `src/presentation/labels.ts` | `tests/unit/circuit-order.test.ts`, `tests/unit/vsystem.test.ts`, `tests/unit/undeclared-tags.test.ts`, `tests/audit/auditoria.test.ts` |
| R-GRA-007 / TC-222 toda función de planta es crítica; `parada`, `giro`, `cambio-de-mtc` | `src/domain/tag-lists.ts` (`LIST_FUNCTIONS.critico`), `src/domain/circuit-config.ts` (`readCriticalPoints`), `src/presentation/labels.ts` | `tests/unit/charging.test.ts` |
| R-GRA-016 / TC-220–223 refuerzos de un punto crítico | `src/domain/critical-reinforcement.ts`, `src/domain/inventory.ts` (`refuerzo-sin-lectura`), `src/domain/tag-info.ts`, `workers/import.worker.ts` | `tests/unit/critical-reinforcement.test.ts`, `tests/unit/inventory.test.ts`, `tests/unit/tag-info.test.ts`, `tests/audit/auditoria.test.ts` |
| R-DAT-022 / TC-224–225, TC-227 lista de tags de noche | `src/domain/tag-lists.ts` (`noche`), `src/domain/undeclared-tags.ts` (`noche-declarado`), `src/domain/inventory.ts` (`night`), `workers/import.worker.ts`, `src/presentation/main.ts` | `tests/unit/undeclared-tags.test.ts`, `tests/unit/inventory.test.ts`, `tests/audit/auditoria.test.ts` |
| R-GRA-016 / TC-226 refuerzo con `grupo` | `src/domain/circuit-config.ts` (`groupOf`), `src/domain/critical-reinforcement.ts`, `src/domain/tag-info.ts` | `tests/unit/critical-reinforcement.test.ts`, `tests/unit/charging.test.ts`, `tests/unit/tag-info.test.ts` |
| R-GRA-007 / TC-228 qué es cada función de planta; `tramo-conflictivo`, `control-wifi` | `src/domain/tag-lists.ts` (`FUNCTION_MEANING`), `src/domain/critical-reinforcement.ts`, `src/presentation/main.ts`, `src/presentation/labels.ts` | `tests/unit/charging.test.ts`, `tests/unit/critical-reinforcement.test.ts` |
| R-GRA-017 / TC-229–230 limpieza de la lista | `src/domain/list-cleanup.ts`, `workers/import.worker.ts` (`listCleanup`), `src/application/protocol.ts`, `src/presentation/main.ts` (`renderListCleanup`) | `tests/unit/list-cleanup.test.ts`, `tests/audit/auditoria.test.ts` |
| R-FLO-010 / TC-231–232 alimentación de la línea | `src/domain/line-feed.ts`, `src/domain/segment-bands.ts` (`bandOf`), `src/domain/tag-lists.ts` (`linea`), `workers/import.worker.ts` (`lineFeed`), `src/application/protocol.ts`, `src/presentation/main.ts` (`renderLineFeed`) | `tests/unit/line-feed.test.ts`, `tests/audit/auditoria.test.ts` Ritmo y tiempo sin paso: TC-235–236. |
| R-FLO-011 / TC-233–234 pasos por la línea | `src/domain/line-feed.ts` (`passages`), `workers/import.worker.ts`, `src/presentation/main.ts` (`renderLineFeed`) | `tests/unit/line-feed.test.ts`, `tests/audit/auditoria.test.ts` |
| R-FLO-010 / TC-237 exclusión de las paradas de la línea | `src/domain/line-feed.ts` (`lineStopExclusion`, `outsideLineStops`), `workers/import.worker.ts` | `tests/unit/line-feed.test.ts`, `tests/audit/auditoria.test.ts` (mismo encadenado) |
| R-GRA-018 / TC-238 tramos en las gráficas | `src/domain/tag-info.ts` (`tagSections`), `src/domain/tag-lists.ts` (`tramo`), `src/presentation/diagnostic-charts.ts`, `src/presentation/main.ts`, `src/presentation/franjas-ui.ts`, `src/presentation/styles.css` | `tests/unit/tag-info.test.ts` |
| R-AGV-021 / TC-239–240 batería de mediciones de cada incidencia | `src/domain/incident-battery.ts`, `src/domain/line-feed.ts` (`passTimes`, `nightCadence`), `workers/import.worker.ts` (`incidents`), `src/application/protocol.ts`, `src/presentation/main.ts` (`withBattery`, `renderAbandoned`) | `tests/unit/incident-battery.test.ts`, `tests/audit/auditoria.test.ts` |
| R-GRA-014 / TC-241 zona oscura por tag sin lecturas; R-AGV-018 / TC-242 orden solo con posición fiable; R-AGV-021 / TC-243–245 batería en la auditoría e invariantes | `src/domain/circuit-state.ts` (`declaredWithoutReadings`), `src/domain/flow-stops.ts` (`orderable`), `workers/import.worker.ts`, `src/presentation/main.ts`, `tests/support/circuito-auditoria.ts` (`ocupacionAislada`) | `tests/unit/circuit-state.test.ts`, `tests/unit/flow-stops.test.ts`, `tests/audit/auditoria.test.ts` |

**Sin fila porque no está implementado**, aunque su regla exista: la importación de las listas de
planta (DS-002, DS-006, DS-008) — cubierta más arriba vía `src/ingestion/catalog.ts` —, y el tercer
descarte de R-DAT-016 (comprobar con tiempos si el tramo que rodea a un tag obsoleto se recorre en
directo), que es geométrico y distinto de la comparación entre dos periodos que ya tiene fila arriba.
La **comparación entre dos periodos distantes**, que hasta el 2026-09-22 era la ausencia señalada en
este párrafo, ya tiene fila: separa un tag obsoleto de uno averiado con dos muestras, no con una
hipótesis (R-DAT-016). La **tasa a lo largo del tiempo**, que hasta el 2026-09-21 era la tercera
ausencia de esta lista, ya tiene fila: la auditoría la midió, no la dio por hecha, y las dos clases
que dependían de ella —rotura súbita y degradación progresiva— salieron de `DEUDA_CONOCIDA` en
`tests/audit/auditoria.test.ts` el mismo día que se detectaron.

**La advertencia anterior queda cerrada, no borrada.** Hasta esta entrega, `inventory.ts` y
`graph.ts` estaban probados y no eran alcanzables desde la interfaz. Ya lo son: el agrupamiento por
circuito aparece en el resumen de circuito, las vueltas y la inactividad en el expediente de AGV y
tag, el grafo contrastado en la tabla de Vsystem, y el propio grafo en el replay. La lección se
mantiene para la próxima vez: un módulo de dominio nuevo no se da por entregado hasta que exista la
vista que lo expone, no solo la prueba que lo verifica.

## Regla de mantenimiento

Un requisito nuevo no puede pasar a `accepted` si no tiene fase, propietario, comprobación y, cuando sea ejecutable, al menos una prueba. Eliminar un requisito exige ADR y registro de impacto histórico.
