# Registro de cambios

Todos los cambios relevantes del proyecto se documentan aquí. El formato sigue *Keep a Changelog* y las versiones de producto seguirán versionado semántico cuando exista software ejecutable.

## [3.20.0] - 2026-09-24

Tableta y portátil, con dedo, ratón o panel táctil (`UX_SPEC.md` §7). Antes, casi todos los gráficos
solo se podían leer con ratón.

### Corregido

- **Con el dedo, la lectura de un gráfico se borraba en el mismo instante en que aparecía.** Los
  gráficos leían con `pointermove` y limpiaban con `pointerleave`, y al levantar el dedo el navegador
  dispara `pointerleave`. Ahora un toque fija la lectura y se queda; con ratón o panel táctil todo
  sigue como antes. Un único `inspect()` (`src/presentation/pointer.ts`) sustituye los 12 pares de
  manejadores.
- **Las marcas finas no se podían tocar.** Un segmento del anillo mide unos 8 px en una tableta, y una
  línea de FIFO, 2 px. Si el toque no cae encima, se lee la marca más cercana dentro de 22 px.
- **Cobertura y perfil horario solo tenían tooltip nativo**, que en táctil no aparece nunca. Ganan la
  misma línea de lectura que el resto.

### Cambiado

- La lectura de cada gráfico queda pegada abajo mientras el gráfico está a la vista.
- Con dedo (`any-pointer: coarse`), botones, campos, desplegables y controles de 44 px, y el cuerpo de
  texto a 16 px.
- Contenido hasta 1.440 px de ancho (antes, 1.100), con el texto corrido limitado a unos 90 caracteres.
- «Pasa el puntero por…» pasa a «Toca o pasa el puntero por…».
- TC-161–162: `tests/unit/pointer.test.ts` y `tests/e2e/tactil.spec.ts`, una tableta emulada con
  pantalla táctil que además recorre cinco anchuras de tableta y portátil.

## [3.19.0] - 2026-09-23

Revisión en campo de los hallazgos, para las pruebas en planta: ir al punto conflictivo, marcar lo
que se vio, dejar el resto para otro día y seguir donde se dejó (R-EVI-007, `UX_SPEC.md` §4.3). Solo
la revisión: la consolidación es F4 y espera a `CONTINÚA FASE 4`.

### Añadido

- Cada tarjeta de hallazgo lleva **○ Pendiente · ✓ Confirmado · ✕ Descartado · » Pospuesto** y una
  nota opcional. Se guarda sola en cada pulsación y sobrevive a recargar y a volver a importar: la
  marca va con el tipo y el sujeto del hallazgo, no con su texto.
- Una barra fija con el progreso y **Siguiente pendiente**; debajo, el recuento por estado, filtros y
  **Exportar revisión (CSV)**, con los pendientes incluidos.
- Si la cifra de un hallazgo cambió desde que se marcó, la tarjeta lo avisa. Las marcas de hallazgos
  que ya no aparecen no se borran: se cuentan aparte y van en el CSV.
- `src/domain/review.ts`, `src/presentation/review-ui.ts`; almacén en versión 5 con una tabla
  `reviews` propia, separada del circuito para que una importación nunca pise una marca; sección
  opcional `revision` en el `.agvproj`. TC-159–160.
- Decisión del propietario para F4: al consolidar solo bloquea lo pendiente; lo pospuesto pasa al
  periodo siguiente (`MEMORY_CONSOLIDATION.md` §6).

### Corregido antes de publicarse, al mirar el render

- En el móvil, el panel de revisión fijo tapaba casi media pantalla. Solo queda fija una barra
  compacta con el progreso y «Siguiente pendiente»; filtros y exportación van debajo.
- El icono de «Pospuesto» (⏸) apenas se leía en el móvil; pasa a «»».

## [3.18.3] - 2026-09-23

### Corregido

- **El expediente de un AGV contaba como inactividad el hueco entre dos exportaciones** (anotado como
  «Conocido» en `[3.17.0]`). `buildAgvDossier` y `buildAllAgvDossiers` reciben ahora los tramos de
  cobertura en lugar de solo su final. Un hueco entre dos lecturas que cruza un tramo sin datos ya no
  es un silencio, porque lo que pasó dentro no se sabe (R-DAT-007). Sus bordes tampoco se listan,
  igual que el rato antes de la primera lectura (R-GRA-010); la vista de flota los enseña con su
  umbral. Importa desde ya: con varias extracciones cargadas, cada AGV tenía un silencio falso en
  cada hueco. TC-158.

## [3.18.2] - 2026-09-23

Solo documentación. Corrige dos afirmaciones de `[3.18.1]` con los hechos de planta que aportó el
propietario.

### Corregido

- **R-GRA-012 decía que cada tag es un espacio que ocupa un AGV.** No es así: el tag es el último que
  leyó el AGV, y el AGV ocupa el espacio hasta el siguiente tag. En ese espacio caben uno o varios
  según su longitud física, que es dato de planta. R-GRA-013 compara ahora la ocupación con esa
  capacidad, en vez de exigir un AGV por tag.
- **El tramo compartido no sale de cruzar las listas `circuito`.** Solo se comparten los tags de
  cruces y semáforos; en un tramo físico común cada circuito mantiene sus propios tags, así que el
  tramo hay que declararlo (`CONFIG_SCHEMA.md` §3.4.1, `ROADMAP.md` F7).
- OQ-128 pasa a parcial: el número de un tag es único en toda la planta (Vsystem no permite
  repetirlo). Sigue abierto de dónde sale la capacidad de cada espacio.
- Glosario: «Espacio (de un tag)», y «Zona compartida» reescrita.

## [3.18.1] - 2026-09-23

Solo documentación: se deja preparada, sin construirla, la posibilidad de analizar circuitos que
comparten un cruce o un tramo (F7), para que cuando llegue no choque con lo que ya existe.

### Añadido

- **R-DAT-018**: los circuitos del mismo servidor de Vsystem comparten reloj, porque es el servidor
  el que gestiona los cruces.
- **R-GRA-012**: un tag no es exclusivo de un circuito; en Vsystem es un espacio que ocupan AGV de
  cualquier circuito.
- **R-GRA-013** (`candidate`, F7): en una zona compartida se comprueba la ocupación de los espacios,
  en la intersección de coberturas, con cada circuito todavía aislado. Los tags compartidos salen de
  la intersección de las listas `circuito`, sin configuración nueva.
- `ROADMAP.md` F7 enumera lo que hoy supone tags exclusivos y habrá que adaptar: la afinidad de una
  fuente (`affinity.ts`), el agrupamiento por aristas exclusivas (`cohort.ts`) y el «leyendo sin
  asignar» de la flota.
- OQ-127 (si la exportación de un circuito trae las lecturas de AGV ajenos en los tags compartidos) y
  OQ-128 (capacidad de un espacio y unicidad del identificador de tag en la planta).

## [3.18.0] - 2026-09-23

La flota del circuito a lo largo del tiempo, y los vehículos que no entran a cargar (Parte 39). Hasta
ahora un AGV asignado que no leía nada era invisible: la banda de actividad solo enseña a los que
aparecen en las lecturas. Con un historial de flota cargado, la aplicación cuenta cuántos de los
asignados están en funcionamiento en cada momento («38 de 40 de 12:05 a 13:10») y enseña la vida
entera de cada uno en tramos continuos.

### Añadido

- **DS-012, historial de flota** (`src/ingestion/fleet-history.ts`): `circuito;agv;desde;hasta;nota`,
  una fila por AGV y periodo `[desde, hasta)`, fechas día/mes con hora opcional, columnas por nombre y
  rechazo por fila con su motivo. **Se fusiona** con lo guardado por (AGV, `desde`) en lugar de
  sustituirse como las listas: un alta o una baja se registran subiendo solo su fila. Si el fichero
  trae varios circuitos, la interfaz pregunta cuál es este y recuerda la respuesta.
- `src/domain/fleet.ts`: `buildFleetTimeline` da, por AGV asignado alguna vez o visto en las
  lecturas, sus tramos continuos en siete estados —leyendo, carga, falta de lecturas, ausente, fuera
  del circuito, leyendo sin asignar y sin datos— y el recuento escalonado «N de M». Reutiliza las
  inactividades y su causa del expediente y los arranques en frío de las calles; no recalcula nada.
  Todo se recorta a la cobertura, así que un hueco entre exportaciones es sin datos, nunca silencio.
- **R-AGV-014** (en funcionamiento = lee o está en carga inferida; M = flota asignada según el
  historial; sin historial, los vistos, dicho en la vista) y **R-AGV-015** (leer sin estar asignado
  es candidato, nunca avería, y no suma a N).
- Vistas «Flota en funcionamiento» (serie escalonada con el peor momento de la ventana) y «Vida de
  cada AGV en el circuito» (un único `canvas`, una fila por AGV; la ausencia en naranja sólido), con
  su tabla equivalente y los dos hallazgos de entrada: asignados que no leyeron nada y vehículos que
  leen sin estar asignados (`UX_SPEC.md` §5.4).
- **Vehículos que no entraron en ninguna calle** (`ChargingReport.neverCharged`): tarjeta en la
  sección de carga con su primera y última lectura. Lo que no significa va escrito al lado: calle no
  declarada, poco tiempo en la ventana, y sin SOC no se juzga la batería (R-CO-004).
- Almacén en versión 4 (`StoredCircuit.fleet`, peldaño vacío en `MIGRATIONS`); mensajes `fleet`,
  `fleet-loaded` y `fleet-choose-circuit` (`WORKER_PROTOCOL.md`, que además recoge ahora `lists` y
  `lists-loaded`, que ya existían sin documentar).
- TC-148–157; el escenario de auditoría genera `fleetCsv` con dos circuitos, un asignado que no lee
  nunca y otro dado de baja a mitad de ventana que sigue leyendo. No cambia ninguna lectura, así que
  el informe de la auditoría no se mueve.

### Corregido antes de publicarse

- **Importar otra fuente borraba el historial de flota.** `accumulate()` reescribía el circuito
  guardado sin el campo nuevo. Lo encontró la prueba de navegador: el historial se cargaba, se
  importaba la segunda exportación y los hallazgos de flota salían como si no hubiera historial.
  Ahora se conserva, igual que las listas.
- **El peor momento de la ventana era siempre su borde.** Antes de su primera lectura, cada AGV
  contaba como ausente aunque fueran unos segundos, así que el mínimo «N de M» caía en el primer
  instante de la cobertura. Ahora los bordes se juzgan con el mismo umbral de silencio que decide si
  un hueco entre dos lecturas es inactividad: más corto, es el ritmo normal de lectura. Y cada tramo
  de cobertura se trata por separado, así que un silencio que cruza un hueco entre exportaciones ya
  no deja trozos de silencio a sus lados. Lo encontró la mirada al render, no una prueba.

### Conocido, sin corregir aquí

- Un periodo del historial no se puede borrar subiendo filas; solo sustituir o cerrar.
- Sigue pendiente el defecto de dominio del expediente anotado en `[3.17.0]` (inactividad a través de
  un hueco de cobertura). La vista de flota lo evita por su cuenta recortando a la cobertura.

## [3.17.0] - 2026-09-23

Diez vistas de diagnóstico en la aplicación (Parte 38), las propuestas 2 a 11 de la galería que el
propietario eligió. Nada cambia en el cálculo: los hallazgos que hasta ahora se leían en tarjetas y
tablas se ven. Cada vista va encima de las tarjetas de su sección, que se quedan como vía accesible,
y lleva su tabla equivalente (`UX_SPEC.md` §5.3).

### Añadido

- `src/presentation/diagnostic-charts.ts`: anillo radial, mapa de omisión tag × AGV (un único
  `canvas`), pequeños múltiplos de rotura y degradación, histograma de permanencias, horquilla de
  cruce o bifurcación, carriles de ocupación por calle, entrada frente a salida del tramo cargado,
  deriva entre dos periodos y expediente de un AGV en el tiempo. Dibujados al ancho real del
  contenedor y con una sola lectura al puntero por gráfico, nunca un `<title>` por marca.
- `inventoryChart` rehecho en su sitio: franja al 100 % (nada que valorar / a valorar / fuera de
  toda tasa) y cada clase con su acción en la misma línea. Mismo título y misma tabla.
- Datos compactos nuevos en `CircuitViews`, todos proyecciones de lo ya calculado:
  `binTimeline` y `trendSeries` (solo en filas con tendencia), `SpanReport.focus` (tope
  `FIFO_FOCUS_MAX`), `stayList` por calle, `durationsMs` en los candidatos de tiempo con una muestra
  de referencia por cohorte, y `zones` y `laneJunctions` (`findLaneJunctions`) en la forma del anillo.
- Tokens `--viz-accent` (validado frente a `--viz-series` para daltonismo en los dos modos),
  `--viz-accent-wash` y `--viz-neutral`.
- TC-141–147; `tests/e2e/vistas-diagnostico.spec.ts` carga el circuito de auditoría en dos
  exportaciones con un hueco entre medias, para que también aparezca la deriva.

### Corregido antes de publicarse, al mirar el render

- **Una estancia sin salida vista se dibujaba como barra hasta el final de la ventana**, afirmando
  horas de carga que nadie observó. Ahora solo es barra lo que se sabe: una estancia completa, o un
  arranque en frío (R-CO-007). Si falta un extremo por otra razón, es una marca en el extremo conocido.
- **El anillo repetía la tabla del anillo**, y la prueba existente que la busca encontraba la copia
  vacía. El anillo no lleva tabla propia: la suya es la lista ordenada de debajo, que gana la columna
  de zona.
- **El inventario pintaba «a valorar» en naranja**, contra la regla de §5.2: ninguna clase lleva color
  de severidad. Va en el azul de serie.

### Conocido, sin corregir aquí

- **El expediente de un AGV cuenta como inactividad un hueco de cobertura** entre dos exportaciones
  (`buildAllAgvDossiers` no recibe la cobertura). Es contrario a R-DAT-007. La vista nueva lo recorta
  y dibuja solo la parte cubierta, pero la tabla del expediente sigue listándolo. La corrección es de
  dominio y queda para un cambio propio.

## [3.16.0] - 2026-09-23

Dos clases nuevas de tag crítico (R-GRA-007) — **vinculación** y **desvinculación**: sincronizar la
velocidad del AGV con la línea de producción, o dejar de hacerlo. Declaración pura, sin firma
estadística, el mismo caso que `cambio-de-mapa`. Y una segunda vía para declarar la función de
cualquier tag crítico: la columna `funcion` del propio circuito virtual (`circuito`), que convive con
la lista `critico` de siempre — quien ya carga ese fichero con esa columna no necesita mantener dos.

