---
document_id: TT-PMEM-001
version: 0.17.0
status: baseline-candidate
last_updated: 2026-09-25
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

## Despliegue en GitHub Pages (2026-09-20)

`deploy-pages.yml` publica desde `main` en `https://rbeno.github.io/tag-trace/`, solo si las tres
verificaciones existentes (tipos/pruebas/build, guardián de datos, calidad documental) terminan en
verde (ADR-0014). Se adelantó desde G6 para poder medir PERF-D2 en el Samsung Galaxy S23 FE, no
como aprobación de piloto.

**Publicado y en verde el 2026-09-20**, tras dos intentos fallidos que valen la pena registrar
porque el segundo no era del workflow:

1. Primer intento: `actions/configure-pages@v5` trae `enablement: false` por defecto, así que solo
   comprobó que el sitio de Pages ya existiera (404) en vez de crearlo. Corregido con
   `enablement: true` explícito.
2. Segundo intento, ya con `enablement: true`: `Create Pages site failed... Resource not
   accessible by integration`. La causa no era el workflow — **el repositorio seguía privado**, y
   GitHub Pages para repositorios privados exige un plan de pago. `ADR-0014` fechaba la decisión de
   hacerlo público el 2026-09-03, con el guardián de datos como condición previa; el guardián lleva
   corriendo en verde desde entonces, pero **el cambio de visibilidad en los ajustes de GitHub
   nunca se había ejecutado** hasta hoy. La ADR no cambia: solo se anota que la fecha de ejecución
   real de la visibilidad es el 2026-09-20, no el 2026-09-03.

Con el repositorio ya público, el tercer intento (`workflow_dispatch`) desplegó sin tocar nada más.

## Zonas compartidas entre circuitos, reservadas para F7 (2026-09-23)

El propietario deja abierta, **sin construirla ahora**, la posibilidad de analizar circuitos que
comparten un cruce, un semáforo o un tramo. Hechos de planta aportados:

- los circuitos salen del mismo servidor, que gestiona los cruces y da un reloj común (R-DAT-018);
- el número de un tag es único en toda la planta; solo se comparten entre circuitos los tags de
  cruces y semáforos, y en un tramo físico común cada circuito mantiene sus propios tags (R-GRA-012);
- un AGV no está en el tag: ocupa el espacio hasta el siguiente, y en ese espacio caben uno o varios
  según su longitud física.

Decisión de diseño: los circuitos siguen aislados y la zona será una vista aparte que compara la
ocupación de sus espacios con su capacidad (R-GRA-013). Lo que habrá que adaptar para que no choque
con lo existente está anotado en `ROADMAP.md` F7. OQ-127 sigue abierta y OQ-128, parcial.

**Corregido el mismo día**: la primera redacción de R-GRA-012 decía que cada tag es un espacio que
ocupa un AGV, y que el tramo compartido salía de cruzar las listas. Las dos cosas eran falsas.

## Revisión en campo antes de consolidar (2026-09-23)

Para las pruebas en planta, el propietario pide poder dejar trabajo a medias, volver a cargar y
seguir. Decisiones: cuatro estados por hallazgo (pendiente, confirmado, descartado, pospuesto),
botones solo en las tarjetas de hallazgo, guardado automático en el dispositivo y exportación a CSV
(R-EVI-007, `UX_SPEC.md` §4.3). **Solo la revisión**, que es F3: la consolidación es F4 y espera a
`CONTINÚA FASE 4`. Cuando llegue, lo pospuesto no bloquea: pasa al periodo siguiente con su motivo.

## El estado normal del circuito (2026-09-25)

