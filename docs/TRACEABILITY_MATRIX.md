---
document_id: TT-TRACE-001
version: 0.5.0
status: baseline-candidate
last_updated: 2026-09-16
---

# Matriz de trazabilidad

La matriz se ampliará hasta una relación automática cuando exista código. En F0 demuestra que cada bloque de valor posee reglas, algoritmos, pruebas y puerta.

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

## Regla de mantenimiento

Un requisito nuevo no puede pasar a `accepted` si no tiene fase, propietario, comprobación y, cuando sea ejecutable, al menos una prueba. Eliminar un requisito exige ADR y registro de impacto histórico.
