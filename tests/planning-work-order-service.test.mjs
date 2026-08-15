import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const [inspectionSource, netSuiteSource, serviceSource] = await Promise.all([
  readFile(new URL("../src/server/16-inspection-service.js", import.meta.url), "utf8"),
  readFile(new URL("../src/server/08-netsuite.js", import.meta.url), "utf8"),
  readFile(new URL("../src/server/18-planning-work-order-service.js", import.meta.url), "utf8"),
]);

function loadService(detail, planningOperations = detail.operaciones || detail.operations || []) {
  const context = {
    Number,
    String,
    Object,
    Error,
    parseFloat,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "" }) },
    PP_normalizeKey_: (value) => String(value || "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_"),
  };
  vm.createContext(context);
  vm.runInContext(inspectionSource, context);
  vm.runInContext(netSuiteSource, context);
  vm.runInContext(serviceSource, context);
  context.PP_Inspection_restlet_ = (request) => {
    assert.deepEqual(structuredClone(request), { action: "detail", woFolio: "2773" });
    return detail;
  };
  context.PP_netSuiteConfig_ = () => ({ accountId: "test-account", locationId: 1 });
  context.PP_oauthHeader_ = () => "OAuth test";
  context.UrlFetchApp = {
    fetch: (_url, request) => {
      const sql = JSON.parse(request.payload).q;
      if (/FROM transaction/i.test(sql)) {
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ items: [{ id: "913", tranid: "2773" }] }),
        };
      }
      assert.match(sql, /manufacturingoperationtask/i);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          items: planningOperations.map((row, index) => ({
            id: String(index + 1),
            operationsequence: row.Secuencia || row.secuencia || index + 1,
            manufacturingworkcenter: row["Centro de trabajo"] || row.centro || row.CT,
            work_center: row.Operacion || row.operacion,
            setuptime: row.remaining_min || row["Tiempo estimado (min)"] || row.tiempo || 0,
            runrate: 0,
            title: row.Operacion || row.operacion,
          })),
        }),
      };
    },
  };
  context.PP_netSuiteRestletRequest_ = (query, body) => {
    assert.deepEqual(structuredClone(query), { script: "1762", deploy: "17" });
    assert.equal(body.woFolio, "2773");
    return {
      ok: true,
      status: 200,
      raw: "",
      json: {
        rows: planningOperations.map((row) => ({ workorder_tranid: "2773", ...row })),
        headers: [],
        hasMore: false,
      },
    };
  };
  return context;
}

test("carga las operaciones de una OT desde manufacturingoperationtask", () => {
  const context = loadService({
    trabajo: { wo: "2773", "WO Internal ID": "913", Articulo: "C 590 LE", cantidad: 3 },
    materiales: [],
  });
  const operationRows = Array.from({ length: 12 }, (_, index) => ({
    id: String(index + 1),
    operationsequence: index + 1,
    manufacturingworkcenter: index === 0 ? "5458" : String(5500 + index),
    work_center: index === 0 ? "CORTE" : "OPERACION " + (index + 1),
    setuptime: index === 0 ? 6 : (index === 11 ? 4 : 1),
    runrate: index === 0 ? 0.62 : (index === 11 ? 0 : 1),
    title: "Operacion " + (index + 1),
  }));
  const requests = [];
  context.PP_oauthHeader_ = () => "OAuth test";
  context.UrlFetchApp = {
    fetch: (url, request) => {
      requests.push({ url, request });
      assert.match(request.payload, /manufacturingoperationtask/i);
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ items: operationRows }),
      };
    },
  };
  context.PP_netSuiteRestletRequest_ = () => {
    throw new Error("no debe consultar RESTlet 1762/17");
  };

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(requests.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.data.operations.length, 12);
  assert.equal(result.data.operations[0].id, "ns-2773-1");
  assert.equal(result.data.operations[0].ct, "5458");
  assert.equal(result.data.operations[0].cantPendiente, 3);
  assert.equal(result.data.operations[0].cantTotal, 3);
  assert.equal(result.data.operations[0].tiempoProd, 6 + (0.62 * 3));
  assert.equal(result.data.operations[11].tiempoProd, 4);
  assert.equal(result.data.operations[11].cantPendiente, 3);
  assert.equal(result.data.operations[11].cantTotal, 3);
});

