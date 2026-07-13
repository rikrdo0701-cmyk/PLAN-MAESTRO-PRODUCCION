const PP_SHEETS = {
  CONFIG: ['KEY', 'VALUE'],
  OPERACIONES: [
    'ID', 'NUM', 'OT', 'PARTE', 'DESCRIPCION', 'CONTENIDO', 'PRIORIDAD', 'FECHA_REQ', 'CANT_TOTAL',
    'SECUENCIA', 'CT', 'OPERADOR', 'MAQUINA', 'HERRAMENTAL', 'KIT_HERRAMENTAL', 'CANT_PENDIENTE',
    'TIEMPO_CICLO', 'TIEMPO_SETUP', 'TIEMPO_PROD', 'FECHA_INICIO', 'HORA_INICIO', 'FECHA_FIN',
    'HORA_FIN', 'TIPO_INSERCION', 'ESTATUS', 'LOG', 'GENERATED_BY', 'LOCKED', 'DIAS_SUBCONTRATO', 'KIT_PENDIENTE', 'AUTO_FROZEN', 'TIPO_SUBCONTRATO',
    'HERRAMENTAL_ORIGEN', 'KIT_ORIGEN', 'HERRAMENTAL_DESTINO', 'KIT_DESTINO', 'COMENTARIO'
  ],
  OPERADORES: ['OPERADOR', 'ACTIVO', 'MINUTOS_CAPACIDAD', 'RENDIMIENTO_PCT', 'NOMBRE', 'CATEGORIA'],
  CAPACIDADES: ['KEY', 'CT', 'OPERACION', 'ACTIVA', 'CAPACIDAD', 'SOLAPAMIENTO', 'PALABRAS_CLAVE', 'REQUIERE_HERRAMENTAL', 'REQUIERE_KIT', 'CUSTOM', 'EFICIENCIA_PCT'],
  CATALOGO_OPERACIONES: ['KEY', 'CT', 'OPERACION', 'ORIGEN', 'ACTIVA'],
  ORDENES_TRABAJO: ['ID', 'WO_INTERNAL_ID', 'OT', 'ARTICULO', 'DESCRIPCION', 'FOTO_URL', 'FECHA_INICIO_NS', 'FECHA_FIN_NS', 'FECHA_VENCIMIENTO', 'FECHA_ENTREGA_AJUSTADA', 'CANTIDAD', 'ESTATUS', 'CLIENTE', 'CANT_ENSAMBLADA', 'CANT_PENDIENTE', 'PRECIO_PROMEDIO_VENTA', 'PRECIO_DESDE', 'PRECIO_HASTA'],
  CONFIGURACION_OT: ['OT', 'MAQUINA', 'KIT_HERRAMENTAL', 'KIT_PENDIENTE', 'TIPO_SUBCONTRATO', 'DIAS_SUBCONTRATO', 'ACTUALIZADO'],
  CONFIGURACION_ARTICULO: ['ARTICULO', 'TIPO_OT', 'TIPO_TRABAJO', 'PRECIO_MANUAL', 'ACTUALIZADO'],
  MATRIZ: ['CAPACIDAD_KEY', 'OPERADOR', 'HABILITADO'],
  MAQUINAS: ['ID', 'ACTIVA'],
  HERRAMENTALES: ['ID', 'PARTE', 'HERRAMENTAL', 'KIT_HERRAMENTAL', 'TIEMPO_AJUSTE_HERR', 'TIEMPO_AJUSTE_KIT', 'ACTIVO'],
  MATERIALES: ['ID', 'OT', 'WO_INTERNAL_ID', 'ENSAMBLE', 'COMPONENTE_ID', 'COMPONENTE', 'DESCRIPCION', 'UNIDAD', 'REQUERIDO', 'EMITIDO', 'PENDIENTE'],
  CALENDARIO: ['ID', 'CONCEPTO', 'MAQUINA', 'FECHA_INICIO', 'HORA_INICIO', 'FECHA_FIN', 'HORA_FIN', 'MOTIVO', 'ACTIVO'],
  SUBCONTRATOS: ['ID', 'PARTE', 'TIPO', 'DIAS_HABILES', 'ACTIVO'],
  TIPOS_OT: ['ID', 'NOMBRE', 'ACTIVO'],
  ESTADOS_OPERACION_PLAN: ['KEY', 'TIPO', 'ESTATUS_PLAN', 'OPERATION_ID', 'OT', 'SECUENCIA', 'CT', 'OPERADOR', 'MAQUINA', 'ARTICULO', 'DESCRIPCION', 'FECHA_INICIO', 'HORA_INICIO', 'FECHA_FIN', 'HORA_FIN', 'HERRAMENTAL_ORIGEN', 'KIT_ORIGEN', 'HERRAMENTAL_DESTINO', 'KIT_DESTINO', 'TOOL_KEY_DESTINO', 'FECHA_COMPLETADO', 'FECHA_REAPERTURA'],
  PLANES_HISTORICOS: ['SNAPSHOT_ID', 'FECHA_GENERACION', 'USUARIO', 'PLAN_INICIO', 'HORIZONTE_DIAS', 'NUM', 'OT', 'PARTE', 'OP', 'MAQ_AREA', 'OPERADOR', 'TC_MIN', 'TIEMPO_SETUP', 'TIEMPO_PROD', 'F_INICIO', 'H_INICIO', 'F_FIN', 'H_FIN', 'COMENTARIOS', 'PRIORIDAD', 'ESTATUS', 'BLOQUEADA', 'HERRAMENTAL', 'KIT_HERRAMENTAL', 'TIPO_SUBCONTRATO', 'DIAS_SUBCONTRATO', 'PZAS_PENDIENTES', 'TIPO_OT', 'PRECIO_UNITARIO', 'MONTO'],
  BORRADOR_PLAN: ['SNAPSHOT_ID', 'FECHA_GENERACION', 'USUARIO', 'PLAN_INICIO', 'HORIZONTE_DIAS', 'NUM', 'OT', 'PARTE', 'OP', 'MAQ_AREA', 'OPERADOR', 'TC_MIN', 'TIEMPO_SETUP', 'TIEMPO_PROD', 'F_INICIO', 'H_INICIO', 'F_FIN', 'H_FIN', 'COMENTARIOS', 'PRIORIDAD', 'ESTATUS', 'BLOQUEADA', 'HERRAMENTAL', 'KIT_HERRAMENTAL', 'TIPO_SUBCONTRATO', 'DIAS_SUBCONTRATO', 'PZAS_PENDIENTES', 'TIPO_OT', 'PRECIO_UNITARIO', 'MONTO'],
  AUDITORIA: ['FECHA', 'USUARIO', 'ACCION', 'REVISION', 'DETALLE']
};

const PP_OPERATION_FIELDS = {
  ID: 'id', NUM: 'num', OT: 'ot', PARTE: 'parte', DESCRIPCION: 'descripcion', CONTENIDO: 'contenido',
  PRIORIDAD: 'prioridad', FECHA_REQ: 'fechaReq', CANT_TOTAL: 'cantTotal', SECUENCIA: 'secuencia', CT: 'ct',
  OPERADOR: 'operador', MAQUINA: 'maquina', HERRAMENTAL: 'herramental', KIT_HERRAMENTAL: 'kitHerramental',
  CANT_PENDIENTE: 'cantPendiente', TIEMPO_CICLO: 'tiempoCiclo', TIEMPO_SETUP: 'tiempoSetup',
  TIEMPO_PROD: 'tiempoProd', FECHA_INICIO: 'fechaInicio', HORA_INICIO: 'horaInicio', FECHA_FIN: 'fechaFin',
  HORA_FIN: 'horaFin', TIPO_INSERCION: 'tipoInsercion', ESTATUS: 'estatus', LOG: 'log',
  GENERATED_BY: 'generatedBy', LOCKED: 'locked', DIAS_SUBCONTRATO: 'subcontractDays', KIT_PENDIENTE: 'kitPending', AUTO_FROZEN: 'autoFrozen', TIPO_SUBCONTRATO: 'subcontractType',
  HERRAMENTAL_ORIGEN: 'toolChangeFromHerramental', KIT_ORIGEN: 'toolChangeFromKit',
  HERRAMENTAL_DESTINO: 'toolChangeToHerramental', KIT_DESTINO: 'toolChangeToKit', COMENTARIO: 'comentario'
};

