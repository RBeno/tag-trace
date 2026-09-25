---
document_id: TT-UX-001
version: 0.17.0
status: baseline-candidate
last_updated: 2026-09-25
---

# Especificación de experiencia de usuario

## 1. Principio de información

Cada vista sigue tres niveles:

1. **Conclusión:** qué ocurre, gravedad, confianza y cambio.
2. **Evidencia:** por qué se concluye, alternativas y comprobaciones.
3. **Bruto:** fuentes, filas y valores originales cuando estén disponibles.

La interfaz no debe obligar a revisar AGV por AGV para descubrir un patrón colectivo.

## 2. Arquitectura de navegación

| Área | Objetivo |
|---|---|
| Gestor de circuitos | Crear/abrir/importar/exportar proyectos aislados y ver su estado. |
| Preparar análisis | Cargar fuentes, mapear columnas, revisar calidad, calendario y afinidad. |
| Resumen | Prioridades, cambios, cobertura, salud y avisos principales. |
| Circuito | Grafo/plano, capas teórica–observada–validada y evolución. |
| Timeline y replay | Movimiento multi-AGV, estados e incertidumbre. |
| Diagnóstico | Tags, AGV, tramos, FIFO, CO, críticos y explicaciones. |
| Expediente de AGV o tag | Buscar por identificador y ver todo lo conocido sobre ese objeto: contraste con su cohorte, inactividad, instante de cambio y evidencia. |
| Comparador | Periodo actual frente a consolidado, periodo o configuración. |
| Consolidación | Revisión de cambios y creación de memoria vN+1. |
| Incidencias | Expedientes, replay, casos similares y contramedidas. |
| Configuración | Calendarios, zonas, criticidad, parámetros y vigencias. |

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

1. **Cuántos vehículos y cuántos tags** forman el circuito, en una línea. El número de tags sale del
   ciclo dominante, no de contar identificadores distintos.
2. **Lo que hay que mirar**: los tags con patrón destacable y los vehículos que concentran tags sin
   leer, cada uno como **tarjeta de hallazgo** (§4) y no como fila de tabla. La razón es medible: en
   360 px una tabla de cinco columnas parte los encabezados letra a letra — cabe y es ilegible.
3. **El conjunto completo**, plegado: el anillo en orden, los tags fuera del anillo y la matriz
   entera. Se construye **solo al abrirlo**; dejarlo montado de entrada para tenerlo escondido paga
   el coste sin enseñar nada.

Dos cosas que la vista dice siempre, porque el número solo no las lleva escritas:

- el porcentaje es **sobre las pasadas probadas** por ese punto, no sobre las vueltas (R-OPP-013);
- **no es una tasa de salud**, y no lo será mientras no exista la oportunidad elegible de R-OPP-011.

Una matriz es bidimensional por naturaleza, así que se desplaza **dentro de su caja**. Eso no
contradice la regla de §5.1 —ningún gráfico exige desplazamiento para llegar a su contenido útil—
porque el contenido útil ya está arriba, sin desplegar nada.

## 4.3 Revisión en campo

Para ir a los puntos conflictivos con el móvil y dejar constancia de lo que se vio. Cada tarjeta de
hallazgo lleva cuatro botones: **○ Pendiente · ✓ Confirmado · ✕ Descartado · » Pospuesto**, y una
nota opcional. Los avisos de configuración no los llevan, porque no se comprueban en campo.

- **Se guarda sola** en el dispositivo en cada pulsación, y sigue ahí al recargar la página o al
  cargar otra extracción: la marca va con el tipo y el sujeto del hallazgo, no con su texto
  (R-EVI-007).
- **El estado se ve por tres canales**: borde de la tarjeta (acento si está confirmado, gris si está
  descartado, discontinuo si está pospuesto), el botón pulsado con su texto, y el icono. Nunca solo
  por color. Botones de 40 px, por encima de los 24 px de WCAG 2.2, porque se usa de pie.
- **Una barra fija arriba** dice cuánto va revisado («Revisión: 12 de 40 revisados») con su barra de
  progreso, y lleva el botón **Siguiente pendiente**. Es compacta a propósito: en el móvil, todo lo
  demás fijo taparía media pantalla.
- **Debajo, sin quedarse fijo**: el recuento por estado, los filtros (todos, pendientes,
  confirmados, descartados, pospuestos; solo esconden tarjetas, nunca gráficos) y **Exportar
  revisión (CSV)**, con los pendientes incluidos, que son la lista de lo que falta.
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
| **Rotura y degradación en el tiempo** | la forma del cambio: escalón o rampa, y cuándo | mismo eje en todos los paneles; un tramo sin pasadas corta la línea, no la lleva a cero |
| **Permanencia en los candidatos de tiempo** | parada precisa (estrecha y desplazada) y semáforo (dos grupos) frente a la referencia del cohorte | proporción de pasadas con el mismo eje; sin pares del mismo instante (R-DAT-013); firma, nunca función (R-GRA-007) |
| **Salidas de los tags con reparto** | cruce (las ramas vuelven a juntarse) o bifurcación (no) | el grosor es la cuota, con su soporte; el margen de saltos es configuración |
| **Ocupación de las calles de carga** | quién estuvo en cada calle y cuándo, la calle sin servicio, quién esperó de más | solo es barra lo que se sabe: una estancia sin entrada o sin salida es una marca en su extremo conocido; fuera de cobertura, trama (R-CO-007, R-DAT-007) |
| **Entrada y salida del tramo cargado** | un adelantamiento como una línea que cruza a las demás | candidato, no avería: OQ-107 sigue sin catálogo de excepciones (R-FLO-001) |
| **Deriva entre los dos periodos** | qué tag desapareció, apareció o se sustituyó, en lecturas | correlación de posición y tiempo, nunca confirmación física (R-DAT-017, R-EVI-004) |
| **Inventario** | cuánto hay que valorar frente a lo que no, y qué acción pide cada clase | sin color de severidad: «a valorar» es una pregunta, no un problema (§5.2) |
| **Expediente de un AGV en el tiempo** | cuándo lee, cuándo carga, cuándo calla y qué periodo está cargado | la carga es inferida; el silencio, causa desconocida; lo que cae fuera de la cobertura no se dibuja como silencio |

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
solos: siempre con la lectura y la tabla.

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
  alto que la pantalla tocar arriba no deja la respuesta fuera.
- **Los gráficos de cobertura y de perfil horario**, que solo tenían el tooltip nativo, ganan la misma
  línea de lectura: en una pantalla táctil el tooltip no aparece nunca.
- **Objetivos de toque de 44 px** con `(any-pointer: coarse)`: botones, selectores de gráfico,
  campos, desplegables, selector de fichero y el control del replay; el cuerpo, a 16 px. Se usa
  `any-pointer` para que un portátil con pantalla táctil también los tenga, aunque su puntero
  principal sea el panel.
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
