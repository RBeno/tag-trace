---
document_id: TT-UX-001
version: 0.36.0
status: baseline-candidate
last_updated: 2026-09-26
---

# Especificación de experiencia de usuario

## 1. Principio de información

Cada vista sigue tres niveles:

1. **Conclusión:** qué ocurre, gravedad, confianza y cambio.
2. **Evidencia:** por qué se concluye, alternativas y comprobaciones.
3. **Bruto:** fuentes, filas y valores originales cuando estén disponibles.

La interfaz no debe obligar a revisar AGV por AGV para descubrir un patrón colectivo.

## 2. Arquitectura de navegación

**Pestañas por pregunta, no por cálculo (3.48.0).** Medido con el circuito sintético de auditoría,
la página era una sola lista de cuarenta y tres secciones en el orden en que se calculan: 36.646 px
de alto sin abrir nada, sin índice, y «Lo que hay que mirar» era la sección 22. Ahora una barra fija
bajo la cabecera (`nav` con `role="tablist"`, botones `role="tab"` con `aria-selected`, flechas de
teclado; en el móvil, fichas desplazables en horizontal de 44 px con dedo) reparte el análisis en
seis pestañas. La activa va en el `hash` de la URL (`#tags`, `#agv`…) y se restaura al recargar; por
defecto, Resumen. Cada pestaña es un `section[role="tabpanel"]`.

| Pestaña | Qué contiene |
|---|---|
| **Resumen** | La **portada** (3.49.0): la tira de seis cifras —AGV en el circuito, tags en el anillo, cobertura, hallazgos, vuelta y línea—, la composición del circuito («1 circuito de 40 vehículos y 145 tags en el anillo»), el **anillo con capas** (§4.2) y la **bandeja de hallazgos** (§4.5) con el panel de la revisión en campo: recuento, filtros y exportación. |
| **Tags** | Inventario de tags; «Lo que hay que mirar» (tags); rotura y degradación de cada tag; mapa de omisión; cambios de tag; tags leídos fuera de la lista; limpieza de la lista; contraste contra Vsystem; orden del circuito según las lecturas; comparación entre dos periodos. |
| **AGV** | Flota del circuito, flota en el circuito y vida de cada AGV (con las paradas de la producción y los primeros de cola); lectura de cada AGV (la parte por AGV de «Lo que hay que mirar») y rotura y degradación de cada AGV; ritmo de cada AGV y quién retiene; y el **expediente** de un AGV o tag. El buscador del expediente vive fijo en la barra de navegación: buscar activa esta pestaña y enseña el resultado al final. |
| **Tiempos** | Estado normal del circuito (cuellos de botella, puntos conflictivos, zonas oscuras, paradas sin explicación, lecturas que llegaron juntas —por AGV y por sitio, porque nacen de la misma medida—, la noche, la horquilla de cada tramo y sus cambios); tiempos por sección entre anclas; mediciones por fichero con el anillo en tiempo; candidatos a punto crítico (tags donde el recorrido se divide, tiempo de parada); el anillo del circuito en palabras, con el enlace al dibujo del Resumen, su lista ordenada y los tags fuera del anillo. |
| **Línea y calles** | Alimentación de la línea; incidencias y sus mediciones; AGV que dejan de leer; calles de carga y ocupación de las calles; orden de paso en zona cargada (FIFO). |
| **Datos** | Listas del circuito; copia del circuito; fuente y lo acumulado (resumen de carga); cobertura cargada; perfil horario; actividad por vehículo; replay; lecturas. |

Lo que se ve en todas las pestañas: la cabecera, la barra de pestañas con el buscador, la barra fija
de la revisión (§4.3), el selector de lecturas con el nombre del circuito, el progreso y los
mensajes. Son la entrada y la respuesta de cada importación, y no dependen de la pregunta.

**La tira de cifras** (`div.tiles`, `role="list"`, un `button` por tile): cifra grande en la misma sans
que todo lo demás y en cifras proporcionales —nunca `tabular-nums`, que a ese tamaño deja «121»
suelto—, una etiqueta corta encima y la línea de contexto debajo. Tinta normal, sin color de serie;
solo el tile de hallazgos lleva el acento en la cifra, y solo mientras quede algún hallazgo de rango 1
pendiente. Cada tile activa la pestaña que lo explica y desplaza hasta su encabezado. Dos columnas en
el móvil, tres en tableta y seis en una fila desde 1.100 px, con alto uniforme y sin gráfico dentro.
De dónde sale cada cifra, y qué dice cuando el dato no existe (siempre «sin datos» en gris, nunca un
cero inventado):

| Tile | Cifra | Contexto | Lleva a |
|---|---|---|---|
| AGV en el circuito | «N de M» del **último tramo** de `fleet.counts` (el más reciente: es lo que se pregunta al abrir; la ventana entera está en «Flota en el circuito») | «según el historial de flota» o «vistos en las lecturas», por `historySource` | AGV, «Flota del circuito» |
| Tags en el anillo | `shapes[0].tags.length` | «N fuera del anillo, M declarados sin lecturas» (`offRingTags`, `circuitOrder.summary`) | Tags, «Lo que hay que mirar» |
| Cobertura | horas cargadas (suma de los tramos de cobertura, R-DAT-007) | «N ficheros, de <primera> a <última>» | Datos, «Cobertura cargada» |
| Hallazgos | pendientes de total, contando las tarjetas de la bandeja; se rehace con cada marca | «N pueden parar la planta» (rango 1 pendientes) o «revisión completa» | la bandeja del Resumen |
| Vuelta | la vuelta mediana (`lapMs`) del **último fichero medido**, la misma que «Mediciones por fichero» enseña como «Vuelta» | «fichero X; el anterior, Y min» | Tiempos, «Mediciones por fichero» |
| Línea | paradas de la línea en producción (`lineFeed.stops`) | «X min sin paso; un AGV cada Y s de mediana» (`rhythm` de producción: `aboveFenceMs`, `cycleMs`); sin lista `linea`, «sin línea declarada» | Línea y calles, «Alimentación de la línea» |

**Las seis se construyen al llegar las vistas**, cada una en su pestaña oculta, y se rehacen enteras
en cada importación. Lo que se pretendía con construirlas a demanda —que un `canvas` oculto no mida
su ancho— ya lo resuelve cada gráfico por su cuenta: mide con `ResizeObserver` y se dibuja la primera
vez que su pestaña se enseña. Y la bandeja del Resumen necesita todas las tarjetas, que nacen dentro
de la sección que las explica: construirlas dos veces costaría el doble para enseñar lo mismo.

Áreas previstas que todavía no existen en el producto y que irán a su pestaña cuando lleguen:
gestor de circuitos y preparación del análisis (Datos), comparador y consolidación (Resumen, F4),
incidencias con casos similares y contramedidas (Línea y calles), configuración (Datos).

## 3. Flujo de análisis

1. Seleccionar circuito.
2. Añadir archivos por botón, selector o arrastrar y soltar.
3. Revisar muestra, esquema, delimitador, fecha y columnas.
4. Ver calidad, solapes, periodo y afinidad de circuito.
5. Configurar el contexto o elegir una versión vigente.
6. Iniciar análisis con progreso por etapa y posibilidad de cancelar.
7. Ver resumen priorizado y navegar a evidencia.
8. Decidir: análisis temporal sin memoria, crear incidencia o revisar para consolidar.

## 4. Presentación de hallazgos

