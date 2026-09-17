---
document_id: TT-CONFIG-001
version: 0.5.0
status: baseline-candidate
last_updated: 2026-09-17
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

### 3.3 Ritmo

`takt`, unidad de medida y objetivo por turno, con vigencia (R-TIM-001, R-TIM-002).

### 3.4 Topología funcional

| Bloque | Contenido |
|---|---|
| `loaded_zone` | Límites de la zona cargada, donde se espera FIFO (R-FLO-001). |
| `empty_zone` | Límites de la zona vacía, donde se admite reordenación (R-FLO-002). |
| `co_lanes` | Una entrada por calle de carga online: identificador, tag de parada, secuencia de tags, capacidad (R-CO-001). |
| `critical_points` | Los **tags críticos**: tag, clase de función, grado 1–3 y redundancias (DS-005, R-GRA-007). Ver §3.4.1. |
| `lap_anchors` | Anclas que permiten cortar vueltas; admite varias y una confianza mínima (OQ-102). |
| `excluded_contexts` | Mantenimiento, asistencia y pastor, fuera del recorrido productivo (R-GRA-004). |

#### 3.4.1 Tags críticos y sus clases de función

Un tag es crítico cuando de él depende que el vehículo haga lo correcto, no por estar muy leído.
Las clases son cerradas y las declara el propietario:

```text
critical_points : lista de { tag, function, grade, redundancy, valid_from, valid_to }
function        : parada_precisa | cruce | semaforo | dejar_recoger_carro
                | cambio_de_mapa | bifurcacion
```

`cruce` **no es un bloque aparte**: es una de las seis clases. Un tag de esa clase lleva además los
campos que su función exige, y que ninguna otra necesita:

```text
cruce : { protection_pair: [tag, tag], expected_tag, target_circuit }
```

El par de protección existe para **detener** a un vehículo que se desvía, así que es lo que permite
decir *qué* falló cuando alguien se sale, y no solo *dónde* (R-AGV-009, R-AGV-011). `expected_tag`
es el tag que toca si el giro se ejecuta.

**La función no se deduce del fichero.** El dato deja una firma por clase que sirve para proponer
candidatos —una espera regular apunta a temporizada, una variable explicada por el vehículo de
delante apunta a semáforo, dos ramas que reconvergen apuntan a bifurcación—, pero proponer no es
asignar. Y dos clases no dejan firma ninguna: un `cambio_de_mapa` es indistinguible de un tag
cualquiera, y un `cruce` que nadie ha fallado y que recorre un solo circuito tampoco se ve, porque
un cruce existe justamente para que todos pasen igual. Sin declaración, esas dos quedan `unknown`.

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
