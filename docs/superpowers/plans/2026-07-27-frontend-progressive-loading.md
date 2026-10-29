# Frontend Progressive Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir el trabajo inicial del navegador y las llamadas innecesarias sin limitar búsquedas ni datos de planeación.

**Architecture:** Primero se memorizará el filtrado introducido por la matriz y se reutilizará el catálogo SuiteQL durante una hora. Después `app.js` renderizará el backlog en bloques de 30 y `performance-client.js` coordinará estado condicional, llamadas compartidas e históricos diferidos.

**Tech Stack:** JavaScript, Google Apps Script bridge, IntersectionObserver, Node.js `node:test`, HTML/CSS.

## Global Constraints

- Orientado principalmente a PC.
- Máximo 30 tarjetas de backlog al finalizar la carga inicial.
- Búsqueda y filtros siempre operan sobre todas las OT.
- No cargar históricos antes de abrir Reportes o Restaurar borrador.
- No descargar el estado completo cuando la revisión local coincide.
- No modificar contratos de NetSuite, RESTlets ni Apps Scripts externos.
- Mantener Apps Script nativo y GitHub Pages.
- Una renderización completa reutiliza la misma colección de operaciones incluidas.
- Máximo una consulta del catálogo SuiteQL por hora, cuenta y ubicación.

---

### Task 1: Memorizar operaciones incluidas

**Files:**
- Modify: `src/web/planning/planner-core.js`
- Modify: `src/web/planning/app.js`
- Modify: `tests/planner-core.test.mjs`
- Modify: `tests/matrix-integration-app.test.mjs`

**Interfaces:**
- Produces: `excludedCapabilityKeySet(state)` → `Set<string>`.
- Produces: `filterExcludedOperations(state, operations, excludedSet?)`.
- Produces: `invalidateCurrentPlanOperationsCache()`.

- [ ] **Step 1: Write failing tests**

Instrumentar `PlannerCore.filterExcludedOperations` y exigir que múltiples consumidores del mismo render compartan un resultado:

```js
const first = currentPlanOperations();
const second = currentPlanOperations();
assert.equal(first, second);
assert.equal(filterCalls, 1);
```

Agregar casos que cambien `state.operations` y `state.excludedCapabilities`, llamen `invalidateCurrentPlanOperationsCache()` y exijan una colección nueva.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/planner-core.test.mjs tests/matrix-integration-app.test.mjs`

Expected: FAIL porque cada acceso filtra nuevamente y no existe invalidación explícita.

- [ ] **Step 3: Precompute exclusion keys**

En `planner-core.js`:

```js
function excludedCapabilityKeySet(state) {
  return new Set((state?.excludedCapabilities || []).map(normalizedCapabilityKey).filter(Boolean));
}

function filterExcludedOperations(state, operations, excludedSet = excludedCapabilityKeySet(state)) {
  return (Array.isArray(operations) ? operations : []).filter((operation) => {
    if (normalizeKey(operation?.tipoInsercion) === "CAMBIO_HERRAMENTAL") return true;
    return !excludedSet.has(normalizedCapabilityKey(capabilityForOperation(operation || {})));
  });
}
```

- [ ] **Step 4: Memoize the primary collection**

En `app.js`:

```js
let currentPlanOperationsCache = null;

function invalidateCurrentPlanOperationsCache() {
  currentPlanOperationsCache = null;
}

function currentPlanOperations(operations = state.operations) {
  if (operations !== state.operations) {
    return window.PlannerCore.filterExcludedOperations(state, operations);
  }
  const excludedSignature = normalizeCapabilityKeys(state.excludedCapabilities).join("|");
  if (!currentPlanOperationsCache
      || currentPlanOperationsCache.operations !== operations
      || currentPlanOperationsCache.excludedSignature !== excludedSignature) {
    currentPlanOperationsCache = {
      operations,
      excludedSignature,
      result: window.PlannerCore.filterExcludedOperations(state, operations),
    };
  }
  return currentPlanOperationsCache.result;
}
```

Invalidar después de importar, sincronizar, programar, normalizar y alternar exclusiones.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/planner-core.test.mjs tests/matrix-integration-app.test.mjs`

Expected: PASS.

```bash
git add src/web/planning/planner-core.js src/web/planning/app.js tests/planner-core.test.mjs tests/matrix-integration-app.test.mjs
git commit -m "perf: cache included planning operations"
```

### Task 2: Reutilizar catálogo maestro SuiteQL

**Files:**
- Modify: `src/server/08-netsuite.js`
- Modify: `tests/netsuite-operation-catalog.test.mjs`

**Interfaces:**
- Produces: `PP_fetchNetSuiteOperationCatalogCached_(config)` → `{items, warning}`.
- Cache key: cuenta + ubicación; TTL exacto `3600` segundos.

- [ ] **Step 1: Write failing cache tests**

Simular `CacheService.getScriptCache()` y ejecutar dos veces:

```js
const first = PP_fetchNetSuiteOperationCatalogCached_(config);
const second = PP_fetchNetSuiteOperationCatalogCached_(config);
assert.equal(urlFetchCalls, 1);
assert.deepEqual(second.items, first.items);
assert.equal(cachePutTtl, 3600);
```

Agregar JSON corrupto en caché y exigir consulta real; agregar error HTTP y exigir fallback anterior. Simular errores de `cache.get` y `cache.put` y exigir que el catálogo válido siga regresando sin bloquear la sincronización.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/netsuite-operation-catalog.test.mjs`

Expected: FAIL porque todas las sincronizaciones consultan SuiteQL.

- [ ] **Step 3: Implement one-hour cache**

En `08-netsuite.js`:

```js
function PP_fetchNetSuiteOperationCatalogCached_(config) {
  const cache = CacheService.getScriptCache();
  const key = "NS_OPERATION_CATALOG_V1_" + PP_normalizeKey_(config.accountId + "_" + config.locationId);
  let cached = "";
  try { cached = cache.get(key); } catch (_) {}
  if (cached) {
    try {
      const items = JSON.parse(cached);
      if (Array.isArray(items) && items.length) return { items: items, warning: "" };
    } catch (_) {}
  }
  const result = PP_fetchNetSuiteOperationCatalog_(config);
  if (result.items.length) {
    try { cache.put(key, JSON.stringify(result.items), 3600); } catch (_) {}
  }
  return result;
}
```

Usar el wrapper en sincronización completa y de planeación. Mantener `PP_resolveOperationCatalog_` como fallback no destructivo.

- [ ] **Step 4: Verify and commit**

Run: `node --test tests/netsuite-operation-catalog.test.mjs`

Expected: PASS.

```bash
git add src/server/08-netsuite.js tests/netsuite-operation-catalog.test.mjs
git commit -m "perf: cache NetSuite operation catalog"
```

### Task 3: Backlog progresivo

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

### Task 4: Estado condicional y arranque ligero

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

### Task 5: Llamadas compartidas y sincronización única

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

### Task 6: Integración y QA de rendimiento

**Files:**
- Modify if required: `tests/build.test.mjs`
- Verify: all changed files

**Interfaces:**
- Consumes: Tasks 1–5.
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
