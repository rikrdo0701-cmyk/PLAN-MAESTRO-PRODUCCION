function getPlanningWorkOrderData(ot) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(ot, 80);
    if (!folio) throw new Error('OT requerida');

    const response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
    const workOrder = response.trabajo || response.workOrder;
    if (!workOrder) throw new Error('OT no encontrada en NetSuite');

    const workOrderId = PP_Inspection_value_(workOrder, ['WO Internal ID', 'workorder_id', 'workOrderId']);
    const pendingQuantity = PP_pendingWorkOrderQuantity_(workOrder);
    const rawOperations = PP_fetchDirectWorkOrderOperations_(workOrderId, folio, pendingQuantity);
    const current = { operations: [] };
    const operations = rawOperations.map(function(row, index) {
      const normalized = Object.assign({}, row, {
        'Orden de trabajo': folio,
        'Centro de trabajo': PP_Inspection_value_(row, ['Centro de trabajo', 'centro', 'CT', 'workcenter']),
        'Tiempo estimado (min)': PP_Inspection_value_(row, ['Tiempo estimado (min)', 'remaining_min', 'estimated_min', 'tiempo'])
      });
      return PP_mapNetSuiteOperation_(normalized, index, current);
    });
    if (!operations.length) {
      throw new Error('Ruta de manufactura vacia para la OT ' + folio);
    }
    const invalidOperations = operations.filter(function(operation) {
      return !PP_planningIndividualOperationValid_(operation);
    });
    if (invalidOperations.length) {
      const detail = invalidOperations.slice(0, 4).map(function(operation) {
        const missing = [];
        if (!operation.ct || operation.ct === 'SIN_CT') missing.push('sin CT');
        if (!(Number(operation.tiempoProd) > 0)) missing.push('sin tiempo');
        return 'secuencia ' + operation.secuencia + ' ' + operation.descripcion + ': ' + missing.join(', ');
      }).join('; ');
      throw new Error('Ruta incompleta de la OT ' + folio + ': ' + detail);
    }

    const materials = (response.materiales || response.materials || []).map(function(row, index) {
      return PP_mapNetSuiteMaterial_(Object.assign({}, row, {
        'WO Folio': folio,
        'Componente': PP_Inspection_value_(row, ['Componente', 'componente', 'component']),
        'Requerido': PP_Inspection_value_(row, ['Requerido', 'requerido', 'required']),
        'Emitido': PP_Inspection_value_(row, ['Emitido', 'emitido', 'issued']),
        'Pendiente': PP_Inspection_value_(row, ['Pendiente', 'pendiente', 'pending'])
      }), index);
    });

    const normalizedWorkOrderRow = Object.assign({}, workOrder, {
      'WO Folio': folio,
      'WO Internal ID': PP_Inspection_value_(workOrder, ['WO Internal ID', 'workorder_id', 'workOrderId']),
      'Articulo': PP_Inspection_value_(workOrder, ['Articulo', 'articulo', 'Item', 'item', 'item_name', 'Ensamble']),
      'Descripcion': PP_Inspection_value_(workOrder, ['Descripcion', 'descripcion', 'Description', 'description']),
      'Cantidad': PP_Inspection_value_(workOrder, ['Cantidad', 'cantidad', 'Quantity', 'quantity']),
      'Cantidad ensamblada': PP_Inspection_value_(workOrder, ['Cantidad ensamblada', 'cantidadEnsamblada', 'Quantity Built', 'builtQuantity']),
      'Estatus': PP_Inspection_value_(workOrder, ['Estatus', 'estatus', 'Estado', 'estado', 'Status', 'status']),
      'Cliente': PP_Inspection_value_(workOrder, ['Cliente', 'cliente', 'Customer', 'customer']),
      'Foto URL': PP_Inspection_value_(workOrder, ['Foto URL', 'fotoUrl', 'photoUrl', 'Image URL', 'image_url']),
      'Fecha inicio programada': PP_Inspection_value_(workOrder, ['Fecha inicio programada', 'fechaInicio', 'startDate', 'start_planned']),
      'Fecha fin programada': PP_Inspection_value_(workOrder, ['Fecha fin programada', 'fechaFin', 'endDate', 'end_planned']),
      'Fecha de vencimiento': PP_Inspection_value_(workOrder, ['Fecha de vencimiento', 'fechaEntrega', 'dueDate', 'due_date'])
    });
    const normalizedWorkOrder = PP_buildWorkOrderCatalog_([normalizedWorkOrderRow], rawOperations)[0];
    if (!normalizedWorkOrder) throw new Error('OT no encontrada en NetSuite');

    return {
      workOrder: normalizedWorkOrder,
      operations: operations,
      materials: materials
    };
  });
}

