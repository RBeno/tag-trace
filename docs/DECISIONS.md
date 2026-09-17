---
document_id: TT-DECISIONS-001
version: 0.2.0
status: active
last_updated: 2026-09-03
---

# Índice de decisiones arquitectónicas

| ADR | Decisión | Estado |
|---|---|---|
| [ADR-0001](decisions/ADR-0001-local-first-static-pwa.md) | PWA estática local-first en GitHub Pages | Accepted |
| [ADR-0002](decisions/ADR-0002-evidence-states-and-provenance.md) | Estados de evidencia y procedencia inmutable | Accepted |
| [ADR-0003](decisions/ADR-0003-explainable-deterministic-analysis.md) | Análisis explicable y determinista antes que IA opaca | Accepted |
| [ADR-0004](decisions/ADR-0004-circuit-isolation.md) | Circuitos como agregados aislados | Accepted |
| [ADR-0005](decisions/ADR-0005-supervised-versioned-consolidation.md) | Consolidación supervisada, compacta y append-only | Accepted |
| [ADR-0006](decisions/ADR-0006-incidents-separated-from-baseline.md) | Incidencias separadas de memoria normal | Accepted |
| [ADR-0007](decisions/ADR-0007-no-real-data-in-github.md) | Prohibición de datos industriales en GitHub | Accepted |
| [ADR-0008](decisions/ADR-0008-modular-core-and-workers.md) | Núcleo modular independiente y Workers | Accepted |
| [ADR-0009](decisions/ADR-0009-candidate-web-stack.md) | Stack web candidato y selección por prueba | Proposed |
| [ADR-0010](decisions/ADR-0010-phase-gated-ai-development.md) | Desarrollo con IA gobernado por fases y pruebas | Accepted |
| [ADR-0011](decisions/ADR-0011-greenfield-repository.md) | Nuevo repositorio; prototipo como referencia | Accepted |
| [ADR-0012](decisions/ADR-0012-agvproj-container.md) | Contenedor `.agvproj`: zip, manifiesto y hash por sección | Accepted |
| [ADR-0013](decisions/ADR-0013-canonical-time-and-determinism.md) | Tiempo canónico, orden total y determinismo numérico | Accepted |
| [ADR-0014](decisions/ADR-0014-public-repository-and-publication.md) | Repositorio público y publicación en GitHub Pages | Accepted |

## Convención

- `Proposed`: pendiente de decisión.
- `Accepted`: vigente.
- `Superseded`: sustituida por otra ADR.
- `Deprecated`: aún legible, no aplicable a trabajo nuevo.
- `Rejected`: analizada y descartada.

Una ADR no se edita para ocultar una decisión anterior; se crea otra que la sustituya.