### Añadido

- `src/domain/tag-lists.ts` — `LIST_FUNCTIONS.critico` gana `vinculacion` y `desvinculacion`, nueve
  clases en vez de siete. `EXPECTED_STRUCTURE.example` enseña la vía nueva junto a la ya existente.
- **Las dos vías conviven sin tocar `readCriticalPoints()`**: ya recibía entradas genéricas, sin
  ninguna referencia a qué lista las trae. El cambio es de wiring, no de arquitectura — en los puntos
  de llamada (`workers/import.worker.ts`, `tests/audit/auditoria.test.ts`), la función crítica se lee
  de `[...entriesOf("critico"), ...entriesOf("circuito").filter(e => e.funcion !== "")]`, con
  `critico` primero para que gane en caso de contradicción (reutilizando la guardia de contradicción
  ya existente, R-EVI-004).
- `src/domain/dossier.ts` — `TagDossier` gana `criticalFunction: string | null`.
  `buildTagDossier`/`buildAllTagDossiers` ganan un parámetro `funcionOf` sin valor por defecto
  (`AI_DEVELOPMENT_GOVERNANCE.md` §4). Cierra un hueco encontrado al diseñar: la función crítica ya
  se calculaba (R-GRA-008, Parte 31) pero no llegaba a ninguna parte de la interfaz.
- Expediente de tag (`renderDossier`, `src/presentation/main.ts`): si el tag tiene función crítica
  declarada, se muestra citando R-GRA-007, con la vía de corrección —editar y recargar el fichero que
  la declaró, nunca un botón en la interfaz (R-EVI-006)— en el mismo texto.
- Dos clases nuevas en el circuito de auditoría (`auditoria/10`): `vinculacion-declarada` (declarada
  por la columna del circuito virtual) y `desvinculacion-declarada` (por la lista `critico`), para
  ejercitar las dos fuentes a la vez.

### Documentación

`docs/CONFIG_SCHEMA.md` §3.4.1 (nueve clases; las dos vías de declaración; corregido de paso el
estado de implementación, desactualizado desde la Parte 35) y §3.4.3 (fila nueva en la tabla de
formato); `docs/RULE_CATALOG.md` (R-GRA-007 ampliada); `docs/GLOSSARY.md` (nueve clases; entrada
nueva para vinculación/desvinculación; corregida la entrada de bifurcación candidata, que decía
«única clase construida» siendo ya falso desde la Parte 35); `docs/TEST_STRATEGY.md` (TC-137–140);
`docs/TRACEABILITY_MATRIX.md` (fila de R-GRA-007 ampliada); `fixtures/synthetic/auditoria/MANIFEST.md`
(`auditoria/10`).

### Lo que esta entrega no hace

No construye ningún detector estadístico para vinculación/desvinculación. No implementa el censo de
tags de mantenimiento ni el listado de intervenciones propuesto en la misma conversación —el
propietario pidió tratarlo aparte, con un requisito de actualización incremental sobre un circuito
que se trata como «vivo»—, que queda pendiente de su propio plan.

## [3.15.0] - 2026-09-22

Parada precisa, semáforo y cruce por reconvergencia (R-GRA-007), completando las cuatro de las siete
clases de punto crítico con firma alcanzable hoy (bifurcación ya estaba desde `[3.11.0]`). El
propietario fijó qué significa «cruce» en este proyecto, entre dos fenómenos que compartían nombre:
una bifurcación cuyas ramas **reconvergen en pocos saltos dentro del mismo cohorte** (esta entrega),
distinta del cruce **entre circuitos** protegido por un par de tags (R-AGV-009/011, sigue bloqueado
por OQ-121, sin tocar).

### Añadido

- **`src/domain/critical-points.ts`** — `CriticalPointCandidate` pasa de una forma plana a una unión
  discriminada por `kind` (`bifurcacion` | `cruce` | `parada-precisa` | `semaforo`), cada variante con
  solo los campos que le corresponden. `findBifurcationCandidates` no cambia de lógica, solo de forma
  de salida. Tres piezas nuevas:
  - `classifyCrossings()` — reclasifica un candidato a bifurcación a `cruce` cuando el sucesor
    dominante de dos de sus ramas visita el mismo tag dentro de `maxHopsToReconverge` saltos. Con 2
    ramas es el caso único que se resuelve; con 3 o más basta que un par reconverja.
  - `findPrecisePauseCandidates()` — duración media alta y coeficiente de variación bajo, sobre las
    transiciones agrupadas por tag y **excluyendo `sameInstant`** (R-DAT-013: un empate del mismo
    instante no mide ninguna duración).
  - `findTrafficLightCandidates()` — mayor salto proporcional entre dos duraciones consecutivas que
    deje grupos compactos por separado a los dos lados (guarda dual, mismo principio que `fifo.ts` y
    `read-rate-trend.ts`): un hueco sin compacidad a los lados es ruido con un pico, no dos regímenes.
- `CriticalPointThresholds` gana `cruce` (`maxHopsToReconverge`), `paradaPrecisa` (`minDurationMs`,
  `maxCv`, `minSamples`) y `semaforo` (`minGapRatio`, `maxWithinClusterCv`, `minClusterSamples`,
  `minSamples`), todos `draft` y sin valor por defecto.
- Wiring completo: `import.worker.ts` compone las cuatro funciones sobre las transiciones del
  cohorte; `protocol.ts` transporta `kind` y los campos propios de cada variante; `main.ts` renderiza
  las cuatro clases con su propia redacción, citando R-GRA-007 en todas.
- Cuatro clases nuevas en el circuito de auditoría (`auditoria/9`): `bifurcacion-real` (reubicada,
  ver más abajo), `cruce-real`, `parada-precisa-real`, `semaforo-real`, cada una con su sonda en
  `tests/audit/auditoria.test.ts` y su lote de pruebas unitarias en `tests/unit/critical-points.test.ts`.

### Corregido — el escenario ya tenía un cruce y no lo sabía

El único candidato a bifurcación que existía en el circuito de auditoría desde la Parte 31
(`ring[120]`/`96001`) **ya reconvergía**: el código nunca tocaba `position` al desviar, así que el
siguiente tag leído era siempre el mismo, tomara o no el desvío. Con la definición de cruce que
acaba de fijarse, eso **es** un cruce, no una bifurcación sin resolver. No se tocó el resultado
esperado de ninguna prueba para que pasara: se relabró el mecanismo (`bifurcacion-real` →
`cruce-real`) y se plantó una bifurcación genuina y nueva (`ring[30]`, cadena de seis tags fuera de
anillo sin reconvergencia posible dentro del margen) para no perder cobertura de esa clase.

### Corregido — una cuarta variante de la fragilidad de RNG compartido, y su resolución

Añadir espera fija a tres posiciones del generador (parada precisa, semáforo, la cadena de
bifurcación) sin devolver ese tiempo habría cambiado cuántas vueltas completa cada vehículo en las
mismas 30 h, desplazando cuántas llamadas a `random()` consume antes de ceder el turno al siguiente
vehículo — la misma fragilidad de cascada de las Partes 30, 31 y 33, esta vez por reloj de más y no
por sorteos de más. Resuelto con un acumulador de deuda por vehículo: cada espera añadida se anota
como deuda, y el avance normal del paso la descuenta (hasta el 50 % del avance nominal, nunca el
100 %, para no fabricar un empate de instante que R-DAT-013 prohíbe tratar como orden) hasta
devolverla del todo. Con las tres posiciones bien espaciadas entre sí (30, 70 y 105 de 150), la
deuda siempre llega a cero mucho antes de la siguiente.

Un segundo defecto, más sutil, apareció al auditar el propio mecanismo: el vehículo del defecto
`lector-agv-degradado` (Parte 28, lectura cada vez menos fiable en cualquier tag) podía fallar
precisamente la lectura de parada precisa o semáforo, o la del tag siguiente. Como la espera
inyectada no dependía de si la lectura se registró, un fallo ahí fusionaba el tránsito de dos o más
tramos en una única transición de duración intermedia — un candidato a semáforo espurio en un tag
limpio adyacente, y una fragmentación del propio salto bimodal que impedía detectar el semáforo real.
Corregido excluyendo los dos puntos críticos de tiempo **y su siguiente inmediato** del efecto de ese
vehículo — el sorteo se sigue haciendo siempre, en el mismo orden, solo se descarta el resultado en
esas cuatro posiciones, para no repetir la fragilidad de cascada por otra vía—. Esa exclusión, al
diluir ligeramente la caída medida en el vehículo degradado, dejó su propia tendencia justo por
debajo del umbral de degradación; se ajustó la magnitud sintética de su curva de fallo (0,7 → 0,74,
un número del generador, nunca de planta) para devolver margen sin acercarse al riesgo opuesto —un
suelo de lectura tan bajo que algún tag aislado, con pocas pasadas en la mitad tardía, acumulara cero
lecturas de ese vehículo por puro azar, lo que `drift.ts` habría contado como una deriva de memoria
que nadie plantó—.

### Documentación

`docs/RULE_CATALOG.md` (R-GRA-007: «cruce» distingue explícitamente el interno del protegido entre
circuitos; nota de estado de implementación), `docs/ALGORITHM_CATALOG.md` (§8.2 ampliada con los tres
métodos nuevos), `docs/TEST_STRATEGY.md` (TC-125–136, y la nota sobre el cambio de mecanismo de
`bifurcacion-real`), `docs/TRACEABILITY_MATRIX.md` (fila de R-GRA-007 ampliada),
`docs/OPEN_QUESTIONS.md` (OQ-122: cuatro de siete clases resueltas, no las siete),
`fixtures/synthetic/auditoria/MANIFEST.md` (`auditoria/9`).

## [3.14.0] - 2026-09-22

Refinamiento directo de la comparación entre dos periodos distantes de `[3.13.0]`, pedido por el
propietario: correlacionar un tag que desaparece con uno que aparece en su mismo hueco de secuencia
(sustitución candidata, R-DAT-017 nueva), y señalar por vehículo un tag nuevo ya adoptado por la
flota que ese vehículo concreto nunca ha registrado (R-AGV-013 ampliada).

### Añadido

- **`src/domain/drift.ts`** — sustitución candidata: la firma de vecino se mide directamente sobre la
  secuencia cronológica de lecturas de cada vehículo, nunca sobre el anillo reconstruido (el módulo
  sigue sin depender de `laps.ts`/`cohort.ts`). Un tag `desaparecido` y uno `nuevo` se correlacionan
  solo si comparten vecino dominante en el mismo lado —mismo predecesor o mismo sucesor— **y** la
  correlación es unívoca en los dos sentidos: cada desaparecido con exactamente un candidato
  compatible, y viceversa. Con 0 o 2+ coincidencias en cualquiera de los dos lados, no se empareja:
  quedan como dos hallazgos sueltos en vez de una pareja forzada (R-EVI-004).
- **Adopción de tag nuevo** — `VehicleDrift` gana `notAdoptedTags`: un tag nuevo (o el lado nuevo de
  una sustitución candidata) ya leído por al menos `minAdoptionShare` de los testigos tardíos señala,
  en cada testigo tardío que no lo ha leído ni una vez, un candidato a memoria no actualizada. Sin
  necesidad de topología: un tag de una rama que solo recorre parte de la flota nunca alcanza la
  cuota entre todos los testigos, así que el mecanismo no dispara sobre quien simplemente no pasa por
  ahí, en vez de fabricar un falso positivo.
- `DriftThresholds.minAdoptionShare` en `config.ts`, `draft` y sin valor por defecto:
  deliberadamente el mismo número que `ReadRateThresholds.highRate` (0,8) — la misma idea de «lo lee
  casi todo el mundo», aplicada aquí a cuántos vehículos adoptan un tag en vez de a cuántas veces se
  lee.
- Vista: la fila «Tag → nuevo tag» en el detalle de deriva, y el bloque de vehículos combina
  `droppedTags` y `notAdoptedTags` en un solo hallazgo por vehículo.
- Dos clases nuevas en el circuito de auditoría (`auditoria/8`): `sustitucion-candidata` (un tag del
  anillo que deja de leerse justo cuando otro, fuera de anillo, ocupa su mismo hueco de secuencia) y
  `memoria-no-actualizada` (un vehículo, sin ningún otro papel, que nunca lee ese tag nuevo mientras
  el resto de la flota ya lo detecta).

### Riesgo real encontrado durante el diseño

Un vecino compartido entre la firma temprana de un desaparecido y la firma tardía de un nuevo no
puede a su vez ser otro tag que desaparece o aparece: para coincidir en los dos lados tiene que tener
lecturas en los dos periodos, lo que ya lo excluye de esas dos listas por construcción del propio
dato. La primera versión del diseño llevaba una comprobación explícita de estabilidad del vecino que,
razonada con cuidado, resultó ser inalcanzable — se retiró en vez de dejarla como validación de un
caso que no puede ocurrir.

## [3.13.0] - 2026-09-22

Comparación entre dos periodos distantes (R-DAT-016, R-AGV-013), la pieza «histórico» de ALG-009 y
la única ausencia de código que `docs/TRACEABILITY_MATRIX.md` seguía señalando explícitamente desde
la Parte 21. No es F4 —`docs/ROADMAP.md` la lista dentro de F3, «comparación individual, cohorte,
colectiva **e histórica**»—, así que no requería `CONTINÚA FASE 4`. R-DAT-016 ya escribía el
mecanismo exacto desde que se aceptó: «leído antes y no ahora es un cambio; no leído en ninguna
ventana es obsoleto consolidado». Faltaba construirlo.

No hace falta pedir un segundo fichero: `coverage` ya es la unión de los intervalos de todas las
fuentes aceptadas, así que dos exportaciones separadas en el tiempo ya producen, hoy mismo, dos o
más intervalos disjuntos — es justo lo que `tests/e2e/acumulacion.spec.ts` («dos ventanas disjuntas
dejan el hueco al descubierto») ya prueba desde antes.

### Añadido

- **`src/domain/drift.ts`** — `compareDistantPeriods()`: compara el primer y el último periodo de
  cobertura (nunca los intermedios), con un hueco mínimo (`minGapMs`) para no tratar como distantes
  dos fuentes casi contiguas. Cuatro hallazgos, los tres primeros puramente binarios —presencia o
  ausencia, sin ningún umbral de magnitud—: `desaparecido` (se leía y ya no, circuito completo),
  `nuevo` (sin lecturas antes, con lecturas ahora), `obsoleto-consolidado` (sin lecturas en los dos
  periodos, y solo si el tag está declarado en alguna lista — si no, no hay cómo saber que existe), y
  la deriva de un vehículo concreto (R-AGV-013 nueva) que deja de leer un conjunto que sí leía
  mientras el resto de la flota lo sigue leyendo con normalidad.
