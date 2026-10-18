---
document_id: TT-REV-001-E
version: 0.1.0
status: informative
last_updated: 2026-10-18
---

# Anexo E — Documentación

> Informe de uno de los cinco frentes de la revisión general del 2026-10-18 ([`REVISION_2026-10-18.md`](../../REVISION_2026-10-18.md)),
> tal como lo entregó el revisor, sobre el commit `d5ecfee` (3.88.4). Las líneas citadas son las de ese commit;
> las correcciones aplicadas después (3.89.0) las resume el informe principal. Las rutas `<entorno de revisión>`
> eran ficheros temporales (scripts de reproducción, capturas) que no se conservan en el repositorio.
> No se ha editado el contenido.


Fecha: 2026-10-18. Alcance: `docs/*.md` (31), `docs/decisions` (18 ADR), `docs/templates` (7), `docs/golden` (7), `docs/checkpoints` (1), `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`. Total medido: 13.107 líneas, ~126.000 palabras. Métricas con `review/E/analyze.py` (solo lectura). `git status` limpio al terminar.

## 1. Diagnóstico

1. La documentación es completa, trazable y honesta: no hay afirmaciones de «hecho» sin versión, prueba o fecha. Ese es su valor y no se toca.
2. Pero ya no es legible para una persona: los cuatro documentos más consultados suman 70.000 palabras (TEST_STRATEGY 21.351, RULE_CATALOG 17.552, UX_SPEC 16.493, ALGORITHM_CATALOG 15.426), y «decisiones compactas» (PROJECT_MEMORY) tiene 802 líneas y 9.682 palabras.
3. El mismo hecho se cuenta en 6–9 sitios: la subida de Vitest (3.88.4) está en 8 ficheros; OQ-176 en 9; OQ-B05 en 9; el estado de fase en 7. Nadie es dueño de nada.
4. Hay desactualizaciones en los documentos de arranque: PROJECT_MEMORY dice «F3 en curso» (estamos en F6); ARCHITECTURE describe un «stack candidato» y una «estructura futura» que no coinciden con `src/`; PHASE_GATES tiene G0 y G3 con todas las casillas vacías pese a estar cerradas.
5. Dos tablas rotas esconden contenido normativo: 12 reglas de RULE_CATALOG (R-GRA-011…021) y 5 preguntas cerradas de OPEN_QUESTIONS se renderizan como texto corrido.
6. `check_docs.py` comprueba frontmatter, IDs de documento, enlaces a ficheros y el JSON de estado; no comprueba anclas, tablas, orden de secciones, ni la coherencia entre documentos (ADR-0009 «Proposed» en DECISIONS.md y `accepted` en su frontmatter).
7. OPEN_QUESTIONS: de 49 abiertas, 3 están declaradas cerradas en otros documentos, 1 está duplicada literalmente, 4–5 están respondidas de hecho, 8 son la misma pregunta con otro ID y 5 son relatos de un análisis de planta, no preguntas de diseño.
8. CHANGELOG (4.636 líneas, 130 entradas) mezcla crónica, gobierno y producto; sube versión sin cambio de código y no permite a un usuario saber qué cambió para él.
9. El estilo literario ayuda en los enunciados de regla y en los manuales (MANUAL, GUIA, OPERACION son los mejor escritos); estorba cuando un aforismo sustituye a la justificación o cuando un documento de estado se escribe como relato.
10. Falta una página de visión general en lenguaje llano y una ruta de lectura por lector. Con eso, un histórico separado y las correcciones de forma, la misma información cabe en una tercera parte del tiempo de lectura sin borrar un solo ID.

## 2. Tabla de hallazgos

Gravedad: alta = engaña o bloquea a quien lee; media = cuesta tiempo o siembra duda; baja = pulido. Esfuerzo: S < 1 h, M = media jornada, L = más de un día.

