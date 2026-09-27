# Fixtures sintéticos de memoria consolidada

- Dataset ID/version: `memoria/1`
- Generador: escritos a mano para F4, a partir del patrón de `anillo/`
- `synthetic: true`
- Propósito: ejercitar el flujo de consolidar un periodo (`MEMORY_CONSOLIDATION.md` §6-§9) en el
  navegador: el bloqueo por hallazgos pendientes, la primera versión, la comparación de lo observado
  frente a la memoria vigente y la revocación
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
