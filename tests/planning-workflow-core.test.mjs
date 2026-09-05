import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const source = await readFile(path.resolve("src/web/planning/planning-workflow-core.js"), "utf8");
const context = { globalThis: {}, setTimeout, clearTimeout };
vm.runInNewContext(source, context, { filename: "planning-workflow-core.js" });
const core = context.globalThis.PlanningWorkflowCore;

test("normaliza el inicio semanal y elige publicado o borrador como base incremental", () => {
  assert.equal(core.mondayIso("2026-07-23"), "2026-07-20");
  const draft = { snapshotId: "draft", planStart: "2026-07-20" };
  const snapshots = [
    { snapshotId: "pub-v1", status: "PUBLICADO", planStart: "2026-07-20", publishedAt: "2026-07-20T09:00:00Z" },
    { snapshotId: "pub-v2", status: "PUBLICADO", planStart: "2026-07-21", publishedAt: "2026-07-20T10:00:00Z" },
    { snapshotId: "other", status: "PUBLICADO", planStart: "2026-07-27", publishedAt: "2026-07-27T10:00:00Z" },
  ];
  assert.equal(core.selectIncrementalBase(snapshots, "2026-07-20", draft).snapshotId, "pub-v2");
  assert.equal(core.selectIncrementalBase([], "2026-07-20", draft).snapshotId, "draft");
});

test("detecta OTs agregadas modificadas y retiradas del alcance incremental", () => {
  const base = {
    selectedOts: ["1325", "2159"],
    workOrders: [{ id: "1325", pendingQuantity: 30 }, { id: "2159", pendingQuantity: 35 }],
    otConfigurations: { "2159": { priority: 2, machine: "211", tool: "4 x 5" } },
  };
  const current = {
    selectedOts: ["2159", "2436"],
    workOrders: [{ id: "2159", pendingQuantity: 40 }, { id: "2436", pendingQuantity: 48 }],
    otConfigurations: { "2159": { priority: 2, machine: "211", tool: "4 x 5" } },
  };
  const scope = structuredClone(core.incrementalScope({ base, current, weekStart: "2026-07-23" }));
  assert.deepEqual(scope.addedOts, ["2436"]);
  assert.deepEqual(scope.changedOts, ["2159"]);
  assert.deepEqual(scope.removedOts, ["1325"]);
  assert.deepEqual(scope.affectedOts, ["1325", "2159", "2436"]);
  assert.equal(scope.weekStart, "2026-07-20");
});

test("versiona por semana y resume solamente cambios compactos", () => {
  const versions = [
    { weekStart: "2026-07-20", version: 1 },
    { planStart: "2026-07-22", version: 2 },
    { weekStart: "2026-07-27", version: 5 },
  ];
  assert.equal(core.nextWeeklyVersion(versions, "2026-07-24"), 3);
  assert.equal(core.nextWeeklyVersion(versions, "2026-08-03"), 1);
  const previous = {
    selectedOts: ["1", "2"], workOrders: [{ ot: "1", pendingQuantity: 10 }, { ot: "2", pendingQuantity: 20 }],
    otConfigurations: { "2": { machine: "M1", operator: "OP1" } },
  };
  const next = {
    selectedOts: ["2", "3"], workOrders: [{ ot: "2", pendingQuantity: 25 }, { ot: "3", pendingQuantity: 5 }],
    otConfigurations: { "2": { machine: "M2", operator: "OP2" } },
  };
  const diff = structuredClone(core.compactVersionDiff(previous, next));
  assert.deepEqual(diff.addedOts, ["3"]);
  assert.deepEqual(diff.removedOts, ["1"]);
  assert.deepEqual(diff.changedOts, [{ ot: "2", fields: ["cantidad", "maquina"] }]);
  assert.doesNotMatch(JSON.stringify(diff), /operador|carga|complet/i);
});

test("identifica el plan publicado por semana y version consecutiva", () => {
  assert.equal(core.weeklyPlanIdentifier("2026-08-24", 1), "24/08/2026");
  assert.equal(core.weeklyPlanIdentifier("2026-08-24", 2), "24/08/2026 version 1");
  assert.equal(core.weeklyPlanIdentifier("2026-08-24", 3), "24/08/2026 version 2");
  assert.equal(core.weeklyPlanIdentifier("2026-08-24", 0), "24/08/2026");
  assert.equal(core.weeklyPlanIdentifier("", 2), "sin inicio");
});

