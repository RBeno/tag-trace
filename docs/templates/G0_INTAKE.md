---
document_id: TT-TPL-INTAKE-001
version: 0.1.0
status: template
last_updated: 2026-09-03
---

# Admisión de datos para cerrar G0

Las cinco preguntas bloqueantes de G0 no se responden por deducción: necesitan información de
planta. Esta plantilla las convierte en campos concretos para que responderlas sea rellenar, no
investigar.

## Cómo se usa

```bash
mkdir -p local
cp docs/templates/G0_INTAKE.md local/G0_INTAKE_RELLENO.md
```

`local/` está excluido del control de versiones y el guardián de datos rechaza cualquier copia
rellena fuera de `docs/templates/`. **Tu copia rellena no se sube nunca**, ni siquiera a un
repositorio privado: contiene topología, horarios y capacidad de la planta.

## Qué vuelve al repositorio y qué no

De cada respuesta, al repositorio solo vuelve la **forma**, nunca el **valor**:

| Vuelve al repositorio | Se queda en tu dispositivo |
|---|---|
| «Las lecturas usan punto y coma y encabezado en la primera fila» | Los nombres reales de las columnas y los IDs |
| «Hay N calles de carga online con capacidad configurable» | Cuántas hay, cuáles y su capacidad |
| «El takt se expresa en segundos por unidad» | El valor del takt |
| «La zona horaria es única y con cambio estacional» | — |

Los valores rellenados alimentan la configuración local del circuito
(`docs/CONFIG_SCHEMA.md`), que vive en el dispositivo.

---

## OQ-B01 · Formatos reales de las fuentes

Rellena un bloque por cada fuente que exista. Si una no existe todavía, escribe `no disponible`;
es una respuesta válida y evita que se dé por supuesta.

Ejemplo con valores **inventados**, solo para fijar la forma:

```text
Fuente ...................: DS-001 lecturas históricas
Nombre o patrón del fichero: export_lecturas_AAAAMMDD.csv
Codificación .............: UTF-8 con BOM
Delimitador ..............: punto y coma
Encabezado ...............: sí, fila 1
Columnas en orden ........: Fecha; Vehiculo; Punto; Estado
Columna de fecha/hora ....: Fecha
Columna de AGV ...........: Vehiculo
Columna de tag ...........: Punto
Ceros iniciales ..........: sí, en Punto (0042)
Fila de ejemplo ..........: 15/01/2026 07:42:36;AGV-A01;0042;OK
Filas por exportación ....: entre 80.000 y 300.000
Notas ....................: la columna Estado no siempre viene
```

Bloques a rellenar: DS-001 lecturas, DS-002 inventario Vsystem, DS-003 secuencia o plano,
DS-004 carga online, DS-005 tags críticos, DS-006 tags especiales, DS-007 tags y acciones,
DS-008 memoria por AGV, DS-009 calendario productivo.

---

## OQ-B02 · Tiempo y cambio horario

```text
Zona horaria .............:
¿La exportación trae desplazamiento explícito (+01:00) o solo hora local?
Formato de fecha .........: (día/mes/año o mes/día/año — indícalo aunque parezca obvio)
¿Segundos? ¿Milisegundos? :
Al retrasar el reloj en octubre, ¿aparecen dos veces las horas repetidas?
Al adelantarlo en marzo, ¿queda un hueco o el sistema desplaza?
¿Alguna fuente usa una zona distinta de las demás?
```

Es la pregunta que más daño hace si se contesta mal: una hora mal interpretada desplaza turnos,
rompe secuencias y falsea el orden de los eventos.

---

## OQ-B03 · Dispositivos de referencia

Sin esto no se puede aprobar el presupuesto de rendimiento ni reproducir el bloqueo que sufrió el
prototipo en móvil.

```text
PC de referencia .........: modelo, RAM, sistema, navegador y versión
Móvil Android ............: modelo, RAM, versión de Android, navegador y versión
¿Es el móvil donde falló el prototipo? sí / no
¿Hay un segundo dispositivo habitual que deba soportarse?
```

---

## OQ-B04 · Topología funcional del piloto

Todo lo de este apartado es configuración local versionada y no se publica (R-TIM-005).

```text
Circuito .................: PC2
Zona cargada .............: tags o puntos que la delimitan
Zona vacía ...............: tags o puntos que la delimitan
Calles de carga online ...: cuántas; por cada una: identificador, tag de parada,
                            secuencia de tags y capacidad
Puntos críticos ..........: tag, función, grado 1–3 y redundancias
Anclas de vuelta .........: qué tag o secuencia marca de forma fiable el inicio de una vuelta
Contextos excluidos ......: cómo se reconocen mantenimiento, asistencia y pastor
Takt .....................: valor y unidad
Turnos y pausas ..........: inicio, fin y excepciones
```

Si alguna frontera es dudosa, escríbela como dudosa. Un límite inventado produce diagnósticos
convincentes y falsos, que es el fallo más caro de este sistema.

---

## OQ-B05 · Plan de aceptación con datos reales

```text
¿Qué periodo y qué fuentes reales se usarán para aceptar F1?
¿Dónde se ejecutará esa aceptación? (dispositivo, siempre en local)
¿Quién valida que el resultado es correcto?
¿Existe algún caso ya conocido cuyo diagnóstico correcto se sepa de antemano?
¿Qué resultado haría rechazar la fase?
```

La última pregunta importa más de lo que parece: sin un criterio de rechazo escrito antes, cualquier
resultado acaba pareciendo aceptable.

---

## OQ-B07 · Licencia del repositorio

```text
Licencia .................: (sin fichero LICENSE, un repositorio público queda con todos los
                            derechos reservados, que puede ser exactamente lo que quieres)
¿Se admiten contribuciones externas? sí / no
```

---

## Al terminar

1. Guarda tu copia en `local/`, fuera del control de versiones.
2. Avisa de qué preguntas quedan respondidas y cuáles siguen abiertas.
3. Se actualizan `OPEN_QUESTIONS.md`, `CONFIG_SCHEMA.md` y las reglas `candidate` afectadas,
   registrando solo la forma de cada respuesta, nunca los valores.
4. Con OQ-B01 a OQ-B05 cerradas y el checkpoint firmado, G0 queda superado y la frase
   `CONTINÚA FASE 1` autoriza F1a.
