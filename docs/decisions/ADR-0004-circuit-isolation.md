---
adr: ADR-0004
status: accepted
date: 2026-09-03
---

# Circuitos como agregados aislados

## Contexto

Archivos de otro circuito podrían generar grafos y divergencias aparentemente coherentes y contaminar la memoria.

## Decisión

Cada proyecto/circuito posee ID, fuentes, configuración, memoria e incidencias propios. La afinidad se comprueba al importar; un archivo dudoso puede analizarse en cuarentena, pero no consolidarse hasta resolverlo.

## Consecuencias

- Reduce contaminación irreversible.
- Exige identidad y afinidad incluso cuando solo se pilote PC2.
- El primer archivo puede quedar `unknown` si todavía no existe huella suficiente.
