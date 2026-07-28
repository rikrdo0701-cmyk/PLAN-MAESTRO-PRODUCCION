import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/shared/performance-client.js", import.meta.url), "utf8");

function deferredPromise() {
  let resolve;
  const promise = new Promise((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

async function settleMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function loadClient(options = {}) {
  const storage = new Map();
  const toasts = [];
  const state = {
    revision: 1,
    materials: [],
    operations: [],
    workOrders: [],
    ...(options.state || {}),
  };
  const root = {
    location: { hostname: "localhost" },
    setTimeout: () => 1,
    clearTimeout: () => {},
    requestIdleCallback: () => 1,
    cancelIdleCallback: () => {},
    requestAnimationFrame: (callback) => { callback(); return 1; },
    PPAppsScriptBridge: {
      isConfigured: () => true,
      ensureReady: async () => {},
      call: async () => ({}),
    },
  };
  const context = {
    window: root,
    navigator: {},
    document: {
      addEventListener: () => {},
      createElement: () => ({ textContent: "" }),
      head: { appendChild: () => {} },
      body: { dataset: {} },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    STORAGE_KEY: "test",
    state,
    stateHistory: [],
    materialOtKey: (value) => String(value || ""),
    normalizeCapabilityKeys: (values) => [...new Set(values || [])],
    scheduleLocalStorageFlush: () => {},
    checkpointState: () => {},
    undoLastChange: () => {},
    renderPriorityList: () => {},
    renderPriorityQueue: () => {},
    enhanceRenderedImages: () => {},
    els: {
      priorityList: { querySelectorAll: () => [] },
      priorityQueue: { querySelectorAll: () => [] },
      selectedJobPanel: null,
    },
    applyImported: (imported) => Object.assign(state, imported),
    saveAppSheet: async () => false,
    queueAppSheetSave: () => {},
    appSheetMarkDirtyScope: () => {},
    appSheetConsumeDirtyScopes: () => [],
    appSheetDirtyScopes: new Set(),
    appSheetAvailable: true,
    appSheetSaveInFlight: false,
    appSheetSavePending: false,
    appSheetSaveTimer: null,
    netSuiteSyncInFlight: false,
    netSuitePlanningSyncInFlight: false,
    planningActionsBusy: "",
    planSnapshots: [],
    showToast: (message) => toasts.push(message),
    loadAppStateInBackground: async () => {},
    loadPlanSnapshots: (...args) => options.loadPlanSnapshots(...args),
    loadSnapshotsOnce: (...args) => options.loadPlanSnapshots(...args),
    restoreDraftPlanFromSharedState: async () => false,
    openRestoreDraftDialog: async () => context.loadSnapshotsOnce(false),
    saveState: () => {},
    render: () => {},
    applyInitialWorkspaceView: () => {},
    syncNetSuiteData: (...args) => options.syncNetSuiteData(...args),
    syncWorkOrdersOnce: (...args) => options.syncNetSuiteData(...args),
    syncNetSuiteInBackground: (syncOptions) => context.syncWorkOrdersOnce(syncOptions),
    renderTop: () => {},
    renderPlanAlerts: () => {},
    showWorkspaceView: () => {},
    renderSelectedJobPanel: () => {},
    getSelectedPriorityJob: () => null,
    selectedJobOt: () => "",
    ensurePlanningDataLoaded: async () => ({ ready: false }),
    console: { warn: () => {} },
    structuredClone,
    Date,
    Set,
    Map,
    Promise,
    requestAnimationFrame: root.requestAnimationFrame,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "performance-client.js" });
  return { context, state, toasts };
}

test("sincronizacion manual y de fondo comparten la misma promesa y un solo resultado", async () => {
  const gate = deferredPromise();
  let syncCalls = 0;
  let busy = false;
  const fixture = loadClient({
    state: { workOrders: [{ ot: "WO-1" }] },
    loadPlanSnapshots: async () => ({ ok: true, count: 0 }),
    syncNetSuiteData: async () => {
      syncCalls += 1;
      busy = true;
      const result = await gate.promise;
      busy = false;
      return result;
    },
  });

  const first = fixture.context.syncNetSuiteInBackground({ showMessage: false });
  const second = fixture.context.syncNetSuiteInBackground({ showMessage: true });
  await settleMicrotasks();

  assert.strictEqual(first, second);
  assert.equal(syncCalls, 1);
  assert.equal(busy, true);

  gate.resolve(true);
  await Promise.all([first, second]);

  assert.equal(busy, false);
  assert.deepEqual(fixture.toasts, ["1 OTs NetSuite cargadas"]);
});

test("un fallo libera la sincronizacion compartida para reintentar", async () => {
  let syncCalls = 0;
  const fixture = loadClient({
    state: {
      workOrders: [{ ot: "WO-1" }],
      netSuiteSyncAlert: { message: "backend fuera de linea" },
    },
    loadPlanSnapshots: async () => ({ ok: true, count: 0 }),
    syncNetSuiteData: async () => {
      syncCalls += 1;
      return syncCalls > 1;
    },
  });

  const failed = await fixture.context.syncNetSuiteInBackground({ showMessage: true });
  const retried = await fixture.context.syncNetSuiteInBackground({ showMessage: false });

  assert.equal(failed, false);
  assert.equal(retried, true);
  assert.equal(syncCalls, 2);
  assert.deepEqual(fixture.toasts, ["No se pudo cargar NetSuite: backend fuera de linea"]);
});

test("Reportes y Restaurar comparten snapshots y conservan la recarga explicita", async () => {
  const gate = deferredPromise();
  let snapshotCalls = 0;
  const fixture = loadClient({
    loadPlanSnapshots: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) return gate.promise;
      return { ok: true, count: 2 };
    },
    syncNetSuiteData: async () => false,
  });

  const reports = fixture.context.loadSnapshotsOnce(false);
  const restore = fixture.context.loadSnapshotsOnce(false);
  await settleMicrotasks();

  assert.strictEqual(reports, restore);
  assert.equal(snapshotCalls, 1);

  fixture.context.planSnapshots = [{ snapshotId: "published-1" }];
  gate.resolve({ ok: true, count: 1 });
  await Promise.all([reports, restore]);
  await fixture.context.loadSnapshotsOnce(false);
  assert.equal(snapshotCalls, 1);

  await fixture.context.loadPlanSnapshots(true);
  assert.equal(snapshotCalls, 2);
  assert.deepEqual(fixture.toasts, ["2 planes guardados disponibles"]);
});

test("Restaurar se une a una recarga explicita de snapshots que sigue activa", async () => {
  const refreshGate = deferredPromise();
  let snapshotCalls = 0;
  const fixture = loadClient({
    loadPlanSnapshots: async () => {
      snapshotCalls += 1;
      return snapshotCalls === 1
        ? { ok: true, count: 1 }
        : refreshGate.promise;
    },
    syncNetSuiteData: async () => false,
  });
  fixture.context.planSnapshots = [{ snapshotId: "published-1" }];
  await fixture.context.loadSnapshotsOnce(false);

  const refresh = fixture.context.loadPlanSnapshots(true);
  const restore = fixture.context.loadSnapshotsOnce(false);
  await settleMicrotasks();

  assert.strictEqual(refresh, restore);
  assert.equal(snapshotCalls, 2);

  refreshGate.resolve({ ok: true, count: 1 });
  await Promise.all([refresh, restore]);
});

test("un fallo de snapshots libera la clave para reintentar", async () => {
  let snapshotCalls = 0;
  const fixture = loadClient({
    loadPlanSnapshots: async () => {
      snapshotCalls += 1;
      return snapshotCalls === 1
        ? { ok: false, count: 0, error: "backend fuera de linea" }
        : { ok: true, count: 1 };
    },
    syncNetSuiteData: async () => false,
  });

  const failed = await fixture.context.loadSnapshotsOnce(false);
  fixture.context.planSnapshots = [{ snapshotId: "published-1" }];
  const retried = await fixture.context.loadSnapshotsOnce(false);

  assert.equal(failed.ok, false);
  assert.equal(retried.ok, true);
  assert.equal(snapshotCalls, 2);
});
