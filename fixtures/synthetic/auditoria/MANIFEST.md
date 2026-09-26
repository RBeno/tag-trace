# Circuito de auditoría con verdad conocida

- Dataset ID/version: `auditoria/25`
- Generador: `tests/support/circuito-auditoria.ts`, con semilla `20260920`
- `synthetic: true`
- Propósito: medir **cuánto de lo que puede ir mal en un circuito real llega a decirse**. Cada clase
  de fallo está plantada a propósito, con los tags y vehículos implicados conocidos de antemano, de
  modo que detectar o no detectar es una cifra y no una impresión.
- Periodo ficticio: septiembre de 2026, inventado
- Configuración ficticia asociada: zona `Europe/Madrid`

## Garantía de privacidad

- [x] IDs inventados
- [x] Fechas y horarios inventados
- [x] Topología inventada
- [x] Distribuciones no copiadas literalmente de datos reales
- [x] Sin nombres de planta, sistema o personal
- [x] Revisado antes de commit

## Los datos no están aquí, y es a propósito

Un cuarto de millón de filas son megabytes que envejecen y que nadie va a leer en una revisión.
Lo que se versiona es el **generador**: con la misma semilla produce siempre el mismo escenario, así
que es reproducible sin ocupar el repositorio. Es el mismo criterio que ya sigue
`tests/e2e/rendimiento.spec.ts` con su fuente de cien mil filas.

Para mirarlo a mano: `npx vite-node scripts/generar-auditoria.ts` deja las dos CSV en `local/` e
imprime dónde está plantado cada fallo, con sus tags y vehículos.

## Escenario

150 tags declarados en la lista `circuito`, 40 vehículos, 30 h de ventana, ~239.000 lecturas.
**147 tags llegan a leerse**; los otros 3 están declarados y no los lee nadie.

Además, **cinco calles de carga online** de tres tags cada una —entrada, parada precisa y salida—,
que es lo que R-CO-001 fija para el fixture sintético, y una **zona de vacíos** que engloba las
cinco calles más un tercio contiguo del anillo (R-FLO-003). La carga dura una media hora de media;
esa magnitud es del escenario, no de planta, y por eso vive en el generador y no en `src/`. Y un
**ancla de vuelta declarada** en la lista `ancla` (R-GRA-009): el primer tag del anillo.

El generador declara además un **corte** a mitad de ventana (coincidente con el instante de la
rotura súbita) para poder comparar un periodo temprano contra uno tardío sin necesitar una segunda
fuente real: la auditoría construye esa cobertura de dos tramos a mano, igual que ya hace con la de
`carga-online` (R-DAT-016).

