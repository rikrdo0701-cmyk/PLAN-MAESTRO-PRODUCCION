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

test("carga exclusiones normalizadas desde CONFIG y usa lista vacia para estado legacy", () => {
  const stored = [
    " 5527::soldadura soporte ",
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
    excludedCapabilities: [" 5459::dóblado ", "", "5459::DOBLADO"],
  }, "pruebas");
  const config = configObject(fixture.context, fixture.sheets.CONFIG);

  assert.deepEqual(config.EXCLUDED_CAPABILITIES, ["5459::DOBLADO"]);
});

test("el guardado diferido de plan conserva exclusiones en CONFIG", () => {
  const fixture = loadStorage([["revision", "0"]]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};
  vm.runInContext(performanceSource, fixture.context, { filename: "15-performance-service.js" });

  fixture.context.savePlanningStateOptimized({
    revision: 0,
    operations: [],
    excludedCapabilities: [" 5527::soldadura soporte ", "5527::SOLDADURA_SOPORTE"],
  });
  const config = configObject(fixture.context, fixture.sheets.CONFIG);

  assert.deepEqual(config.EXCLUDED_CAPABILITIES, ["5527::SOLDADURA_SOPORTE"]);
});
