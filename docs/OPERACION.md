---
document_id: TT-OPS-001
version: 0.3.0
status: baseline-candidate
last_updated: 2026-10-18
---

# Operación, recuperación y soporte

Lo que `ROADMAP.md` §F6 pide formalizar: matriz de navegadores y dispositivos, operación, recuperación y
criterios de soporte. Los presupuestos finales de tiempo, memoria y almacenamiento los fija G6 con la
medida del propietario (`PERFORMANCE_BUDGET.md` §3).

## 1. Matriz de navegadores y dispositivos (OQ-173)

| Dispositivo | Navegador | Papel | Estado |
|---|---|---|---|
| Samsung Galaxy S23 FE | Chrome | Móvil de referencia y puerta de fase | Soportado; medida pendiente del propietario |
| PC de referencia (6 núcleos, 32 GB) | Chrome o Edge | Escritorio de referencia | Soportado; medida pendiente del propietario |
| Otros con Chromium reciente | Chrome, Edge | Sin compromiso | Debería funcionar; no se prueba |
| Firefox, Safari | — | Fuera del piloto | No se prueba; entraría solo si el propietario lo pide |

Las pruebas automáticas corren en Chromium: escritorio, tableta táctil (1.024 px) y móvil táctil
(360 × 780), con tema claro y oscuro. La emulación no sustituye al dispositivo físico.

## 2. Operación

- **Publicación**: solo desde `main` y con las tres verificaciones en verde; cada publicación deja la
  etiqueta `vX.Y.Z` (`VERSIONING.md` §Publicación y retorno).
- **Actualización**: la versión nueva espera y la persona la activa sin trabajo en curso.
- **Retorno**: lanzar la publicación sobre una etiqueta anterior. Si esa versión abre un almacén anterior,
  antes se exporta cada circuito (`VERSIONING.md`).
- **Sin red**: tras abrir una vez con red, la versión entera queda en el dispositivo.

## 3. Copia y recuperación

**Qué hay que guardar.** El `.agvproj` de cada circuito: fuentes, instantáneas, memoria, plano, valores
de planta, revisión en campo y expedientes con sus recortes. **No** lleva las lecturas en bruto: esas
son las exportaciones de planta, que se guardan aparte, fuera del repositorio.

**Cuándo.** Después de cada consolidación y antes de actualizar si el aviso lo pide. El aviso de guardado
no persistente es una razón más.

**Restaurar** (dispositivo nuevo, datos del sitio borrados o retorno con cambio de almacén):

1. Abrir la aplicación con red una vez.
2. Datos → «Abrir un circuito exportado (.agvproj)» con la última copia. El mensaje dice qué entró:
   memoria, plano, valores, expedientes.
3. Volver a importar en ese circuito las lecturas que hagan falta; ahí se ven los expedientes y se
   reconstruyen las vistas.

Nada se mezcla: si la copia y lo local divergen, se queda lo local y se dice.

## 4. Criterios de soporte

- **Qué se atiende**: defectos reproducibles en la matriz de §1 con la versión publicada, y cifras fuera
  del presupuesto medidas con «Medir este dispositivo».
- **Cómo se informa**: `GUIA_DE_DIAGNOSTICO.md` §4; nunca con datos de planta.
- **Cómo se corrige**: primero un fichero sintético que lo reproduzca; luego la corrección con su prueba,
  su entrada en el `CHANGELOG.md` y una versión nueva.
- **Qué no se atiende**: control industrial, conexión a sistemas de planta, navegadores fuera de la
  matriz, y datos perdidos sin copia exportada.

## 5. Riesgos residuales

- Sin cabeceras propias en Pages no hay protección contra el enmarcado (ADR-0014).
- Dependencias: `npm audit` sin avisos desde 3.88.4 (Vitest 5.0.5, OQ-176). Se revisa en cada subida de
  versión de una herramienta.
- Las cifras de rendimiento son del contenedor de desarrollo hasta la medida del propietario.
