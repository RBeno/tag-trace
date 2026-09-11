---
document_id: TT-TEST-001
version: 0.3.0
status: baseline-candidate
last_updated: 2026-09-11
---

# Estrategia de pruebas y evaluación

## 1. Objetivo

Demostrar corrección industrial, trazabilidad, determinismo, privacidad, compatibilidad y uso razonable de recursos. Que la interfaz muestre un resultado no constituye una validación.

## 2. Capas

| Capa | Qué verifica | Ejecución |
|---|---|---|
| Tipos/estático | Contratos, dependencias y errores básicos | Cada cambio |
| Unitarias | Reglas y funciones puras | Cada cambio |
| Propiedades | Invariantes para entradas generadas | Cada cambio relevante |
| Casos de oro | Resultado industrial esperado y diagnósticos prohibidos | Cada cambio |
| Integración | Importación→análisis→persistencia→reapertura | Cada cambio del flujo |
| Migración | Compatibilidad y round-trip de `.agvproj` | Cambio de esquema/release |
| E2E | Flujo real de usuario en navegadores y móvil emulado | Solicitud/release según coste |
| Dispositivo físico | Rendimiento, archivos y gestos reales | Puertas de fase/release |
| Seguridad | Ausencia de red, XSS, archivos maliciosos y secretos | Cada release |
| Rendimiento | Tiempo, RAM, tamaño y replay | Ligera por cambio; completa por release |

## 3. Invariantes obligatorios

| ID | Propiedad |
|---|---|
| INV-001 | Reordenar físicamente filas que tienen timestamps distintos no cambia el resultado semántico. |
| INV-002 | IDs con ceros iniciales conservan identidad y representación. |
| INV-003 | Una salida `observed` siempre posee procedencia directa. |
| INV-004 | Una oportunidad/inferencia nunca aparece como lectura observada. |
| INV-005 | Añadir una copia exacta solapada no duplica métricas, pero sí conserva procedencia. |
| INV-006 | Cancelar no deja una consolidación parcial ni un proyecto aparentemente válido. |
| INV-007 | Consolidar dos veces el mismo análisis/estado no duplica contenido semántico. |
| INV-008 | Guardar una incidencia no altera el perfil esperado. |
| INV-009 | Un archivo ajeno no puede consolidarse en el circuito activo. |
| INV-010 | Mismo input+configuración+versiones produce el mismo hash semántico. |
| INV-011 | Exportar/importar sin migración conserva el estado semántico. |
| INV-012 | Optimizar representación no cambia hallazgos ni evidencia. |
| INV-013 | Un intervalo fuera de la cobertura nunca produce un hallazgo. |
| INV-014 | Unir dos fuentes solapadas no cambia el número de eventos lógicos ni elimina pasos repetidos legítimos. |

## 4. Catálogo inicial de casos de oro

| ID | Escenario | Debe producir | No debe producir |
|---|---|---|---|
| TC-001 | Recorrido normal estable | Grafo y perfil con soporte | Alertas artificiales |
| TC-002 | Un AGV omite sistemáticamente un tag | Divergencia individual/cohorte | Fallo colectivo confirmado |
| TC-003 | Todos omiten el mismo tag | Divergencia colectiva | Culpar a un único AGV |
| TC-004 | Minoría ejecuta acción distinta | Sospecha de configuración antigua | Confirmación sin contraste |
| TC-005 | Hueco con continuidad antes/después | Continuidad inferida con confianza | Lecturas inventadas |
| TC-006 | Hueco ambiguo | `unknown`/censurado | Ruta exacta |
| TC-007 | Falta de WiFi | Ausencia de observaciones y hipótesis de comunicación | Salida física automática |
| TC-008 | FIFO correcto en cargados | Orden válido | Rotura FIFO |
| TC-009 | Reordenación en vacíos | Comportamiento permitido | Rotura FIFO cargado |
| TC-010 | Maniobra CO con doble lectura | Estado/maniobra compatible | Tag duplicado automático |
| TC-011 | Calle CO ocupada demasiado tiempo | Anomalía de permanencia | Diagnóstico por SOC |
| TC-012 | Punto crítico sin llegada diez minutos | Ventana de impacto y retroceso | Causa única no demostrada |
| TC-013 | Parada planificada | Comparación con calendario | Incidencia productiva falsa |
| TC-014 | Archivo de otro circuito | Cuarentena/bloqueo de consolidación | Mezcla de memoria |
| TC-015 | Solape de dos CSV | Deduplicación con doble procedencia | Doble recuento |
| TC-016 | Catálogo funcional parcial | `función no documentada` | Tag defectuoso |
| TC-017 | Incidencia guardada | Expediente reproducible separado | Cambio del esperado |
| TC-018 | Cambio colectivo sostenido y confirmado | Propuesta de nueva versión del grafo | Reescritura de histórico |
| TC-019 | CSV con coma/punto y coma/tab | Importación equivalente | Pérdida de IDs/fechas |
| TC-020 | Worker termina/cancela en orden adverso | Estado consistente | `0 lecturas` por carrera/sincronización |
| TC-021 | Dos exportaciones solapadas que contienen un paso repetido A→B→A | Unión por tramo común: el solape cuenta una vez y el paso repetido se conserva | Fusión del paso repetido en un solo evento |
| TC-022 | Consulta sobre un intervalo fuera de la cobertura cargada | `sin datos cargados` | Parada, silencio colectivo o degradación de salud |
| TC-023 | Fuente con inversiones de orden respecto a su sentido declarado | Señal de entrega diferida, con las filas conservadas | Rechazo del fichero o reordenación silenciosa |
| TC-024 | Tag sano durante un multicircuito que reduce el alcance de detección | Ausencias tratadas como esperables en ese contexto | Diagnóstico de tag degradado |
| TC-025 | Periodo sin multicircuito conocido | Salud publicada con el confusor declarado | Conclusión presentada como si el contexto fuera homogéneo |

## 5. Estructura de un caso de oro

Cada caso incluye:

- propósito y reglas cubiertas;
- fixture sintético y generador/versionado;
- configuración y calendario;
- resultado esperado estructurado;
- resultados expresamente prohibidos;
- tolerancias numéricas justificadas;
- evidencia que debe poder navegarse;
- hash semántico o snapshot estable;
- responsable y fecha de aceptación.

## 6. Evaluación de diagnóstico

Con casos revisados por el propietario se medirán por categoría:

- verdaderos positivos;
- falsos positivos;
- falsos negativos;
- casos correctamente indeterminados;
- confianza bien/mal calibrada;
- utilidad de la comprobación recomendada.

La exactitud global no basta si oculta errores graves. Se priorizará reducir afirmaciones falsas y mantener trazabilidad.

## 7. Navegadores y móvil

Las pruebas E2E cubrirán al menos Chromium y WebKit, escritorio y perfiles móviles. En cada puerta relevante se usará además un móvil Android físico y un PC de referencia para carga de archivos, cancelación, persistencia, actualización PWA y replay.

## 8. Aceptación humana

El propietario valida comportamiento, no implementación interna. Para aprobar una fase recibe:

- demostración de escenarios;
- tabla de resultados y límites conocidos;
- comparación de rendimiento;
- preguntas abiertas y riesgos residuales;
- versión reproducible y método de retorno.
