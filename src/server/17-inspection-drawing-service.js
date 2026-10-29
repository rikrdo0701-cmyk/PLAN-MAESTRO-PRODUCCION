// MEDIDO 2026-10-01: PP_Inspection_routeLooseKey_ y PP_Inspection_cleanDrawing_ se
// movieron a 16-inspection-service.js. Este archivo las usaba y las declaraba, y
// con la migracion del catalogo a Supabase el indice se arma en 16
// (PP_Inspection_routeIndexFrom_): dejarlas aqui obligaba al servicio base a
// depender del de dibujo. Declarar la misma funcion en los dos archivos no rompe
// nada en JavaScript (gana la ultima que carga) y por eso es peor: una se puede
// corregir y el comportamiento no cambiar. El test de funciones duplicadas de
// src/server/ es el que lo atrapa.

function getInspectionWorkOrderBundle(wo, options) {
  return PP_Inspection_result_(function() {
    const folio = PP_Inspection_text_(wo, 80);
    if (!folio) throw new Error('OT requerida');
    let cache = null;
    try {
      cache = CacheService.getScriptCache();
    } catch (error) {
      cache = null;
    }
    const cacheKey = 'PP_INSPECTION_WO_BUNDLE_' + folio;
    const forceRefresh = options && options.forceRefresh === true;
    if (!forceRefresh && cache) {
      try {
        const cached = cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (error) {
        // La cache es opcional; continuar con las fuentes de verdad.
      }
    }
    const detail = getInspectionWorkOrder(folio);
    if (!detail.ok) throw new Error(detail.error);
    const history = getInspectionHistory(folio);
    if (!history.ok) throw new Error(history.error);
    const bundle = { detail: detail.data, history: history.data };
    if (cache) {
      try {
        cache.put(cacheKey, JSON.stringify(bundle), 300);
      } catch (error) {
        // Un fallo de cache no invalida datos obtenidos correctamente.
      }
    }
    return bundle;
  });
}

/**
 * EL INDICE DE TRAMOS, con los tres niveles de emparejamiento.
 *
 * MEDIDO 2026-10-01: antes armaba el indice LEYENDO LA HOJA `Tramos`. Ahora las
 * filas salen de `inspection_routes` en Supabase (PP_Inspection_routeIndexConFuente_,
 * 16-inspection-service.js) y lo unico que cambia aqui es de donde vienen: los tres
 * niveles de busqueda son los mismos de antes y por eso el resultado de la hoja de
 * impresion no se mueve.
 *
 * LOS TRES NIVELES, Y POR QUE HAY TRES. (1) `articulo|material` con
 * PP_normalizeKey_ es la clave de la fila, la que esta indexada. (2) El mismo par
 * con la clave laxa, que ademas quita la puntuacion: sin este, un material escrito
 * "MP-1" y otro "MP 1" no se encontrarian y el tramo salia vacio en silencio.
 * (3) `articulo|` con material vacio es el DIBUJO A NIVEL DE OT, que en la hoja es
 * una fila mas y no un caso aparte, y `byMaterialDrawing` es el ultimo recurso:
 * el dibujo guardado contra la materia prima, para cuando el material de la OT no
 * tiene fila propia.
 *
 * `rows` es lo que ve la tabla de Catálogos, y sale de `rowsByKey` (nivel 1) para
 * NO salir duplicado: una fila que esta en los tres niveles es un tramo, no tres.
 *
 * LA CACHE, Y POR QUE SIGUE VALIENDO. 15 minutos (PP_INSPECTION_ROUTE_INDEX_CACHE_TTL_SECONDS).
 * Antes era correcta porque la hoja no cambiaba sola; ahora la cambia la pagina, y
 * por eso el guardado desde la pagina NO la invalida (la cache es de Apps Script y
 * la escritura va por la Data API). El TTL corto es lo que acota el peor caso: un
 * tramo guardado en otra pestana se ve aqui hasta 15 minutos despues. No se bajo
 * el TTL porque el nombre de la OT se arma con esto en cada impresion, que es
 * donde si se paga la latencia. La importacion PP_migrarTramosASupabase_ si
 * invalida, porque ahi el cambio es de las 400 filas y no de una.
 */
function PP_Inspection_routeIndexV2_() {
  const cache = PP_Inspection_routeIndexCache_();
  if (cache) {
    try {
      const cached = cache.get(PP_INSPECTION_ROUTE_INDEX_CACHE_KEY);
      if (cached) return JSON.parse(cached);
    } catch (error) {
      // La cache es opcional; continuar con la fuente de verdad.
    }
  }
  const lectura = PP_Inspection_routeIndexConFuente_();
  const index = { rows: [], byMaterialDrawing: {}, fuente: lectura.fuente, aviso: lectura.aviso };
  const rowsByKey = {};
  Object.keys(lectura.index).forEach(function (clave) {
    const item = lectura.index[clave];
    const articleKey = PP_normalizeKey_(item.ARTICULO);
    const materialKey = PP_normalizeKey_(item.MATERIAL);
    const looseArticle = PP_Inspection_routeLooseKey_(item.ARTICULO);
    const looseMaterial = PP_Inspection_routeLooseKey_(item.MATERIAL);
    index[articleKey + '|' + materialKey] = item;
    index[looseArticle + '|' + looseMaterial] = item;
    if (!item.MATERIAL && item.DIBUJO) {
      index[articleKey + '|'] = item;
      index[looseArticle + '|'] = item;
    }
    if (item.MATERIAL && item.DIBUJO && !index.byMaterialDrawing[looseMaterial]) {
      index.byMaterialDrawing[looseMaterial] = item;
    }
    rowsByKey[articleKey + '|' + materialKey] = item;
  });
  index.rows = Object.keys(rowsByKey).map(function (key) { return rowsByKey[key]; });
  if (cache) {
    try {
      cache.put(PP_INSPECTION_ROUTE_INDEX_CACHE_KEY, JSON.stringify(index), PP_INSPECTION_ROUTE_INDEX_CACHE_TTL_SECONDS);
    } catch (error) {
      // Un fallo de cache no invalida datos correctos.
    }
  }
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
    const quantityTotal = Number(PP_Inspection_value_(workOrder, ['cantidad', 'quantity', 'qty']) || 0);
    const builtRaw = PP_Inspection_value_(workOrder, ['cantidadEnsamblada', 'Cantidad ensamblada', 'builtQuantity', 'built']);
    const pendingRaw = PP_Inspection_value_(workOrder, ['cantidadPendiente', 'Cantidad pendiente', 'pendingQuantity']);
    const builtQuantity = builtRaw === '' ? 0 : Math.max(0, PP_Inspection_number_(builtRaw));
    const pendingQuantity = pendingRaw === '' ? Math.max(0, quantityTotal - builtQuantity) : Math.max(0, PP_Inspection_number_(pendingRaw));
    return {
      workOrder: { wo: folio, article: article,
        description: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Descripcion', 'description'])),
        quantity: quantityTotal,
        builtQuantity: builtQuantity,
        pendingQuantity: pendingQuantity,
        dueDate: PP_Inspection_longDate_(PP_Inspection_value_(workOrder, ['fechaEntrega', 'duedate', 'enddate'])),
        status: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['estatus', 'status', 'Estado'])),
        revision: PP_Inspection_text_(PP_Inspection_value_(workOrder, ['Revision', 'revision', 'bomRevision'])) || 'A',
        drawing: drawingFallback },
      materials: materials, operations: operations,
      // MEDIDO 2026-10-01: los tramos salen de inspection_routes (Supabase) y la
      // hoja `Tramos` es el plan B. Cuando se usa el plan B el tramo y el dibujo de
      // esta OT pueden NO ser lo que esta guardado, y sin esto la impresion sale
      // igual de bien y con el dato viejo. Viaja en la respuesta para que la pagina
      // lo pueda decir en vez de imprimir un dato sin saberlo.
      routesFuente: routes.fuente || 'supabase',
      routesAviso: routes.aviso || ''
    };
  });
}

function getInspectionDrawingRoutes(article) {
  return PP_Inspection_result_(function() {
    const key = PP_normalizeKey_(article);
    const loose = PP_Inspection_routeLooseKey_(article);
    const index = PP_Inspection_routeIndexV2_();
    // El contrato de esta funcion es una lista y no se cambia (Bridge.html y las
    // pruebas dependen de eso), asi que el aviso del plan B no cabe en el valor de
    // retorno: se deja en el log, que es donde se mira cuando el listado sale raro.
    if (index.aviso) console.log('getInspectionDrawingRoutes: ' + index.aviso);
    return index.rows.filter(function(row) {
      return !key || PP_normalizeKey_(row.ARTICULO) === key || PP_Inspection_routeLooseKey_(row.ARTICULO) === loose;
    });
  });
}
