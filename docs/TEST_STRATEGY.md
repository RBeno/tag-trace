---
document_id: TT-TEST-001
version: 0.33.0
status: baseline-candidate
last_updated: 2026-09-25
---

# Estrategia de pruebas y evaluación

## 1. Objetivo

Demostrar corrección industrial, trazabilidad, determinismo, privacidad, compatibilidad y uso razonable de recursos. Que la interfaz muestre un resultado no constituye una validación.

## 2. Capas

| Capa | Qué verifica | Ejecución |
|---|---|---|
| Tipos/estático | Contratos, dependencias y errores básicos | Cada cambio |
| Unitarias | Reglas y funciones puras | Cada cambio |
| Propiedades | Invariantes para entradas generadas | Cada cambio relevante |
| Casos de oro | Resultado industrial esperado y diagnósticos prohibidos | Cada cambio |
| Auditoría | Cuánto de lo que puede ir mal llega a decirse, sobre un circuito con la verdad plantada | Cada cambio del diagnóstico |
| Integración | Importación→análisis→persistencia→reapertura | Cada cambio del flujo |
| Migración | Compatibilidad y round-trip de `.agvproj` | Cambio de esquema/release |
| E2E | Flujo real de usuario en navegadores y móvil emulado | Solicitud/release según coste |
| Dispositivo físico | Rendimiento, archivos y gestos reales | Puertas de fase/release |
| Seguridad | Ausencia de red, XSS, archivos maliciosos y secretos | Cada release |
| Rendimiento | Tiempo, RAM, tamaño y replay | Ligera por cambio; completa por release |

## 3. Invariantes obligatorios

| ID | Propiedad |
|---|---|
| INV-001 | Reordenar físicamente filas que tienen timestamps distintos no cambia el resultado semántico. |
| INV-002 | IDs con ceros iniciales conservan identidad y representación. |
| INV-003 | Una salida `observed` siempre posee procedencia directa. |
| INV-004 | Una oportunidad/inferencia nunca aparece como lectura observada. |
| INV-005 | Añadir una copia exacta solapada no duplica métricas, pero sí conserva procedencia. |
| INV-006 | Cancelar no deja una consolidación parcial ni un proyecto aparentemente válido. |
| INV-007 | Consolidar dos veces el mismo análisis/estado no duplica contenido semántico. |
| INV-008 | Guardar una incidencia no altera el perfil esperado. |
| INV-009 | Un archivo ajeno no puede consolidarse en el circuito activo. |
| INV-010 | Mismo input+configuración+versiones produce el mismo hash semántico. |
| INV-011 | Exportar/importar sin migración conserva el estado semántico. |
| INV-012 | Optimizar representación no cambia hallazgos ni evidencia. |
| INV-013 | Un intervalo fuera de la cobertura nunca produce un hallazgo. |
| INV-014 | Unir dos fuentes solapadas no cambia el número de eventos lógicos ni elimina pasos repetidos legítimos. |

## 4. Catálogo inicial de casos de oro

