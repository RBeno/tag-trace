---
document_id: TT-GOLD-023
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-16
---

# TC-023 — Entrega diferida detectada por la monotonía

## Propósito y reglas cubiertas

La fuente es una pila: el servidor añade cada lectura según la recibe. Si un AGV pierde comunicación
y vuelca después, sus lecturas llegan tarde y rompen la monotonía. Eso no es un fichero corrupto:
es un hecho diagnóstico que hoy se perdería.

Reglas: R-DAT-008, R-COM-001. Decisión: ADR-0013.

## Fixture sintético

- Un corte en sentido de pila descendente, coherente en casi toda su extensión.
- Un tramo donde las lecturas de un AGV inventado aparecen en posición reciente pero con instantes
  claramente anteriores: la firma de un volcado diferido.
- Una variante de control con monotonía perfecta, para comprobar que no se señala lo que no toca.

## Configuración aplicable

Sentido de fuente detectado, no supuesto. Zona horaria declarada.

## Resultado esperado

- La monotonía se mide y se registra en la procedencia de la fuente.
- Las inversiones se señalan como **entrega diferida**, con el AGV y el tramo afectados.
- Las filas se conservan íntegras: ninguna se descarta.
- El orden canónico sigue siendo total y determinista, y el resultado no depende del orden de
  llegada de los ficheros.
- La secuencia del AGV afectado dentro del tramo invertido se marca, para que no se use como
  evidencia de orden físico sin advertirlo.
- La variante de control no produce ninguna señal.

## Resultados prohibidos

- Rechazar el fichero o clasificarlo como error de parseo.
- Reordenar en silencio sin dejar constancia.
- Tratar la entrega diferida como si fuese la posición física del AGV en ese momento.
- Señalar inversiones en la variante de control.

## Tolerancias

El umbral a partir del cual una inversión se considera significativa es configuración con vigencia,
nunca una constante en el código.

## Evidencia navegable

Desde la señal de entrega diferida debe poder verse el tramo de filas implicado en su orden físico
original, junto al orden canónico resultante.

## Estabilidad

Hash semántico estable pese a la inversión, y reproducible entre ejecuciones.

## Aceptación

Responsable: propietario del producto. Fecha: pendiente de F1a.
