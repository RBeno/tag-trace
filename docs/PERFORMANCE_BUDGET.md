---
document_id: TT-PERF-001
version: 0.8.0
status: provisional-budget
last_updated: 2026-10-17
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
| PERF-D4 | 48 h, aproximadamente 40 AGV (en el banco: 120 tags y una lectura cada 15 s por AGV, unas 461.000; la cadencia la elige el banco para quedar entre D2 y D3, no viene de planta) | Replay operativo |
| PERF-D5 | 1.000.000+ eventos sintéticos | Estrés de escritorio, no puerta de cada cambio |

Los datasets del repositorio serán sintéticos y conservarán solo la forma estadística necesaria, nunca la topología real.

PERF-D2 y PERF-D4 se contrastaron contra una muestra real y describen bien su forma: el orden de
magnitud de eventos, AGV y tags coincide. El generador sintético debe reproducir también las
propiedades que complican la ingesta —orden descendente de pila, resolución gruesa, identificadores
con y sin ceros iniciales— y no solo el volumen.

## 2.1 Dispositivos de referencia

| | PC | Móvil |
|---|---|---|
| Equipo | Intel de 6 núcleos y 12 hilos, 32 GB RAM, GPU dedicada | Samsung Galaxy S23 FE |
| Papel | Medida de escritorio y desarrollo | Medida móvil y puerta de fase |
| Navegador del piloto (OQ-173) | Chrome o Edge | Chrome |

**Los dos son de gama alta, y eso sesga las medidas hacia el optimismo.** Con 32 GB de RAM el
presupuesto de memoria de escritorio no se rozará, y el móvil tiene holgura suficiente para que un
consumo excesivo no se note. Conviene tenerlo presente al interpretar un resultado en verde: que
quepa aquí no demuestra que quepa en el equipo de un operario.

Dos consecuencias prácticas:

- Los presupuestos de RAM se verifican además con las herramientas de medición del navegador, no
  solo por ausencia de bloqueo o de cierre de pestaña.
- La GPU dedicada del PC no interviene en la importación, pero sí influirá en el grafo y el replay
  de F2 y F5. Ese dato de escritorio no es representativo y se declarará como tal.

Lo que sí detecta este móvil sin dificultad es el defecto del prototipo: parsear cien mil filas en
el hilo principal bloquea cualquier teléfono, por bueno que sea.

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
| Primera vista de replay PERF-D4 | <2 s | Tras índices disponibles. Replay de un expediente (3.77.0): 54.000 lecturas de 40 AGV en 3 h y 200 fotogramas, ~0,13 s de cálculo en Node en el PC de referencia y ~2,4 MB de JSON al hilo principal; sin medir todavía en el móvil |
| Animación de replay | objetivo 30 fps; mínimo usable 20 fps | Vista y número de capas definidos |
| Incremento consolidado normal | <5 % del bruto equivalente | Excluye recorte deliberado de incidencias |

Si un objetivo no es realista tras medir, se cambia mediante decisión documentada, no rebajándolo para ocultar una regresión.

### 3.1 Primera medida de PERF-D2 (2026-09-17)

Medida en el navegador y a través del Worker, que es donde el presupuesto tiene sentido: lo que
acota no es la velocidad de una función sino si la interfaz sigue respondiendo.

| Métrica | Medida | Objetivo |
|---|---:|---:|
| Núcleo de importación, 100.000 eventos | 1.330 ms | — |
| Hueco de fotograma en el hilo principal, p95 | **17 ms** | <50 ms |
| Hueco de fotograma, máximo | **341 ms** | — |

El p95 cumple con holgura. El máximo **no**, y no se disimula: es un único tirón, y su causa está
identificada —el resultado completo viaja del Worker al hilo principal en un `postMessage`, así que
clonar cien mil lecturas cuesta ese fotograma—. Se corrige enviando una página en lugar de todo,
que es trabajo de F1b y no de aquí.

