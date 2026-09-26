---
document_id: TT-DATA-001
version: 0.20.0
status: baseline-candidate
last_updated: 2026-09-26
---

# Contratos de datos y procedencia

## 1. Política general

Las fuentes se cargan localmente y se tratan como evidencia inmutable. La normalización crea una representación derivada; nunca modifica el archivo original ni oculta filas descartadas.

## 2. Tipos de fuente

| ID | Fuente | Mínimo | Carácter |
|---|---|---|---|
| DS-001 | Lecturas históricas | Fecha/hora, AGV, tag | Esencial |
| DS-002 | Inventario Vsystem | Tag y atributos disponibles | Teórico, versionado |
| DS-003 | Secuencia/plano | Orden, nodo o relación disponible | Teórico, opcional al inicio |
| DS-004 | Carga online | Calle, tag de parada y secuencia de tags | Configuración |
| DS-005 | Tags críticos | Tag, función, grado 1–3 y redundancias | Catálogo parcial |
| DS-006 | Tags especiales | Tag y clase: noche, mantenimiento, técnico, asistencia/pastor u otra | Catálogo parcial |
| DS-007 | Tags y acciones | Tag y una o varias funciones/condiciones | Catálogo parcial |
| DS-008 | Memoria de vehículo | Lista maestra de tags cargables, con su fecha | **Requisito de toda tasa de lectura**, y por sí sola **no suficiente**: ver §3.4 |
| DS-009 | Calendario productivo | vigencia, turnos, pausas, paradas y takt | Contexto versionado |
| DS-010 | Proyecto anterior | `.agvproj` con manifiesto y versión | Persistencia local |
| DS-011 | Informe ampliado de Vsystem | Tipo, fecha con segundos, AGV, circuito y, según el tipo, tag o uso | Enriquecida, opcional |
| DS-012 | Historial de flota | AGV y fecha de alta; circuito, fecha de baja y nota opcionales | Configuración, incremental (§3.6) |

El **orden** de la lista del circuito es lo declarado: puede tener erratas al transcribir o un orden
distinto al real, y la posición de un tag la dan las lecturas (R-GRA-015).

Las listas (DS-002, DS-004 a DS-008) y el historial (DS-012) entran en CSV o en un libro de Excel
(`.xlsx`) con la plantilla que da el programa (§3.7). Las lecturas (DS-001 y DS-011) también pueden
llegar en `.xlsx`, tal como las exporta Vsystem (§3.8).

## 3. Contrato mínimo de lecturas

El mínimo lo fija DS-001, que es la fuente que siempre está disponible.

| Campo canónico | Tipo | Obligatorio | Regla |
|---|---|---:|---|
| `timestamp` | instante | Sí | Parseo explícito; conservar valor original y zona horaria/configuración usada. |
| `agv_id` | texto | Sí | No convertir a número; trim controlado; preservar ceros. |
| `tag_id` | texto | Sí | No convertir a número; preservar ceros y valor original. |
| `source_id` | UUID/texto | Sí, derivado | Identifica el lote importado. |
| `source_row` | entero | Sí, derivado | Fila física original, incluida cabecera al definir el convenio. |
| `source_hash` | hash | Sí, derivado | Identidad del archivo completo. |
| `observed_state` | enum | Sí, derivado | Siempre `observed` para una fila aceptada. |

Campos adicionales se conservan en un espacio de atributos tipado, pero no se promueven a contrato canónico sin decisión.

### Atributos canónicos opcionales

Los aporta DS-011 y son opcionales porque DS-001 no los lleva. Ausente significa `unknown`, nunca un
valor por defecto.

| Campo | Tipo | Regla |
|---|---|---|
| `circuit_declared` | texto | Circuito declarado por la fuente. Cuando existe, la afinidad se comprueba en lugar de inferirse — pero **no basta para separar circuitos**: ver §3.2. |
| `mtc` | texto | Multicircuito vigente en esa lectura. Es **contexto**, no un atributo decorativo: ver §3.1. |
| `resolution` | duración | Resolución temporal declarada de la fuente. Condiciona qué análisis temporal es lícito. |

### 3.1 El multicircuito condiciona la oportunidad de lectura

R-DAT-004 ya dice que un tag puede tener funciones distintas según el multicircuito. El efecto va
más allá de las funciones: un multicircuito puede **cambiar las condiciones físicas de detección**
—por ejemplo reduciendo el alcance del sensor en un modo degradado por climatología—. Bajo ese
multicircuito, una lectura ausente es **esperable**, no un defecto.

