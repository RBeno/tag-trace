---
adr: ADR-0008
status: accepted
date: 2026-09-03
---

# Núcleo independiente y cálculo en Workers

## Contexto

El análisis puede ser pesado y el prototipo móvil ya mostró un fallo compatible con sincronización Worker/UI. Acoplar dominio, interfaz y persistencia dificulta probar y optimizar.

## Decisión

Separar núcleo puro, aplicación, adaptadores de persistencia, Workers y presentación. Todo cálculo pesado se ejecuta fuera del hilo principal mediante protocolo versionado con ID de trabajo, progreso y cancelación.

## Consecuencias

- Pruebas deterministas y optimización aislada.
- Contratos explícitos entre procesos.
- Se evita mantener algoritmos duplicados en UI y Worker.
