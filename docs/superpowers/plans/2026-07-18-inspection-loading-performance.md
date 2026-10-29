# Inspection Loading Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargar detalle, rutas e historial de una WO con una sola llamada y anticipar las 5 WO más recientes.

**Architecture:** El servidor expondrá un paquete cacheado durante 300 segundos. El cliente administrará caché temporal, promesas compartidas y una cola de precarga con concurrencia 2; un token de selección impedirá renderizados obsoletos.

**Tech Stack:** Google Apps Script, JavaScript de navegador, Node.js `node:test`.

## Global Constraints

- Caché de navegador y Apps Script: 5 minutos.
- Precargar exactamente las primeras 5 WO con máximo 2 solicitudes simultáneas.
- **Recargar** omite ambas cachés.
- No modificar el Apps Script protegido `1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx`.
- No guardar respuestas fallidas ni mostrar errores de precarga.

---

### Task 1: Paquete consolidado y caché del servidor

**Files:**
- Modify: `src/server/17-inspection-drawing-service.js`
- Modify: `tests/inspection-service.test.mjs`

**Interfaces:**
- Consumes: `getInspectionWorkOrder(wo)` y `getInspectionHistory(wo)`.
- Produces: `getInspectionWorkOrderBundle(wo, options)` → `{ok,data:{detail,history}}`.

- [ ] **Step 1: Escribir pruebas fallidas**

Agregar un `CacheService` falso a `loadService` y probar:

```js
test("agrupa detalle e historial y reutiliza cache por cinco minutos", () => {
  const entries = new Map();
  const puts = [];
  const context = loadBundledService({
    CacheService: { getScriptCache: () => ({
      get: (key) => entries.get(key) || null,
      put: (key, value, seconds) => { entries.set(key, value); puts.push([key, seconds]); }
    })}
  });
  let detailCalls = 0;
  let historyCalls = 0;
  context.getInspectionWorkOrder = () => ({ ok: true, data: { workOrder: { wo: "2001" } } });
  context.getInspectionHistory = () => ({ ok: true, data: { count: ++historyCalls } });
  const originalDetail = context.getInspectionWorkOrder;
  context.getInspectionWorkOrder = (...args) => { detailCalls += 1; return originalDetail(...args); };

  assert.equal(context.getInspectionWorkOrderBundle("2001").ok, true);
  assert.equal(context.getInspectionWorkOrderBundle("2001").ok, true);
  assert.equal(detailCalls, 1);
  assert.equal(historyCalls, 1);
  assert.deepEqual(puts, [["PP_INSPECTION_WO_BUNDLE_2001", 300]]);
});

test("forceRefresh omite y reemplaza cache", () => {
  let calls = 0;
  const context = loadBundledService({
    CacheService: { getScriptCache: () => ({ get: () => JSON.stringify({ detail: { stale: true }, history: {} }), put: () => {} }) }
  });
  context.getInspectionWorkOrder = () => ({ ok: true, data: { sequence: ++calls } });
  context.getInspectionHistory = () => ({ ok: true, data: {} });
  const result = context.getInspectionWorkOrderBundle("2001", { forceRefresh: true });
  assert.equal(result.data.detail.sequence, 1);
});
```

- [ ] **Step 2: Confirmar que fallan**

Run: `node --test tests/inspection-service.test.mjs`

Expected: FAIL porque `getInspectionWorkOrderBundle` no existe.

- [ ] **Step 3: Implementar el paquete mínimo**

Agregar en `17-inspection-drawing-service.js`:

```js
const PP_INSPECTION_BUNDLE_CACHE_SECONDS = 300;

function getInspectionWorkOrderBundle(wo, options) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(wo, 80);
    if (!folio) throw new Error('OT requerida');
    const forceRefresh = Boolean(options && options.forceRefresh === true);
    const cache = CacheService.getScriptCache();
    const cacheKey = 'PP_INSPECTION_WO_BUNDLE_' + folio;
    if (!forceRefresh) {
      const cached = cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }
    const detail = getInspectionWorkOrder(folio);
    if (!detail || !detail.ok) throw new Error(detail && detail.error || 'No se pudo cargar la OT');
    const history = getInspectionHistory(folio);
    if (!history || !history.ok) throw new Error(history && history.error || 'No se pudo cargar el historial');
    const bundle = { detail: detail.data, history: history.data };
    try { cache.put(cacheKey, JSON.stringify(bundle), PP_INSPECTION_BUNDLE_CACHE_SECONDS); } catch (error) {}
    return bundle;
  });
}
```

- [ ] **Step 4: Ejecutar pruebas**

Run: `node --test tests/inspection-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/17-inspection-drawing-service.js tests/inspection-service.test.mjs
git commit -m "perf: consolidar carga de hoja de inspeccion"
```

### Task 2: Caché cliente, precarga y control de concurrencia

**Files:**
- Modify: `src/web/inspection/inspection-app.js`
- Modify: `tests/build.test.mjs`

**Interfaces:**
- Consumes: `getInspectionWorkOrderBundle(wo, {forceRefresh})`.
- Produces: `requestBundle(wo, options)`, `prefetchRecentWorkOrders()` y `loadDetail(options)`.

- [ ] **Step 1: Actualizar pruebas estructurales para que fallen**

Reemplazar las expectativas de llamadas separadas y agregar:

```js
assert.match(pagesIndex, /const INSPECTION_CACHE_MS = 5 \* 60 \* 1000/);
assert.match(pagesIndex, /const INSPECTION_PREFETCH_LIMIT = 5/);
assert.match(pagesIndex, /const INSPECTION_PREFETCH_CONCURRENCY = 2/);
assert.match(pagesIndex, /call\("getInspectionWorkOrderBundle", wo, \{ forceRefresh \}\)/);
assert.match(pagesIndex, /state\.inFlight\.set\(wo, request\)/);
assert.match(pagesIndex, /state\.list\.slice\(0, INSPECTION_PREFETCH_LIMIT\)/);
assert.match(pagesIndex, /if \(requestId !== state\.activeRequestId\) return/);
assert.match(pagesIndex, /loadDetail\(\{ forceRefresh: true \}\)/);
assert.doesNotMatch(pagesIndex, /call\("getInspectionDrawingRoutes", state\.detail/);
assert.doesNotMatch(pagesIndex, /call\("getInspectionHistory", wo\)/);
```

Incluir `"getInspectionWorkOrderBundle"` en la lista de funciones públicas esperadas.

- [ ] **Step 2: Confirmar que fallan**

Run: `node --test tests/build.test.mjs`

Expected: FAIL por constantes y función ausentes.

- [ ] **Step 3: Implementar almacenamiento y solicitud compartida**

Extender el estado y agregar:

```js
const INSPECTION_CACHE_MS = 5 * 60 * 1000;
const INSPECTION_PREFETCH_LIMIT = 5;
const INSPECTION_PREFETCH_CONCURRENCY = 2;
const state = { list: [], detail: null, selection: {}, cache: new Map(), inFlight: new Map(), activeRequestId: 0 };

function requestBundle(wo, options = {}) {
  const forceRefresh = options.forceRefresh === true;
  const cached = state.cache.get(wo);
  if (!forceRefresh && cached && Date.now() - cached.savedAt < INSPECTION_CACHE_MS) return Promise.resolve(cached.data);
  if (!forceRefresh && state.inFlight.has(wo)) return state.inFlight.get(wo);
  const request = call("getInspectionWorkOrderBundle", wo, { forceRefresh })
    .then((result) => {
      if (!result?.ok) throw new Error(result?.error || "No se pudo cargar la WO");
      state.cache.set(wo, { savedAt: Date.now(), data: result.data });
      return result.data;
    })
    .finally(() => { if (state.inFlight.get(wo) === request) state.inFlight.delete(wo); });
  state.inFlight.set(wo, request);
  return request;
}
```

- [ ] **Step 4: Implementar precarga limitada**

```js
async function prefetchRecentWorkOrders() {
  const queue = state.list.slice(0, INSPECTION_PREFETCH_LIMIT).map((item) => String(item.wo));
  async function worker() {
    while (queue.length) {
      const wo = queue.shift();
      try { await requestBundle(wo); } catch (error) {}
    }
  }
  await Promise.all(Array.from({ length: Math.min(INSPECTION_PREFETCH_CONCURRENCY, queue.length) }, worker));
}
```

Al final exitoso de `loadList`, ejecutar sin bloquear:

```js
prefetchRecentWorkOrders().catch(() => {});
```

- [ ] **Step 5: Consumir el paquete y descartar respuestas obsoletas**

Reemplazar `loadDetail` por:

```js
async function loadDetail(options = {}) {
  const wo = byId("inspectionWorkOrder").value;
  if (!wo) return;
  const requestId = ++state.activeRequestId;
  renderJobStatus(`Cargando WO ${wo}...`);
  const bundle = await requestBundle(wo, options);
  if (requestId !== state.activeRequestId || byId("inspectionWorkOrder").value !== wo) return;
  state.detail = bundle.detail;
  state.selection = root.InspectionCore.initialOperationSelection(state.detail.operations || []);
  renderDetail();
  renderHistory({ ok: true, data: bundle.history }, state.detail.workOrder);
}
```

Conectar el botón:

```js
byId("inspectionReload").addEventListener("click", () => loadDetail({ forceRefresh: true }).catch(reportError));
```

- [ ] **Step 6: Ejecutar pruebas completas**

Run: `npm test`

Expected: todas PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/inspection/inspection-app.js tests/build.test.mjs
git commit -m "perf: precargar ordenes recientes de inspeccion"
```

### Task 3: Verificación de integración

**Files:**
- Verify: `src/server/17-inspection-drawing-service.js`
- Verify: `src/web/inspection/inspection-app.js`

**Interfaces:**
- Consumes: paquete servidor y cliente optimizado.
- Produces: build desplegable sin llamadas redundantes.

- [ ] **Step 1: Validar proyecto**

Run: `npm run check`

Expected: exit code 0.

- [ ] **Step 2: Construir artefactos**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 3: Revisar diff y script protegido**

Run: `git diff --check && git diff --stat && git grep "1ew3Nqi0e8SHid_zWv1z5cl6ATCZzqVLqc2lkbfox5CMNsh8FH5tL8zKx" -- .clasp.json src`

Expected: sin errores de espacios; ningún archivo activo apunta al script protegido.

- [ ] **Step 4: Confirmar árbol de trabajo**

Run: `git status --short`

Expected: solo los archivos previstos por este plan y los archivos no rastreados que ya existían.
