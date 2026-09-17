---
document_id: TT-DATA-001
version: 0.7.0
status: baseline-candidate
last_updated: 2026-09-17
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
| DS-008 | Memoria/configuración por AGV | AGV, versión o inventario conocido | Evidencia de divergencia |
| DS-009 | Calendario productivo | vigencia, turnos, pausas, paradas y takt | Contexto versionado |
| DS-010 | Proyecto anterior | `.agvproj` con manifiesto y versión | Persistencia local |
| DS-011 | Informe ampliado de Vsystem | Tipo, fecha con segundos, AGV, circuito y, según el tipo, tag o uso | Enriquecida, opcional |

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

La separación se hace por **aristas exclusivas**: si un conjunto de vehículos recorre transiciones
que ningún otro recorre jamás, están en circuitos distintos. El parecido entre conjuntos de tags
agrupa, pero no decide: un vehículo que simplemente lee peor se separaría solo y acabaría siendo su
propio cohorte, que es la forma más silenciosa de no comparar nada.

Un vehículo con muy pocas lecturas no se asigna a ningún circuito, y entonces **no se compara**: se
declara que no hay evidencia y se para. Un informe de comparaciones contra un cohorte vacío es peor
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
- Conservar el orden original para auditoría.
- Los cambios horario de verano/invierno deben detectarse y marcarse; una hora repetida o
  inexistente no se usa para afirmar orden dentro de la ventana afectada.
- La representación canónica del tiempo —`t_utc`, `t_raw`, `tz_id` y `t_flag`— está fijada en
  ADR-0013 y es obligatoria para toda observación.

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
