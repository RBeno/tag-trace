---
adr: ADR-0010
status: accepted
date: 2026-09-03
---

# Desarrollo con IA gobernado por fases

## Contexto

Una IA puede producir mucho código rápidamente, pero también amplificar supuestos y hacer cambios difíciles de revisar.

## Decisión

Trabajar mediante contratos pequeños, ramas, trazabilidad, pruebas y puertas de fase. El propietario decide dominio/aceptación; la IA implementa y documenta; la automatización verifica. Ninguna IA aprueba su propio trabajo.

## Consecuencias

- Menor velocidad aparente al inicio, mayor capacidad de verificar y corregir.
- La memoria del proyecto vive en archivos versionados.
- `CONTINÚA FASE 1` es la transición explícita desde F0.
