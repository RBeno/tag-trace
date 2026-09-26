---
document_id: TT-CONFIG-001
version: 0.22.0
status: baseline-candidate
last_updated: 2026-09-26
---

# Configuración de circuito

## 1. Por qué existe este documento

`RULE_CATALOG.md` marca como `configurable` los límites de zona, las calles CO, los puntos
críticos, el takt, los turnos, las pausas y el intervalo normal de lectura, y
`AI_DEVELOPMENT_GOVERNANCE.md` §4 prohíbe introducir constantes industriales no versionadas. Sin un
contrato de configuración, esos valores acaban repartidos por el código como números mágicos.

Este documento define **la forma** de la configuración. Los **valores** del circuito piloto son
configuración industrial local: se editan en el dispositivo y no se publican (ADR-0007, R-TIM-005).
El repositorio solo contiene ejemplos sintéticos.

## 2. Principios

1. Toda magnitud industrial vive aquí, nunca en el código.
2. Todo bloque tiene vigencia: `valid_from`, `valid_to` opcional, `origin` y `state`.
3. Cambiar un valor crea una versión nueva; no reinterpreta el pasado.
4. Un análisis registra qué versión de configuración aplicó (FR-031).
5. Un valor ausente es `unknown`, no un valor por defecto silencioso.

## 3. Bloques

### 3.1 Identidad y tiempo

| Campo | Nota |
|---|---|
| `circuit_id`, `name` | Identidad del agregado (ADR-0004). |
| `timezone` | Identificador IANA. Obligatorio: sin él no se puede segmentar por turno. |
| `dst_policy` | Cómo se representan las horas repetidas y las inexistentes del cambio horario (ADR-0013). |

### 3.2 Calendario productivo

Turnos, pausas, descansos, paradas planificadas y excepciones por fecha. Cada entrada con vigencia.
Alimenta R-TIM-003, R-TIM-004 y R-TIM-006: un periodo se compara con lo esperado para su horario,
nunca con una media que mezcle producción y parada.

**Regímenes** (R-TIM-009). La ventana de noche separa el estado normal del circuito del de la noche,
que se mide aparte:

```text
regimes : { night_from_hour, night_to_hour }   # hora local; puede cruzar la medianoche
```

Hoy vale 22:00–05:00 para todos los circuitos, por decisión del propietario, en la configuración
provisional (`src/domain/config.ts`, `draft`), como los turnos. Cuando exista el calendario del
circuito (OQ-108) pasa a él, con vigencia. Los descansos no se declaran: salen del dato como paradas
de la producción (R-AGV-018).

### 3.3 Ritmo

`takt`, unidad de medida y objetivo por turno, con vigencia (R-TIM-001, R-TIM-002).

### 3.4 Topología funcional

| Bloque | Contenido |
|---|---|
| `loaded_zone` | Límites de la zona cargada, donde se espera FIFO (R-FLO-001). |
| `empty_zone` | Límites de la zona vacía, donde se admite reordenación (R-FLO-002). |
| `co_lanes` | Una entrada por calle de carga online: identificador, tag de parada, secuencia de tags, capacidad (R-CO-001). |
| `critical_points` | Los **tags críticos**: tag, clase de función, grado 1–3 y redundancias (DS-005, R-GRA-007). Ver §3.4.1. |
| `lap_anchors` | El tag, o varios en orden de prioridad, que corta una vuelta (R-GRA-009). Ver §3.4.2. |
| `excluded_contexts` | Mantenimiento, asistencia y pastor, fuera del recorrido productivo (R-GRA-004). |

#### 3.4.1 Tags críticos y sus clases de función

Un tag es crítico cuando de él depende que el vehículo haga lo correcto, no por estar muy leído.
Las clases son cerradas y las declara el propietario:

```text
critical_points : lista de { tag, function, grade, redundancy, valid_from, valid_to }
function        : parada-precisa | parada | giro | cambio-de-mtc | cruce | semaforo
                | dejar-carro | recoger-carro | cambio-de-mapa | bifurcacion
                | vinculacion | desvinculacion | tramo-conflictivo | control-wifi
```

