(function inspectionAppFactory(root) {
  "use strict";
  const state = { list: [], detail: null, selection: {} };
  const INSPECTION_CACHE_TTL_MS = 5 * 60 * 1000;
  const DRAWING_SOURCE_HINT = "maldonado://";
  const INSPECTION_PREFETCH_COUNT = 8;
  const INSPECTION_MAX_ACTIVE_BUNDLE_REQUESTS = 3;
  const bundleCache = new Map();
  const normalBundleRequests = new Map();
  const bundleRequestVersions = new Map();
  const manualBundleQueue = [];
  const prefetchBundleQueue = [];
  let activeBundleRequests = 0;
  let loadListVersion = 0;
  let selectionToken = 0;
  const byId = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  // MEDIDO 2026-10-01: antes aqui habia una flecha que llamaba al cliente del puente de
  // Apps Script (`root.PPAppsScript…`, el `src/web/shared/apps-script-bridge-client.js`) y
  // era la UNICA salida de esta pagina al backend: si no respondia, rechazaba con un
  // unico mensaje, "Backend no disponible", que no decia si faltaba la red, la sesion o
  // un build viejo. Se borro en vez de dejarla sin usar porque un puente muerto que sigue
  // en el archivo es una puerta que la proxima persona vuelve a abrir. Las tres llamadas
  // que la usaban ya salen por `llamar` (abajo), que es el unico camino que queda y que
  // pone el nombre del metodo en el error.

  /**
   * MEDIDO 2026-10-01: TODO lo que esta pagina pide al backend sale por aqui.
   *
   * POR QUE NO SE USA `call`. `call` es el puente de Apps Script, y el puente esta
   * deshabilitado (RULE-SUP-030): devuelve una promesa rechazada con "Backend no
   * disponible". La pagina se quedaba sin lista de OTs, sin detalle y sin historial, sin
   * un error que dijera por que. Estas cuatro llamadas (`getInspectionWorkOrders`,
   * `getInspectionWorkOrderBundle`, `getInspectionHistory` y `recordInspectionPrint`) ya
   * estan en `PPSupabaseBridgeReplacement`, que es la unica fuente de datos.
   *
   * POR QUE `llamar` Y NO LLAMAR DIRECTO AL REEMPLAZO. Un fallo tiene que decir QUE
   * falta. Si el build no trae el reemplazo, la excepcion que sube dice que falta el
   * modulo y que la tabla donde deberia estar el dato; si el build lo trae pero le falta
   * una funcion, lo dice el nombre de la funcion. Un "Backend no disponible" obligaba a
   * abrir el codigo para saber si era la red, la sesion o un build viejo.
   *
   * QUE DEVUELVE. La excepcion, no un `{ok:false}`: las tres lecturas de este archivo
   * ya manejan su propio error (`loadList` y `loadDetail` lo suben a `reportError`, que
   * lo pinta en la tarjeta de estado) y `printInspection` tiene su propio `catch` con el
   * confirm de "¿Imprimir de todos modos?". El `{ok:false}` lo reservamos para cuando el
   * backend responde y la respuesta dice que no, que es otra cosa.
   */
  const llamar = (metodo, ...args) => {
    const reemplazo = root.PPSupabaseBridgeReplacement;
    if (!reemplazo) {
      return Promise.reject(new Error(
        `No se puede pedir ${metodo}: este build no trae PPSupabaseBridgeReplacement, que es de donde salen `
        + "los datos de la hoja de inspeccion. El puente de Apps Script ya no los da."
      ));
    }
    const fn = reemplazo[metodo];
    if (typeof fn !== "function") {
      return Promise.reject(new Error(
        `No se puede pedir ${metodo}: PPSupabaseBridgeReplacement no lo tiene en este build.`
      ));
    }
    return Promise.resolve(fn.apply(reemplazo, args));
  };

  /**
   * MEDIDO 2026-10-01: guarda UN tramo de inspeccion en Supabase (`inspection_routes`).
   *
   * POR QUE ESTA EN SU PROPIA FUNCION Y NO SE USA `call` DIRECTO. El camino viejo
   * era `call("saveInspectionLink", ...)`, que salia por el puente de Apps Script a
   * la hoja `Tramos`. Con la migracion el unico escritor es la pagina (con su
   * sesion), y meter el nombre de la tabla y el chequeo de disponibilidad aqui
   * deja el por que escrito en un solo lugar, en vez de repetirlo en cada llamada.
   *
   * QUE DEVUELVE, Y POR QUE NO ES LA EXCEPCION. `{ ok, data }` / `{ ok:false, error }`,
   * igual que el resto del reemplazo del puente: quien llama (submitLinkEdits) ya
   * sabe leer las dos formas y las muestra en el dialogo. Tirar la excepcion
   * obligaria a try/catch en cada punto de llamada.
   *
   * LO QUE PASA SI NO HAY REEMPLAZO DEL PUENTE. Se lanza con un mensaje que dice
   * QUE FALTA, no "Backend no disponible": el fallo real no es que Apps Script no
   * responda, es que el build no trae el escritor de la tabla. Un mensaje que dice
   * la causa hace que no haya que buscar.
   */
  const guardarTramo = (payload) => {
    const reemplazo = root.PPSupabaseBridgeReplacement;
    if (!reemplazo || typeof reemplazo.saveInspectionLink !== "function") {
      return Promise.reject(new Error(
        "No se puede guardar el tramo: este build no trae PPSupabaseBridgeReplacement, que es quien escribe "
        + "inspection_routes. El puente de Apps Script ya no escribe esa tabla."
      ));
    }
    return reemplazo.saveInspectionLink(payload);
  };
  const numberValue = (value) => {
    const number = Number(String(value ?? "").replace(/,/g, ""));
    return Number.isFinite(number) ? number : 0;
  };
  const formatValue = (value) => {
    const number = numberValue(value);
    return Number.isFinite(number) ? String(Math.round(number * 100000) / 100000) : String(value ?? "");
  };
  function renderJobStatus(value, detail = "") { byId("inspectionJobStatus").innerHTML = `<strong class="inspection-card-title">Estado del trabajo</strong><span class="inspection-status-pill">${escape(value)}</span>${detail ? `<div>${escape(detail)}</div>` : ""}`; }

  function optionLabel(item) { return `WO ${item.wo} - ${item.article} - ${item.quantity} pzas`; }
  function renderList() {
    const query = String(byId("inspectionSearch")?.value || "").trim().toUpperCase();
    const items = state.list.filter((item) => !query || optionLabel(item).toUpperCase().includes(query));
    const select = byId("inspectionWorkOrder");
    const selectedWo = String(select.value || "");
    select.innerHTML = `<option value="">${items.length ? "Selecciona WO" : "Sin WO con ese filtro"}</option>` + items.map((item) => `<option value="${escape(item.wo)}">${escape(optionLabel(item))}</option>`).join("");
    const selectionRemains = Boolean(selectedWo && items.some((item) => String(item.wo) === selectedWo));
    select.value = selectionRemains ? selectedWo : "";
    if (selectedWo && !selectionRemains) invalidateBundleSelection(selectedWo);
  }
  async function loadList() {
    const version = ++loadListVersion;
    renderJobStatus("Cargando WOs abiertas...");
    let result;
    try {
      result = await llamar("getInspectionWorkOrders");
    } catch (error) {
      if (version !== loadListVersion) return;
      throw error;
    }
    if (version !== loadListVersion) return;
    if (!result?.ok) throw new Error(result?.error || "No se pudieron cargar las WOs");
    state.list = result.data || [];
    renderList();
    renderJobStatus(`${state.list.length} WOs abiertas`);
    replacePrefetchSchedule(state.list);
  }
  function cachedBundle(wo) {
    const cached = bundleCache.get(wo);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt < INSPECTION_CACHE_TTL_MS) return cached.data;
    bundleCache.delete(wo);
    return null;
  }
  function nextBundleRequestVersion(wo) {
    const version = (bundleRequestVersions.get(wo) || 0) + 1;
    bundleRequestVersions.set(wo, version);
    return version;
  }
  function invalidateBundleSelection(wo) {
    selectionToken += 1;
    const pending = normalBundleRequests.get(wo);
    normalBundleRequests.delete(wo);
    nextBundleRequestVersion(wo);
    if (pending?.task && !pending.task.started) cancelQueuedBundleTask(pending.task);
  }
  function removeQueuedBundleTask(queue, task) {
    const index = queue.indexOf(task);
    if (index >= 0) queue.splice(index, 1);
  }
  function settleBundleTask(task, error, data) {
    if (!task.forceRefresh && normalBundleRequests.get(task.wo)?.task === task) normalBundleRequests.delete(task.wo);
    if (error) task.reject(error);
    else task.resolve(data);
  }
  function cancelQueuedBundleTask(task) {
    if (!task || task.started || task.cancelled) return false;
    task.cancelled = true;
    removeQueuedBundleTask(manualBundleQueue, task);
    removeQueuedBundleTask(prefetchBundleQueue, task);
    settleBundleTask(task, new Error("Solicitud de WO obsoleta"));
    return true;
  }
  function promoteBundleTask(task) {
    task.manualDemand = true;
    if (task.started || task.priority === "manual") return;
    removeQueuedBundleTask(prefetchBundleQueue, task);
    task.priority = "manual";
    manualBundleQueue.push(task);
    drainBundleQueue();
  }
  function startBundleTask(task) {
    task.started = true;
    activeBundleRequests += 1;
    const backendRequest = task.forceRefresh
      ? llamar("getInspectionWorkOrderBundle", task.wo, { forceRefresh: true })
      : llamar("getInspectionWorkOrderBundle", task.wo);
    Promise.resolve(backendRequest).then((result) => {
      if (!result?.ok) throw new Error(result?.error || "No se pudo cargar la WO");
      if (bundleRequestVersions.get(task.wo) === task.version) bundleCache.set(task.wo, { data: result.data, cachedAt: Date.now() });
      return result.data;
    }).then(
      (data) => settleBundleTask(task, null, data),
      (error) => settleBundleTask(task, error),
    ).finally(() => {
      activeBundleRequests -= 1;
      drainBundleQueue();
    });
  }
  function drainBundleQueue() {
    while (activeBundleRequests < INSPECTION_MAX_ACTIVE_BUNDLE_REQUESTS) {
      const task = manualBundleQueue.shift() || prefetchBundleQueue.shift();
      if (!task) return;
      if (task.cancelled) continue;
      if (!task.forceRefresh && bundleRequestVersions.get(task.wo) !== task.version) {
        settleBundleTask(task, new Error("Solicitud de WO obsoleta"));
        continue;
      }
      const cached = !task.forceRefresh && cachedBundle(task.wo);
      if (cached) {
        settleBundleTask(task, null, cached);
        continue;
      }
      startBundleTask(task);
    }
  }
  function requestBundle(wo, forceRefresh = false, priority = "manual") {
    if (!forceRefresh) {
      const cached = cachedBundle(wo);
      if (cached) return Promise.resolve(cached);
      const currentVersion = bundleRequestVersions.get(wo) || 0;
      const pending = normalBundleRequests.get(wo);
      if (pending?.version === currentVersion) {
        if (priority === "manual") promoteBundleTask(pending.task);
        return pending.promise;
      }
      if (pending) {
        normalBundleRequests.delete(wo);
        if (!pending.task.started) cancelQueuedBundleTask(pending.task);
      }
    } else {
      const pending = normalBundleRequests.get(wo);
      normalBundleRequests.delete(wo);
      if (pending?.task && !pending.task.started) cancelQueuedBundleTask(pending.task);
    }
    const version = nextBundleRequestVersion(wo);
    let resolveRequest;
    let rejectRequest;
    const request = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const task = {
      wo,
      forceRefresh,
      version,
      priority,
      manualDemand: priority === "manual",
      started: false,
      cancelled: false,
      resolve: resolveRequest,
      reject: rejectRequest,
    };
    if (!forceRefresh) normalBundleRequests.set(wo, { version, promise: request, task });
    (priority === "manual" ? manualBundleQueue : prefetchBundleQueue).push(task);
    drainBundleQueue();
    return request;
  }
  function replacePrefetchSchedule(workOrders) {
    const desiredWos = new Set((workOrders || []).slice(0, INSPECTION_PREFETCH_COUNT).map((item) => String(item?.wo || "").trim()).filter(Boolean));
    prefetchBundleQueue.slice().forEach((task) => {
      if (!task.manualDemand && !desiredWos.has(task.wo)) cancelQueuedBundleTask(task);
    });
    desiredWos.forEach((wo) => requestBundle(wo, false, "prefetch").catch(() => {}));
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
  function materialStatus(material) {
    const explicit = String(material?.availabilityStatus || material?.disponibilidadEstado || "").trim().toLowerCase();
    if (["rojo", "red", "critical", "critico", "crítico"].includes(explicit)) return "red";
    if (["naranja", "orange", "warning", "amarillo"].includes(explicit)) return "orange";
    const required = numberValue(material?.required);
    const available = numberValue(material?.available ?? material?.disponible);
    const deficit = numberValue(material?.deficitNeto ?? material?.netDeficit ?? material?.deficit);
    if (deficit > 0 || (required > 0 && available < required)) return "red";
    const remanent = numberValue(material?.remanent ?? material?.remanente ?? (available - required));
    const average = numberValue(material?.average ?? material?.promedio);
    if (average > 0 && remanent < average) return "orange";
    return "ok";
  }
  function materialTooltip(material) {
    if (!material) return "";
    return [
      `Disponible: ${formatValue(material.available ?? material.disponible)}`,
      `Requerido hoja: ${formatValue(material.required)}`,
      `Total BOM: ${formatValue(material.requiredOriginal ?? material.required)}`,
      `Emitido WO: ${formatValue(material.issued ?? material.emitido)}`,
      `Déficit: ${formatValue(material.deficit)}`,
      `Déficit neto: ${formatValue(material.deficitNeto ?? material.netDeficit ?? material.deficit)}`
    ].join("\n");
  }
  function materialBadge(material) {
    const name = String(material?.material || "").trim();
    if (!name) return "";
    const status = materialStatus(material);
    const cls = status === "red" ? "inspection-mat--red" : (status === "orange" ? "inspection-mat--orange" : "inspection-mat--ok");
    return `<span class="inspection-mat ${cls}" title="${escape(materialTooltip(material))}">${escape(name)}</span>`;
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
  /**
   * MEDIDO 2026-10-01, POR QUE `ok: false` SE PINTA Y NO SE CUENTA COMO CERO.
   * Con la tabla `inspection_history` todavia sin aplicar (docs/schema-inspection-history.sql),
   * la lectura falla, y sin este `if` el bloque de abajo caia en su rama normal: `entries`
   * vacio, `count` 0, y la tarjeta decia "Total: 0 / Ultima impresion: -" como si nadie
   * hubiera impreso nunca. MEDIDO en las demas tablas de este mismo proyecto: sin sesion
   * la Data API responde HTTP 200 con CERO filas, o sea que "no pude leer" y "no hay
   * ninguna" se ven IGUALES si no se distingue. Aqui se distinguen: la tarjeta dice que
   * no se pudo leer y por que, que es un dato; "0 impresiones" es otro dato.
   */
  function renderHistory(history, job) {
    if (history && history.ok === false) {
      byId("inspectionHistory").innerHTML = `<div class="inspection-history-error"><strong>No se pudo leer el historial de impresiones.</strong> ${escape(history.error || "Sin detalle del error")}</div>`;
      return;
    }
    const data = history?.ok ? history.data : history;
    const entries = Array.isArray(data) ? data : (data?.history || data?.historial || []);
    const latest = entries[0] || {};
    const printedAt = latest.FECHA_HORA || latest.fechaHora || latest.printedAt || "-";
    const folio = latest.FOLIO || latest.folio || latest.OT || latest.wo || job?.wo || "-";
    const count = data?.count ?? data?.conteo ?? entries.length;
    byId("inspectionHistory").innerHTML = `<div><strong>Total:</strong> ${count}</div><div><strong>Última impresión:</strong> ${escape(printedAt)}</div><div><strong>Folio/fecha:</strong> ${escape(folio)} · ${escape(printedAt)}</div>`;
  }
  /**
   * MEDIDO 2026-10-01: releer SOLO el historial despues de imprimir, y no el bundle
   * entero. Sin esto, la tarjeta de al lado seguia diciendo la impresion anterior
   * hasta que se recargaba la OT (el bundle esta en `bundleCache`, 5 minutos), y el
   * registro acababa de hacerse: la pagina contradecía a la base.
   *
   * `getInspectionHistory` es una lectura de UNA tabla, contra el bundle completo que son
   * `work_orders` + `materials` + `operations` + `inventory` + `inspection_routes` +
   * `inspection_history`. Despues de imprimir solo se cambio una de las seis, y recargar
   * las otras cinco para ver una fila es trabajo de red que no cambia nada de lo que se
   * muestra.
   *
   * POR QUE NO SE Lanza EL ERROR. Un fallo aqui no puede impedir imprimir: la
   * impresion ya se confirmo y `root.print()` va justo despues. Se deja pintar el
   * error que traiga `renderHistory` y ya.
   */
  async function refrescarHistorial() {
    const folio = String(state.detail?.workOrder?.wo || "").trim();
    if (!folio) return;
    const history = await llamar("getInspectionHistory", folio);
    renderHistory(history, state.detail?.workOrder);
  }
  function cleanDrawingInput(value) {
    const text = String(value ?? "").trim();
    if (!text) return "";
    const hyperlink = text.match(/HYPERLINK\(\s*["']([^"']+)["']/i);
    let raw = String(hyperlink ? hyperlink[1] : text).trim();
    raw = raw.replace(/^['"]+|['"]+$/g, "").trim();
    return raw;
  }
  function drawingCandidate() { return state.detail?.workOrder?.drawing || state.detail?.materials?.find((material) => material.drawing)?.drawing || ""; }
  function normalizeDrawingUrl(value) {
    const raw = cleanDrawingInput(value);
    if (!raw) return "";
    if (/^maldonado:\/\/abrir\?archivo=/i.test(raw)) return raw;
    const withoutFilePrefix = raw.replace(/^file:\/*/i, "");
    let networkPath = withoutFilePrefix.replace(/\//g, "\\").trim();
    if (/^(SERVER2008|192\.168\.1\.101)\\Produccion2\\/i.test(networkPath)) networkPath = `\\\\${networkPath}`;
    networkPath = networkPath.replace(/^\\\\SERVER2008\\Produccion2\\/i, "\\\\192.168.1.101\\Produccion2\\");
    // Sin plantillas con "://" seguido de interpolacion: el HTML service de Apps Script
    // mutila esas lineas al entregar la pagina y el bundle deja de parsear (RULE-WEB-002).
    if (/^\\\\192\.168\.1\.101\\Produccion2\\/i.test(networkPath) && /\.pdf$/i.test(networkPath)) return "maldonado://abrir?archivo=" + encodeURIComponent(networkPath);
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^(www\.|drive\.google\.com|docs\.google\.com)/i.test(raw)) return "https://" + raw;
    if (/^[A-Za-z0-9_-]{20,}$/.test(raw)) return "https://drive.google.com/file/d/" + encodeURIComponent(raw) + "/view";
    return "";
  }
  function currentDrawing() { return normalizeDrawingUrl(drawingCandidate()); }
  function clickDrawingLink(drawing) {
    const link = document.createElement("a");
    link.href = drawing;
    if (!/^maldonado:\/\//i.test(drawing)) { link.target = "_blank"; link.rel = "noopener noreferrer"; }
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  function openDrawing() {
    const raw = drawingCandidate();
    const drawing = normalizeDrawingUrl(raw);
    if (!drawing) { root.alert("No hay una liga de dibujo válida. Revisa que sea PDF dentro de \\192.168.1.101\\Produccion2\\, " + DRAWING_SOURCE_HINT + ", URL o ID de Drive. Valor actual: " + (raw || "vacía")); return; }
    if (/^maldonado:\/\//i.test(drawing)) { clickDrawingLink(drawing); return; }
    const opened = root.open(drawing, "_blank", "noopener,noreferrer");
    if (opened) return;
    clickDrawingLink(drawing);
  }
  function materialRow(first, second, deliveryLabel = "", deliveryDate = "") {
    return cell(3, deliveryLabel, "inspection-label inspection-br") + cell(4, deliveryDate, "inspection-br") + cell(3, materialBadge(first), "inspection-br") + cell(3, escape(first?.description || "")) + cell(2, escape(first?.route || ""), "inspection-br") + cell(2, escape(first?.required ?? ""), "inspection-qty inspection-br") + cell(2, materialBadge(second)) + cell(2, escape(second?.description || "")) + cell(2, escape(second?.route || ""), "inspection-br") + cell(1, escape(second?.required ?? ""), "inspection-qty");
  }
  function visibleInspectionMaterials() {
    return root.InspectionCore.inspectionMaterials(state.detail?.materials || []);
  }
  function ensureLinkDialog() {
    let dialog = byId("inspectionLinkDialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "inspectionLinkDialog";
      dialog.className = "inspection-link-dialog";
      document.body.appendChild(dialog);
    }
    dialog.setAttribute("aria-labelledby", "inspectionLinkDialogTitle");
    return dialog;
  }
  function setLinkDialogMessage(text, status = "") {
    const message = byId("inspectionLinkDialogMessage");
    if (!message) return;
    message.textContent = text || "";
    message.className = `inspection-link-dialog-message ${status}`.trim();
  }
  function closeLinkDialog() {
    const dialog = byId("inspectionLinkDialog");
    if (!dialog) return;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }
  function updateInspectionRouteStatus(input) {
    const status = input.closest(".inspection-link-material-row")?.querySelector(".inspection-link-material-status");
    if (!status) return;
    const hasRoute = Boolean(String(input.value || "").trim());
    status.textContent = hasRoute ? "Tramo capturado" : "Falta tramo";
    status.classList.toggle("is-ready", hasRoute);
    status.classList.toggle("is-pending", !hasRoute);
  }
  function openEditModal(focusIndex) {
    const detail = state.detail;
    const job = detail?.workOrder || {};
    const allMaterials = detail?.materials || [];
    const materials = visibleInspectionMaterials();
    if (!job.article || !materials.length) { root.alert("Carga una WO con materiales antes de editar tramo/dibujo."); return; }
    const dialog = ensureLinkDialog();
    const drawing = cleanDrawingInput(drawingCandidate());
    const materialRows = materials.map((material) => {
      const sourceIndex = allMaterials.indexOf(material);
      const quantity = material.required ?? material.requiredOriginal ?? "";
      const route = String(material.route || "").trim();
      return `<div class="inspection-link-material-row" role="row">
        <div class="inspection-link-material-copy" role="cell">
          <strong>${escape(material.material || "")}</strong>
          <span>${escape(material.description || "")}</span>
        </div>
        <div class="inspection-link-material-quantity" role="cell"><span>Cantidad requerida</span><strong>${escape(quantity)}</strong></div>
        <label class="inspection-link-route-field" role="cell">
          <span>Tramo</span>
          <input type="text" data-inspection-route="${sourceIndex}" value="${escape(route)}" placeholder="Ej. 650 mm" aria-label="Tramo de ${escape(material.material || "material")}">
        </label>
        <div class="inspection-link-material-status ${route ? "is-ready" : "is-pending"}" role="cell" aria-live="polite">${route ? "Tramo capturado" : "Falta tramo"}</div>
      </div>`;
    }).join("");
    dialog.innerHTML = `<form id="inspectionLinkForm" class="inspection-link-form" novalidate>
      <header class="inspection-link-title">
        <div class="inspection-link-heading">
          <h2 id="inspectionLinkDialogTitle">Editar tramo/dibujo</h2>
          <span>Completa los datos requeridos para esta orden.</span>
        </div>
        <div class="inspection-link-context" aria-label="Orden de trabajo y artículo">
          <span><small>WO</small><strong>${escape(job.wo || "")}</strong></span>
          <span><small>Artículo</small><strong>${escape(job.article || "")}</strong></span>
        </div>
        <button type="button" class="inspection-link-close" data-inspection-link-close aria-label="Cerrar">×</button>
      </header>
      <div class="inspection-link-body">
        <section class="inspection-link-rule" aria-label="Regla de guardado">
          <span class="inspection-link-rule-icon" aria-hidden="true">i</span>
          <p><strong>Regla de guardado</strong><span>El dibujo se captura una sola vez para la OT y se guarda en la fila del material principal. El tramo se captura por articulo + materia prima.</span></p>
        </section>
        <section class="inspection-link-section">
          <header><strong>Dibujo del artículo</strong><span>${escape(job.article || "")}</span></header>
          <label><span>DIBUJO</span><input id="inspectionDrawingInput" type="text" value="${escape(drawing)}" placeholder="\\\\192.168.1.101\\Produccion2\\...\\archivo.pdf"></label>
          <small>Para ruta de red completa pega la ruta en Dibujo. También acepta ${DRAWING_SOURCE_HINT}, URL o ID de Drive.</small>
        </section>
        <section class="inspection-link-materials" role="table" aria-label="Tramos por material">
          <p class="inspection-link-material-note">El tramo se guarda por articulo + material.</p>
          <div class="inspection-link-material-head" role="row">
            <span role="columnheader">Material</span>
            <span role="columnheader">Cantidad requerida</span>
            <span role="columnheader">Tramo</span>
            <span role="columnheader">Estado</span>
          </div>
          ${materialRows}
        </section>
      </div>
      <footer class="inspection-link-actions">
        <p id="inspectionLinkDialogMessage" class="inspection-link-dialog-message" aria-live="polite"></p>
        <div class="inspection-link-action-buttons">
          <button type="button" class="button" data-inspection-link-close>Cancelar</button>
          <button type="submit" class="button primary" data-inspection-save-links>Guardar tramo/dibujo</button>
        </div>
      </footer>
    </form>`;
    dialog.querySelectorAll("[data-inspection-link-close]").forEach((button) => button.addEventListener("click", closeLinkDialog));
    dialog.querySelectorAll("[data-inspection-route]").forEach((input) => input.addEventListener("input", () => updateInspectionRouteStatus(input)));
    dialog.querySelector("#inspectionLinkForm").addEventListener("submit", saveEditModal);
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    const targetIndex = Number.isFinite(Number(focusIndex)) ? Number(focusIndex) : allMaterials.indexOf(materials[0]);
    root.requestAnimationFrame(() => dialog.querySelector(`[data-inspection-route="${targetIndex}"]`)?.focus());
  }
  async function saveEditModal(event) {
    event.preventDefault();
    const dialog = byId("inspectionLinkDialog");
    const job = state.detail?.workOrder || {};
    const allMaterials = state.detail?.materials || [];
    const materials = visibleInspectionMaterials();
    const principal = materials[0];
    if (!dialog || !job.article || !principal) return;
    const drawingInput = cleanDrawingInput(dialog.querySelector("#inspectionDrawingInput")?.value || "");
    if (drawingInput && !normalizeDrawingUrl(drawingInput)) {
      setLinkDialogMessage("El dibujo debe ser una ruta PDF dentro de \\192.168.1.101\\Produccion2\\, maldonado://, URL o ID de Drive.", "error");
      return;
    }
    const saveButton = dialog.querySelector("[data-inspection-save-links]");
    const routeInputs = Array.from(dialog.querySelectorAll("[data-inspection-route]"));
    const routeByIndex = new Map(routeInputs.map((input) => [Number(input.dataset.inspectionRoute), String(input.value || "").trim()]));
    const previousPrincipalDrawing = cleanDrawingInput(job.drawing || principal.drawing || "");
    const changes = materials.map((material) => {
      const sourceIndex = allMaterials.indexOf(material);
      const route = routeByIndex.has(sourceIndex) ? routeByIndex.get(sourceIndex) : String(material.route || "").trim();
      const isPrincipal = material === principal;
      const drawing = isPrincipal ? drawingInput : cleanDrawingInput(material.drawing || "");
      const routeChanged = route !== String(material.route || "").trim();
      const drawingChanged = isPrincipal && drawingInput !== previousPrincipalDrawing;
      return { material, route, drawing, isPrincipal, routeChanged, drawingChanged };
    }).filter((item) => item.routeChanged || item.drawingChanged);
    if (!changes.length) { setLinkDialogMessage("Sin cambios para guardar.", "ok"); return; }
    try {
      if (saveButton) saveButton.disabled = true;
      setLinkDialogMessage("Guardando cambios...", "");
      for (const item of changes) {
        // MEDIDO 2026-10-01: esto iba por `call("saveInspectionLink")`, o sea por el
        // puente de Apps Script, y de ahi salia a la hoja `Tramos`. El catalogo de
        // tramos se migro a la tabla `inspection_routes` (docs/schema-inspection-routes.sql)
        // y el unico escritor es la pagina, con su sesion. Por eso aqui NO hay plan B
        // por el puente: `saveInspectionLink` de Apps Script ahora se niega con un
        // mensaje que dice donde esta (16-inspection-service.js), asi que un plan B
        // seria un segundo escritor sobre el mismo dato — el que perdiera se enteraria
        // al imprimir, no al guardar.
        //
        // QUE SE MANDA. `drawing` SI viaja, y a proposito, porque este dialogo edita
        // el dibujo DEL MATERIAL y no solo el tramo: el dibujo de un material vive en
        // la columna `dibujo` de su propia fila de `inspection_routes`, y es la misma
        // fila que guarda el tramo. Por eso en el dialogo de la pestana de Catalogos
        // (que solo edita el tramo) el dibujo NO se manda, y aqui si: son dos
        // formularios distintos sobre la misma fila.
        const result = await guardarTramo({ article: job.article, material: item.material.material, route: item.route, drawing: item.drawing });
        if (!result?.ok) throw new Error(result?.error || "No se pudo guardar el vínculo");
        item.material.route = item.route;
        item.material.drawing = item.drawing;
      }
      if (principal) {
        principal.drawing = drawingInput;
        job.drawing = drawingInput;
      }
      renderDetail();
      setLinkDialogMessage("Cambios guardados.", "ok");
      root.setTimeout(closeLinkDialog, 550);
    } catch (error) {
      setLinkDialogMessage(error.message || String(error), "error");
    } finally {
      if (saveButton) saveButton.disabled = false;
    }
  }
  function editMaterialLink(index) { openEditModal(index); }
  function renderDetail() {
    const detail = state.detail;
    if (!detail) return;
    const job = detail.workOrder || {};
    // MEDIDO 2026-10-04: `inspectionMaterialsUnicos` va aqui aunque `inspectionDetail` ya
    // deduplique. Es una garantia local de la HOJA, que es donde el duplicado se ve: la base
    // tenia dos filas por cada material (las copias que creo el escritor escribiendo el
    // UUID de la fila como `line_id`, ya corregido) y la impression sacaba cada MP DOS
    // VECES, lado a lado. Que la hoja no pueda duplicar una MP aunque le lleguen repetida
    // no depende de que otro archivo se acuerde de hacerlo.
    const materials = root.InspectionCore.inspectionMaterials(root.InspectionCore.inspectionMaterialsUnicos(detail.materials || []));
    const rows = root.InspectionCore.inspectionRows(detail.operations || [], state.selection);
    // COMO SE LLENA LA BANDA DE MATERIALES, Y POR QUE (decision del usuario 2026-10-04:
    // "empieza a poblar con las MP segun el catalogo y la tabla materiales desde la izq. a
    // la der.; si faltan filas para mostrar materiales se deben agregar primero izquierda
    // luego derecha, pero no se deben duplicar").
    //   - `materials` ya viene en el orden de la tabla de materiales, y no se reordena: el
    //     orden de las MP es el del dato, no uno impuesto aqui.
    //   - Cada fila toma la IZQUIERDA y luego la DERECHA, y si la derecha queda vacia se
    //     agrega la fila siguiente: por eso el salto es de DOS en DOS. Con 5 MP salen 3
    //     filas (izq,der | izq,der | izq) y ninguna MP aparece dos veces, porque cada
    //     indice se consume una sola vez.
    //   - "Fechas de entrega" va en la PRIMERA fila, que es donde la etiqueta del formato
    //     original esta; las siguientes la dejan vacia para que la persona escriba a mano.
    const materialRows = [];
    for (let index = 0; index < materials.length; index += 2) materialRows.push(materialRow(materials[index], materials[index + 1], index === 0 ? "Fechas de entrega:" : "", index === 0 ? escape(job.dueDate || "") : ""));
    // Sin materiales visibles la hoja imprime igual, con la banda de MP vacia y la fecha de
    // entrega puesta: una hoja vacia de materiales es un dato ("esta OT no trae MP"), no un
    // fallo de la pagina.
    if (!materialRows.length) materialRows.push(materialRow({}, {}, "Fechas de entrega:", escape(job.dueDate || "")));
    // Y despues, UNA fila en blanco para escribir a mano. NO es una fila para materiales: no
    // tiene ningun material que mostrar, y por eso se agrega DESPUES del ciclo de arriba y no
    // dentro. Sale cuando la ultima fila de materiales tiene un hueco (0 o 1 MP) y tambien
    // con exactamente 2, que es el caso en que el formato deja la linea de libre.
    if (materials.length <= 2) materialRows.push(materialRow({}, {}));
    byId("inspectionSheetGrid").innerHTML = `<div class="inspection-doc-code">MP FO 08 V23</div>${cell(24, '<strong class="inspection-logo">MALDONADO</strong><span class="inspection-title-text">HOJA DE INSPECCION Y ESTADISTICAS DE TUBERIA DOBLADA</span>', "inspection-title")}${cell(4, "", "inspection-br inspection-bb")}${cell(2, "Trabajo:", "inspection-label inspection-bb")}${cell(3, escape(job.wo), "inspection-big inspection-bb")}${cell(7, escape(job.article), "inspection-big inspection-br inspection-bb")}${cell(2, "REV", "inspection-big inspection-bb")}${cell(1, escape(job.revision || "A"), "inspection-big inspection-br inspection-bb")}${cell(2, "Cantidad:", "inspection-label inspection-bb")}${cell(3, `${escape(job.quantity)} Piezas`, "inspection-big inspection-bb")}${cell(7, "ORDEN DE VENTA", "inspection-label inspection-br inspection-bb")}${cell(3, "Material", "inspection-head inspection-br inspection-bb")}${cell(3, "Descripcion", "inspection-head inspection-bb")}${cell(2, "Tramo tubo", "inspection-head inspection-br inspection-bb")}${cell(2, "Tubo/pzas", "inspection-head inspection-br inspection-bb")}${cell(2, "Material", "inspection-head inspection-bb")}${cell(2, "Descripcion", "inspection-head inspection-bb")}${cell(2, "Tramo tubo", "inspection-head inspection-br inspection-bb")}${cell(1, "Tubo/pzas", "inspection-head inspection-bb")}${materialRows.join("")}<div class="inspection-section-title"></div>${operationHeader()}${operationSubheader("OP")}${rows.map((row) => operationRow(row.operation)).join("")}`;
    byId("inspectionSecondCapture").innerHTML = `<div class="inspection-grid"><div class="inspection-section-title"></div>${inspectionOperationLayout(3).replace(operationSubheader("OP"), operationSubheader("OPER."))}</div>`;
    const footerCell = (span, html, classes = "", rowSpan = 1) => `<div class="inspection-footer-cell ${classes}" style="grid-column:span ${span}${rowSpan > 1 ? `;grid-row:span ${rowSpan}` : ""}">${html}</div>`;
    let footer = footerCell(1, "Oper", "inspection-footer-head") + footerCell(1, "N°<br>OPER", "inspection-footer-head") + footerCell(2, "Cantidad NC", "inspection-footer-head") + footerCell(1, "Clave", "inspection-footer-head inspection-br") + footerCell(4, "FTY", "inspection-footer-head inspection-br") + footerCell(6, "SELLO LIBERACION", "inspection-footer-head inspection-br") + footerCell(5, "OBSERVACIONES:", "inspection-footer-head inspection-br") + footerCell(2, "ENTREGA", "inspection-footer-head inspection-br") + footerCell(1, "CANT.", "inspection-footer-head inspection-br") + footerCell(1, "RECIBE", "inspection-footer-head");
    for (let row = 0; row < 3; row += 1) {
      footer += footerCell(1, "") + footerCell(1, "") + footerCell(2, "") + footerCell(1, "", "inspection-br") + footerCell(4, "", "inspection-br");
      if (row === 0) footer += footerCell(6, "", "inspection-seal-box inspection-br", 3);
      footer += footerCell(5, "", "inspection-br") + footerCell(2, "", "inspection-br") + footerCell(1, "", "inspection-br") + footerCell(1, "");
    }
    byId("inspectionReleaseFooter").innerHTML = footer;
    byId("inspectionOperationChoices").innerHTML = (detail.operations || []).map((operation, index) => { const key = root.InspectionCore.operationKey(operation, index); return `<label><input type="checkbox" data-inspection-operation="${escape(key)}" ${state.selection[key] !== false ? "checked" : ""}> ${escape(operation.code)} - ${escape(operation.operation)}</label>`; }).join("");
    byId("inspectionOperationChoices").querySelectorAll("[data-inspection-operation]").forEach((input) => input.addEventListener("change", () => { state.selection[input.dataset.inspectionOperation] = input.checked; renderDetail(); }));
    const semaphore = printDiagnostic(detail).status;
    byId("inspectionPrintCheck").className = `inspection-side-card inspection-status inspection-print-check--${semaphore}`;
    renderPrintChecks(detail);
    renderJobStatus(job.status || "En curso", `${detail.operations.length} operaciones · ${materials.length} materiales`);
    byId("inspectionDrawing").disabled = !currentDrawing();
    byId("inspectionEditLink").disabled = !materials.length;
  }
  function firstInspectionMaterialIndex() {
    const materials = state.detail?.materials || [];
    const first = root.InspectionCore.inspectionMaterials(materials)[0];
    return materials.indexOf(first);
  }
  async function loadDetail(options = {}) {
    const token = ++selectionToken;
    const wo = byId("inspectionWorkOrder").value;
    if (!wo) return;
    renderJobStatus(`Cargando WO ${wo}...`);
    let bundle;
    try {
      bundle = await requestBundle(wo, options.forceRefresh === true);
    } catch (error) {
      if (token !== selectionToken) return;
      throw error;
    }
    if (token !== selectionToken) return;
    state.detail = bundle.detail;
    state.selection = root.InspectionCore.initialOperationSelection(state.detail.operations || []);
    renderDetail();
    renderHistory(bundle.history, state.detail.workOrder);
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
      const result = await llamar("recordInspectionPrint", {
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
      if (result?.ok) await refrescarHistorial();
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
    const scale = Math.min(1, widthRatio, heightRatio);
    sheet.style.setProperty("--inspection-print-scale", String(scale));
    sheet.style.setProperty("--inspection-print-minheight", `${Math.ceil(printableHeightMm * 96 / 25.4 / scale)}px`);
    try { await new Promise((resolve) => root.setTimeout(resolve, 50)); root.print(); }
    finally { sheet.style.removeProperty("--inspection-print-scale"); sheet.style.removeProperty("--inspection-print-minheight"); document.body.classList.remove("printing-inspection"); }
  }
  function clearInspectionPrintState() {
    byId("inspectionDocument")?.style.removeProperty("--inspection-print-scale");
    document.body.classList.remove("printing-inspection");
  }
  function reportError(error) { renderJobStatus("Error", error.message); }
  function initialize() {
    if (!byId("inspectionWorkOrder")) return;
    byId("inspectionSearch").addEventListener("input", renderList);
    byId("inspectionReload").addEventListener("click", () => loadDetail({ forceRefresh: true }).catch(reportError));
    byId("inspectionWorkOrder").addEventListener("change", () => loadDetail().catch(reportError));
    byId("inspectionSelectOps").addEventListener("click", () => { byId("inspectionOperationChoices").hidden = !byId("inspectionOperationChoices").hidden; });
    byId("inspectionDrawing").addEventListener("click", openDrawing);
    byId("inspectionEditLink").addEventListener("click", () => editMaterialLink(firstInspectionMaterialIndex()));
    byId("inspectionPrint").addEventListener("click", () => printInspection().catch(reportError));
    const ensureLoaded = () => { if (root.location.hash === "#hoja-inspeccion" && !state.list.length) loadList().catch(reportError); };
    root.addEventListener("hashchange", ensureLoaded);
    root.addEventListener("afterprint", clearInspectionPrintState);
    ensureLoaded();
  }
  root.InspectionApp = { initialize, loadList, loadDetail };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true }); else initialize();
})(window);