**Lo que se observa en una exportación real de esta forma**, y que acota la regla anterior: ningún
tag declara jamás dos valores de multicircuito distintos —el valor va pegado al tag—, pero solo una
parte de los tags lo declara, y de esos, unos lo emiten en **todas** sus pasadas y otros solo en una
fracción. El mismo vehículo sobre el mismo tag unas veces lo trae y otras no.

Qué dispara esa emisión es una regla de dominio que **no está en el dato** y no se deduce de él. Se
registra en `OPEN_QUESTIONS.md` y hasta que se responda `mtc` se trata como lo que se puede
sostener: un contexto declarado en la lectura, presente o `unknown`, nunca reconstruido por
continuidad desde la lectura anterior.

Por tanto `mtc` es un contexto de primer nivel para las oportunidades y la salud:

- dos lecturas del mismo tag bajo multicircuitos distintos no son eventos funcionalmente
  comparables y no se agregan en el mismo perfil esperado;
- cuando `mtc` no está disponible para un periodo —el caso de DS-001— la salud de ese periodo
  arrastra un **confusor no cuantificado** y debe declararlo junto a la conclusión, en lugar de
  presentar el resultado como si el contexto fuera homogéneo.

### 3.2 Un nombre de circuito puede esconder varios circuitos

Observado en una exportación real: bajo un único valor de `Circuito` convivían **tres circuitos**
distintos, con flotas disjuntas y recorridos propios. El nombre agrupaba por zona o por informe, no
por circuito.

Separarlos importa porque **el cohorte de comparación es el circuito**: comparar un vehículo contra
otros que recorren un trazado distinto no mide su estado, mide el trazado. En esa exportación, un
vehículo quedaba «en la mediana» de la flota entera y era **el último de los ocho** de su circuito.

El parecido entre conjuntos de tags agrupa, pero no decide. Un grupo es un circuito si tiene **lo
suyo**: transiciones que solo recorren sus vehículos **y** tags que solo leen ellos. Compartir una
transición no basta para juntarlos: los circuitos de esa exportación comparten tramo, y con ese
criterio salían como uno solo. Y las transiciones solas no bastan para separar: un vehículo que se
salta tags hace saltos que nadie más hace, y acabaría siendo su propio cohorte, que es la forma más
silenciosa de no comparar nada. Un vehículo que lee peor, o que solo se vio en parte del recorrido,
va al circuito que contiene sus tags.

Un vehículo cuyos tags no contiene ningún circuito no se asigna a ninguno, y entonces **no se
compara**: se declara que no hay evidencia y se para. Un informe de comparaciones contra un cohorte vacío es peor
que no tener informe, porque parece un análisis.

### 3.3 Eventos que no son lecturas

DS-011 entrelaza en un mismo flujo filas de tipos distintos. Una fila de tipo *uso* lleva instante,
AGV y circuito, pero **no lleva tag**: no describe dónde estuvo el AGV sino qué hizo. No encaja en
el contrato mínimo y tiene el suyo:

| Campo | Tipo | Regla |
|---|---|---|
| `timestamp`, `agv_id`, `source_*` | — | Igual que una lectura. |
| `event_kind` | enum | Discriminador de la fuente. Una fila se clasifica antes de normalizarse. |
| `usage_code` | enum versionada | Catálogo cerrado; un valor no previsto se conserva como texto y se marca `unknown` en lugar de descartarse. |

Un evento de uso **no** genera nodo ni arista en el grafo topológico, no cuenta como lectura en
ninguna tasa, y no crea oportunidades. Es evidencia de comportamiento, y como tal alimenta las
hipótesis de configuración y de acción de FR-012 y R-AGV-002.

Las demás columnas del informe que todavía no tienen semántica confirmada se conservan en el espacio
de atributos sin promoverse ni interpretarse.

**Una fila sin tag no es una fila defectuosa, y la diferencia no es cosmética.** En una exportación
real de esta forma, **cuatro de cada diez filas** no son lecturas. Contarlas como cuarentena diría
que casi la mitad del fichero está roto, y quien lo lea buscará una avería que no existe; peor aún,
enterraría las filas realmente defectuosas entre decenas de miles de falsas.