**Condiciones, porque sin ellas la cifra no significa nada**: contenedor de desarrollo con Chromium
sin aceleración, fuente sintética con semilla de 100.000 filas, 40 AGV y 120 tags, resolución de
segundo. **No es el PC de referencia ni el móvil de referencia.** La medida del Samsung Galaxy S23
FE solo la puede tomar el propietario, y hasta entonces la puerta de fase que depende del móvil
sigue sin cerrarse: una cifra emulada no la sustituye.

**Primera prueba en el dispositivo de referencia (2026-09-20).** Con la aplicación ya publicada, el
propietario la abrió en el Samsung Galaxy S23 FE y confirma que **corre con fluidez**. Es una
observación suya, cualitativa, y se registra como tal: **no es el p95 de hueco de fotograma que este
presupuesto exige**, así que PERF-D2 sigue sin cerrarse. Lo que sí permite afirmar es que el
producto es usable en el dispositivo donde cayó el prototipo, que no es poco, y que la medida
formal ya no está bloqueada por no tener dónde ejecutarla.

### 3.2 Banco de medida en la aplicación (3.83.0)

En la pestaña Datos, «Medir este dispositivo» genera PERF-D2, D3 y D4 con semilla
(`src/application/perf-bench.ts`), los importa como un fichero de lecturas **sin circuito** —se
analizan y se dibujan, no se guarda nada— y mide desde la página: primer progreso, huecos de
fotograma durante todo el trabajo (p95 y máximo), lo que tarda en importar, analizar y dibujar, la
memoria del hilo principal si el navegador la da, la primera vista y el paso del replay (PERF-D4) y la
confirmación de cancelación (una segunda importación de PERF-D3 cancelada al 30 %). Cada volumen lleva
su huella SHA-256, así que dos dispositivos que dan la misma han medido lo mismo. El informe se descarga
en JSON con la versión y el equipo (núcleos, memoria declarada, pantalla, tipo de puntero) y sin nada
de planta. Lo que no se pudo medir sale «sin medir», nunca «dentro».

Límites que el informe declara: la memoria es solo la del hilo principal (el Worker no se ve desde la
página y no hay aislamiento entre orígenes en Pages para medirla entera) y crece entre volúmenes de una
misma tanda; y con la pestaña en segundo plano el navegador para la página, así que el informe dice si
se vio todo el rato.

**Primera tanda, en el contenedor de desarrollo** (Chromium sin aceleración; no es ningún dispositivo
de referencia y no cierra nada):

| | PERF-D2 | PERF-D3 | PERF-D4 |
|---|---:|---:|---:|
| Lecturas | 100.000 | 500.000 | 461.022 |
| Primer progreso | 34 ms | 36 ms | 75 ms |
| Importar, analizar y dibujar | 4,2 s | 19,3 s | 18,5 s |
| Hueco de fotograma p95 / máximo | 17 / 306 ms | 17 / 1.053 ms | 18 / 1.332 ms |
| Memoria del hilo principal | 78 MiB | 361 MiB | 648 MiB |
| Primera vista del replay | — | — | 62 ms |
| Paso del replay | — | — | 60 fps (el máximo que se cuenta) |
| Confirmación de cancelación | — | **no se atendió** (15,8 s hasta acabar) | — |

Dos hallazgos para la entrega 3: el tirón máximo crece con el volumen (más de un segundo en D3 y D4, al
pasar los resultados del Worker y dibujarlos); y **«Cancelar» no se atiende mientras se leen las
filas**: la lectura es síncrona dentro del Worker, el mensaje de cancelar no llega hasta que termina y
los puntos de control nunca lo ven, así que la importación acaba entera. WP-004 prevé `terminate()` tras
un plazo de cortesía y no está hecho.

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
- Interpolar solo al renderizar y marcarlo `inferred`. La interpolación sitúa el AGV como
  **fracción temporal recorrida del tramo**, nunca como posición física: el grafo es topológico y
  no contiene distancias.
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
