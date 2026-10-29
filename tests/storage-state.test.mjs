import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");
const performanceSource = await readFile(new URL("../src/server/15-performance-service.js", import.meta.url), "utf8");
// El espejo de catalogos a Supabase vive en su propio archivo de servidor y lo
// llaman PP_writeState_, PP_writeSkillState_ y PP_writeNetSuiteSyncState_. En
// Apps Script todos los archivos comparten globales, asi que aqui se carga
// tambien: si no, los guardados del test revientan con "is not defined".
const catalogoSource = await readFile(new URL("../src/server/16-supabase-catalogo.js", import.meta.url), "utf8");

function createSheet(headers = ["KEY"], body = []) {
  let rows = [headers, ...body].map((row) => [...row]);
  const write = (startRow, startColumn, values) => {
    values.forEach((valueRow, rowOffset) => {
      const targetRow = startRow - 1 + rowOffset;
      if (!rows[targetRow]) rows[targetRow] = [];
      valueRow.forEach((value, columnOffset) => {
        // setValues con undefined deja la celda VACIA en Sheets, no con la palabra
        // "undefined". Sin esta conversion el mock miente: PP_writeConfigPatch_ serializa
        // claves sin valor con JSON.stringify(undefined) === undefined, y al releerlas el
        // mock devolvia la palabra "undefined", de donde Number(...) salia NaN y revision
        // quedaba en NaN en vez de 0.
        rows[targetRow][startColumn - 1 + columnOffset] = value === undefined ? "" : value;
      });
    });
  };
  return {
    rows: () => rows.map((row) => [...row]),
    getLastRow: () => rows.length,
    getLastColumn: () => Math.max(1, ...rows.map((row) => row.length)),
    getDataRange: () => ({
      getDisplayValues: () => rows.map((row) => row.map(String)),
      getValues: () => rows.map((row) => row.map(String)),
    }),
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
      setValue(value) {
        write(row, column, [[value]]);
        return this;
      },
      setFontWeight() { return this; },
      setBackground() { return this; },
      getValues() {
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
    Session: { getScriptTimeZone: () => "America/Mexico_City", getActiveUser: () => ({ getEmail: () => "pruebas" }) },
    Utilities: { formatDate: (date, tz, fmt) => String(date) },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "02-storage.js" });
  vm.runInContext(catalogoSource, context, { filename: "16-supabase-catalogo.js" });
  const headers = JSON.parse(vm.runInContext("JSON.stringify(PP_SHEETS)", context));
  const sheets = Object.fromEntries(
    Object.entries(headers).map(([name, columns]) => [name, createSheet(columns)])
  );
  sheets.CONFIG = createSheet(headers.CONFIG, configRows);
  const spreadsheet = {
    getSheetByName: (name) => sheets[name],
    insertSheet: (name) => { sheets[name] = createSheet([]); return sheets[name]; },
  };
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
  // El test cambia la hoja por detras de la cache, cosa que en produccion no puede pasar:
  // toda escritura pasa por un writer que sube CONFIG.revision y con eso invalida la cache.
  // Se hace lo mismo aqui para que la lectura sea la de una hoja nueva de verdad.
  fixture.context.PP_invalidateStateCache_(fixture.spreadsheet);
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

test("el writer de la sync ligera SELLA la cache: el siguiente getAppState no reconstruye", () => {
  // ANTES: PP_writeWorkOrderSyncState_ (el boton "Sincronizar OTs") subia CONFIG.revision sin
  // tocar PP_STATE_CACHE_REVISION, asi que el siguiente getAppState reconstruia entero. Medido en
  // produccion el 2026-09-27: cacheRevision 4101 contra revision 4103, y getAppState agotando
  // los 120 s cuatro veces, con la pagina cayendo a sampleState.
  const fixture = loadStorage([["revision", "3"]]);
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};

  // La cache tiene que EXISTIR: el parche no la crea, y si no hay no inventa nada (devuelve false
  // y el siguiente getAppState reconstruye, igual que antes). En produccion la cache existe de un
  // getAppState anterior; aqui se crea con uno.
  fixture.context.PP_readState_(fixture.spreadsheet);
  assert.ok(fixture.sheets[fixture.context.PP_STATE_CACHE_SHEET_], "la cache existe antes del writer");

  const saved = structuredClone(fixture.context.PP_writeWorkOrderSyncState_(fixture.spreadsheet, {
    revision: 3,
    workOrders: [{ ot: "OT-ACTIVA", item: "ACTIVA" }],
    operations: [{ id: "op-active", ot: "OT-ACTIVA", ct: "CORTE", tiempoProd: 5 }],
    operationPlanStatuses: { active: { ot: "OT-ACTIVA", status: "PENDIENTE" } },
    closedWorkOrderSummaries: {},
    removedWorkOrderOts: [],
  }, "pruebas"));

  const config = configObject(fixture.context, fixture.sheets.CONFIG);
  assert.equal(saved.revision, 4);
  assert.equal(Number(config.PP_STATE_CACHE_REVISION), 4, "la cache queda sellada con la revision nueva");

  // Y SIRVE, que es lo que importa: se sabotea OPERACIONES y la lectura sigue respondiendo. Si la
  // cache no estuviera sellada, PP_readState_ reconstruiria y la lectura de OPERACIONES daria la
  // hoja saboteada.
  fixture.sheets.OPERACIONES = createSheet(fixture.sheets.OPERACIONES.rows()[0], [["SABOTAJE"]]);
  const restored = structuredClone(fixture.context.PP_readState_(fixture.spreadsheet));
  assert.deepEqual(restored.operations.map((item) => item.ot), ["OT-ACTIVA"], "sirve la cache, no reconstruye");
  assert.equal(restored.revision, 4);
});

