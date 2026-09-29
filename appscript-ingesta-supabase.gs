/**
 * Ingesta NetSuite -> Supabase desde Google Apps Script.
 *
 * Usa los RESTlets existentes (1762, 1763, 1764, 1765, 1767) con el mapeo
 * correcto basado en el codigo real de cada RESTlet.
 *
 * NO escribe en NetSuite: solo lee y escribe en Supabase.
 *
 * Trigger: cada 15 minutos, lun-vie, 7am-5pm.
 */

const RESTLET_URL = 'https://11103874.restlets.api.netsuite.com/app/site/hosting/restlet.nl';

// =============================================================================
// Configuracion — NS_* de las Script Properties existentes
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
// OAuth 1.0a
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
// Llamada generica a un RESTlet con paginacion
// =============================================================================

function PP_restlet_(script, deploy, body, config) {
  const endpoint = RESTLET_URL;
  const query = { script: script, deploy: deploy };
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
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('RESTlet ' + script + ' ' + res.getResponseCode() + ': ' + JSON.stringify(json).slice(0, 300));
  }
  return json;
}

function PP_restletPaginado_(script, deploy, body, config) {
  const todas = [];
  let pageIndex = 0;
  const pageSize = body.pageSize || 1000;
  while (true) {
    body.pageIndex = pageIndex;
    body.pageSize = pageSize;
    const json = PP_restlet_(script, deploy, body, config);
    const rows = json.rows || json.results || [];
    for (let i = 0; i < rows.length; i++) todas.push(rows[i]);
    if (!json.hasMore) break;
    pageIndex++;
  }
  return todas;
}

// =============================================================================
// SuiteQL (para centros de trabajo — entitygroup)
// =============================================================================

function PP_suiteql_(sql, config) {
  const endpoint = 'https://' + config.accountId.toLowerCase() + '.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
  const todas = [];
  let offset = 0;
  const limite = 1000;
  while (true) {
    const query = { limit: limite, offset: offset };
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
    if (res.getResponseCode() === 404) break;
    const json = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) {
      throw new Error('SuiteQL ' + res.getResponseCode() + ': ' + JSON.stringify(json).slice(0, 300));
    }
    const items = json.items || [];
    for (let i = 0; i < items.length; i++) todas.push(items[i]);
    if (items.length < limite) break;
    offset += limite;
  }
  return todas;
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
// Utilidades
// =============================================================================

function isoFecha_(crudo) {
  if (!crudo) return null;
  const s = String(crudo).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  return s;
}

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
// Lectores — mapeo basado en el codigo real de cada RESTlet
// =============================================================================

// 1764 — WO_LISTA: search en transaction + record.load para BOM Revision
// Headers: WO Internal ID, WO Folio, Artículo, Descripción, Cantidad,
//          Fecha de vencimiento, Estatus, BOM Revision, Revisión, Cliente
function leerWorkorders_(config) {
  const filas = PP_restletPaginado_('1764', '1', { table: 'WO_LISTA', locationId: 1, onlyOpen: true }, config);
  return deduplicar_(filas.map(function(r) {
    return {
      ot: String(r['WO Folio'] || ''),
      wo_internal_id: String(r['WO Internal ID'] || ''),
      articulo: String(r['Artículo'] || ''),
      descripcion: String(r['Descripción'] || ''),
      cantidad: Number(r['Cantidad']) || 0,
      estatus: String(r['Estatus'] || ''),
      cliente: String(r['Cliente'] || '')
    };
  }), function(f) { return f.ot; });
}

// 1762 — WO_OPERACIONES: SuiteQL en manufacturingoperationtask
// Headers: ID (link), Artículo, Operación, Secuencia, Cantidad a procesar,
//          Orden de trabajo, Fecha inicio programada, Fecha fin programada,
//          Estado, Centro de trabajo, Tiempo preparación (min),
//          Tiempo estimado (min), Tiempo real (min), Trabajo restante (min),
//          Tasa producción, Recurso humano, Recurso máquina,
//          Fecha inicio real, Fecha fin real, Cantidad realizada
function leerOperaciones_(config) {
  const filas = PP_restletPaginado_('1762', '17', { pageSize: 280 }, config);
  return deduplicar_(filas.map(function(r) {
    const total = Math.abs(Number(r.qty_to_process) || 0);
    const realizada = Math.abs(Number(r.qty_completed) || 0);
    return {
      operation_id: 'ns-' + String(r.workorder_id || ''),
      ot: String(r.workorder_tranid || ''),
      secuencia: Number(r.sequence) || 0,
      ct: String(r.workcenter || ''),
      descripcion: String(r.operation || ''),
      cant_total: Math.round(total),
      cant_pendiente: Math.round(Math.max(0, total - realizada)),
      estatus: traducirEstado_(r.status_op),
      fecha_inicio: isoFecha_(r.start_actual),
      fecha_fin: isoFecha_(r.end_actual)
    };
  }), function(f) { return f.operation_id; });
}

