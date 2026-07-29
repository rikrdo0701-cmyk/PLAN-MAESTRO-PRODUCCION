function getPlanningWorkOrderData(ot) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(ot, 80);
    if (!folio) throw new Error('OT requerida');

    const response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
    const workOrder = response.trabajo || response.workOrder;
    if (!workOrder) throw new Error('OT no encontrada en NetSuite');

    const rawOperations = PP_fetchPlanningWorkOrderOperations_(folio).filter(PP_isSchedulable_);
    const current = { operations: [] };
    const operations = rawOperations.map(function(row, index) {
      const normalized = Object.assign({}, row, {
        'Orden de trabajo': folio,
        'Centro de trabajo': PP_Inspection_value_(row, ['Centro de trabajo', 'centro', 'CT', 'workcenter']),
        'Tiempo estimado (min)': PP_Inspection_value_(row, ['Tiempo estimado (min)', 'remaining_min', 'estimated_min', 'tiempo'])
      });
      return PP_mapNetSuiteOperation_(normalized, index, current);
    });
    if (!operations.length || !operations.every(PP_planningIndividualOperationValid_)) {
      throw new Error('NetSuite no devolvio una ruta completa con CT y tiempo para la OT ' + folio);
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
      'WO Internal ID': PP_Inspection_value_(workOrder, ['WO Internal ID', 'workorder_id', 'workOrderId', 'id']),
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

function PP_fetchPlanningWorkOrderOperations_(folio) {
  const config = PP_netSuiteConfig_();
  const rows = [];
  let headers = [];
  const maxPages = 100;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const response = PP_netSuiteRestletRequest_(
      { script: '1762', deploy: '17' },
      {
        locationId: config.locationId,
        onlyOpen: true,
        woFolio: folio,
        workOrderTranId: folio,
        pageIndex: pageIndex,
        pageSize: 200
      },
      config
    );
    if (!response.ok) throw new Error('NetSuite operaciones: ' + response.status + ' ' + response.raw.slice(0, 300));
    headers = response.json.headers || headers;
    PP_rowsAsObjects_(response.json, headers).forEach(function(row) {
      const rowFolio = String(PP_pick_(row, ['Orden de trabajo', 'workorder_tranid', 'WO Folio', 'tranid']) || '').trim();
      if (PP_normalizeKey_(rowFolio) === PP_normalizeKey_(folio)) rows.push(row);
    });
    if (response.json.hasMore !== true) return rows;
  }
  throw new Error('NetSuite excedio el limite de paginas al buscar operaciones de la OT ' + folio);
}

function PP_planningIndividualOperationValid_(operation) {
  return Boolean(operation && operation.ct && operation.ct !== 'SIN_CT' && Number(operation.tiempoProd) > 0);
}
