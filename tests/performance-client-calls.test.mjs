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
const detailOperationsSource = appSource.slice(
  appSource.indexOf("const individualPlanningRequests"),
  appSource.indexOf("async function ensurePlanningDataLoaded("),
);
const applyPlanningPayloadSource = appSource.slice(
  appSource.indexOf("function applyNetSuitePlanningPayload("),
  appSource.indexOf("function applyNetSuiteWorkOrdersPayload("),
);

function loadIndividualSelection({ jobs, loaded, card, state, toasts, prepare = async () => true, checkpoint = () => {} }) {
  return new Function(
    "els", "getPriorityJobs", "showToast", "state", "window", "currentPlanOperations",
    "ensureWorkOrderPlanningData", "prepareJobForPlanning", "checkpointState", "applyQueuePriorities",
    "renderPriorityList", "renderPriorityQueue", "requestAnimationFrame", "renderTop", "renderPlanAlerts", "saveState",
    "materialOtKey", "hasIndividualPlanningOperations",
    `${individualSelectionSource}; return selectJob;`,
  )(
    { priorityList: { querySelectorAll: () => [card] } }, () => jobs.value, (message) => toasts.push(message), state,
    { PlanningWorkflowCore: { commitPreparedOtSelection: (draft, ot) => ({ ...draft, selectedOts: [...draft.selectedOts, ot] }) } },
    (operations) => operations, loaded, prepare, checkpoint, () => {}, () => {}, () => {},
    (callback) => callback(), () => {}, () => {}, () => {},
    (value) => String(value || ""), (ot) => jobs.value.some((job) => String(job.ot) === String(ot) && job.ops.length > 0),
  );
}

function deferredPromise() {
  let resolve;
  const promise = new Promise((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

async function settleMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadClient(options = {}) {
  const storage = new Map();
  const toasts = [];
  const busyStates = [];
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
      withTimeout: (promise) => promise,
      netSuiteSyncOutcome: (workOrders, planning) => ({
        status: workOrders?.ok && planning?.ok ? "complete" : "failed",
        message: workOrders?.ok && planning?.ok ? "Sincronizacion completa" : (workOrders?.error || planning?.error || "Fallo"),
      }),
      pruneDraftToOpenWorkOrders: () => ({}),
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
    setPlanningActionsBusy: (_action, inProgress) => {
      context.planningActionsBusy = inProgress ? "sync" : "";
      busyStates.push(inProgress);
    },
    setNetSuiteSyncPhaseLabel: () => {},
    loadAppStateInBackground: async () => {},
    loadPlanSnapshots: (...args) => options.loadPlanSnapshots(...args),
    loadSnapshotsOnce: (...args) => options.loadPlanSnapshots(...args),
    restoreDraftPlanFromSharedState: async () => false,
    openRestoreDraftDialog: async () => context.loadSnapshotsOnce(false),
    saveState: () => {},
    render: () => {},
    applyInitialWorkspaceView: () => {},
    syncNetSuiteData: (...args) => options.syncNetSuiteData(...args),
    syncWorkOrdersOnce: (syncOptions = {}) => context.syncNetSuiteData(syncOptions.showMessage === true, { mode: "workOrders" }),
    syncNetSuiteInBackground: (syncOptions) => context.syncWorkOrdersOnce(syncOptions),
    fetchNetSuiteWorkOrdersLiteCompat: (...args) => options.fetchNetSuiteWorkOrdersLiteCompat?.(...args),
    validateNetSuiteImportedData: () => {},
    invalidateCurrentPlanOperationsCache: () => options.invalidateCurrentPlanOperationsCache?.(),
    resetBacklogWindow: () => options.resetBacklogWindow?.(),
    applyNetSuitePlanningPayload: () => {},
    callAppsScript: (...args) => options.callAppsScript?.(...args),
    createAppSheetPayload: () => ({}),
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
  if (options.installManualFlow) vm.runInContext(manualFlowSource, context, { filename: "planning-manual-flow.js" });
  vm.runInContext(source, context, { filename: "performance-client.js" });
  if (options.installIndividualPlanning) vm.runInContext(individualPlanningSource, context, { filename: "planning-individual-work-order.js" });
  if (options.installDetailOperations) {
    vm.runInContext(detailOperationsSource, context, { filename: "planning-detail-operations.js" });
    vm.runInContext("globalThis.isSelectedJobDetailOperationLoading = (ot) => selectedJobDetailOperationLoads.has(materialOtKey(ot));", context);
  }
  return { context, state, toasts, busyStates };
}

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
    selectedOperationId: "direct-1325-1",
    operations: [
      { id: "direct-1325-1", ot: "1325" },
      { id: "old-2001-1", ot: "2001" },
    ],
    materials: [],
  };
  const applyNetSuitePlanningPayload = Function(
    "state", "normalizeKey", "selectedJobOt", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow",
    `${applyPlanningPayloadSource}; return applyNetSuitePlanningPayload;`,
  )(state, String, () => "1325", () => {}, () => {});

  applyNetSuitePlanningPayload({
    operations: [{ id: "fresh-2001-1", ot: "2001" }],
    materials: [],
  });

  assert.deepEqual(state.operations.map((operation) => operation.id), ["direct-1325-1", "fresh-2001-1"]);
  assert.equal(state.selectedOperationId, "direct-1325-1");
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

test("una fusion con ruta mixta falla sin cambiar estado", () => {
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773", item: "LOCAL" }],
      operations: [{ id: "local", ot: "2773", ct: "CORTE", tiempoProd: 0 }],
      materials: [{ ot: "2773", component: "LOCAL" }],
    },
  });
  const before = plain(fixture.state);

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2773", item: "REMOTE" },
      operations: [
        { id: "valid", ot: "2773", ct: "CORTE", tiempoProd: 10 },
        { id: "invalid", ot: "2773", ct: "DOBLEZ", tiempoProd: 0 },
      ],
      materials: [{ ot: "2773", component: "REMOTE" }],
    },
  }, "2773");

  assert.equal(merged, false);
  assert.deepEqual(plain(fixture.state), before);
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
  for (const button of Object.values(buttons)) {
    assert.equal(button.disabled, true);
    assert.equal(button.attributes.has("aria-busy"), true);
  }

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
