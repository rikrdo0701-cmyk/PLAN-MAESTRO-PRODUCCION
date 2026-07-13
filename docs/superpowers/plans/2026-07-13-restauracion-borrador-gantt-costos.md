# Restauración de borrador, Gantt de herramental y costos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir restaurar cualquier publicado como borrador reconciliado, sincronizar rápidamente OTs del Backlog, mostrar cambios de herramental en el Gantt por máquina y calcular correctamente el costo por pieza semanal.

**Architecture:** Las decisiones de reconciliación y cálculo vivirán como funciones puras en `planning-workflow-core.js`; `app.js` coordinará modales, estado y renderizado. Apps Script conservará instantáneas completas publicadas y reemplazará el borrador de forma atómica con respaldo técnico. El Gantt reutilizará las operaciones de cambio ya generadas, sin crear reservas adicionales.

**Tech Stack:** JavaScript ES2022, Node.js test runner, Google Apps Script, HTML/CSS, GitHub Pages build.

## Global Constraints

- Los planes publicados son inmutables y nunca se abren para edición.
- El único documento editable es la instantánea `draft`.
- Restaurar, sincronizar y programar son acciones mutuamente excluyentes.
- Una OT cerrada no consume capacidad y una operación completada nunca se reabre automáticamente.
- Un precio numérico `0` es válido; solo `null`, `undefined` o vacío significan ausencia.
- Las operaciones bloqueadas no se mueven silenciosamente.
- Los cambios se desarrollan con TDD y cada tarea termina en un commit verificable.

---

### Task 1: Funciones puras de sincronización ligera

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `compareWorkOrderLite(currentState, incomingWorkOrders) -> { direct, plannedQuantityChanges, plannedClosed, nextWorkOrders }`
- Produces: `applyConfirmedWorkOrderChanges(state, comparison, decisions) -> state`
- Consumes: `removeOtFromDraft`, `isPendingDraftOperation`.

- [ ] **Step 1: Write failing comparison tests**

Add tests covering: a new OT goes only to `nextWorkOrders`; a Backlog quantity change is `direct`; a planned quantity change is in `plannedQuantityChanges`; a missing selected OT is in `plannedClosed`; and no operation/configuration collection is mutated.

```js
const comparison = core.compareWorkOrderLite({
  selectedOts: ["200"],
  workOrders: [
    { ot: "100", item: "A", quantity: 10, builtQuantity: 0, pendingQuantity: 10 },
    { ot: "200", item: "B", quantity: 20, builtQuantity: 0, pendingQuantity: 20 },
  ],
  operations: [{ id: "op", ot: "200" }],
}, [
  { ot: "100", item: "A", quantity: 12, builtQuantity: 0, pendingQuantity: 12 },
  { ot: "300", item: "C", quantity: 5, builtQuantity: 0, pendingQuantity: 5 },
]);
assert.deepEqual(comparison.direct.map((x) => x.ot), ["100", "300"]);
assert.deepEqual(comparison.plannedClosed.map((x) => x.ot), ["200"]);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/planning-workflow-core.test.mjs`

Expected: FAIL because `compareWorkOrderLite` is undefined.

- [ ] **Step 3: Implement normalized comparison**

Implement keyed comparison using the existing `normalize` helper. Preserve current-only UI fields when merging incoming OT/article/quantity fields. Return new arrays and never mutate arguments.

- [ ] **Step 4: Write failing application tests**

Test that accepting a planned quantity change clears `fechaInicio`, `horaInicio`, `fechaFin`, `horaFin` only on pending unlocked operations, preserves completed and locked operations, sets `draftNeedsReschedule: true`, and records `workOrderSyncWarnings` when the user cancels. Test that accepting a closed OT removes it from selection even if locked while preserving completed history.

- [ ] **Step 5: Implement decisions atomically in memory**

`decisions` must have exact shape:

```js
{
  acceptQuantityOts: ["200"],
  removeClosedOts: ["400"],
  keepClosedOts: ["500"]
}
```

Return a new state with `draftNeedsReschedule`, `workOrderSyncWarnings` and coherent `selectedOts`, `lockedOts`, priorities and `lastSchedule.scheduledOts`.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/planning-workflow-core.test.mjs`

Expected: all tests PASS.

Run: `npm.cmd test`

Expected: all project tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/planning/planning-workflow-core.js tests/planning-workflow-core.test.mjs
git commit -m "Agregar reconciliacion ligera de OTs"
```

---

### Task 2: Botón Sincronizar OTs en Backlog