El importador las separa por su **forma**, sin necesidad del discriminador de la fuente y sin fijar
ninguna constante industrial: una fila con instante y AGV pero sin tag se marca `NO_TAG`, se conserva
con su procedencia y se cuenta aparte de la cuarentena. **Qué es** cada una de esas filas lo dice el
discriminador de la fuente cuando existe, no el importador.

### 3.4 Sin la memoria del vehículo no hay tasa de lectura

Un vehículo **solo registra los tags que lleva en su memoria**. Si un tag no está en ella, pasa por
encima y no queda ninguna fila. La ausencia no distingue entre «el lector no lo detectó» y «el
vehículo no lo lleva cargado», porque el dato es idéntico.

Eso convierte DS-008 de fuente auxiliar en **requisito**: sin el inventario de memoria, cualquier
tasa de lectura por vehículo mezcla dos causas de naturaleza distinta —una avería y una
configuración— y presentarla como salud es afirmar lo que no se sabe.

#### Qué contiene realmente la memoria

Cuatro conjuntos, y el cuarto es el que cambia las cuentas:

1. los tags del **circuito virtual** declarado en Vsystem,
2. los de **mantenimiento**,
3. los de **sustitución de emergencia**,
4. y **tags obsoletos: ya no existen físicamente, y nunca se borraron de la lista**.

El cuarto abre un agujero en la regla que parecía obvia. «Está en la memoria» se estaba tratando
como lo que hace *elegible* una oportunidad, pero **un tag obsoleto está en memoria y no es una
oportunidad**: el vehículo pasa por donde estaría y no hay nada que leer. Cargar DS-008 y aplicar la
regla tal cual llevaría de «no hay tasa de lectura» a «una tasa que cuenta como fallo tags que no
están instalados», que es peor, porque vendría con una lista detrás y parecería fundada.

La condición correcta tiene **dos partes**: el tag está en la memoria **y existe** (R-OPP-011).

#### La lista es maestra, no por vehículo, y eso cierra menos de lo que parece

DS-008 se escribió esperando un inventario por vehículo. Lo que existe es una **lista maestra
común**: la que cada AGV *debería* llevar. Los vehículos pueden no estar bien actualizados, así que
uno puede arrastrar obsoletos que otro ya no tiene, o faltarle tags que otro sí lleva.

La consecuencia es de estado de verdad, no de detalle: la lista maestra acota el **universo** —el
techo de lo que cualquier vehículo podría leer— pero la memoria de un vehículo concreto es
`expected`, nunca `observed`, y su desviación solo se infiere del comportamiento (R-OPP-012).
Presentar DS-008 como si desbloqueara la salud por vehículo sería falso: cierra la mitad de flota de
la pregunta y deja abierta la individual.

**La forma de la ausencia sí discrimina, y es gratis.** Normalizando el recuento de cada vehículo
por sus propias vueltas —el recuento bruto lo contamina, porque quien da menos vueltas lee menos de
todo— un tag de la ruta cae en uno de dos patrones:

| Patrón | Qué se observa | Hipótesis prioritaria |
|---|---|---|
| **Bimodal** | unos vehículos lo leen en todas sus pasadas, otros **nunca**, sin término medio | no está en la memoria de esos vehículos (R-AGV-002) |
| **Gradiente** | todos lo leen algo, unos bastante menos | condiciones de detección |

Medido sobre dos exportaciones reales: el patrón bimodal existe, **se concentra en pocos vehículos**
—en una de ellas, seis de cincuenta y tres acumulan el 91 % de los casos— y los conjuntos de tags a
los que dos de esos vehículos son ciegos **se solapan**. Un vehículo con más de mil lecturas y
ciento setenta tags distintos que nunca lee dos tags concretos que sus cincuenta compañeros leen
siempre no es una casualidad de detección.

**Consecuencia operativa que no es evidente:** cuando un vehículo pasa a otro circuito cuyos tags no
tiene en memoria, **no aparece en la exportación de ese circuito**. Cruzar exportaciones no sirve
para confirmar dónde estuvo; la salida se detecta por la incoherencia de la reanudación (R-AGV-009)
y se queda ahí.

#### Obsoleto y muerto no se separan con una sola ventana

Un tag que está en la lista maestra y que **ningún vehículo de la flota ha leído jamás** en toda la
cobertura es candidato a obsoleto. Pero exactamente el mismo dato lo produce un tag que sí existe y
ha dejado de funcionar. Con una ventana no hay forma de distinguirlos, y elegir uno sería sustituir
`unknown` por la hipótesis más probable, que es justo lo que este proyecto no hace.

