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
    getLastColumn: () => Math.max(1, ...rows.map((row) => row.length)),
    getDataRange: () => ({ getDisplayValues: () => rows.map((row) => row.map(String)) }),
    clearContents: () => { rows = []; },
    // insertColumnsAfter(afterColumns, howMany) con afterColumns en base 1: afterColumns = 0
    // significa "antes de la primera columna", que es lo que usa PP_ensureWorkbook_.
    insertColumnsAfter(afterColumns, howMany = 1) {
      rows = rows.map((row) => {
        const copy = [...row];
        for (let k = 0; k < howMany; k += 1) copy.splice(afterColumns, 0, "");
        return copy;
      });
      return this;
    },
    getRange: (row, column, rowCount, columnCount) => ({
      setValues(values) {
        write(row, column, values);
        return this;
      },
      setFontWeight() { return this; },
      setBackground() { return this; },
      getDisplayValues() {
        const out = [];
        for (let r = row - 1; r < row - 1 + rowCount; r += 1) {
          const line = [];
          for (let c = column - 1; c < column - 1 + columnCount; c += 1) {
            line.push(rows[r] && rows[r][c] !== undefined ? String(rows[r][c]) : "");
          }
          out.push(line);
        }
        return out;
      },
      clearContent() {
        rows.splice(row - 1, rowCount == null ? 1 : rowCount);
        return this;
      },
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

test("el guardado de sincronizacion conserva materiales remotos activos y retira solo OTs cerradas", () => {
  const fixture = loadStorage([["revision", "3"]]);
  fixture.sheets.MATERIALES = createSheet(fixture.sheets.MATERIALES.rows()[0], [
    ["mat-active", "OT-ACTIVA", "", "", "COMP-A", "ACTIVO", "", "PZA", 5, 0, 5],
    ["mat-closed", "OT-CERRADA", "", "", "COMP-C", "CERRADO", "", "PZA", 3, 0, 3],
  ]);

  const saved = structuredClone(fixture.context.PP_writeWorkOrderSyncState_(fixture.spreadsheet, {
    revision: 3,
    workOrders: [{ ot: "OT-ACTIVA", item: "ACTIVA" }],
    operations: [{ id: "op-active", ot: "OT-ACTIVA", ct: "CORTE" }],
    materials: [{ ot: "OT-CLIENTE", component: "NO_CONFIAR" }],
    operationPlanStatuses: { active: { ot: "OT-ACTIVA", status: "PENDIENTE" } },
    closedWorkOrderSummaries: { "OT-CERRADA": { ot: "OT-CERRADA", finalStatus: "CERRADA" } },
    removedWorkOrderOts: ["OT-CERRADA"],
  }, "pruebas"));

  const restored = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(saved.revision, 4);
  assert.deepEqual(restored.materials, [{
    id: "mat-active", ot: "OT-ACTIVA", workOrderId: "", assembly: "", componentId: "COMP-A", component: "ACTIVO", description: "", unit: "PZA", required: 5, issued: 0, pending: 5,
  }]);
  assert.deepEqual(restored.workOrders.map((item) => item.ot), ["OT-ACTIVA"]);
  assert.deepEqual(restored.operations.map((item) => item.ot), ["OT-ACTIVA"]);
  assert.deepEqual(restored.closedWorkOrderSummaries, { "OT-CERRADA": { ot: "OT-CERRADA", finalStatus: "CERRADA" } });
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

test("completar concesionado persiste todas las operaciones de la secuencia en una sola llamada", () => {
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
    statuses: [
      {
        key: "1325::2::5461",
        status: "COMPLETADA_PLAN",
        ot: "1325",
        sequence: 2,
        ct: "5461",
      },
      {
        key: "1325::3::0002",
        status: "COMPLETADA_PLAN",
        ot: "1325",
        sequence: 3,
        ct: "0002",
      },
    ],
  }));
  const config = configObject(fixture.context, fixture.sheets.CONFIG);
  const statuses = structuredClone(fixture.context.PP_buildOperationPlanStatuses_(
    fixture.context.PP_readRows_(fixture.sheets.ESTADOS_OPERACION_PLAN)
  ));

  assert.equal(saved.revision, 6);
  assert.equal(config.revision, 6);
  assert.deepEqual(config.selectedOts, ["2001"]);
  assert.equal(statuses["1325::2::5461"].status, "COMPLETADA_PLAN");
  assert.equal(statuses["1325::3::0002"].status, "COMPLETADA_PLAN");
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

test("estados por origen: saveOperationPlanStatus conserva los buckets publicados y escribe el origin", () => {
  const fixture = loadStorage([["revision", "10"]]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};
  vm.runInContext(performanceSource, fixture.context, { filename: "15-performance-service.js" });

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 10,
    operations: [],
    operationPlanStatuses: {
      "kDraft": { key: "kDraft", status: "PENDIENTE", ot: "100" },
    },
    publishedPlanStatuses: {
      "snap-A": {
        "kA": { key: "kA", status: "COMPLETADA_PLAN", ot: "200" },
      },
    },
  }, "pruebas");

  fixture.context.saveOperationPlanStatus({
    revision: 10,
    status: { key: "kDraft", status: "COMPLETADA_PLAN", ot: "100" },
  });

  let state = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(state.operationPlanStatuses["kDraft"].status, "COMPLETADA_PLAN");
  assert.equal(state.operationPlanStatuses["kA"], undefined);
  assert.equal(state.publishedPlanStatuses["snap-A"]["kA"].status, "COMPLETADA_PLAN");

  const headers = fixture.sheets.ESTADOS_OPERACION_PLAN.rows()[0];
  const originIndex = headers.indexOf("ORIGEN");
  assert.ok(originIndex >= 0, "columna ORIGEN existe en ESTADOS_OPERACION_PLAN");
  const rowsByKey = Object.fromEntries(
    fixture.sheets.ESTADOS_OPERACION_PLAN.rows().slice(1)
      .filter((row) => row[0])
      .map((row) => [row[0], row])
  );
  assert.equal(rowsByKey["kA"][originIndex], "snap-A");
  assert.equal(rowsByKey["kDraft"][originIndex], "draft");
});

test("estados por origen: guardar un origin no borra los demas buckets ni el borrador", () => {
  const fixture = loadStorage([["revision", "10"]]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};
  vm.runInContext(performanceSource, fixture.context, { filename: "15-performance-service.js" });

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 10,
    operations: [],
    operationPlanStatuses: {
      "kDraft": { key: "kDraft", status: "COMPLETADA_PLAN", ot: "100" },
    },
    publishedPlanStatuses: {
      "snap-A": { "kA": { key: "kA", status: "COMPLETADA_PLAN", ot: "200" } },
      "snap-B": { "kB": { key: "kB", status: "PENDIENTE", ot: "300" } },
    },
  }, "pruebas");

  fixture.context.saveOperationPlanStatus({
    revision: 10,
    status: { key: "kB", status: "COMPLETADA_PLAN", ot: "300", origin: "snap-B" },
  });

  const state = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(state.operationPlanStatuses["kDraft"].status, "COMPLETADA_PLAN");
  assert.equal(state.publishedPlanStatuses["snap-A"]["kA"].status, "COMPLETADA_PLAN");
  assert.equal(state.publishedPlanStatuses["snap-B"]["kB"].status, "COMPLETADA_PLAN");
  assert.equal(state.publishedPlanStatuses["snap-B"]["kB"].origin, "snap-B");
  assert.equal(state.publishedPlanStatuses["draft"], undefined);
});

