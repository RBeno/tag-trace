---
document_id: TT-GOLD-012
version: 0.1.0
status: baseline-candidate
last_updated: 2026-10-17
---

# TC-012 — Punto crítico sin llegada más de diez minutos

## Propósito y reglas cubiertas

La salida demostrable de F5 es investigar una ausencia de diez minutos en un punto crítico y conservar
el caso completo sin modificar el esperado (`ROADMAP.md` §F5). Este caso fija que el **retroceso desde
el síntoma** encuentra lo que hay aguas arriba y antes, y que **no afirma una causa única**.

Reglas y decisiones: R-INC-001, R-INC-002, R-FLO-007 (valla de cada tramo), R-COM-005 (cortes del
registro del terminal), R-EVI-006; ADR-0018 D4, D6 y D7; ALG-015.

## Fixture sintético

Generado, no versionado: `tests/support/caso-punto-critico.ts`, con semilla. Es un escenario propio y
no una clase más del circuito de auditoría: plantar una parada de trece minutos allí movería las cifras
medidas de sus otras clases.

- Un anillo de 24 tags (`71001`…`71024`) en una sola guía y 8 AGV (`201`…`208`) separados tres tags;
  cada tramo en 30 s ± 3 s. Un paso por cada tag cada 90 s más o menos. Martes 20/01/2026, de 10:00 a
  12:00 en Madrid.
- El punto crítico es `71018`. A las 10:40 el AGV `205` llega a `71012`, seis tags antes, y se queda
  trece minutos; los de detrás esperan en cola y los de delante siguen. Por `71018` no pasa nadie
  durante unos quince minutos.
- Distractor: el AGV `207` pierde la conexión de 10:30:00 a 10:33:20 según su terminal y sigue leyendo.

## Configuración aplicable

La provisional. Con una versión consolidada, el anillo y las horquillas salen de su esperado; sin ella,
del propio fichero, y se dice. Márgenes de 30 min a cada lado (`incident_case.*`).

## Resultado esperado

- El hecho `sin-paso` de `71018` da el último paso antes (AGV del escenario) y el primero después
  (`205`), con la duración del hueco frente a lo habitual **antes** del síntoma.
- La **primera desviación** es `205` de `71012` a `71013`, seis tags aguas arriba, desde que llegó.
- El corte de WiFi de `207` aparece en su hora, con su fila del registro.
- Todo lo anterior al síntoma lleva `precede`, y solo eso; lo de durante y después, ninguna relación.
- Hay más de un tipo de hecho que precede: el caso no señala uno como causa.
- Mismo recorte, misma cronología, en cualquier orden de lectura; también tras recargar la página.
- Crear el expediente y mirarlo no cambia nada fuera de las tablas de expedientes.

## Resultados prohibidos

- Decir que la parada de `205` o el corte de `207` son la causa, o usar «causa», «debido a» o
  «provocó» en cualquier texto generado.
- Ordenar la cronología por importancia en lugar de por tiempo.
- Medir lo habitual con los pasos de después del síntoma, que vienen en tropel al soltarse la cola.
- Cambiar el esperado, la memoria o la revisión en campo al crear o mirar el expediente.

## Tolerancias

Ninguna: el escenario es determinista. Las vallas salen de las horquillas medidas (R-FLO-007), no de
números escritos en la prueba.

## Evidencia navegable

Cada hecho lleva las filas que lo sostienen (fichero, huella y fila) o la fila del registro de
conexiones; en la interfaz van en el título de la línea.

## Estabilidad

La cronología se recalcula desde el recorte congelado (`recorte-2`) con el procedimiento
`retroceso-1`.

## Aceptación

Pruebas: `tests/unit/case-backtrack.test.ts` (TC-343) y `tests/e2e/expedientes.spec.ts` (TC-344).
Responsable: propietario del producto. Fecha: pendiente de su revisión con datos reales en su dispositivo.