**Catorce clases**: el propietario añade después `tramo-conflictivo` (un tramo con un problema físico
conocido, como una arqueta metálica bajo la guía magnética) y `control-wifi` (manda continuar a los AGV
sin wifi), y explica el resto (R-GRA-007): la parada precisa espera al servidor, la condicionada a un
sensor, un pulsador o una radio; una `parada` es de seguridad y solo se reanuda a mano; los tags MTC
de carga online son `bifurcacion` hacia la calle que asigna el servidor; pin arriba y pin abajo son
recoger y dejar carro. El significado de cada una está en `FUNCTION_MEANING`
(`src/domain/tag-lists.ts`) y se enseña junto al punto crítico.

**Doce clases el 2026-09-26, primero**: el propietario añade `parada` (una parada que no es precisa),
`giro` y `cambio-de-mtc`, y declara que **toda función de planta es crítica**. Una función fuera de
estas clases no se rechaza ni se ignora: el tag cuenta como crítico con el nombre que planta le dio, y
se avisa una vez por función de que no tiene regla propia (R-GRA-007). Dos tags seguidos en la lista
`circuito` con la misma función son un **refuerzo** (R-GRA-016), salvo `cruce` y
`tramo-conflictivo`, que seguidos son una zona. Un `cambio-de-mtc` es un tag que cambia el multicircuito del AGV para hacer alguna
configuración especial; cuando la misma función va a destinos distintos, el destino va en `grupo`, y
dos seguidos con distinto `grupo` no son un refuerzo.

Antes de esa ampliación eran nueve clases, no siete: dejar y recoger carro son acciones físicamente distintas y se declaran por
separado, y lo mismo vinculación y desvinculación — sincronizar la velocidad del vehículo con la
línea de producción, o dejar de hacerlo para ir en paralelo, son dos acciones distintas y no una
función con dos estados. Es lo que ya implementa `src/domain/tag-lists.ts` (`LIST_FUNCTIONS.critico`),
y esta sección se corrige para contarlo, no al revés.

`cruce` **no es un bloque aparte**: es una de las clases, y cubre dos fenómenos distintos —el
cruce interno (dos ramas que reconvergen en pocos saltos dentro del mismo cohorte, con firma propia,
ver más abajo) y el cruce **entre circuitos**, protegido por un par de tags. Un tag de esta segunda
clase lleva además los campos que su función exige, y que ninguna otra necesita:

```text
cruce : { protection_pair: [tag, tag], expected_tag, target_circuit }
```

El par de protección existe para **detener** a un vehículo que se desvía, así que es lo que permite
decir *qué* falló cuando alguien se sale, y no solo *dónde* (R-AGV-009, R-AGV-011). `expected_tag`
es el tag que toca si el giro se ejecuta.

**Estado de implementación.** `grade`, `redundancy`, `valid_from`, `valid_to` y el bloque entero de
`cruce` entre circuitos (`protection_pair`, `expected_tag`, `target_circuit`) son aspiracionales: ni
`ConfigEntry` (`src/domain/circuit-config.ts`) ni `CatalogEntry` (`src/ingestion/catalog.ts`) los
llevan todavía. Lo que la lista `critico` transporta hoy es `tag` y `funcion` — suficiente para
R-GRA-008 (la omisión de un tag crítico declarado se cuenta aparte) y para contrastar candidatos
contra lo declarado, no para el resto de §3.4.1.

**Zonas compartidas entre circuitos (F7).** Los tags de cruce y semáforo compartidos no necesitan
un bloque nuevo: salen de la intersección de las listas `circuito` de los circuitos implicados
(R-GRA-012). Lo que sí habrá que declarar, porque el dato no lo da:

- **un tramo físico común**, cuyos tags son independientes en cada circuito: su tag de entrada y de
  salida en cada circuito, y su lado lleno o vacío;
- **la capacidad de cada espacio** —cuántos AGV caben entre un tag y el siguiente—, que depende de la
  distancia física (OQ-128);
