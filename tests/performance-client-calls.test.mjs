import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/shared/performance-client.js", import.meta.url), "utf8");
const appSource = await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8");
const manualFlowSource = [
  appSource.slice(
    appSource.indexOf("async function loadNetSuiteExercise()"),
    appSource.indexOf("function formatReportDuration("),
  ),
  appSource.slice(
    appSource.indexOf("async function syncNetSuiteTwoPhase(options = {})"),
    appSource.indexOf("function applyNetSuitePlanningPayload("),
  ),
].join("\n");
const backlogSyncSource = appSource.slice(
  appSource.indexOf("async function syncBacklogWorkOrders()"),
  appSource.indexOf("async function syncNetSuiteTwoPhase(options = {})"),
);
const appSheetSaveFlowSource = appSource.slice(
  appSource.indexOf("function saveState(saveScope = \"plan\")"),
  appSource.indexOf("function purgeClosedWorkOrderRetention()"),
);
const appSheetGateSource = appSource.slice(
  appSource.indexOf("function appSheetTryAcquireSaveGate()"),
  appSource.indexOf("async function saveAppSheet("),
);
const busyStateSource = appSource.slice(
  appSource.indexOf("function setPlanningControlBusy("),
  appSource.indexOf("async function fetchNetSuiteExercise("),
);
const individualPlanningSource = appSource.slice(
  appSource.indexOf("const individualPlanningRequests"),
  appSource.indexOf("async function ensurePlanningDataLoaded("),
);
const individualSelectionSource = appSource.slice(
  appSource.indexOf("function jobPlanningOperations("),
  appSource.indexOf("async function prepareJobForPlanning("),
);
const detailSelectionSource = appSource.slice(
  appSource.indexOf("function openSelectedJobDetail("),
  appSource.indexOf("function finishBacklogDrag(", appSource.indexOf("function openSelectedJobDetail(")),
);
const selectedPriorityJobSource = appSource.slice(
  appSource.indexOf("function getSelectedPriorityJob("),
  appSource.indexOf("function workOrderPlaceholderOperation("),
);
const selectedJobOtSource = appSource.slice(
  appSource.indexOf("function selectedJobOt("),
  appSource.indexOf("function netSuiteChangeAlertForOt("),
);
const startupSource = appSource.slice(
  appSource.indexOf("async function loadAppStateInBackground("),
  appSource.indexOf("function bindElements("),
);
const workspaceViewSource = appSource.slice(
  appSource.indexOf("function applyInitialWorkspaceView("),
  appSource.indexOf("function loadState()"),
);
const initializeSource = appSource.slice(
  appSource.indexOf("function initializePlanningApp()"),
  appSource.indexOf("if (document.readyState === \"loading\")"),
);
const undoSource = appSource.slice(
  appSource.indexOf("function checkpointState("),
  appSource.indexOf("function addToolCatalogItem("),
);
const detailOperationsSource = appSource.slice(
  appSource.indexOf("const individualPlanningRequests"),
  appSource.indexOf("async function ensurePlanningDataLoaded("),
);
const applyPlanningPayloadSource = appSource.slice(
  appSource.indexOf("function applyNetSuitePlanningPayload("),
  appSource.indexOf("function applyNetSuiteWorkOrdersPayload("),
);
const applyWorkOrdersPayloadSource = appSource.slice(
  appSource.indexOf("function applyNetSuiteWorkOrdersPayload("),
  appSource.indexOf("function setNetSuiteSyncPhaseLabel("),
);
const loadSourceSelectionSource = appSource.slice(
  appSource.indexOf("async function loadSelectedLoadPlan("),
  appSource.indexOf("async function loadIncrementalPlanningBase("),
);
const adjustedProductionSource = appSource.slice(
  appSource.indexOf("function adjustedProductionMinutes("),
  appSource.indexOf("function opStart("),
);
const planStatusSource = appSource.slice(
  appSource.indexOf("const operationPlanStatusActions"),
  appSource.indexOf("function renderProductionReportRow("),
);

function loadIndividualSelection({ jobs, loaded, card, state, toasts, prepare = async () => true, checkpoint = () => {}, showLoading = () => {}, closeDialog = () => {}, planningDialog = { open: true } }) {
  return new Function(
    "els", "getPriorityJobs", "showToast", "state", "window", "currentPlanOperations",
    "ensureWorkOrderPlanningData", "prepareJobForPlanning", "checkpointState", "applyQueuePriorities",
    "renderPriorityList", "renderPriorityQueue", "requestAnimationFrame", "renderTop", "renderPlanAlerts", "saveState",
    "materialOtKey", "hasIndividualPlanningOperations", "showPlanningPreparationLoading", "closePlanningDialog",
    `${individualSelectionSource}; return selectJob;`,
  )(
    { priorityList: { querySelectorAll: () => [card] }, planningDialog }, () => jobs.value, (message) => toasts.push(message), state,
    { PlanningWorkflowCore: { commitPreparedOtSelection: (draft, ot) => ({ ...draft, selectedOts: [...draft.selectedOts, ot] }) } },
    (operations) => operations, loaded, prepare, checkpoint, () => {}, () => {}, () => {},
    (callback) => callback(), () => {}, () => {}, () => {},
    (value) => String(value || ""), (ot) => jobs.value.some((job) => String(job.ot) === String(ot) && job.ops.length > 0), showLoading, closeDialog,
  );
}

function loadIndividualActionInternals({ jobs, loaded, card, state, toasts, prepare = async () => true, showLoading = () => {}, closeDialog = () => {}, planningDialog = { open: true } }) {
  return new Function(
    "els", "getPriorityJobs", "showToast", "state", "window", "currentPlanOperations",
    "ensureWorkOrderPlanningData", "prepareJobForPlanning", "checkpointState", "applyQueuePriorities",
    "renderPriorityList", "renderPriorityQueue", "requestAnimationFrame", "renderTop", "renderPlanAlerts", "saveState",
    "materialOtKey", "hasIndividualPlanningOperations", "showPlanningPreparationLoading", "closePlanningDialog",
    `${individualSelectionSource}; return {
      selectJob,
      actionStatus: typeof individualPlanningActionStatus === "function" ? individualPlanningActionStatus : null,
    };`,
  )(
    { priorityList: { querySelectorAll: () => [card] }, planningDialog }, () => jobs.value, (message) => toasts.push(message), state,
    { PlanningWorkflowCore: { commitPreparedOtSelection: (draft, ot) => ({ ...draft, selectedOts: [...draft.selectedOts, ot] }) } },
    (operations) => operations, loaded, prepare, () => {}, () => {}, () => {}, () => {},
    (callback) => callback(), () => {}, () => {}, () => {},
    (value) => String(value || ""), (ot) => jobs.value.some((job) => String(job.ot) === String(ot) && job.ops.length > 0), showLoading, closeDialog,
  );
}

function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

async function settleMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

test("la precarga limita cinco OTs, usa dos solicitudes y prioriza la busqueda exacta", async () => {
  const started = [];
  const gates = new Map();
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: { workOrders: ["1", "2", "3", "4", "5", "6"].map((ot) => ({ ot })) },
    callAppsScript: (_method, ot) => {
      started.push(ot);
      const gate = deferredPromise();
      gates.set(ot, gate);
      return gate.promise;
    },
  });

  const prefetch = fixture.context.prefetchRecentPlanningWorkOrders({ exactOt: "6" });
  await settleMicrotasks();
  assert.deepEqual(started, ["6", "1"]);

  const resolveNext = () => {
    const ot = started.find((candidate) => gates.has(candidate));
    const gate = gates.get(ot);
    gates.delete(ot);
    gate.resolve({ ok: true, data: { workOrder: { ot }, operations: [{ ot, ct: "CORTE", tiempoProd: 10 }], materials: [] } });
  };
  while (started.length < 5) {
    resolveNext();
    await settleMicrotasks();
  }
  for (const [ot, gate] of gates) {
    gate.resolve({ ok: true, data: { workOrder: { ot }, operations: [{ ot, ct: "CORTE", tiempoProd: 10 }], materials: [] } });
  }
  await prefetch;

  assert.equal(started.length, 5);
  assert.deepEqual(started, ["6", "1", "2", "3", "4"]);
});

test("las precargas repetidas comparten el limite global de dos solicitudes", async () => {
  const gates = new Map();
  let active = 0;
  let maximumActive = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: { workOrders: ["1", "2", "3", "4", "5", "6"].map((ot) => ({ ot })) },
    callAppsScript: (_method, ot) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const gate = deferredPromise();
      gates.set(ot, gate);
      return gate.promise.finally(() => { active -= 1; });
    },
  });

  const first = fixture.context.prefetchRecentPlanningWorkOrders();
  await settleMicrotasks();
  const second = fixture.context.prefetchRecentPlanningWorkOrders({ exactOt: "6" });
  await settleMicrotasks();
  assert.equal(maximumActive, 2);
  assert.ok(first instanceof Promise);
  assert.ok(second instanceof Promise);
});

test("la precarga usa startDate descendente y conserva el orden recibido cuando empata", async () => {
  const started = [];
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [
        { ot: "OLD", startDate: "2026-01-01" },
        { ot: "TIE-A", startDate: "2026-06-10" },
        { ot: "NEW", startDate: "2026-08-01" },
        { ot: "TIE-B", startDate: "2026-06-10" },
        { ot: "MID", startDate: "2026-04-01" },
        { ot: "OLDER", startDate: "2025-12-01" },
      ],
    },
    callAppsScript: async (_method, ot) => {
      started.push(ot);
      return { ok: true, data: { workOrder: { ot }, operations: [{ ot, ct: "CORTE", tiempoProd: 10 }], materials: [] } };
    },
  });

  await fixture.context.prefetchRecentPlanningWorkOrders();
  assert.deepEqual(started, ["NEW", "TIE-A", "TIE-B", "MID", "OLD"]);
});

test("la cache individual vence en diez minutos", async () => {
  let now = 0;
  let calls = 0;
  class Clock extends Date { static now() { return now; } }
  const fixture = loadClient({
    installIndividualPlanning: true,
    Date: Clock,
    state: { workOrders: [{ ot: "2773" }] },
    callAppsScript: async () => {
      calls += 1;
      return { ok: true, data: { workOrder: { ot: "2773" }, operations: [{ ot: "2773", ct: "CORTE", tiempoProd: 10 }], materials: [] } };
    },
  });

  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  now = 10 * 60 * 1000 - 1;
  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "cached" });
  now += 1;
  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  assert.equal(calls, 2);
});

test("la carga individual vence en treinta segundos y permite reintentar", async () => {
  const timeouts = [];
  let calls = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: { workOrders: [{ ot: "2773" }] },
    withTimeout: async (promise, timeoutMs) => {
      timeouts.push(timeoutMs);
      if (calls === 1) throw new Error("timeout");
      return promise;
    },
    callAppsScript: async () => {
      calls += 1;
      return { ok: true, data: { workOrder: { ot: "2773" }, operations: [{ ot: "2773", ct: "CORTE", tiempoProd: 10 }], materials: [] } };
    },
  });

  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: false, error: "timeout" });
  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  assert.deepEqual(timeouts, [30 * 1000, 30 * 1000]);
});

test("la accion individual conserva Guardado para el siguiente render de su tarjeta", async () => {
  const statusNode = { textContent: "" };
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    setAttribute: () => {}, removeAttribute: () => {},
    querySelector: (selector) => selector === ".job-add" ? addButton : statusNode,
  };
  const fixture = loadIndividualActionInternals({
    jobs: { value: [{ ot: "100", movable: true, ops: [{ ot: "100", ct: "CORTE" }] }] },
    loaded: async () => ({ ready: true }), card,
    state: { selectedOts: [], operations: [{ ot: "100", ct: "CORTE" }], preparedPlanningByOt: {} }, toasts: [],
  });

  assert.equal(typeof fixture.actionStatus, "function");
  await fixture.selectJob("100", true);
  assert.equal(statusNode.textContent, "Guardado");
  assert.equal(fixture.actionStatus("100"), "saved");
});

test("cancelar el dialogo de planeacion libera la tarjeta sin mostrar Error", async () => {
  const statusNode = { textContent: "" };
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    setAttribute: () => {}, removeAttribute: () => {},
    querySelector: (selector) => selector === ".job-add" ? addButton : statusNode,
  };
  const state = { selectedOts: [], operations: [{ ot: "100", ct: "CORTE" }], preparedPlanningByOt: {} };
  const fixture = loadIndividualActionInternals({
    jobs: { value: [{ ot: "100", movable: true, ops: [{ ot: "100", ct: "CORTE" }] }] },
    loaded: async () => ({ ready: true }), card, state, toasts: [],
    prepare: async (_job, options) => { options.onCancel?.(); return false; },
  });

  assert.equal(await fixture.selectJob("100", true), false);
  assert.equal(statusNode.textContent, "");
  assert.equal(fixture.actionStatus("100"), "");
  assert.deepEqual(state.selectedOts, []);
});

