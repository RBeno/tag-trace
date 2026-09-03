---
adr: ADR-0002
status: accepted
date: 2026-09-03
---

# Estados de evidencia y procedencia inmutable

## Contexto

Una ausencia de lectura admite explicaciones incompatibles. Mezclar hechos e inferencias produciría diagnósticos convincentes pero falsos.

## Decisión

Usar estados separados `observed`, `inferred`, `expected`, `unknown` y `confirmed`. Cada observación conserva hash, fuente y fila; toda inferencia conserva algoritmo, versión, parámetros, evidencia y confianza.

## Consecuencias

- Auditoría completa y lenguaje más honesto.
- Más metadatos y disciplina de UI/tipos.
- Una confirmación humana no borra el origen inferido.
