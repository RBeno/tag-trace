# Fixtures sintéticos de anillo cerrado

- Dataset ID/version: `anillo/1`
- Generador: escrito a mano para F2
- `synthetic: true`
- Propósito: ejercitar el grafo observado con ciclo real, el agrupamiento por circuito, las vueltas
  segmentadas, el contraste contra Vsystem y el replay — los cinco módulos necesitan un anillo que
  de verdad se repita, y los fixtures de `acumulacion/` son deliberadamente lineales y no lo tienen.
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

`lecturas.csv`: dos vehículos, `0007` y `0042`, recorren el mismo anillo de cuatro tags
(`0100→0200→0300→0400→0100…`) tres veces cada uno. Comparten las cuatro aristas, así que deben
agruparse en **un solo cohorte de dos vehículos** (R-DAT-012): no hay nada en el fichero que separe
un circuito de otro, y agruparlos en dos sería el defecto que la prueba existe para impedir.

El ciclo dominante debe cerrar en las cuatro paradas con cuota 1,0 (nadie se desvía nunca), así que
`0007` debe segmentar en **dos vueltas completas y una parcial** (la parcial es el tramo final,
cortado por el fin de los datos y no por el circuito).

`listas.csv` declara el circuito como `0100→0200→0300→0999`, con `0999` **sin ninguna lectura**.
El anillo observado tiene `0400` exactamente en esa posición. El contraste contra Vsystem debe
señalar `0999` como `sustituido-candidato` por `0400`, y las otras tres posiciones como `coincide`.

**Prohibido**: que `0007` y `0042` salgan en cohortes distintos; que alguna arista del ciclo salga
`inferred` por cuota (aquí la cuota es perfecta, 1,0); que `0999` se dé por sustituido sin más — el
veredicto tiene que llevar su evidencia y su estado `inferred`, nunca `observed`.