test("agregar una OT sin operaciones locales abre preparacion antes de esperar la carga remota", async () => {
  const statusNode = { textContent: "" };
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    setAttribute: () => {}, removeAttribute: () => {},
    querySelector: (selector) => selector === ".job-add" ? addButton : statusNode,
  };
  const loadGate = deferredPromise();
  const loadingDialogs = [];
  const closedDialogs = [];
  const preparedDialogs = [];
  const jobs = { value: [{ ot: "100", movable: true, ops: [] }] };
  const state = { selectedOts: [], operations: [], preparedPlanningByOt: {} };
  const fixture = loadIndividualSelection({
    jobs,
    card,
    state,
    toasts: [],
    loaded: async () => {
      await loadGate.promise;
      jobs.value = [{ ot: "100", movable: true, ops: [{ ot: "100", ct: "CORTE" }] }];
      return { ready: true };
    },
    showLoading: (ot) => loadingDialogs.push(ot),
    closeDialog: (value) => closedDialogs.push(value),
    prepare: async (job) => { preparedDialogs.push(job.ot); return true; },
  });

  const selection = fixture("100", true);
  await settleMicrotasks();

  assert.deepEqual(loadingDialogs, ["100"]);
  assert.deepEqual(state.selectedOts, []);

  loadGate.resolve();
  assert.equal(await selection, true);
  assert.deepEqual(closedDialogs, [null]);
  assert.deepEqual(preparedDialogs, ["100"]);
  assert.deepEqual(state.selectedOts, ["100"]);
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadClient(options = {}) {
  const storage = new Map();
  const toasts = [];
  const busyStates = [];
  const backlogBusyStates = [];
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
      call: async (method, args) => options.callAppsScript?.(method, ...(args || [])),
    },
    PlanningWorkflowCore: {
      withTimeout: (promise, timeoutMs) => options.withTimeout?.(promise, timeoutMs) ?? promise,
      netSuiteSyncOutcome: (workOrders, planning) => ({
        status: workOrders?.ok && planning?.ok ? "complete" : "failed",
        message: workOrders?.ok && planning?.ok ? "Sincronizacion completa" : (workOrders?.error || planning?.error || "Fallo"),
      }),
      pruneDraftToOpenWorkOrders: () => ({}),
      reconcileActiveWorkOrders: (...args) => options.reconcileActiveWorkOrders?.(...args),
      purgeClosedWorkOrderRetention: (...args) => options.purgeClosedWorkOrderRetention?.(...args),
    },
    PlannerCore: {
      isSpecialSubcontractCapability: (capability) => String(capability?.ct) === "6462" || /SUBCONTRATO/i.test(String(capability?.label || "")),
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
    NETSUITE_PLANNING_TIMEOUT_MS: 1000,
    NETSUITE_BACKLOG_SYNC_TIMEOUT_MS: 60000,
    state,
    stateHistory: [],
    materialOtKey: (value) => String(value || ""),
    capabilityFromOperation: (operation) => {
      const ct = String(operation?.ct || "SIN_CT").trim();
      const label = String(operation?.descripcion || operation?.tipoInsercion || "OPERACION").trim();
      const normalized = label.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
      return { key: `${ct}::${normalized}`, ct, label };
    },
    normalizeCapabilityKeys: (values) => [...new Set(values || [])],
    scheduleLocalStorageFlush: () => {},
    checkpointState: () => options.checkpointState?.(),
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
    appSheetMarkDirtyScope: (scope) => {
      const value = String(scope || "plan").trim().toLowerCase();
      if (value !== "local" && value !== "ui") context.appSheetDirtyScopes.add(value || "plan");
    },
    appSheetConsumeDirtyScopes: () => {
      const scopes = context.appSheetDirtyScopes.size ? [...context.appSheetDirtyScopes] : ["plan"];
      context.appSheetDirtyScopes.clear();
      return scopes;
    },
    appSheetDirtyScopes: new Set(),
    appSheetAvailable: true,
    appSheetSaveInFlight: false,
    appSheetSavePending: false,
    appSheetSaveTimer: null,
    appSheetSaveCompletion: Promise.resolve(),
    resolveAppSheetSaveCompletion: null,
    appSheetSaveOwner: null,
    operationStatusSavesInFlight: 0,
    appSheetWaitForIdle: async () => {},
    appSheetTryAcquireSaveGate: () => {
      if (context.appSheetSaveOwner) return null;
      const owner = {};
      context.appSheetSaveOwner = owner;
      context.appSheetSaveInFlight = true;
      return owner;
    },
    appSheetAcquireSaveGate: async () => context.appSheetTryAcquireSaveGate(),
    appSheetReleaseSaveGate: (owner) => {
      if (!owner || owner !== context.appSheetSaveOwner) return false;
      context.appSheetSaveOwner = null;
      context.appSheetSaveInFlight = false;
      return true;
    },
    netSuiteSyncInFlight: false,
    netSuitePlanningSyncInFlight: false,
    backlogSyncInFlight: false,
    planningActionsBusy: "",
    planSnapshots: [],
    showToast: (message) => toasts.push(message),
    setPlanningActionsBusy: (_action, inProgress) => {
      context.planningActionsBusy = inProgress ? "sync" : "";
      busyStates.push(inProgress);
    },
    setBacklogSyncInFlight: (inProgress) => {
      context.backlogSyncInFlight = inProgress;
      backlogBusyStates.push(inProgress);
    },
    setNetSuiteSyncPhaseLabel: () => {},
    loadAppStateInBackground: async () => {},
    loadPlanSnapshots: (...args) => options.loadPlanSnapshots(...args),
    loadSnapshotsOnce: (...args) => options.loadPlanSnapshots(...args),
    restoreDraftPlanFromSharedState: async () => false,
    openRestoreDraftDialog: async () => context.loadSnapshotsOnce(false),
    saveState: () => options.saveState?.(),
    saveAndRender: () => options.saveAndRender?.(),
    render: (...args) => options.render?.(...args),
    purgeClosedWorkOrderRetention: () => {},
    applyInitialWorkspaceView: () => {},
    syncNetSuiteData: (...args) => options.syncNetSuiteData(...args),
    syncWorkOrdersOnce: (syncOptions = {}) => context.syncNetSuiteData(syncOptions.showMessage === true, { mode: "workOrders" }),
    syncNetSuiteInBackground: (syncOptions) => context.syncWorkOrdersOnce(syncOptions),
    validateNetSuiteImportedData: () => {},
    invalidateCurrentPlanOperationsCache: () => options.invalidateCurrentPlanOperationsCache?.(),
    resetBacklogWindow: () => options.resetBacklogWindow?.(),
    applyNetSuitePlanningPayload: () => {},
    callAppsScript: (...args) => options.callAppsScript?.(...args),
    createAppSheetPayload: (source) => options.createAppSheetPayload?.(source) ?? {},
    renderTop: () => {},
    renderPlanAlerts: () => {},
    showWorkspaceView: () => {},
    renderSelectedJobPanel: () => {},
    getSelectedPriorityJob: () => null,
    selectedJobOt: () => "",
    ensurePlanningDataLoaded: async () => ({ ready: false }),
    console: { warn: () => {} },
    structuredClone,
    Date: options.Date || Date,
    Set,
    Map,
    Promise,
    requestAnimationFrame: root.requestAnimationFrame,
  };
  vm.createContext(context);
  if (options.installBacklogSync) vm.runInContext(backlogSyncSource, context, { filename: "planning-backlog-sync.js" });
  if (options.installManualFlow) vm.runInContext(manualFlowSource, context, { filename: "planning-manual-flow.js" });
  if (options.installSaveGate) vm.runInContext(appSheetGateSource, context, { filename: "planning-save-gate.js" });
  vm.runInContext(source, context, { filename: "performance-client.js" });
  if (options.installIndividualPlanning) vm.runInContext(individualPlanningSource, context, { filename: "planning-individual-work-order.js" });
  if (options.installDetailOperations) {
    vm.runInContext(detailOperationsSource, context, { filename: "planning-detail-operations.js" });
    vm.runInContext("globalThis.isSelectedJobDetailOperationLoading = (ot) => selectedJobDetailOperationLoads.has(materialOtKey(ot));", context);
  }
  if (options.installDetailSelection) {
    vm.runInContext(detailSelectionSource, context, { filename: "planning-detail-selection.js" });
    vm.runInContext(selectedPriorityJobSource, context, { filename: "planning-selected-priority-job.js" });
    vm.runInContext(selectedJobOtSource, context, { filename: "planning-selected-job-ot.js" });
  }
  return { context, state, toasts, busyStates, backlogBusyStates };
}

function loadPlanStatus(options = {}) {
  const rows = options.rows || [];
  const buttonKeys = options.buttonKeys || rows;
  const deferredWork = [];
  const broadRenders = [];
  const toasts = [];
  const state = {
    revision: 1,
    operations: options.operations || [],
    operationPlanStatuses: options.operationPlanStatuses || {},
    ...(options.state || {}),
  };
  const reportSource = options.reportOperations || state.operations;
  const buttons = buttonKeys.map((key) => {
    const operation = state.operations.find((item) => item.id === key);
    const completed = state.operationPlanStatuses[key]?.status === "COMPLETADA_PLAN" || operation?.planStatus === "COMPLETADA_PLAN";
    const classes = new Set(["plan-status-action", completed ? "reopen" : "complete"]);
    const button = {
      dataset: { planStatusKey: key },
      classList: { toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)) },
      setAttribute: () => {},
      addEventListener: (_type, listener) => { button.listener = listener; },
      textContent: completed ? "Reabrir" : "Completar",
      disabled: false,
      get classes() { return [...classes].sort(); },
    };
    return button;
  });
  const createReportRow = (key) => ({
    dataset: { planStatusRowKey: key }, removed: false, html: "", nextSibling: null,
    remove() { this.removed = true; },
    querySelectorAll: () => buttons.filter((button) => button.dataset.planStatusKey === key),
    set outerHTML(value) { this.html = value; },
  });
  const reportRows = rows.map(createReportRow);
  let activeReportRows = reportRows;
  let currentBody = null;
  const createBody = () => {
    const body = { insertBefore: (row) => {
      row.removed = false;
      row.parentNode = body;
      if (body === currentBody && !activeReportRows.includes(row)) activeReportRows.push(row);
    } };
    return body;
  };
  currentBody = createBody();
  const operatorReport = {
    querySelectorAll: (selector) => selector === "[data-plan-status-row-key]"
      ? activeReportRows.filter((row) => !row.removed)
      : buttons.filter((button) => !activeReportRows.find((row) => row.dataset.planStatusRowKey === button.dataset.planStatusKey)?.removed),
    contains: (node) => node === currentBody,
  };
  reportRows.forEach((row) => { row.parentNode = currentBody; });
  const els = {
    operatorReport,
    adjusterReport: { querySelectorAll: () => [] },
    operatorReportStartInput: { value: "" },
    operatorReportFutureDays: { value: "" },
    operatorReportCount: { textContent: "", title: "" },
    adjusterReportStartInput: { value: "" },
    adjusterReportFutureDays: { value: "" },
    adjusterReportCount: { textContent: "", title: "" },
  };
  const reportSelection = () => {
    const status = options.reportStatus || "TODAS";
    const selected = reportSource.filter((operation) => {
      const completed = state.operationPlanStatuses[operation.id]?.status === "COMPLETADA_PLAN" || operation.planStatus === "COMPLETADA_PLAN";
      if (!operation.fechaInicio || !operation.fechaFin) return false;
      return status === "TODAS" || (status === "COMPLETADAS" ? completed : !completed);
    });
    return { rows: selected, total: selected.length, date: "2026-08-01", futureDays: 1 };
  };
  let reportRenders = 0;
  const rerenderReport = () => {
    reportRenders += 1;
    currentBody = createBody();
    activeReportRows = reportSelection().rows.map((operation) => {
      const row = createReportRow(operation.id);
      row.parentNode = currentBody;
      return row;
    });
  };
  const api = new Function(
    "state", "els", "window", "isReportSnapshotEditable", "isPlanCompletedOperation", "operationCompletionKey",
    "deepClone", "appendLog", "isToolChangeReportOperation", "workOrderForOt", "checkpointState",
    "invalidateGanttCache", "renderTop", "renderPlanAlerts", "renderSelectedJobPanel", "renderDraftExecutiveSummary",
    "renderGantt", "renderLoads", "requestAnimationFrame", "scheduleLocalStorageFlush", "showToast", "appSheetAvailable",
    "isAppsScriptRuntime", "appSheetSaveTimer", "operationStatusSavesInFlight", "callAppsScript",
    "appSheetDirtyScopes", "queueAppSheetSave", "appSheetMarkDirtyScope", "saveAppSheet", "console", "render",
    "selectedJobOt", "escapeHtml", "operatorReportSelection", "adjusterReportSelection", "renderReportFilterStatus",
    "renderProductionReportRow", "renderAdjusterReportRow", "bindReportCommentInputs", "renderOperatorReport", "renderAdjusterReport", "reportOperationsSource",
    `${planStatusSource}; return { bindPlanStatusActions, toggleOperationPlanStatus };`,
  )(
    state, els, {
      clearTimeout: () => {},
      schedulePlanStatusBackgroundRefresh: (callback) => deferredWork.push(callback),
      PlannerCore: { operationToolKey: () => "" },
    }, () => true,
    (operation) => operation?.planStatus === "COMPLETADA_PLAN", (operation) => operation?.id || "",
    structuredClone, (log, entry) => [log, entry].filter(Boolean).join(" | "), () => false, () => null,
    () => {}, () => {}, () => broadRenders.push("top"), () => broadRenders.push("alerts"), () => {},
    () => broadRenders.push("summary"), () => broadRenders.push("gantt"), () => broadRenders.push("loads"), (callback) => { callback(); return 1; },
    () => {}, (message) => toasts.push(message), true, () => true, null, 0,
    (...args) => options.callAppsScript?.(...args), new Set(), () => {}, () => {}, async () => false,
    { warn: () => {} }, () => broadRenders.push("render"), () => "", (value) => String(value || ""),
    reportSelection, () => ({ rows: [], total: 0, date: "2026-08-01", futureDays: 1 }),
    (_type, input, future, output, selection) => {
      input.value = selection.date;
      future.value = String(selection.futureDays);
      output.textContent = `${selection.rows.length} de ${selection.total} · max. 25`;
    },
    (operation) => `<tr data-plan-status-row-key="${operation.id}"></tr>`,
    (operation) => `<tr data-plan-status-row-key="${operation.id}"></tr>`, () => {}, rerenderReport, () => {}, () => reportSource,
  );
  return {
    api, buttons, state, reportRows, els, deferredWork, broadRenders, toasts, rerenderReport,
    visibleReportKeys: () => activeReportRows.filter((row) => !row.removed).map((row) => row.dataset.planStatusRowKey),
    reportRenderCount: () => reportRenders,
  };
}

