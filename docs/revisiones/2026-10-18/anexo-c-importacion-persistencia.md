---
document_id: TT-REV-001-C
version: 0.1.0
status: informative
last_updated: 2026-10-18
---

# Anexo C — Importación, Worker y persistencia

> Informe de uno de los cinco frentes de la revisión general del 2026-10-18 ([`REVISION_2026-10-18.md`](../../REVISION_2026-10-18.md)),
> tal como lo entregó el revisor, sobre el commit `d5ecfee` (3.88.4). Las líneas citadas son las de ese commit;
> las correcciones aplicadas después (3.89.0) las resume el informe principal. Las rutas `<entorno de revisión>`
> eran ficheros temporales (scripts de reproducción, capturas) que no se conservan en el repositorio.
> No se ha editado el contenido.


- Fecha: 2026-10-18. Commit revisado: `d5ecfee` (3.88.4). Node 22.22, Vitest 5.0.5, Playwright 1.63 con Chromium 1194 (headless), 4 núcleos, 16 GB.
- Todo lo que escribí está en `<entorno de revisión>/C/` (pruebas Vitest `*.test.ts` + `vitest.review.config.ts`; pruebas Playwright en `e2e/` + `playwright.review.config.ts`; datos sintéticos en `data/`; salidas en `out-*.txt`). Los datos son sintéticos (`AGV-SYN-nnn`, `TAG-SYN-nnn`, circuitos `SYN-*`).
- Nota sobre el árbol de trabajo: no modifiqué ningún fichero del repositorio. Durante la revisión **otro proceso** editó 22 ficheros y añadió 3 (`src/presentation/*`, `src/domain/*`, `src/persistence/store.ts` —solo borra funciones sin uso—, `docs/ARCHITECTURE.md`, `tests/unit/layering.test.ts`) y recompiló `dist` a las 02:55. No los he tocado ni revertido. Mis pruebas de navegador corrieron contra la compilación de las 02:33 (commit) salvo las dos últimas (`carrera`, `limite-bytes`), que pudieron servirse ya desde la recompilación; ninguno de los ficheros de mi frente (`workers/import.worker.ts`, `src/ingestion/**`, `src/application/**`, `agvproj.ts`, `zip.ts`, `decode.ts`, `time.ts`) cambió. Las líneas que cito de `store.ts` y `main.ts` son las del árbol actual.

## 1. Cómo viaja un fichero, de elegirlo a quedar guardado

1. La persona elige un CSV/XLSX en `#source-file` (`src/presentation/main.ts`, `startImport`). La página **no lee el fichero**: crea un `Worker` nuevo por trabajo, genera un `jobId` (UUID) y le envía `{type:"start", file, zone, circuitId?}` con el `File` como asa, no como bytes.
2. El Worker (`workers/import.worker.ts`, `runImport`) responde `accepted`, lee `file.arrayBuffer()`, calcula **SHA-256 del fichero completo** (`hashFile`) —ese hash es a la vez `sourceId` y `sourceHash` de la fuente— y decide: si los bytes empiezan por `PK\x03\x04` lo trata como libro Excel (`readXlsxRows` → `rowsToDelimitedText`); si no, `decodeSource` intenta UTF-8 estricto y, si falla, Windows-1252.
3. `importReadings` (`src/ingestion/importer.ts`) hace **una sola pasada**: comprueba límites (512 MiB, 5 M filas), parte en líneas, puntúa `;`/`,`/tab por consistencia sobre 500 líneas, mapea la cabecera por alias (`fecha|date|…`, `agv|vehículo|…`, `tag|punto|…`), detecta el orden día/mes mirando qué campo supera 12, parsea cada fila (`parseTimestamp`, zona `Europe/Madrid`), manda a cuarentena con código (`FIELD_COUNT`, `EMPTY_FIELD`, `NO_TAG`, `DATE_*`), mide la monotonía, resuelve la hora repetida de octubre por posición y ordena. Cada 20.000 filas emite `progress` y mira la bandera de cancelación.
4. Si hay circuito, el Worker cede el turno a la cola de mensajes (`setTimeout 0`) para atender un `cancel` pendiente, emite `saving` (desde ahí la UI oculta «Cancelar») y **acumula** (`accumulate`): lee de IndexedDB el circuito, las lecturas retenidas y las instantáneas, comprueba afinidad, une por tramo común (`unionReadings`), aplica la retención (2 últimas cargas) y escribe circuito + lecturas nuevas (gzip de su JSON) + bajas en **una transacción** (`saveAccumulation`).
5. Después archiva el fichero original comprimido (`archiveSource`, otra transacción), calcula todas las vistas (`buildViews`, la parte larga), guarda la instantánea (`saveSnapshot`) y reescribe el circuito marcándola (`saveCircuit`): cuatro transacciones separadas.
6. Emite `complete` con el resumen, la cuarentena, avisos y las lecturas **por columnas** (`packReadings`): seis `ArrayBuffer` transferidos sin copia. La UI descarta cualquier mensaje cuyo `jobId`/`protocolVersion` no sea el vigente (`isCurrent`) y pinta todo con `textContent`.
7. La copia portable (`.agvproj`) la escribe el hilo principal con `writeProject`: zip propio (`zip.ts`) con `manifest.json` (esquema 6, hash de cada sección y hash del manifiesto) y `sections/*.json` canonicalizados. Al abrir uno, `readProject` descomprime con límites, valida esquema y hashes, y las secciones `memoria`/`plano`/`valores`/`incidencias` se incorporan cada una con su regla de prefijo o cadena de hashes, sin mezclar historiales.

