import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/web/shared/performance-client.js", import.meta.url), "utf8");
// MEDIDO 2026-10-01 en Windows: los cortes de este archivo buscan marcadores con "\n" puro
// (linea 32: "/**\n * Dispara la ingesta..."), y con el checkout de Windows app.js llega con
// CRLF, o sea que indexOf daba -1, el corte salia VACIO, `correrIngestaPorBoton` no existia en el
// arnes y el boton manual lanzaba ReferenceError. El sintoma era "el boton no sincroniza", que
// no era lo que pasaba: lo que pasaba era que el arnes se comia media funcion. En Linux el
// checkout trae LF y el fallo no aparece, o sea que era invisible fuera de la maquina del autor.
// Se normaliza aqui una vez y todos los cortes por indice pasan a ser portables.
const appSource = (await readFile(new URL("../src/web/planning/app.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const workflowCoreSource = await readFile(new URL("../src/web/planning/planning-workflow-core.js", import.meta.url), "utf8");

/**
 * PlanningWorkflowCore real en su propio contexto. Los harnesses de
 * applyNetSuiteWorkOrdersPayload lo usan sin stubs porque la carga ahora depende de
 * reconcileActiveWorkOrders: contra un stub no se probaria el podado real.
 */
function loadWorkflowCore() {
  const context = { globalThis: {}, console };
  vm.createContext(context);
  vm.runInContext(workflowCoreSource, context, { filename: "planning-workflow-core.js" });
  return context.globalThis.PlanningWorkflowCore;
}
const manualFlowSource = [
  appSource.slice(
    appSource.indexOf("async function loadNetSuiteExercise()"),
    appSource.indexOf("function formatReportDuration("),
  ),
  // MEDIDO 2026-09-30: syncNetSuiteTwoPhase llama a correrIngestaPorBoton, que vive ANTES de
  // syncBacklogWorkOrders, o sea fuera del tramo que se cortaba. Sin este trozo el boton
  // manual lanzaba ReferenceError en el primer await, el finally de loadNetSuiteExercise
  // soltaba el bloqueo y `planningActionsBusy` llegaba a "" en vez de "sync": el arnes
  // reportaba que el boton no sincroniza, cuando lo que faltaba era una funcion en el corte.
  appSource.slice(
    appSource.indexOf("/**\n * Dispara la ingesta y dice si se puede seguir leyendo de Supabase."),
    appSource.indexOf("async function syncBacklogWorkOrders("),
  ),
  appSource.slice(
    appSource.indexOf("async function syncNetSuiteTwoPhase(options = {})"),
    appSource.indexOf("function applyNetSuitePlanningPayload("),
  ),
].join("\n");
const backlogSyncSource = [
  appSource.slice(
    appSource.indexOf("async function syncBacklogWorkOrders(options = {})"),
    appSource.indexOf("async function syncNetSuiteTwoPhase(options = {})"),
  ),
  // DECIDIDO 2026-09-30: el sync ya no escribe por `saveWorkOrderSyncState` del puente;
  // sube el estado con el mismo escritor de Supabase que el resto de la pagina. La funcion
  // REAL entra aqui a proposito (y no un doble): lo que se quiere comprobar es que el sync
  // termine guardando en Supabase y avisando cuando no pudo, y eso vive en ella.
  appSource.slice(
    appSource.indexOf("async function guardarSyncDeOrdenesTrabajoEnSupabase() {"),
    appSource.indexOf("async function guardarCatalogosEnSupabase("),
  ),
].join("\n");
// El flujo de guardado del plan, con un hueco: NO entran las dos funciones que
// escriben en Supabase (guardarPlanEnSupabase y guardarCatalogosEnSupabase). Entran
// como parametros del arnes para poder observar a donde fue cada guardado. El hueco
// es obligatorio, no una comodidad: en un cuerpo de Function() una declaracion
// `function guardarPlanEnSupabase` TAPA el parametro del mismo nombre (el ambiente
// de la funcion queda por fuera del de parametros), asi que con la real dentro el
// doble del arnes no se usaria nunca. `ambitosDeCatalogo` si entra, y es real:
// decide que ambitos van a catalogo y no toca nada de Supabase.
const appSheetSaveFlowSource = [
  appSource.slice(
    appSource.indexOf("function saveState(saveScope = \"plan\")"),
    appSource.indexOf("async function guardarPlanEnSupabase("),
  ),
  appSource.slice(
    appSource.indexOf("/** Los ambitos de un guardado que son de CATALOGO"),
    appSource.indexOf("function purgeClosedWorkOrderRetention()"),
  ),
].join("\n");
// MEDIDO 2026-09-30: el corte va ANTES de `guardarPlanEnSupabase`, no antes de
// `saveAppSheet`. `appSheetTryAcquireSaveGate` .. `saveAppSheet` engloba las tres funciones
// que escriben en Supabase, y al instalarlas aqui TAPAN el doble del arnés: el sync
// terminaba guardando contra el `guardarPlanEnSupabase` real, que sin `PPSupabaseWriter`
// solo puede decir "Supabase no esta disponible" y devolver false. La compuerta son solo
// estas cuatro funciones, asi que el corte no pierde nada de la compuerta.
const appSheetGateSource = appSource.slice(
  appSource.indexOf("function appSheetTryAcquireSaveGate()"),
  appSource.indexOf("async function guardarPlanEnSupabase("),
);
const busyStateSource = appSource.slice(
  appSource.indexOf("function setPlanningControlBusy("),
  appSource.indexOf("async function fetchNetSuiteExercise("),
);
const individualPlanningSource = [
  appSource.slice(
    appSource.indexOf("function preserveImportedOperationPrices("),
    appSource.indexOf("function applyNetSuiteWorkOrdersPayload(", appSource.indexOf("function preserveImportedOperationPrices(")),
  ),
  appSource.slice(
    appSource.indexOf("const individualPlanningRequests"),
    appSource.indexOf("async function ensurePlanningDataLoaded("),
  ),
].join("\n");
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
const detailOperationsSource = [
  appSource.slice(
    appSource.indexOf("function preserveImportedOperationPrices("),
    appSource.indexOf("function applyNetSuiteWorkOrdersPayload(", appSource.indexOf("function preserveImportedOperationPrices(")),
  ),
  appSource.slice(
    appSource.indexOf("const individualPlanningRequests"),
    appSource.indexOf("async function ensurePlanningDataLoaded("),
  ),
].join("\n");
const applyPlanningPayloadSource = appSource.slice(
  appSource.indexOf("function applyNetSuitePlanningPayload("),
  appSource.indexOf("function applyNetSuiteWorkOrdersPayload("),
);
const applyWorkOrdersPayloadSource = appSource.slice(
  appSource.indexOf("function mergeWorkOrderLocalOverrides("),
  appSource.indexOf("function setNetSuiteSyncPhaseLabel("),
);
const loadSourceSelectionSource = appSource.slice(
  appSource.indexOf("async function loadSelectedLoadPlan("),
  appSource.indexOf("async function ensureSelectedJobsReadyForScheduling("),
);
const adjustedProductionSource = appSource.slice(
  appSource.indexOf("function adjustedProductionMinutes("),
  appSource.indexOf("function opStart("),
);
const planStatusSource = appSource.slice(
  appSource.indexOf("const operationPlanStatusActions"),
  appSource.indexOf("function renderProductionReportRow("),
);

function loadIndividualSelection({ jobs, loaded, card, state, toasts, prepare = async () => true, checkpoint = () => {}, showLoading = () => {}, closeDialog = () => {}, planningDialog = { open: true }, flushPlanSave = async () => true }) {
  return new Function(
    "els", "getPriorityJobs", "showToast", "state", "window", "currentPlanOperations",
    "ensureWorkOrderPlanningData", "prepareJobForPlanning", "checkpointState", "applyQueuePriorities",
    "renderPriorityList", "renderPriorityQueue", "requestAnimationFrame", "renderTop", "renderPlanAlerts", "flushPlanSave",
    "materialOtKey", "hasIndividualPlanningOperations", "showPlanningPreparationLoading", "closePlanningDialog",
    `${individualSelectionSource}; return selectJob;`,
  )(
    { priorityList: { querySelectorAll: () => [card] }, planningDialog }, () => jobs.value, (message) => toasts.push(message), state,
    { PlanningWorkflowCore: { commitPreparedOtSelection: (draft, ot) => ({ ...draft, selectedOts: [...draft.selectedOts, ot] }) } },
    (operations) => operations, loaded, prepare, checkpoint, () => {}, () => {}, () => {},
    (callback) => callback(), () => {}, () => {}, flushPlanSave,
    (value) => String(value || ""), (ot) => jobs.value.some((job) => String(job.ot) === String(ot) && job.ops.length > 0), showLoading, closeDialog,
  );
}

function loadIndividualActionInternals({ jobs, loaded, card, state, toasts, prepare = async () => true, showLoading = () => {}, closeDialog = () => {}, planningDialog = { open: true }, flushPlanSave = async () => true }) {
  return new Function(
    "els", "getPriorityJobs", "showToast", "state", "window", "currentPlanOperations",
    "ensureWorkOrderPlanningData", "prepareJobForPlanning", "checkpointState", "applyQueuePriorities",
    "renderPriorityList", "renderPriorityQueue", "requestAnimationFrame", "renderTop", "renderPlanAlerts", "flushPlanSave",
    "materialOtKey", "hasIndividualPlanningOperations", "showPlanningPreparationLoading", "closePlanningDialog",
    `${individualSelectionSource}; return {
      selectJob,
      actionStatus: typeof individualPlanningActionStatus === "function" ? individualPlanningActionStatus : null,
    };`,
  )(
    { priorityList: { querySelectorAll: () => [card] }, planningDialog }, () => jobs.value, (message) => toasts.push(message), state,
    { PlanningWorkflowCore: { commitPreparedOtSelection: (draft, ot) => ({ ...draft, selectedOts: [...draft.selectedOts, ot] }) } },
    (operations) => operations, loaded, prepare, () => {}, () => {}, () => {}, () => {},
    (callback) => callback(), () => {}, () => {}, flushPlanSave,
    (value) => String(value || ""), (ot) => jobs.value.some((job) => String(job.ot) === String(ot) && job.ops.length > 0), showLoading, closeDialog,
  );
}

function loadAppSheetSaveFlow(options = {}) {
  const timers = new Map();
  let nextTimer = 1;
  const calls = [];
  const gate = deferredPromise();
  const state = { revision: 1, selectedOts: [], workOrders: [], operations: [], materials: [], ...(options.state || {}) };
  // Lo que el plan llevaba al destino en el momento del guardado. Antes lo llevaba
  // `createAppSheetPayload`, que solo existe para el puente; ahora el que escribe es
  // Supabase, asi que esto representa el estado tal cual en el momento del guardado.
  const payloadDeEstado = () => ({ revision: state.revision, selectedOts: state.selectedOts, operations: state.operations });
  let revisionGuardada = Number(state.revision || 0);
  const guardarPlanEnSupabase = async (opciones = {}) => {
    const payload = payloadDeEstado();
    calls.push({ method: "guardarPlanEnSupabase", payload, opciones });
    if (options.failSave) return false;
    revisionGuardada += 1;
    state.revision = revisionGuardada;
    return true;
  };
  const guardarCatalogosEnSupabase = async (ambito) => {
    calls.push({ method: "guardarCatalogosEnSupabase", payload: payloadDeEstado(), ambito });
    if (options.failCatalogs) return false;
    return true;
  };
  const flow = Function(
    "window", "state", "localStorage", "STORAGE_KEY", "appSheetAvailable", "appSheetSaveInFlight", "appSheetSavePending", "appSheetSaveTimer", "appSheetDirtyScopes", "backlogSyncInFlight", "appSheetSaveCompletion", "resolveAppSheetSaveCompletion", "appSheetSaveOwner",
    "operationStatusSavesInFlight", "isAppsScriptRuntime", "callAppsScript", "PPSupabaseBridgeReplacement", "createAppSheetPayload", "showToast", "NETSUITE_BACKLOG_SYNC_TIMEOUT_MS",
    "setBacklogSyncInFlight", "validateNetSuiteImportedData", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "render", "persistableState",
    "resolveSaveGate", "appSheetDisponible", "guardarPlanEnSupabase", "guardarCatalogosEnSupabase",
    // MEDIDO 2026-09-29 en el navegador: `isAppsScriptRuntime` miente en el sitio estatico
    // (los dos instaladores lo dejan en "el puente esta configurado"), y por eso el guardado
    // del plan se iba por callAppsScript. `enRuntimeAppsScript` es el predicado que responde
    // la pregunta de verdad: google.script.run solo existe dentro de HtmlService. El cuerpo
    // de este Function incluye saveAppSheet de app.js, que lo llama.
    "enRuntimeAppsScript",
    `${appSheetSaveFlowSource}\nreturn {
      flushPlanSave,
      saveState,
      set inFlight(value) { appSheetSaveInFlight = value; },
      get inFlight() { return appSheetSaveInFlight; },
      get pending() { return appSheetSavePending; },
      get dirtyScopes() { return [...appSheetDirtyScopes]; },
      releaseInFlight(consumeScopes = true) {
        appSheetSaveInFlight = false;
        if (consumeScopes) appSheetDirtyScopes.clear();
        resolveSaveGate();
      },
    };`,
  )(
    {
      setTimeout(callback) { const id = nextTimer += 1; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    state, { setItem: () => {} }, "test",
    true, false, false, null, new Set(), false, gate.promise, null, null, 0,
    () => options.appsScriptRuntime !== false,
    async (method, payload) => {
      calls.push({ method, payload });
      if (options.failSave) throw new Error(options.failSave);
      return { revision: 2 };
    },
    {
      fetchNetSuiteWorkOrdersLite: async () => {
        calls.push({ method: "fetchNetSuiteWorkOrdersLite", payload: null });
        return { workOrders: [], syncedAt: new Date().toISOString() };
      },
    },
    payloadDeEstado, () => {}, 60000,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => ({}),
    () => gate.resolve(),
    // `appSheetDisponible` es la puerta real de app.js (dice si hay ALGUN destino de
    // guardado: el puente en Apps Script, Supabase fuera de el). Este arnes no monta
    // ninguno de los dos y su escenario es "el destino esta disponible", asi que se le
    // pasa la regla sola.
    () => true,
    guardarPlanEnSupabase, guardarCatalogosEnSupabase,
    () => options.appsScriptRuntime !== false,
  );
  return {
    flow,
    state,
    calls,
    runTimers: async () => {
      for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
      await settleMicrotasks();
    },
  };
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

test("la precarga no re-descarga OTs que ya tienen operaciones locales", async () => {
  const started = [];
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "1" }, { ot: "2" }, { ot: "3" }],
      operations: [{ id: "1-1", ot: "1", ct: "CORTE", tiempoProd: 10 }],
    },
    callAppsScript: async (_method, ot) => {
      started.push(ot);
      return { ok: true, data: { workOrder: { ot }, operations: [{ ot, ct: "CORTE", tiempoProd: 10 }], materials: [] } };
    },
  });

  const prefetch = fixture.context.prefetchRecentPlanningWorkOrders();
  await settleMicrotasks();
  await fixture.context.ensureWorkOrderPlanningData("2");
  await prefetch;

  assert.deepEqual(started, ["2", "3"]);
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

test("el traslado al plan conserva la OT y marca Error cuando el guardado no se pudo confirmar", async () => {
  const statusNode = { textContent: "" };
  const addButton = { disabled: false };
  const card = {
    dataset: { ot: "100" },
    setAttribute: () => {}, removeAttribute: () => {},
    querySelector: (selector) => selector === ".job-add" ? addButton : statusNode,
  };
  const toasts = [];
  const state = { selectedOts: [], operations: [{ ot: "100", ct: "CORTE" }], preparedPlanningByOt: {} };
  const fixture = loadIndividualActionInternals({
    jobs: { value: [{ ot: "100", movable: true, ops: [{ ot: "100", ct: "CORTE" }] }] },
    loaded: async () => ({ ready: true }), card, state, toasts,
    flushPlanSave: async () => false,
  });

  const completed = await fixture.selectJob("100", true);

  assert.equal(completed, false);
  assert.equal(statusNode.textContent, "Error");
  assert.equal(fixture.actionStatus("100"), "error");
  // La OT sigue en la cola local: el reintento en segundo plano la puede persistir.
  assert.deepEqual(state.selectedOts, ["100"]);
  assert.deepEqual(toasts, ["OT 100 quedo en el plan solo en esta sesion; el guardado se reintentara"]);
});

test("el traslado al plan se persiste de inmediato sin esperar el debounce", async () => {
  const fixture = loadAppSheetSaveFlow({ state: { selectedOts: ["100"], lockedOts: ["100"] } });
  fixture.flow.saveState("plan");

  const saved = await fixture.flow.flushPlanSave("plan");

  assert.equal(saved, true);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["guardarPlanEnSupabase"]);
  assert.deepEqual(fixture.calls[0].payload.selectedOts, ["100"]);
  // El debounce anterior quedo cancelado: no hay un segundo guardado programado.
  assert.deepEqual(fixture.flow.dirtyScopes, []);
  assert.equal(fixture.flow.inFlight, false);
});

test("el traslado al plan espera el guardado en curso y reintenta con la OT incluida", async () => {
  const fixture = loadAppSheetSaveFlow({ state: { selectedOts: ["100"] } });
  fixture.flow.inFlight = true;

  const flushed = fixture.flow.flushPlanSave("plan");
  await settleMicrotasks();
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.flow.pending, true);

  // El guardado en curso consumio el ambito sucio antes de terminar.
  fixture.flow.releaseInFlight();
  const saved = await flushed;

  assert.equal(saved, true);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["guardarPlanEnSupabase"]);
  assert.deepEqual(fixture.calls[0].payload.selectedOts, ["100"]);
});

