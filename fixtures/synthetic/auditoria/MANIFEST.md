# Circuito de auditoría con verdad conocida

- Dataset ID/version: `auditoria/1`
- Generador: `tests/support/circuito-auditoria.ts`, con semilla `20260920`
- `synthetic: true`
- Propósito: medir **cuánto de lo que puede ir mal en un circuito real llega a decirse**. Cada clase
  de fallo está plantada a propósito, con los tags y vehículos implicados conocidos de antemano, de
  modo que detectar o no detectar es una cifra y no una impresión.
- Periodo ficticio: septiembre de 2026, inventado
- Configuración ficticia asociada: zona `Europe/Madrid`

## Garantía de privacidad

- [x] IDs inventados
- [x] Fechas y horarios inventados
- [x] Topología inventada
- [x] Distribuciones no copiadas literalmente de datos reales
- [x] Sin nombres de planta, sistema o personal
- [x] Revisado antes de commit

## Los datos no están aquí, y es a propósito

Doscientas cincuenta mil filas son megabytes que envejecen y que nadie va a leer en una revisión.
Lo que se versiona es el **generador**: con la misma semilla produce siempre el mismo escenario, así
que es reproducible sin ocupar el repositorio. Es el mismo criterio que ya sigue
`tests/e2e/rendimiento.spec.ts` con su fuente de cien mil filas.

Para mirarlo a mano: `npx vite-node scripts/generar-auditoria.ts` deja las dos CSV en `local/`.

## Escenario

150 tags declarados en la lista `circuito`, 40 vehículos, 30 h de ventana, ~252.000 lecturas.
**147 tags llegan a leerse**; los otros 3 están declarados y no los lee nadie.

| Clase plantada | Dónde | Qué debe decir el producto | Qué **no** puede decir |
|---|---|---|---|
| `declarado-sin-lecturas` | 3 tags | `obsoleto-candidato`, `unknown` | avería del tag, ni omitirlo |
| `lectura-alta` | 10 tags al 95–100 % | `uniforme-alto`: nada que mirar | bimodal ni uniforme-bajo |
| `lectura-media` | 10 tags al 20–90 % | `uniforme-bajo` o `gradiente`, apuntando al tag | culpar a vehículos concretos |
| `omision-por-memoria` | 2 tags, 5 AGV | `bimodal-candidato` nombrando **esos** vehículos | que el tag esté averiado |
| `omision-conservando-convoy` | 5 tags seguidos, 1 AGV | paso probado por tiempo u orden (R-OPP-014) | que esos tags fallen |
| `rotura-subita` | 2 tags | el **instante** en que dejó de leerse | una tasa media que mezcle antes y después |
| `degradacion-progresiva` | 2 tags, 90 % → 40 % | una **tendencia** a la baja | una tasa media estable que lo esconda |
| `mantenimiento-aislado` | 2 tags fuera del anillo | enumerados aparte y sin clasificar (R-GRA-011) | contarlos como parte del circuito |

## Resultados prohibidos

Además de lo que dice la tabla, hay dos cosas que esta auditoría vigila por encima de todo:

1. **Ningún falso positivo sobre los tags sanos.** Señalar un tag que está bien es peor que no
   señalar uno que está mal: es lo que hace que nadie vuelva a mirar la herramienta.
2. **Que la lista de deuda no mienta.** Las clases que hoy no se detectan están enumeradas en
   `tests/audit/auditoria.test.ts`, y la prueba falla **también** si alguna empieza a detectarse sin
   que se saque de la lista. Una deuda que no se actualiza sola acaba siendo un `TODO` viejo.
