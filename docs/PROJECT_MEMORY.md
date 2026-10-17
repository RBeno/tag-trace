---
document_id: TT-PMEM-001
version: 0.68.0
status: baseline-candidate
last_updated: 2026-10-17
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

## Funciones críticas, situación de planta y refuerzos (2026-09-26)

Decisiones del propietario al revisar la conversión de la lista de PC2:

- **Toda función de planta es crítica**: «si falla una parada precisa, una parada, un cambio de MTC o
  un giro puede afectar al funcionamiento». Se añaden `parada`, `giro` y `cambio-de-mtc`; cualquier
  otra función entra con su nombre, cuenta como crítica y se avisa una vez de que no tiene regla
  propia. A qué clase va cada texto que no lo dice solo es OQ-132 (R-GRA-007).
- **La situación no es una función**: LINEA es producción y marca el consumo; PICKING es donde se
  carga el AGV; CRUCE es la zona que se cruza o comparte con otros circuitos. Solo CRUCE se declara
  crítico (`cruce`); un tag con función y en CRUCE se declara por su función, con CRUCE en la nota.
- **Tags seguidos con la misma función son un refuerzo** por si falla una lectura (R-GRA-016): uno
  sin leerse nunca con el otro leído es `refuerzo-sin-lectura`, sin redundancia pero con la función en
  pie. Un cruce seguido es una zona, no un refuerzo.
- **Cambio de MTC**: un tag que cambia el número de MTC (multicircuito) del AGV —normal, 1, 2… 15—
  para hacer alguna configuración especial; en PC2, «CAMBIO Nº MODO CIRCUITO» (confirmado, OQ-132
  cerrada). El número va en `grupo`; la hoja de PC2 no lo trae.
- **Qué es cada función de planta**: la parada precisa espera al servidor; la condicionada, a un
  sensor, un pulsador o una radio. Una PARADA es de seguridad: solo detiene, y el AGV no vuelve a
  funcionar si no es a mano. «MTC n C.O» ordena girar hacia la calle n que asignó el servidor
  (`bifurcacion`, calle en `grupo`). Pin arriba es recoger el carro y pin abajo, soltarlo. La
  reducción por arqueta es un tramo conflictivo (una arqueta metálica bajo la guía magnética), que
  seguido es una zona y no un refuerzo. Control wifi manda continuar a los AGV sin wifi. La entrada
  y salida con baterías es un cruce.
- **Lista de tags de noche** (`noche`): el propietario la da para explicar los tags que pueden
  aparecer de noche. Un tag suyo que solo se lee de noche es «tag de noche declarado»; si se lee de
  día, manda lo leído y se dice. En el inventario es `especial` (R-DAT-022).
- **Lista de PC2**: los cinco tags del circuito que no estaban en la memoria se añaden a la memoria, y
  los dos números mal escritos (uno de noche y uno de memoria) están corregidos en el libro de
  listas, fuera del repositorio.
- **Limpieza de la lista** (R-GRA-017): con las lecturas, los declarados que no están en el físico
  (para comprobar su función: colocar una copia o eliminarlos de Vsystem), los que están en otra
  posición, y cada refuerzo declarado comprobado contra el recorrido —«no puede haber tanto
  refuerzo»—. Se descarga en CSV.
- **Alimentación de la línea** (R-FLO-010): si por la línea no pasan AGV, está parada. La entrada es
  el primer tag de la lista `linea`. El pulmón no se declara: el propietario creía que eran 8 AGV y
  pidió que saliera de las medidas. Cada parada de la línea es con AGV esperando o «le faltaron AGV»,
  con el hueco con el AGV anterior y si el de detrás retiene a otros.
- **Ciclo de la línea**: unos 55 s, no fijo (periodos de 50 y de 60), la noche distinta y varias
  paradas. Cada tiempo entre pasos se mide contra su ciclo local, y lo que se pasa es tiempo sin
  paso, con AGV esperando o sin AGV (R-FLO-010).
- **Nada contamina los tiempos**: la noche se mide aparte, y la cola del pulmón durante una parada de
  la línea se quita como un descanso (R-FLO-010).
- **Tramos en las gráficas** (R-GRA-018): kitting, línea y cruces pintados en el anillo y en las
  horquillas, para leerlas mejor; la lista `tramo`, y si no, la línea y los cruces.
- **Descansos**: las paradas largas de la línea en horas redondas son descansos, y de 5 a 6 no suele
  haber producción (OQ-133 cerrada).
- **Batería de mediciones por incidencia** (R-AGV-021): cada parada sin explicación, primero de cola
  sin avanzar o AGV que deja de leer lleva lo mismo medido —última lectura, la línea, el de delante,
  los de detrás, cambio de AGV— para documentarla, sin causa. En una guía no se adelanta: si los de
  detrás llegan antes que él a donde reaparece, lo adelantaron; si él reaparece por delante, avanzaba
  sin registrar.
- **La auditoría como herramienta, no solo como red** (2026-09-26): leer su informe entero encontró
  dos falsos positivos que ninguna sonda vigilaba —cuatro zonas oscuras «el tramo tarda» que eran tags
  declarados sin lecturas, y el saltador de tags «delante de» un vecino al que nunca adelantó— y un
  escenario físicamente inconsistente (nadie esperaba detrás de la parada aislada). Los tres se
  corrigieron y ahora tienen sonda; además, dos invariantes de cero falsos positivos (huecos sin
  clasificar solo en paradas de la producción; ningún AGV «deja de leer»).
