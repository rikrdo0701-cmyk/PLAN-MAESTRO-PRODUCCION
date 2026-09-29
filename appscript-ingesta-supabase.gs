/**
 * Ingesta NetSuite -> Supabase desde Google Apps Script.
 *
 * Llama al RESTlet unificado (2246) que devuelve todas las acciones en una
 * sola llamada HTTP. SuiteQL directo, sin N/search ni record.load.
 *
 * NO escribe en NetSuite: solo lee y escribe en Supabase.
 *
 * MIRROR EXACTO: cada corrida BORRA cada tabla completa y reescribe lo que
 * devuelve NetSuite, para que no queden filas de corridas anteriores.
 *
 * Trigger: cada 15 minutos, lun-vie, 7am-5pm.
 */

const RESTLET_URL = 'https://11103874.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
const RESTLET_SCRIPT = '2246';
const RESTLET_DEPLOY = '1';

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
// Llamada al RESTlet unificado
// =============================================================================

function PP_restletUnificado_(accion, config) {
  const endpoint = RESTLET_URL;
  const query = { script: RESTLET_SCRIPT, deploy: RESTLET_DEPLOY };
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
    payload: JSON.stringify({ accion: accion }),
    muteHttpExceptions: true
  });
  const json = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('RESTlet ' + res.getResponseCode() + ': ' + JSON.stringify(json).slice(0, 300));
  }
  return json;
}

// =============================================================================
// Supabase (PostgREST)
// =============================================================================

function PP_supabaseBorrar_(tabla, config) {
  // Borra TODAS las filas de la tabla (full refresh): la ingesta ahora reescribe
  // cada tabla desde cero para que no queden datos antiguos de corridas previas.
  // El filtro id=neq.<uuid-vacio> es una tautologia que PostgREST acepta para
  // borrar todo, incluso si la tabla ya esta vacia.
  const url = config.supabaseUrl + '/rest/v1/' + tabla + '?id=neq.00000000-0000-0000-0000-000000000000';
  const res = UrlFetchApp.fetch(url, {
    method: 'DELETE',
    headers: {
      'apikey': config.supabaseKey,
      'Authorization': 'Bearer ' + config.supabaseKey,
      'Prefer': 'count=none'
    },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200 && code !== 204) {
    throw new Error('Supabase borrar ' + tabla + ' ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  return true;
}

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

  // Una sola llamada al RESTlet unificado
  console.log('Llamando al RESTlet unificado (2246)...');
  const respuesta = PP_restletUnificado_('todas', config);
  if (!respuesta.ok) {
    throw new Error('RESTlet no ok: ' + JSON.stringify(respuesta).slice(0, 300));
  }

  const acciones = respuesta.acciones;
  const log = [];

  // Mapeo de accion -> tabla, clave natural, y funcion de transformacion
  const TABLAS = {
    workorders: { tabla: 'work_orders', clave: 'ot' },
    operaciones: { tabla: 'operations', clave: 'operation_id' },
    // materials: la identidad es (ot, line_id). comp.id de NetSuite es el numero de
    // linea DENTRO de la OT y se repite entre OTs (medido 2026-09-29): con line_id
    // solo el upsert y el dedupe descartaban materiales de otras OTs.
    materiales: { tabla: 'materials', clave: 'ot,line_id' },
    items: { tabla: 'items', clave: 'codigo' },
    centros: { tabla: 'machines', clave: 'nombre' },
    inventario: { tabla: 'inventory', clave: 'item,ubicacion' },
    ordenes_venta: { tabla: 'sales_orders', clave: 'folio' }
  };

  for (const nombre in TABLAS) {
    try {
      const accion = acciones[nombre];
      if (!accion || !accion.ok) {
        log.push(nombre + ': ERROR ' + JSON.stringify(accion).slice(0, 100));
        console.log(nombre + ': ERROR ' + JSON.stringify(accion).slice(0, 200));
        continue;
      }
      let filas = accion.rows || [];
      console.log(nombre + ': ' + filas.length + ' filas recibidas');
      if (filas.length) {
        console.log(nombre + ': columnas = ' + Object.keys(filas[0]).join(', '));
        console.log(nombre + ': muestra = ' + JSON.stringify(filas[0]).slice(0, 300));
      }
      // Deduplicar por clave natural
      const def = TABLAS[nombre];
      if (nombre === 'items') filas = deduplicar_(filas, function(f) { return f.codigo; });
      if (nombre === 'materiales') filas = deduplicar_(filas, function(f) { return f.ot + '#' + f.line_id; });
      if (nombre === 'inventario') filas = deduplicar_(filas, function(f) { return f.item + '#' + f.ubicacion; });
      // Mirror exacto de NetSuite: borra la tabla completa y escribe lo nuevo,
      // para que no queden filas de corridas anteriores.
      PP_supabaseBorrar_(def.tabla, config);
      const r = PP_supabaseUpsert_(def.tabla, filas, def.clave, config);
      log.push(nombre + ': ' + r.escritas + ' filas (borrado+reescrito)');
      console.log(nombre + ': ' + r.escritas + ' escritas (tabla reescrita completa)');
    } catch (e) {
      log.push(nombre + ': ERROR ' + String(e.message || e).slice(0, 100));
      console.log(nombre + ': ERROR ' + String(e.message || e).slice(0, 200));
    }
  }
  console.log('Ingesta: ' + log.join(' | '));
  console.log('=== INGESTA END ===');
}