## 2. Tabla de hallazgos

| ID | Tipo | Grav. | Dónde | Qué | Cómo se reprodujo | Propuesta | Esf. |
|---|---|---|---|---|---|---|---|
| C-01 | Fallo | media | `src/domain/time.ts:402-408`, `src/ingestion/importer.ts:349-374` | Una sola fila cuya fecha tiene ambos campos > 12 (p. ej. `24/13/2026`, inválida en cualquier orden) marca el orden como `CONTRADICTORY` y el **fichero entero** se rechaza con `DATE_AMBIGUOUS` («la fuente es incoherente… corrige la fuente»), aunque 200 filas sanas lo determinen. | Vitest `parseo2.test.ts`: 200 filas sanas + `24/13/2026` → `DATE_AMBIGUOUS`; con `31/02/2026` solo cuarentena. | En `detectFieldOrder`, ignorar como evidencia los valores con ambos campos > 12 (no encajan en ningún orden); solo declarar contradicción cuando haya valores que encajen **solo** en cada orden. Prueba de regresión. | bajo |
| C-02 | Fallo | media | `workers/import.worker.ts:2060-2122` y `2168-2170`; `store.ts:529,564,513` | La importación con circuito son 4 transacciones (acumulación, archivo, instantánea, circuito). Si la cuota se agota después de la primera, se emite `STORAGE_FULL` con «lo de esta operación **no se ha escrito**» pero la fuente queda acumulada, retenida y archivada, **sin instantánea**. | Playwright `cuota.spec.ts` con CDP `Storage.overrideQuotaForOrigin` = 4.002.616 B: mensaje `STORAGE_FULL` y en IDB `circuit.sources=1 retained=1 withSnapshot=0`, `sources` 1,37 MB, `archive` 587 KB, `snapshots` 0. | Una sola transacción `[circuits, sources, archive, snapshots]` (comprimir antes, como ya hace `saveAccumulation`), o un mensaje veraz («se guardaron las lecturas, no la instantánea; vuelve a cargar el fichero») y comprobación previa de `storage.estimate()`. | medio |
| C-03 | Fallo | media | `workers/import.worker.ts:375-377 → 450`; `store.ts:529` | `accumulate` lee circuito/lecturas/instantáneas en transacciones distintas y escribe después, sin guardia (como sí tiene `saveMemory(expected)`). Dos pestañas importando al mismo circuito a la vez: la segunda pisa el registro del circuito y quedan filas **huérfanas** en `sources`, `snapshots` y `archive`, sin ningún aviso. | Playwright `carrera.spec.ts`: dos páginas, mismo circuito `SYN-RACE`, dos ficheros de 400k → `circuit.sources=1` pero `sources=2`, `snapshots=2`, `archive=2`; ambos sin mensajes. | Guardia optimista en `saveAccumulation` (leer el circuito dentro de la transacción y abortar si `updatedAt`/`sources` cambiaron, como `MemoryChangedError`) y/o `navigator.locks.request(circuitId)` alrededor de la acumulación; «hay otra operación en curso» entre pestañas vía `BroadcastChannel`. | medio |
| C-04 | Límite | media | `workers/import.worker.ts:1976-2020`; `src/ingestion/importer.ts:239` | El límite de 512 MiB se comprueba **después** de leer el fichero entero, hashearlo y decodificarlo. `file.size` ya lo sabía. Durante el hash no hay progreso. | Playwright `limite-bytes.spec.ts` con 541 MB sintéticos: `LIMIT_EXCEEDED` correcto, pero a los **41,7 s**, con el proceso de renderizado en **1.192 MiB** de RSS (desde 458) y la nota fija en «Leyendo el fichero». | Rechazar por `file.size` antes de `arrayBuffer()` (Worker y UI); emitir progreso de la etapa `hashing`. | bajo |
| C-05 | Robustez | media | `workers/import.worker.ts:1997,2020` (fuera del `try` 2023-2191), `3626-3715` (`void run*`); `main.ts:1681-1688` | Un rechazo de promesa no capturado dentro del Worker **no dispara `worker.onerror`** en la página: la UI queda ocupada sin mensaje. `hashFile` y `decodeSource` están fuera del `try` de `runImport` y todos los `run*` se lanzan con `void`. El único rescate es el plazo de 500 ms, y solo en importaciones. Disparador concreto dependiente de plataforma: en Node la decodificación de > 512 MiB lanza `RangeError` justo ahí; en Chromium x64 no. | Playwright `rechazo-promesa.spec.ts`: Worker con `(async()=>{throw})()` → «nada en 1500 ms»; `throw` síncrono → `onerror`. Node `decode-limit.mjs` 520 MiB: `Cannot create a string longer than 0x1fffffe8`. | `self.onunhandledrejection` en el Worker que emita `error INTERNAL` con `jobId` vigente; meter hash/decodificación en el `try`; plazo para `accepted` en la UI (WORKER_PROTOCOL §4 lo prevé y no está). | bajo |
| C-06 | Robustez | media | `src/ingestion/importer.ts:270-300`; `delimiter.ts:53-55` | Un fichero `;` con una columna numérica con **coma decimal** («1,5») de más de ~10 filas se rechaza con `DELIMITER_AMBIGUOUS` («;» 1,00 frente a «,» 0,98) y la recuperación dice «fijarlo a mano todavía no es posible». Con 3-8 filas pasa porque la cabecera pesa. | Vitest `parseo2.test.ts`: 50 filas → rechazo; 8 filas → aceptado. | Cuando dos candidatos ≥ 0,9 y uno da más campos y el otro aparece siempre **dentro** de un campo del primero, elegir el de más campos y avisar; o permitir elegir separador como ya se elige el orden de fecha (`offerFieldOrder`). | bajo-medio |
| C-07 | Robustez | baja | `src/ingestion/decode.ts:31-35` | Un único byte inválido en UTF-8 (p. ej. exportación truncada a mitad de carácter) vuelca **todo** el fichero a Windows-1252: `Vehículo` → `VehÃ­culo`, la cabecera no se reconoce y el error es `SCHEMA_UNRECOGNISED` («no se reconocieron… AGV»), que no apunta a la causa. | Vitest `parseo.test.ts`: UTF-8 válido + un byte `0xE9` al final → `windows-1252`, `SCHEMA_UNRECOGNISED`, esquema `["Fecha","VehÃ­culo","Tag"]`. | Localizar el fallo (decodificar por bloques) y decir «UTF-8 inválido en el byte N»; si son pocos, decodificar UTF-8 con sustitución y poner esas filas en cuarentena. | bajo |
| C-08 | Robustez | baja | `src/ingestion/decode.ts` | UTF-16 con BOM (exportación «Texto Unicode» de Excel) no se detecta: se declara `windows-1252` y el error enseña una cabecera con NUL (`ÿþF\u0000e\u0000…`). | Vitest `parseo.test.ts`: `SCHEMA_UNRECOGNISED` con ese esquema. | Detectar BOM `FF FE`/`FE FF` y decodificar UTF-16 o rechazar con causa clara. | bajo |
| C-09 | Robustez | baja | `importer.ts:469,560`; `buildViews` (worker ≈560-1960, sin ningún `emit`); `main.ts:1034` | El progreso **no es monótono** (`parsing` 1,00 → `ordering` 0/1 → `done` 1,00) y «Importación terminada 100 %» se emite **antes** de guardar y analizar: la barra queda llena 13 s (sin circuito) o 24 s (con circuito) sin ninguna señal. | Node `rendimiento.test.ts` (23 avisos, monótono=false); Playwright `import-grande.spec.ts` (ver §4). | Etapas `saving`/`analysing` con unidades (WP-008) o barra indeterminada; nunca retroceder la barra. | bajo |
| C-10 | Rendimiento | media | `store.ts:214-216` (`readingsRow`), `importer.ts:383` | Cada lectura persistida serializa `provenance.sourceId` **y** `sourceHash` (los dos el mismo hash de 64 caracteres, constante para toda la fila de `sources`): 331 caracteres por lectura, **126,5 MiB** de JSON para 400k, 1,3 s de `stringify` + **4,7 s** de gzip (Node); el heap sube a 283 MiB y el RSS a 854 MiB. Es parte de los 24 s no cancelables de «Guardando». | `rendimiento.test.ts`; Playwright: `sourcesGzBytes` 5.480.503 por 400k. | Guardar sin los dos campos (reconstruir al leer, la clave ya los tiene) o por columnas (`ReadingColumns` + gzip). Lectura compatible con las filas antiguas. | medio |
| C-11 | Seguridad | baja | `src/persistence/agvproj.ts:160,176` | Una sección llamada `__proto__` sustituye el prototipo del objeto `sections` (`Object.keys` vacío, `sections.polluted === true`). No contamina `Object.prototype` ni rompe la cadena de hashes, pero es la forma clásica de pollution y los nombres de sección no se validan. | Vitest `agvproj.test.ts`. | `Object.create(null)` o `Map`, y validar `digest.name` con `/^[a-z0-9_-]+$/`. | trivial |
| C-12 | Robustez | baja | `zip.ts:183,203-207,51-76`; `agvproj.ts:135,140-147,161,169` | Varias corrupciones escapan como errores crudos en vez de `ProjectError`: offsets de directorio/cabecera local fuera del fichero (`RangeError` del `DataView`), JSON inválido en manifiesto o sección (`SyntaxError`), manifiesto `null` o `sections:null` con hash válido (`TypeError`), error de inflado (`TypeError` vacío). La UI los tapa con «no tiene la forma de un .agvproj». Además `schema_version:"6"` (texto) da «usa el esquema 6 y esta versión entiende el 6… hace falta una migración». | Vitest `agvproj.test.ts` (11 variantes); Playwright `agvproj-ui.spec.ts`. | Comprobar límites antes de cada `getUintXX`, envolver inflado y `JSON.parse` en `ZipError`/`ProjectError`, validar la forma del manifiesto (tipos de `schema_version`, `sections`, `name`, `hash`). | bajo |
| C-13 | Mejora | baja | `zip.ts:160-216`, `zip.ts:60` | `readZip` infla y comprueba el CRC de **todas** las entradas antes de que `readProject` lea el manifiesto (ADR-0012 regla 1: «leer el manifiesto antes que ninguna sección»): un esquema 99 con 30 MiB de relleno tarda 0,56 s en inflarse para luego decir «actualiza». Y `inflate` reserva `Uint8Array(expected)` por el tamaño **declarado** (hasta 256 MiB) antes de descomprimir. | Vitest `agvproj.test.ts`. | Leer directorio → inflar solo `manifest.json` → validar → inflar solo las secciones declaradas; reservar por bloques con tope. | bajo-medio |
| C-14 | Mejora | baja | `workers/import.worker.ts:3628`; `main.ts` (`handleMessage`, sin plazo) | Un `protocolVersion` distinto se descarta **en silencio** y la UI no tiene plazo para `accepted`: un Worker que no arranca (SW viejo) deja la interfaz ocupada; en listas/flota/conexiones/memoria «Cancelar» no termina nada (`importStoppable=false`) y hay que recargar. | Lectura de código + semántica probada en C-05. | Responder `error` con código de versión; plazo de `accepted` (p. ej. 5 s) que libere la UI con mensaje. | bajo |
| C-15 | Mejora | baja | `src/ingestion/importer.ts:190-213` | Cabecera con nombres repetidos (dos columnas «Tag») → gana la primera sin aviso (`findIndex`). | Vitest `parseo.test.ts`: `["Fecha","Tag","Tag","AGV"]` acepta sin `warnings`. | Avisar o rechazar cuando un alias casa con más de una columna. | trivial |

