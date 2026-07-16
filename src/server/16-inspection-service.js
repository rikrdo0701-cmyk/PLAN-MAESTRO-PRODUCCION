const PP_INSPECTION_DEFAULT_SPREADSHEET_ID = '1X0jtJBgxcD8jIKYVhuw76OTVLP74Lv2yZsbPA_WpG9M';
const PP_INSPECTION_ROUTES_SHEET = 'Tramos';
const PP_INSPECTION_HISTORY_SHEET = 'HISTORIAL_IMPRESION_INSPEC';

function PP_Inspection_result_(callback) {
  try { return { ok: true, data: callback() }; }
  catch (error) { return { ok: false, error: String(error && error.message || error) }; }
}

function PP_Inspection_book_() {
  const properties = PropertiesService.getScriptProperties();
  const id = String(properties.getProperty('INSPECTION_SPREADSHEET_ID') || PP_INSPECTION_DEFAULT_SPREADSHEET_ID).trim();
  return SpreadsheetApp.openById(id);
}

function PP_Inspection_headerKey_(value) {
  return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function PP_Inspection_normalizeSheet_(sheet, headers, normalizeRoutes) {
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  if (normalizeRoutes) {
    let current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const key = PP_Inspection_headerKey_(current[index]);
      if (key === 'AUX' || key === 'USUARIOMODIFICACION') sheet.deleteColumn(index + 1);
    }
    current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    current.forEach(function(value, index) {
      if (PP_Inspection_headerKey_(value) === 'BF') sheet.getRange(1, index + 1).setValue('Articulo');
    });
  }
  const existing = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .reduce(function(index, value) { index[PP_Inspection_headerKey_(value)] = true; return index; }, {});
  headers.forEach(function(header) {
    const key = PP_Inspection_headerKey_(header);
    if (!existing[key]) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(header);
      existing[key] = true;
    }
  });
  return sheet;
}

