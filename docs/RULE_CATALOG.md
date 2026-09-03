---
document_id: TT-RULES-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Catálogo de reglas industriales

Cada regla tiene un estado: **accepted** (decisión ya establecida), **candidate** (hipótesis que exige validación) o **configurable** (no debe codificarse como constante universal).

## Evidencia y diagnóstico

| ID | Estado | Regla |
|---|---|---|
| R-EVI-001 | accepted | Una lectura solo es `observed` si existe en una fuente trazable. |
| R-EVI-002 | accepted | Una lectura ausente nunca se crea para completar una ruta. Puede registrarse una oportunidad o posición inferida. |
| R-EVI-003 | accepted | Todo diagnóstico separa evidencia, inferencia, confianza, impacto y comprobación recomendada. |
| R-EVI-004 | accepted | `unknown` es preferible a una clasificación no sustentada. |
| R-EVI-005 | accepted | Una inferencia confirmada conserva su origen inferido y añade la confirmación humana. |

## Identidad y fuentes

| ID | Estado | Regla |
|---|---|---|
| R-DAT-001 | accepted | Tags y AGV son texto; deben conservarse ceros iniciales. |
| R-DAT-002 | accepted | Se admiten coma, punto y coma y tabulador, con previsualización. |
| R-DAT-003 | accepted | El catálogo de funciones puede ser parcial; ausencia significa `función no documentada`, no fallo. |
| R-DAT-004 | accepted | Un tag puede tener funciones distintas según multicircuito/configuración y vigencia. |
| R-DAT-005 | accepted | Solapes se deduplican para cálculo sin perder procedencia. |
| R-DAT-006 | accepted | Un archivo probable de otro circuito no puede consolidarse en el circuito activo. |

## Circuito y topología

| ID | Estado | Regla |
|---|---|---|
| R-GRA-001 | accepted | El circuito físico validado y el circuito teórico de Vsystem son capas distintas. |
| R-GRA-002 | accepted | El grafo se estudia por AGV y vuelta antes de generar consenso. |
| R-GRA-003 | accepted | El consenso colectivo pesa más que una secuencia aislada, sin borrar divergencias minoritarias. |
| R-GRA-004 | accepted | Carga online pertenece al circuito; mantenimiento y asistencia quedan fuera del recorrido productivo. |
| R-GRA-005 | accepted | Un cambio colectivo y sostenido puede indicar evolución real; uno individual puede indicar AGV/lector/configuración. Ambos son hipótesis. |
| R-GRA-006 | configurable | Límites exactos de zona cargada, vacía, CO y puntos críticos pertenecen a configuración versionada. |

## Lecturas, oportunidades y huecos

| ID | Estado | Regla |
|---|---|---|
| R-OPP-001 | accepted | La salud se calcula sobre oportunidades elegibles y contexto, no sobre el número bruto de lecturas. |
| R-OPP-002 | candidate | El lector puede suprimir la retransmisión de un tag si coincide con el último leído; validar por modelo/configuración. |
| R-OPP-003 | accepted | Silencio de lecturas no equivale por sí solo a salida de circuito, tag perdido o fallo WiFi. |
| R-OPP-004 | accepted | Si antes y después del hueco la secuencia y tiempo son coherentes y no hay intercambio de AGV, puede inferirse continuidad con confianza, nunca como observación. |
| R-OPP-005 | accepted | Un hueco sin contexto suficiente queda censurado. |
| R-OPP-006 | configurable | El intervalo de lectura normal se obtiene de configuración/perfil local con vigencia; no existe un umbral universal en el código. |

## AGV, lector y configuración

| ID | Estado | Regla |
|---|---|---|
| R-AGV-001 | accepted | Debe compararse cada AGV con sus pares y consigo mismo a lo largo del tiempo. |
| R-AGV-002 | accepted | Acciones distintas en uno o pocos AGV sugieren memoria/configuración desactualizada; no la confirman. |
| R-AGV-003 | candidate | Tras un cambio, los AGV dispondrían de una ventana automática aproximada de 30 min para actualizar; un reenvío manual ampliaría la ventana y podría requerir parada. Debe verificarse. |
| R-AGV-004 | accepted | Diferencias de modelo de lector/AGV pueden requerir cohortes y perfiles separados. |
| R-AGV-005 | accepted | Vsystem muestra la última lectura conocida; no demuestra posición actual durante un hueco. |

