# Contribuir a TAG TRACE

## Principio de trabajo

Cada cambio debe ser comprensible, medible, reversible y trazable desde una necesidad industrial hasta sus pruebas. La velocidad no justifica perder evidencia ni mezclar observación con inferencia.

## Flujo

1. Crear una tarea usando `docs/templates/FEATURE_CONTRACT.md`.
2. Relacionarla con requisitos y reglas mediante sus IDs.
3. Trabajar en una rama con nombre `type/descripcion-breve`. Las sesiones de IA usan la rama que les
   asigna la sesión (`claude/…`, `ccr-…`).
   Antes del primer commit: `git config core.hooksPath .githooks`.
4. Añadir o actualizar pruebas y documentación.
5. Anotar la entrega en `CHANGELOG.md`: su primera entrada es la versión del producto. `package.json`
   la repite (`npm version X.Y.Z --no-git-tag-version`) y `check_docs.py` comprueba que coincidan.
6. Abrir una solicitud de cambio con la plantilla del repositorio.
7. Superar las validaciones automáticas. En local: `python3 scripts/check_docs.py`,
   `bash scripts/check_data.sh`, `npm run typecheck`, `npm test`, `npm run build` y
   `npm run test:e2e`. En integración continua corren los mismos.
8. Obtener la validación funcional del propietario del producto cuando afecte al dominio.
9. Tras fusionar, borrar la rama. La historia queda en `main`, en el `CHANGELOG.md` y en
   `docs/history/DECISION_LOG.md`. Una rama que no se va a fusionar se guarda antes como etiqueta
   `archivo/<rama>` (`docs/VERSIONING.md` §Tags Git) y después se borra.

## Tamaño y alcance

- Una solicitud debe resolver una sola intención verificable.
- No combinar refactorizaciones amplias con cambios funcionales.
- Los cambios de arquitectura, formato persistente, reglas industriales o algoritmos requieren ADR.
- Una migración debe incluir copia de seguridad, validación y prueba de ida y vuelta.

## Datos de prueba

Solo se aceptan casos sintéticos. Deben estar marcados como tales y no reproducir nombres, horarios, topologías ni identificadores reales. Los datos anonimizados procedentes de planta tampoco se publicarán sin una revisión específica, porque la estructura puede seguir siendo sensible.