**Files:**
- Modify: `src/web/planning/index.template.html`
- Modify: `src/web/planning/styles.css`
- Modify: `src/web/planning/app.js`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `compareWorkOrderLite`, `applyConfirmedWorkOrderChanges` from Task 1.
- Consumes backend method: `syncNetSuiteWorkOrdersLite()` already exposed.
- Produces UI action: `syncBacklogWorkOrders()`.

- [ ] **Step 1: Write failing build assertions**

Require `id="syncBacklogOtsBtn"`, label `Sincronizar OTs`, `callAppsScript("syncNetSuiteWorkOrdersLite")`, calls to both pure helpers, and `setPlanningActionsBusy("backlog-sync", true/false)`.

- [ ] **Step 2: Run build test and verify RED**

Run: `node --test tests/build.test.mjs`

Expected: FAIL because the Backlog action is absent.

- [ ] **Step 3: Add compact Backlog action and state binding**

Place the button in the Backlog header, not the global toolbar. Register it in the element map and disable it whenever `planningActionsBusy` contains schedule, sync, restore or backlog-sync.

- [ ] **Step 4: Implement the lightweight flow**

`syncBacklogWorkOrders()` must:

1. Reject while another planning action is active.
2. Call only `syncNetSuiteWorkOrdersLite` with the existing timeout wrapper.
3. Compare without first pruning selected OTs.
4. Apply direct Backlog changes.
5. Present one confirmation dialog listing planned quantity changes and closed/missing planned OTs.
6. Apply accepted decisions through `applyConfirmedWorkOrderChanges`.
7. Persist state and replace the draft snapshot when the draft changed.
8. Show counts of new, updated, removed and pending-confirmation OTs.

Do not call `syncNetSuitePlanningData`, `syncNetSuitePlant` or any catalog/material endpoint.

- [ ] **Step 5: Render persistent warnings**

Cards retained after cancellation must show `Cantidad diferente en NetSuite` or `Cerrada o no encontrada en NetSuite`. `scheduleCurrentPlan()` must exclude warned-closed OTs and retain warned-quantity OTs only after the quantity is accepted.

- [ ] **Step 6: Verify build and suite**

Run: `node --test tests/build.test.mjs tests/planning-workflow-core.test.mjs`

Expected: PASS.

Run: `npm.cmd run build`

Expected: Apps Script and Pages generated successfully.

- [ ] **Step 7: Commit**

```bash
git add src/web/planning/index.template.html src/web/planning/styles.css src/web/planning/app.js tests/build.test.mjs
git commit -m "Agregar sincronizacion de OTs en Backlog"
```

---

### Task 3: Instantánea publicada completa y restauración atómica

**Files:**
- Modify: `src/server/02-storage.js`
- Modify: `src/server/01-code.js`
- Modify: `src/server/05-publishing-service.js`
- Modify: `src/web/planning/planning-workflow-core.js`
- Test: `tests/planning-workflow-core.test.mjs`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces server method: `restorePublishedPlanAsDraft(snapshotId, currentPayload)`.
- Produces pure helper: `reconcilePublishedPlan(snapshot, currentState) -> { state, summary }`.
- `summary` exact keys: `restoredOts`, `closedOts`, `completedOperations`, `removedOperations`, `newOperations`, `preservedConfigurations`.

- [ ] **Step 1: Write failing reconciliation tests**

