# Registro de cambios

Todos los cambios relevantes del proyecto se documentan aquí. El formato sigue *Keep a Changelog* y las versiones de producto seguirán versionado semántico cuando exista software ejecutable.

## [1.5.0] - 2026-09-17

Una corrección del propietario invierte R-AGV-009, y es la más importante de la serie porque la
regla mal escrita habría hecho que el software **callara un fallo real**.

### Corregido

- **Salir del circuito no es una reubicación benigna: es una anomalía por diseño.** Los cruces
  llevan un par de tags de protección precisamente para detener a un vehículo que se desvía, así
  que si salió, algo no funcionó — el giro no se ejecutó, no leyó los tags, o la orden no se cursó.
  R-AGV-009 decía lo contrario: que no era avería y que el intervalo era «sin datos cargados». Se
  reescribe entera. Lo que sí se conserva del enunciado viejo es que **la ausencia de lecturas
  mientras está fuera sigue sin ser medible**: el hallazgo es la salida, no el silencio. Eran dos
  cosas y estaban mezcladas.

### Añadido

- **R-AGV-011**: el modo de fallo se discrimina con los propios tags de protección. Si aparecen en
  las lecturas y el vehículo salió igual, la lectura funcionó y la orden no; si no aparecen, falló
  la lectura. Ambas ramas son `inferred` y se presentan con su evidencia.
- **`crossings`** en `CONFIG_SCHEMA.md` §3.4: por cada cruce, el par de tags de protección en el
  orden en que se leen, el tag esperado si el giro se ejecuta y el circuito de destino, con
  vigencia. Configuración de planta: la forma al repositorio, los valores fuera.
- El expediente por vehículo presenta cada salida con **el sucesor que sus vecinos sí toman**, los
  tags que leyó justo antes, y una marca cuando hubo intervención manual.

### Medido

En el circuito largo de una exportación, la secuencia del cruce la recorren los ocho vehículos
entre siete y ocho veces cada uno **sin una sola excepción**, salvo uno que falla dos veces la misma
tarde y de **dos maneras distintas**: una vez se desvía antes del segundo tag de protección, otra
lee los dos y se va igual. Son exactamente los dos modos de fallo, separados por el propio dato. Las
dos acaban con intervención humana: parada desde web en el segundo de reaparecer, parada manual,
acceso al menú de administración.

### Abierto

- **OQ-121**: cuáles son los pares de protección de cada cruce. Sin ellos se puede señalar dónde se
  salió un vehículo, pero no qué falló.
- **OQ-119 reformulada**: la pregunta ya no es adónde fue, sino qué cruce falló y de qué modo.

## [1.4.0] - 2026-09-17

Un hecho de dominio del propietario —un vehículo solo registra los tags que lleva en **memoria**—
cierra una pregunta abierta y abre una restricción que afecta a todo el diagnóstico.

### Corregido

- **La confirmación cruzada entre circuitos no existe.** Se había propuesto cargar la exportación
  del circuito de destino y buscar allí las lecturas del vehículo que se va. Si no lleva esos tags
  en memoria **no aparece en esa exportación**: no hay nada que buscar. La salida se sigue
  detectando por la incoherencia de la reanudación (R-AGV-009) y se queda en `inferred`.

### Añadido

- **R-OPP-009**: una oportunidad solo es elegible si el tag está en la memoria de ese vehículo, y
  **sin el inventario de memoria ninguna tasa de lectura es interpretable como salud** — «no lo
  detectó» y «no lo lleva cargado» producen exactamente el mismo dato. DS-008 pasa de fuente
  auxiliar a requisito.
- **R-OPP-010** y `DATA_CONTRACTS.md` §3.4: la forma de la ausencia sí discrimina, y es gratis.
  Normalizando por las vueltas de cada vehículo —el recuento bruto las contamina, porque quien da
  menos vueltas lee menos de todo—, un tag cae en **bimodal** (unos siempre, otros nunca → memoria)
  o **gradiente** (todos algo, unos menos → detección).
- Sección de ceguera en el expediente por vehículo, con sus hipótesis ordenadas y sin publicar
  ninguna tasa de salud.

### Medido