test("el traslado al plan reporta el fallo del guardado sin confirmarlo como Guardado", async () => {
  const fixture = loadAppSheetSaveFlow({ state: { selectedOts: ["100"] }, failSave: "timeout al guardar" });

  const saved = await fixture.flow.flushPlanSave("plan");

  assert.equal(saved, false);
  assert.equal(fixture.flow.inFlight, false);
  assert.deepEqual(fixture.flow.dirtyScopes, ["plan"]);
});

test("fuera de Apps Script, un ambito de catalogo sube el plan y LUEGO los catalogos", async () => {
  // MEDIDO 2026-09-29: los catalogos se escriben por Supabase, no por el puente, y
  // DESPUES del plan. El orden importa: si el plan falla, saveAppSheet lanza antes de
  // llegar a los catalogos y no se sube nada de un guardado que no ocurrio.
  const fixture = loadAppSheetSaveFlow({ state: { selectedOts: ["100"] }, appsScriptRuntime: false });

  const saved = await fixture.flow.flushPlanSave("catalogs");

  assert.equal(saved, true);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["guardarPlanEnSupabase", "guardarCatalogosEnSupabase"]);
  assert.equal(fixture.calls[1].ambito, "catalogs");
});

test("un ambito de plan no sube catalogos, aunque se guarde mil veces", async () => {
  const fixture = loadAppSheetSaveFlow({ state: { selectedOts: ["100"] }, appsScriptRuntime: false });

  fixture.flow.saveState("plan");
  const saved = await fixture.flow.flushPlanSave("plan");

  assert.equal(saved, true);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["guardarPlanEnSupabase"]);
});

test("matrix manda sobre catalogs cuando los dos ambitos vienen juntos", async () => {
  // El aviso que da el escritor para 'matrix' es el de la pestana de Matriz, que es
  // justo lo que no se escribe: con 'catalogs' primero se mostraria el aviso de otra
  // cosa y se taparia el que importa.
  const fixture = loadAppSheetSaveFlow({ state: {}, appsScriptRuntime: false });
  fixture.flow.saveState("matrix");
  fixture.flow.saveState("catalogs");

  const saved = await fixture.flow.flushPlanSave("matrix");

  assert.equal(saved, true);
  const deCatalogo = fixture.calls.filter((call) => call.method === "guardarCatalogosEnSupabase");
  assert.deepEqual(deCatalogo.map((call) => call.ambito), ["matrix"]);
});

