---
document_id: TT-GOLD-019
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-16
---

# TC-019 — Delimitadores y preservación de identidad

## Propósito y reglas cubiertas

El mismo contenido lógico exportado con separadores distintos debe producir el mismo resultado, sin
perder ceros iniciales ni alterar fechas.

Reglas: R-DAT-001, R-DAT-002. Algoritmo: ALG-001. Invariantes: INV-002, INV-010.

## Fixture sintético

Tres archivos con idéntico contenido lógico y distinto separador: coma, punto y coma y tabulador.
Identificadores inventados, elegidos para ejercitar los casos que rompen:

- AGV con cero inicial (`0007`, `0042`) y sin él (`3301`), porque el formato **no es universal**
  entre circuitos.
- Tags de cinco y de seis dígitos.
- Horas con y sin cero a la izquierda, tal como aparecen en la fuente real.
- Un día mayor que doce, para que el formato de fecha quede determinado.
- Una variante adicional con un día menor o igual que doce en todas las filas, que **debe** quedar
  ambigua en lugar de resolverse por suposición.

## Configuración aplicable

Zona horaria declarada. Formato de fecha sin fijar en la variante ambigua.

## Resultado esperado

- Los tres archivos producen el mismo hash semántico.
- `0007` sigue siendo `0007` en identidad y en representación; nunca `7`.
- El delimitador detectado se registra en la procedencia con su puntuación de confianza.
- La variante ambigua produce `DATE_AMBIGUOUS` y deja las filas en cuarentena explicada.

## Resultados prohibidos

- Convertir un identificador a número, en cualquier punto del recorrido.
- Hashes distintos entre los tres archivos.
- Resolver la ambigüedad de día/mes por el orden de aparición, por la mayoría o por el idioma.
- Descartar en silencio una fila por no reconocer el separador.

## Tolerancias

Ninguna. Identidad exacta de cadenas y de hash.

## Evidencia navegable

Cada valor mostrado debe llevar a su fila original, y la vista previa debe enseñar el delimitador
detectado antes de aceptar la fuente.

## Aceptación

Responsable: propietario del producto. Fecha: pendiente de F1a.
