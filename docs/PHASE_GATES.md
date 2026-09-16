---
document_id: TT-GATES-001
version: 0.8.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Puertas de fase

## Evidencia común a todas las puertas

- Entregables identificados por commit/tag.
- Matriz de requisitos/reglas/pruebas actualizada.
- Demostración reproducible.
- Resultados automáticos y validación humana requerida.
- Presupuesto de recursos medido.
- Riesgos residuales y preguntas abiertas.
- Changelog y ADR actualizados.
- Procedimiento de retorno.

Una excepción necesita responsable, justificación, fecha límite y riesgo aceptado. No se acepta una frase genérica como «funciona».

## G0 — Autorizar F1

- [ ] Alcance, exclusiones y principios revisados.
- [ ] Reglas `accepted`, `candidate` y `configurable` correctamente clasificadas.
- [ ] Preguntas bloqueantes resueltas o convertidas en criterio explícito de F1.
- [ ] Fuente de lecturas disponible para prueba local, sin subirla al repositorio.
- [ ] Formato, encabezados y zona horaria de las lecturas identificados.
- [ ] Dispositivos de referencia definidos.
- [ ] Riesgo de datos y separación industrial aceptados.
- [ ] Checkpoint F0 firmado por el propietario.
- [ ] Aprobación literal registrada: `CONTINÚA FASE 1`.

**Qué se movió y por qué.** G0 exigía además los límites de zona, las calles CO, los puntos críticos
y las anclas de vuelta (OQ-B04), y el plan de aceptación completo de F1 a F5 (OQ-B05). Nada de eso
interviene en importar un fichero de lecturas: son insumos del grafo y del diagnóstico. Estaban
bloqueando el arranque sin usarse, así que pasan a G1 y G2, que es donde se necesitan. El propio G0
ya contemplaba esta salida al admitir preguntas «resueltas **o convertidas en criterio explícito de
F1**».

## G1 — Autorizar F2

- [ ] Plan de aceptación local de F1 acordado, con responsable de validación (OQ-B05, parte de F1).
- [ ] Circuitos aislados y afinidad funcionando.
- [ ] Importación correcta para delimitadores y esquemas acordados.
- [ ] Procedencia hasta fila original.
- [ ] Solapes, inválidos y cuarentena demostrados.
- [ ] Worker con progreso/cancelación sin carreras.
- [ ] Mismo input produce mismo resultado normalizado.
- [ ] `.agvproj` mínimo valida, exporta y reabre.
- [ ] PERF-D2 ejecutado en PC y móvil de referencia.

## G2 — Autorizar F3

- [ ] Límites de zona cargada y vacía, calles CO, puntos críticos y anclas de vuelta configurados
      y versionados (OQ-B04).
- [ ] Vueltas completas, parciales y desconocidas representadas.
- [ ] Grafos por AGV/vuelta y consenso con soporte.
- [ ] Vsystem y físico permanecen separados.
- [ ] Huecos no generan lecturas sintéticas.
- [ ] Replay básico determinista.
- [ ] Casos TC-001–TC-007 y TC-018 pasan.
- [ ] Evidencia navegable hasta fuente/fila.

## G3 — Autorizar F4

- [ ] Oportunidades y salud explicadas.
- [ ] Diagnóstico individual/grupal/colectivo validado.
- [ ] Calendario, pausas y takt versionados.
- [ ] FIFO cargado y reordenación vacía diferenciados.
- [ ] Cinco calles CO modeladas sin SOC.
- [ ] Puntos críticos y retroceso preliminar útiles.
- [ ] Falsos positivos y desconocidos medidos por categoría.

## G4 — Autorizar F5

- [ ] Consolidación solo humana y transaccional.
- [ ] vN permanece intacta al crear vN+1.
- [ ] Revocación y migración probadas.
- [ ] Incidencias excluidas del esperado.
- [ ] Crecimiento normal dentro del presupuesto o desviación aceptada.
- [ ] Reapertura y round-trip de `.agvproj`.
- [ ] Comparación histórica reproduce deltas correctos.

## G5 — Autorizar F6

- [ ] Incidencia reproducible con ventana antes/durante/después.
- [ ] Replay multi-AGV muestra incertidumbre.
- [ ] Similitud explica diferencias y no afirma causalidad.
- [ ] Contramedida y verificación se registran.
- [ ] Informe local contiene evidencia y versiones.
- [ ] Guardar/cerrar incidencia no altera memoria normal.

## G6 — Aprobar piloto

- [ ] Flujos esenciales en PC y móvil físico.
- [ ] PERF-D2–D4 dentro de presupuesto aprobado.
- [ ] Accesibilidad esencial y errores recuperables.
- [ ] Pruebas de ausencia de red y datos reales.
- [ ] Actualización PWA no interrumpe tareas críticas.
- [ ] GitHub Pages publica solo builds aprobadas.
- [ ] Release identificable, changelog y retorno verificados.
- [ ] Informe de aceptación del propietario.

## G7/G8

Requieren nuevos contratos y evaluación específica. G7 demuestra aislamiento de varios circuitos y, si existe ML, comparación en sombra. G8 exige además revisión independiente de ciberseguridad y garantía de separación read-only.
