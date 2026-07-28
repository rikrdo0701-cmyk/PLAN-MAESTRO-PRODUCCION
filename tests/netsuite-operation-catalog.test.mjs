import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/server/08-netsuite.js", import.meta.url), "utf8");

function load(responses = [], cacheOptions = {}) {
  const requests = [];
  const cacheEntries = new Map(Object.entries(cacheOptions.entries || {}));
  const propertyEntries = new Map(Object.entries(cacheOptions.propertyEntries || {}));
  const cachePuts = [];
  let lockHeld = false;
  let lockAttempts = 0;
  const context = {
    console,
    Date,
    JSON,
    Math,
    Object,
    String,
    Number,
    Array,
    encodeURIComponent,
    Utilities: {
      getUuid: () => "test-uuid",
      computeHmacSha256Signature: () => [1, 2, 3],
      base64Encode: () => "signature",
      formatDate: () => "2026-07-26",
    },
    UrlFetchApp: {
      fetch(url, options) {
        requests.push({ url, options });
        if (cacheOptions.onFetch) cacheOptions.onFetch();
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return {
          getResponseCode: () => response?.status ?? 200,
          getContentText: () => response?.body ?? "{}",
        };
      },
    },
    CacheService: {
      getScriptCache() {
        if (cacheOptions.cacheServiceError) throw cacheOptions.cacheServiceError;
        return {
          get(key) {
            if (cacheOptions.getError) throw cacheOptions.getError;
            return cacheEntries.get(key) || null;
          },
          put(key, value, ttl) {
            cachePuts.push({ key, value, ttl });
            if (cacheOptions.putError) throw cacheOptions.putError;
            cacheEntries.set(key, value);
          },
        };
      },
    },
    PropertiesService: {
      getScriptProperties() {
        if (cacheOptions.propertiesServiceError) throw cacheOptions.propertiesServiceError;
        return {
          getProperty(key) {
            if (cacheOptions.propertyGetError) throw cacheOptions.propertyGetError;
            return propertyEntries.get(key) || null;
          },
          setProperty(key, value) {
            if (cacheOptions.propertySetError) throw cacheOptions.propertySetError;
            propertyEntries.set(key, value);
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        if (cacheOptions.lockServiceError) throw cacheOptions.lockServiceError;
        return {
          tryLock() {
            lockAttempts += 1;
            if (cacheOptions.onTryLock) cacheOptions.onTryLock(cacheEntries);
            if (lockHeld || cacheOptions.lockUnavailable) return false;
            lockHeld = true;
            return true;
          },
          releaseLock() {
            lockHeld = false;
          },
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "08-netsuite.js" });
  context.PP_normalizeKey_ = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return { context, requests, cachePuts, propertyEntries, getLockAttempts: () => lockAttempts };
}

const config = {
  accountId: "ACME_SB1",
  consumerKey: "consumer",
  consumerSecret: "consumer-secret",
  token: "token",
  tokenSecret: "token-secret",
  locationId: 1,
};

const catalogPage = {
  body: JSON.stringify({
    items: [{ work_center: "CT 5467 - Corte", operation_name: "Corte final" }],
    hasMore: false,
  }),
};

test("catálogo maestro reutiliza caché por una hora", () => {
  const { context, requests, cachePuts } = load([catalogPage]);

  const first = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const second = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(second.items)), JSON.parse(JSON.stringify(first.items)));
  assert.equal(cachePuts.length, 1);
  assert.equal(cachePuts[0].key, "NS_OPERATION_CATALOG_V1_ACME_SB1_1");
  assert.equal(cachePuts[0].ttl, 3600);
});

test("caché corrupto provoca una consulta real y se reemplaza", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  const { context, requests, cachePuts } = load([catalogPage], {
    entries: { [key]: "{json-corrupto" },
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(result.warning, "");
  assert.equal(result.items.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(cachePuts.length, 1);
  assert.doesNotThrow(() => JSON.parse(cachePuts[0].value));
});

test("error HTTP conserva el catálogo anterior mediante fallback no destructivo", () => {
  const { context } = load([{ status: 500, body: "falló" }]);
  const previous = [{ key: "1::CORTE", ct: "1", label: "Corte", source: "NETSUITE_MASTER", active: true }];

  const fetched = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const resolved = context.PP_resolveOperationCatalog_(
    { operationCatalog: previous },
    { operationCatalog: fetched.items },
    [],
  );

  assert.match(fetched.warning, /catálogo.*NetSuite/i);
  assert.deepEqual(JSON.parse(JSON.stringify(resolved)), previous);
});

test("errores de lectura o escritura del caché no bloquean un catálogo válido", () => {
  for (const cacheOptions of [
    { getError: new Error("cache get no disponible") },
    { putError: new Error("payload supera límite") },
  ]) {
    const { context, requests } = load([catalogPage], cacheOptions);

    const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

    assert.equal(result.warning, "");
    assert.equal(result.items.length, 1);
    assert.equal(requests.length, 1);
  }
});

test("miss concurrente se serializa y evita una segunda consulta SuiteQL", () => {
  let concurrentResult;
  let loaded;
  let triggered = false;
  loaded = load([catalogPage], {
    onFetch() {
      if (triggered) return;
      triggered = true;
      concurrentResult = loaded.context.PP_fetchNetSuiteOperationCatalogCached_(config);
    },
  });

  const first = loaded.context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(first.items.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(concurrentResult.items)), []);
  assert.match(concurrentResult.warning, /catálogo.*NetSuite/i);
  assert.equal(loaded.requests.length, 1);
  assert.equal(loaded.getLockAttempts(), 2);
});

test("relee el caché dentro del lock antes de consultar SuiteQL", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  const cached = [{ key: "5467::CORTE FINAL", ct: "5467", label: "Corte final", source: "NETSUITE_MASTER", active: true }];
  const { context, requests } = load([catalogPage], {
    onTryLock(entries) {
      entries.set(key, JSON.stringify(cached));
    },
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), cached);
  assert.equal(requests.length, 0);
});

test("error HTTP activa cooldown por una hora y evita reconsultar", () => {
  const { context, requests, propertyEntries } = load([
    { status: 500, body: "falló" },
    catalogPage,
  ]);

  const first = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const second = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(first.items)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(second.items)), []);
  assert.match(first.warning, /catálogo.*NetSuite/i);
  assert.match(second.warning, /catálogo.*NetSuite/i);
  assert.equal(requests.length, 1);
  const marker = propertyEntries.get("NS_OPERATION_CATALOG_ATTEMPT_V1_ACME_SB1_1");
  assert.match(marker, /^\d{13}$/);
  assert.ok(marker.length < 20);
});