| ID | Escenario | Debe producir | No debe producir |
|---|---|---|---|
| TC-001 | Recorrido normal estable | Grafo y perfil con soporte | Alertas artificiales |
| TC-002 | Un AGV omite sistemáticamente un tag | Divergencia individual/cohorte | Fallo colectivo confirmado |
| TC-003 | Todos omiten el mismo tag | Divergencia colectiva | Culpar a un único AGV |
| TC-004 | Minoría ejecuta acción distinta | Sospecha de configuración antigua | Confirmación sin contraste |
| TC-005 | Hueco con continuidad antes/después | Continuidad inferida con confianza | Lecturas inventadas |
| TC-006 | Hueco ambiguo | `unknown`/censurado | Ruta exacta |
| TC-007 | Falta de WiFi | Ausencia de observaciones y hipótesis de comunicación | Salida física automática |
| TC-008 | FIFO correcto en cargados | Orden válido | Rotura FIFO |
| TC-009 | Reordenación en vacíos | Comportamiento permitido | Rotura FIFO cargado |
| TC-010 | Maniobra CO con doble lectura | Estado/maniobra compatible | Tag duplicado automático |
| TC-011 | Calle CO ocupada demasiado tiempo | Anomalía de permanencia | Diagnóstico por SOC |
| TC-012 | Punto crítico sin llegada diez minutos | Ventana de impacto y retroceso | Causa única no demostrada |
| TC-013 | Parada planificada | Comparación con calendario | Incidencia productiva falsa |
| TC-014 | Archivo de otro circuito | Cuarentena/bloqueo de consolidación | Mezcla de memoria |
| [TC-015](golden/TC-015-solape-entre-exportaciones.md) | Solape de dos CSV | Unión con doble procedencia | Doble recuento |
| TC-016 | Catálogo funcional parcial | `función no documentada` | Tag defectuoso |
| TC-017 | Incidencia guardada | Expediente reproducible separado | Cambio del esperado |
| TC-018 | Cambio colectivo sostenido y confirmado | Propuesta de nueva versión del grafo | Reescritura de histórico |
| [TC-019](golden/TC-019-delimitadores-e-identidad.md) | CSV con coma/punto y coma/tab | Importación equivalente | Pérdida de IDs/fechas |
| [TC-020](golden/TC-020-carrera-worker-interfaz.md) | Worker termina/cancela en orden adverso | Estado consistente | `0 lecturas` por carrera/sincronización |
| [TC-021](golden/TC-021-solape-con-maniobra.md) | Dos exportaciones solapadas que contienen un paso repetido A→B→A | Unión por tramo común: el solape cuenta una vez y el paso repetido se conserva | Fusión del paso repetido en un solo evento |
| [TC-022](golden/TC-022-fuera-de-cobertura.md) | Consulta sobre un intervalo fuera de la cobertura cargada | `sin datos cargados` | Parada, silencio colectivo o degradación de salud |
| [TC-023](golden/TC-023-entrega-diferida.md) | Fuente con inversiones de orden respecto a su sentido declarado | Señal de entrega diferida, con las filas conservadas | Rechazo del fichero o reordenación silenciosa |
| TC-024 | Tag sano durante un multicircuito que reduce el alcance de detección | Ausencias tratadas como esperables en ese contexto | Diagnóstico de tag degradado |
| TC-025 | Periodo sin multicircuito conocido | Salud publicada con el confusor declarado | Conclusión presentada como si el contexto fuera homogéneo |
| TC-026 | Un AGV deja de emitir mientras el resto sigue con normalidad | Periodo de inactividad individual, con última lectura conocida e hipótesis ordenadas | Avería, pérdida de comunicación o salida de circuito afirmadas como causa única |
| TC-027 | Todos los AGV callan a la vez dentro de la cobertura | Hipótesis colectiva: infraestructura, proceso o parada | Inactividad individual imputada a cada AGV |
| TC-028 | AGV que nunca recorre una rama del circuito | Los tags de esa rama no cuentan como ausencias | Lista de «tags no leídos» obtenida restando el catálogo a lo leído |
| TC-029 | Un solo AGV deja de leer un tag que los demás siguen leyendo | Hipótesis sobre ese AGV o su lector, con el instante de cambio | Tag declarado defectuoso |
| TC-030 | Silencio cuya última lectura es el tag de parada de una calle CO configurada y que reanuda por su secuencia declarada | Permanencia en carga online, inferida, con la calle identificada | Avería, inactividad anómala o salida de circuito |
| TC-031 | Desaparición y reaparición conservando los mismos vecinos, sin intercambio de AGV | Permanencia en el circuito demostrada, con la causa aún abierta entre detención y circulación sin lectura | Salida de circuito, retirada, o una causa única afirmada |
| TC-032 | La misma firma de calle CO pero sin calles configuradas | `unknown` declarando que falta la configuración | Inferencia de carga online por proximidad al último tag |
| TC-033 | Un AGV calla y sus vecinos tampoco avanzan durante la ventana | Fallo colectivo de la línea, con la causa buscada aguas arriba | Fallo individual atribuido al AGV que se consultó |
| TC-034 | Un AGV calla, sus vecinos avanzan con normalidad y él reaparece en posición muy por encima del tiempo esperado del tramo | Detención individual anómala, con el exceso cuantificado frente al esperado robusto | Conclusión basada en un umbral absoluto en lugar del esperado del tramo |
| TC-035 | La misma firma de vecindario observada en zona vacía, donde se admite reordenación | Confianza reducida y declarada | La misma conclusión que en zona cargada, sin ajustar la confianza |
| TC-036 | Dos exportaciones solapadas acumuladas en el mismo circuito, en un navegador real | El solape se cuenta una vez, conserva las dos procedencias y la cobertura sale en un solo tramo | Doble recuento, o pérdida de una de las dos procedencias |
| TC-037 | Dos exportaciones **disjuntas** acumuladas en el mismo circuito | Cobertura en dos tramos, con el hueco declarado `sin datos cargados` | El hueco presentado como silencio del circuito, o una cobertura continua inventada |
| TC-038 | Recargar la página tras acumular | El circuito sigue completo | Pérdida de lo acumulado, que con una ventana de servidor de pocos días es irreversible |
| TC-039 | Cancelar una importación a mitad | El almacén queda exactamente como estaba | Un circuito a medias con aspecto de estar bien |
| TC-040 | `.agvproj` exportado, reabierto, y después con un byte alterado | La ida y vuelta conserva el estado; el alterado se rechaza entero **sin tocar el almacén** | Carga parcial, o un fichero corrupto indistinguible de uno válido |
| TC-041 | El flujo completo de importación y acumulación con todo el tráfico interceptado | Ninguna petición fuera del propio origen | Cualquier recurso externo, aunque sea una fuente o un icono |
| TC-042 | Un tag presente en la lista de memoria que **ningún vehículo ha leído jamás** | `obsoleto-candidato` con estado `unknown` | Contarlo como avería, que es el falso positivo más convincente: viene con una lista detrás |
| TC-043 | Un tag que unos vehículos leen siempre y otro, con recorrido de sobra, nunca | `ciego-parcial` como **inferencia**, con los vehículos enumerados | Presentarlo como hecho: con lista maestra la memoria individual no se observa (R-OPP-012) |
| TC-044 | El mismo silencio, pero de un vehículo con dos lecturas en toda la ventana | Ninguna ceguera: su recorrido no sostiene nada (R-OPP-010) | Convertir en ciego a un vehículo que apenas circuló |
| TC-045 | Un tag que el circuito virtual declara y que **ninguna memoria contiene** | `declarado-sin-memoria`: existe y nadie puede leerlo | Confundir un punto ciego de configuración con un tag averiado |
| TC-046 | Un tag que se lee sin estar declarado en el circuito virtual | `no-declarado-leido`: la lista va por detrás del suelo | Descartarlo por no estar declarado, que es dar la razón a la lista frente al dato |
| TC-047 | Ningún vehículo alcanza el recorrido mínimo | La ceguera se declara **no comprobada** | Dejar creer que se comprobó y no había |
| TC-048 | Dos ventanas separadas por semanas, con el mismo vehículo en las dos | La transición que las uniría se descarta y se cuenta | Una arista entre dos puntos cualesquiera, con un tramo de semanas |
| TC-049 | Dos tags que un vehículo lee siempre en el mismo instante | Arista `inferred` con evidencia `mismo-instante`, aunque cuota y soporte sobren | `observed`: lo que la sostiene es la pila, no el reloj (R-DAT-013) |
| TC-050 | Anillo recorrido en segundos sobre una fuente de resolución de minuto | Secuencia `observed` y tiempo `unknown` | Una mediana calculada sobre ceros |
| TC-051 | Un nodo cuyas salidas se reparten a la mitad entre dos ramas que reconvergen | Las dos ramas `inferred`, ninguna afirmada sola | Elegir la mayoritaria y esconder la otra |
| TC-052 | La misma pila interpretada con el sentido contrario | El grafo sale invertido, y por eso el sentido se mide y no se supone | Un grafo plausible y del revés, sin síntoma visible (ADR-0013) |
| TC-053 | Exportación sin ningún tag en común cargada sobre un circuito ya formado | Se señala como de otro circuito y **el almacén no se toca**; sus lecturas sí se muestran | Acumularla: una vez unida no hay forma de separarla |
| TC-054 | Primera fuente de un circuito vacío | Entra, declarando que se acepta **sin haberla comprobado** | Un veredicto de afinidad sin nada contra lo que comparar |
| TC-055 | Fichero de listas con acentos, mayúsculas, plural y una categoría desconocida | Se normaliza lo reconocible y la categoría nueva se conserva con aviso | Rechazar el fichero por una lista que el producto aún no conoce |
| TC-056 | Importar una fuente en un circuito que ya tenía listas cargadas | Las listas sobreviven a la importación | Que reescribir el circuito las borre en silencio |
| TC-057 | Tag declarado y en memoria sin ninguna lectura, visto en la interfaz | `obsoleto-candidato`, `unknown`, y la acción a valorar escrita al lado | Presentarlo como avería, o no decir qué hay que hacer con él (R-EVI-006) |
| TC-058 | Las cuatro vistas con dos ventanas separadas | Cada una con su tabla equivalente; la cobertura en dos tramos y el hueco con trama | Que un hueco de datos se dibuje igual que un silencio (R-DAT-007) |
| TC-059 | Dos vehículos que comparten todas sus aristas, en el mismo fichero | Un solo cohorte de dos | Separarlos porque no coinciden exactamente a la vez |
| TC-060 | Fichero con tres circuitos mezclados bajo un mismo nombre | Tres cohortes, sin pista previa | Que el tercer vehículo, sin transición compartida, se cuele en un grupo ajeno |
| TC-061 | Ancla de vuelta hallada como ciclo dominante de un cohorte, sin ninguna declarada | Vueltas segmentadas, `inferred` aunque los datos sean perfectos | Que una vuelta completa salga `observed` sin una ancla declarada que la sostenga |
| TC-062 | Una vuelta que cruzaría un hueco de cobertura | Se degrada a parcial | Fingir un recorrido que no se observó |
| TC-063 | Expediente de un AGV, recuento contra su cohorte | Mediana de los compañeros, no de la flota | Comparar contra vehículos de otro circuito |
| TC-064 | Un tag declarado sin lecturas, con el anillo observado ocupando su hueco | `sustituido-candidato`, con el tag observado como evidencia | Confundirlo con un tag que sí se lee en otra posición del anillo |
| TC-065 | Replay en un instante anterior a la primera lectura de un vehículo | **`sin datos`**, diciendo cuándo llega su primera lectura | Interpolar una posición de partida, **y también llamarlo `silencio`** (R-GRA-010) |
| TC-066 | Replay en un instante exacto de lectura, con otra lectura después | `en-tag`, `observed` | `en-tránsito` con fracción 0 |
| TC-067 | Un periodo de inactividad en el expediente | Sus **dos extremos**: por dónde se fue y por dónde volvió (`UX_SPEC.md` §4.1) | Mostrar solo la duración, que no distingue una parada en su sitio de un tramo recorrido sin leer |
| TC-068 | Banda de actividad de un circuito con decenas de vehículos | La información de cada celda se lee al puntero, sin un nodo de rótulo por celda | Volver a un `<title>` por celda: 10.368 nodos y casi un segundo de hilo principal bloqueado |
| TC-069 | Tag de una rama que un vehículo nunca recorre, con matriz de lectura | Ese vehículo **no aparece** como lector fallido: no tiene pasadas por ahí | Un 0 % que convierta la rama en un tag averiado para media flota (R-OPP-008, R-OPP-013) |
| TC-070 | Tag que unos vehículos leen casi siempre y otros casi nunca | `bimodal-candidato`, `inferred`, con los dos grupos enumerados | Declararlo avería del tag cuando la mitad de la flota lo lee sin problema |
| TC-071 | Tag que todos los que pasan leen poco | `uniforme-bajo`, apuntando al tag o a su punto | Atribuirlo a un vehículo concreto |
| TC-072 | Tag con reparto continuo entre vehículos, sin dos grupos | `gradiente` y `unknown`, con la razón declarada (OQ-118) | Forzarlo a bimodal estrechando la franja intermedia |
| TC-073 | Par (vehículo, tag) con muy pocas pasadas | `sin-soporte`, `unknown` | Un porcentaje calculado sobre una o dos pasadas |
| TC-074 | Tag leído que el ciclo dominante deja fuera del anillo | Enumerado aparte, con cuántos vehículos lo leen y sin clasificar | Que desaparezca del análisis justo por leerse poco (R-GRA-011) |
| TC-075 | Matriz completa de un circuito grande en pantalla de móvil | Los casos destacados visibles sin desplegar nada; la matriz se construye **solo al abrirla** | Miles de celdas construidas de entrada para dejarlas escondidas |
| TC-076 | Vehículo que pierde **varios tags seguidos** y tarda lo que el tramo tarda | Pasada contada, probada **por tiempo**, con el tag sin leer | Perder la pasada por no tener vecino inmediato leído — que es cuando el problema es peor |
| TC-077 | Vehículo que recorre un tramo encerrado en mucho menos tiempo del que tarda | Ni pasada ni fallo del tag: tramo no sostenido, candidato a atajo o rama | Contarlo como pasada, o como tag no leído por ese vehículo |
| TC-078 | Tramo sin tiempo mediano medido, con el vehículo saliendo entre los mismos AGV | Pasada probada **por orden de convoy** (R-OPP-004) | Usar el orden para contradecir un tiempo que ya decidió |
| TC-079 | Convoy en el que el «vecino» es el propio vehículo en otra vuelta, o pasó horas antes | No cuenta como vecino: el orden no se da por conservado | Que cualquiera sea vecino de sí mismo y el orden se conserve siempre |
| TC-080 | Parada entre la parada precisa y la salida de la **misma** calle CO configurada | `carga-online`, `inferred`, con la calle nombrada (R-CO-006) | Contar esa media hora como periodo de inactividad |
| TC-081 | La misma parada **sin** las calles cargadas | Sigue siendo `silencio`: la firma no se reconoce | Aproximarla por proximidad a una calle cualquiera |
| TC-082 | Parada en una calle y salida por **otra** | No es una carga: es algo que hay que mirar | Darla por carga normal con una clave por tag suelto |
| TC-083 | Calle CO en la que no entró ningún vehículo en toda la cobertura | La calle se enumera sin servicio; sus tags, `calle-sin-servicio` y `unknown` (R-CO-008) | `obsoleto-candidato` sobre tres tags que nadie tuvo ocasión de leer |
| TC-084 | Vehículo cuya primera lectura de la cobertura es el tag de salida de una calle | Estaba dentro antes de empezar: `inferred`, entrada desconocida (R-CO-007) | Contarlo como ausente, o declarar la calle vacía en ese tramo |
| TC-085 | El mismo vehículo, pero con lecturas de anillo **antes** de esa salida | No es arranque en frío: entró y no se le vio entrar | Inferir una permanencia previa que el dato no sostiene |
| TC-086 | Vehículo que entró antes y salió después que otros de su calle | Se enumera la espera, **ordenada por su magnitud** (R-CO-003) | Llamarlo avería: R-FLO-001 admite excepciones documentadas |
| TC-087 | Calle con dos o tres estancias nada más | Sin mediana no se señala ninguna permanencia larga | Llamar «larga» a la mayor de dos |
| TC-088 | Calle declarada sin `parada-precisa`, o con dos tags con el mismo papel | No se monta, y el motivo se enseña junto al análisis | Elegir uno de los dos, o deducir el papel por la posición |
| TC-089 | Tramo encerrado que cae en zona vacía, o que cruza una entrada de calle | La vía de orden **no se usa**; el tramo queda sin sostener y se cuenta (R-FLO-006) | Dar el paso por bueno donde la reordenación está admitida |
| TC-090 | El mismo circuito analizado con y sin las listas de zona y calles | Ningún tag sano cambia de veredicto | Que declarar el contexto mueva un diagnóstico que no le corresponde |
| TC-091 | Tag que toda la flota lee con normalidad y deja de leerse de golpe a mitad de la ventana | `changedAtUtcMs` con el instante del corte, `rateBefore`/`rateAfter` (R-OPP-015) | Una tasa media que mezcle el antes y el después como si fuera un régimen |
| TC-092 | Tag que baja de forma sostenida en cuatro tramos temporales | `trend: "bajando"` con `segmentRates` monótonas | Una tasa media estable que esconda que va a peor, o llamarlo tendencia con una sola bajada aislada |
| TC-093 | Tag `bimodal-candidato` con las dos poblaciones de vehículos entrelazadas en el tiempo | `sin-cambio`: ni corte ni tendencia | Confundir la mezcla de dos poblaciones con una rotura |
| TC-094 | Un solo vehículo que se salta un tramo periódicamente (omisión conservando convoy) | `sin-cambio` en la línea temporal del tag | Leer el salto periódico como una tendencia del tag |
| TC-095 | Línea larga con una racha corta de mala suerte al final (pocas pasadas sin acierto entre muchas) | `sin-cambio`: la racha no representa una fracción real de la línea | Un corte que se apoye solo en el mínimo absoluto de pasadas por lado |
| TC-096 | AGV cuyo lector falla cada vez más en varios tags a la vez, con el resto de la flota leyendo con normalidad | `changedAtUtcMs`/`trend` en la fila del **vehículo**; ningún tag sano se ve afectado | Que el hallazgo se traslade a los tags que ese AGV lee |
| TC-097 | Tramos de zona cargada derivados del anillo, incluido uno que cruza el índice 0 del array | El tramo se camina entero, sin partirse en dos; un tramo de un solo tag se descarta y se declara | Un tramo cortado por el borde del array, o inventar zona para un tag sin declarar |
| TC-098 | Vehículo que entra casi a la vez que otro pero se demora y sale mucho después, dentro de un tramo cargado | Se enumera a quién adelantó y con qué margen, como candidato (R-FLO-001) | Llamarlo avería: R-FLO-001 admite excepciones y OQ-107 no tiene el catálogo |
| TC-099 | Inversión de orden dentro del margen de jitter normal de lectura (falso positivo) | Sin adelantamiento: el margen no se sostiene en las dos puntas | Un adelantamiento fabricado por ruido de reloj entre vehículos sanos |
| TC-100 | Tramo con menos pasadas completas que el mínimo exigido | Sin evaluar: ni mediana ni adelantamientos, aunque exista una inversión fabricada en la muestra | Forzar una mediana que decide un solo vehículo |
| TC-101 | Pasadas incompletas por un tramo (entrada repetida, salida sin entrada, pasada abierta al final) | Nunca cuentan ni para el tránsito mediano ni para un adelantamiento | Fabricar el extremo que falta en vez de declarar la pasada incompleta |
| TC-102 | Tag con un sucesor dominante (95 %) y una excepción rara con soporte suficiente | Sin candidato: la cuota no llega al mínimo aunque el soporte sí | Marcar cualquier excepción por poco frecuente que sea |
| TC-103 | Tag con reparto parejo (50/50) sostenido por un puñado de pasadas | Sin candidato: el soporte no llega al mínimo aunque la cuota sí | Confirmar un reparto que no tiene detrás pasadas de sobra |
| TC-104 | Tag con reparto real y estable en dos o tres ramas, sostenido en el tiempo | Candidato a bifurcación con sus ramas ordenadas por cuota, nunca función asignada (R-GRA-007) | Asignar la función en vez de proponerla |
| TC-105 | Tag justo antes de una rotura súbita aguas abajo, cuyo reparto agregado parece parejo | Sin candidato: ninguna rama se sostiene en las dos mitades de la ventana | Confundir un cambio de régimen temporal con una bifurcación real |
| TC-106 | Punto crítico declarado (lista `critico`), en memoria y nunca leído | `critico-sin-lectura`, con su función nombrada, nunca `obsoleto-candidato` (R-GRA-008) | Tratarlo como un obsoleto más, o como avería |
| TC-107 | El mismo punto crítico, pero fuera de la memoria maestra | `declarado-sin-memoria`, sin matiz — R-OPP-009 ya explica el silencio | Aplicar el matiz de R-GRA-008 cuando la memoria ya lo explica todo |
| TC-108 | Ancla declarada que aparece en el ciclo ya reconstruido | `resolveDeclaredAnchor` la resuelve como rotación del mismo ciclo, sin alterar el orden relativo | Recalcular la topología en vez de rotar el corte |
| TC-109 | Ancla declarada que no aparece en el ciclo reconstruido | `null`, con el problema declarado; se sigue con el ancla inferida | Inventar un corte que el dato no sostiene |
| TC-110 | Vuelta `completa` cortada por un ancla declarada y resuelta | `truth: "observed"` | Que siga `inferred` teniendo un ancla declarada que la sostiene |
| TC-111 | Vuelta `parcial` o que cruza un hueco de cobertura, con ancla declarada | `truth: "inferred"` en cualquier caso | Que la declaración del ancla convierta en `observed` un extremo que es un corte de los datos |
| TC-112 | Cobertura con un solo periodo, o con un hueco menor que `minGapMs` | La comparación no se evalúa (`evaluated: false`), con la razón declarada | Inventar una comparación sin dos muestras realmente distantes |
| TC-113 | Tag leído en el periodo temprano y sin ninguna lectura en el tardío | `desaparecido`, con las lecturas del periodo temprano como evidencia | Confundirlo con `obsoleto-candidato`: aquí sí hubo lectura antes |
| TC-114 | Tag sin lecturas en el temprano y con lecturas en el tardío | `nuevo` | Darlo por existente desde el principio de la ventana |
| TC-115 | Tag declarado y sin ninguna lectura en los dos periodos | `obsoleto-consolidado`; el mismo tag sin declarar no aparece | Consolidar un tag del que no se sabe ni que existe |
| TC-116 | Vehículo que deja de leer un conjunto de tags que sí leía, mientras el resto de la flota los sigue leyendo | Deriva de ese vehículo (R-AGV-013), nunca del tag | Acusar al tag cuando el resto de la flota lo sigue leyendo con normalidad |
| TC-117 | Vehículo con pocas lecturas de un tag probabilístico en el periodo temprano, que por azar no lo lee en el tardío | No cuenta como deriva: por debajo de `minReadingsPerVehicle`, el patrón no está sostenido | Confundir la variabilidad de una tasa ya conocida con una deriva de memoria |
| TC-118 | Un tag que desaparece y otro que ocupa su mismo hueco de secuencia, con vecino dominante compartido en un lado | `sustitucion-candidata`, con `nuevoTagId`, `sharedNeighbor` y `neighborSide` correctos; el nuevo no aparece también como `nuevo` suelto | Presentarlos como dos hallazgos sueltos sin relación |
| TC-119 | Dos tags `desaparecido` que comparten vecino con un mismo tag `nuevo` | Ninguno se empareja: quedan como `desaparecido`/`nuevo` sueltos (R-EVI-004) | Forzar una pareja cuando la correlación es ambigua en cualquiera de los dos sentidos |
| TC-120 | Una cadena de tres tags consecutivos sustituidos a la vez | Los dos extremos se emparejan por el vecino estable que cada uno conserva; el tramo central, sin vecino compartido en ningún lado, no se empareja | Emparejar el tramo central por transitividad, o dejar de emparejar los extremos |
| TC-121 | Tag `desaparecido`/`nuevo` con lecturas por debajo de `minReadingsPerVehicle` aunque compartan vecino | No se intenta el emparejamiento | Emparejar sobre un patrón sin soporte suficiente |
| TC-122 | Tag nuevo leído por al menos `minAdoptionShare` de los testigos tardíos, y un testigo tardío que no lo ha leído nunca | Ese vehículo aparece con el tag en `notAdoptedTags` | Señalar a un vehículo que no es testigo tardío, o cuando la adopción no alcanza el umbral |
| TC-123 | Tag nuevo leído por menos de `minAdoptionShare` de los testigos tardíos | Ningún vehículo se señala por ese tag | Fabricar un candidato de memoria no actualizada sin adopción mayoritaria real |
| TC-124 | Un vehículo con `droppedTags` y `notAdoptedTags` a la vez | Aparece una sola vez en `vehicleDrifts`, con las dos listas pobladas | Duplicar la entrada del vehículo, una por cada tipo de deriva |
| TC-125 | Dos ramas de un candidato a bifurcación cuyos sucesores dominantes reconvergen dentro de `maxHopsToReconverge` | Se reclasifica a `cruce`, con `reconvergesAt`/`hops` como evidencia | Dejarlo como bifurcación sin comprobar reconvergencia, o inventar un punto de encuentro |
| TC-126 | Dos ramas cuyos sucesores dominantes no reconvergen dentro del margen | Se queda como `bifurcacion` | Reclasificar a `cruce` una rama que en realidad no vuelve a encontrarse |
| TC-127 | Un candidato con tres ramas, donde solo un par de ellas reconverge | Se reclasifica a `cruce` igualmente: basta un par | Exigir que reconverjan todas las ramas a la vez |
| TC-128 | Tag con duración media larga y coeficiente de variación bajo | Candidato a `parada-precisa`, con media y CV como evidencia | Confundir un tránsito lento pero variable con una parada consistente |
| TC-129 | Tag con duración media larga pero CV alto | Sin candidato: tráfico variable, no parada | Aceptar la media sola sin mirar la varianza |
| TC-130 | Tag con duración corta y CV bajo | Sin candidato: es tránsito normal, no parada | Confundir cualquier duración de poca varianza con una parada |
| TC-131 | Tag con patrón de parada precisa pero pocas muestras | Sin candidato | Confirmar el patrón sin soporte suficiente |
| TC-132 | Duraciones con dos grupos claramente separados y compactos por separado | Candidato a `semaforo`, con la media de cada grupo | Tratar un salto bimodal limpio como ruido |
| TC-133 | Duraciones sin salto real (un solo grupo compacto) | Sin candidato | Fabricar dos grupos donde solo hay uno |
| TC-134 | Salto grande entre dos duraciones pero con uno de los dos lados disperso | Sin candidato (guarda de compacidad) | Confirmar bimodalidad con un lado que en realidad es ruido con un pico |
| TC-135 | Patrón bimodal con pocas muestras totales | Sin candidato | Confirmar semáforo sin pasadas de sobra |
| TC-136 | Transiciones `sameInstant: true` en el cálculo de parada precisa o semáforo | Nunca cuentan como duración (R-DAT-013) | Contar un empate del mismo instante como tránsito de 0 ms |
| TC-137 | Las nueve funciones de la taxonomía de `critico` (Parte 36) | Se aceptan sin aviso, `vinculacion`/`desvinculacion` incluidas | Rechazar o avisar sobre una función de la taxonomía |
| TC-138 | Entradas simuladas de `critico` y de `circuito` con función, concatenadas | `readCriticalPoints` produce el mismo `funcionOf` que si vinieran de una sola lista — el merge de fuentes vive en el llamador | Distinguir de qué lista viene cada entrada dentro de `readCriticalPoints` |
| TC-139 | Expediente de tag (`buildTagDossier`/`buildAllTagDossiers`) para un tag con función declarada | `criticalFunction` trae el valor; sin declarar, `null` | Omitir el campo, o no propagarlo desde `funcionOf` |
| TC-140 | Un tag declarado con función por la columna del circuito virtual, otro por la lista `critico`, en el mismo escenario de auditoría | Los dos aparecen en el expediente con su función; ningún tag sano trae una función sin plantar | Mezclar las dos vías de forma que una contamine tags que no la declararon |
| TC-141 | Línea de pasadas repartida en tramos de tiempo para dibujar (`binTimeline`) | Tramos iguales; un tramo sin pasadas sale `null`; con una sola pasada o todas en el mismo instante, ninguna serie | Pintar un tramo vacío como 0 %, o inventar una forma sin datos |
| TC-142 | Fila de la matriz con rotura o degradación, y fila sin cambio | La primera lleva `trendSeries`; la segunda no | Enviar series de filas sin nada que enseñar |
| TC-143 | Tramo cargado con un adelantamiento (`SpanReport.focus`) | La ventana lleva al adelantado y a todos los que lo adelantaron, en orden de entrada; sin adelantamientos, vacía | Dibujar un adelantamiento sin sus protagonistas |
| TC-144 | Un adelantado con decenas de vehículos por delante | La ventana nunca pasa de `FIFO_FOCUS_MAX` | Mandar a la interfaz todas las pasadas del tramo |
| TC-145 | Punto de enganche de una calle (`findLaneJunctions`) | El predecesor del anillo más frecuente de su entrada; una calle sin entradas desde el anillo no tiene punto | Inventar de dónde cuelga una calle |
| TC-146 | Duraciones por tag para dibujar (`transitionDurationsByTag`) | Los pares del mismo instante no entran (R-DAT-013) | Dibujar un empate del mismo instante como un tránsito de 0 s |
| TC-147 | Circuito de auditoría cargado en dos exportaciones, con listas, en el navegador | Las diez vistas de la Parte 38 se dibujan, llevan su tabla, ninguna emite un `<title>` por marca, la matriz es un `canvas` y la página no desborda | Volver a un nodo con rótulo por marca, o esconder una vista sin tabla equivalente |
| TC-148 | Vehículo con lecturas y ninguna estancia en ninguna calle (`neverCharged`) | Sale en la lista con su primera y última lectura; uno con estancia completa o con arranque en frío no sale | Juzgar su batería o afirmar por qué no carga (R-CO-004) |
| TC-149 | Historial de flota con columnas en otro orden, fechas con y sin hora (`importFleetHistory`) | Columnas por nombre; una fecha sin hora es a las 00:00; `hasta` vacío es periodo abierto | Leer las fechas como mes/día, o exigir el orden de las columnas |
| TC-150 | Filas sin AGV, con fecha inválida, con `hasta` no posterior a `desde` o cortas | Cada una contada con su motivo; las demás se cargan. Dos periodos que se pisan se avisan, no se rechazan | Rechazar el fichero entero por una fila, o elegir en silencio cuál de dos periodos manda |
| TC-151 | Segunda carga del historial con una fila de la misma clave (`mergeFleetPeriods`) | La fila con el mismo AGV y la misma alta sustituye a la guardada; las demás se conservan | Sustituir el historial entero como una lista |
| TC-152 | Asignado sin ninguna lectura (`buildFleetTimeline`) | Ausente en toda la ventana: cuenta en M y no en N | Hacerlo invisible porque no aparece en las lecturas |
| TC-153 | Tres asignados, uno en silencio sin calle | «2 de 3» exactamente en ese intervalo; la carga inferida y el arranque en frío sí cuentan como en funcionamiento | Contar un silencio como funcionamiento, o una carga como ausencia |
| TC-154 | Hueco de cobertura entre dos exportaciones | Sin datos, sin recuento en ese intervalo | Llamarlo silencio o ausencia (R-DAT-007) |
| TC-155 | Vehículo que lee sin estar asignado, y baja a mitad de ventana | Se cuenta aparte y nunca en N; la baja baja M desde ese instante y el AGV pasa a fuera. Sin historial, M son los vistos | Sumar a N a quien no está asignado, o seguir contando a un AGV dado de baja |
| TC-156 | Historial de flota con dos circuitos cargado en el navegador sobre el circuito de auditoría | La interfaz pregunta el circuito; el recuento «N de M» y la vida de cada AGV se dibujan con su tabla, sin `<title>` por marca; el asignado que no lee y el que lee tras su baja salen como hallazgos; el historial sobrevive a la importación siguiente | Repartir un fichero de varios circuitos adivinando, o perder el historial al acumular otra fuente |
| TC-157 | AGV que empieza a leer poco después del inicio de la cobertura, otro que tarda más que el umbral de silencio, y un silencio que cruza un hueco de cobertura | El primero cuenta como leyendo desde el borde; el segundo, ausente hasta su primera lectura; el hueco no deja trozos de silencio a sus lados | Que el peor momento de la ventana sea siempre su borde, o que un hueco entre exportaciones reste vehículos en funcionamiento |
| TC-158 | Expediente de un AGV con dos exportaciones cargadas y un hueco sin datos entre medias | El hueco no aparece como inactividad; un silencio con sus dos lecturas dentro de un mismo tramo sí; el silencio abierto se mide contra el final del último tramo | Listar como silencio del AGV el rato entre dos exportaciones (R-DAT-007) |
| TC-159 | Clave, recuento y CSV de la revisión (`src/domain/review.ts`) | La clave es tipo y sujeto; un cambio de cifra desde que se marcó se detecta; las marcas sin tarjeta se cuentan aparte; el CSV lleva los pendientes y escapa el separador | Perder una marca al reanalizar, o dar por buena una confirmación hecha sobre otra cifra |
| TC-160 | Marcar tarjetas en el navegador, recargar, volver a importar y exportar | Las marcas y la nota siguen en su tarjeta; el progreso cuenta 2 revisadas; el filtro esconde solo tarjetas; el CSV lleva confirmado, pospuesto y pendientes | Guardar la revisión dentro del circuito, donde la siguiente importación la pisaría |
| TC-161 | Imán de toque (`nearestWithin`) | Gana la marca más cercana dentro del radio; fuera del radio no hay ninguna; un toque dentro de una marca se queda con ella | Que un dedo no pueda leer una marca fina, o que lea una lejana |
| TC-162 | Tableta táctil emulada con el circuito de auditoría | Un toque fija la lectura y sigue ahí; un toque cerca de un segmento del anillo lo lee; un toque en el centro vuelve al reposo; botones de 44 px con dedo; el ratón sigue leyendo al pasar y limpia al salir; sin desbordamiento a 768, 1.024, 1.366, 1.536 y 1.920 px | Volver a depender del `pointermove`, que con el dedo borraba la lectura al levantarlo |
| TC-163 | Un tag sustituido a media ventana, dentro de un solo periodo | Un solo cambio con la hora del viejo y del nuevo, y la vida de cada uno | Dos hallazgos sueltos sin relación, o no verlo con una sola exportación |
| TC-164 | Frente al tag nuevo: un AGV que no lo lee, otro que lo deja de leer, otro que empieza tarde y otro que lo lee a medias | Cada uno con su hecho medido: nunca, desde una hora, más tarde, porcentaje; sin causa | Llamarlo memoria, lector o colocación; señalar a alguien si la flota aún no lee el tag |
| TC-165 | Dos tags seguidos sustituidos a la vez | Los dos cambios, por los vecinos de segundo orden | Perderlos porque el vecino inmediato de cada uno también desaparece |
| TC-166 | Un tag que se lee una de cada cinco veces; un cambio en el borde de la cobertura; dos nuevos en el mismo sitio; un nuevo que convive mucho con el viejo | Ningún cambio espurio, ninguno en el borde, ninguna pareja forzada | Tomar el ritmo de un tag flojo por un cambio, o contar dos veces el cambio entre periodos |
| TC-167 | Matriz con la vida de un tag recién puesto | Las pasadas de antes de existir no cuentan: se lee bien, no «todos lo leen poco»; cada celda lleva sus rachas de los dos extremos | Pedir revisar un tag recién instalado |
| TC-168 | Lectura por AGV: nunca, desde una hora, poco; en muchos y en pocos tags | Cifras por tag; «poco» solo si la diferencia con el resto no es casualidad; un tag que lee mal casi toda la flota no cuenta contra nadie | Un 76 % frente a un 85 % de la flota tomado por diferencia |
| TC-186 | Cero lecturas en pocas pasadas (`describeVehicleReading`) | 0 de 5 con el resto leyéndolo siempre → «nunca», con sus 5 pasadas, también en la fila del tag; con el resto al 85 %, 0 de 3 no se dice (azar) y 0 de 4 sí; ningún «poco» con un 0 % | «Lee poco: 0 %» |
| TC-169 | Auditoría con una sola exportación | Cambio 60438 → 99001, dos que dejan de leerse, uno que empieza, el AGV que no lee el nuevo; ciegos en «nunca», memoria actualizada en «desde una hora», lector degradado en «muchos», lectura desigual en «pocos»; nada fuera de lo plantado | Diferencias en AGV o tags sanos |
| TC-170 | Navegador con una sola exportación y las listas | Sección «Cambios de tag» con la pareja y el AGV que no lee el nuevo; tarjetas de AGV con cifras y sin causa | Volver a necesitar dos exportaciones para ver un cambio de tag |
| TC-171 | Lo habitual de cada tramo (`usualSegmentTimes`) | Mediana por turno en hora local (04:30 UTC son las 06:30 en Madrid), sin pares del mismo instante ni pasos que saltan un tag; sin muestras del turno, la de toda la ventana | Juzgar un tramo por el reloj UTC, o por un par sin duración |
| TC-172 | Clase de cada hueco (`classifySilence`) | Siguiente dentro de 3× lo habitual → no es hueco; más tarde → parado aunque dure horas; un tag → un tag; dos → varios; una hora y en otro punto → desconexión; fuera del anillo → sin clasificar; mantenimiento manda | Llamar habitual a un tag saltado; nombrar una causa |
| TC-173 | Vida de cada AGV con clases (`buildFleetTimeline`) | La clase y sus hechos llegan al tramo; un hueco habitual se dibuja leyendo y suma a N; un borde de una hora o más sin leer es desconexión y uno más corto un ausente sin clase | Contar como fuera de servicio el ritmo normal de un tramo |
| TC-175 | Paradas contra el flujo (`flowStops`, `productionStops`) sobre un anillo de 40 tags hecho a mano | Una cola de tres detrás de una cabeza parada 5 min con los críticos leyéndose → un bloqueo con los tres detrás; una cola que avanza cada 40 s → ninguno; 15 min sin críticos → parada de la producción, todo justificado, todos por su sitio; sin críticos → base «flota»; la misma hora dos días → repetida; uno que aparece delante de quien iba detrás → nombrado; un par que salta el hueco entre exportaciones o una calle de carga → no es parada | Tomar por parada de la producción un hueco que el azar explica; llamar bloqueo a una cola que fluye |
| TC-176 | Recuento de la flota con la regla nueva (`buildFleetTimeline`) | Un silencio entre lecturas y un borde de menos de una hora cuentan en el circuito, no leyendo; un borde dentro de una parada de la producción es parado y justificado; una hora sin leer sin explicar y mantenimiento no cuentan | Restar de N a un AGV parado en su sitio |
| TC-177 | Clase de un hueco justificado (`classifySilence`) | Con producción parada o en cola, una hora sin leer se clasifica por la posición (parado, un tag, varios); sin explicar, sigue siendo desconexión | Llamar desconexión a esperar en un descanso |
| TC-178 | Auditoría con tres paradas de la producción plantadas (reloj congelado tras generar) | Las tres detectadas y ninguna más, la de las 10:00 repetida; todos por su sitio; cada hueco dentro, justificado; el AGV retrasado, el único bloqueo; ningún hueco «desconexión»; las clases anteriores intactas | Una parada inventada, un bloqueo dentro de una franja, o una clase anterior perdida |
| TC-179 | Navegador con el circuito de auditoría | «Flota en el circuito» con los dos peores momentos; tarjeta de las tres paradas de la producción con la repetida; tarjeta del primero de la cola; leyenda con explicado, sin explicar y bloqueo | Volver a contar un silencio como fuera del circuito |
| TC-174 | Auditoría y navegador con el circuito de auditoría | El AGV que espera 20 min tras un tag y sigue por el siguiente sale parado, con el tag siguiente y lo habitual; ningún otro hueco en todo el escenario; la leyenda nombra las clases y su tabla da el porcentaje parado | Un hueco espurio en un AGV sano |
| TC-180 | Régimen y horquilla (`regimeReader`, `buildSegmentBands`, `bandFor`, `regimeExposure`) | La noche de 22 a 05 en hora local cruza la medianoche; el 80 % en 17 s y el resto hasta 30 s dan una valla de 60 s (80 s entra, 45 s no); la noche no toca la horquilla de producción; sin 20 muestras no hay horquilla y un salto usa la suma del anillo; las esperas de un semáforo quedan dentro; el tiempo cargado se reparte entre producción, noche y paradas | Una constante fija de parada; la noche mezclada con el día |
| TC-181 | Paradas contra la horquilla (`flowStops`) | 80 s donde se tarda 20, sin nadie que retenga y con el de delante avanzando → sin explicación con quién iba delante y cuánto avanzó; detrás de uno lento pero dentro de su horquilla → en cola, no sin explicación; de noche se mide contra la horquilla de noche; las nueve pruebas de la Parte 46 siguen igual | Dejar sin explicación a quien espera en un cuello de botella; llamar parada a la noche |
| TC-182 | Mediciones estándar (`buildCircuitState`) sobre un anillo de 20 tags | Paradas de varios AGV en tags vecinos → un punto que une los tags; todas de un AGV → es de ese AGV; repartidas o de noche → ningún punto; un bloqueo no se repite como parada suelta; retenciones concentradas → cuello en la cabeza de la cola, con la cola encadenada; un tag que se salta → zona oscura «salta el tag»; un tramo largo → «el tramo tarda», salvo parada precisa | Un punto conflictivo por azar; una cola atribuida al último de la fila |
| TC-183 | Cambio de horquilla entre periodos (`compareBands`, `bandChangesBetweenPeriods`) y CSV (`bandsCsv`) | Más lento, más rápido e igual dentro del mismo régimen; con un solo tramo de cobertura, nada; CSV con `;`, coma decimal y una fila por tramo y régimen | Comparar medias o regímenes distintos |
| TC-184 | Auditoría con noche lenta, parada aislada, punto conflictivo y cuello de botella plantados | Los cinco nuevos detectados (con la zona oscura de los tags poco leídos); ningún cuello, punto, zona oscura ni parada sin explicación sobre tramos limpios ni de noche; las 31 clases anteriores intactas | Un hallazgo del estado normal en un tramo sano |
| TC-185 | Navegador con una sola exportación y las listas | Sección «Estado normal del circuito»: la horquilla dibujada sin un rótulo por marca y con su tabla; tarjetas de cuello de botella («la cola fluye»), punto conflictivo (8 AGV), zona oscura y parada aislada sin causa; la noche aparte; el CSV se descarga con su cabecera | Nombrar una causa; perder la horquilla al cerrar la pestaña sin poder guardarla |
| TC-187 | Lecturas que llegaron juntas (`collapseGroupedDeliveries`) sobre un anillo de seis tags | Hueco + tres lecturas en 2 s con la suma normal → no paró, colapsada de P a Q; suma de más → espera sin situar, sigue siendo parada de P a Q; parada real y pasos normales → nada; dos pasos de medio tramo → nada; un solo paso rápido → nada; un AGV más deprisa que la horquilla de su régimen → nada (el hueco no se lleva el recorrido); lecturas del mismo instante cuentan; un tag de calle corta; resolución de minuto → sin evaluar, con su razón; el orden de salida es el de entrada | Llamar parada a un volcado; llamar volcado a un AGV que recupera el ritmo |
| TC-188 | Dónde se concentran (`summarizeDeliveries`) | Un AGV con varias ráfagas frente a una flota sin ninguna → concentrado; repartidas por sitios → ningún sitio | Señalar un AGV o un sitio por una ráfaga suelta |
| TC-189 | Auditoría con cuatro ráfagas plantadas de un AGV (tres lecturas movidas a los tres segundos antes de la siguiente, tras generar) | Las cuatro halladas sin parada y el AGV concentrado; sin el colapso eran cuatro paradas sin explicación suyas, con él ninguna; ninguna ráfaga de otro AGV (ni por la deuda de reloj del generador ni al empezar la noche); las 36 clases anteriores intactas | Una ráfaga de un AGV sano; perder una clase anterior |
| TC-190 | Navegador con una sola exportación y las listas | Tarjeta «le llegan lecturas juntas» del AGV plantado, con la última ráfaga y «no paró» | Nombrar una causa |
**TC-065 estaba mal escrito, y el código lo cumplía.** Pedía `silencio` para un vehículo que aún no
había leído nada, que es afirmar una avería donde solo hay ausencia de datos. La prueba existía, el
producto pasaba, y la pantalla mentía. Corregido el 2026-09-20 junto con la regla R-GRA-010; queda
anotado porque el caso interesante no es el defecto, sino que **una prueba en verde lo sostenía**.

