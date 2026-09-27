---
adr: ADR-0017
status: accepted
date: 2026-09-27
---

# El expediente de incidencia y su repercusión medida como una onda

## Contexto

F5 empieza por el expediente (`ROADMAP.md` §F5). `INCIDENTS_REPORTING.md` ya dice qué contiene,
cómo se retrocede desde el síntoma y por qué estados pasa, y ADR-0006 lo separa de la memoria
normal. Lo que falta decidir antes de escribir código es:

1. **Cómo se guarda** un expediente para que dentro de seis meses diga lo mismo que hoy, cuando
   las lecturas en crudo de su ventana ya se hayan retirado del almacén (ADR-0015).
2. **Qué se mide.** El propietario (2026-09-27): «tenemos que tener en cuenta que medimos hasta
   ahora qué se puede medir en el futuro, por ejemplo en vez de medir una cantidad medir la
   repercusión como una onda en un estanque. Ejemplo: un AGV cargado que se detiene durante
   7 minutos, cómo se propaga, cómo afecta, cuándo se vuelve a la calma».
3. **Cómo se habla de causa.** `INCIDENTS_REPORTING.md` §4 enumera `precede`, `correlaciona`,
   `es compatible con` y `confirmado como causa`, pero no dice cuándo se puede usar cada uno.

### Qué se mide hoy

Hasta 3.63.0 una incidencia se describe con **cantidades en un punto**: la duración del hueco de
un AGV y cómo reaparece (R-AGV-017), si la parada se explica por la producción o por una cola
(R-AGV-018), la batería por incidencia —el de delante, los de detrás, la línea— (R-AGV-021), las
retenciones y su cabeza (R-FLO-008), y la línea sin paso con o sin AGV esperando (R-FLO-010). Cada
una responde «qué le pasó a este AGV» o «qué le pasó a la línea en este intervalo». Ninguna
responde **cuánto se extendió la perturbación, hasta dónde llegó, cuánto costó en total y cuándo
dejó de notarse**.

Pero las piezas ya existen. Una parada de un AGV en una guía única produce, por construcción, dos
frentes:

- **aguas arriba, una cola** que crece hacia atrás: los que llegan se detienen detrás (R-AGV-018
  ya lo reconoce y R-FLO-008 ya sigue la cadena hasta la cabeza);
- **aguas abajo, un hueco** que avanza con la flota: el de delante sigue y se separa, y el hueco
  llega a los puntos críticos y a la entrada de la línea (R-FLO-010 ya dice «le faltaron AGV» y
  dónde se abrió el hueco con el anterior).

Cuando el AGV reanuda, la cola se descarga de delante hacia atrás y sus AGV salen **juntos**: en
un circuito cerrado ese grupo da la vuelta y vuelve a pasar por la línea apelotonado. El pulmón de
la línea puede absorber el hueco sin que la línea lo note. Es la onda del estanque: un epicentro,
dos frentes que se alejan, una amortiguación y, en un anillo, un eco. Todo se puede medir con lo
que ya hay —horquillas por tramo y régimen, cadencia y ciclo local de la línea, pulmón minuto a
minuto, cadena de cola—, sin constantes nuevas de planta.

## Decisión

**Aceptada por el propietario el 2026-09-27** («Acepto ADR-0017, usa tu recomendación en las
preguntas»): tal como está redactada, con las recomendaciones de OQ-159 a OQ-163 como respuestas
(`OPEN_QUESTIONS.md`, preguntas cerradas).

### 1. El expediente es un registro de eventos append-only

Como el plano (ADR-0016): un expediente es una lista de eventos con fecha, autor y razón, y su
estado vigente sale de recorrerlos. Eventos: abrir (con su origen: síntoma descrito, intervalo o
hallazgo, con la referencia al hallazgo), fijar o corregir el síntoma, ajustar la ventana, adjuntar
una medición, añadir o retirar una hipótesis, anotar evidencia a favor o en contra, planificar una
contramedida, registrar una verificación, cambiar de estado, nota, cerrar y reabrir. Nada se
sobrescribe: corregir el síntoma deja visible el anterior.

Los estados son los de `INCIDENTS_REPORTING.md` §7. **Solo una persona cambia de estado**; el
programa propone. `Closed` exige una conclusión humana escrita; `VerifiedEffective` exige una
verificación con las mismas medidas antes y después (R-INC-003).

### 2. La ventana tiene tres partes y sus márgenes salen de las medidas

- **Durante**: el síntoma, fijado por la persona o heredado del hallazgo.
- **Antes**: por defecto, el p50 de una vuelta del circuito en ese régimen. Una perturbación que
  llega a un punto puede venir de cualquier punto anterior del anillo (R-AGV-021), y en una vuelta
  cabe todo el anillo.