Lo que sí los separa es **el tiempo**:

| Entre dos ventanas separadas | Conclusión |
|---|---|
| Se leía antes y ahora no | **cambió**: murió, se sustituyó o se retiró — y eso es un hallazgo |
| No se leyó en ninguna de las dos | obsoleto consolidado: deja de ser candidato |
| Aparece uno que antes no estaba | sustitución o instalación nueva |

Esto **no exige continuidad de cobertura**: exige dos muestras buenas, separadas y comparables en
calendario (R-TIM-007). La cadencia de extracción determina la fidelidad con que se representa el
circuito, no la capacidad de detectar estos cambios (R-TIM-008).

Y hay un refinamiento que llega con el grafo, no antes: si el tramo donde estaría el tag se recorre
y el tiempo directo entre sus vecinos coincide con el de pasar por él, el tag está **en la línea** y
simplemente no se lee. Eso descarta que el tramo no se visite, que es la otra explicación inocente.

### 3.5 Inventario contrastado: declarado × memoria × observado

Cruzar los tres conjuntos —lo que Vsystem declara del circuito, lo que la lista maestra dice que los
vehículos pueden leer, y lo que se ha leído de verdad— clasifica cada tag sin necesidad de grafo, de
vueltas ni de ninguna constante industrial. Es pertenencia a conjuntos y recuentos:

| Clase | Declarado | En memoria | Leído | Qué afirma |
|---|---|---|---|---|
| `activo` | sí | sí | por la flota | nada que ver aquí |
| `obsoleto-candidato` | indiferente | sí | **por nadie, nunca** | está en la lista y probablemente no en el suelo → `unknown` |
| `ciego-parcial` | sí | sí | unos siempre, otros nunca | bimodal: memoria desactualizada en esos vehículos → `inferred` |
| `no-declarado-leido` | **no** | indiferente | sí | existe y nadie lo declaró: la lista del circuito está desactualizada |
| `declarado-sin-memoria` | sí | **no** | indiferente | la lista de memoria no lo tiene: sin lecturas, nadie puede leerlo aunque exista (punto ciego de configuración); con lecturas, alguna memoria real lo tiene y la lista va por detrás |
| `especial` | — | sí | ocasional | mantenimiento, sustitución de emergencia o tag de la lista de noche: fuera del circuito de día y de toda tasa. **No** la carga online: sus tags están declarados por su lista y se juzgan como los demás (R-GRA-004; propietario, 2026-09-26) |
| `critico-no-declarado` | **no** | **no** | **por nadie** | solo la lista `critico` lo nombra: probable errata de esa lista; acción `comprobar-lista-critico`, nunca «añadir a la memoria» (2026-09-26) |
| `critico-sin-lectura` | indiferente | sí | **por nadie, nunca**, y es crítico | se perdió una función, no solo una lectura (R-GRA-008) → `unknown` |
| `refuerzo-sin-lectura` | indiferente | sí | **por nadie, nunca**, es crítico y **otro tag de su refuerzo sí se lee** | la función la sostiene el refuerzo; lo perdido es la redundancia (R-GRA-016) → `unknown` |

Dos límites que se muestran junto a la tabla y no en una nota al pie:

- `obsoleto-candidato` **no es un diagnóstico**. Es una hipótesis con su prueba pendiente, y lo que
  la resuelve es la comparación entre periodos, no más análisis de la misma ventana.
- `ciego-parcial` señala vehículos, no tags: el tag está bien y la lista de alguien no lo está. Es
  `inferred` porque la memoria real de un vehículo concreto no se observa (R-OPP-012).

Ninguna de las seis clases emite una tasa de salud. Publican hechos y, donde toca, la hipótesis
prioritaria con su estado de verdad.

### 3.6 Historial de flota del circuito (DS-012)

Qué vehículos están asignados a un circuito y desde cuándo. Sin él, un AGV asignado que no lee nada
es invisible: la flota solo se puede contar con los que aparecen en las lecturas, y así lo dice la
vista (R-AGV-014).

Una fila por AGV y periodo, escrita a mano, así que la forma la fija el programa y se enseña antes de
pedir el fichero:

```text
circuito;agv;desde;hasta;nota
SE2/4;7101;01/09/2026;;
SE2/4;7102;01/09/2026;15/09/2026 14:00;baja por mantenimiento
```

