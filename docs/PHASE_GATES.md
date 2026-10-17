---
document_id: TT-GATES-001
version: 0.33.0
status: baseline-candidate
last_updated: 2026-10-17
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
- [x] Vueltas completas, parciales y desconocidas representadas. El mecanismo de ancla declarada
      (`lap_anchors`, R-GRA-009) ya existe: una vuelta `completa` sale `observed` cuando hay una
      ancla declarada y resuelta contra el ciclo, `inferred` cuando no la hay; una `parcial` sigue
      `inferred` siempre, porque uno de sus extremos es un corte de los datos. **Con matiz**: sin
      valores de planta (OQ-B04 sigue abierta), lo que hay hoy es el mecanismo, no anclas reales.
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
- [ ] Diagnóstico individual/grupal/colectivo validado. **Con matiz**: el componente histórico de
      ALG-009 —comparación entre el primer y el último periodo de cobertura, R-DAT-016, R-AGV-013—
      ya está implementado y probado (`src/domain/drift.ts`). El individual/grupal/colectivo contra
      lo esperado sigue pendiente de oportunidad elegible (OQ-B04, OQ-120) y calendario (OQ-108).
- [ ] Calendario, pausas y takt versionados.
- [ ] FIFO cargado y reordenación vacía diferenciados. **Modelado**: el FIFO cargado se detecta como
      inversión de orden dentro de los tramos contiguos de zona cargada del anillo —derivados del
      anillo y la lista `zona`, no configurados aparte—, con un margen mínimo dual (absoluto y
      proporcional al tránsito mediano del propio tramo) para no confundir el jitter normal de
      lectura con un adelantamiento real. **Sin marcar**: son candidatos, no averías confirmadas —
      OQ-107 sigue sin el catálogo de excepciones legítimas (carga online, maniobra manual,
      excepción documentada), así que no se puede cerrar la puerta.
- [ ] Cinco calles CO modeladas sin SOC. **Modeladas** (R-CO-001/002/003/006/007/008: estancias,
      arranque en frío, salida fuera de antigüedad y calle sin servicio), y sin SOC, que R-CO-004
      excluye. **Sin marcar** porque solo se han ejercitado contra el circuito sintético de
      auditoría: los valores de planta de OQ-B04 y OQ-124 siguen sin llegar.
- [ ] Puntos críticos y retroceso preliminar útiles.
- [ ] Falsos positivos y desconocidos medidos por categoría. El mecanismo existe desde el
      2026-09-20 (`tests/audit/`, con un circuito sintético de verdad plantada y un informe por
      clase de fallo). **Sigue sin marcarse**, no por falta de mecanismo sino por alcance: solo
      cubre las clases de fallo ya identificadas en el sintético (14 de 14 detectadas al
      2026-09-21, cero falsos positivos, `DEUDA_CONOCIDA` vacía), no todavía las de OQ-B04.
      Con datos de planta, la medida sale de la **revisión en campo** (`UX_SPEC.md` §4.3): cada
      hallazgo confirmado o descartado en el punto es un acierto o un falso positivo de su clase, y
      el CSV exportado da el recuento.

## G4 — Autorizar F5

Marcado por el propietario el 2026-09-27 («pasa a Fase 5»), tras fusionar el PR #12 (3.50.0–3.62.0,
commit `551d4cd`), que reúne la evidencia de los siete criterios.

- [x] Consolidación solo humana y transaccional. **Evidencia (3.51.0, 3.61.0)**: el Worker solo escribe con
      `consolidate` en modo `commit`, que la interfaz envía desde «Confirmar y consolidar», y vuelve a
      calcular la previsualización desde el almacén antes de escribir; versión y estado de linaje van
      en una transacción (TC-283, TC-286). Desde 3.61.0 la confirmación lleva la huella de la
      previsualización y `saveMemory` rechaza si el linaje guardado cambió mientras se preparaba la
      escritura (TC-315).
- [x] vN permanece intacta al crear vN+1. **Evidencia**: almacén por `[circuitId, hash]`, cadena de
      hashes y prueba de que revocar no muta la original ni cambia su hash (TC-283).
- [x] Revocación y migración probadas. **Evidencia**: revocación en unitaria y navegador (TC-283,
      TC-286); migración del almacén 6→7 y lectura de `.agvproj` 1, 2 y 3 (TC-285). La migración
      en el navegador desde una base de la versión 5 hasta la 10, con las tablas de memoria (TC-280).
      Desde 3.61.0 cada versión que llega vuelve a dar su hash y cada linaje encadena; un linaje con
      dos versiones del mismo número se rechaza (TC-307, TC-319).
