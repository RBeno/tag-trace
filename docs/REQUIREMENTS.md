---
document_id: TT-REQ-001
version: 0.2.0
status: baseline-candidate
last_updated: 2026-09-16
---

# Requisitos

Las expresiones **debe**, **no debe** y **solo** son normativas. Cada requisito mantiene un ID estable; si cambia su significado se registra la modificación y, cuando corresponda, un ADR.

## Requisitos funcionales

| ID | Requisito | Prioridad | Fase |
|---|---|---:|---:|
| FR-001 | Crear, abrir, renombrar, exportar e importar circuitos independientes. | Must | F1 |
| FR-002 | Asociar cada fuente, análisis, memoria e incidencia a un único `circuit_id`. | Must | F1 |
| FR-003 | Comprobar la afinidad de una fuente con el circuito activo; un archivo sospechoso podrá analizarse en cuarentena, pero no consolidarse. | Must | F1 |
| FR-004 | Importar lecturas mínimas Fecha–AGV–Tag y fuentes complementarias con asignación/confirmación de columnas. | Must | F1 |
| FR-005 | Detectar coma, punto y coma o tabulador y presentar vista previa antes de aceptar. | Must | F1 |
| FR-006 | Preservar IDs como texto, ceros iniciales, hash de fuente, fila original y advertencias. | Must | F1 |
| FR-007 | Validar fechas, esquema, filas inválidas y solapes; las filas no aceptadas quedarán en cuarentena explicada. | Must | F1 |
| FR-008 | Ejecutar importación y cálculo pesado fuera del hilo principal, con progreso, cancelación y liberación de memoria. | Must | F1 |
| FR-009 | Construir secuencias y grafos observados por AGV y vuelta. | Must | F2 |
| FR-010 | Inferir un grafo físico consensuado y contrastarlo con el grafo/configuración teórica. | Must | F2 |
| FR-011 | Representar soporte, frecuencia, tiempos robustos y confianza por nodo/transición. | Must | F2 |
| FR-012 | Detectar cambios de ruta, tags ausentes, fuera de circuito, mal ubicados, duplicados, sustituidos o clonados como hipótesis diferenciadas. | Must | F3 |
| FR-013 | Calcular oportunidades contextuales sin crear lecturas sintéticas. | Must | F3 |
| FR-014 | Comparar tag×AGV, AGV contra pares, grupos y flota para distinguir divergencias individuales, grupales y colectivas. | Must | F3 |
| FR-015 | Calcular salud global y por circuito, tramo, tag y AGV con explicación, evidencia, impacto y confianza. | Must | F3 |
| FR-016 | Analizar zona cargada, zona vacía, FIFO, huecos, las calles CO configuradas y puntos críticos sin utilizar SOC. | Must | F3 |
| FR-017 | Comparar un periodo con el perfil esperado para horario, turno, pausa, estado productivo y versión de configuración aplicables. | Must | F3 |
| FR-018 | Permitir revisar, excluir, justificar y aprobar hallazgos antes de consolidar. | Must | F4 |
| FR-019 | Consolidar mediante acción humana explícita, creando una versión nueva sin sobrescribir versiones anteriores. | Must | F4 |
| FR-020 | Guardar memoria compacta: grafo validado, perfiles, estadísticas robustas, divergencias aceptadas y referencias; no todo el bruto. | Must | F4 |
| FR-021 | Comparar estados consolidados y mostrar evolución real del circuito. | Must | F4 |
| FR-022 | Crear una incidencia a partir de un síntoma o intervalo y conservarla separada de la memoria normal. | Must | F5 |
| FR-023 | Realizar retroceso desde el síntoma, comparación observado–esperado y replay multi-AGV con incertidumbre. | Must | F5 |
| FR-024 | Mantener un expediente vivo con evidencia, hipótesis, contramedidas y verificación posterior. | Must | F5 |
| FR-025 | Comparar una incidencia con casos anteriores sin convertir semejanza en causalidad. | Should | F5 |
| FR-026 | Generar informes locales exportables en HTML y datos tabulares, con versiones y trazabilidad. | Must | F5 |
| FR-027 | Reabrir un `.agvproj` sin reimportar todo el bruto y advertir sobre evidencia externa no disponible. | Must | F1/F4 |
| FR-028 | Mostrar primero conclusión, después evidencia y finalmente filas brutas. | Must | F3 |
| FR-029 | Proporcionar vista de circuito, detalle AGV/tag, timeline, comparador, mapa/grafo y replay. | Must | F2–F6 |
| FR-030 | Permitir configurar calendarios, turnos, pausas, takt, zonas, criticidad y umbrales con vigencia temporal. | Must | F1/F3 |
| FR-031 | Registrar versión de aplicación, algoritmos, reglas, configuración y formato en cada análisis. | Must | F1 |
| FR-032 | Poder reproducir determinísticamente un análisis con las mismas entradas y versiones. | Must | F2 |
| FR-033 | Abrir un expediente de un AGV desde su identificador: lecturas frente a su cohorte, periodos de inactividad, última lectura conocida, tags leídos y no leídos con su estado de oportunidad, y momento en que su comportamiento cambió. | Must | F2/F3 |
| FR-034 | Abrir un expediente de un tag desde su identificador: qué AGV lo leen y cuáles no, desde cuándo, y en qué momento dejó de ser leído por cada uno. | Must | F2/F3 |
| FR-035 | Detectar periodos de inactividad y el instante de cambio de un objeto, distinguiendo silencio individual, silencio colectivo, intervalo fuera de cobertura y parada prevista por calendario. | Must | F2/F3 |

