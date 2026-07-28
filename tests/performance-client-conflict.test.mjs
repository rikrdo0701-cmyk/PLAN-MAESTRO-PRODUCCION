import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/shared/performance-client.js", import.meta.url), "utf8");

function loadClient(options = {}) {
  const calls = [];
  const timers = [];
  const applyImportedCalls = [];
  const metadataWrites = [];
  const loadPlanSnapshotsCalls = [];
  const snapshotStateAtLoad = [];
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
  const storage = new Map();
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
      ensureReady: async () => {},
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
    netSuiteSyncInFlight: options.netSuiteSyncInFlight === true,
    netSuitePlanningSyncInFlight: options.netSuitePlanningSyncInFlight === true,
    planningActionsBusy: options.planningActionsBusy || "",
    planSnapshots: structuredClone(options.planSnapshots || []),
    showToast: () => {},
    loadAppStateInBackground: async () => {},
    loadPlanSnapshots: async (...args) => {
      loadPlanSnapshotsCalls.push(args);
      snapshotStateAtLoad.push(structuredClone(state));
      return options.loadPlanSnapshotsResult;
    },
    restoreDraftPlanFromSharedState: async () => false,
    openRestoreDraftDialog: async () => {
      restoreDraftCalls += 1;
      if (options.restoreDraftError) throw options.restoreDraftError;
    },
    saveState: () => {},
    render: () => {},
    applyInitialWorkspaceView: () => {
      if (options.initialSection) context.showWorkspaceView(options.initialSection);
    },
    syncNetSuiteData: async () => false,
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
    snapshotStateAtLoad,
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

test("el arranque evita descargar el estado cuando la revision y la cache utilizable no cambiaron", async () => {
  const fixture = loadClient({
    revision: 12,
    localState: JSON.stringify({ revision: 12, operations: [], workOrders: [] }),
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

test("una cache utilizable puede tomar la revision desde metadata persistida", async () => {
  const fixture = loadClient({
    revision: 0,
    localState: JSON.stringify({ operations: [], workOrders: [] }),
    metadata: JSON.stringify({ revision: 12 }),
    bridgeResults: {
      getAppStateIfChanged: { unchanged: true, revision: 12 },
    },
  });

  await fixture.context.loadAppStateInBackground();

  assert.deepEqual(fixture.calls.map((call) => call.method), ["getAppStateIfChanged"]);
  assert.equal(fixture.calls[0].args[0], 12);
  assert.equal(fixture.state.revision, 12);
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
    localState: JSON.stringify({ revision: 12, operations: [], workOrders: [] }),
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
    localState: JSON.stringify({ revision: 12, operations: [{ id: "local-op" }], workOrders: [] }),
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
    selectedJob: { ot: "WO-12" },
    localState: JSON.stringify({ revision: 12, operations: [], workOrders: [], materials: [] }),
    metadata: JSON.stringify({ revision: 12, deferredMaterials: true }),
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
      workOrders: [],
      materials: [{ ot: "WO-12", material: "LOCAL" }],
    }),
    bridgeResults: {
      getAppStateIfChanged: {
        revision: 13,
        operations: [],
        workOrders: [],
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

test("Reportes solicita snapshots solo al primer acceso", async () => {
  const fixture = loadClient();

  await fixture.context.loadAppStateInBackground();
  fixture.context.showWorkspaceView("reportes");
  fixture.context.showWorkspaceView("reportes");

  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);
});

test("Reportes espera a que termine el estado inicial antes de elegir su snapshot", async () => {
  const fixture = loadClient({
    revision: 12,
    initialSection: "reportes",
    localState: JSON.stringify({ revision: 12, operations: [{ id: "local-op" }], workOrders: [] }),
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

  assert.equal(fixture.restoreDraftCalls, 1);
  assert.equal(fixture.loadPlanSnapshotsCalls.length, 0);
});

test("Restaurar permite que Reportes reintente cuando no se cargaron snapshots", async () => {
  const fixture = loadClient({ planSnapshots: [] });

  await fixture.context.loadAppStateInBackground();
  await fixture.context.openRestoreDraftDialog();
  fixture.context.showWorkspaceView("reportes");

  assert.equal(fixture.restoreDraftCalls, 1);
  assert.equal(fixture.loadPlanSnapshotsCalls.length, 1);
});
