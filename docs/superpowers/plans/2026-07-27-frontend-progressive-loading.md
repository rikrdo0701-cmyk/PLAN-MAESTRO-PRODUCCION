# Frontend Progressive Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir el trabajo inicial del navegador y las llamadas innecesarias sin limitar búsquedas ni datos de planeación.

**Architecture:** `app.js` conservará el conjunto completo de OT, pero renderizará el backlog en bloques de 30. `performance-client.js` coordinará estado condicional, llamadas compartidas y carga diferida de históricos usando los endpoints existentes.

**Tech Stack:** JavaScript, Google Apps Script bridge, IntersectionObserver, Node.js `node:test`, HTML/CSS.

## Global Constraints

- Orientado principalmente a PC.
- Máximo 30 tarjetas de backlog al finalizar la carga inicial.
- Búsqueda y filtros siempre operan sobre todas las OT.
- No cargar históricos antes de abrir Reportes o Restaurar borrador.
- No descargar el estado completo cuando la revisión local coincide.
- No modificar contratos de NetSuite, RESTlets ni Apps Scripts externos.
- Mantener Apps Script nativo y GitHub Pages.

---

### Task 1: Backlog progresivo

**Files:**
- Modify: `src/web/planning/index.template.html`
- Modify: `src/web/planning/styles.css`
- Modify: `src/web/planning/app.js`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Produces: `BACKLOG_PAGE_SIZE`, `resetBacklogWindow()`, `showMoreBacklogJobs()`.
- Produces DOM: `priorityLoadMore`, `priorityLoadMoreSentinel`.

- [ ] **Step 1: Write failing tests**

Agregar una prueba que extraiga `renderPriorityList()` y exija:

```js
assert.match(app, /const BACKLOG_PAGE_SIZE = 30/);
assert.match(renderPriorityList, /jobs\.slice\(0,\s*backlogVisibleLimit\)/);
assert.match(renderPriorityList, /\\$\{visibleJobs\.length\} de \\$\{jobs\.length\}/);
assert.match(template, /id="priorityLoadMore"/);
assert.match(template, /id="priorityLoadMoreSentinel"/);
```

Agregar pruebas de eventos que exijan reiniciar el límite cuando cambian `searchInput` o `statusFilter`, y aumentarlo exactamente en 30 al cargar más.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/build.test.mjs`

Expected: FAIL por constantes, controles y corte ausentes.

- [ ] **Step 3: Implement progressive rendering**

En `app.js`:

```js
const BACKLOG_PAGE_SIZE = 30;
let backlogVisibleLimit = BACKLOG_PAGE_SIZE;

function resetBacklogWindow() {
  backlogVisibleLimit = BACKLOG_PAGE_SIZE;
}

function showMoreBacklogJobs() {
  backlogVisibleLimit += BACKLOG_PAGE_SIZE;
  renderPriorityList();
}
```

Dentro de `renderPriorityList()`:

```js
const visibleJobs = jobs.slice(0, backlogVisibleLimit);
els.priorityCount.textContent = `${visibleJobs.length} de ${jobs.length} trabajos en espera`;
els.priorityLoadMore.hidden = visibleJobs.length >= jobs.length;
for (const job of visibleJobs) {
  // conservar el constructor existente de tarjetas
}
```

En el template, después de `priorityList`:

```html
<div id="priorityLoadMoreSentinel" class="backlog-load-more">
  <button id="priorityLoadMore" class="button small" type="button">Cargar más OT</button>
</div>
```

Crear un único `IntersectionObserver` que llame `showMoreBacklogJobs()` cuando el sentinel sea visible. El botón conserva el fallback y la accesibilidad.

- [ ] **Step 4: Preserve search and focus**

Antes de rerenderizar, capturar `document.activeElement?.dataset.dueOt`; después restaurar el foco únicamente si el campo sigue visible. En los eventos:

```js
els.searchInput.addEventListener("input", debounce(() => {
  resetBacklogWindow();
  renderPriorityList();
}, 120));
els.statusFilter.addEventListener("change", () => {
  resetBacklogWindow();
  renderPriorityList();
});
els.priorityLoadMore.addEventListener("click", showMoreBacklogJobs);
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test tests/build.test.mjs`

Expected: PASS.

```bash
git add src/web/planning/index.template.html src/web/planning/styles.css src/web/planning/app.js tests/build.test.mjs
git commit -m "perf: render backlog progressively"
```

### Task 2: Estado condicional y arranque ligero

**Files:**
- Modify: `src/web/shared/performance-client.js`
- Modify: `tests/performance-client-conflict.test.mjs`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `getAppStateIfChanged(clientRevision, {includeMaterials:false})`.
- Produces: `loadInitialStateConditionally()` → `{loaded:boolean, unchanged:boolean}`.

- [ ] **Step 1: Write failing VM tests**

Crear casos que simulen:

```js
bridgeResults.getAppStateIfChanged = { unchanged: true, revision: 12 };
state.revision = 12;
await context.loadAppStateInBackground();
assert.deepEqual(calls.map((call) => call.method), ["getAppStateIfChanged"]);
assert.equal(applyImportedCalls.length, 0);
```

Y otro caso con revisión `0` que exija `getAppState`, además de un caso cambiado que aplique el payload de `getAppStateIfChanged`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/performance-client-conflict.test.mjs`

