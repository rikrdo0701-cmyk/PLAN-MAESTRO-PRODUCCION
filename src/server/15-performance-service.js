/**
 * Endpoints ligeros para el frontend alojado en GitHub Pages.
 * Evitan leer o devolver el estado completo cuando la revision no cambio.
 */
function PP_appRevisionMetadata_(spreadsheet) {
  const config = PP_readConfig_(spreadsheet.getSheetByName('CONFIG'));
  return {
    ok: true,
    revision: Number(config.revision || 0),
    schemaVersion: Number(config.schemaVersion || PP_SCHEMA_VERSION),
    appVersion: String(config.appVersion || PP_APP_VERSION),
    savedAt: String(config.savedAt || ''),
    syncedAt: String(config.syncedAt || ''),
    source: String(config.source || 'apps-script-spreadsheet')
  };
}

function getAppRevision() {
  const spreadsheet = PP_getWorkbook_();
  return PP_appRevisionMetadata_(spreadsheet);
}

function getAppStateIfChanged(clientRevision, options) {
  options = options || {};
  const spreadsheet = PP_getWorkbook_();
  PP_ensureWorkbook_(spreadsheet);
  const metadata = PP_appRevisionMetadata_(spreadsheet);
  const knownRevision = Number(clientRevision || 0);

  if (knownRevision > 0 && knownRevision === metadata.revision) {
    return Object.assign({}, metadata, { unchanged: true });
  }

  const state = PP_readState_(spreadsheet);
  const includeMaterials = options.includeMaterials === true;
  if (!includeMaterials) state.materials = [];

  state.ok = true;
  state.unchanged = false;
  state.performance = {
    mode: 'STALE_WHILE_REVALIDATE',
    deferred: {
      materials: !includeMaterials,
      snapshots: true
    },
    revision: metadata.revision
  };
  return state;
}

function getMaterialsForOt(ot, clientRevision) {
  const target = PP_normalizeKey_(ot);
  if (!target) throw new Error('Falta OT para consultar materiales');
  const spreadsheet = PP_getWorkbook_();
  const metadata = PP_appRevisionMetadata_(spreadsheet);
  const materials = PP_readRows_(spreadsheet.getSheetByName('MATERIALES'))
    .map(PP_mapMaterial_)
    .filter(function(item) { return PP_normalizeKey_(item.ot) === target; });
  return Object.assign({}, metadata, {
    ot: String(ot || '').trim(),
    stale: Number(clientRevision || 0) > 0 && Number(clientRevision) !== metadata.revision,
    materials: materials
  });
}

/**
 * Guarda solo las tablas que cambian durante la planeacion diaria.
 * No reescribe catalogos, matriz, materiales ni calendario.
 */