function PP_getWorkbook_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty('PLANNING_SPREADSHEET_ID');
  if (!spreadsheetId) {
    setupProductionPlanningApp();
    return SpreadsheetApp.openById(properties.getProperty('PLANNING_SPREADSHEET_ID'));
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function PP_ensureWorkbook_(spreadsheet) {
  Object.keys(PP_SHEETS).forEach(function(name) {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    const headers = PP_SHEETS[name];
    const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (current.join('|') !== headers.join('|')) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eef1');
  });

  const config = spreadsheet.getSheetByName('CONFIG');
  if (config.getLastRow() < 2) {
    PP_writeTable_(config, PP_SHEETS.CONFIG, [
      ['schemaVersion', JSON.stringify(PP_SCHEMA_VERSION)],
      ['revision', JSON.stringify(0)],
      ['appVersion', JSON.stringify(PP_APP_VERSION)]
    ]);
  }

  const subcontractSheet = spreadsheet.getSheetByName('SUBCONTRATOS');
  const subcontractRows = PP_readRows_(subcontractSheet);
  if (subcontractRows.length === 0) {
    const defaults = [
      ['sub-cromado', '*', 'CROMADO', 3, true],
      ['sub-metokote', '*', 'METOKOTE', 3, true],
      ['sub-maka', '*', 'MAKA', 3, true]
    ];
    subcontractSheet.getRange(2, 1, defaults.length, PP_SHEETS.SUBCONTRATOS.length).setValues(defaults);
  }

  const typeSheet = spreadsheet.getSheetByName('TIPOS_OT');
  if (PP_readRows_(typeSheet).length === 0) {
    const types = [
      ['tipo-oem', 'OEM', true],
      ['tipo-especial', 'ESPECIAL', true],
      ['tipo-linea', 'LINEA', true]
    ];
    typeSheet.getRange(2, 1, types.length, PP_SHEETS.TIPOS_OT.length).setValues(types);
  }
}

function PP_readState_(spreadsheet) {
  const config = PP_readConfig_(spreadsheet.getSheetByName('CONFIG'));
  const operationRows = PP_readRows_(spreadsheet.getSheetByName('OPERACIONES'));
  const capabilities = PP_readRows_(spreadsheet.getSheetByName('CAPACIDADES'));
  const matrixRows = PP_readRows_(spreadsheet.getSheetByName('MATRIZ'));
  const operators = PP_readRows_(spreadsheet.getSheetByName('OPERADORES'));
  const otConfigurationRows = PP_readRows_(spreadsheet.getSheetByName('CONFIGURACION_OT'));
  const articleConfigurationRows = PP_readRows_(spreadsheet.getSheetByName('CONFIGURACION_ARTICULO'));
  const operationStatusRows = PP_readRows_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'));

  const state = {
    schemaVersion: PP_SCHEMA_VERSION,
    revision: Number(config.revision || 0),
    source: config.source || 'apps-script-spreadsheet',
    savedAt: config.savedAt || '',
    syncedAt: config.syncedAt || '',
    invoicePriceWindow: config.invoicePriceWindow || null,
    ganttView: config.ganttView || 'job',
    ganttDayWidth: Number(config.ganttDayWidth || 180),
    selectedOperationId: config.selectedOperationId || '',
    capacityMinutes: Number(config.capacityMinutes || 2400),
    planStart: config.planStart || '',
    horizonDays: Number(config.horizonDays || 15),
    loadWeekStart: config.loadWeekStart || '',
    reportWeekStart: config.reportWeekStart || '',
    reportFilters: config.reportFilters || null,
    selectedOts: Array.isArray(config.selectedOts) ? config.selectedOts : null,
    lockedOts: Array.isArray(config.lockedOts) ? config.lockedOts : null,
    expandedOts: Array.isArray(config.expandedOts) ? config.expandedOts : null,
    workSchedule: config.workSchedule || null,
    dailyBreaks: config.dailyBreaks || null,
    plant: config.plant || { name: 'Planta MM del Llano', locationId: 1 },
    settings: config.settings || {},
    lastSchedule: config.lastSchedule || null,
    operators: operators.filter(function(row) { return PP_bool_(row.ACTIVO, true); }).map(function(row) { return String(row.OPERADOR || '').trim(); }).filter(Boolean),
    operatorCapacity: operators.reduce(function(out, row) {
      if (row.OPERADOR) out[row.OPERADOR] = Number(row.MINUTOS_CAPACIDAD || 0);
      return out;
    }, {}),
    cts: [],
    customCapabilities: [],
    configuredCapabilities: capabilities.filter(function(row) { return PP_bool_(row.ACTIVA, true); }).map(function(row) { return PP_normalizeCapabilityKey_(row.KEY); }).filter(Boolean),
    operationCatalog: PP_readRows_(spreadsheet.getSheetByName('CATALOGO_OPERACIONES')).map(PP_mapOperationCatalog_),
    workOrders: PP_readRows_(spreadsheet.getSheetByName('ORDENES_TRABAJO')).map(PP_mapWorkOrder_),
    otConfigurations: {},
    articleConfigurations: {},
    hiddenCapabilities: [],
    capacityModes: {},
    operationRules: {},
    matrix: {},
    operatorPerformance: operators.reduce(function(out, row) {
      const operator = String(row.OPERADOR || '').trim();
      const performance = Number(row.RENDIMIENTO_PCT || 0);
      if (operator && performance > 0) out[operator] = Math.max(1, Math.min(300, performance));
      return out;
    }, {}),
    operatorProfiles: operators.reduce(function(out, row) {
      const operator = String(row.OPERADOR || '').trim();
      if (operator && PP_bool_(row.ACTIVO, true)) {
        out[operator] = {
          name: String(row.NOMBRE || operator).trim() || operator,
          category: PP_normalizeResourceCategory_(row.CATEGORIA, operator)
        };
      }
      return out;
    }, {}),
    machines: PP_readRows_(spreadsheet.getSheetByName('MAQUINAS')).map(PP_mapMachine_),
    toolCatalog: PP_readRows_(spreadsheet.getSheetByName('HERRAMENTALES')).map(PP_mapTool_),
    machineToolHistory: PP_readMachineToolHistory_(spreadsheet),
    materials: PP_readRows_(spreadsheet.getSheetByName('MATERIALES')).map(PP_mapMaterial_),
    calendarExceptions: PP_readRows_(spreadsheet.getSheetByName('CALENDARIO')).map(PP_mapCalendar_),
    subcontracts: PP_readRows_(spreadsheet.getSheetByName('SUBCONTRATOS')).map(PP_mapSubcontract_),
    otTypes: PP_readRows_(spreadsheet.getSheetByName('TIPOS_OT')).map(function(row) {
      return { id: String(row.ID || ''), name: String(row.NOMBRE || '').trim().toUpperCase(), active: PP_bool_(row.ACTIVO, true) };
    }).filter(function(item) { return Boolean(item.name); }),
    operationPlanStatuses: PP_buildOperationPlanStatuses_(operationStatusRows),
    operations: operationRows.map(PP_mapOperation_)
  };

  capabilities.forEach(function(row) {
    const key = PP_normalizeCapabilityKey_(row.KEY);
    const ct = String(row.CT || '').trim();
    if (!key) return;
    if (ct && state.cts.indexOf(ct) < 0) state.cts.push(ct);
    if (!PP_bool_(row.ACTIVA, true)) state.hiddenCapabilities.push(key);
    state.capacityModes[key] = String(row.CAPACIDAD || 'FINITA').toUpperCase();
    state.operationRules[key] = {
      overlap: Number(row.SOLAPAMIENTO || 1),
      efficiency: Math.max(1, Math.min(100, Number(row.EFICIENCIA_PCT || 100))),
      keywords: String(row.PALABRAS_CLAVE || ''),
      requiresTool: PP_bool_(row.REQUIERE_HERRAMENTAL, false),
      requiresKit: PP_bool_(row.REQUIERE_KIT, false)
    };
    if (PP_bool_(row.CUSTOM, false)) state.customCapabilities.push({ key: key, ct: ct, label: String(row.OPERACION || 'OPERACION') });
  });

  matrixRows.forEach(function(row) {
    if (!PP_bool_(row.HABILITADO, true)) return;
    const key = PP_normalizeCapabilityKey_(row.CAPACIDAD_KEY);
    const operator = String(row.OPERADOR || '').trim();
    if (!key || !operator) return;
    if (!state.matrix[key]) state.matrix[key] = [];
    if (state.matrix[key].indexOf(operator) < 0) state.matrix[key].push(operator);
  });

  state.operations.forEach(function(op) {
    if (op.ct && state.cts.indexOf(op.ct) < 0) state.cts.push(op.ct);
  });
  state.otConfigurations = PP_buildOtConfigurations_(otConfigurationRows, state.operations);
  state.articleConfigurations = PP_buildArticleConfigurations_(articleConfigurationRows, otConfigurationRows, state.workOrders, state.operations);
  return state;
}

function PP_writeCatalogState_(spreadsheet, payload, user) {
  PP_writeTable_(spreadsheet.getSheetByName('CONFIGURACION_OT'), PP_SHEETS.CONFIGURACION_OT, PP_otConfigurationRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('CONFIGURACION_ARTICULO'), PP_SHEETS.CONFIGURACION_ARTICULO, PP_articleConfigurationRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('MAQUINAS'), PP_SHEETS.MAQUINAS, (payload.machines || []).map(function(item) { return [item.id || item.machine || item.maquina, item.active !== false]; }));
  PP_writeTable_(spreadsheet.getSheetByName('HERRAMENTALES'), PP_SHEETS.HERRAMENTALES, (payload.toolCatalog || []).map(function(item) {
    return [item.id, item.part || item.parte, item.herramental, item.kitHerramental, Number(item.toolSetupMinutes || 0), Number(item.kitSetupMinutes || 0), item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('CALENDARIO'), PP_SHEETS.CALENDARIO, (payload.calendarExceptions || []).map(function(item) {
    return [item.id, item.concept || item.concepto || 'GENERAL', item.machine || item.maquina || '', item.startDate || item.fechaInicio, item.start, item.endDate || item.fechaFin, item.end, item.reason || item.motivo || '', item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('SUBCONTRATOS'), PP_SHEETS.SUBCONTRATOS, (payload.subcontracts || []).map(function(item) {
    return [item.id, item.part || item.parte || '*', item.name || item.tipo, Number(item.days || item.dias || 3), item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('TIPOS_OT'), PP_SHEETS.TIPOS_OT, (payload.otTypes || []).map(function(item) {
    return [item.id, String(item.name || item.nombre || '').trim().toUpperCase(), item.active !== false];
  }));
  return PP_finishPartialWrite_(spreadsheet, payload, user, 'GUARDAR_CATALOGOS', {
    workSchedule: payload.workSchedule || {},
    dailyBreaks: payload.dailyBreaks || {},
    settings: payload.settings || {}
  }, {
    machines: (payload.machines || []).length,
    tools: (payload.toolCatalog || []).length,
    subcontracts: (payload.subcontracts || []).length
  });
}

function PP_writeSkillState_(spreadsheet, payload, user) {
  PP_writeTable_(spreadsheet.getSheetByName('OPERADORES'), PP_SHEETS.OPERADORES, PP_operatorRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('CAPACIDADES'), PP_SHEETS.CAPACIDADES, PP_capabilityRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('CATALOGO_OPERACIONES'), PP_SHEETS.CATALOGO_OPERACIONES, (payload.operationCatalog || payload.capabilities || []).map(function(item) {
    return [item.key, item.ct, item.label || item.operation, item.source || 'NETSUITE', item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('MATRIZ'), PP_SHEETS.MATRIZ, PP_matrixRows_(payload));
  return PP_finishPartialWrite_(spreadsheet, payload, user, 'GUARDAR_MATRIZ', {
    capacityMinutes: Number(payload.capacityMinutes || 2400),
    settings: payload.settings || {}
  }, {
    operators: (payload.operators || []).length,
    capabilities: (payload.configuredCapabilities || []).length
  });
}

function PP_writeNetSuiteSyncState_(spreadsheet, payload, user) {
  const savedAt = new Date().toISOString();
  const revision = PP_nextRevision_(spreadsheet);
  PP_writeConfigPatch_(spreadsheet, {
    schemaVersion: PP_SCHEMA_VERSION,
    appVersion: PP_APP_VERSION,
    revision: revision,
    savedAt: savedAt,
    source: payload.source || 'NetSuite RESTlets / Apps Script',
    syncedAt: payload.syncedAt || savedAt,
    plant: payload.plant || {},
    invoicePriceWindow: payload.invoicePriceWindow || null
  });
  PP_writeTable_(spreadsheet.getSheetByName('OPERACIONES'), PP_SHEETS.OPERACIONES, PP_operationRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('CATALOGO_OPERACIONES'), PP_SHEETS.CATALOGO_OPERACIONES, (payload.operationCatalog || []).map(function(item) {
    return [item.key, item.ct, item.label || item.operation, item.source || 'NETSUITE', item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('ORDENES_TRABAJO'), PP_SHEETS.ORDENES_TRABAJO, PP_workOrderRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('MATERIALES'), PP_SHEETS.MATERIALES, PP_materialRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'), PP_SHEETS.ESTADOS_OPERACION_PLAN, PP_operationStatusRows_(payload));
  spreadsheet.getSheetByName('AUDITORIA').appendRow([savedAt, user, 'SINCRONIZAR_NETSUITE', revision, JSON.stringify({
    operations: (payload.operations || []).length,
    workOrders: (payload.workOrders || []).length,
    materials: (payload.materials || []).length
  })]);
  SpreadsheetApp.flush();
  return PP_writeStateAck_(revision, savedAt, {
    syncedAt: payload.syncedAt || savedAt,
    plant: payload.plant || {},
    invoicePriceWindow: payload.invoicePriceWindow || null
  });
}

function PP_writeNetSuiteWorkOrdersState_(spreadsheet, payload, user) {
  const savedAt = new Date().toISOString();
  const revision = PP_nextRevision_(spreadsheet);
  PP_writeConfigPatch_(spreadsheet, {
    schemaVersion: PP_SCHEMA_VERSION,
    appVersion: PP_APP_VERSION,
    revision: revision,
    savedAt: savedAt,
    source: payload.source || 'NetSuite RESTlets / Apps Script (OTs)',
    syncedAt: payload.syncedAt || savedAt,
    plant: payload.plant || {},
    invoicePriceWindow: payload.invoicePriceWindow || null
  });
  PP_writeTable_(spreadsheet.getSheetByName('ORDENES_TRABAJO'), PP_SHEETS.ORDENES_TRABAJO, PP_workOrderRows_(payload));
  PP_writeTable_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'), PP_SHEETS.ESTADOS_OPERACION_PLAN, PP_operationStatusRows_(payload));
  spreadsheet.getSheetByName('AUDITORIA').appendRow([savedAt, user, 'SINCRONIZAR_NETSUITE_OT', revision, JSON.stringify({
    workOrders: (payload.workOrders || []).length
  })]);
  SpreadsheetApp.flush();
  return PP_writeStateAck_(revision, savedAt, {
    syncedAt: payload.syncedAt || savedAt,
    plant: payload.plant || {},
    invoicePriceWindow: payload.invoicePriceWindow || null
  });
}

function PP_finishPartialWrite_(spreadsheet, payload, user, action, configPatch, detail) {
  const savedAt = new Date().toISOString();
  const revision = PP_nextRevision_(spreadsheet);
  PP_writeConfigPatch_(spreadsheet, Object.assign({
    schemaVersion: PP_SCHEMA_VERSION,
    appVersion: PP_APP_VERSION,
    revision: revision,
    savedAt: savedAt
  }, configPatch || {}));
  spreadsheet.getSheetByName('AUDITORIA').appendRow([savedAt, user, action, revision, JSON.stringify(detail || {})]);
  SpreadsheetApp.flush();
  return PP_writeStateAck_(revision, savedAt);
}

function PP_nextRevision_(spreadsheet) {
  const currentConfig = PP_readConfig_(spreadsheet.getSheetByName('CONFIG'));
  return Number(currentConfig.revision || 0) + 1;
}

function PP_writeConfigPatch_(spreadsheet, patch) {
  const sheet = spreadsheet.getSheetByName('CONFIG');
  const config = PP_readConfig_(sheet);
  Object.keys(patch || {}).forEach(function(key) { config[key] = patch[key]; });
  const preferred = ['schemaVersion', 'appVersion', 'revision', 'savedAt', 'source', 'syncedAt'];
  const keys = preferred.concat(Object.keys(config).filter(function(key) { return preferred.indexOf(key) < 0; }).sort());
  PP_writeTable_(sheet, PP_SHEETS.CONFIG, keys.map(function(key) { return [key, JSON.stringify(config[key])]; }));
}

function PP_writeStateAck_(revision, savedAt, extra) {
  return Object.assign({ ok: true, revision: revision, savedAt: savedAt }, extra || {});
}

function PP_operationRows_(payload) {
  return (payload.operations || []).map(function(op) {
    return PP_SHEETS.OPERACIONES.map(function(header) { return PP_cellValue_(op[PP_OPERATION_FIELDS[header]]); });
  });
}

function PP_operatorRows_(payload) {
  return (payload.operators || []).map(function(operator) {
    const profile = (payload.operatorProfiles || {})[operator] || {};
    return [
      operator,
      true,
      Number((payload.operatorCapacity || {})[operator] || payload.capacityMinutes || 2400),
      Math.max(1, Number((payload.operatorPerformance || {})[operator] || 100)),
      String(profile.name || operator).trim() || operator,
      PP_normalizeResourceCategory_(profile.category, operator)
    ];
  });
}

function PP_capabilityRows_(payload) {
  const operationCatalog = Array.isArray(payload.operationCatalog || payload.capabilities) ? (payload.operationCatalog || payload.capabilities) : [];
  const catalogByKey = {};
  operationCatalog.forEach(function(item) {
    const key = PP_normalizeCapabilityKey_(item.key || (String(item.ct || '') + '::' + PP_normalizeKey_(item.label || item.operation || '')));
    if (key) catalogByKey[key] = { key: key, ct: String(item.ct || '').trim(), label: String(item.label || item.operation || '').trim(), custom: false };
  });
  const configuredKeys = Array.isArray(payload.configuredCapabilities)
    ? payload.configuredCapabilities.map(PP_normalizeCapabilityKey_)
    : (operationCatalog.length ? operationCatalog.map(function(item) {
      return PP_normalizeCapabilityKey_(item.key || (String(item.ct || '') + '::' + PP_normalizeKey_(item.label || item.operation || '')));
    }) : (payload.operations || []).map(function(op) {
      return PP_normalizeCapabilityKey_(String(op.ct || 'SIN_CT') + '::' + PP_normalizeKey_(op.descripcion || op.tipoInsercion || 'OPERACION'));
    }));
  const capabilityMap = {};
  configuredKeys.forEach(function(key) {
    const item = catalogByKey[key] || PP_capabilityFromKey_(key);
    if (item && item.key) capabilityMap[item.key] = item;
  });
  (payload.customCapabilities || []).forEach(function(item) {
    const key = PP_normalizeCapabilityKey_(item.key);
    if (key && configuredKeys.indexOf(key) >= 0) capabilityMap[key] = { key: key, ct: item.ct, label: item.label, custom: true };
  });
  return Object.keys(capabilityMap).sort().map(function(key) {
    const item = capabilityMap[key];
    const rule = (payload.operationRules || {})[key] || (payload.operationRules || {})[item.ct] || {};
    return [
      key,
      item.ct,
      item.label,
      (payload.hiddenCapabilities || []).indexOf(key) < 0,
      (payload.capacityModes || {})[key] || (payload.capacityModes || {})[item.ct] || 'FINITA',
      Number(rule.overlap == null ? 1 : rule.overlap),
      Array.isArray(rule.keywords) ? rule.keywords.join(', ') : String(rule.keywords || ''),
      rule.requiresTool === true,
      rule.requiresKit === true,
      item.custom,
      Math.max(1, Math.min(100, Number(rule.efficiency == null ? 100 : rule.efficiency)))
    ];
  });
}

function PP_matrixRows_(payload) {
  const matrixRows = [];
  Object.keys(payload.matrix || {}).forEach(function(key) {
    (payload.matrix[key] || []).forEach(function(operator) {
      matrixRows.push([key, operator, true]);
    });
  });
  return matrixRows;
}

function PP_workOrderRows_(payload) {
  return (payload.workOrders || []).map(function(item) {
    return [item.id, item.workOrderId, item.ot, item.item, item.description, item.photoUrl, item.startDate, item.endDate, item.dueDate, item.dueDateOverride || '', Number(item.quantity || 0), item.status, item.customer, Number(item.builtQuantity || 0), Number(item.pendingQuantity || 0), Number(item.averageSalePrice || 0), item.averageSalePriceFrom || '', item.averageSalePriceTo || ''];
  });
}

function PP_otConfigurationRows_(payload) {
  return Object.keys(payload.otConfigurations || {}).sort().map(function(ot) {
    const item = payload.otConfigurations[ot] || {};
    return [
      item.ot || ot,
      item.machine || item.maquina || '',
      item.kitHerramental || item.kit || '',
      item.kitPending === true,
      item.subcontractType || item.tipoSubcontrato || '',
      Number(item.subcontractDays || item.diasSubcontrato || 0),
      item.updatedAt || item.actualizado || new Date().toISOString()
    ];
  });
}

function PP_articleConfigurationRows_(payload) {
  return Object.keys(payload.articleConfigurations || {}).sort().map(function(article) {
    const item = payload.articleConfigurations[article] || {};
    return [
      String(item.article || item.articulo || article || '').trim().toUpperCase(),
      String(item.jobType || item.tipoOt || '').trim().toUpperCase(),
      String(item.planningType || item.tipoTrabajo || '').trim().toUpperCase(),
      Number(item.manualUnitPrice || item.precioManual || 0),
      item.updatedAt || item.actualizado || new Date().toISOString()
    ];
  });
}

function PP_materialRows_(payload) {
  return (payload.materials || []).map(function(item) {
    return [item.id, item.ot, item.workOrderId, item.assembly, item.componentId, item.component, item.description, item.unit, Number(item.required || 0), Number(item.issued || 0), Number(item.pending || 0)];
  });
}

function PP_operationStatusRows_(payload) {
  const statusRows = Array.isArray(payload.operationPlanStatuses)
    ? payload.operationPlanStatuses
    : Object.keys(payload.operationPlanStatuses || {}).map(function(key) { return Object.assign({ key: key }, payload.operationPlanStatuses[key]); });
  return statusRows.map(function(item) {
    return [
      item.key || item.completionKey || '', item.type || item.tipo || 'OPERATION', item.status || item.planStatus || 'PENDIENTE',
      item.operationId || '', item.ot || '', Number(item.sequence || item.secuencia || 0), item.ct || '', item.operator || item.operador || '',
      item.machine || item.maquina || '', item.article || item.articulo || '', item.description || item.descripcion || '',
      item.startDate || item.fechaInicio || '', item.startTime || item.horaInicio || '', item.endDate || item.fechaFin || '', item.endTime || item.horaFin || '',
      item.fromHerramental || '', item.fromKit || '', item.toHerramental || '', item.toKit || '', item.toToolKey || item.toolKey || '',
      item.completedAt || '', item.reopenedAt || ''
    ];
  });
}

function PP_writeState_(spreadsheet, payload, user, force) {
  const currentConfig = PP_readConfig_(spreadsheet.getSheetByName('CONFIG'));
  const currentRevision = Number(currentConfig.revision || 0);
  const incomingRevision = Number(payload.revision || 0);
  if (!force && incomingRevision !== currentRevision) {
    throw new Error('CONFLICT_REVISION: el plan cambio desde la ultima carga. Recarga antes de guardar.');
  }

  const revision = currentRevision + 1;
  const savedAt = new Date().toISOString();
  const configRows = [
    ['schemaVersion', JSON.stringify(PP_SCHEMA_VERSION)],
    ['appVersion', JSON.stringify(PP_APP_VERSION)],
    ['revision', JSON.stringify(revision)],
    ['savedAt', JSON.stringify(savedAt)],
    ['ganttView', JSON.stringify(payload.ganttView || 'job')],
    ['ganttDayWidth', JSON.stringify(Number(payload.ganttDayWidth || 180))],
    ['selectedOperationId', JSON.stringify(payload.selectedOperationId || '')],
    ['capacityMinutes', JSON.stringify(Number(payload.capacityMinutes || 2400))],
    ['planStart', JSON.stringify(payload.planStart || '')],
    ['horizonDays', JSON.stringify(Number(payload.horizonDays || 15))],
    ['loadWeekStart', JSON.stringify(payload.loadWeekStart || '')],
    ['reportWeekStart', JSON.stringify(payload.reportWeekStart || '')],
    ['reportFilters', JSON.stringify(payload.reportFilters || {})],
    ['selectedOts', JSON.stringify(Array.isArray(payload.selectedOts) ? payload.selectedOts : [])],
    ['lockedOts', JSON.stringify(Array.isArray(payload.lockedOts) ? payload.lockedOts : [])],
    ['expandedOts', JSON.stringify(Array.isArray(payload.expandedOts) ? payload.expandedOts : [])],
    ['workSchedule', JSON.stringify(payload.workSchedule || {})],
    ['dailyBreaks', JSON.stringify(payload.dailyBreaks || {})],
    ['plant', JSON.stringify(payload.plant || {})],
    ['settings', JSON.stringify(payload.settings || {})],
    ['lastSchedule', JSON.stringify(payload.lastSchedule || null)]
  ];
  PP_writeTable_(spreadsheet.getSheetByName('CONFIG'), PP_SHEETS.CONFIG, configRows);

  PP_writeTable_(spreadsheet.getSheetByName('OPERACIONES'), PP_SHEETS.OPERACIONES,
    (payload.operations || []).map(function(op) {
      return PP_SHEETS.OPERACIONES.map(function(header) { return PP_cellValue_(op[PP_OPERATION_FIELDS[header]]); });
    }));

  PP_writeTable_(spreadsheet.getSheetByName('OPERADORES'), PP_SHEETS.OPERADORES,
    (payload.operators || []).map(function(operator) {
      const profile = (payload.operatorProfiles || {})[operator] || {};
      return [
        operator,
        true,
        Number((payload.operatorCapacity || {})[operator] || payload.capacityMinutes || 2400),
        Math.max(1, Number((payload.operatorPerformance || {})[operator] || 100)),
        String(profile.name || operator).trim() || operator,
        PP_normalizeResourceCategory_(profile.category, operator)
      ];
    }));

  const operationCatalog = Array.isArray(payload.operationCatalog) ? payload.operationCatalog : [];
  const catalogByKey = {};
  operationCatalog.forEach(function(item) {
    const key = PP_normalizeCapabilityKey_(item.key || (String(item.ct || '') + '::' + PP_normalizeKey_(item.label || item.operation || '')));
    if (key) catalogByKey[key] = { key: key, ct: String(item.ct || '').trim(), label: String(item.label || item.operation || '').trim(), custom: false };
  });
  const configuredKeys = Array.isArray(payload.configuredCapabilities)
    ? payload.configuredCapabilities.map(PP_normalizeCapabilityKey_)
    : (payload.operations || []).map(function(op) {
      return PP_normalizeCapabilityKey_(String(op.ct || 'SIN_CT') + '::' + PP_normalizeKey_(op.descripcion || op.tipoInsercion || 'OPERACION'));
    });
  const capabilityMap = {};
  configuredKeys.forEach(function(key) {
    const item = catalogByKey[key] || PP_capabilityFromKey_(key);
    if (item && item.key) capabilityMap[item.key] = item;
  });
  (payload.customCapabilities || []).forEach(function(item) {
    const key = PP_normalizeCapabilityKey_(item.key);
    if (key && configuredKeys.indexOf(key) >= 0) capabilityMap[key] = { key: key, ct: item.ct, label: item.label, custom: true };
  });
  const capabilityRows = Object.keys(capabilityMap).sort().map(function(key) {
    const item = capabilityMap[key];
    const rule = (payload.operationRules || {})[key] || (payload.operationRules || {})[item.ct] || {};
    return [
      key,
      item.ct,
      item.label,
      (payload.hiddenCapabilities || []).indexOf(key) < 0,
      (payload.capacityModes || {})[key] || (payload.capacityModes || {})[item.ct] || 'FINITA',
      Number(rule.overlap == null ? 1 : rule.overlap),
      Array.isArray(rule.keywords) ? rule.keywords.join(', ') : String(rule.keywords || ''),
      rule.requiresTool === true,
      rule.requiresKit === true,
      item.custom,
      Math.max(1, Math.min(100, Number(rule.efficiency == null ? 100 : rule.efficiency)))
    ];
  });
  PP_writeTable_(spreadsheet.getSheetByName('CAPACIDADES'), PP_SHEETS.CAPACIDADES, capabilityRows);
  PP_writeTable_(spreadsheet.getSheetByName('CATALOGO_OPERACIONES'), PP_SHEETS.CATALOGO_OPERACIONES, operationCatalog.map(function(item) {
    return [item.key, item.ct, item.label || item.operation, item.source || 'NETSUITE', item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('ORDENES_TRABAJO'), PP_SHEETS.ORDENES_TRABAJO, (payload.workOrders || []).map(function(item) {
    return [item.id, item.workOrderId, item.ot, item.item, item.description, item.photoUrl, item.startDate, item.endDate, item.dueDate, item.dueDateOverride || '', Number(item.quantity || 0), item.status, item.customer, Number(item.builtQuantity || 0), Number(item.pendingQuantity || 0), Number(item.averageSalePrice || 0), item.averageSalePriceFrom || '', item.averageSalePriceTo || ''];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('CONFIGURACION_OT'), PP_SHEETS.CONFIGURACION_OT,
    Object.keys(payload.otConfigurations || {}).sort().map(function(ot) {
      const item = payload.otConfigurations[ot] || {};
      return [
        item.ot || ot,
        item.machine || item.maquina || '',
        item.kitHerramental || item.kit || '',
        item.kitPending === true,
        item.subcontractType || item.tipoSubcontrato || '',
        Number(item.subcontractDays || item.diasSubcontrato || 0),
        item.updatedAt || item.actualizado || new Date().toISOString()
      ];
    }));
  PP_writeTable_(spreadsheet.getSheetByName('CONFIGURACION_ARTICULO'), PP_SHEETS.CONFIGURACION_ARTICULO,
    Object.keys(payload.articleConfigurations || {}).sort().map(function(article) {
      const item = payload.articleConfigurations[article] || {};
      return [
        String(item.article || item.articulo || article || '').trim().toUpperCase(),
        String(item.jobType || item.tipoOt || '').trim().toUpperCase(),
        String(item.planningType || item.tipoTrabajo || '').trim().toUpperCase(),
        Number(item.manualUnitPrice || item.precioManual || 0),
        item.updatedAt || item.actualizado || new Date().toISOString()
      ];
    }));

  const matrixRows = [];
  Object.keys(payload.matrix || {}).forEach(function(key) {
    (payload.matrix[key] || []).forEach(function(operator) {
      matrixRows.push([key, operator, true]);
    });
  });
  PP_writeTable_(spreadsheet.getSheetByName('MATRIZ'), PP_SHEETS.MATRIZ, matrixRows);
  PP_writeTable_(spreadsheet.getSheetByName('MAQUINAS'), PP_SHEETS.MAQUINAS, (payload.machines || []).map(function(item) { return [item.id || item.machine || item.maquina, item.active !== false]; }));
  PP_writeTable_(spreadsheet.getSheetByName('HERRAMENTALES'), PP_SHEETS.HERRAMENTALES, (payload.toolCatalog || []).map(function(item) {
    return [item.id, item.part || item.parte, item.herramental, item.kitHerramental, Number(item.toolSetupMinutes || 0), Number(item.kitSetupMinutes || 0), item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('MATERIALES'), PP_SHEETS.MATERIALES, (payload.materials || []).map(function(item) {
    return [item.id, item.ot, item.workOrderId, item.assembly, item.componentId, item.component, item.description, item.unit, Number(item.required || 0), Number(item.issued || 0), Number(item.pending || 0)];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('CALENDARIO'), PP_SHEETS.CALENDARIO, (payload.calendarExceptions || []).map(function(item) {
    return [item.id, item.concept || item.concepto || 'GENERAL', item.machine || item.maquina || '', item.startDate || item.fechaInicio, item.start, item.endDate || item.fechaFin, item.end, item.reason || item.motivo || '', item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('SUBCONTRATOS'), PP_SHEETS.SUBCONTRATOS, (payload.subcontracts || []).map(function(item) {
    return [item.id, item.part || item.parte || '*', item.name || item.tipo, Number(item.days || item.dias || 3), item.active !== false];
  }));
  PP_writeTable_(spreadsheet.getSheetByName('TIPOS_OT'), PP_SHEETS.TIPOS_OT, (payload.otTypes || []).map(function(item) {
    return [item.id, String(item.name || item.nombre || '').trim().toUpperCase(), item.active !== false];
  }));
  const statusRows = Array.isArray(payload.operationPlanStatuses)
    ? payload.operationPlanStatuses
    : Object.keys(payload.operationPlanStatuses || {}).map(function(key) { return Object.assign({ key: key }, payload.operationPlanStatuses[key]); });
  PP_writeTable_(spreadsheet.getSheetByName('ESTADOS_OPERACION_PLAN'), PP_SHEETS.ESTADOS_OPERACION_PLAN, statusRows.map(function(item) {
    return [
      item.key || item.completionKey || '', item.type || item.tipo || 'OPERATION', item.status || item.planStatus || 'PENDIENTE',
      item.operationId || '', item.ot || '', Number(item.sequence || item.secuencia || 0), item.ct || '', item.operator || item.operador || '',
      item.machine || item.maquina || '', item.article || item.articulo || '', item.description || item.descripcion || '',
      item.startDate || item.fechaInicio || '', item.startTime || item.horaInicio || '', item.endDate || item.fechaFin || '', item.endTime || item.horaFin || '',
      item.fromHerramental || '', item.fromKit || '', item.toHerramental || '', item.toKit || '', item.toToolKey || item.toolKey || '',
      item.completedAt || '', item.reopenedAt || ''
    ];
  }));
  const audit = spreadsheet.getSheetByName('AUDITORIA');
  audit.appendRow([savedAt, user, 'GUARDAR_PLAN', revision, JSON.stringify({ operations: (payload.operations || []).length })]);
  SpreadsheetApp.flush();
  const saved = PP_readState_(spreadsheet);
  saved.ok = true;
  return saved;
}

function PP_readRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getDisplayValues();
  const headers = values.shift();
  return values.filter(function(row) { return row.some(function(value) { return value !== ''; }); }).map(function(row) {
    return headers.reduce(function(out, header, index) { out[header] = row[index]; return out; }, {});
  });
}

function PP_snapshotComment_(op) {
  const description = String(op.descripcion || op.tipoInsercion || '');
  const isToolChange = String(op.tipoInsercion || '').toUpperCase() === 'CAMBIO_HERRAMENTAL' || /CAMBIO\s+(?:DE\s+)?HERRAMENTAL/i.test(description);
  if (!isToolChange) return String(op.comentario || '').trim();
  const from = PP_snapshotToolPair_(op.toolChangeFromHerramental, op.toolChangeFromKit);
  const to = PP_snapshotToolPair_(op.toolChangeToHerramental || op.herramental, op.toolChangeToKit || op.kitHerramental);
  return 'Cambio de herramental de (' + from + ' --> ' + to + ')';
}

function PP_snapshotToolPair_(herramental, kit) {
  const values = [herramental, kit].map(function(value) { return String(value || '').trim(); }).filter(function(value) {
    const key = PP_normalizeKey_(value);
    return key && ['SIN_HERR', 'SIN_KIT', 'SIN_ANTECEDENTE'].indexOf(key) < 0;
  });
  return values.join(', ') || 'SIN HERRAMENTAL';
}

function PP_cleanSnapshotUserComment_(value) {
  const comment = String(value || '').trim();
  return /(?:_APP\b|PLANNER_CORE|WARN_|NETSUITE_APPS_SCRIPT|PRIORIDAD_COLA)/i.test(comment) ? '' : comment;
}

function PP_planSnapshotPayloadKey_(snapshotId) {
  return 'PLAN_SNAPSHOT_PAYLOAD::' + String(snapshotId || '').trim();
}

function PP_deletePlanSnapshotPayloadGeneration_(properties, key, manifest) {
  const generation = String(manifest && manifest.generation || '');
  for (let index = 0; index < Number(manifest && manifest.chunks || 0); index += 1) {
    properties.deleteProperty(generation ? key + '::' + generation + '::' + index : key + '::' + index);
  }
}

function PP_finalizePlanSnapshotPayload_(transaction) {
  if (!transaction || !transaction.previousManifest) return;
  try { PP_deletePlanSnapshotPayloadGeneration_(transaction.properties, transaction.key, transaction.previousManifest); } catch (ignored) {}
}

function PP_rollbackPlanSnapshotPayload_(transaction) {
  if (!transaction) return;
  if (transaction.previousValue == null) transaction.properties.deleteProperty(transaction.key);
  else transaction.properties.setProperty(transaction.key, transaction.previousValue);
  PP_deletePlanSnapshotPayloadGeneration_(transaction.properties, transaction.key, transaction.newManifest);
}

function PP_storePlanSnapshotPayload_(snapshotId, payload, metadata, options) {
  const properties = PropertiesService.getScriptProperties();
  const key = PP_planSnapshotPayloadKey_(snapshotId);
  const previousValue = properties.getProperty(key);
  let previousManifest = null;
  try { previousManifest = previousValue ? JSON.parse(previousValue) : null; } catch (ignored) {}
  const serialized = JSON.stringify(payload || {});
  const chunks = [];
  for (let offset = 0; offset < serialized.length; offset += 8000) chunks.push(serialized.slice(offset, offset + 8000));
  const generation = Utilities.getUuid();
  const stagingKey = key + '::' + generation + '::';
  const staged = {};
  chunks.forEach(function(chunk, index) { staged[stagingKey + index] = chunk; });
  const details = metadata || {};
  const manifest = {
    chunks: chunks.length, generation: generation,
    generatedAt: String(details.generatedAt || payload.generatedAt || payload.savedAt || ''),
    user: String(details.user || ''), planStart: String(payload.planStart || ''),
    horizonDays: Number(payload.horizonDays || 0), operations: Number(details.operations != null ? details.operations : (payload.operations || []).length)
  };
  try {
    properties.setProperties(staged, false);
    properties.setProperty(key, JSON.stringify(manifest));
  } catch (error) {
    PP_deletePlanSnapshotPayloadGeneration_(properties, key, manifest);
    throw error;
  }
  const transaction = {
    properties: properties, key: key, previousValue: previousValue,
    previousManifest: previousManifest, newManifest: manifest
  };
  if (!(options && options.keepPrevious)) PP_finalizePlanSnapshotPayload_(transaction);
  return transaction;
}

function PP_readPlanSnapshotPayload_(snapshotId) {
  const value = PropertiesService.getScriptProperties().getProperty(PP_planSnapshotPayloadKey_(snapshotId));
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || !parsed.chunks) return parsed;
    let serialized = '';
    const generation = String(parsed.generation || '');
    for (let index = 0; index < Number(parsed.chunks); index += 1) {
      const chunkKey = PP_planSnapshotPayloadKey_(snapshotId) + (generation ? '::' + generation : '') + '::' + index;
      serialized += PropertiesService.getScriptProperties().getProperty(chunkKey) || '';
    }
    return JSON.parse(serialized);
  } catch (error) { throw new Error('El payload completo de la instantanea esta corrupto'); }
}

function PP_deletePlanSnapshotPayload_(snapshotId) {
  const properties = PropertiesService.getScriptProperties();
  const key = PP_planSnapshotPayloadKey_(snapshotId);
  const value = properties.getProperty(key);
  try { if (value) PP_deletePlanSnapshotPayloadGeneration_(properties, key, JSON.parse(value)); } catch (ignored) {}
  properties.deleteProperty(key);
}

function PP_clearDraftSnapshot_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('BORRADOR_PLAN');
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, PP_SHEETS.BORRADOR_PLAN.length).clearContent();
  PP_deletePlanSnapshotPayload_('draft');
}

function PP_appendPlanSnapshot_(spreadsheet, payload, user, options) {
  const sheetName = String(options && options.sheetName || 'PLANES_HISTORICOS');
  const sheet = spreadsheet.getSheetByName(sheetName);
  const snapshotId = String(options && options.snapshotId || '').trim() || Utilities.getUuid();
  const generatedAt = new Date().toISOString();
  const scheduledOts = (payload.lastSchedule && Array.isArray(payload.lastSchedule.scheduledOts))
    ? payload.lastSchedule.scheduledOts.map(PP_normalizeKey_)
    : (payload.selectedOts || []).map(PP_normalizeKey_);
  const workOrders = {};
  (payload.workOrders || []).forEach(function(item) { workOrders[PP_normalizeKey_(item.ot)] = item; });
  const articleConfigurations = payload.articleConfigurations || {};
  const operations = (payload.operations || []).filter(function(op) {
    return scheduledOts.indexOf(PP_normalizeKey_(op.ot)) >= 0 && String(op.planStatus || '').toUpperCase() !== 'COMPLETADA_PLAN' && op.fechaInicio && op.horaInicio && op.fechaFin && op.horaFin;
  }).sort(function(a, b) {
    return String(a.fechaInicio + ' ' + a.horaInicio).localeCompare(String(b.fechaInicio + ' ' + b.horaInicio)) || Number(a.secuencia || 0) - Number(b.secuencia || 0);
  });
  const rows = operations.map(function(op, index) {
    const workOrder = workOrders[PP_normalizeKey_(op.ot)] || {};
    const article = String(op.parte || workOrder.item || '').trim().toUpperCase();
    const configurationKey = Object.keys(articleConfigurations).find(function(key) { return PP_normalizeKey_(key) === PP_normalizeKey_(article); });
    const configuration = configurationKey ? articleConfigurations[configurationKey] || {} : {};
    const pendingPieces = Math.max(0, Number(workOrder.pendingQuantity != null ? workOrder.pendingQuantity : (Number(workOrder.quantity || 0) - Number(workOrder.builtQuantity || 0))));
    const invoicePrice = Math.max(0, Number(workOrder.averageSalePrice || 0));
    const unitPrice = invoicePrice > 0 ? invoicePrice : Math.max(0, Number(configuration.manualUnitPrice || configuration.precioManual || 0));
    const machine = String(op.maquina || '').trim();
    const machineArea = machine && PP_normalizeKey_(machine) !== 'SIN_MAQUINA' ? machine : (op.ct ? 'CT ' + op.ct : '');
    return [
      snapshotId, generatedAt, user, payload.planStart || '', Number(payload.horizonDays || 15), index + 1,
      op.ot || '', op.parte || workOrder.item || '', op.descripcion || op.tipoInsercion || '', machineArea,
      op.operador || '', Number(op.tiempoCiclo || 0), Number(op.tiempoSetup || 0), Number(op.tiempoProd || 0),
      op.fechaInicio || '', op.horaInicio || '', op.fechaFin || '', op.horaFin || '', PP_snapshotComment_(op),
      Number(op.prioridad || 999), op.estatus || '', op.locked === true,
      op.herramental || '', op.kitHerramental || '', op.subcontractType || '', Number(op.subcontractDays || 0),
      pendingPieces, String(configuration.jobType || configuration.tipoOt || '').trim().toUpperCase(), unitPrice, unitPrice * pendingPieces
    ];
  });
  const payloadTransaction = PP_storePlanSnapshotPayload_(snapshotId, payload,
    { generatedAt: generatedAt, user: user, operations: rows.length },
    { keepPrevious: Boolean(options && options.keepPreviousPayload) });
  if (options && options.payloadTransaction) options.payloadTransaction.value = payloadTransaction;
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, PP_SHEETS.PLANES_HISTORICOS.length).setValues(rows);
  spreadsheet.getSheetByName('AUDITORIA').appendRow([generatedAt, user, 'INSTANTANEA_PLAN', Number(payload.revision || 0), JSON.stringify({ snapshotId: snapshotId, operations: rows.length })]);
  SpreadsheetApp.flush();
  if (options && options.keepPreviousPayload) PP_finalizePlanSnapshotPayload_(payloadTransaction);
  return { ok: true, snapshotId: snapshotId, operations: rows.length, generatedAt: generatedAt };
}

function PP_replaceDraftSnapshot_(spreadsheet, payload, user) {
  const sheet = spreadsheet.getSheetByName('BORRADOR_PLAN');
  const lastRow = sheet.getLastRow();
  const width = PP_SHEETS.PLANES_HISTORICOS.length;
  const previous = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  const payloadTransaction = { value: null };
  try {
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, width).clearContent();
    return PP_appendPlanSnapshot_(spreadsheet, payload, user, {
      snapshotId: 'draft', sheetName: 'BORRADOR_PLAN', keepPreviousPayload: true, payloadTransaction: payloadTransaction
    });
  } catch (error) {
    const restoreRows = Math.max(sheet.getLastRow() - 1, previous.length);
    if (restoreRows > 0) sheet.getRange(2, 1, restoreRows, width).clearContent();
    if (previous.length) sheet.getRange(2, 1, previous.length, width).setValues(previous);
    PP_rollbackPlanSnapshotPayload_(payloadTransaction.value);
    throw error;
  }
}

function PP_listPlanSnapshots_(spreadsheet) {
  const rows = PP_readRows_(spreadsheet.getSheetByName('PLANES_HISTORICOS')).concat(PP_readRows_(spreadsheet.getSheetByName('BORRADOR_PLAN')));
  const grouped = {};
  rows.forEach(function(row) {
    const snapshotId = String(row.SNAPSHOT_ID || '').trim();
    if (!snapshotId) return;
    if (!grouped[snapshotId]) {
      grouped[snapshotId] = {
        snapshotId: snapshotId,
        generatedAt: String(row.FECHA_GENERACION || ''),
        user: String(row.USUARIO || ''),
        planStart: String(row.PLAN_INICIO || ''),
        horizonDays: Number(row.HORIZONTE_DIAS || 0),
        operations: 0
      };
    }
    grouped[snapshotId].operations += 1;
  });
  const prefix = 'PLAN_SNAPSHOT_PAYLOAD::';
  const properties = PropertiesService.getScriptProperties().getProperties();
  Object.keys(properties).forEach(function(propertyKey) {
    if (propertyKey.indexOf(prefix) !== 0) return;
    const snapshotId = propertyKey.slice(prefix.length);
    if (!snapshotId || snapshotId.indexOf('::') >= 0 || snapshotId.indexOf('technical-') === 0 || grouped[snapshotId]) return;
    let manifest = null;
    try { manifest = JSON.parse(properties[propertyKey]); } catch (ignored) {}
    if (!manifest || !manifest.chunks) return;
    grouped[snapshotId] = {
      snapshotId: snapshotId, generatedAt: String(manifest.generatedAt || ''), user: String(manifest.user || ''),
      planStart: String(manifest.planStart || ''), horizonDays: Number(manifest.horizonDays || 0), operations: Number(manifest.operations || 0)
    };
  });
  return Object.keys(grouped).map(function(key) { return grouped[key]; }).sort(function(a, b) {
    return String(b.generatedAt).localeCompare(String(a.generatedAt));
  });
}

function PP_readMachineToolHistory_(spreadsheet) {
  return PP_readRows_(spreadsheet.getSheetByName('PLANES_HISTORICOS')).map(function(row, index) {
    const machine = String(row.MAQ_AREA || '').trim().toUpperCase();
    const herramental = String(row.HERRAMENTAL || '').trim();
    const kit = String(row.KIT_HERRAMENTAL || '').trim();
    const endDate = String(row.F_FIN || '').trim();
    const endTime = String(row.H_FIN || '').trim();
    if (!machine || /^CT\s+/i.test(machine) || !herramental || !endDate || !endTime) return null;
    return {
      id: 'history-' + String(row.SNAPSHOT_ID || '') + '-' + (index + 1),
      operationId: 'snapshot-' + String(row.SNAPSHOT_ID || '') + '-' + String(row.NUM || index + 1),
      snapshotId: String(row.SNAPSHOT_ID || ''),
      ot: String(row.OT || ''),
      machine: machine,
      herramental: herramental,
      kitHerramental: kit,
      endDate: endDate,
      endTime: endTime
    };
  }).filter(function(item) { return item !== null; }).sort(function(a, b) {
    return (a.endDate + ' ' + a.endTime).localeCompare(b.endDate + ' ' + b.endTime);
  }).slice(-2000);
}

function PP_getPlanSnapshot_(spreadsheet, snapshotId) {
  const key = String(snapshotId || '').trim();
  const sourceSheet = key === 'draft' ? 'BORRADOR_PLAN' : 'PLANES_HISTORICOS';
  const rows = PP_readRows_(spreadsheet.getSheetByName(sourceSheet)).filter(function(row) {
    return String(row.SNAPSHOT_ID || '').trim() === key;
  });
  const fullState = PP_readPlanSnapshotPayload_(key);
  if (!rows.length && !fullState) throw new Error('Plan guardado no encontrado');
  const first = rows[0] || {};
  const result = {
    snapshotId: key,
    generatedAt: String(first.FECHA_GENERACION || fullState && (fullState.generatedAt || fullState.savedAt) || ''),
    user: String(first.USUARIO || ''),
    planStart: String(first.PLAN_INICIO || fullState && fullState.planStart || ''),
    horizonDays: Number(first.HORIZONTE_DIAS || fullState && fullState.horizonDays || 0),
    operations: rows.length ? rows.map(function(row, index) {
      const description = String(row.OP || '');
      const comments = String(row.COMENTARIOS || '');
      const isToolChange = /CAMBIO\s+(?:DE\s+)?HERRAMENTAL/i.test(description + ' ' + comments);
      const userComment = isToolChange ? comments : PP_cleanSnapshotUserComment_(comments);
      return {
        id: 'snapshot-' + key + '-' + (index + 1),
        num: Number(row.NUM || index + 1),
        ot: String(row.OT || ''),
        parte: String(row.PARTE || ''),
        descripcion: description,
        contenido: '',
        comentario: userComment,
        prioridad: Number(row.PRIORIDAD || 999),
        secuencia: Number(row.NUM || index + 1),
        operador: String(row.OPERADOR || ''),
        maquina: String(row.MAQ_AREA || ''),
        tiempoCiclo: Number(row.TC_MIN || 0),
        tiempoSetup: Number(row.TIEMPO_SETUP || 0),
        tiempoProd: Number(row.TIEMPO_PROD || 0),
        fechaInicio: String(row.F_INICIO || ''),
        horaInicio: String(row.H_INICIO || ''),
        fechaFin: String(row.F_FIN || ''),
        horaFin: String(row.H_FIN || ''),
        tipoInsercion: isToolChange ? 'CAMBIO_HERRAMENTAL' : 'OPERACION',
        estatus: String(row.ESTATUS || ''),
        log: isToolChange ? comments : '',
        locked: PP_bool_(row.BLOQUEADA, false),
        herramental: String(row.HERRAMENTAL || ''),
        kitHerramental: String(row.KIT_HERRAMENTAL || ''),
        subcontractType: String(row.TIPO_SUBCONTRATO || ''),
        subcontractDays: Number(row.DIAS_SUBCONTRATO || 0),
        pendingPieces: Number(row.PZAS_PENDIENTES || 0),
        jobType: String(row.TIPO_OT || ''),
        unitPrice: Number(row.PRECIO_UNITARIO || 0),
        amount: Number(row.MONTO || 0)
      };
    }) : (fullState.operations || []).map(function(operation) { return Object.assign({}, operation); })
  };
  if (fullState) result.fullState = fullState;
  return result;
}

function PP_readConfig_(sheet) {
  return PP_readRows_(sheet).reduce(function(out, row) {
    try { out[row.KEY] = JSON.parse(row.VALUE); } catch (error) { out[row.KEY] = row.VALUE; }
    return out;
  }, {});
}

function PP_writeTable_(sheet, headers, rows) {
  sheet.clearContents();
  const values = [headers].concat(rows || []);
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eef1');
}

function PP_mapOperation_(row) {
  return Object.keys(PP_OPERATION_FIELDS).reduce(function(out, header) {
    const field = PP_OPERATION_FIELDS[header];
    let value = row[header];
    if (['num', 'prioridad', 'cantTotal', 'secuencia', 'cantPendiente', 'tiempoCiclo', 'tiempoSetup', 'tiempoProd', 'subcontractDays'].indexOf(field) >= 0) value = Number(value || 0);
    if (field === 'locked' || field === 'kitPending' || field === 'autoFrozen') value = PP_bool_(value, false);
    out[field] = value;
    return out;
  }, {});
}

function PP_mapOperationCatalog_(row) {
  return {
    key: PP_normalizeCapabilityKey_(row.KEY),
    ct: String(row.CT || '').trim(),
    label: String(row.OPERACION || '').trim(),
    source: String(row.ORIGEN || 'NETSUITE').trim(),
    active: PP_bool_(row.ACTIVA, true)
  };
}

function PP_mapWorkOrder_(row) {
  const quantity = Number(row.CANTIDAD || 0);
  const builtQuantity = Number(row.CANT_ENSAMBLADA || 0);
  const pendingQuantity = String(row.CANT_PENDIENTE || '').trim() === ''
    ? Math.max(0, quantity - builtQuantity)
    : Math.max(0, Number(row.CANT_PENDIENTE || 0));
  return {
    id: row.ID, workOrderId: row.WO_INTERNAL_ID, ot: row.OT, item: row.ARTICULO, description: row.DESCRIPCION,
    photoUrl: row.FOTO_URL, startDate: row.FECHA_INICIO_NS, endDate: row.FECHA_FIN_NS, dueDate: row.FECHA_VENCIMIENTO,
    dueDateOverride: row.FECHA_ENTREGA_AJUSTADA, quantity: quantity, status: row.ESTATUS, customer: row.CLIENTE,
    builtQuantity: builtQuantity, pendingQuantity: pendingQuantity,
    averageSalePrice: Number(row.PRECIO_PROMEDIO_VENTA || 0), averageSalePriceFrom: row.PRECIO_DESDE, averageSalePriceTo: row.PRECIO_HASTA
  };
}

function PP_buildOperationPlanStatuses_(rows) {
  return (rows || []).reduce(function(out, row) {
    const key = String(row.KEY || '').trim();
    if (!key) return out;
    out[key] = {
      key: key, type: String(row.TIPO || 'OPERATION').trim().toUpperCase(), status: String(row.ESTATUS_PLAN || 'PENDIENTE').trim().toUpperCase(),
      operationId: String(row.OPERATION_ID || ''), ot: String(row.OT || ''), sequence: Number(row.SECUENCIA || 0), ct: String(row.CT || ''),
      operator: String(row.OPERADOR || ''), machine: String(row.MAQUINA || ''), article: String(row.ARTICULO || ''), description: String(row.DESCRIPCION || ''),
      startDate: String(row.FECHA_INICIO || ''), startTime: String(row.HORA_INICIO || ''), endDate: String(row.FECHA_FIN || ''), endTime: String(row.HORA_FIN || ''),
      fromHerramental: String(row.HERRAMENTAL_ORIGEN || ''), fromKit: String(row.KIT_ORIGEN || ''), toHerramental: String(row.HERRAMENTAL_DESTINO || ''),
      toKit: String(row.KIT_DESTINO || ''), toToolKey: String(row.TOOL_KEY_DESTINO || ''), completedAt: String(row.FECHA_COMPLETADO || ''), reopenedAt: String(row.FECHA_REAPERTURA || '')
    };
    return out;
  }, {});
}

function PP_buildOtConfigurations_(rows, operations) {
  const configurations = {};
  const explicit = {};
  (rows || []).forEach(function(row) {
    const ot = String(row.OT || '').trim();
    if (!ot) return;
    const storedMachine = String(row.MAQUINA || '').trim();
    configurations[ot] = {
      ot: ot,
      machine: PP_normalizeKey_(storedMachine) === 'SIN_MAQUINA' ? '' : storedMachine,
      kitHerramental: String(row.KIT_HERRAMENTAL || '').trim(),
      kitPending: PP_bool_(row.KIT_PENDIENTE, false),
      subcontractType: String(row.TIPO_SUBCONTRATO || '').trim(),
      subcontractDays: Number(row.DIAS_SUBCONTRATO || 0),
      updatedAt: String(row.ACTUALIZADO || '').trim()
    };
    explicit[PP_normalizeKey_(ot)] = true;
  });
  (operations || []).forEach(function(op) {
    const ot = String(op.ot || '').trim();
    if (!ot || explicit[PP_normalizeKey_(ot)]) return;
    if (!configurations[ot]) {
      configurations[ot] = { ot: ot, machine: '', kitHerramental: '', kitPending: false, subcontractType: '', subcontractDays: 0, updatedAt: '' };
    }
    const item = configurations[ot];
    const bending = ['5459', '5527'].indexOf(String(op.ct || '').trim()) >= 0;
    if (bending && !item.machine && op.maquina && String(op.maquina) !== 'SIN_MAQUINA') item.machine = String(op.maquina);
    if (bending && !item.kitHerramental && op.kitHerramental) item.kitHerramental = String(op.kitHerramental);
    if (bending && op.kitPending === true) item.kitPending = true;
    if (!item.subcontractType && op.subcontractType) item.subcontractType = String(op.subcontractType);
    if (!(item.subcontractDays > 0) && Number(op.subcontractDays) > 0) item.subcontractDays = Number(op.subcontractDays);
  });
  return configurations;
}

function PP_buildArticleConfigurations_(articleRows, legacyOtRows, workOrders, operations) {
  const configurations = {};
  (articleRows || []).forEach(function(row) {
    const article = String(row.ARTICULO || '').trim().toUpperCase();
    if (!article) return;
    configurations[article] = {
      article: article,
      jobType: String(row.TIPO_OT || '').trim().toUpperCase(),
      planningType: String(row.TIPO_TRABAJO || '').trim().toUpperCase(),
      manualUnitPrice: Number(row.PRECIO_MANUAL || 0),
      updatedAt: String(row.ACTUALIZADO || '').trim()
    };
  });

  const otToArticle = {};
  (workOrders || []).forEach(function(item) {
    if (item && item.ot && item.item) otToArticle[PP_normalizeKey_(item.ot)] = String(item.item).trim().toUpperCase();
  });
  (operations || []).forEach(function(op) {
    if (op && op.ot && op.parte && !otToArticle[PP_normalizeKey_(op.ot)]) {
      otToArticle[PP_normalizeKey_(op.ot)] = String(op.parte).trim().toUpperCase();
    }
  });

  (legacyOtRows || []).forEach(function(row) {
    const article = otToArticle[PP_normalizeKey_(row.OT)] || '';
    if (!article) return;
    const hasLegacy = row.TIPO_OT || row.TIPO_TRABAJO || Number(row.PRECIO_MANUAL || 0) > 0;
    if (!hasLegacy) return;
    const current = configurations[article] || {
      article: article,
      jobType: '',
      planningType: '',
      manualUnitPrice: 0,
      updatedAt: ''
    };
    if (!current.jobType) current.jobType = String(row.TIPO_OT || '').trim().toUpperCase();
    if (!current.planningType) current.planningType = String(row.TIPO_TRABAJO || '').trim().toUpperCase();
    if (!(current.manualUnitPrice > 0)) current.manualUnitPrice = Number(row.PRECIO_MANUAL || 0);
    current.updatedAt = current.updatedAt || String(row.ACTUALIZADO || '').trim();
    configurations[article] = current;
  });
  return configurations;
}

function PP_capabilityFromKey_(key) {
  const text = PP_normalizeCapabilityKey_(key);
  const separator = text.indexOf('::');
  if (separator < 0) return null;
  return { key: text, ct: text.slice(0, separator), label: text.slice(separator + 2).replace(/_/g, ' '), custom: false };
}

function PP_mapMachine_(row) { return { id: row.ID, active: PP_bool_(row.ACTIVA, true) }; }
function PP_mapTool_(row) { return { id: row.ID, part: row.PARTE, herramental: row.HERRAMENTAL, kitHerramental: row.KIT_HERRAMENTAL, toolSetupMinutes: Number(row.TIEMPO_AJUSTE_HERR || 0), kitSetupMinutes: Number(row.TIEMPO_AJUSTE_KIT || 0), active: PP_bool_(row.ACTIVO, true) }; }
function PP_mapMaterial_(row) { return { id: row.ID, ot: row.OT, workOrderId: row.WO_INTERNAL_ID, assembly: row.ENSAMBLE, componentId: row.COMPONENTE_ID, component: row.COMPONENTE, description: row.DESCRIPCION, unit: row.UNIDAD, required: Number(row.REQUERIDO || 0), issued: Number(row.EMITIDO || 0), pending: Number(row.PENDIENTE || 0) }; }
function PP_mapCalendar_(row) { return { id: row.ID, concept: row.CONCEPTO, machine: row.MAQUINA, startDate: row.FECHA_INICIO, start: row.HORA_INICIO, endDate: row.FECHA_FIN, end: row.HORA_FIN, reason: row.MOTIVO, active: PP_bool_(row.ACTIVO, true) }; }
function PP_mapSubcontract_(row) { return { id: row.ID, part: row.PARTE || '*', name: row.TIPO, days: Number(row.DIAS_HABILES || 3), active: PP_bool_(row.ACTIVO, true) }; }
function PP_cellValue_(value) {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

function PP_bool_(value, fallback) {
  if (value === true || value === false) return value;
  const text = String(value || '').trim().toUpperCase();
  if (['TRUE', 'VERDADERO', 'SI', '1'].indexOf(text) >= 0) return true;
  if (['FALSE', 'FALSO', 'NO', '0'].indexOf(text) >= 0) return false;
  return fallback;
}

function PP_normalizeKey_(value) {
  return String(value || '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
}

function PP_normalizeResourceCategory_(value, operator) {
  const category = PP_normalizeKey_(value).replace(/\s+/g, '_');
  if (category === 'ACABADOS' || category === 'FUERA_DE_PLAN') return category;
  if (category === 'TD') return category;
  if (/AJUST/.test(PP_normalizeKey_(operator))) return 'FUERA_DE_PLAN';
  return /PINTURA|ACABADO/.test(PP_normalizeKey_(operator)) ? 'ACABADOS' : 'TD';
}

function PP_normalizeCapabilityKey_(value) {
  const text = String(value || '').trim();
  const separator = text.indexOf('::');
  if (separator < 0) return text;
  return text.slice(0, separator) + '::' + PP_normalizeKey_(text.slice(separator + 2).replace(/_/g, ' '));
}
