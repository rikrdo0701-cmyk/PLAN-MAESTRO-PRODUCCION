/**
 * Ingesta NetSuite -> Supabase desde Google Apps Script.
 *
 * Llama al endpoint SuiteQL de NetSuite (con OAuth 1.0a) y escribe en Supabase
 * (PostgREST). Se ejecuta cada 15 minutos, lunes a viernes, 7am-5pm.
 *
 * NO escribe en NetSuite: solo lee (SuiteQL SELECT) y escribe en Supabase.
 *
 * Configuracion: las credenciales van como constantes abajo (NS_CONFIG y
 * SUPABASE_CONFIG). Si algun dia hace falta rotarlas, se cambian aqui.
 *
 * Trigger: cada 15 minutos, lun-vie, 7am-5pm (se configura en Apps Script).
 */

// =============================================================================
// Configuracion — NS_* de las Script Properties existentes, SUPABASE_* constantes
// =============================================================================

function PP_config_() {
  const p = PropertiesService.getScriptProperties();
  return {
    accountId: p.getProperty('NS_ACCOUNT_ID'),
    consumerKey: p.getProperty('NS_CONSUMER_KEY'),
    consumerSecret: p.getProperty('NS_CONSUMER_SECRET'),
    token: p.getProperty('NS_TOKEN'),
    tokenSecret: p.getProperty('NS_TOKEN_SECRET'),
    supabaseUrl: SUPABASE_URL,
    supabaseKey: SUPABASE_KEY,
    ubicacion: UBICACION
  };
}

// =============================================================================
// OAuth 1.0a (mismo algoritmo que ya funciona en 08-netsuite.js)
// =============================================================================

function PP_oauthHeader_(method, endpoint, query, config) {
  const oauth = {
    oauth_consumer_key: config.consumerKey,
    oauth_token: config.token,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_nonce: Utilities.getUuid().replace(/-/g, ''),
    oauth_version: '1.0'
  };
  const signing = Object.assign({}, oauth, query || {});
  const parameterString = Object.keys(signing).sort().map(function(key) {
    return PP_oauthEncode_(key) + '=' + PP_oauthEncode_(signing[key]);
  }).join('&');
  const baseString = [method.toUpperCase(), PP_oauthEncode_(endpoint), PP_oauthEncode_(parameterString)].join('&');
  const signingKey = PP_oauthEncode_(config.consumerSecret) + '&' + PP_oauthEncode_(config.tokenSecret);
  const signature = Utilities.base64Encode(Utilities.computeHmacSha256Signature(baseString, signingKey));
  const params = Object.assign({}, oauth, { oauth_signature: signature });
  return 'OAuth realm="' + PP_oauthEncode_(config.accountId) + '",' + Object.keys(params).map(function(key) {
    return PP_oauthEncode_(key) + '="' + PP_oauthEncode_(params[key]) + '"';
  }).join(',');
}

function PP_oauthEncode_(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, function(char) {
    return '%' + char.charCodeAt(0).toString(16).toUpperCase();
  });
}

// =============================================================================
// SuiteQL
// =============================================================================

function PP_suiteql_(sql, config) {
  const endpoint = 'https://' + config.accountId.toLowerCase() + '.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
  const query = { limit: 1000, offset: 0 };
  const url = endpoint + '?' + Object.keys(query).map(function(key) {
    return PP_oauthEncode_(key) + '=' + PP_oauthEncode_(query[key]);
  }).join('&');
  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': PP_oauthHeader_('POST', endpoint, query, config),
      'Prefer': 'transient'
    },
    payload: JSON.stringify({ q: sql }),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('SuiteQL ' + res.getResponseCode() + ': ' + JSON.stringify(json).slice(0, 300));
  }
  return json.items || [];
}

// =============================================================================
// Supabase (PostgREST)
// =============================================================================

