---
document_id: TT-LEGACY-001
version: 0.1.0
status: baseline-candidate
last_updated: 2026-09-03
---

# Tratamiento del prototipo anterior

## Identificación

- Repositorio: `RBeno/tag-trace-agv`.
- Función: prototipo y fuente de aprendizaje.
- Estado respecto al nuevo producto: referencia externa, no dependencia.

## Decisión

El nuevo producto se organiza desde cero en `RBeno/tag-trace`. Durante F0 no se copia código. Esto permite fijar antes los límites de dominio, privacidad, memoria, rendimiento y pruebas.

## Qué se reutiliza

- Problemas descubiertos y requisitos validados.
- Escenarios que deben convertirse en casos de regresión.
- Lenguaje/flujo que el usuario considere útil.
- Resultados de referencia que puedan reproducirse con datos locales.

## Qué no se reutiliza automáticamente

- Arquitectura, dependencias o persistencia.
- Código de importación/Workers.
- Componentes visuales.
- Supuestos no documentados.
- Datos o builds generados.

## Auditoría previa a reutilización

Para cada pieza candidata:

1. describir intención y dependencias;
2. relacionar requisitos/reglas;
3. ejecutar o crear pruebas de comportamiento;
4. revisar privacidad, determinismo y recursos;
5. decidir `reuse`, `rewrite` o `discard` mediante tarea/ADR;
6. incorporar solo en una rama de F1 o posterior.

## Defectos aprendidos

El caso de `0 lecturas válidas` en móvil debe transformarse en TC-020 y pruebas de protocolo Worker/UI. No se atribuye a potencia insuficiente sin medición. El nuevo diseño exigirá mensajes de error con esquema, causa y filas de ejemplo.
