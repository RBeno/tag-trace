---
document_id: TT-OPEN-001
version: 0.7.0
status: active
last_updated: 2026-09-11
---

# Preguntas abiertas

No son lagunas que la IA deba rellenar. Cada respuesta se incorpora a requisitos/reglas/configuración y se cierra con fecha y evidencia.

## Bloqueantes para cerrar G0

Para responderlas hay una plantilla con los campos concretos que hacen falta:
[`docs/templates/G0_INTAKE.md`](templates/G0_INTAKE.md). Se rellena en `local/`, fuera del control
de versiones: al repositorio vuelve la forma de cada respuesta, nunca los valores de planta.

| ID | Pregunta | Por qué bloquea | Resolución prevista |
|---|---|---|---|
| OQ-B01 | ¿Cuáles son los formatos/encabezados reales de DS-002 a DS-009? DS-001 y DS-011 ya están determinados. | Define contrato de importación | Inventario local de fuentes y muestras controladas |
| OQ-B02 | ¿Qué zona horaria representan los timestamps y cómo se registra el cambio horario? El dato no lleva desplazamiento, así que no puede deducirse de la fuente. | Evita secuencias/turnos erróneos | Confirmación + casos DST |
| OQ-B03 | ¿Qué móvil Android y PC serán dispositivos de referencia? | Permite aprobar presupuesto | Registrar modelo, RAM, navegador y versión |
| OQ-B04 | ¿Cuáles son los límites exactos de zona cargada/vacía, número y límites de calles CO, puntos críticos y anclas de vuelta del piloto? | Necesario para reglas topológicas | Configuración local inicial versionada, no publicada |
| OQ-B05 | ¿Qué datos reales podrán usarse localmente para aceptar F1–F5 y quién valida los resultados? | Evita pruebas solo sintéticas | Plan de aceptación local |
| OQ-B07 | ¿Bajo qué licencia se publica el repositorio? Sin fichero `LICENSE` queda con todos los derechos reservados. | Afecta a reutilización y contribuciones externas | Decisión del propietario antes de abrirlo |

## Necesarias durante F1–F3

| ID | Pregunta | Tratamiento mientras esté abierta |
|---|---|---|
| OQ-101 | ¿Qué modelos de lector/AGV existen y cuáles suprimen tag repetido? | Regla R-OPP-002 sigue candidate |
| OQ-102 | ¿Qué evento o secuencia identifica con fiabilidad una vuelta? | Conservar vueltas parciales/desconocidas |
| OQ-103 | ¿Cómo distinguir mantenimiento/asistencia/pastor en los CSV? | Catálogo parcial y exclusión explícita |
| OQ-104 | ¿La ventana de actualización automática de 30 min y el reenvío manual se comportan igual en todas las versiones? | R-AGV-003 sigue candidate |
| OQ-105 | ¿Qué señal confirma WiFi ausente frente a lector silencioso? | Mantener hipótesis alternativas |
| OQ-106 | ¿Cómo se identifica carga/vacío si el dato no existe directamente? | Estado inferido con confianza |
| OQ-107 | ¿Cuáles son excepciones legítimas al FIFO cargado? | No confirmar rotura sin contexto |
| OQ-108 | ¿Qué periodos/versiones exactos tienen los calendarios y takt conocidos? | Configuración obligatoria por vigencia |
| OQ-109 | ¿Cómo se reconocen movimientos manuales y sentido contrario? | Señalar desconocido/excepción |
| OQ-110 | ¿Qué diferencias conocidas existen entre memorias de AGV y cómo se obtienen sin descarga global? | Importación/revisión manual versionada |
| OQ-111 | ¿Cuál es la lista completa del catálogo de usos y su significado operativo? | Los eventos de uso se conservan con su texto original, sin interpretarse ni alimentar diagnóstico |
| OQ-112 | ¿Cuál es el rango exacto de multicircuitos y qué hace cada uno? Se conoce que altera el comportamiento al leer tags y que algún modo reduce el alcance de detección. | Perfiles separados por multicircuito; sin la tabla completa no se puede afirmar qué ausencias son esperables |
| OQ-113 | ¿Qué representa la columna de defecto del informe ampliado? | Se conserva como atributo sin promover ni interpretar |
| OQ-114 | El mayor silencio colectivo observado cae justo en la frontera entre el régimen nocturno y el de producción, lo que sugiere cambio de turno o parada planificada. Con una sola observación no hay soporte. ¿Lo confirma el calendario? | Hipótesis registrada con su evidencia; no se promueve a perfil esperado |


## Decisiones de producto posteriores

| ID | Pregunta | Fase |
|---|---|---:|
| OQ-P01 | ¿Debe `.agvproj` admitir cifrado con contraseña y cómo se recupera una clave perdida? | F4 |
| OQ-P02 | ¿Cuánto recorte de eventos debe conservar una incidencia por defecto? | F5 |
| OQ-P03 | ¿Qué formatos de informe se necesitan además de HTML/CSV? | F5 |
| OQ-P04 | ¿Qué librería/tecnología de grafo cumple mejor rendimiento y UX móvil? | F2/F6 |
| OQ-P05 | ¿Qué framework UI ofrece mejor equilibrio tras un prototipo comparativo? | F1 |
| OQ-P06 | ¿Cuándo existe suficiente evidencia para promover deriva a cambio real? | F4 |
| OQ-P07 | ¿Qué métricas hacen que una contramedida sea eficaz, parcial o ineficaz? | F5 |

## Preguntas cerradas

| ID | Pregunta | Respuesta | Fecha | Documentos |
|---|---|---|---|---|
| OQ-B06 | ¿El repositorio debe permanecer privado durante todo el piloto? | No. Pasa a público conteniendo solo código, documentación y fixtures sintéticos, tras verificar el historial y activar el guardián de datos. | 2026-09-03 | ADR-0014, `SECURITY_PRIVACY.md` |
| OQ-115 | ¿«Reaparecer en su hueco» se observa con el grupo avanzando o alcanzándole? | La reaparición se busca hacia delante en el tiempo, y lo que discrimina es si los vecinos avanzaron: si tampoco lo hicieron, el fallo es de la línea y no del objeto. Si avanzaron con normalidad y el objeto reaparece en posición muy por encima del tiempo esperado del tramo, la detención es individual. | 2026-09-16 | R-AGV-007, R-AGV-008, R-FLO-006, `ALGORITHM_CATALOG.md` §4.3 |

## Registro de cierre

Al cerrar una pregunta se añade: respuesta, estado de verdad, evidencia, fecha, responsable y documentos modificados. No se borra la pregunta; se mueve a la sección de preguntas cerradas.