function PP_supabaseUpsert_(tabla, filas, clave, config) {
  if (!filas.length) return { escritas: 0 };
  const url = config.supabaseUrl + '/rest/v1/' + tabla + '?on_conflict=' + clave;
  const res = UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': config.supabaseKey,
      'Authorization': 'Bearer ' + config.supabaseKey,
      'Prefer': 'resolution=merge-duplicates'
    },
    payload: JSON.stringify(filas),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('Supabase ' + tabla + ' ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return { escritas: filas.length };
}

// =============================================================================
// Lectores (misma logica que el RESTlet, verificada contra el ERP real)
// =============================================================================

function leerWorkorders_(config) {
  const sql = [
    'SELECT DISTINCT',
    '  t.id AS wo_internal_id,',
    '  t.tranid AS ot,',
    '  BUILTIN.DF(tl.item) AS articulo,',
    '  COALESCE(i.description, i.purchasedescription, i.displayname) AS descripcion,',
    '  ABS(NVL(tl.quantity, 0)) AS cantidad,',
    '  BUILTIN.DF(t.status) AS estatus,',
    '  BUILTIN.DF(t.entity) AS cliente,',
    '  t.startdate AS fecha_inicio,',
    '  t.enddate AS fecha_fin',
    'FROM transaction t',
    "JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'",
    'LEFT JOIN item i ON i.id = tl.item',
    "WHERE t.type = 'WorkOrd'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CERRAD%'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CLOSED%'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%COMPLET%'",
    'ORDER BY t.tranid'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    return {
      ot: String(r.ot || ''),
      wo_internal_id: String(r.wo_internal_id || ''),
      articulo: String(r.articulo || ''),
      descripcion: String(r.descripcion || ''),
      cantidad: Math.abs(Number(r.cantidad) || 0),
      estatus: String(r.estatus || ''),
      cliente: String(r.cliente || '')
    };
  });
}

function leerOperaciones_(config) {
  const sql = [
    'SELECT',
    '  mot.id, wo.tranid, mot.operationsequence, mot.manufacturingworkcenter,',
    '  BUILTIN.DF(mot.manufacturingworkcenter), mot.inputquantity,',
    '  NVL(mot.completedquantity, 0), mot.setuptime, NVL(mot.runrate, 0),',
    '  mot.status, mot.startdatetime, mot.enddate',
    'FROM manufacturingoperationtask mot',
    'JOIN transaction wo ON wo.id = mot.workorder',
    "WHERE wo.type = 'WorkOrd'",
    "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
    "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
    "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
    'ORDER BY wo.id, mot.operationsequence, mot.id'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    const total = Math.abs(Number(r.inputquantity) || 0);
    const realizada = Math.abs(Number(r.completedquantity) || 0);
    return {
      operation_id: 'ns-' + String(r.id),
      ot: String(r.tranid || ''),
      secuencia: Number(r.operationsequence) || 0,
      ct: String(r.manufacturingworkcenter || ''),
      descripcion: String(r.BUILTIN_DF_mot_manufacturingworkcenter || ''),
      cant_total: Math.round(total),
      cant_pendiente: Math.round(Math.max(0, total - realizada)),
      estatus: traducirEstado_(r.status),
      fecha_inicio: r.startdatetime || null,
      fecha_fin: r.enddate || null
    };
  });
}

function leerMateriales_(config) {
  const sql = [
    'SELECT',
    '  wo.id, wo.tranid, mainline_item.item, BUILTIN.DF(mainline_item.item),',
    '  comp.id, comp.item, BUILTIN.DF(comp.item),',
    '  COALESCE(ci.description, ci.purchasedescription, ci.displayname),',
    '  BUILTIN.DF(comp.units), ABS(NVL(comp.quantity, 0)), ABS(NVL(comp.quantityshiprecv, 0))',
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
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    const requerido = Math.abs(Number(r.ABS_NVL_comp_quantity_0) || 0);
    const emitido = Math.abs(Number(r.ABS_NVL_comp_quantityshiprecv_0) || 0);
    return {
      line_id: String(r.comp_id || ''),
      ot: String(r.tranid || ''),
      wo_internal_id: String(r.wo_id || ''),
      ensamble: String(r.BUILTIN_DF_mainline_item_item || ''),
      componente_id: String(r.comp_item || ''),
      componente: String(r.BUILTIN_DF_comp_item || ''),
      descripcion: String(r.COALESCE_ci_description_ci_purchasedescription_ci_displayname || ''),
      unidad: String(r.BUILTIN_DF_comp_units || ''),
      requerido: Math.round(requerido),
      emitido: Math.round(emitido),
      pendiente: Math.round(Math.max(0, requerido - emitido))
    };
  });
}

