/**
 * DIAG_inspeccion400
 * Diagnostico temporal del 400 de NetSuite en el RESTlet de inspeccion.
 * Pegar en el editor de Apps Script (npm run open), guardar, ejecutar y leer
 * Execution log (panel inferior). No cambia ningun dato.
 */
function DIAG_inspeccion400() {
  var props = PropertiesService.getScriptProperties();
  var cfg = PP_netSuiteConfig_();
  var scriptId = props.getProperty('NS_WO_INSPECTION_SCRIPT') || '2244';
  var deployId = props.getProperty('NS_WO_INSPECTION_DEPLOY') || '1';
  console.log('NS_WO_INSPECTION_SCRIPT=' + scriptId + ' NS_WO_INSPECTION_DEPLOY=' + deployId +
    ' NS_ACCOUNT_ID=' + cfg.accountId + ' locationId=' + cfg.locationId);

  var base = { table: 'WO_INSPECCION', locationId: cfg.locationId, onlyOpen: true };
  var probe = function(script, deploy, body) {
    var r = PP_netSuiteRestletRequest_({ script: script, deploy: deploy }, body, cfg);
    console.log('### script=' + script + ' deploy=' + deploy + ' body=' + JSON.stringify(body) +
      '\n    -> status ' + r.status + ' | ' + r.raw.slice(0, 300));
  };

  probe('1764', '1', { table: 'WO_LISTA', locationId: cfg.locationId, onlyOpen: true, pageIndex: 0, pageSize: 5 });
  probe(scriptId, deployId, {});
  probe(scriptId, deployId, Object.assign({ action: 'list', pageIndex: 0, pageSize: 500 }, base));
  probe(scriptId, deployId, Object.assign({ action: 'list', pageIndex: 0, pageSize: 200 }, base));
  probe(scriptId, deployId, Object.assign({ action: 'list', pageIndex: 0, pageSize: 1 }, base));
  probe(scriptId, deployId, Object.assign({ action: 'detail', woFolio: '3483' }, base));
  probe(scriptId, '1', Object.assign({ action: 'detail', woFolio: '3483' }, base));
}
