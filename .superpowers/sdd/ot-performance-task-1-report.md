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