| Columna | Obligatoria | Qué es |
|---|---|---|
| `agv` | sí | identificador tal cual; `0040` no es `40` (R-DAT-001) |
| `desde` | sí | instante del alta, día/mes/año con hora opcional; sin hora es a las 00:00 |
| `hasta` | no | instante de la baja; vacío es que sigue asignado |
| `circuito` | no | a qué circuito pertenece la fila, cuando un mismo fichero trae varios |
| `nota` | no | texto libre, se conserva y no se interpreta |

- **El periodo es `[desde, hasta)`**: `hasta` es el instante de la baja, no el último en que estuvo.
- **Las fechas son día/mes**, declarado y no adivinado, en la zona del circuito.
- **Rechazo por fila, contado y enseñado**: sin AGV, fecha inválida, `hasta` no posterior a `desde`,
  o menos campos que la cabecera exige. Dos periodos del mismo AGV que se pisan **no** se rechazan:
  se avisan y se cargan tal cual, porque cuál manda no lo dice el dato.
- **Un fichero con varios circuitos no se reparte solo.** Si la columna `circuito` trae más de un
  valor, la interfaz pregunta cuál es este circuito, importa solo esas filas (y las que no dicen
  circuito) y recuerda la respuesta para las cargas siguientes.

**Actualización incremental, a diferencia de las listas.** Una lista se sustituye entera; el
historial **se fusiona** con lo guardado por la clave (AGV, `desde`). Una fila con la misma clave
sustituye a la anterior —así se cierra un periodo: se vuelve a subir su fila con `hasta`— y las demás
se conservan. Para registrar un cambio basta subir esa fila. Borrar un periodo subiendo filas no se
puede: queda como límite declarado.

### 3.7 Listas e historial en Excel

Las listas de tags (DS-002, DS-004 a DS-008) y el historial de flota (DS-012) se escriben a mano, y se
escriben en Excel. Un CSV abierto en Excel pierde justo lo que importa: convierte `0712` en `712` —otro
AGV (R-DAT-001)— y las fechas en números, y al guardarlo hay que acertar con separador y codificación.
Por eso:

- **La plantilla se entrega como fichero**, no la da el programa: un `.xlsx` hecho con
  `scripts/generar-plantillas-excel.ts` —el repositorio no guarda ninguno—, con la primera hoja con la cabecera en su sitio (`lista;tag;orden;funcion;grupo;capacidad;nota`
  o `circuito;agv;desde;hasta;nota`), las columnas en **formato texto**, la cabecera fija, desplegables
  que avisan pero admiten otros valores (`lista` y `funcion`), una hoja de instrucciones y otra de
  ejemplo.
- **El `.xlsx` se importa tal cual**, sin convertirlo. Se lee **solo la primera hoja**; la cabecera se
  busca por nombre, como en el texto, y una celda que falta al final de una fila es una celda vacía.
  Se toma el valor de cada celda tal como Excel lo guardó; una fórmula no se evalúa, se toma su último
  resultado. Las columnas que el importador no conoce se ignoran.
- En el historial de flota, una fecha que Excel guardó **como número** (la celda no estaba en texto) se
  lee como la fecha de pared que se escribió —días desde el 30/12/1899— en la zona del circuito. Solo en
  un libro de Excel: en un texto, un número suelto en una columna de fecha no es una fecha.
- Un libro que no se puede leer se rechaza entero, con el motivo: los límites del contenedor son los
  del zip de `.agvproj` (§9, TH-005), y un XML con declaración de tipo de documento se rechaza.
- El CSV sigue valiendo, con las mismas reglas de §4 y §5.

El circuito de un análisis también se entrega en este formato, como borrador de la lista `circuito`,
con columnas de más (la diferencia con Vsystem, las lecturas y el origen de cada fila) que el
importador ignora. Es un borrador: la lista `circuito` es lo que Vsystem declara, así que se corrige
contra Vsystem antes de cargarla (R-GRA-001). La función de un punto crítico no se rellena sola
(R-GRA-007).

### 3.8 Lecturas en Excel

Vsystem también exporta las lecturas en `.xlsx`. El libro se importa tal cual, con las mismas reglas
que el texto:

- Se lee **solo la primera hoja**. Cada fila pasa a una línea de texto con un separador que no
  aparezca en ninguna celda (`;`, o tabulador si alguna celda lleva `;`), y después se importa como un
  CSV: separador, orden de fecha, sentido de la pila, cuarentena y filas que no son lecturas.