test("reabrir todo: PP_clearAllOperationPlanStatuses_ vacia los buckets de estados", () => {
  const fixture = loadStorage([["revision", "10"]]);
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 10,
    operations: [],
    operationPlanStatuses: {
      "kDraft": { key: "kDraft", status: "COMPLETADA_PLAN", ot: "100" },
    },
    publishedPlanStatuses: {
      "snap-A": { "kA": { key: "kA", status: "COMPLETADA_PLAN", ot: "200" } },
    },
  }, "pruebas");

  const result = fixture.context.PP_clearAllOperationPlanStatuses_();
  const state = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(result.clearedRows, 2);
  assert.deepEqual(state.operationPlanStatuses, {});
  assert.deepEqual(state.publishedPlanStatuses, {});
});

test("estados por origen: un guardado completo con bucket draft vacio preserva las filas draft existentes", () => {
  const fixture = loadStorage([["revision", "10"]]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 10,
    operations: [],
    operationPlanStatuses: {
      "kDraft": { key: "kDraft", status: "COMPLETADA_PLAN", ot: "100" },
      "kDraft2": { key: "kDraft2", status: "COMPLETADA_PLAN", ot: "100" },
    },
    publishedPlanStatuses: {
      "snap-A": { "kA": { key: "kA", status: "COMPLETADA_PLAN", ot: "200" } },
    },
  }, "pruebas");

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 11,
    operations: [],
    operationPlanStatuses: {},
    publishedPlanStatuses: {},
  }, "pruebas");

  const state = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(state.operationPlanStatuses["kDraft"].status, "COMPLETADA_PLAN");
  assert.equal(state.operationPlanStatuses["kDraft2"].status, "COMPLETADA_PLAN");
  assert.equal(state.publishedPlanStatuses["snap-A"]["kA"].status, "COMPLETADA_PLAN");
});

