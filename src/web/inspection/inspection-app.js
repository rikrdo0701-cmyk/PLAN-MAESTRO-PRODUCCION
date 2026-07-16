(function inspectionAppFactory(root) {
  "use strict";
  const state = { list: [], detail: null, selection: {} };
  const byId = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const call = (method, ...args) => root.PPAppsScriptBridge?.call(method, args) || Promise.reject(new Error("Backend no disponible"));
  function renderJobStatus(value, detail = "") { byId("inspectionJobStatus").innerHTML = `<strong class="inspection-card-title">Estado del trabajo</strong><span class="inspection-status-pill">${escape(value)}</span>${detail ? `<div>${escape(detail)}</div>` : ""}`; }

  function optionLabel(item) { return `WO ${item.wo} - ${item.article} - ${item.quantity} pzas`; }
  function renderList() {
    const query = String(byId("inspectionSearch")?.value || "").trim().toUpperCase();
    const items = state.list.filter((item) => !query || optionLabel(item).toUpperCase().includes(query));
    byId("inspectionWorkOrder").innerHTML = `<option value="">${items.length ? "Selecciona WO" : "Sin WO con ese filtro"}</option>` + items.map((item) => `<option value="${escape(item.wo)}">${escape(optionLabel(item))}</option>`).join("");
  }
  async function loadList() {
    renderJobStatus("Cargando WOs abiertas...");
    const result = await call("getInspectionWorkOrders");
    if (!result?.ok) throw new Error(result?.error || "No se pudieron cargar las WOs");
    state.list = result.data || [];
    renderList();
    renderJobStatus(`${state.list.length} WOs abiertas`);
  }
  function cell(span, html = "", classes = "") { return `<div class="inspection-cell ${classes}" style="grid-column:span ${span}">${html}</div>`; }
  function operationHeader() {
    return cell(1, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") + cell(1, "", "inspection-br") + cell(2, "SETUP", "inspection-gray") + cell(2, "INACTIVIDAD", "inspection-gray") + cell(2, "PRODUCCION", "inspection-gray inspection-br") + cell(2, "", "inspection-br") + cell(1, "", "inspection-br") + cell(2, "", "inspection-br") + cell(2, "", "inspection-br") + cell(1, "", "inspection-br") + cell(2, "PRODUCCION", "inspection-gray inspection-br") + cell(2, "");
  }
  function operationSubheader(label) {
    return cell(1, label, "inspection-head inspection-br") + cell(2, "No. Operador", "inspection-head inspection-br") + cell(2, "Fecha", "inspection-head inspection-br") + cell(1, "No.<br>Máquina", "inspection-head inspection-head-tight inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(2, "Cant.<br>Piezas", "inspection-head inspection-br") + cell(1, "Captura", "inspection-head inspection-br") + cell(2, "No. Operador", "inspection-head inspection-br") + cell(2, "Fecha", "inspection-head inspection-br") + cell(1, "No.<br>Máquina", "inspection-head inspection-head-tight inspection-br") + cell(1, "Inicio", "inspection-gray") + cell(1, "Fin", "inspection-gray inspection-br") + cell(2, "Cant.", "inspection-head");
  }
  function operationRow(operation) {
    return cell(1, escape(operation?.code || ""), "inspection-op-line inspection-op inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line inspection-br") + cell(1, "", "inspection-op-line") + cell(1, "", "inspection-op-line inspection-br") + cell(2, "", "inspection-op-line");
  }
  function inspectionOperationLayout(count) {
    const blankRows = Array.from({ length: Math.max(0, Number(count) || 0) }, () => operationRow({})).join("");
    return operationHeader() + operationSubheader("OP") + blankRows;
  }
  function printDiagnostic(detail) { return root.InspectionCore.inspectionPrintDiagnostic(detail?.materials || [], Boolean(currentDrawing())); }
  function renderPrintChecks(detail) {
    const diagnostic = printDiagnostic(detail);
    const deficitText = diagnostic.deficit.slice(0, 3).map((material) => `${material.material || "-"} ${Number(material.deficitNeto || material.netDeficit || material.deficit || 0)}`).join(", ");
    const checks = [
      ["Tramos", diagnostic.missingRoutes.length ? "block" : "ok", diagnostic.missingRoutes.length ? `Faltan: ${diagnostic.missingRoutes.map((material) => material.material).join(", ")}` : "OK"],
      ["Dibujo", diagnostic.withoutDrawing ? "warn" : "ok", diagnostic.withoutDrawing ? "Sin enlace" : "OK"],
      ["Material", diagnostic.deficit.length ? "warn" : "ok", diagnostic.deficit.length ? `Déficit: ${deficitText}` : "OK"],
      ["Pendientes", diagnostic.pending.length ? "ok" : "warn", diagnostic.pending.length ? `${diagnostic.pending.length} materiales` : "Sin materiales pendientes"]
    ];
    byId("inspectionPrintCheck").innerHTML = `<header class="inspection-check-head"><strong>Semáforo de impresión</strong><span class="inspection-check-pill ${diagnostic.status}">${diagnostic.label}</span></header><div class="inspection-check-list">${checks.map(([label, status, value]) => `<div class="inspection-check-row ${status}"><strong>${label}</strong><span>${escape(value)}</span></div>`).join("")}</div>`;
  }
  function renderHistory(history, job) {
    const entries = history?.ok ? (history.data?.history || history.data || []) : [];
    const latest = entries[0] || {};
    const printedAt = latest.FECHA_HORA || latest.fechaHora || latest.printedAt || "-";
    const folio = latest.FOLIO || latest.folio || latest.OT || latest.wo || job?.wo || "-";
    const count = history?.data?.count ?? entries.length;
    byId("inspectionHistory").innerHTML = `<div><strong>Total:</strong> ${count}</div><div><strong>Última impresión:</strong> ${escape(printedAt)}</div><div><strong>Folio/fecha:</strong> ${escape(folio)} · ${escape(printedAt)}</div>`;
  }
  function drawingCandidate() { return state.detail?.workOrder?.drawing || state.detail?.materials?.find((material) => material.drawing)?.drawing || ""; }
  function normalizeDrawingUrl(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const hyperlink = text.match(/HYPERLINK\(\s*["']([^"']+)["']/i);
    const raw = String(hyperlink ? hyperlink[1] : text).trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(www\.|drive\.google\.com|docs\.google\.com)/i.test(raw)) return `https://${raw}`;
    if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return `https://drive.google.com/file/d/${encodeURIComponent(raw)}/view`;
    return "";
  }
  function currentDrawing() { return normalizeDrawingUrl(drawingCandidate()); }
  function openDrawing() {
    const raw = drawingCandidate();
    const drawing = normalizeDrawingUrl(raw);
    if (!drawing) { root.alert(`No hay una liga de dibujo válida. Revisa la liga capturada: ${raw || "vacía"}`); return; }
    const opened = root.open(drawing, "_blank", "noopener,noreferrer");
    if (opened) return;
    const link = document.createElement("a");
    link.href = drawing;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  function materialRow(first, second, deliveryLabel = "", deliveryDate = "") {
    return cell(3, deliveryLabel, "inspection-label inspection-br") + cell(4, deliveryDate, "inspection-br") + cell(3, escape(first?.material || ""), "inspection-br") + cell(3, escape(first?.description || "")) + cell(2, escape(first?.route || ""), "inspection-br") + cell(2, first?.required ?? "", "inspection-br") + cell(2, escape(second?.material || "")) + cell(2, escape(second?.description || "")) + cell(2, escape(second?.route || ""), "inspection-br") + cell(1, second?.required ?? "");
  }
  function renderDetail() {
    const detail = state.detail;
    if (!detail) return;
    const job = detail.workOrder || {};
    const materials = root.InspectionCore.inspectionMaterials(detail.materials || []);
    const rows = root.InspectionCore.inspectionRows(detail.operations || [], state.selection);
    const materialRows = [];
    for (let index = 0; index < materials.length; index += 2) materialRows.push(materialRow(materials[index], materials[index + 1], index === 0 ? "Fechas de entrega:" : "", index === 0 ? escape(job.dueDate || "") : ""));
    if (!materialRows.length) materialRows.push(materialRow({}, {}, "Fechas de entrega:", escape(job.dueDate || "")));
    if (materials.length <= 2) materialRows.push(materialRow({}, {}));
    byId("inspectionSheetGrid").innerHTML = `<div class="inspection-doc-code">MP FO 08 V23</div>${cell(24, '<strong class="inspection-logo">MALDONADO</strong><span class="inspection-title-text">HOJA DE INSPECCIÓN Y ESTADÍSTICAS DE TUBERÍA DOBLADA</span>', "inspection-title")}${cell(4, "", "inspection-br inspection-bb")}${cell(2, "Trabajo:", "inspection-label inspection-bb")}${cell(3, escape(job.wo), "inspection-big inspection-bb")}${cell(7, escape(job.article), "inspection-big inspection-br inspection-bb")}${cell(2, "REV", "inspection-big inspection-bb")}${cell(1, escape(job.revision || "A"), "inspection-big inspection-br inspection-bb")}${cell(2, "Cantidad:", "inspection-label inspection-bb")}${cell(3, `${escape(job.quantity)} Piezas`, "inspection-big inspection-bb")}${cell(7, "ORDEN DE VENTA", "inspection-label inspection-br inspection-bb")}${cell(3, "Material", "inspection-head inspection-br inspection-bb")}${cell(3, "Descripción", "inspection-head inspection-bb")}${cell(2, "Tramo tubo", "inspection-head inspection-br inspection-bb")}${cell(2, "Tubo/pzas", "inspection-head inspection-br inspection-bb")}${cell(2, "Material", "inspection-head inspection-bb")}${cell(2, "Descripción", "inspection-head inspection-bb")}${cell(2, "Tramo tubo", "inspection-head inspection-br inspection-bb")}${cell(1, "Tubo/pzas", "inspection-head inspection-bb")}${materialRows.join("")}<div class="inspection-section-title"></div>${operationHeader()}${operationSubheader("OP")}${rows.map((row) => operationRow(row.operation)).join("")}`;
    byId("inspectionSecondCapture").innerHTML = `<div class="inspection-grid"><div class="inspection-section-title"></div>${inspectionOperationLayout(3).replace(operationSubheader("OP"), operationSubheader("OPER."))}</div>`;
    const footerCell = (span, html, classes = "", rowSpan = 1) => `<div class="inspection-footer-cell ${classes}" style="grid-column:span ${span}${rowSpan > 1 ? `;grid-row:span ${rowSpan}` : ""}">${html}</div>`;
    let footer = footerCell(1, "Oper", "inspection-footer-head") + footerCell(1, "N°<br>OPER", "inspection-footer-head") + footerCell(2, "Cantidad NC", "inspection-footer-head") + footerCell(1, "Clave", "inspection-footer-head inspection-br") + footerCell(4, "FTY", "inspection-footer-head inspection-br") + footerCell(6, "SELLO LIBERACIÓN", "inspection-footer-head inspection-br") + footerCell(5, "OBSERVACIONES:", "inspection-footer-head inspection-br") + footerCell(2, "ENTREGA", "inspection-footer-head inspection-br") + footerCell(1, "CANT.", "inspection-footer-head inspection-br") + footerCell(1, "RECIBE", "inspection-footer-head");
    for (let row = 0; row < 3; row += 1) {
      footer += footerCell(1, "") + footerCell(1, "") + footerCell(2, "") + footerCell(1, "", "inspection-br") + footerCell(4, "", "inspection-br");
      if (row === 0) footer += footerCell(6, "", "inspection-seal-box inspection-br", 3);
      footer += footerCell(5, "", "inspection-br") + footerCell(2, "", "inspection-br") + footerCell(1, "", "inspection-br") + footerCell(1, "");
    }
    byId("inspectionReleaseFooter").innerHTML = footer;
    byId("inspectionSheetGrid").querySelectorAll("[data-inspection-material]").forEach((button) => button.addEventListener("click", () => editMaterialLink(Number(button.dataset.inspectionMaterial))));
    byId("inspectionOperationChoices").innerHTML = (detail.operations || []).map((operation, index) => { const key = root.InspectionCore.operationKey(operation, index); return `<label><input type="checkbox" data-inspection-operation="${escape(key)}" ${state.selection[key] !== false ? "checked" : ""}> ${escape(operation.code)} - ${escape(operation.operation)}</label>`; }).join("");
    byId("inspectionOperationChoices").querySelectorAll("[data-inspection-operation]").forEach((input) => input.addEventListener("change", () => { state.selection[input.dataset.inspectionOperation] = input.checked; renderDetail(); }));
    const semaphore = printDiagnostic(detail).status;
    byId("inspectionPrintCheck").className = `inspection-side-card inspection-status inspection-print-check--${semaphore}`;
    renderPrintChecks(detail);
    renderJobStatus(job.status || "En curso", `${detail.operations.length} operaciones · ${materials.length} materiales`);
    byId("inspectionDrawing").disabled = !currentDrawing();
    byId("inspectionEditLink").disabled = !materials.length;
  }
  async function editMaterialLink(index) {
    const job = state.detail?.workOrder;
    const material = state.detail?.materials?.[index];
    if (!job || !material) return;
    const route = root.prompt("Tramo", material.route || "");
    if (route === null) return;
    const drawingInput = root.prompt("URL o ID del dibujo", material.drawing || "");
    if (drawingInput === null) return;
    const drawing = String(drawingInput).trim() ? normalizeDrawingUrl(drawingInput) : "";
    if (String(drawingInput).trim() && !drawing) { root.alert("La liga del dibujo debe ser una URL válida o un ID de Google Drive."); return; }
    const result = await call("saveInspectionLink", { article: job.article, material: material.material, route, drawing });
    if (!result?.ok) throw new Error(result?.error || "No se pudo guardar el vínculo");
    material.route = route; material.drawing = drawing; renderDetail();
  }
  function firstInspectionMaterialIndex() {
    const materials = state.detail?.materials || [];
    const first = root.InspectionCore.inspectionMaterials(materials)[0];
    return materials.indexOf(first);
  }
  async function loadDetail() {
    const wo = byId("inspectionWorkOrder").value;
    if (!wo) return;
    renderJobStatus(`Cargando WO ${wo}...`);
    const result = await call("getInspectionWorkOrder", wo);
    if (!result?.ok) throw new Error(result?.error || "No se pudo cargar la WO");
    state.detail = result.data;
    state.selection = root.InspectionCore.initialOperationSelection(state.detail.operations || []);
    renderDetail();
    const routes = await call("getInspectionDrawingRoutes", state.detail.workOrder?.article).catch(() => null);
    if (routes?.ok) {
      const routeByMaterial = new Map((routes.data || []).map((route) => [String(route.MATERIAL || route.material || "").toUpperCase(), route]));
      (state.detail.materials || []).forEach((material) => {
        const route = routeByMaterial.get(String(material.material || "").toUpperCase());
        if (route) { material.route = route.TRAMO || route.route || material.route; material.drawing = route.DIBUJO || route.drawing || material.drawing; }
      });
      renderDetail();
    }
    const history = await call("getInspectionHistory", wo).catch(() => null);
    renderHistory(history, state.detail.workOrder);
  }
  async function printInspection() {
    if (!state.detail) return;
    const diagnostic = printDiagnostic(state.detail);
    renderPrintChecks(state.detail);
    if (diagnostic.missingRoutes.length) {
      root.alert(`Falta tramo para materiales fraccionados antes de imprimir: ${diagnostic.missingRoutes.map((material) => material.material).join(", ")}`);
      const index = (state.detail.materials || []).indexOf(diagnostic.missingRoutes[0]);
      await editMaterialLink(index < 0 ? 0 : index);
      return;
    }
    if (diagnostic.alerts.length && !root.confirm(`Antes de imprimir revisa: ${diagnostic.alerts.join(", ")}. ¿Quieres continuar y registrar la impresión?`)) return;
    const operations = root.InspectionCore.printableOperations(state.detail.operations || [], state.selection);
    try {
      const result = await call("recordInspectionPrint", {
        wo: state.detail.workOrder.wo,
        article: state.detail.workOrder.article,
        quantity: state.detail.workOrder.quantity,
        status: state.detail.workOrder.status || "",
        semaphore: diagnostic.label,
        alerts: diagnostic.alerts,
        withoutDrawing: diagnostic.withoutDrawing,
        missingRoutes: diagnostic.missingRoutes.length > 0,
        pendingMaterials: diagnostic.pending.map((material) => ({ material: material.material || "", quantity: material.required ?? "" })),
        deficitMaterials: diagnostic.deficit.map((material) => ({ material: material.material || "", deficit: Number(material.deficitNeto || material.netDeficit || material.deficit || 0) })),
        operations: operations.map((operation) => operation.code),
        detail: { materials: diagnostic.materials.map((material) => ({ material: material.material || "", pending: material.required ?? "", issued: material.issued ?? "", available: material.available || 0, deficitNeto: material.deficitNeto || material.netDeficit || 0 })) }
      });
      if (!result?.ok && !root.confirm(`No se pudo guardar el historial: ${result?.error || "Error desconocido"}. ¿Imprimir de todos modos?`)) return;
    } catch (error) {
      if (!root.confirm(`No se pudo guardar el historial: ${error.message}. ¿Imprimir de todos modos?`)) return;
    }
    document.body.classList.add("printing-inspection");
    const sheet = byId("inspectionDocument");
    sheet.style.setProperty("--inspection-print-scale", "1");
    await new Promise((resolve) => root.setTimeout(resolve, 0));
    const printableWidthMm = 297 - 9 - 8;
    const printableHeightMm = 210 - 3 - 5;
    const widthRatio = (printableWidthMm * 96 / 25.4) / sheet.scrollWidth;
    const heightRatio = (printableHeightMm * 96 / 25.4) / sheet.scrollHeight;
    sheet.style.setProperty("--inspection-print-scale", String(Math.min(1, widthRatio, heightRatio)));
    try { await new Promise((resolve) => root.setTimeout(resolve, 50)); root.print(); }
    finally { sheet.style.removeProperty("--inspection-print-scale"); document.body.classList.remove("printing-inspection"); }
  }
  function clearInspectionPrintState() {
    byId("inspectionDocument")?.style.removeProperty("--inspection-print-scale");
    document.body.classList.remove("printing-inspection");
  }
  function reportError(error) { renderJobStatus("Error", error.message); }
  function initialize() {
    if (!byId("inspectionWorkOrder")) return;
    byId("inspectionSearch").addEventListener("input", renderList);
    byId("inspectionReload").addEventListener("click", () => loadDetail().catch(reportError));
    byId("inspectionWorkOrder").addEventListener("change", () => loadDetail().catch(reportError));
    byId("inspectionSelectOps").addEventListener("click", () => { byId("inspectionOperationChoices").hidden = !byId("inspectionOperationChoices").hidden; });
    byId("inspectionDrawing").addEventListener("click", openDrawing);
    byId("inspectionEditLink").addEventListener("click", () => editMaterialLink(firstInspectionMaterialIndex()).catch(reportError));
    byId("inspectionPrint").addEventListener("click", () => printInspection().catch(reportError));
    const ensureLoaded = () => { if (root.location.hash === "#hoja-inspeccion" && !state.list.length) loadList().catch(reportError); };
    root.addEventListener("hashchange", ensureLoaded);
    root.addEventListener("afterprint", clearInspectionPrintState);
    ensureLoaded();
  }
  root.InspectionApp = { initialize, loadList, loadDetail };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})(window);