Cada tarjeta de hallazgo muestra:

- conclusión en lenguaje operativo;
- objeto y periodo afectados;
- severidad/impacto;
- confianza independiente;
- tipo: individual, grupal, colectivo o desconocido;
- cambio respecto al esperado;
- evidencia a favor y en contra;
- causas alternativas;
- acción de comprobación;
- acceso a grafo, timeline y filas.

El color nunca será el único medio de distinguir estados.

## 4.1 Expediente de un AGV o de un tag

Se entra escribiendo un identificador. Es la vía de trabajo más frecuente —«qué le pasa al 3524»,
«quién ha dejado de leer el 58021»— y debe resolverse sin recorrer AGV por AGV.

Ambos expedientes comparten estructura, y cada bloque dice también **qué no se sabe**:

| Bloque | AGV | Tag |
|---|---|---|
| Actividad | Lecturas en el periodo frente a su cohorte, no frente a la flota entera | AGV que lo leyeron frente a los que pasaron por su tramo |
| Inactividad | Periodos de silencio clasificados, su instante de cambio y **cómo reapareció** | Desde cuándo dejó de leerlo cada AGV |
| Ausencias | Tags con oportunidad elegible no materializada | Pasos en los que no fue leído, y por quién |
| Contraparte | Qué hicieron los demás durante sus silencios | Qué AGV siguen leyéndolo con normalidad |
| Cobertura | Qué periodo está cargado y cuál no | Igual |

Reglas de presentación:

- La comparación es **contra la cohorte**, no contra la flota: modelos distintos de AGV o de lector
  pueden diferir sin que ninguno esté degradado (R-AGV-004).
- Las ausencias salen del modelo de oportunidades, nunca de restar el catálogo del circuito a lo
  leído (R-OPP-008). Una rama que ese AGV no recorre no es una ausencia.
- Un silencio se presenta con sus hipótesis ordenadas y su evidencia; nunca como una causa única.
  Inactividad y fallo de comunicación producen el mismo dato (R-AGV-006) y la interfaz debe decirlo
  en lugar de elegir por el usuario.
- Un silencio se muestra con sus dos extremos: cómo se fue y cómo volvió. La reaparición es parte
  de la evidencia, no un detalle: es lo que distingue una parada en carga de una avería.
- Los periodos sin cobertura se dibujan distintos de los silencios, y nunca degradan ninguna cifra.
- Desde cualquier cifra se llega a la evidencia y de ahí a las filas de origen.

En F2 el expediente existe con recuentos, inactividad, última lectura conocida e instante de cambio,
y **sin tasa de salud**: sin oportunidades no hay denominador legítimo. F3 lo completa.

**Orden de la página, medido y corregido (2026-09-20).** El expediente se coloca inmediatamente
después del resumen del circuito, por delante de las vistas agregadas. No es una preferencia: con un
circuito real de 54 vehículos, el expediente quedaba a 3.569 px del principio en pantalla de móvil
—cuatro pantallas y media de desplazamiento— detrás de unos agregados que se consultan de vez en
cuando. La vía de trabajo más frecuente no puede ser la que más cuesta alcanzar.

**Lo que se muestra antes de la primera lectura de un objeto.** Ni posición inventada ni silencio:
`sin datos`, diciendo cuándo llega esa primera lectura (R-GRA-010). Un silencio afirma que una
posición conocida deja de confirmarse; antes de la primera lectura no hay ninguna.

## 4.2 Destacados primero, conjunto completo a demanda

Un circuito real son ciento cincuenta tags por cincuenta vehículos: siete mil quinientas celdas.
Enseñarlas de golpe no es informar, es esconder el hallazgo dentro de una cuadrícula. La vista se
ordena al revés de como se calcula:

1. **Cuántos vehículos y cuántos tags** forman el circuito, en una línea, en el Resumen. El número
   de tags sale del ciclo dominante, no de contar identificadores distintos.
2. **Lo que hay que mirar**: los tags con patrón destacable (pestaña Tags) y los vehículos que
   concentran tags sin leer (pestaña AGV, «Lectura de cada AGV»), cada uno como **tarjeta de
   hallazgo** (§4) y no como fila de tabla. La razón es medible: en 360 px una tabla de cinco
   columnas parte los encabezados letra a letra — cabe y es ilegible. Desde 3.48.0 las tarjetas
   revisables viven en la bandeja del Resumen (§4.5) y la sección conserva su contexto con la línea
   «N hallazgos de esta sección: ver en Resumen»; las tarjetas gemelas se agrupan (§4.3).
3. **El conjunto completo**, a demanda en el **cajón de tablas** (§5.3): el anillo en orden (en
   Tiempos), los tags fuera del anillo y la matriz entera. Se construye **solo al abrirlo**; dejarlo
   montado de entrada para tenerlo escondido paga el coste sin enseñar nada.

**El anillo con capas (3.49.0).** El anillo radial vive en la portada del Resumen, entre la tira de
cifras y la bandeja, y lleva encima un selector segmentado (`.seg`, `role="radiogroup"`, botones
`role="radio"` con `aria-checked`, flechas de teclado) de cuatro **capas exclusivas** que cambian solo
lo que pinta la banda principal; la banda exterior de zona y las marcas numeradas de críticos se
quedan siempre:

| Capa | La banda principal | Leyenda |
|---|---|---|
| **Omisión** (por defecto) | la de siempre: gris lo normal, la rampa azul lo que se deja de leer, trama sin pasadas, tinta el ancla; el tramo declarado en la banda fina interior | las cinco clases de omisión |
| **Tramos** | el tramo declarado (`section`) con la paleta `--viz-tramo-*`; gris sin tramo | un color por tramo |
| **Paradas** | cuántas incidencias toca cada tag según el estado normal (`circuitState`): paradas sin explicación que empiezan en él, colas de un cuello de botella, y una más si está en una zona oscura; punto conflictivo se dice en la lectura (sus paradas ya son paradas sin explicación). Rampa de un solo tono por recuento | los cortes de la rampa: ninguna, 1, 2, 3–4, 5–9, 10 o más |
| **Calles** | el tag del que cuelga cada calle (`laneJunctions`) en el azul de serie, con el nombre de la calle junto a su ramal; con trama si nadie entró en ella; gris sin calle | servida, sin servicio, sin calle |

La lectura al puntero y al foco dice lo de la capa activa además del tag. **Tocar un tag** —clic,
dedo, o Enter con el foco de teclado sobre su segmento (un solo alto de tabulación para el anillo,
las flechas lo recorren)— abre su expediente: rellena el buscador de la barra y activa AGV, la misma
vía que escribirlo. Cada segmento es un botón, así que con el dedo el navegador ajusta el toque al
segmento más cercano: tocar cerca de un tag también lo abre; leer sin abrir es cosa del puntero, del
foco y de las marcas y calles, que no son botones. Nada de esto calcula: todo sale de las vistas que
ya llegan. En Tiempos queda «El anillo está en Resumen», con su lista ordenada y los tags fuera del
anillo.

Dos cosas que la vista dice siempre, porque el número solo no las lleva escritas:

- el porcentaje es **sobre las pasadas probadas** por ese punto, no sobre las vueltas (R-OPP-013);
- **no es una tasa de salud**, y no lo será mientras no exista la oportunidad elegible de R-OPP-011.

