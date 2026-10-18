---
document_id: TT-PMEM-001
version: 0.78.1
status: baseline-candidate
last_updated: 2026-10-18
---

# Memoria compacta del proyecto

Lo vigente: identidad, decisiones firmes (una por punto, con su regla o ADR), modelo industrial,
estados de verdad y, al final, el relevo entre conversaciones. El porqué y la fecha de cada decisión, las
citas del propietario y cada entrega están en [`history/DECISION_LOG.md`](history/DECISION_LOG.md), por
orden cronológico; las secciones antiguas de este documento («F4 abierta»…) siguen allí con su título.

## Identidad

- Nombre: **TAG TRACE**.
- Naturaleza: diagnóstico histórico longitudinal y gemelo digital de circuitos AGV.
- Primer circuito piloto: PC2.
- Estado: la fase vigente la dice `project_state.json` (F6, piloto profesional, al 2026-10-18); el
  relevo entre conversaciones está al final de este documento.
- Repositorio anterior: `RBeno/tag-trace-agv`, solo referencia.

## Decisiones firmes

### Arquitectura, datos y publicación

- Web estática/PWA publicada mediante GitHub Pages (ADR-0001, ADR-0014).
- Análisis íntegramente local; sin backend de datos industriales (ADR-0001).
- GitHub solo guarda código, documentación y fixtures sintéticos (ADR-0007).
- Cada circuito es un contenedor aislado de fuentes, memoria, análisis e incidencias (ADR-0004).
- Archivo portable `.agvproj` para transferencia manual y reapertura (ADR-0012).
- Núcleo analítico separado de UI, persistencia y ejecución en Workers (ADR-0008).
- Evidencia bruta inmutable durante el análisis, con hash, archivo y fila de origen (ADR-0002).
- Replay determinista y algoritmos versionados (ADR-0003, ADR-0013).
- Consolidación mediante botón y revisión humana; historial append-only (ADR-0005).
- Incidencias vinculadas al circuito pero separadas de la memoria normal (ADR-0006).
- No SOC/batería; no control industrial; no IA opaca en el diagnóstico inicial (ADR-0003, R-CO-004).
- Repositorio **público** con solo código, documentación y fixtures sintéticos (ADR-0014).
  El guardián automático de datos es bloqueante y precede a la apertura.
- `.agvproj` es un zip con manifiesto, secciones JSON y hash por sección (ADR-0012).
- Tiempo canónico `t_utc` en milisegundos UTC, con cadena original, zona y marca DST; orden total
  `(t_utc, source_hash, source_row)`; números canonicalizados antes del hash semántico (ADR-0013).
- Una sola pasada de parseo, siempre dentro del Worker, y ningún cálculo de repuesto en el hilo
  principal (`WORKER_PROTOCOL.md`).
- El tiempo de zona se resuelve **sin librería**: `Intl.DateTimeFormat` y dos sondeos del
  desplazamiento alrededor del instante. No se itera hasta converger, porque esa convergencia oculta
  precisamente la hora repetida del cambio de octubre. La validez del calendario se comprueba antes
  de aplicar la zona: un día imposible es una fila inválida, no un instante inexistente (ADR-0013).
- El umbral de consistencia del separador **identifica** al separador; no juzga la calidad de la
  fuente. Las filas discordantes son cuarentena, no motivo de rechazo del fichero (`DATA_CONTRACTS.md` §5).
- Circuitos que comparten cruce o tramo: siguen aislados; la zona compartida será una vista aparte en
  F7, sin construir ahora (R-GRA-012, R-GRA-013, OQ-127).

### Listas y circuito declarado

- Las listas de tags (circuito virtual, memoria, mantenimiento, emergencia, carga online, críticos)
  **se crean a mano**: no hay forma de descargarlas del sistema de planta. El importador declara su
  propia estructura mínima (`lista;tag`, con `orden` y `nota` opcionales) y la enseña en la interfaz
  antes de pedir el fichero, en vez de esperar un formato que nadie puede adivinar. Una lista con un
  nombre que el producto no reconoce se conserva con su nombre y se avisa, nunca se rechaza: el
  propietario ya anticipó ampliaciones.
