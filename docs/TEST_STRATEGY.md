---
document_id: TT-TEST-001
version: 0.13.0
status: baseline-candidate
last_updated: 2026-09-20
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
| TC-061 | Ancla de vuelta hallada como ciclo dominante de un cohorte | Vueltas segmentadas, siempre `inferred` aunque los datos sean perfectos | Que una vuelta completa salga `observed` |
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

**TC-065 estaba mal escrito, y el código lo cumplía.** Pedía `silencio` para un vehículo que aún no
había leído nada, que es afirmar una avería donde solo hay ausencia de datos. La prueba existía, el
producto pasaba, y la pantalla mentía. Corregido el 2026-09-20 junto con la regla R-GRA-010; queda
anotado porque el caso interesante no es el defecto, sino que **una prueba en verde lo sostenía**.

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

## 7. Navegadores y móvil

Las pruebas E2E cubrirán al menos Chromium y WebKit, escritorio y perfiles móviles. En cada puerta relevante se usará además un móvil Android físico y un PC de referencia para carga de archivos, cancelación, persistencia, actualización PWA y replay.

## 8. Aceptación humana

El propietario valida comportamiento, no implementación interna. Para aprobar una fase recibe:

- demostración de escenarios;
- tabla de resultados y límites conocidos;
- comparación de rendimiento;
- preguntas abiertas y riesgos residuales;
- versión reproducible y método de retorno.