Una matriz es bidimensional por naturaleza, así que se desplaza **dentro de su caja**. Eso no
contradice la regla de §5.1 —ningún gráfico exige desplazamiento para llegar a su contenido útil—
porque el contenido útil ya está arriba, sin desplegar nada.

## 4.3 Revisión en campo

Para ir a los puntos conflictivos con el móvil y dejar constancia de lo que se vio. Cada tarjeta de
hallazgo lleva **un solo control de revisión**: un botón que enseña el icono y el estado actual
(«○ Pendiente ▾») y abre un menú (`role="menu"`, elementos `menuitemradio`) con los cuatro estados
—**○ Pendiente · ✓ Confirmado · ✕ Descartado · » Pospuesto**— y el campo de nota. Los avisos de
configuración no lo llevan, porque no se comprueban en campo.

- **Se guarda sola** en el dispositivo al elegir un estado, y sigue ahí al recargar la página o al
  cargar otra extracción: la marca va con el tipo y el sujeto del hallazgo, no con su texto
  (R-EVI-007). Elegir un estado deja el menú abierto para escribir la nota; se cierra con Escape,
  tocando fuera o con el propio botón.
- **El sujeto de un grupo es su conjunto.** Cuando varias tarjetas de tag comparten exactamente el
  mismo conjunto de AGV que no los leen nunca, sale **una** tarjeta —«60180 y 60183 (posiciones
  59–60 de 145): 5 AGV no los leen nunca»— con los AGV y sus cifras dentro (cuatro y «y N más», la
  tabla al tocar), y las tarjetas de AGV «no lee nunca 2 tags que el resto sí lee» de esos mismos AGV
  se pliegan en ella. Su clave de revisión es el tipo más el conjunto ordenado de tags
  (`tag-lectura|60180|60183`), distinta de la de cada tag suelto. El mismo criterio se aplica a los
  AGV que no leen nunca los mismos tags sin tarjeta de grupo (`agv-nunca|7100|7108|7116`) y a los
  que dejaron y no adoptaron los mismos tags entre dos periodos (`deriva-agv|…`): una tarjeta
  idéntica salvo el sujeto no es un hecho distinto (3.48.0).
- **El estado se ve por tres canales**: el borde de la tarjeta (acento si está confirmado, gris si
  está descartado, discontinuo si está pospuesto), el botón con su icono y su texto, y el elemento
  marcado del menú. Nunca solo por color. El botón y cada estado del menú miden 40 px, y 44 con
  dedo, por encima de los 24 px de WCAG 2.2, porque se usa de pie; en 390 px caben en una fila con
  el enlace «Ver evidencia». Con teclado: flecha abajo abre el menú en el estado actual, las flechas
  mueven, Enter elige y Escape cierra y devuelve el foco al botón.
- **Una barra fija arriba**, justo debajo de la barra de pestañas y en todas ellas, dice cuánto va
  revisado («Revisados 12 de 40») con su barra de progreso, y lleva el botón **Siguiente pendiente**,
  que activa el Resumen y deja el foco en el control de la tarjeta. Es compacta a propósito: en el
  móvil, todo lo demás fijo taparía media pantalla. Las alturas medidas de las dos barras se escriben
  en variables CSS (`--tabs-height`, `--review-bar-height`) y todo lo que puede ser destino de un
  salto —encabezados, figuras, tarjetas, desplegables— lleva ese `scroll-margin-top`, así que un
  `scrollIntoView`, «Siguiente pendiente» o «Ver evidencia» nunca dejan el título debajo de ellas.
- **En el Resumen, junto a la bandeja y sin quedarse fijo**: el recuento por estado, los filtros
  (todos, pendientes, confirmados, descartados, pospuestos; solo esconden tarjetas, nunca gráficos) y
  **Exportar revisión (CSV)**, con los pendientes incluidos, que son la lista de lo que falta.
- **Si la cifra de un hallazgo cambió desde que se marcó**, la tarjeta lo dice con la cifra de
  entonces: una confirmación sobre datos distintos no es la misma confirmación.
- **Una marca cuyo hallazgo ya no aparece** no se borra: se cuenta aparte y va en el CSV.
- La revisión viaja en el `.agvproj` exportado.

Lo que no hace: consolidar. Revisar es el paso «Revisión de hallazgos» del flujo de
`MEMORY_CONSOLIDATION.md` §6; escribir esa revisión como versión nueva de la memoria del circuito es
F4.

## 4.4 Lenguaje de la interfaz

La pantalla habla como un producto terminado, no como el proyecto que lo construye:

- **Sin referencias internas.** Ningún texto visible cita reglas (`R-…`), preguntas abiertas
  (`OQ-…`), casos de prueba ni fases. Esas referencias viven en la documentación y en el código.
- **Sin identificadores internos.** Los valores con los que trabaja el dominio (`observed`,
  `bimodal-candidato`, `obsoleto-candidato`, `vinculacion`…) se enseñan con su nombre en castellano
  llano (`observado`, «unos AGV sí y otros no», «posible obsoleto», «vinculación»). La traducción
  está en un solo sitio, `src/presentation/labels.ts`; lo que se guarda, se exporta y se prueba
  sigue usando el identificador estable. Los nombres de lista (`circuito`, `critico`,
  `carga-online`…) sí se enseñan tal cual, porque son los que el usuario escribe en su CSV.
- **Lo técnico, plegado.** Los detalles de lectura de un fichero (hash, separador, columnas,
  formato de fecha, zona, codificación, orden, tiempo de proceso) van en un desplegable; a la vista
  quedan el fichero, el periodo y cuántas filas entraron o no.
- **Frases cortas y la duda a la vista.** Cada hallazgo dice qué se ve y qué comprobar; los límites
  que cambian la lectura («no es una tasa de salud», «fuera de la cobertura no hay datos, no
  silencio», «posible…») se conservan, en una frase, porque son lo que evita una conclusión falsa.
- **Singular y plural reales**, nunca «tag(s)».

## 4.5 Bandeja de hallazgos

Todas las tarjetas de hallazgo con clave de revisión viven en **una sola lista en el Resumen**, no
repartidas por las secciones donde se calculan (3.48.0). Es la unidad de revisión (R-EVI-007), y hay
**una sola copia** de cada tarjeta: en su sección queda una línea compacta «N hallazgos de esta
sección: ver en Resumen», que activa el Resumen y filtra por el tema de la sección. Cada tarjeta
lleva encima su tema y su tipo («Tiempos · cuello de botella») y el enlace **Ver evidencia**, que
activa la pestaña de su sección y desplaza hasta su encabezado. Los avisos de configuración
(«Configuración que no se pudo usar», «Corte de vuelta declarado que no se pudo usar»…) no tienen
clave y se quedan en su sección.

La lista va **ordenada por rango y, dentro del rango, agrupada por tema** en el orden Tags, AGV,
Tiempos, Línea y calles, y dentro del tema en el orden en que la vista los produce. Los filtros son
fichas: por tema (todos, Tags, AGV, Tiempos, Línea y calles) y los de estado de revisión de §4.3;
un rango que se queda sin tarjetas visibles se esconde entero.

El catálogo vive en `src/presentation/labels.ts` (`FINDING_KINDS`), por el primer elemento de la
clave de revisión. El tema es el de la pregunta que responde el hallazgo, no la sección donde se
calcula («Ver evidencia» lleva a la sección; el tema es lo que se filtra):

