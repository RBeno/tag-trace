---
document_id: TT-DIAGNOSE-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-10-18
---

# Guía de diagnóstico

Qué hacer cuando TAG TRACE no hace lo esperado. Cada mensaje de error dice su causa y qué hacer; esta
guía los reúne y añade lo que no se ve en un mensaje. Uso normal: [`MANUAL_DE_USO.md`](MANUAL_DE_USO.md).

## 1. Mensajes de importación

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| No se pudo importar (SOURCE_UNREADABLE) | El fichero no se pudo leer. | Comprobar que sigue disponible; si es Excel, guardarlo de nuevo como `.xlsx` o CSV. |
| No se pudo importar (SCHEMA_UNRECOGNISED) | No hay columnas de fecha, AGV y tag. | Comprobar que es la exportación de lecturas; el mensaje enseña el esquema detectado y filas de ejemplo. |
| No se pudo importar (DELIMITER_AMBIGUOUS) | No se sabe qué separa las columnas. | Exportar de nuevo con `;` o tabulador. |
| No se pudo importar (DATE_AMBIGUOUS) | Día y mes intercambiables. | Elegir el formato que se ofrece; no se adivina. |
| No se pudo importar (NO_ACCEPTED_ROWS) | Ninguna fila válida. | El mensaje dice por qué se rechazó cada tipo de fila. |
| No se pudo importar (LIMIT_EXCEEDED) | Fichero por encima del límite. | Exportar un periodo más corto. |
| No se pudo importar (STORAGE_FULL) | No queda espacio para guardar; no se escribió nada. | Exportar y borrar circuitos que no se usen, o liberar espacio del dispositivo; sin circuito se analiza sin guardar. |
| No se pudo importar (INTERNAL) | Defecto del programa. | Ver §4. |
| Importación cancelada | Se pidió cancelar. | Nada cambió. |

Avisos que no impiden importar: filas en cuarentena (contadas y con su fila de origen), fichero de otro
circuito (no se acumula), más de 500.000 lecturas (por encima de lo medido; si va lento, periodos más
cortos), o que no se pudo archivar el original.

## 2. Síntomas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| La página va lenta o se cierra con un fichero grande | Más volumen del que aguanta el dispositivo. | «Medir este dispositivo» y comparar; exportar periodos más cortos. |
| No abre sin red | La versión no llegó a guardarse (nunca se abrió con red) o se borraron los datos del sitio. | Abrir una vez con red. |
| «Hay una versión nueva» y el botón apagado | Hay un trabajo en curso, aquí o en otra pestaña. | Esperar a que termine. |
| «Se ha actualizado la aplicación desde otra pestaña» | Otra pestaña cambió de versión. | Terminar y recargar. |
| Un expediente sin retroceso ni replay | Su ventana no tiene lecturas, o al abrir una copia su recorte no cuadraba con su huella. | Revisar la ventana; el mensaje de la copia lo dice. |
| El circuito desapareció | Datos del sitio borrados, o el navegador los borró por falta de espacio sin guardado persistente. | Abrir la última copia `.agvproj` y volver a importar las lecturas (`OPERACION.md` §3). |
| No se pudo abrir el proyecto | El fichero no es un `.agvproj`, está dañado o es de una versión más nueva. | El almacén no se tocó; usar la copia correcta o actualizar. |
| Un expediente de la copia «no coincide» | Ese expediente tiene historias distintas en la copia y aquí. | Se queda el de aquí; nada se mezcla. |
| Botón «Cancelar» desaparece | La importación ya está guardando. | Termina sola y entera. |

## 3. Comprobaciones rápidas

- La versión abierta está en la cabecera; compárela con la publicada.
- **Datos → Espacio en este dispositivo**: cuánto ocupa y si el guardado es persistente.
- **Datos → Medir este dispositivo**: cómo responde con volúmenes conocidos.

## 4. Informar de un defecto

Nunca envíe datos de planta: ni CSV, ni `.agvproj`, ni capturas con números de tags o AGV. Envíe:

1. la versión (cabecera) y el navegador y dispositivo;
2. el mensaje exacto (el de un defecto trae el tipo de error y dónde saltó, sin datos);
3. los pasos, descritos sin valores de planta;
4. si es de rendimiento, el informe de «Medir este dispositivo».

El defecto se reproduce con un fichero sintético en el repositorio antes de corregirlo.
