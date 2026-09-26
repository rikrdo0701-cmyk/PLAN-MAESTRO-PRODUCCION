const PP_PLANT_LOCATION_ID = 1;
const PP_PLANT_NAME = 'Planta MM del Llano';

const PP_OPERATIONS_RESTLET_ = { script: '2240', deploy: '1' };

function PP_operationsRestlet_() {
  return PP_OPERATIONS_RESTLET_;
}

function PP_hasNetSuiteCredentials_() {
  const properties = PropertiesService.getScriptProperties();
  return ['NS_ACCOUNT_ID', 'NS_CONSUMER_KEY', 'NS_CONSUMER_SECRET', 'NS_TOKEN', 'NS_TOKEN_SECRET']
    .every(function(key) { return Boolean(properties.getProperty(key)); });
}

function configureNetSuiteCredentials_(settings) {
  if (!settings) throw new Error('Falta configuracion NetSuite');
  const properties = PropertiesService.getScriptProperties();
  const mapping = {
    accountId: 'NS_ACCOUNT_ID', consumerKey: 'NS_CONSUMER_KEY', consumerSecret: 'NS_CONSUMER_SECRET',
    token: 'NS_TOKEN', tokenSecret: 'NS_TOKEN_SECRET'
  };
  Object.keys(mapping).forEach(function(key) {
    if (!settings[key]) throw new Error('Falta ' + key);
    properties.setProperty(mapping[key], String(settings[key]).trim());
  });
  if (settings.locationId && Number(settings.locationId) !== PP_PLANT_LOCATION_ID) {
    throw new Error('Esta app solo admite la ubicacion Planta MM del Llano (locationId=1)');
  }
  properties.setProperty('NS_LOCATION_ID', String(PP_PLANT_LOCATION_ID));
  return { ok: true, configured: true, locationId: PP_PLANT_LOCATION_ID, plant: PP_PLANT_NAME };
}

function PP_netSuiteConfig_() {
  if (!PP_hasNetSuiteCredentials_()) throw new Error('NetSuite no configurado. Agrega las propiedades NS_* en la configuracion del proyecto.');
  const p = PropertiesService.getScriptProperties();
  return {
    accountId: p.getProperty('NS_ACCOUNT_ID'),
    consumerKey: p.getProperty('NS_CONSUMER_KEY'),
    consumerSecret: p.getProperty('NS_CONSUMER_SECRET'),
    token: p.getProperty('NS_TOKEN'),
    tokenSecret: p.getProperty('NS_TOKEN_SECRET'),
    locationId: PP_PLANT_LOCATION_ID
  };
}

function PP_syncNetSuitePlant_(current) {
  return PP_applyNetSuitePlantData_(current, PP_fetchNetSuitePlantData_());
}

function PP_fetchNetSuitePlantData_() {
  const config = PP_netSuiteConfig_();
  const operationCatalogResult = PP_fetchNetSuiteOperationCatalogCached_(config);
  const workOrders = PP_fetchRestletPages_({ script: '1764', deploy: '1' }, { table: 'WO_LISTA', locationId: config.locationId, onlyOpen: true }, config, 10);
  const plantFilter = PP_buildPlantFilter_(workOrders.rows);
  const operationsResponse = PP_fetchRestletPages_(PP_operationsRestlet_(), { locationId: config.locationId, onlyOpen: true }, config, 20);
  const plantOperations = operationsResponse.rows.filter(function(row) { return PP_belongsToPlant_(row, plantFilter); });
  const invoiceWindow = PP_invoiceAverageWindow_(new Date());
  // Ver PP_fetchNetSuiteWorkOrdersData_: el precio va cacheado y la lista de OTs no.
  const cachedPrices = PP_fetchSalesPricesRestletCached_(config, invoiceWindow);
  const salesPrices = cachedPrices.prices;
  const salesPricesOk = cachedPrices.ok;
  const baseCatalog = PP_buildWorkOrderCatalog_(workOrders.rows, plantOperations);
  const workOrderCatalog = PP_enrichWorkOrderPhotos_(
    salesPricesOk ? PP_applySalesPrices_(baseCatalog, salesPrices) : baseCatalog
  );
  PP_assertNetSuiteRows_(workOrderCatalog, 'OTs', { restlet: '1764/1', rawRows: workOrders.rows.length });
  PP_assertNetSuiteRows_(plantOperations, 'operaciones', { restlet: PP_operationsRestlet_().script + '/' + PP_operationsRestlet_().deploy, workOrders: workOrderCatalog.length });
  const materialsResponse = PP_fetchRestletPages_({ script: '1763', deploy: '14' }, { locationId: config.locationId, onlyOpen: true, maxWOs: 50000 }, config, 20);
  const materials = materialsResponse.rows
    .filter(function(row) { return PP_belongsToPlant_(row, plantFilter); })
    .map(PP_mapNetSuiteMaterial_);

  return {
    workOrders: workOrderCatalog,
    plantOperations: plantOperations,
    materials: materials,
    operationCatalog: operationCatalogResult.items,
    operationCatalogWarning: operationCatalogResult.warning,
    invoicePriceWindow: { from: salesPrices.from, to: salesPrices.to, warning: salesPrices.warning || '' },
    fetchedAt: new Date().toISOString()
  };
}

function PP_fetchNetSuiteWorkOrdersData_() {
  const config = PP_netSuiteConfig_();
  const workOrders = PP_fetchRestletPages_({ script: '1764', deploy: '1' }, { table: 'WO_LISTA', locationId: config.locationId, onlyOpen: true }, config, 10);
  const invoiceWindow = PP_invoiceAverageWindow_(new Date());
  // Los precios SIENTEN cache: son el unico fetch caro (el 1766 pagina REQ_FIFO, hasta 100
  // paginas) y no participan en la frescura del plan, que depende de la lista de OTs (1764),
  // que se sigue leyendo viva en cada sincronizacion. Cachear el snapshot entero habria
  // falseado syncedAt y con el la deteccion de OTs cerradas (RULE-OT-046), asi que el cache va
  // solo sobre el precio.
  const cachedPrices = PP_fetchSalesPricesRestletCached_(config, invoiceWindow);
  const salesPrices = cachedPrices.prices;
  const salesPricesOk = cachedPrices.ok;
  const baseCatalog = PP_buildWorkOrderCatalog_(workOrders.rows, []);
  const workOrderCatalog = PP_enrichWorkOrderPhotos_(
    salesPricesOk ? PP_applySalesPrices_(baseCatalog, salesPrices) : baseCatalog
  );
  PP_assertNetSuiteRows_(workOrderCatalog, 'OTs', { restlet: '1764/1', rawRows: workOrders.rows.length });
  return {
    workOrders: workOrderCatalog,
    invoicePriceWindow: { from: salesPrices.from, to: salesPrices.to, warning: salesPrices.warning || '' },
    fetchedAt: new Date().toISOString()
  };
}

