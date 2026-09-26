/**
 * DIAG_operaciones2240b - verifica en NetSuite que el SQL nuevo del 2240 se EJECUTA, antes de
 * subir el archivo a mano.
 *
 * Por que existe: el 2240 se corrige para (1) paginar con FETCH NEXT/OFFSET en la consulta en
 * vez de recortar en memoria, y (2) filtrar por `tl.location = ?`, que antes se ignoraba. Las
 * dos cosas son RIESGOSAS sin verificar en la cuenta real:
 *   - FETCH NEXT/OFFSET es sintaxis SuiteQL; si el scripting de la cuenta no la acepta, el
 *     listado devuelve 200 {ok:false} y la app se queda sin operaciones.
 *   - `tl.location = ?` con parametro ligado; si la cuenta no acepta parametros, o si la
 *     columna no se llama asi, el filtro puede dejar la lista vacia.
 * Este archivo NO depende del 2240: arma el mismo SQL a mano y lo manda por la API REST de
 * SuiteQL, que es el mismo camino que ya usa en produccion el catalogo maestro
 * (PP_fetchNetSuiteOperationCatalog_, 08-netsuite.js:408).
 *
 * AVISO IMPORTANTE SOBRE EL ALCANCE (corrida del 2026-09-26 07:31): esta sonda dio
 * `HTTP 400 ... Cannot build builtin function, validation failed. Static field is not ...`
 * sobre el SQL SIN paginar, o sea un SQL casi identico al que el 2240 de produccion ejecuta
 * HOY con exito (2400 filas). La conclusion es que el endpoint REST de SuiteQL y el
 * `query.runSuiteQL` que corre DENTRO de NetSuite no aceptan exactamente lo mismo: la sonda
 * NO reproduce el entorno del restlet y su veredicto no es concluyente. Por eso el 2240
 * corregido se subio con un FALLBACK de estrategias (ver la cabecera del restlet): si la
 * cuenta no acepta FETCH NEXT/OFFSET o el filtro por ubicacion devuelve 0 filas, cae al
 * camino viejo en vez de dejar la app sin operaciones. Esta sonda ahora sirve para DIAGNOSTICAR
 * que se degrado, no para autorizar el cambio: se puede correr despues de subir el archivo y
 * revisar en el registro de ejecuciones de NetSuite que estrategia respondio (el restlet lo
 * deja en `debug.estrategia`).
 *
 * NOTA SOBRE LOS PARAMETROS LIGADOS: por REST el endpoint de SuiteQL no acepta `params`, asi
 * que la sonda INTERPOLA el valor de la ubicacion en el texto del SQL (1, un entero que
 * viene de configuracion, no entrada de usuario). El restlet si usa `?` con parametro ligado,
 * que es la forma correcta alli porque corre dentro de NetSuite.
 *
 * COMO CORRERLA: pega este archivo en el editor de Apps Script, guardalo y ejecuta
 * DIAG_operaciones2240b. Pega el registro de ejecucion completo.
 *
 * QUE HACE:
 *   0) Guardia de cuota de urlfetch (una llamada) y, si esta agotada, para ahi.
 *   1) El SQL completo de PRODUCCION (las 21 columnas, sin paginar): es el que el 2240 de hoy
 *      ejecuta bien, asi que si falla aqui el problema es del endpoint REST y no del SQL.
 *   2) Una columna `BUILTIN.DF` por consulta, para aislar cual es la que el endpoint REST
 *      rechaza, y el texto COMPLETO del error (la corrida anterior lo cuto a 300 chars).
 *   3) Con `tl.location = 1`, y el desglose por ubicacion, que confirma si la columna existe.
 */

function PP_DIAG_QUOTA_EXHAUSTED_(error) {
  var text = String((error && error.message) || error || '');
  return /invoked too many times for one day|urlfetch/i.test(text);
}

/**
 * Mismo camino que el catalogo maestro en produccion (PP_fetchNetSuiteOperationCatalog_,
 * 08-netsuite.js:408): POST a la API REST de SuiteQL con OAuth 1.0a, limit en la URL y
 * { q: sql } en el cuerpo. El endpoint no acepta `params` ligados, asi que la ubicacion se
 * interpola en el texto (1 viene de configuracion, no de entrada de usuario); el restlet si
 * usa `?` con parametro ligado porque corre dentro de NetSuite.
 */
