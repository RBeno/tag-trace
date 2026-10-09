---
adr: ADR-0018
status: proposed
date: 2026-10-09
---

# Expediente de incidencia: modelo, ciclo de vida, evidencia reproducible y lenguaje de causalidad

## Contexto

F5 (laboratorio de incidencias) está abierta desde el 2026-09-27 y no tiene ninguna de sus entregas
(`ROADMAP.md` §F5). Su salida demostrable es **investigar una ausencia de diez minutos en un punto
crítico y conservar el caso completo sin modificar el esperado**, y G5 exige seis cosas: incidencia
reproducible con ventana antes/durante/después, replay multi-AGV con incertidumbre, similitud que
explica sin afirmar causalidad, contramedida y verificación registradas, informe con evidencia y
versiones, y que guardar o cerrar una incidencia no altere la memoria normal.

`ROADMAP.md` pide formalizar antes tres cosas: el **ciclo de vida del expediente**, el **lenguaje de
causalidad/correlación** y la **evidencia mínima reproducible separada de la memoria normal**. Lo que
ya está escrito y lo que ya existe:

- **Normativo, aceptado.** ADR-0006 (incidencias separadas de la memoria normal), R-INC-001 a
  R-INC-004, FR-022 a FR-025, `INCIDENTS_REPORTING.md` (creación, contenido, retroceso, replay,
  similitud, estados, informe, relación con la consolidación), `DOMAIN_MODEL.md` (`IncidentCase`),
  ADR-0012 (el `.agvproj` lleva «solo el recorte mínimo que una incidencia necesite para su replay»),
  `VERSIONING.md` (eje «Incidencia: `INC-... revision 4`»), INV-008, TC-012 y TC-017.
- **Construido en F2–F4** y que el expediente tiene que usar, no repetir:
  - el **replay básico** (`src/domain/replay.ts`): fotogramas precalculados en el Worker, posición
    en tramo como fracción temporal, `unknown` en el silencio;
  - la **batería de mediciones por incidencia** (R-AGV-021, `src/domain/incident-battery.ts`):
    última lectura, línea, el de delante, los de detrás, cambio de AGV y una lectura de la guía que
    nunca es causa;
  - la **incidencia de la versión** (R-INC-004, `IncidentRecord` en `src/domain/change-class.ts`):
    un hallazgo grave confirmado al consolidar, con sus sujetos y su ventana, que se guarda dentro de
    la versión consolidada y deja fuera del esperado lo que toca;
  - el **recorte de ventana** (`src/domain/incident-cut.ts`) desde el original archivado;
  - las **horquillas por tramo y régimen** (R-FLO-007), el anillo, la cohorte, los cortes de
    conexión (ADR-0017) y la revisión en campo (R-EVI-007).

Tres hechos condicionan el diseño:

1. **Las lecturas normalizadas solo se retienen para las dos últimas exportaciones** (R-DAT-023).
   Un expediente que dependa de ellas deja de ser reproducible en cuanto llegan dos ficheros más. El
   original archivado comprimido sí se conserva, pero reanalizarlo cuesta y depende de la versión del
   importador.
2. **«Incidencia» ya nombra dos cosas.** En F4 es una *exclusión* (lo que no entra en el esperado
   de una versión); en F5 es una *investigación*. Si comparten nombre y almacén se confunden en la
   interfaz y en el código.
3. **Contradicción documental, resuelta el 2026-10-09.** `ALGORITHM_CATALOG.md` llamaba a ALG-015
   «Retroceso causal», mientras `INCIDENTS_REPORTING.md` §4 dice que «el orden no representa
   causalidad demostrada» y la interfaz debe distinguir `precede`, `correlaciona`, `es compatible
   con` y `confirmado como causa`. El propietario aceptó renombrarlo «Retroceso desde el síntoma»
   (OQ-169).

## Decisión propuesta