**TC-061 cambió de enunciado, no de rigor.** Hasta la Parte 32 pedía «siempre `inferred`», que era
correcto mientras `lap_anchors` no existía. Con el ancla declarada implementada (R-GRA-009), ese
enunciado dejaría de ser una prueba de comportamiento y pasaría a ser una prueba de que la función
nueva no hace nada: se corrigió a «sin ninguna declarada», y los TC-108–111 cubren el caso que TC-061
ya no puede cubrir por sí solo.

**El mecanismo plantado como `bifurcacion-real` cambió, el resultado esperado no.** Hasta la Parte 35
el único candidato a bifurcación del circuito de auditoría (`ring[120]`/`96001`) reconvergía en el
siguiente tag sin que nadie lo hubiera diseñado así — el código nunca tocaba `position` al desviar.
Con la definición de cruce fijada por el propietario (bifurcación cuyas ramas reconvergen en pocos
saltos dentro del mismo cohorte), ese mecanismo **es** un cruce, no una bifurcación sin resolver: se
relabró como el ejemplo de `cruce-real` y se plantó una bifurcación genuina y nueva (cadena de seis
tags fuera de anillo, sin reconvergencia posible dentro del margen) para no perder cobertura de esa
clase. No se tocó ningún resultado esperado para que una prueba pasara: cambió el mecanismo plantado,
con su razón documentada aquí y en `CHANGELOG.md`.