## 3. Detalle y salida real

### C-01 · una fila inválida tumba el fichero
`parseo2.test.ts` → 200 filas `24/01/2026 06:59:00;AGV-SYN-nnn;TAG-SYN-nnn` + `24/13/2026 06:00:00;…`:
```
{"ok":false,"code":"DATE_AMBIGUOUS","reason":"Hay fechas que solo encajan como día/mes y otras solo como mes/día: la fuente es incoherente.","recovery":"Corrige la fuente: ninguno de los dos órdenes explica todas sus fechas.", "samples":["24/01/2026 06:59:00","24/01/2026 06:58:01","24/01/2026 06:57:02"]}
```
Con `31/02/2026` en su lugar: `{"ok":true,"accepted":200,"codes":["DATE_INVALID"]}`. Causa: `time.ts:402-403` marcan `firstExceedsTwelve` y `secondExceedsTwelve` con la **misma** fila y `:408` lo declara contradictorio. La UI ofrece elegir el orden a mano (`main.ts:1136`), así que hay salida, pero el texto («corrige la fuente») manda a la persona a arreglar una exportación que está bien salvo una fila.

### C-02 · `STORAGE_FULL` tras acumular
`cuota.spec.ts`, cuota 4.002.616 bytes (el 75 % de lo que ocupa una importación de 100k):
```
mensajes: ["No se pudo importar (STORAGE_FULL)  No queda espacio en este dispositivo para guardar: lo de esta operación no se ha escrito. …"]
IDB: {"circuit":{"sources":1,"retained":1,"withSnapshot":0},"sourcesRows":1,"sourcesGzBytes":1370271,"archiveRows":1,"archiveGzBytes":586963,"snapshotRows":0}
```
Con cuota 4.803.139 (90 %) falló la **primera** transacción y el mensaje fue verdad (`circuit:null`, 0 filas). Nota: con cuotas muy pequeñas (2 % y 50 %) Chromium dejó escribir 7-9 MB —su contabilidad es perezosa en una base recién creada—; no es defecto de la aplicación, pero explica por qué `STORAGE_FULL` llega cuando la base ya tiene algo.

