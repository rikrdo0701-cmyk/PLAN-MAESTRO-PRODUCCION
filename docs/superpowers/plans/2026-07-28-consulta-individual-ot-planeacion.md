# Consulta individual de OT para Planeación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consultar y fusionar una sola OT con sus materias primas y operaciones antes de agregarla a Planeado mediante clic o drag and drop.

**Architecture:** Un servicio Apps Script reutiliza el detalle individual de NetSuite y lo adapta al contrato del planeador. El cliente concentra clic y arrastre en `selectJob`, comparte una sola promesa por OT y fusiona únicamente los datos recibidos.

**Tech Stack:** Google Apps Script, JavaScript del navegador, `node:test`, puente GitHub Pages–Apps Script.

## Global Constraints

- No aumentar el límite general de 4,000 operaciones.
- No refrescar la página ni reemplazar el borrador completo.
- No modificar el proyecto Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
- Si faltan operaciones, CT o tiempo, mantener la OT en Backlog.

---

### Task 1: Servicio individual de planeación

**Files:**
- Create: `src/server/18-planning-work-order-service.js`
- Modify: `src/web/bridge/Bridge.html`
- Create: `tests/planning-work-order-service.test.mjs`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `PP_Inspection_restlet_({ action: "detail", woFolio })`, `PP_mapNetSuiteOperation_`, `PP_mapNetSuiteMaterial_`.
- Produces: `getPlanningWorkOrderData(ot) -> { ok, data?: { workOrder, operations, materials }, error? }`.

- [ ] **Step 1: Write the failing service tests**

```js
test("adapta una OT individual al contrato del planeador", () => {
  const context = loadService({
    trabajo: { wo: "2773", Articulo: "C 590 LE", cantidad: 3 },
    operaciones: [{ Operacion: "CORTE", secuencia: 10, centro: "5461", remaining_min: 25, Estado: "In Process" }],
    materiales: [{ componente: "MP00098", requerido: 3, pendiente: 3 }]
  });
  const result = context.getPlanningWorkOrderData("2773");
  assert.equal(result.ok, true);
  assert.equal(result.data.operations[0].ot, "2773");
  assert.equal(result.data.operations[0].ct, "5461");
  assert.equal(result.data.operations[0].tiempoProd, 25);
  assert.equal(result.data.materials[0].component, "MP00098");
});

test("rechaza detalle sin CT o tiempo de planeacion", () => {
  const context = loadService({ trabajo: { wo: "2773" }, operaciones: [{ Operacion: "CORTE", secuencia: 10 }] });
  const result = context.getPlanningWorkOrderData("2773");
  assert.equal(result.ok, false);
  assert.match(result.error, /CT|tiempo/i);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/planning-work-order-service.test.mjs`

Expected: FAIL because `getPlanningWorkOrderData` does not exist.

- [ ] **Step 3: Implement the minimal service**

```js
function getPlanningWorkOrderData(ot) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(ot, 80);
    if (!folio) throw new Error('OT requerida');
    const response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
    const workOrder = response.trabajo || response.workOrder;
    if (!workOrder) throw new Error('OT no encontrada en NetSuite');
    const current = { operations: [] };
    const operations = (response.operaciones || response.operations || []).map(function(row, index) {
      const normalized = Object.assign({}, row, {
        'Orden de trabajo': folio,
        'Centro de trabajo': PP_Inspection_value_(row, ['Centro de trabajo', 'centro', 'CT', 'workcenter']),
        'Tiempo estimado (min)': PP_Inspection_value_(row, ['Tiempo estimado (min)', 'remaining_min', 'estimated_min', 'tiempo'])
      });
      return PP_mapNetSuiteOperation_(normalized, index, current);
    }).filter(PP_planningIndividualOperationValid_);
    if (!operations.length) throw new Error('NetSuite no devolvio operaciones con CT y tiempo para la OT ' + folio);
    const materials = (response.materiales || response.materials || []).map(function(row, index) {
      return PP_mapNetSuiteMaterial_(Object.assign({}, row, {
        'WO Folio': folio,
        'Componente': PP_Inspection_value_(row, ['Componente', 'componente', 'component']),
        'Requerido': PP_Inspection_value_(row, ['Requerido', 'requerido', 'required']),
        'Emitido': PP_Inspection_value_(row, ['Emitido', 'emitido', 'issued']),
        'Pendiente': PP_Inspection_value_(row, ['Pendiente', 'pendiente', 'pending'])
      }), index);
    });
    return { workOrder: workOrder, operations: operations, materials: materials };
  });
}

function PP_planningIndividualOperationValid_(operation) {
  return Boolean(operation && operation.ct && operation.ct !== 'SIN_CT' && Number(operation.tiempoProd) > 0);
}
```

Add `getPlanningWorkOrderData: true` to the bridge allowlist.

- [ ] **Step 4: Run service and bridge tests**

Run: `node --test tests/planning-work-order-service.test.mjs tests/build.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/server/18-planning-work-order-service.js src/web/bridge/Bridge.html tests/planning-work-order-service.test.mjs tests/build.test.mjs
git commit -m "feat: load one work order for planning"
```

### Task 2: Fusión cliente y consulta compartida

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `tests/performance-client-calls.test.mjs`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `getPlanningWorkOrderData(ot)`.
- Produces: `ensureWorkOrderPlanningData(ot) -> Promise<{ ready, error }>` y `mergeIndividualPlanningData(payload, ot)`.

- [ ] **Step 1: Write failing tests for one request and isolated merge**

