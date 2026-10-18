---
document_id: TT-RISK-001
version: 0.3.0
status: active
last_updated: 2026-10-18
---

# Registro de riesgos

Escala: probabilidad (P) e impacto (I) de 1 a 5. Exposición = P×I. Los valores son iniciales y deben revisarse en cada puerta.

| ID | Riesgo | P | I | Exposición | Respuesta/indicador | Propietario |
|---|---|---:|---:|---:|---|---|
| RSK-001 | Regla industrial incorrecta se convierte en código | 3 | 5 | 15 | Estados candidate/accepted, casos de oro y aprobación de dominio | Producto |
| RSK-002 | Mezcla de archivos entre circuitos | 3 | 5 | 15 | Afinidad, cuarentena, `circuit_id` y bloqueo de consolidación | Producto/arquitectura |
| RSK-003 | Inferencia presentada como observación | 3 | 5 | 15 | Tipos separados, invariantes y revisión UI | Arquitectura |
| RSK-004 | Falso diagnóstico por hueco de WiFi | 4 | 4 | 16 | Censura, contexto colectivo y alternativas | Algoritmos |
| RSK-005 | Crecimiento excesivo de memoria | 4 | 4 | 16 | Columnar, deltas, retención y presupuesto <5 % | Arquitectura |
| RSK-006 | Bloqueo/crash en móvil | 4 | 4 | 16 | Worker, streaming, cancelación, límites y PERF-D2/D3 | Rendimiento |
| RSK-007 | Carrera Worker/UI produce resultado vacío o obsoleto | 3 | 4 | 12 | IDs de trabajo, protocolo de estados y TC-020 | Arquitectura |
| RSK-008 | Incidencia contamina el esperado | 3 | 5 | 15 | Almacén separado e INV-008 | Producto |
| RSK-009 | Publicación accidental de datos sensibles | 2 | 5 | 10 | Visibilidad decidida, ignore, escaneo y revisión | Seguridad |
| RSK-010 | PWA se actualiza durante consolidación | 2 | 5 | 10 | Activación diferida, guardado y retorno | Plataforma |
| RSK-011 | Datos locales eliminados por navegador | 3 | 4 | 12 | Avisos, persistencia solicitada y exportación verificada | UX |
| RSK-012 | Cambio horario/fecha altera secuencias | 3 | 4 | 12 | Zona horaria versionada, ambigüedad bloqueada y tests DST | Datos |
| RSK-013 | Una IA realiza cambio amplio difícil de revisar | 4 | 4 | 16 | Contratos pequeños, ramas, límites de archivos y gates | Gobierno |
| RSK-014 | Dependencia añade red, peso o vulnerabilidad | 3 | 4 | 12 | ADR, lockfile, auditoría y adaptador | Arquitectura |
| RSK-015 | Umbrales ajustados a un único periodo | 4 | 3 | 12 | Casos variados, robustez y validación histórica | Algoritmos |
| RSK-016 | Catálogo parcial se interpreta como fallo | 3 | 4 | 12 | `función no documentada` y TC-016 | Dominio |
| RSK-017 | Similitud de incidentes se interpreta como causa | 3 | 4 | 12 | Explicar diferencias y lenguaje de causalidad | Incidencias |
| RSK-018 | El prototipo anterior condiciona mala arquitectura | 3 | 3 | 9 | Greenfield; reutilización solo tras auditoría | Arquitectura |
| RSK-019 | Optimización elimina trazabilidad | 3 | 5 | 15 | Hash semántico, offsets compactos e INV-012 | Arquitectura |
| RSK-020 | Alcance crece antes de validar valor | 4 | 4 | 16 | Fases cerradas, WIP limitado y no tiempo real hasta F8 | Producto |
| RSK-021 | Un dato real llega a un repositorio público y queda indexado | 2 | 5 | 10 | Guardián en CI y hook local bloqueantes, historial verificado antes de abrir y revisión de diff | Seguridad |

## Estado al 2026-10-18