- `DriftThresholds` en `config.ts`, `draft` y sin valor por defecto en ninguna función.
  `minReadingsPerVehicle` reutiliza literalmente el valor ya elegido para `blindness` (mismo
  concepto); `minGapMs` es una magnitud del escenario sintético, declarada como tal.
- `CircuitViews.drift`, presente solo cuando hay listas de planta cargadas y al menos dos periodos
  distantes: sin eso, no hay nada que mostrar y no mostrar nada es más honesto que un aviso
  permanente.
- Vista: bloque «Comparación entre dos periodos» tras el inventario, con la redacción obligada a
  citar R-DAT-016 y a no elegir causa (R-EVI-006): el dato dice qué cambió, nunca por qué.
- Dos clases nuevas en el circuito de auditoría (`auditoria/7`): `tag-nuevo-a-mitad-de-ventana` (un
  tag fuera de anillo que solo empieza a leerse pasado el corte) y
  `memoria-actualizada-a-mitad-de-ventana` (un vehículo, sin ningún otro papel, que deja de leer un
  tramo de cinco tags contiguos pasado el corte, mientras el resto de la flota los sigue leyendo).

### Dos riesgos reales, encontrados auditando el propio detector

1. **Guarda de soporte.** Un tag con tasa de lectura probabilística (una `lectura-media` ya conocida
   por otro motivo) puede, por puro azar, no producir ninguna lectura de un vehículo concreto en el
   periodo tardío aunque ese vehículo lo hubiera leído antes: no es una deriva, es la misma
   variabilidad que ya explica esa tasa. Corregido exigiendo que el vehículo haya leído el tag, en el
   periodo temprano, al menos `minReadingsPerVehicle` veces antes de contar su ausencia como deriva —
   mismo umbral y misma razón que ya usa la ceguera de una sola ventana.
2. **El corte de la comparación coincidía casi, pero no del todo, con la rotura súbita ya plantada.**
   Con el corte a mitad exacta de la ventana y la rotura al 55 %, el periodo tardío arrancaba todavía
   dentro del tramo en que los tags rotos se seguían leyendo con normalidad, así que no salían
   `desaparecido` sino con lecturas en los dos periodos — y, como el tag no se daba por muerto
   circuito completo, la ausencia se atribuía de más a cada vehículo que lo había leído. Corregido
   haciendo coincidir el corte con el instante de la rotura, para que el margen de la comparación
   quede centrado exactamente ahí.

Un tercer efecto, ya conocido de las Partes 30 y 31: la inyección del tag nuevo consumía un
`random()` extra por vehículo en toda la mitad tardía de la ventana, desplazando el estado
compartido del generador para los vehículos procesados después y borrando la tendencia ya plantada
de `lector-agv-degradado`. Corregido quitando el jitter aleatorio de esa inyección — el paso sigue
siendo determinista y de igual duración, sin consumir ningún sorteo.

### El informe, con las diecinueve clases

```
239.129 lecturas, 40 vehículos. Anillo reconstruido: 147 tags de 150 declarados. Fuera del anillo: 16.
  DETECTA     declarado-sin-lecturas — clases: obsoleto-candidato, obsoleto-candidato, obsoleto-candidato
  DETECTA     lectura-alta — señalados sin motivo: 0/10
  DETECTA     lectura-media — 10/10
  DETECTA     omision-por-memoria — 2/2
  DETECTA     omision-conservando-convoy — tags acusados por su culpa: 0
  DETECTA     rotura-subita — con el instante dentro de margen: 2/2
  DETECTA     degradacion-progresiva — con tendencia sostenida: 2/2
  DETECTA     mantenimiento-aislado — fuera del anillo: 2/2
  DETECTA     carga-online-normal — 4/4 calles con mediana en torno a la media hora; 96 paradas leídas como carga y 0 como silencio
  DETECTA     calle-sin-servicio — 1 calle sin entradas; clases: calle-sin-servicio, calle-sin-servicio, calle-sin-servicio
  DETECTA     salida-fuera-de-antiguedad — el primero por espera es 7112 (se esperaba 7112), 300 min; 2 inversiones más, que son cargas simultáneas de duración distinta y no un hallazgo
  DETECTA     carga-anterior-a-la-ventana — 5/5 inferidos, 5 señalados en total
  DETECTA     zona-vacia-declarada — 2 zonas declaradas, calles dentro de la vacía: sí; tags sanos con veredicto movido: 0; pasadas retiradas de la vía de orden: 0
  DETECTA     lector-agv-degradado — 7120: bajando (90% → 78% → 62% → 51%); tags con tendencia o rotura por su culpa: 0
  DETECTA     adelantamiento-en-zona-cargada — el primero por margen es 7113 (se esperaba 7113), 4 min de margen; 2 más
  DETECTA     bifurcacion-real — 2 ramas: 60363 58%, 96001 42%
  DETECTA     ancla-declarada — ancla efectiva: 60000 (observed); 1656 vueltas completas, 1656 con truth observed
  DETECTA     tag-nuevo-a-mitad-de-ventana — nuevo, 713 lecturas en el periodo tardío
  DETECTA     memoria-actualizada-a-mitad-de-ventana — 5 tags dejados: 60420, 60423, 60426, 60429, 60432
```

**Diecinueve de diecinueve clases detectadas, cero falsos positivos, `DEUDA_CONOCIDA` vacía.**

### Gobierno

- `docs/RULE_CATALOG.md` (R-AGV-013 nueva); `docs/ALGORITHM_CATALOG.md` (§6.1 nueva, puntero desde
  ALG-009); `docs/TEST_STRATEGY.md` (TC-112–117); `docs/TRACEABILITY_MATRIX.md` (fila nueva, y se
  quita la comparación entre dos periodos distantes de la lista de lo que seguía sin implementar);
  `docs/PHASE_GATES.md` (G3, nota sobre el componente histórico de ALG-009, sin marcar el criterio
  completo); `docs/GLOSSARY.md` (Deriva); `docs/OPEN_QUESTIONS.md` (OQ-117: el mecanismo ya existe,
  sigue faltando una segunda exportación real de SE2/4); `fixtures/synthetic/auditoria/MANIFEST.md`
  (`auditoria/7`).

## [3.12.0] - 2026-09-22

Anclas de vuelta declaradas (R-GRA-009, `lap_anchors`), pedido explícitamente por el propietario
tras quedar ofrecido y sin pedir en `[3.6.0]` («anclas de vuelta declaradas»), tercero y último de
los tres «programables ya» — FIFO (`[3.10.0]`) y candidatos a punto crítico (`[3.11.0]`) ya están
fusionados. `src/domain/laps.ts` lo anunciaba desde que se escribió: «Cuando exista `lap_anchors`...
esto se sustituye por el ancla real». Ya existe.

Sin ancla declarada, la única disponible sigue siendo el ciclo dominante que el propio grafo revela,
y una vuelta cortada por ella sigue siendo siempre `inferred`. Con una declarada y presente en el
ciclo ya reconstruido, el mecanismo **rota** ese mismo ciclo —nunca recalcula qué tags lo forman— y
una vuelta `completa` cortada por ella pasa a `observed`. Una vuelta `parcial` no, declarada o no la
ancla: por definición uno de sus dos extremos es un corte de los datos, no el ancla, y declararla
`observed` ahí inventaría una certeza que el dato no sostiene.

### Añadido

- Lista `ancla` en `src/domain/tag-lists.ts` (`KNOWN_LISTS`, `LIST_PURPOSE`): el tag, o varios en
  orden de prioridad, que el propietario declara como corte de vuelta.
- `src/domain/circuit-config.ts` gana `readLapAnchors()`, calcado de `readZones`.
- **`src/domain/laps.ts`**: `resolveDeclaredAnchor()` prueba cada ancla declarada, en orden, contra
  el ciclo ya reconstruido y se queda con la primera que aparece, rotándolo sin alterar el orden
  relativo; `null` si ninguna aparece, sin inventar un corte que el dato no sostenga.
  `segmentLaps()`/`buildLap()` ganan un parámetro `anchorTruth: TruthState` sin valor por defecto: el
  `truth` final depende de completitud **y** origen del ancla, nunca de uno solo.
- `workers/import.worker.ts`: por cohorte, se resuelve el ancla declarada contra el ciclo inferido y
  se construye un ancla «efectiva» que sustituye a la inferida en todo lo que la usa —vueltas,
  composición del circuito, matriz de lectura, tramos de FIFO y contraste contra Vsystem—, sin
  duplicar el cálculo del ciclo dominante.
- `CircuitViews.shapes[].anchorTruth` (`"observed" | "inferred"`) y `CircuitViews.lapAnchorProblems`;
  la vista dice «ancla declarada» o «ancla inferida» según corresponda, en el resumen del circuito y
  en el expediente de AGV.
- Decimoséptima clase plantada en el circuito de auditoría, `ancla-declarada`: el primer tag del
  anillo declarado como ancla, contexto y no defecto — declararla no puede cambiar qué tags forman
  el anillo, solo desde dónde se cuentan las vueltas.

### Un riesgo real de invariancia, encontrado antes de auditar

`compareAgainstVsystem` alinea la lista declarada contra el anillo observado con subsecuencia común
más larga (LCS), que es lineal y sensible a **dónde se corta** un anillo que en realidad es cíclico.
Antes de esta entrega el corte ya era arbitrario —el punto donde `findDominantCycle` cierra el
ciclo—, pero ahora puede ser además el tag que el propietario declaró, en cualquier posición de la
lista Vsystem. Un corte que cae en mitad de un tramo idéntico lo partía en dos coincidencias más
cortas en vez de reconocerlo como una sola. Corregido rotando el anillo observado, **dentro** de
`compareAgainstVsystem`, hasta el primer tag de la lista declarada que aparece en él, antes de
calcular la LCS — así el contraste no depende de por dónde entró el ancla, se declare o se infiera.

### Un segundo riesgo, encontrado auditando: el ancla contamina una comparación que no la mira

La sonda `zona-vacia-declarada` compara dos ejecuciones del mismo escenario —con y sin las listas de
planta— para comprobar que **declarar la zona** no mueve el veredicto de ningún tag sano. Añadir la
lista `ancla` a esa comparación (apagada en la ejecución «sin configuración», como el resto) cambió
qué tag cierra cada vuelta entre las dos ejecuciones, y eso desplazó el patrón de dieciséis tags
sanos — no por la zona, sino por dónde `traceLaps` corta la segmentación en cada caso. La ancla
decide un mecanismo distinto (R-GRA-009) del que esa sonda existe para vigilar (R-FLO-002/006), así
que contaminaba la comparación con una segunda variable en vez de aislar la primera. Corregido
manteniendo la lista `ancla` cargada en **las dos** ejecuciones: la comparación vuelve a aislar solo
lo que declara vigilar.

### El informe, con las diecisiete clases

```
238.680 lecturas, 40 vehículos. Anillo reconstruido: 147 tags de 150 declarados. Fuera del anillo: 15.
  DETECTA     declarado-sin-lecturas — clases: obsoleto-candidato, obsoleto-candidato, obsoleto-candidato
  DETECTA     lectura-alta — señalados sin motivo: 0/10
  DETECTA     lectura-media — 10/10
  DETECTA     omision-por-memoria — 2/2
  DETECTA     omision-conservando-convoy — tags acusados por su culpa: 0
  DETECTA     rotura-subita — con el instante dentro de margen: 2/2
  DETECTA     degradacion-progresiva — con tendencia sostenida: 2/2
  DETECTA     mantenimiento-aislado — fuera del anillo: 2/2
  DETECTA     carga-online-normal — 4/4 calles con mediana en torno a la media hora; 98 paradas leídas como carga y 0 como silencio
  DETECTA     calle-sin-servicio — 1 calle sin entradas; clases: calle-sin-servicio, calle-sin-servicio, calle-sin-servicio
  DETECTA     salida-fuera-de-antiguedad — el primero por espera es 7112 (se esperaba 7112), 300 min; 3 inversiones más, que son cargas simultáneas de duración distinta y no un hallazgo
  DETECTA     carga-anterior-a-la-ventana — 5/5 inferidos, 5 señalados en total
  DETECTA     zona-vacia-declarada — 2 zonas declaradas, calles dentro de la vacía: sí; tags sanos con veredicto movido: 0; pasadas retiradas de la vía de orden: 0
  DETECTA     lector-agv-degradado — 7120: bajando (89% → 79% → 66% → 48%); tags con tendencia o rotura por su culpa: 0
  DETECTA     adelantamiento-en-zona-cargada — el primero por margen es 7113 (se esperaba 7113), 4 min de margen; 1 más
  DETECTA     bifurcacion-real — 2 ramas: 60363 57%, 96001 42%
  DETECTA     ancla-declarada — ancla efectiva: 60000 (observed); 1653 vueltas completas, 1653 con truth observed
```

**Diecisiete de diecisiete clases detectadas, cero falsos positivos, `DEUDA_CONOCIDA` vacía.**

### Gobierno

- `docs/CONFIG_SCHEMA.md` gana la subsección §3.4.2 «Anclas de vuelta declaradas» (antes una fila de
  una línea sin gramática de campos), renumerando la de las listas de tags a §3.4.3;
  `docs/ALGORITHM_CATALOG.md` gana §7.1 y corrige la fila de ALG-004; `docs/TEST_STRATEGY.md` corrige
  TC-061 («sin ninguna declarada», no «siempre») y añade TC-108–111; `docs/TRACEABILITY_MATRIX.md`
  gana fila para R-GRA-009 y corrige la referencia de sección desplazada; `docs/PHASE_GATES.md` G2
  describe la condición real en vez de «nunca observed»; `docs/GLOSSARY.md` (Ancla);
  `docs/OPEN_QUESTIONS.md` anota que el mecanismo de OQ-102/OQ-B04 ya existe, sin cerrarlas;
  `fixtures/synthetic/auditoria/MANIFEST.md` (`auditoria/6`).

## [3.11.0] - 2026-09-22

