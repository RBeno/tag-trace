---
document_id: TT-MANUAL-001
version: 0.2.0
status: baseline-candidate
last_updated: 2026-10-18
---

# Manual de uso

Para quien usa TAG TRACE en planta, en el PC o en el móvil. Lo que pasa cuando algo falla está en
[`GUIA_DE_DIAGNOSTICO.md`](GUIA_DE_DIAGNOSTICO.md); copias, actualizaciones y soporte, en
[`OPERACION.md`](OPERACION.md).

## 1. Qué es y qué no es

TAG TRACE lee las exportaciones de lecturas de tags de un circuito de AGV y las analiza **en el propio
dispositivo**: los ficheros no salen de él, no hay servidor ni cuenta, y funciona sin red una vez
abierta. Es **solo de observación**: no se conecta a los AGV, ni a los lectores, ni al servidor de
planta, y no da órdenes.

Lo que no sabe, lo dice: «sin determinar» o «sin dato» no es un fallo, es que con lo cargado no se puede
afirmar. Las cifras «provisionales» son valores de partida hasta que la memoria del circuito los mida y
una persona los confirme.

## 2. Abrir e instalar

- Dirección: <https://rbeno.github.io/tag-trace/>, en Chrome (móvil) o Chrome o Edge (PC).
- Para tenerla como aplicación: menú del navegador → «Instalar aplicación» o «Añadir a pantalla de
  inicio». Abre igual sin red.
- La cabecera dice la versión abierta («Versión X.Y.Z»).

## 3. Análisis e importación

Arriba, en **Análisis**, están los análisis guardados en este dispositivo, el último usado primero, con
cuántos ficheros, de qué fechas, cuántas listas y si tienen flota y conexiones.

- **Añadir lecturas a uno guardado**: púlsalo en la lista (su nombre pasa a **Circuito**) y elige el
  fichero. Lo nuevo se acumula en ese análisis.
- **Nuevo análisis…**: escribe el nombre y, en **Partir de**, elige uno guardado para copiarle sus listas
  de tags (circuito, áreas, carga online, críticos, zona cargada/vacía, tramos…) y su historial de flota,
  o «Ninguno» para empezar vacío. Las lecturas, la memoria, la revisión y los expedientes no se copian.
  Después ve añadiendo lo que tengas: lecturas aquí, y listas, flota o conexiones con «Cargar listas, flota
  o conexiones…» (pestaña Datos), en cualquier orden.
- Debajo, **Datos de «X»** dice lo que ese análisis ya tiene y lo que le falta.

Para importar:

1. En **Fichero de lecturas**, «Elegir fichero…» y la exportación (CSV, TXT o Excel).
2. En **Circuito**, el análisis (lo rellena la lista, o se escribe). Con nombre, lo importado **se acumula**
   en ese análisis y se guarda en el dispositivo; un nombre nuevo lo crea; sin nombre, se analiza y no se
   guarda nada.
3. Mientras importa, la barra de progreso y «Cancelar». Cancelar responde en menos de un segundo hasta
   que empieza a guardar; desde «Guardando en este dispositivo; ya no se puede cancelar», termina sola.
4. Al terminar, el Resumen: la frase de estado, las cifras y los hallazgos.

Si el fichero es de otro circuito, no se acumula y se dice por qué. Si la fecha es ambigua (día y mes
intercambiables), se pide el formato.

## 4. Las pestañas

| Pestaña | Para qué |
|---|---|
| **Resumen** | Estado del circuito en una frase, cifras, avisos, problemas detectados y la bandeja de hallazgos para revisar. «Generar informe…» descarga el informe del circuito. |
| **Tags** | Qué tags se leen, cuáles no, cambios de tag, lo declarado en planta. |
| **AGV** | Cada vehículo: lectura, paradas, flota del circuito. |
| **WiFi** | Solo con el registro de conexiones cargado: cortes, mapa y quién no reconecta. |
| **Tiempos** | Tiempos entre tags, horquillas, evolución entre ficheros. |
| **Línea y calles** | Alimentación de la línea, incidencias, calles de carga, FIFO y los **expedientes de incidencia**. |
| **Memoria** | La memoria consolidada del circuito: versiones, comparación y consolidar. |
| **Datos** | Listas, flota, conexiones, valores de planta, **copia del circuito**, espacio, lecturas y «Medir este dispositivo». |

Arriba, **Expediente** busca un AGV o un tag y enseña todo lo suyo. Cada gráfico tiene «Ver los mismos
datos en tabla». Con el dedo, un toque fija la lectura de un gráfico.

## 5. Revisar y consolidar

1. En la bandeja del Resumen, cada hallazgo tiene **Revisión en campo**: confirmado, descartado o
   pospuesto, con nota si hace falta. «Siguiente pendiente» lleva al siguiente.
2. Cuando el periodo es normal y no queda nada grave pendiente, en **Memoria**, «Previsualizar vN»
   enseña qué se guardaría; «Confirmar y consolidar» lo guarda. La consolidación la decide siempre una
   persona; el programa nunca consolida solo.
3. Una versión se puede revocar con razón; nada se borra.

## 6. Expedientes de incidencia

En **Línea y calles → Expedientes de incidencia**, «Nuevo expediente…» con título, síntoma, principio y
fin, y los tags o el AGV si se conocen. El expediente congela las lecturas de su ventana y enseña:

- el **retroceso desde el síntoma**: qué pasó antes, durante y después, frente a lo esperado;
- el **replay** de los AGV, con lo visto, lo esperado y la conexión;
- las **hipótesis**: el programa propone, una persona confirma o descarta con su comprobación;
- **casos parecidos** del circuito, comparados a la vista;
- **contramedidas** y su **verificación** antes y después.

Ningún texto del programa afirma una causa: dice «precede», «es compatible con» o «contradice». La
causa la confirma una persona. «Informe del expediente» descarga un HTML que se abre sin red y se
imprime a PDF; también hay CSV de la cronología y de las lecturas.

## 7. Copia, espacio y borrado

- **Exportar circuito (.agvproj)** (Datos → Copia del circuito) descarga un fichero con todo lo del
  circuito salvo las lecturas en bruto: fuentes, instantáneas, memoria, plano, valores de planta,
  revisión en campo y expedientes con sus recortes. **Hágalo después de cada consolidación.**
- **Abrir un circuito exportado (.agvproj)** lo incorpora sin mezclar historiales; lo que no coincide se
  dice y no se toca.
- **Espacio en este dispositivo** dice cuánto ocupa y si el navegador lo guarda de forma persistente.
- **Borrar el circuito…** enumera lo que se pierde, pide escribir el nombre y lo borra entero.

## 8. Actualizaciones

Una versión nueva no se instala sola: aparece «Hay una versión nueva: X» con lo que pasa con lo guardado
y «Cambiar a X». No se puede cambiar con una importación, análisis, exportación o consolidación en
curso. Si cambia el formato de lo guardado, se pide exportar antes la copia.

## 9. Medir el dispositivo

En **Datos → Medir este dispositivo**, «Medir los tres» genera volúmenes sintéticos, los analiza sin
guardar nada y dice si cada cifra está dentro del presupuesto. Deje la pestaña a la vista mientras
mide. «Descargar el informe (JSON)» es lo que se devuelve para el piloto.
