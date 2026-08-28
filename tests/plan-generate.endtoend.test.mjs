import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const plannerSource = await readFile(path.resolve("src/web/planning/planner-core.js"), "utf8");
const workflowSource = await readFile(path.resolve("src/web/planning/planning-workflow-core.js"), "utf8");

function loadPlannerCore() {
  const context = { globalThis: {} };
  vm.runInNewContext(plannerSource, context, { filename: "planner-core.js" });
  return context.globalThis.PlannerCore;
}

function loadWorkflowCore() {
  const context = { globalThis: {}, setTimeout, clearTimeout };
  vm.runInNewContext(workflowSource, context, { filename: "planning-workflow-core.js" });
  return context.globalThis.PlanningWorkflowCore;
}

const PLANNER = loadPlannerCore();
const WORKFLOW = loadWorkflowCore();

const PLAN_START = "2026-07-13";
const EXECUTION_TIME = "2026-07-13T07:00:00";
const NETSUITE_PLANNING_FRESH_MS = 24 * 60 * 60 * 1000;
const TOOL_CHANGE_KEY = "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL";

function norm(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function capabilityKey(ct, label) {
  return `${norm(ct).replace(/\s+/g, "_")}::${norm(label).replace(/\s+/g, "_")}`;
}

function buildDataset() {
  return {
    selectedOts: ["OT-1001", "OT-1002", "OT-1003", "OT-1004"],
    operations: [
      { id: "op-1001-10", ot: "OT-1001", secuencia: 10, ct: "100", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", prioridad: 1, cantidadPendiente: 40, tiempoCiclo: 0.5 },
      { id: "op-1001-20", ot: "OT-1001", secuencia: 20, ct: "5459", descripcion: "DOBLEZ", parte: "TUBO-SP", tipoInsercion: "OPERACION", estatus: "PLAN", prioridad: 1, cantidadPendiente: 40, tiempoCiclo: 2, maquina: "DOBLADORA 2", herramental: "H1", kitHerramental: "K1" },
      { id: "op-1002-10", ot: "OT-1002", secuencia: 10, ct: "100", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", prioridad: 2, cantidadPendiente: 30, tiempoCiclo: 0.5 },
      { id: "op-1002-20", ot: "OT-1002", secuencia: 20, ct: "5459", descripcion: "DOBLEZ", parte: "TUBO-RF", tipoInsercion: "OPERACION", estatus: "PLAN", prioridad: 2, cantidadPendiente: 30, tiempoCiclo: 2, maquina: "DOBLADORA 2", herramental: "H2", kitHerramental: "K2" },
      { id: "op-1003-10", ot: "OT-1003", secuencia: 10, ct: "300", descripcion: "PUNZONADO", tipoInsercion: "OPERACION", estatus: "PLAN", prioridad: 3, cantidadPendiente: 50, tiempoCiclo: 0.5 },
      { id: "op-1003-20", ot: "OT-1003", secuencia: 20, ct: "100", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", prioridad: 3, cantidadPendiente: 50, tiempoCiclo: 0.4 },
      { id: "op-1004-10", ot: "OT-1004", secuencia: 10, ct: "5459", descripcion: "DOBLEZ", parte: "DUCTO-VN", tipoInsercion: "OPERACION", estatus: "PLAN", prioridad: 4, cantidadPendiente: 10, tiempoCiclo: 3, maquina: "DOBLADORA 2", herramental: "H1", kitHerramental: "K1" },
    ],
    workOrders: [
      { ot: "OT-1001", id: "1001", status: "PLANIFICADA", pendingQuantity: 40, fechaEntrega: "2026-07-17" },
      { ot: "OT-1002", id: "1002", status: "PLANIFICADA", pendingQuantity: 30, fechaEntrega: "2026-07-17" },
      { ot: "OT-1003", id: "1003", status: "PLANIFICADA", pendingQuantity: 50, fechaEntrega: "2026-07-17" },
      { ot: "OT-1004", id: "1004", status: "PLANIFICADA", pendingQuantity: 10, fechaEntrega: "2026-07-17" },
    ],
    operators: ["OPERADOR 1", "OPERADOR 2", "OPERADOR 3", "AJUSTADOR"],
    operatorProfiles: {
      "OPERADOR 1": { name: "OPERADOR 1", category: "TD" },
      "OPERADOR 2": { name: "OPERADOR 2", category: "TD" },
      "OPERADOR 3": { name: "OPERADOR 3", category: "TD" },
      AJUSTADOR: { name: "AJUSTADOR", category: "FUERA_DE_PLAN" },
    },
    matrix: {
      "100::CORTE": ["OPERADOR 1", "OPERADOR 3"],
      "5459::DOBLEZ": ["OPERADOR 2"],
      "300::PUNZONADO": ["OPERADOR 3"],
      [TOOL_CHANGE_KEY]: ["AJUSTADOR"],
    },
    configuredCapabilities: ["100::CORTE", "5459::DOBLEZ", "300::PUNZONADO", TOOL_CHANGE_KEY],
    capacityModes: {
      "100::CORTE": "FINITA",
      "5459::DOBLEZ": "FINITA",
      "300::PUNZONADO": "FINITA",
      [TOOL_CHANGE_KEY]: "FINITA",
    },
    machines: [{ id: "DOBLADORA 2", machine: "DOBLADORA 2", active: true }],
    toolCatalog: [
      { part: "TUBO-SP", herramental: "H1", kitHerramental: "K1", toolSetupMinutes: 30, kitSetupMinutes: 20, active: true },
      { part: "TUBO-RF", herramental: "H2", kitHerramental: "K2", toolSetupMinutes: 30, kitSetupMinutes: 20, active: true },
      { part: "DUCTO-VN", herramental: "H1", kitHerramental: "K1", toolSetupMinutes: 30, kitSetupMinutes: 20, active: true },
    ],
    machineToolHistory: [
      { ot: "OT-1001", machine: "DOBLADORA 2", herramental: "H0", kitHerramental: "K0", completed: true, status: "COMPLETADA_PLAN", fechaFin: "2026-07-11", horaFin: "17:00", operationId: "hist-1001-20" },
    ],
    settings: {
      optimizationPasses: 2,
      toolChangeMinutes: 120,
      flowBalancedEnabled: true,
    },
    workSchedule: {
      MON: { enabled: true, start: "07:00", end: "17:00" },
      TUE: { enabled: true, start: "07:00", end: "17:00" },
      WED: { enabled: true, start: "07:00", end: "17:00" },
      THU: { enabled: true, start: "07:00", end: "17:00" },
      FRI: { enabled: true, start: "07:00", end: "17:00" },
      SAT: { enabled: false },
      SUN: { enabled: false },
    },
  };
}

const dataset = buildDataset();

const planResult = await PLANNER.schedulePlan(structuredClone(dataset), {
  planStart: PLAN_START,
  horizonDays: 5,
  executionTime: EXECUTION_TIME,
  respectPlanStart: true,
  collectStats: true,
  progressEveryMs: 0,
});

function scheduledPlanOperations() {
  return planResult.operations.filter((op) => op.planStatus === "PENDIENTE" && op.fechaInicio && op.fechaFin);
}

test("flujo e2e: generar plan no deja OTs sin programar y emite progreso coherente", async () => {
  const events = [];
  const progressResult = await PLANNER.schedulePlan(structuredClone(dataset), {
    planStart: PLAN_START,
    horizonDays: 5,
    executionTime: EXECUTION_TIME,
    respectPlanStart: true,
    collectStats: true,
    progressEveryMs: 1,
    timeBudgetMs: 0,
    onProgress: (event) => events.push(event),
  });

  assert.ok(events.length >= 1, "onProgress debe emitir al menos un evento");
  for (const event of events) {
    assert.equal(typeof event.scheduled, "number", "el evento debe llevar scheduled");
    assert.equal(typeof event.total, "number", "el evento debe llevar total");
    assert.ok(event.scheduled <= event.total, `scheduled ${event.scheduled} no debe superar total ${event.total} en ${event.phase}`);
    assert.ok(typeof event.phase === "string" && event.phase.length > 0, "el evento debe llevar fase");
  }
  assert.ok(events.some((event) => event.total > 0), "algún evento debe reportar total mayor a cero");

  assert.equal(progressResult.lastSchedule.unscheduled, 0);
  assert.equal(progressResult.planStart, PLAN_START);
  assert.equal(progressResult.lastSchedule.scheduled, 7);
});

test("flujo e2e: solo se re-sincronizan OTs viejas o sin datos de planeacion", () => {
  const now = Date.now();
  const availabilityState = {
    operations: dataset.operations,
    operationsSyncedAt: {
      "OT-1001": new Date(now - 60 * 60 * 1000).toISOString(),
      "OT-1002": new Date(now - 48 * 60 * 60 * 1000).toISOString(),
    },
  };
  const ots = ["OT-1001", "OT-1002", "OT-1003", "OT-1005"];

  const availability = WORKFLOW.planningDataAvailability(availabilityState, ots, NETSUITE_PLANNING_FRESH_MS);

  assert.deepEqual([...availability.availableOts], ["OT-1001"], "OT fresca con datos cargados no se re-sincroniza");
  assert.deepEqual([...availability.staleOts], ["OT-1002", "OT-1003"], "OT vieja o sin marca se actualiza");
  assert.deepEqual([...availability.missingOts], ["OT-1005"], "OT sin operaciones carga desde NetSuite");

  assert.deepEqual([...WORKFLOW.planningOtsWithData(availabilityState, ots)], ["OT-1001", "OT-1002", "OT-1003"]);
  assert.equal(WORKFLOW.planningOtSyncedAt(availabilityState, "OT-1001") > 0, true);
  assert.equal(WORKFLOW.planningOtSyncedAt(availabilityState, "OT-1003"), 0);
});

test("flujo e2e: toda operacion pendiente programada tiene operador existente", () => {
  const operatorSet = new Set(dataset.operators.map(norm));
  const scheduled = scheduledPlanOperations();

  assert.ok(scheduled.length >= 7, `deben programarse las 7 operaciones del dataset (hay ${scheduled.length})`);
  assert.equal(planResult.lastSchedule.unscheduled, 0, "ninguna operacion pendiente debe quedar fuera del plan");

  for (const op of scheduled) {
    assert.ok(op.operador, `la operacion ${op.id} debe quedar con operador asignado`);
    assert.notEqual(norm(op.operador), "SIN_OPERADOR", `la operacion ${op.id} no debe quedar sin operador`);
    assert.ok(operatorSet.has(norm(op.operador)), `el operador ${op.operador} de ${op.id} debe existir en state.operators`);
  }
});

test("flujo e2e: el operador asignado respeta la matriz de habilidades por CT", () => {
  const scheduled = scheduledPlanOperations().filter((op) => op.tipoInsercion !== "CAMBIO_HERRAMENTAL");
  const changes = planResult.operations.filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL");

  for (const op of scheduled) {
    const key = capabilityKey(op.ct, op.descripcion);
    const allowed = dataset.matrix[key] || dataset.matrix[op.ct] || [];
    assert.ok(
      allowed.some((name) => norm(name) === norm(op.operador)),
      `el operador ${op.operador} de ${op.id} (${key}) no esta habilitado en la matriz`,
    );
  }

  const adjusters = dataset.matrix[TOOL_CHANGE_KEY] || [];
  for (const change of changes) {
    assert.ok(
      adjusters.some((name) => norm(name) === norm(change.operador)),
      `el ajustador ${change.operador} del cambio ${change.id} no esta habilitado para TOOL_CHANGE`,
    );
  }

  assert.ok(
    !planResult.lastSchedule.diagnostics.some((item) => item.code === "OPERATOR_OVERLAP"),
    "el plan no debe reportar solapamiento de operadores",
  );
  assert.equal(planResult.lastSchedule.operatorConflicts, 0);

  const configIssues = PLANNER.planningConfigurationIssues(structuredClone(dataset), dataset.operations);
  assert.ok(
    !configIssues.some((issue) => issue.code === "MISSING_OPERATOR" || issue.code === "MISSING_CAPABILITY"),
    "la configuracion del dataset no debe listar operadores o capacidades faltantes",
  );
});

test("flujo e2e: se insertan cambios de herramental antes de la operacion que los requiere", () => {
  const changes = planResult.operations.filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL");
  const productive = planResult.operations.filter((op) => op.tipoInsercion === "OPERACION" && op.maquina === "DOBLADORA 2");

  assert.ok(changes.length >= 1, "debe generarse al menos un cambio de herramental");
  assert.ok(planResult.lastSchedule.changes >= 1);
  for (const change of changes) {
    assert.equal(change.generatedBy, PLANNER.GENERATED_BY, "el cambio lo genera el motor");
    assert.equal(change.maquina, "DOBLADORA 2", "el cambio ocurre en la maquina de la operacion");
    assert.equal(change.operador, "AJUSTADOR", "el cambio lo ejecuta el ajustador de la matriz");
    assert.ok(change.fechaInicio && change.fechaFin, "el cambio debe programarse con fecha");
  }

  const seeded = changes.find((change) =>
    change.toolChangeFromHerramental === "H0"
  );
  assert.ok(seeded, "debe existir el cambio que desmonta la herramienta H0 montada en la maquina");
  assert.equal(seeded.tiempoSetup, 50, "el cambio usa las reglas del catalogo: 30 min herramienta + 20 min kit");

  for (const change of changes) {
    const target = planResult.operations.find((op) =>
      op.tipoInsercion !== "CAMBIO_HERRAMENTAL" &&
      op.maquina === change.maquina &&
      op.fechaInicio === change.fechaFin &&
      op.horaInicio === change.horaFin
    );
    assert.ok(
      target && target.id !== change.id,
      `el cambio ${change.id} debe quedar contiguo antes de su operacion objetivo en la misma maquina`,
    );
    if (target) {
      assert.equal(target.herramental, change.toolChangeToHerramental, `el cambio ${change.id} monta el herramental de ${target.id}`);
      assert.equal(target.kitHerramental, change.toolChangeToKit, `el cambio ${change.id} monta el kit de ${target.id}`);
    }
  }

  assert.ok(
    productive.length >= 3,
    "las tres operaciones de doblez del dataset deben conservarse programadas",
  );
});

test("flujo e2e: el reporte semanal del plan generado queda lleno y cubre el plan", () => {
  const scheduled = scheduledPlanOperations();
  assert.ok(scheduled.length > 0, "el plan debe tener operaciones programadas para reportar");

  const withoutCoverage = WORKFLOW.reportCoverageIssues(scheduled);
  assert.deepEqual([...withoutCoverage], [], "todas las operaciones del plan deben caer en una sola categoria");
  for (const op of scheduled) {
    const category = WORKFLOW.classifyReportOperation(op);
    assert.ok(
      category === "operator" || category === "adjuster",
      `la operacion ${op.id} debe clasificar como operator o adjuster (fue ${category})`,
    );
  }

  const report = WORKFLOW.selectReportRows(planResult.operations, {
    startDate: planResult.planStart,
    futureDays: 5,
    status: "PENDIENTES",
    limit: 200,
  });

  assert.equal(report.range.start, PLAN_START);
  assert.ok(report.rows.length > 0, "el reporte semanal no puede quedar vacio");
  assert.equal(report.total, scheduled.length, "el reporte debe incluir todas las operaciones programadas del plan");
  assert.equal(report.rows.length, scheduled.length, "con limite alto el reporte no descarta filas");

  const expectedPerOt = new Map();
  for (const op of scheduled) expectedPerOt.set(norm(op.ot), (expectedPerOt.get(norm(op.ot)) || 0) + 1);
  const reportedPerOt = new Map();

  for (const row of report.rows) {
    const key = norm(row.ot);
    reportedPerOt.set(key, (reportedPerOt.get(key) || 0) + 1);
    assert.equal(row.planStatus, "PENDIENTE");
    assert.ok(row.fechaInicio && row.fechaFin, "cada fila del reporte conserva su ventana programada");
  }
  assert.deepEqual([...reportedPerOt.entries()].sort(), [...expectedPerOt.entries()].sort());

  const categorizedRows = report.rows.filter((row) => WORKFLOW.classifyReportOperation(row) === "operator");
  assert.ok(categorizedRows.length >= 7, "el reporte debe incluir las operaciones productivas del plan");
});