El patrón bimodal existe y se concentra: en una exportación de 53 vehículos, **seis acumulan el
91 %** de los casos de ceguera, y los conjuntos de dos de ellos **se solapan**. Un vehículo con más
de mil lecturas y 170 tags distintos que nunca lee dos tags concretos que sus cincuenta compañeros
leen siempre no es una casualidad de detección.

### Cerrado

- **OQ-118** en su mayor parte: eran tres cosas mezcladas —circuitos distintos en un mismo fichero,
  tags fuera de memoria, y detección—. Solo queda abierto el resto con patrón de gradiente.
- **OQ-120** abierta: qué lleva cada vehículo en memoria y con qué vigencia.

## [1.3.0] - 2026-09-17

Tres hechos de dominio del propietario invalidan la comparación que sostenía el análisis por
vehículo, y con ella su conclusión. La corrección vale más que el análisis original.

### Corregido

- **El cohorte era el fichero, y tiene que ser el circuito.** Una exportación resultó contener
  **tres circuitos** bajo un mismo nombre, con flotas disjuntas. Comparar un vehículo contra otros
  que recorren un trazado distinto no mide su estado: mide el trazado. El vehículo analizado salía
  «en la mediana» de la flota entera y era **el último de los ocho** de su circuito. Se separan por
  aristas exclusivas (R-DAT-012).
- **Una parada larga se estaba contando como hallazgo.** Donde la carga se hace en el propio
  recorrido, parar mucho es el modo normal de operar: los vehículos de esa exportación pasan entre
  el 77 % y el 87 % del tiempo parados. Lo que informa es si las paradas de uno se salen de las de
  sus vecinos, no que existan (R-AGV-010). Con el criterio corregido, el vehículo analizado es **el
  que menos para** de su circuito y para en los mismos tags que ellos.
- **Un silencio se estaba leyendo como avería cuando era una salida del circuito.** Reaparecer
  donde no se llega desde donde se desapareció es firma de haber estado en otro sitio, no de un
  fallo (R-AGV-009). El intervalo es `sin datos cargados` para ese vehículo hasta cargar la
  exportación del circuito de destino.

### Añadido

- Sexto discriminante en `ALGORITHM_CATALOG.md`: la reanudación incoherente con el circuito. Sobre
  datos reales separó sin umbrales que calibrar — trece vehículos con cero o una, y el que
  efectivamente cambiaba de circuito con cinco.
- R-DAT-012, R-AGV-009 y R-AGV-010; `DATA_CONTRACTS.md` §3.2 sobre nombres de circuito que esconden
  varios circuitos.
- **Un vehículo sin circuito asignable ya no se analiza**: se declara que no hay evidencia y se
  para. Un informe de comparaciones contra un cohorte vacío es peor que no tener informe, porque
  parece un análisis.

### Abierto

- **OQ-119**: qué marca el paso entre circuitos. Medido que ocurre por tags ordinarios que todos
  leen, no por una puerta dedicada.

## [1.2.0] - 2026-09-17

Segundo escenario de exportación, auditoría de lo entregado y las primeras representaciones.

### Añadido

- **Filtro por AGV y por tag** en la tabla de lecturas. Sin él, una importación de sesenta mil filas
  eran trescientas pulsaciones de «mostrar más» y no respondía a ninguna pregunta; la vía de trabajo
  declarada como principal es justo esa —«qué le pasa al 3524»—. La comparación es exacta sobre el
  texto recortado: `0040` y `40` son identificadores distintos (INV-002) y una coincidencia parcial
  mezclaría `2032` con `20321`.
- **Ventana observada** en el resumen de fuente. No se llama cobertura a propósito: la cobertura de
  R-DAT-007 es la unión de los intervalos de todas las fuentes de un circuito y excluye el último
  minuto incompleto; aquí solo hay una fuente y no hay circuito todavía.
- `UX_SPEC.md` §5.1 con las cuatro representaciones y, para cada una, **el límite escrito en la
  propia vista**: un hueco es ausencia de lecturas y no una parada; el agrupamiento de eventos es
  léxico y no semántico; las horas de los bordes están cortadas; el eje del circuito es orden
  topológico y nunca distancia.

### Corregido