function PP_fetchNetSuitePlanningData_(current) {
  if (!current || !Array.isArray(current.workOrders) || !current.workOrders.length) {
    return PP_fetchNetSuitePlantData_();
  }
  const config = PP_netSuiteConfig_();
  const operationCatalogResult = PP_fetchNetSuiteOperationCatalogCached_(config);
  const plantFilter = PP_buildPlantFilterFromWorkOrders_(current.workOrders);
  const operationsResponse = PP_fetchRestletPages_(PP_operationsRestlet_(), { locationId: config.locationId, onlyOpen: true }, config, 20);
  const plantOperations = operationsResponse.rows.filter(function(row) { return PP_belongsToPlant_(row, plantFilter); });
  PP_assertNetSuiteRows_(plantOperations, 'operaciones', { restlet: PP_operationsRestlet_().script + '/' + PP_operationsRestlet_().deploy, workOrders: current.workOrders.length });
  const materialsResponse = PP_fetchRestletPages_({ script: '1763', deploy: '14' }, { locationId: config.locationId, onlyOpen: true, maxWOs: 50000 }, config, 20);
  const materials = materialsResponse.rows
    .filter(function(row) { return PP_belongsToPlant_(row, plantFilter); })
    .map(PP_mapNetSuiteMaterial_);
  return {
    plantOperations: plantOperations,
    materials: materials,
    operationCatalog: operationCatalogResult.items,
    operationCatalogWarning: operationCatalogResult.warning,
    fetchedAt: new Date().toISOString()
  };
}

function PP_assertNetSuiteRows_(rows, label, context) {
  if (Array.isArray(rows) && rows.length > 0) return;
  const detail = context ? ' Detalle: ' + JSON.stringify(context) : '';
  throw new Error('NetSuite devolvio 0 ' + label + ' para Planta MM del Llano. Revisa propiedades NS_*, permisos del deployment, permisos del token y RESTlets 1764/1, operaciones ' + PP_operationsRestlet_().script + '/' + PP_operationsRestlet_().deploy + ' y 1763/14.' + detail);
}

function PP_preservedToolChanges_(current, operations) {
  const presentOts = {};
  (operations || []).forEach(function(row) {
    const key = PP_normalizeKey_(row && row.ot);
    if (key) presentOts[key] = true;
  });
  return (current && current.operations || []).filter(function(op) {
    return op && PP_normalizeKey_(op.tipoInsercion) === 'CAMBIO_HERRAMENTAL' && presentOts[PP_normalizeKey_(op.ot)];
  });
}

function PP_preserveWorkOrderLocalFields_(item, previous) {
  item.dueDateOverride = String(previous.dueDateOverride || '').trim();
  if (!(Number(item.lastSalePrice) > 0) && Number(previous.lastSalePrice) > 0) {
    item.lastSalePrice = Number(previous.lastSalePrice);
  }
  if (!(Number(item.averageSalePrice) > 0) && Number(previous.averageSalePrice) > 0) {
    item.averageSalePrice = Number(previous.averageSalePrice);
  }
  if (!String(item.averageSalePriceFrom || '').trim() && previous.averageSalePriceFrom) {
    item.averageSalePriceFrom = previous.averageSalePriceFrom;
  }
  if (!String(item.averageSalePriceTo || '').trim() && previous.averageSalePriceTo) {
    item.averageSalePriceTo = previous.averageSalePriceTo;
  }
  if (!String(item.photoUrl || '').trim() && previous.photoUrl) {
    item.photoUrl = previous.photoUrl;
  }
  return item;
}

function PP_applyNetSuitePlantData_(current, snapshot) {
  const workOrderCatalog = JSON.parse(JSON.stringify(snapshot.workOrders || []));
  const previousWorkOrders = {};
  ((current && current.workOrders) || []).forEach(function(item) {
    previousWorkOrders[PP_normalizeKey_(item.ot)] = item;
  });
  workOrderCatalog.forEach(function(item) {
    PP_preserveWorkOrderLocalFields_(item, previousWorkOrders[PP_normalizeKey_(item.ot)] || {});
  });
  const plantOperations = snapshot.plantOperations || [];
  const catalogFilter = PP_buildPlantFilterFromWorkOrders_(workOrderCatalog);
  const contextForOperations = Object.assign({}, current, { workOrders: workOrderCatalog });
  const droppedPlaceholderOperations = [];
  const operations = plantOperations
    .filter(PP_isSchedulable_)
    .filter(function(row) { return PP_belongsToPlant_(row, catalogFilter); })
    .filter(function(row) {
      const reason = PP_placeholderOperationReason_(row);
      if (reason) {
        droppedPlaceholderOperations.push('EXCLUIDA_NOMBRE_PLACEHOLDER ' + reason + ' (OT ' + String(PP_pick_(row, ['Orden de trabajo', 'workorder_tranid']) || '') + ')');
        return false;
      }
      return true;
    })
    .map(function(row, index) { return PP_mapNetSuiteOperation_(row, index, contextForOperations); });
  const materials = snapshot.materials || [];

  const merged = JSON.parse(JSON.stringify(current || {}));
  merged.operations = PP_preservedToolChanges_(current, operations).concat(operations);
  merged.workOrders = workOrderCatalog;
  merged.materials = materials;
  merged.syncWarnings = (Array.isArray(merged.syncWarnings) ? merged.syncWarnings : []).concat(droppedPlaceholderOperations);
  merged.operationCatalog = PP_resolveOperationCatalog_(current, snapshot, plantOperations);
  merged.operationCatalogWarning = String(snapshot.operationCatalogWarning || '');
  const openOts = {};
  workOrderCatalog.forEach(function(item) { openOts[PP_normalizeKey_(item.ot)] = true; });
  merged.operationPlanStatuses = Object.keys(merged.operationPlanStatuses || {}).reduce(function(out, key) {
    const item = merged.operationPlanStatuses[key] || {};
    if (openOts[PP_normalizeKey_(item.ot)]) out[key] = item;
    return out;
  }, {});
  merged.plant = {
    name: PP_PLANT_NAME,
    locationId: PP_PLANT_LOCATION_ID,
    workOrdersInPlant: workOrderCatalog.length,
    schedulableOperationsInPlant: operations.length,
    materialRowsInPlant: materials.length,
    workOrdersWithPhoto: workOrderCatalog.filter(function(item) { return Boolean(item.photoUrl); }).length
  };
  merged.invoicePriceWindow = snapshot.invoicePriceWindow || null;
  merged.source = 'NetSuite RESTlets / Apps Script';
  merged.syncedAt = snapshot.fetchedAt || new Date().toISOString();
  merged.revision = Number(current.revision || 0);
  return merged;
}