- los pares de protección de cada cruce (OQ-121).

**La función se declara por dos vías que conviven.** La lista `critico` es la vía dedicada; la
columna `funcion` del circuito virtual (`circuito`, §3.8) es una vía alternativa para quien ya carga
ese fichero con esa columna y no quiere mantener dos ficheros. Las dos producen la misma
configuración interna (`readCriticalPoints`, `src/domain/circuit-config.ts`, no distingue de qué
lista viene cada entrada); si el mismo tag declara funciones distintas en las dos, gana la de
`critico` y la contradicción se declara, nunca se elige en silencio (R-EVI-004). Ver §3.4.3 para el
formato exacto.

**La función no se deduce del fichero.** El dato deja una firma por clase que sirve para proponer
candidatos —una espera regular apunta a temporizada, una variable explicada por el vehículo de
delante apunta a semáforo, dos ramas que reconvergen apuntan a cruce interno—, pero proponer no es
asignar. Y tres clases no dejan firma ninguna con lo disponible hoy: un `cambio-de-mapa` es
indistinguible de un tag cualquiera; `vinculacion`/`desvinculacion` tampoco —un cambio de
sincronización de velocidad no deja huella distinguible en `Fecha;AGV;Tag`, ni de tiempo ni de
topología—; y un `cruce` **entre circuitos** que nadie ha fallado tampoco se ve, porque existe
justamente para que todos pasen igual. Sin declaración, esas tres quedan `unknown`.

**Implementado hoy** (`src/domain/critical-points.ts`): candidatos con firma real para
**bifurcación**, **cruce interno**, **parada precisa** y **semáforo** — reparto de sucesores
sostenido en el tiempo, reconvergencia de dos ramas dentro de un margen de saltos, duración de poca
varianza y duración bimodal, respectivamente (R-GRA-007, Parte 35). `cambio-de-mapa`,
`vinculacion`/`desvinculacion` y el cruce entre circuitos son declaración pura, sin detector
estadístico: se leen del fichero, nunca se proponen (OQ-122, Parcial).

#### 3.4.2 Anclas de vuelta declaradas

Sin ancla declarada, la única disponible es la que el propio grafo revela: el ciclo dominante que
`findDominantCycle` sigue desde el sucesor mayoritario de cada tag (ALG-004). Esa ancla es siempre
`inferred`, aunque los datos sean perfectos, porque no hay ninguna declaración de planta que la
respalde — es una propiedad estadística del tráfico, no un punto de referencia conocido.

```text
lap_anchors : lista de { tag, order, valid_from, valid_to }
```

`order` fija la prioridad cuando se declara más de una: se prueba la primera contra el ciclo ya
reconstruido, y si no aparece en él se prueba la siguiente. Ninguna declarada, o ninguna presente en
el ciclo, deja el mecanismo tal como estaba — con el ancla inferida y su verdad `inferred` — en vez
de inventar un corte que el dato no sostiene.

**Lo que una ancla declarada cambia, y lo que no.** La topología —qué tags forman el anillo y en qué
orden— la sigue dando el tráfico observado; declarar un ancla no la recalcula, solo **rota** el mismo
ciclo para que empiece en el tag declarado (R-GRA-009). Y el estado de verdad que gana depende de la
vuelta, no solo del ancla: una vuelta `completa` —cerrada entre dos pasos por el ancla, sin cruzar un
hueco de cobertura— pasa a `observed`, porque sus dos extremos son el mismo punto de referencia
conocido. Una vuelta `parcial` **nunca** lo es, declarada o no la ancla: por definición uno de sus
dos extremos es un corte de los datos —el borde de la cobertura, o el principio/final de lo que se
importó—, no el ancla, y declararla `observed` ahí sería inventar certeza que el dato no sostiene.

