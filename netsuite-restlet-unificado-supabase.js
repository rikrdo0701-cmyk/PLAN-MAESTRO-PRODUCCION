/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * RESTlet unificado de ingesta NetSuite -> Supabase.
 *
 * Reemplaza a los RESTlets 1762, 1763, 1764, 1765, 1767 con una sola llamada.
 * Usa SuiteQL directo (mas rapido que N/search + record.load).
 *
 * NO escribe en NetSuite: solo lee (SuiteQL SELECT) y devuelve JSON.
 *
 * Uso desde Apps Script:
 *   POST { accion: "workorders" | "operaciones" | "materiales" | "items" |
 *                  "centros" | "inventario" | "ordenes_venta" | "todas" }
 *
 * Respuesta: { ok, accion, headers, rows, totalRows }
 */
define(['N/query'], (query) => {

  function post(body) {
    body = body || {};
    const accion = String(body.accion || 'todas').toLowerCase();

    if (accion === 'todas') {
      const out = {};
      for (const a of ['workorders', 'operaciones', 'materiales', 'items', 'centros', 'inventario', 'ordenes_venta']) {
        out[a] = ejecutar_(a);
      }
      return { ok: true, acciones: out };
    }
    return ejecutar_(accion);
  }

  function ejecutar_(accion) {
    switch (accion) {
      case 'workorders': return workorders_();
      case 'operaciones': return operaciones_();
      case 'materiales': return materiales_();
      case 'items': return items_();
      case 'centros': return centros_();
      case 'inventario': return inventario_();
      case 'ordenes_venta': return ordenesVenta_();
      default: return { ok: false, error: 'accion no soportada: ' + accion };
    }
  }

  // ===========================================================================
  // 1764 — WO_LISTA: search en transaction + record.load para BOM Revision
  // ===========================================================================
  function workorders_() {
    const sql = [
      'SELECT DISTINCT',
      '  t.id AS wo_internal_id,',
      '  t.tranid AS ot,',
      '  BUILTIN.DF(tl.item) AS articulo,',
      '  COALESCE(i.salesdescription, i.purchasedescription, i.displayname) AS descripcion,',
      '  ABS(NVL(tl.quantity, 0)) AS cantidad,',
      '  BUILTIN.DF(t.status) AS estatus,',
      '  BUILTIN.DF(t.entity) AS cliente,',
      '  t.enddate AS fecha_vencimiento',
      'FROM transaction t',
      "JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'",
      'LEFT JOIN item i ON i.id = tl.item',
      "WHERE t.type = 'WorkOrd'",
      "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CERRAD%'",
      "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CLOSED%'",
      "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%COMPLET%'",
      'ORDER BY t.tranid'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['wo_internal_id', 'ot', 'articulo', 'descripcion', 'cantidad', 'estatus', 'cliente', 'fecha_vencimiento'],
      rows: rows.map(r => ({
        wo_internal_id: String(r.wo_internal_id || ''),
        ot: String(r.ot || ''),
        articulo: String(r.articulo || ''),
        descripcion: String(r.descripcion || ''),
        cantidad: Number(r.cantidad) || 0,
        estatus: String(r.estatus || ''),
        cliente: String(r.cliente || ''),
        fecha_vencimiento: fmtDate_(r.fecha_vencimiento)
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // 1762 — WO_OPERACIONES: SuiteQL en manufacturingoperationtask
  // ===========================================================================
  function operaciones_() {
    const sql = [
      'SELECT',
      '  mot.id AS workorder_id,',
      '  wo.tranid AS workorder_tranid,',
      '  BUILTIN.DF(mot.manufacturingworkcenter) AS operation,',
      '  mot.operationsequence AS sequence,',
      '  mot.inputquantity AS qty_to_process,',
      '  mot.startdatetime AS start_planned,',
      '  mot.enddate AS end_planned,',
      '  mot.status AS status_op,',
      '  mot.manufacturingworkcenter AS workcenter,',
      '  mot.setuptime AS setup_min,',
      '  mot.estimatedwork AS est_min,',
      '  mot.actualwork AS real_min,',
      '  mot.remainingwork AS remaining_min,',
      '  mot.runrate AS production_rate,',
      '  mot.laborresources AS human_resource,',
      '  mot.machineresources AS machine_resource,',
      '  mot.completedquantity AS qty_completed',
      'FROM manufacturingoperationtask mot',
      'JOIN transaction wo ON wo.id = mot.workorder',
      "WHERE wo.type = 'WorkOrd'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
      'ORDER BY wo.id, mot.operationsequence'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['workorder_id', 'workorder_tranid', 'operation', 'sequence', 'qty_to_process', 'status_op', 'workcenter', 'setup_min', 'est_min', 'real_min', 'remaining_min', 'production_rate', 'human_resource', 'machine_resource', 'qty_completed'],
      rows: rows.map(r => ({
        workorder_id: String(r.workorder_id || ''),
        workorder_tranid: String(r.workorder_tranid || ''),
        operation: String(r.operation || ''),
        sequence: Number(r.sequence) || 0,
        qty_to_process: Number(r.qty_to_process) || 0,
        status_op: String(r.status_op || ''),
        workcenter: String(r.workcenter || ''),
        setup_min: Number(r.setup_min) || 0,
        est_min: Number(r.est_min) || 0,
        real_min: Number(r.real_min) || 0,
        remaining_min: Number(r.remaining_min) || 0,
        production_rate: Number(r.production_rate) || 0,
        human_resource: String(r.human_resource || ''),
        machine_resource: String(r.machine_resource || ''),
        qty_completed: Number(r.qty_completed) || 0
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // 1763 — WO_MATERIALES: SuiteQL en transactionline (componentes de BOM)
  // ===========================================================================
  function materiales_() {
    const sql = [
      'SELECT DISTINCT',
      '  wo.id AS wo_internal_id,',
      '  wo.tranid AS ot,',
      '  mainline_item.item AS ensamble_id,',
      '  BUILTIN.DF(mainline_item.item) AS ensamble,',
      '  comp.id AS line_id,',
      '  comp.item AS componente_id,',
      '  BUILTIN.DF(comp.item) AS componente,',
      '  COALESCE(ci.description, ci.purchasedescription, ci.displayname) AS descripcion,',
      '  BUILTIN.DF(comp.units) AS unidad,',
      '  ABS(NVL(comp.quantity, 0)) AS requerido,',
      '  ABS(NVL(comp.quantityshiprecv, 0)) AS emitido',
      'FROM transaction wo',
      "JOIN transactionline mainline_item ON mainline_item.transaction = wo.id AND mainline_item.mainline = 'T'",
      "JOIN transactionline comp ON comp.transaction = wo.id AND comp.mainline = 'F' AND comp.item IS NOT NULL",
      'LEFT JOIN item ci ON ci.id = comp.item',
      "WHERE wo.type = 'WorkOrd'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
      '  AND ABS(NVL(comp.quantity, 0)) > 0',
      'ORDER BY wo.tranid, comp.id'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['wo_internal_id', 'ot', 'ensamble_id', 'ensamble', 'line_id', 'componente_id', 'componente', 'descripcion', 'unidad', 'requerido', 'emitido'],
      rows: rows.map(r => ({
        wo_internal_id: String(r.wo_internal_id || ''),
        ot: String(r.ot || ''),
        ensamble_id: String(r.ensamble_id || ''),
        ensamble: String(r.ensamble || ''),
        line_id: String(r.line_id || ''),
        componente_id: String(r.componente_id || ''),
        componente: String(r.componente || ''),
        descripcion: String(r.descripcion || ''),
        unidad: String(r.unidad || ''),
        requerido: Number(r.requerido) || 0,
        emitido: Number(r.emitido) || 0
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // 1765 — INV_PLANTAS: items con cantidades por ubicacion
  // ===========================================================================
  function items_() {
    const sql = [
      'SELECT',
      '  i.id AS item_id,',
      '  i.itemid AS codigo,',
      '  i.itemtype AS tipo,',
      '  COALESCE(i.salesdescription, i.purchasedescription, i.displayname) AS descripcion,',
      '  i.isinactive AS inactivo,',
      '  i.lastmodifieddate AS ultima_modificacion',
      'FROM item i',
      "WHERE i.itemtype IN ('InvtPart', 'Assembly')",
      'ORDER BY i.itemid'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['item_id', 'codigo', 'tipo', 'descripcion', 'inactivo', 'ultima_modificacion'],
      rows: rows.map(r => ({
        item_id: String(r.item_id || ''),
        codigo: String(r.codigo || ''),
        tipo: String(r.tipo || ''),
        descripcion: String(r.descripcion || ''),
        inactivo: r.inactivo === 'T',
        ultima_modificacion: fmtDate_(r.ultima_modificacion)
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // Centros de trabajo — SuiteQL directo a entitygroup
  // ===========================================================================
  function centros_() {
    const sql = [
      'SELECT',
      '  eg.id AS id,',
      '  eg.groupname AS nombre,',
      '  eg.isinactive AS isinactive',
      'FROM entitygroup eg',
      "WHERE eg.ismanufacturingworkcenter = 'T'",
      'ORDER BY eg.groupname'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['id', 'nombre', 'isinactive'],
      rows: rows.map(r => ({
        id: String(r.id || ''),
        nombre: String(r.nombre || ''),
        isinactive: r.isinactive
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // Inventario — SuiteQL en aggregateitemlocation
  // ===========================================================================
  function inventario_() {
    const sql = [
      'SELECT',
      '  BUILTIN.DF(ail.item) AS item,',
      '  BUILTIN.DF(ail.location) AS ubicacion,',
      '  ail.quantityavailable AS disponible,',
      '  ail.quantityonhand AS fisico,',
      '  ail.quantitycommitted AS comprometido,',
      '  ail.quantityintransit AS en_transito',
      'FROM aggregateitemlocation ail',
      'ORDER BY ail.item, ail.location'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['item', 'ubicacion', 'disponible', 'fisico', 'comprometido', 'en_transito'],
      rows: rows.map(r => ({
        item: String(r.item || ''),
        ubicacion: String(r.ubicacion || ''),
        disponible: Number(r.disponible) || 0,
        fisico: Number(r.fisico) || 0,
        comprometido: Number(r.comprometido) || 0,
        en_transito: Number(r.en_transito) || 0
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // 1767 — SO_EXPORT: search en sales order lines con summaries
  // ===========================================================================
  function ordenesVenta_() {
    const sql = [
      'SELECT',
      '  t.id AS internalid,',
      '  t.datecreated AS fecha_captura,',
      '  t.tranid AS orden,',
      '  BUILTIN.DF(t.entity) AS clave_cliente,',
      '  BUILTIN.DF(t.entity) AS nombre_cliente,',
      '  t.quantity AS cantidad_piezas,',
      '  t.quantity - NVL(t.quantityfulfilled, 0) AS cantidad_pendiente_surtir,',
      '  BUILTIN.DF(t.statusref) AS estado,',
      '  t.shipdate AS fecha_embarque,',
      '  t.memo AS comentarios,',
      '  t.foreigntotal AS monto_pendiente_facturar',
      'FROM transaction t',
      "WHERE t.type = 'SalesOrd'",
      "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CERRAD%'",
      "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CLOSED%'",
      "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%FACTURAD%'",
      'ORDER BY t.tranid'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['internalid', 'fecha_captura', 'orden', 'clave_cliente', 'nombre_cliente', 'cantidad_piezas', 'cantidad_pendiente_surtir', 'estado', 'fecha_embarque', 'comentarios', 'monto_pendiente_facturar'],
      rows: rows.map(r => ({
        internalid: String(r.internalid || ''),
        fecha_captura: fmtDate_(r.fecha_captura),
        orden: String(r.orden || ''),
        clave_cliente: String(r.clave_cliente || ''),
        nombre_cliente: String(r.nombre_cliente || ''),
        cantidad_piezas: Number(r.cantidad_piezas) || 0,
        cantidad_pendiente_surtir: Number(r.cantidad_pendiente_surtir) || 0,
        estado: String(r.estado || ''),
        fecha_embarque: fmtDate_(r.fecha_embarque),
        comentarios: String(r.comentarios || ''),
        monto_pendiente_facturar: Number(r.monto_pendiente_facturar) || 0
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  function runSuiteQL_(sql) {
    const rs = query.runSuiteQL({ query: sql });
    return rs.asMappedResults() || [];
  }

  function fmtDate_(v) {
    if (!v) return '';
    return String(v);
  }

  return { post };
});
