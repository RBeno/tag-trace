---
adr: ADR-0013
status: accepted
date: 2026-09-10
---

# Tiempo canónico, orden y determinismo numérico

## Contexto

INV-010 exige que la misma entrada produzca el mismo hash semántico, e INV-001 que reordenar filas
con timestamps distintos no cambie el resultado. Faltaban tres piezas para que eso fuera cierto:
la representación canónica del tiempo (RSK-012, OQ-B02), el desempate cuando dos timestamps son
iguales, y qué se hace con los números en coma flotante que entran al hash.

La primera redacción de esta ADR fijó el desempate como `source_row` **ascendente**. Al contrastarla
contra la fuente real quedó demostrado que era incorrecta, y de forma silenciosa: ver §Orden. Se
corrige aquí porque esta decisión nunca llegó a estar en vigor —vivía en una propuesta de cambio sin
fusionar— así que no hay comportamiento pasado que preservar. El error y su medición quedan
registrados en el changelog.

## Decisión

**Tiempo.** Cada observación conserva a la vez:

- `t_utc`: entero, milisegundos desde epoch UTC. Es el único valor que se usa para calcular.
- `t_raw`: la cadena original, sin normalizar.
- `tz_id`: identificador IANA de la configuración aplicada.
- `t_flag`: `ok`, `dst_ambiguous` (hora repetida al retrasar el reloj) o `dst_nonexistent`
  (hora inexistente al adelantarlo).

Una fecha con formato día/mes indistinguible **no** se resuelve por suposición: produce
`DATE_AMBIGUOUS` y la fila queda en cuarentena hasta que el usuario fije el formato. Las horas
marcadas `dst_ambiguous` o `dst_nonexistent` se muestran como tales y no se usan para afirmar orden
dentro de la ventana afectada.

**Orden.** Cuando la resolución de la fuente es más gruesa que el paso real de un AGV, el reloj no
basta para ordenar y hace falta la posición en el fichero. Pero esa posición solo significa algo si
se conoce el **sentido de la fuente**, y el sentido es una propiedad de cómo se genera, no una
convención que se pueda elegir.

La fuente de lecturas es una **pila**: el servidor añade cada lectura según la recibe, la más
reciente arriba. Por tanto bajar por el fichero es retroceder en el tiempo, y dentro de un mismo
instante declarado la fila **posterior** es la **anterior** cronológicamente.

El orden canónico es `(t_utc, source_hash, source_row)` ascendente, con `source_row` orientado según
el sentido declarado de la fuente: ascendente si la fuente emite del más antiguo al más reciente,
descendente si emite como pila. El orden resultante es total, determinista e independiente del orden
de llegada de los ficheros. El orden físico original se conserva aparte para auditoría.

El sentido **se detecta y se mide**, no se supone:

- se calcula la monotonía del fichero y se registra en su procedencia;
- se muestra en la vista previa para que el usuario lo confirme antes de aceptar la fuente;
- un fichero cuya monotonía no sea limpia **no es un error de parseo**: sus inversiones son
  evidencia de entrega diferida —un AGV que estuvo sin comunicación y volcó después— y eso es un
  hecho diagnóstico que debe conservarse y señalarse, no descartarse.

El orden dentro de un mismo instante declarado es `inferred`, no `observed`: las lecturas son
evidencia directa, su secuencia interna es una reconstrucción con soporte medible.

**Números.** Antes de entrar al hash semántico, todo número real se canonicaliza a cadena decimal
con signo explícito, punto como separador y un número fijo de decimales declarado por cada métrica.
Cero negativo, `NaN` e infinitos se rechazan. El hash cubre la salida semántica; quedan fuera solo
los metadatos declarados no deterministas en `ARCHITECTURE.md` §9.

## Por qué el sentido no es un detalle

La primera redacción fijaba `source_row` ascendente sin más. Contrastada contra la fuente real,
donde la mayoría de las filas comparte instante declarado con otra del mismo AGV, las dos hipótesis
producen grafos muy distintos:

| Desempate | Aristas resultantes | Dominancia del sucesor principal |
|---|---:|---:|
| `source_row` ascendente | 1.173 | 0,691 |
| `source_row` descendente (sentido de pila) | 299 | 0,916 |

Cuatro veces más aristas espurias y una dominancia mucho peor. Nada habría fallado ni avisado: el
grafo sale plausible y equivocado. Es el modo de error que este proyecto existe para evitar, y por
eso el sentido se mide en cada fichero en lugar de asumirse una sola vez.

## Consecuencias

- El determinismo deja de depender del motor de JavaScript y del orden de importación.
- Los cambios horarios se ven en lugar de corromper turnos y secuencias en silencio.
- Cada métrica debe declarar su precisión; es trabajo explícito, y evita que optimizar una fórmula
  cambie el hash sin cambiar el diagnóstico (INV-012).
- Los tests DST exigidos por OQ-B02 tienen ahora algo concreto que comprobar.
- El sentido de la fuente pasa a ser parte de la procedencia, y una fuente nueva no se acepta sin
  que quede determinado.
- Medir la monotonía aporta un diagnóstico que antes no existía: las entregas diferidas se vuelven
  visibles en lugar de confundirse con desorden.