| Rango | Qué es | Tipos (tema) |
|---|---|---|
| **1** | Puede parar la planta o perder una función | `bloqueo`, `cuello-de-botella`, `punto-conflictivo`, `produccion-parada` (Tiempos); `tag-rotura` (Tags); `agv-rotura`, `deja-de-leer` (AGV); `calle-sin-servicio`, `linea`, `linea-paso` (Línea y calles) |
| **2** | Degrada el circuito | `zona-oscura`, `parada-sin-explicacion`, `entrega-agrupada-sitio`, `cambio-de-horquilla`, `tramo-entre-ficheros`, `estructura-entre-ficheros` (Tiempos); `tag-lectura`, `tag-deja`, `tag-empieza`, `tag-degradacion`, `cambio-tag`, `estructura` (Tags); `agv-nunca`, `agv-desde`, `agv-poco`, `agv-degradacion`, `ritmo-agv`, `retiene-agv`, `entrega-agrupada-agv`, `flota-sin-lecturas`, `flota-sin-asignar` (AGV); `calle-lectura`, `calle-espera`, `calle-permanencia`, `sin-carga`, `fifo` (Línea y calles) |
| **3** | Limpieza y contexto | `deriva`, `tag-fuera-del-circuito` (Tags); `deriva-agv` (AGV); `punto-critico` (Tiempos); `calle-uso`, `arranque-en-frio` (Línea y calles) |

Un tipo que no esté en el catálogo va a contexto y se enseña con su identificador: antes que
esconderlo.

## 5. Grafo y plano

- Alternar capas: Vsystem, observado del periodo, validado y divergencias.
- Mantener forma física y orden topológico como conceptos distintos.
- Mostrar soporte y confianza de aristas.
- Seleccionar un tag/tramo para ver AGV, vueltas, tiempos y cambios.
- Filtrar sin recalcular el análisis completo.
- Degradar detalle de forma progresiva en móvil.

## 5.1 Vistas de periodo y de circuito

Cuatro representaciones probadas contra una exportación real. Ninguna diagnostica: **dibujan solo lo
observado**. Cada una lleva escrito su propio límite, porque un gráfico que no dice lo que no sabe
convence más de lo que debería.

| Vista | Qué responde | El límite, escrito en la propia vista |
|---|---|---|
| **Banda de actividad**, vehículo × tiempo | dónde hay lecturas y dónde no | un hueco es **ausencia de lecturas**, no una parada demostrada |
| **Pista de eventos**, alineada bajo cada vehículo | qué evento cae en ese instante | los eventos se agrupan por la **palabra del catálogo**, no por su significado (OQ-111) |
| **Perfil horario** | el régimen de actividad que da contexto a un silencio | las horas de los bordes están **cortadas** y no se comparan con una hora entera |
| **Tira del circuito** y **ranking de omisión** | la secuencia, y a cuáles mirar | el eje es orden topológico, **nunca distancia**: el dato no tiene geometría |

Reglas que se derivan de haberlas dibujado:

- **La ausencia necesita un fondo.** Sin un carril continuo detrás de cada vehículo, un hueco se
  confunde con el papel, y el hueco es justo lo que hay que ver.
- **Secuencia y magnitud son dos gráficos.** «Quién va después de quién» y «a cuáles mirar» son
  preguntas distintas; juntarlas en un eje deja lo importante fuera de la pantalla.
- **Ningún gráfico exige desplazamiento horizontal para llegar a su contenido útil.** Lo que hay
  que ir a buscar no se lee.
- Una clase de evento ocupa además **una altura propia** dentro de su banda: el color nunca es el
  único canal (§4), y aquí hay cuatro clases sobre un fondo denso.
- Toda vista con color tiene su **equivalente en tabla**, que es a la vez la vía accesible y el
  respaldo cuando el color falla.

**Estas vistas se generan y se miran en local.** Contienen identificadores y fechas de planta, así
que no se publican ni se alojan (ADR-0007, ADR-0014); lo que puede vivir en el repositorio es la
misma vista contra un fixture sintético.

## 5.2 Las que ya están en el producto

Cuatro, dibujadas en SVG propio y sin ninguna dependencia (ADR-0014). Dos venían de §5.1 y dos son
nuevas, porque al construirlas quedó claro que faltaban:

| Vista | Qué responde | Su límite, escrito al lado |
|---|---|---|
| **Cobertura cargada** | qué periodo se puede analizar | lo que queda fuera no es un silencio: no hay datos (R-DAT-007) |
| **Perfil horario** | el régimen de actividad que da contexto a un silencio | un valle **no es una parada**: distinguirlo exige el calendario (OQ-108) |
| **Actividad por vehículo** | quién lee, cuándo, y quién no aparece | una celda vacía **dentro** de cobertura es ausencia de lecturas, no avería |
| **Inventario de tags** | qué declara cada lista frente a lo observado | ninguna clase es un diagnóstico; la última columna dice qué hay que valorar |

### 5.2.1 Calles de carga online

Mismo criterio que la matriz de lectura: **lo notable de entrada y el conjunto plegado**. Lo que
aparece sin desplegar nada es una calle por la que no pasó nadie, la espera más larga de cada calle,
una permanencia muy por encima de la mediana de la suya, los vehículos que ya estaban dentro cuando
empezó la ventana, y cualquier calle declarada que no se haya podido montar. Lo que **no** aparece
son las cargas normales: son casi todas, y enseñarlas es esconder lo otro.

Tres límites que se escriben junto a las cifras, no en una nota al pie:

- Una permanencia larga se mide **contra la mediana de su propia calle**, no contra un minutaje: el
  tiempo de carga depende de la calle y de cuánto haya que cargar (R-FLO-004). Con pocas estancias
  no hay mediana, y entonces no se señala ninguna.
- Una espera fuera de antigüedad **no es una avería**. Dos vehículos cargando a la vez con
  duraciones distintas invierten el orden de salida con toda normalidad, así que las esperas se
  enumeran ordenadas por su magnitud y la conclusión la pone una persona (R-CO-003, R-FLO-001).
- Una calle **sin servicio** no dice nada de sus tags: dice que no hubo ocasión de leerlos. La
  pregunta que se enseña apunta a la calle (R-CO-008).

Y una que se dice por omisión deliberada: mientras la calle no esté declarada, sus paradas siguen
apareciendo como silencios. Es la degradación que R-CO-006 exige, y la vista lo advierte en lugar
de aproximar la calle por proximidad.

Y los vehículos que **no entraron en ninguna calle** en toda la ventana, con su primera y última
lectura y el tiempo que estuvieron presentes. Se enseñan de entrada, con lo que no significa escrito
al lado: pueden cargar en una calle no declarada o haber estado poco tiempo en la ventana, y sin SOC
no se juzga su batería (R-CO-004). Un arranque en frío sí cuenta como entrada (R-CO-007).

### 5.2.2 Rotura súbita y degradación progresiva (R-OPP-015)

Junto a los destacados de la matriz de lectura, no en una sección aparte: son exactamente el tipo de
caso que esos destacados ya priorizan. Dos hallazgos, por tag y por AGV:

- **Rotura**: «se leía con normalidad y dejó de leerse» en un instante, con el antes y el después en
  porcentaje. El instante es el punto medio entre la última pasada de antes y la primera de después
  —no se puede precisar más—, y la vista lo dice así, no como si fuera exacto.
- **Degradación**: la tasa de cuatro tramos temporales, de peor a mejor por la izquierda, mostrando
  que la caída es sostenida y no una fluctuación aislada.