Los casos enlazados están desarrollados en `docs/golden/` con la estructura de §5. Son los seis que
no dependen de información de planta, y constituyen los criterios de aceptación de F1a. El resto se
desarrollará cuando se cierren las preguntas abiertas correspondientes.

## 5. Estructura de un caso de oro

Cada caso incluye:

- propósito y reglas cubiertas;
- fixture sintético y generador/versionado;
- configuración y calendario;
- resultado esperado estructurado;
- resultados expresamente prohibidos;
- tolerancias numéricas justificadas;
- evidencia que debe poder navegarse;
- hash semántico o snapshot estable;
- responsable y fecha de aceptación.

## 6. Evaluación de diagnóstico

Con casos revisados por el propietario se medirán por categoría:

- verdaderos positivos;
- falsos positivos;
- falsos negativos;
- casos correctamente indeterminados;
- confianza bien/mal calibrada;
- utilidad de la comprobación recomendada.

La exactitud global no basta si oculta errores graves. Se priorizará reducir afirmaciones falsas y mantener trazabilidad.

## 7. Auditoría con verdad plantada

`tests/audit/` es una capa propia y no una carpeta más de unitarias. Una prueba unitaria comprueba
que una función hace lo que dice; la auditoría responde otra pregunta, que es la del §6 y hasta
ahora no tenía instrumento: **de todo lo que puede ir mal en un circuito real, ¿qué llega a
decirse, qué se escapa y cuántas veces se señala algo sano?**

