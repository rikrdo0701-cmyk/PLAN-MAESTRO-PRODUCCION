import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/server/16-inspection-service.js", import.meta.url), "utf8");
const drawingSource = await readFile(new URL("../src/server/17-inspection-drawing-service.js", import.meta.url), "utf8");

function loadService(overrides = {}) {
  const context = {
    Date,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
    SpreadsheetApp: { openById: () => ({}) },
    PP_normalizeKey_: (value) => String(value ?? "").trim().toUpperCase(),
    PP_readRows_: () => [],
    Session: { getScriptTimeZone: () => "America/Mexico_City" },
    Utilities: { formatDate: () => "15/07/2026 17:04:03" },
    ...overrides
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function loadBundledService(overrides = {}) {
  const context = loadService(overrides);
  vm.runInContext(drawingSource, context);
  return context;
}

test("usa el libro y las hojas originales de Hoja Inspec", () => {
  const opened = [];
  const context = loadService({ SpreadsheetApp: { openById: (id) => { opened.push(id); return {}; } } });
  context.PP_Inspection_book_();
  assert.deepEqual(opened, ["1X0jtJBgxcD8jIKYVhuw76OTVLP74Lv2yZsbPA_WpG9M"]);
  assert.equal(vm.runInContext("PP_INSPECTION_ROUTES_SHEET", context), "Tramos");
  assert.equal(vm.runInContext("PP_INSPECTION_HISTORY_SHEET", context), "HISTORIAL_IMPRESION_INSPEC");
});

test("normaliza Tramos sin reescribir ni desalinear columnas existentes", () => {
  const rows = [["bf", "Materia prima", "AUX", "Tramo"], ["COMP UADA A", "MP00086", "basura", "102 MM"]];
  const range = (row, column, rowCount, columnCount) => ({
    getValues: () => rows.slice(row - 1, row - 1 + rowCount).map((values) => values.slice(column - 1, column - 1 + columnCount)),
    setValues: (values) => values.forEach((valueRow, offset) => { rows[row - 1 + offset] = valueRow.slice(); }),
    setValue: (value) => { while (rows[0].length < column) rows[0].push(""); rows[row - 1][column - 1] = value; }
  });
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: range,
    deleteColumn: (column) => rows.forEach((row) => row.splice(column - 1, 1)),
    setFrozenRows: () => {}
  };
  const context = loadService();
  context.PP_Inspection_normalizeSheet_(sheet, ["Articulo", "Materia prima", "Tramo", "DIBUJO", "Ultima modificacion"], true);

  assert.deepEqual(rows[0], ["Articulo", "Materia prima", "Tramo", "DIBUJO", "Ultima modificacion"]);
  assert.deepEqual(rows[1].slice(0, 3), ["COMP UADA A", "MP00086", "102 MM"]);
});

/**
 * MEDIDO 2026-10-01: la escritura del tramo salio de Apps Script. El catalogo de
 * tramos se migro de la hoja `Tramos` a la tabla `inspection_routes`
 * (docs/schema-inspection-routes.sql) y el unico escritor es la pagina, con su
 * sesion, por PPSupabaseWriter.guardarInspectionRoute.
 *
 * LO QUE SE PROBABA AQUI ES QUE Apps Script YA NO ESCRIBE, y que se dice POR QUE.
 * Un `saveInspectionLink` que se dejara de escribir sin explicacion seria un fallo
 * silencioso del tipo mas caro: el tramo parece guardado, el toast dice "Cambios
 * guardados" y al imprimir sale el valor viejo. Que se NIEGUE, y que el mensaje
 * nombre la tabla y la funcion nueva, convierte eso en algo que se ve en pantalla
 * y dice que hacer.
 *
 * Las dos propiedades que el escritor de la hoja tenia ("si no mandas dibujo, el
 * dibujo vigente no se toca" y "si mandas dibujo vacio, se limpia") no se
 * perdieron: las garantiza ahora el escritor de la pagina, y estan probadas ALLI,
 * en tests/supabase-writer-inspection-routes.test.mjs, contra el cuerpo que se
 * manda a la Data API. No se dejan aqui porque el MECANISMO cambio, y un test que
 * siga pidiendo que la hoja conserve el drawing estaria probando que una hoja que
 * ya no recibe escrituras lo conserva.
 */
test("saveInspectionLink ya no escribe y dice donde esta el escritor", () => {
  const context = loadService();
  const result = context.saveInspectionLink({ article: "A-100", material: "MP-1", route: "650 mm" });

  assert.equal(result.ok, false);
  assert.match(result.error, /inspection_routes/);
  assert.match(result.error, /guardarInspectionRoute/);
});

/**
 * Y la hoja NO se abre. El punto no es el mensaje (ya lo prueba el de arriba) sino
 * que el rechazo ocurre ANTES de tocar Drive: si la negacion llegara despues de
 * resolver la hoja, un descuido futuro volveria a escribir en la hoja congelada y
 * no habria quien lo notara.
 */
test("la negacion de saveInspectionLink no llega a abrir la hoja Tramos", () => {
  let abrios = 0;
  const context = loadService();
  context.PP_Inspection_sheet_ = () => { abrios += 1; throw new Error("no deberia abrir la hoja"); };

  context.saveInspectionLink({ article: "A-100", material: "MP-1", route: "650 mm" });

  assert.equal(abrios, 0);
});

test("lista todo el catalogo de tramos sin filtro y conserva dibujo", () => {
  const context = loadService();
  let routeIndexCalls = 0;
  const routes = {
    "A-100|MP-1": { ARTICULO: "A-100", MATERIAL: "MP-1", TRAMO: "650 mm", DIBUJO: "a100.pdf" },
    "B-200|MP-2": { ARTICULO: "B-200", MATERIAL: "MP-2", TRAMO: "420 mm", DIBUJO: "b200.pdf" }
  };
  context.PP_Inspection_routeIndex_ = () => { routeIndexCalls += 1; return routes; };

  const result = context.getInspectionDrawingRoutes("");

  assert.equal(result.ok, true);
  assert.equal(routeIndexCalls, 1);
  assert.deepEqual(structuredClone(result.data), [
    { ARTICULO: "A-100", MATERIAL: "MP-1", TRAMO: "650 mm", DIBUJO: "a100.pdf" },
    { ARTICULO: "B-200", MATERIAL: "MP-2", TRAMO: "420 mm", DIBUJO: "b200.pdf" }
  ]);
});

test("ambas definiciones publicas listan la ultima fila por articulo y material", () => {
  const physicalRows = [
    { Articulo: "A-100", "Materia prima": "MP-1", Tramo: "600 mm", DIBUJO: "anterior.pdf", "Ultima modificacion": "ayer" },
    { Articulo: "a-100", "Materia prima": "mp-1", Tramo: "650 mm", DIBUJO: "vigente.pdf", "Ultima modificacion": "hoy" }
  ];

  for (const load of [loadService, loadBundledService]) {
    const context = load({ PP_readRows_: () => physicalRows });
    context.PP_Inspection_sheet_ = () => ({});

    const result = context.getInspectionDrawingRoutes("");

    assert.equal(result.ok, true);
    assert.deepEqual(structuredClone(result.data), [{
      ARTICULO: "a-100",
      MATERIAL: "mp-1",
      TRAMO: "650 mm",
      DIBUJO: "vigente.pdf",
      ACTUALIZADO: "hoy"
    }]);
  }
});

test("adapta OT 2001 con cantidad pendiente, tramo, dibujo y fecha larga", () => {
  const context = loadService();
  context.PP_Inspection_restlet_ = () => ({
    trabajo: { Articulo: "COMP UADA A", cantidad: 10, fechaEntrega: "2026-06-05", estatus: "En curso" },
    materiales: [
      { componente: "MP00086", requerido: 0.085, pendiente: 0.085, emitido: 0 },
      { componente: "MP00135", requerido: 10, pendiente: 1, usadoEnsamblaje: 9 }
    ],
    operaciones: [{ Operacion: "10C: CORTE DE DIMENSION", secuencia: 1, centro: "10C: CORTE DE DIMENSION" }]
  });
  context.PP_Inspection_routeIndex_ = () => ({
    "COMP UADA A|MP00086": { TRAMO: "102 MM (PARA 2 PIEZAS)", DIBUJO: "" },
    "COMP UADA A|": { TRAMO: "", DIBUJO: "\\\\srv\\dibujos\\COMP UADA A.pdf" }
  });
  const result = context.getInspectionWorkOrder("2001");
  assert.equal(result.ok, true);
  assert.equal(result.data.materials[0].route, "102 MM (PARA 2 PIEZAS)");
  assert.equal(result.data.materials[1].required, 1);
  assert.equal(result.data.materials[1].requiredOriginal, 10);
  assert.equal(result.data.materials[1].issued, 9);
  assert.equal(result.data.workOrder.drawing, "\\\\srv\\dibujos\\COMP UADA A.pdf");
  assert.equal(result.data.workOrder.dueDate, "viernes, 5 de junio de 2026");
  assert.equal(result.data.operations[0].code, "10C");
});

test("lee historial con el contrato original y conserva conteo y folio", () => {
  const rows = [
    { FECHA_HORA: "15/07/2026 15:56:20", WO: "2001", SEMAFORO: "Revisar" },
    { FECHA_HORA: "15/07/2026 16:00:00", WO: "9999", SEMAFORO: "OK" }
  ];
  const context = loadService({ PP_readRows_: () => rows });
  context.PP_Inspection_historySheet_ = () => ({});
  const result = context.getInspectionHistory("2001");
  assert.equal(result.ok, true);
  assert.equal(result.data.count, 1);
  assert.equal(result.data.conteo, 1);
  assert.equal(result.data.history[0].number, 1);
  assert.equal(result.data.historial[0].numero, 1);
  assert.equal(result.data.historial[0].fechaHora, "15/07/2026 15:56:20");
  assert.equal(result.data.history[0].printedAt, "15/07/2026 15:56:20");
  assert.equal(result.data.history[0].folio, "2001");
});

test("consolida detalle e historial de una OT y los conserva en cache por 300 segundos", () => {
  const cacheEntries = new Map();
  let detailCalls = 0;
  let historyCalls = 0;
  const cache = {
    get: (key) => cacheEntries.get(key)?.value || null,
    put: (key, value, ttl) => cacheEntries.set(key, { value, ttl })
  };
  const context = loadBundledService({ CacheService: { getScriptCache: () => cache } });
  context.getInspectionWorkOrder = (wo) => { detailCalls += 1; return { ok: true, data: { wo, source: "detail" } }; };
  context.getInspectionHistory = (wo) => { historyCalls += 1; return { ok: true, data: { wo, source: "history" } }; };

  const first = context.getInspectionWorkOrderBundle(" 2001 ");
  const second = context.getInspectionWorkOrderBundle("2001");

  assert.deepEqual(structuredClone(first), { ok: true, data: {
    detail: { wo: "2001", source: "detail" }, history: { wo: "2001", source: "history" }
  } });
  assert.deepEqual(structuredClone(second), structuredClone(first));
  assert.equal(detailCalls, 1);
  assert.equal(historyCalls, 1);
  assert.deepEqual(cacheEntries.get("PP_INSPECTION_WO_BUNDLE_2001"), {
    value: JSON.stringify(first.data), ttl: 300
  });
});

test("la recarga forzada omite la cache y reemplaza el paquete", () => {
  const cacheEntries = new Map([["PP_INSPECTION_WO_BUNDLE_2001", { value: JSON.stringify({ detail: "anterior", history: "anterior" }), ttl: 300 }]]);
  let reads = 0;
  let detailCalls = 0;
  const cache = {
    get: (key) => { reads += 1; return cacheEntries.get(key)?.value || null; },
    put: (key, value, ttl) => cacheEntries.set(key, { value, ttl })
  };
  const context = loadBundledService({ CacheService: { getScriptCache: () => cache } });
  context.getInspectionWorkOrder = () => { detailCalls += 1; return { ok: true, data: "nuevo detalle" }; };
  context.getInspectionHistory = () => ({ ok: true, data: "nuevo historial" });

  const result = context.getInspectionWorkOrderBundle("2001", { forceRefresh: true });

  assert.deepEqual(structuredClone(result), { ok: true, data: { detail: "nuevo detalle", history: "nuevo historial" } });
  assert.equal(reads, 0);
  assert.equal(detailCalls, 1);
  assert.deepEqual(cacheEntries.get("PP_INSPECTION_WO_BUNDLE_2001"), {
    value: JSON.stringify(result.data), ttl: 300
  });
});

test("no guarda en cache un paquete fallido y conserva el contrato de error", () => {
  let puts = 0;
  const context = loadBundledService({ CacheService: { getScriptCache: () => ({ get: () => null, put: () => { puts += 1; } }) } });
  context.getInspectionWorkOrder = () => ({ ok: false, error: "detalle no disponible" });
  context.getInspectionHistory = () => ({ ok: true, data: {} });

  const failed = context.getInspectionWorkOrderBundle("2001");
  const missingWo = context.getInspectionWorkOrderBundle("");

  assert.deepEqual(structuredClone(failed), { ok: false, error: "detalle no disponible" });
  assert.deepEqual(structuredClone(missingWo), { ok: false, error: "OT requerida" });
  assert.equal(puts, 0);
});

test("no guarda en cache cuando falla el historial de la OT", () => {
  let puts = 0;
  const context = loadBundledService({ CacheService: { getScriptCache: () => ({ get: () => null, put: () => { puts += 1; } }) } });
  context.getInspectionWorkOrder = () => ({ ok: true, data: { wo: "2001" } });
  context.getInspectionHistory = () => ({ ok: false, error: "historial no disponible" });

  const result = context.getInspectionWorkOrderBundle("2001");

  assert.deepEqual(structuredClone(result), { ok: false, error: "historial no disponible" });
  assert.equal(puts, 0);
});

test("devuelve detalle e historial aunque falle la escritura de cache", () => {
  const context = loadBundledService({ CacheService: { getScriptCache: () => ({
    get: () => null,
    put: () => { throw new Error("cache sin espacio"); }
  }) } });
  context.getInspectionWorkOrder = () => ({ ok: true, data: { wo: "2001" } });
  context.getInspectionHistory = () => ({ ok: true, data: { count: 2 } });

  const result = context.getInspectionWorkOrderBundle("2001");

  assert.deepEqual(structuredClone(result), {
    ok: true,
    data: { detail: { wo: "2001" }, history: { count: 2 } }
  });
});

test("trata un fallo de lectura de cache como cache miss", () => {
  let detailCalls = 0;
  const context = loadBundledService({ CacheService: { getScriptCache: () => ({
    get: () => { throw new Error("cache no disponible"); },
    put: () => {}
  }) } });
  context.getInspectionWorkOrder = () => { detailCalls += 1; return { ok: true, data: { wo: "2001" } }; };
  context.getInspectionHistory = () => ({ ok: true, data: { count: 1 } });

  const result = context.getInspectionWorkOrderBundle("2001");

  assert.equal(result.ok, true);
  assert.equal(detailCalls, 1);
});

test("trata JSON corrupto en cache como cache miss y reemplaza su contenido", () => {
  let cachedValue;
  const context = loadBundledService({ CacheService: { getScriptCache: () => ({
    get: () => "{corrupto",
    put: (_key, value) => { cachedValue = value; }
  }) } });
  context.getInspectionWorkOrder = () => ({ ok: true, data: { wo: "2001" } });
  context.getInspectionHistory = () => ({ ok: true, data: { count: 1 } });

  const result = context.getInspectionWorkOrderBundle("2001");

  assert.equal(result.ok, true);
  assert.equal(cachedValue, JSON.stringify(result.data));
});

test("cachea el indice de tramos V2 y saveInspectionLink lo invalida", () => {
  const cacheEntries = new Map();
  let sheetReads = 0;
  const cache = {
    get: (key) => cacheEntries.get(key)?.value || null,
    put: (key, value, ttl) => cacheEntries.set(key, { value, ttl }),
    remove: (key) => cacheEntries.delete(key),
  };
  const context = loadBundledService({
    CacheService: { getScriptCache: () => cache },
    PP_readRows_: () => { sheetReads += 1; return [{ Articulo: "A-100", "Materia prima": "MP-1", Tramo: "650 mm", DIBUJO: "a100.pdf" }]; },
  });
  context.PP_Inspection_sheet_ = () => ({});

  const first = context.PP_Inspection_routeIndexV2_();
  assert.equal(sheetReads, 1);
  assert.equal(first["A-100|MP-1"].TRAMO, "650 mm");

  const second = context.PP_Inspection_routeIndexV2_();
  assert.equal(sheetReads, 1);
  assert.deepEqual(structuredClone(second), structuredClone(first));
  assert.equal(cacheEntries.get("PP_INSPECTION_ROUTE_INDEX_V2").ttl, 900);

  context.PP_Inspection_invalidateRouteIndexCache_();
  assert.equal(cacheEntries.has("PP_INSPECTION_ROUTE_INDEX_V2"), false);

  const third = context.PP_Inspection_routeIndexV2_();
  assert.equal(sheetReads, 2);
  assert.equal(third["A-100|MP-1"].TRAMO, "650 mm");
});

test("getInspectionWorkOrder reutiliza el indice de tramos cacheado entre OTs", () => {
  const cacheEntries = new Map();
  let sheetReads = 0;
  let restletCalls = 0;
  const context = loadBundledService({
    CacheService: { getScriptCache: () => ({
      get: (key) => cacheEntries.get(key)?.value || null,
      put: (key, value, ttl) => cacheEntries.set(key, { value, ttl }),
    }) },
    PP_readRows_: () => { sheetReads += 1; return [{ Articulo: "A-100", "Materia prima": "MP-1", Tramo: "650 mm", DIBUJO: "a100.pdf" }]; },
  });
  context.PP_Inspection_sheet_ = () => ({});
  context.PP_Inspection_restlet_ = () => {
    restletCalls += 1;
    return {
      trabajo: { Articulo: "A-100", cantidad: 10, fechaEntrega: "2026-06-05", estatus: "En curso" },
      materiales: [{ componente: "MP-1", requerido: 1, pendiente: 1, emitido: 0 }],
      operaciones: []
    };
  };

  const firstDetail = context.getInspectionWorkOrder("2001");
  const secondDetail = context.getInspectionWorkOrder("2002");

  assert.equal(firstDetail.ok, true);
  assert.equal(secondDetail.ok, true);
  assert.equal(restletCalls, 2);
  assert.equal(sheetReads, 1);
  assert.equal(secondDetail.data.materials[0].route, "650 mm");
});

test("el fallo del RESTlet de inspeccion queda en el registro de ejecuciones y conserva el contrato de error", () => {
  const logged = [];
  const raw = '{"error" : {"code" : "SSS_REQUEST_LIMIT_EXCEEDED","message" : "Se excedio el limite de solicitudes."}}';
  const properties = { NS_WO_INSPECTION_SCRIPT: "2244", NS_WO_INSPECTION_DEPLOY: "1" };
  const context = loadService({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] || "" }) },
    console: { error: (message) => logged.push(String(message)) },
    PP_netSuiteConfig_: () => ({ accountId: "11103874", locationId: 1 }),
    PP_netSuiteRestletRequest_: () => ({ ok: false, status: 400, json: {}, raw }),
  });

  const result = context.getInspectionWorkOrders();

  assert.deepEqual(structuredClone(result), { ok: false, error: "NetSuite inspeccion: 400 " + raw.slice(0, 300) });
  assert.equal(logged.length, 1);
  assert.ok(logged[0].includes("NetSuite inspeccion 400"), logged[0]);
  assert.ok(logged[0].includes("script=2244"), logged[0]);
  assert.ok(logged[0].includes("deploy=1"), logged[0]);
  assert.ok(logged[0].includes("SSS_REQUEST_LIMIT_EXCEEDED"), logged[0]);
  assert.ok(logged[0].includes('"action":"list"'), logged[0]);
});