test("completar actualiza solo la fila, guarda atomico y confirma en segundo plano", async () => {
  const gate = deferredPromise();
  const calls = [];
  const fixture = loadPlanStatus({
    rows: ["op-1", "op-2"],
    reportStatus: "PENDIENTES",
    operations: [
      { id: "op-1", ot: "100", ct: "CORTE", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
      { id: "op-2", ot: "100", ct: "DOBLEZ", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
    ],
    callAppsScript: (method, payload) => {
      calls.push([method, payload]);
      return gate.promise;
    },
  });

  fixture.api.bindPlanStatusActions(fixture.buttons[0].dataset.planStatusKey ? { querySelectorAll: () => fixture.buttons } : null);
  assert.equal(typeof fixture.buttons[0].listener, "function");
  const saved = fixture.buttons[0].listener();
  await settleMicrotasks();

  assert.ok(fixture.state.operationPlanStatuses["op-1"], JSON.stringify({ state: fixture.state, toasts: fixture.toasts }));
  assert.equal(fixture.state.operationPlanStatuses["op-1"].status, "COMPLETADA_PLAN");
  assert.equal(fixture.buttons[0].textContent, "Reabrir");
  assert.equal(fixture.buttons[1].textContent, "Completar");
  assert.equal(fixture.reportRows[0].removed, true);
  assert.equal(fixture.reportRows[1].removed, false);
  assert.equal(fixture.els.operatorReportCount.textContent, "1 de 1 · max. 25");
  assert.deepEqual(fixture.broadRenders, []);
  assert.deepEqual(calls.map(([method]) => method), ["saveOperationPlanStatus"]);
  assert.equal(calls[0][1].status.operationId, "op-1");
  assert.equal(fixture.deferredWork.length, 1);

  gate.resolve({ revision: 2, savedAt: "2026-08-01T00:00:00.000Z" });
  await saved;

  assert.equal(fixture.state.revision, 2);
  fixture.deferredWork.forEach((callback) => callback());
  assert.deepEqual(fixture.broadRenders, ["top", "alerts", "summary", "gantt", "loads"]);
});

test("completar funciona con operaciones de un plan publicado seleccionado", async () => {
  const calls = [];
  const publishedOperation = {
    id: "published-op-1",
    ot: "200",
    ct: "CORTE",
    operador: "OPERADOR 1",
    fechaInicio: "2026-08-01",
    horaInicio: "07:00",
    fechaFin: "2026-08-01",
    horaFin: "08:00",
  };
  const fixture = loadPlanStatus({
    rows: ["published-op-1"],
    operations: [],
    reportOperations: [publishedOperation],
    callAppsScript: (method, payload) => {
      calls.push([method, payload]);
      return Promise.resolve({ revision: 2, savedAt: "2026-08-01T00:00:00.000Z" });
    },
  });

  fixture.api.bindPlanStatusActions({ querySelectorAll: () => fixture.buttons });
  await fixture.buttons[0].listener();

  assert.equal(fixture.state.operationPlanStatuses["published-op-1"].status, "COMPLETADA_PLAN");
  assert.equal(fixture.state.operationPlanStatuses["published-op-1"].ot, "200");
  assert.equal(fixture.buttons[0].textContent, "Reabrir");
  assert.deepEqual(calls.map(([method]) => method), ["saveOperationPlanStatus"]);
  assert.equal(fixture.state.operations.length, 0);
});

test("un error revierte unicamente la fila editada", async () => {
  const gate = deferredPromise();
  const fixture = loadPlanStatus({
    rows: ["op-1", "op-2"],
    reportStatus: "TODAS",
    operations: [
      { id: "op-1", ot: "100", ct: "CORTE", planStatus: "PENDIENTE", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
      { id: "op-2", ot: "100", ct: "DOBLEZ", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
    ],
    operationPlanStatuses: { "op-2": { key: "op-2", status: "COMPLETADA_PLAN" } },
    callAppsScript: () => gate.promise,
  });

  assert.equal(fixture.buttons[1].textContent, "Reabrir");
  assert.deepEqual(fixture.buttons[1].classes, ["plan-status-action", "reopen"]);
  const result = fixture.api.toggleOperationPlanStatus("op-1");
  gate.reject(new Error("sin conexion"));

  assert.equal(await result, false);
  assert.equal(fixture.state.operations[0].planStatus, "PENDIENTE");
  assert.equal(fixture.state.operationPlanStatuses["op-1"], undefined);
  assert.equal(fixture.state.operations[1].planStatus, "COMPLETADA_PLAN");
  assert.equal(fixture.state.operationPlanStatuses["op-2"].status, "COMPLETADA_PLAN");
  assert.equal(fixture.buttons[0].textContent, "Completar");
  assert.equal(fixture.buttons[1].textContent, "Reabrir");
  assert.deepEqual(fixture.buttons[1].classes, ["plan-status-action", "reopen"]);
});

test("rollback reconstruye la fila si el reporte se renderizo durante el guardado", async () => {
  const gate = deferredPromise();
  const fixture = loadPlanStatus({
    rows: ["op-1", "op-2"],
    reportStatus: "PENDIENTES",
    operations: [
      { id: "op-1", ot: "100", planStatus: "PENDIENTE", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
      { id: "op-2", ot: "100", planStatus: "PENDIENTE", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
    ],
    callAppsScript: () => gate.promise,
  });

  const result = fixture.api.toggleOperationPlanStatus("op-1");
  assert.deepEqual(fixture.visibleReportKeys(), ["op-2"]);
  fixture.rerenderReport();
  assert.deepEqual(fixture.visibleReportKeys(), ["op-2"]);

  gate.reject(new Error("sin conexion"));
  assert.equal(await result, false);

  assert.deepEqual(fixture.visibleReportKeys(), ["op-1", "op-2"]);
  assert.equal(fixture.reportRenderCount(), 2);
  assert.match(fixture.els.operatorReportCount.textContent, /^2 de 2 .* max\. 25$/);
});

test("reabrir limpia fechas y retira solo su fila del reporte completado", async () => {
  const fixture = loadPlanStatus({
    rows: ["op-1", "op-2"],
    reportStatus: "COMPLETADAS",
    operations: [
      { id: "op-1", ot: "100", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
      { id: "op-2", ot: "100", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
    ],
    operationPlanStatuses: {
      "op-1": { key: "op-1", status: "COMPLETADA_PLAN" },
      "op-2": { key: "op-2", status: "COMPLETADA_PLAN" },
    },
    callAppsScript: async () => ({ revision: 2 }),
  });

  assert.equal(await fixture.api.toggleOperationPlanStatus("op-1"), true);

  assert.equal(fixture.state.operations[0].fechaInicio, "");
  assert.equal(fixture.state.operations[0].fechaFin, "");
  assert.equal(fixture.reportRows[0].removed, true);
  assert.equal(fixture.reportRows[1].removed, false);
  assert.equal(fixture.els.operatorReportCount.textContent, "1 de 1 · max. 25");
});

test("dos clics rapidos comparten guardado y deshabilitan controles de la misma operacion", async () => {
  const gate = deferredPromise();
  let calls = 0;
  const fixture = loadPlanStatus({
    rows: ["op-1"],
    buttonKeys: ["op-1", "op-1"],
    operations: [{ id: "op-1", ot: "100", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" }],
    callAppsScript: () => { calls += 1; return gate.promise; },
  });
  fixture.api.bindPlanStatusActions({ querySelectorAll: () => fixture.buttons });

  const first = fixture.buttons[0].listener();
  const second = fixture.buttons[1].listener();

  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(fixture.state.operationPlanStatuses["op-1"].status, "COMPLETADA_PLAN");
  assert.deepEqual(fixture.buttons.map((button) => button.disabled), [true, true]);

  gate.resolve({ revision: 2 });
  assert.equal(await first, true);
  assert.deepEqual(fixture.buttons.map((button) => button.disabled), [false, false]);
});

test("las fotos de prioridad y cola usan carga diferida nativa", () => {
  assert.match(appSource, /<img loading="lazy" src="\$\{escapeHtml\(job\.photoUrl\)\}"[^>]*data-backlog-photo/);
  assert.match(appSource, /<img loading="lazy" src="\$\{escapeHtml\(job\.photoUrl\)\}"[^>]*data-queue-photo/);
});

test("seleccionar Borrador alinea Cargas con la semana realmente programada", async () => {
  const state = { loadWeekStart: "2026-06-29", planStart: "2026-08-03" };
  let renders = 0;
  const loadSelectedPlanSnapshot = async (snapshotId) => {
    assert.equal(snapshotId, "draft");
    state.loadWeekStart = "2026-08-03";
    renders += 1;
  };
  const loadSelectedLoadPlan = Function(
    "state", "scheduledPlanWindowStart", "normalizeWeekStartValue", "formatDate", "renderLoads", "loadSelectedPlanSnapshot",
    `let loadSnapshot = { snapshotId: "anterior" };
     ${loadSourceSelectionSource}
     return loadSelectedLoadPlan;`,
  )(
    state,
    () => new Date(2026, 7, 3),
    (value) => String(value),
    (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    () => { renders += 1; },
    loadSelectedPlanSnapshot,
  );

  await loadSelectedLoadPlan("draft");

  assert.equal(state.loadWeekStart, "2026-08-03");
  assert.equal(renders, 1);
});

test("el cliente conserva un segundo en la duracion ajustada solo con la marca de fallback", () => {
  assert.match(adjustedProductionSource, /if \(op\?\.tiempoFallback === true\) return production;/);
  assert.match(adjustedProductionSource, /return Math\.ceil\(production \* \(2 - efficiency \/ 100\) \* 100 \/ performance\);/);
});

test("dos solicitudes simultaneas de una OT comparten una sola llamada individual", async () => {
  const gate = deferredPromise();
  let calls = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: { workOrders: [{ ot: "2773" }] },
    callAppsScript: async (method, ot) => {
      assert.equal(method, "getPlanningWorkOrderData");
      assert.equal(ot, "2773");
      calls += 1;
      return gate.promise;
    },
  });

  const first = fixture.context.ensureWorkOrderPlanningData("2773");
  const second = fixture.context.ensureWorkOrderPlanningData("2773");
  assert.strictEqual(first, second);
  assert.equal(calls, 1);

  gate.resolve({ ok: true, data: { workOrder: { ot: "2773" }, operations: [{ id: "2773-1", ot: "2773", ct: "CORTE", tiempoProd: 10 }], materials: [] } });
  assert.deepEqual(plain(await Promise.all([first, second])), [
    { ready: true, source: "remote" },
    { ready: true, source: "remote" },
  ]);
});

test("las filas validas existentes no sustituyen la primera carga directa de la sesion", async () => {
  let calls = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773" }],
      operations: [{ id: "sync-2773-1", ot: "2773", ct: "5458", tiempoProd: 10 }],
    },
    callAppsScript: async () => {
      calls += 1;
      return { ok: true, data: { workOrder: { ot: "2773" }, operations: [{ id: "direct-2773-1", ot: "2773", ct: "5458", tiempoProd: 12 }], materials: [] } };
    },
  });

  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "cached" });
  assert.equal(calls, 1);
  assert.deepEqual(plain(fixture.state.operations.map((operation) => operation.id)), ["direct-2773-1"]);
});

test("una ruta eliminada despues de configurar la matriz se vuelve a consultar", async () => {
  let calls = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: { workOrders: [{ ot: "2773" }] },
    callAppsScript: async () => {
      calls += 1;
      return {
        ok: true,
        data: {
          workOrder: { ot: "2773" },
          operations: [{ id: `direct-2773-${calls}`, ot: "2773", ct: "5458", tiempoProd: 12 }],
          materials: [],
        },
      };
    },
  });

  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  fixture.state.operations = [];
  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  assert.equal(calls, 2);
  assert.deepEqual(plain(fixture.state.operations.map((operation) => operation.id)), ["direct-2773-2"]);
});

test("la sincronizacion conserva la ruta de la OT cuyo detalle esta abierto", () => {
  const state = {
    selectedOts: [],
    selectedDetailOt: "1325",
    selectedOperationId: "direct-1325-1",
    operations: [
      { id: "direct-1325-1", ot: "1325" },
      { id: "old-2001-1", ot: "2001" },
    ],
    materials: [],
  };
  const selectedJobOt = Function(
    "state", "materialOtKey", "getPriorityJobs", "findOperation",
    `${selectedJobOtSource}; return selectedJobOt;`,
  )(
    state,
    String,
    () => [{ ot: "1325", firstOp: state.operations[0] }],
    (id) => state.operations.find((operation) => operation.id === id),
  );
  const applyNetSuitePlanningPayload = Function(
    "state", "normalizeKey", "selectedJobOt", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow",
    `${applyPlanningPayloadSource}; return applyNetSuitePlanningPayload;`,
  )(state, String, selectedJobOt, () => {}, () => {});

  applyNetSuitePlanningPayload({
    operations: [{ id: "fresh-2001-1", ot: "2001" }],
    materials: [],
  });

  assert.deepEqual(state.operations.map((operation) => operation.id), ["direct-1325-1", "fresh-2001-1"]);
  assert.equal(state.selectedOperationId, "direct-1325-1");
});

test("la sincronizacion de OTs no rehidrata selectedOts desde metadata remota obsoleta", () => {
  const state = {
    selectedOts: ["200"], lockedOts: ["200"], expandedOts: ["200"],
    lastSchedule: { scheduledOts: ["200"] },
    workOrders: [{ ot: "100" }, { ot: "200" }],
  };
  const applyNetSuiteWorkOrdersPayload = Function(
    "state", "window", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow",
    `${applyWorkOrdersPayloadSource}; return applyNetSuiteWorkOrdersPayload;`,
  )(state, {
    PlanningWorkflowCore: {
      pruneDraftToOpenWorkOrders: (draft, workOrders) => {
        const open = new Set(workOrders.map((item) => item.ot));
        const keep = (ot) => open.has(ot);
        return {
          ...draft,
          selectedOts: draft.selectedOts.filter(keep),
          lockedOts: draft.lockedOts.filter(keep),
          expandedOts: draft.expandedOts.filter(keep),
          lastSchedule: { ...draft.lastSchedule, scheduledOts: draft.lastSchedule.scheduledOts.filter(keep) },
        };
      },
    },
  }, () => {}, () => {});

  applyNetSuiteWorkOrdersPayload({ selectedOts: ["100", "200"], workOrders: [{ ot: "100" }, { ot: "200" }] });

  assert.deepEqual(state.selectedOts, ["200"]);
  assert.deepEqual(state.lastSchedule.scheduledOts, ["200"]);
});

test("la sincronizacion de OTs retira cerradas sin reactivar las devueltas a backlog", () => {
  const state = {
    selectedOts: ["200", "300"], lockedOts: ["200"], expandedOts: ["200", "300"],
    lastSchedule: { scheduledOts: ["200", "300"] },
    workOrders: [{ ot: "100" }, { ot: "200" }, { ot: "300" }],
  };
  const applyNetSuiteWorkOrdersPayload = Function(
    "state", "window", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow",
    `${applyWorkOrdersPayloadSource}; return applyNetSuiteWorkOrdersPayload;`,
  )(state, {
    PlanningWorkflowCore: {
      pruneDraftToOpenWorkOrders: (draft, workOrders) => {
        const open = new Set(workOrders.map((item) => item.ot));
        const keep = (ot) => open.has(ot);
        return {
          ...draft,
          selectedOts: draft.selectedOts.filter(keep),
          lockedOts: draft.lockedOts.filter(keep),
          expandedOts: draft.expandedOts.filter(keep),
          lastSchedule: { ...draft.lastSchedule, scheduledOts: draft.lastSchedule.scheduledOts.filter(keep) },
        };
      },
    },
  }, () => {}, () => {});

  applyNetSuiteWorkOrdersPayload({ selectedOts: ["100", "200", "300"], workOrders: [{ ot: "100" }, { ot: "200" }] });

  assert.deepEqual(state.selectedOts, ["200"]);
  assert.deepEqual(state.lockedOts, ["200"]);
  assert.deepEqual(state.expandedOts, ["200"]);
  assert.deepEqual(state.lastSchedule.scheduledOts, ["200"]);
});

test("la navegacion manual desplaza el espacio de trabajo al inicio", () => {
  const scrolls = [];
  const workspace = { dataset: {} };
  const item = {
    dataset: { section: "plan-semanal", tab: "" },
    getAttribute: () => "#plan-semanal",
    classList: { toggle: () => {} },
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  const { applyInitialWorkspaceView } = Function(
    "window", "document", "els", "WORKSPACE_TITLES",
    `${workspaceViewSource}; return { applyInitialWorkspaceView, showWorkspaceView };`,
  )(
    { location: { hash: "#plan-semanal" }, scrollTo: (options) => scrolls.push(options) },
    {
      querySelector: (selector) => selector === ".workspace" ? workspace : null,
      querySelectorAll: () => [item],
    },
    { workspaceTitle: null },
    {},
  );

  applyInitialWorkspaceView({ scrollToTop: true });

  assert.deepEqual(scrolls, [{ top: 0, behavior: "auto" }]);
});

test("el arranque remoto conserva la OT de detalle y la operacion seleccionada", async () => {
  const state = { selectedDetailOt: "2773", selectedOperationId: "duplicada" };
  const renderOptions = [];
  const workspaceOptions = [];
  const loadAppStateInBackground = Function(
    "state", "loadAppSheetIfAvailable", "requestAnimationFrame", "syncReportFiltersToPlanWeekOrToday",
    "saveState", "render", "applyInitialWorkspaceView", "isAppsScriptRuntime", "syncNetSuiteInBackground",
    "loadPlanSnapshots", "purgeClosedWorkOrderRetention",
    `${startupSource}; return loadAppStateInBackground;`,
  )(
    state,
    async () => {
      state.selectedDetailOt = "remota";
      state.selectedOperationId = "remota";
      return true;
    },
    (callback) => callback(),
    () => {},
    () => {},
    (options) => renderOptions.push(options),
    (options) => workspaceOptions.push(options),
    () => false,
    () => {},
    () => Promise.resolve(null),
    () => {},
  );

  await loadAppStateInBackground();

  assert.equal(state.selectedDetailOt, "2773");
  assert.equal(state.selectedOperationId, "duplicada");
  assert.deepEqual(renderOptions, [{ save: false }]);
  assert.deepEqual(plain(workspaceOptions), [{ scrollToTop: false }]);
});

test("el arranque optimizado conserva la OT de detalle y la operacion seleccionada", async () => {
  const workspaceOptions = [];
  const fixture = loadClient({
    state: {
      revision: 1,
      selectedDetailOt: "2773",
      selectedOperationId: "duplicada",
      operations: [],
      workOrders: [],
    },
    callAppsScript: async () => ({
      revision: 2,
      selectedOperationId: "remota",
      operations: [],
      workOrders: [],
      materials: [],
    }),
  });
  fixture.context.window.PPAppsScriptBridge.isConfigured = () => false;
  fixture.context.applyInitialWorkspaceView = (options) => workspaceOptions.push(options);

  await fixture.context.loadAppStateInBackground();

  assert.equal(fixture.state.selectedDetailOt, "2773");
  assert.equal(fixture.state.selectedOperationId, "duplicada");
  assert.deepEqual(plain(workspaceOptions), [{ scrollToTop: false }]);
});

test("undo limpia juntas la OT de detalle y la operacion restaurada", () => {
  const previous = { selectedDetailOt: "1325", selectedOperationId: "duplicada" };
  const fixture = Function(
    "initialState", "history", "structuredClone", "normalizeState", "saveAndRender",
    `let state = initialState; let stateHistory = history; ${undoSource};
     return { undoLastChange, getState: () => state };`,
  )(
    { selectedDetailOt: "2773", selectedOperationId: "duplicada" },
    [previous],
    structuredClone,
    () => {},
    () => {},
  );

  fixture.undoLastChange();

  assert.equal(fixture.getState().selectedDetailOt, "");
  assert.equal(fixture.getState().selectedOperationId, "");
});

test("undo optimizado limpia juntas la OT de detalle y la operacion restaurada", () => {
  const fixture = loadClient({
    state: {
      selectedDetailOt: "1325",
      selectedOperationId: "duplicada",
      operations: [],
      workOrders: [],
    },
  });
  fixture.context.normalizeState = () => {};
  fixture.context.saveAndRender = () => {};
  fixture.context.checkpointState();
  fixture.state.selectedDetailOt = "2773";
  fixture.state.selectedOperationId = "otra-duplicada";

  fixture.context.undoLastChange();

  assert.equal(fixture.state.selectedDetailOt, "");
  assert.equal(fixture.state.selectedOperationId, "");
});

test("la fusion directa conserva el detalle seleccionado por OT cuando reemplaza un marcador", async () => {
  const fixture = loadClient({
    installDetailOperations: true,
    state: {
      workOrders: [{ ot: "2773" }],
      selectedOperationId: "wo-placeholder-2773",
      operations: [],
    },
    callAppsScript: async () => ({
      ok: true,
      data: {
        workOrder: { ot: "2773" },
        operations: [{ id: "direct-2773-10", ot: "2773", ct: "5458", tiempoProd: 12 }],
        materials: [],
      },
    }),
  });
  fixture.context.getSelectedPriorityJob = () => ({ ot: "2773" });

  const result = await fixture.context.loadSelectedJobDetailOperations("2773");

  assert.deepEqual(plain(result), { ready: true, source: "remote" });
  assert.equal(fixture.state.selectedOperationId, "direct-2773-10");
  assert.equal(fixture.state.operations.find((operation) => operation.id === fixture.state.selectedOperationId)?.ot, "2773");
});

test("la fusion directa actualiza la ruta y conserva campos locales de una OT planeada", () => {
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773" }],
      selectedOperationId: "planned-2773-10",
      operations: [{
        id: "planned-2773-10", ot: "2773", secuencia: 10, ct: "5458", descripcion: "CORTE LOCAL",
        tiempoProd: 8, cantTotal: 5, cantPendiente: 5, fechaReq: "2026-08-01",
        fechaInicio: "2026-07-30", horaInicio: "08:00", fechaFin: "2026-07-30", horaFin: "09:00",
        operador: "OPERADOR LOCAL", maquina: "DOB-01", herramental: "H-18", kitHerramental: "K-18",
        locked: true, planStatus: "COMPLETADA_PLAN", estatus: "COMPLETADA", log: "PLAN_LOCAL", customPlanning: "CONSERVAR",
      }],
    },
  });

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2773" },
      operations: [{
        id: "direct-2773-10", ot: "2773", secuencia: 10, ct: "5458", descripcion: "CORTE NETSUITE",
        tiempoProd: 15, cantTotal: 9, cantPendiente: 7, fechaReq: "2026-08-15",
      }],
      materials: [],
    },
  }, "2773");

  assert.equal(merged, true);
  assert.equal(fixture.state.selectedOperationId, "planned-2773-10");
  assert.deepEqual(plain(fixture.state.operations), [{
    id: "direct-2773-10", ot: "2773", secuencia: 10, ct: "5458", descripcion: "CORTE NETSUITE",
    tiempoProd: 15, cantTotal: 9, cantPendiente: 7, fechaReq: "2026-08-15",
    fechaInicio: "2026-07-30", horaInicio: "08:00", fechaFin: "2026-07-30", horaFin: "09:00",
    operador: "OPERADOR LOCAL", maquina: "DOB-01", herramental: "H-18", kitHerramental: "K-18",
    locked: true, planStatus: "COMPLETADA_PLAN", estatus: "COMPLETADA", log: "PLAN_LOCAL", customPlanning: "CONSERVAR",
  }]);
});

