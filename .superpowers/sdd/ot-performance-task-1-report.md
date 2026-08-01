# Task 1 report: Precarga, cache y feedback

## Alcance entregado

- `prefetchRecentPlanningWorkOrders` precarga hasta 5 OTs, con concurrencia maxima de 2 y la OT de busqueda exacta al frente.
- `ensureWorkOrderPlanningData` conserva la promesa compartida, usa cache de 10 minutos y aplica timeout de 30 segundos; fallos eliminan la promesa para permitir reintento.
- El cliente de rendimiento activa la precarga despues de renderizar el backlog.
- Las tarjetas exponen `Cargando`, `Guardando`, `Guardado` o `Error`; el envoltorio completo de `selectJob` captura errores inesperados.

## TDD

RED: `node --test tests/performance-client-calls.test.mjs` fallo como se esperaba al no existir la precarga, al no vencer la cache y al no aplicar timeout/reintento.

GREEN:

- `node --test tests/performance-client-calls.test.mjs` — 65/65.
- `npm.cmd test` — 308/308.
- `npm.cmd run check` — correcto.
- `git diff --check` — correcto.

## Archivos modificados

- `src/web/planning/app.js`
- `src/web/shared/performance-client.js`
- `tests/performance-client-calls.test.mjs`

No se modifico el Apps Script protegido.

## Revision posterior

- La cola de precarga ahora es global: todas las invocaciones de render/busqueda comparten el limite de 2 solicitudes activas.
- `Guardado` y `Error` se conservan por 3 segundos en el estado de la accion, por lo que un rerender de la tarjeta vuelve a mostrar el resultado.
- Invariante de recencia: se ordena por `workOrder.startDate` descendente, que es el campo normalizado disponible para cada OT. Si dos fechas son iguales o faltan, se conserva el orden recibido del backend; no se infiere recencia desde el folio de OT.

### RED exacto

`node --test tests/performance-client-calls.test.mjs` fallo antes de la correccion:

- `las precargas repetidas comparten el limite global de dos solicitudes`: `3 !== 2`.
- `la precarga usa startDate descendente y conserva el orden recibido cuando empata`: el orden recibido no priorizaba `startDate`.
- `la accion individual conserva Guardado para el siguiente render de su tarjeta`: se obtuvo `typeof actionStatus === "object"` en lugar de `"function"`.

### GREEN exacto

- `node --test tests/performance-client-calls.test.mjs` — 67/67.
- `npm.cmd test` — 310/310.
- `npm.cmd run check` — correcto.
- `git diff --check` — correcto.
