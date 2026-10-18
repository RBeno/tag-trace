---
document_id: TT-TPL-PILOT-001
version: 0.1.0
status: template
last_updated: 2026-10-18
---

# Informe de aceptación del piloto (G6)

Lo rellena el propietario con datos reales, en sus dispositivos. **Se rellena en `local/`, fuera del
control de versiones**: este fichero del repositorio es solo la forma. No se copian al repositorio
cifras de planta, nombres de circuito, tags ni AGV. Lo que vuelve es la decisión y, si hace falta, los
informes de «Medir este dispositivo», que solo llevan datos sintéticos y del equipo.

## 1. Identificación

- Versión probada (cabecera de la aplicación y etiqueta `vX.Y.Z`):
- Fechas del piloto:
- Dispositivos y navegadores (OQ-173):
  - [ ] Samsung Galaxy S23 FE · Chrome · versión del navegador:
  - [ ] PC de referencia · Chrome o Edge · versión del navegador:
- Datos reales usados (sin valores; por ejemplo «exportación de 48 h del circuito priorizado»):

## 2. Antes de empezar

- [ ] La aplicación se abrió con red una vez y se instaló («Instalar aplicación»).
- [ ] Hay una copia `.agvproj` de cada circuito que ya estuviera en el dispositivo.
- [ ] «Espacio en este dispositivo» dice guardado persistente (si dice que no, anotarlo).

## 3. Medida del dispositivo

En cada dispositivo: Datos → «Medir este dispositivo» → «Medir los tres», con la pestaña a la vista, y
«Descargar el informe (JSON)». Adjuntar los dos informes.

| Métrica (presupuesto) | S23 FE | PC |
|---|---|---|
| Primer progreso visible (< 500 ms) | | |
| Hueco de fotograma p95 (< 50 ms), PERF-D2 / D3 / D4 | | |
| Pico de memoria PERF-D2 (≤ 250 MiB) / PERF-D3 (≤ 512 MiB) | | |
| Primera vista del replay PERF-D4 (< 2 s) | | |
| Paso del replay (≥ 20 fps) | | |
| Confirmación de cancelación (< 1 s) | | |

## 4. Piloto con datos reales (48 h, unos 40 AGV)

En cada dispositivo, con el circuito escrito:

- [ ] Importar la exportación real. Tiempo hasta ver el Resumen: ____ ; ¿la página respondió todo el rato?
- [ ] Revisar los hallazgos de rango 1 en la bandeja (confirmado / descartado / pospuesto).
- [ ] Consolidar la primera versión de la memoria, si el periodo es normal.
- [ ] Abrir un expediente sobre una incidencia conocida; ver retroceso, replay e hipótesis.
- [ ] Descargar el informe del expediente y el del circuito; abrirlos sin red.
- [ ] Exportar el `.agvproj`; abrirlo en el otro dispositivo o tras borrar el circuito, y comprobar que vuelve
      con la memoria y los expedientes.
- [ ] Cerrar y volver a abrir la aplicación sin red; lo guardado sigue.
- [ ] Si llega una versión nueva durante el piloto: el aviso aparece, no se activa con trabajo en curso y al
      cambiar no se pierde nada.

## 5. Criterio de rechazo (OQ-B05)

El piloto se **rechaza** si ocurre cualquiera de estas. Marcar y dar la evidencia sin valores de planta.

- [ ] (a) Un resultado que se sabe falso con los datos reales: una afirmación sin respaldo o un «sin
      determinar» convertido en certeza. Evidencia:
- [ ] (b) PERF-D2 a D4 por encima del presupuesto en el dispositivo sin desviación aceptada. Evidencia:
- [ ] (c) Pérdida de datos al actualizar, reabrir o restaurar una copia. Evidencia:
- [ ] (d) Cualquier petición a la red con datos de planta. Evidencia:
- [ ] (e) Un flujo esencial que no se pueda completar en el móvil. Evidencia:

## 6. Criterios de G6

| Criterio | Evidencia en el repositorio | Comprobado en el piloto |
|---|---|---|
| Flujos esenciales en PC y móvil físico | TC-366 (emulado) | [ ] §4 |
| PERF-D2–D4 dentro de presupuesto aprobado | Banco de medida, `PERFORMANCE_BUDGET.md` §3.2 | [ ] §3 |
| Accesibilidad esencial y errores recuperables | TC-368, TC-369 | [ ] |
| Pruebas de ausencia de red y datos reales | TC-370 | [ ] §4 sin red |
| Actualización PWA no interrumpe tareas críticas | TC-357–359 | [ ] §4 |
| GitHub Pages publica solo builds aprobadas | ADR-0014 | — |
| Release identificable, changelog y retorno verificados | `VERSIONING.md` §Publicación y retorno | [ ] un retorno real |
| Informe de aceptación del propietario | Este informe | [ ] |

## 7. Decisiones pendientes que entran en la aceptación

- OQ-176 (dependencias de desarrollo): [ ] se acepta el riesgo hasta ____ · [ ] subir Vitest antes de G6
- OQ-172 (cuándo se dice «correlaciona»): [ ] aplazada · [ ] decidida:

## 8. Decisión

- [ ] Aceptado: escribir `CONTINÚA FASE 7` y marcar G6.
- [ ] Rechazado por el criterio ____ de §5.
- [ ] Requiere cambios (sin rechazo):

Fecha y firma:
