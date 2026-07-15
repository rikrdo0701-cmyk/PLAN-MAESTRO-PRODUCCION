const PP_INSPECTION_ROUTES_SHEET = 'INSPECCION_TRAMOS';
const PP_INSPECTION_HISTORY_SHEET = 'INSPECCION_HISTORIAL';

function PP_Inspection_result_(callback) {
  try { return { ok: true, data: callback() }; }
  catch (error) { return { ok: false, error: String(error && error.message || error) }; }
}

function PP_Inspection_book_() {
  const properties = PropertiesService.getScriptProperties();
  const id = String(properties.getProperty('INSPECTION_SPREADSHEET_ID') || properties.getProperty('PLANNING_SPREADSHEET_ID') || '').trim();
  if (!id) throw new Error('Configura INSPECTION_SPREADSHEET_ID o PLANNING_SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

function PP_Inspection_sheet_(name, headers) {
  const book = PP_Inspection_book_();
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (current.join('|') !== headers.join('|')) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function PP_Inspection_text_(value, maxLength) {
  const text = String(value == null ? '' : value).trim();
  return maxLength ? text.slice(0, maxLength) : text;
}

function PP_Inspection_value_(row, names) {
  const normalized = {};
  Object.keys(row || {}).forEach(function(key) { normalized[PP_normalizeKey_(key)] = row[key]; });
  for (let index = 0; index < names.length; index += 1) {
    const value = normalized[PP_normalizeKey_(names[index])];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function PP_Inspection_restlet_(body) {
  const properties = PropertiesService.getScriptProperties();
  const config = PP_netSuiteConfig_();
  const query = {
    script: properties.getProperty('NS_WO_INSPECTION_SCRIPT') || '2080',
    deploy: properties.getProperty('NS_WO_INSPECTION_DEPLOY') || '1'
  };
  const response = PP_netSuiteRestletRequest_(query, Object.assign({
    table: 'WO_INSPECCION', locationId: config.locationId, onlyOpen: true
  }, body || {}), config);
  if (!response.ok) throw new Error('NetSuite inspeccion: ' + response.status + ' ' + response.raw.slice(0, 300));
  if (response.json && response.json.ok === false) throw new Error(response.json.error || 'Respuesta invalida de NetSuite');
  return response.json || {};
}

function getInspectionWorkOrders() {
  return PP_Inspection_result_(function() {
    const response = PP_Inspection_restlet_({ action: 'list', pageIndex: 0, pageSize: 500 });
    const rows = response.wos || response.rows || response.data || [];
    return rows.map(function(row) {
      return {
        wo: PP_Inspection_text_(PP_Inspection_value_(row, ['wo', 'WO Folio', 'workorder_tranid', 'tranid', 'Trabajo'])),
        article: PP_Inspection_text_(PP_Inspection_value_(row, ['Articulo', 'item_name', 'item', 'Ensamble'])),
        description: PP_Inspection_text_(PP_Inspection_value_(row, ['descripcion', 'description'])),
        quantity: Number(PP_Inspection_value_(row, ['cantidad', 'quantity', 'qty']) || 0),
        status: PP_Inspection_text_(PP_Inspection_value_(row, ['estatus', 'status', 'Estado'])),
        dueDate: PP_Inspection_text_(PP_Inspection_value_(row, ['fechaEntrega', 'duedate', 'enddate']))
      };
    }).filter(function(item) { return item.wo; });
  });
}

function PP_Inspection_routeIndex_() {
  const sheet = PP_Inspection_sheet_(PP_INSPECTION_ROUTES_SHEET, ['ARTICULO', 'MATERIAL', 'TRAMO', 'DIBUJO', 'ACTUALIZADO']);
  const index = {};
  PP_readRows_(sheet).forEach(function(row) {
    index[PP_normalizeKey_(row.ARTICULO) + '|' + PP_normalizeKey_(row.MATERIAL)] = row;
  });
  return index;
}

function getInspectionWorkOrder(wo) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(wo, 80);
    if (!folio) throw new Error('OT requerida');
    const response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
    const workOrder = response.trabajo || response.workOrder;
    if (!workOrder) throw new Error('OT no encontrada en NetSuite');
    const article = PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Articulo', 'item_name', 'item', 'Ensamble']));
    const routes = PP_Inspection_routeIndex_();
    const materials = (response.materiales || response.materials || []).map(function(row) {
      const material = PP_Inspection_text_(PP_Inspection_value_(row, ['componente', 'component_name', 'component', 'Material']));
      const route = routes[PP_normalizeKey_(article) + '|' + PP_normalizeKey_(material)] || {};
      return {
        material: material,
        description: PP_Inspection_text_(PP_Inspection_value_(row, ['Descripcion', 'description'])),
        required: Number(PP_Inspection_value_(row, ['requerido', 'required', 'quantity']) || 0),
        issued: Number(PP_Inspection_value_(row, ['emitido', 'quantityshiprecv']) || 0),
        available: Number(PP_Inspection_value_(row, ['disponible', 'quantityavailable']) || 0),
        route: PP_Inspection_text_(route.TRAMO), drawing: PP_Inspection_text_(route.DIBUJO)
      };
    });
    const operations = (response.operaciones || response.operations || []).map(function(row, index) {
      const operation = PP_Inspection_text_(PP_Inspection_value_(row, ['Operacion', 'operation']));
      const sequence = Number(PP_Inspection_value_(row, ['secuencia', 'sequence']) || index + 1);
      return { id: folio + '-' + sequence + '-' + index, code: operation.split(':')[0].trim() || operation, operation: operation, sequence: sequence,
        workCenter: PP_Inspection_text_(PP_Inspection_value_(row, ['centro', 'workcenter'])) };
    }).filter(function(item) { return item.operation; }).sort(function(a, b) { return a.sequence - b.sequence; });
    return {
      workOrder: { wo: folio, article: article,
        description: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Descripcion', 'description'])),
        quantity: Number(PP_Inspection_value_(workOrder, ['cantidad', 'quantity', 'qty']) || 0),
        dueDate: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['fechaEntrega', 'duedate', 'enddate'])),
        status: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['estatus', 'status', 'Estado'])),
        revision: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Revision', 'revision', 'bomRevision'])) || 'A' },
      materials: materials, operations: operations
    };
  });
}

