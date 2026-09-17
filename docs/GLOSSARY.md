---
document_id: TT-GLOSSARY-001
version: 0.6.0
status: baseline-candidate
last_updated: 2026-09-17
---

# Glosario controlado

| Término | Definición normativa |
|---|---|
| AGV | Vehículo guiado automático identificado como texto y analizado de forma individual y colectiva. |
| Circuito | Unidad principal de trabajo. Agrupa configuración, fuentes, grafo, memoria, análisis e incidencias sin mezclarse con otros circuitos. |
| Vsystem | Fuente teórica/configurada que se contrasta con el comportamiento físico observado; no se asume como verdad física. |
| Tag | Identificador físico/lógico leído por un AGV. Puede tener una o varias funciones según la configuración o el multicircuito. |
| Multicircuito (MTC) | Modo de comportamiento vigente **dentro de** un circuito, identificado por un número. Determina cómo actúa un AGV al leer un tag y puede alterar las condiciones físicas de detección, por ejemplo reduciendo el alcance del sensor en un modo degradado. No confundir con «varios circuitos», que es el alcance de F7. |
| Cobertura | Unión de los intervalos temporales de las fuentes aceptadas de un circuito. Delimita sobre qué se puede concluir algo. |
| Sin datos cargados | Estado de un intervalo que queda fuera de la cobertura. Distinto de `unknown`: en `unknown` hubo evidencia y no basta para decidir; aquí nunca hubo evidencia. No es una parada ni un silencio. |
| Muestra | Periodo acotado que se importa y analiza. El producto trabaja por muestras, no sobre un histórico continuo; dos muestras solo se comparan si su contexto de calendario es equivalente. |
| Periodo de inactividad | Intervalo dentro de la cobertura en el que un objeto no produce lecturas. Como un AGV detenido no emite, la inactividad no se distingue del fallo de comunicación por la ausencia en sí, sino por el contexto colectivo, el punto de la última lectura y el calendario. |
| Instante de cambio | Última lectura antes de un silencio o de un cambio sostenido de comportamiento. Es `inferred`: marca el último momento con evidencia, no el instante real en que el objeto dejó de funcionar. |
| Expediente de objeto | Vista que reúne todo lo conocido sobre un AGV o un tag concreto, con su contraste de cohorte, su inactividad y su evidencia navegable. No confundir con el expediente de incidencia. |
| Lectura | Evento observado procedente de una fuente: instante, AGV, tag y procedencia. |
| Oportunidad | Paso contextualmente sustentado en el que un tag podría haber sido leído. No equivale a inventar una lectura. |
| Vuelta | Recorrido segmentado de un AGV a través de una secuencia/ciclo del circuito, con confianza explícita. |
| Tramo | Relación topológica entre dos nodos/tags o puntos funcionales consecutivos. |
| Grafo teórico | Topología procedente de plano, inventario o configuración. |
| Grafo observado | Transiciones contenidas directamente en las lecturas normalizadas. |
| Grafo inferido | Hipótesis topológica derivada por algoritmo, marcada con soporte y confianza. |
| Grafo validado | Versión del grafo aceptada por el propietario durante una consolidación. |
| Perfil esperado | Distribución versionada de secuencias, tiempos y frecuencias válida para un contexto. |
| Divergencia | Diferencia mensurable entre un periodo/AGV/grupo y el comportamiento esperado o colectivo. |
| Salud | Indicador explicable derivado de oportunidades válidas, lecturas, estabilidad, contexto e incertidumbre; nunca mera frecuencia absoluta. |
| Hueco censurado | Intervalo sin evidencia suficiente para afirmar qué ocurrió. |
| CO | Carga online. Forma parte del circuito físico, pero se modela dentro de la zona vacía y no se rige por FIFO cargado. |
| Punto crítico | Punto cuya falta de alimentación/paso puede afectar directamente al proceso productivo, con grado configurable. |
| Consolidación | Aceptación humana de un periodo revisado para producir una nueva versión compacta de memoria y sus divergencias. |
| Incidencia | Expediente separado que conserva síntoma, intervalo, replay, evidencia, hipótesis, contramedidas y verificación. |
| Contramedida | Acción propuesta o realizada para reducir una causa, registrada con responsable, estado y verificación. |
| Replay | Reproducción determinista del estado/movimiento inferible de varios AGV sobre el grafo, mostrando incertidumbre. |
| Bruto | Fuente original inmutable utilizada durante el análisis. No forma automáticamente parte de la memoria duradera. |
| `.agvproj` | Contenedor local versionado de un circuito, su memoria compacta, configuraciones, incidencias y metadatos. |
| Cohorte | Grupo de AGV o de modelos de lector cuyo comportamiento difiere de forma material del resto y exige perfiles esperados separados. Se declara en configuración, no se infiere sola. |
| Takt | Ritmo de referencia entre unidades producidas, con unidad y vigencia definidas en la configuración local. No existe un valor universal en el código. |
| Soporte | Cantidad de evidencia independiente que sostiene un nodo, una transición o un perfil: cuántos AGV y cuántas vueltas distintas lo respaldan. Un soporte alto de un solo AGV no equivale a consenso. |
| Oportunidad elegible | Oportunidad cuyo contexto permite afirmar que el tag pudo leerse. Es el único denominador admitido para la tasa de lectura; las oportunidades censuradas, no recorridas o desconocidas quedan fuera. Exige **dos** condiciones sobre el tag: que esté en la memoria del vehículo y que **exista físicamente** (R-OPP-011). Un tag obsoleto cumple la primera y no la segunda. |
| Tag obsoleto | Tag que sigue en la lista de memoria de los vehículos y **ya no existe en el suelo**, porque se retiró y nunca se borró de la lista. No produce lectura y no es una oportunidad. No se distingue de un tag averiado dentro de una sola ventana (R-DAT-016). |
| Universo de memoria | Conjunto de tags que un vehículo puede llegar a leer: circuito virtual, mantenimiento, sustitución de emergencia y obsoletos no borrados. Acota por arriba cualquier tasa de lectura. Cuando la lista es **maestra** —la que cada vehículo debería llevar— el universo es de flota y el contenido individual es `expected`, no `observed` (R-OPP-012). |
| Pastor | Recorrido de asistencia o acompañamiento, ajeno al recorrido productivo, que debe excluirse del comportamiento esperado. Su identificación en las fuentes sigue abierta (OQ-103). |

## Estados de verdad

| Estado | Significado | Puede mostrarse como hecho observado |
|---|---|---|
| `observed` | Existe evidencia directa en una fuente trazable. | Sí |
| `inferred` | Resultado de una inferencia reproducible. | No |
| `expected` | Predicción del modelo aplicable al contexto. | No |
| `unknown` | No existe evidencia suficiente para decidir. | No |
| `confirmed` | Una persona autorizada validó explícitamente la interpretación. | Sí, como confirmación humana, conservando el origen |
