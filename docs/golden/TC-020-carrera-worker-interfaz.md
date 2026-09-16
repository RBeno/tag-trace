---
document_id: TT-GOLD-020
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-16
---

# TC-020 — Carrera entre el Worker y la interfaz

## Propósito y reglas cubiertas

Es el caso que nace del defecto real del prototipo: la interfaz mostraba `0 lecturas válidas` y el
fallo se enmascaró re-ejecutando el análisis en el hilo principal en lugar de corregirse. Este caso
cierra esa vía.

Contrato: `WORKER_PROTOCOL.md` WP-001 a WP-008. Decisión: ADR-0008. Riesgo: RSK-007.
Invariante: INV-006.

## Fixture sintético

Un conjunto de lecturas sintéticas válidas y un Worker instrumentado que permite forzar cada
ordenación adversa:

| Escenario | Qué se fuerza |
|---|---|
| A | El `complete` de un trabajo anterior llega **después** de haber iniciado el siguiente. |
| B | Se envía `cancel`; el `complete` llega antes que el `cancelled`. |
| C | El Worker devuelve cero filas aceptadas de forma **legítima**, con causa. |
| D | El Worker no llega a emitir `accepted`: no arranca. |
| E | El Worker tarda más que el plazo de cortesía en atender la cancelación. |

## Configuración aplicable

`cancel_grace_ms` declarado en configuración, no fijado en el código.

## Resultado esperado

- **A**: el mensaje con `job_id` caducado se descarta sin tocar vista ni persistencia.
- **B**: el estado final es `cancelled`, nunca `complete`. El proyecto queda como estaba antes.
- **C**: se publica `NO_ACCEPTED_ROWS` con esquema detectado, causa, filas de ejemplo saneadas y
  acción de recuperación. Cero filas es una respuesta válida.
- **D**: error explicado por no arrancar; ningún análisis alternativo.
- **E**: tras el plazo se recurre a `terminate()`, se registra el incidente y el estado queda
  `cancelled`.
- En los cinco, un perfil de rendimiento no muestra parseo ni análisis en el hilo principal.

## Resultados prohibidos

- Cualquier cálculo de repuesto en el hilo principal, incluso como recuperación.
- `0 lecturas` sin esquema, causa ni ejemplos.
- Un `complete` que gane a una cancelación ya emitida.
- Un proyecto parcial persistido tras cancelar.
- Que el estado avance por un mensaje de un trabajo ya caducado.
- Parsear la fuente dos veces en un mismo trabajo.

## Tolerancias

El plazo de cortesía admite la tolerancia declarada en configuración. El resto son comprobaciones
de estado, sin tolerancia.

## Evidencia navegable

El registro del trabajo debe conservar la secuencia de mensajes con su `job_id` y `seq`, de modo
que la ordenación adversa sea reproducible a partir del propio registro.

## Estabilidad

El estado final tras cancelar debe tener el mismo hash que el estado previo al inicio del trabajo.

## Aceptación

Responsable: propietario del producto. Fecha: pendiente de F1a.
