---
adr: ADR-0013
status: accepted
date: 2026-09-03
---

# Tiempo canónico, orden y determinismo numérico

## Contexto

INV-010 exige que la misma entrada produzca el mismo hash semántico, e INV-001 que reordenar filas
con timestamps distintos no cambie el resultado. Faltaban tres piezas para que eso fuera cierto:
la representación canónica del tiempo (RSK-012, OQ-B02), el desempate cuando dos timestamps son
iguales, y qué se hace con los números en coma flotante que entran al hash.

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

**Orden.** El orden canónico es `(t_utc, source_hash, source_row)`, ascendente. Es total,
determinista e independiente del orden de llegada de los ficheros. El orden físico original se
conserva aparte para auditoría.

**Números.** Antes de entrar al hash semántico, todo número real se canonicaliza a cadena decimal
con signo explícito, punto como separador y un número fijo de decimales declarado por cada métrica.
Cero negativo, `NaN` e infinitos se rechazan. El hash cubre la salida semántica; quedan fuera solo
los metadatos declarados no deterministas en `ARCHITECTURE.md` §9.

## Consecuencias

- El determinismo deja de depender del motor de JavaScript y del orden de importación.
- Los cambios horarios se ven en lugar de corromper turnos y secuencias en silencio.
- Cada métrica debe declarar su precisión; es trabajo explícito, y evita que optimizar una fórmula
  cambie el hash sin cambiar el diagnóstico (INV-012).
- Los tests DST exigidos por OQ-B02 tienen ahora algo concreto que comprobar.