Pendiente del propietario. Nada de esto se construye hasta que la acepte. Las preguntas que abría
están **cerradas** desde el 2026-10-09 (`OPEN_QUESTIONS.md`): OQ-167 con la decisión del propietario
(el expediente es solo local, en un dispositivo), y OQ-168, OQ-169, OQ-P02, OQ-P03 y OQ-P07 con la
recomendación. El texto de abajo ya las incorpora.

### D1. Dos nombres para dos cosas

- **Expediente** (`IncidentCase`): la investigación de F5. Es lo que crea, revisa y cierra una
  persona.
- **Incidencia excluida** (`IncidentRecord` de F4): la exclusión del esperado dentro de una versión
  consolidada. No cambia.

Un expediente puede **nacer de** una incidencia excluida, de un hallazgo, de un intervalo o de un
síntoma descrito a mano, y la **referencia** (hash de la versión y clave del hallazgo), nunca la
copia ni la modifica. En la interfaz, «Incidencias excluidas» sigue en Memoria y «Expedientes» es
una lista propia.

### D2. Identidad y revisiones append-only

- **Solo local, en un dispositivo** (propietario, 2026-10-09, OQ-167: «De momento no va a ver dos
  dispositivos se mantendrá exclusivamente en la memoria local»). El expediente vive en el almacén
  del navegador y no viaja en el `.agvproj`; no hay bifurcaciones que resolver. La sección
  `incidencias/` que ADR-0012 prevé queda sin construir mientras siga así.
- **Identidad**: `incident_id` es texto, `INC-<circuito>-<aaaammdd>-<nn>`, con un contador por
  circuito y día de creación. Con un solo dispositivo basta y se lee mejor que un hash.
- **Revisión**: cada vez que una persona guarda, se añade la revisión `n+1` con el hash de la
  anterior, como la memoria (`MEMORY_CONSOLIDATION.md` §10). **Una revisión guarda solo lo humano**
  (síntoma, ventana, hipótesis y su estado, contramedidas, verificaciones, notas y conclusión) y
  **referencias** a lo calculado: hash del recorte, hash de la versión consolidada aplicable, versión
  de configuración y versión de cada algoritmo. Lo calculado se reproduce desde ahí y no es una
  revisión.
- **Autor**: un nombre opcional en texto, guardado solo en local, más el linaje del dispositivo. No
  hay cuentas (ADR-0001).
- **Nada se borra**: un expediente se cierra o se descarta, como una versión se revoca. Borrar el
  circuito borra sus expedientes, como hoy.

### D3. Ciclo de vida

Se mantiene el diagrama de `INCIDENTS_REPORTING.md` §7 y se fija quién mueve cada transición y qué
exige:

| Transición | Quién | Exige |
|---|---|---|
| (crear) → `Draft` | persona | síntoma, ventana del síntoma y circuito; el recorte se congela al crear |
| `Draft` → `UnderReview` | persona | márgenes revisados |
| `UnderReview` → `Investigating` | persona | — |
| `Investigating` → `CountermeasurePlanned` | persona | al menos una hipótesis no contradicha y una contramedida con responsable y fecha |
| `CountermeasurePlanned` → `VerificationPending` | persona | fecha de aplicación y métrica de verificación (D9) |
| `VerificationPending` → `VerifiedEffective` / `VerifiedIneffective` | persona | periodo posterior cargado, métrica calculada y conclusión escrita |
| `VerifiedIneffective` → `Investigating` | persona | — |
| `Investigating` → `Inconclusive` | persona | qué evidencia falta |
| `VerifiedEffective` → `Closed` | persona | conclusión humana |

| `Draft` / `UnderReview` → `Discarded` | persona | razón («no es una incidencia», por ejemplo una parada planificada que nadie anotó) |
| `Closed` / `Inconclusive` → `Investigating` | persona | la evidencia nueva que lo reabre; es una revisión nueva |

Ninguna transición la hace el programa. **El programa propone y la persona decide** (R-EVI-006).
`Discarded` y la reapertura se añaden al diagrama de `INCIDENTS_REPORTING.md` §7 (OQ-168, 2026-10-09).
Un expediente descartado no propone exclusión en la consolidación (D5).