Expected: FAIL porque el arranque siempre llama `getAppState`.

- [ ] **Step 3: Implement conditional state load**

En `performance-client.js`:

```js
async function loadInitialStateConditionally() {
  const revision = Number(state.revision || readMeta().revision || 0);
  const imported = revision > 0
    ? await callAppsScript("getAppStateIfChanged", revision, { includeMaterials: false })
    : await callAppsScript("getAppState");
  if (imported?.unchanged) {
    writeMeta({ revision: imported.revision || revision });
    return { loaded: false, unchanged: true };
  }
  applyImported(imported, { preserveLocalPlanning: false });
  return { loaded: true, unchanged: false };
}
```

Usarla desde `loadAppStateInBackground()` y conservar caché local si falla.

- [ ] **Step 4: Remove eager reports calls**

Eliminar `loadPlanSnapshots(false)` y `loadPlanSnapshotById(...)` del arranque optimizado. Establecer `snapshotsRequested = true` cuando Reportes o Restaurar borrador inicien la carga, para evitar una segunda consulta.

La carga inicial debe terminar con:

```js
state.selectedOperationId = "";
saveState("ui");
render({ saveScope: "ui" });
applyInitialWorkspaceView();
```

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/performance-client-conflict.test.mjs tests/build.test.mjs`

Expected: PASS.

```bash
git add src/web/shared/performance-client.js tests/performance-client-conflict.test.mjs tests/build.test.mjs
git commit -m "perf: avoid unchanged state and eager reports"
```

### Task 3: Llamadas compartidas y sincronización única

**Files:**
- Modify: `src/web/shared/performance-client.js`
- Modify: `src/web/planning/app.js`
- Create: `tests/performance-client-calls.test.mjs`

**Interfaces:**
- Produces: `singleFlight(key, factory)` → la misma `Promise` mientras la operación está activa.
- Produces: `loadSnapshotsOnce(showMessage)` y `syncWorkOrdersOnce(options)`.

- [ ] **Step 1: Write failing concurrency tests**

En VM, disparar dos solicitudes simultáneas:

```js
const first = context.syncNetSuiteInBackground({ showMessage: false });
const second = context.syncNetSuiteInBackground({ showMessage: true });
assert.equal(syncCalls, 1);
await Promise.all([first, second]);
```

Repetir para `loadPlanSnapshots(false)` desde dos entradas distintas y exigir una sola llamada a `listPlanSnapshots`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/performance-client-calls.test.mjs`

Expected: FAIL porque las llamadas simultáneas no comparten promesa.

- [ ] **Step 3: Implement single-flight registry**

En `performance-client.js`:

```js
const activeCalls = new Map();

function singleFlight(key, factory) {
  if (activeCalls.has(key)) return activeCalls.get(key);
  const request = Promise.resolve().then(factory).finally(() => activeCalls.delete(key));
  activeCalls.set(key, request);
  return request;
}
```

Usar claves `state`, `snapshots` y `sync-work-orders`. La sincronización manual debe recibir la misma promesa activa y mostrar su resultado, no iniciar otra.

- [ ] **Step 4: Keep report loading lazy**

El primer acceso a Reportes ejecuta:

```js
return singleFlight("snapshots", () => loadPlanSnapshots(showMessage));
```

Restaurar borrador reutiliza la misma función. Una vez terminada, accesos posteriores usan `planSnapshots` salvo que el usuario pulse actualizar.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/performance-client-calls.test.mjs tests/build.test.mjs`

Expected: PASS.

```bash
git add src/web/shared/performance-client.js src/web/planning/app.js tests/performance-client-calls.test.mjs
git commit -m "perf: share frontend data requests"
```

### Task 4: Integración y QA de rendimiento

**Files:**
- Modify if required: `tests/build.test.mjs`
- Verify: all changed files

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: evidencia de regresión y medición en PC.

- [ ] **Step 1: Run complete verification**

Run:

```bash
npm.cmd test
npm.cmd run build
npm.cmd run check
git diff --check
```

Expected: todos exit code `0`.

- [ ] **Step 2: Browser QA**

Abrir GitHub Pages o el build local a viewport de PC y comprobar:

```text
app loads
→ backlog muestra máximo 30 tarjetas
→ contador muestra 30 de M
→ buscar una OT fuera del primer bloque la encuentra
→ bajar al final o pulsar Cargar más muestra hasta 60
→ abrir Reportes realiza la primera carga de históricos
```

Registrar:

- número de `.priority-card`;
- número total de nodos;
- errores/warnings de consola;
- estado visible después de buscar y cargar más.

- [ ] **Step 3: Review scope**

Run:

```bash
git status --short
git log --oneline --max-count=5
```

Expected: solo archivos previstos y artefactos locales preexistentes.

- [ ] **Step 4: Commit integration fixes only if needed**

```bash
git add tests/build.test.mjs
git commit -m "test: verify progressive frontend loading"
```
