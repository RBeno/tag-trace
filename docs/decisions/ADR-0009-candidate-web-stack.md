---
adr: ADR-0009
status: accepted
date: 2026-09-16
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
- **Interfaz de F1a: sin marco.** TypeScript y DOM directo.

## Criterio de aceptación

Build estático reproducible, Worker/PWA correctos en GitHub Pages, bundle razonable, compatibilidad móvil y ausencia de backend/red de datos.

## La interfaz de F1a no lleva marco

F1a es un selector de fichero, una barra de progreso, una tabla y un botón de exportar. Un marco no
resuelve ninguna de esas cuatro cosas y añade peso y dependencias desde el primer día.

La decisión se pospone **con un criterio, no por indecisión**: se toma cuando exista una pantalla que
sí lo justifique —grafo, timeline o replay, en F2 y F5— y con medidas de esa pantalla, que es lo que
esta ADR quería desde el principio. `ARCHITECTURE.md` §3 mantiene el núcleo sin conocer la
presentación, así que adoptar un marco después no obliga a tocar el dominio.

El motor gráfico sigue abierto y se decide en F2 con el grafo delante.

## Estado

Accepted para F1a. Instalar cualquier dependencia de runtime fuera de las fijadas aquí exige
justificación, medición y una ADR nueva.
