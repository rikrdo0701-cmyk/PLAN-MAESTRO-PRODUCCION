import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");
const performanceSource = await readFile(new URL("../src/server/15-performance-service.js", import.meta.url), "utf8");

function createSheet(headers = ["KEY"], body = []) {
  let rows = [headers, ...body].map((row) => [...row]);
  const write = (startRow, startColumn, values) => {
    values.forEach((valueRow, rowOffset) => {
      const targetRow = startRow - 1 + rowOffset;
      if (!rows[targetRow]) rows[targetRow] = [];
      valueRow.forEach((value, columnOffset) => {
        rows[targetRow][startColumn - 1 + columnOffset] = value;
      });
    });
  };
  return {
    rows: () => rows.map((row) => [...row]),
    getLastRow: () => rows.length,
    getDataRange: () => ({ getDisplayValues: () => rows.map((row) => row.map(String)) }),
    clearContents: () => { rows = []; },
    getRange: (row, column) => ({
      setValues(values) {
        write(row, column, values);
        return this;
      },
      setFontWeight() { return this; },
      setBackground() { return this; },
    }),
    setFrozenRows: () => {},
    appendRow: (row) => rows.push([...row]),
  };
}

function loadStorage(configRows = []) {
  const context = {
    Date,
    PP_SCHEMA_VERSION: 1,
    PP_APP_VERSION: "test",
    SpreadsheetApp: { flush: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "02-storage.js" });
  const headers = JSON.parse(vm.runInContext("JSON.stringify(PP_SHEETS)", context));
  const sheets = Object.fromEntries(
    Object.entries(headers).map(([name, columns]) => [name, createSheet(columns)])
  );
  sheets.CONFIG = createSheet(headers.CONFIG, configRows);
  const spreadsheet = { getSheetByName: (name) => sheets[name] };
  return { context, sheets, spreadsheet };
}

function configObject(context, sheet) {
  return structuredClone(context.PP_readConfig_(sheet));
}

test("persiste tiempoFallback y trata filas antiguas como no fallback", () => {
  const fixture = loadStorage();
  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 0,
    operations: [{ id: "fallback-1", ot: "100", ct: "CORTE", tiempoProd: 1 / 60, tiempoFallback: true }],
  }, "pruebas", true);

  const restored = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(restored.operations[0].tiempoFallback, true);

  const legacyHeaders = fixture.sheets.OPERACIONES.rows()[0].filter((header) => header !== "TIEMPO_FALLBACK");
  fixture.sheets.OPERACIONES = createSheet(legacyHeaders, [
    legacyHeaders.map((header) => header === "ID" ? "legacy-1" : ""),
  ]);
  const legacy = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(legacy.operations[0].tiempoFallback, false);
});

test("persiste los resumenes de OTs cerradas mediante CONFIG", () => {
  const fixture = loadStorage();
  const summaries = {
    "OT-100": {
      ot: "OT-100",
      item: "ART-100",
      quantity: 8,
      scheduledStart: "2026-08-01T08:00:00.000Z",
      scheduledEnd: "2026-08-01T12:00:00.000Z",
      weekStart: "2026-07-27",
      finalStatus: "CERRADA",
      closedDetectedAt: "2026-08-01T12:00:00.000Z",
    },
  };

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 0,
    closedWorkOrderSummaries: summaries,
  }, "pruebas", true);

  const restored = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.deepEqual(restored.closedWorkOrderSummaries, summaries);
});

test("usa un objeto vacio para resumenes de OTs cerradas en CONFIG legacy", () => {
  const fixture = loadStorage();
  const restored = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));

  assert.deepEqual(restored.closedWorkOrderSummaries, {});
});

test("carga exclusiones normalizadas desde CONFIG y usa lista vacia para estado legacy", () => {
  const stored = [
    "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL",
    " 5527::soldadura soporte ",
    "5527 :: soldadura soporte",
    "",
    "5527::SOLDADURA_SOPORTE",
    "5459::dóblado",
  ];
  const current = loadStorage([
    ["revision", "0"],
    ["EXCLUDED_CAPABILITIES", JSON.stringify(stored)],
  ]);
  const legacy = loadStorage([["revision", "0"]]);

  const currentState = structuredClone(current.context.PP_readState_(current.spreadsheet));
  const legacyState = structuredClone(legacy.context.PP_readState_(legacy.spreadsheet));

  assert.deepEqual(currentState.excludedCapabilities, [
    "5527::SOLDADURA_SOPORTE",
    "5459::DOBLADO",
  ]);
  assert.deepEqual(legacyState.excludedCapabilities, []);
});

test("el guardado completo conserva exclusiones normalizadas y no persiste matrixSearch", () => {
  const fixture = loadStorage([["revision", "0"]]);

  const saved = structuredClone(fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 0,
    operations: [],
    excludedCapabilities: [
      "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL",
      " 5527::soldadura soporte ",
      "5527::SOLDADURA_SOPORTE",
      "",
    ],
    matrixSearch: "soldadura",
  }, "pruebas", true));
  const config = configObject(fixture.context, fixture.sheets.CONFIG);

  assert.deepEqual(saved.excludedCapabilities, ["5527::SOLDADURA_SOPORTE"]);
  assert.deepEqual(config.EXCLUDED_CAPABILITIES, ["5527::SOLDADURA_SOPORTE"]);
  assert.equal(config.matrixSearch, undefined);
});