Hechos comprobables por riesgo, con la versión que los trajo (detalle en `CHANGELOG.md`). Esta sección
**no cambia la probabilidad ni el impacto** de la tabla: revisarlos es del propietario en cada puerta, y
la próxima es G6.

| ID | Estado al 2026-10-18 |
|---|---|
| RSK-001 | Mitigado en parte. Las reglas llevan estado (`candidate`/`accepted`) en `RULE_CATALOG.md`, los casos de oro viven en `golden/` y la auditoría sintética con verdad plantada (`tests/audit/`) vigila cada clase de hallazgo. Sigue vivo: la revisión de 3.89.0 encontró decisiones de planta que el código tomaba sin estar escritas, y dejó para el propietario OQ-177 a OQ-180 y la contradicción de `inventory.ts` con R-OPP-008. |
| RSK-002 | Mitigado. Afinidad de circuito (`affinity.ts`, 3.1.0, 2026-09-18): un fichero de otro circuito no se acumula y se dice por qué. Agrupamiento por circuito (`cohort.ts`), corregido para circuitos que comparten tramo en 3.30.2. Los expedientes de un `.agvproj` solo entran en su circuito (3.88.0). |
| RSK-003 | Mitigado en parte. Estados de verdad como tipo (`truth.ts`); el replay ya no llama silencio a lo anterior a la primera lectura (R-GRA-010, 3.3.0). En 3.89.0 se corrigieron textos que afirmaban causas donde solo hay lecturas («parece que no se movía», «apunta a…»). |
| RSK-004 | Mitigado en parte. Un silencio solo no prueba WiFi ausente (R-OPP-003). Desde 3.65.0 el registro de conexiones del terminal (DS-013, ADR-0017) es evidencia observada y separada de la inferida; los terminales ruidosos se apartan del mapa (R-COM-009, 3.66.0) y el apagado colectivo no cuenta como corte de cobertura (R-COM-008). Sin registro cargado, la WiFi sigue siendo inferencia. |
| RSK-005 | Mitigado. Solo se retienen en crudo las dos últimas exportaciones (ADR-0015, OQ-143, 3.52.0); memoria y lecturas retenidas van comprimidas (OQ-145, 3.55.0). Crecimiento medido con cuatro periodos: el propietario aceptó el 5 % sobre el CSV y las versiones ocupan menos del 1 % (G4, 3.54.1 y 3.55.0). |
| RSK-006 | Mitigado en parte. Banco de medida «Medir este dispositivo» (3.83.0); «Cancelar» atendido en ~0,5 s (3.83.1); lecturas por columnas sin copia, tirón máximo ~0,1 s y memoria del hilo principal de 648 a 156 MiB en PERF-D4 (3.84.0). En 3.89.0: el límite de 512 MiB se comprueba antes de leer y se corrigió un bucle sin fin en el Worker (TC-375). Pendiente: la medida en el S23 FE y el PC de referencia (G6). |
| RSK-007 | Mitigado en parte. Desde 3.61.0 los botones de Memoria, Plano y Valores ya no terminan el Worker del trabajo en curso; un rechazo de promesa sin capturar en el Worker llega a la interfaz (3.89.0). Sigue vivo: dos pestañas importando a la vez al mismo circuito pueden dejar filas huérfanas sin aviso (revisión 3.89.0, anexo C-03, propuesta no hecha). |
| RSK-008 | Mitigado. Un periodo con incidencia se consolida entero y sin ella en el esperado (OQ-148, 3.55.0); los hallazgos graves con instante se excluyen con su ventana (OQ-149, 3.57.0); la consolidación propone la ventana de cada expediente como incidencia excluida (D5, 3.76.0); los expedientes tienen almacén propio (ADR-0018). |
| RSK-009 | Mitigado. Repositorio público desde el 2026-09-20 con el guardián de datos bloqueante en integración continua y en el hook local (ADR-0014); la aplicación publica `connect-src 'none'` y no hace peticiones propias (3.87.0). |
| RSK-010 | Mitigado (3.82.0). La versión nueva se instala en espera y se activa solo a petición y sin trabajo en curso, ni en esa pestaña ni en otra (`BroadcastChannel`); cada publicación deja una etiqueta para volver atrás. |
| RSK-011 | Mitigado en parte. Se pide guardado persistente tras la primera importación que guarda y se enseña el espacio usado (3.86.0); el `.agvproj` lleva también los expedientes (esquema 6, 3.88.0) y la restauración entera se probó en el navegador (`OPERACION.md` §3). Depende de que la persona exporte la copia. |
| RSK-012 | Mitigado en parte. Tiempo canónico sin librería (ADR-0013); la hora repetida se resuelve por la posición en el fichero (3.45.0–3.46.0). En 3.89.0 los campos de fecha de la interfaz pasan por la misma conversión (TC-373) y una fecha imposible va a cuarentena (TC-379). Abierta: OQ-178, asimetría en la hora repetida. |
| RSK-013 | Sin cambios en el control. Cada entrega va en un commit con su `CHANGELOG`, y PR y fusión solo por orden del propietario. Hecho a tener en cuenta: las PR #17 y #18 juntaron las versiones 3.67.1–3.80.1 y 3.81.0–3.88.2. |
| RSK-014 | Mitigado. Sin dependencias en ejecución; axe-core solo en pruebas (OQ-175, 3.86.0); Vite 7.3.6 (3.87.0) y Vitest 5.0.5 con `npm audit` sin avisos (3.88.4). Sin cifra que vigile el tamaño de lo publicado (revisión 3.89.0, anexo A-12, propuesta). |
| RSK-015 | Sin cambios. Las horquillas salen de los datos de cada tramo (R-TIM-009) y los valores de planta solo se proponen si coinciden en las tres últimas versiones consolidadas (OQ-153, 3.60.0), pero los umbrales provisionales (`draft`) siguen sin calibrar con datos reales (OQ-129). |
| RSK-016 | Sigue vivo. La posición de un tag la dan las lecturas y una diferencia con la lista es una corrección de la lista, no un fallo (R-GRA-015, 3.32.0); una lista con nombre desconocido se conserva y se avisa. Pero sin la lista `memoria` cargada el inventario manda añadir a la memoria casi todos los tags declarados (OQ-180, 3.89.0). |
| RSK-017 | Mitigado. Cinco etiquetas de lenguaje y vocabulario causal prohibido en el texto generado (ADR-0018); la similitud compara característica a característica, sin pesos, y un hecho repetido no se llama `correlaciona` (3.80.0); el informe pasa una prueba de lenguaje (3.79.0). Abierta: OQ-172, cuándo se dice `correlaciona`. |
| RSK-018 | Sin cambios desde F0 (ADR-0011). |
| RSK-019 | Mitigado. El paso de las lecturas por columnas (3.84.0) conserva la fila de origen, el texto original y los identificadores tal cual; los hashes semánticos rechazan NaN, `Map` y `Set` (comprobado en la revisión de 3.89.0). Pendiente de diseño: el hash repetido en cada lectura guardada (anexo C-10), que no debe quitar procedencia. |
| RSK-020 | Sigue vivo. Por petición del propietario, F5 incluyó trabajo fuera de `ROADMAP.md` §F5 (3.64.0–3.65.0, 3.68.0–3.72.0); el valor con datos reales lo valida el piloto de G6, que no se ha hecho. |
| RSK-021 | Mitigado. Guardián bloqueante en integración continua y en el hook local desde F0 (`scripts/check_data.sh`). El guardián revisa ficheros y extensiones, no el texto: en 3.36.1 se quitaron de `PROJECT_MEMORY.md` dos números de tag de un circuito real. |

## Histórico: riesgos que bloqueaban F1

Criterio de F0, ya superado (G1 cerrada): RSK-001, RSK-002, RSK-009, RSK-012, RSK-013 y RSK-021 debían
tener controles verificables definidos en G0/G1. Los demás podían mantenerse abiertos con mitigación y
responsable explícitos.