test("cargas historicas permiten pendiente completada y original", () => {
  const snapshot = { operations: [
    { ot: "1", secuencia: 1, ct: "A", planStatus: "PENDIENTE", fechaInicio: "2026-07-20" },
    { ot: "1", secuencia: 2, ct: "B", planStatus: "PENDIENTE", fechaInicio: "2026-07-21" },
  ] };
  const overlay = [{ ot: "1", secuencia: 1, ct: "A", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-07-15" }];
  assert.deepEqual(core.loadOperationsForMode(snapshot, overlay, "pending").map((op) => op.secuencia), [2]);
  assert.deepEqual(core.loadOperationsForMode(snapshot, overlay, "completed").map((op) => op.secuencia), [1]);
  const original = core.loadOperationsForMode(snapshot, overlay, "original");
  assert.deepEqual(original.map((op) => op.secuencia), [1, 2]);
  assert.equal(original[0].fechaInicio, "2026-07-20");
});

test("withTimeout resuelve la promesa y rechaza al vencer el limite", async () => {
  assert.equal(await core.withTimeout(Promise.resolve("ok"), 15), "ok");
  await assert.rejects(core.withTimeout(new Promise(() => {}), 15), /0\.015 segundos/);
});

test("hasPlanningData exige operaciones de las OTs solicitadas", () => {
  assert.equal(core.hasPlanningData({ operations: [{ ot: "1325", descripcion: "CORTE" }] }, ["1325"]), true);
  assert.equal(core.hasPlanningData({ operations: [] }, ["1325"]), false);
  assert.equal(core.hasPlanningData({ operations: [{ ot: "999" }] }, ["1325"]), false);
});

test("planningDataAvailability separa OTs frescas, vencidas y sin datos por vigencia", () => {
  const now = Date.now();
  const recent = new Date(now - 60 * 60 * 1000).toISOString();
  const old = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  const state = {
    operations: [{ ot: "FRESCA" }, { ot: "VENcida" }, { ot: "RARA" }],
    operationsSyncedAt: { FRESCA: recent, VENCIDA: old },
  };
  const result = core.planningDataAvailability(state, ["FRESCA", "VENCIDA", "SIN-DATA"], 24 * 60 * 60 * 1000);
  assert.deepEqual([...result.availableOts], ["FRESCA"]);
  assert.deepEqual([...result.missingOts], ["SIN-DATA"]);
  assert.deepEqual([...result.staleOts], ["VENCIDA"]);
});

test("markPlanningOtSynced registra el timestamp por OT sin tocar las demas", () => {
  const before = { operations: [{ ot: "1" }], operationsSyncedAt: { "2": "2026-01-01T00:00:00Z" } };
  const stamped = core.markPlanningOtSynced(before, "1", "2026-08-01T00:00:00Z");
  assert.equal(core.planningOtSyncedAt(stamped, "1"), Date.parse("2026-08-01T00:00:00Z"));
  assert.equal(core.planningOtSyncedAt(stamped, "2"), Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(core.planningOtSyncedAt(stamped, "3"), 0);
});

test("prepareDraftForReschedule limpia solo el borrador movible seleccionado, no muta y descarta completadas", () => {
  const movable = {
    id: "movable", ot: "1325", fechaInicio: "2026-07-01", horaInicio: "08:00",
    fechaFin: "2026-07-01", horaFin: "10:00", operador: "OP 1", maquina: "M1",
    herramental: "H1", kitHerramental: "K1", needsReschedule: true,
    estatus: "PLAN", planStatus: "PENDIENTE",
  };
  const completed = { ...movable, id: "completed", planStatus: "COMPLETADA_PLAN" };
  const markedLockedOnly = { ...movable, id: "marked-locked-only", locked: true, fechaInicio: "2026-06-27" };
  const otherOt = { ...movable, id: "other", ot: "999" };
  const historical = { ...movable, id: "historical", historical: true };
  const lockedByOt = { ...movable, id: "locked-by-ot", ot: "200", fechaInicio: "2026-06-28" };
  const programmed = { ...movable, id: "programmed", estatus: "PROGRAMADA", fechaInicio: "2026-06-29" };
  const frozen = { ...movable, id: "frozen", autoFrozen: true, fechaInicio: "2026-06-30" };
  const state = { selectedOts: ["1325", "200"], lockedOts: ["200"], operations: [movable, completed, markedLockedOnly, otherOt, historical, lockedByOt, programmed, frozen] };
  const original = structuredClone(state);

  const result = core.prepareDraftForReschedule(state, ["1325", "200"]);

  assert.deepEqual(state, original);
  assert.notEqual(result, state);
  assert.notEqual(result.operations, state.operations);
  assert.deepEqual(structuredClone(result.operations.map((operation) => operation.id)),
    ["movable", "marked-locked-only", "other", "historical", "locked-by-ot", "programmed", "frozen"]);
  assert.equal(result.operations.some((operation) => operation.id === "completed"), false);
  assert.deepEqual(structuredClone(result.operations[0]), {
    ...movable,
    fechaInicio: "", horaInicio: "", fechaFin: "", horaFin: "",
    operador: "",
    needsReschedule: false, autoFrozen: false, estatus: "PLAN", planStatus: "PENDIENTE",
  });
  assert.deepEqual(structuredClone(result.operations.slice(2, 5)), original.operations.slice(3, 6));
  assert.deepEqual(structuredClone([result.operations[1], ...result.operations.slice(5)]), [
    markedLockedOnly, programmed, frozen,
  ].map((operation) => ({
    ...operation,
    fechaInicio: "", horaInicio: "", fechaFin: "", horaFin: "",
    operador: "",
    needsReschedule: false, autoFrozen: false, estatus: "PLAN", planStatus: "PENDIENTE",
  })));
});

test("prepareDraftForReschedule reprograma OT bloqueada SIN operaciones con programa (se limpian fechas)", () => {
  const undated = { id: "undated", ot: "200", secuencia: 1, estatus: "PLAN", planStatus: "PENDIENTE", operador: "OP 1" };
  const partial = { id: "partial", ot: "200", secuencia: 2, estatus: "PLAN", planStatus: "PENDIENTE", fechaInicio: "2026-06-28" };
  const completed = { id: "done", ot: "200", secuencia: 1, planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-06-27", horaInicio: "08:00", fechaFin: "2026-06-27", horaFin: "09:00" };
  const state = { selectedOts: ["200"], lockedOts: ["200"], operations: [undated, partial, completed] };
  const original = structuredClone(state);

  const result = core.prepareDraftForReschedule(state, ["200"]);

  assert.deepEqual(state, original);
  const byId = Object.fromEntries(result.operations.map((operation) => [operation.id, operation]));
  assert.equal(byId.done, undefined);
  assert.equal(byId.undated.fechaInicio, "");
  assert.equal(byId.undated.horaInicio, "");
  assert.equal(byId.undated.fechaFin, "");
  assert.equal(byId.undated.horaFin, "");
  assert.equal(byId.undated.operador, "");
  assert.equal(byId.undated.estatus, "PLAN");
  assert.equal(byId.undated.planStatus, "PENDIENTE");
  assert.equal(byId.partial.fechaInicio, "");
});

test("prepareDraftForReschedule conserva OT bloqueada que SI tiene operacion con programa completo", () => {
  const dated = { id: "dated", ot: "200", secuencia: 1, estatus: "PLAN", planStatus: "PENDIENTE", operador: "OP 1", fechaInicio: "2026-06-28", horaInicio: "08:00", fechaFin: "2026-06-28", horaFin: "10:00" };
  const pending = { id: "pending", ot: "200", secuencia: 2, estatus: "PLAN", planStatus: "PENDIENTE" };
  const state = { selectedOts: ["200"], lockedOts: ["200"], operations: [dated, pending] };

  const result = core.prepareDraftForReschedule(state, ["200"]);

  const byId = Object.fromEntries(result.operations.map((operation) => [operation.id, operation]));
  assert.equal(byId.dated.fechaInicio, "2026-06-28");
  assert.equal(byId.dated.horaFin, "10:00");
  assert.equal(byId.pending.fechaInicio, undefined);
  assert.equal(byId.pending.estatus, "PLAN");
});

test("buildDraftSnapshot conserva el INICIO exacto y agrega identidad semanal de lunes", () => {
  const snapshot = core.buildDraftSnapshot({
    planStart: "2026-08-13",
    selectedOts: ["100"],
    operations: [{ id: "op-1", ot: "100", secuencia: 1, ct: "100", fechaInicio: "2026-08-13", horaInicio: "07:00", fechaFin: "2026-08-13", horaFin: "08:00" }],
  }, "2026-08-13T12:00:00Z");

  assert.equal(snapshot.planStart, "2026-08-13");
  assert.equal(snapshot.weekStart, "2026-08-10");
});

test("filterOperationsByPlanStatus filtra pendientes, completadas y todas", () => {
  const pending = { id: "p", planStatus: "PENDIENTE" };
  const completed = { id: "c", planStatus: "COMPLETADA_PLAN" };
  const rows = [pending, completed];
  assert.deepEqual(core.filterOperationsByPlanStatus(rows, "PENDIENTES"), [pending]);
  assert.deepEqual(core.filterOperationsByPlanStatus(rows, "COMPLETADAS"), [completed]);
  assert.deepEqual(core.filterOperationsByPlanStatus(rows, "TODAS"), rows);
});

test("draftExportOperations usa lastSchedule.scheduledOts como alcance del borrador actual", () => {
  const scheduled = { id: "scheduled", ot: "100", planStatus: "PENDIENTE", fechaInicio: "2026-08-17", fechaFin: "2026-08-17" };
  const staleSelected = { id: "stale", ot: "200", planStatus: "PENDIENTE", fechaInicio: "2026-08-17", fechaFin: "2026-08-17" };
  const completed = { id: "completed", ot: "100", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-08-17", fechaFin: "2026-08-17" };
  const historical = { id: "historical", ot: "100", planStatus: "PUBLICADO", fechaInicio: "2026-08-17", fechaFin: "2026-08-17" };
  const missingDates = { id: "missing-dates", ot: "100", planStatus: "PENDIENTE", fechaInicio: "2026-08-17", fechaFin: "" };

  const exported = core.draftExportOperations({
    selectedOts: ["100", "200"],
    lastSchedule: { scheduledOts: ["100"] },
    operations: [scheduled, staleSelected, completed, historical, missingDates],
  });

  assert.deepEqual(exported.map((operation) => operation.id), ["scheduled"]);
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

test("schedulingSelectedOts conserva bloqueadas y excluye solo CLOSED_KEPT", () => {
  assert.deepEqual(core.schedulingSelectedOts({
    selectedOts: ["100", "200", "300"],
    operations: [{ ot: "200", locked: true }],
    workOrderSyncWarnings: [{ ot: "300", type: "CLOSED_KEPT" }, { ot: "100", type: "QUANTITY_REJECTED" }],
  }), ["100", "200"]);
});

test("schedulingSelectedOts excluye las OTs cerradas indicadas sin tocar bloqueadas", () => {
  assert.deepEqual(core.schedulingSelectedOts({
    selectedOts: ["100", "200", "300"],
    operations: [{ ot: "100", locked: true }],
    workOrderSyncWarnings: [{ ot: "300", type: "CLOSED_KEPT" }],
  }, ["200", "CERRADA_FANTASMA"]), ["100"]);
  assert.deepEqual(core.schedulingSelectedOts({
    selectedOts: ["100", "200"],
  }, []), ["100", "200"]);
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
  const operation = { id: "op-1", ot: "1325", locked: true, fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00", operador: "OP1", autoFrozen: true };
  const state = {
    selectedOts: ["1325", "1400"], lockedOts: ["1325"], expandedOts: ["1325"],
    operations: [operation], lastSchedule: { scheduledOts: ["1325", "1400"] },
    selectedDetailOt: "1325", selectedOperationId: "op-1", draftVersionId: "draft-old",
    _pendingAddOt: "1325", _pendingAddOtSnapshot: ["1325", "1400"],
    planningConfigByOt: { 1325: { subcontractDays: 15 } }, preparedPlanningByOt: { 1325: "firma" },
  };
  const result = core.removeOtFromDraft(state, "1325");
  assert.deepEqual(result.selectedOts, ["1400"]);
  assert.deepEqual(result.lockedOts, []);
  assert.deepEqual(result.lastSchedule.scheduledOts, ["1400"]);
  assert.equal(result.operations.length, 1);
  assert.equal(result.operations[0].locked, false);
  assert.equal(result.operations[0].fechaInicio, "");
  assert.equal(result.operations[0].horaInicio, "");
  assert.equal(result.operations[0].fechaFin, "");
  assert.equal(result.operations[0].horaFin, "");
  assert.equal(result.operations[0].operador, "");
  assert.equal(result.operations[0].autoFrozen, false);
  assert.equal(result.operations[0].needsReschedule, true);
  assert.equal(result.selectedDetailOt, "");
  assert.equal(result.selectedOperationId, "");
  assert.equal(result.draftVersionId, "");
  assert.equal(result._pendingAddOt, undefined);
  assert.deepEqual(result._pendingAddOtSnapshot, ["1400"]);
  assert.equal(result.planningConfigByOt[1325].subcontractDays, 15);
  assert.equal(result.preparedPlanningByOt[1325], undefined);
  assert.equal(core.isOtEligibleForDraft(result, "1325"), false);
});

test("retirar una OT conserva completadas e historicas pero no las deja seleccionadas", () => {
  const state = { selectedOts: ["1325"], lockedOts: ["1325"], lastSchedule: { scheduledOts: ["1325"] }, operations: [
    { id: "done", ot: "1325", locked: true, planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00" },
    { id: "hist", ot: "1325", locked: true, historical: true, fechaInicio: "2026-07-12", horaInicio: "07:00", fechaFin: "2026-07-12", horaFin: "08:00" },
  ] };

  const result = core.removeOtFromDraft(state, "1325");

  assert.deepEqual(structuredClone(result.selectedOts), []);
  assert.deepEqual(structuredClone(result.lastSchedule.scheduledOts), []);
  assert.equal(result.operations[0].fechaInicio, "2026-07-13");
  assert.equal(result.operations[0].locked, false);
  assert.equal(result.operations[1].fechaInicio, "2026-07-12");
  assert.equal(result.operations[1].locked, false);
  assert.deepEqual(structuredClone(core.draftScheduledOperations(result).map((op) => op.id)), []);
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

test("borrador vivo usa lastSchedule e incluye cambios de herramental generados", () => {
  const state = {
    selectedOts: ["100"],
    lastSchedule: { scheduledOts: ["200"] },
    operations: [
      { id: "selected-old", ot: "100", fechaInicio: "2026-08-10", fechaFin: "2026-08-10", planStatus: "PENDIENTE" },
      { id: "change", ot: "200", tipoInsercion: "CAMBIO_HERRAMENTAL", generatedBy: "PLANNER_CORE_V2", parte: "ART-200", herramental: "H2", kitHerramental: "", toolChangeToHerramental: "H2", fechaInicio: "2026-08-10", fechaFin: "2026-08-10", planStatus: "PENDIENTE" },
      { id: "bend", ot: "200", ct: "5459", fechaInicio: "2026-08-10", fechaFin: "2026-08-10", planStatus: "PENDIENTE" },
    ],
  };
  assert.deepEqual(structuredClone(core.draftScheduledOperations(state).map((op) => op.id)), ["change", "bend"]);
  assert.deepEqual(structuredClone(core.draftExportOperations(state).map((op) => op.id)), ["change", "bend"]);
  assert.equal(core.draftExportOperations(state)[0].parte, "ART-200");
  assert.equal(core.draftExportOperations(state)[0].herramental, "H2");
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

test("reconcileActiveWorkOrders retira una OT ausente y elimina todas sus operaciones con resumen compacto", () => {
  const state = {
    selectedOts: ["100", "200"], lockedOts: ["100", "200"], expandedOts: ["200"],
    lastSchedule: { scheduledOts: ["100", "200"] },
    workOrders: [
      { ot: "100", item: "ACTIVA", quantity: 4 },
      { ot: "200", item: "CERRADA", quantity: 7 },
    ],
    operations: [
      { id: "100-p", ot: "100", planStatus: "PENDIENTE" },
      { id: "200-p", ot: "200", planStatus: "PENDIENTE", fechaInicio: "2026-07-20", horaInicio: "10:00", fechaFin: "2026-07-20", horaFin: "12:00" },
      { id: "200-c", ot: "200", planStatus: "COMPLETADA_PLAN", fechaInicio: "2026-07-20", horaInicio: "07:00", fechaFin: "2026-07-20", horaFin: "09:00" },
    ],
    materials: [{ ot: "100" }, { ot: "200" }],
    otConfigurations: { 100: { machine: "A" }, 200: { machine: "B" } },
    planningConfigByOt: { 100: { priority: 1 }, 200: { priority: 2 } },
    preparedPlanningByOt: { 200: "obsolete" },
    operationPlanStatuses: {
      "200-p": { ot: "200", status: "PENDIENTE" },
      "200-c": { ot: "200", status: "COMPLETADA_PLAN" },
      "100-p": { ot: "100", status: "PENDIENTE" },
    },
    selectedDetailOt: "200", selectedOperationId: "200-p",
  };
  const original = structuredClone(state);

  const next = core.reconcileActiveWorkOrders(state, [{ ot: "100", item: "ACTIVA", quantity: 4, status: "ABIERTA" }], "2026-07-22T10:00:00Z");

  assert.deepEqual(state, original);
  assert.deepEqual(structuredClone(next.selectedOts), ["100"]);
  assert.deepEqual(structuredClone(next.lockedOts), ["100"]);
  assert.deepEqual(structuredClone(next.lastSchedule.scheduledOts), ["100"]);
  assert.deepEqual(structuredClone(next.workOrders.map((row) => row.ot)), ["100"]);
  assert.deepEqual(structuredClone(next.operations.map((row) => row.id)), ["100-p"]);
  assert.deepEqual(structuredClone(next.materials.map((row) => row.ot)), ["100"]);
  assert.deepEqual(structuredClone(next.otConfigurations), { 100: { machine: "A" } });
  assert.deepEqual(structuredClone(next.planningConfigByOt), { 100: { priority: 1 } });
  assert.equal(next.preparedPlanningByOt[200], undefined);
  assert.deepEqual(structuredClone(next.operationPlanStatuses), {
    "100-p": { ot: "100", status: "PENDIENTE" },
  });
  assert.equal(next.selectedDetailOt, "");
  assert.equal(next.selectedOperationId, "");
  assert.deepEqual(structuredClone(next.closedWorkOrderSummaries[200]), {
    ot: "200", item: "CERRADA", quantity: 7,
    scheduledStart: "2026-07-20T07:00:00Z", scheduledEnd: "2026-07-20T12:00:00Z",
    weekStart: "2026-07-20", finalStatus: "CERRADA", closedDetectedAt: "2026-07-22T10:00:00Z",
  });
});

test("reconcileActiveWorkOrders conserva la marca de cierre inicial", () => {
  const state = {
    workOrders: [{ ot: "200", item: "CERRADA", quantity: 7 }],
    closedWorkOrderSummaries: { 200: { ot: "200", item: "CERRADA", quantity: 7, scheduledStart: "", scheduledEnd: "", weekStart: "", finalStatus: "CERRADA", closedDetectedAt: "2026-07-20T10:00:00Z" } },
  };

  const next = core.reconcileActiveWorkOrders(state, [], "2026-07-22T10:00:00Z");

  assert.equal(next.closedWorkOrderSummaries[200].closedDetectedAt, "2026-07-20T10:00:00Z");
});

test("purgeClosedWorkOrderRetention conserva antes de cinco dias y elimina exactamente al quinto", () => {
  const state = {
    operations: [{ id: "closed", ot: "200", planStatus: "COMPLETADA_PLAN" }, { id: "active", ot: "100", planStatus: "PENDIENTE" }],
    operationPlanStatuses: {
      closed: { ot: "200", status: "COMPLETADA_PLAN" },
      active: { ot: "100", status: "PENDIENTE" },
    },
    selectedDetailOt: "", selectedOperationId: "closed",
    closedWorkOrderSummaries: { 200: { ot: "200", item: "CERRADA", quantity: 7, scheduledStart: "", scheduledEnd: "", weekStart: "", finalStatus: "CERRADA", closedDetectedAt: "2026-07-20T10:00:00Z" } },
  };

  const retained = core.purgeClosedWorkOrderRetention(state, "2026-07-25T09:59:59.999Z");
  const purged = core.purgeClosedWorkOrderRetention(state, "2026-07-25T10:00:00Z");

  assert.deepEqual(structuredClone(retained.operations.map((row) => row.id)), ["closed", "active"]);
  assert.deepEqual(structuredClone(retained.operationPlanStatuses), structuredClone(state.operationPlanStatuses));
  assert.deepEqual(structuredClone(purged.operations.map((row) => row.id)), ["active"]);
  assert.deepEqual(structuredClone(purged.operationPlanStatuses), { active: { ot: "100", status: "PENDIENTE" } });
  assert.equal(purged.selectedOperationId, "");
  assert.deepEqual(structuredClone(purged.closedWorkOrderSummaries), structuredClone(state.closedWorkOrderSummaries));
});

test("removeClosedWorkOrdersFromDraft elimina totalmente la OT cerrada y quita sus operaciones del estado", () => {
  const state = {
    selectedOts: ["100", "200"], lockedOts: ["200"], expandedOts: ["200"],
    lastSchedule: { scheduledOts: ["100", "200"] },
    workOrders: [
      { ot: "100", item: "ACTIVA", quantity: 4 },
      { ot: "200", item: "CERRADA", quantity: 7 },
    ],
    operations: [
      { id: "100-p", ot: "100", planStatus: "PENDIENTE" },
      { id: "200-p", ot: "200", planStatus: "PENDIENTE", fechaInicio: "2026-07-20", horaInicio: "10:00", fechaFin: "2026-07-20", horaFin: "12:00" },
    ],
    materials: [{ ot: "100" }, { ot: "200" }],
    otConfigurations: { 100: { machine: "A" }, 200: { machine: "B" } },
    planningConfigByOt: { 100: { priority: 1 }, 200: { priority: 2 } },
    preparedPlanningByOt: { 200: "obsolete" },
    operationPlanStatuses: {
      "200-p": { ot: "200", status: "PENDIENTE" },
      "100-p": { ot: "100", status: "PENDIENTE" },
    },
    selectedDetailOt: "200", selectedOperationId: "200-p",
  };
  const original = structuredClone(state);

  const next = core.removeClosedWorkOrdersFromDraft(state, ["200"], "2026-07-22T10:00:00Z");

  assert.deepEqual(state, original);
  assert.deepEqual(structuredClone(next.selectedOts), ["100"]);
  assert.deepEqual(structuredClone(next.lockedOts), []);
  assert.deepEqual(structuredClone(next.expandedOts), []);
  assert.deepEqual(structuredClone(next.lastSchedule.scheduledOts), ["100"]);
  assert.deepEqual(structuredClone(next.workOrders.map((row) => row.ot)), ["100"]);
  assert.deepEqual(structuredClone(next.operations.map((row) => row.id)), ["100-p"]);
  assert.deepEqual(structuredClone(next.materials.map((row) => row.ot)), ["100"]);
  assert.deepEqual(structuredClone(next.otConfigurations), { 100: { machine: "A" } });
  assert.deepEqual(structuredClone(next.planningConfigByOt), { 100: { priority: 1 } });
  assert.equal(next.preparedPlanningByOt[200], undefined);
  assert.deepEqual(structuredClone(next.operationPlanStatuses), {
    "100-p": { ot: "100", status: "PENDIENTE" },
  });
  assert.equal(next.selectedDetailOt, "");
  assert.equal(next.selectedOperationId, "");
  assert.deepEqual(structuredClone(next.closedWorkOrderSummaries[200]), {
    ot: "200", item: "CERRADA", quantity: 7,
    scheduledStart: "2026-07-20T10:00:00Z", scheduledEnd: "2026-07-20T12:00:00Z",
    weekStart: "2026-07-20", finalStatus: "CERRADA", closedDetectedAt: "2026-07-22T10:00:00Z",
  });
});

test("removeClosedWorkOrdersFromDraft no modifica el estado si no hay OTs cerradas", () => {
  const state = {
    selectedOts: ["100"], workOrders: [{ ot: "100" }],
    operations: [{ id: "100-p", ot: "100", planStatus: "PENDIENTE" }],
  };
  const next = core.removeClosedWorkOrdersFromDraft(state, [], "2026-07-22T10:00:00Z");
  assert.deepEqual(structuredClone(next.selectedOts), ["100"]);
  assert.deepEqual(structuredClone(next.operations), structuredClone(state.operations));
  assert.deepEqual(structuredClone(next.closedWorkOrderSummaries || {}), {});
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

test("la instantanea draft no persiste internos del motor (indices Map) que el JSON degradaria", () => {
  const snapshot = core.buildDraftSnapshot({
    selectedOts: ["100"],
    planStart: "2026-07-13",
    operations: [{ id: "ok", ot: "100", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "07:10", planStatus: "PENDIENTE" }],
    otConfigurations: { "100": { ot: "100", machine: "211" } },
    __otConfigurationIndex: new Map([["100", { machine: "211" }]]),
    __toolCatalogByPart: new Map(),
    __windowCache: new Map(),
    __performanceState: {},
  }, "2026-07-13T07:00:00Z");
  const keys = Object.keys(snapshot);
  assert.equal(keys.some((key) => key.startsWith("__")), false);
  assert.equal(snapshot.otConfigurations["100"].machine, "211");
  const roundTripped = typeof structuredClone === "function" ? structuredClone(JSON.parse(JSON.stringify(snapshot))) : snapshot;
  assert.equal(roundTripped.otConfigurations["100"].machine, "211");
});

test("incluye en Gantt por maquina solo doblados y cambios actuales programados con maquina", () => {
  const scheduled = { fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "08:00", maquina: "M1" };
  assert.equal(core.isMachineGanttOperation({ ...scheduled, ct: "5459", descripcion: "DOBLADO" }), true);
  assert.equal(core.isMachineGanttOperation({ ...scheduled, ot: "100", tipoInsercion: "CAMBIO_HERRAMENTAL", generatedBy: "PLANNER_CORE_V2", toolChangeFromHerramental: "H1", toolChangeToHerramental: "H2" }), true);
  assert.equal(core.isMachineGanttOperation({ ...scheduled, ct: "5458", descripcion: "CORTE" }), false);
  assert.equal(core.isMachineGanttOperation({ ...scheduled, ct: "5459", descripcion: "DOBLADO", maquina: "" }), false);
  assert.equal(core.isMachineGanttOperation({ ...scheduled, ct: "5459", descripcion: "DOBLADO", planStatus: "COMPLETADA_PLAN" }), false);
  assert.equal(core.isMachineGanttOperation({ ...scheduled, tipoInsercion: "CAMBIO_HERRAMENTAL", generatedBy: "LEGACY" }), false);
  assert.equal(core.isMachineGanttOperation({ ...scheduled, tipoInsercion: "CAMBIO_HERRAMENTAL", generatedBy: "PLANNER_CORE_V2", fechaInicio: "", horaInicio: "" }), false);
});

test("conserva dos OTs con herramientas distintas y su cambio en una misma maquina", () => {
  const scheduled = { ct: "5459", descripcion: "DOBLADO", maquina: "DOBLADORA 2", fechaInicio: "2026-07-13", fechaFin: "2026-07-13" };
  const operations = [
    { ...scheduled, id: "bend-a", ot: "100", herramental: "H1", horaInicio: "07:00", horaFin: "08:00" },
    { ...scheduled, id: "change", ot: "200", tipoInsercion: "CAMBIO_HERRAMENTAL", generatedBy: "PLANNER_CORE_V2", toolChangeFromHerramental: "H1", toolChangeToHerramental: "H2", horaInicio: "08:00", horaFin: "08:15" },
    { ...scheduled, id: "bend-b", ot: "200", herramental: "H2", horaInicio: "08:15", horaFin: "09:00" },
  ];
  assert.deepEqual(operations.filter(core.isMachineGanttOperation).map((op) => op.id), ["bend-a", "change", "bend-b"]);
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

test("retirar una OT limpia referencias que pueden rehidratar el borrador y conserva otras bloqueadas", () => {
  const state = {
    selectedOts: ["100", "200", "300"], lockedOts: ["200"], expandedOts: ["100", "200", "300"],
    lastSchedule: { scheduledOts: ["100", "200", "300"] },
    preparedPlanningByOt: { 100: "firma-100", 200: "firma-200" },
    operations: [{ id: "100-p", ot: "100", locked: false }, { id: "200-p", ot: "200", locked: true }],
  };

  const next = core.removeOtFromDraft(state, "100");

  assert.deepEqual(structuredClone(next.selectedOts), ["200", "300"]);
  assert.deepEqual(structuredClone(next.lockedOts), ["200"]);
  assert.deepEqual(structuredClone(next.expandedOts), ["200", "300"]);
  assert.deepEqual(structuredClone(next.lastSchedule.scheduledOts), ["200", "300"]);
  assert.equal(next.preparedPlanningByOt[100], undefined);
  assert.equal(next.preparedPlanningByOt[200], "firma-200");
});

test("cambiar herramental puede guardar herramentales adicionales simultaneos", () => {
  const operations = [
    { id: "bend", ot: "100", ct: "5459", herramental: "H1" },
    { id: "cut", ot: "100", ct: "5458", herramental: "" },
  ];
  const next = core.applyDraftToolSelection(operations, "100", "H2", ["5459", "5527"], ["H3", "H4"]);
  assert.deepEqual(structuredClone(next.map((op) => [op.id, op.herramental, op.additionalHerramentales || []])), [["bend", "H2", ["H3", "H4"]], ["cut", "", []]]);
});

test("cambiar herramental conserva maquina por herramental adicional", () => {
  const operations = [
    { id: "bend", ot: "100", ct: "5459", herramental: "H1" },
    { id: "cut", ot: "100", ct: "5458", herramental: "" },
  ];
  const extras = [{ herramental: "H3", machine: "212" }, "H4"];
  const next = core.applyDraftToolSelection(operations, "100", "H2", ["5459", "5527"], extras);
  assert.deepEqual(structuredClone(next.map((op) => [op.id, op.herramental, op.additionalHerramentales || []])), [["bend", "H2", extras], ["cut", "", []]]);
});

test("la preparacion es idempotente hasta que cambia su firma", () => {
  const state = { selectedOts: ["1325"], preparedPlanningByOt: { 1325: "firma-a" } };
  assert.equal(core.needsPlanningPreparation(state, "1325", "firma-a"), false);
  assert.equal(core.needsPlanningPreparation(state, "1325", "firma-b"), true);
  assert.equal(core.needsPlanningPreparation({ selectedOts: [] }, "1325", "firma-a"), false);
  const marked = core.markPlanningPrepared(state, "1325", "firma-b");
  assert.equal(marked.preparedPlanningByOt[1325], "firma-b");
});

test("una preparacion confirmada se reutiliza al volver a generar si no faltan datos", () => {
  const state = { selectedOts: ["2159"], preparedPlanningByOt: { 2159: "firma-confirmada" } };
  assert.equal(core.canReusePlanningPreparation(state, "2159", false), true);
  assert.equal(core.canReusePlanningPreparation(state, "2159", true), false);
  assert.equal(core.canReusePlanningPreparation({ selectedOts: ["2159"], preparedPlanningByOt: {} }, "2159", false), false);
});

test("la instantanea del borrador completa el herramental desde la configuracion de la OT", () => {
  const snapshot = core.buildDraftSnapshot({
    selectedOts: ["2159"],
    otConfigurations: { 2159: { machine: "211", herramental: "4 x 5", kitHerramental: "" } },
    operations: [{
      id: "bend-2159", ot: "2159", ct: "5459", descripcion: "DOBLEZ DE TUBERIA",
      maquina: "211", herramental: "", fechaInicio: "2026-07-14", horaInicio: "07:59",
      fechaFin: "2026-07-14", horaFin: "08:56", planStatus: "PENDIENTE",
    }],
  }, "2026-07-13T12:00:00Z");
  assert.equal(snapshot.operations[0].herramental, "4 x 5");
});

test("el detalle y la tarjeta resuelven el mismo herramental efectivo", () => {
  const job = { ot: "2159", parte: "C 490 UND", ops: [{ ct: "5459", herramental: "" }] };
  assert.equal(core.effectiveJobTool({
    otConfigurations: { 2159: { herramental: "4 x 5" } },
    toolCatalog: [{ part: "C 490 UND", herramental: "CATALOGO" }],
  }, job, ["5459", "5527"]), "4 x 5");
  assert.equal(core.effectiveJobTool({
    otConfigurations: { 2159: { herramental: "4 x 5", additionalHerramentales: [{ herramental: "7 x 8", machine: "212" }] } },
    toolCatalog: [{ part: "C 490 UND", herramental: "CATALOGO" }],
  }, job, ["5459", "5527"]), "4 x 5 + 7 x 8");
  assert.equal(core.effectiveJobTool({
    otConfigurations: {},
    toolCatalog: [{ part: "C 490 UND", herramental: "4 x 5" }],
  }, job, ["5459", "5527"]), "4 x 5");
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
    { snapshotId: "newer", publishedAt: "2026-07-12T13:00:00Z" },
  ], { operations: [] });
  assert.deepEqual(structuredClone(source), { type: "published", snapshotId: "newer" });
  assert.equal(core.isPublishedPlanSnapshot({ snapshotId: "published-at", publishedAt: "2026-07-12T13:00:00Z" }), true);
  assert.equal(core.isPublishedPlanSnapshot({ snapshotId: "saved", status: "GUARDADO" }), false);
  assert.deepEqual(structuredClone(core.operationalPlanOptions([
    { id: "saved", status: "GUARDADO" },
    { id: "published-at", publishedAt: "2026-07-12T13:00:00Z" },
  ])).map((item) => item.id), ["draft", "published-at"]);
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

test("selectReportRows incluye pendientes anteriores al dia seleccionado", () => {
  const rows = [
    { id: "anterior", fechaInicio: "2026-07-10", horaInicio: "08:00", planStatus: "PENDIENTE" },
    { id: "dia", fechaInicio: "2026-07-12", horaInicio: "08:00", planStatus: "PENDIENTE" },
    { id: "futuro", fechaInicio: "2026-07-14", horaInicio: "08:00", planStatus: "PENDIENTE" },
    { id: "fuera", fechaInicio: "2026-07-15", horaInicio: "08:00", planStatus: "PENDIENTE" },
  ];
  const selection = core.selectReportRows(rows, { startDate: "2026-07-12", futureDays: 2, status: "PENDIENTES", limit: 25 });
  assert.deepEqual(selection.rows.map((row) => row.id), ["anterior", "dia", "futuro"]);
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

test("weeklyFinishingCost cuenta una sola fila por OT normalizada", () => {
  assert.deepEqual(structuredClone(core.weeklyFinishingCost([
    { ot: " OT-10 ", pendingPieces: 4, amount: 80 },
    { ot: "ot-10", pendingPieces: 4, amount: 80 },
    { ot: "OT-11", pendingPieces: 6, amount: 120 },
  ])), { finishingPieces: 10, totalCost: 200, costPerPiece: 20 });
});

test("weeklyFinishingCost respeta monto y precio cero explicitos", () => {
  assert.deepEqual(structuredClone(core.weeklyFinishingCost([
    { ot: "1", pendingPieces: 5, amount: 0, unitPrice: 99 },
    { ot: "2", pendingPieces: 3, amount: "", unitPrice: 0 },
    { ot: "3", pendingPieces: 2, amount: null, unitPrice: 7 },
  ])), { finishingPieces: 10, totalCost: 14, costPerPiece: 1.4 });
});

test("weeklyFinishingCost devuelve costo por pieza cero cuando no hay piezas", () => {
  assert.deepEqual(structuredClone(core.weeklyFinishingCost([
    { ot: "1", pendingPieces: 0, amount: 25 },
  ])), { finishingPieces: 0, totalCost: 25, costPerPiece: 0 });
});

test("effectiveFinishingAmount muestra el fallback de precio cuando amount esta ausente", () => {
  assert.equal(core.effectiveFinishingAmount({ pendingPieces: 3, amount: null, unitPrice: 7 }), 21);
  assert.equal(core.effectiveFinishingAmount({ pendingPieces: 3, amount: 0, unitPrice: 7 }), 0);
});

test("weeklyFinishingCost sanitiza valores no finitos", () => {
  assert.deepEqual(structuredClone(core.weeklyFinishingCost([
    { ot: "1", pendingPieces: Infinity, amount: Infinity, unitPrice: Infinity },
    { ot: "2", pendingPieces: 2, amount: null, unitPrice: Infinity },
    { ot: "3", pendingPieces: "NaN", amount: "NaN", unitPrice: 8 },
  ])), { finishingPieces: 2, totalCost: 0, costPerPiece: 0 });
});

test("weeklyFinishingRowsByType deduplica globalmente y conserva el tipo del primer registro", () => {
  const rows = [
    { ot: " OT-1 ", jobType: "NORMAL", pendingPieces: 2, amount: null, unitPrice: 10 },
    { ot: "ot-1", jobType: "PROTOTIPO", pendingPieces: 2, amount: 999 },
    { ot: "OT-2", jobType: "PROTOTIPO", pendingPieces: 3, amount: 30 },
  ];
  const groups = structuredClone(core.weeklyFinishingRowsByType(rows));
  assert.deepEqual(groups, [
    { type: "PROTOTIPO", pieces: 3, amount: 30, costPerPiece: 10 },
    { type: "NORMAL", pieces: 2, amount: 20, costPerPiece: 10 },
  ]);
  assert.equal(groups.reduce((sum, group) => sum + group.amount, 0), core.weeklyFinishingCost(rows).totalCost);
});

test("effectiveFinishingAmount convierte en cero un producto desbordado", () => {
  assert.equal(core.effectiveFinishingAmount({ pendingPieces: 2, amount: null, unitPrice: Number.MAX_VALUE }), 0);
});

test("weeklyFinishingCost convierte en cero sumas y divisiones desbordadas", () => {
  assert.deepEqual(structuredClone(core.weeklyFinishingCost([
    { ot: "1", pendingPieces: 1, amount: Number.MAX_VALUE },
    { ot: "2", pendingPieces: 1, amount: Number.MAX_VALUE },
  ])), { finishingPieces: 2, totalCost: 0, costPerPiece: 0 });
  assert.deepEqual(structuredClone(core.weeklyFinishingCost([
    { ot: "3", pendingPieces: Number.MAX_VALUE, amount: 1 },
    { ot: "4", pendingPieces: Number.MAX_VALUE, amount: 1 },
  ])), { finishingPieces: 0, totalCost: 2, costPerPiece: 0 });
});

test("isOtLockedInState normaliza la OT contra lockedOts", () => {
  assert.equal(core.isOtLockedInState({ lockedOts: [" OT-100 ", "ot-2"] }, "ot-100"), true);
  assert.equal(core.isOtLockedInState({ lockedOts: ["ot-2"] }, "ot-100"), false);
  assert.equal(core.isOtLockedInState({}, "ot-100"), false);
});

test("otHasCompletedOperations y pendingOperationsForOt separan operaciones completadas", () => {
  const state = {
    operations: [
      { ot: "OT-1", secuencia: "10", ct: "M1", planStatus: "COMPLETADA_PLAN" },
      { ot: "OT-1", secuencia: "20", ct: "M2", planStatus: "PENDIENTE_PLAN", inicio: "2026-07-22T08:00:00Z" },
      { ot: "OT-1", secuencia: "30", ct: "M3", tipoInsercion: "CAMBIO_HERRAMENTAL", planStatus: "PENDIENTE_PLAN" },
      { ot: "OT-2", secuencia: "10", ct: "M1", planStatus: "PENDIENTE_PLAN" },
    ],
  };
  assert.equal(core.otHasCompletedOperations(state, "ot-1"), true);
  assert.equal(core.otHasCompletedOperations(state, "ot-2"), false);
  assert.deepEqual(structuredClone(core.pendingOperationsForOt(state, "OT-1").map((op) => op.secuencia)), ["20", "30"]);
});

test("operationsRouteSignature ordena y omite entradas sin secuencia o CT", () => {
  const signature = core.operationsRouteSignature([
    { ot: "OT-1", secuencia: "20", ct: "M2" },
    { ot: "OT-1", secuencia: "10", ct: "M1" },
    { ot: "OT-1", secuencia: " ", ct: "" },
    { ot: "OT-1", descripcion: "solo descripcion" },
  ]);
  assert.equal(signature, "10|M1\u001e20|M2");
});

test("classifySmartSyncChange clasifica solo OTs seleccionadas segun las reglas 1-3", () => {
  const state = {
    selectedOts: ["OT-1", "OT-2", "OT-3", "OT-4", "OT-5"],
    lockedOts: ["OT-3"],
    workOrders: [
      { ot: "OT-1", item: "PIEZA-A", quantity: 100 },
      { ot: "OT-2", item: "PIEZA-B", quantity: 200 },
      { ot: "OT-4", item: "PIEZA-D", quantity: 400 },
      { ot: "OT-5", item: "PIEZA-E", quantity: 500 },
    ],
    operations: [
      { ot: "OT-1", secuencia: "10", ct: "M1", planStatus: "PENDIENTE_PLAN" },
      { ot: "OT-2", secuencia: "10", ct: "M1", planStatus: "PENDIENTE_PLAN" },
      { ot: "OT-4", secuencia: "10", ct: "M1", planStatus: "COMPLETADA_PLAN" },
    ],
  };
  const incoming = [
    { ot: "OT-1", item: "PIEZA-A", quantity: 100 },
    { ot: "OT-2", item: "PIEZA-B", quantity: 210 },
    { ot: "OT-3", item: "PIEZA-C", quantity: 300 },
    { ot: "OT-4", item: "PIEZA-D", quantity: 400 },
    { ot: "OT-5", item: "PIEZA-E", quantity: 500 },
    { ot: "NO-SELECCIONADA", item: "X", quantity: 1 },
  ];
  const result = core.classifySmartSyncChange(state, incoming);
  assert.equal(result.byOt["OT-1"].decision, "update_candidate");
  assert.equal(result.byOt["OT-2"].decision, "review_changed");
  assert.equal(result.byOt["OT-3"].decision, "blocked");
  assert.equal(result.byOt["OT-4"].decision, "review_completed");
  assert.equal(result.byOt["OT-5"].decision, "review_unstable");
  assert.equal(result.byOt["NO-SELECCIONADA"], undefined);
  assert.deepEqual(structuredClone(result.updateCandidates.map((record) => record.ot)), ["OT-1"]);
  assert.deepEqual(structuredClone(result.counts), {
    unchanged: 0, updated: 0, reviewChanged: 1, reviewCompleted: 1, blocked: 1, reviewUnstable: 1,
  });
});

test("classifySmartSyncChange considera item cambiado como revision y estructura estable como candidata", () => {
  const state = {
    selectedOts: ["OT-A", "OT-B"],
    workOrders: [{ ot: "OT-A", item: "PIEZA-1", quantity: 10 }],
    operations: [{ ot: "OT-A", secuencia: "10", ct: "M1", planStatus: "PENDIENTE_PLAN" }],
  };
  const incoming = [
    { ot: "OT-A", item: "PIEZA-2", quantity: 10 },
    { ot: "OT-B", item: "PIEZA-3", quantity: 30 },
  ];
  const result = core.classifySmartSyncChange(state, incoming);
  assert.equal(result.byOt["OT-A"].decision, "review_changed");
  assert.equal(result.byOt["OT-B"].decision, "review_unstable");
});

test("finalizeSmartSyncSummary suma actualizadas y sin cambios de los refresh results", () => {
  const classification = {
    counts: { unchanged: 0, updated: 0, reviewChanged: 1, reviewCompleted: 1, blocked: 1, reviewUnstable: 1 },
    updateCandidates: [
      { ot: "OT-1", decision: "update_candidate" },
      { ot: "OT-2", decision: "update_candidate" },
      { ot: "OT-3", decision: "update_candidate" },
    ],
  };
  const refreshResults = {
    "OT-1": { changed: true, skipped: false },
    "OT-2": { changed: false, skipped: false },
    "OT-3": { changed: false, skipped: true },
  };
  const counts = core.finalizeSmartSyncSummary(classification, refreshResults);
  assert.deepEqual(structuredClone(counts), {
    unchanged: 2, updated: 1, reviewChanged: 1, reviewCompleted: 1, blocked: 1, reviewUnstable: 1,
  });
  assert.equal(core.smartSyncSummaryMessage(counts),
    "2 OTs sin cambios, 1 actualizadas, 2 con ruta/cantidad distinta (revisar), 1 bloqueadas, 1 con completadas");
});

test("mergeOtRouteOperation conserva campos locales y aplica campos de ruta remotos", () => {
  const existing = { ot: "OT-1", secuencia: "10", ct: "M1", tiempoCiclo: 3, tiempoSetup: 1, tiempoProd: 2, planStatus: "PENDIENTE_PLAN", tipoInsercion: "NORMAL" };
  const remote = { ot: "OT-1", secuencia: "10", ct: "M1", tiempoCiclo: 5, tiempoSetup: 2, tiempoProd: 1, secuenciaNueva: "ignorada" };
  const merged = core.mergeOtRouteOperation(remote, existing);
  assert.equal(merged.tiempoCiclo, 5);
  assert.equal(merged.planStatus, "PENDIENTE_PLAN");
  assert.equal(merged.secuenciaNueva, undefined);
});

test("mergeOtRouteOperations preserva completadas y CAMBIO_HERRAMENTAL y combina por secuencia/CT", () => {
  const existing = [
    { ot: "OT-1", secuencia: "10", ct: "M1", planStatus: "PENDIENTE_PLAN", tiempoCiclo: 3 },
    { ot: "OT-1", secuencia: "20", ct: "M2", planStatus: "COMPLETADA_PLAN", tiempoCiclo: 9 },
    { ot: "OT-1", secuencia: "30", ct: "M3", tipoInsercion: "CAMBIO_HERRAMENTAL", planStatus: "PENDIENTE_PLAN", tiempoCiclo: 1 },
  ];
  const remote = [
    { ot: "OT-1", secuencia: "10", ct: "M1", tiempoCiclo: 5 },
    { ot: "OT-1", secuencia: "20", ct: "M2", tiempoCiclo: 9 },
  ];
  const result = core.mergeOtRouteOperations(remote, existing);
  assert.equal(result.preserved.length, 2);
  assert.equal(result.merged.length, 2);
  const mergedBySequence = Object.fromEntries(result.merged.map((op) => [op.secuencia, op]));
  assert.equal(mergedBySequence["10"].tiempoCiclo, 5);
  assert.equal(mergedBySequence["10"].planStatus, "PENDIENTE_PLAN");
  assert.equal(mergedBySequence["20"].planStatus, "COMPLETADA_PLAN");
  assert.equal(mergedBySequence["20"].tiempoCiclo, 9);
  assert.ok(result.preserved.some((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL"));
});

test("operationsStartingInWeek cuenta operaciones que inician dentro de la semana de planStart", () => {
  const operations = [
    { ot: "3143", fechaInicio: "2026-08-28" },
    { ot: "2497", fechaInicio: "2026-08-30" },
    { ot: "2233", fechaInicio: "2026-09-02" },
    { ot: "3202", fechaInicio: "2026-09-29" },
    { ot: "3109", startDate: "2026-08-18" },
    { ot: "3350", fechaInicio: "" },
  ];
  assert.equal(core.operationsStartingInWeek(operations, "2026-08-28"), 2);
  assert.equal(core.operationsStartingInWeek(operations, "2026-08-24"), 2);
  assert.equal(core.operationsStartingInWeek(operations, "2026-08-17"), 1);
  assert.equal(core.operationsStartingInWeek({ operations }, "2026-08-24"), 2);
  assert.equal(core.operationsStartingInWeek({ fullState: { operations } }, "2026-08-24"), 2);
  assert.equal(core.operationsStartingInWeek({}, "2026-08-24"), 0);
  assert.equal(core.operationsStartingInWeek(operations, ""), 0);
});

test("incrementa desde todas las OTs seleccionadas cuando no hay base anclada a la semana", () => {
  const current = { selectedOts: ["2159", "2436"] };
  const scope = structuredClone(core.incrementalScope({ base: null, current, weekStart: "2026-08-24" }));
  assert.deepEqual(scope.affectedOts, ["2159", "2436"]);
  assert.equal(scope.addedOts.length, 2);
});

test("planAnchoredAt: base re-anclada a planStart se conserva como base incremental", () => {
  const anchored = [
    { ot: "3143", fechaInicio: "2026-08-28" },
    { ot: "2233", fechaInicio: "2026-08-30" },
    { ot: "3202", fechaInicio: "2026-09-29" },
  ];
  assert.equal(core.planAnchoredAt(anchored, "2026-08-28"), true);
  assert.equal(core.planAnchoredAt({ fullState: { operations: anchored } }, "2026-08-28"), true);
  assert.equal(core.planAnchoredAt({ operations: anchored }, "2026-08-28"), true);
});

test("planAnchoredAt: base sin ops en la semana de planStart NO esta anclada (reporte semanal vacio)", () => {
  const emptyWeek = [
    { ot: "3098", fechaInicio: "2026-08-17" },
    { ot: "3202", fechaInicio: "2026-09-29" },
    { ot: "3143", fechaInicio: "2027-05-20" },
  ];
  assert.equal(core.planAnchoredAt(emptyWeek, "2026-08-28"), false);
});

test("planAnchoredAt: ops movibles antes de la semana de planStart NO estan ancladas", () => {
  const beforePlanStart = [
    { ot: "3098", fechaInicio: "2026-08-18" },
    { ot: "3143", fechaInicio: "2026-08-28", horaInicio: "7:00" },
  ];
  assert.equal(core.planAnchoredAt(beforePlanStart, "2026-08-28"), false);
  assert.equal(core.planAnchoredAt({ fullState: { operations: beforePlanStart } }, "2026-08-28"), false);
});

test("planAnchoredAt: ops previas historicas/completadas/cerradas no rompen el anclaje", () => {
  const withPastFixed = [
    { ot: "3098", fechaInicio: "2026-08-10", planStatus: "COMPLETADA_PLAN" },
    { ot: "3099", fechaInicio: "2026-08-12", planStatus: "HISTORICO" },
    { ot: "3100", fechaInicio: "2026-08-14", locked: true },
    { ot: "3101", fechaInicio: "2026-08-15", autoFrozen: true },
    { ot: "3143", fechaInicio: "2026-08-28", horaInicio: "7:00" },
    { ot: "2233", fechaInicio: "2026-08-30" },
  ];
  assert.equal(core.planAnchoredAt(withPastFixed, "2026-08-28"), true);
});

test("planAnchoredAt: casos borde (vacio, sin planStart valido, array plano)", () => {
  assert.equal(core.planAnchoredAt([], "2026-08-28"), false);
  assert.equal(core.planAnchoredAt({}, "2026-08-28"), false);
  assert.equal(core.planAnchoredAt([{ ot: "3143", fechaInicio: "2026-08-28" }], ""), false);
});
