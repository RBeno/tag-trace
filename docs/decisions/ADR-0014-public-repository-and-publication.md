---
adr: ADR-0014
status: accepted
date: 2026-09-03
---

# Repositorio público y vía de publicación

## Contexto

OQ-B06 preguntaba si `RBeno/tag-trace` debía permanecer privado. La pregunta bloqueaba G0 porque
GitHub Pages desde un repositorio privado personal depende del plan contratado, y sin Pages el
objetivo de F6 —publicar el piloto como PWA instalable— no tenía vía.

Además, `SECURITY_PRIVACY.md` daba por hecho que se podían fijar cabeceras HTTP. GitHub Pages no lo
permite: solo sirve ficheros estáticos.

## Decisión

**Visibilidad.** El repositorio pasa a **público**, conteniendo únicamente código, documentación y
fixtures inequívocamente sintéticos. La prohibición de ADR-0007 no se relaja: se refuerza, porque
ahora un error es inmediatamente público. El repositorio solo se abre después de que el guardián de
datos esté operativo y probado, y de verificar el historial completo.

**Publicación.** GitHub Pages desde `main`, con GitHub Actions como origen. Solo se despliega una
compilación que haya superado todas las verificaciones.

**Política de contenido.** Al no haber cabeceras, la CSP se declara mediante
`<meta http-equiv="Content-Security-Policy">`. Esa vía **no** admite `frame-ancestors`, `report-uri`
ni `sandbox`, así que se compensa con:

- ningún script ni estilo en línea; todo recurso empaquetado con la aplicación;
- ninguna dependencia de CDN en ejecución (`ARCHITECTURE.md` §10);
- `connect-src 'none'` para el flujo analítico;
- una prueba automatizada que falla si el análisis intenta cualquier petición de red;
- las cabeceras que Pages no permite se documentan como límite conocido, no como control cumplido.

## Consecuencias

- Pages gratuito, PWA instalable y actualizaciones normales.
- El control mecánico contra datos reales pasa de recomendable a bloqueante: sin él, no se abre.
- Cualquier persona puede leer la especificación. Es aceptable: describe método, no la planta.
- La protección contra `clickjacking` queda limitada por la plataforma. Si en el futuro se
  considera insuficiente, la alternativa es un alojamiento estático con cabeceras propias, lo que
  exigiría una ADR nueva.

## Pendiente

La licencia del repositorio no se decide aquí. Sin fichero `LICENSE`, un repositorio público queda
por defecto con todos los derechos reservados. Registrado como OQ-B07.
