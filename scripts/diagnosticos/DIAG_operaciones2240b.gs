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
 * SuiteQL, que es EXACTAMENTE el camino que ya usa en produccion el catalogo maestro
 * (PP_fetchNetSuiteOperationCatalog_, 08-netsuite.js:408). Asi lo que se verifica aqui es la
 * misma consulta sobre la misma cuenta y con los mismos permisos que usara el restlet.
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
 *   1) El SQL tal cual lo lleva el 2240, sin paginar: debe devolver filas.
 *   2) El mismo SQL con FETCH NEXT / OFFSET: la cuenta lo acepta y el OFFSET avanza.
 *   3) El mismo SQL con `tl.location = 1` y, si devuelve 0 filas, avisa antes de que se suba.
 *   4) El desglose por ubicacion, que confirma que la columna existe y cuantas plantas hay.
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
    throw new Error('HTTP ' + status + ' ' + String(raw).slice(0, 300));
  }
  var json;
  try { json = JSON.parse(raw || '{}'); } catch (e) { throw new Error('JSON invalido: ' + String(raw).slice(0, 200)); }
  if (!Array.isArray(json.items)) throw new Error('respuesta sin items: ' + String(raw).slice(0, 200));
  return json.items;
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

  // 1) ¿La cuenta acepta FETCH NEXT / OFFSET? Este es el riesgo grande del cambio.
  var BASELINE_SIN_PAGINAR = BASELINE.join('\n');
  var filasSinPaginar = -1;
  var started = Date.now();
  try {
    var todas = PP_DIAG_SUITEQL_(config, BASELINE_SIN_PAGINAR);
    filasSinPaginar = todas.length;
    log('SQL SIN paginar: OK, ' + filasSinPaginar + ' filas en ' + (Date.now() - started) + ' ms');
  } catch (error1) {
    log('SQL SIN paginar -> EXCEPCION ' + (error1 && error1.message ? error1.message : error1));
    log('si esto falla, el 2240 viejo tampoco funcionaba con este SQL; revisa los permisos del token');
    return;
  }

  try {
    var conFetch = conPaginacion('FETCH NEXT 51 ROWS ONLY\nOFFSET 0 ROWS');
    var pagina = PP_DIAG_SUITEQL_(config, conFetch);
    log('SQL CON FETCH NEXT 51 / OFFSET 0: OK, ' + pagina.length + ' filas');
    log('  -> la cuenta ACEPTA FETCH NEXT/OFFSET: se puede subir el 2240 paginado en SQL');
    if (pagina.length > 51) log('  AVISO: devolvio ' + pagina.length + ' de 51 pedidos; el limite no se respeta');
  } catch (error2) {
    log('SQL CON FETCH NEXT/OFFSET -> EXCEPCION ' + (error2 && error2.message ? error2.message : error2));
    log('  -> la cuenta NO ACEPTA FETCH NEXT/OFFSET. NO subas la version paginada del 2240;');
    log('     dejalo paginando en memoria (que es el archivo viejo) o cambia la paginacion.');
    return;
  }

  // El OFFSET tiene que avanzar de verdad, si no siempre devuelve la misma pagina.
  try {
    var segunda = PP_DIAG_SUITEQL_(config, conPaginacion('FETCH NEXT 51 ROWS ONLY\nOFFSET 51 ROWS'));
    var primera = PP_DIAG_SUITEQL_(config, conPaginacion('FETCH NEXT 51 ROWS ONLY\nOFFSET 0 ROWS'));
    var idPrimera = primera.length ? String(primera[0].id) : '';
    var idSegunda = segunda.length ? String(segunda[0].id) : '';
    log('OFFSET avanza: pagina 0 empieza en id=' + idPrimera + ', pagina 1 empieza en id=' + idSegunda);
    if (idPrimera && idSegunda && idPrimera === idSegunda) {
      log('  AVISO: OFFSET devolvio la misma fila; la paginacion por OFFSET no serviria');
    } else {
      log('  -> OFFSET funciona: se puede pedir pagina por pagina');
    }
  } catch (error3) {
    log('prueba de OFFSET -> EXCEPCION ' + (error3 && error3.message ? error3.message : error3));
  }

  // 2) ¿El filtro por ubicación deja pasar filas? Si devuelve 0, la app se quedaria sin operaciones.
  //    Por REST el `?` no se sustituye (el endpoint no acepta params), asi que aqui va el valor
  //    literal; el restlet si usa `?` con parametro ligado porque corre dentro de NetSuite.
  try {
    var sqlFiltro = BASELINE.join('\n') + '\nFETCH NEXT 51 ROWS ONLY\nOFFSET 0 ROWS';
    sqlFiltro = sqlFiltro.replace(
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'",
      "  AND UPPER(BUILTIN.DF(wo.status)) NOT LIKE '%COMPLET%'\n  AND tl.location = 1"
    );
    var conLoc = PP_DIAG_SUITEQL_(config, sqlFiltro);
    log('CON tl.location = 1: ' + conLoc.length + ' filas');
    if (!conLoc.length) {
      log('  AVISO: el filtro con location 1 devuelve 0 filas. Puede que la columna no se llame');
      log('         tl.location en esta cuenta. NO subas el filtro hasta aclararlo; el 2240 sin');
      log('         filtro es el estado seguro y el servidor ya descarta en memoria.');
    } else {
      log('  -> el filtro por ubicacion funciona con la cuenta');
      log('  ejemplo: ' + JSON.stringify(conLoc[0]));
    }
  } catch (error4) {
    log('CON tl.location = 1 -> EXCEPCION ' + (error4 && error4.message ? error4.message : error4));
    log('  -> la columna tl.location no es aceptada en esta consulta. NO subas el filtro todavia.');
  }

  // 3) Desglose por ubicacion, para confirmar que la columna existe y cuantas plantas hay.
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
    if (!desglose.length) {
      log('  AVISO: el GROUP BY por ubicacion no devolvio nada; la columna podria no existir');
    }
  } catch (error5) {
    log('desglose por ubicacion -> EXCEPCION ' + (error5 && error5.message ? error5.message : error5));
  }

  log('DIAG_operaciones2240b terminado. Pega el registro de ejecucion completo.');
}
