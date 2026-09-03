---
adr: ADR-0003
status: accepted
date: 2026-09-03
---

# Análisis explicable y determinista

## Contexto

El sistema debe justificar conclusiones y comparar resultados históricos. Un modelo opaco o variable dificultaría verificar si una diferencia procede del circuito o del software.

## Decisión

La primera arquitectura usa reglas, grafos, máquinas de estado y estadística robusta. Igual entrada, configuración y versión produce igual resultado. Modelos aprendidos futuros se prueban en sombra antes de promoción.

## Consecuencias

- Resultados reproducibles, depurables y auditables.
- Puede requerir más trabajo explícito de reglas.
- El aprendizaje automático queda condicionado a datos etiquetados y métricas de valor.