test("conserva la ruta de una OT activa aunque sus tareas aparezcan terminales", () => {
  const context = loadService({
    trabajo: { wo: "2773", id: "913", cantidad: 3 },
  });
  let payload = "";
  context.UrlFetchApp.fetch = (_url, request) => {
    payload = request.payload;
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ items: [
        { id: "1", operationsequence: 10, manufacturingworkcenter: "5458", work_center: "CORTE", setuptime: 6, runrate: 0.62, title: "CORTE", status: "IN PROGRESS" },
        { id: "2", operationsequence: 20, manufacturingworkcenter: "5459", work_center: "DOBLEZ", setuptime: 6, runrate: 0.62, title: "DOBLEZ", status: "COMPLETED" },
        { id: "3", operationsequence: 30, manufacturingworkcenter: "5460", work_center: "PINTURA", setuptime: 6, runrate: 0.62, title: "PINTURA", status: "CANCELLED" },
      ] }),
    };
  };

  const result = context.getPlanningWorkOrderData("2773");

  assert.match(payload, /manufacturingoperationtask/i);
  assert.equal(result.ok, true);
  assert.deepEqual(
    structuredClone(result.data.operations.map((operation) => operation.descripcion)),
    ["CORTE", "DOBLEZ", "PINTURA"],
  );
  assert.deepEqual(
    structuredClone(result.data.operations.map((operation) => operation.estatus)),
    ["No iniciado", "No iniciado", "No iniciado"],
  );
});

test("toma CT y tiempo de la ruta directa aunque inspeccion no los incluya", () => {
  const context = loadService({
    trabajo: { wo: "2773", Articulo: "C 590 LE", cantidad: 3 },
    operaciones: [{ Operacion: "CORTE", secuencia: 10, centro: "5461" }],
    materiales: [{ componente: "MP00098", requerido: 3, pendiente: 3 }],
  }, [
    { workorder_tranid: "2773", Operacion: "CORTE", Secuencia: 10, "Centro de trabajo": "5461", remaining_min: 25, Estado: "In Process" },
  ]);

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.equal(result.data.operations[0].ct, "5461");
  assert.equal(result.data.operations[0].tiempoProd, 25);
});

test("resuelve el ID interno por folio cuando inspeccion no lo incluye", () => {
  const context = loadService({
    trabajo: { wo: "2773", Articulo: "C 590 LE", cantidad: 3 },
    materiales: [{ componente: "MP00098", requerido: 3, pendiente: 3 }],
  }, []);
  const requests = [];
  context.UrlFetchApp.fetch = (_url, request) => {
    const sql = JSON.parse(request.payload).q;
    requests.push(sql);
    const items = /FROM transaction/i.test(sql)
      ? [{ id: "913", tranid: "2773" }]
      : [{ id: "1", operationsequence: 10, manufacturingworkcenter: "5461", work_center: "CORTE", setuptime: 6, runrate: 0.62, title: "CORTE" }];
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ items }) };
  };

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /FROM transaction/i);
  assert.match(requests[1], /manufacturingoperationtask/i);
});

test("ignora el id generico de inspeccion y resuelve el Work Order por folio", () => {
  const context = loadService({
    trabajo: { wo: "2773", id: "MP00098", Articulo: "C 590 LE", cantidad: 3 },
    materiales: [{ componente: "MP00098", requerido: 3, pendiente: 3 }],
  }, []);
  const requests = [];
  context.UrlFetchApp.fetch = (_url, request) => {
    const sql = JSON.parse(request.payload).q;
    requests.push(sql);
    const items = /FROM transaction/i.test(sql)
      ? [{ id: "29445", tranid: "2773" }]
      : /WHERE workorder = '29445'/i.test(sql)
        ? [{ id: "1", operationsequence: 10, manufacturingworkcenter: "5458", work_center: "3OTD : CORTE DE TUBO", setuptime: 6, runrate: 0.62, title: "3OTD" }]
        : [];
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ items }) };
  };

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /FROM transaction/i);
  assert.match(requests[1], /WHERE workorder = '29445'/i);
  assert.equal(result.data.operations[0].ct, "5458");
});

test("calcula setup mas run rate por la cantidad pendiente de la OT", () => {
  const context = loadService({
    trabajo: { wo: "2773", id: "913", Articulo: "C 590 LE", cantidad: 10, cantidadEnsamblada: 3 },
    materiales: [{ componente: "MP00098", requerido: 3, pendiente: 3 }],
  });
  context.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ items: [{
      id: "1", operationsequence: 10, manufacturingworkcenter: "5461", work_center: "CORTE",
      setuptime: 4, runrate: 1.5, title: "CORTE",
    }] }),
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.equal(result.data.operations[0].tiempoProd, 4 + (1.5 * (10 - 3)));
  assert.equal(result.data.operations[0].cantPendiente, 10 - 3);
  assert.equal(result.data.operations[0].cantTotal, 10 - 3);
});