Un hallazgo de AGV **no se traslada a sus tags**: si el resto de la flota sigue leyéndolos con
normalidad, esos tags no aparecen aquí. Es la misma regla que ya rige los destacados de la matriz
—el objeto que falla es el que se señala, no todo lo que toca—, aplicada a una dimensión nueva, el
tiempo.

**La cobertura es nueva y era la que faltaba.** Sin ella, R-DAT-007 vivía en una frase de una lista
de datos y nadie la relacionaba con las cifras de al lado. Dibujada, el hueco entre dos
exportaciones se ve antes de que a nadie le dé tiempo a preguntarse por qué el circuito «se calló».

Dos decisiones de dibujo que conviene no deshacer:

- **La magnitud se codifica por claridad dentro de un solo tono**, no por matiz. Un daltónico ve
  exactamente lo mismo que los demás, y no hace falta una paleta categórica para un dato que es
  ordinal. La rampa está validada contra las dos superficies, clara y oscura, y el modo oscuro son
  los mismos tonos re-escalonados y no el claro invertido.
- **Ninguna clase del inventario lleva color de severidad.** Pintar `obsoleto-candidato` de rojo
  diría que es un problema, y todavía no lo es: es una pregunta para el técnico. El estado de verdad
  y la acción van escritos, que es donde no se pueden malinterpretar.

**Y una restricción técnica que solo aparece al mirar el render:** el texto de un SVG se escala con
su `viewBox`. Un lienzo mucho más ancho que el hueco donde se pinta encoge las etiquetas hasta que
se pisan, y ni los tipos ni las pruebas lo detectan. El lienzo se mantiene cerca del ancho real de
pintado.

## 5.3 Vistas de diagnóstico (Parte 38)

Diez vistas llevadas a la aplicación desde la galería de propuestas (Parte 37), elegidas por el
propietario. Ninguna calcula nada nuevo: dibujan lo que la matriz, las calles, el FIFO, los puntos
críticos y la deriva ya calculaban y hasta ahora solo se leía en tarjetas y tablas. Cada una va
**encima** de las tarjetas de su sección, que se quedan como vía accesible.

| Vista | Qué responde | Su límite, escrito al lado |
|---|---|---|
| **Anillo radial** | dónde se concentra la omisión, qué zona es cuál, dónde están los puntos críticos y de dónde cuelgan las calles | el ángulo es orden en el anillo, no distancia; relleno = declarado, hueco = candidato por firma |
| **Mapa de omisión tag × AGV** | si lo que falta es del tag (fila) o del vehículo (columna) | pinta lo que falta, no lo que se lee; «no pasó» lleva trama y no es 0 % (R-OPP-013) |
| **Rotura y degradación de cada tag / de cada AGV, en el tiempo** | la forma del cambio: escalón o rampa, y cuándo | mismo eje en todos los paneles; un tramo sin pasadas corta la línea, no la lleva a cero. Es la misma vista dos veces, una bajo «Cambios de tag» y otra bajo «Lo que hay que mirar»; cada una lleva en el título de qué va (3.47.0: antes compartían encabezado) |
| **Permanencia en los candidatos de tiempo** | parada precisa (estrecha y desplazada) y semáforo (dos grupos) frente a la referencia del cohorte | proporción de pasadas con el mismo eje; sin pares del mismo instante (R-DAT-013); firma, nunca función (R-GRA-007) |
| **Salidas de los tags con reparto** | cruce (las ramas vuelven a juntarse) o bifurcación (no) | el grosor es la cuota, con su soporte; el margen de saltos es configuración |
| **Ocupación de las calles de carga** | quién estuvo en cada calle y cuándo, la calle sin servicio, quién esperó de más; y las tres comprobaciones de planta (R-CO-009): la calle que se usa menos o más que las demás con su cuota, el tag de la calle que no se leyó en tantas de tantas estancias, y quién no entró a cargar | solo es barra lo que se sabe: una estancia sin entrada o sin salida es una marca en su extremo conocido; fuera de cobertura, trama (R-CO-007, R-DAT-007); el detalle plegado da la cuota de cada calle y qué se lee dentro de cada una |
| **Tiempos por sección entre anclas** | cuánto se tarda de un ancla a la siguiente —kitting, cruce, línea— por régimen, y cómo se mueve por fichero | tabla por sección y régimen con muestras, p50, p80, p95 y valla, en su caja desplazable; la columna de tags dice «48 tags, de 60000 a 60147» y la lista entera va en el detalle plegado junto al p50 por fichero (3.47.0: la lista en la tabla partía las cabeceras letra a letra); CSV; sin dos anclas en el anillo, una línea que dice qué declarar (R-TIM-012) |
| **Entrada y salida del tramo cargado** | un adelantamiento como una línea que cruza a las demás | candidato, no avería: OQ-107 sigue sin catálogo de excepciones (R-FLO-001) |
| **Deriva entre los dos periodos** | qué tag desapareció, apareció o se sustituyó, en lecturas | correlación de posición y tiempo, nunca confirmación física (R-DAT-017, R-EVI-004) |
| **Inventario** | cuánto hay que valorar frente a lo que no, y qué acción pide cada clase | sin color de severidad: «a valorar» es una pregunta, no un problema (§5.2) |
| **Expediente de un AGV en el tiempo** | cuándo lee, cuándo carga, cuándo calla y qué periodo está cargado | la carga es inferida; el silencio, causa desconocida; lo que cae fuera de la cobertura no se dibuja como silencio |

**Un solo cajón de tablas (3.49.0).** La tabla equivalente de cada gráfico y las listas largas de
cada sección («Ver los mismos datos en tabla», «Ver la horquilla de los 145 tramos», «Ver los N tags
del anillo», «Detalle de las N calles»…) ya no son desplegables `<details>` en la página: abrir uno
empujaba todo lo demás varias pantallas hacia abajo y, con dos o tres abiertos, la pestaña volvía a
ser la lista larga que las pestañas evitan. Ahora cada uno es un botón pequeño con icono de tabla y su
texto («Tabla» para «Ver los mismos datos en tabla», que queda como `aria-label` y `title`) que abre
**un único `aside.drawer`** para toda la aplicación (`src/presentation/drawer.ts`): `role="dialog"`,
`aria-modal="false"` —la página sigue visible y no se bloquea—, `aria-labelledby` con el título de la
tabla y debajo el de la figura o sección de donde viene, botón «Cerrar», Escape cierra, el foco entra
al abrir y vuelve al botón al cerrar. En escritorio ocupa el tercio derecho con desplazamiento propio;
en el móvil, la pantalla entera con la barra de cierre fija. El contenido se construye **al abrir**,
con la misma función perezosa de antes, y abrir otra tabla sustituye a la anterior. Solo quedan como
`<details>` los tres desplegables de texto corto: «Qué forma tiene que tener el fichero», «Qué forma
tiene que tener el historial» y «Detalles de lectura del fichero». La regla de §5.1 se mantiene:
ningún gráfico exige desplazamiento para llegar a su contenido útil, y la tabla del cajón se desplaza
dentro del cajón, no en la página.

Tres reglas nuevas, las tres aprendidas al mirar el render con el circuito de auditoría:

- **Se dibujan al ancho real** de su contenedor y se redibujan al cambiar, en lugar de escalar un
  lienzo fijo. Con un lienzo de 640 unidades en 360 px, un rótulo de 10 se lee a 5,6 px.
