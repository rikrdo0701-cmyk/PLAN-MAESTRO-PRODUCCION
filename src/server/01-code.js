const PP_APP_VERSION = '2.41.0';
const PP_SCHEMA_VERSION = 29;
const PP_DEFAULT_SPREADSHEET_ID = ''; // Configure PLANNING_SPREADSHEET_ID in Script Properties.

function doGet(e) {
  if (PP_isBridgeRequest_(e)) return PP_createBridgeOutput_();
  const appName = PP_appNameFromRequest_(e);
  return HtmlService.createHtmlOutputFromFile(PP_appHtmlFile_(appName))
    .setTitle(PP_appTitle_(appName))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function setupProductionPlanningApp() {
  const properties = PropertiesService.getScriptProperties();
  let spreadsheetId = properties.getProperty('PLANNING_SPREADSHEET_ID') || PP_DEFAULT_SPREADSHEET_ID;
  let spreadsheet;

  if (!spreadsheetId) {
    throw new Error('Configura PLANNING_SPREADSHEET_ID en Propiedades del script o ejecuta setProductionPlanningSpreadsheet(spreadsheetId).');
  }
  spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  properties.setProperty('PLANNING_SPREADSHEET_ID', spreadsheetId);

  PP_ensureWorkbook_(spreadsheet);
  return {
    ok: true,
    spreadsheetId: spreadsheetId,
    spreadsheetUrl: spreadsheet.getUrl(),
    appVersion: PP_APP_VERSION,
    schemaVersion: PP_SCHEMA_VERSION
  };
}

function setProductionPlanningSpreadsheet_(spreadsheetId) {
  if (!spreadsheetId) throw new Error('Falta spreadsheetId');
  const spreadsheet = SpreadsheetApp.openById(String(spreadsheetId).trim());
  PropertiesService.getScriptProperties().setProperty('PLANNING_SPREADSHEET_ID', spreadsheet.getId());
  PP_ensureWorkbook_(spreadsheet);
  return setupProductionPlanningApp();
}

function setProductionPlanningSpreadsheet(spreadsheetId) {
  return setProductionPlanningSpreadsheet_(spreadsheetId);
}

function initializeProductionPlanningDatabase(spreadsheetId) {
  const targetId = String(spreadsheetId || PP_DEFAULT_SPREADSHEET_ID || '').trim();
  if (!targetId) throw new Error('Indica el ID de la hoja: initializeProductionPlanningDatabase(spreadsheetId).');
  return setProductionPlanningSpreadsheet_(targetId);
}

function verifyProductionPlanningDatabase() {
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  const required = ['CONFIGURACION_OT', 'CONFIGURACION_ARTICULO', 'HERRAMENTALES', 'SUBCONTRATOS', 'TIPOS_OT', 'ESTADOS_OPERACION_PLAN', 'PLANES_HISTORICOS', 'BORRADOR_PLAN'];
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    tables: required.map(function(name) {
      const sheet = spreadsheet.getSheetByName(name);
      return {
        name: name,
        rows: Math.max(0, sheet.getLastRow() - 1),
        headers: PP_SHEETS[name]
      };
    })
  };
}

function getAppState() {
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  return PP_readState_(spreadsheet);
}

function PP_acquireScriptLock_(action, timeoutMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 30000)) {
    throw new Error('Otro proceso esta actualizando el plan. Espera unos segundos e intenta ' + action + ' nuevamente.');
  }
  return lock;
}

function saveAppState(payload) {
  if (!payload || !Array.isArray(payload.operations)) throw new Error('El plan no contiene operations');
  const lock = PP_acquireScriptLock_('guardar', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_writeState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
  } finally {
    lock.releaseLock();
  }
}

function saveCatalogState(payload) {
  if (!payload) throw new Error('El plan no contiene catalogos');
  const lock = PP_acquireScriptLock_('guardar catalogos', 15000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_writeCatalogState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
  } finally {
    lock.releaseLock();
  }
}

function saveSkillState(payload) {
  if (!payload) throw new Error('El plan no contiene matriz');
  const lock = PP_acquireScriptLock_('guardar matriz', 15000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_writeSkillState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
  } finally {
    lock.releaseLock();
  }
}