function PP_pendingWorkOrderQuantity_(workOrder) {
  const total = Number(PP_Inspection_value_(workOrder, ['Cantidad', 'cantidad', 'Quantity', 'quantity']) || 0);
  const built = PP_Inspection_value_(workOrder, ['Cantidad ensamblada', 'cantidadEnsamblada', 'Quantity Built', 'builtQuantity', 'quantitybuilt']);
  return built === '' ? Math.max(0, total) : Math.max(0, total - Number(built || 0));
}

function PP_fetchDirectWorkOrderOperations_(workOrderId, folio, quantity) {
  const config = PP_netSuiteConfig_();
  let resolvedId = String(workOrderId || '').trim();
  if (!resolvedId) {
    const lookup = PP_fetchDirectWorkOrderSuiteQl_(
      "SELECT id, tranid FROM transaction WHERE type = 'WorkOrd' AND tranid = '" + PP_directWorkOrderSqlLiteral_(folio) + "'",
      config
    );
    resolvedId = String((lookup.items || [])[0] && (lookup.items[0].id || lookup.items[0].workorder_id) || '').trim();
  }
  if (!resolvedId) throw new Error('OT no encontrada en NetSuite: ' + folio);

  const route = PP_fetchDirectWorkOrderSuiteQl_([
    'SELECT id, operationsequence, manufacturingworkcenter,',
    'BUILTIN.DF(manufacturingworkcenter) AS work_center,',
    'setuptime, runrate, title',
    'FROM manufacturingoperationtask',
    "WHERE workorder = '" + PP_directWorkOrderSqlLiteral_(resolvedId) + "'",
    'ORDER BY operationsequence, id'
  ].join(' '), config);
  const rows = route.items || [];
  if (!rows.length) throw new Error('Ruta de manufactura vacia para la OT ' + folio);
  return rows.map(function(row) {
    return {
      'Orden de trabajo': folio,
      'Operacion': row.work_center || row.title,
      'Secuencia': row.operationsequence,
      'Centro de trabajo': row.manufacturingworkcenter,
      'Estado': 'No iniciado',
      'Tiempo estimado (min)': Number(row.setuptime || 0) + Number(row.runrate || 0) * quantity
    };
  });
}

function PP_fetchDirectWorkOrderSuiteQl_(sql, config) {
  const endpoint = 'https://' + String(config.accountId).toLowerCase() + '.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
  const query = { limit: 1000, offset: 0 };
  const response = UrlFetchApp.fetch(endpoint + '?limit=1000&offset=0', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: PP_oauthHeader_('POST', endpoint, query, config),
      Prefer: 'transient'
    },
    payload: JSON.stringify({ q: sql }),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  if (status < 200 || status >= 300) {
    PP_logDirectWorkOrderSuiteQlFailure_(status, raw);
    throw new Error('SuiteQL operaciones OT: error HTTP ' + status);
  }
  let json;
  try { json = JSON.parse(raw || '{}'); } catch (_) { throw new Error('SuiteQL operaciones OT: respuesta invalida'); }
  if (!Array.isArray(json.items)) throw new Error('SuiteQL operaciones OT: respuesta sin items');
  return json;
}

function PP_directWorkOrderSqlLiteral_(value) {
  return String(value || '').replace(/'/g, "''");
}

function PP_logDirectWorkOrderSuiteQlFailure_(status, raw) {
  if (typeof Logger === 'undefined' || typeof Logger.log !== 'function') return;
  Logger.log('SuiteQL operaciones OT fallo HTTP ' + status + ': ' + String(raw || '').slice(0, 1000));
}

function PP_planningIndividualOperationValid_(operation) {
  return Boolean(operation && operation.ct && operation.ct !== 'SIN_CT' && Number(operation.tiempoProd) > 0);
}
