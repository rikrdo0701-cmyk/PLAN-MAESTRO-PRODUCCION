(function inspectionCoreFactory(root) {
  "use strict";
  function operationKey(operation, index) {
    return String(operation?.id || operation?.code || index);
  }
  function initialOperationSelection(operations) {
    return (operations || []).reduce((selection, operation, index) => {
      selection[operationKey(operation, index)] = true;
      return selection;
    }, {});
  }
  function printableOperations(operations, selection) {
    return (operations || []).filter((operation, index) => selection?.[operationKey(operation, index)] !== false);
  }
  function inspectionRows(operations, selection, minimumRows) {
    const visible = printableOperations(operations, selection).map((operation) => ({ operation }));
    while (visible.length < minimumRows) visible.push({ operation: null });
    return visible;
  }
  function inspectionMaterials(materials) {
    return (materials || []).filter((material) => {
      const name = String(material?.material || "");
      return name && !name.toLowerCase().startsWith("costo 0") && Number(material?.requiredOriginal || material?.required || 0) > 0;
    });
  }
  function inspectionPrintDiagnostic(materials, hasDrawing) {
    const normalized = inspectionMaterials(materials);
    const pending = normalized.filter((material) => Number(material?.required) > 0);
    const missingRoutes = normalized.filter((material) => {
      const required = Number(material?.required);
      return Number.isFinite(required) && required > 0 && Math.abs(required - Math.round(required)) > 0.00001 && !String(material?.route || "").trim();
    });
    const deficit = normalized.filter((material) => Number(material?.deficitNeto || material?.netDeficit || material?.deficit || 0) > 0);
    const alerts = [];
    if (missingRoutes.length) alerts.push("Falta tramo");
    if (!hasDrawing) alerts.push("Sin dibujo");
    if (deficit.length) alerts.push("Déficit material");
    if (!pending.length) alerts.push("Sin materiales pendientes");
    const status = missingRoutes.length ? "block" : (alerts.length ? "warn" : "ok");
    return { status, label: status === "block" ? "Bloqueado" : (status === "warn" ? "Revisar" : "OK para imprimir"), alerts, materials: normalized, pending, missingRoutes, withoutDrawing: !hasDrawing, deficit };
  }
  function inspectionRouteValue(row, field) {
    const aliases = {
      article: ["article", "ARTICULO"],
      material: ["material", "MATERIAL"],
      route: ["route", "TRAMO"],
      drawing: ["drawing", "DIBUJO"],
      updated: ["updated", "ACTUALIZADO"]
    };
    const value = aliases[field].map((name) => row?.[name]).find((item) => item !== undefined && item !== null);
    return String(value || "").trim();
  }
  function inspectionRouteRows(rows) {
    return (rows || []).map((row) => ({
      article: inspectionRouteValue(row, "article"),
      material: inspectionRouteValue(row, "material"),
      route: inspectionRouteValue(row, "route"),
      drawing: inspectionRouteValue(row, "drawing"),
      updated: inspectionRouteValue(row, "updated")
    })).filter((row) => row.article && row.material).sort((left, right) => left.article.localeCompare(right.article, "es", { sensitivity: "base" }) || left.material.localeCompare(right.material, "es", { sensitivity: "base" }));
  }
  function filterInspectionRouteRows(rows, query) {
    const term = String(query || "").trim().toLocaleLowerCase("es");
    if (!term) return rows;
    return (rows || []).filter((row) => `${row.article} ${row.material}`.toLocaleLowerCase("es").includes(term));
  }
  function inspectionRouteSavePayload(row, route) {
    return {
      article: inspectionRouteValue(row, "article"),
      material: inspectionRouteValue(row, "material"),
      route: String(route || "").trim(),
      drawing: inspectionRouteValue(row, "drawing")
    };
  }
  root.InspectionCore = { operationKey, initialOperationSelection, printableOperations, inspectionRows, inspectionMaterials, inspectionPrintDiagnostic, inspectionRouteRows, filterInspectionRouteRows, inspectionRouteSavePayload };
})(typeof window !== "undefined" ? window : globalThis);
