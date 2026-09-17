---
document_id: TT-RULES-001
version: 0.9.0
status: baseline-candidate
last_updated: 2026-09-17
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
| R-DAT-005 | accepted | Los solapes entre cortes de una misma fuente se unen por el tramo contiguo común, no por identidad de fila, para no fusionar pasos repetidos legítimos. La procedencia de todas las fuentes se conserva. |
| R-DAT-006 | accepted | Un archivo probable de otro circuito no puede consolidarse en el circuito activo. |
| R-DAT-007 | accepted | La cobertura es la unión de los intervalos de las fuentes aceptadas. Fuera de cobertura el estado es `sin datos cargados`: no se analiza y no es nunca una parada ni un silencio. |
| R-DAT-008 | accepted | El orden de una fuente es una propiedad suya que se mide, no que se supone. Las inversiones no son error de parseo: son evidencia de entrega diferida y se conservan señaladas. |
| R-DAT-009 | accepted | Una fila con instante y vehículo pero sin tag **no es una lectura defectuosa**: es otro tipo de evento. Se conserva con su procedencia y se cuenta aparte de la cuarentena. Qué es lo dice el discriminador de la fuente, nunca el importador. |
| R-DAT-010 | accepted | La codificación de una fuente se detecta y se declara junto al separador. Decodificar de forma tolerante está prohibido: sustituye en silencio lo que no entiende y convierte un fichero corrompido en uno de apariencia correcta. |
| R-DAT-011 | accepted | El multicircuito va declarado en el tag, no reconstruido por continuidad: un tag nunca declara dos valores, pero puede no declararlo en una pasada. Ausente es `unknown`, no «el mismo de antes». |
| R-DAT-012 | accepted | Una exportación puede contener **varios circuitos** bajo un mismo nombre de circuito. El cohorte de comparación es el circuito, nunca el fichero. Los circuitos se separan por **aristas exclusivas** —transiciones que un grupo recorre y ningún otro—, no por el nombre ni por el parecido a secas. Un vehículo sin circuito asignable no se compara contra nada: se declara y se para. |

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
| R-OPP-007 | accepted | El multicircuito condiciona la oportunidad de lectura: puede alterar las condiciones físicas de detección, de modo que bajo ciertos multicircuitos una ausencia es esperable. Perfiles separados por multicircuito; y si el multicircuito no se conoce para un periodo, la salud declara ese confusor junto a la conclusión. |
| R-OPP-008 | accepted | «Tags que un AGV no ha leído» nunca se calcula como diferencia entre el catálogo del circuito y lo que leyó. Solo cuentan las oportunidades elegibles: un tag de una rama que ese AGV no recorre, o de un contexto que no le aplica, no es una ausencia. |

## AGV, lector y configuración

| ID | Estado | Regla |
|---|---|---|
| R-AGV-001 | accepted | Debe compararse cada AGV con sus pares y consigo mismo a lo largo del tiempo. |
| R-AGV-002 | accepted | Acciones distintas en uno o pocos AGV sugieren memoria/configuración desactualizada; no la confirman. |
| R-AGV-003 | candidate | Tras un cambio, los AGV dispondrían de una ventana automática aproximada de 30 min para actualizar; un reenvío manual ampliaría la ventana y podría requerir parada. Debe verificarse. |
| R-AGV-004 | accepted | Diferencias de modelo de lector/AGV pueden requerir cohortes y perfiles separados. |
| R-AGV-005 | accepted | Vsystem muestra la última lectura conocida; no demuestra posición actual durante un hueco. |
| R-AGV-006 | accepted | Un AGV detenido no emite lecturas. Por tanto la inactividad y el fallo de comunicación producen el mismo silencio y **no se distinguen por la ausencia en sí**: se discriminan por el contexto colectivo, por el punto donde se produjo la última lectura y por el calendario vigente. |
| R-AGV-007 | accepted | La forma de la reaparición discrimina lo que el silencio no. Reaparecer más tarde conservando la posición relativa entre los mismos vecinos demuestra permanencia en el circuito y descarta salida o retirada, pero no distingue por sí solo detención de circulación sin lectura: eso lo deciden el avance de los vecinos y el exceso sobre el tiempo esperado del tramo. |
| R-AGV-008 | accepted | Si los vecinos de un objeto tampoco avanzaron durante su silencio, la causa no es de ese objeto sino de la línea, y atribuirle un fallo individual es un falso diagnóstico. Esta comprobación tiene prioridad sobre cualquier hipótesis individual. |
| R-AGV-009 | accepted | Reaparecer donde no se llega desde donde se desapareció —una transición que ningún vecino de circuito hace— es firma de haber **salido del circuito**, no de una avería. Mientras no se cargue la exportación del circuito de destino, ese intervalo es `sin datos cargados` para ese vehículo. Diagnosticarlo como silencio es un falso positivo trazable hasta filas reales. |
| R-AGV-010 | accepted | Donde la carga se hace en el propio recorrido, una parada larga es el modo normal de operar y no un hallazgo. Lo que informa es si las paradas de un vehículo se salen de las de sus vecinos de circuito —en duración, en número o en dónde ocurren—, nunca que existan. |

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
| R-FLO-006 | accepted | El vecindario se deriva del orden relativo y solo es firme donde el orden está garantizado: fuerte en zona cargada, débil en zona vacía por la reordenación admitida, y no aplicable a una entrada en calle CO, que es una salida legítima del orden. Donde el vecindario es débil, las firmas que dependen de él bajan de confianza en lugar de aplicarse igual. |

## Carga online

| ID | Estado | Regla |
|---|---|---|
| R-CO-001 | accepted | El número y capacidad de calles CO son configurables; el piloto se validará además con un fixture sintético de cinco calles. |
| R-CO-002 | accepted | La lógica se analiza mediante máquina de estados por calle: aproximación, entrada, ocupación, permanencia, salida y estado desconocido. |
| R-CO-003 | accepted | La salida se relaciona con mayor antigüedad según la información disponible, no con SOC. |
| R-CO-004 | accepted | SOC puede quedar congelado/no fiable durante carga y se excluye del diagnóstico. |
| R-CO-005 | accepted | Retrocesos o maniobras pueden producir doble lectura; deben evaluarse topológica y temporalmente. |
| R-CO-006 | accepted | Un silencio cuya última lectura es el tag de parada de una calle CO configurada y cuya reanudación recorre en orden la secuencia declarada de esa calle se infiere como permanencia en carga online. Sin calles configuradas la firma no se reconoce y el silencio queda `unknown`; no se sustituye por proximidad. |

## Producción y calendario

| ID | Estado | Regla |
|---|---|---|
| R-TIM-001 | configurable | Takt y unidad de medida se almacenan en configuración local con vigencia; no existe un valor universal en el código. |
| R-TIM-002 | configurable | El objetivo por turno es configuración local versionada. |
| R-TIM-003 | configurable | Inicio, fin y excepciones de cada turno pertenecen al calendario local versionado. |
| R-TIM-004 | configurable | Pausas, descansos y paradas planificadas pertenecen al calendario local versionado. |
| R-TIM-005 | configurable | Los valores operativos reales conocidos se validarán localmente y no se incluirán en GitHub. |
| R-TIM-006 | accepted | Un periodo se compara con lo esperado para su horario/estado, no con una media que mezcle producción, pausa y parada. |
| R-TIM-007 | accepted | El análisis es muestral, no continuo. Comparar dos muestras exige contexto de calendario equivalente; cuando no lo es, la comparación se marca como no comparable en lugar de presentarse como evolución del circuito. |

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