**Estado de implementación.** `valid_from`/`valid_to` y una «confianza mínima» son aspiracionales:
ni la lista `ancla` (`src/domain/tag-lists.ts`) ni `readLapAnchors` (`src/domain/circuit-config.ts`)
los llevan todavía, y qué significaría exactamente una confianza mínima sobre un ancla declarada no
está definido — no hay valores de planta que lo motiven. Lo que la lista transporta hoy es `tag` y,
opcionalmente, `orden`.

#### 3.4.3 Cómo entra esta configuración: las listas de tags

Los bloques de §3.4 no se editan en ningún formulario: **entran como CSV o como libro de Excel**
(`.xlsx`, con la plantilla que se entrega: `DATA_CONTRACTS.md` §3.7), por el mismo camino que
la lista del circuito virtual y la de memoria (§3.8, DS-002/DS-005/DS-006/DS-008). No hay forma de
descargarlos de planta, se escriben a mano, y por eso la estructura se enseña en la pantalla antes
de pedir el fichero en lugar de esperar a que quien lo escribe la adivine.

Dos columnas obligatorias y el resto opcionales, localizadas **por nombre en cualquier posición**:

```text
lista;tag;orden;funcion;grupo;capacidad;nota
```

| Columna | Qué lleva |
|---|---|
| `lista` | `circuito`, `memoria`, `mantenimiento`, `emergencia`, `carga-online`, `critico`, `zona`, `ancla`, `noche`, `linea` o `tramo` |
| `tag` | El identificador, **tal cual**: `0040` no es `40` (R-DAT-001, INV-002) |
| `orden` | Posición dentro de la lista. Sin ella vale el orden de las filas del fichero |
| `funcion` | El papel del tag dentro de su lista |
| `grupo` | La agrupación: la calle en `carga-online`, la zona en `zona`, y en `critico` el destino o la variante de la función (la calle de una bifurcación a carga online, el número de MTC de un cambio de MTC, una parada precisa condicionada) |
| `capacidad` | Cuántos vehículos caben en esa agrupación (R-CO-001) |

Y así se expresan los bloques de §3.4:

| Bloque | Cómo se escribe |
|---|---|
| `co_lanes` | `lista=carga-online`, `grupo` = identificador de la calle, `orden` = 1…n y `funcion` ∈ `entrada`, `parada-precisa`, `salida`. `entrada` es opcional: sin ella, la calle empieza en su parada precisa. Un tag de la calle sin `funcion` es un paso intermedio |
| `loaded_zone` / `empty_zone` | `lista=zona`, `grupo` ∈ `cargado`, `vacio`, una fila por tag |
| `critical_points` | `lista=critico`, `funcion` con una de las doce clases de §3.4.1, o la función de planta tal cual (cuenta como crítica y se avisa). **Alternativa**: `lista=circuito` con la misma `funcion` en la fila del tag — las dos vías conviven, `critico` gana en caso de contradicción |
| `lap_anchors` | `lista=ancla`, `orden` = prioridad cuando se declara más de una (§3.4.2) |
| tramos | `lista=tramo`, `grupo` = nombre del tramo (kitting, línea, cruce…): se dibuja en las gráficas del anillo y no cambia ningún cálculo (R-GRA-018) |
| la línea | `lista=linea`, `orden` = 1…n: los tags de la línea de producción; el primero es la entrada, donde se mide la cadencia y el pulmón (R-FLO-010). El pulmón no se declara: sale de las medidas |
| tags de noche | `lista=noche`, una fila por tag: los que pueden aparecer de noche en el circuito. Explican un tag que solo se lee de noche (R-DAT-022) y son `especial` en el inventario |

```text
carga-online;70011;1;entrada;calle-1;2
carga-online;70012;2;parada-precisa;calle-1;2
carga-online;70013;3;salida;calle-1;2
zona;51944;;;vacio
critico;102185;;bifurcacion
circuito;103358;12;vinculacion
ancla;51944;1
```

Una calle puede **empezar en su parada precisa**: en algunos circuitos el primer tag de la calle es el
último que se lee antes de una espera de muchos minutos. Entonces se declara sin `entrada`
(`parada-precisa`, los intermedios sin función y `salida`) y la estancia va de la parada a la salida.

