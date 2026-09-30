/**
 * REEMPLAZO DEL PUENTE DE APPS POR SUPABASE.
 *
 * Este modulo reemplaza todas las llamadas al puente de Apps Script con
 * lecturas/escrituras directas a Supabase. Es la unica fuente de datos.
 *
 * Cada funcion replica el contrato del metodo del puente que reemplaza,
 * devolviendo datos en el mismo formato que la app espera.
 */
(function initSupabaseBridgeReplacement(root, factory) {
  "use strict";

  const api = factory(root);
  if (root) root.PPSupabaseBridgeReplacement = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function supabaseBridgeReplacementFactory(root) {
  "use strict";

  const reader = root.PPSupabaseReader;
  const writer = root.PPSupabaseWriter;

  function getReader() {
    if (!reader || typeof reader.readTable !== "function") {
      throw new Error("PPSupabaseReader no esta disponible");
    }
    return reader;
  }

  function getWriter() {
    if (!writer || typeof writer.guardarPlan !== "function") {
      throw new Error("PPSupabaseWriter no esta disponible");
    }
    return writer;
  }

  /**
   * fetchNetSuiteWorkOrdersLite -> lee de work_orders
   * Devuelve { workOrders, syncedAt, savedAt, previewComplete }
   */
  async function fetchNetSuiteWorkOrdersLite() {
    const r = getReader();
    const rows = await r.readTable("work_orders", { order: "ot.asc" });
    const workOrders = r.mapWorkOrders(rows);
    const now = new Date().toISOString();
    return {
      workOrders,
      syncedAt: now,
      savedAt: now,
      previewComplete: true,
    };
  }

  /**
   * getPlanningWorkOrderDataBatch -> lee de operations y materials
   * Devuelve { ok, data: [{ ot, ok, data: { operations, materials, workOrder } }] }
   */
  async function getPlanningWorkOrderDataBatch(ots) {
    const r = getReader();
    const otList = Array.isArray(ots) ? ots : [];
    if (!otList.length) return { ok: true, data: [] };

    const operations = await r.readTable("operations", {
      filters: otList.length === 1 ? { ot: otList[0] } : undefined,
      order: "ot.asc,secuencia.asc",
    });
    const materials = await r.readTable("materials", {
      order: "ot.asc",
    });
    const workOrders = await r.readTable("work_orders", {
      order: "ot.asc",
    });

    const opsByOt = {};
    (operations || []).forEach((op) => {
      const key = String(op.ot || "").trim();
      if (!key) return;
      if (!opsByOt[key]) opsByOt[key] = [];
      opsByOt[key].push(op);
    });
    const matsByOt = {};
    (materials || []).forEach((mat) => {
      const key = String(mat.ot || "").trim();
      if (!key) return;
      if (!matsByOt[key]) matsByOt[key] = [];
      matsByOt[key].push(mat);
    });
    const woByOt = {};
    (workOrders || []).forEach((wo) => {
      const key = String(wo.ot || "").trim();
      if (!key) return;
      woByOt[key] = wo;
    });

    const data = otList.map((ot) => {
      const key = String(ot || "").trim();
      const ops = opsByOt[key] || [];
      const mats = matsByOt[key] || [];
      const wo = woByOt[key] || null;
      return {
        ot,
        ok: true,
        data: {
          operations: r.mapOperations(ops),
          materials: r.mapMaterials(mats),
          workOrder: wo ? r.mapWorkOrders([wo])[0] : null,
        },
      };
    });
    return { ok: true, data };
  }

  /**
   * getPlanningWorkOrderData -> lee de operations y materials para una OT
   * Devuelve { ok, data: { operations, materials, workOrder } }
   */
  async function getPlanningWorkOrderData(ot) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { ok: false, error: "OT requerida" };

    const operations = await r.readTable("operations", {
      filters: { ot: key },
      order: "secuencia.asc",
    });
    const materials = await r.readTable("materials", {
      filters: { ot: key },
    });
    const workOrders = await r.readTable("work_orders", {
      filters: { ot: key },
    });

    return {
      ok: true,
      data: {
        operations: r.mapOperations(operations),
        materials: r.mapMaterials(materials),
        workOrder: workOrders.length ? r.mapWorkOrders(workOrders)[0] : null,
      },
    };
  }

  /**
   * syncNetSuiteWorkOrders -> lee de work_orders
   */
  async function syncNetSuiteWorkOrders() {
    return fetchNetSuiteWorkOrdersLite();
  }

  /**
   * syncNetSuitePlant -> lee de catalogos (operators, capabilities, etc.)
   */
  async function syncNetSuitePlant() {
    const r = getReader();
    const catalogs = await r.readCatalogs();
    return {
      ...catalogs,
      source: "supabase",
    };
  }

  /**
   * syncNetSuitePlanningData -> lee de operations y materials
   */
  async function syncNetSuitePlanningData() {
    const r = getReader();
    const operations = await r.readTable("operations", { order: "ot.asc,secuencia.asc" });
    const materials = await r.readTable("materials", { order: "ot.asc" });
    return {
      operations: r.mapOperations(operations),
      materials: r.mapMaterials(materials),
      source: "supabase",
    };
  }

  /**
   * confirmWorkOrderClosures -> lee de work_orders para confirmar estatus
   * Devuelve { results: { [ot]: { ot, found, closed, status } } }
   */
  async function confirmWorkOrderClosures(ots) {
    const r = getReader();
    const otList = Array.isArray(ots) ? ots : [];
    if (!otList.length) return { results: {}, asked: 0 };

    const workOrders = await r.readTable("work_orders", { order: "ot.asc" });
    const woByOt = {};
    (workOrders || []).forEach((wo) => {
      const key = String(wo.ot || "").trim();
      if (key) woByOt[key] = wo;
    });

    const results = {};
    otList.forEach((ot) => {
      const key = String(ot || "").trim();
      const wo = woByOt[key];
      if (wo) {
        const status = String(wo.estatus || "").toUpperCase();
        const closed = ["CERRADA", "CERRADO", "CLOSED", "COMPLETADA", "COMPLETADO", "CANCELADA", "CANCELADO"].includes(status);
        results[key] = { ot: key, found: true, closed, status: wo.estatus };
      } else {
        results[key] = { ot: key, found: false, closed: false, status: "" };
      }
    });
    return { results, asked: otList.length };
  }

  /**
   * getInspectionWorkOrder -> lee de work_orders para inspeccion
   * Devuelve { ok, data: { workOrder: { quantity, builtQuantity, pendingQuantity, status } } }
   */
  async function getInspectionWorkOrder(ot) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { ok: false, error: "OT requerida" };

    const rows = await r.readTable("work_orders", { filters: { ot: key } });
    if (!rows.length) return { ok: false, error: "OT no encontrada" };

    const wo = r.mapWorkOrders(rows)[0];
    return {
      ok: true,
      data: {
        workOrder: {
          quantity: wo.quantity,
          builtQuantity: wo.builtQuantity,
          pendingQuantity: wo.pendingQuantity,
          status: wo.status,
        },
      },
    };
  }

  /**
   * getInspectionDrawingRoutes -> lee de materials para rutas de dibujo
   * Devuelve { ok, data: [{ ARTICULO, MATERIAL, DIBUJO }] }
   */
  async function getInspectionDrawingRoutes(partLabel) {
    const r = getReader();
    const rows = await r.readTable("materials", { order: "ot.asc" });
    const part = String(partLabel || "").trim().toUpperCase();
    const data = (rows || [])
      .filter((row) => {
        if (!part) return true;
        const componente = String(row.componente || "").trim().toUpperCase();
        return componente.includes(part);
      })
      .map((row) => ({
        ARTICULO: row.articulo || row.componente || "",
        MATERIAL: row.componente || "",
        DIBUJO: row.dibujo || row.foto_url || "",
      }));
    return { ok: true, data };
  }

  /**
   * getInspectionWorkOrderBundle -> lee de work_orders y materials
   * Devuelve { ok, data: { workOrder, materials, drawing } }
   */
  async function getInspectionWorkOrderBundle(ot) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { ok: false, error: "OT requerida" };

    const workOrders = await r.readTable("work_orders", { filters: { ot: key } });
    const materials = await r.readTable("materials", { filters: { ot: key } });
    const wo = workOrders.length ? r.mapWorkOrders(workOrders)[0] : null;
    const mats = r.mapMaterials(materials);
    const drawing = wo?.photoUrl || mats.find((m) => m.drawing)?.drawing || "";
    return {
      ok: true,
      data: { workOrder: wo, materials: mats, drawing },
    };
  }

  /**
   * saveInspectionLink -> escribe en materials (o inspection_links si existe)
   * Devuelve { ok, data }
   */
  async function saveInspectionLink(payload) {
    const w = getWriter();
    const data = payload || {};
    // Escribir el enlace de inspeccion en la tabla materials
    const result = await w.guardarPlan({
      materials: [{
        ot: data.ot || "",
        line_id: data.lineId || "",
        dibujo: data.drawing || data.route || "",
      }],
    });
    return { ok: !result?.error, data: result };
  }

  /**
   * saveDraftSnapshot -> escribe en plan_snapshots
   * Devuelve { snapshotId, version, ... }
   */
  async function saveDraftSnapshot(payload) {
    const w = getWriter();
    const data = payload || {};
    const snapshotId = data.snapshotId || `snap-${Date.now()}`;
    const result = await w.guardarPlan({
      planSnapshots: [{
        snapshot_id: snapshotId,
        version: data.version || 1,
        plan_start: data.planStart || "",
        status: "BORRADOR",
        payload: JSON.stringify(data),
        generated_at: data.generatedAt || new Date().toISOString(),
      }],
    });
    if (result?.error) throw new Error(result.error);
    return { ...data, snapshotId };
  }

  /**
   * savePlanSnapshot -> escribe en plan_snapshots
   */
  async function savePlanSnapshot(payload) {
    const w = getWriter();
    const data = payload || {};
    const snapshotId = data.snapshotId || `snap-${Date.now()}`;
    const result = await w.guardarPlan({
      planSnapshots: [{
        snapshot_id: snapshotId,
        version: data.version || 1,
        plan_start: data.planStart || "",
        status: data.status || "RESPALDO",
        payload: JSON.stringify(data),
        generated_at: data.generatedAt || new Date().toISOString(),
      }],
    });
    if (result?.error) throw new Error(result.error);
    return { ...data, snapshotId };
  }

  /**
   * publishDraftPlan -> escribe en plan_snapshots con status PUBLICADO
   */
  async function publishDraftPlan(payload) {
    const w = getWriter();
    const data = payload || {};
    const snapshotId = data.snapshotId || `snap-${Date.now()}`;
    const result = await w.guardarPlan({
      planSnapshots: [{
        snapshot_id: snapshotId,
        version: data.version || 1,
        plan_start: data.planStart || "",
        status: "PUBLICADO",
        payload: JSON.stringify(data),
        generated_at: data.generatedAt || new Date().toISOString(),
      }],
    });
    if (result?.error) throw new Error(result.error);
    return { ok: true, activeVersion: { ...data, snapshotId } };
  }

  /**
   * getPlanSnapshot -> lee de plan_snapshots
   */
  async function getPlanSnapshot(snapshotId) {
    const r = getReader();
    const id = String(snapshotId || "").trim();
    if (!id) return null;
    const rows = await r.readTable("plan_snapshots", {
      filters: { snapshot_id: id },
    });
    if (!rows.length) return null;
    const row = rows[0];
    try {
      return JSON.parse(row.payload || "{}");
    } catch {
      return row;
    }
  }

  /**
   * restorePublishedPlanAsDraft -> lee de plan_snapshots y devuelve el estado
   */
  async function restorePublishedPlanAsDraft(snapshotId, previewState) {
    const snapshot = await getPlanSnapshot(snapshotId);
    if (!snapshot) throw new Error("No se encontro la instantanea");
    return {
      state: {
        ...snapshot,
        draftVersionId: snapshotId,
        planStatus: "BORRADOR",
      },
    };
  }

  /**
   * listPlanSnapshots -> lee de plan_snapshots
   */
  async function listPlanSnapshots() {
    const r = getReader();
    const rows = await r.readTable("plan_snapshots", {
      order: "generated_at.desc",
    });
    return (rows || []).map((row) => {
      try {
        return JSON.parse(row.payload || "{}");
      } catch {
        return row;
      }
    });
  }

  /**
   * getPlanSnapshotLight -> lee de plan_snapshots (version ligera)
   */
  async function getPlanSnapshotLight(snapshotId) {
    const r = getReader();
    const id = String(snapshotId || "").trim();
    if (!id) return null;
    const rows = await r.readTable("plan_snapshots", {
      filters: { snapshot_id: id },
    });
    if (!rows.length) return null;
    const row = rows[0];
    try {
      const parsed = JSON.parse(row.payload || "{}");
      return {
        snapshotId: parsed.snapshotId || id,
        version: parsed.version,
        planStart: parsed.planStart,
        status: parsed.status,
        generatedAt: parsed.generatedAt,
        operations: parsed.operations || [],
      };
    } catch {
      return row;
    }
  }

  /**
   * saveOperationPlanStatus -> escribe en operation_plan_statuses
   */
  async function saveOperationPlanStatus(payload) {
    const w = getWriter();
    const data = payload || {};
    const statuses = Array.isArray(data.statuses) ? data.statuses : [data.status].filter(Boolean);
    const result = await w.guardarPlan({
      operationPlanStatuses: statuses.map((s) => ({
        key: s.key || `${s.ot}-${s.sequence}`,
        ot: s.ot || "",
        secuencia: s.sequence || 0,
        status: s.status || "PENDIENTE",
        origin: s.origin || "draft",
        fecha_completado: s.completedAt || null,
        fecha_reapertura: s.reopenedAt || null,
      })),
    });
    return { revision: data.revision, savedAt: new Date().toISOString(), ...result };
  }

  /**
   * getAppState -> lee de Supabase (app_state + catalogos)
   */
  async function getAppState() {
    const r = getReader();
    const catalogs = await r.readCatalogs();
    return {
      ...catalogs,
      source: "supabase",
    };
  }

  /**
   * getAppStateIfChanged -> lee de Supabase y compara revision
   */
  async function getAppStateIfChanged(revision, options) {
    const r = getReader();
    const rows = await r.readTable("app_state", { limit: 1 });
    const appState = r.mapAppState(rows);
    const currentRevision = appState?.revision || 0;
    if (currentRevision === Number(revision || 0)) {
      return { unchanged: true, revision: currentRevision, savedAt: appState?.savedAt || "" };
    }
    const catalogs = await r.readCatalogs();
    return {
      ...catalogs,
      revision: currentRevision,
      savedAt: appState?.savedAt || "",
      source: "supabase",
    };
  }

  /**
   * getMaterialsForOt -> lee de materials
   */
  async function getMaterialsForOt(ot, revision) {
    const r = getReader();
    const key = String(ot || "").trim();
    if (!key) return { materials: [] };
    const rows = await r.readTable("materials", { filters: { ot: key } });
    return { materials: r.mapMaterials(rows) };
  }

  return {
    fetchNetSuiteWorkOrdersLite,
    getPlanningWorkOrderDataBatch,
    getPlanningWorkOrderData,
    syncNetSuiteWorkOrders,
    syncNetSuitePlant,
    syncNetSuitePlanningData,
    confirmWorkOrderClosures,
    getInspectionWorkOrder,
    getInspectionDrawingRoutes,
    getInspectionWorkOrderBundle,
    saveInspectionLink,
    saveDraftSnapshot,
    savePlanSnapshot,
    publishDraftPlan,
    getPlanSnapshot,
    restorePublishedPlanAsDraft,
    listPlanSnapshots,
    getPlanSnapshotLight,
    saveOperationPlanStatus,
    getAppState,
    getAppStateIfChanged,
    getMaterialsForOt,
  };
});