- **Pasos por la línea** (R-FLO-011): un AGV que no sigue tras la línea (el pin del carro), uno que
  pasó sin la parada (se fue con el carro) y uno que hace la parada sin leer un tag (su lector o su
  memoria). El propietario: nada específico de un circuito, porque casi todos tienen una línea
  parecida; los de vinculación siguen en paralelo y no paran.
- **FIFO**: la zona de cada tag sale del ESTADO de planta (LLENO → `cargado`, VACIO y SIN CARRO →
  `vacio`), y es lo que monta los tramos FIFO de zona cargada (R-FLO-001). Las calles de carga online
  van en `vacio` (R-FLO-003).

## F4 abierta (2026-09-26)

El propietario autoriza F4 con estas palabras, en la conversación del 2026-09-26, tras aprobar
ADR-0015: «De acuerdo con las dos, adelante con el ADR y la entrega. Y a continuación continúa con
Fase 4». Las dos decisiones aprobadas: retener en crudo solo la última exportación (o dos si se
solapan) y separar la instantánea automática de cada fichero de la consolidación humana. G3 se
cierra con lo que F3 dejó demostrado —diagnóstico explicable sobre el circuito de auditoría con 53
clases plantadas, revisión en campo, interfaz por preguntas— y con lo que sigue abierto declarado,
no marcado: OQ-101 a OQ-131 en su estado, OQ-143 sobre la retención.

Lo que F4 hereda ya hecho por la última entrega de F3 (`[3.50.0]`): la instantánea por fichero, el
almacén por fuentes con retención, las comparaciones entre ficheros desde las instantáneas y el
`.agvproj` con ellas. Lo que F4 tiene que crear (`ROADMAP.md`): la memoria consolidada como
versiones vN append-only elegidas por el propietario entre las instantáneas revisadas, el
comparador entre lo consolidado y lo nuevo (el «esperado» frente a lo observado), la
previsualización y el botón de confirmación humana, la revocación, y el presupuesto de crecimiento
medido. Ninguna IA consolida: la instantánea se guarda sola, la memoria la aprueba una persona
(ADR-0010, `MEMORY_CONSOLIDATION.md` §6).

La frase de transición a F5 es `CONTINÚA FASE 5`, y ninguna IA la escribe por el propietario. El
2026-09-27, con el PR #12 fusionado y los siete criterios de G4 con evidencia, el propietario dio la
orden («pasa a Fase 5») y marcó G4 en `PHASE_GATES.md`; F4 queda cerrada.

## Consolidación con versiones (2026-09-27)

Primera entrega de F4 (`CHANGELOG.md` `[3.51.0]`). La memoria del circuito son versiones vN
append-only: cada una es la instantánea de un fichero que la persona eligió, con las decisiones de
la revisión, su nota y el hash de la anterior. Se consolida desde la pestaña Memoria tras
previsualizar; bloquean solo los hallazgos pendientes, un rango 1 confirmado (periodo de
incidencia), una versión vigente del mismo fichero y una bifurcación sin resolver. Revocar no borra.
Cada importación compara el fichero de trabajo con la vigente. El `.agvproj` (esquema 3) lleva la
memoria y, al abrirlo, la aplicación clasifica el linaje y adopta el entrante si va por delante; una
bifurcación se resuelve conservando o adoptando, con razón. El mismo día el propietario cerró OQ-143
y OQ-144 con las recomendaciones («Ok entonces continúa con las 3», `[3.52.0]`): se retienen las dos
últimas exportaciones se solapen o no, volver a cargar un fichero lo recupera, las elecciones de
linaje de otro dispositivo se añaden al historial y las revocaciones que llegan se dicen; sin botón
de volver al ancestro común. Pendiente: el resto de G4 (incidencias excluidas del esperado,
presupuesto medido, comparación histórica), que es F4 todavía.

## El plano físico (2026-09-27)

El propietario comparó su esbozo inicial con el programa y aprobó recuperar tres ideas («Aplica los
puntos que has propuesto 1, 2 y 3», ADR-0016, `[3.53.0]`): la ubicación y el tag instalado son
identidades distintas; el plano físico persiste frente a las lecturas y solo cambia por
confirmación humana; y las estadísticas guardan recuento, media y M2 para sumarse entre periodos.
Añadió que una ubicación puede existir sin tag físico, y que los tags de parada por salida de
circuito, que casi nunca se recorren, entren como salidas del grafo que se revisan a mano
(R-GRA-021). El plano se crea desde una versión consolidada con una acción humana.

## Presupuesto, clasificación de cambios e incidencias (2026-09-27)