- **Un error de clasificación en el circuito reconstruido, encontrado al auditar lo ya entregado.**
  Etiquetar como «derivación» todo lo que queda fuera del anillo afirma que el vehículo tomó otro
  camino. Contrastando tiempos, la mayoría no lo tomó: si pasar por un tag cuesta lo mismo que no
  pasar, el tag está en la línea y lo que varía es **si se leyó**. Llamarlo rasgo del circuito lo
  archiva y lo saca del diagnóstico para siempre, que es exactamente el hallazgo que este producto
  existe para dar.
- **Y un error en la primera versión de esa corrección.** Con solo la prueba de tiempos, treinta y
  un tags con más de 370 lecturas salían como «leídos a medias»: basta una omisión entre
  cuatrocientas para que exista el salto directo que la prueba busca. Hace falta además que ese
  salto ocurra en una fracción apreciable de las pasadas. Con las dos condiciones la clase pasa de
  44 tags a 11, y la cifra que lo hace visible —la tasa de omisión— es ahora una columna.

### Abierto

- **OQ-118**: por qué ciertos tags de la línea se leen solo en parte de las pasadas, con omisiones
  medidas entre el 12 % y el 99 %. Que están en la línea está probado; la causa no. Candidatos: el
  multicircuito, el lector, o un tramo paralelo demasiado corto para notarse en los tiempos.

### Verificado contra la fuente real

Un segundo escenario de exportación —sin las columnas de multicircuito y uso y sin las filas de
uso— ejercita los caminos contrarios al del primero: se decodifica por la rama de UTF-8 **estricto**
en vez de por el respaldo, y las filas sin tag bajan del 40 % al 0,17 %, que es el caso difícil de
contar bien. Los dos escenarios coinciden en vehículos y tags, así que se validan mutuamente.

## [1.1.0] - 2026-09-17

El importador se enfrenta por primera vez a una exportación real del informe ampliado (DS-011), de
un circuito distinto al de la muestra anterior. Funcionó, y destapó dos defectos que ninguna prueba
sintética habría encontrado porque ninguna los había imaginado.

### Corregido

- **La decodificación mentía.** `TextDecoder("utf-8", { fatal: false })` no falla nunca: sustituye
  en silencio cada byte que no entiende por un carácter de reemplazo. La fuente real exporta en
  Windows-1252, así que la cabecera llegaba corrompida y la importación seguía adelante como si
  nada. Ahora se intenta UTF-8 **estricto**, se cae a Windows-1252 cuando falla, y la codificación
  elegida se declara en el resumen junto al separador (R-DAT-010). La decodificación vive en
  `src/ingestion/decode.ts`, no en el Worker, porque es una decisión de ingesta y hay que poder
  probarla.
- **Cuatro de cada diez filas se contaban como defectuosas sin serlo.** La fuente entrelaza
  lecturas con eventos de vehículo, y un evento trae instante y AGV pero no trae tag. El importador
  los mandaba a cuarentena como `EMPTY_FIELD`: habría dicho que casi la mitad del fichero está roto
  y enterrado las filas realmente defectuosas entre decenas de miles de falsas. Ahora se separan
  por su forma —`NO_TAG`—, se conservan con su procedencia y se cuentan aparte (R-DAT-009). El
  importador dice **que no son lecturas**; qué son lo dice el discriminador de la fuente, no él.

### Añadido

- `SourceSummary` declara `encoding` y `rowsWithoutTag`, y la interfaz los muestra. Si nadie declara
  la codificación se dice `desconocida`: el núcleo recibe texto ya decodificado y no puede saberlo,
  así que no lo supone.
- R-DAT-009, R-DAT-010 y R-DAT-011; §3.7 de `CONFIG_SCHEMA.md` con los catálogos de la fuente como
  enumeración versionada con vigencia.

### Precisado

- **El multicircuito va declarado en el tag.** Medido sobre la exportación real: ningún tag declara
  jamás dos valores distintos, pero solo una parte de los tags lo declara, y de esos unos lo emiten
  en todas sus pasadas y otros solo en una fracción —el mismo vehículo sobre el mismo tag unas veces
  lo trae y otras no—. Qué dispara esa emisión no está en el dato: se registra como pregunta abierta
  (OQ-116) y, mientras tanto, ausente es `unknown` y nunca «el mismo de antes» (R-DAT-011).

### Cerrado

- **OQ-B03**, dispositivos de referencia, con la advertencia de que ambos son de gama alta y sesgan
  las medidas hacia el optimismo.
