---
document_id: TT-CONTEXT-001
version: 0.7.0
status: baseline-candidate
last_updated: 2026-10-18
---

# Índice de contexto y rutas de lectura

Este documento evita que una persona o IA tenga que interpretar todo el repositorio para cada tarea.

## Lectura mínima siempre obligatoria

El mismo orden que `CLAUDE.md`:

1. `project_state.json`: fase, estado y transición permitida.
2. `PROJECT_MEMORY.md`: decisiones vigentes y relevo entre conversaciones. Lo fechado —decisiones del
   propietario con su cita, entregas, historia— está en [`history/DECISION_LOG.md`](history/DECISION_LOG.md):
   se consulta cuando hace falta el porqué de una decisión, no se lee entero.
3. Este índice y el documento específico según la tarea (tabla siguiente).
4. `REQUIREMENTS.md` cuando la tarea toque el alcance o un requisito identificado.

Quien no conozca el proyecto empieza por [`VISION_GENERAL.md`](VISION_GENERAL.md): una página en lenguaje llano.

## Rutas por tipo de trabajo

Los tres catálogos grandes (`RULE_CATALOG.md`, `ALGORITHM_CATALOG.md`, `TEST_STRATEGY.md`) no se leen
enteros: la tabla dice qué parte. En `RULE_CATALOG.md` cada familia de reglas es una sección: R-EVI
(«Evidencia y diagnóstico»), R-DAT («Identidad y fuentes»), R-GRA («Circuito y topología»), R-OPP
(«Lecturas, oportunidades y huecos»), R-AGV («AGV, lector y configuración»), R-COM («Comunicación»),
R-FLO («Flujo, FIFO y zonas»), R-CO («Carga online»), R-TIM («Producción y calendario») y R-MEM y R-INC
(«Consolidación e incidencias»). En `ALGORITHM_CATALOG.md` la cabecera de cada §4.N, §6.N, §7.N y §8.N nombra
las reglas que implementa; se busca la regla y se lee esa sección.

| Trabajo | Documentos obligatorios |
|---|---|
| Requisitos o alcance | `PROJECT_CHARTER.md`, `REQUIREMENTS.md`, `OPEN_QUESTIONS.md` |
| Importación/normalización | `DATA_CONTRACTS.md` §3–§7, `RULE_CATALOG.md` familia R-DAT, `SECURITY_PRIVACY.md` §5, ADR-0013 |
| Grafo/topología | `DOMAIN_MODEL.md` (con «Del concepto al código»), `RULE_CATALOG.md` familia R-GRA, `ALGORITHM_CATALOG.md` §6.N del algoritmo afectado (§6.12–§6.15 lista y orden del circuito, §6.21 instantánea, §6.23 plano) y §7 si toca las vueltas |
| Salud/diagnóstico | `RULE_CATALOG.md`: la familia de la regla afectada (R-OPP, R-AGV, R-FLO, R-CO, R-TIM o R-COM) más R-EVI, que fija cómo se dice; `ALGORITHM_CATALOG.md` §4.N, §6.N, §7.N u §8.N del algoritmo de esa regla; `TEST_STRATEGY.md` §3 (invariantes), §7 (auditoría con verdad plantada) y las filas TC de §4 que cita la regla |
| Casos de oro | `TEST_STRATEGY.md` §4 (la fila del caso) y §5 (estructura), y el caso concreto en `golden/` |
| Consolidación | `MEMORY_CONSOLIDATION.md`, `VERSIONING.md`, ADR-0005; `RULE_CATALOG.md` familias R-MEM y R-INC; `ALGORITHM_CATALOG.md` §6.21–§6.27 |
| Incidencias/replay | `INCIDENTS_REPORTING.md`, `UX_SPEC.md` §6.2, ADR-0006 y ADR-0018 |
| Interfaz | `UX_SPEC.md`, la sección de lo que se toca (§2 navegación y pestañas, §4 hallazgos, §5 vistas, §7 móvil, §8 estados y errores); `ARCHITECTURE.md`, `PERFORMANCE_BUDGET.md` |
| Workers y trabajos pesados | `WORKER_PROTOCOL.md`, `ARCHITECTURE.md`, ADR-0008 |
| Configuración de circuito | `CONFIG_SCHEMA.md`, `RULE_CATALOG.md` familia de la regla que usa el parámetro, `VERSIONING.md` |
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