| Clase plantada | Dónde | Qué debe decir el producto | Qué **no** puede decir |
|---|---|---|---|
| `declarado-sin-lecturas` | 3 tags | `obsoleto-candidato`, `unknown` | avería del tag, ni omitirlo |
| `lectura-alta` | 10 tags al 95–100 % | `uniforme-alto`: nada que mirar | bimodal ni uniforme-bajo |
| `lectura-media` | 10 tags al 20–90 % | `uniforme-bajo` o `gradiente`, apuntando al tag | culpar a vehículos concretos |
| `omision-por-memoria` | 2 tags, 5 AGV | `bimodal-candidato` nombrando **esos** vehículos | que el tag esté averiado |
| `omision-conservando-convoy` | 5 tags seguidos, 1 AGV | paso probado por tiempo u orden (R-OPP-014) | que esos tags fallen |
| `rotura-subita` | 2 tags | el **instante** en que dejó de leerse | una tasa media que mezcle antes y después |
| `degradacion-progresiva` | 2 tags, 90 % → 40 % | una **tendencia** a la baja | una tasa media estable que lo esconda |
| `mantenimiento-aislado` | 2 tags fuera del anillo | enumerados aparte y sin clasificar (R-GRA-011) | contarlos como parte del circuito |
| `carga-online-normal` | 4 calles, ~93 estancias | media hora entre parada y salida es **carga** (R-CO-006) | contarla como periodo de inactividad |
| `calle-sin-servicio` | 1 calle, 3 tags | la calle no se sirvió; sus tags, `calle-sin-servicio`, `unknown` | que esos 3 tags sean candidatos a obsoleto |
| `salida-fuera-de-antiguedad` | 1 AGV, 5 h dentro | el que más esperó, **el primero** de la lista (R-CO-003) | llamarlo avería: R-FLO-001 admite excepciones |
| `carga-anterior-a-la-ventana` | 5 AGV | estaban dentro antes de la cobertura (R-CO-007) | que estuvieran ausentes, ni la calle vacía |
| `zona-vacia-declarada` | 1/3 del anillo + calles | la zona se enumera y las calles caen dentro | que declararla mueva el veredicto de un tag sano |
| `lector-agv-degradado` | 1 AGV, sin otro papel | tendencia a la baja en la fila del **vehículo** (R-OPP-015) | que los tags que lee ese AGV salgan con tendencia o rotura |
| `adelantamiento-en-zona-cargada` | 1 AGV, sin otro papel | se enumera a quién adelantó y con qué margen, como candidato (R-FLO-001) | llamarlo avería: R-FLO-001 admite excepciones y OQ-107 no tiene el catálogo |
| `bifurcacion-real` | 1 tag del anillo, cadena de 6 tags fuera de anillo | candidato a `bifurcacion` con las dos ramas y su cuota, nunca reclasificado a `cruce` (las ramas no reconvergen dentro del margen) (R-GRA-007) | asignar la función, o llamarlo avería |
| `cruce-real` | 1 tag del anillo, 1 tag fuera de anillo, que reconverge un salto después | candidato a `cruce`: dos ramas que se abren y se cierran enseguida, con el punto y el número de saltos de reconvergencia (R-GRA-007) | dejarlo como bifurcación sin comprobar reconvergencia, o llamarlo avería |
| `parada-precisa-real` | 1 tag del anillo, todos los vehículos | candidato a `parada-precisa`: duración media alta con coeficiente de variación bajo (R-GRA-007) | llamarlo avería o carga |
| `semaforo-real` | 1 tag del anillo, todos los vehículos | candidato a `semaforo`: duración bimodal con dos grupos compactos (R-GRA-007) | confundirlo con una tendencia de rotura o degradación (R-OPP-015): es alternancia estable, no cambio sostenido |
| `ancla-declarada` | 1 tag del anillo, declarado en la lista `ancla` | vueltas completas `observed`; el ancla efectiva es la declarada (R-GRA-009) | que declararla cambie qué tags forman el anillo, más allá de rotar el punto de inicio |
| `tag-nuevo-a-mitad-de-ventana` | 1 tag fuera de anillo | sin lecturas en el periodo temprano, con lecturas en el tardío: `nuevo` (R-DAT-016) | que sea obsoleto, o que existiera desde el principio de la ventana |
| `memoria-actualizada-a-mitad-de-ventana` | 5 tags contiguos, 1 AGV | ese vehículo dejó de leerlos a mitad de ventana; el resto de la flota los sigue leyendo (R-AGV-013) | que esos tags estén averiados, o acusar a otro vehículo |
| `sustitucion-candidata` | 2 tags (1 del anillo, 1 fuera) | candidato a sustitución: el que desaparece y el que ocupa su mismo hueco de secuencia, correlacionados por vecino y tiempo (R-DAT-017) | tratarlos como dos hallazgos sueltos, o afirmar que es el mismo punto físico sin más evidencia |
| `memoria-no-actualizada` | 1 tag fuera de anillo, 1 AGV | el vehículo señalado como candidato a memoria no actualizada: no registra el tag nuevo mientras la mayoría de la flota ya lo hace (R-AGV-013) | que el tag nuevo esté averiado, o acusar a otro vehículo |
| `vinculacion-declarada` | 1 tag del anillo, declarado por la columna `funcion` del circuito virtual | el expediente del tag muestra la función crítica «vinculacion» (R-GRA-007) | que sea un hallazgo estadístico, ni que el producto la haya propuesto |
| `desvinculacion-declarada` | 1 tag del anillo, declarado por la lista `critico` | el expediente del tag muestra la función crítica «desvinculacion» (R-GRA-007) | que sea un hallazgo estadístico, ni que el producto la haya propuesto |
| `lectura-desigual-en-pocos-tags` | 1 AGV que lee 2 tags del anillo en la mitad de sus pasadas (uno sí y uno no, sin `random()`) | el AGV sale como «lee poco» en esos dos tags, en pocos tags, con su porcentaje (R-AGV-016) | una causa (lector, memoria o colocación), ni que los dos tags fallen para el resto |
| `parada-de-produccion` | toda la flota congelada 15 min a las 10:00 y a las 18:00 del día 1 y a las 10:00 del día 2: después de generar, cada fila posterior a una franja se desplaza su duración (sin `random()`), y los dos tags críticos declarados se quedan sin lecturas | tres paradas de la producción y ninguna más, la de las 10:00 repetida; todos siguen por su sitio; cada hueco dentro, justificado (R-AGV-018). El orden no es verdad plantada: el generador deja que un AGV adelante a otro al circular, y se informa | que algún AGV se desconectara o saliera del circuito, o un bloqueo dentro de una franja |
| `bloqueo-sin-justificar` | el mismo AGV que se retrasa 20 min en la zona cargada | el único bloqueo: el primero de su cola, sin avanzar y con la producción en marcha, con sus lecturas críticas | una causa, o justificarlo con una parada de la producción que no hubo |
| `noche-medida-aparte` | 4 tramos seguidos (54→58) van 45 s más lentos en cada pasada de noche, con la transición entera entre 22:10 y 04:50; la deuda de reloj se devuelve a 1 s por paso | la horquilla de producción de esos tramos como la de uno limpio, la de noche con el doble o más, ninguna parada de noche por esa lentitud | mezclar la noche con el día, o llamar parada a lo que de noche es lo normal |
| `parada-sin-explicacion-aislada` | un AGV sin otro papel, 63 s de más una sola vez en 86→87, de día | una parada sin explicación con quién iba delante y cuánto avanzó | una causa, un bloqueo o un punto conflictivo |
| `punto-conflictivo` | 8 AGV sin otro papel, 70 s de más una vez en 72→73 y otra en 73→74, de día (≈2 % de las pasadas, por debajo del p95) | un punto que une los dos tags, con los 8 AGV y sin bloqueos | que sea de un solo AGV, o un bloqueo |
| `cuello-de-botella` | de 19:30 a 21:00, cada AGV espera 40 s en 116 y quien llega mientras otro ya generado lo ocupa espera a que salga (una sola espera, no una cadena) | un cuello de botella en 116, que fluye, sin paradas sin explicación detrás | una avería, o dejar sin explicación a quien espera |
| `zona-oscura` | nada nuevo: la serie de tags poco leídos (40–43) | una zona oscura que los incluye, con la causa «se salta el tag» | que el tramo sea largo, o una zona sobre tramos limpios |
| `entrega-agrupada` | un AGV sin otro papel (7121), cuatro veces de día: tras generar y congelar, sus tres lecturas anteriores a una lectura Y pasan a Y−3 s, Y−2 s e Y−1 s, en cinco tags seguidos del anillo lejos de calles, ramas y puntos críticos de tiempo; sin `random()` y con el recorrido entero igual | las cuatro como lecturas que llegaron juntas, sin parada; el AGV concentrado; ninguna parada suya en esos tramos (sin el colapso eran cuatro) | una parada en el hueco, o una ráfaga de otro AGV |
| `posicion-en-tiempo` | contexto, nada nuevo en las lecturas: la auditoría mide dos ficheros, el temprano y el tardío, a una hora del corte | en cada fichero posiciones crecientes desde el ancla; los tres tags nunca leídos sin posición y el siguiente situado; el tag nuevo (98001) entre sus dos vecinos solo en el fichero de después | interpolar una posición, o situar el tag nuevo en el fichero de antes |
| `tres-sustituidos-seguidos` | mantenimiento a mitad de ventana: desde el corte, tras generar y congelar, las lecturas de tres tags seguidos del anillo (96–98) llevan el nombre de otros tres (97001–97003), en el mismo instante; sin `random()` | entre los dos ficheros y dentro de la ventana entera, tres sustituciones en su sitio entre las dos anclas que los rodean, **incluido el del medio**, con la suma igual | tres cambios sueltos, o el del medio como un tag que deja de leerse y otro que empieza |
| `insertado-misma-suma` | desde el corte, un tag nuevo (97101) en el punto medio de cada paso de 36 a 37, redondeado al segundo, sin mover el reloj | un tag nuevo en la línea entre sus dos vecinos, con la suma igual | que cambie el recorrido |
| `ritmo-mas-lento-en-un-fichero` | un AGV sin otro papel (7122): tras generar y antes de congelar, sus lecturas desde la mañana del segundo día, ya pasada la noche, se estiran un 10 % respecto a esa hora; sin `random()` y donde ninguna otra plantación depende de su reloj | en el fichero de después, un 10 % más lento que la flota contra la horquilla de ese fichero, en toda la línea; en el de antes, a su paso | una causa, o cualquier otro AGV señalado |
| `retiene-a-otros` | un AGV sin otro papel (7107) se queda 105 s en el semáforo en cada pasada de día, dentro de la horquilla del semáforo, y quien llega detrás —ya lo tenía delante al leer el tag anterior— espera a que salga; con la deuda de reloj, sin `random()` | ese AGV retiene a varios AGV distintos más de lo que da el azar por sus pasadas, sin pararse él | otro retenedor, o paradas sin explicación de quien espera |
| `tag-de-noche` | un tag fuera de la lista del circuito (97201) entre los tags 84 y 85 del anillo, solo de noche: tras generar, tras generar y congelar, en el punto medio de cada paso de 84 a 85 que cae entre las 22:00 y las 05:00; sin `random()` y sin mover el reloj | tag de noche, con su sitio entre 84 y 85 y cero lecturas de día en las pasadas por su sitio; no sale como cambio de tag ni parte la ventana de la suma entre anclas | que sea candidato a una posición, o que cada noche empiece y deje de leerse |
| `tag-de-noche-declarado` | nada nuevo en las lecturas: el mismo tag de noche (97201), analizado una segunda vez con él en la lista `noche` de planta | tag de noche declarado, entre 84 y 85; los demás tags fuera de la lista, con el mismo veredicto que sin la lista | otro veredicto para él, o que la lista cambie el de otro tag |
| `lista-con-otro-orden` | solo en la lista `circuito`, sin tocar las lecturas: dos vecinos (7 y 8) escritos al revés y el 113 escrito detrás del 52 | en el orden según las lecturas, los tres donde se leen, marcados como corrección de la lista, con su sitio en cada lado; siguen limpios en todas las demás sondas | cualquier otro hallazgo sobre esos tags |
| `lista-con-numero-mal-escrito` | solo en la lista: el tag 88 escrito con el último dígito cambiado, un número que no existe | el número mal escrito, sin lecturas, junto al tag de verdad en el orden leído; «posible sustitución o número mal escrito» en el contraste; el de verdad, candidato a esa posición | decidir por el número si es errata o sustitución |
| `refuerzo-sin-lectura` | solo el tag 66, siguiente a la desvinculación (65), declarado en `critico` también como `desvinculacion` y sin leerse nunca; se calla al final del paso, después de todos los sorteos, así que la secuencia de ningún vehículo cambia, y no añade lecturas críticas nuevas, que son la base de la parada de la producción | `refuerzo-sin-lectura` con su refuerzo (65) nombrado; el 65, activo; ningún `critico-sin-lectura` | que se perdió la función, o que el 65 tenga algún hallazgo |
| `limpieza-de-la-lista` | contexto, nada nuevo: junta lo ya plantado | fuera del físico, el refuerzo sin lecturas (66) primero y después los nunca leídos (13, 77, 131) y el número mal escrito; en otra posición, el 113 y uno de los vecinos cambiados (7 u 8); el refuerzo 65+66, incompleto | otro tag fuera del físico o en otra posición, o un refuerzo comprobado |
| `linea-parada-con-pulmon` | nada nuevo en las lecturas: la medida se hace una segunda vez con la entrada en el 136, un tramo limpio (la lista declara la línea en el 59 y el 60, donde las paradas de la producción paran a la flota en sitios distintos y no marcan un pulmón) | las tres paradas de la producción, paradas de la línea con AGV esperando; el pulmón medido | que a la línea le faltaron AGV en una parada de la producción |
| `linea-tiempo-sin-paso` | nada nuevo: la misma medida con la entrada en el 136 | el tiempo sin paso con AGV esperando cubre al menos el 90 % de las tres paradas de la producción | que en ellas faltaran AGV |
| `linea-tag-sin-leer` | solo declaración: la lista `linea` con el 59 y el 60; los vehículos sin el 60 en memoria (`omision-por-memoria`) pasan leyendo solo el 59 | exactamente esos vehículos, sin el 60 en todos sus pasos, y el lector degradado; ningún paso «sin parada» ni «no sigue» en las paradas de la producción | que no hicieran la parada, u otro vehículo |
## Resultados prohibidos

Además de lo que dice la tabla, hay dos cosas que esta auditoría vigila por encima de todo:

1. **Ningún falso positivo sobre los tags sanos.** Señalar un tag que está bien es peor que no
   señalar uno que está mal: es lo que hace que nadie vuelva a mirar la herramienta.
2. **Que la lista de deuda no mienta.** Las clases que hoy no se detectan están enumeradas en
   `tests/audit/auditoria.test.ts`, y la prueba falla **también** si alguna empieza a detectarse sin
   que se saque de la lista. Una deuda que no se actualiza sola acaba siendo un `TODO` viejo.

## Lo que este escenario todavía no ejercita

`R-FLO-006` —el orden de convoy no prueba nada en zona vacía— está implementado y con pruebas
unitarias propias, pero aquí **no llega a aplicarse**: casi todos los segmentos del anillo tienen
tiempo mediano medido, así que la decisión la toma la vía del tiempo y la del orden no se alcanza.
La auditoría lo publica como `pasadas retiradas de la vía de orden: 0` en lugar de callarlo, porque
una regla que no se ejercita no está validada por este escenario aunque esté escrita.

