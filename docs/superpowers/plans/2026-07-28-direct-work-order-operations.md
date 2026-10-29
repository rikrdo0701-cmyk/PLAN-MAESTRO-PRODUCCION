# Direct Work Order Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load complete NetSuite operation tasks when adding or opening a work order.

**Architecture:** Replace the individual RESTlet operation lookup with a focused SuiteQL query to `manufacturingoperationtask`. Reuse the existing deduplicated client loader and invoke it asynchronously from the detail panel.

**Tech Stack:** Google Apps Script, SuiteQL, browser JavaScript, Node test runner.

## Global Constraints

- Do not refresh the page.
- Reuse one concurrent request per OT and preserve existing state on failure.
- Estimated minutes equal setup time plus run rate multiplied by pending quantity.

---

### Task 1: Direct NetSuite operation-task loader

**Files:**
- Modify: `src/server/18-planning-work-order-service.js`
- Test: `tests/planning-work-order-service.test.mjs`

**Interfaces:**
- Consumes: `PP_netSuiteConfig_()`, `PP_oauthHeader_()`, inspection detail data.
- Produces: `PP_fetchDirectWorkOrderOperations_(workOrderId, folio, quantity)` returning normalized planning rows.

- [ ] **Step 1: Write the failing tests**

Add cases that stub `UrlFetchApp.fetch` and assert:

```js
assert.match(request.payload, /manufacturingoperationtask/i);
assert.equal(result.data.operations.length, 12);
assert.equal(result.data.operations[0].ct, "5458");
assert.equal(result.data.operations[0].tiempoProd, 6 + (0.62 * 3));
```

Also assert a row with `runrate: 0` and positive `setuptime` remains valid.

- [ ] **Step 2: Verify RED**

Run:

```text
node --test tests/planning-work-order-service.test.mjs
```

Expected: FAIL because the service still calls RESTlet 1762/17.

- [ ] **Step 3: Implement the minimal direct query**

Resolve the internal ID from the inspection work-order response, falling back to:

```sql
SELECT id, tranid
FROM transaction
WHERE type = 'WorkOrd' AND tranid = ?
```

Then query:

```sql
SELECT id, operationsequence, manufacturingworkcenter,
       BUILTIN.DF(manufacturingworkcenter) AS work_center,
       setuptime, runrate, title
FROM manufacturingoperationtask
WHERE workorder = ?
ORDER BY operationsequence, id
```

Normalize each row to the existing mapper contract:

```js
{
  "Orden de trabajo": folio,
  "Operacion": row.work_center || row.title,
  "Secuencia": row.operationsequence,
  "Centro de trabajo": row.manufacturingworkcenter,
  "Tiempo estimado (min)": Number(row.setuptime || 0)
    + Number(row.runrate || 0) * quantity
}
```

Use OAuth and `Prefer: transient` exactly as the existing SuiteQL catalog request does. Throw a concise error for HTTP failures or an empty route.

- [ ] **Step 4: Verify GREEN**

Run:

```text
node --test tests/planning-work-order-service.test.mjs
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```text
git add src/server/18-planning-work-order-service.js tests/planning-work-order-service.test.mjs
git commit -m "feat: load work order operations directly from NetSuite"
```

### Task 2: Populate operations when opening OT detail

**Files:**
- Modify: `src/web/planning/app.js`
- Test: `tests/performance-client-calls.test.mjs`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `ensureWorkOrderPlanningData(ot)`.
- Produces: `loadSelectedJobDetailOperations(ot)` and detail loading/error state.

- [ ] **Step 1: Write the failing tests**

Extract the detail-selection source and assert it:

```js
assert.match(source, /ensureWorkOrderPlanningData\(ot\)/);
assert.match(source, /renderSelectedJobPanel\(\)/);
```

Add an async fixture verifying two detail opens share one backend request and the second render contains merged operations. Add an error case proving existing operations remain unchanged.

- [ ] **Step 2: Verify RED**

Run:

```text
node --test tests/performance-client-calls.test.mjs tests/build.test.mjs
```

Expected: FAIL because opening the detail does not start the individual loader.

- [ ] **Step 3: Implement detail loading**

When an OT becomes selected for detail:

```js
renderSelectedJobPanel();
void loadSelectedJobDetailOperations(ot);
```

Implement:

```js
async function loadSelectedJobDetailOperations(ot) {
  const result = await ensureWorkOrderPlanningData(ot);
  if (materialOtKey(getSelectedPriorityJob()?.ot) !== materialOtKey(ot)) return;
  renderSelectedJobPanel();
  if (!result.ready) showToast(result.error || `No se cargaron operaciones de la OT ${ot}`, 9000);
}
```

While the request is pending and the selected OT lacks a valid route, render `Cargando operaciones...` in the operations section. Do not clear existing rows on error.

- [ ] **Step 4: Verify GREEN and regression suite**

Run:

```text
node --test tests/performance-client-calls.test.mjs tests/build.test.mjs
npm run test
npm run check
```

Expected: all tests and project validation pass.

- [ ] **Step 5: Commit**

```text
git add src/web/planning/app.js tests/performance-client-calls.test.mjs tests/build.test.mjs
git commit -m "feat: load operations when opening work order detail"
```
