---
document_id: TT-VERSION-001
version: 0.3.0
status: baseline-candidate
last_updated: 2026-10-18
---

# Versionado y compatibilidad

## Ejes independientes

| Eje | Ejemplo | Dónde se lee | Cuándo cambia |
|---|---|---|---|
| Aplicación | `3.90.1` | Primera entrada de `CHANGELOG.md`; `package.json` la repite | Cada entrega |
| Documentación | `1.90.1` | `documentationVersion` en `project_state.json`; cada documento, en su frontmatter | Línea base o cambio normativo |
| Algoritmo | `ALG-007 1.1.0` | El resultado guardado | Semántica/parámetros compatibles o incompatibles |
| Proyecto | `.agvproj` esquema 6 | `AGVPROJ_SCHEMA_VERSION` | Contrato persistente/migración |
| Almacén local | `STORE_VERSION` 12 | `src/persistence/store-schema.ts` | Tablas o índices de IndexedDB |
| Configuración | `CIRCUIT-A config 2026-09-03.1` | La configuración del circuito | Vigencia, zonas, calendario, tags o funciones |
| Memoria | `baseline v12` | La memoria consolidada | Consolidación aceptada |
| Incidencia | `INC-... revision 4` | El expediente | Evolución del expediente |

## SemVer del software

- `MAJOR`: incompatibilidad deliberada o migración no transparente.
- `MINOR`: capacidad nueva compatible.
- `PATCH`: corrección compatible sin cambiar intención del algoritmo.

Antes de 1.0, todo cambio sigue necesitando migración y changelog explícitos.

## Documentos

- Corrección editorial sin cambio normativo: patch.
- Regla/requisito compatible añadido: minor.
- Cambio de principios, contratos o significado: major o nueva línea base.
- El frontmatter de todos los documentos debe indicar versión, estado y fecha.

## Algoritmos

Cada resultado guarda ID, versión y parámetros. Una versión nueva no recalcula históricos automáticamente. La comparación candidato/estable debe mostrar diferencias antes de promover el nuevo comportamiento.

## `.agvproj`

- Esquema explícito y validador por versión.
- Migraciones secuenciales, deterministas y probadas.
- Importación nunca sobrescribe el archivo original.
- Round-trip semántico obligatorio.
- Una versión futura desconocida se rechaza sin modificar almacenamiento local.

## Configuraciones y memoria

Tienen `valid_from`, `valid_to` opcional, origen y estado. Una consolidación crea una versión enlazada a la anterior; una corrección se representa como revocación/nueva versión.

## Tags Git

- `vX.Y.Z`: versión ejecutable publicada. Desde 3.82.0 la crea el workflow de publicación en el commit
  publicado, con la versión del `CHANGELOG.md`; una etiqueta publicada no se mueve.
- `docs-v0.1.0`: la primera base documental, sin gobierno ejecutable; se conserva como historia. La
  `docs-v0.2.0` que pedían `ROADMAP.md` §F0 y `checkpoints/F0_BASELINE_CANDIDATE.md` no llegó a crearse:
  la versión de la documentación se lee en `project_state.json`, no en etiquetas.
- `phase-fN-approved`: checkpoint aprobado de fase. No se ha creado ninguna; cada aprobación queda en
  `project_state.json`, en `PHASE_GATES.md` y en `history/DECISION_LOG.md`.
- `archivo/<rama>`: el último commit de una rama que no se fusionó, guardado antes de borrarla (decisión
  del propietario del 2026-10-18). Las dos primeras, que crea el propietario:
  `archivo/agv-wifi-tags-analysis-hi22lg` (3.64.0–3.66.1 de otra línea) y `archivo/fase-5-puntos-uqfbx6`
  (una propuesta alternativa de F5). Se leen con `git checkout archivo/<rama>`; no se publican ni se
  fusionan.

## Publicación y retorno

Desde 3.82.0 (NFR-011, NFR-016, ADR-0014):

- **Identificar.** La versión abierta se ve en la cabecera («Versión X.Y.Z»), sale del `CHANGELOG.md` y
  coincide con la etiqueta `vX.Y.Z` del commit publicado y con la caché del service worker
  (`tag-trace-X.Y.Z`).
- **Actualizar.** Cada compilación sella su `sw.js` con la versión, la del almacén local y la lista de
  ficheros. El navegador instala la versión nueva en espera y la página avisa con su número y qué pasa
  con lo guardado; se activa solo cuando la persona lo pide y no hay importación, análisis, exportación
  ni consolidación en curso, ni en otra pestaña (`UX_SPEC.md` §9). Mientras, se sigue sirviendo la
  versión abierta, también sin red. Se conservan la caché de la versión activa y la de la anterior.
- **Volver a una versión anterior.** En GitHub, Actions → «Publicar en GitHub Pages» → «Run workflow» y,
  en «Use workflow from», la etiqueta `vX.Y.Z` a la que se vuelve. Se verifica, compila y publica esa
  versión tal cual; su etiqueta ya existe y no se toca. Cada dispositivo ve el aviso «Se ha vuelto a
  publicar una versión anterior» y cambia cuando la persona lo pide.
- **Cuidado con el almacén.** Si la versión a la que se vuelve abre un almacén anterior al de lo
  guardado (`STORE_VERSION`), no podrá leerlo: el aviso lo dice antes de cambiar. Para no perder nada,
  antes se exporta cada circuito (`.agvproj`); tras volver, se borran los datos del sitio y se abren
  las copias. Un retorno sin cambio de almacén no necesita nada de esto.
- Las versiones anteriores a 3.82.0 no tienen etiqueta ni este aviso.
