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
    operador: "",
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

test("canRemoveSelectedOt rechaza retirar una OT bloqueada y permite una desbloqueada", () => {
  const state = { lockedOts: ["100"] };
  assert.deepEqual(structuredClone(core.canRemoveSelectedOt(state, 100)), {
    allowed: false,
    reason: "Desbloquea la OT antes de retirarla del plan",
  });
  assert.deepEqual(structuredClone(core.canRemoveSelectedOt(state, "200")), {
    allowed: true,
    reason: "",
  });
});

test("compareWorkOrderLite separa cambios directos y planeados sin mutar entradas", () => {
  const state = {
    selectedOts: [" 200 ", "400"],
    workOrders: [
      { ot: "100", item: "A", quantity: 10, builtQuantity: 2, pendingQuantity: 8, status: "ABIERTA", description: "UI", dueDateOverride: "2026-08-01" },
      { ot: "200", item: "B", quantity: 10, builtQuantity: 1, pendingQuantity: 9, status: "ABIERTA", customer: "Cliente UI" },
      { ot: "400", item: "D", quantity: 5, builtQuantity: 0, pendingQuantity: 5, status: "ABIERTA" },
    ],
    operations: [{ id: "op", ot: "200" }], otConfigurations: { 200: { machine: "M1" } },
  };
  const incoming = [
    { ot: "100", item: "A2", quantity: 12, builtQuantity: 3, pendingQuantity: 9, status: "LIBERADA", exists: true },
    { ot: 200, item: "B", quantity: 20, builtQuantity: 1, pendingQuantity: 19, status: "LIBERADA", exists: true },
    { ot: "300", item: "C", quantity: 7, builtQuantity: 0, pendingQuantity: 7, status: "ABIERTA", exists: true },
  ];
  const originalState = structuredClone(state);
  const originalIncoming = structuredClone(incoming);

  const comparison = core.compareWorkOrderLite(state, incoming);

  assert.deepEqual(state, originalState);
  assert.deepEqual(incoming, originalIncoming);
  assert.deepEqual(structuredClone(comparison.direct.map((item) => item.ot)), ["100", "300"]);
  assert.deepEqual(structuredClone(comparison.plannedQuantityChanges.map((item) => item.ot)), ["200"]);
  assert.deepEqual(structuredClone(comparison.plannedClosed.map((item) => item.ot)), ["400"]);
  const merged100 = comparison.nextWorkOrders.find((item) => item.ot === "100");
  assert.equal(merged100.item, "A2");
  assert.equal(merged100.quantity, 12);
  assert.equal(merged100.description, "UI");
  assert.equal(merged100.dueDateOverride, "2026-08-01");
});

test("compareWorkOrderLite clasifica cambios no cuantitativos de una OT planeada como directos", () => {
  const state = {
    selectedOts: ["700"],
    workOrders: [{ ot: "700", item: "ART-A", quantity: 10, builtQuantity: 2, pendingQuantity: 8, status: "ABIERTA", exists: true }],
  };
  const comparison = core.compareWorkOrderLite(state, [
    { ot: 700, item: "ART-B", quantity: 10, builtQuantity: 2, pendingQuantity: 8, status: "CERRADA", exists: false },
  ]);

  assert.deepEqual(structuredClone(comparison.direct.map((item) => item.ot)), ["700"]);
  assert.deepEqual(structuredClone(comparison.plannedQuantityChanges), []);
});

