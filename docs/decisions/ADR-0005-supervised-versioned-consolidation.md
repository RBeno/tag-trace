---
adr: ADR-0005
status: accepted
date: 2026-09-03
---

# Consolidación supervisada, compacta y append-only

## Contexto

Guardar todo el bruto aumenta memoria y ruido; aprender automáticamente de un periodo anómalo deformaría el esperado.

## Decisión

Un botón de consolidación, tras revisión, crea una nueva versión append-only. Guarda grafo validado, perfiles robustos, deltas y decisiones, no todas las filas. Las correcciones usan revocación/nueva versión.

## Consecuencias

- Memoria ligera y evolución auditable.
- Requiere una pantalla de revisión clara.
- Algunas reproducciones necesitarán reabrir la fuente externa si no pertenecen a una incidencia conservada.