function leerItems_(config) {
  const sql = [
    'SELECT',
    '  i.id, i.itemid, i.displayname, i.description, i.purchasedescription,',
    '  i.itemtype, i.isinactive, i.lastmodifieddate',
    'FROM item i',
    'ORDER BY i.itemid'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    return {
      codigo: String(r.itemid || ''),
      descripcion: String(r.description || ''),
      descripcion_compra: String(r.purchasedescription || ''),
      nombre_mostrado: String(r.displayname || ''),
      tipo: String(r.itemtype || ''),
      es_ensamblaje: r.itemtype === 'Assembly',
      inactivo: r.isinactive === 'T',
      ultima_modificacion: isoFecha_(r.lastmodifieddate)
    };
  });
}

function leerCentros_(config) {
  const sql = [
    'SELECT',
    '  eg.id, eg.groupname, eg.isinactive',
    'FROM entitygroup eg',
    "WHERE eg.ismanufacturingworkcenter = 'T'",
    'ORDER BY eg.groupname'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    return {
      nombre: String(r.groupname || ''),
      activa: r.isinactive !== 'T'
    };
  });
}

function leerInventario_(config) {
  const sql = [
    'SELECT',
    '  ail.item, BUILTIN.DF(ail.item), ail.location, BUILTIN.DF(ail.location),',
    '  ail.quantityavailable, ail.quantityonhand, ail.quantitycommitted, ail.quantityintransit',
    'FROM aggregateitemlocation ail',
    'ORDER BY ail.item, ail.location'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    return {
      item: String(r.BUILTIN_DF_ail_item || ''),
      ubicacion: String(r.BUILTIN_DF_ail_location || ''),
      disponible: Number(r.quantityavailable) || 0,
      fisico: Number(r.quantityonhand) || 0,
      comprometido: Number(r.quantitycommitted) || 0,
      pickeado: 0,
      en_transito: Number(r.quantityintransit) || 0
    };
  });
}

function leerOrdenesVenta_(config) {
  const sql = [
    'SELECT',
    '  t.id, t.tranid, BUILTIN.DF(t.entity), t.entity, t.trandate,',
    '  BUILTIN.DF(t.status), BUILTIN.DF(t.approvalstatus), t.foreigntotal, t.currency, NVL(t.memo, \'\')',
    'FROM transaction t',
    "WHERE t.type = 'SalesOrd'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CERRAD%'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CLOSED%'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%FACTURAD%'",
    'ORDER BY t.tranid'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    return {
      folio: String(r.tranid || ''),
      sales_order_id: String(r.id || ''),
      cliente: String(r.BUILTIN_DF_t_entity || ''),
      cliente_id: Number(r.entity) || 0,
      fecha: isoFecha_(r.trandate),
      estatus: String(r.BUILTIN_DF_t_status || ''),
      aprobacion: String(r.BUILTIN_DF_t_approvalstatus || ''),
      total: Number(r.foreigntotal) || 0,
      moneda: Number(r.currency) || 0,
      memo: String(r.memo || ''),
      lineas: []
    };
  });
}