El propietario aceptó las cuatro recomendaciones sobre OQ-145 a OQ-148 (`[3.55.0]`): memoria y
lecturas retenidas comprimidas y cada fichero original archivado comprimido; un cambio es sostenido
en tres ficheros seguidos y colectivo si lo muestra más de la mitad de los AGV que pasan por el
sitio; solo los colectivos y sostenidos y los confirmados pasan al esperado; y un periodo con
incidencia se consolida entero, sin ella en el esperado. Queda abierta OQ-149: los hallazgos graves
con instante no están en la instantánea y no se excluyen todavía. El mismo día entró el comparador
entre dos versiones cualesquiera con su prueba de oro (`[3.56.0]`), que encontró y corrigió que un
cambio permanente no se adoptaba si se consolidaba cada periodo (OQ-150 para que el propietario
valide la lectura). Después el propietario cerró OQ-149 y OQ-150 con las recomendaciones
(`[3.57.0]`): los hallazgos graves con instante se excluyen como incidencia con su ventana, y un
cambio pendiente que vuelve se reclasifica como evento puntual. En esa entrega salió un fallo de
F4: la instantánea guardaba hallazgos que ninguna sección pintaba, y habrían bloqueado la
consolidación; la bandeja los enseña ahora. Con esto, cada criterio de G4 tiene evidencia; marcarlos
y escribir `CONTINÚA FASE 5` es del propietario. Después (`[3.58.0]`) entraron el recorte de ventana de
una incidencia desde el original archivado y la tasa por AGV en cada ubicación del plano. Después (`[3.59.0]`)
los valores de planta por circuito, confirmados por una persona. El propietario cerró OQ-151 a OQ-153 el
mismo día: se consolida con la configuración provisional, ante dos vigencias basta el aviso, y los
valores de planta se proponen con los estimadores aprobados solo si coinciden en las últimas tres
versiones; si no, los introduce una persona (`[3.60.0]`). Con esto queda hecho lo previsto para F4;
marcar G4, fusionar el PR y escribir `CONTINÚA FASE 5` son del propietario.

El propietario pidió después una revisión de la interfaz, la lógica y la consolidación, y que se
aplicara entera en el PR (`[3.61.0]`). Lo grave que salió: un linaje archivado exportado en el
`.agvproj` fingía una bifurcación en otro dispositivo; y cada botón de Memoria, Plano o Valores
terminaba el Worker del trabajo en curso, dejando paneles apagados e importaciones a medias. Con ello,
la confirmación lleva la huella de la previsualización, la memoria no se escribe a ciegas, el esperado
guarda su configuración (desde 3.60.0 se duplicaba en cada versión), la integridad de la memoria se
verifica al abrir un proyecto y la sustitución en el plano exige dos AGV. Quedan abiertas OQ-154 a
OQ-158 (estimadores acotados por el valor vigente, recortes por parada, aceptar revocaciones, linajes
antiguos con números repetidos y la cuenta arrastrada de una incidencia). El propietario pidió
aplicar la recomendación a las cinco (`[3.62.0]`): tolerancia de medida ancha solo para estimar, un
recorte por parada, rechazar un linaje con dos versiones del mismo número, no arrastrar la cuenta de
una incidencia, y dejar las revocaciones importadas como están.

## F4 cerrada, F5 abierta (2026-09-27)

El PR #12 (3.50.0 a 3.62.0) se fusionó en `main` (`551d4cd`, *squash*, por orden del propietario:
«Haz PR y fusiona»). Con los siete criterios de G4 marcados, el propietario dio la orden de abrir F5
(«pasa a Fase 5»): `project_state.json` pasa a `F5 / Laboratorio de incidencias`, con `CONTINÚA FASE 6`
como siguiente transición (G5). Nada de F5 está implementado todavía; su alcance es el de
`ROADMAP.md` («Se crea»/«Se formaliza»/«Salida demostrable»): creación de un expediente desde
síntoma, intervalo o hallazgo; retroceso temporal y topológico; replay multi-AGV con esperado e
incertidumbre; biblioteca de casos y similitud explicada; informe vivo y exportación local;
contramedidas y verificación antes/después.

## Mapa de calor de comunicación (3.64.0, 2026-10-07)

El propietario pidió «una visualización del mapa de calor WiFi si existe evidencia». **La evidencia
que hay** son las lecturas que llegaron juntas (R-DAT-020): no existe ninguna columna de señal o
cobertura en las fuentes, y un silencio solo no prueba WiFi ausente (R-OPP-003, OQ-105 sigue
abierta). Así que el mapa (`deliveryHeat` en el Worker, `deliveryHeatChart` en Tiempos y la capa
«Señal» del anillo en Resumen) pinta por tag del anillo la parte de sus pasadas leídas sin señal
—rampa continua relativa al tag más caliente, cifras de cabecera, rótulos en los más calientes,
fila de pérdida de señal—, y **solo se dibuja con alguna ráfaga**; sin ninguna lo dice y añade que
eso no prueba cobertura buena. El propietario pidió después que fuera «buena, profesional, que
muestre correctamente la información, intuitiva, estética»: de ahí la segunda forma, en la misma
versión. No introduce umbral: lo destacado sigue siendo lo de `summarizeDeliveries`. Dónde, no por
qué (R-EVI-006).

## F6, entrega 3: optimización y degradación (3.84.0, 2026-10-17)

Medido antes de tocar: el tirón de más de un segundo no era dibujar (60 ms) sino copiar las lecturas
como objetos al hilo principal (~800 ms con 461.000). Ahora viajan por columnas con buffers transferidos
y la tabla «Lecturas» lee de ahí: el máximo baja a ~0,1 s en D2, D3 y D4 y la memoria del hilo principal
de 648 a 156 MiB en D4. Degradación: sin medidas de los dispositivos no se inventa umbral; por encima de
500.000 lecturas (lo medido) se avisa y se importa igual. Pendiente: revisar con los informes del
propietario. Siguiente: entrega 4, interfaz coherente.

## «Cancelar» corregido (3.83.1, 2026-10-17)