| ID | Tipo | Grav. | Dónde | Qué | Propuesta | Esf. |
|---|---|---|---|---|---|---|
| E-01 | Redundancia | alta | PROJECT_MEMORY, CHANGELOG, PHASE_GATES, ROADMAP §F6, CLAUDE.md §Estado, README, project_state.json | El estado de fase y cada entrega se repiten en 7 sitios (18 «CONTINÚA FASE» en PROJECT_MEMORY, 11 en CHANGELOG; 89 menciones de versiones 3.x en PROJECT_MEMORY, 38 en PHASE_GATES, 10 en ROADMAP) | Un dueño por tipo: `project_state.json` (estado), CHANGELOG (qué cambió por versión), PHASE_GATES (evidencia por puerta), ROADMAP (alcance, sin «Hecha en 3.xx»), PROJECT_MEMORY (decisiones, con enlace). Los demás enlazan | M |
| E-02 | Redundancia | alta | PROJECT_MEMORY.md:441-523 y 544-629 | Las secciones «F6, entrega N» y «Expedientes, entrega N» repiten las entradas [3.74.0]–[3.88.4] del CHANGELOG; ~390 de 802 líneas son resumen de changelog | Mover a `docs/history/DECISION_LOG.md`; en PROJECT_MEMORY una línea por entrega con enlace al CHANGELOG | M |
| E-03 | Redundancia | media | ROADMAP.md:210-235, PHASE_GATES.md:208-245, PROJECT_MEMORY.md:525-531 | Las ocho entregas de F6 con su versión se listan tres veces | ROADMAP: alcance; PHASE_GATES: evidencia; PROJECT_MEMORY: enlace | S |
| E-04 | Redundancia | media | OPEN_QUESTIONS.md:91-134 | «Preguntas cerradas» copia la respuesta íntegra que ya vive en el documento destino (OQ-151: 9 líneas que están en CONFIG_SCHEMA §3.5; OQ-B05 repite literal PHASE_GATES:210) | Cierre = ID, fecha, una frase, documento dueño | S |
| E-05 | Redundancia | media | REQUIREMENTS.md (0.2.0, 2026-09-16) vs RULE_CATALOG.md (0.62.0) | Solapes FR-005↔R-DAT-002, FR-006↔R-DAT-001, CON-004/FR-016↔R-CO-004, NFR-005↔R-EVI-004, CON-006↔ADR-0005. Desde F3 lo nuevo (listas, plano, valores de planta, DS-013/WiFi, áreas, banco de medida) solo existe como regla R-*, nunca como FR-* | REQUIREMENTS = «qué» en una frase + enlace a reglas; añadir los FR que faltan o declararlo congelado en F0 | M |
| E-06 | Redundancia | baja | UX_SPEC.md:33-41 vs MANUAL_DE_USO.md:46-55 | Tabla de pestañas dos veces (coherentes entre sí y con `main.ts:471-480`, 8 pestañas) | MANUAL dueño del «para qué»; UX_SPEC conserva el «cómo está construido» y enlaza | S |
| E-07 | Redundancia | baja | AGENTS.md, CLAUDE.md, README.md §Límites, AI_DEVELOPMENT_GOVERNANCE §4, CONTRIBUTING §Datos | Los límites innegociables con 5 redacciones distintas | AGENTS.md dueño; el resto, un enlace | S |
| E-08 | Desactualizado | alta | PROJECT_MEMORY.md:15 | «Estado: **F3 en curso** desde el 2026-09-20» en el segundo documento de arranque obligatorio | Sustituir «Estado» por una línea que remita a `project_state.json` | S |
| E-09 | Desactualizado | alta | ARCHITECTURE.md §2, §7, §8, líneas 12, 78, 126, 140 | §2 lista contextos `topology`, `analysis`, `incidents`, `consolidation` que no existen en `src/`; §7 «Stack candidato» con UI «React… Open» y Vitest/Playwright/IndexedDB «Proposed» (todo implementado, ADR-0009 accepted); §8 «Estructura futura» con `tests/property|golden|integration|performance` inexistentes y sin `tests/audit`, `tests/support`; «será», «se definirá», «la estructura se crea en F1», «la futura aplicación» | Reescribir §2 y §8 con el árbol real; §7 pasa a «Stack» con estado «en uso»; presente de indicativo | M |
| E-10 | Desactualizado | alta | PHASE_GATES.md:23-33, 48-51, 101-128 | G0: 9 casillas vacías con checkpoint `approved` (2026-09-17). G1: «la afinidad de ALG-003 no está implementada» pero PROJECT_MEMORY:20 la da cerrada el 2026-09-18 y existe `src/domain/affinity.ts`. G3: sin cabecera de cierre y 7 casillas vacías aunque F4 se abrió el 2026-09-26 (PROJECT_MEMORY:317) | Cabecera uniforme por puerta: «Cerrada el <fecha> por «<frase>»; criterios sin cumplir: … (arrastrados a Gn)»; marcar G0; actualizar G1 afinidad | S |
| E-11 | Desactualizado | media | CONTEXT_INDEX.md:40 y 11-14 | «Todos los documentos `0.1.0` constituyen una candidata de línea base»: solo 6 de 31 siguen en 0.1.0 y `project_state.baseline` es `approved`. Orden de lectura distinto al de CLAUDE.md:9-13 | Borrar la frase o decir qué significa `baseline-candidate` hoy; un solo orden de arranque | S |
| E-12 | Desactualizado | media | DOMAIN_MODEL.md (0.3.0, 2026-09-11) | Agregados `CircuitProject`, `SourceBatch`, `CircuitGraphVersion`, `ExpectedProfileVersion`, `Finding`, `Consolidation`, `IncidentCase`: 0 apariciones en `src/`. Los reales son `CircuitSnapshot`, `ConsolidatedVersion`, `LineageState`, `CaseWindow`, `FrozenEvidence`… No menciona instantánea (ADR-0015), plano (ADR-0016), registro de conexiones (ADR-0017) ni listas de tags | Tabla «concepto → tipo en `src/domain`»; añadir los tres agregados de F4–F5 | M |
| E-13 | Desactualizado | media | DECISIONS.md:20 vs decisions/ADR-0009:3 | Índice: «Proposed»; ADR: `status: accepted`, 2026-09-16 | Corregir el índice; añadir a `check_docs.py` la comparación | S |
| E-14 | Desactualizado | media | RISK_REGISTER.md (0.2.0, 2026-09-03) | «deben revisarse en cada puerta»: cinco puertas sin revisión; §«Riesgos que bloquean F1»; RSK-010 mitigado en 3.82.0, RSK-006 con banco de medida, RSK-021 con guardián operativo: nada reflejado | Columna «Estado al cierre de G5» y una línea por riesgo | S |
| E-15 | Desactualizado | media | DEFINITION_OF_DONE.md:16; TEST_STRATEGY.md:16-28 | Exigen «análisis estático» y «propiedades», e «Integración»: no hay linter (`package.json` sin eslint/biome), ni `fast-check`, ni `tests/property`, ni `tests/integration` | Decir lo que hay (tipos, unitarias, auditoría, E2E) o abrir una OQ para decidir si se añaden | S |
| E-16 | Desactualizado | media | UX_SPEC.md:80-82 | «Áreas previstas que todavía no existen…: casos similares, hipótesis y contramedidas de los expedientes»: hechas en 3.78.0 y 3.80.0 (PHASE_GATES G5) | Borrar las hechas | S |
| E-17 | Desactualizado | baja | AGENTS.md:8; CHANGELOG.md:3; TRACEABILITY_MATRIX.md:10; LEGACY_ASSESSMENT.md:48; package.json `version` | «No iniciar Fase 1 hasta…»; «seguirán versionado semántico cuando exista software ejecutable»; «La matriz se ampliará… cuando exista código. En F0 demuestra…»; «debe transformarse en TC-020» (existe `golden/TC-020`); `package.json` 0.1.0 frente a 3.88.4 | Una pasada de tiempo verbal; marcar LEGACY como histórico | S |
| E-18 | Desactualizado | baja | OPEN_QUESTIONS.md:12, 26-30, 32 | Cabeceras «Bloqueantes para cerrar G0», «Movidas a puertas posteriores → G2», «Necesarias durante F1–F3» con G0–G5 cerradas | Reagrupar por quién responde (propietario / planta / fabricante / F7) | S |
| E-19 | Forma | alta | RULE_CATALOG.md:66 | Una línea en blanco entre R-GRA-010 y R-GRA-011 parte la tabla: R-GRA-011 a R-GRA-021 (12 reglas) se renderizan como texto, sin cabecera ni separador | Quitar la línea 66 | S |
| E-20 | Forma | alta | OPEN_QUESTIONS.md:91-97 y 22-25 | «Preguntas cerradas»: cabecera en 91 sin `\|---\|`; el separador está en 97, así que OQ-176, OQ-B05, OQ-173, OQ-174, OQ-175 quedan fuera de la tabla. Cuatro líneas vacías seguidas en 22-25 | Mover el separador a la línea 92 | S |
| E-21 | Forma | media | WORKER_PROTOCOL.md:113-115; decisions/ADR-0018:117-119 | Filas `versions-compared`, `plant-values-updated`, `cases-updated` pegadas tras un párrafo, sin cabecera; dos transiciones de estado separadas de su tabla por una línea en blanco | Reunir las filas con su tabla | S |
| E-22 | Forma | media | ALGORITHM_CATALOG.md:993-1136; UX_SPEC.md:126-827 | §6.18–§6.23 vienen después de §10 «Mejoras posteriores». Subsecciones «4.1», «5.3», «6.11» como `##` (H2) y «5.2.1», «6.1» como `###`: tres niveles para dos jerarquías | Renumerar y anidar; o numerar solo H2 | M |
| E-23 | Forma | media | 8 ficheros (UX_SPEC 8, CHANGELOG 12, TEST_STRATEGY 5, ALGORITHM_CATALOG 4, TRACEABILITY 4, RULE_CATALOG 3…) | 38 referencias a «Parte 35», «Parte 38», «Parte 47»: numeración de una conversación, opaca en el repositorio | Sustituir por versión o fecha (ya figuran al lado en la mayoría) | S |
| E-24 | Forma | media | RULE_CATALOG (59 celdas > 600 car.; R-GRA-007: 5.056 car.), OPEN_QUESTIONS (12; OQ-129: 1.604), UX_SPEC (5; una de 1.682), GLOSSARY (1: 862) | Celdas de tabla con 5–12 párrafos dentro. Frases > 40 palabras: CHANGELOG 369, RULE_CATALOG 169, UX_SPEC 121, ALGORITHM_CATALOG 108, OPEN_QUESTIONS 75, PROJECT_MEMORY 68 | Tabla = ID, estado, enunciado de una frase. El desarrollo («Ampliación…», «revisión de la lógica, 2026-09-26», «Tal como quedó implementado») debajo, en una subsección con el mismo ID. La trazabilidad queda intacta | L |
| E-25 | Forma | media | PROJECT_MEMORY.md (15 párrafos > 900 car.; máx. 2.272), ALGORITHM_CATALOG (4), WORKER_PROTOCOL (1 de 1.444), CHANGELOG (7) | Párrafos de 15–25 líneas sin punto y aparte; §«Funciones críticas…» (251-315) y §«Lista del circuito…» (227-238) son listas de decisiones escritas como prosa | Una decisión, un punto de lista, con su regla al final | M |
| E-26 | Forma | baja | Todo el repositorio | 228 referencias «`DOC.md` §N» textuales (99 en CHANGELOG): no son enlaces y `check_docs` no las verifica; al renumerar (E-22) quedan huérfanas. Raya «—»: 325 CHANGELOG, 137 RULE_CATALOG, 94 UX_SPEC, con reglas de 3–4 incisos en una frase. Comillas: «» mayoritarias pero 28 `"` en CHANGELOG, 20 en UX_SPEC, 12 en TEST_STRATEGY. Negritas: 312 pares en 205 líneas de RULE_CATALOG, usadas para abrir párrafo, no para destacar | Convención de una línea en CONTRIBUTING; convertir «§N» en enlaces con ancla y hacer que `check_docs` las compruebe | M |
| E-27 | Forma | baja | scripts/check_docs.py | Comprueba: 4 claves de frontmatter, formato de versión y fecha, `document_id` único, enlaces a ficheros existentes (ignora `#ancla`), `project_state.json` contra esquema e invariantes de F0. No comprueba: anclas, «§N», tablas bien formadas, encabezados duplicados u ordenados, estado de ADR en DECISIONS.md vs frontmatter, que una OQ dicha «cerrada» esté en la sección cerrada, unicidad de IDs R-/FR-/OQ-/TC-, `documentationVersion` frente a los documentos | Añadir las cuatro primeras (son 40 líneas de Python) | M |
| E-28 | Legibilidad | alta | PROJECT_MEMORY.md (802 líneas) | Ya no es «compacta». Orden mixto: 98-411 cronológico (septiembre); 413 salta al 7 de octubre; 427-753 inverso (18 oct → 7 oct); el «relevo a un chat nuevo» (755-802) está al final de 800 líneas | Partir en PROJECT_MEMORY (≤ 150 líneas: identidad, decisiones firmes, modelo industrial, estados de verdad, relevo) y `docs/history/DECISION_LOG.md` (todo lo fechado, en orden, con enlaces al CHANGELOG). No se borra nada | M |
| E-29 | Legibilidad | alta | README.md:1-3, 25-62 | Primera frase: «Sistema local y explicable de diagnóstico longitudinal y gemelo digital de circuitos AGV…». Lista 31 documentos en 5 grupos sin decir cuál leer primero según quién eres. No hay visión general en lenguaje llano | Nueva `docs/VISION_GENERAL.md` (borrador en §6) y README con tres rutas: «uso la aplicación», «decido», «desarrollo» | S |
| E-30 | Legibilidad | media | CONTEXT_INDEX.md:11-37 | Ruta obligatoria para una persona nueva: PROJECT_MEMORY (802) + REQUIREMENTS (101) + el documento de la tarea; para «Salud/diagnóstico» eso es RULE_CATALOG (17.552 palabras) + ALGORITHM_CATALOG (15.426) + TEST_STRATEGY (21.351): ~54.000 palabras antes de tocar nada | Ruta por lector (§4) y rutas por tarea que señalen la sección, no el documento | S |
| E-31 | Legibilidad | media | PHASE_GATES §G6, OPEN_QUESTIONS, PROJECT_MEMORY §Relevo, templates/PILOT_ACCEPTANCE | Las decisiones que esperan al propietario están en cuatro sitios (casillas de G6; filas «Pendiente del propietario» OQ-163/164/165/166/167/168/172/B01/B02/B04; relevo; plantilla) | Sección «Decisiones que te esperan» en VISION_GENERAL o en PHASE_GATES §G6, con enlaces | S |
| E-32 | Legibilidad | media | AGENTS.md §Antes de cambiar 4; CONTRIBUTING.md §Flujo 1; AI_DEVELOPMENT_GOVERNANCE §2 | Exigen un `FEATURE_CONTRACT` por tarea; no hay ninguno en el repositorio (solo lo cita AI_DEVELOPMENT_GOVERNANCE). El contrato real es la petición del propietario + la sección de PROJECT_MEMORY + la entrada del CHANGELOG | Documentar el proceso que se practica, o guardar los contratos | S |
| E-33 | Estilo | media | 14 frases-lema en docs (p. ej. RULE_CATALOG:135 «Dónde, no por qué (R-EVI-006)»; PHASE_GATES:46; README:92; AGENTS:39; PROJECT_MEMORY:758) | El aforismo sustituye a la justificación o alarga un documento de estado | Diez reescrituras en §5; regla: el lema puede ser título, no argumento | S |
| E-34 | Estilo | baja | RULE_CATALOG R-GRA-007 (6 citas del propietario), R-FLO-010 («creo que entran 8 AGV como pulmón, pero seguro…»), R-GRA-017, R-GRA-018, R-GRA-022 | La regla incluye la cita literal: útil como evidencia, pero convierte la norma en acta | Cita → DECISION_LOG con fecha; la regla conserva «(propietario, fecha)» | M |
| E-35 | Pregunta ya respondida | alta | OPEN_QUESTIONS.md:78-80 | OQ-160, OQ-161, OQ-162 en sección abierta; ADR-0017:88 y CHANGELOG:796 dicen «cerradas con la recomendación» | Mover a cerradas | S |
| E-36 | Pregunta ya respondida | alta | OPEN_QUESTIONS.md:75 y 133 | OQ-P05 aparece abierta («¿Qué framework UI…?», F1) y cerrada («Ninguno para F1a», 2026-09-16) | Borrar la fila abierta | S |
| E-37 | Pregunta ya respondida | media | OPEN_QUESTIONS.md:41 (OQ-106) | «¿Cómo se identifica carga/vacío?»: lista `zona` con `grupo` cargado/vacio (CONFIG_SCHEMA:227) y conversión LLENO→cargado, VACIO/SIN CARRO→vacio (PROJECT_MEMORY:313-315). 0 menciones fuera de OPEN_QUESTIONS | Cerrar con fecha 2026-09-25 | S |
| E-38 | Pregunta ya respondida | media | OPEN_QUESTIONS.md:63 (OQ-130) | «Abierta, espera F4»: F4 cerrada; la instantánea guarda la horquilla por tramo y régimen (`snapshot.ts:91`) y se comparan versiones (3.56.0, PHASE_GATES G4) | Cerrar remitiendo a MEMORY_CONSOLIDATION | S |
| E-39 | Pregunta ya respondida | media | OPEN_QUESTIONS.md:73-76 | OQ-P06 = OQ-146 + OQ-147 (cerradas: sostenido 3 ficheros, colectivo > mitad). OQ-P04 (librería de grafo, F2/F6) decidida de hecho: canvas propio (`charts.ts`), F2 pasó. OQ-P01 (cifrado `.agvproj`, F4): F4 cerrada sin tocarla | P06 cerrar; P04 cerrar «sin librería»; P01 decidir o mover a F7 | S |
| E-40 | Pregunta ya respondida | media | OPEN_QUESTIONS.md | Misma pregunta con dos IDs: OQ-110 ≈ OQ-120 (memoria real de cada vehículo); OQ-107 ≈ OQ-125 (excepciones legítimas a inversiones de orden); OQ-126 ⊂ OQ-129 y OQ-108 ⊂ OQ-129 (umbrales y turnos provisionales); OQ-111, OQ-113, OQ-163, OQ-165, OQ-167 = «qué significa cada evento de uso del informe ampliado»; OQ-131 ~ OQ-159 (hora del fichero) | Fundir conservando los IDs como alias («ver OQ-129») | S |
| E-41 | Pregunta ya respondida | media | OPEN_QUESTIONS.md:40, 47, 38, 66 | Parcialmente respondidas sin reflejarlo: OQ-105 (señal WiFi): desde ADR-0017 el registro DS-013 es evidencia directa; «sigue abierta» es de 3.64.0, anterior. OQ-112 (rango MTC): OQ-132 ya fija «normal, 1… 15». OQ-103: listas `mantenimiento`/`emergencia` los marcan `especial`. OQ-114: el estimador de OQ-151 deduce las franjas de las paradas repetidas | Marcar «Parcial» con lo que ya hay | S |
| E-42 | Pregunta ya respondida | baja | OPEN_QUESTIONS.md:50-53, 65, 39, 62 | OQ-117, 118, 119, 121, 134 son relatos de un análisis concreto que esperan otra exportación: observaciones de planta, no decisiones de diseño. OQ-104: 0 menciones fuera desde F0, sin plan. OQ-129 cita «el viernes 2026-09-25 y la verificación en campo del lunes»: fecha pasada sin cierre | Anexo «Observaciones de planta pendientes de datos»; a OQ-104 ponerle dueño o cerrarla «no aplica» | S |
| E-43 | Legibilidad | media | CHANGELOG.md | 4.636 líneas, 46.957 palabras, 130 entradas; 21 versiones en un día (2026-10-17 y 2026-09-26); 1.9.0→2.0.0→3.0.0 el mismo 2026-09-17. 35 secciones de gobierno frente a 199 de producto; versiones sin código (3.88.3:25, 223, 239, 859); 23 encabezados distintos («Medido, y por eso se hace así», «Pendiente, y dicho para que no parezca terminado»); 369 frases > 40 palabras; 99 «§» | Primera línea por versión «Para quien usa la aplicación: …»; cuatro encabezados fijos; lo de gobierno sin código va a DECISION_LOG con fecha, no a una versión | M |

