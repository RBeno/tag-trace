---
document_id: TT-GOLD-022
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-16
---

# TC-022 — Intervalo fuera de la cobertura

## Propósito y reglas cubiertas

El análisis es muestral: hay periodos de los que sencillamente no se cargó nada. Confundir eso con
un silencio de los AGV produciría el falso diagnóstico más caro del producto, porque parece una
conclusión legítima y es trazable hasta datos reales.

Reglas: R-DAT-007. Requisito: NFR-005. Invariante: INV-013.

## Fixture sintético

- Una única fuente que cubre un intervalo continuo inventado, con actividad normal.
- Se consulta explícitamente un intervalo **anterior** al cargado y otro **posterior**.
- Dentro del intervalo cargado, un hueco real sin lecturas de ningún AGV, para contrastar los dos
  tratamientos en el mismo escenario.

## Configuración aplicable

Calendario que declara actividad productiva durante los tres intervalos, para que la ausencia de
datos no pueda justificarse como parada prevista.

## Resultado esperado

- Los intervalos anterior y posterior se presentan como **`sin datos cargados`**.
- No generan hallazgo, no entran en salud, no crean oportunidades y no aparecen como huecos.
- El hueco interior sí se trata como evidencia: hueco censurado o silencio colectivo, según el
  contexto, y puede diagnosticarse.
- La cobertura se muestra junto a cualquier conclusión temporal, para que el usuario vea sobre qué
  se está concluyendo.

## Resultados prohibidos

- Interpretar un intervalo sin cargar como parada, silencio colectivo o fallo de comunicación.
- Que degrade la salud de un tag, un AGV o un tramo.
- Confundirlo con `unknown`: en `unknown` hubo evidencia y no basta para decidir; aquí no hubo
  ninguna.
- Extender el perfil esperado a un periodo sin cobertura.

## Tolerancias

Ninguna. La frontera de la cobertura es el último instante completo, exacto.

## Evidencia navegable

Al consultar un intervalo sin cobertura, la interfaz debe decir qué fuentes hay cargadas y qué
periodos cubren, para que la respuesta sea accionable y no un simple hueco en blanco.

## Aceptación

Responsable: propietario del producto. Fecha: pendiente de F1a.
