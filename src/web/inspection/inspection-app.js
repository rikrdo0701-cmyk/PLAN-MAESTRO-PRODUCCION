(function inspectionAppFactory(root) {
  "use strict";
  const state = { list: [], detail: null, selection: {} };
  const byId = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const call = (method, ...args) => root.PPAppsScriptBridge?.call(method, args) || Promise.reject(new Error("Backend no disponible"));

  function optionLabel(item) { return `OT ${item.wo} - ${item.article} - ${item.quantity} pzas`; }
  function renderList() {
    const query = String(byId("inspectionSearch")?.value || "").trim().toUpperCase();
    const items = state.list.filter((item) => !query || optionLabel(item).toUpperCase().includes(query));
    byId("inspectionWorkOrder").innerHTML = items.map((item) => `<option value="${escape(item.wo)}">${escape(optionLabel(item))}</option>`).join("");
  }
  async function loadList() {
    byId("inspectionStatus").textContent = "Cargando OTs abiertas...";
    const result = await call("getInspectionWorkOrders");
    if (!result?.ok) throw new Error(result?.error || "No se pudieron cargar las OTs");
    state.list = result.data || [];
    renderList();
    byId("inspectionStatus").textContent = `${state.list.length} OTs abiertas`;
  }
  function renderDetail() {
    const detail = state.detail;
    if (!detail) return;
    const job = detail.workOrder || {};
    byId("inspectionJobHeader").innerHTML = `<span>Trabajo: ${escape(job.wo)}</span><span>${escape(job.article)}</span><span>REV ${escape(job.revision)}</span><span>Cantidad</span><span>${escape(job.quantity)} piezas</span>`;
    const materials = detail.materials || [];
    byId("inspectionMaterials").innerHTML = `<table><thead><tr><th>Material</th><th>Descripción</th><th>Requerido</th><th>Emitido</th><th>Disponible</th><th>Tramo / dibujo</th></tr></thead><tbody>${materials.map((material, index) => `<tr><td>${escape(material.material)}</td><td>${escape(material.description)}</td><td>${escape(material.required)}</td><td>${escape(material.issued)}</td><td class="${Number(material.available) < Number(material.required) ? "inspection-shortage" : ""}">${escape(material.available)}</td><td>${escape(material.route)} ${material.drawing ? `<a href="${escape(material.drawing)}" target="_blank" rel="noopener">Ver dibujo</a>` : ""}<button class="inspection-edit-link" type="button" data-inspection-material="${index}">Editar</button></td></tr>`).join("")}</tbody></table>`;
    byId("inspectionMaterials").querySelectorAll("[data-inspection-material]").forEach((button) => button.addEventListener("click", () => editMaterialLink(Number(button.dataset.inspectionMaterial))));
    const printable = root.InspectionCore.printableOperations(detail.operations || [], state.selection);
    const minimumRows = Math.max(0, 16 - printable.length);
    byId("inspectionOperations").innerHTML = printable.map((operation) => `<tr><td>${escape(operation.code)}</td><td></td><td></td><td>${escape(operation.workCenter)}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("") + Array.from({ length: minimumRows }, () => "<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>").join("");
    byId("inspectionOperationChoices").innerHTML = (detail.operations || []).map((operation) => `<label><input type="checkbox" data-inspection-operation="${escape(operation.id)}" ${state.selection[operation.id] !== false ? "checked" : ""}> ${escape(operation.code)} - ${escape(operation.operation)}</label>`).join("");
    byId("inspectionOperationChoices").querySelectorAll("[data-inspection-operation]").forEach((input) => input.addEventListener("change", () => { state.selection[input.dataset.inspectionOperation] = input.checked; renderDetail(); }));
    byId("inspectionStatus").textContent = `${job.status || "En curso"} · ${detail.operations.length} operaciones · ${materials.length} materiales`;
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
    byId("inspectionStatus").textContent = `Cargando OT ${wo}...`;
    const result = await call("getInspectionWorkOrder", wo);
    if (!result?.ok) throw new Error(result?.error || "No se pudo cargar la OT");
    state.detail = result.data;
    state.selection = root.InspectionCore.initialOperationSelection(state.detail.operations || []);
    renderDetail();
    const history = await call("getInspectionHistory", wo);
    byId("inspectionHistory").textContent = history?.ok ? `${(history.data || []).length} impresiones registradas` : "Historial no disponible";
  }
  async function printInspection() {
    if (!state.detail) return;
    const operations = root.InspectionCore.printableOperations(state.detail.operations || [], state.selection);
    await call("recordInspectionPrint", { wo: state.detail.workOrder.wo, article: state.detail.workOrder.article, quantity: state.detail.workOrder.quantity, operations: operations.map((operation) => operation.code) });
    document.body.classList.add("printing-inspection");
    try { await new Promise((resolve) => root.setTimeout(resolve, 50)); root.print(); }
    finally { document.body.classList.remove("printing-inspection"); }
  }
  function initialize() {
    if (!byId("inspectionWorkOrder")) return;
    byId("inspectionSearch").addEventListener("input", renderList);
    byId("inspectionReload").addEventListener("click", () => loadDetail().catch((error) => byId("inspectionStatus").textContent = error.message));
    byId("inspectionWorkOrder").addEventListener("change", () => loadDetail().catch((error) => byId("inspectionStatus").textContent = error.message));
    byId("inspectionSelectOps").addEventListener("click", () => { byId("inspectionOperationChoices").hidden = !byId("inspectionOperationChoices").hidden; });
    byId("inspectionPrint").addEventListener("click", () => printInspection().catch((error) => byId("inspectionStatus").textContent = error.message));
    const ensureLoaded = () => {
      if (root.location.hash === "#hoja-inspeccion" && !state.list.length) loadList().catch((error) => byId("inspectionStatus").textContent = error.message);
    };
    root.addEventListener("hashchange", ensureLoaded);
    ensureLoaded();
  }
  root.InspectionApp = { initialize, loadList, loadDetail };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})(window);