test("cooldown aísla intentos por cuenta y ubicación", () => {
  const { context, requests } = load([
    { status: 500, body: "falló" },
    { status: 500, body: "falló" },
    { status: 500, body: "falló" },
  ]);

  context.PP_fetchNetSuiteOperationCatalogCached_(config);
  context.PP_fetchNetSuiteOperationCatalogCached_(config);
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, accountId: "OTHER_SB1" });
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, locationId: 2 });

  assert.equal(requests.length, 3);
});

test("fallo de cache.put activa cooldown sin descartar el primer catálogo válido", () => {
  const { context, requests } = load([catalogPage, catalogPage], {
    putError: new Error("payload supera límite"),
  });

  const first = context.PP_fetchNetSuiteOperationCatalogCached_(config);
  const second = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(first.items.length, 1);
  assert.equal(first.warning, "");
  assert.deepEqual(JSON.parse(JSON.stringify(second.items)), []);
  assert.match(second.warning, /catálogo.*NetSuite/i);
  assert.equal(requests.length, 1);
});

test("fallo al adquirir CacheService no bloquea la consulta ni el resultado", () => {
  const { context, requests } = load([catalogPage], {
    cacheServiceError: new Error("CacheService no disponible"),
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.equal(result.items.length, 1);
  assert.equal(result.warning, "");
  assert.equal(requests.length, 1);
});

test("fallos de lectura o escritura del cooldown aplican fail-closed sin consultar SuiteQL", () => {
  for (const cacheOptions of [
    { propertiesServiceError: new Error("properties no disponible") },
    { propertyGetError: new Error("properties get no disponible") },
    { propertySetError: new Error("properties set no disponible") },
  ]) {
    const { context, requests } = load([catalogPage], cacheOptions);

    const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

    assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
    assert.match(result.warning, /catálogo.*NetSuite/i);
    assert.equal(requests.length, 0);
  }
});

test("fallo de LockService aplica fail-closed sin consultar SuiteQL", () => {
  const { context, requests } = load([catalogPage], {
    lockServiceError: new Error("lock no disponible"),
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
  assert.match(result.warning, /catálogo.*NetSuite/i);
  assert.equal(requests.length, 0);
});

test("hit con esquema, source o key inválidos se descarta y consulta SuiteQL", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  for (const cached of [
    [{ key: "5467::CORTE", ct: "5467", label: "Corte", source: "OTRO", active: true }],
    [{ key: "5467::OTRA", ct: "5467", label: "Corte", source: "NETSUITE_MASTER", active: true }],
    [{ key: "5467::CORTE", ct: "5467", label: "Corte", source: "NETSUITE_MASTER" }],
  ]) {
    const { context, requests } = load([catalogPage], {
      entries: { [key]: JSON.stringify(cached) },
    });

    const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].label, "Corte final");
    assert.equal(requests.length, 1);
  }
});

test("hit válido deduplica y vuelve a excluir operaciones especiales", () => {
  const key = "NS_OPERATION_CATALOG_V1_ACME_SB1_1";
  const corte = { key: "5467::CORTE FINAL", ct: "5467", label: "Corte final", source: "NETSUITE_MASTER", active: true };
  const special = { key: "7000::CROMADO EXTERNO", ct: "7000", label: "Cromado externo", source: "NETSUITE_MASTER", active: true };
  const { context, requests } = load([], {
    entries: { [key]: JSON.stringify([corte, corte, special]) },
  });

  const result = context.PP_fetchNetSuiteOperationCatalogCached_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), [corte]);
  assert.equal(requests.length, 0);
});