test("readTest distingue 'desfasada' de 'corrupta': antes las dos decian 'null'", () => {
  // debugStateCacheInfo reportaba {hit:false, reason:'null'} tanto si PP_STATE_CACHE_REVISION no
  // coincidia con CONFIG.revision (lo normal, lo que pasa despues de cualquier guardado) como si
  // el JSON de la cache estaba roto (un fallo de verdad). Son dos problemas distintos con dos
  // arreglos distintos, y no habia forma de saber cual de los dos era.
  const fixture = loadStorage([["revision", "3"]]);
  fixture.context.Session = { getActiveUser: () => ({ getEmail: () => "pruebas" }) };
  fixture.context.PP_acquireScriptLock_ = () => ({ releaseLock: () => {} });
  fixture.context.PP_getWorkbook_ = () => fixture.spreadsheet;
  fixture.context.PP_ensureWorkbook_ = () => {};
  vm.runInContext(performanceSource, fixture.context, { filename: "15-performance-service.js" });

  const nombre = fixture.context.PP_STATE_CACHE_SHEET_;
  const conCache = (cacheRows) => {
    const sheet = createSheet(["CHUNK"], cacheRows);
    const original = fixture.spreadsheet.getSheetByName;
    fixture.spreadsheet.getSheetByName = (n) => (n === nombre ? sheet : original(n));
    return fixture.context.debugStateCacheInfo();
  };

  // Desfasada: la revision de la cache no es la de CONFIG.
  const desfasada = conCache([["{}"]]);
  assert.equal(desfasada.readTest.hit, false);
  assert.equal(desfasada.readTest.reason, "revision_desfasada");
  assert.notEqual(desfasada.readTest.reason, "null", "ya no puede decir 'null' para todo");

  // Corrupta: la revision SI coincide, pero el JSON no se puede parsear.
  fixture.context.PP_writeConfigPatch_(fixture.spreadsheet, { PP_STATE_CACHE_REVISION: 3 });
  const corrupta = conCache([["{esto no es json"]]);
  assert.equal(corrupta.readTest.hit, false);
  assert.equal(corrupta.readTest.reason, "cache_ilegible");
  assert.match(corrupta.readTest.detail || "", /JSON/, "y el detalle si dice que fue el JSON: " + corrupta.readTest.detail);

  // Sin cache: la hoja no existe o esta vacia.
  const sinCache = conCache([]);
  assert.equal(sinCache.readTest.hit, false);
  assert.equal(sinCache.readTest.reason, "sin_cache");

  // Y sana: coincide y parsea.
  const sana = conCache([[JSON.stringify({ operations: [{ id: "a" }, { id: "b" }] })]]);
  assert.equal(sana.readTest.hit, true, "con la revision bien y el JSON bueno, hay acierto");
});