function PP_applyNetSuiteWorkOrdersData_(current, snapshot) {
  const workOrderCatalog = JSON.parse(JSON.stringify(snapshot.workOrders || []));
  const previousWorkOrders = {};
  ((current && current.workOrders) || []).forEach(function(item) {
    previousWorkOrders[PP_normalizeKey_(item.ot)] = item;
  });
  workOrderCatalog.forEach(function(item) {
    PP_preserveWorkOrderLocalFields_(item, previousWorkOrders[PP_normalizeKey_(item.ot)] || {});
  });

  const merged = JSON.parse(JSON.stringify(current || {}));
  merged.workOrders = workOrderCatalog;
  const openOts = {};
  workOrderCatalog.forEach(function(item) { openOts[PP_normalizeKey_(item.ot)] = true; });
  merged.operationPlanStatuses = Object.keys(merged.operationPlanStatuses || {}).reduce(function(out, key) {
    const item = merged.operationPlanStatuses[key] || {};
    if (openOts[PP_normalizeKey_(item.ot)]) out[key] = item;
    return out;
  }, {});
  // Una OT que NetSuite ya no lista como abierta no puede seguir en la cola del plan.
  // Sin esto CONFIG.selectedOts la conservaba para siempre: el cliente la podaba solo en
  // memoria (pruneDraftToOpenWorkOrders) y la vuelta a cargar la resucitaba.
  merged.selectedOts = (merged.selectedOts || []).filter(function(ot) { return openOts[PP_normalizeKey_(ot)]; });
  merged.lockedOts = (merged.lockedOts || []).filter(function(ot) { return openOts[PP_normalizeKey_(ot)]; });
  merged.expandedOts = (merged.expandedOts || []).filter(function(ot) { return openOts[PP_normalizeKey_(ot)]; });
  if (merged.lastSchedule && Array.isArray(merged.lastSchedule.scheduledOts)) {
    merged.lastSchedule = Object.assign({}, merged.lastSchedule, {
      scheduledOts: merged.lastSchedule.scheduledOts.filter(function(ot) { return openOts[PP_normalizeKey_(ot)]; })
    });
  }
  merged.plant = Object.assign({}, merged.plant || {}, {
    name: PP_PLANT_NAME,
    locationId: PP_PLANT_LOCATION_ID,
    workOrdersInPlant: workOrderCatalog.length,
    workOrdersWithPhoto: workOrderCatalog.filter(function(item) { return Boolean(item.photoUrl); }).length
  });
  merged.invoicePriceWindow = snapshot.invoicePriceWindow || null;
  merged.source = 'NetSuite RESTlets / Apps Script (OTs)';
  merged.syncedAt = snapshot.fetchedAt || new Date().toISOString();
  merged.revision = Number(current.revision || 0);
  return merged;
}

function PP_applyNetSuitePlanningData_(current, snapshot) {
  if (snapshot.workOrders) return PP_applyNetSuitePlantData_(current, snapshot);
  const plantOperations = snapshot.plantOperations || [];
  const catalogFilter = PP_buildPlantFilterFromWorkOrders_(current.workOrders);
  const droppedPlaceholderOperations = [];
  const operations = plantOperations
    .filter(PP_isSchedulable_)
    .filter(function(row) { return PP_belongsToPlant_(row, catalogFilter); })
    .filter(function(row) {
      const reason = PP_placeholderOperationReason_(row);
      if (reason) {
        droppedPlaceholderOperations.push('EXCLUIDA_NOMBRE_PLACEHOLDER ' + reason + ' (OT ' + String(PP_pick_(row, ['Orden de trabajo', 'workorder_tranid']) || '') + ')');
        return false;
      }
      return true;
    })
    .map(function(row, index) { return PP_mapNetSuiteOperation_(row, index, current); });
  const materials = snapshot.materials || [];
  const merged = JSON.parse(JSON.stringify(current || {}));
  merged.operations = PP_preservedToolChanges_(current, operations).concat(operations);
  merged.materials = materials;
  merged.syncWarnings = (Array.isArray(merged.syncWarnings) ? merged.syncWarnings : []).concat(droppedPlaceholderOperations);
  merged.operationCatalog = PP_resolveOperationCatalog_(current, snapshot, plantOperations);
  merged.operationCatalogWarning = String(snapshot.operationCatalogWarning || '');
  merged.plant = Object.assign({}, merged.plant || {}, {
    name: PP_PLANT_NAME,
    locationId: PP_PLANT_LOCATION_ID,
    schedulableOperationsInPlant: operations.length,
    materialRowsInPlant: materials.length
  });
  merged.source = 'NetSuite RESTlets / Apps Script (operaciones)';
  merged.syncedAt = snapshot.fetchedAt || new Date().toISOString();
  merged.revision = Number(current.revision || 0);
  return merged;
}

function PP_invoiceAverageWindow_(endDate) {
  const end = new Date(endDate || new Date());
  const start = new Date(end);
  start.setMonth(start.getMonth() - 6);
  const minimum = new Date(2026, 1, 1);
  if (start < minimum) start.setTime(minimum.getTime());
  return {
    from: Utilities.formatDate(start, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    to: Utilities.formatDate(end, Session.getScriptTimeZone(), 'yyyy-MM-dd')
  };
}

function PP_fetchNetSuiteOperationCatalogCached_(config) {
  const scope = PP_normalizeKey_(config.accountId + '_' + config.locationId);
  const cacheKey = 'NS_OPERATION_CATALOG_V1_' + scope;
  const attemptKey = 'NS_OPERATION_CATALOG_ATTEMPT_V1_' + scope;
  let cache = PP_getNetSuiteOperationCatalogCache_();
  let items = PP_readNetSuiteOperationCatalogCache_(cache, cacheKey);
  if (items.length) return { items: items, warning: '' };

  let lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) return PP_netSuiteOperationCatalogDeferred_('actualizacion en curso');
  } catch (_) {
    return PP_netSuiteOperationCatalogDeferred_('bloqueo temporal no disponible');
  }

  try {
    if (!cache) cache = PP_getNetSuiteOperationCatalogCache_();
    items = PP_readNetSuiteOperationCatalogCache_(cache, cacheKey);
    if (items.length) return { items: items, warning: '' };

    const now = Date.now();
    let properties;
    let lastAttemptRaw = '';
    try {
      properties = PropertiesService.getScriptProperties();
      lastAttemptRaw = properties.getProperty(attemptKey) || '';
    } catch (_) {
      return PP_netSuiteOperationCatalogDeferred_('lectura de cooldown no disponible');
    }
    const lastAttempt = Number(lastAttemptRaw || 0);
    if (lastAttemptRaw && (!Number.isFinite(lastAttempt) || lastAttempt <= 0)) {
      return PP_netSuiteOperationCatalogDeferred_('marcador de cooldown invalido');
    }
    if (lastAttempt > 0 && now - lastAttempt < 3600000) {
      return PP_netSuiteOperationCatalogDeferred_('consulta omitida durante cooldown');
    }
    const attemptMarker = String(now);
    try {
      properties.setProperty(attemptKey, attemptMarker);
      if (properties.getProperty(attemptKey) !== attemptMarker) throw new Error('cooldown no persistido');
    } catch (_) {
      return PP_netSuiteOperationCatalogDeferred_('escritura de cooldown no disponible');
    }

    const result = PP_fetchNetSuiteOperationCatalog_(config);
    if (result.items.length && cache) {
      try { cache.put(cacheKey, JSON.stringify(result.items), 3600); } catch (_) {}
    }
    return result;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function PP_getNetSuiteOperationCatalogCache_() {
  try { return CacheService.getScriptCache(); } catch (_) { return null; }
}

function PP_readNetSuiteOperationCatalogCache_(cache, key) {
  if (!cache) return [];
  let cached = '';
  try { cached = cache.get(key); } catch (_) { return []; }
  if (!cached) return [];
  try { return PP_validateNetSuiteOperationCatalogCache_(JSON.parse(cached)); } catch (_) { return []; }
}

function PP_validateNetSuiteOperationCatalogCache_(items) {
  if (!Array.isArray(items) || !items.length) return [];
  const catalog = {};
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)
        || typeof item.key !== 'string' || typeof item.ct !== 'string'
        || typeof item.label !== 'string' || item.source !== 'NETSUITE_MASTER'
        || item.active !== true) return [];
    const ct = item.ct.trim();
    const label = item.label.trim();
    const key = ct + '::' + PP_normalizeKey_(label);
    if (!ct || !label || item.key !== key) return [];
    if (PP_isSpecialNetSuiteOperation_(ct, label)) continue;
    if (!catalog[key]) {
      catalog[key] = { key: key, ct: ct, label: label, source: 'NETSUITE_MASTER', active: true };
    }
  }
  return Object.keys(catalog).sort().map(function(key) { return catalog[key]; });
}