### C-03 · dos pestañas, mismo circuito
`carrera.spec.ts`: ficheros `syn-400k.csv` (`7b1cf86a…`) y `syn-400k-b.csv` (`812944b5…`) a `SYN-RACE` desde dos páginas del mismo contexto:
```
circuitSources: ["syn-400k-b.csv:812944b5 retained=true snap=true"]
sourcesKeys: ["7b1cf86a","812944b5"]  snapshotKeys: ["7b1cf86a","812944b5"]  archiveKeys: ["7b1cf86a","812944b5"]
```
El registro del circuito solo conoce B; las 5,5 MB de lecturas de A y su instantánea quedan sin dueño (no se retiran nunca por retención, no cuentan en «espacio usado» del circuito). La ventana entre lectura y escritura es larga porque `saveAccumulation` comprime el JSON (1-4 s) antes de abrir la transacción; la regla «un trabajo a la vez» solo vive dentro de cada pestaña.

### C-04 · 541 MB
`limite-bytes.spec.ts`:
```
### 513 MiB: mensaje a los 41727 ms · RSS renderer antes 458 MiB, pico 1192 MiB
mensajes=["No se pudo importar (LIMIT_EXCEEDED)  El fichero ocupa 541060845 bytes y el límite es 536870912. …"]
progreso: 0ms «» 0 | 804ms «Preparando» 0 | 980ms «Empezando» 0 | 993ms «Leyendo el fichero» 0
```
Orden real en `runImport`: `arrayBuffer()` (1978) → `hashFile` (1997; 3,6 s en Node para 520 MiB) → `decodeSource` (2020) → `importReadings` y solo ahí `importer.ts:239`.

