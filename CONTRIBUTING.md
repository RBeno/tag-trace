# Contribuir a TAG TRACE

## Principio de trabajo

Cada cambio debe ser comprensible, medible, reversible y trazable desde una necesidad industrial hasta sus pruebas. La velocidad no justifica perder evidencia ni mezclar observación con inferencia.

## Flujo

1. Crear una tarea usando `docs/templates/FEATURE_CONTRACT.md`.
2. Relacionarla con requisitos y reglas mediante sus IDs.
3. Trabajar en una rama con nombre `type/descripcion-breve`.
4. Añadir o actualizar pruebas y documentación.
5. Abrir una solicitud de cambio con la plantilla del repositorio.
6. Superar validaciones automáticas.
7. Obtener la validación funcional del propietario del producto cuando afecte al dominio.

## Tamaño y alcance

- Una solicitud debe resolver una sola intención verificable.
- No combinar refactorizaciones amplias con cambios funcionales.
- Los cambios de arquitectura, formato persistente, reglas industriales o algoritmos requieren ADR.
- Una migración debe incluir copia de seguridad, validación y prueba de ida y vuelta.

## Datos de prueba

Solo se aceptan casos sintéticos. Deben estar marcados como tales y no reproducir nombres, horarios, topologías ni identificadores reales. Los datos anonimizados procedentes de planta tampoco se publicarán sin una revisión específica, porque la estructura puede seguir siendo sensible.