test("estados por origen: un guardado completo con bucket draft incompleto conserva las claves existentes no incluidas", () => {
  const fixture = loadStorage([["revision", "10"]]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 10,
    operations: [],
    operationPlanStatuses: {
      "kDraft": { key: "kDraft", status: "COMPLETADA_PLAN", ot: "100" },
      "kDraft2": { key: "kDraft2", status: "PENDIENTE", ot: "100" },
    },
    publishedPlanStatuses: {},
  }, "pruebas");

  fixture.context.PP_writeState_(fixture.spreadsheet, {
    revision: 11,
    operations: [{
      id: "ns-1", key: "ns-1", ot: "100", secuencia: 1, ct: "5458",
      descripcion: "OP", operador: "", maquina: "", estatus: "No iniciado",
    }],
    operationPlanStatuses: {
      "kDraft": { key: "kDraft", status: "COMPLETADA_PLAN", ot: "100", operator: "nuevo" },
    },
    publishedPlanStatuses: {},
  }, "pruebas");

  const state = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.equal(state.operationPlanStatuses["kDraft"].status, "COMPLETADA_PLAN");
  assert.equal(state.operationPlanStatuses["kDraft"].operator, "nuevo");
  assert.equal(state.operationPlanStatuses["kDraft2"].status, "PENDIENTE");
});

test("PP_snapshotOperationFromRow_ recupera toolChange* desde el comentario formateado", () => {
  const fixture = loadStorage();
  const row = {
    COMPLETION_KEY: "chg-1",
    NUM: 1,
    OT: "3588",
    PARTE: "AM 71 VALD",
    OP: "CAMBIO DE HERRAMENTAL / KIT",
    COMENTARIOS: "Cambio de herramental de (SIN HERRAMENTAL --> 5 x 6)",
    HERRAMENTAL: "5 x 6",
    KIT_HERRAMENTAL: "",
  };
  const op = structuredClone(fixture.context.PP_snapshotOperationFromRow_(row, "draft", 0));
  assert.equal(op.tipoInsercion, "CAMBIO_HERRAMENTAL");
  assert.equal(op.comentario, "Cambio de herramental de (SIN HERRAMENTAL --> 5 x 6)");
  assert.equal(op.toolChangeFromHerramental, "");
  assert.equal(op.toolChangeFromKit, "");
  assert.equal(op.toolChangeToHerramental, "5 x 6");
  assert.equal(op.toolChangeToKit, "");

  const transition = structuredClone(fixture.context.PP_snapshotOperationFromRow_({
    ...row,
    COMENTARIOS: "Cambio de herramental de (4 x 5 --> 5 X 8)",
  }, "draft", 1));
  assert.equal(transition.toolChangeFromHerramental, "4 x 5");
  assert.equal(transition.toolChangeToHerramental, "5 X 8");
});