test("cambiar de OT durante una carga directa no cambia la seleccion actual", async () => {
  const gate = deferredPromise();
  let selectedOt = "A";
  const fixture = loadClient({
    installDetailOperations: true,
    state: {
      selectedOperationId: "placeholder-A",
      workOrders: [{ ot: "A" }, { ot: "B" }],
      operations: [{ id: "selected-B", ot: "B", secuencia: 10, ct: "5458", tiempoProd: 10 }],
    },
    callAppsScript: async () => gate.promise,
  });
  fixture.context.getSelectedPriorityJob = () => ({ ot: selectedOt });

  const request = fixture.context.loadSelectedJobDetailOperations("A");
  await settleMicrotasks();
  selectedOt = "B";
  fixture.state.selectedOperationId = "selected-B";
  gate.resolve({
    ok: true,
    data: { workOrder: { ot: "A" }, operations: [{ id: "direct-A-10", ot: "A", secuencia: 10, ct: "5458", tiempoProd: 12 }], materials: [] },
  });
  await request;

  assert.equal(fixture.state.selectedOperationId, "selected-B");
  assert.equal(fixture.state.operations.find((operation) => operation.id === "direct-A-10")?.ot, "A");
});

test("la respuesta tardia no cambia el detalle de la OT abierta despues", async () => {
  const pending = new Map([["1325", deferredPromise()], ["2773", deferredPromise()]]);
  const fixture = loadClient({
    installDetailOperations: true,
    installDetailSelection: true,
    state: {
      selectedOperationId: "direct-1325-1",
      expandedOts: [],
      operations: [{ id: "direct-1325-1", ot: "1325" }, { id: "direct-2773-1", ot: "2773" }],
      workOrders: [{ ot: "1325" }, { ot: "2773" }],
    },
    callAppsScript: async (_method, ot) => pending.get(ot).promise,
  });
  fixture.context.getPriorityJobs = () => [
    { ot: "1325", firstOp: { id: "direct-1325-1" } },
    { ot: "2773", firstOp: { id: "direct-2773-1" } },
  ];
  fixture.context.findOperation = (id) => fixture.state.operations.find((operation) => operation.id === id) || null;
  fixture.context.uniq = (items) => [...new Set(items)];

  fixture.context.openSelectedJobDetail("1325");
  const first = fixture.context.loadSelectedJobDetailOperations("1325");
  fixture.context.openSelectedJobDetail("2773");
  const second = fixture.context.loadSelectedJobDetailOperations("2773");
  assert.equal(fixture.state.selectedDetailOt, "2773");
  assert.equal(fixture.context.getSelectedPriorityJob().ot, "2773");

  pending.get("2773").resolve({
    ok: true,
    data: { workOrder: { ot: "2773" }, operations: [{ id: "direct-2773-1", ot: "2773", ct: "5458", tiempoProd: 12 }], materials: [] },
  });
  await second;
  pending.get("1325").resolve({
    ok: true,
    data: { workOrder: { ot: "1325" }, operations: [{ id: "direct-1325-1", ot: "1325", ct: "5458", tiempoProd: 12 }], materials: [] },
  });
  await first;

  assert.equal(fixture.state.selectedDetailOt, "2773");
  assert.equal(fixture.state.selectedOperationId, "direct-2773-1");
});

