---
document_id: TT-ROADMAP-001
version: 0.9.0
status: baseline-candidate
last_updated: 2026-09-23
---

# Etapas, entregables y resultados

## Principio

Cada fase produce una capacidad vertical verificable y un paquete de evidencia. No se avanza por porcentaje de código, sino cuando la puerta de fase demuestra que el resultado es correcto, explicable, usable y compatible con los recursos disponibles.

## Resumen

| Fase | Objetivo | Producto formalizado | Puerta |
|---|---|---|---|
| F0 | Definir el producto y su gobierno | Línea base documental | G0 |
| F1 | Crear una base local fiable | PWA, circuito, importación y proyecto mínimo | G1 |
| F2 | Reconstruir el circuito real | Secuencias, vueltas, grafos y replay básico | G2 |
| F3 | Diagnosticar comportamiento | Oportunidades, salud, divergencias, flujo, CO y críticos | G3 |
| F4 | Conservar evolución eficiente | Memoria compacta, comparación y consolidación | G4 |
| F5 | Investigar fallos | Expedientes, retroceso, replay completo e informes | G5 |
| F6 | Convertirlo en piloto profesional | UX final, rendimiento, seguridad, Pages y recuperación | G6 |
| F7 | Escalar el modelo | Varios circuitos validados y aprendizaje supervisado opcional | G7 |
| F8 | Evolución futura read-only | Ingesta cercana a tiempo real separada del control | G8 |

## F0 — Definición y gobierno

### Se crea

- Carta, glosario, requisitos, reglas, datos y modelo de dominio.
- Arquitectura, algoritmos, UX, seguridad, rendimiento y pruebas.
- Modelo de memoria/consolidación e incidencias.
- Roadmap, puertas, trazabilidad, riesgos y preguntas abiertas.
- ADR, plantillas para trabajo con IA, memoria compacta y estado de proyecto.
- Evaluación del prototipo anterior como referencia, sin migrar código.
- Contrato del protocolo Worker↔UI y contrato de configuración de circuito.
- Andamiaje de gobierno ejecutable: `CLAUDE.md`, esquema del estado de proyecto, guardián de datos
  y verificación documental, en local mediante hook y en integración continua.

### Se formaliza

- Autoridad del propietario del producto.
- Estados de verdad y límites de inferencia.
- Política local-only y exclusiones industriales.
- Criterios para comenzar F1.

### Salida

Tag documental `docs-v0.2.0`, checkpoint F0 firmado y aprobación explícita `CONTINÚA FASE 1`.

### F1a·0 — Importador mínimo

El primer entregable ejecutable, y deliberadamente más pequeño que F1a: cargar un fichero de
lecturas, procesarlo **dentro del Worker** con progreso y cancelación, normalizarlo conservando
procedencia, y mostrar la tabla con navegación hasta la fila de origen.

Sin `.agvproj`, sin PWA, sin persistencia, sin salud. El objetivo no es cerrar una puerta: es poner
el protocolo de Workers y el contrato de importación frente a datos reales cuanto antes, que es lo
único que ha demostrado encontrar errores en este proyecto.

Sale con TC-019, TC-020 e INV-002 en verde, y con el perfil que demuestra que no hay parseo en el
hilo principal.

### F1a — Esqueleto vertical antes de F1 completa

F1 se abre con un recorrido único extremo a extremo que valida la plataforma antes de invertir en
diagnóstico: crear circuito, cargar un CSV sintético, parsear dentro del Worker con progreso y
cancelación, normalizar conservando procedencia, navegar hasta la fila origen, exportar `.agvproj`
y reabrirlo con hash semántico idéntico. Sale con los criterios de aceptación de
`WORKER_PROTOCOL.md` §7, los casos TC-015, TC-019 y TC-020, los invariantes INV-001 a INV-006,
INV-010 e INV-011, y PERF-D2 medido en los dispositivos de referencia.

## F1 — Base local e ingesta confiable

### Se crea

- Proyecto TypeScript estricto y PWA mínima.
- Núcleo de dominio sin dependencia de UI.
- Gestor local de circuitos aislados.
- Importador incremental en Worker con progreso/cancelación.
- Mapeo y previsualización de CSV/TSV/TXT.
- Normalización, cuarentena, deduplicación, procedencia y afinidad de circuito.
- Manifiesto y primer esquema de `.agvproj`.
- Fixtures sintéticos y CI inicial.

### Se formaliza

- Contratos técnicos, errores recuperables, límites de archivo y primera línea base de rendimiento.
- Dispositivos/navegadores de referencia.

### Salida demostrable

Importar un escenario sintético de 100.000 filas y el caso real de aceptación solo en local, explicar filas válidas/inválidas, cancelar sin corrupción y reabrir el proyecto base.

### No se incluye

Diagnósticos complejos, consolidación definitiva o rediseño visual completo.

## F2 — Grafo físico y replay básico

### Se crea

- Segmentación por AGV, sesión y vuelta con confianza.
- Grafo observado por AGV/vuelta.
- Consenso físico con rutas alternativas.
- Comparador Vsystem/plano frente a observado.
- Tiempos robustos por transición, acotados a las transiciones cuyo intervalo supera la resolución
  de la fuente; por debajo de ella la secuencia es `observed` y el tiempo `unknown`.
