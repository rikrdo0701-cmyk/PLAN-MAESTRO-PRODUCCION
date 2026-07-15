# Plan Evolution and Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incorporar reprogramación incremental, versiones semanales, cargas históricas, reportes finales y Hoja de inspección modular sin romper el motor vigente.

**Architecture:** Mantener reglas puras en `planning-workflow-core.js`, programación en `planner-core.js` y orquestación en `app.js`. Hoja de inspección tendrá vista, estilos, cliente y servidor propios; `nesesidades prod` será solo referencia y nunca se versionará.

**Tech Stack:** JavaScript ES2022, Node test runner, Google Apps Script V8, HTML/CSS, GitHub Pages y NetSuite RESTlet.

## Global Constraints

- Cada plan inicia el lunes de su semana.
- Base incremental: último publicado de esa semana; si no existe, borrador.
- Completadas no consumen capacidad ni fijan la fecha antigua de sucesoras.
- Una OT iniciada permanece en el plan, pero sus pendientes pueden moverse.
- Publicaciones semanales son V1, V2, V3 y nunca se sobrescriben.
- El resumen muestra solo OTs agregadas/eliminadas y cambios de cantidad, prioridad, entrega, máquina, herramental/kit, subcontrato y motivo.
- PDF solo imprime la fuente elegida; no genera, guarda ni publica.
- Fechas visibles `DD/MM/AAAA`; horas visibles `hh:mm AM/PM`.
- Reportes diarios: A4 horizontal, máximo 25 filas y área completa.
- Hoja de inspección muestra todas las OTs abiertas y todas las operaciones devueltas por NetSuite para la OT.
- Ninguna credencial o artefacto de `nesesidades prod` entra a Git.

## File Map

- Modify `src/web/planning/planning-workflow-core.js`: semana, incremental, versiones, diferencias y cargas.
- Modify `src/web/planning/planner-core.js`: predecesoras completadas y reservas incrementales.
- Modify `src/web/planning/app.js`: orquestación, selectores, publicación, PDF y refresco.
- Modify `src/web/planning/index.template.html`, `src/web/planning/styles.css`.
- Create `src/web/inspection/inspection-view.html`, `inspection-styles.css`, `inspection-client.js`.
- Create `src/server/16-inspection-service.js`.
- Modify `scripts/build-appscript.mjs` and existing tests; create `tests/inspection-core.test.mjs`.

---

### Task 1: Weekly incremental contract

**Files:** Modify `src/web/planning/planning-workflow-core.js`; test `tests/planning-workflow-core.test.mjs`.

**Interfaces:** Produce `mondayIso(value)`, `selectIncrementalBase(snapshots, weekStart, draft)` and `incrementalScope({base,current,weekStart})`.

- [ ] Write failing tests:

```js
assert.equal(core.mondayIso("2026-07-23"), "2026-07-20");
assert.equal(core.selectIncrementalBase(published, "2026-07-20", draft).snapshotId, "pub-v2");
assert.equal(core.selectIncrementalBase([], "2026-07-20", draft).snapshotId, "draft");
assert.deepEqual(core.incrementalScope(input).removedOts, ["1325"]);
```

- [ ] Run `node --test tests/planning-workflow-core.test.mjs`; expect FAIL for missing APIs.
- [ ] Implement pure helpers with normalized OT keys and signatures covering quantity, priority, due date, machine, tool, kit and subcontract.
- [ ] Rerun the test; expect PASS.
- [ ] Commit only helper and test files: `git commit -m "Agregar contrato de reprogramacion incremental"`.

### Task 2: Incremental scheduler execution

**Files:** Modify `src/web/planning/planner-core.js`, `src/web/planning/app.js`; test `tests/planner-core.test.mjs`.

**Interfaces:** Consume Task 1; extend scheduling options with `{baseSnapshot, weekStart, affectedOts}`.

- [ ] Write failing cases proving: completed Sec.1 releases capacity; Sec.2 may start Monday; pending predecessor still constrains; initiated OT remains; unaffected OT keeps dates; removed/closed OT reserves nothing.

```js
assert.equal(find(result,"sec2").fechaInicio, "2026-07-20");
assert.equal(result.selectedOts.includes("started-ot"), true);
assert.deepEqual(times(result,"unchanged-ot"), times(before,"unchanged-ot"));
```

- [ ] Run `node --test tests/planner-core.test.mjs`; expect the new cases to fail.
- [ ] Keep completed history, clear only affected pending dates on/after Monday, retain initiated OTs, exclude removed/closed OTs, then schedule against fixed reservations.
- [ ] On success replace the single draft snapshot and call the existing render path once; never call PDF.
- [ ] Run targeted planner/workflow tests; expect PASS.
- [ ] Commit: `git commit -m "Implementar reprogramacion incremental semanal"`.

### Task 3: Weekly versions and compact differences

**Files:** Modify `planning-workflow-core.js`, `app.js`, `src/server/05-publishing-service.js`; test workflow/build suites.

**Interfaces:** Produce `nextWeeklyVersion`, `compactVersionDiff`; persist `weekStart`, `version`, `publicationReason`, `changeSummary`.

- [ ] Write failing tests:

```js
assert.equal(core.nextWeeklyVersion(v1,"2026-07-20"), 2);
assert.deepEqual(Object.keys(core.compactVersionDiff(a,b)).sort(), ["addedOts","changedOts","removedOts"]);
assert.doesNotMatch(JSON.stringify(core.compactVersionDiff(a,b)), /operator|load|completed/);
```