Candidatos a punto crítico (R-GRA-007), pedido explícitamente por el propietario tras quedar
ofrecido y sin pedir en `[3.6.0]` («puntos críticos candidatos»). De las siete clases que
`CONFIG_SCHEMA.md` §3.4.1 declara, esta entrega construye solo la firma de **bifurcación**:
`parada-precisa` y `semáforo` necesitan una firma de tiempo de permanencia que no existe todavía, y
`cruce` resultó ser un problema distinto —`assignCohorts` fusiona dos vehículos en un cohorte en
cuanto comparten una sola transición, así que un cruce real entre circuitos no sobrevive como dos
cohortes unidos por una arista rara: se fusiona, y la bifurcación resultante queda indistinguible de
una normal sin una comprobación de reconvergencia que esta entrega no construye—. Las tres quedan
diseñadas y documentadas, no silenciadas (OQ-122 pasa a Parcial, no a resuelta).

También R-GRA-008: un punto crítico declarado (lista `critico`), en memoria y nunca leído, deja de
salir como `obsoleto-candidato` — pierde una función, no solo una lectura.

### Añadido

- **`src/domain/critical-points.ts`** — `findBifurcationCandidates()`: recuento de sucesores por
  tag (el mismo que `findDominantCycle` ya reduce para encontrar el sucesor mayoritario), con guarda
  dual de cuota y soporte para descartar un sucesor dominante con una excepción rara o un reparto
  parejo sostenido por un puñado de pasadas.
- `src/domain/circuit-config.ts` gana `readCriticalPoints()`, calcado de `readZones`.
- `src/domain/inventory.ts`: `TagLists.critical`, nuevo `TagClass` `critico-sin-lectura` (R-GRA-008),
  subordinado a la memoria — sin ella, sigue siendo `declarado-sin-memoria` sin matiz, porque
  R-OPP-009 ya explica el silencio del todo.
- `CriticalPointThresholds` en `config.ts`, `draft` y sin valor por defecto en ninguna función.
- Vista: bloque «Candidatos a punto crítico» tras la composición del circuito, con la redacción
  obligada a citar R-GRA-007 — firma estadística, nunca función asignada.
- Decimosexta clase plantada en el circuito de auditoría, `bifurcacion-real`: un tag del anillo
  reparte sus salidas 58/42 hacia un tag fuera de anillo, sin depender de ningún vehículo concreto
  —cualquiera puede tomar cualquiera de las dos ramas—.

### Un riesgo real, encontrado auditando el propio detector

La guarda de cuota y soporte no basta: un tag justo antes de una rotura súbita aguas abajo (la
propia clase `rotura-subita` de este mismo escenario) sale como bifurcación falsa, porque casi todas
sus salidas van al sucesor de siempre antes de la rotura y al que la sustituye después, y esas dos
cuotas agregadas sobre toda la ventana son perfectamente comparables sin que exista ningún reparto
real. Corregido con una tercera guarda: cada rama debe sostenerse, por recuento y no por tiempo, en
las **dos mitades** de las pasadas del tag — una bifurcación real persiste en las dos, un cambio de
régimen desaparece en una. La prueba que expuso el problema queda fijada como caso de regresión.

Un segundo efecto, más pequeño: plantar la bifurcación en todos los vehículos (no en uno solo, como
`adelantamiento-en-zona-cargada`) reordena el generador aleatorio compartido lo bastante como para
que una lectura de mantenimiento —hasta ahora repartida sin ninguna exclusión— cayera, por pura
coincidencia, dentro de la estancia de carga de un vehículo, y esa carga dejara de reconocerse como
tal. Las lecturas de mantenimiento pasan a evitar las estancias de carga de su propio vehículo, que
es lo que su propia clase (`mantenimiento-aislado`, aislada de verdad) ya prometía.

### El informe, con las dieciséis clases

```
238.680 lecturas, 40 vehículos. Anillo reconstruido: 147 tags de 150 declarados. Fuera del anillo: 15.
  DETECTA     declarado-sin-lecturas — clases: obsoleto-candidato, obsoleto-candidato, obsoleto-candidato
  DETECTA     lectura-alta — señalados sin motivo: 0/10
  DETECTA     lectura-media — 10/10
  DETECTA     omision-por-memoria — 2/2
  DETECTA     omision-conservando-convoy — tags acusados por su culpa: 0
  DETECTA     rotura-subita — con el instante dentro de margen: 2/2
  DETECTA     degradacion-progresiva — con tendencia sostenida: 2/2
  DETECTA     mantenimiento-aislado — fuera del anillo: 2/2
  DETECTA     carga-online-normal — 4/4 calles con mediana en torno a la media hora; 98 paradas leídas como carga y 0 como silencio
  DETECTA     calle-sin-servicio — 1 calle sin entradas; clases: calle-sin-servicio, calle-sin-servicio, calle-sin-servicio
  DETECTA     salida-fuera-de-antiguedad — el primero por espera es 7112 (se esperaba 7112), 300 min; 3 inversiones más, que son cargas simultáneas de duración distinta y no un hallazgo
  DETECTA     carga-anterior-a-la-ventana — 5/5 inferidos, 5 señalados en total
  DETECTA     zona-vacia-declarada — 2 zonas declaradas, calles dentro de la vacía: sí; tags sanos con veredicto movido: 0; pasadas retiradas de la vía de orden: 0
  DETECTA     lector-agv-degradado — 7120: bajando (90% → 79% → 68% → 50%); tags con tendencia o rotura por su culpa: 0
  DETECTA     adelantamiento-en-zona-cargada — el primero por margen es 7113 (se esperaba 7113), 4 min de margen; 1 más
  DETECTA     bifurcacion-real — 2 ramas: 60363 57%, 96001 42%
```

**Dieciséis de dieciséis clases detectadas, cero falsos positivos, `DEUDA_CONOCIDA` vacía.**

### Gobierno

- `docs/CONFIG_SCHEMA.md` corrige la taxonomía de `critico` a las siete clases ya implementadas
  (`dejar-carro`/`recoger-carro` separadas) y declara aspiracionales los campos que ni `ConfigEntry`
  ni `CatalogEntry` llevan todavía (`grade`, `redundancy`, `protection_pair`, `expected_tag`,
  `target_circuit`); `docs/ALGORITHM_CATALOG.md` ALG-021 y §8.2, distinguiéndolo explícitamente de
  ALG-013/§9 (bloqueado por OQ-108); `docs/TEST_STRATEGY.md` TC-102–107; `docs/TRACEABILITY_MATRIX.md`;
  `docs/OPEN_QUESTIONS.md` OQ-122 pasa a Parcial; `docs/GLOSSARY.md` (punto crítico candidato,
  bifurcación candidata); `fixtures/synthetic/auditoria/MANIFEST.md` (`auditoria/5`).

## [3.10.0] - 2026-09-21

FIFO en zona cargada (R-FLO-001), pedido explícitamente por el propietario tras quedar ofrecido y
sin pedir en `[3.6.0]`. La puerta G3 ya lo decía en sus propias palabras: la zona de cada tag se
declara en CSV y el orden de convoy deja de probar el paso donde la reordenación está admitida
(R-FLO-006), pero el FIFO cargado como tal no se modelaba todavía. Se reutiliza el mismo cálculo que
ya resuelve `charging.ts` para R-CO-003 —quién entró antes pero salió después de otro—, aplicado a
un tramo del anillo en vez de a una calle.

### Añadido

- **`src/domain/fifo.ts`** — `loadedZoneSpans()`: deriva tramos contiguos de zona cargada del
  anillo (nunca configurados aparte), manejando el cruce del índice 0 del array sin partir un tramo
  en dos. `buildFifoReport()`: máquina de dos paradas (entrada/salida, sin la parada intermedia de
  una calle) sobre cada tramo, e inversión de orden con margen mínimo dual —absoluto y proporcional
  al tránsito mediano del propio tramo, el que sea mayor— para no confundir el jitter normal de
  lectura con un adelantamiento real.
- `FifoThresholds` en `config.ts`, `draft` y sin valor por defecto en ninguna función.
- `CircuitViews.fifo`, por cohorte: los tramos y quién adelantó a quién en cada uno.
- Vista: bloque «FIFO en zona cargada» tras las calles de carga, con los cinco adelantamientos de
  mayor margen de todo el circuito (recorte global, no por tramo: a diferencia de las calles, el
  número de tramos no está acotado por diseño) y el detalle completo plegado.
- Séptima clase plantada en el circuito de auditoría, `adelantamiento-en-zona-cargada`: un AGV libre
  de cualquier otro papel que se demora 20 minutos, una sola vez, justo al entrar en el tramo
  cargado — no se fabrica el adelantamiento, el resto de la flota lo adelanta con su propio reloj.

### Un riesgo real, anticipado antes de escribir el detector

Una calle de carga es una cola física real: cualquier inversión de orden es señal fuerte. Un tramo
de zona cargada es tránsito abierto — dos vehículos sanos muestran pequeñas diferencias de orden por
el jitter normal de lectura, y un vehículo que vuelve de cargar (una de las excepciones que la propia
R-FLO-001 nombra) reaparece con una fase nueva frente a sus antiguos vecinos, lo que puede producir
una inversión grande y enteramente inocente. Portar sin más el cálculo de `seniorityBreaches()`
—cero margen, correcto para una cola física— habría arriesgado exactamente el mismo tipo de falso
positivo que `minShareEachSide` corrigió en `[3.9.0]` para rotura y degradación. El margen dual se
exige en las dos puntas del adelantamiento (entrada y salida), no solo en una: si la diferencia de
entrada ya está dentro del ruido, «quién es el más antiguo» es tan incierto como la inversión de
salida que supuestamente explica.

### El informe, con las quince clases

```
238.879 lecturas, 40 vehículos. Anillo reconstruido: 146 tags de 150 declarados. Fuera del anillo: 15.
  DETECTA     declarado-sin-lecturas — clases: obsoleto-candidato, obsoleto-candidato, obsoleto-candidato
  DETECTA     lectura-alta — señalados sin motivo: 0/10
  DETECTA     lectura-media — 9/10
  DETECTA     omision-por-memoria — 2/2
  DETECTA     omision-conservando-convoy — tags acusados por su culpa: 0
  DETECTA     rotura-subita — con el instante dentro de margen: 2/2
  DETECTA     degradacion-progresiva — con tendencia sostenida: 2/2
  DETECTA     mantenimiento-aislado — fuera del anillo: 2/2
  DETECTA     carga-online-normal — 4/4 calles con mediana en torno a la media hora; 94 paradas leídas como carga y 0 como silencio
  DETECTA     calle-sin-servicio — 1 calle sin entradas; clases: calle-sin-servicio, calle-sin-servicio, calle-sin-servicio
  DETECTA     salida-fuera-de-antiguedad — el primero por espera es 7112 (se esperaba 7112), 300 min; 2 inversiones más, que son cargas simultáneas de duración distinta y no un hallazgo
  DETECTA     carga-anterior-a-la-ventana — 5/5 inferidos, 5 señalados en total
  DETECTA     zona-vacia-declarada — 2 zonas declaradas, calles dentro de la vacía: sí; tags sanos con veredicto movido: 0; pasadas retiradas de la vía de orden: 0
  DETECTA     lector-agv-degradado — 7120: bajando (90% → 75% → 64% → 55%); tags con tendencia o rotura por su culpa: 0
  DETECTA     adelantamiento-en-zona-cargada — el primero por margen es 7113 (se esperaba 7113), 4 min de margen; 2 más
```

**Quince de quince clases detectadas, cero falsos positivos, `DEUDA_CONOCIDA` vacía.** Añadir la
nueva clase destapó una sonda existente demasiado amplia: `carga-online-normal` contaba **cualquier**
silencio de más de quince minutos en todo el escenario como candidato a carga mal reconocida, y el
propio silencio de veinte minutos que planta esta entrega —a mitad del anillo, sin relación con
ninguna calle— lo hacía saltar sin ser un fallo de `charging.ts`. Corregida para mirar solo los
huecos que empiezan en la parada precisa de una calle servida, que es lo único que la sonda dice
comprobar en su propio comentario.

### Gobierno

- `PHASE_GATES.md` G3 (FIFO cargado modelado, sin marcar porque OQ-107 sigue sin el catálogo de
  excepciones); `ALGORITHM_CATALOG.md` ALG-011 y §8.1; `TEST_STRATEGY.md` TC-097–101;
  `TRACEABILITY_MATRIX.md`; `OPEN_QUESTIONS.md` OQ-107 pasa a Parcial; `GLOSSARY.md` (zona cargada,
  zona vacía, adelantamiento); `fixtures/synthetic/auditoria/MANIFEST.md` (`auditoria/4`).

## [3.9.0] - 2026-09-21

Rotura súbita y degradación progresiva (R-OPP-015): las dos únicas clases que la auditoría de
`[3.7.0]` dejaba como deuda, por la misma causa entonces diagnosticada — una sola tasa sobre toda la
ventana no distingue un tag que se lee y deja de leerse de uno que siempre estuvo a la mitad. El
propietario propuso el método: comparar en una segunda pasada, sobre los tags y los AGV con pasadas
suficientes. Se implementa sin releer la fuente: la primera pasada es el mismo recorrido que ya
construye la matriz de lectura, ampliado para retener el instante de cada pasada en vez de tirarlo;
la segunda es un post-proceso barato sobre esas líneas ya construidas.

### Añadido

- **`src/domain/read-rate-trend.ts`** — `detectTrend()`: segmentación binaria de un único corte
  (rotura), y solo si no la hay, caída monótona por tramos (degradación). En ese orden y sin
  mezclarlas, mismo principio que R-OPP-014. Aplicado a tags **y** a AGV: un lector que se degrada
  en varios tags a la vez se ve en su propia línea, sin que el hallazgo se traslade a los tags que
  lee si el resto de la flota los sigue leyendo con normalidad.
- `TagReadRow` y `VehicleReadRow` ganan `changedAtUtcMs`/`rateBefore`/`rateAfter` (rotura) y
  `trend`/`segmentRates` (degradación), opcionales: presentes solo cuando la búsqueda encuentra algo.
- `TrendThresholds` en `config.ts`, `draft` y sin valor por defecto en ninguna función.
- Vista: hallazgos de rotura y tendencia junto a los destacados de la matriz, para tags y AGV.
- Sexta clase plantada en el circuito de auditoría, `lector-agv-degradado`: un AGV libre de
  cualquier otro papel cuyo lector falla cada vez más en cualquier tag, con la comprobación cruzada
  de que su propio recuento cae entre la primera y la segunda mitad de la ventana.

### Un riesgo real, encontrado construyendo el detector, y corregido

Un corte único sin más guardas puede confundir una **racha corta de mala suerte al final de una
línea larga** con una rotura: cinco pasadas sin acierto entre quinientas parecían, al principio, un
corte más brusco que la propia tendencia que se estaba probando en el mismo escenario. `minSide`
pasa a exigir **una proporción real de la línea, no solo un mínimo absoluto** (`minShareEachSide`).
Con la corrección, la prueba que expuso el problema queda fijada como caso de regresión.

