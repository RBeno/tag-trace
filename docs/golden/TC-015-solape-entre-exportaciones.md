---
document_id: TT-GOLD-015
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-16
---

# TC-015 — Solape entre dos exportaciones

## Propósito y reglas cubiertas

Dos exportaciones de la misma fuente cubren periodos que se superponen. La unión debe contar cada
evento lógico una sola vez y conservar todas sus procedencias.

Reglas: R-DAT-005, R-DAT-008. Algoritmo: ALG-002. Invariantes: INV-005, INV-014.

## Fixture sintético

Identificadores, fechas y topología inventados; el manifiesto declara `synthetic: true`.

- **Fuente A**: corte de la pila tomado en un instante `T1`, contiene los eventos `e1…e60`.
- **Fuente B**: corte posterior `T2`, contiene `e21…e80`.
- Solape: `e21…e60`, cuarenta eventos presentes en ambas.
- Ambas en sentido de pila descendente, con la misma resolución declarada.

## Configuración aplicable

Configuración mínima de circuito con zona horaria declarada. Sin calendario: el caso no depende de
turnos.

## Resultado esperado

- Ochenta eventos lógicos, no ciento cuarenta.
- Cada evento del solape conserva **dos** procedencias: `source_id` y `source_row` de A y de B.
- Los eventos exclusivos de A conservan solo la suya, igual los de B.
- El orden canónico resultante coincide exactamente con el de importar un único corte `e1…e80`.
- **Importar A y luego B produce el mismo resultado semántico que importar B y luego A.**

## Resultados prohibidos

- Ciento cuarenta eventos, o cualquier recuento mayor que ochenta.
- Perder la procedencia de una de las dos fuentes.
- Que el resultado dependa del orden de importación.
- Marcar los eventos del solape como duplicados sospechosos: son el mismo evento visto dos veces,
  y eso es lo normal cuando se solapa a propósito.

## Tolerancias

Ninguna. Los recuentos son exactos y las procedencias se comparan por igualdad.

## Evidencia navegable

Desde cualquier evento del solape debe poder abrirse la fila de origen **en las dos** fuentes, con
su número de fila y el hash de cada archivo.

## Estabilidad

El hash semántico del resultado debe ser idéntico al del corte único `e1…e80`, y estable entre
ejecuciones y entre órdenes de importación.

## Aceptación

Responsable: propietario del producto. Fecha: pendiente de F1a.
