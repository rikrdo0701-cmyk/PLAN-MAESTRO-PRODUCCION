(function initPerformanceClient(root) {
  "use strict";

  const META_KEY = "plan-produccion-performance-v2";
  const NETSUITE_REFRESH_MS = 15 * 60 * 1000;
  const SAVE_DEBOUNCE_MS = 850;
  const SAVE_RETRY_MS = [1200, 2500, 5000, 10000, 20000];
  const loadedMaterialOts = new Set((state.materials || []).map((item) => materialOtKey(item.ot)));
  const materialRequests = new Map();
  let snapshotsRequested = false;
  let deferredMaterials = false;
  let deferredRevision = Number(state.revision || 0);
  let localFlushHandle = null;
  let saveIdleHandle = null;
  let saveRetryTimer = null;
  let saveRetryAttempt = 0;
  let priorityRenderFrame = 0;
  let priorityListRequested = false;
  let priorityQueueRequested = false;

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
      revision: Number(state.revision || deferredRevision || 0),
      updatedAt: new Date().toISOString(),
    };
    try { localStorage.setItem(META_KEY, JSON.stringify(next)); } catch {}
    return next;
  }

  function bridgeAvailable() {
    return Boolean(root.PPAppsScriptBridge?.isConfigured?.());
  }

  function bridgeCall(method, ...args) {
    if (!root.PPAppsScriptBridge?.call) return Promise.reject(new Error("El puente con Apps Script no esta disponible"));
    const mappedMethod = method === "saveAppState"
      ? "savePlanningStateOptimized"
      : (method === "syncNetSuiteWorkOrders" ? "syncNetSuiteWorkOrdersLite" : method);
    return root.PPAppsScriptBridge.call(mappedMethod, args);
  }

  function installPerformanceAdapters() {
    isAppsScriptRuntime = bridgeAvailable;
    callAppsScript = bridgeCall;
  }
  installPerformanceAdapters();
  document.addEventListener("DOMContentLoaded", installPerformanceAdapters, { once: true });

  function compactLocalState() {
    return {
      ...state,
      materials: [],
    };
  }

  scheduleLocalStorageFlush = function optimizedScheduleLocalStorageFlush() {
    if (localFlushHandle) return;
    localFlushHandle = requestIdle(() => {
      localFlushHandle = null;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compactLocalState()));
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
      if (!deferredMaterials) {
        loadedMaterialOts.clear();
        state.materials.forEach((item) => loadedMaterialOts.add(materialOtKey(item.ot)));
      }
    }
    if (imported?.performance?.deferred?.materials) {
      deferredMaterials = true;
      deferredRevision = Number(imported.performance.revision || imported.revision || state.revision || 0);
    }
    writeMeta({
      revision: Number(state.revision || 0),
      deferredMaterials,
      syncedAt: state.syncedAt || "",
    });
  };

  function shouldRefreshNetSuite() {
    if (!Array.isArray(state.workOrders) || state.workOrders.length === 0) return true;
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
      operations: clone(state.operations || []),
      workOrders: clone(state.workOrders || []),
      otConfigurations: clone(state.otConfigurations || {}),
      operationPlanStatuses: clone(state.operationPlanStatuses || {}),
    };
  }

  function catalogSavePayload() {
    return {
      ...baseSavePayload(),
      machines: clone(state.machines || []),
      toolCatalog: clone(state.toolCatalog || []),
      calendarExceptions: clone(state.calendarExceptions || []),
      subcontracts: clone(state.subcontracts || []),
      otTypes: clone(state.otTypes || []),
      otConfigurations: clone(state.otConfigurations || {}),
      articleConfigurations: clone(state.articleConfigurations || {}),
      workSchedule: clone(state.workSchedule || {}),
      dailyBreaks: clone(state.dailyBreaks || {}),
    };
  }

  function matrixSavePayload() {
    return {
      ...baseSavePayload(),
      operations: clone(state.operations || []),
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

  async function refreshRevisionAfterConflict() {
    try {
      const metadata = await callAppsScript("getAppRevision");
      if (Number.isFinite(Number(metadata?.revision))) {
        state.revision = Number(metadata.revision);
        deferredRevision = state.revision;
      }
    } catch (error) {
      console.warn("No se pudo actualizar la revision para reintentar el guardado:", error);
    }
  }

  const originalSaveAppSheet = saveAppSheet;

  queueAppSheetSave = function optimizedQueueAppSheetSave(saveScope = "plan") {
    const scope = String(saveScope || "plan").trim().toLowerCase();
    if (scope === "local" || scope === "ui") return;
    appSheetMarkDirtyScope(scope);
    if (!appSheetAvailable) return;
    if (appSheetSaveInFlight) {
      appSheetSavePending = true;
      return;
    }
    root.clearTimeout(appSheetSaveTimer);
    appSheetSaveTimer = root.setTimeout(() => saveAppSheet(false), SAVE_DEBOUNCE_MS);
  };

  saveAppSheet = async function optimizedSaveAppSheet(showMessage) {
    if (!isAppsScriptRuntime()) return originalSaveAppSheet(showMessage);
    if (appSheetSaveInFlight) {
      appSheetSavePending = true;
      if (showMessage) showToast("Guardado agregado a la fila");
      return false;
    }
    if (!appSheetDirtyScopes.size && showMessage) appSheetMarkDirtyScope("plan");
    if (!appSheetDirtyScopes.size) return true;

    root.clearTimeout(appSheetSaveTimer);
    root.clearTimeout(saveRetryTimer);
    const scopes = appSheetConsumeDirtyScopes();
    const jobs = saveJobsForScopes(scopes);
    appSheetSaveInFlight = true;
    document.body.dataset.saveStatus = "saving";

    try {
      for (const job of jobs) {
        await waitForSaveIdle();
        const payload = job.payload();
        const saved = await callAppsScript(job.method, payload);
        updateSaveAck(saved);
      }
      appSheetAvailable = true;
      saveRetryAttempt = 0;
      delete state._pendingAddOt;
      delete state._pendingAddOtSnapshot;
      scheduleLocalStorageFlush();
      if (showMessage) showToast("Cambios guardados");
      return true;
    } catch (error) {
      scopes.forEach((scope) => appSheetDirtyScopes.add(scope));
      const conflict = /CONFLICT_REVISION/i.test(String(error?.message || error));
      if (conflict) await refreshRevisionAfterConflict();
      console.warn("Guardado en segundo plano pendiente; se reintentara:", error);
      document.body.dataset.saveStatus = "pending";
      scheduleRetry();
      if (showMessage) showToast("Guardado pendiente; se reintentara en segundo plano", 4200);
      return false;
    } finally {
      appSheetSaveInFlight = false;
      if (document.body.dataset.saveStatus === "saving") document.body.dataset.saveStatus = "saved";
      if (appSheetSavePending || appSheetDirtyScopes.size) {
        appSheetSavePending = false;
        root.clearTimeout(appSheetSaveTimer);
        appSheetSaveTimer = root.setTimeout(() => saveAppSheet(false), SAVE_DEBOUNCE_MS);
      }
    }
  };

  loadAppStateInBackground = async function optimizedLoadAppStateInBackground() {
    let loaded = false;
    try {
      await root.PPAppsScriptBridge.ensureReady();
      const imported = await callAppsScript("getAppState");
      applyImported(imported, { preserveLocalPlanning: false });
      loaded = true;
      appSheetAvailable = true;
      deferredRevision = Number(imported.revision || state.revision || 0);
      state.savedAt = imported.savedAt || state.savedAt;
      state.syncedAt = imported.syncedAt || state.syncedAt;
      state.revision = Number(imported.revision || state.revision || 0);
      writeMeta({ revision: state.revision, syncedAt: state.syncedAt || "" });
    } catch (error) {
      appSheetAvailable = false;
      console.warn("Se mantiene el cache local porque el backend no respondio:", error);
    }

    if (loaded) await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      await loadPlanSnapshots(false);
      if (typeof restoreDraftPlanFromSharedState === "function") {
        const restoredDraft = loaded ? await restoreDraftPlanFromSharedState() : false;
        if (restoredDraft) showToast("Borrador recuperado desde Google Sheets");
      }
    } catch (error) {
      console.warn("No se pudieron cargar los borradores compartidos:", error);
    }
    state.selectedOperationId = "";
    saveState("ui");
    render({ saveScope: "ui" });
    applyInitialWorkspaceView();

    if (isAppsScriptRuntime() && shouldRefreshNetSuite()) {
      syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0 });
    }
  };

  syncNetSuiteInBackground = function optimizedSyncNetSuiteInBackground(options = {}) {
    syncNetSuiteData(options.showMessage === true, { mode: "workOrders" }).then((loaded) => {
      if (!loaded) return;
      saveState("ui");
      root.requestAnimationFrame(() => {
        renderTop();
        renderPlanAlerts();
        renderPriorityList();
        renderPriorityQueue();
      });
    });
  };

  const originalShowWorkspaceView = showWorkspaceView;
  showWorkspaceView = function optimizedShowWorkspaceView(section, tab = "") {
    originalShowWorkspaceView(section, tab);
    if (section === "reportes" && !snapshotsRequested) {
      snapshotsRequested = true;
      loadPlanSnapshots(false).catch((error) => {
        snapshotsRequested = false;
        console.warn("No se pudieron cargar los historicos:", error);
      });
    }
  };

  async function loadMaterialsForOt(ot) {
    const key = materialOtKey(ot);
    if (!key || !deferredMaterials || loadedMaterialOts.has(key)) return;
    if (materialRequests.has(key)) return materialRequests.get(key);

    const request = callAppsScript("getMaterialsForOt", ot, state.revision || deferredRevision)
      .then((result) => {
        if (result?.stale) {
          root.setTimeout(() => loadAppStateInBackground(), 0);
          return;
        }
        state.materials = [
          ...(state.materials || []).filter((item) => materialOtKey(item.ot) !== key),
          ...(Array.isArray(result?.materials) ? result.materials : []),
        ];
        loadedMaterialOts.add(key);
        scheduleLocalStorageFlush();
        if (selectedJobOt() && materialOtKey(selectedJobOt()) === key) originalRenderSelectedJobPanel();
      })
      .catch((error) => console.warn(`No se pudieron cargar materiales de ${ot}:`, error))
      .finally(() => materialRequests.delete(key));
    materialRequests.set(key, request);
    return request;
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

  writeMeta({
    revision: Number(state.revision || 0),
    deferredMaterials,
    syncedAt: state.syncedAt || "",
  });
})(window);
