---
document_id: TT-RISK-001
version: 0.2.0
status: active
last_updated: 2026-09-03
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

## Riesgos que bloquean F1

RSK-001, RSK-002, RSK-009, RSK-012, RSK-013 y RSK-021 deben tener controles verificables definidos en G0/G1. Los demás pueden mantenerse abiertos con mitigación y responsable explícitos.
