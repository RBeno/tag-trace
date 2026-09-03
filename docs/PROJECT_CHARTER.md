---
document_id: TT-CHARTER-001
version: 0.1.0
status: baseline-candidate
owner: product-owner
last_updated: 2026-09-03
---

# Carta del proyecto

## 1. Problema

Las lecturas históricas de tags están fragmentadas y su ausencia puede tener múltiples causas: tag, lector, AGV, comunicación, configuración, ruta o proceso. Vsystem aporta una visión teórica y muestra la última lectura, pero no basta para reconstruir el comportamiento físico real ni su evolución. La revisión manual exige consultar diferentes apartados y AGV por AGV.

## 2. Visión

Construir un sistema local de diagnóstico longitudinal que transforme eventos dispersos en:

- un grafo físico observado y versionado del circuito;
- un modelo temporal de su funcionamiento normal;
- divergencias individuales, grupales y colectivas;
- comparación histórica tras consolidaciones supervisadas;
- investigación reproducible de incidencias;
- evidencia navegable hasta los datos de origen.

## 3. Resultado de valor

El usuario debe poder pasar de un síntoma —por ejemplo, ausencia de AGV en un punto crítico durante diez minutos— a una explicación estructurada de qué cambió, qué AGV o zonas participaron, qué hipótesis son compatibles, qué evidencia falta y qué contramedida puede comprobarse.

## 4. Alcance inicial

- Un circuito piloto, inicialmente PC2, preparado arquitectónicamente para circuitos aislados.
- Análisis histórico mediante archivos locales.
- Gestor de circuito, importación, validación, grafo, análisis temporal/colectivo, comparación, consolidación, incidentes, replay e informes.
- Aplicación web estática/PWA en GitHub Pages.
- Procesamiento y persistencia en el dispositivo del usuario.
- Transferencia manual entre dispositivos mediante `.agvproj`.

## 5. Fuera del alcance inicial

- Control de AGV, PLC, servidores, lectores o instalaciones.
- Escritura de parámetros o envío de órdenes.
- Diagnóstico mediante SOC/batería.
- Backend con datos reales o sincronización automática en nube.
- Tiempo real y varios circuitos en producción; quedan como evolución posterior.
- IA generativa u opaca tomando decisiones de diagnóstico en ejecución.

## 6. Principios

1. Conclusión primero, después evidencia y finalmente bruto.
2. Observación e inferencia nunca se confunden.
3. El desconocimiento se representa; no se rellena con certeza falsa.
4. El circuito real surge del consenso contrastado, no de una única fuente.
5. Toda memoria normal requiere consolidación humana.
6. Una incidencia se conserva sin contaminar el comportamiento esperado.
7. Igual entrada, configuración y versión deben producir igual resultado.
8. Los recursos se optimizan conservando agregados y divergencias, no duplicando todo el histórico.

## 7. Éxito del piloto

El piloto tendrá valor demostrado cuando pueda:

- importar y auditar datos reales localmente;
- reconstruir omisiones sin inventar eventos;
- diferenciar hipótesis de tag, AGV, lector, comunicación, configuración, ruta y proceso;
- mostrar un grafo/replay útil de hasta 48 horas y aproximadamente 40 AGV;
- comparar un periodo con el estado consolidado esperado;
- crear un expediente de incidencia con contramedidas;
- guardar una memoria compacta y reabrirla;
- funcionar de forma estable en PC y móvil de referencia.

## 8. Gobierno

El propietario del producto valida reglas y resultados. La IA puede diseñar, implementar, probar y documentar tareas limitadas, pero no aprueba cambios de fase ni consolida datos. Git y las pruebas constituyen el registro verificable de evolución.
