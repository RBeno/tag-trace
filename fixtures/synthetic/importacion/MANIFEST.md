# Fixtures sintéticos de importación

- Dataset ID/version: `import-basico/1`
- Generador: escritos a mano para F1a·0
- `synthetic: true`
- Propósito: ejercitar TC-019 (delimitadores e identidad) e INV-002 (ceros iniciales)
- Periodo ficticio: enero de 2026, inventado
- Configuración ficticia asociada: zona `Europe/Madrid`

## Garantía de privacidad

- [x] IDs inventados
- [x] Fechas y horarios inventados
- [x] Topología inventada
- [x] Distribuciones no copiadas literalmente de datos reales
- [x] Sin nombres de planta, sistema o personal
- [x] Revisado antes de commit

## Resultados esperados y prohibidos

Los tres ficheros contienen el mismo contenido lógico con separador distinto y deben producir el
mismo resultado normalizado. `0007` debe conservar su cero inicial en todo el recorrido.
