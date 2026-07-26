import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/server/08-netsuite.js", import.meta.url), "utf8");

function load(responses = []) {
  const requests = [];
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
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "08-netsuite.js" });
  context.PP_normalizeKey_ = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  return { context, requests };
}

const config = {
  accountId: "ACME_SB1",
  consumerKey: "consumer",
  consumerSecret: "consumer-secret",
  token: "token",
  tokenSecret: "token-secret",
};

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
