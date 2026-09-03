---
document_id: TT-DATA-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Contratos de datos y procedencia

## 1. Política general

Las fuentes se cargan localmente y se tratan como evidencia inmutable. La normalización crea una representación derivada; nunca modifica el archivo original ni oculta filas descartadas.

## 2. Tipos de fuente

| ID | Fuente | Mínimo | Carácter |
|---|---|---|---|
| DS-001 | Lecturas históricas | Fecha/hora, AGV, tag | Esencial |
| DS-002 | Inventario Vsystem | Tag y atributos disponibles | Teórico, versionado |
| DS-003 | Secuencia/plano | Orden, nodo o relación disponible | Teórico, opcional al inicio |
| DS-004 | Carga online | Calle, tag de parada y secuencia de tags | Configuración |
| DS-005 | Tags críticos | Tag, función, grado 1–3 y redundancias | Catálogo parcial |
| DS-006 | Tags especiales | Tag y clase: noche, mantenimiento, asistencia/pastor u otra | Catálogo parcial |
| DS-007 | Tags y acciones | Tag y una o varias funciones/condiciones | Catálogo parcial |
| DS-008 | Memoria/configuración por AGV | AGV, versión o inventario conocido | Evidencia de divergencia |
| DS-009 | Calendario productivo | vigencia, turnos, pausas, paradas y takt | Contexto versionado |
| DS-010 | Proyecto anterior | `.agvproj` con manifiesto y versión | Persistencia local |

## 3. Contrato mínimo de lecturas

| Campo canónico | Tipo | Obligatorio | Regla |
|---|---|---:|---|
| `timestamp` | instante | Sí | Parseo explícito; conservar valor original y zona horaria/configuración usada. |
| `agv_id` | texto | Sí | No convertir a número; trim controlado; preservar ceros. |
| `tag_id` | texto | Sí | No convertir a número; preservar ceros y valor original. |
| `source_id` | UUID/texto | Sí, derivado | Identifica el lote importado. |
| `source_row` | entero | Sí, derivado | Fila física original, incluida cabecera al definir el convenio. |
| `source_hash` | hash | Sí, derivado | Identidad del archivo completo. |
| `observed_state` | enum | Sí, derivado | Siempre `observed` para una fila aceptada. |

Campos adicionales se conservan en un espacio de atributos tipado, pero no se promueven a contrato canónico sin decisión.

## 4. Proceso de importación

1. Calcular hash y metadatos sin enviar el contenido.
2. Detectar codificación, delimitador y cabecera con puntuación de confianza.
3. Mostrar muestra y asignación de columnas al usuario.
4. Validar fechas, IDs y campos obligatorios.
5. Clasificar filas: aceptada, duplicada exacta, solapada, inválida o ambigua.
6. Presentar recuentos y advertencias antes del análisis.
7. Calcular una huella de afinidad con el circuito activo.
8. Permitir análisis en cuarentena si hay duda; impedir consolidación si la afinidad no está resuelta.

## 5. Delimitadores, fechas y orden

- Admitir coma, punto y coma y tabulador.
- No inferir silenciosamente día/mes cuando el formato sea ambiguo.
- La zona horaria forma parte de la configuración versionada.
- Ordenar mediante `timestamp` y un desempate determinista documentado.
- Conservar el orden original para auditoría.
- Los cambios horario de verano/invierno deben detectarse y mostrarse.

## 6. Duplicación y solapes

- Duplicado exacto: mismo contenido canónico y procedencia equivalente.
- Solape: fuentes distintas cubren el mismo periodo y contienen el mismo evento lógico.
- No se elimina evidencia: la vista analítica deduplica, pero el registro de procedencia conserva todas las referencias.
- Dos lecturas iguales pueden ser físicamente válidas; la deduplicación no se basa solo en AGV+tag.

## 7. Afinidad de circuito

La afinidad combina intersección de tags, transiciones conocidas, AGV esperados, fuentes declaradas y contradicciones topológicas. Sus salidas son:

- `compatible`: análisis y posible consolidación;
- `partially-compatible`: análisis permitido con advertencia; consolidación requiere resolución humana;
- `foreign-suspected`: cuarentena; consolidación bloqueada;
- `unknown`: memoria insuficiente para decidir.

No debe bloquearse el primer archivo de un circuito vacío por falta de memoria previa.

## 8. Formato `.agvproj`

El formato definitivo se formalizará en F1/F4 mediante esquema. Como mínimo contendrá:

- manifiesto, versión e integridad;
- identidad del circuito;
- configuraciones y periodos de vigencia;
- versiones de algoritmos y reglas;
- grafo y perfiles consolidados;
- divergencias históricas compactas;
- expedientes de incidencia separados;
- referencias a fuentes y disponibilidad de evidencia;
- registro append-only de consolidaciones y migraciones.

No incluirá el bruto completo por defecto. Un expediente puede conservar un recorte normalizado mínimo cuando sea necesario para reproducir una incidencia.

## 9. Datos reales y GitHub

Ninguna fuente real, aunque esté parcialmente anonimizada, se añade al repositorio. Los fixtures sintéticos deben usar identificadores, geometría, horarios y distribuciones inventados y llevar un manifiesto `synthetic: true`.
