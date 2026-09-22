# Circuito de auditoría con verdad conocida

- Dataset ID/version: `auditoria/7`
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

Un cuarto de millón de filas son megabytes que envejecen y que nadie va a leer en una revisión.
Lo que se versiona es el **generador**: con la misma semilla produce siempre el mismo escenario, así
que es reproducible sin ocupar el repositorio. Es el mismo criterio que ya sigue
`tests/e2e/rendimiento.spec.ts` con su fuente de cien mil filas.

Para mirarlo a mano: `npx vite-node scripts/generar-auditoria.ts` deja las dos CSV en `local/` e
imprime dónde está plantado cada fallo, con sus tags y vehículos.

## Escenario

150 tags declarados en la lista `circuito`, 40 vehículos, 30 h de ventana, ~239.000 lecturas.
**147 tags llegan a leerse**; los otros 3 están declarados y no los lee nadie.

Además, **cinco calles de carga online** de tres tags cada una —entrada, parada precisa y salida—,
que es lo que R-CO-001 fija para el fixture sintético, y una **zona de vacíos** que engloba las
cinco calles más un tercio contiguo del anillo (R-FLO-003). La carga dura una media hora de media;
esa magnitud es del escenario, no de planta, y por eso vive en el generador y no en `src/`. Y un
**ancla de vuelta declarada** en la lista `ancla` (R-GRA-009): el primer tag del anillo.

El generador declara además un **corte** a mitad de ventana (coincidente con el instante de la
rotura súbita) para poder comparar un periodo temprano contra uno tardío sin necesitar una segunda
fuente real: la auditoría construye esa cobertura de dos tramos a mano, igual que ya hace con la de
`carga-online` (R-DAT-016).

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
| `carga-online-normal` | 4 calles, ~93 estancias | media hora entre parada y salida es **carga** (R-CO-006) | contarla como periodo de inactividad |
| `calle-sin-servicio` | 1 calle, 3 tags | la calle no se sirvió; sus tags, `calle-sin-servicio`, `unknown` | que esos 3 tags sean candidatos a obsoleto |
| `salida-fuera-de-antiguedad` | 1 AGV, 5 h dentro | el que más esperó, **el primero** de la lista (R-CO-003) | llamarlo avería: R-FLO-001 admite excepciones |
| `carga-anterior-a-la-ventana` | 5 AGV | estaban dentro antes de la cobertura (R-CO-007) | que estuvieran ausentes, ni la calle vacía |
| `zona-vacia-declarada` | 1/3 del anillo + calles | la zona se enumera y las calles caen dentro | que declararla mueva el veredicto de un tag sano |
| `lector-agv-degradado` | 1 AGV, sin otro papel | tendencia a la baja en la fila del **vehículo** (R-OPP-015) | que los tags que lee ese AGV salgan con tendencia o rotura |
| `adelantamiento-en-zona-cargada` | 1 AGV, sin otro papel | se enumera a quién adelantó y con qué margen, como candidato (R-FLO-001) | llamarlo avería: R-FLO-001 admite excepciones y OQ-107 no tiene el catálogo |
| `bifurcacion-real` | 1 tag del anillo, 1 tag fuera de anillo | candidato a bifurcación con las dos ramas y su cuota (R-GRA-007) | asignar la función, o llamarlo avería |
| `ancla-declarada` | 1 tag del anillo, declarado en la lista `ancla` | vueltas completas `observed`; el ancla efectiva es la declarada (R-GRA-009) | que declararla cambie qué tags forman el anillo, más allá de rotar el punto de inicio |
| `tag-nuevo-a-mitad-de-ventana` | 1 tag fuera de anillo | sin lecturas en el periodo temprano, con lecturas en el tardío: `nuevo` (R-DAT-016) | que sea obsoleto, o que existiera desde el principio de la ventana |
| `memoria-actualizada-a-mitad-de-ventana` | 5 tags contiguos, 1 AGV | ese vehículo dejó de leerlos a mitad de ventana; el resto de la flota los sigue leyendo (R-AGV-013) | que esos tags estén averiados, o acusar a otro vehículo |

## Resultados prohibidos

Además de lo que dice la tabla, hay dos cosas que esta auditoría vigila por encima de todo:

1. **Ningún falso positivo sobre los tags sanos.** Señalar un tag que está bien es peor que no
   señalar uno que está mal: es lo que hace que nadie vuelva a mirar la herramienta.
2. **Que la lista de deuda no mienta.** Las clases que hoy no se detectan están enumeradas en
   `tests/audit/auditoria.test.ts`, y la prueba falla **también** si alguna empieza a detectarse sin
   que se saque de la lista. Una deuda que no se actualiza sola acaba siendo un `TODO` viejo.

## Lo que este escenario todavía no ejercita

`R-FLO-006` —el orden de convoy no prueba nada en zona vacía— está implementado y con pruebas
unitarias propias, pero aquí **no llega a aplicarse**: casi todos los segmentos del anillo tienen
tiempo mediano medido, así que la decisión la toma la vía del tiempo y la del orden no se alcanza.
La auditoría lo publica como `pasadas retiradas de la vía de orden: 0` en lugar de callarlo, porque
una regla que no se ejercita no está validada por este escenario aunque esté escrita.