- Excel no guarda las celdas vacías del final de una fila: la fila se completa hasta el ancho de la
  cabecera. Así una fila `Uso` sin tag sigue siendo «no es una lectura» y no una fila con campos de
  menos.
- Un AGV con ceros a la izquierda llega como texto y se conserva (R-DAT-001).
- Una fecha que Excel guardó **como número** se lee como la hora de pared que se escribió, en la zona
  del circuito.
- La procedencia apunta a la fila del libro, igual que a la línea del CSV. La codificación se declara
  `xlsx`.
- Un libro que no se puede leer se rechaza entero, con el motivo y la salida: guardarlo de nuevo en
  Excel o exportarlo como CSV.

## 4. Proceso de importación

1. Calcular hash y metadatos sin enviar el contenido.
2. Detectar codificación, delimitador y cabecera con puntuación de confianza. La codificación se
   **declara siempre** en el resumen, junto al separador. Decodificar en UTF-8 de forma tolerante
   está prohibido: no falla nunca, sustituye en silencio cada byte que no entiende y deja pasar un
   fichero corrompido con aspecto de correcto. Se intenta UTF-8 estricto y, si falla, Windows-1252,
   que es lo que exporta la fuente real.
3. Mostrar muestra y asignación de columnas al usuario.
4. Validar fechas, IDs y campos obligatorios.
5. Clasificar filas: aceptada, duplicada exacta, solapada, inválida o ambigua.
6. Presentar recuentos y advertencias antes del análisis.
7. Calcular una huella de afinidad con el circuito activo.
8. Permitir análisis en cuarentena si hay duda; impedir consolidación si la afinidad no está resuelta.

## 5. Delimitadores, fechas y orden

- Admitir coma, punto y coma y tabulador.
- No inferir silenciosamente día/mes cuando el formato sea ambiguo.
- La zona horaria forma parte de la configuración versionada.
- El orden canónico es `(t_utc, source_hash, source_row)`, definido en ADR-0013, con `source_row`
  orientado según el **sentido de la fuente**.
- El sentido se detecta midiendo la monotonía del fichero, se registra en su procedencia y se
  muestra en la vista previa para que el usuario lo confirme. No se supone.
- Un fichero cuya monotonía no sea limpia no se rechaza: sus inversiones son evidencia de entrega
  diferida y se conservan señaladas.
- Un par en que alguna lectura lleva `t_flag` distinto de `ok` no cuenta como inversión ni como
  empate: se cuenta aparte (`unreliablePairs`). Una hora repetida no es una entrega diferida.
- Las líneas en blanco no son filas: se cuentan aparte (`blankRows`) y `totalRows` es la suma exacta
  de aceptadas, en cuarentena y sin tag.
- Las comillas envolventes de un campo o de una celda de cabecera no forman parte del valor
  (`"0040"` es `0040`, `""` dentro es una comilla). Un separador dentro de un campo entrecomillado
  **no** se admite: la fila sale por recuento de campos. Vale para lecturas, listas e historial de
  flota, cuyas cabeceras se normalizan igual que las de lecturas (BOM, comillas, acentos,
  mayúsculas), y una columna que el importador no conoce se avisa en vez de ignorarse en silencio.
- Conservar el orden original para auditoría.
- Los cambios horario de verano/invierno deben detectarse y marcarse; una hora repetida o
  inexistente no se usa para afirmar orden dentro de la ventana afectada.
- La representación canónica del tiempo —`t_utc`, `t_raw`, `tz_id` y `t_flag`— está fijada en
  ADR-0013 y es obligatoria para toda observación.

### 5.1 Lecturas en el mismo instante

Cuando dos lecturas caen en el mismo instante, el orden canónico se resuelve por `source_row` y el
reloj no interviene. Ese desempate hace falta para que el orden sea total y reproducible, pero **es
`inferred`**, y R-DAT-013 prohíbe construir topología sobre él.

El resumen de fuente declara cuánta de la fuente está en ese régimen, y la cifra se cuenta **por
vehículo**:

```text
sameInstantPairs : pares consecutivos del MISMO vehículo que comparten instante
vehiclePairs     : pares consecutivos del mismo vehículo en total
```