- **OQ-111 y OQ-113 quedan parciales**, no cerradas: las listas de usos y de defectos están
  obtenidas y son cerradas, pero saber que un valor existe no dice si implica una parada real, y de
  eso depende que un silencio se explique o se diagnostique.
- **Nueva OQ-117**: dos tags declarados dentro de las calles de carga no tienen ninguna lectura en
  casi 18 h, mientras el tramo que ocuparían se recorre en directo decenas de veces.

## [1.0.0] - 2026-09-17

Primer código de aplicación del proyecto. F1 abierta con la aprobación del propietario; el
entregable es el **importador mínimo (F1a·0)**: fichero → Worker → normalización → tabla, con
progreso, cancelación y navegación hasta la fila de origen.

### Añadido

- Núcleo de ingesta puro, probable en Node y sin DOM: `src/domain/` (tiempo canónico, orden,
  lectura), `src/ingestion/` (delimitador, monotonía, importador) y `src/application/protocol.ts`.
- `workers/import.worker.ts`: **el único lugar donde se parsea**. La presentación no importa nada de
  `ingestion/`, así que el defecto del prototipo —parsear en el hilo principal «para comprobar» y
  volver a parsear en el Worker— no es posible por construcción, no por disciplina (WP-001/WP-002).
- Cancelación cooperativa con puntos de control cada 20.000 filas y descarte de mensajes caducados
  por `jobId` (WP-003/WP-004). `terminate()` queda como último recurso, no como mecanismo.
- Cuarentena con motivo y procedencia por fila, y `NO_ACCEPTED_ROWS` con desglose en lugar de una
  tabla vacía (WP-005).
- Fixtures sintéticos de importación con manifiesto y 28 pruebas: TC-019, TC-020, INV-002 y la
  corrección de ADR-0013.

### Corregido

Tres defectos que encontraron las pruebas **antes del primer commit**, escritas antes que el código
que debían verificar:

- **La marca de hora ambigua no se activaba nunca.** El método iterativo de conversión converge
  siempre al segundo instante en el cambio de octubre, así que una hora que ocurre dos veces se
  importaba como si fuera única. Se sustituye por el sondeo de los dos regímenes de desplazamiento
  que rodean cualquier transición, contando cuántos candidatos reproducen la hora pedida: dos
  (repetida), uno (normal) o ninguno (inexistente).
- **Un día imposible se confundía con un instante inexistente.** El 31 de abril sobrevivía a la
  validación y se desplazaba al 1 de mayo. La validez del calendario se comprueba ahora antes de
  tocar la zona horaria, que es donde corresponde.
- **`DATE_AMBIGUOUS` tapaba a `NO_ACCEPTED_ROWS`.** Un fichero cuya columna de fecha no contiene
  fechas pedía fijar el orden de unos campos inexistentes en vez de decir qué se rechazó y por qué.
  «No hay fechas» pasa a ser un motivo distinto de «las fechas no permiten decidir».
- **Una sola fila mal formada rechazaba el fichero entero.** El umbral de consistencia del separador
  se aplicaba como si midiera la calidad de la fuente. Ahora identifica al separador —viable si
  explica más de la mitad de la muestra con más de un campo— y las filas discordantes van a
  cuarentena, que es donde el contrato ya sabía tratarlas. Entre 0,5 y 0,9 se importa **con
  advertencia explícita**, y el empate entre dos candidatos sigue siendo `DELIMITER_AMBIGUOUS`,
  porque elegir uno sería adivinar.

### Limitación declarada

Todavía no existe vista previa con elección manual de separador ni de orden de campos, así que la
recuperación de esos errores dice lo que el usuario puede hacer hoy y no promete lo que la
aplicación hará después. Llega con F1a·1.

## [0.8.0] - 2026-09-16

Decisiones del propietario que desbloquean el arranque de la programación.

### Decidido

- **Zona horaria `Europe/Madrid`.** OQ-B02 queda parcial: falta comprobar cómo aparece el cambio
  estacional, para lo que hace falta una exportación que cruce octubre o marzo.
- **Sin marco de interfaz en F1a**: TypeScript y DOM directo. ADR-0009 pasa a `accepted` con un
  criterio explícito para retomar la decisión —cuando exista una pantalla que la justifique y con
  medidas de esa pantalla— en lugar de dejarla abierta indefinidamente.
