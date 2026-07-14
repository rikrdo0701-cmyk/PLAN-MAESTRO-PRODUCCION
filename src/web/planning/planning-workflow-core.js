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
        const preserved = !selected.has(normalize(operation?.ot)) || operation?.locked === true ||
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

  function removeOtFromDraft(state, ot) {
    const key = normalize(ot);
    const without = (items) => (items || []).filter((item) => normalize(item) !== key);
    const preparedPlanningByOt = { ...(state?.preparedPlanningByOt || {}) };
    delete preparedPlanningByOt[ot];
    return {
      ...(state || {}),
      selectedOts: without(state?.selectedOts),
      lockedOts: without(state?.lockedOts),
      expandedOts: without(state?.expandedOts),
      preparedPlanningByOt,
      operations: (state?.operations || []).map((operation) => normalize(operation?.ot) === key
        ? { ...operation, locked: false }
        : operation),
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
    const selected = new Set((state?.selectedOts || []).map(normalize));
    return (state?.operations || []).filter((operation) => selected.has(normalize(operation?.ot)) &&
      isPendingDraftOperation(operation) && !isHistorical(operation) &&
      Boolean(operation?.fechaInicio && operation?.fechaFin));
  }

  function draftScheduledOperations(state) {
    const selected = new Set((state?.selectedOts || []).map(normalize).filter(Boolean));
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

  function needsPlanningPreparation(state, ot, signature) {
    if (!isOtEligibleForDraft(state, ot)) return false;
    return String(state?.preparedPlanningByOt?.[ot] || "") !== String(signature || "");
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
      kitPending: value.kitPending === true,
      subcontractType: normalize(value.subcontractType),
      subcontractDays: Number(value.subcontractDays || 0),
      commercialType: normalize(value.commercialType),
      planningType: normalize(value.planningType),
      operationVersion: String(value.operationVersion || ""),
    });
  }

  function buildDraftSnapshot(state, generatedAt) {
    return {
      ...(state || {}),
      snapshotId: "draft",
      status: "BORRADOR",
      generatedAt: String(generatedAt || ""),
      planStart: state?.planStart || "",
      selectedOts: [...(state?.selectedOts || [])],
      operations: draftExportOperations(state).map((operation) => ({ ...operation })),
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

  function applyDraftToolSelection(operations, ot, tool, bendingCts) {
    const targetOt = normalize(ot);
    const allowed = new Set((bendingCts || []).map((ct) => normalize(ct)));
    return (operations || []).map((operation) =>
      normalize(operation?.ot) === targetOt && allowed.has(normalize(operation?.ct))
        ? { ...operation, herramental: String(tool || "").trim() }
        : { ...operation });
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
      return date >= range.start && date <= range.end;
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

  function weeklyFinishingCost(rows) {
    const seen = new Set();
    let finishingPieces = 0;
    let totalCost = 0;
    (rows || []).forEach((row, index) => {
      const normalizedOt = normalize(row?.ot);
      const key = normalizedOt || `__ROW_${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      const pendingPieces = Math.max(0, Number(row?.pendingPieces) || 0);
      const amountPresent = row?.amount !== null && row?.amount !== undefined && String(row.amount).trim() !== "";
      const unitPricePresent = row?.unitPrice !== null && row?.unitPrice !== undefined && String(row.unitPrice).trim() !== "";
      const rowCost = amountPresent
        ? Math.max(0, Number(row.amount) || 0)
        : unitPricePresent ? Math.max(0, Number(row.unitPrice) || 0) * pendingPieces : 0;
      finishingPieces += pendingPieces;
      totalCost += rowCost;
    });
    return { finishingPieces, totalCost, costPerPiece: finishingPieces ? totalCost / finishingPieces : 0 };
  }

  return { withTimeout, hasPlanningData, prepareDraftForReschedule, filterOperationsByPlanStatus,
    normalizeGanttView, isActiveGanttView, isMachineGanttOperation, isOtEligibleForDraft, canRemoveSelectedOt, ganttOperationTiming,
    compareWorkOrderLite, applyConfirmedWorkOrderChanges, removeOtFromDraft,
    setDraftOperationCompletion, isPendingDraftOperation, operationalPlanOptions, draftExportOperations,
    draftScheduledOperations, pruneDraftToOpenWorkOrders,
    needsPlanningPreparation, markPlanningPrepared, commitPreparedOtSelection, planningPreparationSignature,
    buildDraftSnapshot, reconcilePublishedPlan, applyDraftToolSelection,
    isCoherentDraft, selectNewestCoherentDraft, selectAuthoritativeRemoteDraft, defaultDailyPlanSource,
    netSuiteSyncOutcome,
    classifyReportOperation, reportCoverageIssues, reportCoverageDiagnostics, reportDateRange, selectReportRows,
    isUnsupportedDraftSnapshotError, weeklyPlanningTypeClass, weeklyFinishingCost };
});
