---
document_id: TT-REV-001-A
version: 0.1.0
status: informative
last_updated: 2026-10-18
---

# Anexo A — Arquitectura, redundancia y rendimiento del código

> Informe de uno de los cinco frentes de la revisión general del 2026-10-18 ([`REVISION_2026-10-18.md`](../../REVISION_2026-10-18.md)),
> tal como lo entregó el revisor, sobre el commit `d5ecfee` (3.88.4). Las líneas citadas son las de ese commit;
> las correcciones aplicadas después (3.89.0) las resume el informe principal. Las rutas `<entorno de revisión>`
> eran ficheros temporales (scripts de reproducción, capturas) que no se conservan en el repositorio.
> No se ha editado el contenido.


Repositorio `/home/user/tag-trace` en `d5ecfee` (3.88.4, fase F6). Revisión de solo lectura: `git status`
limpio al terminar. Scripts y salidas de apoyo en
`<entorno de revisión>/A/`
(se citan por nombre de fichero). Verificaciones ejecutadas: `npx tsc --noEmit` (pasa, 16 s, `tsc.log`),
`npm run build` (pasa, `build.log`), `npx vitest run` (76 ficheros, 962 pruebas, todas pasan, `vitest.log`).

## 1. Cómo está organizado el código

TAG TRACE es una PWA sin backend ni dependencias de ejecución (`package.json` solo tiene devDependencies):
los dos bundles de `dist/` son 100 % código propio. El código vive en `src/` (51.053 líneas) y
`workers/` (3.715), más `tests/` (25.945). Hay cinco capas: `src/domain/` (64 módulos, ~25k líneas de
reglas puras: tiempo y zona horaria, grafo, vueltas, matriz de lecturas, calles, incidencias, expedientes,
memoria y consolidación, plan…), `src/ingestion/` (parseo CSV/XLSX, listas, flota, registro de conexiones),
`src/application/` (`protocol.ts` con los 51 tipos de mensaje UI↔Worker, `snapshot-assembly.ts`,
`reading-columns.ts`, `perf-bench.ts`), `src/persistence/` (`store.ts` sobre IndexedDB con 12 migraciones,
`.agvproj` como zip+JSON, xlsx/zip propios) y `src/presentation/` (DOM a mano sin framework: `main.ts`
arranca la página, habla con el Worker y pinta las 7 pestañas; paneles aparte para memoria, expedientes,
plan, valores de planta, banco y almacén; `diagnostic-charts.ts` y `charts.ts` dibujan en canvas/SVG).
`workers/import.worker.ts` es el único Worker: recibe un mensaje por trabajo (`scope.onmessage`,
línea 3626) y despacha a doce familias (`runImport`, `runMemory`, `runPlan`, `runPlantValue`,
`runCompareVersions`, `runLists`, `runFleet`, `runConnections`, `runCase`, `runCaseReplay`,
`runCaseEvidenceCsv`, `applyCaseAction`); todo el cálculo pasa por él y la UI solo pinta lo que recibe
(`tests/unit/layering.test.ts` lo vigila). El Worker también lee y escribe el almacén directamente.
El dominio está limpio: ningún módulo de `src/domain` ni `src/application` toca DOM, `indexedDB`,
`postMessage` ni `Worker` (grep, §3 abajo).

## 2. Tabla de hallazgos

