---
document_id: TT-WORKER-001
version: 0.5.0
status: baseline-candidate
last_updated: 2026-09-27
---

# Protocolo entre la interfaz y los Workers

## 1. Por qué existe este documento

ADR-0008 exige que todo cálculo pesado salga del hilo principal, RSK-007 identifica la carrera
Worker/UI como riesgo alto y TC-020 la convierte en caso de oro. Hasta ahora ningún documento
definía el contrato, y el prototipo demuestra qué ocurre sin él: la interfaz parseaba las fuentes
en el hilo principal «como comprobación previa», el Worker las volvía a parsear, y cuando el
resultado del Worker llegaba vacío la interfaz repetía el análisis completo en el hilo principal
para disimularlo. El síntoma visible fue un bloqueo en móvil y el mensaje `0 lecturas válidas`.

Este documento es normativo. Las expresiones **debe**, **no debe** y **solo** tienen su significado
habitual.

## 2. Reglas duras

| ID | Regla |
|---|---|
| WP-001 | Una fuente **debe** parsearse una sola vez por trabajo, y siempre dentro del Worker. La interfaz no parsea, ni siquiera para validar. |
| WP-002 | Ningún camino de recuperación **debe** ejecutar parseo o análisis en el hilo principal. Si el Worker falla, el resultado es un error explicado, nunca un cálculo de repuesto. |
| WP-003 | Todo mensaje **debe** llevar `job_id` y `protocol_version`. Un mensaje cuyo `job_id` no sea el trabajo vigente se descarta sin tocar el estado. |
| WP-004 | La cancelación **debe** ser cooperativa, mediante puntos de control deterministas. `terminate()` solo se admite como último recurso tras vencer el plazo de cortesía, y deja el estado en `cancelled`, nunca en `complete`. |
| WP-005 | Un resultado vacío **debe** ser un resultado legítimo y explicado, no un síntoma que la interfaz corrija. Si el Worker devuelve cero lecturas, esa es la respuesta y debe venir con causa y ejemplos. |
| WP-006 | Los bloques grandes **deben** viajar como `Transferable`. Está prohibido clonar el contenido íntegro de una fuente en cada mensaje. |
| WP-007 | Un resultado parcial **debe** marcarse `partial: true` y **no** puede consolidarse ni persistirse como memoria normal. |
| WP-008 | El progreso **debe** publicarse por etapa con unidad conocida, para que la interfaz no invente porcentajes. |

## 3. Ciclo de vida de un trabajo

```mermaid
stateDiagram-v2
  [*] --> Queued: start
  Queued --> Running: accepted
  Running --> Running: progress / partial
  Running --> Complete: complete
  Running --> Failed: error
  Running --> Cancelling: cancel
  Cancelling --> Cancelled: cancelled
  Cancelling --> Complete: terminó antes de atender la cancelación
  Complete --> [*]
  Failed --> [*]
  Cancelled --> [*]
```

Solo `Complete`, `Failed` y `Cancelled` son estados finales. La interfaz mantiene como mucho un
trabajo vigente por circuito; iniciar otro cancela el anterior antes de encolar el nuevo.

## 4. Mensajes

Sobre común de todo mensaje:

```text
protocol_version : entero, incompatible al cambiar
job_id           : identificador único del trabajo
seq              : número de secuencia creciente dentro del trabajo
type             : start | accepted | progress | partial | complete | error | cancel | cancelled
```

### De la interfaz al Worker

| `type` | Carga | Nota |
|---|---|---|
| `start` | referencias a fuentes, configuración vigente, versiones de reglas/algoritmos, semilla | Las fuentes viajan como `File`/`ArrayBuffer` transferido, no como texto ya leído. |
| `cancel` | motivo | El Worker debe atenderla en el siguiente punto de control. |
| `lists` | fichero de listas de tags, circuito | Sustituye las listas del circuito por las del fichero. |
| `fleet` | fichero de historial de flota (DS-012), circuito, valor de `circuito` elegido si ya lo hay | Se **fusiona** con lo guardado por (AGV, `desde`); no sustituye. |
| `consolidate` | circuito, fichero base (`sourceId`), `mode: "preview" \| "commit"`, nota opcional | `preview` no escribe nada. `commit` solo se envía tras la confirmación humana, y el Worker vuelve a calcular la previsualización desde el almacén antes de escribir: con bloqueos responde `error` (R-MEM-001). |
| `revoke` | circuito, número de versión, razón | Marca la versión con fecha y razón; no la borra (R-MEM-002). |
| `compare-versions` | circuito, dos números de versión | Solo lee: compara los esperados de dos versiones del linaje activo. |
| `plan-action` | circuito, fichero de trabajo, acción: `crear-plano` (desde una versión), `aceptar-propuesta` (id y fichero de la propuesta; en una salida, de qué ubicación cuelga) o `evento` (uno registrado a mano), siempre con razón | El Worker recalcula la propuesta desde la instantánea de su fichero antes de escribirla, valida todos los eventos en orden y los escribe en una transacción (ADR-0016). |
| `resolve-fork` | circuito, elección (`conservar-local` \| `adoptar-entrante`), razón | Resuelve una bifurcación de linaje; el linaje no elegido queda archivado y la elección, en el historial (`MEMORY_CONSOLIDATION.md` §10). |

