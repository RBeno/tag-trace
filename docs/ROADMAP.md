---
document_id: TT-ROADMAP-001
version: 0.20.0
status: baseline-candidate
last_updated: 2026-10-19
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

### Orden de entregas (propietario, 2026-10-17)

1. **Actualización segura y versión identificable** (NFR-011, NFR-016, `UX_SPEC.md` §9): la versión nueva
   espera y avisa; no se activa durante importación, análisis, exportación o consolidación; caché por
   versión; cada publicación etiquetada, con su procedimiento de retorno. Va primera porque hoy el
   service worker activa la versión nueva en el acto. **Hecha en 3.82.0.**
2. **Banco de medida en la aplicación**: PERF-D2, D3 y D4 sintéticos generados en local, huecos de
   fotograma, memoria, primera vista del replay y reapertura, con un informe descargable. El
   propietario lo ejecuta en sus dispositivos (OQ-173). **Hecha en 3.83.0**; destapó que «Cancelar» no se
   atiende mientras se leen las filas (`PERFORMANCE_BUDGET.md` §3.2).
3. **Optimización y degradación por capacidad**, guiada por esa medida. **Hecha en 3.84.0** con las cifras del
   contenedor (lecturas por columnas; aviso por encima de lo medido); se revisa con los informes del
   propietario.
4. **Interfaz coherente de escritorio y móvil**. **Hecha en 3.85.0** (`UX_SPEC.md` §7); falta el móvil físico.
5. **Accesibilidad y estados de error completos**: WCAG 2.2 AA con axe-core en las pruebas (OQ-175) y una
   prueba por estado de `UX_SPEC.md` §8. **Hecha en 3.86.0**: 0 infracciones; sin espacio y borrar un circuito,
   que faltaban, hechos.
6. **Sin red y seguridad**: el flujo entero sin conexión y sin una sola petición fuera del origen; CSP,
   dependencias y revisión de seguridad. **Hecha en 3.87.0** (`SECURITY_PRIVACY.md` §9); queda la subida de
   Vitest (OQ-176).
7. **Manual de uso, guía de diagnóstico y operación**: matriz de navegadores y dispositivos, copia y
   restauración —con los expedientes en el `.agvproj` (OQ-174)— y criterios de soporte. **Hecha en 3.88.0**
   (`MANUAL_DE_USO.md`, `GUIA_DE_DIAGNOSTICO.md`, `OPERACION.md`).
8. **Piloto con datos reales**, del propietario, con la plantilla del informe de aceptación y el criterio de
   rechazo de OQ-B05. **Preparada en 3.88.1**: `templates/PILOT_ACCEPTANCE.md`, que se rellena en `local/`.
   Lo que queda es del propietario: publicar, medir, el piloto y la decisión.

Fuera de ese orden, por petición del propietario (2026-10-18): **gestor de análisis** (`UX_SPEC.md` §8.1,
FR-001). Al cargar se enseñan los análisis guardados para elegir uno y añadirle lecturas, y uno nuevo se
crea vacío o a partir de otro con sus listas y su flota. **Hecho en 3.89.0**; lo que queda (valores de planta
al copiar, configuración en el `.agvproj`, carpeta real, ver sin cargar fichero) espera OQ-177 y OQ-178.
Y (2026-10-19) **frente al periodo anterior**: cada periodo nuevo se compara con el anterior y sus hallazgos,
y el tag que sustituye a otro hereda lo declarado (R-DAT-024, R-GRA-023). **Hecho en 3.90.0**; OQ-179 abierta.

## F7 — Escalado controlado

- Validar varios circuitos sin compartir memoria accidentalmente.
- **Zonas compartidas entre circuitos** (cruces, semáforos y tramos comunes, R-GRA-012, R-GRA-013).
  Cada circuito sigue aislado; la zona es una vista aparte que lee de cada circuito solo sus pasadas
  por ella, en la intersección de coberturas, con un reloj común (R-DAT-018). Para que no choque con
  lo que ya existe, al abrirla hay que:
  - ~~descontar las transiciones entre tags compartidos en el agrupamiento por aristas exclusivas
    (`src/domain/cohort.ts`)~~: resuelto el 2026-09-25 (CHANGELOG [3.30.2]). Un circuito exige ahora
    aristas **y** tags propios, así que un tramo común ya no funde dos circuitos;
  - descontar los tags compartidos en la afinidad de una fuente (`src/domain/affinity.ts`), que supone
    que un tag es de un solo circuito. Como solo se comparten los de cruces y semáforos, el efecto es
    pequeño, pero la suposición deja de ser cierta;
  - no contar como «leyendo sin asignar» (R-AGV-015) al AGV de otro circuito que lee un tag
    compartido, si la exportación lo trae (OQ-127);
  - declarar los tramos físicos comunes, porque sus tags son independientes y no salen de cruzar
    listas, y la capacidad de cada espacio, que depende de la distancia al siguiente tag (OQ-128).
- Plantillas configurables de circuito y comparación agregada sin exponer datos.
- Evaluar modelos supervisados solo con etiquetas y métricas suficientes.
- Ejecutar candidato frente a algoritmo estable antes de promoverlo.

## F8 — Observación cercana a tiempo real

- Fuente continua read-only y buffer temporal.
- Separación física/lógica de cualquier red de control.
- Alarmas de apoyo, nunca órdenes automáticas.
- Reconciliación con histórico y replay determinista.

F8 requiere evaluación de ciberseguridad y autorización independientes; no está implícita en la aprobación del piloto.