## 3. Detalle con citas

### 3.1 Redundancia (E-01 a E-07)

Medición por parejas (grep de IDs, versiones y nombres de entrega):

| Pareja | Qué se repite | Cuánto |
|---|---|---|
| PROJECT_MEMORY ↔ CHANGELOG | Cada entrega de F5 y F6 tiene sección en PROJECT_MEMORY (441-523, 544-629) y entrada en CHANGELOG | 49 versiones distintas citadas en PROJECT_MEMORY; las 49 tienen entrada en CHANGELOG. Ejemplo: «F6, entrega 7» (PROJECT_MEMORY:449-457) y `[3.88.0]` (CHANGELOG:49-67) cuentan lo mismo con otras palabras |
| ROADMAP §F6 ↔ PHASE_GATES §G6 ↔ PROJECT_MEMORY | Las ocho entregas con su versión | 3 listas (ROADMAP:210-235, PHASE_GATES:212-244, PROJECT_MEMORY:525-531) |
| PHASE_GATES ↔ PROJECT_MEMORY | Cierre de cada puerta con frase, PR y commit | «PR #12 … `551d4cd`» y «PR #17 … `b0f527a`»: PROJECT_MEMORY 5, PHASE_GATES 3, CHANGELOG 5 |
| OPEN_QUESTIONS cerradas ↔ documento destino | La respuesta íntegra | OQ-B05: el criterio de rechazo (a)–(e) está literal en PHASE_GATES:210 y OPEN_QUESTIONS:93. OQ-151: nueve estimadores en OPEN_QUESTIONS:104 y CONFIG_SCHEMA §3.5 |
| REQUIREMENTS ↔ RULE_CATALOG | Requisito y regla con el mismo contenido | FR-005 «Detectar coma, punto y coma o tabulador y presentar vista previa» ↔ R-DAT-002 «Se admiten coma, punto y coma y tabulador, con previsualización»; FR-006 ↔ R-DAT-001 (ceros iniciales); CON-004 ↔ R-CO-004 (no SOC) |
| UX_SPEC §2 ↔ MANUAL §4 | Tabla de pestañas | 8 filas en cada una; UX_SPEC con celdas de hasta 1.682 caracteres, MANUAL con una línea por fila |