- Las listas se guardan **con el circuito**, no aparte, porque son parte de su estado en el momento
  del análisis: repetir un análisis de hace tres meses usa las listas de hace tres meses. Si se
  aplican los cambios que el inventario propone y se vuelven a cargar, el análisis siguiente las
  recoge ya actualizadas sin tocar los anteriores.
- La lista es lo declarado; donde difiere de lo leído manda lo leído, y la diferencia es una corrección
  de la lista, no un fallo del circuito; declarar un tag nuevo lo decide el propietario (R-GRA-015).
- Toda función de planta es crítica; una función sin regla propia entra con su nombre y se avisa una vez.
  La situación (LINEA, PICKING, CRUCE) no es una función: solo CRUCE se declara crítico (R-GRA-007, OQ-132).
- Tags seguidos con la misma función son un refuerzo; un cruce o una arqueta seguidos son una zona (R-GRA-016).
- El texto de planta de cada tag se guarda y se enseña junto a sus hallazgos, sin cambiar ningún
  cálculo (R-GRA-007); función y área tienen identidad distinta (R-GRA-022).
- La zona sale del estado de planta: LLENO es `cargado`; VACIO y SIN CARRO, `vacio`; las calles de carga
  online van en `vacio` (R-FLO-001, R-FLO-003).
- Un tag leído que la lista no tiene se sitúa y se clasifica por día y noche; los de la lista `noche`
  son `especial` (R-DAT-022).
- Los libros de Excel se entregan como ficheros: la aplicación solo los importa (`DATA_CONTRACTS.md` §3.7–§3.8).

### Tiempo, lecturas y estado normal

- La hora del fichero es la de recepción en el servidor: lecturas que llegaron juntas no son una parada
  (R-DAT-020). OQ-159 lo pone en duda con el registro de conexiones; hasta que se decida, no se toca.
- Fuera de la cobertura cargada, y en la cola cortada de una exportación, no se afirma nada: pasadas,
  estancias, grafo y vueltas exigen los dos extremos en el mismo tramo completo (R-DAT-007).
- Paradas, descansos y noche no alteran las mediciones estándar; la noche se mide aparte (R-TIM-009).
- Los umbrales de cada tramo salen de sus datos (horquilla p50, p80, p95 y valla), no de una constante (R-FLO-007).
- Una franja es un fichero; sus mediciones se rehacen desde las lecturas guardadas (R-TIM-011).
- Un tag cambiado nunca es ancla; los cambios de estructura salen de la suma entre anclas (R-DAT-021).
- La cola es física y quién retiene es un hecho del AGV de delante, no del sitio (R-AGV-018, R-AGV-020).
- El ritmo de un AGV se mide tramo a tramo frente a la flota, sin paradas ni esperas (R-AGV-019).
- La línea se mide en su entrada (primer tag de la lista `linea`), contra su ciclo local; el pulmón no
  se declara, sale de las medidas (R-FLO-010). Cada paso por la línea se revisa (R-FLO-011).
- Cada incidencia sin explicación lleva la misma batería de mediciones, sin causa (R-AGV-021).

### Diagnóstico, WiFi y lenguaje

- El programa dice dónde y qué, nunca por qué: la causa la decide una persona (R-EVI-006).
- Cada hallazgo se revisa en campo: pendiente, confirmado, descartado o pospuesto, guardado en el
  dispositivo y exportable en CSV; lo pospuesto no bloquea la consolidación (R-EVI-007).
- Un silencio solo no prueba WiFi ausente (R-OPP-003); el registro de conexiones del terminal es
  evidencia observada, y lo observado y lo inferido nunca se mezclan (ADR-0017, R-COM-006).
- Un corte colectivo es apagado o infraestructura, no cobertura; horas y clases de apagado nunca son
  constantes (R-COM-008). Un terminal ruidoso sale del mapa y sigue en su tarjeta (R-COM-009).

### Memoria, consolidación y plano

- La instantánea de cada fichero se guarda sola; la memoria consolidada la aprueba una persona y ninguna
  IA consolida (ADR-0015, ADR-0010).
- Se retienen en crudo las dos últimas exportaciones; volver a cargar un fichero lo recupera (OQ-143, R-DAT-023).
- Versiones vN append-only; bloquean los hallazgos pendientes, un rango 1 confirmado, una versión vigente
  del mismo fichero y una bifurcación sin resolver; revocar no borra (ADR-0005, R-MEM-001 a R-MEM-003).