### C-05 · rechazo de promesa en el Worker
`rechazo-promesa.spec.ts` (Worker `blob:` en `about:blank`):
```
### rechazo asíncrono → nada en 1500 ms (la página no se entera)
### excepción síncrona → onerror: Uncaught RangeError: Invalid string length
```
`decode-limit.mjs 520` en Node: `hashFile(520 MiB): 3653 ms` y `decodeSource LANZA: Error: Cannot create a string longer than 0x1fffffe8 characters` — justo la línea 2020, fuera del `try`. En Chromium x64 ese decodificado sí cabe (lo demuestra C-04), así que hoy el camino está latente; el hueco estructural (ningún `onunhandledrejection`, `void runX()`) es independiente de la plataforma.

### C-06 · coma decimal
```
### 50 filas `;` con decimal 1,5
{"ok":false,"code":"DELIMITER_AMBIGUOUS","reason":"Dos separadores explican el fichero casi igual de bien («;» 1.00 frente a «,» 0.98): elegir uno sería adivinar.","recovery":"… Fijarlo a mano todavía no es posible.","samples":["Fecha;AGV;Tag;Duracion","24/01/2026 06:59:00;AGV-SYN-000;TAG-SYN-000;1,5", …]}
### 8 filas `;` con decimal
{"ok":true,"accepted":8,"delimiter":";","conf":1}
```