function saveInspectionLink(payload) {
  return PP_Inspection_result_(function() {
    payload = payload || {};
    const article = PP_Inspection_text_(payload.article, 200);
    const material = PP_Inspection_text_(payload.material, 200);
    if (!article || !material) throw new Error('Articulo y material son requeridos');
    const sheet = PP_Inspection_sheet_(PP_INSPECTION_ROUTES_SHEET, ['ARTICULO', 'MATERIAL', 'TRAMO', 'DIBUJO', 'ACTUALIZADO']);
    const rows = sheet.getDataRange().getValues();
    let target = 0;
    for (let index = 1; index < rows.length; index += 1) {
      if (PP_normalizeKey_(rows[index][0]) === PP_normalizeKey_(article) && PP_normalizeKey_(rows[index][1]) === PP_normalizeKey_(material)) target = index + 1;
    }
    const values = [article, material, PP_Inspection_text_(payload.route, 100), PP_Inspection_text_(payload.drawing, 1000), new Date().toISOString()];
    if (target) sheet.getRange(target, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
    return { article: article, material: material, route: values[2], drawing: values[3] };
  });
}

function getInspectionDrawingRoutes(article) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(article);
    return Object.keys(PP_Inspection_routeIndex_()).map(function(indexKey) { return PP_Inspection_routeIndex_()[indexKey]; })
      .filter(function(row) { return !key || PP_normalizeKey_(row.ARTICULO) === key; });
  });
}

function PP_Inspection_historySheet_() {
  return PP_Inspection_sheet_(PP_INSPECTION_HISTORY_SHEET,
    ['FECHA_HORA', 'OT', 'ARTICULO', 'CANTIDAD', 'SEMAFORO', 'OPERACIONES_JSON', 'DETALLE_JSON']);
}

function getInspectionHistory(wo) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(wo);
    return PP_readRows_(PP_Inspection_historySheet_()).filter(function(row) { return PP_normalizeKey_(row.OT) === key; }).slice(-20).reverse();
  });
}

function recordInspectionPrint(payload) {
  return PP_Inspection_result_(function() {
    payload = payload || {};
    const wo = PP_Inspection_text_(payload.wo, 80);
    if (!wo) throw new Error('OT requerida');
    const operations = (payload.operations || []).map(function(value) { return PP_Inspection_text_(value, 80); }).filter(Boolean);
    PP_Inspection_historySheet_().appendRow([new Date().toISOString(), wo, PP_Inspection_text_(payload.article, 200),
      Number(payload.quantity || 0), PP_Inspection_text_(payload.semaphore, 40), JSON.stringify(operations), JSON.stringify(payload.detail || {})]);
    return { wo: wo, operations: operations, recordedAt: new Date().toISOString() };
  });
}