```js
test("dos intentos simultaneos comparten la consulta individual", async () => {
  const gate = deferred();
  const detail = { operations: [{ ot: "2773", ct: "5461", tiempoProd: 25 }], materials: [{ ot: "2773", component: "MP00098" }] };
  const harness = loadPlanningApp({ getPlanningWorkOrderData: () => gate.promise });
  const first = harness.ensureWorkOrderPlanningData("2773");
  const second = harness.ensureWorkOrderPlanningData("2773");
  assert.equal(harness.calls("getPlanningWorkOrderData"), 1);
  gate.resolve({ ok: true, data: detail });
  assert.equal((await first).ready, true);
  assert.equal((await second).ready, true);
});

test("la fusion reemplaza solo datos de la OT solicitada", () => {
  const original2001 = { ot: "2001", ct: "5461", tiempoProd: 10 };
  const state = { operations: [original2001, { ot: "2773", ct: "SIN_CT" }], materials: [] };
  const detail = { operations: [{ ot: "2773", ct: "5461", tiempoProd: 25 }], materials: [{ ot: "2773", component: "MP00098" }] };
  mergeIndividualPlanningData(state, detail, "2773");
  assert.deepEqual(state.operations.filter(op => op.ot === "2001"), [original2001]);
  assert.equal(state.operations.filter(op => op.ot === "2773").length, 1);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs`

Expected: FAIL because the individual loader and merge do not exist.

- [ ] **Step 3: Implement shared loading and isolated merge**

```js
const workOrderPlanningRequests = new Map();

function mergeIndividualPlanningData(payload, ot) {
  const key = normalizeKey(ot);
  state.operations = state.operations.filter(item => normalizeKey(item.ot) !== key).concat(payload.operations || []);
  state.materials = state.materials.filter(item => normalizeKey(item.ot) !== key).concat(payload.materials || []);
  invalidateCurrentPlanOperationsCache();
  resetBacklogWindow();
}

function ensureWorkOrderPlanningData(ot) {
  if (jobPlanningOperations(getPriorityJobs().find(item => item.ot === ot)).length) {
    return Promise.resolve({ ready: true, source: "cached" });
  }
  if (workOrderPlanningRequests.has(ot)) return workOrderPlanningRequests.get(ot);
  const request = callAppsScript("getPlanningWorkOrderData", ot).then(result => {
    if (!result?.ok) return { ready: false, error: result?.error || "NetSuite no devolvio la OT" };
    mergeIndividualPlanningData(result.data, ot);
    return { ready: jobPlanningOperations(getPriorityJobs().find(item => item.ot === ot)).length > 0 };
  }).catch(error => ({ ready: false, error: error.message })).finally(() => workOrderPlanningRequests.delete(ot));
  workOrderPlanningRequests.set(ot, request);
  return request;
}
```

- [ ] **Step 4: Run client tests**

Run: `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/web/planning/app.js tests/performance-client-calls.test.mjs tests/build.test.mjs
git commit -m "feat: merge individual planning data"
```

### Task 3: Unificar clic y drag and drop, validar y publicar

**Files:**
- Modify: `src/web/planning/app.js`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `ensureWorkOrderPlanningData(ot)`.
- Produces: `selectJob(ot, true)` como único punto de entrada para clic y drag and drop.

- [ ] **Step 1: Write failing flow assertions**

```js
assert.match(selectJobSource, /await ensureWorkOrderPlanningData\(ot\)/);
assert.doesNotMatch(selectJobSource, /ensurePlanningDataLoaded\(true,\s*\{\s*force:\s*true\s*\}\)/);
assert.match(clickSource, /selectJob\(job\.ot,\s*true\)/);
assert.match(dragSource, /selectJob\(sourceOt,\s*true\)/);
```

- [ ] **Step 2: Run the flow test and verify RED**

Run: `node --test --test-name-pattern "consulta individual" tests/build.test.mjs`

Expected: FAIL because `selectJob` still launches la sincronización general.

- [ ] **Step 3: Replace the general sync in `selectJob`**

```js
if (selected && !alreadySelected && !jobPlanningOperations(job).length) {
  setWorkOrderPlanningBusy(ot, true);
  let loaded;
  try {
    loaded = await ensureWorkOrderPlanningData(ot);
  } finally {
    setWorkOrderPlanningBusy(ot, false);
  }
  job = getPriorityJobs().find(item => item.ot === ot);
  if (!loaded.ready || !jobPlanningOperations(job).length) {
    showToast(loaded.error || `La OT ${ot} no devolvio operaciones validas de NetSuite`, 9000);
    return;
  }
}
```

```js
function setWorkOrderPlanningBusy(ot, busy) {
  const card = Array.from(els.priorityList.querySelectorAll(".priority-card"))
    .find(item => item.dataset.ot === ot);
  if (!card) return;
  card.toggleAttribute("aria-busy", busy);
  const addButton = card.querySelector(".job-add");
  if (addButton) addButton.disabled = busy;
}
```

- [ ] **Step 4: Run complete verification**

Run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check
git diff --check
```

Expected: all tests PASS, build/check exit `0`, no whitespace errors.

- [ ] **Step 5: Browser QA after deployment**

Flow: GitHub Pages → buscar OT 2773 → pulsar `+` → observar carga solo en esa tarjeta → confirmar OT en Planeado con operaciones; repetir retirando la OT y usando drag and drop.

Expected: no page refresh, no full synchronization, no console errors, and both interactions add the same OT data.

- [ ] **Step 6: Commit**

```powershell
git add src/web/planning/app.js tests/build.test.mjs
git commit -m "fix: add backlog work orders with individual data"
```