- Replay básico observado/inferido/desconocido.
- Expediente reducido de AGV y de tag: búsqueda por identificador, recuentos frente a la cohorte,
  periodos de inactividad, última lectura conocida e instante de cambio. Sin tasa de salud, que
  llega en F3 con las oportunidades.

### Se formaliza

- Criterios de vuelta, soporte, dirección, arista válida y divergencia topológica.
- Hash semántico y replay determinista.

### Salida demostrable

Reconstruir los casos de oro topológicos sin inventar eventos y navegar hasta la fila origen.

## F3 — Diagnóstico explicable

### Se crea

- Motor de oportunidades y huecos censurados.
- Salud por tag, AGV, tramo y circuito.
- Comparación individual, cohorte, colectiva e histórica.
- Perfiles por calendario/contexto.
- Máquinas de estado de FIFO y de las calles CO configuradas; fixture sintético de cinco calles.
- Análisis de puntos críticos, saturación y alimentación.
- Resumen priorizado: conclusión → evidencia → bruto.

### Se formaliza

- Fórmulas, parámetros, tamaños mínimos de muestra y confianza.
- Categorías de diagnóstico y comprobaciones discriminantes.

### Salida demostrable

Separar correctamente, en casos validados, hipótesis de tag, AGV, lector, comunicación, configuración, ruta y proceso, mostrando incertidumbre.

## F4 — Memoria longitudinal y consolidación

### Se crea

- Estructura compacta de grafo/perfiles/deltas.
- Comparador entre versiones consolidadas.
- Revisión y previsualización de consolidación.
- Botón de confirmación humana.
- Registro append-only, revocación y migraciones.
- `.agvproj` completo con integridad y reapertura.

### Se formaliza

- Qué entra/no entra en memoria.
- Tratamiento de deriva y cambios reales.
- Política de retención y presupuesto de crecimiento.

### Salida demostrable

Consolidar un periodo normal crea vN+1 sin alterar vN; un periodo de incidencia queda excluido; la memoria aumenta sustancialmente menos que el bruto.

## F5 — Laboratorio de incidencias

### Se crea

- Creación desde síntoma, intervalo o hallazgo.
- Retroceso temporal/topológico.
- Replay multi-AGV con esperado e incertidumbre.
- Biblioteca de casos y similitud explicada.
- Informe vivo y exportación local.
- Contramedidas y verificación antes/después.

### Se formaliza

- Ciclo de vida del expediente.
- Lenguaje de causalidad/correlación.
- Evidencia mínima reproducible y separación de memoria normal.

### Salida demostrable

Investigar una ausencia de diez minutos en un punto crítico y conservar el caso completo sin modificar el esperado.

## F6 — Piloto profesional

### Se crea

- Interfaz coherente de escritorio/móvil.
- Accesibilidad esencial y estados de error completos.
- Optimización y degradación controlada por capacidad.
- Suite E2E, rendimiento y seguridad.
- Publicación automatizada en GitHub Pages.
- Actualización PWA segura, versionado y retorno.
- Manual de uso y guía de diagnóstico.

### Se formaliza

- Presupuestos finales de tiempo/RAM/almacenamiento.
- Matriz de navegadores/dispositivos.
- Operación, recuperación y criterios de soporte.

### Salida demostrable

Piloto estable con datos reales procesados localmente, 48 h/40 AGV, memoria portable e informe de aceptación.

## F7 — Escalado controlado

- Validar varios circuitos sin compartir memoria accidentalmente.
- **Zonas compartidas entre circuitos** (cruces y tramos comunes, R-GRA-012, R-GRA-013). Cada
  circuito sigue aislado; la zona es una vista aparte que lee de cada circuito solo sus pasadas por
  los tags compartidos, en la intersección de coberturas, con un reloj común (R-DAT-018). Para que no
  choque con lo que ya existe, al abrirla hay que:
  - descontar los tags compartidos en la afinidad de una fuente (`src/domain/affinity.ts` supone hoy
    que un tag es de un solo circuito);
  - descontar las transiciones por tags compartidos en el agrupamiento por aristas exclusivas
    (`src/domain/cohort.ts`): una sola transición común basta hoy para fundir dos circuitos en un
    cohorte;
  - no contar como «leyendo sin asignar» (R-AGV-015) al AGV de otro circuito que pasa por la zona
    compartida, si la exportación lo trae (OQ-127).
- Plantillas configurables de circuito y comparación agregada sin exponer datos.
- Evaluar modelos supervisados solo con etiquetas y métricas suficientes.
- Ejecutar candidato frente a algoritmo estable antes de promoverlo.

## F8 — Observación cercana a tiempo real

- Fuente continua read-only y buffer temporal.
- Separación física/lógica de cualquier red de control.
- Alarmas de apoyo, nunca órdenes automáticas.
- Reconciliación con histórico y replay determinista.

F8 requiere evaluación de ciberseguridad y autorización independientes; no está implícita en la aprobación del piloto.