test("la OT explicita resuelve IDs de operacion duplicados y el estado legacy conserva la inferencia anterior", () => {
  const fixture = loadClient({
    installDetailSelection: true,
    state: {
      selectedDetailOt: "2773",
      selectedOperationId: "duplicada",
      operations: [{ id: "duplicada", ot: "1325" }, { id: "duplicada", ot: "2773" }],
    },
  });
  fixture.context.getPriorityJobs = () => [
    { ot: "1325", firstOp: { id: "duplicada" } },
    { ot: "2773", firstOp: { id: "duplicada" } },
  ];
  fixture.context.findOperation = (id) => fixture.state.operations.find((operation) => operation.id === id) || null;

  assert.equal(fixture.context.getSelectedPriorityJob().ot, "2773");
  assert.equal(fixture.context.selectedJobOt(), "2773");

  delete fixture.state.selectedDetailOt;
  assert.equal(fixture.context.getSelectedPriorityJob().ot, "1325");
  assert.equal(fixture.context.selectedJobOt(), "1325");
});

test("cerrar el detalle limpia la OT y la operacion seleccionada", () => {
  const match = appSource.match(/els\.closeDetailPanelBtn\.addEventListener\("click", \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(match);
  const state = { selectedDetailOt: "2773", selectedOperationId: "duplicada" };
  const close = Function("state", "saveState", "render", `return () => {${match[1]}};`)(
    state,
    () => {},
    () => {},
  );

  close();

  assert.equal(state.selectedDetailOt, "");
  assert.equal(state.selectedOperationId, "");
});

test("abrir el detalle carga operaciones sin perder la seleccion", () => {
  assert.match(detailSelectionSource, /renderSelectedJobPanel\(\);\s*void loadSelectedJobDetailOperations\(ot\)/);
  assert.match(detailOperationsSource, /ensureWorkOrderPlanningData\(ot\)/);
  assert.match(detailOperationsSource, /renderSelectedJobPanel\(\)/);
});

test("dos aperturas del detalle comparten la carga y muestran las operaciones fusionadas", async () => {
  const gate = deferredPromise();
  let calls = 0;
  let selectedOt = "2773";
  const renders = [];
  let mergedOperations = [];
  const fixture = loadClient({
    installDetailOperations: true,
    callAppsScript: async () => { calls += 1; return gate.promise; },
  });
  fixture.context.ensureWorkOrderPlanningData = async (ot) => {
    calls += 1;
    await gate.promise;
    mergedOperations = [{ ot, descripcion: "CORTE" }];
    return { ready: true, source: "remote" };
  };
  fixture.context.getSelectedPriorityJob = () => ({ ot: selectedOt });
  fixture.context.materialOtKey = (value) => String(value || "");
  fixture.context.renderSelectedJobPanel = () => renders.push(mergedOperations.map((op) => op.descripcion));

  const first = fixture.context.loadSelectedJobDetailOperations("2773");
  const second = fixture.context.loadSelectedJobDetailOperations("2773");
  assert.strictEqual(first, second);
  await settleMicrotasks();
  assert.equal(calls, 1);
  gate.resolve();
  await first;

  assert.deepEqual(renders, [[], ["CORTE"]]);
});

test("un error del detalle conserva las operaciones existentes", async () => {
  const rows = [{ id: "2773-1", ot: "2773", ct: "", tiempoProd: 0 }];
  const toasts = [];
  const loadingStates = [];
  const fixture = loadClient({
    installDetailOperations: true,
    state: { operations: structuredClone(rows), workOrders: [{ ot: "2773" }] },
    callAppsScript: async () => ({ ok: false, error: "backend fuera de linea" }),
  });
  fixture.context.isAppsScriptRuntime = () => true;
  fixture.context.getSelectedPriorityJob = () => ({ ot: "2773" });
  fixture.context.materialOtKey = (value) => String(value || "");
  fixture.context.renderSelectedJobPanel = () => { loadingStates.push(fixture.context.isSelectedJobDetailOperationLoading("2773")); };
  fixture.context.showToast = (message) => toasts.push(message);

  await fixture.context.loadSelectedJobDetailOperations("2773");

  assert.deepEqual(plain(fixture.state.operations), rows);
  assert.deepEqual(loadingStates, [true, false]);
  assert.deepEqual(toasts, ["backend fuera de linea"]);
});

test("la seleccion individual bloquea solo su tarjeta y libera el estado ocupado en finally", () => {
  assert.match(individualSelectionSource, /const card = Array\.from\(els\.priorityList\.querySelectorAll\("\.priority-card"\)\)[\s\S]*item\.dataset\.ot === ot/);
  assert.match(individualSelectionSource, /card\.setAttribute\("aria-busy", "true"\)/);
  assert.match(individualSelectionSource, /addButton\.disabled = true/);
  assert.match(individualSelectionSource, /card\.removeAttribute\("aria-busy"\)/);
  assert.match(individualSelectionSource, /addButton\.disabled = false/);
  assert.match(individualSelectionSource, /const loaded = await ensureWorkOrderPlanningData\(ot\)/);
  assert.match(individualSelectionSource, /if \(!loaded\?\.ready\)[\s\S]*return;/);
  assert.match(individualSelectionSource, /finally \{[\s\S]*setIndividualPlanningBusy\(ot, false\)/);
});

test("una consulta individual libera la tarjeta y no agrega la OT cuando falla", async () => {
  const changes = [];
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    querySelector: () => addButton,
    setAttribute: () => changes.push("busy"),
    removeAttribute: () => changes.push("ready"),
  };
  const state = { selectedOts: [] };
  const toasts = [];
  const selectJob = loadIndividualSelection({
    jobs: { value: [{ ot: "100", movable: true, ops: [] }] },
    loaded: async () => ({ ready: false, error: "backend fuera de linea" }), card, state, toasts,
  });

  await selectJob("100", true);

  assert.deepEqual(changes, ["busy", "ready"]);
  assert.equal(addButton.disabled, false);
  assert.deepEqual(state.selectedOts, []);
  assert.deepEqual(toasts, ["backend fuera de linea"]);
});

test("una consulta individual libera la tarjeta al agregar la OT con operaciones validas", async () => {
  const changes = [];
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    querySelector: () => addButton,
    setAttribute: () => changes.push("busy"),
    removeAttribute: () => changes.push("ready"),
  };
  const jobs = { value: [{ ot: "100", movable: true, ops: [] }] };
  const state = { selectedOts: [] };
  const selectJob = loadIndividualSelection({
    jobs,
    loaded: async () => {
      jobs.value = [{ ot: "100", movable: true, ops: [{ id: "op-1" }] }];
      return { ready: true };
    },
    card, state, toasts: [],
  });

  await selectJob("100", true);

  assert.deepEqual(changes, ["busy", "ready"]);
  assert.equal(addButton.disabled, false);
  assert.deepEqual(state.selectedOts, ["100"]);
});

test("una consulta individual agrega la OT aunque el folio remoto llegue numerico", async () => {
  const card = {
    dataset: { ot: "2773" },
    querySelector: () => ({ disabled: false }),
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  const state = { selectedOts: [] };
  const jobs = { value: [{ ot: "2773", movable: true, ops: [] }] };
  const toasts = [];
  const selectJob = loadIndividualSelection({
    jobs,
    loaded: async () => {
      jobs.value = [{ ot: 2773, movable: true, ops: [{ id: "op-1" }] }];
      return { ready: true };
    },
    card, state, toasts,
  });

  await selectJob("2773", true);

  assert.deepEqual(state.selectedOts, ["2773"]);
  assert.deepEqual(toasts, ["OT 2773 agregada al plan"]);
});

test("la fusion individual reemplaza solo la OT solicitada y conserva las demas", () => {
  let cacheInvalidations = 0;
  let backlogResets = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      operations: [{ id: "old-2773", ot: "2773" }, { id: "keep-2001", ot: "2001", fechaInicio: "2026-07-01" }],
      materials: [{ ot: "2773", component: "OLD" }, { ot: "2001", component: "KEEP" }],
      workOrders: [
        {
          ot: "2773",
          item: "OLD",
          dueDateOverride: "2026-08-01",
          photoUrl: "local.jpg",
          averageSalePrice: 123,
          localTag: "KEEP_LOCAL",
        },
        { ot: "2001", item: "KEEP" },
      ],
    },
    invalidateCurrentPlanOperationsCache: () => { cacheInvalidations += 1; },
    resetBacklogWindow: () => { backlogResets += 1; },
  });

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2773", item: "NEW" },
      operations: [
        { id: "new-2773", ot: "2773", ct: "CORTE", tiempoProd: 10 },
        { id: "unexpected-2001", ot: "2001", ct: "DOBLEZ", tiempoProd: 20 },
      ],
      materials: [{ ot: "2773", component: "NEW" }, { ot: "2001", component: "UNEXPECTED" }],
    },
  }, "2773");

  assert.equal(merged, true);
  assert.deepEqual(plain(fixture.state.operations), [
    { id: "keep-2001", ot: "2001", fechaInicio: "2026-07-01" },
    { id: "new-2773", ot: "2773", ct: "CORTE", tiempoProd: 10 },
  ]);
  assert.deepEqual(plain(fixture.state.materials), [{ ot: "2001", component: "KEEP" }, { ot: "2773", component: "NEW" }]);
  assert.deepEqual(plain(fixture.state.workOrders), [
    { ot: "2001", item: "KEEP" },
    {
      ot: "2773",
      item: "NEW",
      dueDateOverride: "2026-08-01",
      photoUrl: "local.jpg",
      averageSalePrice: 123,
      localTag: "KEEP_LOCAL",
    },
  ]);
  assert.equal(cacheInvalidations, 1);
  assert.equal(backlogResets, 1);
});