function savePlanSnapshot(payload) {
  if (!payload || !Array.isArray(payload.operations)) throw new Error('El plan no contiene operations');
  const lock = PP_acquireScriptLock_('guardar el plan', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_appendPlanSnapshot_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
  } finally {
    lock.releaseLock();
  }
}

function saveDraftSnapshot(payload) {
  if (!payload || !Array.isArray(payload.operations)) throw new Error('El borrador no contiene operations');
  const lock = PP_acquireScriptLock_('guardar borrador', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_replaceDraftSnapshot_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
  } finally {
    lock.releaseLock();
  }
}

function listPlanSnapshots() {
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  return PP_listPlanSnapshots_(spreadsheet);
}

function getPlanSnapshot(snapshotId) {
  if (!snapshotId) throw new Error('Falta snapshotId');
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  return PP_getPlanSnapshot_(spreadsheet, snapshotId);
}

function syncNetSuitePlant() {
  const snapshot = PP_fetchNetSuitePlantData_();
  const lock = PP_acquireScriptLock_('sincronizar', 60000);
  try {
    const spreadsheet = PP_getWorkbook_();
    const current = PP_readState_(spreadsheet);
    const synced = PP_applyNetSuitePlantData_(current, snapshot);
    PP_writeNetSuiteSyncState_(spreadsheet, synced, Session.getActiveUser().getEmail() || 'netsuite-sync');
    return PP_readState_(spreadsheet);
  } finally {
    lock.releaseLock();
  }
}

function syncNetSuiteWorkOrders() {
  const snapshot = PP_fetchNetSuiteWorkOrdersData_();
  const lock = PP_acquireScriptLock_('sincronizar OTs', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    const current = PP_readState_(spreadsheet);
    const synced = PP_applyNetSuiteWorkOrdersData_(current, snapshot);
    PP_writeNetSuiteWorkOrdersState_(spreadsheet, synced, Session.getActiveUser().getEmail() || 'netsuite-ots');
    return PP_readState_(spreadsheet);
  } finally {
    lock.releaseLock();
  }
}

function syncNetSuitePlanningData() {
  const spreadsheetForRead = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheetForRead);
  const baseCurrent = PP_readState_(spreadsheetForRead);
  const snapshot = PP_fetchNetSuitePlanningData_(baseCurrent);
  const lock = PP_acquireScriptLock_('sincronizar operaciones', 60000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    const current = PP_readState_(spreadsheet);
    const synced = PP_applyNetSuitePlanningData_(current, snapshot);
    PP_writeNetSuiteSyncState_(spreadsheet, synced, Session.getActiveUser().getEmail() || 'netsuite-operaciones');
    return PP_readState_(spreadsheet);
  } finally {
    lock.releaseLock();
  }
}

function getDeploymentStatus() {
  const properties = PropertiesService.getScriptProperties();
  return {
    ok: true,
    appVersion: PP_APP_VERSION,
    schemaVersion: PP_SCHEMA_VERSION,
    spreadsheetConfigured: Boolean(properties.getProperty('PLANNING_SPREADSHEET_ID') || PP_DEFAULT_SPREADSHEET_ID),
    spreadsheetId: properties.getProperty('PLANNING_SPREADSHEET_ID') || PP_DEFAULT_SPREADSHEET_ID,
    netSuiteConfigured: PP_hasNetSuiteCredentials_(),
    photoFolderConfigured: Boolean(PP_photoFolderId_()),
    user: Session.getActiveUser().getEmail() || ''
  };
}