La distinción no es un matiz. Contando los pares consecutivos del fichero —todos los vehículos
mezclados— una exportación real da un 39 %; contando por vehículo, un 3 %. Las dos cifras son
ciertas y responden a preguntas distintas: la primera describe lo gruesa que es la resolución
frente al ritmo de eventos, y solo la segunda dice qué parte de la secuencia de un vehículo no la
ordena el reloj. Publicar la primera como si fuera la segunda es un error de trece veces.

El informe de monotonía conserva el recuento del fichero (`tiedPairs`) como lo que es: los pares
que no aportaron evidencia de sentido.

## 6. Solapes: unión por secuencia, no por huella de fila

Dos exportaciones de la misma fuente son **cortes de la misma pila**, tomados en momentos distintos.
Un solape entre ellas no es un conjunto disperso de filas repetidas: es un **tramo contiguo común**.
Esa propiedad es lo que hace posible unirlas sin perder evidencia.

La unión localiza el tramo contiguo común más largo entre las dos secuencias y empalma por ahí. No
compara filas de forma aislada.

Por qué no basta una huella por fila: a resolución gruesa, `hash(t_utc, agv_id, tag_id)` colisiona
entre un paso repetido legítimo y una fila duplicada. Contrastado con la fuente real, de 116 filas
idénticas **114 tenían otro tag del mismo AGV entre medias** —un patrón A → B → A dentro del mismo
instante declarado, es decir el retroceso o maniobra que contempla R-CO-005—. Deduplicar por huella
las habría fusionado y habría borrado 114 maniobras reales.

| Situación | Cómo se reconoce | Tratamiento |
|---|---|---|
| Solape entre exportaciones | Tramo contiguo común entre dos cortes de la misma pila | Se cuenta una vez; conserva la procedencia de ambas fuentes. |
| Paso repetido legítimo | Misma tripleta con otras lecturas del mismo AGV intercaladas | Son eventos distintos. Se conservan ambos. |
| Filas idénticas y contiguas | Misma tripleta sin nada del mismo AGV entre medias | Indistinguible a esta resolución: se conserva y se marca `unknown`, nunca se colapsa en silencio. |

Reglas:

- No se elimina evidencia: la vista analítica une, pero la procedencia conserva todas las
  referencias.
- La identidad de un evento nunca se reduce a AGV+tag.
- El criterio de unión se declara de forma explícita; cambiarlo cambia la versión de ALG-002 y no
  recalcula históricos por su cuenta.

Consecuencia operativa: **conviene solapar las exportaciones a propósito**. El último instante de
cada exportación viene cortado, y lo que la ventana deslizante deja atrás no se recupera. Con una
unión correcta el solape no cuesta nada; la pérdida sí es irreversible.

## 7. Cobertura y muestreo

La fuente de lecturas no es un archivo histórico consultable por rango: es una **ventana
deslizante**. El servidor apila lo que recibe y lo más antiguo se pierde. Y el análisis **no
pretende ser continuo**: es muestral, con periodos de unos pocos días tomados con regularidad.

De ahí la regla que gobierna todo lo demás:

> La **cobertura** de un circuito es la unión de los intervalos temporales de las fuentes aceptadas.
> Fuera de esa cobertura el estado es **`sin datos cargados`**. No se analiza, no entra en salud ni
> en oportunidades, y **no es nunca una parada ni un silencio**. Dentro de la cobertura, una
> ausencia de lecturas sí es un hecho observable y puede diagnosticarse.

Sin esta separación el sistema confundiría «nadie exportó a tiempo» con «los AGV dejaron de emitir»,
que es precisamente el falso diagnóstico que este producto existe para evitar.

Reglas:

- La cobertura se calcula por circuito y se muestra siempre junto a cualquier conclusión temporal.
- El primer y el último instante de una exportación pueden venir cortados. La cobertura termina en
  el último instante **completo**; el resto se marca como parcial.
- `sin datos cargados` es un estado propio, distinto de `unknown`: `unknown` significa que hubo
  evidencia y no alcanza para decidir; `sin datos cargados` significa que nunca hubo evidencia.
- Un hueco solo puede clasificarse —silencio colectivo, parada planificada, fallo de comunicación—
  si cae dentro de la cobertura.

### Comparabilidad entre muestras

Comparar dos periodos exige contexto de calendario equivalente (R-TIM-006). Con muestreo periódico
eso deja de ser teoría: una muestra tomada en días laborables y otra en fin de semana diferirían
enormemente sin que el circuito haya cambiado nada. La comparación histórica debe declarar qué
cubre cada muestra y advertir cuando los contextos no son comparables, en lugar de presentar la
diferencia como evolución.

