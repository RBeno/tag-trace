---
adr: ADR-0009
status: proposed
date: 2026-09-03
---

# Stack web candidato

## Contexto

Se necesita una PWA estática, portable, testeable y eficiente. Elegir framework antes de medir puede arrastrar complejidad innecesaria.

## Propuesta

- TypeScript estricto.
- Vite como build.
- Vitest para núcleo y propiedades.
- Playwright para E2E/navegadores/móvil emulado.
- IndexedDB y OPFS opcional detrás de interfaces.
- UI y motor gráfico decididos con un prototipo comparativo de F1/F2.

## Criterio de aceptación

Build estático reproducible, Worker/PWA correctos en GitHub Pages, bundle razonable, compatibilidad móvil y ausencia de backend/red de datos.

## Estado

Proposed: no autoriza instalar dependencias hasta comenzar F1 y registrar la evaluación.