### Del Worker a la interfaz

| `type` | Carga | Nota |
|---|---|---|
| `accepted` | etapas previstas | Confirma que el trabajo empezó; sirve para detectar Workers que no arrancan. |
| `progress` | etapa, unidades hechas, unidades previstas, mensaje | Sin porcentajes inventados. |
| `partial` | resultado incompleto | Siempre `partial: true`. |
| `complete` | resultado, métricas, hash semántico, advertencias | Único mensaje que autoriza a persistir. |
| `error` | código, causa, esquema detectado, filas de ejemplo, acción sugerida | Ver §6. |
| `cancelled` | etapa alcanzada, recursos liberados | El estado anterior permanece intacto. |
| `lists-loaded` | listas aceptadas, rechazos por motivo, avisos | Las vistas se recalculan en la siguiente importación. |
| `fleet-loaded` | valor de circuito usado, filas aceptadas, rechazos por motivo, añadidas, sustituidas, periodos guardados, avisos | Como `lists-loaded`, no dispara análisis por sí mismo. |
| `fleet-choose-circuit` | valores de la columna `circuito` con su número de filas | El fichero trae varios circuitos: la interfaz pregunta cuál es este y reenvía `fleet` con la respuesta. Nada se guarda hasta entonces. |
| `consolidation-preview` | qué pasaría al consolidar: fichero base, versión vigente, siguiente número, delta, bloqueos con sus elementos, avisos, decisiones, bytes estimados | Nada se ha escrito. |
| `consolidated` | la versión escrita y la memoria del circuito (`MemoryViews`: versiones resumidas, vigente, comparación, bytes, linaje) | Único mensaje que confirma una consolidación. |
| `revoked` | número revocado y la memoria del circuito | |
| `fork-resolved` | la memoria del circuito tras la elección | |
| `versions-compared` | la comparación: las dos versiones, las de entre medias, lo adoptado por el camino y el delta | |
| `plan-updated` | los eventos escritos en palabras y el plano (`PlanViews`) leído contra el fichero de trabajo | |

Las vistas de una importación (`complete.views`) llevan `memory` cuando el circuito tiene versiones:
la lista resumida, la vigente, **lo observado frente a la memoria** (la instantánea del fichero de
trabajo comparada con la vigente), los bytes que ocupan todas las versiones y el estado de linaje.
Y `plan` cuando el circuito tiene plano o una versión vigente desde la que crearlo: el plano actual,
los eventos con su línea en palabras, la observación del fichero de trabajo, el resumen de todas las
instantáneas y las propuestas. Con plano, los cambios de la evolución y de la comparación con la
memoria se leen con él: un tag instalado que no se lee sale «sin leer en su ubicación».

## 5. Cancelación

1. La interfaz envía `cancel` y pasa a `Cancelling`.
2. El Worker atiende la petición en el siguiente punto de control y responde `cancelled`.
3. Si no responde dentro del plazo de cortesía configurado, la interfaz llama a `terminate()`,
   registra el incidente y deja el estado en `cancelled`.
4. Cancelar **no debe** dejar proyecto parcial, consolidación a medias ni memoria escrita (INV-006).
5. Las fuentes originales permanecen intactas.

## 6. Errores

Un error se identifica por código estable y **debe** llevar causa legible, esquema detectado, filas
de ejemplo saneadas y acción de recuperación. `UX_SPEC.md` §8 lo exige y el prototipo lo incumplía.

| Código | Significado |
|---|---|
| `SOURCE_UNREADABLE` | El fichero no se pudo leer o decodificar. |
| `SCHEMA_UNRECOGNISED` | No se identificaron las columnas mínimas Fecha–AGV–Tag. |
| `DELIMITER_AMBIGUOUS` | La puntuación de confianza del delimitador no alcanza el mínimo. |
| `DATE_AMBIGUOUS` | Formato día/mes indistinguible; prohibido resolver por suposición. |
| `NO_ACCEPTED_ROWS` | Se leyeron filas pero ninguna superó la validación. Debe detallar por qué. |
| `LIMIT_EXCEEDED` | Se superó un límite de tamaño, celdas o memoria declarado. |
| `CIRCUIT_FOREIGN` | La huella de afinidad sitúa la fuente en otro circuito. |
| `INTERNAL` | Defecto del propio motor; nunca debe usarse para tapar los anteriores. |

Ningún mensaje de error **debe** incluir contenido bruto sin sanear (TH-003).

## 7. Criterios de aceptación

Estos criterios se verifican en F1a y son la traducción ejecutable de TC-020 y RSK-007.

- [ ] Un perfil de rendimiento durante la importación no muestra parseo en el hilo principal.
- [ ] El hilo principal cumple el presupuesto de tarea larga de `PERFORMANCE_BUDGET.md` §3.
- [ ] Un mensaje con `job_id` caducado no altera la vista ni la persistencia.
- [ ] Cancelar a mitad deja el proyecto en el estado anterior, comprobado por hash.
- [ ] Un fichero sin filas válidas produce `NO_ACCEPTED_ROWS` con esquema, causa y ejemplos.
- [ ] Sustituir el Worker por uno que responde vacío **no** dispara ningún cálculo alternativo.
- [ ] Reordenar artificialmente la llegada de `progress`, `complete` y `cancelled` no produce un
      estado incoherente.