Dueño propuesto por tipo de información:

- Estado y transición: `project_state.json`. Todo lo demás dice «la fase la dice `project_state.json`» (CLAUDE.md:16 ya lo hace, y acto seguido la repite).
- Qué cambió y cuándo: CHANGELOG, una entrada por versión.
- Evidencia por criterio de puerta: PHASE_GATES.
- Alcance de cada fase: ROADMAP, sin «**Hecha en 3.85.0**» (ROADMAP:223), que es CHANGELOG.
- Decisiones del propietario con su fecha y su cita: `docs/history/DECISION_LOG.md` (nuevo), cronológico.
- Decisiones vigentes, en una frase cada una: PROJECT_MEMORY.
- Qué debe hacer el producto: REQUIREMENTS (una frase + enlace a reglas). Cómo lo hace: RULE_CATALOG y ALGORITHM_CATALOG.
- Qué ve el usuario: MANUAL. Cómo está construido lo que ve: UX_SPEC.

### 3.2 Desactualización (E-08 a E-18)

- PROJECT_MEMORY.md:15: «Estado: **F3 en curso** desde el 2026-09-20, autorizada por el propietario con «Continúa con Fase 3»». `project_state.json`: `"currentPhase": "F6"`.
- ARCHITECTURE.md:12: «TAG TRACE **será** una aplicación web estática/PWA». :78: «**Se definirá** una interfaz de repositorio local. Implementación candidata». :92: «UI | React o alternativa ligera tras prototipo de rendimiento | **Open**». :93-94: «Vitest | **Proposed**», «Playwright | **Proposed**». :126: «La estructura se crea en F1, no en esta línea base documental». Realidad: `src/{application,domain,ingestion,persistence,presentation}` y `workers/`; `tests/{audit,e2e,support,unit}`; sin React (`grep "from \"react"` en `src`: 0); ADR-0009 `accepted` 2026-09-16 con «TypeScript y DOM directo».
- PHASE_GATES.md:25-33: nueve «- [ ]» en G0; `docs/checkpoints/F0_BASELINE_CANDIDATE.md:5` «status: approved», :54 «Frase del propietario, literal: «Continúa con Fase 1». Fecha: 2026-09-17». PHASE_GATES.md:49-51: «afinidad… **Parcial**: … la afinidad de ALG-003 no está implementada»; PROJECT_MEMORY.md:20-21: «**La afinidad de circuito se cerró el 2026-09-18**». PHASE_GATES.md:101-128: G3 sin la cabecera «Cerrada el…» que sí tienen G1 (44), G2 (67), G4 (132), G5 (155); PROJECT_MEMORY.md:317-325: «F4 abierta (2026-09-26)… G3 se cierra con lo que F3 dejó demostrado».
- CONTEXT_INDEX.md:40: «Todos los documentos `0.1.0` constituyen una **candidata de línea base**»; versiones reales: 25 de 31 por encima de 0.1.0 (PROJECT_MEMORY 0.75.0, OPEN_QUESTIONS 0.71.0, RULE_CATALOG 0.62.0…).
- DOMAIN_MODEL.md:12-64: siete agregados nombrados; `grep -rlw` en `src/`: `CircuitProject` 0, `SourceBatch` 0, `CircuitGraphVersion` 0, `ExpectedProfileVersion` 0, `Finding` 0, `Consolidation` 0, `IncidentCase` 0. `src/domain/snapshot.ts`, `memory.ts`, `incident-case.ts` exportan `CircuitSnapshot`, `ConsolidatedVersion`, `LineageState`, `CaseWindow`, `FrozenEvidence`, `HypothesisDecision`.
- DECISIONS.md:20: «[ADR-0009] … | Proposed». `decisions/ADR-0009-candidate-web-stack.md:3`: «status: accepted».
- DEFINITION_OF_DONE.md:16: «Pasan tipos, análisis estático, unitarias, **propiedades** y casos aplicables». `package.json` devDependencies: `@playwright/test`, `@types/node`, `axe-core`, `typescript`, `vite`, `vitest`; sin eslint, biome ni fast-check. TEST_STRATEGY.md:20 «Propiedades | Invariantes para entradas generadas | Cada cambio relevante»; :23 «Integración».
- UX_SPEC.md:80-82: «Áreas previstas que todavía no existen en el producto…: casos similares, hipótesis y contramedidas de los expedientes (Línea y calles)». PHASE_GATES.md:178-190: «[x] Similitud… **Evidencia (3.80.0)**», «[x] Contramedida y verificación… **Evidencia (3.78.0)**».
- RISK_REGISTER.md:10: «Los valores son iniciales y deben revisarse en cada puerta»; `last_updated: 2026-09-03`; :36 «## Riesgos que bloquean F1».
- AGENTS.md:8: «No iniciar Fase 1 hasta que `docs/project_state.json` registre la aprobación explícita `CONTINÚA FASE 1`».
- CHANGELOG.md:3: «las versiones de producto seguirán versionado semántico cuando exista software ejecutable». La siguiente línea es `## [3.88.4]`.

