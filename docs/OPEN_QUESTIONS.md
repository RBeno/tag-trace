---
document_id: TT-OPEN-001
version: 0.14.0
status: active
last_updated: 2026-09-17
---

# Preguntas abiertas

No son lagunas que la IA deba rellenar. Cada respuesta se incorpora a requisitos/reglas/configuración y se cierra con fecha y evidencia.

## Bloqueantes para cerrar G0

Para responderlas hay una plantilla con los campos concretos que hacen falta:
[`docs/templates/G0_INTAKE.md`](templates/G0_INTAKE.md). Se rellena en `local/`, fuera del control
de versiones: al repositorio vuelve la forma de cada respuesta, nunca los valores de planta.

| ID | Pregunta | Por qué bloquea | Resolución prevista |
|---|---|---|---|
| OQ-B01 | ¿Cuáles son los formatos/encabezados reales de DS-002 a DS-009? DS-001 y DS-011 están determinados, y DS-011 ya contra una exportación completa y no solo una captura. | Define contrato de importación | Inventario local de fuentes y muestras controladas |
| OQ-B02 | **Parcial.** La zona es `Europe/Madrid`. El tratamiento del cambio estacional ya está implementado y probado de forma sintética —hora repetida, hora inexistente y horas de guarda—, pero **no verificado contra una exportación real**: sigue sin saberse cómo representa la fuente la hora repetida de octubre, y eso no se deduce, se observa. | Evita secuencias/turnos erróneos | Exportación que cruce el cambio de octubre o de marzo |




## Movidas a puertas posteriores

| ID | Pregunta | Puerta |
|---|---|---|
| OQ-B04 | Límites de zona cargada y vacía, calles CO, puntos críticos y anclas de vuelta. | G2: son insumos del grafo y el diagnóstico, no de la importación. |
| OQ-B05 | Qué datos reales se usan para aceptar cada fase y quién valida. | G1 para la parte de F1; el resto con cada puerta. |

## Necesarias durante F1–F3

| ID | Pregunta | Tratamiento mientras esté abierta |
|---|---|---|
| OQ-101 | ¿Qué modelos de lector/AGV existen y cuáles suprimen tag repetido? | Regla R-OPP-002 sigue candidate |
| OQ-102 | ¿Qué evento o secuencia identifica con fiabilidad una vuelta? | Conservar vueltas parciales/desconocidas |
| OQ-103 | ¿Cómo distinguir mantenimiento/asistencia/pastor en los CSV? | Catálogo parcial y exclusión explícita |
| OQ-104 | ¿La ventana de actualización automática de 30 min y el reenvío manual se comportan igual en todas las versiones? | R-AGV-003 sigue candidate |
| OQ-105 | ¿Qué señal confirma WiFi ausente frente a lector silencioso? | Mantener hipótesis alternativas |
| OQ-106 | ¿Cómo se identifica carga/vacío si el dato no existe directamente? | Estado inferido con confianza |
| OQ-107 | ¿Cuáles son excepciones legítimas al FIFO cargado? | No confirmar rotura sin contexto |
| OQ-108 | ¿Qué periodos/versiones exactos tienen los calendarios y takt conocidos? | Configuración obligatoria por vigencia |
| OQ-109 | ¿Cómo se reconocen movimientos manuales y sentido contrario? | Señalar desconocido/excepción |
| OQ-110 | ¿Qué diferencias conocidas existen entre memorias de AGV y cómo se obtienen sin descarga global? | Importación/revisión manual versionada |
| OQ-111 | **Parcial.** La lista está obtenida y es cerrada; falta el *significado operativo* de cada valor, que es lo que decide cuáles implican parada real. | Los eventos de uso se conservan con su texto original, sin interpretarse ni alimentar diagnóstico |
| OQ-112 | ¿Cuál es el rango exacto de multicircuitos y qué hace cada uno? Se conoce que altera el comportamiento al leer tags y que algún modo reduce el alcance de detección. | Perfiles separados por multicircuito; sin la tabla completa no se puede afirmar qué ausencias son esperables |
| OQ-113 | **Parcial.** La lista está obtenida: son averías de equipo emparejadas error/restablecimiento y avisos de nivel de batería. Falta confirmar si alguna debe suspender el diagnóstico del vehículo mientras dure. | Se conserva como atributo sin promover ni interpretar |
| OQ-116 | ¿Qué hace que un tag emita su multicircuito en una pasada y no en la siguiente? Medido: ningún tag declara dos valores distintos, unos lo emiten en todas sus pasadas y otros solo en una fracción, y el mismo vehículo sobre el mismo tag unas veces lo trae y otras no. | Ausente es `unknown`: no se reconstruye por continuidad desde la lectura anterior (R-DAT-011) |
| OQ-117 | Dos tags declarados por el propietario dentro de las calles de carga no tienen **ninguna** lectura en una ventana de casi 18 h, y el tramo que ocuparían se recorre en directo decenas de veces. ¿Siguen instalados? | Salen en el circuito reconstruido como `unknown`, nunca omitidos. Si están instalados es un diagnóstico; si no, la lista está desactualizada |
| OQ-118 | **Respondida en su mayor parte.** El fenómeno eran tres cosas mezcladas: circuitos distintos compartiendo fichero, tags que no están en la memoria del vehículo, y detección. Lo que queda abierto es solo el resto **con patrón de gradiente** —todos leen algo, unos menos—, que sí es candidato a detección. | Se separan los tres con la prueba de tiempos (en línea o desvío) y la normalización por vueltas (bimodal o gradiente). Solo el gradiente queda `unknown` |
| OQ-119 | **Reformulada.** La pregunta ya no es adónde fue el vehículo —cruzar exportaciones no lo resuelve, porque sin esos tags en memoria no aparece en la del destino—, sino **qué cruce falló y de qué modo**. | Se detecta la salida por R-AGV-009 y se señala el punto exacto; el modo de fallo necesita OQ-121 |
| OQ-121 | ¿Cuáles son los **pares de tags de protección** de cada cruce, y qué tag toca si el giro se ejecuta? Sin ellos se puede decir dónde se salió un vehículo, pero no si falló la lectura de la protección o la orden de la centralita. Hipótesis a confirmar, inferida por posición en la secuencia: en el circuito largo de una exportación, los dos tags consecutivos que preceden a las dos salidas observadas. | El expediente señala la salida y enumera las tres hipótesis sin elegir. Los valores van a `crossings` en la configuración local, nunca al repositorio |
| OQ-120 | ¿Qué tags lleva cada vehículo en memoria, y con qué vigencia? Sin eso, **ninguna tasa de lectura es salud**: «no lo detectó» y «no lo lleva cargado» producen el mismo dato (R-OPP-009). Medido: la ceguera se concentra en pocos vehículos y dos de ellos son ciegos a conjuntos que se solapan. | Se publican los hechos y sus hipótesis, nunca una tasa de salud. La ceguera bimodal sale señalada con la memoria como hipótesis prioritaria |
| OQ-114 | El mayor silencio colectivo observado cae justo en la frontera entre el régimen nocturno y el de producción, lo que sugiere cambio de turno o parada planificada. Con una sola observación no hay soporte. ¿Lo confirma el calendario? | Hipótesis registrada con su evidencia; no se promueve a perfil esperado |