## Comunicación

| ID | Estado | Regla |
|---|---|---|
| R-COM-001 | accepted | Sin WiFi no llegan lecturas al histórico disponible. |
| R-COM-002 | candidate | Sin comunicación, el AGV no recibiría la orden del servidor para entrar en carga online. Debe validarse en cada arquitectura operativa. |
| R-COM-003 | accepted | Un patrón simultáneo de múltiples AGV apunta a infraestructura/proceso común antes que a fallos independientes, pero requiere evidencia. |

## Flujo, FIFO y zonas

| ID | Estado | Regla |
|---|---|---|
| R-FLO-001 | accepted | En zona cargada se espera FIFO salvo carga online, maniobra manual o excepción documentada. |
| R-FLO-002 | accepted | En zona vacía puede existir reordenación y no debe diagnosticarse automáticamente como rotura FIFO. |
| R-FLO-003 | accepted | Carga online se modela dentro de la zona vacía y queda fuera del FIFO cargado. |
| R-FLO-004 | configurable | El tiempo de ciclo entre puntos funcionales es local, depende del contexto y posee vigencia. |
| R-FLO-005 | accepted | Falta de lecturas de varios AGV puede representar parada o saturación, no ausencia individual automática. |

## Carga online

| ID | Estado | Regla |
|---|---|---|
| R-CO-001 | accepted | El número y capacidad de calles CO son configurables; el piloto se validará además con un fixture sintético de cinco calles. |
| R-CO-002 | accepted | La lógica se analiza mediante máquina de estados por calle: aproximación, entrada, ocupación, permanencia, salida y estado desconocido. |
| R-CO-003 | accepted | La salida se relaciona con mayor antigüedad según la información disponible, no con SOC. |
| R-CO-004 | accepted | SOC puede quedar congelado/no fiable durante carga y se excluye del diagnóstico. |
| R-CO-005 | accepted | Retrocesos o maniobras pueden producir doble lectura; deben evaluarse topológica y temporalmente. |

## Producción y calendario

| ID | Estado | Regla |
|---|---|---|
| R-TIM-001 | configurable | Takt y unidad de medida se almacenan en configuración local con vigencia; no existe un valor universal en el código. |
| R-TIM-002 | configurable | El objetivo por turno es configuración local versionada. |
| R-TIM-003 | configurable | Inicio, fin y excepciones de cada turno pertenecen al calendario local versionado. |
| R-TIM-004 | configurable | Pausas, descansos y paradas planificadas pertenecen al calendario local versionado. |
| R-TIM-005 | configurable | Los valores operativos reales conocidos se validarán localmente y no se incluirán en GitHub. |
| R-TIM-006 | accepted | Un periodo se compara con lo esperado para su horario/estado, no con una media que mezcle producción, pausa y parada. |

## Consolidación e incidencias

| ID | Estado | Regla |
|---|---|---|
| R-MEM-001 | accepted | Solo un periodo revisado puede consolidarse mediante acción humana explícita. |
| R-MEM-002 | accepted | Consolidar crea una versión; no sobrescribe ni reinterpreta el pasado. |
| R-MEM-003 | accepted | La memoria normal conserva agregados, evolución y divergencias relevantes, no todo el bruto. |
| R-INC-001 | accepted | Una incidencia se vincula al circuito pero se almacena separada de la memoria normal. |
| R-INC-002 | accepted | Guardar una incidencia no modifica el esperado ni el grafo validado. |
| R-INC-003 | accepted | Una contramedida solo se considera eficaz tras una verificación posterior registrada. |

## Cambio de reglas

Una regla `candidate` solo pasa a `accepted` mediante evidencia y decisión documentada. Una regla `configurable` debe admitir vigencia temporal; cambiar su valor no modifica la regla general.
