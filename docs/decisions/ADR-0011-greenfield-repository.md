---
adr: ADR-0011
status: accepted
date: 2026-09-03
---

# Nuevo repositorio profesional

## Contexto

Existe `RBeno/tag-trace-agv` como prototipo. La evolución de alcance a diagnóstico longitudinal, memoria compacta e incidencias exige revisar límites antes de continuar acumulando cambios.

## Decisión

Crear `RBeno/tag-trace` como repositorio nuevo. El anterior permanece intacto y se considera fuente de escenarios y piezas candidatas, nunca base automática.

## Consecuencias

- Arquitectura y pruebas se construyen desde requisitos formalizados.
- Se evita trasladar deuda o datos accidentales.
- La reutilización requiere auditoría por componente y puede decidir `reuse`, `rewrite` o `discard`.
