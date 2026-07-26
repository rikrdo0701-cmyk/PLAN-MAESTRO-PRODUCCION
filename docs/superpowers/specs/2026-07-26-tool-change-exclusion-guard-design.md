# Protección de cambio de herramental obligatorio

## Objetivo

Impedir que `TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL` sea excluido del plan y garantizar que estados antiguos, importados o manipulados no oculten cambios de herramental generados por el motor.

## Diseño

- La matriz mostrará la capacidad obligatoria con estado fijo `Usar en el plan`; el selector estará deshabilitado y la eliminación seguirá bloqueada.
- La normalización de exclusiones del cliente y del servidor descartará la clave obligatoria. Esto cubrirá carga local/remota, importación JSON, estado legacy y guardados completos o parciales porque esas rutas ya usan los normalizadores compartidos.
- El motor tratará las operaciones generadas `CAMBIO_HERRAMENTAL` como no excluibles. `filterExcludedOperations` conservará estas operaciones incluso si recibe directamente un estado corrupto que contiene la clave obligatoria.
- Las demás capacidades conservarán el comportamiento actual de exclusión.

## Flujo de datos

1. El cliente carga o importa exclusiones y elimina la clave obligatoria durante la normalización.
2. La UI presenta TOOL_CHANGE como obligatorio y no permite cambiar su estado.
3. Los guardados cliente y servidor vuelven a normalizar el arreglo.
4. El motor agenda los cambios requeridos y el filtro de vistas conserva los cambios generados.

## Pruebas

- Una prueba funcional integral partirá de un estado corrupto con la clave obligatoria, ejecutará el programador con doblados que requieren un cambio y verificará que el cambio aparezca tanto en el resultado como en la fuente filtrada visible.
- Pruebas de UI y persistencia verificarán el control fijo y el saneamiento cliente/servidor, incluidos formatos legacy/importados.
- Se ejecutarán la suite completa, build, check y validación del diff.

## Fuera de alcance

- No se modificarán las reglas de generación, duración o asignación de los cambios.
- No se cambiará la protección existente de `removeCapability`.
- No se tocarán RESTlets ni archivos raíz protegidos de Apps Script.