- **Después**: por defecto, hasta la **vuelta a la calma** medida (§4) más una vuelta, para ver el
  eco. Si la calma no llega dentro de la cobertura, hasta el final de la cobertura, y se dice.

Se guardan la ventana propuesta y la elegida. Un tope máximo, si hace falta, va a configuración
versionada (`CONFIG_SCHEMA.md`), nunca al código.

### 3. Evidencia mínima reproducible: el expediente guarda su recorte

Con ADR-0015 las lecturas en crudo solo viven en las dos últimas exportaciones cargadas, así que un
expediente que dependiera de ellas dejaría de poder recalcularse. El expediente copia **las
lecturas normalizadas de su ventana, de toda la flota del circuito** —la onda se mide en los
demás AGV, no solo en el del síntoma—, con fuente, hash y fila, y congela las versiones con las que
se midió: algoritmo, configuración, memoria consolidada vigente, plano (último evento aplicado) y
reglas. Recalcular desde el recorte con esas versiones da el mismo resultado, byte a byte
(ADR-0013); una prueba lo comprueba.

Responde a OQ-P02 con una forma: el recorte es exactamente la ventana, de toda la flota. Su
tamaño se presupuesta en `PERFORMANCE_BUDGET.md` al implementarlo.

### 4. La repercusión se mide como una onda

Para cada incidencia con un **epicentro** —una parada sin explicación, el primero de una cola sin
avanzar, un AGV que deja de leer o una parada de la línea—, en su ventana y en régimen de
producción:

| Medida | Qué es | De dónde sale |
|---|---|---|
| **Epicentro** | AGV, ubicación (o tag sin plano), zona cargada o vacía, inicio, fin, duración | R-AGV-017, R-AGV-018, ADR-0016 |
| **Frente aguas arriba** (cola) | Cada AGV retenido cuya cadena de cola acaba en el epicentro: cuándo llegó, dónde, cuánto esperó por encima del p50 de su tramo. Profundidad (cuántos), alcance (cuántas ubicaciones hacia atrás), velocidad del frente (ubicaciones por minuto) y orden y tiempo de la descarga | R-AGV-018, R-FLO-008 |
| **Frente aguas abajo** (hueco) | En cada ancla y punto crítico por delante, el tiempo entre pasos consecutivos frente a su horquilla: cuándo llega el hueco, cuánto mide y cuánto se ha estirado o encogido desde el epicentro | R-TIM-012, R-FLO-010 |
| **Pulmón** | Ocupación minuto a minuto antes, durante y después: si absorbió el hueco o se vació | R-FLO-010 |
| **Línea** | Tiempo sin paso por encima de la valla y pasos que faltan frente a su ciclo local dentro de la ventana | R-FLO-010 |
| **Coste acumulado** | AGV·minutos por encima del p50 de cada tramo, separados en epicentro, cola y resto de la flota | R-FLO-007 |
| **Atenuación** | El exceso por distancia al epicentro (en ubicaciones o secciones) y por tiempo: un mapa espacio-tiempo del anillo | horquillas por tramo |
| **Eco** | Si los AGV que salieron juntos de la cola siguen juntos una vuelta después (separaciones por debajo de lo habitual en la línea) | cadencia de la línea |
| **Vuelta a la calma** | El primer instante tras el fin del epicentro desde el que la zona afectada vuelve a su horquilla: cola descargada, cada AGV afectado con una transición libre, y la cadencia y las separaciones de la línea dentro de su valla durante un tramo de estabilización. **Tiempo de recuperación** = calma − fin del epicentro | todas las anteriores |

Cada cifra se compara contra el **esperado**: la memoria consolidada vigente si existe y, si no, la
horquilla del propio fichero, y se dice cuál. La representación es un diagrama espacio-tiempo
(ubicaciones del anillo × tiempo) con el exceso en color y los dos frentes visibles; en el replay,
los anillos que se alejan del epicentro. Es una medición, no un modelo de tráfico: la analogía de
las ondas de choque no se usa para predecir nada que no se haya leído.

**Lo que la onda no afirma, y dice:**

- **Ondas superpuestas.** Si otro epicentro cae dentro de la ventana y del alcance, las cifras se
  dan juntas con «ondas superpuestas» y el reparto entre ellas es `unknown`. No se prorratea.
- **Interrumpida.** Una parada de la producción, un descanso o el paso a la noche dentro de la
  ventana cortan la medida: la calma es «sin medir», no se alarga hasta el turno siguiente.
- **Fuera de cobertura.** Si la cobertura acaba antes de la calma, el tiempo de recuperación es «al
  menos X», nunca X.
- **Zona vacía y calles de carga.** Donde se admite reordenación (R-FLO-002, R-FLO-006) un AGV
  puede rodear al parado: la cola pierde confianza y se dice.