function PP_DIAG_SUITEQL_(config, sql) {
  var endpoint = 'https://' + String(config.accountId).toLowerCase() + '.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
  var limit = 1000;
  var query = { limit: limit, offset: 0 };
  var response = UrlFetchApp.fetch(endpoint + '?limit=' + limit + '&offset=0', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: PP_oauthHeader_('POST', endpoint, query, config),
      Prefer: 'transient'
    },
    payload: JSON.stringify({ q: sql }),
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var raw = response.getContentText();
  if (status < 200 || status >= 300) {
    // El texto COMPLETO del error, no recortado: la corrida del 07:31 cortó a 300 caracteres
    // y se perdió la parte que dice que campo es el que no se puede construir.
    var detalle = '';
    try {
      var errorJson = JSON.parse(raw || '{}');
      var detalles = (errorJson['o:errorDetails'] || []);
      detalle = detalles.map(function (item) { return String(item.detail || item); }).join(' || ');
    } catch (parseError) {
      detalle = String(raw);
    }
    throw new Error('HTTP ' + status + ' :: ' + detalle.slice(0, 1200));
  }
  var json;
  try { json = JSON.parse(raw || '{}'); } catch (e) { throw new Error('JSON invalido: ' + String(raw).slice(0, 300)); }
  if (!Array.isArray(json.items)) throw new Error('respuesta sin items: ' + String(raw).slice(0, 300));
  return json.items;
}

/** Una sola columna por consulta, para aislar cual rechaza el endpoint. */
function PP_DIAG_UNA_COLUMNA_(config, columna, alias) {
  return PP_DIAG_SUITEQL_(config, [
    'SELECT ' + columna + ' AS ' + alias,
    'FROM manufacturingoperationtask mot',
    'JOIN transaction wo ON wo.id = mot.workorder',
    'JOIN transactionline tl ON tl.transaction = wo.id',
    " AND tl.mainline = 'T'",
    'WHERE',
    "  UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
    "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
    "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
    'ORDER BY mot.id'
  ].join('\n'));
}