test("un fallo de los catalogos da por fallido el guardado, sin borrar el plan", async () => {
  const fixture = loadAppSheetSaveFlow({ state: {}, appsScriptRuntime: false, failCatalogs: "tabla bloqueada" });

  const saved = await fixture.flow.flushPlanSave("catalogs");

  // MEDIDO 2026-10-03 (fix de la auditoria): antes esto devolvía true y salía el
  // toast "Plan guardado en Supabase" con la edición de catalogos perdida, porque
  // el ambito se habia consumido y no habia reintento. Ahora saveAppSheet devuelve
  // false SI el plan subio: el plan esta en la base (no se reescribe), el ambito de
  // catalogo queda vivo para reintentar y el llamador no borra los formularios.
  // Cubrir que el ambito queda vivo y que el plan no se reescribe esta en
  // tests/guardado-sin-puente.test.mjs, que mide el cuerpo completo.
  assert.equal(saved, false);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["guardarPlanEnSupabase", "guardarCatalogosEnSupabase"]);
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

/**
 * Copia del estado para aserciones. `plain` es JSON crudo y revienta con una referencia
 * ciclica; aqui lo que se copia es el estado de un arnes, que puede traer dobles de funcion,
 * asi que un fallo de copia se devuelve como `null` en vez de tumbar el test.
 */
function copiaDeEstado(state) {
  try {
    return plain(state);
  } catch (error) {
    return null;
  }
}

function loadClient(options = {}) {
  const storage = new Map();
  const toasts = [];
  const busyStates = [];
  const backlogBusyStates = [];
  const callsSupabase = [];
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
      // MEDIDO 2026-09-29 en el navegador: `isConfigured` dice "el puente esta configurado",
      // que en el sitio estatico es cierto porque la URL del backend va embebida en el bundle.
      // `nativeRuntimeAvailable` es el unico predicado que responde "estoy dentro de
      // HtmlService", y es el que decide a donde se escribe el plan. Por defecto el arnes
      // describe el runtime de Apps Script; `runtimeDeAppscript: false` describe el sitio
      // estatico, donde el guardado optimized tiene que delegar en app.js (Supabase).
      nativeRuntimeAvailable: () => options.runtimeDeAppscript !== false,
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
      needsWorkOrderSyncBeforeSchedule: (...args) => (options.needsWorkOrderSyncBeforeSchedule ? options.needsWorkOrderSyncBeforeSchedule(...args) : false),
    },
    PlannerCore: {
      isSpecialSubcontractCapability: (capability) => String(capability?.ct) === "6462" || /SUBCONTRATO/i.test(String(capability?.label || "")),
    },
    // MEDIDO 2026-09-30: este stub va en root, NO en context, y esa diferencia es el fallo
    // entero. root es el `window` de este arnes (`window: root` de dos lineas mas abajo) y
    // correrIngestaPorBoton pide el modulo por `window.PPIngestaTrigger`. Con el stub en
    // context existia y no se veia: urlDeIngesta() daba undefined, la ingesta se salia sin
    // correr, el boton manual salia por el aviso de "este build no trae la URL" y las
    // pruebas del boton, que median un reread, median un boton apagado.
    PPIngestaTrigger: {
      urlDeIngesta: () => "https://script.google.com/macros/s/AKfyPRUEBA/exec",
      dispararIngesta: async () => (options.ingesta?.() ?? { ok: true, ejecutada: true, filas: {}, errores: [], totalFilas: 0 }),
      TIEMPO_MAXIMO_MS: 330000,
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
    NETSUITE_BACKLOG_SYNC_TIMEOUT_MS: 180000,
    NETSUITE_WORKORDER_FRESH_MS: 15 * 60 * 1000,
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
    // DECIDIDO 2026-09-30: el guardado optimized SIEMPRE delega aqui, que es el
    // `saveAppSheet` de app.js (el que sube el plan a Supabase y despues los catalogos).
    // Antes solo delegaba FUERA de HtmlService y adentro armaba jobs de Hojas. Se anota el
    // numero de delegaciones para poder verlo desde el test, y `guardarEspera` deja el
    // guardado en vuelo para poder observar la compuerta.
    saveAppSheet: async () => {
      context.saveAppSheetDelegaciones = (context.saveAppSheetDelegaciones || 0) + 1;
      // MEDIDO 2026-09-30: al delegar el guardado en app.js, la compuerta de guardado la
      // toma el `saveAppSheet` REAL, no el optimized. El doble tiene que hacer lo mismo
      // (tomar la compuerta, devolver false si no la hay, soltarla al final) o los tests de
      // compuerta describen un mundo que no existe: el sync entraba a guardar en paralelo.
      const gate = context.appSheetTryAcquireSaveGate();
      if (!gate) return false;
      try {
        if (options.guardarEspera) await options.guardarEspera.promise;
        return true;
      } finally {
        context.appSheetReleaseSaveGate(gate);
      }
    },
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
    // MEDIDO 2026-09-29: `optimizedQueueAppSheetSave` pregunta `appSheetDisponible()`, no la
    // bandera `appSheetAvailable` del puente. En el sitio estatico la bandera del puente no
    // existe y la pregunta lanzaba ReferenceError en cada cambio de estado (ver el comentario
    // de performance-client.js:575-583). Aqui se monta la puerta real de app.js con la misma
    // respuesta que tendria el arnes: el puente disponible.
    appSheetDisponible: () => true,
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
    // clearNetSuiteSyncAlert/setNetSuiteSyncAlert viven en app.js MAS ABAJO de syncBacklogWorkOrders,
    // y el arnes recorta syncBacklogWorkOrders sin ellas. Sin este stub la llamada tira
    // ReferenceError y el catch de syncBacklogWorkOrders lo reporta como un fallo de sync. Hacen lo
    // mismo que las reales: tocan state.netSuiteSyncAlert.
    clearNetSuiteSyncAlert: () => { context.state.netSuiteSyncAlert = null; },
    setNetSuiteSyncAlert: (message) => {
      context.state.netSuiteSyncAlert = { message: String(message), updatedAt: new Date().toISOString() };
    },
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
    // MEDIDO 2026-09-30: el sync de arranque ya no esta compuerteado por
    // `isAppsScriptRuntime()` (Supabase es la fuente y esta en los dos runtimes), asi que
    // cualquier test que llegue al final del arranque lo dispara. Sin doble, se comia un
    // TypeError diferido; con el doble, el sync es un no-op salvo que el test lo pida.
    syncNetSuiteData: (...args) => (options.syncNetSuiteData?.(...args) ?? false),
    syncWorkOrdersOnce: (syncOptions = {}) => context.syncNetSuiteData(syncOptions.showMessage === true, { mode: "workOrders" }),
    syncNetSuiteInBackground: (syncOptions) => context.syncWorkOrdersOnce(syncOptions),
    validateNetSuiteImportedData: () => {},
    invalidateCurrentPlanOperationsCache: () => options.invalidateCurrentPlanOperationsCache?.(),
    // syncNetSuiteTwoPhase y persistPlanSnapshot guardan por Supabase, no por el
    // puente (RULE-SUP-021). Sin este doble el ReferenceError se reporta como un
    // fallo de sincronizacion y el test verdeeria por el motivo equivocado.
    guardarPlanEnSupabase: async (opciones) => {
      // Doble lo mas fiel posible del `guardarPlanEnSupabase` REAL de app.js: ese mapea el
      // estado entero con PPSupabaseWriter, guarda la revision que le devuelven en el estado
      // (para que el siguiente guardado no mande la vieja) y devuelve false si no pudo.
      // El estado se copia al momento de la llamada, porque quien se guarda es el estado que
      // hay ENTONCES, no el que quede despues.
      callsSupabase.push({
        method: "guardarPlanEnSupabase",
        opciones,
        estado: copiaDeEstado(context.state),
      });
      if (options.guardarFalla) return false;
      if (options.guardarEspera) await options.guardarEspera.promise;
      if (typeof options.revisionAlGuardar === "number") context.state.revision = options.revisionAlGuardar;
      return true;
    },
    guardarCatalogosEnSupabase: async (ambito) => {
      callsSupabase.push({ method: "guardarCatalogosEnSupabase", ambito });
      return true;
    },
    resetBacklogWindow: () => options.resetBacklogWindow?.(),
    applyNetSuitePlanningPayload: () => {},
    callAppsScript: (...args) => options.callAppsScript?.(...args),
    PPSupabaseBridgeReplacement: {
      getAppStateIfChanged: (...args) => options.callAppsScript?.("getAppStateIfChanged", ...args),
      getAppState: (...args) => options.callAppsScript?.("getAppState", ...args),
      getMaterialsForOt: (...args) => options.callAppsScript?.("getMaterialsForOt", ...args),
      syncNetSuitePlanningData: (...args) => options.callAppsScript?.("syncNetSuitePlanningData", ...args),
      syncNetSuitePlant: (...args) => options.callAppsScript?.("syncNetSuitePlant", ...args),
      syncNetSuiteWorkOrders: (...args) => options.callAppsScript?.("syncNetSuiteWorkOrders", ...args),
      fetchNetSuiteWorkOrdersLite: (...args) => options.callAppsScript?.("fetchNetSuiteWorkOrdersLite", ...args),
      getPlanningWorkOrderData: (...args) => options.callAppsScript?.("getPlanningWorkOrderData", ...args),
      getPlanningWorkOrderDataBatch: (...args) => options.callAppsScript?.("getPlanningWorkOrderDataBatch", ...args),
      getInspectionWorkOrder: (...args) => options.callAppsScript?.("getInspectionWorkOrder", ...args),
      getInspectionWorkOrderBundle: (...args) => options.callAppsScript?.("getInspectionWorkOrderBundle", ...args),
      getInspectionDrawingRoutes: (...args) => options.callAppsScript?.("getInspectionDrawingRoutes", ...args),
      saveInspectionLink: (...args) => options.callAppsScript?.("saveInspectionLink", ...args),
      saveOperationPlanStatus: (...args) => options.callAppsScript?.("saveOperationPlanStatus", ...args),
      savePlanSnapshot: (...args) => options.callAppsScript?.("savePlanSnapshot", ...args),
      saveDraftSnapshot: (...args) => options.callAppsScript?.("saveDraftSnapshot", ...args),
      publishDraftPlan: (...args) => options.callAppsScript?.("publishDraftPlan", ...args),
      getPlanSnapshot: (...args) => options.callAppsScript?.("getPlanSnapshot", ...args),
      getPlanSnapshotLight: (...args) => options.callAppsScript?.("getPlanSnapshotLight", ...args),
      listPlanSnapshots: (...args) => options.callAppsScript?.("listPlanSnapshots", ...args),
      restorePublishedPlanAsDraft: (...args) => options.callAppsScript?.("restorePublishedPlanAsDraft", ...args),
      confirmWorkOrderClosures: (...args) => options.callAppsScript?.("confirmWorkOrderClosures", ...args),
    },
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
  return {
    context,
    state,
    toasts,
    busyStates,
    backlogBusyStates,
    callsSupabase,
    get saveAppSheetDelegaciones() { return context.saveAppSheetDelegaciones || 0; },
  };
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
  const createButton = (key) => {
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
  };
  const buttons = buttonKeys.map(createButton);
  const detailButtons = (options.detailKeys || []).map(createButton);
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
    selectedJobPanel: { querySelectorAll: (selector) => selector === "[data-plan-status-key]" ? detailButtons : [] },
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
    "state", "els", "window", "isReportSnapshotEditable", "reportSourceAllowsOperationTracking", "isPlanCompletedOperation", "operationCompletionKey", "otHasPendingOperation",
    "deepClone", "appendLog", "isToolChangeReportOperation", "workOrderForOt", "checkpointState",
    "invalidateGanttCache", "renderTop", "renderPlanAlerts", "renderSelectedJobPanel", "renderDraftExecutiveSummary",
    "renderGantt", "renderLoads", "requestAnimationFrame", "scheduleLocalStorageFlush", "showToast", "appSheetAvailable",
    "isAppsScriptRuntime", "appSheetSaveTimer", "operationStatusSavesInFlight", "callAppsScript",
    "appSheetDirtyScopes", "queueAppSheetSave", "appSheetMarkDirtyScope", "saveAppSheet", "console", "render",
    "selectedJobOt", "escapeHtml", "operatorReportSelection", "adjusterReportSelection", "renderReportFilterStatus",
    "renderProductionReportRow", "renderAdjusterReportRow", "bindReportCommentInputs", "renderOperatorReport", "renderAdjusterReport", "reportOperationsSource",
    "sequenceSort", "opStart", "renderSubcontractReport", "renderReleaseReport", "planStatusOriginForSource", "statusesForPlanOrigin",
    "draftViewStatuses", "latestPublishedOriginId", "activePlanReportStatuses", "writePlanStatusByOrigin",
    "rollbackPlanStatusByOrigin", "shouldMutateDraftFromSource", "clearPendingPlanStatusSaveKeys",
    "appSheetDisponible", "PPSupabaseBridgeReplacement",
    `${planStatusSource}; return { bindPlanStatusActions, toggleOperationPlanStatus };`,
  )(
    state, els, {
      clearTimeout: () => {},
      schedulePlanStatusBackgroundRefresh: (callback) => deferredWork.push(callback),
      PlannerCore: { operationToolKey: () => "" },
    }, () => true, () => options.reportTrackingAllowed !== false,
    (operation) => operation?.planStatus === "COMPLETADA_PLAN", (operation) => operation?.id || "",
    (ot) => (Array.isArray(state.operations) &&
      state.operations.some((op) => String(op.ot) === String(ot) && op.planStatus !== "COMPLETADA_PLAN")) ||
      Object.keys(state.operationPlanStatuses || {}).some((statusKey) =>
        String(state.operationPlanStatuses[statusKey]?.ot) === String(ot) &&
        state.operationPlanStatuses[statusKey]?.status !== "COMPLETADA_PLAN"),
    structuredClone, (log, entry) => [log, entry].filter(Boolean).join(" | "), () => false, () => null,
    () => {}, () => {}, () => broadRenders.push("top"), () => broadRenders.push("alerts"), options.renderSelectedJobPanel || (() => {}),
    () => broadRenders.push("summary"), () => broadRenders.push("gantt"), () => broadRenders.push("loads"), (callback) => { callback(); return 1; },
    () => {}, (message) => toasts.push(message), true, () => true, null, 0,
    (...args) => options.callAppsScript?.(...args), new Set(), () => {}, () => {}, async () => false,
    { warn: () => {} }, () => broadRenders.push("render"), options.selectedJobOt || (() => ""), (value) => String(value || ""),
    reportSelection, () => ({ rows: [], total: 0, date: "2026-08-01", futureDays: 1 }),
    (_type, input, future, output, selection) => {
      input.value = selection.date;
      future.value = String(selection.futureDays);
      output.textContent = `${selection.rows.length} de ${selection.total} · max. 25`;
    },
    (operation) => `<tr data-plan-status-row-key="${operation.id}"></tr>`,
    (operation) => `<tr data-plan-status-row-key="${operation.id}"></tr>`, () => {}, rerenderReport, () => {}, () => reportSource,
    (a, b) => (Number(a?.secuencia || 0) - Number(b?.secuencia || 0)), () => null, () => {}, () => {},
    () => "draft", (origin) => origin === "draft" ? (state.operationPlanStatuses || {}) : (state.publishedPlanStatuses?.[origin] || {}),
    () => state.operationPlanStatuses || {}, () => "", () => state.operationPlanStatuses || {},
    (key, status) => { if (!state.operationPlanStatuses) state.operationPlanStatuses = {}; const row = { ...(status || {}), key, origin: "draft" }; state.operationPlanStatuses[key] = row; return row; },
    (key, previousStatus) => { if (previousStatus) state.operationPlanStatuses[key] = previousStatus; else delete state.operationPlanStatuses[key]; },
    () => true, () => {},
    // La puerta real de app.js. Aqui el destino SI esta disponible (el arnes pasa
    // appSheetAvailable = true), asi que se le pasa esa misma regla.
    () => true,
    // MEDIDO 2026-09-30: el puente de Apps Script quedo deshabilitado porque NetSuite ya
    // carga a Supabase y Supabase es la fuente (RULE-SUP-030). app.js ya no llama a
    // `callAppsScript("saveOperationPlanStatus")` sino a
    // `PPSupabaseBridgeReplacement.saveOperationPlanStatus`, asi que el arnes inyecta esa
    // puerta y la ata al mismo `options.callAppsScript` que usaba antes: el test sigue
    // comprobando el MISMO comportamiento, no otro.
    { saveOperationPlanStatus: (...args) => options.callAppsScript?.("saveOperationPlanStatus", ...args) },
  );
  return {
    api, buttons, state, reportRows, els, deferredWork, broadRenders, toasts, rerenderReport, detailButtons,
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
  assert.deepEqual(fixture.state.lockedOts, ["100"]);

  gate.resolve({ revision: 2, savedAt: "2026-08-01T00:00:00.000Z" });
  await saved;

  assert.equal(fixture.state.revision, 2);
  fixture.deferredWork.forEach((callback) => callback());
  assert.deepEqual(fixture.broadRenders, ["top", "alerts", "summary", "gantt"]);
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
  assert.deepEqual(fixture.state.lockedOts, ["200"]);
});

