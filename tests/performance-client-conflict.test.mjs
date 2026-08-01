import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/shared/performance-client.js", import.meta.url), "utf8");
const CACHE_IDENTITY = "plan-produccion-cache-v4";

function coherentLocalState(revision, patch = {}) {
  return JSON.stringify({
    revision,
    operations: [],
    workOrders: [],
    materials: [],
    ...patch,
    performanceCache: { identity: CACHE_IDENTITY, revision },
  });
}

function coherentMetadata(revision, patch = {}) {
  return JSON.stringify({
    revision,
    cacheIdentity: CACHE_IDENTITY,
    cacheRevision: revision,
    ...patch,
  });
}

function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function settleMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function loadClient(options = {}) {
  const calls = [];
  const timers = [];
  const applyImportedCalls = [];
  const metadataWrites = [];
  const loadPlanSnapshotsCalls = [];
  const snapshotStateAtLoad = [];
  const syncNetSuiteDataCalls = [];
  let restoreDraftCalls = 0;
  const state = {
    revision: options.revision ?? 1,
    excludedCapabilities: [],
    materials: [],
    operations: [],
    workOrders: [],
    ...(options.state || {}),
  };
  const remote = {
    revision: 2,
    excludedCapabilities: ["5527::SOLDADURA"],
    materials: [],
    operations: [],
    workOrders: [],
    ...(options.remote || {}),
  };
  const storage = options.storage || new Map();
  if (options.localState !== undefined) storage.set("test", options.localState);
  if (options.metadata !== undefined) storage.set("plan-produccion-performance-v2", options.metadata);
  const bridgeResults = {
    getAppState: structuredClone(remote),
    ...(options.bridgeResults || {}),
  };
  const root = {
    location: { hostname: "localhost" },
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    requestIdleCallback: (callback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
    cancelIdleCallback: () => {},
    requestAnimationFrame: (callback) => { callback(); return 1; },
    PPAppsScriptBridge: {
      isConfigured: () => true,
      ensureReady: async () => {
        if (options.ensureReady) await options.ensureReady(context);
      },
      call: async (method, args) => {
        calls.push({ method, args });
        if (method === "saveSkillState") throw new Error("CONFLICT_REVISION: recarga");
        const result = bridgeResults[method];
        if (result instanceof Error) throw result;
        return structuredClone(typeof result === "function" ? result(args) : (result ?? {}));
      },
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
      setItem: (key, value) => {
        storage.set(key, value);
        if (key === "plan-produccion-performance-v2") metadataWrites.push(JSON.parse(value));
      },
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
    els: { priorityList: {}, priorityQueue: {}, selectedJobPanel: null },
    applyImported: (imported, importedOptions) => {
      applyImportedCalls.push({ imported: structuredClone(imported), options: importedOptions });
      Object.assign(state, structuredClone(imported));
      options.onApplyImported?.(state);
    },
    saveAppSheet: async () => false,
    queueAppSheetSave: () => {},
    appSheetMarkDirtyScope: (scope) => context.appSheetDirtyScopes.add(scope),
    appSheetConsumeDirtyScopes: () => {
      const scopes = [...context.appSheetDirtyScopes];
      context.appSheetDirtyScopes.clear();
      return scopes;
    },
    appSheetDirtyScopes: new Set(["matrix"]),
    appSheetAvailable: true,
    appSheetSaveInFlight: false,
    appSheetSavePending: false,
    appSheetSaveTimer: null,
    appSheetSaveOwner: null,
    appSheetTryAcquireSaveGate: () => {
      if (context.appSheetSaveOwner) return null;
      const owner = {};
      context.appSheetSaveOwner = owner;
      context.appSheetSaveInFlight = true;
      return owner;
    },
    appSheetReleaseSaveGate: (owner) => {
      if (!owner || owner !== context.appSheetSaveOwner) return false;
      context.appSheetSaveOwner = null;
      context.appSheetSaveInFlight = false;
      return true;
    },
    netSuiteSyncInFlight: options.netSuiteSyncInFlight === true,
    netSuitePlanningSyncInFlight: options.netSuitePlanningSyncInFlight === true,
    planningActionsBusy: options.planningActionsBusy || "",
    planSnapshots: structuredClone(options.planSnapshots || []),
    showToast: () => {},
    loadAppStateInBackground: async () => {},
    loadPlanSnapshots: async (...args) => {
      loadPlanSnapshotsCalls.push(args);
      snapshotStateAtLoad.push(structuredClone(state));
      if (options.loadPlanSnapshotsImpl) return options.loadPlanSnapshotsImpl(context);
      return options.loadPlanSnapshotsResult ?? { ok: true, count: context.planSnapshots.length };
    },
    restoreDraftPlanFromSharedState: async () => false,
    openRestoreDraftDialog: async () => {
      restoreDraftCalls += 1;
      if (options.restoreDraftError) throw options.restoreDraftError;
      if (options.restoreLoadsSnapshots !== false) return context.loadPlanSnapshots(false);
    },
    saveState: () => {
      if (options.saveStateFlush) context.scheduleLocalStorageFlush();
    },
    render: (renderOptions) => options.onRender?.(renderOptions),
    purgeClosedWorkOrderRetention: () => options.onPurge?.(state),
    applyInitialWorkspaceView: () => {
      if (options.initialSection) context.showWorkspaceView(options.initialSection);
    },
    syncNetSuiteData: async (...args) => {
      syncNetSuiteDataCalls.push(args);
      return false;
    },
    syncWorkOrdersOnce: () => context.syncNetSuiteData(false, { mode: "workOrders" }),
    renderTop: () => {},
    renderPlanAlerts: () => {},
    showWorkspaceView: () => {},
    renderSelectedJobPanel: () => {},
    getSelectedPriorityJob: () => options.selectedJob || null,
    selectedJobOt: () => options.selectedJob?.ot || "",
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
  return {
    context,
    state,
    calls,
    timers,
    applyImportedCalls,
    metadataWrites,
    loadPlanSnapshotsCalls,
    syncNetSuiteDataCalls,
    snapshotStateAtLoad,
    storage,
    get restoreDraftCalls() { return restoreDraftCalls; },
  };
}

test("un conflicto recarga la coleccion remota y no reintenta el payload obsoleto", async () => {
  const fixture = loadClient();

  const saved = await fixture.context.saveAppSheet(false);

  assert.equal(saved, false);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["saveSkillState", "getAppState"]);
  assert.equal(fixture.state.revision, 2);
  assert.deepEqual(fixture.state.excludedCapabilities, ["5527::SOLDADURA"]);
  assert.equal(fixture.context.appSheetDirtyScopes.size, 0);
  assert.equal(fixture.timers.length, 0);
});

test("el arranque optimizado purga despues de importar y renderiza sin guardar", async () => {
  const events = [];
  const fixture = loadClient({
    revision: 0,
    remote: { revision: 2, operations: [{ id: "remote" }], workOrders: [{ ot: "WO-2" }] },
    onApplyImported: (state) => events.push(`import:${state.revision}`),
    onPurge: (state) => events.push(`purge:${state.revision}`),
    onRender: (options) => events.push(`render:${JSON.stringify(options)}`),
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(events.slice(0, 3), ["import:2", "purge:2", "render:{\"save\":false}"]);
});

test("el arranque evita descargar el estado cuando la revision y la cache utilizable no cambiaron", async () => {
  const fixture = loadClient({
    revision: 12,
    localState: coherentLocalState(12),
    metadata: coherentMetadata(12),
    bridgeResults: {
      getAppStateIfChanged: { unchanged: true, revision: 12, savedAt: "2026-07-27T10:00:00.000Z" },
    },
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppStateIfChanged"]);
  assert.equal(fixture.calls[0].args[0], 12);
  assert.equal(fixture.calls[0].args[1].includeMaterials, false);
  assert.equal(fixture.applyImportedCalls.length, 0);
  assert.equal(fixture.state.revision, 12);
  assert.equal(fixture.metadataWrites.at(-1).revision, 12);
});

test("una cobertura incompleta de OTs fuerza sincronizacion aunque el estado sea reciente", async () => {
  const operations = ["1803", "1954", "1962", "2001"].map((ot, index) => ({
    id: `op-${index}`,
    ot,
    tipoInsercion: "OPERACION",
  }));
  const workOrders = [{ ot: "1803", dueDate: "2026-05-21", description: "Ensamble brida 4473" }];
  const fixture = loadClient({
    revision: 12,
    state: {
      operations,
      workOrders,
      syncedAt: new Date().toISOString(),
    },
    localState: coherentLocalState(12, { operations, workOrders }),
    metadata: coherentMetadata(12),
    bridgeResults: {
      getAppStateIfChanged: {
        revision: 13,
        operations,
        workOrders,
        materials: [],
        performance: { deferred: { materials: true }, revision: 13 },
      },
    },
  });

  await fixture.context.loadAppStateInBackground();
  await settleMicrotasks();

  assert.equal(fixture.syncNetSuiteDataCalls.length, 1);
});

test("metadata positiva no vuelve utilizable una cache sin identidad y revision propias", async () => {
  const fixture = loadClient({
    revision: 0,
    localState: JSON.stringify({ operations: [], workOrders: [] }),
    metadata: JSON.stringify({ revision: 12 }),
    bridgeResults: {
      getAppStateIfChanged: { unchanged: true, revision: 12 },
    },
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppState"]);
  assert.equal(fixture.applyImportedCalls.length, 1);
});

test("una cache sellada no es utilizable si su revision difiere del estado en memoria", async () => {
  const fixture = loadClient({
    revision: 13,
    localState: coherentLocalState(12),
    metadata: coherentMetadata(12),
    remote: { revision: 14 },
    bridgeResults: {
      getAppStateIfChanged: { unchanged: true, revision: 12 },
    },
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppState"]);
  assert.equal(fixture.state.revision, 14);
});

test("una revision cero exige el estado completo", async () => {
  const fixture = loadClient({
    revision: 0,
    localState: JSON.stringify({ revision: 0, operations: [], workOrders: [] }),
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppState"]);
  assert.equal(fixture.applyImportedCalls.length, 1);
  assert.equal(fixture.applyImportedCalls[0].options.preserveLocalPlanning, false);
});

test("el arranque condicional aplica un payload remoto cambiado sin materiales", async () => {
  const changed = {
    revision: 13,
    operations: [{ id: "remote-op" }],
    workOrders: [{ ot: "WO-13" }],
    materials: [],
    performance: { deferred: { materials: true }, revision: 13 },
  };
  const fixture = loadClient({
    revision: 12,
    localState: coherentLocalState(12),
    metadata: coherentMetadata(12),
    bridgeResults: { getAppStateIfChanged: changed },
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppStateIfChanged"]);
  assert.equal(fixture.applyImportedCalls.length, 1);
  assert.equal(fixture.state.revision, 13);
  assert.deepEqual(fixture.state.operations, [{ id: "remote-op" }]);
});

for (const [name, localState] of [
  ["inexistente", undefined],
  ["corrupta", "{revision:"],
  ["incompleta", JSON.stringify({ revision: 12 })],
]) {
  test(`una cache local ${name} no acepta una respuesta unchanged`, async () => {
    const fixture = loadClient({
      revision: 12,
      localState,
      metadata: JSON.stringify({ revision: 12 }),
      bridgeResults: {
        getAppStateIfChanged: { unchanged: true, revision: 12 },
      },
    });

    await fixture.context.loadAppStateInBackground();

    assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppState"]);
    assert.equal(fixture.applyImportedCalls.length, 1);
  });
}

test("un fallo condicional conserva el estado local y no carga historicos en el arranque", async () => {
  const fixture = loadClient({
    revision: 12,
    state: { operations: [{ id: "local-op" }] },
    localState: coherentLocalState(12, { operations: [{ id: "local-op" }] }),
    metadata: coherentMetadata(12),
    bridgeResults: { getAppStateIfChanged: new Error("backend fuera de linea") },
  });

  await fixture.context.loadAppStateInBackground();

  assert.equal(fixture.applyImportedCalls.length, 0);
  assert.deepEqual(fixture.state.operations, [{ id: "local-op" }]);
  assert.equal(fixture.loadPlanSnapshotsCalls.length, 0);
});

test("unchanged restaura materiales diferidos desde metadata y los carga bajo demanda", async () => {
  const fixture = loadClient({
    revision: 12,
    state: { workOrders: [{ ot: "WO-12" }] },
    selectedJob: { ot: "WO-12" },
    localState: coherentLocalState(12, { workOrders: [{ ot: "WO-12" }] }),
    metadata: coherentMetadata(12, { deferredMaterials: true }),
    bridgeResults: {
      getAppStateIfChanged: { unchanged: true, revision: 12 },
      getMaterialsForOt: { revision: 12, materials: [{ ot: "WO-12", material: "TUBO" }] },
    },
  });

  await fixture.context.loadAppStateInBackground();
  fixture.context.renderSelectedJobPanel();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppStateIfChanged", "getMaterialsForOt"]);
  assert.equal(fixture.state.materials.length, 1);
  assert.equal(fixture.state.materials[0].material, "TUBO");
});

test("un payload cambiado que difiere materiales limpia las OTs marcadas como cargadas", async () => {
  const fixture = loadClient({
    revision: 12,
    state: { materials: [{ ot: "WO-12", material: "LOCAL" }] },
    selectedJob: { ot: "WO-12" },
    localState: JSON.stringify({
      revision: 12,
      operations: [],
      workOrders: [{ ot: "WO-12" }],
      materials: [{ ot: "WO-12", material: "LOCAL" }],
      performanceCache: { identity: CACHE_IDENTITY, revision: 12 },
    }),
    metadata: coherentMetadata(12),
    bridgeResults: {
      getAppStateIfChanged: {
        revision: 13,
        operations: [],
        workOrders: [{ ot: "WO-12" }],
        materials: [],
        performance: { deferred: { materials: true }, revision: 13 },
      },
      getMaterialsForOt: { revision: 13, materials: [{ ot: "WO-12", material: "REMOTO" }] },
    },
  });

  await fixture.context.loadAppStateInBackground();
  fixture.context.renderSelectedJobPanel();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppStateIfChanged", "getMaterialsForOt"]);
  assert.equal(fixture.state.materials.length, 1);
  assert.equal(fixture.state.materials[0].material, "REMOTO");
});

test("getAppState completo seguido de cache compacta conserva materiales bajo demanda en unchanged", async () => {
  const storage = new Map();
  const first = loadClient({
    revision: 0,
    storage,
    saveStateFlush: true,
    remote: {
      revision: 21,
      operations: [{ id: "remote-op" }],
      workOrders: [{ ot: "WO-21" }],
      materials: [{ ot: "WO-21", material: "TUBO-COMPLETO" }],
    },
  });

  await first.context.loadAppStateInBackground();

  const compacted = JSON.parse(storage.get("test"));
  const metadata = JSON.parse(storage.get("plan-produccion-performance-v2"));
  assert.deepEqual(compacted.materials, []);
  assert.equal(compacted.performanceCache.identity, CACHE_IDENTITY);
  assert.equal(compacted.performanceCache.revision, 21);
  assert.equal(metadata.deferredMaterials, true);
  assert.equal(metadata.cacheRevision, 21);

  const second = loadClient({
    revision: compacted.revision,
    state: compacted,
    storage,
    selectedJob: { ot: "WO-21" },
    bridgeResults: {
      getAppStateIfChanged: { unchanged: true, revision: 21 },
      getMaterialsForOt: { revision: 21, materials: [{ ot: "WO-21", material: "TUBO-DEFERIDO" }] },
    },
  });

  await second.context.loadAppStateInBackground();
  second.context.renderSelectedJobPanel();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(second.calls.map((call) => call.method), ["getAppStateIfChanged", "getMaterialsForOt"]);
  assert.equal(second.state.materials[0].material, "TUBO-DEFERIDO");
});

test("la validez de cache se captura antes de ensureReady y no acepta sampleState escrito durante la espera", async () => {
  const storage = new Map([
    ["plan-produccion-performance-v2", coherentMetadata(12)],
  ]);
  const fixture = loadClient({
    revision: 12,
    state: {
      operations: [{ id: "sample-op" }],
      workOrders: [{ ot: "SAMPLE-WO" }],
    },
    storage,
    ensureReady: async (context) => {
      context.scheduleLocalStorageFlush();
    },
    remote: {
      revision: 13,
      operations: [{ id: "remote-op" }],
      workOrders: [{ ot: "REMOTE-WO" }],
    },
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppState"]);
  assert.equal(fixture.state.revision, 13);
  assert.equal(fixture.state.operations[0].id, "remote-op");
});

test("Reportes solicita snapshots solo al primer acceso", async () => {
  const fixture = loadClient();

  await fixture.context.loadAppStateInBackground();
  fixture.context.showWorkspaceView("reportes");
  fixture.context.showWorkspaceView("reportes");
  await settleMicrotasks();

  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);
});

test("Reportes espera a que termine el estado inicial antes de elegir su snapshot", async () => {
  const fixture = loadClient({
    revision: 12,
    initialSection: "reportes",
    localState: coherentLocalState(12, { operations: [{ id: "local-op" }] }),
    metadata: coherentMetadata(12),
    state: { operations: [{ id: "local-op" }] },
    bridgeResults: {
      getAppStateIfChanged: {
        revision: 13,
        operations: [{ id: "remote-op" }],
        workOrders: [],
        materials: [],
        performance: { deferred: { materials: true }, revision: 13 },
      },
    },
  });

  fixture.context.showWorkspaceView("reportes");
  assert.equal(fixture.loadPlanSnapshotsCalls.length, 0);

  await fixture.context.loadAppStateInBackground();

  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);
  assert.deepEqual(fixture.snapshotStateAtLoad[0].operations, [{ id: "remote-op" }]);
});

test("Restaurar marca los snapshots como solicitados antes de abrir el flujo", async () => {
  const fixture = loadClient({ planSnapshots: [{ snapshotId: "published-1" }] });

  await fixture.context.loadAppStateInBackground();
  await fixture.context.openRestoreDraftDialog();
  fixture.context.showWorkspaceView("reportes");
  await settleMicrotasks();

  assert.equal(fixture.restoreDraftCalls, 1);
  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);
});

test("Restaurar conserva una lista vacia valida al abrir Reportes", async () => {
  const fixture = loadClient({ planSnapshots: [] });

  await fixture.context.loadAppStateInBackground();
  await fixture.context.openRestoreDraftDialog();
  fixture.context.showWorkspaceView("reportes");
  await settleMicrotasks();

  assert.equal(fixture.restoreDraftCalls, 1);
  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);
});

test("Reportes reintenta cuando loadPlanSnapshots informa fallo", async () => {
  const fixture = loadClient({
    loadPlanSnapshotsResult: { ok: false, count: 0, error: "backend fuera de linea" },
  });
  await fixture.context.loadAppStateInBackground();

  fixture.context.showWorkspaceView("reportes");
  await settleMicrotasks();
  fixture.context.showWorkspaceView("reportes");
  await settleMicrotasks();

  assert.equal(fixture.loadPlanSnapshotsCalls.length, 2);
});

test("Reportes y Restaurar concurrentes comparten una sola promesa de snapshots", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    loadPlanSnapshotsImpl: async (context) => {
      const snapshots = await gate.promise;
      context.planSnapshots = snapshots;
      return { ok: true, count: snapshots.length };
    },
  });
  await fixture.context.loadAppStateInBackground();

  fixture.context.showWorkspaceView("reportes");
  const restorePromise = fixture.context.openRestoreDraftDialog();
  await Promise.resolve();

  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);

  gate.resolve([{ snapshotId: "published-1" }]);
  await restorePromise;
  fixture.context.showWorkspaceView("reportes");
  await Promise.resolve();

  assert.equal(fixture.restoreDraftCalls, 1);
  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);
});
