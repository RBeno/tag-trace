---
document_id: TT-PMEM-001
version: 0.8.0
status: baseline-candidate
last_updated: 2026-09-20
---

# Memoria compacta del proyecto

## Identidad

- Nombre: **TAG TRACE**.
- Naturaleza: diagnóstico histórico longitudinal y gemelo digital de circuitos AGV.
- Primer circuito piloto: PC2.
- Estado: **F3 en curso** desde el 2026-09-20, autorizada por el propietario con «Continúa con Fase
  3». F2 entregó el grafo observado, el inventario contrastado, las cuatro vistas, las vueltas, el
  agrupamiento por circuito, el expediente, el contraste contra Vsystem y el replay.
  F1 entregó el importador, la acumulación por circuito, `.agvproj`, la PWA y las pruebas de
  navegador. G1 se cerró con tres criterios sin cumplir, declarados y arrastrados a G2: el plan de
  aceptación de F1, la afinidad de circuito y PERF-D2 en el móvil de referencia. **La afinidad de
  circuito se cerró el 2026-09-18**, así que de los tres solo quedan dos.
- Las listas de tags (circuito virtual, memoria, mantenimiento, emergencia, carga online, críticos)
  **se crean a mano**: no hay forma de descargarlas del sistema de planta. El importador declara su
  propia estructura mínima (`lista;tag`, con `orden` y `nota` opcionales) y la enseña en la interfaz
  antes de pedir el fichero, en vez de esperar un formato que nadie puede adivinar. Una lista con un
  nombre que el producto no reconoce se conserva con su nombre y se avisa, nunca se rechaza: el
  propietario ya anticipó ampliaciones.
- Las listas se guardan **con el circuito**, no aparte, porque son parte de su estado en el momento
  del análisis: repetir un análisis de hace tres meses usa las listas de hace tres meses. Si se
  aplican los cambios que el inventario propone y se vuelven a cargar, el análisis siguiente las
  recoge ya actualizadas sin tocar los anteriores.
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

## Decisión del propietario (2026-09-20)

- F2 gana expediente navegable de AGV y tag, agrupamiento por circuito, vueltas segmentadas por
  ciclo dominante, contraste contra Vsystem y replay básico — los cinco alcanzables desde la
  interfaz, no solo probados en el dominio.
- **SE2/4 pasa a ser el circuito priorizado** para las pruebas de aceptación, mientras se recoge más
  volumen de PC2. Los hechos operativos concretos que lo motivan son de planta y quedan fuera del
  repositorio (`local/notas-se24.md`).
- **OQ-B05 aceptada de forma acotada**: el propietario valida en persona con los datos reales ya
  aportados, en su propio dispositivo. El criterio de rechazo de una fase sigue sin definirse y no
  se inventa.

## F3 abierta (2026-09-20)

El propietario autoriza F3 con «Continúa con Fase 3». G2 se cierra con dos criterios sin cumplir
—OQ-B04 y los casos de oro— declarados, no marcados.

Lo que la primera prueba del producto en navegador contra un circuito realista (54 vehículos,
98.400 lecturas, 150 tags) dejó a la vista, y que ninguna prueba en verde había detectado:

- El replay llamaba **silencio** a un vehículo que todavía no había tenido su primera lectura en la
  ventana. Un silencio afirma que una posición conocida deja de confirmarse; antes de la primera
  lectura no hay posición que dejar de confirmar. En el primer fotograma eso presentaba 53 de 54
  vehículos como averiados. Es el error que este proyecto existe para no cometer, y una prueba lo
  daba por bueno.
- La banda de actividad emitía un rótulo por celda: 10.368 nodos, el 86 % de la página, y una tarea
  de 958 ms bloqueando el hilo principal justo después de importar.
- El expediente enseñaba la duración de cada silencio y no sus dos extremos, que es lo único que
  distingue una parada en su sitio de un tramo recorrido sin leer (`UX_SPEC.md` §4.1).

De ahí una lección que vale más que las tres correcciones: **un producto con la suite en verde
puede estar afirmando algo falso en pantalla**. Las pruebas comprobaban que el replay decía
«silencio»; ninguna preguntaba si eso era cierto.

## Próxima decisión

F3 diagnostica, y lo que la limita sigue siendo lo mismo que limitaba a F2: la información de planta
que convierte una reconstrucción en un diagnóstico —límites de zona, calles CO, puntos críticos y
anclas de vuelta (OQ-B04)—. Sin ella no hay oportunidad elegible, y sin oportunidad elegible no hay
tasa de salud defendible: se enuncia y no se calcula, en vez de estimarla con un supuesto.

Lo que sí se puede sostener solo con lo observado, y es por donde F3 avanza: las pruebas
discriminantes. La de tiempos —`t(A→B)` directo frente a `t(A→X→B)`— separa un tag que está en la
línea y se lee a medias de un desvío real, y está validada a mano contra dato real pero todavía no
existe en `src/`.

La frase de transición a F4 es `CONTINÚA FASE 4`, y ninguna IA la escribe por el propietario
(ADR-0010).
