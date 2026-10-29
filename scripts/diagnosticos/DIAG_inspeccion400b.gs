/**
 * DIAG_inspeccion400b
 * Segunda sonda: barre folios reales con action:detail, prueba concurrencia y
 * prueba si el RESTlet interpola el folio en SuiteQL. Solo lectura, no cambia datos.
 * Pegar en el editor de Apps Script, guardar, ejecutar y leer Execution log.
 */
function DIAG_inspeccion400b() {
  var props = PropertiesService.getScriptProperties();
  var cfg = PP_netSuiteConfig_();
  var scriptId = props.getProperty('NS_WO_INSPECTION_SCRIPT') || '2244';
  var deployId = props.getProperty('NS_WO_INSPECTION_DEPLOY') || '1';
  var q = { script: scriptId, deploy: deployId };
  var base = { table: 'WO_INSPECCION', locationId: cfg.locationId, onlyOpen: true };

  var lista = PP_netSuiteRestletRequest_(q, Object.assign({ action: 'list', pageIndex: 0, pageSize: 500 }, base), cfg);
  var wos = (lista.json && (lista.json.wos || lista.json.rows)) || [];
  console.log('LIST status=' + lista.status + ' wos=' + wos.length);
  if (!wos.length) { console.log('La lista salio vacia; revisar el 400 primero.'); return; }

  var folios = [];
  for (var i = 0; i < wos.length && folios.length < 40; i += 1) {
    var f = String(wos[i].wo || wos[i]['WO Folio'] || wos[i].tranid || '').trim();
    if (f) folios.push(f);
  }
  console.log('Folios a probar (' + folios.length + '): ' + folios.join(', '));

  var fallos = 0;
  folios.forEach(function(folio) {
    var r = PP_netSuiteRestletRequest_(q, Object.assign({ action: 'detail', woFolio: folio }, base), cfg);
    var json = r.json || {};
    var okt = r.status >= 200 && r.status < 300 && json.ok === true && !!json.trabajo;
    if (!okt) {
      fallos += 1;
      console.log('FALLA folio="' + folio + '" status=' + r.status + ' raw=' + r.raw.slice(0, 240));
    }
  });
  console.log('== Barrido individual: ' + fallos + ' de ' + folios.length + ' con falla ==');

  // Concurrencia: 8 detail simultaneos, igual que el fan-out de la app.
  var erroresConc = [];
  var jobs = [];
  for (var j = 0; j < 8; j += 1) {
    (function(idx) {
      jobs.push(new Promise(function(resolve) {
        var f = folios[idx % folios.length];
        try {
          var r = PP_netSuiteRestletRequest_(q, Object.assign({ action: 'detail', woFolio: f }, base), cfg);
          if (!(r.status >= 200 && r.status < 300 && r.json && r.json.ok === true)) {
            erroresConc.push(f + ' -> ' + r.status + ' ' + r.raw.slice(0, 160));
          }
        } catch (error) {
          erroresConc.push(f + ' -> EXCEPCION ' + String(error && error.message || error));
        }
        resolve();
      }));
    })(j);
  }
  Promise.all(jobs).then(function() {
    console.log('== Concurrencia 8x detail: ' + erroresConc.length + ' fallas ==');
    erroresConc.forEach(function(line) { console.log('   ' + line); });

    // El folio se interpola en SuiteQL? Un apostrofe suffit para probarlo.
    var sonda = ["3483'", '3483 OR 1=1', '3483%', 'x'.repeat(90), ''];
    sonda.forEach(function(valor) {
      var r = PP_netSuiteRestletRequest_(q, Object.assign({ action: 'detail', woFolio: valor }, base), cfg);
      console.log('SONDA folio=' + JSON.stringify(valor).slice(0, 40) + ' -> status=' + r.status + ' raw=' + r.raw.slice(0, 200));
    });
  });
}