### 3.3 Forma (E-19 a E-27)

- RULE_CATALOG.md:65-67:
  ```
  | R-GRA-010 | accepted | **Antes de la primera lectura…
  <línea vacía>
  | R-GRA-011 | accepted | **Lo que el ciclo dominante deja fuera…
  ```
  Markdown cierra la tabla en la línea vacía; lo que sigue no tiene cabecera y se pinta como párrafos con barras verticales. Afecta a R-GRA-011, 012, 014, 015, 016, 017, 018, 013, 019, 020, 022, 021 (líneas 67-78).
- OPEN_QUESTIONS.md:91 `| ID | Pregunta | Respuesta | Fecha | Documentos |`, :92 `| OQ-176 …`, …, :97 `|---|---|---|---|---|`. Las cinco filas 92-96 quedan fuera. Líneas 22-25: cuatro `$` (vacías) seguidas.
- WORKER_PROTOCOL.md:106-115: párrafo «Las escrituras de memoria del Worker…» seguido sin línea en blanco por `| \`versions-compared\` | …`, `| \`plant-values-updated\` …`, `| \`cases-updated\` …`.
- ADR-0018:116-119: tabla de transiciones; línea 117 vacía; 118-119 dos filas sueltas (`Draft`/`UnderReview` → `Discarded`; `Closed`/`Inconclusive` → `Investigating`).
- ALGORITHM_CATALOG.md: `## 10. Mejoras posteriores` (993) y después `## 6.18 Revisión de la lógica…` (1004), `## 6.19` (1038) … `## 6.23` (1136).
- UX_SPEC.md: `## 5.2 Las que ya están en el producto` (441) → `### 5.2.1` (453) y `### 5.2.2` (481), pero `## 5.3` (516), `## 5.4` (568) al mismo nivel que `## 5. Grafo y plano` (402). `## 5.3 Vistas de diagnóstico (Parte 38)`, `## 5.4 Flota del circuito (Parte 39)`, `## 5.5 … (Parte 43)`, `## 5.6 … (Parte 47)`, `## 5.7 … (Parte 50)`, `## 5.9 … (Parte 52)`.
- RULE_CATALOG.md:62 (R-GRA-007): una celda de 5.056 caracteres con seis citas del propietario, «**Estado de implementación (Parte 35, ampliado en la Parte 36)**», «**Ampliación (propietario, 2026-09-26)**», «**Cambio de MTC confirmado (2026-09-26)**». Es un historial dentro de una regla.
- OPEN_QUESTIONS.md:62 (OQ-129): 1.604 caracteres, una celda que encadena «Y para cómo reaparece un AGV…», «Y para las paradas contra el flujo…», «Y para el estado normal…», «Y para las lecturas que llegaron juntas…», «Y para la posición en tiempo…», «Y para la suma entre anclas…», «Y para el ritmo…».
- Frases largas (script, >40 palabras, fuera de código): CHANGELOG 369; RULE_CATALOG 169 (máx. 184 palabras); UX_SPEC 121 (máx. 744, un párrafo entero sin punto); ALGORITHM_CATALOG 108; OPEN_QUESTIONS 75; PROJECT_MEMORY 68; DATA_CONTRACTS 55; CONFIG_SCHEMA 41.
- `scripts/check_docs.py` comprueba (líneas 42-69, 72-82, 85-112): frontmatter con `document_id`, `version`, `status`, `last_updated` (ADR: `adr`, `status`, `date`); formato `X.Y.Z` y `AAAA-MM-DD`; `document_id` único; cada `texto (ruta)` apunta a un fichero existente, **descartando el `#ancla`** (línea 76: `target.split("#", 1)[0]`); `project_state.json` contra `schemas/project-state.schema.json` y tres invariantes de F0. **No comprueba**: anclas de sección; referencias «§N» en texto (228); tablas (cabecera + separador); encabezados duplicados o desordenados; estado de una ADR en DECISIONS.md frente a su frontmatter; que un ID OQ declarado cerrado en otro documento esté en «Preguntas cerradas»; unicidad de IDs R-/FR-/NFR-/OQ-/TC-/ALG-; que `documentationVersion` (1.88.0) guarde relación con las versiones de los documentos (ninguno pasa de 0.88.0).