## 8. Afinidad de circuito

La afinidad combina intersección de tags, transiciones conocidas, AGV esperados, fuentes declaradas y contradicciones topológicas. Sus salidas son:

- `compatible`: análisis y posible consolidación;
- `partially-compatible`: análisis permitido con advertencia; consolidación requiere resolución humana;
- `foreign-suspected`: cuarentena; consolidación bloqueada;
- `unknown`: memoria insuficiente para decidir.

No debe bloquearse el primer archivo de un circuito vacío por falta de memoria previa.

## 9. Formato `.agvproj`

El contenedor está decidido en ADR-0012: zip con manifiesto, secciones JSON separadas, hash por
sección y hash global, límites de descompresión y carga transaccional. El esquema ejecutable se
formaliza en F1a y se completa en F4. Como mínimo contendrá:

- manifiesto, versión e integridad;
- identidad del circuito;
- configuraciones y periodos de vigencia;
- versiones de algoritmos y reglas;
- grafo y perfiles consolidados;
- divergencias históricas compactas;
- expedientes de incidencia separados;
- referencias a fuentes y disponibilidad de evidencia;
- registro append-only de consolidaciones y migraciones.

No incluirá el bruto completo por defecto. Un expediente puede conservar un recorte normalizado mínimo cuando sea necesario para reproducir una incidencia.

La **revisión en campo** (R-EVI-007) viaja en una sección opcional `revision`: una entrada por
hallazgo marcado, con su clave, estado, nota, instante y lo que decía la tarjeta al marcarlo. Sin
marcas la sección no se escribe, así que un proyecto sin revisión queda igual que antes. En el
dispositivo vive en su propia tabla (almacén versión 5), separada del circuito para que una
importación nunca pise una marca; borrar el circuito la borra con él.

### 9.1 El dispositivo acumula, el fichero viaja

Que `.agvproj` no lleve el bruto tiene una consecuencia de arquitectura que conviene dejar escrita,
porque de otro modo se descubre tarde: **son dos almacenes distintos con propósitos distintos**.

| | Dónde vive | Qué guarda | Por qué |
|---|---|---|---|
| Almacén local | el dispositivo | las lecturas acumuladas de todas las fuentes, su procedencia y la cobertura | El servidor de planta es una ventana deslizante de pocos días: lo que no se extraiga y se guarde aquí no se recupera |
| `.agvproj` | fichero portable | identidad, configuración, inventario de fuentes con sus hashes, cobertura y estado derivado | Es lo que se lleva a otro dispositivo, y el intercambio es manual (CON-002) |

El almacén local exige **migraciones explícitas desde su primera versión**. Es la única parte del
sistema cuyos datos no se pueden volver a pedir: una ventana perdida no vuelve.

La acumulación —unión y escritura— ocurre **dentro del Worker**, que lee y escribe el almacén por su
cuenta. Mandarle al Worker las lecturas ya guardadas por `postMessage` las clonaría y duplicaría el
pico de memoria, que es exactamente el defecto P4 del prototipo; y hacer la unión en el hilo
principal recorrería dos series de cientos de miles de elementos donde WP-001 lo prohíbe.

## 10. Borrado y retención local

El usuario debe poder eliminar lo que ha creado, y esa eliminación debe ser verificable:

- Borrar un circuito elimina sus fuentes normalizadas, memoria, incidencias y análisis, previa
  confirmación inequívoca que nombra lo que se pierde y ofrece exportar antes.
- Borrar es irreversible desde la aplicación: no hay papelera. La copia de seguridad es el
  `.agvproj` exportado.
- Un análisis descartado libera sus estructuras al terminar la sesión; no queda residuo consultable.
- La aplicación indica cuánto ocupa cada circuito y avisa cuando el navegador puede reclamar el
  almacenamiento, solicitando persistencia explícita (RSK-011, TH-009).
- El bruto original nunca es propiedad de la aplicación: se referencia por hash y permanece donde
  el usuario lo tenga.

## 11. Datos reales y GitHub

Ninguna fuente real, aunque esté parcialmente anonimizada, se añade al repositorio. Los fixtures sintéticos deben usar identificadores, geometría, horarios y distribuciones inventados y llevar un manifiesto `synthetic: true`.
