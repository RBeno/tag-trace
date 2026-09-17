---
document_id: TT-PMEM-001
version: 0.5.0
status: baseline-candidate
last_updated: 2026-09-17
---

# Memoria compacta del proyecto

## Identidad

- Nombre: **TAG TRACE**.
- Naturaleza: diagnóstico histórico longitudinal y gemelo digital de circuitos AGV.
- Primer circuito piloto: PC2.
- Estado: **F2 en curso** desde el 2026-09-17, autorizada por el propietario con «Continúa Fase 2».
  F1 entregó el importador, la acumulación por circuito, `.agvproj`, la PWA y las pruebas de
  navegador. G1 se cerró con tres criterios sin cumplir, declarados y arrastrados a G2: el plan de
  aceptación de F1, la afinidad de circuito y PERF-D2 en el móvil de referencia.
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
- El tiempo de zona se resuelve **sin librería**: `Intl.DateTimeFormat` y dos sondeos del
  desplazamiento alrededor del instante. No se itera hasta converger, porque esa convergencia oculta
  precisamente la hora repetida del cambio de octubre. La validez del calendario se comprueba antes
  de aplicar la zona: un día imposible es una fila inválida, no un instante inexistente.
- El umbral de consistencia del separador **identifica** al separador; no juzga la calidad de la
  fuente. Las filas discordantes son cuarentena, no motivo de rechazo del fichero.

## Modelo industrial conocido

- Los eventos mínimos contienen fecha/hora, AGV y tag.
- IDs se conservan como texto, incluidos ceros iniciales.
- El catálogo funcional de tags puede estar incompleto.
- Un tag puede ejecutar funciones diferentes según el multicircuito/configuración, y un
  multicircuito puede además alterar las condiciones físicas de detección. Es contexto obligatorio
  de la salud; cuando se desconoce, el confusor se declara.
- La fuente mínima siempre disponible es Fecha–AGV–Tag. Existe un informe ampliado con segundos,
  circuito declarado, multicircuito y eventos de uso, que se admite como fuente opcional.
- El análisis es muestral, no continuo: periodos de pocos días sobre una fuente con ventana
  deslizante. Fuera de la cobertura cargada el estado es `sin datos cargados`, nunca una parada.
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

F0 documentación → F1 base local e importación → F2 grafo físico → F3 diagnóstico → F4 consolidación/evolución → F5 incidencias/replay → F6 piloto endurecido → F7 ampliación a varios circuitos → F8 observación cercana a tiempo real.

En F7, «varios circuitos» significa PC2 y otros circuitos como agregados aislados. No confundir con
el multicircuito (MTC), que es un modo de comportamiento dentro de un mismo circuito.

## Próxima decisión

F2 reconstruye el circuito. Lo que la limita no es el algoritmo —está validado contra tres
exportaciones reales, con dominancia mediana 1,000— sino la información de planta que convierte una
reconstrucción en un diagnóstico: los límites de zona, las calles CO, los puntos críticos y las
anclas de vuelta (OQ-B04), que G2 exige configurados y versionados.

La frase de transición a F3 es `CONTINÚA FASE 3`, y ninguna IA la escribe por el propietario
(ADR-0010).