### Un defecto real del generador de auditoría, no del detector

Ejecutado contra el circuito completo, `rotura-subita` y `degradacion-progresiva` se detectaban con
una separación perfecta (100 %→0 %) pero el instante publicado caía **dos horas antes** del
plantado. La causa no estaba en `read-rate-trend.ts`: el generador etiqueta sus instantes como
epoch UTC, pero los escribe como **dígitos** en el CSV, y la auditoría los importa con
`zone: "Europe/Madrid"` — correcto, es lo que el `MANIFEST.md` declara y lo que un DS-001 real
exige. El resultado es que esos dígitos se leen como hora local de Madrid y se convierten a UTC
desplazándolos por el huso horario de verano (CEST, UTC+2). Ninguna prueba anterior lo notó porque
todas comparaban proporciones o presencia de un campo, invariantes a un desplazamiento constante;
la primera comparación de un instante absoluto contra otro lo destapó. Corregido en el generador:
`fromUtcMs`, `toUtcMs` y los `atUtcMs` de los defectos pasan por la misma conversión de zona que
aplicará el producto (`wallClockToUtc`, reutilizada de `src/domain/time.ts`), así que dejan de
prometer «epoch UTC» y empiezan a serlo. Corrige de paso, en silencio hasta ahora, la ventana de
cobertura que `analyse()` pasa a `buildChargingReport`.

### El informe, con las catorce clases

```
238.782 lecturas, 40 vehículos. Anillo reconstruido: 146 tags de 150 declarados. Fuera del anillo: 15.
  DETECTA     declarado-sin-lecturas — clases: obsoleto-candidato, obsoleto-candidato, obsoleto-candidato
  DETECTA     lectura-alta — señalados sin motivo: 0/10
  DETECTA     lectura-media — 9/10
  DETECTA     omision-por-memoria — 2/2
  DETECTA     omision-conservando-convoy — tags acusados por su culpa: 0
  DETECTA     rotura-subita — con el instante dentro de margen: 2/2
  DETECTA     degradacion-progresiva — con tendencia sostenida: 2/2
  DETECTA     mantenimiento-aislado — fuera del anillo: 2/2
  DETECTA     carga-online-normal — 4/4 calles con mediana en torno a la media hora; 94 paradas leídas como carga y 0 como silencio
  DETECTA     calle-sin-servicio — 1 calle sin entradas; clases: calle-sin-servicio, calle-sin-servicio, calle-sin-servicio
  DETECTA     salida-fuera-de-antiguedad — el primero por espera es 7112 (se esperaba 7112), 300 min; 1 inversiones más, que son cargas simultáneas de duración distinta y no un hallazgo
  DETECTA     carga-anterior-a-la-ventana — 5/5 inferidos, 5 señalados en total
  DETECTA     zona-vacia-declarada — 2 zonas declaradas, calles dentro de la vacía: sí; tags sanos con veredicto movido: 0; pasadas retiradas de la vía de orden: 0
  DETECTA     lector-agv-degradado — 7120: bajando (90% → 76% → 64% → 60%); tags con tendencia o rotura por su culpa: 0
```

**Catorce de catorce clases detectadas, cero falsos positivos, `DEUDA_CONOCIDA` vacía.** La tercera
aserción de la auditoría (la deuda no se pudre en ninguna dirección) exigía sacar las dos clases en
cuanto se detectaran, y así se hizo.

### Gobierno

- `RULE_CATALOG.md` R-OPP-015; `ALGORITHM_CATALOG.md` ALG-020 (§4.4); `TEST_STRATEGY.md` TC-091–096;
  `TRACEABILITY_MATRIX.md`; `UX_SPEC.md` §5.2.2; `OPEN_QUESTIONS.md` OQ-126 (los umbrales de rotura y
  degradación siguen sin fijar por planta); `PHASE_GATES.md` G3 con las catorce clases y cero deuda,
  todavía sin marcar porque el sintético no cubre las clases que faltan de OQ-B04.

## [3.8.0] - 2026-09-21

Las calles de carga online, la zona de vacíos y la configuración de planta como CSV. El propietario
no tiene datos de fabricación hasta mañana y añade el argumento que de verdad decide: **en el dato
real es difícil encontrar los fallos que queremos detectar, y sin conocerlos no sabemos si la
aplicación funciona**. Así que se sigue con el sintético, ahora con cinco calles de tres tags,
media hora de carga, una calle por la que no pasa nadie, un AGV al que se le salta el turno y cinco
que ya estaban cargando antes de que empezara la ventana.

**Nada de esto es alcance nuevo: es deuda de F0 que por fin se puede ejercitar.** R-CO-001 decía
desde el 3 de septiembre que «el piloto se validará además con un fixture sintético de **cinco
calles**», y R-CO-006 estaba `accepted` sin implementar. Lo único que no cubría ninguna regla es el
arranque en frío, y esa es nueva.

### Corregido

- **Media hora cargando salía como periodo de inactividad.** El umbral de silencio son cinco
  minutos, así que toda carga normal aparecía como un hueco que explicar. El propio `dossier.ts`
  ya decía en un comentario que separarlo «exige la configuración de calles que OQ-B04 todavía no
  ha dado»; ahora la tiene. En el escenario de auditoría son **93 paradas** que pasan de silencio a
  carga.
- **Tres tags perfectamente sanos acusados de no estar ya en el suelo.** Los de una calle por la
  que no entró nadie salían `obsoleto-candidato`, que afirma «está en la lista y probablemente no
  en el suelo». Sin entradas no hubo oportunidad de leerlos: clase nueva `calle-sin-servicio`,
  `unknown`, y la pregunta apunta a la calle (R-CO-008).
- **`orden` y `nota` se parseaban y se tiraban** al guardar la lista. Ahora las listas conservan sus
  metadatos por tag (peldaño 3 del almacén), que es lo que permite que una calle sea una secuencia
  con papeles y no un conjunto de tres tags.

### Añadido

- **La configuración de planta entra como CSV** (`CONFIG_SCHEMA.md` §3.4.2), que es lo que el
  propietario pidió: `lista;tag;orden;funcion;grupo;capacidad;nota`, con las dos primeras
  obligatorias y el resto localizadas por nombre en cualquier posición. `co_lanes`, `empty_zone`,
  `loaded_zone` y `critical_points` se expresan con ella. Lista nueva `zona`.
- **`src/domain/circuit-config.ts`** — monta calles y zonas, y **declara lo que no puede montar** en
  vez de completarlo. Una calle sin parada precisa, o con dos tags reclamando el mismo papel, no se
  usa y su motivo se enseña junto al análisis. Adivinar el papel por la posición sería sustituir la
  configuración por proximidad, que es lo que R-CO-006 prohíbe con esas palabras.
- **`src/domain/charging.ts`** — la máquina de estados por calle de R-CO-002: estancias con su
  mediana, permanencias largas **relativas a la mediana de su propia calle**, salidas fuera de
  antigüedad ordenadas por lo que esperó cada uno, calles sin servicio y arranque en frío.
- **R-CO-007, R-CO-008** (nuevas) y la aplicación de **R-FLO-006**, que llevaba `accepted` desde F0
  sin consecuencia en el código: el orden de convoy ya no prueba el paso en zona vacía ni cruzando
  una entrada de calle, y lo que retira **se cuenta** (`orderWithheld`) en vez de desaparecer.
- Cinco clases más en el circuito de auditoría, y el informe pasa de 8 a 13.

### El informe, que sigue siendo el entregable

```
240.975 lecturas, 40 vehículos. Anillo reconstruido: 146 tags de 150 declarados. Fuera del anillo: 15.
  DETECTA     declarado-sin-lecturas — clases: obsoleto-candidato, obsoleto-candidato, obsoleto-candidato
  DETECTA     lectura-alta — señalados sin motivo: 0/10
  DETECTA     lectura-media — 8/10
  DETECTA     omision-por-memoria — 2/2
  DETECTA     omision-conservando-convoy — tags acusados por su culpa: 0
  NO DETECTA  rotura-subita — con instante de cambio: 0/2
  NO DETECTA  degradacion-progresiva — con tendencia a la baja: 0/2
  DETECTA     mantenimiento-aislado — fuera del anillo: 2/2
  DETECTA     carga-online-normal — 4/4 calles con mediana en torno a la media hora; 93 paradas leídas como carga y 0 como silencio
  DETECTA     calle-sin-servicio — 1 calle sin entradas; clases: calle-sin-servicio, calle-sin-servicio, calle-sin-servicio
  DETECTA     salida-fuera-de-antiguedad — el primero por espera es 7112 (se esperaba 7112), 300 min; 4 inversiones más, que son cargas simultáneas de duración distinta y no un hallazgo
  DETECTA     carga-anterior-a-la-ventana — 5/5 inferidos, 5 señalados en total
  DETECTA     zona-vacia-declarada — 2 zonas declaradas, calles dentro de la vacía: sí; tags sanos con veredicto movido: 0; pasadas retiradas de la vía de orden: 0
```

**11 de 13 clases y cero falsos positivos.** Cuatro cosas que conviene decir y no adornar:

- **Las dos clases de deuda siguen siendo las mismas** —rotura súbita y degradación progresiva— y
  por la misma causa: una sola tasa sobre toda la ventana. Este incremento no las toca.
- **`lectura-media` baja de 9/10 a 8/10.** No es una regresión del detector: las cargas consumen
  números de la secuencia con semilla, así que el escenario es otra realización del mismo diseño.
  La cifra se publica como salió, sin ajustar el umbral para recuperar el 9.
- **El turno saltado señala a cinco vehículos y solo uno está plantado.** Los otros cuatro son
  cargas simultáneas de duración distinta, que invierten el orden de salida con toda normalidad. La
  lista se entrega ordenada por lo que esperó cada uno y el plantado sale el primero con 300 min
  frente a la media hora de mediana; la auditoría exige que salga **el primero**, no solo que
  aparezca. Qué excepciones son legítimas es OQ-125, y la responde planta.
- **R-FLO-006 está implementado y este escenario no lo ejercita**: `pasadas retiradas de la vía de
  orden: 0`, porque casi todos los segmentos tienen tiempo mediano y decide la vía del tiempo. Tiene
  pruebas unitarias propias, pero una regla que no se ejercita no está validada por esta auditoría
  aunque esté escrita, y el informe lo dice en lugar de callarlo.

### Gobierno

- `RULE_CATALOG.md` R-CO-007 y R-CO-008; `CONFIG_SCHEMA.md` §3.4.2; `TEST_STRATEGY.md` TC-080–090;
  `UX_SPEC.md` §5.2.1; `OPEN_QUESTIONS.md` OQ-124 (capacidad y tiempo de carga reales) y OQ-125
  (excepciones al orden de salida); `PHASE_GATES.md` G3 con las dos casillas de FIFO y calles CO
  **a medias y sin marcar**: están modeladas, pero solo ejercitadas contra el sintético.
- Los treinta minutos de carga son una magnitud del escenario y viven en el generador. En `src/` no
  hay ningún minutaje: `longStayRatio` y `minStaysForMedian` van a `AnalysisConfig` como `draft` y
  **sin valor por defecto**, igual que los cinco grupos que ya había.

## [3.7.0] - 2026-09-21

Un banco de pruebas donde **todos los fallos conocidos están plantados a propósito**, para dejar de
opinar sobre qué detecta el producto y empezar a contarlo. La frase del propietario fija el método:
«como ya sabes dónde está el fallo y qué lo delata, podemos optimizar la aplicación». Medir primero,
arreglar después, y que lo que se arregle lo decida una cifra.

### Añadido

- **`tests/support/circuito-auditoria.ts`** — generador con semilla: 150 tags declarados, 40
  vehículos, 30 h, ~252.000 lecturas, con ocho clases de fallo plantadas en posiciones fijas del
  anillo para que cualquiera pueda comprobarlas a mano. Devuelve, junto a los dos CSV, la **verdad
  plantada**: por cada defecto, sus tags y vehículos, qué debe decir el producto y —igual de
  importante— **qué no puede decir**; más la lista de tags limpios, que es contra la que se cuentan
  los falsos positivos.
- **`tests/audit/auditoria.test.ts`** — ejecuta el mismo encadenado que el Worker (importación →
  transiciones → cohortes → ciclo dominante → vueltas → matriz de lectura → inventario) y publica un
  informe por clase. `tests/audit/` es capa propia en `vitest.config.ts`: no comprueba una función,
  mide cuánto de lo que puede ir mal llega a decirse.
- **`scripts/generar-auditoria.ts`** — `npx vite-node scripts/generar-auditoria.ts` deja las dos CSV
  en `local/` e imprime lo plantado con tags y AGV concretos, para cargarlo en el móvil y buscar en
  la pantalla lo que el informe dice.
- **`fixtures/synthetic/auditoria/MANIFEST.md`** con el escenario, los resultados esperados y los
  **prohibidos**. Los datos no se versionan: se generan con semilla, igual que la fuente de cien mil
  filas de `tests/e2e/rendimiento.spec.ts`.

### El informe, que es el entregable

```
251.675 lecturas, 40 vehículos. Anillo reconstruido: 146 tags de 150 declarados. Fuera del anillo: 3.
  DETECTA     declarado-sin-lecturas — clases: obsoleto-candidato, obsoleto-candidato, obsoleto-candidato
  DETECTA     lectura-alta — señalados sin motivo: 0/10
  DETECTA     lectura-media — 9/10
  DETECTA     omision-por-memoria — 2/2
  DETECTA     omision-conservando-convoy — tags acusados por su culpa: 0
  NO DETECTA  rotura-subita — con instante de cambio: 0/2 (se busca `changedAtUtcMs` en la fila del tag)
  NO DETECTA  degradacion-progresiva — con tendencia a la baja: 0/2 (se busca `trend` en la fila del tag)
  DETECTA     mantenimiento-aislado — fuera del anillo: 2/2
```

Seis clases de ocho detectadas, **cero falsos positivos** sobre los tags sanos, y dos clases que no
se detectan — que son el primer hallazgo de la auditoría, no un defecto suyo:

- **Rotura súbita y degradación progresiva se escapan por la misma causa**: el producto calcula
  **una sola tasa sobre toda la ventana**. Un tag que se leía al 100 % y desaparece de golpe, y otro
  que va del 90 % al 40 %, salen los dos como un porcentaje medio indistinguible de un `gradiente`.
  Separarlos exige mirar la tasa **a lo largo del tiempo**, que no está implementado. Queda medido y
  enumerado; construirlo es el incremento siguiente.
