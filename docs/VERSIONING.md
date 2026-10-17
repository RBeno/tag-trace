---
document_id: TT-VERSION-001
version: 0.2.0
status: baseline-candidate
last_updated: 2026-10-17
---

# Versionado y compatibilidad

## Ejes independientes

| Eje | Ejemplo | Cuándo cambia |
|---|---|---|
| Aplicación | `app 0.3.0` | Release de software |
| Documentación | `docs 0.1.0` | Línea base o cambio normativo |
| Algoritmo | `ALG-007 1.1.0` | Semántica/parámetros compatibles o incompatibles |
| Proyecto | `.agvproj schema 1` | Contrato persistente/migración |
| Configuración | `CIRCUIT-A config 2026-09-03.1` | Vigencia, zonas, calendario, tags o funciones |
| Memoria | `baseline v12` | Consolidación aceptada |
| Incidencia | `INC-... revision 4` | Evolución del expediente |

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

- `docs-v0.2.0`: candidata documental vigente. `docs-v0.1.0` fue la primera, sin gobierno ejecutable.
- `phase-fN-approved`: checkpoint aprobado de fase.
- `vX.Y.Z`: versión ejecutable publicada. Desde 3.82.0 la crea el workflow de publicación en el commit
  publicado, con la versión del `CHANGELOG.md`; una etiqueta publicada no se mueve.

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
