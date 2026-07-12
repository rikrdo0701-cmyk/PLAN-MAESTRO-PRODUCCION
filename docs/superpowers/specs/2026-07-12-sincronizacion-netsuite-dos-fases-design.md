# Diseño: sincronización NetSuite en dos fases

## Objetivo

Actualizar las OTs rápidamente sin depender del tiempo requerido para consultar operaciones y materiales, preservando siempre el borrador actual.

## Flujo

El botón `Sincronizar` ejecutará secuencialmente:

1. `syncNetSuiteWorkOrdersLite` para obtener OTs y datos comerciales.
2. `syncNetSuitePlanningData` para obtener operaciones, materiales y catálogo.

La primera respuesta se aplicará inmediatamente a `workOrders` y al backlog. No reemplazará operaciones, fechas, recursos, prioridades, selección ni configuraciones del borrador.

La segunda respuesta actualizará datos NetSuite reutilizables y detectará cambios, pero conservará la instantánea programada hasta que el usuario genere nuevamente el plan.

## Estados de interfaz

- Fase 1: `Sincronizando OTs…`.
- Fase 2: `Sincronizando operaciones…`.
- Completo: `OTs y operaciones actualizadas`.
- Parcial: `OTs actualizadas; operaciones pendientes de sincronizar`.
- Error inicial: `No se pudieron sincronizar las OTs: <causa>`.

Mientras cualquiera de las fases esté activa, `Sincronizar` y `Generar plan` permanecerán deshabilitados. El bloqueo se liberará incluso si ocurre error o timeout.

## Timeout y conservación

La fase de operaciones tendrá timeout controlado. Su vencimiento no revertirá las OTs recibidas en la primera fase. No se mostrará el mensaje ambiguo de programar con datos cargados como resultado principal de una sincronización manual.

Si falla la fase de OTs, no se inicia la fase de operaciones y no se modifica el estado.

## Pruebas

- Ambas fases correctas actualizan OTs y operaciones.
- Timeout de operaciones conserva las OTs recién recibidas.
- Error de OTs no cambia el estado ni ejecuta la segunda fase.
- El borrador conserva selección, programación y configuraciones en los tres resultados.
- Botones y etiquetas reflejan cada fase y siempre se desbloquean.
- QA en GitHub Pages confirma una sincronización manual y ausencia de errores de consola.