- **Sin fichero `LICENSE`**: repositorio público con todos los derechos reservados. Cierra OQ-B07.
- **Primer entregable: importador mínimo** (F1a·0), más pequeño que F1a. Sin `.agvproj`, sin PWA,
  sin persistencia.

### Corregido

- **Las puertas estaban mal cortadas.** G0 exigía los límites de zona, las calles CO, los puntos
  críticos, las anclas de vuelta (OQ-B04) y el plan de aceptación completo de F1 a F5 (OQ-B05).
  Nada de eso interviene en importar un fichero de lecturas: son insumos del grafo y del
  diagnóstico. Bloqueaban el arranque sin usarse, y pasan a G2 y G1 respectivamente. No es una
  relajación: el propio G0 ya admitía preguntas «resueltas o convertidas en criterio explícito
  de F1».

## [0.7.0] - 2026-09-16

Cierre de OQ-115 con una precisión del propietario que añade una hipótesis que faltaba.

### Añadido

- **R-AGV-008**: si los vecinos de un objeto tampoco avanzaron durante su silencio, la causa es de
  la línea y no del objeto. Atribuirle un fallo individual sería un falso diagnóstico, así que la
  comprobación tiene **prioridad sobre cualquier hipótesis individual**. Es la diferencia entre un
  vehículo averiado y una línea parada, y la matriz anterior no la contemplaba.
- **R-FLO-006**: el vecindario se deriva del orden relativo y solo es firme donde el orden está
  garantizado. Fuerte en zona cargada, débil en zona vacía por la reordenación admitida, y no
  aplicable a una entrada en calle CO, que es una salida legítima del orden. Donde es débil, las
  firmas que dependen de él bajan de confianza en lugar de aplicarse igual.
- La matriz de reaparición de ALG-019 pasa a cuatro filas y añade el contraste con el tiempo
  esperado del tramo: un objeto que reaparece en posición muy por encima del esperado robusto indica
  detención individual anómala. El factor que hace significativo ese exceso es configuración con
  vigencia, no un umbral absoluto.
- TC-033 a TC-035, incluido el caso en zona vacía que debe rebajar la confianza en lugar de concluir
  igual que en zona cargada.

### Precisado

- La reaparición se busca **hacia delante en el tiempo**, no en el mismo instante.
- Estas detenciones duran varias veces la resolución de la fuente, así que su exceso de tiempo sí es
  medible pese a que la mayoría de las transiciones no lo sea (§4.1).

## [0.6.0] - 2026-09-16

### Añadido

- **Quinto discriminante de ALG-019: la forma de la reaparición.** Los cuatro anteriores miraban
  hacia atrás y hacia los lados; este mira hacia delante, y es el único capaz de elevar un silencio
  de `unknown` a una inferencia con soporte.
- **R-CO-006, firma de carga online**: última lectura en el tag de parada de una calle configurada
  más reanudación que recorre en orden su secuencia declarada. Se comprueba contra DS-004, no
  contra una expectativa del algoritmo. Sin calles configuradas la firma no se reconoce y el
  silencio queda `unknown`; no se sustituye por proximidad.
- **R-AGV-007, firma de hueco conservado**: reaparecer entre los mismos vecinos sin intercambio de
  AGV demuestra permanencia en el circuito y descarta salida o retirada, pero no distingue por sí
  solo detención de circulación sin lectura. Eso lo decide dónde reaparece frente a cuánto
  avanzaron sus vecinos.
- El umbral que hace significativo un silencio es configuración con vigencia y **relativo al ciclo
  local del tramo**, nunca minutos absolutos en el código.
- TC-030 a TC-032, incluido el caso que prohíbe inferir carga online por proximidad cuando falta la
  configuración de calles.
- OQ-115: si «reaparecer en su hueco» se observa con el grupo avanzando o alcanzándole, que decide
  cuál de las dos hipótesis de R-AGV-007 va primero.

## [0.5.0] - 2026-09-16

### Añadido

- FR-033 a FR-035: expediente por AGV y por tag desde su identificador, y detección de periodos de
  inactividad e instante de cambio. Versión reducida en F2, completa en F3.