### Requisitos repartidos entre fases

Tres requisitos se entregan en dos tiempos y su fase lo indica con una barra:

- **FR-027**: en F1 se demuestra el ciclo mínimo exportar–reabrir que exige G1; en F4 alcanza la
  memoria consolidada completa.
- **FR-029**: cada vista nace con la capacidad que la alimenta —grafo en F2, diagnóstico en F3,
  comparador en F4, replay en F5— y F6 las unifica.
- **FR-030**: F1 necesita ya zona horaria y calendario para validar fechas, y F2 las anclas de
  vuelta y los límites de zona; F3 completa umbrales y criticidad.
- **FR-033 a FR-035**: F2 entrega la versión reducida en cuanto existe el grafo —recuentos frente
  a la cohorte, inactividad, última lectura conocida e instante de cambio—. F3 la completa con
  oportunidades elegibles, salud explicada y divergencias clasificadas. La versión reducida no
  publica tasa de salud: sin oportunidades no hay denominador legítimo (R-OPP-001).

## Requisitos no funcionales

| ID | Requisito | Prioridad | Fase |
|---|---|---:|---:|
| NFR-001 | Ningún dato industrial se transmitirá fuera del dispositivo durante importación, análisis, persistencia o informe. | Must | F1 |
| NFR-002 | El producto será observacional y estará separado del control industrial. | Must | Todas |
| NFR-003 | La interfaz seguirá siendo interactiva durante trabajos pesados y permitirá cancelar. | Must | F1 |
| NFR-004 | Los resultados serán explicables hasta fuente, hash y fila cuando la fuente esté disponible. | Must | F1 |
| NFR-005 | El estado `unknown` será una salida válida; se prohíbe completar evidencia ausente con certeza falsa. | Must | Todas |
| NFR-006 | Mismo dato, configuración y versión producirán resultados idénticos salvo campos no semánticos documentados. | Must | F2 |
| NFR-007 | El formato persistente tendrá versión, migraciones explícitas, validación de integridad y prueba de ida y vuelta. | Must | F4 |
| NFR-008 | La memoria consolidada será sustancialmente menor que el bruto en periodos normales. | Must | F4 |
| NFR-009 | La aplicación soportará PC y móvil de referencia con presupuestos medidos. | Must | F6 |
| NFR-010 | La aplicación funcionará tras la carga inicial sin depender de servicios de datos externos. | Must | F6 |
| NFR-011 | Una actualización de PWA no se activará en mitad de un análisis o consolidación. | Must | F6 |
| NFR-012 | Dependencias, configuraciones y builds serán fijados y reproducibles. | Must | F1 |
| NFR-013 | Se conservará compatibilidad accesible conforme a WCAG 2.2 nivel AA, con objetivo táctil mínimo de 24×24 px CSS. | Should | F6 |
| NFR-014 | Cada conclusión mostrará categoría, evidencia, confianza, impacto, alternativas y comprobación recomendada. | Must | F3 |
| NFR-015 | No existirán secretos, datos reales, mapas reales ni artefactos de análisis en GitHub. | Must | Todas |
| NFR-016 | Las versiones publicadas podrán identificarse y revertirse. | Must | F6 |

## Restricciones

| ID | Restricción |
|---|---|
| CON-001 | El alojamiento inicial es GitHub Pages: aplicación estática, sin servidor de aplicación. |
| CON-002 | El intercambio de proyectos entre dispositivos es manual mediante `.agvproj`. |
| CON-003 | El catálogo de funciones puede estar incompleto y no puede convertirse en requisito de importación total. |
| CON-004 | SOC/batería no es una señal diagnóstica admitida. |
| CON-005 | Tiempo real y control quedan fuera del piloto. |
| CON-006 | La consolidación requiere interacción y aprobación humanas. |

## Requisitos pendientes de cuantificación

Los objetivos concretos de tiempo, RAM, tamaño y fluidez están propuestos en `PERFORMANCE_BUDGET.md` y requieren medición en dispositivos de referencia durante F1/F6. No se considerarán aprobados por el mero hecho de aparecer en este documento.