- El 10.º tag de lectura media no se señala porque su tasa plantada roza el umbral de `lowRate`. No
  se toca el umbral para que la cifra quede bonita: se registra el 9/10.

Las clases no detectadas viven en una lista explícita, y la prueba falla **también** si una empieza
a detectarse sin sacarla de ella. Una lista de deuda que no se actualiza sola acaba mintiendo igual
que un `TODO` viejo.

### Gobierno

- `docs/TEST_STRATEGY.md`: la auditoría como capa propia (§7) y en la tabla de capas.
- `docs/PHASE_GATES.md` G3: el mecanismo de «falsos positivos y desconocidos medidos por categoría»
  ya existe. **La casilla sigue sin marcar**: la marcarán las cifras, no el mecanismo.

### Corregido

- Una línea en blanco partía en dos la tabla de casos de oro de `TEST_STRATEGY.md` entre TC-075 y
  TC-076, así que los cuatro últimos casos no se renderizaban como tabla.

## [3.6.0] - 2026-09-20

### Corregido

- **La pasada se perdía justo cuando el problema era peor.** Exigir los dos vecinos inmediatos
  funciona si falta un solo tag; si un vehículo pierde **varios seguidos**, también falta el vecino,
  el punto deja de estar encerrado y la evidencia desaparece — precisamente en el caso más grave.
  Ahora el punto se encierra entre las lecturas que sí hubo, falten los tags que falten.

### Añadido

- **Prueba de paso en tres vías** (R-OPP-014, nueva), en este orden y sin mezclarlas:
  1. **Vecinos**, cuando solo falta el tag en cuestión.
  2. **Tiempo**, cuando falta un tramo: ¿tardó lo que ese tramo tarda? Las medianas por segmento se
     miden del propio dato, donde los dos extremos se leyeron seguidos.
  3. **Orden de convoy**, y solo cuando no hay tiempo con que comparar: salir del tramo entre los
     mismos AGV con los que se entró demuestra permanencia en la línea (R-OPP-004).
  Lo que ninguna sostiene **no cuenta como pasada ni como fallo del tag**: queda registrado como
  tramo no sostenido, candidato a atajo o a rama.
- La vista dice **cómo** se probó cada pasada, porque una tasa sostenida por tiempo es más débil que
  una sostenida por vecinos, y cuántos segmentos del anillo tienen tiempo medido.

### Dos defectos propios, encontrados construyendo esto

- El vecino de convoy podía ser **el propio vehículo** en otra vuelta, con lo que cualquiera era
  vecino de sí mismo y el orden «se conservaba» siempre.
- Y podía ser uno que pasó **horas antes**: sin ventana temporal, «el de delante» no significa nada.
  La ventana es el propio tiempo que tardó el tramo, así que se escala sola sin otro umbral.
- Además, el orden ya no se usa para **contradecir** un tiempo que ya decidió: si el tiempo dice que
  no recorrió el tramo, buscar otra vía que diga que sí es lavar una contradicción, no resolverla.

## [3.5.0] - 2026-09-20

Probado el producto publicado en el Galaxy S23 FE: corre con fluidez. A partir de ahí, lo que el
propietario pidió — pasar de «qué se leyó» a «a qué hay que mirar, y de quién es el problema».

### Añadido

- **Composición del circuito: cuántos tags lo forman y en qué orden.** No hizo falta calcular nada
  nuevo: `findDominantCycle` devolvía el anillo entero desde F2 y el Worker se quedaba solo con el
  tag de ancla, tirando el resto. Ahora el recuento sale junto al de vehículos —«1 circuito de 54
  vehículos y 147 tags en el anillo»— y la lista ordenada se despliega. Es la misma lista que se
  contrasta con el circuito virtual y con la de memoria cuando están cargadas.
- **`src/domain/read-matrix.ts`: matriz de lectura tag × AGV** (R-OPP-013, nueva). Para cada par,
  qué porcentaje de las veces que ese vehículo **pasó por el punto** leyó el tag. El patrón que
  resulta —`bimodal-candidato`, `uniforme-bajo`, `gradiente`, `sin-soporte`— es lo que distingue
  «son unos vehículos» de «es el tag», que era justamente la pregunta.
- **Destacados primero, conjunto completo a demanda** (`UX_SPEC.md` §4.2, nueva): los hallazgos
  como tarjetas, y el anillo, los tags fuera de él y la matriz entera plegados y construidos
  **solo al abrirlos**.
- **R-GRA-011**: lo que el ciclo dominante deja fuera se enumera, no desaparece.

### Decisiones que el dato obligó a tomar

- **El denominador es la pasada probada, no la vuelta.** R-OPP-010 daba por bueno normalizar por
  vueltas; construyéndolo se vio que no basta: un vehículo que no recorre una rama saldría fallando
  todos sus tags, que es el falso positivo que TC-028 prohíbe. Y exigir **un** vecino tampoco vale
  —el anillo cierra, así que el tag de ancla es vecino del último y lo lee todo el mundo—. Hacen
  falta **los dos vecinos en la misma vuelta**. Lo destapó una prueba escrita antes que la
  corrección.
- **Un tag que se lee muy poco puede caer fuera del anillo precisamente por leerse poco**: el
  sucesor dominante lo salta. Comprobado con un circuito sintético realista, donde el tag omitido el
  85 % de las veces desaparecía del análisis por ser el más sospechoso. Ahora se enumera aparte, sin
  clasificar: separar una rama legítima de un tag de la línea mal leído exige la prueba de tiempos
  de OQ-118, que sigue sin implementarse.
- **Ni esto ni nada de lo anterior es una tasa de salud**, y la vista lo dice donde está el número.
  La salud exige oportunidad elegible —en memoria y existente, R-OPP-011—, y eso necesita OQ-B04.

### Corregido

- La tabla de hallazgos partía los encabezados letra a letra en 360 px. Los hallazgos pasan a
  tarjeta, que es lo que `UX_SPEC.md` §4 pedía desde F0.

## [3.4.1] - 2026-09-20

### Corregido

- **El primer despliegue en GitHub Pages falló**: `actions/configure-pages@v5` trae `enablement`
  en `false` por defecto, así que se limitó a comprobar que el sitio de Pages ya existía y falló
  con 404 en vez de crearlo — el repositorio nunca había tenido Pages activado. Con `enablement:
  true` explícito, la propia acción lo crea la primera vez, usando el permiso `pages: write` que
  el workflow ya concede.

## [3.4.0] - 2026-09-20

Despliegue en GitHub Pages, adelantado desde G6 para poder medir por fin PERF-D2 en el dispositivo
de referencia (Samsung Galaxy S23 FE) — deuda declarada desde G1 que necesitaba una URL real.

### Añadido

- **`.github/workflows/deploy-pages.yml`**: publica en GitHub Pages desde `main`. No repite las
  verificaciones existentes: llama a `build-quality.yml`, `data-guard.yml` y `docs-quality.yml`
  como *reusable workflows* (`workflow_call`, añadido a los tres) y solo compila y despliega si los
  tres terminan en verde, tal como fija `ADR-0014` («solo se despliega una compilación que haya
  superado todas las verificaciones»). No hizo falta tocar `vite.config.ts` ni `public/`: ya
  publican bajo `/tag-trace/` con rutas relativas desde que se escribió la PWA.

### Notas

- Esto es infraestructura de despliegue, no la aprobación del piloto: `PHASE_GATES.md` G6 marca
  solo este punto, y el resto —accesibilidad, PERF-D2–D4 completos, informe de aceptación— sigue
  sin cerrarse.

## [3.3.0] - 2026-09-20

F3 abierta por el propietario («Continúa con Fase 3»), y la primera prueba del producto en un
navegador contra un circuito de forma realista —54 vehículos, 150 tags, 98.400 lecturas, 18 h a
resolución de segundo—. Encontró tres cosas que la suite en verde no había detectado.

### Corregido

- **El replay llamaba «silencio» a un vehículo que aún no había tenido su primera lectura**
  (R-GRA-010, nueva). Un silencio afirma que una posición conocida deja de confirmarse; antes de la
  primera lectura no hay posición que dejar de confirmar, así que lo que hay es **ausencia de datos
  para ese objeto** —R-DAT-007 acotado a un objeto—. En el primer fotograma de una ventana real eso
  presentaba 53 de 54 vehículos como averiados, con estado `unknown` y una fecha de inicio del
  silencio que además cambiaba al mover el deslizador. Ahora sale `sin datos` y dice cuándo llega
  esa primera lectura, que es lo único que el dato sostiene.
  **El caso de prueba TC-065 pedía literalmente el comportamiento defectuoso**, y la prueba
  correspondiente pasaba. Se corrigen los dos, y queda anotado en `TEST_STRATEGY.md`: lo que hay que
  recordar no es el defecto, sino que una prueba en verde lo sostenía.
- **La banda de actividad emitía un rótulo por celda**: con 54 vehículos y 96 tramos son 10.368
  nodos, el 86 % de toda la página, y una tarea de **958 ms** bloqueando el hilo principal justo
  después de importar — el modo de fallo exacto con el que el prototipo se cayó en el móvil. La
  celda se deduce ahora de la posición del puntero y se lee en una región viva, que además se
  comporta mejor con lector de pantalla que cinco mil títulos. Medido después: **7.275 nodos en vez
  de 12.458 y 340 ms en vez de 958**.
- **Las tablas del expediente, del contraste y del replay no tenían estilo propio** y usaban el del
  navegador, que dimensiona por contenido: en pantalla de móvil la del expediente medía 469 px sobre
  360 y había que arrastrar en horizontal para leerla, justo lo que `UX_SPEC.md` §5.1 prohíbe.

### Añadido

- **Cada periodo de inactividad muestra sus dos extremos**: por dónde se fue y por dónde volvió
  (`UX_SPEC.md` §4.1, que lo exigía desde F0). Volver al mismo tag y volver más adelante son hechos
  distintos —el primero dice que estuvo ahí parado, el segundo que siguió circulando sin ser leído—
  y el expediente los muestra **sin elegir entre ellos**: separarlos del todo exige el contraste con
  la cohorte y las calles configuradas que OQ-B04 aún no ha dado.
- **El replay ordena por estado**, no por identificador: primero lo que tiene posición, después lo
  que no. Con 54 vehículos, el orden alfabético enterraba a los pocos en movimiento.
- **El expediente va antes que las vistas.** Es la vía de trabajo declarada más frecuente y quedaba
  a 3.569 px del principio en móvil; ahora, a 2.120.

### Cambiado

- El subtítulo decía «Importador de lecturas · F1a·0» cuando el producto acumula circuitos, contrasta
  inventario, segmenta vueltas y reproduce el recorrido.

## [3.2.0] - 2026-09-20

Los cinco elementos programables que quedaban pendientes de G2 (Parte 20), construidos, probados y
alcanzables desde la interfaz, más dos decisiones del propietario sobre el circuito de referencia y
el plan de aceptación.

### Añadido

- **`src/domain/cohort.ts`** (R-DAT-012): agrupamiento por circuito mediante Union-Find sobre las
  aristas observadas. Un vehículo sin ninguna arista compartida sale en su propio cohorte de uno, en
  vez de forzarse dentro de un grupo ajeno.
- **`src/domain/laps.ts`** (ALG-004): segmentación de vueltas por AGV usando como ancla el ciclo
  dominante del grafo cuando no hay ancla declarada (R-GRA-009, nueva). Toda vuelta segmentada así
  es `inferred`, nunca `observed`, y la segmentación se hace por cohorte para no mezclar circuitos.
- **`src/domain/dossier.ts`** (ALG-018, `UX_SPEC.md` §4.1): expediente navegable de AGV y de tag —
  vueltas, inactividad, última lectura, comparación contra la mediana del cohorte, nunca de la
  flota entera.
- **`src/domain/vsystem.ts`**: contraste contra Vsystem por alineación de secuencia (LCS),
  reproduciendo en forma general el método validado a mano sobre PC2. Marca sustituciones
  candidatas con su evidencia y su estado `inferred`.
- **`src/domain/replay.ts`**: replay básico determinista. La posición en un tramo es fracción
  temporal, nunca física (`PERFORMANCE_BUDGET.md` §6); los fotogramas se precalculan enteros en el
  Worker y viajan como datos pequeños, nunca las lecturas otra vez (WP-001).
- **`fixtures/synthetic/anillo/`**: los fixtures de `acumulacion/` son deliberadamente lineales y no
  sirven para ejercitar un ciclo real, así que estos cinco módulos necesitaban su propio fixture con
  un anillo que de verdad se repite.

### Corregido

- El expediente de AGV/tag calculaba cada uno por separado, comparando contra el resto del cohorte
  con un filtrado propio: O(vehículos² × lecturas). Se corrigió a una sola pasada de agrupamiento
  por vehículo antes de construir cualquier expediente, sin cambiar el resultado.
- El replay devolvía un vehículo en tránsito con fracción 0 cuando un fotograma caía exactamente en
  el instante de una lectura con otra lectura próxima después. Debía salir en el tag, con estado
  `observed`.

### Decidido

- **SE2/4 pasa a ser el circuito priorizado** para las pruebas de aceptación de F2, mientras se
  recoge más volumen de PC2. Los hechos operativos concretos son de planta y quedan fuera del
  repositorio.
- **OQ-B05 aceptada de forma acotada**: el propietario valida en persona con los datos reales ya
  aportados, en su propio dispositivo. El criterio de rechazo de una fase sigue sin definirse.

## [3.1.0] - 2026-09-18

Cuatro peticiones del propietario, todas dentro de F2: la afinidad que faltaba en G1, las listas de
tags declaradas por el importador, la acción a valorar cuando el dato no decide, y las primeras
cuatro vistas del producto.

### Añadido

- **`src/domain/affinity.ts`**: afinidad de circuito (FR-003, R-DAT-006, ALG-003). Compara los tags
  de una fuente contra los que el circuito ya conoce **antes** de escribir en el almacén, porque una
  vez unida una fuente ajena no hay forma de separarla —la unión no conserva de qué circuito venía
  cada lectura—. **No rechaza la importación**: una fuente sospechosa se sigue mostrando, y lo que
  se niega es consolidarla (FR-003 separa analizar de consolidar). El primer fichero de un circuito
  vacío se acepta declarando que no se ha comprobado, en vez de bloquear el arranque del circuito.