function PP_netSuiteOperationCatalogDeferred_(reason) {
  return { items: [], warning: 'Catálogo de operaciones NetSuite no disponible: ' + reason };
}

function PP_fetchNetSuiteOperationCatalog_(config) {
  const endpoint = 'https://' + String(config.accountId).toLowerCase() + '.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
  const limit = 1000;
  const sql = [
    'SELECT routing.id AS routing_id,',
    'step.operationsequence AS operation_sequence,',
    'step.id AS step_id,',
    'BUILTIN.DF(step.manufacturingworkcenter) AS work_center,',
    'step.operationname AS operation_name',
    'FROM manufacturingroutingstep step',
    'JOIN manufacturingrouting routing ON routing.id = step.manufacturingrouting',
    'JOIN entitygroup center ON center.id = step.manufacturingworkcenter',
    "WHERE NVL(routing.isinactive, 'F') = 'F'",
    "AND NVL(center.isinactive, 'F') = 'F'",
    'ORDER BY routing_id, operation_sequence, step_id'
  ].join(' ');
  const catalog = {};
  try {
    for (let offset = 0, page = 0; page < 100; page++, offset += limit) {
      const query = { limit: limit, offset: offset };
      const finalUrl = endpoint + '?limit=' + limit + '&offset=' + offset;
      const response = UrlFetchApp.fetch(finalUrl, {
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
      if (status < 200 || status >= 300) throw new Error('HTTP ' + status);
      let json;
      try { json = JSON.parse(raw || '{}'); } catch (error) { throw new Error('JSON invalido'); }
      if (!Array.isArray(json.items)) throw new Error('respuesta sin items');
      if (typeof json.hasMore !== 'boolean') throw new Error('respuesta sin hasMore booleano');
      const malformedRow = json.items.some(function(row) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
        const workCenter = row.work_center != null ? row.work_center : row.workCenter;
        const operationName = row.operation_name != null ? row.operation_name : row.operationName;
        return !String(workCenter || '').trim() || !String(operationName || '').trim();
      });
      if (malformedRow) throw new Error('fila de operacion incompleta');
      json.items.forEach(function(row) {
        const workCenter = String(row.work_center || row.workCenter || '').trim();
        const label = String(row.operation_name || row.operationName || '').trim();
        const ct = PP_extractOperationCatalogCt_(workCenter);
        if (!ct || !label || PP_isSpecialNetSuiteOperation_(ct, label)) return;
        const key = ct + '::' + PP_normalizeKey_(label);
        if (!catalog[key]) {
          catalog[key] = { key: key, ct: ct, label: label, source: 'NETSUITE_MASTER', active: true };
        }
      });
      if (json.hasMore !== true) break;
      if (page === 99) throw new Error('paginacion incompleta');
    }
    const items = Object.keys(catalog).sort().map(function(key) { return catalog[key]; });
    if (!items.length) throw new Error('respuesta sin operaciones validas');
    return { items: items, warning: '' };
  } catch (error) {
    return { items: [], warning: 'Catálogo de operaciones NetSuite no disponible: ' + String(error.message || error).slice(0, 100) };
  }
}

function PP_extractOperationCatalogCt_(workCenter) {
  const text = String(workCenter || '').trim();
  const match = text.match(/(?:^|\b)CT[\s:_-]*(\d{3,})\b/i) || text.match(/\b(\d{3,})\b/);
  return match ? match[1] : text;
}

function PP_isSpecialNetSuiteOperation_(ct, label) {
  const normalized = PP_normalizeKey_(String(ct || '') + ' ' + String(label || '')).replace(/[^A-Z0-9]+/g, '');
  return ['SUBCONTRATO', 'CROMADO', 'METOKOTE', 'MAKA', 'GALVANIZADO'].some(function(term) {
    return normalized.indexOf(term) >= 0;
  });
}

function PP_resolveOperationCatalog_(current, snapshot, plantOperations) {
  if (Array.isArray(snapshot.operationCatalog) && snapshot.operationCatalog.length) return snapshot.operationCatalog;
  if (current && Array.isArray(current.operationCatalog) && current.operationCatalog.length) return current.operationCatalog;
  return PP_buildOperationCatalog_(plantOperations);
}

const PP_SALES_PRICES_CACHE_TTL_S_ = 3600;
const PP_SALES_PRICES_COOLDOWN_MS_ = 3600000;

/**
 * Cache de los precios de venta del 1766 (REQ_FIFO).
 *
 * Por que existe: el 1766 pagina REQ_FIFO (hasta 100 paginas) y es, con diferencia, el fetch
 * mas caro del arranque: la app sincroniza en cada carga, y la cuota diaria de UrlFetch de
 * Apps Script es por consumidor (20 000/dia en cuentas de consumidor). Agotada, TODA llamada
 * falla con "Service invoked too many times for one day: urlfetch" y la app deja de poder
 * sincronizar nada.
 *
 * Por que NO se cachea el snapshot entero: la frescura del plan depende de la lista de OTs
 * (1764), que es lo que detecta las OTs cerradas (RULE-OT-046). Cachear el snapshot
 * falsearia syncedAt y las OTs cerradas volverian a colarse. El precio no participa en esa
 * decision, asi que es justo lo que se puede cachear.
 *
 * El costo es hasta una hora de retraso en el precio de venta; la foto, la cantidad y el
 * estatus de la OT siempre se leen vivos.
 */
function PP_fetchSalesPricesRestletCached_(config, window) {
  const scope = PP_normalizeKey_(
    config.accountId + '_' + config.locationId + '_' + window.from + '_' + window.to
  );
  const cacheKey = 'NS_SALES_PRICES_V1_' + scope;
  const attemptKey = 'NS_SALES_PRICES_ATTEMPT_V1_' + scope;
  const empty = { lastByItem: {}, avgByItem: {}, from: window.from, to: window.to, warning: '' };
  let cache = PP_getSalesPricesCache_();
  const cached = PP_readSalesPricesCache_(cache, cacheKey, window);
  if (cached) return { prices: cached, ok: true };

  let lock = null;
  try {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(5000)) {
      return { prices: Object.assign({}, empty, { warning: 'precios: actualizacion en curso' }), ok: false };
    }
  } catch (_) {
    return { prices: Object.assign({}, empty, { warning: 'precios: bloqueo no disponible' }), ok: false };
  }

  try {
    // Doble lectura dentro del lock: otra ejecucion pudo llenarlo mientrasEsperabamos.
    if (!cache) cache = PP_getSalesPricesCache_();
    const afterLock = PP_readSalesPricesCache_(cache, cacheKey, window);
    if (afterLock) return { prices: afterLock, ok: true };

    let properties = null;
    let lastAttemptRaw = '';
    try {
      properties = PropertiesService.getScriptProperties();
      lastAttemptRaw = properties.getProperty(attemptKey) || '';
    } catch (_) {
      return { prices: Object.assign({}, empty, { warning: 'precios: cooldown ilegible' }), ok: false };
    }
    const lastAttempt = Number(lastAttemptRaw || 0);
    if (lastAttemptRaw && (!Number.isFinite(lastAttempt) || lastAttempt <= 0)) {
      return { prices: Object.assign({}, empty, { warning: 'precios: marcador de cooldown invalido' }), ok: false };
    }
    if (lastAttempt > 0 && Date.now() - lastAttempt < PP_SALES_PRICES_COOLDOWN_MS_) {
      return { prices: Object.assign({}, empty, { warning: 'precios: omitido durante cooldown' }), ok: false };
    }
    const marker = String(Date.now());
    try {
      properties.setProperty(attemptKey, marker);
      if (properties.getProperty(attemptKey) !== marker) throw new Error('cooldown no persistido');
    } catch (_) {
      return { prices: Object.assign({}, empty, { warning: 'precios: cooldown no escribible' }), ok: false };
    }

    const prices = PP_fetchSalesPricesRestlet_(config, window);
    if (cache && prices.lastByItem && Object.keys(prices.lastByItem).length) {
      const payload = { source: 'NETSUITE_1766', from: window.from, to: window.to, lastByItem: prices.lastByItem, avgByItem: prices.avgByItem };
      try { cache.put(cacheKey, JSON.stringify(payload), PP_SALES_PRICES_CACHE_TTL_S_); } catch (_) {}
    }
    return { prices: prices, ok: true };
  } catch (error) {
    // Un fallo NO se cachea: el cooldown de arriba evita la tormenta de reintentos y el
    // siguiente intento real vuelve a intentarlo.
    return { prices: Object.assign({}, empty, { warning: String(error && error.message || error) }), ok: false };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function PP_getSalesPricesCache_() {
  try { return CacheService.getScriptCache(); } catch (_) { return null; }
}

function PP_readSalesPricesCache_(cache, key, window) {
  if (!cache) return null;
  let raw = '';
  try { raw = cache.get(key); } catch (_) { return null; }
  if (!raw) return null;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.source !== 'NETSUITE_1766') return null;
  // La ventana va en la clave, pero se revalida: un cambio de periodo debe invalidar el
  // promedio de 6 meses, no servirlo mezclado con otro.
  if (String(parsed.from) !== String(window.from) || String(parsed.to) !== String(window.to)) return null;
  if (!parsed.lastByItem || typeof parsed.lastByItem !== 'object' || Array.isArray(parsed.lastByItem)) return null;
  if (!parsed.avgByItem || typeof parsed.avgByItem !== 'object' || Array.isArray(parsed.avgByItem)) return null;
  return { lastByItem: parsed.lastByItem, avgByItem: parsed.avgByItem, from: parsed.from, to: parsed.to, warning: '' };
}

function PP_fetchSalesPricesRestlet_(config, window) {
  const page = PP_fetchRestletPages_({ script: '1766', deploy: '1' }, { table: 'REQ_FIFO' }, config, 100);
  const lastByItem = {};
  const lastDateByItem = {};
  const sumAmt = {};
  const sumQty = {};
  const cutoff = new Date(window.from + 'T00:00:00');
  (page.rows || []).forEach(function(row) {
    const itemId = String(row._ITEM_ID || '').trim();
    const itemName = String(PP_pick_(row, ['_ITEM_NAME', 'item_name', 'Articulo', 'Item', 'ITEM', 'PARTE']) || '').trim();
    // 'PRECIO BASE MNX' miente el nombre: viene en la MONEDA de la transaccion, no en pesos.
    // Verificado con datos reales de REQ_FIFO (2026-09-26): la linea
    //   PRECIO BASE MNX 3204.25 | MONEDA 'US Dollar' | TIPO CAMBIO 18.31 | CANTIDAD ORDEN 22
    //   TAX AMOUNT 11278.96 | GROSS AMT 81772.46
    // cierra exacto con el precio CRUDO (3204.25 x 22 = 70 493.50; x 0.16 = 11 278.96), o sea
    // que ni el impuesto ni el total del restlet aplican el tipo de cambio. Tomarlo como pesos
    // subestima el precio ~18x en las ventas en dolar y con ello los montos de los reportes.
    // TIPO CAMBIO viene como MXN por unidad de la moneda extranjera, asi que multiplicar es lo
    // correcto y en pesos es un factor 1 (no cambia nada).
    const rawPrice = Number(PP_pick_(row, ['PRECIO BASE MNX', 'precio_base_mnx']) || 0);
    const exchangeRate = Number(PP_pick_(row, ['TIPO CAMBIO', 'tipo_cambio']) || 0);
    const price = exchangeRate > 0 ? rawPrice * exchangeRate : rawPrice;
    const qty = Number(PP_pick_(row, ['CANTIDAD ORDEN', 'cantidad_orden']) || 0);
    const orderedAt = PP_parseRestletDate_(PP_pick_(row, ['FECHA DE ORDEN', 'fecha_orden']));
    const keys = [];
    if (itemId) keys.push(PP_normalizeKey_(itemId));
    if (itemName) keys.push(PP_normalizeKey_(itemName));
    if (!keys.length) return;
    if (orderedAt && isFinite(price)) {
      keys.forEach(function(key) {
        if (!lastDateByItem[key] || orderedAt.getTime() > lastDateByItem[key].getTime()) {
          lastDateByItem[key] = orderedAt;
          lastByItem[key] = price;
        }
      });
    }
    if (orderedAt && !isNaN(orderedAt.getTime()) && orderedAt.getTime() >= cutoff.getTime() && qty > 0 && price > 0) {
      keys.forEach(function(key) {
        sumAmt[key] = (sumAmt[key] || 0) + (price * qty);
        sumQty[key] = (sumQty[key] || 0) + qty;
      });
    }
  });
  const avgByItem = {};
  Object.keys(sumAmt).forEach(function(key) {
    if (sumQty[key] > 0) avgByItem[key] = sumAmt[key] / sumQty[key];
  });
  return { lastByItem: lastByItem, avgByItem: avgByItem, from: window.from, to: window.to, warning: '' };
}

function PP_parseRestletDate_(value) {
  if (!value) return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let day = Number(match[1]);
    let month = Number(match[2]);
    const year = Number(match[3]);
    let hour = Number(match[4]);
    const minute = Number(match[5]);
    const meridiem = String(match[6]).toUpperCase();
    if (meridiem === 'PM' && hour < 12) hour += 12;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 0, 0, 0, 0);
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  // DD/MM/AAAA hh:mm:ss y DD/MM/AAAA hh:mm: el de arriba solo acepta el formato con AM/PM, asi
  // que sin este patron la fecha cae en `new Date(texto)`, que en es-MX devuelve invalido y la
  // fila se descarta silenciosamente del precio (no entra ni a la ultima venta ni al promedio).
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return new Date(
      Number(match[3]), Number(match[2]) - 1, Number(match[1]),
      Number(match[4]), Number(match[5]), Number(match[6] || 0), 0
    );
  }
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function PP_applySalesPrices_(workOrders, prices) {
  return (workOrders || []).map(function(item) {
    const keys = [];
    if (item.itemId) keys.push(PP_normalizeKey_(item.itemId));
    if (item.item) keys.push(PP_normalizeKey_(item.item));
    let last = 0;
    let avg = 0;
    keys.forEach(function(key) {
      if (!last) last = Number((prices.lastByItem || {})[key] || 0);
      if (!avg) avg = Number((prices.avgByItem || {})[key] || 0);
    });
    item.lastSalePrice = last > 0 ? last : 0;
    item.averageSalePrice = avg > 0 ? avg : 0;
    item.averageSalePriceFrom = prices.from || '';
    item.averageSalePriceTo = prices.to || '';
    return item;
  });
}

