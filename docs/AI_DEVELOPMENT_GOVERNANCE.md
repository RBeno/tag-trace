---
document_id: TT-AIGOV-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Gobierno del desarrollo realizado por IA

## 1. Modelo de responsabilidad

| Rol | Autoridad |
|---|---|
| Propietario del producto | Prioridad, alcance, reglas industriales, aceptación, fases y consolidación |
| IA implementadora | Analizar, proponer, programar, probar, documentar y explicar dentro del contrato |
| Automatización CI | Verificar de forma repetible los controles definidos |
| IA revisora opcional | Buscar defectos y contradicciones; no sustituye pruebas ni aceptación humana |

La IA que implementa no puede declarar aceptada su propia función, fase o release.

## 2. Unidad de trabajo

Toda tarea usa `templates/FEATURE_CONTRACT.md` y contiene:

- objetivo y valor;
- requisitos/reglas/ADR;
- entradas, salidas y estados de error;
- alcance y archivos permitidos;
- exclusiones explícitas;
- criterios de aceptación y diagnósticos prohibidos;
- privacidad y seguridad;
- presupuesto de recursos;
- migración/compatibilidad;
- entregables.

Sin contrato suficientemente preciso, la acción correcta es completar especificación, no programar.

## 3. Secuencia

1. **Lectura:** contexto mínimo y documentos específicos.
2. **Análisis:** contradicciones, riesgos, alternativas y preguntas.
3. **Plan:** pasos pequeños y archivos afectados, todavía sin código cuando se solicite revisión previa.
4. **Implementación:** rama independiente, cambio limitado.
5. **Verificación:** pruebas y mediciones definidas en el contrato.
6. **Autorrevisión:** diff, supuestos, limitaciones y riesgos.
7. **CI:** todas las puertas automáticas.
8. **Aceptación:** revisión humana de comportamiento cuando corresponda.
9. **Integración:** merge, changelog, versión y retorno.

## 4. Reglas contra deriva

- No cambiar varios subsistemas para «simplificar» sin autorización.
- No añadir backend, telemetría, IA en runtime o dependencia de red.
- No sustituir `unknown` por la hipótesis más probable.
- No introducir constantes industriales no versionadas.
- No copiar el prototipo anterior sin auditoría.
- No modificar fixtures/casos esperados solo para que el cambio pase.
- No posponer documentación hasta el final.

## 5. Memoria para la IA

La memoria duradera vive en Git:

- `PROJECT_MEMORY.md`: resumen operativo breve.
- `project_state.json`: estado legible por máquina.
- `REQUIREMENTS.md` y `RULE_CATALOG.md`: normas.
- `DECISIONS.md`/ADR: porqués.
- `TRACEABILITY_MATRIX.md`: cobertura.
- `CHANGELOG.md`: evolución.
- checkpoints: evidencia y aprobación.

Una conversación aporta contexto, pero todo cambio normativo se incorpora antes de terminar la tarea.

## 6. Pull requests futuras

- Una intención principal.
- Preferencia por cambios pequeños y revisables; si el tamaño crece, dividir por comportamiento, no por capas incompletas.
- Descripción de antes/después.
- Evidencia ejecutable y manual.
- Riesgos, incompatibilidades y retorno.
- Validación del propietario si cambia lenguaje, diagnóstico, consolidación o experiencia esencial.

## 7. Incertidumbre

La IA debe etiquetar claramente:

- hecho documentado;
- inferencia técnica;
- propuesta;
- hipótesis de dominio pendiente;
- decisión necesaria.

El objetivo no es eliminar preguntas, sino impedir que se transformen accidentalmente en código.