test("PP_writeCachedState_ recorta las filas que sobran y no deja la cache a medias", () => {
  // Antes hacia clearContents() y despues escribia los chunks: cualquier interrupcion dejaba la
  // cache vacia o a medias, y como PP_readCachedStateRaw_ se traga el error en un catch mudo no se
  // podia diagnosticar. Ahora se escriben los chunks, se recortan las filas que sobran y solo al
  // final se sella la revision.
  const fixture = loadStorage([["revision", "0"]]);
  fixture.context.PP_writeConfigPatch_(fixture.spreadsheet, { PP_STATE_CACHE_REVISION: 0 });
  const nombre = fixture.context.PP_STATE_CACHE_SHEET_;

  fixture.context.PP_writeCachedState_(fixture.spreadsheet, 0, {
    operations: Array.from({ length: 400 }, (_, i) => ({ id: "op-" + i, nota: "x".repeat(200) })),
  });
  const filasLargas = fixture.spreadsheet.getSheetByName(nombre).rows().length;
  assert.ok(filasLargas > 2, "la cache larga ocupa varias filas: " + filasLargas);

  fixture.context.PP_writeCachedState_(fixture.spreadsheet, 0, { operations: [{ id: "unica" }] });
  const sheet = fixture.spreadsheet.getSheetByName(nombre);
  assert.ok(sheet.rows().length < filasLargas, "las filas viejas se recortan: " + filasLargas + " -> " + sheet.rows().length);

  // Y el contenido es el corto, completo: se puede parsear y trae la unica operacion.
  const leida = fixture.context.PP_readCachedStateRawWithReason_(fixture.spreadsheet);
  assert.equal(leida.reason, "", "sin motivo de fallo");
  assert.equal(leida.state.operations.length, 1, "y trae la operacion del cache corta");
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

test("PP_writeNetSuiteWorkOrdersState_ deja la cache sellada con la revision nueva (getAppState tibio)", () => {
  // Sin el fix, este writer sube CONFIG.revision pero deja PP_STATE_CACHE_REVISION vieja, y
  // el siguiente getAppState reconstruye entero (>120 s medidos el 2026-09-27) -> timeout
  // del puente -> la app se queda con sampleState.
  const fixture = loadStorage();
  const { context, spreadsheet, sheets } = fixture;

  // 1) Cache caliente: un getAppState la reconstruye y la deja escrita.
  context.PP_readState_(spreadsheet);
  assert.ok(sheets.PP_STATE_CACHE, "la primera carga debe crear la hoja de cache");

  // 2) El writer de OTs sube la revision.
  context.PP_writeNetSuiteWorkOrdersState_(spreadsheet, {
    workOrders: [{ id: "wo-1", workOrderId: "9", ot: "OT-9", item: "ART-9", status: "ABIERTA" }],
    operationPlanStatuses: {},
    selectedOts: ["OT-9"],
    lockedOts: ["OT-9"],
  }, "pruebas");

  const config = configObject(context, sheets.CONFIG);
  assert.equal(config.PP_STATE_CACHE_REVISION, config.revision,
    "la cache debe quedar sellada con la MISMA revision que CONFIG");

  // 3) Prueba de que el siguiente getAppState es TIBIO y no reconstruye: se sabotea la hoja
  // OPERACIONES, que PP_buildState_ si lee (4.6M celdas). Si PP_readState_ reconstruyera,
  // PP_readRowsFast_ lanzaria y el test fallaria. Si la sirve la cache, no la toca.
  const sabotage = createSheet();
  sabotage.getDataRange = () => { throw new Error("OPERACIONES leida: el estado se reconstruyo"); };
  sheets.OPERACIONES = sabotage;

  const state = structuredClone(context.PP_readState_(spreadsheet));
  assert.equal(state.revision, config.revision);
  assert.deepEqual(state.workOrders.map((item) => item.ot), ["OT-9"], "workOrders de la cache parcheada");
  assert.deepEqual(state.selectedOts, ["OT-9"], "selectedOts de CONFIG deben viajar en la cache");
});

test("el parche de cache NO reconstruye el estado dentro del writer de OTs", () => {
  // Invariante estructural: el camino de guardado no puede llamar a PP_buildState_. Ese
  // rebuild mide >120 s y la sincronizacion de OTs ya mide 43-73 s, o sea que trasplantarlo
  // al guardado tumba la sincronizacion entera, que es peor que un arranque lento. Este test
  // es de estructura y a proposito: la consecuencia (no leer OPERACIONES) ya la comprueba
  // el test de arriba con comportamiento real.
  const patch = source.slice(
    source.indexOf("function PP_patchCachedStateAfterWorkOrderSync_("),
    source.indexOf("function PP_readState_(")
  );
  assert.doesNotMatch(patch, /PP_buildState_\(/,
    "el parche de cache no puede reconstruir el estado completo");
  assert.doesNotMatch(patch, /OPERACIONES/,
    "el parche no puede leer OPERACIONES: toma operations de la cache");

  const writeFn = source.slice(
    source.indexOf("function PP_writeNetSuiteWorkOrdersState_("),
    source.indexOf("function PP_writeWorkOrderSyncState_(")
  );
  assert.doesNotMatch(writeFn, /PP_buildState_\(/,
    "el writer de OTs no puede reconstruir el estado completo");
  assert.match(writeFn, /PP_patchCachedStateAfterWorkOrderSync_\(spreadsheet, revision\)/,
    "el writer de OTs debe sellar la cache con el scope que escribio");
  assert.doesNotMatch(writeFn, /PP_STATE_CACHE_REVISION\s*=/,
    "no debe asignar PP_STATE_CACHE_REVISION directamente (lo hace PP_writeCachedState_)");
});

test("sin cache previa el writer de OTs no inventa una: el siguiente getAppState reconstruye", () => {
  // El parche solo puede parchear una foto que exista. Si no habia cache, se deja como
  // estaba y el proximo arranque paga el rebuild frio, igual que antes del fix. Lo que NO
  // puede pasar es que se selle PP_STATE_CACHE_REVISION de una cache inexistente, porque
  // eso haria que PP_readCachedState_ devolviera null con la revision "correcta" para siempre.
  const fixture = loadStorage();
  const { context, spreadsheet, sheets } = fixture;
  context.PP_writeNetSuiteWorkOrdersState_(spreadsheet, {
    workOrders: [{ id: "wo-1", workOrderId: "9", ot: "OT-9", item: "ART-9" }],
  }, "pruebas");
  const config = configObject(context, sheets.CONFIG);
  assert.equal(config.PP_STATE_CACHE_REVISION || 0, 0,
    "sin cache previa no se sella la revision de la cache");
  assert.equal(context.PP_readState_(spreadsheet).revision, config.revision,
    "el siguiente getAppState reconstruye y avanza");
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