- **`src/ingestion/catalog.ts`** y **`src/domain/tag-lists.ts`**: importador de listas de tags
  (circuito virtual, memoria, mantenimiento, emergencia, carga online, críticos). Estas listas **se
  crean a mano** porque no existe forma de descargarlas del sistema de planta, así que el programa
  declara su propia estructura mínima (`lista;tag`, con `orden` y `nota` opcionales) y la enseña en
  la interfaz **antes** de pedir el fichero. Tolera lo que una persona escribe de verdad: acentos,
  mayúsculas, plural. Una lista con un nombre que el producto no reconoce **se conserva con su
  nombre y se avisa**, nunca se rechaza — el propietario ya anticipó ampliaciones.
- **Las listas viajan con el circuito**, no aparte (`src/persistence/store.ts`, `STORE_VERSION` 2
  con su peldaño de migración). Son parte del estado del circuito en el momento del análisis:
  repetir un análisis de hace tres meses usa las listas de hace tres meses. Si se cargan de nuevo
  tras aplicar los cambios que el inventario propone, el análisis siguiente las recoge actualizadas
  sin alterar los anteriores.
- **R-EVI-006**: el programa enuncia la pregunta, la persona decide. Un tag en memoria sin ninguna
  lectura puede estar retirado o averiado, y el dato no distingue las dos cosas (R-DAT-016); el
  programa no elige, pero tampoco calla — indica qué hay que valorar (`src/domain/inventory.ts`,
  `TagAction`) y esa indicación queda junto al hallazgo, no hay que reconstruirla cada vez.
- **Cuatro vistas** (`src/presentation/charts.ts`, `src/domain/activity.ts`): cobertura cargada,
  perfil horario, actividad por vehículo e inventario de tags. SVG propio y sin dependencias
  (ADR-0014); los agregados se calculan en el Worker y viajan como unos cientos de números, nunca
  las lecturas otra vez (WP-001). Paleta de un solo tono en rampa ordinal, validada en los dos modos
  contra sus superficies reales. Cada gráfico lleva su tabla equivalente, así que el color nunca es
  el único medio (UX §4), y los tramos sin cobertura se dibujan con trama, distintos de un silencio
  (R-DAT-007).
- `src/domain/config.ts`: los umbrales de afinidad, ceguera y grafo en un solo sitio, marcados
  `draft` mientras no los fije el propietario. Ninguno tiene valor por defecto en su función: la
  llamada no compila sin decidirlos, que es la forma de que no se cuelen como constantes ocultas.
- Fixtures sintéticos: `fixtures/synthetic/listas/` y `fixtures/synthetic/acumulacion/circuito-ajeno.csv`.
- TC-053 a TC-058, y 22 pruebas nuevas (Node y navegador): `tests/unit/affinity.test.ts`,
  `tests/unit/catalog.test.ts`, `tests/e2e/vistas.spec.ts`.

### Corregido

- **Cargar una fuente nueva borraba en silencio las listas del circuito.** `saveCircuit` reescribe
  el objeto entero, y `accumulate()` no arrastraba `lists` al guardar. Lo destapó la prueba de
  navegador que carga listas y después importa una segunda ventana: el inventario desaparecía sin
  que nada lo dijera.
- **El texto de los gráficos se leía ilegible.** El SVG se escala con su `viewBox`; con un lienzo de
  1000 unidades pintado en un panel de unos 600 píxeles, las etiquetas de los vehículos se
  encogían hasta pisarse. Ni los tipos ni las pruebas lo detectan — solo mirar el render. El lienzo
  se acercó al ancho real de pintado.

### Verificación

- `tsc --noEmit` limpio, **109 pruebas de Node y 15 de navegador en verde**, `vite build` correcto,
  guardianes documental y de datos correctos.
- Render inspeccionado a mano tras el ajuste de escala: las cuatro vistas legibles en el ancho real
  del panel.

### Pendiente

- Las listas se contrastan hoy sin las **vueltas** del vehículo (ALG-004): la normalización de
  R-OPP-010 sigue siendo aproximada hasta que existan.
- La afinidad usa umbrales `draft` (60 % compatible, 20 % ajeno, 5 tags mínimos), justificados por
  el contraste de PC2 pero no aprobados por el propietario.

## [3.0.0] - 2026-09-17

**F2 abierta** por el propietario con «Continúa Fase 2», y su cimiento entregado: el grafo observado.

### Gobierno

- `docs/project_state.json` pasa a `F2 / Grafo físico y replay básico`, con `CONTINÚA FASE 3` como
  siguiente transición. La aprobación es del propietario; ninguna IA aprueba su propio cambio de
  fase (ADR-0010).
- **G1 se cierra con tres criterios sin cumplir, y se dicen en lugar de marcarse**: el plan de
  aceptación local de F1 (OQ-B05), la afinidad de circuito —que hoy no impide cargar en un circuito
  la exportación de otro— y PERF-D2 en el Galaxy S23 FE, que solo puede medir el propietario. Los
  tres pasan a G2 como deuda declarada. Marcar una casilla no demostrada convertiría la puerta en un
  trámite, que es justo lo que `AI_DEVELOPMENT_GOVERNANCE.md` prohíbe.

### Añadido

- **`src/domain/graph.ts`**: transiciones por vehículo y grafo observado con soporte, vehículos
  distintos, cuota entre las salidas del nodo, y estado de verdad **separado para la secuencia y
  para el tiempo**. Un tramo puede ser `observed` en secuencia y `unknown` en tiempo, y con
  resolución de minuto eso es lo normal, no la excepción.
- TC-048 a TC-052 con diez pruebas.

### Las tres trampas que el grafo evita, y por qué tienen prueba propia

Ninguna produce un error visible: las tres producen un grafo **plausible y equivocado**.

- **Una transición no cruza un hueco de cobertura.** Entre dos ventanas separadas por semanas, la
  última lectura de una y la primera de la otra son consecutivas en la lista y no en la realidad.
  Emparejarlas inventa una arista entre dos puntos cualesquiera del circuito, con un tiempo de tramo
  de semanas. Se descartan y **se cuentan**: si la cifra es alta, lo que se está mirando son varias
  ventanas y conviene saberlo antes de leer el grafo.
- **Dos lecturas en el mismo instante no ordenan nada** (R-DAT-013). Una arista sostenida en ellas
  no puede ser `observed` **por mucha cuota y mucho soporte que tenga**: lo que la sostiene es la
  posición en la pila, no el reloj. Dos tags leídos siempre a la vez son un punto, no dos.
- **El sentido de la fuente decide la dirección.** La misma pila leída al revés produce el grafo
  invertido, y sin síntoma. Es el hallazgo que obligó a corregir ADR-0013, y ahora tiene prueba.

### Decidido

- Los umbrales del grafo tampoco tienen valor por defecto, por la misma razón que los del
  inventario. La resolución de la fuente entra como parámetro porque es una propiedad **medida** del
  fichero (R-DAT-015), no un umbral elegido.

### Pendiente, y dicho para que no parezca terminado

`graph.ts` e `inventory.ts` están probados y **no son alcanzables desde la interfaz**. El dominio
crece mientras la superficie visible del producto no se mueve, que es la forma exacta en que el
prototipo acabó con un monolito y doce pruebas. El siguiente incremento es la vista que los expone,
no un módulo más. Siguen fuera: las vueltas (ALG-004), el agrupamiento por circuito (R-DAT-012), el
contraste contra Vsystem y el replay.

## [2.2.0] - 2026-09-17

El universo de memoria, y el tag que existe en la lista y no en el suelo.

El propietario aporta qué contiene realmente la memoria de un vehículo: los tags del circuito
virtual, los de mantenimiento, los de sustitución de emergencia y **tags obsoletos que se retiraron
del suelo y nunca se borraron de la lista**. Los vehículos, además, pueden no estar bien
actualizados, así que uno arrastra obsoletos que otro ya no tiene.

Esa cuarta categoría es la que cambia las cuentas, y en la dirección contraria a la esperada. DS-008
llevaba desde F0 declarada como «requisito de toda tasa de lectura», con la idea implícita de que
tenerla desbloquearía la salud. **No la desbloquea: primero hay que restarle lo que no existe.** Un
tag obsoleto está en memoria y no es una oportunidad, así que aplicar la regla tal como estaba
escrita habría pasado de «no hay tasa de lectura» a «una tasa que cuenta como fallo tags que no están
instalados» — peor, porque vendría con una lista detrás y parecería fundada.

### Añadido

- **`src/domain/inventory.ts`**: clasificación del universo de tags cruzando **declarado × memoria ×
  observado**. Seis clases, sin grafo, sin vueltas y sin ninguna constante industrial: es pertenencia
  a conjuntos y recuentos. Distingue el punto ciego de configuración (declarado y en ninguna memoria)
  del candidato a obsoleto (en memoria y jamás leído) y de la ceguera parcial (unos lo leen siempre y
  otros nunca).
- **`src/domain/truth.ts`**: los cinco estados de verdad como tipo propio. Existían solo en el
  glosario y en la prosa; ahora el compilador los conoce.
- **R-OPP-011**: una oportunidad elegible exige **dos** condiciones, en memoria **y existente**.
- **R-OPP-012**: con lista maestra, la memoria de un vehículo concreto es `expected`, nunca
  `observed`; la desviación individual se infiere y se declara como inferencia.
- **R-DAT-016**: un tag en memoria que nadie ha leído jamás es candidato a obsoleto, no un hallazgo.
  Con una sola ventana, obsoleto y averiado producen el mismo dato y el estado es `unknown`.
- **R-TIM-008**: la cadencia de extracción y la detección de cambios son cosas distintas. Extraer
  poco y espaciado degrada la fidelidad con que se reconstruye el circuito, pero **no impide detectar
  cambios entre dos periodos distantes**: eso exige dos muestras buenas, no continuidad.
- TC-042 a TC-047 y nueve pruebas que las ejercitan, incluida la que hoy no se sabría producir a mano
  —un tag declarado que ninguna memoria contiene— y la que impide que un vehículo con dos lecturas
  en toda la ventana convierta en ciego a medio circuito.
- `CONFIG_SCHEMA.md` §3.8: las cuatro listas como configuración versionada, con `scope` distinguiendo
  una lista maestra de un inventario por vehículo, porque decide el estado de verdad de todo lo
  derivado.

### Corregido

- **`TRACEABILITY_MATRIX.md` afirmaba que no estaban implementados** TC-015, `.agvproj`,
  INV-010/INV-011, PERF-D2 y la prueba de red. Los cinco lo están desde [2.0.0] y [2.1.0]. Una matriz
  de trazabilidad desactualizada es peor que no tenerla: se consulta para saber qué está cubierto.

### Decidido

- Los umbrales del criterio de ceguera **no tienen valor por defecto**, y la función no compila sin
  ellos. Un valor por defecto es una constante industrial disfrazada con el agravante de que nadie la
  ve; obligando a pasarlos, quien los elige tiene que sacarlos de la configuración del circuito.

### Pendiente, y dicho para que no parezca terminado

`inventory.ts` está probado pero **todavía no es alcanzable desde la interfaz**: falta importar las
listas de planta (DS-002, DS-006, DS-008), y para eso hace falta ver un fichero real. Escribir un
lector para una forma que no se ha visto es lo que ha fallado cada vez en este proyecto.

## [2.1.0] - 2026-09-17

Pruebas de navegador. Existen porque `src/persistence/store.ts` y la acumulación del Worker
**no se habían ejecutado nunca**: compilaban, estaban tipadas y ninguna prueba las tocaba. Las 71
pruebas de Node cubrían las piezas puras, que son las que corren sin navegador, y con ellas se
estaba afirmando que el producto acumula.

Encontraron cuatro defectos en la primera ejecución. Era el objetivo.

### Corregido

- **`npm run preview` no había servido nunca una compilación funcional.** `vite.config.ts` usaba la
  base `/tag-trace/` al compilar y `/` al servir, porque solo miraba `command`, que vale `"serve"`
  tanto en desarrollo como en vista previa. El resultado: la vista previa devolvía `index.html` para
  cada recurso y la página salía en blanco. No se notaba porque en desarrollo funciona y publicado
  también; solo fallaba justo donde uno va a comprobar el build antes de publicarlo.
- **La confirmación de exportación pisaba mensajes posteriores.** Se emitía *después* de disparar la
  descarga, así que llegaba cuando el usuario ya podía haber hecho otra cosa y sobrescribía el
  mensaje de esa otra cosa. Ahora se muestra antes.
- **Volver a elegir el mismo fichero no importaba nada**, y en este producto reimportar una
  exportación ya cargada es normal: los solapes son deliberados. El valor del selector se reinicia
  al abrirlo.
- **Y el primer arreglo de eso introdujo uno peor**, que la misma ejecución destapó: limpiar el
  valor al procesar el fichero vacía la `FileList` y con ella el `File` que aún no se ha leído, así
  que `arrayBuffer()` fallaba y un `.agvproj` válido se rechazaba solo.
- **En CI el servidor de vista previa arrancaba y nadie lo encontraba.** Sin `--host`, Vite anuncia
  `localhost`, que en un runner puede resolver a IPv6 mientras Playwright sondea la IPv4 que tiene
  declarada. El único síntoma era «timed out waiting for webServer», que no dice qué pasó. Se fija
  `--host 127.0.0.1` y se redirige la salida del servidor al registro, para que un fallo futuro
  traiga escrito su motivo en lugar de haber que deducirlo.

### Añadido

- **Nueve pruebas de navegador** (TC-036 a TC-041): acumulación real con dos exportaciones
  solapadas y con dos disjuntas, persistencia al recargar, cancelación que no deja nada escrito,
  ida y vuelta de `.agvproj` con un byte alterado que se rechaza **sin tocar el almacén**, y la
  **prueba de red** de `SECURITY_PRIVACY.md` §4, que llevaba desde F0 sin ejecutarse nunca.
- **PWA**: manifiesto, icono y un service worker que sirve el esqueleto sin red. Red primero, caché
  como respaldo, y solo el propio origen. CSP por `<meta>` con el límite que ADR-0014 ya declara.
- **PERF-D2 medido** y registrado con sus condiciones (`PERFORMANCE_BUDGET.md` §3.1): 100.000
  eventos en 1.330 ms, con p95 de hueco de fotograma de **17 ms** frente al objetivo de 50. El
  **máximo de 341 ms no cumple** y se dice: es el clon de las cien mil lecturas al llegar del
  Worker, y se corrige enviando una página en lugar de todo. La cifra **no** es la del móvil de
  referencia, que solo puede medir el propietario.
