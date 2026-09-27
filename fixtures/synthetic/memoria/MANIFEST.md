# Fixtures sintéticos de memoria consolidada

- Dataset ID/version: `memoria/1`
- Generador: escritos a mano para F4, a partir del patrón de `anillo/`
- `synthetic: true`
- Propósito: ejercitar el flujo de consolidar un periodo (`MEMORY_CONSOLIDATION.md` §6-§9) en el
  navegador: el bloqueo por hallazgos pendientes, la primera versión, la comparación de lo observado
  frente a la memoria vigente y la revocación; y, desde el plano físico (ADR-0016), crearlo desde
  una versión, leer una ubicación sin leer, confirmar una sustitución y ubicar una salida que se
  revisa a mano
- Periodo ficticio: enero de 2026, inventado
- Configuración ficticia asociada: zona `Europe/Madrid`

## Garantía de privacidad

- [x] IDs inventados
- [x] Fechas y horarios inventados
- [x] Topología inventada
- [x] Distribuciones no copiadas literalmente de datos reales
- [x] Sin nombres de planta, sistema o personal
- [x] Revisado antes de commit

## Resultados esperados y prohibidos

`periodo-1.csv` y `periodo-2.csv` son el mismo anillo de cuatro tags (`0100→0200→0300→0400`) recorrido
tres veces por `0007` y `0042`, en dos días consecutivos: dos periodos disjuntos del mismo circuito,
cada uno con su instantánea.

`listas.csv` declara el circuito como `0100→0200→0300→0999`, con `0400` **fuera de la lista**. Con las
listas cargadas, el análisis de cada periodo produce un hallazgo revisable de tag fuera del circuito,
que la instantánea guarda: previsualizar la consolidación **sin revisarlo** debe bloquearse con
«hallazgos pendientes»; revisado, la consolidación de `periodo-1` debe producir la versión v1 y el
análisis de `periodo-2` debe compararse con ella.

**Prohibido**: que la aplicación consolide sin la confirmación de la persona; que una versión revocada
desaparezca de la lista; que la previsualización con pendientes habilite «Confirmar y consolidar».

## El plano físico (ADR-0016)

`periodo-3.csv` es `periodo-1.csv` un día después (26/01) **sin ninguna lectura de `0300`**: los
dos AGV siguen pasando de `0200` a `0400`, con el mismo tiempo total. Con el plano creado desde v1,
la ubicación de `0300` debe seguir en el plano como «sin leer», con las pasadas por su sitio como
oportunidades inferidas, y la evolución debe decir «sin leer en su ubicación», no «desaparece».

`periodo-4.csv` es `periodo-1.csv` el 27/01 con el código **`0301` donde estaba `0300`**, leído por
los dos AGV: una sustitución. Con el plano creado, debe salir como **propuesta** sin escribirse; solo
al confirmarla con una razón la misma ubicación pasa a tener `0301`, con `0300` en su historia.

`periodo-5.csv` es el mismo anillo el 28/01, **doce vueltas por AGV** con tiempos entre 10 y 13 s
en ciclo fijo: cada tramo llega a las 20 pasadas que exige una horquilla (`bands.minBandSamples`), así
que la tabla «Tramos entre ubicaciones» debe tener filas con pasadas, media y desviación típica. Los
periodos 1 a 4 no llegan y la tabla debe decir que no hay tramos medidos.

`listas-plano.csv` son las mismas listas que `listas.csv` con la columna `funcion` y un tag más,
`critico;0900;;parada`: una parada por salida de circuito que **nunca se lee** en ningún periodo.
Debe proponerse como salida sin ubicar; confirmarla exige elegir de qué ubicación del anillo cuelga, y
su estado es la última revisión manual, nunca las lecturas. `listas.csv` no cambia: las pruebas de la
memoria dependen de sus hallazgos.

**Prohibido**: que la aplicación cambie el plano sin la confirmación de una persona con razón escrita;
que una ubicación sin leer salga del plano; que la salida `0900` entre en una tasa o en un tramo del
anillo.
