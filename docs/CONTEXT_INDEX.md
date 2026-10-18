---
document_id: TT-CONTEXT-001
version: 0.6.0
status: baseline-candidate
last_updated: 2026-10-18
---

# Índice de contexto y rutas de lectura

Este documento evita que una persona o IA tenga que interpretar todo el repositorio para cada tarea.

## Lectura mínima siempre obligatoria

El mismo orden que `CLAUDE.md`:

1. `project_state.json`: fase, estado y transición permitida.
2. `PROJECT_MEMORY.md`: decisiones vigentes y relevo entre conversaciones.
3. Este índice y el documento específico según la tarea (tabla siguiente).
4. `REQUIREMENTS.md` cuando la tarea toque el alcance o un requisito identificado.

Quien no conozca el proyecto empieza por [`VISION_GENERAL.md`](VISION_GENERAL.md): una página en lenguaje llano.

## Rutas por tipo de trabajo

| Trabajo | Documentos obligatorios |
|---|---|
| Requisitos o alcance | `PROJECT_CHARTER.md`, `REQUIREMENTS.md`, `OPEN_QUESTIONS.md` |
| Importación/normalización | `DATA_CONTRACTS.md`, `RULE_CATALOG.md`, `SECURITY_PRIVACY.md`, ADR-0013 |
| Grafo/topología | `DOMAIN_MODEL.md`, `RULE_CATALOG.md`, `ALGORITHM_CATALOG.md` |
| Salud/diagnóstico | `RULE_CATALOG.md`, `ALGORITHM_CATALOG.md`, `TEST_STRATEGY.md` |
| Casos de oro | `TEST_STRATEGY.md` y el caso concreto en `golden/` |
| Consolidación | `MEMORY_CONSOLIDATION.md`, `VERSIONING.md`, ADR-0005 |
| Incidencias/replay | `INCIDENTS_REPORTING.md`, `UX_SPEC.md`, ADR-0006 |
| Interfaz | `UX_SPEC.md`, `ARCHITECTURE.md`, `PERFORMANCE_BUDGET.md` |
| Workers y trabajos pesados | `WORKER_PROTOCOL.md`, `ARCHITECTURE.md`, ADR-0008 |
| Configuración de circuito | `CONFIG_SCHEMA.md`, `RULE_CATALOG.md`, `VERSIONING.md` |
| Persistencia `.agvproj` | `DATA_CONTRACTS.md`, `MEMORY_CONSOLIDATION.md`, `VERSIONING.md`, ADR-0012 |
| Seguridad/publicación | `SECURITY_PRIVACY.md`, `ARCHITECTURE.md`, ADR-0001, ADR-0007 y ADR-0014 |
| Cambio de fase | `ROADMAP.md`, `PHASE_GATES.md`, `DEFINITION_OF_DONE.md` |
| Uso, diagnóstico y operación | `MANUAL_DE_USO.md`, `GUIA_DE_DIAGNOSTICO.md`, `OPERACION.md`, `VERSIONING.md` |

## Estado documental

Los documentos con `status: baseline-candidate` forman la línea base aprobada en F0 (`checkpoints/F0_BASELINE_CANDIDATE.md`) y siguen evolucionando: su versión avanza con cada cambio. Las dudas que cambien el comportamiento están centralizadas en `OPEN_QUESTIONS.md` y no deben resolverse por suposición.

## Jerarquía en caso de conflicto

1. Decisión explícita más reciente del propietario del producto.
2. ADR aceptado más reciente.
3. Requisito identificado.
4. Regla industrial identificada.
5. Resto de documentación.

Todo conflicto debe registrarse antes de modificar el producto.
