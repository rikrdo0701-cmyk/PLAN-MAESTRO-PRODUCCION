(function initPerformanceClient(root) {
  "use strict";

  const META_KEY = "plan-produccion-performance-v2";
  const NETSUITE_REFRESH_MS = 15 * 60 * 1000;
  const SAVE_DEBOUNCE_MS = 850;
  const SAVE_RETRY_MS = [1200, 2500, 5000, 10000, 20000];
  const LOCAL_CACHE_IDENTITY = "plan-produccion-cache-v2";
  const initialPerformanceMeta = readMeta();
  const initialLocalCache = readUsableLocalStateCache(initialPerformanceMeta);
  let deferredMaterials = Boolean(initialLocalCache.deferredMaterials);
  const loadedMaterialOts = new Set(deferredMaterials
    ? []
    : (state.materials || []).map((item) => materialOtKey(item.ot)));
  const activeCalls = new Map();
  const materialRequests = new Map();
  let snapshotsRequested = false;
  let snapshotsMessageRequested = false;
  let syncWorkOrdersMessageRequested = false;
  let initialStateLoadPending = true;
  let deferredRevision = Number(state.revision || initialLocalCache.revision || 0);
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
      revision: Number(patch.revision ?? state.revision ?? deferredRevision ?? 0),
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
    const { matrixSearch, ...persisted } = state;
    const revision = Number(state.revision || 0);
    return {
      ...persisted,
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

  scheduleLocalStorageFlush = function optimizedScheduleLocalStorageFlush() {
    if (localFlushHandle) return;
    localFlushHandle = requestIdle(() => {
      localFlushHandle = null;
      try {
        const compacted = compactLocalState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
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
      loadedMaterialOts.clear();
      if (!deferredMaterials) {
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
      operations: clone(state.operations || []),
      workOrders: clone(state.workOrders || []),
      otConfigurations: clone(state.otConfigurations || {}),
      articleConfigurations: clone(state.articleConfigurations || {}),
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

  async function reloadStateAfterConflict() {
    try {
      const imported = await callAppsScript("getAppState");
      applyImported(imported, { preserveLocalPlanning: false });
      deferredRevision = Number(imported.revision || state.revision || 0);
      writeMeta({ revision: deferredRevision, syncedAt: state.syncedAt || "" });
      scheduleLocalStorageFlush();
      return true;
    } catch (error) {
      console.warn("No se pudo recargar el estado despues del conflicto:", error);
      return false;
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
      const conflict = /CONFLICT_REVISION/i.test(String(error?.message || error));
      if (conflict) {
        const reloaded = await reloadStateAfterConflict();
        appSheetSavePending = false;
        document.body.dataset.saveStatus = reloaded ? "conflict" : "pending";
        if (showMessage) showToast(reloaded
          ? "Otro usuario guardo cambios; se recargo el estado vigente"
          : "Conflicto de guardado; recarga antes de continuar", 4200);
        return false;
      }
      scopes.forEach((scope) => appSheetDirtyScopes.add(scope));
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
        && Array.isArray(cached.operations)
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
    const imported = revision > 0
      ? await callAppsScript("getAppStateIfChanged", revision, { includeMaterials: false })
      : await callAppsScript("getAppState");
    if (imported?.unchanged) {
      const currentRevision = Number(imported.revision || revision);
      deferredMaterials = localCache.deferredMaterials === true;
      if (deferredMaterials) loadedMaterialOts.clear();
      state.revision = currentRevision;
      state.savedAt = imported.savedAt || state.savedAt;
      state.syncedAt = imported.syncedAt || state.syncedAt;
      deferredRevision = currentRevision;
      writeMeta({
        revision: currentRevision,
        savedAt: state.savedAt || "",
        syncedAt: state.syncedAt || "",
      });
      return { loaded: false, unchanged: true };
    }
    applyImported(imported, { preserveLocalPlanning: false });
    deferredRevision = Number(imported?.revision || state.revision || 0);
    state.savedAt = imported?.savedAt || state.savedAt;
    state.syncedAt = imported?.syncedAt || state.syncedAt;
    state.revision = Number(imported?.revision || state.revision || 0);
    writeMeta({
      revision: state.revision,
      savedAt: state.savedAt || "",
      syncedAt: state.syncedAt || "",
    });
    return { loaded: true, unchanged: false };
  }

  loadAppStateInBackground = function optimizedLoadAppStateInBackground() {
    return singleFlight("state", async () => {
      let loaded = false;
      try {
        await root.PPAppsScriptBridge.ensureReady();
        const result = await loadInitialStateConditionally(initialLocalCache);
        loaded = result.loaded;
        appSheetAvailable = true;
      } catch (error) {
        appSheetAvailable = false;
        console.warn("Se mantiene el cache local porque el backend no respondio:", error);
      }

      if (loaded) await new Promise((resolve) => requestAnimationFrame(resolve));
      initialStateLoadPending = false;
      state.selectedOperationId = "";
      saveState("ui");
      render({ saveScope: "ui" });
      applyInitialWorkspaceView();

      if (isAppsScriptRuntime() && shouldRefreshNetSuite()) {
        syncWorkOrdersOnce({ showMessage: state.workOrders.length === 0 });
      }
    });
  };

  const originalLoadPlanSnapshots = loadPlanSnapshots;
  function requestPlanSnapshots(showMessage) {
    snapshotsMessageRequested ||= showMessage === true;
    return singleFlight("snapshots", async () => {
      try {
        const result = await originalLoadPlanSnapshots(false);
        snapshotsRequested = result?.ok === true && Number(result.count || 0) > 0;
        if (snapshotsMessageRequested) {
          const message = result?.ok
            ? `${Number(result.count || 0)} planes guardados disponibles`
            : `No se pudieron cargar los planes guardados: ${result?.error || "Error desconocido"}`;
          showToast(message);
        }
        return result;
      } catch (error) {
        snapshotsRequested = false;
        throw error;
      } finally {
        snapshotsMessageRequested = false;
      }
    });
  }

  loadSnapshotsOnce = function optimizedLoadSnapshotsOnce(showMessage) {
    if (activeCalls.has("snapshots")) return requestPlanSnapshots(showMessage);
    if (snapshotsRequested && Array.isArray(planSnapshots) && planSnapshots.length > 0) {
      return Promise.resolve({ ok: true, count: planSnapshots.length });
    }
    return requestPlanSnapshots(showMessage);
  };

  loadPlanSnapshots = function optimizedLoadPlanSnapshots(showMessage) {
    return requestPlanSnapshots(showMessage);
  };

  const originalSyncNetSuiteData = syncNetSuiteData;
  syncWorkOrdersOnce = function optimizedSyncWorkOrdersOnce(options = {}) {
    syncWorkOrdersMessageRequested ||= options.showMessage === true;
    return singleFlight("sync-work-orders", async () => {
      try {
        const loaded = await originalSyncNetSuiteData(false, { mode: "workOrders" });
        if (loaded) {
          saveState(syncWorkOrdersMessageRequested ? "plan" : "ui");
          if (syncWorkOrdersMessageRequested) {
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
        } else if (syncWorkOrdersMessageRequested) {
          showToast(`No se pudo cargar NetSuite: ${state.netSuiteSyncAlert?.message || "Error desconocido"}`, 9000);
        }
        return loaded;
      } finally {
        syncWorkOrdersMessageRequested = false;
      }
    });
  };

  const originalShowWorkspaceView = showWorkspaceView;
  showWorkspaceView = function optimizedShowWorkspaceView(section, tab = "") {
    originalShowWorkspaceView(section, tab);
    if (section === "reportes" && !snapshotsRequested && !initialStateLoadPending) {
      loadSnapshotsOnce(false).catch((error) => {
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
    revision: Number(state.revision || initialPerformanceMeta.revision || 0),
    deferredMaterials,
    syncedAt: state.syncedAt || "",
  });
})(window);
