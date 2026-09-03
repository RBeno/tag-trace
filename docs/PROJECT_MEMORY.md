---
document_id: TT-PMEM-001
version: 0.2.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Memoria compacta del proyecto

## Identidad

- Nombre: **TAG TRACE**.
- Naturaleza: diagnóstico histórico longitudinal y gemelo digital de circuitos AGV.
- Primer circuito piloto: PC2.
- Estado: F0, especificación candidata; todavía sin código nuevo.
- Repositorio anterior: `RBeno/tag-trace-agv`, solo referencia.

## Decisiones firmes

- Web estática/PWA publicada mediante GitHub Pages.
- Análisis íntegramente local; sin backend de datos industriales.
- GitHub solo guarda código, documentación y fixtures sintéticos.
- Cada circuito es un contenedor aislado de fuentes, memoria, análisis e incidencias.
- Archivo portable `.agvproj` para transferencia manual y reapertura.
- Núcleo analítico separado de UI, persistencia y ejecución en Workers.
- Evidencia bruta inmutable durante el análisis, con hash, archivo y fila de origen.
- Replay determinista y algoritmos versionados.
- Consolidación mediante botón y revisión humana; historial append-only.
- Incidencias vinculadas al circuito pero separadas de la memoria normal.
- No SOC/batería; no control industrial; no IA opaca en el diagnóstico inicial.
- Repositorio **público** con solo código, documentación y fixtures sintéticos (ADR-0014).
  El guardián automático de datos es bloqueante y precede a la apertura.
- `.agvproj` es un zip con manifiesto, secciones JSON y hash por sección (ADR-0012).
- Tiempo canónico `t_utc` en milisegundos UTC, con cadena original, zona y marca DST; orden total
  `(t_utc, source_hash, source_row)`; números canonicalizados antes del hash semántico (ADR-0013).
- Una sola pasada de parseo, siempre dentro del Worker, y ningún cálculo de repuesto en el hilo
  principal (`WORKER_PROTOCOL.md`).

## Modelo industrial conocido

- Los eventos mínimos contienen fecha/hora, AGV y tag.
- IDs se conservan como texto, incluidos ceros iniciales.
- El catálogo funcional de tags puede estar incompleto.
- Un tag puede ejecutar funciones diferentes según el multicircuito/configuración.
- El circuito incluye carga online; mantenimiento y asistencia se excluyen.
- Zona cargada: FIFO esperado, salvo excepciones justificadas.
- Zona vacía y carga online: puede haber reordenación.
- El número de calles de carga online y su capacidad se define en la configuración local; el motor no lo codifica como constante.
- La salida de carga se relaciona con antigüedad, no con un SOC fiable.
- Ausencia de WiFi implica ausencia de lecturas y puede impedir la orden de entrada a carga.
- Un lector puede no retransmitir el mismo tag consecutivo; una ausencia no demuestra que no hubo paso.
- Una minoría de AGV con acciones distintas sugiere configuración desactualizada, no la confirma.
- Existen referencias operativas actuales de lectura, ciclo, takt, turnos y pausas; sus valores exactos son configuración industrial local y no se publican en GitHub.

## Estados de verdad

- `observed`: presente en una fuente conservada.
- `inferred`: deducido con método, evidencia y confianza.
- `expected`: procedente del modelo versionado aplicable al contexto.
- `unknown`: evidencia insuficiente o contradictoria.
- `confirmed`: validado explícitamente por una persona autorizada.

## Orden de implementación

F0 documentación → F1 base local e importación → F2 grafo físico → F3 diagnóstico → F4 consolidación/evolución → F5 incidencias/replay → F6 piloto endurecido → F7 ampliación multicircuito → F8 observación cercana a tiempo real.

## Próxima decisión

Quedan cinco preguntas bloqueantes de G0 —OQ-B01 a OQ-B05— que solo se responden con información
de planta, más la licencia del repositorio (OQ-B07). Resueltas esas, se firma el checkpoint F0.
La frase de transición sigue siendo `CONTINÚA FASE 1`.