Cover: closed OT omitted; completed operation stays completed; current operation absent from snapshot is added pending without dates; historical operation absent currently is omitted; current machine/tool/kit/subcontract wins; published values fill only missing current values; generated tool changes are discarded.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/planning-workflow-core.test.mjs`

Expected: FAIL because `reconcilePublishedPlan` is undefined.

- [ ] **Step 3: Implement operation identity and reconciliation**

Reuse the completion identity logic. Match productive operations by stable OT/sequence/CT identity, not snapshot row number alone. Preserve completed markers from current state. Set unmatched new operations to `PENDIENTE` with empty scheduling fields.

- [ ] **Step 4: Extend historical payload without breaking row reports**

Continue writing report rows to `PLANES_HISTORICOS`, and additionally persist the complete published payload under a snapshot-scoped configuration key such as `PLAN_SNAPSHOT_PAYLOAD::<snapshotId>`. `PP_getPlanSnapshot_` must return `fullState` when present and remain compatible with old row-only snapshots.

- [ ] **Step 5: Implement transactional server restore**

`restorePublishedPlanAsDraft` must acquire the script lock, read the immutable historical payload, reconcile using the supplied current payload/result generated by the client helper, copy current `BORRADOR_PLAN` rows and current planning state, write the replacement draft/state, and restore both previous values in `catch` before rethrowing.

The server response must be:

```js
{ ok: true, snapshotId: "draft", backupId, state, summary }
```

The backup must use a technical key/prefix and must not be returned by `PP_listPlanSnapshots_` as a published plan.

- [ ] **Step 6: Add bridge/build exposure assertions**

Require the Apps Script public wrapper, bridge allowlist entry and full-state persistence key in `tests/build.test.mjs`.

- [ ] **Step 7: Run validation**

Run: `npm.cmd test`

Expected: all tests PASS.

Run: `npm.cmd run check`

Expected: `Validacion correcta`.

- [ ] **Step 8: Commit**

```bash
git add src/server/02-storage.js src/server/01-code.js src/server/05-publishing-service.js src/web/planning/planning-workflow-core.js tests/planning-workflow-core.test.mjs tests/build.test.mjs
git commit -m "Permitir restaurar publicados como borrador"
```

---

### Task 4: Flujo Restaurar borrador en Plan semanal

**Files:**
- Modify: `src/web/planning/index.template.html`
- Modify: `src/web/planning/styles.css`
- Modify: `src/web/planning/app.js`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `listPlanSnapshots`, `getPlanSnapshot`, `reconcilePublishedPlan`, `restorePublishedPlanAsDraft`.
- Produces UI action: `openRestoreDraftDialog()`.

- [ ] **Step 1: Write failing build assertions**

Require a Plan semanal button `Restaurar borrador`, the functions `openRestoreDraftDialog`, `previewDraftRestore`, `confirmDraftRestore`, and the call to `restorePublishedPlanAsDraft`.

- [ ] **Step 2: Run build test and verify RED**

Run: `node --test tests/build.test.mjs`

Expected: FAIL because restoration UI is absent.

- [ ] **Step 3: Add published-plan selection modal**

Show only published historical snapshots, with publication timestamp, user, plan start and operation count. Do not reuse the report selector as an editor. Include last synchronization timestamp and buttons `Sincronizar antes de restaurar`, `Continuar con datos cargados` and `Cancelar`.

- [ ] **Step 4: Add preview and confirmation**

Render the six summary collections from Task 3. The final confirm copy must state that the current draft will be replaced, a backup will be retained, and the published original will remain unchanged.

- [ ] **Step 5: Coordinate mutual exclusion and reload**

Use `setPlanningActionsBusy("restore", true)` for preview/sync/write. On success, replace the in-memory editable state with the returned draft, clear report-only `reportSnapshot`, persist local state, render Plan semanal and show `Borrador restaurado; revisa y genera nuevamente el plan`. Never schedule automatically.

- [ ] **Step 6: Verify UI build tests**

Run: `node --test tests/build.test.mjs tests/planning-workflow-core.test.mjs`

Expected: PASS.

Run: `npm.cmd run build`

Expected: generated Pages contains the new button and modal code.

- [ ] **Step 7: Commit**

```bash
git add src/web/planning/index.template.html src/web/planning/styles.css src/web/planning/app.js tests/build.test.mjs
git commit -m "Agregar restauracion de borrador en Plan semanal"
```

---

### Task 5: Mostrar cambios de herramental en Gantt por Máquina

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Modify: `src/web/planning/styles.css`
- Test: `tests/planning-workflow-core.test.mjs`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces: `isMachineGanttOperation(op) -> boolean`.
- Consumes existing `CAMBIO_HERRAMENTAL` operations; creates no new scheduling entries.

- [ ] **Step 1: Write failing classification tests**

Assert true for a scheduled bending operation with machine and for a scheduled `CAMBIO_HERRAMENTAL` with machine; false for unrelated operations, missing machine, old generated pending changes excluded from the current draft and completed changes.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/planning-workflow-core.test.mjs`

Expected: FAIL because `isMachineGanttOperation` is undefined.

- [ ] **Step 3: Implement classification and replace the defective filter**

Change `ganttOperationHasMachine` to delegate to the pure helper. Preserve the existing selected/pending/current-run filtering from `visibleOperations`; do not append or clone changes.

- [ ] **Step 4: Add differentiated bar content**

For a tool change, add class `gantt-bar--tool-change`, visible text `Cambio de herramental`, and tooltip fields for machine, origin tool/kit, destination tool/kit, adjuster, start, end and productive duration. Keep geometry based on the existing start/end.

- [ ] **Step 5: Add build regression**

Require the helper call, CSS class and tooltip labels. Assert that the machine filter no longer consists solely of `isBendingAppOperation(op)`.

- [ ] **Step 6: Verify engine and UI tests**

