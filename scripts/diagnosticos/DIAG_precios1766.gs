/**
 * DIAG_precios1766 — responde en que se puede integrar el precio de venta al RESTlet 2244.
 *
 * Por que: hoy la sincronizacion de OTs pagina el RESTlet 1766 (REQ_FIFO) y reduce todo en
 * memoria. Eso son decenas de llamadas y 43-73 s. Para traer el precio desde el 2244 hay que
 * consultar la MISMA fuente desde SuiteQL, y SuiteQL solo soporta ciertos tipos de registro.
 * Esta sonda descubre cual es.
 *
 * COMO CORRERLA: abre el Apps Script del proyecto, pega este archivo, guardalo y ejecuta
 * DIAG_precios1766. NO escribe nada en NetSuite ni en la hoja: solo llama el 1766 en lectura.
 *
 * AVISO DE CUOTA: Apps Script tiene un tope diario de UrlFetch por consumidor (20 000 en
 * cuentas de consumidor). Agotado, TODA llamada falla con "Service invoked too many times for
 * one day: urlfetch" sin llegar a NetSuite. Por eso esta sonda hace UNA llamada de guardia y,
 * si la cuota esta agotada, se detiene y dice cuando reintentar: las 8 llamadas restantes
 * fallarian igual y solo gastarian mas cuota.
 */
function log(message) {
  Logger.log(String(message));
}

function PP_DIAG_QUOTA_EXHAUSTED_(error) {
  var text = String((error && error.message) || error || '');
  return /invoked too many times for one day|urlfetch/i.test(text);
}

function DIAG_precios1766() {
  var props = PropertiesService.getScriptProperties();
  var scriptId = String(props.getProperty('NS_SALES_PRICES_SCRIPT') || '1766').trim();
  var deployId = String(props.getProperty('NS_SALES_PRICES_DEPLOY') || '1').trim();
  var config = PP_netSuiteConfig_();

  log('script=' + scriptId + ' deploy=' + deployId + ' cuenta=' + config.accountId);

  // 0) Guardia: una sola llamada para saber si hay cuota. Cuesta 1 peticion.
  var guardStarted = Date.now();
  try {
    PP_netSuiteRestletRequest_(
      { script: scriptId, deploy: deployId },
      { table: 'REQ_FIFO', pageIndex: 0, pageSize: 1 },
      config
    );
    log('guardia ok en ' + (Date.now() - guardStarted) + ' ms');
  } catch (guardError) {
    if (PP_DIAG_QUOTA_EXHAUSTED_(guardError)) {
      log('CUOTA DIARIA DE URLFETCH AGOTADA. La sonda se detiene aqui a proposito: las llamadas '
        + 'restantes fallarian igual y solo gastarian mas cuota.');
      log('El limite se reinicia a medianoche hora del Pacifico. Vuelve a ejecutar despues de '
        + 'ese reinicio; no hay nada que cambiar en el codigo.');
      return;
    }
    log('la guardia fallo por otra razon, se sigue: '
      + (guardError && guardError.message ? guardError.message : guardError));
  }

  // 1) PageSize grande: cuanto admite el 1766 de verdad. Si 1000 funciona (el script de
  //    inventario INV_PLANTAS_WIP ya lo usa), el numero de llamadas baja 5x sin tocar la fuente.
  [200, 500, 1000, 2000].forEach(function (size) {
    var started = Date.now();
    try {
      var body = { table: 'REQ_FIFO', pageIndex: 0, pageSize: size };
      var response = PP_netSuiteRestletRequest_({ script: scriptId, deploy: deployId }, body, config);
      var json = response.json || {};
      var rows = json.rows || [];
      log('pageSize=' + size + ' -> status=' + response.status + ' ok=' + (response.ok === true)
        + ' rows=' + rows.length + ' hasMore=' + json.hasMore + ' totalRows=' + json.totalRows
        + ' ms=' + (Date.now() - started));
    } catch (error) {
      if (PP_DIAG_QUOTA_EXHAUSTED_(error)) {
        log('pageSize=' + size + ' -> cuota agotada a mitad de la sonda; se corta aqui');
        return;
      }
      log('pageSize=' + size + ' -> EXCEPCION ' + (error && error.message ? error.message : error));
    }
  });

  // 2) Volcado literal de las primeras filas: aparecen todas las columnas que el 1766 expone.
  //    Si hay un id de registro o un tipo, ahi esta la pista de la fuente real y se puede
  //    decidir si el precio cabe en una consulta SuiteQL (y de paso en el 2244).
  try {
    var page = PP_netSuiteRestletRequest_(
      { script: scriptId, deploy: deployId },
      { table: 'REQ_FIFO', pageIndex: 0, pageSize: 5 },
      config
    );
    var json2 = page.json || {};
    log('HEADERS: ' + JSON.stringify(json2.headers || []));
    (json2.rows || []).forEach(function (row, index) {
      log('fila ' + index + ': ' + JSON.stringify(row));
    });
    if (json2.error) log('error del 1766: ' + JSON.stringify(json2.error));
  } catch (error2) {
    if (!PP_DIAG_QUOTA_EXHAUSTED_(error2)) {
      log('volcado -> EXCEPCION ' + (error2 && error2.message ? error2.message : error2));
    }
  }

  // 3) Ventana de fechas: si el 1766 la acepta en el body, el paginado se reduce mucho y el
  //    filtro de 6 meses deja de hacerse en memoria. Se prueban los nombres habituales.
  [
    { label: 'from/to', body: { from: '2026-03-26', to: '2026-09-26' } },
    { label: 'fechaDesde/fechaHasta', body: { fechaDesde: '2026-03-26', fechaHasta: '2026-09-26' } },
    { label: 'dateFrom/dateTo', body: { dateFrom: '2026-03-26', dateTo: '2026-09-26' } },
    { label: 'startDate/endDate', body: { startDate: '2026-03-26', endDate: '2026-09-26' } }
  ].forEach(function (probe) {
    try {
      var payload = Object.assign({ table: 'REQ_FIFO', pageIndex: 0, pageSize: 200 }, probe.body);
      var result = PP_netSuiteRestletRequest_({ script: scriptId, deploy: deployId }, payload, config);
      log('filtro ' + probe.label + ' -> status=' + result.status + ' rows=' + ((result.json || {}).rows || []).length
        + ' error=' + JSON.stringify((result.json || {}).error || ''));
    } catch (error3) {
      if (PP_DIAG_QUOTA_EXHAUSTED_(error3)) {
        log('filtro ' + probe.label + ' -> cuota agotada; se corta la sonda');
        return;
      }
      log('filtro ' + probe.label + ' -> EXCEPCION ' + (error3 && error3.message ? error3.message : error3));
    }
  });

  log('DIAG_precios1766 terminado. Pega el registro de ejecucion completo.');
}
