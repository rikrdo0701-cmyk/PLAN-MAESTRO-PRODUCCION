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

test("una sucesora nunca viola el fin real de un subcontrato fuera del horizonte", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [
      { id: "sub", ot: "1325", secuencia: 1, ct: "519", descripcion: "MAKA", tipoInsercion: "SUBCONTRATO", estatus: "PLAN" },
      { id: "prod", ot: "1325", secuencia: 2, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoCiclo: 1, cantidadPendiente: 1 },
    ],
    workOrders: [{ ot: "1325", item: "CCA 519 CM" }],
    otConfigurations: { 1325: { ot: "1325", subcontractType: "MAKA", subcontractDays: 15 } },
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    operationRules: { 519: { overlap: 0.25 } },
    settings: { optimizationPasses: 1, finiteCapacity: false },
    workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const subcontract = result.operations.find((item) => item.id === "sub");
  const successor = result.operations.find((item) => item.id === "prod");
  const subcontractEnd = new Date(`${subcontract.fechaFin}T${subcontract.horaFin}:00`);
  const successorStart = successor.fechaInicio && new Date(`${successor.fechaInicio}T${successor.horaInicio}:00`);
  assert.ok(subcontractEnd > new Date("2026-07-18T07:00:00"));
  assert.ok(successorStart, "el horizonte visual no debe impedir programar la sucesora");
  assert.ok(successorStart >= subcontractEnd, "un subcontrato exige precedencia completa aunque configure overlap menor a 1");
});

