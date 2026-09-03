---
document_id: TT-PERF-001
version: 0.1.0
status: provisional-budget
last_updated: 2026-09-03
---

# Presupuesto de rendimiento y recursos

## 1. Estado

Estos límites son **candidatos medibles**, no promesas definitivas. F1 establecerá la línea base en dispositivos de referencia y G6 aprobará los valores finales. Un fallo anterior de sincronización/parser en Worker con un archivo grande no demuestra falta de potencia del móvil; debe reproducirse y aislarse como defecto funcional.

## 2. Escenarios de referencia

| ID | Volumen | Uso |
|---|---:|---|
| PERF-D1 | 10.000 eventos | Desarrollo rápido y perfilado frecuente |
| PERF-D2 | 100.000 eventos, 40 AGV, 120 tags sintéticos | Regresión reproducible de escala |
| PERF-D3 | 500.000 eventos | Prueba de escala móvil/PC |
| PERF-D4 | 48 h, aproximadamente 40 AGV | Replay operativo |
| PERF-D5 | 1.000.000+ eventos sintéticos | Estrés de escritorio, no puerta de cada cambio |

Los datasets del repositorio serán sintéticos y conservarán solo la forma estadística necesaria, nunca la topología real.

## 3. Presupuestos candidatos

| Métrica | Objetivo candidato | Condición |
|---|---:|---|
| Respuesta visual a acción | <100 ms | Operación no pesada |
| Long task en hilo principal | p95 <50 ms | Durante importación/análisis |
| Primer progreso visible | <500 ms | Desde iniciar trabajo |
| Confirmación de cancelación | <1 s | En etapa cancelable |
| Pico RAM PERF-D2 | ≤250 MiB | Móvil de referencia |
| Pico RAM PERF-D3 | ≤512 MiB | PC de referencia; móvil degradará/advertirá según capacidad |
| Reapertura de memoria consolidada | <3 s | Proyecto piloto en dispositivo de referencia |
| Primera vista de replay PERF-D4 | <2 s | Tras índices disponibles |
| Animación de replay | objetivo 30 fps; mínimo usable 20 fps | Vista y número de capas definidos |
| Incremento consolidado normal | <5 % del bruto equivalente | Excluye recorte deliberado de incidencias |

Si un objetivo no es realista tras medir, se cambia mediante decisión documentada, no rebajándolo para ocultar una regresión.

## 4. Modelo de memoria

La representación ingenua de una fila como varios objetos y cadenas JS puede multiplicar varias veces el tamaño del CSV. El diseño perseguirá:

- diccionario único de AGV/tag;
- timestamps numéricos contiguos;
- códigos enteros para estados/categorías;
- columnas/arrays tipados;
- offsets de procedencia compactos;
- índices temporales construidos bajo demanda;
- transferencia de buffers, no copias;
- agregación por lote y liberación temprana.

Presupuesto técnico candidato para la representación canónica: 16–40 bytes base por evento más índices/procedencia. El valor real se comprobará con perfiles; no incluye el `File` mantenido por el navegador ni estructuras temporales.

## 5. Estrategia por etapas

| Etapa | Conserva | Libera al terminar |
|---|---|---|
| Parseo | bloque actual, diccionarios, columnas | texto/celdas intermedias |
| Ordenación | columnas e índice de orden | claves temporales auxiliares |
| Grafo | transiciones agregadas y offsets necesarios | pares transitorios |
| Diagnóstico | agregados por contexto | índices no usados por UI/replay |
| Consolidación | delta compacto y hashes | eventos normalizados salvo incidencia/decisión del usuario |

## 6. Replay eficiente

- Guardar eventos/puntos de cambio, no fotogramas.
- Interpolar solo al renderizar y marcarlo `inferred`.
- Ventana temporal deslizante.
- Nivel de detalle: ocultar etiquetas/aristas no relevantes al alejarse.
- Precalcular índices por AGV y tiempo, reutilizables.
- Reducir frecuencia visual en móvil sin alterar el resultado analítico.

## 7. Instrumentación

Cada benchmark registra:

- commit, versión, navegador, sistema y dispositivo;
- volumen, cardinalidades y distribución del dataset;
- tiempo total y por etapa;
- pico de memoria disponible/estimado;
- copias/transferencias de buffers;
- tamaño de salida y proyecto;
- cancelación y liberación posterior;
- hash del resultado para comprobar que optimizar no cambió el diagnóstico.

## 8. Política de regresión

- Prueba ligera en cada solicitud de cambio.
- PERF-D2 y replay en cambios del núcleo/Worker/persistencia.
- Suite completa antes de release.
- Regresión >10 % en tiempo o memoria exige explicación; >20 % bloquea salvo aprobación explícita.
- Ninguna optimización puede eliminar trazabilidad ni mezclar estados de verdad.
