function getPlanningWorkOrderData(ot) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(ot, 80);
    if (!folio) throw new Error('OT requerida');

    const response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
    const workOrder = response.trabajo || response.workOrder;
    if (!workOrder) throw new Error('OT no encontrada en NetSuite');

    const current = { operations: [] };
    const operations = (response.operaciones || response.operations || []).map(function(row, index) {
      const normalized = Object.assign({}, row, {
        'Orden de trabajo': folio,
        'Centro de trabajo': PP_Inspection_value_(row, ['Centro de trabajo', 'centro', 'CT', 'workcenter']),
        'Tiempo estimado (min)': PP_Inspection_value_(row, ['Tiempo estimado (min)', 'remaining_min', 'estimated_min', 'tiempo'])
      });
      return PP_mapNetSuiteOperation_(normalized, index, current);
    }).filter(PP_planningIndividualOperationValid_);
    if (!operations.length) throw new Error('NetSuite no devolvio operaciones con CT y tiempo para la OT ' + folio);

    const materials = (response.materiales || response.materials || []).map(function(row, index) {
      return PP_mapNetSuiteMaterial_(Object.assign({}, row, {
        'WO Folio': folio,
        'Componente': PP_Inspection_value_(row, ['Componente', 'componente', 'component']),
        'Requerido': PP_Inspection_value_(row, ['Requerido', 'requerido', 'required']),
        'Emitido': PP_Inspection_value_(row, ['Emitido', 'emitido', 'issued']),
        'Pendiente': PP_Inspection_value_(row, ['Pendiente', 'pendiente', 'pending'])
      }), index);
    });

    return {
      workOrder: Object.assign({}, workOrder, { wo: folio, ot: folio }),
      operations: operations,
      materials: materials
    };
  });
}

function PP_planningIndividualOperationValid_(operation) {
  return Boolean(operation && operation.ct && operation.ct !== 'SIN_CT' && Number(operation.tiempoProd) > 0);
}
