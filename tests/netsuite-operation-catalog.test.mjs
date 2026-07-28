import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/server/08-netsuite.js", import.meta.url), "utf8");

function load(responses = [], cacheOptions = {}) {
  const requests = [];
  const cacheEntries = new Map(Object.entries(cacheOptions.entries || {}));
  const cachePuts = [];
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
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "08-netsuite.js" });
  context.PP_normalizeKey_ = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return { context, requests, cachePuts };
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