- ALG-018 expediente por objeto y ALG-019 inactividad e instante de cambio, con los cuatro
  discriminantes de un silencio: cobertura, contexto colectivo, punto de la última lectura y
  calendario.
- `UX_SPEC.md` §4.1: estructura del expediente, simétrica para AGV y tag, donde cada bloque dice
  también qué no se sabe.
- Glosario: `periodo de inactividad`, `instante de cambio` y `expediente de objeto`.
- Clase `técnico` en el catálogo de tags especiales (DS-006).
- TC-026 a TC-029.

### Decidido

- **R-AGV-006**: un AGV detenido no emite lecturas. La inactividad y el fallo de comunicación
  producen el mismo silencio y no se distinguen por la ausencia en sí. Es un límite del dato, no
  del algoritmo, y la interfaz debe declararlo en lugar de elegir una causa.
- **R-OPP-008**: «tags que un AGV no ha leído» nunca se calcula restando el catálogo del circuito a
  lo leído. Solo cuentan las oportunidades elegibles; una rama que ese AGV no recorre no es una
  ausencia.
- El instante de cambio es `inferred`: marca el último momento con evidencia, no el instante real
  en que el objeto dejó de funcionar.

## [0.4.0] - 2026-09-16

### Añadido

- `docs/golden/` con los seis casos de oro desarrollados que **no dependen de información de
  planta**, y que son los criterios de aceptación de F1a: TC-015 solape entre exportaciones,
  TC-019 delimitadores e identidad, TC-020 carrera entre Worker e interfaz, TC-021 solape que
  contiene una maniobra, TC-022 intervalo fuera de la cobertura y TC-023 entrega diferida.
  Cada uno con propósito, reglas cubiertas, fixture sintético, resultado esperado, resultados
  expresamente prohibidos, tolerancias, evidencia navegable y criterio de estabilidad, según
  `TEST_STRATEGY.md` §5.
- Enlaces desde el catálogo de casos y ruta de lectura en el índice de contexto.

Las pruebas se escriben antes que el motor que deben superar. Los casos restantes se desarrollarán
cuando se cierren las preguntas abiertas de las que dependen.

## [0.3.0] - 2026-09-11

Contraste de la línea base contra la fuente real. El propietario aportó una muestra de lecturas y
el informe ampliado de Vsystem; ambos se leyeron solo en local y al repositorio vuelve la forma,
nunca los valores.

### Corregido

- **ADR-0013 fijaba un orden canónico incorrecto.** Definía el desempate como `source_row`
  ascendente, pero la fuente entrega los eventos como una pila, del más reciente al más antiguo.
  Con una resolución más gruesa que el paso real de un AGV, esa regla reconstruía los tramos al
  revés: contrastadas las dos hipótesis sobre la muestra real, la incorrecta producía 1.173 aristas
  con dominancia 0,691 frente a 299 aristas con 0,916. El grafo habría salido plausible y falso sin
  ningún síntoma. La ADR se corrige en el sitio porque vivía en una propuesta sin fusionar y nunca
  llegó a estar en vigor; el sentido pasa a medirse en cada fichero en lugar de suponerse.
- **La deduplicación por huella de fila destruía evidencia.** De 116 filas idénticas de la muestra,
  114 tenían otra lectura del mismo AGV entre medias: son pasos repetidos reales, el retroceso que
  contempla R-CO-005. Se sustituye por unión del tramo contiguo común entre cortes de la misma pila,
  que elimina el solape de forma exacta y conserva las maniobras.

### Añadido

- Regla de cobertura: fuera de los intervalos cargados el estado es `sin datos cargados`, que no es
  una parada ni un silencio (R-DAT-007, INV-013).
- El orden de una fuente se mide; las inversiones son evidencia de entrega diferida y se conservan
  señaladas (R-DAT-008).
- El análisis es muestral y dos muestras solo se comparan con contexto de calendario equivalente
  (R-TIM-007).
- El multicircuito condiciona la oportunidad de lectura y puede alterar las condiciones físicas de
  detección; sin él, la salud declara el confusor (R-OPP-007, TC-024, TC-025).
- DS-011, informe ampliado con segundos, circuito declarado, multicircuito y eventos de uso; y el
  contrato de los eventos que no son lecturas.
- Atributos canónicos opcionales `circuit_declared`, `mtc` y `resolution`, y el ajuste del análisis
  temporal a la resolución declarada de cada fuente.