- [ ] Implement helpers and require a short reason only when a prior version exists for that Monday.
- [ ] Save each publication as a new immutable snapshot; keep only `draft` replaceable.
- [ ] Label options `Semana 20/07/2026 — V2`; PDF prints stored reason/summary only for V2+.
- [ ] Run workflow/build tests; expect PASS.
- [ ] Commit: `git commit -m "Versionar publicaciones semanales"`.

### Task 4: Historical load sources

**Files:** Modify workflow core, `index.template.html`, `app.js`; test workflow/build suites.

**Interfaces:** Produce `loadOperationsForMode(snapshot, statusOverlay, mode)` for `pending|completed|original`.

- [ ] Write failing tests: pending excludes completed, completed includes only completed, original ignores current overlay and preserves published dates.
- [ ] Add source selector (`draft` plus all published versions) and mode selector.
- [ ] Reuse existing operator/machine/CT/adjuster aggregations; do not duplicate calculators.
- [ ] Run targeted tests; expect PASS.
- [ ] Commit: `git commit -m "Agregar cargas historicas por version"`.

### Task 5: Report time and A4 layout

**Files:** Modify `app.js`, `styles.css`; test `tests/build.test.mjs`.

**Interfaces:** Produce `formatReportTime(date) -> hh:mm AM|PM`; retain internal `formatTime`.

- [ ] Add failing assertions:

```js
assert.match(pagesIndex, /function formatReportTime\(date\)/);
assert.match(pagesIndex, /@page\s*\{\s*size:\s*A4 landscape/);
assert.match(pagesIndex, /printing-individual-plan[\s\S]*report-status-action-column[\s\S]*display:\s*none/);
```

- [ ] Replace report-only time rendering; do not change Gantt or persisted time values.
- [ ] Set print tables to full width/fixed layout and size 25 rows to the printable height; short reports remain legible without forced stretching.
- [ ] Test that PDF path contains no generate/save/publish call.
- [ ] Run build test; expect PASS. Commit: `git commit -m "Finalizar formato de reportes impresos"`.

### Task 6: Inspection server module

**Files:** Create `src/server/16-inspection-service.js`; modify `src/server/14-pages-bridge.js`; test `tests/build.test.mjs`; reference only `nesesidades prod/CODE.GS.txt`.

**Interfaces:** Public functions `getInspectionWorkOrders`, `getInspectionWorkOrder`, `saveInspectionLink`, `getInspectionHistory`, `recordInspectionPrint`, `getInspectionDrawingRoutes`.

- [ ] Add failing build assertions for all six functions and absence of secret filenames/content.
- [ ] Extract only inspection behavior; prefix private helpers `PP_Inspection_`, reuse current NetSuite authentication, obtain spreadsheet/config IDs from Script Properties.
- [ ] Return stable `{ok:true,data}` / `{ok:false,error}` envelopes and validate WO/payload values.
- [ ] Run `npm run build` and build test; inspect `dist` for the six functions and no secrets.
- [ ] Commit: `git commit -m "Agregar servicio modular de inspeccion"`.

### Task 7: Inspection view, client and selectable operations

**Files:** Create three `src/web/inspection/*` files and `tests/inspection-core.test.mjs`; modify planning HTML/app and build script; reference only `nesesidades prod/index.html`.

**Interfaces:** Produce `window.InspectionApp`, `initialOperationSelection(ops)` and `printableOperations(ops, selection)`.

- [ ] Write failing tests:

```js
assert.deepEqual(initialOperationSelection(ops), {a:true,b:true,c:true});
assert.deepEqual(printableOperations(ops,{a:true,b:false,c:true}).map(x=>x.id), ["a","c"]);
```

- [ ] Extract scoped markup/styles; rename every visible `Hoja Inspec` to `Hoja de inspección`.
- [ ] Implement list of all open WOs, search, all NetSuite operations, materials, semaphore, links, drawings and history.
- [ ] Reset all operation checkboxes on every load/reload of an OT; never persist selection.
- [ ] Print from the filtered model: controls hidden, selected operations compacted upward, required blanks appended only at the end, included codes recorded in history, UI restored afterward.
- [ ] Include new modules in build, run inspection/build tests; expect PASS.
- [ ] Commit: `git commit -m "Integrar hoja de inspeccion modular"`.

### Task 8: Consolidated security and QA

**Files:** Modify only files needed by failures discovered here.

- [ ] Run once: `npm test`, `npm run check`, `git diff --check`; expect all green.
- [ ] Run `git ls-files | rg "nesesidades prod|credenciales|netsuiteauth|response\.json"`; expect no output.
- [ ] Single browser QA pass: Gantt views, incremental generation, versions, historical loads, 12-hour reports, A4 print, inspection search/selection/print reset and console.
- [ ] Apps Script QA: real WO list/detail, all operations, tramo/drawing save, history, isolated NetSuite error and inspection print.
- [ ] Fix only evidenced defects, rerun their targeted test, then full verification once.
- [ ] Commit QA fixes if any and push `main` only after clean evidence.

## Token-Efficient Execution Rules

1. Execute tasks in order; preserve working context between tasks.
2. Read only current-task files and exact function ranges.
3. Use targeted tests in Tasks 1–7; full suite only in Task 8.
4. Build at most once per task; one consolidated browser QA in Task 8.
5. Reuse fixtures, calculators and pure helpers; avoid duplicating logic in `app.js`.
6. Treat `nesesidades prod` as reference-only and never inspect credential contents.
7. On failure, fix the smallest cause and rerun only that test before continuing.