```text
carga-online;70021;1;parada-precisa;calle-2
carga-online;70022;2;;calle-2
carga-online;70023;3;salida;calle-2
```

**Lo que no se puede montar se declara, no se completa.** Una calle sin `parada-precisa` o sin
`salida`, o con dos tags reclamando el mismo papel, **no se usa**, y su motivo aparece junto al análisis. Adivinar cuál
de los tres tags es la parada por su posición sería sustituir la configuración por proximidad, que
es lo que R-CO-006 prohíbe con esas palabras. La consecuencia es visible y conviene que lo sea: sin
la calle montada, sus cargas vuelven a contarse como silencios.

Un valor de `funcion` fuera de la taxonomía **no invalida la fila** —el tag sigue perteneciendo a su
lista— pero sí impide montar la calle o el punto crítico que dependieran de él, y se dice.

### 3.5 Parámetros de análisis

Aquí viven los umbrales que de otro modo se colarían como constantes:

| Parámetro | Regla asociada |
|---|---|
| `reading_interval_profile` | R-OPP-006: no existe umbral universal en el código. |
| `affinity_thresholds` | ALG-003: fronteras entre `compatible`, `partially-compatible`, `foreign-suspected` y `unknown`. |
| `health_weights` | ALG-008: pesos de los componentes de salud. Hasta calibrarlos con casos de oro, la aplicación muestra los componentes por separado y **no** publica una salud compuesta. |
| `min_support` | Soporte mínimo por contexto antes de crear un perfil esperado. |
| `gap_policy` | Cuándo un hueco es censurable frente a reconstruible (R-OPP-004, R-OPP-005). |
| `cancel_grace_ms` | Plazo de cortesía antes de `terminate()` (WP-004). |
| `min_band_samples` | R-FLO-007: muestras mínimas de un tramo en un régimen para su horquilla. |
| `min_stop_excess_ms` | R-FLO-007: margen mínimo de la valla sobre el p95 de un tramo. |
| `dark_zone_factor` | R-GRA-014: cuántas veces el hueco típico del circuito hace oscuro un tramo. |
| `max_false_points` | R-FLO-008, R-FLO-009: puntos marcados por azar que se aceptan en todo el circuito. |
| `charging.long_stay_ratio`, `charging.min_stays_for_median` | R-CO-002: cuántas veces la estancia habitual hace larga una permanencia, y cuántas estancias completas hacen falta para tener una habitual. |
| `charging.usage_max_chance`, `charging.usage_min_deviation` | R-CO-009: azar máximo y desviación mínima (fracción de la parte que le tocaría) para señalar una calle que se usa menos o más que las demás. Provisionales: 0,001 y 0,25. |

### 3.6 Cohortes

Agrupaciones de AGV o de modelos de lector cuyo comportamiento difiere de forma material
(R-AGV-004). Una cohorte declarada obliga a perfiles esperados separados.

### 3.7 Catálogos de la fuente

Las fuentes enriquecidas traen columnas con vocabulario cerrado del sistema de planta: el catálogo
de **usos** (acciones y paradas de vehículo) y el de **defectos de equipo**. Ambos están obtenidos y
son cerrados; buena parte de sus valores llevan además un código numérico propio, y los defectos
aparecen emparejados error/restablecimiento.

Son configuración versionada, no constantes del código:

```text
usage_catalog  : lista de { code, text, implies_stop, valid_from, valid_to }
defect_catalog : lista de { code, text, pairs_with, valid_from, valid_to }
```

`implies_stop` es la parte que **no** está resuelta: saber que un valor existe no dice si implica
una parada real del vehículo, y de eso depende que un silencio se explique o se diagnostique. Hasta
que el propietario lo confirme (OQ-111), un evento de uso se conserva con su texto y no alimenta
ningún diagnóstico.

**Las listas literales no viven en este repositorio.** Son vocabulario del sistema de un cliente:
van en la configuración local del circuito, junto al resto de valores de planta. Aquí queda su
forma y su régimen de vigencia.

