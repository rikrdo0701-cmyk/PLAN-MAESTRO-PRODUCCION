/**
 * DIAG_restlets - verifica que el 2240 y el 2244respondieron bien DESPUES de subirlos.
 *
 * Por que: `PP_assertNetSuiteRows_` solo falla cuando el restlet devuelve 0 filas. El fallo
 * silencioso que hay que descartar es otro: que la paginacion por OFFSET pierda o repita filas
 * y la app reciba menos operaciones de las que hay, sin ningun error. Eso no lo ve ni la app ni
 * un toast. Aqui se mide el numero de filas, se revisa que ningun id este repetido y se compara
 * contra la linea base medida antes del cambio.
 *
 * LINEA BASE (sonda DIAG_operaciones2240 del 2026-09-26, con el restlet VIEJO):
 *   2240 -> 2400 filas abiertas en total; 2231 de planta 1 y 169 de otras.
 *   Si el 2240 nuevo devuelve 2231, el filtro de ubicacion funciono y no se perdio nada.
 *   Si devuelve entre 2231 y 2400, esta bien: el filtro se degrado o no aplico, y el servidor
 *     igual descarta por planta en memoria (PP_belongsToPlant_).
 *   Si devuelve MENOS de 2231, hay filas perdidas: eso es un fallo y hay que corregirlo.
 *   El 2244 no tiene linea base medida, asi que se comprueba estructura: sin repetidas, el
 *   recorrido termina, y la cuenta coincide con lo que ve la app.
 *
 * QUE COMPRUEBA:
 *   1. 2240 responde y que estrategia uso (debug.estrategia): si no es la primera, se degrado.
 *   2. 2240 SIN filas repetidas y sin perder contra la linea base.
 *   2240 en UNA llamada (pageSize 2500) y mide el tiempo, para confirmar la mejora.
 *   4. 2244 responde, sin repetidas, y dice cuantas filas hay en total frente a las 500 que la
 *      app pide en una sola llamada: si hay mas de 500, la app solo ve la primera pagina y eso
 *      es un limite conocido, no un fallo de este cambio.
 *
 * COMO CORRERLA: pega este archivo en el editor de Apps Script, guardalo y ejecuta
 * DIAG_restlets. Pega el registro de ejecucion completo.
 *
 * ATENCION AL GASTO DE CUOTA: cada llamada es un UrlFetch contra la cuota diaria. Esta sonda
 * hace unas 5-8 llamadas. Tiene guardia de cuota.
 */

var DIAG_LINEA_BASE_2240_TOTAL = 2400;
var DIAG_LINEA_BASE_2240_PLANTA = 2231;

function PP_DIAG_QUOTA_EXHAUSTED_(error) {
  var text = String((error && error.message) || error || '');
  return /invoked too many times for one day|urlfetch/i.test(text);
}

