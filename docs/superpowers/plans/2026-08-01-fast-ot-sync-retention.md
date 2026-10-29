# Fast OT Sync and Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sincronizar solo OTs activas, retirar cerradas sin confirmación y depurar su detalle completado tras cinco días conservando un resumen semanal.

**Architecture:** `planning-workflow-core.js` contendrá reconciliación y retención puras. `app.js` hará una llamada ligera, aplicará el resultado y persistirá una vez. Los metadatos compactos vivirán en CONFIG para evitar nuevas hojas.

**Tech Stack:** JavaScript, Google Apps Script, Node.js test runner.

## Global Constraints

- Cinco días exactos desde la primera detección del cierre.
- Retiro inmediato y sin confirmación de Backlog y Planeado.
- Conservar solo operaciones completadas durante la retención y luego solo el resumen global.
- Un fallo de NetSuite no modifica datos.
- No modificar el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.

---

### Task 1: Reconciliación y retención puras

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `reconcileActiveWorkOrders(state, incoming, nowIso)` y `purgeClosedWorkOrderRetention(state, nowIso)`.

- [ ] Escribir pruebas fallidas para retiro automático, conservación de completadas, eliminación de pendientes/materiales/configuración y vencimiento exacto al quinto día.
- [ ] Ejecutar `node --test tests/planning-workflow-core.test.mjs`; esperar fallos por funciones ausentes.
- [ ] Implementar un registro compacto:

```js
{
  ot, item, quantity, scheduledStart, scheduledEnd,
  weekStart, finalStatus: "CERRADA", closedDetectedAt
}
```

`reconcileActiveWorkOrders` debe retirar OTs ausentes, conservar completadas temporalmente y nunca alterar `closedDetectedAt` existente. `purgeClosedWorkOrderRetention` elimina detalle cuando `now - closedDetectedAt >= 5 * 86400000`.
- [ ] Ejecutar la prueba focalizada; esperar PASS.
- [ ] Commit: `fix: reconcile closed work orders automatically`.

### Task 2: Persistencia compatible

**Files:**
- Modify: `src/server/02-storage.js`
- Test: `tests/storage-state.test.mjs`

**Interfaces:**
- Consumes/produces: `closedWorkOrderSummaries` mediante CONFIG.

- [ ] Escribir una prueba fallida de ida y vuelta y lectura legacy sin el campo.
- [ ] Ejecutar `node --test tests/storage-state.test.mjs`; esperar que el resumen no sobreviva.
- [ ] Leer `config.closedWorkOrderSummaries || {}` y escribir:

```js
['closedWorkOrderSummaries', JSON.stringify(payload.closedWorkOrderSummaries || {})]
```

- [ ] Ejecutar la prueba focalizada; esperar PASS.
- [ ] Commit: `fix: persist closed work order summaries`.

### Task 3: Sincronización ligera sin confirmación

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/performance-client-calls.test.mjs`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `fetchNetSuiteWorkOrdersLite` y funciones puras de Tasks 1–2.

- [ ] Escribir pruebas fallidas que ejecuten `syncBacklogWorkOrders`: una llamada ligera, cero diálogos, retiro automático, una persistencia y ninguna mutación ante timeout.
- [ ] Ejecutar `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs`; esperar fallo por el diálogo y reconciliación anterior.
- [ ] Sustituir comparación/diálogo por:

```js
state = window.PlanningWorkflowCore.reconcileActiveWorkOrders(
  state,
  payload.workOrders,
  new Date().toISOString(),
);
state = window.PlanningWorkflowCore.purgeClosedWorkOrderRetention(state, new Date().toISOString());
```

Usar 60 segundos solo para esta consulta manual y guardar una vez tras el resultado exitoso.
- [ ] Invocar la depuración también durante carga y antes de publicar, sin llamadas adicionales.
- [ ] Ejecutar pruebas focalizadas; esperar PASS.
- [ ] Commit: `fix: make OT sync fast and automatic`.

### Task 4: Verificación

**Files:** verificar todos los anteriores.

- [ ] Ejecutar `npm.cmd test`; esperar cero fallos.
- [ ] Ejecutar `npm.cmd run check`; esperar código 0.
- [ ] Ejecutar `git diff --check`; esperar salida limpia.
- [ ] Confirmar por diff que no se modificó el proyecto protegido ni archivos ajenos.
