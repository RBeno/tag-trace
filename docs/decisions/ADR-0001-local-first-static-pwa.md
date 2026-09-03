---
adr: ADR-0001
status: accepted
date: 2026-09-03
---

# PWA estática local-first en GitHub Pages

## Contexto

El prototipo debe ser accesible desde PC o móvil con potencia suficiente, evitar infraestructura de servidor y mantener los datos industriales fuera de la nube.

## Decisión

La aplicación será una PWA estática publicada en GitHub Pages. Archivos, análisis, memoria e informes permanecen en el navegador/dispositivo. La portabilidad se realiza mediante `.agvproj`.

## Consecuencias

- Menor coste operativo y superficie de ataque.
- Uso desde varios dispositivos sin instalar servidor.
- No existe sincronización automática; el usuario gestiona exportación/importación.
- Persistencia, cuotas y compatibilidad del navegador deben tratarse como requisitos centrales.

## Alternativas descartadas inicialmente

Colab como backend, servidor doméstico/VPN y backend cloud. Pueden revisarse si el piloto demuestra una necesidad que la ejecución local no cubra.