function DIAG_restlets() {
  var log = function (message) { Logger.log(String(message)); };
  var fallos = 0;
  var avisos = 0;
  var config = PP_netSuiteConfig_();
  log('cuenta=' + config.accountId + ' locationId=' + config.locationId);
  log('linea base 2240: ' + DIAG_LINEA_BASE_2240_TOTAL + ' filas, ' + DIAG_LINEA_BASE_2240_PLANTA + ' de planta ' + config.locationId);

  // Guardia: una llamada para saber si hay cuota antes de gastar el resto.
  try {
    PP_netSuiteRestletRequest_({ script: '2240', deploy: '1' }, { pageIndex: 0, pageSize: 1 }, config);
    log('guardia ok: hay cuota');
  } catch (guardError) {
    if (PP_DIAG_QUOTA_EXHAUSTED_(guardError)) {
      log('CUOTA DIARIA DE URLFETCH AGOTADA. Se detiene aqui; reintenta despues de medianoche');
      log('hora del Pacifico. Nada de esto escribe en NetSuite ni en la hoja.');
      return;
    }
    log('la guardia fallo: ' + String(guardError && guardError.message || guardError));
  }

  // ---- 1 y 2: el 2240, que estrategia respondio y si perdio filas ----
  log('');
  log('--- 2240 operaciones ---');
  try {
    var cruda = PP_netSuiteRestletRequest_(
      { script: '2240', deploy: '1' },
      { pageIndex: 0, pageSize: 2500, locationId: config.locationId, onlyOpen: true },
      config
    );
    var cuerpo = cruda.json || {};
    var filasCrudas = cuerpo.rows || [];
    log('respuesta: ok=' + cruda.ok + ' status=' + cruda.status +
      ' pageSize=' + cuerpo.pageSize + ' hasMore=' + cuerpo.hasMore +
      ' filas=' + filasCrudas.length);
    log('debug.estrategia=' + String(cuerpo.debug && cuerpo.debug.estrategia) +
      '  paginacion=' + String(cuerpo.debug && cuerpo.debug.paginacion) +
      '  filtroUbicacion=' + String(cuerpo.debug && cuerpo.debug.filtroUbicacion));
    log('debug.degradaciones=' + JSON.stringify((cuerpo.debug && cuerpo.debug.degradaciones) || []));

    if (cuerpo.debug && cuerpo.debug.estrategia === 'con-ubicacion') {
      log('-> la columna tl.location funciona: el 2240 filtra por planta y no trae las demas');
    } else if (cuerpo.debug && cuerpo.debug.estrategia === 'sql-de-produccion') {
      avisos += 1;
      log('AVISO: respondio la estrategia de produccion, osea que el filtro por ubicacion no');
      log('       sirvio. No es un fallo: el servidor descarta por planta en memoria con');
      log('       PP_belongsToPlant_, pero si se quiere el ahorro de no traerlas, hay que');
      log('       revisar si tl.location existe como columna en esta cuenta.');
    } else {
      avisos += 1;
      log('AVISO: estrategia desconocida: ' + String(cuerpo.debug && cuerpo.debug.estrategia));
    }
    if (cuerpo.error) {
      fallos += 1;
      log('FALLA: el 2240 devuelve error: ' + JSON.stringify(cuerpo.error));
    }
  } catch (error1) {
    fallos += 1;
    log('FALLA: el 2240 lanzo ' + String(error1 && error1.message || error1));
    log('  si es 200 {ok:false}, la consulta no se pudo construir; revisa el log de Apps Script');
  }

  // Recorrido por el camino real de la app (PP_fetchRestletPages_), que es el que usa de verdad.
  try {
    var inicio = Date.now();
    var pagina = PP_fetchRestletPages_(
      { script: '2240', deploy: '1' },
      { locationId: config.locationId, onlyOpen: true },
      config,
      20
    );
    var elapsed = Date.now() - inicio;
    var total = pagina.rows.length;
    log('');
    log('recorrido por PP_fetchRestletPages_ (el camino de la app): ' + total + ' filas en ' + elapsed + ' ms');

    var vistos = {};
    var repetidas = 0;
    var sinId = 0;
    pagina.rows.forEach(function (row) {
      var id = String((row && (row.id || row['ID (link)'])) || '').trim();
      if (!id) { sinId += 1; return; }
      if (vistos[id]) repetidas += 1;
      vistos[id] = true;
    });
    log('ids unicos=' + Object.keys(vistos).length + '  repetidas=' + repetidas + '  sin id=' + sinId);
    if (repetidas > 0) {
      fallos += 1;
      log('FALLA: hay ' + repetidas + ' operaciones repetidas entre paginas. El ORDER BY no es');
      log('       total, asi que OFFSET se esta saltando o repitiendo filas.');
    }
    if (sinId === pagina.rows.length && pagina.rows.length) {
      fallos += 1;
      log('FALLA: ninguna fila trae id, no se puede comprobar la paginacion');
    }

    if (total < DIAG_LINEA_BASE_2240_PLANTA) {
      fallos += 1;
      log('FALLA: ' + total + ' filas contra la linea base de ' + DIAG_LINEA_BASE_2240_PLANTA +
        ' de planta ' + config.locationId + '. Se perdieron ' + (DIAG_LINEA_BASE_2240_PLANTA - total) + ' operaciones.');
    } else if (total < DIAG_LINEA_BASE_2240_TOTAL) {
      log('-> OK: ' + total + ' filas = planta ' + config.locationId + ' sin las de otras plantas. El filtro funciono.');
    } else if (total === DIAG_LINEA_BASE_2240_TOTAL) {
      avisos += 1;
      log('AVISO: ' + total + ' filas, osea TODAS las plantas. El filtro no se aplico o se degrado;');
      log('       no es un fallo porque el servidor descarta por planta en memoria, pero la');
      log('       optimizacion de no traerlas no esta ocurriendo.');
    } else {
      avisos += 1;
      log('AVISO: ' + total + ' filas, MAS que la linea base de ' + DIAG_LINEA_BASE_2240_TOTAL +
        '. Puede que haya operaciones abiertas nuevas desde la medicion; conviene revisarlo.');
    }
    log('tiempo: ' + elapsed + ' ms. Antes del cambio eran 12 llamadas y ~25 s.');
  } catch (error2) {
    fallos += 1;
    log('FALLA: PP_fetchRestletPages_ lanzo ' + String(error2 && error2.message || error2));
  }

  // ---- 4: el 2244 de inspeccion ----
  log('');
  log('--- 2244 inspeccion ---');
  try {
    var props = PropertiesService.getScriptProperties();
    var query2244 = {
      script: String(props.getProperty('NS_WO_INSPECTION_SCRIPT') || '2244'),
      deploy: String(props.getProperty('NS_WO_INSPECTION_DEPLOY') || '1')
    };
    var cruda2244 = PP_netSuiteRestletRequest_(query2244, {
      table: 'WO_INSPECCION',
      locationId: config.locationId,
      onlyOpen: true,
      action: 'list',
      pageIndex: 0,
      pageSize: 500
    }, config);
    var cuerpo2244 = cruda2244.json || {};
    log('respuesta: ok=' + cruda2244.ok + ' status=' + cruda2244.status +
      ' pageSize=' + cuerpo2244.pageSize + ' hasMore=' + cuerpo2244.hasMore +
      ' filas=' + ((cuerpo2244.wos || cuerpo2244.rows || []).length));
    if (cuerpo2244.error) {
      fallos += 1;
      log('FALLA: el 2244 devuelve error: ' + JSON.stringify(cuerpo2244.error));
    }

    // Recorre todas las paginas con la misma ruta y cuenta, para saber el total real.
    var total2244 = 0;
    var vistos2244 = {};
    var repetidas2244 = 0;
    for (var indice = 0; indice < 10; indice += 1) {
      var res = PP_netSuiteRestletRequest_(query2244, {
        table: 'WO_INSPECCION',
        locationId: config.locationId,
        onlyOpen: true,
        action: 'list',
        pageIndex: indice,
        pageSize: 500
      }, config);
      var cuerpo = res.json || {};
      var filas = cuerpo.wos || cuerpo.rows || [];
      total2244 += filas.length;
      filas.forEach(function (row) {
        var id = String((row && (row.workorder_id || row.wo)) || '').trim();
        if (!id) return;
        if (vistos2244[id]) repetidas2244 += 1;
        vistos2244[id] = true;
      });
      if (cuerpo.hasMore !== true) break;
    }
    log('recorrido completo: ' + total2244 + ' filas, ids unicos=' + Object.keys(vistos2244).length +
      '  repetidas=' + repetidas2244);
    if (repetidas2244 > 0) {
      fallos += 1;
      log('FALLA: hay ' + repetidas2244 + ' OTs repetidas entre paginas. El ORDER BY del 2244');
      log('       no es total; con OFFSET la paginacion se descuadra.');
    }
    if (total2244 > 500) {
      avisos += 1;
      log('AVISO: hay ' + total2244 + ' OTs de inspeccion y la app pide solo la pagina 0 con');
      log('       pageSize 500, o sea que SOLO ve las primeras 500. Esto ya era asi antes del');
      log('       cambio (no es una regresion), pero conviene saberlo.');
    }
  } catch (error3) {
    fallos += 1;
    log('FALLA: el 2244 lanzo ' + String(error3 && error3.message || error3));
  }

  log('');
  log('RESUMEN: ' + fallos + ' fallo(s) y ' + avisos + ' aviso(s).');
  if (!fallos) log('Los dos restlets responden bien. Los avisos son informativo, no fallos.');
  log('DIAG_restlets terminado. Pega el registro de ejecucion completo.');
}