function traducirEstado_(crudo) {
  const mapa = {
    'NOTSTART': 'No iniciado',
    'PROGRESS': 'En proceso',
    'INPROCESS': 'En proceso',
    'COMPLETE': 'Completado',
    'COMPLETED': 'Completado',
    'CLOSED': 'Cerrado'
  };
  return mapa[crudo] || crudo;
}

/** NetSuite devuelve fechas como dd/MM/yyyy o dd/MM/yyyy HH:mm:ss. Supabase espera ISO yyyy-MM-dd. */
function isoFecha_(crudo) {
  if (!crudo) return null;
  const s = String(crudo).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return s;
}

/** Deduplica filas por clave natural (materiales e inventario vienen repetidos). */
function deduplicar_(filas, claveFn) {
  const vistos = {};
  const out = [];
  filas.forEach(function(f) {
    const k = claveFn(f);
    if (vistos[k]) return;
    vistos[k] = true;
    out.push(f);
  });
  return out;
}

// =============================================================================
// Punto de entrada
// =============================================================================

function ingesta() {
  console.log('=== INGESTA START ===');
  const config = PP_config_();
  console.log('Config OK. Account: ' + config.accountId);
  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours();
  console.log('Hora: ' + ahora.toISOString() + ' (dia=' + dia + ', hora=' + hora + ')');
  if (dia === 0 || dia === 6 || hora < 7 || hora >= 17) {
    console.log('Fuera de horario laboral. Saliendo.');
    return;
  }

  const acciones = [
    { nombre: 'workorders', tabla: 'work_orders', clave: 'ot', lector: leerWorkorders_ },
    { nombre: 'operaciones', tabla: 'operations', clave: 'operation_id', lector: leerOperaciones_ },
    { nombre: 'materiales', tabla: 'materials', clave: 'line_id', lector: leerMateriales_ },
    { nombre: 'items', tabla: 'items', clave: 'codigo', lector: leerItems_ },
    { nombre: 'centros', tabla: 'machines', clave: 'nombre', lector: leerCentros_ },
    { nombre: 'inventario', tabla: 'inventory', clave: 'item,ubicacion', lector: leerInventario_ },
    { nombre: 'ordenes_venta', tabla: 'sales_orders', clave: 'folio', lector: leerOrdenesVenta_ }
  ];

  const log = [];
  acciones.forEach(function(a) {
    try {
      console.log('Leyendo ' + a.nombre + '...');
      let filas = a.lector(config);
      console.log(a.nombre + ': ' + filas.length + ' filas leidas');
      if (filas.length) {
        console.log(a.nombre + ': columnas = ' + Object.keys(filas[0]).join(', '));
        console.log(a.nombre + ': muestra = ' + JSON.stringify(filas[0]).slice(0, 300));
      }
      if (a.nombre === 'materiales') filas = deduplicar_(filas, function(f) { return f.line_id; });
      if (a.nombre === 'inventario') filas = deduplicar_(filas, function(f) { return f.item + '#' + f.ubicacion; });
      if (a.nombre === 'items') filas = deduplicar_(filas, function(f) { return f.codigo; });
      if (filas.length !== a.lector(config).length) {
        console.log(a.nombre + ': deduplicacion ' + a.lector(config).length + ' -> ' + filas.length);
      }
      const r = PP_supabaseUpsert_(a.tabla, filas, a.clave, config);
      log.push(a.nombre + ': ' + r.escritas + ' filas');
      console.log(a.nombre + ': ' + r.escritas + ' escritas');
    } catch (e) {
      log.push(a.nombre + ': ERROR ' + String(e.message || e).slice(0, 100));
      console.log(a.nombre + ': ERROR ' + String(e.message || e).slice(0, 200));
    }
  });
  console.log('Ingesta: ' + log.join(' | '));
  console.log('=== INGESTA END ===');
}

// =============================================================================
// Trigger (se configura en Apps Script: Edit > Triggers > Add Trigger)
//   Function: ingesta
//   Event source: Time-driven
//   Type: Minutes timer
//   Interval: Every 15 minutes
// =============================================================================
