(function initPerformanceClient(root) {
  "use strict";

  const META_KEY = "plan-produccion-performance-v2";
  const NETSUITE_REFRESH_MS = 15 * 60 * 1000;
  const SAVE_DEBOUNCE_MS = 850;
  const SAVE_RETRY_MS = [1200, 2500, 5000, 10000, 20000];
  const LOCAL_CACHE_IDENTITY = "plan-produccion-cache-v5";
  const initialPerformanceMeta = readMeta();
  let initialLocalCache = { usable: false, revision: 0, deferredMaterials: false };
  let initialLocalCacheResolved = false;
  let deferredMaterials = false;
  const loadedMaterialOts = new Set();
  const activeCalls = new Map();
  const materialRequests = new Map();
  let snapshotsLoaded = false;
  let snapshotsMessageRequested = false;
  let syncWorkOrdersMessageRequested = false;
  let syncWorkOrdersManualRequested = false;
  let initialStateLoadPending = true;
  let deferredRevision = Number(state.revision || 0);
  let localFlushHandle = null;
  let saveIdleHandle = null;
  let saveRetryTimer = null;
  let saveRetryAttempt = 0;
  let priorityRenderFrame = 0;
  let priorityListRequested = false;
  let priorityQueueRequested = false;
  let planStatusRefreshHandle = null;
  let planStatusRefreshCallback = null;

  // El cache local pesa ~2 MB y leerlo con getItem + JSON.parse es trabajo de main thread.
  // No se lee al evaluar el modulo: se lee la PRIMERA vez que hace falta y se guarda el
  // resultado (memo de una vez). Leerlo en requestIdleCallback seria una carrera: el import
  // del servidor puede terminar antes y su deferredMaterials/loadedMaterialOts serian
  // sobrescritos por los del cache viejo; y si el idle se adelanta al import, el cache
  // seguiria marcado como no usable y se perderia el atajo de getAppStateIfChanged.
  function resolveInitialLocalCache() {
    if (initialLocalCacheResolved) return initialLocalCache;
    initialLocalCacheResolved = true;
    initialLocalCache = readUsableLocalStateCache(initialPerformanceMeta);
    deferredMaterials = Boolean(initialLocalCache.deferredMaterials);
    if (deferredMaterials) {
      loadedMaterialOts.clear();
    } else {
      (state.materials || []).forEach((item) => loadedMaterialOts.add(materialOtKey(item.ot)));
    }
    const cacheRevision = Number(initialLocalCache.revision || 0);
    if (cacheRevision > deferredRevision) deferredRevision = cacheRevision;
    return initialLocalCache;
  }

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function requestIdle(callback, timeout = 700) {
    if (typeof root.requestIdleCallback === "function") {
      return { type: "idle", id: root.requestIdleCallback(callback, { timeout }) };
    }
    return { type: "timer", id: root.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 24) };
  }

  function cancelIdle(handle) {
    if (!handle) return;
    if (handle.type === "idle" && typeof root.cancelIdleCallback === "function") root.cancelIdleCallback(handle.id);
    else root.clearTimeout(handle.id);
  }

  root.schedulePlanStatusBackgroundRefresh = function optimizedSchedulePlanStatusBackgroundRefresh(callback) {
    if (typeof callback !== "function") return;
    planStatusRefreshCallback = callback;
    if (planStatusRefreshHandle) return;
    planStatusRefreshHandle = requestIdle(() => {
      planStatusRefreshHandle = null;
      const refresh = planStatusRefreshCallback;
      planStatusRefreshCallback = null;
      refresh?.();
    }, 900);
  };

  function readMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function writeMeta(patch = {}) {
    const next = {
      ...readMeta(),
      ...patch,
      revision: Number(patch.revision ?? state.revision ?? deferredRevision ?? 0),
      updatedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(META_KEY, JSON.stringify(next)); } catch {}
    return next;
  }

  // MEDIDO 2026-09-29 en el navegador (sitio estatico, sesion de Supabase): esto NO responde
  // "estoy en Apps Script", responde "el puente esta configurado", que en GitHub Pages es
  // cierto porque la URL del backend va embebida en el bundle. O sea que
  // `window.isAppsScriptRuntime()` da TRUE con `typeof google === "undefined"`. Con esa
  // mentira, el guardado optimized de mas abajo se saltaba la funcion de app.js (que sube el
  // plan a Supabase y despues los catalogos) y entraba directo a `callAppsScript`, o sea a
  // subir el plan por el iframe: la escritura del plan se perdia y los catalogos no se
  // subian nunca. `nativeRuntimeAvailable` es el unico predicado que responde la pregunta de
  // verdad (`google.script.run` existe solo dentro de HtmlService) y se pregunta al puente
  // porque es el modulo que lo define.
  //
  // LO QUE QUEDA DE ESA MEDICION, 2026-09-30: ya no se decide el destino de la escritura con
  // este predicado. El destino es UNO SOLO, Supabase, y en `optimizedSaveAppSheet` se delega
  // siempre en `saveAppSheet` de app.js. Este `bridgeAvailable` quedo para lo unico que si
  // distingue los runtimes: si hay que preguntar a NetSuite, se usa el camino nativo.
  function bridgeAvailable() {
    return false;
  }

  function bridgeCall(method, ...args) {
    return Promise.reject(new Error(`El puente de Apps Script esta deshabilitado. Metodo: ${method}`));
  }

  function installPerformanceAdapters() {
    isAppsScriptRuntime = bridgeAvailable;
    callAppsScript = bridgeCall;
  }
  installPerformanceAdapters();
  document.addEventListener("DOMContentLoaded", installPerformanceAdapters, { once: true });

  function compactLocalState() {
    // selectedOts/lockedOts SI se conservan: son la autoridad del borrador y, si el
    // guardado remoto no llega, son lo unico que evita que la OT vuelva al Backlog.
    const { matrixSearch, operations, lastSchedule, expandedOts, draftVersionId, activePublishedVersionId, planStart, reportWeekStart, loadWeekStart, ...persisted } = state;
    delete persisted.machineToolHistory;
    const revision = Number(state.revision || 0);
    return {
      ...persisted,
      operations: [],
      materials: [],
      performanceCache: {
        identity: LOCAL_CACHE_IDENTITY,
        revision,
      },
    };
  }

  function singleFlight(key, factory) {
    if (activeCalls.has(key)) return activeCalls.get(key);
    const request = Promise.resolve()
      .then(factory)
      .finally(() => activeCalls.delete(key));
    activeCalls.set(key, request);
    return request;
  }

  const LOCAL_CACHE_QUOTA_GUARD_BYTES = 4 * 1024 * 1024;
  const LOCAL_CACHE_TRIM_KEYS = [
    "_locallyRemovedDraftOts",
    "_pendingAddOt",
    "_pendingAddOtSnapshot",
    "_locallyAddedDraftOts",
    "_locallyEditedOtConfigurations",
    "expandedOts",
  ];

  function trimLocalCachePayload(payload) {
    let serialized = JSON.stringify(payload);
    if (serialized.length * 2 > LOCAL_CACHE_QUOTA_GUARD_BYTES) {
      for (const key of LOCAL_CACHE_TRIM_KEYS) delete payload[key];
      serialized = JSON.stringify(payload);
    }
    return serialized;
  }

  scheduleLocalStorageFlush = function optimizedScheduleLocalStorageFlush() {
    if (localFlushHandle) return;
    localFlushHandle = requestIdle(() => {
      localFlushHandle = null;
      try {
        const compacted = compactLocalState();
        const serialized = trimLocalCachePayload(compacted);
        localStorage.setItem(STORAGE_KEY, serialized);
        writeMeta({
          revision: compacted.revision,
          cacheIdentity: LOCAL_CACHE_IDENTITY,
          cacheRevision: compacted.performanceCache.revision,
          deferredMaterials: true,
        });
      } catch (error) {
        console.warn("No se pudo actualizar el cache local:", error);
      }
    }, 1200);
  };

  const undoKeys = [
    "ganttView", "ganttDayWidth", "selectedOperationId", "capacityMinutes", "planStart", "horizonDays",
    "loadWeekStart", "reportWeekStart", "reportFilters", "dailyBreaks", "workSchedule", "lockedOts",
    "expandedOts", "selectedOts", "settings", "operators", "operatorCapacity", "operatorPerformance",
    "operatorProfiles", "cts", "customCapabilities", "configuredCapabilities", "hiddenCapabilities",
    "operationRules", "capacityModes", "matrix", "machines", "toolCatalog", "calendarExceptions",
    "subcontracts", "otTypes", "otConfigurations", "articleConfigurations", "operationPlanStatuses",
    "lastSchedule", "operations",
  ];

  checkpointState = function optimizedCheckpointState() {
    const snapshot = { __optimizedUndo: true };
    undoKeys.forEach((key) => { snapshot[key] = clone(state[key]); });
    snapshot.workOrderOverrides = (state.workOrders || []).map((item) => ({
      ot: item.ot,
      dueDateOverride: item.dueDateOverride || "",
    }));
    stateHistory.push(snapshot);
    if (stateHistory.length > 20) stateHistory.shift();
  };

  undoLastChange = function optimizedUndoLastChange() {
    const previous = stateHistory.pop();
    if (!previous) return;
    if (!previous.__optimizedUndo) {
      state = typeof previous === "string" ? JSON.parse(previous) : previous;
    } else {
      undoKeys.forEach((key) => { state[key] = clone(previous[key]); });
      const overrides = new Map((previous.workOrderOverrides || []).map((item) => [materialOtKey(item.ot), item.dueDateOverride || ""]));
      state.workOrders = (state.workOrders || []).map((item) => ({
        ...item,
        dueDateOverride: overrides.has(materialOtKey(item.ot)) ? overrides.get(materialOtKey(item.ot)) : (item.dueDateOverride || ""),
      }));
    }
    state.selectedDetailOt = "";
    state.selectedOperationId = "";
    normalizeState();
    saveAndRender("Ultimo cambio deshecho");
  };

  const originalRenderPriorityList = renderPriorityList;
  const originalRenderPriorityQueue = renderPriorityQueue;

  function enhanceRenderedImages(container) {
    container?.querySelectorAll("img").forEach((image) => {
      image.loading = "lazy";
      image.decoding = "async";
    });
  }

  function flushPriorityRenders() {
    priorityRenderFrame = 0;
    if (priorityListRequested) {
      priorityListRequested = false;
      originalRenderPriorityList();
      enhanceRenderedImages(els.priorityList);
      if (typeof prefetchRecentPlanningWorkOrders === "function") {
        void prefetchRecentPlanningWorkOrders().catch((error) => {
          console.warn("No se pudieron precargar rutas de OTs:", error);
        });
      }
    }
    if (priorityQueueRequested) {
      priorityQueueRequested = false;
      originalRenderPriorityQueue();
      enhanceRenderedImages(els.priorityQueue);
    }
  }

  function schedulePriorityRender() {
    if (!priorityRenderFrame) priorityRenderFrame = root.requestAnimationFrame(flushPriorityRenders);
  }

  renderPriorityList = function optimizedRenderPriorityList() {
    priorityListRequested = true;
    schedulePriorityRender();
  };
  renderPriorityQueue = function optimizedRenderPriorityQueue() {
    priorityQueueRequested = true;
    schedulePriorityRender();
  };

  const containmentStyle = document.createElement("style");
  containmentStyle.textContent = `
    .priority-card, .queue-item { contain: layout paint style; content-visibility: auto; }
    .priority-card { contain-intrinsic-size: 168px; }
    .queue-item { contain-intrinsic-size: 136px; }
  `;
  document.head.appendChild(containmentStyle);

  const originalApplyImported = applyImported;
  applyImported = function optimizedApplyImported(imported, options = {}) {
    originalApplyImported(imported, options);
    if (Array.isArray(imported?.materials)) {
      deferredMaterials = Boolean(imported.performance?.deferred?.materials);
      loadedMaterialOts.clear();
      if (!deferredMaterials) {
        state.materials.forEach((item) => loadedMaterialOts.add(materialOtKey(item.ot)));
      }
    }
    if (imported?.performance?.deferred?.materials) {
      deferredMaterials = true;
      deferredRevision = Number(imported.performance.revision || imported.revision || state.revision || 0);
    }
    invalidateInactiveMaterialOts();
    writeMeta({
      revision: Number(state.revision || 0),
      deferredMaterials,
      syncedAt: state.syncedAt || "",
    });
  };

  function hasIncompleteWorkOrderCoverage() {
    const operationOts = new Set((state.operations || [])
      .filter((item) => String(item.tipoInsercion || "").toUpperCase() !== "CAMBIO_HERRAMENTAL")
      .map((item) => materialOtKey(item.ot))
      .filter(Boolean));
    if (operationOts.size < 3) return false;
    const workOrderOts = new Set((state.workOrders || []).map((item) => materialOtKey(item.ot)).filter(Boolean));
    let missing = 0;
    operationOts.forEach((ot) => { if (!workOrderOts.has(ot)) missing += 1; });
    return missing >= 2 && missing / operationOts.size >= 0.2;
  }

  function shouldRefreshNetSuite(checkCoverage = false) {
    if (!Array.isArray(state.workOrders) || state.workOrders.length === 0) return true;
    if (checkCoverage && hasIncompleteWorkOrderCoverage()) return true;
    const last = Date.parse(state.syncedAt || readMeta().syncedAt || "");
    return !Number.isFinite(last) || Date.now() - last >= NETSUITE_REFRESH_MS;
  }

  function updateSaveAck(saved) {
    state.revision = Number(saved?.revision || state.revision || 0);
    state.savedAt = saved?.savedAt || state.savedAt;
    if (saved?.syncedAt) state.syncedAt = saved.syncedAt;
    if (saved?.plant) state.plant = saved.plant;
    if (saved?.invoicePriceWindow) state.invoicePriceWindow = saved.invoicePriceWindow;
    deferredRevision = Number(state.revision || deferredRevision || 0);
    writeMeta({ revision: state.revision, savedAt: state.savedAt || "" });
  }

  function baseSavePayload() {
    return {
      schemaVersion: state.schemaVersion,
      revision: Number(state.revision || 0),
      source: "plan-app-sheet",
      savedAt: new Date().toISOString(),
      syncedAt: state.syncedAt || "",
      invoicePriceWindow: state.invoicePriceWindow || null,
      ganttView: state.ganttView,
      ganttDayWidth: state.ganttDayWidth,
      selectedOperationId: state.selectedOperationId || "",
      capacityMinutes: state.capacityMinutes,
      planStart: state.planStart,
      horizonDays: state.horizonDays,
      loadWeekStart: state.loadWeekStart,
      reportWeekStart: state.reportWeekStart,
      reportFilters: clone(state.reportFilters || {}),
      preparedPlanningByOt: clone(state.preparedPlanningByOt || {}),
      selectedOts: [...(state.selectedOts || [])],
      lockedOts: [...(state.lockedOts || [])],
      expandedOts: [...(state.expandedOts || [])],
      plant: clone(state.plant || {}),
      settings: clone(state.settings || {}),
      lastSchedule: clone(state.lastSchedule || null),
    };
  }

  function planningSavePayload() {
    return {
      ...baseSavePayload(),
      operations: state.operations || [],
      workOrders: state.workOrders || [],
      otConfigurations: state.otConfigurations || {},
      articleConfigurations: state.articleConfigurations || {},
      operationPlanStatuses: state.operationPlanStatuses || {},
    };
  }

  function catalogSavePayload() {
    return {
      ...baseSavePayload(),
      machines: state.machines || [],
      toolCatalog: state.toolCatalog || [],
      calendarExceptions: state.calendarExceptions || [],
      subcontracts: state.subcontracts || [],
      otTypes: state.otTypes || [],
      otConfigurations: state.otConfigurations || {},
      articleConfigurations: state.articleConfigurations || {},
      workSchedule: state.workSchedule || {},
      dailyBreaks: state.dailyBreaks || {},
    };
  }

  function matrixSavePayload() {
    return {
      ...baseSavePayload(),
      operations: state.operations || [],
      operators: [...(state.operators || [])],
      operatorProfiles: clone(state.operatorProfiles || {}),
      operatorCapacity: clone(state.operatorCapacity || {}),
      operatorPerformance: clone(state.operatorPerformance || {}),
      configuredCapabilities: [...(state.configuredCapabilities || [])],
      customCapabilities: clone(state.customCapabilities || []),
      hiddenCapabilities: [...(state.hiddenCapabilities || [])],
      capacityModes: clone(state.capacityModes || {}),
      operationRules: clone(state.operationRules || {}),
      operationCatalog: clone(state.operationCatalog || []),
      matrix: clone(state.matrix || {}),
      excludedCapabilities: normalizeCapabilityKeys(state.excludedCapabilities),
    };
  }

  function saveJobsForScopes(scopes) {
    const values = new Set((scopes || []).map((scope) => String(scope || "plan").toLowerCase()));
    const jobs = [];
    if (values.has("catalogs")) jobs.push({ method: "saveCatalogState", payload: catalogSavePayload });
    if (values.has("matrix")) jobs.push({ method: "saveSkillState", payload: matrixSavePayload });
    const hasPlanning = [...values].some((scope) => !["catalogs", "matrix", "ui", "local"].includes(scope));
    if (hasPlanning || jobs.length === 0) jobs.push({ method: "savePlanningStateOptimized", payload: planningSavePayload });
    return jobs;
  }

  function waitForSaveIdle() {
    return new Promise((resolve) => {
      cancelIdle(saveIdleHandle);
      saveIdleHandle = requestIdle(() => {
        saveIdleHandle = null;
        resolve();
      }, 450);
    });
  }

  function scheduleRetry() {
    root.clearTimeout(saveRetryTimer);
    const delay = SAVE_RETRY_MS[Math.min(saveRetryAttempt, SAVE_RETRY_MS.length - 1)];
    saveRetryAttempt += 1;
    saveRetryTimer = root.setTimeout(() => saveAppSheet(false), delay);
  }

  function isTransientSaveLockError(error) {
    return /Otro proceso esta actualizando el plan/i.test(String(error?.message || error));
  }

  function reapplyLocalAddedDraftOts(addedOts, localPrepared) {
    if (!Array.isArray(addedOts) || addedOts.length === 0) return 0;
    const removed = new Set((state._locallyRemovedDraftOts || []).map(materialOtKey).filter(Boolean));
    const universe = new Set([
      ...(Array.isArray(state.operations) ? state.operations : []).map((item) => materialOtKey(item?.ot)).filter(Boolean),
      ...(Array.isArray(state.workOrders) ? state.workOrders : []).map((item) => materialOtKey(item?.ot)).filter(Boolean),
    ]);
    const selected = new Set((state.selectedOts || []).map(materialOtKey).filter(Boolean));
    const preserved = (addedOts || []).filter((ot) => {
      const key = materialOtKey(ot);
      return Boolean(key) && !removed.has(key) && universe.has(key) && !selected.has(key);
    });
    if (!preserved.length) return 0;
    state.selectedOts = [...new Set([...(state.selectedOts || []), ...preserved])];
    if (localPrepared && typeof localPrepared === "object") {
      if (!state.preparedPlanningByOt || typeof state.preparedPlanningByOt !== "object") state.preparedPlanningByOt = {};
      for (const [storedKey, signature] of Object.entries(localPrepared)) {
        const key = materialOtKey(storedKey);
        if (preserved.some((ot) => materialOtKey(ot) === key)) state.preparedPlanningByOt[storedKey] = signature;
      }
    }
    return preserved.length;
  }

  function reapplyLocalOtConfigurations(localOtConfigurations, editedOtKeys) {
    if (!localOtConfigurations || !Array.isArray(editedOtKeys) || editedOtKeys.length === 0) return 0;
    if (!state.otConfigurations || typeof state.otConfigurations !== "object") state.otConfigurations = {};
    const current = state.otConfigurations;
    let restored = 0;
    const setField = (target, field, value) => {
      if (value === undefined || value === null) return false;
      const previous = target[field];
      if (previous === undefined || previous === null || previous === "") {
        target[field] = value;
        return true;
      }
      if (String(previous) !== String(value)) {
        target[field] = value;
        return true;
      }
      return false;
    };
    for (const key of editedOtKeys) {
      let local = null;
      for (const value of Object.values(localOtConfigurations)) {
        if (materialOtKey(value?.ot) === key) { local = value; break; }
      }
      if (!local || typeof local !== "object") continue;
      let target = null;
      for (const value of Object.values(current)) {
        if (materialOtKey(value?.ot) === key) { target = value; break; }
      }
      let changed = false;
      if (!target) {
        target = clone(local);
        const stored = String(local.ot || key).trim();
        current[stored] = target;
        changed = true;
      } else {
        for (const field of ["machine", "maquina", "herramental", "tool", "kitHerramental", "kit", "additionalHerramentales", "subcontractType", "tipoSubcontrato", "subcontractDays", "diasSubcontrato"]) {
          if (setField(target, field, local[field])) changed = true;
        }
        if (local.kitPending === true && target.kitPending !== true) {
          target.kitPending = true;
          changed = true;
        }
      }
      if (changed) restored += 1;
    }
    return restored;
  }

  /**
   * EL ESTADO REMOTO QUE SE RECARGA TRAS UN CONFLICTO. DECIDIDO 2026-09-30: se lee de
   * SUPABASE, no de las Hojas. Antes era `callAppsScript("getAppState")`, que en el sitio
   * estatico va por el iframe y ademas devolvia el estado de una hoja que ya no es el
   * destino de la escritura: recargar de ahi era recargar de un sitio al que esta pagina
   * ya no escribe, o sea, consolidar contra el destino viejo.
   *
   * Se devuelve el objeto y lo mete `reloadStateAfterConflict` con UN solo
   * `applyImported`: aplicar el mismo estado dos veces seria aplicarlo dos veces.
   */
  async function readRemoteStateForConflict() {
    const reader = typeof PPSupabaseReader !== "undefined" ? PPSupabaseReader : null;
    if (!reader || typeof reader.readCatalogs !== "function") {
      throw new Error("Supabase no esta disponible para recargar el estado tras el conflicto");
    }
    const leido = await reader.readCatalogs();
    const entrada = leido && typeof leido === "object" ? leido.appState : null;
    return Object.assign({}, leido, entrada && typeof entrada === "object" ? entrada : {});
  }

  async function reloadStateAfterConflict() {
    try {
      const localRemovedDraftOts = [...(state._locallyRemovedDraftOts || [])];
      const localAddedDraftOts = [...(state._locallyAddedDraftOts || [])];
      const localEditedOtConfigurations = (state._locallyEditedOtConfigurations || []).map(materialOtKey).filter(Boolean);
      const localOtConfigurations = state.otConfigurations && typeof state.otConfigurations === "object" ? clone(state.otConfigurations) : null;
      const localPrepared = state.preparedPlanningByOt && typeof state.preparedPlanningByOt === "object" ? clone(state.preparedPlanningByOt) : null;
      const imported = await readRemoteStateForConflict();
      applyImported(imported, { preserveLocalPlanning: false });
      const reappliedDraftRemovals = applyLocalDraftRemovalTombstones(localRemovedDraftOts);
      const reappliedDraftAdditions = reapplyLocalAddedDraftOts(localAddedDraftOts, localPrepared);
      const reappliedConfigurations = reapplyLocalOtConfigurations(localOtConfigurations, localEditedOtConfigurations);
      deferredRevision = Number(imported.revision || state.revision || 0);
      if (reappliedDraftAdditions > 0 || reappliedConfigurations > 0) appSheetMarkDirtyScope("plan");
      writeMeta({ revision: deferredRevision, syncedAt: state.syncedAt || "" });
      scheduleLocalStorageFlush();
      return { reloaded: true, reappliedDraftRemovals, reappliedDraftAdditions, reappliedConfigurations };
    } catch (error) {
      console.warn("No se pudo recargar el estado despues del conflicto:", error);
      return { reloaded: false, reappliedDraftRemovals: 0, reappliedDraftAdditions: 0, reappliedConfigurations: 0 };
    }
  }

  function applyLocalDraftRemovalTombstones(ots) {
    if (root.applyLocalDraftRemovalTombstones) return root.applyLocalDraftRemovalTombstones(ots);
    const removed = new Set((ots || []).map(materialOtKey).filter(Boolean));
    if (!removed.size) return 0;
    const before = new Set((state.selectedOts || []).map(materialOtKey).filter(Boolean));
    const keep = (ot) => !removed.has(materialOtKey(ot));
    state.selectedOts = (state.selectedOts || []).filter(keep);
    state.lockedOts = (state.lockedOts || []).filter(keep);
    state.expandedOts = (state.expandedOts || []).filter(keep);
    if (state.lastSchedule && typeof state.lastSchedule === "object") {
      state.lastSchedule = {
        ...state.lastSchedule,
        scheduledOts: (state.lastSchedule.scheduledOts || []).filter(keep),
      };
    }
    const preparedPlanningByOt = { ...(state.preparedPlanningByOt || {}) };
    Object.keys(preparedPlanningByOt).forEach((key) => { if (removed.has(materialOtKey(key))) delete preparedPlanningByOt[key]; });
    state.preparedPlanningByOt = preparedPlanningByOt;
    if (Array.isArray(state._locallyAddedDraftOts)) {
      state._locallyAddedDraftOts = state._locallyAddedDraftOts.filter((ot) => !removed.has(materialOtKey(ot)));
    }
    if (Array.isArray(state._locallyEditedOtConfigurations)) {
      state._locallyEditedOtConfigurations = state._locallyEditedOtConfigurations.filter((ot) => !removed.has(materialOtKey(ot)));
    }
    state._locallyRemovedDraftOts = [...removed];
    return [...removed].filter((ot) => before.has(ot)).length;
  }

  const originalSaveAppSheet = saveAppSheet;

  queueAppSheetSave = function optimizedQueueAppSheetSave(saveScope = "plan") {
    const scope = String(saveScope || "plan").trim().toLowerCase();
    if (scope === "local" || scope === "ui") return;
    appSheetMarkDirtyScope(scope);
    if (operationStatusSavesInFlight) return;
    // MEDIDO 2026-09-29 en el navegador real (sitio estatico, sesion de Supabase):
    // esta linea decia `if (!appSheetAvailable) return;` y `appSheetAvailable` es la
    // bandera del PUENTE, que en el sitio estatico no existe: el readout lanzaba
    // `ReferenceError: appSheetAvailable is not defined` en CADA cambio de estado que
    // llegaba aqui, y el guardado por debounce no llegaba ni a encolarse. Los tests no
    // lo cazaron porque el arnes de app.js declara `appSheetAvailable` a mano, que es
    // justo lo que en el navegador no pasa. La bandera correcta es
    // appSheetDisponible(): el puente en el runtime de Apps Script, Supabase fuera.
    if (!appSheetDisponible()) return;
    if (appSheetSaveInFlight) {
      appSheetSavePending = true;
      return;
    }
    root.clearTimeout(appSheetSaveTimer);
    appSheetSaveTimer = root.setTimeout(() => {
      appSheetSaveTimer = null;
      saveAppSheet(false);
    }, SAVE_DEBOUNCE_MS);
  };

  saveAppSheet = async function optimizedSaveAppSheet(showMessage) {
    // DECIDIDO 2026-09-30 (pregunta al usuario): el destino de la escritura del plan es UNO
    // SOLO, Supabase, tambien DENTRO de HtmlService. Por eso este optimized ya no arma jobs
    // de Hojas: delega el guardado en `originalSaveAppSheet`, que es la funcion de app.js y
    // la que sube el plan con `PPSupabaseWriter` y despues los catalogos por ambito. Lo que
    // este modulo sigue aportando es el DEBOUNCE de `queueAppSheetSave` de arriba: sin el,
    // cada pulsacion abriria un guardado.
    //
    // MEDIDO 2026-09-29 en el navegador real, y por que se llego aqui: la condicion que
    // habia decia `isAppsScriptRuntime()`, que en el sitio estatico da TRUE porque la URL
    // del backend va embebida (ver `bridgeAvailable`), y por eso el guardado se iba por
    // `callAppsScript` en vez de por la funcion de app.js. Afuera de HtmlService no hay
    // puente nativo: el iframe no escribe las Hojas, solo las lee. Y los jobs que quedaban
    // debajo (`saveCatalogState` / `saveSkillState` / `savePlanningStateOptimized`) suben a
    // las Hojas: eran el unico camino del modulo que escribia fuera de Supabase.
    const guardado = await originalSaveAppSheet(showMessage);
    if (guardado) return true;
    // Las OTs que la persona acaba de agregar y que siguen sin guardar. El aviso las nombra
    // porque no hay otra forma de saber que se perdieron si no se dijeran.
    const pendingAdds = (Array.isArray(state._locallyAddedDraftOts) ? state._locallyAddedDraftOts : [])
      .map((ot) => String(ot || "").trim())
      .filter(Boolean);
    if (!state._conflictoSupabase) {
      // Fallo que NO es de conflicto (red, RLS, escritor caido). El guardado de app.js ya
      // devuelto los ambitos sucios y el cache local ya conserva la cola, asi que aqui solo
      // hace falta avisar y rearmar el reintento.
      appSheetSavePending = true;
      if (!appSheetDirtyScopes.size) appSheetMarkDirtyScope("plan");
      scheduleLocalStorageFlush();
      scheduleRetry();
      document.body.dataset.saveStatus = "pending";
      rearmarDebounceDeGuardado();
      if (showMessage) showToast("Guardado pendiente; se reintentara en segundo plano", 4200);
      else if (pendingAdds.length) {
        showToast(`No se pudo guardar el plan (OT ${pendingAdds.join(", ")}); se reintentara en segundo plano`, 6000);
      }
      return false;
    }
    // Un CONFLICT_REVISION no se arregla reintentando encima: la revision que manda esta
    // pagina sigue siendo la vieja. Lo que se hace es recargar el estado remoto y reaplicar
    // encima los cambios locales de la cola (OTs agregadas, quitadas y configuraciones
    // editadas), que es lo que `reloadStateAfterConflict` deja reaplicado y marcado.
    const reloadResult = await reloadStateAfterConflict();
    const reloaded = reloadResult.reloaded;
    // Si la recarga no pudo aplicarse, el estado local sigue intacto: hay que conservar
    // los ambitos que consumia este guardado y reintentar, nunca descartar el cambio en
    // silencio.
    if (!reloaded) appSheetDirtyScopes.add("plan");
    const keepDirty = !reloaded
      || reloadResult.reappliedDraftRemovals > 0
      || reloadResult.reappliedDraftAdditions > 0
      || reloadResult.reappliedConfigurations > 0;
    appSheetSavePending = keepDirty;
    if (keepDirty) appSheetMarkDirtyScope("plan");
    // El reintento con espera creciente es solo cuando NO se pudo recargar: si la recarga
    // si funciono y reaplico cambios, el aviso es de conflicto resuelto y lo que hace falta
    // es el rearmado del debounce de mas abajo.
    if (!reloaded) scheduleRetry();
    // Y se rearma el debounce, que es lo que hacia el finally del guardado por jobs: si
    // queda algo sucio, tiene que haber un temporizador armedado o el reintento se pierde.
    if (keepDirty) {
      appSheetSavePending = false;
      rearmarDebounceDeGuardado();
    }
    scheduleLocalStorageFlush();
    document.body.dataset.saveStatus = reloaded ? (keepDirty ? "pending" : "conflict") : "pending";
    if (showMessage) showToast(reloaded
      ? "Otro usuario guardo cambios; se recargo el estado vigente"
      : "Conflicto de guardado; se reintentara en segundo plano", 4200);
    else if (pendingAdds.length) {
      showToast(`No se pudo guardar el plan (OT ${pendingAdds.join(", ")}); se reintentara en segundo plano`, 6000);
    }
    return false;
  };

  /** Rearma el temporizador de guardado por debounce, para no perder el reintento. */
  function rearmarDebounceDeGuardado() {
    root.clearTimeout(appSheetSaveTimer);
    appSheetSaveTimer = root.setTimeout(() => {
      appSheetSaveTimer = null;
      saveAppSheet(false);
    }, SAVE_DEBOUNCE_MS);
  }

  function readUsableLocalStateCache(metadata = readMeta()) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { usable: false, revision: 0, deferredMaterials: false };
      const cached = JSON.parse(raw);
      const revision = Number(cached?.revision || 0);
      const marker = cached?.performanceCache;
      const usable = Boolean(
        cached
        && typeof cached === "object"
        && !Array.isArray(cached)
        && Array.isArray(cached.workOrders)
        && revision > 0
        && Number(state.revision) === revision
        && marker?.identity === LOCAL_CACHE_IDENTITY
        && Number(marker.revision) === revision
        && metadata?.cacheIdentity === LOCAL_CACHE_IDENTITY
        && Number(metadata.cacheRevision) === revision
        && Number(metadata.revision) === revision
      );
      return {
        usable,
        revision: usable ? revision : 0,
        deferredMaterials: usable && metadata.deferredMaterials === true,
      };
    } catch {
      return { usable: false, revision: 0, deferredMaterials: false };
    }
  }

  async function loadInitialStateConditionally(localCache) {
    const revision = localCache?.usable ? Number(localCache.revision || 0) : 0;
    // Se capturan antes de importar: applyImported reemplaza state.selectedOts con el
    // estado remoto y una OT agregada a Planeado todavia no guardada se perderia.
    const localAddedDraftOts = [...(state._locallyAddedDraftOts || [])];
    const localEditedOtConfigurations = (state._locallyEditedOtConfigurations || []).map(materialOtKey).filter(Boolean);
    const localOtConfigurations = state.otConfigurations && typeof state.otConfigurations === "object" ? clone(state.otConfigurations) : null;
    const localPrepared = state.preparedPlanningByOt && typeof state.preparedPlanningByOt === "object" ? clone(state.preparedPlanningByOt) : null;
    const imported = revision > 0
      ? await PPSupabaseBridgeReplacement.getAppStateIfChanged(revision, { includeMaterials: false })
      : await PPSupabaseBridgeReplacement.getAppState();
    if (imported?.unchanged) {
      const currentRevision = Number(imported.revision || revision);
      deferredMaterials = localCache.deferredMaterials === true;
      if (deferredMaterials) loadedMaterialOts.clear();
      state.revision = currentRevision;
      state.savedAt = imported.savedAt || state.savedAt;
      state.syncedAt = imported.syncedAt || state.syncedAt;
      applyLocalDraftRemovalTombstones(state._locallyRemovedDraftOts || []);
      deferredRevision = currentRevision;
      writeMeta({
        revision: currentRevision,
        savedAt: state.savedAt || "",
        syncedAt: state.syncedAt || "",
      });
      return { loaded: false, unchanged: true };
    }
    if (typeof captureLocalPlanningState === "function"
      && typeof confirmLatestModificationRefresh === "function"
      && Number(imported?.revision || 0) > Number(state.revision || 0)) {
      const refreshWithLatest = await confirmLatestModificationRefresh(captureLocalPlanningState(), imported);
      if (refreshWithLatest === false) {
        deferredRevision = Number(state.revision || 0);
        writeMeta({ syncedAt: state.syncedAt || "" });
        return { loaded: false, unchanged: false, keptLocal: true };
      }
    }
    applyImported(imported, { preserveLocalPlanning: false });
    state.fromLocalCache = false;
    const reappliedAdditions = reapplyLocalAddedDraftOts(localAddedDraftOts, localPrepared);
    const reappliedConfigurations = reapplyLocalOtConfigurations(localOtConfigurations, localEditedOtConfigurations);
    if (reappliedAdditions > 0 || reappliedConfigurations > 0) appSheetMarkDirtyScope("plan");
    deferredRevision = Number(imported?.revision || state.revision || 0);
    state.savedAt = imported?.savedAt || state.savedAt;
    state.syncedAt = imported?.syncedAt || state.syncedAt;
    state.revision = Number(imported?.revision || state.revision || 0);
    writeMeta({
      revision: state.revision,
      savedAt: state.savedAt || "",
      syncedAt: state.syncedAt || "",
    });
    return { loaded: true, unchanged: false, reappliedAdditions, reappliedConfigurations };
  }

  // HIDRATAR LA PANTALLA CON LA CACHE LOCAL CUANDO EL SERVIDOR NO RESPONDE.
  //
  // QUE PASABA. loadState() devuelve deepClone(sampleState) (app.js:1272) y sampleState NO trae
  // selectedOts. Si getAppState agota los 120 s, el catch de loadAppStateInBackground solo escribe
  // un console.warn y state queda en sampleState: la pantalla no muestra NADA de lo que la persona
  // dejo, y lo unico que aparece es lo que rescata el borrador (maybeRestoreSavedDraftOnBoot), que
  // son las OTs del borrador sobre fichas de demostracion. Medido el 2026-09-27: 20 OTs en la cola
  // (las del borrador) y getAppState agotando 120 004 ms, 4 veces.
  //
  // QUE HACE ESTO. Si hay una cache local con fichas y revision > 0, se aplica a state: la cola,
  // las fichas, la matriz, los operadores, las maquinas, las configuraciones. operations y materials
  // vienen vacios a proposito (RULE-PLAN-013: el plan no vive en localStorage) y los rescata
  // despues maybeRestoreSavedDraftOnBoot, que corre justo porque el estado no vino del servidor.
  // Y SE AVISA, en silencio no: state.fromLocalCache deja un aviso visible y la app sigue
  // reintentando el servidor en segundo plano.
  function readLocalStateSnapshot() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || typeof cached !== "object" || Array.isArray(cached)) return null;
      if (!Array.isArray(cached.workOrders) || !(Number(cached.revision) > 0)) return null;
      return cached;
    } catch {
      return null;
    }
  }

  function hydrateStateFromLocalCache() {
    const snapshot = readLocalStateSnapshot();
    if (!snapshot) return false;
    // Se aplica la cache ENTERA, operations incluido. En produccion operations y materials vienen
    // vacios a proposito (RULE-PLAN-013: el plan no vive en localStorage) y los rescata despues
    // maybeRestoreSavedDraftOnBoot; si traen datos, se conservan. revision no se toca: dejar la del
    // servidor como esta y que el guard de CONFLICT_REVISION rechace un guardado hecho desde una
    // pantalla que puede estar atrasada.
    const { revision, performanceCache, ...rest } = snapshot;
    Object.assign(state, rest);
    if (!Array.isArray(state.operations)) state.operations = [];
    if (!Array.isArray(state.materials)) state.materials = [];
    state.fromLocalCache = true;
    state.localCacheRevision = Number(snapshot.revision || 0);
    return true;
  }

  loadAppStateInBackground = function optimizedLoadAppStateInBackground() {
    return singleFlight("state", async () => {
      let loaded = false;
      const selectedDetailOt = state.selectedDetailOt;
      const selectedOperationId = state.selectedOperationId;
      let snapshotsRequest = null;
      try {
        // MEDIDO 2026-09-30 en produccion: esto era `await root.PPAppsScriptBridge.ensureReady()`,
        // que monta un iframe oculto contra el web app de Apps Script. Con el puente
        // deshabilitado la llamada ya no hacia falta para NADA (no iba a llamar por el), pero
        // seguia DESCARGANDO el script de Google en cada carga de pagina: se veia en la consola
        // como script.google.com/macros/.../exec?app=bridge. Eso es una dependencia viva de
        // Apps Script en un sitio que ya decidio que Supabase es la fuente, y ademas consume
        // el ancho de banda de cada persona que abre la pagina. La puerta de escritura ya no
        // la consulta: `appSheetDisponible()` de app.js pregunta por PPSupabaseWriter
        // (RULE-SUP-029).
        snapshotsRequest = loadPlanSnapshots(false, { deferPublishedLoad: true }).catch((error) => {
          console.warn("No se pudieron cargar los historicos:", error);
          return null;
        });
        const result = await loadInitialStateConditionally(resolveInitialLocalCache());
        loaded = result.loaded;
        appSheetAvailable = true;
      } catch (error) {
        appSheetAvailable = false;
        console.warn("Se mantiene el cache local porque el backend no respondio:", error);
        // Se hidrata state con la cache local y SE AVISA. Sin esto la pantalla queda en
        // sampleState (que no trae selectedOts) y solo se ve lo que rescata el borrador. Con esto
        // la persona ve lo que dejo, con un aviso de que puede estar un guardado atras.
        //
        // NO se reintenta aqui: scheduleDraftBootRestoreRetry es del borrador, no del estado, y el
        // estado se reintenta solo en el siguiente arranque o en la siguiente interacion (que pasa
        // por getAppStateIfChanged). Ver hydrateStateFromLocalCache.
        if (hydrateStateFromLocalCache()) {
          const cuando = state.savedAt ? ` de las ${String(state.savedAt).slice(11, 19)}` : "";
          showToast(`Sin conexion con el plan: mostrando lo guardado${cuando}. Reintentando...`, 12000);
        }
      }

      if (loaded) await new Promise((resolve) => requestAnimationFrame(resolve));
      purgeClosedWorkOrderRetention();
      initialStateLoadPending = false;
      if (selectedDetailOt) state.selectedDetailOt = selectedDetailOt;
      if (selectedOperationId) state.selectedOperationId = selectedOperationId;
      saveState("ui");
      render({ save: false });
      applyInitialWorkspaceView({ scrollToTop: false });

      // MEDIDO 2026-09-30: esta compuerta era `isAppsScriptRuntime() && ...` porque el sync
      // de arranque cruzaba el puente de Apps Script, y en el sitio estatico (donde
      // `bridgeAvailable()` dice que no hay puente) el sync no pasaba. Con el puente
      // deshabilitado NO se pierde: `syncNetSuiteData` de app.js ya lee
      // `PPSupabaseBridgeReplacement.syncNetSuiteWorkOrders`, o sea de Supabase, que esta
      // disponible en los dos runtimes. Supabase es la fuente (RULE-SUP-029), asi que la
      // frescura del espejo se decide con `shouldRefreshNetSuite` y nada mas.
      const bootSync = shouldRefreshNetSuite(loaded)
        ? syncWorkOrdersOnce({ showMessage: state.workOrders.length === 0 })
        : Promise.resolve(false);
      void Promise.all([Promise.resolve(bootSync), Promise.resolve(snapshotsRequest)]).then(([bootResult]) => {
        void Promise.resolve(bootResult);
        if (typeof maybeRestoreSavedDraftOnBoot === "function") return maybeRestoreSavedDraftOnBoot();
        return null;
      });
      void snapshotsRequest?.then(() => {
        if (typeof maybeLoadDefaultPublishedReportSnapshot === "function") return maybeLoadDefaultPublishedReportSnapshot();
        return null;
      });
    });
  };

  const originalLoadPlanSnapshots = loadPlanSnapshots;
  function requestPlanSnapshots(showMessage, options = {}) {
    snapshotsMessageRequested ||= showMessage === true;
    return singleFlight("snapshots", async () => {
      try {
        const result = await originalLoadPlanSnapshots(false, options);
        snapshotsLoaded = result?.ok === true;
        if (snapshotsMessageRequested) {
          const message = result?.ok
            ? `${Number(result.count || 0)} planes guardados disponibles`
            : `No se pudieron cargar los planes guardados: ${result?.error || "Error desconocido"}`;
          showToast(message);
        }
        return result;
      } catch (error) {
        snapshotsLoaded = false;
        throw error;
      } finally {
        snapshotsMessageRequested = false;
      }
    });
  }

  loadSnapshotsOnce = function optimizedLoadSnapshotsOnce(showMessage, options = {}) {
    if (activeCalls.has("snapshots")) return requestPlanSnapshots(showMessage, options);
    if (snapshotsLoaded) {
      return Promise.resolve({ ok: true, count: planSnapshots.length });
    }
    return requestPlanSnapshots(showMessage, options);
  };

  loadPlanSnapshots = function optimizedLoadPlanSnapshots(showMessage, options = {}) {
    return requestPlanSnapshots(showMessage, options);
  };

  const originalSyncWorkOrdersOnce = syncWorkOrdersOnce;
  syncWorkOrdersOnce = function optimizedSyncWorkOrdersOnce(options = {}) {
    syncWorkOrdersMessageRequested ||= options.showMessage === true;
    syncWorkOrdersManualRequested ||= options.manual === true;
    return singleFlight("sync-work-orders", async () => {
      try {
        const loaded = await originalSyncWorkOrdersOnce({ showMessage: false, deferPresentation: true });
        if (loaded) {
          const showMessage = syncWorkOrdersMessageRequested && !syncWorkOrdersManualRequested;
          saveState(showMessage ? "plan" : "ui");
          if (showMessage) {
            render({ parts: { normalize: false, top: true, alerts: true, priorityList: true, queue: true, gantt: true } });
            showToast(`${state.workOrders.length} OTs NetSuite cargadas`);
          } else {
            root.requestAnimationFrame(() => {
              renderTop();
              renderPlanAlerts();
              renderPriorityList();
              renderPriorityQueue();
            });
          }
        } else if (syncWorkOrdersMessageRequested && !syncWorkOrdersManualRequested) {
          showToast(`No se pudo cargar NetSuite: ${state.netSuiteSyncAlert?.message || "Error desconocido"}`, 9000);
        }
        return loaded;
      } finally {
        syncWorkOrdersMessageRequested = false;
        syncWorkOrdersManualRequested = false;
      }
    });
  };

  const originalSyncBacklogWorkOrders = typeof syncBacklogWorkOrders === "function"
    ? syncBacklogWorkOrders
    : null;
  if (originalSyncBacklogWorkOrders) {
    syncBacklogWorkOrders = async function optimizedSyncBacklogWorkOrders(...args) {
      const result = await originalSyncBacklogWorkOrders(...args);
      if (result?.ok === true) invalidateInactiveMaterialOts();
      return result;
    };
  }

  const originalShowWorkspaceView = showWorkspaceView;
  showWorkspaceView = function optimizedShowWorkspaceView(section, tab = "", options = {}) {
    originalShowWorkspaceView(section, tab, options);
    if (section === "reportes" && !snapshotsLoaded && !initialStateLoadPending) {
      loadSnapshotsOnce(false).catch((error) => {
        console.warn("No se pudieron cargar los historicos:", error);
      });
    }
  };

  async function loadMaterialsForOt(ot) {
    const key = materialOtKey(ot);
    if (!key || !deferredMaterials || loadedMaterialOts.has(key)) return;
    if (materialRequests.has(key)) return materialRequests.get(key);

    const request = PPSupabaseBridgeReplacement.getMaterialsForOt(ot, state.revision || deferredRevision)
      .then((result) => {
        if (result?.stale) {
          root.setTimeout(() => loadAppStateInBackground(), 0);
          return;
        }
        if (materialRequests.get(key) !== request || !isMaterialOtActive(key)) return;
        state.materials = [
          ...(state.materials || []).filter((item) => materialOtKey(item.ot) !== key),
          ...(Array.isArray(result?.materials) ? result.materials : []),
        ];
        loadedMaterialOts.add(key);
        scheduleLocalStorageFlush();
        if (selectedJobOt() && materialOtKey(selectedJobOt()) === key) originalRenderSelectedJobPanel();
      })
      .catch((error) => console.warn(`No se pudieron cargar materiales de ${ot}:`, error))
      .finally(() => {
        if (materialRequests.get(key) === request) materialRequests.delete(key);
      });
    materialRequests.set(key, request);
    return request;
  }

  function isMaterialOtActive(key) {
    return (state.workOrders || []).some((item) => materialOtKey(item.ot) === key);
  }

  function invalidateInactiveMaterialOts() {
    const activeOts = new Set((state.workOrders || []).map((item) => materialOtKey(item.ot)).filter(Boolean));
    loadedMaterialOts.forEach((key) => {
      if (!activeOts.has(key)) loadedMaterialOts.delete(key);
    });
    materialRequests.forEach((_request, key) => {
      if (!activeOts.has(key)) materialRequests.delete(key);
    });
    state.materials = (state.materials || []).filter((item) => activeOts.has(materialOtKey(item.ot)));
  }

  const originalRenderSelectedJobPanel = renderSelectedJobPanel;
  renderSelectedJobPanel = function optimizedRenderSelectedJobPanel() {
    originalRenderSelectedJobPanel();
    const job = getSelectedPriorityJob();
    if (!job || !deferredMaterials || loadedMaterialOts.has(materialOtKey(job.ot))) return;
    const empty = els.selectedJobPanel?.querySelector(".job-material-empty");
    if (empty) empty.textContent = "Cargando materiales bajo demanda...";
    loadMaterialsForOt(job.ot);
  };

  const originalEnsurePlanningDataLoaded = ensurePlanningDataLoaded;
  ensurePlanningDataLoaded = async function optimizedEnsurePlanningDataLoaded(showMessage, options) {
    const loaded = await originalEnsurePlanningDataLoaded(showMessage, options);
    if (loaded?.ready && Array.isArray(state.materials)) {
      deferredMaterials = false;
      loadedMaterialOts.clear();
      state.materials.forEach((item) => loadedMaterialOts.add(materialOtKey(item.ot)));
      writeMeta({ deferredMaterials: false, revision: state.revision });
    }
    return loaded;
  };

  if (root.location.hostname.endsWith("github.io") && "serviceWorker" in navigator) {
    root.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker no disponible:", error));
    }, { once: true });
  }

  // Un traslado Backlog -> Planeado armado con debounce se perdia si el usuario
  // recargaba la pagina antes del acuse. Al ocultar la pestana se adelanta el
  // guardado pendiente en vez de esperar al temporizador; al descargar la pagina
  // el intento es best-effort porque el navegador puede cancelar la peticion.
  function flushPendingSaveOnUnload() {
    if (!appSheetDirtyScopes.size || appSheetSaveInFlight) return;
    try {
      saveAppSheet(false);
    } catch (error) {
      console.warn("No se pudo forzar el guardado al salir:", error);
    }
  }

  if (typeof root.addEventListener === "function") {
    root.addEventListener("pagehide", flushPendingSaveOnUnload);
    root.addEventListener("beforeunload", flushPendingSaveOnUnload);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingSaveOnUnload();
  });

  // writeMeta lee y escribe un objeto de ~120 B: no hay nada que diferir aqui, y diferirlo
  // dejaba una ventana en la que escribia una revision vieja sobre la que el import del
  // servidor ya habia avanzado.
  writeMeta({
    revision: Number(state.revision || initialPerformanceMeta.revision || 0),
    deferredMaterials,
    syncedAt: state.syncedAt || "",
  });
})(window);
