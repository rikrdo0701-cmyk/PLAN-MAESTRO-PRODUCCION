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