- Linaje entre dispositivos: se adopta el entrante si va por delante, una bifurcación se resuelve con
  razón y una revocación que llega se aplica sola y se anuncia (OQ-144, OQ-156).
- Un cambio es sostenido en tres ficheros seguidos y colectivo si lo muestra más de la mitad de los AGV
  que pasan; solo esos y los confirmados pasan al esperado (OQ-146, OQ-147).
- Un periodo con incidencia se consolida entero, sin ella en el esperado; los graves con instante se
  excluyen con su ventana (R-INC-004, OQ-148, OQ-149).
- Memoria, lecturas retenidas y originales se guardan comprimidos; presupuesto aceptado del 5 % (OQ-145).
- Se consolida con la configuración provisional; los valores de planta se proponen solo si los
  estimadores coinciden en las tres últimas versiones, y si no los introduce una persona (OQ-151 a OQ-153).
- Plano físico: ubicación y tag instalado son identidades distintas, solo cambia por confirmación humana
  y sus estadísticas se combinan entre periodos; las salidas se revisan a mano (ADR-0016, R-GRA-021).

### Expedientes de incidencia

- El expediente (investigación) es distinto de la incidencia excluida del esperado; revisiones
  append-only por hash y recorte congelado de las lecturas de su ventana (ADR-0018).
- Cinco etiquetas: `precede`, `es compatible con`, `contradice`, `correlaciona` y `confirmado como causa`,
  que solo pone una persona; sin probabilidades ni vocabulario causal en el texto generado (ADR-0018).
- Un hecho repetido se cuenta pero no se llama `correlaciona` hasta que se decida OQ-172 (ADR-0018, ALG-017).
- La consolidación propone la ventana de cada expediente como incidencia excluida (ADR-0018 D5).
- Los expedientes viajan en el `.agvproj` para recuperar, no para trabajar en dos sitios (OQ-174).

### Piloto (F6)

- Piloto en Chrome del Samsung Galaxy S23 FE y en Chrome o Edge del PC de referencia (OQ-173).
- Criterio de rechazo del piloto en cinco puntos (OQ-B05, `PHASE_GATES.md` §G6).
- axe-core solo en pruebas (OQ-175); Vitest 5.0.5, condición de G6 cumplida (OQ-176).
- La versión nueva espera y se activa a petición; el retorno es publicar una etiqueta anterior (`VERSIONING.md`).
- Sin medidas del dispositivo no se inventa umbral: por encima de lo medido se avisa y se importa igual.

## Modelo industrial conocido

- Los eventos mínimos contienen fecha/hora, AGV y tag.
- IDs se conservan como texto, incluidos ceros iniciales.
- El catálogo funcional de tags puede estar incompleto.
- Un tag puede ejecutar funciones diferentes según el multicircuito/configuración, y un
  multicircuito puede además alterar las condiciones físicas de detección. Es contexto obligatorio
  de la salud; cuando se desconoce, el confusor se declara.
- La fuente mínima siempre disponible es Fecha–AGV–Tag. Existe un informe ampliado con segundos,
  circuito declarado, multicircuito y eventos de uso, que se admite como fuente opcional.
- El análisis es muestral, no continuo: periodos de pocos días sobre una fuente con ventana
  deslizante. Fuera de la cobertura cargada el estado es `sin datos cargados`, nunca una parada.
- El circuito incluye carga online; mantenimiento y asistencia se excluyen.
- Zona cargada: FIFO esperado, salvo excepciones justificadas.
- Zona vacía y carga online: puede haber reordenación.
- El número de calles de carga online y su capacidad se define en la configuración local; el motor no lo codifica como constante.
- La salida de carga se relaciona con antigüedad, no con un SOC fiable.
- Ausencia de WiFi implica ausencia de lecturas y puede impedir la orden de entrada a carga.
- Un lector puede no retransmitir el mismo tag consecutivo; una ausencia no demuestra que no hubo paso.
- Una minoría de AGV con acciones distintas sugiere configuración desactualizada, no la confirma.
- Existen referencias operativas actuales de lectura, ciclo, takt, turnos y pausas; sus valores exactos son configuración industrial local y no se publican en GitHub.