test("la ruta individual agrega sus operaciones programables al catalogo de la matriz", () => {
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2889", item: "COPLE 1 AMC" }],
      operations: [],
      operationCatalog: [{ key: "5514::10C_CORTE_DE_DIMENSION", ct: "5514", label: "10C: CORTE DE DIMENSION", active: true }],
    },
  });

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2889", item: "COPLE 1 AMC" },
      operations: [
        { id: "2889-120c", ot: "2889", ct: "5527", descripcion: "120C: DOBLADO", tiempoProd: 22 },
        { id: "2889-sub", ot: "2889", ct: "6462", descripcion: "500: SUBCONTRATO", tiempoProd: 10 },
      ],
      materials: [],
    },
  }, "2889");

  assert.equal(merged, true);
  assert.deepEqual(
    plain(fixture.state.operationCatalog.map((item) => item.key)),
    ["5514::10C_CORTE_DE_DIMENSION", "5527::120C:_DOBLADO"],
  );
});

test("una OT con operaciones incompletas consulta backend", async () => {
  let calls = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773" }],
      operations: [
        { id: "sin-datos", ot: "2773" },
        { id: "sin-ct", ot: "2773", ct: "SIN_CT", tiempoProd: 10 },
        { id: "sin-tiempo", ot: "2773", ct: "CORTE", tiempoProd: 0 },
      ],
    },
    callAppsScript: async () => {
      calls += 1;
      return { ok: true, data: { workOrder: { ot: "2773" }, operations: [{ id: "2773-1", ot: "2773", ct: "CORTE", tiempoProd: 10 }], materials: [] } };
    },
  });

  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  assert.equal(calls, 1);
});

test("una OT con ruta mixta consulta backend aunque tenga una operacion valida", async () => {
  let calls = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773" }],
      operations: [
        { id: "valida", ot: "2773", ct: "CORTE", tiempoProd: 10 },
        { id: "invalida", ot: "2773", ct: "DOBLEZ", tiempoProd: 0 },
      ],
    },
    callAppsScript: async () => {
      calls += 1;
      return {
        ok: true,
        data: {
          workOrder: { ot: "2773" },
          operations: [{ id: "remota", ot: "2773", ct: "CORTE", tiempoProd: 20 }],
          materials: [],
        },
      };
    },
  });

  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  assert.equal(calls, 1);
});

test("una fusion normaliza tiempos invalidos y conserva tiempos validos", () => {
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773", item: "LOCAL" }],
      operations: [{ id: "old-valid", ot: "2773", secuencia: 50, ct: "SOLDADURA", tiempoProd: 1 / 60, tiempoFallback: true }],
      materials: [{ ot: "2773", component: "LOCAL" }],
    },
  });

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2773", item: "REMOTE" },
      operations: [
        { id: "missing", ot: "2773", ct: "CORTE" },
        { id: "zero", ot: "2773", ct: "DOBLEZ", tiempoProd: 0 },
        { id: "negative", ot: "2773", ct: "PINTURA", tiempoProd: -2 },
        { id: "invalid", ot: "2773", ct: "LASER", tiempoProd: "no numerico" },
        { id: "valid", ot: "2773", ct: "SOLDADURA", tiempoProd: 10 },
      ],
      materials: [{ ot: "2773", component: "REMOTE" }],
    },
  }, "2773");

  assert.equal(merged, true);
  assert.deepEqual(
    plain(fixture.state.operations.map((operation) => operation.tiempoProd)),
    [1 / 60, 1 / 60, 1 / 60, 1 / 60, 10],
  );
  assert.deepEqual(
    plain(fixture.state.operations.map((operation) => operation.tiempoFallback === true)),
    [true, true, true, true, false],
  );
});

test("una fusion agrega un work order normalizado cuando no existe localmente", () => {
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2001", item: "KEEP" }],
      operations: [],
    },
  });

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2773", item: "NEW", quantity: 4, status: "En curso", rawField: "OMIT" },
      operations: [{ id: "valid", ot: "2773", ct: "CORTE", tiempoProd: 10 }],
      materials: [],
    },
  }, "2773");

  assert.equal(merged, true);
  assert.deepEqual(plain(fixture.state.workOrders), [
    { ot: "2001", item: "KEEP" },
    { ot: "2773", item: "NEW", quantity: 4, status: "En curso" },
  ]);
});

test("una respuesta tardia no pisa una ruta valida agregada durante la espera", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773", item: "LOCAL" }],
      operations: [],
      materials: [{ ot: "2773", component: "LOCAL" }],
    },
    callAppsScript: async () => gate.promise,
  });

  const request = fixture.context.ensureWorkOrderPlanningData("2773");
  fixture.state.operations.push({ id: "synced", ot: "2773", ct: "CORTE", tiempoProd: 30 });
  gate.resolve({
    ok: true,
    data: {
      workOrder: { ot: "2773", item: "REMOTE" },
      operations: [{ id: "late", ot: "2773", ct: "DOBLEZ", tiempoProd: 10 }],
      materials: [{ ot: "2773", component: "REMOTE" }],
    },
  });

  assert.deepEqual(plain(await request), { ready: true, source: "cached" });
  assert.deepEqual(plain(fixture.state.operations), [{ id: "synced", ot: "2773", ct: "CORTE", tiempoProd: 30 }]);
  assert.deepEqual(plain(fixture.state.workOrders), [{ ot: "2773", item: "LOCAL" }]);
  assert.deepEqual(plain(fixture.state.materials), [{ ot: "2773", component: "LOCAL" }]);
});

test("una respuesta directa tardia no pisa una sincronizacion nueva cuando ya habia ruta valida", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773", item: "LOCAL" }],
      operations: [{ id: "persisted", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 10 }],
      materials: [{ ot: "2773", component: "LOCAL" }],
    },
    callAppsScript: async () => gate.promise,
  });

  const request = fixture.context.ensureWorkOrderPlanningData("2773");
  fixture.state.operations = [{ id: "new-sync", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 30 }];
  gate.resolve({
    ok: true,
    data: {
      workOrder: { ot: "2773", item: "REMOTE" },
      operations: [{ id: "late-direct", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 12 }],
      materials: [{ ot: "2773", component: "REMOTE" }],
    },
  });

  assert.deepEqual(plain(await request), { ready: true, source: "cached" });
  assert.deepEqual(plain(fixture.state.operations), [{ id: "new-sync", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 30 }]);
  assert.deepEqual(plain(fixture.state.workOrders), [{ ot: "2773", item: "LOCAL" }]);
  assert.deepEqual(plain(fixture.state.materials), [{ ot: "2773", component: "LOCAL" }]);
});

test("una respuesta directa tardia no pisa cambios de OT aunque la ruta siga igual", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773", quantity: 10, status: "En curso" }],
      operations: [{ id: "persisted", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 10 }],
      materials: [{ ot: "2773", component: "LOCAL", pending: 10 }],
    },
    callAppsScript: async () => gate.promise,
  });

  const request = fixture.context.ensureWorkOrderPlanningData("2773");
  fixture.state.workOrders = [{ ot: "2773", quantity: 7, status: "Programada" }];
  gate.resolve({
    ok: true,
    data: { workOrder: { ot: "2773", quantity: 2, status: "REMOTE" }, operations: [{ id: "late", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 12 }], materials: [{ ot: "2773", component: "REMOTE" }] },
  });

  assert.deepEqual(plain(await request), { ready: true, source: "cached" });
  assert.deepEqual(plain(fixture.state.workOrders), [{ ot: "2773", quantity: 7, status: "Programada" }]);
  assert.deepEqual(plain(fixture.state.operations), [{ id: "persisted", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 10 }]);
  assert.deepEqual(plain(fixture.state.materials), [{ ot: "2773", component: "LOCAL", pending: 10 }]);
});

test("una respuesta directa tardia no pisa cambios de materiales aunque la ruta siga igual", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773", quantity: 10, status: "En curso" }],
      operations: [{ id: "persisted", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 10 }],
      materials: [{ ot: "2773", component: "LOCAL", pending: 10 }],
    },
    callAppsScript: async () => gate.promise,
  });

  const request = fixture.context.ensureWorkOrderPlanningData("2773");
  fixture.state.materials = [{ ot: "2773", component: "SYNC_NUEVO", pending: 4 }];
  gate.resolve({
    ok: true,
    data: { workOrder: { ot: "2773", quantity: 2 }, operations: [{ id: "late", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 12 }], materials: [{ ot: "2773", component: "REMOTE" }] },
  });

  assert.deepEqual(plain(await request), { ready: true, source: "cached" });
  assert.deepEqual(plain(fixture.state.workOrders), [{ ot: "2773", quantity: 10, status: "En curso" }]);
  assert.deepEqual(plain(fixture.state.operations), [{ id: "persisted", ot: "2773", secuencia: 10, ct: "CORTE", tiempoProd: 10 }]);
  assert.deepEqual(plain(fixture.state.materials), [{ ot: "2773", component: "SYNC_NUEVO", pending: 4 }]);
});

test("una respuesta tardia no reintroduce una OT eliminada durante la espera", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: { workOrders: [{ ot: "2773", item: "LOCAL" }], operations: [], materials: [] },
    callAppsScript: async () => gate.promise,
  });

  const request = fixture.context.ensureWorkOrderPlanningData("2773");
  fixture.state.workOrders = [];
  gate.resolve({
    ok: true,
    data: {
      workOrder: { ot: "2773", item: "REMOTE" },
      operations: [{ id: "late", ot: "2773", ct: "CORTE", tiempoProd: 10 }],
      materials: [],
    },
  });

  assert.deepEqual(plain(await request), { ready: false, error: "La OT 2773 ya no esta disponible" });
  assert.deepEqual(plain(fixture.state), { revision: 1, workOrders: [], operations: [], materials: [] });
});

test("dos acciones simultaneas de agregar una OT preparan y confirman una sola vez", async () => {
  const gate = deferredPromise();
  const changes = [];
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    querySelector: () => addButton,
    setAttribute: () => changes.push("busy"),
    removeAttribute: () => changes.push("ready"),
  };
  const jobs = { value: [{ ot: "100", movable: true, ops: [] }] };
  const state = { selectedOts: [] };
  let preparations = 0;
  let checkpoints = 0;
  const selectJob = loadIndividualSelection({
    jobs,
    loaded: async () => {
      await gate.promise;
      jobs.value = [{ ot: "100", movable: true, ops: [{ id: "op-1" }] }];
      return { ready: true };
    },
    prepare: async () => { preparations += 1; return true; },
    checkpoint: () => { checkpoints += 1; },
    card,
    state,
    toasts: [],
  });

  const first = selectJob("100", true);
  const second = selectJob("100", true);
  gate.resolve();
  await Promise.all([first, second]);

  assert.equal(preparations, 1);
  assert.equal(checkpoints, 1);
  assert.deepEqual(changes, ["busy", "ready"]);
  assert.deepEqual(state.selectedOts, ["100"]);
});

test("un cambio remoto a estatus no elegible durante la espera impide preparar y seleccionar", async () => {
  const gate = deferredPromise();
  const changes = [];
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    querySelector: () => addButton,
    setAttribute: () => changes.push("busy"),
    removeAttribute: () => changes.push("ready"),
  };
  const jobs = { value: [{ ot: "100", movable: true, programmed: false, status: "En curso", ops: [] }] };
  const state = { selectedOts: [] };
  const toasts = [];
  let preparations = 0;
  let checkpoints = 0;
  const selectJob = loadIndividualSelection({
    jobs,
    loaded: async () => {
      await gate.promise;
      jobs.value = [{
        ot: "100",
        movable: false,
        programmed: false,
        status: "Cerrada",
        ops: [{ id: "op-1" }],
      }];
      return { ready: true };
    },
    prepare: async () => { preparations += 1; return true; },
    checkpoint: () => { checkpoints += 1; },
    card,
    state,
    toasts,
  });

  const action = selectJob("100", true);
  gate.resolve();
  await action;

  assert.equal(preparations, 0);
  assert.equal(checkpoints, 0);
  assert.deepEqual(state.selectedOts, []);
  assert.deepEqual(toasts, ["OT 100 no puede agregarse al plan por estatus Cerrada"]);
  assert.deepEqual(changes, ["busy", "ready"]);
});

