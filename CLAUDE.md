# TAG TRACE — instrucciones para Claude Code

Las normas obligatorias para cualquier agente de IA están en **[AGENTS.md](AGENTS.md)**. Léelo
entero antes de tocar nada; este fichero solo añade el arranque y los atajos.

## Arranque obligatorio

Antes de cualquier tarea, en este orden:

1. `docs/project_state.json` — fase vigente y transición permitida.
2. `docs/PROJECT_MEMORY.md` — decisiones compactas.
3. `docs/CONTEXT_INDEX.md` — qué documentos exige tu tipo de tarea.
4. Los documentos que ese índice indique.

## Estado actual

Fase **F0**. `implementationStarted: false`. **No se programa aplicación** hasta que
`docs/project_state.json` registre la aprobación literal `CONTINÚA FASE 1` del propietario del
producto. Cerrar documentación, gobierno y CI sí forma parte de F0.

## Límites que no se negocian

- Nunca añadas datos industriales reales, ni anonimizados. Solo `fixtures/synthetic/` con
  manifiesto `synthetic: true`.
- Nunca implementes control industrial ni acciones `START`, `STOP`, `RESET`.
- Nunca introduzcas red, telemetría, backend o dependencia de CDN en ejecución.
- Nunca sustituyas `unknown` por la hipótesis más probable.
- Nunca fijes una constante industrial en el código: va a configuración versionada
  (`docs/CONFIG_SCHEMA.md`).
- Nunca modifiques un resultado esperado para que una prueba pase.
- Ninguna IA aprueba su propio cambio de fase ni consolida periodos.

## Antes de terminar una tarea

- Actualiza documentación, trazabilidad y `CHANGELOG.md` en el mismo cambio, no después.
- Si falta una regla de dominio, no la inventes: anótala en `docs/OPEN_QUESTIONS.md`.
- Si encuentras una contradicción entre documentos, detente, cita ambos y pide decisión.

## Verificación local

```bash
python3 scripts/check_docs.py    # frontmatter, IDs únicos y enlaces internos
bash scripts/check_data.sh       # extensiones prohibidas y fixtures sintéticos
git config core.hooksPath .githooks   # una sola vez, activa el hook de pre-commit
```
