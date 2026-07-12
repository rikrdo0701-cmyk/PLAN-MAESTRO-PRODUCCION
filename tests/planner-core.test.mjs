import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const source = await readFile(path.resolve("src/web/planning/planner-core.js"), "utf8");

function loadPlannerCore() {
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: "planner-core.js" });
  return context.globalThis.PlannerCore;
}

test("PlannerCore expone el programador principal", () => {
  const core = loadPlannerCore();
  assert.equal(typeof core.schedulePlan, "function");
  assert.equal(typeof core.operationToolKey, "function");
});

test("PlannerCore acepta un estado vacio", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({ operations: [], workOrders: [], settings: {}, workSchedule: {} }, {
    planStart: "2026-07-13",
    horizonDays: 5,
    executionTime: "2026-07-13T07:00:00",
  });
  assert.ok(Array.isArray(result.operations));
  assert.equal(result.operations.length, 0);
  assert.equal(result.horizonDays, 5);
});

test("un subcontrato puede terminar despues del horizonte visible", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{
      id: "ot-1325-maka",
      ot: "1325",
      secuencia: 1,
      ct: "519",
      descripcion: "MAKA",
      tipoInsercion: "SUBCONTRATO",
      estatus: "PLAN",
    }],
    workOrders: [{ ot: "1325", item: "CCA 519 CM" }],
    otConfigurations: {
      1325: { ot: "1325", subcontractType: "MAKA", subcontractDays: 15 },
    },
    settings: { optimizationPasses: 1 },
    workSchedule: {},
  }, {
    planStart: "2026-07-13",
    horizonDays: 15,
    executionTime: "2026-07-13T14:50:00",
  });

  const operation = result.operations.find((item) => item.id === "ot-1325-maka");
  assert.equal(operation.fechaInicio, "2026-07-13");
  assert.equal(operation.horaInicio, "14:50");
  assert.equal(operation.fechaFin, "2026-08-03");
  assert.equal(operation.horaFin, "07:00");
});
