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
  await assert.rejects(core.withTimeout(new Promise(() => {}), 15), /0\.015 segundos/);
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

test("normaliza la vista Gantt y mantiene un unico control activo", () => {
  for (const view of ["job", "ct", "machine", "operator"]) {
    assert.equal(core.normalizeGanttView(view), view);
    assert.equal(core.isActiveGanttView(view, view), true);
  }
  assert.equal(core.normalizeGanttView("desconocida"), "job");
  assert.equal(["job", "ct", "machine", "operator"].filter((view) => core.isActiveGanttView("ct", view)).length, 1);
});

test("retirar una OT limpia solo su pertenencia al borrador", () => {
  const operation = { id: "op-1", ot: "1325", locked: true };
  const state = {
    selectedOts: ["1325", "1400"], lockedOts: ["1325"], expandedOts: ["1325"],
    operations: [operation], lastSchedule: { scheduledOts: ["1325", "1400"] },
    planningConfigByOt: { 1325: { subcontractDays: 15 } }, preparedPlanningByOt: { 1325: "firma" },
  };
  const result = core.removeOtFromDraft(state, "1325");
  assert.deepEqual(result.selectedOts, ["1400"]);
  assert.deepEqual(result.lockedOts, []);
  assert.deepEqual(result.lastSchedule.scheduledOts, ["1400"]);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].locked, false);
  assert.equal(result.planningConfigByOt[1325].subcontractDays, 15);
  assert.equal(result.preparedPlanningByOt[1325], undefined);
  assert.equal(core.isOtEligibleForDraft(result, "1325"), false);
});

test("completar y reabrir conserva la programacion historica", () => {
  const operation = { id: "op", fechaInicio: "2026-07-13", horaInicio: "07:00", operador: "OP 1" };
  const completed = core.setDraftOperationCompletion(operation, true, "2026-07-12T18:00:00Z");
  assert.equal(completed.planStatus, "COMPLETADA_PLAN");
  assert.equal(completed.fechaInicio, operation.fechaInicio);
  assert.equal(completed.operador, operation.operador);
  assert.equal(core.isPendingDraftOperation(completed), false);
  const reopened = core.setDraftOperationCompletion(completed, false);
  assert.equal(reopened.planStatus, "PENDIENTE");
  assert.equal(core.isPendingDraftOperation(reopened), true);
});