function savePlanningStateOptimized(payload) {
  if (!payload || !Array.isArray(payload.operations)) throw new Error('El plan no contiene operations');
  const lock = PP_acquireScriptLock_('guardar plan optimizado', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    const currentConfig = PP_readConfig_(spreadsheet.getSheetByName('CONFIG'));
    const currentRevision = Number(currentConfig.revision || 0);
    const incomingRevision = Number(payload.revision || 0);
    if (incomingRevision !== currentRevision) {
      throw new Error('CONFLICT_REVISION: el plan cambio desde la ultima carga. Recarga antes de guardar.');
    }

    const revision = currentRevision + 1;
    const savedAt = new Date().toISOString();
    PP_writeConfigPatch_(spreadsheet, {
      schemaVersion: PP_SCHEMA_VERSION,
      appVersion: PP_APP_VERSION,
      revision: revision,
      savedAt: savedAt,
      ganttView: payload.ganttView || 'job',
      ganttDayWidth: Number(payload.ganttDayWidth || 180),
      selectedOperationId: payload.selectedOperationId || '',
      capacityMinutes: Number(payload.capacityMinutes || 2400),
      planStart: payload.planStart || '',
      horizonDays: Number(payload.horizonDays || 15),
      loadWeekStart: payload.loadWeekStart || '',
      reportWeekStart: payload.reportWeekStart || '',
      reportFilters: payload.reportFilters || {},
      preparedPlanningByOt: payload.preparedPlanningByOt || {},
      selectedOts: Array.isArray(payload.selectedOts) ? payload.selectedOts : [],
      lockedOts: Array.isArray(payload.lockedOts) ? payload.lockedOts : [],
      expandedOts: Array.isArray(payload.expandedOts) ? payload.expandedOts : [],
      plant: payload.plant || {},
      settings: payload.settings || {},
      lastSchedule: payload.lastSchedule || null
    });

    PP_writeTable_(spreadsheet.getSheetByName('OPERACIONES'), PP_SHEETS.OPERACIONES, PP_operationRows_(payload));
    PP_writeTable_(spreadsheet.getSheetByName('ORDENES_TRABAJO'), PP_SHEETS.ORDENES_TRABAJO, PP_workOrderRows_(payload));
    PP_writeTable_(spreadsheet.getSheetByName('CONFIGURACION_OT'), PP_SHEETS.CONFIGURACION_OT, PP_otConfigurationRows_(payload));
    PP_writeTable_(spreadsheet.getSheetByName('CONFIGURACION_ARTICULO'), PP_SHEETS.CONFIGURACION_ARTICULO, PP_articleConfigurationRows_(payload));
    PP_writeTable_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'), PP_SHEETS.ESTADOS_OPERACION_PLAN, PP_operationStatusRows_(payload));
    spreadsheet.getSheetByName('AUDITORIA').appendRow([
      savedAt,
      Session.getActiveUser().getEmail() || 'usuario',
      'GUARDAR_PLAN_OPTIMIZADO',
      revision,
      JSON.stringify({ operations: payload.operations.length, workOrders: (payload.workOrders || []).length })
    ]);
    SpreadsheetApp.flush();
    return PP_writeStateAck_(revision, savedAt, {
      syncedAt: payload.syncedAt || currentConfig.syncedAt || '',
      plant: payload.plant || currentConfig.plant || {},
      invoicePriceWindow: payload.invoicePriceWindow || currentConfig.invoicePriceWindow || null
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sincroniza solamente OTs y devuelve un payload reducido al navegador.
 */
function syncNetSuiteWorkOrdersLite() {
  const snapshot = PP_fetchNetSuiteWorkOrdersData_();
  const lock = PP_acquireScriptLock_('sincronizar OTs', 30000);
  try {
    const spreadsheet = PP_getWorkbook_();
    PP_ensureWorkbook_(spreadsheet);
    const config = PP_readConfig_(spreadsheet.getSheetByName('CONFIG'));
    const current = {
      revision: Number(config.revision || 0),
      selectedOts: Array.isArray(config.selectedOts) ? config.selectedOts : [],
      plant: config.plant || {},
      workOrders: PP_readRows_(spreadsheet.getSheetByName('ORDENES_TRABAJO')).map(PP_mapWorkOrder_),
      operationPlanStatuses: PP_buildOperationPlanStatuses_(
        PP_readRows_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'))
      )
    };
    const synced = PP_applyNetSuiteWorkOrdersData_(current, snapshot);
    const saved = PP_writeNetSuiteWorkOrdersState_(
      spreadsheet,
      synced,
      Session.getActiveUser().getEmail() || 'netsuite-ots'
    );
    return Object.assign({}, saved, {
      schemaVersion: PP_SCHEMA_VERSION,
      selectedOts: Array.isArray(config.selectedOts) ? config.selectedOts : [],
      workOrders: synced.workOrders || [],
      operationPlanStatuses: synced.operationPlanStatuses || {},
      plant: synced.plant || {},
      invoicePriceWindow: synced.invoicePriceWindow || null,
      source: synced.source || 'NetSuite RESTlets / Apps Script (OTs)'
    });
  } finally {
    lock.releaseLock();
  }
}

/** Lee OTs de NetSuite sin persistir ningun estado compartido. */
function fetchNetSuiteWorkOrdersLite() {
  const snapshot = PP_fetchNetSuiteWorkOrdersData_();
  return {
    schemaVersion: PP_SCHEMA_VERSION,
    workOrders: snapshot.workOrders || [],
    operationPlanStatuses: snapshot.operationPlanStatuses || {},
    plant: snapshot.plant || {},
    invoicePriceWindow: snapshot.invoicePriceWindow || null,
    syncedAt: snapshot.syncedAt || new Date().toISOString(),
    source: snapshot.source || 'NetSuite RESTlets / Apps Script (preview)'
  };
}
