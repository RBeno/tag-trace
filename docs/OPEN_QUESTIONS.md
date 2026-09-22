---
document_id: TT-OPEN-001
version: 0.22.0
status: active
last_updated: 2026-09-22
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
| OQ-B04 | Límites de zona cargada y vacía, calles CO, puntos críticos y anclas de vuelta. **Parcial (2026-09-20)**: SE2/4 pasa a ser el circuito priorizado mientras se recoge más volumen de PC2, con dos hechos operativos cualitativos aportados (servicio inmediato en el punto de carga; descansos de duración larga y a cierta distancia), pero **sin tags exactos todavía** para `critical_points` ni para `lap_anchors` (mecanismo construido el 2026-09-22, ver OQ-102). | G2: son insumos del grafo y el diagnóstico, no de la importación. |
| OQ-B05 | Qué datos reales se usan para aceptar cada fase y quién valida. **Parcial (2026-09-20)**: el propietario acepta validar en persona F1–F5 con los datos reales ya aportados (PC2, ALF, SE2/4), ejecutados en local en su propio dispositivo. **Sigue sin especificar** el criterio de rechazo — qué resultado haría que una fase no se aceptara —, y no se inventa uno. | G1 para la parte de F1; el resto con cada puerta. |

## Necesarias durante F1–F3