test("una tarjeta aria-busy no puede iniciar drag", () => {
  const canStartBacklogDrag = new Function(`${individualSelectionSource}; return canStartBacklogDrag;`)();
  const card = { getAttribute: (name) => name === "aria-busy" ? "true" : null };
  const job = { movable: true };
  const event = { button: 0, target: { closest: () => null } };

  assert.equal(canStartBacklogDrag(card, job, event), false);
});

test("un error o respuesta no valida libera la solicitud individual para reintentar", async () => {
  let calls = 0;
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: { workOrders: [{ ot: "2773" }] },
    callAppsScript: async () => {
      calls += 1;
      if (calls === 1) throw new Error("backend fuera de linea");
      if (calls === 2) return { ok: false, error: "sin operaciones" };
      return { ok: true, data: { workOrder: { ot: "2773" }, operations: [{ id: "2773-1", ot: "2773", ct: "CORTE", tiempoProd: 10 }], materials: [] } };
    },
  });

  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: false, error: "backend fuera de linea" });
  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: false, error: "sin operaciones" });
  assert.deepEqual(plain(await fixture.context.ensureWorkOrderPlanningData("2773")), { ready: true, source: "remote" });
  assert.equal(calls, 3);
});

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

test("la sincronizacion manual ligera usa el contrato completo y guarda una vez sin dialogos", async () => {
  const calls = [];
  const timeouts = [];
  let dialogs = 0;
  let reconciliations = 0;
  let purges = 0;
  const renders = [];
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    state: {
      workOrders: [{ ot: "WO-CERRADA", item: "CERRADA" }],
      operations: [{ id: "done", ot: "WO-CERRADA", status: "COMPLETADA_PLAN" }],
      materials: [{ ot: "WO-CERRADA", component: "MAT" }],
    },
    withTimeout: (promise, timeoutMs) => {
      timeouts.push(timeoutMs);
      return promise;
    },
    reconcileActiveWorkOrders: (current, incoming) => {
      reconciliations += 1;
      return {
        ...current,
        workOrders: incoming,
        operations: current.operations.filter((operation) => operation.status === "COMPLETADA_PLAN"),
        materials: [],
      };
    },
    purgeClosedWorkOrderRetention: (current) => {
      purges += 1;
      return {
        ...current,
        retentionPurged: true,
        closedWorkOrderSummaries: { "WO-CERRADA": { ot: "WO-CERRADA", finalStatus: "CERRADA" } },
      };
    },
    callAppsScript: async (method, payload) => {
      calls.push([method, payload]);
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA", item: "ACTIVA" }], syncedAt: "2026-08-01T00:00:00.000Z" };
      return { revision: 2 };
    },
    createAppSheetPayload: (source) => ({ ...plain(source), source: "plan-app-sheet", savedAt: "2026-08-01T00:00:00.000Z" }),
    render: (options) => renders.push(options),
  });
  fixture.context.openPlanningDialog = async () => { dialogs += 1; return {}; };

  await fixture.context.syncBacklogWorkOrders();

  assert.deepEqual(timeouts, [60000]);
  assert.equal(reconciliations, 2);
  assert.equal(purges, 2);
  assert.equal(dialogs, 0);
  assert.deepEqual(calls.map(([method]) => method), ["fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState"]);
  assert.deepEqual(plain(calls[1][1]), {
    revision: 1,
    workOrders: [{ ot: "WO-ACTIVA", item: "ACTIVA" }],
    operations: [{ id: "done", ot: "WO-CERRADA", status: "COMPLETADA_PLAN" }],
    operationPlanStatuses: {},
    otConfigurations: {},
    planningConfigByOt: {},
    preparedPlanningByOt: {},
    selectedOts: [],
    lockedOts: [],
    expandedOts: [],
    selectedOperationId: "",
    closedWorkOrderSummaries: { "WO-CERRADA": { ot: "WO-CERRADA", finalStatus: "CERRADA" } },
    lastSchedule: null,
    syncedAt: "2026-08-01T00:00:00.000Z",
    removedWorkOrderOts: ["WO-CERRADA"],
  });
  assert.deepEqual(plain(fixture.context.state.workOrders), [{ ot: "WO-ACTIVA", item: "ACTIVA" }]);
  assert.deepEqual(plain(fixture.context.state.operations), [{ id: "done", ot: "WO-CERRADA", status: "COMPLETADA_PLAN" }]);
  assert.deepEqual(plain(fixture.context.state.materials), []);
  assert.equal(fixture.context.state.retentionPurged, true);
  assert.equal(fixture.context.state.revision, 2);
  assert.deepEqual(plain(renders), [{ save: false }]);
  assert.deepEqual(fixture.busyStates, []);
  assert.deepEqual(fixture.backlogBusyStates, [true, false]);
});

test("una respuesta tardia de materiales no se fusiona cuando la OT se cerro", async () => {
  const materialResponse = deferredPromise();
  let materialCalls = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-1" }], materials: [] },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders, materials: current.materials }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      if (method === "getMaterialsForOt") {
        materialCalls += 1;
        return materialResponse.promise;
      }
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [] };
      return { revision: 2 };
    },
  });
  fixture.context.applyImported({
    revision: 1,
    workOrders: [{ ot: "WO-1" }],
    materials: [],
    performance: { deferred: { materials: true }, revision: 1 },
  });
  fixture.context.getSelectedPriorityJob = () => ({ ot: "WO-1" });
  fixture.context.selectedJobOt = () => "WO-1";

  fixture.context.renderSelectedJobPanel();
  await settleMicrotasks();
  assert.equal(materialCalls, 1);

  await fixture.context.syncBacklogWorkOrders();
  materialResponse.resolve({ materials: [{ ot: "WO-1", component: "TARDIO" }] });
  await settleMicrotasks();

  assert.deepEqual(plain(fixture.context.state.materials), []);
});

test("una OT reabierta vuelve a consultar sus materiales bajo demanda", async () => {
  let materialCalls = 0;
  let backlogCalls = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-1" }], materials: [] },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders, materials: current.materials }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      if (method === "getMaterialsForOt") {
        materialCalls += 1;
        return { materials: [{ ot: "WO-1", component: `MAT-${materialCalls}` }] };
      }
      if (method === "fetchNetSuiteWorkOrdersLite") {
        backlogCalls += 1;
        return { workOrders: backlogCalls === 1 ? [] : [{ ot: "WO-1" }] };
      }
      return { revision: 2 };
    },
  });
  fixture.context.applyImported({
    revision: 1,
    workOrders: [{ ot: "WO-1" }],
    materials: [],
    performance: { deferred: { materials: true }, revision: 1 },
  });
  fixture.context.getSelectedPriorityJob = () => ({ ot: "WO-1" });
  fixture.context.selectedJobOt = () => "WO-1";

  fixture.context.renderSelectedJobPanel();
  await settleMicrotasks();
  await fixture.context.syncBacklogWorkOrders();
  await fixture.context.syncBacklogWorkOrders();
  fixture.context.renderSelectedJobPanel();
  await settleMicrotasks();

  assert.equal(materialCalls, 2);
  assert.deepEqual(plain(fixture.context.state.materials), [{ ot: "WO-1", component: "MAT-2" }]);
});

test("un timeout de sincronizacion conserva materiales y su cache de una lista legacy", async () => {
  let materialCalls = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-1" }], materials: [] },
    withTimeout: async () => { throw new Error("timeout"); },
    reconcileActiveWorkOrders: (current) => current,
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      if (method === "getMaterialsForOt") {
        materialCalls += 1;
        return { materials: [{ ot: "WO-1", component: "CONSERVAR" }] };
      }
      return {};
    },
  });
  fixture.context.applyImported({
    revision: 1,
    workOrders: [{ ot: "WO-1" }],
    materials: [],
    performance: { deferred: { materials: true }, revision: 1 },
  });
  fixture.context.getSelectedPriorityJob = () => ({ ot: "WO-1" });
  fixture.context.selectedJobOt = () => "WO-1";

  fixture.context.renderSelectedJobPanel();
  await settleMicrotasks();
  fixture.context.state.workOrders = [];
  const beforeFailure = plain(fixture.context.state);

  await fixture.context.syncBacklogWorkOrders();
  fixture.context.renderSelectedJobPanel();
  await settleMicrotasks();

  assert.deepEqual(plain(fixture.context.state), beforeFailure);
  assert.equal(materialCalls, 1);
});

test("un fallo al guardar sincronizacion conserva materiales y su cache", async () => {
  let materialCalls = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-1" }], materials: [] },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders, materials: current.materials }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      if (method === "getMaterialsForOt") {
        materialCalls += 1;
        return { materials: [{ ot: "WO-1", component: "CONSERVAR" }] };
      }
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-2" }] };
      if (method === "saveWorkOrderSyncState") throw new Error("sin permiso");
      return {};
    },
  });
  fixture.context.applyImported({
    revision: 1,
    workOrders: [{ ot: "WO-1" }],
    materials: [],
    performance: { deferred: { materials: true }, revision: 1 },
  });
  fixture.context.getSelectedPriorityJob = () => ({ ot: "WO-1" });
  fixture.context.selectedJobOt = () => "WO-1";

  fixture.context.renderSelectedJobPanel();
  await settleMicrotasks();
  fixture.context.state.workOrders = [];
  const beforeFailure = plain(fixture.context.state);

  await fixture.context.syncBacklogWorkOrders();
  fixture.context.renderSelectedJobPanel();
  await settleMicrotasks();

  assert.deepEqual(plain(fixture.context.state), beforeFailure);
  assert.equal(materialCalls, 1);
});

test("un timeout de sincronizacion manual no modifica ni guarda el estado", async () => {
  let saveCalls = 0;
  let checkpoints = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-LOCAL" }], operations: [{ id: "local", ot: "WO-LOCAL" }] },
    withTimeout: async () => { throw new Error("timeout"); },
    reconcileActiveWorkOrders: () => { throw new Error("no debe reconciliar"); },
    purgeClosedWorkOrderRetention: () => { throw new Error("no debe depurar"); },
    checkpointState: () => { checkpoints += 1; },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-REMOTA" }] };
      saveCalls += 1;
    },
  });
  const before = plain(fixture.context.state);

  await fixture.context.syncBacklogWorkOrders();

  assert.deepEqual(plain(fixture.context.state), before);
  assert.equal(checkpoints, 0);
  assert.equal(saveCalls, 0);
  assert.deepEqual(fixture.busyStates, []);
  assert.deepEqual(fixture.backlogBusyStates, [true, false]);
});

test("la sincronizacion manual ignora un segundo clic mientras la consulta ligera sigue activa", async () => {
  const gate = deferredPromise();
  const calls = [];
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-LOCAL" }] },
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "fetchNetSuiteWorkOrdersLite") return gate.promise;
      return { revision: 2 };
    },
    reconcileActiveWorkOrders: (state, workOrders) => ({ ...state, workOrders }),
    purgeClosedWorkOrderRetention: (state) => state,
  });

  const first = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  await fixture.context.syncBacklogWorkOrders();

  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite"]);
  gate.resolve({ workOrders: [{ ot: "WO-ACTIVA" }] });
  await first;
  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState"]);
  assert.deepEqual(fixture.backlogBusyStates, [true, false]);
});

test("la sincronizacion conserva una edicion local hecha mientras espera el guardado dedicado", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-CERRADA" }], settings: { local: "antes" } },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      return gate.promise;
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders, closedWorkOrderSummaries: {} }),
    purgeClosedWorkOrderRetention: (current) => current,
  });

  const sync = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  fixture.context.state.settings = { local: "durante" };
  gate.resolve({ revision: 2 });
  await sync;

  assert.equal(fixture.context.state.revision, 2);
  assert.deepEqual(plain(fixture.context.state.settings), { local: "durante" });
  assert.deepEqual(plain(fixture.context.state.workOrders), [{ ot: "WO-ACTIVA" }]);
});

