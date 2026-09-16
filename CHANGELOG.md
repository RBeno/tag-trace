# Registro de cambios

Todos los cambios relevantes del proyecto se documentan aquí. El formato sigue *Keep a Changelog* y las versiones de producto seguirán versionado semántico cuando exista software ejecutable.

## [0.7.0] - 2026-09-16

Cierre de OQ-115 con una precisión del propietario que añade una hipótesis que faltaba.

### Añadido

- **R-AGV-008**: si los vecinos de un objeto tampoco avanzaron durante su silencio, la causa es de
  la línea y no del objeto. Atribuirle un fallo individual sería un falso diagnóstico, así que la
  comprobación tiene **prioridad sobre cualquier hipótesis individual**. Es la diferencia entre un
  vehículo averiado y una línea parada, y la matriz anterior no la contemplaba.
- **R-FLO-006**: el vecindario se deriva del orden relativo y solo es firme donde el orden está
  garantizado. Fuerte en zona cargada, débil en zona vacía por la reordenación admitida, y no
  aplicable a una entrada en calle CO, que es una salida legítima del orden. Donde es débil, las
  firmas que dependen de él bajan de confianza en lugar de aplicarse igual.
- La matriz de reaparición de ALG-019 pasa a cuatro filas y añade el contraste con el tiempo
  esperado del tramo: un objeto que reaparece en posición muy por encima del esperado robusto indica
  detención individual anómala. El factor que hace significativo ese exceso es configuración con
  vigencia, no un umbral absoluto.
- TC-033 a TC-035, incluido el caso en zona vacía que debe rebajar la confianza en lugar de concluir
  igual que en zona cargada.

### Precisado

- La reaparición se busca **hacia delante en el tiempo**, no en el mismo instante.
- Estas detenciones duran varias veces la resolución de la fuente, así que su exceso de tiempo sí es
  medible pese a que la mayoría de las transiciones no lo sea (§4.1).

## [0.6.0] - 2026-09-16

### Añadido

- **Quinto discriminante de ALG-019: la forma de la reaparición.** Los cuatro anteriores miraban
  hacia atrás y hacia los lados; este mira hacia delante, y es el único capaz de elevar un silencio
  de `unknown` a una inferencia con soporte.
- **R-CO-006, firma de carga online**: última lectura en el tag de parada de una calle configurada
  más reanudación que recorre en orden su secuencia declarada. Se comprueba contra DS-004, no
  contra una expectativa del algoritmo. Sin calles configuradas la firma no se reconoce y el
  silencio queda `unknown`; no se sustituye por proximidad.
- **R-AGV-007, firma de hueco conservado**: reaparecer entre los mismos vecinos sin intercambio de
  AGV demuestra permanencia en el circuito y descarta salida o retirada, pero no distingue por sí
  solo detención de circulación sin lectura. Eso lo decide dónde reaparece frente a cuánto
  avanzaron sus vecinos.
- El umbral que hace significativo un silencio es configuración con vigencia y **relativo al ciclo
  local del tramo**, nunca minutos absolutos en el código.
- TC-030 a TC-032, incluido el caso que prohíbe inferir carga online por proximidad cuando falta la
  configuración de calles.
- OQ-115: si «reaparecer en su hueco» se observa con el grupo avanzando o alcanzándole, que decide
  cuál de las dos hipótesis de R-AGV-007 va primero.

## [0.5.0] - 2026-09-16

### Añadido

- FR-033 a FR-035: expediente por AGV y por tag desde su identificador, y detección de periodos de
  inactividad e instante de cambio. Versión reducida en F2, completa en F3.
- ALG-018 expediente por objeto y ALG-019 inactividad e instante de cambio, con los cuatro
  discriminantes de un silencio: cobertura, contexto colectivo, punto de la última lectura y
  calendario.
- `UX_SPEC.md` §4.1: estructura del expediente, simétrica para AGV y tag, donde cada bloque dice
  también qué no se sabe.
- Glosario: `periodo de inactividad`, `instante de cambio` y `expediente de objeto`.
- Clase `técnico` en el catálogo de tags especiales (DS-006).
- TC-026 a TC-029.

### Decidido

- **R-AGV-006**: un AGV detenido no emite lecturas. La inactividad y el fallo de comunicación
  producen el mismo silencio y no se distinguen por la ausencia en sí. Es un límite del dato, no
  del algoritmo, y la interfaz debe declararlo en lugar de elegir una causa.
- **R-OPP-008**: «tags que un AGV no ha leído» nunca se calcula restando el catálogo del circuito a
  lo leído. Solo cuentan las oportunidades elegibles; una rama que ese AGV no recorre no es una
  ausencia.
- El instante de cambio es `inferred`: marca el último momento con evidencia, no el instante real
  en que el objeto dejó de funcionar.

## [0.4.0] - 2026-09-16

### Añadido

- `docs/golden/` con los seis casos de oro desarrollados que **no dependen de información de
  planta**, y que son los criterios de aceptación de F1a: TC-015 solape entre exportaciones,
  TC-019 delimitadores e identidad, TC-020 carrera entre Worker e interfaz, TC-021 solape que
  contiene una maniobra, TC-022 intervalo fuera de la cobertura y TC-023 entrega diferida.
  Cada uno con propósito, reglas cubiertas, fixture sintético, resultado esperado, resultados
  expresamente prohibidos, tolerancias, evidencia navegable y criterio de estabilidad, según
  `TEST_STRATEGY.md` §5.
- Enlaces desde el catálogo de casos y ruta de lectura en el índice de contexto.

Las pruebas se escriben antes que el motor que deben superar. Los casos restantes se desarrollarán
cuando se cierren las preguntas abiertas de las que dependen.

## [0.3.0] - 2026-09-11

Contraste de la línea base contra la fuente real. El propietario aportó una muestra de lecturas y
el informe ampliado de Vsystem; ambos se leyeron solo en local y al repositorio vuelve la forma,
nunca los valores.

### Corregido

- **ADR-0013 fijaba un orden canónico incorrecto.** Definía el desempate como `source_row`
  ascendente, pero la fuente entrega los eventos como una pila, del más reciente al más antiguo.
  Con una resolución más gruesa que el paso real de un AGV, esa regla reconstruía los tramos al
  revés: contrastadas las dos hipótesis sobre la muestra real, la incorrecta producía 1.173 aristas
  con dominancia 0,691 frente a 299 aristas con 0,916. El grafo habría salido plausible y falso sin
  ningún síntoma. La ADR se corrige en el sitio porque vivía en una propuesta sin fusionar y nunca
  llegó a estar en vigor; el sentido pasa a medirse en cada fichero en lugar de suponerse.
- **La deduplicación por huella de fila destruía evidencia.** De 116 filas idénticas de la muestra,
  114 tenían otra lectura del mismo AGV entre medias: son pasos repetidos reales, el retroceso que
  contempla R-CO-005. Se sustituye por unión del tramo contiguo común entre cortes de la misma pila,
  que elimina el solape de forma exacta y conserva las maniobras.

### Añadido

- Regla de cobertura: fuera de los intervalos cargados el estado es `sin datos cargados`, que no es
  una parada ni un silencio (R-DAT-007, INV-013).
- El orden de una fuente se mide; las inversiones son evidencia de entrega diferida y se conservan
  señaladas (R-DAT-008).
- El análisis es muestral y dos muestras solo se comparan con contexto de calendario equivalente
  (R-TIM-007).
- El multicircuito condiciona la oportunidad de lectura y puede alterar las condiciones físicas de
  detección; sin él, la salud declara el confusor (R-OPP-007, TC-024, TC-025).
- DS-011, informe ampliado con segundos, circuito declarado, multicircuito y eventos de uso; y el
  contrato de los eventos que no son lecturas.
- Atributos canónicos opcionales `circuit_declared`, `mtc` y `resolution`, y el ajuste del análisis
  temporal a la resolución declarada de cada fuente.
- TC-021 a TC-025 e INV-013/INV-014.
- Glosario: `cobertura`, `sin datos cargados`, `muestra` y `multicircuito (MTC)`, separando este
  último de «varios circuitos», que es el alcance de F7 y se renombra para no colisionar.

