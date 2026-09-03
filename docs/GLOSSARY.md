---
document_id: TT-GLOSSARY-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Glosario controlado

| Término | Definición normativa |
|---|---|
| AGV | Vehículo guiado automático identificado como texto y analizado de forma individual y colectiva. |
| Circuito | Unidad principal de trabajo. Agrupa configuración, fuentes, grafo, memoria, análisis e incidencias sin mezclarse con otros circuitos. |
| Vsystem | Fuente teórica/configurada que se contrasta con el comportamiento físico observado; no se asume como verdad física. |
| Tag | Identificador físico/lógico leído por un AGV. Puede tener una o varias funciones según la configuración o multicircuito. |
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

## Estados de verdad

| Estado | Significado | Puede mostrarse como hecho observado |
|---|---|---|
| `observed` | Existe evidencia directa en una fuente trazable. | Sí |
| `inferred` | Resultado de una inferencia reproducible. | No |
| `expected` | Predicción del modelo aplicable al contexto. | No |
| `unknown` | No existe evidencia suficiente para decidir. | No |
| `confirmed` | Una persona autorizada validó explícitamente la interpretación. | Sí, como confirmación humana, conservando el origen |