Por orden del propietario («Arregla cancelar»): la importación avisa con `saving` antes de escribir;
hasta entonces, si no atiende «Cancelar» en 500 ms, la interfaz detiene el Worker (WP-004, que lo
preveía), y como no había escrito nada no se pierde nada. Antes de escribir, el Worker da paso a la cola
y atiende una cancelación pendiente. Desde `saving`, «Cancelar» desaparece. Banco: 501 ms (antes, 15,8 s
sin atender). Siguiente: entrega 3.

## F6, entrega 2: banco de medida (3.83.0, 2026-10-17)

Hecho: «Medir este dispositivo» (Datos) genera PERF-D2, D3 y D4 con semilla, los importa sin circuito
—nada se guarda— y mide primer progreso, huecos de fotograma, tiempo, memoria del hilo principal,
primera vista y paso del replay y cancelación; informe JSON para que el propietario lo devuelva desde
sus dispositivos. PERF-D4 se fija en 40 AGV, 120 tags y 15 s de cadencia (~461.000 lecturas), elegido
por el banco. **Hallazgo**: «Cancelar» no se atiende mientras se leen las filas (lectura síncrona en el
Worker; el `terminate()` de WP-004 no existe); en el contenedor, 15,8 s hasta acabar entera. Y el tirón
máximo pasa de un segundo en D3 y D4. Las dos cosas van a la entrega 3, con la medida del propietario.

## F6, entrega 1: actualización segura y versión identificable (3.82.0, 2026-10-17)

Hecho: el service worker se sella al compilar con su versión, la del almacén y la lista de ficheros;
la versión nueva se instala **en espera** y la página avisa con su número y qué pasa con lo guardado; se
activa solo a petición y sin trabajo en curso, aquí ni en otra pestaña (se pregunta por
`BroadcastChannel`). La versión abierta se sirve de su caché, también sin red. Cada publicación deja la
etiqueta `vX.Y.Z`; el retorno es lanzar la publicación sobre una etiqueta anterior (`VERSIONING.md`).
Encontrado al probar: la caché no encontraba los módulos con `Vary: Origin` y la aplicación no abría sin
red una vez de cada pocas; se compara con `ignoreVary`. Siguiente: entrega 2, el banco de medida.

## F6: orden de entregas y cuatro decisiones (2026-10-17)

El propietario aceptó el orden de `ROADMAP.md` §F6 (actualización segura, banco de medida, optimización,
interfaz coherente, accesibilidad y errores, sin red y seguridad, manual y operación, piloto) y las
cuatro sugerencias: piloto en Chrome del S23 FE y Chrome o Edge del PC (OQ-173); los expedientes
tendrán copia en el `.agvproj` (OQ-174, enmienda a ADR-0018 D2); criterio de rechazo del piloto en
cinco puntos (OQ-B05, cerrada); axe-core solo en pruebas (OQ-175).

## F5 cerrada, F6 abierta (2026-10-17)

El PR #17 (3.67.1 a 3.80.1) se fusionó en `main` (`b0f527a`, *squash*, por orden del propietario: «Haz
PR y fusiona»). El propietario escribió `CONTINÚA FASE 6`: G5 queda marcada con la evidencia de
`PHASE_GATES.md` y `project_state.json` pasa a `F6 / Piloto profesional`, con `CONTINÚA FASE 7` como
siguiente transición (G6). Queda abierto: el criterio de rechazo y la validación con datos reales
(OQ-B05, ahora para G6) y cuándo se dice `correlaciona` (OQ-172). Nada de F6 está implementado
todavía; su alcance es el de `ROADMAP.md` §F6: interfaz coherente de escritorio y móvil, accesibilidad
y estados de error, optimización y degradación por capacidad, suite E2E, rendimiento y seguridad,
Pages, actualización PWA segura con versionado y retorno, y manual de uso y guía de diagnóstico.

## Expedientes, entrega 6: biblioteca de casos y similitud explicada (3.80.0, 2026-10-17)

Hecho: cada expediente lleva «Casos parecidos» con los demás del circuito (sin descartados),
comparados característica a característica (igual, parecido, distinto, sin dato) y ordenados por
cuántas coinciden, sin pesos ni puntuación oculta (ALG-017 `similitud-1`). Lo confirmado en otro caso
va aparte y no es evidencia para este. Decisión: un hecho que se repite se cuenta pero **no se llama
`correlaciona`**; la frecuencia fuera de las incidencias no se mide y queda en OQ-172. Con esta, las seis
entregas de ADR-0018 están hechas; marcar G5 y escribir `CONTINÚA FASE 6` es del propietario.

## Expedientes, entrega 5: informe vivo y exportación (3.79.0, 2026-10-17)

Hecho: «Informe del expediente» descarga un HTML autocontenido con los diez apartados de
`INCIDENTS_REPORTING.md` §8, montado **desde los datos** del expediente (revisión vigente, cronología e
hipótesis del recorte, verificación registrada) y no desde la pantalla, con la revisión y su hash; lo
de una persona va marcado como suyo y el texto del programa pasa la prueba de lenguaje (la prueba cazó
un «no causas» del pie). «Cronología (CSV)» y «Lecturas del recorte (CSV)» exportan lo que lo sostiene.
El informe del circuito de la rama paralela (3.72.0) gana «Resumen de los expedientes de incidencia».
Siguiente: la entrega 6 (biblioteca de casos y similitud explicada).