- [x] Incidencias excluidas del esperado. **Evidencia (3.55.0)**: un hallazgo grave confirmado se guarda como incidencia de la versión y lo que toca conserva en el esperado su valor anterior (R-INC-004, TC-293, TC-294). Desde 3.57.0 también los hallazgos graves con instante, con su ventana (OQ-149, TC-298, TC-300). Desde 3.62.0 la medida de una incidencia tampoco cuenta hacia sostenido (TC-320).
- [x] Crecimiento normal dentro del presupuesto o desviación aceptada. **Evidencia (3.54.1, 3.55.0)**: medido con cuatro periodos del circuito de auditoría; el propietario aceptó el 5 % sobre el CSV con versiones comprimidas, que ocupan menos del 1 % (OQ-145, TC-292, TC-295).
- [x] Reapertura y round-trip de `.agvproj`. **Evidencia**: ida y vuelta con memoria y relación «idéntica»; adopción en almacén vacío (TC-285, TC-286). La bifurcación solo tiene prueba unitaria (TC-284). Desde 3.61.0 un linaje archivado viaja aparte del activo y no finge una bifurcación (TC-306).
- [x] Comparación histórica reproduce deltas correctos. **Evidencia (3.53.0, 3.56.0)**: con plano, un tag instalado sin leer ya no sale como «desaparece» sino «sin leer en su ubicación», y las estadísticas de dos periodos se combinan igual que medidas juntas (TC-288, TC-290). El comparador entre dos versiones cualesquiera y la prueba de oro de seis periodos con cambios plantados dan exactamente lo adoptado (TC-296, TC-297).

## G5 — Autorizar F6

