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
  context.PP_netSuiteConfig_ = () => ({ locationId: 1 });
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

test("toma CT y tiempo de 1762 aunque inspeccion no los incluya", () => {
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

test("reintenta sin filtro cuando 1762 no reconoce woFolio", () => {
  const context = loadService({
    trabajo: { wo: "2773", Articulo: "C 590 LE", cantidad: 3 },
    materiales: [{ componente: "MP00098", requerido: 3, pendiente: 3 }],
  }, []);
  const requests = [];
  context.PP_netSuiteRestletRequest_ = (_query, body) => {
    requests.push(body);
    return {
      ok: true,
      status: 200,
      raw: "",
      json: body.woFolio
        ? { rows: [], headers: [], hasMore: false }
        : {
            rows: [{ workorder_tranid: "2773", Operacion: "CORTE", Secuencia: 10, "Centro de trabajo": "5461", remaining_min: 25, Estado: "In Process" }],
            headers: [],
            hasMore: false,
          },
    };
  };

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].woFolio, "2773");
  assert.equal(Object.hasOwn(requests[1], "woFolio"), false);
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

test("ignora una operacion terminal sin tiempo y devuelve solo la activa valida", () => {
  const context = loadService({
    trabajo: { wo: "2773" },
    operaciones: [
      { Operacion: "CORTE", secuencia: 10, centro: "5461", remaining_min: 25, Estado: "In Process" },
      { Operacion: "DOBLEZ", secuencia: 20, centro: "5459", remaining_min: 0, Estado: "Completado" },
    ],
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.deepEqual(
    structuredClone(result.data.operations.map((operation) => operation.descripcion)),
    ["CORTE"],
  );
});

test("una operacion terminal con tiempo nunca se devuelve", () => {
  const context = loadService({
    trabajo: { wo: "2773" },
    operaciones: [
      { Operacion: "CORTE", secuencia: 10, centro: "5461", remaining_min: 25, Estado: "In Process" },
      { Operacion: "DOBLEZ", secuencia: 20, centro: "5459", remaining_min: 15, Estado: "Closed" },
    ],
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, true);
  assert.deepEqual(
    structuredClone(result.data.operations.map((operation) => operation.descripcion)),
    ["CORTE"],
  );
});

test("falla cuando no queda ninguna operacion programable", () => {
  const context = loadService({
    trabajo: { wo: "2773" },
    operaciones: [
      { Operacion: "CORTE", secuencia: 10, centro: "5461", remaining_min: 25, Estado: "Cancelado" },
    ],
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, false);
  assert.match(result.error, /ruta|operaciones|CT|tiempo/i);
});

test("rechaza detalle sin CT o tiempo de planeacion", () => {
  const context = loadService({
    trabajo: { wo: "2773" },
    operaciones: [{ Operacion: "CORTE", secuencia: 10 }],
  });

  const result = context.getPlanningWorkOrderData("2773");

  assert.equal(result.ok, false);
  assert.match(result.error, /CT|tiempo/i);
});