- Las pruebas de navegador entran en CI como trabajo aparte, con su rastro guardado si fallan.
- **`vitest.config.ts` declara el territorio de cada corredor**: Vitest solo `tests/unit/`,
  Playwright solo `tests/e2e/`. Sin eso Vitest recogía también los ficheros de Playwright —el patrón
  por defecto no los distingue— y fallaba con «Playwright Test did not expect test.describe() to be
  called here». Lo detectó CI y no la ejecución local, porque el filtro con el que se revisó la
  salida local no incluía la palabra `FAIL` y se dio por verde algo que estaba en rojo.

## [2.0.0] - 2026-09-17

F1a: el producto deja de olvidar. Hasta ahora importaba un fichero y lo perdía al cerrar la
pestaña, lo cual es inservible cuando el servidor de planta guarda dos o tres días y el modo de
trabajo real es acumular muchas extracciones pequeñas a lo largo de meses. Todo lo que ha tenido
valor en este proyecto salió de comparar dos ventanas separadas por semanas, y eso solo existe si
alguien las guarda.

### Añadido

- **Almacén local con migraciones explícitas desde la versión 1** (`src/persistence/store.ts`). Es
  la única parte del sistema cuyos datos no se pueden volver a pedir: una ventana perdida no vuelve.
  El prototipo se quedó en IndexedDB v1 sin ninguna ruta de migración, así que su primer cambio de
  forma le habría costado justo esos datos. Subir la versión sin escribir su peldaño falla al abrir.
- **Contenedor `.agvproj`** (ADR-0012) con manifiesto, hash por sección y hash global, límites de
  descompresión y **carga transaccional**: una sección corrupta invalida la carga entera y el
  almacén local no se toca. Zip propio, **sin dependencias nuevas**, sobre `CompressionStream`.
- **Unión de varias exportaciones** (ALG-002, `src/ingestion/union.ts`). Dos exportaciones son
  cortes de la misma pila: el solape se cuenta una vez y conserva las dos procedencias. Nunca se
  deduplica por huella de fila, que habría borrado 114 maniobras legítimas de 116 filas idénticas.
- **Cobertura** (R-DAT-007, `src/domain/coverage.ts`). Fuera de lo cargado no hay silencio, hay
  ausencia de datos. La cobertura de una fuente termina en su último instante **completo**: el
  último es el momento en que se pulsó el botón y casi nunca está entero.
- **Hash semántico** (`src/domain/semantic-hash.ts`) con serialización canónica y la
  canonicalización numérica que ADR-0013 exige, versionada: si la regla cambia, los hashes viejos
  dejan de coincidir a propósito en lugar de coincidir por casualidad.
- La interfaz acumula en un circuito con nombre, muestra la cobertura junto a cualquier cifra
  temporal, y exporta y reabre `.agvproj`.

### Decidido

- **El dispositivo acumula, el fichero viaja** (`DATA_CONTRACTS.md` §9.1). `.agvproj` no lleva el
  bruto, así que son dos almacenes con propósitos distintos. La acumulación ocurre dentro del
  Worker, que lee y escribe el almacén por su cuenta: mandarle las lecturas guardadas por
  `postMessage` las clonaría —defecto P4 del prototipo— y unirlas en el hilo principal recorrería
  dos series de cientos de miles de elementos donde WP-001 lo prohíbe.

### Corregido durante el desarrollo

- **El guardián de ratio de descompresión rechazaba datos legítimos** y no protegía de lo que decía
  proteger: un JSON de lecturas comprime muchísimo por sus claves repetidas, y una cabecera que
  mienta sobre el tamaño ya habría expandido la memoria cuando se comprobase. Se sustituye por un
  tope **aplicado mientras se descomprime**, que corta el flujo en cuanto la salida excede lo
  declarado.
- **La primera unión duplicaba la cola de las fuentes.** Excluir el instante cortado de la
  comparación es correcto —una ausencia ahí no es un desacuerdo— pero entonces un evento que las dos
  exportaciones traen en ese instante entraba dos veces. Son dos rangos distintos: se empareja sobre
  el solape completo y solo se juzga desacuerdo donde ambas están completas.

### Verificado contra dato real

- Las dos ventanas de PC2 en un circuito: 268.724 lecturas, cobertura en **dos tramos** y el hueco
  de 38,8 días declarado como `sin datos cargados`, nunca como silencio. Volver a cargar la misma
  exportación encima no cambia ninguna cifra.

## [1.9.0] - 2026-09-17

El propietario cierra una puerta: el servidor guarda **dos o tres días**, así que la exportación de
septiembre no se puede rehacer con segundos. Su 73 % de pasos sin ordenar por el reloj es
definitivo, y esa ventana queda `inferred` para siempre. La consecuencia no es sobre ese fichero:
es sobre **cuándo** hay que avisar.

### Añadido

- **Aviso de resolución degradada al importar** (**R-DAT-015**). Si una proporción apreciable de los
  pasos de un vehículo comparte instante, se dice al cargar el fichero y no al sacar el informe.
  Con una ventana deslizante de pocos días, un aviso que llega con el informe llega tarde: al
  importar puede que todavía se esté a tiempo de volver a extraer la fuente bien. El texto dice qué
  proporción de la secuencia no la ordena el reloj y qué se puede hacer mientras se pueda.
- El corolario de procedimiento queda en la regla: cuando la planta ofrezca varias salidas se elige
  la de mayor resolución y se comprueba **antes** de que la ventana gire, porque el coste de
  equivocarse no es repetir la extracción sino perder el periodo.

### Medido

- Las dos exportaciones de PC2 salieron de sitios distintos, y se distingue sin preguntar: la de
  julio trae segundos y **ninguna** fila sin tag; la de septiembre no trae segundos y el 24 % de sus
  filas no son lecturas, de las cuales el 94 % comparte minuto con una. Una salida incluye eventos
  de vehículo y la otra no.

## [1.8.0] - 2026-09-17

Una exportación real de dos días al principio de un mes **no se podía importar**, y el mensaje de
error pedía al usuario algo que la aplicación no le permitía hacer. Lo encontró el propietario
aportando el fichero; estaba anotado como riesgo desde hace dos días con la nota «hoy no hay fuente
así; la habrá».

### Corregido

- **Una fuente de fecha ambigua ya tiene salida.** Cuando ninguna fecha supera el día 12 no se puede
  distinguir día/mes de mes/día. Hasta ahora eso era un rechazo definitivo: el mensaje decía «indica
  explícitamente el orden de los campos» y **no existía ninguna forma de indicarlo**. El parámetro
  estaba en el núcleo y en el protocolo desde el principio; lo que faltaba era el control en la
  interfaz. Una promesa que el programa no cumple es peor que el rechazo.
- **La detección se rendía antes de mirar el fichero entero.** El muestreo se cortaba en 5.000
  valores, y como la fuente entrega en pila esas filas son todas del mismo día. Un día 13 en la fila
  cincuenta mil resolvía la ambigüedad y nunca se llegaba a leer: se declaraba irresoluble un
  fichero que se resuelve solo. Ahora, cuando la muestra no decide, se recorre el resto de la
  columna de fecha, que es barato y solo ocurre en ese caso.
- Una fecha imposible dejaba de descartarse y se desplazaba: un mes `00` daba diciembre del año
  anterior. Se descarta.

### Añadido

- **El fallo entrega el alcance de las dos lecturas posibles**, que es lo que convierte una pregunta
  imposible en una obvia: «día/mes: del 01/09/2026 al 02/09/2026 (dos días seguidos); mes/día: del
  09/01/2026 al 09/02/2026 (31 días)». El programa sigue sin elegir; pone las dos medidas delante.
- **R-DAT-014**: cómo se trata una fuente de fecha indeterminable, con las dos consecuencias que
  este defecto demostró —el alcance se mide sobre todas las fechas, no sobre una muestra, y una
  recuperación ofrecida tiene que existir de verdad.
- Control de orden de fecha en la interfaz, que aparece solo cuando hace falta.

## [1.7.0] - 2026-09-17

R-DAT-013 deja de vivir solo en el catálogo. La regla se escribió ayer; hasta hoy el producto no la
medía y el circuito reconstruido que se entregó afirmaba un orden que el reloj no da.

### Añadido

- **El resumen de fuente declara cuántas lecturas consecutivas del mismo vehículo comparten
  instante**, con su peso sobre los pares de ese vehículo. Es el límite de lo que la fuente afirma
  sobre su propia secuencia, y va junto al separador y la codificación, donde el usuario ya mira qué
  es la fuente. Nuevo `src/ingestion/same-instant.ts`, con `sameInstantPairs` y `vehiclePairs` en
  `SourceSummary`.
- `MonotonicityReport` gana `tiedPairs`: los pares del fichero que no aportaron evidencia de
  sentido. Se contaban implícitamente desde siempre; ahora se declaran.
- Columna `orden_evidencia` en el circuito reconstruido: `reloj`, `mismo-instante (n/N)` o
  `sin-arista`. Una arista degradada dice **por qué**, en lugar de degradarse en silencio.

### Corregido

- **La primera versión de este recuento medía otra cosa y habría engañado.** Contaba pares
  consecutivos del fichero, con todos los vehículos mezclados, y sobre una exportación real daba
  **39,3 %**. Pero dos AGV distintos leyendo en el mismo segundo es lo normal y no compromete
  ningún orden; lo que amenaza la topología son dos lecturas **del mismo vehículo**, que en esa
  misma exportación son el **2,9 %**. Las dos cifras son ciertas y responden a preguntas distintas.
  Publicar la primera como si fuera la segunda es un error de trece veces, y del tipo peligroso:
  trazable hasta filas reales y completamente equivocado. Las dos se conservan, separadas y con su
  significado escrito.
- **Tres de las 164 aristas que el circuito reconstruido declaraba `observed` pasan a `inferred`**,
  porque la mayoría de sus transiciones caen en el mismo instante: su orden lo da la posición en la
  pila. El fichero entregado afirmaba de más y se vuelve a entregar corregido.
- **El análisis del circuito suponía que la exportación era un solo circuito.** Ahora lo mide con el
  detector de aristas exclusivas y lo imprime —1 circuito de 54 vehículos—, y se detiene si sale más
  de uno: reconstruir un anillo sobre dos flotas produce un circuito que no existe (R-DAT-012).

### Documentado

- `DATA_CONTRACTS.md` §5.1: la forma del recuento, por qué se cuenta por vehículo y qué pasa si se
  confunde con el del fichero.

## [1.6.0] - 2026-09-17

Los cruces son una **clase de función** de los tags críticos, no un concepto paralelo, y el
propietario cierra la lista: parada precisa, cruce, semáforo, dejar/recoger carro, cambio de mapa
importante y bifurcación. Buscar la firma de cada clase en el dato destapó de paso que la prueba de
R-AGV-009 estaba mal, y que con ella el software habría inventado averías.

### Corregido

- **Una transición que ningún vecino hace no demuestra una salida: demuestra que se dejó de leer.**
  Era el único criterio de R-AGV-009 y es insuficiente: un vehículo que recorre su línea sin
  registrar catorce tags reaparece dando un salto que nadie más da, sin haberse movido. Se añade
  **R-AGV-012** con la prueba de dos partes —¿se alcanza el tag de reanudación siguiendo la línea?,
  y si se alcanza, ¿excedió el tiempo que tarda el cohorte por ese tramo medido de extremo a
  extremo?—, y la comparación va contra ese recorrido medido, nunca contra la suma de medianas de
  cada arista: donde la carga se hace en ruta, un tramo con parada de trabajo tiene una dispersión
  tal que cualquier umbral sobre la suma dispara solo.
- **Aplicada la prueba, las dos «salidas» que se habían presentado como fallo de cruce desaparecen.**
  Las dos caen dentro del rango de recorrido de sus vecinos por ese mismo tramo. Lo que el vehículo
  tiene son cuatro tramos recorridos sin leer, cuarenta tags, frente a cero o catorce de sus trece
  compañeros: sigue siendo el anómalo de la exportación, pero por lectura y no por trayecto.
- **La hipótesis del par de protección queda retirada** (OQ-121). Se apoyaba en esas dos salidas, y
  sin ellas no tiene nada detrás. La sustituye una evidencia distinta: los cinco tags donde dos
  circuitos siguen por sitios distintos llevan **todos** un tag acompañante leído pegado en 61 a 98
  pasadas. Es la forma de un par en un punto; cuál protege qué giro sigue siendo dato de planta.
- **`crossings` deja de ser un bloque suelto.** Pasa a ser `function: cruce` dentro de
  `critical_points`, con los campos que esa función exige. Un cruce es un tag crítico, no otra cosa.
- Releer el mismo tag dejaba de contar como quedarse quieto y salía como salida del circuito.

### Añadido

- **R-DAT-013**: dos lecturas de un mismo vehículo **en el mismo instante no ordenan nada**. Su
  orden es posición de pila, no medida del reloj, así que es `inferred` (ADR-0013) y una arista
  construida sobre ellas no sostiene topología: aparecen las dos direcciones y la minoritaria simula
  un desvío que nunca ocurrió. Dos tags que se leen así de forma habitual son **un punto, no dos**.
  Medido: 2,9 % y 3,3 % de las transiciones de dos exportaciones reales, y 3 de las 164 aristas que
  un circuito reconstruido declaraba `observed` se apoyan en una de ellas.
- **R-GRA-007**: qué es un tag crítico y cuáles son sus seis clases de función. La función es dato
  de planta declarado; el fichero solo deja firmas que sirven para **proponer candidatos**. Dos
  clases no dejan ninguna y se declaran como tales: un cambio de mapa es indistinguible de un tag
  cualquiera, y un cruce que nadie ha fallado y que recorre un solo circuito tampoco, porque un
  cruce existe justamente para que todos pasen igual.
- **R-GRA-008**: un tag crítico no leído **no equivale** a un tag ordinario no leído. En el
  ordinario la omisión degrada la reconstrucción; en el crítico se pierde la función que sostenía.
  Se cuentan por separado, porque una tasa que los promedie oculta lo que hay que ver.
- `CONFIG_SCHEMA.md` §3.4.1 con la forma de `critical_points` y de los campos propios de `cruce`.
- **OQ-122**: qué tags son críticos y de qué clase, con los candidatos por firma pendientes de que
  el propietario los confirme o los complete.

### Cambiado

- `ALGORITHM_CATALOG.md`: el sexto discriminante pasa de un criterio a dos, con la medida de lo que
  cambia entre aplicar uno o los dos.
- OQ-119 se reformula por segunda vez: ya no es «qué cruce falló», porque no queda ninguna salida
  que sostener. Lo que queda abierto es la ceguera por tramos, y una cola de 234 min al final de la
  ventana que no reanuda dentro de ella y por tanto no es contrastable.

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