// pageSize por RESTlet. 200 es el valor historical para todos; el 1766 (REQ_FIFO) admite
// 1000 y ya se usa asi en produccion en el script de inventario INV_PLANTAS_WIP, que es la
// prueba de que el restlet aguanta ese tamano. Con 200, la lectura de precios Pagina cinco
// veces mas veces que con 1000 sobre las mismas filas, y cada pagina es una peticion que puede
// chocar con el limite de solicitudes de NetSuite. Los demas restlets se quedan en 200
// porque su maximo no esta verificado.
const PP_RESTLET_PAGE_SIZE_ = { '1766': 1000 };

function PP_restletPageSize_(query) {
  var scriptId = String((query || {}).script || '');
  var configured = PP_RESTLET_PAGE_SIZE_[scriptId];
  return configured > 0 ? configured : 200;
}

function PP_fetchRestletPages_(query, baseBody, config, maxPages) {
  const rows = [];
  let headers = [];
  const pageSize = PP_restletPageSize_(query);
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const body = Object.assign({}, baseBody, { pageIndex: pageIndex, pageSize: pageSize });
    const response = PP_netSuiteRestletRequest_(query, body, config);
    if (!response.ok) throw new Error('NetSuite RESTlet: ' + response.status + ' ' + response.raw.slice(0, 500));
    headers = response.json.headers || headers;
    rows.push.apply(rows, PP_rowsAsObjects_(response.json, headers));
    if (response.json.hasMore !== true) break;
  }
  return { rows: rows, headers: headers };
}