test("la sincronizacion conserva closedDetectedAt al demorarse el guardado dedicado", async () => {
  const detectionTimes = [];
  const clock = ["2026-08-01T10:00:00.000Z", "2026-08-01T10:01:00.000Z"];
  const dedicated = deferredPromise();
  function ControlledDate() {
    return { toISOString: () => clock.shift() };
  }
  const fixture = loadClient({
    installBacklogSync: true,
    Date: ControlledDate,
    state: { workOrders: [{ ot: "WO-CERRADA" }] },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      return dedicated.promise;
    },
    reconcileActiveWorkOrders: (current, workOrders, nowIso) => {
      detectionTimes.push(nowIso);
      return { ...current, workOrders, closedWorkOrderSummaries: { "WO-CERRADA": { closedDetectedAt: nowIso } } };
    },
    purgeClosedWorkOrderRetention: (current) => current,
  });

  const sync = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  dedicated.resolve({ revision: 2 });
  await sync;

  assert.equal(detectionTimes[0], detectionTimes[1]);
  assert.equal(fixture.context.state.closedWorkOrderSummaries["WO-CERRADA"].closedDetectedAt, detectionTimes[0]);
});

test("el sync espera el guardado optimizado instalado antes de tomar la compuerta", async () => {
  const optimized = deferredPromise();
  const dedicated = deferredPromise();
  const calls = [];
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "savePlanningStateOptimized") return optimized.promise;
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      if (method === "saveWorkOrderSyncState") return dedicated.promise;
      return { revision: 3 };
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  fixture.context.window.requestIdleCallback = (callback) => { callback(); return 1; };
  fixture.context.appSheetDirtyScopes.add("plan");
  const normalSave = fixture.context.saveAppSheet(false);
  await settleMicrotasks();

  const sync = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  assert.deepEqual(calls, ["savePlanningStateOptimized", "fetchNetSuiteWorkOrdersLite"]);

  optimized.resolve({ revision: 2 });
  await normalSave;
  await settleMicrotasks();
  assert.deepEqual(calls, ["savePlanningStateOptimized", "fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState"]);
  dedicated.resolve({ revision: 3 });
  await sync;
});

test("la limpieza inicial renderiza sin solicitar guardado remoto", () => {
  const renders = [];
  const initializePlanningApp = Function(
    "bindElements", "bindEvents", "purgeClosedWorkOrderRetention", "resetDailyReportFiltersToToday", "render", "bindBacklogLoadMoreObserver", "saveState", "applyInitialWorkspaceView", "loadAppStateInBackground",
    `${initializeSource}; return initializePlanningApp;`,
  )(
    () => {}, () => {}, () => {}, () => {}, (options) => renders.push(options), () => {}, () => {}, () => {}, () => {},
  );

  initializePlanningApp();

  assert.deepEqual(renders, [{ save: false }]);
});

test("la edicion pendiente antes y durante el sync optimizado se guarda despues del acuse", async () => {
  const timers = new Map();
  const calls = [];
  const dedicated = deferredPromise();
  let timerId = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    callAppsScript: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      if (method === "saveWorkOrderSyncState") return dedicated.promise;
      return { revision: 3 };
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  fixture.context.window.setTimeout = (callback) => { timerId += 1; timers.set(timerId, callback); return timerId; };
  fixture.context.window.clearTimeout = (id) => timers.delete(id);
  fixture.context.window.requestIdleCallback = (callback) => { callback(); return 1; };
  const runTimers = async () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await settleMicrotasks();
  };

  fixture.context.queueAppSheetSave("plan");
  const sync = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  fixture.context.queueAppSheetSave("plan");
  await runTimers();
  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState"]);

  dedicated.resolve({ revision: 2 });
  await sync;
  await runTimers();

  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState", "savePlanningStateOptimized"]);
  assert.equal(calls[2].payload.revision, 2);
});

test("un debounce optimizado completado no programa un guardado extra al sincronizar OTs", async () => {
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    callAppsScript: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      if (method === "saveWorkOrderSyncState") return { revision: 3 };
      return { revision: 2 };
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  fixture.context.window.setTimeout = (callback) => { timerId += 1; timers.set(timerId, callback); return timerId; };
  fixture.context.window.clearTimeout = (id) => timers.delete(id);
  fixture.context.window.requestIdleCallback = (callback) => { callback(); return 1; };
  const runTimers = async () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await settleMicrotasks();
  };

  fixture.context.queueAppSheetSave("plan");
  await runTimers();
  await fixture.context.syncBacklogWorkOrders();
  await runTimers();

  assert.deepEqual(calls.map((call) => call.method), ["savePlanningStateOptimized", "fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState"]);
  assert.equal(calls[2].payload.revision, 2);
});

test("un fallo del sync libera la compuerta para el siguiente guardado optimizado", async () => {
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      if (method === "saveWorkOrderSyncState") throw new Error("fallo dedicado");
      return { revision: 2 };
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  fixture.context.window.setTimeout = (callback) => { timerId += 1; timers.set(timerId, callback); return timerId; };
  fixture.context.window.clearTimeout = (id) => timers.delete(id);
  fixture.context.window.requestIdleCallback = (callback) => { callback(); return 1; };

  await fixture.context.syncBacklogWorkOrders();
  assert.equal(fixture.context.appSheetSaveInFlight, false);
  fixture.context.queueAppSheetSave("plan");
  for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  await settleMicrotasks();

  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState", "savePlanningStateOptimized"]);
});

test("solo el propietario puede liberar la compuerta de guardado", () => {
  const fixture = loadClient({ installSaveGate: true });
  const owner = fixture.context.appSheetTryAcquireSaveGate();

  assert.equal(fixture.context.appSheetReleaseSaveGate({}), false);
  assert.equal(fixture.context.appSheetSaveInFlight, true);
  assert.equal(fixture.context.appSheetReleaseSaveGate(owner), true);
  assert.equal(fixture.context.appSheetSaveInFlight, false);
});

test("una edicion durante la sincronizacion espera el acuse antes del guardado normal", async () => {
  const timers = new Map();
  let nextTimer = 1;
  const calls = [];
  const dedicated = deferredPromise();
  let dedicatedPending = false;
  const window = {
    setTimeout(callback) { const id = nextTimer += 1; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    PlanningWorkflowCore: {
      withTimeout: (promise) => promise,
      reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
      purgeClosedWorkOrderRetention: (current) => current,
    },
  };
  const flow = Function(
    "window", "state", "localStorage", "STORAGE_KEY", "appSheetAvailable", "appSheetSaveInFlight", "appSheetSavePending", "appSheetSaveTimer", "appSheetDirtyScopes", "backlogSyncInFlight", "appSheetSaveCompletion", "resolveAppSheetSaveCompletion", "appSheetSaveOwner",
    "operationStatusSavesInFlight", "isAppsScriptRuntime", "callAppsScript", "createAppSheetPayload", "showToast", "NETSUITE_BACKLOG_SYNC_TIMEOUT_MS",
    "setBacklogSyncInFlight", "validateNetSuiteImportedData", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "render", "persistableState",
    `${appSheetSaveFlowSource}\n${backlogSyncSource}\nreturn {
      syncBacklogWorkOrders, saveState,
      get state() { return state; },
      get inFlight() { return appSheetSaveInFlight; },
      get pending() { return appSheetSavePending; },
    };`,
  )(
    window, { revision: 1, workOrders: [{ ot: "WO-LOCAL" }], operations: [], materials: [] }, { setItem: () => {} }, "test",
    true, false, false, null, new Set(), false, Promise.resolve(), null, null, 0, () => true,
    async (method, payload) => {
      calls.push({ method, payload, concurrent: dedicatedPending });
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      if (method === "saveWorkOrderSyncState") { dedicatedPending = true; const saved = await dedicated.promise; dedicatedPending = false; return saved; }
      return { revision: 3 };
    },
    () => ({ revision: flow?.state?.revision }), () => {}, 60000,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => ({}),
  );
  const runTimers = async () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await settleMicrotasks();
  };

  const sync = flow.syncBacklogWorkOrders();
  await settleMicrotasks();
  flow.saveState("plan");
  await runTimers();

  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState"]);
  dedicated.resolve({ revision: 2 });
  await sync;
  await runTimers();

  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite", "saveWorkOrderSyncState", "saveAppState"]);
  assert.equal(calls[2].concurrent, false);
  assert.equal(calls[2].payload.revision, 2);
});

test("un rechazo del guardado dedicado no modifica el estado local", async () => {
  const fixture = loadClient({
    installBacklogSync: true,
    state: { workOrders: [{ ot: "WO-LOCAL" }], settings: { local: "conservar" } },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-REMOTA" }] };
      throw new Error("guardar fallo");
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  const before = plain(fixture.context.state);

  await fixture.context.syncBacklogWorkOrders();

  assert.deepEqual(plain(fixture.context.state), before);
});

test("el boton manual y el fondo comparten la llamada backend de OTs", async () => {
  const workOrdersGate = deferredPromise();
  const planningGate = deferredPromise();
  let backgroundBackendCalls = 0;
  let manualBackendCalls = 0;
  const fixture = loadClient({
    installManualFlow: true,
    state: { workOrders: [{ ot: "WO-1" }] },
    loadPlanSnapshots: async () => ({ ok: true, count: 0 }),
    syncNetSuiteData: async () => {
      backgroundBackendCalls += 1;
      return workOrdersGate.promise;
    },
    fetchNetSuiteWorkOrdersLiteCompat: async () => {
      manualBackendCalls += 1;
      await workOrdersGate.promise;
      return { workOrders: [{ ot: "WO-1" }] };
    },
    callAppsScript: async (method) => {
      if (method === "syncNetSuitePlanningData") return planningGate.promise;
      return {};
    },
  });

  const manual = fixture.context.loadNetSuiteExercise();
  const background = fixture.context.syncNetSuiteInBackground({ showMessage: false });
  await settleMicrotasks();

  assert.equal(backgroundBackendCalls + manualBackendCalls, 1);
  assert.equal(fixture.context.planningActionsBusy, "sync");

  workOrdersGate.resolve(true);
  await background;
  planningGate.resolve({});
  await manual;

  assert.equal(fixture.context.planningActionsBusy, "");
  assert.deepEqual(fixture.toasts, ["Sincronizacion completa"]);
});

test("el boton conserva aria-busy hasta que terminan sync de OTs y accion manual", () => {
  const createButton = () => ({
    disabled: false,
    attributes: new Set(),
    label: { textContent: "" },
    setAttribute(name) { this.attributes.add(name); },
    removeAttribute(name) { this.attributes.delete(name); },
    querySelector() { return this.label; },
    classList: { toggle: () => {} },
  });
  const buttons = {
    loadNsExerciseBtn: createButton(),
    scheduleBtn: createButton(),
    syncBacklogOtsBtn: createButton(),
    restoreDraftBtn: createButton(),
  };
  const context = {
    els: buttons,
    planningActionsBusy: "sync",
    netSuiteSyncInFlight: false,
    netSuitePlanningSyncInFlight: false,
    backlogSyncInFlight: false,
    setNetSuiteSyncPhaseLabel(message) {
      buttons.loadNsExerciseBtn.label.textContent = message || "Sincronizar";
    },
    Boolean,
  };
  vm.createContext(context);
  vm.runInContext(busyStateSource, context, { filename: "planning-busy-state.js" });

  buttons.loadNsExerciseBtn.label.textContent = "Sincronizando...";
  context.setNetSuiteSyncState(false);
  assert.equal(buttons.loadNsExerciseBtn.attributes.has("aria-busy"), true);
  assert.equal(buttons.loadNsExerciseBtn.label.textContent, "Sincronizando...");

  context.planningActionsBusy = "sync";
  context.netSuiteSyncInFlight = true;
  context.setPlanningActionsBusy("sync", false);
  for (const button of [buttons.loadNsExerciseBtn, buttons.scheduleBtn, buttons.restoreDraftBtn]) {
    assert.equal(button.disabled, true);
    assert.equal(button.attributes.has("aria-busy"), true);
  }
  assert.equal(buttons.syncBacklogOtsBtn.disabled, false);
  assert.equal(buttons.syncBacklogOtsBtn.attributes.has("aria-busy"), false);

  context.netSuiteSyncInFlight = false;
  context.setPlanningActionsBusy("sync", false);
  for (const button of Object.values(buttons)) {
    assert.equal(button.disabled, false);
    assert.equal(button.attributes.has("aria-busy"), false);
  }
  assert.equal(buttons.loadNsExerciseBtn.label.textContent, "Sincronizar");
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

test("una lista de snapshots vacia y exitosa queda cargada entre Reportes y Restaurar", async () => {
  let snapshotCalls = 0;
  const fixture = loadClient({
    loadPlanSnapshots: async () => {
      snapshotCalls += 1;
      return { ok: true, count: 0 };
    },
    syncNetSuiteData: async () => false,
  });

  const reports = await fixture.context.loadSnapshotsOnce(false);
  const restore = await fixture.context.loadSnapshotsOnce(false);

  assert.equal(reports.ok, true);
  assert.equal(restore.ok, true);
  assert.equal(snapshotCalls, 1);
});
