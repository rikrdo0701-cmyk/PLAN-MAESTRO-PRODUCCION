const PP_APP_VERSION = '2.49.0';
const PP_SCHEMA_VERSION = 31;
const PP_RETENCION_PLANES_DIAS = 90;
const PP_DEFAULT_SPREADSHEET_ID = ''; // Configure PLANNING_SPREADSHEET_ID in Script Properties.

function PP_dateToIso_(value) {
  if (!value) return '';
  const text = String(value).trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const day = String(Number(match[1])).padStart(2, '0');
    const month = String(Number(match[2])).padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return value;
  return text;
}

function doGet(e) {
  if (PP_isBridgeRequest_(e)) return PP_createBridgeOutput_();
  const appName = PP_appNameFromRequest_(e);
  return HtmlService.createHtmlOutputFromFile(PP_appHtmlFile_(appName))
    .setTitle(PP_appTitle_(appName))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function PP_ensurePruneTrigger_() {
  const existing = ScriptApp.getProjectTriggers();
  for (let i = 0; i < existing.length; i += 1) {
    if (existing[i].getHandlerFunction() === 'pruneOldPlanSnapshots') {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger('pruneOldPlanSnapshots')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  return { ok: true, message: 'Trigger de poda diaria (3:00) instalado para pruneOldPlanSnapshots(' + PP_RETENCION_PLANES_DIAS + ' dias)' };
}

function setupPruneTrigger() {
  return PP_ensurePruneTrigger_();
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
  PP_ensurePruneTrigger_();
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

function getPlanningPureProbe_() {
  return { ok: true, appVersion: PP_APP_VERSION, schemaVersion: PP_SCHEMA_VERSION, source: 'pure-probe' };
}

function diagnoseOtOperatingStatuses(ot) {
  const target = String(ot || '').trim().toUpperCase();
  if (!target) throw new Error('Indica el numero de OT: diagnoseOtOperatingStatuses(ot)');
  const spreadsheet = PP_getWorkbook_();
  const statusRows = PP_readRows_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'));
  const operationRows = PP_readRows_(spreadsheet.getSheetByName('OPERACIONES'));
  const data = {
    ot: target,
    spreadsheetId: spreadsheet.getId(),
    statusRows: statusRows
      .filter(function(row) {
        return String(row.OT || '').toUpperCase() === target || String(row.KEY || '').toUpperCase().indexOf(target) >= 0;
      })
      .map(function(row) { return { KEY: row.KEY, ESTATUS_PLAN: row.ESTATUS_PLAN, OPERATION_ID: row.OPERATION_ID, OT: row.OT, SECUENCIA: row.SECUENCIA, CT: row.CT, FECHA_INICIO: row.FECHA_INICIO, FECHA_REAPERTURA: row.FECHA_REAPERTURA, ORIGEN: row.ORIGEN || 'draft' }; }),
    operationRows: operationRows
      .filter(function(row) { return String(row.OT || '').toUpperCase() === target; })
      .map(function(row) { return { ID: row.ID, OT: row.OT, SECUENCIA: row.SECUENCIA, CT: row.CT, DESC: row.DESCRIPCION, ESTATUS: row.ESTATUS, INICIO: row.FECHA_INICIO, FIN: row.FECHA_FIN, LOCKED: row.LOCKED }; })
  };
  Logger.log(JSON.stringify(data, null, 2));
  return data;
}

function diagnoseOt3124() {
  diagnoseOtOperatingStatuses('3124');
}

function reabrirTodoPlanificacion() {
  Logger.log(JSON.stringify(PP_clearAllOperationPlanStatuses_()));
}

function getPlanningProductionVersion() {
  const spreadsheet = PP_getWorkbook_();
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    appVersion: PP_APP_VERSION,
    schemaVersion: PP_SCHEMA_VERSION
  };
}

function resetPlanningEphemeralState() {
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);

  const clearBelowHeader = function(sheet) {
    if (!sheet) return 0;
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    return Math.max(0, lastRow - 1);
  };

  const cleared = {
    operations: clearBelowHeader(spreadsheet.getSheetByName('OPERACIONES')),
    operationStatuses: clearBelowHeader(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN')),
    draftPlan: clearBelowHeader(spreadsheet.getSheetByName('BORRADOR_PLAN')),
    publishedPlans: clearBelowHeader(spreadsheet.getSheetByName('PLANES_HISTORICOS')),
    snapshotPayloads: clearBelowHeader(spreadsheet.getSheetByName('SNAPSHOT_PAYLOADS'))
  };

  const cacheSheet = spreadsheet.getSheetByName(PP_STATE_CACHE_SHEET_);
  if (cacheSheet) cacheSheet.clearContents();

  const transientConfig = {
    schemaVersion: PP_SCHEMA_VERSION,
    appVersion: PP_APP_VERSION,
    revision: 0,
    savedAt: '',
    source: 'reset-planning-ephemeral',
    selectedOts: [],
    lockedOts: [],
    expandedOts: [],
    selectedOperationId: '',
    planStart: '',
    loadWeekStart: '',
    reportWeekStart: '',
    preparedPlanningByOt: {},
    closedWorkOrderSummaries: {},
    // Las marcas de por-confirmar de RULE-OT-051. En un arranque en frio la hoja no las tiene y
    // por lo tanto no hay ninguna OT sin evidencia de cierre: {} es el valor honesto, no falta.
    UNCONFIRMED_WORK_ORDERS: {},
    lastSchedule: null,
    PP_STATE_CACHE_REVISION: 0
  };
  PP_writeConfigPatch_(spreadsheet, transientConfig);
  SpreadsheetApp.flush();

  return {
    ok: true,
    message: 'Estado transitorio reiniciado: operaciones vacias, OTs de vuelta al backlog, sin completados, borradores ni planes.',
    revision: 0,
    cleared: cleared
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

function saveWorkOrderSyncState(payload) {
  if (!payload || !Array.isArray(payload.operations) || !Array.isArray(payload.workOrders)) throw new Error('La sincronizacion no contiene OTs u operaciones');
  const lock = PP_acquireScriptLock_('guardar sincronizacion de OTs', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_writeWorkOrderSyncState_(spreadsheet, payload, Session.getActiveUser().getEmail() || 'usuario');
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

// RETENCION POR ANTIGUEDAD DE LOS PLANES PUBLICADOS. Decision de la persona (2026-09-27).
// Se llama a mano para limpiar el atraso acumulado, y ademas se corre en cada publicacion.
//
// QUE PROTEGE, Y NO ES NEGOCIABLE:
//   - El borrador NUNCA se borra, ni por antiguedad ni por nada.
//   - El snapshot mas reciente por generatedAt NUNCA se borra, aunque sea viejo.
//   - Un snapshot SIN generatedAt NO se borra: se devuelve en sinFecha para que la persona decida.
//     La ausencia de fecha no es evidencia de antiguedad.
//
// QUE DEVUELVE: cuantos evaluo, cuantos borro, cuantas filas libera, cuales protegio y cuales
// dejo sin fecha. Si algo falla, el error sube: no hay catch silencioso.
//
// maxAgeDays es obligatorio. Sin el no se ejecuta, porque "borrar todo porque no me dijeron
// cuantos dias" es la peor respuesta posible a una pregunta mal hecha. Para la politica acordada
// (un mes) se llama pruneOldPlanSnapshots(30).
function pruneOldPlanSnapshots(maxAgeDays) {
  const dias = Number(maxAgeDays);
  if (!isFinite(dias) || dias <= 0) {
    throw new Error('pruneOldPlanSnapshots necesita maxAgeDays numerico y mayor que 0. Received: ' + maxAgeDays);
  }
  const lock = PP_acquireScriptLock_('podar planes antiguos', 120000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    return PP_pruneOldPlanSnapshots_(spreadsheet, dias, {});
  } finally {
    lock.releaseLock();
  }
}

// DIAGNOSTICO DE LA ANTIGUEDAD, SIN BORRAR NADA. Para fijar el corte con números y no con
// suposiciones: cuántos snapshots hay por rango de días, cuántos NO tienen fecha, y cuántos
// liberarían con el corte indicado. Usa la MISMA función que borra, con dryRun, para que la
// simulación no pueda divergir de lo que de verdad pasa.
function edadPlanSnapshots(maxAgeDays) {
  const dias = Number(maxAgeDays) > 0 ? Number(maxAgeDays) : 30;
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  return PP_pruneOldPlanSnapshots_(spreadsheet, dias, { dryRun: true });
}

// PUNTOS DE ENTRADA SIN ARGUMENTOS, para correr desde el editor de Apps Script. Las dos funciones
// de arriba piden maxAgeDays, y desde el editor no se le pasan argumentos: habria que escribir un
// wrapper a mano cada vez, que es justo lo que se quiere evitar. Estos dos fijan el corte de
// 90 dias, que es la politica acordada, y devuelven el resultado para pegarlo.
//
// OJO CON LA SEGUNDA: BORRA. La primera no toca nada.
function DIAG_EDAD_SNAPSHOTS() {
  return edadPlanSnapshots(PP_RETENCION_PLANES_DIAS);
}

function DIAG_PODA_SNAPSHOTS() {
  return pruneOldPlanSnapshots(PP_RETENCION_PLANES_DIAS);
}

function getPlanSnapshot(snapshotId) {
  if (!snapshotId) throw new Error('Falta snapshotId');
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  return PP_getPlanSnapshot_(spreadsheet, snapshotId);
}

function getPlanSnapshotLight(snapshotId) {
  if (!snapshotId) throw new Error('Falta snapshotId');
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  return PP_getPlanSnapshotLight_(spreadsheet, snapshotId);
}

function restorePublishedPlanAsDraft(snapshotId, currentPayload) {
  return PP_restorePublishedPlanAsDraft_(snapshotId, currentPayload);
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