## Estados de verdad

- `observed`: presente en una fuente conservada.
- `inferred`: deducido con método, evidencia y confianza.
- `expected`: procedente del modelo versionado aplicable al contexto.
- `unknown`: evidencia insuficiente o contradictoria.
- `confirmed`: validado explícitamente por una persona autorizada.

## Orden de implementación

F0 documentación → F1 base local e importación → F2 grafo físico → F3 diagnóstico → F4 consolidación/evolución → F5 incidencias/replay → F6 piloto endurecido → F7 ampliación a varios circuitos → F8 observación cercana a tiempo real.

En F7, «varios circuitos» significa PC2 y otros circuitos como agregados aislados. No confundir con
el multicircuito (MTC), que es un modo de comportamiento dentro de un mismo circuito.

## Estado al 2026-10-18 (relevo entre conversaciones)

La conversación siguiente solo conocerá lo escrito aquí, en `project_state.json`, en `CHANGELOG.md` y en
`history/DECISION_LOG.md`, al final del cual está, íntegro, el relevo anterior (2026-10-17).

- **Fase F6** (piloto profesional), abierta el 2026-10-17 por el propietario con `CONTINÚA FASE 6` tras
  fusionar F5 (PR #17, `b0f527a`). F7 espera `CONTINÚA FASE 7` (G6); ninguna IA la escribe (ADR-0010).
- **Hecho en F6**: las entregas 1 a 7 (3.82.0 a 3.88.0, más 3.83.1 «Cancelar») y la 8 preparada
  (3.88.1, `templates/PILOT_ACCEPTANCE.md`), en `main` con el PR #18 (`ba59e92`). Después, en la rama
  de trabajo: 3.88.3, OQ-176 aceptada (riesgo de Vitest 3 hasta G6); 3.88.4, Vitest 5.0.5 con
  `npm audit` sin avisos, que cumple esa condición; 3.89.0, la revisión general
  (`REVISION_2026-10-18.md`), con sus correcciones y cuatro preguntas nuevas, OQ-177 a OQ-180; y 3.90.0,
  lo que de esa revisión no necesitaba decisión (`REVISION_2026-10-18.md` §8), con cuatro preguntas más,
  OQ-181 a OQ-184; y 3.90.1, el repositorio puesto al día (descripciones, versión de `package.json`
  comprobada contra el `CHANGELOG`, `VERSIONING.md` sin la etiqueta `docs-v0.2.0` que nunca existió). Todo
  eso está en el PR #19, abierto.
- **Lo que queda es del propietario**:
  1. revisar y fusionar el PR #19 y publicar; decidir qué ramas viejas se borran y poner al día la
     descripción del repositorio en GitHub, que ninguna herramienta de la IA puede cambiar;
  2. medir con el banco («Datos → Medir este dispositivo») en el S23 FE y en el PC;
  3. el piloto de 48 h con datos reales siguiendo `templates/PILOT_ACCEPTANCE.md`;
  4. decidir OQ-172 (cuándo se dice `correlaciona`) y OQ-177 a OQ-184 (las dos contradicciones de la
     revisión son OQ-181 y OQ-183);
  5. si el piloto pasa, escribir `CONTINÚA FASE 7`.
- **Propuesto y no hecho** (`REVISION_2026-10-18.md` §8.3): trocear `main.ts`, `buildViews` y
  `diagnostic-charts.ts`; aligerar el Resumen; reglas de una frase en `RULE_CATALOG.md` y sus citas al
  registro (E-24, E-34); lo que alguna prueba fija literalmente o toca un diseño.
- **Cómo se trabaja**: una entrega por petición del propietario, con su documentación, su clase plantada
  en la auditoría (`tests/audit/`) y su entrada en el `CHANGELOG`; PR y fusión solo cuando él lo pide.
- **Pendiente de planta**, sin identificadores: calibrar los umbrales provisionales (`draft`) con datos
  reales (OQ-129); que el propietario revise la lista corregida por las lecturas y decida qué tags se
  declaran; el resto, en `OPEN_QUESTIONS.md`.
- **Fuera del repositorio**: los análisis con datos de planta se hacen en `local/` (ignorado por git) y se
  entregan al propietario; para analizar datos nuevos hay que volver a subir la exportación y las listas.
