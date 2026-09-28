/**
 * Ingesta NetSuite -> Supabase desde Google Apps Script.
 *
 * Llama al endpoint SuiteQL de NetSuite (con OAuth 1.0a) y escribe en Supabase
 * (PostgREST). Se ejecuta cada 15 minutos, lunes a viernes, 7am-5pm.
 *
 * NO escribe en NetSuite: solo lee (SuiteQL SELECT) y escribe en Supabase.
 *
 * Configuracion: una Hoja de calculo llamada 'CONFIG' con dos columnas (key, value):
 *   NS_ACCOUNT_ID, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN, NS_TOKEN_SECRET,
 *   SUPABASE_URL, SUPABASE_KEY, UBICACION
 *
 * Trigger: cada 15 minutos, lun-vie, 7am-5pm (se configura en Apps Script).
 */

// =============================================================================
// Configuracion — lee de una Hoja de calculo (sin limite de 50 properties)
// =============================================================================

function PP_config_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('CONFIG');
  if (!sheet) throw new Error('No existe la hoja CONFIG. Creala con columnas key,value.');
  const rows = sheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < rows.length; i++) {
    const key = String(rows[i][0] || '').trim();
    const value = String(rows[i][1] || '').trim();
    if (key) config[key] = value;
  }
  if (!config.NS_ACCOUNT_ID || !config.SUPABASE_URL) {
    throw new Error('La hoja CONFIG no tiene NS_ACCOUNT_ID o SUPABASE_URL');
  }
  return {
    accountId: config.NS_ACCOUNT_ID,
    consumerKey: config.NS_CONSUMER_KEY,
    consumerSecret: config.NS_CONSUMER_SECRET,
    token: config.NS_TOKEN,
    tokenSecret: config.NS_TOKEN_SECRET,
    supabaseUrl: config.SUPABASE_URL,
    supabaseKey: config.SUPABASE_KEY,
    ubicacion: config.UBICACION || '1'
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
    headers: { 'Content-Type': 'application/json', Authorization: PP_oauthHeader_('POST', endpoint, query, config) },
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
    'SELECT',
    '  t.id, t.tranid, t.entity, t.status, t.trandate, t.custbody_ubicacion,',
    '  t.cantidad, t.cantidad_ensamblada, t.descripcion',
    'FROM transaction t',
    "WHERE t.type = 'WorkOrd'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CERRAD%'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%CLOSED%'",
    "  AND UPPER(BUILTIN.DF(t.status)) NOT LIKE '%COMPLET%'",
    'ORDER BY t.tranid'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  return crudas.map(function(r) {
    return {
      ot: String(r.tranid || ''),
      folio: String(r.tranid || ''),
      cliente: String(r.entity || ''),
      estatus: String(r.status || ''),
      fecha: r.trandate || null,
      cantidad: Number(r.cantidad) || 0,
      cant_ensamblada: Number(r.cantidad_ensamblada) || 0,
      descripcion: String(r.descripcion || '')
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
      ultima_modificacion: r.lastmodifieddate || null
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
      fecha: r.trandate || null,
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

// =============================================================================
// Punto de entrada
// =============================================================================

function PP_ingesta_() {
  const config = PP_config_();
  const ahora = new Date();
  const dia = ahora.getDay();
  const hora = ahora.getHours();
  if (dia === 0 || dia === 6 || hora < 7 || hora >= 17) {
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
      const filas = a.lector(config);
      const r = PP_supabaseUpsert_(a.tabla, filas, a.clave, config);
      log.push(a.nombre + ': ' + r.escritas + ' filas');
    } catch (e) {
      log.push(a.nombre + ': ERROR ' + String(e.message || e).slice(0, 100));
    }
  });
  console.log('Ingesta: ' + log.join(' | '));
}

// =============================================================================
// Trigger (se configura en Apps Script: Edit > Triggers > Add Trigger)
//   Function: PP_ingesta_
//   Event source: Time-driven
//   Type: Minutes timer
//   Interval: Every 15 minutes
// =============================================================================