### C-07 / C-08 · codificación
```
### utf-8 + 1 byte inválido al final
{"encoding":"windows-1252","header":"Fecha;VehÃ­culo;Tag","result":{"ok":false,"code":"SCHEMA_UNRECOGNISED","reason":"No se reconocieron las columnas obligatorias: AGV.", "schema":["Fecha","VehÃ­culo","Tag"]}}
### utf-16le
{"encoding":"windows-1252","result":{"ok":false,"code":"SCHEMA_UNRECOGNISED", "schema":["ÿþF\u0000e\u0000c\u0000h\u0000a\u0000","\u0000A\u0000G\u0000V\u0000","\u0000T\u0000a\u0000g\u0000"]}}
```
Un Windows-1252 genuino (`í`=0xED) se lee bien: `encoding windows-1252, accepted 3`.

### C-09 · progreso
Node, 400k: `sampling:0/1=0 → parsing:19999/400000=0.05 → … → parsing:399999/400000=1 → ordering:0/1=0 → done:400000/400000=1`.
Navegador, con circuito: «Importación terminada — 400.000 de 400.000» a los 6.934 ms, «Guardando en este dispositivo; ya no se puede cancelar» a los 6.945 ms y **nada más hasta los 31.123 ms**. Sin circuito: terminada a 6.222 ms, interfaz libre a 19.460 ms.