test("el guardado parcial de matriz conserva exclusiones en CONFIG", () => {
  const fixture = loadStorage([["revision", "0"]]);

  fixture.context.PP_writeSkillState_(fixture.spreadsheet, {
    excludedCapabilities: [
      "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL",
      " 5459::dóblado ",
      "",
      "5459::DOBLADO",
    ],
  }, "pruebas");
  const config = configObject(fixture.context, fixture.sheets.CONFIG);

  assert.deepEqual(config.EXCLUDED_CAPABILITIES, ["5459::DOBLADO"]);
});

test("un guardado parcial obsoleto no borra exclusiones de otra revision", () => {
  const fixture = loadStorage([
    ["revision", "2"],
    ["EXCLUDED_CAPABILITIES", JSON.stringify(["5527::SOLDADURA"])],
  ]);
  fixture.sheets.MATRIZ = createSheet(
    ["CAPACIDAD_KEY", "OPERADOR", "HABILITADO"],
    [["5527::SOLDADURA", "ANA", true]]
  );

  assert.throws(
    () => fixture.context.PP_writeSkillState_(fixture.spreadsheet, {
      revision: 1,
      excludedCapabilities: [],
      matrix: { "5459::DOBLADO": ["BOB"] },
    }, "cliente-obsoleto"),
    /CONFLICT_REVISION/
  );
  const config = configObject(fixture.context, fixture.sheets.CONFIG);

  assert.equal(config.revision, 2);
  assert.deepEqual(config.EXCLUDED_CAPABILITIES, ["5527::SOLDADURA"]);
  assert.deepEqual(fixture.sheets.MATRIZ.rows(), [
    ["CAPACIDAD_KEY", "OPERADOR", "HABILITADO"],
    ["5527::SOLDADURA", "ANA", true],
  ]);
});

test("el guardado optimizado de plan no sobrescribe exclusiones de la matriz", () => {
  const fixture = loadStorage([
    ["revision", "0"],
    ["EXCLUDED_CAPABILITIES", JSON.stringify(["5527::SOLDADURA"])],
  ]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};
  vm.runInContext(performanceSource, fixture.context, { filename: "15-performance-service.js" });

  fixture.context.savePlanningStateOptimized({
    revision: 0,
    operations: [],
    excludedCapabilities: [],
  });
  const config = configObject(fixture.context, fixture.sheets.CONFIG);

  assert.deepEqual(config.EXCLUDED_CAPABILITIES, ["5527::SOLDADURA"]);
});

test("completar una operacion actualiza solo su estado sobre la revision vigente", () => {
  const fixture = loadStorage([
    ["revision", "5"],
    ["selectedOts", JSON.stringify(["2001"])],
  ]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};
  vm.runInContext(performanceSource, fixture.context, { filename: "15-performance-service.js" });

  const saved = structuredClone(fixture.context.saveOperationPlanStatus({
    revision: 3,
    status: {
      key: "1325::2::5461",
      status: "COMPLETADA_PLAN",
      ot: "1325",
      sequence: 2,
      ct: "5461",
    },
  }));
  const config = configObject(fixture.context, fixture.sheets.CONFIG);
  const statuses = structuredClone(fixture.context.PP_buildOperationPlanStatuses_(
    fixture.context.PP_readRows_(fixture.sheets.ESTADOS_OPERACION_PLAN)
  ));

  assert.equal(saved.revision, 6);
  assert.equal(config.revision, 6);
  assert.deepEqual(config.selectedOts, ["2001"]);
  assert.equal(statuses["1325::2::5461"].status, "COMPLETADA_PLAN");
  assert.equal(fixture.sheets.OPERACIONES.rows().length, 1);
  assert.equal(fixture.sheets.ORDENES_TRABAJO.rows().length, 1);
});

test("dos clientes concurrentes no permiten que el optimizado obsoleto borre exclusiones", () => {
  const fixture = loadStorage([
    ["revision", "1"],
    ["EXCLUDED_CAPABILITIES", "[]"],
  ]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};
  vm.runInContext(performanceSource, fixture.context, { filename: "15-performance-service.js" });

  fixture.context.PP_writeSkillState_(fixture.spreadsheet, {
    revision: 1,
    excludedCapabilities: ["5527::SOLDADURA"],
  }, "cliente-a");
  assert.throws(
    () => fixture.context.savePlanningStateOptimized({
      revision: 1,
      operations: [],
      excludedCapabilities: [],
    }),
    /CONFLICT_REVISION/
  );
  const config = configObject(fixture.context, fixture.sheets.CONFIG);

  assert.equal(config.revision, 2);
  assert.deepEqual(config.EXCLUDED_CAPABILITIES, ["5527::SOLDADURA"]);
});

test("la sincronizacion persiste y devuelve la advertencia del catalogo maestro", () => {
  const fixture = loadStorage([["revision", "0"]]);

  fixture.context.PP_writeNetSuiteSyncState_(fixture.spreadsheet, {
    operations: [],
    workOrders: [],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "Catalogo NetSuite no disponible",
  }, "pruebas");

  const config = configObject(fixture.context, fixture.sheets.CONFIG);
  const state = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));

  assert.equal(config.operationCatalogWarning, "Catalogo NetSuite no disponible");
  assert.equal(state.operationCatalogWarning, "Catalogo NetSuite no disponible");
});