Run: `node --test tests/planner-core.test.mjs tests/planning-workflow-core.test.mjs tests/build.test.mjs`

Expected: PASS, including the existing two-OT/different-tool transition test.

- [ ] **Step 7: Commit**

```bash
git add src/web/planning/planning-workflow-core.js src/web/planning/app.js src/web/planning/styles.css tests/planning-workflow-core.test.mjs tests/build.test.mjs
git commit -m "Mostrar cambios de herramental por maquina"
```

---

### Task 6: Calcular costo semanal y costo por pieza

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js`
- Test: `tests/planning-workflow-core.test.mjs`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces: `weeklyFinishingCost(rows) -> { finishingPieces, totalCost, costPerPiece }`.
- Each input row: `{ ot, pendingPieces, amount, unitPrice }`.

- [ ] **Step 1: Write failing money tests**

Test one row per finishing OT, duplicate OT ignored, absent amount reconstructed from unit price, explicit zero amount/price preserved, starting-only rows excluded by the caller, and zero pieces returns all zero without `NaN`.

```js
assert.deepEqual(core.weeklyFinishingCost([
  { ot: "1", pendingPieces: 10, amount: null, unitPrice: 5 },
  { ot: "2", pendingPieces: 5, amount: 0, unitPrice: 99 },
]), { finishingPieces: 15, totalCost: 50, costPerPiece: 50 / 15 });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/planning-workflow-core.test.mjs`

Expected: FAIL because `weeklyFinishingCost` is undefined.

- [ ] **Step 3: Implement null-aware amount calculation**

Use `hasValue = value !== null && value !== undefined && String(value).trim() !== ""`; never use `||` for money fallback. Deduplicate by normalized OT and sum pieces/cost once.

- [ ] **Step 4: Integrate summary and type groups**

`weeklyExecutiveSummary` must call the helper on `summary.finishes`. `weeklyJobSummary` must retain absence as `null` instead of converting it prematurely to zero. `groupFinishingRowsByType` must use the same helper per group. Keep the visible label `Costo p/p` and currency format.

- [ ] **Step 5: Add build source assertions**

Require `PlanningWorkflowCore.weeklyFinishingCost` in the generated Pages build and assert the summary no longer uses `Number(row.amount || 0)` for the primary cost calculation.

- [ ] **Step 6: Run verification**

Run: `node --test tests/planning-workflow-core.test.mjs tests/build.test.mjs`

Expected: PASS.

Run: `npm.cmd test`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/planning/planning-workflow-core.js src/web/planning/app.js tests/planning-workflow-core.test.mjs tests/build.test.mjs
git commit -m "Corregir costo por pieza semanal"
```

---

### Task 7: QA integral, documentación y publicación

**Files:**
- Test: all project tests

**Interfaces:**
- Consumes all prior task deliverables.
- Produces verified GitHub Pages/App Script build ready for publication.

- [ ] **Step 1: Run static and automated verification**

Run:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run build
git diff --check
```

Expected: all tests pass, validation is correct, both targets build, and diff check reports no errors.

- [ ] **Step 2: QA Backlog synchronization in browser**

Verify new OT, Backlog quantity change, planned quantity confirmation accept/cancel, closed planned confirmation accept/cancel, locked OT warning and mutual exclusion with programming.

- [ ] **Step 3: QA restoration in browser**

Publish a controlled plan, modify the draft, restore that historical publication, verify preview counts, verify the published report remains unchanged, and verify no automatic scheduling occurs.

- [ ] **Step 4: QA Gantt and cost scenario**

Use two OTs on the same machine with different tools. Verify both bending bars plus one transition bar in Machine view and the same transition in Ajustador. Verify the weekly total and `Costo p/p` manually from finishing OTs, including one zero-price OT.

- [ ] **Step 5: Review browser console**

Navigate Plan semanal and Reportes; require no uncaught exceptions, no missing bridge method, and no stale service-worker asset error.

- [ ] **Step 6: Final code review**

Review the full range against the specification, focusing on immutable publications, atomic draft rollback, completed operation preservation and absence-vs-zero money semantics. Fix any Important or Critical finding with a regression test.

- [ ] **Step 7: Resolve any QA finding in its owning task**

If QA finds a defect, return to the task that owns that file, add the failing regression there, apply the minimal fix, rerun that task's verification commands and create the task-specific commit documented in that section. When QA has no findings, continue without creating an empty commit.

- [ ] **Step 8: Push**

```bash
git push origin main
```

Expected: remote `main` advances to the verified commit and the Pages workflow starts.