## Decisiones de producto posteriores

| ID | Pregunta | Fase |
|---|---|---:|
| OQ-P01 | ¿Debe `.agvproj` admitir cifrado con contraseña y cómo se recupera una clave perdida? | F4 |
| OQ-P02 | ¿Cuánto recorte de eventos debe conservar una incidencia por defecto? | F5 |
| OQ-P03 | ¿Qué formatos de informe se necesitan además de HTML/CSV? | F5 |
| OQ-P04 | ¿Qué librería/tecnología de grafo cumple mejor rendimiento y UX móvil? | F2/F6 |
| OQ-P05 | ¿Qué framework UI ofrece mejor equilibrio tras un prototipo comparativo? | F1 |
| OQ-P06 | ¿Cuándo existe suficiente evidencia para promover deriva a cambio real? | F4 |
| OQ-P07 | ¿Qué métricas hacen que una contramedida sea eficaz, parcial o ineficaz? | F5 |

## Preguntas cerradas

| ID | Pregunta | Respuesta | Fecha | Documentos |
|---|---|---|---|---|
| OQ-B06 | ¿El repositorio debe permanecer privado durante todo el piloto? | No. Pasa a público conteniendo solo código, documentación y fixtures sintéticos, tras verificar el historial y activar el guardián de datos. | 2026-09-03 | ADR-0014, `SECURITY_PRIVACY.md` |
| OQ-115 | ¿«Reaparecer en su hueco» se observa con el grupo avanzando o alcanzándole? | La reaparición se busca hacia delante en el tiempo, y lo que discrimina es si los vecinos avanzaron: si tampoco lo hicieron, el fallo es de la línea y no del objeto. Si avanzaron con normalidad y el objeto reaparece en posición muy por encima del tiempo esperado del tramo, la detención es individual. | 2026-09-16 | R-AGV-007, R-AGV-008, R-FLO-006, `ALGORITHM_CATALOG.md` §4.3 |
| OQ-B07 | ¿Bajo qué licencia se publica el repositorio? | Sin fichero `LICENSE`: el repositorio público queda con todos los derechos reservados. Se lee, no se reutiliza. | 2026-09-16 | ADR-0014 |
| OQ-P05 | ¿Qué framework de interfaz? | Ninguno para F1a: TypeScript y DOM directo. La elección se pospone a F2 o F5, cuando exista una pantalla —grafo, timeline o replay— que la justifique, y con medidas de esa pantalla. | 2026-09-16 | ADR-0009 |
| OQ-B03 | ¿Qué dispositivos de referencia? | PC de 6 núcleos y 12 hilos con 32 GB, y Samsung Galaxy S23 FE. Los dos de gama alta, lo que **sesga las medidas hacia el optimismo** y queda declarado junto al presupuesto en lugar de darse por bueno. | 2026-09-16 | `PERFORMANCE_BUDGET.md` §2.1 |

## Registro de cierre

Al cerrar una pregunta se añade: respuesta, estado de verdad, evidencia, fecha, responsable y documentos modificados. No se borra la pregunta; se mueve a la sección de preguntas cerradas.