// 1763 — WO_MATERIALES: search en work orders + record.load para BOM
// Headers: WO Internal ID, WO Folio, Ensamble, Componente ID, Componente,
//          Descripción, Unidad, Requerido, Emitido, Pendiente
function leerMateriales_(config) {
  const filas = PP_restletPaginado_('1763', '14', { locationId: 1, onlyOpen: true, pageSize: 200 }, config);
  return deduplicar_(filas.map(function(r) {
    const requerido = Number(r['Requerido']) || 0;
    const emitido = Number(r['Emitido']) || 0;
    return {
      line_id: String(r['WO Internal ID'] || ''),
      ot: String(r['WO Folio'] || ''),
      wo_internal_id: String(r['WO Internal ID'] || ''),
      ensamble: String(r['Ensamble'] || ''),
      componente_id: String(r['Componente ID'] || ''),
      componente: String(r['Componente'] || ''),
      descripcion: String(r['Descripción'] || ''),
      unidad: String(r['Unidad'] || ''),
      requerido: Math.round(requerido),
      emitido: Math.round(emitido),
      pendiente: Math.round(Math.max(0, requerido - emitido))
    };
  }), function(f) { return f.line_id; });
}

// 1765 — INV_PLANTAS: search en item con cantidades por ubicacion
// Headers: Ubicación, Artículo ID Interno, Artículo, Tipo, Descripción,
//          Físico, Comprometido, Disponible, En orden (OC), En tránsito,
//          WIP, Consumo promedio, Costo unitario, Valor total
function leerItems_(config) {
  const filas = PP_restletPaginado_('1765', '1', { table: 'INV_PLANTAS', locationIds: [1, 2], includeZero: true, includeInactiveItems: false }, config);
  const items = {};
  filas.forEach(function(r) {
    const id = String(r['Artículo ID Interno'] || '').trim();
    if (!id) return;
    items[id] = {
      codigo: String(r['Artículo'] || ''),
      descripcion: String(r['Descripción'] || ''),
      descripcion_compra: String(r['Descripción'] || ''),
      nombre_mostrado: String(r['Artículo'] || ''),
      tipo: String(r['Tipo'] || ''),
      es_ensamblaje: r['Tipo'] === 'Ensamblaje',
      inactivo: false,
      ultima_modificacion: isoFecha_(r['Última modificación'])
    };
  });
  return Object.values(items);
}

// 1765 — INV_PLANTAS (mismo RESTlet, mismas filas)
function leerInventario_(config) {
  const filas = PP_restletPaginado_('1765', '1', { table: 'INV_PLANTAS', locationIds: [1, 2], includeZero: true, includeInactiveItems: false }, config);
  return deduplicar_(filas.map(function(r) {
    return {
      item: String(r['Artículo'] || ''),
      ubicacion: String(r['Ubicación'] || ''),
      disponible: Number(r['Disponible']) || 0,
      fisico: Number(r['Físico']) || 0,
      comprometido: Number(r['Comprometido']) || 0,
      pickeado: 0,
      en_transito: Number(r['En tránsito']) || 0
    };
  }), function(f) { return f.item + '#' + f.ubicacion; });
}

// Centros de trabajo — SuiteQL directo a entitygroup
// (el RESTlet 1765 devuelve articulos, no centros)
function leerCentros_(config) {
  const sql = [
    'SELECT',
    '  eg.id AS id,',
    '  eg.groupname AS nombre,',
    '  eg.isinactive AS isinactive',
    'FROM entitygroup eg',
    "WHERE eg.ismanufacturingworkcenter = 'T'",
    'ORDER BY eg.groupname'
  ].join('\n');
  const crudas = PP_suiteql_(sql, config);
  const centros = {};
  crudas.forEach(function(r) {
    const nombre = String(r.nombre || '').trim();
    if (!nombre) return;
    centros[nombre] = { nombre: nombre, activa: r.isinactive !== 'T' };
  });
  return Object.values(centros);
}

// 1767 — SO_EXPORT: search en sales order lines con summaries
// Results: internalid, fecha_captura, orden, clave_cliente, nombre_cliente,
//          sales_rep, po_num, cantidad_piezas, cantidad_pendiente_surtir,
//          estado, fecha_embarque, direccion_envio, via_envio, comentarios,
//          monto_pendiente_facturar, monto_facturado
function leerOrdenesVenta_(config) {
  const filas = PP_restletPaginado_('1767', '1', {}, config);
  return filas.map(function(r) {
    return {
      folio: String(r.orden || ''),
      sales_order_id: String(r.internalid || ''),
      cliente: String(r.nombre_cliente || ''),
      cliente_id: Number(r.clave_cliente) || 0,
      fecha: isoFecha_(r.fecha_captura),
      estatus: String(r.estado || ''),
      aprobacion: String(r.estado_proceso || ''),
      total: Number(r.monto_pendiente_facturar) || 0,
      moneda: 1,
      memo: String(r.comentarios || ''),
      lineas: []
    };
  });
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