| ID | Tipo | Gravedad | Dónde | Qué | Propuesta | Esfuerzo |
|---|---|---|---|---|---|---|
| A-01 | Redundancia / Límite de módulo | **alta** | `src/presentation/cases-ui.ts:60-87`, `src/presentation/plan-ui.ts:124-142` | La conversión hora de pared → UTC está reimplementada en presentación con el método iterativo que `src/domain/time.ts:143-170` (ADR-0013) rechaza; en la hora repetida de octubre da un instante distinto al del dominio y pierde la marca `dst_ambiguous` (comprobado) | Usar `wallClockToUtc` como ya hace `main.ts:236-242`; un `src/presentation/time-input.ts` con `toDateTimeInput`/`fromDateTimeInput`/`isoDay`; prueba con la hora repetida | pequeño |
| A-02 | Rendimiento | media | `src/presentation/diagnostic-charts.ts:59-77` | `responsive()` registra en cada gráfico un listener de `matchMedia("(prefers-color-scheme: dark)")` que nunca se quita; 17 puntos de llamada, se repite en cada `renderViews` → listeners y datos de gráficos viejos retenidos toda la sesión | Un solo listener de módulo que recorra un `Set` de hosts conectados, o `AbortController` ligado a la vida del host | pequeño |
| A-03 | Rendimiento | media | `src/presentation/main.ts:199-215, 221, 687`; `src/domain/snapshot-findings.ts:62-69`; `src/presentation/plan-ui.ts:120,128`; `src/presentation/cases-ui.ts:46,74` | `new Intl.DateTimeFormat(...)` construido en cada llamada de `formatInstant`/`formatTick` (58 puntos de uso en `main.ts`, varios por fila de tabla); medido 156 µs frente a 1,8 µs con el formateador cacheado | Formateadores a nivel de módulo (el dominio ya lo hace: `time.ts:72 formatterCache`) | pequeño |
| A-04 | Rendimiento | baja | `src/domain/activity.ts:39-57`; llamado desde `workers/import.worker.ts:1357,1751` | `hourlyProfile` llama a `formatToParts` por lectura (dos veces por importación); 295 ms/100k lecturas en Node frente a 4 ms con caché por hora; el dominio ya tiene `localHourReader`/`localDayReader` con caché (`silence-kind.ts:119-159`) | Reutilizar esos lectores | pequeño |
| A-05 | Redundancia | media | 9 ficheros de `src/presentation` + `main.ts:187` | El helper `node(tag, className?, text?)` está copiado en 9 ficheros (8 idénticos byte a byte) y `element()` en `main.ts` es el mismo; `button()` copiado idéntico en 4 | `src/presentation/dom.ts` con `node`, `button` (y `downloadBlob`, A-06) | pequeño |
| A-06 | Redundancia / Mejora | media | `main.ts:1385-1392, 2363-2372, 2532-2540, 2565-2574, 3082-3092, 3324-3332, 6163…`; `franjas-ui.ts`, `review-ui.ts`, `report.ts:287-297` | El bloque Blob → `createObjectURL` → `<a download>` → `click` → `revokeObjectURL` aparece 10 veces con dos políticas distintas de revocación (inmediata en 7, `setTimeout(…,1000)` en 2) | Un `downloadBlob(name, blob)`; una sola política (la diferida es la segura) | pequeño |
| A-07 | Redundancia | baja | ver §3 | `duration()` ×5 (dos semánticas), `percent()` ×6 (dos redondeos), `pad` ×9, `slug+stamp` de nombre de fichero ×2 (`report-text.ts:69-80` ≡ `case-report.ts:60-74`), `seconds`/`minutes`/`hours` sueltos | `src/domain/format.ts` puro (sin DOM) con dos duraciones nombradas y un `percent`; `fileStamp()` compartido | pequeño/medio |
| A-08 | Código muerto | baja | lista en §3 y `dead-exports.txt` | 10 símbolos sin ningún uso (4 en `store.ts`), 51 funciones/constantes exportadas que solo se usan en su propio fichero, 270 tipos exportados que nadie importa, 98 símbolos usados solo por pruebas | Borrar los 10; quitar `export` a los internos (así `noUnusedLocals` los vigila); los «solo pruebas» se aceptan como API probada | pequeño |
| A-09 | Límite de módulo | media | `main.ts:82-88`, `review-ui.ts`, `storage-ui.ts`; `import.worker.ts:46,246` y 51 imports a `domain`/`ingestion`; `importer.ts:27`; `tests/unit/layering.test.ts` | `ARCHITECTURE.md` §3 dibuja UI→APP, WORKER→APP, PERSIST→APP; lo real es UI→persistence (3 ficheros, 6 módulos) y UI→domain (17 módulos), Worker→domain/ingestion/persistence sin pasar por `application`, `ingestion`→`application` (tipos), y el lector `.xlsx` (ingesta) vive en `persistence`. La prueba de capas solo vigila dos aristas. El dominio sí está limpio | Actualizar §3 a lo que hay (es razonable) y codificar en `layering.test.ts` las reglas que de verdad se cumplen: dominio sin DOM/IDB/Worker, Worker sin `presentation`, `presentation` sin `ingestion`/`workers`; mover `xlsx.ts` a `ingestion` | pequeño (prueba+doc) |
| A-10 | Mejora | media | `long-functions.txt` | 40 funciones de ≥150 líneas: `buildViews` 1.326 (`import.worker.ts:643-1968`), `createMemoryPanel` 1.092, `createCasesPanel` 873, `createPlanPanel` 690, `ringFigure` 584, `measureLineFeed` 500, `flowStops` 429, `createPlantValuesPanel` 388, `importReadings` 366, `renderCircuitState` 312, `handleMessage` 295… | Cortes por las costuras que ya existen (comentarios `// ---` y funciones anidadas), ver §3 | medio |
| A-11 | Mejora | media | `main.ts` (6.385 líneas, 111 funciones, 17 `let` de estado global), `import.worker.ts` (12 familias), `store.ts` (38 funciones sobre 9 agregados + 120 líneas de migraciones), `diagnostic-charts.ts` (20 gráficos) | Cuatro ficheros concentran responsabilidades distintas | `presentation/views/<pestaña>.ts` siguiendo las secciones de `renderViews` (2125-2304); `application/jobs/<familia>.ts` con el Worker como despachador; `store-migrations.ts` | medio/grande, por pasos |
| A-12 | Mejora (bundle) | baja | `dist/assets` | `index` 442,7 kB (142,5 kB gzip), `worker` 358,8 kB (122,4 kB gzip), CSS 38,9 kB. Sin terceros: `main.ts` 133 kB (30 %) + `diagnostic-charts.ts` 86 kB (19,5 %); el 17 % de `main.ts` son literales de texto de UI. ~45 kB de dominio/persistencia van en los dos bundles | Poco que ganar sin tocar texto; opcional `import()` diferido de banco/informe (~27 kB). Fijar un presupuesto de bundle en `PERFORMANCE_BUDGET.md` (hoy no hay cifra) | pequeño |
| A-13 | Tipado | — (bien) | todo `src/**`, `workers/**` | `tsc` pasa con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`; 0 `any`, 0 `@ts-ignore`/`@ts-expect-error`, 2 `as unknown as`, 16 `!` (15 en tablas de programación dinámica de `anchor-sums.ts`, 1 en `vsystem.ts:268`) | Nada urgente | — |
| A-14 | Rendimiento | baja | `src/domain/incident-cut.ts:47`, `flow-stops.ts:258`, `fleet.ts:394` | Búsquedas lineales dentro de bucles sobre lecturas (O(lecturas × recortes), O(tramos × eventos)); hoy acotadas por tamaños pequeños del segundo factor. No hay `JSON.parse(JSON.stringify)`, ni `setInterval` sin limpiar, ni concatenación de strings grandes | Dejar anotado; indexar por tiempo si crecen los recortes | pequeño |

## 3. Detalle y evidencia

### A-01 — Conversión de hora local duplicada en presentación, y divergente (alta)

`src/domain/time.ts:143-170` (`wallClockToUtc`) explica por qué **no** se itera: «en el cambio de octubre
converge siempre al segundo instante, así que … la hora repetida se daría por única». `PROJECT_MEMORY.md`
lo repite como decisión firme (ADR-0013). Sin embargo:

- `src/presentation/cases-ui.ts:60-71` (`fromLocalInput`) hace exactamente eso: `for (let pass = 0; pass < 2…) guess += wall - shown`, con `fromLocalParts` (73-87) construyendo su propio `Intl.DateTimeFormat`.
- `src/presentation/plan-ui.ts:124-142` (`zoneMidnight`) repite la misma idea para las 00:00 de un día.
- `src/presentation/main.ts:236-242` (`fromDateTimeInput`) sí usa `wallClockToUtc`. Tres implementaciones para la misma entrada `datetime-local`; también tres formateadores de salida (`toDateTimeInput` main.ts:220, `toLocalInput` cases-ui.ts:45, `isoDay` plan-ui.ts:120).

Comprobación (`dst-check.mjs`, módulos compilados con `npx esbuild … --bundle` al scratchpad, salida en
`dst-check.txt`):

```
hora repetida 25/10/2026 02:30 Europe/Madrid
  domain/time.wallClockToUtc -> 2026-10-25T00:30:00.000Z flag=dst_ambiguous
  cases-ui.fromLocalInput    -> 2026-10-25T01:30:00.000Z  DISTINTO
