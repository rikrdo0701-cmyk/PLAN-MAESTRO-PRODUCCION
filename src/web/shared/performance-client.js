(function initPerformanceClient(root) {
  "use strict";

  const META_KEY = "plan-produccion-performance-v1";
  const NETSUITE_REFRESH_MS = 15 * 60 * 1000;
  const loadedMaterialOts = new Set((state.materials || []).map((item) => materialOtKey(item.ot)));
  const materialRequests = new Map();
  let snapshotsRequested = false;
  let deferredMaterials = false;
  let deferredRevision = Number(state.revision || 0);

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

  // Reemplaza los adaptadores declarados al final de app.js y vuelve a
  // instalarlos despues del adaptador base del puente en DOMContentLoaded.
  function installPerformanceAdapters() {
    isAppsScriptRuntime = bridgeAvailable;
    callAppsScript = bridgeCall;
  }
  installPerformanceAdapters();
  document.addEventListener("DOMContentLoaded", installPerformanceAdapters, { once: true });

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

  loadAppStateInBackground = async function optimizedLoadAppStateInBackground() {
    let loaded = false;
    try {
      await root.PPAppsScriptBridge.ensureReady();

      // Google Sheets es la fuente principal. La carga completa evita que una
      // revision igual deje visibles catalogos o matriz antiguos del navegador.
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
    render();
    applyInitialWorkspaceView();

    if (isAppsScriptRuntime() && shouldRefreshNetSuite()) {
      syncNetSuiteInBackground({ showMessage: state.workOrders.length === 0 });
    }
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
  ensurePlanningDataLoaded = async function optimizedEnsurePlanningDataLoaded(showMessage) {
    const loaded = await originalEnsurePlanningDataLoaded(showMessage);
    if (loaded && Array.isArray(state.materials)) {
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
