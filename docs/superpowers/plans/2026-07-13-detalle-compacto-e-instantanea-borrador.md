# Detalle compacto e instantánea única del borrador Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compactar el detalle de OT, estabilizar el traslado y preparación de tarjetas, reemplazar una instantánea única del borrador al generar y usar último publicado o borrador en reportes.

**Architecture:** Concentrar las decisiones puras de transición, firma y selección de fuente en `planning-workflow-core.js`; mantener `app.js` como orquestador de UI y persistencia. La instantánea `draft` tendrá escritura de reemplazo en el backend, separada de los snapshots publicados e históricos.

**Tech Stack:** JavaScript ES2022, Google Apps Script, HTML/CSS, Node.js `node:test`, GitHub Pages.

## Global Constraints

- PLANDATA es la autoridad; localStorage es respaldo temporal.
- Solo existe una instantánea lógica `draft` y cada generación correcta la reemplaza.
- Los planes PUBLICADOS e históricos no se eliminan ni se mezclan con Borrador.
- No agregar dependencias.
- Todo cambio de comportamiento se desarrolla con prueba fallida primero.

---

### Task 1: Transición atómica de tarjeta preparada

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js:1769-1850`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `commitPreparedOtSelection(state, ot, signature)` devuelve estado con OT seleccionada y firma guardada.
- Consumes: `markPlanningPrepared`, `isOtEligibleForDraft`.

- [ ] **Step 1: Write the failing transition test**

```js
test("confirmar preparación selecciona la OT y conserva su firma en una transición", () => {
  const next = core.commitPreparedOtSelection({ selectedOts: [], preparedPlanningByOt: {} }, "1095", "machine=39");
  assert.deepEqual(structuredClone(next.selectedOts), ["1095"]);
  assert.equal(next.preparedPlanningByOt[1095], "machine=39");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/planning-workflow-core.test.mjs`
Expected: FAIL porque `commitPreparedOtSelection` no existe.

- [ ] **Step 3: Implement the pure transition**

```js
function commitPreparedOtSelection(state, ot, signature) {
  const selectedOts = [...(state?.selectedOts || [])];
  if (!selectedOts.some((item) => normalize(item) === normalize(ot))) selectedOts.push(String(ot));
  return markPlanningPrepared({ ...(state || {}), selectedOts }, String(ot), signature);
}
```

Exportar la función en el objeto público.

- [ ] **Step 4: Reorder `selectJob` commit semantics**

En `selectJob`, mantener la OT fuera de `selectedOts` mientras el modal está abierto. Después de confirmar y aplicar configuración:

```js
const signature = planningPreparationSignature(job.ot);
Object.assign(state, window.PlanningWorkflowCore.commitPreparedOtSelection(state, job.ot, signature));
saveAndRender("OT agregada al plan", "plan");
```

Si se cancela, restaurar el checkpoint y no cambiar columna. Si falla el guardado remoto, restaurar `selectedOts`, prioridad, configuración y firma desde `_pendingAddOtSnapshot`.

- [ ] **Step 5: Verify GREEN and regressions**

Run: `npm.cmd test`
Expected: todas las pruebas PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/planning/planning-workflow-core.js src/web/planning/app.js tests/planning-workflow-core.test.mjs
git commit -m "Estabilizar traslado de OTs preparadas"
```

### Task 2: Firma de preparación idempotente

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js:1810-1900`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Produces: `planningPreparationSignature(input)` devuelve string canónico.
- Consumes: configuración de OT, operaciones productivas y asignaciones de recursos.

- [ ] **Step 1: Write failing canonical-signature tests**

```js
test("la firma preparada es estable y cambia solamente con configuración relevante", () => {
  const a = core.planningPreparationSignature({ ot: "1095", machine: "39", tool: "H1", kit: "", kitPending: true, operationVersion: "7|5459" });
  const b = core.planningPreparationSignature({ operationVersion: "7|5459", kitPending: true, kit: "", tool: "H1", machine: "39", ot: "1095" });
  const changed = core.planningPreparationSignature({ ot: "1095", machine: "40", tool: "H1", kit: "", kitPending: true, operationVersion: "7|5459" });
  assert.equal(a, b);
  assert.notEqual(a, changed);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/planning-workflow-core.test.mjs`
Expected: FAIL porque la función no existe.

- [ ] **Step 3: Implement canonical serialization**

```js
function planningPreparationSignature(input) {
  const value = input || {};
  return JSON.stringify({
    ot: normalize(value.ot), machine: normalize(value.machine), tool: normalize(value.tool),
    kit: normalize(value.kit), kitPending: value.kitPending === true,
    subcontractType: normalize(value.subcontractType), subcontractDays: Number(value.subcontractDays || 0),
    commercialType: normalize(value.commercialType), operationVersion: String(value.operationVersion || ""),
  });
}
```

- [ ] **Step 4: Use the same signature at preparation and generation**

Construir la entrada desde la configuración ya normalizada de la OT. Eliminar firmas calculadas antes de aplicar máquina/herramental. `ensureOtPlanningPrepared` debe retornar sin modal cuando `needsPlanningPreparation` sea falso.

- [ ] **Step 5: Verify**

Run: `npm.cmd test`
Expected: PASS y prueba existente de preparación idempotente verde.

- [ ] **Step 6: Commit**

```bash
git add src/web/planning/planning-workflow-core.js src/web/planning/app.js tests/planning-workflow-core.test.mjs
git commit -m "Hacer idempotente la preparacion del plan"
```

### Task 3: Instantánea única `draft`

**Files:**
- Modify: `src/server/05-publishing-service.js`
- Modify: `src/server/02-storage.js`
- Modify: `src/web/planning/app.js:3340-3475`
- Modify: `src/web/planning/planning-workflow-core.js`
- Test: `tests/planning-workflow-core.test.mjs`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Produces backend: `saveDraftSnapshot(payload)` reemplaza las filas con `SNAPSHOT_ID=draft`.
- Produces frontend: `buildDraftSnapshot(state, generatedAt)`.

- [ ] **Step 1: Write failing snapshot projection test**

```js
test("la instantánea draft contiene solo selección pendiente programada", () => {
  const snapshot = core.buildDraftSnapshot({ selectedOts: ["100"], operations: [
    { id: "ok", ot: "100", fechaInicio: "2026-07-13", fechaFin: "2026-07-13", planStatus: "PENDIENTE" },
    { id: "done", ot: "100", fechaInicio: "2026-07-13", fechaFin: "2026-07-13", planStatus: "COMPLETADA_PLAN" },
    { id: "backlog", ot: "200", fechaInicio: "2026-07-13", fechaFin: "2026-07-13" },
  ] }, "2026-07-13T07:00:00Z");
  assert.equal(snapshot.snapshotId, "draft");
  assert.deepEqual(structuredClone(snapshot.operations.map((op) => op.id)), ["ok"]);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/planning-workflow-core.test.mjs`
Expected: FAIL porque `buildDraftSnapshot` no existe.

- [ ] **Step 3: Implement the projection**

```js
function buildDraftSnapshot(state, generatedAt) {
  return {
    snapshotId: "draft", status: "BORRADOR", generatedAt: String(generatedAt || ""),
    planStart: state?.planStart || "", selectedOts: [...(state?.selectedOts || [])],
    operations: draftExportOperations(state).map((op) => ({ ...op })),
  };
}
```

- [ ] **Step 4: Implement backend replacement**

`saveDraftSnapshot(payload)` debe adquirir lock, leer `PLANES_HISTORICOS`, retirar exclusivamente filas cuyo snapshot sea `draft`, agregar las filas del payload y escribir la tabla completa. No modificar IDs publicados.

- [ ] **Step 5: Persist only after successful scheduling**

Al final de `scheduleCurrentPlan`, después de obtener programación válida:

```js
const draft = window.PlanningWorkflowCore.buildDraftSnapshot(state, new Date().toISOString());
await callAppsScript("saveDraftSnapshot", draft);
reportSnapshot = draft;
```

Si falla el motor o la persistencia, conservar la instantánea anterior y mostrar error.

- [ ] **Step 6: Add build assertions and verify**

Agregar en `tests/build.test.mjs` verificaciones para `saveDraftSnapshot`, `snapshotId: "draft"` y la llamada posterior a programación.

Run: `npm.cmd test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/05-publishing-service.js src/server/02-storage.js src/web/planning/app.js src/web/planning/planning-workflow-core.js tests/planning-workflow-core.test.mjs tests/build.test.mjs
git commit -m "Reemplazar instantanea unica del borrador"
```

### Task 4: Fuente operativa de reportes

**Files:**
- Modify: `src/web/planning/planning-workflow-core.js`
- Modify: `src/web/planning/app.js:3880-4400`
- Test: `tests/planning-workflow-core.test.mjs`

**Interfaces:**
- Consumes: `defaultDailyPlanSource(snapshots, draft)`.
- Produces: una única `reportSnapshot` antes de aplicar filtros.

- [ ] **Step 1: Extend the failing source-selection test**

```js
test("reportes ignoran guardados y eligen publicado más reciente o draft", () => {
  const source = core.defaultDailyPlanSource([
    { snapshotId: "saved", status: "GUARDADO", generatedAt: "2026-07-13T12:00:00Z" },
    { snapshotId: "old", status: "PUBLICADO", publishedAt: "2026-07-13T10:00:00Z" },
    { snapshotId: "new", status: "PUBLICADO", publishedAt: "2026-07-13T11:00:00Z" },
  ], { snapshotId: "draft" });
  assert.deepEqual(structuredClone(source), { type: "published", snapshotId: "new" });
});
```

- [ ] **Step 2: Verify test behavior and fix only if RED**

Run: `node --test tests/planning-workflow-core.test.mjs`
Expected: PASS si el selector existente ya cumple; en ese caso esta prueba documenta la regresión. Si falla, ordenar exclusivamente PUBLICADOS por `publishedAt || generatedAt` descendente.

- [ ] **Step 3: Make all three reports consume the same selected snapshot**

En `loadPlanSnapshots`, cargar el último publicado; si no existe, cargar `draft`. `renderOperatorReport`, `renderAdjusterReport` y `renderSubcontractReport` deben consumir `reportOperationsSource()` sin fallback independiente.

- [ ] **Step 4: Verify**

Run: `npm.cmd test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/planning/planning-workflow-core.js src/web/planning/app.js tests/planning-workflow-core.test.mjs
git commit -m "Unificar fuente de reportes operativos"
```

### Task 5: Detalle compacto orientado a operaciones

**Files:**
- Modify: `src/web/planning/app.js:2247-2435`
- Modify: `src/web/planning/styles.css:486-520,1115-1165,1790-1805`
- Test: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `planStatusActionCell`, controles actuales de máquina, kit, herramental, subcontrato y materiales.
- Produces: `.job-detail-operations-scroll` como región de desplazamiento principal.

- [ ] **Step 1: Write failing structural assertions**

En `tests/build.test.mjs`:

```js
assert.match(pagesIndex, /class="job-detail-operations-scroll"/);
assert.match(pagesIndex, /<details class="job-resource-section/);
assert.doesNotMatch(pagesIndex, /class="job-photo/);
assert.doesNotMatch(pagesIndex, />Inicio NetSuite</);
assert.doesNotMatch(pagesIndex, />Fin NetSuite</);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/build.test.mjs`
Expected: FAIL por estructura antigua.

- [ ] **Step 3: Replace detail header and summary**

Renderizar cabecera con OT, artículo, prioridad y bloqueo. Renderizar una franja `.job-detail-quick-facts` con Cantidad y Fecha de entrega. No renderizar foto, estado ni fechas NetSuite.

- [ ] **Step 4: Make resource sections collapsible**

Envolver máquina, kit, herramental, subcontrato y materiales en `<details class="job-resource-section">`. El `<summary>` debe incluir etiqueta y valor actual. Mantener IDs de inputs para no romper listeners.

- [ ] **Step 5: Give operations remaining height**

```css
.job-detail { height: 100%; display: flex; flex-direction: column; min-height: 0; }
.job-detail-head { min-height: 44px; padding: 7px 10px; }
.job-detail-quick-facts { display: grid; grid-template-columns: 1fr 1.4fr; }
.job-resource-section > summary { min-height: 34px; padding: 6px 10px; }
.job-detail-operations-scroll { flex: 1; min-height: 220px; overflow: auto; }
.job-detail-operations-scroll thead { position: sticky; top: 0; z-index: 2; }
```

Para ancho pequeño, ocultar encabezado CT y mostrar CT dentro de la celda de operación como texto secundario.

- [ ] **Step 6: Verify build**

Run: `npm.cmd test && npm.cmd run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/planning/app.js src/web/planning/styles.css tests/build.test.mjs
git commit -m "Compactar detalle de orden de trabajo"
```

### Task 6: QA integral, publicación y comprobación remota

**Files:**
- Verify only: repository and deployed GitHub Pages

**Interfaces:**
- Consumes: all prior tasks.
- Produces: evidence that the complete workflow works without console errors.

- [ ] **Step 1: Run clean verification**

Run: `npm.cmd test && npm.cmd run build && git diff --check`
Expected: all tests PASS, build success, no whitespace errors.

- [ ] **Step 2: Browser flow — card and idempotence**

Open local Pages build. Test:

1. OT starts in Backlog.
2. Add opens preparation.
3. Cancel leaves it in Backlog.
4. Add, configure and confirm moves it to Planeado.
5. Generate plan does not reopen the preparation modal.
6. Reload preserves the selection from PLANDATA.

Expected: no missing card and no relevant console warnings/errors.

- [ ] **Step 3: Browser flow — detail and reports**

Verify detail at the user's narrow panel width and desktop: operations visible with scroll and Completar/Reabrir reachable. Verify Operador, Ajustador and Subcontratos show the same latest PUBLICADO; remove published fixture or use isolated test data to verify fallback to Borrador.

- [ ] **Step 4: Publish**

```bash
git push origin main
```

- [ ] **Step 5: Verify deployed artifact**

Confirm public HTML contains `job-detail-operations-scroll`, `buildDraftSnapshot` and `commitPreparedOtSelection`. Reload with cache-busting query and repeat the card transition smoke test.