test("applyConfirmedWorkOrderChanges acepta cantidades y conserva bloqueadas y completadas", () => {
  const state = {
    selectedOts: ["200"], lockedOts: ["200"], workOrders: [{ ot: "200", item: "B", quantity: 10, builtQuantity: 0, pendingQuantity: 10 }],
    operations: [
      { id: "pending", ot: "200", planStatus: "PENDIENTE", fechaInicio: "2026-07-20", horaInicio: "07:00", fechaFin: "2026-07-20", horaFin: "08:00" },
      { id: "locked", ot: "200", planStatus: "PENDIENTE", locked: true, fechaInicio: "2026-07-20", horaInicio: "08:00", fechaFin: "2026-07-20", horaFin: "09:00" },
      { id: "done", ot: "200", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-07-19", horaInicio: "07:00", fechaFin: "2026-07-19", horaFin: "08:00" },
    ],
  };
  const comparison = core.compareWorkOrderLite(state, [{ ot: "200", item: "B", quantity: 20, builtQuantity: 2, pendingQuantity: 18, status: "ABIERTA" }]);

  const result = core.applyConfirmedWorkOrderChanges(state, comparison, { acceptQuantityOts: ["200"], removeClosedOts: [], keepClosedOts: [] });

  assert.equal(result.workOrders[0].quantity, 20);
  assert.equal(result.draftNeedsReschedule, true);
  assert.deepEqual([result.operations[0].fechaInicio, result.operations[0].horaInicio, result.operations[0].fechaFin, result.operations[0].horaFin], ["", "", "", ""]);
  assert.equal(result.operations[1].fechaInicio, "2026-07-20");
  assert.equal(result.operations[2].fechaInicio, "2026-07-19");
  assert.ok(result.workOrderSyncWarnings.some((warning) => warning.ot === "200" && warning.type === "LOCKED_INCOMPATIBILITY"));
});

test("applyConfirmedWorkOrderChanges conserva rechazos y retira cerradas incluso bloqueadas", () => {
  const state = {
    selectedOts: ["200", "400", "500"], lockedOts: ["400"], expandedOts: ["400"],
    workOrders: [
      { ot: "200", quantity: 10, builtQuantity: 0, pendingQuantity: 10 },
      { ot: "400", quantity: 5, builtQuantity: 0, pendingQuantity: 5 },
      { ot: "500", quantity: 6, builtQuantity: 0, pendingQuantity: 6 },
    ],
    operations: [
      { id: "400-p", ot: "400", planStatus: "PENDIENTE", locked: true, prioridad: 1 },
      { id: "400-c", ot: "400", planStatus: "COMPLETADA_PLAN", prioridad: 1 },
      { id: "500-p", ot: "500", planStatus: "PENDIENTE", prioridad: 2 },
    ],
    lastSchedule: { scheduledOts: ["400", "500"] },
  };
  const comparison = core.compareWorkOrderLite(state, [{ ot: "200", quantity: 20, builtQuantity: 0, pendingQuantity: 20 }]);
  const original = structuredClone(state);

  const result = core.applyConfirmedWorkOrderChanges(state, comparison, {
    acceptQuantityOts: [], removeClosedOts: ["400"], keepClosedOts: ["500"],
  });

  assert.deepEqual(state, original);
  assert.deepEqual(result.selectedOts, ["200", "500"]);
  assert.deepEqual(result.lockedOts, []);
  assert.deepEqual(result.lastSchedule.scheduledOts, ["500"]);
  assert.equal(result.operations.some((operation) => operation.id === "400-p"), false);
  assert.equal(result.operations.some((operation) => operation.id === "400-c"), true);
  assert.equal(result.workOrders.find((item) => item.ot === "200").quantity, 10);
  assert.ok(result.workOrders.some((item) => item.ot === "500"));
  assert.ok(result.workOrderSyncWarnings.some((warning) => warning.ot === "200" && warning.type === "QUANTITY_REJECTED"));
  assert.ok(result.workOrderSyncWarnings.some((warning) => warning.ot === "500" && warning.type === "CLOSED_KEPT"));
});

test("ganttOperationTiming separa minutos productivos y no operativos", () => {
  assert.deepEqual(structuredClone(core.ganttOperationTiming(20, new Date("2026-07-13T14:50:00"), new Date("2026-07-13T15:15:00"))), {
    productiveMinutes: 20,
    elapsedMinutes: 25,
    nonOperatingMinutes: 5,
  });
  assert.deepEqual(structuredClone(core.ganttOperationTiming(20, new Date("2026-07-17T16:50:00"), new Date("2026-07-20T07:10:00"))), {
    productiveMinutes: 20,
    elapsedMinutes: 3740,
    nonOperatingMinutes: 3720,
  });
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

test("la sincronizacion conserva en el borrador solo OTs que NetSuite sigue reportando abiertas", () => {
  const state = {
    selectedOts: ["100", "200"], lockedOts: ["100", "200"], expandedOts: ["100", "200"],
    lastSchedule: { scheduledOts: ["100", "200"] },
  };
  const next = core.pruneDraftToOpenWorkOrders(state, [{ ot: "200" }, { ot: "300" }]);
  assert.deepEqual(structuredClone(next.selectedOts), ["200"]);
  assert.deepEqual(structuredClone(next.lockedOts), ["200"]);
  assert.deepEqual(structuredClone(next.expandedOts), ["200"]);
  assert.deepEqual(structuredClone(next.lastSchedule.scheduledOts), ["200"]);
});

test("confirmar preparacion selecciona la OT y conserva su firma en una transicion", () => {
  const next = core.commitPreparedOtSelection({ selectedOts: [], preparedPlanningByOt: {} }, "1095", "machine=39");
  assert.deepEqual(structuredClone(next.selectedOts), ["1095"]);
  assert.equal(next.preparedPlanningByOt[1095], "machine=39");
});

test("la firma preparada es estable y cambia solamente con configuracion relevante", () => {
  const a = core.planningPreparationSignature({ ot: "1095", machine: "39", tool: "H1", kit: "", kitPending: true, operationVersion: "7|5459" });
  const b = core.planningPreparationSignature({ operationVersion: "7|5459", kitPending: true, kit: "", tool: "H1", machine: "39", ot: "1095" });
  const changed = core.planningPreparationSignature({ ot: "1095", machine: "40", tool: "H1", kit: "", kitPending: true, operationVersion: "7|5459" });
  assert.equal(a, b);
  assert.notEqual(a, changed);
});

test("la instantanea draft contiene solo seleccion pendiente programada", () => {
  const snapshot = core.buildDraftSnapshot({ selectedOts: ["100"], planStart: "2026-07-13", operations: [
    { id: "ok", ot: "100", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "07:10", planStatus: "PENDIENTE" },
    { id: "done", ot: "100", fechaInicio: "2026-07-13", horaInicio: "07:10", fechaFin: "2026-07-13", horaFin: "07:20", planStatus: "COMPLETADA_PLAN" },
    { id: "backlog", ot: "200", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "07:10" },
  ] }, "2026-07-13T07:00:00Z");
  assert.equal(snapshot.snapshotId, "draft");
  assert.deepEqual(structuredClone(snapshot.operations.map((op) => op.id)), ["ok"]);
});

test("reconcilia un publicado con el estado vigente sin revivir datos obsoletos", () => {
  const snapshot = { fullState: {
    selectedOts: ["100", "200"],
    otConfigurations: {
      100: { machine: "PUBLICADA", herramental: "H-PUB", kitHerramental: "K-PUB", subcontractType: "CROMADO" },
      200: { machine: "CERRADA" },
    },
    operations: [
      { id: "pub-cut", ot: "100", secuencia: 10, ct: "CORTE", maquina: "PUBLICADA", herramental: "H-PUB", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
      { id: "pub-old", ot: "100", secuencia: 20, ct: "SOLDADURA", fechaInicio: "2026-07-13", horaInicio: "08:00", fechaFin: "2026-07-13", horaFin: "09:00" },
      { id: "pub-tool", ot: "100", secuencia: 0, ct: "TOOL_CHANGE", tipoInsercion: "CAMBIO_HERRAMENTAL", generatedBy: "PLANNER_CORE_V2" },
      { id: "pub-closed", ot: "200", secuencia: 10, ct: "CORTE", fechaInicio: "2026-07-13", horaInicio: "09:00", fechaFin: "2026-07-13", horaFin: "10:00" },
    ],
  } };
  const current = {
    selectedOts: ["999"],
    workOrders: [
      { ot: "100", status: "ABIERTA", exists: true },
      { ot: "200", status: "CERRADA", exists: true },
    ],
    otConfigurations: { 100: { machine: "ACTUAL", herramental: "H-ACT", kitHerramental: "", subcontractType: "" } },
    operations: [
      { id: "current-cut", ot: "100", secuencia: 10, ct: "CORTE", maquina: "ACTUAL", herramental: "H-ACT", planStatus: "COMPLETADA_PLAN", completedAt: "2026-07-13T08:02:00Z" },
      { id: "current-new", ot: "100", secuencia: 30, ct: "PINTURA", fechaInicio: "2026-07-14", horaInicio: "07:00", fechaFin: "2026-07-14", horaFin: "08:00" },
      { id: "other", ot: "999", secuencia: 1, ct: "CORTE" },
    ],
  };

  const result = core.reconcilePublishedPlan(snapshot, current);
  assert.deepEqual(structuredClone(result.summary), {
    restoredOts: 1, closedOts: 1, completedOperations: 1,
    removedOperations: 1, newOperations: 1, preservedConfigurations: 1,
  });
  assert.deepEqual(structuredClone(result.state.selectedOts), ["100"]);
  assert.deepEqual(structuredClone(result.state.operations.map((op) => op.id)), ["current-cut", "current-new", "other"]);
  assert.equal(result.state.operations[0].planStatus, "COMPLETADA_PLAN");
  assert.equal(result.state.operations[0].completedAt, "2026-07-13T08:02:00Z");
  assert.equal(result.state.operations[1].planStatus, "PENDIENTE");
  assert.equal(result.state.operations[1].fechaInicio, "");
  assert.deepEqual(structuredClone(result.state.otConfigurations[100]), {
    machine: "ACTUAL", herramental: "H-ACT", kitHerramental: "K-PUB", subcontractType: "CROMADO",
  });
});

test("cambiar herramental en una tarjeta actualiza solo sus operaciones de doblado", () => {
  const operations = [
    { id: "bend", ot: "100", ct: "5459", herramental: "H1" },
    { id: "cut", ot: "100", ct: "5458", herramental: "" },
    { id: "other", ot: "200", ct: "5459", herramental: "H3" },
  ];
  const next = core.applyDraftToolSelection(operations, "100", "H2", ["5459", "5527"]);
  assert.deepEqual(structuredClone(next.map((op) => [op.id, op.herramental])), [["bend", "H2"], ["cut", ""], ["other", "H3"]]);
  assert.equal(operations[0].herramental, "H1");
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

test("PLANDATA prevalece sobre una copia local coherente pero obsoleta", () => {
  const local = { revision: 99, selectedOts: ["100"], workOrders: [{ ot: "100" }], operations: [{ ot: "100" }] };
  const remote = { revision: 10, selectedOts: [], workOrders: [{ ot: "200" }], operations: [] };
  assert.equal(core.selectAuthoritativeRemoteDraft(local, remote), remote);
  assert.equal(core.selectAuthoritativeRemoteDraft(local, { selectedOts: ["X"], workOrders: [], operations: [] }), local);
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

test("detecta un backend anterior que no permite guardar la instantanea del borrador", () => {
  assert.equal(core.isUnsupportedDraftSnapshotError(new Error("Metodo no permitido: saveDraftSnapshot")), true);
  assert.equal(core.isUnsupportedDraftSnapshotError(new Error("Tiempo agotado al ejecutar saveDraftSnapshot")), false);
});

test("clasifica el tipo de trabajo para resaltado semanal", () => {
  assert.equal(core.weeklyPlanningTypeClass("PROTOTIPO"), "weekly-row--prototype");
  assert.equal(core.weeklyPlanningTypeClass("EXPEDITADO"), "weekly-row--expedited");
  assert.equal(core.weeklyPlanningTypeClass("NORMAL"), "");
});