### D4. Ventana y evidencia mínima reproducible

- **Ventana**: la persona fija el síntoma `[s0, s1]` y el programa propone márgenes antes y después,
  que se pueden cambiar. Aceptado el 2026-10-09 (OQ-P02): antes, el mayor de un mínimo configurado,
  la duración del síntoma y la mediana de una vuelta del circuito, porque el retroceso necesita ver
  pasar al menos una vez a cada AGV por aguas arriba; después, el mayor del mínimo y la duración del
  síntoma, para ver la recuperación. Los mínimos van a `incident_case.*` en configuración versionada
  y en estado `draft` (`CONFIG_SCHEMA.md`), nunca como constante.
- **Recorte congelado**: al crear, el expediente copia las **lecturas normalizadas de todos los AGV
  del circuito** en la ventana con márgenes, cada una con su procedencia (fuente, hash, fila,
  R-EVI-001). Hacen falta todos, no solo los afectados, porque el retroceso compara con los pares
  y mira aguas arriba. Añade los cortes de conexión (DS-013) de la ventana si están cargados y la
  referencia (hash) a la versión consolidada vigente para el esperado. Se guarda comprimido, como
  las lecturas retenidas (OQ-145).
- **Origen del recorte**: las lecturas retenidas si cubren la ventana; si no, el original archivado
  (como `incident-cut.ts`); si tampoco, el expediente se crea sin recorte, en `unknown` y diciendo
  qué fichero hay que volver a cargar. Nunca se completa con lecturas inventadas (R-EVI-002).
- **Reproducible**: lo calculado (retroceso, replay, comparación, batería) se recalcula desde el
  recorte, la configuración y las versiones de algoritmo de la revisión. Al abrir un expediente con
  un algoritmo más nuevo, se enseñan las dos versiones y nada se sobrescribe (`VERSIONING.md`
  §Algoritmos).
- **Presupuesto**: el recorte está excluido del 5 % de la memoria normal (`PERFORMANCE_BUDGET.md`,
  «excluye recorte deliberado de incidencias»), pero se mide y se enseña en la pestaña Memoria
  junto a lo demás. Con el circuito de auditoría se medirá antes de fijar un límite.

### D5. Separación de la memoria normal

- El expediente vive en su **propio almacén** (`incidents`, IndexedDB, nueva versión del almacén con
  su migración), solo en este dispositivo (D2). No va en el `.agvproj`.
- Crear, guardar, cambiar de estado, cerrar o descartar un expediente **no escribe** en circuito,
  revisiones, fuentes, instantáneas, memoria, estado de memoria, plano, archivo ni valores de planta.
  La prueba (INV-008, TC-017) compara el hash de cada uno de esos almacenes antes y después.
- La relación con un hallazgo vive solo en el expediente (`disposición: vinculado a incidencia` de
  `DOMAIN_MODEL.md` §Finding se **calcula** al leer, no se escribe en la revisión en campo).
- **Exclusión del esperado**: `INCIDENTS_REPORTING.md` §9 ya dice que el periodo de una incidencia
  queda fuera del esperado por defecto. Por eso, al previsualizar la siguiente consolidación, la
  ventana de cada expediente no descartado que caiga en el periodo aparece como **incidencia
  excluida propuesta** junto a las de R-INC-004, y la persona la mantiene o la quita. Es la
  consolidación la que lee el expediente; el expediente nunca escribe la memoria.

### D6. Lenguaje de causalidad y correlación

Toda relación entre un hecho y el síntoma lleva una de cinco etiquetas, y solo esas:

| Etiqueta | Qué afirma | Quién la pone | Qué exige |
|---|---|---|---|
| `precede` | A ocurrió antes que el síntoma, dentro de la ventana, a tal tiempo y tantos tags aguas arriba | programa | orden en el recorte |
| `es compatible con` | La hipótesis predice lo observado y nada observado la contradice | programa | evidencia a favor enlazada a filas; ninguna en contra |
| `contradice` | Un hecho observado no es posible si la hipótesis fuera cierta | programa | la fila que la contradice |
| `correlaciona` | A y el síntoma coinciden más de lo que da el azar | programa | **repetición**: varios episodios del mismo expediente o casos de la biblioteca, con la misma prueba de azar que el resto del producto; con un solo episodio no existe |
| `confirmado como causa` | Una persona lo comprobó | **solo una persona** | nota con la comprobación (por ejemplo en campo); conserva el origen inferido (R-EVI-005) |

- **Sin probabilidades.** Las hipótesis no llevan porcentaje. Se ordenan primero por si algo las
  contradice (las contradichas van al final, visibles) y luego por cuántas comprobaciones
  independientes las sostienen, y cada una dice **qué comprobación discriminaría mejor** entre ella y
  la siguiente (`INCIDENTS_REPORTING.md` §4, paso 8).
- **Vocabulario prohibido en texto generado**: «causa», «causó», «provoca», «debido a», «por culpa
  de», «el origen es» y sus variantes solo pueden aparecer en el bloque de confirmación humana. Una
  prueba recorre todos los textos que genera el módulo de expedientes y falla si aparecen fuera de él.
- **Las hipótesis candidatas salen de lo que ya se mide**, con su evidencia: la lectura de la batería
  R-AGV-021 (avanzaba sin registrar, lo adelantaron, parado con cola), los cortes de conexión
  observados (ADR-0017), la parada de la línea (R-FLO-010), quién retiene (R-AGV-020), la lectura del
  AGV (R-AGV-016) y el calendario. La persona puede añadir las suyas.

### D7. Retroceso desde el síntoma (ALG-015)

Un procedimiento determinista sobre el recorte, en los ocho pasos de `INCIDENTS_REPORTING.md` §4,
hecho con piezas que ya existen: la primera desviación es la primera transición que pasa la valla de
su tramo (R-FLO-007); aguas arriba es el anillo de la versión aplicable; los pares son la cohorte;
comunicación son los cortes de DS-013 y las lecturas que llegaron juntas, separados (R-COM-006). La
salida es una **cronología** de hechos con su etiqueta (D6), su tiempo antes del síntoma y su
distancia en tags. **El orden de la lista es temporal, no de importancia ni de causa.** ALG-015 se
llama desde el 2026-10-09 «Retroceso desde el síntoma» (OQ-169).

### D8. Replay multi-AGV con esperado e incertidumbre (ALG-016)

Se amplía `replay.ts`, no se escribe otro: sobre el recorte, cada AGV en `observed` (en tag),
`inferred` (en tramo, como **banda** temporal, nunca punto), `unknown` (silencio) o sin datos; más
una capa **esperada** desde las horquillas de la versión aplicable (dónde debería estar un AGV que
salió de A a tal hora, con su banda p50–p95), los cortes de conexión observados y los eventos de la
cronología sincronizados. Se precalcula en el Worker (WP-001) y cumple PERF-D4.

### D9. Contramedidas y verificación (R-INC-003)

- Una contramedida tiene acción, responsable, fecha prevista y de aplicación, estado, riesgo y
  **métrica de verificación**, que se fija al planificarla y no se cambia después sin revisión nueva.
- Aceptado el 2026-10-09 (OQ-P07): la métrica es la misma que define el síntoma (por ejemplo, minutos sin paso
  por un punto crítico por hora de producción), con la misma normalización y las mismas versiones,
  antes y después de la fecha de aplicación, sin las ventanas de otros expedientes, con una prueba de
  azar sobre las tasas. El programa propone **eficaz** (baja más de lo que da el azar y al menos una
  fracción configurada), **parcial** (baja, pero menos), **ineficaz** (con exposición suficiente no
  baja) o **sin exposición suficiente**, con umbrales en configuración `draft`. La conclusión la
  escribe una persona; sin ella no hay `Verified*`.

### D10. Biblioteca y similitud (ALG-017)