### 3.4 Legibilidad (E-28 a E-32, E-43)

- PROJECT_MEMORY: 802 líneas, 9.682 palabras, 55 secciones. Orden: «Decisión del propietario (2026-09-20)» (98) → … → «F4 cerrada, F5 abierta (2026-09-27)» (402) → «Mapa de calor… (3.64.0, 2026-10-07)» (413) → «Vitest 5.0.5 (3.88.4, 2026-10-18)» (427) → descendente hasta «Registro de conexiones por AGV: propuesta (2026-10-07)» (742) → «Estado al 2026-10-17 (relevo a un chat nuevo)» (755). AI_DEVELOPMENT_GOVERNANCE.md:64 lo define como «resumen operativo breve».
- README.md:3: «Sistema local y explicable de diagnóstico longitudinal y gemelo digital de circuitos AGV a partir de lecturas históricas de tags». Para el propietario, «diagnóstico longitudinal» y «gemelo digital» no son palabras suyas; el párrafo «Propósito» (9-17), con sus cinco preguntas, sí lo es y debería ir primero.
- CONTEXT_INDEX.md:11-14 ordena «PROJECT_MEMORY → project_state → REQUIREMENTS → el documento específico»; CLAUDE.md:9-13 ordena «project_state → PROJECT_MEMORY → CONTEXT_INDEX → los documentos». Dos órdenes para el mismo arranque.
- AGENTS.md:15 «Crear o actualizar una especificación de tarea desde `docs/templates/FEATURE_CONTRACT.md`»; CONTRIBUTING.md:9 «Crear una tarea usando `docs/templates/FEATURE_CONTRACT.md`». `grep -rl FEATURE_CONTRACT docs CHANGELOG.md` → solo `AI_DEVELOPMENT_GOVERNANCE.md`. No hay carpeta de contratos. PROJECT_MEMORY.md:788-791 describe lo que de verdad se hace: «una entrega por petición del propietario, con su documentación, su clase plantada en la auditoría sintética… y un solo commit en la rama de trabajo».
- CHANGELOG: entradas de gobierno puro con número de versión: `[3.88.3]` (:17-26, «OQ-176 cerrada… Sin cambios de código»), :223, :239 («Sin cambios de código: F6… no tiene entregas todavía»), :859. Tres versiones mayores en un día: `[1.9.0]` (4004), `[2.0.0]` (3949), `[3.0.0]` (3788), todas 2026-09-17. Encabezados fuera de Keep a Changelog: «### Medido, y por eso se hace así», «### Pendiente, y dicho para que no parezca terminado», «### Con el circuito real, sin datos de planta en el repositorio», «### Sin clase nueva en la auditoría». Primera frase de `[2.0.0]`: «F1a: el producto deja de olvidar.» Un usuario busca «ahora lo importado se guarda».

### 3.5 OPEN_QUESTIONS (E-35 a E-42)

49 IDs en secciones abiertas; 42 en «Preguntas cerradas». Cruce de cada ID abierto con `docs/`, `CHANGELOG.md`, `src/`, `tests/` (`review/E/analyze.py` no lo hace; fue un `grep` por ID, ver §2):

| Grupo | IDs | Evidencia |
|---|---|---|
| Declaradas cerradas en otro sitio | OQ-160, OQ-161, OQ-162 | ADR-0017:88 «OQ-160 a OQ-162 quedaron cerradas con la recomendación»; CHANGELOG:796 «OQ-160, OQ-161 y OQ-162 cerradas con la recomendación». Las tres filas (78-80) ya llevan «recomendación aplicada, 2026-10-07» |
| Duplicada literal | OQ-P05 | Línea 75 (abierta, «F1») y 133 (cerrada, 2026-09-16, «Ninguno para F1a: TypeScript y DOM directo») |
| Respondidas de hecho | OQ-106 | CONFIG_SCHEMA:227 «`loaded_zone` / `empty_zone` \| `lista=zona`, `grupo` ∈ `cargado`, `vacio`»; PROJECT_MEMORY:313 «la zona de cada tag sale del ESTADO de planta (LLENO → `cargado`, VACIO y SIN CARRO → `vacio`)» |
| | OQ-130 | «Abierta, espera F4»; PHASE_GATES:132 «G4… Marcado por el propietario el 2026-09-27»; `snapshot.ts:91` «Un tramo del anillo con su horquilla por régimen en este fichero»; comparador entre versiones 3.56.0 |
| | OQ-P06 | «¿Cuándo existe suficiente evidencia para promover deriva a cambio real?» = OQ-146 («tres ficheros seguidos») + OQ-147 («más de la mitad de los AGV»), cerradas 2026-09-27 |
| | OQ-P04 | «¿Qué librería… de grafo…? F2/F6». ADR-0009:36 «El motor gráfico sigue abierto y se decide en F2». F2 cerró el 2026-09-20; `src/presentation/charts.ts` y `diagnostic-charts.ts` sin dependencia (`package.json` `dependencies: None`) |
| Parciales sin reflejar | OQ-105 | «¿Qué señal confirma WiFi ausente…?»; ADR-0017 (accepted 2026-10-07): «CONEXIONES es evidencia directa»; PROJECT_MEMORY:417 «OQ-105 sigue abierta» pertenece a 3.64.0, anterior a ADR-0017 |
| | OQ-112 | «¿Cuál es el rango exacto de multicircuitos…?»; OQ-132 cerrada: «cambio del número de MTC del AGV, que puede ir de normal a 1, 2… 15» |
| | OQ-103 | «¿Cómo distinguir mantenimiento/asistencia…?»; R-DAT-022: «Los tags de calles, mantenimiento y emergencia tienen su sitio en su lista»; inventario `especial` |
| | OQ-114 | «¿Lo confirma el calendario?»; OQ-151 cerrada: «horas de turno por las paradas de producción que se repiten a la misma hora en dos días o más» |
| Misma pregunta, dos IDs | OQ-110 / OQ-120 | «qué diferencias… entre memorias de AGV y cómo se obtienen» / «qué lleva cada vehículo concreto y desde cuándo» |
| | OQ-107 / OQ-125 | «catálogo de qué es carga online, maniobra manual o excepción documentada» / «qué excepciones legítimas admite el orden de salida de una calle» |
| | OQ-126, OQ-108 / OQ-129 | OQ-129 cita «(OQ-108)» dos veces y enumera los umbrales de OQ-126 |
| | OQ-111, OQ-113, OQ-163, OQ-165, OQ-167 | Cinco preguntas sobre el significado de los eventos de uso del informe ampliado (`SUPERADO TIEMPO MAXIMO OFFLINE`, `PARADA FIJA POR TAG (11)`, `No ejecutado`, averías) |
| | OQ-131 / OQ-159 | «cómo vuelca un AGV» / «¿la hora del fichero es la de recepción… o la de lectura?» |
| No son decisiones de diseño | OQ-117, OQ-118, OQ-119, OQ-121, OQ-134 | Relatos de una exportación concreta («un vehículo con cuatro tramos recorridos sin leer, cuarenta tags… una cola de 234 min») que esperan «una segunda exportación» |
| Sin dueño ni plan | OQ-104 | «ventana de actualización automática de 30 min»; R-AGV-003 `candidate` desde F0; 0 menciones fuera |
| Fecha pasada | OQ-129 | «Calibrarlos con los datos de planta del viernes 2026-09-25 y la verificación en campo del lunes» |

