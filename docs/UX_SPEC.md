---
document_id: TT-UX-001
version: 0.2.0
status: baseline-candidate
last_updated: 2026-09-16
---

# Especificación de experiencia de usuario

## 1. Principio de información

Cada vista sigue tres niveles:

1. **Conclusión:** qué ocurre, gravedad, confianza y cambio.
2. **Evidencia:** por qué se concluye, alternativas y comprobaciones.
3. **Bruto:** fuentes, filas y valores originales cuando estén disponibles.

La interfaz no debe obligar a revisar AGV por AGV para descubrir un patrón colectivo.

## 2. Arquitectura de navegación

| Área | Objetivo |
|---|---|
| Gestor de circuitos | Crear/abrir/importar/exportar proyectos aislados y ver su estado. |
| Preparar análisis | Cargar fuentes, mapear columnas, revisar calidad, calendario y afinidad. |
| Resumen | Prioridades, cambios, cobertura, salud y avisos principales. |
| Circuito | Grafo/plano, capas teórica–observada–validada y evolución. |
| Timeline y replay | Movimiento multi-AGV, estados e incertidumbre. |
| Diagnóstico | Tags, AGV, tramos, FIFO, CO, críticos y explicaciones. |
| Expediente de AGV o tag | Buscar por identificador y ver todo lo conocido sobre ese objeto: contraste con su cohorte, inactividad, instante de cambio y evidencia. |
| Comparador | Periodo actual frente a consolidado, periodo o configuración. |
| Consolidación | Revisión de cambios y creación de memoria vN+1. |
| Incidencias | Expedientes, replay, casos similares y contramedidas. |
| Configuración | Calendarios, zonas, criticidad, parámetros y vigencias. |

## 3. Flujo de análisis

1. Seleccionar circuito.
2. Añadir archivos por botón, selector o arrastrar y soltar.
3. Revisar muestra, esquema, delimitador, fecha y columnas.
4. Ver calidad, solapes, periodo y afinidad de circuito.
5. Configurar el contexto o elegir una versión vigente.
6. Iniciar análisis con progreso por etapa y posibilidad de cancelar.
7. Ver resumen priorizado y navegar a evidencia.
8. Decidir: análisis temporal sin memoria, crear incidencia o revisar para consolidar.

## 4. Presentación de hallazgos

Cada tarjeta de hallazgo muestra:

- conclusión en lenguaje operativo;
- objeto y periodo afectados;
- severidad/impacto;
- confianza independiente;
- tipo: individual, grupal, colectivo o desconocido;
- cambio respecto al esperado;
- evidencia a favor y en contra;
- causas alternativas;
- acción de comprobación;
- acceso a grafo, timeline y filas.

El color nunca será el único medio de distinguir estados.

## 4.1 Expediente de un AGV o de un tag

Se entra escribiendo un identificador. Es la vía de trabajo más frecuente —«qué le pasa al 3524»,
«quién ha dejado de leer el 58021»— y debe resolverse sin recorrer AGV por AGV.

Ambos expedientes comparten estructura, y cada bloque dice también **qué no se sabe**:

| Bloque | AGV | Tag |
|---|---|---|
| Actividad | Lecturas en el periodo frente a su cohorte, no frente a la flota entera | AGV que lo leyeron frente a los que pasaron por su tramo |
| Inactividad | Periodos de silencio clasificados, su instante de cambio y **cómo reapareció** | Desde cuándo dejó de leerlo cada AGV |
| Ausencias | Tags con oportunidad elegible no materializada | Pasos en los que no fue leído, y por quién |
| Contraparte | Qué hicieron los demás durante sus silencios | Qué AGV siguen leyéndolo con normalidad |
| Cobertura | Qué periodo está cargado y cuál no | Igual |

Reglas de presentación:

- La comparación es **contra la cohorte**, no contra la flota: modelos distintos de AGV o de lector
  pueden diferir sin que ninguno esté degradado (R-AGV-004).
- Las ausencias salen del modelo de oportunidades, nunca de restar el catálogo del circuito a lo
  leído (R-OPP-008). Una rama que ese AGV no recorre no es una ausencia.
- Un silencio se presenta con sus hipótesis ordenadas y su evidencia; nunca como una causa única.
  Inactividad y fallo de comunicación producen el mismo dato (R-AGV-006) y la interfaz debe decirlo
  en lugar de elegir por el usuario.
- Un silencio se muestra con sus dos extremos: cómo se fue y cómo volvió. La reaparición es parte
  de la evidencia, no un detalle: es lo que distingue una parada en carga de una avería.
- Los periodos sin cobertura se dibujan distintos de los silencios, y nunca degradan ninguna cifra.
- Desde cualquier cifra se llega a la evidencia y de ahí a las filas de origen.

En F2 el expediente existe con recuentos, inactividad, última lectura conocida e instante de cambio,
y **sin tasa de salud**: sin oportunidades no hay denominador legítimo. F3 lo completa.

## 5. Grafo y plano

- Alternar capas: Vsystem, observado del periodo, validado y divergencias.
- Mantener forma física y orden topológico como conceptos distintos.
- Mostrar soporte y confianza de aristas.
- Seleccionar un tag/tramo para ver AGV, vueltas, tiempos y cambios.
- Filtrar sin recalcular el análisis completo.
- Degradar detalle de forma progresiva en móvil.

## 6. Consolidación

La pantalla muestra explícitamente:

- versión actual y propuesta;
- qué se añade, modifica, mantiene o excluye;
- impacto sobre grafo y perfiles;
- divergencias que se conservarán;
- incidencias excluidas;
- tamaño estimado antes/después;
- advertencias y preguntas pendientes.

El botón final usa una confirmación inequívoca. No existe consolidación automática ni deshacer destructivo; una corrección genera nueva versión/revocación.

## 7. Móvil

- Controles táctiles de al menos 24×24 px CSS, conforme a WCAG 2.2 nivel AA.
- Paneles apilados y detalle bajo demanda.
- Importación mediante selector del sistema.
- Progreso persistente aunque se cambie de vista dentro de la aplicación.
- Cancelación visible durante tareas pesadas.
- Tablas convertibles en listas; el grafo conserva zoom y encuadre.
- Ninguna pantalla esencial depende de hover o clic secundario.

La emulación móvil no sustituye la prueba en dispositivo físico.

## 8. Estados y errores

La aplicación diferencia:

- sin datos;
- analizando;
- cancelando;
- resultado parcial;
- fuente inválida;
- archivo sospechoso de otro circuito;
- evidencia no disponible;
- proyecto incompatible/migrable;
- almacenamiento insuficiente;
- actualización disponible;
- error recuperable y error que invalida el análisis;
- circuito en proceso de borrado, con lo que se pierde enumerado antes de confirmar.

Un error nunca debe mostrar `0 lecturas válidas` sin explicar esquema detectado, causa, filas de ejemplo y acción de recuperación.

## 9. Actualización PWA

Si existe una versión nueva:

- se avisa sin interrumpir;
- se bloquea su activación durante importación, análisis, exportación o consolidación;
- se solicita guardar el proyecto;
- se muestra la versión que se abrirá y compatibilidad esperada.
