(function initPlanningWorkflowCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlanningWorkflowCore = api;
  if (typeof window !== "undefined") window.PlanningWorkflowCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlanningWorkflowCore() {
  "use strict";

  function normalize(value) {
    return String(value || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function toolList(value) {
    let values = value;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return [];
      try { values = JSON.parse(text); } catch (_) { values = text.split(/[,+;|]/); }
    }
    if (!Array.isArray(values)) values = [];
    return [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))];
  }

  function additionalToolEntry(value) {
    if (value && typeof value === "object") {
      return {
        herramental: String(value.herramental || value.tool || "").trim(),
        machine: String(value.machine || value.maquina || "").trim(),
      };
    }
    return { herramental: String(value || "").trim(), machine: "" };
  }

  function additionalToolList(value) {
    let values = value;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return [];
      try { values = JSON.parse(text); } catch (_) { values = text.split(/[,+;|]/); }
    }
    if (!Array.isArray(values)) values = [];
    const out = [];
    const seen = new Set();
    values.forEach((item) => {
      const entry = additionalToolEntry(item);
      if (!entry.herramental) return;
      const key = `${normalize(entry.herramental)}|${normalize(entry.machine)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(entry.machine ? entry : entry.herramental);
    });
    return out;
  }

  function withTimeout(promise, milliseconds) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`NetSuite no respondio en ${Number(milliseconds) / 1000} segundos`)), milliseconds);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  }

  function hasPlanningData(state, ots) {
    const requested = new Set((ots || []).map(normalize).filter(Boolean));
    if (!requested.size) return false;
    const available = new Set((state?.operations || []).map((operation) => normalize(operation?.ot)).filter(Boolean));
    return [...requested].every((ot) => available.has(ot));
  }

  function planningOtSyncedAt(state, ot) {
    const key = normalize(ot);
    if (!key) return 0;
    const map = (state?.operationsSyncedAt && typeof state.operationsSyncedAt === "object") ? state.operationsSyncedAt : {};
    const raw = map[key] || map[ot] || "";
    if (Number.isFinite(Number(raw))) return Number(raw);
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function planningOtsWithData(state, ots) {
    const requested = new Set((ots || []).map(normalize).filter(Boolean));
    if (!requested.size) return [];
    const available = new Set((state?.operations || []).map((operation) => normalize(operation?.ot)).filter(Boolean));
    return (ots || []).filter((ot) => available.has(normalize(ot)));
  }

  function planningDataAvailability(state, ots, maxAgeMs) {
    const requested = (ots || []).map(normalize).filter(Boolean);
    const available = new Set((state?.operations || []).map((operation) => normalize(operation?.ot)).filter(Boolean));
    const now = Date.now();
    const ageWindow = Number.isFinite(Number(maxAgeMs)) && Number(maxAgeMs) > 0 ? Number(maxAgeMs) : Number.POSITIVE_INFINITY;
    const availableOts = [];
    const missingOts = [];
    const staleOts = [];
    requested.forEach((ot) => {
      if (!available.has(ot)) {
        missingOts.push(ot);
        return;
      }
      const synced = planningOtSyncedAt(state, ot);
      if (synced <= 0 || now - synced >= ageWindow) staleOts.push(ot);
      else availableOts.push(ot);
    });
    return { availableOts, missingOts, staleOts };
  }

  function markPlanningOtSynced(state, ot, syncedAt) {
    const key = normalize(ot);
    if (!key) return state;
    const stamp = syncedAt || new Date().toISOString();
    const incoming = state.operationsSyncedAt && typeof state.operationsSyncedAt === "object" ? state.operationsSyncedAt : {};
    return { ...(state || {}), operationsSyncedAt: { ...incoming, [key]: stamp } };
  }

  function isHistorical(operation) {
    const status = normalize(operation?.planStatus || operation?.estatus);
    return operation?.historical === true || operation?.isHistorical === true ||
      ["PUBLICADO", "PUBLICADA", "GUARDADO", "GUARDADA", "HISTORICO", "HISTORICA"].includes(status);
  }

  function prepareDraftForReschedule(state, ots) {
    const selected = new Set((ots || state?.selectedOts || []).map(normalize).filter(Boolean));
    return {
      ...(state || {}),
      operations: (state?.operations || []).map((operation) => {
        const preserved = !selected.has(normalize(operation?.ot)) || isLockedOperation(state, operation) ||
          normalize(operation?.planStatus) === "COMPLETADA_PLAN" || isHistorical(operation);
        if (preserved) return { ...operation };
        return {
          ...operation,
          fechaInicio: "", horaInicio: "", fechaFin: "", horaFin: "",
          operador: "",
          needsReschedule: false, autoFrozen: false, estatus: "PLAN", planStatus: "PENDIENTE",
        };
      }),
    };
  }

  function isLockedOperation(state, operation) {
    const ot = normalize(operation?.ot);
    return (state?.lockedOts || []).some((item) => normalize(item) === ot);
  }

  function filterOperationsByPlanStatus(rows, status) {
    const filter = normalize(status);
    if (filter === "TODAS") return (rows || []).slice();
    const completed = filter === "COMPLETADAS";
    return (rows || []).filter((row) => (normalize(row?.planStatus) === "COMPLETADA_PLAN") === completed);
  }

  const GANTT_VIEWS = ["job", "ct", "machine", "operator"];

  function normalizeGanttView(view) {
    const value = String(view || "").trim().toLowerCase();
    return GANTT_VIEWS.includes(value) ? value : "job";
  }

  function isActiveGanttView(current, candidate) {
    return normalizeGanttView(current) === candidate;
  }

  function isMachineGanttOperation(operation) {
    if (!operation || !String(operation.maquina || operation.machine || "").trim()) return false;
    if (!operation.fechaInicio || !operation.horaInicio || !operation.fechaFin || !operation.horaFin) return false;
    const status = normalize(operation.planStatus || operation.estatus);
    if (status === "COMPLETADA_PLAN" || isHistorical(operation)) return false;
    const type = normalize(operation.tipoInsercion);
    if (type === "CAMBIO_HERRAMENTAL") return normalize(operation.generatedBy) === "PLANNER_CORE_V2";
    if (type && type !== "OPERACION") return false;
    return ["5459", "5527"].includes(String(operation.ct || "").trim());
  }

  function isOtEligibleForDraft(state, ot) {
    const key = normalize(ot);
    return (state?.selectedOts || []).some((item) => normalize(item) === key);
  }

  function canRemoveSelectedOt(state, ot) {
    const key = normalize(ot);
    const locked = new Set((state?.lockedOts || []).map(normalize).filter(Boolean));
    return locked.has(key)
      ? { allowed: false, reason: "Desbloquea la OT antes de retirarla del plan" }
      : { allowed: true, reason: "" };
  }

  function ganttOperationTiming(productiveMinutes, start, end) {
    const productive = Math.max(0, Math.round(Number(productiveMinutes) || 0));
    const startTime = start instanceof Date ? start.getTime() : new Date(start).getTime();
    const endTime = end instanceof Date ? end.getTime() : new Date(end).getTime();
    const elapsed = Number.isFinite(startTime) && Number.isFinite(endTime)
      ? Math.max(0, Math.round((endTime - startTime) / 60000))
      : 0;
    return {
      productiveMinutes: productive,
      elapsedMinutes: elapsed,
      nonOperatingMinutes: Math.max(0, elapsed - productive),
    };
  }

  const WORK_ORDER_LITE_FIELDS = ["item", "quantity", "builtQuantity", "pendingQuantity", "status", "exists"];

  function normalizedLiteWorkOrder(workOrder) {
    const source = workOrder || {};
    return {
      ...source,
      ot: String(source.ot || source.woFolio || "").trim(),
      item: String(source.item || source.article || source.parte || "").trim(),
      quantity: Number(source.quantity ?? source.cantidad ?? 0),
      builtQuantity: Math.max(0, Number(source.builtQuantity ?? source.quantityBuilt ?? source.cantidadEnsamblada ?? 0)),
      pendingQuantity: Math.max(0, Number(source.pendingQuantity ?? source.cantidadPendiente ?? Math.max(0,
        Number(source.quantity ?? source.cantidad ?? 0) - Number(source.builtQuantity ?? source.quantityBuilt ?? source.cantidadEnsamblada ?? 0)))),
      status: String(source.status || source.estatus || "").trim(),
      exists: source.exists ?? source.existence ?? source.existe ?? true,
    };
  }

  function mergeLiteWorkOrder(current, incoming) {
    const normalizedIncoming = normalizedLiteWorkOrder(incoming);
    const merged = { ...(current || {}), ot: normalizedIncoming.ot };
    for (const field of WORK_ORDER_LITE_FIELDS) merged[field] = normalizedIncoming[field];
    return merged;
  }

  function liteWorkOrderChanged(current, incoming) {
    if (!current) return true;
    const normalizedCurrent = normalizedLiteWorkOrder(current);
    const normalizedIncoming = normalizedLiteWorkOrder(incoming);
    return WORK_ORDER_LITE_FIELDS.some((field) => normalizedCurrent[field] !== normalizedIncoming[field]);
  }

  function liteQuantityChanged(current, incoming) {
    if (!current) return false;
    const left = normalizedLiteWorkOrder(current);
    const right = normalizedLiteWorkOrder(incoming);
    return ["quantity", "builtQuantity", "pendingQuantity"].some((field) => left[field] !== right[field]);
  }

  function isOtLockedInState(state, ot) {
    const key = normalize(ot);
    return (state?.lockedOts || []).some((item) => normalize(item) === key);
  }

  function otHasCompletedOperations(state, ot) {
    const key = normalize(ot);
    return (state?.operations || []).some((operation) =>
      normalize(operation?.ot) === key &&
      (isHistorical(operation) || normalize(operation?.planStatus || operation?.estatus) === "COMPLETADA_PLAN")
    );
  }

  function pendingOperationsForOt(state, ot) {
    const key = normalize(ot);
    return (state?.operations || []).filter((operation) =>
      normalize(operation?.ot) === key &&
      !isHistorical(operation) &&
      normalize(operation?.planStatus || operation?.estatus) !== "COMPLETADA_PLAN"
    );
  }

  function operationsRouteSignature(operations) {
    return (operations || [])
      .map((operation) => {
        const secuencia = normalize(String(operation?.secuencia ?? ""));
        const ct = normalize(String(operation?.ct ?? ""));
        const descripcion = normalize(String(operation?.descripcion || operation?.tipoInsercion || ""));
        return secuencia && ct ? [secuencia, ct, descripcion].filter(Boolean).join("|") : "";
      })
      .filter(Boolean)
      .sort()
      .join("\u001e");
  }

  const SMART_SYNC_DECISIONS = {
    BLOCKED: "blocked",
    REVIEW_COMPLETED: "review_completed",
    REVIEW_CHANGED: "review_changed",
    REVIEW_UNSTABLE: "review_unstable",
    UPDATE_CANDIDATE: "update_candidate",
  };

  function classifySmartSyncChange(state, incomingWorkOrders) {
    const source = state || {};
    const selected = new Set((source.selectedOts || []).map(normalize).filter(Boolean));
    const currentByOt = new Map((source.workOrders || []).map((item) => [normalize(item?.ot), item]));
    const byOt = {};
    const counts = {
      unchanged: 0, updated: 0, reviewChanged: 0, reviewCompleted: 0, blocked: 0, reviewUnstable: 0,
    };
    const updateCandidates = [];

    for (const workOrder of (incomingWorkOrders || [])) {
      const normalizedIncoming = normalizedLiteWorkOrder(workOrder);
      const key = normalize(normalizedIncoming.ot);
      if (!key || !selected.has(key)) continue;
      const current = currentByOt.get(key);
      const record = {
        ot: String(normalizedIncoming.ot).trim(),
        current: current ? { ...current } : null,
        incoming: { ...normalizedIncoming },
      };
      if (isOtLockedInState(source, key)) {
        record.decision = SMART_SYNC_DECISIONS.BLOCKED;
        counts.blocked += 1;
      } else if (otHasCompletedOperations(source, key)) {
        record.decision = SMART_SYNC_DECISIONS.REVIEW_COMPLETED;
        counts.reviewCompleted += 1;
      } else if (current && (liteQuantityChanged(current, normalizedIncoming) ||
          normalize(current?.item) !== normalize(normalizedIncoming.item))) {
        record.decision = SMART_SYNC_DECISIONS.REVIEW_CHANGED;
        counts.reviewChanged += 1;
      } else {
        const pending = pendingOperationsForOt(source, key);
        const signature = operationsRouteSignature(pending);
        if (!pending.length || !signature) {
          record.decision = SMART_SYNC_DECISIONS.REVIEW_UNSTABLE;
          counts.reviewUnstable += 1;
        } else {
          record.decision = SMART_SYNC_DECISIONS.UPDATE_CANDIDATE;
          record.signature = signature;
          updateCandidates.push(record);
        }
      }
      byOt[key] = record;
    }
    return { byOt, counts, updateCandidates };
  }

  function finalizeSmartSyncSummary(classification, refreshResults) {
    const counts = { ...(classification?.counts || {}) };
    for (const record of classification?.updateCandidates || []) {
      const key = normalize(record.ot);
      const refresh = refreshResults?.[key];
      if (refresh?.changed) counts.updated = (counts.updated || 0) + 1;
      else counts.unchanged = (counts.unchanged || 0) + 1;
    }
    return counts;
  }

  function smartSyncSummaryMessage(counts) {
    const c = counts || {};
    const review = Number(c.reviewChanged || 0) + Number(c.reviewUnstable || 0);
    return [
      `${Number(c.unchanged || 0)} OTs sin cambios`,
      `${Number(c.updated || 0)} actualizadas`,
      `${review} con ruta/cantidad distinta (revisar)`,
      `${Number(c.blocked || 0)} bloqueadas`,
      `${Number(c.reviewCompleted || 0)} con completadas`,
    ].join(", ");
  }

  const PLANNING_ROUTE_FIELDS = [
    "id", "num", "ot", "parte", "descripcion", "contenido", "fechaReq", "cantTotal", "secuencia", "ct",
    "cantPendiente", "tiempoCiclo", "tiempoSetup", "tiempoProd", "tiempoFallback", "tipoInsercion",
  ];

  function mergeOtRouteOperation(remoteOperation, existingOperation) {
    if (!existingOperation) return { ...(remoteOperation || {}) };
    const route = {};
    PLANNING_ROUTE_FIELDS.forEach((field) => {
      if (Object.hasOwn(remoteOperation, field)) route[field] = remoteOperation[field];
    });
    const merged = { ...existingOperation, ...route };
    if (remoteOperation?.tiempoFallback !== true) delete merged.tiempoFallback;
    return merged;
  }

  function mergeOtRouteOperations(remoteOperations, existingOperations) {
    const existing = (existingOperations || []).filter(Boolean);
    const preserved = existing.filter((operation) =>
      isHistorical(operation) ||
      normalize(operation?.planStatus || operation?.estatus) === "COMPLETADA_PLAN" ||
      normalize(operation?.tipoInsercion) === "CAMBIO_HERRAMENTAL"
    );
    const matchable = existing.filter((operation) => normalize(operation?.tipoInsercion) !== "CAMBIO_HERRAMENTAL");
    const existingBySequence = new Map();
    const existingByCt = new Map();
    matchable.forEach((operation) => {
      const sequenceKey = [normalize(operation?.ot), String(operation?.secuencia ?? "").trim()].join("|");
      const ctKey = [normalize(operation?.ot), String(operation?.ct ?? "").trim().toUpperCase()].join("|");
      if (sequenceKey && !existingBySequence.has(sequenceKey)) existingBySequence.set(sequenceKey, operation);
      if (ctKey && !existingByCt.has(ctKey)) existingByCt.set(ctKey, operation);
    });
    const merged = (remoteOperations || []).map((operation) => {
      const sequenceKey = [normalize(operation?.ot), String(operation?.secuencia ?? "").trim()].join("|");
      const ctKey = [normalize(operation?.ot), String(operation?.ct ?? "").trim().toUpperCase()].join("|");
      const existingOperation = existingBySequence.get(sequenceKey) || existingByCt.get(ctKey);
      return mergeOtRouteOperation(operation, existingOperation);
    });
    return { preserved, merged };
  }

  function compareWorkOrderLite(currentState, incomingWorkOrders) {
    const state = currentState || {};
    const selected = new Set((state.selectedOts || []).map(normalize).filter(Boolean));
    const currentByOt = new Map((state.workOrders || []).map((item) => [normalize(item?.ot), item]));
    const incoming = (incomingWorkOrders || []).map(normalizedLiteWorkOrder).filter((item) => normalize(item.ot));
    const incomingKeys = new Set(incoming.map((item) => normalize(item.ot)));
    const direct = [];
    const plannedQuantityChanges = [];
    const nextWorkOrders = [];

    for (const item of incoming) {
      const key = normalize(item.ot);
      const current = currentByOt.get(key);
      const merged = mergeLiteWorkOrder(current, item);
      nextWorkOrders.push(merged);
      if (current && selected.has(key) && liteQuantityChanged(current, item)) {
        plannedQuantityChanges.push({ ot: item.ot, current: { ...current }, incoming: { ...merged } });
      } else if (!current || liteWorkOrderChanged(current, item)) {
        direct.push({ ot: item.ot, current: current ? { ...current } : null, incoming: { ...merged } });
      }
    }

    const plannedClosed = (state.workOrders || [])
      .filter((item) => selected.has(normalize(item?.ot)) && !incomingKeys.has(normalize(item?.ot)))
      .map((item) => ({ ot: String(item.ot || "").trim(), current: { ...item }, incoming: null }));
    return { direct, plannedQuantityChanges, plannedClosed, nextWorkOrders };
  }

  function applyConfirmedWorkOrderChanges(state, comparison, decisions) {
    const source = state || {};
    const result = {
      ...source,
      workOrders: (comparison?.nextWorkOrders || []).map((item) => ({ ...item })),
      operations: (source.operations || []).map((item) => ({ ...item })),
      workOrderSyncWarnings: (source.workOrderSyncWarnings || []).map((item) => ({ ...item })),
    };
    const accepted = new Set((decisions?.acceptQuantityOts || []).map(normalize));
    const removed = new Set((decisions?.removeClosedOts || []).map(normalize));
    const kept = new Set((decisions?.keepClosedOts || []).map(normalize));
    const replaceWorkOrder = (workOrder) => {
      const key = normalize(workOrder?.ot);
      result.workOrders = result.workOrders.filter((item) => normalize(item?.ot) !== key);
      result.workOrders.push({ ...workOrder });
    };
    const warn = (ot, type, details = {}) => result.workOrderSyncWarnings.push({
      ot: String(ot || "").trim(), type, createdAt: new Date().toISOString(), ...details,
    });

    for (const change of comparison?.plannedQuantityChanges || []) {
      const key = normalize(change.ot);
      if (!accepted.has(key)) {
        replaceWorkOrder(change.current);
        warn(change.ot, "QUANTITY_REJECTED", { current: { ...change.current }, incoming: { ...change.incoming } });
        continue;
      }
      replaceWorkOrder(change.incoming);
      result.draftNeedsReschedule = true;
      let lockedIncompatibility = false;
      result.operations = result.operations.map((operation) => {
        if (normalize(operation?.ot) !== key || !isPendingDraftOperation(operation)) return operation;
        if (operation.locked === true) {
          lockedIncompatibility = true;
          return operation;
        }
        return {
          ...operation,
          fechaInicio: "", horaInicio: "", fechaFin: "", horaFin: "",
          needsReschedule: true,
        };
      });
      if (lockedIncompatibility) warn(change.ot, "LOCKED_INCOMPATIBILITY", { incoming: { ...change.incoming } });
    }

    for (const closed of comparison?.plannedClosed || []) {
      const key = normalize(closed.ot);
      if (!removed.has(key)) {
        replaceWorkOrder(closed.current);
        warn(closed.ot, "CLOSED_KEPT", { explicit: kept.has(key), current: { ...closed.current } });
        continue;
      }
      const completed = result.operations.filter((operation) => normalize(operation?.ot) === key && !isPendingDraftOperation(operation));
      Object.assign(result, removeOtFromDraft(result, closed.ot));
      result.operations = [
        ...result.operations.filter((operation) => normalize(operation?.ot) !== key),
        ...completed,
      ];
      result.workOrders = result.workOrders.filter((item) => normalize(item?.ot) !== key);
      result.draftNeedsReschedule = true;
    }
    return result;
  }

  function schedulingSelectedOts(state) {
    const closed = new Set((state?.workOrderSyncWarnings || [])
      .filter((warning) => normalize(warning?.type) === "CLOSED_KEPT")
      .map((warning) => normalize(warning?.ot)));
    return (state?.selectedOts || []).filter((ot) => !closed.has(normalize(ot)));
  }

  function removeOtFromDraft(state, ot) {
    const key = normalize(ot);
    const without = (items) => (items || []).filter((item) => normalize(item) !== key);
    const preparedPlanningByOt = { ...(state?.preparedPlanningByOt || {}) };
    Object.keys(preparedPlanningByOt).forEach((item) => { if (normalize(item) === key) delete preparedPlanningByOt[item]; });
    const selectedOperation = (state?.operations || []).find((operation) => String(operation?.id || "") === String(state?.selectedOperationId || ""));
    return {
      ...(state || {}),
      selectedOts: without(state?.selectedOts),
      lockedOts: without(state?.lockedOts),
      expandedOts: without(state?.expandedOts),
      preparedPlanningByOt,
      _pendingAddOt: normalize(state?._pendingAddOt) === key ? undefined : state?._pendingAddOt,
      _pendingAddOtSnapshot: Array.isArray(state?._pendingAddOtSnapshot) ? without(state._pendingAddOtSnapshot) : state?._pendingAddOtSnapshot,
      selectedDetailOt: normalize(state?.selectedDetailOt) === key ? "" : state?.selectedDetailOt,
      selectedOperationId: normalize(selectedOperation?.ot) === key ? "" : state?.selectedOperationId,
      draftVersionId: "",
      operations: (state?.operations || []).map((operation) => {
        if (normalize(operation?.ot) !== key) return operation;
        if (!isPendingDraftOperation(operation) || isHistorical(operation)) return { ...operation, locked: false };
        return {
          ...operation,
          locked: false,
          autoFrozen: false,
          needsReschedule: true,
          fechaInicio: "",
          horaInicio: "",
          fechaFin: "",
          horaFin: "",
          operador: "",
          estatus: "PLAN",
          planStatus: "PENDIENTE",
        };
      }),
      lastSchedule: state?.lastSchedule ? {
        ...state.lastSchedule,
        scheduledOts: without(state.lastSchedule.scheduledOts),
      } : state?.lastSchedule,
    };
  }

  function setDraftOperationCompletion(operation, completed, timestamp = "") {
    const next = { ...(operation || {}), planStatus: completed ? "COMPLETADA_PLAN" : "PENDIENTE" };
    if (completed) next.completedAt = timestamp || new Date().toISOString();
    else delete next.completedAt;
    return next;
  }

  function isPendingDraftOperation(operation) {
    return normalize(operation?.planStatus) !== "COMPLETADA_PLAN";
  }

  function operationalPlanOptions(snapshots) {
    return [
      { id: "draft", name: "Borrador", status: "BORRADOR" },
      ...(snapshots || []).filter((snapshot) => normalize(snapshot?.status || snapshot?.planStatus) === "PUBLICADO"),
    ];
  }

  function draftExportOperations(state) {
    const scope = Array.isArray(state?.lastSchedule?.scheduledOts)
      ? state.lastSchedule.scheduledOts
      : state?.selectedOts;
    const selected = new Set((scope || []).map(normalize));
    return (state?.operations || []).filter((operation) => selected.has(normalize(operation?.ot)) &&
      isPendingDraftOperation(operation) && !isHistorical(operation) &&
      Boolean(operation?.fechaInicio && operation?.fechaFin));
  }

  function draftScheduledOperations(state) {
    const scope = Array.isArray(state?.lastSchedule?.scheduledOts)
      ? state.lastSchedule.scheduledOts
      : state?.selectedOts;
    const selected = new Set((scope || []).map(normalize).filter(Boolean));
    return (state?.operations || []).filter((operation) =>
      selected.has(normalize(operation?.ot)) &&
      !isHistorical(operation) &&
      Boolean(operation?.fechaInicio && operation?.fechaFin));
  }

  function pruneDraftToOpenWorkOrders(state, workOrders) {
    const open = new Set((workOrders || []).map((item) => normalize(item?.ot)).filter(Boolean));
    const keep = (items) => (items || []).filter((ot) => open.has(normalize(ot)));
    return {
      ...(state || {}),
      selectedOts: keep(state?.selectedOts),
      lockedOts: keep(state?.lockedOts),
      expandedOts: keep(state?.expandedOts),
      lastSchedule: state?.lastSchedule ? {
        ...state.lastSchedule,
        scheduledOts: keep(state.lastSchedule.scheduledOts),
      } : state?.lastSchedule,
    };
  }

  function compactClosedWorkOrder(workOrder, operations, closedDetectedAt) {
    const scheduled = (operations || []).flatMap((operation) => [
      scheduleTimestamp(operation?.fechaInicio, operation?.horaInicio),
      scheduleTimestamp(operation?.fechaFin, operation?.horaFin),
    ]).filter(Boolean).sort();
    const scheduledStart = scheduled[0] || String(workOrder?.scheduledStart || workOrder?.fechaInicio || "");
    const scheduledEnd = scheduled[scheduled.length - 1] || String(workOrder?.scheduledEnd || workOrder?.fechaFin || "");
    return {
      ot: String(workOrder?.ot || "").trim(),
      item: String(workOrder?.item || workOrder?.article || workOrder?.parte || "").trim(),
      quantity: Number(workOrder?.quantity ?? workOrder?.cantidad ?? 0),
      scheduledStart,
      scheduledEnd,
      weekStart: scheduledStart ? mondayIso(scheduledStart) : "",
      finalStatus: "CERRADA",
      closedDetectedAt,
    };
  }

  function scheduleTimestamp(date, time) {
    const day = String(date || "").trim();
    if (!day) return "";
    if (day.includes("T")) return new Date(day).toISOString();
    const clock = String(time || "").trim() || "00:00";
    const value = new Date(`${day}T${clock}:00Z`);
    return Number.isNaN(value.getTime()) ? "" : `${day}T${clock}:00Z`;
  }

  function withoutOtKeyedValues(values, closed) {
    return Object.fromEntries(Object.entries(values || {}).filter(([key]) => !closed.has(normalize(key))));
  }

  function reconcileActiveWorkOrders(state, incomingWorkOrders, nowIso) {
    const source = state || {};
    const incoming = (incomingWorkOrders || []).map(normalizedLiteWorkOrder).filter((item) => normalize(item.ot));
    const active = new Set(incoming.map((item) => normalize(item.ot)));
    const currentByOt = new Map((source.workOrders || []).map((item) => [normalize(item?.ot), item]));
    const candidates = new Set([...(source.workOrders || []).map((item) => normalize(item?.ot)), ...(source.selectedOts || []).map(normalize)].filter(Boolean));
    const closed = new Set([...candidates].filter((ot) => !active.has(ot)));
    const summaries = { ...(source.closedWorkOrderSummaries || {}) };
    Object.keys(summaries).forEach((key) => {
      if (active.has(normalize(key))) delete summaries[key];
    });

    for (const ot of closed) {
      const current = currentByOt.get(ot) || { ot };
      const existingKey = Object.keys(summaries).find((key) => normalize(key) === ot);
      if (!existingKey) {
        const relatedOperations = (source.operations || []).filter((operation) => normalize(operation?.ot) === ot);
        summaries[String(current.ot || ot).trim()] = compactClosedWorkOrder(current, relatedOperations, nowIso);
      }
    }

    const keepOt = (ot) => !closed.has(normalize(ot));
    const compactRows = (rows) => (rows || []).filter((row) => keepOt(row?.ot)).map((row) => ({ ...row }));
    const currentOperations = (source.operations || []).filter((operation) => keepOt(operation?.ot)).map((operation) => ({ ...operation }));
    const operationPlanStatuses = Object.fromEntries(Object.entries(source.operationPlanStatuses || {})
      .filter(([, status]) => keepOt(status?.ot))
      .map(([key, status]) => [key, { ...status }]));
    const selectedOperation = (source.operations || []).find((operation) => String(operation?.id) === String(source.selectedOperationId || ""));
    const selectedOperationRemoved = Boolean(source.selectedOperationId) && !currentOperations
      .some((operation) => String(operation?.id) === String(source.selectedOperationId));
    const selectedOperationId = closed.has(normalize(selectedOperation?.ot)) || selectedOperationRemoved ? "" : source.selectedOperationId;
    const nextWorkOrders = incoming.map((item) => ({ ...mergeLiteWorkOrder(currentByOt.get(normalize(item.ot)), item) }));
    return {
      ...source,
      selectedOts: (source.selectedOts || []).filter(keepOt),
      lockedOts: (source.lockedOts || []).filter(keepOt),
      expandedOts: (source.expandedOts || []).filter(keepOt),
      workOrders: nextWorkOrders,
      operations: currentOperations,
      operationPlanStatuses,
      materials: compactRows(source.materials),
      otConfigurations: withoutOtKeyedValues(source.otConfigurations, closed),
      planningConfigByOt: withoutOtKeyedValues(source.planningConfigByOt, closed),
      preparedPlanningByOt: withoutOtKeyedValues(source.preparedPlanningByOt, closed),
      lastSchedule: source.lastSchedule ? {
        ...source.lastSchedule,
        scheduledOts: (source.lastSchedule.scheduledOts || []).filter(keepOt),
      } : source.lastSchedule,
      selectedDetailOt: closed.has(normalize(source.selectedDetailOt)) ? "" : source.selectedDetailOt,
      selectedOperationId,
      closedWorkOrderSummaries: summaries,
    };
  }

  function purgeClosedWorkOrderRetention(state, nowIso) {
    const source = state || {};
    const now = new Date(nowIso).getTime();
    const expired = new Set(Object.entries(source.closedWorkOrderSummaries || {})
      .filter(([, summary]) => Number.isFinite(now) && now - new Date(summary?.closedDetectedAt).getTime() >= 5 * 86400000)
      .map(([ot]) => normalize(ot)));
    const operations = (source.operations || []).filter((operation) => !expired.has(normalize(operation?.ot))).map((operation) => ({ ...operation }));
    const selectedOperationRemoved = Boolean(source.selectedOperationId) && !operations
      .some((operation) => String(operation?.id) === String(source.selectedOperationId));
    return {
      ...source,
      operations,
      operationPlanStatuses: Object.fromEntries(Object.entries(source.operationPlanStatuses || {})
        .filter(([, status]) => !expired.has(normalize(status?.ot)))
        .map(([key, status]) => [key, { ...status }])),
      selectedDetailOt: expired.has(normalize(source.selectedDetailOt)) ? "" : source.selectedDetailOt,
      selectedOperationId: selectedOperationRemoved ? "" : source.selectedOperationId,
      closedWorkOrderSummaries: { ...(source.closedWorkOrderSummaries || {}) },
    };
  }

  function needsPlanningPreparation(state, ot, signature) {
    if (!isOtEligibleForDraft(state, ot)) return false;
    return String(state?.preparedPlanningByOt?.[ot] || "") !== String(signature || "");
  }

  function canReusePlanningPreparation(state, ot, hasRequiredGaps) {
    if (hasRequiredGaps === true || !isOtEligibleForDraft(state, ot)) return false;
    return Boolean(String(state?.preparedPlanningByOt?.[ot] || "").trim());
  }

  function markPlanningPrepared(state, ot, signature) {
    return {
      ...(state || {}),
      preparedPlanningByOt: { ...(state?.preparedPlanningByOt || {}), [ot]: String(signature || "") },
    };
  }

  function commitPreparedOtSelection(state, ot, signature) {
    const selectedOts = [...(state?.selectedOts || [])];
    if (!selectedOts.some((item) => normalize(item) === normalize(ot))) selectedOts.push(String(ot));
    return markPlanningPrepared({ ...(state || {}), selectedOts }, String(ot), signature);
  }

  function planningPreparationSignature(input) {
    const value = input || {};
    return JSON.stringify({
      ot: normalize(value.ot),
      machine: normalize(value.machine),
      tool: normalize(value.tool),
      kit: normalize(value.kit),
      additionalTools: additionalToolList(value.additionalTools || value.additionalHerramentales).map((item) => {
        const entry = additionalToolEntry(item);
        return { herramental: normalize(entry.herramental), machine: normalize(entry.machine) };
      }),
      kitPending: value.kitPending === true,
      subcontractType: normalize(value.subcontractType),
      subcontractDays: Number(value.subcontractDays || 0),
      commercialType: normalize(value.commercialType),
      planningType: normalize(value.planningType),
      operationVersion: String(value.operationVersion || ""),
    });
  }

  function withoutEngineInternals(source) {
    return Object.fromEntries(Object.entries(source || {}).filter(([key]) => !String(key || "").startsWith("__")));
  }

  function buildDraftSnapshot(state, generatedAt) {
    const configurations = state?.otConfigurations || {};
    const configurationForOt = (ot) => {
      const key = Object.keys(configurations).find((item) => normalize(item) === normalize(ot));
      return key ? configurations[key] || {} : {};
    };
    return {
      ...withoutEngineInternals(state || {}),
      snapshotId: "draft",
      status: "BORRADOR",
      generatedAt: String(generatedAt || ""),
      planStart: state?.planStart || "",
      weekStart: mondayIso(state?.weekStart || state?.planStart || ""),
      selectedOts: [...(state?.selectedOts || [])],
      operations: draftExportOperations(state).map((operation) => {
        const next = { ...operation };
        if (["5459", "5527"].includes(String(next.ct || "").trim())) {
          const configuration = configurationForOt(next.ot);
          if (!String(next.maquina || "").trim()) next.maquina = String(configuration.machine || configuration.maquina || "").trim();
          if (!String(next.herramental || "").trim()) next.herramental = String(configuration.herramental || configuration.tool || "").trim();
          next.additionalHerramentales = additionalToolList(next.additionalHerramentales || configuration.additionalHerramentales || configuration.herramentalesExtra);
          if (!String(next.kitHerramental || "").trim() && next.kitPending !== true) next.kitHerramental = String(configuration.kitHerramental || configuration.kit || "").trim();
        }
        return next;
      }),
    };
  }

  function reconcilePublishedPlan(snapshot, currentState) {
    const published = snapshot?.fullState || snapshot || {};
    const current = currentState || {};
    const publishedOts = new Set((published.selectedOts || published.operations?.map((item) => item?.ot) || [])
      .map(normalize).filter(Boolean));
    const workOrders = new Map((current.workOrders || []).map((item) => [normalize(item?.ot), item]));
    const isOpen = (workOrder) => workOrder && workOrder.exists !== false &&
      !["CERRADA", "CERRADO", "CLOSED", "CANCELADA", "CANCELADO"].includes(normalize(workOrder.status || workOrder.estatus));
    const restored = new Set([...publishedOts].filter((ot) => isOpen(workOrders.get(ot))));
    const operationKey = (operation) => [normalize(operation?.ot), normalize(operation?.secuencia), normalize(operation?.ct)].join("|");
    const isGeneratedToolChange = (operation) => normalize(operation?.tipoInsercion) === "CAMBIO_HERRAMENTAL" &&
      Boolean(operation?.generatedBy || normalize(operation?.ct) === "TOOL_CHANGE");
    const publishedOperations = (published.operations || []).filter((operation) => restored.has(normalize(operation?.ot)) && !isGeneratedToolChange(operation));
    const publishedByKey = new Map(publishedOperations.map((operation) => [operationKey(operation), operation]));
    const currentRestored = (current.operations || []).filter((operation) => restored.has(normalize(operation?.ot)) && !isGeneratedToolChange(operation));
    let completedOperations = 0;
    let newOperations = 0;
    const reconciled = currentRestored.map((operation) => {
      const historical = publishedByKey.get(operationKey(operation));
      if (!historical) {
        newOperations += 1;
        return {
          ...operation, planStatus: "PENDIENTE", completedAt: undefined,
          fechaInicio: "", horaInicio: "", fechaFin: "", horaFin: "", locked: false,
        };
      }
      if (normalize(operation?.planStatus) === "COMPLETADA_PLAN") {
        completedOperations += 1;
        return { ...operation };
      }
      const next = { ...operation, ...historical, id: operation.id, ot: operation.ot, secuencia: operation.secuencia, ct: operation.ct };
      ["maquina", "machine", "herramental", "kitHerramental", "subcontractType", "subcontractDays"].forEach((field) => {
        if (operation[field] !== undefined && operation[field] !== null && operation[field] !== "") next[field] = operation[field];
      });
      next.planStatus = "PENDIENTE";
      delete next.completedAt;
      return next;
    });
    const untouched = (current.operations || []).filter((operation) => !restored.has(normalize(operation?.ot)));
    const publishedConfigurations = published.otConfigurations || {};
    const currentConfigurations = current.otConfigurations || {};
    const otConfigurations = { ...currentConfigurations };
    let preservedConfigurations = 0;
    restored.forEach((ot) => {
      const publishedKey = Object.keys(publishedConfigurations).find((key) => normalize(key) === ot);
      const currentKey = Object.keys(currentConfigurations).find((key) => normalize(key) === ot);
      const previous = publishedKey ? publishedConfigurations[publishedKey] || {} : {};
      const active = currentKey ? currentConfigurations[currentKey] || {} : {};
      if (Object.values(active).some((value) => value !== undefined && value !== null && value !== "")) preservedConfigurations += 1;
      const merged = { ...previous };
      Object.keys(active).forEach((field) => {
        if (active[field] !== undefined && active[field] !== null && active[field] !== "") merged[field] = active[field];
      });
      otConfigurations[currentKey || publishedKey || ot] = merged;
    });
    const currentKeys = new Set(currentRestored.map(operationKey));
    return {
      state: { ...current, selectedOts: [...restored], operations: [...reconciled, ...untouched], otConfigurations },
      summary: {
        restoredOts: restored.size,
        closedOts: publishedOts.size - restored.size,
        completedOperations,
        removedOperations: publishedOperations.filter((operation) => !currentKeys.has(operationKey(operation))).length,
        newOperations,
        preservedConfigurations,
      },
    };
  }

  function applyDraftToolSelection(operations, ot, tool, bendingCts, additionalTools = []) {
    const targetOt = normalize(ot);
    const allowed = new Set((bendingCts || []).map((ct) => normalize(ct)));
    const extras = additionalToolList(additionalTools);
    return (operations || []).map((operation) =>
      normalize(operation?.ot) === targetOt && allowed.has(normalize(operation?.ct))
        && operation?.generatedAdditionalTool !== true
        ? { ...operation, herramental: String(tool || "").trim(), additionalHerramentales: extras }
        : { ...operation });
  }

  function effectiveJobTool(state, job, bendingCts) {
    const cts = new Set((bendingCts || ["5459", "5527"]).map((value) => String(value || "").trim()));
    const operations = (job?.ops || []).filter((operation) => cts.has(String(operation?.ct || "").trim()));
    if (!operations.length) return "";
    const configurations = state?.otConfigurations || {};
    const configurationKey = Object.keys(configurations).find((key) => normalize(configurations[key]?.ot || key) === normalize(job?.ot));
    const configured = configurationKey ? configurations[configurationKey] || {} : {};
    const configuredTool = String(configured.herramental || configured.tool || "").trim();
    const configuredTools = [configuredTool, ...additionalToolList(configured.additionalHerramentales || configured.herramentalesExtra).map((item) => additionalToolEntry(item).herramental)].filter(Boolean);
    if (configuredTools.length) return configuredTools.join(" + ");
    const operationTool = operations.map((operation) => String(operation?.herramental || "").trim()).find(Boolean);
    const operationExtras = additionalToolList(operations.find((operation) => Array.isArray(operation?.additionalHerramentales) && operation.additionalHerramentales.length)?.additionalHerramentales).map((item) => additionalToolEntry(item).herramental);
    if (operationTool || operationExtras.length) return [operationTool, ...operationExtras].filter(Boolean).join(" + ");
    const article = normalize(job?.parte);
    const catalog = (state?.toolCatalog || []).find((item) => item?.active !== false && normalize(item?.part || item?.parte) === article);
    return String(catalog?.herramental || "").trim();
  }

  function isCoherentDraft(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.operations) || !Array.isArray(snapshot.workOrders) || !Array.isArray(snapshot.selectedOts)) return false;
    const operationOts = new Set(snapshot.operations.map((item) => normalize(item?.ot)).filter(Boolean));
    const workOrderOts = new Set(snapshot.workOrders.map((item) => normalize(item?.ot)).filter(Boolean));
    return snapshot.selectedOts.every((ot) => operationOts.has(normalize(ot)) && workOrderOts.has(normalize(ot)));
  }

  function selectNewestCoherentDraft(localDraft, remoteDraft) {
    const candidates = [localDraft, remoteDraft].filter(isCoherentDraft);
    return candidates.sort((left, right) => Number(right?.revision || 0) - Number(left?.revision || 0) ||
      String(right?.savedAt || "").localeCompare(String(left?.savedAt || "")))[0] || null;
  }

  function selectAuthoritativeRemoteDraft(localDraft, remoteDraft) {
    return isCoherentDraft(remoteDraft) ? remoteDraft : (isCoherentDraft(localDraft) ? localDraft : null);
  }

  function defaultDailyPlanSource(snapshots, draft) {
    const published = (snapshots || []).filter((item) => normalize(item?.status || item?.planStatus) === "PUBLICADO")
      .sort((left, right) => String(right?.publishedAt || right?.generatedAt || "").localeCompare(String(left?.publishedAt || left?.generatedAt || "")));
    return published.length
      ? { type: "published", snapshotId: String(published[0].snapshotId || published[0].id || "") }
      : { type: "draft", snapshotId: "draft" };
  }

  function netSuiteSyncOutcome(workOrdersResult, planningResult) {
    if (!workOrdersResult?.ok) return {
      status: "failed",
      message: `No se pudieron sincronizar las OTs: ${workOrdersResult?.error || "error desconocido"}`,
    };
    if (!planningResult?.ok) return {
      status: "partial",
      message: "OTs actualizadas; operaciones pendientes de sincronizar",
    };
    return { status: "complete", message: "OTs y operaciones actualizadas" };
  }

  function reportCategories(operation) {
    const type = normalize(operation?.tipoInsercion);
    const operator = normalize(operation?.operador);
    const categories = [];
    if (type === "SUBCONTRATO" || operator === "SUBCONTRATO") categories.push("subcontract");
    if (type === "CAMBIO_HERRAMENTAL" || operator === "AJUSTADOR") categories.push("adjuster");
    if (operator && operator !== "SUBCONTRATO" && operator !== "AJUSTADOR" && type !== "CAMBIO_HERRAMENTAL" && type !== "SUBCONTRATO") {
      categories.push("operator");
    }
    return categories;
  }

  function classifyReportOperation(operation) {
    const categories = reportCategories(operation);
    return categories.length === 1 ? categories[0] : null;
  }

  function reportCoverageIssues(operations) {
    return (operations || []).flatMap((operation) => {
      const categories = reportCategories(operation);
      if (categories.length === 1) return [];
      return [{
        id: operation?.id,
        ot: operation?.ot,
        secuencia: operation?.secuencia,
        descripcion: operation?.descripcion || operation?.tipoInsercion || "",
        categories,
        diagnostic: categories.length ? `Categoria ambigua: ${categories.join(", ")}` : "Operacion sin categoria de reporte",
      }];
    });
  }

  function reportCoverageDiagnostics(operations) {
    return reportCoverageIssues((operations || []).filter((operation) => {
      const completed = normalize(operation?.planStatus) === "COMPLETADA_PLAN";
      return !completed && Boolean(operation?.fechaInicio && operation?.fechaFin);
    })).map((issue) => ({
      ...issue,
      text: `OT ${issue.ot || "sin OT"} · Secuencia ${issue.secuencia ?? "sin secuencia"} · ${issue.descripcion || "sin descripcion"} · Categorias: ${issue.categories.length ? issue.categories.join(", ") : "ninguna"} · ${issue.diagnostic}`,
    }));
  }

  function isoDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10);
  }

  function reportDateRange(startDate, futureDays) {
    const start = isoDate(startDate);
    const days = Math.max(1, Math.min(5, Number(futureDays) || 1));
    const endDate = new Date(`${start}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + days);
    return { start, end: endDate.toISOString().slice(0, 10), futureDays: days };
  }

  function selectReportRows(rows, options = {}) {
    const range = reportDateRange(options.startDate, options.futureDays);
    const statusRows = filterOperationsByPlanStatus(rows, options.status || "PENDIENTES");
    const selected = statusRows.filter((row) => {
      const date = isoDate(row?.fechaInicio || row?.startDate || row?.date);
      return Boolean(date) && date <= range.end;
    }).sort((left, right) => {
      const a = `${left?.fechaInicio || left?.startDate || left?.date || ""}T${left?.horaInicio || left?.startTime || "00:00"}`;
      const b = `${right?.fechaInicio || right?.startDate || right?.date || ""}T${right?.horaInicio || right?.startTime || "00:00"}`;
      return a.localeCompare(b) || String(left?.id || "").localeCompare(String(right?.id || ""));
    });
    const limit = Math.max(1, Number(options.limit) || 25);
    return { rows: selected.slice(0, limit), total: selected.length, range };
  }

  function isUnsupportedDraftSnapshotError(error) {
    return /metodo no permitido:\s*saveDraftSnapshot/i.test(String(error?.message || error || ""));
  }

  function weeklyPlanningTypeClass(value) {
    const type = normalize(value);
    if (type === "PROTOTIPO") return "weekly-row--prototype";
    if (type === "EXPEDITADO") return "weekly-row--expedited";
    return "";
  }

  function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function hasFinishingValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function finiteResult(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function uniqueFinishingRows(rows) {
    const seen = new Set();
    return (rows || []).filter((row, index) => {
      const normalizedOt = normalize(row?.ot);
      const key = normalizedOt || `__ROW_${index}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function effectiveFinishingAmount(row) {
    const pendingPieces = finiteNonNegative(row?.pendingPieces);
    if (hasFinishingValue(row?.amount)) return finiteNonNegative(row.amount);
    return hasFinishingValue(row?.unitPrice) ? finiteResult(finiteNonNegative(row.unitPrice) * pendingPieces) : 0;
  }

  function weeklyFinishingCost(rows) {
    let finishingPieces = 0;
    let totalCost = 0;
    uniqueFinishingRows(rows).forEach((row) => {
      const pendingPieces = finiteNonNegative(row?.pendingPieces);
      finishingPieces = finiteResult(finishingPieces + pendingPieces);
      totalCost = finiteResult(totalCost + effectiveFinishingAmount(row));
    });
    const costPerPiece = finishingPieces ? finiteResult(totalCost / finishingPieces) : 0;
    return { finishingPieces, totalCost, costPerPiece };
  }

  function weeklyFinishingRowsByType(rows) {
    const grouped = new Map();
    for (const row of uniqueFinishingRows(rows)) {
      const type = normalize(row?.jobType) || "SIN TIPO";
      const current = grouped.get(type) || [];
      current.push(row);
      grouped.set(type, current);
    }
    return [...grouped.entries()]
      .map(([type, typeRows]) => {
        const cost = weeklyFinishingCost(typeRows);
        return { type, pieces: cost.finishingPieces, amount: cost.totalCost, costPerPiece: cost.costPerPiece };
      })
      .sort((a, b) => b.amount - a.amount || a.type.localeCompare(b.type, "es"));
  }

  function mondayIso(value) {
    const iso = isoDate(String(value || "").slice(0, 10));
    if (!iso) return "";
    const date = new Date(`${iso}T00:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    return date.toISOString().slice(0, 10);
  }

  function selectIncrementalBase(snapshots, weekStart, draft) {
    const week = mondayIso(weekStart);
    const published = (snapshots || []).filter((snapshot) => {
      const status = normalize(snapshot?.status || snapshot?.planStatus);
      return mondayIso(snapshot?.weekStart || snapshot?.planStart) === week &&
        (Boolean(snapshot?.publishedAt) || status === "PUBLICADO");
    }).sort((a, b) => String(b?.publishedAt || b?.generatedAt || "").localeCompare(String(a?.publishedAt || a?.generatedAt || "")));
    return published[0] || draft || null;
  }

  function incrementalOtSignature(source, ot) {
    source = source?.fullState || source || {};
    const key = normalize(ot);
    const workOrder = (source?.workOrders || []).find((item) => normalize(item?.id || item?.ot || item?.tranid) === key) || {};
    const configKey = Object.keys(source?.otConfigurations || {}).find((item) => normalize(item) === key);
    const config = configKey ? source.otConfigurations[configKey] || {} : {};
    const operationStates = (source.operations || []).filter((operation) => normalize(operation?.ot) === key)
      .map((operation) => `${Number(operation?.secuencia || 0)}:${normalize(operation?.ct)}:${normalize(operation?.planStatus || operation?.operationState)}`)
      .sort();
    return JSON.stringify({
      quantity: workOrder.pendingQuantity ?? workOrder.quantity ?? workOrder.cantidad ?? "",
      priority: config.priority ?? workOrder.priority ?? "",
      dueDate: config.dueDate ?? workOrder.dueDate ?? workOrder.fechaEntrega ?? "",
      machine: config.machine ?? config.maquina ?? "",
      tool: config.tool ?? config.herramental ?? "",
      kit: config.kit ?? config.kitHerramental ?? "",
      subcontractType: config.subcontractType ?? "",
      subcontractDays: config.subcontractDays ?? "",
      operationStates,
    });
  }

  function incrementalScope({ base = {}, current = {}, weekStart = "" } = {}) {
    base = base?.fullState || base || {};
    current = current?.fullState || current || {};
    const baseOts = new Map((base.selectedOts || []).map((ot) => [normalize(ot), String(ot)]).filter(([key]) => key));
    const currentOts = new Map((current.selectedOts || []).map((ot) => [normalize(ot), String(ot)]).filter(([key]) => key));
    const addedOts = [...currentOts].filter(([key]) => !baseOts.has(key)).map(([, ot]) => ot);
    const removedOts = [...baseOts].filter(([key]) => !currentOts.has(key)).map(([, ot]) => ot);
    const changedOts = [...currentOts].filter(([key, ot]) => baseOts.has(key) &&
      incrementalOtSignature(base, baseOts.get(key)) !== incrementalOtSignature(current, ot)).map(([, ot]) => ot);
    const sorter = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
    const affectedOts = [...new Set([...removedOts, ...changedOts, ...addedOts])].sort(sorter);
    return {
      weekStart: mondayIso(weekStart),
      addedOts: addedOts.sort(sorter),
      changedOts: changedOts.sort(sorter),
      removedOts: removedOts.sort(sorter),
      affectedOts,
    };
  }

  function nextWeeklyVersion(snapshots, weekStart) {
    const week = mondayIso(weekStart);
    return (snapshots || []).filter((snapshot) => mondayIso(snapshot?.weekStart || snapshot?.planStart) === week)
      .reduce((max, snapshot) => Math.max(max, Number(snapshot?.version) || 0), 0) + 1;
  }

  function versionOtData(source, ot) {
    source = source?.fullState || source || {};
    const key = normalize(ot);
    const workOrder = (source.workOrders || []).find((item) => normalize(item?.ot || item?.id || item?.tranid) === key) || {};
    const configKey = Object.keys(source.otConfigurations || {}).find((item) => normalize(item) === key);
    const config = configKey ? source.otConfigurations[configKey] || {} : {};
    return {
      cantidad: workOrder.pendingQuantity ?? workOrder.quantity ?? workOrder.cantidad ?? "",
      prioridad: config.priority ?? workOrder.priority ?? "",
      entrega: config.dueDate ?? workOrder.dueDate ?? workOrder.fechaEntrega ?? "",
      maquina: config.machine ?? config.maquina ?? "",
      herramental: config.tool ?? config.herramental ?? "",
      kit: config.kit ?? config.kitHerramental ?? "",
      subcontrato: config.subcontractType ?? config.tipoSubcontrato ?? "",
      diasSubcontrato: config.subcontractDays ?? config.diasSubcontrato ?? "",
    };
  }

  function compactVersionDiff(previous, next) {
    previous = previous?.fullState || previous || {};
    next = next?.fullState || next || {};
    const previousOts = new Map((previous.selectedOts || []).map((ot) => [normalize(ot), String(ot)]).filter(([key]) => key));
    const nextOts = new Map((next.selectedOts || []).map((ot) => [normalize(ot), String(ot)]).filter(([key]) => key));
    const sorter = (a, b) => String(a).localeCompare(String(b), "es", { numeric: true });
    const addedOts = [...nextOts].filter(([key]) => !previousOts.has(key)).map(([, ot]) => ot).sort(sorter);
    const removedOts = [...previousOts].filter(([key]) => !nextOts.has(key)).map(([, ot]) => ot).sort(sorter);
    const changedOts = [...nextOts].filter(([key]) => previousOts.has(key)).map(([key, ot]) => {
      const before = versionOtData(previous, previousOts.get(key));
      const after = versionOtData(next, ot);
      const fields = Object.keys(after).filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""));
      return fields.length ? { ot, fields } : null;
    }).filter(Boolean).sort((a, b) => sorter(a.ot, b.ot));
    return { addedOts, removedOts, changedOts };
  }

  function loadOperationsForMode(snapshot, statusOverlay, mode) {
    const source = snapshot?.fullState || snapshot || {};
    const operations = (source.operations || []).map((operation) => ({ ...operation }));
    if (mode === "original") return operations;
    const operationKey = (operation) => [operation?.ot, operation?.secuencia, operation?.ct].map(normalize).join("|");
    const overlay = new Map((Array.isArray(statusOverlay) ? statusOverlay : [])
      .map((operation) => [operationKey(operation), operation]));
    const isCompleted = (operation) => normalize(overlay.get(operationKey(operation))?.planStatus || operation?.planStatus) === "COMPLETADA_PLAN";
    return operations.filter((operation) => mode === "completed" ? isCompleted(operation) : !isCompleted(operation));
  }

  return { withTimeout, hasPlanningData, planningOtSyncedAt, planningOtsWithData, planningDataAvailability, markPlanningOtSynced,
    prepareDraftForReschedule, filterOperationsByPlanStatus,
    normalizeGanttView, isActiveGanttView, isMachineGanttOperation, isOtEligibleForDraft, canRemoveSelectedOt, ganttOperationTiming,
    isOtLockedInState, otHasCompletedOperations, pendingOperationsForOt, operationsRouteSignature,
    classifySmartSyncChange, finalizeSmartSyncSummary, smartSyncSummaryMessage,
    mergeOtRouteOperation, mergeOtRouteOperations,
    compareWorkOrderLite, applyConfirmedWorkOrderChanges, schedulingSelectedOts, removeOtFromDraft,
    setDraftOperationCompletion, isPendingDraftOperation, operationalPlanOptions, draftExportOperations,
    draftScheduledOperations, pruneDraftToOpenWorkOrders, reconcileActiveWorkOrders, purgeClosedWorkOrderRetention,
    needsPlanningPreparation, canReusePlanningPreparation, markPlanningPrepared, commitPreparedOtSelection, planningPreparationSignature,
    buildDraftSnapshot, reconcilePublishedPlan, applyDraftToolSelection, effectiveJobTool,
    isCoherentDraft, selectNewestCoherentDraft, selectAuthoritativeRemoteDraft, defaultDailyPlanSource,
    netSuiteSyncOutcome,
    classifyReportOperation, reportCoverageIssues, reportCoverageDiagnostics, reportDateRange, selectReportRows,
    isUnsupportedDraftSnapshotError, weeklyPlanningTypeClass, effectiveFinishingAmount,
    weeklyFinishingCost, weeklyFinishingRowsByType,
    mondayIso, selectIncrementalBase, incrementalScope, nextWeeklyVersion, compactVersionDiff, loadOperationsForMode };
});