### 3.8 Listas de tags: memoria, circuito virtual y especiales

Cuatro listas que entran como configuración versionada, no como fuente de lecturas. Cada una con su
**fecha de extracción**, que no es metadato prescindible: una lista de marzo no puede clasificar una
ventana de septiembre, y sin vigencia declarada el inventario sale `unknown` diciendo por qué
(OQ-123).

```text
tag_lists:
  memory      : { tags[], extracted_at, scope: master | per_vehicle, valid_from, valid_to }
  virtual     : { tags[], extracted_at, ordered: bool, valid_from, valid_to }
  maintenance : { tags[], extracted_at, valid_from, valid_to }
  emergency   : { tags[], extracted_at, valid_from, valid_to }
```

`ordered` dice que la lista trae un orden, y ese orden es `expected`: puede tener erratas al
transcribir o ser distinto al real. La posición de cada tag la dan las lecturas; donde difieren, la
aplicación enseña el orden leído y la corrección de la lista (R-GRA-015).

`scope` no es un detalle de formato: decide el estado de verdad de todo lo que se derive.

| `scope` | Qué es la lista | Memoria del vehículo individual |
|---|---|---|
| `master` | la que cada vehículo **debería** llevar | `expected`; la desviación se infiere (R-OPP-012) |
| `per_vehicle` | el inventario real de cada uno | `observed`; la discordancia se lee directamente |

Hoy lo disponible es `master`. El esquema admite `per_vehicle` porque cerraría R-OPP-009 del todo,
no porque exista.

**La lista de memoria no es el universo de oportunidades**, y confundirlas es el error que
R-OPP-011 impide: contiene tags obsoletos que ya no están instalados, y contarlos como oportunidad
fabrica averías. El universo elegible es la lista de memoria **menos** lo que no existe, y lo que no
existe se determina con dos ventanas, no con configuración.

### 3.9 Flota asignada al circuito

Qué vehículos pertenecen al circuito y en qué periodo. Es el denominador M del recuento «N de M en
funcionamiento» (R-AGV-014); sin él, M son los vehículos vistos en las lecturas y la vista lo declara.

```text
fleet_history:
  - { agv, valid_from, valid_to?, note? }   # periodo [valid_from, valid_to); valid_to vacío = vigente
```

Se transporta en CSV o en Excel como DS-012 (`DATA_CONTRACTS.md` §3.6 y §3.7): `circuito;agv;desde;hasta;nota`, con
`desde` → `valid_from` y `hasta` → `valid_to`. A diferencia de las listas de §3.8, **se fusiona** por
(AGV, `valid_from`) en lugar de sustituirse entero, para que un alta o una baja se registren subiendo
solo su fila. El valor elegido de la columna `circuito`, cuando el fichero trae varios, se guarda con
el circuito y se reutiliza en las cargas siguientes.

## 4. Vigencia y versionado

```text
config_version : CIRCUIT-<id> config <fecha>.<n>
valid_from     : instante desde el que aplica
valid_to       : opcional; vacío significa vigente
origin         : quién o qué la introdujo
state          : draft | active | superseded
```

Una configuración `draft` permite analizar en modo exploratorio pero **no** consolidar. Un análisis
que abarque dos vigencias distintas debe separarse por tramos o declararse `unknown` en la frontera.

## 5. Privacidad

Los valores reales de takt, turnos, zonas, capacidades y puntos críticos revelan capacidad y
organización de la planta. No se publican ni siquiera anonimizados (`SECURITY_PRIVACY.md` §1).
Los ejemplos del repositorio viven en `fixtures/synthetic/` con manifiesto `synthetic: true`, e
incluyen el circuito de cinco calles CO exigido por R-CO-001.

## 6. Formalización pendiente

El esquema ejecutable (`schemas/circuit-config.schema.json`) y su validador se crean en F1a, junto
al primer editor de configuración. Este documento fija qué debe contener; la sintaxis exacta se
decide con el primer código y se registra aquí sin cambiar los principios.
