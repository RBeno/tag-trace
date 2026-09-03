---
document_id: TT-DOD-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Definición de terminado

## Para una tarea

- El contrato de tarea contiene objetivo, alcance, exclusiones y criterios medibles.
- Requisitos, reglas y algoritmos afectados están enlazados.
- El cambio se limita a una intención y es reversible.
- Las pruebas nuevas fallaban antes del cambio cuando corrigen un defecto.
- Pasan tipos, análisis estático, unitarias, propiedades y casos aplicables.
- La evidencia no mezcla `observed`, `inferred`, `expected`, `unknown` o `confirmed`.
- Se conserva procedencia y determinismo.
- No se añaden datos reales, telemetría, red o control industrial.
- Rendimiento medido cuando toca ruta crítica.
- Documentación, ADR, trazabilidad y changelog actualizados.
- La solicitud explica riesgos y retorno.

## Para una función industrial

Además:

- Existe al menos un caso positivo, límite, ambiguo y diagnóstico prohibido.
- El propietario puede revisar la conclusión sin leer código.
- Se muestran evidencia a favor/en contra, confianza, impacto y comprobación.
- Los casos `unknown` están tratados.
- La función no altera memoria hasta una consolidación válida.

## Para una fase

- Se cumplen todos los criterios de su puerta o cada excepción está aceptada formalmente.
- Existe demo reproducible y paquete de evidencia.
- Los riesgos residuales están visibles.
- El checkpoint registra commit, versiones, resultados y aprobación humana.
- `project_state.json` cambia solo después de la aprobación.

## Para una release

- Rama principal protegida y verificaciones superadas.
- Build reproducible desde lockfile.
- Matriz de navegadores y dispositivos ejecutada.
- Seguridad, privacidad y ausencia de datos reales comprobadas.
- Migraciones y retorno probados.
- Número de versión visible, notas y changelog publicados.
- No existe operación crítica incompatible con la actualización PWA.

## No significa terminado

- «La IA dice que está correcto».
- «Compila».
- «La pantalla muestra datos».
- «Funciona con un CSV».
- «No se ha observado el error otra vez».
- «Se ha rebajado el resultado esperado para que la prueba pase».
