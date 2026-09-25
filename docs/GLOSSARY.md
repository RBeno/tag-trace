---
document_id: TT-GLOSSARY-001
version: 0.25.0
status: baseline-candidate
last_updated: 2026-09-25
---

# Glosario controlado

| Término | Definición normativa |
|---|---|
| AGV | Vehículo guiado automático identificado como texto y analizado de forma individual y colectiva. |
| Circuito | Unidad principal de trabajo. Agrupa configuración, fuentes, grafo, memoria, análisis e incidencias sin mezclarse con otros circuitos. |
| Afinidad de circuito | Comparación de los tags de una fuente contra los que el circuito ya conoce, antes de aceptarla como suya. No rechaza la importación —una fuente sospechosa se analiza igual (FR-003)— pero sí impide que se consolide con el resto: una vez unida, no hay forma de separarla, porque la unión no conserva de qué circuito venía cada lectura (R-DAT-006, ALG-003). |
| Acción a valorar | Lo que el programa indica que hace falta comprobar en planta ante un hallazgo que el dato no resuelve por sí solo, como un tag sin lecturas que puede estar retirado o averiado. El programa no decide ninguna de estas cosas: enuncia la pregunta y la deja registrada; la decisión es siempre de una persona (R-EVI-006). |
| Vsystem | Fuente teórica/configurada que se contrasta con el comportamiento físico observado; no se asume como verdad física. |
| Tag | Identificador físico/lógico leído por un AGV. Puede tener una o varias funciones según la configuración o el multicircuito. |
| Multicircuito (MTC) | Modo de comportamiento vigente **dentro de** un circuito, identificado por un número. Determina cómo actúa un AGV al leer un tag y puede alterar las condiciones físicas de detección, por ejemplo reduciendo el alcance del sensor en un modo degradado. No confundir con «varios circuitos», que es el alcance de F7. |
| Cobertura | Unión de los intervalos temporales de las fuentes aceptadas de un circuito. Delimita sobre qué se puede concluir algo. |
| Sin datos cargados | Estado de un intervalo que queda fuera de la cobertura. Distinto de `unknown`: en `unknown` hubo evidencia y no basta para decidir; aquí nunca hubo evidencia. No es una parada ni un silencio. |
| Muestra | Periodo acotado que se importa y analiza. El producto trabaja por muestras, no sobre un histórico continuo; dos muestras solo se comparan si su contexto de calendario es equivalente. |
| Flota asignada | Vehículos que el historial de flota (DS-012) asigna al circuito en un instante dado: los que tienen un periodo `[desde, hasta)` que lo contiene. Es la M del recuento «N de M». Sin historial cargado no se conoce, y se sustituye por los vehículos vistos en las lecturas diciéndolo (R-AGV-014). |
| En el circuito | Un vehículo asignado que, en un instante dentro de la cobertura, lee, carga, o está parado o circulando sin leer: ningún AGV cambia de circuito. Es la N del recuento, y aparte se dice cuántos leen. Solo quedan fuera mantenimiento y una hora o más sin leer que nada explica; leer sin estar asignado se cuenta aparte, nunca en N (R-AGV-014, R-AGV-015, R-AGV-018). Sustituye a «en funcionamiento», que dejaba fuera a cada AGV parado. |
| Parada de la producción | Tramo sin ninguna lectura en los tags críticos declarados, largo e improbable por azar con el ritmo de ese turno (sin críticos declarados, de toda la flota). Explica las paradas de los AGV que caen dentro. Sale de los datos, no se declara (R-AGV-018). |
| Cola | AGV parados uno detrás de otro, a dos tags o menos, porque el de delante no se va: ya iba delante al empezar, sigue ahí a mitad y va él también más lento de lo normal. Quien retiene no tiene por qué estar parado él: en un cuello de botella tarda lo normal de ese sitio. Una cola que avanza cada poco es saturación o un pulmón (R-AGV-018). |
| Régimen | Estado de funcionamiento por la hora local: **producción** o **noche** (hoy de 22:00 a 05:00). Lo que cruza una parada de la producción no entra en ninguno. Las mediciones estándar usan solo producción; la noche se mide aparte (R-TIM-009). |
| Horquilla de tiempos | Lo que tarda un tramo —de un tag a otro— en un régimen: p50, p80 y p95 de sus propias transiciones. Es el estado normal de ese tramo, y se compara entre periodos (R-FLO-007, R-TIM-010). No confundir con un tag donde el recorrido se divide (bifurcación). |
| Lecturas que llegaron juntas | Varias lecturas de un AGV que el servidor recibe casi a la vez tras un hueco: un volcado al recuperar la comunicación, porque la hora del fichero es la de llegada. Con la suma del recorrido normal, el AGV no paró (R-DAT-020). También «entrega agrupada». |
| Franja | Un fichero de lecturas cargado, medido por separado en su ventana completa (R-TIM-011). Dos exportaciones que se solapan son dos franjas; un fichero repetido, una sola. |
| Ritmo de un AGV | La mitad de sus tramos, cada uno medido contra lo habitual de ese tramo, frente a lo mismo de toda la flota; sin paradas ni esperas detrás de otro. Un 1,10 es un 10 % más lento (R-AGV-019). |
| Retener | Ir delante de otro AGV, más despacio de lo habitual en ese tramo, mientras el de detrás espera. Quien retiene no tiene por qué pararse (R-AGV-020). |
| Borrador del circuito | Libro de Excel que el programa saca del anillo de un análisis con la forma de la lista `circuito`: el recorrido observado en su orden y, en cada fila, dónde difiere de Vsystem. Se corrige contra Vsystem antes de importarlo, porque esa lista es lo que Vsystem declara (R-GRA-001). |
| Suma entre anclas | El tiempo entre dos tags que siguen en su sitio a los dos lados de un cambio (las anclas). Es del recorrido: si entre ellas se pone, se quita o se cambia un tag y la suma sigue igual, solo cambió lo de en medio (R-DAT-021). |
| Posición en tiempo | Los segundos de recorrido desde el ancla hasta un tag, sumando la mitad de las pasadas de cada paso. Es tiempo, nunca distancia; un tag que no se puede situar no se interpola (R-TIM-011). |
| Valla | Límite de la horquilla de un tramo: p95 + max(p95 − p50, margen mínimo, resolución). Por encima, una transición es una parada candidata (R-FLO-007). |
| Retención | Transición lenta —por encima del p95 de su tramo, con al menos el margen de espera— con un AGV delante que no se iba (R-FLO-008). |
| Cuello de botella | Tag donde se concentran las retenciones más de lo que da el azar por el tiempo que los AGV pasan ahí: donde se forma cola. Si fluye, no es una avería (R-FLO-008). |
| Punto conflictivo | Tags vecinos con más paradas sin explicación, de varios AGV, de las que da el azar por sus pasadas. Dice dónde, no por qué (R-FLO-009). |
| Zona oscura | Tramo donde el hueco entre dos lecturas es mucho mayor que el típico del circuito, porque un tag se salta o porque el tramo tarda: ahí una parada se ve tarde (R-GRA-014). |
| Primero de la cola (bloqueo) | La parada de una cola sin nadie parado delante. Si pasa dos minutos de lo habitual con la producción en marcha, es un bloqueo: se dice dónde, cuánto, cuántos quedaron detrás y cuántas lecturas críticas hubo mientras tanto. Sin causa (R-AGV-018, R-EVI-006). |
| Periodo de inactividad | Intervalo dentro de la cobertura en el que un objeto no produce lecturas. Como un AGV detenido no emite, la inactividad no se distingue del fallo de comunicación por la ausencia en sí, sino por el contexto colectivo, el punto de la última lectura y el calendario. |
| Instante de cambio | Última lectura antes de un silencio o de un cambio sostenido de comportamiento. Es `inferred`: marca el último momento con evidencia, no el instante real en que el objeto dejó de funcionar. |
| Expediente de objeto | Vista que reúne todo lo conocido sobre un AGV o un tag concreto, con su contraste de cohorte, su inactividad y su evidencia navegable. No confundir con el expediente de incidencia. |
| Lectura | Evento observado procedente de una fuente: instante, AGV, tag y procedencia. |
| Oportunidad | Paso contextualmente sustentado en el que un tag podría haber sido leído. No equivale a inventar una lectura. |
| Vuelta | Recorrido segmentado de un AGV a través de una secuencia/ciclo del circuito, con confianza explícita. |
| Ancla | Tag por el que se corta una vuelta. Sin ninguna declarada, es el ciclo dominante que el propio grafo revela y la vuelta nunca es `observed`. Declarada y presente en el ciclo reconstruido (`lap_anchors`, R-GRA-009), solo rota dónde se corta ese mismo ciclo —nunca qué tags lo forman— y una vuelta `completa` cortada por ella sí puede ser `observed`; una `parcial` no, porque uno de sus extremos es siempre un corte de los datos. En la suma entre anclas (R-DAT-021) la palabra se usa en plural y es otra cosa: cualquier tag que sigue en su sitio a los dos lados de un cambio. |
| Tramo | Relación topológica entre dos nodos/tags o puntos funcionales consecutivos. |
| Grafo teórico | Topología procedente de plano, inventario o configuración. |
| Grafo observado | Transiciones contenidas directamente en las lecturas normalizadas. |
| Grafo inferido | Hipótesis topológica derivada por algoritmo, marcada con soporte y confianza. |
| Grafo validado | Versión del grafo aceptada por el propietario durante una consolidación. |
| Perfil esperado | Distribución versionada de secuencias, tiempos y frecuencias válida para un contexto. |
| Divergencia | Diferencia mensurable entre un periodo/AGV/grupo y el comportamiento esperado o colectivo. |
| Cambio de tag | Dentro de un mismo periodo cargado, un tag que deja de leerse y otro que empieza en su mismo sitio —el mismo vecino de antes o de después en la secuencia de los AGV—, sin solaparse más de lo admitido (R-DAT-019). Candidato, nunca confirmación de que sea el mismo punto físico. Entre dos exportaciones separadas, lo equivalente es la sustitución candidata de la deriva. |
| Deriva | Cambio detectado comparando el primer y el último periodo de cobertura de un circuito, nunca dentro de una sola ventana: un tag que se leía y deja de leerse, uno que empieza a leerse, o un vehículo que deja de leer un conjunto que sí leía mientras el resto de la flota lo sigue leyendo (R-DAT-016, R-AGV-013). Un caso particular es la **sustitución candidata** (R-DAT-017): un tag que deja de leerse y otro que empieza, correlacionados porque ocupan el mismo hueco de la secuencia de lecturas y coinciden en el tiempo — candidato, nunca confirmación de que sea el mismo punto físico. Y al revés, un vehículo puede ser candidato a **memoria no actualizada** cuando un tag nuevo ya adoptado por la mayoría de la flota no aparece nunca en sus lecturas. Distinta de la divergencia: esta compara el circuito consigo mismo a lo largo del tiempo, no contra lo esperado. |
| Reaparición | Por dónde vuelve a leer un AGV tras un hueco sin lecturas, frente al anillo inferido: por el tag siguiente (parado), uno o varios más allá, en otro punto una hora o más después (desconexión), o por un tag de mantenimiento. Con lo que suele tardar ese tramo en ese turno al lado. Describe, no explica (R-AGV-017). |
| Vida de un tag | Desde que empezó hasta que dejó de leerse dentro del periodo, cuando ese cambio se detecta (R-DAT-019). Su tasa y la de cada AGV se cuentan dentro de ella (R-OPP-016); sin cambio detectado, el tag vive todo el periodo. |
| Salud | Indicador explicable derivado de oportunidades válidas, lecturas, estabilidad, contexto e incertidumbre; nunca mera frecuencia absoluta. |
| Hueco censurado | Intervalo sin evidencia suficiente para afirmar qué ocurrió. |
| CO | Carga online. Forma parte del circuito físico, pero se modela dentro de la zona vacía y no se rige por FIFO cargado. |
| Zona cargada | Tramo del anillo donde se espera FIFO —quien entra primero sale primero— salvo carga online, maniobra manual o excepción documentada (R-FLO-001). Se declara por tag, no se calcula. |
| Zona vacía | Tramo del anillo donde puede haber reordenación sin que sea, por sí sola, una rotura de FIFO (R-FLO-002). Incluye las calles CO (R-FLO-003). |
| Adelantamiento (zona cargada) | Un vehículo entra después de otro en un tramo de zona cargada y sale antes, por un margen que no explica el jitter normal de lectura. Es un candidato, nunca una avería confirmada: OQ-107 no tiene el catálogo de excepciones legítimas. |
| Punto crítico | Punto cuya falta de alimentación/paso puede afectar directamente al proceso productivo, con grado configurable. |
| Punto crítico candidato | Tag propuesto para una de las nueve clases de punto crítico por la firma que deja en el dato, nunca por asignación (R-GRA-007): la función es dato de planta declarado, por la lista `critico` o alternativamente por la columna `funcion` del circuito virtual. |
| Bifurcación candidata | Un tag cuyas salidas se reparten entre dos o más sucesores con cuota comparable, sostenida en el tiempo — ninguno domina. |
| Cruce candidato (interno) | Una bifurcación candidata cuyas ramas reconvergen en pocos saltos dentro del mismo cohorte: dos caminos que se abren y se cierran enseguida, no una bifurcación que dure. Distinto del cruce entre circuitos protegido por un par de tags (OQ-121), que no deja firma. |
| Vinculación / desvinculación | Dos clases de tag crítico sin firma estadística: el AGV sincroniza (o deja de sincronizar) su velocidad con la línea de producción al leerlas. Declaración pura, como cambio de mapa — se muestran en el expediente del tag, nunca se proponen. |
| Zona compartida | Parte del recorrido que usan varios circuitos: un cruce, un semáforo o un tramo físico común. Los tags de cruce y semáforo pueden estar en varios circuitos; en un tramo común, cada circuito mantiene casi siempre sus propios tags, así que el tramo se declara y no se deduce de cruzar listas. Lo que se comprueba en ella es la ocupación de sus espacios frente a su capacidad, con las lecturas de todos los circuitos que la comparten y en la franja que cubren todos (R-GRA-012, R-GRA-013). Alcance de F7. |
| Espacio (de un tag) | Lo que va de un tag al siguiente del recorrido. Un AGV no está en el tag: el tag es el último que leyó, y el AGV ocupa el espacio que sigue. Cuántos caben depende de la longitud física del espacio —uno si el siguiente tag está a centímetros, varios si está a metros—, y es dato de planta (R-GRA-012). |
| Revisión en campo | Decisión humana sobre un hallazgo tras ir a comprobarlo: confirmado (el fallo existe), descartado (no existe) o pospuesto (queda para otra ocasión); sin marcar, pendiente. Se guarda aparte del análisis y no lo modifica; es el paso previo a la consolidación (R-EVI-007). |
| Consolidación | Aceptación humana de un periodo revisado para producir una nueva versión compacta de memoria y sus divergencias. |
| Incidencia | Expediente separado que conserva síntoma, intervalo, replay, evidencia, hipótesis, contramedidas y verificación. |
| Contramedida | Acción propuesta o realizada para reducir una causa, registrada con responsable, estado y verificación. |
| Replay | Reproducción determinista del estado/movimiento inferible de varios AGV sobre el grafo, mostrando incertidumbre. |
| Bruto | Fuente original inmutable utilizada durante el análisis. No forma automáticamente parte de la memoria duradera. |
| `.agvproj` | Contenedor local versionado de un circuito, su memoria compacta, configuraciones, incidencias y metadatos. |
| Cohorte | Grupo de AGV o de modelos de lector cuyo comportamiento difiere de forma material del resto y exige perfiles esperados separados. Se declara en configuración, no se infiere sola. |
| Takt | Ritmo de referencia entre unidades producidas, con unidad y vigencia definidas en la configuración local. No existe un valor universal en el código. |
| Soporte | Cantidad de evidencia independiente que sostiene un nodo, una transición o un perfil: cuántos AGV y cuántas vueltas distintas lo respaldan. Un soporte alto de un solo AGV no equivale a consenso. |
| Oportunidad elegible | Oportunidad cuyo contexto permite afirmar que el tag pudo leerse. Es el único denominador admitido para la tasa de lectura; las oportunidades censuradas, no recorridas o desconocidas quedan fuera. Exige **dos** condiciones sobre el tag: que esté en la memoria del vehículo y que **exista físicamente** (R-OPP-011). Un tag obsoleto cumple la primera y no la segunda. |
| Tag obsoleto | Tag que sigue en la lista de memoria de los vehículos y **ya no existe en el suelo**, porque se retiró y nunca se borró de la lista. No produce lectura y no es una oportunidad. No se distingue de un tag averiado dentro de una sola ventana (R-DAT-016). |
| Universo de memoria | Conjunto de tags que un vehículo puede llegar a leer: circuito virtual, mantenimiento, sustitución de emergencia y obsoletos no borrados. Acota por arriba cualquier tasa de lectura. Cuando la lista es **maestra** —la que cada vehículo debería llevar— el universo es de flota y el contenido individual es `expected`, no `observed` (R-OPP-012). |
| Pastor | Recorrido de asistencia o acompañamiento, ajeno al recorrido productivo, que debe excluirse del comportamiento esperado. Su identificación en las fuentes sigue abierta (OQ-103). |

## Estados de verdad

| Estado | Significado | Puede mostrarse como hecho observado |
|---|---|---|
| `observed` | Existe evidencia directa en una fuente trazable. | Sí |
| `inferred` | Resultado de una inferencia reproducible. | No |
| `expected` | Predicción del modelo aplicable al contexto. | No |
| `unknown` | No existe evidencia suficiente para decidir. | No |
| `confirmed` | Una persona autorizada validó explícitamente la interpretación. | Sí, como confirmación humana, conservando el origen |