## Expedientes, entrega 4: hipótesis, contramedidas y verificación (3.78.0, 2026-10-17)

Hecho: **hipótesis candidatas** desde los hechos de la cronología que preceden al síntoma (AGV detenido
aguas arriba, pérdida de conexión, AGV sin lecturas, turno o régimen), con evidencia a favor y **en
contra observada** (otro AGV ya parado delante; lecturas de tags distintos durante el corte), estado
compatible/contradicha/abierta sin probabilidades, y la comprobación que discrimina. La persona añade
las suyas y confirma (con la comprobación) o descarta (con razón); la decisión se guarda por clave y la
hipótesis del programa se recalcula del recorte. **Contramedidas** con la métrica del síntoma, fija, y
fecha de aplicación; **verificación** (ALG-024) una semana antes y otra después, en producción, en tiempo
cubierto y sin otros expedientes, con prueba binomial exacta, que propone eficaz/parcial/ineficaz/sin
exposición con umbrales provisionales (`incident_case.verification_*`). Siguiente: la entrega 5
(informe vivo y exportación, que tiene que juntarse con el informe del circuito de 3.72.0).

## Expedientes, entrega 3: replay con esperado (3.77.0, 2026-10-17)

Tras D5, la entrega 3. Hecho: el **replay del expediente** (`buildCaseReplay` en `replay.ts`, que se
amplía y no se duplica), pedido desde el expediente y calculado en el Worker sobre el recorte de la
revisión vigente: 200 fotogramas por toda la ventana con su fase; por AGV, lo visto (tag, tránsito
como fracción de tiempo, silencio, sin datos), la **banda esperada** desde su última lectura entre el
paso lento (p95) y el habitual (p50) de cada tramo, con «va por detrás incluso del paso lento», y la
conexión del registro del terminal; los hechos de la cronología caen en su fotograma y cada uno lleva
«Ver en el replay». Medido: 54.000 lecturas de 40 AGV en ~0,13 s. Falta: zonas, calles CO y puntos
críticos en el replay, filtros por AGV/tag/zona, y medir en el móvil. Siguiente: la entrega 4
(hipótesis, contramedidas y verificación).

## D5: expedientes propuestos al consolidar (3.76.0, 2026-10-17)

El propietario pidió hacer D5 antes de la entrega 3. Hecho: la previsualización de la consolidación
propone la ventana de cada expediente no descartado que toque el fichero como **incidencia excluida**
(clave `expediente|<id>`), con su ventana recortada al fichero, su AGV y los tags que nombra con sus
tramos; la persona la suelta quitando su casilla y volviendo a previsualizar, y lo soltado entra en la
huella. La versión guarda la incidencia; el expediente no se escribe. Los recortes de ventana de F4
valen también para ellas. Las incidencias de expediente no se ofrecen como punto de partida de otro.

## Expedientes, entrega 2: retroceso y caso de oro (3.75.0, 2026-10-17)

El propietario pidió la entrega 2 «teniendo en cuenta y adaptando todo el contenido a los cambios
realizados anteriormente». Antes de construir se integró la rama paralela de «Organizar TAG TRACE»
(3.68.0–3.72.0: áreas y función, pestaña WiFi, avisos, problemas detectados e informe HTML), que salió
del mismo punto de `main`; lo de los expedientes pasó detrás (3.73.0, 3.74.0; OQ-169–171; TC-338–341).
Hecho: el **retroceso desde el síntoma** (`src/domain/case-backtrack.ts`, `retroceso-1`) sobre un
recorte que ahora congela también los eventos de conexión y el contexto (`recorte-2`: anillo y
horquillas del esperado vigente o del fichero, umbrales y lo declarado en planta de la rama paralela);
la cronología por fases en cada expediente, con `precede` solo para lo anterior y la primera desviación
marcada; y el **caso de oro de TC-012** en un escenario propio (no en el circuito de auditoría, para no
mover sus clases). Lo habitual de un paso se mide antes del síntoma. Pendiente: D5 (que la
consolidación proponga la ventana de cada expediente), y las entregas 3 a 6. El informe del circuito
de la rama paralela (FR-026) todavía no incluye los expedientes: es de la entrega 5.

## Expedientes, entrega 1 (ADR-0018 aceptado, 3.74.0, 2026-10-09)

Numerada 3.69.0 al hacerse; pasó a 3.74.0 (y la propuesta del ADR, de 3.68.0 a 3.73.0) al integrar el
2026-10-17 la rama paralela de «Organizar TAG TRACE» (3.68.0–3.72.0), que salió del mismo punto de
`main`. Por lo mismo, sus preguntas pasaron de OQ-167–169 a OQ-169–171 y sus pruebas de TC-330–333 a
TC-338–341.


El propietario aceptó ADR-0018 («Acepto el ADR, empieza la entrega 1»). Hecho: el modelo del
expediente (`src/domain/incident-case.ts`), el almacén versión 12 con `incidentCases` (revisiones
append-only encadenadas por hash) e `incidentEvidence` (recortes comprimidos por hash), `case-action` y
`cases-updated`, el Worker que congela el recorte desde las lecturas retenidas o el original archivado,
y la sección «Expedientes de incidencia» al final de Línea y calles (crear desde síntoma, incidencia
medida, incidencia excluida o hallazgo; ventana en borrador; estados con lo que falta; notas). Los
márgenes mínimos son provisionales (30 min, `incident_case.*`). Probado que nada fuera de las tablas de
expedientes cambia (TC-340). **Pendiente de D5**: que la consolidación proponga la ventana de cada
expediente como incidencia excluida; hoy no lo hace. Siguiente: la entrega 2 (retroceso, cronología y
caso de oro de TC-012).

