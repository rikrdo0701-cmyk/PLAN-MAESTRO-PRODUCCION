import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const source = await readFile(path.resolve("src/web/planning/planning-workflow-core.js"), "utf8");
const context = { globalThis: {}, setTimeout, clearTimeout };
vm.runInNewContext(source, context, { filename: "planning-workflow-core.js" });
const core = context.globalThis.PlanningWorkflowCore;

test("withTimeout resuelve la promesa y rechaza al vencer el limite", async () => {
  assert.equal(await core.withTimeout(Promise.resolve("ok"), 15), "ok");
  await assert.rejects(core.withTimeout(new Promise(() => {}), 15), /15 segundos/);
});

test("hasPlanningData exige operaciones de las OTs solicitadas", () => {
  assert.equal(core.hasPlanningData({ operations: [{ ot: "1325", descripcion: "CORTE" }] }, ["1325"]), true);
  assert.equal(core.hasPlanningData({ operations: [] }, ["1325"]), false);
  assert.equal(core.hasPlanningData({ operations: [{ ot: "999" }] }, ["1325"]), false);
});

test("prepareDraftForReschedule limpia solo el borrador movible seleccionado sin mutar", () => {
  const movable = {
    id: "movable", ot: "1325", fechaInicio: "2026-07-01", horaInicio: "08:00",
    fechaFin: "2026-07-01", horaFin: "10:00", operador: "OP 1", maquina: "M1",
    herramental: "H1", kitHerramental: "K1", needsReschedule: true, autoFrozen: true,
    estatus: "PROGRAMADA", planStatus: "PENDIENTE",
  };
  const completed = { ...movable, id: "completed", planStatus: "COMPLETADA_PLAN" };
  const locked = { ...movable, id: "locked", locked: true };
  const otherOt = { ...movable, id: "other", ot: "999" };
  const historical = { ...movable, id: "historical", historical: true };
  const state = { selectedOts: ["1325"], operations: [movable, completed, locked, otherOt, historical] };
  const original = structuredClone(state);

  const result = core.prepareDraftForReschedule(state, ["1325"]);

  assert.deepEqual(state, original);
  assert.notEqual(result, state);
  assert.notEqual(result.operations, state.operations);
  assert.deepEqual(structuredClone(result.operations[0]), {
    ...movable,
    fechaInicio: "", horaInicio: "", fechaFin: "", horaFin: "",
    operador: "", maquina: "", herramental: "", kitHerramental: "",
    needsReschedule: false, autoFrozen: false, estatus: "PLAN", planStatus: "PENDIENTE",
  });
  assert.deepEqual(structuredClone(result.operations.slice(1)), original.operations.slice(1));
});

test("filterOperationsByPlanStatus filtra pendientes, completadas y todas", () => {
  const pending = { id: "p", planStatus: "PENDIENTE" };
  const completed = { id: "c", planStatus: "COMPLETADA_PLAN" };
  const rows = [pending, completed];
  assert.deepEqual(core.filterOperationsByPlanStatus(rows, "PENDIENTES"), [pending]);
  assert.deepEqual(core.filterOperationsByPlanStatus(rows, "COMPLETADAS"), [completed]);
  assert.deepEqual(core.filterOperationsByPlanStatus(rows, "TODAS"), rows);
});

test("clasifica operaciones de reporte en una categoria exclusiva", () => {
  const productive = { id: "p", tipoInsercion: "OPERACION", operador: "DOBLADOR 1" };
  const toolChange = { id: "a", tipoInsercion: "CAMBIO_HERRAMENTAL", operador: "AJUSTADOR" };
  const subcontract = { id: "s", tipoInsercion: "SUBCONTRATO", operador: "SUBCONTRATO" };
  assert.equal(core.classifyReportOperation(productive), "operator");
  assert.equal(core.classifyReportOperation(toolChange), "adjuster");
  assert.equal(core.classifyReportOperation(subcontract), "subcontract");
  assert.deepEqual(core.reportCoverageIssues([productive, toolChange, subcontract]), []);
});

test("reportCoverageIssues diagnostica operaciones sin categoria o ambiguas", () => {
  const issues = core.reportCoverageIssues([
    { id: "none", tipoInsercion: "OPERACION", operador: "" },
    { id: "ambiguous", tipoInsercion: "CAMBIO_HERRAMENTAL", operador: "SUBCONTRATO" },
  ]);
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((issue) => issue.id), ["none", "ambiguous"]);
  assert.match(issues[0].diagnostic, /sin categoria/i);
  assert.match(issues[1].diagnostic, /ambigua/i);
});