hora inexistente 29/03/2026 02:30 -> IGUAL ; hora normal -> IGUAL ; plan-ui.zoneMidnight -> IGUAL
```

Una ventana de expediente escrita a mano a las 02:30 del día del cambio queda una hora desplazada
respecto a lo que el dominio decide para las lecturas, y sin la marca. Es un caso de una hora al año, pero
es precisamente el caso por el que ADR-0013 existe, y las dos funciones de `cases-ui.ts` están además
exportadas sin que nadie las importe (`dead-exports.txt`).

### A-02 — Listener de `matchMedia` que se acumula (media)

`src/presentation/diagnostic-charts.ts:72-74`:
```ts
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
  if (host.isConnected && last > 0) draw(last);
});
```
No se guarda referencia ni se quita nunca; el `ResizeObserver` de 61-70 sí se desconecta cuando el host
sale del DOM, pero solo en su siguiente callback. `responsive()` se llama desde 17 gráficos
(`grep -n "responsive(" diagnostic-charts.ts`: 489, 1032, 1384, 1793, 1874, 2043, 2160, 2364, 2500,
2617, 2750, 2937, 3234, 3492, 3687, 3828, 3954), y `renderViews` (`main.ts:2125`, llamado en
`main.ts:1100` por cada resultado del Worker) vuelve a crearlos todos (p. ej. `TREND_PANELS = 9` paneles,
`FORK_DIAGRAMS = 4`). Cada closure `draw` retiene los datos del gráfico. Ninguno de los 15 ficheros de
presentación llama a `removeEventListener` salvo `update.ts` (1 vez) (`listeners.txt`). El resto de
listeners se cuelgan de nodos recién creados que se tiran con `replaceChildren()` (`main.ts:2104-2115`),
así que no se acumulan: el problema es solo este, porque el objetivo (`window.matchMedia`) vive siempre.

### A-03 / A-04 — `Intl.DateTimeFormat` construido por llamada (media / baja)

Puntos: `main.ts:200, 209, 221, 687`; `snapshot-findings.ts:63, 68`; `plan-ui.ts:120, 128`;
`cases-ui.ts:46, 74`; `incident-case.ts:289` (`grep -rn "new Intl.DateTimeFormat"`). En `main.ts`
`formatInstant`/`formatTick` tienen 58 puntos de uso, varios dentro de `.map` por fila. Medición
(`intl-bench.mjs`, Node 22): 20.000 llamadas → **3.122 ms sin caché (156 µs/llamada) frente a 37 ms con
el formateador cacheado (1,8 µs)**. En el navegador la proporción es parecida. `src/domain/time.ts:72`
ya tiene un `formatterCache`; es cuestión de aplicar el mismo patrón.

`src/domain/activity.ts:48-57` llama a `formatter.formatToParts` por lectura (`hourlyProfile`, invocado en
`import.worker.ts:1357` y `1751` en cada importación). `parts-bench.mjs`: 100.000 lecturas → 295 ms;
con una caché por hora UTC → 4 ms. `silence-kind.ts:119-159` ya implementa `localHourReader` y
`localDayReader` con caché por cuarto de hora: `hourlyProfile` puede usarlos tal cual.

### A-05 / A-06 — Helpers DOM y descarga copiados (media)

`grep -rn "^function node<" src/presentation` → `review-ui.ts:62`, `plan-ui.ts:36`, `drawer.ts:19`,
`plant-values-ui.ts:32`, `report.ts:63`, `evolution.ts:23`, `cases-ui.ts:23`, `franjas-ui.ts:31`,
`memory-ui.ts:21`; md5 de los 6 primeras líneas: 7 iguales (`e22faab5`), `drawer.ts` y `report.ts`
difieren solo en un comentario o el nombre de la variable; `main.ts:187 element()` es el mismo cuerpo.
`button()` idéntico (`7aa27bba`) en `plan-ui.ts:43`, `plant-values-ui.ts:39`, `cases-ui.ts:30`,
`memory-ui.ts:28`.

`grep -rnc "URL.createObjectURL" src`: `main.ts` 7, `review-ui.ts` 1, `report.ts` 1, `franjas-ui.ts` 1.
Los bloques de `main.ts:2363-2372, 2532-2540, 2565-2574, 3082-3092, 3324-3332` son la misma secuencia de
8 líneas con `URL.revokeObjectURL(url)` inmediato tras `link.click()`; `main.ts:1392` y `report.ts:295`
revocan con `setTimeout(…, 1000)`. La revocación síncrona tras `click()` es una fuente conocida de
descargas vacías en algunos navegadores; conviene una sola función y la política diferida.

### A-07 — Formato de duraciones, porcentajes y relleno (baja)

- `duration(ms)`: `main.ts:5101` y `snapshot-findings.ts:76` (idénticas; el comentario de la segunda dice literalmente «Mismo formato que `duration` de `main.ts`»), `incident-battery.ts:129` y `line-feed.ts:195` (idénticas entre sí, con coma decimal), `diagnostic-charts.ts:3105`; además `case-backtrack.ts:98 formatDuration` (exportada, solo la usan pruebas).
- `percent(rate)`: `snapshot-findings.ts:71`, `main.ts:3353`, `diagnostic-charts.ts:41`, `change-class.ts:101`, `snapshot.ts:521` (todas `Math.round(rate*100) %`) y `affinity.ts:150` (`toFixed(1)`).
- `pad`: 9 definiciones locales (`report-text.ts:76`, `case-report.ts:71`, `main.ts:2820`, `perf-bench.ts:69`, `fleet-history.ts:96`, `time.ts:449`, `silence-kind.ts:174`, `plant-values.ts:604`, `main.ts` dentro de `toDateTimeInput`).
- Nombre de fichero con `slug` NFD + `stamp`: `report-text.ts:69-80` y `case-report.ts:60-74`, misma cadena de `.normalize("NFD").replace(…)` y mismo `pad`.
- `hours`: `main.ts:2822` (arrow local) frente a `report-text.ts:63 formatHours`.

Las variantes no son todas erratas (coma decimal en dominio para CSV frente a texto de pantalla), pero dos
funciones con nombre (`durationShort`, `durationDecimal`) en un módulo puro de dominio bastan y evitan que
la tercera copia divergiera sin querer.

### A-08 — Exportaciones sin uso (baja)

Script `dead-exports.mjs` (API del compilador TypeScript: resuelve cada `import {…} from "./x.js"` y
`export … from` de `src/**`, `workers/**` y `tests/**`, y cruza con las declaraciones `export` de cada
módulo). 1.131 exportaciones en 108 ficheros. Resultado completo en `dead-exports.txt`; verificación
cruzada por `grep -w` del nombre en su propio fichero y en el resto del repositorio.

**Sin ningún uso (borrables):**
`src/persistence/store.ts:496 listCircuits`, `:575 saveSourceReadings`, `:588 dropSourceReadings`,
`:929 saveMemoryState`; `src/domain/config.ts:365 describeConfig`; `src/domain/dossier.ts:331 dossierTruth`;
`src/domain/truth.ts:16 isFact`; `src/presentation/diagnostic-charts.ts:313 ringChart`;
re-exportaciones `src/presentation/labels.ts:101-102 FINDING_KINDS, FindingKind` y
`src/ingestion/catalog.ts:23 KnownList`.

**Exportadas pero usadas solo dentro de su fichero (51; quitar `export`):** entre otras
`memory-ui.ts:35-137` (10 helpers: `kilobytes`, `BLOCKER_LABEL`, `CHANGE_CLASS_LABEL`, `changeSummaryLine`,
`incidentReach`, `incidentWhen`, `incidentWindows`, `cutLine`, `adoptedChangeText`, `betweenLine`),
`cases-ui.ts:45,60,146`, `report.ts:74,241,287`, `diagnostic-charts.ts:1352 heatStripChart`,
`drawer.ts:71 openDrawer`, `franjas-ui.ts:62 sumLine`, `plan-ui.ts:50`, `labels.ts:80 REGIME_WORDS`,
`importer.ts:30 LIMITS, :190 mapColumns`, `agvproj.ts:297,365,400 *_SECTION`, las constantes
`*_ALGORITHM`/`*_SCHEMA_VERSION` de `case-backtrack.ts:36`, `case-similarity.ts:21`,
`case-verification.ts:23`, `incident-case.ts:32,39`, `plan.ts:25`, `replay.ts:160`,
`semantic-hash.ts:20`, y funciones de dominio como `anchor-sums.ts:502 changeClusters`,
`circuit-state.ts:151 expectedElsewhere`, `connection-cuts.ts:143,345`, `franjas.ts:110,301`,
`incident-case.ts:159,504`, `memory.ts:211,813`, `silence-kind.ts:228`, `vsystem.ts:251,264`,
`plant-values.ts:709`, `vehicle-pace.ts:124`, `change-class.ts:40`, `store.ts:1030`.

**Solo las usan pruebas (98: 42 funciones, 11 constantes, 45 tipos):** p. ej. `drift.ts:316
compareDistantPeriods` (202 líneas, solo `tests/audit` y `tests/unit`), `dossier.ts:85 buildAgvDossier` y
`:271 buildTagDossier`, `graph.ts:194 buildObservedGraph`, `plant-values.ts:597 estimatePlantValue`,
`project-memory.ts:104,122`, `retention.ts:26,50,93`, `anchor-sections.ts:106,174`. Son API interna
probada a través de la unidad y no del flujo: legítimo, pero conviene saberlo antes de cambiar firmas.

**Tipos exportados que nadie importa: 270** (219 interfaces + 51 alias). La mayoría son tipos de retorno
de funciones públicas; no es código muerto, pero infla la superficie.

### A-09 — Límites de módulo frente a `ARCHITECTURE.md` §3 (media)

Grafo de imports (`imports.tsv`, 464 aristas, de `grep -rnoE "^\s*(import|export)… from"`):

- **presentation → persistence** (el diagrama no tiene esa arista): `main.ts:82-88` importa `agvproj.js`, `project-incidents.js`, `project-memory.js`, `project-plan.js`, `project-plant-values.js`, `store.js`; `review-ui.ts` y `storage-ui.ts` importan `store.js`.
- **presentation → domain**: 17 módulos en `main.ts` (CSV: `listCleanupCsv`, `lineStopsCsv`, `incidentsCsv`, `bandsCsv`, `anchorSectionsCsv`, `chronologyCsv`; textos y constantes; `changedTags`; `wallClockToUtc`). Son formateo y textos, no cálculo duplicado, salvo A-01.
- **workers → domain (45 módulos), ingestion (6), persistence (`xlsx.ts:46`, `retention.ts:246`)**, además de `application` (5). El diagrama dice WORKER → APP → CORE; en la práctica el Worker *es* la capa de aplicación.
- **ingestion → application**: `importer.ts:27` importa tipos de `protocol.ts` (`ImportErrorCode`, `SourceSummary`, `Stage`). Inversión leve (CORE → APP); se arregla moviendo esos tres tipos a `domain/reading.ts` o a un `ports.ts`.
- `src/persistence/xlsx.ts` y `zip.ts`: lector de `.xlsx` (ingesta de listas y flota) ubicado en persistencia.
- **domain y application limpios**: `grep -rnE "\b(document|window|indexedDB|postMessage|self\.|localStorage|navigator|HTMLElement|Worker\b|requestAnimationFrame|fetch\(|Date\.now|Math\.random)"` sobre `src/domain src/application` no da ningún uso real (solo palabras en comentarios y `windowMs`). Ningún import no relativo. Cumple «Núcleo … independiente de interfaz, Workers y persistencia».
- **worker no importa presentation**; **presentation no importa ingestion ni workers** (lo vigila `tests/unit/layering.test.ts`, que solo cubre esas dos aristas y el «sin camino de repuesto»).

Nota: `grep` trata `src/domain/graph.ts` como binario porque la línea 214 contiene un carácter de control
(`^@`, NUL) dentro de una plantilla de clave: ``${transition.from}^@${transition.to}``. Funciona como
separador, pero conviene cambiarlo por un carácter visible (`\u0000` escrito) o `"|"`: hoy rompe `grep`
y cualquier revisión por diff lo pierde.

### A-10 / A-11 — Funciones largas y ficheros con varias responsabilidades (media)

`long-functions.mjs` (AST): 40 funciones de ≥150 líneas (`long-functions.txt`). Cortes reversibles, sin
reescribir:

- `workers/import.worker.ts:643-1968 buildViews` (1.326 líneas) ya está dividido por comentarios: configuración de planta (657), grafo/cohortes/vueltas (687), bucle por cohorte (846-1200), instantánea (1627), comparación entre ficheros (1782). Cada tramo puede ser una función de `src/application/views/*.ts` que reciba `readings`, `config`, `lists` y devuelva su trozo de `CircuitViews`; el Worker solo compone. Lo mismo para las 12 familias `run*`: `src/application/jobs/<familia>.ts` y `onmessage` (3626) como despachador puro.
- `src/presentation/memory-ui.ts:231-1322 createMemoryPanel` (1.092), `cases-ui.ts:157-1029` (873), `plan-ui.ts:153-842` (690), `plant-values-ui.ts:125-512` (388): sus bloques internos ya son funciones anidadas (`consolidateBlock`, `casesBlock`, `cutControls`, `incidentsBlock`, `previewBlock`, `versionItem`, `compareBlock`, `forkBlock`…, ver `listeners.txt`). Subirlas a nivel de módulo pasándoles un objeto `ctx` con el estado que capturan.
- `src/presentation/main.ts` (6.385 líneas, 111 funciones de nivel superior, 17 `let` globales, `handleMessage` con 20 `case`): `renderViews` (2125-2304) ya separa las pestañas con `// --- Resumen / Datos / Tags / AGV / Tiempos / WiFi / Línea`. Un fichero por pestaña (`views/tags.ts` con `renderReadMatrix`, `renderTagChanges`, `renderUndeclaredTags`, `renderListCleanup`, `renderCircuitOrder`, `renderDrift`…) que reciba `(out, views, deps)` como ya hace `renderFranjas(out, views, { finding, formatInstant, … })` en `franjas-ui.ts:140`. Es el patrón que el propio código ya usa; solo falta aplicarlo al resto.
- `src/persistence/store.ts` (1.127): `MIGRATIONS` 294-413 (120 líneas, 12 pasos) a `store-migrations.ts`; agrupar los 38 `export function` por agregado (circuito, lecturas retenidas, instantáneas, memoria/versiones, plan, valores de planta, expedientes, revisiones, archivo).
- `src/presentation/diagnostic-charts.ts` (4.031, 20 gráficos exportados): `ringFigure` (331-914, con un callback de 288 líneas en 489-776) a su propio fichero; el resto se agrupa por familia (calor, tiempo, flota).
- Dominio: `line-feed.ts:221-720 measureLineFeed` (500), `flow-stops.ts:358-786 flowStops` (429), `circuit-state.ts:184-477` (294) ya definen helpers internos como `const positions = …`, `const lastStep = …`; sacarlos a funciones de módulo con parámetros explícitos es mecánico y hace cada paso probable por separado.

### A-12 — Tamaño del bundle (baja)

`npm run build` (`build.log`): `index-*.js` 442.730 B (gzip 142.469 B), `import.worker-*.js` 358.825 B
(gzip 122.371 B, calculado con `gzip -c | wc -c`), `index-*.css` 38.923 B; minificado por esbuild. Atribución
por sourcemap (`map-sizes.mjs`, decodifica los VLQ y suma bytes generados por fichero fuente):

- índice: `main.ts` 133.335 B (30,3 %), `diagnostic-charts.ts` 85.674 B (19,5 %), `memory-ui.ts` 30.021 B, `cases-ui.ts` 25.800 B, `plan-ui.ts` 19.140 B, `plant-values-ui.ts` 11.617 B, `report.ts` 10.690 B, `case-report.ts` 10.320 B; el 80 % del bundle son 11 ficheros de presentación.
- worker: `import.worker.ts` 62.666 B (17,5 %), `plan.ts` 20.415 B, `plant-values.ts` 14.846 B, `incident-case.ts` 13.541 B, `snapshot.ts` 12.015 B, `line-feed.ts` 11.125 B.
- Van en **ambos** bundles (Vite no comparte chunks entre hilo principal y Worker): `store.ts` (7,5 + 9 kB), `plant-values.ts` (5,5 + 14,8), `finding-kinds.ts` (3,5 + 3,4), `zip.ts`, `memory.ts`, `incident-battery.ts`, `time.ts`… ≈ 45 kB duplicados en total. Inevitable sin un chunk compartido; no merece esfuerzo.
- `literals.mjs`: en `main.ts` el 17 % de los bytes fuente son literales de texto (3.911 literales), 14 % en `diagnostic-charts.ts`. Es el coste del producto en español y no se recorta sin tocar la UX.
- No hay dependencia de terceros que quitar. `PERFORMANCE_BUDGET.md` no fija un presupuesto de tamaño de bundle (solo tiempos y memoria); conviene declararlo ahora que hay cifra.

### A-13 — Tipado (bien)

`npx tsc --noEmit` pasa en 16 s con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noUnusedLocals/Parameters`, `verbatimModuleSyntax` (`tsconfig.json`). Conteos (`grep -rnaE`):
`any` 0; `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck` 0; `as unknown as` 2 (`fleet-history.ts:75` sobre
un `RegExpExecArray`, `import.worker.ts:269 self as unknown as DedicatedWorkerGlobalScope`, ambos
razonables); `!` no-nulo 16 (`anchor-sums.ts:218, 229, 332-340, 387` en tablas de programación dinámica,
`vsystem.ts:268`). El resto del código usa `as number`/`as Step` para los índices, que es la alternativa
coherente con `noUncheckedIndexedAccess`.

### A-14 — Rendimiento: O(n²) y recálculos (baja)

`loops.mjs` (AST) lista 502 llamadas lineales (`find/filter/indexOf/includes/some/sort…`) dentro de
bucles (`loops.txt`), 182 de ellas en dominio/aplicación/Worker/ingesta. Revisadas por muestreo:

- La mayoría son `own.sort(…)` por vehículo dentro de `for (const [agvId, own] of byVehicle)` (`anchor-sums.ts:164`, `connection-cuts.ts:109,191`, `replay.ts:78,245`, `tag-changes.ts:172,250`, `drift.ts:222`, `fleet.ts:94,314`…): O(n log n) total, correcto.
- Otras recorren arrays acotados (anillo ≤150 tags: `vsystem.ts:234,256`, `change-class.ts:371`, `laps.ts:106`; cohortes: `import.worker.ts:846-1152`).
- Sí son O(n·m) con m potencialmente grande: `incident-cut.ts:47` (`cuts.findIndex` por lectura: lecturas × recortes), `flow-stops.ts:258` (`events.filter` por tramo de cobertura), `fleet.ts:394` (`times.filter` por tramo cubierto y vehículo), `line-feed.ts:369,424,575` (`positions()` por parada: recorre los vehículos con búsqueda binaria `lastStep` 331-340, así que es vehículos × paradas, aceptable). Hoy m es pequeño (recortes por expediente, tramos de cobertura); anotarlo en el código basta.
- `buildViews` hace 10 pasadas completas sobre `readings` (`grep -c "readings\.(filter|map|…)"` en 643-1968): lineal, no cuadrático.
- No hay `JSON.parse(JSON.stringify(…))` ni `structuredClone`; el único `setInterval` (`bench-ui.ts:195`) se limpia en 204; no hay `+=` de strings dentro de bucles sobre lecturas (solo trazados SVG en `diagnostic-charts.ts:2985-2987, 3990`, acotados por píxeles).
- Positivo: tablas grandes solo se construyen al abrirlas (`charts.ts:160-175 lazyTable`/`tableDrawer`), los canvas se dibujan cuando su pestaña tiene ancho (`responsive`) y `review-ui.ts:380` sí `dispose()` su observer.

## 4. Las cinco acciones con mejor relación valor/esfuerzo

1. **A-01** — Sustituir `fromLocalInput`/`fromLocalParts` (`cases-ui.ts`) y `zoneMidnight` (`plan-ui.ts`) por `wallClockToUtc`, y mover `toDateTimeInput`/`fromDateTimeInput` de `main.ts` a un módulo compartido; prueba unitaria con `2026-10-25T02:30 Europe/Madrid` que hoy falla. Una hora de trabajo; cierra una contradicción con ADR-0013 ya comprobada.
2. **A-02** — Un solo listener de `prefers-color-scheme` en `diagnostic-charts.ts` sobre un `Set<host>` (o `AbortController` por host). Media hora; quita la única fuga de la sesión.
3. **A-03 + A-04** — Formateadores `Intl` a nivel de módulo en `main.ts`, `snapshot-findings.ts`, `plan-ui.ts`, `cases-ui.ts`, y `hourlyProfile` sobre `localHourReader`/`localDayReader`. Una o dos horas; ×80 en los puntos medidos.
4. **A-05 + A-06** — `src/presentation/dom.ts` con `node`, `button`, `downloadBlob` y sustitución mecánica en 10 ficheros (una política de revocación). Media jornada; quita ~120 líneas repetidas y una fuente de descargas vacías.
5. **A-08 + A-09** — Borrar los 10 símbolos sin uso, quitar `export` a los 51 internos, y ampliar `tests/unit/layering.test.ts` con las reglas que de verdad se cumplen (dominio/aplicación sin DOM, IDB ni Worker; Worker sin presentación) más una línea en `ARCHITECTURE.md` §3 que diga lo que hay (UI → persistencia y dominio; Worker → dominio/ingesta/persistencia). Media jornada; convierte la arquitectura real en una regla que falla en CI, no en un dibujo.

Después, y ya por entregas: A-10/A-11 empezando por `buildViews` → `application/views/*.ts` y
`main.ts` → `views/<pestaña>.ts`, un corte por PR, porque son los dos ficheros donde cualquier cambio
futuro va a doler.