## Modelo del expediente propuesto (ADR-0018, 3.73.0, 2026-10-09)

El propietario pidió empezar F5 por el ADR del expediente. ADR-0018 (proposed, sin código) separa
**expediente** (la investigación de F5) de **incidencia excluida** (la exclusión del esperado de F4,
que no cambia y desde la que se puede abrir un expediente). Propone revisiones append-only que guardan
solo lo humano y referencias a lo calculado; un **recorte congelado** de las lecturas de todos los AGV
en la ventana con márgenes, porque la retención suelta las lecturas tras dos exportaciones
(R-DAT-023); almacén y sección del `.agvproj` propios; y la consolidación siguiente **propone** la
ventana de cada expediente como incidencia excluida, sin que el expediente escriba la memoria. El
lenguaje queda en cinco etiquetas (`precede`, `es compatible con`, `contradice`, `correlaciona`,
`confirmado como causa`); la última solo la pone una persona, `correlaciona` exige repetición, no hay
probabilidades y el vocabulario causal está prohibido en el texto generado. Seis entregas, la segunda
con el caso de oro sintético de TC-012. El mismo día el propietario cerró las preguntas del ADR: el
expediente es **solo local**, en un dispositivo, sin `.agvproj` ni bifurcaciones (OQ-169); se añaden
`Discarded` y la reapertura (OQ-170); ALG-015 pasa a llamarse «Retroceso desde el síntoma» (OQ-171);
y se aceptan las recomendaciones de márgenes y recorte, formatos de informe y verificación de
contramedidas (OQ-P02, OQ-P03, OQ-P07). El ADR sigue `proposed`: aceptarlo es del propietario y
nada se construye antes.

## Organizar TAG TRACE: cuatro entregas, la primera hecha (3.68.0, 2026-10-17)

El propietario: «Vamos a organizar TAG TRACE»: el Resumen enseña lo importante y lleva a su sitio
(un AGV con muchas menos lecturas por vuelta manda a AGV; un tag que deja de leerse, a Tags; la WiFi
igual si está cargada); orden para ir directo a una anomalía; el circuito guarda **áreas** y
**función** de cada tag y las dice **solo cuando hay riesgo**, con su refuerzo anterior o posterior.
Decidido con él: WiFi como pestaña propia solo con registro cargado; las áreas como lista nueva
`area` (una fila por tag y área); el Resumen enseña rango 1 y 2 completos y rango 3 plegado; orden de
entregas: áreas y función → WiFi → Resumen → Tags y AGV. `ROADMAP.md` ponía la interfaz coherente en
F6; se adelanta a F5 por su petición. **Hechas la primera** (3.68.0, R-GRA-022: lista `area`, y «Declarado
en planta» con las áreas y el refuerzo por su lado) **y la segunda** (3.69.0: pestaña WiFi solo con
registro cargado, y los cinco tipos `conexion-*` en el catálogo con tema WiFi y rango; hasta entonces
caían en contexto con su identificador en bruto) **y la tercera** (3.70.0: «Avisos» en el Resumen con
la configuración que no se pudo usar y lo que falta o contradice, cada uno con su enlace; rango 3
plegado en la bandeja). Precisión del propietario, aplicada en 3.70.1: **función y área tienen identidad
distinta** («una función puede pertenecer a un área»): listas distintas y etiquetas distintas en
«Declarado en planta». **Y la cuarta** (3.71.0): «Problemas detectados» al principio de Tags, AGV y WiFi,
Tags y AGV con los problemas primero y el contexto al final, y «AGV que dejan de leer» en AGV. Las
cuatro entregas están hechas; la interfaz coherente que `ROADMAP.md` ponía en F6 queda adelantada en
lo que el propietario pidió. Después (3.72.0) pidió un Resumen «claro, funcional y profesional» con
botón de informe y una revisión de referencias (ISA-101, Few, Endsley, Shneiderman, Fluke): frase de
estado antes de las cifras, saltos locales, **informe HTML autocontenido** por secciones con los
hallazgos y su revisión (FR-026) y hoja de impresión. Las sugerencias no hechas están en `UX_SPEC.md`
§4.8. Lo que ya existía y se conserva: la bandeja del
Resumen con «Ver evidencia», la línea «Declarado en planta» solo en tarjetas con hallazgo y en el
expediente.

## Otro circuito con tres recorridos: desvíos y dos preguntas (3.67.1, 2026-10-09)

El propietario aportó el registro de conexiones y las lecturas de un segundo circuito, sin cargas
online externas y con **tres recorridos** de flotas disjuntas bajo un mismo nombre (DATA_CONTRACTS
§3.2). Analizado fuera del repositorio; se le entregaron tres ficheros: el orden de los tags por
recorrido, los cortes por tag con los desvíos, y un borrador de listas (`circuito` con los tres
recorridos como subsecuencias, `tramo` y `ancla`) que el importador acepta sin rechazos y con cada
recorrido entero «igual» (R-GRA-015). Lo que queda: las estaciones de un recorrido concentran los
cortes con el AGV parado (seis veces la tasa por hora de la flota); cuatro AGV se salieron de su
recorrido y en tres el propio AGV registró `PARADA FIJA POR TAG (11)` justo al leer un tag de otro
recorrido (OQ-167); y LECTURAS por AGV trae tags `Sin asignar` que el informe ampliado omite, contra
OQ-162 (OQ-168). El emparejamiento de cortes del producto ya resuelve bien el mismo segundo por la
posición en el fichero (`connection-log.ts`); el error de un primer recuento fue del script externo.

