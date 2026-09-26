/**
 * DIAG_operaciones2240 - cuenta de operaciones abiertas POR UBICACION, para decidir si conviene
 * bajar el filtro de planta al SQL del RESTlet 2240.
 *
 * Por que: hoy PP_fetchRestletPages_(2240, { locationId: 1, onlyOpen: true }, config, 20) pide
 * 20 paginas de 200 y el 2240 (netsuite-restlet-operaciones.js) IGNORA locationId: su post()
 * solo lee pageSize y pageIndex, y su SQL filtra por estatus, no por ubicacion. Todas las plantas
 * viajan y el servidor descarta lo que no es de planta 1 despues, en memoria
 * (PP_belongsToPlant_, 08-netsuite.js:833). Con paginacion en memoria, cada una de las 20
 * paginas re-ejecuta el JOIN completo de todas las plantas (all = runSuiteQL_(sql) y despues
 * slice), o sea 20 escaneos completos para usarmaybe la mitad de las filas.
 *
 * ESTA SONDA NO MODIFICA NADA: solo llama el 2240 en lectura, igual que el 1766.
 *
 * COMO CORRERLA: abre el Apps Script del proyecto, pega este archivo, guardalo y ejecuta
 * DIAG_operaciones2240. Pega despues el registro de ejecucion completo.
 *
 * QUE MIDE:
 *   1. Una llamada de guardia. Si la cuota diaria de urlfetch esta agotada, para aqui (no gasta
 *      mas cuota en fracasos garantizados, como hace PP_DIAG_QUOTA_EXHAUSTED_ en DIAG_precios1766).
 *   2. Cuantas filas trae el 2240 en total y cuantas por pagina pide realmente, para confirmar
 *      si maxPages 20 alcanza o esta truncanco la lista.
 *   3. El desglose por ubicacion (location) de las operaciones abiertas, que es el dato que
 *      decide si el filtro baja al SQL.
 *   4. Cuantas filas de cada ubicacion son de plantas distintas, para poner nombre al ahorro.
 */

function PP_DIAG_QUOTA_EXHAUSTED_(error) {
  var text = String((error && error.message) || error || '');
  return /invoked too many times for one day|urlfetch/i.test(text);
}

