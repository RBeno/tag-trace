---
document_id: TT-TRACE-001
version: 0.8.0
status: baseline-candidate
last_updated: 2026-09-17
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

**Sin fila porque no está implementado**, aunque su regla exista: la importación de las listas de
planta (DS-002, DS-006, DS-008), que es lo que conecta `inventory.ts` con la interfaz; el grafo y las
vueltas, sin los cuales la normalización de R-OPP-010 sigue siendo aproximada; y la comparación entre
dos periodos distantes, que es la única que separa un obsoleto de un tag averiado.

## Regla de mantenimiento

Un requisito nuevo no puede pasar a `accepted` si no tiene fase, propietario, comprobación y, cuando sea ejecutable, al menos una prueba. Eliminar un requisito exige ADR y registro de impacto histórico.
