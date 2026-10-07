---
adr: ADR-0017
status: proposed
date: 2026-10-07
---

# Mapa de estado de conexión por AGV a partir del registro de conexiones del terminal

## Contexto

El propietario pidió un mapa de calor WiFi «si existe evidencia» (3.64.0). Con las fuentes
contratadas (DS-001 a DS-012) la única evidencia era indirecta: las lecturas que llegaron juntas
(R-DAT-020). El 2026-10-07 aportó dos exportaciones nuevas por AGV, generadas desde el terminal de
cada vehículo, para la mitad del circuito PO4 y dos días:

- **CONEXIONES\<agv\>.xlsx**: un registro de eventos del terminal con fecha y hora al segundo, tipo
  (`Desconexión`, `Conexión`, `Conexión tras apagado`), un campo de cobertura (0 desconectado, 255
  conectado, 1 tras apagado), versión, dirección IP del terminal y un campo auxiliar con el MTC/MTD
  vigente. **No lleva columna de AGV**: el vehículo va en el nombre del fichero.
- **LECTURAS\<agv\>.xlsx**: las lecturas de ese AGV con fecha, tag, MTC, acciones y dos marcas
  (`No en memoria`, `No ejecutado`).

Un análisis fuera del repositorio (datos reales, nunca versionados: ADR-0007) sobre nueve AGV dio:

1. **LECTURAS por AGV es exactamente el informe ampliado (DS-011) filtrado por ese AGV**: mismas
   filas, mismos instantes, sin desfase. No aporta datos nuevos; aporta la columna `No ejecutado`,
   que el informe ampliado no tiene y que puede valer aparte.
2. **CONEXIONES es evidencia directa y se localiza**: cada corte es un par `Desconexión`→`Conexión`
   con fecha y duración. En dos días hubo unos quinientos cortes, la mitad de dos segundos o menos
   (microcortes, compatibles con el cambio de punto de acceso), uno de cada diez de más de un minuto
   y unas pocas decenas de más de diez minutos. Situando cada corte entre la última lectura anterior
   y la primera posterior del mismo AGV, **diez tags concentran casi la mitad de los cortes** y los
   cortos y los largos se concentran en los mismos sitios. Eso es un mapa de cobertura de verdad.
3. **Contradicción con R-DAT-020.** Durante los cortes largos (de cinco minutos a varias horas) las
   lecturas del AGV **siguen llegando con fecha dentro del corte y a su cadencia normal** (unos ocho
   segundos), y al reconectar no hay ninguna ráfaga. Además las nueve ráfagas que hay en esos dos
   días apenas coinciden con cortes del registro. O la hora del fichero de lecturas **no** es la de
   recepción en el servidor a través de este enlace, o las lecturas no viajan por el enlace que este
   registro mide (hay una radio: `ACTIVACION VIA RADIO`, parada condicionada «a una radio»). El
   propietario dijo el 2026-09-25 que la hora es la de recepción en el servidor; la evidencia nueva no
   lo sostiene para este enlace. Decidirlo es suyo (OQ-159).

## Decisión propuesta

1. **Nueva fuente DS-013, «Registro de conexiones del terminal», por AGV.** Contrato mínimo:
   instante al segundo, tipo de evento (enum cerrado con los tres valores vistos; un valor nuevo se
   conserva como texto y se marca `unknown`), cobertura y, como atributos conservados sin
   semántica, versión, IP del terminal y el campo auxiliar. El AGV se toma del nombre del fichero
   con el patrón `CONEXIONES<agv>.xlsx` y se enseña antes de confirmar; si el patrón no casa, se pide
   (OQ-160). Se importa **en lote**: varios ficheros de una vez, uno por AGV, con la misma
   procedencia por fichero, hash y fila que cualquier lectura (R-EVI-001).
2. **LECTURAS por AGV no es una fuente nueva**: es DS-011 filtrado. Si se carga, el importador lo
   reconoce por la cabecera y lo trata como lecturas del AGV del nombre del fichero (que no trae la
   columna), sin duplicar lo que el informe ampliado ya tiene (misma fila, misma fecha, mismo tag).
   Su columna `No ejecutado` se conserva como atributo (OQ-162).
3. **Un corte es un par `Desconexión`→siguiente `Conexión`** del mismo AGV, con duración. `Conexión
   tras apagado` cierra el corte pero es un encendido, no una vuelta de la señal, y se dice así. Un
   corte sin cierre dentro de la ventana queda abierto, con su duración «al menos». La clase del
   corte —microcorte, corte, caída— sale de la configuración versionada (`CONFIG_SCHEMA.md`), nunca
   de una constante (OQ-161).
4. **Localización por las lecturas del mismo AGV**: el corte se sitúa entre la última lectura
   anterior (P) y la primera posterior (Q); si P y Q son consecutivos en el anillo, el corte es del
   tramo P→Q; si no, es «entre P y Q, sin poder situarlo más». Con el tiempo entre P y la pérdida y
   lo habitual del tramo se puede estimar en qué parte del tramo cayó, como `inferred` y con su
   confianza, nunca `observed`.
5. **El mapa de estado de conexión**: por tag y por tramo del anillo, cortes por pasada, tiempo
   sin señal por pasada, cuántos AGV distintos, y la clase. Dónde se concentra, con la misma prueba
   de azar que los cuellos de botella (`concentrated`), separando **sitio** (le pasa a muchos AGV) de
   **vehículo** (le pasa casi solo a uno: su terminal). Se dibuja con el mismo `deliveryHeatChart` y
   la capa «Señal» del anillo (3.64.0), que pasan a tener dos fuentes: **observado** (DS-013) y
   **inferido** (R-DAT-020), nunca mezcladas en una misma celda (`observed` ≠ `inferred`).
6. **Contraste**: cada ráfaga de R-DAT-020 se cruza con el registro de conexiones del mismo AGV; una
   ráfaga sin corte y un corte sin ráfaga se cuentan y se enseñan. Mientras OQ-159 esté abierta,
   R-DAT-020 **no se toca** y el mapa inferido sigue llamándose «lecturas que llegaron juntas».
7. **Cómo organizar la carga para toda la flota**: por periodo, el informe ampliado del circuito
   (ya cubre todas las lecturas de todos los AGV) más un CONEXIONES por AGV. Con cuarenta AGV son
   cuarenta ficheros pequeños que se seleccionan de una vez. LECTURAS por AGV sobra.

## Consecuencias

- Nada de esto se construye antes de que el propietario cierre OQ-159 a OQ-162: OQ-159 cambia lo
  que significa la hora de cada lectura y afecta a R-DAT-020, a las firmas de tiempo y a la
  clasificación de huecos; las otras tres fijan el contrato de la fuente.
- Si OQ-159 concluye que la hora es la del AGV (lectura, no recepción), el fenómeno «lecturas que
  llegaron juntas» necesita otra explicación y la regla se revisa; el mapa inferido pasaría a ser
  una señal de otra cosa.
- El registro de conexiones no lleva intensidad de señal: el mapa dice dónde se corta, no cuánta
  cobertura hay. Sigue siendo evidencia de dónde, no de por qué (R-EVI-006).