- **Una sola lectura al puntero por gráfico**, en una región viva, y nunca un `<title>` por marca. La
  matriz, que es la que más celdas tiene, es un único `canvas`.
- **Un extremo que no se ve no se inventa.** Una estancia cuya salida no consta no es una barra hasta
  el final de la ventana; es una marca en la entrada. Un silencio que cruza un hueco de cobertura se
  dibuja solo en la parte cubierta.

## 5.4 Flota del circuito (Parte 39)

Cuántos vehículos de los asignados están en funcionamiento en cada momento, y la vida entera de cada
uno en tramos continuos. Va justo después de la banda de actividad, que solo enseña a los que leen:
un asignado que no lee nada solo aparece aquí.

| Vista | Qué responde | Su límite, escrito al lado |
|---|---|---|
| **Flota en el circuito** | «de 10:00 a 10:15, 40 de 40 en el circuito, 2 leyendo», y los dos peores momentos: menos en el circuito y menos leyendo | tres escalonadas: asignados, en el circuito y, discontinua, leyendo; las paradas de la producción como bandas; fuera de la cobertura no se cuenta (trama); sin historial, M son los vistos (R-AGV-014, R-AGV-018) |
| **Vida de cada AGV en el circuito** | cuándo leía, cargaba, callaba, faltaba o no estaba asignado cada vehículo | una fila por AGV en un único `canvas`; leer sin estar asignado es media barra, distinta también por la forma (R-AGV-015) |

Cada tramo tiene su color y su leyenda. Los huecos sin carga se colorean por **cómo reapareció** el
AGV (R-AGV-017, Parte 45), con los colores que pidió el propietario:

- **leyendo** (azul) y **carga** inferida (violeta) cuentan como en funcionamiento. Un hueco que ese
  tramo tiene a menudo en ese turno —hasta tres veces su mediana— se dibuja leyendo: no es un hueco;
- **parado sin nada que lo explique** (azul oscuro liso): vuelve por el tag siguiente, o por el
  mismo, más tarde de lo habitual, sin nadie parado delante y con la producción en marcha;
- **parado, explicado** (el mismo azul con rayas del fondo): con la producción parada o en cola
  detrás de otro parado (R-AGV-018). Se distingue por la textura, no por otro color —con diez clases
  no quedan colores que separar a ojo—, y se aparta para que lo liso sea lo que hay que mirar;
- **el primero de una cola que no avanza**: azul oscuro con contorno de acento;
- **un tag más allá** (amarillo) y **dos o más** (naranja);
- **una hora o más sin leer, o vuelve en otro punto** (rojo apagado): también el rato sin lecturas
  de una hora o más al principio o al final de los datos;
- **por un tag de mantenimiento** (verde, con trama: frente al naranja, el color solo no basta para
  un daltónico);
- **falta de lecturas fuera del anillo inferido**: solo contorno;
- **asignado y sin leer, menos de una hora**: gris. En los bordes solo cuenta si pasa del umbral de
  silencio: unos minutos antes de la primera lectura son el ritmo normal;
- **fuera del circuito**: no asignado según el historial, casi del color del fondo;
- **leyendo sin asignar**: media barra, se cuenta aparte y nunca en N;
- **sin datos**: fuera de la cobertura, con trama (R-DAT-007).

Una franja arriba marca cuándo estuvo parada la producción. Al tocar un tramo, la lectura da los
hechos y qué hacía el resto: «7108 — parado: volvió por 60213, el siguiente a 60210; de 10:05 a 10:48
(43 min; lo habitual en ese tramo, turno 06–14: 40 s); nadie parado delante y la producción en
marcha», o «…; la producción estaba parada (ningún tag crítico leído)», o «…; en cola: el de delante
también estaba parado». Nunca «descanso» ni
«avería»: la causa la pone una persona (R-EVI-006). Los colores están validados para daltonismo en
los dos temas; el azul oscuro y el amarillo salen a propósito de la banda de claridad y nunca van
solos: siempre con la lectura y la tabla. **En el modo oscuro los tonos se re-escalonan**, no se
invierten: la parada sin explicar pasa a un azul acero claro (el marino no llegaba a 2,4:1 sobre el
fondo), la carga se afirma en violeta, y la media barra de «lee sin estar asignado» se dibuja sobre
el fondo de «fuera del circuito» para que no se lea como una raya negra (3.47.0; los ΔE están en
`styles.css`).

Se enseñan de entrada, sin causa: **las paradas de la producción** (cuándo, cuáles se repiten a la
misma hora otro día, si todos siguieron por su sitio y quién aparece delante de quien iba detrás),
**el primero de cada cola sin avanzar** con la producción en marcha (dónde, cuánto de más, cuántos
detrás y cuántas lecturas críticas mientras tanto), los asignados que no leyeron nada en toda la
ventana y los que leen sin estar asignados. La tabla equivalente del recuento son sus intervalos; la de la
vida de cada AGV, el porcentaje de su tiempo en cada estado y en cada clase de hueco, desplazable
dentro de su caja.

## 5.5 Cambios de tag y lectura por AGV (Parte 43)

Lo que más se va a ver en planta, destacado dentro de su sección y sin bloque de resumen arriba:

- **Cambios de tag**, justo después del inventario. Dentro del periodo cargado: la pareja «viejo →
  nuevo» con las dos horas, los que solo dejan de leerse o solo empiezan, y las caídas de lectura de
  la matriz con su gráfico. Bajo cada tag nuevo, los AGV que no lo leen como el resto con su cifra:
  «nunca (0 de 19 pasadas)», «desde las 17:40, 0 de 12», «empezó a leerlo a las 18:10, tras 9
  pasadas», «45 % (9 de 20)».
  Con la suma entre anclas (R-DAT-021): si el tramo entre dos anclas trae tags sin tarjeta propia —un
  bloque de dos o tres cambiados en mantenimiento, cuyos vecinos también cambiaron— o una sustitución
  que el sitio no emparejó, sale **una sola tarjeta** con la hora, «Entre P y Q: 3 sustituidos en su
  sitio», y quita las de esos tags. Si no, la tarjeta que ya existe gana una línea «Entre anclas: …»
  con qué es el tag y la suma antes y después. Con pocas pasadas del mismo régimen a los dos lados, la
  línea dice que la suma todavía no se puede comparar; los tags cambiados ya se ven. Las tarjetas de
  «Comparación entre dos periodos» ganan la misma línea, sin tarjeta nueva.
- **Lo que hay que mirar**: las tarjetas de tag separan quién no lo lee nunca, quién dejó de leerlo y
  quién lo lee poco, con porcentajes; las de AGV van por tipo —nunca, dejó de leer, poco en muchos
  tags, poco en pocos—, hasta cinco de cada uno y el resto en tabla.
- **Calles de carga**: lo primero de la sección son los AGV que no entraron en ninguna calle, «N de M».

Ninguna tarjeta nombra una causa (memoria, lector, colocación): la diferencia medida basta para ir a
mirarlo, y la causa la pone quien lo mira (R-EVI-006, R-AGV-016).

## 5.6 Estado normal del circuito (Parte 47)

Después de la composición del circuito, con su propio título. Arriba, una línea con cuánto tiempo
cargado es producción, cuánto noche y cuánto con la producción parada, y la advertencia de que todo
lo de la sección usa solo producción (R-TIM-009). Después, destacados primero:

- **Cuello de botella en X**: esperas detrás de un AGV que no avanzaba, en cuántas colas, la más
  larga, y si fluye o hubo bloqueos. Una cola que fluye no es una avería.
