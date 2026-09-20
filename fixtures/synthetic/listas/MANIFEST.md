# Fixtures sintéticos de listas de tags

- Dataset ID/version: `listas-circuito/1`
- Generador: escritas a mano para F2
- `synthetic: true`
- Propósito: ejercitar el importador de listas (DS-002, DS-006, DS-008) y el inventario contrastado
- Periodo ficticio: sin fechas; una lista es una declaración, no una observación
- Configuración ficticia asociada: el mismo circuito inventado de `fixtures/synthetic/acumulacion/`

## Garantía de privacidad

- [x] IDs inventados
- [x] Fechas y horarios inventados
- [x] Topología inventada
- [x] Distribuciones no copiadas literalmente de datos reales
- [x] Sin nombres de planta, sistema o personal
- [x] Revisado antes de commit

## Resultados esperados y prohibidos

El fichero está escrito como lo escribiría una persona, porque es como se escriben de verdad: no hay
forma de descargarlas del sistema de planta. Por eso incluye a propósito tres cosas que el
importador tiene que tolerar sin perder el fichero entero:

- **`Mantenimiento` con mayúscula**, que debe normalizarse a `mantenimiento`.
- **`semaforo-nuevo`**, una lista que el producto todavía no conoce. Debe **conservarse con su
  nombre y avisar**, nunca rechazarse: una categoría nueva es información, no un defecto.
- **`58999` declarado y en memoria, y sin una sola lectura** en las ventanas de `acumulacion/`. Es
  el caso de manual de un **tag obsoleto**: retirado del suelo y nunca borrado de la lista.

Contrastado contra esas ventanas, el inventario debe dar:

| Clase | Qué debe salir |
|---|---|
| `obsoleto-candidato` | los declarados sin ninguna lectura, con estado `unknown` y la acción de ir a comprobar si siguen instalados |
| `especial` | `57544` y `57545`, fuera del recorrido productivo y de toda tasa |
| `activo` | los tags que las ventanas cargadas sí leen |

**El recuento depende de qué ventanas estén cargadas, y eso es justamente lo que hay que ver.** Con
`ventana-1` y `ventana-2` hay **cinco** candidatos a obsoleto: `58999`, más `58029`, `58030`, `58031`
y `20115`, que solo aparecen en `ventana-lejana`. Al cargar también esa tercera ventana, cuatro de
los cinco dejan de serlo y queda `58999` solo.

Esa caída de cinco a uno es la demostración de R-DAT-016 en pequeño: con una sola ventana, un tag
obsoleto y uno que sencillamente no circuló por ahí producen el mismo dato, y lo que los separa no
es analizar mejor esa ventana — es cargar otra.

**Prohibido**: que `58999` salga como avería. Con una sola ventana, un obsoleto y un tag averiado
producen exactamente el mismo dato —cero lecturas— y elegir uno es sustituir `unknown` por la
hipótesis más probable (R-DAT-016, R-EVI-004). Lo resuelve una segunda ventana distante, no más
análisis de la misma.