const PP_NS_RATE_LIMIT_WAITS_MS_ = [2000, 5000, 10000];

function PP_isNetSuiteRateLimit_(result) {
  return result && result.status === 400 && String(result.raw || '').indexOf('SSS_REQUEST_LIMIT_EXCEEDED') >= 0;
}

function PP_netSuiteRestletRequest_(query, body, config) {
  const endpoint = 'https://' + String(config.accountId).toLowerCase() + '.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  const finalUrl = endpoint + '?' + Object.keys(query).map(function(key) { return PP_oauthEncode_(key) + '=' + PP_oauthEncode_(query[key]); }).join('&');
  const payload = JSON.stringify(body || {});
  const fetchOnce = function() {
    // OAuth 1.0a: cada reintento firma con nonce/timestamp nuevos.
    const response = UrlFetchApp.fetch(finalUrl, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: PP_oauthHeader_('POST', endpoint, query, config) },
      payload: payload,
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    const raw = response.getContentText();
    let json;
    try { json = JSON.parse(raw); } catch (error) { json = null; }
    return { ok: status >= 200 && status < 300 && json && json.ok === true, status: status, json: json || {}, raw: raw };
  };
  let result = fetchOnce();
  // NetSuite devuelve 400 SSS_REQUEST_LIMIT_EXCEEDED cuando se satura el limite de
  // solicitudes: es transitorio, se reintenta con espera antes de rendirse.
  for (let attempt = 0; PP_isNetSuiteRateLimit_(result) && attempt < PP_NS_RATE_LIMIT_WAITS_MS_.length; attempt++) {
    Utilities.sleep(PP_NS_RATE_LIMIT_WAITS_MS_[attempt]);
    result = fetchOnce();
  }
  return result;
}

function PP_oauthHeader_(method, endpoint, query, config) {
  const oauth = {
    oauth_consumer_key: config.consumerKey,
    oauth_token: config.token,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_nonce: Utilities.getUuid().replace(/-/g, ''),
    oauth_version: '1.0'
  };
  const signing = Object.assign({}, oauth, query || {});
  const parameterString = Object.keys(signing).sort().map(function(key) {
    return PP_oauthEncode_(key) + '=' + PP_oauthEncode_(signing[key]);
  }).join('&');
  const baseString = [method.toUpperCase(), PP_oauthEncode_(endpoint), PP_oauthEncode_(parameterString)].join('&');
  const signingKey = PP_oauthEncode_(config.consumerSecret) + '&' + PP_oauthEncode_(config.tokenSecret);
  const signature = Utilities.base64Encode(Utilities.computeHmacSha256Signature(baseString, signingKey));
  const params = Object.assign({}, oauth, { oauth_signature: signature });
  return 'OAuth realm="' + PP_oauthEncode_(config.accountId) + '",' + Object.keys(params).map(function(key) {
    return PP_oauthEncode_(key) + '="' + PP_oauthEncode_(params[key]) + '"';
  }).join(',');
}

function PP_oauthEncode_(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, function(char) {
    return '%' + char.charCodeAt(0).toString(16).toUpperCase();
  });
}

function PP_rowsAsObjects_(json, headers) {
  return (json.rows || []).map(function(row) {
    if (!Array.isArray(row)) return row || {};
    return headers.reduce(function(out, header, index) { out[header] = row[index]; return out; }, {});
  });
}