test("caché aísla catálogos por cuenta y ubicación", () => {
  const { context, requests, cachePuts } = load([catalogPage, catalogPage, catalogPage]);

  context.PP_fetchNetSuiteOperationCatalogCached_(config);
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, accountId: "OTHER_SB1" });
  context.PP_fetchNetSuiteOperationCatalogCached_({ ...config, locationId: 2 });

  assert.equal(requests.length, 3);
  assert.equal(new Set(cachePuts.map((entry) => entry.key)).size, 3);
});

test("sincronizaciones completa y de planeación usan el catálogo cacheado", () => {
  const { context } = load();
  let cachedCalls = 0;
  let uncachedCalls = 0;
  context.PP_netSuiteConfig_ = () => config;
  context.PP_fetchNetSuiteOperationCatalogCached_ = () => {
    cachedCalls += 1;
    return { items: [{ key: "5467::CORTE", ct: "5467", label: "Corte", source: "NETSUITE_MASTER", active: true }], warning: "" };
  };
  context.PP_fetchNetSuiteOperationCatalog_ = () => {
    uncachedCalls += 1;
    return { items: [], warning: "sin caché" };
  };
  context.PP_fetchRestletPages_ = () => ({ rows: [] });
  context.PP_buildPlantFilter_ = () => ({});
  context.PP_buildPlantFilterFromWorkOrders_ = () => ({});
  context.PP_belongsToPlant_ = () => true;
  context.PP_invoiceAverageWindow_ = () => ({ from: "2026-02-01", to: "2026-07-26" });
  context.PP_fetchInvoiceSalesAverages_ = () => ({ byItem: {}, from: "2026-02-01", to: "2026-07-26", warning: "" });
  context.PP_buildWorkOrderCatalog_ = () => [];
  context.PP_applyInvoiceAverages_ = (items) => items;
  context.PP_enrichWorkOrderPhotos_ = (items) => items;
  context.PP_assertNetSuiteRows_ = () => {};

  context.PP_fetchNetSuitePlantData_();
  context.PP_fetchNetSuitePlanningData_({ workOrders: [{ ot: "OT-1" }] });

  assert.equal(cachedCalls, 2);
  assert.equal(uncachedCalls, 0);
});