Nota de dominio: OQ-159 contradice R-DAT-020, que sigue `accepted` (RULE_CATALOG:47). No es una decisión mía: lo anoto como contradicción abierta entre una regla aceptada y una pregunta abierta que el propietario debe resolver (AGENTS.md §Autoridad).

## 4. Ruta de lectura propuesta (sin borrar nada)

### 4.1 Propietario: «qué hace, qué me queda, qué decisiones me esperan»

| Orden | Documento | Líneas | Qué saca |
|---|---|---|---|
| 1 | `docs/VISION_GENERAL.md` (nuevo, §6) | 60 | Qué es, dónde está, qué le toca |
| 2 | `MANUAL_DE_USO.md` | 104 | Cómo se usa, pestaña a pestaña |
| 3 | `PHASE_GATES.md` §G6 | 38 (208-245) | Qué falta para aprobar el piloto |
| 4 | `templates/PILOT_ACCEPTANCE.md` | 95 | Lo que tiene que hacer y medir |
| 5 | `OPEN_QUESTIONS.md`, solo filas «Pendiente del propietario» | ~12 filas | Qué decidir (hoy repartidas; E-31) |
| 6 | `GUIA_DE_DIAGNOSTICO.md`, `OPERACION.md` | 60 + 69 | Cuando algo falle |
| | **Total** | **≈ 440** | Hoy el README le ofrece 31 documentos sin orden |

El README no lleva ahí: enlaza MANUAL en el tercer grupo («Cómo se usa») tras 13 documentos técnicos.

### 4.2 Persona nueva que sigue desarrollando

| Orden | Documento | Líneas hoy | Propuesto |
|---|---|---|---|
| 1 | `AGENTS.md` | 57 | 57 |
| 2 | `CLAUDE.md` | 46 | 46 (un solo orden de arranque, E-11) |
| 3 | `docs/VISION_GENERAL.md` | — | 60 |
| 4 | `project_state.json` | 30 | 30 |
| 5 | `PROJECT_MEMORY.md` | 802 | ≤ 150 (identidad, decisiones firmes, modelo industrial, estados de verdad, relevo); lo fechado a `history/DECISION_LOG.md` |
| 6 | `ARCHITECTURE.md` (actualizado, E-09) | 140 | 140 |
| 7 | `WORKER_PROTOCOL.md` | 170 | 170 |
| 8 | `DATA_CONTRACTS.md` §3–§5 | ~130 | ~130 |
| 9 | `CONTEXT_INDEX.md` → sección concreta del documento de su tarea | 50 | 50, señalando secciones, no documentos |
| | **Total antes de la tarea** | **≈ 1.300 + REQUIREMENTS 101** | **≈ 830** |

Para una tarea de diagnóstico, hoy CONTEXT_INDEX manda RULE_CATALOG + ALGORITHM_CATALOG + TEST_STRATEGY enteros (~54.000 palabras); con reglas de una frase y desarrollo aparte (E-24) y rutas por sección, la lectura obligatoria baja a la familia de reglas afectada (R-FLO-*, R-CO-*…) y su §6.N del catálogo de algoritmos.

### 4.3 Qué se mueve a anexo o histórico (nada se borra)

- `docs/history/DECISION_LOG.md`: PROJECT_MEMORY 98-753 (todo lo fechado), en orden cronológico; las citas del propietario de RULE_CATALOG (E-34); las secciones «Gobierno» del CHANGELOG sin código.
- `docs/history/PHASE_GATES_G0-G5.md` o, sin crear fichero, una cabecera de una línea por puerta cerrada y las casillas plegadas con `<details>`.
- `OPEN_QUESTIONS.md` → tres bloques: «Decide el propietario», «Falta dato de planta / fabricante», «F7 y posteriores»; anexo «Observaciones de planta pendientes de datos» para OQ-117/118/119/121/134.
- REQUIREMENTS, RISK_REGISTER, DEFINITION_OF_DONE, LEGACY_ASSESSMENT, AI_DEVELOPMENT_GOVERNANCE: una nota de cabecera «Escrito en F0; revisado el <fecha>: sigue vigente / cambia esto» en vez de reescribirlos.

### 4.4 README propuesto (estructura, ~70 líneas)

1. Una frase en lenguaje llano (la del §6) y el enlace a la aplicación y a `VISION_GENERAL.md`.
2. «Si usas la aplicación» → MANUAL, GUIA, OPERACION.
3. «Si decides» → VISION_GENERAL §Qué le queda, PHASE_GATES §G6, OPEN_QUESTIONS §Decide el propietario.
4. «Si desarrollas» → AGENTS, CLAUDE, CONTEXT_INDEX.
5. Límites innegociables: un enlace a AGENTS.md (E-07).
6. Privacidad del repositorio: el párrafo actual (89-101), que está bien.
7. Índice completo de documentos, plegado (`<details>`), para quien lo quiera.

## 5. Diez ejemplos reescritos

Juicio general: el estilo ayuda cuando el enunciado en negrita de una regla cabe en una frase y se puede comprobar («Antes de la primera lectura de un objeto dentro de la ventana, su estado es «sin datos», nunca silencio», R-GRA-010; «Lecturas que llegaron juntas no son una parada», R-DAT-020), en la lista «No significa terminado» de DEFINITION_OF_DONE y en los tres manuales, que están escritos para quien los lee. Estorba en tres casos: cuando el lema es la única justificación dentro de una regla (13 «Dónde, no por qué» / «sin causa» / «Hechos, nunca causas» que exigen conocer R-EVI-006); cuando un documento de estado cuenta una historia (PROJECT_MEMORY:154-168, veinte líneas sobre dos intentos fallidos de Pages); y cuando una moraleja cierra un párrafo de gobierno sin añadir un criterio comprobable. Cada reescritura conserva el sentido y el ID.

1. PROJECT_MEMORY.md:757-759 — «Todo lo que dura está aquí, en `project_state.json` y en `CHANGELOG.md`; lo que no esté escrito en el repositorio no existe para la conversación siguiente.»
   → «La siguiente conversación solo conocerá lo que esté en este fichero, en `project_state.json` y en `CHANGELOG.md`. Una decisión que no esté escrita aquí habrá que volver a tomarla.»

2. RULE_CATALOG.md:135 (R-COM-005, cierre) — «Dónde, no por qué (R-EVI-006).»
   → «El mapa señala el tramo donde se pierde la señal; la causa no la afirma el programa (R-EVI-006).»

3. PHASE_GATES.md:44-46 — «Marcar una casilla que no se ha demostrado sería exactamente lo que `AI_DEVELOPMENT_GOVERNANCE.md` prohíbe: convertir una puerta en un trámite.»
   → «Los criterios sin evidencia se dejan sin marcar aunque la fase se abra (`AI_DEVELOPMENT_GOVERNANCE.md` §1).»

