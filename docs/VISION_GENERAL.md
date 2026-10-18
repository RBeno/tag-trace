---
document_id: TT-VISION-001
version: 0.1.0
status: draft
last_updated: 2026-10-18
---

# TAG TRACE en una página

## Qué es

Una aplicación web que se abre en el navegador del PC o del móvil, lee las exportaciones de lecturas de
tags de un circuito de AGV y explica qué pasa en ese circuito: qué tags no se leen, qué vehículos leen
peor, dónde se forman colas, dónde se pierde la WiFi y qué cambió desde la última vez. Todo se calcula
en el propio dispositivo; ningún dato sale de él.

## Qué problema resuelve

Las lecturas están repartidas en exportaciones de dos o tres días, y una lectura que falta puede
deberse al tag, al lector, al vehículo, a la WiFi, a la configuración o a la ruta. Revisarlo a mano
exige mirar AGV por AGV. TAG TRACE junta las exportaciones, reconstruye el recorrido real a partir de
lo que leyeron los vehículos y señala las desviaciones con su evidencia, sin inventar lo que no sabe.

## Cómo funciona, en cinco pasos

1. Se importa la exportación de lecturas (CSV o Excel) y, si se tienen, las listas del circuito.
2. El programa reconstruye el anillo de tags, mide los tiempos normales de cada tramo y busca lo que se
   sale de ellos. Lo que no puede afirmar lo marca «sin datos» o «sin determinar».
3. La persona revisa cada hallazgo en planta: confirmado, descartado o pospuesto.
4. Cuando el periodo es normal, la persona consolida: el circuito guarda una versión de su estado
   «esperado». El programa nunca consolida solo.
5. Ante una incidencia, se abre un expediente: qué pasó antes, durante y después, con replay, hipótesis
   y verificación de la contramedida. El informe se descarga en HTML y se imprime a PDF.

## Qué no hace nunca

- No se conecta a los AGV ni al servidor de planta; no da órdenes (nada de START, STOP, RESET).
- No envía datos a ningún servidor; funciona sin red una vez abierta.
- No usa la batería como señal de diagnóstico ni un modelo opaco: cada conclusión lleva su evidencia.
- No afirma causas: dice «precede», «es compatible con» o «contradice». La causa la confirma una persona.

## Dónde está el proyecto (2026-10-18)

Fase F6, «piloto profesional». Las entregas 1 a 7 que podía hacer la IA están hechas y la 8 —el piloto—
preparada; la última versión es la 3.89.0, que recoge una revisión completa del código y de la
documentación ([`REVISION_2026-10-18.md`](REVISION_2026-10-18.md)). La aplicación está publicada en
<https://rbeno.github.io/tag-trace/>.

## Qué le queda al propietario

1. Publicar la rama de F6 y medir con «Datos → Medir este dispositivo» en el S23 FE y en el PC.
2. Hacer el piloto de 48 h con datos reales siguiendo [`templates/PILOT_ACCEPTANCE.md`](templates/PILOT_ACCEPTANCE.md).
3. Decidir OQ-172 (cuándo se dice «correlaciona») y las preguntas que la revisión dejó, OQ-177 a OQ-180
   ([`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md)).
4. Si el piloto pasa, escribir `CONTINÚA FASE 7`.

## Qué leer después

- Para usar la aplicación: [`MANUAL_DE_USO.md`](MANUAL_DE_USO.md), [`GUIA_DE_DIAGNOSTICO.md`](GUIA_DE_DIAGNOSTICO.md), [`OPERACION.md`](OPERACION.md).
- Para decidir: [`PHASE_GATES.md`](PHASE_GATES.md) §G6 y [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
- Para desarrollar: [`../AGENTS.md`](../AGENTS.md), [`../CLAUDE.md`](../CLAUDE.md), [`CONTEXT_INDEX.md`](CONTEXT_INDEX.md).