function PP_pick_(row, names) {
  const normalized = Object.keys(row || {}).reduce(function(out, key) { out[PP_normalizeKey_(key)] = key; return out; }, {});
  for (let index = 0; index < names.length; index++) {
    const key = normalized[PP_normalizeKey_(names[index])];
    if (key && row[key] != null && row[key] !== '') return row[key];
  }
  return '';
}

function PP_buildPlantFilter_(rows) {
  const ids = {};
  const folios = {};
  rows.forEach(function(row) {
    const id = String(PP_pick_(row, ['WO Internal ID', 'workorder_id', 'id']) || '').trim();
    const folio = String(PP_pick_(row, ['WO Folio', 'Orden de trabajo', 'workorder_tranid', 'tranid']) || '').trim();
    if (id) ids[id] = true;
    if (folio) folios[folio] = true;
  });
  return { ids: ids, folios: folios };
}

function PP_buildPlantFilterFromWorkOrders_(workOrders) {
  const ids = {};
  const folios = {};
  (workOrders || []).forEach(function(item) {
    const id = String(item.workOrderId || item.woInternalId || item.id || '').trim();
    const folio = String(item.ot || item.woFolio || '').trim();
    if (id) ids[id] = true;
    if (folio) folios[folio] = true;
  });
  return { ids: ids, folios: folios };
}

function PP_belongsToPlant_(row, filter) {
  const id = String(PP_pick_(row, ['workorder_id', 'WO Internal ID']) || '').trim();
  const folio = String(PP_pick_(row, ['workorder_tranid', 'WO Folio', 'Orden de trabajo']) || '').trim();
  return Boolean((id && filter.ids[id]) || (folio && filter.folios[folio]));
}

function PP_buildWorkOrderCatalog_(rows, operationRows) {
  const datesByOt = {};
  (operationRows || []).forEach(function(row) {
    const ot = String(PP_pick_(row, ['Orden de trabajo', 'workorder_tranid']) || '').trim();
    if (!ot) return;
    const key = PP_normalizeKey_(ot);
    const current = datesByOt[key] || { startDate: '', endDate: '' };
    const startDate = PP_netSuiteDate_(PP_pick_(row, ['Fecha inicio programada', 'start_planned', 'Fecha inicio real', 'start_actual']));
    const endDate = PP_netSuiteDate_(PP_pick_(row, ['Fecha fin programada', 'end_planned', 'Fecha fin real', 'end_actual']));
    if (startDate && (!current.startDate || startDate < current.startDate)) current.startDate = startDate;
    if (endDate && (!current.endDate || endDate > current.endDate)) current.endDate = endDate;
    datesByOt[key] = current;
  });

  return (rows || []).map(function(row, index) {
    const ot = String(PP_pick_(row, ['WO Folio', 'Orden de trabajo', 'workorder_tranid', 'tranid']) || '').trim();
    const workOrderId = String(PP_pick_(row, ['WO Internal ID', 'workorder_id', 'id']) || '').trim();
    const dates = datesByOt[PP_normalizeKey_(ot)] || {};
    const quantity = Number(PP_pick_(row, ['Cantidad', 'Quantity', 'quantity']) || 0);
    const builtQuantity = Math.max(0, Number(PP_pick_(row, ['Cantidad ensamblada', 'Cantidad construida', 'Quantity Built', 'Built', 'built_quantity', 'quantitybuilt']) || 0));
    return {
      id: 'wo-' + (workOrderId || ot || (index + 1)),
      workOrderId: workOrderId,
      ot: ot,
      itemId: String(PP_pick_(row, ['Item Internal ID', 'item_internal_id', 'itemid', 'Item ID', 'item_id', '_ITEM_ID']) || '').trim(),
      item: String(PP_pick_(row, ['Articulo', 'Item', 'item_name']) || '').trim(),
      description: String(PP_pick_(row, ['Descripcion', 'Description']) || '').trim(),
      photoUrl: String(PP_pick_(row, ['Foto URL', 'Imagen URL', 'URL de imagen', 'Image URL', 'image_url', 'item_image']) || '').trim(),
      startDate: PP_netSuiteDate_(PP_pick_(row, ['Fecha inicio programada', 'start_planned'])) || dates.startDate || '',
      endDate: PP_netSuiteDate_(PP_pick_(row, ['Fecha fin programada', 'end_planned'])) || dates.endDate || '',
      dueDate: PP_netSuiteDate_(PP_pick_(row, ['Fecha de vencimiento', 'Fecha vencimiento', 'due_date'])),
      quantity: quantity,
      builtQuantity: builtQuantity,
      pendingQuantity: Math.max(0, quantity - builtQuantity),
      status: String(PP_pick_(row, ['Estatus', 'Estado', 'Status']) || '').trim(),
      customer: String(PP_pick_(row, ['Cliente', 'Customer']) || '').trim()
    };
  }).filter(function(item) { return Boolean(item.ot); });
}

function PP_netSuiteDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return match[1] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[3]).padStart(2, '0');
  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (match) return match[3] + '-' + String(match[2]).padStart(2, '0') + '-' + String(match[1]).padStart(2, '0');
  return '';
}

function PP_isSchedulable_(row) {
  const status = PP_normalizeKey_(PP_pick_(row, ['Estado', 'Status', 'status_op'])).replace(/[ _-]/g, '');
  return ![
    'COMPLETE', 'COMPLET', 'CERRAD', 'CLOSED',
    'CANCELAD', 'CANCELED', 'CANCELLED'
  ].some(function(terminal) { return status.indexOf(terminal) >= 0; });
}

function PP_placeholderOperationReason_(row) {
  const descripcion = String(PP_pick_(row, ['Operacion', 'operation']) || '').trim();
  if (!descripcion) return null;
  const single = descripcion.toLowerCase().replace(/[\s_]+/g, '');
  return /^(delete\d*|prueba\d*|test\d*|x{2,}|\d+)$/.test(single) ? descripcion : null;
}

function PP_workOrderPendingQuantity_(current, ot) {
  if (!current || !Array.isArray(current.workOrders)) return 0;
  const found = current.workOrders.find(function(workOrder) {
    return PP_normalizeKey_(workOrder.ot) === PP_normalizeKey_(ot);
  });
  if (!found) return 0;
  return Math.max(0, Number(found.pendingQuantity || 0));
}

