---
document_id: TT-CHECKPOINT-F0-001
checkpoint: F0-G0
version: 0.3.0
status: approved
last_updated: 2026-09-17
---

# Checkpoint F0 — candidata documental

## Entregables presentes

- [x] Carta, glosario y memoria compacta.
- [x] Requisitos, modelo de dominio, datos y reglas.
- [x] Arquitectura, algoritmos, consolidación e incidencias.
- [x] UX, privacidad, rendimiento y pruebas.
- [x] Roadmap, puertas, definición de terminado y trazabilidad.
- [x] Riesgos, preguntas abiertas, ADR y plantillas de IA.
- [x] Política de repositorio nuevo y tratamiento del prototipo anterior.
- [x] Contrato del protocolo Worker↔UI y contrato de configuración de circuito.
- [x] ADR-0012 a ADR-0014: contenedor `.agvproj`, tiempo canónico y repositorio público.
- [x] Andamiaje de gobierno ejecutable con guardianes bloqueantes en local y en CI.

## Estado

La estructura documental está creada como `baseline-candidate`. No equivale a aprobación funcional ni autoriza programación.

## Corregido en esta revisión

Auditoría de la línea base 0.1.0 y del prototipo `RBeno/tag-trace-agv`. Se cerraron seis
bloqueantes y diecisiete contradicciones o lagunas: ausencia de automatización, `AGENTS.md` no
cargado por la herramienta, control de datos solo declarativo, contradicción entre la CSP exigida y
lo que GitHub Pages permite, vía de publicación sin resolver y ausencia de contrato de Workers.
El detalle está en el changelog.

## Pendiente para G0

- Responder OQ-B01–OQ-B05: formatos reales de las fuentes, zona horaria y cambio horario,
  dispositivos de referencia, límites de zona y calles CO, y plan de aceptación con datos locales.
  Ninguna admite deducción: requieren información de planta.
- Decidir OQ-B07, la licencia del repositorio, antes de abrirlo.
- Abrir el repositorio siguiendo el orden de ADR-0014: guardián operativo, hook instalado, revisión
  del árbol, cambio de visibilidad y activación de Pages.
- Revisión del propietario del producto.
- Registrar el commit y el tag `docs-v0.2.0`.
- Cambiar este checkpoint a `approved` y actualizar `project_state.json` solo después de la frase `CONTINÚA FASE 1`.

## Decisión

- [x] Aprobado
- [ ] Requiere cambios
- [ ] Rechazado

**Frase del propietario, literal:** «Continúa con Fase 1». Fecha: 2026-09-17.

Se registra tal como se escribió. La frase canónica prevista era `CONTINÚA FASE 1`; la recibida no
coincide carácter a carácter, pero llegó como respuesta directa a la petición de la frase de
transición y su intención es inequívoca. Se deja constancia de la diferencia en lugar de normalizar
el texto, porque un registro de aprobación que corrige lo que dijo la persona deja de ser un
registro.

**Estado resultante:** fase F1, línea base `approved`, `implementationStarted: true`.

**Pendiente que no bloquea F1:** el comportamiento del cambio horario estacional (OQ-B02 parcial),
que necesita una exportación que cruce octubre o marzo.