## [0.2.0] - 2026-09-03

Auditoría de la línea base 0.1.0 y del prototipo `RBeno/tag-trace-agv`, cierre de las
contradicciones encontradas y conversión del gobierno en automatización bloqueante.

### Añadido

- `docs/WORKER_PROTOCOL.md`: contrato entre interfaz y Workers, con la regla de una sola pasada de
  parseo dentro del Worker y la prohibición de cualquier cálculo de repuesto en el hilo principal.
- `docs/CONFIG_SCHEMA.md`: contrato de configuración de circuito con vigencia, donde viven los
  umbrales que de otro modo acabarían como constantes en el código.
- ADR-0012: contenedor `.agvproj` como zip con manifiesto, secciones y hash por sección.
- ADR-0013: tiempo canónico, orden total `(t_utc, source_hash, source_row)` y canonicalización
  numérica del hash semántico.
- ADR-0014: repositorio público limitado a código, documentación y fixtures sintéticos, y vía de
  publicación con el límite real de CSP en GitHub Pages.
- `CLAUDE.md`, `schemas/project-state.schema.json`, `scripts/check_docs.py`,
  `scripts/check_data.sh`, hook de pre-commit y los workflows de calidad documental y guardián de
  datos, incluida la verificación del historial completo.
- `.github/CODEOWNERS`, plantillas de incidencia y `.editorconfig`.
- Política de borrado y retención local, y política de bifurcación de linaje entre dispositivos.
- Términos `cohorte`, `takt`, `soporte`, `oportunidad elegible` y `pastor` en el glosario.
- RSK-021: dato real en repositorio público.
- `docs/templates/G0_INTAKE.md`: admisión estructurada de las cinco preguntas bloqueantes de G0,
  para rellenar en `local/` y devolver al repositorio solo la forma de cada respuesta. El guardián
  rechaza una copia rellenada fuera de la plantilla, porque es markdown y la extensión no la
  delata.

### Corregido

- Fases incoherentes de FR-027, FR-029 y FR-030 respecto a las puertas G1 y G2.
- La definición de duplicado contradecía el caso de solape entre fuentes: ahora hay huella canónica
  de evento y se distingue repetición dentro de una fuente de solape entre fuentes.
- Faltaba el desempate determinista del que dependen INV-001 e INV-010.
- El hash semántico no tenía regla para la coma flotante.
- `SECURITY_PRIVACY.md` exigía cabeceras HTTP que GitHub Pages no permite fijar.
- Accesibilidad sin objetivo medible: se fija WCAG 2.2 AA y objetivo táctil de 24×24 px CSS.
- Riesgo de falsa precisión en el replay: la posición sobre un tramo es fracción temporal, no
  distancia física.
- Plantillas y checkpoint sin frontmatter, incumpliendo `VERSIONING.md`.
- `TT-MEMORY-001` pasa a `TT-PMEM-001` para no colisionar con la memoria del circuito.
- El índice del `README.md` omitía siete documentos normativos.

### Estado

- Documentación: `baseline-candidate` 0.2.0.
- Programación: no iniciada.
- Siguiente transición permitida: aprobación explícita `CONTINÚA FASE 1`.

## [0.1.0] - 2026-09-03

### Añadido

- Base documental profesional de Fase 0.
- Carta del proyecto, requisitos, modelo de dominio y contratos de datos.
- Catálogos versionados de reglas y algoritmos.
- Arquitectura local-first, estrategia de memoria compacta y consolidación supervisada.
- Modelo de expedientes de incidencia, replay y contramedidas.
- Especificación de experiencia de usuario, seguridad, privacidad y rendimiento.
- Roadmap F0–F8, puertas de fase, definición de terminado y matriz de trazabilidad.
- Gobierno del desarrollo realizado por IA, plantillas y registro de decisiones.
- Registro de riesgos, preguntas abiertas y checkpoint candidato de Fase 0.

### Estado

- Documentación: `baseline-candidate` 0.1.0.
- Programación: no iniciada.