## PR #15 fusionada y las dos familias de color (3.67.0, 2026-10-08)

La PR #15 (3.66.0: terminales ruidosos, mapa por clase, los que no reconectan, OQ-164 a OQ-166, las
dos correcciones de los datos reales, la corona del anillo y las cifras del mapa que dicen lo que
pintan) se fusionó en `main` (`43f0799`, squash, «Haz PR y fusiona»). Después el propietario precisó
el color: **dos familias**, los tags (omisión) en azul y toda la WiFi —observada (Conexión) e inferida
(Ráfagas)— en verde azulado, con la intensidad creciendo con el fallo, en un conjunto armónico. Hecho
en 3.67.0 con el tono afinado y validado; el naranja sigue siendo el patrón y el rojo la caída. Y como
en el anillo «estaban todos en verde», las capas «Conexión» y «Ráfagas» funden las dos medidas sin
mezclarlas: la banda es la omisión en azul, como en «Omisión», y la WiFi va solo en la corona.

## Terminales ruidosos, mapa por clase y los que no reconectan (3.66.0, 2026-10-08)

El propietario: un terminal que no para de conectar y desconectar contamina la muestra y tapa la
evidencia del resto; quiere detectar fallos de roaming, expulsiones del servidor, «listas largas» y
AGV que no reconectan. Hecho: **ruidoso** = tasa de cortes propios por mil pasadas ≥ 3× la mediana de
la flota con ≥ 10 cortes (R-COM-009): fuera del mapa, de la concentración por sitio y de las horas,
con sus pasadas; sigue en su tarjeta y en la tabla. **Mapa por clase** (microcortes por sitio en muchos
AGV = roaming). **No reconectan** (R-COM-010): corte abierto o cerrado solo por encendido fuera de un
apagado colectivo, ≥ 10 min. En sus datos: un AGV corta 3,8× la mediana (ruidoso); `SUPERADO TIEMPO
MAXIMO OFFLINE` del informe ampliado cae dentro de un corte 5 de 5 veces (OQ-165: ¿es la marca de la
expulsión? conservar los usos para cruzarlos); un AGV solo volvió al apagar y encender dos veces fuera
del apagado nocturno. **«Listas largas»** son la lista de dispositivos de cada punto de acceso, que
crece donde coinciden cinco o seis circuitos (OQ-164): con PO4 solo, la ocupación del propio circuito
en el momento del corte es igual que al azar (1,1 frente a 1,2 AGV cerca), salvo un sitio aglomerado;
para medirla hacen falta los informes ampliados de los circuitos que coinciden y, si el terminal lo
da, el punto de acceso de cada conexión (OQ-166). Es una decisión sobre el aislamiento de circuitos
(ADR-0004), no se construye sola.

## Registro de conexiones construido (3.65.0, 2026-10-07)

El propietario aceptó ADR-0017 con las cuatro recomendaciones y pidió el importador. Hecho de punta
a punta: fuente **DS-013** (un fichero por AGV, carga en lote, AGV del nombre corregible, huella por
fichero, guardado con el circuito en el almacén v11), **cortes** emparejados, clasificados por
`connection_cuts.*` (provisionales 10 s / 10 min), situados entre P y Q con los anillos, resumidos por
tag, tramo y AGV con la prueba de azar, **contraste** con las ráfagas y lecturas dentro de caídas
(R-COM-004 a R-COM-007), **Mapa de estado de conexión (WiFi)** en Tiempos y capa «Conexión» del
anillo. El mapa de 3.64.0 se renombra «de lecturas que llegaron juntas» y su capa «Ráfagas»: lo
observado y lo inferido nunca se mezclan. OQ-159 sigue abierta a la espera del fabricante, y el
producto enseña la cifra que la decide (lecturas con fecha dentro de una caída). OQ-163 nueva (`No
ejecutado`). Los datos reales siguen fuera del repositorio.

**Hechos de planta del propietario (2026-10-07), ya aplicados (R-COM-008):** los AGV se apagan hacia
las 5 de la mañana hasta las 6 (a veces encendidos a las 5:30), así que una desconexión de todos a esa
hora es apagado, no cobertura; el registro lo confirma (el 6 de octubre, seis AGV se desconectan entre
las 4:50 y las 4:58 y vuelven «tras apagado» entre las 5:33 y las 6:00). Las horas de los demás cortes
siguen la producción (más de 7 a 9 y de 15 a 21, casi nada de 2 a 4). Dice también que la frecuencia
de cortes por AGV aumenta con el tiempo: con dos días no se ve; el producto enseña los cortes propios
por día de cada AGV y no afirma tendencia con menos de tres. Horas y clases de apagado nunca van como
constante: clase por el cierre «tras apagado» y colectivos por `connection_cuts.*`.

## Registro de conexiones por AGV: propuesta y contradicción (2026-10-07)