Decisiones del propietario: las paradas, los descansos y la noche (22:00–05:00) no alteran las
mediciones estándar; la noche se mide aparte. Los umbrales salen de los datos de cada tramo: su
horquilla (p50, p80, p95) y su valla, no una constante (R-TIM-009, R-FLO-007). Con ella se buscan
cuellos de botella, zonas oscuras y puntos conflictivos, sin causa. La cola es física: retiene quien
iba delante y no se iba. **La horquilla se descarga en CSV y se compara el primer periodo cargado con
el último, que es F3**; guardarla como referencia consolidada y compararla mes a mes es F4 y espera a
`CONTINÚA FASE 4` (OQ-130).

## Tiempos por fichero (2026-09-25)

Decisiones del propietario: una franja es **un fichero**; la hora del fichero es la de **recepción
en el servidor**, así que una entrega retrasada se ve como lecturas que llegan juntas y no desordena
la pila (R-DAT-020, nota en ADR-0013 y TC-023). Las mediciones por fichero **se rehacen** desde las
lecturas guardadas en cada importación y se descargan en CSV; guardar una copia fija es consolidar y
espera a F4. Por mantenimiento se cambian a veces 2 o 3 tags seguidos, y eso tiene que detectarse
bien desde las primeras mediciones. Orden aprobado: lecturas agrupadas, medición por fichero y
posición en tiempo, cambios de estructura por la suma entre anclas, y ritmo por AGV y quién retiene.
Un tag cambiado nunca es ancla: por eso un bloque de tres cambiados a la vez queda situado entero entre
las dos anclas que lo rodean, cuando el vecino compartido (R-DAT-017, R-DAT-019) deja suelto el del
medio. Qué tags hay no depende de la hora; la suma sí, y se compara en un solo régimen (R-DAT-021).
El ritmo de un AGV se mide contra la horquilla de cada tramo y frente a la flota, sin paradas ni
esperas, con prueba de signo y un efecto mínimo; por fichero, para ver si se vuelve más lento. Quién
retiene es del AGV de delante, no del sitio: en un cuello cada uno retiene cuando le toca (R-AGV-019,
R-AGV-020).

Los libros de Excel se entregan como ficheros; la aplicación solo los importa (propietario,
2026-09-25): las plantillas de listas y flota y el circuito de cada análisis se generan fuera del
programa, y en la interfaz no hay descargas de Excel.

## Lista del circuito de planta y exportación en Excel (2026-09-25)

Decisiones del propietario al convertir su lista de un circuito real al formato del importador: una
zona LLENO es `cargado` y VACIO o SIN CARRO es `vacio`; la columna de todos los tags es la memoria;
el primer tag de cada calle de carga es su parada precisa —es el último que se lee antes de una
espera de muchos minutos—, así que una calle puede empezar en su parada (R-CO-002); una situación
CRUCE es un crítico `cruce`; y de la función, solo lo que dice PRECISA es parada precisa. **El resto
del texto de planta se guarda y se enseña junto a cada incidencia del tag**, porque ayuda al
diagnóstico, pero no cambia ningún cálculo (R-GRA-007). Un tag que se lee y no está en la lista se
sitúa y se clasifica por día y noche (R-DAT-022): de día en el mismo sitio es candidato a esa
posición; solo de noche, con pasadas de día sin leerlo, es un tag de noche. Las lecturas también
entran en `.xlsx`, tal como las exporta Vsystem.

## La posición de un tag la dan las lecturas (2026-09-25)

El propietario: «el orden de tags del circuito no tiene por qué ser del todo correcto: puede contener
erratas al transcribir o un orden diferente al real. Al final las lecturas de los AGV son las que
dictan la posición real de los tags, y por eso existe este proyecto». La lista del circuito es lo
declarado; donde difiere de lo leído, manda lo leído y la diferencia es una corrección de la lista,
no un fallo del circuito (R-GRA-015). La aplicación enseña el orden del circuito según las lecturas
contra la lista, tag a tag; la lista corregida se entrega como fichero, y declarar un tag nuevo lo
decide el propietario. Un número parecido no prueba una errata: los tags vienen en familias de
números seguidos; lo que la prueba es el sitio.
