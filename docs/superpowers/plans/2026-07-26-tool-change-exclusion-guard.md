# Mandatory Tool Change Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL` impossible to exclude and keep generated tool changes visible under corrupt legacy state.

**Architecture:** Apply the invariant at every trust boundary: client normalization, server normalization and planner filtering. Render the mandatory matrix row as fixed `Usar en el plan`, while preserving the existing removal guard.

**Tech Stack:** Browser JavaScript, Apps Script JavaScript, Node.js test runner.

## Global Constraints

- Do not change tool-change scheduling, duration or assignment rules.
- Keep `removeCapability` protection intact.
- Do not modify RESTlets or protected root Apps Script files.

---

### Task 1: Protect mandatory tool changes end to end

**Files:**
- Modify: `tests/matrix-integration-app.test.mjs`
- Modify: `tests/storage-state.test.mjs`
- Modify: `src/web/planning/app.js`
- Modify: `src/web/planning/planner-core.js`
- Modify: `src/server/02-storage.js`

**Interfaces:**
- Consumes: `TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL`, `normalizeCapabilityKeys(values)`, `PP_normalizeExcludedCapabilities_(values)`, `filterExcludedOperations(state, operations)`.
- Produces: normalized exclusion arrays without the mandatory key; a disabled UI state fixed to `USE`; generated `CAMBIO_HERRAMENTAL` operations preserved by filtering.

- [ ] **Step 1: Write failing functional tests**

Add assertions that:

```js
assert.deepEqual(normalizeCapabilityKeys([
  "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL",
  "5459::DOBLADO",
]), ["5459::DOBLADO"]);
assert.match(renderedMandatoryControl, /value="USE" selected[^>]*disabled/);
assert.ok(scheduled.operations.some((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL"));
assert.ok(PlannerCore.filterExcludedOperations(corruptState, scheduled.operations)
  .some((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL"));
assert.deepEqual(PP_normalizeExcludedCapabilities_([
  "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL",
  "5459::DOBLADO",
]), ["5459::DOBLADO"]);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
node --test tests/matrix-integration-app.test.mjs tests/storage-state.test.mjs
```

Expected: FAIL because the mandatory key remains normalized, the UI permits exclusion and the planner filter hides generated changes.

- [ ] **Step 3: Implement minimal invariant**

Use the existing constants to:

```js
function normalizeCapabilityKeys(values) {
  return uniq(/* existing normalization */)
    .filter((key) => key !== TOOL_CHANGE_CAPABILITY.key);
}
```

Server-side:

```js
if (key && key !== 'TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL' && normalized.indexOf(key) < 0) {
  normalized.push(key);
}
```

Planner-side:

```js
if (operation?.generatedBy === GENERATED_BY &&
    operation?.tipoInsercion === "CAMBIO_HERRAMENTAL") return false;
```

Render TOOL_CHANGE with a selected, disabled `USE` control and no `EXCLUDE` option; leave `removeCapability` unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test tests/matrix-integration-app.test.mjs tests/storage-state.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 5: Verify the complete project**

Run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check
git diff --check
```

Expected: exit code 0 for every command and no unexpected tracked files.

- [ ] **Step 6: Commit implementation**

Stage only the test and production files listed above and commit:

```powershell
git commit -m "fix: protect mandatory tool changes"
```
