---
adr: ADR-0007
status: accepted
date: 2026-09-03
---

# Ningún dato industrial real en GitHub

## Contexto

Incluso datos anonimizados pueden revelar topología, horarios, capacidad o fallos operativos.

## Decisión

GitHub solo conserva código, documentación y fixtures inequívocamente sintéticos. Se prohíben CSV, `.agvproj`, informes, grafos, planos y configuraciones reales.

## Consecuencias

- Las aceptaciones con datos reales se ejecutan localmente.
- Los errores deben reproducirse con fixtures sintéticos antes de incorporar la corrección.
- La visibilidad se decide explícitamente; la regla sigue vigente aunque el repositorio sea privado.