// ---------------------------------------------------------------------------------------------
// RULE-REP-023: agregar una columna EN MEDIO de PP_SHEETS descuadraba la hoja, porque
// PP_ensureWorkbook_ reescribia solo la fila 1 del encabezado y dejaba los datos donde
// estaban. Al meter PRECIO_REF_VENTA antes de ACTUALIZADO en CONFIGURACION_ARTICULO
// (2.45.0), el ACTUALIZADO viejo paso a leerse como PRECIO_REF_VENTA. Medido con
// DESALINEA_ARTICULO el 2026-09-26: 230 de 230 filas con fecha en la columna E, 0 de 230
// con fecha en la F.
// ---------------------------------------------------------------------------------------------

test("PP_headerInserts_ dice donde insertar cuando PP_SHEETS gana una columna en medio", () => {
  const { context } = loadStorage();
  const calcula = (current, headers) =>
    JSON.parse(vm.runInContext(
      `JSON.stringify(PP_headerInserts_(${JSON.stringify(current)}, ${JSON.stringify(headers)}))`,
      context,
    ));

  // El caso que rompió produccion: PRECIO_REF_VENTA entra antes de ACTUALIZADO.
  assert.deepEqual(
    calcula(
      ["ARTICULO", "TIPO_OT", "TIPO_TRABAJO", "PRECIO_MANUAL", "ACTUALIZADO"],
      ["ARTICULO", "TIPO_OT", "TIPO_TRABAJO", "PRECIO_MANUAL", "PRECIO_REF_VENTA", "ACTUALIZADO"],
    ),
    [4],
    "hay 4 columnas viejas antes de la nueva",
  );

  // Columna nueva al final: no hace falta mover nada.
  assert.deepEqual(calcula(["A", "B"], ["A", "B", "C"]), [2]);

  // Dos columnas nuevas, una en medio y otra al final.
  assert.deepEqual(calcula(["A", "B", "C"], ["A", "NUEVA1", "B", "C", "NUEVA2"]), [1, 3]);

  // Columna nueva al principio: insertColumnsAfter(0, 1), o sea antes de la primera.
  assert.deepEqual(calcula(["A", "B"], ["NUEVA", "A", "B"]), [0]);

  // Sin cambios.
  assert.deepEqual(calcula(["A", "B"], ["A", "B"]), []);

  // UNA COLUMNA VIEJA DESAPARECE: no se opera. Una poda equivocada en este codigo, que corre
  // en cada request, destruye datos de forma irreversible.
  assert.equal(calcula(["A", "B", "VIEJA"], ["A", "B"]), null);
  assert.equal(calcula(["A", "B", "C"], ["A", "C", "B"]), null, "orden distinto: no se opera");

  // Mas de tres columnas nuevas no es un alta simple: no se opera.
  assert.equal(calcula(["A"], ["A", "N1", "N2", "N3", "N4"]), null);
});

