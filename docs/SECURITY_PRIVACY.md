---
document_id: TT-SEC-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Seguridad, privacidad y separación industrial

## 1. Clasificación

| Clase | Ejemplos | GitHub | Tratamiento |
|---|---|---:|---|
| Público | Código, documentación genérica, fixtures sintéticos | Permitido | Revisado antes de publicar |
| Proyecto local | `.agvproj`, memoria, incidencias, informes | Prohibido | Solo dispositivo/exportación manual |
| Industrial bruto | CSV, planos, grafos reales, configuraciones | Prohibido | Local, mínimo tiempo necesario |
| Secreto | Credenciales, tokens, certificados | Prohibido | Nunca requerido por la aplicación |

Un conjunto anonimizado puede seguir revelando topología, horarios o capacidad. No se considera publicable automáticamente.

## 2. Límite de seguridad industrial

TAG TRACE es estrictamente observacional:

- no se conecta a PLC, AGV, lectores o servidores industriales;
- no implementa órdenes ni escritura de parámetros;
- no usa permisos `START`, `STOP`, `RESET`;
- no sustituye protecciones, consignas ni validación humana;
- una posible evolución en tiempo real seguirá inicialmente siendo read-only y físicamente separada del control.

## 3. Modelo de amenazas

| ID | Amenaza | Control obligatorio |
|---|---|---|
| TH-001 | Publicar datos reales por error | `.gitignore`, revisión de diff, escaneo de patrones y política de fixtures |
| TH-002 | Enviar datos a un servicio externo | CSP, ausencia de endpoints, pruebas de red y dependencias empaquetadas |
| TH-003 | Filtrar datos por logs/errores | Redacción de metadatos y pruebas; nunca imprimir filas completas |
| TH-004 | Dependencia comprometida | Lockfile, mínimo de dependencias, auditoría y actualizaciones revisadas |
| TH-005 | Proyecto manipulado/corrupto | Esquema, hashes, límites de tamaño y carga transaccional |
| TH-006 | CSV malicioso o agotamiento de memoria | Parser defensivo, límites, cuotas, cancelación y cuarentena |
| TH-007 | XSS mediante valores importados | Renderizado como texto, sanitización y CSP restrictiva |
| TH-008 | Service Worker obsoleto | Versión visible, actualización controlada y retorno |
| TH-009 | Pérdida por limpieza del navegador | Exportación `.agvproj`, avisos de persistencia y verificación de guardado |
| TH-010 | Mezcla de circuitos | `circuit_id`, afinidad, cuarentena y bloqueo de consolidación |

## 4. Política de red

Durante un análisis con datos cargados:

- ninguna petición contendrá datos, metadatos industriales ni contenido derivado;
- no se utilizará telemetría, analítica de terceros, fuentes externas o mapas remotos;
- los recursos de la interfaz estarán empaquetados en la aplicación;
- una prueba automatizada deberá fallar si el flujo analítico intenta acceder a red.

GitHub Pages sirve la aplicación, no recibe los archivos seleccionados por el usuario.

## 5. Contenido importado

- Tratar nombres de archivo y celdas como datos no confiables.
- No ejecutar fórmulas, HTML, scripts ni URLs presentes en fuentes.
- Escapar exportaciones tabulares para evitar fórmulas al abrirlas en una hoja de cálculo.
- Limitar tamaño de celdas, columnas, filas y estructuras anidadas.
- Validar antes de escribir en persistencia.

## 6. `.agvproj`

- Manifiesto y versión obligatorios.
- Hash por secciones y hash global.
- Límites de descompresión y número de objetos.
- Importación en área temporal; commit solo tras validación completa.
- Migración sobre copia lógica y sin sobrescribir el original exportado.
- Cifrado con contraseña queda abierto; no se prometerá hasta decidir modelo de recuperación y compatibilidad.

## 7. Desarrollo con IA

- La IA solo recibe datos sintéticos dentro del repositorio.
- Si se necesita depurar un archivo real, se trabaja localmente bajo control del usuario y no se copia a commits, mensajes o servicios externos.
- Los prompts, capturas y trazas se consideran posibles canales de fuga.
- Ningún agente posee autoridad para relajar esta política.

## 8. Comprobaciones antes de publicar

1. Árbol de Git revisado.
2. Escaneo de secretos y extensiones prohibidas.
3. Fixture manifestado como sintético.
4. Pruebas de ausencia de red.
5. Build reproducible desde dependencias fijadas.
6. Cabeceras/CSP y comportamiento del Service Worker verificados.
7. Versión y changelog presentes.