- TC-021 a TC-025 e INV-013/INV-014.
- Glosario: `cobertura`, `sin datos cargados`, `muestra` y `multicircuito (MTC)`, separando este
  último de «varios circuitos», que es el alcance de F7 y se renombra para no colisionar.

## [0.2.0] - 2026-09-03

Auditoría de la línea base 0.1.0 y del prototipo `RBeno/tag-trace-agv`, cierre de las
contradicciones encontradas y conversión del gobierno en automatización bloqueante.

### Añadido

- `docs/WORKER_PROTOCOL.md`: contrato entre interfaz y Workers, con la regla de una sola pasada de
  parseo dentro del Worker y la prohibición de cualquier cálculo de repuesto en el hilo principal.
- `docs/CONFIG_SCHEMA.md`: contrato de configuración de circuito con vigencia, donde viven los
  umbrales que de otro modo acabarían como constantes en el código.
- ADR-0012: contenedor `.agvproj` como zip con manifiesto, secciones y hash por sección.
- ADR-0013: tiempo canónico, orden total `(t_utc, source_hash, source_row)` y canonicalización
  numérica del hash semántico.
- ADR-0014: repositorio público limitado a código, documentación y fixtures sintéticos, y vía de
  publicación con el límite real de CSP en GitHub Pages.
- `CLAUDE.md`, `schemas/project-state.schema.json`, `scripts/check_docs.py`,
  `scripts/check_data.sh`, hook de pre-commit y los workflows de calidad documental y guardián de
  datos, incluida la verificación del historial completo.
- `.github/CODEOWNERS`, plantillas de incidencia y `.editorconfig`.
- Política de borrado y retención local, y política de bifurcación de linaje entre dispositivos.
- Términos `cohorte`, `takt`, `soporte`, `oportunidad elegible` y `pastor` en el glosario.
- RSK-021: dato real en repositorio público.
- `docs/templates/G0_INTAKE.md`: admisión estructurada de las cinco preguntas bloqueantes de G0,
  para rellenar en `local/` y devolver al repositorio solo la forma de cada respuesta. El guardián
  rechaza una copia rellenada fuera de la plantilla, porque es markdown y la extensión no la
  delata.

### Corregido

- Fases incoherentes de FR-027, FR-029 y FR-030 respecto a las puertas G1 y G2.
- La definición de duplicado contradecía el caso de solape entre fuentes: ahora hay huella canónica
  de evento y se distingue repetición dentro de una fuente de solape entre fuentes.
- Faltaba el desempate determinista del que dependen INV-001 e INV-010.
- El hash semántico no tenía regla para la coma flotante.
- `SECURITY_PRIVACY.md` exigía cabeceras HTTP que GitHub Pages no permite fijar.
- Accesibilidad sin objetivo medible: se fija WCAG 2.2 AA y objetivo táctil de 24×24 px CSS.
- Riesgo de falsa precisión en el replay: la posición sobre un tramo es fracción temporal, no
  distancia física.
- Plantillas y checkpoint sin frontmatter, incumpliendo `VERSIONING.md`.
- `TT-MEMORY-001` pasa a `TT-PMEM-001` para no colisionar con la memoria del circuito.
- El índice del `README.md` omitía siete documentos normativos.

### Estado

- Documentación: `baseline-candidate` 0.2.0.
- Programación: no iniciada.
- Siguiente transición permitida: aprobación explícita `CONTINÚA FASE 1`.

## [0.1.0] - 2026-09-03

### Añadido

- Base documental profesional de Fase 0.
- Carta del proyecto, requisitos, modelo de dominio y contratos de datos.
- Catálogos versionados de reglas y algoritmos.
- Arquitectura local-first, estrategia de memoria compacta y consolidación supervisada.
- Modelo de expedientes de incidencia, replay y contramedidas.
- Especificación de experiencia de usuario, seguridad, privacidad y rendimiento.
- Roadmap F0–F8, puertas de fase, definición de terminado y matriz de trazabilidad.
- Gobierno del desarrollo realizado por IA, plantillas y registro de decisiones.
- Registro de riesgos, preguntas abiertas y checkpoint candidato de Fase 0.

### Estado

- Documentación: `baseline-candidate` 0.1.0.
- Programación: no iniciada.