| ID | Pregunta | Tratamiento mientras esté abierta |
|---|---|---|
| OQ-101 | ¿Qué modelos de lector/AGV existen y cuáles suprimen tag repetido? | Regla R-OPP-002 sigue candidate |
| OQ-102 | ¿Qué evento o secuencia identifica con fiabilidad una vuelta? **El mecanismo para cuando se responda ya existe** (`lap_anchors`, R-GRA-009, 2026-09-22): una ancla declarada rota el ciclo ya reconstruido y una vuelta completa cortada por ella sale `observed`. Sigue faltando el tag real. | Conservar vueltas parciales/desconocidas; sin ancla declarada, el ancla es el ciclo dominante e `inferred` |
| OQ-103 | ¿Cómo distinguir mantenimiento/asistencia/pastor en los CSV? | Catálogo parcial y exclusión explícita |
| OQ-104 | ¿La ventana de actualización automática de 30 min y el reenvío manual se comportan igual en todas las versiones? | R-AGV-003 sigue candidate |
| OQ-105 | ¿Qué señal confirma WiFi ausente frente a lector silencioso? | Mantener hipótesis alternativas |
| OQ-106 | ¿Cómo se identifica carga/vacío si el dato no existe directamente? | Estado inferido con confianza |
| OQ-107 | **Parcial.** La detección ya existe y solo publica candidatos (`src/domain/fifo.ts`, R-FLO-001): quién adelantó a quién dentro de un tramo de zona cargada, con su margen. Falta el catálogo de qué es carga online, maniobra manual o excepción documentada. | No confirmar rotura sin contexto; nada se promueve más allá de candidato |
| OQ-108 | ¿Qué periodos/versiones exactos tienen los calendarios y takt conocidos? | Configuración obligatoria por vigencia |
| OQ-109 | ¿Cómo se reconocen movimientos manuales y sentido contrario? | Señalar desconocido/excepción |
| OQ-110 | ¿Qué diferencias conocidas existen entre memorias de AGV y cómo se obtienen sin descarga global? | Importación/revisión manual versionada |
| OQ-111 | **Parcial.** La lista está obtenida y es cerrada; falta el *significado operativo* de cada valor, que es lo que decide cuáles implican parada real. | Los eventos de uso se conservan con su texto original, sin interpretarse ni alimentar diagnóstico |
| OQ-112 | ¿Cuál es el rango exacto de multicircuitos y qué hace cada uno? Se conoce que altera el comportamiento al leer tags y que algún modo reduce el alcance de detección. | Perfiles separados por multicircuito; sin la tabla completa no se puede afirmar qué ausencias son esperables |
| OQ-113 | **Parcial.** La lista está obtenida: son averías de equipo emparejadas error/restablecimiento y avisos de nivel de batería. Falta confirmar si alguna debe suspender el diagnóstico del vehículo mientras dure. | Se conserva como atributo sin promover ni interpretar |
| OQ-116 | ¿Qué hace que un tag emita su multicircuito en una pasada y no en la siguiente? Medido: ningún tag declara dos valores distintos, unos lo emiten en todas sus pasadas y otros solo en una fracción, y el mismo vehículo sobre el mismo tag unas veces lo trae y otras no. | Ausente es `unknown`: no se reconstruye por continuidad desde la lectura anterior (R-DAT-011) |
| OQ-117 | Dos tags declarados por el propietario dentro de las calles de carga no tienen **ninguna** lectura en una ventana de casi 18 h, y el tramo que ocuparían se recorre en directo decenas de veces. ¿Siguen instalados? **Deja de ser una rareza:** ahora se sabe que la memoria conserva tags retirados que nunca se borraron, así que estos dos son la instancia típica de una categoría conocida, no un caso aislado. Sigue sin confirmarse cuál de las dos cosas son. | Salen como `obsoleto-candidato`, `unknown`, nunca omitidos ni contados como avería (R-DAT-016). Lo resuelve una segunda ventana distante, no más análisis de la misma |
| OQ-118 | **Respondida en su mayor parte.** El fenómeno eran tres cosas mezcladas: circuitos distintos compartiendo fichero, tags que no están en la memoria del vehículo, y detección. Lo que queda abierto es solo el resto **con patrón de gradiente** —todos leen algo, unos menos—, que sí es candidato a detección. | Se separan los tres con la prueba de tiempos (en línea o desvío) y la normalización por vueltas (bimodal o gradiente). Solo el gradiente queda `unknown` |
| OQ-119 | **Reformulada dos veces.** Ya no es adónde fue el vehículo —cruzar exportaciones no lo resuelve, porque sin esos tags en memoria no aparece en la del destino—, ni tampoco «qué cruce falló»: aplicada la prueba de R-AGV-012, en la exportación analizada **no queda ninguna salida que sostener**. Lo que sí queda es un vehículo con cuatro tramos recorridos sin leer, cuarenta tags, frente a cero o catorce de sus trece compañeros, y una cola de 234 min al final de la ventana que **no reanuda dentro de ella** y por tanto no es contrastable. La pregunta es qué explica esa ceguera por tramos. | El expediente cuenta los tramos sin leer aparte de las salidas y no llama avería a lo segundo sin la prueba. La cola sin reanudación queda `unknown`, no se completa con la hipótesis más probable |
| OQ-121 | ¿Cuáles son los **pares de tags de protección** de cada cruce, y qué tag toca si el giro se ejecuta? **La hipótesis anterior queda retirada**: se apoyaba en dos salidas que la prueba de R-AGV-012 ha desmentido —el vehículo recorrió su línea sin leer, no se fue—, así que los dos tags que la sostenían no tienen nada detrás. La sustituye una evidencia distinta y mejor: los cinco tags donde dos circuitos de una exportación siguen por sitios distintos llevan **todos** un tag acompañante leído pegado en 61 a 98 pasadas, y en dos de ellos más de la mitad caen en el mismo instante. Eso es la forma de un par en un punto; cuál protege qué giro no lo dice el dato. | El expediente señala la salida y enumera las hipótesis sin elegir. Los valores van a `critical_points` con `function: cruce` en la configuración local, nunca al repositorio |
| OQ-122 | **Parcial.** ¿Qué tags son **críticos** y de qué clase —parada precisa, cruce, semáforo, dejar/recoger carro, cambio de mapa importante, bifurcación—? Hay candidatos reales, con evidencia y soporte, solo para **bifurcación** (`src/domain/critical-points.ts`). Parada-precisa, semáforo y cruce siguen diseñados y sin construir: las dos primeras necesitan una firma de tiempo de permanencia que no existe todavía, y cruce resultó indistinguible de una bifurcación normal sin una comprobación de reconvergencia que tampoco existe. Cambio de mapa y un cruce sin fallos en un solo circuito no dejan firma ninguna. | Los candidatos se entregan para confirmar o completar, nunca se dan por asignados (R-GRA-007). Sin declaración, la función es `unknown`, y un tag crítico no leído se cuenta aparte del ordinario (R-GRA-008) |
| OQ-120 | **Parcial, y la parte que queda es la difícil.** El propietario aporta la composición de la memoria —circuito virtual, mantenimiento, sustitución de emergencia y **obsoletos nunca borrados**— y una **lista maestra** en CSV. Eso acota el universo de flota, pero la lista es la que cada vehículo *debería* llevar, no la que lleva: los AGV pueden estar desactualizados de forma distinta entre sí. Sigue abierto **qué lleva cada vehículo concreto y desde cuándo**. | La memoria individual es `expected`, nunca `observed` (R-OPP-012). La desviación se infiere del patrón bimodal y se declara como inferencia. Ninguna tasa de salud por vehículo hasta entonces |
| OQ-123 | ¿Con qué fecha se extrajo cada lista —memoria maestra, circuito virtual, mantenimiento, sustitución de emergencia— y cada cuánto se renuevan? Una lista sin fecha no puede juzgar una ventana: no se sabe si describe el circuito de esa semana o el de hace medio año. | Las listas se almacenan con `valid_from`/`valid_to`. Una lista sin vigencia declarada no se usa para clasificar: el inventario sale `unknown` y dice por qué |
| OQ-124 | Las calles de carga ya se pueden declarar y analizar, pero con la forma que el propietario dio para el escenario sintético: **cinco calles de tres tags y media hora de carga de media**. ¿Cuántas calles hay de verdad, de cuántos tags y con qué capacidad, y cuánto dura una carga en cada una? La media hora es una magnitud inventada para poder probar, y vive en el generador: el producto no la usa, mide la mediana de cada calle del propio dato. | Ninguna duración de carga se fija en el código. La permanencia larga se mide **relativa a la mediana de su propia calle** (R-FLO-004), y sin estancias suficientes no se señala ninguna |
| OQ-125 | ¿Qué excepciones legítimas admite el orden de salida de una calle (R-CO-003)? Está medido que dos vehículos cargando a la vez con duraciones distintas invierten el orden de salida con toda normalidad, así que la inversión por sí sola no separa la rutina del fallo. | Las inversiones se enumeran **ordenadas por lo que esperó cada uno** y no se llaman avería. R-FLO-001 ya admite excepciones documentadas; cuáles son, lo dice planta |
| OQ-126 | ¿Qué caída mínima cuenta como rotura o como degradación en un tag o un AGV reales (R-OPP-015)? Los umbrales del sintético —0,5 de caída para rotura, 0,3 para degradación, cuatro tramos— están calibrados contra el ejemplo de manual (100 %→0 %, 90 %→40 %), no contra planta. | Ningún umbral se fija en el código: `TrendThresholds` es `draft` en `PROVISIONAL_CONFIG.trend` y sin valor por defecto en la función. Mientras tanto, el criterio exige además que el corte represente una fracción real de la línea (`minShareEachSide`), no solo un recuento mínimo |
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
