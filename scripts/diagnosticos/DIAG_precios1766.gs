/**
 * DIAG_precios1766 — responde en que se puede integrar el precio de venta al RESTlet 2244.
 *
 * Por que: hoy la sincronizacion de OTs pagina el RESTlet 1766 (REQ_FIFO) hasta 100 veces
 * (PP_fetchSalesPricesRestlet_ -> PP_fetchRestletPages_, maxPages 100, pageSize 200) y
 * reduce todo en memoria. Eso son decenas de llamadas y 43-73 s. Para traer el precio desde
 * el 2244 hay que consultar la MISMA fuente desde SuiteQL, y SuiteQL solo soporta ciertos
 * tipos de registro. Esta sonda descubre cual es.
 *
 * Como correrla: abre el Apps Script del proyecto, pega este archivo (sin el comentario
 * inicial), guardalo y ejecuta DIAG_precios1766. NO escribe nada en NetSuite ni en la hoja:
 * solo llama el RESTlet 1766 en modo lectura y loguea lo que encuentra.
 *
 * NO OLVIDES: la propiedad se llama NS_SALES_PRICES_SCRIPT si el 1766 esta movido; aqui se
 * usa el valor por omision 1766/deploy 1, que es el documentado.
 */
function DIAG_precios1766() {
  var props = PropertiesService.getScriptProperties();
  var scriptId = String(props.getProperty('NS_SALES_PRICES_SCRIPT') || '1766').trim();
  var deployId = String(props.getProperty('NS_SALES_PRICES_DEPLOY') || '1').trim();
  var config = PP_netSuiteConfig_();

  log('script=' + scriptId + ' deploy=' + deployId + ' cuenta=' + config.accountId);

  // 1) PageSize grande:NetSuite dice cuantos rows trae por pagina y si admite mas de 200.
  //    Si una pagina de 1000 funciona, el numero de llamadas se reduce 5x sin tocar la fuente.
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
      log('pageSize=' + size + ' -> EXCEPCION ' + (error && error.message ? error.message : error));
    }
  });

  // 2) Volcado literal de las primeras filas: apareceran todas las columnas que el 1766
  //    expone. Si hay un id de registro o un tipo, ahi esta la pista de la fuente real.
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
    log('volcado -> EXCEPCION ' + (error2 && error2.message ? error2.message : error2));
  }

  // 3) Rango de fechas: si el 1766 acepta una ventana en el body, el paginado se reduce
  //   mucho y el filtro de 6 meses deja de hacerse en memoria. Se prueban los nombres
  //    habituales; uno que funcione aparece con status 200 y filas.
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
      log('filtro ' + probe.label + ' -> EXCEPCION ' + (error3 && error3.message ? error3.message : error3));
    }
  });

  log('DIAG_precios1766 terminado. Pega el registro de ejecucion completo.');
}

/** no-op para que el archivo tenga una funcion principal reconocible si lo pegas suelto */
function DIAG_precios1766_ayuda() {
  log('Este archivo ejecuta DIAG_precios1766(). No requiere cambios.');
}
