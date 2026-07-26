import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/shared/performance-client.js", import.meta.url), "utf8");

function loadClient() {
  const calls = [];
  const timers = [];
  const state = {
    revision: 1,
    excludedCapabilities: [],
    materials: [],
    operations: [],
    workOrders: [],
  };
  const remote = {
    revision: 2,
    excludedCapabilities: ["5527::SOLDADURA"],
    materials: [],
    operations: [],
    workOrders: [],
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
      call: async (method) => {
        calls.push(method);
        if (method === "saveSkillState") throw new Error("CONFLICT_REVISION: recarga");
        if (method === "getAppState") return structuredClone(remote);
        if (method === "getAppRevision") return { revision: remote.revision };
        return {};
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
    localStorage: { getItem: () => null, setItem: () => {} },
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
    applyImported: (imported) => { Object.assign(state, structuredClone(imported)); },
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
    showToast: () => {},
    loadAppStateInBackground: async () => {},
    loadPlanSnapshots: async () => {},
    restoreDraftPlanFromSharedState: async () => false,
    saveState: () => {},
    render: () => {},
    applyInitialWorkspaceView: () => {},
    syncNetSuiteData: async () => false,
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
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "performance-client.js" });
  return { context, state, calls, timers };
}

test("un conflicto recarga la coleccion remota y no reintenta el payload obsoleto", async () => {
  const fixture = loadClient();

  const saved = await fixture.context.saveAppSheet(false);

  assert.equal(saved, false);
  assert.deepEqual(fixture.calls, ["saveSkillState", "getAppState"]);
  assert.equal(fixture.state.revision, 2);
  assert.deepEqual(fixture.state.excludedCapabilities, ["5527::SOLDADURA"]);
  assert.equal(fixture.context.appSheetDirtyScopes.size, 0);
  assert.equal(fixture.timers.length, 0);
});