function PP_Inspection_sheet_(name, headers) {
  const book = PP_Inspection_book_();
  let sheet = book.getSheetByName(name);
  if (!sheet) sheet = book.insertSheet(name);
  PP_Inspection_normalizeSheet_(sheet, headers, name === PP_INSPECTION_ROUTES_SHEET);
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

function PP_Inspection_number_(value) {
  const number = parseFloat(String(value == null ? '' : value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function PP_Inspection_longDate_(value) {
  if (!value) return '';
  const raw = String(value).trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) {
    const short = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (short) match = [short[0], short[3], short[2], short[1]];
  }
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (isNaN(date.getTime())) return raw;
  const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return days[date.getDay()] + ', ' + date.getDate() + ' de ' + months[date.getMonth()] + ' de ' + date.getFullYear();
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
  const sheet = PP_Inspection_sheet_(PP_INSPECTION_ROUTES_SHEET, ['Articulo', 'Materia prima', 'Tramo', 'DIBUJO', 'Ultima modificacion']);
  const index = {};
  PP_readRows_(sheet).forEach(function(row) {
    const article = PP_Inspection_value_(row, ['Articulo', 'Artículo', 'bf', 'ARTICULO']);
    const material = PP_Inspection_value_(row, ['Materia prima', 'Material', 'MATERIAL']);
    if (!article) return;
    index[PP_normalizeKey_(article) + '|' + PP_normalizeKey_(material)] = {
      ARTICULO: article,
      MATERIAL: material,
      TRAMO: PP_Inspection_value_(row, ['Tramo', 'TRAMO']),
      DIBUJO: PP_Inspection_value_(row, ['DIBUJO', 'Dibujo', 'URL_DIBUJO']),
      ACTUALIZADO: PP_Inspection_value_(row, ['Ultima modificacion', 'Última modificación', 'ACTUALIZADO'])
    };
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
    const articleRoute = routes[PP_normalizeKey_(article) + '|'] || {};
    let drawingFallback = PP_Inspection_text_(articleRoute.DIBUJO);
    const materials = (response.materiales || response.materials || []).map(function(row) {
      const material = PP_Inspection_text_(PP_Inspection_value_(row, ['componente', 'component_name', 'component', 'Material']));
      const route = routes[PP_normalizeKey_(article) + '|' + PP_normalizeKey_(material)] || {};
      if (!drawingFallback && route.DIBUJO) drawingFallback = PP_Inspection_text_(route.DIBUJO);
      const requiredOriginal = PP_Inspection_number_(PP_Inspection_value_(row, ['requerido', 'Requerido', 'required', 'quantity', 'Cantidad requerida', 'requeridoOriginal', 'requiredOriginal']));
      const pendingRaw = PP_Inspection_value_(row, ['pendiente', 'Pendiente', 'pending', 'Cantidad pendiente']);
      const issued = PP_Inspection_number_(PP_Inspection_value_(row, ['emitido', 'Emitido', 'usadoEnsamblaje', 'Usado en ensamblaje', 'quantityshiprecv']));
      return {
        material: material,
        description: PP_Inspection_text_(PP_Inspection_value_(row, ['Descripcion', 'description'])),
        required: pendingRaw === '' ? requiredOriginal : Math.max(0, PP_Inspection_number_(pendingRaw)),
        requiredOriginal: requiredOriginal,
        issued: issued,
        available: Number(PP_Inspection_value_(row, ['disponible', 'quantityavailable']) || 0),
        deficit: Number(PP_Inspection_value_(row, ['deficit', 'shortage']) || 0),
        deficitNeto: Number(PP_Inspection_value_(row, ['deficitNeto', 'netDeficit']) || 0),
        route: PP_Inspection_text_(route.TRAMO), drawing: PP_Inspection_text_(route.DIBUJO)
      };
    });
    const operations = (response.operaciones || response.operations || []).map(function(row, index) {
      const operation = PP_Inspection_text_(PP_Inspection_value_(row, ['Operacion', 'operation']));
      const sequence = Number(PP_Inspection_value_(row, ['secuencia', 'sequence']) || index + 1);
      return { id: folio + '-' + sequence + '-' + index, code: operation.split(':')[0].trim() || operation, operation: operation, sequence: sequence, workCenter: '' };
    }).filter(function(item) { return item.operation; }).sort(function(a, b) { return a.sequence - b.sequence; });
    return {
      workOrder: { wo: folio, article: article,
        description: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Descripcion', 'description'])),
        quantity: Number(PP_Inspection_value_(workOrder, ['cantidad', 'quantity', 'qty']) || 0),
        dueDate: PP_Inspection_longDate_(PP_Inspection_value_(workOrder, ['fechaEntrega', 'duedate', 'enddate'])),
        status: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['estatus', 'status', 'Estado'])),
        revision: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Revision', 'revision', 'bomRevision'])) || 'A',
        drawing: drawingFallback },
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
    const sheet = PP_Inspection_sheet_(PP_INSPECTION_ROUTES_SHEET, ['Articulo', 'Materia prima', 'Tramo', 'DIBUJO', 'Ultima modificacion']);
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0] || [];
    function column(names) {
      names = Array.isArray(names) ? names : [names];
      const keys = names.map(PP_Inspection_headerKey_);
      for (let index = 0; index < headers.length; index += 1) if (keys.indexOf(PP_Inspection_headerKey_(headers[index])) >= 0) return index;
      return -1;
    }
    const articleColumn = column(['Articulo', 'Artículo', 'bf']);
    const materialColumn = column(['Materia prima', 'Material']);
    const routeColumn = column('Tramo');
    const drawingColumn = column(['DIBUJO', 'Dibujo', 'URL_DIBUJO']);
    const updatedColumn = column(['Ultima modificacion', 'Última modificación', 'ACTUALIZADO']);
    let target = 0;
    for (let index = 1; index < rows.length; index += 1) {
      if (PP_normalizeKey_(rows[index][articleColumn]) === PP_normalizeKey_(article) && PP_normalizeKey_(rows[index][materialColumn]) === PP_normalizeKey_(material)) target = index + 1;
    }
    if (!target) {
      target = sheet.getLastRow() + 1;
      sheet.appendRow(Array.from({ length: headers.length }, function() { return ''; }));
    }
    const route = PP_Inspection_text_(payload.route, 100);
    const drawing = PP_Inspection_text_(payload.drawing, 1000);
    const updated = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Mexico_City', 'dd/MM/yyyy HH:mm:ss');
    [[articleColumn, article], [materialColumn, material], [routeColumn, route], [drawingColumn, drawing], [updatedColumn, updated]].forEach(function(pair) {
      if (pair[0] >= 0) sheet.getRange(target, pair[0] + 1).setValue(pair[1]);
    });
    return { article: article, material: material, route: route, drawing: drawing, updated: updated };
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
    ['FECHA_HORA', 'WO', 'ARTICULO', 'CANTIDAD', 'ESTADO_TRABAJO', 'SEMAFORO', 'ALERTAS',
      'MATERIALES_PENDIENTES', 'MATERIALES_DEFICIT', 'SIN_DIBUJO', 'FALTA_TRAMO', 'DETALLE_JSON']);
}

function getInspectionHistory(wo) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(wo);
    const rows = PP_readRows_(PP_Inspection_historySheet_()).filter(function(row) {
      return PP_normalizeKey_(PP_Inspection_value_(row, ['WO', 'OT'])) === key;
    });
    const history = rows.slice(-5).reverse().map(function(row, index) {
        return { number: rows.length - index,
          printedAt: PP_Inspection_text_(PP_Inspection_value_(row, ['FECHA_HORA'])),
          semaphore: PP_Inspection_text_(PP_Inspection_value_(row, ['SEMAFORO'])),
          folio: PP_Inspection_text_(PP_Inspection_value_(row, ['WO', 'OT'])) };
      });
    return { count: rows.length, history: history, conteo: rows.length,
      historial: history.map(function(item) { return { numero: item.number, fechaHora: item.printedAt, semaforo: item.semaphore, folio: item.folio }; }) };
  });
}