### C-10 · serialización de lecturas
```
JSON.stringify(readings): 126.5 MiB en 1283 ms · una lectura = 331 chars:
{"time":{"utcMs":1768881600000,"raw":"20/01/2026 05:00:00","zone":"Europe/Madrid","flag":"ok"},"agvId":"AGV-SYN-004","tagId":"TAG-SYN-080","provenance":{"sourceId":"7b1cf86a…fdd0","sourceHash":"7b1cf86a…fdd0","sourceRow":400001}}
gzipJson: 5.2 MiB en 4708 ms (30 % del CSV) · memoria tras empaquetar+serializar: {"heap":283,"rss":854,"ext":322}
```
Los dos hashes son 128 de los 331 caracteres (39 %), y `zone` se repite también.

### C-11 / C-12 / C-13 · contenedor
```
### sección «__proto__»  → ACEPTADO · Object.keys(sections)=[] · sections.polluted=true · ({}).polluted=undefined
### offset de cabecera local fuera del fichero → OTRO(RangeError): Offset is outside the bounds of the DataView
### sección con JSON inválido → OTRO(SyntaxError): Expected property name or '}' in JSON at position 1
### manifiesto `null` → OTRO(TypeError): Cannot read properties of null (reading 'schema_version')
### manifiesto con sections:null (hash válido) → OTRO(TypeError): manifest.sections is not iterable
### bit cambiado en manifest.json (payload deflate) → OTRO(TypeError): <vacío>
### schema_version "6" → ProjectError: El proyecto usa el esquema 6 y esta versión entiende el 6. | Hace falta una migración explícita…
### esquema 99 con una sección de 30 MiB no declarada → readZip infló 2 entradas (31457424 bytes) en 558 ms antes de leer el manifiesto
### una entrada declara 256 MiB (justo el límite) y trae 100 bytes → ProjectError … declara 268435456 bytes y descomprime 100 (52 ms; reserva previa de 256 MiB)
```
En la UI (`agvproj-ui.spec.ts`) todos los errores crudos acaban en «El fichero no tiene la forma de un `.agvproj`» sin filtrar el texto del error (bien para TH-003), y la consola queda vacía.

### Verificado y correcto (reproducido, sin hallazgo)
- Truncados en 5 puntos, 600 entradas, bomba (20 MiB → 100 B declarados), método 99, > 256 MiB declarados, esquema 7/0/6.5: `ProjectError` con causa y «no se ha cargado nada». Esquema 5 abre sin `incidencias`. Dos `manifest.json`: gana el primero y falla su hash.
- `sampleRows` llevan celdas (por contrato) y `reason` nunca (4 códigos probados con marcador `MARCA-SYN-9f3a`); `rawExcerpt` de cuarentena es la fila (≤120 chars). La UI los pinta con `textContent`.
- Cancelar a los 300 ms (etapa «Detectando estructura»): confirmado en 985 ms desde el clic (plazo 500 ms + sondeo de la prueba), IDB sin circuito. Tras `saving`, botón oculto y la importación termina entera.
- Determinismo: 100k filas dos veces → JSON idéntico (salvo `elapsedMs`); el mismo contenido con LF en vez de CRLF → mismo resultado, **otro hash** (`4e2f3bdf…` vs `7497e24c…`), que es lo esperado al hashear bytes.

## 4. Medidas con el fichero sintético grande

Fichero: 400.000 filas, 40 AGV, 120 tags, CRLF, 17,2 MiB (`data/syn-400k.csv`, generado con semilla por `gen-large.mjs`).

