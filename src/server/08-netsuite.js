const PP_PLANT_LOCATION_ID = 1;
const PP_PLANT_NAME = 'Planta MM del Llano';

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
  const workOrders = PP_fetchRestletPages_({ script: '1764', deploy: '1' }, { table: 'WO_LISTA', locationId: config.locationId, onlyOpen: true }, config, 10);
  const plantFilter = PP_buildPlantFilter_(workOrders.rows);
  const operationsResponse = PP_fetchRestletPages_({ script: '1762', deploy: '17' }, { locationId: config.locationId, onlyOpen: true }, config, 20);
  const plantOperations = operationsResponse.rows.filter(function(row) { return PP_belongsToPlant_(row, plantFilter); });
  const invoiceWindow = PP_invoiceAverageWindow_(new Date());
  let invoiceAverages = { byItem: {}, from: invoiceWindow.from, to: invoiceWindow.to, warning: '' };
  try {
    invoiceAverages = PP_fetchInvoiceSalesAverages_(config, invoiceWindow);
  } catch (error) {
    invoiceAverages.warning = String(error.message || error);
  }
  const workOrderCatalog = PP_enrichWorkOrderPhotos_(PP_applyInvoiceAverages_(
    PP_buildWorkOrderCatalog_(workOrders.rows, plantOperations), invoiceAverages
  ));
  PP_assertNetSuiteRows_(workOrderCatalog, 'OTs', { restlet: '1764/1', rawRows: workOrders.rows.length });
  PP_assertNetSuiteRows_(plantOperations, 'operaciones', { restlet: '1762/17', workOrders: workOrderCatalog.length });
  const materialsResponse = PP_fetchRestletPages_({ script: '1763', deploy: '14' }, { locationId: config.locationId, onlyOpen: true, maxWOs: 50000 }, config, 20);
  const materials = materialsResponse.rows
    .filter(function(row) { return PP_belongsToPlant_(row, plantFilter); })
    .map(PP_mapNetSuiteMaterial_);

  return {
    workOrders: workOrderCatalog,
    plantOperations: plantOperations,
    materials: materials,
    operationCatalog: PP_buildOperationCatalog_(plantOperations),
    invoicePriceWindow: { from: invoiceAverages.from, to: invoiceAverages.to, warning: invoiceAverages.warning || '' },
    fetchedAt: new Date().toISOString()
  };
}

function PP_fetchNetSuiteWorkOrdersData_() {
  const config = PP_netSuiteConfig_();
  const workOrders = PP_fetchRestletPages_({ script: '1764', deploy: '1' }, { table: 'WO_LISTA', locationId: config.locationId, onlyOpen: true }, config, 10);
  const invoiceWindow = PP_invoiceAverageWindow_(new Date());
  let invoiceAverages = { byItem: {}, from: invoiceWindow.from, to: invoiceWindow.to, warning: '' };
  try {
    invoiceAverages = PP_fetchInvoiceSalesAverages_(config, invoiceWindow);
  } catch (error) {
    invoiceAverages.warning = String(error.message || error);
  }
  const workOrderCatalog = PP_enrichWorkOrderPhotos_(PP_applyInvoiceAverages_(
    PP_buildWorkOrderCatalog_(workOrders.rows, []), invoiceAverages
  ));
  PP_assertNetSuiteRows_(workOrderCatalog, 'OTs', { restlet: '1764/1', rawRows: workOrders.rows.length });
  return {
    workOrders: workOrderCatalog,
    invoicePriceWindow: { from: invoiceAverages.from, to: invoiceAverages.to, warning: invoiceAverages.warning || '' },
    fetchedAt: new Date().toISOString()
  };
}

function PP_fetchNetSuitePlanningData_(current) {
  if (!current || !Array.isArray(current.workOrders) || !current.workOrders.length) {
    return PP_fetchNetSuitePlantData_();
  }
  const config = PP_netSuiteConfig_();
  const plantFilter = PP_buildPlantFilterFromWorkOrders_(current.workOrders);
  const operationsResponse = PP_fetchRestletPages_({ script: '1762', deploy: '17' }, { locationId: config.locationId, onlyOpen: true }, config, 20);
  const plantOperations = operationsResponse.rows.filter(function(row) { return PP_belongsToPlant_(row, plantFilter); });
  PP_assertNetSuiteRows_(plantOperations, 'operaciones', { restlet: '1762/17', workOrders: current.workOrders.length });
  const materialsResponse = PP_fetchRestletPages_({ script: '1763', deploy: '14' }, { locationId: config.locationId, onlyOpen: true, maxWOs: 50000 }, config, 20);
  const materials = materialsResponse.rows
    .filter(function(row) { return PP_belongsToPlant_(row, plantFilter); })
    .map(PP_mapNetSuiteMaterial_);
  return {
    plantOperations: plantOperations,
    materials: materials,
    operationCatalog: PP_buildOperationCatalog_(plantOperations),
    fetchedAt: new Date().toISOString()
  };
}