function runProductionReadinessCheck(options) {
  options = options || {};
  const startedAt = new Date();
  const checks = [];
  function addCheck(name, status, detail, elapsedMs) {
    checks.push({ name: name, status: status, detail: detail || '', elapsedMs: Number(elapsedMs || 0) });
  }

  let spreadsheet;
  let state;
  const workbookStart = Date.now();
  try {
    spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    addCheck('GOOGLE_SHEETS_ACCESS', 'PASS', spreadsheet.getId(), Date.now() - workbookStart);
  } catch (error) {
    addCheck('GOOGLE_SHEETS_ACCESS', 'FAIL', error.message, Date.now() - workbookStart);
  }

  if (spreadsheet) {
    const missing = [];
    const invalidHeaders = [];
    Object.keys(PP_SHEETS).forEach(function(name) {
      const sheet = spreadsheet.getSheetByName(name);
      if (!sheet) {
        missing.push(name);
        return;
      }
      const expected = PP_SHEETS[name];
      const actual = sheet.getRange(1, 1, 1, expected.length).getDisplayValues()[0];
      if (actual.join('|') !== expected.join('|')) invalidHeaders.push(name);
    });
    addCheck('DATABASE_SCHEMA', missing.length || invalidHeaders.length ? 'FAIL' : 'PASS', JSON.stringify({ missing: missing, invalidHeaders: invalidHeaders }));

    const readStart = Date.now();
    try {
      state = PP_readState_(spreadsheet);
      const payloadBytes = JSON.stringify(state).length;
      const operationCount = (state.operations || []).length;
      const status = operationCount > 5000 || payloadBytes > 8 * 1024 * 1024 ? 'WARN' : 'PASS';
      addCheck('STATE_READ_VOLUME', status, JSON.stringify({ operations: operationCount, workOrders: (state.workOrders || []).length, payloadBytes: payloadBytes }), Date.now() - readStart);
    } catch (error) {
      addCheck('STATE_READ_VOLUME', 'FAIL', error.message, Date.now() - readStart);
    }
  }

  const lock = LockService.getScriptLock();
  const lockStart = Date.now();
  try {
    const acquired = lock.tryLock(5000);
    addCheck('CONCURRENCY_LOCK', acquired ? 'PASS' : 'FAIL', acquired ? 'LockService disponible' : 'No se obtuvo el bloqueo en 5 segundos', Date.now() - lockStart);
    if (acquired) lock.releaseLock();
  } catch (error) {
    addCheck('CONCURRENCY_LOCK', 'FAIL', error.message, Date.now() - lockStart);
  }

  try {
    const status = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL).getAuthorizationStatus();
    addCheck('OAUTH_AUTHORIZATION', String(status) === 'REQUIRED' ? 'FAIL' : 'PASS', String(status));
  } catch (error) {
    addCheck('OAUTH_AUTHORIZATION', 'WARN', error.message);
  }

  addCheck('NETSUITE_CREDENTIALS', PP_hasNetSuiteCredentials_() ? 'PASS' : 'FAIL', PP_hasNetSuiteCredentials_() ? 'Propiedades NS_* completas' : 'Faltan propiedades NS_*');
  if (options.liveNetSuite === true && PP_hasNetSuiteCredentials_()) {
    const netSuiteStart = Date.now();
    try {
      const config = PP_netSuiteConfig_();
      const probe = PP_fetchRestletPages_({ script: '1764', deploy: '1' }, { table: 'WO_LISTA', locationId: PP_PLANT_LOCATION_ID, onlyOpen: true }, config, 1);
      addCheck('NETSUITE_LIVE_READ', 'PASS', JSON.stringify({ rows: probe.rows.length, headers: probe.headers.length }), Date.now() - netSuiteStart);
    } catch (error) {
      addCheck('NETSUITE_LIVE_READ', 'FAIL', error.message, Date.now() - netSuiteStart);
    }
  } else {
    addCheck('NETSUITE_LIVE_READ', 'WARN', 'No ejecutada; usa {liveNetSuite:true} para probar lectura real');
  }

  try {
    const folderId = PP_photoFolderId_();
    if (!folderId) addCheck('PHOTO_FOLDER_ACCESS', 'WARN', 'Carpeta de fotos no configurada');
    else {
      DriveApp.getFolderById(folderId).getName();
      addCheck('PHOTO_FOLDER_ACCESS', 'PASS', folderId);
    }
  } catch (error) {
    addCheck('PHOTO_FOLDER_ACCESS', 'FAIL', error.message);
  }

  const failures = checks.filter(function(check) { return check.status === 'FAIL'; }).length;
  const warnings = checks.filter(function(check) { return check.status === 'WARN'; }).length;
  return {
    ok: failures === 0,
    appVersion: PP_APP_VERSION,
    schemaVersion: PP_SCHEMA_VERSION,
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    summary: { pass: checks.length - failures - warnings, warn: warnings, fail: failures },
    checks: checks,
    quotaNote: 'Apps Script no expone cuotas restantes; se validan volumen, tiempos y umbrales preventivos.'
  };
}