test("catálogo maestro pagina SuiteQL, normaliza CT, deduplica y excluye subcontratos", () => {
  const first = {
    items: [
      { work_center: "CT 5467 - Soldadura", operation_name: "Soldadura de piezas" },
      { work_center: "5467 Soldadura", operation_name: "  SOLDADURA DE PIEZAS " },
      { work_center: "CT 7000", operation_name: "Cromádo externo" },
    ],
    hasMore: true,
  };
  const second = {
    items: [
      { work_center: "CT 5527 - Doblez", operation_name: "Doblez final" },
      { work_center: "CT 8000", operation_name: "Sub-contrato Maka" },
    ],
    hasMore: false,
  };
  const { context, requests } = load([
    { body: JSON.stringify(first) },
    { body: JSON.stringify(second) },
  ]);

  const result = context.PP_fetchNetSuiteOperationCatalog_(config);

  assert.equal(result.warning, "");
  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), [
    { key: "5467::SOLDADURA DE PIEZAS", ct: "5467", label: "Soldadura de piezas", source: "NETSUITE_MASTER", active: true },
    { key: "5527::DOBLEZ FINAL", ct: "5527", label: "Doblez final", source: "NETSUITE_MASTER", active: true },
  ]);
  assert.match(requests[0].url, /suiteql\?limit=1000&offset=0$/);
  assert.match(requests[1].url, /suiteql\?limit=1000&offset=1000$/);
  const sql = JSON.parse(requests[0].options.payload).q;
  assert.match(sql, /manufacturingroutingstep/i);
  assert.match(sql, /manufacturingrouting/i);
  assert.match(sql, /entitygroup/i);
  assert.match(sql, /routing\.isinactive/i);
  assert.match(sql, /center\.isinactive/i);
  assert.match(sql, /routing\.id\s+AS\s+routing_id/i);
  assert.match(sql, /step\.operationsequence\s+AS\s+operation_sequence/i);
  assert.match(sql, /step\.id\s+AS\s+step_id/i);
  assert.match(sql, /ORDER BY\s+routing_id,\s*operation_sequence,\s*step_id/i);
});

test("catálogo maestro devuelve aviso breve ante HTTP, JSON o esquema inválido", () => {
  for (const response of [
    { status: 500, body: "falló" },
    { status: 200, body: "no-json" },
    { status: 200, body: JSON.stringify({ items: [{ unexpected: true }], hasMore: false }) },
  ]) {
    const { context } = load([response]);
    const result = context.PP_fetchNetSuiteOperationCatalog_(config);
    assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
    assert.match(result.warning, /catálogo.*NetSuite/i);
    assert.ok(result.warning.length < 180);
  }
});

test("catálogo maestro rechaza hasMore ausente o con tipo distinto de boolean", () => {
  for (const page of [
    { items: [{ work_center: "CT 5467", operation_name: "Corte" }] },
    { items: [{ work_center: "CT 5467", operation_name: "Corte" }], hasMore: "false" },
  ]) {
    const { context } = load([{ body: JSON.stringify(page) }]);
    const result = context.PP_fetchNetSuiteOperationCatalog_(config);
    assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
    assert.match(result.warning, /catálogo.*NetSuite/i);
  }
});

test("catálogo maestro rechaza toda la captura si una fila está parcialmente malformada", () => {
  const { context } = load([{
    body: JSON.stringify({
      items: [
        { work_center: "CT 5467", operation_name: "Corte" },
        { work_center: "CT 5527" },
      ],
      hasMore: false,
    }),
  }]);

  const result = context.PP_fetchNetSuiteOperationCatalog_(config);

  assert.deepEqual(JSON.parse(JSON.stringify(result.items)), []);
  assert.match(result.warning, /catálogo.*NetSuite/i);
});

test("sincronizaciones completa y de planeación conservan el catálogo anterior cuando el maestro falla", () => {
  const { context } = load();
  const previous = [{ key: "1::CORTE", ct: "1", label: "Corte", source: "NETSUITE_MASTER", active: true }];
  const current = { operations: [], workOrders: [], operationCatalog: previous };
  const snapshot = {
    workOrders: [],
    plantOperations: [],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "Catálogo NetSuite no disponible",
  };
  const planning = context.PP_applyNetSuitePlanningData_(
    current,
    { ...snapshot, workOrders: undefined },
  );
  const complete = context.PP_applyNetSuitePlantData_(
    current,
    snapshot,
  );

  assert.deepEqual(JSON.parse(JSON.stringify(planning.operationCatalog)), previous);
  assert.equal(planning.operationCatalogWarning, "Catálogo NetSuite no disponible");
  assert.deepEqual(JSON.parse(JSON.stringify(complete.operationCatalog)), previous);
  assert.equal(complete.operationCatalogWarning, "Catálogo NetSuite no disponible");
});

test("si no existe catálogo previo el fallback conserva operaciones de las OT", () => {
  const { context } = load();
  const merged = context.PP_applyNetSuitePlanningData_(
    { operations: [], operationCatalog: [] },
    {
      plantOperations: [{ "Centro de trabajo": "5467", Operacion: "Corte" }],
      materials: [],
      operationCatalog: [],
      operationCatalogWarning: "Catálogo NetSuite no disponible",
    },
  );

  assert.equal(merged.operationCatalog.length, 1);
});