function DIAG_operaciones2240b() {
  var config = PP_netSuiteConfig_();
  var log = function (message) { Logger.log(String(message)); };

  var BASELINE = [
    'SELECT',
    '  mot.id                                    AS id,',
    '  wo.id                                     AS workorder_id,',
    '  wo.tranid                                 AS workorder_tranid,',
    '  BUILTIN.DF(tl.item)                       AS item_name,',
    '  mot.operationsequence                     AS sequence,',
    '  mot.inputquantity                         AS qty_to_process,',
    '  BUILTIN.DF(mot.status)                    AS status_op,',
    '  BUILTIN.DF(mot.manufacturingworkcenter)   AS workcenter,',
    '  mot.estimatedwork                         AS est_min,',
    '  tl.location                               AS location',
    'FROM manufacturingoperationtask mot',
    'JOIN transaction wo',
    '  ON wo.id = mot.workorder',
    'JOIN transactionline tl',
    '  ON tl.transaction = wo.id',
    " AND tl.mainline = 'T'",
    'WHERE',
    "  UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
    "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
    "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
    'ORDER BY wo.id, mot.operationsequence, mot.id'
  ];

  function conPaginacion(suffix) {
    return BASELINE.join('\n') + '\n' + suffix;
  }
  // 0) Guardia: una llamada minima para saber si hay cuota antes de gastar las de verdad.
  try {
    PP_DIAG_SUITEQL_(config, 'SELECT 1 AS ok FROM dual');
    log('guardia ok: SuiteQL responde');
  } catch (guardError) {
    if (PP_DIAG_QUOTA_EXHAUSTED_(guardError)) {
      log('CUOTA DIARIA AGOTADA o SuiteQL no responde. Se detiene aqui. ' +
        'Si el mensaje es de cuota, reintenta despues de medianoche hora del Pacifico.');
      return;
    }
    log('la guardia fallo: ' + (guardError && guardError.message ? guardError.message : guardError));
  }

  // 1) AISLAR LA COLUMNA QUE EL ENDPOINT REST RECHAZA.
  //    La corrida del 07:31 dio HTTP 400 "Cannot build builtin function" sobre el SQL sin
  //    paginar, que es casi el que el 2240 de produccion ejecuta bien. O sea que el endpoint
  //    REST de SuiteQL y el query.runSuiteQL de DENTRO de NetSuite no aceptan lo mismo. En vez
  //    de repetir la misma consulta y volver a concluir lo mismo, se prueba una columna por
  //    vez para decir cual es, y con el texto COMPLETO del error.
  var COLUMNAS = [
    ['mot.id', 'id'],
    ['wo.id', 'workorder_id'],
    ['wo.tranid', 'workorder_tranid'],
    ['tl.item', 'item_id'],
    ['BUILTIN.DF(tl.item)', 'item_name'],
    ['BUILTIN.DF(mot.manufacturingworkcenter)', 'operation'],
    ['mot.operationsequence', 'sequence'],
    ['mot.inputquantity', 'qty_to_process'],
    ['mot.startdatetime', 'start_planned'],
    ['mot.enddate', 'end_planned'],
    ['BUILTIN.DF(mot.status)', 'status_op'],
    ['mot.setuptime', 'setup_min'],
    ['mot.estimatedwork', 'est_min'],
    ['mot.actualwork', 'real_min'],
    ['mot.remainingwork', 'remaining_min'],
    ['mot.runrate', 'production_rate'],
    ['mot.laborresources', 'human_resource'],
    ['mot.machineresources', 'machine_resource'],
    ['mot.completedquantity', 'qty_completed'],
    ['tl.location', 'location'],
    ["BUILTIN.DF(wo.status)", 'status_ot']
  ];

  var malas = [];
  COLUMNAS.forEach(function (columna) {
    try {
      var filas = PP_DIAG_UNA_COLUMNA_(config, columna[0], columna[1]);
      log('OK   ' + columna[0] + ' -> ' + filas.length + ' filas');
    } catch (errorColumna) {
      malas.push(columna[0]);
      log('FALLA ' + columna[0] + ' -> ' + String(errorColumna && errorColumna.message || errorColumna).slice(0, 400));
    }
  });
  log('columnas que el endpoint REST rechaza: ' + (malas.length ? malas.join(', ') : 'ninguna'));

  // 2) El SQL completo de PRODUCCION (las 21 columnas del 2240 de hoy). Si este falla aqui y
  //    el 2240 funciona en produccion, el problema es del endpoint REST, no del SQL.
  try {
    var completo = PP_DIAG_SUITEQL_(config, BASELINE.join('\n'));
    log('SQL COMPLETO de produccion por REST: OK, ' + completo.length + ' filas');
  } catch (errorCompleto) {
    log('SQL COMPLETO por REST -> EXCEPCION ' + String(errorCompleto && errorCompleto.message || errorCompleto).slice(0, 600));
    log('  -> si el 2240 de produccion funciona con este mismo SQL, el problema es que el');
    log('     endpoint REST de SuiteQL no acepta lo que el query.runSuiteQL de NetSuite si.');
    log('     Por eso la sonda NO puede autorizar la subida: el 2240 lleva fallback.');
  }

  // 3) ¿El filtro por ubicacion deja pasar filas? Aqui si el valor va literal, porque por REST
  //    el endpoint no acepta params ligados (el restlet si los usa, corre dentro de NetSuite).
  try {
    var sqlFiltro = BASELINE.join('\n').replace(
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'\n  AND tl.location = 1"
    );
    var conLoc = PP_DIAG_SUITEQL_(config, sqlFiltro);
    log('CON tl.location = 1: ' + conLoc.length + ' filas');
    if (!conLoc.length) {
      log('  AVISO: el filtro con location 1 devuelve 0 filas aunque la columna exista.');
      log('         El 2240 lo detecta y degrada a sin filtro, asi que no rompe la app.');
    } else {
      log('  -> el filtro por ubicacion devuelve filas');
      log('  ejemplo: ' + JSON.stringify(conLoc[0]));
    }
  } catch (error4) {
    log('CON tl.location = 1 -> EXCEPCION ' + String(error4 && error4.message || error4).slice(0, 600));
    log('  -> el 2240 lo detecta y degrada a sin filtro, asi que no rompe la app.');
  }

  // 4) Desglose por ubicacion, que confirma si la columna existe y cuantas plantas hay.
  try {
    var desglose = PP_DIAG_SUITEQL_(config, [
      'SELECT tl.location AS ubicacion, COUNT(*) AS operaciones',
      'FROM manufacturingoperationtask mot',
      'JOIN transaction wo ON wo.id = mot.workorder',
      'JOIN transactionline tl ON tl.transaction = wo.id',
      " AND tl.mainline = 'T'",
      'WHERE',
      "  UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CERRAD%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%CLOSED%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
      'GROUP BY tl.location',
      'ORDER BY operaciones DESC'
    ].join('\n'));
    log('operaciones abiertas por ubicacion:');
    desglose.forEach(function (row) {
      log('  ubicacion=' + row.ubicacion + ' operaciones=' + row.operaciones);
    });
  } catch (error5) {
    log('desglose por ubicacion -> EXCEPCION ' + String(error5 && error5.message || error5).slice(0, 600));
  }

  // 5) Y una de FETCH NEXT/OFFSET, por si el endpoint REST si lo acepta aunque el resto no.
  try {
    var conFetch = BASELINE.join('\n') + '\nFETCH NEXT 51 ROWS ONLY\nOFFSET 0 ROWS';
    var pagina = PP_DIAG_SUITEQL_(config, conFetch);
    log('SQL CON FETCH NEXT 51 / OFFSET 0: OK, ' + pagina.length + ' filas');
  } catch (error2) {
    log('SQL CON FETCH NEXT/OFFSET -> EXCEPCION ' + String(error2 && error2.message || error2).slice(0, 600));
    log('  -> si esto falla, el 2240 degrada al recorte en memoria y sigue funcionando.');
  }

  log('DIAG_operaciones2240b terminado. Pega el registro de ejecucion completo.');
}