test("completar la ultima de una secuencia persiste todas las anteriores en un solo guardado", async () => {
  const calls = [];
  const fixture = loadPlanStatus({
    rows: ["op-1", "op-2", "op-3"],
    reportStatus: "PENDIENTES",
    operations: [
      { id: "op-1", ot: "300", ct: "CORTE", secuencia: 1, fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
      { id: "op-2", ot: "300", ct: "DOBLEZ", secuencia: 2, fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
      { id: "op-3", ot: "300", ct: "SOLDEO", secuencia: 3, fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
    ],
    callAppsScript: (method, payload) => {
      calls.push([method, payload]);
      return Promise.resolve({ revision: 2, savedAt: "2026-08-01T00:00:00.000Z" });
    },
  });

  fixture.api.bindPlanStatusActions({ querySelectorAll: () => fixture.buttons });
  await fixture.buttons[2].listener();

  assert.equal(fixture.state.operationPlanStatuses["op-1"].status, "COMPLETADA_PLAN");
  assert.equal(fixture.state.operationPlanStatuses["op-2"].status, "COMPLETADA_PLAN");
  assert.equal(fixture.state.operationPlanStatuses["op-3"].status, "COMPLETADA_PLAN");
  assert.equal(fixture.state.operations[0].planStatus, "COMPLETADA_PLAN");
  assert.equal(fixture.state.operations[1].planStatus, "COMPLETADA_PLAN");
  assert.deepEqual(calls.map(([method]) => method), ["saveOperationPlanStatus"]);
  const payload = calls[0][1];
  assert.ok(Array.isArray(payload.statuses), "debe enviar statuses[] para persistir la cascada");
  assert.deepEqual(
    payload.statuses.map((item) => item.key).sort(),
    ["op-1", "op-2", "op-3"],
    JSON.stringify(payload.statuses),
  );
  assert.ok(payload.statuses.every((item) => item.status === "COMPLETADA_PLAN"), JSON.stringify(payload.statuses));
  assert.equal(payload.status.operationId, "op-3");
  assert.deepEqual(fixture.state.lockedOts, ["300"]);
});

test("reabrir la unica operacion completada desbloquea la OT", async () => {
  const calls = [];
  const publishedOperation = {
    id: "published-op-1",
    ot: "200",
    ct: "CORTE",
    planStatus: "COMPLETADA_PLAN",
    fechaInicio: "2026-08-01",
    horaInicio: "07:00",
    fechaFin: "2026-08-01",
    horaFin: "08:00",
  };
  const fixture = loadPlanStatus({
    rows: ["published-op-1"],
    operations: [],
    reportOperations: [publishedOperation],
    operationPlanStatuses: { "published-op-1": { key: "published-op-1", status: "COMPLETADA_PLAN", ot: "200" } },
    callAppsScript: (method, payload) => {
      calls.push([method, payload]);
      return Promise.resolve({ revision: 3, savedAt: "2026-08-01T00:00:00.000Z" });
    },
  });

  fixture.api.bindPlanStatusActions({ querySelectorAll: () => fixture.buttons });
  await fixture.buttons[0].listener();

  assert.equal(fixture.state.operationPlanStatuses["published-op-1"].status, "PENDIENTE");
  assert.deepEqual(fixture.state.lockedOts, []);
});

test("reabrir una operacion desbloquea la OT si quedan operaciones pendientes por reprocesar", async () => {
  const calls = [];
  const fixture = loadPlanStatus({
    rows: ["op-1"],
    operations: [
      { id: "op-1", ot: "100", ct: "CORTE", secuencia: 1, planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
      { id: "op-2", ot: "100", ct: "DOBLEZ", secuencia: 2, planStatus: "PENDIENTE", fechaInicio: "2026-08-02", fechaFin: "2026-08-02" },
    ],
    operationPlanStatuses: {
      "op-1": { key: "op-1", status: "COMPLETADA_PLAN", ot: "100" },
      "op-2": { key: "op-2", status: "PENDIENTE", ot: "100" },
    },
    state: { lockedOts: ["100"] },
    callAppsScript: (method, payload) => {
      calls.push([method, payload]);
      return Promise.resolve({ revision: 3, savedAt: "2026-08-01T00:00:00.000Z" });
    },
  });

  fixture.api.bindPlanStatusActions({ querySelectorAll: () => fixture.buttons });
  await fixture.buttons[0].listener();

  assert.equal(fixture.state.operationPlanStatuses["op-1"].status, "PENDIENTE");
  assert.equal(fixture.state.operations[0].planStatus, "PENDIENTE");
  assert.equal(fixture.state.operations[0].needsReschedule, true);
  assert.deepEqual(fixture.state.lockedOts, []);
});

test("completar desde el panel de detalle re-habilita el boton del detalle despues de guardar", async () => {
  const calls = [];
  const fixture = loadPlanStatus({
    rows: ["op-1"],
    detailKeys: ["op-1"],
    selectedJobOt: () => "100",
    renderSelectedJobPanel: () => {
      fixture.detailButtons.forEach((button) => { button.disabled = true; });
    },
    operations: [
      { id: "op-1", ot: "100", ct: "CORTE", secuencia: 1, fechaInicio: "2026-08-01", fechaFin: "2026-08-01" },
    ],
    callAppsScript: (method, payload) => {
      calls.push([method, payload]);
      return Promise.resolve({ revision: 2, savedAt: "2026-08-01T00:00:00.000Z" });
    },
  });
  const detailButton = fixture.detailButtons[0];
  assert.equal(detailButton.disabled, false);
  assert.equal(detailButton.textContent, "Completar");

  await fixture.api.toggleOperationPlanStatus("op-1");

  assert.equal(fixture.state.operationPlanStatuses["op-1"].status, "COMPLETADA_PLAN");
  assert.equal(detailButton.disabled, false);
  assert.equal(detailButton.textContent, "Reabrir");
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

// MEDIDO 2026-10-01: este test fijaba el nombre de la variable del src (job.photoUrl). Cuando la
// foto paso a salir por un normalizador, el candado dejo de matchear y el fallo se leia como
// "la foto dejo de ser lazy", que no era lo que pasaba. Ahora comprueba lo que de verdad importa:
// que los tres <img> de foto (backlog, cola y detalle) son lazy, y que ninguno pinta la URL CRUDA.
test("las fotos de backlog, cola y detalle usan carga diferida y no la URL cruda", () => {
  for (const marca of ["data-backlog-photo", "data-queue-photo", "data-detail-photo"]) {
    assert.match(appSource, new RegExp(`<img loading="lazy" src="\\$\\{escapeHtml\\([A-Za-z0-9_]+\\)\\}"[^>]*${marca}`),
      `${marca}: la imagen de foto tiene que seguir siendo lazy y con el src escapado`);
  }
  assert.doesNotMatch(appSource, /escapeHtml\(job\.photoUrl\)/,
    "ningun render de foto puede pintar job.photoUrl sin normalizar: el URL crudo de Drive no carga");
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
  assert.deepEqual(plain(fixture.state.operations.map((operation) => operation.id)), ["sync-2773-1"]);
  assert.equal(fixture.state.operations[0].tiempoProd, 12);
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
    "state", "window", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "materialOtKey",
    `${applyWorkOrdersPayloadSource}; return applyNetSuiteWorkOrdersPayload;`,
  )(state, {
    PlanningWorkflowCore: loadWorkflowCore(),
  }, () => {}, () => {}, (value) => String(value || "").trim().toUpperCase());

  applyNetSuiteWorkOrdersPayload({ selectedOts: ["100", "200"], workOrders: [{ ot: "100" }, { ot: "200" }] });

  assert.deepEqual(state.selectedOts, ["200"]);
  assert.deepEqual(state.lastSchedule.scheduledOts, ["200"]);
});

test("la sincronizacion de OTs preserva precios locales positivos cuando el payload trae 0", () => {
  const state = {
    selectedOts: ["100"],
    workOrders: [{ ot: "100", lastSalePrice: 320, averageSalePrice: 410, dueDateOverride: "2026-08-01", photoUrl: "local.jpg" }],
  };
  const applyNetSuiteWorkOrdersPayload = Function(
    "state", "window", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "materialOtKey",
    `${applyWorkOrdersPayloadSource}; return applyNetSuiteWorkOrdersPayload;`,
  )(state, {
    PlanningWorkflowCore: loadWorkflowCore(),
  }, () => {}, () => {}, (value) => String(value || "").trim().toUpperCase());

  applyNetSuiteWorkOrdersPayload({
    workOrders: [{ ot: "100", item: "NEW", lastSalePrice: 0, averageSalePrice: 0 }],
  });

  assert.equal(state.workOrders[0].lastSalePrice, 320);
  assert.equal(state.workOrders[0].averageSalePrice, 410);
  assert.equal(state.workOrders[0].dueDateOverride, "2026-08-01");
  assert.equal(state.workOrders[0].photoUrl, "local.jpg");
  assert.equal(state.workOrders[0].item, "NEW");
});

test("preserveImportedOperationPrices conserva unitPrice/amount locales positivos ante import sin precios", () => {
  const preserveImportedOperationPrices = Function(
    "materialOtKey",
    `${appSource.slice(
      appSource.indexOf("function preserveImportedOperationPrices("),
      appSource.indexOf("function applyNetSuiteWorkOrdersPayload(", appSource.indexOf("function preserveImportedOperationPrices(")),
    )}; return preserveImportedOperationPrices;`,
  )((value) => String(value || "").trim().toUpperCase());

  const local = [
    { id: "op-1", ot: "3424", secuencia: 1, ct: "5458", unitPrice: 320, amount: 11200 },
    { id: "op-2", ot: "3424", secuencia: 2, ct: "5504", unitPrice: 0, amount: 0 },
    { id: "op-3", ot: "3607", secuencia: 1, ct: "5458", unitPrice: 1935, amount: 967500 },
  ];
  const imported = [
    { id: "remote-1", ot: "3424", secuencia: 1, ct: "5458", unitPrice: 0, amount: 0 },
    { id: "remote-2", ot: "3424", secuencia: 2, ct: "5504", unitPrice: 0, amount: 0 },
    { id: "remote-3", ot: "3607", secuencia: 1, ct: "5458", unitPrice: 0, amount: 0 },
    { id: "remote-4", ot: "9999", secuencia: 1, ct: "5458", unitPrice: 0, amount: 0 },
  ];

  const merged = preserveImportedOperationPrices(local, imported);

  assert.equal(merged[0].unitPrice, 320);
  assert.equal(merged[0].amount, 11200);
  assert.equal(merged[1].unitPrice, 320);
  assert.equal(merged[1].amount, 11200);
  assert.equal(merged[2].unitPrice, 1935);
  assert.equal(merged[2].amount, 967500);
  assert.equal(merged[3].unitPrice, 0);
  assert.equal(merged[3].amount, 0);
});

test("la fusion individual conserva unitPrice/amount locales cuando el remoto no trae precios", () => {
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773" }],
      operations: [{
        id: "local-2773-10", ot: "2773", secuencia: 10, ct: "5458",
        unitPrice: 320, amount: 2240, tiempoProd: 8, cantPendiente: 7,
      }],
    },
  });

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2773" },
      operations: [{ id: "remote-2773-10", ot: "2773", secuencia: 10, ct: "5458", tiempoProd: 15, cantPendiente: 7 }],
      materials: [],
    },
  }, "2773");

  assert.equal(merged, true);
  const operation = fixture.state.operations.find((item) => item.ot === "2773");
  assert.equal(operation.unitPrice, 320);
  assert.equal(operation.amount, 2240);
  assert.equal(operation.tiempoProd, 15);
});

test("la sincronizacion de OTs retira cerradas sin reactivar las devueltas a backlog", () => {
  const state = {
    selectedOts: ["200", "300"], lockedOts: ["200"], expandedOts: ["200", "300"],
    lastSchedule: { scheduledOts: ["200", "300"] },
    // El estatus va en `status`, y 300 lo tiene en CERRADA. Antes esta ficha no traia ninguno, y
    // el fixture se cerraba solo: la 300 se iba del payload y el test daba por hecho que eso era
    // cierre. Es la inferencia "ausente del payload = cerrada" que RULE-OT-049 prohibio y que
    // RULE-OT-051 sustituyo por evidencia positiva; el test se legitimaba a si mismo. El hermano
    // de abajo ya se habia corregido con el mismo criterio y su comentario lo dice.
    workOrders: [{ ot: "100" }, { ot: "200" }, { ot: "300", status: "CERRADA" }],
  };
  const applyNetSuiteWorkOrdersPayload = Function(
    "state", "window", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "materialOtKey",
    `${applyWorkOrdersPayloadSource}; return applyNetSuiteWorkOrdersPayload;`,
  )(state, {
    PlanningWorkflowCore: loadWorkflowCore(),
  }, () => {}, () => {}, (value) => String(value || "").trim().toUpperCase());

  applyNetSuiteWorkOrdersPayload({ selectedOts: ["100", "200", "300"], workOrders: [{ ot: "100" }, { ot: "200" }] });

  // plain() porque estas cuatro listas salen del return de reconcileActiveWorkOrders, que corre
  // en el vm del core: lo que se juzga es el contenido, no el realm del Array.
  assert.deepEqual(plain(state.selectedOts), ["200"]);
  assert.deepEqual(plain(state.lockedOts), ["200"]);
  assert.deepEqual(plain(state.expandedOts), ["200"]);
  assert.deepEqual(plain(state.lastSchedule.scheduledOts), ["200"]);
});