- **Punto conflictivo en X y Y**: paradas sin explicación de cuántos AGV, frente a lo que daría el
  azar. Si son de un solo AGV, el título lo dice así.
- **Zona oscura de X a Y**: el hueco entre lecturas frente al típico, y si falta información porque un
  tag se salta o porque el tramo tarda. Aparte, en una línea, los tramos lentos que explica una parada
  precisa o un semáforo.
- **AGV: tanto de más en X**: las paradas sin explicación que no son de un punto conflictivo, con
  quién iba delante y cuánto avanzó. «Qué lo paró no lo dice el dato.» Todas, en tabla plegada.
- **Lecturas que llegaron juntas** (R-DAT-020): una línea que dice que la hora del fichero es la de
  llegada al servidor y cuántas veces llegaron varias lecturas casi a la vez tras un hueco; después,
  tarjetas **«AGV: le llegan lecturas juntas»** y **«Lecturas juntas al pasar por X»** para lo que se
  concentra más de lo que da el azar, con la última ráfaga y si paró o no. Sin causa: «apunta a la
  comunicación». Todas, en tabla plegada. Sin evaluar con resolución de minuto, y se dice.
- **Ritmo de cada AGV** (R-AGV-019): «7122 va un 10 % más lento que la flota, en toda la línea» (o
  «solo en la zona X»), con la mitad de sus tramos frente a la de la flota y cuántos tramos; y **quién
  retiene a otros** (R-AGV-020): «7107 retiene a otros AGV», cuántas veces, a cuántos AGV distintos
  frente al azar, la espera sumada detrás y dónde. Sin causa. Si no hay nada, una línea que lo dice. El
  ritmo de todos, en tabla plegada.
- **La noche**, en una línea: qué tramos cambian la mitad o más y cuántas paradas sin explicación hubo
  medidas contra la horquilla de noche.
- **Horquilla de tiempos de cada tramo**: una barra por tramo del anillo, en su orden (no es
  distancia), de la mitad de las pasadas al 95 %, con una raya en la valla, una barra gris más fina
  para la noche y un punto de acento en los tramos con hallazgo; eje logarítmico. Lectura al tocar
  con p50, p80, p95, valla y noche; tabla plegada con los mismos datos.
- **Descargar horquillas (CSV)**: `desde;hasta;regimen;muestras;p50_s;p80_s;p95_s;valla_s`, con BOM.
  Es la forma en que se guarda hoy; consolidarla como referencia es F4.
- **Cambios de la horquilla** entre el primer y el último periodo cargados, cuando hay dos: más lento
  o más rápido, con la mitad de antes y la de ahora, siempre en el mismo régimen (R-TIM-010).

## 5.7 Mediciones por fichero (Parte 50)

Después de «Estado normal del circuito», con su propio título. Una franja es un fichero (R-TIM-011).

- Una línea con cuántos ficheros se miden y que las mediciones se rehacen en cada importación y se
  descargan en CSV; guardarlas como referencia es F4. Los repetidos, en una línea aparte.
- **Tabla de ficheros**, en una caja con desplazamiento: fichero, ventana, horas de producción y de
  noche, tags del anillo, vuelta y tramos medidos. Debajo, un botón **«Descargar «fichero» (CSV)»** por
  cada uno, con `desde;hasta;regimen;muestras;p50_s;p80_s;p95_s;valla_s;primera;ultima;posicion_desde_s`.
- **El anillo en tiempo, fichero a fichero**: una fila por fichero, cada tag como una raya en los
  segundos de recorrido desde el ancla; una línea gris es la vuelta entera. El pie dice que es tiempo
  y no distancia. Lectura al tocar con la posición del tag en cada fichero; tabla plegada con todas.
  Los cambios de estructura (R-DAT-021) se marcan con forma además de color: un triángulo para un tag
  nuevo, un rombo para el que sustituye y un aspa para el que ya no se lee. Entre ficheros, en la fila
  de antes y en la de después; dentro de un fichero, en su fila, con la hora en la lectura.
- **Tarjetas de los cambios de estructura entre ficheros**: «Entre P y Q: 3 sustituidos en su sitio (de
  «a» a «b»)», con la suma entre las dos anclas antes y después y, por tag, qué es y a cuántos segundos
  de P. Se dice con las palabras de la tabla del propietario: «tag nuevo en la línea», «tag nuevo que
  cambia el recorrido: revisar su configuración», «sustituido en su sitio», «se lee en otro punto»,
  «ya no se lee entre P y Q». Sin causas.
- **Ritmo de cada AGV en cada fichero** (R-AGV-019, R-AGV-020): una tabla, en su caja con
  desplazamiento, con los AGV que se apartan de la flota en algún fichero o retienen a otros, y su ritmo
  en cada fichero contra la horquilla de ese fichero. Un segundo botón por fichero, **«Descargar ritmo
  de «fichero» (CSV)»**, con `agv;muestras;ritmo;veredicto;retenciones;min_retenidos`.
- Con dos ficheros o más, las **tarjetas de los tramos que cambian** en producción (escalón desde un
  fichero, deriva, o cambio sin distinguir con dos) y la **historia de esos tramos** en pequeños
  múltiplos: el punto es la mitad de las pasadas y la barra del 80 % al 95 %, con acento en el fichero
  donde empieza el cambio. Con uno solo, una línea que dice que comparar necesita dos.

## 5.8 Libros de Excel para rellenar e importar

- El selector de lecturas acepta la exportación de Vsystem en `.xlsx`, además del CSV, con el aviso
  «Leyendo el libro de Excel» mientras la abre (`DATA_CONTRACTS.md` §3.8).
- Los dos selectores de «Listas del circuito» —listas de tags e historial de flota— aceptan el
  `.xlsx` tal cual, además del CSV. Un libro que no se puede leer se rechaza con su motivo y la salida:
  guardarlo de nuevo en Excel o exportarlo como CSV.
- **La aplicación no descarga libros.** Las plantillas y el circuito de cada análisis se entregan como
  ficheros (`DATA_CONTRACTS.md` §3.7); en la interfaz no hay botones de descarga de Excel
  (propietario, 2026-09-25).

## 5.9 Lo declarado en planta y los tags fuera de la lista (Parte 52)

- **Declarado en planta.** Cada tarjeta que nombra un tag concreto —lectura por tag, cambios de tag,
  deriva, puntos críticos, cuellos de botella, zonas oscuras, puntos conflictivos, paradas y el
  expediente del tag— añade una línea «Declarado en planta: …» con lo que las listas dicen de él: su
  nota tal cual, su función y su calle, sin repetir piezas. Es información para el diagnóstico y no
  cambia ningún cálculo (R-GRA-007).
- **Tags leídos fuera de la lista del circuito** (R-DAT-022), junto al contraste con Vsystem. Una
  tarjeta por tag, de las más leídas a las menos: «candidato a una posición», «tag de noche»,
  «tag de noche declarado» (en la lista `noche`) o «posiblemente de noche», con su sitio (entre qué tags y en qué orden de la lista), sus lecturas de
  día y de noche y las pasadas por su sitio en cada régimen. Sin lista del circuito no aparece.
