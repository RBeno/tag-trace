# Instrucciones obligatorias para cualquier agente de IA

## Autoridad

- El propietario del producto es la autoridad sobre las reglas industriales y la aceptación.
- La documentación versionada es la fuente de verdad. Una conversación no puede contradecirla silenciosamente.
- Ante una contradicción, detener la tarea, citar ambos requisitos y solicitar decisión.
- No iniciar Fase 1 hasta que `docs/project_state.json` registre la aprobación explícita `CONTINÚA FASE 1`.

## Antes de cambiar algo

1. Leer `docs/CONTEXT_INDEX.md`, `docs/PROJECT_MEMORY.md` y `docs/project_state.json`.
2. Leer los documentos indicados para el tipo de cambio.
3. Confirmar objetivo, alcance, exclusiones, pruebas y presupuesto de recursos.
4. Crear o actualizar una especificación de tarea desde `docs/templates/FEATURE_CONTRACT.md`.
5. Si falta una regla de dominio, no inventarla: registrarla en `docs/OPEN_QUESTIONS.md`.

## Reglas de implementación futuras

- Núcleo de dominio independiente de interfaz, Workers y persistencia.
- Cálculos deterministas para igual entrada, configuración y versión de algoritmo.
- Ninguna lectura sintética puede presentarse como observada.
- Mantener los estados `observed`, `inferred`, `expected`, `unknown` y `confirmed` sin mezclarlos.
- IDs de tag y AGV son texto; preservar ceros iniciales.
- Todo hallazgo debe enlazar evidencia y procedencia hasta archivo, hash y fila cuando exista.
- No reinterpretar ni migrar proyectos históricos sin migración explícita y prueba de ida y vuelta.
- Toda operación pesada debe ejecutarse fuera del hilo principal, admitir progreso y cancelación.
- Evitar dependencias nuevas salvo justificación, medición y ADR.
- Cambios pequeños, reversibles y limitados a los archivos autorizados por la tarea.

## Datos y seguridad

- Prohibido añadir datos industriales reales o plausiblemente identificables.
- Prohibidos `*.csv`, `*.tsv`, `*.agvproj`, informes, mapas o configuraciones reales; solo fixtures inequívocamente sintéticos bajo `fixtures/synthetic/`.
- Prohibido transmitir datos de usuario, usar telemetría o llamar a servicios externos durante un análisis.
- Prohibido implementar control industrial, escritura sobre equipos o acciones `START`, `STOP`, `RESET`.
- Nunca registrar contenido bruto en consola, trazas de error o analítica.

## Pruebas y aceptación

- No modificar un resultado esperado para ocultar una regresión.
- Toda corrección debe añadir una prueba que falle antes y pase después.
- Toda regla nueva necesita ID, evidencia, caso positivo, caso límite y caso que no debe diagnosticar.
- Actualizar la matriz de trazabilidad, el changelog y el documento afectado.
- La IA no puede aprobar su propio cambio de fase ni consolidar periodos.