- Solo entre expedientes **del mismo circuito** (ADR-0004); comparar circuitos es F7.
- Las características son las de `INCIDENTS_REPORTING.md` §6, cada una con su comparación visible
  (igual, parecido con su diferencia, distinto, sin dato). **No hay una puntuación oculta**: se
  ordena por cuántas características coinciden, con el mismo peso, y a igualdad por fecha.
- Una causa confirmada en un caso anterior se enseña como «confirmado en aquel caso» con la nota «no
  es evidencia para este» y no cambia ninguna etiqueta del expediente actual. Varios casos similares
  sí pueden convertir un `precede` en `correlaciona` (D6), con la prueba de azar.

### D11. Informe vivo y exportación

Se regenera desde la revisión en los diez apartados de `INCIDENTS_REPORTING.md` §8, siempre con la
revisión, su hash y las versiones de reglas, algoritmos y configuración. Aceptado el 2026-10-09
(OQ-P03): HTML autocontenido, sin red, y CSV de la cronología y de la evidencia; el PDF sale de imprimir el HTML
desde el navegador, sin dependencia nueva. Un informe es una instantánea con fecha; el expediente
sigue vivo. Nunca se publica en GitHub (ADR-0007).

## Cómo cubre cada criterio de G5

| Criterio de G5 | Decisión |
|---|---|
| Incidencia reproducible con ventana antes/durante/después | D2, D4 |
| Replay multi-AGV muestra incertidumbre | D8 |
| Similitud explica diferencias y no afirma causalidad | D6, D10 |
| Contramedida y verificación se registran | D3, D9 |
| Informe local contiene evidencia y versiones | D11 |
| Guardar/cerrar incidencia no altera memoria normal | D5 |

## Entregas propuestas, una por petición

1. Modelo y almacén local, creación desde hallazgo, incidencia excluida, intervalo o síntoma,
   recorte congelado y separación probada (INV-008, TC-017).
2. Retroceso y cronología con el lenguaje de D6, y el **caso de oro sintético de TC-012**: un punto
   crítico sin llegada diez minutos plantado en el circuito de auditoría, con su ventana de impacto y
   sin una causa única afirmada.
3. Replay multi-AGV con esperado e incertidumbre.
4. Hipótesis, contramedidas y verificación.
5. Informe vivo y exportación.
6. Biblioteca y similitud.

Con las seis, la salida demostrable de F5 se recorre de punta a punta con el caso sintético. Con
datos reales la valida el propietario en su dispositivo, fuera del repositorio (OQ-B05).

## Consecuencias

- Hay un almacén más, con su migración. Como el expediente no viaja en el `.agvproj`, **borrar los
  datos del navegador lo pierde** y no hay copia; si un día hace falta, la sección `incidencias/` de
  ADR-0012 es el sitio, con su prueba de ida y vuelta (NFR-007).
- El recorte de un expediente es la única copia de lecturas que no caduca con la retención; por
  eso se mide y se enseña.
- La incidencia excluida de F4 no cambia de forma ni de sitio; solo gana un nombre distinto en la
  interfaz y la posibilidad de abrir un expediente desde ella.
- Al prohibir el vocabulario causal en texto generado, algunos textos actuales de la batería y de
  los hallazgos pueden necesitar retoque si se reutilizan dentro del expediente; la prueba lo dirá.
- ALG-015 cambia de nombre en el catálogo; su contenido no cambia.

## Alternativas descartadas

- **Guardar el expediente dentro de la versión consolidada**, como la incidencia excluida: lo ata
  al ritmo de las consolidaciones, lo hace inmutable cuando tiene que estar vivo y mezcla la
  investigación con la memoria normal (ADR-0006).
- **Referenciar las lecturas en lugar de copiarlas**: deja de ser reproducible en cuanto la
  retención las suelta (R-DAT-023).
- **Copiar solo las lecturas de los AGV afectados**: más pequeño, pero sin pares ni aguas arriba el
  retroceso y la comparación no se pueden hacer.
- **Una confianza numérica por hipótesis**: no hay un modelo que la sostenga y parecería una
  probabilidad de causa (ADR-0003).
