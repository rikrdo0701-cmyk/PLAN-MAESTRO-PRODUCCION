(function inspectionAppFactory(root) {
  "use strict";
  const state = { list: [], detail: null, selection: {} };
  const byId = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const call = (method, ...args) => root.PPAppsScriptBridge?.call(method, args) || Promise.reject(new Error("Backend no disponible"));

  function optionLabel(item) { return `WO ${item.wo} - ${item.article} - ${item.quantity} pzas`; }
  function renderList() {
    const query = String(byId("inspectionSearch")?.value || "").trim().toUpperCase();
    const items = state.list.filter((item) => !query || optionLabel(item).toUpperCase().includes(query));
    byId("inspectionWorkOrder").innerHTML = `<option value="">${items.length ? "Selecciona WO" : "Sin WO con ese filtro"}</option>` + items.map((item) => `<option value="${escape(item.wo)}">${escape(optionLabel(item))}</option>`).join("");
  }
  async function loadList() {
    byId("inspectionJobStatus").textContent = "Cargando WOs abiertas...";
    const result = await call("getInspectionWorkOrders");
    if (!result?.ok) throw new Error(result?.error || "No se pudieron cargar las WOs");
    state.list = result.data || [];
    renderList();
    byId("inspectionJobStatus").textContent = `${state.list.length} WOs abiertas`;
  }
  function cell(span, html = "", classes = "") { return `<div class="inspection-cell ${classes}" style="grid-column:span ${span}">${html}</div>`; }
  function operationHeader(label) {
    return cell(1, label, "inspection-head inspection-br") + cell(2, "No. Operador", "inspection-head inspection-br") + cell(2, "Fecha", "inspection-head inspection-br") + cell(1, "No.<br>Máquina", "inspection-head inspection-head-tight inspection-br") + cell(2, "SETUP", "inspection-gray") + cell(2, "INACTIVIDAD", "inspection-gray") + cell(2, "PRODUCCIÓN", "inspection-gray inspection-br") + cell(2, "Cant.<br>Piezas", "inspection-head inspection-br") + cell(1, "Captura", "inspection-head inspection-br") + cell(2, "No. Operador", "inspection-head inspection-br") + cell(2, "Fecha", "inspection-head inspection-br") + cell(1, "No.<br>Máquina", "inspection-head inspection-br") + cell(2, "PRODUCCIÓN", "inspection-gray inspection-br") + cell(2, "Cant.", "inspection-head");
  }
  function operationSubheader() {
    return cell(1, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") + cell(1, "", "inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(2, "", "inspection-br") + cell(1, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") + cell(1, "", "inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(2);
  }
  function operationRow(operation) {
    return cell(1, escape(operation?.code || ""), "inspection-op-line inspection-op inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(1, escape(operation?.workCenter || ""), "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line");
  }
  function printSemaphore(detail) {
    const materials = detail?.materials || [];
    if (!detail?.operations?.length || materials.some((material) => Number(material.available) < Number(material.required))) return "block";
    if (!materials.length || materials.some((material) => !material.drawing)) return "warn";
    return "ok";
  }
  function currentDrawing() { return state.detail?.materials?.find((material) => material.drawing)?.drawing || ""; }
  function renderDetail() {
    const detail = state.detail;
    if (!detail) return;
    const job = detail.workOrder || {};
    const materials = detail.materials || [];
    const rows = root.InspectionCore.inspectionRows(detail.operations || [], state.selection, 16);
    const material = materials[0] || {};
    byId("inspectionSheetGrid").innerHTML = `<div class="inspection-doc-code">MP FO 08 V23</div>${cell(24, '<strong class="inspection-logo">MALDONADO</strong><span class="inspection-title-text">HOJA DE INSPECCIÓN Y ESTADÍSTICAS DE TUBERÍA DOBLADA</span>', "inspection-title")}${cell(4, "", "inspection-br inspection-bb")}${cell(2, "Trabajo:", "inspection-label inspection-bb")}${cell(3, escape(job.wo), "inspection-big inspection-bb")}${cell(7, escape(job.article), "inspection-big inspection-br inspection-bb")}${cell(2, "REV", "inspection-big inspection-bb")}${cell(1, escape(job.revision || "A"), "inspection-big inspection-br inspection-bb")}${cell(2, "Cantidad:", "inspection-label inspection-bb")}${cell(3, `${escape(job.quantity)} Piezas`, "inspection-big inspection-bb")}${cell(7, "ORDEN DE VENTA", "inspection-label inspection-br inspection-bb")}${cell(3, "Material", "inspection-head inspection-br inspection-bb")}${cell(5, "Descripción", "inspection-head inspection-bb")}${cell(2, "Tramo tubo", "inspection-head inspection-br inspection-bb")}${cell(3, "Material", "inspection-head inspection-bb")}${cell(4, "Descripción", "inspection-head inspection-bb")}${cell(7, "", "inspection-br")}${cell(3, escape(material.material), "inspection-br")}${cell(5, escape(material.description))}${cell(2, escape(material.route || "-"), "inspection-br")}${cell(3, materials[1] ? escape(materials[1].material) : "")}${cell(4, materials[1] ? escape(materials[1].description) : "")}<div class="inspection-section-title"></div>${operationHeader("OP")}${operationSubheader()}${rows.map((row) => operationRow(row.operation)).join("")}`;
    byId("inspectionSecondCapture").innerHTML = `<div class="inspection-grid"><div class="inspection-section-title"></div>${operationHeader("OPER.")}${operationSubheader()}${Array.from({ length: 3 }, () => operationRow({})).join("")}</div>`;
    const footerCell = (span, html, classes = "") => `<div class="inspection-footer-cell ${classes}" style="grid-column:span ${span}">${html}</div>`;
    byId("inspectionReleaseFooter").innerHTML = footerCell(5, "OPER / N° OPER / CANTIDAD NC / CLAVE", "inspection-footer-head inspection-br") + footerCell(4, "FTY", "inspection-footer-head inspection-br") + footerCell(6, "SELLO LIBERACIÓN", "inspection-footer-head inspection-br") + footerCell(5, "OBSERVACIONES", "inspection-footer-head inspection-br") + footerCell(4, "ENTREGA / CANT. / RECIBE", "inspection-footer-head") + footerCell(5, "", "inspection-br") + footerCell(4, "", "inspection-br") + footerCell(6, "", "inspection-br") + footerCell(5, "", "inspection-br") + footerCell(4, "");
    byId("inspectionSheetGrid").querySelectorAll("[data-inspection-material]").forEach((button) => button.addEventListener("click", () => editMaterialLink(Number(button.dataset.inspectionMaterial))));
    byId("inspectionOperationChoices").innerHTML = (detail.operations || []).map((operation, index) => { const key = root.InspectionCore.operationKey(operation, index); return `<label><input type="checkbox" data-inspection-operation="${escape(key)}" ${state.selection[key] !== false ? "checked" : ""}> ${escape(operation.code)} - ${escape(operation.operation)}</label>`; }).join("");
    byId("inspectionOperationChoices").querySelectorAll("[data-inspection-operation]").forEach((input) => input.addEventListener("change", () => { state.selection[input.dataset.inspectionOperation] = input.checked; renderDetail(); }));
    const semaphore = printSemaphore(detail);
    byId("inspectionPrintCheck").className = `inspection-side-card inspection-status inspection-print-check--${semaphore}`;
    byId("inspectionPrintCheck").innerHTML = `<strong>Semáforo de impresión: ${semaphore}</strong><br>${semaphore === "ok" ? "Documento listo" : semaphore === "warn" ? "Revisa dibujos ligados" : "Material insuficiente u operaciones faltantes"}`;
    byId("inspectionJobStatus").textContent = `${job.status || "En curso"} · ${detail.operations.length} operaciones · ${materials.length} materiales`;
    byId("inspectionDrawing").disabled = !currentDrawing();
    byId("inspectionEditLink").disabled = !materials.length;
  }
  async function editMaterialLink(index) {
    const job = state.detail?.workOrder;
    const material = state.detail?.materials?.[index];
    if (!job || !material) return;
    const route = root.prompt("Tramo", material.route || "");
    if (route === null) return;
    const drawing = root.prompt("URL del dibujo", material.drawing || "");
    if (drawing === null) return;
    const result = await call("saveInspectionLink", { article: job.article, material: material.material, route, drawing });
    if (!result?.ok) throw new Error(result?.error || "No se pudo guardar el vínculo");
    material.route = route; material.drawing = drawing; renderDetail();
  }
  async function loadDetail() {
    const wo = byId("inspectionWorkOrder").value;
    if (!wo) return;
    byId("inspectionJobStatus").textContent = `Cargando WO ${wo}...`;
    const result = await call("getInspectionWorkOrder", wo);
    if (!result?.ok) throw new Error(result?.error || "No se pudo cargar la WO");
    state.detail = result.data;
    const routes = await call("getInspectionDrawingRoutes", state.detail.workOrder?.article);
    if (routes?.ok) {
      const routeByMaterial = new Map((routes.data || []).map((route) => [String(route.MATERIAL || route.material || "").toUpperCase(), route]));
      (state.detail.materials || []).forEach((material) => {
        const route = routeByMaterial.get(String(material.material || "").toUpperCase());
        if (route) { material.route = route.TRAMO || route.route || material.route; material.drawing = route.DIBUJO || route.drawing || material.drawing; }
      });
    }
    state.selection = root.InspectionCore.initialOperationSelection(state.detail.operations || []);
    renderDetail();
    const history = await call("getInspectionHistory", wo);
    byId("inspectionHistory").textContent = history?.ok ? `${(history.data || []).length} impresiones registradas` : "Historial no disponible";
  }
  async function printInspection() {
    if (!state.detail) return;
    const operations = root.InspectionCore.printableOperations(state.detail.operations || [], state.selection);
    await call("recordInspectionPrint", { wo: state.detail.workOrder.wo, article: state.detail.workOrder.article, quantity: state.detail.workOrder.quantity, semaphore: printSemaphore(state.detail), operations: operations.map((operation) => operation.code) });
    document.body.classList.add("printing-inspection");
    const sheet = byId("inspectionDocument");
    sheet.style.setProperty("--inspection-print-scale", "1");
    await new Promise((resolve) => root.setTimeout(resolve, 0));
    const widthRatio = ((279 - 17) * 96 / 25.4) / sheet.scrollWidth;
    const heightRatio = ((216 - 8) * 96 / 25.4) / sheet.scrollHeight;
    sheet.style.setProperty("--inspection-print-scale", String(Math.min(1, widthRatio, heightRatio)));
    try { await new Promise((resolve) => root.setTimeout(resolve, 50)); root.print(); }
    finally { document.body.classList.remove("printing-inspection"); }
  }
  function reportError(error) { byId("inspectionJobStatus").textContent = error.message; }
  function initialize() {
    if (!byId("inspectionWorkOrder")) return;
    byId("inspectionSearch").addEventListener("input", renderList);
    byId("inspectionReload").addEventListener("click", () => loadDetail().catch(reportError));
    byId("inspectionWorkOrder").addEventListener("change", () => loadDetail().catch(reportError));
    byId("inspectionSelectOps").addEventListener("click", () => { byId("inspectionOperationChoices").hidden = !byId("inspectionOperationChoices").hidden; });
    byId("inspectionDrawing").addEventListener("click", () => { const drawing = currentDrawing(); if (drawing) root.open(drawing, "_blank", "noopener"); });
    byId("inspectionEditLink").addEventListener("click", () => editMaterialLink(0).catch(reportError));
    byId("inspectionPrint").addEventListener("click", () => printInspection().catch(reportError));
    const ensureLoaded = () => { if (root.location.hash === "#hoja-inspeccion" && !state.list.length) loadList().catch(reportError); };
    root.addEventListener("hashchange", ensureLoaded);
    root.addEventListener("afterprint", () => byId("inspectionDocument")?.style.removeProperty("--inspection-print-scale"));
    ensureLoaded();
  }
  root.InspectionApp = { initialize, loadList, loadDetail };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})(window);