- **Batería de mediciones** (R-AGV-021): cada tarjeta de parada sin explicación y de primero de cola
  sin avanzar lleva «Mediciones», una lista con la última lectura, la línea, el de delante, los de
  detrás y la lectura final. Aparte, «Incidencias y sus mediciones» con la descarga en CSV de todas, y
  «AGV que dejan de leer», una tarjeta por AGV con su batería y el cambio de AGV candidato.
- **Tramos en las gráficas del anillo** (R-GRA-018): el anillo, la horquilla de cada tramo y el anillo
  en tiempo pintan el tramo de cada tag (kitting, línea, cruce…) en una banda con un color categórico
  propio (`--viz-tramo-1…4`), distinto de los azules de la omisión y del naranja de los hallazgos, con
  su leyenda y en la lectura de cada punto.
- **Alimentación de la línea** (R-FLO-010), con la lista `linea` cargada:
  - una línea con la cadencia en la entrada y cuántas paradas fueron con AGV esperando y en cuántas le
    faltaron AGV;
  - una por régimen con el ritmo: el ciclo de mediana, entre qué valores anda y el tiempo sin paso,
    con AGV esperando y sin AGV;
  - otra con el pulmón medido: desde qué tag, cuántos AGV esperaban y los minutos con cada número de
    AGV en él;
  - una tarjeta por parada, primero las que le faltaron AGV, con el hueco y quien retiene;
  - los pasos por la línea (R-FLO-011): qué tags se esperan, lo habitual de la línea al siguiente tag
    y el mínimo entre dos AGV; los AGV que hacen la parada sin leer un tag; una tarjeta por paso que
    no sigue o que pasó sin la parada;
  - un botón «Descargar paradas de la línea (CSV)», con las paradas y los pasos señalados.
- **Limpieza de la lista del circuito** (R-GRA-017), detrás del orden según las lecturas:
  - una línea con cuántos declarados no están en el físico (y cuántos de ellos críticos), cuántos
    están en otra posición y cuántos refuerzos declarados están comprobados, incompletos o separados;
  - tres tablas desplegables;
  - un botón «Descargar la limpieza (CSV)» para llevarla a planta.
- En el contraste con Vsystem **manda lo leído** (R-GRA-015): la cabecera lo dice, y cada diferencia
  se lee como algo que corregir en la lista, no como un fallo del circuito. Un tag que la lista pone
  en otro sitio sale una sola vez, «la lista lo pone en otro sitio», con su sitio en cada lado; un
  declarado que no se lee donde se lee otro que la lista no tiene, «posible sustitución o número mal
  escrito».
- **Orden del circuito según las lecturas**, debajo del contraste: una línea con cuántos tags están en
  el orden de la lista, cuántos en otro sitio, cuántos sin lecturas (posición solo de la lista),
  cuántos leídos que la lista no tiene y cuántos fuera del recorrido; y, plegada, la tabla tag a tag
  con su posición en cada lado y lo declarado en planta. No hay descarga: la lista corregida se
  entrega como fichero.
- La tarjeta de un tag fuera de la lista dice su posición según las lecturas.

## 6. Consolidación

La pantalla muestra explícitamente:

- versión actual y propuesta;
- qué se añade, modifica, mantiene o excluye;
- impacto sobre grafo y perfiles;
- divergencias que se conservarán;
- incidencias excluidas;
- tamaño estimado antes/después;
- advertencias y preguntas pendientes.

El botón final usa una confirmación inequívoca. No existe consolidación automática ni deshacer destructivo; una corrección genera nueva versión/revocación.

## 7. Móvil, tableta y portátil

La misma aplicación se usa con el móvil, con una tableta y con un portátil, y con dedo, ratón o el
panel táctil del portátil. Todo tiene que poder hacerse con cualquiera de ellos:

- **Leer un gráfico.** Con ratón o panel táctil, la lectura sigue al puntero y se va al salir del
  gráfico. Con el dedo, **un toque fija la lectura y se queda** hasta el siguiente toque; tocar un
  hueco vuelve al texto de reposo. Arrastrar sigue desplazando la página, así que una matriz ancha se
  recorre igual. Los textos de reposo dicen «Toca o pasa el puntero…».
- **Imán de toque.** Un dedo no acierta una marca de 3 px: si el toque no cae encima de una, se lee
  la más cercana dentro de 22 px (`src/presentation/pointer.ts`).
- **La lectura se ve siempre.** Va pegada abajo mientras el gráfico está a la vista, así que en uno más
  alto que la pantalla tocar arriba no deja la respuesta fuera. Lleva el fondo opaco del panel y un
  borde fino, y el dibujo reserva debajo su misma altura: en reposo la lectura ocupa esa reserva y
  no tapa el eje ni las últimas filas; solo mientras está pegada se pinta encima (3.47.0).
- **Los gráficos de cobertura y de perfil horario**, que solo tenían el tooltip nativo, ganan la misma
  línea de lectura: en una pantalla táctil el tooltip no aparece nunca.
- **Objetivos de toque de 44 px** con `(any-pointer: coarse)`: botones, pestañas, el control de
  revisión y los estados de su menú, las fichas de la bandeja, selectores de gráfico, campos,
  desplegables, selector de fichero y el control del replay; el cuerpo, a 16 px. Se usa
  `any-pointer` para que un portátil con pantalla táctil también los tenga, aunque su puntero
  principal sea el panel.
- **El selector de fichero es un botón propio** («Elegir fichero…») con el nombre del fichero
  elegido al lado, no el control nativo, que decía «Choose File» en el idioma del navegador junto a
  botones en español. El `input` sigue existiendo con su `id`, fuera de la vista pero en el foco y en
  el árbol accesible; el botón enseña el foco con un contorno y mide 44 px con dedo (3.47.0).
- **Horquilla de tiempos**: la franja del tramo declarado (6 px, también en el móvil) y los puntos
  de hallazgo van en dos filas con aire entre ellas y separadas de la leyenda (3.47.0).
- **Ancho.** Hasta 1.440 px de contenido, para que un portátil grande aproveche los gráficos densos.
  El texto corrido se limita a unos 90 caracteres por línea. Probado sin desbordamiento a 768, 1.024,
  1.366, 1.536 y 1.920 px de ancho.

Además, en el móvil:

- Controles táctiles de al menos 24×24 px CSS, conforme a WCAG 2.2 nivel AA.
- Paneles apilados y detalle bajo demanda.
- Importación mediante selector del sistema.
- Progreso persistente aunque se cambie de vista dentro de la aplicación.
- Cancelación visible durante tareas pesadas.
- Tablas convertibles en listas; el grafo conserva zoom y encuadre.
- Ninguna pantalla esencial depende de hover o clic secundario.

La emulación móvil no sustituye la prueba en dispositivo físico.

## 8. Estados y errores

La aplicación diferencia:

- sin datos;
- analizando;
- cancelando;
- resultado parcial;
- fuente inválida;
- archivo sospechoso de otro circuito;
- evidencia no disponible;
- proyecto incompatible/migrable;
- almacenamiento insuficiente;
- actualización disponible;
- error recuperable y error que invalida el análisis;
- circuito en proceso de borrado, con lo que se pierde enumerado antes de confirmar.

Un error nunca debe mostrar `0 lecturas válidas` sin explicar esquema detectado, causa, filas de ejemplo y acción de recuperación.

## 9. Actualización PWA

Si existe una versión nueva:

- se avisa sin interrumpir;
- se bloquea su activación durante importación, análisis, exportación o consolidación;
- se solicita guardar el proyecto;
- se muestra la versión que se abrirá y compatibilidad esperada.