test("PP_ensureWorkbook_ inserta la columna y el dato conserva su encabezado", () => {
  const { context, sheets } = loadStorage();
  // Se simula la hoja como quedo con el bug: el encabezado nuevo ya esta puesto (fila 1
  // reescrita) pero las filas de datos siguen con el ACTUALIZADO viejo en la columna E.
  const datos = [
    ["M66-8602", "OEM", "NORMAL", 1414.3, "2026-09-25T17:45:00.000Z"],
    ["COMP-4434", "COMPONENTE", "NORMAL", 1, "2026-09-18T12:00:00.000Z"],
  ];
  const hoja = createSheet(
    ["ARTICULO", "TIPO_OT", "TIPO_TRABAJO", "PRECIO_MANUAL", "PRECIO_REF_VENTA", "ACTUALIZADO"],
    datos,
  );
  const libro = { getSheetByName: (name) => (name === "CONFIGURACION_ARTICULO" ? hoja : sheets[name]) };
  // El encabezado ya coincide con PP_SHEETS, asi que no se toca nada: la hoja se arregla con
  // el shim de lectura y con el proximo PP_writeTable_, no con una poda en caliente.
  context.PP_ensureWorkbook_(libro);
  assert.deepEqual(hoja.rows()[0], [
    "ARTICULO", "TIPO_OT", "TIPO_TRABAJO", "PRECIO_MANUAL", "PRECIO_REF_VENTA", "ACTUALIZADO",
  ]);
  assert.equal(hoja.rows()[1][4], "2026-09-25T17:45:00.000Z", "no se toco el dato");

  // Ahora el caso de una hoja con el encabezado VIEJO de 5 columnas: ahi si hay que insertar,
  // y el dato tiene que quedar debajo de su propio encabezado.
  const vieja = createSheet(
    ["ARTICULO", "TIPO_OT", "TIPO_TRABAJO", "PRECIO_MANUAL", "ACTUALIZADO"],
    [["M66-8602", "OEM", "NORMAL", 1414.3, "2026-09-25T17:45:00.000Z"]],
  );
  const libro2 = { getSheetByName: (name) => (name === "CONFIGURACION_ARTICULO" ? vieja : sheets[name]) };
  context.PP_ensureWorkbook_(libro2);
  const despues = vieja.rows();
  assert.deepEqual(despues[0], [
    "ARTICULO", "TIPO_OT", "TIPO_TRABAJO", "PRECIO_MANUAL", "PRECIO_REF_VENTA", "ACTUALIZADO",
  ]);
  assert.equal(despues[1][4], "", "la columna nueva queda vacia");
  assert.equal(despues[1][5], "2026-09-25T17:45:00.000Z", "el ACTUALIZADO viejo quedo en SU columna");
  assert.equal(despues[1][3], 1414.3, "PRECIO_MANUAL no se movio");
});

test("PP_articlePriceCells_ recupera la fecha corrida y no toca una hoja bien alineada", () => {
  const { context } = loadStorage();
  const lee = (row) => structuredClone(context.PP_articlePriceCells_(row));

  // El mundo roto: la celda de PRECIO_REF_VENTA es en realidad el ACTUALIZADO viejo.
  const corrida = lee({ PRECIO_REF_VENTA: "2026-09-07T03:11:36.013Z", ACTUALIZADO: "" });
  assert.equal(corrida.referenceSalePrice, 0, "una fecha no es un precio");
  assert.equal(corrida.updatedAt, "2026-09-07T03:11:36.013Z", "la fecha se recupera");

  // El mundo bien: PRECIO_REF_VENTA es un numero y ACTUALIZADO trae su fecha.
  const buena = lee({ PRECIO_REF_VENTA: 1414.3, ACTUALIZADO: "2026-09-25T17:45:00.000Z" });
  assert.equal(buena.referenceSalePrice, 1414.3);
  assert.equal(buena.updatedAt, "2026-09-25T17:45:00.000Z");

  // El shim NO puede robar una fecha cuando ACTUALIZADO ya tiene una: manda el ACTUALIZADO.
  const conAmbas = lee({ PRECIO_REF_VENTA: "2026-09-07T03:11:36.013Z", ACTUALIZADO: "2026-09-25T17:45:00.000Z" });
  assert.equal(conAmbas.updatedAt, "2026-09-25T17:45:00.000Z");
  assert.equal(conAmbas.referenceSalePrice, 0, "una fecha nunca es un precio");

  // Casos borde: vacio, no numerico y numeros como texto.
  assert.equal(lee({ PRECIO_REF_VENTA: "", ACTUALIZADO: "" }).updatedAt, "");
  assert.equal(lee({ PRECIO_REF_VENTA: "", ACTUALIZADO: "" }).referenceSalePrice, 0);
  assert.equal(lee({ PRECIO_REF_VENTA: "no es numero", ACTUALIZADO: "" }).referenceSalePrice, 0,
    "texto que no es fecha no se vuelve NaN");
  assert.equal(lee({ PRECIO_REF_VENTA: "1414.30", ACTUALIZADO: "" }).referenceSalePrice, 1414.3,
    "un numero escrito como texto SI es precio");
  assert.equal(lee({}).referenceSalePrice, 0);
  assert.equal(lee({}).updatedAt, "");
});

