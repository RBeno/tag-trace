# Fixtures sintéticos de acumulación

- Dataset ID/version: `acumulacion-basica/1`
- Generador: escritos a mano para F1a
- `synthetic: true`
- Propósito: ejercitar la unión por tramo común (TC-015), la cobertura (R-DAT-007) y la
  persistencia entre sesiones
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

`ventana-1` y `ventana-2` **se solapan**: comparten las lecturas de 5:09:30, 5:10:00 y 5:10:30.
Unidas deben dar 9 lecturas distintas, no 12, y el solape debe conservar las dos procedencias.

`ventana-lejana` es disjunta de las otras dos, a dos días de distancia. Su cobertura debe salir
como un **segundo tramo**, y el hueco entre medias como `sin datos cargados` — nunca como un
silencio del circuito, que es el falso diagnóstico que R-DAT-007 existe para evitar.

Cada fichero está en orden de pila descendente, como la fuente real: la primera fila es la más
reciente. La cobertura de cada uno termina en su penúltimo instante distinto, porque el último
viene cortado.