test("oculta la respuesta cruda de SuiteQL y conserva el diagnostico en servidor", () => {
  const context = loadService({ trabajo: { wo: "2773", id: "913", cantidad: 3 } });
  const diagnostics = [];
  context.Logger = { log: (message) => diagnostics.push(message) };
  context.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 502,
    getContentText: () => "token-secreto-netSuite: detalle interno",
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, false);
  assert.match(result.error, /SuiteQL operaciones OT: error HTTP 502/);
  assert.doesNotMatch(result.error, /token-secreto-netSuite/);
  assert.match(diagnostics.join("\n"), /token-secreto-netSuite/);
});

test("adapta una OT individual al contrato del planeador", () => {
  const context = loadService({
    trabajo: {
      wo: "2773",
      Articulo: "C 590 LE",
      cantidad: 3,
      estatus: "En curso",
      fechaInicio: "1/7/2026",
      fechaFin: "2026-07-08",
      fechaEntrega: "09/07/2026",
    },
    operaciones: [{ Operacion: "CORTE", secuencia: 10, centro: "5461", remaining_min: 25, Estado: "In Process" }],
    materiales: [{ componente: "MP00098", requerido: 3, emitido: 0, pendiente: 3 }],
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.deepEqual(
    structuredClone({
      ot: result.data.workOrder.ot,
      item: result.data.workOrder.item,
      quantity: result.data.workOrder.quantity,
      status: result.data.workOrder.status,
      startDate: result.data.workOrder.startDate,
      endDate: result.data.workOrder.endDate,
      dueDate: result.data.workOrder.dueDate,
    }),
    {
      ot: "2773",
      item: "C 590 LE",
      quantity: 3,
      status: "En curso",
      startDate: "2026-07-01",
      endDate: "2026-07-08",
      dueDate: "2026-07-09",
    },
  );
  assert.equal(result.data.operations[0].ot, "2773");
  assert.equal(result.data.operations[0].descripcion, "CORTE");
  assert.equal(result.data.operations[0].secuencia, 10);
  assert.equal(result.data.operations[0].ct, "5461");
  assert.equal(result.data.operations[0].tiempoProd, 25);
  assert.equal(result.data.materials[0].component, "MP00098");
  assert.equal(result.data.materials[0].required, 3);
  assert.equal(result.data.materials[0].issued, 0);
  assert.equal(result.data.materials[0].pending, 3);
});

test("rechaza toda la ruta cuando mezcla operaciones validas e invalidas", () => {
  const context = loadService({
    trabajo: { wo: "2773" },
    operaciones: [
      { Operacion: "CORTE", secuencia: 10, centro: "5461", remaining_min: 25 },
      { Operacion: "DOBLEZ", secuencia: 20, centro: "", remaining_min: 15 },
    ],
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, false);
  assert.match(result.error, /CT|tiempo/i);
});

test("falla cuando no queda ninguna operacion programable", () => {
  const context = loadService({
    trabajo: { wo: "2773", id: "913" },
  }, []);

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, false);
  assert.match(result.error, /Ruta de manufactura vacia/i);
});

test("asigna un segundo a operaciones sin tiempo y conserva tiempos validos", () => {
  const context = loadService({
    trabajo: { wo: "2773", id: "913" },
  }, [
    { Operacion: "SIN_TIEMPO", Secuencia: 10, "Centro de trabajo": "5461" },
    { Operacion: "CERO", Secuencia: 20, "Centro de trabajo": "5462", remaining_min: 0 },
    { Operacion: "NEGATIVO", Secuencia: 30, "Centro de trabajo": "5463", remaining_min: -2 },
    { Operacion: "INVALIDO", Secuencia: 40, "Centro de trabajo": "5464", remaining_min: "no numerico" },
    { Operacion: "VALIDO", Secuencia: 50, "Centro de trabajo": "5465", remaining_min: 12 },
  ]);

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.deepEqual(
    structuredClone(result.data.operations.map((operation) => operation.tiempoProd)),
    [1 / 60, 1 / 60, 1 / 60, 1 / 60, 12],
  );
  assert.deepEqual(
    structuredClone(result.data.operations.map((operation) => operation.tiempoFallback)),
    [true, true, true, true, undefined],
  );
});

test("rechaza detalle sin CT", () => {
  const context = loadService({
    trabajo: { wo: "2773", id: "913" },
  }, [{}]);

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, false);
  assert.match(result.error, /secuencia 1.*sin CT/i);
  assert.doesNotMatch(result.error, /sin tiempo/i);
});
