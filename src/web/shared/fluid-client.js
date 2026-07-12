(function initFluidPlanningClient(root) {
  "use strict";

  const BUILD_ID = "fluid-2026-07-11-03";
  let materialSource = null;
  let materialLength = -1;
  let materialsByOt = new Map();
  let workOrderSource = null;
  let workOrderLength = -1;
  let workOrdersByOt = new Map();
  let jobsCache = null;
  let clearJobsQueued = false;
  let backlogIdle = null;

  console.info(`[Plan Maestro] optimizacion activa ${BUILD_ID}`);
  root.__PP_FLUID_BUILD__ = BUILD_ID;

  function key(value) {
    return materialOtKey(value);
  }

  function rebuildMaterialIndex() {
    const source = Array.isArray(state.materials) ? state.materials : [];
    if (materialSource === source && materialLength === source.length) return;
    const next = new Map();
    source.forEach((item) => {
      const otKey = key(item.ot);
      if (!otKey) return;
      const rows = next.get(otKey) || [];
      rows.push(item);
      next.set(otKey, rows);
    });
    materialsByOt = next;
    materialSource = source;
    materialLength = source.length;
  }

  function rebuildWorkOrderIndex() {
    const source = Array.isArray(state.workOrders) ? state.workOrders : [];
    if (workOrderSource === source && workOrderLength === source.length) return;
    const next = new Map();
    source.forEach((item) => {
      const otKey = key(item.ot);
      if (otKey && !next.has(otKey)) next.set(otKey, item);
    });
    workOrdersByOt = next;
    workOrderSource = source;
    workOrderLength = source.length;
  }

  materialsForOt = function indexedMaterialsForOt(ot) {
    rebuildMaterialIndex();
    return materialsByOt.get(key(ot)) || [];
  };

  workOrderForOt = function indexedWorkOrderForOt(ot) {
    rebuildWorkOrderIndex();
    return workOrdersByOt.get(key(ot)) || null;
  };

  const originalGetPriorityJobs = getPriorityJobs;
  getPriorityJobs = function cachedPriorityJobs() {
    if (jobsCache) return jobsCache;
    jobsCache = originalGetPriorityJobs();
    if (!clearJobsQueued) {
      clearJobsQueued = true;
      queueMicrotask(() => {
        jobsCache = null;
        clearJobsQueued = false;
      });
    }
    return jobsCache;
  };

  function invalidateFastCaches() {
    jobsCache = null;
    materialSource = null;
    workOrderSource = null;
  }

  const originalApplyQueuePriorities = applyQueuePriorities;
  applyQueuePriorities = function fastApplyQueuePriorities() {
    const result = originalApplyQueuePriorities();
    jobsCache = null;
    return result;
  };

  function queueCheckpoint() {
    stateHistory.push({
      __queueOnly: true,
      selectedOts: [...(state.selectedOts || [])],
      lockedOts: [...(state.lockedOts || [])],
      expandedOts: [...(state.expandedOts || [])],
      priorities: (state.operations || []).map((op) => [op.id, op.prioridad, op.locked === true]),
    });
    if (stateHistory.length > 20) stateHistory.shift();
  }

  function wrapQueueMutation(fn) {
    return function wrappedQueueMutation(...args) {
      const previousCheckpoint = checkpointState;
      checkpointState = queueCheckpoint;
      try { return fn.apply(this, args); }
      finally {
        checkpointState = previousCheckpoint;
        jobsCache = null;
      }
    };
  }

  reorderSelectedJobs = wrapQueueMutation(reorderSelectedJobs);
  toggleJobLock = wrapQueueMutation(toggleJobLock);
  toggleAllJobs = wrapQueueMutation(toggleAllJobs);

  const originalUndo = undoLastChange;
  undoLastChange = function fastUndoLastChange() {
    const previous = stateHistory[stateHistory.length - 1];
    if (!previous?.__queueOnly) return originalUndo();
    stateHistory.pop();
    state.selectedOts = [...previous.selectedOts];
    state.lockedOts = [...previous.lockedOts];
    state.expandedOts = [...previous.expandedOts];
    const values = new Map(previous.priorities || []);
    (state.operations || []).forEach((op) => {
      const saved = values.get(op.id);
      if (!saved) return;
      op.prioridad = saved[0];
      op.locked = saved[1] === true;
    });
    jobsCache = null;
    renderPriorityQueue();
    renderPriorityList();
    renderTop();
    saveState("plan");
    showToast("Ultimo cambio deshecho");
  };

  const originalRenderPriorityList = renderPriorityList;
  renderPriorityList = function deferredBacklogRender() {
    if (backlogIdle) return;
    const run = () => {
      backlogIdle = null;
      originalRenderPriorityList();
      els.priorityList?.querySelectorAll("img").forEach((image) => {
        image.loading = "lazy";
        image.decoding = "async";
      });
    };
    backlogIdle = typeof root.requestIdleCallback === "function"
      ? root.requestIdleCallback(run, { timeout: 180 })
      : root.setTimeout(run, 32);
  };

  const originalApplyImported = applyImported;
  applyImported = function indexedApplyImported(imported, options) {
    originalApplyImported(imported, options);
    invalidateFastCaches();
  };

  const originalEnsurePlanningDataLoaded = ensurePlanningDataLoaded;
  ensurePlanningDataLoaded = async function indexedEnsurePlanningDataLoaded(showMessage) {
    const loaded = await originalEnsurePlanningDataLoaded(showMessage);
    if (loaded) invalidateFastCaches();
    return loaded;
  };

  const style = document.createElement("style");
  style.textContent = `
    .priority-card,.queue-item{content-visibility:auto;contain:layout paint style}
    .priority-card{contain-intrinsic-size:168px}
    .queue-item{contain-intrinsic-size:136px}
  `;
  document.head.appendChild(style);
})(window);