test("un console.error que falla no impide propagar el error de inspeccion", () => {
  const context = loadService({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
    console: { error: () => { throw new Error("consola no disponible"); } },
    PP_netSuiteConfig_: () => ({ accountId: "11103874", locationId: 1 }),
    PP_netSuiteRestletRequest_: () => ({ ok: false, status: 400, json: {}, raw: '{"error":"limite"}' }),
  });

  const result = context.getInspectionWorkOrder("3483");

  assert.equal(result.ok, false);
  assert.ok(String(result.error).startsWith("NetSuite inspeccion: 400 "), result.error);
});

test("registra historial con todos los campos del contrato original", () => {
  let appended;
  const context = loadService();
  context.PP_Inspection_historySheet_ = () => ({ appendRow: (row) => { appended = row; } });
  const result = context.recordInspectionPrint({
    wo: "2001", article: "COMP UADA A", quantity: 10, status: "En curso", semaphore: "Revisar",
    alerts: ["Déficit material"], withoutDrawing: false, missingRoutes: true,
    pendingMaterials: [{ material: "MP00135", quantity: 1 }],
    deficitMaterials: [{ material: "MP00132", deficit: 52 }],
    detail: { materials: [{ material: "MP00135", pending: 1 }] }, operations: ["10C"]
  });

  assert.equal(result.ok, true);
  assert.equal(appended[0], "15/07/2026 17:04:03");
  assert.deepEqual(structuredClone(appended.slice(1, 11)), ["2001", "COMP UADA A", 10, "En curso", "Revisar", "Déficit material", "MP00135:1", "MP00132:52", "NO", "SI"]);
  assert.deepEqual(JSON.parse(appended[11]), { materials: [{ material: "MP00135", pending: 1 }], operations: ["10C"] });
});