test("selector operativo y exportacion usan solo borrador pendiente programado", () => {
  const options = core.operationalPlanOptions([
    { id: "p", status: "PUBLICADO", name: "Plan publicado" },
    { id: "g", status: "GUARDADO", name: "Guardado" },
  ]);
  assert.deepEqual(structuredClone(options.map((option) => option.id)), ["draft", "p"]);
  const state = { selectedOts: ["1325"], operations: [
    { id: "ok", ot: "1325", planStatus: "PENDIENTE", fechaInicio: "2026-07-13", fechaFin: "2026-07-13" },
    { id: "done", ot: "1325", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-07-13", fechaFin: "2026-07-13" },
    { id: "backlog", ot: "1400", planStatus: "PENDIENTE", fechaInicio: "2026-07-13", fechaFin: "2026-07-13" },
    { id: "unscheduled", ot: "1325", planStatus: "PENDIENTE", fechaInicio: "", fechaFin: "" },
    { id: "historical", ot: "1325", historical: true, planStatus: "PENDIENTE", fechaInicio: "2026-07-13", fechaFin: "2026-07-13" },
  ] };
  assert.deepEqual(structuredClone(core.draftExportOperations(state).map((op) => op.id)), ["ok"]);
});

test("las vistas del borrador incluyen solo OTs seleccionadas programadas", () => {
  const state = { selectedOts: ["1325"], operations: [
    { id: "selected", ot: "1325", fechaInicio: "2026-07-13", fechaFin: "2026-07-13", planStatus: "PENDIENTE" },
    { id: "backlog", ot: "1424", fechaInicio: "2026-07-13", fechaFin: "2026-07-13", planStatus: "PENDIENTE" },
    { id: "unscheduled", ot: "1325", fechaInicio: "", fechaFin: "", planStatus: "PENDIENTE" },
    { id: "historical", ot: "1325", historical: true, fechaInicio: "2026-07-13", fechaFin: "2026-07-13" },
  ] };
  assert.deepEqual(structuredClone(core.draftScheduledOperations(state).map((op) => op.id)), ["selected"]);
});

test("la preparacion es idempotente hasta que cambia su firma", () => {
  const state = { selectedOts: ["1325"], preparedPlanningByOt: { 1325: "firma-a" } };
  assert.equal(core.needsPlanningPreparation(state, "1325", "firma-a"), false);
  assert.equal(core.needsPlanningPreparation(state, "1325", "firma-b"), true);
  assert.equal(core.needsPlanningPreparation({ selectedOts: [] }, "1325", "firma-a"), false);
  const marked = core.markPlanningPrepared(state, "1325", "firma-b");
  assert.equal(marked.preparedPlanningByOt[1325], "firma-b");
});

test("selecciona el borrador coherente mas reciente sin mezclar colecciones", () => {
  const older = { revision: 2, savedAt: "2026-07-12T10:00:00Z", selectedOts: ["100"], workOrders: [{ ot: "100" }], operations: [{ ot: "100" }] };
  const newer = { revision: 3, savedAt: "2026-07-12T11:00:00Z", selectedOts: ["200"], workOrders: [{ ot: "200" }], operations: [{ ot: "200" }] };
  const mixed = { revision: 4, selectedOts: ["300"], workOrders: [], operations: [{ ot: "200" }] };
  assert.equal(core.isCoherentDraft(older), true);
  assert.equal(core.isCoherentDraft(mixed), false);
  assert.equal(core.selectNewestCoherentDraft(older, newer).revision, 3);
  assert.equal(core.selectNewestCoherentDraft(mixed, older).revision, 2);
});

test("los planes diarios prefieren el ultimo publicado y usan borrador como respaldo", () => {
  assert.deepEqual(structuredClone(core.defaultDailyPlanSource([], { operations: [{ id: "d" }] })), { type: "draft", snapshotId: "draft" });
  const source = core.defaultDailyPlanSource([
    { snapshotId: "saved", status: "GUARDADO", generatedAt: "2026-07-12T15:00:00Z" },
    { snapshotId: "old", status: "PUBLICADO", publishedAt: "2026-07-12T10:00:00Z" },
    { snapshotId: "new", planStatus: "PUBLICADO", publishedAt: "2026-07-12T12:00:00Z" },
  ], { operations: [] });
  assert.deepEqual(structuredClone(source), { type: "published", snapshotId: "new" });
});

test("describe resultados completos, parciales y fallidos de sincronizacion NetSuite", () => {
  assert.deepEqual(structuredClone(core.netSuiteSyncOutcome({ ok: true }, { ok: true })), {
    status: "complete", message: "OTs y operaciones actualizadas",
  });
  assert.deepEqual(structuredClone(core.netSuiteSyncOutcome({ ok: true }, { ok: false, error: "timeout" })), {
    status: "partial", message: "OTs actualizadas; operaciones pendientes de sincronizar",
  });
  assert.deepEqual(structuredClone(core.netSuiteSyncOutcome({ ok: false, error: "sin credenciales" }, null)), {
    status: "failed", message: "No se pudieron sincronizar las OTs: sin credenciales",
  });
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

test("reportCoverageDiagnostics solo informa programadas pendientes con contexto completo", () => {
  const issues = core.reportCoverageDiagnostics([
    { id: "visible", ot: "1325", secuencia: 7, descripcion: "DOBLEZ", fechaInicio: "2026-07-12", fechaFin: "2026-07-12", operador: "", planStatus: "PENDIENTE" },
    { id: "completed", fechaInicio: "2026-07-12", fechaFin: "2026-07-12", operador: "", planStatus: "COMPLETADA_PLAN" },
    { id: "unscheduled", operador: "", planStatus: "PENDIENTE" },
  ]);
  assert.equal(issues.length, 1);
  assert.match(issues[0].text, /OT 1325.*Secuencia 7.*DOBLEZ.*Categorias: ninguna/i);
});

test("reportDateRange acepta solamente de uno a cinco dias futuros", () => {
  assert.deepEqual(structuredClone(core.reportDateRange("2026-07-12", 3)), { start: "2026-07-12", end: "2026-07-15", futureDays: 3 });
  assert.equal(core.reportDateRange("2026-07-12", 0).futureDays, 1);
  assert.equal(core.reportDateRange("2026-07-12", 9).futureDays, 5);
});

test("selectReportRows ordena, filtra estado y rango, y limita siempre a 25", () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({
    id: String(index), fechaInicio: index === 30 ? "2026-07-20" : "2026-07-12",
    horaInicio: `${String(29 - Math.min(index, 29)).padStart(2, "0")}:00`,
    planStatus: index === 0 ? "COMPLETADA_PLAN" : "PENDIENTE",
  }));
  const selection = core.selectReportRows(rows, { startDate: "2026-07-12", futureDays: 1, status: "PENDIENTES", limit: 25 });
  assert.equal(selection.total, 29);
  assert.equal(selection.rows.length, 25);
  assert.deepEqual(selection.rows.map((row) => row.id), Array.from({ length: 25 }, (_, index) => String(29 - index)));
});
