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
      // La descripcion real del producto vive en item.description (279/282 OTs abiertas
      // la tienen; purchasedescription solo 2, medido 2026-09-29). Antes solo se leia
      // purchasedescription y casi siempre caia al displayname (= el codigo, incorrecto).
      '  COALESCE(i.description, i.purchasedescription, i.displayname, i.itemid) AS descripcion,',
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
      // Solo la planta 1 (Planta MM del Llano). La ubicacion de la OT vive en la linea
      // mainline (transactionline.location); 74 de 282 OTs abiertas son de la planta 2
      // (V.Guerrero) y el app solo trabaja la 1 (decision del usuario 2026-09-29).
      '  AND tl.location = 1',
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
        fecha_vencimiento: isoFecha_(r.fecha_vencimiento)
      })),
      totalRows: rows.length
    };
  }

  // ===========================================================================
  // 1762 — WO_OPERACIONES: SuiteQL en manufacturingoperationtask
  // ===========================================================================
  function operaciones_() {
    // Replica EXACTO el payload del sync original verificado (netsuite-restlet-supabase-sync.js
    // leerOperaciones): las columnas son las de la tabla `operations` desplegada (medido con
    // information_schema el 2026-09-28): operation_id='ns-<mot.id>' es la UNIQUE; `ct` es el id
    // interno del centro (mot.manufacturingworkcenter), lo que el app llama 'Centro de trabajo';
    // `descripcion` es BUILTIN.DF(mot.manufacturingworkcenter) (lo que el app llama Operacion);
    // `cant_pendiente` = inputquantity - completedquantity; `tiempo_prod` usa la MISMA formula
    // del app: runrate x pendiente, o el trabajo restante, o el estimado; `tiempo_ciclo` =
    // tiempo_prod / cant_pendiente; `estatus` traduce mot.status al vocabulario del app.
    const sql = [
      'SELECT',
      '  mot.id AS workorder_id,',
      '  wo.tranid AS workorder_tranid,',
      '  mot.operationsequence AS sequence,',
      '  mot.manufacturingworkcenter AS ct_id,',
      '  BUILTIN.DF(mot.manufacturingworkcenter) AS ct_nombre,',
      "  NVL(mot.title, '') AS titulo,",
      '  mot.inputquantity AS cant_total,',
      '  NVL(mot.completedquantity, 0) AS cant_realizada,',
      '  mot.setuptime AS setup_min,',
      '  NVL(mot.runrate, 0) AS runrate,',
      '  NVL(mot.remainingwork, 0) AS restante,',
      '  NVL(mot.estimatedwork, 0) AS estimado,',
      '  mot.status AS status_op,',
      "  NVL(mot.laborresources, '') AS operador,",
      "  NVL(mot.machineresources, '') AS maquina,",
      '  mot.startdatetime AS start_planned,',
      '  mot.enddate AS end_planned',
      'FROM manufacturingoperationtask mot',
      'JOIN transaction wo ON wo.id = mot.workorder',
      "WHERE wo.type = 'WorkOrd'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
      // Mismo filtro de planta que workorders_: la OT es de la planta 1 si la linea
      // mainline tiene location=1 (medido 2026-09-29: 72 OTs con operaciones son de la
      // planta 2). EXISTS evita duplicar si hubiera mas de una mainline.
      "  AND EXISTS (SELECT 1 FROM transactionline tl WHERE tl.transaction = wo.id AND tl.mainline = 'T' AND tl.location = 1)",
      'ORDER BY wo.id, mot.operationsequence, mot.id'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['operation_id', 'ot', 'secuencia', 'ct', 'descripcion', 'operador', 'maquina', 'cant_total', 'cant_pendiente', 'tiempo_ciclo', 'tiempo_setup', 'tiempo_prod', 'fecha_inicio', 'fecha_fin', 'tipo_insercion', 'estatus', 'locked', 'auto_frozen', 'subcontract_type', 'subcontract_days'],
      rows: rows.map(r => {
        const cantTotal = Math.abs(Number(r.cant_total) || 0);
        const realizada = Math.abs(Number(r.cant_realizada) || 0);
        const pendiente = Math.max(0, cantTotal - realizada);
        const tasa = Math.max(0, Number(r.runrate) || 0);
        const restante = Math.max(0, Number(r.restante) || 0);
        const estimado = Math.max(0, Number(r.estimado) || 0);
        const produccion = pendiente > 0 && tasa > 0 ? Math.round(tasa * pendiente * 100) / 100 : (restante || estimado || 0);
        return {
          operation_id: 'ns-' + String(r.workorder_id || ''),
          ot: String(r.workorder_tranid || ''),
          secuencia: Math.round(Number(r.sequence) || 0),
          ct: extraerCt_(r.ct_nombre, r.ct_id),
          descripcion: String(r.ct_nombre || '') || String(r.titulo || ''),
          operador: String(r.operador || ''),
          maquina: String(r.maquina || ''),
          cant_total: Math.round(cantTotal),
          cant_pendiente: Math.round(pendiente),
          tiempo_ciclo: pendiente > 0 && produccion > 0 ? Math.round((produccion / pendiente) * 100) / 100 : 0,
          tiempo_setup: Math.max(0, Number(r.setup_min) || 0),
          tiempo_prod: produccion,
          fecha_inicio: isoFechaHora_(r.start_planned),
          fecha_fin: isoFechaHora_(r.end_planned),
          tipo_insercion: 'OPERACION',
          estatus: traducirEstado_(r.status_op),
          locked: false,
          auto_frozen: false,
          // NetSuite no trae el tipo/dias de subcontrato de la app: son decision de planeacion
          // (RULE-MAT-005, RULE-SUBC-001). No se inventan.
          subcontract_type: '',
          subcontract_days: 0
        };
      }),
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
      // El item dummy "Costo 0 manufactura" es un componente de costo, no un material
      // real: se excluye para que no ensucie BOMs (medido 2026-09-29: 1930 de 2376
      // filas de materials eran ese componente, en 230 OTs).
      "  AND UPPER(BUILTIN.DF(comp.item)) <> 'COSTO 0 MANUFACTURA'",
      // Mismo filtro de planta que workorders_: la ubicacion de la OT vive en la
      // mainline (decision del usuario 2026-09-29: solo planta 1).
      '  AND mainline_item.location = 1',
      'ORDER BY wo.tranid, comp.id'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['wo_internal_id', 'ot', 'ensamble_id', 'ensamble', 'line_id', 'componente_id', 'componente', 'descripcion', 'unidad', 'requerido', 'emitido'],
      rows: rows.map(r => ({
        wo_internal_id: String(r.wo_internal_id || ''),
        ot: String(r.ot || ''),
        ensamble: String(r.ensamble || ''),
        line_id: String(r.line_id || ''),
        componente_id: String(r.componente_id || ''),
        componente: String(r.componente || ''),
        descripcion: String(r.descripcion || ''),
        unidad: String(r.unidad || ''),
        requerido: Math.round(Number(r.requerido) || 0),
        emitido: Math.round(Number(r.emitido) || 0)
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
      // Mismo fix que workorders_ (2026-09-29): la descripcion real del producto esta en
      // i.description; purchasedescription esta vacia en casi todos (2/282 en OTs abiertas)
      // y antes la mayoria caia al displayname (= codigo).
      '  COALESCE(i.description, i.purchasedescription, i.displayname, i.itemid) AS descripcion,',
      '  i.isinactive AS inactivo,',
      '  i.lastmodifieddate AS ultima_modificacion',
      'FROM item i',
      "WHERE i.itemtype IN ('InvtPart', 'Assembly', 'NonInvtPart', 'Service', 'OthCharge', 'Kit')",
      'ORDER BY i.itemid'
    ].join('\n');
    const rows = runSuiteQL_(sql);
    return {
      ok: true,
      headers: ['item_id', 'codigo', 'tipo', 'descripcion', 'inactivo', 'ultima_modificacion'],
      rows: rows.map(r => ({
        codigo: String(r.codigo || ''),
        tipo: String(r.tipo || ''),
        descripcion: String(r.descripcion || ''),
        inactivo: r.inactivo === 'T',
        ultima_modificacion: isoFecha_(r.ultima_modificacion)
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
        nombre: String(r.nombre || ''),
        activa: r.isinactive !== 'T'
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
      // Misma decision de planta que workorders/operaciones/materiales (RULE-SUP-013):
      // solo la ubicacion 1 (Planta MM del Llano). Verificado: de 2401 pares item/location,
      // 2426 total en la corrida anterior; aqui el filtro deja solo la planta 1.
      "WHERE ail.location = 1",
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
      '  t.trandate AS fecha_captura,',
      '  t.tranid AS orden,',
      '  BUILTIN.DF(t.entity) AS clave_cliente,',
      '  BUILTIN.DF(t.entity) AS nombre_cliente,',
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
      headers: ['internalid', 'fecha_captura', 'orden', 'clave_cliente', 'nombre_cliente', 'fecha_embarque', 'comentarios', 'monto_pendiente_facturar'],
      rows: rows.map(r => ({
        sales_order_id: String(r.internalid || ''),
        fecha: isoFecha_(r.fecha_captura),
        folio: String(r.orden || ''),
        cliente: String(r.nombre_cliente || ''),
        cliente_id: 0,
        estatus: '',
        aprobacion: '',
        total: Number(r.monto_pendiente_facturar) || 0,
        moneda: 1,
        memo: String(r.comentarios || '')
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

  function isoFecha_(crudo) {
    if (!crudo) return '';
    const s = String(crudo).trim();
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[2] + '-' + m[1];
    return s;
  }

  // dd/MM/aaaa [HH:mm[:ss] [AM|PM]] -> ISO con hora en UTC (mismo criterio que isoFechaNetsuite
  // del sync original: NetSuite manda las fechas-hora sin zona).
  function isoFechaHora_(valor) {
    if (valor == null || valor === '') return null;
    const texto = String(valor).trim();
    if (!texto) return null;
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?)?$/.exec(texto);
    if (m) {
      const dia = parseInt(m[1], 10), mes = parseInt(m[2], 10), anio = parseInt(m[3], 10);
      if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return texto;
      let hh = m[4] ? parseInt(m[4], 10) : 0;
      const mi = m[5] ? parseInt(m[5], 10) : 0;
      const ss = m[6] ? parseInt(m[6], 10) : 0;
      if (m[7]) {
        const am = m[7].toLowerCase().charAt(0) === 'a';
        if (hh === 12) hh = 0;
        if (!am) hh += 12;
      }
      const d = new Date(Date.UTC(anio, mes - 1, dia, hh, mi, ss));
      if (Number.isNaN(d.getTime())) return texto;
      // Date.UTC normaliza el dia 31 de un mes corto rodandolo; se avisa con el texto crudo.
      if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return texto;
      return d.toISOString();
    }
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(texto);
    if (iso) {
      const d2 = new Date(Date.UTC(
        parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10),
        iso[4] ? parseInt(iso[4], 10) : 0,
        iso[5] ? parseInt(iso[5], 10) : 0,
        iso[6] ? parseInt(iso[6], 10) : 0
      ));
      if (!Number.isNaN(d2.getTime())) return d2.toISOString();
    }
    return texto;
  }

  // Mismo vocabulario que el 1762/sync original (medido: solo existen NOTSTART, PROGRESS, COMPLETE).
  function traducirEstado_(valor) {
    const s = String(valor == null ? '' : valor).trim();
    if (s === 'NOTSTART') return 'No iniciado';
    if (s === 'PROGRESS' || s === 'INPROCESS') return 'En proceso';
    if (s === 'COMPLETE' || s === 'COMPLETED') return 'Completado';
    if (s === 'CLOSED') return 'Cerrado';
    return s;
  }

  // El `ct` es el id interno del centro (mot.manufacturingworkcenter); el nombre es el fallback
  // tal como hacia el sync original (extraerCt de netsuite-restlet-supabase-sync.js:522).
  function extraerCt_(nombre, idInterno) {
    const crudo = String(idInterno == null ? '' : idInterno).trim();
    if (crudo) return crudo;
    const texto = String(nombre || '').trim();
    const conPrefijo = texto.match(/(?:^|\b)CT[\s:_-]*(\d{3,})\b/i);
    if (conPrefijo) return String(conPrefijo[1]);
    const digitos = texto.match(/\b(\d{3,})\b/);
    if (digitos) return String(digitos[1]);
    return texto;
  }

  return { post };
});