4. README.md:92-94 — «La regla no depende de la buena voluntad. Un guardián en integración continua y un hook local rechazan las extensiones prohibidas y los ficheros sospechosos antes de que lleguen a GitHub.»
   → «Un script en la integración continua y un hook local rechazan automáticamente las extensiones prohibidas y los ficheros sospechosos antes de que lleguen a GitHub.»

5. AGENTS.md:39 — «El repositorio es público (ADR-0014). Un error aquí no se puede deshacer.»
   → «El repositorio es público (ADR-0014): un dato de planta que llegue a GitHub queda indexado y copiado aunque se borre después.»

6. ROADMAP.md:59-61 — «El objetivo no es cerrar una puerta: es poner el protocolo de Workers y el contrato de importación frente a datos reales cuanto antes, que es lo único que ha demostrado encontrar errores en este proyecto.»
   → «F1a·0 no cierra ninguna puerta. Sirve para probar el protocolo de Workers y el contrato de importación con datos reales lo antes posible: hasta ahora, solo así han aparecido los errores.»

7. PROJECT_MEMORY.md:128-130 — «De ahí una lección que vale más que las tres correcciones: **un producto con la suite en verde puede estar afirmando algo falso en pantalla**. Las pruebas comprobaban que el replay decía «silencio»; ninguna preguntaba si eso era cierto.»
   → «Lección: las pruebas comprobaban que el replay mostraba «silencio», no que el silencio fuera real. Una suite en verde no garantiza que lo que se ve en pantalla sea cierto; por eso existe la auditoría con verdad plantada (`TEST_STRATEGY.md` §7).» (Aquí el estilo ayuda; solo falta el enlace al mecanismo que lo corrige.)

8. checkpoints/F0_BASELINE_CANDIDATE.md:56-60 — «Se deja constancia de la diferencia en lugar de normalizar el texto, porque un registro de aprobación que corrige lo que dijo la persona deja de ser un registro.»
   → «Se registra la frase tal como se escribió («Continúa con Fase 1») y se anota que no coincide letra a letra con la prevista («CONTINÚA FASE 1»). La intención es inequívoca; el registro no se corrige.»

9. RULE_CATALOG.md:41 (R-DAT-014) — «Ante «01/09 y 02/09» nadie contesta de memoria; ante «dos días seguidos» frente a «dos días a 31 días de distancia», cualquiera que conozca la planta responde.»
   → Regla: «Cuando día y mes son ambiguos, el programa calcula el rango de fechas del fichero con cada lectura posible y lo enseña al usuario para que elija.» Ejemplo, debajo de la tabla: «“dos días seguidos” frente a “dos días con un mes de separación”: quien conoce la planta sabe cuál es.»

10. CHANGELOG.md:3949-3953 (`[2.0.0]`) — «F1a: el producto deja de olvidar. Hasta ahora importaba un fichero y lo perdía al cerrar la pestaña, lo cual es inservible cuando el servidor de planta guarda dos o tres días y el modo de trabajo real es acumular muchas extracciones pequeñas a lo largo de meses.»
    → «Para quien usa la aplicación: lo importado se guarda en el dispositivo y se acumula por circuito; antes se perdía al cerrar la pestaña. Motivo: el servidor de planta conserva dos o tres días y el trabajo real es acumular extracciones pequeñas durante meses.»

## 6. Borrador de `docs/VISION_GENERAL.md`

Guardado también en `<entorno de revisión>/E/VISION_GENERAL.md` (58 líneas). Texto:

```markdown
---
document_id: TT-VISION-001
version: 0.1.0
status: draft
last_updated: 2026-10-18
---

# TAG TRACE en una página

## Qué es

Una aplicación web que se abre en el navegador del PC o del móvil, lee las exportaciones de lecturas de
tags de un circuito de AGV y explica qué pasa en ese circuito: qué tags no se leen, qué vehículos leen
peor, dónde se forman colas, dónde se pierde la WiFi y qué cambió desde la última vez. Todo se calcula
en el propio dispositivo; ningún dato sale de él.

## Qué problema resuelve

Las lecturas están repartidas en exportaciones de dos o tres días, y una lectura que falta puede
deberse al tag, al lector, al vehículo, a la WiFi, a la configuración o a la ruta. Revisarlo a mano
exige mirar AGV por AGV. TAG TRACE junta las exportaciones, reconstruye el recorrido real a partir de
lo que leyeron los vehículos y señala las desviaciones con su evidencia, sin inventar lo que no sabe.

## Cómo funciona, en cinco pasos

1. Se importa la exportación de lecturas (CSV o Excel) y, si se tienen, las listas del circuito.
2. El programa reconstruye el anillo de tags, mide los tiempos normales de cada tramo y busca lo que se
   sale de ellos. Lo que no puede afirmar lo marca «sin determinar».
3. La persona revisa cada hallazgo en planta: confirmado, descartado o pospuesto.
4. Cuando el periodo es normal, la persona consolida: el circuito guarda una versión de su estado
   «esperado». El programa nunca consolida solo.
5. Ante una incidencia, se abre un expediente: qué pasó antes, durante y después, con replay, hipótesis
   y verificación de la contramedida. El informe se descarga en HTML y se imprime a PDF.

## Qué no hace nunca

- No se conecta a los AGV ni al servidor de planta; no da órdenes (nada de START, STOP, RESET).
- No envía datos a ningún servidor; funciona sin red una vez abierta.
- No usa la batería como señal de diagnóstico ni un modelo opaco: cada conclusión lleva su evidencia.
- No afirma causas: dice «precede», «es compatible con» o «contradice». La causa la confirma una persona.

## Dónde está el proyecto (2026-10-18)

Fase F6, «piloto profesional». Las siete entregas que podía hacer la IA están hechas (versión 3.88.4):
actualización segura, banco de medida, optimización, interfaz en PC y móvil, accesibilidad, sin red y
seguridad, manuales. La aplicación está publicada en <https://rbeno.github.io/tag-trace/>.

## Qué le queda al propietario

1. Publicar la rama de F6 (PR) y medir con «Datos → Medir este dispositivo» en el S23 FE y en el PC.
2. Hacer el piloto de 48 h con datos reales siguiendo `templates/PILOT_ACCEPTANCE.md`.
3. Decidir OQ-172 (cuándo se dice «correlaciona») y las preguntas de planta pendientes (`OPEN_QUESTIONS.md`).
4. Si el piloto pasa, escribir `CONTINÚA FASE 7`.

## Qué leer después

- Para usar la aplicación: `MANUAL_DE_USO.md`, `GUIA_DE_DIAGNOSTICO.md`, `OPERACION.md`.
- Para decidir: `PHASE_GATES.md` §G6 y `OPEN_QUESTIONS.md`.
- Para desarrollar: `../AGENTS.md`, `../CLAUDE.md`, `CONTEXT_INDEX.md`.
```

## 7. Ficheros de esta revisión

- Informe: `<entorno de revisión>/E-documentacion.md`
- Script de métricas: `<entorno de revisión>/E/analyze.py`
- Borrador: `<entorno de revisión>/E/VISION_GENERAL.md`
- `python3 scripts/check_docs.py` → «Verificación documental correcta» (no detecta nada de §3.3 porque no lo comprueba). `git status` limpio.