function PP_mapNetSuiteOperation_(row, index, current) {
  const ot = String(PP_pick_(row, ['Orden de trabajo', 'workorder_tranid']) || ('WO-' + (index + 1))).trim();
  const sequence = Number(PP_pick_(row, ['Secuencia', 'sequence']) || 1);
  const ct = String(PP_pick_(row, ['Centro de trabajo', 'CT', 'workcenter']) || 'SIN_CT').trim();
  const existing = (current.operations || []).find(function(op) {
    return PP_normalizeKey_(op.ot) === PP_normalizeKey_(ot) && Number(op.secuencia) === sequence && PP_normalizeKey_(op.ct) === PP_normalizeKey_(ct);
  }) || {};
  const qtyRaw = Number(PP_pick_(row, ['Cantidad a procesar', 'Cantidad de entrada', 'Cantidad', 'qty_to_process']) || 0);
  const qty = qtyRaw > 0 ? qtyRaw : PP_workOrderPendingQuantity_(current, ot);
  const done = Number(PP_pick_(row, ['Cantidad realizada', 'Cantidad completada', 'qty_completed']) || 0);
  const pending = Math.max(0, qty - done);
  const rateRaw = Number(PP_pick_(row, ['Tasa produccion', 'production_rate', 'Velocidad de ejecucion (minutos/unidad)', 'run_rate']));
  const setupRaw = Number(PP_pick_(row, ['Tiempo preparacion (min)', 'setup_min', 'Tiempo de configuracion (minutos)', 'setup_time']));
  const rate = Number.isFinite(rateRaw) ? Math.max(0, rateRaw) : 0;
  const setup = Number.isFinite(setupRaw) ? Math.max(0, setupRaw) : 0;
  const remaining = Number(PP_pick_(row, ['Trabajo restante (min)', 'remaining_min']) || 0);
  const estimated = Number(PP_pick_(row, ['Tiempo estimado (min)', 'est_min']) || 0);
  const production = pending > 0 && rate > 0 ? Math.round(rate * pending * 100) / 100 : (remaining || estimated || 0);
  const cycle = pending > 0 && production > 0 ? Math.round((production / pending) * 100) / 100 : 0;
  const priority = PP_priorityForOt_(current, ot);
  const netSuiteOperator = String(PP_pick_(row, ['Recurso humano', 'Operador', 'human_resource']) || '').trim();
  const netSuiteMachine = String(PP_pick_(row, ['Recurso maquina', 'Maquina', 'machine_resource']) || '').trim();
  const operator = PP_resolveNetSuiteOperator_(existing.operador, netSuiteOperator, current);
  const bending = ['5459', '5527'].indexOf(String(ct || '').trim()) >= 0;
  const machine = bending
    ? (existing.maquina && existing.maquina !== 'SIN_MAQUINA' ? existing.maquina : netSuiteMachine)
    : '';
  return {
    id: 'ns-' + String(PP_pick_(row, ['ID (link)', 'id']) || (index + 1)),
    num: index + 1,
    ot: ot,
    parte: String(PP_pick_(row, ['Articulo', 'Item', 'Parte', 'item_name']) || '').trim(),
    descripcion: String(PP_pick_(row, ['Operacion', 'operation']) || 'Operacion NetSuite').trim(),
    contenido: '',
    prioridad: priority,
    fechaReq: String(PP_pick_(row, ['Fecha fin programada', 'end_planned']) || '').slice(0, 10),
    cantTotal: pending,
    secuencia: sequence,
    ct: ct,
    operador: operator,
    maquina: machine,
    herramental: String(existing.herramental || '').trim(),
    kitHerramental: String(existing.kitHerramental || '').trim(),
    subcontractType: String(existing.subcontractType || '').trim(),
    subcontractDays: Number(existing.subcontractDays || 0),
    kitPending: existing.kitPending === true,
    autoFrozen: existing.autoFrozen === true,
    cantPendiente: pending,
    tiempoCiclo: cycle,
    tiempoSetup: setup,
    tiempoProd: production,
    fechaInicio: existing.fechaInicio || '', horaInicio: existing.horaInicio || '', fechaFin: existing.fechaFin || '', horaFin: existing.horaFin || '',
    tipoInsercion: 'OPERACION',
    estatus: String(PP_pick_(row, ['Estado', 'Status', 'status_op']) || 'No iniciado').trim(),
    log: 'NETSUITE_APPS_SCRIPT'
  };
}

function PP_normalizeNetSuiteOperatorFallback_(candidate, active) {
  if (!candidate) return 'SIN_OPERADOR';
  const key = PP_normalizeKey_(candidate);
  if (key === 'SIN_OPERADOR' || key === 'SUBCONTRATO') return String(candidate).trim();
  if (!Array.isArray(active)) return String(candidate).trim();
  const activeKeys = {};
  active.forEach(function(name) {
    const normalized = PP_normalizeKey_(name);
    if (normalized) activeKeys[normalized] = true;
  });
  return activeKeys[key] ? String(candidate).trim() : 'SIN_OPERADOR';
}

function PP_resolveNetSuiteOperator_(existing, netSuiteOperator, current) {
  const active = current && current.operators;
  const existingOperator = String(existing || '').trim();
  const preserve = existingOperator && existingOperator !== 'SIN_OPERADOR';
  const preferred = preserve ? existingOperator : (String(netSuiteOperator || '').trim() || 'SIN_OPERADOR');
  return PP_normalizeNetSuiteOperatorFallback_(preferred, active);
}

function PP_mapNetSuiteMaterial_(row, index) {
  const workOrderId = String(PP_pick_(row, ['WO Internal ID', 'workorder_id']) || '').trim();
  const ot = String(PP_pick_(row, ['WO Folio', 'Orden de trabajo', 'workorder_tranid']) || '').trim();
  const componentId = String(PP_pick_(row, ['Componente ID', 'component_id']) || '').trim();
  const component = String(PP_pick_(row, ['Componente', 'Component', 'component']) || componentId).trim();
  return {
    id: 'mat-' + (workOrderId || ot || 'wo') + '-' + (componentId || (index + 1)),
    ot: ot,
    workOrderId: workOrderId,
    assembly: String(PP_pick_(row, ['Ensamble', 'Assembly']) || '').trim(),
    componentId: componentId,
    component: component,
    description: String(PP_pick_(row, ['Descripci\u00f3n', 'Descripcion', 'Description']) || '').trim(),
    unit: String(PP_pick_(row, ['Unidad', 'Unit']) || '').trim(),
    required: Number(PP_pick_(row, ['Requerido', 'Required']) || 0),
    issued: Number(PP_pick_(row, ['Emitido', 'Issued']) || 0),
    pending: Number(PP_pick_(row, ['Pendiente', 'Pending']) || 0)
  };
}

function PP_buildOperationCatalog_(rows) {
  const catalog = {};
  (rows || []).forEach(function(row) {
    const ct = String(PP_pick_(row, ['Centro de trabajo', 'CT', 'workcenter']) || '').trim();
    const label = String(PP_pick_(row, ['Operacion', 'operation']) || '').trim();
    if (!ct || !label) return;
    const key = ct + '::' + PP_normalizeKey_(label);
    if (!catalog[key]) catalog[key] = { key: key, ct: ct, label: label, source: 'NETSUITE', active: true };
  });
  return Object.keys(catalog).sort().map(function(key) { return catalog[key]; });
}

function PP_priorityForOt_(current, ot) {
  const found = (current.operations || []).find(function(op) { return PP_normalizeKey_(op.ot) === PP_normalizeKey_(ot); });
  return found ? Number(found.prioridad || 999) : 999;
}
