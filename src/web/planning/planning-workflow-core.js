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
          operador: "", maquina: "", herramental: "", kitHerramental: "",
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

  function isOtEligibleForDraft(state, ot) {
    const key = normalize(ot);
    return (state?.selectedOts || []).some((item) => normalize(item) === key);
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

  return { withTimeout, hasPlanningData, prepareDraftForReschedule, filterOperationsByPlanStatus,
    normalizeGanttView, isActiveGanttView, isOtEligibleForDraft, removeOtFromDraft,
    setDraftOperationCompletion, isPendingDraftOperation, operationalPlanOptions, draftExportOperations,
    draftScheduledOperations, pruneDraftToOpenWorkOrders,
    needsPlanningPreparation, markPlanningPrepared, commitPreparedOtSelection, planningPreparationSignature,
    buildDraftSnapshot, applyDraftToolSelection,
    isCoherentDraft, selectNewestCoherentDraft, selectAuthoritativeRemoteDraft, defaultDailyPlanSource,
    netSuiteSyncOutcome,
    classifyReportOperation, reportCoverageIssues, reportCoverageDiagnostics, reportDateRange, selectReportRows };
});