test("la carga reconcilia tambien el borrador: la OT cerrada sale de operaciones, cola y resumen", () => {
  const state = {
    selectedOts: ["200", "300"], lockedOts: ["300"], expandedOts: ["300"],
    operations: [
      { id: "op-200", ot: "200", estatus: "PLAN" },
      { id: "op-300", ot: "300", estatus: "PLAN" },
    ],
    operationPlanStatuses: { a: { ot: "300" }, b: { ot: "200" } },
    otConfigurations: { "300": { machine: "M1" } },
    materials: [{ ot: "300", component: "TUBO" }],
    lastSchedule: { scheduledOts: ["200", "300"], generatedAt: "2026-09-25T10:00:00.000Z" },
    // El estatus va en `status`. Antes este fixture no traia ninguno y el comentario decia
    // "300 se cerro en NetSuite": el test legitimaba la inferencia "ausente del payload =
    // cerrada" (RULE-OT-049) en vez de un cierre comprobado.
    workOrders: [{ ot: "200", quantity: 10, status: "ABIERTA" }, { ot: "300", quantity: 5, status: "CERRADA" }],
    closedWorkOrderSummaries: {},
  };
  const applyNetSuiteWorkOrdersPayload = Function(
    "state", "window", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "materialOtKey",
    `${applyWorkOrdersPayloadSource}; return applyNetSuiteWorkOrdersPayload;`,
  )(state, {
    PlanningWorkflowCore: loadWorkflowCore(),
  }, () => {}, () => {}, (value) => String(value || "").trim().toUpperCase());

  // 300 se cerro en NetSuite y su ficha lo dice: solo viene la 200.
  applyNetSuiteWorkOrdersPayload({ workOrders: [{ ot: "200", quantity: 10, status: "ABIERTA" }] });

  // Sin operaciones y sin work order, getPriorityJobs() deja de crear un trabajo para la
  // OT (app.js:11676-11683), asi que tampoco reaparece en "trabajos en espera".
  // plain() en las listas: salen del return de reconcileActiveWorkOrders, que corre en el vm.
  assert.deepEqual(plain(state.operations.map((op) => op.id)), ["op-200"]);
  assert.deepEqual(plain(state.workOrders.map((wo) => wo.ot)), ["200"]);
  assert.deepEqual(plain(state.selectedOts), ["200"]);
  assert.deepEqual(plain(state.lockedOts), []);
  assert.deepEqual(plain(state.expandedOts), []);
  assert.deepEqual(plain(state.lastSchedule.scheduledOts), ["200"]);
  assert.equal(state.lastSchedule.generatedAt, "2026-09-25T10:00:00.000Z");
  assert.deepEqual(Object.keys(state.operationPlanStatuses), ["b"]);
  assert.deepEqual(plain(state.otConfigurations), {});
  assert.deepEqual(plain(state.materials), []);
  // El historial no se pierde: queda el resumen compacto de la cerrada.
  assert.equal(state.closedWorkOrderSummaries["300"].finalStatus, "CERRADA");
  assert.equal(state.closedWorkOrderSummaries["300"].quantity, 5);
  assert.equal(state.closedWorkOrderSummaries["300"].closedDetectedAt, state.syncedAt);
});

test("la carga no toca el borrador de una OT que NetSuite sigue reportando abierta", () => {
  const state = {
    selectedOts: ["200"],
    operations: [
      { id: "op-200", ot: "200", estatus: "PLAN" },
      { id: "op-300", ot: "300", estatus: "PLAN" },
    ],
    otConfigurations: { "300": { machine: "M1" } },
    workOrders: [{ ot: "200", quantity: 10 }],
  };
  const applyNetSuiteWorkOrdersPayload = Function(
    "state", "window", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "materialOtKey",
    `${applyWorkOrdersPayloadSource}; return applyNetSuiteWorkOrdersPayload;`,
  )(state, {
    PlanningWorkflowCore: loadWorkflowCore(),
  }, () => {}, () => {}, (value) => String(value || "").trim().toUpperCase());

  // 300 no estaba en la lista anterior (llego despues), asi que no es una cerrada.
  applyNetSuiteWorkOrdersPayload({ workOrders: [{ ot: "200", quantity: 10 }, { ot: "300", quantity: 7 }] });

  assert.deepEqual(state.operations.map((op) => op.id), ["op-200", "op-300"]);
  assert.deepEqual(plain(state.otConfigurations), { "300": { machine: "M1" } });
  assert.deepEqual(plain(state.closedWorkOrderSummaries), {});
  // plain() como en las dos aserciones de arriba: state.workOrders ahora viene del return de
  // reconcileActiveWorkOrders, que se ejecuta en el vm del core, y .map sobre un array de vm
  // devuelve un array de vm. El CONTENIDO es el que se comprueba; la diferencia de realm no es
  // un fallo de la app.
  assert.deepEqual(plain(state.workOrders.map((wo) => wo.ot)), ["200", "300"]);
});

test("la sincronizacion persiste el precio de venta en referenceSalePrice, separado del manual (RULE-REP-021)", () => {
  // Antes este test afirmaba que el sync escribia el precio de venta en manualUnitPrice con un
  // max que solo subia. Eso hacia que un precio de venta equivocado quedara pegado en CONFIG
  // y el reporte lo tomara por un precio escrito por una persona. Ver RULE-REP-021.
  const persistSource = appSource.slice(
    appSource.indexOf("function persistReferencePricesFromSync("),
    appSource.indexOf("function setNetSuiteSyncPhaseLabel("),
  );
  const saves = [];
  const state = {
    workOrders: [
      { ot: "3386", item: "C 490 UADE PN", lastSalePrice: 725.19, averageSalePrice: 742.09 },
      { ot: "3607", item: "TRA 500", lastSalePrice: 1935, averageSalePrice: 0 },
      { ot: "3608", item: "SIN PRECIO", lastSalePrice: 0, averageSalePrice: 0 },
      { ot: "3609", item: "RESIDUAL", lastSalePrice: 0.05, averageSalePrice: 0 },
      { ot: "3610", item: "MANUAL MAYOR", lastSalePrice: 100, averageSalePrice: 0 },
    ],
    operations: [],
    articleConfigurations: {
      "MANUAL MAYOR": { article: "MANUAL MAYOR", manualUnitPrice: 500, referenceSalePrice: 0, jobType: "", planningType: "", updatedAt: "" },
    },
  };
  const articleKeyForPart = (part) => String(part || "").trim().toUpperCase();
  const articleConfigurationFor = (part) => {
    const article = articleKeyForPart(part);
    if (!state.articleConfigurations[article]) {
      state.articleConfigurations[article] = { article, jobType: "", planningType: "", manualUnitPrice: 0, referenceSalePrice: 0, updatedAt: "" };
    }
    return state.articleConfigurations[article];
  };
  const persistReferencePricesFromSync = Function(
    "state", "articleKeyForPart", "articleConfigurationFor", "articleForOt", "queueAppSheetSave",
    `${persistSource}; return persistReferencePricesFromSync;`,
  )(
    state,
    articleKeyForPart,
    articleConfigurationFor,
    (ot) => state.workOrders.find((item) => item.ot === ot)?.item || "",
    (scope) => saves.push(scope),
  );

  assert.equal(persistReferencePricesFromSync(), true);

  // El precio de venta va a SU campo, tomando el mayor entre ultima venta y promedio.
  assert.equal(state.articleConfigurations["C 490 UADE PN"].referenceSalePrice, 742.09);
  assert.equal(state.articleConfigurations["TRA 500"].referenceSalePrice, 1935);
  // Y NO pisa el precio que escribio una persona, ni para bajarlo ni para subirlo.
  assert.equal(state.articleConfigurations["MANUAL MAYOR"].manualUnitPrice, 500);
  assert.equal(state.articleConfigurations["MANUAL MAYOR"].referenceSalePrice, 100);
  // Articulos sin precio de venta no crean configuracion.
  assert.equal(state.articleConfigurations["SIN PRECIO"], undefined);
  assert.equal(state.articleConfigurations["RESIDUAL"], undefined);
  // manualUnitPrice sigue en 0 en los que solo tienen precio de venta: el sync no lo escribe.
  assert.equal(state.articleConfigurations["C 490 UADE PN"].manualUnitPrice, 0);
  assert.equal(state.articleConfigurations["TRA 500"].manualUnitPrice, 0);
  assert.ok(state.articleConfigurations["C 490 UADE PN"].updatedAt);
  assert.deepEqual(saves, ["catalogs"]);

  // Sin cambios la segunda vez, no se vuelve a guardar la hoja.
  assert.equal(persistReferencePricesFromSync(), false);
  assert.deepEqual(saves, ["catalogs"]);
});

test("syncNetSuiteData persiste precios de referencia tras aplicar el payload de NetSuite", async () => {
  const syncSource = appSource.slice(
    appSource.indexOf("async function syncNetSuiteData("),
    appSource.indexOf("function validateNetSuiteImportedData("),
  );
  assert.match(syncSource, /persistReferencePricesFromSync\(\);\s*\n\s*clearNetSuiteSyncAlert\(\);/);
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

  const previousRenderFns = {
    renderTop: globalThis.renderTop,
    renderPlanAlerts: globalThis.renderPlanAlerts,
    renderDraftExecutiveSummary: globalThis.renderDraftExecutiveSummary,
    renderGantt: globalThis.renderGantt,
  };
  globalThis.renderTop = () => {};
  globalThis.renderPlanAlerts = () => {};
  globalThis.renderDraftExecutiveSummary = () => {};
  globalThis.renderGantt = () => {};
  try {
    applyInitialWorkspaceView({ scrollToTop: true });
  } finally {
    for (const [name, fn] of Object.entries(previousRenderFns)) {
      if (fn === undefined) delete globalThis[name];
      else globalThis[name] = fn;
    }
  }

  assert.deepEqual(scrolls, [{ top: 0, behavior: "auto" }]);
});

