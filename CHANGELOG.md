# Registro de cambios

Todos los cambios relevantes del proyecto se documentan aquí. El formato sigue *Keep a Changelog* y las versiones de producto seguirán versionado semántico cuando exista software ejecutable.

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
