---
document_id: TT-GATES-001
version: 0.13.0
status: baseline-candidate
last_updated: 2026-09-21
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

**Cerrada el 2026-09-17 por decisión del propietario** («Continúa Fase 2»), con tres criterios sin
cumplir que se declaran en lugar de darse por buenos. Marcar una casilla que no se ha demostrado
sería exactamente lo que `AI_DEVELOPMENT_GOVERNANCE.md` prohíbe: convertir una puerta en un trámite.

- [ ] Plan de aceptación local de F1 acordado, con responsable de validación (OQ-B05, parte de F1).
- [ ] Circuitos aislados y afinidad funcionando. **Parcial**: los circuitos están aislados y la
      acumulación es por circuito, pero la afinidad de ALG-003 no está implementada, así que nada
      impide hoy cargar en un circuito la exportación de otro.
- [x] Importación correcta para delimitadores y esquemas acordados.
- [x] Procedencia hasta fila original.
- [x] Solapes, inválidos y cuarentena demostrados.
- [x] Worker con progreso/cancelación sin carreras.
- [x] Mismo input produce mismo resultado normalizado.
- [x] `.agvproj` mínimo valida, exporta y reabre.
- [ ] PERF-D2 ejecutado en PC y móvil de referencia. **Parcial**: medido en PC y en móvil emulado;
      el Samsung Galaxy S23 FE solo puede medirlo el propietario, y lo emulado no lo sustituye.

Los tres pendientes no desaparecen al abrirse F2: pasan a G2 como deuda declarada, porque la
afinidad protege de mezclar circuitos —que es justo el error que R-DAT-012 documenta— y el móvil es
el dispositivo donde cayó el prototipo.

## G2 — Autorizar F3

**Cerrada el 2026-09-20 por decisión del propietario** («Continúa con Fase 3»), con dos criterios
sin cumplir que se declaran en lugar de marcarse. Es la misma salida que G1 y por la misma razón:
una casilla que no se ha demostrado no se marca, y ninguna IA cierra una puerta por su cuenta
(ADR-0010). Los dos pendientes pasan a G3 como deuda declarada.

- [ ] Límites de zona cargada y vacía, calles CO, puntos críticos y anclas de vuelta configurados
      y versionados (OQ-B04). **Sigue abierta**: SE2/4 es ahora el circuito priorizado, con dos
      hechos operativos aportados (punto de carga, descansos) pero sin tags exactos todavía.
- [x] Vueltas completas, parciales y desconocidas representadas. **Con matiz**: el ancla es
      inferida (ciclo dominante del cohorte, R-GRA-009), no declarada — nunca `observed` hasta que
      exista `lap_anchors`.
- [x] Grafos por AGV/vuelta y consenso con soporte.
- [x] Vsystem y físico permanecen separados. Contraste por alineación de secuencia implementado
      (`src/domain/vsystem.ts`); probado con una sustitución real detectada por posición.
- [x] Huecos no generan lecturas sintéticas.
- [x] Replay básico determinista. Fotogramas precalculados en el Worker; posición como fracción
      temporal, nunca física.
- [ ] Casos TC-001–TC-007 y TC-018 pasan. **Sin evaluar todavía**: son los casos de oro de F3
      (oportunidades, salud, divergencias), que necesitan las vueltas ya cerradas con ancla real.
- [x] Evidencia navegable hasta fuente/fila. Expediente de AGV y tag por identificador
      (`UX_SPEC.md` §4.1), con inactividad, vueltas y última lectura.

Los dos pendientes reales son de planta (OQ-B04) y de F3 (los casos de oro), no de código: los
cinco elementos programables de esta puerta están construidos, probados y en el producto.

**Lo que el paso por la puerta obliga a decir sobre F3.** El diagnóstico que F3 promete —salud,
oportunidades, perfiles por calendario, máquinas de estado de FIFO y de calles CO— necesita
denominadores y contexto que hoy no existen: sin OQ-B04 no hay oportunidad elegible, y sin
calendario no hay perfil esperado. Así que F3 se abre por la parte que **no** depende de planta:
las pruebas discriminantes que se sostienen solo con lo observado, con su incertidumbre declarada.
Lo que dependa de la configuración queda enunciado y sin calcular, nunca estimado con un supuesto.

## G3 — Autorizar F4

- [ ] Oportunidades y salud explicadas.
- [ ] Diagnóstico individual/grupal/colectivo validado.
- [ ] Calendario, pausas y takt versionados.
- [ ] FIFO cargado y reordenación vacía diferenciados.
- [ ] Cinco calles CO modeladas sin SOC.
- [ ] Puntos críticos y retroceso preliminar útiles.
- [ ] Falsos positivos y desconocidos medidos por categoría. **El mecanismo ya existe** desde el
      2026-09-21 (`tests/audit/`, con un circuito sintético de verdad plantada y un informe por
      clase de fallo), pero eso **no marca la casilla**: la marcarán las cifras que produzca, y hoy
      el informe declara dos clases sin detectar —rotura súbita y degradación progresiva— porque el
      producto calcula una sola tasa sobre toda la ventana.

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
- [x] GitHub Pages publica solo builds aprobadas. **Adelantado en F3 (2026-09-20)**: no es la
      aprobación del piloto, es la infraestructura que la hace posible. `deploy-pages.yml` llama a
      los tres workflows de verificación como *reusable workflows* y solo despliega si los tres
      terminan en verde (ADR-0014), sin repetir sus pasos. Se abrió ahora porque medir PERF-D2 en el
      dispositivo de referencia (Samsung Galaxy S23 FE) —deuda declarada desde G1— exige una URL
      real, y hasta hoy no existía ninguna.
- [ ] Release identificable, changelog y retorno verificados.
- [ ] Informe de aceptación del propietario.

## G7/G8

Requieren nuevos contratos y evaluación específica. G7 demuestra aislamiento de varios circuitos y, si existe ML, comparación en sombra. G8 exige además revisión independiente de ciberseguridad y garantía de separación read-only.