test("el arranque remoto conserva la OT de detalle y la operacion seleccionada", async () => {
  // MEDIDO 2026-09-30: el arranque leia state.workOrders.length para decidir si el sync muestra
  // mensaje, y este estado de prueba no traia workOrders. No se notaba porque la llamada estaba
  // en la rama verdadera de un ternario con isAppsScriptRuntime(), que el arnes fijaba en false.
  // Al quitar esa compuerta (RULE-SUP-030) el argumento se evalua siempre. El estado real de la
  // app SI trae workOrders porque normalizeState() lo garantiza: lo que faltaba era el fixture.
  const state = { selectedDetailOt: "2773", selectedOperationId: "duplicada", workOrders: [] };
  const renderOptions = [];
  const workspaceOptions = [];
  let bootSyncCalls = 0;
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
    () => { bootSyncCalls += 1; return Promise.resolve(true); },
    () => Promise.resolve(null),
    () => {},
  );

  await loadAppStateInBackground();

  // El sync de arranque tiene que ocurrir. Antes lo compuerteaba isAppsScriptRuntime(), que en el
  // sitio estatico da false, o sea que la pagina abria sin pedir OTs a Supabase nunca.
  assert.equal(bootSyncCalls, 1, "el arranque tiene que lanzar el sync de OTs");
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
    id: "planned-2773-10", ot: "2773", secuencia: 10, ct: "5458", descripcion: "CORTE NETSUITE",
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

test("cerrar el detalle limpia la OT y la operacion seleccionada sin render global", () => {
  const handler = appSource.match(/els\.closeDetailPanelBtn\.addEventListener\("click", \(\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(handler);
  assert.match(handler[1], /closeSelectedJobDetail\(\)/);
  assert.doesNotMatch(handler[1], /render\(\)/);
  const fn = appSource.match(/function closeSelectedJobDetail\(\) \{([\s\S]*?)\n}/);
  assert.ok(fn);
  const state = { selectedDetailOt: "2773", selectedOperationId: "duplicada" };
  const calls = [];
  const close = Function("state", "saveState", "document", "els", "applyGanttSelection",
    `return () => {${fn[1]}};`)(
    state,
    () => calls.push("save"),
    undefined,
    { selectedJobPanel: { innerHTML: "x" } },
    (ot) => calls.push("gantt:" + ot),
  );
  close();

  assert.equal(state.selectedDetailOt, "");
  assert.equal(state.selectedOperationId, "");
  assert.deepEqual(calls, ["gantt:", "save"]);
});

test("abrir el detalle carga operaciones sin perder la seleccion", () => {
  assert.match(detailSelectionSource, /renderSelectedJobPanel\(\);\s*void loadSelectedJobDetailOperations\(ot\)/);
  assert.match(detailOperationsSource, /ensureWorkOrderPlanningData\(ot, \{ skipWhenLocal: true \}\)/);
  assert.match(detailOperationsSource, /renderSelectedJobPanel\(\)/);
});

test("abrir el detalle con operaciones locales no usa red", async () => {
  let calls = 0;
  const fixture = loadClient({
    installDetailOperations: true,
    state: { operations: [{ id: "2773-1", ot: "2773", ct: "CORTE", tiempoProd: 10 }], workOrders: [{ ot: "2773" }] },
    callAppsScript: async () => { calls += 1; return { ok: true }; },
  });
  fixture.context.getSelectedPriorityJob = () => ({ ot: "2773" });
  fixture.context.materialOtKey = (value) => String(value || "");
  fixture.context.renderSelectedJobPanel = () => {};

  const result = await fixture.context.loadSelectedJobDetailOperations("2773");

  assert.deepEqual(plain(result), { ready: true, source: "cached" });
  assert.equal(calls, 0);
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
  assert.deepEqual(toasts, ["OT 2773 agregada al plan y guardada"]);
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

test("la fusion individual adopta precio remoto positivo cuando el local esta en 0", () => {
  const fixture = loadClient({
    installIndividualPlanning: true,
    state: {
      workOrders: [{ ot: "2773", item: "OLD", lastSalePrice: 0, averageSalePrice: 0, dueDateOverride: "2026-08-01" }],
      operations: [],
    },
  });

  const merged = fixture.context.mergeIndividualPlanningData({
    data: {
      workOrder: { ot: "2773", item: "NEW", lastSalePrice: 320, averageSalePrice: 410 },
      operations: [{ id: "valid", ot: "2773", ct: "CORTE", tiempoProd: 10 }],
      materials: [],
    },
  }, "2773");

  assert.equal(merged, true);
  const workOrder = fixture.state.workOrders.find((item) => item.ot === "2773");
  assert.equal(workOrder.lastSalePrice, 320);
  assert.equal(workOrder.averageSalePrice, 410);
  assert.equal(workOrder.dueDateOverride, "2026-08-01");
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
    // DECIDIDO 2026-09-30: el sync escribe en SUPABASE. El puente se queda con la lectura
    // de NetSuite, que es la unica puerta que hay a NetSuite.
    revisionAlGuardar: 2,
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
        // Una OT que no vino en el payload y no tiene evidencia de cierre. Viaja en el mismo
        // payload que las de closedWorkOrderSummaries, y por la misma razon: si no llega a la
        // hoja, al recargar se pierde y la OT se cae de la cola (RULE-OT-051).
        unconfirmedWorkOrders: { "WO-SIN-FICHA": { ot: "WO-SIN-FICHA", firstSeenAt: "2026-08-01T00:00:00.000Z", lastSeenAt: "2026-08-01T00:00:00.000Z", misses: 2 } },
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

  const informe = await fixture.context.syncBacklogWorkOrders();

  assert.deepEqual(timeouts, [180000]);
  // El estado se reconcilia y se depura UNA vez: antes se hacia dos porque el estado se
  // guardaba con un payload a mano y despues se volvia a reconciliar sobre el estado viejo.
  assert.equal(reconciliations, 1);
  assert.equal(purges, 1);
  assert.equal(dialogs, 0);
  assert.deepEqual(calls.map(([method]) => method), ["fetchNetSuiteWorkOrdersLite"]);
  assert.equal(fixture.callsSupabase.filter((c) => c.method === "guardarPlanEnSupabase").length, 1);
  assert.equal(informe.persistido, true);
  // Lo que se sube es el estado RECONCILIADO, con las marcas de OT y el resumen de las
  // cerradas. Antes esto viajaba en el payload de `saveWorkOrderSyncState`; ahora viaja en
  // el estado que mapea PPSupabaseWriter (filasUnconfirmedWorkOrders y
  // filasClosedWorkOrderSummaries en supabase-writer.js).
  const guardado = fixture.callsSupabase.find((c) => c.method === "guardarPlanEnSupabase");
  assert.deepEqual(guardado.estado.workOrders, [{ ot: "WO-ACTIVA", item: "ACTIVA" }]);
  assert.deepEqual(guardado.estado.operations, [{ id: "done", ot: "WO-CERRADA", status: "COMPLETADA_PLAN" }]);
  assert.deepEqual(guardado.estado.materials, []);
  assert.deepEqual(guardado.estado.retentionPurged, true);
  assert.deepEqual(guardado.estado.closedWorkOrderSummaries, { "WO-CERRADA": { ot: "WO-CERRADA", finalStatus: "CERRADA" } });
  assert.deepEqual(guardado.estado.unconfirmedWorkOrders, {
    "WO-SIN-FICHA": { ot: "WO-SIN-FICHA", firstSeenAt: "2026-08-01T00:00:00.000Z", lastSeenAt: "2026-08-01T00:00:00.000Z", misses: 2 },
  });
  assert.equal(guardado.estado.syncedAt, "2026-08-01T00:00:00.000Z");
  assert.deepEqual(plain(fixture.context.state.workOrders), [{ ot: "WO-ACTIVA", item: "ACTIVA" }]);
  assert.deepEqual(plain(fixture.context.state.operations), [{ id: "done", ot: "WO-CERRADA", status: "COMPLETADA_PLAN" }]);
  assert.deepEqual(plain(fixture.context.state.materials), []);
  assert.equal(fixture.context.state.retentionPurged, true);
  // La revision que devuelve el escritor se guarda en el estado, para que el siguiente
  // guardado mande la correcta y no choque contra si mismo.
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

test("un fallo al guardar sincronizacion conserva la cache de materiales y avisa que no subio", async () => {
  let materialCalls = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    // DECIDIDO 2026-09-30: el guardado del sync va a Supabase. El fallo se provoca ahi,
    // no en un metodo del puente que ya no existe en este camino.
    guardarFalla: true,
    state: { workOrders: [{ ot: "WO-1" }], materials: [] },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders, materials: current.materials }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      if (method === "getMaterialsForOt") {
        materialCalls += 1;
        return { materials: [{ ot: "WO-1", component: "CONSERVAR" }] };
      }
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-2" }] };
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

  const informe = await fixture.context.syncBacklogWorkOrders();

  assert.equal(informe.persistido, false, "las OTs se leyeron pero el estado no subio");
  // Y la persona tiene que enterarse de que leer no es guardar: sin este aviso, el toast de
  // "OTs sincronizadas" haria creer que el estado subio.
  assert.ok(
    fixture.toasts.some((t) => t.includes("NO se guardo")),
    `esperaba el aviso de estado no guardado; hubo: ${JSON.stringify(fixture.toasts)}`,
  );
  // LO QUE ESTE TEST PROTEGE: la cache de materiales que se pidio bajo demanda NO se
  // invalida por un fallo de guardado. Un guardado fallido no puede cobrarle a la persona
  // una segunda consulta al servidor por una OT que sigue abierta. (Despues del sync la
  // lista de OTs es OTRA, asi que pedir de nuevo para la OT nueva es lo correcto y no se
  // comprueba aqui.)
  assert.equal(materialCalls, 1);
  // Lo que el sync SI cambia, y es lo correcto: la lista de OTs es la que NetSuite acaba de
  // decir. Antes estas no se aplicaban al fallar el guardado, porque la lectura se aplicaba
  // DESPUES de guardar; con el estado aplicandose antes (para que sea el que se sube) la OT
  // leida se conserva. Deshacerla seria mostrar una cola que NetSuite ya desmintio.
  assert.deepEqual(plain(fixture.context.state.workOrders), [{ ot: "WO-2" }]);
  // Y lo que la persona habia escrito sigue ahi: el sync no toca el resto del estado.
  assert.equal(fixture.context.state.revision, beforeFailure.revision);
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
  // DECIDIDO 2026-09-30: lo que se guarda va a Supabase, no por un metodo del puente. Por eso
  // la lista del puente no crece: solo se leyo de NetSuite.
  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite"]);
  assert.equal(fixture.callsSupabase.filter((c) => c.method === "guardarPlanEnSupabase").length, 1);
  assert.deepEqual(fixture.backlogBusyStates, [true, false]);
});

test("la sincronizacion conserva una edicion local hecha mientras espera el guardado dedicado", async () => {
  const gate = deferredPromise();
  const fixture = loadClient({
    installBacklogSync: true,
    // El guardado se demora: la edicion local tiene que sobrevivirlo.
    guardarEspera: gate,
    revisionAlGuardar: 2,
    state: { workOrders: [{ ot: "WO-CERRADA" }], settings: { local: "antes" } },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      return { revision: 2 };
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders, closedWorkOrderSummaries: {} }),
    purgeClosedWorkOrderRetention: (current) => current,
  });

  const sync = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  fixture.context.state.settings = { local: "durante" };
  gate.resolve();
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
    // DECIDIDO 2026-09-30: el guardado del sync va a Supabase y se demora. La deteccion del
    // cierre tiene que quedar con LA HORA EN LA QUE SE DETECTO, no con la del guardado: si se
    // recalculara al guardar, el reloj de la deteccion seria mentira.
    guardarEspera: dedicated,
    state: { workOrders: [{ ot: "WO-CERRADA" }] },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      return { revision: 2 };
    },
    reconcileActiveWorkOrders: (current, workOrders, nowIso) => {
      detectionTimes.push(nowIso);
      return { ...current, workOrders, closedWorkOrderSummaries: { "WO-CERRADA": { closedDetectedAt: nowIso } } };
    },
    purgeClosedWorkOrderRetention: (current) => current,
  });

  const sync = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  dedicated.resolve();
  await sync;

  assert.equal(detectionTimes.length, 1, "se reconcilia una vez: la deteccion no se repite");
  assert.equal(fixture.context.state.closedWorkOrderSummaries["WO-CERRADA"].closedDetectedAt, detectionTimes[0]);
});

test("el sync espera el guardado en curso antes de tomar la compuerta", async () => {
  const guardado = deferredPromise();
  const calls = [];
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    // DECIDIDO 2026-09-30: lo que se guarda durante el sync va a Supabase. El metodo del
    // puente que se demoraba (`saveWorkOrderSyncState`) ya no existe en este camino.
    guardarEspera: guardado,
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
      return { revision: 3 };
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  fixture.context.appSheetDirtyScopes.add("plan");
  const normalSave = fixture.context.saveAppSheet(false);
  await settleMicrotasks();

  const sync = fixture.context.syncBacklogWorkOrders();
  await settleMicrotasks();
  // El sync llego a pedir las OTs pero NO puede tomar la compuerta: el guardado sigue en vuelo.
  // Y lo que se guarda ya no es un job de Hojas: el unico metodo del puente es la lectura.
  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite"]);
  assert.equal(fixture.context.appSheetSaveInFlight, true);

  guardado.resolve();
  await normalSave;
  await settleMicrotasks();
  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite"]);
  assert.ok(
    fixture.callsSupabase.some((c) => c.method === "guardarPlanEnSupabase"),
    "el sync dejo el estado en Supabase",
  );
  await sync;
});

test("FUERA de Apps Script el guardado optimized delega en app.js y no toca el puente", async () => {
  // MEDIDO 2026-09-29 en el navegador real (sitio estatico, sesion de Supabase): con
  // `isAppsScriptRuntime()` dando TRUE por el predicado mentiroso del puente, el guardado
  // optimized se saltaba originalSaveAppSheet (el de app.js, que sube el plan a Supabase y
  // despues los catalogos) y entraba directo a `callAppsScript`, o sea a subir el plan por un
  // iframe que en GitHub Pages no escribe las Hojas. El plan no se guardaba y los catalogos
  // no se subian nunca. Este es el escenario que el navegador mostro y que faltaba cubrir.
  const calls = [];
  const fixture = loadClient({
    runtimeDeAppscript: false,
    callAppsScript: async (method, payload) => {
      calls.push({ method, payload });
      return { revision: 2 };
    },
  });

  const resultado = await fixture.context.saveAppSheet(true);

  assert.equal(resultado, true, "el guardado de app.js es el que decide el resultado");
  assert.equal(fixture.saveAppSheetDelegaciones, 1, "tiene que delegar en el guardado de app.js");
  assert.deepEqual(calls, [], "y no puede escribir por el puente: ahi es un iframe, no el runtime");
});

test("DENTRO de Apps Script el guardado optimized tambien va a Supabase", async () => {
  // DECIDIDO 2026-09-30 (pregunta al usuario): el destino de la escritura es UNO SOLO,
  // Supabase, tambien dentro de HtmlService. Antes este test fijaba lo contrario
  // (`savePlanningStateOptimized` por el puente nativo) y con el los jobs de Hojas
  // seguian vivos; ahora la rama que los armaba se retiro de performance-client.js.
  const calls = [];
  const fixture = loadClient({
    runtimeDeAppscript: true,
    callAppsScript: async (method, payload) => {
      calls.push({ method, payload });
      return { revision: 2 };
    },
  });

  const resultado = await fixture.context.saveAppSheet(true);

  assert.equal(resultado, true);
  assert.equal(fixture.saveAppSheetDelegaciones, 1, "dentro de HtmlService tambien delega en app.js");
  assert.deepEqual(calls, [], "y no escribe por el puente: el plan va a Supabase en los dos runtimes");
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

test("la edicion pendiente antes y durante el sync se guarda despues del acuse", async () => {
  const timers = new Map();
  const calls = [];
  const dedicated = deferredPromise();
  let timerId = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    // DECIDIDO 2026-09-30: lo que se guarda durante el sync va a Supabase, y es ese
    // guardado el que se demora esperando el acuse.
    guardarEspera: dedicated,
    callAppsScript: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
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
  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite"]);

  dedicated.resolve();
  await sync;
  await runTimers();

  // DECIDIDO 2026-09-30: lo que se guarda despues del acuse va a Supabase, no por un job de
  // Hojas. El unico metodo del puente en toda la secuencia es la lectura de OTs.
  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite"]);
  assert.ok(fixture.saveAppSheetDelegaciones >= 1, "y el plan se subio a Supabase");
  assert.ok(
    fixture.callsSupabase.some((c) => c.method === "guardarPlanEnSupabase"),
    "y el sync subio su estado a Supabase",
  );
});

test("un debounce completado no programa un guardado extra al sincronizar OTs", async () => {
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    callAppsScript: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
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
  const guardadosAntesDelSync = fixture.callsSupabase.filter((c) => c.method === "guardarPlanEnSupabase").length;
  await fixture.context.syncBacklogWorkOrders();
  await runTimers();

  // El debounce ya habia guardado antes del sync, asi que al terminar el sync el unico
  // guardado que queda es el del propio sync; no se anade uno extra de Hojas.
  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite"]);
  assert.equal(
    fixture.callsSupabase.filter((c) => c.method === "guardarPlanEnSupabase").length,
    guardadosAntesDelSync + 1,
    "el sync guarda una vez en Supabase",
  );
});

test("un fallo del sync libera la compuerta para el siguiente guardado", async () => {
  const timers = new Map();
  const calls = [];
  let timerId = 0;
  // DECIDIDO 2026-09-30: el guardado del sync falla en SUPABASE, no por el puente: el
  // metodo `saveWorkOrderSyncState` que antes se hacia fallar ya no existe en este camino.
  const fixture = loadClient({
    installBacklogSync: true,
    installSaveGate: true,
    guardarFalla: true,
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
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

  // El guardado posterior al fallo del sync ya no es un job de Hojas: el puente solo se
  // vio para leer OTs, y el plan se sigue guardando por Supabase.
  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite"]);
  assert.ok(fixture.saveAppSheetDelegaciones >= 1, "y el plan se subio a Supabase");
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
  // DECIDIDO 2026-09-30: el guardado del sync ya no es un metodo del puente. Ahora es
  // `guardarPlanEnSupabase`, el MISMO que usa el guardado normal, y por eso este doble tiene
  // que poder distinguir las dos llamadas: la primera (del sync) se demora en `dedicated`, y
  // la segunda (el guardado normal que quedo pendiente) tiene que salir DESPUES del acuse.
  // Antes se distinguian por el metodo del puente; ahora se distinguen por el orden y por
  // `concurrent`, que se lee al ENTRAR, no al salir.
  let guardadosSupabase = 0;
  const guardarPlanEnSupabase = async () => {
    guardadosSupabase += 1;
    const habiaPendiente = dedicatedPending;
    // La llamada se anota AL ENTRAR, no al salir: mientras el guardado del sync esta en vuelo
    // ya esta pasando, y un test que lo mira al salir no podria distinguir "todavia no empezo"
    // de "empezo y no ha vuelto".
    calls.push({ method: "guardarPlanEnSupabase", payload: { revision: flow.state.revision }, concurrent: habiaPendiente });
    if (guardadosSupabase === 1) {
      dedicatedPending = true;
      await dedicated.promise;
      dedicatedPending = false;
      // El escritor devuelve la revision nueva y el estado la guarda, para que el siguiente
      // guardado mande la correcta.
      flow.state.revision = 2;
    }
    return true;
  };
  // El doble de la fuente remota. Antes interceptaba `callAppsScript`; con el puente
  // deshabilitado lo comparten las dos puertas: la vieja (que ya no usa nadie en este
  // arnes) y `PPSupabaseBridgeReplacement`, que es por donde app.js lee las OTs ahora.
  const dupla = async (method, payload) => {
    calls.push({ method, payload, concurrent: dedicatedPending });
    if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-ACTIVA" }] };
    if (method === "saveWorkOrderSyncState") { dedicatedPending = true; const saved = await dedicated.promise; dedicatedPending = false; return saved; }
    return { revision: 3 };
  };
  const flow = Function(
    "window", "state", "localStorage", "STORAGE_KEY", "appSheetAvailable", "appSheetSaveInFlight", "appSheetSavePending", "appSheetSaveTimer", "appSheetDirtyScopes", "backlogSyncInFlight", "appSheetSaveCompletion", "resolveAppSheetSaveCompletion", "appSheetSaveOwner",
    "operationStatusSavesInFlight", "isAppsScriptRuntime", "callAppsScript", "createAppSheetPayload", "showToast", "NETSUITE_BACKLOG_SYNC_TIMEOUT_MS",
    "setBacklogSyncInFlight", "validateNetSuiteImportedData", "invalidateCurrentPlanOperationsCache", "resetBacklogWindow", "render", "persistableState",
    "appSheetDisponible", "guardarPlanEnSupabase", "guardarCatalogosEnSupabase",
    // MEDIDO 2026-09-29 en el navegador: `isAppsScriptRuntime` miente en el sitio estatico
    // (los dos instaladores lo dejan en "el puente esta configurado"), y por eso el guardado
    // del plan se iba por callAppsScript. `enRuntimeAppsScript` es el predicado que responde
    // la pregunta de verdad: google.script.run solo existe dentro de HtmlService. El cuerpo
    // de este Function incluye saveAppSheet de app.js, que lo llama.
    "enRuntimeAppsScript",
    // MEDIDO 2026-09-30: el puente quedo deshabilitado. La lectura de OTs del sync ya no va
    // por `callAppsScript("fetchNetSuiteWorkOrdersLite")` sino por
    // `PPSupabaseBridgeReplacement.fetchNetSuiteWorkOrdersLite()`.
    "PPSupabaseBridgeReplacement",
    `${appSheetSaveFlowSource}\n${backlogSyncSource}\nreturn {
      syncBacklogWorkOrders, saveState,
      get state() { return state; },
      get inFlight() { return appSheetSaveInFlight; },
      get pending() { return appSheetSavePending; },
    };`,
  )(
    window, { revision: 1, workOrders: [{ ot: "WO-LOCAL" }], operations: [], materials: [] }, { setItem: () => {} }, "test",
    true, false, false, null, new Set(), false, Promise.resolve(), null, null, 0, () => true,
    dupla,
    () => ({ revision: flow?.state?.revision }), () => {}, 60000,
    () => {}, () => {}, () => {}, () => {}, () => {}, () => ({}),
    // La puerta real de app.js; aqui el destino esta disponible.
    () => true,
    guardarPlanEnSupabase, async () => true,
    () => true,
    // La puerta de Supabase, atada al mismo doble que antes interceptaba el puente.
    { fetchNetSuiteWorkOrdersLite: (...args) => dupla("fetchNetSuiteWorkOrdersLite", ...args) },
  );
  const runTimers = async () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
    await settleMicrotasks();
  };

  const sync = flow.syncBacklogWorkOrders();
  await settleMicrotasks();
  flow.saveState("plan");
  await runTimers();

  // Lo unico que hay en vuelo es el guardado DEL SYNC: el guardado normal que la edicion
  // encoló no salio, porque espera a que el sync suelte la compuerta.
  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite", "guardarPlanEnSupabase"]);
  assert.equal(calls[1].concurrent, false);
  dedicated.resolve({ revision: 2 });
  await sync;
  await runTimers();

  assert.deepEqual(calls.map((call) => call.method), ["fetchNetSuiteWorkOrdersLite", "guardarPlanEnSupabase", "guardarPlanEnSupabase"]);
  assert.equal(calls[2].concurrent, false, "el guardado normal no se solapo con el del sync");
  // Con la revision que devolvio el guardado del sync, no la de antes del sync.
  assert.equal(calls[2].payload.revision, 2);
});

test("un fallo al guardar el sync no deshace la lectura de NetSuite ni el estado local", async () => {
  const fixture = loadClient({
    installBacklogSync: true,
    // DECIDIDO 2026-09-30: el guardado del sync va a Supabase; el fallo se provoca ahi.
    // Antes fallaba el metodo del puente (`saveWorkOrderSyncState`) y por eso el estado
    // llegaba intacto: la lectura se aplicaba DESPUES de guardar, y el fallo la cancelaba.
    guardarFalla: true,
    state: { workOrders: [{ ot: "WO-LOCAL" }], settings: { local: "conservar" } },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-REMOTA" }] };
      throw new Error("guardar fallo");
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  const before = plain(fixture.context.state);

  const informe = await fixture.context.syncBacklogWorkOrders();

  // LAS OTs QUE VINIERON DE NETSUITE NO SE TIRAN. El estado se aplica antes de guardar (por
  // eso es el que se sube), y un fallo de escritura no es motivo para mostrar una cola vieja:
  // la OT cerrada que NetSuite ya dio por cerrada volveria a la cola hasta el proximo sync.
  assert.deepEqual(plain(fixture.context.state.workOrders), [{ ot: "WO-REMOTA" }]);
  // Y lo que la persona escribio se conserva igual.
  assert.deepEqual(plain(fixture.context.state.settings), before.settings);
  // Lo que no se puede prometer es que quedara guardado, y se dice.
  assert.equal(informe.persistido, false);
  assert.ok(
    fixture.toasts.some((message) => message.includes("NO se guardo")),
    `esperaba el aviso de estado no guardado; hubo: ${JSON.stringify(fixture.toasts)}`,
  );
});

test("EL SYNC DEL BOTON LIMPIA EL AVISO DE SINCRONIZACION CUANDO TERMINA BIEN", async () => {
  // ANTES: clearNetSuiteSyncAlert() solo se llamaba DENTRO del if (isAppsScriptRuntime()) de
  // syncNetSuiteData, y en GitHub Pages isAppscriptRuntime() es false (la pagina se sirve desde
  // Pages y el backend va por el puente). El sync del boton (syncBacklogWorkOrders) no lo llamaba
  // en ningun camino. Resultado medido el 2026-09-27: un sync fallado dejaba un aviso CRITICO de
  // "Sincronizacion NetSuite" pegado en #planAlerts para siempre, y un sync exitoso por el boton no
  // lo quitaba tampoco.
  const fixture = loadClient({
    installBacklogSync: true,
    state: { selectedOts: ["200"], workOrders: [{ ot: "200" }] },
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") {
        return { syncedAt: "2026-09-27T22:00:00.000Z", workOrders: [{ ot: "200", status: "EN PROCESO" }], operations: [{ id: "o1", ot: "200" }] };
      }
      if (method === "saveWorkOrderSyncState") return { ok: true, revision: 2 };
      return { ok: true };
    },
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
  });
  fixture.context.state.netSuiteSyncAlert = { message: "Otro proceso esta actualizando el plan", updatedAt: "2026-09-27T21:00:00Z" };

  const resultado = await fixture.context.syncBacklogWorkOrders();

  assert.equal(resultado.ok, true);
  assert.equal(fixture.context.state.netSuiteSyncAlert, null, "el aviso se limpia: antes quedaba pegado para siempre");
});

test("SI EL ESTADO NO LLEGA, LA PANTALLA SE HIDRATA CON LA CACHE LOCAL (Y SE AVISA)", async () => {
  // ANTES: loadState() devuelve deepClone(sampleState) y sampleState NO trae selectedOts. Si
  // getAppState agota los 120 s, el catch de loadAppStateInBackground solo escribe un console.warn
  // y state queda en sampleState: la pantalla no muestra NADA de lo que la persona dejo, y lo unico
  // que aparece es lo que rescata el borrador sobre fichas de demostracion. Medido el 2026-09-27:
  // 20 OTs en la cola (las del borrador) y getAppState agotando 120 004 ms, 4 veces.
  //
  // Se prueba por el camino real (loadAppStateInBackground), no llamando a la funcion: esa vive
  // dentro del IIFE de performance-client.js y no es global en el arnes.
  const fixture = loadClient({
    state: { revision: 0, selectedOts: ["DEMO"], workOrders: [{ ot: "DEMOSTRACION" }] },
    callAppsScript: async () => { throw new Error("Tiempo agotado al ejecutar getAppState"); },
    // El boot hace una llamada flotante a syncNetSuiteData despues de que el test termina; en
    // produccion es la real, aqui se stubba para que no rechace.
    syncNetSuiteData: async () => ({}),
  });
  fixture.context.localStorage.setItem(fixture.context.STORAGE_KEY, JSON.stringify({
    revision: 4078,
    savedAt: "2026-09-27T20:00:00.000Z",
    selectedOts: ["200", "300"],
    workOrders: [{ ot: "200" }, { ot: "300" }],
    operations: [],
    materials: [],
  }));

  await fixture.context.loadAppStateInBackground();

  // plain() porque state.selectedOts ahora es un Array del vm (JSON.parse dentro del contexto) y
  // deepEqual estricto compara prototipos. El archivo ya usa plain() para esto.
  assert.deepEqual(plain(fixture.context.state.selectedOts), ["200", "300"], "la cola viene de la cache, no la de demostracion");
  assert.equal(fixture.context.state.workOrders.length, 2, "y las fichas");
  assert.equal(fixture.context.state.operations.length, 0, "operations vacio a proposito: la rescata el borrador");
  assert.equal(fixture.context.state.fromLocalCache, true, "y queda marcado para el aviso permanente");
});
test("LA RAMA DE NAVEGADOR DE syncNetSuiteData YA NO PIDE UN JSON ESTATICO QUE 404", () => {
  // fetchNetSuiteExercise() pide /api/netsuite-exercise y data/netsuite-exercise.json, y en GitHub
  // Pages ambos responden 404 (medido el 2026-09-27: "Site not found" / "Page not found"; ningun
  // archivo esta en el repo). Asi que syncNetSuiteData en el navegador estaba condenada a fallar.
  const i = appSource.indexOf("async function syncNetSuiteData(");
  assert.ok(i > 0, "no se encontro syncNetSuiteData");
  const cuerpo = appSource.slice(i, i + 4000);
  // Se prohíbe la LLAMADA, no la definicion: fetchNetSuiteExercise() sigue existiendo y se usa en
  // loadAppSheetIfAvailable, que es otro camino. Antes la rama de navegador la llamaba y por eso
  // siempre recibia 404.
  assert.doesNotMatch(cuerpo, /await fetchNetSuiteExercise\(\)/, "la rama de navegador ya no la llama");
  assert.match(cuerpo, /PPSupabaseBridgeReplacement\.syncNetSuiteWorkOrders\(\)/, "el modo workOrders va por Supabase");
  assert.match(cuerpo, /PPSupabaseBridgeReplacement\.syncNetSuitePlant\(\)/, "y el modo full tambien");
  // Y el aviso se limpia en las DOS ramas, no solo en la de Apps Script.
  const limpieza = cuerpo.slice(cuerpo.indexOf("persistReferencePricesFromSync();"));
  assert.match(limpieza, /clearNetSuiteSyncAlert\(\)/, "y el aviso se limpia en la rama de navegador tambien");
});

test("la verificacion de frescura omite la red cuando syncedAt esta dentro del umbral", async () => {
  const calls = [];
  const fixture = loadClient({
    installBacklogSync: true,
    state: { syncedAt: "2026-09-25T11:55:00.000Z", selectedOts: ["WO-1"] },
    needsWorkOrderSyncBeforeSchedule: () => false,
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => { calls.push(method); return { revision: 2 }; },
  });

  const result = await fixture.context.ensureNetSuiteWorkOrdersFresh({ maxAgeMs: 15 * 60 * 1000, context: "schedule" });

  assert.equal(result.ok, true);
  assert.equal(result.refreshed, false);
  assert.deepEqual([...result.removedOts], []);
  assert.deepEqual(calls, []);
  assert.deepEqual(fixture.toasts, []);
});

test("generar plan con datos viejos dispara la sync ligera y reporta las OTs cerradas retiradas", async () => {
  const calls = [];
  const fixture = loadClient({
    installBacklogSync: true,
    state: { syncedAt: "2026-09-24T10:00:00.000Z", selectedOts: ["WO-1", "WO-CERRADA"] },
    needsWorkOrderSyncBeforeSchedule: () => true,
    reconcileActiveWorkOrders: (current, workOrders) => ({
      ...current,
      workOrders,
      selectedOts: (current.selectedOts || []).filter((ot) => ot !== "WO-CERRADA"),
    }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-1" }], syncedAt: "2026-09-25T12:00:00.000Z" };
      return { revision: 2 };
    },
  });

  const result = await fixture.context.ensureNetSuiteWorkOrdersFresh({ maxAgeMs: 15 * 60 * 1000, context: "schedule" });

  // DECIDIDO 2026-09-30: el sync leyo de NetSuite por el puente y subio el estado a Supabase.
  // El unico metodo del puente es la lectura.
  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite"]);
  assert.ok(
    fixture.callsSupabase.some((call) => call.method === "guardarPlanEnSupabase"),
    "el estado del sync subio a Supabase",
  );
  assert.equal(result.ok, true);
  assert.equal(result.refreshed, true);
  assert.deepEqual(result.removedOts, ["WO-CERRADA"]);
  assert.deepEqual(fixture.context.state.selectedOts, ["WO-1"]);
});

test("generar o publicar aborta si el sync lee pero NO guarda: un plan sin persistir no se publica", async () => {
  // DECIDIDO 2026-09-30. Leer de NetSuite y no subir el estado deja la pagina con una cola
  // que la base no tiene. Generar el plan desde ahi produce algo que al recargar cambia, y la
  // lista de OTs retiradas que devuelve el sync seria invisible para el resto. Con lo leido
  // bien pero sin guardar, no se genera: se avisa y se deja reintentar.
  const fixture = loadClient({
    installBacklogSync: true,
    guardarFalla: true,
    state: { syncedAt: "2026-09-24T10:00:00.000Z", selectedOts: ["WO-1"] },
    needsWorkOrderSyncBeforeSchedule: () => true,
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-1" }], syncedAt: "2026-09-25T12:00:00.000Z" };
      return { revision: 2 };
    },
  });

  const result = await fixture.context.ensureNetSuiteWorkOrdersFresh({ maxAgeMs: 15 * 60 * 1000, context: "publish" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "sin-persistencia");
  // El array viene del vm del arnes, asi que se compara por largo: assert.deepEqual lo
  // declararia distinto por el prototipo aunque este vacio.
  assert.equal(result.removedOts.length, 0, "no se reportan retiros que no quedaron guardados");
  assert.ok(
    fixture.toasts.some((message) => message.includes("el estado NO se guardo") && message.includes("publicar el plan")),
    `esperaba el aviso de estado no guardado; hubo: ${JSON.stringify(fixture.toasts)}`,
  );
});

test("generar o publicar aborta si la verificacion de frescura falla", async () => {
  const fixture = loadClient({
    installBacklogSync: true,
    state: { syncedAt: "2026-09-24T10:00:00.000Z", selectedOts: ["WO-1"] },
    needsWorkOrderSyncBeforeSchedule: () => true,
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      if (method === "fetchNetSuiteWorkOrdersLite") throw new Error("INVALID_LOGIN_ATTEMPT");
      return { revision: 2 };
    },
  });

  const result = await fixture.context.ensureNetSuiteWorkOrdersFresh({ maxAgeMs: 15 * 60 * 1000, context: "publish" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "sync-failed");
  assert.ok(fixture.toasts.some((message) => message.includes("No se pudo verificar NetSuite antes de publicar el plan")));
  // El motivo real viaja en el toast: sin el, la falla queda como "sin sincronizar".
  assert.ok(fixture.toasts.some((message) => message.includes("INVALID_LOGIN_ATTEMPT")));
});

test("el limite de solicitudes de NetSuite se reintenta una vez y la sync ligera termina bien", async () => {
  const calls = [];
  const rateLimitBody = 'NetSuite RESTlet: 400 {"error" : {"code" : "SSS_REQUEST_LIMIT_EXCEEDED", "message" : "Se excedió el límite de solicitudes."}}';
  const fixture = loadClient({
    installBacklogSync: true,
    state: { syncedAt: "2026-09-24T10:00:00.000Z", selectedOts: ["WO-1"] },
    needsWorkOrderSyncBeforeSchedule: () => true,
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "fetchNetSuiteWorkOrdersLite" && calls.length === 1) throw new Error(rateLimitBody);
      if (method === "fetchNetSuiteWorkOrdersLite") return { workOrders: [{ ot: "WO-1" }], syncedAt: "2026-09-25T12:00:00.000Z" };
      return { revision: 2 };
    },
  });
  // La espera del reintento se resuelve en el acto para no alargar el test.
  fixture.context.window.setTimeout = (callback) => { callback(); return 1; };

  const result = await fixture.context.ensureNetSuiteWorkOrdersFresh({ maxAgeMs: 15 * 60 * 1000, context: "schedule" });

  assert.equal(result.ok, true, "el reintento debe recuperarse del limite transitorio");
  // DECIDIDO 2026-09-30: dos lecturas de NetSuite por el puente y ni un metodo mas: lo que se
  // guarda va a Supabase.
  assert.deepEqual(calls, ["fetchNetSuiteWorkOrdersLite", "fetchNetSuiteWorkOrdersLite"]);
  assert.ok(
    fixture.callsSupabase.some((call) => call.method === "guardarPlanEnSupabase"),
    "el estado del sync subio a Supabase",
  );
  assert.ok(!fixture.toasts.some((message) => message.includes("No se pudo verificar NetSuite antes de generar el plan")));
});

test("un limite de solicitudes que no se recupera aborta el plan y el toast explica el motivo", async () => {
  const calls = [];
  const rateLimitBody = 'NetSuite RESTlet: 400 {"error" : {"code" : "SSS_REQUEST_LIMIT_EXCEEDED", "message" : "Se excedió el límite de solicitudes."}}';
  const fixture = loadClient({
    installBacklogSync: true,
    state: { syncedAt: "2026-09-24T10:00:00.000Z", selectedOts: ["WO-1"] },
    needsWorkOrderSyncBeforeSchedule: () => true,
    reconcileActiveWorkOrders: (current, workOrders) => ({ ...current, workOrders }),
    purgeClosedWorkOrderRetention: (current) => current,
    callAppsScript: async (method) => {
      calls.push(method);
      if (method === "fetchNetSuiteWorkOrdersLite") throw new Error(rateLimitBody);
      return { revision: 2 };
    },
  });
  fixture.context.window.setTimeout = (callback) => { callback(); return 1; };

  const result = await fixture.context.ensureNetSuiteWorkOrdersFresh({ maxAgeMs: 15 * 60 * 1000, context: "schedule" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "sync-failed");
  assert.equal(calls.length, 2, "intento inicial + un unico reintento");
  const failureToast = fixture.toasts.find((message) => message.includes("No se pudo verificar NetSuite antes de generar el plan"));
  assert.ok(failureToast, "el aviso de aborto sigue presente");
  assert.ok(failureToast.includes("SSS_REQUEST_LIMIT_EXCEEDED"), "el motivo real debe verse en el toast");
  assert.ok(fixture.toasts.some((message) => message.includes("No se pudieron sincronizar las OTs")));
});

test("la verificacion de frescura no se entrelaza con una sincronizacion en curso", async () => {
  const fixture = loadClient({
    installBacklogSync: true,
    state: { syncedAt: "2026-09-24T10:00:00.000Z" },
    needsWorkOrderSyncBeforeSchedule: () => true,
  });
  fixture.context.backlogSyncInFlight = true;

  const result = await fixture.context.ensureNetSuiteWorkOrdersFresh({ maxAgeMs: 15 * 60 * 1000, context: "schedule" });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "busy");
  assert.ok(fixture.toasts.some((message) => message.includes("Sincronizacion de NetSuite en curso")));
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