test("una completada conserva fechas y no consume capacidad pendiente", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [
      { id: "done", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", planStatus: "COMPLETADA_PLAN", operador: "OP 1", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "12:00", tiempoCiclo: 1, cantidadPendiente: 300 },
      { id: "pending", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", planStatus: "PENDIENTE", operador: "OP 1", tiempoSetup: 0, tiempoCiclo: 1, cantidadPendiente: 1 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const done = result.operations.find((item) => item.id === "done");
  const pending = result.operations.find((item) => item.id === "pending");
  assert.deepEqual([done.fechaInicio, done.horaInicio, done.fechaFin, done.horaFin], ["2026-07-13", "07:00", "2026-07-13", "12:00"]);
  assert.equal(result.lastSchedule.scheduled, 1);
  assert.deepEqual([pending.fechaInicio, pending.horaInicio], ["2026-07-13", "07:00"]);
  assert.equal(result.lastSchedule.operatorConflicts, 0);
});

test("una operacion fantasma no seleccionada no reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["200"],
    operations: [
      { id: "ghost", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", locked: true, operador: "OP 1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "12:00", tiempoProd: 300 },
      { id: "selected", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const selected = result.operations.find((item) => item.id === "selected");
  assert.deepEqual([selected.fechaInicio, selected.horaInicio], ["2026-07-13", "07:00"]);
  assert.deepEqual([...result.lastSchedule.scheduledOts], ["200"]);
  assert.ok(result.operations.some((item) => item.id === "ghost"));
});

test("un cambio antiguo pendiente desaparece y no reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["200"],
    operations: [
      { id: "old-change", ot: "200", secuencia: 0, ct: "TOOL_CHANGE", descripcion: "CAMBIO DE HERRAMENTAL", tipoInsercion: "CAMBIO_HERRAMENTAL", estatus: "PLAN", planStatus: "PENDIENTE", generatedBy: "PLANNER_CORE_V2", locked: true, operador: "AJUSTADOR", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoSetup: 120 },
      { id: "selected", ot: "200", secuencia: 1, ct: "AJUSTE", descripcion: "AJUSTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "AJUSTADOR", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { AJUSTE: ["AJUSTADOR"] }, operators: ["AJUSTADOR"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const selected = result.operations.find((item) => item.id === "selected");
  assert.equal(result.operations.some((item) => item.id === "old-change"), false);
  assert.deepEqual([selected.fechaInicio, selected.horaInicio], ["2026-07-13", "07:00"]);
});

test("un cambio antiguo completado permanece pero no reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["200"],
    operations: [
      { id: "old-completed-change", ot: "100", secuencia: 1, ct: "TOOL_CHANGE", descripcion: "CAMBIO DE HERRAMENTAL", tipoInsercion: "CAMBIO_HERRAMENTAL", estatus: "PLAN", planStatus: "COMPLETADA_PLAN", generatedBy: "PLANNER_CORE_V2", operador: "AJUSTADOR", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "07:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoSetup: 120 },
      { id: "pending", ot: "200", secuencia: 1, ct: "AJUSTE", descripcion: "AJUSTE", tipoInsercion: "OPERACION", estatus: "PLAN", planStatus: "PENDIENTE", operador: "AJUSTADOR", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { AJUSTE: ["AJUSTADOR"] }, operators: ["AJUSTADOR"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });

  const completed = result.operations.find((item) => item.id === "old-completed-change");
  const pending = result.operations.find((item) => item.id === "pending");
  assert.ok(completed);
  assert.deepEqual([completed.fechaInicio, completed.horaInicio, completed.fechaFin, completed.horaFin], ["2026-07-13", "07:00", "2026-07-13", "09:00"]);
  assert.deepEqual([pending.fechaInicio, pending.horaInicio], ["2026-07-13", "07:00"]);
  assert.equal(result.lastSchedule.operatorConflicts, 0);
});

test("una OT seleccionada y bloqueada conserva su asignacion y reserva capacidad", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["100", "200"],
    lockedOts: ["100"],
    operations: [
      { id: "locked", ot: "100", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", locked: true, operador: "OP 1", maquina: "M1", fechaInicio: "2026-07-13", horaInicio: "08:00", fechaFin: "2026-07-13", horaFin: "09:00", tiempoProd: 60 },
      { id: "movable", ot: "200", secuencia: 1, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", operador: "OP 1", tiempoSetup: 0, tiempoProd: 20 },
    ],
    workOrders: [{ ot: "100" }, { ot: "200" }],
    matrix: { CORTE: ["OP 1"] }, operators: ["OP 1"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T08:00:00" });

  const locked = result.operations.find((item) => item.id === "locked");
  const movable = result.operations.find((item) => item.id === "movable");
  assert.deepEqual(
    [locked.fechaInicio, locked.horaInicio, locked.fechaFin, locked.horaFin, locked.operador, locked.maquina],
    ["2026-07-13", "08:00", "2026-07-13", "09:00", "OP 1", "M1"],
  );
  const lockedStart = new Date(`${locked.fechaInicio}T${locked.horaInicio}:00`);
  const lockedEnd = new Date(`${locked.fechaFin}T${locked.horaFin}:00`);
  const movableStart = new Date(`${movable.fechaInicio}T${movable.horaInicio}:00`);
  const movableEnd = new Date(`${movable.fechaFin}T${movable.horaFin}:00`);
  assert.ok(movableEnd <= lockedStart || movableStart >= lockedEnd, "la OT movible no debe solaparse con el bloqueo");
});

test("la produccion se calcula como TC por piezas aunque NetSuite envie otro tiempo", () => {
  const core = loadPlannerCore();
  const operation = {
    tiempoCiclo: 1.5,
    cantidadPendiente: 30,
    tiempoSetup: 15,
    tiempoProd: 15,
  };
  assert.equal(core.productionMinutes(operation), 45);
  assert.equal(core.operationDuration(operation, 100, 100), 60);
});

test("el motor toma el herramental guardado en la configuracion de la OT", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    selectedOts: ["2433"],
    operations: [{ id: "bend-2433", ot: "2433", secuencia: 3, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", estatus: "PLAN", maquina: "211", herramental: "5 x 6", tiempoCiclo: 1, cantidadPendiente: 1 }],
    workOrders: [{ ot: "2433" }],
    otConfigurations: { "2433": { ot: "2433", machine: "211", herramental: "4 x 5" } },
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA"], operators: ["OPERADOR 2"],
    settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  assert.equal(result.operations.find((op) => op.id === "bend-2433").herramental, "4 x 5");
});

test("dos doblados en la misma maquina conservan operaciones y generan cambio de herramental", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "bend-a", ot: "100", secuencia: 1, ct: "5459", descripcion: "DOBLADO A", parte: "A", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "DOBLADORA 2", herramental: "H1", kitHerramental: "K1", tiempoProd: 20 },
    { id: "bend-b", ot: "200", secuencia: 1, ct: "5459", descripcion: "DOBLADO B", parte: "B", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "DOBLADORA 2", herramental: "H2", kitHerramental: "K2", tiempoProd: 20 },
  ];
  const result = core.schedulePlan({
    operations, workOrders: [{ ot: "100" }, { ot: "200" }], operators: ["OPERADOR 1", "OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLADO_A": ["OPERADOR 1"], "5459::DOBLADO_B": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLADO_A", "5459::DOBLADO_B", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const productive = result.operations.filter((op) => ["bend-a", "bend-b"].includes(op.id));
  const changes = result.operations.filter((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL");
  assert.equal(productive.length, 2);
  assert.ok(productive.every((op) => op.fechaInicio && op.fechaFin), "ambos doblados deben quedar programados");
  assert.deepEqual(new Set(productive.map((op) => op.operador)), new Set(["OPERADOR 1", "OPERADOR 2"]));
  assert.ok(changes.length >= 1);
  assert.ok(changes.every((change) => change.operador === "AJUSTADOR" && change.maquina === "DOBLADORA 2"));
  const transition = changes.find((change) => change.toolChangeFromHerramental && change.toolChangeToHerramental && change.toolChangeFromHerramental !== change.toolChangeToHerramental);
  assert.ok(transition, "debe existir la transicion real entre H1 y H2");
  const changedProduct = productive.find((op) => op.herramental === transition.toolChangeToHerramental);
  assert.ok(new Date(`${changedProduct.fechaInicio}T${changedProduct.horaInicio}:00`) >= new Date(`${transition.fechaFin}T${transition.horaFin}:00`));
});

test("dos herramentales sin kit generan cambio aunque el catalogo tenga duracion cero", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "bend-2433", ot: "2433", secuencia: 3, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "AM M66-2843", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "211", herramental: "4 x 5", tiempoCiclo: 1.5, cantidadPendiente: 30, tiempoSetup: 15 },
    { id: "bend-2436", ot: "2436", secuencia: 2, ct: "5459", descripcion: "DOBLEZ DE TUBERIA", parte: "AM 17123-002", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "211", herramental: "5 x 6", tiempoCiclo: 4, cantidadPendiente: 48, tiempoSetup: 12 },
  ];
  const result = core.schedulePlan({
    selectedOts: ["2433", "2436"], operations, workOrders: [{ ot: "2433" }, { ot: "2436" }],
    operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ_DE_TUBERIA": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBERIA", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [
      { part: "AM M66-2843", herramental: "4 x 5", toolSetupMinutes: 0, active: true },
      { part: "AM 17123-002", herramental: "5 x 6", toolSetupMinutes: 0, active: true },
    ],
    settings: { optimizationPasses: 1, toolChangeMinutes: 30 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const change = result.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" && op.toolChangeFromHerramental === "4 x 5" && op.toolChangeToHerramental === "5 x 6");
  assert.ok(change, "debe proyectar el cambio 4 x 5 a 5 x 6");
  assert.equal(change.tiempoSetup, 30);
});

test("un cambio sin tiempo configurado usa el estandar de 120 minutos", () => {
  const core = loadPlannerCore();
  const operations = [
    { id: "a", ot: "1", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", parte: "A", estatus: "PLAN", maquina: "211", herramental: "H1", tiempoCiclo: 1, cantidadPendiente: 1 },
    { id: "b", ot: "2", secuencia: 1, ct: "5459", descripcion: "DOBLEZ", parte: "B", estatus: "PLAN", maquina: "211", herramental: "H2", tiempoCiclo: 1, cantidadPendiente: 1 },
  ];
  const result = core.schedulePlan({
    selectedOts: ["1", "2"], operations, workOrders: [{ ot: "1" }, { ot: "2" }], operators: ["OPERADOR 2", "AJUSTADOR"],
    matrix: { "5459::DOBLEZ": ["OPERADOR 2"], "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL": ["AJUSTADOR"] },
    configuredCapabilities: ["5459::DOBLEZ", "TOOL_CHANGE::CAMBIO_DE_HERRAMENTAL"],
    toolCatalog: [{ part: "A", herramental: "H1", toolSetupMinutes: 0 }, { part: "B", herramental: "H2", toolSetupMinutes: 0 }],
    settings: { optimizationPasses: 1, toolChangeMinutes: 0 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 5, executionTime: "2026-07-13T07:00:00" });
  const change = result.operations.find((op) => op.tipoInsercion === "CAMBIO_HERRAMENTAL" && op.toolChangeFromHerramental === "H1" && op.toolChangeToHerramental === "H2");
  assert.equal(change?.tiempoSetup, 120);
});

test("un doblado sin recursos conserva identidad y diagnostica maquina y herramental", () => {
  const core = loadPlannerCore();
  const operation = {
    id: "ct-5459-real", ot: "2159", secuencia: 10, ct: "5459", descripcion: "DOBLEZ DE TUBO",
    parte: "C 490 UND", tipoInsercion: "OPERACION", estatus: "PLAN", maquina: "", herramental: "", kitHerramental: "",
  };
  const issues = core.planningConfigurationIssues({
    operations: [operation], operators: ["OPERADOR 2"],
    matrix: { "5459::DOBLEZ_DE_TUBO": ["OPERADOR 2"] },
    configuredCapabilities: ["5459::DOBLEZ_DE_TUBO"], machines: [], toolCatalog: [],
  }, [operation]);
  assert.equal(operation.id, "ct-5459-real");
  assert.equal(operation.ot, "2159");
  assert.equal(operation.secuencia, 10);
  assert.ok(issues.some((issue) => issue.code === "MISSING_MACHINE" && issue.operationId === operation.id));
  assert.ok(issues.some((issue) => issue.code === "MISSING_TOOL" && issue.operationId === operation.id));
});

test("una operacion sin hueco conserva OT, secuencia y causa diagnostica", () => {
  const core = loadPlannerCore();
  const result = core.schedulePlan({
    operations: [{ id: "missing", ot: "300", secuencia: 7, ct: "CORTE", descripcion: "CORTE", tipoInsercion: "OPERACION", estatus: "PLAN", tiempoProd: 20 }],
    workOrders: [{ ot: "300" }], matrix: { "CORTE::CORTE": [] }, operators: [], settings: { optimizationPasses: 1 }, workSchedule: {},
  }, { planStart: "2026-07-13", horizonDays: 1, executionTime: "2026-07-13T07:00:00" });
  const diagnostic = result.lastSchedule.diagnostics.find((item) => item.code === "UNSCHEDULED");
  assert.equal(diagnostic.ot, "300");
  assert.equal(diagnostic.sequence, 7);
  assert.match(diagnostic.cause, /operador|capacidad|horizonte/i);
});
