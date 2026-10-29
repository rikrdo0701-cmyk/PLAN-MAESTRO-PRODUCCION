import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const storageSource = await readFile(new URL("../src/server/02-storage.js", import.meta.url), "utf8");
const netsuiteSource = await readFile(new URL("../src/server/08-netsuite.js", import.meta.url), "utf8");

function load() {
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
      formatDate: () => "2026-09-08",
      getUuid: () => "test-uuid",
    },
    Session: { getScriptTimeZone: () => "America/Mexico_City" },
    PP_SCHEMA_VERSION: 1,
    PP_APP_VERSION: "test",
    PP_PLANT_NAME: "Planta MM del Llano",
    PP_PLANT_LOCATION_ID: 1,
  };
  vm.createContext(context);
  vm.runInContext(storageSource, context, { filename: "02-storage.js" });
  vm.runInContext(netsuiteSource, context, { filename: "08-netsuite.js" });
  return context;
}

function baseCurrent() {
  return {
    revision: 7,
    workOrders: [{ ot: "100", workOrderId: "w100", pendingQuantity: 10 }],
    operations: [
      { id: "ns-1", ot: "100", secuencia: 10, ct: "5459", tipoInsercion: "OPERACION", operador: "DOBLADOR 1", maquina: "113", herramental: "10|1.25 x 1.25", planStatus: "PENDIENTE", fechaInicio: "2026-09-08", horaInicio: "07:00", fechaFin: "2026-09-08", horaFin: "08:00" },
      { id: "ch-1", ot: "100", secuencia: 99, ct: "TOOL_CHANGE", tipoInsercion: "CAMBIO_HERRAMENTAL", operador: "AJUSTADOR", maquina: "113", planStatus: "PENDIENTE", fechaInicio: "2026-09-08", horaInicio: "06:30", fechaFin: "2026-09-08", horaFin: "07:00", generatedBy: "PLANNER_CORE_V2" },
      { id: "ns-2", ot: "999", secuencia: 10, ct: "5459", tipoInsercion: "OPERACION", planStatus: "PENDIENTE" },
      { id: "ch-2", ot: "999", secuencia: 99, ct: "TOOL_CHANGE", tipoInsercion: "CAMBIO_HERRAMENTAL", operador: "AJUSTADOR", generatedBy: "PLANNER_CORE_V2" },
    ],
    operationCatalog: [],
    materials: [],
  };
}

function plantRow(ot = "100") {
  return {
    "Orden de trabajo": ot,
    "Secuencia": "10",
    "Centro de trabajo": "5459",
    "Operacion": "DOBLAR",
    "Estado": "No iniciada",
    "Cantidad": "10",
    "Cantidad realizada": "0",
    "Recurso maquina": "113",
  };
}

test("sync NetSuite de operaciones preserva los CAMBIO_HERRAMENTAL de OTs presentes y descarta los de OTs ausentes", () => {
  const context = load();
  const current = baseCurrent();
  const snapshot = {
    plantOperations: [plantRow("100")],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "",
    fetchedAt: "2026-09-08T02:00:00.000Z",
  };
  const merged = context.PP_applyNetSuitePlanningData_(current, snapshot);

  const ots = new Set(merged.operations.map((op) => String(op.ot).trim()));
  assert.deepEqual([...ots].sort(), ["100"]);
  const changes = merged.operations.filter((op) => String(op.tipoInsercion) === "CAMBIO_HERRAMENTAL");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].ot, "100");
  assert.equal(changes[0].operador, "AJUSTADOR");
  assert.equal(changes[0].generatedBy, "PLANNER_CORE_V2");
  const mapped = merged.operations.filter((op) => String(op.tipoInsercion) !== "CAMBIO_HERRAMENTAL");
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].ot, "100");
  assert.equal(mapped[0].maquina, "113");
});

test("sync NetSuite con workOrders (planta) preserva los CAMBIO_HERRAMENTAL", () => {
  const context = load();
  const current = baseCurrent();
  const snapshot = {
    workOrders: [{ workOrderId: "w100", ot: "100", pendingQuantity: 10 }],
    plantOperations: [plantRow("100")],
    materials: [],
    operationCatalog: [],
    operationCatalogWarning: "",
    fetchedAt: "2026-09-08T02:00:00.000Z",
  };
  const merged = context.PP_applyNetSuitePlanningData_(current, snapshot);

  const ots = new Set(merged.operations.map((op) => String(op.ot).trim()));
  assert.deepEqual([...ots].sort(), ["100"]);
  const changes = merged.operations.filter((op) => String(op.tipoInsercion) === "CAMBIO_HERRAMENTAL");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].ot, "100");
  assert.ok(Array.isArray(merged.workOrders) && merged.workOrders.length === 1);
});