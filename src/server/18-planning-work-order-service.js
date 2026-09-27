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
    const operations = rawOperations
      .filter(function(row) { return !PP_placeholderOperationReason_(row); })
      .map(function(row, index) {
      const normalized = Object.assign({}, row, {
        'ID (link)': folio + '-' + String(PP_Inspection_value_(row, ['ID (link)', 'id']) || (index + 1)),
        'Orden de trabajo': folio,
        'Centro de trabajo': PP_Inspection_value_(row, ['Centro de trabajo', 'centro', 'CT', 'workcenter']),
        'Tiempo estimado (min)': PP_Inspection_value_(row, ['Tiempo estimado (min)', 'remaining_min', 'estimated_min', 'tiempo'])
      });
      return PP_planningOperationWithTimeFallback_(PP_mapNetSuiteOperation_(normalized, index, current));
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
    'SELECT id, operationsequence, manufacturingworkcenter, status,',
    'BUILTIN.DF(manufacturingworkcenter) AS work_center,',
    'setuptime, runrate, title',
    'FROM manufacturingoperationtask',
    "WHERE workorder = '" + PP_directWorkOrderSqlLiteral_(resolvedId) + "'",
    'ORDER BY operationsequence, id'
  ].join(' '), config);
  const rows = route.items || [];
  if (!rows.length) throw new Error('Ruta de manufactura vacia para la OT ' + folio);
  const schedulableRows = rows.filter(PP_isSchedulable_);
  if (!schedulableRows.length) {
    const statuses = rows.map(function(row) { return String(row.status || '').trim(); })
      .filter(Boolean);
    throw new Error('OT ' + folio + ' completada: todas sus operaciones estan en estado terminal ('
      + (statuses.join(', ') || 'COMPLETE/CERRADA/CANCELADA')
      + '); no apta para programarse');
  }
  return schedulableRows.map(function(row) {
    return {
      'Orden de trabajo': folio,
      'Operacion': row.work_center || row.title,
      'Secuencia': row.operationsequence,
      'Centro de trabajo': row.manufacturingworkcenter,
      'Estado': row.status || 'No iniciado',
      'Cantidad a procesar': quantity,
      'Tiempo estimado (min)': Number(row.setuptime || 0) + Number(row.runrate || 0) * quantity,
      'Tiempo de configuracion (minutos)': Number(row.setuptime || 0)
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

const PP_PLANNING_FALLBACK_MINUTES_ = 1 / 60;

function PP_planningOperationWithTimeFallback_(operation) {
  if (Number(operation.tiempoProd) > 0) return operation;
  return Object.assign({}, operation, {
    tiempoProd: PP_PLANNING_FALLBACK_MINUTES_,
    tiempoFallback: true
  });
}

function PP_planningIndividualOperationValid_(operation) {
  return Boolean(operation && operation.ct && operation.ct !== 'SIN_CT');
}

// BATCH: Obtiene datos de planeación de múltiples OTs en una sola llamada al servidor.
// Reduce N llamadas google.script.run (N OTs) a 1, eliminando la sobrecarga del bridge.
function getPlanningWorkOrderDataBatch(ots) {
  return PP_Inspection_result_(function() {
    if (!Array.isArray(ots) || !ots.length) throw new Error('Se requiere un array de OTs');

    const config = PP_netSuiteConfig_();
    const folios = ots.map(function(ot) { return PP_Inspection_text_(ot, 80); }).filter(Boolean);
    if (!folios.length) throw new Error('Se requiere al menos una OT válida');

    // 1) Resolver IDs internos de todas las OTs en UNA sola consulta SuiteQL
    const idLookup = PP_fetchDirectWorkOrderSuiteQl_([
      'SELECT id, tranid FROM transaction',
      "WHERE type = 'WorkOrd' AND tranid IN (" + folios.map(function(f) { return "'" + PP_directWorkOrderSqlLiteral_(f) + "'"; }).join(',') + ")"
    ].join(' '), config);
    const idByFolio = {};
    (idLookup.items || []).forEach(function(row) {
      const folio = PP_Inspection_value_(row, ['tranid', 'WO Folio']);
      const id = PP_Inspection_value_(row, ['id', 'workorder_id', 'workOrderId']);
      if (folio && id) idByFolio[String(folio)] = String(id);
    });

    // 2) Obtener operaciones de TODAS las OTs en UNA sola consulta SuiteQL
    const workOrderIds = Object.keys(idByFolio).map(function(f) { return idByFolio[f]; });
    let allRouteRows = [];
    if (workOrderIds.length) {
      const routeQuery = PP_fetchDirectWorkOrderSuiteQl_([
        'SELECT id, workorder, operationsequence, manufacturingworkcenter, status,',
        'BUILTIN.DF(manufacturingworkcenter) AS work_center,',
        'setuptime, runrate, title',
        'FROM manufacturingoperationtask',
        "WHERE workorder IN (" + workOrderIds.map(function(id) { return "'" + PP_directWorkOrderSqlLiteral_(id) + "'"; }).join(',') + ")",
        'ORDER BY workorder, operationsequence, id'
      ].join(' '), config);
      allRouteRows = routeQuery.items || [];
    }

    // 3) Agrupar operaciones por OT
    const rowsByFolio = {};
    allRouteRows.forEach(function(row) {
      const workOrderId = String(PP_Inspection_value_(row, ['workorder', 'workorder_id']) || '');
      const folio = Object.keys(idByFolio).find(function(f) { return idByFolio[f] === workOrderId; });
      if (!folio) return;
      if (!rowsByFolio[folio]) rowsByFolio[folio] = [];
      rowsByFolio[folio].push(row);
    });

    // 4) Para cada OT, llamar al restlet 2244 (detail) para obtener workOrder + materiales.
    //    Se hace en paralelo con fetchAll para minimizar el tiempo.
    const properties = PropertiesService.getScriptProperties();
    const restletQuery = {
      script: properties.getProperty('NS_WO_INSPECTION_SCRIPT') || '2244',
      deploy: properties.getProperty('NS_WO_INSPECTION_DEPLOY') || '1'
    };
    const restletEndpoint = PP_netSuiteRestletEndpoint_(restletQuery, config);

    const validFolios = folios.filter(function(f) { return idByFolio[f]; });
    const restletCalls = validFolios.map(function(folio) {
      return {
        url: restletEndpoint,
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: PP_oauthHeader_('POST', restletEndpoint, restletQuery, config),
          Prefer: 'transient'
        },
        payload: JSON.stringify({ action: 'detail', woFolio: folio, table: 'WO_INSPECCION', locationId: config.locationId, onlyOpen: true }),
        muteHttpExceptions: true
      };
    });

    const restletResponses = UrlFetchApp.fetchAll(restletCalls);

    // 5) Combinar resultados por OT
    return validFolios.map(function(folio, index) {
      const response = restletResponses[index];
      const status = response.getResponseCode();
      if (status < 200 || status >= 300) {
        return { ot: folio, ok: false, error: 'NetSuite inspeccion: error HTTP ' + status };
      }
      let data;
      try { data = JSON.parse(response.getContentText() || '{}'); } catch (_) {
        return { ot: folio, ok: false, error: 'SuiteQL operaciones OT: respuesta invalida' };
      }
      if (data && data.ok === false) {
        return { ot: folio, ok: false, error: data.error || 'Respuesta invalida de NetSuite' };
      }

      const workOrder = data.trabajo || data.workOrder;
      if (!workOrder) return { ot: folio, ok: false, error: 'OT no encontrada en NetSuite' };

      const workOrderId = PP_Inspection_value_(workOrder, ['WO Internal ID', 'workorder_id', 'workOrderId']);
      const pendingQuantity = PP_pendingWorkOrderQuantity_(workOrder);
      const rawOperations = (rowsByFolio[folio] || []).map(function(row) {
        return {
          'Orden de trabajo': folio,
          'Operacion': row.work_center || row.title,
          'Secuencia': row.operationsequence,
          'Centro de trabajo': row.manufacturingworkcenter,
          'Estado': row.status || 'No iniciado',
          'Cantidad a procesar': pendingQuantity,
          'Tiempo estimado (min)': Number(row.setuptime || 0) + Number(row.runrate || 0) * pendingQuantity,
          'Tiempo de configuracion (minutos)': Number(row.setuptime || 0)
        };
      });

      if (!rawOperations.length) return { ot: folio, ok: false, error: 'Ruta de manufactura vacia para la OT ' + folio };

      const schedulableRows = rawOperations.filter(PP_isSchedulable_);
      if (!schedulableRows.length) {
        return { ot: folio, ok: false, error: 'OT ' + folio + ' completada: operaciones en estado terminal' };
      }

      const current = { operations: [] };
      const operations = rawOperations
        .filter(function(row) { return !PP_placeholderOperationReason_(row); })
        .map(function(row, idx) {
          const normalized = Object.assign({}, row, {
            'ID (link)': folio + '-' + String(PP_Inspection_value_(row, ['ID (link)', 'id']) || (idx + 1)),
            'Orden de trabajo': folio,
            'Centro de trabajo': PP_Inspection_value_(row, ['Centro de trabajo', 'centro', 'CT', 'workcenter']),
            'Tiempo estimado (min)': PP_Inspection_value_(row, ['Tiempo estimado (min)', 'remaining_min', 'estimated_min', 'tiempo'])
          });
          return PP_planningOperationWithTimeFallback_(PP_mapNetSuiteOperation_(normalized, idx, current));
        });

      if (!operations.length) return { ot: folio, ok: false, error: 'Ruta de manufactura vacia para la OT ' + folio };

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
        return { ot: folio, ok: false, error: 'Ruta incompleta de la OT ' + folio + ': ' + detail };
      }

      const materials = (data.materiales || data.materials || []).map(function(row, idx) {
        return PP_mapNetSuiteMaterial_(Object.assign({}, row, {
          'WO Folio': folio,
          'Componente': PP_Inspection_value_(row, ['Componente', 'componente', 'component']),
          'Requerido': PP_Inspection_value_(row, ['Requerido', 'requerido', 'required']),
          'Emitido': PP_Inspection_value_(row, ['Emitido', 'emitido', 'issued']),
          'Pendiente': PP_Inspection_value_(row, ['Pendiente', 'pendiente', 'pending'])
        }), idx);
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
      if (!normalizedWorkOrder) return { ot: folio, ok: false, error: 'OT no encontrada en NetSuite' };

      return {
        ot: folio,
        ok: true,
        data: {
          workOrder: normalizedWorkOrder,
          operations: operations,
          materials: materials
        }
      };
    });
  });
}

function PP_netSuiteRestletEndpoint_(query, config) {
  return 'https://' + String(config.accountId).toLowerCase()
    + '.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script='
    + encodeURIComponent(query.script) + '&deploy=' + encodeURIComponent(query.deploy);
}