function PP_assertNetSuiteRows_(rows, label, context) {
  if (Array.isArray(rows) && rows.length > 0) return;
  const detail = context ? ' Detalle: ' + JSON.stringify(context) : '';
  throw new Error('NetSuite devolvio 0 ' + label + ' para Planta MM del Llano. Revisa propiedades NS_*, permisos del deployment, permisos del token y RESTlets 1764/1, 1762/17 y 1763/14.' + detail);
}

function PP_applyNetSuitePlantData_(current, snapshot) {
  const workOrderCatalog = JSON.parse(JSON.stringify(snapshot.workOrders || []));
  const previousWorkOrders = {};
  ((current && current.workOrders) || []).forEach(function(item) {
    previousWorkOrders[PP_normalizeKey_(item.ot)] = item;
  });
  workOrderCatalog.forEach(function(item) {
    const previous = previousWorkOrders[PP_normalizeKey_(item.ot)] || {};
    item.dueDateOverride = String(previous.dueDateOverride || '').trim();
  });
  const plantOperations = snapshot.plantOperations || [];
  const operations = plantOperations
    .filter(PP_isSchedulable_)
    .map(function(row, index) { return PP_mapNetSuiteOperation_(row, index, current); });
  const materials = snapshot.materials || [];

  const merged = JSON.parse(JSON.stringify(current || {}));
  merged.operations = operations;
  merged.workOrders = workOrderCatalog;
  merged.materials = materials;
  merged.operationCatalog = snapshot.operationCatalog || PP_buildOperationCatalog_(plantOperations);
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
    const previous = previousWorkOrders[PP_normalizeKey_(item.ot)] || {};
    item.dueDateOverride = String(previous.dueDateOverride || '').trim();
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
  const operations = plantOperations
    .filter(PP_isSchedulable_)
    .map(function(row, index) { return PP_mapNetSuiteOperation_(row, index, current); });
  const materials = snapshot.materials || [];
  const merged = JSON.parse(JSON.stringify(current || {}));
  merged.operations = operations;
  merged.materials = materials;
  merged.operationCatalog = snapshot.operationCatalog || PP_buildOperationCatalog_(plantOperations);
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

function PP_fetchInvoiceSalesAverages_(config, window) {
  const endpoint = 'https://' + String(config.accountId).toLowerCase() + '.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
  const query = { limit: 1000, offset: 0 };
  const sql = [
    "SELECT tl.item AS item_id, BUILTIN.DF(tl.item) AS item_name,",
    "ABS(SUM(NVL(tl.quantity, 0))) AS billed_quantity,",
    "ABS(SUM(NVL(tl.netamount, 0))) AS net_amount",
    "FROM transaction t",
    "INNER JOIN transactionline tl ON tl.transaction = t.id",
    "WHERE t.type = 'CustInvc'",
    "AND NVL(t.voided, 'F') = 'F'",
    "AND tl.mainline = 'F' AND tl.taxline = 'F' AND tl.iscogs = 'F'",
    "AND tl.item IS NOT NULL",
    "AND t.trandate >= TO_DATE('" + window.from + "', 'YYYY-MM-DD')",
    "AND t.trandate <= TO_DATE('" + window.to + "', 'YYYY-MM-DD')",
    "GROUP BY tl.item, BUILTIN.DF(tl.item)"
  ].join(' ');
  const finalUrl = endpoint + '?limit=1000&offset=0';
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
  if (status < 200 || status >= 300) throw new Error('SuiteQL facturacion: ' + status + ' ' + raw.slice(0, 500));
  const json = JSON.parse(raw || '{}');
  const byItem = {};
  (json.items || []).forEach(function(row) {
    const itemName = String(row.item_name || row.itemName || '').trim();
    const quantity = Math.abs(Number(row.billed_quantity || row.billedQuantity || 0));
    const amount = Math.abs(Number(row.net_amount || row.netAmount || 0));
    if (!itemName || !(quantity > 0) || !(amount > 0)) return;
    byItem[PP_normalizeKey_(itemName)] = amount / quantity;
  });
  return { byItem: byItem, from: window.from, to: window.to, warning: '' };
}

function PP_applyInvoiceAverages_(workOrders, averages) {
  return (workOrders || []).map(function(item) {
    const price = Number((averages.byItem || {})[PP_normalizeKey_(item.item)] || 0);
    item.averageSalePrice = price > 0 ? price : 0;
    item.averageSalePriceFrom = averages.from || '';
    item.averageSalePriceTo = averages.to || '';
    return item;
  });
}

function PP_fetchRestletPages_(query, baseBody, config, maxPages) {
  const rows = [];
  let headers = [];
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const body = Object.assign({}, baseBody, { pageIndex: pageIndex, pageSize: 200 });
    const response = PP_netSuiteRestletRequest_(query, body, config);
    if (!response.ok) throw new Error('NetSuite RESTlet: ' + response.status + ' ' + response.raw.slice(0, 500));
    headers = response.json.headers || headers;
    rows.push.apply(rows, PP_rowsAsObjects_(response.json, headers));
    if (response.json.hasMore !== true) break;
  }
  return { rows: rows, headers: headers };
}