function recordInspectionPrint(payload) {
  return PP_Inspection_result_(function() {
    payload = payload || {};
    const wo = PP_Inspection_text_(payload.wo, 80);
    if (!wo) throw new Error('OT requerida');
    const operations = (payload.operations || []).map(function(value) { return PP_Inspection_text_(value, 80); }).filter(Boolean);
    const detail = Object.assign({}, payload.detail || {}, { operations: operations });
    const alerts = payload.alerts || detail.alerts || [];
    const pendingMaterials = payload.pendingMaterials || payload.materialesPendientes || [];
    const deficitMaterials = payload.deficitMaterials || payload.materialesDeficit || [];
    const withoutDrawing = payload.withoutDrawing !== undefined ? payload.withoutDrawing : payload.sinDibujo;
    const missingRoutes = payload.missingRoutes !== undefined ? payload.missingRoutes : payload.faltaTramo;
    const printedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Mexico_City', 'dd/MM/yyyy HH:mm:ss');
    PP_Inspection_historySheet_().appendRow([printedAt, wo, PP_Inspection_text_(payload.article, 200),
      Number(payload.quantity || payload.cantidad || 0), PP_Inspection_text_(payload.status || payload.estadoTrabajo, 80), PP_Inspection_text_(payload.semaphore || payload.semaforo, 40),
      alerts.join(' | '), pendingMaterials.map(function(item) { return PP_Inspection_text_(item.material || item.componente) + ':' + PP_Inspection_text_(item.quantity !== undefined ? item.quantity : item.cantidad); }).join(' | '),
      deficitMaterials.map(function(item) { return PP_Inspection_text_(item.material || item.componente) + ':' + PP_Inspection_text_(item.deficit); }).join(' | '),
      withoutDrawing ? 'SI' : 'NO', missingRoutes ? 'SI' : 'NO', JSON.stringify(detail)]);
    return { wo: wo, operations: operations, recordedAt: printedAt };
  });
}