test("PP_buildArticleConfigurations_ lee la fila corrida sin perder el precio manual", () => {
  const { context } = loadStorage();
  // Las filas tal como quedaron en la hoja: PRECIO_REF_VENTA con la fecha corrida y
  // ACTUALIZADO vacio. Este es el caso que hacia que la app mostrara 0 de 153.
  const filas = [
    { ARTICULO: "M66-8602", TIPO_OT: "OEM", TIPO_TRABAJO: "NORMAL", PRECIO_MANUAL: "1414.3", PRECIO_REF_VENTA: "2026-09-25T17:45:00.000Z", ACTUALIZADO: "" },
    { ARTICULO: "COMP-4434", TIPO_OT: "COMPONENTE", TIPO_TRABAJO: "NORMAL", PRECIO_MANUAL: "1", PRECIO_REF_VENTA: "2026-09-18T12:00:00.000Z", ACTUALIZADO: "" },
  ];
  const configs = structuredClone(context.PP_buildArticleConfigurations_(filas, [], [], []));
  assert.equal(Object.keys(configs).length, 2);
  assert.equal(configs["M66-8602"].manualUnitPrice, 1414.3, "el precio manual NO se pierde");
  assert.equal(configs["M66-8602"].referenceSalePrice, 0);
  assert.equal(configs["M66-8602"].updatedAt, "2026-09-25T17:45:00.000Z", "la fecha se recupera");
  assert.equal(configs["COMP-4434"].manualUnitPrice, 1);
  assert.equal(configs["COMP-4434"].updatedAt, "2026-09-18T12:00:00.000Z");

  // Y con la hoja ya bien alineada, el shim no se activa.
  const alineadas = [
    { ARTICULO: "TR 350", TIPO_OT: "LINEA", TIPO_TRABAJO: "NORMAL", PRECIO_MANUAL: "369", PRECIO_REF_VENTA: "369", ACTUALIZADO: "2026-09-25T17:45:00.000Z" },
  ];
  const ok = structuredClone(context.PP_buildArticleConfigurations_(alineadas, [], [], []));
  assert.equal(ok["TR 350"].referenceSalePrice, 369, "una hoja bien alineada lee su precio");
  assert.equal(ok["TR 350"].updatedAt, "2026-09-25T17:45:00.000Z");
});

test("el shim y la hoja convergen: lo que se lee se vuelve a escribir alineado", () => {
  const { context } = loadStorage();
  // El ciclo completo: leer la fila corrida, y escribirla de vuelta con
  // PP_articleConfigurationRows_. La fila que sale tiene que tener PRECIO_REF_VENTA numerico
  // y ACTUALIZADO con la fecha, o sea alineada de verdad. Asi el proximo guardado no vuelve
  // a descuadrar nada.
  const corrida = { ARTICULO: "M66-8602", TIPO_OT: "OEM", TIPO_TRABAJO: "NORMAL", PRECIO_MANUAL: "1414.3", PRECIO_REF_VENTA: "2026-09-25T17:45:00.000Z", ACTUALIZADO: "" };
  const configs = structuredClone(context.PP_buildArticleConfigurations_([corrida], [], [], []));
  const written = context.PP_articleConfigurationRows_({ articleConfigurations: configs });
  assert.ok(Array.isArray(written), "PP_articleConfigurationRows_ devuelve filas");
  assert.equal(written.length, 1);
  const fila = JSON.parse(JSON.stringify(written[0]));
  assert.equal(fila[0], "M66-8602");
  assert.equal(fila[3], 1414.3, "PRECIO_MANUAL intacto");
  assert.equal(fila[4], 0, "PRECIO_REF_VENTA es un numero, no una fecha");
  assert.equal(fila[5], "2026-09-25T17:45:00.000Z", "ACTUALIZADO quedo con la fecha recuperada");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(String(fila[4])), "la fecha no puede quedar en la columna del precio");
});