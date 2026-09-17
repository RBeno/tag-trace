---
document_id: TT-GOLD-021
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-16
---

# TC-021 — Solape que contiene una maniobra

## Propósito y reglas cubiertas

Es la trampa que una deduplicación por huella de fila no supera. Dentro del solape, un AGV pasa por
un tag, por otro y de vuelta por el primero dentro del mismo instante declarado. Con resolución
gruesa, las dos lecturas del primer tag son idénticas carácter a carácter, pero son eventos
distintos: un retroceso o maniobra real.

Reglas: R-CO-005, R-DAT-005. Algoritmo: ALG-002. Invariante: INV-014.

## Fixture sintético

- Dos cortes de la misma pila con solape, como en TC-015.
- Dentro del solape, para un AGV inventado, la secuencia `tagA → tagB → tagA` con el mismo instante
  declarado en las tres lecturas.
- Fuera del solape, un par de filas idénticas **contiguas**, sin nada del mismo AGV entre medias:
  el caso genuinamente indistinguible.

## Configuración aplicable

Resolución de la fuente declarada, más gruesa que el paso entre tags.

## Resultado esperado

- Tras la unión sobreviven **las dos** lecturas de `tagA` como eventos distintos.
- El grafo de transiciones contiene `tagA → tagB` y `tagB → tagA`.
- El solape se cuenta una sola vez, con doble procedencia, como en TC-015.
- El par contiguo idéntico se conserva y se marca `unknown`: a esta resolución no puede decidirse
  si es una maniobra o una emisión repetida.

## Resultados prohibidos

- Fusionar las dos lecturas de `tagA` en una.
- Un bucle `tagA → tagA` en el grafo.
- Contar el solape dos veces por intentar conservar la maniobra.
- Resolver el par contiguo idéntico en un sentido u otro sin evidencia.

## Tolerancias

Ninguna. Recuentos exactos y aristas exactas.

## Evidencia navegable

Cada una de las dos lecturas de `tagA` debe llevar a su propia fila de origen en cada fuente, y la
maniobra debe poder verse en el timeline como dos pasos, no como uno.

## Estabilidad

Hash semántico estable e independiente del orden de importación de los dos cortes.

## Aceptación

Responsable: propietario del producto. Fecha: pendiente de F1a.