function PP_netSuiteRestletRequest_(query, body, config) {
  const endpoint = 'https://' + String(config.accountId).toLowerCase() + '.restlets.api.netsuite.com/app/site/hosting/restlet.nl';
  const finalUrl = endpoint + '?' + Object.keys(query).map(function(key) { return PP_oauthEncode_(key) + '=' + PP_oauthEncode_(query[key]); }).join('&');
  const response = UrlFetchApp.fetch(finalUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: PP_oauthHeader_('POST', endpoint, query, config) },
    payload: JSON.stringify(body || {}),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  let json;
  try { json = JSON.parse(raw); } catch (error) { json = null; }
  return { ok: status >= 200 && status < 300 && json && json.ok === true, status: status, json: json || {}, raw: raw };
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
  if (status.indexOf('COMPLETE') >= 0 || status.indexOf('COMPLETADO') >= 0 || status.indexOf('CERRADO') >= 0 || status.indexOf('CLOSED') >= 0) return false;
  return status === '' || status.indexOf('NOINICIADO') >= 0 || status.indexOf('NOTSTARTED') >= 0 || status.indexOf('PROGRESS') >= 0 || status.indexOf('PROCESO') >= 0 || status.indexOf('ENCURSO') >= 0 || status.indexOf('LIBERADO') >= 0 || status.indexOf('RELEASED') >= 0 || status.indexOf('PLANIFICAD') >= 0 || status.indexOf('PLANNED') >= 0 || status.indexOf('PROGRAMADO') >= 0 || status.indexOf('SCHEDULED') >= 0;
}

function PP_mapNetSuiteOperation_(row, index, current) {
  const ot = String(PP_pick_(row, ['Orden de trabajo', 'workorder_tranid']) || ('WO-' + (index + 1))).trim();
  const sequence = Number(PP_pick_(row, ['Secuencia', 'sequence']) || 1);
  const ct = String(PP_pick_(row, ['Centro de trabajo', 'CT', 'workcenter']) || 'SIN_CT').trim();
  const existing = (current.operations || []).find(function(op) {
    return PP_normalizeKey_(op.ot) === PP_normalizeKey_(ot) && Number(op.secuencia) === sequence && PP_normalizeKey_(op.ct) === PP_normalizeKey_(ct);
  }) || {};
  const qty = Number(PP_pick_(row, ['Cantidad a procesar', 'Cantidad', 'qty_to_process']) || 0);
  const done = Number(PP_pick_(row, ['Cantidad realizada', 'qty_completed']) || 0);
  const pending = Math.max(0, qty - done) || qty || 1;
  const rateRaw = Number(PP_pick_(row, ['Tasa produccion', 'production_rate']));
  const setupRaw = Number(PP_pick_(row, ['Tiempo preparacion (min)', 'setup_min']));
  const rate = Number.isFinite(rateRaw) ? (rateRaw > 10 ? 0.67 : Math.max(0, rateRaw)) : 0;
  const setup = Number.isFinite(setupRaw) ? (setupRaw > 20 ? 15 : Math.max(0, setupRaw)) : 0;
  const remaining = Number(PP_pick_(row, ['Trabajo restante (min)', 'remaining_min']) || 0);
  const estimated = Number(PP_pick_(row, ['Tiempo estimado (min)', 'est_min']) || 0);
  const priority = PP_priorityForOt_(current, ot);
  const netSuiteOperator = String(PP_pick_(row, ['Recurso humano', 'Operador', 'human_resource']) || '').trim();
  const netSuiteMachine = String(PP_pick_(row, ['Recurso maquina', 'Maquina', 'machine_resource']) || '').trim();
  const operator = existing.operador && existing.operador !== 'SIN_OPERADOR' ? existing.operador : (netSuiteOperator || 'SIN_OPERADOR');
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
    tiempoCiclo: rate,
    tiempoSetup: setup,
    tiempoProd: rate > 0 ? Math.round(rate * pending * 100) / 100 : (remaining || estimated || 0),
    fechaInicio: existing.fechaInicio || '', horaInicio: existing.horaInicio || '', fechaFin: existing.fechaFin || '', horaFin: existing.horaFin || '',
    tipoInsercion: 'OPERACION',
    estatus: String(PP_pick_(row, ['Estado', 'Status', 'status_op']) || 'No iniciado').trim(),
    log: 'NETSUITE_APPS_SCRIPT'
  };
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
