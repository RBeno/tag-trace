---
document_id: TT-VERSION-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
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
- `vX.Y.Z`: release ejecutable futura.
