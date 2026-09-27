---
adr: ADR-0016
status: accepted
date: 2026-09-27
---

# El plano físico: ubicaciones estables, cambios confirmados y estadísticas combinables

## Contexto

Al comparar el esbozo inicial del propietario con el programa (2026-09-27) salieron tres ideas del
esbozo que se habían perdido y que tienen valor:

1. **La ubicación y el tag instalado en ella no son la misma identidad.** Hasta 3.52.0 cada vértice
   de la instantánea se identifica por el código del tag. Una sustitución se detecta como
   «sustitución candidata», pero la historia del tramo se corta: el vértice nuevo empieza de cero.
2. **El plano físico no se reconstruye en cada fichero.** El anillo de cada instantánea sale del
   ciclo dominante de ese fichero, así que un tag que no se lee ni una vez sale de él y la evolución
   lo cuenta como «desaparece»: una avería reescribe el plano.
3. **Estadísticas que se suman entre periodos.** Los percentiles de dos periodos no se combinan sin
   las muestras; la media con su suma de cuadrados de desviaciones (M2) sí.

El propietario lo aprobó («Aplica los puntos que has propuesto 1, 2 y 3») y añadió que una
ubicación **puede existir sin tag físico**, y que eso resuelve un problema detectado: los tags de
parada por salida de circuito hacia otros circuitos prácticamente nunca se recorren, así que para
las lecturas no existen; deben entrar en el plano como **salidas del grafo** y revisarse a mano.

## Decisión

1. **Ubicación ≠ tag.** El plano del circuito es un conjunto de **ubicaciones** con identidad
   estable (`U-0001`…), cada una con su clase —`anillo` o `salida`—, y a lo largo del tiempo un tag
   instalado o ninguno. Sustituir el tag de una ubicación cambia la instalación, no la ubicación:
   la historia del tramo sigue.
2. **El plano es un registro de eventos append-only con fecha efectiva**: crear el plano desde una
   versión consolidada, crear una ubicación entre dos del anillo o como salida de una, instalar,
   retirar o sustituir un tag, cerrar una ubicación y registrar una revisión manual. Cada evento
   lleva su razón y su evidencia. El plano vigente en un instante sale de recorrer los eventos hasta
   ese instante, así que **cada fichero se interpreta con el plano que existía entonces** y ningún
   evento reescribe el pasado.
3. **Ninguna IA cambia el plano.** El Worker **propone** cambios con su evidencia —un código que se
   lee entre dos ubicaciones y no está instalado en ninguna, o que aparece donde una ubicación deja
   de leerse— y solo la confirmación de una persona los escribe (ADR-0010, R-MEM-001).
4. **El plano persiste frente a las lecturas.** Una ubicación cuyo tag no se lee en un fichero no
   sale del plano: queda «no observada», con las pasadas por su sitio como oportunidades
   (observación inferida) o «sin ocasión» si no hay prueba de que se pasara. La evolución lo dice
   así y no como «desaparece».
5. **Las salidas se revisan a mano.** Una ubicación `salida` cuelga de una ubicación del anillo, no
   entra en ninguna tasa ni en ninguna conexión del anillo, y su estado es la última revisión
   manual registrada (fecha, resultado y nota): una observación confirmada, no inferida.
6. **Estadísticas combinables.** Cada horquilla guarda además la media y M2 (Welford), y las
   estadísticas de dos periodos se combinan de forma exacta (Chan). Por ubicación y periodo se
   guardan oportunidades evaluables, lecturas correctas, omisiones e inciertos; una tasa nunca va
   sin su número de oportunidades.

## Consecuencias

- Almacén local versión 8 con la tabla `plan` (eventos por `[circuitId, seq]`); `.agvproj` esquema 4
  con la sección `plano`. Los esquemas 1 a 3 se siguen abriendo.
- Las instantáneas no cambian de identidad: siguen siendo mediciones por código de tag. El plano
  las traduce a ubicaciones con la instalación vigente en su ventana.
- Un circuito sin plano sigue funcionando como hasta ahora. El plano se crea con una acción humana
  desde una versión consolidada.
- Lo que no se sabe no se inventa: coordenadas y distancias no existen todavía; los inciertos se
  dan como desconocidos (`null`) cuando la instantánea no permite contarlos.

## Alternativas descartadas

- **Identificar la ubicación por el par de vecinos.** Cambia en cuanto se inserta un tag al lado.
- **Guardar el plano como una copia completa por versión.** Duplica todo en cada cambio y no dice qué
  cambió ni por qué.
- **Crear o retirar ubicaciones automáticamente con un umbral.** Un tag averiado reescribiría el
  plano, que es justo lo que esta decisión evita.