- **Tramos sin horquilla.** Su exceso es `unknown`, no cero.
- **Tags poco leídos.** La posición de cada AGV es una banda (`INCIDENTS_REPORTING.md` §5), y el
  alcance del frente se da con ella.

### 5. Lenguaje de causalidad: cuándo se puede decir cada cosa

| Se dice | Cuándo | Quién |
|---|---|---|
| **precede** | A empieza antes que B dentro de la ventana. Solo orden en el tiempo | el programa |
| **es compatible con** | Hay un mecanismo de la guía que une A y B y las cifras encajan: B está en la cadena de cola de A, o el hueco de A llega al punto de B con el tiempo de viaje del tramo dentro de su horquilla | el programa |
| **correlaciona** | En la biblioteca de casos, A y B aparecen juntos más de lo que da el azar con sus frecuencias | el programa, con la prueba y su número de casos |
| **confirmado como causa** | Una persona lo afirma con evidencia registrada | solo una persona |

Estar en la cola del epicentro es un hecho del flujo («retenido detrás de»), no una causa de nada
más. Que la línea se quede sin AGV cuando llega el hueco es «compatible con», nunca «causado por»,
hasta que una persona lo confirme. La interfaz y el informe no usan otros verbos (R-EVI-006).

### 6. Separado de la memoria normal

El expediente vive en su propio almacén por circuito. Guardarlo, medirlo o cerrarlo no toca el
grafo, las horquillas ni el plano (R-INC-001, R-INC-002); su ventana sale del esperado al
consolidar (R-INC-004). Un aprendizaje general se propone como cambio de regla o configuración y
pasa por su propia decisión.

### 7. La firma de la onda alimenta la similitud y la verificación

La biblioteca de casos compara, además de zona, síntoma, duración y horario, la **firma de la
onda**: profundidad, alcance, coste, si el pulmón absorbió, tiempo de recuperación y eco. Y una
contramedida se verifica con esas mismas medidas: incidencias parecidas antes y después de su
fecha, con su número de casos (responde en parte a OQ-P07).

## Qué se mide hoy y qué se podrá medir

La onda se diseña para que cada fuente nueva la afine sin cambiar su definición:

| Con | Se mide |
|---|---|
| Fecha–AGV–Tag (hoy) | La onda en ubicaciones y en tiempo de tramo, con las bandas de los tags poco leídos |
| Informe ampliado con segundos y eventos (DS-011) | Frentes con resolución de segundos y los eventos de uso como contexto del epicentro |
| Plano con coordenadas y distancias (ADR-0016, hoy sin ellas) | Velocidad del frente en metros por minuto y ocupación frente a capacidad de cada espacio (R-GRA-013) |
| Varios circuitos con zonas compartidas (F7) | Si la onda cruza a otro circuito por un cruce o un semáforo, en la vista de zona, sin mezclar circuitos (ADR-0004) |
| Observación cercana a tiempo real (F8) | La onda mientras ocurre, solo observada. Nunca una acción sobre los equipos |

## Consecuencias

- Al aceptarse, las reglas nuevas (onda, ventana, lenguaje) entran en `RULE_CATALOG.md` con su
  caso positivo, su caso límite y el que no debe diagnosticar, y el algoritmo en
  `ALGORITHM_CATALOG.md`. La auditoría sintética gana una clase plantada: un AGV cargado detenido
  7 minutos en una flota sintética, con la cola, el hueco, la línea y la calma esperados escritos
  antes de medir.
- El almacén local gana la tabla de expedientes y el `.agvproj` una sección `incidencias` con los
  recortes (OQ-161). Los esquemas anteriores se siguen abriendo.
- Los parámetros que no salen de las medidas —el tramo de estabilización de la calma y el tope de
  la ventana— van a configuración versionada con estado `draft` hasta calibrarlos con planta.
- Implementado en 3.65.0: la onda (`src/domain/incident-wave.ts`, R-INC-005, ALG-024) y el registro
  del expediente con su recorte (`src/domain/incident-case.ts`, R-INC-006, R-INC-007). El almacén,
  la sección del `.agvproj`, las columnas de la batería (OQ-160) y la interfaz son las entregas
  siguientes de F5.

## Alternativas descartadas

- **Medir solo la duración del epicentro.** Siete minutos con el pulmón lleno y siete minutos con
  la línea sin AGV son incidencias distintas; la duración no las separa.
- **Guardar solo las lecturas del AGV del síntoma.** La onda está en los demás.
- **Referenciar las lecturas por fuente en vez de copiarlas.** Con ADR-0015 esas lecturas se
  retiran; el expediente dejaría de reproducirse.
- **Modelar el circuito como un flujo continuo y simular la onda.** Afirmaría posiciones que nadie
  leyó. Aquí solo se mide lo observado y se dice lo que falta.