function DIAG_operaciones2240() {
  // El 2240 esta fijo en codigo (PP_OPERATIONS_RESTLET_ = { script: '2240', deploy: '1' } en
  // src/server/08-netsuite.js:4), a diferencia del 2244 que si lee NS_WO_INSPECTION_SCRIPT. Se
  // dejan props por si el deployment se movio, pero el valor por defecto es el que usa la app.
  var props = PropertiesService.getScriptProperties();
  var scriptId = String(props.getProperty('NS_OPERATIONS_SCRIPT') || '2240').trim();
  var deployId = String(props.getProperty('NS_OPERATIONS_DEPLOY') || '1').trim();
  var config = PP_netSuiteConfig_();
  var log = function (message) { Logger.log(String(message)); };

  log('script=' + scriptId + ' deploy=' + deployId + ' cuenta=' + config.accountId);
  log('locationId que ENVIA la app=' + config.locationId);

  // 0) Guardia: una llamada para saber si hay cuota.
  var guardStarted = Date.now();
  try {
    PP_netSuiteRestletRequest_({ script: scriptId, deploy: deployId }, { pageIndex: 0, pageSize: 1, locationId: config.locationId, onlyOpen: true }, config);
    log('guardia ok en ' + (Date.now() - guardStarted) + ' ms');
  } catch (guardError) {
    if (PP_DIAG_QUOTA_EXHAUSTED_(guardError)) {
      log('CUOTA DIARIA DE URLFETCH AGOTADA. La sonda se detiene aqui a proposito: las llamadas ' +
        'restantes fallarian igual y solo gastarian mas cuota. Se reinicia a medianoche hora del Pacifico.');
      return;
    }
    log('la guardia fallo por otra razon, se sigue: ' + (guardError && guardError.message ? guardError.message : guardError));
  }

  // 1) Volumen real y comportamiento del paginado.
  //    maxPages 20 x pageSize 200 = 4000 filas es el techo que hoy se pone. Si totalRows pasa de
  //    ahi, la app esta LEYENDO LA LISTA TRUNCADA y ni lo nota, porque PP_fetchRestletPages_ solo
  //    sale del bucle por hasMore === false.
  var totalRows = null;
  try {
    var page = PP_netSuiteRestletRequest_(
      { script: scriptId, deploy: deployId },
      { pageIndex: 0, pageSize: 1, locationId: config.locationId, onlyOpen: true },
      config
    );
    var json = page.json || {};
    totalRows = json.totalRows;
    log('totalRows=' + totalRows + ' (la app pide hasta ' + (20 * 200) + ' filas: ' +
      (totalRows > 4000 ? 'ATENCION, se trunca' : 'alcanza') + ')');
    log('pageSize efectivo=' + json.pageSize + ' hasMore=' + json.hasMore);
    log('error del 2240: ' + JSON.stringify(json.error || ''));
  } catch (error) {
    if (PP_DIAG_QUOTA_EXHAUSTED_(error)) { log('cuota agotada; se corta la sonda'); return; }
    log('volumen -> EXCEPCION ' + (error && error.message ? error.message : error));
  }

  // 2) Desglose por ubicacion: el dato que decide el filtro.
  //    Se piden todas las filas que la app permitiria (4000) y se cuentan por location.
  try {
    var all = [];
    var MAX = 4000;
    for (var pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      var response = PP_netSuiteRestletRequest_(
        { script: scriptId, deploy: deployId },
        { pageIndex: pageIndex, pageSize: 200, locationId: config.locationId, onlyOpen: true },
        config
      );
      var body = response.json || {};
      var rows = body.rows || [];
      for (var i = 0; i < rows.length; i += 1) all.push(rows[i]);
      if (body.hasMore !== true) break;
    }
    log('filas leidas realmente=' + all.length + ' en ' + (pageIndex + 1) + ' llamadas');

    // El 2240 no devuelve la ubicacion por operacion: hay que mirar las columnas que si trae.
    // Se listan las claves de la primera fila para saber con que se puede agrupar.
    if (all.length) {
      var sample = all[0];
      log('claves de la primera fila: ' + JSON.stringify(Object.keys(sample)));
      log('fila de ejemplo: ' + JSON.stringify(sample));
    }

    // Conteo por cualquier columna que parezca la ubicacion o la planta.
    var candidates = ['location_id', 'locationId', 'location', 'planta', 'PLANTA', 'plant', 'location_name', 'subsidiary'];
    var byField = {};
    candidates.forEach(function (field) {
      var counts = {};
      var present = 0;
      all.forEach(function (row) {
        var value = row[field];
        if (value === undefined || value === null || value === '') return;
        present += 1;
        var key = String(value).trim();
        counts[key] = (counts[key] || 0) + 1;
      });
      if (present) {
        byField[field] = { presentes: present, conteo: counts };
      }
    });
    log('conteo por campo de ubicacion/planta: ' + JSON.stringify(byField));
    if (!Object.keys(byField).length) {
      log('NINGUNA columna de ubicacion o planta en la respuesta: el 2240 no expone de que planta ' +
        'es cada operacion, asi que el filtro de planta NO puede bajar al SQL sin agregar esa ' +
        'columna primero. Eso es un cambio del RESTlet, no solo del WHERE.');
    }

    // Cuantas operaciones corresponden a OTs de planta 1, usando la lista de OTs abiertas.
    // PP_belongsToPlant_ (08-netsuite.js:833) es lo que hoy decide en memoria.
    try {
      var woResponse = PP_fetchRestletPages_(
        { script: '1764', deploy: '1' },
        { table: 'WO_LISTA', locationId: config.locationId, onlyOpen: true },
        config,
        10
      );
      var plantFilter = PP_buildPlantFilter_(woResponse.rows);
      var dePlanta = 0;
      var deOtras = 0;
      var sinFolio = 0;
      all.forEach(function (row) {
        var id = String(PP_pick_(row, ['workorder_id', 'WO Internal ID']) || '').trim();
        var folio = String(PP_pick_(row, ['workorder_tranid', 'WO Folio', 'Orden de trabajo']) || '').trim();
        if (!id && !folio) { sinFolio += 1; return; }
        if ((id && plantFilter.ids[id]) || (folio && plantFilter.folios[folio])) dePlanta += 1;
        else deOtras += 1;
      });
      log('desglose real: planta ' + config.locationId + '=' + dePlanta + ' operaciones, otras plantas=' + deOtras + ', sin folio=' + sinFolio);
      log('OTs abiertas de planta ' + config.locationId + '=' + woResponse.rows.length);
      if (all.length) {
        log('AHORRO si el filtro bajara al SQL: se dejan de traer ' + deOtras + ' de ' + all.length +
          ' filas (' + Math.round((deOtras / all.length) * 100) + '%), y con la paginacion en memoria ' +
          'cada pagina dejaria de re-escanear el JOIN de las otras plantas');
      }
    } catch (woError) {
      log('no se pudo cruzar con WO_LISTA: ' + (woError && woError.message ? woError.message : woError));
    }
  } catch (error2) {
    if (!PP_DIAG_QUOTA_EXHAUSTED_(error2)) {
      log('desglose -> EXCEPCION ' + (error2 && error2.message ? error2.message : error2));
    }
  }

  log('DIAG_operaciones2240 terminado. Pega el registro de ejecucion completo.');
}
