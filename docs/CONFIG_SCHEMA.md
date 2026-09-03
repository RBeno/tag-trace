---
document_id: TT-CONFIG-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
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
| `critical_points` | Tag, función, grado 1–3 y redundancias (DS-005). |
| `lap_anchors` | Anclas que permiten cortar vueltas; admite varias y una confianza mínima (OQ-102). |
| `excluded_contexts` | Mantenimiento, asistencia y pastor, fuera del recorrido productivo (R-GRA-004). |

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