El método es el que hace que la respuesta sea una cifra y no una impresión: un circuito sintético
donde **cada clase de fallo está plantada a propósito**, con sus tags y vehículos conocidos de
antemano. El generador (`tests/support/circuito-auditoria.ts`) devuelve, junto a los CSV, la verdad
plantada —clase, implicados, **qué debe decir el producto** y **qué no puede decir**— y la lista de
tags limpios, que es contra la que se cuentan los falsos positivos.

La salida útil es un **informe por clase**, no un punto verde. Tres aserciones lo sostienen:

1. **Cero falsos positivos sobre los tags sanos.** Señalar un tag que está bien es peor que no
   señalar uno que está mal: es lo que hace que nadie vuelva a mirar la herramienta.
2. **Regresión**: lo que hoy se detecta tiene que seguir detectándose.
3. **La deuda no se pudre en ninguna dirección.** Las clases que hoy no se detectan van en una
   lista explícita; la prueba falla también si una **empieza** a detectarse sin que se saque de la
   lista. Una lista de deuda que no se actualiza sola acaba mintiendo igual que un `TODO` viejo.

El escenario, sus resultados esperados y los prohibidos están en
`fixtures/synthetic/auditoria/MANIFEST.md`. Los datos **no se versionan: se generan con semilla**,
igual que la fuente de cien mil filas de `tests/e2e/rendimiento.spec.ts`. Para mirarlos a mano,
`npx vite-node scripts/generar-auditoria.ts` los deja en `local/`.

## 8. Navegadores y móvil

Las pruebas E2E cubrirán al menos Chromium y WebKit, escritorio y perfiles móviles. En cada puerta relevante se usará además un móvil Android físico y un PC de referencia para carga de archivos, cancelación, persistencia, actualización PWA y replay.

## 9. Aceptación humana

El propietario valida comportamiento, no implementación interna. Para aprobar una fase recibe:

- demostración de escenarios;
- tabla de resultados y límites conocidos;
- comparación de rendimiento;
- preguntas abiertas y riesgos residuales;
- versión reproducible y método de retorno.
