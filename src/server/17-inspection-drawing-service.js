function PP_Inspection_routeLooseKey_(value) {
  return String(value == null ? '' : value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

function PP_Inspection_cleanDrawing_(value) {
  return PP_Inspection_text_(value, 1000).replace(/^['"]+|['"]+$/g, '').trim();
}

function PP_Inspection_routeIndexV2_() {
  const sheet = PP_Inspection_sheet_(PP_INSPECTION_ROUTES_SHEET, ['Articulo', 'Materia prima', 'Tramo', 'DIBUJO', 'Ultima modificacion']);
  const index = { rows: [], byMaterialDrawing: {} };
  const rowsByKey = {};
  PP_readRows_(sheet).forEach(function(row) {
    const article = PP_Inspection_text_(PP_Inspection_value_(row, ['Articulo', 'Artículo', 'bf', 'ARTICULO']));
    const material = PP_Inspection_text_(PP_Inspection_value_(row, ['Materia prima', 'Material', 'MATERIAL']));
    if (!article) return;
    const item = {
      ARTICULO: article,
      MATERIAL: material,
      TRAMO: PP_Inspection_text_(PP_Inspection_value_(row, ['Tramo', 'TRAMO'])),
      DIBUJO: PP_Inspection_cleanDrawing_(PP_Inspection_value_(row, ['DIBUJO', 'Dibujo', 'URL_DIBUJO'])),
      ACTUALIZADO: PP_Inspection_value_(row, ['Ultima modificacion', 'Última modificación', 'ACTUALIZADO'])
    };
    const articleKey = PP_normalizeKey_(article);
    const materialKey = PP_normalizeKey_(material);
    const looseArticle = PP_Inspection_routeLooseKey_(article);
    const looseMaterial = PP_Inspection_routeLooseKey_(material);
    index[articleKey + '|' + materialKey] = item;
    index[looseArticle + '|' + looseMaterial] = item;
    if (!material && item.DIBUJO) {
      index[articleKey + '|'] = item;
      index[looseArticle + '|'] = item;
    }
    if (material && item.DIBUJO && !index.byMaterialDrawing[looseMaterial]) {
      index.byMaterialDrawing[looseMaterial] = item;
    }
    rowsByKey[articleKey + '|' + materialKey] = item;
  });
  index.rows = Object.keys(rowsByKey).map(function(key) { return rowsByKey[key]; });
  return index;
}

function PP_Inspection_routeMatchV2_(routes, article, material) {
  return routes[PP_normalizeKey_(article) + '|' + PP_normalizeKey_(material)] ||
    routes[PP_Inspection_routeLooseKey_(article) + '|' + PP_Inspection_routeLooseKey_(material)] || {};
}

function PP_Inspection_articleDrawingMatchV2_(routes, article) {
  return routes[PP_normalizeKey_(article) + '|'] || routes[PP_Inspection_routeLooseKey_(article) + '|'] || {};
}

function PP_Inspection_materialDrawingMatchV2_(routes, material) {
  return routes.byMaterialDrawing[PP_Inspection_routeLooseKey_(material)] || {};
}

function getInspectionWorkOrder(wo) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(wo, 80);
    if (!folio) throw new Error('OT requerida');
    const response = PP_Inspection_restlet_({ action: 'detail', woFolio: folio });
    const workOrder = response.trabajo || response.workOrder;
    if (!workOrder) throw new Error('OT no encontrada en NetSuite');
    const article = PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Articulo', 'item_name', 'item', 'Ensamble']));
    const routes = PP_Inspection_routeIndexV2_();
    const articleRoute = PP_Inspection_articleDrawingMatchV2_(routes, article);
    let drawingFallback = PP_Inspection_cleanDrawing_(articleRoute.DIBUJO);
    const materials = (response.materiales || response.materials || []).map(function(row) {
      const material = PP_Inspection_text_(PP_Inspection_value_(row, ['componente', 'component_name', 'component', 'Material']));
      const route = PP_Inspection_routeMatchV2_(routes, article, material);
      const materialDrawing = PP_Inspection_materialDrawingMatchV2_(routes, material);
      const drawing = PP_Inspection_cleanDrawing_(route.DIBUJO) || PP_Inspection_cleanDrawing_(materialDrawing.DIBUJO);
      if (!drawingFallback && drawing) drawingFallback = drawing;
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
        route: PP_Inspection_text_(route.TRAMO),
        drawing: drawing
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

function getInspectionDrawingRoutes(article) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(article);
    const loose = PP_Inspection_routeLooseKey_(article);
    return PP_Inspection_routeIndexV2_().rows.filter(function(row) {
      return !key || PP_normalizeKey_(row.ARTICULO) === key || PP_Inspection_routeLooseKey_(row.ARTICULO) === loose;
    });
  });
}
