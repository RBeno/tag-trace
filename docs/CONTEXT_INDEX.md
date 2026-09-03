---
document_id: TT-CONTEXT-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Índice de contexto y rutas de lectura

Este documento evita que una persona o IA tenga que interpretar todo el repositorio para cada tarea.

## Lectura mínima siempre obligatoria

1. `PROJECT_MEMORY.md`: decisiones compactas vigentes.
2. `project_state.json`: fase, estado y transición permitida.
3. `REQUIREMENTS.md`: requisitos identificados.
4. El documento específico según la tarea.

## Rutas por tipo de trabajo

| Trabajo | Documentos obligatorios |
|---|---|
| Requisitos o alcance | `PROJECT_CHARTER.md`, `REQUIREMENTS.md`, `OPEN_QUESTIONS.md` |
| Importación/normalización | `DATA_CONTRACTS.md`, `RULE_CATALOG.md`, `SECURITY_PRIVACY.md` |
| Grafo/topología | `DOMAIN_MODEL.md`, `RULE_CATALOG.md`, `ALGORITHM_CATALOG.md` |
| Salud/diagnóstico | `RULE_CATALOG.md`, `ALGORITHM_CATALOG.md`, `TEST_STRATEGY.md` |
| Consolidación | `MEMORY_CONSOLIDATION.md`, `VERSIONING.md`, ADR-0005 |
| Incidencias/replay | `INCIDENTS_REPORTING.md`, `UX_SPEC.md`, ADR-0006 |
| Interfaz | `UX_SPEC.md`, `ARCHITECTURE.md`, `PERFORMANCE_BUDGET.md` |
| Persistencia `.agvproj` | `DATA_CONTRACTS.md`, `MEMORY_CONSOLIDATION.md`, `VERSIONING.md` |
| Seguridad/publicación | `SECURITY_PRIVACY.md`, `ARCHITECTURE.md`, ADR-0001 y ADR-0007 |
| Cambio de fase | `ROADMAP.md`, `PHASE_GATES.md`, `DEFINITION_OF_DONE.md` |

## Estado documental

Todos los documentos `0.1.0` constituyen una **candidata de línea base**, no una especificación aprobada. Las dudas que cambien el comportamiento están centralizadas en `OPEN_QUESTIONS.md` y no deben resolverse por suposición.

## Jerarquía en caso de conflicto

1. Decisión explícita más reciente del propietario del producto.
2. ADR aceptado más reciente.
3. Requisito identificado.
4. Regla industrial identificada.
5. Resto de documentación.

Todo conflicto debe registrarse antes de modificar el producto.