El propietario aportó exportaciones por AGV del terminal (CONEXIONES y LECTURAS) para medio PO4 y
preguntó cómo construir un mapa de estado de conexión real. Analizado fuera del repositorio
(ADR-0017, proposed): **CONEXIONES es evidencia directa** (pares `Desconexión`→`Conexión` al
segundo) y se localiza por las lecturas del mismo AGV; diez tags concentran casi la mitad de los
cortes. **LECTURAS por AGV es el informe ampliado filtrado** (filas idénticas). **Contradicción**
(OQ-159): durante cortes de WiFi de minutos u horas las lecturas siguen llegando con fecha dentro
del corte y a cadencia normal, sin ráfaga al reconectar, así que la hora del fichero no parece la
de recepción por ese enlace, contra lo dicho el 2026-09-25 (R-DAT-020). Hasta que decida OQ-159 a
OQ-162, R-DAT-020 no se toca, el mapa de 3.64.0 sigue llamándose «lecturas que llegaron juntas» y
no se escribe código del registro de conexiones. Los datos reales se quedaron fuera del repositorio.

## Estado al 2026-10-17 (relevo a un chat nuevo)

El trabajo sigue en otra conversación por el límite de contexto. Todo lo que dura está aquí, en
`project_state.json` y en `CHANGELOG.md`; lo que no esté escrito en el repositorio no existe para la
conversación siguiente.

- **Fase F6** (piloto profesional), abierta el 2026-10-17 por el propietario (`CONTINÚA FASE 6`)
  tras fusionar F5 con el PR #17 (`b0f527a`); F7 espera `CONTINÚA FASE 7` (G6). Lo primero de F6 es
  leer `ROADMAP.md` §F6 y `PHASE_GATES.md` §G6 y proponer el orden de entregas al propietario.
- Antes, **fase F5** (laboratorio de incidencias), abierta el 2026-09-27 por el propietario («pasa a Fase
  5»), tras cerrar F4 con el PR #12 fusionado (3.50.0 a 3.62.0, `551d4cd`). F6 espera `CONTINÚA FASE
  6` (ADR-0010). **Las entregas desde entonces son el mapa de calor de lecturas que llegaron
  juntas** (3.64.0) y **el registro de conexiones con su mapa de estado de conexión** (3.65.0,
  ADR-0017, secciones anteriores), ninguna un entregable de `ROADMAP.md` §F5. El trabajo propio de la fase
  empezó con ADR-0018 (aceptado), su entrega 1 (3.74.0) y su entrega 2 (3.75.0); D5 está hecho
  (3.76.0) y la entrega 3 también (3.77.0); las entregas 4, 5 y 6 también (3.78.0 a 3.80.0): ADR-0018 está
  completo y lo siguiente lo decide el propietario (G5, OQ-172). Antes de eso, el punto de partida estaba en `ROADMAP.md` §F5, y `CONTEXT_INDEX.md` dice qué documentos exige antes de tocar nada
  (probablemente ADR nuevo para el modelo del expediente y el lenguaje de causalidad/correlación,
  antes de escribir código). Historial completo de F4 en las secciones de arriba de este documento y
  en `CHANGELOG.md` `[3.50.0]` a `[3.62.0]`. Anterior a F4: **revisión de toda la lógica de medición y análisis**
  (`CHANGELOG.md` `[3.43.0]` y `[3.44.0]`): unos treinta fallos reproducidos y corregidos, con su
  regla anotada «revisión de la lógica, 2026-09-26», y siete preguntas nuevas para el propietario
  (OQ-135 a OQ-141), dos de ellas contradicciones código↔documento que no se tocan hasta que decida.
  Todas quedaron cerradas el mismo día (`[3.45.0]`, `[3.46.0]`): la carga online pertenece al
  circuito y las calles se comprueban en tres cosas (R-CO-009); deriva es moverse siempre hacia el
  mismo lado (R-TIM-010); la hora repetida se resuelve por la posición en el fichero (ADR-0013); «sin
  paso», «deja de leer» y `desaparecido`/`nuevo` afirman solo lo que prueban; el historial de flota
  admite alta y baja el mismo día; las constantes de planta quedan provisionales hasta F4; y varias
  anclas en puntos críticos miden tiempos por sección con nombre de tramo (R-TIM-012). La última entrega es la posición de un tag según las lecturas (R-GRA-015,
  `CHANGELOG.md` `[3.32.0]`), publicada en `main` y en la web.
- **Cómo se ha trabajado**: una entrega por petición del propietario, con su documentación, su clase
  plantada en la auditoría sintética (`tests/audit/`, 53 clases) y un solo commit en la rama de
  trabajo; PR y fusión solo cuando él lo pide. Las decisiones de cada entrega están en las secciones
  de arriba y en el `CHANGELOG`.
- **Pendiente de planta**, sin identificadores:
  1. Calibrar los umbrales provisionales (`draft`) con datos reales (OQ-129).
  2. El propietario revisa la lista de un circuito corregida por las lecturas, que se le entregó
     como fichero, y decide qué tags leídos que la lista no tiene se declaran.
  3. Resuelto el 2026-09-26: el propietario dio el número correcto del tag de noche; está en el libro
     de listas, fuera del repositorio.
  4. El resto de preguntas abiertas, en `OPEN_QUESTIONS.md`.
- **Fuera del repositorio**: los scripts y las salidas de los análisis con datos de planta vivían en
  `local/` (ignorado por git) y se le entregaron al propietario en un paquete. Para analizar datos
  nuevos hay que volver a subir la exportación y, si hacen falta, las listas.

