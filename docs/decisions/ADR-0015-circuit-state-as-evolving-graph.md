---
adr: ADR-0015
status: accepted
date: 2026-09-26
---

# El estado del circuito es un grafo que evoluciona

## Contexto

Hasta 3.49.0 el circuito se guardaba en el almacén local como **un solo valor** de IndexedDB con
todas sus lecturas acumuladas (`StoredCircuit.readings`). Con el circuito de auditoría —un cuarto de
millón de lecturas— ese registro ronda los 110 MB, y Chromium no admite valores de más de unos
127 MiB: dos recargas de la misma exportación lo pasaron del límite en la integración continua
(OQ-142). Un circuito real con tres o cuatro exportaciones acumuladas lo superaría igual.

Lo que crece con los meses son las lecturas, no el circuito. El propietario (2026-09-26): «la idea
propuesta era guardar el estado del circuito como grafo con sus tags, posiciones relativas, función y
las últimas tendencias de tiempo. Los vértices del grafo contendrían información adicional como la
tasa de lectura si está por debajo del 100 % y cualquier dato que sea de interés; esos datos podrían
representarse como un grafo que va moviéndose, ampliando o reduciendo sus vértices (tags) y
aumentando o reduciendo sus caminos (tiempo). Reduciría el tamaño de memoria y permitiría
representar la evolución en el tiempo». Es lo que `MEMORY_CONSOLIDATION.md` §2 y §3 ya describen
para la memoria normal; lo que faltaba era hacerlo desde el primer fichero.

## Decisión

1. **La instantánea es la unidad que perdura.** Cada exportación analizada deja una **instantánea**
   (`CircuitSnapshot`, `src/domain/snapshot.ts`): un grafo con fecha. Vértices: cada tag con su
   posición en el anillo, su tramo y función declarados, su tasa de lectura y pasadas, los AGV que
   nunca lo leen, su clase de inventario y su situación (ancla, calle, línea). Aristas: cada tramo del
   anillo con su horquilla por régimen y sus muestras; y cada sección entre anclas. Contexto: la
   flota, la cobertura, la cadencia de la línea, el uso de las calles, la vuelta, la posición en
   tiempo desde el ancla, y los hallazgos con su estado de revisión. Una instantánea del circuito de
   auditoría ocupa cientos de kilobytes; cien ficheros caben donde antes no cabían dos.

2. **Las lecturas en crudo solo viven en la ventana de trabajo.** Se guardan **por fuente**, en
   registros separados, y solo las de la última exportación cargada —o las dos últimas si se
   solapan— (decisión del propietario, 2026-09-26). Las anteriores se retiran del almacén y quedan
   como instantánea; volver a cargar el fichero las recupera. El expediente y el replay de un fichero
   retirado dejan de estar disponibles hasta que se vuelva a cargar, y la vista lo dice.

3. **La secuencia de instantáneas es la evolución.** Todo lo que compara ficheros —horquillas que
   cambian (R-TIM-010, R-TIM-011), tags insertados o retirados por la suma entre anclas (R-DAT-021),
   deriva entre periodos (R-DAT-016)— se calcula a partir de las instantáneas, no de las lecturas.
   Un cambio dentro de un mismo fichero se sigue midiendo con sus lecturas. El anillo se dibuja en
   cualquier instantánea y se recorre en el tiempo: vértices que aparecen, se retiran o se mueven,
   aristas que se alargan o se acortan.

4. **Instantánea automática, consolidación humana.** La instantánea se guarda sola: es una medición
   con fecha, no memoria consolidada. La **memoria de referencia** contra la que se comparan los
   meses siguientes es la que el propietario aprueba en F4 (`MEMORY_CONSOLIDATION.md` §6, ADR-0010):
   ninguna IA consolida periodos. Consolidar es elegir una instantánea revisada y escribirla como
   versión vN+1, append-only.

5. **El `.agvproj` lleva las instantáneas y no las lecturas** (ADR-0012): es lo que hace que el
   circuito viaje entre dispositivos con toda su evolución y sin su bruto.

## Consecuencias

- Almacén local en la versión 6: `circuits` sin lecturas, `sources` con las lecturas retenidas por
  fuente, `snapshots` por fuente. La migración parte el registro antiguo por la procedencia de cada
  lectura y conserva las lecturas retenidas.
- Cada módulo que compara ficheros gana una entrada desde instantáneas y pierde su dependencia de
  las lecturas de ficheros anteriores. Las pruebas de auditoría y de navegador lo cubren con dos
  exportaciones.
- El tamaño del almacén queda acotado por las lecturas de una o dos exportaciones más una
  instantánea por fichero; el presupuesto se declara en `MEMORY_CONSOLIDATION.md` §9.
- Lo que una instantánea no guarda no se puede recalcular sin volver a cargar el fichero: la lista de
  lo que guarda está en `DATA_CONTRACTS.md` §12 y se versiona (`schemaVersion`).

## Alternativas descartadas

- **Partir las lecturas por fuente y conservarlas todas.** Resuelve el límite por valor, pero no el
  crecimiento: los meses siguen sumando megabytes, y la comparación entre ficheros seguiría
  recalculándose desde el bruto en cada importación.
- **Guardar las vistas enteras de cada fichero.** Son grandes (matriz, replay, expedientes) y
  reconstruibles; `MEMORY_CONSOLIDATION.md` §4 las excluye a propósito.