| Medida | Node 22 (Vitest) | Chromium 1194 (preview de `dist`) |
|---|---:|---:|
| SHA-256 del fichero | 202 ms (estable entre dos lecturas) | — (dentro de los 480-730 ms hasta «Detectando estructura») |
| `decodeSource` | 14 ms | — |
| `importReadings` | 7.209 ms | ≈ 5,6 s (de «Detectando estructura» a «Importación terminada») |
| Heap tras parsear | 147 MiB (desde 9); RSS 313 MiB | hilo principal 27 MiB (el Worker no se ve) |
| `packReadings` | 82 ms, 24,0 MiB en 6 `ArrayBuffer` transferidos | — |
| `JSON.stringify` + `gzip` para guardar | 1.283 ms + 4.708 ms → 5,2 MiB | `sourcesGzBytes` 5.480.503 |
| Heap/RSS tras empaquetar + serializar | 283 / 854 MiB | — |
| `unionReadings` 400k × 400k | 1.883 ms | — |
| Total importación sin circuito | — | **19,5 s** (6,2 s parseo + 13,2 s análisis sin progreso) |
| Total importación con circuito | — | **31,1 s** (6,9 s hasta `saving` + 24,2 s guardar + analizar) |
| Lo que queda en IDB (400k) | — | lecturas 5,48 MB gz · archivo original 2,35 MB gz · instantánea 54 KB · `usage` 8,45 MB |
| 541 MB (> límite) | hash 3,65 s; decodificación lanza | rechazo a los 41,7 s; RSS del renderer 458 → **1.192 MiB** |
| Cancelar a los 300 ms | — | 985 ms hasta el mensaje; nada escrito |
| Carrera de dos pestañas (2 × 400k) | — | 94,7 s en total; estado incoherente (C-03) |
| Consola de la página durante todo lo anterior | — | **0 mensajes** |

Condiciones: contenedor de 4 núcleos sin aceleración gráfica; no es el PC ni el móvil de referencia. Los tiempos de Node incluyen la sobrecarga de Vitest.

## 5. Qué está bien hecho

- Un solo parseo, siempre en el Worker; la página no puede importar `ingestion/` (y la prueba de capas lo vigila). El `File` viaja como asa y las lecturas vuelven por columnas con buffers transferidos (WP-006 cumplido de verdad: 6 `ArrayBuffer`, 24 MiB, sin copia).
- Mensajes caducados filtrados por `jobId` + `protocolVersion`; un Worker por trabajo (`terminate` al empezar otro), así que no hay respuestas tardías posibles; `cancel` solo afecta al trabajo vigente.
- Cancelar no deja nada escrito (comprobado); el aviso `saving` marca honestamente el punto sin retorno.
- IndexedDB: ninguna transacción espera nada ajeno (se comprime **antes** de abrirla); `saveAccumulation`, `saveMemory`, `appendPlanEvents`, `appendCaseRevisions` y `deleteCircuit` (11 tablas) son atómicas; `saveMemory` tiene guardia contra escrituras concurrentes; escalera de migraciones con comprobación en arranque; claves `[circuitId, …]` con rangos, sin escaneos completos; `QuotaExceededError` convertido a `StorageFullError` con texto propio.
- `.agvproj`: zip propio con límites de entradas y de tamaño descomprimido **aplicados mientras se infla** (la bomba se corta), CRC por entrada, manifiesto autoavalado, hash por sección, esquema futuro rechazado sin tocar nada, esquemas 1-5 legibles; cadenas de hashes de expedientes (`verifyChain`) y huella de recortes (`evidenceHash`) comprobadas al abrir; linajes nunca fusionados.
- Codificación declarada (nunca UTF-8 tolerante), BOM y comillas envolventes, CRLF/LF/CR mezclados, líneas vacías contadas aparte, cabeceras con espacios/mayúsculas/acentos, ceros iniciales, filas con menos/más columnas a cuarentena con motivo; `reason` sin celdas; nada en consola; `innerHTML` solo como lectura de nodos construidos con texto.
- Hash de fichero SHA-256 sobre los bytes, calculado una vez por importación; se recalcula solo para verificar la copia archivada antes de reanalizar (justificado).

## 6. Lo que no pude comprobar

- La migración 5→6 sobre una base real de la versión 5 (solo por lectura; la partición está probada en `retention.test.ts`).
- La memoria del Worker en el navegador: solo el RSS del proceso de renderizado desde fuera (`ps`).
- El rescate por rechazo de promesa con un disparador real en Chromium x64 (C-05): la semántica está probada, el único disparador concreto que encontré es el de Node.
- La segunda carga del mismo fichero (ruta `twin`): mi prueba no disparó `change` al repetir el mismo `File`, así que no tengo medida del caso repetido.
- Dispositivo móvil, `onblocked` de IndexedDB con otra pestaña bloqueando, y el comportamiento con el árbol de trabajo modificado por el otro proceso (no lo he revisado).
