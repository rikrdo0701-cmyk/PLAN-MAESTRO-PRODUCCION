(function initPlanningWorkflowCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlanningWorkflowCore = api;
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

  return { withTimeout, hasPlanningData, prepareDraftForReschedule, filterOperationsByPlanStatus, classifyReportOperation, reportCoverageIssues };
});
