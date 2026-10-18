# TAG TRACE

Una aplicación web que lee las exportaciones de lecturas de tags de un circuito de AGV y explica qué pasa en ese circuito —qué tags no se leen, qué vehículos leen peor, dónde se forman colas, dónde se pierde la WiFi y qué cambió— sin que ningún dato salga del dispositivo. En una página: [`docs/VISION_GENERAL.md`](docs/VISION_GENERAL.md).

> Estado actual: **Fase 6 — piloto profesional**, en curso. La aplicación se publica en <https://rbeno.github.io/tag-trace/>. La fase vigente la registra `docs/project_state.json`.

## Propósito

TAG TRACE debe responder con evidencia a cinco preguntas:

1. ¿Cómo es realmente el circuito y en qué difiere de la configuración teórica de Vsystem?
2. ¿Qué tags, AGV, lectores, tramos, zonas o sistemas de carga están empeorando?
3. ¿Qué ha cambiado desde los análisis consolidados anteriores?
4. ¿Qué ocurrió antes, durante y después de una incidencia?
5. ¿Qué observaciones, inferencias y reglas sustentan cada conclusión?

El principio central es **diagnosticar desviaciones respecto al comportamiento topológico, temporal y colectivo conocido**, no interpretar una lectura aislada.

## Límites innegociables

- Aplicación observacional: nunca envía órdenes ni utiliza acciones `START`, `STOP` o `RESET`.
- Procesamiento local en el navegador; no hay backend para datos industriales.
- GitHub contiene código, documentación y datos sintéticos, nunca CSV, proyectos, informes, grafos o configuraciones reales.
- Las observaciones, inferencias, expectativas e incógnitas permanecen diferenciadas.
- La consolidación es humana, explícita, versionada y auditable.
- Las incidencias se conservan en un historial separado y no alteran por sí mismas la memoria normal.
- No se usa SOC o nivel de batería como fuente diagnóstica porque no existe una señal fiable disponible.
- Primero reglas explicables y replay determinista; modelos aprendidos solo después de demostrar valor y control.

## Por dónde empezar

- **Si usas la aplicación**: [Manual de uso](docs/MANUAL_DE_USO.md), [Guía de diagnóstico](docs/GUIA_DE_DIAGNOSTICO.md) y [Operación](docs/OPERACION.md).
- **Si decides** (propietario): [Visión general](docs/VISION_GENERAL.md) §Qué le queda, [Puertas de fase](docs/PHASE_GATES.md) §G6 y las preguntas marcadas «Pendiente del propietario» en [Preguntas abiertas](docs/OPEN_QUESTIONS.md).
- **Si desarrollas**: [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md) y el [índice de contexto](docs/CONTEXT_INDEX.md), que dice qué leer según la tarea. La última revisión completa del código y la documentación está en [`docs/REVISION_2026-10-18.md`](docs/REVISION_2026-10-18.md).

## Navegación documental

El [índice de contexto](docs/CONTEXT_INDEX.md) indica qué leer según el tipo de tarea.

**Qué se construye y por qué**

- [Carta del proyecto](docs/PROJECT_CHARTER.md)
- [Requisitos](docs/REQUIREMENTS.md)
- [Modelo de dominio](docs/DOMAIN_MODEL.md)
- [Glosario controlado](docs/GLOSSARY.md)
- [Reglas industriales](docs/RULE_CATALOG.md)

**Cómo se construye**

- [Arquitectura](docs/ARCHITECTURE.md)
- [Protocolo de Workers](docs/WORKER_PROTOCOL.md)
- [Algoritmos](docs/ALGORITHM_CATALOG.md)
- [Datos y procedencia](docs/DATA_CONTRACTS.md)
- [Configuración de circuito](docs/CONFIG_SCHEMA.md)
- [Memoria y consolidación](docs/MEMORY_CONSOLIDATION.md)
- [Incidencias e informes](docs/INCIDENTS_REPORTING.md)
- [Experiencia de usuario](docs/UX_SPEC.md)

**Cómo se usa**

- [Manual de uso](docs/MANUAL_DE_USO.md)
- [Guía de diagnóstico](docs/GUIA_DE_DIAGNOSTICO.md)
- [Operación, recuperación y soporte](docs/OPERACION.md)

**Cómo se verifica**

- [Estrategia de pruebas](docs/TEST_STRATEGY.md)
- [Rendimiento](docs/PERFORMANCE_BUDGET.md)
- [Seguridad y privacidad](docs/SECURITY_PRIVACY.md)
- [Definición de terminado](docs/DEFINITION_OF_DONE.md)
- [Matriz de trazabilidad](docs/TRACEABILITY_MATRIX.md)

**Cómo se gobierna**

- [Etapas y entregables](docs/ROADMAP.md)
- [Puertas de fase](docs/PHASE_GATES.md)
- [Decisiones](docs/DECISIONS.md)
- [Desarrollo con IA](docs/AI_DEVELOPMENT_GOVERNANCE.md)
- [Memoria del proyecto](docs/PROJECT_MEMORY.md)
- [Registro de riesgos](docs/RISK_REGISTER.md)
- [Preguntas abiertas](docs/OPEN_QUESTIONS.md)
- [Versionado](docs/VERSIONING.md)

## Versionado

El producto, los algoritmos, el formato `.agvproj`, las configuraciones de circuito y la documentación se versionan de forma independiente. Las reglas completas están en [VERSIONING.md](docs/VERSIONING.md).

## Relación con el prototipo anterior

`RBeno/tag-trace-agv` se conserva como referencia funcional. Ningún componente pasa al nuevo producto sin revisión, prueba y decisión explícita. Véase [LEGACY_ASSESSMENT.md](docs/LEGACY_ASSESSMENT.md).

## Privacidad del repositorio

Este repositorio es **público** y contiene únicamente código, documentación y fixtures sintéticos
(ADR-0014). Ningún dato industrial real entra aquí, ni siquiera anonimizado: la estructura de un
CSV de planta sigue revelando topología, horarios y capacidad.

La regla no depende de la buena voluntad. Un guardián en integración continua y un hook local
rechazan las extensiones prohibidas y los ficheros sospechosos antes de que lleguen a GitHub. Para
instalar el hook en tu copia:

```bash
git config core.hooksPath .githooks
```

Los datos de planta —CSV, proyectos `.agvproj`, informes, grafos y configuraciones reales— se
quedan en el dispositivo del usuario.