Evidencia redactada el 2026-10-17, con las seis entregas de ADR-0018 hechas (3.74.0 a 3.80.0, rama
`ccr-b6e42985-mfx1ho`, commit `9baba66`; en `main` con el PR #17, `b0f527a`). **Aprobada por el
propietario el 2026-10-17 con `CONTINÚA FASE 6`**: las casillas se marcan por esa orden. Toda la evidencia es
sintética; la validación con datos reales en su dispositivo y el criterio de rechazo siguen pendientes
(OQ-B05). La salida demostrable de F5 —investigar una ausencia de diez minutos en un punto crítico y
conservar el caso completo sin modificar el esperado— es el caso de oro TC-012
(`docs/golden/TC-012-punto-critico-sin-llegada.md`, escenario `tests/support/caso-punto-critico.ts`).

- [x] Incidencia reproducible con ventana antes/durante/después. **Evidencia (3.74.0, 3.75.0)**: el
      expediente congela su recorte (`recorte-2`: lecturas, eventos de conexión y contexto del esperado)
      con su hash, en una cadena de revisiones que no se reescribe, y propone márgenes antes y después
      desde configuración (TC-338). El recorte sale también de un original archivado cuando las
      lecturas ya no están retenidas (TC-341). El retroceso desde el síntoma (ALG-015 `retroceso-1`)
      ordena cada hecho en antes, durante o después: en TC-012 encuentra el último paso por `71018`, la
      primera desviación de `205` entre `71012` y `71013` a seis tags y el corte de WiFi de `207` con su
      fila, todo `precede` y nada más (TC-342, TC-343); en el navegador, de punta a punta frente al
      esperado de la versión consolidada v1 (TC-344).
- [x] Replay multi-AGV muestra incertidumbre. **Evidencia (3.77.0)**: ALG-016 `replay-caso-1` sobre el
      recorte congelado, 200 fotogramas con su fase; cada AGV visto en un tag, entre dos tags como
      fracción de tiempo (inferido) o sin lecturas (desconocido); la banda esperada desde su última
      lectura, con el paso lento (p95) y el habitual (p50) de cada tramo, y «va por detrás incluso del
      paso lento» solo mientras está parado; la conexión según el registro o «sin registro» (TC-347,
      TC-348). Medido: 54.000 lecturas de 40 AGV en unos 0,13 s.
- [x] Similitud explica diferencias y no afirma causalidad. **Evidencia (3.80.0)**: ALG-017
      `similitud-1` compara con los demás expedientes del circuito, sin descartados, característica a
      característica (igual, parecido con su diferencia, distinto, sin dato), ordena por cuántas
      coinciden con el mismo peso y sin puntuación oculta; lo confirmado en otro caso va aparte como «no
      es evidencia para este» y no cambia el actual; un hecho repetido se cuenta sin llamarlo
      correlación (TC-355, TC-356). Ningún texto generado pasa la prueba de vocabulario causal
      (`causalWordsIn`, TC-339). Abierto, sin bloquear: cuándo se dice `correlaciona` (OQ-172).
- [x] Contramedida y verificación se registran. **Evidencia (3.78.0)**: hipótesis desde la cronología
      con la evidencia en contra observada y la comprobación que las separa; la confirma o descarta una
      persona, con su comprobación o su razón (TC-349). Contramedida con la métrica del síntoma y su
      fecha de aplicación; verificación (ALG-024 `verificacion-1`) una semana antes y otra después, en
      tiempo de producción y sin las ventanas de otros expedientes, con prueba binomial y propuesta
      eficaz, parcial, ineficaz o sin exposición; la conclusión la escribe una persona (TC-350 a TC-352).
- [x] Informe local contiene evidencia y versiones. **Evidencia (3.79.0, 3.80.0)**: un HTML
      autocontenido, sin red ni scripts, con los diez apartados de `INCIDENTS_REPORTING.md` §8, la
      revisión y su hash, los procedimientos (`recorte-2`, `retroceso-1`…), la versión de memoria, de
      configuración y de la aplicación, y lo escrito por una persona marcado como suyo; CSV de la
      cronología y de las lecturas del recorte con fichero, huella y fila; el informe del circuito trae
      el resumen de expedientes (TC-353, TC-354).
- [x] Guardar/cerrar incidencia no altera memoria normal. **Evidencia (3.74.0, 3.76.0)**: INV-008 y
      TC-017. En el navegador, crear, anotar, revisar, investigar, cerrar no concluyente, reabrir y
      descartar dejan el resto del almacén byte a byte igual (TC-340); lo mismo al ver el replay, decidir
      hipótesis, registrar contramedidas y verificaciones, exportar y comparar casos (TC-348, TC-352,
      TC-354, TC-356). La ventana de un expediente solo entra en la memoria como incidencia excluida si
      la persona la deja marcada al consolidar (D5, TC-345, TC-346).

El propietario dio la orden sin dejar escrito el resultado de la validación con datos reales ni el
criterio de rechazo: OQ-B05 sigue parcial y pasa a G6, cuya salida es el piloto con datos reales.
OQ-172 sigue abierta y no bloquea. F5 queda cerrada.

## G6 — Aprobar piloto

Criterio de rechazo (OQ-B05, propietario 2026-10-17): el piloto se rechaza si ocurre cualquiera de estas: (a) un resultado que el propietario sabe falso con los datos reales —una afirmación sin respaldo o un `unknown` convertido en certeza—; (b) PERF-D2 a D4 por encima del presupuesto en su dispositivo sin desviación aceptada; (c) pérdida de datos al actualizar, reabrir o restaurar una copia; (d) cualquier petición a la red con datos de planta; (e) un flujo esencial que no se pueda completar en el móvil. Dispositivos y navegadores: OQ-173.

- [ ] Flujos esenciales en PC y móvil físico. **Evidencia parcial (3.85.0)**: las siete pestañas, con el
      circuito de auditoría, sin desbordes y con objetivos de 44 px con dedo a 360 × 780 táctil y a 1.366 ×
      768 (TC-366). Emulado: falta el S23 FE físico.
- [ ] PERF-D2–D4 dentro de presupuesto aprobado. **Instrumento (3.83.0)**: «Medir este dispositivo» en la
      pestaña Datos mide los tres y descarga el informe (`PERFORMANCE_BUDGET.md` §3.2). Falta la medida del
      propietario en Chrome del S23 FE y del PC de referencia (OQ-173). La cancelación, que en 3.83.0 no se
      atendía, se confirma en 501 ms desde 3.83.1 (TC-362). Desde 3.84.0 el peor hueco de fotograma baja
      de 1,3 s a ~0,1 s en PERF-D3 y D4 (`PERFORMANCE_BUDGET.md` §3.2).
- [ ] Accesibilidad esencial y errores recuperables. **Evidencia (3.86.0)**: axe-core sin infracciones WCAG 2.2
      AA en las siete pestañas, en claro y oscuro, y en lo que se abre encima; teclado y foco visible
      (TC-369). Cada estado de `UX_SPEC.md` §8 con su prueba, incluidos sin espacio y borrar un circuito
      (TC-368). Falta una revisión con lector de pantalla en el dispositivo.
- [ ] Pruebas de ausencia de red y datos reales.
- [ ] Actualización PWA no interrumpe tareas críticas. **Evidencia (3.82.0)**: la versión nueva queda en
      espera y la activa la persona, nunca con una importación, análisis, exportación o consolidación en
      curso, ni en otra pestaña (TC-357, TC-359). Falta probarla en el móvil físico.
- [x] GitHub Pages publica solo builds aprobadas. **Adelantado en F3 (2026-09-20)**: no es la
      aprobación del piloto, es la infraestructura que la hace posible. `deploy-pages.yml` llama a
      los tres workflows de verificación como *reusable workflows* y solo despliega si los tres
      terminan en verde (ADR-0014), sin repetir sus pasos. Se abrió ahora porque medir PERF-D2 en el
      dispositivo de referencia (Samsung Galaxy S23 FE) —deuda declarada desde G1— exige una URL
      real, y hasta hoy no existía ninguna.
- [ ] Release identificable, changelog y retorno verificados. **Evidencia parcial (3.82.0)**: versión en la
      cabecera, en la caché y en la etiqueta `vX.Y.Z` que deja cada publicación; retorno desde el workflow
      eligiendo la etiqueta (`VERSIONING.md` §Publicación y retorno). Falta ejecutar un retorno de verdad
      cuando haya dos versiones etiquetadas.
- [ ] Informe de aceptación del propietario.

## G7/G8

Requieren nuevos contratos y evaluación específica. G7 demuestra aislamiento de varios circuitos y, si existe ML, comparación en sombra. G8 exige además revisión independiente de ciberseguridad y garantía de separación read-only.
