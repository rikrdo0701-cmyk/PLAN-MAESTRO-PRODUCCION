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
  function operationCells(operation) {
    const values = [operation?.code || "", "", "", operation?.workCenter || "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""];
    return `<tr>${values.map((value) => `<td>${escape(value) || "&nbsp;"}</td>`).join("")}</tr>`;
  }
  function operationTable(rows, label) {
    const headings = [label, "No. Operador", "Fecha", "No. Máquina", "Setup inicio", "Setup fin", "Inactividad inicio", "Inactividad fin", "Producción inicio", "Producción fin", "Cant. piezas", "Captura", "No. Operador", "Fecha", "No. Máquina", "Inicio", "Fin", "Cant."];
    return `<table class="inspection-operations-table"><thead><tr>${headings.map((heading) => `<th>${heading}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => operationCells(row.operation)).join("")}</tbody></table>`;
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
    const split = Math.max(1, Math.ceil(rows.length / 2));
    const materialRows = materials.length ? materials.map((material, index) => `<tr><td>${escape(material.material)}</td><td>${escape(material.description)}</td><td>${escape(material.required)}</td><td>${escape(material.issued)}</td><td class="${Number(material.available) < Number(material.required) ? "inspection-shortage" : ""}">${escape(material.available)}</td><td>${escape(material.route) || "-"}</td><td>${material.drawing ? `<a href="${escape(material.drawing)}" target="_blank" rel="noopener">Dibujo</a>` : "-"}</td><td><button class="inspection-edit-link" type="button" data-inspection-material="${index}">Editar</button></td></tr>`).join("") : `<tr><td colspan="8">Sin materiales</td></tr>`;
    byId("inspectionSheetGrid").innerHTML = `<header><strong class="inspection-logo">MALDONADO</strong><h2>HOJA DE INSPECCIÓN Y ESTADÍSTICAS DE TUBERÍA DOBLADA</h2><small>MP FO 08 V23</small></header><div class="inspection-job-header"><span>Trabajo: ${escape(job.wo)}</span><span>${escape(job.article)}</span><span>REV ${escape(job.revision)}</span><span>Cantidad</span><span>${escape(job.quantity)} piezas</span></div><div class="inspection-materials"><table><thead><tr><th>Material</th><th>Descripción</th><th>Requerido</th><th>Emitido</th><th>Disponible</th><th>Tramo tubo</th><th>Dibujo</th><th>Liga</th></tr></thead><tbody>${materialRows}</tbody></table></div>${operationTable(rows.slice(0, split), "OP")}`;
    byId("inspectionSheetGrid").querySelector("header").style.cssText = "display:grid;grid-template-columns:220px 1fr 100px;align-items:center;padding:8px 12px;border-bottom:2px solid #111";
    byId("inspectionSecondCapture").innerHTML = operationTable(rows.slice(split), "OPER.");
    byId("inspectionReleaseFooter").innerHTML = "<span>FTY</span><span>SELLO LIBERACIÓN</span><span>OBSERVACIONES</span><span>ENTREGA / CANT. / RECIBE</span>";
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
    ensureLoaded();
  }
  root.InspectionApp = { initialize, loadList, loadDetail };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})(window);
