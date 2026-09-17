---
adr: ADR-0012
status: accepted
date: 2026-09-03
---

# Contenedor del formato `.agvproj`

## Contexto

NFR-007 exige versión, migraciones explícitas, validación de integridad y prueba de ida y vuelta.
TH-005 añade límites de descompresión y carga transaccional. `DATA_CONTRACTS.md` §8 aplazaba la
decisión, y el prototipo resolvió el formato como texto plano leído con `parseProjectFile(text)`:
sin manifiesto, sin hash y sin versión de esquema, de modo que un fichero manipulado o truncado no
se distingue de uno válido.

## Decisión

`.agvproj` es un contenedor **zip** con:

- `manifest.json` en la raíz: `schema_version`, versión de aplicación, `circuit_id`, instante de
  exportación, inventario de secciones y hash de cada una.
- Secciones JSON separadas: configuración, grafo consolidado, perfiles esperados, divergencias,
  historial de consolidaciones e incidencias.
- Hash por sección y hash global sobre el manifiesto ya completo.
- Sin bruto completo por defecto; solo el recorte mínimo que una incidencia necesite para su replay.

Reglas de apertura:

1. Leer el manifiesto antes que ninguna sección.
2. Rechazar una `schema_version` desconocida sin tocar el almacenamiento local.
3. Aplicar límites de tamaño descomprimido, número de entradas y ratio de compresión.
4. Validar hashes; una sección corrupta invalida la carga completa.
5. Cargar en área temporal y confirmar solo tras validar todo (carga transaccional).
6. Migrar sobre copia lógica, sin sobrescribir el fichero exportado.

## Consecuencias

- Integridad comprobable y corrupción detectable, no silenciosa.
- Se pueden leer secciones sueltas sin cargar el proyecto entero, lo que ayuda a NFR-008.
- El zip obliga a controlar la descompresión; el límite es parte del contrato, no una opción.
- El cifrado con contraseña sigue abierto (OQ-P01) y encaja como capa sobre este contenedor.

## Alternativas descartadas

JSON único: simple, pero sin hash por secciones, sin carga parcial y con un pico de memoria igual
al proyecto completo. Base embebida: descartada hasta que un benchmark demuestre ganancia neta
(`ARCHITECTURE.md` §6).
