# Tarea 2 — Sincronización ligera del Backlog

## RED

- Se agregaron primero aserciones de build para el botón, función, contratos del core, busy state, advertencias y ausencia de endpoints completos.
- `node --test tests/build.test.mjs` falló como se esperaba porque `syncBacklogOtsBtn` aún no existía.

## GREEN

- Se agregó el botón compacto al encabezado del Backlog y el flujo `syncBacklogWorkOrders()`.
- El flujo usa únicamente `syncNetSuiteWorkOrdersLite` con el timeout existente, compara antes de aplicar, confirma una sola vez los cambios planeados y persiste estado/snapshot.
- Las advertencias rechazadas se muestran en tarjetas; las cerradas conservadas quedan fuera del motor.
- Se amplió la exclusión mutua para deshabilitar sincronización ligera, sincronización completa y programación.

## Archivos

- `src/web/planning/index.template.html`
- `src/web/planning/styles.css`
- `src/web/planning/app.js`
- `tests/build.test.mjs`

## Verificación

- `node --test tests/build.test.mjs`: 1/1.
- `node --test tests/planning-workflow-core.test.mjs`: 32/32.
- `npm.cmd run build`: correcto, 16 archivos servidor, 4 vistas y 5 páginas.
- `npm.cmd test`: 57/57.
- `git diff --check`: sin errores (sólo avisos informativos de conversión LF/CRLF).

## Auto-revisión

- Alcance limitado a los cuatro archivos autorizados más este reporte; no se modificaron backend ni core.
- La función ligera no contiene llamadas a operaciones, materiales, catálogos, planta ni sync completo.
- No se reasignan masivamente OTs entre Backlog y Planeado/Por planear.
- Se corrigió el conteo de retiradas para no contar OTs cerradas que el usuario decidió conservar.
- Las advertencias reconciliadas se sustituyen en vez de acumular duplicados.

## Commit

- Mensaje: `Agregar sincronizacion de OTs en Backlog`.
- Hash: se informa en la entrega de la tarea (el hash incluye este reporte).

## Preocupaciones

- La confirmación usa casillas: desmarcada significa conservar/rechazar, marcada significa aceptar cantidad o retirar la OT cerrada.
- No se hizo prueba E2E contra Apps Script real; la suite valida el artefacto construido y los contratos puros del workflow.
