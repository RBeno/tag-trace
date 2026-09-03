---
adr: ADR-0006
status: accepted
date: 2026-09-03
---

# Incidencias separadas de la memoria normal

## Contexto

Las anomalías aportan enorme valor para causas y contramedidas, pero no representan el funcionamiento esperado.

## Decisión

Cada incidencia se vincula al circuito y conserva evidencia mínima, replay, hipótesis, informe y contramedidas en un historial separado. Guardarla no actualiza grafo ni perfiles normales.

## Consecuencias

- Evita contaminar el baseline.
- Permite una biblioteca de casos y verificación posterior.
- Promover un aprendizaje general requiere otra decisión/consolidación.
